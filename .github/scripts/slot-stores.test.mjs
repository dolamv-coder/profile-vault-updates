// Tests slot limits per store in the newest page (index-X.Y.Z.html), from 1.9.158 (the owner's requests, 2026-11-18, with a
// screenshot of Request more slots' "Slots you need in total": "Let's change this slot request window. Each retailer should
// have their own slot request. Example: Costco --- 10, Pokemon Center --- 15, Target --- 30", then "the 20 slots cap should be
// per store"). A license worker that answers GET /slots/limit with `stores` ({target, pokemoncenter, costco}) and `base` gives
// each store its own limit: Submit's "Slot limits, per store:" line, each store's "Limit N" (where the buyer's own cap was),
// Select all up to it, the swap window at it, a store over it blocking Submit (and the others not), Request more slots with a
// number per store (always Target, Pokémon Center and Costco, in that order), what it sends, the line while it waits (only the
// stores it raises), the toasts once the seller approves or declines, and a request from an older FAFO (a total). Without
// `stores` (an older worker, or the monthly plan) Submit is as 1.9.157: one number across all stores, the buyer's caps and
// "Slots you need in total". Also the Send accounts window's words on the owner's FAFO, and a phone. The real page runs in
// Chromium (Playwright) as the web version at app.fafoaco.com, against a pretend license worker that answers as the contract
// says, in a vault made with Use this browser only. Sample data only.
//   node .github/scripts/slot-stores.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have limits per store (slotPerStore); a page named on the command line that doesn't is skipped.
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
if (!/const slotPerStore = /.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no slot limits per store (slotPerStore): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no slot limits per store, skipped`); process.exit(0);
}
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get UI(){ return UI; }, keepTypedLic, persist, render, renderMain, refreshSlotAllow, slotKey,"
  + " slotPerStore, storeLimit, capOf, openAssignAccounts, refreshPremium, closeAllLayers};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker (the contract: GET /slots/limit, POST /slots/request) ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const W = { limit: null, requests: [], answer: null, owner: false };
const perStore = (target, pokemoncenter, costco, request = null, base = 20) => ({ limit: target + pokemoncenter + costco, stores: { target, pokemoncenter, costco }, base, request, canRequest: true });
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/slots/limit") return json(route, 200, W.limit);
  if (p === "/slots/request" && m === "POST") {
    const body = JSON.parse(req.postData());
    W.requests.push(body);
    const [status, answer] = W.answer ? W.answer(body) : [200, { ok: true, request: { id: "r" + W.requests.length, status: "pending", requested: 0, stores: {} } }];
    return json(route, status, answer);
  }
  if (p === "/premium") return json(route, 200, { premium: W.owner, owner: W.owner });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  return json(route, 404, {});
}
// The worker's answer to a new request: its stores, as asked (missing ones at their limit), totals as sums.
const acceptRequest = (now) => (body) => {
  const stores = {}; let req = 0, cur = 0;
  for (const k of ["target", "pokemoncenter", "costco"]) { const r = body.stores[k] ?? now[k]; stores[k] = { current: now[k], requested: r, granted: null }; req += r; cur += now[k]; }
  return [200, { ok: true, request: { id: "r1", status: "pending", requested: req, current: cur, stores } }];
};

const browser = await chromium.launch();
const errors = [];
async function session(name, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
    return route.fulfill({ status: 404, body: "" });
  });
  // The setup guide (1.9.145) doesn't ask here: its own test is walkthrough.test.mjs. Every toast is recorded.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {}
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })
      .observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + String(e)));
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", "sample-pass-158"); await page.fill("#pw2", "sample-pass-158"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 });
  // A license key, as Submit keeps one, and profiles: 24 at Target, 4 at Pokémon Center, 3 at Costco, all ready.
  await page.evaluate((lic) => {
    const T = window.__t, S = T.S;
    T.keepTypedLic(lic);
    S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
    const add = (id, name, store) => {
      S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: "c1", phone: "5125550100", email: "", stores: [{ store, storeName: "", mode: "seller", loginId: null, email: "", verified: false }] });
    };
    for (let i = 1; i <= 24; i++) add("t" + i, "Sam T" + String(i).padStart(2, "0"), "target");
    for (let i = 1; i <= 4; i++) add("p" + i, "Sam P" + i, "pokemoncenter");
    for (let i = 1; i <= 3; i++) add("k" + i, "Sam C" + i, "costco");
    T.persist(); T.render();
  }, LIC);
  const s = {
    ctx, page,
    ev: (fn, arg) => page.evaluate(fn, arg),
    // As it reads: the stores' marks are pictures (Costco's C isn't read).
    text: (sel) => page.$eval(sel, readText),
    toasts: () => page.evaluate(() => window.__toasts.slice()),
    clearToasts: () => page.evaluate(() => { window.__toasts.length = 0; document.querySelectorAll(".toast").forEach((t) => t.remove()); }),
    // Asks the worker now, as Submit does every minute.
    refresh: () => page.evaluate(() => window.__t.refreshSlotAllow(true)),
    async submit() { await page.click('#side [data-id="submit"]'); await page.waitForSelector("#main .sub-act"); },
    // Each store section, as it reads: [name, the line under it, its count, the tools' words, Select all off].
    stores: () => page.$$eval("#main .sub-store", (ss) => ss.map((x) => [x.querySelector(".store-title").textContent.trim(), x.querySelector(".sub-ttl .item-sub").innerText.replace(/\s+/g, " ").trim(),
      x.querySelector(".store-count").innerText.replace(/\s+/g, " ").trim(), (x.querySelector(".store-tools .item-sub") || {}).textContent || "", !!(x.querySelector('[data-act="sel-store"]') || {}).disabled,
      (x.querySelector(".sub-full") || {}).textContent || ""])),
    // The panel's line as it reads (the stores' marks are pictures: Costco's C isn't read).
    allow: () => page.$eval("#main .sub-allow", readText),
    selected: (k) => page.evaluate((k) => (window.__t.S.slots || []).filter((x) => x.endsWith("@" + k)).length, k),
    setSlots: (list) => page.evaluate((list) => { const T = window.__t; T.S.slots = list.map(([p, k]) => T.slotKey(p, k)); T.persist(); T.render(); }, list),
    until: async (cond, what, ms = 10000) => { for (const t0 = Date.now(); !(await cond());) { if (Date.now() - t0 > ms) throw new Error("waited too long for " + what); await new Promise((r) => setTimeout(r, 25)); } },
    async close() { await ctx.close(); },
  };
  return s;
}
const P = "#layers .panel";
// An element's text as it reads: the stores' marks are pictures (Costco's C isn't read), hidden for the moment it's read.
function readText(e) {
  const marks = [...e.querySelectorAll(".smark")];
  marks.forEach((m) => { m.dataset.d = m.style.display; m.style.display = "none"; });
  const t = e.innerText.replace(/\s+/g, " ").trim();
  marks.forEach((m) => { m.style.display = m.dataset.d; delete m.dataset.d; });
  return t;
}
const ROWS = (s) => s.page.$$eval(`${P} .sr-row:not(.sr-heads)`, (rs) => rs.map((r) => [r.dataset.store, r.querySelector(".sr-st > span:last-child").textContent.trim(), r.querySelector(".sr-now").textContent.trim(), r.querySelector("input").value]));

console.log(`Slot limits per store in ${file.split(/[\\/]/).pop()}`);
try {
  // ======================== Per store ========================
  W.limit = perStore(20, 20, 20);
  let s = await session("A");
  await test("the worker's answer kept: each store's limit, the base, and per store on", async () => {
    await s.refresh();
    const r = await s.ev(() => { const T = window.__t; return { a: T.S.settings.slotAllow, on: T.slotPerStore(), lim: ["target", "pokemoncenter", "costco", "walmart", "other:shop"].map(T.storeLimit), cap: T.capOf("target") }; });
    assert.deepEqual(r.a, { limit: 60, request: null, canRequest: true, stores: { target: 20, pokemoncenter: 20, costco: 20 }, base: 20 });
    assert.equal(r.on, true);
    assert.deepEqual(r.lim, [20, 20, 20, 20, 20], "a store with no number of its own has the base");
    assert.equal(r.cap, 20, "the store's cap is its limit, not the buyer's 3");
  });
  await test("Submit: the panel's Slot limits, per store line, each store's Limit N, Select all's words and the note", async () => {
    await s.submit();
    assert.equal(await s.allow(), "Slot limits, per store: Target 20 Pokémon Center 20 Costco 20 Request more slots");
    assert.equal(await s.page.$$eval("#main .sub-allow .sub-lim .smark", (m) => m.length), 3, "each store's mark");
    assert.equal(await s.page.$("#main .sub-allow-bar"), null, "no total meter");
    assert.equal(await s.page.$('#main [data-act="cap"]'), null, "no cap link");
    assert.deepEqual(await s.stores(), [
      ["Costco", "Limit 20 · 3 profiles", "0 / 20 selected", "Select all fills up to its limit of 20.", false, ""],
      ["Pokémon Center", "Limit 20 · 4 profiles", "0 / 20 selected", "Select all fills up to its limit of 20.", false, ""],
      ["Target", "Limit 20 · 24 profiles", "0 / 20 selected", "Select all fills up to its limit of 20.", false, ""]]);
    assert.match(await s.text("#main"), /Selecting a profile only stages it, so toggle freely\. Each store has its own slot limit; at the limit, selecting another asks which to swap out\./);
  });
  await test("Select all fills each store up to its own limit, with no total across stores", async () => {
    await s.page.click('#main [data-act="sel-store"][data-id="target"]');
    await s.page.click('#main [data-act="sel-store"][data-id="pokemoncenter"]');
    await s.page.click('#main [data-act="sel-store"][data-id="costco"]');
    assert.deepEqual([await s.selected("target"), await s.selected("pokemoncenter"), await s.selected("costco")], [20, 4, 3]);
    const st = await s.stores();
    assert.deepEqual(st.map((x) => [x[2], x[4], x[5]]), [["3 / 20 selected", false, ""], ["4 / 20 selected", false, ""], ["20 / 20 selected", true, "Limit reached"]]);
    assert.equal(await s.page.$eval("#main .p-kpis", (e) => e.innerText.replace(/\s+/g, " ").trim()), "31 profiles 27 selected");
    assert.match(await s.text("#main .sub-act-ttl"), /^27 new picks ready to send$/, "27 on, over 20 across stores, is fine");
    assert.ok(!(await s.toasts()).some((t) => /limit/.test(t)), "no toast about a limit");
  });
  await test("at a store's limit, switching another on asks which to swap out (never a total), with Request more slots", async () => {
    await s.page.click('#main [data-act="slot"][data-id="t21"] + .sw-track');
    await s.page.waitForSelector(P);
    assert.equal(await s.text(`${P} .panel-head h2`), "Target is at its limit of 20");
    assert.match(await s.text(`${P} .panel-body`), /^Pick one to swap out for Sam T21, or ask the seller for more\./);
    assert.ok(await s.page.$(`${P} #sw-req`), "Request more slots");
    assert.equal(await s.page.$(`${P} #sw-cap`), null, "no Raise cap");
    await s.page.click(`${P} #sw-go`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.equal(await s.selected("target"), 20);
    assert.ok(await s.ev(() => window.__t.S.slots.includes("t21@target") && !window.__t.S.slots.includes("t1@target")), "Sam T21 in, Sam T01 out");
    // Request more slots from it opens the request window, and the slot stays off.
    await s.page.click('#main [data-act="slot"][data-id="t22"] + .sw-track');
    await s.page.waitForSelector(`${P} #sw-req`);
    await s.page.click(`${P} #sw-req`);
    await s.page.waitForFunction(() => { const h = document.querySelector("#layers .panel-head h2"); return h && h.textContent === "Request more slots" && document.querySelector("#sr-n-target"); });
    assert.equal(await s.ev(() => window.__t.S.slots.includes("t22@target")), false);
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
  });
  await test("a store over its limit blocks Submit, named, and the others don't: the panel, the counts and the window", async () => {
    W.limit = perStore(10, 20, 20);
    await s.refresh();
    await s.page.waitForFunction(() => /Target 10/.test(document.querySelector("#main .sub-allow").innerText));
    assert.equal(await s.allow(), "Slot limits, per store: Target 10 Pokémon Center 20 Costco 20 Request more slots Switch 10 off at Target before submitting.");
    assert.ok(await s.page.$eval("#main .sub-allow", (e) => e.classList.contains("is-over")));
    assert.equal(await s.text("#main .sub-act-ttl"), "Too many slots switched on");
    assert.equal(await s.page.$eval("#main .p-kpis .p-kpi:nth-child(2) .p-kpi-dot", (e) => e.style.background), "var(--danger)");
    const st = await s.stores();
    assert.deepEqual(st.map((x) => [x[0], x[2], x[5]]), [["Costco", "3 / 20 selected", ""], ["Pokémon Center", "4 / 20 selected", ""], ["Target", "20 / 10 selected", "Over its limit"]]);
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.waitForSelector(P);
    assert.equal(await s.text(`${P} .panel-head h2`), "Too many slots switched on at Target");
    assert.equal(await s.text(`${P} .panel-body`), "You have 20 switched on at Target, and its limit is 10. Switch 10 off before submitting, or ask the seller for more.");
    assert.ok(await s.page.$(`${P} #sl-req`), "Request more slots");
    assert.equal(await s.page.$("#ss-go"), null, "Submit's window didn't open");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    // Two stores over: both named.
    W.limit = perStore(10, 2, 20);
    await s.refresh();
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.waitForSelector(P);
    assert.equal(await s.text(`${P} .panel-head h2`), "Too many slots switched on");
    assert.equal(await s.text(`${P} .panel-body`), "Switch some off before submitting, or ask the seller for more. Target: 20 switched on, and its limit is 10. Switch 10 off. Pokémon Center: 4 switched on, and its limit is 2. Switch 2 off.");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    // Within every limit, Submit's window opens.
    await s.setSlots([["t1", "target"], ["p1", "pokemoncenter"], ["k1", "costco"]]);
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.waitForSelector("#ss-go");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
  });
  await test("the request window: a row for Target, Pokémon Center and Costco, each with Now and a box at its limit", async () => {
    W.limit = perStore(20, 20, 20);
    await s.refresh();
    await s.page.click('#main .sub-allow [data-act="slot-request"]');
    await s.page.waitForSelector(`${P} #sr-n-target`);
    assert.equal(await s.text(`${P} .panel-head h2`), "Request more slots");
    assert.match(await s.text(`${P} .panel-body`), /^Each store has its own slot limit\. Put the number you need at each store; the seller gets your request and can approve it\. Store Your limit You need Target Now 20 Pokémon Center Now 20 Costco Now 20 Leave a store at its number to keep it as it is\. Your name Note \(optional\)$/i);
    assert.deepEqual(await ROWS(s), [["target", "Target", "Now 20", "20"], ["pokemoncenter", "Pokémon Center", "Now 20", "20"], ["costco", "Costco", "Now 20", "20"]]);
    assert.equal(await s.page.$$eval(`${P} .sr-row .smark`, (m) => m.length), 3, "each store's mark");
    // Each box is labelled by its store.
    assert.deepEqual(await s.page.$$eval(`${P} .sr-in`, (ins) => ins.map((i) => i.labels[0].querySelector("span:last-child").textContent.trim())), ["Target", "Pokémon Center", "Costco"]);
    assert.equal(await s.page.$(`${P} #sr-n`), null, "no Slots you need in total");
  });
  await test("the request window's checks: a number from the store's limit to 500, at least one raised, and nothing sent until then", async () => {
    await s.page.fill(`${P} #sr-n-target`, "15");
    await s.page.click(`${P} #sr-go`);
    assert.equal(await s.text("#sr-err-target"), "Enter a number from 20 to 500.");
    assert.ok(await s.page.$eval(`${P} #sr-n-target`, (e) => e === document.activeElement), "the cursor in that box");
    await s.page.fill(`${P} #sr-n-target`, "501");
    await s.page.fill(`${P} #sr-n-costco`, "2.5");
    await s.page.click(`${P} #sr-go`);
    assert.equal(await s.text("#sr-err-target"), "Enter a number from 20 to 500.");
    assert.equal(await s.text("#sr-err-costco"), "Enter a number from 20 to 500.");
    assert.equal(await s.text("#sr-err-pokemoncenter"), "");
    await s.page.fill(`${P} #sr-n-target`, "20");
    await s.page.fill(`${P} #sr-n-costco`, "20");
    assert.equal(await s.text("#sr-err-target"), "", "typing clears it");
    await s.page.click(`${P} #sr-go`);
    assert.equal(await s.text(`${P} #sr-err`), "Raise at least one store's number.");
    assert.equal(W.requests.length, 0, "nothing sent");
    // A store asked above its limit gets the --info ring.
    await s.page.fill(`${P} #sr-n-target`, "30");
    assert.deepEqual(await s.page.$$eval(`${P} .sr-in`, (ins) => ins.map((i) => i.classList.contains("is-up"))), [true, false, false]);
    assert.notEqual(await s.page.$eval(`${P} #sr-n-target`, (e) => getComputedStyle(e).boxShadow), "none");
  });
  await test("Send request: the exact body, the toast, and the panel's line while it waits (only the stores it raises)", async () => {
    W.answer = acceptRequest({ target: 20, pokemoncenter: 20, costco: 20 });
    await s.page.fill(`${P} #sr-n-pokemoncenter`, "25");
    await s.page.fill(`${P} #sr-name`, "Sam Sample");
    await s.page.fill(`${P} #sr-note`, "Weekend drop");
    await s.clearToasts();
    const [req] = await Promise.all([s.page.waitForRequest((r) => new URL(r.url()).pathname === "/slots/request"), s.page.click(`${P} #sr-go`)]);
    assert.equal(req.headers().authorization, "Bearer " + LIC);
    assert.deepEqual(JSON.parse(req.postData()), { stores: { target: 30, pokemoncenter: 25, costco: 20 }, name: "Sam Sample", note: "Weekend drop" });
    assert.equal(req.postData(), JSON.stringify({ stores: { target: 30, pokemoncenter: 25, costco: 20 }, name: "Sam Sample", note: "Weekend drop" }));
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await s.until(async () => (await s.toasts()).includes("Request sent. You'll get more slots once it's approved."), "the toast");
    assert.equal(await s.allow(), "Slot limits, per store: Target 20 Pokémon Center 20 Costco 20 You've asked for Target 30 and Pokémon Center 25, and it's waiting for approval.");
    assert.equal(await s.ev(() => window.__t.S.submitName), "Sam Sample");
    // Asking again while it waits: no window, the toast says what's asked.
    await s.clearToasts();
    await s.ev(() => { const b = document.createElement("button"); b.dataset.act = "slot-request"; b.id = "stale-req"; document.body.appendChild(b); });
    await s.page.click("#stale-req");
    await s.until(async () => (await s.toasts()).includes("You've asked for Target 30 and Pokémon Center 25. It's waiting for approval."), "the toast");
    assert.equal(await s.page.$(P), null);
    // A store over its limit while it waits: the window says what's asked, with no Request more slots.
    W.limit = perStore(2, 20, 20, (await s.ev(() => window.__t.S.settings.slotAllow.request)));
    await s.refresh();
    await s.setSlots([["t1", "target"], ["t2", "target"], ["t3", "target"]]);
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.waitForSelector(P);
    assert.equal(await s.text(`${P} .panel-body`), "You have 3 switched on at Target, and its limit is 2. Switch 1 off before submitting, or ask the seller for more. You've already asked for Target 30 and Pokémon Center 25, and it's waiting for approval.");
    assert.equal(await s.page.$(`${P} #sl-req`), null, "no Request more slots while one waits");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
  });
  await test("approved: the toast names each store raised, and Submit shows the new limits", async () => {
    W.limit = perStore(20, 20, 20, { id: "r1", status: "pending", requested: 75, current: 60, stores: { target: { current: 20, requested: 30, granted: null }, pokemoncenter: { current: 20, requested: 25, granted: null }, costco: { current: 20, requested: 20, granted: null } } });
    await s.refresh();
    await s.clearToasts();
    W.limit = perStore(30, 25, 20, { id: "r1", status: "approved", requested: 75, granted: 75, current: 60, stores: { target: { current: 20, requested: 30, granted: 30 }, pokemoncenter: { current: 20, requested: 25, granted: 25 }, costco: { current: 20, requested: 20, granted: 20 } } });
    await s.refresh();
    await s.until(async () => (await s.toasts()).includes("You can now use 30 slots at Target and 25 at Pokémon Center"), "the toast");
    assert.equal(await s.allow(), "Slot limits, per store: Target 30 Pokémon Center 25 Costco 20 Request more slots");
    assert.deepEqual((await s.stores()).map((x) => x[1]), ["Limit 20 · 3 profiles", "Limit 25 · 4 profiles", "Limit 30 · 24 profiles"]);
    // One store raised: one store named.
    await s.clearToasts();
    W.limit = perStore(30, 25, 40);
    await s.refresh();
    await s.until(async () => (await s.toasts()).includes("You can now use 40 slots at Costco"), "the toast");
    // Three: "A, B and C".
    await s.clearToasts();
    W.limit = perStore(31, 26, 41);
    await s.refresh();
    await s.until(async () => (await s.toasts()).includes("You can now use 31 slots at Target, 26 at Pokémon Center and 41 at Costco"), "the toast");
    // The window starts at the new limits.
    await s.page.click('#main .sub-allow [data-act="slot-request"]');
    await s.page.waitForSelector(`${P} #sr-n-target`);
    assert.deepEqual((await ROWS(s)).map((r) => [r[2], r[3]]), [["Now 31", "31"], ["Now 26", "26"], ["Now 41", "41"]]);
    await s.page.fill(`${P} #sr-n-target`, "30");
    await s.page.click(`${P} #sr-go`);
    assert.equal(await s.text("#sr-err-target"), "Enter a number from 31 to 500.");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
  });
  await test("declined: the toast, and the panel says so with Request more slots", async () => {
    const pending = { id: "r2", status: "pending", requested: 108, current: 98, stores: { target: { current: 31, requested: 41, granted: null }, pokemoncenter: { current: 26, requested: 26, granted: null }, costco: { current: 41, requested: 41, granted: null } } };
    W.limit = perStore(31, 26, 41, pending);
    await s.refresh();
    assert.equal(await s.allow(), "Slot limits, per store: Target 31 Pokémon Center 26 Costco 41 You've asked for Target 41, and it's waiting for approval.");
    await s.clearToasts();
    W.limit = perStore(31, 26, 41, Object.assign({}, pending, { status: "denied" }));
    await s.refresh();
    await s.until(async () => (await s.toasts()).includes("Your request for more slots was declined"), "the toast");
    assert.equal(await s.allow(), "Slot limits, per store: Target 31 Pokémon Center 26 Costco 41 Request more slots Your last request for more was declined.");
  });
  await test("a request from an older FAFO (a total, no store raised, or no stores at all) reads as before: You've asked for N", async () => {
    W.limit = perStore(20, 20, 20, { id: "r3", status: "pending", requested: 90, current: 60, stores: { target: { current: 20, requested: 20 }, pokemoncenter: { current: 20, requested: 20 }, costco: { current: 20, requested: 20 } } });
    await s.refresh();
    assert.equal(await s.allow(), "Slot limits, per store: Target 20 Pokémon Center 20 Costco 20 You've asked for 90, and it's waiting for approval.");
    W.limit = perStore(20, 20, 20, { id: "r4", status: "pending", requested: 70 });
    await s.refresh();
    assert.equal(await s.allow(), "Slot limits, per store: Target 20 Pokémon Center 20 Costco 20 You've asked for 70, and it's waiting for approval.");
    await s.clearToasts();
    await s.page.click("#stale-req");
    await s.until(async () => (await s.toasts()).includes("You've asked for 70 slots. It's waiting for approval."), "the toast");
  });
  await test("the worker answering a request already waiting, and its 400 and 429 words, shown in the window", async () => {
    W.limit = perStore(20, 20, 20);
    await s.refresh();
    const open = async () => { await s.page.click('#main .sub-allow [data-act="slot-request"]'); await s.page.waitForSelector(`${P} #sr-n-target`); };
    await open();
    W.answer = () => [400, { error: "Ask for a number above your limit at one store at least." }];
    await s.page.fill(`${P} #sr-n-target`, "22");
    await s.page.click(`${P} #sr-go`);
    await s.page.waitForFunction(() => document.querySelector("#sr-err").textContent);
    assert.equal(await s.text(`${P} #sr-err`), "Ask for a number above your limit at one store at least.");
    W.answer = () => [429, { error: "limit" }];
    await s.page.click(`${P} #sr-go`);
    await s.page.waitForFunction(() => /few requests/.test(document.querySelector("#sr-err").textContent));
    assert.equal(await s.text(`${P} #sr-err`), "You've sent a few requests today. Try again tomorrow.");
    W.answer = () => [200, { status: "pending", request: { id: "r5", status: "pending", requested: 75, stores: { target: { current: 20, requested: 35 }, pokemoncenter: { current: 20, requested: 20 }, costco: { current: 20, requested: 20 } } } }];
    await s.clearToasts();
    await s.page.click(`${P} #sr-go`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await s.until(async () => (await s.toasts()).includes("You'd already asked for Target 35. It's waiting for approval."), "the toast");
    assert.equal(await s.allow(), "Slot limits, per store: Target 20 Pokémon Center 20 Costco 20 You've asked for Target 35, and it's waiting for approval.");
    W.answer = null;
  });
  await test("a cap link drawn before (a stale click) opens the request window, never the buyer's own cap", async () => {
    W.limit = perStore(20, 20, 20);
    await s.refresh();
    await s.ev(() => { const b = document.createElement("button"); b.dataset.act = "cap"; b.dataset.id = "target"; b.id = "stale-cap"; document.body.appendChild(b); });
    await s.page.click("#stale-cap");
    await s.page.waitForFunction(() => { const h = document.querySelector("#layers .panel-head h2"); return h && h.textContent === "Request more slots"; });
    assert.ok(await s.page.$(`${P} #sr-n-costco`));
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.deepEqual(await s.ev(() => window.__t.S.caps), {}, "no cap written");
  });
  await test("the owner's FAFO: Send accounts says one person gets their Target and Pokémon Center limits together", async () => {
    W.owner = true;
    await s.ev(() => window.__t.refreshPremium(true));
    await s.ev(() => window.__t.openAssignAccounts());
    await s.page.waitForSelector(`${P} #aa-lines`);
    assert.match(await s.text(`${P} .panel-body`), /one person gets as many as their Target and Pokémon Center slot limits together: 20 at each store to start, or the numbers you approved when they asked for more slots\./);
    await s.ev(() => window.__t.closeAllLayers());
    W.owner = false;
  });
  await s.close();

  // ======================== One number across all stores, as 1.9.157 ========================
  await test("an older worker's answer (no stores): the total meter, the buyer's caps and Slots you need in total", async () => {
    W.limit = { limit: 30, request: null, canRequest: true };
    s = await session("B");
    await s.refresh();
    assert.equal(await s.ev(() => window.__t.slotPerStore()), false);
    await s.submit();
    assert.equal(await s.allow(), "Using 0 of your 30 slots Request more slots");
    assert.ok(await s.page.$("#main .sub-allow-bar"), "the total meter");
    assert.deepEqual((await s.stores()).map((x) => [x[1], x[2], x[3]]), [
      ["3 slots cap · 3 profiles", "0 / 3 selected", "Select all fills up to your 3 cap."],
      ["3 slots cap · 4 profiles", "0 / 3 selected", "Select all fills up to your 3 cap."],
      ["3 slots cap · 24 profiles", "0 / 3 selected", "Select all fills up to your 3 cap."]]);
    assert.match(await s.text("#main"), /Each store has its own cap; at the cap, selecting another asks which to swap out\./);
    await s.page.click('#main .sub-allow [data-act="slot-request"]');
    await s.page.waitForSelector(`${P} #sr-n`);
    assert.equal(await s.text(`${P} label[for="sr-n"]`), "Slots you need in total");
    assert.equal(await s.page.$(`${P} .sr-grid`), null);
    await s.page.fill(`${P} #sr-n`, "40");
    const [req] = await Promise.all([s.page.waitForRequest((r) => new URL(r.url()).pathname === "/slots/request"), s.page.click(`${P} #sr-go`)]);
    assert.deepEqual(JSON.parse(req.postData()), { requested: 40, name: "", note: "" });
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    // The cap link is the buyer's own, and the swap window offers Raise cap.
    await s.page.click('#main [data-act="sel-store"][data-id="target"]');
    await s.page.click('#main [data-act="slot"][data-id="t4"] + .sw-track');
    await s.page.waitForSelector(P);
    assert.equal(await s.text(`${P} .panel-head h2`), "Target is at its 3-slot cap");
    assert.ok(await s.page.$(`${P} #sw-cap`), "Raise cap");
    await s.page.click(`${P} [data-close]`);
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await s.close();
  });
  await test("the monthly plan's answer (no stores, no requests): the total meter without Request more slots", async () => {
    W.limit = { limit: 10, request: null, canRequest: false, plan: "monthly" };
    s = await session("C");
    await s.refresh();
    await s.submit();
    assert.equal(await s.allow(), "Using 0 of your 10 slots");
    // Per store from before, then the plan's answer: one number again.
    W.limit = perStore(20, 20, 20);
    await s.refresh();
    assert.equal(await s.ev(() => window.__t.slotPerStore()), true);
    W.limit = { limit: 10, request: null, canRequest: false, plan: "monthly" };
    await s.refresh();
    assert.deepEqual(await s.ev(() => [window.__t.slotPerStore(), window.__t.S.settings.slotAllow]), [false, { limit: 10, request: null, canRequest: false }]);
    assert.equal(await s.allow(), "Using 0 of your 10 slots");
    await s.close();
  });

  // ======================== A phone ========================
  await test("a phone (375 × 667): the request window's rows fit without scrolling sideways, and so does Submit's line", async () => {
    W.limit = perStore(120, 20, 500);
    s = await session("D", { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    await s.refresh();
    await s.page.click('#mnav [data-id="submit"]');
    await s.page.waitForSelector("#main .sub-act");
    const wide = () => s.ev(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    let w = await wide();
    assert.ok(w.doc <= w.win, JSON.stringify(w));
    await s.page.click('#main .sub-allow [data-act="slot-request"]');
    await s.page.waitForSelector(`${P} #sr-n-target`);
    const fit = await s.ev(() => {
      const panel = document.querySelector("#layers .panel"), body = panel.querySelector(".panel-body") || panel, pr = body.getBoundingClientRect();
      const ins = [...panel.querySelectorAll(".sr-in, .sr-st, .sr-now")].map((e) => e.getBoundingClientRect());
      return { scroll: body.scrollWidth <= body.clientWidth, inside: ins.every((r) => r.left >= pr.left - 0.5 && r.right <= pr.right + 0.5 && r.width > 0), inW: panel.querySelector(".sr-in").getBoundingClientRect().width };
    });
    assert.ok(fit.scroll && fit.inside && fit.inW >= 60, JSON.stringify(fit));
    w = await wide();
    assert.ok(w.doc <= w.win, JSON.stringify(w));
    // Costco is at 500, the most there is: its box can't go higher, the others can.
    assert.deepEqual((await ROWS(s)).map((r) => r[2]), ["Now 120", "Now 20", "Now 500"]);
    await s.page.fill(`${P} #sr-n-costco`, "501");
    await s.page.click(`${P} #sr-go`);
    assert.equal(await s.text("#sr-err-costco"), "Enter a number from 500 to 500.");
    await s.close();
  });

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
