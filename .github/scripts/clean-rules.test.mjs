// Tests what Clean emails clears in the newest page (index-X.Y.Z.html), from 1.9.134: Riot Games' login codes and welcome
// emails and Best Buy's password reset codes go, and nothing else changes from 1.9.133, in the Inbox, in Spam and both. Each
// email goes through the desktop app's own scanner (scanPromos in desktop/imap-sync.js, against a pretend mail server) and then
// the page's own code: cleanScanFolder (both scans), applyCleanSafety, cleanScan (the Clean page's Scan) and runAutoClean,
// with its hour's wait. Sample senders and addresses only.
//   node .github/scripts/clean-rules.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have these rules; a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Module from "node:module";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const BASE = join(root, "index-1.9.133.html");   // the last page before Riot Games' and Best Buy's codes went

// ---- The pretend mail server, for the desktop app's scanner ----
// boxes: {path: {v: uidValidity, msgs: [{id, uid, name, address, subject, at, bulk, body}]}}
let SERVER = null;
const DAY = 86400000;
const dayOf = (ms) => Math.floor(ms / DAY);
class FakeImap {
  constructor() { this.capabilities = new Map([["MOVE", true]]); this.mailbox = null; this.open = null; }
  async connect() { SERVER.connects++; }
  async logout() {}
  close() {}
  async list() { return Object.keys(SERVER.boxes).map((path) => ({ path, specialUse: /spam/i.test(path) ? "\\Junk" : /trash/i.test(path) ? "\\Trash" : "" })); }
  async getMailboxLock(path) { const b = SERVER.boxes[path]; if (!b) throw new Error("no such box"); this.open = b; this.mailbox = { uidValidity: b.v }; return { release() {} }; }
  async search(q) { SERVER.searches.push(q.since); return this.open.msgs.filter((m) => dayOf(m.at) >= dayOf(q.since.getTime())).map((m) => m.uid); }
  async *fetch(uids, query) {
    for (const m of this.open.msgs.filter((x) => uids.includes(x.uid))) {
      const envelope = { subject: m.subject, from: [{ name: m.name, address: m.address }] };
      if (query.source) yield { uid: m.uid, envelope, source: Buffer.from(m.body || "") };
      else yield { uid: m.uid, envelope, headers: Buffer.from(m.bulk ? "List-Unsubscribe: <mailto:unsubscribe@example.com>\r\n" : "") };
    }
  }
  async messageMove(uids, dest) {
    const moving = this.open.msgs.filter((m) => uids.includes(m.uid));
    this.open.msgs = this.open.msgs.filter((m) => !uids.includes(m.uid));
    SERVER.boxes[dest].msgs.push(...moving);
    SERVER.moved.push(...moving.map((m) => m.id));
    return { uidMap: new Map(moving.map((m) => [m.uid, m.uid + 1000])) };
  }
}
const mocks = {
  imapflow: { ImapFlow: FakeImap },
  mailparser: { simpleParser: async (src) => ({ text: src.toString() }) },
  "./trust": { ready: Promise.resolve(), tlsOptions: () => ({}) }
};
const load0 = Module._load;
Module._load = function (req, parent, ...rest) { return Object.prototype.hasOwnProperty.call(mocks, req) ? mocks[req] : load0.call(this, req, parent, ...rest); };
const imap = createRequire(import.meta.url)(join(root, "desktop", "imap-sync.js"));
Module._load = load0;

