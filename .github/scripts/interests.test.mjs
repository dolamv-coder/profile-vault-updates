// Tests Interests in the newest page (index-X.Y.Z.html), from 1.9.142: the products the seller lists on the license worker for
// buyers to tick, which each batch Submit sends takes with it (the owner's request, 2026-11-12). The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, against a pretend license worker: a vault made with Use this browser
// only, then a license key kept as Submit keeps one typed there. It checks where the tab is, the cards, ticks and their sync
// setting, Tick all, the search, the list kept on this device, what Submit sends, and the seller's own editing (Add products,
// Edit with a picture, and a save another device beat). Then what the review of 1.9.142 found: names read from Target's
// links, every tick sent whatever the copy here, one section for Other, Edit's Save over a save it didn't see, a paste from a
// spreadsheet, one save at a time, a refresh answered after a save, and what the TCGplayer lookups after Add say. And what
// its second review found: a count in a Target link stays a count, a 401 empties the list here, Add products and Remove
// wait for a save out, Add products or Edit closed while it waits saves nothing, and two waiting both save. From 1.9.143,
// Add products reads a drop list as a restock tracker writes it (the owner's request, 2026-11-12, with the list of 24 they
// pasted, used here as they sent it): each name over its SKU line, the tracker's tags and Retail, QL and Stock left out,
// each product in the set on the list its name has, and the TCGplayer lookups after Add for the first 20. And what the
// review of 1.9.143 found: a SKU line over its name, a name on the SKU line, a set's own products keeping "Mega Evolution",
// a set of a series before the series, a name starting with a number and no SKU line, and the preview shown. Sample names,
// SKUs and keys only, but for the owner's drop list (public products, as on the worker's seed list). From 1.9.155 (the owner's
// request, 2026-11-17: "Revamp Interests Tab. Include a submit button in Interests…"), the revamped view (the counts strip,
// the store filter, the cards' parts, the picked edge) and its bar's Send to seller: what POST /interests/send gets, the bar's
// states (not sent, sent, changed since sent, nothing picked), the signature it shares with the worker (the kept picks'
// canonical JSON's SHA-256), the synced setting interestSent and the worker's sent, every refusal kept apart from the ticks,
// one send at a time, a lock mid-send, the seller's own FAFO with no bar, and a phone, where nothing covers the bar.
//   node .github/scripts/interests.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have Interests, drop lists (interestsFromText) and Send to seller (interestsSend); a page named on
// the command line that doesn't is skipped, or tested without them.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
const HAS_DROP = /function interestsFromText\(/.test(HTML);
if (!HAS_DROP && !process.argv[2]) { console.error(`${file} has no drop lists in Add products (interestsFromText): update this test if that's on purpose`); process.exit(1); }
const HAS_SEND = /async function interestsSend\(/.test(HTML);
if (!HAS_SEND && !process.argv[2]) { console.error(`${file} has no Send to seller on Interests (interestsSend): update this test if that's on purpose`); process.exit(1); }
// How many new products Add products looks up on TCGplayer (8 in 1.9.142, 20 from 1.9.143).
const FIND_MAX = Number((/\bconst INTEREST_FIND_MAX = (\d+);/.exec(HTML) || [])[1]);
assert.ok(FIND_MAX > 0, "couldn't find INTEREST_FIND_MAX");
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t), as the
// page's other tests take its code out of the file.
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, refreshInterests, interestRead, interestsFor, premiumHash, slotKey,"
  + " INTEREST, interestKeep, interestsSave, interestFindPics, interestFromLine" + (HAS_DROP ? ", interestsFromText, interestDropName, interestSetFor" : "")
  + (HAS_SEND ? ", interestsSend, interestSendState, interestSha256, interestPicksSig, interestKept, get UI(){ return UI; }" : "") + "};" + END);
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
const W = { rev: 3, items: LIST(), owner: false, gets: [], puts: [], picPosts: [], picGets: [], finds: [], subs: [],
  // Send to seller (1.9.155): what POST /interests/send got, what it posted, its last send ({at, sig}) and the day's count.
  sendBodies: [], sendAuth: [], posts: [], sent: null, sentOnSame: true, sendN: 0, sendStatus: 0, sendHold: null, sendAbort: false };
