// Tests Export profiles' formats in the newest page (index-X.Y.Z.html), from 1.9.150 (the owner's request, 2026-11-15, with
// a profile converter's "Export Formats" window and each bot's export: "Give me an option to choose what I want to export
// as", then "include these 2 formats too"). The window picks its formats from a list (EXPORT_FORMATS) with a search, each
// picked one downloaded as its own file. The real page runs in Chromium (Playwright), as the web version at
// app.fafoaco.com, on a vault made with Use this browser only, as costco.test.mjs runs it. It checks the list's order,
// names and hints, the search (case and accents ignored, none matching, hidden ticks kept), the picks (FAFO backup alone to
// start, remembered across opening again and a reload, unknown ids dropped, in memory when storage throws, forgotten by
// Erase vault), the note for the formats picked, Copy (one format only), and every format's exact text (each file
// downloaded, with its name, against fixtures written here; Hayha's, Refract's and Valor's ids and Refract's times checked
// by shape, then swapped for fixed ones), Shikari's as the license worker's own shikariCsv writes it, CRLF and no BOM in
// both CSVs, several formats as several files in the list's order, one that fails stopping the rest (its line in view), the
// note in view on opening at a laptop's size, a double click on Download pressing nothing under the window, and a 375 × 667
// phone where the list scrolls and every row can be ticked. Sample data only (Sam Sample, test card numbers).
//   node .github/scripts/export-formats.test.mjs [path/to/index-X.Y.Z.html]
// The newest page must have EXPORT_FORMATS; a page named on the command line that doesn't is skipped.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newest = readdirSync(root).map((f) => /^index-(\d+\.\d+\.\d+)\.html$/.exec(f)).filter(Boolean).map((m) => m[1]).sort(cmp).pop();
const file = process.argv[2] || join(root, `index-${newest}.html`);
const HTML = readFileSync(file, "utf8");
if (!/const EXPORT_FORMATS = \[/.test(HTML)) {
  if (!process.argv[2]) { console.error(`${file} has no EXPORT_FORMATS (Export profiles' list of formats): update this test if that's on purpose`); process.exit(1); }
  console.log(`${file}: no EXPORT_FORMATS, skipped`); process.exit(0);
}
// The app runs inside one function, so the copy served here hands the test a few of its own names (window.__t).
const END = "\ntry { if (window.pvDesktop && window.pvDesktop.appReady) window.pvDesktop.appReady(); } catch(e){}\n})();";
assert.equal(HTML.split(END).length, 2, "couldn't find the end of the app's code");
const PAGE = HTML.replace(END, "\nwindow.__t = {get S(){ return S; }, UI, persist, render, flatProfile, slotRow, slotAycd, SLOT_COLS, EXPORT_FORMATS, openExport, closeAllLayers};" + END);
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch (e) { console.error("This test needs Playwright: npm install --no-save playwright, then npx playwright install chromium"); process.exit(1); }

// The license worker's own Shikari CSV (license-worker/src/index.js): index.js imports cloudflare:sockets, so it doesn't load
// in node; its shikariCsv and what it uses are read from the file and run as they are.
const WSRC = readFileSync(join(root, "license-worker", "src", "index.js"), "utf8");
const fnSrc = (name) => { const i = WSRC.indexOf(`\nfunction ${name}(`); assert.ok(i >= 0, "the worker's " + name); return WSRC.slice(i, WSRC.indexOf("\n}\n", i) + 3); };
const constSrc = (name) => { const i = WSRC.indexOf(`\nconst ${name} = `); assert.ok(i >= 0, "the worker's " + name); return WSRC.slice(i, WSRC.indexOf(";\n", i) + 2); };
const workerShikari = new Function([fnSrc("parseCsv"), constSrc("csvCell"), constSrc("COUNTRIES"), constSrc("US_STATES"), constSrc("CA_PROVINCES"),
  constSrc("SHIKARI_COLS"), constSrc("placeCode"), constSrc("COUNTRY_ALIASES"), fnSrc("shikariCsv"), "return shikariCsv;"].join("\n"))();
// And its HayhaAIO 2.0 file, which Costco's slots go to the seller's channel as (2026-11-18): hayhaFromCsv(slots CSV, the
// page's AYCD list for those rows or null, id maker).
const workerHayha = new Function([fnSrc("parseCsv"), constSrc("COUNTRIES"), constSrc("US_STATES"), constSrc("CA_PROVINCES"), constSrc("placeName"),
  constSrc("aycdState"), constSrc("HAYHA_NORM"), fnSrc("hayhaStateCode"), fnSrc("hayhaPhone"), fnSrc("hayhaFromCsv"), "return hayhaFromCsv;"].join("\n"))();

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } };
const PW = "sample-pass-150";

// ---- The vault: five profiles that export, one skipped (no card). Made-up people and test card numbers.
const ADDR = {
  a1: { first: "Sam", last: "Sample", line1: "123 Sample St", line2: "Apt 4", city: "Austin", state: "TX", zip: "78701", country: "US" },
  a2: { first: "Sam", last: "Sample", line1: "200 Test Ave", line2: "", city: "Austin", state: "TX", zip: "78702", country: "US" },
  a2b: { first: "Pat", last: "Payer", line1: "9 Bill Rd", line2: "Suite 5", city: "Dallas", state: "TX", zip: "75201", country: "US" },
  a3: { first: "Casey", last: "Maple", line1: "1 Maple Rd", line2: "", city: "Toronto", state: "ON", zip: "M5V 2T6", country: "CA" },
  a4: { first: "Riley", last: "Red", line1: "5 Target Way", line2: "", city: "Minneapolis", state: "MN", zip: "55403", country: "US" },
  // Signs at the start of the names and city, a comma and quotes in the street, the state written out.
  a5: { first: "+Sam", last: "-Sample", line1: '7 Quote "Q" St, Unit B', line2: "", city: "@Austin", state: "Texas", zip: "78703", country: "US" },
  a6: { first: "Nora", last: "None", line1: "1 None St", line2: "", city: "Austin", state: "TX", zip: "78704", country: "US" },
};
const CARDS = [
  { id: "c1", nick: "Amex", number: "378282246310005", holder: "Sam Sample", expM: "11", expY: "2033", cvv: "1234" },
  { id: "c2", nick: "Visa", number: "4111111111111111", holder: "", expM: "07", expY: "2030", cvv: "123" },   // no name: the billing name
  { id: "c3", nick: "Casey MC", number: "5555555555554444", holder: "Casey Maple", expM: "12", expY: "2029", cvv: "321" },
  { id: "c4", nick: "RedCard", number: "4000056655665556", holder: "Riley Red", expM: "01", expY: "2032", cvv: "", redcard: true },   // no PIN
  { id: "c5", nick: "Dash JCB", number: "3530111333300000", holder: "Dash Sample", expM: "3", expY: "31", cvv: "045" },
];
const tgt = { store: "target", storeName: "", mode: "login", loginId: null, email: "", verified: false };
const PROFILES = [
  { id: "p1", name: "Sam Amex", groupId: "g1", email: "sam.amex@example.com", phone: "(512) 555-0100", size: "10", oneCheckout: true, shipId: "a1", billSame: true, cardId: "c1", stores: [tgt] },
  { id: "p2", name: "Sam Visa", groupId: "g2", email: "sam.visa@example.com", phone: "+1 512-555-0101", size: "", oneCheckout: false, shipId: "a2", billSame: false, billId: "a2b", cardId: "c2",
    stores: [{ store: "pokemoncenter", storeName: "", mode: "email", loginId: null, email: "sam.visa@example.com", verified: false }] },
  { id: "p3", name: "Casey Canada", groupId: null, email: "casey@example.com", phone: "416-555-0199", size: "", oneCheckout: false, shipId: "a3", billSame: true, cardId: "c3", stores: [tgt] },
  { id: "p4", name: "Red Card", groupId: "g1", email: "riley@example.com", phone: "6125550142", size: "", oneCheckout: true, shipId: "a4", billSame: true, cardId: "c4", stores: [tgt] },
  { id: "p5", name: "=Dash Sample", groupId: null, email: "dash@example.com", phone: "512 555 0102", size: "", oneCheckout: false, shipId: "a5", billSame: true, cardId: "c5", stores: [tgt] },
  { id: "p6", name: "No Card", groupId: null, email: "nora@example.com", phone: "5125550104", size: "", oneCheckout: false, shipId: "a6", billSame: true, cardId: null, stores: [tgt] },
];
const fill = (s) => s.ev(([ADDR, CARDS, PROFILES]) => {
  const { S, persist, render } = window.__t;
  S.groups.push({ id: "g1", name: "Alpha" }, { id: "g2", name: "Beta" });
  for (const [id, a] of Object.entries(ADDR)) S.addresses.push(Object.assign({ id, nick: "" }, a));
  CARDS.forEach((c) => S.cards.push(Object.assign({ createdAt: 1 }, c)));
  PROFILES.forEach((p) => S.profiles.push(Object.assign({ createdAt: 1, updatedAt: 1 }, JSON.parse(JSON.stringify(p)))));
  persist(); render();
}, [ADDR, CARDS, PROFILES]);

