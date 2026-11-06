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
  line(/^const STAGE_RANK = .*$/m), line(/^const ALERT_STEPS = .*$/m), line(/^const genRand = .*$/m), line(/^const genPick = .*$/m),
  block("const CARRIERS = {", "function detectCarrier"), fn("function mergeTracking(o, list){"),
  block("const JIG_DIRS = ", "function jigAssign(rows"),   // Jig's tables, jigOrdinal, JIG_UNIT_AT_END and jigChoices
  block("const pkcNum = ", "// One key per building"), fn("function pkcForms(b){"),   // Jig for Pokémon Center's ways of writing an address
  block("/* SHARE-START", "/* SHARE-END */"),
  block("const SHARE = {busy", "// Send to buyer, on the Orders selection bar"),
  line(/^const SELLER_DET_FROM = .*$/m), fn("async function pollSellerAlerts(){"), fn("function applySellerAlerts(list){"),
].join("\n");
const prelude = `let S = null; const MODE = "vault"; let OWNER = true; const UI = {view:"orders"}; const calls = [];
  const isPremiumOwner = () => OWNER, sellerLic = () => "PVLT-TEST-TEST-TEST-TEST", persist = () => {}, renderMain = () => {}, refreshPremium = () => calls.push("premium");
  const orderById = (id) => (S.orders || []).find(o => o.id === id) || null;
  const OALERT = {busy:false}, SYNC = {busy:false, state:"", gotAt:0, oneStoreDue:false}, W = {on:false, blocked:false, caught:true, soon:[]};
  const syncOn = () => W.on, syncBlocked = () => W.blocked, sellerCaughtUp = () => W.caught, syncSoon = (ms) => W.soon.push(ms);
  // pollSellerAlerts' surroundings
  const DESK = true, document = {hidden:false}, sellerAlertsCan = () => true, sellerAlertsWait = () => 0, sellerAlertsSoon = () => {}, syncRender = () => {}, autoPicturesSoon = () => {};
  const ALERT_STEP_TEXT = {placed:"order placed", shipped:"shipped", arriving:"arriving", delivered:"delivered", canceled:"canceled"}, sendAlert = () => {}, toast = () => {};
  let sellerBusy = false, sellerAskedAt = 0;
  let SERVER = async () => ({ok:true, status:200, json:async () => ({ok:true})});
  const alertApi = (path, opts) => { calls.push([path, opts && opts.body ? JSON.parse(opts.body) : null]); return SERVER(path, opts && opts.body ? JSON.parse(opts.body) : null); };`;
