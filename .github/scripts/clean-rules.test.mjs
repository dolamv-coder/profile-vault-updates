// Tests what Clean emails clears in the newest page (index-X.Y.Z.html), from 1.9.134: Riot Games' login codes and welcome
// emails and Best Buy's password reset codes go (and from 1.9.140 Target's sign-in and password reset codes), and nothing else
// changes from 1.9.133, in the Inbox, in Spam and both (from 1.9.141 auto-clean moves Target's on its first run, the others an
// hour after it first sees them). Each
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
  async search(q) {
    // By UID (Find in Spam's move checks which are still there), or SINCE.
    if (q.uid) { const want = String(q.uid).split(",").map(Number); return this.open.msgs.filter((m) => want.includes(m.uid)).map((m) => m.uid); }
    SERVER.searches.push(q.since); return this.open.msgs.filter((m) => SERVER.within ? m.at >= q.since.getTime() : dayOf(m.at) >= dayOf(q.since.getTime())).map((m) => m.uid);
  }
  async *fetch(uids, query) {
    for (const m of this.open.msgs.filter((x) => uids.includes(x.uid))) {
      const envelope = { subject: m.subject, from: [{ name: m.name, address: m.address }] };
      if (query.source) yield { uid: m.uid, envelope, source: Buffer.from(m.body || "") };
      else if ((query.headers || []).includes("authentication-results")) yield { uid: m.uid, envelope, internalDate: new Date(m.at), headers: Buffer.from(m.auth || "") };
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
    + block("const autoCleanCfg = ", "function autoCleanHTML(){")
    + block("const norm = ", "\n") + "\n" + block("function syncHash(str){", "\n}\n") + "\n}\n" + block("function mailboxKey(email){", "\n}\n") + "\n}\n";
  const prelude = `let S = null; const DESK = true, CAN_CLEAN = true, CAN_CLEAN_SPAM = true, UI = {view:"orders"};
    const CLEAN_OLD_APP = !(window.pvDesktop.version >= 10);
    const CLEAN = { inboxId:"", days:30, folder:"all", busy:"", progress:"", phase:"", result:null, sel:new Set() };
    const toasts = []; const toast = (m) => toasts.push(m); const renderMain = () => {}; const persist = () => {};
    const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const inboxById = (id) => (S.inboxes || []).find(i => i.id === id) || null;
    const SYNCING = new Map();
    const STUB = new Proxy(function(){}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : STUB, set: () => true, apply: () => STUB, construct: () => STUB });
    const OTHER = new Proxy({}, { has: (t, k) => typeof k === "string" && !["window", "localStorage"].includes(k) && !(k in globalThis) && (() => { try { eval(k); return false; } catch (e) { return true; } })(), get: (t, k) => (k === Symbol.unscopables ? undefined : STUB), set: () => true });
    const confirmDialog = async () => true, document = { getElementById: () => null };
    let premiumMem = null, billMem = null; const STORE_KEY = "pv-vault", AUTO_PIC_STORE = "orbit-autopic", PREMIUM_STORE = "orbit-premium", BILL_STORE = "orbit-billing";`;
  return new Function("window", "localStorage", prelude + code
    + `return {setS: (s) => { S = s; }, getS: () => S, lock: () => { S = null; }, CLEAN, toasts, cleanTrash: typeof cleanTrash === "function" ? cleanTrash : null, applyCleanSafety, cleanScan, runAutoClean, clearStore, CLEAN_RULES,
      KEY: CLEAN_RULES_KEY, CODE_RULES: typeof CLEAN_CODE_RULES !== "undefined" ? CLEAN_CODE_RULES : null,
      UI, SYNCING, setAutoCleanRunning: (v) => { autoCleanRunning = v; },
      spam: typeof spamSearch === "function" ? { SPAM, CAN_SPAM_MOVE, spamSearch, spamMove, spamMovesRun, spamMatch, spamMoveQuery, spamSave, spamMoves, SPAM_MOVES_SWEPT,
        tick: typeof spamMovesTick === "function" ? spamMovesTick : null, AT: typeof SPAM_MOVES_AT !== "undefined" ? SPAM_MOVES_AT : null,
        MOVING: typeof SPAM_MOVING !== "undefined" ? SPAM_MOVING : null, OK: typeof SPAM_MOVES_OK !== "undefined" ? SPAM_MOVES_OK : null } : null};`);
}
// localStorage that works (full: its writes fail, as when storage is full), or one that throws (a browser that blocks storage).
const memStore = () => { const m = new Map(); const st = { full: false, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (st.full) throw new Error("QuotaExceededError"); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), m }; return st; };
const blockedStore = () => ({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });

