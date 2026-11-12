// Tests Interests in the newest page (index-X.Y.Z.html), from 1.9.142: the products the seller lists on the license worker for
// buyers to tick, which each batch Submit sends takes with it (the owner's request, 2026-11-12). The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, against a pretend license worker: a vault made with Use this browser
// only, then a license key kept as Submit keeps one typed there. It checks where the tab is, the cards, ticks and their sync
// setting, Tick all, the search, the list kept on this device, what Submit sends, and the seller's own editing (Add products,
// Edit with a picture, and a save another device beat). Sample names, SKUs and keys only.
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
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, refreshInterests, interestRead, interestsFor, premiumHash, slotKey};" + END);
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
    if (W.hold) await W.hold;   // an answer that's slow to come
    if (u.searchParams.get("rev") === String(W.rev)) return json(route, 200, { rev: W.rev, owner: W.owner, same: true });
    return json(route, 200, out());
  }
  if (p === "/interests" && m === "PUT") {
    if (!W.owner) return json(route, 403, { error: "only your seller's FAFO can change this" });
    const b = JSON.parse(req.postData()); W.puts.push(b);
    if (b.rev !== W.rev) return json(route, 409, { error: "changed", rev: W.rev });
    W.rev++; W.items = b.items;
    return json(route, 200, out());
  }
  if (p === "/interests/pic" && m === "POST") { W.picPosts.push(JSON.parse(req.postData())); return json(route, 200, { ref: "h" + "b".repeat(32) }); }
  if (p === "/pictures/find") {
    const q = u.searchParams.get("q"); W.finds.push(q);
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

  await test("Submit sends the ticked SKUs for the stores in the batch only, only those on the list, in the list's order", async () => {
    await ev(() => {
      const { S, slotKey, persist, render } = window.__t;
      S.addresses.push({ id: "a1", first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
      S.profiles.push({ id: "p1", name: "Sam T", shipId: "a1", billSame: true, cardId: "c1", phone: "5125550100", stores: [{ store: "target", mode: "seller" }] });
      S.slots = [slotKey("p1", "target")];
      // Ticked, but not on the list: never sent.
      S.settings.interestPicks = Object.assign({}, S.settings.interestPicks, { "target:99999999": { on: true, at: Date.now() } });
      persist(); render();
    });
    await page.click('#side [data-id="submit"]');
    await page.waitForSelector("#main .sub-act");
    assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /2 interests ticked: their SKUs go with your Target files\./);
    await page.click('#main [data-act="submit-slots"]');
    await page.fill("#ss-from", "Sam");
    await page.click("#ss-go");
    await page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
    assert.equal(W.subs.length, 1);
    assert.deepEqual(W.subs[0].interests, { target: ["11111111", "33333333"] }, "Pokémon Center's tick stays out: no Pokémon Center slots in this batch");
    assert.deepEqual([...new Set(W.subs[0].files.map((f) => f.storeKey).filter(Boolean))], ["target"]);
    await page.click("#layers [data-close]");
    // Nothing ticked for the store: a hint to tick, and nothing sent for it.
    await ev(() => { const T = window.__t; T.S.settings.interestPicks = {}; T.persist(); T.render(); });
    assert.match(await page.$eval("#main .sub-act", (e) => e.textContent), /Tick products on Interests for your seller to run them\./);
    assert.equal(await ev(() => JSON.stringify(window.__t.interestsFor([{ kind: "profiles", storeKey: "target" }]))), "{}");
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

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out waiting for " + what); await new Promise((r) => setTimeout(r, 50)); }
}

console.log(`${passed} passed`);