const api = new Function(prelude + code + `
  return {setS:(s) => { S = s; }, getS:() => S, setOwner:(v) => { OWNER = v; }, setServer:(f) => { SERVER = f; }, calls, SHARE, W, OALERT, SELLER_DET_FROM,
    shareAddrKey, shareTargetOf, sharePlan, shareMark, sellerDetailsApply, reportSharedOrders, sharedOrdersSynced, applySellerAlerts, pollSellerAlerts, jigChoices, pkcForms, shareDetOf};`)();

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const DAY = 86400000, T0 = Date.UTC(2026, 10, 1, 12);
let seq = 0;
const order = (o) => ({ id: "o" + ++seq, createdAt: T0 + DAY, store: "target", storeName: "", item: "Ditto Premium Collection", orderNo: "102000000000001",
  qty: "2", total: "$119.98", at: "2026-11-02", shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701", card: "Visa ••1234", stage: "placed", inbox: "seller@example.com", ...o });
const oneLine = (v, state = "TX") => `${v.line1}${v.line2 ? ", " + v.line2 : ""}, ${v.city}, ${state} ${v.zip}${v.zip4 ? "-" + v.zip4 : ""}`;

console.log("The address key");
await test("every way Jig for Target writes an address has its key, and another street, number or ZIP doesn't", () => {
  for (const a of [{ line1: "1801 N Orchard Dr", line2: "Apt 4", city: "Saint Paul", zip: "55101" }, { line1: "200 18th Ave NW", line2: "", city: "Austin", zip: "78701" },
    { line1: "500 W 21st St", line2: "Unit 12", city: "Fort Worth", zip: "76102" }, { line1: "77 Meadow Ln", line2: "", city: "Mount Vernon", zip: "10550" }]) {
    const vs = api.jigChoices(a, ["line1", "line2", "city", "zip"]).order;
    assert.ok(vs.length > 10, `Jig writes ${oneLine(a)} many ways: ${vs.length}`);
    const keys = new Set(vs.map((v) => api.shareAddrKey(oneLine(v)))), want = api.shareAddrKey(oneLine(a));
    assert.ok(want, oneLine(a));
    assert.deepEqual([...keys], [want], `${oneLine(a)}: ${[...keys].join(" / ")}`);
  }
  const k = api.shareAddrKey("1 Main St, Apt 2, Austin, TX 78701");
  for (const same of ["1 Main Street, Austin, TX 78701-1234", "1 MAIN ST #2, AUSTIN, TX 78701", "1 Main St., Ste 450, Austin, TX 78701", "1 Main St Apt 2, Austin TX 78701",
    "1 Main St 45, Austin, TX 78701", "1 Main St, Bldg 3, Austin, TX 78701", "1 Main St, #fl5, Austin, TX 78701", "1 Ma.in St, Austin, TX 78701", "1 Main Str, Spc 12, Austin, TX 78701",
    "1 Main St Apt B, Austin, TX 78701", "Apt 2, 1 Main St, Austin, TX 78701", "1 Main St # 2, Austin, TX 78701"])
    assert.equal(api.shareAddrKey(same), k, same);
  for (const other of ["2 Main St, Austin, TX 78701", "1 Main St, Austin, TX 78702", "1 Oak St, Austin, TX 78701", "1 Main Ave, Austin, TX 78701", "1 S Main St, Austin, TX 78701"])
    assert.notEqual(api.shareAddrKey(other), k, other);
  assert.equal(api.shareAddrKey("200 18th Ave N, Austin, TX 78701"), api.shareAddrKey("200 Eighteenth Avenue North, Austin, TX 78701"));
  assert.equal(api.shareAddrKey("21 Twenty-First St, Austin, TX 78701"), api.shareAddrKey("21 21st Street, Austin, TX 78701"));
  assert.equal(api.shareAddrKey("P.O. Box 12, Austin, TX 78701"), api.shareAddrKey("PO Box 12, Austin, TX 78701"));
  assert.notEqual(api.shareAddrKey("PO Box 12, Austin, TX 78701"), api.shareAddrKey("PO Box 13, Austin, TX 78701"));
  for (const none of ["", "Austin, TX", "1 Main St", "somewhere 78701", "One Main St, 2nd Floor, Austin, TX 78701", "4B, Austin, TX 78701"]) assert.equal(api.shareAddrKey(none), "", none);
});
await test("a numbered road's own number is never taken for a unit, nor a word for one", () => {
  const key = (x) => api.shareAddrKey(x + ", Austin, TX 78701");
  for (const [a, b] of [["100 Route 66", "100 Route 9"], ["100 County Road 12", "100 County Road 13"], ["100 County Rd 12", "100 County Road 13"], ["100 State Road 84", "100 State Road 85"],
    ["100 N Loop 12", "100 N Loop 13"], ["100 State Route 9", "100 State Route 10"], ["100 Private Road 5", "100 Private Road 6"], ["100 Township Road 5", "100 Township Road 6"],
    ["100 Highway 50", "100 Highway 51"], ["100 Forest Service Road 5", "100 Forest Service Road 6"], ["100 Farm to Market Road 1960", "100 Farm to Market Road 1961"],
    ["100 Old Lot Rd", "100 Old Office Park"], ["100 Broadway 473", "100 Broadway"], ["100 Park Road 4", "100 Park Road 5"]])
    assert.notEqual(key(a), key(b), `${a} / ${b}`);
  assert.equal(key("100 County Road 12 595"), key("100 County Road 12"), "Jig for Pokémon Center's bare number after a road's own");
  assert.equal(key("100 County Rd 12"), key("100 County Road 12"));
  assert.equal(key("200 18th Ave NW 45"), key("200 18th Ave NW"));
  assert.equal(key("100 Court St"), key("100 Court Street"), "a type that's the street's name");
  assert.notEqual(key("100 Court St"), key("100 St"));
});
await test("every way Jig for Pokémon Center writes a building has its key", () => {
  for (const b of [{ line1: "1801 N Orchard Dr", line2: "" }, { line1: "1801 N Orchard Dr", line2: "Apt 4" }, { line1: "500 W 21st St Apt 12", line2: "" }, { line1: "77 Meadow Ln", line2: "# 3" },
    { line1: "100 County Road 12", line2: "" }, { line1: "200 18th Ave NW", line2: "" }]) {
    const want = api.shareAddrKey(oneLine({ ...b, city: "Austin", zip: "78701" }));
    assert.ok(want, b.line1);
    for (let round = 0; round < 20; round++) {
      const forms = api.pkcForms(b), all = forms.map((f) => f()).concat(forms.more ? Array.from({ length: 10 }, () => forms.more()()) : []);
      for (const v of all) assert.equal(api.shareAddrKey(oneLine({ ...v, city: "Austin", zip: "78701" })), want, `${b.line1} ${b.line2} → ${v.line1} | ${v.line2}`);
    }
  }
});

console.log("\nWho an order goes to, and what");
const MAIN = api.shareAddrKey("1 Main St, Austin, TX 78701");
const addrs = (o) => ({ [MAIN + "|b1"]: { key: MAIN, id: "b1", name: "@sam", addr: "1 Main St, Austin, TX 78701", at: T0, ...o } });
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
  const two = Object.assign(addrs(), { [MAIN + "|b9"]: { key: MAIN, id: "b9", name: "@lee", at: T0 } });
  assert.equal(api.shareTargetOf(order(), two), null, "two buyers: it waits to be picked");
});
await test("it sends the order and where it is now, once each, with when each happened and its account; the ship-to or tracking changed sends its step again; a new buyer starts over", () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" }, stage: "shipped", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }], sentTo: "Acct.One@Example.com",
    dates: { shipped: "2026-11-03T10:00:00.000Z", junk: "x" }, statusAt: "2026-11-03" });
  let p = api.sharePlan([o], {});
  const it = p.get("b1")[0];
  assert.deepEqual(it.steps, ["placed", "shipped"]);
  assert.deepEqual(it.events[1], { stage: "shipped", store: "target", storeName: "Target", orderNo: "102000000000001", item: "Ditto Premium Collection", qty: "2", total: "$119.98",
    at: "2026-11-02", account: "acct.one@example.com", auto: false, shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }],
    dates: { placed: "2026-11-02", shipped: "2026-11-03T10:00:00.000Z" } });
  assert.ok(!JSON.stringify(it.events).includes("Visa"), "never the card");
  assert.equal(api.sharePlan([order()], addrs()).get("b1")[0].events[0].auto, true, "a remembered address's is sent as one");
  assert.equal(api.sharePlan([order({ sentTo: "" })], addrs()).get("b1")[0].events[0].account, "seller@example.com", "else its inbox");
  api.shareMark(o, it, T0, ["sent", "sent"]);
  assert.equal(api.sharePlan([o], {}).size, 0, "nothing new");
  o.stage = "delivered";
  assert.deepEqual(api.sharePlan([o], {}).get("b1")[0].steps, ["delivered"]);
  api.shareMark(o, api.sharePlan([o], {}).get("b1")[0], T0, ["sent"]);
  o.tracking = o.tracking.concat([{ number: "9400100000000000000002", carrier: "usps" }]);
  p = api.sharePlan([o], {}).get("b1")[0];
  assert.deepEqual(p.steps, ["delivered"], "its step again, with the new tracking");
  assert.equal(p.events[0].tracking.length, 2);
  api.shareMark(o, p, T0, ["already"]);
  assert.equal(api.sharePlan([o], {}).size, 0);
  o.shipTo = "Sam B Buyer";
  assert.deepEqual(api.sharePlan([o], {}).get("b1")[0].steps, ["delivered"], "the ship-to name changed");
  o.shareTo = { id: "b2", name: "@kim", by: "hand" };
  assert.deepEqual(api.sharePlan([o], {}).get("b2")[0].steps, ["placed", "delivered"]);
  assert.equal(api.sharePlan([o, order({ id: "zz", orderNo: "9", shareTo: { id: "b1", by: "hand" } })], {}, new Set(["zz"])).size, 1, "only the orders asked for");
});
await test("an order a remembered address sends gets that buyer once it's sent, and keeps them; one on another buyer's account stops; a bad one isn't marked", () => {
  const o = order();
  const it = api.sharePlan([o], addrs()).get("b1")[0];
  api.shareMark(o, it, T0 + 5, ["sent"]);
  assert.deepEqual(o.shareTo, { id: "b1", name: "@sam", by: "addr", at: T0 + 5 });
  assert.equal(api.sharePlan([o], {}).size, 0, "forgetting the address doesn't take back what went, nor send it again");
  const q = order({ orderNo: "77" });
  api.shareMark(q, api.sharePlan([q], addrs()).get("b1")[0], T0, ["other"]);
  assert.deepEqual([q.shareTo.off, q.shareTold], [true, undefined], "on an account given to another buyer: never by itself");
  assert.equal(api.sharePlan([q], addrs()).size, 0);
  const r = order({ orderNo: "78" });
  api.shareMark(r, api.sharePlan([r], addrs()).get("b1")[0], T0, ["bad"]);
  assert.deepEqual([r.shareTo, r.shareTold], [undefined, undefined]);
});

