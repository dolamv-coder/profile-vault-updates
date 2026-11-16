// Tests Export on the Dashboard's selection bar (1.9.153, the owner's request, 2026-11-16, with their orders report: "Include an
// export button at the bottom. Format should be like that file."): the orders picked as an Excel workbook laid out as that report
// (Summary, a tab per person with a section per address, All Orders, Cancelled (excluded)), and the window that says who each
// address is for and remembers the names changed there (settings.exportPeople). The real page runs in Chromium (Playwright), as
// the web version at app.fafoaco.com, on a vault made with Use this browser only and made-up orders. The .xlsx it saves is
// unzipped here and its parts read with the browser's DOMParser: every part must be well-formed XML, and each sheet's values,
// formulas (with their values), styles, merged cells, links, frozen rows, filter, column widths, row heights and print setup are
// checked.
//   node .github/scripts/orders-export.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have ORDERS-XLSX-START; a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { inflateRawSync } from "node:zlib";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!HTML.includes("// ORDERS-XLSX-START")) {
  if (!process.argv[2]) { console.error(`${file} has no ORDERS-XLSX-START: update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Export on the Dashboard, skipped`); process.exit(0);
}
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, persist, render, shareAddrKey, oxSplit, oxGroups, oxReport, oxWorkbook, oxCanon};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

