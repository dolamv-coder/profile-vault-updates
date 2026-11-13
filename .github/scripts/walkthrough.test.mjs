// Tests the setup guide in the newest page (index-X.Y.Z.html), from 1.9.145 (the owner's request, 2026-11-13: "Can you create a
// step by step instruction on how to set up and submit a profile. Like a walk-through that ask if they need help setting up
// their profiles"). The real page runs in Chromium (Playwright), as the web version at app.fafoaco.com, against a pretend
// license worker, as interests.test.mjs and billing.test.mjs run it: vaults made with Use this browser only, some with a
// license key kept as Submit keeps one typed there. It checks the question after unlock (never a window, never the cursor),
// I know how, Not now and their lock and unlock, Walk me through it and the steps ticking themselves off as a profile is made
// in the editor, the highlight that follows Go to Submit, the Interests, Invoice, Submit and approval steps with a key, the
// seller's own FAFO (never asked, but Setup guide opens it), the profile editor's notes on how an account reaches the seller,
// a phone with the selection bar showing, and Escape. Sample names, cards and keys only.
//   node .github/scripts/walkthrough.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have the setup guide (paintGuide); a page named on the command line that doesn't is skipped.
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
if (!/function paintGuide\(/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no setup guide (paintGuide): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no setup guide, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, UI, keepTypedLic, persist, render, renderMain, refreshApprovals, refreshBilling, refreshPremium, refreshInterests,"
  + " isPremiumOwner, closeAllLayers, guideLocal, GUIDE};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const DAY = 86400000;
const PW = "sample-pass-145";

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const PRICES = { checkout: 500, family: 500, monthly: 2500, extra: 2500, monthlySlots: 10, extraSlots: 15, extraMax: 1, dueDays: 3, dueRule: "sunday", dueTz: "America/New_York" };
const billing = (o) => Object.assign({ on: true, mode: "live", exempt: null, plan: null, plans: ["checkout"], nextPlan: null, block: { reason: "no-plan", text: "Pick a plan to submit." },
  now: Date.now(), prices: PRICES, sub: null, lines: [], owed: 0, overdue: 0, paid30: 0, payments: [], report: null }, o);
const ITEMS = [{ sku: "11111111", store: "target", name: "Sample Booster Bundle", about: "Six sample booster packs.", set: "Sample Set", ref: "" }];
let W;
const fresh = (o) => (W = Object.assign({ premium: { premium: false, owner: false }, billing: { on: false }, interests: { rev: 1, owner: false, items: [] }, approved: false, subs: [], plans: [] }, o));
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/premium") return json(route, 200, W.premium);
  if (p === "/billing" && m === "GET") return json(route, 200, W.billing);
  if (p === "/billing/plan" && m === "POST") {
    const b = JSON.parse(req.postData()); W.plans.push(b);
    W.billing = Object.assign({}, W.billing, { plan: b.plan, block: null });
    return json(route, 200, W.billing);
  }
  if (p === "/interests" && m === "GET") return json(route, 200, u.searchParams.get("rev") === String(W.interests.rev) ? { rev: W.interests.rev, owner: W.interests.owner, same: true } : W.interests);
  if (p === "/slots/limit") return json(route, 200, { limit: 20, request: null, canRequest: true });
  if (p === "/submissions" && m === "POST") { W.subs.push(JSON.parse(req.postData())); return json(route, 200, { ok: true, id: "batch1", review: "pending" }); }
  if (p === "/submissions/status") return json(route, 200, { batches: W.approved ? { batch1: { status: "approved", at: Date.now() } } : {} });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
// A new browser (its own storage), a vault made with Use this browser only, and helpers for its page.
async function session(name, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + String(e)));
  const s = {
    ctx, page,
    ev: (fn, arg) => page.evaluate(fn, arg),
    // What #guide shows: "" (nothing), "ask", "open" or "pill".
    kind: () => page.$eval("#guide", (el) => (el.hidden ? "" : el.className.replace(/^guide-/, ""))),
    text: (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim()),
    steps: () => page.$$eval("#guide .guide-step", (els) => els.map((e) => ({ id: e.dataset.step, done: e.classList.contains("is-done"), cur: e.classList.contains("is-cur") }))),
    setting: () => page.evaluate(() => window.__t.S.settings.guide || null),
    hl: () => page.evaluate(() => document.documentElement.dataset.guideHl || ""),
    ready: () => page.waitForSelector('#mnav [data-id="orders"]', { state: "attached", timeout: 30000 }),   // the app is drawn (on a phone the sidebar is hidden)
    toastSays: (re) => page.waitForFunction((src) => [...document.querySelectorAll("#toasts .toast")].some((t) => new RegExp(src).test(t.textContent)), re.source),
    async relock() {
      await page.click('[data-act="lock"]');
      await page.waitForSelector("#pw1");
      await page.fill("#pw1", PW);   // the lock screen unlocks as the password is typed
      await s.ready();
    },
    // Nothing asked: the question comes 1.5 seconds after unlock, or not at all.
    async notAsked() { await page.waitForTimeout(2300); assert.equal(await s.kind(), ""); },
    cur: async () => ((await s.steps()).find((x) => x.cur) || {}).id || "",
    key: () => page.evaluate(async (lic) => { const T = window.__t; T.keepTypedLic(lic); T.persist(); T.render(); await T.refreshPremium(true); await T.refreshInterests(true); await T.refreshBilling(true); }, LIC),
    async close() { await ctx.close(); },
  };
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
  await s.ready();
  return s;
}
// A profile that's Ready to submit: Target on Use Assigned Account, with an address and a card (no card: needsCard).
const addProfile = (s, id, name, o = {}) => s.ev(([id, name, o]) => {
  const { S, persist, render } = window.__t;
  S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
  if (!S.cards.some((c) => c.id === "c1")) S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "07", expY: "2031", cvv: "123", holder: "Sam Sample" });
  S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: o.needsCard ? null : "c1", phone: "5125550100", stores: [{ store: "target", storeName: "", mode: "seller", loginId: null, email: "", verified: false }] });
  persist(); render();
}, [id, name, o]);

