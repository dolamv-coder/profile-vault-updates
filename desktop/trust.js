// Root certificates for email connections.
//
// Node (and so this app's email code) checks mail servers against its own built-in list of public
// certificate authorities, not the ones Windows trusts. Antivirus email scanning, VPNs and work
// networks check secure connections by re-signing them with a certificate they add to Windows:
// Chrome and Outlook accept those, and this app used to refuse them ("The mail server's security
// certificate couldn't be verified."). So email connections also trust Windows' trusted root
// certificates, read once at startup. Everything is still verified, including the server's name.
"use strict";
const tls = require("tls");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

let roots = [];     // PEMs Windows trusts that Node's list doesn't have
let caList = null;  // Node's list plus those, built once

// Machine and user "Trusted Root Certification Authorities", still in date, one PEM each.
const SCRIPT = "Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root | Where-Object { $_.NotAfter -gt (Get-Date) } | "
  + "ForEach-Object { '-----BEGIN CERTIFICATE-----'; [Convert]::ToBase64String($_.RawData); '-----END CERTIFICATE-----' }";

// Locked-down PCs (PowerShell's Constrained Language mode) block [Convert]. Export-Certificate, a
// plain command, still works there: it writes each root to a file in dir.
const EXPORT_SCRIPT = (dir) => "Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root | Where-Object { $_.NotAfter -gt (Get-Date) } | "
  + `ForEach-Object { Export-Certificate -Cert $_ -FilePath (Join-Path '${String(dir).replace(/'/g, "''")}' ($_.Thumbprint + '.cer')) -Type CERT | Out-Null }`;

function powershell(script) {
  return new Promise((resolve) => {
    const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const cmd = Buffer.from(script, "utf16le").toString("base64");
    try {
      execFile(exe, ["-NoProfile", "-NonInteractive", "-EncodedCommand", cmd], { windowsHide: true, timeout: 20000, maxBuffer: 32 * 1024 * 1024 },
        (_err, stdout) => resolve(String(stdout || "")));
    } catch { resolve(""); }
  });
}
// DER files (.cer) as BEGIN/END CERTIFICATE text.
function readCerFiles(dir) {
  return fs.readdirSync(dir).filter(f => /\.cer$/i.test(f))
    .map(f => "-----BEGIN CERTIFICATE-----\n" + fs.readFileSync(path.join(dir, f)).toString("base64") + "\n-----END CERTIFICATE-----\n").join("");
}
async function readWindows() {
  if (process.platform !== "win32") return "";
  const text = await powershell(SCRIPT);
  // In Constrained Language mode the markers still print, with nothing between them.
  if (/-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/]{100}/.test(text)) return text;
  let dir = "";
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-roots-"));
    await powershell(EXPORT_SCRIPT(dir));
    return readCerFiles(dir);
  } catch { return ""; } finally { if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// PEMs from text holding BEGIN/END CERTIFICATE blocks (line breaks anywhere), skipping anything that
// isn't a certificate this Node can read, duplicates, and ones already in Node's list.
function parse(text) {
  const have = new Set(tls.rootCertificates.map(fingerprint));
  const out = [];
  for (const m of String(text || "").matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)) {
    const b64 = m[1].replace(/\s+/g, "");
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) continue;
    const pem = "-----BEGIN CERTIFICATE-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END CERTIFICATE-----\n";
    const fp = fingerprint(pem);
    if (!fp || have.has(fp)) continue;
    have.add(fp);
    out.push(pem);
  }
  return out;
}
function fingerprint(pem) { try { return new crypto.X509Certificate(pem).fingerprint256; } catch { return ""; } }

// Use these roots on top of Node's (any this Node can't read are left out). If they can't be used
// together, keep Node's alone.
function use(pems) {
  roots = [];
  caList = null;
  const good = (pems || []).filter(fingerprint);
  try { tls.createSecureContext({ ca: tls.rootCertificates.concat(extraFromEnv(), good) }); } catch { return 0; }
  roots = good;
  return roots.length;
}

const ready = readWindows().then((text) => { use(parse(text)); }, () => {});

// Certificates added with NODE_EXTRA_CA_CERTS are part of Node's defaults, which a ca list replaces.
function extraFromEnv() {
  try { const f = process.env.NODE_EXTRA_CA_CERTS; return f ? (fs.readFileSync(f, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\s*/g) || []) : []; } catch { return []; }
}

// TLS options for a mail connection: Node's list plus Windows' roots, or nothing (Node's defaults).
function tlsOptions() {
  if (!roots.length) return {};
  if (!caList) caList = tls.rootCertificates.concat(extraFromEnv(), roots);
  return { ca: caList };
}

module.exports = { ready, tlsOptions, count: () => roots.length, parse, use, SCRIPT, EXPORT_SCRIPT, readCerFiles };
