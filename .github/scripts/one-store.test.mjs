// Tests the one-store-per-profile pass in the newest page (index-X.Y.Z.html, 1.9.96+): the code between ONE-STORE-START
// and ONE-STORE-END, which splits a profile on several stores into one per store and unshares addresses.
//   node .github/scripts/one-store.test.mjs [path/to/index-X.Y.Z.html]
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const html = readFileSync(file, "utf8");
const block = (a, b) => { const s = html.indexOf(a), e = html.indexOf(b); return s < 0 || e < 0 ? null : html.slice(s, e); };
const pass = block("/* ONE-STORE-START", "/* ONE-STORE-END */");
if (!pass) { console.log(`${file} has no one-store pass to test.`); process.exit(0); }
const core = block("/* SYNC-CORE-START", "/* SYNC-CORE-END */");
const pick = (re, what) => { const m = re.exec(html); assert.ok(m, `couldn't find ${what} in the page`); return m[0]; };
const helpers = ["^const norm = .*$", "^const storeKeyOf = .*$", "^const STORE_MODE = .*$", "^const defaultMode = .*$", "^const emailOk = .*$",
  "^const modeOf = .*$", "^const profileStores = .*$", "^function orderKey\\(o\\)\\{.*\\}$"].map((r) => pick(new RegExp(r, "m"), r)).join("\n");
const api = new Function(core + "\n" + helpers + "\n" + pass + "\nreturn {oneStorePass, syncUnits, syncHashes, syncMerge, orderKey};")();
const { oneStorePass, syncUnits, syncHashes, syncMerge, orderKey } = api;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const blank = () => ({ v: 1, settings: {}, groups: [], cardGroups: [], addresses: [], cards: [], profiles: [], logins: [], inboxes: [], checkouts: [], orders: [],
  shareOld: [], deletedOrders: {}, caps: {}, slots: [], subs: {}, lastBatch: [], pulls: [], submitTo: null, submitName: "" });
const addr = (id, line1) => ({ id, first: "Ann", last: "Lee", line1, line2: "", city: "Austin", state: "TX", zip: "78701", country: "US" });
const tgt = (o) => Object.assign({ store: "target", storeName: "", mode: "login", loginId: null, email: "", verified: false }, o);
const pkc = (o) => Object.assign({ store: "pokemoncenter", storeName: "", mode: "email", loginId: null, email: "", verified: false }, o);
// A vault from before 1.9.96: Ann on Target and Pokémon Center, sharing her address with Bo.
const legacy = () => {
  const s = blank();
  s.addresses.push(addr("a1", "1 Main St"), addr("a2", "2 Oak St"));
  s.logins.push({ id: "l1", store: "target", storeName: "", email: "ann.t@example.com", password: "x" });
  s.cards.push({ id: "c1", number: "4242424242424242" });
  s.profiles.push(
    { id: "p1", name: "Ann", email: "ann.t@example.com", phone: "5550100", shipId: "a1", billSame: true, billId: null, cardId: "c1", groupId: "g1", createdAt: 1, updatedAt: 2,
      stores: [pkc({ email: "ann.pc@example.com" }), tgt({ loginId: "l1" })] },
    { id: "p2", name: "Bo", email: "bo@example.com", shipId: "a1", billSame: false, billId: "a2", cardId: "c1", stores: [tgt()] });
  s.slots = ["p1@target", "p1@pokemoncenter", "p2@target"];
  s.subs = { "p1@pokemoncenter": { at: 5, batch: "B1", okAt: 6 }, "p1@target": { at: 5, batch: "B1", declinedAt: 7 } };
  s.lastBatch = ["p1@pokemoncenter", "p1@target"];
  s.pulls = [{ id: "u1", key: "p1@pokemoncenter", store: "Pokémon Center" }];
  s.checkouts = [{ id: "k1", profileId: "p1", store: "pokemoncenter", storeName: "" }, { id: "k2", profileId: "p1", store: "target", storeName: "" }];
  return s;
};

console.log(`One store per profile in ${file.split(/[\\/]/).pop()}`);

test("a profile on Target and Pokémon Center becomes two with the same name, Target keeping the id", () => {
  const s = legacy(), r = oneStorePass(s);
  assert.equal(r.changed, true); assert.equal(r.split, 1);
  assert.deepEqual(s.profiles.map((p) => [p.id, p.name, p.stores.map((e) => e.store)]), [["p1", "Ann", ["target"]], ["p1.pokemoncenter", "Ann", ["pokemoncenter"]], ["p2", "Bo", ["target"]]]);
  const [t, c] = s.profiles;
  assert.equal(c.cardId, "c1"); assert.equal(c.groupId, "g1"); assert.equal(c.createdAt, 1); assert.equal(c.phone, "5550100");
  assert.equal(t.email, "ann.t@example.com", "Target: its login's email"); assert.equal(c.email, "ann.pc@example.com", "Pokémon Center: its checkout email");
});

