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
// GitHub's release downloads, for /download: where .../releases/latest/download/FAFO-Windows.zip goes (rel.latest: a
// status, a Location or none, how long it takes), and which versioned zips are there (rel.named: path → status).
const RELEASES = `http://127.0.0.1:${GH_PORT}/sample-owner/sample-repo/releases`;
const rel = { latest: { status: 404 }, named: new Map(), hits: [] };
const latestTo = (v) => ({ status: 302, location: `${RELEASES}/download/v${v}/FAFO-Windows.zip` });
const namedPath = (v) => `/sample-owner/sample-repo/releases/download/v${v}/FAFO-Windows-${v}.zip`;
const gh = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/sample-owner/") || u.pathname.startsWith("/other/")) {
    rel.hits.push(req.method + " " + u.pathname + u.search);
    if (u.pathname === "/sample-owner/sample-repo/releases/latest/download/FAFO-Windows.zip") {
      const l = rel.latest;
      return setTimeout(() => { res.writeHead(l.status, l.location ? { location: l.location } : {}); res.end(); }, l.delay || 0);
    }
    const st = rel.named.get(u.pathname);
    if (st) { res.writeHead(st, st >= 300 && st < 400 ? { location: "https://objects.example.com/sample-asset" } : {}); return res.end(); }
    res.writeHead(404); return res.end();
  }
  if (u.pathname === "/update.json") {
    manifestHits++;
    if (manifestDown || !manifest) { res.writeHead(500); return res.end("down"); }
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(manifest));
  }
  if (pages.has(u.pathname)) { res.writeHead(200, { "content-type": "text/plain" }); return res.end(pages.get(u.pathname)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(GH_PORT, "127.0.0.1", r));

// The front page's address is localhost here (fafoaco.com for real); the app stays on 127.0.0.1.
// /download keeps an answer found 1.5 s and none 0.6 s here (10 minutes and 1 minute for real), and gives GitHub 0.7 s.
const FOUND_MS = 1500, MISS_MS = 600, TIMEOUT_MS = 700;
writeFileSync(join(tmp, ".env"), [`UPDATE_URL=http://127.0.0.1:${GH_PORT}/update.json`, `PUBLISHER_KEY=${spki}`, "CHECK_EVERY_MS=300", "SITE_HOST=localhost",
  `RELEASES_URL=${RELEASES}`, `DOWNLOAD_FOUND_MS=${FOUND_MS}`, `DOWNLOAD_MISS_MS=${MISS_MS}`, `DOWNLOAD_TIMEOUT_MS=${TIMEOUT_MS}`].join("\n"));
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
  await test("the front page's address serves the front page (with the release), /download and /app redirect, the app stays the app", async () => {
    const site = `http://localhost:${WORKER_PORT}`;
    rel.latest = latestTo("1.9.139"); rel.named.set(namedPath("1.9.139"), 302);
    const r = await fetch(site + "/", { redirect: "manual" });
    const body = await r.text();
    assert.equal(r.status, 200); assert.match(body, /<h1 class="display"><span>Your slots in\.<\/span><span class="grad">Your orders tracked\.<\/span><\/h1>/);
    assert.match(body, /Web version 1\.9\.0 · Encrypted with your master password/);
    // Since 2026-10-13 (the owner's request): Login with Discord, to the app, is the page's button; no Windows download on it.
    const logins = [...body.matchAll(/<a class="btn btn-primary[^"]*" href="([^"]+)"[^>]*><svg class="dc"[^>]*>.*?<\/svg><span[^>]*>Login with Discord<\/span>/g)];
    assert.ok(logins.length >= 3, "Login with Discord in the header, the hero and the last call");
    for (const m of logins) assert.equal(m[1], "https://app.fafoaco.com");
    for (const gone of [/Download for Windows/, /Open in your browser/, /Windows 10 and 11/, /any browser/, /href="\/download"/, /<script[^>]+src=/]) assert.doesNotMatch(body, gone);
    // Every link stays on the page or goes to the app; nothing points at a download.
    for (const m of body.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) assert.match(m[1], /^(#(main|how|features|faq)|\/|https:\/\/app\.fafoaco\.com)$/, "a link the front page shouldn't have: " + m[1]);
    for (const gone of [/FAFO-Windows\.zip/, /releases\/latest/, /\bWindows\b/]) assert.doesNotMatch(body, gone);
    const { sitePage } = await import("../src/site.js");
    const hostile = sitePage('1.9.0"><x', 'https://x" onmouseover="alert(1)');
    assert.doesNotMatch(hostile, /onmouseover="/); assert.doesNotMatch(hostile, /"><x/);
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8"); assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-orbit-version"), null);
    // The newest release's zip with its version in the name (1.9.146; the next tests have the rest of it).
    const d = await fetch(site + "/download", { redirect: "manual" });
    assert.equal(d.status, 302); assert.equal(d.headers.get("location"), `${RELEASES}/download/v1.9.139/FAFO-Windows-1.9.139.zip`);
    const a = await fetch(site + "/app", { redirect: "manual" });
    assert.equal(a.status, 302); assert.equal(a.headers.get("location"), "https://app.fafoaco.com/");
    const o = await fetch(site + "/something", { redirect: "manual" });
    assert.equal(o.status, 302); assert.equal(o.headers.get("location"), site + "/");
    assert.match(await (await fetch(site + "/robots.txt")).text(), /Allow: \//);
    assert.equal((await fetch(site + "/", { method: "POST", body: "x" })).status, 405);
    const app = await get();
    assert.equal(await app.text(), page1); assert.equal(app.headers.get("x-orbit-version"), "1.9.0");
  });
  // /download (1.9.146, the owner's request, 2026-11-13: "anytime a new update is available, can you have the version in
  // the description"): the newest release's FAFO-Windows-<version>.zip when it has one, so a browser saves it under that
  // name, found from where GitHub sends .../latest/download/FAFO-Windows.zip; GitHub's plain link otherwise.
  const site = `http://localhost:${WORKER_PORT}`;
  const PLAIN = "https://github.com/dolamv-coder/profile-vault-updates/releases/latest/download/FAFO-Windows.zip";
  const named = (v) => `${RELEASES}/download/v${v}/FAFO-Windows-${v}.zip`;
  const LATEST_HEAD = "HEAD /sample-owner/sample-repo/releases/latest/download/FAFO-Windows.zip";
  const dl = async (path = "/download", opts = {}) => {
    const r = await fetch(site + path, { redirect: "manual", ...opts });
    assert.equal(r.status, 302); return r.headers.get("location");
  };
  const forget = () => wait(FOUND_MS + 200);   // past any answer kept
  await test("/download: the newest release's FAFO-Windows-<version>.zip when it has one (/download/ and HEAD too)", async () => {
    await forget();
    rel.latest = latestTo("1.9.139"); rel.named = new Map([[namedPath("1.9.139"), 302]]); rel.hits = [];
    assert.equal(await dl(), named("1.9.139"));
    assert.deepEqual(rel.hits, [LATEST_HEAD, "HEAD " + namedPath("1.9.139")]);
    assert.equal(await dl("/download/"), named("1.9.139"));
    assert.equal(await dl("/download", { method: "HEAD" }), named("1.9.139"));
    assert.equal(rel.hits.length, 2, "kept: GitHub isn't asked again");
  });
  await test("/download: GitHub isn't asked again while the answer is kept; after it, a newer release is followed; requests at once share one lookup", async () => {
    rel.hits = [];
    for (const l of await Promise.all(Array.from({ length: 5 }, () => dl()))) assert.equal(l, named("1.9.139"));
    rel.latest = latestTo("1.9.146"); rel.named.set(namedPath("1.9.146"), 302);
    assert.equal(await dl(), named("1.9.139"), "still the answer kept");
    assert.deepEqual(rel.hits, []);
    await forget();
    rel.latest = { ...latestTo("1.9.146"), delay: 250 };   // slow enough for the requests to overlap
    for (const l of await Promise.all(Array.from({ length: 8 }, () => dl()))) assert.equal(l, named("1.9.146"));
    assert.deepEqual(rel.hits, [LATEST_HEAD, "HEAD " + namedPath("1.9.146")], "one lookup for all eight");
  });
  await test("/download: a release without the versioned zip (404, or GitHub erring on it) goes to GitHub's plain link, kept a shorter time", async () => {
    await forget();
    rel.latest = latestTo("1.9.150"); rel.hits = [];
    assert.equal(await dl(), PLAIN);
    assert.deepEqual(rel.hits, [LATEST_HEAD, "HEAD " + namedPath("1.9.150")]);
    assert.equal(await dl(), PLAIN); assert.equal(rel.hits.length, 2, "kept");
    await wait(MISS_MS + 200);
    rel.named.set(namedPath("1.9.150"), 200);   // the file itself, with no redirect, counts too
    assert.equal(await dl(), named("1.9.150"));
    await forget();
    rel.named.set(namedPath("1.9.150"), 500);
    assert.equal(await dl(), PLAIN);
  });
  await test("/download: where GitHub sends latest isn't exactly <releases>/download/v<X.Y.Z>/FAFO-Windows.zip: the plain link, and nothing else asked", async () => {
    rel.named.set(namedPath("1.9.139"), 302);
    const at = `${RELEASES}/download`;
    const odd = [
      { status: 302, location: `http://127.0.0.1:${GH_PORT}/other/repo/releases/download/v1.9.139/FAFO-Windows.zip` },   // another repository
      // Another repository or host whose address is as long as this one's, so only the prefix check can tell them apart.
      { status: 302, location: `http://127.0.0.1:${GH_PORT}/sample-owner/sample-repX/releases/download/v1.9.139/FAFO-Windows.zip` },
      { status: 302, location: `http://127.0.0.2:${GH_PORT}/sample-owner/sample-repo/releases/download/v1.9.139/FAFO-Windows.zip` },
      { status: 302, location: `https://github.com/dolamv-coder/profile-vault-updates/releases/download/v1.9.139/FAFO-Windows.zip` },   // not this base
      { status: 302, location: `${at}/v1.9.139/FAFO-Windows.zip?x=1` },   // a query
      { status: 302, location: `${at}/v1.9.139/FAFO-Windows.zip#x` },
      { status: 302, location: `${at}/vX/FAFO-Windows.zip` },   // an odd tag
      { status: 302, location: `${at}/v1.9/FAFO-Windows.zip` },
      { status: 302, location: `${at}/v1.9.139-beta/FAFO-Windows.zip` },
      { status: 302, location: `${at}/1.9.139/FAFO-Windows.zip` },
      { status: 302, location: `${at}/v1.9.139/sub/FAFO-Windows.zip` },
      { status: 302, location: `${at}/v1.9.139/Orbit-Windows.zip` },
      { status: 302, location: `/sample-owner/sample-repo/releases/download/v1.9.139/FAFO-Windows.zip` },   // relative
      { status: 302 },   // no Location
      { status: 200, location: `${at}/v1.9.139/FAFO-Windows.zip` },   // not a redirect
      { status: 404 },
    ];
    await wait(MISS_MS + 200);
    for (const l of odd) {
      rel.latest = l; rel.hits = [];
      assert.equal(await dl(), PLAIN, JSON.stringify(l));
      assert.deepEqual(rel.hits, [LATEST_HEAD], JSON.stringify(l));
      await wait(MISS_MS + 200);
    }
  });
  await test("/download: GitHub down (500) or slower than the timeout: the plain link, in time, then found once GitHub answers", async () => {
    rel.latest = { status: 500 }; rel.hits = [];
    assert.equal(await dl(), PLAIN); assert.deepEqual(rel.hits, [LATEST_HEAD]);
    await wait(MISS_MS + 200);
    rel.latest = { ...latestTo("1.9.139"), delay: 2500 };
    const t0 = Date.now();
    const both = await Promise.all([dl(), dl()]);
    assert.deepEqual(both, [PLAIN, PLAIN]);
    assert.ok(Date.now() - t0 < TIMEOUT_MS + 900, `took ${Date.now() - t0} ms`);
    rel.hits = [];
    assert.equal(await dl(), PLAIN); assert.deepEqual(rel.hits, [], "a failed lookup is kept too");
    await wait(MISS_MS + 200);
    rel.latest = latestTo("1.9.139");
    assert.equal(await dl(), named("1.9.139"));
    // The front page and the app never ask about releases.
    rel.hits = [];
    assert.equal((await fetch(site + "/")).status, 200); assert.equal((await get()).status, 200);
    assert.deepEqual(rel.hits, []);
  });
  await test("both addresses serve FAFO's icons (the tab's and the home screen's), and the front page shows the logo and names them", async () => {
    const site = `http://localhost:${WORKER_PORT}`;
    const u32 = (b, i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const isPng = (b, size) => [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x) && u32(b, 16) === size && u32(b, 20) === size;
    for (const base of [BASE, site]) {
      for (let round = 0; round < 2; round++) {   // the same bytes on every request
        const ico = await fetch(base + "/favicon.ico", { redirect: "manual" });
        assert.equal(ico.status, 200); assert.equal(ico.headers.get("content-type"), "image/x-icon");
        assert.match(ico.headers.get("cache-control"), /max-age=86400/); assert.equal(ico.headers.get("x-content-type-options"), "nosniff");
        const b = new Uint8Array(await ico.arrayBuffer()), n = b[4];
        assert.deepEqual([...b.slice(0, 4)], [0, 0, 1, 0]); assert.equal(n, 3);
        for (let i = 0; i < n; i++) {   // 16, 32 and 48 px PNGs, where the directory says
          const e = 6 + 16 * i, size = b[e], len = b[e + 8] | b[e + 9] << 8 | b[e + 10] << 16, off = b[e + 12] | b[e + 13] << 8 | b[e + 14] << 16;
          assert.equal(size, [16, 32, 48][i]); assert.ok(isPng(b.slice(off, off + len), size), "image " + i);
        }
        const svg = await fetch(base + "/favicon.svg", { redirect: "manual" });
        assert.equal(svg.status, 200); assert.equal(svg.headers.get("content-type"), "image/svg+xml");
        assert.match(svg.headers.get("content-security-policy"), /default-src 'none'/);
        const s = await svg.text();
        assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512">/); assert.doesNotMatch(s, /<script|on\w+=|href="http/i);
        for (const p of ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"]) {
          const a = await fetch(base + p, { redirect: "manual" });
          assert.equal(a.status, 200, p); assert.equal(a.headers.get("content-type"), "image/png");
          assert.ok(isPng(new Uint8Array(await a.arrayBuffer()), 180), p);
        }
      }
      const h = await fetch(base + "/favicon.ico", { method: "HEAD" });
      assert.equal(h.status, 200); assert.equal(await h.text(), "");
    }
    const body = await (await fetch(site + "/")).text();
    for (const l of ['<link rel="icon" href="/favicon.ico" sizes="32x32">', '<link rel="icon" href="/favicon.svg" type="image/svg+xml">', '<link rel="apple-touch-icon" href="/apple-touch-icon.png">']) assert.ok(body.includes(l), l);
    // The logo in the header, the mockups of the app (1.9.128 shows it), the last call and the footer, each copy with ids of
    // its own; the two links to the top are named.
    const logos = [...body.matchAll(/<svg class="logo-svg" viewBox="0 0 418\.11 165\.5" aria-hidden="true" focusable="false"><defs><linearGradient id="([\w-]+)-m"/g)].map((m) => m[1]);
    assert.deepEqual(logos, ["lg-h", "lg-ms", "lg-mt", "lg-ml", "lg-f", "lg-o"], "the header, the mockups of the app (its sidebar, the Discord tile, its lock screen), the last call and the footer");
    const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, "every id on the page is used once");
    for (const id of ids) if (/^lg-/.test(id)) assert.ok(body.includes(`url(#${id})`), "used: " + id);
    assert.equal((body.match(/<a class="logo" href="\/" aria-label="FAFO ACO home">/g) || []).length, 2);
  });
  await test("www.fafoaco.com goes to fafoaco.com (the worker's code, called directly: wrangler dev keeps its own address)", async () => {
    const { default: worker } = await import("../src/index.js");
    const r = await worker.fetch(new Request("https://www.fafoaco.com/download?x=1"), {});
    assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "https://fafoaco.com/download?x=1");
  });
  await test("http:// goes to https:// (app, front page and www), so FAFO never opens without a secure context", async () => {
    const { default: worker } = await import("../src/index.js");
    for (const [from, to] of [["http://app.fafoaco.com/?x=1", "https://app.fafoaco.com/?x=1"], ["http://fafoaco.com/download", "https://fafoaco.com/download"], ["http://www.fafoaco.com/", "https://www.fafoaco.com/"], ["http://app.orbit-app.workers.dev/", "https://app.orbit-app.workers.dev/"]]) {
      const r = await worker.fetch(new Request(from), {});
      assert.equal(r.status, 301, from); assert.equal(r.headers.get("location"), to, from);
    }
    const w = await worker.fetch(new Request("https://www.fafoaco.com/"), {});
    assert.equal(w.headers.get("location"), "https://fafoaco.com/");
    assert.equal((await worker.fetch(new Request("http://app.fafoaco.com/", { method: "POST", body: "x" }), {})).status, 405);
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
