// Tests Interests in the newest page (index-X.Y.Z.html), from 1.9.142: the products the seller lists on the license worker for
// buyers to tick, which each batch Submit sends takes with it (the owner's request, 2026-11-12). The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, against a pretend license worker: a vault made with Use this browser
// only, then a license key kept as Submit keeps one typed there. It checks where the tab is, the cards, ticks and their sync
// setting, Tick all, the search, the list kept on this device, what Submit sends, and the seller's own editing (Add products,
// Edit with a picture, and a save another device beat). Then what the review of 1.9.142 found: names read from Target's
// links, every tick sent whatever the copy here, one section for Other, Edit's Save over a save it didn't see, a paste from a
// spreadsheet, one save at a time, a refresh answered after a save, and what the TCGplayer lookups after Add say. And what
// its second review found: a count in a Target link stays a count, a 401 empties the list here, Add products and Remove
// wait for a save out, Add products or Edit closed while it waits saves nothing, and two waiting both save. Sample names,
// SKUs and keys only.
//   node .github/scripts/interests.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have Interests; a page named on the command line that doesn't is skipped.
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
if (!/function renderInterests\(/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no Interests (renderInterests): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Interests, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t), as the
// page's other tests take its code out of the file.
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, refreshInterests, interestRead, interestsFor, premiumHash, slotKey,"
  + " INTEREST, interestKeep, interestsSave, interestFindPics, interestFromLine};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LIC = "PVLT-TEST-TEST-TEST-TEST";
// The list as the worker keeps it (with each product's upload and TCGplayer product), in two sets and one at Pokémon Center.
const LIST = () => [
  { sku: "11111111", store: "target", name: "Sample Booster Bundle", about: "Six sample booster packs.", set: "Sample Set A", pic: "", tcg: "111" },
  { sku: "22222222", store: "target", name: "Sample Elite Box", about: "Nine sample packs and sleeves.", set: "Sample Set A", pic: "h" + "a".repeat(32), tcg: "" },
  { sku: "33333333", store: "target", name: "Sample Tin", about: "Three sample packs in a tin.", set: "Sample Set B", pic: "", tcg: "" },
  { sku: "100-10001", store: "pokemoncenter", name: "Sample Center Box", about: "A Pokémon Center edition.", set: "Sample Set B", pic: "", tcg: "222" },
];
const W = { rev: 3, items: LIST(), owner: false, gets: [], puts: [], picPosts: [], picGets: [], finds: [], subs: [] };
const ref = (it) => it.pic || (it.tcg ? "t" + it.tcg : "");
const out = () => ({ rev: W.rev, owner: W.owner, items: W.items.map((it) => Object.assign({ sku: it.sku, store: it.store, name: it.name, about: it.about, set: it.set, ref: ref(it) }, W.owner ? { pic: it.pic, tcg: it.tcg } : {})) });
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (p.startsWith("/interests/pic/") && m === "GET") {
    W.picGets.push(p.slice("/interests/pic/".length));
    return route.fulfill({ status: 200, contentType: "image/png", headers: Object.assign({ "cross-origin-resource-policy": "cross-origin" }, CORS), body: PNG });
  }
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/interests" && m === "GET") {
    W.gets.push(u.search);
    // An error once (status): the worker's 503 for a key made by hand while it can't read GitHub's list.
    if (W.status) { const s = W.status; W.status = 0; return json(route, s, { error: "the list of keys made by hand can't be read just now" }); }
    // Read as it is when asked, then (hold) slow to come: an answer a save can overtake.
    const body = u.searchParams.get("rev") === String(W.rev) ? { rev: W.rev, owner: W.owner, same: true } : out();
    if (W.hold) await W.hold;
    return json(route, 200, body);
  }
  if (p === "/interests" && m === "PUT") {
    if (!W.owner) return json(route, 403, { error: "only your seller's FAFO can change this" });
    const b = JSON.parse(req.postData()); W.puts.push(b);
    if (W.putHold) await W.putHold;   // a save that's slow to go through
    if (b.rev !== W.rev) return json(route, 409, { error: "changed", rev: W.rev });
    W.rev++; W.items = b.items;
    return json(route, 200, out());
  }
  if (p === "/interests/pic" && m === "POST") { W.picPosts.push(JSON.parse(req.postData())); return json(route, 200, { ref: "h" + "b".repeat(32) }); }
  if (p === "/pictures/find") {
    const q = u.searchParams.get("q"); W.finds.push(q);
    if (q === "Sample Loading Box") return json(route, 200, { found: false, more: true });   // the catalog still being read
    if (q === "Sample Broken Box") return json(route, 502, { error: "the catalog didn't answer" });
    return json(route, 200, q === "Sample Mini Tin" ? { found: true, name: "Sample Mini Tin", product: 555, source: "TCGplayer", image: "data:image/png;base64," + PNG.toString("base64") } : { found: false });
  }
  if (p === "/submissions" && m === "POST") { W.subs.push(JSON.parse(req.postData())); return json(route, 200, { ok: true, id: "batch1", review: "pending" }); }
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/slots/limit") return json(route, 200, { limit: 20, request: null });
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
const navIds = (sel) => page.$$eval(sel, (els) => els.map((e) => e.dataset.id));
const picks = () => ev(() => window.__t.S.settings.interestPicks || {});
const badge = () => page.$eval('#side [data-id="interests"] .n', (e) => e.textContent);
const cards = () => page.$$eval("#main .int-card", (els) => els.map((e) => e.querySelector(".int-name").textContent));
const lastToast = () => page.$$eval("#toasts .toast", (els) => els.map((e) => e.textContent).join(" | "));
// A window puts the cursor in its first box 60 ms after it opens (the lock screen, 30 ms after it's drawn): text filled
// into another box before then could land there instead.
const focused = (id) => page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id);

