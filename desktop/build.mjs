// Builds Orbit-Windows.zip: the Windows app from the v1.9.49 download (Electron 33.4.11 with Orbit's
// name and icon) with a new resources/app.asar made from this folder, its locked libraries and the page
// of the same version (../index-<version>.html). Nothing is compiled, so this runs on Linux or macOS
// (it needs curl, unzip and zip). See README.md.
//
//   npm ci && npm run build      dist/Orbit-Windows.zip (+ ProfileVault-Windows.zip, build.json)
//   --base <zip>                 use a local copy of the base download instead of fetching it
//   --unreleased-page            allow a page update.json doesn't have yet (pull request checks)
//   --out <dir>                  somewhere other than dist/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
export const BASE = {
  url: "https://github.com/dolamv-coder/profile-vault-updates/releases/download/v1.9.49/Orbit-Windows.zip",
  sha256: "0206754708e5fbe755164f44e8c12e5dc5f80b24ee649a1b649fc1c9bb279a57",
  electron: "33.4.11"
};
export const APP_FILES = ["main.js", "preload.js", "imap-sync.js", "updater.js", "trust.js", "update-config.json", "package.json"];

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ""; };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fail = (msg) => { console.error(`Build stopped: ${msg}`); process.exit(1); };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
function cmp(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}
// Electron's fuses, from the sentinel in the executable (https://www.electronjs.org/docs/latest/tutorial/fuses).
export function readFuses(exe) {
  const at = exe.indexOf(Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"));
  if (at < 0) return null;
  const count = exe[at + 33], wire = exe.subarray(at + 34, at + 34 + count).toString("latin1");
  const names = ["RunAsNode", "EnableCookieEncryption", "EnableNodeOptionsEnvironmentVariable", "EnableNodeCliInspectArguments",
    "EnableEmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar", "LoadBrowserProcessSpecificV8Snapshot", "GrantFileProtocolExtraPrivileges"];
  return Object.fromEntries([...wire].map((c, i) => [names[i] || `fuse${i}`, { "0": "off", "1": "on", "r": "removed" }[c] || c]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));
  const version = pkg.version;

  // The page it starts with: the one of the same version (the updater loads a downloaded page only
  // when it's newer than the app), and once that's released, byte for byte what apps are served.
  const pagePath = path.join(ROOT, `index-${version}.html`);
  if (!fs.existsSync(pagePath)) fail(`index-${version}.html isn't in the repo. The app's version (package.json) has to be a page's version.`);
  const page = fs.readFileSync(pagePath);
  const update = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8"));
  if (cmp(update.version, version) < 0 && !process.argv.includes("--unreleased-page"))
    fail(`page ${version} isn't published yet (update.json has ${update.version}). Merge it and let "Publish Orbit update" ship it first.`);
  if (update.version === version && sha(page) !== update.sha256) fail(`index-${version}.html isn't the page published as ${version}.`);

  // The base: an earlier download, checked against its known sha256.
  let baseZip = arg("--base");
  if (!baseZip) {
    const cache = path.join(HERE, ".cache");
    baseZip = path.join(cache, `base-${BASE.sha256.slice(0, 12)}.zip`);
    if (!fs.existsSync(baseZip)) {
      fs.mkdirSync(cache, { recursive: true });
      run("curl", ["-fsSL", "--retry", "3", "-o", `${baseZip}.part`, BASE.url]);
      fs.renameSync(`${baseZip}.part`, baseZip);
    }
  }
  if (sha(fs.readFileSync(baseZip)) !== BASE.sha256) fail(`${baseZip} isn't the expected base download.`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-build-"));
  try {
    const shell = path.join(work, "shell"), win = path.join(shell, "Orbit-win32-x64");
    run("unzip", ["-q", baseZip, "-d", shell]);
    const exe = path.join(win, "Orbit.exe"), appAsar = path.join(win, "resources", "app.asar");
    if (!fs.existsSync(exe) || !fs.existsSync(appAsar) || !fs.existsSync(path.join(shell, "READ ME FIRST.txt"))) fail("the base download isn't laid out as expected.");
    if (fs.readFileSync(path.join(win, "version"), "utf8").trim() !== BASE.electron) fail(`the base isn't Electron ${BASE.electron}.`);
    // A new app.asar only loads if Orbit.exe doesn't check it against the one it was built with.
    const fuses = readFuses(fs.readFileSync(exe));
    if (!fuses || fuses.EnableEmbeddedAsarIntegrityValidation !== "off") fail("Orbit.exe checks app.asar's integrity, so a new one wouldn't load.");

    // The app: this folder's files, the page as index.html, and the locked libraries without dev ones.
    const app = path.join(work, "app");
    fs.mkdirSync(app);
    for (const f of APP_FILES) fs.copyFileSync(path.join(HERE, f), path.join(app, f));
    fs.writeFileSync(path.join(app, "index.html"), page);
    fs.copyFileSync(path.join(HERE, "package-lock.json"), path.join(app, "package-lock.json"));
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], app);
    fs.rmSync(path.join(app, "package-lock.json"));
    fs.rmSync(appAsar);
    await asar.createPackage(app, appAsar);

    // The zip, laid out like the earlier downloads.
    const out = path.resolve(arg("--out") || path.join(HERE, "dist"));
    fs.mkdirSync(out, { recursive: true });
    const zip = path.join(out, "Orbit-Windows.zip");
    fs.rmSync(zip, { force: true });
    run("zip", ["-q", "-r", "-X", zip, "Orbit-win32-x64", "READ ME FIRST.txt"], shell);
    fs.copyFileSync(zip, path.join(out, "ProfileVault-Windows.zip"));   // the name older pages link to
    const notes = path.join(HERE, "release-notes", `${version}.md`);
    if (fs.existsSync(notes)) fs.copyFileSync(notes, path.join(out, "notes.md"));
    const info = { version, electron: BASE.electron, sha256: sha(fs.readFileSync(zip)), page: `index-${version}.html`, pageSha256: sha(page), base: BASE.url, baseSha256: BASE.sha256 };
    fs.writeFileSync(path.join(out, "build.json"), JSON.stringify(info, null, 2) + "\n");
    console.log(`Built Orbit ${version} for Windows: ${zip}\n  sha256 ${info.sha256}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
