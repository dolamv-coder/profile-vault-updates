// Tests the inbox access Submit sends in the newest page (index-X.Y.Z.html), from 1.9.147 (the owner's request, 2026-11-13:
// "What method can buyer input their imap so it can be sent to my private discord?", then "during submission only",
// "email - apppassword format" and "same where all the slots go"). The real page runs in Chromium (Playwright), as the web
// version at app.fafoaco.com, against a pretend license worker, as interests.test.mjs and walkthrough.test.mjs run it: a vault
// made with Use this browser only, with a license key kept as Submit keeps one typed there. It checks the files /submissions
// gets (an "imap" file per store with slots on the buyer's own accounts: one email:app password line per inbox, in the order
// the store's slots go out, once per inbox and per mailbox, none for Use Assigned Account, a Pokémon Center own email's inbox
// found by its mailbox, a login with no inbox linked by its email's mailbox, an inbox with no app password left out), what
// Submit's window says (with and without slots it can't send one for), a batch of only Use Assigned Account slots (no file,
// no line), and a recipient set by hand (the sealed code: no line). Sample names, addresses, app passwords and keys only.
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
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, keepTypedLic, persist, render, slotKey};" + END);
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
  if (p === "/slots/limit") return json(route, 200, { limit: 50, request: null, canRequest: true });
  return json(route, 404, {});
}
// A line as the license worker takes it (its IMAP_LINE): an email-shaped address, a colon, a password that isn't only spaces.
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
  await page.click("#ss-go");
  await page.waitForFunction(() => document.querySelector("#ss-sent") && !document.querySelector("#ss-sent").hidden);
  await page.click("#layers [data-close]");
  await page.waitForFunction(() => !document.querySelector("#ss-go"));
  assert.equal(W.subs.length, n + 1);
  return W.subs.at(-1);
}
const imapOf = (body) => body.files.filter((f) => f.kind === "imap");

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
      { id: "ib5", email: "solo.sample@example.com", password: "Sample-Solo-Pw-5", provider: "custom", host: "imap.example.com", port: "993" });
    S.logins.push(
      { id: "l1", store: "target", email: "sam.sample+t1@gmail.com", password: "Store-Pw-1", inboxId: "ib1" },
      { id: "l2", store: "target", email: "sam.sample+t2@gmail.com", password: "Store-Pw-2", inboxId: "ib4" },
      { id: "l3", store: "target", email: "nopw.sample@example.com", password: "Store-Pw-3", inboxId: "ib3" },
      { id: "l4", store: "target", email: "lee.sample@example.com", password: "Store-Pw-4", inboxId: "" },
      // No inbox linked, but one is saved for its email's mailbox (its +tag never changes the mailbox).
      { id: "l5", store: "target", email: "pc.sample+tgt@example.com", password: "Store-Pw-5", inboxId: null },
      { id: "l6", store: "target", email: "solo.sample@example.com", password: "Store-Pw-6", inboxId: "ib5" });
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
    assert.equal(said.ok, "Your inbox access for 5 of these slots (each inbox's email and app password) goes to your seller with them, so they can follow your orders.");
    assert.equal(said.miss, "3 slots have no inbox app password saved in FAFO (Pokémon Center: Sam P3; Target: Sam T3, Sam T4), so your seller can't follow those orders: add it in Store logins.");
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
    // (no app password) or Sam T4 (no inbox), Sam T5's found by its email's mailbox; Sam T6 is on Use Assigned Account.
    assert.equal(tgt.text, "sam.sample@gmail.com:abcdefghijklmnop\r\npc.sample@example.com:Sample-Pc-Pw-2");
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
    assert.deepEqual(said, { ok: "", miss: "2 slots have no inbox app password saved in FAFO (Sam T3, Sam T4), so your seller can't follow those orders: add it in Store logins." });
    const body = await send();
    assert.deepEqual(imapOf(body), []);
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
  await test("Store logins has Add inbox and says the seller gets an inbox's access with the slots; IMAP no longer says it's never sent", async () => {
    await page.click('#side [data-id="logins"]');
    assert.ok(await page.$('#main .view-tools [data-act="new-inbox-only"]'), "Add inbox on Store logins");
    assert.match(await text("#main"), /Your seller gets an inbox's email and app password with the slots you submit on its accounts, so they can follow your orders\./);
    await page.click('#main .view-tools [data-act="new-inbox-only"]');
    await page.waitForSelector("#layers .panel");
    assert.equal(await text("#layers .panel-head h2"), "Add inbox");
    await page.click("#layers [data-close]");
    await page.waitForFunction(() => !document.querySelector("#layers .panel"));
    await page.click('#side [data-id="imap"]');
    assert.doesNotMatch(await text("#main"), /never sends an inbox password|never sent to the server/);
    assert.match(await text("#main"), /When you submit slots on your own accounts, FAFO sends your seller their inboxes' email and app password/);
  });

  await test("the page threw nothing", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
}

console.log(`${passed} passed`);
