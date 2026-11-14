// The IMAP client for POST /inbox/test (page 1.9.149; the owner, 2026-11-14: "how come I can't test the connection while on
// the website?"). A browser can't sign in to email, so the web version's Test asks this worker to: it connects to the mail
// server over TLS (port 993, implicit TLS only, no STARTTLS), signs in as the desktop's imapflow does, opens INBOX read-only
// (EXAMINE) and signs out, all within one deadline. It keeps nothing and logs nothing: no console.* in this file.
//
//   imapSignIn({to: {hostname, port}, email, password, ms}) → {ok: true, messages?} | {ok: false, why, text}
//
// why: auth (a NO to the sign-in), blocked (the provider wants a sign-in in a browser), server (* BYE, a temporary or
// throttling NO, BAD, the connection dropped after the greeting), account (signed in, INBOX won't open), connect (no TLS
// connection), timeout, not-imap (not an IMAP greeting, PREAUTH, or past the size caps) and method (no password sign-in).
// text: a NO or BAD's words (or a BYE's), without control characters, 200 characters at most; never the greeting's (Gmail's
// names the client's address). It never throws, and never puts the email or password in an error, a result or a log.
import { connect } from "cloudflare:sockets";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });
const LINE_MAX = 8 * 1024, BYTES_MAX = 64 * 1024;
const CRLF = enc.encode("\r\n");
const TEMP_CODES = new Set(["UNAVAILABLE", "INUSE", "LIMIT", "SERVERBUG", "OVERQUOTA"]);
const TEMP_WORDS = /temporar|try again|too many|exceeded|throttl|unavailable|maintenance|later\b/i;
const BLOCKED_WORDS = /web ?login required|(log|sign) ?in (via|through|with|using) (your |a )?(web )?browser/i;

