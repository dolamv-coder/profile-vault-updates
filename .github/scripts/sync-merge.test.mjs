// Tests the sync merge in the newest page (index-X.Y.Z.html, 1.9.65+): the plain functions between
// SYNC-CORE-START and SYNC-CORE-END, which decide what a device keeps when it syncs.
//   node .github/scripts/sync-merge.test.mjs [path/to/index-X.Y.Z.html]
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const html = readFileSync(file, "utf8");
const start = html.indexOf("/* SYNC-CORE-START"), end = html.indexOf("/* SYNC-CORE-END */");
if (start < 0 || end < 0) { console.log(`${file} has no sync merge to test.`); process.exit(0); }
// The page's own order identity, so "the same order" means here what it means there.
const pick = (re, what) => { const m = re.exec(html); assert.ok(m, `couldn't find ${what} in the page`); return m[0]; };
const helpers = pick(/^const norm = .*$/m, "norm") + "\n" + pick(/^function orderKey\(o\)\{.*\}$/m, "orderKey");
const core = new Function(html.slice(start, end) + "\n" + helpers + "\nreturn {syncCanon, syncHash, syncUnits, syncHashes, syncMerge, orderKey, SYNC_LISTS, SYNC_MAPS, SYNC_SETS, SYNC_VALUES, LOCAL_SETTINGS};")();
const { syncCanon, syncUnits, syncHashes, syncMerge, orderKey } = core;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const blank = () => ({ v: 1, settings: { autoLockMin: 15 }, groups: [], cardGroups: [], addresses: [], cards: [], profiles: [], logins: [], inboxes: [], checkouts: [], orders: [],
  deletedOrders: {}, caps: {}, slots: [], subs: {}, lastBatch: [], pulls: [], submitTo: null, submitName: "" });
// Merges `local` with `remote`, both having started from `base` (a state, or null for never synced).
const merge = (local, remote, base, lmt, rmt) => syncMerge(syncUnits(local), syncUnits(remote), base ? syncHashes(syncUnits(base)) : {}, lmt, rmt, orderKey);
const ids = (list) => list.map((x) => x.id);

console.log(`Sync merge in ${file.split(/[\\/]/).pop()}`);

test("the same data hashes the same whatever order its keys are in; undefined values don't count", () => {
  assert.equal(syncCanon({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }), syncCanon({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.notEqual(syncCanon({ a: [1, 2] }), syncCanon({ a: [2, 1] }));
  const a = blank(), b = blank();
  a.profiles.push({ id: "p1", name: "Ann", email: "a@x.com" }); b.profiles.push({ email: "a@x.com", name: "Ann", id: "p1" });
  assert.deepEqual(syncHashes(syncUnits(a)), syncHashes(syncUnits(b)));
});

test("units: list items by id, settings and maps by key (device-only settings left out), slots by value, whole values", () => {
  const s = blank();
  s.profiles.push({ id: "p1", name: "Ann" }); s.orders.push({ id: "o1", store: "target", orderNo: "1" });
  s.settings = { autoLockMin: 5, phone: { on: true }, billingWeekStart: 1, cleanKeep: ["a@b.com"] };
  s.caps = { target: 3 }; s.slots = ["p1|target"]; s.submitName = "Ann"; s.pulls = [{ id: "x" }];
  const keys = [...syncUnits(s).map.keys()].sort();
  assert.deepEqual(keys, ["N:", "b:", "o:o1", "p:p1", "s:billingWeekStart", "s:cleanKeep", "t:p1|target", "x:target"].sort());
});

test("only the other side changed: its edits, additions and deletions all come over", () => {
  const base = blank();
  base.profiles.push({ id: "p1", name: "Ann" }, { id: "p2", name: "Bob" }, { id: "p3", name: "Cat" });
  const local = clone(base), remote = clone(base);
  remote.profiles[0].name = "Ann B"; remote.profiles.splice(1, 1); remote.profiles.push({ id: "p4", name: "Dee" });
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.profiles, [{ id: "p1", name: "Ann B" }, { id: "p3", name: "Cat" }, { id: "p4", name: "Dee" }]);
  assert.equal(m.toLocal, true); assert.equal(m.toRemote, false);
});

test("only this side changed: kept, and marked to send", () => {
  const base = blank(); base.cards.push({ id: "c1", nick: "Chase" });
  const local = clone(base), remote = clone(base);
  local.cards[0].nick = "Chase 2"; local.cards.push({ id: "c2", nick: "Amex" });
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.cards, local.cards);
  assert.equal(m.toLocal, false); assert.equal(m.toRemote, true);
});

test("different items changed on each side: both changes kept", () => {
  const base = blank(); base.profiles.push({ id: "p1", name: "Ann" }, { id: "p2", name: "Bob" });
  const local = clone(base), remote = clone(base);
  local.profiles[0].name = "Ann L"; remote.profiles[1].name = "Bob R";
  local.profiles.push({ id: "pL", name: "New here" }); remote.profiles.push({ id: "pR", name: "New there" });
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.profiles.map((p) => p.name), ["Ann L", "Bob R", "New there", "New here"], "the online copy's order, then what's new here");
  assert.equal(m.clashes, 0);
});

