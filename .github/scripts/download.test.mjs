// Tests where the newest page (index-X.Y.Z.html) sends someone for a new download of FAFO, from 1.9.146 (the owner's request,
// 2026-11-13: "anytime a new update is available, can you have the version in the description"): the front page's
// https://fafoaco.com/download, which the web worker sends on to the newest release's FAFO-Windows-<version>.zip, so the file
// a browser saves has its version in its name. A signed update's own installerUrl still comes first, and a device that only
// reaches the license server at its old address (a network that blocks the new domain, which would block fafoaco.com too)
// gets GitHub's latest FAFO-Windows.zip (APP_DOWNLOAD), as pages before 1.9.146 do. The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, against a pretend license worker, as billing.test.mjs runs it: the lock
// screen's Get it, the top bar's New version once unlocked (a vault made with Use this browser only), and updAction itself.
//   node .github/scripts/download.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have appDownload; a page named on the command line that doesn't is skipped.
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
if (!/const appDownload = /.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no appDownload: update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no appDownload, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {UPD, setUpdateIndicators, updAction, appDownload, relayUse, relayProbe, APP_DOWNLOAD, RELAY_NEW, RELAY_OLD, get LICENSE_RELAY(){ return LICENSE_RELAY; }, get relayBusy(){ return !!relayProbing; }};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

const SITE = "https://fafoaco.com/download";
const GITHUB = "https://github.com/dolamv-coder/profile-vault-updates/releases/latest/download/FAFO-Windows.zip";
const NEW = "https://license.fafoaco.com", OLD = "https://orbit-license.orbit-app.workers.dev";

// ---- The pretend license worker: up or down at each address (a network that blocks the new domain) ----
const W = { up: { [NEW]: true, [OLD]: true }, ready: { [NEW]: 0, [OLD]: 0 } };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  if (!W.up[u.origin]) return route.abort("connectionrefused");
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (u.pathname === "/discord/ready") { W.ready[u.origin]++; return json(route, 200, { ready: true }); }
  return json(route, 401, { error: "license not recognized" });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
await ctx.route("**/*", async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  if (u.origin === NEW || u.origin === OLD) return worker(route, req, u);
  return route.fulfill({ status: 404, body: "" });
});
// What the page opens (window.open), recorded rather than opened; the setup guide doesn't ask here (walkthrough.test.mjs).
await ctx.addInitScript(() => {
  window.__opened = [];
  window.open = (...a) => { window.__opened.push(a); return null; };
  try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ev = (fn, arg) => page.evaluate(fn, arg);
// A signed update that needs a new download, as the desktop app's updater reports it (installerUrl "" unless signed with one).
const needsDownload = (installerUrl = "") => ev((u) => { const T = window.__t; T.UPD.status = { state: "needs-installer", version: "1.9.200", notes: "Sample notes.", installerUrl: u }; T.setUpdateIndicators(); }, installerUrl);
const opened = () => ev(() => window.__opened.splice(0).map((a) => a[0]));
// Clicks a button and returns what it opened (one address), with the toast that says so.
async function clickOpens(sel) {
  await page.click(sel);
  await page.waitForFunction(() => window.__opened.length > 0);
  const got = await opened();
  assert.equal(got.length, 1, "opened once");
  await page.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((t) => /Opening the download in your browser/.test(t.textContent)));
  return got[0];
}
const relay = () => ev(() => window.__t.LICENSE_RELAY);
// The page looks for the address that answers on its own too (1.2 seconds after it loads, and when a request can't
// connect), so a test that puts it on the old address does so as a network that blocks the new domain would: with the
// new address down, once a look under way has finished, so no look can move it back meanwhile.
const notLooking = () => page.waitForFunction(() => !window.__t.relayBusy);
const useOld = async () => { W.up[NEW] = false; await notLooking(); await ev(() => window.__t.relayUse(window.__t.RELAY_OLD)); };
const useNew = async () => { await notLooking(); W.up[NEW] = true; await ev(() => window.__t.relayUse(window.__t.RELAY_NEW)); };

console.log(`Where a new download comes from in ${file.split(/[\\/]/).pop()}`);
try {
  await test("the page's source: APP_DOWNLOAD is GitHub's latest FAFO-Windows.zip, used only by appDownload, and updAction opens appDownload()", async () => {
    assert.match(HTML, /const APP_DOWNLOAD = "https:\/\/github\.com\/dolamv-coder\/profile-vault-updates\/releases\/latest\/download\/FAFO-Windows\.zip";/);
    assert.match(HTML, /const SITE_DOWNLOAD = "https:\/\/fafoaco\.com\/download";/);
    const code = HTML.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");   // the comments may name it
    assert.equal((code.match(/\bAPP_DOWNLOAD\b/g) || []).length, 2, "its definition and appDownload");
    assert.match(HTML, /const appDownload = \(\) => LICENSE_RELAY === RELAY_OLD \? APP_DOWNLOAD : SITE_DOWNLOAD;/);
    assert.match(HTML, /UPD\.status\.installerUrl : appDownload\(\);/);
    assert.doesNotMatch(HTML.replace(/const APP_DOWNLOAD = "[^"]+";/, ""), /Windows\.zip"/, "no other link to the zip");
  });

  await page.goto("https://app.fafoaco.com/");
  await page.waitForSelector("#lock-upd", { state: "attached" });
  // Its look at which license server address answers (1.2 seconds after it starts): the new one here.
  await page.waitForFunction(() => window.__t && !!window.__t.UPD);
  for (let i = 0; i < 100 && !W.ready[NEW]; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(W.ready[NEW] > 0, "the page asked which address answers");

  await test("the lock screen's Get it opens https://fafoaco.com/download (the newest release's zip, named with its version)", async () => {
    assert.equal(await relay(), NEW);
    await needsDownload();
    assert.match(await page.$eval("#lock-upd", (e) => e.textContent), /New version 1\.9\.200 needs a new download/);
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), SITE);
    assert.equal(await ev(() => window.__t.appDownload()), SITE);
  });

  await test("a signed update's own installerUrl comes first (https only: anything else is the newest download)", async () => {
    await needsDownload("https://downloads.example.com/FAFO-Setup-1.9.200.zip");
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), "https://downloads.example.com/FAFO-Setup-1.9.200.zip");
    for (const u of ["http://downloads.example.com/FAFO.zip", "javascript:alert(1)", " https://x.example.com/a.zip"]) {
      await needsDownload(u);
      assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), SITE, u);
    }
    // updAction itself, as every Get the newest FAFO button calls it.
    await needsDownload();
    await ev(() => window.__t.updAction("upd-get"));
    assert.deepEqual(await opened(), [SITE]);
  });

  await test("on the license server's old address (a network that blocks the new domain): GitHub's latest FAFO-Windows.zip, decided at the click", async () => {
    await useOld();
    await needsDownload();
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), GITHUB);
    await needsDownload("https://downloads.example.com/FAFO-Setup-1.9.200.zip");
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), "https://downloads.example.com/FAFO-Setup-1.9.200.zip", "a signed installerUrl still first");
    await useNew();
    await needsDownload();
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), SITE);
  });

  await test("a network that blocks the new domain: after the page's own look finds only the old address, and after a reload (kept 6 hours), GitHub's zip", async () => {
    W.up[NEW] = false;
    W.ready[OLD] = 0;
    await page.reload();
    await page.waitForFunction(() => window.__t && window.__t.LICENSE_RELAY === window.__t.RELAY_OLD, null, { timeout: 15000 });
    assert.ok(W.ready[OLD] > 0);
    await needsDownload();
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), GITHUB);
    await page.reload();
    await page.waitForFunction(() => window.__t && !!window.__t.UPD);
    assert.equal(await relay(), OLD, "kept from the last look");
    await needsDownload();
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), GITHUB);
    // The new domain answers again: the next look moves back, and so does the download.
    W.up[NEW] = true;
    await ev(() => window.__t.relayProbe(0));
    assert.equal(await relay(), NEW);
    await needsDownload();
    assert.equal(await clickOpens('#lock-upd [data-act="upd-get"]'), SITE);
  });

  await test("unlocked: the top bar's New version opens https://fafoaco.com/download too", async () => {
    await page.click("#lock-local");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
    await page.fill("#pw1", "sample-pass-146"); await page.fill("#pw2", "sample-pass-146"); await page.click("#lock-go");
    await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
    await needsDownload();
    await page.waitForSelector('#top-update:not([hidden])');
    assert.equal(await page.$eval("#top-update", (e) => e.dataset.act), "upd-get");
    assert.equal(await clickOpens("#top-update"), SITE);
    await useOld();
    assert.equal(await clickOpens("#top-update"), GITHUB);
    await useNew();
  });

  assert.deepEqual(errors, [], "no errors on the page");
  console.log(`\n${passed} passed`);
} finally {
  await browser.close();
}