// ---- The page's own code ----
function pageApi(path) {
  const html = readFileSync(path, "utf8");
  const block = (a, b) => { const s = html.indexOf(a), e = html.indexOf(b, s); assert.ok(s >= 0 && e > s, `couldn't find ${a} in ${path}`); return html.slice(s, e); };
  const code = block("function clearStore(){", "\n")
    + block("// Important mail the cleaner must never offer", "function renderClean(){")
    + block("const FOLDER_NAME = ", "async function cleanTrash(){")
    + block("const autoCleanCfg = ", "function autoCleanHTML(){");
  const prelude = `let S = null; const DESK = true, CAN_CLEAN = true, CAN_CLEAN_SPAM = true, UI = {view:"orders"};
    const CLEAN_OLD_APP = !(window.pvDesktop.version >= 10);
    const CLEAN = { inboxId:"", days:30, folder:"all", busy:"", progress:"", phase:"", result:null, sel:new Set() };
    const toasts = []; const toast = (m) => toasts.push(m); const renderMain = () => {}; const persist = () => {};
    const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const inboxById = (id) => (S.inboxes || []).find(i => i.id === id) || null;
    let premiumMem = null, billMem = null; const STORE_KEY = "pv-vault", AUTO_PIC_STORE = "orbit-autopic", PREMIUM_STORE = "orbit-premium", BILL_STORE = "orbit-billing";`;
  return new Function("window", "localStorage", prelude + code
    + `return {setS: (s) => { S = s; }, getS: () => S, CLEAN, toasts, applyCleanSafety, cleanScan, runAutoClean, clearStore, CLEAN_RULES,
      KEY: CLEAN_RULES_KEY, CODE_RULES: typeof CLEAN_CODE_RULES !== "undefined" ? CLEAN_CODE_RULES : null};`);
}
// localStorage that works, or one that throws (a browser that blocks storage).
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const blockedStore = () => ({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });

// hooks: version (the desktop app's), beforeScan(cfg) (may throw or wait), failMove.
function setup(path, store = memStore(), hooks = {}) {
  const window = { pvDesktop: {
    version: hooks.version || 13,
    scanPromos: async (cfg) => { SERVER.scans.push(cfg); if (hooks.beforeScan) await hooks.beforeScan(cfg); return imap.scanPromos(Object.assign({ host: "imap.example.com", port: 993 }, cfg)); },
    trashPromos: async (cfg, uids, v) => {
      if (hooks.failMove && hooks.failMove()) return { ok: false, error: "The server said no." };
      const c = new FakeImap(); await c.getMailboxLock(cfg.folder === "spam" ? "Spam" : "INBOX");
      if (v && String(c.mailbox.uidValidity) !== String(v)) return { ok: false, error: "changed" };
      const r = await c.messageMove(uids, "Trash"); return { ok: true, moved: r.uidMap.size };
    }
  } };
  const api = pageApi(path)(window, store);
  api.setS({ settings: { autoClean: { on: true, inboxId: "all", v2: true, folder: "all" }, cleanKeep: [] }, inboxes: [{ id: "ib1", email: "me@example.com", password: "pw" }] });
  api.store = store;
  return api;
}
// Auto-clean that already swept the inbox with these rules: it looks back 3 days.
const swept = (api, folder = "inbox") => Object.assign(api.getS().settings.autoClean, { folder, swept: { ib1: true }, sweptRules: api.KEY });

let NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const realNow = Date.now;
Date.now = () => NOW;
let nextUid = 1;
const msg = (id, o) => Object.assign({ id, uid: nextUid++, name: "", address: "", subject: "", at: NOW - 3600000, bulk: false, body: "" }, o);
const server = (inbox, spam = []) => { SERVER = { connects: 0, searches: [], scans: [], moved: [], boxes: { INBOX: { v: "7", msgs: inbox }, Spam: { v: "9", msgs: spam }, Trash: { v: "3", msgs: [] } } }; return SERVER; };
const fwd = (from, subject, body) => `---------- Forwarded message ---------\nFrom: ${from}\nSubject: ${subject}\n\n${body}`;
const lookedBack = () => SERVER.searches.map((d) => Math.round((NOW - d.getTime()) / DAY));

