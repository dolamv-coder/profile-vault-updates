// Tests the newest page's Invoice (index-X.Y.Z.html) against the plans the license worker offers, from 1.9.143: the owner
// removed the monthly plan (2026-11-12: "Remove $25 plan completely"), so GET /billing answers plans: ["checkout"], and the
// page offers no monthly plan or its extra 15 slots anywhere (Invoice, Submit's slot-limit windows, the window Submit opens
// when the seller needs a plan), while a buyer already on it keeps it with Cancel plan and Pay now. Only the worker's plans
// decides: ["checkout", "monthly"] offers both, and an answer without plans (an older worker) does too, as before. The real
// page runs in Chromium (Playwright), as the web version at app.fafoaco.com, against a pretend license worker, as
// interests.test.mjs runs it: a vault made with Use this browser only, then a license key kept as Submit keeps one typed
// there. Sample keys and amounts only.
//   node .github/scripts/billing.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must read plans (billMonthlyOffered); a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!/const billMonthlyOffered = /.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} doesn't read the worker's plans (billMonthlyOffered): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no plans from the worker, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get billMem(){ return billMem; }, set billMem(v){ billMem = v; }, BILL, keepTypedLic, persist, render, renderMain, refreshBilling, billOpen, billRead, billPlan,"
  + " billMonthly, billMonthlyOffered, billingBlockDialog, slotLimitDialog, slotAllowHTML, closeAllLayers, refreshSlotAllow};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const DAY = 86400000;
const PRICES = { checkout: 500, monthly: 2500, extra: 2500, monthlySlots: 10, extraSlots: 15, extraMax: 1, dueDays: 3 };
const NO_PLAN = { block: { reason: "no-plan", text: "Pick a plan to submit." } };
// GET /billing's answer, as the worker's billingBody writes it (tag: which answer this is, for the test).
const base = (o) => Object.assign({ on: true, mode: "live", exempt: null, plan: null, nextPlan: null, block: null, now: Date.now(), prices: PRICES, sub: null,
  lines: [], owed: 0, overdue: 0, paid30: 0, payments: [], report: null }, o);
const SUB = (o) => Object.assign({ status: "active", cancelAtEnd: false, extras: 0, paused: false, periodEnd: Date.now() + 20 * DAY, slots: 10 }, o);
const W = { billing: base({}), plans: [], checkouts: [], limit: { limit: 20, request: null, canRequest: true } };
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
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/slots/limit") return json(route, 200, W.limit);
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/*", async (route) => {
  const req = route.request(), u = new URL(req.url());
  // The page as the web version serves it; the license worker at either of its addresses; nothing else from outside.
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
  return route.fulfill({ status: 404, body: "" });
});
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

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