test("the same item changed on both sides: the later change wins, and the online copy on a tie", () => {
  const base = blank(); base.logins.push({ id: "l1", email: "a@x.com", password: "one" });
  const local = clone(base), remote = clone(base);
  local.logins[0].password = "local"; remote.logins[0].password = "remote";
  assert.equal(merge(local, remote, base, { "l:l1": 2000 }, { "l:l1": 1000 }).state.logins[0].password, "local");
  assert.equal(merge(local, remote, base, { "l:l1": 1000 }, { "l:l1": 2000 }).state.logins[0].password, "remote");
  assert.equal(merge(local, remote, base, { "l:l1": 1000 }, { "l:l1": 1000 }).state.logins[0].password, "remote");
  const m = merge(local, remote, base, { "l:l1": 2000 }, { "l:l1": 1000 });
  assert.equal(m.clashes, 1); assert.equal(m.mt["l:l1"], 2000);
});

test("an edit beats a deletion, whichever side made which", () => {
  const base = blank(); base.addresses.push({ id: "a1", line1: "1 Main St" });
  const edited = clone(base); edited.addresses[0].line1 = "2 Main St";
  const deleted = clone(base); deleted.addresses = [];
  assert.deepEqual(merge(edited, deleted, base, {}, { "a:a1": 9e12 }).state.addresses, edited.addresses);
  assert.deepEqual(merge(deleted, edited, base, { "a:a1": 9e12 }, {}).state.addresses, edited.addresses);
  assert.deepEqual(merge(deleted, clone(deleted), base).state.addresses, [], "deleted on both: stays deleted");
});

test("never synced before (no base): everything from both sides, the online copy's version where they differ", () => {
  const local = blank(), remote = blank();
  local.profiles.push({ id: "p1", name: "Ann (here)" }, { id: "p2", name: "Only here" });
  remote.profiles.push({ id: "p1", name: "Ann (online)" }, { id: "p3", name: "Only online" });
  const m = merge(local, remote, null);
  assert.deepEqual(m.state.profiles.map((p) => p.name), ["Ann (online)", "Only online", "Only here"]);
  assert.equal(merge(local, remote, null, { "p:p1": 5 }, {}).state.profiles[0].name, "Ann (here)", "unless this side's change is newer");
});

test("settings and other maps merge key by key; device-only settings never travel", () => {
  const base = blank(); base.settings = { autoLockMin: 15, billingWeekStart: 1, cleanKeep: [] }; base.caps = { target: 2, walmart: 1 };
  const local = clone(base), remote = clone(base);
  local.settings.billingWeekStart = 0; local.settings.autoLockMin = 60; local.settings.phone = { relay: "x" };
  remote.settings.cleanKeep = ["news@shop.com"]; remote.settings.autoLockMin = 5;
  remote.caps.walmart = 4; delete local.caps.target;
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.settings, { billingWeekStart: 0, cleanKeep: ["news@shop.com"] });
  assert.deepEqual(m.state.caps, { walmart: 4 });
});

