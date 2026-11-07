// An order's emails on to a buyer (desktop 15): findOrderMailOn and forwardMailOn against a pretend mail server, and the
// email forwardMail writes (nodemailer's in-memory transport, read back with mailparser). Which folders are searched,
// which emails are found and which are left (another order's, FAFO's own forwards, sent from the mailbox, Trash), and what
// the buyer gets. Sample addresses and order numbers only.
"use strict";
const assert = require("assert");
const { simpleParser } = require("mailparser");
const imap = require("../imap-sync.js");
const { _forward: { findOrderMailOn, forwardMailOn, forwardOf, mailKey, smtpServers, smtpError, smtpStops, notStoreMail, fwdAddr, FWD_MARK, FWD_NOTE } } = imap;

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.log(`FAIL ${name}: ${e.stack || e.message}`); process.exitCode = 1; } };

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
// A store's HTML email with an inline picture, as it reaches the account's mailbox.
function raw({ id, from = "Target <orders@oe.target.com>", to = "acct.one@example.com", subject, body, html = true, extra = "" }) {
  const b = "=_b" + id;
  const head = `Message-ID: <${id}@example.com>\r\nFrom: ${from}\r\nTo: ${to}\r\nDate: Mon, 02 Nov 2026 10:00:00 +0000\r\nSubject: ${subject}\r\n${extra}MIME-Version: 1.0\r\n`;
  if (!html) return head + `Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
  return head + `Content-Type: multipart/related; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n` +
    `<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body><p class="x">${body}</p><img src="cid:pic${id}@x"></body></html>\r\n` +
    `--${b}\r\nContent-Type: image/png\r\nContent-ID: <pic${id}@x>\r\nContent-Disposition: inline; filename="item.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${PIXEL.toString("base64")}\r\n--${b}--\r\n`;
}
// boxes: {path: {v: uidValidity, msgs: [{uid, src}]}}; gmail adds X-GM-EXT-1 and All Mail.
function fakeClient({ gmail, boxes, failSearch }) {
  const calls = { opened: [], search: [], fetched: [] };
  let open = null;
  const list = Object.keys(boxes).map(path => ({ path, specialUse: /trash/i.test(path) ? "\\Trash" : /spam|junk/i.test(path) ? "\\Junk" : /all mail/i.test(path) ? "\\All" : /sent/i.test(path) ? "\\Sent" : "" }));
  const c = {
    calls, mailbox: null,
    capabilities: new Map(gmail ? [["X-GM-EXT-1", true]] : []),
    list: async () => list,
    getMailboxLock: async (p) => { if (!boxes[p]) throw new Error("no such box"); open = p; c.mailbox = { uidValidity: boxes[p].v }; calls.opened.push(p); return { release() { open = null; } }; },
    search: async (q) => {
      calls.search.push({ box: open, q });
      if (failSearch) return false;
      const words = q.gmraw ? (q.gmraw.match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1)) : q.or.map(x => x.subject || x.body);
      return boxes[open].msgs.filter(m => words.some(w => m.src.toUpperCase().includes(w))).map(m => m.uid);
    },
    // Headers alone, as BODY.PEEK[HEADER] gives them, or the whole email.
    fetch: async function* (uids, q) {
      calls.fetched.push({ box: open, uids: uids.slice(), what: q && q.headers ? "headers" : "source" });
      for (const m of boxes[open].msgs) if (uids.includes(m.uid)) yield q && q.headers ? { uid: m.uid, headers: Buffer.from(m.src.slice(0, m.src.indexOf("\r\n\r\n") + 4)) } : { uid: m.uid, source: Buffer.from(m.src) };
    }
  };
  return c;
}
const CFG = { email: "seller.box@example.com", host: "imap.gmail.com" };
const NO = "902003840648514", NO2 = "902003840600001";

