// Tests that the newest page (index-X.Y.Z.html) calls its orders page Dashboard, from 1.9.152 (the owner's request, 2026-11-16,
// with a screenshot of the sidebar's Orders: "Change orders to Dashboard"): the sidebar, the phone's tabs and the page's
// heading say Dashboard, and so does the help that sends someone there. Its id stays "orders" (data-id, UI.view), so saved
// views, notifications and the tests that click it are as before. The real page runs in Chromium (Playwright), as the web
// version at app.fafoaco.com, on a vault made with Use this browser only.
//   node .github/scripts/dashboard.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have the Dashboard heading; a page named on the command line that doesn't is skipped.
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
if (!/<h1 class="view-title">Dashboard<\/h1>/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no Dashboard heading: update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Dashboard heading, skipped`); process.exit(0);
}
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// The help that sends someone to the page, as the page writes it; none still says the Orders page.
test.source = () => {
  assert.equal(/\bthe Orders page\b|\bOrders page\b|\bin <strong>Orders<\/strong>|\badds it to Orders\b|Pick orders on Orders\b/.test(HTML.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")), false,
    "no help text names the Orders page");
};

console.log(`Dashboard in ${file.split(/[\\/]/).pop()}`);
const browser = await chromium.launch();
const errors = [];
async function vault(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: "en-US", ...extra });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML }) : route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, body: "" });   // no license key here: nothing is asked of the license server
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });   // walkthrough.test.mjs tests the guide
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://app.fafoaco.com/");
  await page.waitForSelector("#lock-local");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", "correct horse battery"); await page.fill("#pw2", "correct horse battery"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 });
  return { ctx, page };
}
try {
  await test("no help text still names the Orders page", async () => test.source());

  await test("a desktop: the sidebar's first item and the page's heading say Dashboard, with the orders' count", async () => {
    const { ctx, page } = await vault({ width: 1280, height: 860 });
    assert.equal(await page.$eval('#side [data-id="orders"] span', (e) => e.textContent), "Dashboard");
    assert.equal(await page.$eval('#side [data-id="orders"] .n', (e) => e.textContent), "0");
    assert.equal(await page.$eval('#side [data-id="orders"]', (e) => e.getAttribute("aria-current")), "true", "FAFO opens on it");
    assert.equal(await page.$eval("#main .view-title", (e) => e.textContent), "Dashboard");
    // Elsewhere and back: the same item, the same heading.
    await page.click('#side [data-id="profiles"]');
    await page.waitForFunction(() => document.querySelector("#main .view-title") && document.querySelector("#main .view-title").textContent !== "Dashboard");
    await page.click('#side [data-id="orders"]');
    await page.waitForFunction(() => document.querySelector("#main .view-title").textContent === "Dashboard");
    assert.equal(await page.$$eval("#side .nav-item span:first-child", (l) => l.filter((s) => s.textContent === "Orders").length), 0, "no sidebar item says Orders");
    await ctx.close();
  });

  await test("a phone: the first of the tabs along the top says Dashboard", async () => {
    const { ctx, page } = await vault({ width: 375, height: 667 }, { isMobile: true, hasTouch: true });
    const first = await page.$eval("#mnav [data-id]", (b) => ({ id: b.dataset.id, text: b.textContent.trim() }));
    assert.equal(first.id, "orders");
    assert.match(first.text, /^Dashboard\d*$/, "the label, then the count");
    assert.equal(await page.$$eval("#mnav [data-id]", (l) => l.filter((b) => /^Orders(\d|$)/.test(b.textContent.trim())).length), 0, "no tab says Orders");
    await ctx.close();
  });

  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
