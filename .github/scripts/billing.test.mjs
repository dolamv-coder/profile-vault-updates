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
//   node .github/scripts/billing.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must read plans (billMonthlyOffered) and the Sunday rule (billDueDay); a page named on the command line
// that doesn't read plans is skipped, and one that doesn't read the Sunday rule skips those tests.
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
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get billMem(){ return billMem; }, set billMem(v){ billMem = v; }, BILL, keepTypedLic, persist, render, renderMain, refreshBilling, billOpen, billRead, billPlan,"
  + " billMonthly, billMonthlyOffered, billingBlockDialog, slotLimitDialog, slotAllowHTML, closeAllLayers, refreshSlotAllow"
  + (SUNDAY ? ", billDay, billDueDay, billDueWhen, billSum, billNotices, billSubmitNote, billBadge, billingSectionHTML, reportCheckouts" : "") + "};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

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
  }

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
