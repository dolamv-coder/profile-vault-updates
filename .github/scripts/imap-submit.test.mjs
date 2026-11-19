// Tests the inbox access Submit sends in the newest page (index-X.Y.Z.html), from 1.9.147 (the owner's request, 2026-11-13:
// "What method can buyer input their imap so it can be sent to my private discord?", then "during submission only",
// "email - apppassword format" and "same where all the slots go"). The real page runs in Chromium (Playwright), as the web
// version at app.fafoaco.com, against a pretend license worker, as interests.test.mjs and walkthrough.test.mjs run it: a vault
// made with Use this browser only, with a license key kept as Submit keeps one typed there. It checks the files /submissions
// gets (an "imap" file per store with slots on the buyer's own accounts: one email:app password line per inbox, in the order
// the store's slots go out, once per inbox and per mailbox, none for Use Assigned Account, a Pokémon Center own email's inbox
// found by its mailbox, a login with no inbox linked, or linked to one that's gone, by its email's mailbox (until 1.9.158: from
// then on these Target logins send none, as a Target login's inbox is optional; target-inbox.test.mjs has them at Costco), an inbox with no
// app password left out, an address without its +tag, and app passwords the worker wouldn't take on one line left out, as
// the pretend worker refuses a batch the license worker would), what Submit's window says (with and without slots it can't
// send one for, and what to do about a checkout email that forwards elsewhere), a batch of only Use Assigned Account slots
// (no file, no line), a recipient set by hand (the sealed code: no line), the seller's own FAFO (no file, no line, and
// nothing says the seller gets one), and what Store logins, IMAP (until 1.9.156) and Settings say. At Costco (1.9.148+, whose
// slots check out only on a store login) the inbox access went in its own imap file until 1.9.158; from 1.9.159 (the owner,
// 2026-11-19: "change costco-logins to email:::password:::imapemail:::apppassword format") each line of Costco's logins
// file carries its login's inbox (fmt "imap4": email:::password:::imap email:::app password, one per slot in the slots'
// order, the last two empty with none), and Costco sends no imap file, while Target's and Pokémon Center's files are as
// before; the sealed code a recipient set by hand gets is unchanged, and the seller's own FAFO sends empty inbox fields.
// Sample names, addresses, app passwords and keys only.
//   node .github/scripts/imap-submit.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must send it (kind:"imap"); a page named on the command line that doesn't is skipped.
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
if (!/kind:"imap"/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} sends no inbox access with Submit (kind:"imap"): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no inbox access with Submit, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, slotKey, refreshPremium, isPremiumOwner, emailSectionHTML, openSubmission};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };

