// Tests the newest page's Invoice (index-X.Y.Z.html) against the plans the license worker offers, from 1.9.143: the owner
// removed the monthly plan (2026-11-12: "Remove $25 plan completely"), so GET /billing answers plans: ["checkout"], and the
// page offers no monthly plan or its extra 15 slots anywhere (Invoice, Submit's slot-limit windows, the window Submit opens
// when the seller needs a plan), while a buyer already on it keeps it with Cancel plan and Pay now. Only the worker's plans
// decides: ["checkout", "monthly"] offers both, and an answer without plans (an older worker) does too, as before. The real
// page runs in Chromium (Playwright), as the web version at app.fafoaco.com, against a pretend license worker, as
// interests.test.mjs runs it: a vault made with Use this browser only, then a license key kept as Submit keeps one typed
// there. Sample keys and amounts only.
// From 1.9.144 (the owner's requests, 2026-11-12: "Change invoice due date to every Sunday", "Change friends and family cost
// to $5"; 2026-11-13: "Friends and family are always 5 dollars but everyone else is 10 or can be set for more later"): with
// the worker's prices.dueRule "sunday" a checkout is due by the end of the Sunday after it, Eastern time, and Invoice says
// so and shows each due date as that Sunday in Eastern time, wherever the computer is (this test runs in Tokyo's time zone,
// where the instant is Monday); Friends and Family (family: true, exempt null) get the pay per checkout page at their price,
// $5, with no plan cards or monthly plan; an answer with exempt "family" (a worker before 1.9.144's, where they weren't
// charged; 1.9.144's never sends it) has nothing to pay, as before; and an older worker's answer (no dueRule, no family)
// shows what 1.9.143 did. The amounts are the answers' own (the page shows what the worker says), $5 a checkout in most.
// From 1.9.154 (the owner's request, 2026-11-16: "Orders that is before $1-49.99, $5. 50-99.99, $10. $100-149.99, $15.
// 150-199.99, $20. Anything over 200 is $25. All prices are included before tax."): with the worker's prices.tiers, Invoice's
// plan card lists them, the pay per checkout page says $5 to $25 by order amount, Submit's window, Cancel plan, Switch and the
// seller's Settings → Billing name them, and each checkout says what it was priced on (basis, basisFrom); Friends and Family
// keep their $5, and an answer without tiers shows what 1.9.153 did. The page sends the amount before tax: the email's
// Subtotal (parseOrderEmail, kept by planOrderImport and repairFromConfirmations), else qty × the unit price, as sub with each
// order alert (reportOrderAlerts, run here outside the browser) and, with the total, each checkout it reports.
//   node .github/scripts/billing.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must read plans (billMonthlyOffered), the Sunday rule (billDueDay) and the tiers (billTiers); a page named on
// the command line that doesn't read plans is skipped, and one that doesn't read the Sunday rule or the tiers skips those tests.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!/const billMonthlyOffered = /.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} doesn't read the worker's plans (billMonthlyOffered): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no plans from the worker, skipped`); process.exit(0);
}
const SUNDAY = /const billDueDay = /.test(HTML);
if (!SUNDAY && !process.argv[2]) { console.error(`${file} doesn't read the worker's Sunday due dates (billDueDay): update this test if that's on purpose`); process.exit(1); }
const TIERS = SUNDAY && /function billTiers\(/.test(HTML);
if (!TIERS && !process.argv[2]) { console.error(`${file} doesn't read the worker's prices by amount (billTiers): update this test if that's on purpose`); process.exit(1); }
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get billMem(){ return billMem; }, set billMem(v){ billMem = v; }, BILL, keepTypedLic, persist, render, renderMain, refreshBilling, billOpen, billRead, billPlan,"
  + " billMonthly, billMonthlyOffered, billingBlockDialog, slotLimitDialog, slotAllowHTML, closeAllLayers, refreshSlotAllow"
  + (SUNDAY ? ", billDay, billDueDay, billDueWhen, billSum, billNotices, billSubmitNote, billBadge, billingSectionHTML, reportCheckouts" : "")
  + (TIERS ? ", billTiers, billTierSummary, billTierRows, billBasisNote, moneyCents, orderSubBeforeTax, parseOrderEmail, planOrderImport, repairFromConfirmations" : "") + "};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// The seller's order alerts (reportOrderAlerts) only run in the desktop app, so its own code runs here, outside the browser,
// with what it reads around it: each event carries sub, the amount before tax the buyer's checkout is priced by (1.9.154).
async function alertEventsTest() {
  const fn = (head) => { const s = HTML.indexOf(head); assert.ok(s >= 0, head); let i = HTML.indexOf("{", s), d = 0; do { d += HTML[i] === "{" ? 1 : HTML[i] === "}" ? -1 : 0; i++; } while (d); return HTML.slice(s, i); };
  const line = (re) => { const m = HTML.match(re); assert.ok(m, String(re)); return m[0]; };
  const code = [line(/^const norm = .*$/m), line(/^const STORES = .*$/m), line(/^const storeKeyOf = .*$/m), line(/^const orderStoreLabel = .*$/m), line(/^const ALERT_STEPS = .*$/m),
    fn("const moneyCents = (v) => {"), fn("function orderSubBeforeTax(o){"), fn("async function reportOrderAlerts(){")].join("\n");
  const api = new Function(`let S = null; const DESK = true, posts = [], OALERT = {busy:false, accounts:null, accountsAt:0};
    const orderAlertsOn = () => true, licRead = () => ({key:"PVLT-TEST-TEST-TEST-TEST"}), persist = () => {}, refreshAlertSender = () => {};
    const alertApi = async (path, opts) => { posts.push([path, opts && opts.body ? JSON.parse(opts.body) : null]); return {ok:true, status:200, json:async () => ({ok:true})}; };
    ${code}
    return {setS:(x) => { S = x; }, posts, OALERT, reportOrderAlerts, orderSubBeforeTax};`)();
  api.OALERT.accounts = new Map([["acct.one@example.com", new Set(["target"])]]); api.OALERT.accountsAt = Date.now();
  const o = (x) => Object.assign({ store: "target", storeName: "", item: "Sample Booster Bundle", qty: "2", total: "64.93", at: "2026-11-15", stage: "placed", sentTo: "acct.one@example.com" }, x);
  api.setS({ settings: { orderAlerts: { on: true, since: Date.parse("2026-11-10") } }, orders: [
    o({ orderNo: "4000000001", subtotal: "59.98", priceEach: "29.99" }),           // the email's Subtotal
    o({ orderNo: "4000000002", subtotal: "", priceEach: "29.99" }),                // qty × the unit price
    o({ orderNo: "4000000003", priceEach: "" }),                                   // neither: none
    o({ orderNo: "4000000004", qty: "1", subtotal: "1,234.56", total: "1,336.41" }),
  ] });
  await api.reportOrderAlerts();
  const ev = api.posts.filter((p) => p[0] === "/alerts").flatMap((p) => p[1].events);
  assert.deepEqual(ev.map((e) => [e.orderNo, e.sub, e.total]), [["4000000001", "59.98", "64.93"], ["4000000002", "59.98", "64.93"], ["4000000003", "", "64.93"], ["4000000004", "1234.56", "1,336.41"]]);
  assert.deepEqual(ev[0], { account: "acct.one@example.com", store: "target", storeName: "Target", orderNo: "4000000001", item: "Sample Booster Bundle", qty: "2", total: "64.93", sub: "59.98", stage: "placed", at: "2026-11-15" });
}

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const DAY = 86400000;
// An older worker's prices (before 1.9.144: no dueRule, no family), and the Sunday rule's.
const PRICES = { checkout: 500, monthly: 2500, extra: 2500, monthlySlots: 10, extraSlots: 15, extraMax: 1, dueDays: 3 };
const PRICES_SUN = Object.assign({}, PRICES, { family: 500, dueRule: "sunday", dueTz: "America/New_York" });
const NO_PLAN = { block: { reason: "no-plan", text: "Pick a plan to submit." } };
// GET /billing's answer, as the worker's billingBody writes it (tag: which answer this is, for the test).
const base = (o) => Object.assign({ on: true, mode: "live", exempt: null, plan: null, nextPlan: null, block: null, now: Date.now(), prices: PRICES, sub: null,
  lines: [], owed: 0, overdue: 0, paid30: 0, payments: [], report: null }, o);
const SUB = (o) => Object.assign({ status: "active", cancelAtEnd: false, extras: 0, paused: false, periodEnd: Date.now() + 20 * DAY, slots: 10 }, o);
const W = { billing: base({}), plans: [], checkouts: [], reports: [], limit: { limit: 20, request: null, canRequest: true } };
const offered = () => !Array.isArray(W.billing.plans) || W.billing.plans.includes("monthly");
const GONE = { error: "The monthly plan isn't offered any more." };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/billing" && m === "GET") return json(route, 200, W.billing);
  // Picking a plan: the monthly one only while it's offered (the worker's 409 otherwise).
  if (p === "/billing/plan" && m === "POST") {
    const b = JSON.parse(req.postData()); W.plans.push(b);
    if (b.plan === "monthly" && !offered()) return json(route, 409, GONE);
    W.billing = Object.assign({}, W.billing, { plan: b.plan, block: null, tag: W.billing.tag + 0.5 });
    return json(route, 200, W.billing);
  }
  // Stripe's actions: Cancel plan and Pay now stay, the monthly plan, its extra slots and Resume are refused once it's gone.
  if (p === "/billing/checkout" && m === "POST") {
    const b = JSON.parse(req.postData()); W.checkouts.push(b);
    if (b.kind === "cancel") {
      W.billing = Object.assign({}, W.billing, { nextPlan: b.then, sub: Object.assign({}, W.billing.sub, { cancelAtEnd: true }), tag: W.billing.tag + 0.5 });
      return json(route, 200, W.billing);
    }
    if (["monthly", "extras", "resume"].includes(b.kind) && !offered()) return json(route, 409, GONE);
    return json(route, 200, { url: "https://checkout.stripe.com/c/pay/sample", pay: "" });
  }
  // Checkouts on the buyer's own accounts, reported by their FAFO.
  if (p === "/billing/checkouts" && m === "POST") { const b = JSON.parse(req.postData()); W.reports.push(b); return json(route, 200, { added: (b.orders || []).length }); }
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/slots/limit") return json(route, 200, W.limit);
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  return json(route, 404, {});
}