// The worker's own rule (POST /interests/send): the SKUs on the list at their store, in its order; stores sorted, none
// left out but those with no picks; the signature the first 16 hex of the SHA-256 of that JSON.
const keptOf = (interests) => {
  const by = {}, o = {};
  W.items.forEach((it) => { const a = interests && Array.isArray(interests[it.store]) ? interests[it.store] : null; if (a && a.includes(it.sku)) (by[it.store] = by[it.store] || []).push(it.sku); });
  Object.keys(by).sort().forEach((k) => { o[k] = by[k]; });
  return o;
};
const sigOf = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
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
    // The buyer's last send (1.9.155), in a same answer too unless sentOnSame is off (a worker that leaves it out there).
    if (!W.owner && (!body.same || W.sentOnSame)) body.sent = W.sent;
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
  if (p === "/interests/send" && m === "POST") {
    W.sendAuth.push(auth);
    const b = JSON.parse(req.postData()); W.sendBodies.push(b);
    if (W.sendHold) await W.sendHold;
    if (W.sendAbort) { W.sendAbort = false; return route.abort("internetdisconnected"); }
    if (W.sendStatus) { const s = W.sendStatus; W.sendStatus = 0; return json(route, s, s === 429 ? { error: "limit", limit: 20 } : s === 502 ? { error: "discord" } : { error: "refused" }); }
    if (W.owner) return json(route, 403, { error: "your own FAFO keeps the list" });
    const kept = keptOf(b.interests), sig = sigOf(kept);
    if (W.sent && W.sent.sig === sig) return json(route, 200, { ok: true, same: true, at: W.sent.at, sig });
    W.sendN++; W.sent = { at: Date.now(), sig };
    W.posts.push({ name: b.name, kept });
    const counts = {}; Object.keys(kept).forEach((k) => { counts[k] = kept[k].length; });
    return json(route, 200, { ok: true, at: W.sent.at, counts, sig });
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
// The setup guide (1.9.145) doesn't ask here (Not now, until far ahead): its own test is walkthrough.test.mjs.
await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });
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
    assert.match(first.text, /SKU 11111111/); assert.match(first.text, /Six sample booster packs\./);
    assert.match(first.text, HAS_SEND ? /Sample Set A · SKU 11111111/ : /Run this on my profiles/);
    assert.equal(first.img, "https://license.fafoaco.com/interests/pic/t111");
    await page.waitForFunction(() => { const i = document.querySelector("#main .int-card img"); return i && i.complete && i.naturalWidth > 0; });
    assert.equal(await page.$eval("#main .int-card:nth-child(2) img", (e) => e.getAttribute("src")), "https://license.fafoaco.com/interests/pic/h" + "a".repeat(32));
    // No picture: the store's mark in its frame.
    assert.equal(await page.$$eval("#main .int-card", (els) => els[2].querySelector(".int-pic").className), "int-pic is-broken");
    assert.equal(await page.$$eval("#main .int-card", (els) => els[2].querySelectorAll("img").length), 0);
    assert.equal(await page.locator('[data-act="interests-edit"]').count(), 0, "no Edit list for a buyer");
    assert.equal(await page.locator('[data-act="interest-edit"]').count(), 0);
    assert.match(await page.$eval("#main .p-kpis", (e) => e.textContent), HAS_SEND ? /^Products 4\s*Picked 0\s*Sets 2\s*Last sent Never$/ : /Products 4.*Ticked 0/);
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
    assert.match(await page.$eval("#main .int-set", (e) => e.textContent), HAS_SEND ? /2 of 2 picked/ : /2 of 2 ticked/);
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
    if (HAS_SEND) assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /you submit\. To send them without submitting, use Send to seller on Interests\./);
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
    if (HAS_SEND) assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /To send it without submitting, use Send to seller on Interests\./);
  });

  // ---- Send to seller (1.9.155): the revamped view and its bar ----
  if (HAS_SEND) {
    const bar = () => page.$eval("#main .int-bar", (e) => ({ ttl: e.querySelector(".int-bar-ttl").textContent, st: e.querySelector(".int-bar-st").textContent.trim(),
      btn: e.querySelector("#int-send").textContent.trim(), off: e.querySelector("#int-send").getAttribute("aria-disabled") === "true" }));
    const kpis = () => page.$eval("#main .p-kpis", (e) => e.textContent);
    const sentKpi = () => page.$eval("#main .int-kpi-sent", (e) => ({ text: e.textContent, dot: e.querySelector(".p-kpi-dot").getAttribute("style") }));
    const pick = (key, on) => (on ? page.check : page.uncheck).call(page, `#main input[data-act="interest-pick"][data-id="${key}"]`);
    const setting = () => ev(() => window.__t.S.settings.interestSent || null);
    const toastHas = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#toasts").textContent), re.source);
    const clearToasts = () => ev(() => { document.querySelector("#toasts").innerHTML = ""; });
    const segs = () => page.$$eval("#main .int-storeseg button", (els) => els.map((e) => [e.textContent, e.getAttribute("aria-pressed")]));
    const setText = (title) => page.$$eval("#main .int-set", (els, t) => { const e = els.find((x) => x.querySelector(".sub-title").textContent === t); return e ? e.querySelector(".int-set-n").textContent : null; }, title);

    await test("the page's SHA-256 is node's, and a signature is the first 16 hex of the kept picks' JSON, as the worker's", async () => {
      const strs = ["", "{}", "a", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(119), "x".repeat(120), "y".repeat(1000),
        '{"pokemoncenter":["100-10001"],"target":["11111111","33333333"]}', "Pokémon é ✓ 😀 \u0000 \n"];
      for (const str of strs) assert.equal(await ev((x) => window.__t.interestSha256(x), str), createHash("sha256").update(str).digest("hex"), JSON.stringify(str).slice(0, 40));
      assert.equal(await ev(() => window.__t.interestPicksSig({})), sigOf({}));
      assert.equal(sigOf({}), createHash("sha256").update("{}").digest("hex").slice(0, 16));
      // The kept picks: on the list at their store, in its order, stores sorted, those with none left out.
      const kept = await ev(() => { const T = window.__t, S = T.S, was = S.settings.interestPicks;
        S.settings.interestPicks = { "target:33333333": { on: true, at: 1 }, "pokemoncenter:100-10001": { on: true, at: 1 }, "target:11111111": { on: true, at: 1 },
          "target:22222222": { on: false, at: 1 }, "target:99999999": { on: true, at: 1 } };
        const r = [T.interestKept(T.interestRead()), T.interestSendState().sig]; S.settings.interestPicks = was; return r; });
      assert.equal(JSON.stringify(kept[0]), '{"pokemoncenter":["100-10001"],"target":["11111111","33333333"]}');
      assert.equal(kept[1], sigOf(keptOf({ target: ["33333333", "11111111", "99999999"], pokemoncenter: ["100-10001"] })));
    });

    await test("the revamped view: a store filter, each card's parts, Tick all on what's shown, and a picked card's --info edge", async () => {
      await ev(() => { const T = window.__t; T.S.settings.interestPicks = {}; T.persist(); T.render(); });
      await page.click('#side [data-id="interests"]');
      await page.waitForSelector("#main .int-bar");
      assert.deepEqual(await segs(), [["All", "true"], ["Target", "false"], ["Pokémon Center", "false"]]);
      // A card: the store's mark by its name, "Set · SKU", what it is (three lines at most, all of it as its title) and Run this.
      const c = await page.$eval("#main .int-card", (e) => ({ mark: !!e.querySelector(".int-top .smark"), sku: e.querySelector(".int-sku").textContent,
        about: e.querySelector(".int-about").getAttribute("title"), clamp: getComputedStyle(e.querySelector(".int-about")).webkitLineClamp,
        run: e.querySelector("label.check.int-run").textContent.trim(), box: e.querySelector('label.check input[type="checkbox"][data-act="interest-pick"]') !== null }));
      assert.deepEqual(c, { mark: true, sku: "Target, Sample Set A · SKU 11111111", about: "Six sample booster packs.", clamp: "3", run: "Run this", box: true });
      assert.equal(await page.$$eval("#main .int-card", (els) => els[3].querySelector(".int-sku").textContent), "Pokémon Center, Sample Set B · SKU 100-10001");
      // Target only: its three cards; Tick all in Sample Set B ticks the Target one shown, not Pokémon Center's.
      await page.click('#main .int-storeseg [data-id="target"]');
      assert.deepEqual(await segs(), [["All", "false"], ["Target", "true"], ["Pokémon Center", "false"]]);
      assert.deepEqual(await cards(), ["Sample Booster Bundle", "Sample Elite Box", "Sample Tin"]);
      await page.check('#main input[data-act="interest-set"][data-id="Sample Set B"]');
      let p = await picks();
      assert.equal(p["target:33333333"].on, true);
      assert.ok(!p["pokemoncenter:100-10001"], "the one the filter hides isn't ticked");
      assert.equal(await setText("Sample Set B"), "1 of 1 picked", "counted at the store shown");
      await page.fill("#q", "center");
      assert.match(await page.$eval("#main", (e) => e.textContent), /No products match "center" at Target\./);
      await page.fill("#q", "");
      await page.click('#main .int-storeseg [data-id="pokemoncenter"]');
      assert.deepEqual(await cards(), ["Sample Center Box"]);
      await page.click('#main .int-storeseg [data-id="all"]');
      assert.equal((await cards()).length, 4);
      assert.equal(await setText("Sample Set B"), "1 of 2 picked");
      // A picked card's edge is --info; another's is the line's.
      const edge = await page.$$eval("#main .int-card", (els) => {
        const probe = document.createElement("div"); probe.style.color = "color-mix(in srgb, var(--info) 85%, transparent)"; document.body.appendChild(probe);
        const want = getComputedStyle(probe).color; probe.remove();
        return { on: [els[2].classList.contains("is-on"), getComputedStyle(els[2]).borderTopColor], off: [els[0].classList.contains("is-on"), getComputedStyle(els[0]).borderTopColor], want };
      });
      assert.deepEqual(edge.on, [true, edge.want]);
      assert.equal(edge.off[0], false); assert.notEqual(edge.off[1], edge.want);
      // Switching views puts the filter back on All.
      await page.click('#side [data-id="submit"]'); await page.click('#side [data-id="interests"]');
      assert.deepEqual((await segs())[0], ["All", "true"]);
    });

    await test("the bar: nothing picked, then picked and not sent; Send to seller sends every store's picks with the name, and then the seller has them", async () => {
      await ev(() => { const T = window.__t; T.S.settings.interestPicks = {}; T.persist(); T.render(); });
      assert.equal(W.sent, null); assert.equal(await setting(), null);
      assert.deepEqual(await bar(), { ttl: "Nothing picked", st: "Tick Run this on the products you'd like your seller to run.", btn: "Send to seller", off: true });
      assert.match(await kpis(), /^Products 4\s*Picked 0\s*Sets 2\s*Last sent Never$/);
      await pick("target:11111111", true); await pick("target:33333333", true); await pick("pokemoncenter:100-10001", true);
      assert.deepEqual(await bar(), { ttl: "3 picked · Target 2 · Pokémon Center 1", st: "Not sent yet.", btn: "Send 3 picks", off: false });
      assert.match(await kpis(), /Picked 3/);
      // Ticked on another device, but not on the list kept here: sent (the worker keeps only its list's), never counted.
      await ev(() => { const T = window.__t; T.S.settings.interestPicks = Object.assign({}, T.S.settings.interestPicks, { "target:99999999": { on: true, at: Date.now() } }); T.persist(); T.render(); });
      assert.equal((await bar()).ttl, "3 picked · Target 2 · Pokémon Center 1");
      const name = await ev(() => window.__t.S.submitName);
      assert.equal(name, "Sam", "the name typed in Submit's window");
      await clearToasts();
      await page.click("#int-send");
      await toastHas(/Sent your picks to your seller/);
      assert.equal(W.sendBodies.length, 1);
      assert.deepEqual(W.sendBodies[0], { interests: { target: ["11111111", "33333333", "99999999"], pokemoncenter: ["100-10001"] }, name: "Sam" });
      assert.deepEqual(Object.keys(W.sendBodies[0].interests), ["target", "pokemoncenter"]);
      assert.equal(W.sendAuth[0], "Bearer " + LIC);
      assert.deepEqual(W.posts[0].kept, { pokemoncenter: ["100-10001"], target: ["11111111", "33333333"] });
      assert.deepEqual(await setting(), { at: W.sent.at, sig: W.sent.sig }, "kept in the synced setting, with the worker's time and signature");
      await page.waitForFunction(() => document.querySelector("#int-send") && document.querySelector("#int-send").getAttribute("aria-disabled") === "true");
      assert.deepEqual(await bar(), { ttl: "3 picked · Target 2 · Pokémon Center 1", st: "Your seller has these picks, sent just now.", btn: "Sent", off: true });
      assert.deepEqual(await sentKpi(), { text: "Last sent just now", dot: "background:var(--ok)" });
      assert.equal(W.subs.length, 1, "no batch of slots went");
    });

    await test("changed since sent, back to what was sent, then Send update; a send the worker already has says so and posts nothing", async () => {
      await pick("target:33333333", false);
      assert.deepEqual(await bar(), { ttl: "2 picked · Target 1 · Pokémon Center 1", st: "Changed since you last sent (just now).", btn: "Send update", off: false });
      assert.deepEqual(await sentKpi(), { text: "Last sent Changed since sent", dot: "background:var(--caution)" });
      await pick("target:33333333", true);
      assert.deepEqual(await bar(), { ttl: "3 picked · Target 2 · Pokémon Center 1", st: "Your seller has these picks, sent just now.", btn: "Sent", off: true });
      await pick("target:33333333", false);
      await clearToasts();
      // From the keyboard: the focus stays on the button while it sends and once it's sent, and Enter on Sent sends nothing.
      await page.focus("#int-send");
      await page.keyboard.press("Enter");
      await toastHas(/Sent your picks to your seller/);
      assert.equal(W.posts.length, 2);
      assert.deepEqual(W.posts[1].kept, { pokemoncenter: ["100-10001"], target: ["11111111"] });
      assert.equal((await bar()).btn, "Sent");
      assert.equal(await ev(() => document.activeElement && document.activeElement.id), "int-send");
      const asked = W.sendBodies.length;
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(W.sendBodies.length, asked, "Sent sends nothing");
      // This vault says another send (a device's that the worker never had): the worker answers same, posting nothing.
      const posts = W.posts.length;
      await ev(() => { const T = window.__t; T.S.settings.interestSent = { at: Date.now(), sig: "0123456789abcdef" }; T.persist(); T.render(); });
      assert.equal((await bar()).btn, "Send update");
      await clearToasts();
      await page.click("#int-send");
      await toastHas(/Your seller already has these picks/);
      assert.equal(W.posts.length, posts, "nothing posted");
      assert.deepEqual(await setting(), { at: W.sent.at, sig: W.sent.sig });
      assert.equal((await bar()).btn, "Sent");
    });

    await test("every device knows: GET /interests's sent, newer than this vault's, decides what the bar says; a same answer without it keeps the last", async () => {
      const now = await ev(() => Date.now()), mine = await ev(() => window.__t.interestSendState().sig);
      await ev((at) => { const T = window.__t; T.S.settings.interestSent = { at, sig: T.interestSendState().sig }; T.persist(); }, now - 10 * 60000);
      W.sent = { at: now - 3 * 60000, sig: sigOf({ target: ["11111111"] }) };
      await ev(() => window.__t.refreshInterests(true, true));
      await page.waitForFunction(() => /Changed since/.test(document.querySelector("#main .int-bar-st").textContent));
      assert.deepEqual(await bar(), { ttl: "2 picked · Target 1 · Pokémon Center 1", st: "Changed since you last sent (3 min ago).", btn: "Send update", off: false });
      assert.deepEqual(JSON.parse(await ev(() => localStorage.getItem("orbit-interests"))).sent, W.sent, "kept with the list");
      W.sent = { at: now - 2 * 60000, sig: mine };
      await ev(() => window.__t.refreshInterests(true, true));
      await page.waitForFunction(() => /seller has these/.test(document.querySelector("#main .int-bar-st").textContent));
      assert.deepEqual(await bar(), { ttl: "2 picked · Target 1 · Pokémon Center 1", st: "Your seller has these picks, sent 2 min ago.", btn: "Sent", off: true });
      assert.equal((await sentKpi()).text, "Last sent 2 min ago");
      // A same answer (the revision here) that doesn't say sent keeps the one kept; one that does moves it.
      W.sentOnSame = false;
      const asked = W.gets.length;
      await ev(() => window.__t.refreshInterests(true));
      assert.equal(W.gets.at(-1), "?rev=3"); assert.equal(W.gets.length, asked + 1);
      assert.equal((await bar()).st, "Your seller has these picks, sent 2 min ago.");
      W.sentOnSame = true; W.sent = { at: now - 60000, sig: mine };
      await ev(() => window.__t.refreshInterests(true));
      await page.waitForFunction(() => /1 min ago/.test(document.querySelector("#main .int-bar-st").textContent));
      // Locked and unlocked, the bar says the same at once, from the list kept here.
      await page.click('[data-act="lock"]');
      await page.fill("#pw1", "sample-pass-142");
      await page.waitForSelector('#side [data-id="interests"]', { timeout: 30000 });
      if (!(await page.locator("#main .int-bar").count())) await page.click('#side [data-id="interests"]');
      assert.equal((await bar()).st, "Your seller has these picks, sent 1 min ago.");
    });

    await test("a refusal or no connection says why, and keeps the ticks and the last send; one send at a time", async () => {
      await page.waitForFunction(() => !window.__t.INTEREST.busy);
      await pick("target:33333333", true);
      const before = [await picks(), await setting()];
      for (const [s, re] of [[429, /^That's 20 sends today\. Your ticks are kept: send them tomorrow, or they go with the next slots you submit\./],
        [401, /^Your license wasn't recognized, so your picks weren't sent\./], [403, /^Your own FAFO keeps the list: buyers send their picks from theirs\./],
        [503, /^The license server can't check your key just now\. Your ticks are kept: try again in a few minutes\./],
        [502, /^Your seller's Discord didn't take them just now\. Your ticks are kept: try again in a minute\./],
        [404, /^The license server can't take picks on their own yet\. They go with the next slots you submit\./],
        [500, /^The license server couldn't send them just now\. Your ticks are kept: try again\./], ["net", /^Couldn't reach the license server\. Your ticks are kept: check your connection and try again\./]]) {
        await clearToasts();
        const n = W.sendBodies.length;
        if (s === "net") W.sendAbort = true; else W.sendStatus = s;
        await page.click("#int-send");
        await toastHas(re);
        assert.equal(W.sendBodies.length, n + 1);
        assert.deepEqual([await picks(), await setting()], before, String(s));
        await page.waitForFunction(() => { const b = document.querySelector("#int-send"); return b && !b.getAttribute("aria-disabled") && b.textContent.trim() === "Send update"; });
      }
      // One at a time: the button waits, and another press sends nothing.
      let release; W.sendHold = new Promise((r) => { release = r; });
      const n = W.sendBodies.length;
      await clearToasts();
      await page.click("#int-send");
      await waitFor(() => W.sendBodies.length === n + 1, "the send");
      assert.deepEqual(await bar(), { ttl: "3 picked · Target 2 · Pokémon Center 1", st: "Sending your picks to your seller…", btn: "Sending…", off: true });
      await ev(() => { window.__t.interestsSend(); window.__t.interestsSend(); });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(W.sendBodies.length, n + 1, "nothing else sent");
      release(); W.sendHold = null;
      await toastHas(/Sent your picks to your seller/);
      assert.equal((await bar()).btn, "Sent");
    });

    await test("locked while a send is out: nothing is written here, and the worker's sent says the seller has them", async () => {
      await pick("target:33333333", false);
      const before = await setting();
      let release; W.sendHold = new Promise((r) => { release = r; });
      const n = W.sendBodies.length;
      await page.click("#int-send");
      await waitFor(() => W.sendBodies.length === n + 1, "the send");
      await page.click('[data-act="lock"]');
      release(); W.sendHold = null;
      await waitFor(() => W.posts.length && W.sent && W.sent.sig === sigOf({ pokemoncenter: ["100-10001"], target: ["11111111"] }), "the post");
      await page.fill("#pw1", "sample-pass-142");
      await page.waitForSelector('#side [data-id="interests"]', { timeout: 30000 });
      if (!(await page.locator("#main .int-bar").count())) await page.click('#side [data-id="interests"]');
      assert.deepEqual(await setting(), before, "the vault locked meanwhile: nothing kept from that answer");
      await ev(() => window.__t.refreshInterests(true, true));
      await page.waitForFunction(() => /seller has these/.test(document.querySelector("#main .int-bar-st").textContent));
      assert.equal((await bar()).btn, "Sent");
    });

    await test("nothing picked after a send: Send update tells the seller they're cleared, then the bar says the seller knows", async () => {
      await pick("target:11111111", false); await pick("pokemoncenter:100-10001", false);
      assert.deepEqual((await bar()).ttl, "Nothing picked");
      assert.match((await bar()).st, /^Changed since you last sent \(/);
      assert.equal((await bar()).btn, "Send update");
      const posts = W.posts.length;
      await clearToasts();
      await page.click("#int-send");
      await toastHas(/Sent your picks to your seller/);
      assert.deepEqual(W.sendBodies.at(-1).interests, { target: ["99999999"] }, "a tick off the list here still goes; the worker drops it");
      assert.equal(W.posts.length, posts + 1); assert.deepEqual(W.posts.at(-1).kept, {});
      assert.deepEqual(await setting(), { at: W.sent.at, sig: sigOf({}) });
      assert.deepEqual(await bar(), { ttl: "Nothing picked", st: "Your seller knows you've picked nothing, sent just now.", btn: "Sent", off: true });
    });

    await test("with the worker's list ahead of the one here, the worker's signature is kept; once the list here catches up, the bar says Sent", async () => {
      // A product added on the worker since, ticked on another device (target:99999999, ticked earlier): it goes, and counts there.
      W.items = LIST().concat([{ sku: "99999999", store: "target", name: "Sample Extra Box", about: "", set: "Sample Set B", pic: "", tcg: "" }]); W.rev = 4;
      await pick("target:11111111", true);
      await clearToasts();
      await page.click("#int-send");
      await toastHas(/Sent your picks to your seller/);
      assert.deepEqual(W.posts.at(-1).kept, { target: ["11111111", "99999999"] });
      assert.deepEqual(await setting(), { at: W.sent.at, sig: sigOf({ target: ["11111111", "99999999"] }) }, "the worker's sig, not the one worked out here");
      assert.equal((await bar()).btn, "Send update", "the list here doesn't have it yet");
      await ev(() => window.__t.refreshInterests(true));
      await page.waitForFunction(() => /seller has these/.test(document.querySelector("#main .int-bar-st").textContent));
      assert.deepEqual(await bar(), { ttl: "2 picked · Target 2", st: "Your seller has these picks, sent just now.", btn: "Sent", off: true });
      // The list as it was, for the tests after.
      W.items = LIST(); W.rev = 3;
      await ev(() => window.__t.refreshInterests(true));
      await page.waitForFunction(() => window.__t.interestRead().rev === 3 && window.__t.interestRead().items.length === 4);
    });

    await test("on a phone (375 × 667): one card a row, the bar stuck to the bottom with its button the screen's width, nothing over it, and no sideways scroll", async () => {
      await pick("target:11111111", true);
      await page.setViewportSize({ width: 375, height: 667 });
      await ev(() => { window.__t.render(); window.scrollTo(0, 0); });
      await page.waitForSelector("#main .int-bar");
      const m = await page.evaluate(() => {
        const b = document.querySelector("#main .int-bar"), r = b.getBoundingClientRect(), btn = document.querySelector("#int-send").getBoundingClientRect();
        const at = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2), card = document.querySelector("#main .int-card");
        const cs = [...document.querySelectorAll("#main .int-card")].map((c) => Math.round(c.getBoundingClientRect().left));
        return { gap: Math.round(innerHeight - r.bottom), full: Math.round(btn.width) >= Math.round(r.width - 32), hit: !!(at && at.closest("#int-send")),
          row: getComputedStyle(card).flexDirection, lefts: [...new Set(cs)].length, wide: document.documentElement.scrollWidth - innerWidth };
      });
      assert.deepEqual(m, { gap: 12, full: true, hit: true, row: "row", lefts: 1, wide: 0 });
      // At the end of the page the last card is above the bar, where it can be ticked.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const end = await page.evaluate(() => {
        const cs = document.querySelectorAll("#main .int-card"), last = cs[cs.length - 1].querySelector("label.check").getBoundingClientRect(), b = document.querySelector("#main .int-bar").getBoundingClientRect();
        const at = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
        return { above: last.bottom <= b.top, hit: !!(at && at.closest("label.check")) };
      });
      assert.deepEqual(end, { above: true, hit: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await ev(() => window.scrollTo(0, 0));
    });

    await test("the setup guide sits above the bar (both at the window's bottom right), so neither covers the other", async () => {
      await page.click('#side [data-id="submit"]');
      await page.click('#main [data-act="guide-open"]');
      await page.click('#side [data-id="interests"]');
      await page.waitForSelector("#main .int-bar");
      await page.waitForFunction(() => { const g = document.querySelector("#guide"); return g && !g.hidden && g.getBoundingClientRect().height > 0; });
      const r = await page.evaluate(() => { const g = document.querySelector("#guide").getBoundingClientRect(), b = document.querySelector("#main .int-bar").getBoundingClientRect();
        return { over: g.left < b.right && g.right > b.left, above: g.bottom <= b.top, stuck: Math.round(innerHeight - b.bottom) }; });
      assert.deepEqual(r, { over: true, above: true, stuck: 12 });
      await page.click('#guide [data-act="guide-close"]');
      await page.waitForFunction(() => { const g = document.querySelector("#guide"); return !g || g.hidden || !g.getBoundingClientRect().height; });
      // Gone, the guide is put back down (no lift on other views either).
      await page.click('#side [data-id="submit"]');
      assert.equal(await ev(() => { const g = document.querySelector("#guide"); return g ? g.style.getPropertyValue("--guide-lift") : "0px"; }), "0px");
      await page.click('#side [data-id="interests"]');
    });
  }

  await test("the seller's own FAFO: Edit list, Add products saves with the list's revision, then finds TCGplayer pictures", async () => {
    W.owner = true;
    await page.click('#side [data-id="interests"]');
    await ev(() => window.__t.refreshInterests(true));
    await page.waitForSelector('#main [data-act="interests-edit"]');
    assert.equal(await page.$eval('#main [data-act="interests-edit"]', (e) => e.textContent), "Edit list");
    assert.deepEqual(W.gets.slice(-2), ["?rev=3", ""], "the same revision, now the seller's: the whole list, with its pictures' fields");
    assert.equal(await ev(() => window.__t.interestRead().items[0].tcg), "111");
    assert.ok((await cards()).length === 4 && await page.locator('#main input[data-act="interest-pick"]').count() === 4, "the seller sees the buyer's view too");
    if (HAS_SEND) {
      // No Send to seller on the seller's own FAFO (its picks would go to itself), and no Last sent.
      assert.equal(await page.locator("#main .int-bar, #int-send").count(), 0);
      assert.match(await page.$eval("#main .p-kpis", (e) => e.textContent), /^Products 4\s*Picked \d+\s*Sets 2$/);
      assert.match(await page.$eval("#main .view-sub", (e) => e.textContent), /Their picks come to your Discord channel when they press Send to seller/);
    }
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
    assert.match(await other(), HAS_SEND ? /0 of 2 picked/ : /0 of 2 ticked/);
    await page.check('#main input[data-act="interest-set"][data-id="Other"]');
    const p = await picks();
    assert.deepEqual([p["target:77777777"].on, p["target:88888888"].on], [true, true]);
    assert.match(await other(), HAS_SEND ? /2 of 2 picked/ : /2 of 2 ticked/);
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

  await test(`after Add products it looks up the first ${FIND_MAX}, then says what it found and what's left for Edit's Find on TCGplayer`, async () => {
    await reset(BASE(), 70);
    const finds = W.finds.length;
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    assert.match(await page.$eval("#layers", (e) => e.textContent), new RegExp(`looks up the first ${FIND_MAX} on TCGplayer for their pictures; each one's Edit has Find on TCGplayer for the rest\\.`));
    await page.fill("#ia-lines", Array.from({ length: FIND_MAX + 2 }, (_, i) => `${70000000 + i} Sample Pack ${i + 1}`).join("\n"));
    await page.click("#ia-go");
    await toastSays(/Found no pictures on TCGplayer\. 2 more weren't looked up: use Edit → Find on TCGplayer\./);
    assert.equal(W.finds.length - finds, FIND_MAX, "a few, to keep the day's lookups");
    // The catalog still being read stops them for now, and it says to try again in a minute.
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "71111111 Sample Loading Box\n71111112 Sample Mini Tin");
    await page.click("#ia-go");
    await toastSays(/TCGplayer's catalog is still loading: try Find on TCGplayer in a minute\./);
    assert.equal(W.finds.length - finds, FIND_MAX + 1, "stopped at the first");
    assert.equal(W.items.find((it) => it.sku === "71111112").tcg, "", "not looked up");
    // The first lookup failing: none was looked up, and it says so (not "2 more").
    await page.click('#main [data-act="interests-add"]');
    await focused("ia-lines");
    await page.fill("#ia-lines", "72222221 Sample Broken Box\n72222222 Sample Mini Tin");
    await page.click("#ia-go");
    await toastSays(/2 products weren't looked up: use Edit → Find on TCGplayer\./);
    assert.equal(W.finds.length - finds, FIND_MAX + 2, "stopped at the first");
  });

  // ---- Drop lists (1.9.143): the owner's list of 2026-11-12, as they pasted it from a restock tracker. ----
  if (HAS_DROP) {
    const DROP = `Pokémon TCG: Unova Heavy Hitters Premium Collection — New Drop
SKU: 1013645543
Retail: $79.99
QL: 2
Stock: New Launch

Pokémon TCG: 30th Celebration Binder Collection — New Drop
SKU: 1010892074
Retail: $39.99
QL: 2
Stock: New Launch

Pokémon TCG: 30th Celebration Big Tin 4-Pack — Styles May Vary — New Drop
SKU: 1012470483
Retail: $24.99
QL: 2
Stock: New Launch

Pokémon TCG: Mega Evolution — Delta Reign Booster Bundle
SKU: 1013166578
Retail: $31.99
Stock: 50k+

Pokémon TCG: Mega Evolution — Delta Reign Elite Trainer Box
SKU: 1012793604
Retail: $59.99
Stock: 50k+

Pokémon TCG: 30th Celebration Ultra-Premium Collection — Night
SKU: 1012850572
Retail: $249.99
QL: 1
Stock: 40k+

Pokémon TCG: 30th Celebration Ultra-Premium Collection — Day
SKU: 1012850570
Retail: $249.99
QL: 1
Stock: 40k+

Pokémon TCG: 30th Celebration Figure Collection — Mew
SKU: 1012793603
Stock: 31k+

Pokémon TCG: 30th Celebration Figure Collection — Mewtwo
SKU: 1012850573
Stock: 30k+

Pokémon TCG: Mega Evolution — Delta Reign Three-Booster Blister
SKU: 1013166573
Retail: $14.99
Stock: 10k+

Pokémon TCG: 30th Celebration Ditto Premium Collection
SKU: 1012663804
QL: 1
Stock: 5k+

Pokémon TCG: Mega Evolution Ascended Heroes Tech Sticker Collection — Gastly
SKU: 95120822
Stock: 2k+

Pokémon TCG: Mega Evolution — Delta Reign Booster Display
SKU: 1013166576
Retail: $179.99
Stock: 1k+

Pokémon TCG: 30th Celebration Battle Deck — Umbreon ex
SKU: 1010892071
Stock: 1k+

Pokémon TCG: Mega Evolution Ascended Heroes Poster Collection — Mega Gardevoir
SKU: 95093982
Stock: 1k+

Pokémon TCG: Mega Evolution Ascended Heroes Poster Collection — Mega Lucario
SKU: 95093981
Stock: 1k+

Pokémon TCG: First Partner Illustration Collection Series 1
SKU: 95225595
Stock: 1k+

Pokémon TCG: 30th Celebration Elite Trainer Box
SKU: 1010892076
Retail: $69.99
Stock: Recently Updated

Pokémon TCG: 30th Celebration — Greninja ex Box
SKU: 1010892065
Retail: $29.99
Stock: Recently Updated

Pokémon TCG: 30th Celebration — Sylveon ex Box
SKU: 1010892068
Retail: $29.99
Stock: Recently Updated

Pokémon TCG: 30th Celebration Poster Collection
SKU: 1010892067
Retail: $19.99
Stock: Recently Updated

Pokémon TCG: 30th Celebration Tin — Styles May Vary
SKU: 1010892069
Stock: Recently Updated

Pokémon TCG: Mega Evolution Ascended Heroes First Partners Deluxe Pin Collection
SKU: 95093989
Stock: <1000

Pokémon TCG: Charizard X ex Ultra-Premium Collection
SKU: 94681790
Stock: <1000`;
    // The 11 of them already on the list (as the worker's seed names them), in three sets.
    const KNOWN = () => [
      ["95225595", "First Partner Illustration Collection Series 1", "First Partner Collection"],
      ["1010892076", "30th Celebration Elite Trainer Box", "30th Celebration"], ["1010892074", "30th Celebration Binder Collection", "30th Celebration"],
      ["1010892068", "30th Celebration Sylveon ex Box", "30th Celebration"], ["1010892065", "30th Celebration Greninja ex Box", "30th Celebration"],
      ["1010892069", "30th Celebration ex Tin (Sylveon ex or Greninja ex)", "30th Celebration"], ["1010892067", "30th Celebration Poster Collection", "30th Celebration"],
      ["95093989", "Ascended Heroes First Partners Deluxe Pin Collection", "Ascended Heroes"], ["95120822", "Ascended Heroes Tech Sticker Collection: Gastly", "Ascended Heroes"],
      ["95093981", "Ascended Heroes Premium Poster Collection: Mega Lucario", "Ascended Heroes"], ["95093982", "Ascended Heroes Premium Poster Collection: Mega Gardevoir", "Ascended Heroes"],
    ].map(([sku, name, set]) => ({ sku, store: "target", name, about: "", set, pic: "", tcg: "" }));
    // The 13 new ones, in the list's order, as Add products names them, and the set on the list each name has.
    const NEW = [
      ["1013645543", "Unova Heavy Hitters Premium Collection", ""],
      ["1012470483", "30th Celebration Big Tin 4-Pack (styles may vary)", "30th Celebration"],
      ["1013166578", "Delta Reign Booster Bundle", ""],
      ["1012793604", "Delta Reign Elite Trainer Box", ""],
      ["1012850572", "30th Celebration Ultra-Premium Collection: Night", "30th Celebration"],
      ["1012850570", "30th Celebration Ultra-Premium Collection: Day", "30th Celebration"],
      ["1012793603", "30th Celebration Figure Collection: Mew", "30th Celebration"],
      ["1012850573", "30th Celebration Figure Collection: Mewtwo", "30th Celebration"],
      ["1013166573", "Delta Reign Three-Booster Blister", ""],
      ["1012663804", "30th Celebration Ditto Premium Collection", "30th Celebration"],
      ["1013166576", "Delta Reign Booster Display", ""],
      ["1010892071", "30th Celebration Battle Deck: Umbreon ex", "30th Celebration"],
      ["94681790", "Charizard X ex Ultra-Premium Collection", ""],
    ];
    const read = (text, store = "target") => ev(({ text, store }) => window.__t.interestsFromText(text, store).map((it) => (it ? [it.sku, it.store, it.name] : false)), { text, store });
    const nameOf = (v) => ev((v) => window.__t.interestDropName(v), v);

    await test("a drop list's blocks: each name over its SKU line, with or without Retail, QL and Stock, and the tracker's tags off", async () => {
      const all = await read(DROP);
      assert.equal(all.length, 24, "a product per block, and nothing for the Retail, QL and Stock lines");
      assert.ok(all.every(Boolean), "every block read");
      assert.deepEqual(all.slice(0, 4), [
        ["1013645543", "target", "Unova Heavy Hitters Premium Collection"],   // "— New Drop" off, with QL
        ["1010892074", "target", "30th Celebration Binder Collection"],
        ["1012470483", "target", "30th Celebration Big Tin 4-Pack (styles may vary)"],
        ["1013166578", "target", "Delta Reign Booster Bundle"]]);   // "Mega Evolution —" off, no QL line
      assert.deepEqual(all.slice(5, 7).map((x) => x[2]), ["30th Celebration Ultra-Premium Collection: Night", "30th Celebration Ultra-Premium Collection: Day"]);
      assert.deepEqual(all.slice(7, 9).map((x) => x[2]), ["30th Celebration Figure Collection: Mew", "30th Celebration Figure Collection: Mewtwo"]);   // Stock only
      // "Mega Evolution " with no dash goes too, and a name comes out as the list has it.
      assert.deepEqual(all[11], ["95120822", "target", "Ascended Heroes Tech Sticker Collection: Gastly"]);
      assert.equal(all[15][2], "Ascended Heroes Poster Collection: Mega Lucario");
      assert.equal(all[18][2], "30th Celebration: Greninja ex Box");
      assert.equal(all[21][2], "30th Celebration Tin (styles may vary)");
      assert.equal(all[22][2], "Ascended Heroes First Partners Deluxe Pin Collection");   // Stock: <1000
      assert.deepEqual(all[23], ["94681790", "target", "Charizard X ex Ultra-Premium Collection"]);
      assert.deepEqual(all.map((x) => x[0]), DROP.split("\n").filter((l) => l.startsWith("SKU: ")).map((l) => l.slice(5)));
      // Windows line endings, the Store picked, and blocks with no blank line between them.
      assert.deepEqual(await read(DROP.split("\n").slice(0, 10).filter(Boolean).join("\r\n"), "pokemoncenter"), [
        ["1013645543", "pokemoncenter", "Unova Heavy Hitters Premium Collection"], ["1010892074", "pokemoncenter", "30th Celebration Binder Collection"]]);
    });

    await test("a drop list's SKU lines, names and tags as other trackers write them", async () => {
      assert.deepEqual(await read("Sample Tin One\nTCIN: 12345678\nSample Tin Two\nsku#12345679\nSample Tin Three\nSKU 12345680\nSample Tin Four\nSku #: 12345681 (Target)\nPrice: $9.99\nLimit: 2\nRelease Date: Friday"), [
        ["12345678", "target", "Sample Tin One"], ["12345679", "target", "Sample Tin Two"], ["12345680", "target", "Sample Tin Three"], ["12345681", "target", "Sample Tin Four"]]);
      assert.deepEqual(await read("Pokémon Center Sample Box\nSKU: 100-10003", "pokemoncenter"), [["100-10003", "pokemoncenter", "Pokémon Center Sample Box"]]);
      // A SKU line with the name after its number has its own (the review of 1.9.143), never a header's above it, which
      // counts as a line that couldn't be read; a store, its word for the stock or its next field after the number isn't one.
      assert.deepEqual(await read("Friday drops:\nSKU: 12345698 Sample Tin\nSKU: 12345699 - Pokémon TCG: Sample Box — New Drop"),
        [false, ["12345698", "target", "Sample Tin"], ["12345699", "target", "Sample Box"]]);
      assert.deepEqual(await read("Sample Bundle\nSKU: 12345700 · In Stock\nSample Pack\nSKU: 12345701 — Retail: $9.99\nSample Deck\nSKU: 12345702 Target | Online"),
        [["12345700", "target", "Sample Bundle"], ["12345701", "target", "Sample Pack"], ["12345702", "target", "Sample Deck"]]);
      assert.equal(await nameOf("Pokemon TCG: Sample Bundle - Restock"), "Sample Bundle");
      assert.equal(await nameOf("Pokémon Trading Card Game: Sample Bundle – Back in Stock"), "Sample Bundle");
      assert.equal(await nameOf("Pokémon TCG: Sample Box — Pre-order"), "Sample Box");
      assert.equal(await nameOf("Pokémon TCG: Sample Box — Night — Live Now"), "Sample Box: Night");
      assert.equal(await nameOf("Pokémon TCG: Mega Evolution: Sample Heroes Booster Bundle — Restocked"), "Sample Heroes Booster Bundle");
      assert.equal(await nameOf("Pokémon TCG: Sample Mini Tin — Style May Vary"), "Sample Mini Tin (styles may vary)");
      // "Mega Evolution" with only the set's own product after it is that set's product, and keeps its name.
      assert.equal(await nameOf("Pokémon TCG: Mega Evolution Elite Trainer Box — Mega Lucario"), "Mega Evolution Elite Trainer Box: Mega Lucario");
      assert.equal(await nameOf("Pokémon TCG: Mega Evolution"), "Mega Evolution");
      // So does one of the set's other products (the review of 1.9.143); with a dash or a colon after "Mega Evolution", what
      // follows is a set of the series, and it goes.
      for (const p of ["Pokémon Center Elite Trainer Box", "Mega Sample ex Box", "Mega Sample X ex Ultra-Premium Collection", "Knock Out Collection", "Stacking Tin"])
        assert.equal(await nameOf("Pokémon TCG: Mega Evolution " + p), "Mega Evolution " + p);
      assert.equal(await nameOf("Pokémon TCG: Mega Evolution — Mega Sample ex Box"), "Mega Sample ex Box");
      assert.equal(await nameOf("Pokémon TCG: Mega Evolution: Pokémon Center Sample Box"), "Pokémon Center Sample Box");
      // A dash inside a word stays, and a long name is cut at the worker's 120.
      assert.equal(await nameOf("Pokémon TCG: Scarlet & Violet—151 Ultra-Premium Collection"), "Scarlet & Violet—151 Ultra-Premium Collection");
      assert.equal((await nameOf("Pokémon TCG: " + "Sample ".repeat(30))).length, 120);
    });

    await test("a drop list's name is never another product's: a block with no SKU line isn't read, nor a link or a SKU's own line", async () => {
      // A block with no SKU line counts as a line that couldn't be read, and its Retail and Stock lines as nothing.
      assert.deepEqual(await read("Pokémon TCG: 30th Celebration Sample Box — New Drop\nRetail: $9.99\nStock: New Launch\n\nPokémon TCG: Sample Bundle\nSKU: 12345682\nStock: 1k+"),
        [false, ["12345682", "target", "Sample Bundle"]]);
      // Also one whose name starts with a number ("151 …" read alone would be SKU 151).
      assert.deepEqual(await read("151 Ultra-Premium Collection\nRetail: $119.99\nStock: 1k+"), [false]);
      // A name on its own, "30th …" too (no SKU 30th), and a SKU line with no name above it, back to the one before.
      assert.deepEqual(await read("30th Celebration Sample Tin"), [false]);
      assert.deepEqual(await read("Sample Bundle\nSKU: 12345683\nRetail: $5\nSKU: 12345684"), [["12345683", "target", "Sample Bundle"], ["12345684", "target", "SKU 12345684"]]);
      // "151 …" can be a name (151 is no SKU of 6 digits); a link or a "SKU name" line above a SKU line stays a product of its own.
      assert.deepEqual(await read("151 Ultra-Premium Collection\nSKU: 12345685"), [["12345685", "target", "151 Ultra-Premium Collection"]]);
      assert.deepEqual(await read("https://www.target.com/p/sample-trading-card-game-booster-box/-/A-44444445\nSKU: 12345686"),
        [["44444445", "target", "Sample Trading Card Game Booster Box"], ["12345686", "target", "SKU 12345686"]]);
      assert.deepEqual(await read("55555556 Sample Mini Tin\n\nSKU: 12345687"), [["55555556", "target", "Sample Mini Tin"], ["12345687", "target", "SKU 12345687"]]);
      // A SKU line whose number isn't one ("SKU: TBD") is the tracker's: its name isn't read.
      assert.deepEqual(await read("Sample Bundle\nSKU: TBD\nStock: Soon"), [false]);
    });

    await test("a drop list with each SKU line over its name, as another tracker writes it, reads the same; a SKU line that got no name lends none", async () => {
      // The owner's 24 with each block's SKU line first (the review of 1.9.143: each took the name of the product above).
      const skuFirst = DROP.split("\n\n").map((b) => { const ls = b.split("\n"), s = ls.findIndex((l) => l.startsWith("SKU: ")); return [ls[s], ...ls.filter((_, i) => i !== s)].join("\n"); }).join("\n\n");
      assert.notEqual(skuFirst, DROP);
      assert.deepEqual(await read(skuFirst), await read(DROP));
      // With no blank lines or tracker's lines, and under a header (a line that couldn't be read).
      assert.deepEqual(await read("SKU: 12345691\nSample Tin\nSKU: 12345692\nSample Box"), [["12345691", "target", "Sample Tin"], ["12345692", "target", "Sample Box"]]);
      assert.deepEqual(await read("Friday drops:\nSKU: 12345693\nSample Tin\nRetail: $9.99\n\nSKU: 12345694\nSample Box\nStock: 1k+"),
        [false, ["12345693", "target", "Sample Tin"], ["12345694", "target", "Sample Box"]]);
      // Names over their SKU lines, but one SKU line with none: the line right under it is never the next one's name.
      assert.deepEqual(await read("Sample Tin\nSKU: 12345695\n\nSKU: 12345696\nSample Box\nSKU: 12345697"),
        [["12345695", "target", "Sample Tin"], ["12345696", "target", "SKU 12345696"], false, ["12345697", "target", "SKU 12345697"]]);
    });

    await test("links and \"SKU name\" lines in the same paste as a drop list's blocks still read, in the paste's order", async () => {
      assert.deepEqual(await read(["https://www.target.com/p/sample-trading-card-game-booster-box/-/A-44444446#lnk=sametab", "55555557 Sample Mini Tin", "",
        "Pokémon TCG: Mega Evolution — Sample Reign Booster Bundle — New Drop", "SKU: 12345688", "Retail: $31.99", "Stock: 50k+", "",
        "https://www.pokemoncenter.com/product/100-10004/sample-center-tin", "12345689", "not a sku"].join("\n")), [
        ["44444446", "target", "Sample Trading Card Game Booster Box"], ["55555557", "target", "Sample Mini Tin"],
        ["12345688", "target", "Sample Reign Booster Bundle"], ["100-10004", "pokemoncenter", "Sample Center Tin"], ["12345689", "target", "SKU 12345689"], false]);
    });

    await test("each product goes in the set on the list its name has, never one inside another, then the last in it, without case or accents; else the Set box's", async () => {
      const setFor = (name, sets) => ev(({ name, sets }) => window.__t.interestSetFor(name, sets), { name, sets });
      const sets = ["Scarlet & Violet", "Scarlet & Violet 151", "30th Celebration", "Pokémon Day", "Other"];
      assert.equal(await setFor("Scarlet & Violet 151 Mini Tin", sets), "Scarlet & Violet 151");
      assert.equal(await setFor("scarlet and violet booster", sets), "");
      assert.equal(await setFor("SCARLET & VIOLET Booster Bundle", sets), "Scarlet & Violet");
      assert.equal(await setFor("Pokemon Day Collection", sets), "Pokémon Day");
      assert.equal(await setFor("30th Celebrations Tin", sets), "", "word for word");
      assert.equal(await setFor("Sample Other Tin", sets), "", "Other is the section for none");
      // A series and a set of it both on the list (the review of 1.9.143): the set, which comes after the series, from a
      // Target link, a Pokémon Center link or a "SKU name" line; one of the series' own products stays the series'.
      const series = ["Mega Evolution", "Sample Reign", "30th Celebration"];
      for (const line of ["https://www.target.com/p/pok-233-mon-trading-card-game-mega-evolution-8212-sample-reign-mini-tin/-/A-99999999",
        "https://www.pokemoncenter.com/product/100-10999/pokemon-tcg-mega-evolution-sample-reign-pokemon-center-elite-trainer-box",
        "99999995 Pokémon TCG: Mega Evolution—Sample Reign Mini Tin"]) {
        const [[, , name]] = await read(line);
        assert.match(name, /Mega Evolution.*Sample Reign/, line);
        assert.equal(await setFor(name, series), "Sample Reign", name);
      }
      const [[, , etb]] = await read("Pokémon TCG: Mega Evolution Pokémon Center Elite Trainer Box\nSKU: 99999994");
      assert.equal(await setFor(etb, series), "Mega Evolution", etb);
    });

    await test("Add products with the owner's drop list: the 11 on the list skipped, the 13 new listed with their sets, saved in one PUT, then looked up", async () => {
      await reset(BASE().concat(KNOWN()), 200);
      const n = W.puts.length, finds = W.finds.length;
      await page.click('#main [data-act="interests-add"]');
      await focused("ia-lines");
      assert.match(await page.$eval("#layers", (e) => e.textContent), /a drop list as a tracker writes it/);
      // As the owner sent it, with their line after the list.
      await page.fill("#ia-lines", DROP + "\n\nhere are the product that may be dropping on friday");
      assert.equal(await page.$eval("#ia-prev", (e) => e.textContent), "13 products to add · 11 already on the list · 1 line couldn't be read");
      assert.equal(await page.$eval("#ia-go", (e) => e.textContent), "Add 13 products");
      const shown = () => page.$$eval("#ia-list li", (els) => els.map((e) => [e.querySelector(".ia-n").textContent, e.querySelector(".ia-s").textContent]));
      assert.deepEqual(await shown(), NEW.map(([sku, name, set]) => [name, `${set || "Other"} · Target SKU ${sku}`]));
      assert.ok(await page.isVisible("#ia-list"), "the names and sets show before Add");
      await page.fill("#ia-lines", DROP);
      assert.equal(await page.$eval("#ia-prev", (e) => e.textContent), "13 products to add · 11 already on the list");
      // The Set box goes on those whose name has no set on the list; the others keep theirs.
      await page.fill("#ia-set", "Friday Drop");
      assert.deepEqual((await shown()).map((x) => x[1].split(" · ")[0]), NEW.map((x) => x[2] || "Friday Drop"));
      await page.click("#ia-go");
      await page.waitForFunction(() => !document.querySelector("#ia-lines"));
      assert.equal(W.puts.length, n + 1, "one save");
      assert.equal(W.puts[n].rev, 200);
      assert.deepEqual(W.puts[n].items.slice(0, BASE().length + 11), BASE().concat(KNOWN()), "the list as it was, first");
      assert.deepEqual(W.puts[n].items.slice(BASE().length + 11), NEW.map(([sku, name, set]) => ({ sku, store: "target", name, about: "", set: set || "Friday Drop", pic: "", tcg: "" })));
      await toastSays(/Added 13 products/);
      await toastSays(/Found no pictures on TCGplayer\./);
      assert.deepEqual(W.finds.slice(finds), NEW.map((x) => x[1]), FIND_MAX >= 13 ? "all 13 looked up" : "the first few");
      assert.doesNotMatch(await lastToast(), /weren't looked up/);
      // On Interests, the 30th Celebration ones join that set's section, and the rest are a section of their own.
      const titles = await page.$$eval("#main .int-set .sub-title", (els) => els.map((e) => e.textContent));
      assert.deepEqual(titles, ["Sample Set A", "Sample Set B", "Sample Set C", "First Partner Collection", "30th Celebration", "Ascended Heroes", "Friday Drop"]);
      const sec = await page.$$eval("#main .int-set", (els) => els.find((e) => e.querySelector(".sub-title").textContent === "30th Celebration").textContent);
      assert.match(sec, HAS_SEND ? /0 of 13 picked/ : /0 of 13 ticked/);
      assert.match(sec, /30th Celebration Ultra-Premium Collection: Night/);
    });

    await test("pasted again, a drop list adds nothing: every product on the list now, and a set of the paste's own found next time", async () => {
      await page.click('#main [data-act="interests-add"]');
      await focused("ia-lines");
      await page.fill("#ia-lines", DROP);
      assert.equal(await page.$eval("#ia-prev", (e) => e.textContent), "Nothing new to add · 24 already on the list");
      assert.equal(await page.$eval("#ia-go", (e) => e.disabled), true);
      assert.equal(await page.$eval("#ia-list", (e) => e.hidden), true);
      // A set the list has now goes on the next paste's products of it.
      await page.fill("#ia-lines", "Pokémon TCG: Friday Drop Sample Tin — New Drop\nSKU: 12345690\nStock: 1k+");
      assert.deepEqual(await page.$$eval("#ia-list .ia-s", (els) => els.map((e) => e.textContent)), ["Friday Drop · Target SKU 12345690"]);
      await page.click("#layers .panel-foot [data-close]");
      await page.waitForFunction(() => !document.querySelector("#ia-lines"));
    });
  }

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out waiting for " + what); await new Promise((r) => setTimeout(r, 50)); }
}

console.log(`${passed} passed`);
