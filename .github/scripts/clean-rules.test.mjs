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
// boxes: {path: {v: uidValidity, msgs: [{id, uid, name, address, subject, at, bulk, body}]}}; with SERVER.accounts
// ({email: {boxes}}) each inbox the app signs in to has its own, and an address without one can't sign in.
let SERVER = null;
const DAY = 86400000;
const dayOf = (ms) => Math.floor(ms / DAY);
class FakeImap {
  constructor(opts) {
    this.capabilities = new Map([["MOVE", true]]); this.mailbox = null; this.open = null;
    this.acct = SERVER.accounts ? SERVER.accounts[(opts && opts.auth && opts.auth.user) || ""] : SERVER;
  }
  get boxes() { return this.acct.boxes; }
  async connect() { SERVER.connects++; if (!this.acct) throw Object.assign(new Error("Invalid credentials (Failure)"), { authenticationFailed: true, responseText: "Invalid credentials" }); }
  async logout() {}
  close() {}
  async list() { return Object.keys(this.boxes).map((path) => ({ path, specialUse: /spam/i.test(path) ? "\\Junk" : /trash/i.test(path) ? "\\Trash" : "" })); }
  async getMailboxLock(path) { const b = this.boxes[path]; if (!b) throw new Error("no such box"); this.open = b; this.mailbox = { uidValidity: b.v }; return { release() {} }; }
  // SINCE by UTC date, as imapflow sends it; a server with WITHIN gets YOUNGER, so many seconds back.
  async search(q) { SERVER.searches.push(q.since); return this.open.msgs.filter((m) => SERVER.within ? m.at >= q.since.getTime() : dayOf(m.at) >= dayOf(q.since.getTime())).map((m) => m.uid); }
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
    this.boxes[dest].msgs.push(...moving);
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
  const cs = html.indexOf("function clearStore(){"); assert.ok(cs >= 0, `couldn't find clearStore in ${path}`);
  let ce = html.indexOf("{", cs), depth = 0;
  do { depth += html[ce] === "{" ? 1 : html[ce] === "}" ? -1 : 0; ce++; } while (depth);
  const code = html.slice(cs, ce).replace("function clearStore(){", "function clearStore(){ with (OTHER) {") + "}\n"
    + block("// Important mail the cleaner must never offer", "function renderClean(){")
    + block("const FOLDER_NAME = ", "// Auto-clean: while the vault is unlocked")
    + block("const autoCleanCfg = ", "function autoCleanHTML(){");
  const prelude = `let S = null; const DESK = true, CAN_CLEAN = true, CAN_CLEAN_SPAM = true, UI = {view:"orders"};
    const CLEAN_OLD_APP = !(window.pvDesktop.version >= 10);
    const CLEAN = { inboxId:"", days:30, folder:"all", busy:"", progress:"", phase:"", result:null, sel:new Set() };
    const toasts = []; const toast = (m) => toasts.push(m); const renderMain = () => {}; const persist = () => {};
    const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const inboxById = (id) => (S.inboxes || []).find(i => i.id === id) || null;
    const STUB = new Proxy(function(){}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : STUB, set: () => true, apply: () => STUB, construct: () => STUB });
    const OTHER = new Proxy({}, { has: (t, k) => typeof k === "string" && !["window", "localStorage"].includes(k) && !(k in globalThis) && (() => { try { eval(k); return false; } catch (e) { return true; } })(), get: (t, k) => (k === Symbol.unscopables ? undefined : STUB), set: () => true });
    const confirmDialog = async () => true, document = { getElementById: () => null };
    let premiumMem = null, billMem = null; const STORE_KEY = "pv-vault", AUTO_PIC_STORE = "orbit-autopic", PREMIUM_STORE = "orbit-premium", BILL_STORE = "orbit-billing";`;
  return new Function("window", "localStorage", prelude + code
    + `return {setS: (s) => { S = s; }, getS: () => S, lock: () => { S = null; }, CLEAN, toasts, cleanTrash: typeof cleanTrash === "function" ? cleanTrash : null, applyCleanSafety, cleanScan, runAutoClean, clearStore, CLEAN_RULES,
      KEY: CLEAN_RULES_KEY, CODE_RULES: typeof CLEAN_CODE_RULES !== "undefined" ? CLEAN_CODE_RULES : null};`);
}
// localStorage that works (full: its writes fail, as when storage is full), or one that throws (a browser that blocks storage).
const memStore = () => { const m = new Map(); const st = { full: false, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (st.full) throw new Error("QuotaExceededError"); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), m }; return st; };
const blockedStore = () => ({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });

