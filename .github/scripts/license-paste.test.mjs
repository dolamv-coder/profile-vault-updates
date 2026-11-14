// Tests a license key pasted where an invite code goes in the newest page (index-X.Y.Z.html), from 1.9.149 (the owner,
// 2026-11-14, with a screenshot of the web version's "Fill in profiles for someone": their license key in "Code from the
// person who asked" got "Couldn't find a code starting with PVKEY1", then "yes add that message for license keys"). The real
// page runs in Chromium (Playwright), as the web version at app.fafoaco.com, against a pretend license worker, as
// download.test.mjs and imap-submit.test.mjs run it, then as the desktop app (window.pvDesktop stubbed): I was sent a code
// with a key (alone, with spaces and line breaks around it, in lower case, with spaces for its dashes, in a sentence) says
// it's a license key and where it goes, and in a browser with no vault Open FAFO with this key opens the sync sign-in with
// the key filled in; an invite code (PVKEY1.) anywhere in the text still wins; other text keeps the old message; Submit's
// Send somewhere else with a key; and the desktop's own words, with no button. The key never shows in the words. Sample keys
// only (PVLT-TEST-…).
//   node .github/scripts/license-paste.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must recognise a key (licKeyIn); a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createECDH } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!/function licKeyIn\(/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} doesn't recognise a license key pasted where an invite code goes (licKeyIn): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no licKeyIn, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get MODE(){ return MODE; }, get DESK(){ return DESK; }, licKeyIn, licFormat, keepTypedLic, persist, render, renderLock, lock};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

const KEY = "PVLT-TEST-AAAA-BBBB-CCCC", OTHER = "PVLT-TEST-DDDD-EEEE-FFFF";
// An invite code as a seller's FAFO makes one: PVKEY1. and a P-256 public key, raw, base64url.
const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
const INVITE = "PVKEY1." + ecdh.getPublicKey().toString("base64url");
const OLD_START = "Couldn't find a code starting with PVKEY1. Paste the whole message you were sent.";
const OLD_TO = "Couldn't find a code starting with PVKEY1.";
const HEAD = "That's a FAFO license key, not an invite code.";
const WHAT = "This window is for filling in profiles for someone who sent you an invite code (it starts with PVKEY1.).";

// ---- The pretend license worker ----
const W = { info: [] };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-vault-auth" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ready: true });
  if (p === "/vault/info") { W.info.push(auth); return auth === "Bearer " + KEY ? json(route, 200, { exists: false }) : json(route, 401, { error: "license not recognized" }); }
  if (auth !== "Bearer " + KEY) return json(route, 401, { error: "license not recognized" });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 50, request: null, canRequest: true });
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
async function context(init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
    return route.fulfill({ status: 404, body: "" });
  });
  // The setup guide (1.9.145) doesn't ask here (Not now, until far ahead): its own test is walkthrough.test.mjs.
  await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const layers = (n) => page.waitForFunction((n) => document.querySelectorAll("#layers .layer").length === n, n);
