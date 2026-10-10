// trashOrderMail's logic (moveOrderMail) against a pretend mail server: which folders it searches, what it asks the
// server for on Gmail and elsewhere, and which emails it moves to Trash. Sample order numbers and addresses only.
"use strict";
const assert = require("assert");
const { _orderMail: { moveOrderMail, orderTokens, orderNoList } } = require("../imap-sync.js");

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };
const raw = (subject, body) => `From: Store <orders@example.com>\r\nTo: buyer@example.com\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`;

// boxes: {path: [{uid, subject, body}]}; gmail adds X-GM-EXT-1 and All Mail.
function fakeClient({ gmail, boxes }) {
  const calls = { search: [], move: [], opened: [] };
  let open = null;
  const list = Object.keys(boxes).map(path => ({ path, specialUse: /trash/i.test(path) ? "\\Trash" : /spam|junk/i.test(path) ? "\\Junk" : /all mail/i.test(path) ? "\\All" : "" }));
  return {
    calls,
    capabilities: new Set(gmail ? ["X-GM-EXT-1"] : []),
    list: async () => list,
    getMailboxLock: async (p) => { if (!boxes[p]) throw new Error("no such box"); open = p; calls.opened.push(p); return { release() { open = null; } }; },
    search: async (q) => {
      calls.search.push({ box: open, q });
      const words = q.gmraw ? (q.gmraw.match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1)) : q.or.map(x => x.subject || x.body);
      return boxes[open].filter(m => words.some(w => (m.subject + " " + m.body).toUpperCase().includes(w))).map(m => m.uid);
    },
    fetch: async function* (uids) { for (const m of boxes[open]) if (uids.includes(m.uid)) yield { uid: m.uid, source: Buffer.from(raw(m.subject, m.body)) }; },
    messageMove: async (uids, dest) => { calls.move.push({ box: open, uids: uids.slice(), dest }); return { uidMap: new Map(uids.map(u => [u, u + 1000])) }; }
  };
}

(async () => {
  await t("order numbers: 6 to 40 characters with 5 digits, uppercased, once each", () => {
    assert.deepStrictEqual(orderNoList(["902003840648514", "p0012345678", "P0012345678", "12345", "ORDER-NUMBER", "", null, "BBY01-806123456789", "x".repeat(41)], 10),
      ["902003840648514", "P0012345678", "BBY01-806123456789"]);
  });
  await t("whole words only, and the parts between dashes", () => {
    const w = orderTokens("Order #:902003840648514. Ref 9020038406485149 and BBY01-806123456789, x902003840600001");
    assert.ok(w.has("902003840648514") && w.has("BBY01-806123456789") && w.has("806123456789"));
    assert.ok(!w.has("902003840600001"), "a number glued to letters isn't a word");
  });
  await t("Gmail: All Mail and Spam searched with X-GM-RAW, Trash left alone", async () => {
    const c = fakeClient({ gmail: true, boxes: {
      "INBOX": [], "[Gmail]/All Mail": [
        { uid: 1, subject: "Here's your order #:902003840648514", body: "Order 902003840648514" },
        { uid: 2, subject: "Sorry, we had to cancel order #902003840648514.", body: "canceled" },
        { uid: 3, subject: "Order 902003840600001 shipped", body: "on the way" },
        { uid: 4, subject: "Two orders", body: "902003840648514 canceled, 902003840600001 still coming" }],
      "[Gmail]/Spam": [{ uid: 9, subject: "cancel 902003840648514", body: "" }],
      "[Gmail]/Trash": [{ uid: 5, subject: "old 902003840648514", body: "" }] } });
    const r = await moveOrderMail(c, { host: "imap.gmail.com" }, [{ no: "902003840648514", since: "2026-10-09" }], ["902003840600001"]);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(c.calls.opened, ["[Gmail]/All Mail", "[Gmail]/Spam"]);
    assert.strictEqual(c.calls.search[0].q.gmraw, '("902003840648514") after:2026/10/06');
    assert.deepStrictEqual(c.calls.move, [{ box: "[Gmail]/All Mail", uids: [1, 2], dest: "[Gmail]/Trash" }, { box: "[Gmail]/Spam", uids: [9], dest: "[Gmail]/Trash" }]);
    assert.deepStrictEqual([r.moved, r.kept, r.found["902003840648514"]], [3, 1, 3]);
  });
  await t("Other servers: INBOX and Junk, subject or body, since three days before the order", async () => {
    const c = fakeClient({ gmail: false, boxes: { INBOX: [{ uid: 7, subject: "Your order", body: "Order P0012345678 was canceled" }], Junk: [], Trash: [] } });
    const r = await moveOrderMail(c, { host: "imap.example.com" }, [{ no: "p0012345678", since: "2026-10-09" }], []);
    const q = c.calls.search[0].q;
    assert.deepStrictEqual(q.or, [{ subject: "P0012345678" }, { body: "P0012345678" }]);
    assert.strictEqual(q.since.toISOString().slice(0, 10), "2026-10-06");
    assert.deepStrictEqual(c.calls.move, [{ box: "INBOX", uids: [7], dest: "Trash" }]);
    assert.strictEqual(r.moved, 1);
  });
  await t("20 numbers to a search; a number kept and deleted at once is deleted", async () => {
    const nos = Array.from({ length: 45 }, (_, i) => ({ no: String(902003840600100 + i), since: "2026-10-01" }));
    const c = fakeClient({ gmail: true, boxes: { "[Gmail]/All Mail": [{ uid: 3, subject: "Canceled " + nos[0].no, body: "" }], "[Gmail]/Trash": [] } });
    const r = await moveOrderMail(c, { host: "imap.gmail.com" }, nos, [nos[0].no]);
    assert.strictEqual(c.calls.search.length, 3);
    assert.strictEqual((c.calls.search[0].q.gmraw.match(/ OR /g) || []).length, 19);
    assert.deepStrictEqual([r.moved, r.kept], [1, 0]);
  });
  await t("no Trash folder: nothing moves, and it says so", async () => {
    const c = fakeClient({ gmail: false, boxes: { INBOX: [{ uid: 1, subject: "x 902003840648514", body: "" }] } });
    const r = await moveOrderMail(c, { host: "imap.example.com" }, [{ no: "902003840648514" }], []);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Trash/);
    assert.strictEqual(c.calls.move.length, 0);
  });
  await t("nothing valid: no search at all", async () => {
    const c = fakeClient({ gmail: false, boxes: { INBOX: [], Trash: [] } });
    const r = await moveOrderMail(c, { host: "imap.example.com" }, [{ no: "1234" }, { no: "ORDER" }], []);
    assert.deepStrictEqual([r.ok, r.moved, c.calls.search.length], [true, 0, 0]);
  });
  console.log(`${pass} passed`);
})();
