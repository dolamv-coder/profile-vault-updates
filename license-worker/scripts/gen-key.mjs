// Makes the signing key pair for the license worker.
//   node scripts/gen-key.mjs
// The public key goes into the app (LICENSE_AUTO_PUB in index-*.html).
// The private key goes into the worker: npx wrangler secret put LICENSE_SIGNING_KEY
// Keep a backup of the private key somewhere safe and outside git. Without it
// the worker can't sign a key list that installed apps accept.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", publicKey);
const priv = await crypto.subtle.exportKey("jwk", privateKey);
console.log("Public key for the app (LICENSE_AUTO_PUB):");
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }));
console.log("\nPrivate key for the worker (LICENSE_SIGNING_KEY). Secret: don't share or commit it:");
console.log(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d }));