const title = () => text("#layers .layer:last-child .panel-head h2");
const closeTop = async () => { const n = await page.$$eval("#layers .layer", (l) => l.length); await page.click("#layers .layer:last-child .panel-foot [data-close]"); await layers(n - 1); };
const focused = (id) => page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id);
// What the window says once `value` is pasted in its box: the note about a license key (hidden: ""), its button, the old
// error, whether Continue (or a key ID) shows.
async function paste(box, value) {
  await page.fill(box, value);
  const pre = box === "#ss-code" ? "ss" : "st";
  await page.waitForTimeout(80);   // an invite code is read asynchronously (importOwnerPub)
  return ev((pre) => {
    const note = document.getElementById(pre + "-lic-note"), err = document.getElementById(pre + "-err"), id = document.getElementById(pre + "-id");
    const go = document.getElementById(pre + "-go"), b = note.querySelector("button");
    return {
      note: note.hidden ? "" : (note.querySelector("p") || note).textContent.replace(/\s+/g, " ").trim(),
      role: note.getAttribute("role"), warn: note.classList.contains("note-warn"),
      button: b ? b.textContent.trim() : "",
      err: err.textContent, id: id.hidden ? "" : id.textContent,
      go: go ? !go.disabled : null,
    };
  }, pre);
}
// No form of the key in what the window says (it's in the box already).
const noKey = (s) => assert.doesNotMatch(s, /PVLT|TEST|AAAA|BBBB|CCCC|DDDD/i, "the key itself isn't in the words");
const openStart = async () => { await page.click("#lock-submit"); await page.waitForSelector("#ss-code"); assert.equal(await title(), "Fill in profiles for someone"); };
// Submit's Send somewhere else, on a vault with one profile on a store.
async function openTo() {
  await page.click('#side [data-id="submit"]');
  await page.click('#main [data-act="submit-to"]');
  await page.waitForSelector("#st-code");
  assert.equal(await title(), "Who receives your slots");
}
async function addProfile() {
  await ev(() => {
    const T = window.__t, S = T.S;
    S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
    S.addresses.push({ id: "a1", first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
    S.profiles.push({ id: "t1", name: "Sam T1", shipId: "a1", billSame: true, cardId: "c1", phone: "5125550100", email: "", stores: [{ store: "target", mode: "seller" }] });
    T.persist(); T.render();
  });
}

console.log(`A license key where an invite code goes in ${file.split(/[\\/]/).pop()}`);
try {
  // ======== The web version ========
  page = await context();
  await page.goto("https://app.fafoaco.com/");
  await page.waitForSelector("#lock-key");   // the first screen: Continue with Discord, Have your license key? Enter it instead
  assert.equal(await ev(() => window.__t.DESK), false);

  await test("licKeyIn reads a key as the license screen reads its box (licFormat): case, spaces and dashes; or a word of the text", async () => {
    const got = await ev((cases) => cases.map((c) => window.__t.licKeyIn(c)), [
      KEY, `\n   ${KEY}  \n\n`, KEY.toLowerCase(), "PVLT TEST AAAA BBBB CCCC", "pvlttestaaaabbbbcccc",
      `My FAFO key is ${KEY}, from Discord.`, `key:${KEY.toLowerCase()}.`, `(${KEY})`, `Here:\n${KEY}\nthanks`,
      "", "hello", "PVLT-TEST-AAAA-BBBB", `${KEY}-DDDD`, "pvlt is the start of a long enough sentence", "PVKEY1.abc",
      "the words pvlt test aaaa bbbb cccc in a sentence",
    ]);
    assert.deepEqual(got, [KEY, KEY, KEY, KEY, KEY, KEY, KEY, KEY, KEY, "", "", "", "", "", "", ""]);
    // The license screen's own reading is unchanged, and the one licKeyIn uses.
    assert.equal(await ev((k) => window.__t.licFormat(k), KEY.toLowerCase()), KEY);
    assert.match(HTML, /function licKeyIn\(text\)\{\n  const t = String\(text \|\| ""\)\.slice\(0, 20000\), ok = \(k\) => \/\^PVLT\(-\[A-Z0-9\]\{4\}\)\{4\}\$\/\.test\(k\);\n  const whole = licFormat\(t\);/);
  });

  await test("I was sent a code, a key pasted on the first screen: it's a license key, it goes in Enter it instead, Open FAFO with this key", async () => {
    await openStart();
    for (const v of [KEY, `\n   ${KEY}  \n`, KEY.toLowerCase(), "PVLT TEST AAAA BBBB CCCC", `My FAFO key is ${KEY}, from Discord.`]) {
      const r = await paste("#ss-code", v);
      assert.equal(r.note, `${HEAD} ${WHAT} Your license key goes on FAFO's first screen: close this and choose Enter it instead, or open it from here.`, JSON.stringify(v));
      assert.equal(r.button, "Open FAFO with this key");
      assert.equal(r.role, "alert"); assert.ok(r.warn);
      assert.equal(r.err, "", "not the old message");
      assert.equal(r.go, false, "Continue stays off");
      noKey(await text("#ss-lic-note"));
    }
  });

  await test("other text keeps the old message exactly, and an empty box says nothing", async () => {
    for (const v of ["hello", "PVLT-TEST-AAAA", `${KEY}-DDDD`, "PVKEY1.too-short"]) {
      const r = await paste("#ss-code", v);
      assert.deepEqual([r.note, r.button, r.err, r.go], ["", "", OLD_START, false], v);
    }
    const r = await paste("#ss-code", "  ");
    assert.deepEqual([r.note, r.err, r.go], ["", "", false]);
  });

  await test("an invite code still works, and wins over a key in the same text", async () => {
    for (const v of [INVITE, `Here's my invite: ${INVITE} (and my key ${KEY})`, `${KEY}\n${INVITE}`]) {
      const r = await paste("#ss-code", v);
      assert.deepEqual([r.note, r.err, r.go], ["", "", true], v);
      assert.match(r.id, /^Key ID [A-Z0-9-]+\. If the invite shows a key ID, check that it matches\.$/);
    }
  });

  await test("Open FAFO with this key: this window closes and Open your synced vault opens with the key filled in, the cursor in Master password", async () => {
    await paste("#ss-code", `  ${KEY.toLowerCase()}\n`);
    await page.click("#ss-lic-open");
    await page.waitForFunction(() => document.querySelectorAll("#layers .layer").length === 1 && !document.querySelector("#ss-code"));
    assert.equal(await title(), "Open your synced vault");
    assert.equal(await page.$eval("#ss-lic", (e) => e.value), KEY, "as the license screen writes it");
    await focused("ss-pw");
    // The rest of the dialog is as it was: Continue asks /vault/info with that key, and a license with none makes one.
    const n = W.info.length;
    await page.click("#layers .layer:last-child #ss-go");
    await page.waitForFunction(() => /Create your synced vault/.test(document.querySelector("#layers .layer:last-child .panel-head h2").textContent));
    assert.deepEqual(W.info.slice(n), ["Bearer " + KEY]);
    assert.match(await text("#ss-say"), /There's no synced vault for the license ending CCCC yet\./);
    await closeTop();
    // Opened the usual way (Enter it instead), it's empty, with the cursor in the key box.
    await page.click("#lock-key");
    await page.waitForSelector("#ss-lic");
    assert.equal(await page.$eval("#ss-lic", (e) => e.value), "");
    await focused("ss-lic");
    await closeTop();
  });

  await test("Continue with an invite code still starts filling in profiles for that person", async () => {
    await openStart();
    await paste("#ss-code", `${KEY} ${INVITE}`);
    await page.click("#layers .layer:last-child #ss-go");
    await page.waitForFunction(() => window.__t.MODE === "submit");
    await page.goto("https://app.fafoaco.com/");
    await page.waitForSelector("#lock-key");
  });

  await test("Use this browser only's screen: the key opens your synced vault (Open my synced vault), with the same button", async () => {
    await page.click("#lock-local");
    await page.waitForSelector("#lock-sync");
    await openStart();
    const r = await paste("#ss-code", KEY);
    assert.equal(r.note, `${HEAD} ${WHAT} Your license key opens your synced vault: close this and choose Open my synced vault, or open it from here.`);
    assert.equal(r.button, "Open FAFO with this key");
    await page.click("#ss-lic-open");
    await page.waitForFunction(() => document.querySelectorAll("#layers .layer").length === 1 && !document.querySelector("#ss-code"));
    assert.equal(await page.$eval("#ss-lic", (e) => e.value), KEY);
    await focused("ss-pw");
    await closeTop();
  });

  // A vault made in this browser (Use this browser only), with a profile on a store, so Submit has its Send somewhere else.
  await page.fill("#pw1", "sample-pass-149"); await page.fill("#pw2", "sample-pass-149"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  await addProfile();

  await test("Send somewhere else with a key (no key kept yet): it's a license key, and with the box empty the slots go to the seller, Submit asking for the key", async () => {
    await openTo();
    const r = await paste("#st-code", `  ${KEY}\n`);
    assert.equal(r.note, `${HEAD} This box is for an invite code from someone else (it starts with PVKEY1.). Leave this box empty and your slots go straight to the seller's Discord channel: Submit asks for your license key when you send them, and this vault keeps it.`);
    assert.deepEqual([r.button, r.err, r.id, r.role, r.warn], ["", "", "", "alert", true]);
    noKey(await text("#st-lic-note"));
    // Save doesn't take it as a recipient, nor add "Paste a valid invite code." under the note.
    await page.click("#st-save");
    await page.waitForTimeout(100);
    assert.equal(await page.$eval("#st-err", (e) => e.textContent), "");
    assert.ok(await page.$("#st-code"), "still open");
    assert.equal(await ev(() => window.__t.S.submitTo), null);
    // Other text: the old message, exactly, and Save as before.
    let o = await paste("#st-code", "hello");
    assert.deepEqual([o.note, o.err], ["", OLD_TO]);
    await page.click("#st-save");
    assert.equal(await page.$eval("#st-err", (e) => e.textContent), OLD_TO);
    // An invite code (with a key beside it): Key ID, and Save keeps it as the recipient.
    o = await paste("#st-code", `${INVITE} ${KEY}`);
    assert.equal(o.note, ""); assert.match(o.id, /^Key ID /);
    await page.click("#st-save");
    await page.waitForFunction(() => !document.querySelector("#st-code"));
    assert.equal(await ev(() => window.__t.S.submitTo && "PVKEY1." + window.__t.S.submitTo.pub), INVITE);
    // Back to the seller's channel: Remove.
    await page.click('#main [data-act="submit-to"]');
    await page.waitForSelector("#st-clear");
    await page.click("#st-clear");
    await page.waitForFunction(() => !document.querySelector("#st-code"));
    assert.equal(await ev(() => window.__t.S.submitTo), null);
  });

  await test("Send somewhere else with a key, once the vault keeps one: the box left empty sends with it", async () => {
    await ev((k) => { window.__t.keepTypedLic(k); window.__t.persist(); window.__t.render(); }, KEY);
    await openTo();
    const r = await paste("#st-code", KEY.toLowerCase());
    assert.equal(r.note, `${HEAD} This box is for an invite code from someone else (it starts with PVKEY1.). Leave this box empty and your slots go straight to the seller's Discord channel, with the license key FAFO already has.`);
    await closeTop();
  });

  await test("a browser that has a vault: unlock it with your master password (no button: the sync sign-in is for a browser without one)", async () => {
    await ev(() => window.__t.lock());
    await page.waitForSelector("#lock-submit");
    await openStart();
    const r = await paste("#ss-code", KEY);
    assert.equal(r.note, `${HEAD} ${WHAT} This browser already has a FAFO vault: close this and unlock it with your master password. If Submit needs your license key, it asks for it.`);
    assert.deepEqual([r.button, r.err, r.go], ["", "", false]);
    await closeTop();
  });
  await page.context().close();

  // ======== The desktop app (window.pvDesktop stubbed; its license screen, then the lock screen) ========
  page = await context(() => {
    const none = async () => null, noop = () => {};
    window.pvDesktop = { version: 15, syncInbox: none, onSyncProgress: noop, onUpdateStatus: noop, updateInfo: none, checkForUpdates: none,
      setUpdateSource: none, restartToUpdate: none, appReady: noop, focusApp: noop, attention: noop, testInbox: none, scanPromos: none,
      trashPromos: none, rescueSpam: none, listSpam: none, spamToInbox: none, trashOrderMail: none, findOrderMail: none, forwardMail: none };
  });
  // A license saved on this computer (its list can't be checked here, so the page shows Try again; the lock screen is drawn
  // directly).
  await page.addInitScript((k) => { try { if (!sessionStorage.getItem("lp-seeded")) { localStorage.setItem("pv-license", JSON.stringify({ key: k, list: null, src: "gh", checkedAt: 0 })); sessionStorage.setItem("lp-seeded", "1"); } } catch (e) {} }, KEY);
  await page.goto("https://app.fafoaco.com/");
  await page.waitForFunction(() => window.__t && window.__t.DESK === true);
  await page.waitForSelector("#lic-retry, #lic-key");
  await ev(() => window.__t.renderLock());
  await page.waitForSelector("#lock-submit");

  await test("desktop, no vault yet: this computer's own key (create your master password), another key (Settings, then License), no button", async () => {
    await openStart();
    let r = await paste("#ss-code", `\n${KEY.toLowerCase()} `);
    assert.equal(r.note, `${HEAD} ${WHAT} It's the license key FAFO on this computer already uses, so there's nothing to paste: close this and create your master password. You'll find the key under Settings, then License.`);
    assert.deepEqual([r.button, r.err, r.go], ["", "", false]);
    noKey(await text("#ss-lic-note"));
    r = await paste("#ss-code", OTHER);
    assert.equal(r.note, `${HEAD} ${WHAT} FAFO on this computer uses another license key. To switch, unlock FAFO, go to Settings, then License, choose Remove from this computer, and enter this one when FAFO asks for a license key.`);
    assert.equal(r.button, "");
    // With no license saved (FAFO's license screen asks for one when it starts).
    const saved = await ev(() => { const v = localStorage.getItem("pv-license"); localStorage.removeItem("pv-license"); return v; });
    r = await paste("#ss-code", KEY);
    assert.equal(r.note, `${HEAD} ${WHAT} FAFO on this computer takes its license key on its license screen, when it starts.`);
    assert.equal(r.button, "");
    await ev((v) => localStorage.setItem("pv-license", v), saved);
    // An invite code and other text as before.
    r = await paste("#ss-code", INVITE);
    assert.deepEqual([r.note, r.err, r.go], ["", "", true]);
    r = await paste("#ss-code", "hello");
    assert.deepEqual([r.note, r.err], ["", OLD_START]);
    await closeTop();
  });

  await page.fill("#pw1", "sample-pass-149"); await page.fill("#pw2", "sample-pass-149"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  await addProfile();

  await test("desktop, Send somewhere else with a key: the box left empty sends to the seller with this FAFO's own key", async () => {
    await openTo();
    const r = await paste("#st-code", KEY);
    assert.equal(r.note, `${HEAD} This box is for an invite code from someone else (it starts with PVKEY1.). Leave this box empty and your slots go straight to the seller's Discord channel, with the license key FAFO already has.`);
    assert.deepEqual([r.button, r.err], ["", ""]);
    await closeTop();
  });

  await test("desktop, locked with a vault: this computer's own key says unlock FAFO with your master password", async () => {
    await ev(() => window.__t.lock());
    await page.waitForSelector("#lock-submit");
    await openStart();
    const r = await paste("#ss-code", KEY);
    assert.equal(r.note, `${HEAD} ${WHAT} It's the license key FAFO on this computer already uses, so there's nothing to paste: close this and unlock FAFO with your master password. You'll find the key under Settings, then License.`);
    assert.equal(r.button, "");
    await closeTop();
  });

  assert.deepEqual(errors, [], "no errors on the page");
  console.log(`\n${passed} passed`);
} finally {
  await browser.close();
}
