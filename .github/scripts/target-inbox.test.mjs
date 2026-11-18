// Tests the optional inbox of a Target store login in the newest page (index-X.Y.Z.html), from 1.9.158 (the owner, 2026-11-18,
// with a screenshot of Add store login's inbox: an email filled in, App password empty, and "Enter this inbox's app password,
// or tick Use a saved inbox": "Technically, imap is not needed for Target, can you make a Bypass for this. IMAP is still
// required for Costco."). The real page runs in Chromium (Playwright) as the web version at app.fafoaco.com, against a
// pretend license worker, in a vault made with Use this browser only, with a license key kept as Submit keeps one. It checks
// the store login editor (the Inbox heading's Optional for Target tag and its line, following the store pills; Save at Target
// with no app password typed saves the login with no inbox and no error, even with the account's email filled into the
// inbox; at Costco and Pokémon Center the inbox is required as in 1.9.157; a password typed at Target still means an inbox,
// checked as before; an inbox email typed by hand that's saved already is linked; editing a Target login to drop its inbox),
// Store logins (the gray No inbox light with "optional for Target" and Add inbox in every layout, the counts adding up with
// "No inbox, Target", the warning, the Need an inbox filter and the sidebar's and phone tab's light leaving Target out),
// Submit's window (no warning for a Target slot with no inbox or no app password, while a Costco one is still warned, a
// Target slot waiting for its login still counted, and an inbox a Target login has still sent; what the seller's channel
// gets, with Costco's AYCD and Hayha files), and the profile editor's note on a Target store login. Sample names, addresses,
// app passwords and keys only.
//   node .github/scripts/target-inbox.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have it (inboxOptional); a page named on the command line that doesn't is skipped.
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
if (!/const inboxOptional = /.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no optional inbox for Target (inboxOptional): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no optional inbox for Target, skipped`); process.exit(0);
}
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get UI(){ return UI; }, keepTypedLic, persist, render, slotKey, refreshSlotAllow, closeAllLayers};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const W = { subs: [] };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/submissions" && m === "POST") { W.subs.push(JSON.parse(req.postData())); return json(route, 200, { ok: true, id: "batch" + W.subs.length, review: "pending" }); }
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 60, stores: { target: 20, pokemoncenter: 20, costco: 20 }, base: 20, request: null, canRequest: true });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
async function context(opts) {
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
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page };
}

let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const P = "#layers .panel";
const until = async (cond, what, ms = 10000) => { for (const t0 = Date.now(); !(await cond());) { if (Date.now() - t0 > ms) throw new Error("waited too long for " + what); await new Promise((r) => setTimeout(r, 25)); } };
const toLogins = async () => {
  await page.click('#side [data-id="logins"]');
  await page.waitForFunction(() => { const h = document.querySelector("#main .view-title"); return h && h.textContent === "Store logins"; });
};
const layout = async (v) => { await page.click(`#main [data-act="login-view"][data-id="${v}"]`); await page.waitForSelector(`#main [data-act="login-view"][data-id="${v}"][aria-pressed="true"]`); };
const kpis = () => page.$eval("#main .p-kpis", (e) => [...e.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" | "));
const visibleEmails = () => page.$$eval("#main [data-lmenu]", (rs) => rs.map((r) => (r.querySelector(".login-email, .lc-email, .ll-acct") || r).textContent.trim()));
const navLogins = () => page.$eval('#side [data-id="logins"]', (b) => { const l = b.querySelector(".nav-light"); return { n: b.querySelector(".n").textContent.replace(/\s+/g, " ").trim(), light: !!l }; });
// A login's inbox line, in the layout shown: [the light's words, its dot (gray, ok or bad), its hover text, the words after
// it ("optional for Target"), the button's words and label].
const inboxLine = (id) => page.evaluate((id) => {
  const row = document.querySelector(`#main [data-lmenu="${id}"]`);
  if (!row) return null;
  const line = row.querySelector(".lt-line"), dot = line.querySelector(".lt"), opt = row.querySelector(".l-opt"), btn = row.querySelector('[data-act="edit-login"].l-setup, [data-act="edit-login"].l-setup-link');
  return [line.textContent.trim(), dot.classList.contains("lt-ok") ? "ok" : dot.classList.contains("lt-bad") ? "bad" : "gray", line.title, opt ? opt.textContent.trim() : "",
    btn ? btn.textContent.trim() : "", btn ? btn.getAttribute("aria-label") : ""];
}, id);
// Waits for the top window's first focus (openLayer's), so typing goes into the box it's meant for.
const settled = () => page.waitForFunction(() => {
  const ls = [...document.querySelectorAll("#layers .layer:not([inert])")], top = ls[ls.length - 1];
  return !!top && top.contains(document.activeElement);
});
const closed = () => page.waitForFunction(() => !document.querySelector("#layers .panel"));
// The store login editor: its Inbox heading's tag (shown or not, its words), the line under it, and each inbox field's error.
const editor = () => page.evaluate(() => {
  const tag = document.querySelector("#l-ibx-opt"), err = (n) => { const f = document.querySelector(`#layers [data-field="${n}"] .err`); return f ? f.textContent.trim() : ""; };
  return { tag: tag && !tag.hidden && getComputedStyle(tag).display !== "none" ? tag.textContent.trim() : "", line: document.querySelector("#l-ibx-line").textContent.replace(/\s+/g, " ").trim(),
    errs: ["i_email", "i_password", "i_provider", "inboxId"].map(err).filter(Boolean) };
});
async function newLogin(email, store) {
  await page.click('#main .view-tools [data-act="new-login"]');
  await page.waitForSelector('#layers [name="email"]');
  await settled();
  if (store) await page.click(`${P} #l-pills .spick[data-pick="${store}"]`);
  await page.fill('#layers [name="email"]', email);
  await page.fill('#layers [name="password"]', "Store-Pw-Sample");
}
const loginOf = (email) => ev((email) => { const l = window.__t.S.logins.find((x) => x.email === email); return l ? JSON.parse(JSON.stringify(l)) : null; }, email);
const inboxCount = () => ev(() => window.__t.S.inboxes.length);

const TARGET_LINE = "Target doesn't need one: leave the app password empty to save this login without an inbox. Add it if you want the FAFO desktop app to pull this account's orders from its emails, and your seller to get its inbox access with your slots.";
const COSTCO_LINE = "Where this account's sign-in codes and order emails arrive. Costco sends a sign-in code to it, so every Costco login needs one.";
const PC_LINE = "Where this account's sign-in codes and order emails arrive. The FAFO desktop app reads it to add the account's orders, so every Pokémon Center login needs one.";
const NEED_PW = "Enter this inbox's app password, or tick Use a saved inbox. Not sure how? Press Set it up step by step.";

console.log(`An optional inbox for Target store logins in ${file.split(/[\\/]/).pop()}`);
try {
  ({ page } = await context());
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", "sample-pass-158"); await page.fill("#pw2", "sample-pass-158"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  // The vault: a license key as Submit keeps one, two inboxes, store logins at each store, with and without an inbox.
  await ev((lic) => {
    const T = window.__t, S = T.S;
    T.keepTypedLic(lic);
    S.inboxes.push({ id: "ib1", email: "saved.sample@gmail.com", password: "abcdefghijklmnop", provider: "gmail", host: "imap.gmail.com", port: "993" },
      { id: "ib-nopw", email: "nopw.sample@example.com", password: "", provider: "custom", host: "imap.example.com", port: "993" });
    const L = (id, store, email, inboxId) => ({ id, store, storeName: "", label: "", email, password: "Store-Pw-Sample", inboxId: inboxId || null, groupId: null });
    S.logins.push(L("lt-ibx", "target", "t.ibx@example.com", "ib1"), L("lt-none", "target", "t.none@example.com", null), L("lt-gone", "target", "t.gone@example.com", "ib-deleted"),
      L("lt-nopw", "target", "nopw.sample@example.com", "ib-nopw"), L("lc-none", "costco", "c.none@example.com", null), L("lp-ibx", "pokemoncenter", "p.ibx@example.com", "ib1"));
    S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
    const add = (id, name, e, email) => {
      S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: "c1", phone: "5125550100", email: email || "", stores: [Object.assign({ storeName: "", loginId: null, email: "", verified: false }, e)] });
    };
    add("t1", "Sam T1", { store: "target", mode: "login", loginId: "lt-none" }, "t.none@example.com");
    add("t2", "Sam T2", { store: "target", mode: "login", loginId: "lt-ibx" }, "t.ibx@example.com");
    add("t3", "Sam T3", { store: "target", mode: "login", loginId: "lt-gone" }, "t.gone@example.com");
    add("t4", "Sam T4", { store: "target", mode: "login", loginId: "lt-nopw" }, "nopw.sample@example.com");
    add("tw", "Sam TW", { store: "target", mode: "login", loginId: null }, "t.wait@example.com");
    add("c1", "Sam C1", { store: "costco", mode: "login", loginId: "lc-none" }, "c.none@example.com");
    T.persist(); T.render();
  }, LIC);

  // ======================== Store logins ========================
  await test("Store logins: a Target login with no inbox (none, or one that's gone) is gray No inbox, optional for Target, with Add inbox", async () => {
    await toLogins();
    for (const id of ["lt-none", "lt-gone"]) {
      const l = await inboxLine(id);
      assert.deepEqual(l.slice(0, 2), ["No inbox", "gray"], id);
      assert.equal(l[2], "This Target login has no inbox, which Target doesn't need. Add one if you want the FAFO desktop app to pull its orders from its emails, and your seller to get its inbox access with your slots.");
      assert.equal(l[3], "optional for Target");
      assert.deepEqual(l.slice(4), ["Add inbox", `Add an inbox to ${id === "lt-none" ? "t.none" : "t.gone"}@example.com`]);
    }
    // Costco's still needs one: Needs an inbox, Set up inbox.
    const c = await inboxLine("lc-none");
    assert.deepEqual(c.slice(0, 2), ["Needs an inbox", "gray"]);
    assert.equal(c[3], "", "no optional words");
    assert.deepEqual(c.slice(4), ["Set up inbox", "Set up inbox for c.none@example.com"]);
    // A Target login with an inbox: its light, as before.
    assert.deepEqual((await inboxLine("lt-ibx")).slice(0, 2), ["Not checked yet", "gray"]);
  });
  await test("Compact and the List say No inbox, with Add inbox, and no optional words", async () => {
    for (const v of ["compact", "list"]) {
      await layout(v);
      const l = await inboxLine("lt-none");
      assert.deepEqual([l[0], l[1], l[3], l[4]], ["No inbox", "gray", "", "Add inbox"], v);
      assert.deepEqual((await inboxLine("lc-none")).slice(0, 2), ["Needs an inbox", "gray"], v);
    }
    await layout("comfortable");
  });
  await test("Add inbox opens that login in its editor, which says the inbox is optional for Target", async () => {
    await page.click('#main [data-lmenu="lt-none"] [data-act="edit-login"].l-setup');
    await page.waitForSelector(P);
    assert.equal(await text(`${P} .panel-head h2`), "Edit store login");
    assert.equal(await page.$eval('#layers [name="email"]', (e) => e.value), "t.none@example.com");
    const e = await editor();
    assert.deepEqual([e.tag, e.line], ["Optional for Target", TARGET_LINE]);
    await page.click(`${P} [data-close]`);
    await closed();
  });
  await test("the counts add up to Logins with No inbox, Target; the warning and Need an inbox leave Target out", async () => {
    assert.equal(await kpis(), "Logins 6 | Inbox OK 0 | Not checked yet 3 | Need an inbox 1 | No inbox, Target 2 | Inboxes 2");
    assert.equal(await page.$('#main .p-kpis [data-act="login-filter"][data-id="opt"]'), null, "not a filter");
    assert.equal(await text("#l-need-note"), "1 store login still needs an inbox. Without one, your bot can't read the sign-in code to log into the account, so 1 profile may not get pulled. Show them");
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="true"]');
    assert.deepEqual(await visibleEmails(), ["c.none@example.com"]);
    await page.click('#main .p-kpis [data-act="login-filter"][data-id="need"]');
    await page.waitForSelector('#main .p-kpis [data-id="need"][aria-pressed="false"]');
    assert.equal((await visibleEmails()).length, 6);
  });
  await test("the sidebar's and the phone tab's light: on while the Costco login needs one, off when only Target logins have none", async () => {
    assert.deepEqual(await navLogins(), { n: "1 store login needs an inbox: 6", light: true });
    assert.match(await page.$eval('#mnav [data-id="logins"]', (b) => b.innerHTML), /lt lt-bad/);
    await ev(() => { const T = window.__t; T.S.logins.find((l) => l.id === "lc-none").inboxId = "ib1"; T.persist(); T.render(); });
    assert.deepEqual(await navLogins(), { n: "6", light: false });
    assert.doesNotMatch(await page.$eval('#mnav [data-id="logins"]', (b) => b.innerHTML), /lt-bad/);
    assert.equal(await page.$("#l-need-note"), null, "no warning");
    assert.equal(await kpis(), "Logins 6 | Inbox OK 0 | Not checked yet 4 | No inbox, Target 2 | Inboxes 2");
    assert.equal(await page.$('#main .p-kpis [data-act="login-filter"][data-id="need"]'), null);
    await ev(() => { const T = window.__t; T.S.logins.find((l) => l.id === "lc-none").inboxId = null; T.persist(); T.render(); });
  });

  // ======================== The store login editor ========================
  await test("Add store login at Target: the Optional for Target tag and its line; Save with the account's email filled into the inbox and no app password saves it with no inbox and no error", async () => {
    const n = await inboxCount();
    await newLogin("sam.t1@example.com");
    assert.equal(await page.$eval(`${P} #l-pills .spick[aria-pressed="true"]`, (e) => e.dataset.pick), "target", "Target to start");
    assert.deepEqual(await editor(), { tag: "Optional for Target", line: TARGET_LINE, errs: [] });
    assert.equal(await page.$eval('#layers [name="i_email"]', (e) => e.value), "sam.t1@example.com", "the inbox's email follows the account's");
    await ev(() => { window.__toasts.length = 0; });
    await page.click("#layers #l-save");
    await closed();
    const l = await loginOf("sam.t1@example.com");
    assert.equal(l.store, "target"); assert.equal(l.inboxId, null);
    assert.equal(await inboxCount(), n, "no inbox made");
    await until(async () => (await ev(() => window.__toasts.slice())).includes("Login added"), "the toast");
    assert.deepEqual((await inboxLine(l.id)).slice(0, 4).filter((x, i) => i !== 2), ["No inbox", "gray", "optional for Target"]);
  });
  await test("at Costco and Pokémon Center the inbox is required, as in 1.9.157; the tag and line follow the store pills", async () => {
    await newLogin("sam.c2.sample@gmail.com", "costco");
    assert.deepEqual(await editor(), { tag: "", line: COSTCO_LINE, errs: [] });
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /app password/.test((document.querySelector('#layers [data-field="i_password"] .err') || {}).textContent || ""));
    assert.deepEqual((await editor()).errs, [NEED_PW]);
    assert.equal(await loginOf("sam.c2.sample@gmail.com"), null, "not saved");
    // With no inbox email either: add one.
    await page.fill('#layers [name="i_email"]', "");
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /Add the inbox/.test((document.querySelector('#layers [data-field="i_email"] .err') || {}).textContent || ""));
    assert.equal((await editor()).errs[0], "Add the inbox this account's emails go to. Not sure how? Press Set it up step by step.");
    await page.fill('#layers [name="i_email"]', "sam.c2.sample@gmail.com");
    // Pokémon Center: its own line, and the same error.
    await page.click(`${P} #l-pills .spick[data-pick="pokemoncenter"]`);
    assert.deepEqual([(await editor()).tag, (await editor()).line], ["", PC_LINE]);
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /app password/.test((document.querySelector('#layers [data-field="i_password"] .err') || {}).textContent || ""));
    assert.equal(await loginOf("sam.c2.sample@gmail.com"), null, "not saved");
    // Target: the tag and its line, and the errors go; Save saves it with no inbox.
    await page.click(`${P} #l-pills .spick[data-pick="target"]`);
    assert.deepEqual(await editor(), { tag: "Optional for Target", line: TARGET_LINE, errs: [] });
    // Back to Costco: required again.
    await page.click(`${P} #l-pills .spick[data-pick="costco"]`);
    assert.deepEqual([(await editor()).tag, (await editor()).line], ["", COSTCO_LINE]);
    await page.click(`${P} #l-pills .spick[data-pick="target"]`);
    await page.click("#layers #l-save");
    await closed();
    const l = await loginOf("sam.c2.sample@gmail.com");
    assert.deepEqual([l.store, l.inboxId], ["target", null]);
  });
  await test("a password typed at Target means an inbox: checked as before, then saved and linked", async () => {
    const n = await inboxCount();
    await newLogin("sam.t3@example.com");
    // example.com isn't a provider FAFO can tell from the address.
    await page.fill('#layers [name="i_password"]', "Sample-App-Pw-3");
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /provider/.test((document.querySelector('#layers [data-field="i_provider"] .err') || {}).textContent || ""));
    assert.deepEqual((await editor()).errs, ["Choose the inbox's email provider."]);
    assert.equal(await loginOf("sam.t3@example.com"), null, "not saved");
    // A bad address too.
    await page.fill('#layers [name="i_email"]', "not-an-address");
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /Check the email/.test((document.querySelector('#layers [data-field="i_email"] .err') || {}).textContent || ""));
    assert.equal(await loginOf("sam.t3@example.com"), null, "not saved");
    // A Gmail address: its provider is known, and it saves with a new inbox.
    await page.fill('#layers [name="i_email"]', "sam.t3.sample@gmail.com");
    await page.selectOption('#layers [name="i_provider"]', "gmail");
    await page.click("#layers #l-save");
    await closed();
    const l = await loginOf("sam.t3@example.com");
    const i = await ev((id) => window.__t.S.inboxes.find((x) => x.id === id), l.inboxId);
    assert.equal(await inboxCount(), n + 1);
    assert.deepEqual([i.email, i.provider], ["sam.t3.sample@gmail.com", "gmail"]);
    assert.ok(i.password, "its app password");
    // A password typed, then cleared: no inbox.
    await newLogin("sam.t4@example.com");
    await page.fill('#layers [name="i_password"]', "Sample-App-Pw-4");
    await page.fill('#layers [name="i_password"]', "");
    await page.click("#layers #l-save");
    await closed();
    assert.equal((await loginOf("sam.t4@example.com")).inboxId, null);
  });
  await test("at Target, an inbox email typed by hand that's saved already is linked with no password, as before", async () => {
    await newLogin("sam.t5@example.com");
    await page.fill('#layers [name="i_email"]', "saved.sample@gmail.com");
    await page.click("#layers #l-save");
    await closed();
    assert.equal((await loginOf("sam.t5@example.com")).inboxId, "ib1");
  });
  await test("the account's email matching a saved inbox ticks Use a saved inbox at Target too, and Save links it", async () => {
    await newLogin("saved.sample+t6@gmail.com");
    assert.equal(await page.$eval('#layers [name="useSaved"]', (e) => e.checked), true);
    await page.click("#layers #l-save");
    await closed();
    assert.equal((await loginOf("saved.sample+t6@gmail.com")).inboxId, "ib1");
  });
  await test("editing a Target login that has an inbox: Use a saved inbox unticked, no app password, unlinks it with no error", async () => {
    await page.click('#main [data-lmenu="lt-ibx"] [data-act="edit-login"]');
    await page.waitForSelector('#layers [name="useSaved"]');
    await settled();
    assert.equal(await page.$eval('#layers [name="useSaved"]', (e) => e.checked), true);
    await page.click('#layers [name="useSaved"]');
    assert.deepEqual((await editor()).errs, []);
    await page.click("#layers #l-save");
    await closed();
    const l = await loginOf("t.ibx@example.com");
    assert.equal(l.inboxId, null);
    assert.equal(l.password, "Store-Pw-Sample", "its password kept");
    assert.ok(await ev(() => window.__t.S.inboxes.some((i) => i.id === "ib1")), "the inbox stays saved");
    await ev(() => { const T = window.__t; T.S.logins.find((x) => x.id === "lt-ibx").inboxId = "ib1"; T.persist(); T.render(); });
  });
  await test("editing a Pokémon Center login that has an inbox: Use a saved inbox unticked asks for the inbox, as before", async () => {
    await page.click('#main [data-lmenu="lp-ibx"] [data-act="edit-login"]');
    await page.waitForSelector('#layers [name="useSaved"]');
    await settled();
    await page.click('#layers [name="useSaved"]');
    await page.click("#layers #l-save");
    await page.waitForFunction(() => /app password/.test((document.querySelector('#layers [data-field="i_password"] .err') || {}).textContent || ""));
    assert.equal((await loginOf("p.ibx@example.com")).inboxId, "ib1", "unchanged");
    await page.click(`${P} [data-close]`);
    await closed();
  });

  // ======================== Submit ========================
  // Switches on exactly these slots ([profile id, store key]), opens Submit's window and gives back what it says.
  const openSubmit = async (slots) => {
    await ev((slots) => { const T = window.__t; T.S.slots = slots.map(([p, k]) => T.slotKey(p, k)); T.S.subs = {}; T.persist(); T.render(); }, slots);
    await page.click('#side [data-id="submit"]');
    await page.click('#main [data-act="submit-slots"]');
    await page.waitForSelector("#ss-go");
    const t = async (sel) => await page.$(sel) ? text(sel) : "";
    return { ok: await t("#ss-imap"), miss: await t("#ss-imap-miss"), nologin: await t("#ss-imap-nologin"),
      files: await page.$eval(P, (p) => { const n = [...p.querySelectorAll(".note")].find((x) => /Goes to the seller's private Discord channel/.test(x.textContent)); return n ? n.textContent.replace(/\s+/g, " ").trim() : ""; }) };
  };
  const send = async () => {
    const n = W.subs.length;
    await page.fill("#ss-from", "Sam Sample");
    await page.click("#ss-go");
    await page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
    await page.click("#layers [data-close]");
    await closed();
    assert.equal(W.subs.length, n + 1);
    return W.subs.at(-1);
  };
  await test("Submit's window: no warning for Target slots with no inbox or no app password; a Costco one still warned; a Target slot waiting for its login still counted", async () => {
    await ev(() => window.__t.refreshSlotAllow(true));
    const said = await openSubmit([["t1", "target"], ["t2", "target"], ["t3", "target"], ["t4", "target"], ["tw", "target"], ["c1", "costco"]]);
    assert.equal(said.ok, "Your inbox access for 1 of these slots (each inbox's email and app password) goes to your seller with it, so they can follow your orders.");
    assert.equal(said.miss, "1 slot has no inbox app password saved in FAFO (Costco: Sam C1), so your seller can't follow its orders: add it in Store logins.");
    assert.equal(said.nologin, "1 slot has no store login linked (Target: Sam TW), so your seller gets no login or inbox access for it: link its store login in Store logins.");
    // What the channel gets: Costco's go as AYCD and Hayha (the license worker makes the Hayha file).
    assert.equal(said.files, "Goes to the seller's private Discord channel: an AYCD profile list and a Shikari CSV for each store (for Costco, a Hayha file in place of the Shikari CSV), and its logins in a separate file (none for Pokémon Center). Your slots show Pending approval here until the seller approves or declines them.");
    // The inbox a Target login has still goes with its slot; none for the others.
    const b = await send();
    assert.deepEqual(b.files.filter((f) => f.kind === "imap").map((f) => [f.storeKey, f.text]), [["target", "saved.sample@gmail.com:abcdefghijklmnop"]]);
  });
  await test("only Target slots with no inbox: nothing about inboxes, and the channel gets AYCD and Shikari files", async () => {
    const said = await openSubmit([["t1", "target"], ["t3", "target"]]);
    assert.deepEqual([said.ok, said.miss, said.nologin], ["", "", ""]);
    assert.match(said.files, /^Goes to the seller's private Discord channel: an AYCD profile list and a Shikari CSV for each store, and its logins/);
    assert.doesNotMatch(await text(P), /inbox access|app password/);
    const b = await send();
    assert.deepEqual(b.files.filter((f) => f.kind === "imap"), []);
  });
  await test("only Costco slots: one store's warning without its name, and the channel gets AYCD and Hayha files", async () => {
    await ev(() => {
      const S = window.__t.S;
      S.addresses.push({ id: "ac2", first: "Sam", last: "Sample", line1: "2 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.profiles.push({ id: "c2", name: "Sam C2", shipId: "ac2", billSame: true, cardId: "c1", phone: "5125550100", email: "c.none@example.com", stores: [{ store: "costco", storeName: "", mode: "login", loginId: "lc-none", email: "", verified: false }] });
      window.__t.persist();
    });
    const said = await openSubmit([["c1", "costco"], ["c2", "costco"]]);
    assert.equal(said.miss, "2 slots have no inbox app password saved in FAFO (Sam C1, Sam C2), so your seller can't follow those orders: add it in Store logins.");
    assert.match(said.files, /^Goes to the seller's private Discord channel: an AYCD profile list and a Hayha file for Costco, and its logins/);
    await page.click(`${P} [data-close]`);
    await closed();
    // The panel's line too.
    assert.match(await text("#main .sub-act"), /Going straight to the seller's Discord channel as AYCD and Shikari files \(AYCD and Hayha for Costco\)\./);
  });
  await test("a Target login saved with no inbox never sends the inbox saved for its mailbox; a Costco login with none linked, or linked to one that's gone, still does", async () => {
    // The review of 1.9.158: a Target login on a +tag of a saved inbox's mailbox, with Use a saved inbox (ticked for it)
    // unticked and no app password, is saved with no inbox and shows No inbox, so none goes with its slots.
    await toLogins();
    await newLogin("saved.sample+t7@gmail.com");
    assert.equal(await page.$eval('#layers [name="useSaved"]', (e) => e.checked), true, "ticked for it");
    await page.click('#layers [name="useSaved"]');
    assert.deepEqual(await editor(), { tag: "Optional for Target", line: TARGET_LINE, errs: [] });
    await page.click("#layers #l-save");
    await closed();
    const l = await loginOf("saved.sample+t7@gmail.com");
    assert.equal(l.inboxId, null);
    assert.deepEqual((await inboxLine(l.id)).slice(0, 2), ["No inbox", "gray"]);
    await ev((lid) => {
      const T = window.__t, S = T.S;
      S.inboxes.push({ id: "ib-fb", email: "fb.sample@example.com", password: "Sample-Fb-Pw", provider: "custom", host: "imap.example.com", port: "993" },
        { id: "ib-fb2", email: "fb2.sample@example.com", password: "Sample-Fb2-Pw", provider: "custom", host: "imap.example.com", port: "993" });
      const L = (id, store, email, inboxId) => ({ id, store, storeName: "", label: "", email, password: "Store-Pw-Sample", inboxId, groupId: null });
      // Each on a +tag of a saved inbox's mailbox: at Target, one linked to an inbox that's gone; at Costco, whose logins need
      // an inbox, one with none linked and one linked to an inbox that's gone, which still send the one saved for it (1.9.147).
      S.logins.push(L("lt-fbgone", "target", "fb.sample+t9@example.com", "ib-deleted"), L("lc-fb", "costco", "fb.sample+c8@example.com", null),
        L("lc-fb2", "costco", "fb2.sample+c9@example.com", "ib-deleted"));
      const add = (id, name, e) => {
        S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
        S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: "c1", phone: "5125550100", email: "", stores: [Object.assign({ storeName: "", email: "", verified: false, mode: "login" }, e)] });
      };
      add("t7", "Sam T7", { store: "target", loginId: lid });
      add("t9", "Sam T9", { store: "target", loginId: "lt-fbgone" });
      add("c8", "Sam C8", { store: "costco", loginId: "lc-fb" });
      add("c9", "Sam C9", { store: "costco", loginId: "lc-fb2" });
      T.persist(); T.render();
    }, l.id);
    const said = await openSubmit([["t7", "target"], ["t9", "target"], ["c8", "costco"], ["c9", "costco"]]);
    assert.deepEqual([said.ok, said.miss, said.nologin], ["Your inbox access for 2 of these slots (each inbox's email and app password) goes to your seller with them, so they can follow your orders.", "", ""]);
    const b = await send();
    assert.deepEqual(b.files.filter((f) => f.kind === "imap").map((f) => [f.storeKey, f.text]), [["costco", "fb.sample@example.com:Sample-Fb-Pw\r\nfb2.sample@example.com:Sample-Fb2-Pw"]]);
    assert.ok(!JSON.stringify(b.files.filter((f) => f.kind === "imap")).includes("saved.sample"), "not the inbox saved for the Target login's mailbox");
  });

  // ======================== The profile editor ========================
  await test("the profile editor's note on a store login: optional at Target, Costco's as before", async () => {
    await page.click('#side [data-id="profiles"]');
    await page.click('#main [data-act="new-profile"] >> nth=0');
    await page.waitForSelector(`${P} #pl-list`);
    await page.click(`${P} #pl-list .spick[data-pick="target"]`);
    const t = page.locator(`${P} .ret-cfg[data-key="target"] .ret-imap`);
    assert.ok(await t.isVisible());
    assert.equal(await t.textContent(), "An inbox is optional for Target. If this store login has one, with its app password, FAFO sends your seller its inbox access with your slots.");
    await page.click(`${P} #pl-list .spick[data-pick="costco"]`);
    const c = page.locator(`${P} .ret-cfg[data-key="costco"] .ret-imap`);
    assert.ok(await c.isVisible());
    assert.equal(await c.textContent(), "FAFO sends your seller this email's IMAP access (the email and its app password) with your slots when you submit, so they can follow your orders. It's the inbox saved on the store login: make sure it has its app password.");
    await ev(() => window.__t.closeAllLayers());
  });

  // ======================== A phone ========================
  await test("a phone (375 × 667): the No inbox line, its words and Add inbox fit the card", async () => {
    const { page: ph, ctx } = await context({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const keep = page; page = ph;
    try {
      await page.goto("https://app.fafoaco.com/");
      await page.click("#lock-local");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
      await page.fill("#pw1", "sample-pass-158"); await page.fill("#pw2", "sample-pass-158"); await page.click("#lock-go");
      await page.waitForSelector('#mnav [data-id="logins"]', { state: "attached", timeout: 30000 });
      await ev(() => { const T = window.__t; T.S.logins.push({ id: "lt-p", store: "target", storeName: "", label: "", email: "a.rather.long.sample.address@example.com", password: "Store-Pw-Sample", inboxId: null }); T.persist(); T.render(); });
      await page.click('#mnav [data-id="logins"]');
      await page.waitForSelector('#main [data-lmenu="lt-p"]');
      const fit = await ev(() => {
        const card = document.querySelector('#main [data-lmenu="lt-p"]'), r = card.getBoundingClientRect();
        const parts = [...card.querySelectorAll(".l-inbox-line .lt-line, .l-inbox-line .l-setup")].map((e) => e.getBoundingClientRect());
        return { inside: parts.length === 2 && parts.every((p) => p.width > 0 && p.left >= r.left - 0.5 && p.right <= r.right + 0.5), page: document.documentElement.scrollWidth <= window.innerWidth };
      });
      assert.ok(fit.inside && fit.page, JSON.stringify(fit));
    } finally { page = keep; await ctx.close(); }
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}
console.log(`\n${passed} passed`);
