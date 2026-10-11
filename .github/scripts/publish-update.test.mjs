// End-to-end test of the "Publish Orbit update" workflow's signing step and publish-update.mjs, run
// on a copy of this repo with a local "origin" and a throwaway Ed25519 key. Nothing touches GitHub.
//
//   node .github/scripts/publish-update.test.mjs
//
// Checks each update the way the desktop app's updater.js does (its verify(), copied below). Set
// ORBIT_UPDATER_JS to the real updater.js to use that instead.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = execFileSync("git", ["-C", HERE, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const SCRIPT = path.join(REPO, ".github/scripts/publish-update.mjs");
const T = mkdtempSync(path.join(os.tmpdir(), "orbit-publish-"));
let passed = 0, failed = 0;
const ok = (c, msg) => { if (c) { passed++; console.log("  ok  " + msg); } else { failed++; console.log("  FAIL " + msg); } };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const gitc = (dir, ...a) => sh("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Throwaway keys: "good" plays the publisher's key, "other" a wrong one.
const good = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
const pubB64 = good.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const pem = (k) => k.export({ format: "pem", type: "pkcs8" });
const KEY = pem(good.privateKey);

// What installed apps do with an update (updater.js: signedMessage and verify).
function appVerifier(publicKeyB64) {
  if (process.env.ORBIT_UPDATER_JS) {
    const req = createRequire(process.env.ORBIT_UPDATER_JS), Module = req("module"), load = Module._load;
    Module._load = function (r, ...a) { return r === "electron" ? { app: { getPath: () => T, getVersion: () => "1.0.0" }, net: {} } : load.call(this, r, ...a); };
    const { Updater } = req(process.env.ORBIT_UPDATER_JS);
    const dir = mkdtempSync(path.join(T, "app-"));
    writeFileSync(path.join(dir, "update-config.json"), JSON.stringify({ publicKey: publicKeyB64 }));
    const u = new Updater(dir);
    return (m, buf) => u.verify(m, buf);
  }
  const pubKey = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  const signedMessage = (m) => Buffer.from(["profile-vault-update", m.version, m.sha256, m.minAppVersion || "0"].join("\n"), "utf8");
  return (m, htmlBuf) => {
    if (sha(htmlBuf) !== String(m.sha256 || "").toLowerCase()) return "The downloaded file doesn't match the update's checksum.";
    let good = false;
    try { good = verify(null, signedMessage(m), pubKey, Buffer.from(String(m.signature || ""), "base64")); } catch {}
    return good ? null : "The update isn't signed with your key, so it was refused.";
  };
}
const appAccepts = appVerifier(pubB64);

// The workflow's "Sign and push update.json" step, verbatim.
const yml = readFileSync(path.join(REPO, ".github/workflows/publish-update.yml"), "utf8").split("\n");
const at = yml.findIndex((l) => l.includes("name: Sign and push update.json"));
const runAt = yml.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
const indent = yml[runAt + 1].match(/^\s*/)[0].length;
const block = [];
for (let i = runAt + 1; i < yml.length && (yml[i].trim() === "" || yml[i].match(/^\s*/)[0].length >= indent); i++) block.push(yml[i].slice(indent));
const RUN = block.join("\n");

// "origin": a bare repo seeded with this checkout's files, with both feeds (update.json, web-update.json) re-signed by
// the throwaway key so the test can publish on top of it, and installed apps following releases (channels.json) until
// section 11 pauses them.
const ORIGIN = path.join(T, "origin.git"), SEED = path.join(T, "seed");
sh("git", ["init", "-q", "--bare", "-b", "main", ORIGIN]);
sh("git", ["--git-dir", ORIGIN, "config", "uploadpack.allowAnySHA1InWant", "true"]);
sh("git", ["init", "-q", "-b", "main", SEED]);
const tracked = sh("git", ["-C", REPO, "ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter((f) => f && !f.startsWith(".claude/") && existsSync(path.join(REPO, f)));
for (const f of tracked) { mkdirSync(path.dirname(path.join(SEED, f)), { recursive: true }); cpSync(path.join(REPO, f), path.join(SEED, f)); }
const realManifest = JSON.parse(readFileSync(path.join(SEED, "update.json"), "utf8"));
const liveVersion = realManifest.version;
// Start with the version before the newest page, so there's something to publish.
const pages = tracked.map((f) => (f.match(/^index-(\d+\.\d+\.\d+)\.html$/) || [])[1]).filter(Boolean);
const cmp = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]; return 0; };
pages.sort(cmp);
const NEW = pages[pages.length - 1], BASE = pages[pages.length - 2];
const [a, b, c] = NEW.split(".").map(Number), NEXT = `${a}.${b}.${c + 1}`;
const baseM = { ...realManifest, version: BASE, url: `index-${BASE}.html`, sha256: sha(readFileSync(path.join(SEED, `index-${BASE}.html`))), notes: "Base." };
baseM.signature = (await import("node:crypto")).sign(null, Buffer.from(["profile-vault-update", baseM.version, baseM.sha256, baseM.minAppVersion || "0"].join("\n")), good.privateKey).toString("base64");
writeFileSync(path.join(SEED, "update.json"), JSON.stringify(baseM, null, 2) + "\n");
writeFileSync(path.join(SEED, "web-update.json"), JSON.stringify(baseM, null, 2) + "\n");
writeFileSync(path.join(SEED, "channels.json"), JSON.stringify({ desktop: "follow" }, null, 2) + "\n");
mkdirSync(path.join(SEED, "release-notes"), { recursive: true });
if (!existsSync(path.join(SEED, `release-notes/${NEW}.txt`))) writeFileSync(path.join(SEED, `release-notes/${NEW}.txt`), `Test notes for ${NEW}.\n`);
gitc(SEED, "add", "-A"); gitc(SEED, "commit", "-q", "-m", "seed"); gitc(SEED, "push", "-q", ORIGIN, "main:main");
const notesNEW = readFileSync(path.join(SEED, `release-notes/${NEW}.txt`), "utf8").replace(/\s+/g, " ").trim();
console.log(`Publishing ${NEW} over ${BASE} (live update.json is ${liveVersion}); scratch: ${T}`);

const originSha = () => sh("git", ["--git-dir", ORIGIN, "rev-parse", "main"]).trim();
const originJSON = () => JSON.parse(sh("git", ["--git-dir", ORIGIN, "show", "main:update.json"]));
const originWeb = () => JSON.parse(sh("git", ["--git-dir", ORIGIN, "show", "main:web-update.json"]));
const originHead = () => sh("git", ["--git-dir", ORIGIN, "log", "-1", "--format=%s%n%an <%ae>", "main"]).trim();
// Pages are over a megabyte from 1.9.100, past execFileSync's default buffer; the publisher allows 64 MB too.
const blob = (v, ref = "main") => execFileSync("git", ["--git-dir", ORIGIN, "show", `${ref}:index-${v}.html`], { maxBuffer: 64 * 1024 * 1024 });
let n = 0;
// Runs the step as the runner would: an empty workspace, bash -eo pipefail, the step's env.
function runStep(env = {}, sha = originSha()) {
  const W = path.join(T, `run-${++n}`); mkdirSync(W);
  const tmp = path.join(T, `tmp-${n}`); mkdirSync(tmp);
  const out = path.join(tmp, "out"), sum = path.join(tmp, "sum");
  writeFileSync(out, ""); writeFileSync(sum, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", RUN], {
    cwd: W, encoding: "utf8",
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1",
      GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, RUNNER_TEMP: tmp, GITHUB_SHA: sha, GITHUB_REPOSITORY: "o/r",
      GH_TOKEN: "test-token", REPO_URL: "file://" + ORIGIN, ORBIT_UPDATE_PUBLIC_KEY: pubB64,
      UPDATE_SIGNING_KEY: "", UPDATE_SIGNING_KEY_PASSPHRASE: "", VERSION: "", ...env,
    },
  });
  return { code: r.status, log: r.stdout + r.stderr, out: readFileSync(out, "utf8"), sum: readFileSync(sum, "utf8"), dir: W };
}
// Commits changes to origin's main from a scratch clone.
function commitToOrigin(msg, change) {
  const C = path.join(T, `c-${++n}`);
  sh("git", ["clone", "-q", "file://" + ORIGIN, C]);
  change(C);
  gitc(C, "add", "-A"); gitc(C, "commit", "-q", "-m", msg); gitc(C, "push", "-q", "origin", "main");
  return originSha();
}
// The script alone, in a checkout of origin's main (like the pull request check).
function script(args, env = {}, ref = "main") {
  const C = path.join(T, `s-${++n}`);
  sh("git", ["clone", "-q", "file://" + ORIGIN, C]); gitc(C, "checkout", "-q", ref);
  const r = spawnSync("node", [SCRIPT, ...args], { cwd: C, encoding: "utf8", env: { PATH: process.env.PATH, ORBIT_UPDATE_PUBLIC_KEY: pubB64, ...env } });
  return { code: r.status, log: r.stdout + r.stderr, dir: C };
}

