// Checks a built Orbit-Windows.zip against the base download and this folder: everything but
// resources/app.asar is unchanged, and app.asar holds exactly this folder's app files, the page of the
// same version and the locked libraries (no dev ones). With ELECTRON=path/to/electron it also loads the
// email code from inside app.asar the way Orbit.exe does.
//   node test/check-build.mjs dist/Orbit-Windows.zip [--base <base zip>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";
import { BASE, APP_FILES, readFuses } from "../build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), DESK = path.join(HERE, ".."), ROOT = path.join(DESK, "..");
const zip = path.resolve(process.argv[2] || path.join(DESK, "dist", "Orbit-Windows.zip"));
const i = process.argv.indexOf("--base");
const baseZip = i > 0 ? process.argv[i + 1] : path.join(DESK, ".cache", `base-${BASE.sha256.slice(0, 12)}.zip`);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
let failed = 0, passed = 0;
const ok = (cond, name, got) => { if (cond) passed++; else failed++; console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n     got: " + JSON.stringify(got).slice(0, 600)}`); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-check-"));
try {
  execFileSync("unzip", ["-q", zip, "-d", path.join(work, "new")]);
  execFileSync("unzip", ["-q", baseZip, "-d", path.join(work, "base")]);
  const list = (d) => execFileSync("find", [".", "-type", "f"], { cwd: d }).toString().trim().split("\n").sort();
  const nw = list(path.join(work, "new")), old = list(path.join(work, "base"));
  ok(nw.join() === old.join(), "same files as the base download", { added: nw.filter(f => !old.includes(f)), missing: old.filter(f => !nw.includes(f)) });
  const changed = nw.filter(f => old.includes(f) && sha(fs.readFileSync(path.join(work, "new", f))) !== sha(fs.readFileSync(path.join(work, "base", f))));
  ok(changed.join() === "./Orbit-win32-x64/resources/app.asar", "only resources/app.asar differs (Orbit.exe and the rest are the base's)", changed);
  const exe = fs.readFileSync(path.join(work, "new", "Orbit-win32-x64", "Orbit.exe"));
  ok((readFuses(exe) || {}).EnableEmbeddedAsarIntegrityValidation === "off", "Orbit.exe doesn't check app.asar's integrity, so the new one loads");

  const appAsar = path.join(work, "new", "Orbit-win32-x64", "resources", "app.asar");
  const files = asar.listPackage(appAsar).map(f => f.replace(/\\/g, "/").replace(/^\//, ""));
  const top = files.filter(f => !f.includes("/")).filter(f => !asar.statFile(appAsar, f).files).sort();
  ok(top.join() === APP_FILES.concat("index.html").sort().join(), "app.asar's own files: the app files and index.html", top);
  for (const f of APP_FILES) ok(asar.extractFile(appAsar, f).equals(fs.readFileSync(path.join(DESK, f))), `${f} is this folder's`);
  const pkg = JSON.parse(asar.extractFile(appAsar, "package.json"));
  const page = fs.readFileSync(path.join(ROOT, `index-${pkg.version}.html`));
  ok(asar.extractFile(appAsar, "index.html").equals(page), `index.html is index-${pkg.version}.html`);
  const lock = JSON.parse(fs.readFileSync(path.join(DESK, "package-lock.json"), "utf8")).packages;
  const want = Object.entries(lock).filter(([k, v]) => k && !v.dev).map(([k, v]) => `${k}@${v.version}`).sort();
  const have = files.filter(f => /^node_modules\/(@[^/]+\/)?[^/@]+(\/node_modules\/(@[^/]+\/)?[^/]+)*\/package\.json$/.test(f))
    .map(f => f.replace(/\/package\.json$/, "")).filter(d => lock[d]).map(d => `${d}@${JSON.parse(asar.extractFile(appAsar, d + "/package.json")).version}`).sort();
  ok(have.join() === want.join(), `libraries: exactly the ${want.length} locked production packages`, { missing: want.filter(x => !have.includes(x)), extra: have.filter(x => !want.includes(x)) });
  ok(!files.some(f => /^node_modules\/(electron|@electron\/asar)\//.test(f)), "no dev packages inside");

  // Load the email code from inside app.asar, as Orbit.exe's main process does.
  if (process.env.ELECTRON) {
    const probe = `const m = require(${JSON.stringify(appAsar + "/imap-sync.js")}), t = require(${JSON.stringify(appAsar + "/trust.js")});`
      + `t.ready.then(() => console.log(JSON.stringify({exports: Object.keys(m).sort(), cert: m.CERT_ERROR, trust: typeof t.tlsOptions, electron: process.versions.electron})));`;
    const out = JSON.parse(execFileSync(process.env.ELECTRON, ["-e", probe], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).toString());
    ok(out.exports.includes("sync") && out.exports.includes("scanPromos") && out.trust === "function" && out.electron === BASE.electron,
      `imap-sync.js and trust.js load from app.asar in Electron ${out.electron}`, out);
  } else console.log("skip: set ELECTRON to load the code from app.asar");
} finally { fs.rmSync(work, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