// ---- Fixtures: each format's text for the five profiles, in name order (as the window sorts them). Ids and times as
// swapped in by fixIds and fixTimes below.
const U = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const J = (x) => JSON.stringify(x, null, 2);
const ORDER = ["=Dash Sample", "Casey Canada", "Red Card", "Sam Amex", "Sam Visa"];

const hh = (first, last, email, phone, address, address2, country, shortCode, name, city, zipCode) =>
  ({ firstName: first, lastName: last, email, phone, address, address2, country, state: { shortCode, name }, city, zipCode });
const H5 = hh("+Sam", "-Sample", "dash@example.com", "5125550102", '7 Quote "Q" St, Unit B', "", "United States", "TX", "Texas", "@Austin", "78703");
const H3 = hh("Casey", "Maple", "casey@example.com", "4165550199", "1 Maple Rd", "", "Canada", "ON", "Ontario", "Toronto", "M5V 2T6");
const H4 = hh("Riley", "Red", "riley@example.com", "6125550142", "5 Target Way", "", "United States", "MN", "Minnesota", "Minneapolis", "55403");
const H1 = hh("Sam", "Sample", "sam.amex@example.com", "5125550100", "123 Sample St", "Apt 4", "United States", "TX", "Texas", "Austin", "78701");
const H2 = hh("Sam", "Sample", "sam.visa@example.com", "5125550101", "200 Test Ave", "", "United States", "TX", "Texas", "Austin", "78702");
const H2b = hh("Pat", "Payer", "sam.visa@example.com", "5125550101", "9 Bill Rd", "Suite 5", "United States", "TX", "Texas", "Dallas", "75201");
// Hayha's groupId: one per FAFO group (no group is one too): =Dash Sample and Casey Canada share U(1), Alpha U(4), Beta U(7).
const HAYHA = J([
  { name: "=Dash Sample", shipping: H5, cardInfo: { cardNumber: "3530111333300000", holder: "Dash Sample", expMonth: "03", expYear: 2031, cvv: "045" }, oneCheckout: false, sameAsBilling: true, billing: H5, groupId: U(1), id: U(2) },
  { name: "Casey Canada", shipping: H3, cardInfo: { cardNumber: "5555555555554444", holder: "Casey Maple", expMonth: "12", expYear: 2029, cvv: "321" }, oneCheckout: false, sameAsBilling: true, billing: H3, groupId: U(1), id: U(3) },
  { name: "Red Card", shipping: H4, cardInfo: { cardNumber: "4000056655665556", holder: "Riley Red", expMonth: "01", expYear: 2032, cvv: "" }, oneCheckout: true, sameAsBilling: true, billing: H4, groupId: U(4), id: U(5) },
  { name: "Sam Amex", shipping: H1, cardInfo: { cardNumber: "378282246310005", holder: "Sam Sample", expMonth: "11", expYear: 2033, cvv: "1234" }, oneCheckout: true, sameAsBilling: true, billing: H1, groupId: U(4), id: U(6) },
  { name: "Sam Visa", shipping: H2, cardInfo: { cardNumber: "4111111111111111", holder: "Pat Payer", expMonth: "07", expYear: 2030, cvv: "123" }, oneCheckout: false, sameAsBilling: false, billing: H2b, groupId: U(7), id: U(8) },
]);

const hd = (name, email, phone, line1, line2, postCode, city, country, state) => ({ name, email, phone, line1, line2, line3: "", postCode, city, country, state });
const D5 = hd("+Sam -Sample", "dash@example.com", "5125550102", '7 Quote "Q" St, Unit B', "", "78703", "@Austin", "United States", "Texas");
const D3 = hd("Casey Maple", "casey@example.com", "4165550199", "1 Maple Rd", "", "M5V 2T6", "Toronto", "Canada", "Ontario");
const D4 = hd("Riley Red", "riley@example.com", "6125550142", "5 Target Way", "", "55403", "Minneapolis", "United States", "Minnesota");
const D1 = hd("Sam Sample", "sam.amex@example.com", "5125550100", "123 Sample St", "Apt 4", "78701", "Austin", "United States", "Texas");
const D2 = hd("Sam Sample", "sam.visa@example.com", "5125550101", "200 Test Ave", "", "78702", "Austin", "United States", "Texas");
const D2b = hd("Pat Payer", "sam.visa@example.com", "5125550101", "9 Bill Rd", "Suite 5", "75201", "Dallas", "United States", "Texas");
const pd = (nameOnCard, cardType, cardNumber, cardExpMonth, cardExpYear, cardCvv) => ({ nameOnCard, cardType, cardNumber, cardExpMonth, cardExpYear, cardCvv });
const HIDDEN = J([
  { name: "=Dash Sample", notes: "", billingAddress: D5, shippingAddress: D5, paymentDetails: pd("Dash Sample", "JCB", "3530111333300000", "03", "2031", "045"), sameBillingAndShippingAddress: true, onlyCheckoutOnce: false, matchNameOnCardAndAddress: false },
  { name: "Casey Canada", notes: "", billingAddress: D3, shippingAddress: D3, paymentDetails: pd("Casey Maple", "MasterCard", "5555555555554444", "12", "2029", "321"), sameBillingAndShippingAddress: true, onlyCheckoutOnce: false, matchNameOnCardAndAddress: true },
  { name: "Red Card", notes: "", billingAddress: D4, shippingAddress: D4, paymentDetails: pd("Riley Red", "Visa", "4000056655665556", "01", "2032", ""), sameBillingAndShippingAddress: true, onlyCheckoutOnce: true, matchNameOnCardAndAddress: true },
  { name: "Sam Amex", notes: "", billingAddress: D1, shippingAddress: D1, paymentDetails: pd("Sam Sample", "AmericanExpress", "378282246310005", "11", "2033", "1234"), sameBillingAndShippingAddress: true, onlyCheckoutOnce: true, matchNameOnCardAndAddress: true },
  { name: "Sam Visa", notes: "", billingAddress: D2b, shippingAddress: D2, paymentDetails: pd("Pat Payer", "Visa", "4111111111111111", "07", "2030", "123"), sameBillingAndShippingAddress: false, onlyCheckoutOnce: false, matchNameOnCardAndAddress: true },
]);

