// Tests Send to buyer in the newest page (index-X.Y.Z.html), from 1.9.138: the seller's own FAFO sends orders it picks to one of
// its buyers' FAFOs, with their ship-to and tracking, and each update; an address it was sent to sends that buyer future orders
// by itself; and the buyer's FAFO puts what the seller sent on the order (applySellerAlerts, sellerDetailsApply). The page's own
// code runs here: the SHARE-START block, reportSharedOrders against a pretend license worker, and the Jig code that writes the
// address variants the key must see through. Sample names and addresses only.
//   node .github/scripts/send-to-buyer.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have Send to buyer; a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const html = readFileSync(file, "utf8");
if (!html.includes("/* SHARE-START")) {
  if (!process.argv[2]) { console.error(`${file} has no Send to buyer (SHARE-START): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Send to buyer, skipped`); process.exit(0);
}
const block = (a, b) => { const s = html.indexOf(a), e = html.indexOf(b, s); assert.ok(s >= 0 && e > s, `couldn't find ${a}`); return html.slice(s, e); };
const fn = (head) => { const s = html.indexOf(head); assert.ok(s >= 0, head); let i = html.indexOf("{", s), d = 0; do { d += html[i] === "{" ? 1 : html[i] === "}" ? -1 : 0; i++; } while (d); return html.slice(s, i); };
const line = (re) => { const m = html.match(re); assert.ok(m, String(re)); return m[0]; };

const code = [
  line(/^const norm = .*$/m), line(/^const STORES = .*$/m), line(/^const storeKeyOf = .*$/m), line(/^const orderStoreLabel = .*$/m), line(/^function orderKey\(o\)\{.*\}$/m),
  line(/^const STAGE_RANK = .*$/m), line(/^const ALERT_STEPS = .*$/m), line(/^const genRand = .*$/m),
  block("const CARRIERS = {", "function detectCarrier"), fn("function mergeTracking(o, list){"),
  block("const JIG_DIRS = ", "function jigAssign(rows"),   // Jig's tables, jigOrdinal, JIG_UNIT_AT_END and jigChoices
  block("/* SHARE-START", "/* SHARE-END */"),
  block("const SHARE = {busy", "// Send to buyer, on the Orders selection bar"),
  fn("function applySellerAlerts(list){"),
].join("\n");
const prelude = `let S = null; const MODE = "vault"; let OWNER = true; const UI = {view:"orders"}; const calls = [];
  const isPremiumOwner = () => OWNER, sellerLic = () => "PVLT-TEST-TEST-TEST-TEST", persist = () => {}, renderMain = () => {}, refreshPremium = () => calls.push("premium");
  const orderById = (id) => (S.orders || []).find(o => o.id === id) || null;
  let SERVER = async () => ({ok:true, status:200, json:async () => ({ok:true})});
  const alertApi = (path, opts) => { calls.push([path, opts && JSON.parse(opts.body || "null")]); return SERVER(path, opts && JSON.parse(opts.body || "null")); };`;
const api = new Function(prelude + code + `
  return {setS:(s) => { S = s; }, getS:() => S, setOwner:(v) => { OWNER = v; }, setServer:(f) => { SERVER = f; }, calls, SHARE,
    shareAddrKey, shareTargetOf, sharePlan, shareMark, sellerDetailsApply, reportSharedOrders, applySellerAlerts, jigChoices, shareDetOf};`)();

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const DAY = 86400000, T0 = Date.UTC(2026, 10, 1, 12);
const order = (o) => ({ id: "o" + Math.random().toString(36).slice(2, 8), createdAt: T0 + DAY, store: "target", storeName: "", item: "Ditto Premium Collection", orderNo: "102000000000001",
  qty: "2", total: "$119.98", at: "2026-11-02", shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701", card: "Visa ••1234", stage: "placed", inbox: "seller@example.com", ...o });
const oneLine = (v, state = "TX") => `${v.line1}${v.line2 ? ", " + v.line2 : ""}, ${v.city}, ${state} ${v.zip}${v.zip4 ? "-" + v.zip4 : ""}`;

console.log("The address key");
await test("every way Jig for Target writes an address has its key, and another street, number or ZIP doesn't", () => {
  for (const a of [{ line1: "1801 N Orchard Dr", line2: "Apt 4", city: "Saint Paul", zip: "55101" }, { line1: "200 18th Ave NW", line2: "", city: "Austin", zip: "78701" },
    { line1: "500 W 21st St", line2: "Unit 12", city: "Fort Worth", zip: "76102" }]) {
    const vs = api.jigChoices(a, ["line1", "line2", "city", "zip"]).order;
    assert.ok(vs.length > 10, `Jig writes ${oneLine(a)} many ways: ${vs.length}`);
    const keys = new Set(vs.map((v) => api.shareAddrKey(oneLine(v)))), want = api.shareAddrKey(oneLine(a));
    assert.ok(want, oneLine(a));
    assert.deepEqual([...keys], [want], `${oneLine(a)}: ${[...keys].join(" / ")}`);
  }
  const k = api.shareAddrKey("1 Main St, Apt 2, Austin, TX 78701");
  for (const same of ["1 Main Street, Austin, TX 78701-1234", "1 MAIN ST #2, AUSTIN, TX 78701", "1 Main St., Ste 450, Austin, TX 78701", "1 Main St Apt 2, Austin TX 78701",
    "1 Main St 45, Austin, TX 78701", "1 Main St, Bldg 3, Austin, TX 78701", "1 Main St, #fl5, Austin, TX 78701", "1 Ma.in St, Austin, TX 78701", "1 Main Str, Spc 12, Austin, TX 78701"])
    assert.equal(api.shareAddrKey(same), k, same);
  for (const other of ["2 Main St, Austin, TX 78701", "1 Main St, Austin, TX 78702", "1 Oak St, Austin, TX 78701", "1 Main Ave, Austin, TX 78701", "1 S Main St, Austin, TX 78701"])
    assert.notEqual(api.shareAddrKey(other), k, other);
  assert.equal(api.shareAddrKey("18th Ave N, Austin, TX 78701"), api.shareAddrKey("Eighteenth Avenue North, Austin, TX 78701"));
  assert.equal(api.shareAddrKey("21 Twenty First St, Austin, TX 78701"), api.shareAddrKey("21 21st Street, Austin, TX 78701"));
  assert.notEqual(api.shareAddrKey("100 Route 66, Austin, TX 78701"), api.shareAddrKey("100 Route 9, Austin, TX 78701"), "a route's number is the street's");
  for (const none of ["", "Austin, TX", "1 Main St", "somewhere 78701"]) assert.equal(api.shareAddrKey(none), "", none);
});

console.log("\nWho an order goes to, and what");
const addrs = (o) => ({ [api.shareAddrKey("1 Main St, Austin, TX 78701") + "|b1"]: { key: api.shareAddrKey("1 Main St, Austin, TX 78701"), id: "b1", name: "@sam", addr: "1 Main St, Austin, TX 78701", at: T0, ...o } });
await test("an order sent by hand goes to that buyer; one stopped, from the seller, or with no number goes nowhere", () => {
  assert.deepEqual(api.shareTargetOf(order({ shareTo: { id: "b2", name: "@kim", by: "hand" } }), addrs()), { id: "b2", name: "@kim", by: "hand" }, "by hand wins over a remembered address");
  assert.equal(api.shareTargetOf(order({ shareTo: { off: true } }), addrs()), null);
  assert.equal(api.shareTargetOf(order({ fromSeller: true }), addrs()), null);
  assert.equal(api.shareTargetOf(order({ orderNo: "" }), addrs()), null);
});
await test("a remembered address sends orders FAFO adds from that day on, any unit there, unless it's remembered for two buyers", () => {
  assert.deepEqual(api.shareTargetOf(order({ shipAddr: "1 Main Street, Unit 9, Austin, TX 78701" }), addrs()), { id: "b1", name: "@sam", by: "addr" });
  assert.equal(api.shareTargetOf(order({ createdAt: T0 - DAY, at: "2026-10-30" }), addrs()), null, "added and placed before");
  assert.ok(api.shareTargetOf(order({ createdAt: T0 - DAY, at: "2026-11-01" }), addrs()), "placed that day");
  assert.ok(api.shareTargetOf(order({ createdAt: T0 + 1, at: "2026-10-01" }), addrs()), "an older order FAFO only found now");
  assert.equal(api.shareTargetOf(order({ shipAddr: "2 Main St, Austin, TX 78701" }), addrs()), null);
  assert.equal(api.shareTargetOf(order({ shipAddr: "" }), addrs()), null);
  const two = Object.assign(addrs(), { [api.shareAddrKey("1 Main St, Austin, TX 78701") + "|b9"]: { key: api.shareAddrKey("1 Main St, Austin, TX 78701"), id: "b9", name: "@lee", at: T0 } });
  assert.equal(api.shareTargetOf(order(), two), null, "two buyers: it waits to be picked");
});
await test("it sends the order and where it is now, once each; the ship-to or tracking changed sends its step again; a new buyer starts over", () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" }, stage: "shipped", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }] });
  let p = api.sharePlan([o], {});
  const it = p.get("b1")[0];
  assert.deepEqual(it.steps, ["placed", "shipped"]);
  assert.deepEqual(it.events[1], { stage: "shipped", store: "target", storeName: "Target", orderNo: "102000000000001", item: "Ditto Premium Collection", qty: "2", total: "$119.98",
    at: "2026-11-02", shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }] });
  assert.ok(!JSON.stringify(it.events).includes("Visa"), "never the card");
  api.shareMark(o, it, T0);
  assert.equal(api.sharePlan([o], {}).size, 0, "nothing new");
  o.stage = "delivered";
  assert.deepEqual(api.sharePlan([o], {}).get("b1")[0].steps, ["delivered"]);
  api.shareMark(o, api.sharePlan([o], {}).get("b1")[0], T0);
  o.tracking = o.tracking.concat([{ number: "9400100000000000000002", carrier: "usps" }]);
  p = api.sharePlan([o], {}).get("b1")[0];
  assert.deepEqual(p.steps, ["delivered"], "its step again, with the new tracking");
  assert.equal(p.events[0].tracking.length, 2);
  api.shareMark(o, p, T0);
  o.shareTo = { id: "b2", name: "@kim", by: "hand" };
  assert.deepEqual(api.sharePlan([o], {}).get("b2")[0].steps, ["placed", "delivered"]);
});
await test("an order a remembered address sends gets that buyer once it's sent, and keeps them", () => {
  const o = order();
  const it = api.sharePlan([o], addrs()).get("b1")[0];
  api.shareMark(o, it, T0 + 5);
  assert.deepEqual(o.shareTo, { id: "b1", name: "@sam", by: "addr", at: T0 + 5 });
  assert.equal(api.sharePlan([o], {}).size, 0, "forgetting the address doesn't take back what went, nor send it again");
});

