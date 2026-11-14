// Tests Costco on Profiles in the newest page (index-X.Y.Z.html), from 1.9.148 (the owner's request, 2026-11-13: "in Profile,
// create another store for Costco. Do not give option for "use assigned account" this is specifically personal account
// base."). Costco is a store every picker offers (PICK_STORES), after Pokémon Center and Target, and it checks out only on the
// buyer's own Costco account, a store login (LOGIN_ONLY, wayFor), never Use Assigned Account. The real page runs in Chromium
// (Playwright), as the web version at app.fafoaco.com, against a pretend license worker, as walkthrough.test.mjs runs it:
// vaults made with Use this browser only. It checks the profile editor (Costco's pill, no "How this store checks out", its
// store login picker and the IMAP note), saving a Costco profile with its login and the readiness pill without one, a saved
// vault, an import and an online copy merged in with Costco on Use Assigned Account or an email (fixMode: Store login, waiting
// for a login), Duplicate for Costco from a profile on Use Assigned Account, Paste, Mass edit to Costco never giving
// Use Assigned Account, Generate's Import onto Costco (Store login, linked by email), Submit's files for a Costco slot (its
// own AYCD list, slots CSV and logins, never assigned, also one left on Use Assigned Account in memory: asksSeller), what
// Submit's window says of a slot waiting for its store login (none linked, not a missing inbox) and its inbox once linked,
// the Profiles counts strip's dot, the share image, Send accounts (no Costco) and the setup guide's words. Sample data only.
//   node .github/scripts/costco.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must offer Costco in PICK_STORES; a page named on the command line that doesn't is skipped.
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
if (!/const PICK_STORES = \[[^\]]*"costco"/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no Costco in PICK_STORES: update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no Costco in PICK_STORES, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, get KEY(){ return KEY; }, get VAULT(){ return VAULT; }, UI, persist, render, closeAllLayers, keepTypedLic,"
  + " sanitizeState, syncMergeIn, fixMode, wayFor, loginOnly, LOGIN_ONLY, PICK_STORES, profileProblems, profileIssueWords, pmPlan, copyProfiles, openPasteProfiles,"
  + " openAssignAccounts, drawSuccess, storeMark, refreshPremium, openDraftImport, asksSeller};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const PW = "sample-pass-148";
const LIC = "PVLT-TEST-TEST-TEST-TEST";

// ---- The pretend license worker ----
const W = { subs: [] };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/premium") return json(route, 200, { premium: false, owner: false });
  if (p === "/billing" && m === "GET") return json(route, 200, { on: false });
  if (p === "/interests" && m === "GET") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 20, request: null, canRequest: true });
  if (p === "/submissions" && m === "POST") { W.subs.push(JSON.parse(req.postData())); return json(route, 200, { ok: true, id: "batch1", review: "pending" }); }
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  return json(route, 404, {});
}

const browser = await chromium.launch();
const errors = [];
// A new browser (its own storage) with a vault made with Use this browser only. The setup guide doesn't ask here
// (walkthrough.test.mjs tests it).
async function session(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
    return route.fulfill({ status: 404, body: "" });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + String(e)));
  const s = {
    ctx, page,
    ev: (fn, arg) => page.evaluate(fn, arg),
    text: (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim()),
    ready: () => page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 }),
    // A profile by name (and store), as saved.
    prof: (nm, k) => page.evaluate(([nm, k]) => JSON.parse(JSON.stringify(window.__t.S.profiles.find((p) => p.name === nm && (!k || (p.stores[0] || {}).store === k)) || null)), [nm, k]),
    async profiles() { await page.click('#side [data-id="profiles"]'); await page.waitForSelector('#main [data-act="new-profile"]'); },
    async relock() {
      await page.click('[data-act="lock"]');
      await page.waitForSelector("#pw1");
      await page.fill("#pw1", PW);   // the lock screen unlocks as the password is typed
      await s.ready();
    },
    async close() { await ctx.close(); },
  };
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
  await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
  await s.ready();
  return s;
}
const ADDR = (id, line1) => ({ id, first: "Sam", last: "Sample", line1, line2: "", city: "Austin", state: "TX", zip: "78701", country: "US" });
const CARD = { id: "c1", nick: "Sample", number: "4111111111111111", expM: "07", expY: "2031", cvv: "123", holder: "Sam Sample" };
const entry = (store, mode, o = {}) => Object.assign({ store, storeName: "", mode, loginId: null, email: "", verified: false }, o);
// Profiles put straight into the vault (a ready one: an address of its own, the card, a phone), then saved and drawn.
const addProfiles = (s, list) => s.ev((list) => {
  const { S, persist, render } = window.__t;
  if (!S.cards.some((c) => c.id === "c1")) S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "07", expY: "2031", cvv: "123", holder: "Sam Sample" });
  list.forEach((p) => {
    S.addresses.push({ id: "a" + p.id, first: "Sam", last: "Sample", line1: "1 Sample St", line2: "", city: "Austin", state: "TX", zip: "78701", country: "US" });
    S.profiles.push(Object.assign({ shipId: "a" + p.id, billSame: true, cardId: "c1", phone: "5125550100", email: "", groupId: null, createdAt: 1, updatedAt: 1 }, p));
  });
  persist(); render();
}, list);
const addLogins = (s, list) => s.ev((list) => { const { S, persist, render } = window.__t; S.logins.push(...list); persist(); render(); }, list);
const costcoLogin = (id, email) => ({ id, store: "costco", storeName: "", label: "", email, password: "pw-" + id, inboxId: null });
const P = "#layers .panel";