console.log(`The setup guide in ${file.split(/[\\/]/).pop()}`);
try {
  // ---- A: the question, I know how, Not now ----
  fresh();
  let s = await session("A");
  const focusAt = await s.ev(() => (document.activeElement === document.body ? "body" : document.activeElement.id || document.activeElement.tagName));
  await test("a fresh vault in this browser only: after unlock the question shows, with no window open and the cursor left where it was", async () => {
    await s.page.waitForSelector("#guide.guide-ask", { timeout: 6000 });
    assert.match(await s.text("#guide"), /^Need help setting up your profiles\? FAFO can walk you through it, step by step: make a profile, then send it to your seller\. Walk me through it Not now I know how$/);
    assert.equal(await s.page.$$eval("#layers > *", (els) => els.length), 0, "no window");
    assert.equal(await s.ev(() => (document.activeElement === document.body ? "body" : document.activeElement.id || document.activeElement.tagName)), focusAt);
    assert.ok(!(await s.ev(() => document.getElementById("guide").contains(document.activeElement))), "the cursor isn't in the guide");
    assert.equal(await s.ev(() => document.getElementById("guide").closest("#layers, .layer")), null, "not a window");
    const r = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(r.width <= 340 && r.height <= 200, "a small card: " + JSON.stringify(r));
    assert.ok(r.right <= 1280 - 15 && r.bottom <= 900 - 15, "in the bottom right corner: " + JSON.stringify(r));
  });
  await test("Not now: hidden for 24 hours on this device, not asked at the next unlock, asked again once that's past", async () => {
    await s.page.click('#guide [data-act="guide-later"]');
    assert.equal(await s.kind(), "");
    const later = await s.ev(() => JSON.parse(localStorage.getItem("orbit-guide")).later);
    assert.ok(Math.abs(later - (Date.now() + DAY)) < 60000, "about 24 hours ahead: " + (later - Date.now()));
    assert.equal(await s.setting(), null, "nothing synced");
    await s.relock(); await s.notAsked();
    await s.ev(() => localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.now() - 1000 })));
    await s.relock();
    await s.page.waitForSelector("#guide.guide-ask", { timeout: 6000 });
  });
  await test("I know how: hidden, the synced setting's off set, a toast says where it is, and no unlock asks again", async () => {
    await s.page.click('#guide [data-act="guide-never"]');
    assert.equal(await s.kind(), "");
    assert.ok((await s.setting()).off > Date.now() - 60000);
    await s.toastSays(/^You can open the setup guide any time from Profiles or Submit\.$/);
    await s.relock(); await s.notAsked();
    await s.ev(() => localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.now() - 1000 })));
    await s.relock(); await s.notAsked();
  });
  await test("Profiles' and Submit's Setup guide open it, as new (off taken off)", async () => {
    await s.page.click('#side [data-id="profiles"]');
    await s.page.click('#main .view-tools [data-act="guide-open"]');
    await s.page.waitForSelector("#guide.guide-open");
    assert.ok(!(await s.setting()).off, "off taken off");
    assert.match(await s.text("#guide .guide-head"), /^Setup guide 0 of 3 done$/);
    await s.page.click('#guide [data-act="guide-close"]');
    assert.equal(await s.kind(), "");
    assert.ok((await s.setting()).off > 0, "Close sets off");
    await s.page.click('#side [data-id="submit"]');
    await s.page.click('#main .view-tools [data-act="guide-open"]');
    await s.page.waitForSelector("#guide.guide-open");
  });
  await test("a later step's row opens its text in place of the current one's, and its button's ring stays", async () => {
    assert.equal(await s.cur(), "make");
    await s.page.click('#guide .guide-step[data-step="submit"] .guide-row');
    assert.equal(await s.page.$$eval("#guide .guide-body", (els) => els.length), 1);
    assert.match(await s.text("#guide .guide-body"), /^On Submit, switch on the profiles/);
    assert.equal(await s.page.$eval('#guide .guide-step[data-step="submit"] .guide-row', (e) => e.getAttribute("aria-expanded")), "true");
    await s.page.click('#guide [data-act="guide-go"][data-id="submit"]');
    assert.equal(await s.hl(), "slot", "kept while the current step is the one it was set on");
    await s.page.click('#guide .guide-step[data-step="make"] .guide-row');
    assert.match(await s.text("#guide .guide-body"), /^Go to Profiles and press New profile/);
  });
  await s.close();

  // ---- B: Walk me through it, with no license key ----
  fresh();
  s = await session("B");
  await test("Walk me through it: the panel, step 1 current, and nothing more for a vault with no key", async () => {
    await s.page.waitForSelector("#guide.guide-ask", { timeout: 6000 });
    await s.page.click('#guide [data-act="guide-yes"]');
    await s.page.waitForSelector("#guide.guide-open");
    assert.deepEqual(await s.steps(), [{ id: "make", done: false, cur: true }, { id: "ready", done: false, cur: false }, { id: "submit", done: false, cur: false }]);
    assert.ok(JSON.parse(await s.ev(() => localStorage.getItem("orbit-guide"))).open);
    const t = await s.text("#guide");
    assert.match(t, /Make your profile Go to Profiles and press New profile\. Pick Target or Pokémon Center/);
    assert.match(t, /Use Assigned Account \(easiest\): your seller gives you the account\. You don't add a login, an email or an inbox\. You won't have access to that account's email; you'll see your order updates here in FAFO\./);
    assert.match(t, /Your own account \(Target: Store login; Pokémon Center: Own email\): your seller needs that email's IMAP access \(the email and its app password\) to follow your orders\. Send it to your seller on Discord yourself: FAFO doesn't send it for you\./);
    assert.equal(await s.page.$$eval("#guide .guide-body", (els) => els.length), 1, "one step's text");
    const r = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(r.width - 360) < 1 && Math.abs(1280 - r.right - 16) < 1 && Math.abs(900 - r.bottom - 16) < 1 && r.height <= 560, JSON.stringify(r));
  });
  await test("Make a profile opens the New profile editor, on Profiles", async () => {
    await s.page.click('#guide [data-act="guide-go"][data-id="make"]');
    await s.page.waitForSelector("#layers .panel");
    assert.equal(await s.text("#layers .panel-head h2"), "New profile");
    assert.equal(await s.ev(() => window.__t.UI.view), "profiles");
  });
  await test("the editor: Store login and Own email say the seller needs the email's IMAP access, Use Assigned Account that its email isn't theirs", async () => {
    const P = "#layers .panel";
    await s.page.click(`${P} #pl-list .spick[data-pick="target"]`);
    const imap = s.page.locator(`${P} .ret-cfg .ret-imap`);
    assert.equal(await imap.count(), 1);
    assert.ok(await imap.isVisible(), "Store login's note shows");
    assert.equal(await imap.textContent(), "Your seller needs this email's IMAP access (the email and its app password) to follow your orders. Send it to your seller on Discord yourself: FAFO doesn't send it.");
    await s.page.selectOption(`${P} select[name="m_target"]`, "seller");
    assert.ok(!(await imap.isVisible()), "not on Use Assigned Account");
    const seller = s.page.locator(`${P} .ret-cfg .note-seller`);
    assert.ok(await seller.isVisible());
    assert.match((await seller.textContent()).replace(/\s+/g, " "), /nothing to add here\. You won't have access to this account's email: you'll see your order updates in FAFO\.$/);
    await s.page.click(`${P} #pl-list .spick[data-pick="pokemoncenter"]`);
    const pc = s.page.locator(`${P} .ret-cfg[data-key="pokemoncenter"] .ret-imap`);
    assert.ok(await pc.isVisible(), "Own email's note shows");
    await s.page.selectOption(`${P} select[name="m_pokemoncenter"]`, "seller");
    assert.match((await s.page.locator(`${P} .ret-cfg[data-key="pokemoncenter"] .note-seller`).textContent()).replace(/\s+/g, " "), /You won't have access to this account's email: you'll see your order updates in FAFO\./);
  });
  await test("a Target profile on Use Assigned Account, saved: steps 1 and 2 tick, and Submit is the current step", async () => {
    const P = "#layers .panel";
    await s.page.click(`${P} #pl-list .spick[data-pick="target"]`);
    await s.page.selectOption(`${P} select[name="m_target"]`, "seller");
    await s.page.fill(`${P} [name="phone"]`, "5125550100");
    await s.page.fill(`${P} [name="s_first"]`, "Sam"); await s.page.fill(`${P} [name="s_last"]`, "Sample");
    await s.page.fill(`${P} [name="s_line1"]`, "1 Sample St"); await s.page.fill(`${P} [name="s_city"]`, "Austin");
    await s.page.selectOption(`${P} [name="s_state"]`, "TX"); await s.page.fill(`${P} [name="s_zip"]`, "78701");
    await s.page.fill(`${P} [name="c_number"]`, "4111111111111111"); await s.page.fill(`${P} [name="c_exp"]`, "07/31"); await s.page.fill(`${P} [name="c_cvv"]`, "123");
    await s.page.click("#p-save");
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="submit"].is-cur'));
    assert.deepEqual(await s.steps(), [{ id: "make", done: true, cur: false }, { id: "ready", done: true, cur: false }, { id: "submit", done: false, cur: true }]);
    assert.match(await s.text("#guide .guide-head"), /2 of 3 done/);
    assert.equal(await s.hl(), "", "Make a profile's highlight went with its step");
    // No license key here yet: Submit asks for it the first time.
    assert.match(await s.text("#guide .guide-body"), /On Submit, switch on the profiles you want your seller to run, then press Submit\. They go to your seller's Discord to be approved\. The first time, Submit asks for your license key: the one you got with Continue with Discord \(it starts with PVLT\)\./);
  });
  await test("Go to Submit rings the slot switches; switching one on moves the ring to the Submit button", async () => {
    await s.page.click('#guide [data-act="guide-go"][data-id="submit"]');
    assert.equal(await s.ev(() => window.__t.UI.view), "submit");
    assert.equal(await s.hl(), "slot");
    assert.equal(await s.page.$eval('#main [data-act="slot"] + .sw-track', (e) => getComputedStyle(e).outlineStyle), "solid", "the switch is ringed");
    await s.page.click("#main .sub-slot .sw-track");
    await s.page.waitForFunction(() => document.documentElement.dataset.guideHl === "submit");
    assert.equal(await s.page.$eval('#main [data-act="submit-slots"]', (e) => getComputedStyle(e).outlineStyle), "solid", "the Submit button is ringed");
    assert.ok(await s.ev(() => window.__t.S.slots.length === 1));
    // A click on it ends the ring (the window that asks for the key here is closed again).
    await s.page.click('#main [data-act="submit-slots"]');
    assert.equal(await s.hl(), "");
    await s.page.waitForSelector("#layers .panel");
    await s.ev(() => window.__t.closeAllLayers());
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
  });
  await test("Escape with the cursor in the panel minimizes it to the pill, which opens it again", async () => {
    await s.page.focus('#guide [data-act="guide-min"]');
    await s.page.keyboard.press("Escape");
    assert.equal(await s.kind(), "pill");
    assert.equal(await s.text("#guide"), "Setup guide · 2 of 3");
    assert.ok(JSON.parse(await s.ev(() => localStorage.getItem("orbit-guide"))).min);
    assert.ok(await s.ev(() => document.getElementById("guide").contains(document.activeElement)), "the cursor stays in the guide");
    await s.page.click("#guide .guide-pill");
    assert.equal(await s.kind(), "open");
    await s.page.click('#guide [data-act="guide-min"]');
    assert.equal(await s.kind(), "pill");
    await s.relock();
    assert.equal(await s.kind(), "pill", "minimized stays minimized on this device");
    await s.page.click("#guide .guide-pill");
  });
  await s.close();

  // ---- C: with a license key: Interests, Invoice, Submit, the seller's approval ----
  fresh({ billing: billing({}), interests: { rev: 1, owner: false, items: ITEMS } });
  s = await session("C");
  await s.key();
  await test("with a key, Interests and Invoice steps; a profile that isn't ready says why, and Fix it opens it", async () => {
    await s.page.waitForSelector("#guide.guide-ask", { timeout: 6000 });
    await s.page.click('#guide [data-act="guide-yes"]');
    await addProfile(s, "p1", "Sam T", { needsCard: true });
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="ready"].is-cur'));
    assert.deepEqual((await s.steps()).map((x) => x.id), ["make", "ready", "interests", "pay", "submit"]);
    assert.equal(await s.text("#guide .guide-body p"), "Sam T isn't ready yet: Needs a card. Open it, fix what's marked, and save. Profiles show Ready to submit when they're good to go.");
    await s.page.click('#guide [data-act="guide-go"][data-id="ready"]');
    await s.page.waitForSelector("#layers .panel");
    assert.equal(await s.text("#layers .panel-head h2"), "Edit profile");
    await s.ev(() => window.__t.closeAllLayers());
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await s.ev(() => { const { S, persist, render } = window.__t; S.profiles[0].cardId = "c1"; persist(); render(); });
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="interests"].is-cur'));
    assert.match(await s.text("#guide .guide-body"), /^On Interests, tick the products you'd like your seller to run on your profiles\. Your ticks go to your seller with your next Submit\. Open Interests Skip$/);
  });
  await test("Skip ticks Interests off (synced), and the Invoice step says the price", async () => {
    await s.page.click('#guide [data-act="guide-skip"][data-id="interests"]');
    assert.ok((await s.setting()).skip.interests > 0);
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="pay"].is-cur'));
    assert.match(await s.text("#guide .guide-body"), /^Your seller charges \$5 for each checkout\. On Invoice, choose Pay per checkout\. Until you do, Submit stays off\. Open Invoice$/);
  });
  await test("Open Invoice rings Pay per checkout; choosing it ticks the step off", async () => {
    await s.page.click('#guide [data-act="guide-go"][data-id="pay"]');
    assert.equal(await s.ev(() => window.__t.UI.view), "invoice");
    await s.page.waitForSelector('#main [data-act="bill-plan-checkout"]');
    assert.equal(await s.hl(), "plan");
    assert.equal(await s.page.$eval('#main [data-act="bill-plan-checkout"]', (e) => getComputedStyle(e).outlineStyle), "solid");
    await s.page.click('#main [data-act="bill-plan-checkout"]');
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="pay"].is-done'));
    assert.deepEqual(W.plans, [{ plan: "checkout" }]);
    assert.equal(await s.cur(), "submit");
    assert.doesNotMatch(await s.text("#guide .guide-body"), /license key/, "a key's here: Submit won't ask for it");
  });
  await test("Submit through the worker (Pending approval): step 5 ticks, guide.sent is set, and the approval step is current", async () => {
    await s.page.click('#guide [data-act="guide-go"][data-id="submit"]');
    assert.equal(await s.hl(), "slot");
    await s.page.click("#main .sub-slot .sw-track");
    await s.page.waitForFunction(() => document.documentElement.dataset.guideHl === "submit");
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.fill("#ss-from", "Sam");
    await s.page.click("#ss-go");
    await s.page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
    await s.page.click("#layers [data-close]");
    assert.equal(W.subs.length, 1);
    assert.ok((await s.setting()).sent > 0);
    await s.page.waitForFunction(() => document.querySelector('#guide .guide-step[data-step="wait"].is-cur'));
    assert.deepEqual((await s.steps()).map((x) => [x.id, x.done]), [["make", true], ["ready", true], ["interests", true], ["pay", true], ["submit", true], ["wait", false]]);
    assert.match(await s.text("#guide .guide-body"), /^Your slots show Pending approval until your seller approves them, then Success\. If one shows Declined, switch it off and on again to send it in a new batch, or ask your seller\. When your seller checks out on your profiles, the orders show up in Orders\. Go to Submit$/);
  });
  await test("the seller approves (/submissions/status): the last step ticks and You're all set shows; Close guide sets done", async () => {
    W.approved = true;
    for (let i = 0; i < 50 && !(await s.ev(() => !!window.__t.S.subs["p1@target"].okAt)); i++) { await s.ev(() => window.__t.refreshApprovals(true)); await s.page.waitForTimeout(100); }
    await s.page.waitForSelector("#guide .guide-fin");
    assert.equal(await s.text("#guide .guide-fin"), "You're all set Your profiles are with your seller. Open this guide any time from Profiles or Submit. Close guide");
    assert.match(await s.text("#guide .guide-head"), /6 of 6 done/);
    await s.page.click('#guide [data-act="guide-done"]');
    assert.equal(await s.kind(), "");
    assert.ok((await s.setting()).done > 0);
    await s.relock(); await s.notAsked();
  });
  await s.close();

  // ---- D: the seller's own FAFO ----
  fresh({ premium: { premium: true, owner: true }, interests: { rev: 1, owner: true, items: [] } });
  s = await session("D");
  await s.key();
  await test("the seller's own FAFO is never asked, but Setup guide opens it", async () => {
    assert.ok(await s.ev(() => window.__t.isPremiumOwner()));
    await s.notAsked();
    await s.relock(); await s.notAsked();
    await s.page.click('#side [data-id="profiles"]');
    await s.page.click('#main .view-tools [data-act="guide-open"]');
    await s.page.waitForSelector("#guide.guide-open");
    assert.equal(await s.cur(), "make");
  });
  await test("the seller's own editor has neither note", async () => {
    await s.page.click('#main .view-tools [data-act="new-profile"]');
    await s.page.waitForSelector("#layers .panel");
    const P = "#layers .panel";
    await s.page.click(`${P} #pl-list .spick[data-pick="target"]`);
    assert.equal(await s.page.locator(`${P} .ret-imap`).count(), 0);
    await s.page.selectOption(`${P} select[name="m_target"]`, "seller");
    assert.doesNotMatch(await s.text(`${P} .ret-cfg`), /won't have access/);
    await s.page.click(`${P} #pl-list .spick[data-pick="pokemoncenter"]`);
    assert.equal(await s.page.locator(`${P} .ret-imap`).count(), 0);
    await s.ev(() => window.__t.closeAllLayers());
  });
  await s.close();

  // ---- E: a phone ----
  fresh();
  s = await session("E", { width: 390, height: 844 });
  await test("on a phone the panel is the screen's width at the bottom, one step open, and above the selection bar", async () => {
    await addProfile(s, "p1", "Sam A"); await addProfile(s, "p2", "Sam B"); await addProfile(s, "p3", "Sam C");
    await s.page.click('#mnav [data-id="profiles"]');
    await s.page.click('#main .view-tools [data-act="guide-open"]');
    await s.page.waitForSelector("#guide.guide-open");
    let r = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(r.left - 12) < 1 && Math.abs(r.width - (390 - 24)) < 1, "full width less 12px a side: " + JSON.stringify(r));
    assert.ok(Math.abs(844 - r.bottom - 12) < 1, "at the bottom: " + JSON.stringify(r));
    assert.equal(await s.page.$$eval("#guide .guide-body", (els) => els.length), 1, "only one step's text");
    assert.equal(await s.page.$$eval("#guide .guide-step", (els) => els.length), 3, "the other steps as rows");
    await s.page.click('#main [data-act="sel-all"]');
    await s.page.waitForSelector("#bulkbar .bulk-inner");
    const bar = await s.page.$eval("#bulkbar .bulk-inner", (e) => e.getBoundingClientRect().toJSON());
    r = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(r.bottom <= bar.top + 0.5, `the panel ends above the bar: ${r.bottom} vs ${bar.top}`);
    const below = await s.page.$$eval("#guide button", (els, top) => els.filter((b) => b.getBoundingClientRect().bottom > top + 0.5).length, bar.top);
    assert.equal(below, 0, "no button of the guide under the bar");
    // Its buttons can be pressed (nothing over them), and so can the bar's.
    await s.page.click('#guide [data-act="guide-min"]');
    assert.equal(await s.kind(), "pill");
    const pill = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(pill.bottom <= bar.top + 0.5, "the pill too");
    await s.page.click('#bulkbar [data-act="bulk-clear"]');
    await s.page.waitForFunction(() => document.getElementById("bulkbar").hidden);
    const down = await s.page.$eval("#guide", (e) => e.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(844 - down.bottom - 12) < 1, "back down once the bar's gone: " + JSON.stringify(down));
  });
  await s.close();

  await test("the page threw nothing", async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
}
console.log(`${passed} passed`);