// hooks: version (the desktop app's), beforeScan(cfg) (may throw or wait), afterScan(cfg), failMove(cfg), beforeMove(cfg).
function setup(path, store = memStore(), hooks = {}) {
  const window = { pvDesktop: {
    version: hooks.version || 13,
    scanPromos: async (cfg) => {
      SERVER.scans.push(cfg); if (hooks.beforeScan) await hooks.beforeScan(cfg);
      const res = await imap.scanPromos(Object.assign({ host: "imap.example.com", port: 993 }, cfg));
      if (hooks.afterScan) await hooks.afterScan(cfg); return res;
    },
    trashPromos: async (cfg, uids, v) => {
      if (hooks.beforeMove) await hooks.beforeMove(cfg);
      if (hooks.failMove && hooks.failMove(cfg)) return { ok: false, error: "The server said no." };
      const c = new FakeImap({ auth: { user: cfg.email } }); await c.getMailboxLock(cfg.folder === "spam" ? "Spam" : "INBOX");
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
// How far back each scan since the last call looked: the codes' scans, and the others.
const isCodeScan = (cfg) => cfg.rules.surveyFrom === probe.CODE_RULES.surveyFrom;
const scanDays = () => { const all = SERVER.scans.splice(0); return { code: all.filter(isCodeScan).map((c) => c.days), other: all.filter((c) => !isCodeScan(c)).map((c) => c.days) }; };

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
  msg(p + "riot-welcome-fw-verify", { name: "Sam", address: "sam.account5@example.com", subject: "FW: Welcome to Riot Games",
    body: fwd("Riot Games <noreply@riotgames.com>", "Welcome to Riot Games", "Verify your email to sign in.") }),
  // The second known gap: a code forwarded under a subject that protects nothing reads like the site's own email.
  msg(p + "fw-code-newsubj", { name: "Sam", address: "sam.account1@example.com", subject: "FW: is this legit?",
    body: fwd(`Riot Games <${RIOT}>`, "Login Code: 778800", "Someone is trying to get into your account") }),
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
  msg(p + "riot-other-name", { name: "Riot Games Support", address: RIOT, subject: "Login Code: 445588" }),
  // Not the site's own name: offered as 1.9.133 offered it (from a newsletter address), at once, not an hour later.
  msg(p + "val-welcome", { name: "VALORANT", address: "noreply@email.riotgames.com", subject: "Welcome to Riot Games" }),
  // Replies from support: the app takes "RE:" off a subject, so they read like the emails asked for.
  msg(p + "bby-reply", { name: "Best Buy", address: "customercare@bestbuy.com", subject: "RE: Your Password Reset verification code" }),
  msg(p + "riot-reply", { name: "Riot Games", address: "support@support.riotgames.com", subject: "Re: Login code" }),
  msg(p + "riot-reply-2", { name: "Riot Games", address: "noreply@support-valorant.riotgames.com", subject: "Re: Login code" }),
  msg(p + "fw-riot-reply", { name: "Sam", address: "sam.account4@example.com", subject: "FW: RE: Welcome to Riot Games",
    body: fwd("Riot Games <help@riotgames.com>", "RE: Welcome to Riot Games", "We reset your password. Sign in again.") }),
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
const ASKED = ["riot-code-1", "riot-code-2", "riot-code-hme", "riot-welcome", "riot-welcome-mail", "riot-welcome-fw", "riot-welcome-fw-verify", "fw-code-newsubj", "bby-reset", "bby-reset-hme"];
// The known gaps, as the codes' scan hands these back like the site's own email: a forwarded welcome, and a code forwarded
// under a subject that protects nothing, go; one the app kept by its opening lines (the welcome) stays in the kept-safe count.
const STILL_COUNTED = ["riot-welcome-fw-verify"];
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
// What to compare with: 1.9.133 for 1.9.134; for a later page, the same page with its codes' scan dropped (its first scan alone).
const IS_134 = /index-1\.9\.134\.html$/.test(file) && existsSync(BASE);
const firstOnly = () => setup(file, memStore(), { beforeScan: (cfg) => { if (isCodeScan(cfg)) throw new Error("no codes' scan"); } });
const reference = () => (IS_134 ? setup(BASE) : firstOnly());

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
  if (IS_134) { server([]); assert.deepEqual(probe.CLEAN_RULES, setup(BASE).CLEAN_RULES); }
  for (const R of [probe.CLEAN_RULES, probe.CODE_RULES]) {
    assert.ok(R.surveyFrom.length < 4000 && R.promoSubject.length < 4000, `surveyFrom is ${R.surveyFrom.length}`);
    const got = cleanRules(R);
    assert.equal(got.surveyFrom.source, new RegExp(R.surveyFrom, "i").source);
    assert.equal(got.promo.source, new RegExp(R.promoSubject, "i").source);
  }
  if (IS_134) { server([]); assert.notEqual(probe.KEY, setup(BASE).KEY, "auto-clean looks back 30 days once"); }
});

await test("Scan offers Riot Games' login codes and welcome email and Best Buy's password reset codes, straight or by Hide My Email", async () => {
  server(corpus());
  const { ids } = await offered(setup(file));
  for (const id of ASKED) assert.ok(ids.includes(id), `${id} should be offered`);
});

for (const folder of ["inbox", "spam", "all"]) {
  await test(`${folder}: everything else is offered or kept as 1.9.133 did, kept-safe count too`, async () => {
    both(); const { ids: now, r: rNow } = await offered(setup(file), folder);
    both(); const { ids: before, r: rBefore } = await offered(reference(), folder);
    assert.deepEqual(before.filter((id) => !now.includes(id)), [], "offered before, kept now");
    const added = now.filter((id) => !before.includes(id));
    assert.deepEqual(added.filter((id) => !ASKED.includes(bare(id))), [], "offered now, not before, and not asked for");
    assert.ok(added.length > 0);
    // Each code newly offered was counted as kept safe before; a welcome email nothing kept wasn't.
    assert.equal(rBefore.protectedCount - rNow.protectedCount, added.filter(isCode).length, `kept safe: ${rBefore.protectedCount} before, ${rNow.protectedCount} now`);
  });
}

await test("each email alone, in the Inbox and in Spam: offered and counted as kept safe as before, but for the ones asked for", async () => {
  const one = async (api, m, folder, keep) => {
    server(folder === "spam" ? [] : [m], folder === "spam" ? [m] : []);
    if (keep) api.getS().settings.cleanKeep = keep;
    const { ids, r } = await offered(api, folder);
    return [ids.length > 0, r.protectedCount];
  };
  const KEEP = [RIOT, "noreply@riotgames.com", "noreply@mail.riotgames.com", BBY.toLowerCase()];
  for (const keep of [null, KEEP]) for (const folder of ["inbox", "spam"]) for (const m0 of corpus()) {
    const m = () => Object.assign({}, m0);
    const [offNow, cntNow] = await one(setup(file), m(), folder, keep);
    const [offBefore, cntBefore] = await one(reference(), m(), folder, keep);
    if (keep) { assert.deepEqual([offNow, cntNow], [offBefore, cntBefore], `${m0.id} in ${folder}, Always keep on: [offered, kept safe] as before`); continue; }
    const where = `${m0.id} in ${folder}`;
    if (ASKED.includes(m0.id)) {
      assert.ok(offNow, `${where} is offered`);
      assert.equal(cntNow, STILL_COUNTED.includes(m0.id) ? cntBefore : 0, `${where}: counted as kept safe`);
    } else {
      assert.deepEqual([offNow, cntNow], [offBefore, cntBefore], `${where}: [offered, kept safe] as before`);
    }
    assert.ok(!(offNow && cntNow) || STILL_COUNTED.includes(m0.id), `${where} is both offered and counted`);
  }
});

await test("forwards, other codes, security notices and lookalike senders are kept", async () => {
  both(); const { ids } = await offered(setup(file), "all");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "bby-pickup", "bby-reset-used", "bby-reset-notme", "riot-verify", "riot-receipt",
    "riot-thanks", "riot-code-used", "riot-code-asked", "riot-welcome-receipt", "riot-spoof", "riot-named", "riot-other-name", "bby-reply",
    "riot-reply", "riot-reply-2", "fw-riot-reply", "target-code", "pkc-order",
    "fw-code", "fw-pickup", "fw-getting", "fw-signin", "fw-riot-buy", "fw-riot-id"])
    assert.ok(!ids.includes(id), `${id} is kept`);
  for (const id of ["s:fw-pickup", "s:fw-getting", "s:fw-signin", "s:fw-riot-buy", "s:bby-order", "s:target-code"]) assert.ok(!ids.includes(id), `${id} is kept in Spam`);
  for (const id of ["bby-news", "bby-sale", "riot-news", "target-news", "survey"]) assert.ok(ids.includes(id), `${id} still goes`);
});

