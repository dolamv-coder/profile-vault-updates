// Tests Settings → Backups → Export orders → Orders as CSV (ordersCSV) in the newest page (index-X.Y.Z.html), which from
// 1.9.151 adds each order's ship-to address, the inbox it came to and its unit price as the last three columns, Ship Address,
// Inbox and Unit Price (the owner's request, 2026-11-16: a sheet of one day's Target orders with each product's unit price,
// leaving some people's orders out by the address they ship to, as every order ships to the same name). The columns before
// them stay where they were. The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, on a vault made with Use this browser only and made-up orders: the
// button saves orders-<date>.csv, and its text is checked whole.
//   node .github/scripts/orders-csv.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have the Ship Address column; a page named on the command line that doesn't is skipped.
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
if (!/"Account","Ship Address","Inbox","Unit Price"\]/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file}'s Orders as CSV has no Ship Address, Inbox and Unit Price columns: update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Ship Address column, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, persist, render, ordersCSV};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// Made-up orders (sample names, addresses and inboxes only: this repo is public).
const ORDERS = [
  { id: "t1", store: "target", item: "Sample Elite Trainer Box", orderNo: "900000000000001", qty: "2", total: "$149.78", at: "2026-11-13",
    stage: "placed", shipTo: "Sam Sample", card: "Visa ••1111", arrives: "", buyer: "sam.one@example.com",
    shipAddr: "100 Example St N\nSampletown, TX 75001\n", inbox: "inbox.one@example.com", priceEach: "69.99" },
  { id: "t2", store: "target", item: "Sample \"Booster\" Bundle", orderNo: "900000000000002", qty: "1", total: "$32.46", at: "2026-11-13",
    stage: "canceled", shipTo: "Sam Sample", card: "", arrives: "", buyer: "sam.two@example.com",
    shipAddr: "\n200 Example Ave, Apt 4,\r\n\r\n  \n  Sampletown, TX 75001  ", inbox: "inbox.two@example.com", priceEach: "" },
  { id: "p1", store: "pokemoncenter", item: "Sample Collection", orderNo: "P000000001", qty: "1", total: "$59.99", at: "2026-11-12",
    stage: "shipped", shipTo: "Alex Example", card: "", arrives: "Nov 18", buyer: "", shipAddr: "", inbox: "" },
  { id: "h1", store: "other", storeName: "Sample Shop", item: "Typed in by hand", orderNo: "", qty: "1", total: "", at: "2026-11-14",
    stage: "delivered", shipTo: "", card: "", arrives: "", buyer: "", shipAddr: "300 One Line Rd, Sampletown, TX 75001" },
];
// What the file must hold: the columns before Ship Address are as before 1.9.151, newest first, a multi-line address on one
// line (a comma at a line's end not doubled, no empty part for a blank line or a line break at either end), quoted where it
// has a comma, the unit price as the email gave it, and empty cells for none.
const EXPECTED = [
  "Store,Item,Order Number,Qty,Total,Order Date,Status,Ship To,Paid With,Arrives,Account,Ship Address,Inbox,Unit Price",
  "Sample Shop,Typed in by hand,,1,,2026-11-14,Delivered,,,,,\"300 One Line Rd, Sampletown, TX 75001\",,",
  "Target,Sample Elite Trainer Box,900000000000001,2,$149.78,2026-11-13,Placed,Sam Sample,Visa ••1111,,sam.one@example.com,\"100 Example St N, Sampletown, TX 75001\",inbox.one@example.com,69.99",
  "Target,\"Sample \"\"Booster\"\" Bundle\",900000000000002,1,$32.46,2026-11-13,Canceled,Sam Sample,,,sam.two@example.com,\"200 Example Ave, Apt 4, Sampletown, TX 75001\",inbox.two@example.com,",
  "Pokémon Center,Sample Collection,P000000001,1,$59.99,2026-11-12,Shipped,Alex Example,,Nov 18,,,,",
].join("\r\n");

console.log(`Orders as CSV in ${file.split(/[\\/]/).pop()}`);
const browser = await chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: "en-US" });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, body: "" });   // no license key here: nothing is asked of the license server
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });   // walkthrough.test.mjs tests the guide
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://app.fafoaco.com/");
  // A vault made with Use this browser only.
  await page.waitForSelector("#lock-local");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", "correct horse battery"); await page.fill("#pw2", "correct horse battery"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 });
  await page.evaluate((orders) => { const T = window.__t; T.S.orders = orders; T.persist(); T.render(); }, ORDERS);

  await test("ordersCSV: Ship Address, Inbox and Unit Price last, an address on one line, the columns before as they were", async () => {
    assert.equal(await page.evaluate(() => window.__t.ordersCSV()), EXPECTED);
  });

  await test("Settings' Orders as CSV saves orders-<date>.csv with that text, no BOM", async () => {
    await page.click('[data-act="settings"]');
    await page.waitForSelector('[data-act="orders-csv"]');
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="orders-csv"]')]);
    const day = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    assert.equal(dl.suggestedFilename(), `orders-${day}.csv`);
    const buf = readFileSync(await dl.path());
    assert.notEqual(buf[0], 0xef, "no BOM");
    assert.equal(buf.toString("utf8"), EXPECTED);
  });

  await test("no orders: the header alone", async () => {
    assert.equal(await page.evaluate(() => { const T = window.__t, was = T.S.orders; T.S.orders = []; const csv = T.ordersCSV(); T.S.orders = was; return csv; }),
      EXPECTED.split("\r\n")[0]);
  });

  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
