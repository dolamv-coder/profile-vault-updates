// Tests the web version's inbox Test in the newest page (index-X.Y.Z.html), from 1.9.149 (the owner, 2026-11-14, with a
// screenshot of the web version's saved inboxes, each with a disabled Test and "Status shows in the desktop app": "how come
// I can't test the connection while on the website?"; offered a test from the license worker, with its caveats: "put it in
// 1.9.149"). The real page runs in Chromium (Playwright), as the web version at app.fafoaco.com, against a pretend license
// worker whose POST /inbox/test answers by the inbox's address (its first word: ok, bad, blocked…), as imap-submit.test.mjs
// runs it: a vault made with Use this browser only, then a license key kept as Submit keeps one typed there. It checks no key
// (no Test, no request), the caveat once per device, what's sent (the address without its +tag, the app password cleaned,
// port 993), the cards' statuses and words (the server's words escaped), which results count as an Inbox error on Store
// logins and IMAP, one test at a time from IMAP's cards, the inbox editor and the setup's Check and use, locking or deleting
// an inbox mid-test, results kept on this device only (never synced, never on the inboxes), changed credentials, the
// editor's and the setup's results kept on Save, the seller's own FAFO, and the desktop's code left as it was. Sample
// addresses, made-up app passwords and keys only.
//   node .github/scripts/web-inbox-test.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must test inboxes from the web version ("/inbox/test"); a page named on the command line that doesn't is
// skipped.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!HTML.includes('"/inbox/test"')) {
  if (!process.argv[2]) { console.error(`${file} doesn't test inboxes from the web version ("/inbox/test"): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no inbox test from the web version, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, refreshPremium, isPremiumOwner, lock, syncUnits,"
  + " get inboxTestMem(){ return inboxTestMem; }, set inboxTestMem(v){ inboxTestMem = v; }};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const W = { tests: [], owner: false };
// POST /inbox/test answers by the address's first word, without a number at its end (slow2 is slow): [status, body, wait].
const ANSWERS = {
  ok: [200, { ok: true, messages: 42 }],
  bad: [200, { ok: false, why: "auth", text: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)" }],
  blocked: [200, { ok: false, why: "blocked", text: "[WEBALERT https://accounts.google.com/sample] Web login required." }],
  nomsg: [200, { ok: true }],
  slow: [200, { ok: true, messages: 42 }, 1500],
  busy: [429, { error: "busy" }],
  limit: [429, { error: "limit", limit: 30 }],
  fails: [429, { error: "fails", limit: 10 }],
  throttle: [200, { ok: false, why: "server", text: "[ALERT] Too many simultaneous connections. (Failure)" }],
  far: [200, { ok: false, why: "connect", text: "" }],
  net: [200, { ok: false, why: "auth", text: "Temporary network problem, sample" }],
  xss: [200, { ok: false, why: "auth", text: "<img src=x onerror=window.__xss=1>LOGIN failed." }],
  everyone: [429, { error: "everyone", retryAfter: 3600 }],
  newer: [200, { ok: false, why: "later-kind", text: "sample" }],
};
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ready: true });
  if (p === "/inbox/test" && m === "POST") {
    const body = JSON.parse(req.postData());
    W.tests.push({ body, auth });
    if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
    const k = String(body.email).split("@")[0].split(".")[0].replace(/\d+$/, "");
    if (k === "gone") return route.abort();
    const [status, answer, wait] = ANSWERS[k] || [200, { ok: true, messages: 3 }];
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return json(route, status, answer);
  }
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: W.owner, owner: W.owner });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 50, request: null, canRequest: true });
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/*", async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
  return route.fulfill({ status: 404, body: "" });
});
// The setup guide (1.9.145) doesn't ask here (Not now, until far ahead): its own test is walkthrough.test.mjs. Every toast
// the page shows is recorded, as one can come and go between two looks.
await ctx.addInitScript(() => {
  try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {}
  window.__toasts = [];
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })
    .observe(document, { childList: true, subtree: true });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const PW = "sample-pass-149";
const ready = () => page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
const VIEW_TITLE = { imap: "IMAP", logins: "Store logins" };
const view = async (id) => {
  await page.click(`#side [data-id="${id}"]`);
  await page.waitForFunction((t) => { const h = document.querySelector("#main .view-title"); return h && h.textContent === t; }, VIEW_TITLE[id]);
};
const cardOf = (id) => page.$eval(`#main [data-id="${id}"]`, (b) => b.closest("article").innerText.replace(/\s+/g, " ").trim());   // as it reads, lines apart
const testBtns = () => page.$$eval('#main .item-actions [data-act="test-inbox"]', (bs) => bs.map((b) => ({ id: b.dataset.id, disabled: b.disabled, text: b.textContent.trim() })));
const kpis = () => text("#main .p-kpis");
const toasts = () => ev(() => window.__toasts.slice());
const ibx = () => ev(() => { const L = window.__t.S._local; return L && L.ibx ? JSON.parse(JSON.stringify(L.ibx)) : {}; });
const caveatOpen = () => page.$$eval("#layers .panel-head h2", (hs) => hs.some((h) => h.textContent === "Test from FAFO's server?"));
const until = async (cond, what, ms = 10000) => { for (const t0 = Date.now(); !(await cond());) { if (Date.now() - t0 > ms) throw new Error("waited too long for " + what); await new Promise((r) => setTimeout(r, 25)); } };
// Closes the windows open, the top one first, by their x (a click that closes the setup drops the next one for 400 ms).
const closeLayers = async () => {
  for (let i = 0; i < 6; i++) {
    const xs = await page.$$("#layers .layer:not([inert]) .panel-head [data-close]");
    if (!xs.length) break;
    await xs.at(-1).click();
    await page.waitForTimeout(450);
  }
  await page.waitForFunction(() => !document.querySelector("#layers .panel"));
};
// Locks the vault (as auto-lock does, so also with a window open) and unlocks it again.
async function relock() {
  await ev(() => window.__t.lock("Locked."));
  await page.waitForSelector("#pw1");
  await page.fill("#pw1", PW);   // the lock screen unlocks as the password is typed
  await ready();
}
// Test on an IMAP card, the caveat already seen: waits for its answer to be drawn.
async function cardTest(id) {
  const n = W.tests.length;
  await page.click(`#main [data-act="test-inbox"][data-id="${id}"]`);
  await until(() => W.tests.length > n, "the request for " + id);
  await page.waitForFunction((x) => { const b = document.querySelector(`#main [data-act="test-inbox"][data-id="${x}"]`); return b && !b.disabled; }, id);
  return W.tests.at(-1);
}
const INBOX = (id, email, extra = {}) => Object.assign({ id, email, password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993" }, extra);

console.log(`Testing an inbox from the web version in ${file.split(/[\\/]/).pop()}`);
try {
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
  await ready();
  // The vault: inboxes answered each way, Target logins on a few of them, no license key yet.
  await ev(({ INB }) => {
    const T = window.__t, S = T.S;
    S.inboxes.push(...INB);
    for (const [id, email, inboxId] of [["l-ok", "ok.login@example.com", "ib-ok"], ["l-bad", "bad.login@example.com", "ib-bad"], ["l-blocked", "blocked.login@example.com", "ib-blocked"],
      ["l-throttle", "throttle.login@example.com", "ib-throttle"], ["l-far", "far.login@example.com", "ib-far"], ["l-xss", "xss.login@example.com", "ib-xss"]]) {
      S.logins.push({ id, store: "target", email, password: "Store-Pw-Sample", inboxId });
    }
    T.persist(); T.render();
  }, { INB: [
    // A Gmail app password saved with its spaces (as a vault from before they were taken off may have it): sent without.
    INBOX("ib-ok", "ok.sample@gmail.com", { password: "abcd efgh ijkl mnop" }), INBOX("ib-bad", "bad.sample@gmail.com"), INBOX("ib-blocked", "blocked.sample@gmail.com"),
    INBOX("ib-nomsg", "nomsg.sample@example.com", { provider: "custom", host: "mail.example.com", password: "Sample-Nomsg-Pw" }),
    INBOX("ib-slow", "slow.sample@gmail.com"), INBOX("ib-slow2", "slow2.sample@gmail.com"), INBOX("ib-slow3", "slow3.sample@gmail.com"), INBOX("ib-slow4", "slow4.sample@gmail.com"),
    INBOX("ib-busy", "busy.sample@gmail.com"), INBOX("ib-limit", "limit.sample@gmail.com"), INBOX("ib-fails", "fails.sample@gmail.com"), INBOX("ib-gone", "gone.sample@gmail.com"),
    INBOX("ib-throttle", "throttle.sample@gmail.com"), INBOX("ib-far", "far.sample@gmail.com"), INBOX("ib-net", "net.sample@gmail.com"),
    INBOX("ib-xss", "xss.sample@example.com", { provider: "custom", host: "mail.example.com", password: "Sample-Xss-Pw" }),
    INBOX("ib-everyone", "everyone.sample@gmail.com"), INBOX("ib-newer", "newer.sample@gmail.com"),
    // Saved with a +tag, as Add inbox keeps one: a mail server's username has none.
    INBOX("ib-tag", "tag.sample+box@gmail.com"),
  ] });
  const KEYS0 = await ev(() => Object.fromEntries(window.__t.S.inboxes.map((i) => [i.id, Object.keys(i).sort().join(",")])));

  await test("no license key yet: Test is off with what to do, the status is the desktop app's, and nothing is sent", async () => {
    await view("imap");
    const b = await page.$eval('#main article .item-actions button', (x) => ({ disabled: x.disabled, title: x.title, act: x.dataset.act || "" }));
    assert.deepEqual(b, { disabled: true, title: "Test needs your license key in this browser: Settings, then Web version & sync, then Turn on sync. Or test it in the desktop app.", act: "" });
    assert.ok(!(await page.$('#main [data-act="test-inbox"]')), "no live Test");
    const main = await text("#main");
    assert.match(main, /Status shows in the desktop app/);
    assert.doesNotMatch(main, /Not checked here yet/);
    assert.match(main, /FAFO signs in to check an inbox only in the desktop app/);
    assert.match(main, /To test an inbox here, add your license key: Settings, then Web version & sync, then Turn on sync\./);
    assert.doesNotMatch(main, /Test signs in from FAFO's server/);
    await view("logins");
    await page.click('#main .view-tools [data-act="new-inbox-only"]');
    await page.waitForSelector("#layers #i-save");
    assert.ok(!(await page.$("#layers #i-test")), "Add inbox has no Test");
    assert.doesNotMatch(await text("#layers .panel"), /a check that it signs in/);
    // The setup's Paste it step, as before.
    await page.click("#layers [data-ig-start]");
    await page.waitForSelector('#layers [name="g_email"]');
    await page.fill('#layers [name="g_email"]', "fresh0.setup@gmail.com");
    await page.waitForTimeout(450); await page.click("#layers #ig-go");
    await page.waitForTimeout(450); await page.click("#layers #ig-go");
    await page.waitForSelector('#layers [name="g_password"]');
    assert.match(await text("#layers #ig-body"), /A browser can't sign in to email, so it isn't checked here\./);
    assert.equal(await text("#layers #ig-go"), "Use this inbox");
    await closeLayers();
    assert.equal(W.tests.length, 0, "no /inbox/test request");
  });

  await test("with the license key: a live Test and the new note; the caveat first (Not now sends nothing), then exactly the inbox's address, app password, server and port", async () => {
    await ev((lic) => { const T = window.__t; T.keepTypedLic(lic); T.persist(); T.render(); }, LIC);
    await view("imap");
    const main = await text("#main");
    assert.ok(main.includes("You're on the web version. Test checks an inbox by signing in to it from FAFO's server, then signing out. Reading your email to pull in your orders happens only in the desktop app — the web version can't read email, so here you track orders by pasting their confirmation emails. Your inbox passwords are kept in your encrypted vault, and leave it only when you press Test (FAFO's server signs in with it and keeps nothing) and with the slots you submit on that inbox's accounts."), main.slice(0, 1500));
    assert.match(main, /One inbox can serve several store logins\. Test signs in from FAFO's server; the status is this browser's last test\./);
    assert.match(await cardOf("ib-ok"), /Not checked here yet/);
    assert.ok((await testBtns()).every((b) => !b.disabled && b.text === "Test"));
    await page.click('#main [data-act="test-inbox"][data-id="ib-ok"]');
    await page.waitForSelector("#layers #cf-go");
    const said = await text("#layers .panel");
    assert.match(said, /Test from FAFO's server\?/);
    for (const x of ["FAFO's server", "security alert", "It keeps nothing", "That alert is this test."]) assert.ok(said.includes(x), x);
    assert.equal(await text("#layers #cf-go"), "Test it");
    await page.click("#layers [data-cf-no]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await page.waitForTimeout(300);
    assert.equal(W.tests.length, 0, "Not now: no request");
    assert.ok((await testBtns()).every((b) => !b.disabled && b.text === "Test"), "nothing left marked");
    await page.click('#main [data-act="test-inbox"][data-id="ib-ok"]');
    await page.click("#layers #cf-go");
    await until(() => W.tests.length === 1, "the request");
    assert.deepEqual(W.tests[0], { body: { email: "ok.sample@gmail.com", password: "abcdefghijklmnop", host: "imap.gmail.com", port: "993" }, auth: "Bearer " + LIC });
    await page.waitForFunction(() => /Connected · checked just now/.test(document.querySelector('#main [data-id="ib-ok"]').closest("article").textContent.replace(/\s+/g, " ")));
    assert.ok((await toasts()).includes("ok.sample@gmail.com: signed in from FAFO's server."));
  });
  await test("Testing… and the spinner while it runs, then Connected; the +tag inbox goes without its tag", async () => {
    await page.click('#main [data-act="test-inbox"][data-id="ib-slow"]');
    await page.waitForFunction(() => /Signing in from FAFO's server…/.test(document.querySelector('#main [data-id="ib-slow"]').closest("article").textContent));
    assert.ok(await page.$('#main article:has([data-id="ib-slow"]) .spin'), "the spinner");
    const bs = await testBtns();
    assert.deepEqual(bs.filter((b) => b.text === "Testing…").map((b) => b.id), ["ib-slow"]);
    assert.ok(bs.every((b) => b.disabled), "every card's Test is off meanwhile");
    await page.waitForFunction(() => /Connected · checked just now/.test(document.querySelector('#main [data-id="ib-slow"]').closest("article").textContent.replace(/\s+/g, " ")));
    const t = await cardTest("ib-tag");
    assert.equal(t.body.email, "tag.sample@gmail.com");
    assert.ok(!JSON.stringify(W.tests).includes("+box"));
  });

  await test("once per device; a wrong password is an Inbox error with Gmail's advice, on IMAP and Store logins, in every layout", async () => {
    const n = W.tests.length;
    await page.click('#main [data-act="test-inbox"][data-id="ib-bad"]');
    await until(() => W.tests.length > n, "the request");
    assert.equal(await caveatOpen(), false, "no caveat window the second time");
    await page.waitForFunction(() => /Error/.test(document.querySelector('#main [data-id="ib-bad"]').closest("article").textContent));
    const c = await cardOf("ib-bad");
    assert.match(c, /Error · checked just now/);
    assert.match(c, /Gmail didn't accept the password for bad\.sample@gmail\.com\. Use an app password \(not your normal password\) made while signed in as bad\.sample@gmail\.com, and paste all of it\. \(Details: \[AUTHENTICATIONFAILED\] Invalid credentials \(Failure\)\)/);
    assert.ok(await page.$eval('#main article:has([data-id="ib-bad"]) .item-sub[style*="danger"]', (e) => !!e), "in red");
    assert.match(await kpis(), /Inbox error 1/);
    assert.ok((await toasts()).includes("Couldn't sign in to bad.sample@gmail.com from FAFO's server. Its card says why."));
    await view("logins");
    assert.match(await kpis(), /Inbox error 1/);
    const pill = await page.$eval('#main .slip:has(.ppill-bad)', (e) => ({ text: e.querySelector(".ppill-bad").textContent, title: e.querySelector(".ppill-bad").title, who: e.textContent }));
    assert.equal(pill.text, "Inbox error");
    assert.ok(pill.title.startsWith("FAFO's server couldn't sign in (Test on IMAP): Gmail didn't accept the password for bad.sample@gmail.com."), pill.title);
    assert.match(pill.who, /bad\.login@example\.com/);
    for (const v of ["compact", "list"]) {
      await page.click(`#main [data-act="login-view"][data-id="${v}"]`);
      const marks = await page.$$eval("#main .lst-err", (es) => es.map((e) => [e.textContent, e.title.startsWith("FAFO's server couldn't sign in (Test on IMAP): Gmail didn't accept")]));
      assert.deepEqual(marks, [["Error", true]], v);
    }
    await page.click('#main [data-act="login-view"][data-id="comfortable"]');
    await view("imap");
  });
  await test("blocked, throttled and unreachable: their words under Couldn't check from FAFO's server, not red, and no Inbox error", async () => {
    for (const id of ["ib-blocked", "ib-throttle", "ib-far"]) await cardTest(id);
    assert.match(await cardOf("ib-blocked"), /Couldn't check from FAFO's server · checked just now Gmail stopped this sign-in because it came from FAFO's server, not your computer\. Sign in to blocked\.sample@gmail\.com in your browser, confirm it was you if it asks, then test again\. The desktop app signs in from your computer\./);
    assert.match(await cardOf("ib-throttle"), /Couldn't check from FAFO's server · checked just now Gmail had a temporary problem or is limiting sign-ins\. Try again in a few minutes\. \(Details: \[ALERT\] Too many simultaneous connections\. \(Failure\)\)/);
    assert.match(await cardOf("ib-far"), /Couldn't check from FAFO's server · checked just now FAFO's server couldn't reach Gmail just now\. Try again in a few minutes\./);
    for (const id of ["ib-blocked", "ib-throttle", "ib-far"]) {
      const red = await page.$$eval(`#main article:has([data-id="${id}"]) [style*="danger"]`, (es) => es.length);
      assert.equal(red, 0, id + " isn't red");
      assert.doesNotMatch(await cardOf(id), /Error/, id);
    }
    assert.match(await kpis(), /Inbox error 1/);
    await view("logins");
    for (const who of ["blocked.login", "throttle.login", "far.login"]) {
      assert.equal(await page.$eval(`#main .slip:has-text("${who}@example.com") .l-inbox-line .ppill`, (e) => e.textContent), "Inbox connected", who);
    }
    await view("imap");
  });
  await test("mailError's network words never show for FAFO's server's sign-in; the server's words are text, never markup", async () => {
    await cardTest("ib-net");
    const net = await cardOf("ib-net");
    assert.match(net, /Gmail didn't accept the email or app password for net\.sample@gmail\.com\. \(Details: Temporary network problem, sample\)/);
    assert.doesNotMatch(net, /internet connection|antivirus|FAFO\.exe/);
    await cardTest("ib-xss");
    assert.match(await cardOf("ib-xss"), /\(Details: <img src=x onerror=window\.__xss=1>LOGIN failed\.\)/);
    assert.equal(await page.$('#main img[src="x"]'), null);
    assert.equal(await ev(() => window.__xss), undefined);
    await view("logins");
    const t = await page.$eval('#main .slip:has-text("xss.login@example.com") .ppill-bad', (e) => e.title);
    assert.ok(t.includes("<img src=x onerror=window.__xss=1>LOGIN failed."), t);
    assert.equal(await page.$('#main img[src="x"]'), null);
    assert.equal(await ev(() => window.__xss), undefined);
    await view("imap");
  });
  await test("a kind of answer this page doesn't know, and the cap across every license (a toast, nothing kept)", async () => {
    await cardTest("ib-newer");
    assert.match(await cardOf("ib-newer"), /Couldn't check from FAFO's server · checked just now FAFO's server couldn't sign in to newer\.sample@gmail\.com\. \(Details: sample\)/);
    await cardTest("ib-everyone");
    await until(async () => (await toasts()).includes("FAFO's server has tested as many inboxes as it can today. Try again tomorrow, or test it in the desktop app."), "the toast");
    assert.equal((await ibx())["ib-everyone"], undefined, "nothing noted");
    assert.match(await cardOf("ib-everyone"), /Not checked here yet/);
  });

  await test("one at a time: a double click on a card's Test sends one request, and every Test is off meanwhile", async () => {
    const n = W.tests.length;
    await page.dblclick('#main [data-act="test-inbox"][data-id="ib-slow2"]');
    await page.waitForTimeout(300);
    const bs = await testBtns();
    assert.ok(bs.every((b) => b.disabled));
    assert.deepEqual(bs.filter((b) => b.text === "Testing…").map((b) => b.id), ["ib-slow2"]);
    await page.waitForFunction(() => /Connected/.test(document.querySelector('#main [data-id="ib-slow2"]').closest("article").textContent));
    assert.equal(W.tests.length, n + 1);
  });
  await test("one at a time: a double click on the inbox editor's Test, and on the setup's Check and use, each send one request", async () => {
    await view("logins");
    let n = W.tests.length;
    await page.click('#main [data-act="edit-inbox"][data-id="ib-slow2"]');
    await page.waitForSelector("#layers #i-test");
    await page.dblclick("#layers #i-test");
    await page.waitForFunction(() => /Signed in from FAFO's server\. Your inbox has 42 emails\./.test(document.querySelector("#i-test-out").textContent));
    assert.equal(W.tests.length, n + 1, "the editor's Test");
    await closeLayers();
    n = W.tests.length;
    await page.click('#main .view-tools [data-act="new-inbox-only"]');
    await page.click("#layers [data-ig-start]");
    await page.fill('#layers [name="g_email"]', "slow.setup@gmail.com");
    await page.waitForTimeout(450); await page.click("#layers #ig-go");
    await page.waitForTimeout(450); await page.click("#layers #ig-go");
    await page.fill('#layers [name="g_password"]', "abcdefghijklmnop");
    await page.waitForTimeout(450);
    await page.dblclick("#layers #ig-go");
    await page.waitForFunction(() => !document.querySelector('#layers [name="g_password"]') && !/Signing in/.test(document.querySelector("#layers").textContent));
    assert.equal(W.tests.length, n + 1, "the setup's Check and use");
    await closeLayers();
    await view("imap");
  });
  await test("one at a time with the caveat still to say: a double click opens one window, the other Tests are off but none says Testing…, and Not now leaves nothing marked", async () => {
    await ev(() => { localStorage.removeItem("orbit-inbox-test-ok"); window.__t.inboxTestMem = false; });
    const n = W.tests.length;
    await page.dblclick('#main [data-act="test-inbox"][data-id="ib-slow4"]');
    await page.waitForSelector("#layers #cf-go");
    await page.waitForTimeout(300);
    assert.equal(await page.$$eval("#layers .panel", (ps) => ps.length), 1, "one window");
    const bs = await testBtns();
    assert.ok(bs.every((b) => b.disabled && b.text === "Test"), JSON.stringify(bs));
    assert.equal(await page.$("#main .spin"), null, "no spinner");
    await page.click("#layers [data-cf-no]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.ok((await testBtns()).every((b) => !b.disabled && b.text === "Test"));
    assert.equal(W.tests.length, n);
  });

  await test("locking mid-test: no toast, nothing noted; locking with the caveat open sends nothing; an inbox deleted mid-test gets no entry", async () => {
    // The caveat still to say: locking closes its window, and nothing goes out.
    let n = W.tests.length;
    await page.click('#main [data-act="test-inbox"][data-id="ib-slow3"]');
    await page.waitForSelector("#layers #cf-go");
    await relock();
    await page.waitForTimeout(400);
    assert.equal(W.tests.length, n, "no request");
    await view("imap");
    assert.ok((await testBtns()).every((b) => !b.disabled), "nothing marked after the lock");
    await ev(() => { localStorage.setItem("orbit-inbox-test-ok", "1"); });
    // A test running when the vault locks.
    n = W.tests.length;
    const t0 = (await toasts()).length;
    await page.click('#main [data-act="test-inbox"][data-id="ib-slow3"]');
    await until(() => W.tests.length > n, "the request");
    await relock();
    await page.waitForTimeout(2000);
    assert.deepEqual((await toasts()).slice(t0).filter((x) => /slow3/.test(x)), [], "no toast");
    assert.equal((await ibx())["ib-slow3"], undefined, "nothing noted");
    await view("imap");
    assert.match(await cardOf("ib-slow3"), /Not checked here yet/);
    // An inbox deleted while its test runs.
    n = W.tests.length;
    await page.click('#main [data-act="test-inbox"][data-id="ib-slow4"]');
    await until(() => W.tests.length > n, "the request");
    await ev(() => { const T = window.__t; T.S.inboxes = T.S.inboxes.filter((i) => i.id !== "ib-slow4"); T.persist(); T.render(); });
    await page.waitForTimeout(2000);
    assert.equal((await ibx())["ib-slow4"], undefined, "no entry for a deleted inbox");
  });

  await test("results stay on this device: across a lock and a reload, in the vault's own bookkeeping, never on the inboxes or in what sync sends", async () => {
    const before = await ibx();
    assert.deepEqual(Object.keys(before).sort(), ["ib-bad", "ib-blocked", "ib-far", "ib-net", "ib-newer", "ib-ok", "ib-slow", "ib-slow2", "ib-tag", "ib-throttle", "ib-xss"]);
    for (const r of Object.values(before)) assert.deepEqual(Object.keys(r).sort(), ["at", "f", "n", "ok", "text", "why"]);
    await relock();
    assert.deepEqual(await ibx(), before);
    await page.reload();
    await page.waitForSelector("#pw1");
    await page.fill("#pw1", PW);
    await ready();
    assert.deepEqual(await ibx(), before);
    await view("imap");
    assert.match(await cardOf("ib-ok"), /Connected/);
    assert.match(await cardOf("ib-bad"), /Error/);
    const n = W.tests.length;
    await page.click('#main [data-act="test-inbox"][data-id="ib-nomsg"]');
    await until(() => W.tests.length > n, "the request");
    assert.equal(await caveatOpen(), false, "no caveat window after a reload");
    const keys = await ev(() => Object.fromEntries(window.__t.S.inboxes.map((i) => [i.id, Object.keys(i).sort().join(",")])));
    for (const [id, k] of Object.entries(keys)) if (KEYS0[id]) assert.equal(k, KEYS0[id], id + " gained no field");
    assert.ok(Object.values(keys).every((k) => !/ibx|test|check|(^|,)f(,|$)/i.test(k)), JSON.stringify(keys));
    const sent = await ev(() => JSON.stringify([...window.__t.syncUnits(window.__t.S).map.values()].map((x) => x.v)));
    assert.ok(!sent.includes("ibx"), "no ibx in what sync sends");
    for (const r of Object.values(before)) assert.ok(!sent.includes(r.f), "no fingerprint either");
  });
  await test("a changed app password: the card says Not checked here yet, and the count's Inbox error goes", async () => {
    await view("logins");
    await page.click('#main [data-act="edit-inbox"][data-id="ib-bad"]');
    await page.waitForSelector("#layers #i-save");
    assert.match(await text("#layers .panel"), /Gmail didn't accept the password for bad\.sample@gmail\.com/, "the editor shows the last test's words");
    await page.fill('#layers [name="i_password"]', "zyxwvutsrqponmlk");
    await page.click("#layers #i-save");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.equal(await page.$eval('#main .slip:has-text("bad.login@example.com") .l-inbox-line .ppill', (e) => e.textContent), "Inbox connected");
    await view("imap");
    assert.match(await cardOf("ib-bad"), /Not checked here yet/);
    assert.match(await kpis(), /Inbox error 1/, "only xss's left");
  });

  await test("the inbox editor's Test: its words for each answer, the page's own checks before sending, and a new inbox's result kept on Save", async () => {
    await view("logins");
    const editorSays = async (id) => {
      await page.click(`#main [data-act="edit-inbox"][data-id="${id}"]`);
      await page.waitForSelector("#layers #i-test");
      await page.click("#layers #i-test");
      await page.waitForFunction(() => { const o = document.querySelector("#i-test-out"); return o && !o.hidden && !/Signing in/.test(o.textContent); });
      const t = await text("#i-test-out");
      await closeLayers();
      return t;
    };
    assert.equal(await editorSays("ib-ok"), "Signed in from FAFO's server. Your inbox has 42 emails.");
    assert.equal(await editorSays("ib-nomsg"), "Signed in from FAFO's server.");
    assert.equal(await editorSays("ib-busy"), "FAFO's server is already testing an inbox for you. Try again in a moment.");
    assert.equal(await editorSays("ib-limit"), "That's today's 30 inbox tests from FAFO's server. Try again tomorrow, or test it in the desktop app.");
    assert.equal(await editorSays("ib-fails"), "Too many sign-ins failed today, so FAFO's server won't try again until tomorrow (that keeps your provider from locking the account). Check the app password, then test again tomorrow or in the desktop app.");
    assert.equal(await editorSays("ib-everyone"), "FAFO's server has tested as many inboxes as it can today. Try again tomorrow, or test it in the desktop app.");
    assert.equal(await editorSays("ib-gone"), "Couldn't reach FAFO's server. Check your internet connection and try again.");
    for (const id of ["ib-busy", "ib-limit", "ib-fails", "ib-everyone", "ib-gone"]) assert.equal((await ibx())[id], undefined, id + " isn't noted");
    // Never sent: port 143, a password over 200 characters, an address with a colon.
    const n = W.tests.length;
    const addSays = async (f) => {
      await page.click('#main .view-tools [data-act="new-inbox-only"]');
      await page.waitForSelector("#layers #i-test");
      await page.fill('#layers [name="i_email"]', f.email);
      await page.selectOption('#layers [name="i_provider"]', f.provider || "custom");
      await page.fill('#layers [name="i_password"]', f.password || "Sample-Pw-Custom");
      if ((f.provider || "custom") === "custom") { await page.fill('#layers [name="i_host"]', "mail.example.com"); await page.fill('#layers [name="i_port"]', f.port || "993"); }
      await page.click("#layers #i-test");
      await page.waitForFunction(() => { const o = document.querySelector("#i-test-out"); return o && !o.hidden && !/Signing in/.test(o.textContent); });
      return text("#i-test-out");
    };
    assert.equal(await addSays({ email: "port.sample@example.com", port: "143" }), "FAFO's server only tests port 993 (SSL/TLS). Test this inbox in the desktop app.");
    await closeLayers();
    assert.equal(await addSays({ email: "long.sample@example.com", password: "p".repeat(201) }), "FAFO's server can't send that app password to the mail server as it is. Test this inbox in the desktop app.");
    await closeLayers();
    assert.equal(await addSays({ email: "co:lon.sample@example.com" }), "Check this inbox's email address.");
    await closeLayers();
    assert.equal(W.tests.length, n, "none of those was sent");
    // Add inbox, Test, Save: its card is Connected.
    assert.equal(await addSays({ email: "fresh.sample@gmail.com", provider: "gmail", password: "abcdefghijklmnop" }), "Signed in from FAFO's server. Your inbox has 3 emails.");
    await page.click("#layers #i-save");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await view("imap");
    const id = await ev(() => window.__t.S.inboxes.find((i) => i.email === "fresh.sample@gmail.com").id);
    assert.match(await cardOf(id), /Connected · checked just now/);
  });

  await test("the step-by-step setup: Check and use from FAFO's server, its words, Use it anyway, and the result kept on Save, from Add inbox and from a new store login", async () => {
    await view("logins");
    const setup = async (email, open = async () => { await page.click('#main .view-tools [data-act="new-inbox-only"]'); }) => {
      await open();
      await page.click("#layers [data-ig-start]");
      await page.waitForSelector('#layers [name="g_email"]');
      if (email) await page.fill('#layers [name="g_email"]', email);
      await page.waitForTimeout(450); await page.click("#layers #ig-go");
      await page.waitForTimeout(450); await page.click("#layers #ig-go");
      await page.waitForSelector('#layers [name="g_password"]');
      assert.match(await text("#layers #ig-body"), /Check and use signs in from FAFO's server to check it, then signs out\. FAFO keeps nothing there\./);
      assert.equal(await text("#layers #ig-go"), "Check and use");
      await page.fill('#layers [name="g_password"]', "abcdefghijklmnop");
      await page.waitForTimeout(450); await page.click("#layers #ig-go");
      await page.waitForFunction(() => { const o = document.querySelector("#ig-out"); return !o || (!o.hidden && !/Signing in/.test(o.textContent)); });
    };
    await setup("bad.setup@gmail.com");
    assert.match(await text("#ig-out"), /^Gmail didn't accept the password for bad\.setup@gmail\.com\. Use an app password .* \(Details: \[AUTHENTICATIONFAILED\] Invalid credentials \(Failure\)\) Back shows the steps again\.$/);
    assert.ok(await page.$('#layers [data-ig="anyway"]'), "Use it anyway");
    await closeLayers();
    await setup("blocked.setup@gmail.com");
    assert.equal(await text("#ig-out"), "Gmail stopped this sign-in because it came from FAFO's server, not your computer. Sign in to blocked.setup@gmail.com in your browser, confirm it was you if it asks, then test again. The desktop app signs in from your computer.");
    await closeLayers();
    await setup("ok.setup@gmail.com");
    await page.waitForSelector("#layers #i-ready:not([hidden])");
    await page.waitForTimeout(450);   // the pretend worker answers within 100 ms of the click, so the setup drops the next click for 400 ms
    assert.match(await text("#layers #i-ready"), /Inbox ready: ok\.setup@gmail\.com \(Gmail\)\. FAFO's server signed in to it\. Save to keep it\./);
    await page.click("#layers #i-save");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await view("imap");
    let id = await ev(() => window.__t.S.inboxes.find((i) => i.email === "ok.setup@gmail.com").id);
    assert.match(await cardOf(id), /Connected · checked just now/);
    // A new store login whose new inbox is checked by the setup: Save login keeps the result for that inbox.
    await view("logins");
    await setup("", async () => {
      await page.click('#main .view-tools [data-act="new-login"]');
      await page.waitForSelector('#layers [name="email"]');
      await page.fill('#layers [name="email"]', "ok.newlogin@gmail.com");
      await page.fill('#layers [name="password"]', "Store-Pw-Sample-2");
    });
    await page.waitForSelector("#layers #i-ready:not([hidden])");
    await page.waitForTimeout(450);   // the pretend worker answers within 100 ms of the click, so the setup drops the next click for 400 ms
    await page.click("#layers #l-save");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await view("imap");
    id = await ev(() => window.__t.S.inboxes.find((i) => i.email === "ok.newlogin@gmail.com").id);
    assert.match(await cardOf(id), /Connected · checked just now/);
  });

  await test("the seller's own FAFO: Test still works, and the note has no slots clause", async () => {
    W.owner = true;
    await ev(() => window.__t.refreshPremium(true));
    await page.waitForFunction(() => window.__t.isPremiumOwner());
    await view("logins"); await view("imap");
    const main = await text("#main");
    assert.ok(main.includes("Your inbox passwords are kept in your encrypted vault, and leave it only when you press Test (FAFO's server signs in with it and keeps nothing)."), main.slice(0, 1200));
    assert.doesNotMatch(main, /with the slots you submit/);
    const t = await cardTest("ib-ok");
    assert.equal(t.body.email, "ok.sample@gmail.com");
    W.owner = false;
    await ev(() => window.__t.refreshPremium(true));
    await page.waitForFunction(() => !window.__t.isPremiumOwner());
  });

  await test("the desktop app is as it was: the gate, its Tests and its words", async () => {
    assert.match(HTML, /const inboxTestOn = \(\) => !DESK && /);
    assert.ok(HTML.includes("window.pvDesktop.testInbox({email:r.inbox.email, password:r.inbox.password, host:r.inbox.host, port:r.inbox.port})"), "the inbox editor's");
    assert.ok(HTML.includes('window.pvDesktop.testInbox({email:g.email, password:pw, host:g.provider === "custom" ? g.host : (p ? p[2] : ""), port:g.provider === "custom" ? g.port : "993"})'), "the setup's");
    assert.ok(HTML.includes("\"The desktop app couldn't sign in: \""));
    // Every line of the page before's imapInboxStatus past its web line (the desktop's path) is here unchanged.
    const prev = join(root, "index-1.9.148.html");
    if (!existsSync(prev)) { console.log("    (no index-1.9.148.html here: the line-by-line check is skipped)"); return; }
    const slice = (h) => h.slice(h.indexOf("function imapInboxStatus(i){"), h.indexOf("function renderImap(){"));
    const old = slice(readFileSync(prev, "utf8")).split("\n").slice(1).filter((l) => l.trim() && !/^\s*if \(!DESK\) return/.test(l));
    const now = slice(HTML);
    assert.ok(old.length >= 6, "the desktop's lines");
    for (const l of old) assert.ok(now.includes(l), "unchanged: " + l.slice(0, 100));
    // And the desktop's own words in the editor and the setup.
    for (const l of ['out.textContent = res.ok ? `Signed in. Your inbox has ${res.messages.toLocaleString()} emails.` : m.text + (m.text !== m.raw && m.raw && m.kind !== "cert" ? ` (Details: ${m.raw})` : "");',
      'out.textContent = m.text + (m.kind === "auth" ? " Back shows the steps again." : "") + (m.text !== m.raw && m.raw && m.kind !== "cert" ? ` (Details: ${m.raw})` : "");']) assert.ok(HTML.includes(l), l.slice(0, 80));
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