await test("one row per sender for its codes, numbers hidden, real sender for Hide My Email", async () => {
  server(corpus());
  const { r } = await offered(setup(file));
  const codes = r.groups.filter((g) => /^Login Code/.test(g.subject));
  assert.deepEqual(codes.map((g) => [g.senderAddr, g.subject, g.uids.length]), [[RIOT, "Login Code: ••••••", 4]], "three codes, and the one forwarded under a new subject");
  const reset = r.groups.filter((g) => /Password Reset/.test(g.subject));
  assert.deepEqual(reset.map((g) => [g.senderAddr, g.uids.length]), [[BBY.toLowerCase(), 2]]);
});

await test("Always keep on the sender keeps them, and the list after Always keep is as it was", async () => {
  server(corpus());
  const all = (await offered(setup(file))).ids;
  server(corpus());
  const api = setup(file); api.getS().settings.cleanKeep = [RIOT];
  const { ids } = await offered(api);
  assert.deepEqual(ids, all.filter((id) => !["riot-code-1", "riot-code-2", "riot-code-hme", "fw-code-newsubj"].includes(id)));
});

await test("a desktop download older than version 10 (which ignores the rules) gets no second scan", async () => {
  server(corpus());
  const api = setup(file, memStore(), { version: 9 });
  const { ids } = await offered(api);
  assert.equal(SERVER.scans.length, 1);
  assert.ok(!ids.includes("riot-code-1") && !ids.includes("bby-reset"));
});

await test("a second scan that fails, or finds the folder rebuilt, adds nothing and breaks nothing", async () => {
  server(corpus()); const ref = (await offered(reference())).ids;
  server(corpus());
  let api = setup(file, memStore(), { beforeScan: (cfg) => { if (cfg.rules.surveyFrom === probe.CODE_RULES.surveyFrom) throw new Error("dropped"); } });
  assert.deepEqual((await offered(api)).ids, ref);
  server(corpus());
  api = setup(file, memStore(), { beforeScan: (cfg) => { if (!isCodeScan(cfg)) SERVER.boxes.INBOX.v = "8"; } });
  assert.deepEqual((await offered(api)).ids, ref);
});

for (const folder of ["inbox", "spam", "all"]) {
  await test(`${folder}: auto-clean moves everything else as 1.9.133 did, and the ones asked for an hour later`, async () => {
    const KEEP = [RIOT, "noreply@riotgames.com", BBY.toLowerCase()];
    for (const sweep of [false, true]) for (const keep of [null, KEEP]) for (const spamAll of [true, false]) {
      const run = async (api) => {
        NOW = Date.UTC(2026, 10, 4, 15, 0, 0); both();
        const st = api.getS().settings; st.cleanSpamAll = spamAll; if (keep) st.cleanKeep = keep;
        if (sweep) st.autoClean.folder = folder; else swept(api, folder);
        await api.runAutoClean(); const first = SERVER.moved.slice().sort();
        NOW += 61 * 60000; await api.runAutoClean();
        return { first, hour: SERVER.moved.slice().sort() };
      };
      const now = await run(setup(file)), before = await run(reference());
      const where = `${folder}, ${sweep ? "first 30-day look-back" : "swept"}, Always keep ${keep ? "on" : "off"}, Clear all of Spam ${spamAll ? "on" : "off"}`;
      assert.deepEqual(now.first, before.first.filter((id) => !ASKED.includes(bare(id))), `${where}: moved at once`);
      const added = now.hour.filter((id) => !before.hour.includes(id));
      assert.deepEqual(before.hour.filter((id) => !now.hour.includes(id)), [], `${where}: moved before, kept now`);
      assert.deepEqual(added.filter((id) => !ASKED.includes(bare(id))), [], `${where}: moved after the hour, not asked for`);
      if (!keep) assert.ok(added.length > 0, `${where}: the ones asked for go after the hour`);
    }
  });
}

