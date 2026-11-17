// A card number has 16 digits (Target RedCard, Visa, Mastercard, Discover) or 15 (American Express), and the profile
// editor, the card editor and Import cards refuse any other length (page 1.9.155, the owner's request, 2026-11-17:
// "CC only contains 16 digits, do not let buyer save profile until it is entered correctly", with a screenshot of a
// RedCard saved with 17 digits). Runs the newest page's own validateCard, brandOf and luhn in node.
//   node .github/scripts/card-number.test.mjs [path/to/index-X.Y.Z.html]
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const newest = () => readdirSync(".").filter((f) => /^index-\d+\.\d+\.\d+\.html$/.test(f))
  .sort((a, b) => { const p = (f) => f.match(/\d+/g).map(Number); const x = p(a), y = p(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).pop();
const file = process.argv[2] || newest();
const html = readFileSync(file, "utf8");
if (!html.includes("const cardLen = ")) { console.error(`${file} has no cardLen: the card number length check is missing.`); process.exit(1); }

// The page's own functions, cut out by their first line and read up to the next top-level line.
const cut = (start) => {
  const i = html.indexOf(start); assert.ok(i >= 0, start);
  const lines = html.slice(i).split("\n"), out = [lines[0]];
  for (let k = 1; k < lines.length && !/^(function |const |let |\/\/ |async function )/.test(lines[k]); k++) out.push(lines[k]);
  return out.join("\n");
};
const src = ["const digits = (s) => String(s == null ? \"\" : s).replace(/\\D+/g, \"\");",
  cut("function brandOf(num){"), cut("function luhn(num){"), cut("const cardLen = "), cut("function validateCard(c){")].join("\n");
const { validateCard, cardLen } = new Function(`${src}\nreturn { validateCard, cardLen };`)();

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const num = (c) => validateCard(Object.assign({ cvv: "123", redcard: false }, c)).number || "";

console.log(`Card number lengths in ${file}`);
test("a RedCard needs exactly 16 digits (the owner's screenshot had 17)", () => {
  assert.equal(num({ number: "42424242424242424", redcard: true, cvv: "" }), "A RedCard number has 16 digits. This one has 17.");
  assert.equal(num({ number: "424242424242424", redcard: true, cvv: "" }), "A RedCard number has 16 digits. This one has 15.");
  assert.equal(num({ number: "4242424242424242", redcard: true, cvv: "" }), "");
  assert.equal(num({ number: "123456789012", redcard: true, cvv: "" }), "A RedCard number has 16 digits. This one has 12.");
});
test("Visa, Mastercard and Discover need 16 digits, even when a longer number passes the checksum", () => {
  // 4242 4242 4242 4242 4 with a last digit that makes the checksum work, as a typo can.
  const v17 = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => "4242424242424242" + d).find((n) => {
    let s = 0; for (let i = 0; i < n.length; i++) { let x = +n[n.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; } return s % 10 === 0; });
  assert.ok(v17, "a 17-digit number that passes the checksum");
  assert.equal(num({ number: v17 }), "A card number has 16 digits. This one has 17.");
  assert.equal(num({ number: "4242424242424242" }), "");
  assert.equal(num({ number: "5555555555554444" }), "");
  assert.equal(num({ number: "6011111111111117" }), "");
  assert.equal(num({ number: "4222222222222" }), "A card number has 16 digits. This one has 13.");
});
test("American Express needs 15 digits", () => {
  assert.equal(num({ number: "378282246310005", cvv: "1234" }), "");
  assert.equal(num({ number: "3782822463100051", cvv: "1234" }), "An American Express number has 15 digits. This one has 16.");
  assert.equal(cardLen({ number: "378282246310005" }), 15);
  assert.equal(cardLen({ number: "378282246310005", redcard: true }), 16);
});
test("the other checks are as before: none, an unsupported brand, a typo", () => {
  assert.equal(num({ number: "" }), "Enter the card number.");
  assert.equal(num({ number: "3530111333300000" }), "Use a Visa, Mastercard, Amex or Discover card.");
  assert.equal(num({ number: "4242424242424241" }), "This number doesn't look right. Check for a typo.");
});
test("Import cards skips a number of the wrong length, as it skips one that fails the checksum", () => {
  assert.match(html, /if \(r\.number\.length !== cardLen\(r\) \|\| \(!r\.redcard && !luhn\(r\.number\)\)\)\{ invalid\.push\(r\.line\); return; \}/);
});
console.log(`\n${passed} passed`);
