// Tests what Clean emails clears in the newest page (index-X.Y.Z.html), from 1.9.134: Riot Games' login codes and welcome
// emails and Best Buy's password reset codes go, and nothing else changes from 1.9.133. Each email goes through the desktop
// app's own scanner (scanPromos in desktop/imap-sync.js, with the page's CLEAN_RULES, against a pretend mail server) and then
// the page's own code: applyCleanSafety, cleanScan (the Clean page's Scan) and runAutoClean, with its hour's wait.
// Sample senders and addresses only.
//   node .github/scripts/clean-rules.test.mjs [path/to/index-X.Y.Z.html]
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
// boxes: {path: {v: uidValidity, msgs: [{uid, name, address, subject, at, bulk, body}]}}
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
  const code = block("// Important mail the cleaner must never offer", "function renderClean(){")
    + block("const FOLDER_NAME = ", "async function cleanTrash(){")
    + block("const autoCleanCfg = ", "function autoCleanHTML(){");
  const prelude = `let S = null; const DESK = true, CAN_CLEAN = true, CAN_CLEAN_SPAM = true, UI = {view:"orders"};
    const CLEAN = { inboxId:"", days:30, folder:"all", busy:"", progress:"", phase:"", result:null, sel:new Set() };
    const toasts = []; const toast = (m) => toasts.push(m); const renderMain = () => {}; const persist = () => {};
    const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const inboxById = (id) => (S.inboxes || []).find(i => i.id === id) || null;`;
  return new Function("window", "localStorage", prelude + code
    + `return {setS: (s) => { S = s; }, getS: () => S, CLEAN, toasts, applyCleanSafety, cleanScan, runAutoClean, CLEAN_RULES,
      has: typeof CLEAN_CODE_FROM !== "undefined"};`);
}
// localStorage that works, or one that throws (a browser that blocks storage).
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const blockedStore = () => ({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });

function setup(path, store = memStore()) {
  const window = { pvDesktop: {
    version: 13,
    scanPromos: (cfg) => imap.scanPromos(Object.assign({ host: "imap.example.com", port: 993 }, cfg)),
    trashPromos: async (cfg, uids, v) => {
      const c = new FakeImap(); const b = await resolve(c, cfg.folder); await c.getMailboxLock(b);
      if (v && String(c.mailbox.uidValidity) !== String(v)) return { ok: false, error: "changed" };
      const r = await c.messageMove(uids, "Trash"); return { ok: true, moved: r.uidMap.size };
    }
  } };
  const api = pageApi(path)(window, store);
  api.setS({ settings: { autoClean: { on: true, inboxId: "all", v2: true, folder: "all" }, cleanKeep: [] }, inboxes: [{ id: "ib1", email: "me@example.com", password: "pw" }] });
  api.store = store;
  return api;
}
const resolve = async (c, folder) => (folder === "spam" ? "Spam" : "INBOX");

let NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const realNow = Date.now;
Date.now = () => NOW;
let nextUid = 1;
const msg = (id, o) => Object.assign({ id, uid: nextUid++, name: "", address: "", subject: "", at: NOW - 3600000, bulk: false, body: "" }, o);
const server = (inbox, spam = []) => { SERVER = { connects: 0, searches: [], moved: [], boxes: { INBOX: { v: "7", msgs: inbox }, Spam: { v: "9", msgs: spam }, Trash: { v: "3", msgs: [] } } }; return SERVER; };

