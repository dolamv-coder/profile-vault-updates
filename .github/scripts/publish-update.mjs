// Signs update.json for a new Orbit page, the way the publisher's tools/release.mjs does, so the
// "Publish Orbit update" Action can release without the desktop. No dependencies (Node 20+).
//
//   node .github/scripts/publish-update.mjs [--version X.Y.Z]   sign the release (writes update.json)
//   node .github/scripts/publish-update.mjs --verify            the same checks, no key and no writing
//   node .github/scripts/publish-update.mjs --check X.Y.Z [web,desktop]   wait until they're served it, and check it
//
// There are two feeds, signed the same way (since 2026-10-11): update.json for installed apps (the desktop app, and
// the license worker's /mirror copy of it) and web-update.json for the web version (the web worker at app.fafoaco.com
// reads it). The newest index-X.Y.Z.html goes into each feed that's older than it, except that update.json is left as it
// is while channels.json says "desktop": "paused" (the owner paused desktop updates on 2026-10-11); setting it to
// "follow" brings installed apps up to the newest page. A new page needs release-notes/X.Y.Z.txt next to it (the
// update notice shown in the app), and fails without it so a page never sits on main unpublished by mistake. Each run
// also checks that the pages both feeds point to are still on main unchanged and properly signed, because apps
// refuse them otherwise. Everything is read from the committed tree (git show HEAD:…), so the hash is of the bytes
// raw.githubusercontent.com serves.
//
// The key comes from UPDATE_SIGNING_KEY: the publisher's Ed25519 private key. The signature is
// checked against the public key built into the app (update-config.json in the desktop app) before
// anything is written, so a wrong key fails here instead of every installed app refusing the update.
//
// Signing changes a feed only when there's something to publish to it. With PICK_OUT set, --verify
// writes the version it would publish (or nothing) to that file. Each run adds a line to
// $GITHUB_STEP_SUMMARY.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

// Built into the desktop app (update-config.json, publicKey): SPKI DER, base64. ORBIT_UPDATE_PUBLIC_KEY
// replaces it only for tests with a throwaway key.
const APP_PUBLIC_KEY = process.env.ORBIT_UPDATE_PUBLIC_KEY || "MCowBQYDK2VwAyEAjMqbFzE6HEjJ+PZAxJdcRPQutn4Eh6YjedtapiYe48o=";
// Where installed apps look (update-config.json, manifestUrl), and where the web version looks (web-worker's UPDATE_URL).
const MANIFEST_URL = process.env.ORBIT_MANIFEST_URL || "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/update.json";
const WEB_MANIFEST_URL = process.env.ORBIT_WEB_MANIFEST_URL || "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/web-update.json";
// The web version itself: its HEAD / answers the release it serves (x-orbit-version). Checked after a web release, as a warning only.
const WEB_APP_URL = process.env.ORBIT_WEB_APP_URL ?? "https://app.fafoaco.com/";
// The feeds: file, who reads it, and its address.
const FEEDS = { desktop: { file: "update.json", who: "installed apps", url: MANIFEST_URL }, web: { file: "web-update.json", who: "the web version", url: WEB_MANIFEST_URL } };
const SIG_CONTEXT = "profile-vault-update";   // updater.js signs [context, version, sha256, minAppVersion]
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_HTML = 25 * 1024 * 1024;              // updater.js refuses bigger pages