// A mailbox with the three kinds asked for and everything around them that has to stay as it was.
const HME = (local, domain) => `${local}_at_${domain.replace(/\./g, "_")}_abcdefghijkl_mnopqr@icloud.com`;
const RIOT = "noreply@mail.accounts.riotgames.com", BBY = "BestBuyInfo@emailinfo.bestbuy.com";
const corpus = (p = "") => [
  // Asked for: these go.
  msg(p + "riot-code-1", { name: "Riot Games", address: RIOT, subject: "Login Code: 469078" }),
  msg(p + "riot-code-2", { name: "Riot Games", address: RIOT, subject: "Login Code: 112233" }),
  msg(p + "riot-code-hme", { name: "Riot Games", address: HME("noreply", "mail.accounts.riotgames.com"), subject: "Login Code: 908172" }),
  msg(p + "riot-welcome", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Welcome to Riot Games" }),
  msg(p + "riot-welcome-mail", { name: "Riot Games", address: "noreply@mail.riotgames.com", subject: "Welcome to Riot Games" }),   // a newsletter address by the app's test: went before too
  msg(p + "riot-welcome-fw", { name: "Sam", address: "sam.account1@example.com", subject: "FW: Welcome to Riot Games",
    body: fwd("Riot Games <noreply@riotgames.com>", "Welcome to Riot Games", "Congratulations, your account is ready.") }),
  msg(p + "bby-reset", { name: "Best Buy", address: BBY, subject: "Your Password Reset verification code" }),
  msg(p + "bby-reset-hme", { name: "Best Buy", address: HME("BestBuyInfo", "emailinfo.bestbuy.com"), subject: "Your Password Reset verification code" }),
  // Kept, as before: orders, receipts, other codes and security notices from the same senders.
  msg(p + "bby-order", { name: "Best Buy", address: BBY, subject: "Thanks for your order, Sam!", bulk: true }),
  msg(p + "bby-shipped", { name: "Best Buy", address: BBY, subject: "Your order has shipped" }),
  msg(p + "bby-signin", { name: "Best Buy", address: BBY, subject: "Your Best Buy verification code" }),
  msg(p + "bby-pickup", { name: "Best Buy", address: BBY, subject: "Your order is ready for pickup" }),
  msg(p + "bby-welcome", { name: "Best Buy", address: BBY, subject: "Welcome to My Best Buy" }),
  msg(p + "bby-reset-used", { name: "Best Buy", address: BBY, subject: "Your password reset code was used" }),
  msg(p + "bby-reset-notme", { name: "Best Buy", address: BBY, subject: "Didn't request a password reset code?" }),
  msg(p + "riot-verify", { name: "Riot Games", address: RIOT, subject: "Verify your email" }),
  msg(p + "riot-receipt", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Your purchase receipt" }),
  msg(p + "riot-thanks", { name: "Riot Games", address: "news@riotgames.com", subject: "Thanks for your purchase", bulk: true }),
  msg(p + "riot-code-used", { name: "Riot Games", address: RIOT, subject: "Your login code was used to sign in" }),
  msg(p + "riot-code-asked", { name: "Riot Games", address: RIOT, subject: "Someone requested a login code for your account" }),
  msg(p + "riot-welcome-receipt", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Welcome to Riot Games! Here's your order receipt #12345" }),
  msg(p + "riot-spoof", { name: "Riot Games", address: "noreply@riot-games-security.example.com", subject: "Login Code: 445566" }),
  msg(p + "riot-named", { name: "noreply@riotgames.com", address: "codes@example.com", subject: "Login Code: 445577" }),
  msg(p + "target-code", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }),
  msg(p + "pkc-order", { name: "Pokémon Center", address: "orders@pokemoncenter.com", subject: "Your Pokémon Center order confirmation" }),
  // Forwards ("FW: …", as each account's mailbox forwards to one inbox), kept by their opening lines.
  msg(p + "fw-code", { name: "Sam", address: "sam.account1@example.com", subject: "FW: Login Code: 778899",
    body: fwd(`Riot Games <${RIOT}>`, "Login Code: 778899", "Your code") }),
  msg(p + "fw-pickup", { name: "Sam", address: "sam.account1@example.com", subject: "FW: Your order is ready for pickup",
    body: fwd(`Best Buy <${BBY}>`, "Your order is ready for pickup", "Order #BBY01-806123456789 is ready.") }),
  msg(p + "fw-getting", { name: "Sam", address: "sam.account2@example.com", subject: "FW: We're getting your order ready",
    body: fwd(`Best Buy <${BBY}>`, "We're getting your order ready", "Order Number: BBY01-806123456780") }),
  msg(p + "fw-signin", { name: "Sam", address: "sam.account2@example.com", subject: "FW: Sign in to Best Buy",
    body: fwd(`Best Buy <${BBY}>`, "Sign in to Best Buy", "Your verification code is 123456") }),
  msg(p + "fw-riot-buy", { name: "Sam", address: "sam.account3@example.com", subject: "FW: Your Riot Games purchase",
    body: fwd("Riot Games <noreply@riotgames.com>", "Your Riot Games purchase", "Receipt for order 55512") }),
  msg(p + "fw-riot-id", { name: "Riot Games", address: RIOT, subject: "FW: Your Riot ID has been changed",
    body: fwd(`Riot Games <${RIOT}>`, "Your Riot ID has been changed", "If this wasn't you, sign in and reset your password.") }),
  // Offered or kept as before: the app decides by headers the page never sees.
  msg(p + "bby-bulk-review", { name: "Best Buy", address: BBY, subject: "How was your recent visit?", bulk: true }),
  msg(p + "bby-sale-plain", { name: "Best Buy", address: BBY, subject: "Flash Sale: 40% off laptops" }),
  msg(p + "bby-junk", { name: "Best Buy", address: BBY, subject: "You won't believe this" }),
  // Cleared, as before.
  msg(p + "bby-news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true }),
  msg(p + "bby-sale", { name: "Best Buy", address: BBY, subject: "Flash Sale: 40% off laptops", bulk: true }),
  msg(p + "riot-news", { name: "Riot Games", address: "news@riotgames.com", subject: "This week in Valorant", bulk: true }),
  msg(p + "target-news", { name: "Target", address: "targetnews@em.target.com", subject: "New arrivals for fall", bulk: true }),
  msg(p + "survey", { name: "Target", address: "target@medallia.com", subject: "How was your Target order?" })
];
const ASKED = ["riot-code-1", "riot-code-2", "riot-code-hme", "riot-welcome", "riot-welcome-mail", "riot-welcome-fw", "bby-reset", "bby-reset-hme"];
const bare = (id) => id.replace(/^s:/, "");
const isCode = (id) => /code|reset/.test(bare(id)) && !/welcome/.test(id);

const offered = async (api, folder = "inbox") => {
  api.CLEAN.folder = folder; api.CLEAN.days = 30;
  await api.cleanScan();
  const r = api.CLEAN.result, ids = [];
  for (const g of r.groups) for (const u of g.uids) { const [f, n] = u.split(":"); const m = SERVER.boxes[f === "spam" ? "Spam" : "INBOX"].msgs.find((x) => String(x.uid) === n); ids.push(m.id); }
  return { ids: ids.sort(), r };
};
const both = () => server(corpus(), corpus("s:"));

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

server([]);
const probe = setup(file);
if (!probe.CODE_RULES) {
  if (process.argv[2]) { console.log(`${file} has no Riot Games and Best Buy code rules to test.`); process.exit(0); }
  assert.fail(`${file} has no CLEAN_CODE_RULES: Clean emails' Riot Games and Best Buy rules are gone (update this test if that's on purpose)`);
}
console.log(`Clean emails in ${file.split(/[\\/]/).pop()}`);

await test("the first scan's rules are 1.9.133's; both reach the desktop app whole and compile there to the same", () => {
  const { cleanRules } = imap._clean;
  if (existsSync(BASE)) { server([]); assert.deepEqual(probe.CLEAN_RULES, setup(BASE).CLEAN_RULES); }
  for (const R of [probe.CLEAN_RULES, probe.CODE_RULES]) {
    assert.ok(R.surveyFrom.length < 4000 && R.promoSubject.length < 4000, `surveyFrom is ${R.surveyFrom.length}`);
    const got = cleanRules(R);
    assert.equal(got.surveyFrom.source, new RegExp(R.surveyFrom, "i").source);
    assert.equal(got.promo.source, new RegExp(R.promoSubject, "i").source);
  }
  assert.notEqual(probe.KEY, existsSync(BASE) ? (server([]), setup(BASE).KEY) : "", "auto-clean looks back 30 days once");
});

await test("Scan offers Riot Games' login codes and welcome email and Best Buy's password reset codes, straight or by Hide My Email", async () => {
  server(corpus());
  const { ids } = await offered(setup(file));
  for (const id of ASKED) assert.ok(ids.includes(id), `${id} should be offered`);
});

for (const folder of ["inbox", "spam", "all"]) {
  await test(`${folder}: everything else is offered or kept as 1.9.133 did, kept-safe count too`, async () => {
    if (!existsSync(BASE)) { console.log("       (no index-1.9.133.html to compare with)"); return; }
    both(); const { ids: now, r: rNow } = await offered(setup(file), folder);
    both(); const { ids: before, r: rBefore } = await offered(setup(BASE), folder);
    assert.deepEqual(before.filter((id) => !now.includes(id)), [], "offered before, kept now");
    const added = now.filter((id) => !before.includes(id));
    assert.deepEqual(added.filter((id) => !ASKED.includes(bare(id))), [], "offered now, not before, and not asked for");
    assert.ok(added.length > 0);
    // Each code newly offered was counted as kept safe before; a welcome email nothing kept wasn't.
    assert.equal(rBefore.protectedCount - rNow.protectedCount, added.filter(isCode).length, `kept safe: ${rBefore.protectedCount} before, ${rNow.protectedCount} now`);
  });
}

await test("forwards, other codes, security notices and lookalike senders are kept", async () => {
  both(); const { ids } = await offered(setup(file), "all");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "bby-pickup", "bby-reset-used", "bby-reset-notme", "riot-verify", "riot-receipt",
    "riot-thanks", "riot-code-used", "riot-code-asked", "riot-welcome-receipt", "riot-spoof", "riot-named", "target-code", "pkc-order",
    "fw-code", "fw-pickup", "fw-getting", "fw-signin", "fw-riot-buy", "fw-riot-id"])
    assert.ok(!ids.includes(id), `${id} is kept`);
  for (const id of ["s:fw-pickup", "s:fw-getting", "s:fw-signin", "s:fw-riot-buy", "s:bby-order", "s:target-code"]) assert.ok(!ids.includes(id), `${id} is kept in Spam`);
  for (const id of ["bby-news", "bby-sale", "riot-news", "target-news", "survey"]) assert.ok(ids.includes(id), `${id} still goes`);
});

await test("one row per sender for its codes, numbers hidden, real sender for Hide My Email", async () => {
  server(corpus());
  const { r } = await offered(setup(file));
  const codes = r.groups.filter((g) => /^Login Code/.test(g.subject));
  assert.deepEqual(codes.map((g) => [g.senderAddr, g.subject, g.uids.length]), [[RIOT, "Login Code: ••••••", 3]]);
  const reset = r.groups.filter((g) => /Password Reset/.test(g.subject));
  assert.deepEqual(reset.map((g) => [g.senderAddr, g.uids.length]), [[BBY.toLowerCase(), 2]]);
});

await test("Always keep on the sender keeps them, and the list after Always keep is as it was", async () => {
  server(corpus());
  const api = setup(file); api.getS().settings.cleanKeep = [RIOT];
  const { ids, r } = await offered(api);
  for (const id of ["riot-code-1", "riot-code-2", "riot-code-hme"]) assert.ok(!ids.includes(id), id);
  assert.ok(ids.includes("bby-reset"));
  api.getS().settings.cleanKeep = [];
  r.groups.forEach((g) => assert.equal(typeof g.code, "boolean"));
});

await test("a desktop download older than version 10 (which ignores the rules) gets no second scan", async () => {
  server(corpus());
  const api = setup(file, memStore(), { version: 9 });
  const { ids } = await offered(api);
  assert.equal(SERVER.scans.length, 1);
  assert.ok(!ids.includes("riot-code-1") && !ids.includes("bby-reset"));
});

await test("a second scan that fails, or finds the folder rebuilt, adds nothing and breaks nothing", async () => {
  server(corpus()); const ref = (await offered(setup(BASE))).ids;
  server(corpus());
  let api = setup(file, memStore(), { beforeScan: (cfg) => { if (cfg.rules.surveyFrom === probe.CODE_RULES.surveyFrom) throw new Error("dropped"); } });
  assert.deepEqual((await offered(api)).ids, ref);
  server(corpus());
  api = setup(file, memStore(), { beforeScan: (cfg) => { if (cfg.rules.surveyFrom === probe.CODE_RULES.surveyFrom) SERVER.boxes.INBOX.v = "8"; } });
  assert.deepEqual((await offered(api)).ids, ref);
});

await test("auto-clean moves newsletters at once and leaves the codes an hour after it first sees them", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server(corpus());
  const api = setup(file); swept(api);
  await api.runAutoClean();
  assert.ok(SERVER.moved.includes("bby-news") && SERVER.moved.includes("survey"), "newsletters go now");
  for (const id of ASKED.filter((id) => id !== "riot-welcome-mail")) assert.ok(!SERVER.moved.includes(id), `${id} waits`);
  NOW += 50 * 60000; await api.runAutoClean();
  for (const id of ASKED.filter((id) => id !== "riot-welcome-mail")) assert.ok(!SERVER.moved.includes(id), `${id} still waits at 50 minutes`);
  SERVER.boxes.INBOX.msgs.push(msg("riot-code-late", { name: "Riot Games", address: RIOT, subject: "Login Code: 556677", at: NOW }));
  NOW += 15 * 60000; await api.runAutoClean();
  for (const id of ASKED) assert.ok(SERVER.moved.includes(id), `${id} goes after an hour`);
  assert.ok(!SERVER.moved.includes("riot-code-late"), "one that came later waits its own hour");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "target-code", "riot-verify", "fw-code", "fw-pickup", "riot-code-used"]) assert.ok(!SERVER.moved.includes(id), `${id} stays`);
  NOW += 61 * 60000; await api.runAutoClean();
  assert.ok(SERVER.moved.includes("riot-code-late"));
  const book = JSON.parse(api.store.getItem("orbit-clean-codes") || "{}");
  assert.deepEqual(book, {}, "forgets the ones that went");
  assert.ok(lookedBack().every((d) => d <= 3), `looked back 3 days: ${lookedBack()}`);
});

