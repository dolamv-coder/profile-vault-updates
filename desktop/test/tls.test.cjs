// imap-sync.js's inbox test against a local IMAP server over TLS that presents the kinds of certificate
// seen in the field for imap.gmail.com: a normal one, one re-signed by antivirus (with and without its
// root in the chain), a self-signed one, an expired one, one not valid yet and one for another server.
// run.mjs makes the certificates and starts this with NODE_EXTRA_CA_CERTS set to the "public" root,
// standing in for the public authorities Node already trusts. imap.gmail.com points at 127.0.0.1 in
// this process only.
"use strict";
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const dns = require("dns");

const CERTS = process.env.CERT_DIR;
const HOST = "imap.gmail.com";
const lookup = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (host !== HOST) return lookup.apply(this, arguments);
  if (typeof opts === "function") cb = opts;
  const all = opts && opts.all;
  process.nextTick(() => all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
};

const imap = require("../imap-sync.js");
const trust = require("../trust.js");
const read = (f) => fs.readFileSync(path.join(CERTS, f), "utf8");
const GOOD = "abcdefghijklmnop";
let failed = 0, passed = 0;
const ok = (cond, name, got) => { if (cond) passed++; else failed++; console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n     got: " + JSON.stringify(got)}`); };

// Just enough IMAP for the inbox test: greeting, LOGIN, SELECT INBOX, LOGOUT.
function server(name, chain) {
  const cert = read(`${name}.pem`) + (chain ? read(`${chain}.pem`) : "");
  const srv = tls.createServer({ key: read(`${name}.key`), cert }, (sock) => {
    sock.setEncoding("utf8");
    sock.on("error", () => {});
    sock.write("* OK [CAPABILITY IMAP4rev1] ready\r\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = line.match(/^(\S+)\s+(\S+)\s*(.*)$/); if (!m) continue;
        const [, tag, cmd, rest] = m, C = cmd.toUpperCase();
        if (C === "LOGIN") sock.write(rest.trim().split(/\s+/).pop().replace(/^"|"$/g, "") === GOOD ? `${tag} OK Logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
        else if (C === "SELECT" || C === "EXAMINE") sock.write(`* 5 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n${tag} OK [READ-WRITE] done\r\n`);
        else if (C === "LIST") sock.write(`* LIST () "/" "INBOX"\r\n${tag} OK done\r\n`);
        else if (C === "LOGOUT") { sock.write(`* BYE\r\n${tag} OK done\r\n`); sock.end(); }
        else sock.write(`${tag} OK done\r\n`);
      }
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv)));
}
async function inboxTest(name, pw, chain) {
  const srv = await server(name, chain);
  try { return await imap.test({ email: "me@gmail.com", password: pw, host: HOST, port: srv.address().port }); }
  finally { srv.close(); }
}
const SIGN_IN = /^Sign-in failed/;
const CERT = imap.CERT_ERROR;

(async () => {
  await trust.ready;
  ok(trust.count() === 0 && Object.keys(trust.tlsOptions()).length === 0, "off Windows: no extra roots, Node's defaults are used", trust.tlsOptions());

  // Reading roots: PowerShell's output may wrap lines, repeat certificates or carry other text.
  const av = read("av.pem"), pub = read("public.pem");
  const body = (pem) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const wrapped = `noise\r\n-----BEGIN CERTIFICATE-----\r\n${body(av).match(/.{1,80}/g).join("\r\n")}\r\n-----END CERTIFICATE-----\r\n` + av + "-----BEGIN CERTIFICATE-----\nnot base64!\n-----END CERTIFICATE-----\n";
  const parsed = trust.parse(wrapped);
  ok(parsed.length === 1 && parsed[0].replace(/\s+/g, "") === av.replace(/\s+/g, ""), "parse: one certificate from wrapped, repeated and broken blocks", parsed.length);
  ok(trust.parse(tls.rootCertificates.slice(0, 3).join("\n")).length === 0, "parse: roots Node already has are left out");
  ok(trust.use(["-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"]) === 0 && Object.keys(trust.tlsOptions()).length === 0, "use: a list that can't be loaded leaves Node's defaults");

  // Without Windows' roots, as in 1.9.49 and on a PC with nothing re-signing.
  trust.use([]);
  let r = await inboxTest("good", "wrong-password");
  ok(!r.ok && SIGN_IN.test(r.error), "normal certificate, wrong password: the password message", r);
  r = await inboxTest("good", GOOD);
  ok(r.ok && r.messages === 5, "normal certificate, right password: connects", r);
  r = await inboxTest("intercepted", GOOD);
  ok(!r.ok && r.error === `${CERT} It was issued by “Avast Mail Shield Root (test copy)”. That's usually antivirus email scanning, a VPN or a work network checking secure connections.`, "re-signed by antivirus: names who issued it", r);
  r = await inboxTest("intercepted", GOOD, "av");
  ok(!r.ok && /issued by “Avast Mail Shield Root \(test copy\)”/.test(r.error), "re-signed, with the antivirus root in the chain: names it too", r);
  r = await inboxTest("selfsigned", GOOD);
  ok(!r.ok && r.error === `${CERT} It's self-signed. That's usually antivirus email scanning, a VPN or a work network checking secure connections.`, "self-signed certificate: says so", r);
  r = await inboxTest("expired", GOOD);
  ok(!r.ok && /^The mail server's security certificate couldn't be verified\. It's valid from Jan 1, 2024 to Jan 1, 2025, but this computer's clock says [A-Z][a-z]{2} \d{1,2}, \d{4}\. Check the date and time\.$/.test(r.error), "expired (clock ahead): gives the dates and the clock", r);
  r = await inboxTest("future", GOOD);
  ok(!r.ok && /It's valid from Jan 1, 2099 to Jan 1, 2100, but this computer's clock says/.test(r.error), "not valid yet (clock behind): same", r);
  r = await inboxTest("wrongname", GOOD);
  ok(!r.ok && r.error === `${CERT} It's for mail.example.com, not imap.gmail.com. Check the server name.`, "certificate for another server: names it", r);
  // Errors that only mention TLS (a dropped connection) used to be called certificate errors too.
  let srv = await server("good");
  r = await imap._cert.explain(new Error("Client network socket disconnected before secure TLS connection was established"), { host: HOST, port: srv.address().port });
  srv.close();
  ok(/^The connection to the mail server dropped before it was secure\. Check your network connection/.test(r), "a dropped connection with a certificate that checks out: says so, not \"certificate\"", r);
  srv = await server("intercepted");
  r = await imap._cert.explain(new Error("self-signed certificate in certificate chain"), { host: HOST, port: srv.address().port });
  srv.close();
  ok(r.startsWith(CERT) && /issued by/.test(r), "a real certificate error still says certificate", r);

  // With the antivirus root trusted by Windows (what this version reads at startup).
  ok(trust.use(trust.parse(av)) === 1 && trust.tlsOptions().ca.length > tls.rootCertificates.length, "use: Windows' roots are added to Node's list");
  ok(trust.tlsOptions().ca.some(p => p.replace(/\s+/g, "") === pub.replace(/\s+/g, "")), "use: certificates from NODE_EXTRA_CA_CERTS are kept");
  r = await inboxTest("intercepted", "wrong-password");
  ok(!r.ok && SIGN_IN.test(r.error), "re-signed by a root Windows trusts, wrong password: gets to the password check", r);
  r = await inboxTest("intercepted", GOOD);
  ok(r.ok && r.messages === 5, "re-signed by a root Windows trusts, right password: connects", r);
  r = await inboxTest("good", GOOD);
  ok(r.ok, "normal certificate still connects with Windows' roots added", r);
  r = await inboxTest("wrongname", GOOD);
  ok(!r.ok && /It's for mail\.example\.com/.test(r.error), "the server's name is still checked", r);
  r = await inboxTest("expired", GOOD);
  ok(!r.ok && /Check the date and time/.test(r.error), "dates are still checked", r);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