const rf = (firstName, lastName, address1, address2, city, province, postalCode, country, phone) => ({ firstName, lastName, address1, address2, city, province, postalCode, country, phone });
const SAME = { sameAsShipping: true, firstName: "", lastName: "", address1: "", address2: "", city: "", postalCode: "", phone: "" };
const T0 = 1700000000000, T1 = 1700000001000;
const RF = (name, email, oneTimeUse, shipping, billing, payment, n) => ({ name, email, oneTimeUse, shipping, billing, payment, id: "prf-" + U(n), createdAt: T0, updatedAt: T1 });
const REFRACT = J([
  RF("=Dash Sample", "dash@example.com", false, rf("+Sam", "-Sample", '7 Quote "Q" St, Unit B', "", "@Austin", "Texas", "78703", "United States", "5125550102"), SAME,
    { name: "Dash Sample", num: "3530111333300000", year: "2031", month: "03", cvv: "045" }, 1),
  RF("Casey Canada", "casey@example.com", false, rf("Casey", "Maple", "1 Maple Rd", "", "Toronto", "Ontario", "M5V 2T6", "Canada", "4165550199"), SAME,
    { name: "Casey Maple", num: "5555555555554444", year: "2029", month: "12", cvv: "321" }, 2),
  RF("Red Card", "riley@example.com", true, rf("Riley", "Red", "5 Target Way", "", "Minneapolis", "Minnesota", "55403", "United States", "6125550142"), SAME,
    { name: "Riley Red", num: "4000056655665556", year: "2032", month: "01", cvv: "" }, 3),
  RF("Sam Amex", "sam.amex@example.com", true, rf("Sam", "Sample", "123 Sample St", "Apt 4", "Austin", "Texas", "78701", "United States", "5125550100"), SAME,
    { name: "Sam Sample", num: "378282246310005", year: "2033", month: "11", cvv: "1234" }, 4),
  RF("Sam Visa", "sam.visa@example.com", false, rf("Sam", "Sample", "200 Test Ave", "", "Austin", "Texas", "78702", "United States", "5125550101"),
    Object.assign({ sameAsShipping: false }, rf("Pat", "Payer", "9 Bill Rd", "Suite 5", "Dallas", "Texas", "75201", "United States", "5125550101")),
    { name: "Pat Payer", num: "4111111111111111", year: "2030", month: "07", cvv: "123" }, 5),
]);

// Shikari: what Shikari writes, and the license worker too (a leading = + - @ goes, the month without its 0, codes).
const SHIKARI = [
  "profile_name,first_name,last_name,email,phone_num,cc_number,cc_exp_month,cc_exp_year,cc_cvv,shipping_street,shipping_street_2,shipping_city,shipping_state,shipping_zip_code,shipping_country,billing_first_name,billing_last_name,billing_street,billing_street_2,billing_city,billing_state,billing_zip_code,billing_country",
  'Dash Sample,Sam,Sample,dash@example.com,5125550102,3530111333300000,3,2031,045,"7 Quote ""Q"" St, Unit B",,Austin,TX,78703,US,Sam,Sample,"7 Quote ""Q"" St, Unit B",,Austin,TX,78703,US',
  "Casey Canada,Casey,Maple,casey@example.com,4165550199,5555555555554444,12,2029,321,1 Maple Rd,,Toronto,ON,M5V 2T6,CA,Casey,Maple,1 Maple Rd,,Toronto,ON,M5V 2T6,CA",
  "Red Card,Riley,Red,riley@example.com,6125550142,4000056655665556,1,2032,,5 Target Way,,Minneapolis,MN,55403,US,Riley,Red,5 Target Way,,Minneapolis,MN,55403,US",
  "Sam Amex,Sam,Sample,sam.amex@example.com,5125550100,378282246310005,11,2033,1234,123 Sample St,Apt 4,Austin,TX,78701,US,Sam,Sample,123 Sample St,Apt 4,Austin,TX,78701,US",
  "Sam Visa,Sam,Sample,sam.visa@example.com,5125550101,4111111111111111,7,2030,123,200 Test Ave,,Austin,TX,78702,US,Pat,Payer,9 Bill Rd,Suite 5,Dallas,TX,75201,US",
].map((l) => l + "\r\n").join("");

const st = (firstName, lastName, country, address, address2, state, city, zipcode) => ({ firstName, lastName, country, address, address2, state, city, zipcode });
const S5 = st("+Sam", "-Sample", "US", '7 Quote "Q" St, Unit B', "", "TX", "@Austin", "78703"), S3 = st("Casey", "Maple", "CA", "1 Maple Rd", "", "ON", "Toronto", "M5V 2T6");
const S4 = st("Riley", "Red", "US", "5 Target Way", "", "MN", "Minneapolis", "55403"), S1 = st("Sam", "Sample", "US", "123 Sample St", "Apt 4", "TX", "Austin", "78701");
const S2 = st("Sam", "Sample", "US", "200 Test Ave", "", "TX", "Austin", "78702"), S2b = st("Pat", "Payer", "US", "9 Bill Rd", "Suite 5", "TX", "Dallas", "75201");
const sp = (cardName, cardType, cardNumber, cardMonth, cardYear, cardCvv) => ({ cardName, cardType, cardNumber, cardMonth, cardYear, cardCvv });
const STELLAR = J([
  { profileName: "=Dash Sample", email: "dash@example.com", phone: "5125550102", shipping: S5, billingAsShipping: true, oneCheckoutPerProfile: false, billing: S5, payment: sp("Dash Sample", "", "3530111333300000", "03", "31", "045") },
  { profileName: "Casey Canada", email: "casey@example.com", phone: "4165550199", shipping: S3, billingAsShipping: true, oneCheckoutPerProfile: false, billing: S3, payment: sp("Casey Maple", "MasterCard", "5555555555554444", "12", "29", "321") },
  { profileName: "Red Card", email: "riley@example.com", phone: "6125550142", shipping: S4, billingAsShipping: true, oneCheckoutPerProfile: true, billing: S4, payment: sp("Riley Red", "Visa", "4000056655665556", "01", "32", "") },
  { profileName: "Sam Amex", email: "sam.amex@example.com", phone: "5125550100", shipping: S1, billingAsShipping: true, oneCheckoutPerProfile: true, billing: S1, payment: sp("Sam Sample", "Amex", "378282246310005", "11", "33", "1234") },
  { profileName: "Sam Visa", email: "sam.visa@example.com", phone: "5125550101", shipping: S2, billingAsShipping: false, oneCheckoutPerProfile: false, billing: S2b, payment: sp("Pat Payer", "Visa", "4111111111111111", "07", "30", "123") },
]);

const va = (firstName, lastName, addressLine1, addressLine2, city, countryName, countryCode, state, zipCode) => ({ firstName, lastName, addressLine1, addressLine2, city, countryName, countryCode, state, zipCode });
const V5 = va("+Sam", "-Sample", '7 Quote "Q" St, Unit B', "", "@Austin", "United States", "US", "Texas", "78703"), V3 = va("Casey", "Maple", "1 Maple Rd", "", "Toronto", "Canada", "CA", "Ontario", "M5V 2T6");
const V4 = va("Riley", "Red", "5 Target Way", "", "Minneapolis", "United States", "US", "Minnesota", "55403"), V1 = va("Sam", "Sample", "123 Sample St", "Apt 4", "Austin", "United States", "US", "Texas", "78701");
const V2 = va("Sam", "Sample", "200 Test Ave", "", "Austin", "United States", "US", "Texas", "78702"), V2b = va("Pat", "Payer", "9 Bill Rd", "Suite 5", "Dallas", "United States", "US", "Texas", "75201");
const VP = (n, name, email, phoneNumber, same, one, card, shipping, billing) => [U(n), { name, email, phoneNumber, billingSameAsShipping: same, oneCheckout: one, quickTask: false, card, shipping, billing, id: U(n), totalSpent: 0 }];
const VALOR = J(Object.fromEntries([
  VP(1, "=Dash Sample", "dash@example.com", "512-555-0102", true, false, { holder: "Dash Sample", number: "3530 1113 3330 0000", expiration: "03/31", cvv: "045", type: "unknown" }, V5, V5),
  VP(2, "Casey Canada", "casey@example.com", "416-555-0199", true, false, { holder: "Casey Maple", number: "5555 5555 5555 4444", expiration: "12/29", cvv: "321", type: "mastercard" }, V3, V3),
  VP(3, "Red Card", "riley@example.com", "612-555-0142", true, true, { holder: "Riley Red", number: "4000 0566 5566 5556", expiration: "01/32", cvv: "", type: "visa" }, V4, V4),
  VP(4, "Sam Amex", "sam.amex@example.com", "512-555-0100", true, true, { holder: "Sam Sample", number: "3782 822463 10005", expiration: "11/33", cvv: "1234", type: "amex" }, V1, V1),
  VP(5, "Sam Visa", "sam.visa@example.com", "512-555-0101", false, false, { holder: "Pat Payer", number: "4111 1111 1111 1111", expiration: "07/30", cvv: "123", type: "visa" }, V2, V2b),
]));