console.log(`Costco on Profiles in ${file.split(/[\\/]/).pop()}`);
try {
  await test("the page's source: the pickers offer Pokémon Center, Target and Costco, and Costco is on a store login only", async () => {
    assert.match(HTML, /const PICK_STORES = \["pokemoncenter", "target", "costco"\];/);
    assert.match(HTML, /const LOGIN_ONLY = \["costco"\];/);
    // Every online copy this vault merges or opens is put on this version's modes first (fixMode, in sanitizeState).
    const remote = HTML.match(/syncUnits\([^()]*\.state\)/g) || [];
    assert.deepEqual(remote, [], "an online copy's state goes through sanitizeState before syncUnits");
    assert.equal((HTML.match(/syncUnits\(sanitizeState\(/g) || []).length, 2, "the sync round and syncMergeIn");
    assert.match(HTML, /const st = sanitizeState\(o\.p\.state\);/, "syncStartFrom");
  });

  // ---- A: the editor, saving, the pill, a saved vault and an import ----
  let s = await session("A");
  await test("wayFor and fixMode: Costco on Use Assigned Account or an email is on Store login, waiting for a login; other stores as before", async () => {
    const r = await s.ev(() => {
      const { wayFor, fixMode, loginOnly } = window.__t;
      return {
        ways: [wayFor("costco", "seller"), wayFor("costco", "email"), wayFor("costco", "login"), wayFor("other:costco", "seller"), wayFor("target", "seller"), wayFor("pokemoncenter", "email")],
        only: ["costco", "other:costco", "target", "pokemoncenter", "walmart"].map(loginOnly),
        seller: fixMode({ store: "costco", storeName: "", mode: "seller", loginId: "x", email: "", verified: false }, "sam@example.com", null),
        email: fixMode({ store: "costco", storeName: "", mode: "email", loginId: null, email: "sam@example.com", verified: true }, "sam@example.com", null),
        login: fixMode({ store: "costco", storeName: "", mode: "login", loginId: "l9", email: "", verified: false }, "", null),
        none: fixMode({ store: "costco", storeName: "", loginId: "l9" }, "", null),
        typed: fixMode({ store: "other", storeName: "Costco", mode: "seller", loginId: null, email: "", verified: false }, "", null),
        target: fixMode({ store: "target", storeName: "", mode: "seller", loginId: null, email: "", verified: false }, "", null),
        pc: fixMode({ store: "pokemoncenter", storeName: "", mode: "seller", loginId: null, email: "", verified: false }, "", null),
      };
    });
    assert.deepEqual(r.ways, ["login", "login", "login", "login", "seller", "email"]);
    assert.deepEqual(r.only, [true, true, false, false, false]);
    for (const k of ["seller", "email"]) assert.deepEqual(r[k], { store: "costco", storeName: "", mode: "login", loginId: null, email: "", verified: false }, k);
    assert.deepEqual([r.login.mode, r.login.loginId], ["login", "l9"], "a store login stays linked");
    assert.deepEqual([r.none.mode, r.none.loginId], ["login", "l9"]);
    assert.equal(r.typed.mode, "login", "a store typed as Costco too");
    assert.equal(r.target.mode, "seller"); assert.equal(r.pc.mode, "seller");
  });

  await test("the profile editor's Store pills: Pokémon Center, Target, Costco; Costco has no \"How this store checks out\" and no Use Assigned Account", async () => {
    await addLogins(s, [costcoLogin("lc1", "sam.costco@example.com")]);
    await s.profiles();
    await s.page.click('#main [data-act="new-profile"] >> nth=0');
    await s.page.waitForSelector(`${P} #pl-list`);
    assert.deepEqual(await s.page.$$eval(`${P} #pl-list .spick`, (els) => els.map((e) => e.dataset.pick)), ["pokemoncenter", "target", "costco"]);
    assert.equal(await s.page.$eval(`${P} #pl-list .spick[data-pick="costco"] .smark`, (e) => e.textContent), "C", "the C tile mark");
    assert.match(await s.text(P), /Each profile checks out on one store, with its own shipping and billing address\. For another store, use Duplicate on Profiles:/);
    assert.doesNotMatch(await s.text(P), /the other store/, "three stores now");
    // Target, for comparison: its choice of two.
    await s.page.click(`${P} #pl-list .spick[data-pick="target"]`);
    assert.deepEqual(await s.page.$$eval(`${P} select[name="m_target"] option`, (els) => els.map((e) => e.value)), ["login", "seller"]);
    await s.page.click(`${P} #pl-list .spick[data-pick="costco"]`);
    const cfg = `${P} .ret-cfg[data-key="costco"]`;
    await s.page.waitForSelector(cfg);
    assert.equal(await s.page.$$eval(`${P} .ret-cfg`, (els) => els.length), 1, "one store");
    assert.equal(await s.page.locator(`${P} select[name="m_costco"]`).count(), 0, "no choice to make");
    assert.equal(await s.page.locator(`${cfg} [data-mode="seller"]`).count(), 0);
    assert.doesNotMatch(await s.text(cfg), /assigned/i);
    assert.equal(await s.text(`${cfg} .ret-own`), "Costco checks out on your own Costco account: pick its store login.");
    assert.ok(await s.page.locator(`${cfg} select[name="l_costco"]`).isVisible(), "its store login picker");
    assert.deepEqual(await s.page.$$eval(`${cfg} select[name="l_costco"] option`, (els) => els.map((e) => e.value)), ["", "lc1"]);
    assert.ok(await s.page.locator(`${cfg} [data-newlogin="costco"]`).isVisible(), "New, for a login not saved yet");
    assert.ok(await s.page.locator(`${cfg} .ret-imap`).isVisible(), "the IMAP note, as for Target's store login");
  });

  await test("saving a Costco profile needs its store login; with it, the profile is on Store login with that login's email, Ready to submit", async () => {
    await s.page.fill(`${P} [name="name"]`, "Costco One");
    await s.page.fill(`${P} [name="phone"]`, "5125550100");
    await s.page.fill(`${P} [name="s_first"]`, "Sam"); await s.page.fill(`${P} [name="s_last"]`, "Sample");
    await s.page.fill(`${P} [name="s_line1"]`, "1 Sample St"); await s.page.fill(`${P} [name="s_city"]`, "Austin");
    await s.page.selectOption(`${P} [name="s_state"]`, "TX"); await s.page.fill(`${P} [name="s_zip"]`, "78701");
    await s.page.fill(`${P} [name="c_number"]`, "4111111111111111"); await s.page.fill(`${P} [name="c_exp"]`, "07/31"); await s.page.fill(`${P} [name="c_cvv"]`, "123");
    await s.page.click("#p-save");
    await s.page.waitForFunction(() => /Choose a login or add one\./.test((document.querySelector('#layers [data-field="l_costco"] .err') || {}).textContent || ""));
    assert.equal(await s.prof("Costco One"), null, "not saved");
    await s.page.selectOption(`${P} select[name="l_costco"]`, "lc1");
    await s.page.click("#p-save");
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    const p = await s.prof("Costco One");
    assert.deepEqual(p.stores, [{ store: "costco", storeName: "", mode: "login", loginId: "lc1", email: "", verified: false }]);
    assert.equal(p.email, "sam.costco@example.com", "the profile's email is its store login's");
    assert.deepEqual(await s.ev((id) => window.__t.profileProblems(window.__t.S.profiles.find((x) => x.id === id)), p.id), []);
    assert.equal(await s.page.$eval(`#main .slip[data-pmenu="${p.id}"] .p-status`, (e) => e.textContent.trim()), "Ready to submit");
  });

  await test("a Costco profile with no store login: its pill says Needs a login, as Target's does", async () => {
    await addProfiles(s, [{ id: "pn", name: "Costco Waits", email: "waits@example.com", stores: [entry("costco", "login")] },
      { id: "pt", name: "Target Waits", email: "waits@example.com", stores: [entry("target", "login")] }]);
    for (const id of ["pn", "pt"]) {
      assert.equal(await s.page.$eval(`#main .slip[data-pmenu="${id}"] .p-status`, (e) => e.textContent.trim()), "Needs a login");
    }
    const w = await s.ev(() => { const { S, profileProblems, profileIssueWords } = window.__t; const pr = profileProblems(S.profiles.find((x) => x.id === "pn")); return { pr, w: profileIssueWords(pr) }; });
    assert.deepEqual(w.pr, [["Costco", "no store login linked"]]);
    assert.equal(w.w.label, "Needs a login");
    // Opening it in the editor shows the login picker, never a way to ask for an assigned account.
    await s.page.click('#main .slip[data-pmenu="pn"] .slip-name');
    await s.page.waitForSelector(`${P} .ret-cfg[data-key="costco"]`);
    assert.equal(await s.page.locator(`${P} select[name="m_costco"]`).count(), 0);
    assert.equal(await s.page.$eval(`${P} select[name="l_costco"]`, (e) => e.value), "");
    await s.ev(() => window.__t.closeAllLayers());
  });

  await test("a saved vault with Costco on Use Assigned Account or an email (an older device's editor): Store login once it's opened", async () => {
    await addProfiles(s, [
      { id: "ps", name: "Costco Seller", stores: [entry("costco", "seller")] },
      { id: "pe", name: "Costco Email", email: "sam@example.com", stores: [entry("costco", "email", { email: "sam@example.com", verified: true })] },
      { id: "tk", name: "Target Seller", stores: [entry("target", "seller")] },
      { id: "pk", name: "PC Email", email: "pc@example.com", stores: [entry("pokemoncenter", "email", { email: "pc@example.com" })] },
    ]);
    await s.relock();
    const st = (id) => s.ev((id) => JSON.parse(JSON.stringify(window.__t.S.profiles.find((x) => x.id === id).stores)), id);
    assert.deepEqual(await st("ps"), [entry("costco", "login")]);
    assert.deepEqual(await st("pe"), [entry("costco", "login")]);
    assert.deepEqual((await st("tk")).map((e) => e.mode), ["seller"], "Target keeps Use Assigned Account");
    assert.deepEqual((await st("pk")).map((e) => [e.mode, e.email]), [["email", "pc@example.com"]], "Pokémon Center keeps its email");
    await s.profiles();
    assert.equal(await s.page.$eval('#main .slip[data-pmenu="pe"] .p-status', (e) => e.textContent.trim()), "Needs a login");
    // On Use Assigned Account it had no email: it gets its login's once one is linked.
    assert.deepEqual(await s.ev(() => window.__t.profileProblems(window.__t.S.profiles.find((x) => x.id === "ps"))), [["Email", "missing"], ["Costco", "no store login linked"]]);
  });

  await test("Import profiles (a FAFO export) with Costco on Use Assigned Account or an email: Store login, the one with a saved login's email linked", async () => {
    const one = (name, mode, email) => ({ name, email, phone: "5125550100", shipping: { firstName: "Sam", lastName: "Sample", address1: "9 Import St", city: "Austin", state: "TX", zip: "78701", country: "US" },
      billingSameAsShipping: true, card: { holder: "Sam Sample", number: "4111111111111111", expMonth: "07", expYear: "2031", cvv: "123" }, retailers: [{ store: "Costco", storeId: "costco", mode, email: mode === "email" ? email : "", verified: false }] });
    const text = JSON.stringify([one("Imported Seller", "seller", "sam.costco@example.com"), one("Imported Email", "email", "other@example.com"), one("Imported Login", "login", "none@example.com")]);
    await s.page.click('#main [data-act="import"] >> nth=0');
    await s.page.click(`${P} #im-ptog`);
    // One that names no store first: the summary asks for one, or more than one (three stores now, never "both").
    await s.page.fill(`${P} #im-text`, JSON.stringify([Object.assign(one("Imported Bare", "login", "bare@example.com"), { retailers: [] })]));
    await s.page.waitForFunction(() => /name a store/.test((document.querySelector("#im-sum") || {}).textContent || ""));
    assert.match(await s.text(`${P} #im-sum`), /It doesn't name a store\. Pick one above, or more than one to make one profile for each store\./);
    await s.page.fill(`${P} #im-text`, text);
    await s.page.waitForFunction(() => /Import 3 profiles/.test((document.querySelector("#im-go") || {}).textContent || "") && !document.querySelector("#im-go").disabled);
    assert.match(await s.text(P), /Pick a store for profiles that don't name one, or more than one to make one profile for each store/);
    assert.doesNotMatch(await s.text(P), /or both/, "three stores now");
    assert.doesNotMatch(await s.text(`${P} #im-sum`), /assign an account/, "nothing asks for an assigned account");
    await s.page.click("#im-go");
    await s.page.waitForFunction(() => window.__t.S.profiles.some((p) => p.name === "Imported Login"));
    const seller = await s.prof("Imported Seller"), email = await s.prof("Imported Email"), login = await s.prof("Imported Login");
    assert.deepEqual(seller.stores, [entry("costco", "login", { loginId: "lc1" })], "linked to the saved Costco login with its email");
    assert.deepEqual(email.stores, [entry("costco", "login")]);
    assert.deepEqual(login.stores, [entry("costco", "login")]);
    await s.ev(() => window.__t.closeAllLayers());
  });

  await test("Duplicate for Costco: the menu has it after Target and Pokémon Center; from a profile on Use Assigned Account it's on Store login", async () => {
    await s.profiles();
    await s.page.click('#main .slip[data-pmenu="tk"] [data-act="dup-profile"]');
    await s.page.waitForSelector(".menu");
    // Each item's words (after its store's mark: the Costco one's is the C tile).
    assert.deepEqual(await s.page.$$eval(".menu [role=menuitem]", (els) => els.map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim())),
      ["Duplicate for Target", "Duplicate for Pokémon Center", "Duplicate for Costco"]);
    assert.equal(await s.page.$eval('.menu [role=menuitem]:has-text("Duplicate for Costco") .smark', (e) => e.textContent), "C");
    await s.page.click('.menu [role=menuitem]:has-text("Duplicate for Costco")');
    await s.page.waitForFunction(() => window.__t.S.profiles.filter((p) => p.name === "Target Seller").length === 2);
    const c = await s.prof("Target Seller", "costco");
    assert.deepEqual(c.stores, [entry("costco", "login")], "waiting for a login");
    assert.equal(c.email, "");
    // No email on Use Assigned Account, so none yet: its login's comes with it (as for Target, the pill names the first problem).
    assert.deepEqual(await s.ev((id) => window.__t.profileProblems(window.__t.S.profiles.find((x) => x.id === id)), c.id), [["Email", "missing"], ["Costco", "no store login linked"]]);
    // A profile on a store login whose email is a saved Costco login's: Duplicate for Costco links it.
    await addProfiles(s, [{ id: "tl", name: "Target Login", email: "sam.costco@example.com", stores: [entry("target", "login")] }]);
    await s.page.click('#main .slip[data-pmenu="tl"] [data-act="dup-profile"]');
    await s.page.click('.menu [role=menuitem]:has-text("Duplicate for Costco")');
    await s.page.waitForFunction(() => window.__t.S.profiles.some((p) => p.name === "Target Login" && p.stores[0].store === "costco"));
    const tl = await s.prof("Target Login", "costco");
    assert.deepEqual(tl.stores, [entry("costco", "login", { loginId: "lc1" })]);
    assert.equal(await s.page.$eval(`#main .slip[data-pmenu="${tl.id}"] .p-status`, (e) => e.textContent.trim()), "Ready to submit");
  });

  await test("Paste: a Costco profile's copy is on Store login with its login (and one left on Use Assigned Account in memory comes out on Store login)", async () => {
    const one = await s.prof("Costco One");
    // As an older device's sync could leave it before this one's next unlock: the store entry itself on Use Assigned Account.
    await addProfiles(s, [{ id: "px", name: "Costco Stale", stores: [entry("costco", "seller")] }]);
    await s.ev(([a]) => window.__t.copyProfiles([a, "px"]), [one.id]);
    await s.ev(() => window.__t.openPasteProfiles("none"));
    await s.page.waitForSelector("#pp-go:not([disabled])");
    await s.page.click("#pp-go");
    await s.page.waitForFunction(() => window.__t.S.profiles.some((p) => p.name === "Costco One copy"));
    const c1 = await s.prof("Costco One copy"), c2 = await s.prof("Costco Stale copy");
    assert.deepEqual(c1.stores, [entry("costco", "login", { loginId: "lc1" })]);
    assert.equal(c1.email, "sam.costco@example.com");
    assert.deepEqual(c2.stores, [entry("costco", "login")]);
  });

  await test("Mass edit to Costco: no \"Checks out with\" (a line says why), and Use Assigned Account picked before never applies", async () => {
    await addProfiles(s, [
      { id: "m1", name: "Mass One", stores: [entry("target", "seller")] },
      { id: "m2", name: "Mass Two", email: "sam.costco@example.com", stores: [entry("target", "login")] },
      { id: "m3", name: "Mass Three", email: "m3@example.com", stores: [entry("pokemoncenter", "email", { email: "m3@example.com" })] },
    ]);
    await s.profiles();
    for (const id of ["m1", "m2", "m3"]) await s.page.click(`#main .slip[data-pmenu="${id}"] input[data-act="sel"]`);
    await s.page.click('[data-act="bulk-massedit"]');
    await s.page.waitForSelector(`${P} #pm-form`);
    assert.deepEqual(await s.page.$$eval(`${P} #pm-store .spick`, (els) => els.map((e) => e.dataset.pick)), ["pokemoncenter", "target", "costco"]);
    await s.page.selectOption(`${P} #pm-way`, "seller");
    await s.page.click(`${P} #pm-store .spick[data-pick="costco"]`);
    assert.ok(!(await s.page.locator(`${P} #pm-way-row`).isVisible()), "no choice for Costco");
    assert.equal(await s.text(`${P} #pm-way-own`), "Costco checks out on a store login only: each profile's own account, never Use Assigned Account.");
    const sum = await s.text(`${P} #pm-sum`);
    assert.match(sum, /Moves 3 profiles to Costco, keeping their name/);
    assert.doesNotMatch(sum, /Use Assigned Account|\(assigned\)/);
    assert.match(sum, /2 profiles will wait for a store login/);
    // Back on Target, the choice is there again.
    await s.page.click(`${P} #pm-store .spick[data-pick="target"]`);
    assert.ok(await s.page.locator(`${P} #pm-way-row`).isVisible());
    assert.ok(!(await s.page.locator(`${P} #pm-way-own`).isVisible()));
    await s.page.click(`${P} #pm-store .spick[data-pick="costco"]`);
    await s.page.click("#pm-go");
    await s.page.waitForFunction(() => !document.querySelector("#layers .panel"));
    assert.deepEqual((await s.prof("Mass One")).stores, [entry("costco", "login")]);
    assert.deepEqual((await s.prof("Mass Two")).stores, [entry("costco", "login", { loginId: "lc1" })], "linked by its email");
    assert.deepEqual((await s.prof("Mass Three")).stores, [entry("costco", "login")]);
    // pmPlan itself, asked for Use Assigned Account at Costco, both moving there and on it already.
    const ways = await s.ev(() => {
      const { S, pmPlan } = window.__t, r = (ids) => pmPlan(ids, { set: {}, modes: new Set(), store: "costco", way: "seller", stores: true, billTo: {} }, new Map());
      const a = r(["tk"]), b = r([S.profiles.find((p) => p.name === "Target Seller" && p.stores[0].store === "costco").id]);
      return [a.rows.map((x) => x.after.stores.map((e) => e.mode)), b.rows.map((x) => x.after.stores.map((e) => e.mode)), a.lines.concat(b.lines).join(" ")];
    });
    assert.deepEqual(ways.slice(0, 2), [[["login"]], [["login"]]]);
    assert.doesNotMatch(ways[2], /Assigned/);
  });

  await test("Generate's Import onto Costco: Store login, linked by email as for Target, never Use Assigned Account; the window says how Costco checks out", async () => {
    await s.ev(() => {
      const { S, persist } = window.__t, d = (n, email) => ({ id: "gd" + n, n, name: "Gen Costco #" + n, group: "", first: "Sam", last: "Sample", line1: n + " Draft St", line2: "",
        city: "Austin", state: "TX", zip: "78701", email, phone: "512555010" + n });
      S.settings.genDrafts = { gd1: d(1, "sam.costco@example.com"), gd2: d(2, "nobody.costco@example.com") };
      persist();
    });
    await s.ev(() => window.__t.openDraftImport(["gd1", "gd2"]));
    await s.page.waitForSelector(`${P} #di-pills`);
    assert.deepEqual(await s.page.$$eval(`${P} #di-pills .spick`, (els) => els.map((e) => e.dataset.pick)), ["pokemoncenter", "target", "costco"]);
    assert.equal(await s.text(`${P} .pe-sec .item-sub`), "Pick a store, or more than one to make one profile for each store (with the same name, so they stay paired). Pokémon Center checks out with each profile's email; Target and Costco use your store login with the same email.");
    await s.page.click(`${P} #di-pills .spick[data-pick="costco"]`);
    const sum = await s.text(`${P} #di-sum`);
    assert.match(sum, /Ready to import 2 profiles/);
    assert.match(sum, /On Costco/);
    assert.match(sum, /1 profile will be linked to your store logins with the same email/);
    assert.match(sum, /1 profile has no store login with its email yet/);
    assert.doesNotMatch(sum, /assigned/i);
    await s.page.click("#di-go");
    await s.page.waitForFunction(() => window.__t.S.profiles.some((p) => p.name === "Gen Costco #2"));
    const g1 = await s.prof("Gen Costco #1"), g2 = await s.prof("Gen Costco #2");
    assert.deepEqual(g1.stores, [entry("costco", "login", { loginId: "lc1" })], "linked to the saved Costco login with its email");
    assert.deepEqual(g2.stores, [entry("costco", "login")], "waiting for a login");
    assert.deepEqual([g1.email, g2.email], ["sam.costco@example.com", "nobody.costco@example.com"]);
    assert.deepEqual(await s.ev(() => window.__t.S.settings.genDrafts || null), null, "the drafts went in");
  });

  await test("Profiles' counts strip: Costco's dot is violet, not Target's red or Pokémon Center's blue", async () => {
    await s.profiles();
    const dots = await s.page.$$eval("#main .p-kpis .p-kpi", (els) => Object.fromEntries(els.map((e) => [e.textContent.replace(/\s*\d+$/, "").trim(), e.querySelector(".p-kpi-dot").style.background])));
    assert.equal(dots.Costco, "var(--violet)");
    assert.equal(dots.Target, "var(--danger)");
    assert.equal(dots["Pokémon Center"], "var(--info)");
  });

  await test("the share image draws a Costco item (its C tile) without errors; the mark is never a logo", async () => {
    const size = await s.ev(async () => {
      const d = { r: { label: "Today", range: "" }, stuck: 1, cxl: 0, orders: 1, qty: 2, total: 20, stores: [["Costco", 1]],
        items: [{ name: "Sample Booster Bundle", store: "Costco", o: { store: "costco", storeName: "" }, image: "", qty: 2, orders: 1 }] };
      const b = await window.__t.drawSuccess(d);
      return b ? b.size : 0;
    });
    assert.ok(size > 1000, "a picture: " + size);
    assert.match(await s.ev(() => window.__t.storeMark({ store: "costco", storeName: "" })), /^<span class="smark " style="background:#005DAA;color:#fff" aria-hidden="true">C<\/span>$/);
  });

  await test("Send accounts (accounts to assign) never offers Costco", async () => {
    await s.ev(() => window.__t.openAssignAccounts());
    await s.page.waitForSelector(`${P} #aa-pills`);
    assert.deepEqual(await s.page.$$eval(`${P} #aa-pills .spick`, (els) => els.map((e) => e.dataset.pick)), ["pokemoncenter", "target"]);
    await s.ev(() => window.__t.closeAllLayers());
  });

  await test("the setup guide: Costco is always the buyer's own account, and Use Assigned Account is for Target and Pokémon Center", async () => {
    await s.page.click('#main .view-tools [data-act="guide-open"]');
    await s.page.waitForSelector("#guide.guide-open");
    await s.page.click('#guide .guide-row[data-id="make"]');
    const t = await s.text('#guide .guide-step[data-step="make"] .guide-body');
    assert.match(t, /Pick Target, Pokémon Center or Costco, then fill in/);
    assert.match(t, /How it checks out: pick one under "How this store checks out"\. Costco is always your own account\./);
    assert.match(t, /Use Assigned Account \(easiest; Target and Pokémon Center only\): your seller gives you the account\./);
    assert.match(t, /Your own account \(Target or Costco: Store login; Pokémon Center: Own email\): your seller needs/);
    await s.page.click('#guide [data-act="guide-close"]');
    await s.page.waitForSelector("#guide", { state: "hidden" });
  });

  await test("Submit: a Costco slot goes as Costco's own AYCD list, slots CSV (no assigned rows) and logins, also one left on Use Assigned Account; Target's assigned slot as before", async () => {
    await s.ev((lic) => { const T = window.__t; T.keepTypedLic(lic); T.persist(); T.render(); }, LIC);
    // "Costco Stale Sub": Costco on Use Assigned Account in memory, as an older device's sync could leave it before this
    // one's next unlock (fixMode hasn't run on it). asksSeller is never true at Costco, so it goes as a slot without a login.
    await addProfiles(s, [{ id: "st", name: "Submit Target", stores: [entry("target", "seller")] }, { id: "pss", name: "Costco Stale Sub", stores: [entry("costco", "seller")] }]);
    assert.deepEqual(await s.ev(() => { const { S, asksSeller } = window.__t; return ["pss", "st"].map((id) => asksSeller(S.profiles.find((p) => p.id === id).stores[0])); }), [false, true]);
    const one = await s.prof("Costco One");
    await s.page.click('#side [data-id="submit"]');
    for (const id of [one.id, "pss", "st"]) {
      await s.page.click(`#main [data-act="slot"][data-id="${id}"] + .sw-track`);
      await s.page.waitForFunction((id) => window.__t.S.slots.some((k) => k.startsWith(id + "@")), id);
    }
    assert.match(await s.text("#main"), /Costco/);
    const card = await s.page.$eval('#main .sub-slot:has([data-act="slot"][data-id="pss"])', (e) => e.innerText);
    assert.match(card, /No login/); assert.doesNotMatch(card, /Assigned account/);
    await s.page.click('#main [data-act="submit-slots"]');
    await s.page.fill("#ss-from", "Sam Sample");
    assert.match(await s.text(`${P} .note`), /^Costco: Costco One, Costco Stale Sub Target: Submit Target 1 slot uses an assigned account, so the seller provides the login\.$/);
    // Costco One's login has no inbox saved (that's what it lacks); Costco Stale Sub has no store login at all, which the
    // window says apart (the review of 1.9.148).
    assert.equal(await s.text("#ss-imap-miss"), "1 slot has no inbox app password saved in FAFO (Costco: Costco One), so your seller can't follow its orders: add it in Store logins.");
    assert.equal(await s.text("#ss-imap-nologin"), "1 slot has no store login linked (Costco: Costco Stale Sub), so your seller gets no login or inbox access for it: link its store login in Store logins.");
    await s.page.click("#ss-go");
    await s.page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
    await s.page.click("#layers [data-close]");
    assert.equal(W.subs.length, 1);
    const b = W.subs[0], costco = b.files.filter((f) => f.store === "Costco");
    assert.deepEqual(costco.map((f) => [f.kind, f.storeKey || "", f.assigned]), [["profiles", "costco", 0], ["aycd", "costco", undefined], ["logins", "", undefined]]);
    const rows = costco[0].text.split("\r\n");
    assert.equal(rows.length, 3);
    assert.match(rows[1], /^Costco One,Sam,Sample,sam\.costco@example\.com,5125550100,4111111111111111,07,2031,123,/);
    assert.match(rows[2], /^Costco Stale Sub,Sam,Sample,,5125550100,/, "after the slots with a login, with no account in its email");
    assert.equal(costco[2].text, "sam.costco@example.com:pw-lc1");
    assert.deepEqual(JSON.parse(costco[1].text).map((x) => [x.name, x.shippingAddress.email]), [["Costco One", "sam.costco@example.com"], ["Costco Stale Sub", ""]]);
    const target = b.files.filter((f) => f.store === "Target");
    assert.deepEqual(target.map((f) => [f.kind, f.assigned]), [["profiles", 1], ["aycd", undefined]], "Target's slot on Use Assigned Account, no logins file");
    assert.deepEqual(b.stores, [{ name: "Costco", n: 2 }, { name: "Target", n: 1, seller: 1 }]);
    assert.deepEqual(Object.keys(b.active), ["target"], "accounts are asked for Target only");
    const subs = await s.ev(() => JSON.parse(JSON.stringify(window.__t.S.subs)));
    assert.equal(subs[one.id + "@costco"].acct, "sam.costco@example.com");
    assert.equal(subs["pss@costco"].acct, undefined, "never \"Assigned account\"");
    assert.equal(subs["st@target"].acct, "Assigned account");
  });

  await test("Submit: a slot waiting for its store login says it has none linked, never that its inbox is missing; linked, its inbox goes with it", async () => {
    // The review of 1.9.148: Costco profiles often wait for a login (fixMode, Duplicate for Costco, Mass edit, Generate's
    // Import, when no Costco login has their email), and the window told the buyer to add an inbox that was saved already.
    // "Target Gone" is linked to a login that's gone; "Target No Pw" has an inbox without its app password (a real miss).
    await s.ev(() => {
      const { S, persist, render } = window.__t;
      S.inboxes.push({ id: "ibw", email: "wait.sample@example.com", password: "Sample-Wait-Pw", provider: "custom", host: "imap.example.com", port: "993" },
        { id: "ibn", email: "nopw.sample@example.com", password: "", provider: "custom", host: "imap.example.com", port: "993" });
      S.logins.push({ id: "ltn", store: "target", storeName: "", label: "", email: "nopw.sample@example.com", password: "pw-ltn", inboxId: "ibn" });
      persist(); render();
    });
    await addProfiles(s, [{ id: "pcw", name: "Costco Waits", email: "wait.sample@example.com", stores: [entry("costco", "login")] },
      { id: "ptg", name: "Target Gone", stores: [entry("target", "login", { loginId: "lgone" })] },
      { id: "ptn", name: "Target No Pw", stores: [entry("target", "login", { loginId: "ltn" })] }]);
    const open = async (ids) => {
      await s.page.click('#side [data-id="submit"]');
      for (const id of ids) {
        await s.page.click(`#main [data-act="slot"][data-id="${id}"] + .sw-track`);
        await s.page.waitForFunction((id) => window.__t.S.slots.some((k) => k.startsWith(id + "@")), id);
      }
      await s.page.click('#main [data-act="submit-slots"]');
      await s.page.fill("#ss-from", "Sam Sample");
      const t = async (sel) => await s.page.$(sel) ? s.text(sel) : "";
      return { ok: await t("#ss-imap"), miss: await t("#ss-imap-miss"), nologin: await t("#ss-imap-nologin") };
    };
    const send = async () => {
      const n = W.subs.length;
      await s.page.click("#ss-go");
      await s.page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
      await s.page.click("#layers [data-close]");
      await s.page.waitForFunction(() => !document.querySelector("#ss-go"));
      assert.equal(W.subs.length, n + 1);
      return W.subs.at(-1);
    };
    assert.deepEqual(await open(["pcw", "ptg", "ptn"]), { ok: "",
      miss: "1 slot has no inbox app password saved in FAFO (Target: Target No Pw), so your seller can't follow its orders: add it in Store logins.",
      nologin: "2 slots have no store login linked (Costco: Costco Waits; Target: Target Gone), so your seller gets no login or inbox access for them: link their store logins in Store logins." });
    let b = await send();
    assert.deepEqual(b.files.filter((f) => f.kind === "imap"), [], "no inbox access without a login");
    // Its Costco login added and linked (no inbox linked on it: the one saved for its email's mailbox), and sent again.
    await addLogins(s, [costcoLogin("lcw", "wait.sample@example.com")]);
    await s.ev(() => { const { S, persist, render } = window.__t; S.profiles.find((p) => p.id === "pcw").stores[0].loginId = "lcw"; delete S.subs["pcw@costco"]; persist(); render(); });
    assert.deepEqual(await open([]), { ok: "Your inbox access for this slot (each inbox's email and app password) goes to your seller with it, so they can follow your orders.", miss: "", nologin: "" });
    b = await send();
    assert.deepEqual(b.files.filter((f) => f.kind === "imap").map((f) => [f.storeKey, f.text]), [["costco", "wait.sample@example.com:Sample-Wait-Pw"]]);
  });
  await s.close();

  // ---- B: an online copy merged into this vault (Open my synced vault) ----
  s = await session("B");
  await test("an online copy with Costco on Use Assigned Account or an email, merged in (syncMergeIn): Store login", async () => {
    await addProfiles(s, [{ id: "here", name: "Here", stores: [entry("target", "seller")] }]);
    const st = await s.ev((LIC) => {
      const T = window.__t, remote = JSON.parse(JSON.stringify(T.S));
      delete remote._local;
      remote.addresses.push({ id: "ar1", first: "Sam", last: "Sample", line1: "5 Remote St", line2: "", city: "Austin", state: "TX", zip: "78701", country: "US" },
        { id: "ar2", first: "Sam", last: "Sample", line1: "6 Remote St", line2: "", city: "Austin", state: "TX", zip: "78701", country: "US" });
      const base = { billSame: true, cardId: "c1", phone: "5125550100", groupId: null, createdAt: 2, updatedAt: 2 };
      remote.profiles.push(Object.assign({ id: "r1", name: "Remote Seller", email: "", shipId: "ar1", stores: [{ store: "costco", storeName: "", mode: "seller", loginId: null, email: "", verified: false }] }, base),
        Object.assign({ id: "r2", name: "Remote Email", email: "r2@example.com", shipId: "ar2", stores: [{ store: "costco", storeName: "", mode: "email", loginId: null, email: "r2@example.com", verified: true }] }, base));
      T.syncMergeIn(LIC, { salt: T.VAULT.salt, iter: T.VAULT.iter }, { key: T.KEY, auth: null, got: { data: { created: "vault-sample", rev: 1, device: "", updatedAt: 0 } }, p: { state: remote, mt: {}, seq: 1 } });
      return Object.fromEntries(T.S.profiles.map((p) => [p.id, JSON.parse(JSON.stringify(p.stores))]));
    }, LIC);
    assert.deepEqual(st.r1, [entry("costco", "login")]);
    assert.deepEqual(st.r2, [entry("costco", "login")]);
    assert.deepEqual(st.here.map((e) => e.mode), ["seller"], "Target as it was");
  });
  await s.close();

  assert.deepEqual(errors, [], "no errors on the page");
  console.log(`\n${passed} passed`);
} finally {
  await browser.close();
}