// ---- The pretend license worker ----
const LIC = "PVLT-TEST-TEST-TEST-TEST";
const W = { subs: [], refused: [], owner: false };
const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
async function worker(route, req, u) {
  const m = req.method(), p = u.pathname, auth = req.headers().authorization || "";
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: Object.assign({ "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "authorization, content-type" }, CORS) });
  if (p === "/discord/ready") return json(route, 200, { ok: true });
  if (auth !== "Bearer " + LIC) return json(route, 401, { error: "license not recognized" });
  if (p === "/submissions" && m === "POST") {
    const body = JSON.parse(req.postData());
    // As the license worker checks a batch's inbox access (imapOk): one file per store with profiles, each line email:password
    // on one line (an address at most 254 characters, a password at most 200), no more lines than the store's slots.
    const files = body.files || [], rows = (f) => f.text.split("\r\n").length - 1;
    const bad = files.filter((f) => f.kind === "imap").some((f) => {
      const p = files.filter((x) => x.kind === "profiles" && x.store === f.store && x.storeKey === f.storeKey);
      const lines = f.text.replace(/(\r?\n)+$/, "").split(/\r?\n/);
      return p.length !== 1 || files.filter((x) => x.kind === "imap" && x.storeKey === f.storeKey).length > 1 || lines.length > rows(p[0])
        || !lines.every((x) => { const m = WORKER_LINE.exec(x); return !!m && m[1].length <= 254 && m[2].length <= 200; });
    });
    // A logins file with its inboxes on its lines (1.9.159, fmt "imap4"): only Costco's, each line four fields.
    const four = files.filter((f) => f.kind === "logins" && f.fmt !== undefined).some((f) => f.fmt !== "imap4"
      || !files.some((x) => x.kind === "profiles" && x.store === f.store && (x.storeKey === "costco" || x.storeKey === "other:costco"))
      || !f.text.split("\r\n").every((x) => x.split(":::").length === 4));
    if (bad || four) { W.refused.push(body); return json(route, 400, { error: "files" }); }
    W.subs.push(body); return json(route, 200, { ok: true, id: "batch" + W.subs.length, review: "pending" });
  }
  if (p === "/submissions/status") return json(route, 200, { batches: {} });
  if (p === "/billing") return json(route, 200, { on: false });
  if (p === "/premium") return json(route, 200, { premium: W.owner, owner: W.owner });
  if (p === "/interests") return json(route, 200, { rev: 1, owner: false, items: [] });
  if (p === "/slots/limit") return json(route, 200, { limit: 50, request: null, canRequest: true });
  return json(route, 404, {});
}
// A line as the license worker takes it (imapLineOk): an email-shaped address, a colon, a password that isn't only spaces.
const WORKER_LINE = /^([^\s@:]+@[^\s@:]+\.[^\s@:]+):(.*\S.*)$/;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/*", async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
  if (u.origin === "https://license.fafoaco.com" || u.origin === "https://orbit-license.orbit-app.workers.dev") return worker(route, req, u);
  return route.fulfill({ status: 404, body: "" });
});
// The setup guide (1.9.145) doesn't ask here (Not now, until far ahead): its own test is walkthrough.test.mjs.
await ctx.addInitScript(() => { try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const focused = (id) => page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id);
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
// Switches on exactly these slots ([profile id, store key]), opens Submit's window and gives back what it says about inboxes.
async function openSubmit(slots) {
  await ev((slots) => { const T = window.__t; T.S.slots = slots.map(([p, k]) => T.slotKey(p, k)); T.persist(); T.render(); }, slots);
  await page.click('#side [data-id="submit"]');
  await page.click('#main [data-act="submit-slots"]');
  await page.waitForSelector("#ss-go");
  return {
    ok: await page.$("#ss-imap") ? await text("#ss-imap") : "",
    miss: await page.$("#ss-imap-miss") ? await text("#ss-imap-miss") : "",
  };
}
// Sends the window's batch, then closes it, and gives back what /submissions got.
async function send() {
  const n = W.subs.length;
  await page.fill("#ss-from", "Sam");
  const [res] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === "/submissions" && r.request().method() === "POST"), page.click("#ss-go")]);
  assert.equal(res.status(), 200, "the license worker would take it: " + await res.text());
  await page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
  await page.click("#layers [data-close]");
  await page.waitForFunction(() => !document.querySelector("#ss-go"));
  assert.equal(W.subs.length, n + 1);
  return W.subs.at(-1);
}
const imapOf = (body) => body.files.filter((f) => f.kind === "imap");
// From 1.9.158 a Target store login's inbox is optional (the owner: "Technically, imap is not needed for Target"), so Submit's
// window never warns about a Target slot with no inbox, or one without its app password, and a Target login with none linked
// (or linked to one that's gone) sends none, never the inbox saved for its mailbox (the review of 1.9.158): it may have been
// saved with none on purpose. target-inbox.test.mjs has that fallback at Costco, whose logins need an inbox. Before, it did.
const OPT = /const inboxOptional = /.test(HTML);
// Costco (1.9.148+), and from 1.9.159 its inbox on its logins' lines (fmt "imap4") with no imap file of its own.
const COSTCO = /const PICK_STORES = \[[^\]]*"costco"/.test(HTML);
const FOUR = /fmt:"imap4"/.test(HTML);
const filesOf = (body, store) => body.files.filter((f) => f.store === store);
// Costco's slots C1 to C6, in the order they go out: C1's login has its own inbox, C2's is a +tag of it linked to the same
// inbox (each slot gets its line, the inbox's twice), C3's inbox is another address (a Gmail app password saved with spaces),
// C4's inbox has no app password, C5's inbox was saved with a +tag (sent without), and C6 waits for its store login (no line).
const C_SLOTS = ["c1", "c2", "c3", "c4", "c5", "c6"].map((p) => [p, "costco"]);
const C_LOGINS = FOUR
  ? ["costco.one@example.com:::Store-C-1:::costco.one@example.com:::Costco-Pw-A", "costco.one+c2@example.com:::Store-C-2:::costco.one@example.com:::Costco-Pw-A",
    "buyer.costco@example.com:::Store:C-3:::sam.sample@gmail.com:::abcdefghijklmnop", "nopw.costco@example.com:::Store-C-4::::::",
    "tag.sample+c5@example.com:::Store-C-5:::tag.sample@example.com:::Sample-Tag-Pw-6"].join("\r\n")
  : ["costco.one@example.com:Store-C-1", "costco.one+c2@example.com:Store-C-2", "buyer.costco@example.com:Store:C-3", "nopw.costco@example.com:Store-C-4",
    "tag.sample+c5@example.com:Store-C-5"].join("\r\n");
const ownerIs = async (on) => {
  W.owner = on;
  await ev(() => window.__t.refreshPremium(true));
  await page.waitForFunction((on) => window.__t.isPremiumOwner() === on, on);
};

console.log(`Inbox access with Submit in ${file.split(/[\\/]/).pop()}`);
try {
  await page.goto("https://app.fafoaco.com/");
  await page.click("#lock-local");
  await focused("pw1");
  await page.fill("#pw1", "sample-pass-147"); await page.fill("#pw2", "sample-pass-147"); await page.click("#lock-go");
  await page.waitForSelector('#side [data-id="orders"]', { timeout: 30000 });
  // The vault: a license key as Submit keeps one, inboxes, Target logins and profiles on both stores.
  await ev((lic) => {
    const T = window.__t, S = T.S;
    T.keepTypedLic(lic);
    S.inboxes.push(
      // A Gmail app password saved with its spaces (as a vault from before they were taken off may have it): sent without.
      { id: "ib1", email: "sam.sample@gmail.com", password: "abcd efgh ijkl mnop", provider: "gmail", host: "imap.gmail.com", port: "993" },
      { id: "ib2", email: "pc.sample@example.com", password: "Sample-Pc-Pw-2", provider: "custom", host: "imap.example.com", port: "993" },
      { id: "ib3", email: "nopw.sample@example.com", password: "", provider: "custom", host: "imap.example.com", port: "993" },
      // A second saved copy of ib1's mailbox (a Gmail dot version): one mailbox, so one line.
      { id: "ib4", email: "s.a.m.sample@gmail.com", password: "qrstuvwxyzabcdef", provider: "gmail", host: "imap.gmail.com", port: "993" },
      { id: "ib5", email: "solo.sample@example.com", password: "Sample-Solo-Pw-5", provider: "custom", host: "imap.example.com", port: "993" },
      // Saved with a +tag, as Add inbox keeps one: a mail server's username has none.
      { id: "ib6", email: "tag.sample+box@example.com", password: "Sample-Tag-Pw-6", provider: "custom", host: "imap.example.com", port: "993" },
      { id: "ib7", email: "fallback.sample@example.com", password: "Sample-Fb-Pw-7", provider: "custom", host: "imap.example.com", port: "993" },
      // App passwords the license worker wouldn't take on one line (it refuses the whole batch for one): a line break, and
      // over 200 characters. Never sent.
      { id: "ib8", email: "nl.sample@example.com", password: "Sample-Nl\nPw-8", provider: "custom", host: "imap.example.com", port: "993" },
      { id: "ib9", email: "long.sample@example.com", password: "L".repeat(201), provider: "custom", host: "imap.example.com", port: "993" });
    S.logins.push(
      { id: "l1", store: "target", email: "sam.sample+t1@gmail.com", password: "Store-Pw-1", inboxId: "ib1" },
      { id: "l2", store: "target", email: "sam.sample+t2@gmail.com", password: "Store-Pw-2", inboxId: "ib4" },
      { id: "l3", store: "target", email: "nopw.sample@example.com", password: "Store-Pw-3", inboxId: "ib3" },
      { id: "l4", store: "target", email: "lee.sample@example.com", password: "Store-Pw-4", inboxId: "" },
      // No inbox linked, but one is saved for its email's mailbox (its +tag never changes the mailbox).
      { id: "l5", store: "target", email: "pc.sample+tgt@example.com", password: "Store-Pw-5", inboxId: null },
      { id: "l6", store: "target", email: "solo.sample@example.com", password: "Store-Pw-6", inboxId: "ib5" },
      { id: "l7", store: "target", email: "tag.sample+t7@example.com", password: "Store-Pw-7", inboxId: "ib6" },
      // Linked to an inbox that's gone (an Undo after it was deleted, or two devices' edits): the one saved for its mailbox.
      { id: "l8", store: "target", email: "fallback.sample+t8@example.com", password: "Store-Pw-8", inboxId: "ib-deleted" },
      { id: "l9", store: "target", email: "nl.sample@example.com", password: "Store-Pw-9", inboxId: "ib8" },
      { id: "l10", store: "target", email: "long.sample@example.com", password: "Store-Pw-10", inboxId: "ib9" });
    S.cards.push({ id: "c1", nick: "Sample", number: "4111111111111111", expM: "7", expY: "31", cvv: "123", holder: "Sam Sample" });
    const add = (id, name, e) => {
      S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
      S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: "c1", phone: "5125550100", email: "", stores: [e] });
    };
    add("t1", "Sam T1", { store: "target", mode: "login", loginId: "l1" });
    add("t2", "Sam T2", { store: "target", mode: "login", loginId: "l2" });
    add("t3", "Sam T3", { store: "target", mode: "login", loginId: "l3" });
    add("t4", "Sam T4", { store: "target", mode: "login", loginId: "l4" });
    add("t5", "Sam T5", { store: "target", mode: "login", loginId: "l5" });
    add("t6", "Sam T6", { store: "target", mode: "seller" });
    add("t7", "Sam T7", { store: "target", mode: "seller" });
    add("t8", "Sam T8", { store: "target", mode: "login", loginId: "l6" });
    add("v1", "Sam V1", { store: "target", mode: "login", loginId: "l7" });
    add("v2", "Sam V2", { store: "target", mode: "login", loginId: "l8" });
    add("v3", "Sam V3", { store: "target", mode: "login", loginId: "l9" });
    add("v4", "Sam V4", { store: "target", mode: "login", loginId: "l10" });
    add("p1", "Sam P1", { store: "pokemoncenter", mode: "email", email: "pc.sample+pkc@example.com" });
    add("p2", "Sam P2", { store: "pokemoncenter", mode: "email", email: "pc.sample@example.com" });
    add("p3", "Sam P3", { store: "pokemoncenter", mode: "email", email: "nobody.sample@example.com" });
    add("p4", "Sam P4", { store: "pokemoncenter", mode: "seller" });
    add("p5", "Sam P5", { store: "pokemoncenter", mode: "seller" });
    S.caps = { target: 20, pokemoncenter: 20 };
    T.persist(); T.render();
  }, LIC);

  await test("Submit's window: how many slots bring their inbox access, and which can't (no inbox, or one without its app password)", async () => {
    const said = await openSubmit([["t1", "target"], ["t2", "target"], ["t3", "target"], ["t4", "target"], ["t5", "target"], ["t6", "target"],
      ["p1", "pokemoncenter"], ["p2", "pokemoncenter"], ["p3", "pokemoncenter"], ["p4", "pokemoncenter"]]);
    // Sam T5's login has no inbox linked: until 1.9.158 the one saved for its mailbox went with it.
    assert.equal(said.ok, `Your inbox access for ${OPT ? 4 : 5} of these slots (each inbox's email and app password) goes to your seller with them, so they can follow your orders.`);
    // Sam P3's checkout email may forward to another inbox (a Hide My Email alias, a catch-all domain), which nothing can
    // link it to: that one goes on Discord.
    assert.equal(said.miss, OPT ? "1 slot has no inbox app password saved in FAFO (Pokémon Center: Sam P3), so your seller can't follow its orders: add it in Store logins. If a checkout email forwards to another inbox, send your seller that inbox's email and app password on Discord yourself."
      : "3 slots have no inbox app password saved in FAFO (Pokémon Center: Sam P3; Target: Sam T3, Sam T4), so your seller can't follow those orders: add it in Store logins. If a checkout email forwards to another inbox, send your seller that inbox's email and app password on Discord yourself.");
    assert.ok(await page.$eval("#ss-imap-miss", (e) => e.classList.contains("note-warn")), "a warning, not a refusal");
    assert.equal(await page.$eval("#ss-go", (e) => e.disabled), false, "Submit isn't blocked by it");
  });
  await test("what /submissions gets: an imap file per store, after its logins (or its AYCD list), one line per inbox in the slots' order, never for Use Assigned Account", async () => {
    const body = await send();
    assert.deepEqual(body.files.map((f) => [f.kind, f.storeKey || ""]), [
      ["profiles", "pokemoncenter"], ["aycd", "pokemoncenter"], ["imap", "pokemoncenter"],
      ["profiles", "target"], ["aycd", "target"], ["logins", ""], ["imap", "target"]]);
    const [pc, tgt] = imapOf(body);
    assert.equal(pc.store, "Pokémon Center");
    assert.equal(tgt.store, "Target");
    // Target: Sam T1's inbox (its app password without the spaces), not Sam T2's (a copy of the same mailbox), none for Sam T3
    // (no app password) or Sam T4 (no inbox), Sam T5's found by its email's mailbox (until 1.9.158: none from then on); Sam T6
    // is on Use Assigned Account.
    assert.equal(tgt.text, OPT ? "sam.sample@gmail.com:abcdefghijklmnop" : "sam.sample@gmail.com:abcdefghijklmnop\r\npc.sample@example.com:Sample-Pc-Pw-2");
    // Pokémon Center: Sam P1's own email reaches pc.sample@example.com's mailbox (a +tag), Sam P2's is that inbox (once),
    // Sam P3's has none saved, and Sam P4 is on Use Assigned Account.
    assert.equal(pc.text, "pc.sample@example.com:Sample-Pc-Pw-2");
    for (const f of imapOf(body)) for (const line of f.text.split("\r\n")) assert.match(line, WORKER_LINE, "as the license worker takes it");
    const all = JSON.stringify(imapOf(body));
    for (const x of ["nopw.sample", "nobody.sample", "lee.sample", "qrstuvwxyzabcdef", "Store-Pw"]) assert.ok(!all.includes(x), "not in the inbox access: " + x);
    // The rest is as it was: the logins file has the store logins' own passwords, and the profiles CSV every slot.
    assert.equal(body.files.find((f) => f.kind === "logins").text.split("\r\n").length, 5);
    assert.equal(body.files.find((f) => f.kind === "profiles" && f.storeKey === "target").assigned, 1);
  });
  await test("a batch of only Use Assigned Account slots: no imap file, and the window says nothing of inboxes", async () => {
    const said = await openSubmit([["t7", "target"], ["p5", "pokemoncenter"]]);
    assert.deepEqual(said, { ok: "", miss: "" });
    assert.doesNotMatch(await text("#layers .panel"), /inbox access|app password/);
    const body = await send();
    assert.deepEqual(imapOf(body), []);
    assert.deepEqual(body.files.map((f) => f.kind), ["profiles", "aycd", "profiles", "aycd"]);
  });
  await test("one slot, its inbox saved: 'this slot', 'with it', and no warning", async () => {
    const said = await openSubmit([["t8", "target"]]);
    assert.deepEqual(said, { ok: "Your inbox access for this slot (each inbox's email and app password) goes to your seller with it, so they can follow your orders.", miss: "" });
    const body = await send();
    assert.deepEqual(imapOf(body).map((f) => f.text), ["solo.sample@example.com:Sample-Solo-Pw-5"]);
  });
  await test("slots on one store with none saved: only the warning, without the store's name, and no imap file", async () => {
    // Sent before: switched off and on again, as a new batch.
    await ev(() => { const T = window.__t; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; T.persist(); });
    const said = await openSubmit([["t3", "target"], ["t4", "target"]]);
    // At Target from 1.9.158 nothing to warn about (target-inbox.test.mjs has one store's warning without its name, at Costco).
    assert.deepEqual(said, { ok: "", miss: OPT ? "" : "2 slots have no inbox app password saved in FAFO (Sam T3, Sam T4), so your seller can't follow those orders: add it in Store logins." });
    const body = await send();
    assert.deepEqual(imapOf(body), []);
  });
  await test("an address without its +tag, a login linked to a deleted inbox by its mailbox, and app passwords the worker wouldn't take left out", async () => {
    await ev(() => { const T = window.__t; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; T.persist(); });
    const said = await openSubmit([["v1", "target"], ["v2", "target"], ["v3", "target"], ["v4", "target"]]);
    // Sam V2's login is linked to an inbox that's gone: from 1.9.158, at Target, none goes with it.
    assert.deepEqual(said, { ok: OPT ? "Your inbox access for 1 of these slots (each inbox's email and app password) goes to your seller with it, so they can follow your orders."
      : "Your inbox access for 2 of these slots (each inbox's email and app password) goes to your seller with them, so they can follow your orders.",
      miss: OPT ? "" : "2 slots have no inbox app password saved in FAFO (Sam V3, Sam V4), so your seller can't follow those orders: add it in Store logins." });
    const refused = W.refused.length, body = await send();
    assert.equal(W.refused.length, refused, "the batch went through");
    assert.deepEqual(imapOf(body).map((f) => f.text), [OPT ? "tag.sample@example.com:Sample-Tag-Pw-6" : "tag.sample@example.com:Sample-Tag-Pw-6\r\nfallback.sample@example.com:Sample-Fb-Pw-7"]);
    assert.ok(!JSON.stringify(imapOf(body)).includes("+box"), "no +tag");
  });
  if (COSTCO) await test(`Costco: ${FOUR ? "each slot's logins line carries its inbox (email:::password:::imap email:::app password), in the slots' order, and no imap file" : "email:password logins and an imap file (before 1.9.159)"}; Target's and Pokémon Center's files as before`, async () => {
    await ev(() => {
      const T = window.__t, S = T.S;
      for (const k of Object.keys(S.subs)) delete S.subs[k];
      S.inboxes.push({ id: "icA", email: "costco.one@example.com", password: "Costco-Pw-A", provider: "custom", host: "imap.example.com", port: "993" });
      S.logins.push(
        { id: "lc1", store: "costco", email: "costco.one@example.com", password: "Store-C-1", inboxId: "icA" },
        { id: "lc2", store: "costco", email: "costco.one+c2@example.com", password: "Store-C-2", inboxId: "icA" },
        // A password with a colon goes as it is.
        { id: "lc3", store: "costco", email: "buyer.costco@example.com", password: "Store:C-3", inboxId: "ib1" },
        { id: "lc4", store: "costco", email: "nopw.costco@example.com", password: "Store-C-4", inboxId: "ib3" },
        { id: "lc5", store: "costco", email: "tag.sample+c5@example.com", password: "Store-C-5", inboxId: "ib6" });
      const add = (id, name, loginId) => {
        S.addresses.push({ id: "a" + id, first: "Sam", last: "Sample", line1: "1 Sample St", city: "Austin", state: "TX", zip: "78701", country: "US" });
        S.profiles.push({ id, name, shipId: "a" + id, billSame: true, cardId: "c1", phone: "5125550100", email: "", stores: [{ store: "costco", storeName: "", mode: "login", loginId, email: "", verified: false }] });
      };
      ["lc1", "lc2", "lc3", "lc4", "lc5", null].forEach((l, i) => add("c" + (i + 1), "Sam C" + (i + 1), l));
      S.caps.costco = 20;
      T.persist(); T.render();
    });
    const said = await openSubmit(C_SLOTS.concat([["t1", "target"], ["p2", "pokemoncenter"]]));
    // The window as before: Costco's slots with an inbox count, C4's lacks its app password (C6 waits for its login).
    assert.deepEqual(said, { ok: "Your inbox access for 6 of these slots (each inbox's email and app password) goes to your seller with them, so they can follow your orders.",
      miss: "1 slot has no inbox app password saved in FAFO (Costco: Sam C4), so your seller can't follow its orders: add it in Store logins." });
    const body = await send();
    assert.deepEqual(filesOf(body, "Costco").map((f) => [f.kind, f.storeKey || "", f.fmt]),
      [["profiles", "costco", undefined], ["aycd", "costco", undefined], ["logins", "", FOUR ? "imap4" : undefined]].concat(FOUR ? [] : [["imap", "costco", undefined]]));
    assert.equal(filesOf(body, "Costco").find((f) => f.kind === "logins").text, C_LOGINS);
    if (!FOUR) assert.equal(filesOf(body, "Costco").find((f) => f.kind === "imap").text, "costco.one@example.com:Costco-Pw-A\r\nsam.sample@gmail.com:abcdefghijklmnop\r\ntag.sample@example.com:Sample-Tag-Pw-6");
    assert.equal(filesOf(body, "Costco")[0].text.split("\r\n").length, 7, "every slot in the profiles CSV, C6 too");
    // Target and Pokémon Center as before: email:password logins and their own imap files.
    assert.deepEqual(filesOf(body, "Target").map((f) => [f.kind, f.storeKey || "", f.fmt, f.kind === "logins" || f.kind === "imap" ? f.text : ""]), [
      ["profiles", "target", undefined, ""], ["aycd", "target", undefined, ""], ["logins", "", undefined, "sam.sample+t1@gmail.com:Store-Pw-1"], ["imap", "target", undefined, "sam.sample@gmail.com:abcdefghijklmnop"]]);
    assert.deepEqual(filesOf(body, "Pokémon Center").map((f) => [f.kind, f.storeKey || "", f.fmt, f.kind === "imap" ? f.text : ""]), [
      ["profiles", "pokemoncenter", undefined, ""], ["aycd", "pokemoncenter", undefined, ""], ["imap", "pokemoncenter", undefined, "pc.sample@example.com:Sample-Pc-Pw-2"]]);
  });
  await test("a recipient set by hand gets a sealed code as before: the window says nothing of inboxes", async () => {
    await ev(() => { const T = window.__t; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; T.S.submitTo = { pub: "B" + "A".repeat(86), keyId: "ABCD-1234" }; T.persist(); });
    const said = await openSubmit([["t1", "target"], ["p1", "pokemoncenter"]]);
    assert.deepEqual(said, { ok: "", miss: "" });
    assert.match(await text("#layers .panel"), /Encrypted for key ID ABCD-1234/);
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#ss-go"));
    await ev(() => { const T = window.__t; delete T.S.submitTo; T.persist(); });
  });
  if (COSTCO) await test("a recipient set by hand: the sealed code carries each Costco login with its inbox, as before, and nothing goes to /submissions", async () => {
    // A real collecting key, so the code can be opened here.
    await ev(async () => {
      const T = window.__t, kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
      window.__jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
      for (const k of Object.keys(T.S.subs)) delete T.S.subs[k];
      T.S.submitTo = { pub: btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), keyId: "SAMP-1234" };
      T.persist();
    });
    const said = await openSubmit([["c1", "costco"], ["c4", "costco"], ["c5", "costco"]]);
    assert.deepEqual(said, { ok: "", miss: "" });
    assert.match(await text("#layers .panel"), /Encrypted for key ID SAMP-1234/);
    const n = W.subs.length, refused = W.refused.length;
    await page.fill("#ss-from", "Sam");
    await page.click("#ss-go");
    await page.waitForFunction(() => /^PVSUB1\./.test((document.querySelector("#ss-code") || {}).value || ""));
    const payload = await ev(async () => window.__t.openSubmission(document.querySelector("#ss-code").value, window.__jwk));
    assert.equal(W.subs.length + W.refused.length, n + refused, "nothing went to /submissions");
    const imap = (email, password, provider = "custom", host = "imap.example.com") => ({ email, password, provider, host, port: "993" });
    assert.deepEqual(payload.slots.map((x) => [x.store, x.storeId, x.login]), [
      ["Costco", "costco", { store: "Costco", storeId: "costco", label: "", email: "costco.one@example.com", password: "Store-C-1", imap: imap("costco.one@example.com", "Costco-Pw-A") }],
      ["Costco", "costco", { store: "Costco", storeId: "costco", label: "", email: "nopw.costco@example.com", password: "Store-C-4", imap: imap("nopw.sample@example.com", "") }],
      // The inbox as saved, with its +tag: the code is opened in the seller's FAFO, not read by their bot.
      ["Costco", "costco", { store: "Costco", storeId: "costco", label: "", email: "tag.sample+c5@example.com", password: "Store-C-5", imap: imap("tag.sample+box@example.com", "Sample-Tag-Pw-6") }]]);
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#ss-go"));
    await ev(() => { const T = window.__t; delete T.S.submitTo; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; delete window.__jwk; T.persist(); });
  });
  // IMAP's tab is gone from 1.9.157 (inbox-lights.test.mjs): what it said about inbox passwords is under Store logins' Inboxes.
  const imapTab = async () => !!(await page.$('#side [data-id="imap"]'));
  await test("Store logins has Add inbox and says the seller gets an inbox's access with the slots; IMAP (Store logins' Inboxes from 1.9.157) no longer says it's never sent", async () => {
    await page.click('#side [data-id="logins"]');
    assert.ok(await page.$('#main .view-tools [data-act="new-inbox-only"]'), "Add inbox on Store logins");
    assert.match(await text("#main"), /Your seller gets an inbox's email and app password with the slots you submit on its accounts, so they can follow your orders\./);
    await page.click('#main .view-tools [data-act="new-inbox-only"]');
    await page.waitForSelector("#layers .panel");
    assert.equal(await text("#layers .panel-head h2"), "Add inbox");
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    const tab = await imapTab();
    if (tab) await page.click('#side [data-id="imap"]');
    assert.doesNotMatch(await text("#main"), /never sends an inbox password|never sent to the server|nowhere else|only to your seller/);
    if (tab) assert.match(await text("#main"), /When you submit slots on your own accounts, FAFO sends your seller their inboxes' email and app password, so they can follow your orders\./);
    // 1.9.149: with the license key, Test sends an inbox's password to FAFO's server too (web-inbox-test.test.mjs).
    assert.match(await text("#main"), /Your inbox passwords are kept in your encrypted vault, and leave it only when you press Test \(FAFO's server signs in with it and keeps nothing\) and with the slots you submit on that inbox's accounts\./);
    // Settings → Email import on the web: Add inbox is on Store logins; only Sync needs the desktop app.
    const set = await ev(() => { const d = document.createElement("div"); d.innerHTML = window.__t.emailSectionHTML(); return d.textContent.replace(/\s+/g, " "); });
    assert.match(set, /Sync is in the FAFO desktop app for Windows\. A web page isn't allowed to sign in to email, so it can't find your orders there\. You can save an inbox here \(Store logins, then Add inbox\), but only the desktop app reads it\./);
    assert.doesNotMatch(set, /can't appear here/);
  });
  await test("the seller's own FAFO: its batches bring no inbox access, and nothing says the seller gets one", async () => {
    W.owner = true;
    await ev(() => window.__t.refreshPremium(true));
    await page.waitForFunction(() => window.__t.isPremiumOwner());
    await ev(() => { const T = window.__t; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; T.persist(); });
    const said = await openSubmit([["t1", "target"], ["t3", "target"], ["p1", "pokemoncenter"]]);
    assert.deepEqual(said, { ok: "", miss: "" });
    const body = await send();
    assert.deepEqual(imapOf(body), []);
    assert.deepEqual(body.files.map((f) => f.kind), ["profiles", "aycd", "profiles", "aycd", "logins"]);
    await page.click('#side [data-id="logins"]');
    assert.doesNotMatch(await text("#main"), /Your seller gets/);
    const tab = await imapTab();
    if (tab) await page.click('#side [data-id="imap"]');
    assert.doesNotMatch(await text("#main"), /FAFO sends your seller|leave it only with the slots|with the slots you submit/);
    assert.match(await text("#main"), /Your inbox passwords are kept in your encrypted vault, and leave it only when you press Test \(FAFO's server signs in with it and keeps nothing\)\./);
    W.owner = false;
    await ev(() => window.__t.refreshPremium(true));
    await page.waitForFunction(() => !window.__t.isPremiumOwner());
    // Back to a buyer's: the IMAP page (Store logins, from 1.9.157) says so again once the answer is in.
    await page.waitForFunction((tab) => (tab ? /FAFO sends your seller/ : /Your seller gets an inbox's email and app password/).test(document.querySelector("#main").textContent), tab);
  });
  if (COSTCO) await test(`the seller's own FAFO with Costco slots: ${FOUR ? "its logins' inbox fields empty" : "email:password logins"}, and no imap file for any store`, async () => {
    await ownerIs(true);
    try {
      await ev(() => { const T = window.__t; for (const k of Object.keys(T.S.subs)) delete T.S.subs[k]; T.persist(); });
      const said = await openSubmit([["c1", "costco"], ["c3", "costco"], ["c4", "costco"], ["t1", "target"], ["p2", "pokemoncenter"]]);
      assert.deepEqual(said, { ok: "", miss: "" });
      const body = await send();
      assert.deepEqual(imapOf(body), []);
      const byStore = (a, b) => (a[0] < b[0] ? -1 : 1);
      assert.deepEqual(body.files.filter((f) => f.kind === "logins").map((f) => [f.store, f.fmt, f.text]).sort(byStore), [
        ["Costco", FOUR ? "imap4" : undefined, FOUR ? "costco.one@example.com:::Store-C-1::::::\r\nbuyer.costco@example.com:::Store:C-3::::::\r\nnopw.costco@example.com:::Store-C-4::::::"
          : "costco.one@example.com:Store-C-1\r\nbuyer.costco@example.com:Store:C-3\r\nnopw.costco@example.com:Store-C-4"],
        ["Target", undefined, "sam.sample+t1@gmail.com:Store-Pw-1"]]);
      for (const x of ["Costco-Pw-A", "abcdefghijklmnop", "Sample-Pc-Pw-2"]) assert.ok(!JSON.stringify(body.files).includes(x), "no app password: " + x);
    } finally { await ownerIs(false); }
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