console.log("\nSending them (a pretend license worker)");
const ok = (body) => ({ ok: true, status: 200, json: async () => body || { ok: true } });
const no = (status, error) => ({ ok: false, status, json: async () => ({ error }) });
const reset = (orders, w = {}) => { api.setS({ orders, settings: {} }); api.calls.length = 0; Object.keys(api.SHARE.err).forEach((k) => delete api.SHARE.err[k]); Object.assign(api.W, { on: false, blocked: false, caught: true, soon: [] }, w); api.SHARE.want = false; api.OALERT.busy = false; };
const posts = () => api.calls.filter((c) => Array.isArray(c) && c[0] === "/alerts/share");
await test("each buyer's orders go in requests of up to 100 events, an order's events never split, and are marked once the worker took them", async () => {
  const orders = Array.from({ length: 70 }, (_, i) => order({ id: "x" + i, orderNo: "N" + i, stage: i % 2 ? "shipped" : "placed", shareTo: { id: i < 60 ? "b1" : "b2", name: "x", by: "hand" } }));
  reset(orders); api.setServer(async () => ok());
  let r = await api.reportSharedOrders();
  assert.equal(r.sent, 70); assert.deepEqual(r.failed, []);
  assert.deepEqual(posts().map((c) => [c[1].to, c[1].events.length]), [["b1", 90], ["b2", 15]], "b1: 30 placed + 30 × 2; b2: 10 orders");
  assert.ok(orders.every((o) => o.shareTold && o.shareTold.steps.placed));
  api.calls.length = 0;
  assert.equal((await api.reportSharedOrders()).sent, 0);
  assert.equal(api.calls.length, 0, "nothing to send: no request");
  const many = Array.from({ length: 120 }, (_, i) => order({ id: "m" + i, orderNo: "M" + i, stage: "shipped", shareTo: { id: "b1", name: "x", by: "hand" } }));
  reset(many);
  api.setServer(async (path, body) => ok({ ok: true, res: body.events.map((e, i) => e.orderNo === "M3" ? "other" : "sent") }));
  r = await api.reportSharedOrders();
  assert.deepEqual(posts().map((c) => c[1].events.length), [100, 100, 40]);
  assert.equal(r.sent, 119, "the one the worker didn't take isn't counted");
  assert.equal(many[3].shareTold, undefined, "nor marked (sent by hand: no stop)");
  assert.ok(many.filter((o) => o.id !== "m3").every((o) => o.shareTold.steps.shipped));
});
await test("a buyer the worker refuses is noted, left an hour, and the others still go; a busy or unreachable worker stops them all until the next run", async () => {
  const orders = [order({ id: "a", orderNo: "A1", shareTo: { id: "b1", name: "@sam", by: "hand" } }), order({ id: "b", orderNo: "B1", shareTo: { id: "b2", name: "@kim", by: "hand" } })];
  reset(orders);
  api.setServer(async (path, body) => body.to === "b1" ? no(410, "This buyer's license is turned off.") : ok());
  let r = await api.reportSharedOrders();
  assert.equal(r.sent, 1); assert.deepEqual(r.failed, [["@sam", "This buyer's license is turned off."]]);
  assert.equal(api.SHARE.err.b1.why, "This buyer's license is turned off.");
  assert.ok(!orders[0].shareTold && orders[1].shareTold);
  api.calls.length = 0; api.setServer(async () => ok());
  r = await api.reportSharedOrders();
  assert.equal(posts().length, 0, "not asked again right away");
  r = await api.reportSharedOrders(new Set(["a"]));
  assert.equal(r.sent, 1, "sent by hand: asked at once"); assert.equal(api.SHARE.err.b1, undefined);
  orders.forEach((o) => { o.stage = "shipped"; });
  api.calls.length = 0;
  api.setServer(async () => no(503, "later"));
  r = await api.reportSharedOrders();
  assert.equal(r.sent, 0); assert.equal(posts().length, 1, "a 5xx stops the run: the next buyer waits");
  assert.equal(orders[0].shareTold.steps.shipped, undefined, "not marked: it goes again");
  api.setServer(async () => { throw new Error("offline"); });
  r = await api.reportSharedOrders();
  assert.equal(r.failed[0][1], "Couldn't reach the license server.");
  api.setServer(async () => ok());
  r = await api.reportSharedOrders();
  assert.equal(r.sent, 2);
});
await test("only the seller's own FAFO sends; one that stopped being it (403) stops and checks again", async () => {
  reset([order({ shareTo: { id: "b1", name: "@sam", by: "hand" } })]);
  api.setOwner(false);
  assert.equal((await api.reportSharedOrders()).sent, 0);
  assert.equal(api.calls.length, 0);
  api.setOwner(true);
  api.setServer(async () => no(403, "not the alert sender"));
  const r = await api.reportSharedOrders();
  assert.match(r.failed[0][1], /Only your own FAFO/);
  assert.ok(api.calls.includes("premium"));
});
await test("it waits for a copy that has caught up with the online one, for a window, and for the order alerts; by hand it goes at once", async () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([o], { on: true, caught: false }); api.setServer(async () => ok());
  await api.reportSharedOrders();
  assert.equal(posts().length, 0); assert.deepEqual(api.W.soon, [0], "a sync round first"); assert.equal(api.SHARE.want, true);
  api.W.caught = true; api.sharedOrdersSynced();
  await new Promise((r) => setTimeout(r, 0)); await api.reportSharedOrders();
  assert.ok(o.shareTold, "sent once the round caught up");
  for (const [why, w, alerting] of [["a window open or email syncing", { blocked: true }, false], ["the order alerts going", {}, true]]) {
    const q = order({ orderNo: "W" + why.length, shareTo: { id: "b1", name: "@sam", by: "hand" } });
    reset([q], w); api.OALERT.busy = alerting;
    await api.reportSharedOrders();
    assert.equal(posts().length, 0, why);
    await api.reportSharedOrders(new Set([q.id]));
    assert.equal(posts().length, 1, "by hand");
  }
});
await test("an order locked away meanwhile isn't marked; two runs at once go one after the other", async () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([o]);
  api.setServer(async () => { api.setS(null); return ok(); });
  await api.reportSharedOrders();
  assert.equal(o.shareTold, undefined);
  const p = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([p]);
  let open = 0, most = 0;
  api.setServer(async () => { open++; most = Math.max(most, open); await new Promise((r) => setTimeout(r, 5)); open--; return ok(); });
  await Promise.all([api.reportSharedOrders(), api.reportSharedOrders(), api.reportSharedOrders(new Set([p.id]))]);
  assert.equal(most, 1); assert.equal(posts().length, 1, "the later runs found it sent");
});