test("each store's slots, submitted marks, last batch, pulls and checkouts go with it", () => {
  const s = legacy(); oneStorePass(s);
  assert.deepEqual(s.slots, ["p1@target", "p1.pokemoncenter@pokemoncenter", "p2@target"]);
  assert.deepEqual(s.subs, { "p1.pokemoncenter@pokemoncenter": { at: 5, batch: "B1", okAt: 6 }, "p1@target": { at: 5, batch: "B1", declinedAt: 7 } });
  assert.deepEqual(s.lastBatch, ["p1.pokemoncenter@pokemoncenter", "p1@target"]);
  assert.equal(s.pulls[0].key, "p1.pokemoncenter@pokemoncenter");
  assert.deepEqual(s.checkouts.map((c) => [c.id, c.profileId]), [["k1", "p1.pokemoncenter"], ["k2", "p1"]]);
});

test("no address is shared: the copy and Bo get their own, with the same lines; a profile's own shipping and billing may be one", () => {
  const s = legacy(), r = oneStorePass(s);
  const [t, c, b] = s.profiles;
  assert.equal(t.shipId, "a1", "the lowest id keeps it");
  assert.notEqual(c.shipId, "a1"); assert.notEqual(b.shipId, "a1"); assert.notEqual(c.shipId, b.shipId);
  assert.equal(b.billId, "a2", "Bo's own billing address stays");
  for (const id of [c.shipId, b.shipId]) { const a = s.addresses.find((x) => x.id === id); assert.equal(a.line1, "1 Main St"); }
  assert.equal(r.addrs, 2);
  const users = {}; s.profiles.forEach((p) => new Set([p.shipId, p.billSame ? null : p.billId].filter(Boolean)).forEach((a) => { users[a] = (users[a] || 0) + 1; }));
  assert.ok(Object.values(users).every((n) => n === 1), JSON.stringify(users));
});

test("running it again changes nothing, and the same vault gives the same result anywhere", () => {
  const a = legacy(), b = legacy();
  oneStorePass(a); oneStorePass(b);
  assert.deepEqual(a, b);
  const again = clone(a), r = oneStorePass(again);
  assert.equal(r.changed, false); assert.deepEqual(again, a);
});

test("two devices that each split the same vault merge with nothing to settle", () => {
  const base = legacy(), one = clone(base), two = clone(base);
  oneStorePass(one); oneStorePass(two);
  const m = syncMerge(syncUnits(one), syncUnits(two), syncHashes(syncUnits(base)), {}, {}, orderKey, {});
  assert.deepEqual(m.state.profiles, one.profiles); assert.deepEqual(m.state.addresses, one.addresses);
});

test("Pokémon Center put back on the Target profile (an older device): it returns to its own profile, slot and all", () => {
  const s = legacy(); oneStorePass(s);
  const t = s.profiles[0];
  s.slots = s.slots.filter((k) => k !== "p1.pokemoncenter@pokemoncenter"); delete s.subs["p1.pokemoncenter@pokemoncenter"];
  t.stores.push(pkc({ email: "other@example.com" }));   // the web version adds the store again
  t.shipId = s.profiles[1].shipId;                        // and links the copy's address
  s.slots.push("p1@pokemoncenter");
  const r = oneStorePass(s);
  assert.equal(r.merged, 1); assert.equal(r.split, 1);
  assert.deepEqual(s.profiles.map((p) => [p.id, p.stores.map((e) => e.store)]), [["p1", ["target"]], ["p1.pokemoncenter", ["pokemoncenter"]], ["p2", ["target"]]]);
  assert.equal(s.profiles[1].stores[0].email, "ann.pc@example.com", "its own checkout email stays");
  assert.ok(s.slots.includes("p1.pokemoncenter@pokemoncenter") && !s.slots.includes("p1@pokemoncenter"));
  assert.notEqual(s.profiles[0].shipId, s.profiles[1].shipId, "and the address is unshared again");
  assert.equal(oneStorePass(clone(s)).changed, false);
});