test("switched-on slots merge one by one", () => {
  const base = blank(); base.slots = ["p1|target", "p2|target"];
  const local = clone(base), remote = clone(base);
  local.slots = ["p1|target", "p2|target", "p3|walmart"]; remote.slots = ["p2|target"];
  assert.deepEqual(merge(local, remote, base).state.slots, ["p2|target", "p3|walmart"]);
});

test("whole values (who submits, the recipient) take the side that changed them", () => {
  const base = blank(); base.submitName = "Ann";
  const local = clone(base), remote = clone(base);
  remote.submitName = "Ann K"; local.submitTo = { pub: "k", keyId: "ABCD" };
  const m = merge(local, remote, base);
  assert.equal(m.state.submitName, "Ann K"); assert.deepEqual(m.state.submitTo, { pub: "k", keyId: "ABCD" });
  const cleared = clone(base); cleared.submitName = "";
  assert.equal(merge(cleared, clone(base), base).state.submitName, "", "clearing it is a change too");
});

test("the same order imported on both sides (one email, two devices) is kept once, as the online copy has it", () => {
  const base = blank();
  const local = clone(base), remote = clone(base);
  local.orders.push({ id: "oL", store: "target", orderNo: "9001", item: "Cards", inbox: "a@x.com" });
  remote.orders.push({ id: "oR", store: "target", orderNo: "9001", item: "Cards", inbox: "a@x.com" });
  local.orders.push({ id: "oL2", store: "target", orderNo: "9002", item: "Other" });
  const m = merge(local, remote, base);
  assert.deepEqual(ids(m.state.orders), ["oR", "oL2"]);
});

test("orders sharing a number that were both already synced, or have no number, are never merged away", () => {
  const base = blank();
  base.orders.push({ id: "o1", store: "target", orderNo: "77", item: "Item A" }, { id: "o2", store: "target", orderNo: "77", item: "Item B" });
  const local = clone(base), remote = clone(base);
  local.orders.push({ id: "o3", store: "walmart", item: "Same thing", at: "2026-09-01" });
  remote.orders.push({ id: "o4", store: "walmart", item: "Same thing", at: "2026-09-01" });
  assert.deepEqual(ids(merge(local, remote, base).state.orders), ["o1", "o2", "o4", "o3"]);
});

test("an order deleted on one side doesn't come back from the other side's email import", () => {
  const base = blank(); base.orders.push({ id: "o1", store: "target", orderNo: "500", item: "Box", inbox: "a@x.com" });
  const local = clone(base), remote = clone(base);
  local.orders = []; local.deletedOrders = { [orderKey(base.orders[0])]: 1000 };
  // The other device deleted nothing, but imported the order again as a new item (it hadn't heard).
  remote.orders.push({ id: "o1b", store: "target", orderNo: "500", item: "Box", inbox: "a@x.com" });
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.orders, []);
  assert.deepEqual(m.state.deletedOrders, local.deletedOrders);
  const manual = clone(remote); manual.orders[1] = { id: "o1c", store: "target", orderNo: "500", item: "Box" };
  assert.deepEqual(ids(merge(local, manual, base).state.orders), ["o1c"], "one added by hand stays");
});

test("items without an id, or with the same id twice, aren't lost", () => {
  const base = blank(); base.checkouts.push({ store: "target", n: 1 }, { id: "dup", n: 2 }, { id: "dup", n: 3 });
  const local = clone(base), remote = clone(base);
  local.checkouts.push({ store: "walmart", n: 4 });
  const m = merge(local, remote, base);
  assert.deepEqual(m.state.checkouts.map((c) => c.n), [1, 2, 3, 4]);
});

test("merging is stable: merging a result with itself changes nothing", () => {
  const a = blank(); a.profiles.push({ id: "p1", name: "Ann" }); a.settings.billingWeekStart = 2; a.slots = ["p1|target"];
  const m = merge(a, clone(a), a);
  assert.equal(m.toLocal, false); assert.equal(m.toRemote, false);
  assert.deepEqual(m.hashes, m.remote);
});