console.log("\nOn the buyer's FAFO");
const alert = (o) => ({ id: "a" + Math.random(), oid: "oid0000000000000001", store: "target", storeName: "Target", profile: "", orderNo: "102000000000001", item: "Ditto Premium Collection",
  qty: "2", total: "$119.98", stage: "placed", at: "2026-11-02", createdAt: T0, shipTo: "Sam Buyer", shipAddr: "1 Main St, Apt 2, Austin, TX 78701",
  tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }], ...o });
const buyer = () => ({ orders: [], settings: {}, deletedOrders: {} });
await test("an order the seller sent comes with its ship-to, tracking and when each step happened, the same on every device", () => {
  const a = buyer(), b = buyer(), d = { placed: "2026-11-02", shipped: "2026-11-03T10:00:00.000Z" };
  const list = [alert({ dates: d }), alert({ stage: "shipped", createdAt: T0 + 60000, id: "x2", dates: d })];
  api.setS(a); const news = api.applySellerAlerts(list);
  api.setS(b); api.applySellerAlerts(list.slice().reverse());
  assert.equal(news.length, 2);
  const o = a.orders[0];
  assert.deepEqual([o.id, o.fromSeller, o.stage, o.shipTo, o.shipAddr, o.tracking, o.dates.shipped, o.statusAt],
    ["sa-oid0000000000000001", true, "shipped", "Sam Buyer", "1 Main St, Apt 2, Austin, TX 78701", [{ number: "1ZWY0000000000001", carrier: "ups" }], "2026-11-03T10:00:00.000Z", "2026-11-03"]);
  assert.equal(JSON.stringify(a.orders), JSON.stringify(b.orders));
});
await test("an update brings what the seller changed, never over what the buyer changed", () => {
  const s = buyer(); api.setS(s);
  api.applySellerAlerts([alert()]);
  const o = s.orders[0], at = o.updatedAt;
  let news = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 1000, shipAddr: "1 Main Street, Apt 2, Austin, TX 78701", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }, { number: "TBA123456789012", carrier: "amazon" }] })]);
  assert.equal(news.length, 0, "no notification for it"); assert.equal(news.changed, true);
  assert.equal(o.shipAddr, "1 Main Street, Apt 2, Austin, TX 78701"); assert.equal(o.tracking.length, 2); assert.equal(o.updatedAt, at, "details don't move the order");
  o.shipTo = "Sam B. (typed)";
  o.tracking.push({ number: "MANUAL1234", carrier: "other" });
  o.tracking = o.tracking.filter((t) => t.number !== "1ZWY0000000000001");   // the buyer took one off
  news = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 2000, shipTo: "Somebody Else", tracking: [{ number: "1ZWY0000000000001", carrier: "ups" }, { number: "TBA123456789012", carrier: "amazon" }, { number: "9400100000000000000009", carrier: "usps" }] })]);
  assert.equal(o.shipTo, "Sam B. (typed)", "the buyer's own name");
  assert.deepEqual(o.tracking.map((t) => t.number), ["TBA123456789012", "9400100000000000000009", "MANUAL1234"], "a new one added, the one the buyer took off stays off, the buyer's own last");
  news = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 3000, shipTo: "Somebody Else", tracking: [{ number: "9400100000000000000009", carrier: "usps" }] })]);
  assert.deepEqual(o.tracking.map((t) => t.number), ["9400100000000000000009", "MANUAL1234"], "one the seller took off goes");
  assert.equal(api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 4000, shipTo: "Somebody Else", tracking: [{ number: "9400100000000000000009", carrier: "usps" }] })]).changed, undefined, "the same again: nothing");
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 5000, shipTo: "Somebody Else", tracking: [{ number: "9400100000000000000009", carrier: "fedex" }] })]);
  assert.equal(o.tracking[0].carrier, "fedex", "a carrier the seller corrected");
  o.tracking[0] = { number: "9400100000000000000009", carrier: "usps" };   // the buyer put it back
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 6000, shipTo: "Somebody Else", tracking: [{ number: "9400100000000000000009", carrier: "fedex" }, { number: "MANUAL1234", carrier: "other" }] })]);
  assert.equal(o.tracking[0].carrier, "usps", "not over the buyer's");
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 7000, shipTo: "Somebody Else", tracking: [{ number: "9400100000000000000009", carrier: "fedex" }] })]);
  assert.ok(o.tracking.some((t) => t.number === "MANUAL1234"), "the buyer had it first: the seller taking it off leaves it");
  const t = buyer(); api.setS(t);
  api.applySellerAlerts([alert()]);
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 1000, shipTo: "", shipAddr: "" })]);
  assert.deepEqual([t.orders[0].shipTo, t.orders[0].shipAddr], ["", ""], "cleared by the seller while it was still theirs");
});
await test("a later alert with the slot's profile fills it in; an update for an order this FAFO doesn't have, or deleted, adds nothing; an alert without details is as before", () => {
  const p = buyer(); api.setS(p);
  api.applySellerAlerts([alert()]);
  const ch = api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 9, profile: "Target #4" })]);
  assert.deepEqual([p.orders[0].profile, ch.changed], ["Target #4", true]);
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 10, profile: "Other" })]);
  assert.equal(p.orders[0].profile, "Target #4", "never over one it has");
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
await test("it reads the seller's updates from where it last read them, which a page before 1.9.138 moves sellerSince past", async () => {
  const B = api.SELLER_DET_FROM, s = buyer(); s.settings.sellerSince = B + 5 * DAY; api.setS(s); api.calls.length = 0;
  const upd = alert({ stage: "update", createdAt: B + 2 * DAY, shipTo: "New Name" });
  api.setServer(async (path) => ok({ alerts: path === "/alerts?since=" + (B - 120000) ? [alert({ createdAt: B + DAY }), upd] : [] }));
  await api.pollSellerAlerts();
  assert.equal(api.calls[0][0], "/alerts?since=" + (B - 120000), "from the day it began, the first time");
  assert.equal(s.orders[0].shipTo, "New Name");
  assert.deepEqual([s.settings.sellerSince, s.settings.sellerDetSince], [B + 5 * DAY, B + 2 * DAY]);
  api.calls.length = 0; api.setServer(async () => ok({ alerts: [] }));
  await api.pollSellerAlerts();
  assert.equal(api.calls[0][0], "/alerts?since=" + (B + 2 * DAY - 120000), "then from there");
  s.settings.sellerDetSince = B + 9 * DAY; api.calls.length = 0;
  await api.pollSellerAlerts();
  assert.equal(api.calls[0][0], "/alerts?since=" + (B + 5 * DAY - 120000), "and from sellerSince when that's older");
  const n = buyer(); n.settings.sellerSince = B - 3 * DAY; api.setS(n); api.calls.length = 0;
  await api.pollSellerAlerts();
  assert.equal(api.calls[0][0], "/alerts?since=" + (B - 3 * DAY - 120000), "a buyer whose newest is older than that day: from it");
  assert.equal(n.settings.sellerDetSince, B - 3 * DAY);
});

// The page wires it in: the bar's button, the timer, the email sync, the sync round, lock, Settings, and the sync merge of remembered addresses.
await test("the page runs it, shows it to the seller's own FAFO only, and merges remembered addresses per entry", () => {
  assert.match(html, /canShare\(\) \? `<button class="btn btn-sm" data-act="orders-send">/);
  assert.match(html, /case "orders-send": openSendToBuyer\(new Set\(UI\.orderSel\)\)/);
  assert.match(fn("function startApp(){"), /scheduleSharedOrders\(\)/);
  assert.match(html, /reportOrderAlerts\(\)\.finally\(\(\) => shareSoon\(3000\)\);/);
  assert.match(fn("async function syncExclusive(fn){"), /sharedOrdersSynced\(\)/);
  assert.match(html, /SHARE\.buyers = null; SHARE\.buyersAt = 0; SHARE\.err = \{\};/);
  assert.match(html, /k === SYNC_CODE\.settings \+ ":buyerAddrs"\)\) bv = \{\};/);
  assert.match(html, /<section id="s-sentbuyers" class="set-sec">\$\{sentBuyersSectionHTML\(\)\}<\/section>/);
});

console.log(`${passed} passed`);