await test("at the app's 3000 emails a scan, a code the other scan didn't read takes nothing else off the kept-safe count", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  const box = [msg("old-code4", { name: "Riot Games", address: RIOT, subject: "Login Code: 939393", at: NOW - 5 * DAY })];
  for (let i = 0; i < 2998; i++) box.push(msg("note" + i, { name: "Sam", address: "sam@example.com", subject: "Note " + i, at: NOW - 4 * DAY }));
  box.push(msg("t-code3", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }));
  server(box);
  let calls = 0;
  // One more email comes between the two scans, so the other scan's newest 3000 leave out the oldest, the code.
  const api = setup(file, memStore(), { beforeScan: () => { if (++calls === 2) SERVER.boxes.INBOX.msgs.push(msg("late2", { name: "Sam", address: "sam@example.com", subject: "Late" })); } });
  const { ids, r } = await offered(api);
  assert.ok(ids.includes("old-code4"), "the code the codes' scan found still goes");
  assert.equal(r.protectedCount, 1, "the Target code is still counted");
});

for (const [name, hook] of [
  ["midnight during the other scan", (calls) => { if (calls === 2) NOW += 2000; }],
  ["the codes' scan after the other one failing", (calls) => { if (calls === 3) throw new Error("dropped"); }],
  ["midnight during the codes' scan after the other one", (calls) => { if (calls === 3) NOW += 2000; }]]) {
  await test(`${name}: no codes this time, and the kept-safe count as before`, async () => {
    const mk = () => [msg("t-code4", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }),
      msg("r-code4", { name: "Riot Games", address: RIOT, subject: "Login Code: 949494" })];
    NOW = Date.UTC(2026, 10, 4, 12, 0, 0); server(mk()); const ref = await offered(reference());
    NOW = Date.UTC(2026, 10, 4, 23, 59, 59); server(mk());
    let calls = 0;
    const api = setup(file, memStore(), { beforeScan: () => hook(++calls) });
    const { ids, r } = await offered(api);
    assert.deepEqual([ids, r.protectedCount], [ref.ids, ref.r.protectedCount]);
  });
}

await test("a server that looks back exact seconds (WITHIN): a code that ages out of the 3 days during its hour still goes", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("aging", { name: "Riot Games", address: RIOT, subject: "Login Code: 979797", at: NOW - 71.5 * 3600000 })]);
  SERVER.within = true;
  const api = setup(file); swept(api);
  for (let i = 0; i < 9; i++){ await api.runAutoClean(); NOW += 10 * 60000; }
  assert.deepEqual(SERVER.moved, ["aging"]);
});

await test("a server that looks back exact seconds: a code at the edge that only the first scan read takes nothing else off the count", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("t-code5", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }),
    msg("edge5", { name: "Riot Games", address: RIOT, subject: "Login Code: 989898", at: NOW - 30 * DAY + 2000 })]);
  SERVER.within = true;
  let calls = 0;
  const api = setup(file, memStore(), { afterScan: () => { if (++calls === 1) NOW += 5000; } });   // the other scan's 30 days start 5 s later
  const { ids, r } = await offered(api);
  assert.ok(ids.includes("edge5"));
  assert.equal(r.protectedCount, 1, "the Target code is still counted");
});

await test("a reply or forward under another name from the same address and subject isn't taken with the site's own", async () => {
  const mk = () => [msg("own-welcome", { name: "Riot Games", address: "noreply@riotgames.com", subject: "Welcome to Riot Games", at: NOW - 2 * DAY }),
    msg("ps-reply", { name: "Riot Games Player Support", address: "noreply@riotgames.com", subject: "RE: Welcome to Riot Games" }),
    msg("ps-fw", { name: "Sam", address: "sam.account2@example.com", subject: "FW: RE: Welcome to Riot Games",
      body: fwd("Riot Games Player Support <noreply@riotgames.com>", "RE: Welcome to Riot Games", "We reset your password. Sign in again.") }),
    msg("val-code", { name: "VALORANT", address: RIOT, subject: "Login Code: 908172" }),
    msg("own-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 908172", at: NOW + 1000 })];
  for (const folder of ["inbox", "spam"]) {
    const put = (m) => folder === "spam" ? server([], m) : server(m);
    put(mk()); const ref = await offered(reference(), folder);
    put(mk()); const now = await offered(setup(file), folder);
    const own = (id) => id === "own-welcome" || id === "own-code";
    assert.deepEqual(now.ids.filter((id) => !own(id)), ref.ids.filter((id) => !own(id)), `${folder}: the others as before`);
    assert.ok(now.ids.includes("own-welcome") && now.ids.includes("own-code"), `${folder}: Riot Games' own go`);
  }
});

