// Signs update.json for a new Orbit page, the way the publisher's tools/release.mjs does, so the
// "Publish Orbit update" Action can release without the desktop. No dependencies (Node 22+).
//
//   node .github/scripts/publish-update.mjs [--version X.Y.Z]   sign the release (writes update.json)
//   node .github/scripts/publish-update.mjs --check X.Y.Z       wait until apps are served it, and check it
//
// Signing publishes the newest index-X.Y.Z.html when it's newer than update.json. It needs
// release-notes/X.Y.Z.txt next to it (the update notice shown in the app), and fails without it so
// a page never sits on main unpublished by mistake. Everything is read from the committed tree
// (git show HEAD:…), so the hash is of the bytes raw.githubusercontent.com serves.
//
// The key comes from UPDATE_SIGNING_KEY: the publisher's Ed25519 private key. The signature is checked against the public key built
// into the app (update-config.json in the desktop app) before anything is written, so a wrong key
// fails here instead of every installed app refusing the update.
//
// Signing changes update.json only when there's something to publish; each step adds a line to
// $GITHUB_STEP_SUMMARY.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

// Built into the desktop app (update-config.json, publicKey): SPKI DER, base64. ORBIT_UPDATE_PUBLIC_KEY
// replaces it only for tests with a throwaway key.
const APP_PUBLIC_KEY = process.env.ORBIT_UPDATE_PUBLIC_KEY || "MCowBQYDK2VwAyEAjMqbFzE6HEjJ+PZAxJdcRPQutn4Eh6YjedtapiYe48o=";
// Where installed apps look (update-config.json, manifestUrl).
const MANIFEST_URL = process.env.ORBIT_MANIFEST_URL || "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/update.json";
const SIG_CONTEXT = "profile-vault-update";   // updater.js signs [context, version, sha256, minAppVersion]
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_HTML = 25 * 1024 * 1024;              // updater.js refuses bigger pages

const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const cmp = (a, b) => {   // same comparison as the app's updater.js
  const pa = String(a || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0), pb = String(b || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
};
const signedMessage = (m) => Buffer.from([SIG_CONTEXT, m.version, m.sha256, m.minAppVersion || "0"].join("\n"), "utf8");
const appKey = () => createPublicKey({ key: Buffer.from(APP_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
const summary = (line) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const fail = (msg) => { console.log(`::error::${msg}`); process.exit(1); };

// The private key in whichever form it was pasted: PEM, JWK, a JSON file holding one of those, or
// base64/hex of PKCS#8 DER or the bare 32-byte seed. UPDATE_SIGNING_KEY_PASSPHRASE opens an
// encrypted PEM.
function privateKey(raw) {
  const text = String(raw || "").trim();
  if (!text) fail("Add the UPDATE_SIGNING_KEY secret (see the top of .github/workflows/publish-update.yml): the private key tools/release.mjs signs with.");
  if (/-----BEGIN PUBLIC KEY-----/.test(text) && !/PRIVATE KEY-----/.test(text)) fail("UPDATE_SIGNING_KEY holds a public key. It needs the private key tools/release.mjs signs with.");
  const passphrase = process.env.UPDATE_SIGNING_KEY_PASSPHRASE || undefined;
  const seed = (b) => Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), b]);   // PKCS#8 header for an Ed25519 seed
  const found = [];
  const collect = (v, depth) => {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("{")) {
        if (depth < 6) try { collect(JSON.parse(t), depth + 1); } catch {}
      } else if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) found.push(() => createPrivateKey({ key: t.replace(/\r/g, ""), format: "pem", passphrase }));
      else if (/^[0-9a-f]+$/i.test(t) && (t.length === 64 || t.length === 96)) {
        const b = Buffer.from(t, "hex");
        found.push(() => createPrivateKey({ key: b.length === 32 ? seed(b) : b, format: "der", type: "pkcs8" }));
      } else if (/^[A-Za-z0-9+/=_\-\s]+$/.test(t)) {
        const b = Buffer.from(t.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
        found.push(() => createPrivateKey({ key: b.length === 32 ? seed(b) : b, format: "der", type: "pkcs8", passphrase }));
      }
    } else if (v && typeof v === "object" && depth < 6) {
      if (v.kty) found.push(() => createPrivateKey({ key: v, format: "jwk" }));
      else for (const x of Object.values(v)) collect(x, depth + 1);
    }
  };
  collect(text, 0);
  for (const t of found) {
    try { const k = t(); if (k.asymmetricKeyType === "ed25519") return k; } catch {}
  }
  fail("UPDATE_SIGNING_KEY isn't an Ed25519 private key. Paste the whole key tools/release.mjs signs with (a PEM, JWK or JSON key file, or its base64); for a password-protected key also add UPDATE_SIGNING_KEY_PASSPHRASE.");
}

