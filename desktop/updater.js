// Signed updates for the app's page (index.html).
//
// The app checks a manifest (update.json) at an address you control. If it
// lists a newer version, the app downloads the new page, checks its SHA-256,
// and verifies an Ed25519 signature made with YOUR private key against the
// public key built into the app. Anything unsigned, tampered with or older is
// refused. Updates install on the next restart. If an updated page ever fails
// to start, the app falls back to the built-in version and skips that update.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, net } = require("electron");

const SIG_CONTEXT = "profile-vault-update";
const MAX_HTML = 25 * 1024 * 1024;

function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } }
function writeJSON(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

function cmp(a, b) {
  const pa = String(a || "0").split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

class Updater {
  constructor(appDir) {
    this.appDir = appDir;
    this.cfg = readJSON(path.join(appDir, "update-config.json"), {});
    this.dir = path.join(app.getPath("userData"), "updates");
    this.stateFile = path.join(this.dir, "state.json");
    this.sourceFile = path.join(this.dir, "source.json");
    this.status = { state: "idle" };
    this.listeners = new Set();
    this.pubKey = null;
    try { if (this.cfg.publicKey) this.pubKey = crypto.createPublicKey({ key: Buffer.from(this.cfg.publicKey, "base64"), format: "der", type: "spki" }); } catch {}
  }

  get appVersion() { return app.getVersion(); }
  state() { return readJSON(this.stateFile, {}); }
  setState(s) { writeJSON(this.stateFile, s); }

  // Where to look: a saved address (Settings > Updates) wins over the built-in one.
  manifestUrl() { const s = readJSON(this.sourceFile, {}); return String(s.url || this.cfg.manifestUrl || "").trim(); }
  setManifestUrl(url) {
    url = String(url || "").trim();
    if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) throw new Error("The update address must start with https://");
    writeJSON(this.sourceFile, { url });
  }

  signedMessage(m) { return Buffer.from([SIG_CONTEXT, m.version, m.sha256, m.minAppVersion || "0"].join("\n"), "utf8"); }
  verify(m, htmlBuf) {
    if (!this.pubKey) return "This build has no update key.";
    const sha = crypto.createHash("sha256").update(htmlBuf).digest("hex");
    if (sha !== String(m.sha256 || "").toLowerCase()) return "The downloaded file doesn't match the update's checksum.";
    let ok = false;
    try { ok = crypto.verify(null, this.signedMessage(m), this.pubKey, Buffer.from(String(m.signature || ""), "base64")); } catch {}
    return ok ? null : "The update isn't signed with your key, so it was refused.";
  }

  // The page to load: a verified installed update, unless it failed last time.
  pageToLoad() {
    const bundled = path.join(this.appDir, "index.html");
    const st = this.state();
    const bad = new Set(st.bad || []);
    if (st.pending) {
      // Last launch loaded an update but it never said it started. Skip it.
      bad.add(st.pending); st.bad = Array.from(bad); delete st.pending; delete st.installed; this.setState(st);
    }
    const inst = st.installed;
    if (inst && !bad.has(inst.version) && cmp(inst.version, this.appVersion) > 0 && cmp(inst.minAppVersion || "0", this.appVersion) <= 0) {
      const file = path.join(this.dir, "content", "index.html");
      try {
        const buf = fs.readFileSync(file);
        if (!this.verify(inst, buf)) { st.pending = inst.version; this.setState(st); this.loaded = inst.version; return file; }
      } catch {}
    }
    this.loaded = this.appVersion;
    return bundled;
  }
  confirmStarted() { const st = this.state(); if (st.pending) { delete st.pending; this.setState(st); } }
  currentVersion() { return this.loaded || this.appVersion; }

  emit(s) { this.status = s; for (const fn of this.listeners) { try { fn(s); } catch {} } }
  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async fetchBuf(url, limit) {
    const r = await net.fetch(url, { cache: "no-store", redirect: "follow" });
    if (!r.ok) throw new Error("The update server answered " + r.status + ".");
    const ab = await r.arrayBuffer();
    if (ab.byteLength > limit) throw new Error("The update file is too large.");
    return Buffer.from(ab);
  }

  async check(manual) {
    const url = this.manifestUrl();
    if (!url) { this.emit({ state: "not-configured" }); return this.status; }
    if (this.busy) return this.status;
    this.busy = true;
    try {
      this.emit({ state: "checking" });
      const m = JSON.parse((await this.fetchBuf(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), 256 * 1024)).toString("utf8"));
      if (!m || !m.version || !m.url || !m.sha256 || !m.signature) throw new Error("The update information is incomplete.");
      const st = this.state();
      const have = this.currentVersion();
      const ready = st.installed && cmp(st.installed.version, have) > 0 ? st.installed.version : null;
      if (cmp(m.version, have) <= 0 || (st.bad || []).includes(m.version)) { this.emit({ state: ready ? "ready" : "current", version: ready || have, notes: ready ? st.installed.notes : "" }); return this.status; }
      if (ready && cmp(m.version, ready) <= 0) { this.emit({ state: "ready", version: ready, notes: st.installed.notes || "" }); return this.status; }
      if (cmp(m.minAppVersion || "0", this.appVersion) > 0) {
        this.emit({ state: "needs-installer", version: m.version, notes: m.notes || "", installerUrl: /^https:\/\//i.test(m.installerUrl || "") ? m.installerUrl : "" });
        return this.status;
      }
      this.emit({ state: "downloading", version: m.version });
      const htmlUrl = new URL(m.url, url).toString();
      const buf = await this.fetchBuf(htmlUrl, MAX_HTML);
      const err = this.verify(m, buf);
      if (err) throw new Error(err);
      const dest = path.join(this.dir, "content");
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "index.html.tmp"), buf);
      fs.renameSync(path.join(dest, "index.html.tmp"), path.join(dest, "index.html"));
      this.setState(Object.assign(st, { installed: { version: m.version, sha256: m.sha256, signature: m.signature, minAppVersion: m.minAppVersion || "0", notes: m.notes || "" } }));
      this.emit({ state: "ready", version: m.version, notes: m.notes || "" });
    } catch (e) {
      this.emit({ state: "error", error: String(e && e.message || e).slice(0, 200) });
    } finally { this.busy = false; }
    return this.status;
  }

  start() {
    setTimeout(() => this.check(false), 8000);
    setInterval(() => this.check(false), 6 * 60 * 60 * 1000);
  }
}
module.exports = { Updater, cmp, SIG_CONTEXT };
