// Find in Spam (desktop 14): listSpamOn and spamToInboxOn against a pretend mail server. Which folder they open, what the
// list says about each email (sender, subject, when, a store the receiving server verified), and what moves to the Inbox.
// Sample addresses only.
"use strict";
const assert = require("assert");
const { _spam: { listSpamOn, spamToInboxOn, SPAM_LIST_MAX, verifiedBy } } = require("../imap-sync.js");

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

const DMARC_TARGET = "Authentication-Results: mx.google.com;\r\n dkim=pass header.i=@oe.target.com;\r\n spf=pass smtp.mailfrom=oe.target.com;\r\n dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=oe.target.com\r\n";
const DMARC_FAIL = "Authentication-Results: mx.google.com;\r\n dmarc=fail (p=REJECT) header.from=target.com\r\n";
// The topmost header is our own server's; one lower down could have been written by the sender.
const FORGED_LOW = "Authentication-Results: mx.google.com; dmarc=fail header.from=target.com\r\nAuthentication-Results: evil.example; dmarc=pass header.from=target.com\r\n";

// boxes: {path: {v: uidValidity, msgs: [{uid, name, address, subject, at, auth}]}}. noSpam: no Spam folder; noMove: a server
// without MOVE; failSearch: the server refuses the search (imapflow answers false); failMove: it refuses the move.
function fakeClient({ boxes, noSpam, noMove, failSearch, failMove }) {
  const calls = { opened: [], searched: [], fetched: [], move: [], copy: [], del: [] };
  let open = null;
  const list = Object.keys(boxes).filter(p => !(noSpam && /spam|junk/i.test(p)))
    .map(path => ({ path, specialUse: /trash/i.test(path) ? "\\Trash" : /spam|junk/i.test(path) ? "\\Junk" : "" }));
  const c = {
    calls, mailbox: null,
    capabilities: new Map(noMove ? [] : [["MOVE", true]]),
    list: async () => list,
    getMailboxLock: async (p) => { if (!boxes[p]) throw new Error("no such box"); open = p; c.mailbox = { uidValidity: boxes[p].v }; calls.opened.push(p); return { release() { open = null; } }; },
    search: async (q) => {
      calls.searched.push({ box: open, since: q.since, uid: q.uid }); if (failSearch) return false;
      if (q.uid) { const want = String(q.uid).split(",").map(Number); return boxes[open].msgs.filter(m => want.includes(m.uid)).map(m => m.uid); }
      return boxes[open].msgs.filter(m => m.at >= q.since.getTime()).map(m => m.uid);
    },
    fetch: async function* (uids, query) {
      calls.fetched.push({ box: open, uids: uids.slice(), query });
      for (const m of boxes[open].msgs) if (uids.includes(m.uid))
        yield { uid: m.uid, internalDate: new Date(m.at), envelope: { subject: m.subject, from: [{ name: m.name, address: m.address }] }, headers: Buffer.from(m.auth || "") };
    },
    messageMove: async (uids, dest) => { if (failMove) return false; calls.move.push({ box: open, uids: uids.slice(), dest }); return { uidMap: new Map(uids.map(u => [u, u + 1000])) }; },
    messageCopy: async (uids, dest) => { calls.copy.push({ box: open, uids: uids.slice(), dest }); return { uidMap: new Map(uids.map(u => [u, u + 1000])) }; },
    messageDelete: async (uids) => { calls.del.push({ box: open, uids: uids.slice() }); return true; }
  };
  return c;
}

const NOW = Date.now(), DAY = 86400000;
const spam = (msgs) => ({ INBOX: { v: "7", msgs: [] }, "[Gmail]/Spam": { v: "9", msgs }, "[Gmail]/Trash": { v: "3", msgs: [] } });