// Devices editing and syncing in a random order, through a server that takes a save only from the
// revision it's at (409 otherwise), as the license worker does. Whatever happens, once everyone has
// synced they hold the same vault, and nothing that only one device touched is lost.
test("several devices editing and syncing in random order always end up with the same vault", () => {
  let seed = 12345;   // mulberry32
  const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
  let checked = 0;
  for (let run = 0; run < 300; run++) {
    let clock = 1000;
    const server = { rev: 0, state: null, mt: {} };
    const start = blank();
    for (let i = 0; i < 4; i++) start.profiles.push({ id: "p" + i, name: "P" + i, n: 0 });
    for (let i = 0; i < 3; i++) start.orders.push({ id: "o" + i, store: "target", orderNo: String(100 + i), item: "I" + i, stage: "placed" });
    server.state = clone(start); server.rev = 1;
    const devices = [0, 1, 2].map(() => ({ state: clone(start), base: syncHashes(syncUnits(start)), rev: 1, mt: {} }));
    const touched = new Map();   // unit key -> devices that changed it
    const last = new Map();      // unit key -> its hash right after its latest change (null: deleted)
    const note = (d, i, k) => { d.mt[k] = ++clock; if (!touched.has(k)) touched.set(k, new Set()); touched.get(k).add(i); d.pendingNote = k; };
    const edit = (d, i) => {
      const s = d.state, op = rnd(7);
      if (op === 0 && s.profiles.length) { const p = s.profiles[rnd(s.profiles.length)]; p.n++; note(d, i, "p:" + p.id); }
      else if (op === 1) { const id = `p${i}-${run}-${clock}`; s.profiles.push({ id, name: "new", n: 0 }); note(d, i, "p:" + id); }
      else if (op === 2 && s.profiles.length) { const j = rnd(s.profiles.length); note(d, i, "p:" + s.profiles[j].id); s.profiles.splice(j, 1); }
      else if (op === 3) { s.settings.billingWeekStart = rnd(7); note(d, i, "s:billingWeekStart"); }
      else if (op === 4) { const k = "p" + rnd(4) + "|target"; s.slots = s.slots.includes(k) ? s.slots.filter((x) => x !== k) : s.slots.concat(k); note(d, i, "t:" + k); }
      else if (op === 5 && s.orders.length) { const o = s.orders[rnd(s.orders.length)]; o.stage = ["placed", "shipped", "delivered"][rnd(3)]; note(d, i, "o:" + o.id); }
      else { s.submitName = "N" + rnd(3); note(d, i, "N:"); }
    };
    const sync = (d) => {
      for (let tries = 0; tries < 5; tries++) {
        if (server.rev !== d.rev) {
          const m = syncMerge(syncUnits(d.state), syncUnits(server.state), d.base, d.mt, server.mt, orderKey);
          d.state = Object.assign({}, d.state, clone(m.state)); d.base = m.remote; d.rev = server.rev; d.mt = m.mt;
        }
        const now = syncHashes(syncUnits(d.state));
        if (JSON.stringify(now) === JSON.stringify(d.base)) return;
        if (rnd(4) === 0) { server.rev++; server.mt = Object.assign({}, server.mt); continue; }   // someone else saved first (409)
        server.state = clone(d.state); server.mt = Object.assign({}, d.mt); server.rev++; d.rev = server.rev; d.base = now;
        return;
      }
    };
    for (let step = 0; step < 40; step++) {
      const i = rnd(3);
      if (!rnd(3)) { sync(devices[i]); continue; }
      edit(devices[i], i);
      const k = devices[i].pendingNote; if (!k) continue;
      const u = syncUnits(devices[i].state).map.get(k);
      last.set(k, u ? u.h : null); devices[i].pendingNote = null;
    }
    for (let round = 0; round < 3; round++) devices.forEach(sync);
    const want = JSON.stringify(syncHashes(syncUnits(server.state)));
    devices.forEach((d, i) => assert.equal(JSON.stringify(syncHashes(syncUnits(d.state))), want, `run ${run}: device ${i} differs from the online copy`));
    // Whatever only one device changed ends up as that device last left it: edited, added or deleted.
    const final = syncUnits(server.state).map;
    for (const [k, by] of touched) {
      if (by.size !== 1) continue;
      const u = final.get(k);
      assert.equal(u ? u.h : null, last.get(k), `run ${run}: ${k}, changed on one device only, didn't keep that change`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} changes checked`);
});

console.log(`\n${passed} passed`);