await test("a manual Scan the vault locks during offers nothing", async () => {
  server([msg("kept-news2", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
  let api, calls = 0;
  api = setup(file, memStore(), { beforeScan: () => { if (++calls === 1) api.lock(); } });
  api.getS().settings.cleanKeep = ["bestbuy@email.bestbuy.com"];
  const vault = api.getS();
  api.CLEAN.folder = "inbox"; await api.cleanScan();
  api.setS(vault);
  assert.equal(api.CLEAN.result, null);
});

await test("an old code first seen by a later 31-day run (the folder rebuilt) still goes", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old5", { name: "Riot Games", address: RIOT, subject: "Login Code: 959595", at: NOW - 12 * DAY }),
    msg("old6", { name: "Riot Games", address: RIOT, subject: "Login Code: 969696", at: NOW - 8 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the first 30-day look-back notes both
  NOW += 10 * 60000; await api.runAutoClean();                 // 3 days: neither there, so both looked for
  SERVER.boxes.INBOX.v = "8";                                  // rebuilt: what was noted is no use
  for (let i = 0; i < 12; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
  assert.deepEqual(SERVER.moved.slice().sort(), ["old5", "old6"]);
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
  const d = scanDays();
  assert.ok(d.code.every((n) => n === 3) && d.other.every((n) => n === 3), `looked back 3 days: ${JSON.stringify(d)}`);
});

await test("old codes the first 30-day look-back finds are looked for until they go, then it looks back 3 days", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 101010", at: NOW - 12 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the first run on the inbox: 30 days
  NOW += 20 * 60000; await api.runAutoClean();                 // 3 days: not there, so looked for
  assert.deepEqual(SERVER.moved, []);
  NOW += 45 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["old-code"]);
  assert.deepEqual(scanDays(), { code: [31, 3, 31], other: [30, 3, 3] }, "only the codes' scan looks back 31 days for it");
  NOW += 10 * 60000; await api.runAutoClean();
  assert.deepEqual(scanDays(), { code: [3], other: [3] }, "then 3");
});

await test("an old code whose move fails when its hour is up is still looked for, and goes on the next run", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 101011", at: NOW - 12 * DAY })]);
  let fail = false;
  const api = setup(file, memStore(), { failMove: () => fail }); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();
  NOW += 10 * 60000; await api.runAutoClean();
  NOW += 51 * 60000; fail = true; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  assert.ok(/said no/.test(api.getS().settings.autoClean.lastError));
  fail = false; scanDays(); NOW += 10 * 60000; await api.runAutoClean();
  assert.deepEqual(scanDays().code, [31], "still looked for");
  assert.deepEqual(SERVER.moved, ["old-code"]);
});

await test("new codes arriving all the time don't keep auto-clean looking back 30 days", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c0", { name: "Riot Games", address: RIOT, subject: "Login Code: 200000", at: NOW - 5 * DAY })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the sweep
  scanDays();
  let wideRuns = 0;
  for (let i = 1; i <= 24; i++) {
    NOW += 10 * 60000;
    SERVER.boxes.INBOX.msgs.push(msg("c" + i, { name: "Riot Games", address: RIOT, subject: "Login Code: " + (200000 + i), at: NOW }));
    await api.runAutoClean();
    const d = scanDays();
    assert.deepEqual(d.other, [3], "the other scan keeps 1.9.133's 3 days");
    if (d.code[0] > 3) wideRuns++;
  }
  assert.ok(SERVER.moved.includes("c0") && SERVER.moved.includes("c10"));
  assert.ok(wideRuns <= 6, `${wideRuns} of 24 runs' codes' scans looked back further than 3 days`);
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

await test("a codes' scan that fails during the first 30-day look-back loses nothing: it's done again", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old2", { name: "Riot Games", address: RIOT, subject: "Login Code: 404040", at: NOW - 12 * DAY })]);
  let fail = true;
  const api = setup(file, memStore(), { beforeScan: (cfg) => { if (fail && isCodeScan(cfg)) throw new Error("dropped"); } }); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();
  fail = false;
  for (let i = 0; i < 8; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
  assert.deepEqual(SERVER.moved, ["old2"]);
});

await test("a codes' scan that fails while an old code is looked for keeps what was noted", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("old3", { name: "Riot Games", address: RIOT, subject: "Login Code: 414141", at: NOW - 12 * DAY })]);
  let fail = false;
  const api = setup(file, memStore(), { beforeScan: (cfg) => { if (fail && isCodeScan(cfg)) throw new Error("dropped"); } }); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // the first 30-day look-back notes it
  NOW += 10 * 60000; await api.runAutoClean();                 // 3 days: not there, so looked for
  NOW += 10 * 60000; fail = true; await api.runAutoClean();    // looked for, but the codes' scan fails
  fail = false;
  for (let i = 0; i < 6; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
  assert.deepEqual(SERVER.moved, ["old3"]);
});

await test("a code noted while storage still worked goes once storage is full", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("c5", { name: "Riot Games", address: RIOT, subject: "Login Code: 505050" })]);
  const api = setup(file); swept(api);
  await api.runAutoClean();
  api.store.full = true;
  SERVER.boxes.INBOX.msgs.push(msg("c6", { name: "Riot Games", address: RIOT, subject: "Login Code: 606060", at: NOW }));
  NOW += 20 * 60000; await api.runAutoClean();
  NOW += 45 * 60000; await api.runAutoClean();
  NOW += 20 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["c5", "c6"]);
});

await test("locking during an auto-clean run moves nothing (its Always keep and Clear all of Spam can't be read)", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("kept-news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
  let api, calls = 0;
  api = setup(file, memStore(), { beforeScan: () => { if (++calls === 2) api.lock(); } });
  api.getS().settings.cleanKeep = ["bestbuy@email.bestbuy.com"]; swept(api);
  await api.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
});