console.log("\nSending them (a pretend license worker)");
const ok = (body) => ({ ok: true, status: 200, json: async () => body || { ok: true } });
const no = (status, error) => ({ ok: false, status, json: async () => ({ error }) });
await test("each buyer's orders go in one request of up to 100 events, and are marked once the worker took them", async () => {
  const orders = Array.from({ length: 70 }, (_, i) => order({ id: "x" + i, orderNo: "N" + i, stage: i % 2 ? "shipped" : "placed", shareTo: { id: i < 60 ? "b1" : "b2", name: "x", by: "hand" } }));
  api.setS({ orders, settings: {} }); api.calls.length = 0; api.setServer(async () => ok());
  const r = await api.reportSharedOrders();
  assert.equal(r.sent, 70); assert.deepEqual(r.failed, []);
  const posts = api.calls.filter((c) => Array.isArray(c) && c[0] === "/alerts/share");
  assert.deepEqual(posts.map((c) => [c[1].to, c[1].events.length]), [["b1", 90], ["b2", 15]], "b1: 30 placed + 30 × 2; b2: 10 orders");
  assert.ok(posts.every((c) => c[1].events.length <= 100));
  assert.ok(orders.every((o) => o.shareTold && o.shareTold.steps.placed));
  api.calls.length = 0;
  assert.deepEqual(await api.reportSharedOrders(), { sent: 0, failed: [] });
  assert.equal(api.calls.length, 0, "nothing to send: no request");
});
await test("a buyer the worker refuses is noted and the others still go; a busy or unreachable worker stops until the next run", async () => {
  const orders = [order({ id: "a", orderNo: "A1", shareTo: { id: "b1", name: "@sam", by: "hand" } }), order({ id: "b", orderNo: "B1", shareTo: { id: "b2", name: "@kim", by: "hand" } })];
  api.setS({ orders, settings: {} });
  api.setServer(async (path, body) => body.to === "b1" ? no(410, "This buyer's license is turned off.") : ok());
  let r = await api.reportSharedOrders();
  assert.equal(r.sent, 1); assert.deepEqual(r.failed, [["@sam", "This buyer's license is turned off."]]);
  assert.equal(api.SHARE.err.b1, "This buyer's license is turned off.");
  assert.ok(!orders[0].shareTold && orders[1].shareTold);
  api.setServer(async () => no(503, "later"));
  orders[1].stage = "shipped";
  r = await api.reportSharedOrders();
  assert.equal(r.sent, 0);
  assert.equal(orders[1].shareTold.steps.shipped, undefined, "not marked: it goes again");
  api.setServer(async () => { throw new Error("offline"); });
  r = await api.reportSharedOrders();
  assert.equal(r.failed[0][1], "Couldn't reach the license server.");
  api.setServer(async () => ok());
  r = await api.reportSharedOrders();
  assert.equal(r.sent, 2); assert.equal(api.SHARE.err.b1, undefined, "sent once the license is back on");
});
await test("only the seller's own FAFO sends; one that stopped being it (403) stops and checks again", async () => {
  api.setS({ orders: [order({ shareTo: { id: "b1", name: "@sam", by: "hand" } })], settings: {} }); api.calls.length = 0;
  api.setOwner(false);
  assert.deepEqual(await api.reportSharedOrders(), { sent: 0, failed: [] });
  assert.equal(api.calls.length, 0);
  api.setOwner(true);
  api.setServer(async () => no(403, "not the alert sender"));
  const r = await api.reportSharedOrders();
  assert.match(r.failed[0][1], /Only your own FAFO/);
  assert.ok(api.calls.includes("premium"));
});
await test("an order locked away meanwhile isn't marked", async () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  api.setS({ orders: [o], settings: {} });
  api.setServer(async () => { api.setS({ orders: [], settings: {} }); return ok(); });
  await api.reportSharedOrders();
  assert.equal(o.shareTold, undefined);
});