// A mailbox with the three kinds asked for and everything around them that has to stay as it was.
const HME = (local, domain) => `${local}_at_${domain.replace(/\./g, "_")}_abcdefghijkl_mnopqr@icloud.com`;
const corpus = () => [
  // Asked for: these go.
  msg("riot-code-1", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 469078" }),
  msg("riot-code-2", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 112233" }),
  msg("riot-code-hme", { name: "Riot Games", address: HME("noreply", "mail.accounts.riotgames.com"), subject: "Login Code: 908172" }),
  msg("riot-welcome", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Welcome to Riot Games" }),
  msg("riot-welcome-mail", { name: "Riot Games", address: "noreply@mail.riotgames.com", subject: "Welcome to Riot Games" }),   // a newsletter address by the app's test: went before too
  msg("bby-reset", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your Password Reset verification code" }),
  msg("bby-reset-hme", { name: "Best Buy", address: HME("BestBuyInfo", "emailinfo.bestbuy.com"), subject: "Your Password Reset verification code" }),
  // Kept, as before.
  msg("bby-order", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Thanks for your order, Sam!", bulk: true }),
  msg("bby-shipped", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your order has shipped" }),
  msg("bby-signin", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your Best Buy verification code" }),
  msg("bby-pickup", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your order is ready for pickup" }),
  msg("bby-welcome", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Welcome to My Best Buy" }),
  msg("riot-verify", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Verify your email" }),
  msg("riot-receipt", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Your purchase receipt" }),
  // Kept only by the app's own subject check, which it skips for mail it hands back by sender.
  msg("riot-thanks", { name: "Riot Games", address: "news@riotgames.com", subject: "Thanks for your purchase", bulk: true }),
  msg("riot-spoof", { name: "Riot Games", address: "noreply@riot-games-security.example.com", subject: "Login Code: 445566" }),
  msg("riot-fw", { name: "Sam", address: "sam.account1@example.com", subject: "FW: Login Code: 778899",
    body: "---------- Forwarded message ---------\nFrom: Riot Games <noreply@mail.accounts.riotgames.com>\nSubject: Login Code: 778899\n\nYour code" }),
  msg("target-code", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }),
  msg("pkc-order", { name: "Pokémon Center", address: "orders@pokemoncenter.com", subject: "Your Pokémon Center order confirmation" }),
  msg("bby-bulk-review", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "How was your recent visit?", bulk: true }),
  // Cleared, as before.
  msg("bby-news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true }),
  msg("bby-sale", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Flash Sale: 40% off laptops", bulk: true }),
  msg("riot-news", { name: "Riot Games", address: "news@riotgames.com", subject: "This week in Valorant", bulk: true }),
  msg("target-news", { name: "Target", address: "targetnews@em.target.com", subject: "New arrivals for fall", bulk: true }),
  msg("survey", { name: "Target", address: "target@medallia.com", subject: "How was your Target order?" })
];
const ASKED = ["riot-code-1", "riot-code-2", "riot-code-hme", "riot-welcome", "riot-welcome-mail", "bby-reset", "bby-reset-hme"];
const NEW = ASKED.filter((id) => id !== "riot-welcome-mail");
// Mail from those senders with a mailing list's headers only, which the app offered before: the page can't see the headers,
// so it keeps it now.
const KEPT_NOW = ["bby-bulk-review"];

const offered = async (api) => {
  api.CLEAN.folder = "inbox"; api.CLEAN.days = 30;
  await api.cleanScan();
  const r = api.CLEAN.result, ids = [];
  for (const g of r.groups) for (const u of g.uids) { const [f, n] = u.split(":"); const m = SERVER.boxes[f === "spam" ? "Spam" : "INBOX"].msgs.find((x) => String(x.uid) === n); ids.push(m.id); }
  return { ids: ids.sort(), r };
};

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

const probe = setup(file);
if (!probe.has) { console.log(`${file} has no Riot Games and Best Buy code rules to test.`); process.exit(0); }
console.log(`Clean emails in ${file.split(/[\\/]/).pop()}`);

await test("the rules reach the desktop app whole: under its 4000 characters, and its own copy of each compiles to the same", () => {
  const { cleanRules } = imap._clean, R = probe.CLEAN_RULES;
  assert.ok(R.surveyFrom.length < 4000 && R.promoSubject.length < 4000, `surveyFrom is ${R.surveyFrom.length}`);
  const got = cleanRules(R);
  assert.equal(got.surveyFrom.source, new RegExp(R.surveyFrom, "i").source);
  assert.equal(got.promo.source, new RegExp(R.promoSubject, "i").source);
});

await test("Scan offers Riot Games' login codes and welcome email and Best Buy's password reset codes, straight or by Hide My Email", async () => {
  server(corpus());
  const { ids } = await offered(setup(file));
  for (const id of ASKED) assert.ok(ids.includes(id), `${id} should be offered`);
});

await test("everything else is offered or kept as 1.9.133 did, but for mail from those senders with list headers only", async () => {
  if (!existsSync(BASE)) { console.log("       (no index-1.9.133.html to compare with)"); return; }
  server(corpus()); const { ids: now, r: rNow } = await offered(setup(file));
  server(corpus()); const { ids: before, r: rBefore } = await offered(setup(BASE));
  // "N important emails kept safe": the same, but for the five codes asked for that were counted there (not the welcome email,
  // which nothing kept, nor the review the page can't tell from a newsletter, which neither counts).
  assert.equal(rBefore.protectedCount - rNow.protectedCount, 5, `kept safe: ${rBefore.protectedCount} before, ${rNow.protectedCount} now`);
  assert.deepEqual(now.filter((id) => !before.includes(id)).sort(), NEW.slice().sort(), "offered now, not before");
  assert.deepEqual(before.filter((id) => !now.includes(id)).sort(), KEPT_NOW.slice().sort(), "offered before, kept now");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "bby-pickup", "bby-welcome", "riot-verify", "riot-receipt", "riot-thanks", "riot-spoof", "riot-fw", "target-code", "pkc-order"])
    assert.ok(!now.includes(id), `${id} is kept`);
  for (const id of ["bby-news", "bby-sale", "riot-news", "target-news", "survey"]) assert.ok(now.includes(id), `${id} still goes`);
});

await test("one row per sender for its codes, numbers hidden, real sender for Hide My Email", async () => {
  server(corpus());
  const { r } = await offered(setup(file));
  const codes = r.groups.filter((g) => /^Login Code/.test(g.subject));
  assert.deepEqual(codes.map((g) => [g.senderAddr, g.subject, g.uids.length]), [["noreply@mail.accounts.riotgames.com", "Login Code: ••••••", 3]]);
  const reset = r.groups.filter((g) => /Password Reset/.test(g.subject));
  assert.deepEqual(reset.map((g) => [g.senderAddr, g.uids.length]), [["bestbuyinfo@emailinfo.bestbuy.com", 2]]);
});

await test("Always keep on the sender keeps them", async () => {
  server(corpus());
  const api = setup(file); api.getS().settings.cleanKeep = ["noreply@mail.accounts.riotgames.com"];
  const { ids } = await offered(api);
  for (const id of ["riot-code-1", "riot-code-2", "riot-code-hme"]) assert.ok(!ids.includes(id), id);
  assert.ok(ids.includes("bby-reset"));
});

await test("in Spam with Clear all of Spam they go too, and orders and other codes stay", async () => {
  const spam = [
    msg("s-riot", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 135790" }),
    msg("s-bby", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your Password Reset verification code" }),
    msg("s-bby-order", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your order #BBY01-806123456789 has shipped" }),
    msg("s-code", { name: "Shop", address: "no-reply@shop.example.com", subject: "Your verification code is 246810" }),
    msg("s-junk", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "You won't believe this" })
  ];
  server([], spam);
  const api = setup(file); api.CLEAN.folder = "spam"; await api.cleanScan();
  const ids = api.CLEAN.result.groups.flatMap((g) => g.uids.map((u) => spam.find((m) => "spam:" + m.uid === u).id)).sort();
  assert.deepEqual(ids, ["s-bby", "s-junk", "s-riot"]);
});

await test("auto-clean moves newsletters at once and leaves the codes an hour after it first sees them", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server(corpus());
  const api = setup(file);
  api.getS().settings.autoClean.swept = { ib1: true }; api.getS().settings.autoClean.sweptRules = api.CLEAN_RULES.promoSubject + "\n" + api.CLEAN_RULES.surveyFrom + "\n" + "arriv(es|ing|ed)\\b|on\\s+(its|the)\\s+way|\\balerts?\\b";
  await api.runAutoClean();
  assert.ok(SERVER.moved.includes("bby-news") && SERVER.moved.includes("survey"), "newsletters go now");
  for (const id of ASKED) assert.ok(!SERVER.moved.includes(id), `${id} waits`);
  NOW += 50 * 60000; await api.runAutoClean();
  for (const id of ASKED) assert.ok(!SERVER.moved.includes(id), `${id} still waits at 50 minutes`);
  const later = msg("riot-code-late", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 556677", at: NOW });
  SERVER.boxes.INBOX.msgs.push(later);
  NOW += 15 * 60000; await api.runAutoClean();
  for (const id of ASKED) assert.ok(SERVER.moved.includes(id), `${id} goes after an hour`);
  assert.ok(!SERVER.moved.includes("riot-code-late"), "one that came later waits its own hour");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "target-code", "riot-verify", "riot-fw"]) assert.ok(!SERVER.moved.includes(id), `${id} stays`);
  NOW += 61 * 60000; await api.runAutoClean();
  assert.ok(SERVER.moved.includes("riot-code-late"));
  NOW += 10 * 60000; await api.runAutoClean();             // the next scan no longer sees them
  const book = JSON.parse(api.store.getItem("orbit-clean-codes") || "{}");
  assert.deepEqual(Object.keys(book["ib1|inbox"] ? book["ib1|inbox"].at : {}), [], "forgets the ones that went");
});

await test("old codes a 30-day look-back finds are seen again until they go, then it looks back 3 days", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old-code", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 101010", at: NOW - 12 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // first run on the inbox: 30 days
  assert.deepEqual(SERVER.moved, []);
  NOW += 20 * 60000; await api.runAutoClean();
  NOW += 45 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["old-code"]);
  const days = SERVER.searches.map((d) => Math.round((NOW - d.getTime()) / DAY));
  NOW += 10 * 60000; await api.runAutoClean();
  const last = SERVER.searches[SERVER.searches.length - 1];
  assert.ok(days.every((d) => d >= 29), `looked back 30 days while it waited: ${days}`);
  assert.ok(Math.round((NOW - last.getTime()) / DAY) <= 3, "then 3");
});

await test("a folder rebuilt (new UIDVALIDITY) starts the wait again; storage blocked still waits, in memory", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c1", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 202020" })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();
  SERVER.boxes.INBOX.v = "8";
  NOW += 61 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, [], "a new UIDVALIDITY: numbers may mean other emails");
  NOW += 61 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["c1"]);

  server([msg("c2", { name: "Best Buy", address: "BestBuyInfo@emailinfo.bestbuy.com", subject: "Your Password Reset verification code" })]);
  const b = setup(file, blockedStore()); b.getS().settings.autoClean.folder = "inbox";
  await b.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  NOW += 61 * 60000; await b.runAutoClean();
  assert.deepEqual(SERVER.moved, ["c2"]);
});

await test("Clean emails from the phone waits the same hour", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("p1", { name: "Riot Games", address: "noreply@mail.accounts.riotgames.com", subject: "Login Code: 303030" }),
    msg("p2", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
  const api = setup(file); api.getS().settings.autoClean = { on: false, inboxId: "all", v2: true, folder: "inbox" };
  const r = await api.runAutoClean(true);
  assert.equal(r.moved, 1); assert.deepEqual(SERVER.moved, ["p2"]);
});

Date.now = realNow;
console.log(`${passed} passed`);