const browser = await chromium.launch();
// In Tokyo's time zone, where a Sunday's last moment in Eastern time is already Monday afternoon: the due dates must still
// read as the Sunday.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "Asia/Tokyo" });
await ctx.route("**/*", async (route) => {
  const req = route.request(), u = new URL(req.url());
  // The page as the web version serves it; the license worker at either of its addresses; nothing else from outside.
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
  return route.fulfill({ status: 404, body: "" });
});
// The setup guide (1.9.145) doesn't ask here (Not now, until far ahead): its own test is walkthrough.test.mjs.
await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const mainText = () => page.$eval("#main", (e) => e.textContent.replace(/\s+/g, " "));
const has = (sel) => page.$(sel).then((e) => !!e);
const cards = () => page.$$eval("#main .inv-plan", (els) => els.map((e) => e.querySelector(".inv-name").textContent));
const sub = () => page.$eval("#main .view-sub", (e) => e.textContent);
const layerText = () => page.$eval("#layers .panel", (e) => e.textContent.replace(/\s+/g, " "));
const toastSays = (re) => page.waitForFunction((src) => [...document.querySelectorAll("#toasts .toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const focused = (id) => page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id);
// Words that offer the monthly plan or its extra slots.
const MONTHLY = /monthly|a month|subscri|more slots|15 slots/i;
// The worker answers this from now on, and the page has taken it (asked again until it has: one asked before may be out).
let tag = 0;
async function answer(o) {
  W.billing = base(Object.assign({ tag: ++tag }, o));
  for (let i = 0; i < 50; i++) {
    if (await ev(async (n) => { await window.__t.refreshBilling(true); const d = window.__t.BILL.d; return !!d && d.tag === n; }, tag)) return;
  }
  throw new Error("the page didn't take answer " + tag);
}
// A window opened from the page's code, its text, then closed.
async function windowOf(fn, arg) {
  await ev(fn, arg);
  await page.waitForSelector("#layers .panel");
  const out = { text: await layerText(), inv: await has("#sl-inv"), req: await has("#sl-req"), title: await page.$eval("#layers .panel-head h2", (e) => e.textContent) };
  await ev(() => window.__t.closeAllLayers());
  await page.waitForFunction(() => !document.querySelector("#layers .panel"));
  return out;
}

console.log(`Invoice's plans in ${file.split(/[\\/]/).pop()}`);
try {
  if (TIERS) await test("order alerts carry the amount before tax (sub): the Subtotal, else qty × the unit price, else none", alertEventsTest);
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await focused("pw1");
  await page.fill("#pw1", "sample-pass-143"); await page.fill("#pw2", "sample-pass-143"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  W.billing = base(Object.assign({ tag: ++tag, plans: ["checkout"] }, NO_PLAN));
  await ev((lic) => { const T = window.__t; T.keepTypedLic(lic); T.persist(); T.render(); }, LIC);
  await answer(Object.assign({ plans: ["checkout"] }, NO_PLAN));
  await page.waitForSelector('#side [data-id="invoice"]');
  await page.click('#side [data-id="invoice"]');
  await page.waitForSelector("#main .inv-plan");

  await test("plans [\"checkout\"], no plan picked: only the Pay per checkout card, at $5, and nothing monthly", async () => {
    assert.deepEqual(await cards(), ["Pay per checkout"]);
    const t = await mainText();
    assert.match(t, /\$5 per checkout/);
    assert.match(t, /Your seller charges per checkout\. Until you choose it, Submit stays off\./);
    assert.doesNotMatch(t, MONTHLY);
    assert.ok(!(await has("#inv-extra")) && !(await has('#main [data-act="bill-subscribe"]')), "no Subscribe, no extra slots");
    assert.equal(await page.$eval('#main [data-act="bill-plan-checkout"]', (e) => e.textContent), "Pay per checkout");
  });

  await test("the price is the worker's: $10 when it says 1000", async () => {
    await answer(Object.assign({ plans: ["checkout"], prices: Object.assign({}, PRICES, { checkout: 1000 }) }, NO_PLAN));
    assert.match(await mainText(), /\$10 per checkout/);
    await answer(Object.assign({ plans: ["checkout"] }, NO_PLAN));
  });

  await test("its button sends /billing/plan {plan:\"checkout\"}, and the pay per checkout page offers no switch to monthly", async () => {
    const n = W.plans.length;
    await page.click('#main [data-act="bill-plan-checkout"]');
    await page.waitForFunction(() => /Pay per checkout · /.test((document.querySelector("#main .view-sub") || {}).textContent || ""));
    assert.deepEqual(W.plans.slice(n), [{ plan: "checkout" }]);
    assert.equal(await sub(), "Pay per checkout · $5 each");
    assert.ok(!(await has('#main [data-act="bill-monthly"]')), "no Switch to the monthly plan");
    assert.doesNotMatch(await mainText(), MONTHLY);
    await toastSays(/You pay per checkout now/);
  });

  await test("plans [\"checkout\", \"monthly\"]: both cards, the extra 15 slots, and Switch to the monthly plan on pay per checkout", async () => {
    await answer(Object.assign({ plans: ["checkout", "monthly"] }, NO_PLAN));
    assert.deepEqual(await cards(), ["Pay per checkout", "Monthly"]);
    const t = await mainText();
    assert.match(t, /Pick how you pay\. Until you do, Submit stays off\./);
    assert.match(t, /\$25 a month/); assert.match(t, /Add 15 more slots/);
    assert.ok(await has('#main [data-act="bill-subscribe"]'));
    await answer({ plans: ["checkout", "monthly"], plan: "checkout" });
    assert.ok(await has('#main [data-act="bill-monthly"]'), "Switch to the monthly plan");
  });

  await test("an answer without plans (an older worker) offers both, as before", async () => {
    await answer(Object.assign({}, NO_PLAN));
    assert.deepEqual(await cards(), ["Pay per checkout", "Monthly"]);
    await answer({ plan: "checkout" });
    assert.ok(await has('#main [data-act="bill-monthly"]'));
  });

  await test("a subscriber keeps the plan, Cancel plan and Pay now, with no extra slots, no Resume, no switch to monthly", async () => {
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB() });
    assert.equal(await sub(), "Monthly subscription plan");
    assert.ok(await has('#main [data-act="bill-cancel"]'), "Cancel plan");
    for (const a of ["bill-extra-add", "bill-extra-remove", "bill-resume", "bill-monthly", "bill-subscribe"]) assert.ok(!(await has(`#main [data-act="${a}"]`)), a);
    assert.doesNotMatch(await mainText(), /more slots|Add 15|extra/i);
    assert.match(await mainText(), /\$25 a month · 10 slots/);
    // Stripe couldn't take a payment: Pay now, and still Cancel plan.
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB({ status: "past_due" }), block: { reason: "past-due", text: "Your monthly payment didn't go through." } });
    assert.equal(await page.$eval('#main [data-act="bill-invoice"]', (e) => e.textContent), "Pay now");
    assert.ok(await has('#main [data-act="bill-cancel"]'));
    assert.ok(!(await has('#main [data-act="bill-extra-add"]')) && !(await has('#main [data-act="bill-extra-remove"]')));
    // The extra 15 slots they have can't be removed either.
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB({ extras: 1, slots: 25 }) });
    assert.ok(!(await has('#main [data-act="bill-extra-remove"]')));
    assert.match(await mainText(), /\$50 a month · 25 slots/);
    // While the plan's offered, as before: Add 15 slots.
    await answer({ plans: ["checkout", "monthly"], plan: "monthly", sub: SUB() });
    assert.ok(await has('#main [data-act="bill-extra-add"]'));
  });

  await test("Cancel plan goes to the worker, and a plan set to end has no Keep my plan", async () => {
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB() });
    const n = W.checkouts.length;
    await page.click('#main [data-act="bill-cancel"]');
    await page.waitForSelector("#bc-go");
    assert.doesNotMatch(await layerText(), /monthly plan, \$|more slots/);
    await page.click("#bc-go");
    await page.waitForFunction(() => /Ends /.test(document.querySelector("#main").textContent));
    assert.deepEqual(W.checkouts.slice(n), [{ kind: "cancel", then: "checkout" }]);
    assert.ok(!(await has('#main [data-act="bill-resume"]')), "no Keep my plan");
    assert.ok(await has('#main [data-act="bill-change"]'), "Change what comes after");
    await answer({ plans: ["checkout", "monthly"], plan: "monthly", sub: SUB({ cancelAtEnd: true }), nextPlan: "checkout" });
    assert.ok(await has('#main [data-act="bill-resume"]'), "Keep my plan while it's offered");
    // Friends and Family with a plan from before, set to end: no Keep my plan either.
    await answer({ plans: ["checkout"], exempt: "family", plan: "monthly", sub: SUB({ cancelAtEnd: true }) });
    assert.match(await mainText(), /Nothing to pay/);
    assert.ok(!(await has('#main [data-act="bill-resume"]')));
  });

  await test("monthly with no subscription left counts as no plan: Pay per checkout only, and Submit's window asks the seller", async () => {
    // The plan kept as monthly (the worker sends none for it, but the page doesn't count on that), or none with a
    // subscription still being set up, which isn't offered to finish any more.
    for (const [plan, s] of [["monthly", null], [null, SUB({ status: "incomplete" })]]) {
      await answer(Object.assign({ plans: ["checkout"], plan, sub: s }, NO_PLAN));
      assert.deepEqual(await cards(), ["Pay per checkout"], JSON.stringify(s));
      assert.doesNotMatch(await mainText(), MONTHLY);
      assert.ok(!(await has('#main [data-act="bill-invoice"]')), "no Finish payment");
      assert.equal(await ev(() => window.__t.billMonthly()), false);
    }
    const w = await windowOf(() => window.__t.slotLimitDialog());
    assert.ok(w.req, "Request more slots"); assert.ok(!w.inv); assert.doesNotMatch(w.text, /Invoice/);
    // While the plan's offered, as before: a monthly plan with no subscription is still the monthly one, and one being set
    // up has Finish payment.
    await answer({ plans: ["checkout", "monthly"], plan: "monthly", sub: null });
    assert.equal(await sub(), "Monthly subscription plan");
    assert.equal(await ev(() => window.__t.billMonthly()), true);
    await answer({ plans: ["checkout", "monthly"], plan: null, sub: SUB({ status: "incomplete" }), block: { reason: "setting-up", text: "Your monthly plan is being set up on Stripe." } });
    assert.equal(await page.$eval('#main [data-act="bill-invoice"]', (e) => e.textContent), "Finish payment");
  });

  await test("Submit's windows on a subscriber's plan offer no extra slots once the plan isn't offered", async () => {
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB() });
    W.limit = { limit: 10, request: null, canRequest: false };
    await ev(() => window.__t.refreshSlotAllow(true));
    let w = await windowOf(() => window.__t.slotLimitDialog());
    assert.ok(!w.inv && !w.req, "no Open Invoice, no Request more slots");
    assert.match(w.text, /Your plan has 10 slots/); assert.doesNotMatch(w.text, /add 15|Invoice/i);
    assert.doesNotMatch(await ev(() => window.__t.slotAllowHTML()), /Invoice/);
    await answer({ plans: ["checkout", "monthly"], plan: "monthly", sub: SUB() });
    w = await windowOf(() => window.__t.slotLimitDialog());
    assert.ok(w.inv); assert.match(w.text, /add 15 slots in Invoice/);
    assert.match(await ev(() => window.__t.slotAllowHTML()), /Add 15 slots in Invoice/);
    W.limit = { limit: 20, request: null, canRequest: true };
    await ev(() => window.__t.refreshSlotAllow(true));
  });

  await test("the window Submit opens when the seller needs a plan doesn't offer monthly, and its button picks pay per checkout", async () => {
    await answer(Object.assign({ plans: ["checkout"] }, NO_PLAN));
    const n = W.plans.length;
    await ev(() => window.__t.billingBlockDialog({ reason: "no-plan", text: "Pick a plan to submit." }));
    await page.waitForSelector("#bb-go");
    assert.equal(await page.$eval("#layers .panel-head h2", (e) => e.textContent), "Choose pay per checkout first");
    const t = await layerText();
    assert.match(t, /Pay per checkout is \$5 for each order/); assert.doesNotMatch(t, MONTHLY);
    await page.click("#bb-go");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.deepEqual(W.plans.slice(n), [{ plan: "checkout" }]);
    await answer(Object.assign({ plans: ["checkout", "monthly"] }, NO_PLAN));
    const w = await windowOf(() => window.__t.billingBlockDialog({ reason: "no-plan", text: "Pick a plan to submit." }));
    assert.equal(w.title, "Pick a plan first"); assert.match(w.text, /Invoice also has the monthly plan, \$25 for 10 slots/);
  });

  await test("a monthly button drawn before the plan went asks the worker nothing and says so", async () => {
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB({ cancelAtEnd: true }) });
    const n = W.checkouts.length, p = W.plans.length;
    for (const act of ["bill-subscribe", "bill-monthly", "bill-extra-add", "bill-extra-remove", "bill-resume"]) {
      await ev((a) => { const b = document.createElement("button"); b.dataset.act = a; b.id = "stale"; document.querySelector("#main").appendChild(b); b.click(); }, act);
      await toastSays(/The monthly plan isn't offered any more\./);
      assert.ok(!(await has("#layers .panel")), act + " opened nothing");
      await ev(() => { const b = document.querySelector("#stale"); if (b) b.remove(); document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); });
    }
    await page.waitForTimeout(300);
    assert.equal(W.checkouts.length, n); assert.equal(W.plans.length, p);
  });

  await test("this device keeps the plans offered and whether a subscription is left, for the next unlock", async () => {
    await answer({ plans: ["checkout"], plan: "monthly", sub: SUB() });
    const kept = await ev(() => JSON.parse(localStorage.getItem("orbit-billing")));
    assert.deepEqual([kept.plans, kept.sub, kept.plan], [["checkout"], true, "monthly"]);
    assert.ok(!("lines" in kept) && !("prices" in kept), "no amounts kept");
    // Read back alone, as at unlock before the worker answers: still the monthly plan, still not offered.
    const alone = (k) => ev((k) => { const T = window.__t, d = T.BILL.d, m = T.billMem; T.BILL.d = null;
      try { T.billMem = JSON.parse(JSON.stringify(Object.assign({}, m, k))); const b = T.billRead(); return [b === T.billMem, T.billMonthly(), T.billMonthlyOffered(b), T.billPlan(b)]; }
      finally { T.BILL.d = d; T.billMem = m; } }, k);
    assert.deepEqual(await alone({}), [true, true, false, "monthly"]);
    assert.deepEqual(await alone({ sub: false }), [true, false, false, null]);
    // One an older page kept (no plans, nor sub): as before.
    assert.deepEqual(await alone({ sub: undefined, plans: undefined }), [true, true, true, "monthly"]);
    await answer({ plans: ["checkout"], plan: "checkout" });
  });

  if (SUNDAY) {
    // Sunday Nov 15 2026, 23:59:59.999 Eastern (EST): Monday 00:00 less 1 ms, as the worker stores a due date.
    const SUN_NOV15 = Date.parse("2026-11-16T04:59:59.999Z");
    const line = (o) => Object.assign({ id: "l" + Math.random().toString(36).slice(2, 8), store: "target", storeName: "", orderNo: "1000000001", item: "Sample Booster Bundle", qty: 1,
      orderAt: "2026-11-10", source: "alert", amount: 500, createdAt: Date.now() - DAY, dueAt: SUN_NOV15, state: "due", paidAt: null, acctHash: null, profile: "Sample 1", disputable: false }, o);
    const dueCells = () => page.$$eval("#main .inv-table tbody tr", (trs) => trs.map((tr) => { const td = tr.querySelectorAll("td")[5], sp = td.querySelector("span"); return [td.textContent.trim(), sp ? sp.title : ""]; }));
    const dueHead = () => page.$eval("#main .inv-table thead th:nth-child(6)", (e) => [e.textContent, e.style.width]);
    const clearToasts = () => ev(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
    // Waits for a request the page sends to the pretend worker (n: how many there were before).
    const sentAfter = async (list, n) => { for (let i = 0; i < 100 && list.length === n; i++) await page.waitForTimeout(50); return list.slice(n); };

    await test("Sunday rule: the plan card and the pay per checkout page say due by the end of the Sunday after it (Eastern time), and from Monday it's overdue", async () => {
      await answer(Object.assign({ plans: ["checkout"], prices: PRICES_SUN }, NO_PLAN));
      let t = await mainText();
      assert.match(t, /Each is due by the end of the Sunday after it \(Eastern time\), and free if the store cancels it before you pay\./);
      assert.doesNotMatch(t, /3 days/);
      await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_SUN });
      t = await mainText();
      assert.equal(await sub(), "Pay per checkout · $5 each");
      assert.match(t, /Each checkout is \$5, due by the end of the Sunday after it \(Eastern time\)\. From Monday it's overdue and Submit turns off until it's paid\./);
      assert.doesNotMatch(t, /3 days|An overdue checkout turns Submit off/);
    });

    await test("the Due by column shows each due date as its Sunday in Eastern time (Tokyo's own date is Monday), across daylight saving", async () => {
      // This computer's own date for it is Monday Nov 16 (the reason for Eastern time).
      assert.equal(await ev((ms) => window.__t.billDay(ms), SUN_NOV15), "Nov 16");
      const due = [
        [SUN_NOV15, "Sun, Nov 15"],
        [SUN_NOV15 + 1, "Sun, Nov 15"],                              // Monday 00:00 itself is the Sunday it ends
        [Date.parse("2026-11-02T04:59:59.999Z"), "Sun, Nov 1"],      // the day daylight saving ends
        [Date.parse("2027-03-15T03:59:59.999Z"), "Sun, Mar 14"],     // the day it starts (EDT)
        [Date.parse("2027-11-08T04:59:59.999Z"), "Sun, Nov 7"],
      ];
      const lines = due.map(([dueAt], i) => line({ orderNo: "100000001" + i, dueAt, state: i === 1 ? "overdue" : "due" }))
        .concat([line({ orderNo: "1000000019", state: "paid", paidAt: Date.now() - DAY, dueAt: SUN_NOV15 })]);
      await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_SUN, lines, owed: 2500, overdue: 500, paid30: 500 });
      const cells = await dueCells();
      assert.deepEqual(cells.map((c) => c[0]), due.map((x) => x[1]).concat(["—"]));
      assert.equal(cells[0][1], "Due by the end of Sun, Nov 15, Eastern time");
      assert.deepEqual(await dueHead(), ["Due by", "10%"]);
      for (const [ms, want] of due) assert.equal(await ev((x) => window.__t.billDueDay(x), ms), want);
    });

    await test("Submit's note, a new checkout's notice and the day's reminder name the Sunday in Eastern time", async () => {
      await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_SUN, lines: [line({})], owed: 500 });
      assert.match(await ev(() => window.__t.billSubmitNote()), /\$5 due by Sun, Nov 15 · /);
      // The reminder on the day says the time, in Eastern time.
      assert.equal(await ev((ms) => window.__t.billDueWhen(ms, { prices: { dueRule: "sunday" } }), SUN_NOV15), "Sun, Nov 15, 11:59 PM EST");
      // A checkout new to this device: its toast names the Sunday.
      await clearToasts();
      await ev((l) => window.__t.billNotices({ prices: { dueRule: "sunday" }, lines: [l] }), line({ createdAt: Date.now() + 30 * DAY }));
      await toastSays(/1 checkout added to your invoice · \$5 due by Sun, Nov 15/);
      await clearToasts();
    });

    await test("Friends and Family who pay: the pay per checkout page at their price, no plan cards and no monthly plan", async () => {
      const lines = [line({ orderNo: "2000000001" }), line({ orderNo: "2000000002", state: "paid", paidAt: Date.now() - DAY })];
      await answer({ plans: ["checkout", "monthly"], family: true, exempt: null, plan: "checkout", prices: PRICES_SUN, lines, owed: 500, paid30: 500 });
      assert.equal(await sub(), "Friends and Family · $5 per checkout");
      assert.equal(await page.$$eval("#main .inv-plan", (e) => e.length), 0, "no plan cards");
      assert.ok(await has('#main [data-act="bill-pay"]'), "Pay");
      assert.ok(await has("#main .inv-table"), "the checkouts");
      assert.ok(!(await has('#main [data-act="bill-monthly"]')), "no Switch to the monthly plan, even with it offered");
      assert.doesNotMatch(await mainText(), MONTHLY);
      assert.match(await mainText(), /Each checkout is \$5, due by the end of the Sunday after it \(Eastern time\)\./);
      assert.equal(await ev(() => window.__t.billMonthly()), false);
      assert.equal(await ev(() => window.__t.billBadge()), 1);
      assert.equal(await page.$eval('#side [data-id="invoice"] .n', (e) => e.textContent), "1");
      // Their price is the worker's, and a plan the worker didn't name is still pay per checkout.
      await answer({ plans: ["checkout"], family: true, exempt: null, plan: null, prices: Object.assign({}, PRICES_SUN, { checkout: 1000 }), lines, owed: 1000 });
      assert.equal(await sub(), "Friends and Family · $10 per checkout");
      // Their $5 checkout still to pay keeps its price, and the line under the table says the price is for new ones.
      assert.match(await mainText(), /Each new checkout is \$10 \(ones already on your invoice keep their price\), due by the end of the Sunday after it/);
      assert.equal(await page.$$eval("#main .inv-plan", (e) => e.length), 0);
      assert.equal(await ev(() => window.__t.billPlan(window.__t.BILL.d)), "checkout");
      // Overdue: Submit's window has them pay it.
      const w = await windowOf(() => window.__t.billingBlockDialog({ reason: "overdue", text: "A checkout is overdue. Pay it to submit again." }));
      assert.equal(w.title, "Pay what's overdue");
      // This device keeps that they're Friends and Family, and another tab's answer that only says so is news.
      const kept = await ev(() => JSON.parse(localStorage.getItem("orbit-billing")));
      assert.equal(kept.family, true);
      assert.ok(!("lines" in kept) && !("prices" in kept), "no amounts kept");
      assert.notEqual(await ev((k) => window.__t.billSum(k), kept), await ev((k) => window.__t.billSum(Object.assign({}, k, { family: false })), kept));
    });

    await test("Friends and Family who pay report checkouts on their own accounts; ones not charged (exempt \"family\") don't", async () => {
      const email = "sample.buyer@example.com", hash = createHash("sha256").update("acct:" + email).digest("hex");
      await ev((e) => { window.__t.S.orders = (window.__t.S.orders || []).concat([{ id: "o-bill-test", orderNo: "3000000001", at: "2026-11-10", stage: "placed", store: "target", sentTo: e, item: "Sample Elite Trainer Box", qty: "1" }]); }, email);
      try {
        const report = { from: "2026-11-01", accts: [hash] };
        await answer({ plans: ["checkout"], family: true, exempt: "family", plan: null, prices: Object.assign({}, PRICES_SUN, { checkout: 0, family: 0 }), report });
        let n = W.reports.length;
        await ev(() => window.__t.reportCheckouts());
        assert.equal(W.reports.length, n, "nothing reported while they aren't charged");
        await answer({ plans: ["checkout"], family: true, exempt: null, plan: "checkout", prices: PRICES_SUN, report });
        n = W.reports.length;
        await ev(() => window.__t.reportCheckouts());
        const sent = (await sentAfter(W.reports, n)).flatMap((b) => b.orders);
        assert.deepEqual(sent.filter((x) => x.orderNo === "3000000001").map((x) => [x.account, x.store, x.stage]), [[email, "target", "placed"]]);
        assert.deepEqual(await ev(() => window.__t.S.orders.find((o) => o.id === "o-bill-test").billTold), { placed: 1 });
      } finally {
        await ev(() => { window.__t.S.orders = window.__t.S.orders.filter((o) => o.id !== "o-bill-test"); });
      }
    });

    await test("Friends and Family with a monthly plan from before: it shows, paused, with Cancel plan, and cancelling keeps them on pay per checkout", async () => {
      await answer({ plans: ["checkout"], family: true, exempt: null, plan: "checkout", prices: PRICES_SUN, sub: SUB({ paused: true }) });
      assert.equal(await sub(), "Friends and Family · $5 per checkout");
      assert.match(await mainText(), /Monthly plan · paused while you're Friends and Family/);
      const n = W.checkouts.length;
      await page.click('#main [data-act="bill-cancel"]');
      await page.waitForSelector("#cf-go");
      const t = await layerText();
      assert.match(t, /As Friends and Family you go on paying \$5 per checkout, as you do now\./);
      assert.doesNotMatch(t, /nothing is charged/);
      await page.click("#cf-go");
      assert.deepEqual(await sentAfter(W.checkouts, n), [{ kind: "cancel", then: "checkout" }]);
      await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    });

    await test("Friends and Family not charged (exempt \"family\": a worker before 1.9.144's answer, never 1.9.144's): nothing to pay, no count, as before", async () => {
      await answer({ plans: ["checkout"], family: true, exempt: "family", plan: null, prices: Object.assign({}, PRICES_SUN, { checkout: 0, family: 0 }) });
      assert.equal(await sub(), "Friends and Family");
      assert.match(await mainText(), /Nothing to pay/);
      assert.match(await mainText(), /Your seller doesn't charge you\./);
      assert.equal(await ev(() => window.__t.billBadge()), "");
      // With a plan from before, Cancel plan says nothing is charged, and sends no plan for after.
      await answer({ plans: ["checkout"], family: true, exempt: "family", plan: null, prices: Object.assign({}, PRICES_SUN, { checkout: 0, family: 0 }), sub: SUB({ paused: true }) });
      assert.match(await mainText(), /Monthly plan · no charge while you're Friends and Family/);
      await page.click('#main [data-act="bill-cancel"]');
      await page.waitForSelector("#cf-go");
      assert.match(await layerText(), /You're Friends and Family, so nothing is charged meanwhile or after\./);
      const n = W.checkouts.length;
      await page.click("#cf-go");
      assert.deepEqual(await sentAfter(W.checkouts, n), [{ kind: "cancel", then: null }]);
      await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    });

    await test("an older worker's answer (no dueRule, no family): what 1.9.143 showed, 3 days and this computer's own dates", async () => {
      await answer(Object.assign({ plans: ["checkout"] }, NO_PLAN));
      assert.match(await mainText(), /Each is due 3 days after it, and free if the store cancels it before you pay\./);
      assert.doesNotMatch(await mainText(), /Sunday|Eastern/);
      await answer({ plans: ["checkout"], plan: "checkout", lines: [line({})], owed: 500 });
      const t = await mainText();
      assert.equal(await sub(), "Pay per checkout · $5 each");
      assert.match(t, /Each checkout is \$5, due 3 days after it\. An overdue checkout turns Submit off until it's paid\./);
      assert.doesNotMatch(t, /Sunday|Eastern|From Monday/);
      assert.deepEqual(await dueCells(), [["Nov 16", ""]]);
      assert.deepEqual(await dueHead(), ["Due by", "8%"]);
      assert.match(await ev(() => window.__t.billSubmitNote()), /\$5 due by Nov 16 · /);
      assert.equal(await ev((ms) => window.__t.billDueWhen(ms, { prices: {} }), SUN_NOV15), new Date(SUN_NOV15).toLocaleString("en-US", { timeZone: "Asia/Tokyo", weekday: "short", hour: "numeric", minute: "2-digit" }));
      // Friends and Family there are all exempt "family": nothing to pay.
      await answer({ plans: ["checkout"], exempt: "family", plan: null });
      assert.match(await mainText(), /Nothing to pay/);
      const kept = await ev(() => JSON.parse(localStorage.getItem("orbit-billing")));
      assert.equal(kept.family, false);
    });

    await test("the seller's Settings → Billing says Friends and Family always pay $5, and the Sunday rule, or says what an older worker does", async () => {
      await answer({ exempt: "owner", plans: ["checkout"], prices: Object.assign({}, PRICES_SUN, { checkout: 1000 }) });
      let h = await ev(() => window.__t.billingSectionHTML());
      assert.match(h, /are Friends and Family: they always pay \$5 per checkout\. Your own FAFO is never charged\. Checkouts are due by the end of the Sunday after them, Eastern time\./);
      assert.doesNotMatch(h, /Friends and Family and aren't charged|billing page|\$0/);
      // Never from the 1.9.144 worker: prices.family 0.
      await answer({ exempt: "owner", plans: ["checkout"], prices: Object.assign({}, PRICES_SUN, { family: 0 }) });
      h = await ev(() => window.__t.billingSectionHTML());
      assert.match(h, /are Friends and Family: they aren't charged\. Your own FAFO is never charged\./);
      assert.doesNotMatch(h, /billing page|\$0/);
      await answer({ exempt: "owner", plans: ["checkout"] });
      h = await ev(() => window.__t.billingSectionHTML());
      assert.match(h, /Plans, invoices and Friends and Family\. Buyers you approved before payments started are Friends and Family and aren't charged\.<\/p>/);
      await answer({ plans: ["checkout"], plan: "checkout" });
      await ev(() => window.__t.billOpen());
    });

    if (TIERS) {
      // ---- Prices by the order's amount before tax (1.9.154) ----
      const TIER_LIST = [{ below: 5000, price: 500 }, { below: 10000, price: 1000 }, { below: 15000, price: 1500 }, { below: 20000, price: 2000 }, { below: null, price: 2500 }];
      const PRICES_T = Object.assign({}, PRICES_SUN, { checkout: 1000, unknown: 1000, tiers: TIER_LIST });
      const SUMMARY = "$5 under $50, $10 from $50, $15 from $100, $20 from $150 and $25 from $200, by the order's amount before tax";
      const basisCells = () => page.$$eval("#main .inv-table tbody tr", (trs) => trs.map((tr) => { const td = tr.querySelectorAll("td"), b = td[7].querySelector(".inv-basis");
        return [td[2].textContent.trim(), td[7].querySelector(".inv-amt").textContent, b ? b.textContent : null]; }));
      const amountHead = () => page.$eval("#main .inv-table thead th:nth-child(8)", (e) => e.style.width);
      const clean = () => ev(() => { const T = window.__t; T.S.orders = (T.S.orders || []).filter((o) => !/^5\d{9}$/.test(o.orderNo || "")); });

      await test("tiers, no plan picked: the Pay per checkout card says $5–$25 per checkout and lists each tier by the order's amount before tax", async () => {
        await answer(Object.assign({ plans: ["checkout"], prices: PRICES_T }, NO_PLAN));
        assert.deepEqual(await cards(), ["Pay per checkout"]);
        assert.equal(await page.$eval("#main .inv-plan .inv-price", (e) => e.textContent.replace(/\s+/g, " ").trim()), "$5–$25 per checkout");
        assert.deepEqual(await page.$$eval("#main .inv-tiers li", (lis) => lis.map((li) => [li.querySelector("span").textContent, li.querySelector("strong").textContent])),
          [["Under $50", "$5"], ["$50 to $99.99", "$10"], ["$100 to $149.99", "$15"], ["$150 to $199.99", "$20"], ["$200 and up", "$25"]]);
        const t = await mainText();
        assert.match(t, /By the order's amount before tax:/);
        assert.match(t, /Each is due by the end of the Sunday after it \(Eastern time\), and free if the store cancels it before you pay\./);
        assert.doesNotMatch(t, /\$10 per checkout/);
        assert.equal(await ev(() => window.__t.billTierSummary(window.__t.billTiers(window.__t.BILL.d))), SUMMARY);
      });

      await test("tiers, the window Submit opens with no plan names them", async () => {
        const w = await windowOf(() => window.__t.billingBlockDialog({ reason: "no-plan", text: "Pick a plan to submit." }));
        assert.equal(w.title, "Choose pay per checkout first");
        assert.match(w.text, new RegExp("Pay per checkout is \\$5 to \\$25 for each order your seller places on your slots: " + SUMMARY.replace(/\$/g, "\\$") + "\\."));
        assert.doesNotMatch(w.text, MONTHLY);
        // With no answer in memory (the worker didn't answer in time), no price is named.
        const t = await ev(async () => { const T = window.__t, d = T.BILL.d; T.BILL.d = null;
          try { T.billingBlockDialog({ reason: "no-plan", text: "Pick a plan to submit." }); return document.querySelector("#layers .panel:last-child").textContent.replace(/\s+/g, " "); }
          finally { T.BILL.d = d; T.closeAllLayers(); } });
        assert.match(t, /Pay per checkout charges you for each order your seller places on your slots\./);
        assert.doesNotMatch(t, /\$\d/);
        await page.waitForFunction(() => !document.querySelector("#layers .panel"));
      });

      await test("tiers, on pay per checkout: the heading, the line under the table, and what each checkout was priced on", async () => {
        const lines = [
          line({ orderNo: "1000000101", amount: 1000, basis: 5998, basisFrom: "sub" }),
          line({ orderNo: "1000000102", amount: 1000, basis: 5756, basisFrom: "total", basisTotal: "64.18" }),
          line({ orderNo: "1000000103", amount: 1000, basis: 5756, basisFrom: "total" }),
          line({ orderNo: "1000000104", amount: 1000, basis: null, basisFrom: null }),
          line({ orderNo: "1000000105", amount: 2500, basis: 123456, basisFrom: "owner", state: "overdue" }),
          line({ orderNo: "1000000106", amount: 500, basis: 4999, basisFrom: "sub", state: "paid", paidAt: Date.now() - DAY }),
        ];
        await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_T, lines, owed: 5500, overdue: 2500, paid30: 500 });
        assert.equal(await sub(), "Pay per checkout · $5 to $25 by order amount");
        const t = await mainText();
        assert.match(t, new RegExp("Each checkout is \\$5 to \\$25 by its amount before tax \\(\\$5 under \\$50, \\$10 from \\$50, \\$15 from \\$100, \\$20 from \\$150 and \\$25 from \\$200\\), "
          + "due by the end of the Sunday after it \\(Eastern time\\)\\. From Monday it's overdue and Submit turns off until it's paid\\."));
        assert.doesNotMatch(t, /keep their price|Each new checkout/);
        assert.deepEqual(await basisCells(), [
          ["#1000000101", "$10", "on $59.98 before tax"],
          ["#1000000102", "$10", "on about $57.56 before tax (from the $64.18 total)"],
          ["#1000000103", "$10", "on about $57.56 before tax"],
          ["#1000000104", "$10", "amount not known"],
          ["#1000000105", "$25", "on $1,234.56 before tax"],
          ["#1000000106", "$5", "on $49.99 before tax"],
        ]);
        assert.equal(await amountHead(), "13%");
        // A total in cents, as a number, reads the same.
        assert.equal(await ev(() => window.__t.billBasisNote({ basis: 5756, basisFrom: "total", basisTotal: 6418 })), "on about $57.56 before tax (from the $64.18 total)");
        assert.equal(await ev(() => window.__t.billBasisNote({ basis: 0, basisFrom: "sub" })), "amount not known");
        assert.equal(await ev(() => window.__t.billBasisNote({ basis: 5998, basisFrom: "other" })), "amount not known");
        assert.equal(await ev(() => window.__t.billBasisNote({ basis: 5998 })), "");
        // The kept answer has no prices or amounts.
        const kept = await ev(() => JSON.parse(localStorage.getItem("orbit-billing")));
        assert.ok(!("lines" in kept) && !("prices" in kept) && !("tiers" in kept), "no amounts kept");
      });

      await test("an older worker's answer (no tiers, no basisFrom): what 1.9.153 showed, the kept-price note included", async () => {
        await answer({ plans: ["checkout"], plan: "checkout", prices: Object.assign({}, PRICES_SUN, { checkout: 1000 }), lines: [line({ amount: 500 })], owed: 500 });
        assert.equal(await sub(), "Pay per checkout · $10 each");
        assert.match(await mainText(), /Each new checkout is \$10 \(ones already on your invoice keep their price\), due by the end of the Sunday after it \(Eastern time\)\./);
        assert.ok(!(await has("#main .inv-basis")), "no basis note");
        assert.equal(await amountHead(), "7%");
        // The same with tiers: no kept-price note (each row says what it was priced on).
        await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_T, lines: [line({ amount: 500 })], owed: 500 });
        assert.doesNotMatch(await mainText(), /keep their price|Each new checkout/);
        assert.ok(!(await has("#main .inv-basis")), "an older line has no basisFrom: no note");
      });

      await test("tiers for Friends and Family: their $5, as before", async () => {
        await answer({ plans: ["checkout"], family: true, exempt: null, plan: "checkout", prices: Object.assign({}, PRICES_T, { checkout: 500 }), lines: [line({ basis: 12000, basisFrom: "sub" })], owed: 500 });
        assert.equal(await sub(), "Friends and Family · $5 per checkout");
        const t = await mainText();
        assert.match(t, /Each checkout is \$5, due by the end of the Sunday after it \(Eastern time\)\./);
        assert.doesNotMatch(t, /\$25|by order amount|by its amount/);
        assert.equal(await page.$$eval("#main .inv-plan", (e) => e.length), 0);
        // Their price isn't by the amount, so no row says what it was priced on.
        assert.ok(!(await has("#main .inv-basis")), "no basis note for Friends and Family");
        assert.equal(await amountHead(), "7%");
      });

      await test("tiers: Cancel plan and Switch to pay per checkout name them; without tiers they name the one price, as before", async () => {
        await answer({ plans: ["checkout"], plan: "monthly", sub: SUB(), prices: PRICES_T });
        await page.click('#main [data-act="bill-cancel"]');
        await page.waitForSelector("#bc-go");
        assert.match(await layerText(), /Pay per checkout \(\$5 to \$25 each, by the order's amount before tax\)/);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
        await page.click('#main [data-act="bill-switch-checkout"]');
        await page.waitForSelector("#layers .panel");
        assert.match(await layerText(), /After that you pay \$5 to \$25 per checkout, by the order's amount before tax\./);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
        await answer({ plans: ["checkout"], plan: "monthly", sub: SUB({ status: "past_due" }), prices: PRICES_T });
        await page.click('#main [data-act="bill-switch-checkout"]');
        await page.waitForSelector("#layers .panel");
        assert.match(await layerText(), /Your monthly plan stops now, and from today you pay \$5 to \$25 per checkout, by the order's amount before tax\./);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
        // An older worker's: the one price.
        await answer({ plans: ["checkout"], plan: "monthly", sub: SUB(), prices: PRICES_SUN });
        await page.click('#main [data-act="bill-cancel"]');
        await page.waitForSelector("#bc-go");
        assert.match(await layerText(), /Pay per checkout \(\$5 each\)/);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
        await page.click('#main [data-act="bill-switch-checkout"]');
        await page.waitForSelector("#layers .panel");
        assert.match(await layerText(), /Your monthly plan stays on until .+\. After that you pay \$5 per checkout\./);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
        await answer({ plans: ["checkout"], plan: "monthly", sub: SUB({ status: "past_due" }), prices: PRICES_SUN });
        await page.click('#main [data-act="bill-switch-checkout"]');
        await page.waitForSelector("#layers .panel");
        assert.match(await layerText(), /Your monthly plan stops now, and you pay \$5 per checkout from today\./);
        await ev(() => window.__t.closeAllLayers()); await page.waitForFunction(() => !document.querySelector("#layers .panel"));
      });

      await test("the seller's Settings → Billing names the tiers, and the price when the amount isn't known", async () => {
        await answer({ exempt: "owner", plans: ["checkout"], prices: PRICES_T });
        const h = await ev(() => window.__t.billingSectionHTML());
        assert.match(h, /they always pay \$5 per checkout\. Your own FAFO is never charged\. Everyone else pays \$5 under \$50, \$10 from \$50, \$15 from \$100, \$20 from \$150 and \$25 from \$200, by the order's amount before tax \(your Billing page sets the price when the amount isn't known\)\. Checkouts are due by the end of the Sunday after them, Eastern time\./);
      });

      await test("billTiers takes only well-formed tiers (lowest first, the last with no upper bound); otherwise the page shows the one price", async () => {
        const t = (x) => ev((x) => window.__t.billTiers({ prices: { tiers: x } }), x);
        assert.deepEqual(await t(TIER_LIST), TIER_LIST);
        for (const bad of [[], null, "x", [{ below: 5000, price: 500 }], [{ below: 10000, price: 500 }, { below: 5000, price: 1000 }, { below: null, price: 2500 }],
          [{ below: 5000, price: 0 }, { below: null, price: 1000 }], [{ below: null, price: 500 }, { below: 5000, price: 1000 }], [{ below: 5000, price: "x" }, { below: null, price: 1000 }]]) assert.equal(await t(bad), null, JSON.stringify(bad));
        assert.deepEqual(await ev(() => window.__t.billTierRows([{ below: null, price: 700 }])), [["Any amount", "$7"]]);
        await answer(Object.assign({ plans: ["checkout"], prices: Object.assign({}, PRICES_SUN, { checkout: 1000, tiers: [{ below: 5000, price: 500 }] }) }, NO_PLAN));
        await ev(() => window.__t.billOpen());   // the seller's own answer before this one took Invoice away
        await page.waitForSelector("#main .inv-plan .inv-price");
        assert.equal(await page.$eval("#main .inv-plan .inv-price", (e) => e.textContent.replace(/\s+/g, " ").trim()), "$10 per checkout");
        assert.ok(!(await has("#main .inv-tiers")));
      });

      // ---- The amount before tax, from the order's email ----
      const EMAIL = (o) => [
        "Thanks for your order, Sam!", "From: Target <orders@oe.target.com>", "Order #" + (o.no || "5000000001"),
        "Delivers to:", "Sam Sample, 100 Sample St, Austin, TX 78701",
        "Sample Booster Bundle Collection", "Qty: " + (o.qty || "2"), o.each === "" ? "" : "$" + (o.each || "29.99") + " / ea",
        o.sub == null ? "Subtotal (2 items)\n\n$59.98" : o.sub,
        "Estimated tax", "$4.95", o.total == null ? "Total\n$64.93" : o.total, "Visa ****1234",
      ].join("\n");
      await test("an order email's Subtotal is kept as the order's subtotal, never as its total", async () => {
        const p = (txt) => ev((x) => { const r = window.__t.parseOrderEmail(x); return r && [r.total, r.subtotal, r.priceEach, r.qty]; }, txt);
        assert.deepEqual(await p(EMAIL({})), ["64.93", "59.98", "29.99", "2"]);
        assert.deepEqual(await p(EMAIL({ sub: "Subtotal: $59.98" })), ["64.93", "59.98", "29.99", "2"]);
        assert.deepEqual(await p(EMAIL({ sub: "Merchandise subtotal | $1,234.56" })), ["64.93", "1,234.56", "29.99", "2"]);
        // "Sub-total" (with a hyphen) isn't read as the total either, and an email whose only figure is a Subtotal has no total.
        assert.deepEqual(await p(EMAIL({ sub: "Sub-total: $59.98" })), ["64.93", "59.98", "29.99", "2"]);
        assert.deepEqual(await p(EMAIL({ sub: "Sub-total: $59.98", total: "" })), ["", "59.98", "29.99", "2"]);
        assert.deepEqual(await p(EMAIL({ sub: "Subtotal (2 items)\n\n$59.98", total: "" })), ["", "59.98", "29.99", "2"]);
        // None: no subtotal.
        assert.deepEqual(await p(EMAIL({ sub: "" })), ["64.93", "", "29.99", "2"]);
        // planOrderImport keeps it.
        const kept = await ev((x) => { const r = window.__t.parseOrderEmail(x); return window.__t.planOrderImport([r]).add.map((o) => [o.orderNo, o.subtotal, o.priceEach, o.total]); }, EMAIL({ no: "5000000002" }));
        assert.deepEqual(kept, [["5000000002", "59.98", "29.99", "64.93"]]);
      });

      await test("orderSubBeforeTax: the Subtotal, else qty × the unit price, else none", async () => {
        const f = (o) => ev((o) => window.__t.orderSubBeforeTax(o), o);
        assert.equal(await f({ subtotal: "59.98", qty: "2", priceEach: "10.00" }), "59.98");
        assert.equal(await f({ subtotal: "1,234.56" }), "1234.56");
        assert.equal(await f({ subtotal: "$59.98" }), "59.98");
        assert.equal(await f({ subtotal: "", qty: "3", priceEach: "29.99" }), "89.97");
        assert.equal(await f({ subtotal: "0.00", qty: "1", priceEach: "29.99" }), "29.99");
        assert.equal(await f({ priceEach: "29.99" }), "29.99");                      // qty defaults to 1
        assert.equal(await f({ qty: "2", priceEach: "" }), "");
        assert.equal(await f({ qty: "two", priceEach: "29.99" }), "");
        assert.equal(await f({ subtotal: "about 60", priceEach: "29.99", qty: "2" }), "59.98");   // not an amount: qty × unit price
        assert.equal(await f({ total: "64.93" }), "");
        assert.equal(await ev(() => [window.__t.moneyCents("59.9"), window.__t.moneyCents("1,234"), window.__t.moneyCents("12,34.00"), window.__t.moneyCents("$ 5")]).then(JSON.stringify), "[5990,123400,null,500]");
      });

      await test("a confirmation that comes after a later email fills in the subtotal", async () => {
        try {
          await ev(() => { const T = window.__t; T.S.orders = (T.S.orders || []).concat([{ id: "o-sub-1", store: "target", orderNo: "5000000003", item: "Order", qty: "2", total: "", priceEach: "", stage: "shipped", at: "2026-11-14" }]); });
          const fixed = await ev((x) => { const T = window.__t, r = T.parseOrderEmail(x); r.confirm = true; r.at = "2026-11-12"; return T.repairFromConfirmations([r]); }, EMAIL({ no: "5000000003" }));
          assert.equal(fixed, 1);
          assert.deepEqual(await ev(() => { const o = window.__t.S.orders.find((x) => x.id === "o-sub-1"); return [o.subtotal, o.total, o.priceEach]; }), ["59.98", "64.93", "29.99"]);
        } finally { await ev(() => { const T = window.__t; T.S.orders = T.S.orders.filter((o) => o.id !== "o-sub-1"); }); }
      });

      await test("checkouts reported on the buyer's own accounts carry the amount before tax (sub) and the total", async () => {
        const email = "sample.tiers@example.com", hash = createHash("sha256").update("acct:" + email).digest("hex");
        const ord = (x) => Object.assign({ at: "2026-11-14", stage: "placed", store: "target", sentTo: email, item: "Sample Booster Bundle", qty: "2", total: "64.93" }, x);
        await ev((list) => { window.__t.S.orders = (window.__t.S.orders || []).concat(list); }, [
          ord({ id: "o-t1", orderNo: "5000000011", subtotal: "59.98", priceEach: "29.99" }),
          ord({ id: "o-t2", orderNo: "5000000012", subtotal: "", priceEach: "29.99" }),
          ord({ id: "o-t3", orderNo: "5000000013", total: "" }),
          ord({ id: "o-t4", orderNo: "5000000014", priceEach: "29.99", total: "a total typed much longer than an amount" }),
        ]);
        try {
          await answer({ plans: ["checkout"], plan: "checkout", prices: PRICES_T, report: { from: "2026-11-01", accts: [hash] } });
          const n = W.reports.length;
          await ev(() => window.__t.reportCheckouts());
          const sent = (await sentAfter(W.reports, n)).flatMap((b) => b.orders).filter((x) => /^50000000/.test(x.orderNo));
          assert.deepEqual(sent.map((x) => [x.orderNo, x.sub, x.total]).sort(), [["5000000011", "59.98", "64.93"], ["5000000012", "59.98", "64.93"], ["5000000013", "", ""], ["5000000014", "59.98", ""]]);
          assert.deepEqual(Object.keys(sent[0]), ["account", "store", "orderNo", "at", "stage", "item", "qty", "sub", "total"]);
        } finally { await clean(); await ev(() => { const T = window.__t; T.S.orders = T.S.orders.filter((o) => !/^o-t\d$/.test(o.id)); }); }
        await answer({ plans: ["checkout"], plan: "checkout" });
      });
    }
  }

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