await test("a code that arrives between the two scans takes nothing else off the kept-safe count", async () => {
  server([msg("t-code", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" })]);
  let calls = 0;
  const api = setup(file, memStore(), { beforeScan: () => { if (++calls === 2) SERVER.boxes.INBOX.msgs.push(msg("late", { name: "Riot Games", address: RIOT, subject: "Login Code: 707070" })); } });
  const { ids, r } = await offered(api);
  assert.ok(r.protectedCount >= 1, `the Target code is still counted: ${r.protectedCount}`);
  assert.equal(r.protectedCount, 1 + (ids.includes("late") ? 0 : 1));
});

await test("a code deleted before its hour costs one look a little further back, then is forgotten", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("del", { name: "Riot Games", address: RIOT, subject: "Login Code: 818181" })]);
  const api = setup(file); swept(api);
  await api.runAutoClean();
  SERVER.boxes.INBOX.msgs = [];                                // read and deleted by hand
  scanDays();
  for (let i = 0; i < 3; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
  assert.deepEqual(scanDays(), { code: [3, 5, 3], other: [3, 3, 3] }, "as far as it could be old by then, not 31 days");
  assert.deepEqual(JSON.parse(api.store.getItem("orbit-clean-codes")), {});
});

await test("two computers cleaning one mailbox: the codes the other one moves don't keep the codes' scan looking far back", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([]);
  const a = setup(file), b = setup(file); swept(a); swept(b);
  const longest = { a: 0, b: 0 };
  for (let i = 0; i < 36; i++) {
    if (i % 2 === 0) SERVER.boxes.INBOX.msgs.push(msg("c2-" + i, { name: "Riot Games", address: RIOT, subject: "Login Code: " + (300000 + i), at: NOW }));
    for (const [n, api] of [["a", a], ["b", b]]) { scanDays(); await api.runAutoClean(); longest[n] = Math.max(longest[n], ...scanDays().code); NOW += 5 * 60000; }
  }
  assert.ok(longest.a <= 5 && longest.b <= 5, `codes' scans looked back at most ${JSON.stringify(longest)} days`);
  assert.ok(SERVER.moved.length >= 14, `${SERVER.moved.length} moved`);
});

await test("an email left in a group the codes were taken out of goes as it did in 1.9.133", async () => {
  const alias = HME("noreply", "mail.riotgames.com");
  const mk = () => [msg("own-w", { name: "Riot Games", address: alias, subject: "Welcome to Riot Games", at: NOW - 10 * DAY }),
    msg("ps-r", { name: "Riot Games Player Support", address: alias, subject: "RE: Welcome to Riot Games", at: NOW - 9 * DAY })];
  const run = async (api) => {
    NOW = Date.UTC(2026, 10, 4, 15, 0, 0); server(mk()); api.getS().settings.autoClean.folder = "inbox";
    await api.runAutoClean(); const first = SERVER.moved.slice();
    for (let i = 0; i < 9; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
    return { first, all: SERVER.moved.slice().sort() };
  };
  // 1.9.133 itself: the page's own scan without the codes' one holds code-like emails on purpose (r.codesMissed).
  const before = await run(existsSync(BASE) ? setup(BASE) : reference()), now = await run(setup(file));
  assert.ok(before.first.includes("ps-r"));
  assert.ok(now.first.includes("ps-r"), "the reply goes on the first run, as before");
  assert.deepEqual(now.all, ["own-w", "ps-r"]);
});

await test("a code on the oldest day of the first 30-day look-back still goes when midnight passes during its hour", async () => {
  NOW = Date.UTC(2026, 10, 4, 23, 30, 0);
  server([msg("old30", { name: "Riot Games", address: RIOT, subject: "Login Code: 919191", at: Date.UTC(2026, 9, 5, 1, 0, 0) })]);
  const api = setup(file); api.getS().settings.autoClean.folder = "inbox";
  await api.runAutoClean();                                   // 23:30: 30 days reach back to Oct 5
  for (let i = 0; i < 9; i++){ NOW += 10 * 60000; await api.runAutoClean(); }
  assert.deepEqual(SERVER.moved, ["old30"]);
});

await test("scans either side of midnight take nothing else off the kept-safe count", async () => {
  NOW = Date.UTC(2026, 10, 4, 23, 59, 59);
  server([msg("t-code2", { name: "Target", address: "Target@oe.target.com", subject: "Your Target.com sign-in code: 123456" }),
    msg("edge-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 929292", at: Date.UTC(2026, 9, 5, 12, 0, 0) })]);
  let calls = 0;
  const api = setup(file, memStore(), { afterScan: () => { if (++calls === 1) NOW += 2000; } });   // the other scan starts on Nov 5
  const { ids, r } = await offered(api);
  assert.ok(ids.includes("edge-code"), "the code the codes' scan found still goes");
  assert.equal(r.protectedCount, 1, "the Target code is still counted");
});

await test("a 'Welcome to Riot Games' the codes' scan missed waits its hour too", async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server([msg("w-mail", { name: "Riot Games", address: "noreply@mail.riotgames.com", subject: "Welcome to Riot Games" })]);
  let fail = true;
  const api = setup(file, memStore(), { beforeScan: (cfg) => { if (fail && isCodeScan(cfg)) throw new Error("dropped"); } }); swept(api);
  await api.runAutoClean();
  assert.deepEqual(SERVER.moved, [], "not at once");
  fail = false;
  NOW += 10 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, []);
  NOW += 61 * 60000; await api.runAutoClean();
  assert.deepEqual(SERVER.moved, ["w-mail"]);
});