(async () => {
  await t("lists Spam's emails from the days asked for, with sender, subject, when and a verified store", async () => {
    const c = fakeClient({ boxes: spam([
      { uid: 11, name: "Target", address: "orders@oe.target.com", subject: "Get ready for something special! Items from order #902000000000001are about to ship.", at: NOW - 2 * DAY, auth: DMARC_TARGET },
      { uid: 12, name: "Target", address: "orders_at_oe_target_com_abcdefghijkl_mnopqr@icloud.com", subject: "Items from order #902000000000002 are about to ship.", at: NOW - 3 * DAY, auth: "" },
      { uid: 13, name: "Target", address: "target@not-target.example", subject: "Your order is on hold", at: NOW - DAY, auth: DMARC_FAIL },
      { uid: 14, name: "Target", address: "orders@target.com", subject: "Order update", at: NOW - DAY, auth: FORGED_LOW },
      { uid: 15, name: "Old", address: "old@example.com", subject: "Too old", at: NOW - 40 * DAY, auth: "" }]) });
    const r = await listSpamOn(c, { days: 30, host: "imap.gmail.com" });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(c.calls.opened, ["[Gmail]/Spam"]);
    assert.strictEqual(r.uidValidity, "9");
    assert.strictEqual(r.folder, "[Gmail]/Spam");
    assert.deepStrictEqual(r.items.map(i => i.uid), [11, 12, 13, 14], "not the one from before the days asked for");
    assert.deepStrictEqual(r.items.map(i => i.verified), ["target.com", "", "", ""], "only the store's own domain, by our server's header");
    assert.deepStrictEqual(r.items[0], { uid: 11, name: "Target", address: "orders@oe.target.com",
      subject: "Get ready for something special! Items from order #902000000000001are about to ship.", at: NOW - 2 * DAY, verified: "target.com" });
    assert.strictEqual(r.partial, false);
    assert.deepStrictEqual(c.calls.move, [], "listing moves nothing");
  });

  await t("the newest emails only, past the most it reads, and says so", async () => {
    const msgs = Array.from({ length: SPAM_LIST_MAX + 5 }, (_, i) => ({ uid: i + 1, name: "N", address: "n@example.com", subject: "s" + i, at: NOW - DAY }));
    const c = fakeClient({ boxes: spam(msgs) });
    const r = await listSpamOn(c, { days: 30 });
    assert.strictEqual(r.items.length, SPAM_LIST_MAX);
    assert.strictEqual(r.items[0].uid, 6);
    assert.strictEqual(r.partial, true);
  });

  await t("no Spam folder: an empty list that says so; a refused search is an error, not nothing found", async () => {
    let r = await listSpamOn(fakeClient({ boxes: spam([]), noSpam: true }), { days: 30 });
    assert.deepStrictEqual(r, { ok: true, noSpam: true, uidValidity: "", items: [] });
    await assert.rejects(listSpamOn(fakeClient({ boxes: spam([{ uid: 1, at: NOW }]), failSearch: true }), { days: 30 }), /SEARCH_FAILED/);
  });

  await t("moves the UIDs asked for from Spam to the Inbox, and nothing else", async () => {
    const c = fakeClient({ boxes: spam([{ uid: 11, at: NOW }, { uid: 12, at: NOW }]) });
    const r = await spamToInboxOn(c, [11], "9");
    assert.deepStrictEqual(r, { ok: true, moved: 1, gone: 0 });
    assert.deepStrictEqual(c.calls.move, [{ box: "[Gmail]/Spam", uids: [11], dest: "INBOX" }]);
  });

  await t("ones gone from Spam since the list aren't moved or counted, and say how many", async () => {
    const c = fakeClient({ boxes: spam([{ uid: 11, at: NOW }]) });
    assert.deepStrictEqual(await spamToInboxOn(c, [11, 12, 13], "9"), { ok: true, moved: 1, gone: 2 });
    assert.deepStrictEqual(c.calls.move, [{ box: "[Gmail]/Spam", uids: [11], dest: "INBOX" }]);
    const none = fakeClient({ boxes: spam([]) });
    assert.deepStrictEqual(await spamToInboxOn(none, [12], "9"), { ok: true, moved: 0, gone: 1 });
    assert.deepStrictEqual(none.calls.move, []);
  });

  await t("a move the server refuses says the emails are still in Spam (not Trash)", async () => {
    const r = await spamToInboxOn(fakeClient({ boxes: spam([{ uid: 11, at: NOW }]), failMove: true }), [11], "9");
    assert.deepStrictEqual(r, { ok: false, error: "The mail server didn't move the emails to your Inbox, so they're still in Spam." });
    await assert.rejects(spamToInboxOn(fakeClient({ boxes: spam([{ uid: 11, at: NOW }]), failSearch: true }), [11], "9"), /SEARCH_FAILED/);
  });

  await t("verified only by the mail provider's own Authentication-Results header", () => {
    const gmail = ["Authentication-Results: mx.google.com;\r\n dmarc=pass (p=REJECT) header.from=oe.target.com"];
    assert.strictEqual(verifiedBy("imap.gmail.com", gmail, "oe.target.com"), "target.com");
    assert.strictEqual(verifiedBy("imap.gmail.com", gmail, "evil.example"), "", "the sender's domain must be the one that passed");
    // A server that writes none: the top one is the sender's own.
    const forged = ["Authentication-Results: x; dmarc=pass header.from=target.com"];
    assert.strictEqual(verifiedBy("mail.mydomain.example", forged, "target.com"), "");
    assert.strictEqual(verifiedBy("imap.gmail.com", ["Authentication-Results: mx.evil.example; dmarc=pass header.from=target.com"], "target.com"), "");
    // The IMAP server's own domain counts for one FAFO doesn't know.
    assert.strictEqual(verifiedBy("imap.mydomain.example", ["Authentication-Results: mx2.mydomain.example; dmarc=pass header.from=target.com"], "target.com"), "target.com");
    assert.strictEqual(verifiedBy("imap.mail.me.com", ["Authentication-Results: dmarc.icloud.com; dmarc=pass header.from=target.com"], "target.com"), "target.com");
    // Microsoft writes no authserv-id: not shown as verified.
    assert.strictEqual(verifiedBy("outlook.office365.com", ["Authentication-Results: spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=target.com; dmarc=pass action=none header.from=target.com"], "target.com"), "");
    assert.strictEqual(verifiedBy("imap.gmail.com", [], "target.com"), "");
  });

  await t("a server without MOVE: copies to the Inbox, then deletes from Spam", async () => {
    const c = fakeClient({ boxes: spam([{ uid: 11, at: NOW }]), noMove: true });
    const r = await spamToInboxOn(c, [11], "9");
    assert.deepStrictEqual(r, { ok: true, moved: 1, gone: 0 });
    assert.deepStrictEqual([c.calls.copy, c.calls.del], [[{ box: "[Gmail]/Spam", uids: [11], dest: "INBOX" }], [{ box: "[Gmail]/Spam", uids: [11] }]]);
  });

  await t("a Spam folder rebuilt since the list (or no UIDVALIDITY given) moves nothing", async () => {
    for (const v of ["8", "", undefined]) {
      const c = fakeClient({ boxes: spam([{ uid: 11, at: NOW }]) });
      const r = await spamToInboxOn(c, [11], v);
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /changed since the search/);
      assert.deepStrictEqual(c.calls.move, []);
    }
  });

  await t("no Spam folder to move from: says so", async () => {
    const r = await spamToInboxOn(fakeClient({ boxes: spam([]), noSpam: true }), [1], "9");
    assert.deepStrictEqual(r, { ok: false, error: "Couldn't find a Spam folder in this inbox." });
  });

  console.log(`${pass} passed`);
})();