// FAFO's own AYCD JSON: the phone as typed, Amex and RedCard, the year as saved, the group, no name on card without one.
const ay = (name, email, phone, line1, line2, postCode, city, country, state) => ({ name, email, phone, line1, line2, line3: "", postCode, city, country, state });
const A5 = ay("+Sam -Sample", "dash@example.com", "512 555 0102", '7 Quote "Q" St, Unit B', "", "78703", "@Austin", "United States", "Texas");
const A3 = ay("Casey Maple", "casey@example.com", "416-555-0199", "1 Maple Rd", "", "M5V 2T6", "Toronto", "Canada", "Ontario");
const A4 = ay("Riley Red", "riley@example.com", "6125550142", "5 Target Way", "", "55403", "Minneapolis", "United States", "Minnesota");
const A1 = ay("Sam Sample", "sam.amex@example.com", "(512) 555-0100", "123 Sample St", "Apt 4", "78701", "Austin", "United States", "Texas");
const A2 = ay("Sam Sample", "sam.visa@example.com", "+1 512-555-0101", "200 Test Ave", "", "78702", "Austin", "United States", "Texas");
const A2b = ay("Pat Payer", "sam.visa@example.com", "+1 512-555-0101", "9 Bill Rd", "Suite 5", "75201", "Dallas", "United States", "Texas");
const AY = (name, size, profileGroup, b, s, payment, same, once) => ({ name, size, profileGroup, billingAddress: b, shippingAddress: s, paymentDetails: payment, sameBillingAndShippingAddress: same, onlyCheckoutOnce: once, matchNameOnCardAndAddress: false });
const AYCD = J([
  AY("=Dash Sample", "", "", A5, A5, pd("Dash Sample", "JCB", "3530111333300000", "03", "31", "045"), true, false),
  AY("Casey Canada", "", "", A3, A3, pd("Casey Maple", "MasterCard", "5555555555554444", "12", "2029", "321"), true, false),
  AY("Red Card", "", "Alpha", A4, A4, pd("Riley Red", "RedCard", "4000056655665556", "01", "2032", ""), true, true),
  AY("Sam Amex", "10", "Alpha", A1, A1, pd("Sam Sample", "Amex", "378282246310005", "11", "2033", "1234"), true, true),
  AY("Sam Visa", "", "Beta", A2b, A2, pd("", "Visa", "4111111111111111", "07", "2030", "123"), false, false),
]);

// AYCD's Google Sheet: its 29 columns, the values Hidden's are, the size last.
const GSHEET = [
  "Email Address,Profile Name,Only One Checkout,Name on Card,Card Type,Card Number,Expiration Month,Expiration Year,CVV,Same Billing/Shipping,Shipping Name,Shipping Phone,Shipping Address,Shipping Address 2,Shipping Address 3,Shipping Post Code,Shipping City,Shipping State,Shipping Country,Billing Name,Billing Phone,Billing Address,Billing Address 2,Billing Address 3,Billing Post Code,Billing City,Billing State,Billing Country,Size (Optional)",
  'dash@example.com,=Dash Sample,false,Dash Sample,JCB,3530111333300000,03,2031,045,true,+Sam -Sample,5125550102,"7 Quote ""Q"" St, Unit B",,,78703,@Austin,Texas,United States,+Sam -Sample,5125550102,"7 Quote ""Q"" St, Unit B",,,78703,@Austin,Texas,United States,',
  "casey@example.com,Casey Canada,false,Casey Maple,MasterCard,5555555555554444,12,2029,321,true,Casey Maple,4165550199,1 Maple Rd,,,M5V 2T6,Toronto,Ontario,Canada,Casey Maple,4165550199,1 Maple Rd,,,M5V 2T6,Toronto,Ontario,Canada,",
  "riley@example.com,Red Card,true,Riley Red,Visa,4000056655665556,01,2032,,true,Riley Red,6125550142,5 Target Way,,,55403,Minneapolis,Minnesota,United States,Riley Red,6125550142,5 Target Way,,,55403,Minneapolis,Minnesota,United States,",
  "sam.amex@example.com,Sam Amex,true,Sam Sample,AmericanExpress,378282246310005,11,2033,1234,true,Sam Sample,5125550100,123 Sample St,Apt 4,,78701,Austin,Texas,United States,Sam Sample,5125550100,123 Sample St,Apt 4,,78701,Austin,Texas,United States,10",
  "sam.visa@example.com,Sam Visa,false,Pat Payer,Visa,4111111111111111,07,2030,123,false,Sam Sample,5125550101,200 Test Ave,,,78702,Austin,Texas,United States,Pat Payer,5125550101,9 Bill Rd,Suite 5,,75201,Dallas,Texas,United States,",
].map((l) => l + "\r\n").join("");

// FAFO CSV, as before 1.9.150: the values as saved, CRLF between lines and none after the last.
const NO_BILL = ",,,,,,,,";
const FAFO_CSV = [
  "profile_name,group,email,phone,ship_nickname,ship_first_name,ship_last_name,ship_address1,ship_address2,ship_city,ship_state,ship_zip,ship_country,billing_same_as_shipping,bill_nickname,bill_first_name,bill_last_name,bill_address1,bill_address2,bill_city,bill_state,bill_zip,bill_country,card_nickname,card_holder,card_number,card_exp_month,card_exp_year,card_cvv,card_is_redcard",
  `=Dash Sample,,dash@example.com,512 555 0102,,+Sam,-Sample,"7 Quote ""Q"" St, Unit B",,@Austin,Texas,78703,US,true,${NO_BILL},Dash JCB,Dash Sample,3530111333300000,03,31,045,false`,
  `Casey Canada,,casey@example.com,416-555-0199,,Casey,Maple,1 Maple Rd,,Toronto,ON,M5V 2T6,CA,true,${NO_BILL},Casey MC,Casey Maple,5555555555554444,12,2029,321,false`,
  `Red Card,Alpha,riley@example.com,6125550142,,Riley,Red,5 Target Way,,Minneapolis,MN,55403,US,true,${NO_BILL},RedCard,Riley Red,4000056655665556,01,2032,,true`,
  `Sam Amex,Alpha,sam.amex@example.com,(512) 555-0100,,Sam,Sample,123 Sample St,Apt 4,Austin,TX,78701,US,true,${NO_BILL},Amex,Sam Sample,378282246310005,11,2033,1234,false`,
  "Sam Visa,Beta,sam.visa@example.com,+1 512-555-0101,,Sam,Sample,200 Test Ave,,Austin,TX,78702,US,false,,Pat,Payer,9 Bill Rd,Suite 5,Dallas,TX,75201,US,Visa,,4111111111111111,07,2030,123,false",
].join("\r\n");

// FAFO backup (JSON), as before 1.9.150: every profile as flatProfile writes it.
const fa = (a) => ({ nickname: "", firstName: a.first, lastName: a.last, address1: a.line1, address2: a.line2, city: a.city, state: a.state, zip: a.zip, country: a.country });
const fc = (c, brand) => ({ nickname: c.nick, holder: c.holder, number: c.number, expMonth: c.expM.padStart(2, "0"), expYear: c.expY, cvv: c.cvv, brand, isRedCard: !!c.redcard,
  virtual: false, vProvider: "", vFunding: "", vMerchant: "", vLimit: "" });
