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
  block("const SHARE = {busy", "// Send to buyer, on the Orders selection bar"), fn("function dropBuyerAddrs(m, gone){"),
  line(/^const SELLER_DET_FROM = .*$/m), fn("async function pollSellerAlerts(){"), fn("function applySellerAlerts(list, seenBefore){"),
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
  const alertApi = (path, opts) => { calls.push([path, opts && opts.body ? JSON.parse(opts.body) : null]); if (opts && opts.signal) calls.push("signal"); return SERVER(path, opts && opts.body ? JSON.parse(opts.body) : null); };`;
const api = new Function(prelude + code + `
  return {setS:(s) => { S = s; }, getS:() => S, setOwner:(v) => { OWNER = v; }, setServer:(f) => { SERVER = f; }, calls, SHARE, W, OALERT, SELLER_DET_FROM,
    shareAddrKey, shareTargetOf, sharePlan, shareMark, sellerDetailsApply, sellerSentPass, dropBuyerAddrs, reportSharedOrders, sharedOrdersSynced, applySellerAlerts, pollSellerAlerts, jigChoices, pkcForms, shareDetOf};`)();

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
    { line1: "500 W 21st St", line2: "Unit 12", city: "Fort Worth", zip: "76102" }, { line1: "77 Meadow Ln", line2: "", city: "Mount Vernon", zip: "10550" },
    { line1: "120 Oak Falls", line2: "Apt 3", city: "Austin", zip: "78701" }, { line1: "100 State St", line2: "", city: "Austin", zip: "78701" }, { line1: "100 County Road 12", line2: "", city: "Austin", zip: "78701" },
    { line1: "5000 Nolensville Pike", line2: "Ste 4", city: "Nashville", zip: "37211" }, { line1: "100 Business Loop 70", line2: "", city: "Columbia", zip: "65203" }]) {
    const vs = api.jigChoices(a, ["line1", "line2", "city", "zip"]).order;
    assert.ok(vs.length > 5, `Jig writes ${oneLine(a)} many ways: ${vs.length}`);
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
  for (const none of ["", "Austin, TX", "1 Main St", "somewhere 78701", "One Main St, 2nd Floor, Austin, TX 78701", "4B, Austin, TX 78701", "RR 2, Ozark, AR 72949",
    "2 Floor, 100 Broadway, New York, NY 10006"]) assert.equal(api.shareAddrKey(none), "", none);
  // A company, unit or c/o line before the street isn't taken for it.
  assert.equal(api.shareAddrKey("7 Seas Logistics, 1 Reship Way, Wilmington, DE 19720"), api.shareAddrKey("1 Reship Way, Wilmington, DE 19720"));
  assert.notEqual(api.shareAddrKey("7 Seas Logistics, 1 Reship Way, Wilmington, DE 19720"), api.shareAddrKey("7 Seas Logistics, 700 Commerce Dr, Wilmington, DE 19720"));
  assert.equal(api.shareAddrKey("2 Floor, 100 Main St, Austin, TX 78701"), k.replace("1 MAIN", "100 MAIN"));
  assert.equal(api.shareAddrKey("100 Broadway, Apt 4, New York, NY 10006"), api.shareAddrKey("100 Broadway, New York, NY 10006"), "a street with no type, when it's the only line with a number");
  // A rural route's box on a line of its own is the address.
  assert.notEqual(api.shareAddrKey("RR 2, Box 15, Ozark, AR 72949"), api.shareAddrKey("RR 2, Box 99, Ozark, AR 72949"));
  assert.equal(api.shareAddrKey("RR 2, Box 15, Ozark, AR 72949"), api.shareAddrKey("RR 2 Box 15, Ozark, AR 72949"));
});
await test("a numbered road's own number is never taken for a unit, nor a word for one", () => {
  const key = (x) => api.shareAddrKey(x + ", Austin, TX 78701");
  for (const [a, b] of [["100 Route 66", "100 Route 9"], ["100 County Road 12", "100 County Road 13"], ["100 County Rd 12", "100 County Road 13"], ["100 State Road 84", "100 State Road 85"],
    ["100 N Loop 12", "100 N Loop 13"], ["100 State Route 9", "100 State Route 10"], ["100 Private Road 5", "100 Private Road 6"], ["100 Township Road 5", "100 Township Road 6"],
    ["100 Highway 50", "100 Highway 51"], ["100 Forest Service Road 5", "100 Forest Service Road 6"], ["100 Farm to Market Road 1960", "100 Farm to Market Road 1961"],
    ["100 Old Lot Rd", "100 Old Office Park"], ["100 Broadway 473", "100 Broadway"], ["100 Park Road 4", "100 Park Road 5"],
    ["100 Cty Rd 12", "100 Cty Rd 13"], ["100 Cnty Road 12", "100 Cnty Road 13"], ["100 Prvt Rd 5", "100 Prvt Rd 6"], ["100 Recreation Rd 12", "100 Recreation Rd 13"],
    ["100 National Forest Rd 12", "100 National Forest Rd 13"], ["100 N Ranch Rd 620", "100 N Ranch Rd 2222"], ["100 N Forest Rd 12", "100 N Forest Rd 13"],
    ["100 Ranch-to-Market Road 12", "100 Ranch-to-Market Road 13"], ["100 Farm-to-Market Road 12", "100 Farm-to-Market Road 13"], ["100 FS Rd 42", "100 FS Rd 11"],
    ["21000 Pacific Coast Hwy 1", "21000 Pacific Coast Hwy 2"], ["100 Business Loop 70", "100 Business Loop 44"], ["100 Historic Route 66", "100 Historic Route 9"],
    ["120 Oak Fls", "120 Oak Fld"], ["120 Oak Fls", "120 Oak Flt"], ["120 Oak Fls", "120 Oak"], ["1234 Lee Road 379", "1234 Lee Road 430"], ["1234 Lee Rd 379 Apt 2", "1234 Lee Road 298"],
    ["100 Lake Rd 54-56", "100 Lake Rd 54-80"], ["12000 N RM 620", "12000 N RM 2222"], ["100 Old RM 12", "100 Old RM 13"], ["12000 N RM 620", "12000 N Lot 5"]])
    assert.notEqual(key(a), key(b), `${a} / ${b}`);
  assert.equal(key("120 Oak Fls"), key("120 Oak Falls"), "Fls is a street type, not a floor");
  assert.equal(key("100 Route 66 707"), key("100 Route 66"));
  assert.equal(key("1 Main St B"), key("1 Main St Apt B"), "a letter unit written bare");
  assert.equal(key("100 Main St Bl.dg 3"), key("100 Main St"), "Jig for Target's dot inside a unit's word");
  assert.equal(key("100 Main St Lot 5"), key("100 Main St"));
  assert.notEqual(key("100 Broadway Apt 4"), key("100 Broadway 5"), "a street with no type keeps a unit on line 1: those wait");
  // Puerto Rico: the urbanization is part of the address.
  const pr = (x) => api.shareAddrKey(x);
  assert.notEqual(pr("Urb Las Gladiolas, 150 Calle A, San Juan, PR 00926"), pr("Urb Sevilla, 150 Calle A, San Juan, PR 00926"));
  assert.equal(pr("Urb Las Gladiolas, 150 Calle A, San Juan, PR 00926"), pr("150 Calle A, Urb. Las Gladiolas, San Juan, PR 00926-3232"));
  assert.equal(pr("150 Calle A, San Juan, PR 00926"), "", "no urbanization: it waits");
  assert.equal(key("100 County Road 12 595"), key("100 County Road 12"), "Jig for Pokémon Center's bare number after a road's own");
  assert.equal(key("100 County Rd 12"), key("100 County Road 12"));
  assert.equal(key("200 18th Ave NW 45"), key("200 18th Ave NW"));
  assert.equal(key("100 Court St"), key("100 Court Street"), "a type that's the street's name");
  assert.notEqual(key("100 Court St"), key("100 St"));
});
await test("every way Jig for Pokémon Center writes a building on a street has its key; on a road, its bare number keeps one of its own", () => {
  const forms = (b) => { const f = api.pkcForms(b); return f.map((x) => x()).concat(f.more ? Array.from({ length: 10 }, () => f.more()()) : []); };
  const keyOf = (v) => api.shareAddrKey(oneLine({ ...v, city: "Austin", zip: "78701" }));
  for (const b of [{ line1: "1801 N Orchard Dr", line2: "" }, { line1: "1801 N Orchard Dr", line2: "Apt 4" }, { line1: "500 W 21st St Apt 12", line2: "" }, { line1: "77 Meadow Ln", line2: "# 3" },
    { line1: "200 18th Ave NW", line2: "" }, { line1: "100 State St", line2: "" }, { line1: "100 Park Ave", line2: "" }, { line1: "100 N Park Ave", line2: "" },
    { line1: "100 Market St", line2: "Apt 4" }, { line1: "100 Forest Dr", line2: "" }, { line1: "1 Main St", line2: "Apt B" }, { line1: "120 Oak Fls", line2: "" }]) {
    const want = keyOf(b);
    assert.ok(want, b.line1);
    for (let round = 0; round < 20; round++) for (const v of forms(b)) assert.equal(keyOf(v), want, `${b.line1} ${b.line2} → ${v.line1} | ${v.line2}`);
  }
  for (const b of [{ line1: "100 County Road 12", line2: "" }, { line1: "100 Maple Loop", line2: "" }, { line1: "5000 Nolensville Pike", line2: "" }, { line1: "100 Route 66", line2: "" },
    { line1: "100 Old Mill Rd", line2: "Apt 4" }]) {
    const want = keyOf(b), street = want.split("|")[0];
    for (let round = 0; round < 20; round++) for (const v of forms(b)) {
      const k = keyOf(v);
      assert.ok(k === want || (k.startsWith(street + " ") && /^\d+$/.test(k.split("|")[0].slice(street.length + 1))), `${b.line1} → ${v.line1} | ${v.line2}: ${k}`);
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
  api.shareMark(o, api.sharePlan([o], {}).get("b1")[0], T0, ["updated"]);
  o.shipAddr = "1 Main Street, Apt 2, Austin, TX 78701";
  assert.deepEqual(api.sharePlan([o], {}).get("b1")[0].steps, ["delivered"], "the address changed");
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
  const h = order({ orderNo: "79" }), hit = api.sharePlan([h], addrs()).get("b1")[0];
  h.shareTo = { id: "b2", name: "@kim", by: "hand" };   // picked by hand while that send was out
  api.shareMark(h, hit, T0, ["other"]);
  assert.deepEqual(h.shareTo, { id: "b2", name: "@kim", by: "hand" }, "a buyer picked by hand stays");
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
  api.calls.length = 0;
  r = await api.reportSharedOrders();
  assert.equal(r.failed[0][1], "Couldn't reach the license server.");
  assert.equal(posts().length, 1, "no connection: the next buyer isn't tried");
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
await test("with nothing to send no sync round is started, and the wait's timer goes once the round caught up", async () => {
  reset([order({ shareTo: { off: true } })], { on: true, caught: false });
  await api.reportSharedOrders();
  assert.deepEqual([api.W.soon, api.SHARE.want], [[], false], "nothing to send: no round");
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([o], { on: true, caught: false }); api.setServer(async () => ok());
  await api.reportSharedOrders();
  assert.ok(api.SHARE.soon, "waiting a minute at most");
  api.W.caught = true; api.sharedOrdersSynced();
  assert.equal(api.SHARE.soon, null, "not another round a minute on");
  await api.reportSharedOrders();
  assert.ok(o.shareTold);
});
await test("taking one of two buyers off an address keeps the orders waiting there waiting; a request gives up after a while", async () => {
  const two = Object.assign(addrs(), { [MAIN + "|b9"]: { key: MAIN, id: "b9", name: "@lee", addr: "1 Main St, Apt 30, Austin, TX 78701", at: T0 + DAY } });
  const y = order({ id: "y", orderNo: "Y1", shipTo: "Lee Neighbor", shipAddr: "1 Main St, Apt 30, Austin, TX 78701", createdAt: T0 + 2 * DAY, at: "2026-11-03" });
  assert.equal(api.shareTargetOf(y, two), null, "waiting between two buyers");
  const left = api.dropBuyerAddrs(two, [MAIN + "|b9"]);
  assert.deepEqual(left, { [MAIN]: "@sam" });
  assert.equal(api.shareTargetOf(y, two), null, "still waiting: the one left starts from now");
  assert.ok(two[MAIN + "|b1"].set && two[MAIN + "|b1"].at > T0 + 2 * DAY);
  reset([order({ shareTo: { id: "b1", name: "@sam", by: "hand" } })]); api.setServer(async () => ok());
  await api.reportSharedOrders();
  assert.ok(api.calls.includes("signal"), "the share request has a time limit");
  assert.match(html, /<input type="checkbox" id="sb-keep"\$\{otherAcct \? "" : " checked"\}>/, "an order on another buyer's account starts with the address unticked");
});
await test("sent by hand: orders already on that buyer's page with nothing new count as done", async () => {
  const a = order({ id: "d1", orderNo: "D1", shareTo: { id: "b1", name: "@sam", by: "hand" } }), b = order({ id: "d2", orderNo: "D2", shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([a, b]); api.setServer(async () => ok());
  await api.reportSharedOrders(new Set(["d1"]));
  api.calls.length = 0;
  const r = await api.reportSharedOrders(new Set(["d1", "d2"]));
  assert.deepEqual([posts().length, r.byBuyer.b1.sent, r.byBuyer.b1.done], [1, 1, 1]);
  assert.match(html, /const there = mine\.sent \+ mine\.done;/, "Send's toast counts them as there");
  assert.match(html, /at:had && \+had\.at && !others\.length \? Math\.min\(\+had\.at, now\) : now/, "remembering again keeps its start only when no other buyer had the address");
});
await test("an order locked away meanwhile isn't marked; two runs at once go one after the other", async () => {
  const o = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([o]);
  api.setServer(async () => { api.setS(null); return ok(); });
  await api.reportSharedOrders();
  assert.equal(o.shareTold, undefined);
  const q = order({ shareTo: { id: "b1", name: "@sam", by: "hand" } });
  reset([q]);
  api.setServer(async () => ({ ok: true, status: 200, json: async () => { api.setS(null); return { ok: true }; } }));   // locked while the answer was read
  await api.reportSharedOrders();
  assert.equal(q.shareTold, undefined);
  api.setS({ orders: [], settings: {} }); api.setServer(async () => { throw new Error("boom"); });
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
  o.tracking = o.tracking.filter((t) => t.number !== "1ZWY0000000000001"); o.trkOff = ["1ZWY0000000000001"];   // the buyer took one off in the order editor
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
await test("a number or ship-to a sync merge dropped comes back right after the merge; one the buyer took off stays off until the seller sends it again", () => {
  const s = buyer(); api.setS(s);
  const two = [{ number: "1ZWY0000000000001", carrier: "ups" }, { number: "TBA123456789012", carrier: "amazon" }];
  api.applySellerAlerts([alert({ tracking: two })]);
  const o = s.orders[0];
  o.tracking = [];   // a merge with an edit saved on another device before the numbers came
  assert.equal(api.sellerSentPass(), 1);
  assert.deepEqual(o.tracking.map((t) => t.number), ["1ZWY0000000000001", "TBA123456789012"], "back after the merge, with no row needed");
  assert.equal(api.sellerSentPass(), 0, "and once only");
  const { sellerSent, ...copy } = o; s.orders[0] = Object.assign(copy, { shipTo: "", tracking: [] });   // a whole-unit merge took a page before 1.9.138's copy
  api.applySellerAlerts([alert({ stage: "shipped", createdAt: T0 + 1000, tracking: two })]);
  assert.deepEqual([s.orders[0].tracking.length, s.orders[0].shipTo], [2, "Sam Buyer"], "the next row fills it in");
  const p = s.orders[0];
  p.shipTo = "";   // the buyer cleared it
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 1500, tracking: two })]); api.sellerSentPass();
  assert.equal(p.shipTo, "", "one the buyer cleared stays clear");
  p.tracking = [two[1]]; p.trkOff = ["1ZWY0000000000001"];
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 2000, tracking: two })]);
  assert.deepEqual(p.tracking.map((t) => t.number), ["TBA123456789012"], "taken off by the buyer: stays off");
  p.tracking = two.slice();   // a merge took the other device's tracking, with it still on
  api.sellerSentPass();
  assert.deepEqual(p.tracking.map((t) => t.number), ["TBA123456789012"], "taken off again: the buyer's choice wins over a merge");
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 3000, tracking: [two[1]] })]);
  assert.deepEqual(p.trkOff, ["1ZWY0000000000001"], "the seller dropped it: still kept off");
  api.applySellerAlerts([alert({ stage: "update", createdAt: T0 + 4000, tracking: two })]);
  assert.deepEqual([p.tracking.map((t) => t.number), p.trkOff], [["1ZWY0000000000001", "TBA123456789012"], undefined], "sent again later: it goes on");
  assert.match(html, /if \(!untouched && existing && \(existing\.fromSeller \|\| existing\.sellerSent\)\)\{\s*const kept = new Set\(d\.tracking\.map\(x => x\.number\)\)/, "the order editor notes the numbers taken off");
  assert.match(html, /if \(!untouched\) d\.tracking = /, "and leaves tracking it didn't change alone");
  assert.match(fn("function oneStoreRun(why){"), /sellerSentPass\(\)/, "the pass runs after every merge and at unlock");
});
await test("rows read before (asked again from sellerDetSince) bring details and dates only: nothing is added, moved or notified again", () => {
  const s = buyer(); api.setS(s);
  api.applySellerAlerts([alert()]);
  const o = s.orders[0];
  o.stage = "placed";   // the store reinstated it after a cancel, and the buyer set it back
  const old = [alert({ stage: "canceled", createdAt: T0 + 500, shipTo: "Sam B Buyer" }), alert({ oid: "oid0000000000000009", orderNo: "999", createdAt: T0 + 600 })];
  const news = api.applySellerAlerts(old, T0 + 1000);
  assert.deepEqual([news.length, o.stage, s.orders.length, o.shipTo], [0, "placed", 1, "Sam B Buyer"]);
  const d = buyer(); api.setS(d);
  api.applySellerAlerts([alert(), alert({ stage: "delivered", createdAt: T0 + 9 * DAY })]);   // a page before 1.9.138 dated it when the alert came
  assert.equal(d.orders[0].statusAt, new Date(T0 + 9 * DAY).toISOString().slice(0, 10));
  const fix = api.applySellerAlerts([alert({ stage: "delivered", createdAt: T0 + 9 * DAY, dates: { delivered: "2026-11-02" } })], T0 + 10 * DAY);
  assert.deepEqual([d.orders[0].dates.delivered, d.orders[0].statusAt, fix.length, fix.changed], ["2026-11-02", "2026-11-02", 0, true], "the worker's date, kept as first sent");
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
  api.applySellerAlerts([alert({ createdAt: B + DAY })]);   // what a page before 1.9.138 added (and synced) from these rows
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