// What ends a sign-in early: one of the kinds above and the server's words (never anything of the request's).
class Stop {
  constructor(why, text = "") { this.why = why; this.text = text; }
}
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return enc.encode(btoa(s));
};
// An IMAP string: quoted when it's printable ASCII, else a synchronizing literal of its UTF-8 bytes (never LITERAL+).
const printable = (s) => /^[\x20-\x7e]*$/.test(s);
const quoted = (s) => enc.encode('"' + s.replace(/[\\"]/g, "\\$&") + '"');

export async function imapSignIn({ to, email, password, ms }) {
  let socket = null, reader = null, writer = null, timer = null;
  let stage = "connect", greeted = false, dead = false, n = 0;
  const late = new Promise((_, no) => { timer = setTimeout(() => { dead = true; no(new Stop("timeout")); }, ms); });
  late.catch(() => {});
  const within = (p) => Promise.race([p, late]);

  // Lines, read as bytes: a line ends at CRLF and is decoded on its own; a {n} or {n+} at its end is followed by n bytes,
  // folded into it, so literal data never reads as a tagged line. 8 KB a line and a literal, 64 KB in all.
  let buf = new Uint8Array(0), total = 0, lastBye = "";
  const more = async () => {
    const { value, done } = await within(reader.read());
    if (done) { dead = true; throw greeted ? new Stop("server", lastBye) : new Stop("not-imap"); }
    total += value.byteLength;
    if (total > BYTES_MAX) { dead = true; throw new Stop("not-imap"); }
    buf = join(buf, value);
  };
  const crlfAt = () => { for (let i = 0; i + 1 < buf.length; i++) if (buf[i] === 13 && buf[i + 1] === 10) return i; return -1; };
  const line = async () => {
    let out = "";
    for (;;) {
      let i;
      while ((i = crlfAt()) < 0) {
        if (buf.length > LINE_MAX) { dead = true; throw new Stop("not-imap"); }
        await more();
      }
      if (i > LINE_MAX) { dead = true; throw new Stop("not-imap"); }
      const l = dec.decode(buf.subarray(0, i));
      buf = buf.slice(i + 2);
      out += l;
      const lit = /\{(\d+)\+?\}$/.exec(l);
      if (!lit) return out;
      const size = Number(lit[1]);
      if (!(size <= LINE_MAX)) { dead = true; throw new Stop("not-imap"); }
      while (buf.length < size) await more();
      out += dec.decode(buf.subarray(0, size));
      buf = buf.slice(size);
    }
  };
  const write = (bytes) => within(writer.write(bytes));
  const tag = () => "a" + (++n);
  let capsSeen = null;   // while asking for CAPABILITY: hears each * CAPABILITY line's list
  // Reads up to the tagged answer to `t` (or, with `cont`, a continuation line first), skipping untagged lines: the last
  // * BYE's words are kept for a stream that ends, and `exists` hears each * n EXISTS.
  const answer = async (t, { cont = false, exists = null } = {}) => {
    const re = new RegExp("^" + t + " (OK|NO|BAD)\\b ?(?:\\[([^\\]]*)\\] ?)?(.*)$", "i");
    for (;;) {
      const l = await line();
      if (cont && l.startsWith("+")) return { cont: true };
      const m = re.exec(l);
      if (m) {
        const bracket = m[2] || "";
        return { status: m[1].toUpperCase(), code: (bracket.trim().split(/\s+/)[0] || "").toUpperCase(),
          text: clean((bracket ? "[" + bracket + "] " : "") + m[3]) };
      }
      if (/^\* BYE\b/i.test(l)) lastBye = clean(l.slice(5));
      else if (exists) { const x = /^\* (\d+) EXISTS\b/i.exec(l); if (x) exists(x[1]); }
      else if (/^\* CAPABILITY\b/i.test(l) && capsSeen) capsSeen(l.slice(13));
    }
  };
  const logout = async () => {
    if (!greeted || dead) return;
    let wait;
    const t = tag();
    const run = (async () => { await write(enc.encode(t + " LOGOUT\r\n")); await answer(t); })();
    run.catch(() => {});
    try { await Promise.race([run, new Promise((ok) => { wait = setTimeout(ok, 1000); })]); } catch {}
    clearTimeout(wait);
  };

  try {
    // 1. A TLS connection: `opened` resolves once the handshake is done. Every way it fails reads the same from here, so
    //    it's told by the stage, never by its message.
    try { socket = connect(to, { secureTransport: "on", allowHalfOpen: false }); }
    catch { throw new Stop("connect"); }
    socket.closed.catch(() => {});
    socket.opened.catch(() => {});
    try { await within(socket.opened); }
    catch (e) { throw e instanceof Stop ? e : new Stop("connect"); }
    stage = "greeting";
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();

    // 2. The greeting. Nothing is sent before a * OK.
    const g = await line();
    if (/^\* BYE\b/i.test(g)) { dead = true; throw new Stop("server", clean(g.slice(5))); }
    if (!/^\* OK\b/i.test(g)) throw new Stop("not-imap");
    greeted = true;
    stage = "session";

    // 3. Capabilities: the greeting's, else asked for.
    let capText = (/\[CAPABILITY ([^\]]*)\]/i.exec(g) || [])[1];
    if (capText === undefined) {
      capText = "";
      const t = tag();
      capsSeen = (c) => { capText += " " + c; };
      await write(enc.encode(t + " CAPABILITY\r\n"));
      await answer(t);
      capsSeen = null;
    }
    const caps = new Set(capText.toUpperCase().split(/\s+/).filter(Boolean));

    // 4. The sign-in, as imapflow does it: AUTHENTICATE PLAIN, else AUTHENTICATE LOGIN, else the LOGIN command unless
    //    LOGINDISABLED. A tagged answer where a + was expected is the answer.
    const t = tag();
    let r;
    if (caps.has("AUTH=PLAIN")) {
      const token = b64(enc.encode("\0" + email + "\0" + password));
      if (caps.has("SASL-IR")) {
        await write(join(enc.encode(t + " AUTHENTICATE PLAIN "), token, CRLF));
        r = await answer(t);
      } else {
        await write(enc.encode(t + " AUTHENTICATE PLAIN\r\n"));
        r = await answer(t, { cont: true });
        if (r.cont) { await write(join(token, CRLF)); r = await answer(t); }
      }
    } else if (caps.has("AUTH=LOGIN")) {
      await write(enc.encode(t + " AUTHENTICATE LOGIN\r\n"));
      r = await answer(t, { cont: true });
      if (r.cont) {
        await write(join(b64(enc.encode(email)), CRLF));
        r = await answer(t, { cont: true });
        if (r.cont) { await write(join(b64(enc.encode(password)), CRLF)); r = await answer(t); }
      }
    } else if (caps.has("LOGINDISABLED")) {
      throw new Stop("method");
    } else {
      await write(enc.encode(t + " LOGIN "));
      const args = [email, password];
      for (let i = 0; i < args.length && !r; i++) {
        if (printable(args[i])) await write(quoted(args[i]));
        else {
          const bytes = enc.encode(args[i]);
          await write(enc.encode("{" + bytes.length + "}\r\n"));
          const c = await answer(t, { cont: true });
          if (!c.cont) { r = c; break; }
          await write(bytes);
        }
        await write(i === 0 ? enc.encode(" ") : CRLF);
      }
      if (!r) r = await answer(t);
    }
    if (r.status === "NO") {
      if (r.code === "WEBALERT" || BLOCKED_WORDS.test(r.text)) throw new Stop("blocked", r.text);
      if (TEMP_CODES.has(r.code) || TEMP_WORDS.test(r.text)) throw new Stop("server", r.text);
      throw new Stop("auth", r.text);
    }
    if (r.status !== "OK") throw new Stop("server", r.text);

    // 5. INBOX, read-only, and how many emails it has.
    const e = tag();
    let count = null;
    await write(enc.encode(e + " EXAMINE INBOX\r\n"));
    const x = await answer(e, { exists: (v) => { count = v; } });
    if (x.status !== "OK") throw new Stop("account", x.text);
    await logout();
    const messages = count === null ? NaN : Number(count);
    return Number.isSafeInteger(messages) ? { ok: true, messages } : { ok: true };
  } catch (e) {
    if (e instanceof Stop) {
      await logout();
      return { ok: false, why: e.why, text: e.text || "" };
    }
    dead = true;
    return { ok: false, why: stage === "connect" ? "connect" : stage === "greeting" ? "not-imap" : "server", text: "" };
  } finally {
    clearTimeout(timer);
    if (reader) reader.cancel().catch(() => {});
    if (writer) try { writer.releaseLock(); } catch {}
    // Never awaited: a TLS handshake the server never answered leaves close() pending for ever. workerd still sends FIN.
    if (socket) try { socket.close().catch(() => {}); } catch {}
  }
}