await test("old codes the first 30-day look-back finds are looked for until they go, then it looks back 3 days", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 101010", at: NOW - 12 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the first run on the inbox: 30 days
  NOW += 20 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  NOW += 45 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["old-code"]);
  assert.ok(lookedBack().every((d) => d >= 29), `30 days while it waited: ${lookedBack()}`);
  SERVER.searches = []; NOW += 10 * 60000; await api.runAutoClean();
  assert.ok(lookedBack().every((d) => d <= 3), "then 3");
});

await test("an old code whose move fails when its hour is up is still looked for, and goes on the next run", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 101011", at: NOW - 12 * DAY })]);
  let fail = false;
  const api = setup(file, memStore(), { failMove: () => fail }); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();
  NOW += 61 * 60000; fail = true; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  assert.ok(/said no/.test(api.getS().settings.autoClean.lastError));
  fail = false; SERVER.searches = []; NOW += 10 * 60000; await api.runAutoClean();
  assert.ok(lookedBack().every((d) => d >= 29), `looked back 30 days for it: ${lookedBack()}`);
  assert.deepEqual(SERVER.moved, ["old-code"]);
});

await test("new codes arriving all the time don't keep auto-clean looking back 30 days", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c0", { name: "Riot Games", address: RIOT, subject: "Login Code: 200000", at: NOW - 5 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the sweep
  let wideRuns = 0;
  for (let i = 1; i <= 24; i++) {
    NOW += 10 * 60000;
    SERVER.boxes.INBOX.msgs.push(msg("c" + i, { name: "Riot Games", address: RIOT, subject: "Login Code: " + (200000 + i), at: NOW }));
    SERVER.searches = []; await api.runAutoClean();
    if (lookedBack().some((d) => d >= 29)) wideRuns++;
  }
  assert.ok(SERVER.moved.includes("c0") && SERVER.moved.includes("c10"));
  assert.ok(wideRuns <= 6, `${wideRuns} of 24 runs looked back 30 days`);
});

