// Builds FAFO-Windows.zip: the Windows app from the v1.9.49 download (Electron 33.4.11, then called
// Orbit), renamed FAFO (its folder, FAFO.exe and the name in its version information), with a new
// resources/app.asar made from this folder, its locked libraries and the page of the same version
// (../index-<version>.html). Nothing is compiled, so this runs on Linux or macOS (it needs curl, unzip
// and zip). See README.md.
//
//   npm ci && npm run build      dist/FAFO-Windows.zip (+ the same as Orbit-Windows.zip and
//                                ProfileVault-Windows.zip, the names older pages link to; build.json)
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
export const APP_FILES = ["main.js", "preload.js", "imap-sync.js", "updater.js", "trust.js", "shortcuts.js", "update-config.json", "package.json"];
// The download's names. Older pages link to the zip by its older names, so those are copies of it.
export const NAME = "FAFO", DIR = "FAFO-win32-x64", EXE = "FAFO.exe", ZIP = "FAFO-Windows.zip", ZIP_ALIASES = ["Orbit-Windows.zip", "ProfileVault-Windows.zip"];

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

// The base's Orbit.exe names itself Orbit in its version information (the company, description, internal
// and product names, and Orbit.exe as the original file name), which Windows shows in Task Manager and
// under Properties → Details. Writes FAFO there in place: "Orbit" and "FAFO" plus one more null are the
// same length, so nothing else in the file moves. Returns null unless it finds exactly those five.
export function renameExe(exe) {
  const u = (t) => Buffer.from(t, "utf16le"), key = u("VS_VERSION_INFO");
  for (let at = exe.indexOf(key); at >= 6; at = exe.indexOf(key, at + key.length)) {
    const start = at - 6, end = start + exe.readUInt16LE(start);
    // The real block: wType 0, then VS_FIXEDFILEINFO's signature after the key (and padding).
    if (exe.readUInt16LE(start + 4) !== 0 || exe.readUInt32LE(start + 40) !== 0xFEEF04BD) continue;
    const out = Buffer.from(exe);
    let n = 0;
    for (const [from, to] of [["Orbit.exe\0", "FAFO.exe\0\0"], ["Orbit\0", "FAFO\0\0"]]) {
      const a = u(from), b = u(to);
      for (let i = out.indexOf(a, start); i >= 0 && i + a.length <= end; i = out.indexOf(a, i + a.length)) { b.copy(out, i); n++; }
    }
    return n === 5 ? out : null;
  }
  return null;
}
export const README = `FAFO - HOW TO INSTALL (Windows)
(FAFO is the new name for Orbit, which was called Profile Vault before that.)

1. EXTRACT FIRST. Right-click the zip > "Extract All..." > Extract.
   The app won't work if you open it from inside the zip.

2. Open the extracted "${DIR}" folder and double-click
   "${EXE}".

3. Windows may show "Windows protected your PC". Click "More info",
   then "Run anyway". (This appears for apps that aren't sold through
   the Microsoft Store.)

4. Enter the license key you were given (it starts with PVLT-).
   You only need to do this once.

5. Create a master password. It encrypts everything you save and
   CAN'T be recovered, so keep it somewhere safe.

Already using Orbit (or Profile Vault)? Close it, then open ${EXE}.
Your vault, license and inboxes carry over, and your Orbit shortcuts
(Start menu, desktop and taskbar) switch to FAFO. You can delete the
old "Orbit-win32-x64" folder after.

Updating an older FAFO download? Close FAFO, then put this
"${DIR}" folder where your old one was, replacing it, so your
shortcuts keep working. Your vault, license and inboxes are kept: they're
stored separately, not in that folder.

Tip: right-click "${EXE}" > "Send to" > "Desktop (create shortcut)"
so it's easy to find. You can move the whole folder anywhere you like first.

Updates install on their own: the app downloads them in the background and
shows "Update ready" when it's time to restart.
`;

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

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "fafo-build-"));
  try {
    const shell = path.join(work, "shell"), base = path.join(shell, "Orbit-win32-x64");
    run("unzip", ["-q", baseZip, "-d", shell]);
    const baseExe = path.join(base, "Orbit.exe");
    if (!fs.existsSync(baseExe) || !fs.existsSync(path.join(base, "resources", "app.asar")) || !fs.existsSync(path.join(shell, "READ ME FIRST.txt"))) fail("the base download isn't laid out as expected.");
    if (fs.readFileSync(path.join(base, "version"), "utf8").trim() !== BASE.electron) fail(`the base isn't Electron ${BASE.electron}.`);
    // A new app.asar only loads if the exe doesn't check it against the one it was built with.
    const fuses = readFuses(fs.readFileSync(baseExe));
    if (!fuses || fuses.EnableEmbeddedAsarIntegrityValidation !== "off") fail("Orbit.exe checks app.asar's integrity, so a new one wouldn't load.");

    // The new name: the folder, the exe and the name in its version information, and the read-me.
    const renamed = renameExe(fs.readFileSync(baseExe));
    if (!renamed) fail("Orbit.exe's version information isn't laid out as expected, so it can't be renamed.");
    const win = path.join(shell, DIR), exe = path.join(win, EXE), appAsar = path.join(win, "resources", "app.asar");
    fs.renameSync(base, win);
    fs.rmSync(path.join(win, "Orbit.exe"));
    fs.writeFileSync(exe, renamed);
    fs.writeFileSync(path.join(shell, "READ ME FIRST.txt"), README);

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
    const zip = path.join(out, ZIP);
    fs.rmSync(zip, { force: true });
    run("zip", ["-q", "-r", "-X", zip, DIR, "READ ME FIRST.txt"], shell);
    for (const alias of ZIP_ALIASES) fs.copyFileSync(zip, path.join(out, alias));
    const notes = path.join(HERE, "release-notes", `${version}.md`);
    if (fs.existsSync(notes)) fs.copyFileSync(notes, path.join(out, "notes.md"));
    const info = { version, electron: BASE.electron, sha256: sha(fs.readFileSync(zip)), page: `index-${version}.html`, pageSha256: sha(page), base: BASE.url, baseSha256: BASE.sha256 };
    fs.writeFileSync(path.join(out, "build.json"), JSON.stringify(info, null, 2) + "\n");
    console.log(`Built ${NAME} ${version} for Windows: ${zip}\n  sha256 ${info.sha256}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
