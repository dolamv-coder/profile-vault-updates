// The PowerShell that trust.js runs on Windows, checked with pwsh (GitHub's Ubuntu runners have it).
// Only Windows has the Cert: drive, so the commands run over stand-in certificates here; everything
// after Get-ChildItem is the real script. Skipped when pwsh isn't installed.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const trust = require("../trust.js");

const pwsh = process.env.PWSH || "pwsh";
try { execFileSync(pwsh, ["-NoProfile", "-Command", "1"], { stdio: "ignore" }); }
catch { console.log("skip: pwsh isn't installed"); process.exit(0); }

const CERTS = process.env.CERT_DIR;
const STORE = "Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root";
const files = ["av.pem", "public.pem", "expired.pem", "public.pem"].map(f => path.join(CERTS, f));
const load = `$certs = @(${files.map(f => `'${f}'`).join(",")}) | ForEach-Object { [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($_) }`;
const run = (script) => execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const hasCertData = (text) => /-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/]{100}/.test(text);   // trust.js's test for "it worked"
const want = ["av.pem", "public.pem"].map(f => fs.readFileSync(path.join(CERTS, f), "utf8").replace(/\s+/g, "")).sort().join();
const same = (pems) => pems.map(p => p.replace(/\s+/g, "")).sort().join() === want;
let failed = 0, passed = 0;
const ok = (cond, name, got) => { if (cond) passed++; else failed++; console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n     got: " + JSON.stringify(got)}`); };

const parses = (script) => run(`$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${script}\n'@, [ref]$null, [ref]$e); $e.Count`).trim() === "0";
ok(parses(trust.SCRIPT), "the script parses");
ok(parses(trust.EXPORT_SCRIPT("C:\\Users\\O'Brien\\AppData\\Local\\Temp\\orbit-roots-x")), "the fallback parses, with a ' in the folder name");
ok(trust.SCRIPT.startsWith(STORE) && trust.EXPORT_SCRIPT("x").startsWith(STORE), "both read the machine's and the user's trusted roots");

// Normal PowerShell: one block per certificate still in date, read back by trust.parse.
let out = run(`${load}\n${trust.SCRIPT.replace(STORE, "$certs")}`);
ok((out.match(/BEGIN CERTIFICATE/g) || []).length === 3 && same(trust.parse(out)), "prints the in-date roots, and they read back (expired and repeated ones dropped)", out.slice(0, 200));

// Constrained Language mode (locked-down PCs): the script prints nothing, so the fallback runs.
const locked = (script) => `${load}\nfunction Export-Certificate { param($Cert, $FilePath, $Type) Set-Content -LiteralPath $FilePath -Value $Cert.RawData -AsByteStream }\n`
  + `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n${script.replace(STORE, "$certs")}`;
out = "";
try { out = run(locked(trust.SCRIPT)); } catch (e) { out = String(e.stdout || ""); }
ok(/BEGIN CERTIFICATE/.test(out) && !hasCertData(out) && trust.parse(out).length === 0, "in Constrained Language mode the script prints empty blocks, which count as nothing read", out.slice(0, 120));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-roots-"));
try {
  run(locked(trust.EXPORT_SCRIPT(dir)));
  ok(same(trust.parse(trust.readCerFiles(dir))), "the fallback exports them there, and they read back", fs.readdirSync(dir));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