console.log(`Interests in ${file.split(/[\\/]/).pop()}`);
try {
  await page.goto("https://app.fafoaco.com/");
  // A vault in this browser only, with no license key yet.
  await page.click("#lock-local");
  await focused("pw1");
  await page.fill("#pw1", "sample-pass-142"); await page.fill("#pw2", "sample-pass-142"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });

  await test("there's no Interests tab without a license key", async () => {
    assert.ok(!(await navIds("#side [data-act=view]")).includes("interests"));
    assert.ok(!(await navIds("#mnav [data-act=view]")).includes("interests"));
    assert.equal(W.gets.length, 0, "nothing asked without a key");
  });

  await test("Add products names a Target link as its product: Target's numbers for é, &, an apostrophe and a dash read back, and a count stays", async () => {
    const name = (line) => ev((l) => { const it = window.__t.interestFromLine(l, "target"); return it && [it.sku, it.name]; }, line);
    const T = "https://www.target.com/p/";
    assert.deepEqual(await name(T + "pok-233-mon-scarlet-violet-s10-5-elite-trainer-box-1-trading-cards/-/A-94636860"),
      ["94636860", "Pokémon Scarlet Violet S10 5 Elite Trainer Box 1 Trading Cards"]);
    assert.deepEqual(await name(T + "pokemon-trading-card-game-scarlet-38-violet-151-ultra-premium-collection/-/A-88897906"),
      ["88897906", "Pokémon Trading Card Game Scarlet & Violet 151 Ultra Premium Collection"]);
    assert.deepEqual(await name(T + "pokemon-trading-card-game--scarlet---38--violet---surging-sparks-booster-bundle/-/A-91619929#lnk=sametab"),
      ["91619929", "Pokémon Trading Card Game Scarlet & Violet Surging Sparks Booster Bundle"]);
    assert.deepEqual(await name(T + "pok-mon-tcg-mega-evolution-perfect-order-elite-trainer-box/-/A-1010873274"),
      ["1010873274", "Pokémon TCG Mega Evolution Perfect Order Elite Trainer Box"]);
    assert.deepEqual(await name(T + "pokemon-trading-card-game-sword-38-shield-8212-brilliant-stars-elite-trainer-box/-/A-84713762"),
      ["84713762", "Pokémon Trading Card Game Sword & Shield – Brilliant Stars Elite Trainer Box"]);
    assert.deepEqual(await name(T + "sample-trainer-39-s-toolkit-8211-sample-edition/-/A-12345678"), ["12345678", "Sample Trainer's Toolkit – Sample Edition"]);
    assert.deepEqual(await name(T + "sample-collector-8217-s-chest-38/-/A-12345679"), ["12345679", "Sample Collector's Chest 38"]);
    assert.deepEqual(await name(T + "sample-na-239-ve-tin/-/A-12345680"), ["12345680", "Sample Naïve Tin"]);
    // A word the table doesn't have is only a word, "constructor" too (not Object's).
    assert.deepEqual(await name(T + "sample-technic-constructor-set/-/A-12345681"), ["12345681", "Sample Technic Constructor Set"]);
    assert.deepEqual(await name(T + "pokemon-tcg-etb/-/A-12345682"), ["12345682", "Pokémon TCG ETB"]);
    // A number from 192 to 255 between words is a count, not a letter's (the second review of 1.9.142): only between two
    // pieces of a word (pok-233-mon, na-239-ve) is it one.
    assert.deepEqual(await name(T + "pokemon-200-piece-puzzle/-/A-12345683"), ["12345683", "Pokémon 200 Piece Puzzle"]);
    assert.deepEqual(await name(T + "ultra-pro-pokemon-binder-240-pocket/-/A-12345684"), ["12345684", "Ultra Pro Pokémon Binder 240 Pocket"]);
    assert.deepEqual(await name(T + "ultra-pro-pok-233-mon-240-card-binder/-/A-12345685"), ["12345685", "Ultra Pro Pokémon 240 Card Binder"]);
    assert.deepEqual(await name(T + "pokemon-tcg-250-card-binder/-/A-12345686"), ["12345686", "Pokémon TCG 250 Card Binder"]);
    assert.deepEqual(await name(T + "pokemon-tcg-card-sleeves-200-count/-/A-12345687"), ["12345687", "Pokémon TCG Card Sleeves 200 Count"]);
    assert.deepEqual(await name(T + "sample-sleeves-pack-of-250-ct/-/A-12345688"), ["12345688", "Sample Sleeves Pack Of 250 Ct"]);
    // é also ends a piece before a whole word: Poké Ball.
    assert.deepEqual(await name(T + "pok-233-mon-trading-card-game-pok-233-ball-tin/-/A-12345692"),
      ["12345692", "Pokémon Trading Card Game Poké Ball Tin"]);
    // Two words with an apostrophe are a name, and a word of the table keeps its spelling with one.
    assert.deepEqual(await name(T + "trainer-39-s-toolkit/-/A-12345689"), ["12345689", "Trainer's Toolkit"]);
    assert.deepEqual(await name(T + "pokemon-39-s-sample-tin/-/A-12345690"), ["12345690", "Pokémon's Sample Tin"]);
    assert.deepEqual(await name(T + "sample-39-s/-/A-12345691"), ["12345691", "SKU 12345691"]);
  });

  await test("with a license key, Interests is between IMAP and Submit in the sidebar, and right before Submit in the phone's tabs", async () => {
    await ev((lic) => { const T = window.__t; T.keepTypedLic(lic); T.persist(); T.render(); T.refreshInterests(true); }, LIC);
    const side = await navIds("#side [data-act=view]"), i = side.indexOf("interests");
    assert.deepEqual(side.slice(i - 1, i + 2), ["imap", "interests", "submit"]);
    const tabs = await navIds("#mnav [data-act=view]"), j = tabs.indexOf("interests");
    assert.ok(j > 0 && tabs[j + 1] === "submit", tabs.join(","));
    await page.waitForFunction(() => { const L = window.__t.interestRead(); return L && L.items.length === 4; });
    assert.equal(W.gets[0], "", "the first ask is for the whole list");
  });

  await test("a buyer's cards: by set, each with its name, SKU, description and picture, and no Edit list", async () => {
    await page.click('#side [data-id="interests"]');
    await page.waitForSelector("#main .int-card");
    assert.equal(await page.$eval("#q", (e) => e.placeholder), "Search products");
    assert.deepEqual(await page.$$eval("#main .int-set .sub-title", (els) => els.map((e) => e.textContent)), ["Sample Set A", "Sample Set B"]);
    assert.deepEqual(await cards(), ["Sample Booster Bundle", "Sample Elite Box", "Sample Tin", "Sample Center Box"]);
    const first = await page.$eval("#main .int-card", (e) => ({ text: e.textContent, img: e.querySelector("img").getAttribute("src") }));
    assert.match(first.text, /SKU 11111111/); assert.match(first.text, /Six sample booster packs\./); assert.match(first.text, /Run this on my profiles/);
    assert.equal(first.img, "https://license.fafoaco.com/interests/pic/t111");
    await page.waitForFunction(() => { const i = document.querySelector("#main .int-card img"); return i && i.complete && i.naturalWidth > 0; });
    assert.equal(await page.$eval("#main .int-card:nth-child(2) img", (e) => e.getAttribute("src")), "https://license.fafoaco.com/interests/pic/h" + "a".repeat(32));
    // No picture: the store's mark in its frame.
    assert.equal(await page.$$eval("#main .int-card", (els) => els[2].querySelector(".int-pic").className), "int-pic is-broken");
    assert.equal(await page.$$eval("#main .int-card", (els) => els[2].querySelectorAll("img").length), 0);
    assert.equal(await page.locator('[data-act="interests-edit"]').count(), 0, "no Edit list for a buyer");
    assert.equal(await page.locator('[data-act="interest-edit"]').count(), 0);
    assert.match(await page.$eval("#main .p-kpis", (e) => e.textContent), /Products 4.*Ticked 0/);
  });

  await test("ticking keeps the synced setting and the badge; Tick all ticks a set; an untick stays as on:false", async () => {
    await page.check('#main input[data-act="interest-pick"][data-id="target:33333333"]');
    await page.check('#main input[data-act="interest-pick"][data-id="target:11111111"]');
    let p = await picks();
    assert.equal(p["target:33333333"].on, true); assert.equal(p["target:11111111"].on, true); assert.equal(typeof p["target:11111111"].at, "number");
    assert.equal(await badge(), "2");
    assert.ok(await page.$eval('#main input[data-id="target:11111111"]', (e) => e.closest(".int-card").classList.contains("is-on")));
    await page.check('#main input[data-act="interest-set"][data-id="Sample Set A"]');
    p = await picks();
    assert.equal(p["target:22222222"].on, true);
    assert.equal(await badge(), "3");
    assert.match(await page.$eval("#main .int-set", (e) => e.textContent), /2 of 2 ticked/);
    await page.uncheck('#main input[data-act="interest-pick"][data-id="target:22222222"]');
    p = await picks();
    assert.equal(p["target:22222222"].on, false, "kept, so a merge doesn't bring the tick back");
    assert.equal(await badge(), "2");
    assert.equal(await page.$eval('#main input[data-act="interest-set"][data-id="Sample Set A"]', (e) => e.checked), false);
    // Tick all off unticks the set's products shown, and on again ticks them.
    await page.check('#main input[data-act="interest-set"][data-id="Sample Set A"]');
    await page.uncheck('#main input[data-act="interest-set"][data-id="Sample Set A"]');
    p = await picks();
    assert.deepEqual([p["target:11111111"].on, p["target:22222222"].on, p["target:33333333"].on], [false, false, true]);
    await page.check('#main input[data-act="interest-pick"][data-id="target:11111111"]');
    assert.equal(await badge(), "2");
  });

  await test("the search box shows the products with every word typed, in their name, SKU, set or description", async () => {
    await page.fill("#q", "tin");
    assert.deepEqual(await cards(), ["Sample Tin"]);
    await page.fill("#q", "set a sleeves");
    assert.deepEqual(await cards(), ["Sample Elite Box"]);
    await page.fill("#q", "100-10001");
    assert.deepEqual(await cards(), ["Sample Center Box"]);
    await page.fill("#q", "pokemon center edition");
    assert.deepEqual(await cards(), ["Sample Center Box"], "accents don't count");
    // Tick all with a search on ticks only the ones shown.
    await page.fill("#q", "center");
    await page.check('#main input[data-act="interest-set"][data-id="Sample Set B"]');
    assert.equal((await picks())["pokemoncenter:100-10001"].on, true);
    await page.fill("#q", "nothing like this");
    assert.match(await page.$eval("#main", (e) => e.textContent), /No products match "nothing like this"/);
    await page.fill("#q", "");
    assert.equal((await cards()).length, 4);
  });

  await test("the list is kept on this device by a hash of the key, never the key, and shows at once after locking", async () => {
    const kept = JSON.parse(await ev(() => localStorage.getItem("orbit-interests")));
    assert.equal(kept.rev, 3); assert.equal(kept.items.length, 4); assert.equal(kept.owner, false);
    assert.ok(!JSON.stringify(kept).includes("TEST-TEST") && !JSON.stringify(kept).includes("PVLT"));
    assert.equal(kept.h, await ev((lic) => window.__t.premiumHash(lic), LIC));
    assert.ok(kept.items.every((it) => !("pic" in it) && !("tcg" in it)), "a buyer's copy has no upload or TCGplayer fields");
    // Locked and unlocked again, with the worker slow to answer: the list kept here shows meanwhile.
    let release; W.hold = new Promise((r) => { release = r; });
    const asked = W.gets.length;
    await page.click('[data-act="lock"]');
    await page.fill("#pw1", "sample-pass-142");
    await page.waitForSelector('#side [data-id="interests"]', { timeout: 30000 });
    await waitFor(() => W.gets.length > asked, "the ask at unlock");
    if (!(await page.locator("#main .int-card").count())) await page.click('#side [data-id="interests"]');
    assert.deepEqual(await cards(), ["Sample Booster Bundle", "Sample Elite Box", "Sample Tin", "Sample Center Box"]);
    assert.equal(await badge(), "3");
    assert.equal(W.gets[asked], "?rev=3", "asked whether the list is still revision 3");
    release(); W.hold = null;
  });

  await test("a 503 (the worker can't check a key made by hand just now) keeps the list here, as it was", async () => {
    await page.waitForFunction(() => !window.__t.INTEREST.busy);   // the ask at unlock, answered
    const before = await ev(() => JSON.stringify(window.__t.interestRead())), asked = W.gets.length;
    W.status = 503;
    await ev(() => window.__t.refreshInterests(true));
    assert.equal(W.gets.length, asked + 1, "it asked");
    assert.equal(await ev(() => JSON.stringify(window.__t.interestRead())), before);
    assert.equal(JSON.parse(await ev(() => localStorage.getItem("orbit-interests"))).items.length, 4);
  });

  await test("a 401 (the license turned off) empties the list kept here: Interests shows none and the badge goes, till an answer brings it back", async () => {
    const asked = W.gets.length;
    W.status = 401;
    await ev(() => window.__t.refreshInterests(true));
    assert.equal(W.gets.length, asked + 1, "it asked");
    assert.deepEqual(await ev(() => window.__t.interestRead().items), []);
    const kept = JSON.parse(await ev(() => localStorage.getItem("orbit-interests")));
    assert.deepEqual([kept.rev, kept.items], [null, []]);
    assert.equal(await page.$eval("#main .empty h2", (e) => e.textContent), "Nothing here yet");
    assert.deepEqual(await cards(), []);
    assert.equal(await badge(), "");
    // The next answer brings the whole list back (with no revision kept, it asks for the whole list).
    await ev(() => window.__t.refreshInterests(true));
    assert.equal(W.gets.at(-1), "");
    await page.waitForSelector("#main .int-card");
    assert.equal((await cards()).length, 4);
    assert.equal(await badge(), "3");
  });

  await test("Submit sends every SKU ticked for the stores in the batch only: those on the list first, in its order, then the rest", async () => {
    await ev(() => {
      const { S, slotKey, persist, render } = window.__t;
      S.addresses.push({ id: "a1", first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
      S.profiles.push({ id: "p1", name: "Sam T", shipId: "a1", billSame: true, cardId: "c1", phone: "5125550100", stores: [{ store: "target", mode: "seller" }] });
      S.slots = [slotKey("p1", "target")];
      // Ticked, but not on the list kept here (a product added since, ticked on another device): sent after the listed ones,
      // as the worker keeps only the ones on its list now.
      S.settings.interestPicks = Object.assign({}, S.settings.interestPicks, { "target:99999999": { on: true, at: Date.now() } });
      persist(); render();
    });
    await page.click('#side [data-id="submit"]');
    await page.waitForSelector("#main .sub-act");
    assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /2 interests ticked: their SKUs go to your seller with the next Target slots you submit\./);
    await page.click('#main [data-act="submit-slots"]');
    await page.fill("#ss-from", "Sam");
    await page.click("#ss-go");
    await page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
    assert.equal(W.subs.length, 1);
    assert.deepEqual(W.subs[0].interests, { target: ["11111111", "33333333", "99999999"] }, "Pokémon Center's tick stays out: no Pokémon Center slots in this batch");
    // A copy here that's empty (as a 401 leaves it) still sends every tick.
    assert.deepEqual(await ev((lic) => { const T = window.__t, was = T.interestRead(); T.interestKeep(lic, { rev: null, owner: false, items: [] });
      const r = T.interestsFor([{ kind: "profiles", storeKey: "target" }]); T.interestKeep(lic, was); return r.target.slice().sort(); }, LIC), ["11111111", "33333333", "99999999"]);
    assert.deepEqual([...new Set(W.subs[0].files.map((f) => f.storeKey).filter(Boolean))], ["target"]);
    await page.click("#layers [data-close]");
    // Nothing ticked for the store: a hint to tick, and nothing sent for it.
    await ev(() => { const T = window.__t; T.S.settings.interestPicks = {}; T.persist(); T.render(); });
    assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /Tick products on Interests for your seller to run them\./);
    assert.equal(await ev(() => JSON.stringify(window.__t.interestsFor([{ kind: "profiles", storeKey: "target" }]))), "{}");
    // One ticked: its SKU.
    await ev(() => { const T = window.__t; T.S.settings.interestPicks = { "target:33333333": { on: true, at: Date.now() } }; T.persist(); T.render(); });
    assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /1 interest ticked: its SKU goes to your seller with the next Target slots you submit\./);
  });

  await test("the seller's own FAFO: Edit list, Add products saves with the list's revision, then finds TCGplayer pictures", async () => {
    W.owner = true;
    await page.click('#side [data-id="interests"]');
    await ev(() => window.__t.refreshInterests(true));
    await page.waitForSelector('#main [data-act="interests-edit"]');
    assert.equal(await page.$eval('#main [data-act="interests-edit"]', (e) => e.textContent), "Edit list");
    assert.deepEqual(W.gets.slice(-2), ["?rev=3", ""], "the same revision, now the seller's: the whole list, with its pictures' fields");
    assert.equal(await ev(() => window.__t.interestRead().items[0].tcg), "111");
    assert.ok((await cards()).length === 4 && await page.locator('#main input[data-act="interest-pick"]').count() === 4, "the seller sees the buyer's view too");
    await page.click('#main [data-act="interests-edit"]');
    assert.equal(await page.locator('#main [data-act="interest-edit"]').count(), 4);
    assert.equal(await page.locator('#main [data-act="interest-remove"]').count(), 4);
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", ["https://www.target.com/p/sample-trading-card-game-booster-box/-/A-44444444#lnk=sametab", "55555555 Sample Mini Tin",
      "11111111 Already here", "not a sku", "https://www.pokemoncenter.com/product/100-10002/sample-center-tin", ""].join("\n"));
    await page.fill("#ia-set", "Sample Set C");
    assert.equal(await page.$eval("#ia-prev", (e) => e.textContent), "3 products to add · 1 already on the list · 1 line couldn't be read");
    await page.click("#ia-go");
    await waitFor(() => W.puts.length >= 2, "the second save, with the picture found");
    assert.equal(W.puts[0].rev, 3);
    assert.deepEqual(W.puts[0].items.slice(4).map((it) => [it.sku, it.store, it.name, it.set, it.pic, it.tcg]), [
      ["44444444", "target", "Sample Trading Card Game Booster Box", "Sample Set C", "", ""],
      ["55555555", "target", "Sample Mini Tin", "Sample Set C", "", ""],
      ["100-10002", "pokemoncenter", "Sample Center Tin", "Sample Set C", "", ""]]);
    assert.deepEqual(W.puts[0].items.slice(0, 4), LIST(), "the rest as they were, with their pictures");
    assert.deepEqual(W.finds, ["Sample Trading Card Game Booster Box", "Sample Mini Tin", "Sample Center Tin"]);
    assert.equal(W.puts[1].rev, 4);
    assert.equal(W.puts[1].items.find((it) => it.sku === "55555555").tcg, "555");
    await page.waitForFunction(() => window.__t.interestRead().rev === 5);
    assert.equal(await ev(() => window.__t.interestRead().items.find((it) => it.sku === "55555555").ref), "t555");
    assert.deepEqual(await page.$$eval("#main .int-set .sub-title", (els) => els.map((e) => e.textContent)), ["Sample Set A", "Sample Set B", "Sample Set C"]);
  });

  await test("the seller's Edit: a picture chosen goes up first, then the whole list is saved with it", async () => {
    await page.click('#main [data-act="interest-edit"][data-id="target:33333333"]');
    await focused("ie-name");
    await page.fill("#ie-name", "Sample Tin, Second Print");
    await page.fill("#ie-about", "Three sample packs\nin a tin.");
    await page.setInputFiles("#ie-file", { name: "tin.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(() => /ready to save/.test(document.querySelector("#ie-say").textContent));
    await page.click("#ie-save");
    await waitFor(() => W.puts.length === 3, "the save");
    assert.equal(W.picPosts.length, 1); assert.match(W.picPosts[0].data, /^data:image\/(webp|jpeg);base64,/);
    const it = W.puts[2].items.find((x) => x.sku === "33333333");
    assert.deepEqual([W.puts[2].rev, it.name, it.about, it.pic], [5, "Sample Tin, Second Print", "Three sample packs in a tin.", "h" + "b".repeat(32)]);
    await page.waitForFunction(() => !document.querySelector("#ie-name"));
    assert.ok((await cards()).includes("Sample Tin, Second Print"));
  });

  await test("a save another device beat (409) shows the list as it is now, and says to make the change again", async () => {
    // Another device saved meanwhile: it took Sample Elite Box off.
    W.items = W.items.filter((it) => it.sku !== "22222222"); W.rev = 9;
    await page.click('#main [data-act="interest-remove"][data-id="target:11111111"]');
    await page.click("#cf-go");
    await page.waitForFunction(() => window.__t.interestRead().rev === 9);
    assert.equal(W.puts.at(-1).rev, 6, "sent with the revision it was made from");
    assert.match(await lastToast(), /The list changed on another device\. Here it is now; make your change again\./);
    const now = await cards();
    assert.ok(now.includes("Sample Booster Bundle"), "the remove didn't go through");
    assert.ok(!now.includes("Sample Elite Box"), "the other device's change shows");
    // Made again, it goes.
    await page.click('#main [data-act="interest-remove"][data-id="target:11111111"]');
    await page.click("#cf-go");
    await page.waitForFunction(() => window.__t.interestRead().rev === 10);
    assert.ok(!(await cards()).includes("Sample Booster Bundle"));
  });

  // ---- What the review of 1.9.142 found. Each starts from a list of its own, on the seller's FAFO with Edit list on. ----
  const BASE = () => LIST().concat([{ sku: "44444444", store: "target", name: "Sample Booster Box", about: "", set: "Sample Set C", pic: "", tcg: "" }]);
  const reset = async (items, rev) => {
    W.items = items; W.rev = rev;
    await ev(() => { document.querySelector("#toasts").innerHTML = ""; });
    await page.waitForFunction((r) => { const T = window.__t; if (T.interestRead().rev !== r) T.refreshInterests(true, true); return T.interestRead().rev === r; }, rev, { polling: 100 });
    await page.waitForSelector('#main [data-act="interest-edit"][data-id="target:44444444"]');
  };
  const toastSays = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#toasts").textContent), re.source);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A save of this FAFO's own (as the pictures Add products finds), of the list as it's kept here with one product changed.
  const saveOwn = (sku, change, quiet = true) => ev(({ sku, change, quiet }) => { const T = window.__t, L = T.interestRead();
    return T.interestsSave(L.items.map((it) => (it.sku === sku ? Object.assign({}, it, change) : it)), L.rev, quiet ? { quiet: true } : {}); }, { sku, change, quiet });
  const startOwn = (sku, change) => ev(({ sku, change }) => { const T = window.__t, L = T.interestRead();
    window.__bg = T.interestsSave(L.items.map((it) => (it.sku === sku ? Object.assign({}, it, change) : it)), L.rev, { quiet: true }); }, { sku, change });
  const openEdit = async (key) => { await page.click(`#main [data-act="interest-edit"][data-id="${key}"]`); await focused("ie-name"); };
  const closed = () => page.waitForFunction(() => !document.querySelector("#ie-name"));

  await test("products with no set and ones in a set named Other are one section, Other, with one Tick all", async () => {
    await reset(BASE().concat([{ sku: "77777777", store: "target", name: "Sample Sleeves", about: "", set: "", pic: "", tcg: "" },
      { sku: "88888888", store: "target", name: "Sample Binder", about: "", set: "Other", pic: "", tcg: "" }]), 20);
    const titles = await page.$$eval("#main .int-set .sub-title", (els) => els.map((e) => e.textContent));
    assert.deepEqual(titles, ["Sample Set A", "Sample Set B", "Sample Set C", "Other"]);
    const other = () => page.$$eval("#main .int-set", (els) => els.find((e) => e.querySelector(".sub-title").textContent === "Other").textContent);
    assert.match(await other(), /0 of 2 ticked/);
    await page.check('#main input[data-act="interest-set"][data-id="Other"]');
    const p = await picks();
    assert.deepEqual([p["target:77777777"].on, p["target:88888888"].on], [true, true]);
    assert.match(await other(), /2 of 2 ticked/);
  });

  await test("Edit's Save puts only what was changed in the window onto the product as it is now: a save it didn't see stays", async () => {
    await reset(BASE(), 30);
    await openEdit("target:44444444");
    await page.fill("#ie-about", "Thirty-six sample packs in a box.");
    // This FAFO saves a picture for it meanwhile, as the pictures Add products finds do.
    assert.equal(await saveOwn("44444444", { tcg: "777" }), true);
    let n = W.puts.length;
    await page.click("#ie-save");
    await closed();
    assert.equal(W.puts.length, n + 1);
    let it = W.puts[n].items.find((x) => x.sku === "44444444");
    assert.equal(W.puts[n].rev, 31, "onto the list as it's kept now: no 409");
    assert.deepEqual([it.about, it.tcg, it.name, it.set], ["Thirty-six sample packs in a box.", "777", "Sample Booster Box", "Sample Set C"]);
    // Another device changes its set meanwhile: the first Save is refused (409), and Save again keeps that set and the picture.
    await openEdit("target:44444444");
    await page.fill("#ie-name", "Sample Booster Box, Second Print");
    W.items = W.items.map((x) => (x.sku === "44444444" ? Object.assign({}, x, { set: "Sample Set D" }) : x)); W.rev++;
    n = W.puts.length;
    await page.click("#ie-save");
    await toastSays(/The list changed on another device\. Here it is now; make your change again\./);
    await page.waitForFunction(() => { const b = document.querySelector("#ie-save"); return b && !b.disabled && b.textContent === "Save"; });
    assert.equal(W.puts[n].rev, 32);
    await page.click("#ie-save");
    await closed();
    assert.equal(W.puts[n + 1].rev, 33);
    it = W.items.find((x) => x.sku === "44444444");
    assert.deepEqual([it.name, it.set, it.tcg, it.about], ["Sample Booster Box, Second Print", "Sample Set D", "777", "Thirty-six sample packs in a box."]);
  });

  await test("Edit takes a copied picture pasted anywhere in it, but a cell copied from a spreadsheet pastes as its text", async () => {
    await openEdit("target:33333333");
    // As Excel copies a cell: its text, a table and a picture of the cell; then a copied picture alone.
    const paste = (cell) => ev(({ b64, cell }) => {
      const dt = new DataTransfer();
      if (cell) { dt.items.add("Sample Tin From A Sheet", "text/plain"); dt.items.add("<table><tr><td>Sample Tin From A Sheet</td></tr></table>", "text/html"); }
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "copied.png", { type: "image/png" }));
      const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector("#ie-name").dispatchEvent(e);
      return e.defaultPrevented;
    }, { b64: PNG.toString("base64"), cell });
    const say = () => page.$eval("#ie-say", (e) => e.textContent);
    const was = await say();
    assert.equal(await paste(true), false, "left to paste as text");
    await sleep(300);
    assert.equal(await say(), was, "no picture taken from it");
    assert.equal(await paste(false), true, "a copied picture is taken");
    await page.waitForFunction(() => /ready to save/.test(document.querySelector("#ie-say").textContent));
    await page.click("#layers [data-close]");
    await closed();
  });

  await test("one save at a time: Edit's Save waits for one under way and goes onto the list it left; a press that can't wait is told", async () => {
    await reset(BASE(), 40);
    await openEdit("target:44444444");
    await page.fill("#ie-about", "Thirty-six sample packs.");
    let release; W.putHold = new Promise((r) => { release = r; });
    const n = W.puts.length;
    await startOwn("33333333", { name: "Sample Tin, Third Print" });
    await waitFor(() => W.puts.length === n + 1, "the first save");
    // A save that doesn't wait for it says so, where it said nothing.
    assert.equal(await saveOwn("33333333", { about: "Not saved." }, false), false);
    await toastSays(/Another change to the list is still saving\. Try again in a moment\./);
    await page.click("#ie-save");
    assert.equal(await page.$eval("#ie-save", (e) => e.textContent), "Saving…");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "nothing else sent while the first is out");
    release(); W.putHold = null;
    await closed();
    assert.equal(await ev(() => window.__bg), true);
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [40, 41], "the second went with the revision the first left");
    assert.equal(W.items.find((it) => it.sku === "33333333").name, "Sample Tin, Third Print");
    assert.equal(W.items.find((it) => it.sku === "33333333").about, "Three sample packs in a tin.");
    assert.equal(W.items.find((it) => it.sku === "44444444").about, "Thirty-six sample packs.");
  });

  await test("the pictures Add products finds wait for a save under way, then go onto the list it left", async () => {
    await reset(BASE().concat([{ sku: "66666666", store: "target", name: "Sample Mini Tin", about: "", set: "Sample Set C", pic: "", tcg: "" }]), 50);
    let release; W.putHold = new Promise((r) => { release = r; });
    const n = W.puts.length, finds = W.finds.length;
    await startOwn("100-10001", { about: "A sample Pokémon Center box." });
    await waitFor(() => W.puts.length === n + 1, "the first save");
    await ev(() => { window.__fp = window.__t.interestFindPics(["target:66666666"]); });
    await waitFor(() => W.finds.length === finds + 1, "the lookup");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "its save waits");
    release(); W.putHold = null;
    await ev(() => window.__fp);
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [50, 51]);
    assert.equal(W.items.find((it) => it.sku === "66666666").tcg, "555");
    assert.equal(W.items.find((it) => it.sku === "100-10001").about, "A sample Pokémon Center box.");
    await toastSays(/Found a picture on TCGplayer\./);
  });

  await test("Add products and Remove pressed while a save is out go after it, onto the list it left; Add or Edit closed meanwhile saves nothing", async () => {
    await reset(BASE(), 80);
    // Add products open, then a save of this FAFO's own goes out and is slow: Add waits for it, then goes.
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "73333333");   // a SKU alone: no TCGplayer lookup after
    let release; W.putHold = new Promise((r) => { release = r; });
    let n = W.puts.length;
    await startOwn("33333333", { name: "Sample Tin, Fifth Print" });
    await waitFor(() => W.puts.length === n + 1, "the first save");
    await page.click("#ia-go");
    assert.equal(await page.$eval("#ia-go", (e) => e.textContent), "Adding…");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "Add waits for it");
    release(); W.putHold = null;
    await page.waitForFunction(() => !document.querySelector("#ia-lines"));
    assert.equal(await ev(() => window.__bg), true);
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [80, 81], "with the revision the first left");
    assert.ok(W.items.some((it) => it.sku === "73333333" && it.name === "SKU 73333333"));
    assert.equal(W.items.find((it) => it.sku === "33333333").name, "Sample Tin, Fifth Print");
    await toastSays(/Added 1 product/);
    // Remove: a save goes out while its question is open, and Remove waits for it.
    await page.click('#main [data-act="interest-remove"][data-id="target:11111111"]');
    await page.waitForSelector("#cf-go");
    W.putHold = new Promise((r) => { release = r; });
    n = W.puts.length;
    await startOwn("33333333", { about: "Three sample packs, fifth print." });
    await waitFor(() => W.puts.length === n + 1, "the save");
    await page.click("#cf-go");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "Remove waits for it");
    release(); W.putHold = null;
    await toastSays(/Removed from the list/);
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [82, 83]);
    assert.ok(!W.items.some((it) => it.sku === "11111111"));
    assert.equal(W.items.find((it) => it.sku === "33333333").about, "Three sample packs, fifth print.");
    assert.doesNotMatch(await lastToast(), /still saving|another device/);
    // Add products closed while it waits: nothing is added once that save is done.
    await ev(() => { document.querySelector("#toasts").innerHTML = ""; });
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "74444444");
    W.putHold = new Promise((r) => { release = r; });
    n = W.puts.length;
    await startOwn("33333333", { name: "Sample Tin, Sixth Print" });
    await waitFor(() => W.puts.length === n + 1, "the save");
    await page.click("#ia-go");
    await page.click("#layers .panel-foot [data-close]");
    release(); W.putHold = null;
    assert.equal(await ev(() => window.__bg), true);
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "nothing more sent");
    assert.ok(!W.items.some((it) => it.sku === "74444444"));
    assert.doesNotMatch(await lastToast(), /still saving|another device|Added/);
    // Edit closed while its Save waits: nothing is saved once that save is done (its window is still fading out then).
    await sleep(300);
    await openEdit("target:22222222");
    await page.fill("#ie-about", "Not to be saved.");
    W.putHold = new Promise((r) => { release = r; });
    n = W.puts.length;
    await startOwn("33333333", { name: "Sample Tin, Seventh Print" });
    await waitFor(() => W.puts.length === n + 1, "the save");
    await page.click("#ie-save");
    assert.equal(await page.$eval("#ie-save", (e) => e.textContent), "Saving…");
    await page.click("#layers .panel-foot [data-close]");
    release(); W.putHold = null;
    assert.equal(await ev(() => window.__bg), true);
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "nothing more sent");
    assert.equal(W.items.find((it) => it.sku === "22222222").about, "Nine sample packs and sleeves.");
    assert.doesNotMatch(await lastToast(), /still saving|another device|Saved/);
  });

  await test("two waiting for a save out both go, one after the other: the pictures Add products found and Edit's Save, either way round", async () => {
    const MINI = () => BASE().concat([{ sku: "66666666", store: "target", name: "Sample Mini Tin", about: "", set: "Sample Set C", pic: "", tcg: "" }]);
    await reset(MINI(), 90);
    // Edit with a picture chosen: the picture goes up while the save is out, then its Save waits, after the pictures found.
    await openEdit("target:44444444");
    await page.fill("#ie-about", "Thirty-six sample packs, again.");
    await page.setInputFiles("#ie-file", { name: "box.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(() => /ready to save/.test(document.querySelector("#ie-say").textContent));
    let release; W.putHold = new Promise((r) => { release = r; });
    let n = W.puts.length, finds = W.finds.length;
    const posts = W.picPosts.length;
    await startOwn("100-10001", { about: "A sample Pokémon Center box, again." });
    await waitFor(() => W.puts.length === n + 1, "the first save");
    await ev(() => { window.__fp = window.__t.interestFindPics(["target:66666666"]); });
    await waitFor(() => W.finds.length === finds + 1, "the lookup");
    await sleep(200);
    await page.click("#ie-save");
    await waitFor(() => W.picPosts.length === posts + 1, "the picture, up while the save is out");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "both wait");
    release(); W.putHold = null;
    await ev(() => window.__fp);
    await closed();
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [90, 91, 92]);
    let it = W.items.find((x) => x.sku === "44444444");
    assert.deepEqual([it.about, it.pic], ["Thirty-six sample packs, again.", "h" + "b".repeat(32)]);
    assert.equal(W.items.find((x) => x.sku === "66666666").tcg, "555");
    assert.equal(W.items.find((x) => x.sku === "100-10001").about, "A sample Pokémon Center box, again.");
    await toastSays(/Found a picture on TCGplayer\./);
    await toastSays(/Saved/);
    assert.doesNotMatch(await lastToast(), /still saving|Couldn't save|another device/);
    // The other way round: Edit's Save waits first, then the pictures found.
    await reset(MINI(), 95);
    await openEdit("target:44444444");
    await page.fill("#ie-name", "Sample Booster Box, Third Print");
    W.putHold = new Promise((r) => { release = r; });
    n = W.puts.length; finds = W.finds.length;
    await startOwn("100-10001", { about: "A sample Pokémon Center box, once more." });
    await waitFor(() => W.puts.length === n + 1, "the first save");
    await page.click("#ie-save");
    await sleep(200);
    await ev(() => { window.__fp = window.__t.interestFindPics(["target:66666666"]); });
    await waitFor(() => W.finds.length === finds + 1, "the lookup");
    await sleep(400);
    assert.equal(W.puts.length, n + 1, "both wait");
    release(); W.putHold = null;
    await ev(() => window.__fp);
    await closed();
    assert.deepEqual(W.puts.slice(n).map((b) => b.rev), [95, 96, 97]);
    it = W.items.find((x) => x.sku === "44444444");
    assert.deepEqual([it.name, it.about], ["Sample Booster Box, Third Print", ""]);
    assert.equal(W.items.find((x) => x.sku === "66666666").tcg, "555");
    assert.equal(W.items.find((x) => x.sku === "100-10001").about, "A sample Pokémon Center box, once more.");
    await toastSays(/Found a picture on TCGplayer\./);
    assert.doesNotMatch(await lastToast(), /still saving|Couldn't save|another device/);
  });

  await test("a refresh read before a save but answered after it doesn't put the older list back; none starts while a save is out", async () => {
    await reset(BASE(), 60);
    let release; W.hold = new Promise((r) => { release = r; });
    const asked = W.gets.length;
    await ev(() => { window.__r = window.__t.refreshInterests(true); });
    await waitFor(() => W.gets.length === asked + 1, "the ask");   // read as revision 60, its answer held
    assert.equal(W.gets[asked], "?rev=60");
    assert.equal(await saveOwn("33333333", { name: "Sample Tin, Fourth Print" }), true);
    release(); W.hold = null;
    await ev(() => window.__r);
    const L = await ev(() => window.__t.interestRead());
    assert.equal(L.rev, 61, "the list the save left");
    assert.ok(L.items.some((it) => it.name === "Sample Tin, Fourth Print"));
    assert.ok((await cards()).includes("Sample Tin, Fourth Print"));
    // While a save is out, a refresh doesn't start.
    let free; W.putHold = new Promise((r) => { free = r; });
    const n = W.puts.length, gets = W.gets.length;
    await startOwn("33333333", { about: "Three sample packs." });
    await waitFor(() => W.puts.length === n + 1, "the save");
    await ev(() => window.__t.refreshInterests(true));
    assert.equal(W.gets.length, gets, "no ask while the save is out");
    free(); W.putHold = null;
    assert.equal(await ev(() => window.__bg), true);
    assert.equal(await ev(() => window.__t.interestRead().rev), 62);
  });

  await test("after Add products it looks up the first 8, then says what it found and what's left for Edit's Find on TCGplayer", async () => {
    await reset(BASE(), 70);
    const finds = W.finds.length;
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    assert.match(await page.$eval("#layers", (e) => e.textContent), /looks up the first 8 on TCGplayer for their pictures; each one's Edit has Find on TCGplayer for the rest\./);
    await page.fill("#ia-lines", Array.from({ length: 10 }, (_, i) => `7000000${i} Sample Pack ${i + 1}`).join("\n"));
    await page.click("#ia-go");
    await toastSays(/Found no pictures on TCGplayer\. 2 more weren't looked up: use Edit → Find on TCGplayer\./);
    assert.equal(W.finds.length - finds, 8, "a few, to keep the day's lookups");
    // The catalog still being read stops them for now, and it says to try again in a minute.
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "71111111 Sample Loading Box\n71111112 Sample Mini Tin");
    await page.click("#ia-go");
    await toastSays(/TCGplayer's catalog is still loading: try Find on TCGplayer in a minute\./);
    assert.equal(W.finds.length - finds, 9, "stopped at the first");
    assert.equal(W.items.find((it) => it.sku === "71111112").tcg, "", "not looked up");
    // The first lookup failing: none was looked up, and it says so (not "2 more").
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "72222221 Sample Broken Box\n72222222 Sample Mini Tin");
    await page.click("#ia-go");
    await toastSays(/2 products weren't looked up: use Edit → Find on TCGplayer\./);
    assert.equal(W.finds.length - finds, 10, "stopped at the first");
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out waiting for " + what); await new Promise((r) => setTimeout(r, 50)); }
}

console.log(`${passed} passed`);