const TARGET = [{ store: "Target", storeId: "target", mode: "login", email: "", verified: false, login: null }];
const FP = (p, group, ship, bill, card, retailers) => ({ name: p.name, group, email: p.email, phone: p.phone, size: p.size, onlyCheckoutOnce: p.oneCheckout, shipping: fa(ship),
  billingSameAsShipping: p.billSame, billing: bill ? fa(bill) : null, card, logins: [], checkouts: [], retailers });
const P = Object.fromEntries(PROFILES.map((p) => [p.id, p])), C = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const FAFO_JSON = J({ format: "profile-vault", version: 1, exportedAt: "2026-01-01T00:00:00.000Z", profiles: [
  FP(P.p5, "", ADDR.a5, null, fc(C.c5, "jcb"), TARGET),
  FP(P.p3, "", ADDR.a3, null, fc(C.c3, "mastercard"), TARGET),
  FP(P.p4, "Alpha", ADDR.a4, null, fc(C.c4, "redcard"), TARGET),
  FP(P.p1, "Alpha", ADDR.a1, null, fc(C.c1, "amex"), TARGET),
  FP(P.p2, "Beta", ADDR.a2, ADDR.a2b, fc(C.c2, "visa"), [{ store: "Pokémon Center", storeId: "pokemoncenter", mode: "email", email: "sam.visa@example.com", verified: false, login: null }]),
] });

const FORMATS = [
  ["hayha", "HayhaAIO 2.0", "Hayha's profile import (.Hayha file)", "hayha.Hayha", HAYHA],
  ["hidden", "Hidden AIO", "Hidden's profile import", "hidden.json", HIDDEN],
  ["refract", "Refract", "Refract's profile import", "refract.json", REFRACT],
  ["shikari", "Shikari", "Shikari's profile CSV", "shikari.csv", SHIKARI],
  ["stellar", "StellarAIO", "Stellar's profile import", "stellar.json", STELLAR],
  ["valor", "Valor", "Valor's profile import, into a profile group", "valor.json", VALOR],
  ["aycd", "AYCD", "AYCD Profile Converter (JSON)", "aycd.json", AYCD],
  ["gsheet", "CSV/Google Sheet/Form", "AYCD's Google Sheet columns", "googlesheet.csv", GSHEET],
  ["csv", "FAFO CSV", "Spreadsheets, with store logins and inboxes", "csv", FAFO_CSV],
  ["json", "FAFO backup (JSON)", "Back up, or import into FAFO again", "json", FAFO_JSON],
];
const fileName = (id, day) => { const x = FORMATS.find((f) => f[0] === id)[3]; return `profiles-${day}${id === "csv" || id === "json" ? "." : "-"}${x}`; };

// Random ids (v4 UUIDs) in the order they first show, swapped for U(1), U(2)…; Refract's times for T0 and T1 (checked: the
// same for each profile, a second apart, now); the backup's exportedAt for a fixed one.
const V4ID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
function fixIds(text) {
  const ids = [];
  for (const m of text.matchAll(V4ID)) if (!ids.includes(m[0])) ids.push(m[0]);
  let out = text;
  ids.forEach((id, i) => { out = out.split(id).join(U(i + 1)); });
  return { text: out, ids };
}
function fixTimes(id, text, t) {
  if (id === "refract") {
    const list = JSON.parse(text);
    for (const x of list) {
      assert.match(x.id, /^prf-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "Refract's id: prf- and a v4 UUID");
      assert.equal(typeof x.createdAt, "number"); assert.equal(x.updatedAt - x.createdAt, 1000, "updatedAt a second after createdAt");
      assert.ok(Math.abs(x.updatedAt - t) < 120000, "updatedAt is now");
      assert.equal(x.createdAt, list[0].createdAt);
    }
    return text.replace(/"createdAt": \d+/g, `"createdAt": ${T0}`).replace(/"updatedAt": \d+/g, `"updatedAt": ${T1}`);
  }
  if (id === "json") {
    const at = JSON.parse(text).exportedAt;
    assert.ok(Math.abs(Date.parse(at) - t) < 120000 && new Date(at).toISOString() === at, "exportedAt is now, as an ISO date");
    return text.replace(`"exportedAt": "${at}"`, '"exportedAt": "2026-01-01T00:00:00.000Z"');
  }
  return text;
}
// One format's text as FAFO made it, against its fixture.
function check(id, text, t) {
  const want = FORMATS.find((f) => f[0] === id)[4];
  if (["hayha", "refract", "valor"].includes(id)) {
    const { text: fixed, ids } = fixIds(text);
    assert.equal(ids.length, { hayha: 8, refract: 5, valor: 5 }[id], id + ": a new v4 UUID for each id (and Hayha's for each group)");
    if (id === "hayha") {
      const list = JSON.parse(text);
      assert.deepEqual(list.map((x) => typeof x.cardInfo.expYear), Array(5).fill("number"), "Hayha's expYear is a number");
      assert.equal(new Set(list.map((x) => x.groupId)).size, 3, "one groupId per group: Alpha, Beta and no group");
      assert.equal(list[0].groupId, list[1].groupId); assert.equal(list[2].groupId, list[3].groupId); assert.notEqual(list[0].groupId, list[2].groupId);
      assert.equal(new Set(list.map((x) => x.id)).size, 5);
    }
    text = fixed;
  }
  assert.equal(text.charCodeAt(0) === 0xfeff, false, id + ": no BOM");
  assert.equal(fixTimes(id, text, t), want, id + ": the exact text");
}

// ---- The browser
const browser = await chromium.launch();
const errors = [];
async function session(name, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === "https://app.fafoaco.com") return u.pathname === "/" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }) : route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, body: "" });   // no license key here: nothing is asked of the license server
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("orbit-guide", JSON.stringify({ later: Date.UTC(2100, 0, 1) })); } catch (e) {}   // walkthrough.test.mjs tests the guide
    try { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + String(e)));
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  const s = {
    ctx, page, downloads,
    ev: (fn, arg) => page.evaluate(fn, arg),
    text: (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()),
    ready: () => page.waitForSelector('#side [data-id="orders"]', { state: "attached", timeout: 30000 }),
    async create() {   // a new vault with Use this browser only (once erased, the lock screen asks for its password at once)
      if (await page.$("#lock-local")) await page.click("#lock-local");
      await page.waitForFunction(() => document.activeElement && document.activeElement.id === "pw1");
      await page.fill("#pw1", PW); await page.fill("#pw2", PW); await page.click("#lock-go");
      await s.ready();
    },
    // Export profiles, from Profiles' selection bar with every profile selected (its Which profiles: Selected profiles).
    async open() {
      await page.click('#side [data-id="profiles"]');
      await page.waitForSelector('#main [data-act="sel-all"]');
      if (!(await page.$eval('#main [data-act="sel-all"]', (b) => b.checked))) await page.click('#main [data-act="sel-all"]');
      await page.click('#bulkbar [data-act="bulk-export"]');
      await page.waitForSelector("#ex-fmts");
      await page.waitForTimeout(100);
    },
    picks: () => page.$$eval('#ex-fmts input[name="fmt"]:checked', (l) => l.map((b) => b.value)),
    async pick(ids) {
      for (const b of await page.$$('#ex-fmts input[name="fmt"]')) {
        const v = await b.getAttribute("value");
        if ((await b.isChecked()) !== ids.includes(v)) { await b.scrollIntoViewIfNeeded(); await b.click(); }
      }
    },
    note: () => s.text("#ex-note"),
    async close() { await ctx.close(); },
  };
  await page.goto("https://app.fafoaco.com/");
  return s;
}
const layers = (s) => s.page.$$eval("#layers .layer.is-open", (l) => l.length);
// How far an element is inside its window's visible area (its .panel-body), top and bottom: both 0 or more when it's in view.
const inBody = (s, sel) => s.page.$eval(sel, (e) => { const b = e.closest(".panel-body").getBoundingClientRect(), r = e.getBoundingClientRect();
  return { top: Math.round(r.top - b.top), bottom: Math.round(b.bottom - r.bottom) }; });
