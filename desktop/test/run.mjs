// Desktop app tests. Makes throwaway certificates with openssl, then runs tls.test.cjs with the
// "public" test root trusted the way Node trusts real public authorities (NODE_EXTRA_CA_CERTS),
// then order-mail.test.cjs, powershell.test.cjs and shortcuts.test.cjs.
// With ELECTRON=path/to/electron it runs under Electron's own Node instead (ELECTRON_RUN_AS_NODE).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fafo-certs-"));
const ssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });

function ca(name, cn, org) {
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "3650",
    "-subj", `/O=${org}/CN=${cn}`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
  fs.mkdirSync(path.join(dir, `${name}.db`));
  fs.writeFileSync(path.join(dir, `${name}.db`, "index.txt"), "");
  fs.writeFileSync(path.join(dir, `${name}.db`, "serial"), "1000\n");
  fs.writeFileSync(path.join(dir, `${name}.cnf`), [
    "[ca]", "default_ca = me", "[me]", `dir = ${name}.db`, "database = $dir/index.txt", "serial = $dir/serial", "new_certs_dir = $dir",
    `certificate = ${name}.pem`, `private_key = ${name}.key`, "default_md = sha256", "policy = any", "unique_subject = no",
    "[any]", "commonName = supplied", "[leaf]", "basicConstraints = CA:FALSE", "extendedKeyUsage = serverAuth", "subjectAltName = DNS:${ENV::CN}", ""].join("\n"));
}
function leaf(name, by, cn, start, end) {
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`);
  execFileSync("openssl", ["ca", "-batch", "-config", `${by}.cnf`, "-extensions", "leaf", "-in", `${name}.csr`, "-out", `${name}.pem`, "-startdate", start, "-enddate", end, "-notext"],
    { cwd: dir, env: { ...process.env, CN: cn }, stdio: ["ignore", "ignore", "pipe"] });
}
ca("public", "Test Public Root", "Test");
ca("av", "Avast Mail Shield Root (test copy)", "Test antivirus");
leaf("good", "public", "imap.gmail.com", "20200101000000Z", "20990101000000Z");
leaf("intercepted", "av", "imap.gmail.com", "20200101000000Z", "20990101000000Z");
leaf("expired", "public", "imap.gmail.com", "20240101000000Z", "20250101000000Z");
leaf("future", "public", "imap.gmail.com", "20990101000000Z", "21000101000000Z");
leaf("wrongname", "public", "mail.example.com", "20200101000000Z", "20990101000000Z");
ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "selfsigned.key", "-out", "selfsigned.pem", "-days", "365", "-subj", "/CN=imap.gmail.com", "-addext", "subjectAltName=DNS:imap.gmail.com");

const electron = process.env.ELECTRON;
const cmd = electron || process.execPath;
const env = { ...process.env, CERT_DIR: dir, NODE_EXTRA_CA_CERTS: path.join(dir, "public.pem"), ...(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
console.log(`Running under ${electron ? "Electron " + execFileSync(cmd, ["-p", "process.versions.electron + ' (Node ' + process.versions.node + ')'"], { env }).toString().trim() : "Node " + process.versions.node}`);
let status = 0;
for (const test of ["tls.test.cjs", "order-mail.test.cjs", "powershell.test.cjs", "shortcuts.test.cjs"]) {
  console.log(`\n# ${test}`);
  const r = spawnSync(cmd, [path.join(HERE, test)], { env, stdio: "inherit" });
  if (r.status !== 0) status = 1;
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(status);