console.log("\nOn the buyer's FAFO");
const alert = (o) => ({ id: "a" + Math.random(), oid: "oid0000000000000001", store: "target", storeName: "Target", profile: "", orderNo: "102000000000001", item: "Ditto Premium Collection",
  qty: "2", total: "$119.98", stage: "placed", at: "2026-11-02", createdAt: T0, shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701",
  tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }], ...o });
const buyer = () => ({ orders: [], settings: {}, deletedOrders: {} });
await test("an order the seller sent comes with its ship-to and tracking, the same on every device", () => {
  const a = buyer(), b = buyer(), list = [alert(), alert({ stage: "shipped", createdAt: T0 + 60000, id: "x2" })];
  api.setS(a); const news = api.applySellerAlerts(list);
  api.setS(b); api.applySellerAlerts(list.slice().reverse());
  assert.equal(news.length, 2);
  const o = a.orders[0];
  assert.deepEqual([o.id, o.fromSeller, o.stage, o.shipTo, o.shipAddr, o.tracking], ["sa-oid0000000000000001", true, "shipped", "Sam Buyer", "1 Main St, Apt 2, Austin, TX 78701", [{ number: "1ZWY0000000000001", carrier: "ups" }]]);
  assert.equal(JSON.stringify(a.orders), JSON.stringify(b.orders));
});
await test("an update brings new tracking and an address the buyer didn't change; never over what the buyer typed", () => {
  const s = buyer(); api.setS(s);
  api.applySellerAlerts([alert()]);
  const o = s.orders[0];
  let news = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 1000, shipAddr: "1 Main Street, Apt 2, Austin, TX 78701", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }, { number: "TBA123456789012", carrier: "amazon" }] })]);
  assert.equal(news.length, 0, "no notification for it"); assert.equal(news.changed, true);
  assert.equal(o.shipAddr, "1 Main Street, Apt 2, Austin, TX 78701"); assert.equal(o.tracking.length, 2); assert.equal(o.updatedAt, T0 + 1000);
  o.shipTo = "Sam B. (typed)";
  o.tracking.push({ number: "MANUAL1234", carrier: "other", manual: true });
  news = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 2000, shipTo: "Somebody Else", tracking: [{ number: "TBA123456789012", carrier: "amazon" }] })]);
  assert.equal(o.shipTo, "Sam B. (typed)", "the buyer's own");
  assert.deepEqual(o.tracking.map((t) => t.number), ["TBA123456789012", "MANUAL1234"], "the one the seller took off goes, the buyer's stays");
  assert.equal(api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 3000, shipTo: "Somebody Else", tracking: [{ number: "TBA123456789012", carrier: "amazon" }] })]).changed, undefined, "the same again: nothing");
});
await test("an update for an order this FAFO doesn't have, or deleted, adds nothing; an alert without details is as before", () => {
  const s = buyer(); api.setS(s);
  assert.equal(api.applySellerAlerts([alert({ stage: "update" })]).length, 0); assert.equal(s.orders.length, 0);
  s.deletedOrders["target|#102000000000001"] = 1;
  api.applySellerAlerts([alert()]); assert.equal(s.orders.length, 0);
  const t = buyer(); api.setS(t);
  const { shipTo, shipAddr, tracking, ...plain } = alert();
  api.applySellerAlerts([plain]);
  assert.deepEqual([t.orders[0].shipTo, t.orders[0].shipAddr, t.orders[0].tracking, t.orders[0].sellerSent], ["", "", undefined, undefined]);
  assert.equal(api.applySellerAlerts([alert({ stage: "lost" })]).length, 0, "not a step");
  for (const bad of [[{ number: "<b>", carrier: "ups" }], [{ number: "1Z1234", carrier: "rocket" }]]) {
    const u = buyer(); api.setS(u); api.applySellerAlerts([alert({ tracking: bad })]);
    assert.deepEqual(u.orders[0].tracking || [], bad[0].carrier === "rocket" ? [{ number: "1Z1234", carrier: "other" }] : []);
  }
});

// The page wires it in: the bar's button, the timer, the email sync, lock, Settings, and the sync merge of remembered addresses.
await test("the page runs it, shows it to the seller's own FAFO only, and merges remembered addresses per entry", () => {
  assert.match(html, /canShare\(\) \? `<button class="btn btn-sm" data-act="orders-send">/);
  assert.match(html, /case "orders-send": openSendToBuyer\(new Set\(UI\.orderSel\)\)/);
  assert.match(fn("function startApp(){"), /scheduleSharedOrders\(\)/);
  assert.match(html, /reportOrderAlerts\(\);[^\n]*\n\s*reportSharedOrders\(\);/);
  assert.match(html, /SHARE\.buyers = null; SHARE\.buyersAt = 0; SHARE\.err = \{\};/);
  assert.match(html, /k === SYNC_CODE\.settings \+ ":buyerAddrs"\)\) bv = \{\};/);
  assert.match(html, /<section id="s-sentbuyers" class="set-sec">\$\{sentBuyersSectionHTML\(\)\}<\/section>/);
});

console.log(`${passed} passed`);