const today = (s) => s.ev(() => new Date().toISOString().slice(0, 10));
const READY = "5 profiles ready (1 skipped).";
const ONE = " The file includes full card numbers and CVVs in plain text, so delete it once you're done.";
const MANY = " The files include full card numbers and CVVs in plain text, so delete them once you're done.";

console.log(`Export profiles' formats in ${file.split(/[\\/]/).pop()}`);
try {
  let s = await session("desktop");
  await s.create();
  await fill(s);

  await test("the list: the bots alphabetically, then AYCD's two, then FAFO's own, each with its hint; FAFO backup ticked to start", async () => {
    await s.open();
    assert.equal(await s.text("#layers .layer:last-child .panel-head h2"), "Export profiles");
    const rows = await s.page.$$eval("#ex-fmts .ex-row", (l) => l.map((r) => [r.querySelector("input").value, r.querySelector(".ex-nm").textContent, r.querySelector(".ex-hint").textContent]));
    assert.deepEqual(rows, FORMATS.map((f) => f.slice(0, 3)));
    assert.deepEqual(await s.picks(), ["json"]);
    assert.equal(await s.text("#ex-fmts-l"), "Export formats");
    assert.equal(await s.text("#ex-fmts-d"), "Pick one or more. Each one downloads as its own file.");
    assert.equal(await s.page.$eval("#ex-find", (i) => [i.type, i.labels[0].textContent, i.labels[0].className].join("|")), "search|Search formats|sr");
    assert.equal(await s.note(), READY + ONE);
    assert.equal(await s.text("#ex-dl"), "Download");
    assert.equal(await s.page.$eval("#ex-copy", (b) => b.disabled), false);
    // About seven rows show on a desktop; the rest scroll inside the list.
    const box = await s.page.$eval("#ex-fmts", (e) => ({ h: e.clientHeight, sh: e.scrollHeight, row: e.querySelector(".ex-row").offsetHeight }));
    assert.ok(box.sh > box.h && box.h / box.row >= 6 && box.h / box.row <= 8, `about 7 rows show (${(box.h / box.row).toFixed(1)})`);
  });

  await test("the search filters by name and hint, case and accents ignored; none matching says so; hidden rows keep their ticks", async () => {
    const shown = () => s.page.$$eval("#ex-fmts .ex-row:not([hidden]) input", (l) => l.map((b) => b.value));
    const find = async (q) => { await s.page.fill("#ex-find", q); return shown(); };
    assert.deepEqual(await find("hayha"), ["hayha"]);
    assert.deepEqual(await find("GOOGLE"), ["gsheet"]);
    assert.deepEqual(await find("Válor"), ["valor"]);
    assert.deepEqual(await find("  STELLAR  "), ["stellar"]);
    assert.deepEqual(await find("backup"), ["json"]);
    assert.deepEqual(await find("profile import"), ["hayha", "hidden", "refract", "stellar", "valor"], "words in the hint");
    assert.deepEqual(await find("aycd"), ["aycd", "gsheet"]);
    assert.equal(await s.page.$eval("#ex-none", (e) => e.hidden), true);
    assert.deepEqual(await find("zzz"), []);
    assert.equal(await s.page.$eval("#ex-none", (e) => e.hidden), false);
    assert.equal(await s.text("#ex-none"), "No format matches.");
    // Tick Refract, then search for something else: Refract keeps its tick, and Download counts it.
    await find("refract"); await s.page.click('#ex-fmts input[value="refract"]');
    assert.deepEqual(await find("valor"), ["valor"]);
    assert.deepEqual(await s.picks(), ["refract", "json"]);
    assert.equal(await s.text("#ex-dl"), "Download 2 files");
    assert.deepEqual(await find(""), FORMATS.map((f) => f[0]));
    // Typing doesn't move the search box: the list keeps its height while a search is typed, and gives it back when cleared.
    const at = () => s.page.$eval("#ex-find", (i) => Math.round(i.getBoundingClientRect().top));
    const tall = () => s.page.$eval("#ex-fmts", (l) => Math.round(l.getBoundingClientRect().height));
    const top0 = await at(), h0 = await tall();
    for (const q of ["s", "sh", "shi", "shikari", "zzz"]) {
      await find(q);
      assert.equal(await at(), top0, `the search box stays put with "${q}" typed`);
      assert.equal(await tall(), h0, `the list keeps its height with "${q}" typed`);
    }
    await find("");
    assert.equal(await s.page.$eval("#ex-fmts", (l) => l.style.height), "", "cleared: the list's height is its own again");
    assert.equal(await at(), top0);
  });

  await test("the note names what the picked formats leave out; Copy only with one format; none picked: nothing to do", async () => {
    await s.pick(["json"]);
    assert.equal(await s.note(), READY + ONE);
    await s.pick(["aycd"]);
    assert.equal(await s.note(), READY + ONE + " Store logins aren't part of AYCD's profile format, so they're left out.");
    await s.pick(["valor"]);
    assert.equal(await s.note(), READY + ONE + " Store logins and groups aren't part of Valor's profile format, so they're left out. In Valor, import it into a profile group, with the Import beside the group's name.");
    await s.pick(["stellar"]);
    assert.equal(await s.note(), READY + ONE + " Store logins and groups aren't part of StellarAIO's profile format, so they're left out. One has a card Stellar doesn't take: it takes Visa, Mastercard, Amex and Discover."
      + " One Target RedCard has no PIN: Stellar takes a RedCard's PIN as its CVV, so add it as the card's CVV in Cards.");
    await s.pick(["csv"]);
    assert.equal(await s.note(), READY + ONE + " In Excel, import card columns as text so numbers aren't rounded.");
    await s.pick(["hayha"]);
    assert.equal(await s.note(), READY + ONE + " Store logins aren't part of HayhaAIO 2.0's profile format, so they're left out.");
    await s.pick(["hayha", "refract", "valor", "aycd"]);
    assert.equal(await s.note(), READY + MANY + " Store logins aren't part of HayhaAIO 2.0's, Refract's, Valor's and AYCD's profile formats, and groups aren't part of Refract's and Valor's, so they're left out."
      + " In Valor, import its file into a profile group, with the Import beside the group's name.");
    await s.pick(["hidden", "shikari", "gsheet", "json"]);
    assert.equal(await s.note(), READY + MANY + " Store logins and groups aren't part of Hidden AIO's, Shikari's and the Google Sheet's profile formats, so they're left out. In Excel, import card columns as text so numbers aren't rounded.");
    assert.equal(await s.text("#ex-dl"), "Download 4 files");
    assert.deepEqual(await s.page.$eval("#ex-copy", (b) => [b.disabled, b.title]), [true, "Copy works with one format at a time"]);
    await s.pick([]);
    assert.equal(await s.note(), "Pick a format to export.");
    assert.deepEqual(await s.page.$eval("#ex-dl", (b) => [b.disabled, b.textContent.trim()]), [true, "Download"]);
    assert.equal(await s.page.$eval("#ex-copy", (b) => b.disabled), true);
    await s.pick(["shikari"]);
    assert.deepEqual(await s.page.$eval("#ex-copy", (b) => [b.disabled, b.hasAttribute("title")]), [false, false]);
    await s.page.uncheck("#ex-skip");
    assert.equal(await s.note(), "6 profiles ready." + ONE + " Store logins and groups aren't part of Shikari's profile format, so they're left out.");
    await s.page.check("#ex-skip");
  });

  // The review of 1.9.150: at a laptop's size the list pushed the note (the card warning, and why Download is off with
  // nothing picked) out of the window's view on opening. Wider than a phone, the list gives up height first.
  await test("a laptop's window (1366 × 768, 1280 × 860, 1440 × 900): the note shows on opening, the list keeps 3 rows or more", async () => {
    for (const [width, height] of [[1366, 768], [1280, 860], [1440, 900]]) {
      for (const ids of [[], ["hayha", "refract", "valor", "aycd"]]) {
        const at = `${width} × ${height}, ${ids.length} picked`;
        await s.ev(() => window.__t.closeAllLayers());
        await s.page.setViewportSize({ width, height });
        await s.ev((v) => localStorage.setItem("orbit-export-fmts", JSON.stringify(v)), ids.length ? ids : ["json"]);
        await s.open();
        if (!ids.length) await s.page.$eval('#ex-fmts input[value="json"]', (b) => b.click());   // no scrolling, as Playwright's click might
        assert.deepEqual(await s.picks(), ids, at);
        assert.match(await s.note(), ids.length ? /^5 profiles ready \(1 skipped\)\. The files .* In Valor, import its file/ : /^Pick a format to export\.$/, at);
        assert.equal(await s.page.$eval(".panel-body", (b) => b.scrollTop), 0, at + ": the window's body isn't scrolled");
        const v = await inBody(s, "#ex-note");
        assert.ok(v.top >= 0 && v.bottom >= 0, `${at}: the note is in view (${JSON.stringify(v)})`);
        const rows = await s.page.$eval("#ex-fmts", (e) => e.clientHeight / e.querySelector(".ex-row").offsetHeight);
        assert.ok(rows >= 2.9, `${at}: the list shows 3 rows or more (${rows.toFixed(1)})`);
      }
    }
    await s.ev(() => window.__t.closeAllLayers());
    await s.page.setViewportSize({ width: 1280, height: 900 });
  });

  // One format: Download saves and closes the window, which is inert while it fades, so a double click's second click
  // used to press what's under Download, at 1280 × 900 the selection bar's Delete ("Delete 6 profiles?").
  await test("a double click on Download saves one file and presses nothing under it; a click right after still goes through", async () => {
    await s.open();
    await s.pick(["shikari"]);
    const n = s.downloads.length;
    const at = await s.page.$eval("#ex-dl", (b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await s.page.mouse.dblclick(at.x, at.y);
    await s.page.waitForTimeout(50);
    // What's under Download outside the windows, and what the second click opened.
    const { under, opened } = await s.page.evaluate(({ x, y }) => { const e = document.elementsFromPoint(x, y).find((x) => !x.closest("#layers")), a = e && e.closest("[data-act]");
      return { under: a ? a.dataset.act : e && e.tagName, opened: [...document.querySelectorAll("#layers .layer h2")].map((h) => h.textContent).filter((t) => t !== "Export profiles") }; }, at);
    assert.deepEqual(opened, [], `nothing under Download was pressed (under it: ${under}; opened: ${opened.join(", ")})`);
    await s.page.click('#bulkbar [data-act="bulk-export"]', { timeout: 5000 });   // at once: a click on its own isn't dropped
    await s.page.waitForFunction(() => document.querySelectorAll("#ex-fmts").length === 1 && document.querySelector("#layers .layer.is-open #ex-fmts"));
    await s.page.waitForTimeout(400);
    assert.equal(s.downloads.length, n + 1, "one file");
    assert.equal(s.downloads[n].suggestedFilename(), fileName("shikari", await today(s)));
    assert.equal(await layers(s), 1, "only Export profiles again");
    assert.equal(await s.text("#layers .layer.is-open .panel-head h2"), "Export profiles");
    assert.deepEqual(await s.picks(), ["shikari"]);
  });

  await test("Copy: one format's exact text, then the window closes and remembers the pick", async () => {
    await s.pick(["hayha"]);
    const t = Date.now();
    await s.page.click("#ex-copy");
    await s.page.waitForFunction(() => !document.querySelector("#ex-fmts"));
    check("hayha", await s.ev(() => window.__copied), t);
    await s.open();
    assert.deepEqual(await s.picks(), ["hayha"]);
  });

  await test("Download, one format: its file, named as before (FAFO backup) or for its bot (HayhaAIO 2.0's .Hayha, application/octet-stream)", async () => {
    // blobSave's type: a name it doesn't know (.Hayha) is application/octet-stream, so a browser adds no extension to it.
    await s.ev(() => { window.__types = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__types.push(b.type); return orig(b); }; });
    for (const id of ["json", "hayha", "csv"]) {
      await s.pick([id]);
      const n = s.downloads.length, t = Date.now();
      await s.page.click("#ex-dl");
      await s.page.waitForFunction(() => !document.querySelector("#ex-fmts"));
      await s.page.waitForTimeout(200);
      assert.equal(s.downloads.length, n + 1);
      const d = s.downloads[n];
      assert.equal(d.suggestedFilename(), fileName(id, await today(s)));
      check(id, readFileSync(await d.path(), "utf8"), t);
      await s.open();
      assert.deepEqual(await s.picks(), [id]);
    }
    assert.deepEqual(await s.ev(() => window.__types), ["application/json", "application/octet-stream", "text/csv"]);
  });

  await test("Download, every format: ten files one after another in the list's order, each its exact text; one toast", async () => {
    await s.pick(FORMATS.map((f) => f[0]));
    assert.equal(await s.text("#ex-dl"), "Download 10 files");
    const n = s.downloads.length, t = Date.now();
    await s.page.click("#ex-dl");
    await s.page.waitForFunction(() => !document.querySelector("#ex-fmts"), null, { timeout: 30000 });
    await s.page.waitForTimeout(300);
    const got = s.downloads.slice(n);
    const day = await today(s);
    assert.deepEqual(got.map((d) => d.suggestedFilename()), FORMATS.map((f) => fileName(f[0], day)));
    for (let i = 0; i < got.length; i++) check(FORMATS[i][0], readFileSync(await got[i].path(), "utf8"), t);
    assert.equal(Date.now() - t >= 9 * 650, true, "about 700 ms apart");
    const toasts = await s.page.$$eval(".toast", (l) => l.map((x) => x.textContent));
    assert.ok(toasts.includes("Downloaded 10 files"), toasts.join(" | "));
    assert.equal(toasts.filter((x) => /^Saved /.test(x)).length, 0, "no toast per file");
  });

  await test("the CSVs (Shikari's, the Google Sheet's): CRLF after every line, the last too, and no BOM", async () => {
    for (const id of ["shikari", "gsheet"]) {
      const text = await s.ev((id) => { const T = window.__t; const ps = T.S.profiles.filter((p) => p.cardId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        return T.EXPORT_FORMATS.find((f) => f.id === id).make(ps.map(T.flatProfile)); }, id);
      assert.equal(text, FORMATS.find((f) => f[0] === id)[4]);
      assert.equal(text.replace(/\r\n/g, "").includes("\n") || text.replace(/\r\n/g, "").includes("\r"), false, id + ": no bare line breaks");
      assert.ok(text.endsWith("\r\n") && text.charCodeAt(0) !== 0xfeff);
    }
  });

  await test("Shikari's CSV is the license worker's own (shikariCsv on a slots CSV of the same profiles)", async () => {
    const { slots, mine } = await s.ev(() => {
      const T = window.__t, cell = (v) => { const x = String(v == null ? "" : v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const ps = T.S.profiles.filter((p) => p.cardId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      return { slots: [T.SLOT_COLS.join(",")].concat(ps.map((p) => T.slotRow({ p, e: p.stores[0], l: null }).map(cell).join(","))).join("\r\n"),
        mine: T.EXPORT_FORMATS.find((f) => f.id === "shikari").make(ps.map(T.flatProfile)) };
    });
    assert.equal(workerShikari(slots), mine);
    assert.equal(mine, SHIKARI);
  });

  await test("Costco's .Hayha file in the seller's channel is this HayhaAIO 2.0 export (the worker's hayhaFromCsv on a slots CSV of the same profiles)", async () => {
    // The page's HayhaAIO 2.0 export of the profiles, all in one group (the worker puts a batch's profiles in one Hayha group),
    // and its slots CSV and AYCD list for them, as Submit sends them; with the AYCD list the worker's file is the same, ids
    // swapped in order. Without one (a page before 1.9.87), the name on card is the billing name and Only one checkout is off.
    const { slots, aycd, mine, older } = await s.ev(() => {
      const T = window.__t, cell = (v) => { const x = String(v == null ? "" : v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const ps = T.S.profiles.filter((p) => p.cardId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      const rows = ps.map((p) => ({ p, e: p.stores[0], l: null })), hayha = T.EXPORT_FORMATS.find((f) => f.id === "hayha");
      const flat = ps.map((p) => Object.assign(T.flatProfile(p), { group: "" }));
      return { slots: [T.SLOT_COLS.join(",")].concat(rows.map((r) => T.slotRow(r).map(cell).join(","))).join("\r\n"), aycd: rows.map(T.slotAycd), mine: hayha.make(flat),
        older: hayha.make(flat.map((f) => Object.assign({}, f, { onlyCheckoutOnce: false, card: Object.assign({}, f.card, { holder: "" }) }))) };
    });
    const fixed = (text) => fixIds(text).text;
    let n = 0;
    const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;
    assert.equal(fixed(workerHayha(slots, aycd, id)), fixed(mine));
    assert.equal(fixIds(mine).ids.length, 6, "one group and five profiles");
    assert.equal(fixed(workerHayha(slots, null, id)), fixed(older));
    assert.notEqual(fixed(mine), fixed(older), "the AYCD list's names on card and Only one checkout count");
    // As the export's fixture, but for the one group.
    const one = fixIds(HAYHA.replace(/"groupId": "[^"]+"/g, '"groupId": "' + "f".repeat(8) + "-ffff-4fff-8fff-" + "f".repeat(12) + '"')).text;
    assert.equal(fixed(workerHayha(slots, aycd, id)), one);
  });

  await test("the picks are remembered across a reload, unknown ids are dropped, and storage that throws keeps them in memory", async () => {
    await s.page.reload();
    await s.page.waitForSelector("#pw1");
    await s.page.fill("#pw1", PW);
    await s.ready();
    await s.open();
    assert.deepEqual(await s.picks(), FORMATS.map((f) => f[0]));
    assert.deepEqual(JSON.parse(await s.ev(() => localStorage.getItem("orbit-export-fmts"))), FORMATS.map((f) => f[0]));
    await s.ev(() => window.__t.closeAllLayers());
    await s.ev(() => localStorage.setItem("orbit-export-fmts", JSON.stringify(["nope", "valor", "toString", "stellar"])));
    await s.open();
    assert.deepEqual(await s.picks(), ["stellar", "valor"]);
    await s.ev(() => window.__t.closeAllLayers());
    await s.ev(() => localStorage.setItem("orbit-export-fmts", JSON.stringify(["nope"])));
    await s.open();
    assert.deepEqual(await s.picks(), ["json"]);
    await s.ev(() => window.__t.closeAllLayers());
    await s.ev(() => localStorage.setItem("orbit-export-fmts", "{not json"));
    await s.open();
    assert.deepEqual(await s.picks(), ["json"]);
    // Storage that throws (a private window): the picks last in memory.
    await s.ev(() => { const g = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === "orbit-export-fmts") throw new Error("blocked"); return g.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === "orbit-export-fmts") throw new Error("blocked"); return set.call(this, k, v); }; });
    await s.pick(["refract"]);
    await s.page.click("#ex-copy");
    await s.page.waitForFunction(() => !document.querySelector("#ex-fmts"));
    await s.open();
    assert.deepEqual(await s.picks(), ["refract"]);
    await s.ev(() => window.__t.closeAllLayers());
  });
  await s.close();

  s = await session("failing", { width: 1280, height: 720 });   // short enough that the window's body scrolls once the line shows
  await s.create();
  await fill(s);
  await test("several formats: one that fails stops the rest, and the window says which went", async () => {
    await s.open();
    await s.pick(["hayha", "hidden", "refract", "shikari"]);
    await s.ev(() => { const orig = URL.createObjectURL; let n = 0; URL.createObjectURL = (b) => { if (++n === 3) throw new Error("no"); return orig(b); }; });
    await s.page.click("#ex-dl");
    await s.page.waitForFunction(() => { const o = document.querySelector("#ex-out"); return o && !o.hidden; }, null, { timeout: 15000 });
    assert.equal(await s.text("#ex-out"), "Downloaded HayhaAIO 2.0 and Hidden AIO. Refract and Shikari weren't downloaded.");
    assert.equal(await s.page.$eval("#ex-out", (e) => e.getAttribute("role")), "status");
    const v = await inBody(s, "#ex-out");
    assert.ok(v.top >= 0 && v.bottom >= 0, `the line is scrolled into view (${JSON.stringify(v)})`);
    await s.page.waitForTimeout(300);
    assert.deepEqual(s.downloads.map((d) => d.suggestedFilename()), [fileName("hayha", await today(s)), fileName("hidden", await today(s))]);
    assert.equal(await s.page.$eval("#ex-dl", (b) => b.disabled), false, "Download can be pressed again");
    const toasts = await s.page.$$eval(".toast", (l) => l.map((x) => x.textContent));
    assert.equal(toasts.some((x) => /Downloaded \d+ files/.test(x)), false);
    // Changing a pick clears the message.
    await s.pick(["refract", "shikari"]);
    assert.equal(await s.page.$eval("#ex-out", (e) => e.hidden), true);
    assert.deepEqual(JSON.parse(await s.ev(() => localStorage.getItem("orbit-export-fmts"))), ["hayha", "hidden", "refract", "shikari"], "the picks are kept once a file went");
  });

  await test("Erase vault forgets the picks; a new vault starts on FAFO backup again", async () => {
    await s.ev(() => window.__t.closeAllLayers());
    await s.page.click('#side [data-id="settings-view"]');
    await s.page.click('#main [data-act="settings-erase"]');
    await s.page.fill("#cw", "ERASE");
    await s.page.click("#cf-go");
    await s.page.waitForSelector("#pw2");
    assert.equal(await s.ev(() => localStorage.getItem("orbit-export-fmts")), null);
    await s.create();
    await fill(s);
    await s.open();
    assert.deepEqual(await s.picks(), ["json"]);
  });
  await s.close();

  s = await session("phone", { width: 375, height: 667 });
  await s.create();
  await fill(s);
  await test("a 375 × 667 phone: the list scrolls inside the window and every row can be ticked", async () => {
    await s.ev(() => window.__t.openExport());
    await s.page.waitForSelector("#ex-fmts");
    await s.page.waitForTimeout(300);
    const box = await s.page.$eval("#ex-fmts", (e) => ({ h: e.clientHeight, sh: e.scrollHeight, w: e.getBoundingClientRect().width, pw: e.closest(".panel").scrollWidth, pcw: e.closest(".panel").clientWidth }));
    assert.ok(box.sh > box.h, "the list scrolls");
    assert.ok(box.pw <= box.pcw && box.w <= 375, "nothing wider than the screen");
    for (const f of FORMATS) {
      const b = await s.page.$(`#ex-fmts input[value="${f[0]}"]`);
      if (!(await b.isChecked())) { await b.scrollIntoViewIfNeeded(); await s.page.click(`#ex-fmts .ex-row[data-fmt="${f[0]}"] .ex-nm`); }   // Playwright checks nothing covers it
      assert.equal(await b.isChecked(), true, f[0]);
    }
    assert.equal(await s.text("#ex-dl"), "Download 10 files");
    const dl = await s.page.$eval("#ex-dl", (b) => { const r = b.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.right <= window.innerWidth; });
    assert.equal(dl, true, "Download is on screen");
  });
  await s.close();

  assert.deepEqual(errors, [], "no errors on the page");
  console.log(`\n${passed} passed`);
} finally {
  await browser.close();
}