test("both with that slot switched on: two slots need two profiles, so the store gets a copy of its own", () => {
  const s = legacy(); oneStorePass(s);
  s.profiles[0].stores.push(pkc({ email: "ann.pc@example.com" }));
  s.slots.push("p1@pokemoncenter"); s.subs["p1@pokemoncenter"] = { at: 9, batch: "B9" };
  const r = oneStorePass(s);
  assert.equal(r.merged, 0);
  assert.deepEqual(s.profiles.map((p) => [p.id, p.name, p.stores.map((e) => e.store)]).slice(0, 3), [["p1", "Ann", ["target"]], ["p1.pokemoncenter.2", "Ann", ["pokemoncenter"]], ["p1.pokemoncenter", "Ann", ["pokemoncenter"]]]);
  assert.equal(s.subs["p1.pokemoncenter.2@pokemoncenter"].batch, "B9", "its own submission stays its own");
  assert.equal(s.subs["p1.pokemoncenter@pokemoncenter"].batch, "B1");
});

test("a store put back on someone whose copy was renamed goes to a new copy, not to the renamed one", () => {
  const s = legacy(); oneStorePass(s);
  s.profiles[1].name = "Zed";                              // "Only this one"
  s.profiles[0].stores.push(pkc({ email: "ann.web@example.com" }));
  oneStorePass(s);
  const zed = s.profiles.find((p) => p.name === "Zed"), ann = s.profiles.filter((p) => p.name === "Ann");
  assert.equal(zed.stores[0].email, "ann.pc@example.com", "Zed's profile is as it was");
  assert.deepEqual(ann.map((p) => [p.id, p.stores[0].store, p.stores[0].email || ""]), [["p1", "target", ""], ["p1.pokemoncenter.2", "pokemoncenter", "ann.web@example.com"]]);
});

test("a pair that both got the other store (Mass edit on 1.9.95, or the web version) stays one profile per store", () => {
  for (const flip of [false, true]){
    const s = legacy(); oneStorePass(s);
    s.profiles[0].stores.push(pkc());
    s.profiles[1].stores.push(tgt({ loginId: "l1" }));
    if (flip) s.profiles.reverse();
    oneStorePass(s);
    const ann = s.profiles.filter((p) => p.name === "Ann").map((p) => [p.id, p.stores.map((e) => e.store)]).sort();
    assert.deepEqual(ann, [["p1", ["target"]], ["p1.pokemoncenter", ["pokemoncenter"]]], "list order " + (flip ? "reversed" : "as it was"));
  }
});

test("a profile with the same name made elsewhere (Duplicate, an import) counts as the same person's", () => {
  const s = legacy(); oneStorePass(s);
  s.profiles = s.profiles.filter((p) => p.id !== "p1.pokemoncenter");
  s.slots = s.slots.filter((k) => !k.startsWith("p1.pokemoncenter@")); delete s.subs["p1.pokemoncenter@pokemoncenter"];
  s.lastBatch = s.lastBatch.filter((k) => !k.startsWith("p1.pokemoncenter@"));
  s.profiles.push({ id: "dup1", name: "Ann", email: "ann.pc@example.com", shipId: "a9", billSame: true, stores: [pkc({ email: "ann.pc@example.com" })] });
  s.profiles[0].stores.push(pkc({ email: "ann.t@example.com" }));
  oneStorePass(s);
  assert.deepEqual(s.profiles.filter((p) => p.name === "Ann").map((p) => [p.id, p.stores[0].store]), [["p1", "target"], ["dup1", "pokemoncenter"]]);
});

test("an address copy left from before isn't reused while another profile uses it, and one nobody uses gets the address as it is now", () => {
  const s = legacy(); oneStorePass(s);
  const bo = s.profiles.find((p) => p.id === "p2"), cid = bo.shipId;
  s.addresses.find((a) => a.id === cid).line1 = "9 Elm St";   // Bo moved, on 1.9.96
  bo.shipId = "a1";                                          // then the web version linked him to Ann's again
  oneStorePass(s);
  assert.equal(bo.shipId, cid, "his old copy, nobody's now, is his again");
  assert.equal(s.addresses.find((a) => a.id === cid).line1, "1 Main St", "with the address he chose");
  const eve = { id: "p9", name: "Eve", stores: [tgt()], shipId: cid, billSame: true };
  s.profiles.push(eve); bo.shipId = "a1";                    // someone else uses that copy now
  oneStorePass(s);
  assert.notEqual(bo.shipId, cid); assert.notEqual(bo.shipId, "a1"); assert.equal(eve.shipId, cid);
  assert.equal(s.addresses.find((a) => a.id === bo.shipId).line1, "1 Main St");
  assert.equal(oneStorePass(clone(s)).changed, false);
});

