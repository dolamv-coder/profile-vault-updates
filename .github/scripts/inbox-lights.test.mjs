// Tests the inbox lights on Store logins in the newest page (index-X.Y.Z.html), from 1.9.157 (the owner, 2026-11-17, with a
// screenshot of the IMAP tab: "i find this IMAP tab is unnecessary because the same thing is repeated in Store Login", then
// "can you make a feature to where if an Imap is good then a good light is lit up and fafo cannot connect to its inbox then
// shows a red light?" and "yes share between devices, only check on Test"). The real page runs in Chromium (Playwright): as
// the web version at app.fafoaco.com against a pretend license worker (its POST /inbox/test answers by the inbox's address,
// as web-inbox-test.test.mjs runs it), then as the desktop app (window.pvDesktop stubbed, as license-paste.test.mjs does,
// with an email sync and a Test whose answers the test picks). It checks the IMAP tab is gone (the sidebar, the phone's tabs,
// a saved or stale view), every light on the login cards (Comfortable, Compact, List) and the inbox cards (green Inbox OK,
// red Can't sign in with why, gray Not checked yet and Needs an inbox with Set up inbox), the counts strip and its Need an
// inbox and Can't sign in filters (with the group chips and the search), the warnings (no "so 0 profiles" clause), the
// sidebar's light, the shared field (chk) written and read and in what sync sends (deskChk and syncErrAt never are),
// changed credentials back to gray, a computer offline, its network and FAFO's server being blocked or unreachable at one of
// the six providers never red, a custom server's name that can't be found red only while another inbox signs in from this
// computer, the 6-hour write throttle of the desktop's email sync, Test on an inbox card on both (and the words for one
// that couldn't tell), the step-by-step setup's Check and use and Use it anyway on both, what a desktop before 1.9.157 kept
// counting from unlock (red with no time, gray once edited), the filters keeping the keyboard's place, an inbox deleted here
// staying deleted through a merge with another device's rewritten check, and the words' contrast in all five themes.
// Sample addresses, made-up app passwords and keys only.
//   node .github/scripts/inbox-lights.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have the lights (inboxLight); a page named on the command line that doesn't is skipped.
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
if (!/function inboxLight\(/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no inbox lights (inboxLight): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no inbox lights, skipped`); process.exit(0);
}
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get UI(){ return UI; }, get DESK(){ return DESK; }, get SYNC(){ return SYNC; }, keepTypedLic, persist, render, renderLock, lock, syncUnits, syncOneInbox, inboxLight, ibxFp, refreshPremium, syncNote, syncHashes, syncBaseFrom, syncMerge, orderKey};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const W = { tests: [] };
// POST /inbox/test answers by the address's first word (before a dot or a digit): [status, body, wait].
const ANSWERS = {
  ok: [200, { ok: true, messages: 7 }],
  bad: [200, { ok: false, why: "auth", text: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)" }],
  blocked: [200, { ok: false, why: "blocked", text: "[WEBALERT https://accounts.google.com/sample] Web login required." }],
  far: [200, { ok: false, why: "connect", text: "" }],
  down: [200, { ok: false, why: "connect", text: "" }],   // as far, at Gmail (one of the six providers)
  slow: [200, { ok: true, messages: 7 }, 1200],
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
    const [status, answer, wait] = ANSWERS[k] || [200, { ok: true, messages: 3 }];
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return json(route, status, answer);
  }
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 50, request: null, canRequest: true });
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
async function context(init, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
    return route.fulfill({ status: 404, body: "" });
  });
  // The setup guide (1.9.145) doesn't ask here: its own test is walkthrough.test.mjs. Every toast is recorded.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {}
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })
      .observe(document, { childList: true, subtree: true });
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const PW = "sample-pass-157";
const ready = () => page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
const toLogins = async () => {
  await page.click('#side [data-id="logins"]');
  await page.waitForFunction(() => { const h = document.querySelector("#main .view-title"); return h && h.textContent === "Store logins"; });
};
const layout = async (v) => { await page.click(`#main [data-act="login-view"][data-id="${v}"]`); await page.waitForSelector(`#main [data-act="login-view"][data-id="${v}"][aria-pressed="true"]`); };
const kpis = () => page.$eval("#main .p-kpis", (e) => [...e.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" | "));
const toasts = () => ev(() => window.__toasts.slice());
const until = async (cond, what, ms = 10000) => { for (const t0 = Date.now(); !(await cond());) { if (Date.now() - t0 > ms) throw new Error("waited too long for " + what); await new Promise((r) => setTimeout(r, 25)); } };
// A login's light, in the layout shown: [its words, the dot's kind, its hover text].
const loginLight = (email) => page.evaluate((email) => {
  const row = [...document.querySelectorAll("#main [data-lmenu]")].find((el) => el.textContent.includes(email));
  if (!row) return null;
  const line = row.querySelector(".lt-line"), dot = line && line.querySelector(".lt");
  return line ? [line.textContent.trim(), dot.classList.contains("lt-ok") ? "ok" : dot.classList.contains("lt-bad") ? "bad" : "gray", line.title, dot.getAttribute("aria-hidden"), !!row.querySelector('[data-act="edit-login"].l-setup, [data-act="edit-login"].l-setup-link')] : null;
}, email);
// An inbox card: its dot, its whole text (as it reads), and its Test.
const inboxCard = (id) => page.evaluate((id) => {
  const a = document.querySelector(`#main article.ibx-card[data-inbox="${id}"]`);
  if (!a) return null;
  const dot = a.querySelector(".ibx-title .lt"), t = a.querySelector(".ibx-test button");
  return { dot: dot.classList.contains("lt-ok") ? "ok" : dot.classList.contains("lt-bad") ? "bad" : "gray", text: a.innerText.replace(/\s+/g, " ").trim(),
    test: t ? { text: t.textContent.trim(), disabled: t.disabled, act: t.dataset.act || "", title: t.title } : null,
    title: a.querySelector(".ibx-title").title };
}, id);
const visibleEmails = () => page.$$eval("#main [data-lmenu]", (rs) => rs.map((r) => (r.querySelector(".login-email, .lc-email, .ll-acct") || r).textContent.trim()));
const navLogins = () => page.$eval('#side [data-id="logins"]', (b) => { const l = b.querySelector(".nav-light"); return { n: b.querySelector(".n").textContent.replace(/\s+/g, " ").trim(), light: !!l, title: l ? l.title : "" }; });

// Waits for the top window's first focus (openLayer's, 60 ms after it opens), so typing goes into the box it's meant for.
const settled = () => page.waitForFunction(() => {
  const ls = [...document.querySelectorAll("#layers .layer:not([inert])")], top = ls[ls.length - 1];
  return !!top && top.contains(document.activeElement);
});
const closed = () => page.waitForFunction(() => !document.querySelector("#layers .panel"));
// The step-by-step setup from Add inbox (or `open`), through Check and use, to its answer.
async function setupCheck(email, open = async () => { await page.click('#main .view-tools [data-act="new-inbox-only"]'); }) {
  await open();
  await settled();
  await page.click("#layers [data-ig-start]");
  await page.waitForSelector('#layers [name="g_email"]');
  await settled();
  if (email) await page.fill('#layers [name="g_email"]', email);
  await page.waitForTimeout(450); await page.click("#layers #ig-go");
  await page.waitForTimeout(450); await page.click("#layers #ig-go");
  await page.waitForSelector('#layers [name="g_password"]');
  await page.fill('#layers [name="g_password"]', "abcdefghijklmnop");
  await page.waitForTimeout(450);
  assert.equal(await text("#layers #ig-go"), "Check and use");
  await page.click("#layers #ig-go");
  await page.waitForFunction(() => { const o = document.querySelector("#ig-out"); return !o || (!o.hidden && !/Signing in/.test(o.textContent)); });
  await page.waitForTimeout(450);   // the setup drops a click within 400 ms of drawing its answer
}
// Where the keyboard's cursor is.
const focusAt = () => page.evaluate(() => { const a = document.activeElement; return a ? { act: a.dataset.act || a.tagName, id: a.dataset.id, pressed: a.getAttribute("aria-pressed"), note: a.closest(".lt-note") ? a.closest(".lt-note").id : "", kpis: !!a.closest(".p-kpis"), text: a.textContent.replace(/\s+/g, " ").trim() } : null; });
const INBOX = (id, email, extra = {}) => Object.assign({ id, email, password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993" }, extra);
const LOGIN = (id, store, email, inboxId, groupId) => ({ id, store, email, password: "Store-Pw-Sample", inboxId: inboxId || "", label: "", groupId: groupId || null });
// A check as another device would have written it.
const chkFor = (id, rec) => ev(({ id, rec }) => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === id); i.chk = Object.assign({ f: T.ibxFp(i) }, rec, { at: Date.now() - rec.ago }); delete i.chk.ago; T.persist(); T.render(); }, { id, rec });

// Relative luminance and contrast, of colours the browser resolves (a canvas reads color(srgb …) and color-mix too).
const CONTRAST = () => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const x = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { x.clearRect(0, 0, 1, 1); x.fillStyle = "#000"; x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  // The background behind an element: the page's --desk, then every ancestor's colour over it (the stars' sky is left out:
  // its base is --desk).
  const bgOf = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let c = rgba(getComputedStyle(document.documentElement).getPropertyValue("--desk").trim()).slice(0, 3);
    for (const e of chain) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) c = c.map((v, k) => b[k] * b[3] + v * (1 - b[3])); }
    return c;
  };
  const out = [];
  for (const el of document.querySelectorAll("#main .lt-line > span:last-child, #main .ibx-st [class^=lt-w], #main .ibx-why, #main .ibx-note-h, #main .p-kpi")) {
    if (!el.offsetParent) continue;
    out.push({ what: el.className + " " + el.textContent.trim().slice(0, 30), r: Math.round(ratio(rgba(getComputedStyle(el).color), bgOf(el)) * 100) / 100 });
  }
  return out;
};