const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const cmp = (a, b) => {   // same comparison as the app's updater.js
  const pa = String(a || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0), pb = String(b || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
};
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const signedMessage = (m) => Buffer.from([SIG_CONTEXT, m.version, m.sha256, m.minAppVersion || "0"].join("\n"), "utf8");
const appKey = () => createPublicKey({ key: Buffer.from(APP_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
const appAccepts = (m) => { try { return verify(null, signedMessage(m), appKey(), Buffer.from(String(m.signature || ""), "base64")); } catch { return false; } };
const summary = (line) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const fail = (msg) => { console.log(`::error::${msg}`); process.exit(1); };
const SETUP = "In Settings → Environments → release, under Deployment branches choose Selected branches and add main, then Add environment secret UPDATE_SIGNING_KEY with the whole private key file tools/release.mjs signs with. Then use Run workflow on the Publish Orbit update page of the Actions tab.";

// The private key in whichever form it was pasted: PEM, JWK, a JSON file holding one of those, or
// base64/hex of PKCS#8 DER or the bare 32-byte seed. UPDATE_SIGNING_KEY_PASSPHRASE opens an
// encrypted key.
function privateKey(raw) {
  const text = String(raw || "").trim();
  if (!text) fail(`The UPDATE_SIGNING_KEY secret isn't set up. ${SETUP}`);
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

// A feed on main must still describe what main serves, or apps (and the web version) refuse it.
function checkLive(current, file = "update.json") {
  const u = String(current.url || "");
  if (!/^index-\d+\.\d+\.\d+\.html$/.test(u)) return;   // an absolute URL is served from somewhere else
  let live = null;
  try { live = git("show", `HEAD:${u}`); } catch {}
  if (!live) fail(`${file} points to ${u}, which isn't on main any more (removed or reverted?), so it can't be downloaded. Put it back, or publish a newer version.`);
  if (sha256(live) !== String(current.sha256 || "").toLowerCase()) {
    fail(`${u} changed after it was released as ${current.version}, so apps that haven't updated refuse it (checksum mismatch) and apps that have never get the change. Undo that change, and put it in a new index-X.Y.Z.html with release-notes/X.Y.Z.txt instead.`);
  }
  if (!appAccepts(current)) fail(`${file} (${current.version}) isn't signed with the key the app trusts, so it's refused. Publish it again, from this Action or by signing on the desktop.`);
}

// channels.json, required: {"desktop": "paused", "version": "1.9.112", "sha256": "<its page's>", "feedSha256": "<update.json's
// bytes'>"} holds installed apps on that release: update.json has to stay byte for byte what it was, so a copied,
// re-signed or edited feed (another minAppVersion, installerUrl, url or notes) can't reach them either. {"desktop":
// "follow"} lets them follow each release. Anything else fails, rather than taking a typo for "follow". The web version
// always follows. Returns null when following, else the held {version, sha256, feedSha256}.
const CHANNEL_KEYS = new Set(["desktop", "version", "sha256", "feedSha256", "note"]);
function desktopHold() {
  const shape = 'It holds {"desktop": "paused", "version": "X.Y.Z", "sha256": "<update.json\'s sha256>", "feedSha256": "<sha256 of update.json itself>"} or {"desktop": "follow"}.';
  let raw = null;
  try { raw = git("show", "HEAD:channels.json").toString("utf8"); } catch { fail(`channels.json isn't on main. ${shape}`); }
  let c;
  try { c = JSON.parse(raw); } catch { fail(`channels.json isn't valid JSON. ${shape}`); }
  if (!c || typeof c !== "object" || Array.isArray(c)) fail(`channels.json isn't a JSON object. ${shape}`);
  const extra = Object.keys(c).filter((k) => !CHANNEL_KEYS.has(k));
  if (extra.length) fail(`channels.json has ${extra.map((k) => JSON.stringify(k)).join(", ")}, which it doesn't know. ${shape}`);
  if (c.desktop === "follow") return null;
  if (c.desktop !== "paused") fail(`channels.json's "desktop" is ${JSON.stringify(c.desktop)}; it has to be "paused" or "follow".`);
  if (!VERSION_RE.test(String(c.version || "")) || !/^[0-9a-f]{64}$/i.test(String(c.sha256 || "")) || !/^[0-9a-f]{64}$/i.test(String(c.feedSha256 || ""))) fail(`channels.json pauses desktop updates without saying which release installed apps stay on. ${shape}`);
  return { version: c.version, sha256: c.sha256.toLowerCase(), feedSha256: c.feedSha256.toLowerCase() };
}

function sign_(dryRun) {
  const i = process.argv.indexOf("--version");
  const asked = (i > 0 ? process.argv[i + 1] || "" : process.env.VERSION || "").trim();
  if (asked && !VERSION_RE.test(asked)) fail(`"${asked}" isn't a version like 1.9.52.`);
  const read = (file) => JSON.parse(git("show", `HEAD:${file}`).toString("utf8"));
  const desk = read("update.json");
  let web;
  try { web = read("web-update.json"); } catch { fail("web-update.json isn't on main. The web version (app.fafoaco.com) reads it: start it as a copy of update.json."); }
  const hold = desktopHold(), paused = !!hold;
  // While paused, update.json is byte for byte the held release: any other feed (copied, re-signed or edited) would reach
  // installed apps.
  if (hold && (desk.version !== hold.version || String(desk.sha256 || "").toLowerCase() !== hold.sha256 || sha256(git("show", "HEAD:update.json")) !== hold.feedSha256)) {
    fail(`Desktop updates are paused (channels.json), so update.json has to stay exactly as it was on ${hold.version} (the file's sha256 ${hold.feedSha256}), but it's been changed (it names ${desk.version}). Put update.json back. Installed apps get a new version only once the owner sets "desktop" to "follow" in channels.json; until then releases go to web-update.json alone.`);
  }
  const files = git("ls-tree", "-r", "--name-only", "HEAD").toString("utf8").split("\n");
  const pages = new Set(files.map((f) => (f.match(/^index-(\d+\.\d+\.\d+)\.html$/) || [])[1]).filter(Boolean));
  const noted = new Set(files.map((f) => (f.match(/^release-notes\/(\d+\.\d+\.\d+)\.txt$/) || [])[1]).filter(Boolean));
  const version = asked || [...pages].sort(cmp).pop() || "";
  const pick = (v) => { if (process.env.PICK_OUT) writeFileSync(process.env.PICK_OUT, v); };
  const notesOf = (v) => git("show", `HEAD:release-notes/${v}.txt`).toString("utf8").replace(/\s+/g, " ").trim();

  if (!pages.has(version)) fail(`index-${version}.html isn't on main.`);
  const held = paused ? ` Desktop updates are paused (channels.json), so installed apps stay on ${hold.version}.` : "";
  const toDesk = !paused && cmp(version, desk.version) > 0, toWeb = cmp(version, web.version) > 0;
  // A feed this run doesn't replace has to still describe what main serves, as it was signed (a newer release fixes the
  // one it replaces). So a paused update.json is checked on every run.
  if (!toDesk) checkLive(desk, "update.json");
  if (!toWeb) checkLive(web, "web-update.json");
  if (!toDesk && !toWeb) {
    for (const m of new Set([desk, web])) {
      if (noted.has(m.version) && notesOf(m.version) !== m.notes) {
        console.log(`::warning::release-notes/${m.version}.txt changed after ${m.version} was released. Apps only show notes with a new version, so put the text in the next version's notes.`);
      }
    }
    summary(`Nothing to publish: ${version} isn't newer than what the web version (${web.version}) and installed apps (${desk.version}) have (checked: their pages on main are unchanged and signed with the app's key).${held}`);
    pick("");
    process.exit(0);
  }
  if (!noted.has(version)) fail(`index-${version}.html is newer than ${toWeb ? `web-update.json (${web.version})` : `update.json (${desk.version})`} but has no release-notes/${version}.txt, so it wasn't published. Add that file with a sentence or two for the app's update notice.`);

  const notes = notesOf(version);
  if (!notes) fail(`release-notes/${version}.txt is empty.`);
  if (notes.length > 1000) fail(`release-notes/${version}.txt is ${notes.length} characters; keep it under 1000.`);
  const html = git("show", `HEAD:index-${version}.html`);
  if (html.length > MAX_HTML) fail(`index-${version}.html is ${html.length} bytes; apps refuse pages over ${MAX_HTML}.`);
  const where = toDesk && toWeb ? "the web version and installed apps" : toWeb ? "the web version only" : "installed apps (the web version has it already)";
  if (dryRun) {
    summary(`Ready to publish Orbit ${version} to ${where} (sha256 ${sha256(html)}).${toWeb && !toDesk ? held : ""} Notes: ${notes}`);
    pick(version);
    process.exit(0);
  }

  const key = privateKey(process.env.UPDATE_SIGNING_KEY);
  const publishedAt = new Date().toISOString();
  for (const [file, current] of [toDesk && ["update.json", desk], toWeb && ["web-update.json", web]].filter(Boolean)) {
    const m = {
      version,
      url: `index-${version}.html`,
      sha256: sha256(html),
      signature: "",
      minAppVersion: current.minAppVersion || "0",
      notes,
      installerUrl: current.installerUrl || "",
      publishedAt,
    };
    m.signature = sign(null, signedMessage(m), key).toString("base64");
    // The same check every installed app (and the web worker) makes; stop here if it would refuse this.
    if (!appAccepts(m)) {
      fail("UPDATE_SIGNING_KEY isn't the key Orbit trusts: its public half doesn't match the one built into the app, so every app would refuse this update. Use the key tools/release.mjs signs with.");
    }
    writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  }
  summary(`Signed Orbit ${version} for ${where} (sha256 ${sha256(html)}).${toWeb && !toDesk ? held : ""} Notes: ${notes}`);
}

// After the push: fetch each feed and its page the way the app does, until the new version is served. `channels` is
// "web,desktop" (the default), "web" or "desktop". After a web release, the web version's own answer is checked too.
async function check(version, channels = "web,desktop") {
  if (!VERSION_RE.test(version || "")) fail("--check needs a version like 1.9.52.");
  const want = String(channels || "web,desktop").split(",").map((c) => c.trim()).filter(Boolean);
  if (!want.length || want.some((c) => !FEEDS[c])) fail(`--check takes web, desktop or web,desktop, not "${channels}".`);
  const tries = Number(process.env.CHECK_TRIES) || 36, wait = Number(process.env.CHECK_WAIT_MS) || 10000;
  const get = async (url) => {
    const r = await fetch(url, { cache: "no-store", redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return Buffer.from(await r.arrayBuffer());
  };
  for (const c of want) {
    const { file, who, url } = FEEDS[c];
    let last = "", done = false;
    for (let n = 1; n <= tries && !done; n++) {
      try {
        const m = JSON.parse((await get(url + "?t=" + Date.now())).toString("utf8"));
        last = m.version;
        if (m.version === version) {
          const page = await get(new URL(m.url, url).toString());
          if (sha256(page) !== m.sha256) fail(`The served ${m.url} hashes to ${sha256(page)}, not ${m.sha256}: ${who} would refuse it.`);
          if (!appAccepts(m)) fail(`The served ${file} isn't signed with the key the app trusts: ${who} would refuse it.`);
          summary(c === "desktop" ? `Apps are now served Orbit ${version}, and it passes the app's own checks. They install it on their next restart.`
            : `${file} now names Orbit ${version}, and it passes the app's own checks.`);
          done = true;
          break;
        }
      } catch (e) { last = String((e && e.message) || e); }
      if (n < tries) await new Promise((r) => setTimeout(r, wait));
    }
    if (!done) {
      console.log(`::warning::raw.githubusercontent.com still serves ${last} in ${file} after ${Math.round(tries * wait / 60000)} minutes. It usually catches up within about 5; nothing to redo.`);
      summary(`${file} not served yet (still ${last}); raw.githubusercontent.com can take a few minutes.`);
      continue;
    }
    if (c === "web" && WEB_APP_URL) {
      let served = "";
      for (let n = 1; n <= tries; n++) {
        try {
          const r = await fetch(WEB_APP_URL, { method: "HEAD", cache: "no-store" });
          served = r.headers.get("x-orbit-version") || `HTTP ${r.status}`;
          if (served === version) break;
        } catch (e) { served = String((e && e.message) || e); }
        if (n < tries) await new Promise((r) => setTimeout(r, wait));
      }
      if (served === version) summary(`The web version (${WEB_APP_URL}) now serves Orbit ${version}.`);
      else {
        console.log(`::warning::The web version (${WEB_APP_URL}) still answers ${served || "nothing"}. It reads web-update.json at most once a minute; check that "Deploy web app" ran.`);
        summary(`The web version still answers ${served || "nothing"}.`);
      }
    }
  }
}

if (process.argv[2] === "--check") await check(process.argv[3], process.argv[4]);
else sign_(process.argv.includes("--verify"));