await test("a code whose day leaves the 3-day look-back during its hour is still moved", async () => {
  NOW = Date.UTC(2026, 10, 4, 23, 40, 0);
  const edge = Date.UTC(2026, 10, 1, 0, 30, 0);                // the oldest day a 3-day look-back reads at 23:40
  server([msg("edge", { name: "Best Buy", address: BBY, subject: "Your Password Reset verification code", at: edge })]);
  const api = setup(file); swept(api);
  await api.runAutoClean();
  NOW += 40 * 60000; await api.runAutoClean();                 // 00:20: that day is out of a 3-day look-back
  assert.deepEqual(SERVER.moved, []);
  NOW += 30 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["edge"]);
});

await test("a folder rebuilt (new UIDVALIDITY) starts the wait again; storage blocked still waits, in memory", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c1", { name: "Riot Games", address: RIOT, subject: "Login Code: 202020" })]);
  const api = setup(file); swept(api);
  await api.runAutoClean();
  SERVER.boxes.INBOX.v = "8";
  NOW += 61 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, [], "a new UIDVALIDITY: numbers may mean other emails");
  NOW += 61 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["c1"]);

  server([msg("c2", { name: "Best Buy", address: BBY, subject: "Your Password Reset verification code" })]);
  const b = setup(file, blockedStore()); swept(b);
  await b.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  NOW += 61 * 60000; await b.runAutoClean();
  assert.deepEqual(SERVER.moved, ["c2"]);
});

await test("Erase vault during an auto-clean run leaves nothing noted", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c3", { name: "Riot Games", address: RIOT, subject: "Login Code: 303031" })]);
  let release; const gate = new Promise((r) => { release = r; });
  const api = setup(file, memStore(), { beforeScan: () => gate }); swept(api);
  const run = api.runAutoClean();
  api.clearStore();
  release(); await run;
  assert.equal(api.store.getItem("orbit-clean-codes"), null);
});

await test("Clean emails from the phone waits the same hour", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("p1", { name: "Riot Games", address: RIOT, subject: "Login Code: 303030" }),
    msg("p2", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
  const api = setup(file); api.getS().settings.autoClean = { on: false, inboxId: "all", v2: true, folder: "inbox" };
  const r = await api.runAutoClean(true);
  assert.equal(r.moved, 1); assert.deepEqual(SERVER.moved, ["p2"]);
  NOW += 61 * 60000; await api.runAutoClean(true);
  assert.deepEqual(SERVER.moved, ["p2", "p1"]);
});

Date.now = realNow;
console.log(`${passed} passed`);