console.log(`Inbox lights on Store logins in ${file.split(/[\\/]/).pop()}`);
try {
  // ======================== The web version ========================
  page = await context();
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
  await ready();
  await ev(({ IB, LG }) => {
    const T = window.__t, S = T.S;
    S.inboxes.push(...IB);
    S.settings.loginGroups = { g1: { id: "g1", name: "Main PC" } };
    S.logins.push(...LG);
    S.addresses.push({ id: "a1", first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
    S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
    // One profile on a login with no inbox (so the warning counts 1 profile), none on the other. Both at stores where a login
    // needs an inbox (Costco and Pokémon Center): from 1.9.158 a Target login's is optional (target-inbox.test.mjs).
    S.profiles.push({ id: "p1", name: "Sam C5", shipId: "a1", billSame: true, cardId: "c1", phone: "5125550100", email: "need.one@example.com", stores: [{ store: "costco", mode: "login", loginId: "l-need1" }] });
    T.persist(); T.render();
  }, { IB: [INBOX("ib-ok", "ok.sample@gmail.com"), INBOX("ib-bad", "bad.sample@gmail.com"), INBOX("ib-new", "new.sample@gmail.com"),
    INBOX("ib-blocked", "blocked.sample@gmail.com"), INBOX("ib-far", "far.custom@example.com", { provider: "custom", host: "mail.example.com", password: "Sample-Far-Pw" })],
  LG: [LOGIN("l-ok", "target", "ok.login@example.com", "ib-ok", "g1"), LOGIN("l-bad", "pokemoncenter", "bad.login@example.com", "ib-bad"), LOGIN("l-new", "costco", "new.login@example.com", "ib-new", "g1"),
    LOGIN("l-blocked", "target", "blocked.login@example.com", "ib-blocked"), LOGIN("l-far", "target", "far.login@example.com", "ib-far"),
    LOGIN("l-need1", "costco", "need.one@example.com", "", "g1"), LOGIN("l-need2", "pokemoncenter", "need.two@example.com", "")] });

  await test("the IMAP tab is gone: not in the sidebar or the phone's tabs, and a saved or stale IMAP view opens Store logins", async () => {
    assert.equal(await page.$('#side [data-id="imap"]'), null, "no IMAP in the sidebar");
    assert.equal(await page.$('#mnav [data-id="imap"]'), null, "no IMAP tab on a phone");
    assert.ok(!/function renderImap\(/.test(HTML), "no IMAP view in the page");
    const side = await page.$$eval("#side [data-act=view]", (bs) => bs.map((b) => b.dataset.id));
    assert.ok(side.includes("logins") && !side.includes("imap"), side.join(","));
    // A view of IMAP left from before (a stale click, a view kept): Store logins.
    await ev(() => { const T = window.__t; T.UI.view = "imap"; T.render(); });
    assert.equal(await text("#main .view-title"), "Store logins");
    assert.equal(await ev(() => window.__t.UI.view), "logins");
    await ev(() => { const b = document.createElement("button"); b.dataset.act = "view"; b.dataset.id = "imap"; b.id = "stale-imap"; document.body.appendChild(b); window.__t.UI.view = "orders"; window.__t.render(); });
    await page.click("#stale-imap");
    await page.waitForFunction(() => document.querySelector("#main .view-title").textContent === "Store logins");
    await ev(() => document.getElementById("stale-imap").remove());
    // Store logins' sidebar item keeps its total and gets the light: 2 logins need an inbox.
    assert.deepEqual(await navLogins(), { n: "2 store logins need an inbox: 7", light: true, title: "2 store logins need an inbox" });
    assert.match(await page.$eval('#mnav [data-id="logins"]', (b) => b.innerHTML), /lt lt-bad/);
  });

  await test("nothing checked yet: gray Not checked yet, gray Needs an inbox with Set up inbox, in every layout; the counts and the warning", async () => {
    await toLogins();
    assert.equal(await kpis(), "Logins 7 | Inbox OK 0 | Not checked yet 5 | Need an inbox 2 | Inboxes 5");
    for (const v of ["comfortable", "compact", "list"]) {
      await layout(v);
      const short = v !== "comfortable";
      const l = await loginLight("ok.login@example.com");
      assert.deepEqual(l.slice(0, 2), [short ? "Not checked" : "Not checked yet", "gray"], v);
      assert.equal(l[3], "true", "the dot is aria-hidden");
      assert.match(l[2], /^Not checked yet\. The desktop app checks it when it syncs\.$/);
      const n = await loginLight("need.two@example.com");
      assert.deepEqual(n.slice(0, 2), ["Needs an inbox", "gray"], v);
      assert.equal(n[4], true, "Set up inbox, " + v);
    }
    await layout("comfortable");
    // Set up inbox opens that login in its editor.
    await page.click('#main [data-lmenu="l-need2"] [data-act="edit-login"].l-setup');
    await page.waitForSelector("#layers .panel");
    assert.equal(await text("#layers .panel-head h2"), "Edit store login");
    assert.equal(await page.$eval('#layers [name="email"]', (e) => e.value), "need.two@example.com");
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    // The warning: 2 logins, 1 profile on them.
    assert.equal(await text("#l-need-note"), "2 store logins still need an inbox. Without one, your bot can't read the sign-in code to log into the account, so 1 profile may not get pulled. Show them");
    assert.equal(await page.$("#l-bad-note"), null, "no inbox can't sign in yet");
    // Inbox cards: gray, and Test off without the license key, with 1.9.149's words.
    const c = await inboxCard("ib-ok");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: the desktop app checks it when it syncs/);
    assert.deepEqual(c.test, { text: "Test", disabled: true, act: "", title: "Test needs your license key in this browser: Settings, then Web version & sync, then Turn on sync. Or test it in the desktop app." });
    assert.match(await text("#main"), /To test an inbox here, add your license key: Settings, then Web version & sync, then Turn on sync\./);
  });

  await test("the warning without its profiles clause when none of those logins has a profile (never \"so 0 profiles\")", async () => {
    await ev(() => { const T = window.__t; T.S.profiles[0].stores[0].loginId = "l-ok"; T.persist(); T.render(); });
    assert.equal(await text("#l-need-note"), "2 store logins still need an inbox. Without one, your bot can't read the sign-in code to log into the account. Show them");
    assert.doesNotMatch(await text("#main"), /0 profiles/);
    await ev(() => { const T = window.__t; T.S.profiles[0].stores[0].loginId = "l-need1"; T.persist(); T.render(); });
  });

  await test("Need an inbox: a button that shows only those logins (with the group chips and the search), and Show all logins", async () => {
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="true"]');
    assert.deepEqual((await visibleEmails()).sort(), ["need.one@example.com", "need.two@example.com"]);
    assert.equal(await page.$("#main article.ibx-card"), null, "no inboxes under the filter");
    assert.match(await text("#l-need-note"), /Show all logins$/);
    // The group chips still apply.
    await page.click('#main .chips [data-act="login-group"][data-id="g1"]');
    assert.deepEqual(await visibleEmails(), ["need.one@example.com"]);
    assert.equal(await page.$eval('#main .p-kpis [data-id="need"]', (b) => b.getAttribute("aria-pressed")), "true", "still on");
    await page.click('#main .chips [data-act="login-group"][data-id="all"]');
    // And the search.
    await page.fill("#q", "two");
    await page.waitForFunction(() => document.querySelectorAll("#main [data-lmenu]").length === 1);
    assert.deepEqual(await visibleEmails(), ["need.two@example.com"]);
    await page.fill("#q", "ok.login");
    await page.waitForFunction(() => /No logins here need an inbox/.test(document.querySelector("#main").textContent));
    await page.fill("#q", "");
    await page.waitForFunction(() => document.querySelectorAll("#main [data-lmenu]").length === 2);
    // Select all ticks only what's shown.
    await page.check('#main [data-act="login-sel-all"]');
    assert.deepEqual((await ev(() => [...window.__t.UI.loginSel])).sort(), ["l-need1", "l-need2"]);
    await page.uncheck('#main [data-act="login-sel-all"]');
    await page.click('#l-need-note [data-act="login-filter"]');
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="false"]');
    assert.equal((await visibleEmails()).length, 7);
    // Show them, and the button again turns it off; another page and back starts with all.
    await page.click('#l-need-note [data-act="login-filter"][data-id="need"]');
    assert.equal((await visibleEmails()).length, 2);
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    assert.equal((await visibleEmails()).length, 7);
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    await page.click('#side [data-id="cards"]'); await toLogins();
    assert.equal((await visibleEmails()).length, 7);
  });

  await test("the filters keep the keyboard's place: Enter on Need an inbox, Show them or Show all logins leaves the cursor on that control, pressed", async () => {
    await page.focus('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="true"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "need", pressed: "true", note: "", kpis: true, text: "Need an inbox 2" });
    assert.equal((await visibleEmails()).length, 2);
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="false"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "need", pressed: "false", note: "", kpis: true, text: "Need an inbox 2" });
    // The warning's link, which swaps Show them for Show all logins: the cursor stays on it.
    await page.focus('#l-need-note [data-act="login-filter"]');
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="true"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "", pressed: null, note: "l-need-note", kpis: false, text: "Show all logins" });
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="false"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "need", pressed: null, note: "l-need-note", kpis: false, text: "Show them" });
    assert.equal((await visibleEmails()).length, 7);
  });

  await test("another device's check (the synced chk): green Inbox OK, red Can't sign in with why, in every layout and on the cards; the counts, the filter and the warning", async () => {
    await chkFor("ib-ok", { ok: true, ago: 4 * 60000, by: "desktop" });
    await chkFor("ib-bad", { ok: false, ago: 60 * 60000, by: "desktop", why: "Gmail didn't accept the password for bad.sample@gmail.com. Use an app password (not your normal password) made while signed in as bad.sample@gmail.com, and paste all of it." });
    assert.equal(await kpis(), "Logins 7 | Inbox OK 1 | Can't sign in 1 | Not checked yet 3 | Need an inbox 2 | Inboxes 5");
    for (const v of ["comfortable", "compact", "list"]) {
      await layout(v);
      const short = v !== "comfortable";
      const ok = await loginLight("ok.login@example.com"), bad = await loginLight("bad.login@example.com");
      assert.deepEqual(ok.slice(0, 2), [short ? "OK" : "Inbox OK", "ok"], v);
      assert.equal(ok[2], "Signed in on its last check (4 min ago on your desktop app).");
      assert.deepEqual(bad.slice(0, 2), ["Can't sign in", "bad"], v);
      assert.equal(bad[2], "Couldn't sign in on its last check (1 hr ago on your desktop app): Gmail didn't accept the password for bad.sample@gmail.com. Use an app password (not your normal password) made while signed in as bad.sample@gmail.com, and paste all of it.");
    }
    await layout("comfortable");
    const ok = await inboxCard("ib-ok"), bad = await inboxCard("ib-bad");
    assert.equal(ok.dot, "ok"); assert.match(ok.text, /Gmail\. Used by 1 login Signed in · checked 4 min ago Test$/);
    assert.equal(bad.dot, "bad"); assert.match(bad.text, /Couldn't sign in · checked 1 hr ago Gmail didn't accept the password for bad\.sample@gmail\.com\. .* paste all of it\. Test$/);
    // The Test row is under the status, on a row of its own (nothing beside it).
    const geo = await page.$eval('#main article.ibx-card[data-inbox="ib-bad"]', (a) => { const t = a.querySelector(".ibx-test").getBoundingClientRect(), s = a.querySelector(".ibx-st").getBoundingClientRect(), w = a.querySelector(".ibx-why").getBoundingClientRect(), c = a.getBoundingClientRect(); return { below: t.top >= s.bottom - 0.5, wide: w.width > c.width * 0.75 }; });
    assert.deepEqual(geo, { below: true, wide: true });
    assert.equal(await text("#l-bad-note"), "1 inbox can't sign in: bad.sample@gmail.com. Check its email and app password (Edit, on its card under Inboxes), then let the desktop app check it again. Show its login");
    assert.deepEqual(await navLogins(), { n: "1 inbox can't sign in, 2 store logins need an inbox: 7", light: true, title: "1 inbox can't sign in, 2 store logins need an inbox" });
    // Can't sign in: a button that shows only those logins, and only the inboxes that can't sign in.
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="bad"]');
    await page.waitForSelector('#main .p-kpis [data-id="bad"][aria-pressed="true"]');
    assert.deepEqual(await visibleEmails(), ["bad.login@example.com"]);
    assert.deepEqual(await page.$$eval("#main article.ibx-card", (as) => as.map((a) => a.dataset.inbox)), ["ib-bad"]);
    assert.match(await text("#l-bad-note"), /Show all logins$/);
    // The group chips still apply (bad.login is in no group), and so does the search.
    await page.click('#main .chips [data-act="login-group"][data-id="g1"]');
    assert.match(await text("#main .empty h2"), /^No logins here can't sign in$/);
    assert.equal(await page.$eval('#main .p-kpis [data-id="bad"]', (b) => b.getAttribute("aria-pressed")), "true", "still on");
    await page.click('#main .chips [data-act="login-group"][data-id="all"]');
    await page.fill("#q", "ok.login");
    await page.waitForFunction(() => /No logins here can't sign in/.test(document.querySelector("#main").textContent));
    await page.fill("#q", "bad");
    await page.waitForFunction(() => document.querySelectorAll("#main [data-lmenu]").length === 1);
    assert.deepEqual(await visibleEmails(), ["bad.login@example.com"]);
    await page.fill("#q", "");
    await page.waitForFunction(() => document.querySelectorAll("#main [data-lmenu]").length === 1);
    // Select all ticks only what's shown.
    await page.check('#main [data-act="login-sel-all"]');
    assert.deepEqual([...await ev(() => [...window.__t.UI.loginSel])], ["l-bad"]);
    await page.uncheck('#main [data-act="login-sel-all"]');
    await page.click('#l-bad-note [data-act="login-filter"]');
    assert.equal((await visibleEmails()).length, 7);
    // And from the keyboard: the cursor stays on the pressed button, and on the warning's link.
    await page.focus('#main .p-kpis [data-act="login-filter"][data-id="bad"]');
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="bad"][aria-pressed="true"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "bad", pressed: "true", note: "", kpis: true, text: "Can't sign in 1" });
    await page.focus('#l-bad-note [data-act="login-filter"]');
    await page.keyboard.press("Enter");
    await page.waitForSelector('#main .p-kpis [data-id="bad"][aria-pressed="false"]');
    assert.deepEqual(await focusAt(), { act: "login-filter", id: "bad", pressed: null, note: "l-bad-note", kpis: false, text: "Show its login" });
    assert.equal((await visibleEmails()).length, 7);
  });

  await test("changed credentials go back to gray: the check is only for the email, server, port and app password it was made with", async () => {
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "ib-bad"); i.password = "zyxwvutsrqponmlk"; T.persist(); T.render(); });
    assert.deepEqual((await loginLight("bad.login@example.com")).slice(0, 2), ["Not checked yet", "gray"]);
    assert.equal((await inboxCard("ib-bad")).dot, "gray");
    assert.equal(await page.$("#l-bad-note"), null);
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "ib-bad"); i.password = "qrstuvwxyzabcdef"; T.persist(); T.render(); });
    assert.equal((await inboxCard("ib-bad")).dot, "bad", "its own again");
    // The server or port too.
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "ib-ok"); i.provider = "custom"; i.host = "imap.example.com"; T.persist(); T.render(); });
    assert.equal((await inboxCard("ib-ok")).dot, "gray");
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "ib-ok"); i.provider = "gmail"; i.host = "imap.gmail.com"; T.persist(); T.render(); });
    assert.equal((await inboxCard("ib-ok")).dot, "ok");
  });

  await test("with the license key: Test on an inbox card writes the shared check (what sync sends), green or red; blocked, or unreachable at one of the six providers, from FAFO's server is never red (a custom server it can't reach securely is)", async () => {
    await ev((lic) => { const T = window.__t; T.keepTypedLic(lic); localStorage.setItem("orbit-inbox-test-ok", "1"); T.persist(); T.render(); }, LIC);
    await toLogins();
    let c = await inboxCard("ib-new");
    assert.deepEqual([c.dot, c.test.text, c.test.disabled, c.test.act], ["gray", "Test", false, "test-inbox"]);
    assert.match(c.text, /Not checked yet: press Test/);
    // Signed in.
    await page.click('#main [data-act="test-inbox"][data-id="ib-new"]');
    await page.waitForFunction(() => document.querySelector('#main article.ibx-card[data-inbox="ib-new"] .lt-ok'));
    assert.match((await inboxCard("ib-new")).text, /Signed in · checked just now/);
    assert.match((await inboxCard("ib-new")).title, /from FAFO's server/);
    const chk = await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "ib-new"); return { chk: i.chk, f: T.ibxFp(i), sent: T.syncUnits(T.S).map.get("i:ib-new").v.chk }; });
    assert.equal(chk.chk.ok, true); assert.equal(chk.chk.by, "server"); assert.equal(chk.chk.f, chk.f); assert.ok(Date.now() - chk.chk.at < 60000);
    assert.equal(chk.chk.why, undefined);
    assert.deepEqual(chk.sent, chk.chk, "the check is in what sync sends");
    assert.deepEqual((await loginLight("new.login@example.com")).slice(0, 2), ["Inbox OK", "ok"]);
    // A wrong app password: red, with its words (200 characters at most, never the password).
    await page.click('#main [data-act="test-inbox"][data-id="ib-bad"]');
    await until(async () => (await toasts()).includes("Couldn't sign in to bad.sample@gmail.com from FAFO's server. Its card says why."), "the toast");
    const b = await ev(() => window.__t.S.inboxes.find((x) => x.id === "ib-bad").chk);
    assert.equal(b.ok, false); assert.equal(b.by, "server");
    assert.ok(b.why.length <= 200, b.why);
    assert.match(b.why, /^Gmail didn't accept the password for bad\.sample@gmail\.com\./);
    assert.ok(!b.why.includes("qrstuvwxyzabcdef"), "no password in the words");
    assert.deepEqual((await loginLight("bad.login@example.com")).slice(0, 2), ["Can't sign in", "bad"]);
    // Blocked: the light stays as it was (gray here), and the card says why in words, not in red.
    await page.click('#main [data-act="test-inbox"][data-id="ib-blocked"]');
    await until(async () => (await toasts()).some((t) => /stopped this sign-in/.test(t)), "the toast");
    c = await inboxCard("ib-blocked");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test Couldn't check from FAFO's server · just now Gmail stopped this sign-in because it came from FAFO's server/);
    assert.equal(await page.$('#main article.ibx-card[data-inbox="ib-blocked"] .lt-w-bad'), null, "nothing red");
    assert.equal(await ev(() => window.__t.S.inboxes.find((x) => x.id === "ib-blocked").chk), undefined, "nothing shared");
    assert.match((await loginLight("blocked.login@example.com"))[2], /Last try \(just now\) couldn't check from FAFO's server: Gmail stopped this sign-in/);
    // After a green check, blocked leaves it green.
    await chkFor("ib-blocked", { ok: true, ago: 30 * 60000, by: "desktop" });
    await page.click('#main [data-act="test-inbox"][data-id="ib-blocked"]');
    await until(async () => (await toasts()).filter((t) => /stopped this sign-in/.test(t)).length === 2, "the toast");
    c = await inboxCard("ib-blocked");
    assert.equal(c.dot, "ok");
    assert.match(c.text, /Signed in · checked 30 min ago Couldn't check from FAFO's server · just now/);
    // A custom server FAFO's server can't connect to securely is the inbox's (red), as 1.9.149's ibxBad says.
    await page.click('#main [data-act="test-inbox"][data-id="ib-far"]');
    await page.waitForFunction(() => document.querySelector('#main article.ibx-card[data-inbox="ib-far"] .lt-bad'));
    assert.match((await inboxCard("ib-far")).text, /Couldn't sign in · checked just now FAFO's server couldn't connect securely to mail\.example\.com on port 993\./);
    // The same answer at Gmail (FAFO's server couldn't reach it) is about FAFO's server: not red, nothing shared.
    await ev(() => { const T = window.__t; T.S.inboxes.push({ id: "ib-down", email: "down.sample@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993" }); T.persist(); T.render(); });
    await page.click('#main [data-act="test-inbox"][data-id="ib-down"]');
    await until(async () => (await toasts()).some((t) => /^FAFO's server couldn't reach Gmail just now\./.test(t)), "the toast");
    c = await inboxCard("ib-down");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test Couldn't check from FAFO's server · just now FAFO's server couldn't reach Gmail just now\. Try again in a few minutes\./);
    assert.equal(await ev(() => window.__t.S.inboxes.find((x) => x.id === "ib-down").chk), undefined, "nothing shared");
    // While a test runs: Testing… and every Test off.
    await ev(() => { const T = window.__t; T.S.inboxes.push({ id: "ib-slow", email: "slow.sample@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993" }); T.persist(); T.render(); });
    await page.click('#main [data-act="test-inbox"][data-id="ib-slow"]');
    await page.waitForFunction(() => /Signing in from FAFO's server…/.test(document.querySelector('#main article.ibx-card[data-inbox="ib-slow"]').textContent));
    const bs = await page.$$eval('#main [data-act="test-inbox"]', (bs) => bs.map((b) => [b.dataset.id, b.disabled, b.textContent.trim()]));
    assert.ok(bs.every((b) => b[1]), "every Test is off");
    assert.deepEqual(bs.filter((b) => b[2] === "Testing…").map((b) => b[0]), ["ib-slow"]);
    await page.waitForFunction(() => document.querySelector('#main article.ibx-card[data-inbox="ib-slow"] .lt-ok'));
    // The web note moved here from IMAP.
    assert.match(await text("#main"), /You're on the web version\. Test checks an inbox by signing in to it from FAFO's server, then signing out\. Reading your email to pull in your orders happens only in the desktop app/);
    assert.equal(await text("#l-bad-note"), "2 inboxes can't sign in: bad.sample@gmail.com, far.custom@example.com. Check their emails and app passwords (Edit, on their cards under Inboxes), then press Test. Show their logins");
  });

  await test("this browser's own results stay on it (S._local.ibx, never synced); the shared check has no device's bookkeeping", async () => {
    const r = await ev(() => { const T = window.__t, units = T.syncUnits(T.S); return { local: Object.keys(T.S._local.ibx).sort(), sent: JSON.stringify([...units.map.values()].map((x) => x.v)) }; });
    assert.ok(r.local.includes("ib-blocked") && r.local.includes("ib-new"), r.local.join(","));
    assert.ok(!r.sent.includes('"ibx"'), "no ibx in what sync sends");
    assert.ok(!/deskChk|deskTry|syncErrAt/.test(r.sent));
  });

  await test("the step-by-step setup: Use it anyway after FAFO's server was refused the app password saves the inbox red, the shared check by the server", async () => {
    await setupCheck("bad.setup@gmail.com");
    assert.match(await text("#ig-out"), /^Gmail didn't accept the password for bad\.setup@gmail\.com\./);
    await page.click('#layers [data-ig="anyway"]');
    await page.waitForFunction(() => !document.querySelector("#ig-out") && document.querySelector("#layers #i-save"));
    await settled();
    await page.waitForTimeout(450);   // a click within 400 ms of the setup closing is dropped (it would press what's under it)
    await page.click("#layers #i-save");
    await closed();
    const i = await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.email === "bad.setup@gmail.com"); return { id: i.id, chk: i.chk, f: T.ibxFp(i) }; });
    assert.equal(i.chk.ok, false); assert.equal(i.chk.by, "server"); assert.equal(i.chk.f, i.f);
    assert.match(i.chk.why, /^Gmail didn't accept the password for bad\.setup@gmail\.com\./);
    const c = await inboxCard(i.id);
    assert.equal(c.dot, "bad");
    assert.match(c.text, /Couldn't sign in · checked just now Gmail didn't accept the password for bad\.setup@gmail\.com\./);
  });

  await test("an inbox deleted here keeps the version both copies last had (syncNote), so a merge with another device's rewritten check leaves it deleted", async () => {
    const r = await ev(() => {
      const T = window.__t, S = T.S, L = S._local, was = Object.assign({}, L);
      S.inboxes.push({ id: "ib-gone", email: "gone.sample@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993", chk: { ok: true, at: Date.now() - 3600000, by: "desktop", f: "x" } });
      T.SYNC.gen++;
      // As after a sync: the online copy's units are what both have.
      const u0 = T.syncUnits(S); L.base = T.syncHashes(u0); L.seen = {}; L.orig = {}; L.mt = {}; T.SYNC.baseC = T.syncBaseFrom(u0);
      // The online copy since: a desktop's email sync rewrote its check.
      const remote = JSON.parse(JSON.stringify(S)), ri = remote.inboxes.find((i) => i.id === "ib-gone");
      ri.chk = Object.assign({}, ri.chk, { ok: false, at: Date.now(), why: "Sample refusal." });
      // Deleted here (and noted).
      S.inboxes = S.inboxes.filter((i) => i.id !== "ib-gone"); T.SYNC.gen++;
      const units = T.syncNote();
      const kept = L.orig["i:ib-gone"] === u0.map.get("i:ib-gone").c;
      const m = T.syncMerge(units, T.syncUnits(remote), L.base, L.mt, {}, T.orderKey, L.orig, T.ibxFp);
      // A second note (sync rounds note again before they merge) keeps it.
      T.syncNote();
      const still = L.orig["i:ib-gone"] === u0.map.get("i:ib-gone").c;
      for (const k of Object.keys(L)) if (!(k in was)) delete L[k];
      Object.assign(L, was); T.SYNC.gen++;
      return { kept, still, back: m.state.inboxes.some((i) => i.id === "ib-gone"), toRemote: m.toRemote };
    });
    assert.deepEqual(r, { kept: true, still: true, back: false, toRemote: true });
  });

  await test("the words' contrast is 4.5:1 or more in all five themes (cards, ticked list rows, the counts)", async () => {
    const lowest = {};
    const themes = [["default", null], ["light", "light"], ["space", "space"], ["space-light", "space-light"], ["space-blue", "space-blue"]];
    for (const v of ["comfortable", "list"]) {
      await layout(v);
      if (v === "list") await ev(() => { const T = window.__t; T.UI.loginSel.add("l-ok"); T.UI.loginSel.add("l-bad"); T.render(); });
      for (const [name, attr] of themes) {
        await ev((attr) => { const d = document.documentElement; if (attr) d.setAttribute("data-theme", attr); else d.removeAttribute("data-theme"); if (attr && /^space/.test(attr)) d.setAttribute("data-stars", ""); else d.removeAttribute("data-stars"); }, attr);
        const all = await page.evaluate(`(${CONTRAST})()`);
        assert.ok(all.length > 10, name);
        const low = all.filter((x) => x.r < 4.5);
        assert.deepEqual(low, [], `${name}, ${v}`);
        lowest[name] = Math.min(lowest[name] || 99, ...all.map((x) => x.r));
      }
      if (v === "list") await ev(() => { const T = window.__t; T.UI.loginSel.clear(); T.render(); });
    }
    console.log("    (lowest: " + Object.entries(lowest).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") + ")");
    await ev(() => { const d = document.documentElement; d.setAttribute("data-theme", "space-blue"); d.setAttribute("data-stars", ""); });
    await layout("comfortable");
  });

  await test("a phone: no IMAP tab, Logins' tab has the light on one line, and the cards' Test fits", async () => {
    await page.setViewportSize({ width: 375, height: 667 });
    try {
      await page.waitForTimeout(200);
      const t = await page.$eval('#mnav [data-id="logins"]', (b) => { const r = b.getBoundingClientRect(), l = b.querySelector(".lt").getBoundingClientRect(); return { oneLine: Math.abs((l.top + l.bottom) / 2 - (r.top + r.bottom) / 2) < 6 }; });
      assert.deepEqual(t, { oneLine: true });
      const sw = await ev(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.equal(sw[0], sw[1], "no sideways scroll");
      // Each inbox card's Test is shown whole, inside its card, on its own row under the status.
      const fit = await page.$$eval("#main article.ibx-card", (as) => as.map((a) => {
        const c = a.getBoundingClientRect(), b = a.querySelector(".ibx-test button"), st = a.querySelector(".ibx-st").getBoundingClientRect();
        if (!b) return a.dataset.inbox + ": no Test";
        const r = b.getBoundingClientRect(), shown = r.width > 20 && r.height > 20 && getComputedStyle(b).visibility !== "hidden";
        return shown && r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.top >= st.bottom - 0.5 ? "" : a.dataset.inbox;
      }));
      assert.ok(fit.length >= 5, "inbox cards: " + fit.length);
      assert.deepEqual(fit.filter(Boolean), []);
    } finally { await page.setViewportSize({ width: 1280, height: 900 }); }
  });
  await page.context().close();

  // ======================== The desktop app ========================
  page = await context(() => {
    const none = async () => null, noop = () => {};
    window.__desk = { sync: [], test: [], syncAnswer: null, testAnswer: null };
    window.pvDesktop = { version: 15, onSyncProgress: noop, onUpdateStatus: noop, updateInfo: none, checkForUpdates: none,
      setUpdateSource: none, restartToUpdate: none, appReady: noop, focusApp: noop, attention: noop, scanPromos: none,
      trashPromos: none, rescueSpam: none, listSpam: none, spamToInbox: none, trashOrderMail: none, findOrderMail: none, forwardMail: none,
      syncInbox: async (cfg) => { window.__desk.sync.push(cfg); const f = window.__desk.syncAnswer; return f ? f(cfg) : { ok: true, emails: [], scanned: 0 }; },
      testInbox: async (cfg) => { window.__desk.test.push(cfg); const f = window.__desk.testAnswer; await new Promise((r) => setTimeout(r, 150)); return f ? f(cfg) : { ok: true, messages: 5 }; } };
  });
  await page.addInitScript((k) => { try { if (!sessionStorage.getItem("il-seeded")) { localStorage.setItem("pv-license", JSON.stringify({ key: k, list: null, src: "gh", checkedAt: 0 })); sessionStorage.setItem("il-seeded", "1"); } } catch (e) {} }, LIC);
  await page.goto("https://app.fafoaco.com/");
  await page.waitForFunction(() => window.__t && window.__t.DESK === true);
  await page.waitForSelector("#lic-retry, #lic-key");
  await ev(() => window.__t.renderLock());
  await page.waitForSelector("#lock-submit");
  await page.waitForSelector("#pw2");
  await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
  await ready();
  await ev(({ IB, LG }) => { const T = window.__t; T.S.inboxes.push(...IB); T.S.logins.push(...LG); T.persist(); T.render(); },
    { IB: [INBOX("d-ok", "desk.ok@gmail.com", { auto: false }), INBOX("d-cus", "desk.custom@example.com", { provider: "custom", host: "mail.example.com", password: "Sample-Cus-Pw", auto: false })],
      LG: [LOGIN("dl-ok", "target", "desk.login@example.com", "d-ok"), LOGIN("dl-cus", "target", "desk.cus@example.com", "d-cus")] });
  // Not on Auto, so the desktop's own sync after unlock (scheduleDeskAutoSync) leaves them to the tests.
  const sync = (id) => ev((id) => window.__t.syncOneInbox(window.__t.S.inboxes.find((i) => i.id === id), true), id);
  const setSync = (code) => ev((code) => { window.__desk.syncAnswer = code ? new Function("cfg", code) : null; }, code);
  const inboxOf = (id) => ev((id) => JSON.parse(JSON.stringify(window.__t.S.inboxes.find((i) => i.id === id))), id);

  await test("desktop: an email sync that signs in lights it green, keeps this computer's own check, and writes the shared one", async () => {
    await toLogins();
    let c = await inboxCard("d-ok");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test/);
    assert.deepEqual([c.test.act, c.test.disabled], ["test-inbox", false]);
    assert.match((await loginLight("desk.login@example.com"))[2], /The desktop app checks it when it syncs, or press Test/);
    await sync("d-ok");
    c = await inboxCard("d-ok");
    assert.equal(c.dot, "ok");
    assert.match(c.text, /Signed in · checked just now/);
    const i = await inboxOf("d-ok");
    assert.equal(i.deskChk.ok, true); assert.equal(i.chk.ok, true); assert.equal(i.chk.by, "desktop"); assert.equal(i.chk.at, i.deskChk.at);
    // What sync sends: the shared check, never this computer's own bookkeeping.
    const sent = await ev(() => window.__t.syncUnits(window.__t.S).map.get("i:d-ok").v);
    assert.deepEqual(sent.chk, i.chk);
    assert.ok(!("deskChk" in sent) && !("lastSync" in sent) && !("syncErrAt" in sent) && !("syncError" in sent), Object.keys(sent).join(","));
    assert.deepEqual((await loginLight("desk.login@example.com")).slice(0, 2), ["Inbox OK", "ok"]);
    assert.equal(await navLogins().then((x) => x.light), false, "no light in the sidebar with every inbox fine");
  });

  await test("desktop: the 6-hour throttle: a sync with the same answer doesn't write the shared check again until it's 6 hours old", async () => {
    const before = await inboxOf("d-ok");
    await page.waitForTimeout(20);
    await sync("d-ok");
    let now = await inboxOf("d-ok");
    assert.equal(now.chk.at, before.chk.at, "the shared check didn't change");
    assert.ok(now.deskChk.at > before.deskChk.at, "this computer's own did");
    // 5 hours old: still not.
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-ok"); i.chk.at = Date.now() - 5 * 3600000; T.persist(); });
    const five = (await inboxOf("d-ok")).chk.at;
    await sync("d-ok");
    assert.equal((await inboxOf("d-ok")).chk.at, five);
    // Over 6 hours old: written again.
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-ok"); i.chk.at = Date.now() - 7 * 3600000; T.persist(); });
    await sync("d-ok");
    now = await inboxOf("d-ok");
    assert.ok(Date.now() - now.chk.at < 60000, "written again");
  });

  await test("desktop: a sync refused for the app password turns it red at once (the light changed), with why; offline or a network error never does", async () => {
    // This computer's network: the light stays green and the card says why in words.
    await setSync('return {ok:false, error:"Couldn\'t connect to the mail server. Check your internet connection and the port."};');
    const was = (await inboxOf("d-ok")).chk;
    await sync("d-ok");
    let c = await inboxCard("d-ok");
    assert.equal(c.dot, "ok");
    assert.match(c.text, /Signed in · checked just now Couldn't check from this computer · just now Couldn't connect to the mail server\. Check your internet connection and the port\./);
    assert.deepEqual((await inboxOf("d-ok")).chk, was, "the shared check is as it was");
    // The computer offline: even a refusal isn't the inbox's.
    await ev(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
    await setSync('return {ok:false, error:"Sign-in failed. Use an app password, not your normal password, and check the email address."};');
    await sync("d-ok");
    assert.equal((await inboxCard("d-ok")).dot, "ok", "offline: not red");
    await ev(() => { delete navigator.onLine; });
    assert.equal(await ev(() => navigator.onLine), true);
    // Online, refused: red, the shared check written at once with why.
    await sync("d-ok");
    c = await inboxCard("d-ok");
    assert.equal(c.dot, "bad");
    assert.match(c.text, /Couldn't sign in · checked just now Gmail didn't accept the password for desk\.ok@gmail\.com\./);
    assert.doesNotMatch(c.text, /Couldn't check from this computer/, "the error is the light itself, not a note");
    const i = await inboxOf("d-ok");
    assert.equal(i.chk.ok, false); assert.equal(i.chk.by, "desktop"); assert.ok(i.chk.why.length <= 200);
    assert.equal(i.chk.at, i.syncErrAt, "the same moment");
    assert.deepEqual((await loginLight("desk.login@example.com")).slice(0, 2), ["Can't sign in", "bad"]);
    assert.match(await kpis(), /Can't sign in 1/);
    assert.equal((await navLogins()).title, "1 inbox can't sign in");
    // Back to signing in: green, and the note goes.
    await setSync(null);
    await sync("d-ok");
    c = await inboxCard("d-ok");
    assert.equal(c.dot, "ok");
    assert.doesNotMatch(c.text, /Couldn't/);
    assert.equal((await inboxOf("d-ok")).chk.ok, true, "the light changed, so it's written");
  });

  await test("desktop: a custom server's name that can't be found is the inbox's only while another inbox signs in from this computer (its lookups work); never for Gmail (FAFO's own name)", async () => {
    await setSync('return {ok:false, error:"Couldn\'t find that mail server. Check the provider or server name."};');
    // No other inbox signed in from here in the last 15 minutes: maybe this computer's DNS or internet is down (a hotel's
    // Wi-Fi with no internet), which the desktop words the same. Said in words, not red, nothing shared.
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-ok"); i.deskChk.at = Date.now() - 20 * 60000; T.persist(); });
    await sync("d-cus");
    let c = await inboxCard("d-cus");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test Couldn't check from this computer · just now Couldn't find that mail server\. Check the provider or server name\./);
    assert.equal((await inboxOf("d-cus")).chk, undefined, "nothing shared");
    assert.equal((await inboxOf("d-cus")).deskChk, undefined);
    // Another inbox signed in from here just now: the custom server's name is wrong. Red, and shared.
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-ok"); i.deskChk.at = Date.now() - 60000; T.persist(); });
    await sync("d-cus");
    assert.equal((await inboxCard("d-cus")).dot, "bad");
    assert.equal((await inboxOf("d-cus")).chk.ok, false);
    await sync("d-ok");
    assert.equal((await inboxCard("d-ok")).dot, "ok");
    // A certificate for another name: the custom server's; one from antivirus: this computer's.
    await setSync('return {ok:false, error:"The mail server\'s security certificate couldn\'t be verified. It was issued by “Sample Antivirus Root”. That\'s usually antivirus email scanning, a VPN or a work network checking secure connections."};');
    await sync("d-ok");
    assert.equal((await inboxCard("d-ok")).dot, "ok");
    await setSync('return {ok:false, error:"The mail server\'s security certificate couldn\'t be verified. It\'s for other.example.net, not mail.example.com. Check the server name."};');
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-cus"); delete i.chk; delete i.deskChk; T.persist(); });
    await sync("d-cus");
    c = await inboxCard("d-cus");
    assert.equal(c.dot, "bad");
    assert.match(c.text, /Its security certificate is for other\.example\.net, not mail\.example\.com\. Check the server name in this inbox's settings\./);
    await setSync(null);
  });

  await test("desktop: Test on an inbox card, in place, with the desktop app's own sign-in; a changed password is gray until it's checked", async () => {
    await page.click('#main [data-act="test-inbox"][data-id="d-cus"]');
    await page.waitForFunction(() => /Signing in…/.test(document.querySelector('#main article.ibx-card[data-inbox="d-cus"]').textContent));
    assert.ok(await page.$$eval('#main [data-act="test-inbox"]', (bs) => bs.every((b) => b.disabled)), "every Test is off meanwhile");
    await page.waitForFunction(() => document.querySelector('#main article.ibx-card[data-inbox="d-cus"] .lt-ok'));
    assert.ok((await toasts()).includes("desk.custom@example.com: signed in."));
    assert.deepEqual(await ev(() => window.__desk.test.at(-1)), { email: "desk.custom@example.com", password: "Sample-Cus-Pw", host: "mail.example.com", port: "993" });
    const i = await inboxOf("d-cus");
    assert.equal(i.chk.ok, true); assert.equal(i.chk.by, "desktop");
    // A refusal from Test: red at once, Test always writes.
    await ev(() => { window.__desk.testAnswer = () => ({ ok: false, error: "Sign-in failed. Use an app password, not your normal password, and check the email address." }); });
    await page.click('#main [data-act="test-inbox"][data-id="d-cus"]');
    await page.waitForFunction(() => document.querySelector('#main article.ibx-card[data-inbox="d-cus"] .lt-bad'));
    assert.ok((await toasts()).includes("Couldn't sign in to desk.custom@example.com. Its card says why."));
    // A network error from Test: a toast, the light as it was.
    await ev(() => { window.__desk.testAnswer = () => ({ ok: false, error: "Couldn't connect to the mail server. Check your internet connection and the port." }); });
    await page.click('#main [data-act="test-inbox"][data-id="d-cus"]');
    await until(async () => (await toasts()).some((t) => /^desk\.custom@example\.com: Couldn't connect to the mail server\./.test(t)), "the toast");
    let cc = await inboxCard("d-cus");
    assert.equal(cc.dot, "bad");
    // Said on its card and on hover too, as this computer's own (deskTry, never synced).
    assert.match(cc.text, /Couldn't sign in · checked just now .* Couldn't check from this computer · just now Couldn't connect to the mail server\. Check your internet connection and the port\. Test$/);
    assert.match((await loginLight("desk.cus@example.com"))[2], /Last try \(just now\) couldn't check from this computer: Couldn't connect to the mail server\./);
    const dt = await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-cus"); return { mine: i.deskTry, sent: T.syncUnits(T.S).map.get("i:d-cus").v }; });
    assert.equal(dt.mine.err, "Couldn't connect to the mail server. Check your internet connection and the port.");
    assert.ok(!("deskTry" in dt.sent), "never in what sync sends");
    // A check that tells afterwards hides it (it's older).
    await ev(() => { window.__desk.testAnswer = () => ({ ok: false, error: "Sign-in failed. Use an app password, not your normal password, and check the email address." }); });
    await page.click('#main [data-act="test-inbox"][data-id="d-cus"]');
    await until(async () => (await toasts()).filter((t) => t === "Couldn't sign in to desk.custom@example.com. Its card says why.").length === 2, "the toast");
    assert.doesNotMatch((await inboxCard("d-cus")).text, /Couldn't check from this computer/);
    await ev(() => { window.__desk.testAnswer = null; });
    // A changed app password: gray (this computer's own check and the shared one were for the old one).
    await ev(() => { const T = window.__t, i = T.S.inboxes.find((x) => x.id === "d-cus"); i.password = "Sample-Cus-Pw-2"; T.persist(); T.render(); });
    assert.equal((await inboxCard("d-cus")).dot, "gray");
    assert.match((await inboxCard("d-cus")).text, /Not checked yet: press Test/);
    // The inbox editor's Test writes the light too.
    await page.click('#main [data-act="edit-inbox"][data-id="d-cus"]');
    await page.waitForSelector("#layers #i-test");
    await page.waitForTimeout(150);
    await page.click("#layers #i-test");
    await page.waitForFunction(() => /Signed in\. Your inbox has 5 emails\./.test((document.querySelector("#i-test-out") || {}).textContent || ""));
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.equal((await inboxCard("d-cus")).dot, "ok");
  });

  await test("desktop: another device's newer check wins over this computer's older one, and this computer's newer one over it", async () => {
    await chkFor("d-ok", { ok: false, ago: 0, by: "server", why: "Gmail didn't accept the password for desk.ok@gmail.com." });
    assert.equal((await inboxCard("d-ok")).dot, "bad", "the other device's is newer");
    assert.match((await inboxCard("d-ok")).text, /Couldn't sign in · checked just now Gmail didn't accept the password for desk\.ok@gmail\.com\./);
    await page.waitForTimeout(10);
    await sync("d-ok");
    assert.equal((await inboxCard("d-ok")).dot, "ok", "this computer's sync came after it");
  });

  await test("desktop: what a desktop before 1.9.157 kept counts from unlock, for the credentials then: red with no time when its last sync was refused, green at its last sync, gray once edited; a new inbox refused offline is gray", async () => {
    const now = Date.now(), AUTH = "Sign-in failed. Use an app password, not your normal password, and check the email address.";
    await ev(({ now, AUTH }) => {
      const T = window.__t;
      T.S.inboxes.push(
        { id: "lg-err", email: "legacy.err@yahoo.com", password: "abcdabcdabcdabcd", provider: "yahoo", host: "imap.mail.yahoo.com", port: "993", auto: false, syncError: AUTH },
        { id: "lg-err2", email: "legacy.err2@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993", auto: false, lastSync: now - 3 * 86400000, syncError: AUTH },
        { id: "lg-ok", email: "legacy.ok@example.com", password: "Sample-Legacy-Pw", provider: "custom", host: "mail.legacy.example.com", port: "993", auto: false, lastSync: now - 3 * 86400000 },
        { id: "lg-net", email: "legacy.net@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993", auto: false, lastSync: now - 2 * 3600000, syncError: "Couldn't connect to the mail server. Check your internet connection and the port." },
        { id: "lg-none", email: "legacy.none@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993", auto: false });
      T.persist();
    }, { now, AUTH });
    // Lock and unlock: deskChkSeed runs as it opens.
    await ev(() => window.__t.lock());
    await page.waitForSelector("#pw1");
    await page.fill("#pw1", PW);
    await ready();
    await toLogins();
    const AGO = /\d+ (days?|hr|min) ago|just now/;
    for (const id of ["lg-err", "lg-err2"]) {
      const c = await inboxCard(id);
      assert.equal(c.dot, "bad", id);
      assert.match(c.text, /Couldn't sign in on its last sync (Yahoo|Gmail) didn't accept the password for legacy\.err2?@/, id);
      assert.doesNotMatch(c.text, AGO, id + ": no time, as it isn't known");
      assert.match(c.title, /^Couldn't sign in on its last sync on your desktop app: (Yahoo|Gmail) didn't accept the password/, id);
      assert.doesNotMatch(c.title, AGO, id);
      assert.doesNotMatch(c.text, /Couldn't check from this computer/, "its error is the light itself");
    }
    const seeded = await ev(() => { const T = window.__t; return Object.fromEntries(T.S.inboxes.filter((i) => /^lg-/.test(i.id)).map((i) => [i.id, i.deskChk ? Object.assign({}, i.deskChk, { fits: i.deskChk.f === T.ibxFp(i) }) : null])); });
    assert.deepEqual([seeded["lg-err"].ok, seeded["lg-err"].at, seeded["lg-err"].u, seeded["lg-err"].fits], [false, 1, 1, true]);
    assert.equal(seeded["lg-err2"].at, now - 3 * 86400000 + 1);
    assert.deepEqual([seeded["lg-ok"].ok, seeded["lg-ok"].at, seeded["lg-ok"].u, seeded["lg-ok"].fits], [true, now - 3 * 86400000, undefined, true]);
    assert.equal(seeded["lg-none"], null, "nothing to go by: gray until it's checked");
    let c = await inboxCard("lg-ok");
    assert.equal(c.dot, "ok"); assert.match(c.text, /Signed in · checked 3 days ago/);
    c = await inboxCard("lg-net");
    assert.equal(c.dot, "ok");
    assert.match(c.text, /Signed in · checked 2 hr ago Couldn't check from this computer Couldn't connect to the mail server\./);
    assert.equal((await inboxCard("lg-none")).dot, "gray");
    // An edit with the same app password (its port, in the inbox editor, which starts no sync): gray, as nothing checked it.
    await page.click('#main [data-act="edit-inbox"][data-id="lg-ok"]');
    await page.waitForSelector('#layers [name="i_port"]');
    await settled();
    await page.fill('#layers [name="i_port"]', "995");
    await page.click("#layers #i-save");
    await closed();
    c = await inboxCard("lg-ok");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test/);
    assert.equal(await ev(() => window.__desk.sync.filter((x) => x.email === "legacy.ok@example.com").length), 0, "no sync started");
    // A new inbox's first sync refused with this computer offline (1.9.157 keeps when it failed): gray with the words, never
    // red, and no "days ago".
    await ev(() => { const T = window.__t; T.S.inboxes.push({ id: "lg-new", email: "fresh.sample@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993", auto: false }); T.persist(); T.render(); });
    await ev(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
    try {
      await setSync('return {ok:false, error:"' + AUTH + '"};');
      await sync("lg-new");
    } finally { await ev(() => { delete navigator.onLine; }); await setSync(null); }
    c = await inboxCard("lg-new");
    assert.equal(c.dot, "gray");
    assert.match(c.text, /Not checked yet: press Test Couldn't check from this computer · just now Gmail didn't accept the password for fresh\.sample@gmail\.com\./);
    assert.doesNotMatch(c.text, /days? ago/);
    const n = await inboxOf("lg-new");
    assert.equal(n.chk, undefined); assert.equal(n.deskChk, undefined); assert.ok(n.syncErrAt > 0);
    // And it stays gray through the next unlock (a 1.9.157 sync's error isn't what a desktop before kept).
    await ev(() => window.__t.lock());
    await page.waitForSelector("#pw1");
    await page.fill("#pw1", PW);
    await ready();
    await toLogins();
    assert.equal((await inboxCard("lg-new")).dot, "gray");
    assert.equal((await inboxOf("lg-new")).deskChk, undefined);
  });

  await test("desktop: the step-by-step setup's Check and use goes on the light on Save: signed in green; refused, then Use it anyway, red; a network error, then Use it anyway, gray with the words; and from a new store login", async () => {
    const AUTH = "Sign-in failed. Use an app password, not your normal password, and check the email address.", NET = "Couldn't connect to the mail server. Check your internet connection and the port.";
    const idle = (id) => page.waitForFunction((id) => { const a = document.querySelector(`#main article.ibx-card[data-inbox="${id}"]`); return a && !a.querySelector(".ibx-busy"); }, id);
    const idOf = (email) => ev((email) => window.__t.S.inboxes.find((i) => i.email === email).id, email);
    // Signed in: Save and sync keeps it green, the shared check by this computer.
    await ev(() => { window.__desk.testAnswer = null; }); await setSync(null);
    await setupCheck("setup.ok@gmail.com");
    await page.waitForSelector("#layers #i-ready:not([hidden])");
    assert.ok((await ev(() => window.__desk.test.at(-1))).email === "setup.ok@gmail.com", "the desktop app's own sign-in");
    await page.click("#layers #i-save");
    await closed();
    let id = await idOf("setup.ok@gmail.com");
    await idle(id);
    let i = await inboxOf(id);
    assert.equal(i.chk.ok, true); assert.equal(i.chk.by, "desktop");
    assert.equal((await inboxCard(id)).dot, "ok");
    // Refused, then Use it anyway: saved red (its first sync is refused the same way).
    await ev((AUTH) => { window.__desk.testAnswer = () => ({ ok: false, error: AUTH }); }, AUTH);
    await setSync('return {ok:false, error:"' + AUTH + '"};');
    await setupCheck("setup.bad@gmail.com");
    assert.match(await text("#ig-out"), /^Gmail didn't accept the password for setup\.bad@gmail\.com\./);
    await page.click('#layers [data-ig="anyway"]');
    await page.waitForFunction(() => !document.querySelector("#ig-out") && document.querySelector("#layers #i-save"));
    await settled();
    await page.waitForTimeout(450);   // a click within 400 ms of the setup closing is dropped (it would press what's under it)
    await page.click("#layers #i-save");
    await closed();
    id = await idOf("setup.bad@gmail.com");
    await idle(id);
    i = await inboxOf(id);
    assert.equal(i.chk.ok, false); assert.equal(i.chk.by, "desktop");
    assert.equal((await inboxCard(id)).dot, "bad");
    // A network error, then Use it anyway: gray, nothing shared, its words on the card.
    await ev((NET) => { window.__desk.testAnswer = () => ({ ok: false, error: NET }); }, NET);
    await setSync('return {ok:false, error:"' + NET + '"};');
    await setupCheck("setup.net@gmail.com");
    assert.match(await text("#ig-out"), /^Couldn't connect to the mail server\./);
    await page.click('#layers [data-ig="anyway"]');
    await page.waitForFunction(() => !document.querySelector("#ig-out") && document.querySelector("#layers #i-save"));
    await settled();
    await page.waitForTimeout(450);   // a click within 400 ms of the setup closing is dropped (it would press what's under it)
    await page.click("#layers #i-save");
    await closed();
    id = await idOf("setup.net@gmail.com");
    await idle(id);
    i = await inboxOf(id);
    assert.equal(i.chk, undefined); assert.equal(i.deskChk, undefined);
    const nc = await inboxCard(id);
    assert.equal(nc.dot, "gray");
    assert.match(nc.text, /Not checked yet: press Test Couldn't check from this computer · just now Couldn't connect to the mail server\./);
    // A new store login whose new inbox the setup checked: Save login puts it on that inbox's light.
    await ev(() => { window.__desk.testAnswer = null; }); await setSync(null);
    await setupCheck("", async () => {
      await page.click('#main .view-tools [data-act="new-login"]');
      await page.waitForSelector('#layers [name="email"]');
      await settled();
      await page.fill('#layers [name="email"]', "setup.login@gmail.com");
      await page.fill('#layers [name="password"]', "Store-Pw-Sample-3");
    });
    await page.waitForSelector("#layers #i-ready:not([hidden])");
    await page.click("#layers #l-save");
    await closed();
    id = await idOf("setup.login@gmail.com");
    i = await inboxOf(id);
    assert.equal(i.chk.ok, true); assert.equal(i.chk.by, "desktop");
    assert.deepEqual((await loginLight("setup.login@gmail.com")).slice(0, 2), ["Inbox OK", "ok"]);
  });

  await test("a page before 1.9.157 syncs the new field as it is (it isn't one of its device fields)", async () => {
    const old = join(root, "index-1.9.112.html");
    if (!existsSync(old)) { console.log("    (no index-1.9.112.html here: skipped)"); return; }
    const m = /const SYNC_DEVICE_FIELDS = \{inboxes:\[([^\]]*)\]\}/.exec(readFileSync(old, "utf8"));
    assert.ok(m, "1.9.112's device fields");
    assert.ok(!/"chk"/.test(m[1]), m[1]);
    const now = /const SYNC_DEVICE_FIELDS = \{inboxes:\[([^\]]*)\]\}/.exec(HTML)[1];
    assert.ok(/"deskChk"/.test(now) && /"deskTry"/.test(now) && /"syncErrAt"/.test(now) && !/"chk"/.test(now), now);
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}
console.log(`${passed} passed`);