test("Target added to the Pokémon Center copy goes back to the Target profile, which fills in a missing login only", () => {
  const s = legacy(); oneStorePass(s);
  s.profiles[0].stores[0].loginId = null;
  s.profiles[1].stores.push(tgt({ loginId: "l1" }));
  oneStorePass(s);
  assert.deepEqual(s.profiles.map((p) => [p.id, p.stores.map((e) => e.store)]), [["p1", ["target"]], ["p1.pokemoncenter", ["pokemoncenter"]], ["p2", ["target"]]]);
  assert.equal(s.profiles[0].stores[0].loginId, "l1");
});

test("three stores make three profiles; a taken id gets .2; a store twice collapses; no store stays as it is", () => {
  const s = blank();
  s.profiles.push({ id: "q", name: "Cy", stores: [tgt(), tgt(), pkc(), { store: "walmart", storeName: "", mode: "login" }] },
    { id: "q.walmart", name: "Other", stores: [] }, { id: "z", name: "None", stores: [] });
  oneStorePass(s);
  assert.deepEqual(s.profiles.map((p) => [p.id, p.stores.map((e) => e.store)]),
    [["q", ["target"]], ["q.pokemoncenter", ["pokemoncenter"]], ["q.walmart.2", ["walmart"]], ["q.walmart", []], ["z", []]]);
});

test("a typed store gets a hashed slug; Use Assigned Account stays on each copy", () => {
  const s = blank();
  s.profiles.push({ id: "r", name: "Di", email: "di@example.com", stores: [{ store: "other", storeName: "Topps Shop", mode: "login" }, pkc({ mode: "seller" })] });
  oneStorePass(s);
  assert.equal(s.profiles[0].stores[0].store, "pokemoncenter", "Pokémon Center ranks before a typed store");
  assert.equal(s.profiles[0].email, "", "Use Assigned Account has no email");
  assert.match(s.profiles[1].id, /^r\.o[0-9a-z]+$/);
  assert.equal(s.profiles[1].email, "di@example.com");
});

test("random vaults: one store per profile, no address shared, the same ids in any list order, and nothing left for a second run", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const STORES = [() => tgt({ loginId: rnd(2) ? "l1" : null }), () => pkc({ email: rnd(2) ? "x@example.com" : "" }), () => ({ store: "walmart", storeName: "", mode: "login" }), () => tgt({ mode: "seller" })];
  for (let round = 0; round < 300; round++){
    const s = blank();
    for (let i = 0; i < 6; i++) s.addresses.push(addr("a" + i, i + " Main St"));
    const n = 2 + rnd(7);
    for (let i = 0; i < n; i++){
      const id = rnd(4) ? "q" + rnd(5) : "q" + rnd(5) + "." + ["target", "pokemoncenter", "walmart"][rnd(3)] + (rnd(3) ? "" : ".2");
      if (s.profiles.some((p) => p.id === id)) continue;
      const stores = []; for (let j = rnd(4); j > 0; j--) stores.push(STORES[rnd(4)]());
      s.profiles.push({ id, name: ["Ann", "Bo", "Cy"][rnd(3)], email: "", shipId: "a" + rnd(6), billSame: !!rnd(2), billId: "a" + rnd(6), stores });
      if (stores.length && rnd(2)) s.slots.push(id + "@" + storeKeyOf(stores[rnd(stores.length)]));
    }
    s.subs = Object.fromEntries(s.slots.filter(() => rnd(2)).map((k) => [k, { at: 1, batch: "B" + rnd(3) }]));
    const back = clone(s); back.profiles.reverse();
    oneStorePass(s); oneStorePass(back);
    for (const p of s.profiles) assert.ok(p.stores.length <= 1, "one store: " + JSON.stringify(p));
    const users = {}; s.profiles.forEach((p) => new Set([p.shipId, p.billSame ? null : p.billId].filter(Boolean)).forEach((a) => { users[a] = (users[a] || 0) + 1; }));
    assert.ok(Object.values(users).every((x) => x === 1), "no address shared");
    const byId = (st) => JSON.stringify(st.profiles.slice().sort((a, b) => a.id < b.id ? -1 : 1));
    assert.equal(byId(back), byId(s), "the same profiles whatever the list order");
    assert.deepEqual([...back.slots].sort(), [...s.slots].sort());
    assert.deepEqual(back.subs, s.subs);
    assert.equal(oneStorePass(clone(s)).changed, false, "nothing left for a second run");
  }
});

console.log(`\n${passed} passed`);
