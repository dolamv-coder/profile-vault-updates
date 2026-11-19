// Tests Send to buyer's Add to their invoice in the newest page (index-X.Y.Z.html), from 1.9.161 (the owner, 2026-11-19: "Is
// there a way to invoice him automatically anytime I use the function 'send to buyer' on the dashboard?"; their choices: the box
// is ticked every time the window opens, and orders a remembered address sends by itself are billed if the box was ticked when
// it was remembered). The real page runs in Chromium (Playwright) as the web version at app.fafoaco.com, as the seller's own
// FAFO, against a pretend license worker, in a vault made with Use this browser only, with a license key kept as Submit keeps
// one. It checks the window (the box ticked each time it opens, its words naming the buyer, the line about future orders), what
// Send keeps (the orders' shareTo and the address's entry with bill only when ticked), what goes to POST /alerts/share (bill and
// the amount before tax on the order's step as it is now), what the worker's answer marks and the toast says, an order a
// remembered address sends by itself, an answer the worker couldn't bill (sent again) and one from a worker before 1.9.161, and
// Settings → Orders sent to buyers. Sample names, addresses and keys only.
//   node .github/scripts/send-bill.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have it (#sb-bill); a page named on the command line that doesn't is skipped.
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
if (!HTML.includes('id="sb-bill"')) {
  if (!process.argv[2]) { console.error(`${file} has no Add to their invoice in Send to buyer (#sb-bill): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Add to their invoice, skipped`); process.exit(0);
}
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, refreshPremium, isPremiumOwner, openSendToBuyer, reportSharedOrders, sentBuyersSectionHTML, closeAllLayers};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const BUYERS = [
  { id: "a1b2c3d4e5f60718", user: "sam.sample", name: "Sam Sample", last4: "7Q2X" },
  { id: "b2c3d4e5f6071829", user: "pat.example", name: "Pat Example", last4: "K8M4" },
];
// W.bill: how the worker answers an event sent with bill ("added", "had", null), or "old" for a worker before 1.9.161 (no list).
const W = { shares: [], bill: () => "added" };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/premium") return json(route, 200, { premium: true, owner: true });
  if (p === "/alerts/buyers") return json(route, 200, { buyers: BUYERS });
  if (p === "/alerts/share" && m === "POST") {
    const body = JSON.parse(req.postData());
    W.shares.push(body);
    const out = { ok: true, sent: body.events.length, already: 0, updated: 0, bad: 0, other: 0, res: body.events.map(() => "sent") };
    if (W.bill !== "old") out.bill = body.events.map((e) => (e.bill === true ? W.bill(e) : null));
    return json(route, 200, out);
  }
  if (p === "/alerts/forward/claim") return json(route, 200, { claim: "", claimed: [], done: [], busy: [] });
  if (p === "/alerts") return json(route, 200, { alerts: [], now: Date.now() });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: true, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 60, stores: { target: 20, pokemoncenter: 20, costco: 20 }, base: 20, request: null, canRequest: true });
  if (p === "/alerts/sender") return json(route, 200, { status: "allowed" });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const P = "#layers .layer:not([inert]) .panel";   // the window open now, not one fading out
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const until = async (cond, what, ms = 10000) => { for (const t0 = Date.now(); !(await cond());) { if (Date.now() - t0 > ms) throw new Error("waited too long for " + what); await new Promise((r) => setTimeout(r, 25)); } };
const toasts = () => ev(() => window.__toasts.slice());
const SAM = BUYERS[0].id;
// A Target order shipping to one of two sample addresses, added now (so a remembered address takes it).
let seq = 0;
const addOrder = (o) => ev((o) => {
  const S = window.__t.S;
  S.orders.push(Object.assign({ store: "target", storeName: "Target", item: "Ditto Premium Collection", qty: "1", total: "$64.18", priceEach: "$59.99",
    shipTo: "Sam Sample", status: "placed", stage: "placed", at: new Date().toISOString().slice(0, 10), createdAt: Date.now(), inbox: "orders.sample@example.com", updatedAt: Date.now() }, o));
  window.__t.persist(); window.__t.render();
}, Object.assign({ id: "o" + ++seq, orderNo: "90200000000000" + seq, shipAddr: "1 Sample St, Austin, TX 78701" }, o));
const order = (id) => ev((id) => JSON.parse(JSON.stringify(window.__t.S.orders.find((o) => o.id === id))), id);
const open = async (ids) => {
  await ev((ids) => window.__t.openSendToBuyer(new Set(ids)), ids);
  await page.waitForSelector(`${P} #sb-list .sb-row`);
};
const pickBuyer = (id) => page.click(`${P} #sb-list input[value="${id}"]`);
const send = async () => {
  const n = W.shares.length, t = (await toasts()).length;
  await page.click(`${P} #sb-send`);
  await until(async () => W.shares.length > n && (await toasts()).length > t, "the send and its toast");
  return (await toasts()).slice(t).join(" | ");
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent.replace(/\s+/g, " ").trim()); })
      .observe(document, { childList: true, subtree: true });
  });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForSelector("#pw1");
  await page.fill("#pw1", "sample-pass-161"); await page.fill("#pw2", "sample-pass-161"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  await ev((lic) => window.__t.keepTypedLic(lic), LIC);
  await ev(() => window.__t.refreshPremium(true));
  await page.waitForFunction(() => window.__t.isPremiumOwner());

  await test("the window: Add to their invoice is ticked, names the buyer once one is picked, and says future orders there are billed too", async () => {
    await addOrder({ id: "s1" });
    await open(["s1"]);
    assert.equal(await page.$eval(`${P} #sb-bill`, (e) => e.checked), true);
    assert.match(await text(`${P} .item-sub`), /Tick Add to their invoice to bill them for this checkout\.$/);
    assert.equal(await text(`${P} #sb-bill-hint`), "Each order goes on their invoice as one checkout, priced like their others: $5 for Friends and Family, otherwise by the order's amount before tax. A store cancel takes it off. An order already on their invoice isn't added twice.");
    await pickBuyer(SAM);
    assert.match(await text(`${P} #sb-bill-hint`), /^Each order goes on Sam Sample's invoice as one checkout/);
    assert.equal(await page.$eval(`${P} #sb-keep`, (e) => e.checked), true);
    assert.match(await text(`${P} #sb-note`), /Future orders sent there go on Sam Sample's invoice too\./);
    await page.click(`${P} #sb-bill`);
    assert.doesNotMatch(await text(`${P} #sb-note`).catch(() => ""), /invoice/, "unticked: no line about the invoice");
    await page.click(`${P} #sb-keep`);
    await page.click(`${P} #sb-bill`);
    assert.doesNotMatch(await text(`${P} #sb-note`).catch(() => ""), /invoice/, "not remembering the address: no line about future orders");
    await page.click(`${P} #sb-keep`);
    assert.match(await text(`${P} #sb-note`), /go on Sam Sample's invoice too/);
  });

  await test("Send with it ticked: the order goes with bill and its amount before tax, the order and the address keep it, and the toast says it's on their invoice", async () => {
    const said = await send();
    const sent = W.shares[W.shares.length - 1];
    assert.equal(sent.to, SAM);
    assert.deepEqual(sent.events.map((e) => [e.stage, e.orderNo, e.bill, e.sub, e.total]), [["placed", "902000000000001", true, "59.99", "$64.18"]]);
    assert.equal(said, "Sent 1 order to @sam.sample · Sam Sample. Its updates go there too. It's on their invoice now.");
    const o = await order("s1");
    assert.deepEqual([o.shareTo.id, o.shareTo.by, o.shareTo.bill], [SAM, "hand", true]);
    assert.equal(o.shareTold.billed, 1);
    const ents = await ev(() => Object.values(window.__t.S.settings.buyerAddrs || {}));
    assert.deepEqual(ents.map((e) => [e.id, e.addr, e.bill]), [[SAM, "1 Sample St, Austin, TX 78701", true]]);
    const sec = await ev(() => { const d = document.createElement("div"); d.innerHTML = window.__t.sentBuyersSectionHTML(); return d.textContent.replace(/\s+/g, " ").trim(); });
    assert.match(sec, /With Add to their invoice ticked \(it starts ticked\), each one goes on that buyer's invoice as a checkout/);
    assert.match(sec, /1 Sample St, Austin, TX 78701 · goes on their invoice/);
  });

  await test("it starts ticked every time; unticked, nothing goes with bill and nothing is kept for the invoice", async () => {
    await addOrder({ id: "s2", shipAddr: "2 Sample Ave, Austin, TX 78702" });
    await open(["s2"]);
    assert.equal(await page.$eval(`${P} #sb-bill`, (e) => e.checked), true, "ticked again");
    await pickBuyer(SAM);
    await page.click(`${P} #sb-bill`);
    const said = await send();
    const sent = W.shares[W.shares.length - 1];
    assert.ok(sent.events.every((e) => !("bill" in e) && !("sub" in e)), JSON.stringify(sent.events));
    assert.equal(said, "Sent 1 order to @sam.sample · Sam Sample. Its updates go there too.");
    const o = await order("s2");
    assert.equal(o.shareTo.bill, undefined); assert.equal(o.shareTold.billed, undefined);
    const e = await ev(() => Object.values(window.__t.S.settings.buyerAddrs).find((e) => e.addr.startsWith("2 Sample")));
    assert.equal(e.bill, undefined);
    await open(["s2"]);
    assert.equal(await page.$eval(`${P} #sb-bill`, (e) => e.checked), true, "and ticked again after that");
    await ev(() => window.__t.closeAllLayers());
  });

  await test("an order at an address remembered with it goes on the invoice by itself; one at an address remembered without it doesn't", async () => {
    await addOrder({ id: "s3" });
    await addOrder({ id: "s4", shipAddr: "2 Sample Ave, Austin, TX 78702" });
    const n = W.shares.length;
    await ev(() => window.__t.reportSharedOrders());
    const evs = W.shares.slice(n).flatMap((b) => b.events);
    assert.deepEqual(evs.map((e) => [e.orderNo, e.auto, !!e.bill]).sort(), [["902000000000003", true, true], ["902000000000004", true, false]]);
    const [o3, o4] = [await order("s3"), await order("s4")];
    assert.deepEqual([o3.shareTo.by, o3.shareTo.bill, o3.shareTold.billed], ["addr", true, 1]);
    assert.deepEqual([o4.shareTo.by, o4.shareTo.bill, o4.shareTold.billed], ["addr", undefined, undefined]);
  });

  await test("an answer the worker couldn't bill says nothing of the invoice and goes again; a worker before 1.9.161 isn't asked again", async () => {
    await addOrder({ id: "s5" });
    W.bill = () => null;
    await open(["s5"]);
    await pickBuyer(SAM);
    assert.equal(await send(), "Sent 1 order to @sam.sample · Sam Sample. Its updates go there too.");
    assert.equal((await order("s5")).shareTold.billed, undefined);
    W.bill = () => "added";
    const n = W.shares.length;
    await ev(() => window.__t.reportSharedOrders());
    assert.deepEqual(W.shares.slice(n).flatMap((b) => b.events).map((e) => [e.orderNo, e.stage, e.bill]), [["902000000000005", "placed", true]], "its step again, for the bill");
    assert.equal((await order("s5")).shareTold.billed, 1);
    await addOrder({ id: "s6" });
    W.bill = "old";
    await open(["s6"]);
    await pickBuyer(SAM);
    assert.equal(await send(), "Sent 1 order to @sam.sample · Sam Sample. Its updates go there too.");
    assert.equal((await order("s6")).shareTold.billed, 1, "an older worker can't bill: not asked again");
    W.bill = () => "added";
  });

  await test("two orders, one added and one already on their invoice: the toast counts the one", async () => {
    await addOrder({ id: "s7" }); await addOrder({ id: "s8" });
    W.bill = (e) => (e.orderNo === "902000000000008" ? "had" : "added");
    await open(["s7", "s8"]);
    await pickBuyer(SAM);
    assert.match(await text(`${P} .item-sub`), /bill them for these checkouts\.$/);
    assert.equal(await send(), "Sent 2 orders to @sam.sample · Sam Sample. Their updates go there too. 1 of them is on their invoice now.");
    assert.deepEqual([(await order("s7")).shareTold.billed, (await order("s8")).shareTold.billed], [1, 1]);
    W.bill = () => "added";
    await addOrder({ id: "s9" }); await addOrder({ id: "s10" });
    await open(["s9", "s10"]);
    await pickBuyer(SAM);
    assert.equal(await send(), "Sent 2 orders to @sam.sample · Sam Sample. Their updates go there too. They're on their invoice now.");
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