// hooks: version (the desktop app's), beforeScan(cfg) (may throw or wait), afterScan(cfg), failMove(cfg), beforeMove(cfg),
// noSpamMove (a download before 14), beforeList(cfg) / afterList(cfg, r), beforeSpamMove(cfg) (Find in Spam).
function setup(path, store = memStore(), hooks = {}) {
  const window = { pvDesktop: {
    version: hooks.version || 13,
    scanPromos: async (cfg) => {
      SERVER.scans.push(cfg); if (hooks.beforeScan) await hooks.beforeScan(cfg);
      const res = await imap.scanPromos(Object.assign({ host: "imap.example.com", port: 993 }, cfg));
      if (hooks.afterScan) await hooks.afterScan(cfg); return res;
    },
    ...(hooks.noSpamMove ? {} : {
      listSpam: async (cfg) => {
        SERVER.lists = (SERVER.lists || []).concat([cfg]); if (hooks.beforeList) await hooks.beforeList(cfg);
        const r = await imap.listSpam(Object.assign({ host: "imap.example.com", port: 993 }, cfg));
        if (hooks.afterList) await hooks.afterList(cfg, r); return r;
      },
      spamToInbox: async (cfg, uids, v) => {
        if (hooks.beforeSpamMove) await hooks.beforeSpamMove(cfg);
        return imap.spamToInbox(Object.assign({ host: "imap.example.com", port: 993 }, cfg), uids, v);
      }
    }),
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
const RIOT = "noreply@mail.accounts.riotgames.com", BBY = "BestBuyInfo@emailinfo.bestbuy.com", TGT = "orders@oe.target.com";
// Target's codes (1.9.140) are in the corpus only for a page that has them.
const CODE_DROP_SRC = (readFileSync(file, "utf8").match(/const CLEAN_CODE_DROP = \[[\s\S]*?\n\];/) || [""])[0];
const HAS_TGT = CODE_DROP_SRC.includes("name:/^\\s*target\\s*$/i");
// From 1.9.141 (the owner's choice: "Right away") auto-clean moves Target's codes on the run that first sees them (wait: 0).
const TGT_NOW = HAS_TGT && CODE_DROP_SRC.split("\n").some((l) => /\bwait\s*:\s*0\b/.test(l) && l.includes("target\\.com"));
const TGT_CODES = HAS_TGT ? ["tgt-signin-code", "tgt-signin-code-2", "tgt-signin-code-hme", "tgt-reset-code"] : [];
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
  ...(HAS_TGT ? [
    msg(p + "tgt-signin-code", { name: "Target", address: TGT, subject: "Enter code 557017 to sign in to your Target.com account" }),
    msg(p + "tgt-signin-code-2", { name: "Target", address: TGT, subject: "Enter code 033061 to sign in to your Target.com account" }),
    msg(p + "tgt-signin-code-hme", { name: "Target", address: HME("orders", "oe.target.com"), subject: "Enter code 908172 to sign in to your Target.com account" }),
    msg(p + "tgt-reset-code", { name: "Target", address: TGT, subject: "Your Target.com password reset code is 123456" }),
    // Kept: Target's orders (the codes' scan hands back everything named "Target"), other account emails, a look-alike, a
    // forward that keeps its subject, and a reply from guest services.
    msg(p + "tgt-order", { name: "Target", address: TGT, subject: "Here's your order #102000000000001" }),
    msg(p + "tgt-shipped", { name: "Target", address: TGT, subject: "Items from order #102000000000001 have shipped" }),
    msg(p + "tgt-pw-changed", { name: "Target", address: TGT, subject: "Your Target.com password was changed" }),
    msg(p + "tgt-code-spoof", { name: "Target", address: "security@target-account.example.com", subject: "Enter code 445566 to sign in to your Target.com account" }),
    msg(p + "tgt-code-fw", { name: "Sam", address: "sam.account1@example.com", subject: "FW: Enter code 778811 to sign in to your Target.com account",
      body: fwd(`Target <${TGT}>`, "Enter code 778811 to sign in to your Target.com account", "This temporary code can be used only once.") }),
    msg(p + "tgt-guest-reply", { name: "Target", address: "guestservices@target.com", subject: "RE: Your Target.com password reset code is 123456" })] : []),
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
const ASKED = ["riot-code-1", "riot-code-2", "riot-code-hme", "riot-welcome", "riot-welcome-mail", "riot-welcome-fw", "riot-welcome-fw-verify", "fw-code-newsubj", "bby-reset", "bby-reset-hme",
  ...TGT_CODES];
// The known gaps, as the codes' scan hands these back like the site's own email: a forwarded welcome, and a code forwarded
// under a subject that protects nothing, go; one the app kept by its opening lines (the welcome) stays in the kept-safe count.
const STILL_COUNTED = ["riot-welcome-fw-verify"];
// And a Target code forwarded under its own subject (1.9.140): kept in the Inbox by the app's own subject check, but in Spam
// with Clear all of Spam on, where the app's Spam rule doesn't keep "Enter code … to sign in", the codes' scan hands it back
// like Target's own, so it goes too (by auto-clean an hour later, or from 1.9.141 at once), as a Target code.
const SPAM_GAP = HAS_TGT ? ["tgt-code-fw"] : [];
const asked = (id, spamAll = true) => ASKED.includes(bare(id)) || (spamAll && /^s:/.test(id) && SPAM_GAP.includes(bare(id)));
const bare = (id) => id.replace(/^s:/, "");
// The ones auto-clean moves on its first run (TGT_NOW): Target's codes, and in Spam with Clear all of Spam on its forward.
const atOnce = (id, spamAll = true) => TGT_NOW && (TGT_CODES.includes(bare(id)) || (spamAll && /^s:/.test(id) && SPAM_GAP.includes(bare(id))));
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
    assert.deepEqual(added.filter((id) => !asked(id)), [], "offered now, not before, and not asked for");
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
  const KEEP = [RIOT, "noreply@riotgames.com", "noreply@mail.riotgames.com", BBY.toLowerCase(), TGT];
  for (const keep of [null, KEEP]) for (const folder of ["inbox", "spam"]) for (const m0 of corpus()) {
    const m = () => Object.assign({}, m0);
    const [offNow, cntNow] = await one(setup(file), m(), folder, keep);
    const [offBefore, cntBefore] = await one(reference(), m(), folder, keep);
    if (keep) { assert.deepEqual([offNow, cntNow], [offBefore, cntBefore], `${m0.id} in ${folder}, Always keep on: [offered, kept safe] as before`); continue; }
    const where = `${m0.id} in ${folder}`;
    if (asked(folder === "spam" ? "s:" + m0.id : m0.id)) {
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
    "fw-code", "fw-pickup", "fw-getting", "fw-signin", "fw-riot-buy", "fw-riot-id",
    ...(HAS_TGT ? ["tgt-order", "tgt-shipped", "tgt-pw-changed", "tgt-code-spoof", "tgt-code-fw", "tgt-guest-reply"] : [])])
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
  if (HAS_TGT) {
    const tgt = r.groups.filter((g) => /Target\.com/.test(g.subject));
    assert.deepEqual(tgt.map((g) => [g.senderAddr, g.subject, g.uids.length]).sort(), [[TGT, "Enter code •••••• to sign in to your Target.com account", 3],
      [TGT, "Your Target.com password reset code is ••••••", 1]], "Target's: one row for its sign-in codes (Hide My Email's too), one for its reset codes");
  }
});

if (HAS_TGT) await test("a Target code in Spam, which the app's Spam rule hands back, needs no recount: two scans, as for none", async () => {
  server([], [msg("tgt-spam-code", { name: "Target", address: TGT, subject: "Enter code 557017 to sign in to your Target.com account" })]);
  const { ids, r } = await offered(setup(file), "spam");
  assert.deepEqual([ids, r.protectedCount, SERVER.scans.length], [["tgt-spam-code"], 0, 2]);
  server([], [msg("riot-spam-code", { name: "Riot Games", address: RIOT, subject: "Login Code: 123456" })]);
  const riot = await offered(setup(file), "spam");
  assert.deepEqual([riot.ids, riot.r.protectedCount, SERVER.scans.length], [["riot-spam-code"], 0, 3], "Riot's, which the app keeps there, still does");
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
  await test(`${folder}: auto-clean moves everything else as 1.9.133 did, and the ones asked for an hour later${TGT_NOW ? " (Target's codes at once)" : ""}`, async () => {
    const KEEP = [RIOT, "noreply@riotgames.com", BBY.toLowerCase(), TGT];
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
      assert.deepEqual(now.first.filter((id) => !atOnce(id, spamAll)), before.first.filter((id) => !asked(id, spamAll)), `${where}: moved at once`);
      for (const id of now.hour.filter((id) => atOnce(id, spamAll))) assert.ok(now.first.includes(id), `${where}: ${id} goes at once`);
      if (TGT_NOW && !keep) assert.ok(now.first.some((id) => atOnce(id, spamAll)), `${where}: Target's codes go at once`);
      const added = now.hour.filter((id) => !before.hour.includes(id));
      assert.deepEqual(before.hour.filter((id) => !now.hour.includes(id)), [], `${where}: moved before, kept now`);
      assert.deepEqual(added.filter((id) => !asked(id, spamAll)), [], `${where}: moved after the hour, not asked for`);
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

if (TGT_NOW) await test("Target's codes hours old when FAFO restarts go on auto-clean's first run, in the Inbox and Spam; Riot's of the same age wait their hour", async () => {
  NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
  const mk = (p) => [msg(p + "t1", { name: "Target", address: TGT, subject: "Enter code 557017 to sign in to your Target.com account", at: NOW - 3 * 3600000 }),
    msg(p + "t2", { name: "Target", address: TGT, subject: "Your Target.com password reset code is 123456", at: NOW - 15 * 60000 }),
    msg(p + "t3", { name: "Target", address: HME("orders", "oe.target.com"), subject: "Enter code 112233 to sign in to your Target.com account", at: NOW - 5 * 3600000 }),
    msg(p + "r1", { name: "Riot Games", address: RIOT, subject: "Login Code: 445566", at: NOW - 3 * 3600000 }),
    msg(p + "o1", { name: "Target", address: TGT, subject: "Thanks for your order! #102000123456", at: NOW - 3 * 3600000 })];
  for (const spamAll of [true, false]) {
    server(mk(""), mk("s:"));
    const api = setup(file); const st = api.getS().settings; st.cleanSpamAll = spamAll; swept(api, "all");
    await api.runAutoClean();
    const first = SERVER.moved.slice().sort();
    assert.deepEqual(first, ["s:t1", "s:t2", "s:t3", "t1", "t2", "t3"], `Clear all of Spam ${spamAll ? "on" : "off"}: Target's codes at once`);
    NOW += 61 * 60000; await api.runAutoClean();
    assert.deepEqual(SERVER.moved.slice().sort(), ["r1", "s:r1", "s:t1", "s:t2", "s:t3", "t1", "t2", "t3"], "Riot's after its hour, the order stays");
    assert.deepEqual(JSON.parse(api.store.getItem("orbit-clean-codes") || "{}"), {}, "forgets the ones that went");
    NOW -= 61 * 60000;
  }
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

await test(`auto-clean moves newsletters${TGT_NOW ? " and Target's codes" : ""} at once and leaves the ${TGT_NOW ? "other " : ""}codes an hour after it first sees them`, async () => {
  NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
  server(corpus());
  const api = setup(file); swept(api);
  await api.runAutoClean();
  assert.ok(SERVER.moved.includes("bby-news") && SERVER.moved.includes("survey"), "newsletters go now");
  for (const id of ASKED.filter((id) => atOnce(id))) assert.ok(SERVER.moved.includes(id), `${id} goes now`);
  const WAITS = ASKED.filter((id) => id !== "riot-welcome-mail" && !atOnce(id));
  for (const id of WAITS) assert.ok(!SERVER.moved.includes(id), `${id} waits`);
  NOW += 50 * 60000; await api.runAutoClean();
  for (const id of WAITS) assert.ok(!SERVER.moved.includes(id), `${id} still waits at 50 minutes`);
  SERVER.boxes.INBOX.msgs.push(msg("riot-code-late", { name: "Riot Games", address: RIOT, subject: "Login Code: 556677", at: NOW }));
  NOW += 15 * 60000; await api.runAutoClean();
  for (const id of ASKED) assert.ok(SERVER.moved.includes(id), `${id} goes after an hour`);
  assert.ok(!SERVER.moved.includes("riot-code-late"), "one that came later waits its own hour");
  for (const id of ["bby-order", "bby-shipped", "bby-signin", "target-code", "riot-verify", "fw-code", "fw-pickup", "riot-code-used",
    ...(HAS_TGT ? ["tgt-order", "tgt-shipped", "tgt-pw-changed", "tgt-code-spoof", "tgt-code-fw", "tgt-guest-reply"] : [])]) assert.ok(!SERVER.moved.includes(id), `${id} stays`);
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

  await test("Locking while emails move to Trash lets the move that was confirmed finish, with nothing left busy (all inboxes, or one on Inbox and Spam)", async () => {
    for (const all of [true, false]) {
      multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"), corpus("s" + "abc"[i] + ":"))])));
      let moves = 0;
      const api = withInboxes(setup(file, memStore(), { beforeMove: () => { if (++moves === 1) api.lock(); } }));
      if (!all) api.CLEAN.inboxId = "ib-one";
      const { r, ids } = await offeredMulti(api, "all");
      const parts = Object.keys(r.uidValidity).length;
      assert.ok(parts >= 2);
      await api.cleanTrash();
      assert.equal(moves, parts, "every part moved");
      assert.deepEqual(SERVER.moved.slice().sort(), ids);
      assert.equal(api.CLEAN.busy, "");
      assert.equal(api.CLEAN.progress, "");
      assert.ok(api.toasts.some((t) => t === `Moved ${ids.length} emails to Trash`), api.toasts.join(" | "));
    }
  });

  await test("All inboxes reads a mailbox saved twice (a Gmail dot version) once", async () => {
    const box = acct(corpus("a:"));
    multi({ "samone@gmail.com": box, "sam.one@gmail.com": box, [EMAILS[1]]: acct(corpus("b:")) });
    const api = withInboxes(setup(file), ["samone@gmail.com", "sam.one@gmail.com", EMAILS[1]]);
    api.getS().inboxes[0].syncError = "Sign-in failed";
    const { ids, r } = await offeredMulti(api, "inbox");
    assert.equal(new Set(ids).size, ids.length, "each email once");
    assert.deepEqual(r.inboxes, ["ib-sam.one", "ib-two"], "the one whose last check worked");
    multi({ "samone@gmail.com": box, "sam.one@gmail.com": box });
    const two = withInboxes(setup(file), ["samone@gmail.com", "sam.one@gmail.com"]);
    two.CLEAN.inboxId = "all";
    const one = await offeredMulti(two, "inbox");
    assert.equal(one.r.all, false, "one mailbox: no All inboxes");
  });

  await test("A mailbox saved twice: when the copy read first can't sign in, the other is read; iCloud's me.com is icloud.com's", async () => {
    const box = acct(corpus("a:"));
    // "sam.one@gmail.com" has an old password: the fake server only knows "samone@gmail.com".
    multi({ "samone@gmail.com": box, [EMAILS[1]]: acct(corpus("b:")) });
    let api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com", EMAILS[1]]);
    let { ids, r } = await offeredMulti(api, "inbox");
    assert.deepEqual(r.failed, [], "nothing failed: the copy that works was read");
    assert.deepEqual(r.inboxes, ["ib-samone", "ib-two"]);
    assert.ok(ids.includes("a:bby-news") && new Set(ids).size === ids.length);
    // Neither copy works: it's named once, by the copy tried last.
    multi({ [EMAILS[1]]: acct(corpus("b:")) });
    api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com", EMAILS[1]]);
    ({ r } = await offeredMulti(api, "inbox"));
    assert.deepEqual(r.failed.map((f) => f.email), ["samone@gmail.com"]);
    const icloud = acct(corpus("c:"));
    multi({ "sam@icloud.com": icloud, "sam@me.com": icloud, [EMAILS[1]]: acct(corpus("b:")) });
    api = withInboxes(setup(file), ["sam@icloud.com", "sam@me.com", EMAILS[1]]);
    ({ ids, r } = await offeredMulti(api, "inbox"));
    assert.equal(r.inboxes.length, 2);
    assert.equal(new Set(ids).size, ids.length, "each email once");
  });

  await test("Clear all of Spam turned on and back off while Spam folders were read: nothing offered, scan again", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"), corpus("s" + "abc"[i] + ":"))])));
    const api = withInboxes(setup(file, memStore(), {
      afterScan: (cfg) => { if (cfg.email === EMAILS[0] && cfg.folder === "inbox") api.getS().settings.cleanSpamAll = true; },
      beforeScan: (cfg) => { if (cfg.email === EMAILS[1]) api.getS().settings.cleanSpamAll = false; },
    }));
    api.getS().settings.cleanSpamAll = false;
    const { r } = await offeredMulti(api, "all");
    assert.ok(SERVER.scans.some((c) => c.email === EMAILS[0] && c.folder === "spam" && c.loose), "one@'s Spam was read with it on");
    assert.equal(api.getS().settings.cleanSpamAll, false, "and it's off again at the end");
    assert.equal(r, null);
    assert.ok(api.toasts.some((t) => /Clear all of Spam changed/.test(t)));
  });

  await test("Move to Trash leaves the rows that were unticked unticked", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"))])));
    const api = withInboxes(setup(file)), { r } = await offeredMulti(api, "inbox");
    const off = r.groups.find((g) => g.subject === "Top deals of the week").key;
    api.CLEAN.sel.delete(off);
    await api.cleanTrash();
    assert.deepEqual(api.CLEAN.result.groups.map((g) => g.key), [off]);
    assert.equal(api.CLEAN.sel.size, 0);
  });

  await test("Clear all of Spam changed during the scan: nothing offered, scan again", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"), corpus("s" + "abc"[i] + ":"))])));
    let n = 0;
    const api = withInboxes(setup(file, memStore(), { afterScan: (cfg) => { if (++n === 4) api.getS().settings.cleanSpamAll = false; } }));
    const { r } = await offeredMulti(api, "all");
    assert.equal(r, null);
    assert.ok(api.toasts.some((t) => /Clear all of Spam changed/.test(t)));
  });

  await test("An inbox deleted after the scan, or during it, is still named when its move fails", async () => {
    for (const during of [false, true]) {
      multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct(corpus("abc"[i] + ":"))])));
      const drop = () => { api.getS().inboxes = api.getS().inboxes.filter((i) => i.id !== "ib-two"); };
      const api = withInboxes(setup(file, memStore(), { afterScan: (cfg) => { if (during && cfg.email === EMAILS[2]) drop(); } }));
      const { r } = await offeredMulti(api, "inbox");
      if (!during) drop();
      assert.equal(r.emails["ib-two"], EMAILS[1]);
      await api.cleanTrash();
      assert.ok(api.toasts.some((t) => t.includes(EMAILS[1] + ", Inbox: This inbox isn't connected any more.")), api.toasts.join(" | "));
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

// ---- Find in Spam (1.9.136): desktop 14's listSpam and spamToInbox, the real ones, against the pretend mail server ----
const HAS_SPAM = /const CAN_SPAM_MOVE = /.test(readFileSync(file, "utf8"));
if (!HAS_SPAM && !process.argv[2]) assert.fail(`${file} has no CAN_SPAM_MOVE: Find in Spam is gone (update this test if that's on purpose)`);
if (HAS_SPAM) {
  const DMARC = (d) => `Authentication-Results: mx.google.com;\r\n dkim=pass header.i=@${d};\r\n dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${d}\r\n`;
  const SHIP = "Get ready for something special! Items from order #902000000000001are about to ship.";
  // Each account's Spam: Target's notice (verified, or relayed by Hide My Email), a look-alike, a newsletter, and older mail.
  const spamBox = (p, o = {}) => [
    msg(p + "ship", { name: "Target", address: "orders@oe.target.com", subject: SHIP, at: NOW - 2 * 3600000, auth: DMARC("oe.target.com") }),
    msg(p + "ship-hme", { name: "Target", address: HME("orders", "oe.target.com"), subject: "Items from order #902000000000002 are about to ship.", at: NOW - 5 * 3600000, auth: DMARC("icloud.com") }),
    msg(p + "member", { name: "Club", address: "club@example.com", subject: "Your membership is about to end", at: NOW - 3 * 3600000 }),
    msg(p + "phish", { name: "Target", address: "target-support@example.net", subject: "Your order is on hold", at: NOW - 4 * 3600000 }),
    msg(p + "news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", at: NOW - 6 * 3600000, bulk: true }),
    msg(p + "old", { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000003 are about to ship.", at: NOW - (o.oldDays || 40) * DAY }),
  ];
  const sp = (api) => api.spam;
  const spamIds = (r) => r.items.map((i) => allMsgs().find((m) => m.uid === i.uid).id);
  const search = async (api, q, days = 30) => { sp(api).SPAM.q = q; sp(api).SPAM.days = days; await sp(api).spamSearch(); return sp(api).SPAM.result; };

  await test("Find in Spam: a search is words that each start a word of the subject or sender, the real one behind Hide My Email too", () => {
    server([]);
    const { spamMatch, spamMoveQuery } = sp(setup(file));
    const e = { name: "Target", address: "orders@oe.target.com", subject: SHIP };
    for (const q of ["about to ship", "ABOUT to SHIP", "items from order", "902000000000001", "9020000", "target ship", "oe.target.com", "orders@oe"]) assert.ok(spamMatch(q, e), q);
    for (const q of ["", "  ", "about to shipped", "membership", "walmart ship", "000001"]) assert.ok(!spamMatch(q, e), q);
    assert.ok(!spamMatch("ship", { subject: "Your membership is about to end" }), "a word's middle isn't its start");
    assert.ok(spamMatch("target ship", { name: "", address: HME("orders", "oe.target.com"), subject: "Items are about to ship" }), "the real sender behind Hide My Email");
    assert.ok(spamMatch("pokemon", { name: "Pokémon Center", address: "x@example.com", subject: "" }), "accents don't count");
    assert.deepEqual([spamMoveQuery("a"), spamMoveQuery("to it"), spamMoveQuery("  about   to\nship "), spamMoveQuery("x".repeat(90)).length], ["", "", "about to ship", 80]);
  });

  await test("Find in Spam: All inboxes searches each Spam, shows what matches newest first, all ticked, and moves nothing", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([msg("abc"[i] + ":in", { name: "Target", address: "orders@oe.target.com", subject: SHIP })], spamBox("abc"[i] + ":"))])));
    const api = withInboxes(setup(file));
    api.getS().inboxes.forEach((i) => { i.host = "imap.gmail.com"; });   // Gmail's own header verifies
    const r = await search(api, "about to ship");
    assert.equal(r.all, true);
    assert.deepEqual(r.inboxes, ["ib-one", "ib-two", "ib-three"]);
    assert.deepEqual(spamIds(r).sort(), ["a:ship", "a:ship-hme", "b:ship", "b:ship-hme", "c:ship", "c:ship-hme"], "not the membership one, an Inbox one or one from before the 30 days");
    assert.deepEqual(r.items.slice(0, 3).map((i) => i.verified), ["target.com", "target.com", "target.com"], "newest first, the verified ones");
    assert.equal(r.items.find((i) => i.address.includes("icloud")).relayed, "orders@oe.target.com");
    assert.equal(sp(api).SPAM.sel.size, 6);
    assert.equal(api.CLEAN.busy, "");
    assert.deepEqual(SERVER.moved, []);
    assert.ok(SERVER.lists.every((c) => c.days === 30));
  });

  await test("Find in Spam: Move to Inbox moves the ticked ones from each inbox's Spam, and Keep moving saves the search", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));
    const api = withInboxes(setup(file)), r = await search(api, "  about   to ship ");
    assert.equal(r.q, "about to ship");
    sp(api).SPAM.sel.delete(r.items.find((i) => allMsgs().find((m) => m.uid === i.uid).id === "b:ship-hme").key);
    sp(api).SPAM.keep = true;
    await sp(api).spamMove();
    assert.deepEqual(SERVER.moved.slice().sort(), ["a:ship", "a:ship-hme", "b:ship", "c:ship", "c:ship-hme"]);
    for (const [i, e] of EMAILS.entries()) {
      const inbox = SERVER.accounts[e].boxes.INBOX.msgs.map((m) => m.id), spam = SERVER.accounts[e].boxes.Spam.msgs.map((m) => m.id);
      assert.ok(inbox.includes("abc"[i] + ":ship") && !spam.includes("abc"[i] + ":ship"), e);
    }
    assert.deepEqual(spamIds(sp(api).SPAM.result), ["b:ship-hme"], "the unticked one stays, unticked");
    assert.equal(sp(api).SPAM.sel.size, 0);
    assert.deepEqual(sp(api).spamMoves(), ["about to ship"]);
    assert.deepEqual(Object.keys(api.getS().settings.spamMoves), ["about to ship"], "kept by its words");
    assert.ok(api.toasts.some((t) => t.startsWith("Moved 5 emails to your Inbox.") && t.includes("is saved")), api.toasts.join(" | "));
    assert.equal(api.CLEAN.busy, "");
  });

  await test("Find in Spam: a Spam folder rebuilt since the search moves nothing there and says which; the others move", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));
    const api = withInboxes(setup(file)); await search(api, "about to ship");
    SERVER.accounts[EMAILS[1]].boxes.Spam.v = "99";
    await sp(api).spamMove();
    assert.deepEqual(SERVER.moved.slice().sort(), ["a:ship", "a:ship-hme", "c:ship", "c:ship-hme"]);
    assert.ok(api.toasts.some((t) => t.includes(EMAILS[1] + ": The Spam folder changed since the search")), api.toasts.join(" | "));
    assert.deepEqual(spamIds(sp(api).SPAM.result).sort(), ["b:ship", "b:ship-hme"]);
  });

  await test("Find in Spam: an inbox that can't be searched is named, one without Spam is noted, the others are searched", async () => {
    const noSpam = { boxes: { INBOX: { v: "7", msgs: [] }, Trash: { v: "3", msgs: [] } } };
    multi({ [EMAILS[0]]: acct([], spamBox("a:")), [EMAILS[2]]: noSpam });   // two@ can't sign in
    const api = withInboxes(setup(file)), r = await search(api, "about to ship");
    assert.deepEqual(r.failed.map((f) => f.email), [EMAILS[1]]);
    assert.deepEqual(r.noSpam, [EMAILS[2]]);
    assert.deepEqual(spamIds(r).sort(), ["a:ship", "a:ship-hme"]);
    multi({});
    const none = withInboxes(setup(file));
    assert.equal(await search(none, "about to ship"), null);
    assert.ok(EMAILS.every((e) => none.toasts.join(" ").includes(e)));
  });

  await test("Find in Spam: nothing to search for, or a download before 14, searches nothing", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));
    let api = withInboxes(setup(file));
    assert.equal(await search(api, " ? "), null);
    assert.equal(SERVER.lists, undefined);
    api = withInboxes(setup(file, memStore(), { noSpamMove: true }));
    assert.equal(sp(api).CAN_SPAM_MOVE, false);
    assert.equal(await search(api, "about to ship"), null);
    assert.equal(await sp(api).spamMovesRun(api.getS().inboxes[0], 7), 0);
  });

  await test("Find in Spam: locking while it searches offers nothing; while it moves, the move asked for finishes", async () => {
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));
    let api = withInboxes(setup(file, memStore(), { afterList: (cfg) => { if (cfg.email === EMAILS[0]) api.lock(); } }));
    sp(api).SPAM.q = "about to ship"; await sp(api).spamSearch();
    assert.equal(sp(api).SPAM.result, null);
    assert.equal(api.CLEAN.busy, "");
    multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));
    let moves = 0;
    api = withInboxes(setup(file, memStore(), { beforeSpamMove: () => { if (++moves === 1) api.lock(); } }));
    await search(api, "about to ship");
    await sp(api).spamMove();
    assert.equal(SERVER.moved.length, 6, "every inbox's");
    assert.equal(api.CLEAN.busy, "");
  });

  await test("Saved searches move what they match out of Spam on each sync: 30 days back the first time, then as far as the sync", async () => {
    multi({ [EMAILS[0]]: acct([], spamBox("a:", { oldDays: 20 })) });
    const api = withInboxes(setup(file), [EMAILS[0]]), ib = api.getS().inboxes[0];
    assert.equal(await sp(api).spamMovesRun(ib, 7), 0, "no saved search: nothing");
    assert.equal(SERVER.lists, undefined, "and Spam isn't even read");
    sp(api).spamSave("about to ship");
    assert.equal(await sp(api).spamMovesRun(ib, 7), 3, "the old one too, the first time");
    assert.deepEqual(SERVER.moved.sort(), ["a:old", "a:ship", "a:ship-hme"]);
    assert.equal(SERVER.lists.at(-1).days, 30);
    SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.push(msg("a:ship2", { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000009 are about to ship.", at: NOW - 3600000 }));
    assert.equal(await sp(api).spamMovesRun(ib, 7), 1);
    assert.equal(SERVER.lists.at(-1).days, 7, "then as far back as the sync looks");
    sp(api).spamSave("top deals");
    await sp(api).spamMovesRun(ib, 7);
    assert.equal(SERVER.lists.at(-1).days, 30, "a new search looks back 30 days once");
    assert.ok(SERVER.moved.includes("a:news"));
    assert.ok(!SERVER.moved.includes("a:phish") && !SERVER.moved.includes("a:member"), "what no search matches stays");
  });

  await test("A saved search taken off while Spam is read moves nothing", async () => {
    multi({ [EMAILS[0]]: acct([], spamBox("a:")) });
    const api = withInboxes(setup(file, memStore(), { afterList: () => { api.getS().settings.spamMoves = {}; } }), [EMAILS[0]]);
    sp(api).spamSave("about to ship");
    assert.equal(await sp(api).spamMovesRun(api.getS().inboxes[0], 7), 0);
    assert.deepEqual(SERVER.moved, []);
  });

  // A forward in Spam: Find in Spam sees its own sender and "FW:" subject, Clean the original's. A Hide My Email alias: Clean's
  // rows have the real sender.
  const FWD = (p) => msg(p + "fw-news", { name: "Sam Account1", address: "sam.account1@example.com", subject: "FW: Your Target Circle earnings",
    body: fwd("Target <targetnews@em.target.com>", "Your Target Circle earnings", "Shop now and save on everything."), at: NOW - 3600000 });
  const ALIAS = (p) => msg(p + "hme-news", { name: "Target", address: HME("targetnews", "em.target.com"), subject: "New arrivals for fall", bulk: true, at: NOW - 3600000 });
  await test("Clean emails (the Scan, auto-clean, the phone) leaves in Spam what a saved search matches as Find in Spam sees it: a forward, an alias", async () => {
    const box = (p) => acct([], [FWD(p), ALIAS(p), msg(p + "news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true, at: NOW - 3600000 })]);
    multi({ [EMAILS[0]]: box("a:") });
    let api = withInboxes(setup(file), [EMAILS[0]]);
    const before = (await offeredMulti(api, "spam")).ids;
    assert.ok(before.includes("a:fw-news") && before.includes("a:hme-news") && before.includes("a:news"), "offered without saved searches: " + before);
    multi({ [EMAILS[0]]: box("a:") });
    api = withInboxes(setup(file), [EMAILS[0]]);
    sp(api).spamSave("sam account1"); sp(api).spamSave("abcdefghijkl");   // the forwarder; the alias's own code
    const { ids, r } = await offeredMulti(api, "spam");
    assert.deepEqual(ids, before.filter((id) => id !== "a:fw-news" && id !== "a:hme-news"));
    assert.ok(r.protectedCount >= 2);
    // Auto-clean and the phone's Clean emails: the same.
    multi({ [EMAILS[0]]: box("a:") });
    api = withInboxes(setup(file), [EMAILS[0]]);
    Object.assign(api.getS().settings.autoClean, { folder: "spam", inboxId: "all" });
    sp(api).spamSave("sam account1"); sp(api).spamSave("abcdefghijkl");
    const run = await api.runAutoClean(true);
    assert.deepEqual(SERVER.moved, ["a:news"], JSON.stringify(run));
    assert.equal(SERVER.lists, undefined, "judged on the scan's own envelopes: Spam isn't listed again");
    // The sync moves them to the Inbox; auto-clean on the Inbox leaves them there too, and the Scan doesn't offer them.
    multi({ [EMAILS[0]]: box("a:") });
    api = withInboxes(setup(file), [EMAILS[0]]);
    Object.assign(api.getS().settings.autoClean, { folder: "all", inboxId: "all" });
    sp(api).spamSave("sam account1"); sp(api).spamSave("abcdefghijkl");
    assert.equal(await sp(api).spamMovesRun(api.getS().inboxes[0], 7), 2);
    assert.deepEqual(SERVER.accounts[EMAILS[0]].boxes.INBOX.msgs.map((m) => m.id).sort(), ["a:fw-news", "a:hme-news"]);
    SERVER.moved = [];
    await api.runAutoClean(true);
    assert.deepEqual(SERVER.moved, ["a:news"], "the newsletter in Spam goes; what the searches moved stays in the Inbox");
    const inbox = await offeredMulti(api, "inbox");
    assert.deepEqual(inbox.ids, []);
  });

  await test("A download before 14 with saved searches (synced from another computer): Spam isn't scanned or cleared, the page says why, and its look-back waits", async () => {
    const box = () => acct([msg("a:in-news", { name: "Kohl's", address: "kohls@em.kohls.com", subject: "Flash sale today only", bulk: true, at: NOW - 3600000 })],
      [FWD("a:"), msg("a:news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true, at: NOW - 10 * DAY })]);
    const saved = { "sam account1": { q: "sam account1", at: 1 } };
    multi({ [EMAILS[0]]: box() });
    const api = withInboxes(setup(file, memStore(), { noSpamMove: true }), [EMAILS[0]]);
    api.getS().settings.spamMoves = saved;
    const { ids, r } = await offeredMulti(api, "all");
    assert.deepEqual(ids, ["a:in-news"], "the Inbox as before; nothing in Spam");
    assert.equal(r.blind, true);
    assert.deepEqual(r.folders, ["inbox"], "Spam isn't said to have been checked");
    assert.ok(SERVER.scans.every((c) => c.folder !== "spam"), "Spam isn't even scanned");
    const spamOnly = await offeredMulti(api, "spam");
    assert.deepEqual([spamOnly.r.blind, spamOnly.r.folders, spamOnly.ids], [true, [], []]);
    // Auto-clean: the Inbox is cleaned and swept as usual; Spam waits, as a note, not an error.
    Object.assign(api.getS().settings.autoClean, { folder: "all", inboxId: "all", on: true, swept: {} });
    SERVER.scans = [];
    await api.runAutoClean();
    assert.deepEqual(SERVER.moved, ["a:in-news"]);
    let ac = api.getS().settings.autoClean;
    assert.equal(ac.lastError, "");
    assert.match(ac.lastNote, /Spam was left alone/);
    assert.equal(ac.swept["ib-one"], true, "the Inbox's first sweep is done");
    assert.equal(ac.spamOwed["ib-one"], true);
    SERVER.scans = []; await api.runAutoClean();
    assert.ok(SERVER.scans.every((c) => c.folder === "inbox" && c.days <= 3 || c.folder === "inbox" && c.rules.surveyFrom !== api.CLEAN_RULES.surveyFrom), "then 3 days, Inbox only: " + JSON.stringify(SERVER.scans.map((c) => [c.folder, c.days])));
    // With the new download (same settings), Spam's first look-back is the 30 days it's owed, then it's paid.
    const later = withInboxes(setup(file), [EMAILS[0]]);
    later.setS(api.getS());
    SERVER.scans = []; await later.runAutoClean();
    assert.ok(SERVER.scans.some((c) => c.folder === "spam" && c.days >= 30), JSON.stringify(SERVER.scans.map((c) => [c.folder, c.days])));
    assert.ok(SERVER.moved.includes("a:news"), "the 10-day-old newsletter in Spam goes");
    assert.ok(!SERVER.moved.includes("a:fw-news"), "the forward its search matches stays");
    ac = later.getS().settings.autoClean;
    assert.equal(ac.spamOwed["ib-one"], undefined);
    // Without saved searches an older download cleans Spam as before.
    multi({ [EMAILS[0]]: box() });
    const plain = withInboxes(setup(file, memStore(), { noSpamMove: true }), [EMAILS[0]]);
    assert.ok((await offeredMulti(plain, "spam")).ids.includes("a:fw-news"));
  });

  await test("A Clean result from before the saved searches changed (by a sync) is scanned again, not moved; the phone says when Spam was left alone", async () => {
    for (const blind of [false, true]) {
      multi({ [EMAILS[0]]: acct([], [FWD("a:"), msg("a:news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true, at: NOW - 3600000 })]) });
      const api = withInboxes(setup(file, memStore(), blind ? { noSpamMove: true } : {}), [EMAILS[0]]);
      const { ids } = await offeredMulti(api, "spam");
      assert.ok(ids.includes("a:fw-news"));
      api.getS().settings.spamMoves = { "sam account1": { q: "sam account1", at: 1 } };   // a sync merged one in
      await api.cleanTrash();
      assert.deepEqual(SERVER.moved, [], blind ? "a download before 14 leaves Spam alone" : "nothing it now keeps goes");
      assert.equal(api.CLEAN.result, null);
      assert.ok(api.toasts.some((t) => /changed since this scan/.test(t)), api.toasts.join(" | "));
      if (blind) {
        Object.assign(api.getS().settings.autoClean, { folder: "all", inboxId: "all", on: false });
        const res = await api.runAutoClean(true);
        assert.match(res.error, /Spam was left alone/);
      }
    }
  });

  await test("What a Find in Spam result on screen matches stays for its Move while it's showing; a result left behind holds nothing", async () => {
    const box = () => acct([], [msg("a:news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true, at: NOW - 3600000 }),
      msg("a:news2", { name: "Kohl's", address: "kohls@em.kohls.com", subject: "Flash sale today only", bulk: true, at: NOW - 3600000 })]);
    multi({ [EMAILS[0]]: box() });
    let api = withInboxes(setup(file), [EMAILS[0]]);
    api.UI.view = "clean"; api.CLEAN.mode = "spam";
    await search(api, "top deals");
    Object.assign(api.getS().settings.autoClean, { folder: "spam", inboxId: "all" });
    await api.runAutoClean(true);
    assert.deepEqual(SERVER.moved, ["a:news2"], "auto-clean leaves the one on screen");
    await sp(api).spamMove();
    assert.deepEqual(SERVER.accounts[EMAILS[0]].boxes.INBOX.msgs.map((m) => m.id), ["a:news"], "and it's there to move to the Inbox");
    // Gone to Orders: the result holds nothing any more.
    multi({ [EMAILS[0]]: box() });
    api = withInboxes(setup(file), [EMAILS[0]]);
    api.UI.view = "clean"; api.CLEAN.mode = "spam";
    await search(api, "top deals");
    api.UI.view = "orders";
    Object.assign(api.getS().settings.autoClean, { folder: "spam", inboxId: "all" });
    await api.runAutoClean(true);
    assert.deepEqual(SERVER.moved.sort(), ["a:news", "a:news2"]);
  });

  await test("Find in Spam waits for auto-clean to finish", async () => {
    multi({ [EMAILS[0]]: acct([], spamBox("a:")) });
    let release, api, paused = false;
    api = withInboxes(setup(file, memStore(), { beforeScan: () => paused ? null : (paused = true, new Promise((r) => { release = r; })) }), [EMAILS[0]]);
    Object.assign(api.getS().settings.autoClean, { folder: "spam", inboxId: "all" });
    const run = api.runAutoClean(true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await search(api, "about to ship"), null);
    assert.ok(api.toasts.some((t) => /Auto-clean is running/.test(t)));
    release(); await run;
  });

  await test("Saving a search drops Clean's result on screen; a Move counts what was gone since the search; Keep moving unticks after it saves", async () => {
    multi({ [EMAILS[0]]: acct([], spamBox("a:")) });
    const api = withInboxes(setup(file), [EMAILS[0]]);
    api.getS().settings.cleanSpamAll = false;
    await offeredMulti(api, "spam");
    assert.ok(api.CLEAN.result);
    await search(api, "about to ship");
    SERVER.accounts[EMAILS[0]].boxes.Spam.msgs = SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.filter((m) => m.id !== "a:ship-hme");   // gone meanwhile
    sp(api).SPAM.keep = true;
    await sp(api).spamMove();
    assert.equal(api.CLEAN.result, null, "Clean's result goes once a search is saved");
    assert.equal(sp(api).SPAM.keep, false);
    assert.ok(api.toasts.some((t) => t.startsWith("Moved 1 email to your Inbox. 1 email wasn't in Spam any more")), api.toasts.join(" | "));
  });

  await test("Clean emails never offers what a saved Find in Spam search matches, in the Inbox or Spam, and counts it kept", async () => {
    for (const folder of ["inbox", "spam"]) {
      server(folder === "inbox" ? corpus("x:") : [], folder === "spam" ? corpus("x:") : []);
      const before = await offered(setup(file), folder);
      assert.ok(before.ids.includes("x:bby-news"), "offered without the search");
      server(folder === "inbox" ? corpus("x:") : [], folder === "spam" ? corpus("x:") : []);
      const api = setup(file); sp(api).spamSave("top deals");
      const after = await offered(api, folder);
      assert.deepEqual(after.ids, before.ids.filter((id) => id !== "x:bby-news"), folder);
      assert.equal(after.r.protectedCount, before.r.protectedCount + 1, folder + ": kept safe");
    }
  });

  // ---- Saved searches every 10 minutes on their own (1.9.137) ----
  const HTML = readFileSync(file, "utf8"), HAS_TICK = /async function spamMovesTick\(/.test(HTML);
  if (!HAS_TICK && !process.argv[2]) assert.fail(`${file} has no spamMovesTick: saved searches don't run every 10 minutes any more (update this test if that's on purpose)`);
  if (HAS_TICK) {
    const MIN = 60000, start = NOW;
    const lists = () => (SERVER.lists || []).map((c) => [c.email, c.days]);
    const three = () => multi(Object.fromEntries(EMAILS.map((e, i) => [e, acct([], spamBox("abc"[i] + ":"))])));

    await test("Saved searches run on their own every 10 minutes, each mailbox once, and say what moved", async () => {
      three();
      const api = withInboxes(setup(file)); sp(api).spamSave("about to ship");
      await sp(api).tick();
      assert.deepEqual(lists(), EMAILS.map((e) => [e, 30]), "each Spam, 30 days back the first time");
      assert.deepEqual(SERVER.moved.slice().sort(), ["a:ship", "a:ship-hme", "b:ship", "b:ship-hme", "c:ship", "c:ship-hme"]);
      assert.deepEqual(api.toasts, EMAILS.map((e) => `${e}: moved 2 emails out of Spam`));
      await sp(api).tick();
      NOW += 9 * MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 3, "not again for 10 minutes");
      SERVER.accounts[EMAILS[1]].boxes.Spam.msgs.push(msg("b:ship2", { name: "Target", address: HME("orders", "oe.target.com"), subject: "Items from order #902000000000009 are about to ship.", at: NOW - MIN }));
      NOW += MIN; await sp(api).tick();
      assert.deepEqual(lists().slice(3), EMAILS.map((e) => [e, 3]), "then each 10 minutes, 3 days back");
      assert.ok(SERVER.moved.includes("b:ship2"));
      assert.equal(api.toasts.at(-1), `${EMAILS[1]}: moved 1 email out of Spam`, "only what moved is told");
      assert.equal(api.toasts.length, 4);
      assert.ok(!SERVER.moved.includes("a:member") && !SERVER.moved.includes("a:phish") && !SERVER.moved.includes("a:news"), "what no search matches stays");
      assert.equal(sp(api).MOVING.size, 0);
      NOW = start;
    });

    await test("A sync's run counts: that mailbox waits 10 minutes, the others go; a copy saved twice is read once, the other copy when it can't be", async () => {
      three();
      let api = withInboxes(setup(file)); sp(api).spamSave("about to ship");
      await sp(api).spamMovesRun(api.getS().inboxes[0], 7);   // as one@'s sync does
      await sp(api).tick();
      assert.deepEqual(lists(), [[EMAILS[0], 30], [EMAILS[1], 30], [EMAILS[2], 30]]);
      NOW += 10 * MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 6);
      NOW = start;
      // sam.one@gmail.com and samone@gmail.com are one mailbox: the copy that signs in is read, once.
      multi({ "samone@gmail.com": acct([], spamBox("a:")), [EMAILS[1]]: acct([], spamBox("b:")) });
      api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com", EMAILS[1]]); sp(api).spamSave("about to ship");
      await sp(api).tick();
      assert.deepEqual(lists(), [["sam.one@gmail.com", 30], ["samone@gmail.com", 30], [EMAILS[1], 30]], "the old copy can't sign in: the other is read");
      assert.deepEqual(SERVER.moved.slice().sort(), ["a:ship", "a:ship-hme", "b:ship", "b:ship-hme"]);
      NOW += 3 * MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 3, "and the mailbox waits its 10 minutes, the copy that failed too");
      NOW = start;
      // The copy whose last check failed goes after the one that works (cleanMailboxes), so it isn't tried at all.
      multi({ "samone@gmail.com": acct([], spamBox("a:")) });
      api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com"]); sp(api).spamSave("about to ship");
      api.getS().inboxes[0].syncError = "Invalid credentials";
      await sp(api).tick();
      assert.deepEqual(lists(), [["samone@gmail.com", 30]]);
    });

    await test("A mailbox that can't sign in is asked again in 10 minutes, not every minute; the others go on", async () => {
      multi({ [EMAILS[0]]: acct([], spamBox("a:")), [EMAILS[2]]: acct([], spamBox("c:")) });   // two@ can't sign in
      const api = withInboxes(setup(file)); sp(api).spamSave("about to ship");
      await sp(api).tick();
      assert.deepEqual(lists().map((l) => l[0]), EMAILS);
      assert.deepEqual(SERVER.moved.slice().sort(), ["a:ship", "a:ship-hme", "c:ship", "c:ship-hme"]);
      for (let m = 1; m < 10; m++) { NOW += MIN; await sp(api).tick(); }
      assert.equal(SERVER.lists.length, 3);
      NOW += MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 6);
      assert.equal(lists()[4][1], 30, "two@'s first look-back is still owed");
      NOW = start;
    });

    await test("It waits while email syncs, Clean emails or Find in Spam is busy, or auto-clean runs, and goes at the next check", async () => {
      three();
      const api = withInboxes(setup(file)); sp(api).spamSave("about to ship");
      api.SYNCING.set("ib-two", "Connecting…"); await sp(api).tick();
      api.SYNCING.clear(); api.CLEAN.busy = "scan"; await sp(api).tick();
      api.CLEAN.busy = "spam-move"; await sp(api).tick();
      api.CLEAN.busy = ""; api.setAutoCleanRunning(true); await sp(api).tick();
      assert.equal(SERVER.lists, undefined, "nothing while any of those");
      api.setAutoCleanRunning(false);
      // A sync starting while it runs: it stops after that mailbox, and the next check does the rest.
      let first = true;
      const hooked = withInboxes(setup(file, memStore(), { afterList: () => { if (first) { first = false; hooked.SYNCING.set("ib-one", "Syncing…"); } } }));
      sp(hooked).spamSave("about to ship");
      await sp(hooked).tick();
      assert.deepEqual(lists(), [[EMAILS[0], 30]]);
      hooked.SYNCING.clear(); NOW += MIN; await sp(hooked).tick();
      assert.deepEqual(lists(), EMAILS.map((e) => [e, 30]), "the rest a minute later, one@ not again");
      NOW = start;
    });

    await test("One run per mailbox at a time: a sync's and the 10 minutes' don't overlap, nor two checks", async () => {
      three();
      let release, paused = false;
      const api = withInboxes(setup(file, memStore(), { beforeList: (cfg) => cfg.email === EMAILS[0] && !paused ? (paused = true, new Promise((r) => { release = r; })) : null }));
      sp(api).spamSave("about to ship");
      const sync = sp(api).spamMovesRun(api.getS().inboxes[0], 7);   // one@'s sync, waiting on its Spam
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(await sp(api).spamMovesRun(api.getS().inboxes[0], 7), 0, "a second run on one@ does nothing");
      const tick = sp(api).tick(), again = sp(api).tick();
      await again; await new Promise((r) => setTimeout(r, 5));
      release(); await sync; await tick;
      assert.deepEqual(lists(), EMAILS.map((e) => [e, 30]), "one@ once (the sync's), the others once");
      assert.equal(SERVER.moved.length, 6);
      assert.equal(sp(api).MOVING.size, 0);
    });

    await test("A search saved, or synced in, goes within the minute with its 30-day look-back; none left, nothing runs", async () => {
      multi({ [EMAILS[0]]: acct([], spamBox("a:", { oldDays: 20 })) });
      const api = withInboxes(setup(file), [EMAILS[0]]); sp(api).spamSave("about to ship");
      await sp(api).tick();
      assert.ok(SERVER.moved.includes("a:old"), "20 days old: the first look-back reaches it");
      NOW += MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 1);
      sp(api).spamSave("top deals");
      NOW += MIN; await sp(api).tick();
      assert.deepEqual(lists()[1], [EMAILS[0], 30]);
      assert.ok(SERVER.moved.includes("a:news"));
      api.getS().settings.spamMoves = Object.assign({}, api.getS().settings.spamMoves, { "your membership": { q: "your membership", at: 1 } });   // from another computer
      NOW += MIN; await sp(api).tick();
      assert.deepEqual(lists()[2], [EMAILS[0], 30]);
      assert.ok(SERVER.moved.includes("a:member"));
      api.getS().settings.spamMoves = {};
      NOW += 20 * MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 3, "no saved search: Spam isn't read");
      NOW = start;
    });

    await test("Locking stops it (and a lock and unlock meanwhile), and a download before 14 runs nothing", async () => {
      three();
      const api = withInboxes(setup(file, memStore(), { afterList: () => api.lock() })); sp(api).spamSave("about to ship");
      await sp(api).tick();
      assert.deepEqual(lists(), [[EMAILS[0], 30]]);
      assert.deepEqual(SERVER.moved, [], "nothing moves once locked");
      assert.deepEqual(api.toasts, []);
      assert.equal(sp(api).AT.size, 0, "nor is a run noted for the next unlock");
      // Locked and unlocked again while Spam was read: another copy of the vault, with the same saved searches.
      three();
      const again = withInboxes(setup(file, memStore(), { afterList: () => again.setS(JSON.parse(JSON.stringify(again.getS()))) }));
      sp(again).spamSave("about to ship");
      await sp(again).tick();
      assert.deepEqual(lists(), [[EMAILS[0], 30]], "the run stops there");
      assert.deepEqual(SERVER.moved, []);
      assert.deepEqual(again.toasts, []);
      assert.equal(sp(again).AT.size, 0);
      three();
      const old = withInboxes(setup(file, memStore(), { noSpamMove: true }));
      old.getS().settings.spamMoves = { "about to ship": { q: "about to ship", at: 1 } };
      await sp(old).tick();
      assert.equal(SERVER.lists, undefined);
    });

    await test("After a lock or a sleep of days it looks back to its last run that went through, so an inbox not on Auto misses nothing", async () => {
      multi({ [EMAILS[0]]: acct([], spamBox("a:")) });
      const api = withInboxes(setup(file), [EMAILS[0]]); sp(api).spamSave("about to ship");
      api.getS().inboxes[0].auto = false;   // no email sync runs the searches on it
      await sp(api).tick();
      const add = (id, daysOld) => SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.push(msg(id, { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000011 are about to ship.", at: NOW - daysOld * DAY }));
      // Locked 5 days with FAFO open (the lock forgets when each mailbox ran), then unlocked.
      NOW += 5 * DAY; sp(api).AT.clear(); add("a:locked", 4);
      await sp(api).tick();
      assert.deepEqual(lists().at(-1), [EMAILS[0], 6], "back to the last run, with a day's room");
      assert.ok(SERVER.moved.includes("a:locked"), "the 4-day-old match moves");
      NOW += 10 * MIN; await sp(api).tick();
      assert.deepEqual(lists().at(-1), [EMAILS[0], 3], "then 3 days again");
      // Asleep 8 days, unlocked.
      NOW += 8 * DAY; add("a:asleep", 7);
      await sp(api).tick();
      assert.deepEqual(lists().at(-1), [EMAILS[0], 9]);
      assert.ok(SERVER.moved.includes("a:asleep"));
      NOW += 60 * DAY; await sp(api).tick();
      assert.deepEqual(lists().at(-1), [EMAILS[0], 30], "30 days at most");
      NOW = start;
    });

    await test("A sync whose own run is skipped while the 10 minutes' run holds the mailbox loses nothing", async () => {
      multi({ [EMAILS[0]]: acct([], spamBox("a:")) });
      let release = null, n = 0;
      const api = withInboxes(setup(file, memStore(), { beforeList: () => ++n === 2 ? new Promise((r) => { release = r; }) : null }), [EMAILS[0]]);
      sp(api).spamSave("about to ship");
      await sp(api).tick();
      NOW += 6 * DAY;   // the computer slept, unlocked; the minute's check fires before the sync
      SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.push(msg("a:slept", { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000012 are about to ship.", at: NOW - 5 * DAY }));
      const tick = sp(api).tick();
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(await sp(api).spamMovesRun(api.getS().inboxes[0], 9), 0, "the sync's own run is skipped");
      release(); await tick;
      assert.deepEqual(lists().at(-1), [EMAILS[0], 7], "the 10 minutes' run looked back over the whole sleep");
      assert.ok(SERVER.moved.includes("a:slept"));
      NOW = start;
    });

    await test("A sync failing on one copy of a mailbox saved twice doesn't hold back the copy that works; one inbox's failure still counts", async () => {
      multi({ "samone@gmail.com": acct([], spamBox("a:")) });   // sam.one@gmail.com has an old password
      let api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com"]); sp(api).spamSave("about to ship");
      const [broken] = api.getS().inboxes;
      broken.syncError = "Invalid credentials";   // as its sync left it
      const at = [];
      for (let m = 0; m <= 60; m++) {
        if (m % 15 === 0) { api.SYNCING.set(broken.id, "Syncing…"); await sp(api).spamMovesRun(broken, 7); api.SYNCING.delete(broken.id); }   // its 15 minutes' sync
        const before = (SERVER.lists || []).length;
        await sp(api).tick();
        if ((SERVER.lists || []).slice(before).some((c) => c.email === "samone@gmail.com")) at.push(m);
        NOW += MIN;
      }
      assert.deepEqual(at, [0, 10, 20, 30, 40, 50, 60], "the copy that works, every 10 minutes from the start");
      NOW = start;
      // The copy that works isn't on Auto and still has an old error from a sync that failed once: still every 10 minutes.
      multi({ "samone@gmail.com": acct([], spamBox("a:")) });
      api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com"]); sp(api).spamSave("about to ship");
      const [old, works] = api.getS().inboxes;
      old.syncError = "Invalid credentials"; works.syncError = "Couldn't connect"; works.auto = false;
      at.length = 0;
      for (let m = 0; m <= 60; m++) {
        if (m % 15 === 0) { api.SYNCING.set(old.id, "Syncing…"); await sp(api).spamMovesRun(old, 7); api.SYNCING.delete(old.id); }
        const before = (SERVER.lists || []).length;
        await sp(api).tick();
        if ((SERVER.lists || []).slice(before).some((c) => c.email === "samone@gmail.com")) at.push(m);
        NOW += MIN;
      }
      assert.deepEqual(at, [0, 10, 20, 30, 40, 50, 60], "an old syncError doesn't count as Spam failing");
      NOW = start;
      // The copy that works fails to read Spam once, then reads it again: from then on it's every 10 minutes again.
      multi({ "samone@gmail.com": acct([], spamBox("a:")) });
      let blip = true;
      api = withInboxes(setup(file, memStore(), { beforeList: (cfg) => { if (cfg.email === "samone@gmail.com" && blip) { blip = false; throw new Error("network"); } } }), ["sam.one@gmail.com", "samone@gmail.com"]);
      sp(api).spamSave("about to ship");
      api.getS().inboxes[0].syncError = "Invalid credentials";
      const ok = [];
      for (let m = 0; m <= 60; m++) {
        const ib0 = api.getS().inboxes[0];
        if (m % 15 === 0) { api.SYNCING.set(ib0.id, "Syncing…"); await sp(api).spamMovesRun(ib0, 7); api.SYNCING.delete(ib0.id); }
        const before = (SERVER.lists || []).length;
        await sp(api).tick();
        if ((SERVER.lists || []).slice(before).some((c) => c.email === "samone@gmail.com") && !blip) ok.push(m);
        NOW += MIN;
      }
      assert.deepEqual(ok.slice(1), [10, 20, 30, 40, 50, 60], "after the blip, every 10 minutes: " + ok);
      NOW = start;
      // One inbox, no other copy: its sync's failure counts, so it isn't asked every minute.
      multi({});
      api = withInboxes(setup(file), [EMAILS[0]]); sp(api).spamSave("about to ship");
      await sp(api).spamMovesRun(api.getS().inboxes[0], 7);
      for (let m = 1; m < 10; m++) { NOW += MIN; await sp(api).tick(); }
      assert.equal(SERVER.lists.length, 1, "only the sync's");
      NOW += MIN; await sp(api).tick();
      assert.equal(SERVER.lists.length, 2);
      NOW = start;
    });

    await test("A move that failed (stopped, or refused: the Spam folder changed) is tried again, back to the last run that went through (30 days when none has)", async () => {
      for (const how of ["throws", "refused"]) {
        multi({ [EMAILS[0]]: acct([], spamBox("a:", { oldDays: 20 })) });
        let first = true;
        const api = withInboxes(setup(file, memStore(), {
          beforeSpamMove: () => { if (how === "throws" && first) { first = false; throw new Error("connection lost"); } },
          afterList: () => { if (how === "refused" && first) { first = false; const b = SERVER.accounts[EMAILS[0]].boxes.Spam; b.v = String(Number(b.v) + 1); } },
        }), [EMAILS[0]]);
        sp(api).spamSave("about to ship");
        await sp(api).tick();
        assert.deepEqual(SERVER.moved, [], how);
        NOW += 10 * MIN; await sp(api).tick();
        assert.deepEqual(lists(), [[EMAILS[0], 30], [EMAILS[0], 30]], how + ": 30 days again, not 3");
        assert.ok(SERVER.moved.includes("a:old"), how + ": the 20-day-old one moves");
        // Once one has gone through, a failed move is tried again looking back to it: 3 days, not 30.
        SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.push(msg("a:new", { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000014 are about to ship.", at: NOW - MIN }));
        first = true; NOW += 10 * MIN; await sp(api).tick();
        assert.ok(!SERVER.moved.includes("a:new"), how);
        NOW += 10 * MIN; await sp(api).tick();
        assert.deepEqual(lists().slice(2), [[EMAILS[0], 3], [EMAILS[0], 3]], how);
        assert.ok(SERVER.moved.includes("a:new"), how + ": moved on the next run");
        NOW = start;
      }
    });

    await test("A sync's run looks back to the last run that went through too: after a sleep, or an inbox's address changed to another mailbox", async () => {
      multi({ [EMAILS[0]]: acct([], spamBox("a:")), [EMAILS[1]]: acct([], spamBox("b:", { oldDays: 20 })) });
      const api = withInboxes(setup(file), [EMAILS[0]]); sp(api).spamSave("about to ship");
      const ib = api.getS().inboxes[0];
      await sp(api).spamMovesRun(ib, 7);
      assert.deepEqual(lists(), [[EMAILS[0], 30]]);
      NOW += 10 * DAY;
      SERVER.accounts[EMAILS[0]].boxes.Spam.msgs.push(msg("a:slept8", { name: "Target", address: "orders@oe.target.com", subject: "Items from order #902000000000013 are about to ship.", at: NOW - 8 * DAY }));
      await sp(api).spamMovesRun(ib, 7);   // the sync's, whose own look-back is 7 days
      assert.deepEqual(lists().at(-1), [EMAILS[0], 11]);
      assert.ok(SERVER.moved.includes("a:slept8"));
      // The same inbox now pointing at another mailbox: its first look-back is 30 days, not the sync's 7.
      ib.email = EMAILS[1];
      await sp(api).spamMovesRun(ib, 7);
      assert.deepEqual(lists().at(-1), [EMAILS[1], 30]);
      assert.ok(SERVER.moved.includes("b:old"), "the 20-day-old one there moves");
      assert.ok([...sp(api).OK.keys()].every((k) => !k.includes("@")), "kept by a hash of the mailbox, not its address");
      NOW = start;
    });

    await test("A mailbox saved twice whose copies all fail is signed in to no more than before: each sync's failure counts", async () => {
      multi({});   // neither copy can sign in
      const api = withInboxes(setup(file), ["sam.one@gmail.com", "samone@gmail.com"]); sp(api).spamSave("about to ship");
      const per = new Map();
      for (let m = 0; m < 60; m++) {
        if (m % 15 === 0) for (const ib of api.getS().inboxes) {   // each copy's 15 minutes' sync
          api.SYNCING.set(ib.id, "Syncing…"); await sp(api).spamMovesRun(ib, 7); ib.syncError = "Invalid credentials"; api.SYNCING.delete(ib.id);
        }
        const before = (SERVER.lists || []).length;
        await sp(api).tick();
        per.set(m, (SERVER.lists || []).length - before);
        NOW += MIN;
      }
      assert.equal(SERVER.lists.length, 16, "4 syncs of 2 copies, and the 10 minutes' run 4 times between them");
      assert.ok([...per.values()].every((n) => n <= 2));
      NOW = start;
    });

    await test("The page runs it from unlock, update restarts wait for it, locking forgets when each ran, and it says every 10 minutes", () => {
      const fn = (name) => { const i = HTML.indexOf(name); assert.ok(i >= 0, name); return HTML.slice(i, HTML.indexOf("\n}\n", i)); };
      assert.match(fn("function startApp(){"), /scheduleSpamMoves\(\)/);
      assert.match(fn("function autoUpdBlock("), /SPAM_MOVING\.size[^\n]*return "busy"/);
      assert.match(HTML, /SPAM\.result = null;[^\n]*\n\s*SPAM_MOVES_AT\.clear\(\);/);
      assert.match(fn("function scheduleSpamMoves(){"), /setInterval\(\(\) => \{ if \(S\) spamMovesTick\(\); \}, 60 \* 1000\)/);
      const page = fn("function spamHTML(){");
      assert.ok(!/on every sync/.test(page), "Find in Spam doesn't say on every sync any more");
      assert.match(page, /Keep moving emails like these out of Spam every 10 minutes/);
    });
  }
}

// ---- Auto-clean when the one inbox it was set to is gone (1.9.142, from CLAUDE.md's "Fix with the next page release") ----
// Until 1.9.142 it found nothing to clean and stopped before noting the run, so the Clean page's Last run line froze while its
// Inboxes menu read All inboxes. Now it cleans every inbox with a password and saves All inboxes; with none, it says so.
const VER = (/index-(\d+\.\d+\.\d+)\.html$/.exec(file) || [])[1];
if (VER && cmp(VER, "1.9.142") >= 0) {
  const PAGE = readFileSync(file, "utf8");
  const two = (api) => { api.getS().inboxes = [{ id: "ib1", email: "one@example.com", password: "pw" }, { id: "ib2", email: "two@example.com", password: "pw" }]; return api; };
  const scanned = () => [...new Set(SERVER.scans.map((c) => c.email))].sort();
  for (const [why, set] of [["deleted", (api) => { api.getS().settings.autoClean.inboxId = "ib-gone"; }],
    ["left without a password", (api) => { api.getS().inboxes.push({ id: "ib3", email: "three@example.com", password: "" }); api.getS().settings.autoClean.inboxId = "ib3"; }]]) {
    await test(`auto-clean set to one inbox that was ${why} cleans every inbox with a password, and saves All inboxes`, async () => {
      NOW = Date.UTC(2026, 10, 4, 15, 0, 0); server([msg("gone-news", { name: "Best Buy", address: "BestBuy@email.bestbuy.com", subject: "Top deals of the week", bulk: true })]);
      const api = two(setup(file)); set(api);
      const res = await api.runAutoClean();
      assert.deepEqual(scanned(), ["one@example.com", "two@example.com"]);
      const c = api.getS().settings.autoClean;
      assert.equal(c.inboxId, "all", "the Clean page's Inboxes menu and what runs agree");
      assert.equal(c.lastRun, NOW, "the Last run line moves on");
      assert.equal(c.lastError, "");
      assert.equal(res.error, "");
      assert.ok(SERVER.moved.includes("gone-news"));
    });
  }
  await test("auto-clean with no inbox that has a password says so on the Clean page, and a picked inbox that's still there stays picked", async () => {
    NOW = Date.UTC(2026, 10, 4, 15, 0, 0); server([]);
    let api = setup(file); api.getS().inboxes = [{ id: "ib1", email: "one@example.com", password: "" }]; api.getS().settings.autoClean.inboxId = "ib1";
    const res = await api.runAutoClean();
    const c = api.getS().settings.autoClean;
    assert.equal(res.error, "There's no inbox to clean. Add one in FAFO's settings.");
    assert.equal(c.lastError, res.error, "Last run failed: …, not a line that never changes");
    assert.equal(c.lastRun, NOW);
    assert.equal(c.inboxId, "all");
    assert.equal(SERVER.scans.length, 0);
    // The phone's request with none says so to the phone only.
    api = setup(file); api.getS().inboxes = []; api.getS().settings.autoClean = { on: false };
    assert.equal((await api.runAutoClean(true)).error, "There's no inbox to clean. Add one in FAFO's settings.");
    assert.equal(api.getS().settings.autoClean.lastError, undefined);
    // An inbox picked that's there and has a password is the only one cleaned, as before.
    server([]); api = two(setup(file)); api.getS().settings.autoClean.inboxId = "ib2";
    await api.runAutoClean();
    assert.deepEqual(scanned(), ["two@example.com"]);
    assert.equal(api.getS().settings.autoClean.inboxId, "ib2");
  });
  await test("Delete inbox sets auto-clean to All inboxes when it was set to that inbox", () => {
    const i = PAGE.indexOf('case "delete-inbox":'); assert.ok(i >= 0);
    const handler = PAGE.slice(i, PAGE.indexOf("break; }", i));
    assert.match(handler, /if \(autoCleanCfg\(\)\.inboxId === id\) S\.settings\.autoClean = Object\.assign\(\{\}, autoCleanCfg\(\), \{inboxId:"all"\}\);\s*persist\(\);/);
  });
}

Date.now = realNow;
console.log(`${passed} passed`);
