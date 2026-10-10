// End-to-end test: runs the worker in wrangler's local runtime against a mock of GitHub serving
// update.json and the pages, signed with a test publisher key.
//   npm test
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_PORT = 8781, GH_PORT = 8782;
const BASE = `http://127.0.0.1:${WORKER_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "orbit-web-test-"));

const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const spki = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64");
const sha = (s) => createHash("sha256").update(s).digest("hex");
async function release(version, html, { key = keys.privateKey, minAppVersion, shaOf } = {}) {
  const h = sha(shaOf || html);
  const msg = ["profile-vault-update", version, h, minAppVersion || "0"].join("\n");
  const signature = Buffer.from(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(msg))).toString("base64");
  pages.set(`/index-${version}.html`, html);
  return { version, url: `index-${version}.html`, sha256: h, signature, notes: "", publishedAt: new Date().toISOString(), ...(minAppVersion ? { minAppVersion } : {}) };
}

const pages = new Map();
let manifest = null, manifestDown = false, manifestHits = 0;
const gh = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/update.json") {
    manifestHits++;
    if (manifestDown || !manifest) { res.writeHead(500); return res.end("down"); }
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(manifest));
  }
  if (pages.has(u.pathname)) { res.writeHead(200, { "content-type": "text/plain" }); return res.end(pages.get(u.pathname)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(GH_PORT, "127.0.0.1", r));

writeFileSync(join(tmp, ".env"), [`UPDATE_URL=http://127.0.0.1:${GH_PORT}/update.json`, `PUBLISHER_KEY=${spki}`, "CHECK_EVERY_MS=300"].join("\n"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", CI: "1" };
const wranglerJs = [join(root, "node_modules", "wrangler", "bin", "wrangler.js")];
const dev = spawn(process.execPath, [...wranglerJs, "dev", "--local", "--ip", "127.0.0.1", "--port", String(WORKER_PORT), "--persist-to", join(tmp, "state"),
  "--env-file", join(tmp, ".env"), "--show-interactive-dev-session=false"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; dev.stdout.on("data", (d) => log += d); dev.stderr.on("data", (d) => log += d);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name); throw e; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path = "/", opts = {}) => fetch(BASE + path, { redirect: "manual", ...opts });

try {
  for (let i = 0; ; i++) {
    try { await fetch(BASE + "/robots.txt"); break; } catch {}
    if (i > 120) throw new Error("wrangler dev didn't start:\n" + log);
    await wait(500);
  }
  const page1 = "<!doctype html><title>Orbit</title><p>version one</p>";
  await test("nothing checks out yet (wrong key): a short note to try again, never the page", async () => {
    manifest = await release("1.9.0", page1, { key: other.privateKey });
    const r = await get();
    assert.equal(r.status, 503); assert.match(await r.text(), /Try again in a minute/);
  });
  await test("a signed release is served as the page, with its version and safe headers", async () => {
    manifest = await release("1.9.0", page1);
    await wait(350);
    const r = await get();
    assert.equal(r.status, 200); assert.equal(await r.text(), page1);
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(r.headers.get("x-orbit-version"), "1.9.0");
    assert.equal(r.headers.get("server-timing"), 'v;desc="1.9.0"');
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'none'");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  });
  await test("/index.html is the same page; other paths go to /; HEAD has no body; POST is refused", async () => {
    assert.equal(await (await get("/index.html")).text(), page1);
    const r = await get("/settings/x?y=1");
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), BASE + "/");
    const h = await get("/", { method: "HEAD" });
    assert.equal(h.status, 200); assert.equal(await h.text(), ""); assert.equal(h.headers.get("x-orbit-version"), "1.9.0");
    assert.equal((await get("/", { method: "POST", body: "x" })).status, 405);
    assert.match(await (await get("/robots.txt")).text(), /Disallow: \//);
  });
  await test("update.json is read at most once in the check interval, however many visits", async () => {
    await wait(350);
    const before = manifestHits;
    await Promise.all(Array.from({ length: 10 }, () => get()));
    assert.ok(manifestHits - before <= 2, `read ${manifestHits - before} times`);
  });
  const page2 = "<!doctype html><title>Orbit</title><p>version two</p>";
  await test("a new release replaces it within the check interval", async () => {
    manifest = await release("1.9.1", page2);
    await wait(350);
    const r = await get();
    assert.equal(await r.text(), page2); assert.equal(r.headers.get("x-orbit-version"), "1.9.1"); assert.equal(r.headers.get("server-timing"), 'v;desc="1.9.1"');
  });
  await test("a page that doesn't match update.json's SHA-256 is refused; the last good one stays", async () => {
    manifest = await release("1.9.2", "<p>tampered</p>", { shaOf: "<p>what was signed</p>" });
    await wait(350);
    assert.equal(await (await get()).text(), page2);
  });
  await test("a release signed with another key is refused; the last good one stays", async () => {
    manifest = await release("1.9.3", "<p>evil</p>", { key: other.privateKey });
    await wait(350);
    assert.equal(await (await get()).text(), page2);
  });
  await test("a signed field changed afterwards (minAppVersion) is refused", async () => {
    manifest = { ...(await release("1.9.4", "<p>needs a new app</p>", { minAppVersion: "1.9.61" })), minAppVersion: "0" };
    await wait(350);
    assert.equal(await (await get()).text(), page2);
  });
  await test("a release that needs a newer desktop app still opens on the web", async () => {
    manifest = await release("1.9.5", "<p>five</p>", { minAppVersion: "1.9.61" });
    await wait(350);
    assert.equal(await (await get()).text(), "<p>five</p>");
  });
  await test("with update.json down, the last good page keeps being served", async () => {
    manifestDown = true;
    await wait(350);
    const r = await get();
    assert.equal(r.status, 200); assert.equal(await r.text(), "<p>five</p>");
    manifestDown = false;
  });
  console.log(`\n${passed} passed`);
} finally {
  dev.kill("SIGTERM");
  gh.close();
  for (let i = 0; i < 20; i++) {
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); break; }
    catch { await wait(500); }
  }
}