/* An .xlsx's parts: its zip's central directory, stored or deflated entries, each CRC checked. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  assert.ok(e >= 0, "a zip's end record");
  const n = buf.readUInt16LE(e + 10), out = {}; let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "a central directory entry");
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    assert.equal(buf.readUInt32LE(off), 0x04034b50, "a local header for " + name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(start, start + size);
    const data = method === 0 ? raw : inflateRawSync(raw);
    assert.equal(crc32(data), crc, "the CRC of " + name);
    out[name] = data.toString("utf8");
    p += 46 + nlen + elen + clen;
  }
  return out;
}

// Made-up orders (sample names, addresses and inboxes only: this repo is public). On 11/13 at Target: two spellings of one building
// (Jig's dot and a Room line), one sent to a buyer, one at an address remembered for a buyer, one canceled, a second address of the
// same person, one with no unit price (from a seller's alert), one whose total fits no tax rate, an item with & < > in its name.
const ORDERS = [
  { id: "o1", store: "target", item: "Pokémon Trading Card Game: Sample Premium Collection", orderNo: "900000000000011", qty: "2", total: "171.18", at: "2026-11-13", stage: "placed",
    shipTo: "Sam Sample", card: "Visa ••1111", arrives: "Mon, Dec 7", shipAddr: "100 Example St N, Sampletown, FL 33701", inbox: "inbox.one@example.com", priceEach: "79.99" },
  { id: "o2", store: "target", item: "Pokémon Trading Card Game: Sample Premium Collection", orderNo: "900000000000012", qty: "2", total: "165.83", at: "2026-11-13", stage: "placed",
    shipTo: "Sam Sample", card: "American Express ••2222", arrives: "Mon, Dec 7", shipAddr: "100 Exam.ple St North\nRoom 2\nSampletown, FL 33701", inbox: "inbox.two@example.com", priceEach: "79.99" },
  { id: "o3", store: "target", item: "Pokémon Trading Card Game: Sample Premium Collection", orderNo: "900000000000013", qty: "2", total: "177.58", at: "2026-11-13", stage: "placed",
    shipTo: "Ship Name", card: "Visa ••3333", arrives: "Mon, Dec 7", shipAddr: "200 Sample Ave\nOthertown, CA 90001", inbox: "inbox.one@example.com", priceEach: "79.99",
    shareTo: { id: "b1", name: "@alex · Alex Buyer", by: "hand", at: 1 } },
  { id: "o4", store: "target", item: "Pokémon Trading Card Game: Sample Premium Collection", orderNo: "900000000000014", qty: "2", total: "171.18", at: "2026-11-13", stage: "canceled",
    shipTo: "Sam Sample", card: "Visa ••4444", shipAddr: "100 Example St N, Sampletown, FL 33701", inbox: "inbox.one@example.com", priceEach: "79.99" },
  { id: "o5", store: "target", item: "Pokémon Trading Card Game: Sample Premium Collection", orderNo: "900000000000015", qty: "2", total: "171.98", at: "2026-11-13", stage: "placed",
    shipTo: "Pat Ship", card: "Mastercard ••5555", arrives: "Mon, Dec 7", shipAddr: "300 Remembered Rd, Thirdtown, TX 75001", inbox: "inbox.two@example.com", priceEach: "79.99", createdAt: Date.UTC(2026, 10, 13, 12) },
  { id: "o6", store: "target", item: "Pokémon Trading Card Game: Sample Elite Trainer Box", orderNo: "900000000000016", qty: "2", total: "149.78", at: "2026-11-13", stage: "delivered",
    shipTo: "Sam Sample", card: "Visa ••6666", arrives: "", shipAddr: "400 Second Place Blvd, Sampletown, FL 33701", inbox: "inbox.one@example.com", priceEach: "69.99" },
  { id: "o7", store: "target", item: "Sample & <Bundle> \"Box\"", orderNo: "900000000000017", qty: "1", total: "59.99", at: "2026-11-13", stage: "shipped",
    shipTo: "Ship Name", card: "", arrives: "Tue, Nov 18", shipAddr: "200 Sample Ave\nOthertown, CA 90001", sentTo: "acct.seven@example.com", priceEach: "",
    shareTo: { id: "b1", name: "@alex · Alex Buyer", by: "hand", at: 1 } },
  { id: "o8", store: "target", item: "Sample Odd Total", orderNo: "900000000000018", qty: "1", total: "13.99", at: "2026-11-13", stage: "placed",
    shipTo: "Sam Sample", card: "Visa ••8888", arrives: "Sun, Nov 29", shipAddr: "400 Second Place Blvd, Sampletown, FL 33701", inbox: "inbox.one@example.com", priceEach: "10.00" },
];

console.log(`Dashboard export in ${file.split(/[\\/]/).pop()}`);
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: "en-US", timezoneId: "America/New_York" });
await ctx.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  return route.fulfill({ status: 404, body: "" });   // no license key here: nothing is asked of the license server
});
await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });   // walkthrough.test.mjs tests the guide
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));

// The workbook's parts, read by the browser: every sheet's cells with their styles resolved.
async function readBook(path) {
  const parts = unzip(readFileSync(path));
  return Object.assign(await readParts(parts), { raw: parts });
}
async function readParts(parts) {
  return page.evaluate((parts) => {
    const P = new DOMParser(), bad = [], doc = {};
    for (const [k, v] of Object.entries(parts)) { const d = P.parseFromString(v, "application/xml"); if (d.getElementsByTagName("parsererror").length) bad.push(k); doc[k] = d; }
    const all = (d, tag) => Array.from(d.getElementsByTagName(tag));
    const st = doc["xl/styles.xml"], fmts = Object.fromEntries(all(st, "numFmt").map(n => [n.getAttribute("numFmtId"), n.getAttribute("formatCode")]));
    fmts["49"] = "@"; fmts["0"] = "General";
    const fonts = all(st, "font").map(f => ({ sz: +(f.getElementsByTagName("sz")[0] || {getAttribute: () => 0}).getAttribute("val"), b: !!f.getElementsByTagName("b").length, i: !!f.getElementsByTagName("i").length,
      color: f.getElementsByTagName("color")[0] ? f.getElementsByTagName("color")[0].getAttribute("rgb") : null, name: f.getElementsByTagName("name")[0].getAttribute("val") }));
    const fills = all(st, "fill").map(f => { const fg = f.getElementsByTagName("fgColor")[0]; return fg ? fg.getAttribute("rgb") : null; });
    const borders = all(st, "border").map(b => ["left", "right", "top", "bottom"].every(s => { const e = b.getElementsByTagName(s)[0]; return e && e.getAttribute("style") === "thin" && e.getElementsByTagName("color")[0].getAttribute("rgb") === "FFBFBFBF"; }));
    const xfs = all(st.getElementsByTagName("cellXfs")[0], "xf").map(x => { const a = x.getElementsByTagName("alignment")[0];
      return Object.assign({}, fonts[+x.getAttribute("fontId")], { fill: fills[+x.getAttribute("fillId")], border: borders[+x.getAttribute("borderId")], fmt: fmts[x.getAttribute("numFmtId")],
        h: a ? a.getAttribute("horizontal") : null, v: a ? a.getAttribute("vertical") : null, wrap: a ? a.getAttribute("wrapText") === "1" : false }); });
    const wb = doc["xl/workbook.xml"], rels = Object.fromEntries(all(doc["xl/_rels/workbook.xml.rels"], "Relationship").map(r => [r.getAttribute("Id"), r.getAttribute("Target")]));
    const sheets = all(wb, "sheet").map(s => {
      const d = doc["xl/" + rels[s.getAttribute("r:id")]], cells = {}, heights = {};
      all(d, "row").forEach(r => { if (r.getAttribute("ht")) heights[r.getAttribute("r")] = +r.getAttribute("ht"); });
      all(d, "c").forEach(c => {
        const t = c.getAttribute("t"), f = c.getElementsByTagName("f")[0], v = c.getElementsByTagName("v")[0], is = c.getElementsByTagName("is")[0];
        const val = t === "inlineStr" ? is.textContent : v ? (t === "str" ? v.textContent : +v.textContent) : null;
        cells[c.getAttribute("r")] = { v: val, f: f ? f.textContent : null, s: xfs[+(c.getAttribute("s") || 0)] };
      });
      const pane = d.getElementsByTagName("pane")[0], ps = d.getElementsByTagName("pageSetup")[0], fp = d.getElementsByTagName("pageSetUpPr")[0], af = d.getElementsByTagName("autoFilter")[0];
      return { name: s.getAttribute("name"), cells, heights, merges: all(d, "mergeCell").map(m => m.getAttribute("ref")),
        links: all(d, "hyperlink").map(h => ({ ref: h.getAttribute("ref"), loc: h.getAttribute("location"), display: h.getAttribute("display") })),
        freeze: pane ? +pane.getAttribute("ySplit") : 0, filter: af ? af.getAttribute("ref") : null, fitToPage: !!(fp && fp.getAttribute("fitToPage") === "1"),
        setup: { paper: +ps.getAttribute("paperSize"), orient: ps.getAttribute("orientation"), fitW: +ps.getAttribute("fitToWidth"), fitH: +ps.getAttribute("fitToHeight") },
        cols: Object.fromEntries(all(d, "col").map(c => [+c.getAttribute("min"), +c.getAttribute("width")])) };
    });
    const defined = all(wb, "definedName").map(n => ({ name: n.getAttribute("name"), sheet: n.getAttribute("localSheetId"), ref: n.textContent }));
    return { bad, names: Object.keys(parts), sheets, defined, calc: wb.getElementsByTagName("calcPr")[0].getAttribute("fullCalcOnLoad"),
      types: parts["[Content_Types].xml"] };
  }, parts);
}
const sheet = (book, name) => { const s = book.sheets.find(x => x.name === name); assert.ok(s, "a sheet named " + name); return s; };
const val = (sh, ref) => (sh.cells[ref] || {}).v ?? null;
const fx = (sh, ref) => (sh.cells[ref] || {}).f ?? null;
const sty = (sh, ref) => (sh.cells[ref] || {}).s || {};
const MONEY = '\\$#,##0.00;"($"#,##0.00\\);\\-';
const SERIAL_1113 = Date.UTC(2026, 10, 13) / 864e5 + 25569;
const ownKeys = (t) => Object.keys(t).filter(k => t[k] != null);

try {
  await page.goto("https://app.fafoaco.com/");
  await page.waitForSelector("#lock-local");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", "correct horse battery"); await page.fill("#pw2", "correct horse battery"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 });
  // The address o5 ships to is remembered for a buyer (Send to buyer's "Also send future orders"), from before it was added.
  await page.evaluate((orders) => {
    const T = window.__t, k = T.shareAddrKey(orders[4].shipAddr);
    T.S.orders = orders.slice().reverse();
    T.S.settings.buyerAddrs = { [k + "|b2"]: { key: k, id: "b2", name: "Robin Remembered · License …ABCD", addr: orders[4].shipAddr, at: Date.UTC(2026, 10, 1) } };
    T.persist(); T.render();
  }, ORDERS);

  await test("oxSplit: tax from the total, the unit price and a real sales tax rate; a discount only at a rate another order shows", async () => {
    const r = await page.evaluate(() => { const f = window.__t.oxSplit; return [
      f(2, 7999, 17118), f(2, 7999, 16583, [0.07]), f(2, 7999, 17758), f(2, 7999, 17048, [0.1]), f(2, 7999, 17198), f(2, 7999, 15998), f(2, 7999, 16482, [0.0635]),
      f(1, 1000, 1399), f(2, null, 17118), f(2, 7999, null), f(1, 0, 500),
      f(2, 7999, 16583),            // $5 less with no order showing 7 % with none: no discount guessed
      f(2, 4999, 10198, [0.07]),    // 2 % (no rate), or $5 off at 7.375 % (no order shows it): neither
      f(1, 6999, 7060),             // 0.875 % isn't a rate; $5 off at 8.625 % isn't shown by any order
      f(2, 7999, 16482),            // 3.025 % isn't a rate (and no order shows 6.35 % to take $5 off at)
    ]; });
    assert.deepEqual(r.slice(0, 7), [{ off: 0, tax: 1120, rate: 0.07 }, { off: 500, tax: 1085, rate: 0.07 }, { off: 0, tax: 1760, rate: 0.11 }, { off: 500, tax: 1550, rate: 0.1 },
      { off: 0, tax: 1200, rate: 0.075 }, { off: 0, tax: 0, rate: 0 }, { off: 500, tax: 984, rate: 0.0635 }]);
    assert.deepEqual(r.slice(7), [null, null, null, null, null, null, null, null]);
  });

  await test("oxCanon: an address as the report writes one", async () => {
    const r = await page.evaluate(() => ["100 Exam.ple St North\nRoom 2\nSampletown, FL 33701", "77 w 9th st, sampleville, ca 90001", "88 21st Ave. N., Sample Park, FL 33701", "One line only",
      "100 North St, Sampletown, FL 33701", "100 N St, Sampletown, FL 33701", "12 West End Ave, Sampletown, FL 33701", "100 Main St, Sampletown, IL 62701, United States"].map(window.__t.oxCanon));
    assert.deepEqual(r, ["100 Example St N, Sampletown, FL 33701", "77 W 9th St, Sampleville, CA 90001", "88 21st Ave N, Sample Park, FL 33701", "One line only",
      "100 North St, Sampletown, FL 33701", "100 N St, Sampletown, FL 33701", "12 W End Ave, Sampletown, FL 33701", "100 Main St, Sampletown, IL 62701"]);
  });

  await test("the selection bar has Export, and its window says who each address is for", async () => {
    await page.click('#side [data-id="orders"]');
    await page.waitForSelector(".order[data-oid]");
    await page.click('[data-act="order-sel-all"]');
    const bar = await page.$$eval("#bulkbar .bulk-inner > button", (l) => l.map((b) => b.textContent.trim()));
    assert.ok(bar.indexOf("Export") > bar.indexOf("Picture") && bar.indexOf("Export") < bar.indexOf("Delete"), "Export after Picture, before Delete: " + bar.join(" | "));
    await page.click('[data-act="orders-export"]');
    await page.waitForSelector(".layer.is-open #ox-go");
    assert.equal(await page.$eval(".layer.is-open h2", (h) => h.textContent), "Export 8 orders");
    assert.equal(await page.inputValue("#ox-title"), "Target orders placed 11/13/2026 - successful, no cancellations");
    const rows = await page.$$eval(".ox-row", (l) => l.map((r) => ({ addr: r.querySelector(".ox-addr strong").textContent, sub: r.querySelector(".ox-addr .item-sub").textContent, who: r.querySelector(".ox-who").value, auto: r.querySelector(".ox-who").placeholder })));
    assert.deepEqual(rows, [
      { addr: "200 Sample Ave, Othertown, CA 90001", sub: "2 orders · $237.57", who: "Alex Buyer", auto: "Alex Buyer" },          // the buyer they were sent to
      { addr: "300 Remembered Rd, Thirdtown, TX 75001", sub: "1 order · $171.98", who: "Robin Remembered", auto: "Robin Remembered" },   // remembered for a buyer
      { addr: "100 Example St N, Sampletown, FL 33701", sub: "2 orders · $337.01", who: "Sam Sample", auto: "Sam Sample" },     // two spellings, one building; not the canceled one
      { addr: "400 Second Place Blvd, Sampletown, FL 33701", sub: "2 orders · $163.77", who: "Sam Sample", auto: "Sam Sample" },
    ]);
    assert.match(await page.$eval(".layer.is-open .panel-body", (b) => b.textContent), /1 canceled order goes on the Cancelled \(excluded\) tab\./);
    await page.mouse.click(5, 5);   // the backdrop: the names typed aren't thrown away
    await page.waitForTimeout(300);
    assert.equal(await page.$$eval(".layer.is-open #ox-go", (l) => l.length), 1, "a click on the backdrop leaves the window open");
  });

  let book;
  await test("Download Excel saves Target_Orders_11-13-2026.xlsx, well-formed, with the report's sheets in order", async () => {
    await page.fill('.ox-who[aria-label="Who 300 Remembered Rd, Thirdtown, TX 75001 is for"]', "Robin O'Neil & Co");
    let downloads = 0; page.on("download", () => downloads++);
    // A second click that gets past the closing window to what's under it (an order card, the bar's Delete) is recorded.
    await page.evaluate(() => { window.__under = []; document.body.addEventListener("click", (e) => { if (e.detail > 1 && !e.target.closest(".layer")) window.__under.push(e.target.className || e.target.tagName); }); });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.dblclick("#ox-go")]);
    assert.equal(dl.suggestedFilename(), "Target_Orders_11-13-2026.xlsx");
    await page.waitForFunction(() => !document.querySelector(".layer.is-open"));
    await page.waitForTimeout(600);
    assert.equal(downloads, 1, "a double click saves once");
    assert.equal(await page.$$eval(".layer", (l) => l.length), 0, "and its second click pressed nothing under the window (the bar's Delete asks first)");
    assert.deepEqual(await page.evaluate(() => window.__under), [], "the second click reached nothing under the window");
    book = await readBook(await dl.path());
    assert.deepEqual(book.bad, [], "every part parses");
    assert.deepEqual(book.sheets.map((s) => s.name), ["Summary", "Sam Sample", "Alex Buyer", "Robin O'Neil & Co", "All Orders", "Cancelled (excluded)"]);   // the most orders first
    assert.equal(book.calc, "1", "Excel recalculates it on opening");
    assert.match(book.types, /spreadsheetml\.sheet\.main\+xml/);
    assert.deepEqual(book.defined, [{ name: "_xlnm._FilterDatabase", sheet: "4", ref: "'All Orders'!$A$1:$O$8" }]);
    // How the parts are wired: the package's relationship, the workbook's (each sheet, the styles), each part's content type.
    const raw = book.raw;
    assert.deepEqual(Object.keys(raw).sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", ...[1, 2, 3, 4, 5, 6].map((i) => `xl/worksheets/sheet${i}.xml`)].sort());
    assert.match(raw["_rels/.rels"], /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument" Target="xl\/workbook\.xml"/);
    assert.match(raw["xl/_rels/workbook.xml.rels"], /Id="rId7" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/styles" Target="styles\.xml"/);
    for (let i = 1; i <= 6; i++) {
      assert.match(raw["xl/_rels/workbook.xml.rels"], new RegExp(`Id="rId${i}" Type="http://schemas\\.openxmlformats\\.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}\\.xml"`));
      assert.match(raw["[Content_Types].xml"], new RegExp(`PartName="/xl/worksheets/sheet${i}\\.xml" ContentType="application/vnd\\.openxmlformats-officedocument\\.spreadsheetml\\.worksheet\\+xml"`));
      // A worksheet's elements in the order the schema has them (Excel repairs a file that has them in another).
      const ORDER = ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "autoFilter", "mergeCells", "hyperlinks", "pageMargins", "pageSetup"];
      const tops = [...raw[`xl/worksheets/sheet${i}.xml`].matchAll(/<(sheetPr|dimension|sheetViews|sheetFormatPr|cols|sheetData|autoFilter|mergeCells|hyperlinks|pageMargins|pageSetup)[\s>/]/g)].map((m) => m[1]);
      assert.deepEqual(tops, ORDER.filter((x) => tops.includes(x)), "sheet" + i + "'s elements in order");
    }
    assert.match(raw["[Content_Types].xml"], /PartName="\/xl\/styles\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.styles\+xml"/);
    assert.match(raw["xl/worksheets/sheet1.xml"], /<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(raw["xl/worksheets/sheet5.xml"], /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  });

  await test("Summary: each person's addresses, their counts and totals from the tabs, subtotals, the grand total, the check, the notes", async () => {
    const S = sheet(book, "Summary");
    assert.equal(val(S, "A1"), "Target orders placed 11/13/2026 - successful, no cancellations");
    assert.deepEqual(S.merges, ["A1:D1"]);
    assert.equal(val(S, "A2"), "Cost = order total including tax. Click a person name for their tab.");
    assert.deepEqual(["A4", "B4", "C4", "D4"].map((r) => val(S, r)), ["Person", "Address", "Orders", "Total"]);
    const rows = [];
    for (let r = 5; r <= 15; r++) rows.push([val(S, "A" + r) ?? null, val(S, "B" + r) ?? null, val(S, "C" + r) ?? null, fx(S, "C" + r), val(S, "D" + r) ?? null, fx(S, "D" + r)]);
    assert.deepEqual(rows, [
      ["Sam Sample", "100 Example St N, Sampletown, FL 33701", 2, null, 337.01, "'Sam Sample'!D7"],
      ["Sam Sample", "400 Second Place Blvd, Sampletown, FL 33701", 2, null, 163.77, "'Sam Sample'!D15"],
      [null, "Subtotal - Sam Sample", 4, "SUM(C5:C6)", 500.78, "SUM(D5:D6)"],
      [null, null, null, null, null, null],
      ["Alex Buyer", "200 Sample Ave, Othertown, CA 90001", 2, null, 237.57, "'Alex Buyer'!D7"],
      [null, "Subtotal - Alex Buyer", 2, "SUM(C9:C9)", 237.57, "SUM(D9:D9)"],
      [null, null, null, null, null, null],
      ["Robin O'Neil & Co", "300 Remembered Rd, Thirdtown, TX 75001", 1, null, 171.98, "'Robin O''Neil & Co'!D6"],
      [null, "Subtotal - Robin O'Neil & Co", 1, "SUM(C12:C12)", 171.98, "SUM(D12:D12)"],
      [null, null, null, null, null, null],
      [null, "GRAND TOTAL", 7, "C7+C10+C13", 910.33, "D7+D10+D13"],
    ]);
    assert.equal(val(S, "B16"), "Check vs All Orders tab (should be 0)");
    assert.equal(fx(S, "D16"), "ROUND(D15-'All Orders'!L9,2)"); assert.equal(val(S, "D16"), 0);
    assert.deepEqual(S.links, [
      { ref: "A5", loc: "'Sam Sample'!A1", display: "Sam Sample" }, { ref: "A6", loc: "'Sam Sample'!A1", display: "Sam Sample" },
      { ref: "A9", loc: "'Alex Buyer'!A1", display: "Alex Buyer" }, { ref: "A12", loc: "'Robin O''Neil & Co'!A1", display: "Robin O'Neil & Co" }]);
    const notes = []; for (let r = 18; r <= 30; r++) if (val(S, "A" + r)) notes.push(val(S, "A" + r));
    assert.deepEqual(notes, [
      "Card bank: order emails don't show the issuing bank, so only American Express is filled in.",
      "1 cancelled order(s) were excluded (see last tab).",
      "Inboxes included: inbox.one@example.com (4 orders) + inbox.two@example.com (2 orders) + acct.seven@example.com (1 order).",
      "Tax is worked out from each order's total, unit price and local sales tax rate.",
      "1 order fit no tax rate, so its tax is the total less the items (tax and any shipping).",
      "1 order has no unit price in FAFO (from your seller, or added by hand), so its tax isn't split out.",
      "1 order came to $5.00 less before tax (a checkout discount), so its tax is on the lower amount.",
    ]);
    // Its look: the report's.
    assert.deepEqual(sty(S, "A1"), { sz: 14, b: true, i: false, color: null, name: "Arial", fill: null, border: false, fmt: "General", h: null, v: "center", wrap: false });
    assert.deepEqual(sty(S, "A2"), { sz: 9, b: false, i: true, color: null, name: "Arial", fill: null, border: false, fmt: "General", h: null, v: null, wrap: false });
    assert.deepEqual(sty(S, "A4"), { sz: 11, b: true, i: false, color: "FFFFFFFF", name: "Arial", fill: "FF1F3864", border: true, fmt: "General", h: "center", v: null, wrap: false });
    assert.deepEqual(sty(S, "A5"), { sz: 10, b: false, i: false, color: "FF0000FF", name: "Arial", fill: null, border: true, fmt: "General", h: null, v: null, wrap: false });
    assert.equal(sty(S, "C5").color, "FF0000FF"); assert.equal(sty(S, "B5").color, null); assert.equal(sty(S, "D5").fmt, MONEY);
    assert.deepEqual(sty(S, "D7"), { sz: 10, b: true, i: false, color: null, name: "Arial", fill: "FFFFF2CC", border: true, fmt: MONEY, h: null, v: null, wrap: false });
    assert.equal(sty(S, "B7").h, "right"); assert.equal(sty(S, "C7").b, true);
    assert.deepEqual([sty(S, "B15").sz, sty(S, "D15").sz, sty(S, "D15").fill], [11, 11, "FFFFF2CC"]);
    assert.deepEqual([sty(S, "B16").i, sty(S, "B16").sz, sty(S, "D16").fmt], [true, 9, MONEY]);
    assert.equal(sty(S, "A18").sz, 9);
    assert.deepEqual(S.cols, { 1: 16, 2: 46, 3: 10, 4: 15 });
    assert.equal(S.freeze, 4); assert.equal(S.heights[1], 25.5); assert.equal(S.heights[5], 15);
    assert.deepEqual([S.setup, S.fitToPage], [{ paper: 9, orient: "portrait", fitW: 1, fitH: 1 }, false]);
  });

  await test("a person's tab: a section per address (spellings grouped, the last card), the orders, address totals, the person's total", async () => {
    const T = sheet(book, "Sam Sample");
    assert.deepEqual(T.merges, ["A1:F1", "A2:F2", "A3:F3", "A9:F9", "A10:F10", "A11:F11"]);
    assert.equal(val(T, "A1"), "100 Example St N, Sampletown, FL 33701");
    assert.equal(val(T, "A2"), "2 order(s) placed 11/13/2026. Variants grouped here: 100 Example St N (x1) | 100 Exam.ple St North, Room 2 (x1)");
    assert.equal(val(T, "A3"), "Last card used (last order listed): American Express *2222 / Bank: American Express");
    assert.deepEqual(["A4", "B4", "C4", "D4", "E4", "F4"].map((r) => val(T, r)), ["Order #", "Order Date", "Description", "Cost", "Card Used / Bank", "Delivery Status"]);
    assert.deepEqual(["A5", "B5", "C5", "D5", "E5", "F5"].map((r) => val(T, r)),
      ["900000000000011", SERIAL_1113, "Pokémon TCG: Sample Premium Collection x2 @ $79.99 + $11.20 tax", 171.18, "Visa *1111 / Bank: not shown in order email", "Not delivered yet (arrives 12/07)"]);
    assert.deepEqual(["A6", "C6", "D6", "E6"].map((r) => val(T, r)),
      ["900000000000012", "Pokémon TCG: Sample Premium Collection x2 @ $79.99 - $5.00 off + $10.85 tax", 165.83, "American Express *2222 / Bank: American Express"]);
    assert.deepEqual([val(T, "C7"), fx(T, "D7"), val(T, "D7")], ["Address total", "SUM(D5:D6)", 337.01]);
    assert.equal(val(T, "A9"), "400 Second Place Blvd, Sampletown, FL 33701");
    assert.equal(val(T, "A10"), "2 order(s) placed 11/13/2026.");
    assert.deepEqual(["A13", "C13", "D13", "F13"].map((r) => val(T, r)), ["900000000000016", "Pokémon TCG: Sample Elite Trainer Box x2 @ $69.99 + $9.80 tax", 149.78, "Delivered"]);
    assert.deepEqual(["A14", "C14", "D14", "F14"].map((r) => val(T, r)), ["900000000000018", "Sample Odd Total x1 @ $10.00 + $3.99 tax and any shipping", 13.99, "Not delivered yet (arrives 11/29)"]);
    assert.deepEqual([fx(T, "D15"), val(T, "D15")], ["SUM(D13:D14)", 163.77]);
    assert.deepEqual([val(T, "C17"), fx(T, "D17"), val(T, "D17")], ["TOTAL - Sam Sample", "D7+D15", 500.78]);
    // Its look: the report's.
    assert.deepEqual(sty(T, "A1"), { sz: 11, b: true, i: false, color: "FFFFFFFF", name: "Arial", fill: "FF1F3864", border: true, fmt: "General", h: "center", v: "center", wrap: false });
    assert.deepEqual(sty(T, "A2"), { sz: 8, b: false, i: true, color: null, name: "Arial", fill: null, border: false, fmt: "General", h: null, v: "top", wrap: true });
    assert.deepEqual([sty(T, "A3").sz, sty(T, "A3").b, sty(T, "A3").wrap], [9, true, true]);
    assert.deepEqual(sty(T, "C4"), { sz: 10, b: true, i: false, color: null, name: "Arial", fill: "FFD9E2F3", border: true, fmt: "General", h: "center", v: null, wrap: false });
    assert.deepEqual([sty(T, "A5").fmt, sty(T, "B5").fmt, sty(T, "B5").h, sty(T, "D5").fmt, sty(T, "C5").wrap, sty(T, "C5").v], ["@", "mm/dd/yyyy", "center", MONEY, true, "top"]);
    assert.deepEqual([sty(T, "C7").h, sty(T, "D7").b, sty(T, "D7").fill, sty(T, "D7").border], ["right", true, null, true]);
    assert.deepEqual([sty(T, "C17").sz, sty(T, "D17").sz, sty(T, "D17").fill], [11, 11, "FFFFF2CC"]);
    assert.deepEqual([T.heights[1], T.heights[2], T.heights[3], T.heights[4], T.heights[5], T.heights[7], T.heights[17]], [24, 13.5, 15, 15, 28.5, 15, 15]);
    assert.deepEqual(T.cols, { 1: 19, 2: 12, 3: 58, 4: 12, 5: 38, 6: 40 });
    assert.deepEqual([T.setup, T.fitToPage], [{ paper: 1, orient: "landscape", fitW: 1, fitH: 0 }, true]);
    // One address: no person's total. The seller's order with no unit price, the & < > " in an item.
    const A = sheet(book, "Alex Buyer");
    assert.deepEqual(["C5", "C6", "F6", "E6"].map((r) => val(A, r)), ["Pokémon TCG: Sample Premium Collection x2 @ $79.99 + $17.60 tax", "Sample & <Bundle> \"Box\" x1", "Shipped (arrives 11/18)", "Not shown in FAFO"]);
    assert.deepEqual([fx(A, "D7"), val(A, "D7")], ["SUM(D5:D6)", 237.57]);
    assert.equal(ownKeys(A.cells).some((r) => /^[A-F](8|9)$/.test(r)), false, "nothing after its only address");
    const R = sheet(book, "Robin O'Neil & Co");
    assert.deepEqual(["E5", "F5"].map((r) => val(R, r)), ["Mastercard *5555 / Bank: not shown in order email", "Not delivered yet (arrives 12/07)"]);
  });

  await test("All Orders: a row per order with its unit price, shipping, tax and total, the discount in its description; the total, the filter", async () => {
    const A = sheet(book, "All Orders");
    assert.deepEqual([..."ABCDEFGHIJKLMNO"].map((c) => val(A, c + "1")), ["Person", "Grouped Address", "Order #", "Order Date", "Ship-To Name", "Address As Entered", "Description", "Qty", "Unit Price", "Shipping", "Tax", "Order Total", "Card / Bank", "Delivery Status", "Gmail Inbox"]);
    const row = (r) => [..."ABCDEFGHIJKLMNO"].map((c) => val(A, c + r) ?? null);
    assert.deepEqual(row(2), ["Sam Sample", "100 Example St N, Sampletown, FL 33701", "900000000000011", SERIAL_1113, "Sam Sample", "100 Example St N, Sampletown, FL 33701", "Pokémon TCG: Sample Premium Collection", 2, 79.99, 0, 11.2, 171.18, "Visa *1111 / Bank: not shown in order email", "Not delivered yet (arrives 12/07)", "inbox.one@example.com"]);
    assert.deepEqual(row(3), ["Sam Sample", "100 Example St N, Sampletown, FL 33701", "900000000000012", SERIAL_1113, "Sam Sample", "100 Exam.ple St North, Room 2, Sampletown, FL 33701", "Pokémon TCG: Sample Premium Collection ($5.00 off before tax)", 2, 79.99, 0, 10.85, 165.83, "American Express *2222 / Bank: American Express", "Not delivered yet (arrives 12/07)", "inbox.two@example.com"]);
    assert.deepEqual(row(5).slice(6, 12), ["Sample Odd Total (tax column: tax and any shipping)", 1, 10, null, 3.99, 13.99]);
    assert.deepEqual(row(7).slice(0, 12), ["Alex Buyer", "200 Sample Ave, Othertown, CA 90001", "900000000000017", SERIAL_1113, "Ship Name", "200 Sample Ave, Othertown, CA 90001", "Sample & <Bundle> \"Box\"", 1, null, null, null, 59.99]);
    assert.equal(val(A, "O7"), "acct.seven@example.com");
    assert.deepEqual(row(8).slice(0, 3), ["Robin O'Neil & Co", "300 Remembered Rd, Thirdtown, TX 75001", "900000000000015"]);
    assert.deepEqual([val(A, "K9"), fx(A, "L9"), val(A, "L9")], ["Total", "SUM(L2:L8)", 910.33]);
    assert.equal(A.freeze, 1); assert.equal(A.filter, "A1:O8");
    assert.deepEqual(sty(A, "A1"), { sz: 10, b: true, i: false, color: "FFFFFFFF", name: "Arial", fill: "FF1F3864", border: true, fmt: "General", h: "center", v: null, wrap: true });
    assert.deepEqual([sty(A, "C2").fmt, sty(A, "D2").fmt, sty(A, "I2").fmt, sty(A, "L2").fmt, sty(A, "G2").wrap, sty(A, "G2").v], ["@", "mm/dd/yyyy", MONEY, MONEY, true, "top"]);
    assert.deepEqual([sty(A, "K9").b, sty(A, "L9").fill, sty(A, "L9").border], [true, "FFFFF2CC", false]);
    assert.deepEqual([A.heights[1], A.heights[2], A.heights[3], A.heights[9]], [15, 23.85, 23.85, 15]);   // two lines where a cell's text takes two (the card here)
    assert.deepEqual(A.cols, { 1: 14, 2: 40, 3: 19, 4: 12, 5: 16, 6: 42, 7: 58, 8: 6, 9: 11, 10: 10, 11: 10, 12: 13, 13: 36, 14: 44, 15: 22 });
    assert.deepEqual(A.setup, { paper: 9, orient: "portrait", fitW: 1, fitH: 1 });
    const C = sheet(book, "Cancelled (excluded)");
    assert.deepEqual([["A1", "B1", "C1"], ["A2", "B2", "C2"]].map((r) => r.map((x) => val(C, x))), [["Order #", "Note", "Gmail Inbox"], ["900000000000014", "Canceled in FAFO - excluded from this report", "inbox.one@example.com"]]);
    assert.deepEqual([sty(C, "A1").fill, sty(C, "A1").h, sty(C, "A2").fmt, sty(C, "B2").border], ["FF1F3864", null, "@", true]);
    assert.deepEqual(C.cols, { 1: 20, 2: 62, 3: 24 });
  });

  await test("a name changed is remembered for the next export, and one set back to what FAFO puts there is forgotten", async () => {
    const k = await page.evaluate((a) => window.__t.shareAddrKey(a), ORDERS[4].shipAddr);
    const saved = await page.evaluate(() => window.__t.S.settings.exportPeople);
    assert.deepEqual(Object.keys(saved), [k]); assert.equal(saved[k].name, "Robin O'Neil & Co");
    // Saved in the vault: still there after locking and unlocking.
    await page.click('[data-act="lock"]');
    await page.waitForSelector("#pw1");
    await page.fill("#pw1", "correct horse battery");   // the lock screen unlocks as the password is typed
    await page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 });
    assert.equal((await page.evaluate(() => window.__t.S.settings.exportPeople))[k].name, "Robin O'Neil & Co");
    await page.click('#side [data-id="orders"]');
    await page.waitForSelector(".order[data-oid]");
    if (!(await page.$('#bulkbar [data-act="orders-export"]'))) await page.click('[data-act="order-sel-all"]');
    await page.click('[data-act="orders-export"]');
    await page.waitForSelector(".layer.is-open #ox-go");
    const box = '.ox-who[aria-label="Who 300 Remembered Rd, Thirdtown, TX 75001 is for"]';
    assert.equal(await page.inputValue(box), "Robin O'Neil & Co");
    assert.equal(await page.getAttribute(box, "placeholder"), "Robin Remembered");
    await page.fill(box, "");   // empty: what FAFO puts there
    await page.fill("#ox-title", "Sample report for 11/13");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ox-go")]);
    const b2 = await readBook(await dl.path());
    assert.equal(val(sheet(b2, "Summary"), "A1"), "Sample report for 11/13", "the title typed");
    assert.deepEqual(b2.sheets.map((s) => s.name), ["Summary", "Sam Sample", "Alex Buyer", "Robin Remembered", "All Orders", "Cancelled (excluded)"]);
    assert.deepEqual(await page.evaluate(() => window.__t.S.settings.exportPeople), {});
  });

  await test("two stores and days: the title, the file name and the descriptions say so; tab names Excel takes", async () => {
    const r = await page.evaluate(() => {
      const T = window.__t, base = { qty: "1", total: "10.70", priceEach: "10.00", stage: "placed", card: "Visa ••1234", inbox: "x@example.com" };
      const os = [Object.assign({ id: "m1", store: "target", item: "A", orderNo: "1", at: "2026-11-11", shipTo: "Summary", shipAddr: "1 A St, Sampletown, FL 33701" }, base),
        Object.assign({ id: "m2", store: "pokemoncenter", item: "B", orderNo: "2", at: "2026-11-13", shipTo: "Pat?", shipAddr: "2 B St, Sampletown, FL 33701" }, base),
        Object.assign({ id: "m3", store: "target", item: "C", orderNo: "3", at: "2026-11-12", shipTo: "Pat", shipAddr: "3 C St, Sampletown, FL 33701" }, base),
        Object.assign({ id: "m4", store: "target", item: "D", orderNo: "4", at: "2026-11-12", shipTo: "A:B/C*D?E[F]G\\H " + "x".repeat(40), shipAddr: "4 D St, Sampletown, FL 33701" }, base),
        Object.assign({ id: "m5", store: "target", item: "E", orderNo: "5", at: "2026-11-12", shipTo: "pat", shipAddr: "5 E St, Sampletown, FL 33701" }, base)];
      const rep = T.oxReport(os, T.oxGroups(os, {}), "");
      return { title: rep.title, file: rep.file, tabs: rep.people.map((p) => p.tab), desc: rep.lines.map((l) => l.desc) };
    });
    assert.equal(r.title, "Target and Pokémon Center orders placed 11/11/2026 to 11/13/2026 - successful, no cancellations");
    assert.equal(r.file, "FAFO_Orders_11-11-2026_to_11-13-2026.xlsx");
    // "Pat" and "pat" are one person (two orders, first); no character Excel refuses, 31 at most; "Pat?" is another person, whose tab
    // can't be Pat; never the Summary's own name.
    assert.deepEqual(r.tabs, ["Pat", "ABCDEFGH " + "x".repeat(22), "Pat 2", "Summary 2"]);
    assert.ok(r.desc.some((d) => d.startsWith("Pokémon Center: B x1")) && r.desc.some((d) => d.startsWith("Target: A x1")), "each description names its store");
  });

  await test("the report's other cases: a $10 discount, a total under its items, a preorder, a section over two days, no total, the (none) row", async () => {
    const bytes = await page.evaluate(() => {
      const T = window.__t, b = { store: "target", qty: "2", priceEach: "79.99", stage: "placed", card: "Visa ••1234", inbox: "x@example.com", shipTo: "Sam Sample" };
      const os = [
        Object.assign({}, b, { id: "e1", item: "A", orderNo: "1", total: "171.18", at: "2026-11-12", shipAddr: "1 A St, Sampletown, FL 33701" }),
        Object.assign({}, b, { id: "e2", item: "A", orderNo: "2", total: "160.48", at: "2026-11-13", shipAddr: "1 A St, Sampletown, FL 33701" }),   // $10 off, then 7 %
        Object.assign({}, b, { id: "e3", item: "B", orderNo: "3", qty: "1", priceEach: "50.00", total: "40.00", at: "2026-11-13", shipAddr: "2 B St, Sampletown, FL 33701" }),   // under its items
        Object.assign({}, b, { id: "e4", item: "Sample Box (Preorder)", orderNo: "4", total: "171.18", at: "2026-11-13", arrives: "Fri, Dec 4", shipAddr: "2 B St, Sampletown, FL 33701" }),
        Object.assign({}, b, { id: "e5", item: "C", orderNo: "5", total: "", at: "2026-11-13", shipAddr: "2 B St, Sampletown, FL 33701" }),   // no total
      ];
      return Array.from(T.oxWorkbook(T.oxReport(os, T.oxGroups(os, {}), "")));
    });
    const b = await readParts(unzip(Buffer.from(bytes)));
    assert.deepEqual(b.bad, []);
    const T = sheet(b, "Sam Sample"), S = sheet(b, "Summary"), A = sheet(b, "All Orders"), C = sheet(b, "Cancelled (excluded)");
    assert.equal(val(T, "A1"), "2 B St, Sampletown, FL 33701");
    assert.equal(val(T, "A2"), "3 order(s) placed 11/13/2026.");
    assert.deepEqual(["C5", "D5", "C6", "F6", "C7", "D7"].map((r) => val(T, r)), ["B x1 @ $50.00", 40, "Sample Box (Preorder) x2 @ $79.99 + $11.20 tax", "Preorder - arrives 12/04", "C x2 @ $79.99", null]);
    assert.equal(val(T, "A11"), "2 order(s) placed 11/12/2026 to 11/13/2026.");
    assert.equal(val(T, "C15"), "A x2 @ $79.99 - $10.00 off + $10.50 tax");
    const notes = []; for (let r = 1; r <= 40; r++) { const v = val(S, "A" + r); if (typeof v === "string" && r > 4) notes.push(v); }
    assert.deepEqual(notes.slice(-6), ["None of the orders exported were cancelled.", "Inboxes included: x@example.com (5 orders).", "Tax is worked out from each order's total, unit price and local sales tax rate.",
      "1 order came to less than its items (a discount or gift card), so its tax is left blank.", "1 order has no total in FAFO, so it counts as $0.",
      "1 order came to $10.00 less before tax (a checkout discount), so its tax is on the lower amount."]);
    const rowOf = (no) => Object.keys(A.cells).find((r) => /^C\d+$/.test(r) && A.cells[r].v === no).slice(1);
    assert.deepEqual([val(A, "G" + rowOf("3")), val(A, "K" + rowOf("3")), val(A, "L" + rowOf("5")), val(A, "G" + rowOf("2"))], ["B", null, null, "A ($10.00 off before tax)"]);
    assert.deepEqual([val(C, "A2"), val(C, "B2")], ["(none)", "None of the orders exported were cancelled."]);
  });

  await test("groups and tab names: two buyers at one building apart, orders with no address by name, unreadable addresses apart; tab names Excel takes; text XML can't hold", async () => {
    const r = await page.evaluate(() => {
      const T = window.__t, C = String.fromCharCode, b = { store: "target", qty: "1", priceEach: "10.00", total: "10.70", stage: "placed", at: "2026-11-13", card: "Visa ••1234", inbox: "x@example.com", item: "T" };
      const os = [
        Object.assign({}, b, { id: "g1", orderNo: "1", shipTo: "Ann Ship", shipAddr: "500 Forward Way, Ste 101, Portland, OR 97201", shareTo: { id: "ann", name: "@ann · Ann Alpha", at: 1 } }),
        Object.assign({}, b, { id: "g2", orderNo: "2", shipTo: "Bob Ship", shipAddr: "500 Forward Way, Ste 202, Portland, OR 97201", shareTo: { id: "bob", name: "Bob Beta · License …WXYZ", at: 1 } }),
        Object.assign({}, b, { id: "g3", orderNo: "3", shipTo: "Cara Nowhere", shipAddr: "" }),
        Object.assign({}, b, { id: "g4", orderNo: "4", shipTo: "Dan Nowhere", shipAddr: "" }),
        Object.assign({}, b, { id: "g5", orderNo: "5", shipTo: "Eve Lane", shipAddr: "Sample Lane, Sampletown, FL 33701" }),
        Object.assign({}, b, { id: "g6", orderNo: "6", shipTo: "Fay Lane", shipAddr: "Other Lane, Sampletown, FL 33701" }),
      ];
      const gs = T.oxGroups(os, {});
      const names = ["Christopher Alexander Johnston's mom", "A".repeat(30) + C(0xD83D, 0xDE00) + " tail", "A".repeat(30), "Pat", "Pat" + C(7)];
      const os2 = names.map((n, i) => Object.assign({}, b, { id: "t" + i, orderNo: String(10 + i), shipTo: n, shipAddr: (20 + i) + " T St, Sampletown, FL 33701",
        item: i ? "T" : "Bad" + C(1) + "Item" + C(0xD800), inbox: i ? "x@example.com" : "_x0041_@example.com" }));
      const rep = T.oxReport(os2, T.oxGroups(os2, {}), "");
      return { autos: gs.map((g) => g.auto), keys: gs.map((g) => g.key), tabs: rep.people.map((p) => p.tab), book: Array.from(T.oxWorkbook(rep)) };
    });
    assert.deepEqual(r.autos, ["Ann Alpha", "Bob Beta", "Cara Nowhere", "Dan Nowhere", "Eve Lane", "Fay Lane"]);
    assert.equal(r.keys[0].replace(/#.*/, ""), r.keys[1].replace(/#.*/, ""), "one building");
    assert.deepEqual([r.keys[0].endsWith("#ann"), r.keys[1].endsWith("#bob"), r.keys[2], r.keys[3]], [true, true, "n:cara nowhere", "n:dan nowhere"]);
    assert.ok(r.keys[4].startsWith("a:") && r.keys[5].startsWith("a:") && r.keys[4] !== r.keys[5], "addresses the key can't read, apart: " + r.keys.slice(4));
    assert.deepEqual(r.tabs, ["A".repeat(30), "A".repeat(29) + " 2", "Christopher Alexander Johnston", "Pat", "Pat 2"]);
    const parts = unzip(Buffer.from(r.book)), b = await readParts(parts);
    assert.deepEqual(b.bad, [], "every part parses");
    assert.deepEqual(b.sheets.map((s) => s.name).slice(1, 6), r.tabs);
    const A = sheet(b, "All Orders"), row = Object.keys(A.cells).find((x) => /^C\d+$/.test(x) && A.cells[x].v === "10").slice(1);
    assert.equal(val(A, "G" + row), "BadItem", "characters XML can't hold are left out");
    assert.match(parts["xl/worksheets/sheet7.xml"], /_x005F_x0041_@example\.com/, "text like SpreadsheetML's own escape is escaped");
  });

  await test("a canceled order doesn't change the title, the file or the descriptions; one store over two days is named for it", async () => {
    const r = await page.evaluate(() => {
      const T = window.__t, b = { qty: "1", priceEach: "10.00", total: "10.70", card: "Visa ••1234", inbox: "x@example.com", shipTo: "Sam", shipAddr: "1 A St, Sampletown, FL 33701" };
      const a = [Object.assign({ id: "c1", store: "target", item: "A", orderNo: "1", at: "2026-11-13", stage: "placed" }, b), Object.assign({ id: "c2", store: "pokemoncenter", item: "B", orderNo: "2", at: "2026-11-12", stage: "canceled" }, b)];
      const two = [Object.assign({ id: "d1", store: "target", item: "A", orderNo: "1", at: "2026-11-12", stage: "placed" }, b), Object.assign({ id: "d2", store: "target", item: "B", orderNo: "2", at: "2026-11-13", stage: "placed" }, b)];
      const ra = T.oxReport(a, T.oxGroups(a, {}), ""), rt = T.oxReport(two, T.oxGroups(two, {}), "");
      return [ra.title, ra.file, ra.lines.map((l) => l.desc), rt.title, rt.file];
    });
    assert.deepEqual(r, ["Target orders placed 11/13/2026 - successful, no cancellations", "Target_Orders_11-13-2026.xlsx", ["A x1 @ $10.00 + $0.70 tax"],
      "Target orders placed 11/12/2026 to 11/13/2026 - successful, no cancellations", "Target_Orders_11-12-2026_to_11-13-2026.xlsx"]);
  });

  await test("past Excel's 8,192 characters a formula, GRAND TOTAL sums the subtotals with SUMIF; a long title wraps", async () => {
    const bytes = await page.evaluate(() => {
      const T = window.__t, os = [];
      for (let i = 0; i < 1500; i++) os.push({ id: "p" + i, store: "target", item: "A", orderNo: String(100000 + i), qty: "1", priceEach: "10.00", total: "10.70", stage: "placed", at: "2026-11-13",
        card: "Visa ••1234", inbox: "x@example.com", shipTo: "Person " + i, shipAddr: (1000 + i) + " A St, Sampletown, FL 33701" });
      return Array.from(T.oxWorkbook(T.oxReport(os, T.oxGroups(os, {}), "A title long enough that it can't fit on one line across the Summary's four columns at fourteen points")));
    });
    const x = unzip(Buffer.from(bytes))["xl/worksheets/sheet1.xml"];
    const gt = /<c r="C(\d+)"[^>]*><f>SUMIF\(B5:B(\d+),&quot;Subtotal - \*&quot;,C5:C(\d+)\)<\/f><v>1500<\/v><\/c>/.exec(x);
    assert.ok(gt, "GRAND TOTAL's count is a SUMIF of the subtotals");
    assert.deepEqual([+gt[2], +gt[3]], [+gt[1] - 1, +gt[1] - 1]);
    assert.match(x, new RegExp(`<c r="D${gt[1]}"[^>]*><f>SUMIF\\(B5:B${+gt[1] - 1},&quot;Subtotal - \\*&quot;,D5:D${+gt[1] - 1}\\)</f><v>16050</v></c>`));
    assert.match(x, /<row r="1" ht="43\.5" customHeight="1">/);
    assert.ok([...x.matchAll(/<f>([^<]*)<\/f>/g)].every((m) => m[1].length < 8192), "no formula past Excel's limit");
  });

  await test("every order picked canceled: no person's tab, zero totals, still a workbook that parses", async () => {
    const parts = await page.evaluate(() => {
      const T = window.__t, os = [{ id: "c1", store: "target", item: "A", orderNo: "1", qty: "1", total: "10.70", at: "2026-11-13", stage: "canceled", inbox: "x@example.com" }];
      const rep = T.oxReport(os, T.oxGroups(os, {}), ""); return Array.from(T.oxWorkbook(rep));
    });
    const { writeFileSync, mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
    const p = join(mkdtempSync(join(tmpdir(), "ox-")), "c.xlsx"); writeFileSync(p, Buffer.from(parts));
    const b = await readBook(p);
    assert.deepEqual(b.bad, []);
    assert.deepEqual(b.sheets.map((s) => s.name), ["Summary", "All Orders", "Cancelled (excluded)"]);
    const S = sheet(b, "Summary"), A = sheet(b, "All Orders");
    assert.deepEqual([val(S, "B5"), val(S, "C5"), val(S, "D5"), fx(S, "D6")], ["GRAND TOTAL", 0, 0, "ROUND(D5-'All Orders'!L2,2)"]);
    assert.deepEqual([val(A, "K2"), val(A, "L2"), fx(A, "L2"), A.filter], ["Total", 0, null, "A1:O1"]);
  });

  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