console.log("1. The real update.json in this checkout passes the app's checks with the real key");
{
  const real = appVerifier("MCowBQYDK2VwAyEAjMqbFzE6HEjJ+PZAxJdcRPQutn4Eh6YjedtapiYe48o=");
  ok(real(realManifest, readFileSync(path.join(REPO, realManifest.url))) === null, `update.json (${liveVersion}) verifies`);
  const r = spawnSync("node", [SCRIPT, "--verify"], { cwd: REPO, encoding: "utf8", env: { PATH: process.env.PATH } });
  ok(r.status === 0, "--verify passes on this checkout: " + (r.stdout.trim().split("\n").pop() || "").slice(0, 120));
}

console.log("2. No key: a clear message, nothing pushed");
{
  const r = runStep({});
  ok(r.code !== 0 && /UPDATE_SIGNING_KEY secret isn't set up/.test(r.log) && /Environments/.test(r.log), "asks for the environment secret");
  ok(originJSON().version === BASE && originWeb().version === BASE, "origin untouched");
}

console.log("3. Wrong key, public key, garbage: refused before writing");
{
  let r = runStep({ UPDATE_SIGNING_KEY: pem(other.privateKey) });
  ok(r.code !== 0 && /isn't the key Orbit trusts/.test(r.log), "wrong key: not the trusted key");
  ok(!/PRIVATE KEY/.test(r.log), "key never printed");
  r = runStep({ UPDATE_SIGNING_KEY: good.publicKey.export({ format: "pem", type: "spki" }) });
  ok(r.code !== 0 && /holds a public key/.test(r.log), "public key: says so");
  r = runStep({ UPDATE_SIGNING_KEY: "not a key!" });
  ok(r.code !== 0 && /isn't an Ed25519 private key/.test(r.log), "garbage: says so");
  ok(originJSON().version === BASE, "origin untouched");
}

console.log(`4. Publish ${NEW} (key pasted with Windows line endings)`);
let published;
{
  const r = runStep({ UPDATE_SIGNING_KEY: KEY.replace(/\n/g, "\r\n") + "\r\n" });
  ok(r.code === 0, "exits 0" + (r.code ? ": " + r.log.slice(-300) : ""));
  ok(/published=true/.test(r.out) && new RegExp(`version=${NEW.replace(/\./g, "\\.")}`).test(r.out), `outputs published=true, version=${NEW}`);
  published = originJSON();
  ok(published.version === NEW && published.url === `index-${NEW}.html`, `origin update.json is ${NEW}`);
  const h = blob(NEW);
  ok(published.sha256 === sha(h), "sha256 is of the committed bytes");
  ok(appAccepts(published, h) === null, "the app's verify() accepts it");
  ok(appAccepts(published, Buffer.from(h.toString("utf8").replace(/\n/g, "\r\n"))) !== null, "…and refuses a CRLF copy (control)");
  ok(JSON.stringify(Object.keys(published)) === JSON.stringify(["version", "url", "sha256", "signature", "minAppVersion", "notes", "installerUrl", "publishedAt"]), "same keys, same order");
  ok(published.minAppVersion === baseM.minAppVersion && published.installerUrl === baseM.installerUrl, "minAppVersion and installerUrl carried over");
  ok(published.notes === notesNEW, "notes from release-notes");
  const raw = sh("git", ["--git-dir", ORIGIN, "show", "main:update.json"]);
  ok(raw === JSON.stringify(published, null, 2) + "\n", "2-space JSON with a trailing newline");
  ok(new RegExp(`^Release ${NEW.replace(/\./g, "\\.")}\\ngithub-actions\\[bot\\]`).test(originHead()), `commit "Release ${NEW}" by github-actions[bot]`);
  ok(sh("git", ["--git-dir", ORIGIN, "show", "--name-only", "--format=", "main"]).trim() === "update.json\nweb-update.json", "the release commit changes the two feeds only");
  ok(sh("git", ["--git-dir", ORIGIN, "show", "main:web-update.json"]) === raw, "web-update.json is the same signed release");
  ok(/channels=web,desktop/.test(r.out), "outputs channels=web,desktop");
  ok(!/PRIVATE KEY|test-token/.test(r.log + r.sum), "key and token never in the log or summary");
  ok(new RegExp(`Signed Orbit ${NEW.replace(/\./g, "\\.")}`).test(r.sum), "job summary written");
}

console.log("5. Running again publishes nothing, and needs no key");
{
  const head = originHead();
  const r = runStep({});
  ok(r.code === 0 && /published=false/.test(r.out) && /Nothing to publish/.test(r.sum), "skips: not newer");
  ok(originHead() === head, "no new commit");
}

console.log("6. Explicit versions");
{
  let r = runStep({ UPDATE_SIGNING_KEY: KEY, VERSION: BASE });
  ok(r.code === 0 && /published=false/.test(r.out), "older version: skipped");
  r = runStep({ UPDATE_SIGNING_KEY: KEY, VERSION: `${NEW}"; touch ${T}/pwned; echo "` });
  ok(r.code !== 0 && /isn't a version like/.test(r.log) && !existsSync(`${T}/pwned`), "injection-looking input: rejected, never run");
  r = runStep({ UPDATE_SIGNING_KEY: KEY, VERSION: "9.9.9" });
  ok(r.code !== 0 && /index-9\.9\.9\.html isn't on main/.test(r.log), "unknown version: fails");
}

console.log("7. A released page changed or removed afterwards fails loudly (apps would refuse it)");
{
  const before = originSha();
  commitToOrigin("edit released page", (C) => writeFileSync(path.join(C, `index-${NEW}.html`), readFileSync(path.join(C, `index-${NEW}.html`), "utf8").replace("</body>", "<!-- edit --></body>")));
  let r = runStep({ UPDATE_SIGNING_KEY: KEY });
  ok(r.code !== 0 && /changed after it was released/.test(r.log), "edited page: fails");
  ok(script(["--verify"]).code !== 0, "…and the pull request check fails too");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
  commitToOrigin("remove released page", (C) => rmSync(path.join(C, `index-${NEW}.html`)));
  r = runStep({ UPDATE_SIGNING_KEY: KEY });
  ok(r.code !== 0 && /isn't on main any more/.test(r.log), "removed page: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
  commitToOrigin("edit released notes", (C) => writeFileSync(path.join(C, `release-notes/${NEW}.txt`), "Changed later.\n"));
  r = runStep({});
  ok(r.code === 0 && /::warning::release-notes\/.*changed after/.test(r.log), "edited notes: green with a warning");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
  commitToOrigin("hand-signed update.json with a bad signature", (C) => {
    const j = JSON.parse(readFileSync(path.join(C, "update.json"), "utf8")); j.signature = Buffer.alloc(64).toString("base64");
    writeFileSync(path.join(C, "update.json"), JSON.stringify(j, null, 2) + "\n");
  });
  r = runStep({});
  ok(r.code !== 0 && /update\.json \(.*isn't signed with the key the app trusts/.test(r.log), "mis-signed update.json pushed by hand: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
  commitToOrigin("hand-signed web-update.json with a bad signature", (C) => {
    const j = JSON.parse(readFileSync(path.join(C, "web-update.json"), "utf8")); j.signature = Buffer.alloc(64).toString("base64");
    writeFileSync(path.join(C, "web-update.json"), JSON.stringify(j, null, 2) + "\n");
  });
  r = runStep({});
  ok(r.code !== 0 && /web-update\.json \(.*isn't signed with the key the app trusts/.test(r.log), "mis-signed web-update.json pushed by hand: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
  commitToOrigin("remove web-update.json", (C) => rmSync(path.join(C, "web-update.json")));
  r = runStep({});
  ok(r.code !== 0 && /web-update\.json isn't on main/.test(r.log), "web-update.json removed: fails, saying the web version reads it");
  gitc(ORIGIN, "update-ref", "refs/heads/main", before);
}

console.log(`8. ${NEXT}: no notes fails; with notes it publishes (after a rejected push); a later change on main is not signed by an older run`);
{
  const addPage = (C) => writeFileSync(path.join(C, `index-${NEXT}.html`), readFileSync(path.join(C, `index-${NEW}.html`), "utf8").replace("</body>", `<!-- ${NEXT} --></body>`));
  const noNotes = commitToOrigin(`page ${NEXT}`, addPage);
  let r = runStep({ UPDATE_SIGNING_KEY: KEY });
  ok(r.code !== 0 && /has no release-notes/.test(r.log), "newer page, no notes: fails");
  ok(script(["--verify"]).code !== 0, "…and the pull request check fails too");
  ok(originJSON().version === NEW, "nothing published");

  const withNotes = commitToOrigin(`notes ${NEXT}`, (C) => writeFileSync(path.join(C, `release-notes/${NEXT}.txt`), "Line one.\r\n\r\n  Line  two with <b>html</b> & \"quotes\".\n"));
  const v = script(["--verify"], { PICK_OUT: path.join(T, "pick") });
  ok(v.code === 0 && readFileSync(path.join(T, "pick"), "utf8") === NEXT && /Ready to publish/.test(v.log), `pull request check: ready to publish ${NEXT}`);

  // Someone changes the page on main after this run's commit: the run must not sign that.
  const later = commitToOrigin(`change ${NEXT}`, (C) => writeFileSync(path.join(C, `index-${NEXT}.html`), readFileSync(path.join(C, `index-${NEXT}.html`), "utf8") + "<!-- later -->"));
  r = runStep({ UPDATE_SIGNING_KEY: KEY }, withNotes);
  ok(r.code !== 0 && /isn't the one in the commit this run is for/.test(r.log), "older run refuses the newer page");
  ok(originJSON().version === NEW, "nothing published by it");

  // The run for the later commit publishes, even though its first push is rejected.
  const hook = path.join(ORIGIN, "hooks/pre-receive"), flag = path.join(T, "rejected-once");
  writeFileSync(hook, `#!/bin/sh\nif [ ! -f "${flag}" ]; then touch "${flag}"; echo "simulated race" >&2; exit 1; fi\nexit 0\n`); chmodSync(hook, 0o755);
  r = runStep({ UPDATE_SIGNING_KEY: JSON.stringify(good.privateKey.export({ format: "jwk" })) }, later);
  rmSync(hook);
  ok(r.code === 0 && existsSync(flag) && new RegExp(`version=${NEXT.replace(/\./g, "\\.")}`).test(r.out), `published ${NEXT} after one rejected push (JWK key)`);
  const m = originJSON();
  ok(m.notes === 'Line one. Line two with <b>html</b> & "quotes".', "notes on one line, text kept (the app escapes it)");
  ok(appAccepts(m, blob(NEXT)) === null, `the app's verify() accepts ${NEXT}`);
  const log = sh("git", ["--git-dir", ORIGIN, "log", "--format=%s", "-2", "main"]).trim().split("\n");
  ok(log[0] === `Release ${NEXT}` && log[1] === `change ${NEXT}`, "one Release commit on top of the latest main");
  void noNotes;
}

console.log("9. Key formats");
{
  const d = good.privateKey.export({ format: "der", type: "pkcs8" }), seed = d.subarray(16);
  const enc = good.privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "hunter2" });
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
  // Sign on a clone of main with update.json rolled back one version, so there's always something to sign.
  const C = path.join(T, "keys"); sh("git", ["clone", "-q", "file://" + ORIGIN, C]);
  const current = originJSON(), prev = current.version === NEXT ? NEW : BASE;
  const signWith = (key, pass) => {
    gitc(C, "reset", "-q", "--hard", "origin/main");
    const j = JSON.parse(readFileSync(path.join(C, "update.json"), "utf8")); Object.assign(j, { version: prev, url: `index-${prev}.html`, sha256: sha(blob(prev)) });
    writeFileSync(path.join(C, "update.json"), JSON.stringify(j, null, 2) + "\n"); gitc(C, "commit", "-q", "-am", "rollback");
    const r = spawnSync("node", [SCRIPT], { cwd: C, encoding: "utf8", env: { PATH: process.env.PATH, ORBIT_UPDATE_PUBLIC_KEY: pubB64, UPDATE_SIGNING_KEY: key, UPDATE_SIGNING_KEY_PASSPHRASE: pass || "" } });
    const out = JSON.parse(readFileSync(path.join(C, "update.json"), "utf8"));
    return r.status === 0 && out.version === current.version && appAccepts(out, blob(current.version)) === null ? "ok" : (r.stdout + r.stderr).trim();
  };
  const formats = {
    "PEM": KEY,
    "base64 PKCS#8": d.toString("base64"),
    "base64url PKCS#8": d.toString("base64url"),
    "base64 seed": seed.toString("base64"),
    "hex seed": seed.toString("hex"),
    "hex PKCS#8": d.toString("hex"),
    "JWK": JSON.stringify(good.privateKey.export({ format: "jwk" })),
    "JSON file with a PEM inside": JSON.stringify({ privateKey: KEY, publicKey: pubB64 }),
    "JSON file with a nested JWK": JSON.stringify({ keys: { update: good.privateKey.export({ format: "jwk" }) } }),
    "PEM with blank lines around it": "  \n" + KEY + "\n\n",
  };
  for (const [name, key] of Object.entries(formats)) { const res = signWith(key); ok(res === "ok", name + ": signs a valid update" + (res === "ok" ? "" : " -> " + res)); }
  ok(signWith(enc, "hunter2") === "ok", "encrypted PEM + passphrase: signs");
  ok(/isn't an Ed25519 private key/.test(signWith(enc, "")), "encrypted PEM without its passphrase: clear error");
  ok(/isn't an Ed25519 private key/.test(signWith(rsa)), "RSA key: clear error");
  ok(/isn't the key Orbit trusts/.test(signWith(Buffer.from(seed.map((x) => x ^ 1)).toString("base64"))), "wrong seed: refused");
}

console.log("10. --check against a local server");
{
  const served = { manifest: baseM, web: null, page: blob(BASE), fail: 0, app: BASE };
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, "http://x");
    if (u.pathname === "/r/update.json") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify(served.manifest)); }
    if (u.pathname === "/r/web-update.json") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify(served.web || served.manifest)); }
    if (u.pathname === "/app/") { s.setHeader("x-orbit-version", served.app); return s.end(); }
    if (u.pathname === "/r/" + served.manifest.url || (served.web && u.pathname === "/r/" + served.web.url)) {
      if (served.fail > 0) { served.fail--; s.statusCode = 429; return s.end("429: Too Many Requests"); }
      return s.end(served.page);
    }
    s.statusCode = 404; s.end("nope");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`, base = `${origin}/r/update.json`;
  const check = (v, ch) => new Promise((res) => {
    const p = spawn("node", [SCRIPT, "--check", v, ...(ch ? [ch] : [])], { env: { PATH: process.env.PATH, ORBIT_MANIFEST_URL: base, ORBIT_WEB_MANIFEST_URL: `${origin}/r/web-update.json`, ORBIT_WEB_APP_URL: `${origin}/app/`, ORBIT_UPDATE_PUBLIC_KEY: pubB64, CHECK_TRIES: "6", CHECK_WAIT_MS: "300" } });
    let o = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (o += d));
    p.on("close", (code) => res({ code, o }));
  });
  setTimeout(() => { served.manifest = published; served.page = blob(NEW); served.app = NEW; }, 700);
  let r = await check(NEW);
  ok(r.code === 0 && /Apps are now served Orbit/.test(r.o) && /web-update\.json now names Orbit/.test(r.o) && /The web version .* now serves Orbit/.test(r.o), "waits for the new version in both feeds and on the web, then confirms it");
  served.fail = 2;
  r = await check(NEW);
  ok(r.code === 0 && /Apps are now served Orbit/.test(r.o), "rides out a 429 on the page");
  served.page = Buffer.from(blob(NEW).toString("utf8").replace(/\n/g, "\r\n"));
  r = await check(NEW);
  ok(r.code !== 0 && /hashes to/.test(r.o), "served page with other bytes: fails");
  served.page = blob(NEW); served.manifest = { ...published, signature: Buffer.alloc(64).toString("base64") };
  r = await check(NEW);
  ok(r.code !== 0 && /isn't signed with the key/.test(r.o), "bad signature served: fails");
  served.manifest = baseM; served.page = blob(BASE);
  r = await check(NEW);
  ok(r.code === 0 && /::warning::.*still serves/.test(r.o), "not served in time: a warning, not a failure");
  // Web only: the desktop feed isn't looked at, and a web version that hasn't caught up is a warning.
  served.manifest = baseM; served.web = published; served.page = blob(NEW); served.app = BASE;
  r = await check(NEW, "web");
  ok(r.code === 0 && /web-update\.json now names Orbit/.test(r.o) && !/Apps are now served/.test(r.o) && /::warning::The web version .* still answers/.test(r.o), "web only: checks web-update.json, warns while the web version hasn't caught up");
  r = await check(NEW, "phone");
  ok(r.code !== 0 && /--check takes web, desktop/.test(r.o), "an unknown channel: fails");
  srv.close();
}

console.log("11. Desktop updates paused (channels.json): new pages go to the web only, then follow again");
{
  const [x, y, z] = NEXT.split(".").map(Number), WEB1 = `${x}.${y}.${z + 1}`;
  const deskBefore = originJSON();
  commitToOrigin(`pause; page ${WEB1}`, (C) => {
    writeFileSync(path.join(C, "channels.json"), JSON.stringify({ desktop: "paused", note: "test" }, null, 2) + "\n");
    writeFileSync(path.join(C, `index-${WEB1}.html`), readFileSync(path.join(C, `index-${NEXT}.html`), "utf8").replace("</body>", `<!-- ${WEB1} --></body>`));
    writeFileSync(path.join(C, `release-notes/${WEB1}.txt`), `Web notes for ${WEB1}.\n`);
  });
  const v = script(["--verify"]);
  ok(v.code === 0 && /Ready to publish Orbit .* to the web version only/.test(v.log) && new RegExp(`installed apps stay on ${deskBefore.version.replace(/\./g, "\\.")}`).test(v.log), "pull request check: web only, says installed apps stay");
  let r = runStep({ UPDATE_SIGNING_KEY: KEY });
  ok(r.code === 0 && new RegExp(`version=${WEB1.replace(/\./g, "\\.")}`).test(r.out) && /channels=web\n/.test(r.out), `published ${WEB1}, channels=web`);
  const w = originWeb();
  ok(w.version === WEB1 && appAccepts(w, blob(WEB1)) === null && w.notes === `Web notes for ${WEB1}.`, "web-update.json names it, signed, with its notes");
  ok(JSON.stringify(originJSON()) === JSON.stringify(deskBefore), "update.json (installed apps) unchanged");
  ok(/^Release .* \(web only\)$/.test(originHead().split("\n")[0]) && sh("git", ["--git-dir", ORIGIN, "show", "--name-only", "--format=", "main"]).trim() === "web-update.json", `commit "Release ${WEB1} (web only)" changes web-update.json only`);
  r = runStep({});
  ok(r.code === 0 && /published=false/.test(r.out) && /Desktop updates are paused/.test(r.sum), "running again: nothing, and the summary says installed apps are held");
  r = runStep({ UPDATE_SIGNING_KEY: KEY, VERSION: WEB1 });
  ok(r.code === 0 && /published=false/.test(r.out), "asking for that version again while paused: nothing");

  // A page the web feed points to, changed afterwards, still fails.
  const pausedAt = originSha();
  commitToOrigin("edit web-only page", (C) => writeFileSync(path.join(C, `index-${WEB1}.html`), readFileSync(path.join(C, `index-${WEB1}.html`), "utf8") + "<!-- later -->"));
  r = runStep({});
  ok(r.code !== 0 && /changed after it was released/.test(r.log), "the web feed's page edited later: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", pausedAt);

  // channels.json that says something else, or isn't JSON: fails rather than guessing.
  commitToOrigin("bad channel", (C) => writeFileSync(path.join(C, "channels.json"), JSON.stringify({ desktop: "Paused" })));
  r = runStep({});
  ok(r.code !== 0 && /has to be "paused" or "follow"/.test(r.log), "an unknown value: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", pausedAt);
  commitToOrigin("broken channels.json", (C) => writeFileSync(path.join(C, "channels.json"), "{desktop: paused}"));
  r = runStep({});
  ok(r.code !== 0 && /channels\.json isn't valid JSON/.test(r.log), "not JSON: fails");
  gitc(ORIGIN, "update-ref", "refs/heads/main", pausedAt);

  // Following again: installed apps catch up to the newest page; the web feed stays as it is.
  const webBefore = sh("git", ["--git-dir", ORIGIN, "show", "main:web-update.json"]);
  commitToOrigin("follow", (C) => writeFileSync(path.join(C, "channels.json"), JSON.stringify({ desktop: "follow" }, null, 2) + "\n"));
  r = runStep({ UPDATE_SIGNING_KEY: KEY });
  const d = originJSON();
  ok(r.code === 0 && /channels=desktop\n/.test(r.out) && d.version === WEB1 && appAccepts(d, blob(WEB1)) === null, `following again: update.json catches up to ${WEB1}, signed`);
  ok(d.minAppVersion === deskBefore.minAppVersion && d.installerUrl === deskBefore.installerUrl, "…keeping update.json's own minAppVersion and installerUrl");
  ok(/^Release .* \(installed apps\)$/.test(originHead().split("\n")[0]) && sh("git", ["--git-dir", ORIGIN, "show", "main:web-update.json"]) === webBefore, `commit "Release ${WEB1} (installed apps)", web-update.json untouched`);

  // No channels.json at all: installed apps follow, as before the switch existed.
  const C = path.join(T, "nochan"); sh("git", ["clone", "-q", "file://" + ORIGIN, C]); gitc(C, "rm", "-q", "channels.json"); gitc(C, "commit", "-q", "-m", "no channels");
  const nc = spawnSync("node", [SCRIPT, "--verify"], { cwd: C, encoding: "utf8", env: { PATH: process.env.PATH, ORBIT_UPDATE_PUBLIC_KEY: pubB64 } });
  ok(nc.status === 0 && /Nothing to publish/.test(nc.stdout) && !/paused/.test(nc.stdout), "no channels.json: installed apps follow");
}

console.log("12. The web version reads web-update.json");
{
  const toml = readFileSync(path.join(REPO, "web-worker/wrangler.toml"), "utf8");
  ok(/^UPDATE_URL = "https:\/\/raw\.githubusercontent\.com\/dolamv-coder\/profile-vault-updates\/main\/web-update\.json"$/m.test(toml), "wrangler.toml's UPDATE_URL is main's web-update.json");
  const idx = readFileSync(path.join(REPO, "web-worker/src/index.js"), "utf8");
  ok(/const UPDATE_URL = "https:\/\/raw\.githubusercontent\.com\/dolamv-coder\/profile-vault-updates\/main\/web-update\.json";/.test(idx), "…and so is the worker's own default");
  const real = appVerifier("MCowBQYDK2VwAyEAjMqbFzE6HEjJ+PZAxJdcRPQutn4Eh6YjedtapiYe48o=");
  const wm = JSON.parse(readFileSync(path.join(REPO, "web-update.json"), "utf8"));
  ok(real(wm, readFileSync(path.join(REPO, wm.url))) === null, `this checkout's web-update.json (${wm.version}) verifies with the real key`);
}

console.log(`\n${passed} passed, ${failed} failed`);
rmSync(T, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
