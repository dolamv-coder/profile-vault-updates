// Reads order-confirmation emails straight from an inbox over IMAP.
// Runs in Electron's main process (Node), so it can open the TLS socket a web
// page can't. Returns raw email text; the app parses and de-duplicates orders.
"use strict";
const tls = require("tls");
const net = require("net");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const trust = require("./trust");

// Subjects that look like order confirmations, and ones that never are.
// Order-related mail: confirmations AND status updates (canceled, shipped, delivered).
// The app page reads each one and decides whether it's a new order or a status change.
const CONFIRM = /(order|thanks?\s+for\s+(your\s+order|shopping)|here'?s\s+your\s+order|thank\s+you\s+for\s+(your\s+order|placing|shopping)|cancel(l?ed|lation)|shipped|on\s+(its|the)\s+way|out\s+for\s+delivery|delivered|arriv(es|ing|ed)|refund)/i;
const SKIP = /(prescription|pharmacy|survey|write\s+a\s+review|rate\s+your|pre-?order\s+[a-z]+\s+now|%\s*off|\bsale\b|\bdeals?\b)/i;
const GMAIL_QUERY = '(subject:(order OR "thanks for your order" OR "order confirmation" OR "thank you for your order" OR canceled OR cancelled OR cancellation OR shipped OR delivered OR "on its way" OR "out for delivery" OR arriving OR refund) OR "here\'s your order" OR "thank you for placing") -subject:(prescription OR survey)';

function friendlyError(e) {
  const m = String((e && (e.responseText || e.message)) || e || "");
  if (m === "SEARCH_FAILED") return "The mail server couldn't search this inbox, so its emails weren't moved.";
  if (m === "MOVE_FAILED") return "The mail server didn't move the emails to Trash, so they're where they were.";
  if (e && e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|LOGIN failed/i.test(m))
    return "Sign-in failed. Use an app password, not your normal password, and check the email address.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "Couldn't find that mail server. Check the provider or server name.";
  if (/ECONNREFUSED|ETIMEDOUT|timed? ?out/i.test(m)) return "Couldn't connect to the mail server. Check your internet connection and the port.";
  if (/certificate|self.signed|TLS/i.test(m)) return CERT_ERROR;
  return m.slice(0, 160) || "Something went wrong talking to the mail server.";
}
const CERT_ERROR = "The mail server's security certificate couldn't be verified.";

// After a certificate error, look at the certificate this computer was given, without signing in
// (nothing is sent), and say what's wrong in plain words. Pages from 1.9.61 build their advice on it.
function certProblem(cfg) {
  return new Promise((resolve) => {
    let s = null;
    const done = (v) => { try { s && s.destroy(); } catch {} resolve(v); };
    try {
      s = tls.connect(Object.assign({ host: cfg.host, port: Number(cfg.port) || 993, servername: net.isIP(cfg.host) ? undefined : cfg.host, rejectUnauthorized: false }, trust.tlsOptions()), () => {
        try {
          const leaf = s.getPeerCertificate(true);
          let top = leaf;
          const seen = new Set();
          while (top && top.issuerCertificate && top.issuerCertificate !== top && !seen.has(top.fingerprint256)) { seen.add(top.fingerprint256); top = top.issuerCertificate; }
          done({ code: String(s.authorizationError || ""), leaf, top });
        } catch { done(null); }
      });
      s.setTimeout(8000, () => done(null));
      s.on("error", () => done(null));
    } catch { done(null); }
  });
}
function certDetail(p, cfg) {
  if (!p || !p.code || !p.leaf || !p.leaf.valid_to) return "";
  const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const from = new Date(p.leaf.valid_from), to = new Date(p.leaf.valid_to), now = new Date();
  if (/EXPIRED|NOT_YET_VALID/i.test(p.code) && (now < from || now > to))
    return ` It's valid from ${day(from)} to ${day(to)}, but this computer's clock says ${day(now)}. Check the date and time.`;
  if (/ALTNAME|HOSTNAME|IP_ADDRESS/i.test(p.code)) {
    const names = String(p.leaf.subjectaltname || "").split(/,\s*/).map(n => n.replace(/^(DNS|IP Address):/i, "")).filter(Boolean).slice(0, 3).join(", ")
      || (p.leaf.subject && p.leaf.subject.CN) || "another server";
    return ` It's for ${names}, not ${cfg.host}. Check the server name.`;
  }
  const top = p.top || p.leaf, self = top === p.leaf && top.issuer && top.subject && top.issuer.CN === top.subject.CN;
  if (self) return " It's self-signed. That's usually antivirus email scanning, a VPN or a work network checking secure connections.";
  const who = top.issuer && (top.issuer.CN || top.issuer.O);
  return who ? ` It was issued by “${String(who).slice(0, 80)}”. That's usually antivirus email scanning, a VPN or a work network checking secure connections.` : "";
}
const DROPPED = "The connection to the mail server dropped before it was secure. Check your network connection and try again.";
async function explain(e, cfg) {
  const msg = friendlyError(e);
  if (msg !== CERT_ERROR) return msg;
  try {
    const p = await certProblem(cfg);
    // Any error mentioning TLS lands here, a dropped connection too. A certificate that checks out isn't it.
    if (p && !p.code) return DROPPED;
    return msg + certDetail(p, cfg);
  } catch { return msg; }
}

function client(cfg) {
  return new ImapFlow({
    host: cfg.host, port: Number(cfg.port) || 993,
    secure: cfg.secure !== false,
    auth: { user: cfg.email, pass: cfg.password },
    logger: false, emitLogs: false,
    socketTimeout: 60000, greetingTimeout: 20000, connectionTimeout: 20000,
    tls: cfg.insecureTls ? { rejectUnauthorized: false } : trust.tlsOptions()
  });
}
// Every connection waits until Windows' trusted certificates have been read (once, at startup).
async function open(cfg) { await trust.ready; return client(cfg); }

async function test(cfg) {
  const c = await open(cfg);
  try {
    await c.connect();
    const lock = await c.getMailboxLock("INBOX");
    let count = 0;
    try { count = c.mailbox && c.mailbox.exists || 0; } finally { lock.release(); }
    await c.logout();
    return { ok: true, messages: count };
  } catch (e) {
    try { c.close(); } catch {}
    return { ok: false, error: await explain(e, cfg) };
  }
}

// Product photos from an order email's HTML: skips tracking pixels, logos,
// social icons and banners. The page picks the best match for the item.
const NOT_PRODUCT = /(logo|icon|spacer|pixel|track|beacon|facebook|twitter|instagram|pinterest|youtube|tiktok|social|badge|app-?store|google-?play|banner|header|footer|divider|arrow|rating|stars?\b|\.gif(\?|$))/i;
function productImages(html) {
  const out = [];
  const attr = (tag, name) => { const m = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i")); return m ? (m[2] ?? m[3] ?? m[4] ?? "") : ""; };
  for (const tag of String(html || "").match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, "src").replace(/&amp;/g, "&").trim();
    if (!/^https:\/\//i.test(src) || src.length > 1500) continue;
    const alt = attr(tag, "alt").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    const w = parseInt(attr(tag, "width"), 10), h = parseInt(attr(tag, "height"), 10);
    if ((w && w < 40) || (h && h < 40)) continue;
    if (NOT_PRODUCT.test(src) || NOT_PRODUCT.test(alt)) continue;
    if (!out.some(x => x.src === src)) out.push({ src, alt: alt.slice(0, 200) });
    if (out.length >= 12) break;
  }
  return out;
}

// Folders to read: the main one (Gmail keeps archived mail out of INBOX, so
// use "All Mail" there), plus Trash and Spam, which "All Mail" leaves out.
// Order and cancellation emails often end up trashed before a sync runs.
async function pickMailboxes(c, isGmail) {
  let list = [];
  try { list = await c.list(); } catch {}
  const all = isGmail && list.find(b => b.specialUse === "\\All");
  const trash = list.find(b => b.specialUse === "\\Trash") || list.find(b => /(^|\/)(trash|bin|deleted items|deleted messages)$/i.test(b.path));
  const junk = list.find(b => b.specialUse === "\\Junk") || list.find(b => /(^|\/)(spam|junk|junk e-?mail|bulk mail)$/i.test(b.path));
  return [all ? all.path : "INBOX", trash && trash.path, junk && junk.path].filter((p, i, a) => p && a.indexOf(p) === i);
}

async function sync(cfg, onProgress) {
  const progress = (p) => { try { onProgress && onProgress(p); } catch {} };
  const c = await open(cfg);
  const out = [];
  try {
    progress({ phase: "connecting" });
    await c.connect();
    const isGmail = /gmail\.com|googlemail\.com/i.test(cfg.host) || c.capabilities?.has?.("X-GM-EXT-1");
    const boxes = await pickMailboxes(c, isGmail);
    const since = new Date(Date.now() - (Number(cfg.days) || 90) * 86400000);
    let scannedTotal = 0, matched = 0, read = 0;
    for (const [bi, box] of boxes.entries()) {
      let lock;
      // Only the main folder is required; skip Trash/Spam if they can't be opened.
      try { lock = await c.getMailboxLock(box); } catch (e) { if (bi === 0) throw e; continue; }
      try {
        progress({ phase: "searching" });
        let uids;
        if (isGmail) {
          uids = await c.search({ gmraw: GMAIL_QUERY + " after:" + since.toISOString().slice(0, 10).replace(/-/g, "/") }, { uid: true });
        } else {
          uids = await c.search({ since }, { uid: true });
        }
        uids = (uids || []).slice(-1500);
        scannedTotal += uids.length;

        // First pass: headers only, to skip anything that isn't order-related.
        const wanted = [];
        let scanned = 0;
        if (uids.length) {
          for await (const m of c.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
            scanned++;
            const subj = m.envelope?.subject || "";
            if (CONFIRM.test(subj) && !SKIP.test(subj)) wanted.push(m.uid);
            if (scanned % 25 === 0) progress({ phase: "scanning", scanned, total: uids.length });
          }
        }
        matched += wanted.length;
        progress({ phase: "reading", read, total: matched, scanned });

        // Second pass: full text of just the likely orders.
        if (wanted.length) {
          for await (const m of c.fetch(wanted, { uid: true, source: true, envelope: true }, { uid: true })) {
            read++;
            try {
              const mail = await simpleParser(m.source);
              const text = mail.text || (mail.html ? String(mail.html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") : "");
              out.push({
                uid: m.uid,
                mailbox: box,
                from: mail.from?.text || "",
                to: mail.to?.text || "",
                subject: mail.subject || "",
                date: (mail.date || m.envelope?.date || new Date()).toISOString(),
                text: String(text).slice(0, 60000),
                images: productImages(mail.html)
              });
            } catch {}
            if (read % 5 === 0) progress({ phase: "reading", read, total: matched, scanned });
          }
        }
      } finally { lock.release(); }
    }
    progress({ phase: "done", read, total: matched, scanned: scannedTotal });
    return { ok: true, scanned: scannedTotal, matched, emails: out, mailbox: boxes.join(", ") };
  } catch (e) {
    return { ok: false, error: await explain(e, cfg), emails: out };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}

module.exports = { test, sync, friendlyError, CONFIRM, SKIP, CERT_ERROR };
module.exports._cert = { certProblem, certDetail, explain };

// ================= Clean emails =================
// Finds promotional mail (newsletters, sales) so the user can move it to Trash.
// Never selects anything that looks like an order, shipping update, receipt,
// sign-in code or account/security email. Scan only reads; trash only moves
// to the Trash folder (restorable), never permanently deletes.

// Anything matching this is always protected, whoever sent it.
const PROTECT = /(order\s*(#|number|no\.?|confirm|placed|received|status|update|details)|thanks?\s+for\s+(your\s+order|shopping|your\s+purchase)|here'?s\s+your\s+order|thank\s+you\s+for\s+(your\s+order|placing|shopping)|receipt|invoice|your\s+purchase|ship(ped|ping\s+(confirm|update|notice))|has\s+shipped|on\s+(its|the)\s+way|out\s+for\s+delivery|delivered|arriv(es|ing|ed)|tracking|pick\s*up|ready\s+for\s+pickup|refund|return\s+(label|request|received)|cancel(l?ed|lation)|verif(y|ication)|security\s+code|one[\s-]?time|passcode|\bcode\b|sign[\s-]?in|log[\s-]?in|password|2-?step|two[\s-]?factor|account\s+(alert|activity|update|security)|payment|remind(er)?\s+to\s+pay|pay\s+your|\bbill(s|ing)?\b|\bdue\b|past[\s-]?due|overdue|auto[\s-]?pay|statement|polic(y|ies)|premium|renewal|insurance|\bclaim|\bbank|\btax(es)?\b|appointment|reservation|itinerar|prescription)/i;

// In the Spam folder (when the user chooses "clear all of Spam") only these are kept:
// order/shipping mail, so orders aren't lost, and sign-in codes someone may be waiting for.
// Spam is deleted by the provider after 30 days anyway; Trash keeps it restorable just as long.
const SPAM_KEEP = /(order\s*(#|number|no\.?|confirm|placed|received|status|update|details)|here'?s\s+your\s+order|thanks?\s+for\s+(your\s+order|shopping)|has\s+shipped|\bshipped\b|out\s+for\s+delivery|\bdelivered\b|arriv(es|ing|ed)\b|tracking\s+(number|info)|cancel(l?ed|lation)|refund|receipt|verification\s+code|security\s+code|one[\s-]?time\s+(code|pass)|passcode|(log|sign)[\s-]?in\s+code|your\s+code\b|\bOTP\b)/i;

// Senders that send marketing: local part or subdomain says so.
const PROMO_LOCAL = /^(news|newsletter|newsletters|marketing|promo|promos|promotions|offers|deals|sales|specials|email|emails|info|hello|hi|updates|inspiration|shop|store|style|rewards|members|circle|beauty|home)$|news|newsletter|promo|marketing|offers|deals/i;
const PROMO_SUBDOMAIN = /^(em|e|email|emails|mail|mailer|news|newsletter|marketing|promo|offers|click|go|info|m|t|reply|mkt|comms|communications)\./i;

function parseAddr(s) {
  const m = String(s || "").match(/<?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)>?/);
  return m ? m[1].toLowerCase() : "";
}
function looksPromoSender(addr) {
  if (!addr || !addr.includes("@")) return false;
  const [local, domain] = addr.split("@");
  return PROMO_LOCAL.test(local) || PROMO_SUBDOMAIN.test(domain);
}

// Words order mail shares with sales mail ("Your shopping moment has arrived: 48-Hour Flash Sale").
// A subject protected only by one of these is still cleaned when it's plainly a sale naming no order.
const WEAK_PROTECT = /arriv(es|ing|ed)\b|on\s+(its|the)\s+way|pick\s*up/gi;
const PROMO_SUBJECT = /flash\s+sale|\bsale\b|%\s*off|\$\d+\s+off|deals?\s+of\s+the\s+(day|week)|doorbuster|clearance|limited[\s-]time|shop\s+now|shopping\s+moment/i;
const ORDERISH = /\b(orders?|package|parcel|shipment|delivery|purchase|items?)\b/i;
// Survey and review requests, by sender: a survey company, or "survey" in the sender's name or
// address. Cleaned even though they talk about an order ("Your Target Delivery" from Medallia).
const SURVEY_FROM = /(^|[.@])(medallia|qualtrics|surveymonkey|smg360|inmoment|bazaarvoice|powerreviews|yotpo|trustpilot|feefo|questionpro|alchemer)\.com$|survey/i;

// The page can send newer versions of these rules (regex sources), so they can change with a
// page update instead of a new app download. Anything missing or invalid uses the built-in one.
function cleanRules(r) {
  const re = (src, def) => { if (typeof src !== "string" || !src || src.length > 4000) return def; try { return new RegExp(src, "i"); } catch { return def; } };
  r = r || {};
  return { promo: re(r.promoSubject, PROMO_SUBJECT), surveyFrom: re(r.surveyFrom, SURVEY_FROM) };
}
const isSurvey = (name, addr, R) => R.surveyFrom.test(addr || "") || R.surveyFrom.test(name || "");
const isSale = (subject, R) => R.promo.test(subject) && !ORDERISH.test(subject);
// True when the subject is protected by the guard for a reason other than a sale's weak words.
function isProtected(subject, guard, R) {
  if (!guard.test(subject)) return false;
  return guard.test(subject.replace(WEAK_PROTECT, " ")) || !isSale(subject, R);
}
// A forwarded email's body starts with the original "From: Name <addr>" line.
function forwardedFrom(text) {
  const m = String(text || "").match(/From:\s*([^\n<]*?)\s*<\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\s*>/i)
         || String(text || "").match(/From:\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i);
  if (!m) return null;
  return m[2] ? { name: m[1].trim(), addr: m[2].toLowerCase() } : { name: "", addr: m[1].toLowerCase() };
}
const normSubject = (s) => String(s || "").replace(/^\s*((fw|fwd|re)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
const displayName = (fromText) => { const m = String(fromText || "").match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : parseAddr(fromText); };

// Moves messages (by UID) out of the open folder and says how many went. imapflow's messageMove answers false when the
// server refuses, and on a server without MOVE it copies and then deletes even when the copy failed, which would lose
// the emails. So there it copies first and deletes only once the copy worked. Throws MOVE_FAILED when nothing moved.
async function moveMail(c, uids, dest) {
  if (c.capabilities && typeof c.capabilities.has === "function" && !c.capabilities.has("MOVE")) {
    const copied = await c.messageCopy(uids, dest, { uid: true });
    if (!copied) throw new Error("MOVE_FAILED");
    await c.messageDelete(uids, { uid: true, silent: true });
    return copied.uidMap && copied.uidMap.size ? copied.uidMap.size : uids.length;
  }
  const res = await c.messageMove(uids, dest, { uid: true });
  if (!res) throw new Error("MOVE_FAILED");
  return res.uidMap && res.uidMap.size ? res.uidMap.size : uids.length;
}

// "inbox" or "spam". Spam is found by its special-use flag, or by its usual names.
async function resolveFolder(c, which) {
  if (String(which || "inbox").toLowerCase() !== "spam") return { path: "INBOX", spam: false };
  const list = await c.list();
  const box = list.find(b => b.specialUse === "\\Junk") || list.find(b => /(^|\/)(spam|junk|junk e-?mail|bulk mail)$/i.test(b.path));
  if (!box) throw Object.assign(new Error("NO_SPAM_FOLDER"), { noSpam: true });
  return { path: box.path, spam: true };
}

async function scanPromos(cfg, onProgress) {
  const progress = (p) => { try { onProgress && onProgress(p); } catch {} };
  const c = await open(cfg);
  try {
    progress({ phase: "connecting" });
    await c.connect();
    const folder = await resolveFolder(c, cfg.folder);
    const lock = await c.getMailboxLock(folder.path);
    try {
      const uidValidity = String(c.mailbox && c.mailbox.uidValidity || "");
      const guard = folder.spam && cfg.loose ? SPAM_KEEP : PROTECT;
      const R = cleanRules(cfg.rules);
      const since = new Date(Date.now() - (Number(cfg.days) || 30) * 86400000);
      progress({ phase: "searching" });
      let uids = await c.search({ since }, { uid: true });
      uids = (uids || []).slice(-3000);
      const groups = new Map();
      const forwarded = [];
      let scanned = 0, protectedCount = 0;
      // own: the email's own sender's name and address and its subject, as it came (a forward's, not the original's):
      // desktop 14 hands them to the page in env, by UID, so Find in Spam's saved searches are judged as Find in Spam sees them.
      const own = (env) => { const f = ((env && env.from) || [])[0] || {}; return [String(f.name || "").slice(0, 200), String(f.address || "").slice(0, 320), String((env && env.subject) || "").slice(0, 300)]; };
      const add = (uid, senderName, senderAddr, subject, env) => {
        const key = senderAddr + "|" + normSubject(subject).toLowerCase();
        let g = groups.get(key);
        if (!g) { g = { key, sender: senderName || senderAddr, senderAddr, subject: normSubject(subject), uids: [], env: {} }; groups.set(key, g); }
        g.uids.push(uid); g.env[uid] = own(env);
      };
      if (uids.length) {
        for await (const m of c.fetch(uids, { uid: true, envelope: true, headers: ["list-unsubscribe", "precedence", "list-id"] }, { uid: true })) {
          scanned++;
          if (scanned % 50 === 0) progress({ phase: "scanning", scanned, total: uids.length });
          const subject = m.envelope?.subject || "";
          const fromObj = (m.envelope?.from || [])[0] || {};
          const fromAddr = String(fromObj.address || "").toLowerCase();
          const survey = isSurvey(fromObj.name, fromAddr, R);
          if (!survey && isProtected(subject, guard, R)) { protectedCount++; continue; }
          const hdr = m.headers ? m.headers.toString("utf8") : "";
          const bulk = /list-unsubscribe:|precedence:\s*(bulk|list)|list-id:/i.test(hdr);
          if (/^\s*(fw|fwd)\s*:/i.test(subject)) { forwarded.push(m.uid); continue; }
          if (survey || folder.spam || bulk || looksPromoSender(fromAddr)) add(m.uid, fromObj.name || fromAddr, fromAddr, subject, m.envelope);
        }
      }
      // Forwarded mail: read the body to find who originally sent it.
      let read = 0;
      if (forwarded.length) {
        for await (const m of c.fetch(forwarded.slice(-800), { uid: true, source: true, envelope: true }, { uid: true })) {
          read++;
          if (read % 10 === 0) progress({ phase: "reading", read, total: Math.min(forwarded.length, 800), scanned });
          try {
            const mail = await simpleParser(m.source);
            const text = mail.text || String(mail.html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
            const head = String(text).slice(0, 4000);
            const orig = forwardedFrom(head);
            if (!orig) continue;
            const origSubj = (head.match(/Subject:\s*([^\n]+)/i) || [])[1] || m.envelope?.subject || "";
            if (!isSurvey(orig.name, orig.addr, R)) {
              // Protect forwarded orders/shipping/codes by their original subject line and opening text.
              if (isProtected(origSubj, guard, R)) { protectedCount++; continue; }
              // Forwarding drops the mailing-list headers, so a store's plain sale is known by its subject.
              const storeSale = isSale(origSubj, R) && !!retailerOf(orig.addr.split("@")[1]);
              if (!storeSale && guard.test(head.slice(0, 1500))) { protectedCount++; continue; }
              if (!(folder.spam || storeSale || looksPromoSender(orig.addr))) continue;
            }
            add(m.uid, orig.name || orig.addr, orig.addr, origSubj || m.envelope?.subject, m.envelope);
          } catch {}
        }
      }
      const list = Array.from(groups.values()).sort((a, b) => b.uids.length - a.uids.length);
      progress({ phase: "done", scanned });
      return { ok: true, uidValidity, folder: folder.path, spam: folder.spam, scanned: uids.length, protectedCount, groups: list, total: list.reduce((n, g) => n + g.uids.length, 0) };
    } finally { lock.release(); }
  } catch (e) {
    if (e && e.noSpam) return { ok: false, error: "Couldn't find a Spam folder in this inbox." };
    return { ok: false, error: await explain(e, cfg) };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}

async function trashPromos(cfg, uids, uidValidity) {
  uids = (Array.isArray(uids) ? uids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5000);
  if (!uids.length) return { ok: false, error: "Nothing selected." };
  const c = await open(cfg);
  try {
    await c.connect();
    const list = await c.list();
    const trash = list.find(b => b.specialUse === "\\Trash") || list.find(b => /^(\[gmail\]\/)?(trash|bin|deleted items|deleted messages)$/i.test(b.path));
    if (!trash) return { ok: false, error: "Couldn't find a Trash folder in this inbox, so nothing was moved." };
    const folder = await resolveFolder(c, cfg.folder);
    const lock = await c.getMailboxLock(folder.path);
    try {
      // If the mailbox was rebuilt since the scan, message numbers may point elsewhere. Stop.
      if (uidValidity && String(c.mailbox && c.mailbox.uidValidity || "") !== String(uidValidity))
        return { ok: false, error: "The inbox changed since the scan. Scan again, then retry." };
      const moved = await moveMail(c, uids, trash.path);
      return { ok: true, moved, trash: trash.path };
    } finally { lock.release(); }
  } catch (e) {
    if (e && e.noSpam) return { ok: false, error: "Couldn't find a Spam folder in this inbox." };
    return { ok: false, error: await explain(e, cfg) };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}

module.exports.scanPromos = scanPromos;
module.exports.trashPromos = trashPromos;

// ================= Rescue order emails from Spam =================
// Moves order and shipping emails from Spam back to the Inbox, but only when the
// receiving server verified they really came from the store (DMARC pass for the
// store's own domain). Look-alike phishing ("Your Target order...") from other
// domains fails that check and is left in Spam.
const RETAILER_DOMAINS = ["target.com", "walmart.com", "pokemoncenter.com", "pokemon.com", "bestbuy.com", "amazon.com", "costco.com",
  "samsclub.com", "gamestop.com", "apple.com", "homedepot.com", "lowes.com", "nike.com", "footlocker.com", "kohls.com", "macys.com", "ebay.com"];
const retailerOf = (domain) => { const d = String(domain || "").toLowerCase().replace(/\.$/, ""); return RETAILER_DOMAINS.find(r => d === r || d.endsWith("." + r)) || ""; };

// True when the receiving server's Authentication-Results says DMARC passed for this
// retailer's domain. Only the topmost header counts: it's the one our own mail server
// added. Lower ones could have been written by the sender.
function verifiedFrom(authHeaders, fromDomain) {
  const store = retailerOf(fromDomain);
  const top = (authHeaders || []).find(h => /authentication-results:/i.test(h)) || "";
  if (!store || !top) return false;
  const m = top.match(/dmarc=pass\b[^;]*?header\.from=([\w.-]+)/i);
  return !!m && retailerOf(m[1]) === store;
}

async function rescueSpam(cfg) {
  const c = await open(cfg);
  try {
    await c.connect();
    let folder;
    try { folder = await resolveFolder(c, "spam"); } catch (e) { if (e && e.noSpam) return { ok: true, moved: 0, items: [] }; throw e; }
    const lock = await c.getMailboxLock(folder.path);
    try {
      const since = new Date(Date.now() - (Number(cfg.days) || 30) * 86400000);
      const uids = ((await c.search({ since }, { uid: true })) || []).slice(-2000);
      const pick = [], items = [];
      if (uids.length) {
        for await (const m of c.fetch(uids, { uid: true, envelope: true, headers: ["authentication-results"] }, { uid: true })) {
          const subj = m.envelope?.subject || "";
          if (!CONFIRM.test(subj) || SKIP.test(subj)) continue;
          const from = (m.envelope?.from || [])[0] || {};
          const domain = String(from.address || "").split("@")[1] || "";
          const auth = (m.headers ? m.headers.toString("utf8") : "").split(/\r?\n(?=authentication-results:)/i);
          if (!verifiedFrom(auth, domain)) continue;
          pick.push(m.uid); items.push({ from: from.name || from.address || "", subject: subj.slice(0, 140) });
        }
      }
      if (!pick.length) return { ok: true, moved: 0, items: [] };
      return { ok: true, moved: await moveMail(c, pick, "INBOX"), items };
    } finally { lock.release(); }
  } catch (e) {
    return { ok: false, error: await explain(e, cfg) };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}
module.exports.rescueSpam = rescueSpam;
module.exports._rescue = { verifiedFrom, retailerOf };

// ================= Find in Spam (desktop 14, pages from 1.9.136) =================
// listSpam: the Spam folder's emails from cfg.days back (the newest SPAM_LIST_MAX), each with its UID, sender, subject,
// when it came, and which store the receiving server verified it came from (verifiedBy, or ""). The page decides which
// to move, by a search the person typed or one they saved, so what counts can change with a page update.
// spamToInbox: moves those UIDs from Spam to the Inbox, only while the Spam folder is the one listed (its UIDVALIDITY),
// and only the ones still there (gone: how many were moved or deleted since the list).
const SPAM_LIST_MAX = 3000;
// The page shows "From target.com" for a verified one, so here the header must be the mail provider's own: its authserv-id
// (the name before the first ";") belongs to the provider of the IMAP server, or shares the IMAP server's domain. A server
// that writes no Authentication-Results leaves the sender's own, forged one on top, which verifiedFrom alone would trust.
// Microsoft's header has no authserv-id, so outlook.com and Office 365 mail isn't shown as verified.
const AUTH_IDS = [[/(^|\.)(gmail|googlemail|google)\.com$/i, /(^|\.)google\.com$/i], [/(^|\.)(me|mac|icloud|apple)\.com$/i, /(^|\.)(icloud|apple|me)\.com$/i],
  [/(^|\.)(yahoo|aol)\.com$/i, /(^|\.)(yahoo|aol|yahoodns)\.(com|net)$/i], [/(^|\.)(fastmail|messagingengine)\.com$/i, /(^|\.)(messagingengine|fastmail)\.com$/i],
  [/(^|\.)zoho(mail)?\.(com|eu|in)$/i, /(^|\.)zoho(mail)?\.(com|eu|in)$/i]];
const baseDomain = (h) => String(h || "").toLowerCase().replace(/\.$/, "").split(".").slice(-2).join(".");
// The provider's own headers are the leading run whose authserv-id is the provider's (iCloud writes BIMI's, dmarc's, DKIM's and
// SPF's apart, BIMI's on top), and its DMARC result is the first of them with one: a sender's forged "dmarc=pass" under it, even
// claiming the provider's id, doesn't count. A host FAFO doesn't know counts when the id shares its domain (not an IP address).
function verifiedBy(host, authHeaders, fromDomain) {
  const h = String(host || "").toLowerCase(), known = AUTH_IDS.find(([imap]) => imap.test(h));
  const idOf = (x) => (String(x).replace(/^\s*authentication-results:\s*/i, "").split(";")[0] || "").trim().split(/\s+/)[0].toLowerCase();
  const ip = /^[\d.]+$|:/.test(h);
  const ours = (id) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(id) && (known ? known[1].test(id) : !ip && baseDomain(id) === baseDomain(h));
  const run = [];
  for (const x of (authHeaders || []).filter(x => /authentication-results:/i.test(x))) { if (!ours(idOf(x))) break; run.push(x); }
  const dmarc = run.find(x => /\bdmarc=/i.test(x));
  return dmarc && verifiedFrom([dmarc], fromDomain) ? retailerOf(fromDomain) : "";
}
async function listSpamOn(c, cfg) {
  let folder;
  try { folder = await resolveFolder(c, "spam"); } catch (e) { if (e && e.noSpam) return { ok: true, noSpam: true, uidValidity: "", items: [] }; throw e; }
  const lock = await c.getMailboxLock(folder.path);
  try {
    const uidValidity = String(c.mailbox && c.mailbox.uidValidity || "");
    const since = new Date(Date.now() - (Number(cfg.days) || 30) * 86400000);
    const found = await c.search({ since }, { uid: true });
    if (found === false) throw new Error("SEARCH_FAILED");
    const all = found || [], uids = all.slice(-SPAM_LIST_MAX), items = [];
    if (uids.length) {
      for await (const m of c.fetch(uids, { uid: true, envelope: true, internalDate: true, headers: ["authentication-results"] }, { uid: true })) {
        const from = ((m.envelope && m.envelope.from) || [])[0] || {};
        const address = String(from.address || "").slice(0, 320);
        const auth = (m.headers ? m.headers.toString("utf8") : "").split(/\r?\n(?=authentication-results:)/i);
        const when = m.internalDate || (m.envelope && m.envelope.date);
        const at = when ? new Date(when).getTime() : 0;
        items.push({ uid: m.uid, name: String(from.name || "").slice(0, 200), address, subject: String((m.envelope && m.envelope.subject) || "").slice(0, 300),
          at: Number.isFinite(at) ? at : 0, verified: verifiedBy(cfg.host, auth, address.split("@")[1] || "") });
      }
    }
    return { ok: true, uidValidity, folder: folder.path, items, partial: all.length > uids.length };
  } finally { lock.release(); }
}
async function spamToInboxOn(c, uids, uidValidity) {
  let folder;
  try { folder = await resolveFolder(c, "spam"); } catch (e) { if (e && e.noSpam) return { ok: false, error: "Couldn't find a Spam folder in this inbox." }; throw e; }
  const lock = await c.getMailboxLock(folder.path);
  try {
    // If the folder was rebuilt since the list, message numbers may point elsewhere. Stop.
    if (!uidValidity || String(c.mailbox && c.mailbox.uidValidity || "") !== String(uidValidity))
      return { ok: false, error: "The Spam folder changed since the search. Search again, then retry." };
    // Only the ones still in Spam: moved or deleted since the list (by Clean emails, another computer, the email app), a UID
    // is gone, and a move of it would count as moved on a server that doesn't say which moved.
    const found = await c.search({ uid: uids.join(",") }, { uid: true });
    if (found === false) throw new Error("SEARCH_FAILED");
    const there = new Set((found || []).map(Number)), still = uids.filter(u => there.has(u));
    if (!still.length) return { ok: true, moved: 0, gone: uids.length };
    try { return { ok: true, moved: await moveMail(c, still, "INBOX"), gone: uids.length - still.length }; }
    catch (e) {
      if (String(e && e.message) === "MOVE_FAILED") return { ok: false, error: "The mail server didn't move the emails to your Inbox, so they're still in Spam." };
      throw e;
    }
  } finally { lock.release(); }
}
async function listSpam(cfg) {
  const c = await open(cfg);
  try { await c.connect(); return await listSpamOn(c, cfg); }
  catch (e) { return { ok: false, error: await explain(e, cfg) }; }
  finally { try { await c.logout(); } catch { try { c.close(); } catch {} } }
}
async function spamToInbox(cfg, uids, uidValidity) {
  uids = (Array.isArray(uids) ? uids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5000);
  if (!uids.length) return { ok: false, error: "Nothing selected." };
  const c = await open(cfg);
  try { await c.connect(); return await spamToInboxOn(c, uids, uidValidity); }
  catch (e) { return { ok: false, error: await explain(e, cfg) }; }
  finally { try { await c.logout(); } catch { try { c.close(); } catch {} } }
}
module.exports.listSpam = listSpam;
module.exports.spamToInbox = spamToInbox;
module.exports._spam = { listSpamOn, spamToInboxOn, SPAM_LIST_MAX, verifiedBy };

// ================= A canceled order's emails =================
// Moves every email naming one of the given order numbers (its confirmation, the cancellation, shipping
// notes, forwards) to Trash: from the main folder (All Mail on Gmail) and Spam. The server's search finds
// candidates; each is then read and moved only when its subject or text has one of the numbers as a whole
// word and none of the `keep` numbers (orders still in FAFO, so a note about several orders stays). Trash
// keeps them restorable. Order numbers need 6 to 40 letters, digits or dashes, at least 5 of them digits.
const ORDER_NO = /^(?=(?:[^0-9]*[0-9]){5})[A-Za-z0-9-]{6,40}$/;
const orderNoList = (a, max) => Array.from(new Set((Array.isArray(a) ? a : []).map(x => String(x == null ? "" : x).trim().toUpperCase()).filter(n => ORDER_NO.test(n)))).slice(0, max);
// The words of an email that could be order numbers: runs of letters, digits and dashes, and their parts between dashes.
function orderTokens(text) {
  const out = new Set();
  for (const t of String(text || "").toUpperCase().match(/[A-Z0-9-]{6,}/g) || []) {
    out.add(t.replace(/^-+|-+$/g, ""));
    for (const p of t.split("-")) if (p.length >= 6) out.add(p);
  }
  return out;
}
const mailText = (mail) => [mail.subject || "", mail.text || "", String(mail.html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))].join("\n");
const gmDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, "/");

// With a connected client: finds and moves. orders [{no, since: "YYYY-MM-DD"}], keep [numbers].
async function moveOrderMail(c, cfg, orders, keep) {
  const want = new Map();
  for (const o of Array.isArray(orders) ? orders : []) {
    const [no] = orderNoList([o && o.no], 1);
    if (!no) continue;
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(o.since || "")) ? new Date(o.since + "T00:00:00Z") : null;
    const since = at && !isNaN(at) ? new Date(at.getTime() - 3 * 86400000) : new Date(Date.now() - 400 * 86400000);
    if (!want.has(no) || since < want.get(no)) want.set(no, since);
    if (want.size >= 500) break;
  }
  const keepSet = new Set(orderNoList(keep, 50000).filter(n => !want.has(n)));
  const found = {}, empty = { ok: true, moved: 0, found, kept: 0, boxes: [] };
  if (!want.size) return empty;
  const isGmail = /gmail\.com|googlemail\.com/i.test(cfg.host) || c.capabilities?.has?.("X-GM-EXT-1");
  const list = await c.list();
  const trash = list.find(b => b.specialUse === "\\Trash") || list.find(b => /^(\[gmail\]\/)?(trash|bin|deleted items|deleted messages)$/i.test(b.path));
  if (!trash) return { ok: false, error: "Couldn't find a Trash folder in this inbox, so its emails stay where they are." };
  const boxes = (await pickMailboxes(c, isGmail)).filter(p => p !== trash.path);
  const nos = Array.from(want.keys());
  let moved = 0, kept = 0, partial = false;
  const done = [];
  try {
    for (const [bi, box] of boxes.entries()) {
      let lock;
      try { lock = await c.getMailboxLock(box); } catch (e) { if (bi === 0) throw e; continue; }
      try {
        const cand = new Set();
        for (let i = 0; i < nos.length; i += 20) {
          const batch = nos.slice(i, i + 20);
          const since = new Date(Math.min(...batch.map(n => want.get(n).getTime())));
          const uids = isGmail
            ? await c.search({ gmraw: "(" + batch.map(n => '"' + n + '"').join(" OR ") + ") after:" + gmDate(since) }, { uid: true })
            : await c.search({ since, or: batch.flatMap(n => [{ subject: n }, { body: n }]) }, { uid: true });
          if (!Array.isArray(uids)) throw new Error("SEARCH_FAILED");   // imapflow answers false when the server refuses
          for (const u of uids) cand.add(u);
          if (cand.size >= 3000 && i + 20 < nos.length) { partial = true; break; }
        }
        if (cand.size > 3000) partial = true;
        const pick = [];
        if (cand.size) {
          for await (const m of c.fetch(Array.from(cand).slice(0, 3000), { uid: true, source: true }, { uid: true })) {
            try {
              const words = orderTokens(mailText(await simpleParser(m.source)));
              const hits = nos.filter(n => words.has(n));
              if (!hits.length) continue;
              if (keepSet.size && Array.from(words).some(w => keepSet.has(w))) { kept++; continue; }
              pick.push(m.uid);
              hits.forEach(n => { found[n] = (found[n] || 0) + 1; });
            } catch {}
          }
        }
        if (pick.length) moved += await moveMail(c, pick, trash.path);
        done.push(box);
      } finally { lock.release(); }
    }
  } catch (e) {
    // What moved before the failure is said too, so the page counts it.
    return { ok: false, error: await explain(e, cfg), moved, found, kept, boxes: done, partial };
  }
  // partial: more emails matched than one run reads (3000 a folder), so some are left where they were.
  return { ok: true, moved, found, kept, boxes: done, trash: trash.path, partial };
}
async function trashOrderMail(cfg, orders, keep) {
  const c = await open(cfg);
  try {
    await c.connect();
    return await moveOrderMail(c, cfg, orders, keep);
  } catch (e) {
    return { ok: false, error: await explain(e, cfg) };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}
module.exports.trashOrderMail = trashOrderMail;
module.exports._orderMail = { moveOrderMail, orderTokens, orderNoList, ORDER_NO, moveMail };
module.exports._clean = { PROTECT, SPAM_KEEP, looksPromoSender, forwardedFrom, normSubject, cleanRules, isSurvey, isSale, isProtected };

// ================= An order's emails on to a buyer (desktop 15, pages from 1.9.139) =================
// The seller's own FAFO sends orders to one of its buyers' FAFOs (Send to buyer, 1.9.138), and the owner asked for the
// store's emails about each one to go to that buyer's inbox too (2026-11-07: "the email gets forwarded to that specific
// buyer too"; their buyers are close friends who may see the accounts' emails). findOrderMail finds them, as moveOrderMail
// does, in the main folder (All Mail on Gmail, never Sent or Trash) and Spam: read and kept only when one of the numbers is a
// whole word in it and none of `others` is (another buyer's order, or the seller's own, which a note about several orders
// would carry along), never one FAFO forwarded itself (FWD_MARK) or one sent from this mailbox. Each comes with an id from its
// Message-ID (`mailKey`), the same in every folder and on every computer, so the page forwards each email once. forwardMail
// sends the ones the page picked, by folder, UID and UIDVALIDITY, from this mailbox over SMTP with the same app password, as a
// mail app's Forward writes it: "Fwd:", the original's From, Date, Subject and To, then its own HTML with its pictures and
// attachments. The page asks the license worker before each send, so two computers on one mailbox don't both send it.
// Only the store's own emails go: never a reply (a buyer answering a forward, or anyone's "Re:"), an auto-reply or a bounce
// (`notStoreMail`), nor one from an address in `skipFrom` (the buyers' own), which would go back to them or, once an order
// moves to another buyer, to that one; and a bounce quoting a forward (FWD_MARK anywhere in it) never goes again, so a
// mistyped address can't loop. The newest are kept when more match than one call returns, after the ids the buyer has.
const crypto = require("crypto");
const FWD_MARK = "X-FAFO-Forwarded";
// The first line of a forward's text: the buyer's own FAFO reads it and leaves the email to the seller's alerts.
const FWD_NOTE = "Forwarded by FAFO from your seller's inbox.";
const FWD_FIND_MAX = 500, FWD_SEND_MAX = 50, FWD_ATTACH_MAX = 15 * 1024 * 1024;
const FWD_TO = /^[^\s@,;:<>()"'\\]+@[^\s@,;:<>()"'\\]+\.[A-Za-z]{2,}$/;
const fwdAddr = (to) => { const t = String(to || "").trim(); return t.length <= 200 && FWD_TO.test(t) ? t : ""; };
const FWD_REPLY = /^\s*(re|aw|sv|vs|antw|odp|r|ynt|res)\s*(\[\d+\])?\s*:/i;
const FWD_AUTO = /^\s*(automatic reply|auto(matic)?[- ]?(reply|response)|autoreply|out of (the )?office|ooo\b|away from|undeliverable|undelivered|not delivered|delivery (status notification|failure|failed|has failed|incomplete|delayed)|mail delivery (failed|failure|subsystem)|returned mail|returned to sender|failure notice|message (not delivered|delivery failure|blocked)|could not be delivered|warning: could not send)/i;
const headerText = (mail, name) => { const v = mail.headers && mail.headers.get(name); return v == null ? "" : typeof v === "string" ? v : String(v.value || v.text || (Array.isArray(v) ? v.join(" ") : "")); };
// A reply, auto-reply or bounce, not the store's own email.
function notStoreMail(mail, raw) {
  const from = mail.from && mail.from.value && mail.from.value[0] ? String(mail.from.value[0].address || "").toLowerCase() : "";
  if (/^(mailer-daemon|postmaster|mail-daemon|bounces?\+?[^@]*|mailerdaemon)@/.test(from)) return true;
  const subject = String(mail.subject || "");
  if (FWD_REPLY.test(subject) || FWD_AUTO.test(subject)) return true;
  const ct = mail.headers && mail.headers.get("content-type");
  if (ct && /^multipart\/report$/i.test(String(ct.value || ct))) return true;
  if (/^auto-(replied|notified)/i.test(headerText(mail, "auto-submitted").trim())) return true;
  if (mail.headers && (mail.headers.has("x-autoreply") || mail.headers.has("x-autorespond") || mail.headers.has("x-autoresponse"))) return true;
  if (/^auto[_-]?reply$/i.test(headerText(mail, "precedence").trim())) return true;
  if (/fafo-fwd\./i.test(headerText(mail, "in-reply-to") + " " + headerText(mail, "references"))) return true;   // answers a forward
  if (raw && /x-fafo-forwarded\s*:/i.test(raw)) return true;   // one FAFO forwarded, or a bounce quoting one
  return false;
}
function mailKey(mail) {
  const from = mail.from && mail.from.value && mail.from.value[0] ? String(mail.from.value[0].address || "").toLowerCase() : "";
  const k = String(mail.messageId || "").trim() || [from, mail.date ? mail.date.toISOString() : "", mail.subject || ""].join("|");
  return crypto.createHash("sha256").update(k).digest("hex").slice(0, 24);
}
// opts: skipFrom [addresses] (the buyers' own, whose mail never goes), skip [ids] (the ones the buyer has, left out before
// FWD_FIND_MAX counts). orders come newest first, so the 500 kept are the newest.
async function findOrderMailOn(c, cfg, orders, others, opts) {
  const want = new Map();
  const skipFrom = new Set((Array.isArray(opts && opts.skipFrom) ? opts.skipFrom : []).slice(0, 5000).map(a => String(a || "").trim().toLowerCase()).filter(Boolean));
  const skipIds = new Set((Array.isArray(opts && opts.skip) ? opts.skip : []).slice(0, 20000).map(String));
  for (const o of Array.isArray(orders) ? orders : []) {
    const [no] = orderNoList([o && o.no], 1);
    if (!no) continue;
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(o.since || "")) ? new Date(o.since + "T00:00:00Z") : null;
    const since = at && !isNaN(at) ? new Date(at.getTime() - 3 * 86400000) : new Date(Date.now() - 120 * 86400000);
    if (!want.has(no) || since < want.get(no)) want.set(no, since);
    if (want.size >= 500) break;
  }
  const otherSet = new Set(orderNoList(others, 50000).filter(n => !want.has(n)));
  const found = [], seen = new Set(), checked = [], self = String(cfg.email || "").trim().toLowerCase();
  let mixed = 0, partial = false;
  if (!want.size) return { ok: true, found, mixed, partial, boxes: [], checked };
  const isGmail = /gmail\.com|googlemail\.com/i.test(cfg.host) || c.capabilities?.has?.("X-GM-EXT-1");
  const list = await c.list();
  const trash = list.find(b => b.specialUse === "\\Trash") || list.find(b => /(^|\/)(trash|bin|deleted items|deleted messages)$/i.test(b.path));
  const boxes = (await pickMailboxes(c, isGmail)).filter(p => !trash || p !== trash.path);
  const nos = Array.from(want.keys()), done = [];
  for (const [bi, box] of boxes.entries()) {
    let lock;
    try { lock = await c.getMailboxLock(box); } catch (e) { if (bi === 0) throw e; continue; }
    try {
      const cand = new Set();
      for (let i = 0; i < nos.length; i += 20) {
        const batch = nos.slice(i, i + 20);
        const since = new Date(Math.min(...batch.map(n => want.get(n).getTime())));
        const uids = isGmail
          ? await c.search({ gmraw: "(" + batch.map(n => '"' + n + '"').join(" OR ") + ") after:" + gmDate(since) + " -in:sent" }, { uid: true })
          : await c.search({ since, or: batch.flatMap(n => [{ subject: n }, { body: n }]) }, { uid: true });
        if (!Array.isArray(uids)) throw new Error("SEARCH_FAILED");
        for (const u of uids) cand.add(u);
        if (cand.size >= 3000 && i + 20 < nos.length) { partial = true; break; }
      }
      if (cand.size > 3000) partial = true;
      const uidValidity = String(c.mailbox && c.mailbox.uidValidity || "");
      if (cand.size) {
        // The newest 3000 (UIDs grow as mail comes in). Their headers first: what the buyer has, what isn't the store's, and
        // what this mailbox or a buyer sent is never downloaded, so a run every few minutes reads only what's new (Gmail
        // stops IMAP for a day past 2.5 GB downloaded).
        const uids = Array.from(cand).map(Number).sort((a, b) => b - a).slice(0, 3000), need = [];
        for await (const m of c.fetch(uids, { uid: true, headers: true }, { uid: true })) {
          try {
            const raw = Buffer.isBuffer(m.headers) ? m.headers.toString("latin1") : String(m.headers || "");
            const head = await simpleParser(raw.replace(/(\r?\n)*$/, "\r\n\r\n"));
            if (head.headers && head.headers.has(FWD_MARK.toLowerCase())) continue;   // one FAFO forwarded
            const from = head.from && head.from.value && head.from.value[0] ? String(head.from.value[0].address || "").toLowerCase() : "";
            if (from && (from === self || skipFrom.has(from))) continue;   // sent from this mailbox, or by a buyer
            if (notStoreMail(head, raw)) continue;
            const id = mailKey(head);
            if (seen.has(id) || skipIds.has(id)) continue;   // found in a folder before, or the buyer has it
            need.push(m.uid);
          } catch {}
        }
        if (need.length) for await (const m of c.fetch(need, { uid: true, source: true }, { uid: true })) {
          let id = "";
          try {
            const mail = await simpleParser(m.source);
            id = mailKey(mail);
            if (seen.has(id) || skipIds.has(id)) continue;
            const from = mail.from && mail.from.value && mail.from.value[0] ? String(mail.from.value[0].address || "").toLowerCase() : "";
            // A bounce quoting a forward in its body: said (checked), so the page leaves it out of the next searches. One that
            // names no order here as a whole word, or another order too, isn't: that can change (its other order sent to this
            // buyer too), and the next search reads it again.
            if (notStoreMail(mail, Buffer.isBuffer(m.source) ? m.source.toString("latin1") : String(m.source || ""))) { checked.push(id); continue; }
            const words = orderTokens(mailText(mail));
            const hits = nos.filter(n => words.has(n));
            if (!hits.length) continue;
            if (otherSet.size && Array.from(words).some(w => otherSet.has(w))) { mixed++; continue; }
            seen.add(id);
            found.push({ id, no: hits, folder: box, uid: m.uid, uidValidity, subject: String(mail.subject || "").slice(0, 200), date: mail.date && !isNaN(mail.date) ? mail.date.toISOString() : "", from, bi });
          } catch {}
        }
      }
      done.push(box);
    } finally { lock.release(); }
  }
  // The newest FWD_FIND_MAX, then oldest first, so the buyer's inbox reads in order.
  const older = (a, b) => String(a.date).localeCompare(String(b.date)) || a.bi - b.bi || a.uid - b.uid;
  found.sort((a, b) => older(b, a));
  if (found.length > FWD_FIND_MAX) { partial = true; found.length = FWD_FIND_MAX; }
  found.sort(older);
  found.forEach(f => { delete f.bi; });
  return { ok: true, found, mixed, partial, boxes: done, checked: Array.from(new Set(checked)).slice(0, 3000) };
}
// The email as a mail app forwards it.
const fwdEsc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
function forwardOf(mail, from, to, id) {
  const who = (a) => (a && a.text) || "";
  const head = [["From", who(mail.from)], ["Date", mail.date && !isNaN(mail.date) ? mail.date.toUTCString() : ""], ["Subject", mail.subject || ""], ["To", who(mail.to)]].filter(([, v]) => v);
  const subject = /^\s*fwd?\s*:/i.test(mail.subject || "") ? String(mail.subject) : "Fwd: " + (mail.subject || "");
  let body = mail.html ? String(mail.html) : `<pre style="white-space:pre-wrap;font-family:inherit">${fwdEsc(mail.text || "")}</pre>`;
  const styles = (body.match(/<style[\s\S]*?<\/style>/gi) || []).join("");
  body = body.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<\/?(?:html|body)\b[^>]*>/gi, "");
  const html = `${styles}<div style="font-family:Arial,sans-serif;font-size:13px">---------- Forwarded message ---------<br>${head.map(([k, v]) => `${k}: ${fwdEsc(v)}`).join("<br>")}</div><br>${body}`;
  const plain = mail.text || String(mail.html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  const text = `${FWD_NOTE}\n\n---------- Forwarded message ---------\n${head.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${plain}`;
  let size = 0;
  const attachments = [];
  for (const a of mail.attachments || []) {
    const n = a.content ? a.content.length : 0;
    if (size + n > FWD_ATTACH_MAX) continue;   // a mailbox takes about 25 MB a message
    size += n;
    attachments.push({ filename: a.filename || undefined, content: a.content, contentType: a.contentType, cid: a.cid || undefined, contentDisposition: a.contentDisposition === "inline" ? "inline" : "attachment" });
  }
  // Its own Message-ID says it's a forward, so a reply to it (In-Reply-To, References) is never forwarded.
  const domain = (String(from || "").split("@")[1] || "fafo.invalid").replace(/[^A-Za-z0-9.-]/g, "") || "fafo.invalid";
  const messageId = `<fafo-fwd.${String(id).replace(/[^0-9a-f]/gi, "")}.${crypto.randomBytes(6).toString("hex")}@${domain}>`;
  return { from, to, subject, html, text, attachments, messageId, headers: { [FWD_MARK]: id }, references: mail.messageId || undefined };
}
// The SMTP server of the IMAP server's provider: its known one, or smtp. in place of imap., on 465 then 587.
function smtpServers(host) {
  const h = String(host || "").toLowerCase();
  const known = [[/gmail\.com$|googlemail\.com$/, "smtp.gmail.com", 465], [/(^|\.)mail\.me\.com$|icloud\.com$/, "smtp.mail.me.com", 587],
    [/yahoo\.com$/, "smtp.mail.yahoo.com", 465], [/aol\.com$/, "smtp.aol.com", 465], [/outlook\.com$|office365\.com$|hotmail\.com$|live\.com$/, "smtp-mail.outlook.com", 587],
    [/fastmail\.com$/, "smtp.fastmail.com", 465], [/zoho\.com$/, "smtp.zoho.com", 465], [/gmx\.(com|net)$/, "mail.gmx.com", 587]];
  for (const [re, server, port] of known) if (re.test(h)) return [{ host: server, port }];
  const server = /^imap\./.test(h) ? h.replace(/^imap\./, "smtp.") : h;
  return [{ host: server, port: 465 }, { host: server, port: 587 }];
}
function smtpTransport(cfg, s) {
  const nodemailer = require("nodemailer");
  // One connection and one sign-in for the whole call (pool), not one a message.
  return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, requireTLS: s.port !== 465, pool: true, maxConnections: 1, maxMessages: 100,
    auth: { user: cfg.email, pass: cfg.password }, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000,
    tls: cfg.insecureTls ? { rejectUnauthorized: false } : Object.assign({ servername: s.host }, trust.tlsOptions()) });
}
const smtpAuthFailed = (e) => !!e && (e.code === "EAUTH" || /\b535\b|authentication|Username and Password not accepted/i.test(String(e.response || e.message || "")));
// Sending limits and throttling (Gmail's daily quota, 421 and 45x answers, "too many"), as opposed to one email the server
// won't take: the rest would be refused the same way, and trying each one only keeps the mailbox throttled longer.
const SMTP_LIMIT = /\b5\.4\.5\b|\b4\.7\.\d+\b|quota|rate.?limit|too many|limit exceeded|sending limit|try again later|temporarily (deferred|rejected|blocked)/i;
const smtpLimited = (e) => !!e && (Number(e.responseCode) === 421 || (Number(e.responseCode) >= 450 && Number(e.responseCode) < 460) || SMTP_LIMIT.test(String(e.response || "")));
// What stops the rest of a call: signing in, the connection, the buyer's address refused (every one goes there), a limit.
const smtpStops = (e) => smtpAuthFailed(e) || smtpLimited(e) || !!e && (e.code === "EENVELOPE" || /ECONNREFUSED|ECONNRESET|ECONNECTION|ETIMEDOUT|ESOCKET|ENOTFOUND|EAI_AGAIN|ETLS/i.test(String(e.code || e.message || "")));
function smtpError(e) {
  const m = String((e && (e.response || e.message)) || e || "");
  if (/basic authentication is disabled|5\.7\.139/i.test(m)) return "This mail provider doesn't let apps send email with an app password, so FAFO can't forward from this inbox.";
  if (smtpLimited(e)) return "The mail server is limiting how much this inbox sends, so FAFO stopped forwarding from it for now: " + m.slice(0, 120);
  if (e && e.code === "EENVELOPE") return "The mail server refused the buyer's address: " + m.slice(0, 120);
  if (smtpAuthFailed(e)) return "The mail server didn't let FAFO send from this inbox. Use an app password, not your normal password.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "Couldn't find this inbox's outgoing mail server.";
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|timed? ?out/i.test(m)) return "Couldn't connect to this inbox's outgoing mail server.";
  if (/certificate|self.signed|TLS/i.test(m)) return CERT_ERROR;
  return m.slice(0, 160) || "The mail server didn't send the email.";
}
// With a connected IMAP client and send(message) (one SMTP connection, opened by the caller): items [{id, folder, uid,
// uidValidity}], each sent only while its folder's UIDVALIDITY is the one found and the email there is still that one. res
// ({sent, failed, gone}) fills as it goes, so what was sent before a failure that stops the rest is still said.
async function forwardMailOn(c, cfg, items, to, send, res) {
  const out = res || { sent: [], failed: [], gone: [] }, { sent, failed, gone } = out;
  const byFolder = new Map();
  for (const it of (Array.isArray(items) ? items : []).slice(0, FWD_SEND_MAX)) {
    if (!it || !it.id || !it.folder || !(Number(it.uid) > 0)) continue;
    if (!byFolder.has(it.folder)) byFolder.set(it.folder, []);
    byFolder.get(it.folder).push(it);
  }
  for (const [folder, list] of byFolder) {
    let lock;
    try { lock = await c.getMailboxLock(folder); } catch { list.forEach(it => gone.push(it.id)); continue; }
    try {
      const uv = String(c.mailbox && c.mailbox.uidValidity || "");
      const ok = list.filter(it => String(it.uidValidity) === uv);
      list.filter(it => String(it.uidValidity) !== uv).forEach(it => gone.push(it.id));
      const byUid = new Map(), seen = new Set();
      for (const it of ok) { if (byUid.has(Number(it.uid))) gone.push(it.id); else byUid.set(Number(it.uid), it); }   // one email a UID
      if (byUid.size) {
        const sources = [];
        for await (const m of c.fetch(Array.from(byUid.keys()), { uid: true, source: true }, { uid: true })) sources.push(m);
        for (const m of sources) {
          const it = byUid.get(Number(m.uid)); if (!it) continue;
          seen.add(it.id);
          let mail;
          try { mail = await simpleParser(m.source, { keepCidLinks: true }); } catch { failed.push({ id: it.id, error: "FAFO couldn't read this email." }); continue; }
          if (mailKey(mail) !== it.id) { gone.push(it.id); continue; }   // another email has that number now
          try { await send(forwardOf(mail, cfg.email, to, it.id)); sent.push(it.id); }
          catch (e) {
            failed.push({ id: it.id, error: smtpError(e) });
            if (smtpStops(e)) { if (e && typeof e === "object") e.fafoSmtp = true; throw e; }   // the rest would fail the same way
          }
        }
      }
      Array.from(byUid.values()).filter(it => !seen.has(it.id)).forEach(it => gone.push(it.id));   // deleted or moved since
    } finally { lock.release(); }
  }
  return Object.assign(out, { ok: true });
}
async function findOrderMail(cfg, orders, others, opts) {
  const c = await open(cfg);
  try {
    await c.connect();
    return await findOrderMailOn(c, cfg, orders, others, opts);
  } catch (e) {
    return { ok: false, error: await explain(e, cfg) };
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
  }
}
// opts.transport (tests only): nodemailer transport options in place of the inbox's SMTP server.
async function forwardMail(cfg, items, to, opts) {
  const dest = fwdAddr(to);
  if (!dest) return { ok: false, error: "That isn't an email address FAFO can forward to." };
  if (!Array.isArray(items) || !items.length) return { ok: true, sent: [], failed: [], gone: [] };
  await trust.ready;
  // The SMTP server first: one that can't be reached or signed in to stops here, before the mailbox is read.
  let tx = null, lastErr = null;
  for (const s of opts && opts.transport ? [null] : smtpServers(cfg.host)) {
    const t = s ? smtpTransport(cfg, s) : require("nodemailer").createTransport(opts.transport);
    try { if (s) await t.verify(); tx = t; break; }
    catch (e) { lastErr = e; try { t.close(); } catch {} if (smtpAuthFailed(e)) break; }
  }
  if (!tx) return { ok: false, error: smtpError(lastErr), smtp: true, limited: smtpLimited(lastErr) || undefined };
  const c = await open(cfg);
  const out = { sent: [], failed: [], gone: [] };
  try {
    await c.connect();
    await forwardMailOn(c, cfg, items, dest, (msg) => tx.sendMail(msg), out);
  } catch (e) {
    const smtp = !!(e && e.fafoSmtp);
    return Object.assign(out, { ok: false, error: smtp ? smtpError(e) : await explain(e, cfg), limited: smtpLimited(e) || undefined });
  } finally {
    try { await c.logout(); } catch { try { c.close(); } catch {} }
    try { tx.close(); } catch {}
  }
  return out;
}
module.exports.findOrderMail = findOrderMail;
module.exports.forwardMail = forwardMail;
module.exports._forward = { findOrderMailOn, forwardMailOn, forwardOf, mailKey, smtpServers, smtpError, smtpStops, smtpLimited, notStoreMail, fwdAddr, FWD_MARK, FWD_NOTE, FWD_SEND_MAX };