function sign_() {
  const i = process.argv.indexOf("--version");
  const asked = (i > 0 ? process.argv[i + 1] : process.env.VERSION || "").trim();
  if (asked && !VERSION_RE.test(asked)) fail(`"${asked}" isn't a version like 1.9.52.`);
  const current = JSON.parse(git("show", "HEAD:update.json").toString("utf8"));
  const files = git("ls-tree", "-r", "--name-only", "HEAD").toString("utf8").split("\n");
  const pages = new Set(files.map((f) => (f.match(/^index-(\d+\.\d+\.\d+)\.html$/) || [])[1]).filter(Boolean));
  const noted = new Set(files.map((f) => (f.match(/^release-notes\/(\d+\.\d+\.\d+)\.txt$/) || [])[1]).filter(Boolean));
  const version = asked || [...pages].sort(cmp).pop() || "";
  const skip = (reason) => { summary(`Nothing published: ${reason}`); process.exit(0); };
  if (!pages.has(version)) fail(`index-${version}.html isn't on main.`);
  if (cmp(version, current.version) <= 0) skip(`${version} isn't newer than ${current.version}, the version update.json already points to.`);
  if (!noted.has(version)) fail(`index-${version}.html is newer than update.json (${current.version}) but has no release-notes/${version}.txt, so it wasn't published. Add that file with a sentence or two for the app's update notice.`);

  const notes = git("show", `HEAD:release-notes/${version}.txt`).toString("utf8").replace(/\s+/g, " ").trim();
  if (!notes) fail(`release-notes/${version}.txt is empty.`);
  if (notes.length > 1000) fail(`release-notes/${version}.txt is ${notes.length} characters; keep it under 1000.`);
  const html = git("show", `HEAD:index-${version}.html`);
  if (html.length > MAX_HTML) fail(`index-${version}.html is ${html.length} bytes; apps refuse pages over ${MAX_HTML}.`);
  const m = {
    version,
    url: `index-${version}.html`,
    sha256: createHash("sha256").update(html).digest("hex"),
    signature: "",
    minAppVersion: current.minAppVersion || "0",
    notes,
    installerUrl: current.installerUrl || "",
    publishedAt: new Date().toISOString(),
  };
  const key = privateKey(process.env.UPDATE_SIGNING_KEY);
  m.signature = sign(null, signedMessage(m), key).toString("base64");
  // The same check every installed app makes; stop here if it would refuse this.
  if (!verify(null, signedMessage(m), appKey(), Buffer.from(m.signature, "base64"))) {
    fail("UPDATE_SIGNING_KEY isn't the key Orbit trusts: its public half doesn't match the one built into the app, so every app would refuse this update. Use the key tools/release.mjs signs with.");
  }
  writeFileSync("update.json", JSON.stringify(m, null, 2) + "\n");
  summary(`Signed Orbit ${version} (sha256 ${m.sha256}). Notes: ${notes}`);
}

// After the push: fetch the manifest and page the way the app does, until the new version is served.
async function check(version) {
  if (!VERSION_RE.test(version || "")) fail("--check needs a version like 1.9.52.");
  const tries = Number(process.env.CHECK_TRIES) || 36, wait = Number(process.env.CHECK_WAIT_MS) || 10000;
  let last = "";
  for (let n = 1; n <= tries; n++) {
    try {
      const m = await (await fetch(MANIFEST_URL + "?t=" + Date.now(), { cache: "no-store" })).json();
      if (m.version === version) {
        const page = Buffer.from(await (await fetch(new URL(m.url, MANIFEST_URL), { cache: "no-store" })).arrayBuffer());
        const sha = createHash("sha256").update(page).digest("hex");
        if (sha !== m.sha256) fail(`The served ${m.url} hashes to ${sha}, not ${m.sha256}: apps would refuse it.`);
        if (!verify(null, signedMessage(m), appKey(), Buffer.from(String(m.signature), "base64"))) fail("The served update.json isn't signed with the key the app trusts: apps would refuse it.");
        summary(`Apps are now served Orbit ${version}, and it passes the app's own checks. They install it on their next restart.`);
        return;
      }
      last = m.version;
    } catch (e) { last = String(e && e.message || e); }
    if (n < tries) await new Promise((r) => setTimeout(r, wait));
  }
  console.log(`::warning::raw.githubusercontent.com still serves ${last} after ${Math.round(tries * wait / 60000)} minutes. It usually catches up within about 5; nothing to redo.`);
  summary(`Not served yet (still ${last}); raw.githubusercontent.com can take a few minutes.`);
}

if (process.argv[2] === "--check") await check(process.argv[3]);
else sign_();