(async () => {
  await t("found in All Mail and Spam (never Trash or Sent), oldest first, each email once, with its id", async () => {
    const c = fakeClient({ gmail: true, boxes: {
      "INBOX": { v: 1, msgs: [] },
      "[Gmail]/All Mail": { v: 7, msgs: [
        { uid: 1, src: raw({ id: "a1", subject: `Here's your order #${NO}`, body: `Order ${NO}` }) },
        { uid: 2, src: raw({ id: "a2", subject: `Your order ${NO} has shipped`, body: "on its way" }) },
        { uid: 3, src: raw({ id: "a3", subject: "Two orders", body: `${NO} shipped, ${NO2} still coming` }) },
        { uid: 4, src: raw({ id: "a4", subject: `Fwd: Here's your order #${NO}`, body: "x", extra: `${FWD_MARK}: abc\r\n` }) },
        { uid: 5, src: raw({ id: "a5", from: "Me <seller.box@example.com>", subject: `About ${NO}`, body: "note to self" }) },
        { uid: 6, src: raw({ id: "a6", subject: `Ref ${NO}9`, body: "a longer number" }) }] },
      "[Gmail]/Spam": { v: 9, msgs: [{ uid: 8, src: raw({ id: "s8", subject: `Delivered: ${NO}`, body: "at the door" }) }] },
      "[Gmail]/Trash": { v: 3, msgs: [{ uid: 9, src: raw({ id: "t9", subject: `old ${NO}`, body: "" }) }] } } });
    const r = await findOrderMailOn(c, CFG, [{ no: NO, since: "2026-11-01" }], [NO2]);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(c.calls.opened, ["[Gmail]/All Mail", "[Gmail]/Spam"]);
    assert.strictEqual(c.calls.search[0].q.gmraw, `("${NO}") after:2026/10/29 -in:sent`);
    assert.deepStrictEqual(r.found.map(f => [f.folder, f.uid, f.uidValidity]), [["[Gmail]/All Mail", 1, "7"], ["[Gmail]/All Mail", 2, "7"], ["[Gmail]/Spam", 8, "9"]]);
    assert.strictEqual(r.mixed, 1, "the note about another order too is left out");
    assert.deepStrictEqual(r.found[0].no, [NO]);
    assert.ok(r.found.every(f => /^[0-9a-f]{24}$/.test(f.id)) && new Set(r.found.map(f => f.id)).size === 3);
  });
  await t("the same email in two folders (an IMAP server's copy) is found once; its id is its Message-ID's", async () => {
    const src = raw({ id: "dup", subject: `Order ${NO}`, body: "x" });
    const c = fakeClient({ boxes: { "INBOX": { v: 1, msgs: [{ uid: 1, src }] }, "Junk": { v: 2, msgs: [{ uid: 5, src }] } } });
    const r = await findOrderMailOn(c, { email: "a@example.com", host: "imap.example.com" }, [{ no: NO, since: "2026-11-01" }], []);
    assert.strictEqual(r.found.length, 1);
    assert.strictEqual(r.found[0].id, mailKey(await simpleParser(src)));
    assert.deepStrictEqual(c.calls.search[0].q.or, [{ subject: NO }, { body: NO }]);
  });
  await t("nothing asked for: nothing opened; a server that refuses the search is an error", async () => {
    const c = fakeClient({ boxes: { "INBOX": { v: 1, msgs: [] } } });
    assert.deepStrictEqual((await findOrderMailOn(c, CFG, [{ no: "12" }], [])).found, []);
    assert.deepStrictEqual(c.calls.opened, []);
    const bad = fakeClient({ boxes: { "INBOX": { v: 1, msgs: [{ uid: 1, src: raw({ id: "z", subject: NO, body: "" }) }] } }, failSearch: true });
    await assert.rejects(findOrderMailOn(bad, { email: "a@example.com", host: "imap.example.com" }, [{ no: NO }], []), /SEARCH_FAILED/);
  });
  await t("the forward reads like a mail app's: Fwd:, the original's headers, its HTML and inline picture, FAFO's mark", async () => {
    const mail = await simpleParser(raw({ id: "f1", subject: `Here's your order #${NO}`, body: "Thanks for your order" }), { keepCidLinks: true });
    const msg = forwardOf(mail, "seller.box@example.com", "friend@example.com", "abc123");
    const nodemailer = require("nodemailer");
    const out = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(msg);
    const got = await simpleParser(out.message, { keepCidLinks: true });
    assert.strictEqual(got.subject, `Fwd: Here's your order #${NO}`);
    assert.strictEqual(got.from.value[0].address, "seller.box@example.com");
    assert.strictEqual(got.to.value[0].address, "friend@example.com");
    assert.strictEqual(got.headers.get(FWD_MARK.toLowerCase()), "abc123");
    assert.match(got.html, /---------- Forwarded message ---------<br>From: (?:&quot;)?Target(?:&quot;)? &lt;orders@oe.target.com&gt;<br>Date: Mon, 02 Nov 2026 10:00:00 GMT<br>Subject: Here's your order #902003840648514<br>To: acct.one@example.com/);
    assert.match(got.html, /<style>\.x\{color:red\}<\/style>/, "the store's styles stay");
    assert.ok(!/<html|<body|<head|DOCTYPE/i.test(got.html), "one document");
    assert.match(got.html, /src="cid:picf1@x"/);
    assert.strictEqual(got.attachments.length, 1);
    assert.strictEqual(got.attachments[0].cid, "picf1@x");
    assert.ok(got.attachments[0].content.equals(PIXEL));
    assert.match(got.text, /Forwarded message[\s\S]*Thanks for your order/);
    const plain = forwardOf(await simpleParser(raw({ id: "p", subject: "Fwd: already <b>", body: "a < b", html: false })), "s@example.com", "f@example.com", "x");
    assert.strictEqual(plain.subject, "Fwd: already <b>");
    assert.match(plain.html, /<pre[^>]*>a &lt; b/);
  });
  await t("forwarding sends each picked email once, and leaves those whose folder was rebuilt or that are gone", async () => {
    const boxes = { "[Gmail]/All Mail": { v: 7, msgs: [{ uid: 1, src: raw({ id: "a1", subject: `Order ${NO}`, body: "x" }) }, { uid: 2, src: raw({ id: "a2", subject: `Shipped ${NO}`, body: "y" }) }] },
      "[Gmail]/Spam": { v: 10, msgs: [{ uid: 8, src: raw({ id: "s8", subject: `Delivered ${NO}`, body: "z" }) }] } };
    const found = (await findOrderMailOn(fakeClient({ gmail: true, boxes }), CFG, [{ no: NO, since: "2026-11-01" }], [])).found;
    const items = found.map(f => ({ id: f.id, folder: f.folder, uid: f.uid, uidValidity: f.uidValidity }));
    items[2].uidValidity = "9";   // Spam rebuilt since it was found
    items.push({ id: "f".repeat(24), folder: "[Gmail]/All Mail", uid: 99, uidValidity: "7" });   // deleted since
    items.push({ id: "e".repeat(24), folder: "[Gmail]/All Mail", uid: 2, uidValidity: "7" });   // a second item for that UID
    const sent = [];
    const r = await forwardMailOn(fakeClient({ gmail: true, boxes }), CFG, items, "friend@example.com", async (m) => { sent.push(m); });
    assert.deepStrictEqual(r.sent, [items[0].id, items[1].id]);
    assert.deepStrictEqual(r.gone.sort(), [items[2].id, items[3].id, items[4].id].sort());
    assert.deepStrictEqual(sent.map(m => [m.to, m.subject, m.headers[FWD_MARK]]), [["friend@example.com", `Fwd: Order ${NO}`, items[0].id], ["friend@example.com", `Fwd: Shipped ${NO}`, items[1].id]]);
  });
  await t("a send that fails is said; one the mail server refuses to sign in stops the rest, keeping what went", async () => {
    const boxes = { "INBOX": { v: 1, msgs: [1, 2, 3].map(u => ({ uid: u, src: raw({ id: "m" + u, subject: `Order ${NO} #${u}`, body: "x" }) })) } };
    const found = (await findOrderMailOn(fakeClient({ boxes }), { email: "a@example.com", host: "imap.example.com" }, [{ no: NO }], [])).found;
    const items = found.map(f => ({ id: f.id, folder: f.folder, uid: f.uid, uidValidity: f.uidValidity }));
    let n = 0;
    const res = { sent: [], failed: [], gone: [] };
    await assert.rejects(forwardMailOn(fakeClient({ boxes }), {}, items, "f@example.com", async () => {
      n++; if (n === 2) throw Object.assign(new Error("message too big"), { responseCode: 552 }); if (n === 3) throw Object.assign(new Error("Invalid login"), { code: "EAUTH" });
    }, res));
    assert.deepStrictEqual([res.sent, res.failed.map(f => f.id)], [[items[0].id], [items[1].id, items[2].id]]);
    assert.match(res.failed[1].error, /didn't let FAFO send/);
  });
  await t("forwardMail: an address that isn't one is refused; nothing to send opens nothing; SMTP down stops before the mailbox", async () => {
    assert.match((await imap.forwardMail(CFG, [{ id: "x", folder: "INBOX", uid: 1, uidValidity: "1" }], "not an email")).error, /isn't an email address/);
    assert.deepStrictEqual(await imap.forwardMail(CFG, [], "f@example.com"), { ok: true, sent: [], failed: [], gone: [] });
    const r = await imap.forwardMail({ email: "a@example.com", password: "p", host: "imap.invalid" }, [{ id: "x", folder: "INBOX", uid: 1, uidValidity: "1" }], "f@example.com");
    assert.strictEqual(r.ok, false); assert.strictEqual(r.smtp, true);
    for (const ok of ["friend@example.com", "a.b+c@sub.example.co"]) assert.strictEqual(fwdAddr(ok), ok);
    for (const bad of ["a@b", "a@b.c", "a b@example.com", "a@example.com, b@example.com", "<a@example.com>", "x".repeat(200) + "@example.com"]) assert.strictEqual(fwdAddr(bad), "", bad);
  });
  await t("the outgoing server: the provider's own, or smtp. in place of imap. on 465 then 587", () => {
    assert.deepStrictEqual(smtpServers("imap.gmail.com"), [{ host: "smtp.gmail.com", port: 465 }]);
    assert.deepStrictEqual(smtpServers("imap.mail.me.com"), [{ host: "smtp.mail.me.com", port: 587 }]);
    assert.deepStrictEqual(smtpServers("outlook.office365.com"), [{ host: "smtp-mail.outlook.com", port: 587 }]);
    assert.deepStrictEqual(smtpServers("imap.mail.yahoo.com"), [{ host: "smtp.mail.yahoo.com", port: 465 }]);
    assert.deepStrictEqual(smtpServers("imap.example.net"), [{ host: "smtp.example.net", port: 465 }, { host: "smtp.example.net", port: 587 }]);
    assert.match(smtpError({ response: "535 5.7.139 Authentication unsuccessful, basic authentication is disabled" }), /doesn't let apps send/);
    assert.match(smtpError({ code: "ESOCKET", message: "connect ECONNREFUSED" }), /Couldn't connect/);
  });
  await t("only the store's own emails: never a reply, an auto-reply, a bounce, a buyer's email, nor an answer to a forward", async () => {
    const mk = (uid, o) => ({ uid, src: raw(Object.assign({ id: "r" + uid, body: `Order ${NO}` }, o)) });
    const boxes = { "INBOX": { v: 1, msgs: [
      mk(1, { subject: `Here's your order #${NO}` }),
      mk(2, { from: "Friend <friend@example.com>", subject: `Fwd: Fwd: Here's your order #${NO}` }),   // a buyer's own address
      mk(3, { from: "Someone <someone@example.com>", subject: `Re: Fwd: Here's your order #${NO}` }),
      mk(4, { from: "Someone <someone@example.com>", subject: `Automatic reply: Fwd: Here's your order #${NO}`, extra: "Auto-Submitted: auto-replied\r\n" }),
      mk(5, { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)" }),
      mk(6, { from: "Postmaster <postmaster@example.net>", subject: `Undeliverable: Fwd: Here's your order #${NO}` }),
      mk(7, { from: "Someone <someone@example.com>", subject: `Thanks for order ${NO}`, extra: "In-Reply-To: <fafo-fwd.abc.123@example.com>\r\n" }),
      mk(8, { from: "Bounce <notify@example.net>", subject: "Your message wasn't delivered", body: `${FWD_MARK}: abc\r\nSubject: Fwd: Order ${NO}` }),
      mk(9, { from: "Someone <someone@example.com>", subject: `Order ${NO}`, extra: "X-Autoreply: yes\r\n" }),
      mk(10, { subject: `Your order ${NO} has shipped`, extra: "Auto-Submitted: auto-generated\r\nPrecedence: bulk\r\n" })] } };
    const r = await findOrderMailOn(fakeClient({ boxes }), { email: "a@example.com", host: "imap.example.com" }, [{ no: NO }], [], { skipFrom: ["FRIEND@example.com"] });
    assert.deepStrictEqual(r.found.map(f => f.uid), [1, 10], "a store's auto-generated email still goes");
  });
  await t("headers first: only an email that may go is downloaded whole; a bounce read and left is said, for the next search", async () => {
    const boxes = { "INBOX": { v: 1, msgs: [
      { uid: 1, src: raw({ id: "w1", subject: `Order ${NO}`, body: "x" }) },
      { uid: 2, src: raw({ id: "w2", subject: `Re: Order ${NO}`, body: "x" }) },
      { uid: 3, src: raw({ id: "w3", from: "Notify <notify@example.net>", subject: "Your message wasn't delivered", body: `${FWD_MARK}: abc Subject: Fwd: Order ${NO}` }) },
      { uid: 4, src: raw({ id: "w4", subject: `Shipped ${NO}`, body: "y" }) },
      { uid: 5, src: raw({ id: "w5", subject: "Your order", body: `${NO}9 is a longer number` }) }] } };
    const cfg = { email: "a@example.com", host: "imap.example.com" };
    const had = mailKey(await simpleParser(boxes.INBOX.msgs[3].src));
    const c = fakeClient({ boxes });
    const r = await findOrderMailOn(c, cfg, [{ no: NO }], [], { skip: [had] });
    assert.deepStrictEqual(r.found.map(f => f.uid), [1]);
    assert.deepStrictEqual(c.calls.fetched.map(f => [f.what, f.uids.slice().sort()]), [["headers", [1, 2, 3, 4, 5]], ["source", [1, 3, 5]]], "a reply and one the buyer has: headers only");
    assert.deepStrictEqual(r.checked, [mailKey(await simpleParser(boxes.INBOX.msgs[2].src))], "the bounce; not the longer number, which a later search may read differently");
    const again = fakeClient({ boxes });
    await findOrderMailOn(again, cfg, [{ no: NO }], [], { skip: [had, ...r.checked, r.found[0].id] });
    assert.deepStrictEqual(again.calls.fetched.map(f => [f.what, f.uids]), [["headers", [5, 4, 3, 2, 1]], ["source", [5]]]);
  });
  await t("more than one call returns: the newest go, after the ones the buyer has", async () => {
    const msgs = [];
    for (let u = 1; u <= 520; u++) {
      const day = new Date(Date.UTC(2026, 8, 1) + u * 3600000).toUTCString().replace("GMT", "+0000");
      msgs.push({ uid: u, src: raw({ id: "n" + u, subject: `Order ${NO} note ${u}`, body: "x" }).replace("Mon, 02 Nov 2026 10:00:00 +0000", day) });
    }
    const boxes = { "INBOX": { v: 1, msgs } };
    const cfg = { email: "a@example.com", host: "imap.example.com" };
    const all = await findOrderMailOn(fakeClient({ boxes }), cfg, [{ no: NO }], []);
    assert.strictEqual(all.partial, true);
    assert.strictEqual(all.found.length, 500);
    assert.deepStrictEqual([all.found[0].uid, all.found[499].uid], [21, 520], "the newest 500, oldest first");
    const had = all.found.map(f => f.id);
    const next = await findOrderMailOn(fakeClient({ boxes }), cfg, [{ no: NO }], [], { skip: had });
    assert.deepStrictEqual(next.found.map(f => f.uid), Array.from({ length: 20 }, (_, i) => i + 1), "the rest, once the buyer has the newest");
    assert.strictEqual(next.partial, false);
  });
  await t("a forward says so: its own Message-ID, which a reply names, and the note the buyer's FAFO reads", async () => {
    const msg = forwardOf(await simpleParser(raw({ id: "q", subject: `Order ${NO}`, body: "x" })), "seller.box@example.com", "friend@example.com", "0123456789abcdef01234567");
    assert.match(msg.messageId, /^<fafo-fwd\.0123456789abcdef01234567\.[0-9a-f]{12}@example\.com>$/);
    assert.ok(msg.text.startsWith(FWD_NOTE + "\n\n---------- Forwarded message"));
    const reply = await simpleParser(`Message-ID: <r@x.com>\r\nFrom: f@example.com\r\nSubject: Thanks\r\nIn-Reply-To: ${msg.messageId}\r\n\r\nok`);
    assert.strictEqual(notStoreMail(reply, ""), true);
  });
  await t("a sending limit or the buyer's address refused stops the rest; one email the server won't take doesn't", async () => {
    assert.strictEqual(smtpStops({ responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded." }), true);
    assert.strictEqual(smtpStops({ responseCode: 421, response: "421 4.7.0 Try again later, closing connection." }), true);
    assert.strictEqual(smtpStops({ responseCode: 554, response: "554 5.2.0 STOREDRV.Submission.Exception:SubmissionQuotaExceededException" }), true);
    assert.strictEqual(smtpStops({ code: "EENVELOPE", responseCode: 553, response: "553 5.1.2 bad address" }), true);
    assert.strictEqual(smtpStops({ code: "ECONNECTION", message: "Connection closed unexpectedly" }), true);
    assert.strictEqual(smtpStops({ code: "EMESSAGE", responseCode: 552, response: "552 5.3.4 Message size exceeds fixed limit" }), false);
    assert.strictEqual(smtpStops({ code: "EMESSAGE", responseCode: 550, response: "550 5.7.1 Message rejected as spam" }), false);
    assert.match(smtpError({ responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded." }), /limiting how much this inbox sends/);
    assert.strictEqual(smtpStops({ code: "EAUTH", responseCode: 454, response: "454 4.7.0 Too many login attempts, please try again later." }), true);
    const boxes = { "INBOX": { v: 1, msgs: [1, 2, 3].map(u => ({ uid: u, src: raw({ id: "l" + u, subject: `Order ${NO} #${u}`, body: "x" }) })) } };
    const items = (await findOrderMailOn(fakeClient({ boxes }), { email: "a@example.com", host: "imap.example.com" }, [{ no: NO }], [])).found.map(f => ({ id: f.id, folder: f.folder, uid: f.uid, uidValidity: f.uidValidity }));
    const res = { sent: [], failed: [], gone: [] };
    let n = 0;
    await assert.rejects(forwardMailOn(fakeClient({ boxes }), {}, items, "f@example.com", async () => {
      if (++n === 2) throw Object.assign(new Error("limit"), { responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded." });
    }, res), (e) => e.fafoSmtp === true);
    assert.deepStrictEqual([res.sent.length, res.failed.length], [1, 1], "the third isn't tried");
  });
  console.log(`${pass} passed`);
})();