await test("Clean emails from the phone: locked and unlocked during the run, its request waits for the next check", async () => {
  server([msg("p3", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
  let api, calls = 0;
  api = setup(file, memStore(), { beforeScan: () => { if (++calls === 1) api.setS(Object.assign({}, api.getS())); } });
  api.getS().settings.autoClean = { on: false, inboxId: "all", v2: true, folder: "inbox" };
  assert.deepEqual(await api.runAutoClean(true), { busy: true });
  assert.deepEqual(SERVER.moved, []);
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

// ---- All inboxes on the Clean page (1.9.135) ----
const EMAILS = ["one@example.com", "two@example.com", "three@example.com"];
const acct = (inbox, spam = []) => ({ boxes: { INBOX: { v: "7", msgs: inbox }, Spam: { v: "9", msgs: spam }, Trash: { v: "3", msgs: [] } } });
const multi = (accounts) => { SERVER = { connects: 0, searches: [], scans: [], moved: [], accounts }; return SERVER; };
const withInboxes = (api, emails = EMAILS) => { api.getS().inboxes = emails.map((e) => ({ id: "ib-" + e.split("@")[0], email: e, password: "pw" })); api.CLEAN.inboxId = ""; return api; };
const allMsgs = () => Object.values(SERVER.accounts).flatMap((a) => Object.values(a.boxes).flatMap((b) => b.msgs));
const offeredMulti = async (api, folder) => {
  api.CLEAN.folder = folder; api.CLEAN.days = 30;
  await api.cleanScan();
  const r = api.CLEAN.result, msgs = allMsgs();
  return { r, ids: r ? r.groups.flatMap((g) => g.uids.map((u) => msgs.find((m) => String(m.uid) === u.slice(u.lastIndexOf(":") + 1)).id)).sort() : [] };
};
const HAS_ALL = /const CLEAN_ALL = "all"/.test(readFileSync(file, "utf8"));
if (!HAS_ALL && !process.argv[2]) assert.fail(`${file} has no CLEAN_ALL: the Clean page's All inboxes is gone (update this test if that's on purpose)`);
if (HAS_ALL) {
  await test("All inboxes: the Scan's choice to start with; it offers and keeps what each inbox's own Scan does, one row per sender", async () => {
    for (const folder of ["inbox", "spam", "all"]) {
      const mk = () => Object.fromEntries(EMAILS.map((e, i) => { const p = "abc"[i] + ":"; return [e, folder === "inbox" ? acct(corpus(p)) : folder === "spam" ? acct([], corpus(p)) : acct(corpus(p), corpus("s" + p))]; }));
      let union = [], kept = 0;
      for (const e of EMAILS) { multi(mk()); const one = await offeredMulti(withInboxes(setup(file), [e]), folder); union = union.concat(one.ids); kept += one.r.protectedCount; assert.equal(one.r.all, false); }
      multi(mk());
      const api = withInboxes(setup(file)), { ids, r } = await offeredMulti(api, folder);
      assert.equal(r.all, true, "All inboxes to start with");
      assert.deepEqual(r.inboxes.length, 3);
      assert.deepEqual(ids, union.sort(), `${folder}: what each inbox's own Scan offers`);
      assert.equal(r.protectedCount, kept, `${folder}: kept safe, all of them`);
      const news = r.groups.filter((g) => g.subject === "Top deals of the week");
      assert.equal(news.length, 1, "one row for a sender across the inboxes");
      assert.equal(Object.keys(news[0].parts).filter((k) => k.includes("|")).length, folder === "all" ? 6 : 3);
      const codes = r.groups.filter((g) => g.code && /^Login Code/.test(g.subject));
      assert.equal(codes.length, 1, "one row for Riot's codes across the inboxes");
      assert.equal(new Set(Object.keys(codes[0].parts).map((k) => k.split("|")[0])).size, 3);
    }
  });

  await test("All inboxes: Move to Trash moves each inbox's own, and what's kept stays in each", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"))])));
    const api = withInboxes(setup(file)), { ids } = await offeredMulti(api, "inbox");
    await api.cleanTrash();
    assert.deepEqual(SERVER.moved.slice().sort(), ids);
    for (const [i, e] of EMAILS.entries()) {
      const left = SERVER.accounts[e].boxes.INBOX.msgs.map((m) => m.id), gone = SERVER.accounts[e].boxes.Trash.msgs.map((m) => m.id);
      assert.ok(gone.includes("abc"[i] + ":bby-news") && left.includes("abc"[i] + ":bby-order"), `${e}: its own newsletter went, its order stayed`);
    }
    assert.deepEqual(api.CLEAN.result.groups, [], "nothing left to clear");
  });

  await test("All inboxes: one that can't be checked is named, and the others are scanned", async () => {
    multi({ [EMAILS[0]]: acct(corpus("a:")), [EMAILS[1]]: acct(corpus("b:")) });     // three@ can't sign in
    const api = withInboxes(setup(file)), { ids, r } = await offeredMulti(api, "inbox");
    assert.deepEqual(r.failed.map((f) => f.email), [EMAILS[2]]);
    assert.ok(ids.includes("a:bby-news") && ids.includes("b:bby-news"));
    assert.ok(api.toasts.some((t) => /three@example\.com/.test(t)));
  });

  await test("All inboxes: a sender in one inbox's Inbox and another's Spam is kept in the first and offered from the second, as each one's own Scan has it", async () => {
    const news = (p, subject, address) => msg(p + subject.slice(0, 6), { name: "Shop", address, subject, bulk: true });
    const SUBJ = [["Your ticket to savings: 30% off everything", "news@shop.example.com"], ["Back to school deals are here", "targetnews@em.target.com"]];
    for (const spamAll of [true, false]) {
      const mk = () => ({
        [EMAILS[0]]: acct(SUBJ.map(([t, a]) => news("a:", t, a))),
        [EMAILS[1]]: acct([], SUBJ.map(([t, a]) => news("b:", t, a))),
        [EMAILS[2]]: acct(SUBJ.map(([t, a]) => news("c:", t, a)), SUBJ.map(([t, a]) => news("d:", t, a))),
      });
      let union = [], kept = 0;
      for (const e of EMAILS) {
        multi(mk()); const api = withInboxes(setup(file), [e]); api.getS().settings.cleanSpamAll = spamAll;
        const one = await offeredMulti(api, "all"); union = union.concat(one.ids); kept += one.r.protectedCount;
      }
      multi(mk());
      const api = withInboxes(setup(file)); api.getS().settings.cleanSpamAll = spamAll;
      const { ids, r } = await offeredMulti(api, "all");
      if (spamAll) assert.ok(union.some((id) => id.startsWith("b:")), "two@'s own Scan offers its Spam copies");
      assert.deepEqual(ids, union.sort(), `Clear all of Spam ${spamAll ? "on" : "off"}: what each inbox's own Scan offers`);
      assert.equal(r.protectedCount, kept, "and keeps");
      assert.equal(r.total, ids.length);
      // Always keep afterwards hides the whole row, every inbox's.
      api.getS().settings.cleanKeep = SUBJ.map(([, a]) => a);
      api.applyCleanSafety(r);
      assert.deepEqual(r.groups.filter((g) => SUBJ.some(([, a]) => a === g.senderAddr)), []);
    }
  });

  await test("All inboxes: an inbox whose Spam couldn't be checked after its Inbox was says so, and its Inbox is offered", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"), corpus("s" + "abc"[i] + ":"))])));
    const api = withInboxes(setup(file, memStore(), { beforeScan: (cfg) => { if (cfg.email === EMAILS[0] && cfg.folder === "spam") throw new Error("dropped"); } }));
    const { ids, r } = await offeredMulti(api, "all");
    assert.deepEqual(r.failed.map((f) => [f.email, f.folder]), [[EMAILS[0], "spam"]]);
    assert.ok(ids.includes("a:bby-news") && !ids.includes("sa:bby-news"), "its Inbox, not its Spam");
    assert.ok(api.toasts.some((t) => t.includes(EMAILS[0] + "'s Spam") && t.includes("The rest was scanned")), api.toasts.join(" | "));
  });

  await test("All inboxes: when none can be checked, every one is named", async () => {
    multi({});
    const api = withInboxes(setup(file)), { r } = await offeredMulti(api, "inbox");
    assert.equal(r, null);
    assert.equal(api.CLEAN.busy, "");
    const t = api.toasts.join(" | ");
    assert.ok(EMAILS.every((e) => t.includes(e)), t);
  });

  await test("Move to Trash uses each inbox's own UIDVALIDITY, and goes on to the next inbox when one fails", async () => {
    const mk = () => Object.fromEntries(EMAILS.map((e, i) => { const a = acct(corpus("abc"[i] + ":")); a.boxes.INBOX.v = "1" + i; return [e, a]; }));
    multi(mk());
    let api = withInboxes(setup(file)), { ids } = await offeredMulti(api, "inbox");
    await api.cleanTrash();
    assert.deepEqual(SERVER.moved.slice().sort(), ids, "each inbox's own");
    multi(mk());
    api = withInboxes(setup(file, memStore(), { failMove: (cfg) => cfg.email === EMAILS[1] }));
    ({ ids } = await offeredMulti(api, "inbox"));
    await api.cleanTrash();
    assert.deepEqual(SERVER.moved.slice().sort(), ids.filter((id) => !id.startsWith("b:")), "the others' moved");
    assert.ok(api.toasts.some((t) => /but not all/.test(t) && t.includes(EMAILS[1])), api.toasts.join(" | "));
    assert.ok(api.CLEAN.result.groups.length > 0 && api.CLEAN.result.groups.every((g) => Object.keys(g.parts).every((k) => k.startsWith("ib-two|"))), "two@'s still offered");
    assert.equal(api.CLEAN.busy, "");
  });

  await test("Locking while emails move to Trash stops there, with nothing left busy (all inboxes, or one on Inbox and Spam)", async () => {
    for (const all of [true, false]) {
      multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"), corpus("s" + "abc"[i] + ":"))])));
      let moves = 0;
      const api = withInboxes(setup(file, memStore(), { beforeMove: () => { if (++moves === 1) api.lock(); } }));
      if (!all) api.CLEAN.inboxId = "ib-one";
      const { r } = await offeredMulti(api, "all");
      assert.ok(Object.keys(r.uidValidity).length >= 2);
      await api.cleanTrash();
      assert.equal(moves, 1, "nothing more moved once locked");
      assert.equal(api.CLEAN.busy, "");
      assert.equal(api.CLEAN.progress, "");
      assert.equal(api.CLEAN.result, null, "scan again after unlocking");
    }
  });

  await test("Picking one inbox scans only that one", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"))])));
    const api = withInboxes(setup(file)); api.CLEAN.inboxId = "ib-two";
    const { ids, r } = await offeredMulti(api, "inbox");
    assert.equal(r.all, false);
    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith("b:")));
  });
}

Date.now = realNow;
console.log(`${passed} passed`);
