// Orbit license worker: "Continue with Discord" gives a new user a license key, and this
// worker serves the signed list of those keys that the app checks.
//
// Two modes:
//   automatic (default)       every Discord account that passes the checks gets a key at once
//   REQUIRE_APPROVAL = "true" each sign-in becomes a request posted to DISCORD_WEBHOOK_URL with a
//                             private review link; the owner approves or denies it there
// NOTIFY_USER_ID (optional secret): the Discord user ID (or several, comma-separated) that each new post
//                             to DISCORD_WEBHOOK_URL @mentions, so the owner gets a ping and a red badge
//
// The app (index-*.html) talks to it through LICENSE_RELAY:
//   GET  /discord/ready        {ready} – the app only shows the Discord button when true
//   GET  /discord/start?r=ID   browser: sends the user to Discord's sign-in
//   GET  /discord/callback     browser: Discord sends the user back here
//   GET  /discord/status/ID    app polls: pending | review | issued (with key + signed list) | error
//   GET  /licenses             {body, sig}: SHA-256 hashes of valid keys, ECDSA P-256 signed
// A copy of GitHub's files (app 1.9.83+), for networks that block raw.githubusercontent.com:
//   GET  /mirror/update.json, /mirror/index-X.Y.Z.html, /mirror/licenses.json   fetched from this repo's main
//                              branch here, nothing else. All of it is signed (updates with the publisher's key,
//                              licenses.json with the license key), so this copy can't change any of it.
// Product pictures (app 1.9.113, "Authorization: Bearer <license key>"):
//   GET  /pictures/find?q=NAME {found, name, product, source, image}: the sealed Pokémon TCG product in TCGplayer's
//                              catalog (tcgcsv.com) whose name is the order's, word for word, with its picture as a
//                              data: address; {found:false}; or {found:false, more:true} while the catalog's lists
//                              are read (ask again in a minute)
// Slots (app sends "Authorization: Bearer <license key>"):
//   GET  /slots/limit          {limit, request}: how many slots this license can have on at once
//   POST /slots/request        {requested, name, note}: ask for more; posted to DISCORD_WEBHOOK_URL
// Submissions (slots sent from the Submit page):
//   GET  /submit/key           {pub, keyId}: the collecting key apps before 1.9.52 encrypt to (null until
//                              the owner confirms one)
//   POST /submit/key           {pub, name}: offer a collecting key; the owner confirms it in Discord
//   POST /submissions          {files, name, slots, stores, batch} (app 1.9.53+): posted to DISCORD_WEBHOOK_URL
//                              in plain text, with full card numbers, CVVs and passwords (the owner chose
//                              this over encryption): per store, its profiles as AYCD JSON and as a Shikari CSV
//                              (2026-10-09), and its logins (email:password) as a .txt, except Pokémon Center's,
//                              which checks out with just the email on each profile (2026-10-07), each file named
//                              <buyer>-<store>-aycd.json, -shikari.csv or -logins.txt. Each store's profiles come as a
//                              .csv in the owner's columns, which the Shikari CSV is made from (2026-10-06 to -09 it
//                              wasn't posted). App 1.9.87+ sends the AYCD list (kind "aycd"); for older apps it's made
//                              from the CSV.
//                              Each store in `stores`
//                              may carry `seller`: how many of its slots ask the owner to assign an
//                              account. App 1.9.52 sends {csv, ...}, one .csv; older apps {code, keyId, ...},
//                              a code encrypted to the collecting key, posted as a .txt. None is kept here.
//                              Each batch's message has a link for the owner to approve or decline it (2026-10-06),
//                              and the answer says {review: "pending"}. `active` (app 1.9.99+): {storeKey: [profile
//                              names]} of the app's slots still out, so a profile sent again with none out gets back
//                              the account it had (2026-10-07).
//   GET  /submissions/status?ids=A,B   {batches:{A:{status, at}}}: whether the owner has decided on this license's
//                              batches (pending | approved | declined, and when); app 1.9.91+ shows Pending approval,
//                              then Success (1.9.92+ also Declined)
//   GET  /submissions/batches?since=MS&until=MS   {now, batches:[{id, at, slots, name, status, decided}]}: this
//                              license's batches since approvals began, oldest first. Apps before 1.9.91 kept no
//                              batch id, so app 1.9.98+ finds the batch of each slot they sent by when it went out
//   POST /pull                 {keyId, name, batch, slots}: slots pulled after being sent; posted to
//                              DISCORD_WEBHOOK_URL as a plain list, only for keys (or "CSV") this license
//                              sent submissions to
// Assigned accounts (app 1.9.58+; the owner's own store accounts for slots set to Use Assigned Account):
//   POST /accounts/offer       {store, storeName, name, accounts:[{email, password}]}: accounts sent from
//                              the owner's Orbit, added to the list once the owner approves them in Discord.
//                              A batch in /submissions then gets one per such slot (see assignAccounts).
//   POST /accounts/remove      {emails, name} (app 1.9.90+): emails to take off the list, from every store's,
//                              once the owner confirms it from the review link posted to Discord
//   POST /accounts/list        {name} (app 1.9.102+): post a link to the owner's list to the channel, to see and edit it
// Order alerts (app 1.9.69+): buyers hear about orders placed on the accounts they were given.
//   GET  /alerts/sender        {status}: none | pending | allowed | refused, for this license
//   POST /alerts/sender        {name}: ask to send order alerts; the owner allows it from the review link
//                              posted to DISCORD_WEBHOOK_URL. One license sends at a time.
//   GET  /alerts/accounts      the sender only: {accounts:[{email, store}]}, the accounts given out
//   POST /alerts               the sender only: {events:[{account, store, storeName, orderNo, item, qty,
//                              total, stage, at}]}: each is kept for the buyer that account was given to,
//                              without the account, and posted to their own Discord webhook if they set one
//   GET  /alerts?since=MS      {alerts:[{id, oid, store, storeName, profile, orderNo, item, qty, total,
//                              stage, at, createdAt}]}: this license's, newer than MS
//   GET  /alerts/webhook       {set, lastOk, lastError}: this license's Discord webhook for its alerts
//   PUT  /alerts/webhook       {url}: set it (it gets a test post first), or "" to remove it
// Payments (Stripe; off until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set; page 1.9.130+, license Bearer):
//   GET  /billing              {on:false}, or {on, mode, exempt, plan, nextPlan, block, prices, sub, lines, owed, overdue,
//                              paid30, payments, report}: this license's plan and invoice ($10 per checkout, or $25 a month)
//   POST /billing/plan         {plan:"checkout"}: pay per checkout (a monthly plan ends first)
//   POST /billing/checkouts    {orders:[{account, store, orderNo, at, stage}]}: checkouts their FAFO found on their own
//                              accounts, billed when that account was out as one of their slots then
//   POST /billing/checkout     {kind: pay | monthly | extras | cancel | resume | invoice, ...}: {url} of a Stripe page to
//                              open, or GET /billing's answer
//   POST /billing/dispute      {id, note}: "not my seller's checkout", for the owner to waive or keep
//   GET  /billing/done         where Stripe sends the buyer back
//   POST /stripe/webhook       Stripe's events (signed with STRIPE_WEBHOOK_SECRET)
//   POST /submissions refuses a buyer who isn't paid up (402 {error, billing:{reason, ...}}); /slots/limit gives a monthly
//                              plan's 10 or 25.
// Web version and sync (app 1.9.65+). The app seals its vault (AES-GCM, with a key from the vault's
// password) before it leaves the device, so what's kept here can't be read here. Every call takes the
// license key (Bearer); reading or saving also takes the vault's access token (x-vault-auth), which
// the app derives from the same password, and of which only a hash is kept:
//   GET  /vault/info           {exists, rev, created, salt, iter, size, device, updatedAt}: a new device
//                              needs the salt and iterations to derive the token and key from the password
//   GET  /vault?have=REV       {rev, created, record, device, updatedAt}, or {rev, created, same:true} when
//                              REV is current. `created` tells a vault apart from one deleted and made again.
//   PUT  /vault?base=REV&vid=CREATED&device=NAME   the sealed record as the body; x-vault-salt and
//                              x-vault-iter say what it's sealed with, and x-vault-new-auth carries the
//                              token of a new password. {rev, created}, or 409 {rev, created} if another
//                              device saved after REV, or the vault isn't the one `vid` names (merge, then
//                              try again). base=0 creates it.
//   DELETE /vault              removes it (the license key alone does, for a forgotten password; the
//                              devices keep their own copies)
// A wrong token gets 403 and counts toward a 15-minute lockout after 10; the token of the password
// before the last change gets 403 {error:"password changed"} and doesn't count.
// Owner:
//   GET/POST /review/DISCORD_ID?t=TOKEN   approve or deny one request (link posted to the webhook)
//   GET/POST /slots/review/ID?t=TOKEN     approve (optionally a different number) or deny more slots
//   GET/POST /submit/review/ID?t=TOKEN    confirm or refuse a collecting key
//   GET/POST /submissions/review/ID?t=TOKEN  approve or decline a batch of slots (link on its message)
//   GET/POST /accounts/review/ID?t=TOKEN  add or refuse accounts sent for Use Assigned Account
//   GET/POST /accounts/removal/ID?t=TOKEN remove accounts from the list, or keep them
//   GET/POST /accounts/list/ID?t=TOKEN    the list: each store's accounts, free or given (never a password in the page), to
//                              edit (password, email while free, give back), reassign (a buyer's slots get another
//                              account; asks first), remove (asks first) or add to, and to tick several to copy,
//                              reassign or remove; POST action=copy answers the ticked ones' email:password as
//                              JSON, the only place a password leaves the worker; 24 hours
//   GET/POST /alerts/review/ID?t=TOKEN    allow or refuse a license sending order alerts to buyers
//   GET  /premium              {premium}: whether this license gets Generate (license Bearer; pages 1.9.127+): the owner
//                              made it premium, or it's the license allowed to send order alerts (the owner's own FAFO)
//   POST /premium/list         {name}: posts a link to the Premium buyers page to the owner's channel (license Bearer)
//   GET/POST /premium/list/ID?t=TOKEN     every buyer, premium or not, with Make premium / Remove premium, and a key made
//                              by hand made premium by its key; 24 hours
//   POST /billing/list         {name}: the owner's own FAFO posts a link to the Billing page to the channel
//   GET/POST /billing/list/ID?t=TOKEN     every buyer's plan and invoice: Friends and Family or Charge, Tester (test mode), waive,
//                              mark paid, charge again, disputes, add checkouts (one, or pasted from the bot's log); 24 hours
//   GET  /admin/licenses       every key issued            (Authorization: Bearer ADMIN_TOKEN)
//   GET  /admin/premium        the premium licenses (last 4, when, Discord name) and the license that sends order alerts
//   GET  /admin/applications   every request and decision
//   GET  /admin/submissions    collecting keys (with review links), submissions sent (whether approved or declined,
//                              with their review links) and slots pulled
//   POST /admin/revoke         {discord_id} or {key}: the app locks on its next check
//   POST /admin/restore        {discord_id} or {key}
//   GET  /admin/accounts       the account list: free and given out per store, who got which, offers
//   GET  /admin/vaults         synced vaults: whose, how big, from which device, when (never their contents)
//   GET  /admin/alerts         order alerts: who asked to send them and the decisions, and how many each buyer got
//   GET  /admin/billing        payments: on or off, the mode, since when, plans, what's owed, prices, the last order alerts
//   GET  /admin/pictures?q=NAME what a name's picture search reads: its words, the groups searched, every product that
//                              fits and the answer (nothing kept or fetched for the picture)
//   POST /admin/accounts/free  {email, store?}: give an account back to the list
//   POST /admin/accounts/remove {email, store?}: take it off the list

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const REQUEST_TTL_MS = 15 * 60 * 1000;          // matches how long the app waits for a sign-in
const REVIEW_TTL_MS = 7 * 24 * 3600 * 1000;     // how long an app can wait for the owner's decision
const STARTS_PER_IP_PER_HOUR = 20;
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 symbols, no 0/O or 1/I
const DISCORD_EPOCH = 1420070400000;
const SUPPRESS_EMBEDS = 1 << 2;

// Shown by the app while a request waits. Orbit 1.9.41 shows it as the final message and stops
// waiting; later versions keep waiting and activate once it's approved.
const REVIEW_MSG = "Request sent. You can use FAFO once the seller approves it. Then click Continue with Discord again.";
const DECLINED_MSG = "Your request for a key was declined. Contact the seller if you think this is a mistake.";
const REVOKED_MSG = "The license for this Discord account was turned off. Contact the seller for help.";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-vault-auth, x-vault-new-auth, x-vault-salt, x-vault-iter",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (request.method === "GET") {
        if (path === "/discord/ready") return json({ ready: isReady(env) });
        if (path === "/discord/start") return await start(request, env, ctx, url);
        if (path === "/discord/callback") return await callback(env, ctx, url);
        if (path.startsWith("/discord/status/")) return await status(env, path.slice("/discord/status/".length));
        if (path === "/licenses") {
          if (!isConfigured(env)) return json({ error: "not configured" }, 503);
          return json(await signedList(env), 200, { "cache-control": "no-store" });
        }
        if (path.startsWith("/mirror/")) return await mirror(env, path.slice("/mirror/".length));
        if (path === "/pictures/find") return await pictureFind(request, env, ctx, url);
      }
      if (path.startsWith("/review/")) return await review(request, env, ctx, url, path.slice("/review/".length));
      if (path === "/slots/limit" && request.method === "GET") return await slotLimit(request, env);
      if (path === "/slots/request" && request.method === "POST") return await slotRequest(request, env, ctx, url);
      if (path.startsWith("/slots/review/")) return await slotReview(request, env, ctx, url, path.slice("/slots/review/".length));
      if (path === "/submit/key" && request.method === "GET") return await submitKeyGet(env, url);
      if (path === "/submit/key" && request.method === "POST") return await submitKeyPost(request, env, ctx, url);
      if (path.startsWith("/submit/review/")) return await submitKeyReview(request, env, ctx, url, path.slice("/submit/review/".length));
      if (path === "/submissions" && request.method === "POST") return await submission(request, env, url, ctx);
      if (path === "/submissions/status" && request.method === "GET") return await submissionStatus(request, env, url);
      if (path === "/submissions/batches" && request.method === "GET") return await submissionBatches(request, env, url);
      if (path.startsWith("/submissions/review/")) return await submissionReview(request, env, ctx, url, path.slice("/submissions/review/".length));
      if (path === "/pull" && request.method === "POST") return await pull(request, env, ctx);
      if (path === "/accounts/offer" && request.method === "POST") return await accountOffer(request, env, ctx, url);
      if (path.startsWith("/accounts/review/")) return await accountReview(request, env, ctx, url, path.slice("/accounts/review/".length));
      if (path === "/accounts/remove" && request.method === "POST") return await accountRemove(request, env, ctx, url);
      if (path.startsWith("/accounts/removal/")) return await accountRemovalReview(request, env, ctx, url, path.slice("/accounts/removal/".length));
      if (path === "/accounts/list" && request.method === "POST") return await accountListAsk(request, env, ctx, url);
      if (path.startsWith("/accounts/list/")) return await accountListPage(request, env, url, path.slice("/accounts/list/".length));
      if (path === "/premium" && request.method === "GET") return await premiumGet(request, env);
      if (path === "/premium/list" && request.method === "POST") return await premiumListAsk(request, env, ctx, url);
      if (path.startsWith("/premium/list/")) return await premiumListPage(request, env, url, path.slice("/premium/list/".length));
      if (path === "/alerts/sender" && request.method === "GET") return await alertSenderGet(request, env);
      if (path === "/alerts/sender" && request.method === "POST") return await alertSenderPost(request, env, ctx, url);
      if (path.startsWith("/alerts/review/")) return await alertSenderReview(request, env, ctx, url, path.slice("/alerts/review/".length));
      if (path === "/alerts/accounts" && request.method === "GET") return await alertAccounts(request, env, ctx);
      if (path === "/alerts/webhook" && request.method === "GET") return await alertWebhookGet(request, env);
      if (path === "/alerts/webhook" && request.method === "PUT") return await alertWebhookPut(request, env);
      if (path === "/alerts" && request.method === "GET") return await alertsGet(request, env, url);
      if (path === "/alerts" && request.method === "POST") return await alertsPost(request, env, ctx);
      if (path === "/billing" && request.method === "GET") return await billingGet(request, env);
      if (path === "/billing/plan" && request.method === "POST") return await billingPlan(request, env);
      if (path === "/billing/checkouts" && request.method === "POST") return await billingCheckouts(request, env, ctx);
      if (path === "/billing/checkout" && request.method === "POST") return await billingCheckout(request, env, ctx, url);
      if (path === "/billing/dispute" && request.method === "POST") return await billingDispute(request, env, ctx, url);
      if (path === "/billing/done" && request.method === "GET") return await billingDone(env, url);
      if (path === "/billing/list" && request.method === "POST") return await billingListAsk(request, env, ctx, url);
      if (path.startsWith("/billing/list/")) return await billingListPage(request, env, ctx, url, path.slice("/billing/list/".length));
      if (path === "/stripe/webhook" && request.method === "POST") return await stripeWebhook(request, env);
      if (path === "/vault/info" && request.method === "GET") return await vaultInfo(request, env);
      if (path === "/vault" && request.method === "GET") return await vaultGet(request, env, url);
      if (path === "/vault" && request.method === "PUT") return await vaultPut(request, env, url);
      if (path === "/vault" && request.method === "DELETE") return await vaultDelete(request, env);
      if (path.startsWith("/admin/")) return await admin(request, env, path);
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error(e && e.stack || e);
      return json({ error: "server error" }, 500);
    }
  },
};

function isConfigured(env) {
  return !!(env.DB && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.LICENSE_SIGNING_KEY);
}
const approvalOn = (env) => String(env.REQUIRE_APPROVAL || "").trim().toLowerCase() === "true";
// With approval on, requests have to reach the owner, so the webhook is required too.
const isReady = (env) => isConfigured(env) && (!approvalOn(env) || !!env.DISCORD_WEBHOOK_URL);

const discordApi = (env) => (env.DISCORD_API_BASE || "https://discord.com/api/v10").replace(/\/+$/, "");
const validId = (r) => /^[A-Za-z0-9_-]{16,64}$/.test(r || "");
const accountCreated = (discordId) => Number(BigInt(discordId) >> 22n) + DISCORD_EPOCH;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- sign-in -------------------------------------------------------------------

// The web version's addresses. From page 1.9.111 it sends its own as `web` with /discord/start, and the sign-in carries
// which one in its state (`<id>.w<n>`, nothing new stored), so the page Discord sends the buyer back to can take them
// straight back to FAFO there (`backToWeb`) instead of telling them to find the tab it opened from.
const WEB_APPS = ["https://app.fafoaco.com", "https://app.orbit-app.workers.dev"];
const webAppOf = (state) => { const m = /\.w(\d)$/.exec(state || ""); return m ? WEB_APPS[+m[1]] || "" : ""; };
// Closes this tab, which goes back to the FAFO tab that opened it; where the browser won't, opens FAFO here (it
// picks the sign-in up by itself). Only the tab FAFO opened is closed: it went through discord.com first, so it has
// more than one page in its history. One with a single page was opened by something else (the Discord app handing
// the sign-in back to the browser, say), and closing it would leave the buyer back in Discord, so it opens FAFO.
const backToWeb = (app) => `<p class="go"><button class="go" id="back" type="button">Back to FAFO</button></p>
<p class="hint">Signed in from the Discord app or another browser? Go back to FAFO there.</p>
<script>document.getElementById("back").addEventListener("click", function(){ var go = function(){ location.replace(${JSON.stringify(app + "/")}); };
  if (history.length < 2) return go();
  try { window.close(); } catch(e){} setTimeout(go, 400); });</script>`;

async function start(request, env, ctx, url) {
  const r = url.searchParams.get("r") || "";
  if (!validId(r)) return page(400, "This link isn't valid", "Go back to FAFO and click Continue with Discord again.");
  if (!isReady(env)) return page(503, "Not available yet", "Getting a key with Discord isn't set up yet. Contact the seller for a key.");

  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || "";
  ctx.waitUntil(env.DB.prepare("DELETE FROM requests WHERE created_at < ?").bind(now - REVIEW_TTL_MS - 86400000).run());
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE ip = ? AND created_at > ?")
    .bind(ip, now - 3600 * 1000).first();
  if (recent && recent.n >= STARTS_PER_IP_PER_HOUR) return page(429, "Too many tries", "Wait an hour, then try again.");

  const web = WEB_APPS.indexOf(url.searchParams.get("web") || "");
  const state = randomId(24) + (web >= 0 ? ".w" + web : "");
  const res = await env.DB.prepare(
    `INSERT INTO requests (r, state, ip, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (r) DO UPDATE SET state = excluded.state, created_at = excluded.created_at
     WHERE requests.status = 'pending'`
  ).bind(r, state, ip, now).run();
  if (!res.meta || !res.meta.changes) return page(200, "Already done", "Go back to FAFO.", web >= 0 ? backToWeb(WEB_APPS[web]) : "");

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: url.origin + "/discord/callback",
    response_type: "code",
    scope: env.REQUIRED_GUILD_ID ? "identify guilds" : "identify",
    state,
  });
  return Response.redirect(DISCORD_AUTHORIZE + "?" + params, 302);
}

async function callback(env, ctx, url) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const req = state ? await env.DB.prepare("SELECT * FROM requests WHERE state = ?").bind(state).first() : null;
  const webApp = webAppOf(state), back = webApp ? backToWeb(webApp) : "";
  // A request waiting for the seller lasts as long as the app waits for it (reloading its page later isn't "expired").
  if (req && req.status === "review" && Date.now() - req.created_at <= REVIEW_TTL_MS) return page(200, "Request sent", "The seller will review your request.", back);
  if (!req || Date.now() - req.created_at > REQUEST_TTL_MS) {
    return page(400, "This sign-in expired", "Go back to FAFO and click Continue with Discord again.", back);
  }
  if (req.status === "issued") return webApp
    ? page(200, "You're all set", "FAFO has your key. Go back to it: your master password opens your vault there, or you choose one if you're new.", back)
    : page(200, "You're all set", "Go back to FAFO. It has your key.");
  if (req.status !== "pending") return page(400, "Something went wrong", req.error || "Go back to FAFO and try again.", back);

  const fail = async (title, msg, statusCode = 403) => {
    await env.DB.prepare("UPDATE requests SET status = 'error', error = ? WHERE r = ? AND status = 'pending'").bind(msg, req.r).run();
    return page(statusCode, title, msg, webApp ? backToWeb(webApp) : "");
  };
  if (url.searchParams.get("error") || !code) return fail("Sign-in cancelled", "Discord sign-in was cancelled. Click Continue with Discord in FAFO to try again.", 400);

  const token = await exchangeCode(env, code, url.origin + "/discord/callback");
  if (!token) return fail("Sign-in failed", "Discord didn't accept the sign-in. Click Continue with Discord in FAFO to try again.", 502);
  const user = await discordGet(env, "/users/@me", token);
  if (!user || !user.id) return fail("Sign-in failed", "Couldn't read your Discord account. Try again.", 502);
  const username = String(user.username || user.global_name || user.id);

  if (user.bot) return fail("Not allowed", "Bot accounts can't get a license key.");
  const minDays = Number(env.MIN_ACCOUNT_AGE_DAYS || 0);
  if (minDays > 0 && Date.now() - accountCreated(user.id) < minDays * 86400000) {
    return fail("Account too new", `Your Discord account must be at least ${minDays} days old to get a key.`);
  }
  if (env.REQUIRED_GUILD_ID) {
    const guilds = await discordGet(env, "/users/@me/guilds", token);
    if (!Array.isArray(guilds) || !guilds.some((g) => g && g.id === env.REQUIRED_GUILD_ID)) {
      return fail("Join the server first", "You need to be a member of our Discord server to get a key. Join it, then try again.");
    }
  }

  // Accounts that already have a key always get it straight back. A denial stands even
  // if approval is turned off later.
  const existing = await env.DB.prepare("SELECT discord_id FROM licenses WHERE discord_id = ?").bind(user.id).first();
  if (!existing) {
    const prior = await env.DB.prepare("SELECT status FROM applications WHERE discord_id = ?").bind(user.id).first();
    if (prior && prior.status === "denied") return fail("Request declined", DECLINED_MSG);
  }
  if (approvalOn(env) && !existing) {
    const app = await ensureApplication(env, ctx, url.origin, user.id, username);
    if (app.status === "denied") return fail("Request declined", DECLINED_MSG);
    if (app.status === "pending") {
      await env.DB.prepare("UPDATE requests SET status = 'review', discord_id = ? WHERE r = ? AND status = 'pending'").bind(user.id, req.r).run();
      if (webApp) return page(200, "Request sent", "The seller approves new accounts by hand. Once you're approved, FAFO goes on by itself, even if you close it and come back later.", backToWeb(webApp));
      return page(200, "Request sent", "The seller will review your request. Once it's approved, FAFO activates by itself if it's waiting, or click Continue with Discord in FAFO again.");
    }
  }

  const lic = await issueLicense(env, ctx, user.id, username, !approvalOn(env));
  if (lic.revoked_at) {
    const app = await env.DB.prepare("SELECT status FROM applications WHERE discord_id = ?").bind(user.id).first();
    return app && app.status === "denied" ? fail("Request declined", DECLINED_MSG) : fail("License turned off", REVOKED_MSG);
  }
  await env.DB.prepare("UPDATE requests SET status = 'issued', discord_id = ? WHERE r = ? AND status = 'pending'").bind(user.id, req.r).run();
  const keyHtml = `<p class="small">Your license key, in case you need it later:</p><p class="key">${esc(lic.license_key)}</p>`;
  if (webApp) return page(200, "You're all set", "Go back to FAFO: your master password opens your vault there, or you choose one if you're new. It keeps your profiles and cards private.", backToWeb(webApp) + keyHtml);
  return page(200, "You're all set", "Go back to FAFO. It activates by itself in a few seconds.", keyHtml);
}

async function exchangeCode(env, code, redirectUri) {
  const r = await fetch(discordApi(env) + "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!r.ok) { console.error("token exchange", r.status, await r.text()); return null; }
  const t = await r.json();
  return t && t.access_token || null;
}

async function discordGet(env, path, token) {
  const r = await fetch(discordApi(env) + path, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) { console.error("discord", path, r.status); return null; }
  return r.json();
}

// The same Discord account always gets the same key.
async function issueLicense(env, ctx, discordId, username, notify) {
  const existing = await env.DB.prepare("SELECT * FROM licenses WHERE discord_id = ?").bind(discordId).first();
  if (existing) {
    if (existing.username !== username) {
      await env.DB.prepare("UPDATE licenses SET username = ? WHERE discord_id = ?").bind(username, discordId).run();
    }
    return existing;
  }
  const key = newKey();
  const [ins] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO licenses (discord_id, username, license_key, key_hash, issued_at) VALUES (?, ?, ?, ?, ?)")
      .bind(discordId, username, key, await keyHash(key), Date.now()),
    env.DB.prepare("UPDATE list_state SET version = version + 1 WHERE id = 1"),
  ]);
  if (notify && ins.meta && ins.meta.changes) {
    ctx.waitUntil(webhookPost(env, { content: `🔑 New FAFO license issued to **@${md(username)}** (Discord ID ${discordId}).` }).catch(() => {}));
  }
  return env.DB.prepare("SELECT * FROM licenses WHERE discord_id = ?").bind(discordId).first();
}

async function status(env, r) {
  if (!validId(r)) return json({ status: "unknown" }, 404);
  const row = await env.DB.prepare(
    `SELECT q.status, q.error, q.created_at, l.username, l.license_key, l.revoked_at, a.status AS app_status
     FROM requests q
     LEFT JOIN licenses l ON l.discord_id = q.discord_id
     LEFT JOIN applications a ON a.discord_id = q.discord_id
     WHERE q.r = ?`
  ).bind(r).first();
  const ttl = row && row.status === "review" ? REVIEW_TTL_MS : REQUEST_TTL_MS;
  if (!row || Date.now() - row.created_at > ttl) return json({ status: "unknown" }, 404);
  if (row.status === "pending") return json({ status: "pending" });
  if ((row.status === "issued" || row.status === "review") && row.license_key && !row.revoked_at) {
    return json({ status: "issued", username: row.username, key: row.license_key, list: await signedList(env) }, 200, { "cache-control": "no-store" });
  }
  if (row.status === "review") {
    if (row.app_status === "denied") return json({ status: "error", error: DECLINED_MSG });
    if (row.license_key) return json({ status: "error", error: REVOKED_MSG });
    return json({ status: "review", error: REVIEW_MSG });
  }
  return json({ status: "error", error: row.error || REVOKED_MSG });
}

// ---- approval ------------------------------------------------------------------------

// One request per Discord account, posted to the owner's channel once. If that post never
// made it (Discord rate limit or outage), the next sign-in by the same account posts it again.
async function ensureApplication(env, ctx, origin, discordId, username) {
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO applications (discord_id, username, review_token, created_at) VALUES (?, ?, ?, ?)"
  ).bind(discordId, username, randomId(24), Date.now()).run();
  const app = await env.DB.prepare("SELECT * FROM applications WHERE discord_id = ?").bind(discordId).first();
  if ((res.meta && res.meta.changes) || (app.status === "pending" && !app.webhook_message_id)) {
    ctx.waitUntil((async () => {
      const id = await webhookPost(env, { content: reviewMessage(origin, app) });
      if (id) await env.DB.prepare("UPDATE applications SET webhook_message_id = ? WHERE discord_id = ?").bind(id, discordId).run();
    })().catch((e) => console.error("webhook", e)));
  }
  return app;
}

function reviewMessage(origin, app) {
  const who = `**@${md(app.username)}** · Discord ID ${app.discord_id} · account created ${day(accountCreated(app.discord_id))}`;
  const link = `${origin}/review/${app.discord_id}?t=${app.review_token}`;
  if (app.status === "approved") return `✅ **Approved** · ${who}\n[Change decision](${link})`;
  if (app.status === "denied") return `⛔ **Denied** · ${who}\n[Change decision](${link})`;
  return `📝 **New FAFO key request** from ${who}\n[Review: approve or deny](${link})`;
}

async function review(request, env, ctx, url, discordId) {
  const app = /^\d{5,25}$/.test(discordId)
    ? await env.DB.prepare("SELECT * FROM applications WHERE discord_id = ?").bind(discordId).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!app || !(await sameText(t, app.review_token))) return page(404, "Request not found", "This review link isn't valid.");

  let done = "";
  if (action === "approve" || action === "deny") {
    await decide(env, ctx, app, action, url.origin);
    done = action === "approve" ? "Approved. The key is issued." : "Denied.";
  }
  const cur = await env.DB.prepare("SELECT * FROM applications WHERE discord_id = ?").bind(discordId).first();
  const label = { pending: "Waiting for your decision", approved: "Approved", denied: "Denied" }[cur.status] || cur.status;
  const lic = cur.status === "approved"
    ? await env.DB.prepare("SELECT license_key FROM licenses WHERE discord_id = ? AND revoked_at IS NULL").bind(discordId).first() : null;
  const keyBlock = lic ? `<p class="small">License key:</p><p class="key" id="key">${esc(lic.license_key)}</p>
     <button class="copy" type="button" onclick="navigator.clipboard.writeText(document.getElementById('key').textContent).then(()=>{this.textContent='Copied'})">Copy key</button>` : "";
  const btn = (a, text, cls) => `<form method="post"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="action" value="${a}"><button class="${cls}" type="submit">${text}</button></form>`;
  return page(200, "Key request", done || label,
    `<p class="who">@${esc(cur.username)}</p>
     <p class="small">Discord ID ${esc(cur.discord_id)}<br>Account created ${day(accountCreated(cur.discord_id))}<br>Requested ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${done ? `<p class="small">Status: ${esc(label)}</p>` : ""}
     ${keyBlock}
     <div class="row">${cur.status !== "approved" ? btn("approve", "Approve", "ok") : ""}${cur.status !== "denied" ? btn("deny", "Deny", "no") : ""}</div>`);
}

// Approving issues the key (or turns a denied one back on); denying turns off any key it had.
async function decide(env, ctx, app, action, origin) {
  const now = Date.now(), id = app.discord_id;
  const lic = await env.DB.prepare("SELECT revoked_at FROM licenses WHERE discord_id = ?").bind(id).first();
  const bump = env.DB.prepare("UPDATE list_state SET version = version + 1 WHERE id = 1");
  if (action === "approve") {
    await env.DB.prepare("UPDATE applications SET status = 'approved', decided_at = ? WHERE discord_id = ?").bind(now, id).run();
    if (!lic) await issueLicense(env, ctx, id, app.username, false);
    else if (lic.revoked_at) await env.DB.batch([env.DB.prepare("UPDATE licenses SET revoked_at = NULL WHERE discord_id = ?").bind(id), bump]);
  } else {
    await env.DB.prepare("UPDATE applications SET status = 'denied', decided_at = ? WHERE discord_id = ?").bind(now, id).run();
    if (lic && !lic.revoked_at) await env.DB.batch([env.DB.prepare("UPDATE licenses SET revoked_at = ? WHERE discord_id = ?").bind(now, id), bump]);
  }
  if (app.webhook_message_id) {
    const cur = await env.DB.prepare("SELECT * FROM applications WHERE discord_id = ?").bind(id).first();
    ctx.waitUntil(webhookEdit(env, app.webhook_message_id, { content: reviewMessage(origin, cur) }).catch(() => {}));
  }
}

// ---- owner's Discord channel ---------------------------------------------------------

// The owner's Discord user IDs from NOTIFY_USER_ID, the only people a post ever pings.
const notifyIds = (env) => [...new Set(String(env.NOTIFY_USER_ID || "").split(/[\s,]+/).filter((id) => /^\d{15,22}$/.test(id)))];

// `file` ({name, text, type}) is sent as an attachment on the message (type defaults to text/plain).
// `file` is one attachment or a list of them (Discord takes up to 10 per message).
// Each new post starts by @mentioning NOTIFY_USER_ID, if set. Edits (webhookEdit) mention no one, so a
// decision doesn't ping again, and a message already at Discord's 2000 characters goes without it.
async function webhookPost(env, payload, file) {
  if (!env.DISCORD_WEBHOOK_URL) return null;
  const u = new URL(env.DISCORD_WEBHOOK_URL);
  u.searchParams.set("wait", "true");
  const ids = notifyIds(env), content = String(payload.content || "");
  const ping = ids.map((id) => `<@${id}>`).join(" ") + " ";
  const notify = ids.length > 0 && ping.length + content.length <= 2000;
  const body = JSON.stringify({ ...payload, ...(notify && { content: ping + content }), flags: SUPPRESS_EMBEDS,
    allowed_mentions: notify ? { parse: [], users: ids } : { parse: [] } });
  const files = !file ? [] : Array.isArray(file) ? file : [file];
  const send = () => {
    if (!files.length) return fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body });
    const form = new FormData();
    form.append("payload_json", body);
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.text], { type: f.type || "text/plain" }), f.name));
    return fetch(u, { method: "POST", body: form });
  };
  let r = await send();
  if (r.status === 429) {
    // Discord limits how often a webhook can post; wait as long as it asks (briefly) and try once more.
    const wait = Number((await r.json().catch(() => ({}))).retry_after) || 1;
    if (wait <= 10) { await new Promise((ok) => setTimeout(ok, wait * 1000)); r = await send(); }
  }
  if (!r.ok) { console.error("webhook post", r.status, await r.text()); return null; }
  const m = await r.json().catch(() => null);
  return m && m.id || null;
}

async function webhookEdit(env, messageId, payload) {
  const u = new URL(env.DISCORD_WEBHOOK_URL);
  u.pathname = u.pathname.replace(/\/+$/, "") + "/messages/" + messageId;
  const r = await fetch(u, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, flags: SUPPRESS_EMBEDS, allowed_mentions: { parse: [] } }),
  });
  if (!r.ok) console.error("webhook edit", r.status, await r.text());
}

const md = (s) => String(s).replace(/([\\*_~`|>\[\]()])/g, "\\$1");

// ---- signed key list -------------------------------------------------------------

// Same format as licenses.json on GitHub. Re-signed only after a change, and each new
// list gets a later `issued` time than the last, so the app never mistakes it for a
// stale copy.
async function signedList(env) {
  for (let tries = 0; tries < 4; tries++) {
    const s = await env.DB.prepare("SELECT * FROM list_state WHERE id = 1").first();
    if (s.body && s.built_version >= s.version) return { body: s.body, sig: s.sig };
    const [v, rows] = await env.DB.batch([
      env.DB.prepare("SELECT version, issued_ms FROM list_state WHERE id = 1"),
      env.DB.prepare("SELECT key_hash FROM licenses WHERE revoked_at IS NULL ORDER BY issued_at"),
    ]);
    const version = v.results[0].version;
    const issuedMs = Math.max(Date.now(), v.results[0].issued_ms + 1);
    const body = JSON.stringify({ v: 1, issued: new Date(issuedMs).toISOString(), keys: rows.results.map((x) => ({ h: x.key_hash })) });
    const sig = await sign(env, body);
    await env.DB.prepare(
      "UPDATE list_state SET body = ?, sig = ?, built_version = ?, issued_ms = ? WHERE id = 1 AND built_version < ? AND issued_ms < ?"
    ).bind(body, sig, version, issuedMs, version, issuedMs).run();
  }
  const s = await env.DB.prepare("SELECT body, sig FROM list_state WHERE id = 1").first();
  return { body: s.body, sig: s.sig };
}

let signingKey = null;
async function sign(env, text) {
  signingKey = signingKey || await crypto.subtle.importKey(
    "jwk", JSON.parse(env.LICENSE_SIGNING_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ---- slots ---------------------------------------------------------------------------

const SLOT_MAX = 500;
const SLOT_REQUESTS_PER_DAY = 3;
const slotDefault = (env) => Math.max(1, Math.floor(Number(env.DEFAULT_SLOT_LIMIT || 20)) || 20);
// Keys made by hand are on the signed list on GitHub, not in this database.
const GH_LICENSE_URL = "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/licenses.json";
const GH_LICENSE_PUB = { kty: "EC", crv: "P-256", x: "GjzaSqmKaFThaxR29wozcPQcaifNz3hZKgzGK9fWNec", y: "v1TXigdCJwtUiUgGUvt9BR6p_mTC3Bk-gy9u6u_bEmk" };
let ghList = null;   // {at, keys: Map(hash -> exp)}

async function ghListHas(env, hash) {
  if (!ghList || Date.now() - ghList.at > 10 * 60 * 1000) {
    try {
      const list = await (await fetch(env.GH_LICENSE_URL || GH_LICENSE_URL)).json();
      const pub = env.GH_LICENSE_PUB ? JSON.parse(env.GH_LICENSE_PUB) : GH_LICENSE_PUB;
      const k = await crypto.subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const sig = Uint8Array.from(atob(list.sig), (c) => c.charCodeAt(0));
      if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, sig, new TextEncoder().encode(list.body))) {
        ghList = { at: Date.now(), keys: new Map((JSON.parse(list.body).keys || []).map((e) => [e.h, e.exp || ""])) };
      }
    } catch (e) { console.error("github license list", e); }
  }
  if (!ghList) return null;   // couldn't be read, and no copy yet: unknown (falsy, so a key is refused as before)
  if (!ghList.keys.has(hash)) return false;
  const exp = ghList.keys.get(hash);
  return !exp || new Date(exp) > new Date();
}

// The license key the app sent, if it's a valid one from either list.
async function slotLicense(request, env) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  const norm = m ? m[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!/^PVLT[A-Z0-9]{16}$/.test(norm)) return null;
  const hash = await keyHash(norm);
  const row = await env.DB.prepare("SELECT discord_id, username, revoked_at FROM licenses WHERE key_hash = ?").bind(hash).first();
  if (row) return row.revoked_at ? null : { hash, last4: norm.slice(-4), discordId: row.discord_id, username: row.username };
  return (await ghListHas(env, hash)) ? { hash, last4: norm.slice(-4), discordId: null, username: null } : null;
}

async function currentSlotLimit(env, hash) {
  const row = await env.DB.prepare("SELECT slot_limit FROM slot_limits WHERE key_hash = ?").bind(hash).first();
  return row ? row.slot_limit : slotDefault(env);
}
const slotRequestOut = (q) => q ? { id: q.id, status: q.status, requested: q.requested, granted: q.granted, created_at: q.created_at, decided_at: q.decided_at } : null;

async function slotLimit(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const latest = await env.DB.prepare("SELECT * FROM slot_requests WHERE key_hash = ? ORDER BY created_at DESC LIMIT 1").bind(lic.hash).first();
  // A monthly plan's slots (payments): 10, or 25 with the extra 15, which the buyer adds in Invoice rather than asking.
  const plan = await planSlots(env, lic.hash).catch((e) => { console.error("billing", e); return null; });
  if (plan) return json({ limit: plan, request: slotRequestOut(latest), canRequest: false, plan: "monthly" }, 200, { "cache-control": "no-store" });
  return json({ limit: await currentSlotLimit(env, lic.hash), request: slotRequestOut(latest), canRequest: !!env.DISCORD_WEBHOOK_URL }, 200, { "cache-control": "no-store" });
}

async function slotRequest(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (await planSlots(env, lic.hash).catch(() => null)) return json({ error: "Add 15 slots in Invoice" }, 409);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "requests aren't set up" }, 503);
  const b = await request.json().catch(() => ({}));
  const current = await currentSlotLimit(env, lic.hash);
  const requested = Math.floor(Number(b.requested));
  if (!(requested > current && requested <= SLOT_MAX)) return json({ error: `ask for more than ${current} and at most ${SLOT_MAX}` }, 400);
  const pending = await env.DB.prepare("SELECT * FROM slot_requests WHERE key_hash = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(lic.hash).first();
  if (pending) return json({ status: "pending", request: slotRequestOut(pending) });
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_requests WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= SLOT_REQUESTS_PER_DAY) return json({ error: "too many requests today" }, 429);
  const q = {
    id: randomId(12), key_hash: lic.hash, key_last4: lic.last4,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60),
    discord_id: lic.discordId, username: lic.username, current_limit: current, requested,
    note: String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 300),
    status: "pending", review_token: randomId(24), created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO slot_requests (id, key_hash, key_last4, name, discord_id, username, current_limit, requested, note, status, review_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(q.id, q.key_hash, q.key_last4, q.name, q.discord_id, q.username, q.current_limit, q.requested, q.note, q.review_token, q.created_at).run();
  ctx.waitUntil((async () => {
    const id = await webhookPost(env, { content: slotMessage(url.origin, q) });
    if (id) await env.DB.prepare("UPDATE slot_requests SET webhook_message_id = ? WHERE id = ?").bind(id, q.id).run();
  })().catch((e) => console.error("webhook", e)));
  return json({ status: "pending", request: slotRequestOut(q) });
}

function slotMessage(origin, q) {
  const who = [q.name ? `**${md(q.name)}**` : "", q.username ? `@${md(q.username)}` : "", `license …${q.key_last4}`].filter(Boolean).join(" · ");
  const link = `${origin}/slots/review/${q.id}?t=${q.review_token}`;
  const head = q.status === "approved" ? `✅ **Approved: ${q.granted} slots**` : q.status === "denied" ? "⛔ **Slot request denied**" : "🎟️ **More slots requested**";
  return `${head} · ${who}\n${q.current_limit} → ${q.requested} slots${q.note ? `\n> ${md(q.note)}` : ""}\n[${q.status === "pending" ? "Review: approve or deny" : "Change decision"}](${link})`;
}

async function slotReview(request, env, ctx, url, id) {
  const q = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM slot_requests WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "", amount = NaN;
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
    const raw = form && form.get("amount");
    amount = raw == null || String(raw).trim() === "" ? NaN : Math.floor(Number(raw));
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!q || !(await sameText(t, q.review_token))) return page(404, "Request not found", "This review link isn't valid.");

  let done = "", err = "";
  if (action === "approve") {
    const n = Number.isFinite(amount) ? amount : q.requested;
    if (n < 1 || n > SLOT_MAX) err = `Choose between 1 and ${SLOT_MAX} slots.`;
    else {
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO slot_limits (key_hash, slot_limit, updated_at) VALUES (?, ?, ?)
          ON CONFLICT (key_hash) DO UPDATE SET slot_limit = excluded.slot_limit, updated_at = excluded.updated_at`).bind(q.key_hash, n, now),
        env.DB.prepare("UPDATE slot_requests SET status = 'approved', granted = ?, decided_at = ? WHERE id = ?").bind(n, now, q.id),
      ]);
      done = `Approved. They can now use ${n} slots.`;
    }
  } else if (action === "deny") {
    const now = Date.now();
    const stmts = [env.DB.prepare("UPDATE slot_requests SET status = 'denied', granted = NULL, decided_at = ? WHERE id = ?").bind(now, q.id)];
    // Taking back an approval puts the limit back where it was before this request.
    if (q.status === "approved") stmts.push(env.DB.prepare(`INSERT INTO slot_limits (key_hash, slot_limit, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key_hash) DO UPDATE SET slot_limit = excluded.slot_limit, updated_at = excluded.updated_at`).bind(q.key_hash, q.current_limit, now));
    await env.DB.batch(stmts);
    done = "Denied.";
  }
  const cur = await env.DB.prepare("SELECT * FROM slot_requests WHERE id = ?").bind(q.id).first();
  if (done && cur.webhook_message_id) ctx.waitUntil(webhookEdit(env, cur.webhook_message_id, { content: slotMessage(url.origin, cur) }).catch(() => {}));
  const label = { pending: "Waiting for your decision", approved: `Approved: ${cur.granted} slots`, denied: "Denied" }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : ""].filter(Boolean).join(" · ") || "No name given";
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  return page(200, "Slot request", err || done || label,
    `<p class="who">${esc(who)}</p>
     <p class="small">License …${esc(cur.key_last4)}<br>Current limit ${cur.current_limit} · asked for <strong>${cur.requested}</strong><br>Requested ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${cur.note ? `<p class="small">“${esc(cur.note)}”</p>` : ""}
     <form method="post" class="stack">${hidden}
       <label class="small" for="amount">Slots to allow</label>
       <input id="amount" name="amount" type="number" min="1" max="${SLOT_MAX}" value="${cur.status === "approved" ? cur.granted : cur.requested}">
       <div class="row"><button class="ok" type="submit" name="action" value="approve">${cur.status === "approved" ? "Change amount" : "Approve"}</button>${cur.status !== "denied" ? `<button class="no" type="submit" name="action" value="deny" formnovalidate>Deny</button>` : ""}</div>
     </form>`);
}

// ---- submissions -----------------------------------------------------------------------
//
// From app 1.9.52 the Submit page sends each batch in plain text, posted to the owner's channel as
// files they open directly: from 1.9.53 one profiles .csv per store (the owner's columns) and that
// store's logins as email:password lines in a .txt; 1.9.52 sends one .csv in Orbit's Export → CSV
// columns. Since 2026-10-06 each store's profiles go out as AYCD JSON (the owner's choice), and since 2026-10-09
// also as a Shikari CSV made from its .csv once accounts are assigned (shikariCsv); the .csv itself, read here to
// give out accounts and make the AYCD list for apps before 1.9.87, isn't posted. Full card numbers, CVVs, and store
// and email passwords pass through here and sit in the
// channel. The owner chose this. Nothing is kept here but who sent how many slots.
//
// Older apps seal each batch with the owner's collecting key from Orbit (Settings → Password and
// sharing), so for them the worker and Discord only see ciphertext. The owner downloads that .txt
// and opens it with Import in Orbit.

const SUBMISSIONS_PER_HOUR = 30;
const SUBMISSION_MAX_CHARS = 4_000_000;     // well under Discord's attachment limit
const SUBMISSION_MAX_FILES = 60;            // three per store
const SUBMIT_KEY_OFFERS_PER_DAY = 3;

const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const toB64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A P-256 public key as the app writes it (raw point, base64url), and its key ID as the app
// shows it: the first 4 bytes of its SHA-256, as XXXX-XXXX.
async function collectKey(pub) {
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(pub || "")) return null;
  let raw;
  try { raw = fromB64u(pub); } catch { return null; }
  if (raw.length !== 65 || raw[0] !== 4 || toB64u(raw) !== pub) return null;
  try { await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []); } catch { return null; }
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const hex = Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  // The key ID is short enough to read aloud; the fingerprint is long enough that no one can make
  // a different key that matches it.
  return { pub, keyId: hex.slice(0, 4) + "-" + hex.slice(4, 8), fingerprint: hex.slice(0, 32).match(/.{4}/g).join(" ") };
}

const activeSubmitKey = (env) => env.DB.prepare("SELECT * FROM submit_keys WHERE status = 'active' ORDER BY decided_at DESC LIMIT 1").first();

async function submitKeyGet(env, url) {
  const active = env.DISCORD_WEBHOOK_URL ? await activeSubmitKey(env) : null;
  const out = { pub: active ? active.pub : null, keyId: active ? active.key_id : null };
  if (active) out.fingerprint = (await collectKey(active.pub)).fingerprint;
  // Lets the owner's Orbit say whether its own key is waiting for them in Discord.
  const mine = url.searchParams.get("pub");
  if (mine) {
    const row = await env.DB.prepare("SELECT status FROM submit_keys WHERE pub = ? ORDER BY created_at DESC LIMIT 1").bind(mine).first();
    out.mine = row ? row.status : null;
  }
  return json(out, 200, { "cache-control": "no-store" });
}

async function submitKeyPost(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  const b = await request.json().catch(() => ({}));
  const k = await collectKey(String(b.pub || ""));
  if (!k) return json({ error: "that isn't a collecting key" }, 400);
  const latest = await env.DB.prepare("SELECT * FROM submit_keys WHERE pub = ? ORDER BY created_at DESC LIMIT 1").bind(k.pub).first();
  if (latest && latest.status === "active") return json({ status: "active", keyId: k.keyId });
  if (latest && latest.status === "pending") {
    if (!latest.webhook_message_id) ctx.waitUntil(postSubmitKey(env, url.origin, latest));
    return json({ status: "pending", keyId: k.keyId });
  }
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submit_keys WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= SUBMIT_KEY_OFFERS_PER_DAY) return json({ error: "too many tries today" }, 429);
  const row = {
    id: randomId(12), pub: k.pub, key_id: k.keyId, key_hash: lic.hash, key_last4: lic.last4,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), username: lic.username,
    status: "pending", review_token: randomId(24), created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO submit_keys (id, pub, key_id, key_hash, key_last4, name, username, status, review_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(row.id, row.pub, row.key_id, row.key_hash, row.key_last4, row.name, row.username, row.review_token, row.created_at).run();
  ctx.waitUntil(postSubmitKey(env, url.origin, row));
  return json({ status: "pending", keyId: k.keyId });
}

async function postSubmitKey(env, origin, row) {
  try {
    const id = await webhookPost(env, { content: submitKeyMessage(origin, row) });
    if (id) await env.DB.prepare("UPDATE submit_keys SET webhook_message_id = ? WHERE id = ?").bind(id, row.id).run();
  } catch (e) { console.error("webhook", e); }
}

function submitKeyMessage(origin, k) {
  const who = [k.name ? `**${md(k.name)}**` : "", k.username ? `@${md(k.username)}` : "", `license …${k.key_last4}`].filter(Boolean).join(" · ");
  const link = `${origin}/submit/review/${k.id}?t=${k.review_token}`;
  const head = {
    active: `✅ **Submissions now arrive here, encrypted for key ${k.key_id}**`,
    denied: `⛔ **Key ${k.key_id} refused**`,
    replaced: `↩️ **Key ${k.key_id} replaced by a newer one**`,
  }[k.status] || `🔑 **Receive submissions here with key ${k.key_id}?**`;
  const note = k.status === "pending" ? "\nOnly confirm if the key ID and fingerprint on the review page match your own FAFO (Settings → Password and sharing)." : "";
  return `${head}\nOffered by ${who}${note}\n[${k.status === "pending" ? "Review: confirm or refuse" : "Change decision"}](${link})`;
}

async function submitKeyReview(request, env, ctx, url, id) {
  const k = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM submit_keys WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!k || !(await sameText(t, k.review_token))) return page(404, "Key not found", "This review link isn't valid.");

  let done = "";
  const now = Date.now();
  const touched = [];
  if (action === "confirm" && k.status !== "active") {
    const { results: old } = await env.DB.prepare("SELECT * FROM submit_keys WHERE status = 'active'").all();
    await env.DB.batch([
      env.DB.prepare("UPDATE submit_keys SET status = 'replaced', decided_at = ? WHERE status = 'active'").bind(now),
      env.DB.prepare("UPDATE submit_keys SET status = 'active', decided_at = ? WHERE id = ?").bind(now, k.id),
    ]);
    touched.push(...old.map((o) => o.id), k.id);
    done = "Confirmed. Submissions now come to your channel, and only the FAFO with this key can open them.";
  } else if (action === "deny" && k.status !== "denied") {
    await env.DB.prepare("UPDATE submit_keys SET status = 'denied', decided_at = ? WHERE id = ?").bind(now, k.id).run();
    touched.push(k.id);
    done = k.status === "active" ? "Stopped. FAFO won't send submissions to your channel until you confirm a key again." : "Refused.";
  }
  for (const tid of touched) {
    const row = await env.DB.prepare("SELECT * FROM submit_keys WHERE id = ?").bind(tid).first();
    if (row.webhook_message_id) ctx.waitUntil(webhookEdit(env, row.webhook_message_id, { content: submitKeyMessage(url.origin, row) }).catch(() => {}));
  }
  const cur = await env.DB.prepare("SELECT * FROM submit_keys WHERE id = ?").bind(k.id).first();
  const label = { pending: "Waiting for you", active: "In use: submissions are encrypted for this key", denied: "Refused", replaced: "Replaced by a newer key" }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : "", "license …" + cur.key_last4].filter(Boolean).join(" · ");
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (action, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${action}">${esc(text)}</button></form>`;
  return page(200, "Collecting key", done || label,
    `<p class="small" style="margin-top:8px">Key ID</p><p class="key">${esc(cur.key_id)}</p>
     <p class="small" style="margin-top:8px">Fingerprint</p><p class="key" style="font-size:15px">${esc((await collectKey(cur.pub)).fingerprint)}</p>
     <p class="small">Only confirm if the key ID and fingerprint match the ones in your own FAFO, under Settings → Password and sharing. Submissions are encrypted for it, and only the FAFO that has this key can open them.</p>
     <p class="small">Offered by ${esc(who)}<br>${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC${done ? `<br>Status: ${esc(label)}` : ""}</p>
     <div class="row">${cur.status !== "active" ? btn("confirm", cur.status === "pending" ? "Confirm" : "Use this key", "ok") : ""}${cur.status !== "denied" ? btn("deny", cur.status === "active" ? "Stop using it" : "Refuse", "no") : ""}</div>`);
}

// Pokémon Center checks out with just an email, which each of its slots' AYCD profiles carries, so its logins file isn't
// posted (the owner's request, 2026-10-07: "a login:password is not required"). It's still made here: assignAccounts
// counts its lines to find where the assigned rows start. A file is the store's by the key its profiles file came with
// (app 1.9.58+), or by the store's name.
const isPokemonCenterFile = (f, files) => {
  const key = f.storeKey || (files.find((x) => x.kind === "profiles" && x.store === f.store) || {}).storeKey || "";
  const plain = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return [key.replace(/^other:/, ""), f.store].some((x) => /^pokemon ?cent(er|re)$/.test(plain(x)));
};

async function submission(request, env, url, ctx) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  if (Number(request.headers.get("content-length") || 0) > SUBMISSION_MAX_CHARS + 20000) return json({ error: "too large" }, 413);
  const text = await request.text();
  if (text.length > SUBMISSION_MAX_CHARS + 20000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  // App 1.9.53 and later send `files`: each store's profiles as CSV in the owner's columns, and its
  // logins (email:password lines). 1.9.52 sends one `csv`; older apps send a sealed code. The first
  // two need no key.
  const given = Array.isArray(b.files) ? b.files : null;
  const csv = given === null && typeof b.csv === "string" ? b.csv : null;
  let code = "", keyId, files = null;
  if (given !== null) {
    if (!given.length || given.length > SUBMISSION_MAX_FILES) return json({ error: "files" }, 400);
    files = [];
    for (const f of given) {
      const store = String(f && f.store || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const kind = f && f.kind, t = f && typeof f.text === "string" ? f.text : "";
      if (!store || !t.trim() || (kind !== "profiles" && kind !== "logins" && kind !== "aycd")) return json({ error: "files" }, 400);
      if (kind === "profiles" && !/^\uFEFF?profile_name,/.test(t)) return json({ error: "that isn't a slots CSV" }, 400);
      // App 1.9.58+: the store's key, and how many of its slots (the rows right after the ones with a
      // login) are on Use Assigned Account, to get accounts from the owner's list.
      const storeKey = typeof f.storeKey === "string" && /^([a-z0-9]{2,24}|other:[^\r\n]{1,40})$/.test(f.storeKey) ? f.storeKey : "";
      const assigned = kind === "profiles" && storeKey ? Math.min(SLOT_MAX, Math.max(0, Math.floor(Number(f.assigned)) || 0)) : 0;
      files.push({ store, kind, text: t, storeKey, assigned });
    }
    if (!files.some((f) => f.kind === "profiles")) return json({ error: "files" }, 400);
    if (files.reduce((n, f) => n + f.text.length, 0) > SUBMISSION_MAX_CHARS) return json({ error: "too large" }, 413);
    // Each store's AYCD list goes just before its CSV: the app's (1.9.87+), when it has an entry for every
    // row, or one made from the CSV.
    const out = [], same = (x, f) => x.store === f.store && x.storeKey === f.storeKey;
    for (const f of files) {
      const twins = (kind) => files.filter((x) => x.kind === kind && same(x, f)).length;
      if (f.kind === "aycd") {
        if (twins("aycd") > 1 || twins("profiles") !== 1) return json({ error: "files" }, 400);
        continue;
      }
      if (f.kind === "profiles") {
        const rows = parseCsv(f.text).length - 1, sent = files.find((x) => x.kind === "aycd" && same(x, f));
        if (rows > SLOT_MAX) return json({ error: "files" }, 400);
        const list = sent ? aycdList(sent.text, rows) : aycdFromCsv(f.text);
        if (!list) return json({ error: "that isn't an AYCD list for those slots" }, 400);
        out.push({ store: f.store, kind: "aycd", list, storeKey: f.storeKey, assigned: 0 });
      }
      out.push(f);
    }
    files = out;
    keyId = "CSV";
  } else if (csv !== null) {
    if (!/^\uFEFF?profile_name,/.test(csv) || csv.length > SUBMISSION_MAX_CHARS) return json({ error: "that isn't a slots CSV" }, 400);
    keyId = "CSV";
  } else {
    code = String(b.code || "");
    if (!/^PVSUB1\.[A-Za-z0-9_-]{80,100}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{24,}$/.test(code) || code.length > SUBMISSION_MAX_CHARS) return json({ error: "that isn't a sealed submission" }, 400);
    const active = await activeSubmitKey(env);
    if (!active) return json({ error: "no collecting key" }, 409);
    // Sealed for an older key: the owner couldn't open it with the key they use now.
    if (b.keyId !== active.key_id) return json({ error: "key changed", pub: active.pub, keyId: active.key_id }, 409);
    keyId = active.key_id;
  }
  const slots = Math.floor(Number(b.slots));
  if (!(slots >= 1 && slots <= SLOT_MAX)) return json({ error: "slots" }, 400);
  // `seller` (app 1.9.53+): how many of the store's slots ask the owner to assign an account.
  const stores = (Array.isArray(b.stores) ? b.stores : []).slice(0, 40)
    .map((x) => {
      const n = Math.floor(Number(x && x.n)) || 0;
      return { name: String(x && x.name || "").replace(/\s+/g, " ").trim().slice(0, 40), n, seller: Math.min(n, Math.max(0, Math.floor(Number(x && x.seller)) || 0)) };
    })
    .filter((x) => x.name && x.n > 0);
  // The app sends the same batch id when it retries, so a batch whose answer got lost isn't posted twice.
  const batch = /^[A-Za-z0-9_-]{16,40}$/.test(b.batch || "") ? b.batch : randomId(12);
  const seen = await env.DB.prepare(`SELECT s.key_hash, s.webhook_message_id, r.status AS review FROM submissions s
    LEFT JOIN submission_reviews r ON r.id = s.id WHERE s.id = ?`).bind(batch).first();
  if (seen) {
    if (seen.key_hash !== lic.hash) return json({ error: "batch id taken" }, 409);
    return seen.webhook_message_id ? json({ ok: true, id: batch, duplicate: true, ...(seen.review ? { review: seen.review } : {}) }) : json({ error: "still sending" }, 425);
  }
  // Payments: a buyer who isn't paid up can't send (402, before anything is recorded or posted).
  // A billing error (D1) never stops a batch.
  const refused = await billingGate(env, ctx, lic, b, files).catch((e) => { console.error("billing", e); return null; });
  if (refused) return refused;
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 3600 * 1000).first();
  if (recent && recent.n >= SUBMISSIONS_PER_HOUR) return json({ error: "too many submissions this hour" }, 429);

  const s = {
    id: batch, key_hash: lic.hash, key_last4: lic.last4, username: lic.username,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), slots, key_id: keyId,
  };
  // Recorded before any account is picked or anything is posted, so a retry that arrives meanwhile
  // isn't handled twice.
  const bytes = files !== null ? files.reduce((n, f) => n + (f.kind === "aycd" ? aycdText(f.list) : f.kind === "logins" && isPokemonCenterFile(f, files) ? "" : f.text).length, 0) : (csv !== null ? csv : code).length;
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO submissions (id, key_hash, key_last4, name, username, slots, bytes, key_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(s.id, s.key_hash, s.key_last4, s.name, s.username, slots, bytes, s.key_id, now).run();
  if (!ins.meta || !ins.meta.changes) return json({ error: "still sending" }, 425);
  // The buyer's own accounts on these slots, read before assigned accounts are filled in, and kept (as hashes) once the
  // batch reaches the channel, so the checkouts their FAFO reports on them can be checked (payments). Never fails the batch.
  const owns = files !== null ? await slotAccounts(files).catch((e) => { console.error("billing", e); return []; }) : [];
  // Slots on Use Assigned Account get accounts from the owner's list: {store name: {asked, got}}.
  const moves = [];
  let picks;
  // Which of the app's slots on each store are still out (app 1.9.99+): a profile sent again that has none out there gets
  // back the account it had (assignAccounts). Older apps don't say, and their profiles get new accounts as before.
  const active = b.active && typeof b.active === "object" && !Array.isArray(b.active) ? new Map(Object.entries(b.active).slice(0, 40)
    .filter(([k, v]) => /^([a-z0-9]{2,24}|other:[^\r\n]{1,40})$/.test(k) && Array.isArray(v))
    .map(([k, v]) => [k, new Set(v.slice(0, SLOT_MAX * 4).map((x) => String(x == null ? "" : x).slice(0, 80)))])) : null;
  try { picks = files !== null ? await assignAccounts(env, lic, batch, files, now, moves, active) : new Map(); }
  catch (e) {
    // Nothing was posted: the accounts taken go back, and the batch can be sent again.
    await undoMoves(env, lic, batch, moves).catch((x) => console.error("accounts", x));
    await settleAccounts(env, lic, batch, false, Date.now()).catch((x) => console.error("accounts", x));
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(batch).run().catch((x) => console.error("record", x));
    throw e;
  }
  // What goes to the channel: each store's AYCD list, its Shikari CSV (made from its slots CSV) and its logins file, with
  // no logins file for Pokémon Center.
  const posted = files !== null ? files.filter((f) => !(f.kind === "logins" && isPokemonCenterFile(f, files))) : [];
  const pokemonCenter = files !== null && files.some((f) => f.kind === "profiles" && isPokemonCenterFile(f, files));
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const slug = s.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const who = [s.name ? `**${md(s.name)}**` : "", s.username ? `@${md(s.username)}` : "", `license …${s.key_last4}`].filter(Boolean).join(" · ");
  // `seller` slots that got an account from the list, and ones still waiting for the owner to assign one.
  const short = (x) => Math.max(0, x.seller - ((picks.get(x.name) || {}).got || 0));
  const limit = await accountLimit(env, lic.hash);
  const accts = (x) => {
    const p = picks.get(x.name) || {}, got = p.got || 0, need = short(x);
    // Slots given the account their profile's slot at the other store has (reuseAccount, listAccount) say so, as do slots
    // given back the account they had, and why the rest got none (2026-10-07: the owner couldn't tell).
    const parts = [got ? `${got} assigned account${got === 1 ? "" : "s"}${p.reused ? `, ${p.reused} reused from ${p.from && p.from.length ? p.from.join(" and ") : "the other store"}` : ""}${p.back ? `, ${p.back} they had before` : ""}` : "",
      need ? `${need} need${need === 1 ? "s" : ""} an account${p.why === "limit" ? `: this license is at its limit of ${limit}` : p.why === "empty" ? ": your list has none"
        : p.why === "mine" ? ": your list has none for buyers, only in your Only mine inboxes" : ""}` : ""].filter(Boolean);
    return parts.length ? ` (${parts.join(", ")})` : "";
  };
  const storeLine = stores.map((x) => `${md(x.name)} ${x.n}${accts(x)}`).join(" · ").slice(0, 1200);
  const plainStores = stores.map((x) => `${x.name} ${x.n}${accts(x)}`).join(" · ").slice(0, 1200);
  const tail = files !== null
    ? `-# Per store: its profiles for AYCD (.json) and Shikari (.csv)${posted.some((f) => f.kind === "logins") ? `, with its logins (email:password, .txt) in the same order${pokemonCenter ? " (none for Pokémon Center)" : ""}` : ""}.${stores.some((x) => short(x)) ? " Profiles that need an account come last." : ""}`
    : csv !== null ? "-# CSV attached." : `-# Encrypted for key ${keyId}. To open: download the file, then in FAFO choose **Import** and drop it in.`;
  const content = `📦 **${slots} slot${slots === 1 ? "" : "s"}** from ${who}${storeLine ? `\n${storeLine}` : ""}\n${tail}`;
  const base = `orbit-slots-${stamp}${slug ? "-" + slug : ""}`;
  let attach;
  if (files !== null) {
    // Each file is labeled with the buyer and the store (the owner's request, 2026-10-09): Kim-target-aycd.json,
    // Kim-target-shikari.csv and Kim-target-logins.txt; the name they sent with, or their Discord name. No logins
    // for Pokémon Center (2026-10-07). The slots CSV itself goes out only as Shikari's.
    const ascii = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
    const buyer = ascii(s.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)
      || ascii(s.username).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || `license-${s.key_last4}`;
    const used = new Map();
    const label = (store) => {
      const x = ascii(store).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "store";
      if (!used.has(store)) { let y = x, i = 2; while ([...used.values()].includes(y)) y = `${x}-${i++}`; used.set(store, y); }
      return used.get(store);
    };
    attach = posted.map((f) => f.kind === "aycd"
      ? { name: `${buyer}-${label(f.store)}-aycd.json`, text: aycdText(f.list), type: "application/json" }
      : f.kind === "profiles" ? { name: `${buyer}-${label(f.store)}-shikari.csv`, text: shikariCsv(f.text), type: "text/csv" }
      : { name: `${buyer}-${label(f.store)}-logins.txt`, text: f.text });
  } else attach = [csv !== null ? { name: base + ".csv", text: excelSafe(csv), type: "text/csv" } : { name: base + ".txt", text: code }];
  // The owner approves the batch from its message (submissionReview), and the app shows the buyer whether they have.
  // If that can't be recorded, the batch still goes out, without an Approve link.
  const review = { id: s.id, status: "pending", review_token: randomId(24), content };
  const reviewed = await env.DB.batch([
    env.DB.prepare("DELETE FROM submission_reviews WHERE created_at < ?").bind(now - SUBMISSION_REVIEW_KEEP_MS),
    env.DB.prepare("INSERT OR REPLACE INTO submission_reviews (id, key_hash, status, review_token, content, stores, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)")
      .bind(s.id, lic.hash, review.review_token, content, plainStores, now),
  ]).then(() => true, (e) => { console.error("review", e); return false; });
  // Discord takes 10 attachments a message, so more go in follow-up messages. If one of those fails,
  // the batch counts as not sent and the app sends it again (the owner may then see the first part twice).
  let msgId = null, postedAny = false;
  try {
    for (let i = 0; i < attach.length; i += 10) {
      const part = attach.slice(i, i + 10);
      const id = await webhookPost(env, { content: i ? `-# More files for the batch from ${who} (${i + 1}–${i + part.length} of ${attach.length}).` : reviewed ? submissionMessage(url.origin, review) : content }, part);
      if (!id) { msgId = null; break; }
      postedAny = true;
      if (!i) msgId = id;
    }
  } catch (e) { msgId = null; console.error("webhook", e); }
  if (!msgId) {
    // Accounts that can't have reached the channel go back to the list (or to the batch they came from); if part of the
    // batch went out, they're kept for this batch, and sending it again posts the same ones. Done before the batch's record
    // goes, as above: while it's there, the batch counts as being sent, so a reassign (swapAccount) waits for this.
    if (!postedAny) await undoMoves(env, lic, batch, moves).catch((e) => console.error("accounts", e));
    if (picks.size) await settleAccounts(env, lic, batch, postedAny, Date.now()).catch((e) => console.error("accounts", e));
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(s.id).run();
    if (reviewed) await env.DB.prepare("DELETE FROM submission_reviews WHERE id = ?").bind(s.id).run().catch((e) => console.error("review", e));
    return json({ error: "couldn't post to the channel" }, 502);
  }
  const recorded = await env.DB.prepare("UPDATE submissions SET webhook_message_id = ? WHERE id = ?").bind(msgId, s.id).run().then(() => true, (e) => { console.error("record", e); return false; });
  if (recorded && owns.length) await recordAccounts(env, lic.hash, batch, owns, Date.now()).catch((e) => console.error("billing", e));
  if (picks.size) await settleAccounts(env, lic, batch, true, Date.now()).catch((e) => console.error("accounts", e));
  // Each list the batch's slots took accounts from: the one list (Target and Pokémon Center), or a store's own.
  const lists = new Map((files || []).filter((f) => f.assigned > 0).map((f) => [listStoreOf(f.storeKey), f.store]));
  for (const [st, name] of lists) await stockCheck(env, st, name, true).catch((e) => console.error("stock", e));
  // How many slots got an account per store; buyers never see which. `review`: the batch waits for the owner's approval.
  return json({ ok: true, id: s.id, ...(reviewed ? { review: "pending" } : {}),
    ...(picks.size ? { accounts: Object.fromEntries([...picks].map(([k, p]) => [k, { asked: p.asked, got: p.got, ...(p.reused ? { reused: p.reused } : {}) }])) } : {}) });
}

// The owner approves or declines each batch from its message (the owner's requests, 2026-10-06): app 1.9.91+ shows the
// buyer Pending approval until then, and Success after (1.9.92+ also Declined); it asks GET /submissions/status.
// Either decision is final. Declining asks once more first, and puts the accounts given to the batch's slots back on the
// owner's list. Kept 90 days.
const SUBMISSION_REVIEW_KEEP_MS = 90 * 86400000;
// A batch's message as posted, with a last line saying whether the owner has approved or declined it.
function submissionMessage(origin, r) {
  const at = () => `<t:${Math.floor(r.decided_at / 1000)}:f>`;
  return r.status === "approved" ? `${r.content}\n✅ **Approved** ${at()}`
    : r.status === "declined" ? `${r.content}\n⛔ **Declined** ${at()}`
    : `${r.content}\n⏳ **Pending your approval** · [Approve or decline](${origin}/submissions/review/${r.id}?t=${r.review_token})`;
}

async function submissionReview(request, env, ctx, url, id) {
  const r = /^[A-Za-z0-9_-]{16,40}$/.test(id) ? await env.DB.prepare(`SELECT r.*, s.name, s.username, s.key_last4, s.slots, s.webhook_message_id
    FROM submission_reviews r JOIN submissions s ON s.id = r.id WHERE r.id = ?`).bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!r || !(await sameText(t, r.review_token))) return page(404, "Slots not found", "This review link isn't valid.");
  // Accounts from the owner's stores' own lists given to this batch's slots (Use Assigned Account), which declining puts
  // back; the one list's go by declineEffect (listBack, listKept).
  const given = async () => (await env.DB.prepare(`SELECT store FROM accounts WHERE key_hash = ? AND batch = ? AND ${OWN_ACCOUNT} AND store <> '${MASTER}'`).bind(r.key_hash, r.id).all()).results;
  const none = { kept: 0, released: 0, listKept: 0, listBack: 0 };
  let done = "", asking = false;
  if (r.status === "pending" && (action === "approve" || action === "decline")) {
    const now = Date.now(), status = action === "approve" ? "approved" : "declined";
    const back = status === "declined" ? await given() : [];
    // Worked out before the batch is marked: accounts that stay for a Pokémon Center slot elsewhere, and parked ones
    // whose last slot is in this batch.
    const eff = status === "declined" ? await declineEffect(env, r.key_hash, r.id) : none;
    // Its message is no longer needed once it's marked.
    const res = await env.DB.prepare("UPDATE submission_reviews SET status = ?, decided_at = ?, content = '' WHERE id = ? AND status = 'pending'").bind(status, now, r.id).run();
    if (res.meta && res.meta.changes) {
      if (r.webhook_message_id) ctx.waitUntil(webhookEdit(env, r.webhook_message_id, { content: submissionMessage(url.origin, { ...r, status, decided_at: now }) }).catch(() => {}));
      // Every decline, so a batch whose only accounts are reuses drops them too.
      if (status === "declined") {
        await freeBatch(env, r.key_hash, r.id);
        // The buyer's own accounts in it never went out (payments): orders on them aren't billed, also those their FAFO
        // already reported while the batch waited, unless another batch had that account out then.
        await declineLines(env, r.key_hash, r.id).catch((e) => console.error("billing", e));
        await env.DB.prepare("DELETE FROM billing_accounts WHERE key_hash = ? AND batch = ?").bind(r.key_hash, r.id).run().catch((e) => console.error("billing", e));
        for (const st of new Set([...back.map((a) => a.store), ...Object.values(REUSE_FROM), MASTER])) await stockCheck(env, st, accountStoreName(st), false);
      }
      const kept = eff.kept, freed = back.length - eff.kept + eff.released + eff.listBack;
      done = status === "approved" ? "Approved. Their FAFO now shows these slots as Success."
        : `Declined. Their FAFO now shows these slots as Declined.${freed ? ` ${freed} account${freed === 1 ? "" : "s"} given to them ${freed === 1 ? "is" : "are"} back on your list.` : ""}${keptNote(kept)}${listKeptNote(eff.listKept)}`;
    }
    Object.assign(r, await env.DB.prepare("SELECT status, decided_at FROM submission_reviews WHERE id = ?").bind(r.id).first());
  } else if (r.status === "pending" && action === "decline-ask") asking = true;
  const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const label = r.status === "approved" ? `Approved ${when(r.decided_at)}. Their FAFO shows these slots as Success.`
    : r.status === "declined" ? `Declined ${when(r.decided_at)}. Their FAFO shows these slots as Declined.` : "Waiting for you.";
  const who = [r.name, r.username ? "@" + r.username : "", "license …" + r.key_last4].filter(Boolean).join(" · ");
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  const eff = asking ? await declineEffect(env, r.key_hash, r.id) : none, kept = eff.kept;
  const n = r.status === "pending" ? (await given()).length - eff.kept + eff.released + eff.listBack : 0;
  const head = `<p class="who">${r.slots} slot${r.slots === 1 ? "" : "s"}${r.name ? ` from ${esc(r.name)}` : ""}</p>
     ${r.stores ? `<p class="small" style="margin-top:8px">${esc(r.stores)}</p>` : ""}`;
  const sent = `<p class="small">Sent by ${esc(who)}, ${esc(when(r.created_at))}</p>`;
  if (asking) return page(200, "Decline these slots?", "",
    `${head}
     <p class="small">Their FAFO will show these slots as Declined, and they can send them again.${n ? ` The ${n} account${n === 1 ? "" : "s"} given to them go${n === 1 ? "es" : ""} back on your list.` : ""}${keptNote(kept)}${listKeptNote(eff.listKept)} This can't be undone.</p>
     ${sent}
     <div class="row">${btn("decline", "Decline", "no")}<form method="get"><input type="hidden" name="t" value="${esc(t)}"><button class="copy" style="width:100%;padding:12px;font-size:16px" type="submit">Keep it waiting</button></form></div>`);
  return page(200, "Submitted slots", done || label,
    `${head}
     ${r.status === "pending" ? `<p class="small">Approve once you have their files in your channel. Until then their FAFO shows these slots as Pending approval, and after, as Success. If you decline, it shows them as Declined.</p>` : ""}
     ${sent}
     ${r.status === "pending" ? `<div class="row">${btn("approve", "Approve", "ok")}${btn("decline-ask", "Decline", "no")}</div>` : ""}`);
}

// The owner's decision on batches this license sent: {batches: {id: {status: "pending" | "approved" | "declined", at}}},
// leaving out ids it didn't send or sent before approvals began. `at` is when it was decided.
async function submissionStatus(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const ids = [...new Set(String(url.searchParams.get("ids") || "").split(",").filter((x) => /^[A-Za-z0-9_-]{16,40}$/.test(x)))].slice(0, 100);
  const batches = {};
  if (ids.length) {
    const { results } = await env.DB.prepare("SELECT id, status, decided_at FROM submission_reviews WHERE key_hash = ? AND id IN (SELECT value FROM json_each(?))")
      .bind(lic.hash, JSON.stringify(ids)).all();
    for (const x of results) batches[x.id] = x.status === "pending" ? { status: "pending" } : { status: x.status, at: x.decided_at };
  }
  return json({ batches }, 200, { "cache-control": "no-store" });
}

// This license's batches that have an approval, oldest first: {now, batches:[{id, at, slots, name, status, decided}]},
// `at` when each arrived, `name` the sender's, `decided` when the owner approved or declined it. Apps before 1.9.91 kept
// no batch id for what they sent (the owner's report, 2026-10-07: those slots showed Submitted while their batch waited
// for approval), so app 1.9.98+ matches each of those sends to its batch by name, size and time (`now` sets the
// computer's clock against this one's), then asks /submissions/status like any other.
async function submissionBatches(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const since = Math.max(0, Math.floor(Number(url.searchParams.get("since"))) || 0);
  const until = Math.floor(Number(url.searchParams.get("until"))) || Date.now() + 86400000;
  const { results } = await env.DB.prepare(`SELECT r.id, r.status, r.created_at, r.decided_at, s.slots, s.name FROM submission_reviews r
    JOIN submissions s ON s.id = r.id WHERE r.key_hash = ? AND r.created_at >= ? AND r.created_at <= ? ORDER BY r.created_at LIMIT 2000`)
    .bind(lic.hash, since, until).all();
  const batches = results.map((x) => ({ id: x.id, at: x.created_at, slots: x.slots, name: x.name || "", status: x.status, ...(x.decided_at ? { decided: x.decided_at } : {}) }));
  return json({ now: Date.now(), batches }, 200, { "cache-control": "no-store" });
}

// ---- assigned accounts -------------------------------------------------------------------
//
// The owner's own store accounts, for slots set to Use Assigned Account (app 1.9.58+). The owner sends
// them from Orbit and adds them from the review link posted to their channel. When a batch comes in,
// each such slot gets a random free account for its store: its email goes in the slot's row (the
// `email` column, and on its AYCD profile) and email:password is added to that store's logins file (posted for every
// store but Pokémon Center), so line N still goes with
// row N. An account goes to one slot only; the buyer never sees it. A license gets as many in all as its slot limit
// (accountLimit), and an account picked for a batch that never reached the channel goes back to the list.

const ACCOUNT_OFFERS_PER_DAY = 5;
const ACCOUNT_OFFER_MAX = 1000;
// An offer nobody decided on expires, and the accounts it holds (with their passwords) are dropped
// (ACCOUNT_OFFER_TTL_MS overrides it for tests).
const offerTtlMs = (env) => Number(env.ACCOUNT_OFFER_TTL_MS) > 0 ? Number(env.ACCOUNT_OFFER_TTL_MS) : 7 * 86400000;
const expireOffers = (env, now) => env.DB.prepare("UPDATE account_offers SET status = 'expired', accounts = '[]', decided_at = ? WHERE status = 'pending' AND created_at < ?")
  .bind(now, now - offerTtlMs(env)).run();
// How many of the owner's accounts a license can be given in all: as many as the slots it can have on at once (2026-10-12,
// the owner's request: they approved a buyer 50 slots, but that buyer's accounts stopped at the fixed 20 of ASSIGNED_LIMIT). A license
// on the default slot limit (none approved, or an approval taken back) gets the default: ASSIGNED_LIMIT if it's set (the
// tests set it), else DEFAULT_SLOT_LIMIT.
const assignLimit = (env) => { const n = Math.floor(Number(env.ASSIGNED_LIMIT)); return String(env.ASSIGNED_LIMIT ?? "").trim() !== "" && n >= 0 ? n : slotDefault(env); };
async function accountLimit(env, hash) {
  const row = await env.DB.prepare("SELECT slot_limit FROM slot_limits WHERE key_hash = ?").bind(hash).first();
  const n = row && row.slot_limit !== slotDefault(env) ? row.slot_limit : assignLimit(env);
  // On a monthly plan (payments), at least the plan's slots.
  const plan = await planSlots(env, hash).catch((e) => { console.error("billing", e); return null; });
  return plan ? Math.max(n, plan) : n;
}
// A pick whose batch never reached the channel is freed after this (ASSIGN_STALE_MS overrides it for tests).
const assignStaleMs = (env) => Number(env.ASSIGN_STALE_MS) > 0 ? Number(env.ASSIGN_STALE_MS) : 60 * 60 * 1000;
const FREE_ACCOUNT = "key_hash = NULL, key_last4 = NULL, batch = NULL, store_name = NULL, profile = NULL, assigned_at = NULL, sent_at = NULL";
// A Pokémon Center slot can get its profile's Target account again (reuseAccount). That account is kept as a
// Pokémon Center row marked offer_id "reuse:target", which isn't on the owner's list: it's deleted where others are
// freed, and doesn't count in a store's stock or toward a license's limit (OWN_ACCOUNT).
const OWN_ACCOUNT = "COALESCE(offer_id, '') NOT LIKE 'reuse:%'";
// One list for Target and Pokémon Center (2026-10-13, the owner's request: "make this a master list for both target and
// pokemon center"; they chose one buyer per account). Its accounts are rows with store MASTER. One goes to a buyer's profile
// (key_hash, profile and the batch it was first given in, on that row) when a slot of theirs on Use Assigned Account at
// either store needs one, and each of that profile's slots that uses it has a row of its own at its store (offer_id USE: a
// reuse of the list's row, so it's dropped where that one is freed and never counts toward a limit or a list's stock),
// which pulls, order alerts, declines and slots sent again go by, as before. The profile's slot at the other store gets
// the same account (listAccount). It goes back on the list once no slot of theirs uses it any more (sweepParked), or when
// the owner gives it back. Accounts the owner sends or adds for Target or Pokémon Center go on it; other stores keep lists
// of their own. Rows from the stores' own lists from before (none on the owner's, which was empty) still work as they did.
const MASTER = "*", USE = "reuse:" + MASTER;
const MASTER_STORES = new Set(["target", "pokemoncenter"]);
const listStoreOf = (store) => MASTER_STORES.has(store) ? MASTER : store;
// Where accounts of a list are, in what the owner reads: "your list" for the one list, "your Kohl's list" for a store's own.
const listName = (store) => store === MASTER ? "your list" : `your ${accountStoreName(store)} list`;
// Inboxes on the one list (2026-10-23, the owner's request: "Make 3 Inboxes for Pokemon and Target for accounts list… When
// buyer submit their slots, it will only be pull from <the first> inbox only… Only I will have access to that accounts in
// that inbox"). An inbox is the mailbox an account's email goes to, a label the owner gives it (D1 account_inboxes; which
// account is in which, by email_norm: account_inbox_of). For buyers (mine 0): buyers' slots get its accounts. Only mine
// (mine 1): only slots sent from the owner's own FAFO (the one allowed to send order alerts, currentAlertSender) get them,
// before any For buyers one ("My inboxes first, then <the first>"). An account in no inbox (or one that's gone) is For
// buyers, so nothing changes until the owner makes inboxes. Other stores' own lists have none.
// `col` names an email_norm column: whether that account is in an Only mine inbox (aliases ibx_i and ibx_b stay out of the
// way of the queries it goes in).
const IN_MINE = (col) => `EXISTS (SELECT 1 FROM account_inbox_of ibx_i JOIN account_inboxes ibx_b ON ibx_b.id = ibx_i.inbox_id WHERE ibx_i.email_norm = ${col} AND ibx_b.mine = 1)`;
// The owner's license (its key_hash), or null while no FAFO is allowed to send order alerts: then every slot is a buyer's.
const ownerHash = async (env) => { const s = await currentAlertSender(env); return s ? s.key_hash : null; };
const INBOX_NAME_MAX = 120, INBOX_MAX = 50;
const inboxNameOf = (x) => String(x || "").replace(/\s+/g, " ").trim();
const inboxNorm = (x) => inboxNameOf(x).toLowerCase();
const inboxKind = (mine) => mine ? "Only mine" : "For buyers";
const INBOX_KINDS_HINT = "For buyers: buyers' slots get these. Only mine: only slots sent from your own FAFO, the one that sends order alerts, get these; they're used before the For buyers ones.";
// A select's options: the inboxes (each after what it's for, which a narrow select then never cuts off), after a placeholder when nothing is picked yet, and No inbox
// at the end when `none`.
const inboxOptions = (inboxes, sel, placeholder, none = false) => (placeholder ? `<option value=""${sel ? "" : " selected"} disabled>${esc(placeholder)}</option>` : "")
  + inboxes.map((b) => `<option value="${esc(b.id)}"${b.id === sel ? " selected" : ""}>${inboxKind(b.mine)} · ${esc(b.name)}</option>`).join("")
  + (none ? `<option value="none"${sel === "none" ? " selected" : ""}>For buyers · No inbox</option>` : "");
// Every inbox, in the order they were made, with how many of the list's accounts are in each (and how many are free).
async function listInboxes(env) {
  const { results } = await env.DB.prepare(`SELECT b.id, b.name, b.mine, b.created_at, COUNT(a.email_norm) AS n, COALESCE(SUM(CASE WHEN a.email_norm IS NOT NULL AND a.key_hash IS NULL THEN 1 ELSE 0 END), 0) AS free
    FROM account_inboxes b LEFT JOIN account_inbox_of i ON i.inbox_id = b.id LEFT JOIN accounts a ON a.store = '${MASTER}' AND a.email_norm = i.email_norm
    GROUP BY b.id ORDER BY b.created_at, b.name_norm`).all();
  return results;
}
// Moves the list's accounts (email_norms) to inbox `id`, or out of every inbox (null): Move to inbox, and an account's Edit
// page. Who has an account doesn't change. How many moved.
async function moveToInbox(env, id, norms, now) {
  let moved = 0;
  for (let i = 0; i < norms.length; i += 500) {
    const list = JSON.stringify(norms.slice(i, i + 500));
    const r = await (id ? env.DB.prepare(`INSERT INTO account_inbox_of (email_norm, inbox_id, set_at) SELECT j.value, ?2, ?3 FROM json_each(?1) j
        WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.store = '${MASTER}' AND a.email_norm = j.value) AND EXISTS (SELECT 1 FROM account_inboxes WHERE id = ?2)
        ON CONFLICT (email_norm) DO UPDATE SET inbox_id = excluded.inbox_id, set_at = excluded.set_at WHERE account_inbox_of.inbox_id <> excluded.inbox_id`).bind(list, id, now)
      : env.DB.prepare("DELETE FROM account_inbox_of WHERE email_norm IN (SELECT value FROM json_each(?))").bind(list)).run();
    moved += r.meta && r.meta.changes || 0;
  }
  return moved;
}
// Drops the rows of accounts no longer on the list, and of inboxes that are gone, so an email put on the list again starts in
// no inbox. Run where accounts come off the list.
const sweepInboxes = (env) => env.DB.prepare(`DELETE FROM account_inbox_of WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.store = '${MASTER}' AND a.email_norm = account_inbox_of.email_norm)
  OR NOT EXISTS (SELECT 1 FROM account_inboxes b WHERE b.id = account_inbox_of.inbox_id)`).run();
// Accounts that don't work (2026-10-23, the owner's request: "For accounts that doesn't work, make 2 lists. One for Account
// disabled and another list for need to generate"): set aside off the one list (D1 accounts_aside), so no slot gets them,
// as a Reassign's old account or, on See my list, a free one. Back on my list puts one on the list again, in the inbox it
// was in, and so does adding its email again (addToList), with the password typed (one generated again, say).
const ASIDE = { disabled: "Account disabled", generate: "Need to generate" };
const isAside = (k) => Object.hasOwn(ASIDE, k);   // never an inherited key (toString…), which no section shows
const ASIDE_PICK = "aside:";   // a tick's store for one set aside: aside:disabled, aside:generate
const asideList = (k) => `your ${ASIDE[k]} list`;
// Sets aside the one list's free accounts (email_norms) on list `list`, each in a transaction with taking it off the list
// (and its inbox row: the inbox goes with it, to come back to). One given to a slot meanwhile stays. How many.
async function setAside(env, norms, list, now) {
  let moved = 0;
  for (let i = 0; i < norms.length; i += 50) {
    const res = await env.DB.batch(norms.slice(i, i + 50).flatMap((e) => [
      env.DB.prepare(`INSERT INTO accounts_aside (email_norm, email, password, list, inbox_id, from_last4, from_profile, set_at)
        SELECT o.email_norm, o.email, o.password, ?2, (SELECT inbox_id FROM account_inbox_of WHERE email_norm = ?1), NULL, NULL, ?3
        FROM accounts o WHERE o.store = '${MASTER}' AND o.email_norm = ?1 AND o.key_hash IS NULL AND ${OWN_ACCOUNT}
        ON CONFLICT (email_norm) DO UPDATE SET email = excluded.email, password = excluded.password, list = excluded.list, inbox_id = excluded.inbox_id,
          from_last4 = NULL, from_profile = NULL, set_at = excluded.set_at`).bind(e, list, now),
      env.DB.prepare(`DELETE FROM accounts WHERE store = '${MASTER}' AND email_norm = ?1 AND key_hash IS NULL AND ${OWN_ACCOUNT}
        AND EXISTS (SELECT 1 FROM accounts_aside WHERE email_norm = ?1 AND set_at = ?2)`).bind(e, now),
      env.DB.prepare(`DELETE FROM account_inbox_of WHERE email_norm = ?1 AND NOT EXISTS (SELECT 1 FROM accounts WHERE store = '${MASTER}' AND email_norm = ?1)`).bind(e),
    ]));
    moved += res.reduce((n, r, k) => n + (k % 3 === 1 && r.meta && r.meta.changes || 0), 0);
  }
  return moved;
}
// A reuse goes with the account it reuses: one whose Target account is freed (by /admin/accounts/free, say) is deleted
// too, so the Pokémon Center slot doesn't keep an email the list may give another buyer. (`where` names the freed
// accounts' own columns, which inside the subquery are s's.) Then a parked account whose last slot this freed goes back.
async function freeAccounts(env, where, ...binds) {
  const [, , r] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM accounts WHERE NOT (${OWN_ACCOUNT}) AND EXISTS (SELECT 1 FROM accounts s WHERE s.store = substr(accounts.offer_id, 7)
      AND s.key_hash = accounts.key_hash AND s.email_norm = accounts.email_norm AND (${where}))`).bind(...binds),
    env.DB.prepare(`DELETE FROM accounts WHERE NOT (${OWN_ACCOUNT}) AND (${where})`).bind(...binds),
    env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE ${where}`).bind(...binds)]);
  await sweepParked(env);
  return r;
}
// Declining a batch puts back the accounts given to its slots, except a Target account that the same buyer's Pokémon
// Center slot (same profile) in another batch still checks out with: a reuse, or the same email from the Pokémon Center
// list. That one stays with the buyer, parked (its batch becomes "parked:" + the declined batch), until no such slot is
// left (sweepParked); otherwise the list could give the email to a second buyer (2026-10-07, the owner's request).
// Declining a Pokémon Center batch always frees or drops its rows, so a held Pokémon Center row is in a batch that
// isn't declined. A slot sent again takes its account to the new batch before the batch is posted, and back if nothing
// was posted (takeAccount, undoMoves), so a decline meanwhile never frees an account a posted slot uses; a declined
// Target slot sent again gets its parked account back (assignAccounts).
const PARKED = "parked:";
// A row r at the reusing store (the first bind) with the same buyer, profile and email as `accounts`; `batchCond`
// narrows r.batch. A Pokémon Center row is only ever held in a batch that isn't declined, except reuses the worker
// before 2026-10-07 left in declined batches: some of those are still used by the slot sent again (that worker didn't
// move them), so they count as in use too, and stay until the owner frees them by hand.
const usedBy = (batchCond) => `EXISTS (SELECT 1 FROM accounts r WHERE r.store = ? AND r.key_hash = accounts.key_hash AND r.email_norm = accounts.email_norm
  AND r.profile = accounts.profile AND r.batch IS NOT NULL AND r.batch NOT LIKE '${PARKED}%' AND ${batchCond})`;
const PAIRS = () => Object.entries(REUSE_FROM);   // [[reusing store, store it reuses from]]
// How many of a batch's accounts declining it would leave with the buyer, and how many parked ones it would put back
// (their only slot left is in this batch).
async function declineEffect(env, keyHash, batch) {
  let kept = 0, released = 0;
  for (const [to, from] of PAIRS()) {
    const k = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND batch = ? AND store = ? AND ${OWN_ACCOUNT} AND ${usedBy("r.batch <> accounts.batch")}`)
      .bind(keyHash, batch, from, to).first();
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND store = ? AND batch LIKE '${PARKED}%'
      AND ${usedBy("r.batch = ?")} AND NOT ${usedBy("r.batch <> ?")}`).bind(keyHash, from, to, batch, to, batch).first();
    kept += k ? k.n : 0; released += r ? r.n : 0;
  }
  // Accounts from the list on this batch's slots: one the buyer's slot at the other store, in another batch, still uses
  // stays with them (listKept); the rest go back (listBack).
  const { results: uses } = await env.DB.prepare(`SELECT u.email_norm, MAX(EXISTS (SELECT 1 FROM accounts v WHERE v.offer_id = '${USE}' AND v.key_hash = u.key_hash
    AND v.email_norm = u.email_norm AND v.batch <> u.batch)) AS other FROM accounts u WHERE u.key_hash = ? AND u.batch = ? AND u.offer_id = '${USE}' GROUP BY u.email_norm`)
    .bind(keyHash, batch).all();
  const listKept = uses.filter((x) => x.other).length;
  return { kept, released, listKept, listBack: uses.length - listKept };
}
// What the decline page says about the ones that stay (one pair of stores so far: REUSE_FROM), and about the list's.
const keptNote = (k) => {
  if (!k) return "";
  const [[to, from]] = PAIRS(), one = k === 1;
  return ` ${k} ${accountStoreName(from)} account${one ? " stays" : "s stay"} with them: their ${accountStoreName(to)} slot${one ? " in another batch uses it" : "s in other batches use them"} too.`;
};
const listKeptNote = (k) => !k ? "" : ` ${k} account${k === 1 ? " stays" : "s stay"} with them: their slot${k === 1 ? "" : "s"} at the other store in another batch use${k === 1 ? "s it" : " them"} too.`;
// Run once the batch is marked declined (and again by undoMoves for a batch declined while a move was out). An account
// from the list isn't freed with the batch it was first given in: its slots' rows in the batch go, and it goes back once
// none is left (sweepParked).
async function freeBatch(env, keyHash, batch) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM accounts WHERE key_hash = ? AND batch = ? AND NOT (${OWN_ACCOUNT})`).bind(keyHash, batch),
    ...PAIRS().map(([to, from]) => env.DB.prepare(`UPDATE accounts SET batch = '${PARKED}' || batch WHERE key_hash = ? AND batch = ? AND store = ?
      AND ${OWN_ACCOUNT} AND ${usedBy("r.batch <> accounts.batch")}`).bind(keyHash, batch, from, to)),
    env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE key_hash = ? AND batch = ? AND store <> '${MASTER}'`).bind(keyHash, batch),
  ]);
  await sweepParked(env);
}
// A parked account no slot uses any more goes back on the list, and so does an account from the list (MASTER) none of its
// buyer's slots uses any more. One not yet sent (its batch still being sent) is left to that batch: freed if it never
// reaches the channel (settleAccounts, or as a stale pick).
async function sweepParked(env) {
  await env.DB.batch([...PAIRS().map(([to, from]) => env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE store = ? AND batch LIKE '${PARKED}%' AND NOT ${usedBy("1")}`)
    .bind(from, to)),
    env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE store = '${MASTER}' AND key_hash IS NOT NULL AND sent_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM accounts u WHERE u.offer_id = '${USE}' AND u.email_norm = accounts.email_norm AND u.key_hash = accounts.key_hash)`)]);
}
// Moves an account this buyer holds from batch `from` to the batch being sent, if it's still there; the move is noted
// so undoMoves can put it back. False if it moved meanwhile (a decline, say).
async function takeAccount(env, lic, batch, store, emailNorm, from, storeName, moves) {
  const r = await env.DB.prepare("UPDATE accounts SET batch = ?, store_name = ? WHERE store = ? AND email_norm = ? AND key_hash = ? AND batch = ?")
    .bind(batch, storeName, store, emailNorm, lic.hash, from).run();
  if (!(r.meta && r.meta.changes)) return false;
  moves.push({ store, emailNorm, from, storeName: storeName });
  return true;
}
// Nothing of the batch reached the channel: the accounts go back to the batches they came from, and one whose batch was
// declined meanwhile gets what that decline would have done.
async function undoMoves(env, lic, batch, moves) {
  if (!moves.length) return;
  await env.DB.batch(moves.map((m) => env.DB.prepare("UPDATE accounts SET batch = ? WHERE store = ? AND email_norm = ? AND key_hash = ? AND batch = ?")
    .bind(m.from, m.store, m.emailNorm, lic.hash, batch)));
  const froms = [...new Set(moves.map((m) => m.from).filter((b) => !b.startsWith(PARKED)))];
  const { results } = froms.length ? await env.DB.prepare(`SELECT id FROM submission_reviews WHERE status = 'declined' AND id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(froms)).all() : { results: [] };
  for (const x of results) await freeBatch(env, lic.hash, x.id);
  await sweepParked(env);
}

// The slots CSV as the app writes it: comma-separated, quoted when a cell has a comma, quote or line break.
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; i++; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const csvCell = (v) => { const t = String(v == null ? "" : v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

// The owner opens CSVs in Excel (since 2026-10-06 only app 1.9.52's single CSV is posted this way; per-store slots go
// out as AYCD JSON, and from 2026-10-09 as Shikari CSVs in plain values, for the bot), which reads a run of digits as a
// number: a card number shows
// as 5.55556E+15 and keeps only 15 digits (saving the file turns the 16th into 0), and CVVs, months
// and zip codes lose a leading 0. So those cells go to the channel as ="…", which Excel and Google
// Sheets show as the text itself, and Excel saves as the plain value. Any other cell that starts with
// = + - or @ (buyers type these) would run as a formula, so it goes out the same way. Orbit's CSV
// import (1.9.68+) reads ="…" as the text inside.
const EXCEL_TEXT_COLS = new Set([
  "phone_num", "cc_number", "cc_exp_month", "cc_cvv", "shipping_zip_code", "billing_zip_code",   // app 1.9.53+
  "phone", "card_number", "card_exp_month", "card_cvv", "ship_zip", "bill_zip",                   // app 1.9.52
]);
// A string in an Excel formula holds 255 characters at most, so a longer one is joined from parts.
const excelText = (v) => "=" + v.match(/[\s\S]{1,250}/g).map((p) => `"${p.replace(/"/g, '""')}"`).join("&");
function excelSafe(text) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const rows = parseCsv(text), head = (rows[0] || []).map((h) => h.replace(/^\uFEFF/, "").trim().toLowerCase());
  for (let r = 1; r < rows.length; r++) rows[r] = rows[r].map((v, i) => v && (EXCEL_TEXT_COLS.has(head[i]) || /^[=+\-@\t\r]/.test(v)) ? excelText(v) : v);
  return rows.map((r) => r.map(csvCell).join(",")).join(eol) + (/\r?\n$/.test(text) ? eol : "");
}

// AYCD JSON (the owner's choice, 2026-10-06): each store's slots also go to the channel as an AYCD profile list,
// laid out as AYCD exports it, in the same order as the CSV's rows. App 1.9.87+ sends it (kind "aycd") with the
// card's own name and Only one checkout; for older apps it's made here from the CSV, with the billing name as the
// name on card (the CSV has no column for it). States and countries are written out, as AYCD does (FAFO's lists).
const COUNTRIES = [["US","United States"],["CA","Canada"],["GB","United Kingdom"],["IE","Ireland"],["AU","Australia"],["NZ","New Zealand"],["DE","Germany"],["FR","France"],["IT","Italy"],["ES","Spain"],["PT","Portugal"],["NL","Netherlands"],["BE","Belgium"],["LU","Luxembourg"],["AT","Austria"],["CH","Switzerland"],["SE","Sweden"],["NO","Norway"],["DK","Denmark"],["FI","Finland"],["PL","Poland"],["CZ","Czechia"],["SK","Slovakia"],["HU","Hungary"],["RO","Romania"],["BG","Bulgaria"],["GR","Greece"],["HR","Croatia"],["SI","Slovenia"],["EE","Estonia"],["LV","Latvia"],["LT","Lithuania"],["JP","Japan"],["KR","South Korea"],["CN","China"],["HK","Hong Kong"],["TW","Taiwan"],["SG","Singapore"],["MY","Malaysia"],["TH","Thailand"],["PH","Philippines"],["ID","Indonesia"],["VN","Vietnam"],["IN","India"],["AE","United Arab Emirates"],["SA","Saudi Arabia"],["IL","Israel"],["TR","Türkiye"],["ZA","South Africa"],["MX","Mexico"],["BR","Brazil"],["AR","Argentina"],["CL","Chile"],["CO","Colombia"]];
const US_STATES = [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],["PR","Puerto Rico"],["GU","Guam"],["VI","U.S. Virgin Islands"],["AS","American Samoa"],["MP","Northern Mariana Islands"],["AA","Armed Forces Americas"],["AE","Armed Forces Europe"],["AP","Armed Forces Pacific"]];
const CA_PROVINCES = [["AB","Alberta"],["BC","British Columbia"],["MB","Manitoba"],["NB","New Brunswick"],["NL","Newfoundland and Labrador"],["NS","Nova Scotia"],["NT","Northwest Territories"],["NU","Nunavut"],["ON","Ontario"],["PE","Prince Edward Island"],["QC","Quebec"],["SK","Saskatchewan"],["YT","Yukon"]];
const placeName = (list, code) => (list.find((x) => x[0] === code) || [code, code])[1];
const aycdState = (state, country) => country === "US" ? placeName(US_STATES, state) : country === "CA" ? placeName(CA_PROVINCES, state) : state;
const AYCD_CARD = (n) => /^4/.test(n) ? "Visa" : /^3[47]/.test(n) ? "Amex" : /^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(n) ? "MasterCard"
  : /^(6011|65|64[4-9]|622)/.test(n) ? "Discover" : /^35(2[89]|[3-8])/.test(n) ? "JCB" : /^3(0[0-5]|[68])/.test(n) ? "Diners Club" : /^62/.test(n) ? "UnionPay" : "";
function aycdFromCsv(text) {
  const rows = parseCsv(text), head = (rows[0] || []).map((h) => h.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((r) => {
    const v = (k) => { const i = head.indexOf(k); return i < 0 ? "" : String(r[i] == null ? "" : r[i]).trim(); };
    const place = (pre, first, last) => ({ name: [v(first), v(last)].filter(Boolean).join(" "), email: v("email"), phone: v("phone_num"),
      line1: v(pre + "street"), line2: v(pre + "street_2"), line3: "", postCode: v(pre + "zip_code"), city: v(pre + "city"),
      country: placeName(COUNTRIES, v(pre + "country")), state: aycdState(v(pre + "state"), v(pre + "country")) });
    const ship = place("shipping_", "first_name", "last_name"), bill = place("billing_", "billing_first_name", "billing_last_name");
    const num = v("cc_number").replace(/\D/g, "");
    const same = ["name", "line1", "line2", "postCode", "city", "country", "state"].every((k) => ship[k] === bill[k]);
    return { name: v("profile_name"), notes: "", billingAddress: bill, shippingAddress: ship,
      paymentDetails: { nameOnCard: bill.name, cardType: AYCD_CARD(num), cardNumber: num, cardExpMonth: v("cc_exp_month"), cardExpYear: v("cc_exp_year"), cardCvv: v("cc_cvv") },
      sameBillingAndShippingAddress: same, onlyCheckoutOnce: false, matchNameOnCardAndAddress: true };
  });
}
// The app's list, if it's one AYCD could take for those rows: an object per row, nothing else.
function aycdList(text, rows) {
  let a; try { a = JSON.parse(text); } catch { return null; }
  return Array.isArray(a) && a.length === rows && a.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? a : null;
}
// An assigned account's email goes on both of a profile's addresses, as AYCD keeps it.
function aycdEmails(list, from, emails) {
  emails.forEach((e, i) => { const x = list[from + i]; if (x) for (const k of ["billingAddress", "shippingAddress"]) if (x[k] && typeof x[k] === "object") x[k].email = e; });
}
const aycdText = (list) => JSON.stringify(list, null, 2);

// Shikari's profile CSV (the owner's request, 2026-10-09, from a file Shikari made): each store's slots go to the
// channel this way too, made here from the slots CSV every app since 1.9.53 sends, after the accounts are filled in,
// so in the same order as the AYCD list. Its columns are the slots CSV's, but the values as Shikari writes them: the
// month without a leading 0 (9, not 09), a 4-digit year, the phone's 10 digits, state and country codes, CRLF lines.
// It's for loading into the bot, so no ="…" Excel text; a cell that would start with = + - or @ loses those instead.
const SHIKARI_COLS = ["profile_name", "first_name", "last_name", "email", "phone_num", "cc_number", "cc_exp_month", "cc_exp_year", "cc_cvv",
  "shipping_street", "shipping_street_2", "shipping_city", "shipping_state", "shipping_zip_code", "shipping_country",
  "billing_first_name", "billing_last_name", "billing_street", "billing_street_2", "billing_city", "billing_state", "billing_zip_code", "billing_country"];
const placeCode = (list, v) => { const t = v.toLowerCase(); return (list.find((x) => x[1].toLowerCase() === t) || [])[0] || ""; };
const COUNTRY_ALIASES = { usa: "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US", uk: "GB", "great britain": "GB" };
function shikariCsv(text) {
  const rows = parseCsv(text), head = (rows[0] || []).map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/^[=+\-@\s]+/, "");
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const country = (v) => { v = clean(v); return !v ? "US" : /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : COUNTRY_ALIASES[v.toLowerCase()] || placeCode(COUNTRIES, v) || v; };
  const state = (v, c) => { v = clean(v); return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : (c === "US" ? placeCode(US_STATES, v) : c === "CA" ? placeCode(CA_PROVINCES, v) : "") || v; };
  const out = rows.slice(1).filter((r) => r.some((x) => String(x).trim())).map((r) => {
    const raw = (k) => { const i = head.indexOf(k); return i < 0 ? "" : r[i]; };
    const v = Object.fromEntries(SHIKARI_COLS.map((k) => [k, clean(raw(k))]));
    let phone = digits(v.phone_num);
    if (phone.length === 11 && phone[0] === "1") phone = phone.slice(1);
    const m = digits(v.cc_exp_month), y = digits(v.cc_exp_year);
    const shipC = country(v.shipping_country), billC = country(v.billing_country);
    return { ...v, phone_num: phone, cc_number: digits(v.cc_number), cc_exp_month: m ? String(Number(m)) : "", cc_exp_year: y.length === 2 ? "20" + y : y,
      cc_cvv: digits(v.cc_cvv), shipping_country: shipC, billing_country: billC,
      shipping_state: state(v.shipping_state, shipC), billing_state: state(v.billing_state, billC) };
  });
  return [SHIKARI_COLS.join(","), ...out.map((o) => SHIKARI_COLS.map((k) => csvCell(o[k])).join(","))].join("\r\n") + "\r\n";
}

// A Pokémon Center slot on Use Assigned Account whose profile already has a Target account (given out in this batch,
// or sent before) gets that account again (the owner's request, 2026-10-06), so the profile checks out with one email
// at both stores: its email in the row and on its AYCD profile. It's kept as a Pokémon Center
// row (pulls and order alerts find it there). If the email is on the owner's Pokémon Center list too, that account is
// used, with its own password, while it's free or already this profile's; if another buyer has it, the slot gets a
// free account as usual. Nothing counts toward the license's limit.
const REUSE_FROM = { pokemoncenter: "target" };
async function reuseAccount(env, lic, batch, f, profile, at, moves) {
  const from = REUSE_FROM[f.storeKey];
  if (!from || !profile) return null;
  // The Target list's own row (a slot's row of an account from the one list goes by listAccount).
  const t = await env.DB.prepare(`SELECT email, email_norm, password FROM accounts WHERE key_hash = ? AND store = ? AND profile = ? AND (sent_at IS NOT NULL OR batch = ?)
    AND ${OWN_ACCOUNT} ORDER BY batch = ? DESC, sent_at DESC, assigned_at DESC LIMIT 1`).bind(lic.hash, from, profile, batch, batch).first();
  if (!t) return null;
  const cur = await env.DB.prepare("SELECT key_hash, profile, email, password, batch FROM accounts WHERE store = ? AND email_norm = ?").bind(f.storeKey, t.email_norm).first();
  if (cur && cur.key_hash) {
    if (cur.key_hash !== lic.hash || cur.profile !== profile) return null;
    // The slot sent again (after a pull) takes it along, so declining the batch it was in before doesn't free it.
    if (cur.batch !== batch && !(await takeAccount(env, lic, batch, f.storeKey, t.email_norm, cur.batch, f.store, moves))) return null;
    return { email: cur.email, password: cur.password };
  }
  // Only while the Target account is still this buyer's for this profile (a decline meanwhile may have freed it).
  const still = "EXISTS (SELECT 1 FROM accounts s WHERE s.store = ? AND s.email_norm = ? AND s.key_hash = ? AND s.profile = ?)", own = [from, t.email_norm, lic.hash, profile];
  if (cur) return env.DB.prepare(`UPDATE accounts SET key_hash = ?, key_last4 = ?, batch = ?, store_name = ?, profile = ?, assigned_at = ?, sent_at = NULL
    WHERE store = ? AND email_norm = ? AND key_hash IS NULL AND ${still} RETURNING email, password`).bind(lic.hash, lic.last4, batch, f.store, profile, at, f.storeKey, t.email_norm, ...own).first();
  return env.DB.prepare(`INSERT OR IGNORE INTO accounts (store, email, email_norm, password, added_at, offer_id, key_hash, key_last4, batch, store_name, profile, assigned_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${still} RETURNING email, password`)
    .bind(f.storeKey, t.email, t.email_norm, t.password, at, "reuse:" + from, lic.hash, lic.last4, batch, f.store, profile, at, ...own).first();
}

// A slot at Target or Pokémon Center whose profile (by its name, same license) already has an account from the list: that
// account, so the profile checks out with one email at both stores. The slot's own row from before (sent again: in this
// batch already, or moved here from the batch it was in, as a Pokémon Center slot took its reused Target account along:
// "they had before"; moved back if this batch never posts), or a new row for it at this store, when the account came for
// the profile's slot at the other store ("reused"). Null when it has none, or when this batch gave it to another row here
// already (`taken`, store|email: two rows with one name): then the slot gets another account.
async function listAccount(env, lic, batch, f, profile, at, moves, taken) {
  if (!MASTER_STORES.has(f.storeKey) || !profile) return null;
  const m = await env.DB.prepare(`SELECT email, email_norm, password FROM accounts WHERE store = '${MASTER}' AND key_hash = ? AND profile = ?
    ORDER BY batch = ? DESC, sent_at IS NULL, assigned_at DESC LIMIT 1`).bind(lic.hash, profile, batch).first();
  if (!m || taken.has(f.storeKey + "|" + m.email_norm)) return null;
  const mine = { email: m.email, password: m.password, emailNorm: m.email_norm };
  const u = await env.DB.prepare("SELECT key_hash, profile, batch, offer_id FROM accounts WHERE store = ? AND email_norm = ?").bind(f.storeKey, m.email_norm).first();
  if (u) {
    if (u.key_hash !== lic.hash || u.profile !== profile || u.offer_id !== USE) return null;   // never another buyer's
    if (u.batch === batch) return { ...mine, how: "had" };
    if (await takeAccount(env, lic, batch, f.storeKey, m.email_norm, u.batch, f.store, moves)) return { ...mine, how: "back" };
    // It moved meanwhile (a decline dropped it, say): a row of its own here, if the account is still theirs.
  }
  // Only while it's still this profile's (a decline meanwhile may have put it back).
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO accounts (store, email, email_norm, password, added_at, offer_id, key_hash, key_last4, batch, store_name, profile, assigned_at)
    SELECT ?, email, email_norm, password, ?, '${USE}', key_hash, key_last4, ?, ?, profile, ? FROM accounts WHERE store = '${MASTER}' AND email_norm = ? AND key_hash = ? AND profile = ?
    RETURNING email, password`).bind(f.storeKey, at, batch, f.store, at, m.email_norm, lic.hash, profile).first();
  if (!r) return null;
  // Which store's slot it came from, for the store line: "reused from Target".
  const o = await env.DB.prepare(`SELECT store FROM accounts WHERE offer_id = '${USE}' AND email_norm = ? AND key_hash = ? AND store <> ? LIMIT 1`).bind(m.email_norm, lic.hash, f.storeKey).first();
  return { ...mine, how: "reused", from: o ? accountStoreName(o.store) : "" };
}
// A free account from the list for a slot at Target or Pokémon Center: it goes to the buyer's profile, and the slot gets a row
// of its own at its store, in one go. Never one that's a buyer's anywhere (an account on a store's own list with the same
// email, from before, say), or that has a row at this store already. `at` tells this slot's pick from the others' in the
// batch. A buyer's slot never gets one in an Only mine inbox; the owner's (`owner`: sent from their own FAFO) gets those
// first, then one buyers could get (2026-10-23).
async function claimListAccount(env, lic, batch, f, profile, at, owner = false) {
  const [c] = await env.DB.batch([
    env.DB.prepare(`UPDATE accounts SET key_hash = ?, key_last4 = ?, batch = ?, store_name = ?, profile = ?, assigned_at = ?, sent_at = NULL
      WHERE rowid = (SELECT rowid FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL
        AND NOT EXISTS (SELECT 1 FROM accounts g WHERE g.email_norm = m.email_norm AND g.key_hash IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.store = ? AND x.email_norm = m.email_norm)
        AND NOT EXISTS (SELECT 1 FROM accounts_aside s WHERE s.email_norm = m.email_norm)
        ${owner ? `ORDER BY ${IN_MINE("m.email_norm")} DESC, random()` : `AND NOT ${IN_MINE("m.email_norm")} ORDER BY random()`} LIMIT 1) RETURNING email, email_norm, password`)
      .bind(lic.hash, lic.last4, batch, f.store, profile, at, f.storeKey),
    env.DB.prepare(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id, key_hash, key_last4, batch, store_name, profile, assigned_at)
      SELECT ?, email, email_norm, password, ?, '${USE}', key_hash, key_last4, batch, store_name, profile, assigned_at FROM accounts
      WHERE store = '${MASTER}' AND key_hash = ? AND batch = ? AND profile = ? AND assigned_at = ? AND sent_at IS NULL`).bind(f.storeKey, at, lic.hash, batch, profile, at)]);
  const a = (c.results || [])[0];
  return a ? { email: a.email, password: a.password, emailNorm: a.email_norm } : null;
}

async function assignAccounts(env, lic, batch, files, now, moves, active) {
  const picks = new Map();
  // Pokémon Center after Target, so it can reuse the Target accounts given out in the same batch.
  const want = files.filter((f) => f.kind === "profiles" && f.assigned > 0).sort((a, b) => (REUSE_FROM[a.storeKey] ? 1 : 0) - (REUSE_FROM[b.storeKey] ? 1 : 0));
  if (!want.length) return picks;
  await freeAccounts(env, "sent_at IS NULL AND key_hash IS NOT NULL AND assigned_at < ?", now - assignStaleMs(env));
  const limit = await accountLimit(env, lic.hash);
  // Sent from the owner's own FAFO: its slots get the accounts in Only mine inboxes first (claimListAccount).
  const owner = want.some((f) => MASTER_STORES.has(f.storeKey)) && (await ownerHash(env)) === lic.hash;
  for (const f of want) {
    const logins = files.find((x) => x.kind === "logins" && x.store === f.store);
    const eol = /\r\n/.test(f.text) ? "\r\n" : "\n";
    const lines = logins ? logins.text.split(/\r?\n/).filter((x) => x.trim()) : [];
    const rows = parseCsv(f.text), col = (rows[0] || []).findIndex((h) => h.replace(/^\uFEFF/, "").trim() === "email");
    // The app puts these slots right after the ones with a login, so they start at row N + 1.
    const start = 1 + lines.length, asked = Math.min(f.assigned, Math.max(0, rows.length - start));
    // Sending the same batch again gets the same accounts, each for the same profile (a slot's row of an account from the
    // list goes by listAccount).
    const { results: had } = await env.DB.prepare(`SELECT email, password, profile FROM accounts WHERE key_hash = ? AND batch = ? AND store = ? AND ${OWN_ACCOUNT} ORDER BY assigned_at, rowid`)
      .bind(lic.hash, batch, f.storeKey).all();
    const res = [], taken = new Set(), from = new Map();
    const out = active && active.get(f.storeKey);
    let reused = 0, back = 0, more = true, why = "";
    const reuse = (name) => { reused++; from.set(name, (from.get(name) || 0) + 1); };
    for (let i = 0; i < asked; i++) {
      const profile = String(rows[start + i][0] || "").slice(0, 80);
      const l = await listAccount(env, lic, batch, f, profile, now + i, moves, taken);
      if (l) {
        res[i] = l; taken.add(f.storeKey + "|" + l.emailNorm);
        if (l.how === "reused") reuse(l.from); else if (l.how === "back") back++;
        continue;
      }
      const r = await reuseAccount(env, lic, batch, f, profile, now + i, moves);
      if (r) { res[i] = r; reuse(accountStoreName(REUSE_FROM[f.storeKey])); continue; }
      const h = had.findIndex((a) => a.profile === profile);
      if (h >= 0) { res[i] = had.splice(h, 1)[0]; continue; }
      // A declined slot sent again gets the account it had back, if it was kept for the profile's Pokémon Center slot.
      if (Object.values(REUSE_FROM).includes(f.storeKey)) {
        const k = await env.DB.prepare(`SELECT email, email_norm, password, batch FROM accounts WHERE key_hash = ? AND store = ? AND profile = ? AND batch LIKE '${PARKED}%'
          ORDER BY assigned_at DESC LIMIT 1`).bind(lic.hash, f.storeKey, profile).first();
        if (k && await takeAccount(env, lic, batch, f.storeKey, k.email_norm, k.batch, f.store, moves)) { res[i] = k; continue; }
      }
      // A profile sent again whose slot here isn't out any more (switched off, or cleared after a decline; the app says
      // which still are, 1.9.99+) gets back the account it had, while that's still this license's, instead of a new one
      // that counts toward its limit (the owner's request, 2026-10-07). Moved back if the batch never posts (undoMoves).
      if (out && profile && !out.has(profile)) {
        const k = await env.DB.prepare(`SELECT email, email_norm, password, batch FROM accounts WHERE key_hash = ? AND store = ? AND profile = ?
          AND sent_at IS NOT NULL AND batch IS NOT NULL AND batch != ? AND batch NOT LIKE '${PARKED}%' AND ${OWN_ACCOUNT}
          ORDER BY sent_at DESC, assigned_at DESC LIMIT 1`).bind(lic.hash, f.storeKey, profile, batch).first();
        if (k && await takeAccount(env, lic, batch, f.storeKey, k.email_norm, k.batch, f.store, moves)) { res[i] = k; back++; continue; }
      }
      if (!more) continue;
      // An account from the list counts once however many of the profile's slots use it (their rows are reuses).
      const held = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND ${OWN_ACCOUNT}`).bind(lic.hash).first();
      const atLimit = (held ? held.n : 0) >= limit;
      let a = null;
      if (!atLimit && MASTER_STORES.has(f.storeKey)) a = await claimListAccount(env, lic, batch, f, profile, now + i, owner);
      // The store's own list (other stores, and Target's or Pokémon Center's from before the one list): never an email
      // that's a buyer's anywhere, nor, for a buyer's slot, one whose email is in an Only mine inbox on the one list.
      if (!atLimit && !a) a = await env.DB.prepare(
        `UPDATE accounts SET key_hash = ?, key_last4 = ?, batch = ?, store_name = ?, profile = ?, assigned_at = ?, sent_at = NULL
         WHERE rowid = (SELECT rowid FROM accounts c WHERE c.store = ? AND c.key_hash IS NULL
           AND NOT EXISTS (SELECT 1 FROM accounts g WHERE g.email_norm = c.email_norm AND g.key_hash IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM accounts_aside s WHERE s.email_norm = c.email_norm)
           ${owner || !MASTER_STORES.has(f.storeKey) ? "" : `AND NOT ${IN_MINE("c.email_norm")}`} ORDER BY random() LIMIT 1) RETURNING email, password`
      ).bind(lic.hash, lic.last4, batch, f.store, profile, now + i, f.storeKey).first();
      if (a) { res[i] = a; if (a.emailNorm) taken.add(f.storeKey + "|" + a.emailNorm); }
      else {
        more = false; why = atLimit ? "limit" : "empty";   // only reuse from here on
        // A buyer's slot when the only free accounts on the list are in Only mine inboxes: the store line says so.
        if (!atLimit && !owner && MASTER_STORES.has(f.storeKey) && await env.DB.prepare(`SELECT 1 AS x FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL
          AND ${IN_MINE("m.email_norm")} LIMIT 1`).first()) why = "mine";
      }
    }
    // Rows left without an account go last, so line N of the logins file still goes with row N.
    const order = [...Array(asked).keys()].sort((x, y) => (res[x] ? 0 : 1) - (res[y] ? 0 : 1) || x - y);
    const aycd = files[files.indexOf(f) - 1];   // its AYCD list goes just before it
    if (order.some((x, k) => x !== k)) {
      const seg = order.map((x) => rows[start + x]), list = aycd && aycd.kind === "aycd" ? order.map((x) => aycd.list[lines.length + x]) : null;
      seg.forEach((r, k) => { rows[start + k] = r; });
      if (list) list.forEach((x, k) => { aycd.list[lines.length + k] = x; });
    }
    const got = order.map((x) => res[x]).filter(Boolean);
    if (got.length) {
      if (col >= 0) got.forEach((a, i) => { rows[start + i][col] = a.email; });
      f.text = rows.map((r) => r.map(csvCell).join(",")).join(eol);
      if (aycd && aycd.kind === "aycd") aycdEmails(aycd.list, lines.length, got.map((a) => a.email));
      const add = got.map((a) => `${a.email}:${a.password}`);
      if (logins) logins.text = logins.text.replace(/[\r\n]+$/, "") + (lines.length ? eol : "") + add.join(eol);
      else files.splice(files.indexOf(f) + 1, 0, { store: f.store, kind: "logins", text: add.join(eol), storeKey: f.storeKey, assigned: 0 });
    }
    picks.set(f.store, { asked: f.assigned, got: got.length, ...(reused ? { reused, from: [...from.keys()].filter(Boolean) } : {}), ...(back ? { back } : {}),
      ...(why && got.length < asked ? { why } : {}) });
  }
  return picks;
}

// The owner's channel is told once when a store's list is down to ACCOUNTS_LOW_AT free accounts (15),
// and once more when it runs out. post=false only clears those again, after accounts are added or freed.
const lowAt = (env) => { const n = Math.floor(Number(env.ACCOUNTS_LOW_AT)); return String(env.ACCOUNTS_LOW_AT ?? "").trim() !== "" && n >= 0 ? n : 15; };
// On the one list, only the accounts buyers can get count: those in Only mine inboxes are the owner's own (2026-10-23).
async function stockCheck(env, store, name, post) {
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN key_hash IS NULL THEN 1 ELSE 0 END) AS free FROM accounts WHERE store = ? AND ${OWN_ACCOUNT}
    ${store === MASTER ? `AND NOT ${IN_MINE("accounts.email_norm")}` : ""}`).bind(store).first();
  const total = c ? c.n : 0, free = c && c.free || 0, low = lowAt(env);
  if (free > low) await env.DB.prepare("UPDATE account_stock SET low_at = NULL, empty_at = NULL WHERE store = ?").bind(store).run();
  else if (free > 0) await env.DB.prepare("UPDATE account_stock SET empty_at = NULL WHERE store = ?").bind(store).run();
  if (!post || !total || free > low) return;
  // Claimed before posting, so two batches finishing together tell the owner once.
  const empty = free === 0, now = Date.now();
  const r = await env.DB.prepare(empty
    ? `INSERT INTO account_stock (store, low_at, empty_at) VALUES (?, ?, ?) ON CONFLICT (store) DO UPDATE
       SET low_at = COALESCE(account_stock.low_at, excluded.low_at), empty_at = excluded.empty_at WHERE account_stock.empty_at IS NULL`
    : `INSERT INTO account_stock (store, low_at) VALUES (?, ?) ON CONFLICT (store) DO UPDATE
       SET low_at = excluded.low_at WHERE account_stock.low_at IS NULL`).bind(...(empty ? [store, now, now] : [store, now])).run();
  if (!r.meta || !r.meta.changes) return;
  // The one list (Target and Pokémon Center) is "your list"; a store's own is named.
  const what = store === MASTER ? "" : md(name) + " ";
  await webhookPost(env, { content: empty
    ? `🚫 **No ${what}accounts left** on your list for Use Assigned Account. Slots on it wait for you to assign one by hand until you send more from FAFO (Settings → Accounts to assign).`
    : `⚠️ **Only ${free} ${what}account${free === 1 ? "" : "s"} left** on your list for Use Assigned Account. Send more from FAFO (Settings → Accounts to assign).` });
}

// sent: the batch (or part of it) reached the channel, so its accounts are given out for good.
// Otherwise they go back to the list.
// An account from the list counts as sent once any slot's row of it reached the channel, also when it was first given in
// another batch that's still being sent.
async function settleAccounts(env, lic, batch, sent, now) {
  if (sent) await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET sent_at = ? WHERE key_hash = ? AND batch = ? AND sent_at IS NULL").bind(now, lic.hash, batch),
    env.DB.prepare(`UPDATE accounts SET sent_at = ? WHERE store = '${MASTER}' AND key_hash = ? AND sent_at IS NULL
      AND email_norm IN (SELECT email_norm FROM accounts WHERE key_hash = ? AND batch = ? AND offer_id = '${USE}')`).bind(now, lic.hash, lic.hash, batch)]);
  else await freeAccounts(env, "key_hash = ? AND batch = ? AND sent_at IS NULL", lic.hash, batch);
}

const offerStoreName = (x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 40);
// Puts accounts on a list (`rows`: {email, password}), as the offers' review link, See my list's Add and a reassign's typed
// accounts do: one already there keeps its password, and a reused Target account on Pokémon Center's own list
// (reuseAccount) becomes the list's own, still with its slot. On the one list (MASTER), a free row with the same email left
// on Target's or Pokémon Center's own list from before goes: the one list has it now. And each goes in inbox `inbox` (an
// id), or the one its row names (`inbox` on the row: an id, or null for none), in the same batch (a transaction) as the
// account itself (2026-10-23): one meant for an Only mine inbox is never on the list without it, even for a moment, so a
// buyer's batch can't take it meanwhile, and isn't added at all if that inbox was deleted meanwhile. One in another inbox
// already stays there (`kept` counts those), so adding an account again never moves it out of an Only mine inbox; a row left
// by an account of the list that's gone (its email may come back now) goes first. A store's own row goes only once the one
// list has the email, and so does one set aside (accounts_aside: `back` counts those); a row with `asideAt` (Back on my list)
// goes on only while it's still set aside as it was read then (removed meanwhile, it stays removed). How many were added and kept, and
// whether an inbox was gone (`gone`: nothing meant for it was added).
async function addToList(env, store, rows, offerId, now, inbox = null) {
  let added = 0, kept = 0, gone = false, back = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100), stmts = [], adds = [], counts = [], there = [];
    const ibs = new Map();
    if (store === MASTER) {
      const norms = JSON.stringify(chunk.map((a) => a.email.toLowerCase()));
      for (const a of chunk) { const ib = a.inbox !== undefined ? a.inbox : inbox; if (ib) ibs.set(ib, [...(ibs.get(ib) || []), a.email.toLowerCase()]); }
      for (const ib of ibs.keys()) { there.push(stmts.length); stmts.push(env.DB.prepare("SELECT EXISTS (SELECT 1 FROM account_inboxes WHERE id = ?) AS ok").bind(ib)); }
      for (const [ib, list] of ibs) {
        counts.push(stmts.length);
        stmts.push(env.DB.prepare(`SELECT COUNT(*) AS n FROM account_inbox_of i JOIN account_inboxes b ON b.id = i.inbox_id WHERE i.inbox_id <> ?2
          AND i.email_norm IN (SELECT value FROM json_each(?1)) AND EXISTS (SELECT 1 FROM accounts a WHERE a.store = '${MASTER}' AND a.email_norm = i.email_norm)`).bind(JSON.stringify(list), ib));
      }
      stmts.push(env.DB.prepare(`DELETE FROM account_inbox_of WHERE email_norm IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.store = '${MASTER}' AND a.email_norm = account_inbox_of.email_norm)`).bind(norms));
    }
    for (const a of chunk) {
      const ib = store === MASTER ? (a.inbox !== undefined ? a.inbox : inbox) : null;
      adds.push(stmts.length);
      stmts.push(env.DB.prepare(`INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (?7 IS NULL OR EXISTS (SELECT 1 FROM account_inboxes WHERE id = ?7))
         AND (?8 IS NULL OR EXISTS (SELECT 1 FROM accounts_aside WHERE email_norm = ?3 AND set_at = ?8))
       ON CONFLICT (store, email_norm) DO UPDATE SET password = excluded.password, added_at = excluded.added_at, offer_id = excluded.offer_id WHERE NOT (${OWN_ACCOUNT})`
      ).bind(store, a.email, a.email.toLowerCase(), a.password, now, offerId, ib || null, a.asideAt ?? null));
      if (store === MASTER) stmts.push(env.DB.prepare(`DELETE FROM accounts WHERE store IN ('target', 'pokemoncenter') AND email_norm = ?1 AND key_hash IS NULL AND ${OWN_ACCOUNT}
        AND EXISTS (SELECT 1 FROM accounts m WHERE m.store = '${MASTER}' AND m.email_norm = ?1)`).bind(a.email.toLowerCase()));
    }
    let backAt = -1;
    if (store === MASTER) {
      backAt = stmts.length;
      stmts.push(env.DB.prepare(`DELETE FROM accounts_aside WHERE email_norm IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM accounts m WHERE m.store = '${MASTER}' AND m.email_norm = accounts_aside.email_norm)`).bind(JSON.stringify(chunk.map((a) => a.email.toLowerCase()))));
    }
    for (const [ib, list] of ibs) stmts.push(env.DB.prepare(`INSERT INTO account_inbox_of (email_norm, inbox_id, set_at) SELECT j.value, ?2, ?3 FROM json_each(?1) j
      WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.store = '${MASTER}' AND a.email_norm = j.value) AND EXISTS (SELECT 1 FROM account_inboxes WHERE id = ?2)
      ON CONFLICT (email_norm) DO UPDATE SET inbox_id = excluded.inbox_id, set_at = excluded.set_at
      WHERE NOT EXISTS (SELECT 1 FROM account_inboxes b WHERE b.id = account_inbox_of.inbox_id)`).bind(JSON.stringify(list), ib, now));
    const res = await env.DB.batch(stmts);
    added += adds.reduce((n, k) => n + (res[k].meta && res[k].meta.changes || 0), 0);
    kept += counts.reduce((n, k) => n + ((res[k].results || [])[0] || {}).n || 0, 0);
    if (there.some((k) => !((res[k].results || [])[0] || {}).ok)) gone = true;
    if (backAt >= 0) back += res[backAt].meta && res[backAt].meta.changes || 0;
  }
  return { added, kept, gone, back };
}

async function accountOffer(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  const text = await request.text();
  if (text.length > 400_000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const store = String(b.store || "");
  if (!/^([a-z0-9]{2,24}|other:[^\r\n]{1,40})$/.test(store)) return json({ error: "store" }, 400);
  const storeName = offerStoreName(b.storeName) || store;
  const seen = new Set(), accounts = [];
  for (const a of Array.isArray(b.accounts) ? b.accounts : []) {
    const email = String(a && a.email || "").trim(), password = String(a && a.password || "");
    if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email) || email.length > 120 || !password || password.length > 200 || /[\r\n]/.test(password)) return json({ error: "accounts", email }, 400);
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase()); accounts.push({ email, password });
  }
  if (!accounts.length || accounts.length > ACCOUNT_OFFER_MAX) return json({ error: "accounts" }, 400);
  const now = Date.now();
  ctx.waitUntil(expireOffers(env, now).catch((e) => console.error("offers", e)));
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_offers WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= ACCOUNT_OFFERS_PER_DAY) return json({ error: "too many tries today" }, 429);
  const o = {
    id: randomId(12), store, store_name: storeName, count: accounts.length, key_hash: lic.hash, key_last4: lic.last4,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), username: lic.username,
    status: "pending", review_token: randomId(24), created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO account_offers (id, store, store_name, accounts, count, key_hash, key_last4, name, username, status, review_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(o.id, o.store, o.store_name, JSON.stringify(accounts), o.count, o.key_hash, o.key_last4, o.name, o.username, o.review_token, o.created_at).run();
  ctx.waitUntil((async () => {
    const id = await webhookPost(env, { content: offerMessage(url.origin, o) });
    if (id) await env.DB.prepare("UPDATE account_offers SET webhook_message_id = ? WHERE id = ?").bind(id, o.id).run();
  })().catch((e) => console.error("webhook", e)));
  return json({ status: "pending", count: o.count });
}

// Only the count goes to the channel; the emails are on the review page, the passwords nowhere.
function offerMessage(origin, o) {
  const who = [o.name ? `**${md(o.name)}**` : "", o.username ? `@${md(o.username)}` : "", `license …${o.key_last4}`].filter(Boolean).join(" · ");
  const link = `${origin}/accounts/review/${o.id}?t=${o.review_token}`;
  // Accounts for Target or Pokémon Center go on the one list, so they're just accounts; a store's own are named.
  const n = (k) => `${k} ${listStoreOf(o.store) === MASTER ? "" : md(o.store_name) + " "}account${k === 1 ? "" : "s"}`;
  const head = o.status === "added" ? `✅ **Added ${n(o.added || 0)} to your list** for Use Assigned Account`
    : o.status === "refused" ? `⛔ **${n(o.count)} refused**` : o.status === "expired" ? `⌛ **${n(o.count)} expired** before they were added`
    : `🗂️ **Add ${n(o.count)} to your list for Use Assigned Account?**`;
  return `${head}\nSent by ${who}${o.status === "pending" ? `\n[Review: add or refuse](${link})` : ""}`;
}

async function accountReview(request, env, ctx, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM account_offers WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "", inboxId = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
    inboxId = form && String(form.get("inbox") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.review_token))) return page(404, "Accounts not found", "This review link isn't valid.");
  let done = "", err = "";
  const now = Date.now();
  if (o.status === "pending" && o.created_at < now - offerTtlMs(env)) { await expireOffers(env, now); o.status = "expired"; }
  // For the one list, once the owner has inboxes (2026-10-23), adding asks which one they go in.
  const inboxes = listStoreOf(o.store) === MASTER ? await listInboxes(env) : [];
  const inbox = inboxes.find((b) => b.id === inboxId) || null;
  if (o.status === "pending" && action === "add" && inboxes.length && !inbox) err = inboxId ? "That inbox isn't there any more: choose another." : "Choose the inbox they go in.";
  else if (o.status === "pending" && action === "add") {
    const list = JSON.parse(o.accounts || "[]");
    // Sent for Target or Pokémon Center (FAFO asks which): on the one list, for both.
    const { added, kept, gone, back } = await addToList(env, listStoreOf(o.store), list, o.id, now, inbox ? inbox.id : null);
    if (gone) err = "That inbox isn't there any more: choose another.";
    else {
      await env.DB.prepare("UPDATE account_offers SET status = 'added', added = ?, accounts = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(added, now, o.id).run();
      await stockCheck(env, listStoreOf(o.store), o.store_name, false);
      done = `Added ${added} to your list${inbox ? `, in ${inbox.name}` : ""}.${added < list.length ? ` ${list.length - added} ${list.length - added === 1 ? "was" : "were"} already on it.` : ""}`
        + (kept ? ` ${kept} already in another inbox stayed there (Move to inbox on See my list moves ${kept === 1 ? "it" : "them"}).` : "")
        + (back ? ` ${back === 1 ? "1 was" : `${back} were`} set aside (Account disabled or Need to generate), and ${back === 1 ? "is" : "are"} back on your list with the password typed.` : "");
    }
  } else if (o.status === "pending" && action === "refuse") {
    await env.DB.prepare("UPDATE account_offers SET status = 'refused', accounts = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, o.id).run();
    done = "Refused. Nothing was added.";
  }
  const cur = await env.DB.prepare("SELECT * FROM account_offers WHERE id = ?").bind(o.id).first();
  if (done && cur.webhook_message_id) ctx.waitUntil(webhookEdit(env, cur.webhook_message_id, { content: offerMessage(url.origin, cur) }).catch(() => {}));
  const st = listStoreOf(cur.store), one = st === MASTER;
  const mineToo = one && inboxes.some((b) => b.mine);
  const stats = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN key_hash IS NULL THEN 1 ELSE 0 END) AS free${mineToo
    ? `, SUM(CASE WHEN key_hash IS NULL AND NOT ${IN_MINE("accounts.email_norm")} THEN 1 ELSE 0 END) AS buyers` : ""} FROM accounts WHERE store = ? AND ${OWN_ACCOUNT}`).bind(st).first();
  const label = { pending: "Waiting for you", added: `Added ${cur.added} to your list`, refused: "Refused", expired: "Expired before it was added. Send the accounts again from FAFO." }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : "", "license …" + cur.key_last4].filter(Boolean).join(" · ");
  const emails = cur.status === "pending" ? JSON.parse(cur.accounts || "[]").map((a) => a.email) : [];
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  return page(200, one ? "Accounts for your list" : `${cur.store_name} accounts`, done || label,
    `<p class="who">${cur.count} account${cur.count === 1 ? "" : "s"} for Use Assigned Account${one ? " at Target and Pokémon Center" : ""}</p>
     <p class="small">${one ? "Your list is for Target and Pokémon Center both. Each slot on Use Assigned Account at either store gets one of your free accounts when its batch reaches your channel, with the email on its AYCD profile and, at Target, email:password in the logins file. A buyer's Target and Pokémon Center slots for one profile get the same account, and no other buyer gets it while they have it. Buyers never see them."
       : `Each slot on Use Assigned Account gets one of your free accounts when its batch reaches your channel, with the email on its AYCD profile and email:password in the logins file. Buyers never see them, and each one goes to one slot only.`}</p>
     ${cur.status === "pending" ? `<p class="small"><strong>Only add these if you sent them</strong> from your own FAFO (Settings → Accounts to assign).</p>` : ""}
     ${emails.length ? `<p class="small">${emails.slice(0, 12).map(esc).join("<br>")}${emails.length > 12 ? `<br>and ${emails.length - 12} more` : ""}</p>` : ""}
     <p class="small">${one ? "Your list" : `Your ${esc(cur.store_name)} list`}: ${stats.n || 0} account${stats.n === 1 ? "" : "s"}, ${stats.free || 0} free${mineToo ? ` (${stats.buyers || 0} for buyers)` : ""}.<br>Sent by ${esc(who)}, ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${cur.status === "pending" && inboxes.length ? `<form method="post" class="edit" id="offer-add">${hidden}
       <label>Inbox<select name="inbox" required>${inboxOptions(inboxes, inbox ? inbox.id : "", "Choose an inbox…")}</select></label>
       <p class="hint">The inbox their emails go to. ${INBOX_KINDS_HINT} One already on your list stays in its inbox.</p></form>` : ""}
     ${err ? `<p class="err">${esc(err)}</p>` : ""}
     ${cur.status === "pending" ? `<div class="row">${inboxes.length ? `<button class="ok" style="flex:1" type="submit" form="offer-add" name="action" value="add">Add to my list</button>` : btn("add", "Add to my list", "ok")}${btn("refuse", "Refuse", "no")}</div>` : ""}`);
}

// Accounts come off the list the same way (app 1.9.90+, the owner's request): FAFO sends the emails, the channel
// gets the count and a review link (never the emails), and the owner removes them there, from every store's list
// they're on. One already given to a buyer's slot goes too, so order alerts on it stop reaching them; the review
// page says where each one is first. Asking is limited like offers, and an ask nobody decided on expires.
const ACCOUNT_REMOVALS_PER_DAY = 5;
const expireRemovals = (env, now) => env.DB.prepare("UPDATE account_removals SET status = 'expired', emails = '[]', decided_at = ? WHERE status = 'pending' AND created_at < ?")
  .bind(now, now - offerTtlMs(env)).run();
const ACCOUNT_STORE_NAMES = { [MASTER]: "Target and Pokémon Center", target: "Target", walmart: "Walmart", bestbuy: "Best Buy", amazon: "Amazon", gamestop: "GameStop", pokemoncenter: "Pokémon Center", costco: "Costco", samsclub: "Sam's Club", nike: "Nike" };
const accountStoreName = (k) => ACCOUNT_STORE_NAMES[k] || String(k).replace(/^other:/, "");

async function accountRemove(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  const text = await request.text();
  if (text.length > 200_000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((e) => String(e || "").trim().toLowerCase()))];
  if (!emails.length || emails.length > ACCOUNT_OFFER_MAX || emails.some((e) => e.length > 120 || !/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(e))) return json({ error: "emails" }, 400);
  const now = Date.now();
  ctx.waitUntil(expireRemovals(env, now).catch((e) => console.error("removals", e)));
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_removals WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= ACCOUNT_REMOVALS_PER_DAY) return json({ error: "too many tries today" }, 429);
  const o = {
    id: randomId(12), count: emails.length, key_hash: lic.hash, key_last4: lic.last4,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), username: lic.username,
    status: "pending", review_token: randomId(24), created_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO account_removals (id, emails, count, key_hash, key_last4, name, username, status, review_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(o.id, JSON.stringify(emails), o.count, o.key_hash, o.key_last4, o.name, o.username, o.review_token, o.created_at).run();
  ctx.waitUntil((async () => {
    const id = await webhookPost(env, { content: removalMessage(url.origin, o) });
    if (id) await env.DB.prepare("UPDATE account_removals SET webhook_message_id = ? WHERE id = ?").bind(id, o.id).run();
  })().catch((e) => console.error("webhook", e)));
  return json({ status: "pending", count: o.count });
}

// As with offers, only the count goes to the channel; the emails are on the review page.
function removalMessage(origin, o) {
  const who = [o.name ? `**${md(o.name)}**` : "", o.username ? `@${md(o.username)}` : "", `license …${o.key_last4}`].filter(Boolean).join(" · ");
  const link = `${origin}/accounts/removal/${o.id}?t=${o.review_token}`;
  const n = (k) => `${k} account${k === 1 ? "" : "s"}`;
  const head = o.status === "removed" ? `🗑️ **Took ${n(o.removed || 0)} off your list** for Use Assigned Account`
    : o.status === "kept" ? `↩️ **Kept ${n(o.count)}** on your list` : o.status === "expired" ? `⌛ **Removing ${n(o.count)} expired** before you decided`
    : `🗑️ **Take ${n(o.count)} off your list for Use Assigned Account?**`;
  return `${head}\nAsked by ${who}${o.status === "pending" ? `\n[Review: remove or keep](${link})` : ""}`;
}

async function accountRemovalReview(request, env, ctx, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM account_removals WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.review_token))) return page(404, "Not found", "This review link isn't valid.");
  let done = "";
  const now = Date.now();
  if (o.status === "pending" && o.created_at < now - offerTtlMs(env)) { await expireRemovals(env, now); o.status = "expired"; }
  const list = o.status === "pending" ? JSON.parse(o.emails || "[]") : [];
  // Where each email is on the list now (a store's list each), to show before deciding.
  const where = new Map();
  for (let i = 0; i < list.length; i += 100) {
    const res = await env.DB.batch(list.slice(i, i + 100).map((e) => env.DB.prepare("SELECT store, key_hash, key_last4, profile, sent_at, offer_id FROM accounts WHERE email_norm = ? ORDER BY store").bind(e)));
    res.forEach((r, k) => where.set(list[i + k], r.results || []));
  }
  // Ones set aside (Account disabled, Need to generate: 2026-10-23) are on the owner's list too, for this.
  const asideAt = new Map();
  for (let i = 0; i < list.length; i += 500) for (const r of (await env.DB.prepare("SELECT email_norm, list FROM accounts_aside WHERE email_norm IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(list.slice(i, i + 500))).all()).results) asideAt.set(r.email_norm, r.list);
  if (o.status === "pending" && action === "remove") {
    let removed = 0;
    const stores = new Set();
    for (let i = 0; i < list.length; i += 100) {
      const res = await env.DB.batch(list.slice(i, i + 100).flatMap((e) => [env.DB.prepare("DELETE FROM accounts WHERE email_norm = ?").bind(e),
        env.DB.prepare("DELETE FROM accounts_aside WHERE email_norm = ?").bind(e)]));
      for (let k = 0; k < res.length; k += 2) {
        const e = list[i + k / 2];
        if (res[k].meta && res[k].meta.changes || res[k + 1].meta && res[k + 1].meta.changes) { removed++; (where.get(e) || []).forEach((a) => stores.add(a.store)); }
      }
    }
    await env.DB.prepare("UPDATE account_removals SET status = 'removed', removed = ?, emails = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(removed, now, o.id).run();
    if (removed) await sweepInboxes(env);
    for (const st of stores) await stockCheck(env, st, accountStoreName(st), false);
    const left = list.length - removed;
    done = `Took ${removed} off your list.${left ? ` ${left} ${left === 1 ? "wasn't" : "weren't"} on it.` : ""}`;
  } else if (o.status === "pending" && action === "keep") {
    await env.DB.prepare("UPDATE account_removals SET status = 'kept', emails = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, o.id).run();
    done = "Kept. Nothing was removed.";
  }
  const cur = await env.DB.prepare("SELECT * FROM account_removals WHERE id = ?").bind(o.id).first();
  if (done && cur.webhook_message_id) ctx.waitUntil(webhookEdit(env, cur.webhook_message_id, { content: removalMessage(url.origin, cur) }).catch(() => {}));
  const label = { pending: "Waiting for you", removed: `Took ${cur.removed} off your list`, kept: "Kept. Nothing was removed.", expired: "Expired before you decided. Ask again from FAFO." }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : "", "license …" + cur.key_last4].filter(Boolean).join(" · ");
  const pending = cur.status === "pending";
  const spot = (a) => `${esc(accountStoreName(a.store))}: ${!a.key_hash ? "free" : `given to license …${esc(a.key_last4 || "")}${a.profile ? ` for ${esc(a.profile)}` : ""}${a.sent_at ? "" : ", in a batch being sent"}`}`;
  // An account from the one list shows once: its slots' own rows at each store (USE) go with it.
  const line = (e) => { const rows = (where.get(e) || []).filter((a) => a.offer_id !== USE), x = asideAt.get(e);
    return `<strong>${esc(e)}</strong>: ${rows.length || x ? [...rows.map(spot), ...(x ? [esc(`on ${asideList(x)}`)] : [])].join("; ") : "not on your list"}`; };
  const given = pending && list.some((e) => (where.get(e) || []).some((a) => a.key_hash));
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  return page(200, "Remove accounts", done || label,
    `<p class="who">${cur.count} account${cur.count === 1 ? "" : "s"} to take off your list for Use Assigned Account</p>
     ${pending ? `<p class="small"><strong>Only remove these if you asked</strong> from your own FAFO (Settings → Accounts to assign). Each comes off every store's list it's on, and no more slots get it.</p>
       <p class="small">${list.slice(0, 50).map(line).join("<br>")}${list.length > 50 ? `<br>and ${list.length - 50} more` : ""}</p>` : ""}
     ${given ? `<p class="small">One given to a buyer's slot stops reporting its orders to them once it's removed.</p>` : ""}
     <p class="small">Asked by ${esc(who)}, ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${pending ? `<div class="row">${btn("remove", "Remove from my list", "no")}${btn("keep", "Keep them", "ok")}</div>` : ""}`);
}

// See my list (app 1.9.102+, the owner's request, 2026-10-09): FAFO asks for a link to the list, which goes to the
// owner's channel like every other review link, so only the owner opens it, whichever licensed FAFO asked. The page reads
// the list as it is each time it's opened: every store's accounts, free or given (to which license, for which profile,
// held for a Pokémon Center slot, or reused there from Target), never a password. Remove asks first, then takes the email
// off every store's list, as Remove accounts does. Edit (the owner's request: "make it to where I can edit the list")
// changes an account's password, or its email while it's free, and gives one that's been given back to the list
// (freeAccounts, as /admin/accounts/free does); Reassign gives a buyer's slots another account in place of theirs
// (swapAccount, 2026-10-14); Add puts accounts on a store's list as the offers' review link does.
// The link works for 24 hours.
const ACCOUNT_LISTS_PER_DAY = 10;
const LIST_PICK_MAX = 5000;   // accounts ticked on the list that one Copy or Remove takes
const LIST_REASSIGN_MAX = 100;   // and that one Reassign takes
// A batch whose channel message isn't recorded yet (submissions.webhook_message_id) is being sent: its accounts were read
// before it posts. One whose worker stopped before posting stops counting after this.
const BATCH_SENDING_MS = 10 * 60 * 1000;
// What the list's search compares: lowercase, accents taken off (so "pokemon" finds Pokémon Center), as LIST_SCRIPT does to
// what's typed.
const searchText = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const ACCOUNT_LIST_TTL_MS = 24 * 3600 * 1000;
async function accountListAsk(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  const text = await request.text();
  if (text.length > 2000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const now = Date.now();
  await env.DB.prepare("DELETE FROM account_lists WHERE created_at < ?").bind(now - 7 * 86400000).run();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_lists WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= ACCOUNT_LISTS_PER_DAY) return json({ error: "too many tries today" }, 429);
  const o = { id: randomId(12), key_hash: lic.hash, key_last4: lic.last4, username: lic.username,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), view_token: randomId(24), created_at: now };
  await env.DB.prepare("INSERT INTO account_lists (id, key_hash, key_last4, name, username, view_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(o.id, o.key_hash, o.key_last4, o.name, o.username, o.view_token, o.created_at).run();
  const who = [o.name ? `**${md(o.name)}**` : "", o.username ? `@${md(o.username)}` : "", `license …${o.key_last4}`].filter(Boolean).join(" · ");
  const id = await webhookPost(env, { content: `📋 **Your list for Use Assigned Account**\nAsked by ${who}\n[See or edit the list](${url.origin}/accounts/list/${o.id}?t=${o.view_token}) · the link works for 24 hours` });
  if (!id) { await env.DB.prepare("DELETE FROM account_lists WHERE id = ?").bind(o.id).run(); return json({ error: "couldn't post to the channel" }, 502); }
  return json({ status: "sent" });
}

// The Add box reads lines as FAFO's Send accounts does (parseAccountLines): email:password, email,password as CSV
// (quoted cells too, as FAFO writes a password with : , or " in it), email:password:inbox email:inbox password (the
// account's own password is kept), or an email on its own with the box's password for those lines. Like FAFO's Import
// accounts, it skips a first line naming the columns, and it takes a tab between the cells too. A Pokémon Center
// account's password is its inbox's.
const LIST_EMAIL = /^[^\s@:,"]+@[^\s@:,"]+\.[^\s@:,"]+$/;
// A line's cells, split at `sep`: each one either "quoted" (with "" for a quote) or with no quote in it at all. Null for
// any other line, so a stray quote is reported as a line that couldn't be read, never read as some other password.
function listCells(line, sep) {
  const cells = [];
  for (let i = 0; ;) {
    while (line[i] === " ") i++;
    if (line[i] === '"') {
      let v = "";
      for (i++; ; i++) {
        if (i >= line.length) return null;
        if (line[i] === '"') { if (line[i + 1] === '"') { v += '"'; i++; continue; } i++; break; }
        v += line[i];
      }
      while (line[i] === " ") i++;
      cells.push(v);
      if (i >= line.length) return cells;
      if (line[i] !== sep) return null;
      i++;
    } else {
      const j = line.indexOf(sep, i), v = line.slice(i, j < 0 ? line.length : j);
      if (v.includes('"')) return null;
      cells.push(v.trim());
      if (j < 0) return cells;
      i = j + 1;
    }
  }
}
function parseListLines(text, shared) {
  const rows = [], bad = [], bare = [], seen = new Set();
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(), n = i + 1;
    if (!line) return;
    if (line.length > 600) { bad.push(n); return; }
    let a = null;
    const parts = line.split(":");
    if (LIST_EMAIL.test(line)) { if (!shared) { bare.push(n); return; } a = { email: line, password: shared }; }
    if (!a && parts.length >= 4 && LIST_EMAIL.test(parts[0].trim())) {
      for (let k = 2; k < parts.length - 1; k++) {
        if (!LIST_EMAIL.test(parts[k].trim())) continue;
        const pw = parts.slice(1, k).join(":");
        if (pw && parts.slice(k + 1).join(":")) a = { email: parts[0].trim(), password: pw };
        break;
      }
    }
    if (!a) {
      const cells = listCells(line, line.includes("\t") ? "\t" : ",") || [];
      if (i === 0 && /^e-?mail/i.test(cells[0] || "") && !line.includes("@")) return;
      if (LIST_EMAIL.test(cells[0] || "") && cells[1] && ((!cells[2] && !cells[3]) || (LIST_EMAIL.test(cells[2] || "") && cells[3]))) a = { email: cells[0], password: cells[1] };
    }
    if (!a && parts.length === 2 && LIST_EMAIL.test(parts[0].trim()) && parts[1].trim()) a = { email: parts[0].trim(), password: parts[1].trim() };
    if (!a || a.email.length > 120 || a.password.length > 200 || /[\r\n]/.test(a.password)) { bad.push(n); return; }
    const k = a.email.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k); rows.push(a);
  });
  return { rows, bad, bare };
}
const lineList = (ns) => `${ns.length === 1 ? "Line" : "Lines"} ${ns.slice(0, 10).join(", ")}${ns.length > 10 ? ` and ${ns.length - 10} more` : ""}`;

// The list's search and ticks. The search box shows the rows with every word typed in their email, store or status
// (data-q), and hides a store with none; it's kept for the tab (sessionStorage), so it's still there after a change sends
// the page back to the list, and ?q= sets it. Ticks: Shift+click ticks every row shown between it and the last one
// clicked, a store's header box and Tick all (Tick shown, while searching) tick the rows shown, ticks on rows the search
// hides stay (the bar counts them), and the bar shows once one is ticked. Copy emails reads them from the page; Copy email:password asks the worker
// (POST action=copy) and puts the lines on the clipboard, one per line (CRLF), in the order shown, as FAFO copies logins.
// Without the script, the boxes still go with Remove.
const LIST_SCRIPT = `<script>
(() => {
  const bar = document.getElementById("bulk"), msg = document.getElementById("bulk-msg");
  if (!bar) return;
  const T = bar.querySelector('input[name="t"]').value;
  const boxes = () => [...document.querySelectorAll('input[name="pick"]')], ticked = () => boxes().filter((b) => b.checked);
  const shown = (b) => !b.closest("tr").hidden, visible = () => boxes().filter(shown);
  const find = document.getElementById("find"), KEY = "list-find:" + location.pathname;
  const say = (s) => { msg.textContent = s; };
  document.querySelectorAll(".js").forEach((e) => { e.hidden = false; });
  let last = null;
  const searching = () => !!find.value.trim();
  const paint = () => {
    const k = ticked().length, out = ticked().filter((b) => !shown(b)).length;
    bar.querySelector(".n").textContent = k + (k === 1 ? " account ticked" : " accounts ticked") + (out ? " (" + out + " not shown)" : "");
    bar.hidden = !k;
    // A section's box (a store's, or an inbox's on the one list) goes with the rows in its section.
    document.querySelectorAll("input.all").forEach((a) => {
      const s = visible().filter((b) => a.closest("section").contains(b)), on = s.filter((b) => b.checked).length;
      a.checked = !!s.length && on === s.length; a.indeterminate = on > 0 && on < s.length;
    });
    const v = visible(), all = document.querySelector("[data-pickall]"), every = !!v.length && v.every((b) => b.checked);
    all.textContent = (every ? "Untick " : "Tick ") + (searching() ? "shown" : "all");
    all.disabled = !v.length;
  };
  const filter = () => {
    const words = find.value.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").split(/\\s+/).filter(Boolean);
    let n = 0, total = 0;
    document.querySelectorAll("section.store").forEach((sec) => {
      let k = 0;
      // Counted as the page counts accounts: a reuse of a Target account isn't one of the owner's own.
      sec.querySelectorAll("tbody tr").forEach((tr) => {
        const on = words.every((w) => tr.dataset.q.includes(w)), mine = !tr.hasAttribute("data-reuse");
        tr.hidden = !on; k += on; if (mine) { total++; n += on; }
      });
      sec.hidden = !k;
    });
    document.getElementById("shown").textContent = words.length ? n + " of " + total + " shown" : "";
    document.getElementById("none-match").hidden = !words.length || !!n;
    try { sessionStorage.setItem(KEY, find.value); } catch (e) {}
    paint();
  };
  const put = async (text) => {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try { await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((s) => new Blob([s], { type: "text/plain" })) })]); return true; } catch (e) {}
    }
    const s = await text;
    try { await navigator.clipboard.writeText(s); return true; } catch (e) {}
    const ta = document.createElement("textarea");
    ta.value = s; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  };
  const copy = async (kind) => {
    const rows = ticked();
    if (!rows.length) return;
    say("Copying…");
    let info = null;
    const seen = new Set(), emails = rows.map((b) => b.dataset.email).filter((e) => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
    const text = kind === "emails" ? Promise.resolve(emails.join("\\r\\n"))
      : fetch(location.pathname, { method: "POST", body: new URLSearchParams([["t", T], ["action", "copy"], ...rows.map((b) => ["pick", b.value])]) })
        .then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((d) => { info = d; return d.lines.length ? d.lines.join("\\r\\n") : Promise.reject("none"); });
    let ok;
    try { ok = await put(text); }
    catch (code) {
      say(code === 410 ? "This link has expired. Ask again from FAFO." : code === "none" ? "Nothing copied: " + (rows.length === 1 ? "it isn't" : "those aren't") + " on your list any more."
        : "Couldn't get them from the server. Try again.");
      return;
    }
    if (!ok) { say("Your browser didn't allow copying."); return; }
    const n = info ? info.lines.length : emails.length, miss = info && info.missing, over = info && info.over;
    say("Copied " + n + (info ? (n === 1 ? " email:password" : " email:password lines") : (n === 1 ? " email" : " emails")) + "."
      + (miss ? " " + miss + (miss === 1 ? " isn't" : " aren't") + " on your list any more." : "")
      + (over ? " " + over + " more weren't copied: ${LIST_PICK_MAX} at most at once." : ""));
  };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.name === "pick") {
      if (e.shiftKey && last && last !== t && shown(last)) {
        const all = visible(), i = all.indexOf(last), j = all.indexOf(t);
        all.slice(Math.min(i, j), Math.max(i, j) + 1).forEach((b) => { b.checked = t.checked; });
        const sel = getSelection(); if (sel) sel.removeAllRanges();
      }
      last = t; say(""); paint();
    } else if (t.classList.contains("all")) {
      visible().filter((b) => t.closest("section").contains(b)).forEach((b) => { b.checked = t.checked; }); say(""); paint();
    } else if (t.hasAttribute("data-pickall")) {
      const v = visible(), on = !v.every((b) => b.checked); v.forEach((b) => { b.checked = on; }); say(""); paint();
    } else if (t.hasAttribute("data-clear")) {
      boxes().forEach((b) => { b.checked = false; }); say(""); paint();
    } else if (t.dataset.copy) copy(t.dataset.copy);
    else if (t.value === "move-inbox" && t.form === bar && !bar.elements.to_inbox.value) { e.preventDefault(); say("Pick the inbox to move them to first."); }
    else if (t.value === "aside" && t.form === bar && !bar.elements.aside_to.value) { e.preventDefault(); say("Pick where they go first."); }
  });
  // Enter on a tick box would send the bar's form, whose only submit button is Remove.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.name === "pick") e.preventDefault();
    if (e.key === "Escape" && e.target === find && find.value) { find.value = ""; filter(); }
  });
  find.addEventListener("input", filter);
  // A ?q= in the link sets the search once; it then leaves the address, so a reload keeps what's typed since.
  const qs = new URLSearchParams(location.search);
  let q0 = qs.get("q");
  if (q0 !== null) { qs.delete("q"); try { history.replaceState(null, "", location.pathname + "?" + qs); } catch (e) {} }
  else { try { q0 = sessionStorage.getItem(KEY); } catch (e) {} }
  if (q0) find.value = q0;
  filter();
  addEventListener("pageshow", filter);   // ticks and a search the browser puts back on Back come after the first paint
})();
</script>`;

// Reassign (2026-10-14, the owner's request: "a way for me to reassign a buyer's assigned account in case there's something
// wrong with the original account"): a buyer's account from the one list is swapped for another, a free one from the list
// (picked at random, or the one the owner names; `want`, its email_norm). The new one takes over what the old one had: the
// license, the profile, the batch it was first given in and when that was sent, and every slot's row of it (USE: its email
// and password, in the same batches, sent when they were), so pulls, declines, slots sent again and order alerts go by the
// new one. `assigned_at` becomes `stamp` (now) on all of them: order alerts drop orders from before the day before that, so
// an order placed on the new account for someone else doesn't reach this buyer. The old one comes off the list ("remove")
// or goes back on it as free ("free"). In one batch (a transaction), and only while the old one is still that buyer's for
// that profile, it and its slots' rows were sent, and no batch of theirs is being sent (`since`): a batch reads its
// accounts before it posts, so swapping meanwhile would post the old email. The new one has no row anywhere else (another
// store's list, or a slot's row at Target or Pokémon Center), so its slots' rows can take its email. Its email and email_norm,
// or null when nothing changed (the old one changed meanwhile, or no account could take its place). `skip` (a JSON list of
// email_norms) is never picked: the old accounts of the same reassign, so one put back free isn't given to the next buyer.
// `oldWay` "disabled" or "generate" sets the old one aside on that list (accounts_aside) as it comes off the list.
// Inboxes (2026-10-23): a buyer's slots never get one in an Only mine inbox; the owner's (`owner`) get those first. An old
// one taken off the list leaves its inbox; one put back free stays in it.
async function swapAccount(env, a, want, oldWay, stamp, since, skip = "[]", owner = false) {
  const binds = [a.email_norm, a.key_hash, a.profile ?? null, stamp];
  // The new one, once taken: given to the same buyer and profile at `stamp`.
  const taken = `EXISTS (SELECT 1 FROM accounts n WHERE n.store = '${MASTER}' AND n.key_hash = ?2 AND n.profile IS ?3 AND n.assigned_at = ?4 AND n.email_norm <> ?1)`;
  const [c] = await env.DB.batch([
    env.DB.prepare(`UPDATE accounts SET (key_hash, key_last4, batch, store_name, profile, sent_at) = (SELECT o.key_hash, o.key_last4, o.batch, o.store_name, o.profile, o.sent_at
        FROM accounts o WHERE o.store = '${MASTER}' AND o.email_norm = ?1), assigned_at = ?4
      WHERE rowid = (SELECT m.rowid FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL AND m.email_norm <> ?1 AND (?6 IS NULL OR m.email_norm = ?6)
          AND m.email_norm NOT IN (SELECT value FROM json_each(?7))
          AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.email_norm = m.email_norm AND x.store <> '${MASTER}')
          AND NOT EXISTS (SELECT 1 FROM accounts_aside s WHERE s.email_norm = m.email_norm)
          ${owner ? `ORDER BY ${IN_MINE("m.email_norm")} DESC, random()` : `AND NOT ${IN_MINE("m.email_norm")} ORDER BY random()`} LIMIT 1)
        AND EXISTS (SELECT 1 FROM accounts o WHERE o.store = '${MASTER}' AND o.email_norm = ?1 AND o.key_hash = ?2 AND o.profile IS ?3 AND o.sent_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM accounts u WHERE u.offer_id = '${USE}' AND u.email_norm = ?1 AND u.key_hash = ?2 AND u.sent_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.key_hash = ?2 AND s.webhook_message_id IS NULL AND s.created_at > ?5)
      RETURNING email, email_norm`).bind(...binds, since, want ?? null, skip),
    env.DB.prepare(`UPDATE accounts SET (email, email_norm, password) = (SELECT n.email, n.email_norm, n.password FROM accounts n WHERE n.store = '${MASTER}' AND n.key_hash = ?2
        AND n.profile IS ?3 AND n.assigned_at = ?4 AND n.email_norm <> ?1), assigned_at = ?4
      WHERE offer_id = '${USE}' AND email_norm = ?1 AND key_hash = ?2 AND ${taken}`).bind(...binds),
    // Set aside (Account disabled, Need to generate: 2026-10-23), with its password, its inbox and whose it was, before it goes.
    ...(isAside(oldWay) ? [env.DB.prepare(`INSERT INTO accounts_aside (email_norm, email, password, list, inbox_id, from_last4, from_profile, set_at)
        SELECT o.email_norm, o.email, o.password, ?5, (SELECT inbox_id FROM account_inbox_of WHERE email_norm = ?1), o.key_last4, o.profile, ?4
        FROM accounts o WHERE o.store = '${MASTER}' AND o.email_norm = ?1 AND o.key_hash = ?2 AND ${taken}
        ON CONFLICT (email_norm) DO UPDATE SET email = excluded.email, password = excluded.password, list = excluded.list, inbox_id = excluded.inbox_id,
          from_last4 = excluded.from_last4, from_profile = excluded.from_profile, set_at = excluded.set_at`).bind(...binds, oldWay)] : []),
    env.DB.prepare(oldWay === "free" ? `UPDATE accounts SET ${FREE_ACCOUNT} WHERE store = '${MASTER}' AND email_norm = ?1 AND key_hash = ?2 AND ${taken}`
      : `DELETE FROM accounts WHERE store = '${MASTER}' AND email_norm = ?1 AND key_hash = ?2 AND ${taken}`).bind(...binds),
    env.DB.prepare(`DELETE FROM account_inbox_of WHERE email_norm = ?1 AND NOT EXISTS (SELECT 1 FROM accounts WHERE store = '${MASTER}' AND email_norm = ?1)`).bind(a.email_norm),
  ]);
  return (c.results || [])[0] || null;
}

// Views (the list, an account to edit, Remove's and Reassign's questions) answer GET or POST; changes, Copy email:password,
// and Remove and Reassign for the ticked (ask-many and reassign, whose ticks come only in a POST) only POST. A change is made on
// the list as it is then, so an account given to a slot meanwhile is never changed as if it were still free.
async function accountListPage(request, env, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM account_lists WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", form = null;
  if (request.method === "POST") {
    form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.view_token))) return page(404, "Not found", "This link isn't valid.");
  const now = Date.now();
  const until = o.created_at + ACCOUNT_LIST_TTL_MS;
  if (now > until) return page(410, "Your list", "This link has expired. Ask again from FAFO: Settings → Accounts to assign → See my list.");
  const post = request.method === "POST";
  const get = (k) => String((form ? form.get(k) : url.searchParams.get(k)) ?? "");
  const action = get("action"), store = get("store").slice(0, 64), email = get("email").trim().toLowerCase().slice(0, 200);
  const when = (x) => new Date(x).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const keep = (k, v) => `<input type="hidden" name="${k}" value="${esc(v)}">`;
  const back = `<p><a class="back" href="${esc(url.pathname)}?t=${esc(encodeURIComponent(t))}">← Back to the list</a></p>`;
  const isReuse = (a) => String(a.offer_id || "").startsWith("reuse:");
  const reusedFrom = (a) => accountStoreName(String(a.offer_id).slice("reuse:".length));
  // An account's status as text (statusText, for the search) and as HTML (status). One from the one list says which of the
  // buyer's slots use it (`us`: their rows, USE): "Given to license …1234, Kim: Target, sent …; Pokémon Center, sent …".
  const sentText = (x) => x.sent_at ? `, sent ${when(x.sent_at)}` : ", in a batch being sent";
  const statusText = (a, us) => !a.key_hash ? "Free"
    : a.store === MASTER ? `Given to license …${a.key_last4 || ""}${a.profile ? `, ${a.profile}` : ""}${us && us.length ? `: ${us.map((u) => accountStoreName(u.store) + sentText(u)).join("; ")}` : sentText(a)}`
    : isReuse(a) ? `Reused from ${reusedFrom(a)} for license …${a.key_last4 || ""}${a.profile ? `, ${a.profile}` : ""}`
    : String(a.batch || "").startsWith(PARKED) ? `Held for license …${a.key_last4 || ""}${a.profile ? `, ${a.profile}` : ""}: its Pokémon Center slot still uses it`
    : `Given to license …${a.key_last4 || ""}${a.profile ? `, ${a.profile}` : ""}${sentText(a)}`;
  const status = (a, us) => esc(statusText(a, us));
  // In the list itself, an account from the one list that a buyer has gets a line for each of their slots that uses it.
  const statusCell = (a, us) => a.store === MASTER && a.key_hash && us && us.length
    ? esc(`Given to license …${a.key_last4 || ""}${a.profile ? `, ${a.profile}` : ""}:`) + us.map((u) => "<br>" + esc(accountStoreName(u.store) + sentText(u))).join("")
    : status(a, us);
  // The slots' own rows of an account from the one list, among rows read (usesIn), or read for it (usesOf), Target's first;
  // and the rows to show: those slots' rows only go with their account.
  const usesIn = (rows, a) => a.store === MASTER && a.key_hash ? rows.filter((u) => u.offer_id === USE && u.email_norm === a.email_norm && u.key_hash === a.key_hash)
    .sort((x, y) => (y.store > x.store) - (y.store < x.store)) : [];
  const usesOf = async (a) => a.store === MASTER && a.key_hash ? (await env.DB.prepare(`SELECT store, email_norm, key_hash, sent_at, offer_id FROM accounts WHERE offer_id = '${USE}'
    AND email_norm = ? AND key_hash = ? ORDER BY store DESC`).bind(a.email_norm, a.key_hash).all()).results : [];
  const vis = (rows) => { const v = rows.filter((a) => a.offer_id !== USE); return v.length ? v : rows; };
  const COLS = "store, email, email_norm, key_hash, key_last4, profile, batch, offer_id, sent_at";
  const one = (st, em) => env.DB.prepare(`SELECT ${COLS} FROM accounts WHERE store = ? AND email_norm = ?`).bind(st, em).first();
  // The one list's inboxes (2026-10-23), as they are when the request comes in, and the one an account is in (null: none).
  const inboxes = await listInboxes(env), inboxById = new Map(inboxes.map((b) => [b.id, b]));
  const inboxOf = async (e) => {
    if (!inboxes.length) return null;
    const r = await env.DB.prepare("SELECT inbox_id FROM account_inbox_of WHERE email_norm = ?").bind(e).first();
    return r && inboxById.get(r.inbox_id) || null;
  };
  // Whether a license is the owner's own FAFO (the one allowed to send order alerts), read once.
  let ownerKey;
  const isOwnerKey = async (h) => { ownerKey ??= ownerHash(env); return !!h && h === await ownerKey; };
  // The accounts ticked on the list, each "store email" (split at the last space: an email has none, a typed store's key
  // can have spaces or a |), from a POST only; at most LIST_PICK_MAX at once, and `over` counts any past that.
  const tickedAll = [...new Set((form ? form.getAll("pick") : []).map(String))]
    .map((p) => { const i = p.lastIndexOf(" "); return i > 0 ? { store: p.slice(0, i), email: p.slice(i + 1).trim().toLowerCase() } : null; }).filter(Boolean);
  const picks = () => tickedAll.slice(0, LIST_PICK_MAX), over = Math.max(0, tickedAll.length - LIST_PICK_MAX);
  const emailsSent = () => [...new Set((form ? form.getAll("email") : [email]).map((e) => String(e).trim().toLowerCase().slice(0, 200)).filter(Boolean))].slice(0, LIST_PICK_MAX);
  // Each email's row on the Account disabled or Need to generate list (accounts_aside), if it's there.
  const asideOf = async (emails) => {
    const out = new Map();
    for (let i = 0; i < emails.length; i += 500) for (const r of (await env.DB.prepare(`SELECT email, email_norm, password, list, inbox_id, from_last4, from_profile, set_at
      FROM accounts_aside WHERE email_norm IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(emails.slice(i, i + 500))).all()).results) out.set(r.email_norm, r);
    return out;
  };
  // Each email's rows on every store's list (a batch of reads at a time).
  const rowsOf = async (emails) => {
    const out = new Map();
    for (let i = 0; i < emails.length; i += 100) {
      const res = await env.DB.batch(emails.slice(i, i + 100).map((e) => env.DB.prepare(`SELECT ${COLS} FROM accounts WHERE email_norm = ? ORDER BY store`).bind(e)));
      res.forEach((r, k) => out.set(emails[i + k], r.results || []));
    }
    return out;
  };

  // Reassign: each email's account on the one list, its slots' rows, and why it can't be reassigned now ("" when it can):
  // not on the list, on a store's own list, free, or sent only in part (a batch of the buyer's is being sent).
  const since = now - BATCH_SENDING_MS, sendingKeys = new Map();
  const sending = async (keyHash) => {
    if (!sendingKeys.has(keyHash)) sendingKeys.set(keyHash, !!(await env.DB.prepare("SELECT 1 AS x FROM submissions WHERE key_hash = ? AND webhook_message_id IS NULL AND created_at > ? LIMIT 1")
      .bind(keyHash, since).first()));
    return sendingKeys.get(keyHash);
  };
  const reassignState = async (emails) => {
    const rows = await rowsOf(emails), out = [];
    for (const e of emails) {
      const rs = rows.get(e), a = rs.find((x) => x.store === MASTER) || null, us = a ? usesIn(rs, a) : [];
      const why = !a ? (rs.length ? "own" : "gone") : !a.key_hash ? "free" : !a.sent_at || us.some((u) => !u.sent_at) || await sending(a.key_hash) ? "sending" : "";
      out.push({ e, a, us, why, email: (a || rs[0] || { email: e }).email });
    }
    return out;
  };
  // Why some weren't reassigned, a sentence a reason: by its email when it's the only one, else by how many.
  const REASSIGN_WHY = {
    gone: ["isn't on your list any more", "aren't on your list any more"],
    own: ["is on a store's own list: Reassign is for your list (Target and Pokémon Center)", "are on a store's own list: Reassign is for your list (Target and Pokémon Center)"],
    free: ["is free, not given to a buyer", "are free, not given to a buyer"],
    aside: ["is set aside (Account disabled or Need to generate), not given to a buyer", "are set aside (Account disabled or Need to generate), not given to a buyer"],
    sending: ["is in a batch being sent: try again in a minute", "are in a batch being sent: try again in a minute"],
    changed: ["changed meanwhile (given back, removed or reassigned): look again", "changed meanwhile (given back, removed or reassigned): look again"],
    none: ["got no new account: your list has no free one left", "got no new account: your list has no free ones left"],
    // With the old ones put back free: those are free, but never go to another of the same reassign's buyers.
    noneOld: ["got no new account: the only free ones left are the old ones this put back", "got no new account: the only free ones left are the old ones this put back"],
    taken: ["got no new account: the one you typed was given to a slot meanwhile", "got no new accounts: the ones you typed were given to slots meanwhile"],
    // A buyer's, when the only free ones left are in Only mine inboxes (2026-10-23).
    noneMine: ["got no new account: the only free ones left are in your Only mine inboxes, which buyers never get", "got no new account: the only free ones left are in your Only mine inboxes, which buyers never get"],
    over: [`isn't included: ${LIST_REASSIGN_MAX} at most at once. Reassign it next`, `aren't included: ${LIST_REASSIGN_MAX} at most at once. Reassign them next`],
  };
  const whyText = (xs) => {
    const by = new Map();
    for (const x of xs) by.set(x.why, [...(by.get(x.why) || []), x]);
    return [...by].map(([w, l]) => xs.length === 1 && l[0].email ? `${l[0].email} ${REASSIGN_WHY[w][0]}.` : `${l.length} ${REASSIGN_WHY[w][l.length === 1 ? 0 : 1]}.`).join(" ");
  };
  // Free accounts a reassign can take: on the one list, and with no row anywhere else; for a buyer's (`buyers`), none in an
  // Only mine inbox.
  const freeForReassign = async (buyers) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.email_norm = m.email_norm AND x.store <> '${MASTER}')${buyers ? ` AND NOT ${IN_MINE("m.email_norm")}` : ""}`).first()).n;
  // The accounts typed to give instead, a line each: the email of one on the list, or email:password (as Add reads it).
  const reassignLines = (text) => {
    const list = [], bad = [];
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (LIST_EMAIL.test(line) && line.length <= 120) { list.push({ email: line }); return; }
      const { rows } = parseListLines(line, "");
      if (rows.length === 1) list.push(rows[0]); else bad.push(i + 1);
    });
    return { list, bad };
  };
  const whom = (x) => `license …${x.a.key_last4 || ""}${x.a.profile ? `, ${x.a.profile}` : ""}`;
  // A few emails by name, then how many more, so a message fits where it goes.
  const few = (es) => es.slice(0, 3).join(", ") + (es.length > 3 ? ` and ${es.length - 3} more` : "");
  const slotsOf = (x) => { const st = [...new Set(x.us.map((u) => accountStoreName(u.store)))]; return st.length ? `their ${st.join(" and ")} slot${x.us.length === 1 ? "" : "s"}` : "their slots"; };
  // The question: which account each one's slots get instead (a free one from the list, picked at random, or the ones typed),
  // and what happens to the old ones. `vals` keeps what was sent when it's asked again with an error.
  const reassignView = async (items, notes, err, vals = {}) => {
    const owners = await Promise.all(items.map((x) => isOwnerKey(x.a.key_hash))), buyers = owners.some((x) => !x);
    const n = items.length, one = n === 1, free = await freeForReassign(buyers), it = one ? "it" : "them";
    // With inboxes: where the free one comes from, and where a new one typed goes.
    // A buyer's typed one never goes in an Only mine inbox: in none, so buyers can get it.
    const buyerInMine = buyers && inboxes.some((b) => b.mine)
      && (await Promise.all(items.map(async (x, i) => !owners[i] && ((await inboxOf(x.e)) || {}).mine))).some(Boolean);
    const ibNote = !inboxes.length ? "" : `<p class="hint">${inboxes.some((b) => b.mine) ? [buyers ? "A buyer's slots never get one from an Only mine inbox." : "",
      owners.some(Boolean) ? "Your own FAFO's slots get one from an Only mine inbox first." : ""].filter(Boolean).join(" ") + " " : ""}A new one you type goes in the inbox of the one it replaces${buyerInMine
      ? ` (in none when that's an Only mine inbox and a buyer has ${one ? "it" : "the one it replaces"}, so buyers can get it)` : ""}.</p>`;
    const how = vals.how === "list" || vals.how === "these" ? vals.how : free >= n ? "list" : "these";
    const target = items.some((x) => x.us.some((u) => u.store === "target"));
    const line = (x) => `${one ? "" : `${esc(x.a.email)} · `}${status(x.a, x.us)}`;
    const box = one ? `<input type="text" name="accounts" value="${esc(vals.accounts || "")}" maxlength="400" autocomplete="off" spellcheck="false" placeholder="email, or email:password" aria-label="The account to give them">`
      : `<textarea name="accounts" rows="${Math.min(10, n + 1)}" spellcheck="false" autocomplete="off" placeholder="One per line: email, or email:password" aria-label="The accounts to give them">${esc(vals.accounts || "")}</textarea>`;
    return page(200, one ? "Reassign an account" : `Reassign ${n} accounts`, "", `${err ? `<p class="err">${esc(err)}</p>` : ""}
      <p class="who">${one ? esc(items[0].a.email) : `${n} accounts`}</p>
      <p class="small">${items.slice(0, 200).map(line).join("<br>")}${n > 200 ? `<br>and ${n - 200} more` : ""}</p>
      ${notes ? `<p class="small">${esc(notes)}</p>` : ""}
      <form method="post" class="edit" id="re">${hidden}${items.map((x) => keep("email", x.e)).join("")}
        <fieldset><legend>${one ? "Their slots get instead" : "Each one's slots get instead"}</legend>
          <label class="opt"><input type="radio" name="how" value="list"${how === "list" ? " checked" : ""}${free ? "" : " disabled"}><span>${one ? "A free account" : "Free accounts"} from my list, picked at random <span class="hint">${free ? `(${free} free)` : "(none free)"}</span></span></label>
          <label class="opt"><input type="radio" name="how" value="these"${how === "these" ? " checked" : ""}><span>${one ? "This account" : "These accounts, one for each, in the order above"}</span></label>
          ${box}
          <p class="hint">The email of a free account on your list, or email:password to put a new one on it${one ? "" : ", one per line"}.</p>${ibNote}
        </fieldset>
        <fieldset><legend>The old account${one ? "" : "s"}</legend>
          ${[["disabled", `Account disabled: put ${it} on my Account disabled list`], ["generate", `Need to generate: put ${it} on my Need to generate list`],
            ["free", `Put ${it} back on my list as free`], ["remove", `Take ${it} off my list for good`]].map(([v, l]) =>
            `<label class="opt"><input type="radio" name="old" value="${v}" required${vals.old === v ? " checked" : ""}><span>${l}</span></label>`).join("\n          ")}
          <p class="hint">Account disabled and Need to generate keep ${it} off your list, so no slot gets ${it}, with ${one ? "its" : "their"} password and inbox: ${one ? "its" : "their"} lists are at the end of your list, where Back on my list puts ${it} back, and so does adding ${one ? "its email" : "their emails"} again with a new password.</p>
        </fieldset>
        <p class="hint">What was posted to your channel stays as it was: change the email in ${one ? "their profile" : "those profiles"} in your bot${target ? ` (and ${one ? "the login" : "the logins"}, for Target)` : ""}. Order alerts follow the account: the buyer gets them for the new one, and no more for the old one.</p>
        <div class="row"><button class="ok" type="submit" name="action" value="do-reassign">Reassign${one ? "" : ` ${n}`}</button></div>
      </form>
      <script>(() => { const f = document.getElementById("re"), box = f.elements.accounts, these = f.querySelector('input[name="how"][value="these"]'); box.addEventListener("input", () => { if (box.value.trim()) these.checked = true; }); })();</script>${back}`, !one);
  };

  // One account: its email (while it's free) and password, and giving it back to the list once it's given.
  const editPage = async (a, err) => {
    const name = accountStoreName(a.store), us = await usesOf(a);
    // An account of the one list, once there are inboxes: the one it's in (null: none), which it can move to another.
    const ib = a.store === MASTER && inboxes.length ? await inboxOf(a.email_norm) : undefined;
    const head = `${err ? `<p class="err">${esc(err)}</p>` : ""}<p class="who">${esc(a.email)}</p><p class="small">${esc(name)}: ${status(a, us)}</p>`
      + (ib !== undefined ? `<p class="small">Inbox: ${ib ? `${esc(ib.name)} · ${inboxKind(ib.mine)}` : "No inbox · For buyers"}</p>` : "");
    if (a.offer_id === USE) return page(200, "Edit an account", "", `${head}
      <p class="small">It's an account from your list, on this buyer's ${esc(name)} slot, so it follows that one: change it on your list.</p>${back}`);
    if (isReuse(a)) return page(200, "Edit an account", "", `${head}
      <p class="small">It's your ${esc(reusedFrom(a))} account, used again for this buyer's ${esc(name)} slot, so it follows that one: change it on your ${esc(reusedFrom(a))} list.</p>${back}`);
    const given = !!a.key_hash;
    let giveBack = "";
    // One from the one list that a buyer has can be reassigned: their slots get another account in its place.
    const reassign = given && a.store === MASTER ? `<h3>Reassign it</h3>
      <p class="small">Something wrong with it? ${us.length === 1 ? "Their slot" : "Their slots"} can get another account in its place, from your list or one you add.</p>
      <form method="get" action="${esc(url.pathname)}">${hidden}${keep("email", a.email_norm)}<button class="ed" type="submit" name="action" value="reassign">Reassign…</button></form>` : "";
    if (given && a.store === MASTER) {
      // From the one list: every slot of the buyer's that uses it loses it.
      const where = us.map((u) => esc(accountStoreName(u.store))).join(" and ");
      giveBack = `<h3>Give it back</h3>
        <p class="small">It goes back on your list as free, so the next slot on Use Assigned Account can get it. License …${esc(a.key_last4 || "")} keeps what was posted to your channel, and stops getting order alerts for it.${us.length ? ` Their ${where} slot${us.length === 1 ? " loses" : "s lose"} it too.` : ""}</p>
        <form method="post">${hidden}${keep("store", a.store)}${keep("email", a.email_norm)}<button class="no" type="submit" name="action" value="giveback">Give it back to my list</button></form>`;
    } else if (given) {
      // The same buyer's rows with this email at other stores: a reuse of it (dropped with it), the owner's own account
      // there on a slot that checks out with this email too, or one held (parked) for this slot, which comes free with it.
      const { results: others } = await env.DB.prepare("SELECT store, offer_id, batch FROM accounts WHERE email_norm = ? AND key_hash = ? AND store <> ?")
        .bind(a.email_norm, a.key_hash, a.store).all();
      const names = (rs) => rs.map((r) => esc(accountStoreName(r.store))).join(" and ");
      const reuses = others.filter((r) => r.offer_id === "reuse:" + a.store), own = others.filter((r) => !isReuse(r));
      const using = own.filter((r) => !String(r.batch || "").startsWith(PARKED)), heldFor = own.filter((r) => String(r.batch || "").startsWith(PARKED));
      const notes = (reuses.length ? ` Their ${names(reuses)} slot that uses it again loses it too.` : "")
        + (using.length ? ` Their ${names(using)} slot checks out with this email too, so another buyer's ${esc(name)} slot could get it while they use it.` : "")
        + (heldFor.length ? ` Their ${names(heldFor)} account with this email, held for this slot, goes back on your ${names(heldFor)} list too.` : "");
      giveBack = `<h3>Give it back</h3>
        <p class="small">It goes back on your ${esc(name)} list as free, so the next slot on Use Assigned Account can get it. License …${esc(a.key_last4 || "")} keeps what was posted to your channel, and stops getting order alerts for it.${notes}</p>
        <form method="post">${hidden}${keep("store", a.store)}${keep("email", a.email_norm)}<button class="no" type="submit" name="action" value="giveback">Give it back to my list</button></form>`;
    }
    const inboxForm = ib === undefined ? "" : `<h3>Inbox</h3>
      <p class="small">${INBOX_KINDS_HINT}${given && !(await isOwnerKey(a.key_hash)) ? " Moving it doesn't take it from the buyer who has it." : ""}</p>
      <form method="post" class="edit">${hidden}${keep("email", a.email_norm)}<label>Move it to<select name="to_inbox">${inboxOptions(inboxes, ib ? ib.id : "none", "", true)}</select></label>
        <div class="row"><button class="ok" type="submit" name="action" value="move-inbox">Move it</button></div></form>`;
    // One that doesn't work (2026-10-23): a free one goes on a list of its own; a buyer's is reassigned, its old one going there.
    const asideForm = a.store !== MASTER ? "" : `<h3>Doesn't work?</h3>
      ${given ? `<p class="small">A buyer has it: Reassign it, and pick Account disabled or Need to generate for the old one there.</p>`
        : `<p class="small">Put it on a list of its own, off your list, so no slot gets it. Its password and inbox stay with it, for Back on my list.</p>
      <div class="row">${Object.entries(ASIDE).map(([k, l]) => `<form method="post">${hidden}${keep("email", a.email_norm)}${keep("aside_to", k)}<button class="no" type="submit" name="action" value="aside">${l}</button></form>`).join("")}</div>`}`;
    return page(200, "Edit an account", "", `${head}
      <form method="post" class="edit">${hidden}${keep("store", a.store)}${keep("email", a.email_norm)}
        <label>Email<input type="text" inputmode="email" name="new_email" value="${esc(a.email)}" maxlength="120" autocomplete="off" spellcheck="false" required${given ? " readonly" : ""}></label>
        ${given ? `<p class="hint">It's on a buyer's slot, so its email stays as it was posted. Give it back to your list first to change it.</p>` : ""}
        <label>New password<input type="text" name="password" maxlength="200" autocomplete="off" spellcheck="false" placeholder="Leave empty to keep it"></label>
        <p class="hint">${a.store === MASTER ? "The store account's password: Target's logins file gets it, and Pokémon Center checks out as a guest with the email." : a.store === "pokemoncenter" ? "The email's inbox password: Pokémon Center checks out as a guest with the email." : "The store account's password."} It's never shown here.${given ? " What was posted already doesn't change; a slot sent again gets the new one." : ""}</p>
        <div class="row"><button class="ok" type="submit" name="action" value="save">Save</button></div>
      </form>${inboxForm}${reassign}${giveBack}${asideForm}${back}`);
  };
  // One inbox (2026-10-23): rename it, switch who gets its accounts, or delete it once it has none. Switching is done here,
  // never straight from the list, after saying what it does: For buyers lets buyers' slots get its free accounts, Only mine
  // stops them (and says how many free ones buyers would have left).
  const inboxPage = async (b, err, vals = {}) => {
    const { results: held } = await env.DB.prepare(`SELECT a.key_hash FROM account_inbox_of i JOIN accounts a ON a.store = '${MASTER}' AND a.email_norm = i.email_norm
      WHERE i.inbox_id = ? AND a.key_hash IS NOT NULL`).bind(b.id).all();
    const given = held.length, withBuyers = (await Promise.all(held.map((r) => isOwnerKey(r.key_hash)))).filter((x) => !x).length;
    const { n: setAsideIn } = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts_aside WHERE inbox_id = ?").bind(b.id).first();
    // The free accounts buyers' slots can get from the rest of the list (other For buyers inboxes, and No inbox).
    const { n: buyersElse } = b.mine ? { n: 0 } : await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL AND ${OWN_ACCOUNT}
      AND NOT ${IN_MINE("m.email_norm")} AND NOT EXISTS (SELECT 1 FROM account_inbox_of i WHERE i.email_norm = m.email_norm AND i.inbox_id = ?)`).bind(b.id).first();
    return page(200, "An inbox", "", `${err ? `<p class="err">${esc(err)}</p>` : ""}<p class="who">${esc(b.name)}</p>
      <p class="small">${inboxKind(b.mine)} · ${plural(b.n, "account")}, ${b.free} free${given ? `, ${given} given to ${given === 1 ? "a slot" : "slots"}` : ""}</p>
      <form method="post" class="edit">${hidden}${keep("inbox", b.id)}
        <label>Name<input type="text" name="name" value="${esc(vals.name ?? b.name)}" maxlength="${INBOX_NAME_MAX}" autocomplete="off" spellcheck="false" required></label>
        <p class="hint">The email address its accounts' mail goes to, say. Only you see it.</p>
        <div class="row"><button class="ok" type="submit" name="action" value="inbox-rename">Rename</button></div></form>
      <h3>Who gets its accounts</h3>
      <p class="small">${b.mine ? "Only mine: only slots sent from your own FAFO, the one that sends order alerts, get them, before any For buyers one. Buyers' slots never do."
        : "For buyers: buyers' slots get them, and so do your own FAFO's once your Only mine inboxes have no free one left."}</p>
      <p class="small">${b.mine ? (b.free ? `Making it For buyers lets buyers' slots get its ${plural(b.free, "free account")}, starting with the next batch.`
          : "It has no free accounts now: making it For buyers lets buyers' slots get the ones that come free later.")
        : `${b.free ? `Making it Only mine stops buyers' slots getting its ${plural(b.free, "free account")}, starting with the next batch: they'd have ${plural(buyersElse, "free account")} left on your list.`
          : "It has no free accounts now: making it Only mine keeps the ones that come free later for your own FAFO's slots."}${withBuyers === 1 ? " The one given to a buyer stays with them until it's given back." : withBuyers ? ` The ${withBuyers} given to buyers stay with them until they're given back.` : ""}`}</p>
      <form method="post">${hidden}${keep("inbox", b.id)}${keep("mine", b.mine ? "0" : "1")}<div class="row"><button class="${b.mine ? "no" : "ok"}" type="submit" name="action" value="inbox-mine">${b.mine ? "Make it For buyers" : "Make it Only mine"}</button></div></form>
      <h3>Delete it</h3>
      ${b.n ? `<p class="small">Move its ${plural(b.n, "account")} to another inbox first: tick ${b.n === 1 ? "it" : "them"} on the list, then Move to inbox.</p>`
        : setAsideIn ? `<p class="small">${plural(setAsideIn, "account")} set aside (Account disabled or Need to generate) ${setAsideIn === 1 ? "was" : "were"} in it, and would come back in No inbox, for buyers: remove ${setAsideIn === 1 ? "it" : "them"}, or put ${setAsideIn === 1 ? "it" : "them"} back on your list and move ${setAsideIn === 1 ? "it" : "them"}, first.</p>`
        : `<p class="small">It has no accounts. Deleting it changes nothing else.</p><form method="post">${hidden}${keep("inbox", b.id)}<div class="row"><button class="no" type="submit" name="action" value="inbox-delete">Delete ${esc(b.name)}</button></div></form>`}${back}`);
  };

  let done = "", err = "", ticks = [];
  // Copy email:password for the ticked accounts (the page's script asks, and puts them on the clipboard): only here, by
  // POST with the link's token, never in the page itself.
  if (action === "copy" && post) {
    const ps = picks(), found = [];
    for (let i = 0; i < ps.length; i += 100) {
      const res = await env.DB.batch(ps.slice(i, i + 100).map((x) => x.store.startsWith(ASIDE_PICK)
        ? env.DB.prepare("SELECT email, password FROM accounts_aside WHERE list = ? AND email_norm = ?").bind(x.store.slice(ASIDE_PICK.length), x.email)
        : env.DB.prepare("SELECT email, password FROM accounts WHERE store = ? AND email_norm = ?").bind(x.store, x.email)));
      for (const r of res) found.push((r.results || [])[0] || null);
    }
    const lines = [...new Set(found.filter(Boolean).map((a) => `${a.email}:${a.password}`))];
    return new Response(JSON.stringify({ lines, missing: found.filter((a) => !a).length, over }),
      { headers: { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  // Remove for every account ticked: asks first, naming where each one is, as Remove on one account does.
  if (action === "ask-many") {
    const emails = [...new Set(picks().map((x) => x.email))];
    const rows = await rowsOf(emails), aside = await asideOf(emails), on = emails.filter((e) => rows.get(e).length || aside.has(e)), gone = emails.length - on.length;
    if (!on.length) err = emails.length ? "Those aren't on your list any more." : "Tick the accounts to remove first.";
    else {
      const given = on.some((e) => rows.get(e).some((a) => a.key_hash)), n = on.length;
      const line = (e) => { const rs = rows.get(e), v = vis(rs), x = aside.get(e);
        return `${esc((v[0] || x).email)} · ${[...v.map((a) => `${esc(accountStoreName(a.store))}: ${status(a, usesIn(rs, a))}`), ...(x ? [esc(`On ${asideList(x.list)}`)] : [])].join("; ")}`; };
      return page(200, "Remove accounts", "",
        `<p class="who">${n} account${n === 1 ? "" : "s"}</p>
         <p class="small">${on.slice(0, 200).map(line).join("<br>")}${n > 200 ? `<br>and ${n - 200} more` : ""}</p>
         ${gone ? `<p class="small">${gone} of the ones ticked ${gone === 1 ? "isn't" : "aren't"} on your list any more.</p>` : ""}
         ${over ? `<p class="small err">${over} more ticked ${over === 1 ? "isn't" : "aren't"} included: ${LIST_PICK_MAX} at most at once. Remove ${over === 1 ? "it" : "them"} next.</p>` : ""}
         <p class="small">Each comes off every store's list it's on, so no more slots get ${n === 1 ? "it" : "them"}.${given ? ` A buyer who has one stops getting order alerts for it.` : ""} Their passwords go too, and can't be got back here.</p>
         <div class="row"><form method="post">${hidden}${on.map((e) => keep("email", e)).join("")}<button class="no" type="submit" name="action" value="remove">Remove ${n} from my list</button></form>
         <form method="get" action="${esc(url.pathname)}"><input type="hidden" name="t" value="${esc(t)}"><button class="ok" type="submit">Keep ${n === 1 ? "it" : "them"}</button></form></div>`, true);
    }
  } else if (action === "remove" && post) {
    const emails = emailsSent(), rows = await rowsOf(emails), aside = await asideOf(emails), on = emails.filter((e) => rows.get(e).length || aside.has(e));
    for (let i = 0; i < on.length; i += 100) await env.DB.batch(on.slice(i, i + 100).flatMap((e) => [env.DB.prepare("DELETE FROM accounts WHERE email_norm = ?").bind(e),
      env.DB.prepare("DELETE FROM accounts_aside WHERE email_norm = ?").bind(e)]));
    if (on.length) {
      await sweepParked(env);
      await sweepInboxes(env);
      for (const st of new Set(on.flatMap((e) => rows.get(e).map((a) => a.store)))) await stockCheck(env, st, accountStoreName(st), false);
    }
    const gone = emails.length - on.length;
    if (!emails.length) err = "Tick the accounts to remove first.";
    else done = emails.length === 1 ? (on.length ? `Took ${(rows.get(on[0])[0] || aside.get(on[0])).email} off your list.` : `${emails[0]} isn't on your list any more.`)
      : on.length ? `Took ${on.length} account${on.length === 1 ? "" : "s"} off your list.${gone ? ` ${gone} ${gone === 1 ? "wasn't" : "weren't"} on it any more.` : ""}`
      : `Those ${emails.length} weren't on your list any more.`;
  } else if (email && action === "ask") {
    const { results: rows } = await env.DB.prepare(`SELECT ${COLS} FROM accounts WHERE email_norm = ? ORDER BY store`).bind(email).all();
    const x = (await asideOf([email])).get(email);
    if (!rows.length && !x) done = `${email} isn't on your list any more.`;
    else {
      const given = rows.some((a) => a.key_hash), v = vis(rows);
      return page(200, "Remove an account", "",
        `<p class="who">${esc((v[0] || x).email)}</p>
         <p class="small">${[...v.map((a) => `${esc(accountStoreName(a.store))}: ${status(a, usesIn(rows, a))}`), ...(x ? [esc(`On ${asideList(x.list)}`)] : [])].join("<br>")}</p>
         <p class="small">It comes off every store's list it's on, so no more slots get it.${given ? " A buyer who has it stops getting order alerts for it." : ""} Its password goes too, and can't be got back here.</p>
         <div class="row"><form method="post">${hidden}<input type="hidden" name="email" value="${esc(email)}"><button class="no" type="submit" name="action" value="remove">Remove from my list</button></form>
         <form method="get" action="${esc(url.pathname)}"><input type="hidden" name="t" value="${esc(t)}"><button class="ok" type="submit">Keep it</button></form></div>`);
    }
  } else if (action === "reassign" && (email || post)) {
    // Reassign's question: for one account (its Reassign button, or its Edit page), or for the ones ticked (the bar's, by
    // POST), those on the one list that a buyer has.
    const ps = email ? [{ store: MASTER, email }] : picks();
    const emails = [...new Set(ps.filter((p) => p.store === MASTER).map((p) => p.email))];
    // At most LIST_REASSIGN_MAX of those that can be; the ones that can't don't count toward it.
    const state = await reassignState(emails), ok = state.filter((x) => !x.why), items = ok.slice(0, LIST_REASSIGN_MAX), cut = ok.length - items.length;
    const others = [...new Set(ps.filter((p) => p.store !== MASTER).map((p) => p.email))].map((e) => ({ why: ps.some((p) => p.email === e && p.store.startsWith(ASIDE_PICK)) ? "aside" : "own", email: e }));
    const skipped = [...state.filter((x) => x.why), ...others, ...Array.from({ length: cut }, () => ({ why: "over" }))];
    if (items.length) return reassignView(items, whyText(skipped), "");
    if (email) return page(200, "Reassign an account", "", `<p class="err">${esc(whyText(skipped))}</p>${back}`);
    err = ps.length ? whyText(skipped) : "Tick the accounts to reassign first.";
  } else if (action === "do-reassign" && post) {
    const emails = emailsSent();
    const state = await reassignState(emails), ok = state.filter((x) => !x.why), items = ok.slice(0, LIST_REASSIGN_MAX), cut = ok.length - items.length;
    const skipped = [...state.filter((x) => x.why), ...Array.from({ length: cut }, () => ({ why: "over" }))];
    if (!items.length) err = emails.length ? whyText(skipped) : "Tick the accounts to reassign first.";
    else {
      const how = get("how"), oldWay = ["free", "remove", "disabled", "generate"].includes(get("old")) ? get("old") : "", text = get("accounts").slice(0, 100_000), one = items.length === 1;
      const again = (e) => reassignView(items, whyText(skipped), e, { how, old: oldWay, accounts: text });
      if (how !== "list" && how !== "these") return again("Pick which account they get.");
      if (!oldWay) return again(`Pick what happens to the old account${one ? "" : "s"}.`);
      if (how === "list" && text.trim()) return again(`You typed ${one ? "an account" : "accounts"}, but picked ${one ? "a free account" : "free accounts"} from your list: pick "${one ? "This account" : "These accounts"}" to use what you typed, or empty the box.`);
      let wants = null;
      const notes = [];
      if (how === "these") {
        const { list, bad } = reassignLines(text);
        if (bad.length) return again(`${lineList(bad)} couldn't be read: write the email of a free account on your list, or email:password for a new one.`);
        if (list.length !== items.length) return again(one ? `Type one account: the one to give them${list.length ? `, not ${list.length}` : ""}.` : `Type ${items.length} accounts, one for each: ${list.length ? `you typed ${list.length}` : "the box is empty"}.`);
        const norms = list.map((x) => x.email.toLowerCase());
        const dup = list.find((x, i) => norms.indexOf(norms[i]) !== i);
        if (dup) return again(`${dup.email} is in the box twice: each one gets an account of its own.`);
        const self = list.find((x, i) => items.some((y) => y.e === norms[i]));
        if (self) return again(`${self.email} is one of the accounts you're reassigning: type another.`);
        const rows = await rowsOf(norms);
        for (const [i, x] of list.entries()) {
          const rs = rows.get(norms[i]), g = rs.find((r) => r.key_hash), other = rs.find((r) => r.store !== MASTER && !MASTER_STORES.has(r.store));
          if (g) return again(`${x.email} is given to license …${g.key_last4 || ""}${g.profile ? `, ${g.profile}` : ""}: type a free one.`);
          if (other) return again(`${x.email} is on your ${accountStoreName(other.store)} list too: type another.`);
          if (!rs.some((r) => r.store === MASTER) && !x.password) {
            const sa = (await asideOf([norms[i]])).get(norms[i]);
            return again(sa ? `${x.email} is on ${asideList(sa.list)}: write it as email:password to put it back on your list with that password, or use Back on my list first.`
              : `${x.email} isn't on your list: write it as email:password to put it on.`);
          }
          // One in an Only mine inbox is for the owner's own FAFO's slots only (2026-10-23).
          const ib = rs.some((r) => r.store === MASTER) ? await inboxOf(norms[i]) : null;
          if (ib && ib.mine && !(await isOwnerKey(items[i].a.key_hash)))
            return again(`${x.email} is in ${ib.name}, an Only mine inbox: only your own FAFO's slots get those, and ${whom(items[i])} is a buyer's. Type another, or move it to a For buyers inbox first.`);
        }
        // New ones go on the list first; one there already keeps its password, as Add keeps it (said, so the bot gets the
        // right one). A free row with the email on Target's or Pokémon Center's own list from before goes, so its slots' rows
        // can take the email (addToList does that for the ones it adds).
        const typed = list.filter((x) => x.password);
        const { results: had } = typed.length ? await env.DB.prepare(`SELECT email, email_norm, password FROM accounts WHERE store = '${MASTER}' AND email_norm IN (SELECT value FROM json_each(?))`)
          .bind(JSON.stringify(typed.map((x) => x.email.toLowerCase()))).all() : { results: [] };
        const kept = had.filter((h) => typed.some((x) => x.email.toLowerCase() === h.email_norm && x.password !== h.password)).map((h) => h.email);
        if (kept.length) notes.push(`${few(kept)} ${kept.length === 1 ? "was" : "were"} on your list already, and kept ${kept.length === 1 ? "the password it had" : "the passwords they had"} (Edit changes ${kept.length === 1 ? "it" : "one"}).`);
        // A new one goes in the inbox of the one it replaces (2026-10-23), unless that's an Only mine inbox and a buyer gets it:
        // then in none, so it's one buyers can get. Put in it as it's added (addToList), never after.
        for (const [i, x] of list.entries()) {
          if (!x.password || rows.get(norms[i]).some((r) => r.store === MASTER)) continue;
          const ib = await inboxOf(items[i].e);
          x.inbox = null;
          if (!ib) continue;
          if (ib.mine && !(await isOwnerKey(items[i].a.key_hash))) { notes.push(`${x.email} went in no inbox: the one it replaces is in ${ib.name}, an Only mine inbox, and ${whom(items[i])} is a buyer's.`); continue; }
          x.inbox = ib.id;
          notes.push(`${x.email} went in ${ib.name}, the inbox of the one it replaces.`);
        }
        if (typed.length && (await addToList(env, MASTER, typed, "list:" + o.id, now)).gone) return again("An inbox changed meanwhile: look again, then try again.");
        await env.DB.batch(norms.map((e) => env.DB.prepare(`DELETE FROM accounts WHERE store IN ('target', 'pokemoncenter') AND email_norm = ?1 AND key_hash IS NULL AND ${OWN_ACCOUNT}
          AND EXISTS (SELECT 1 FROM accounts m WHERE m.store = '${MASTER}' AND m.email_norm = ?1)`).bind(e)));
        wants = norms;
      }
      // One at a time, each in a transaction of its own (swapAccount); one that didn't go is read again to say why. None of
      // them gets an old one of this reassign.
      const swapped = [], failed = [], olds = JSON.stringify(items.map((x) => x.e));
      // Once a random pick finds none, the rest of that kind get none either: a buyer's (never one in an Only mine inbox) or
      // the owner's (those first, then a buyer's kind; so none for the owner is none for buyers too).
      const none = { buyer: "", owner: "" };
      // Why one got none: the only free ones are this reassign's old ones put back, which it never gives (for a buyer's,
      // only one that buyers can get counts), or, for a buyer's, ones in Only mine inboxes; else there are none.
      const freeLeft = (oldOnes, mine) => env.DB.prepare(`SELECT 1 AS x FROM accounts m WHERE m.store = '${MASTER}' AND m.key_hash IS NULL
        AND ${oldOnes ? "" : "NOT "}EXISTS (SELECT 1 FROM json_each(?) j WHERE j.value = m.email_norm) AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.email_norm = m.email_norm AND x.store <> '${MASTER}')
        ${mine === undefined ? "" : `AND ${mine ? "" : "NOT "}${IN_MINE("m.email_norm")}`} LIMIT 1`).bind(olds).first().then((r) => !!r);
      const noneWhy = async (own) => oldWay === "free" && swapped.length && await freeLeft(true, own ? undefined : false) ? "noneOld"
        : !own && (await freeLeft(true, true) || await freeLeft(false, true)) ? "noneMine" : "none";
      const stayFree = [];
      for (const [i, x] of items.entries()) {
        const want = wants ? wants[i] : null, own = await isOwnerKey(x.a.key_hash), kind = own ? "owner" : "buyer";
        if (none[kind] && !want) { failed.push({ ...x, why: none[kind] }); continue; }
        const n = await swapAccount(env, x.a, want, oldWay, now + i, since, olds, own);
        if (n) { swapped.push({ ...x, n }); continue; }
        sendingKeys.delete(x.a.key_hash);
        const [s] = await reassignState([x.e]);
        let why = s.why || (s.a.key_hash !== x.a.key_hash || s.a.profile !== x.a.profile ? "changed" : want ? "taken" : await noneWhy(own));
        if (why === "none" || why === "noneOld" || why === "noneMine") { none[kind] = why; if (own && !none.buyer && why === "none") none.buyer = why; }
        failed.push({ ...x, why });
        if (want && why !== "taken") stayFree.push(want);
      }
      if (stayFree.length) notes.push(`${few(stayFree)} ${stayFree.length === 1 ? "stays" : "stay"} on your list, free.`);
      if (swapped.length || wants) await stockCheck(env, MASTER, accountStoreName(MASTER), swapped.length > 0);
      const target = swapped.some((x) => x.us.some((u) => u.store === "target"));
      const gone = (k) => oldWay === "free" ? `${k === 1 ? "is" : "are"} free on your list again` : isAside(oldWay) ? `went on ${asideList(oldWay)}` : "came off your list";
      if (swapped.length === 1) {
        const x = swapped[0];
        done = `Reassigned ${whom(x)}: ${slotsOf(x)} now use${x.us.length === 1 ? "s" : ""} ${x.n.email} in place of ${x.a.email}, which ${gone(1)}. Change the email in their profile in your bot${target ? " (and Target's login)" : ""}: the new account is ticked below, so Copy email:password copies it.`;
      } else if (swapped.length) {
        const pairs = [];
        let len = 0;
        for (const x of swapped) { const p = `${x.a.profile || "license …" + x.a.key_last4}: ${x.a.email} → ${x.n.email}`; if (len + p.length > 240) break; pairs.push(p); len += p.length + 2; }
        done = `Reassigned ${swapped.length} accounts (${pairs.join("; ")}${pairs.length < swapped.length ? `; and ${swapped.length - pairs.length} more` : ""}). The old ones ${gone(2)}. Change the emails in those profiles in your bot${target ? " (and Target's logins)" : ""}: the new accounts are ticked below, so Copy email:password copies them.`;
      }
      err = [whyText([...skipped, ...failed]), ...notes].filter(Boolean).join(" ");
      ticks = swapped.map((x) => MASTER + " " + x.n.email_norm);
      // A note in the channel, beside the batches that went out with the old emails (never a password).
      if (swapped.length) {
        // Whole lines while they fit in one message (Discord takes 2000 characters), then how many more.
        const k = swapped.length, head = `🔁 **Reassigned ${k} account${k === 1 ? "" : "s"}** on your list for Use Assigned Account`;
        const foot = `-# The old ${k === 1 ? "one" : "ones"} ${gone(k)}. Batches already posted have the old email: change it in your bot.`;
        const lines = [];
        let len = head.length + foot.length + 40;
        for (const x of swapped) { const l = `${md(whom(x))}: ${md(x.a.email)} → ${md(x.n.email)}`; if (len + l.length + 1 > 1900) break; lines.push(l); len += l.length + 1; }
        await webhookPost(env, { content: [head, ...lines, ...(k > lines.length ? [`and ${k - lines.length} more`] : []), foot].join("\n") }).catch((e) => console.error("webhook", e));
      }
    }
  } else if (action === "aside" && post) {
    // Accounts that don't work (2026-10-23): the bar's Not working… for the ticked, or one account's buttons (its email). Free
    // ones of the one list go on Account disabled or Need to generate, and ones there move between them; a buyer's stays
    // (Reassign is for those). Back on my list puts ones set aside on the list again, free, each in the inbox it was in, only
    // while each is still set aside as read (one removed meanwhile stays removed).
    const to = get("aside_to");
    let ps = picks();
    if (email) {
      const x = (await asideOf([email])).get(email);
      ps = [{ store: x ? ASIDE_PICK + x.list : MASTER, email }];
      // A button for one that's gone since the page was drawn: say so, rather than as if it were on the list.
      if (!x && to === "back") ps = [];
      if (!x && to === "back") err = `${email} isn't set aside any more.`;
    }
    const onList = [...new Set(ps.filter((p) => p.store === MASTER).map((p) => p.email))];
    const set = [...new Set(ps.filter((p) => p.store.startsWith(ASIDE_PICK)).map((p) => p.email))];
    const others = new Set(ps.filter((p) => p.store !== MASTER && !p.store.startsWith(ASIDE_PICK)).map((p) => p.email)).size;
    const many = (n, one, more) => n === 1 ? one : more.replace("N", n);
    const stayOthers = others ? `${others} on a store's own list stayed as ${others === 1 ? "it was" : "they were"}: these lists are for your list's accounts.` : "";
    if (err) { /* said above */ }
    else if (!isAside(to) && to !== "back") err = "Pick where they go.";
    else if (!onList.length && !set.length) err = others ? "Only accounts on your list (Target and Pokémon Center) go on those lists." : "Tick the accounts first.";
    else if (isAside(to)) {
      const { results: rows } = onList.length ? await env.DB.prepare(`SELECT email, email_norm, key_hash FROM accounts WHERE store = '${MASTER}' AND ${OWN_ACCOUNT}
        AND email_norm IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(onList)).all() : { results: [] };
      const given = rows.filter((r) => r.key_hash), free = rows.filter((r) => !r.key_hash);
      const moved = free.length ? await setAside(env, free.map((r) => r.email_norm), to, now) : 0;
      // Ones set aside already: those on the other list move to this one.
      const was = set.length ? [...(await asideOf(set)).values()] : [];
      const sw = was.filter((x) => x.list !== to), already = was.filter((x) => x.list === to);
      const switched = sw.length ? (await env.DB.prepare("UPDATE accounts_aside SET list = ?1 WHERE list <> ?1 AND email_norm IN (SELECT value FROM json_each(?2))")
        .bind(to, JSON.stringify(sw.map((x) => x.email_norm))).run()).meta.changes || 0 : 0;
      if (moved) await stockCheck(env, MASTER, accountStoreName(MASTER), false);
      done = [moved ? `Put ${many(moved, free.length === 1 ? free[0].email : "1 account", "N accounts")} on ${asideList(to)}: no slot gets ${moved === 1 ? "it" : "them"}.` : "",
        switched ? `Moved ${many(switched, sw.length === 1 ? sw[0].email : "1 account", "N accounts")} to ${asideList(to)}.` : "",
        already.length ? `${many(already.length, `${already[0].email} was`, "N were")} on ${asideList(to)} already.` : ""].filter(Boolean).join(" ");
      err = [given.length ? `${many(given.length, `${given[0].email} is`, "N are")} with a buyer: Reassign ${given.length === 1 ? "it" : "them"}, and pick ${ASIDE[to]} for the old ${given.length === 1 ? "one" : "ones"} there.` : "",
        free.length - moved ? `${free.length - moved} changed meanwhile and stayed on your list: look again.` : "",
        onList.length - rows.length ? `${onList.length - rows.length} ${onList.length - rows.length === 1 ? "isn't" : "aren't"} on your list any more.` : "",
        set.length - was.length ? `${set.length - was.length} ${set.length - was.length === 1 ? "isn't" : "aren't"} set aside any more.` : "",
        stayOthers].filter(Boolean).join(" ");
    } else {
      const xs = [...(await asideOf(set)).values()];
      const noInbox = xs.filter((x) => x.inbox_id && !inboxById.has(x.inbox_id)).length;
      const { added, back: n, gone } = xs.length ? await addToList(env, MASTER, xs.map((x) => ({ email: x.email, password: x.password, asideAt: x.set_at,
        inbox: inboxById.has(x.inbox_id) ? x.inbox_id : null })), "list:" + o.id, now) : { added: 0, back: 0, gone: false };
      if (added) await stockCheck(env, MASTER, accountStoreName(MASTER), false);
      done = n ? `Put ${many(n, xs.length === 1 ? xs[0].email : "1 account", "N accounts")} back on your list, free${inboxes.length ? `, in the inbox ${n === 1 ? "it was" : "each was"} in` : ""}.` : "";
      err = [gone ? "An inbox changed meanwhile, so some stayed set aside: look again." : set.length - n ? `${set.length - n} ${set.length - n === 1 ? "isn't" : "aren't"} set aside any more.` : "",
        noInbox && n ? `${noInbox} went in No inbox (For buyers): the inbox ${noInbox === 1 ? "it was" : "they were"} in is gone. Move to inbox moves ${noInbox === 1 ? "it" : "them"}.` : "",
        onList.length ? `${onList.length} ${onList.length === 1 ? "was" : "were"} on your list already.` : "", stayOthers].filter(Boolean).join(" ");
      // Ticked for Copy email:password, while they're few enough for the address (the list's link carries them).
      ticks = n && n <= LIST_REASSIGN_MAX ? xs.map((x) => MASTER + " " + x.email_norm) : [];
    }
  } else if (action === "move-inbox" && post) {
    // Move to inbox (the bar, for the ticked) or an account's Edit page (its email): accounts of the one list go in another
    // inbox, or in none. Who has one doesn't change.
    const to = get("to_inbox"), dest = to === "none" ? null : inboxById.get(to) || undefined;
    const ps = email ? [{ store: MASTER, email }] : picks();
    const norms = [...new Set(ps.filter((p) => p.store === MASTER).map((p) => p.email))];
    const asideN = new Set(ps.filter((p) => p.store.startsWith(ASIDE_PICK)).map((p) => p.email)).size;
    const others = new Set(ps.filter((p) => p.store !== MASTER && !p.store.startsWith(ASIDE_PICK)).map((p) => p.email)).size;
    if (!inboxes.length) err = "Make an inbox first.";
    else if (!norms.length && asideN) err = "Those are set aside (Account disabled or Need to generate): Back on my list puts each in the inbox it was in, then Move to inbox moves it.";
    else if (!to) err = "Pick the inbox to move them to.";
    else if (dest === undefined) err = "That inbox isn't there any more: pick another.";
    else if (!norms.length) err = others ? "Inboxes are for your list (Target and Pokémon Center): those are on a store's own list." : "Tick the accounts to move first.";
    else {
      const on = [];
      for (let i = 0; i < norms.length; i += 500) on.push(...(await env.DB.prepare(`SELECT a.email, a.email_norm, a.key_hash, i.inbox_id FROM accounts a
        LEFT JOIN account_inbox_of i ON i.email_norm = a.email_norm WHERE a.store = '${MASTER}' AND a.email_norm IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(norms.slice(i, i + 500))).all()).results);
      const at = (r) => inboxById.has(r.inbox_id) ? r.inbox_id : null, there = dest ? dest.id : null;
      const stay = on.filter((r) => at(r) === there), go = on.filter((r) => at(r) !== there), gone = norms.length - on.length;
      if (go.length) { await moveToInbox(env, there, go.map((r) => r.email_norm), now); await stockCheck(env, MASTER, accountStoreName(MASTER), false); }
      const given = go.filter((r) => r.key_hash);
      const withBuyers = dest && dest.mine ? (await Promise.all(given.map((r) => isOwnerKey(r.key_hash)))).filter((x) => !x).length : 0;
      const where = dest ? `${dest.name} (${inboxKind(dest.mine)})` : "No inbox (For buyers)";
      done = [go.length ? (go.length === 1 && on.length === 1 ? `Moved ${go[0].email} to ${where}.` : `Moved ${plural(go.length, "account")} to ${where}.`) : "",
        stay.length ? (on.length === 1 ? `${stay[0].email} is in ${dest ? dest.name : "No inbox"} already.` : `${stay.length} ${stay.length === 1 ? "was" : "were"} in it already.`) : "",
        given.length > withBuyers ? (go.length === 1 ? "It's given to a slot, which keeps it: moving it changes only which slots get it next."
          : `${given.length - withBuyers === 1 ? "1 of them is given to a slot, which keeps it" : `${given.length - withBuyers} of them are given to slots, which keep them`}: moving changes only which slots get them next.`) : "",
        withBuyers ? (go.length === 1 ? "It's with a buyer, who keeps it until it's given back; after that only your own FAFO's slots get it."
          : `${withBuyers === 1 ? "One is with a buyer, who keeps it until it's given back" : `${withBuyers} are with buyers, who keep them until they're given back`}; after that only your own FAFO's slots get ${withBuyers === 1 ? "it" : "them"}.`) : "",
      ].filter(Boolean).join(" ");
      err = [gone ? `${gone} ${gone === 1 ? "isn't" : "aren't"} on your list any more.` : "",
        others ? `${others} on a store's own list stayed as ${others === 1 ? "it was" : "they were"}: inboxes are for your list.` : "",
        asideN ? `${asideN} set aside stayed as ${asideN === 1 ? "it was" : "they were"}: Back on my list first.` : "",
        over ? `${over} more ticked ${over === 1 ? "wasn't" : "weren't"} moved: ${LIST_PICK_MAX} at most at once.` : ""].filter(Boolean).join(" ");
    }
  } else if (action === "inbox-new" && post) {
    // A new inbox, and (ticked) every account of the one list that's in none goes in it.
    const name = inboxNameOf(get("name")), mine = get("kind") === "mine" ? 1 : 0, adopt = get("adopt") === "1";
    if (!name) err = "Name the inbox: the email address its accounts' mail goes to, say.";
    else if (name.length > INBOX_NAME_MAX) err = `That name is too long: ${INBOX_NAME_MAX} characters at most.`;
    else if (inboxes.length >= INBOX_MAX) err = `You have ${INBOX_MAX} inboxes: delete one you don't use first.`;
    else {
      const nid = randomId(9);
      const r = await env.DB.prepare("INSERT OR IGNORE INTO account_inboxes (id, name, name_norm, mine, created_at) VALUES (?, ?, ?, ?, ?)").bind(nid, name, inboxNorm(name), mine, now).run();
      if (!r.meta || !r.meta.changes) err = `You have an inbox named ${name} already.`;
      else {
        let n = 0;
        let k = 0;
        if (adopt) {
          const a = await env.DB.prepare(`INSERT INTO account_inbox_of (email_norm, inbox_id, set_at) SELECT a.email_norm, ?1, ?2 FROM accounts a WHERE a.store = '${MASTER}'
            AND NOT EXISTS (SELECT 1 FROM account_inbox_of i JOIN account_inboxes b ON b.id = i.inbox_id WHERE i.email_norm = a.email_norm)
            ON CONFLICT (email_norm) DO UPDATE SET inbox_id = excluded.inbox_id, set_at = excluded.set_at`).bind(nid, now).run();
          n = a.meta && a.meta.changes || 0;
          // Those buyers have stay theirs until given back.
          const { results: held } = n && mine ? await env.DB.prepare(`SELECT a.key_hash FROM account_inbox_of i JOIN accounts a ON a.store = '${MASTER}' AND a.email_norm = i.email_norm
            WHERE i.inbox_id = ? AND a.key_hash IS NOT NULL`).bind(nid).all() : { results: [] };
          k = (await Promise.all(held.map((r) => isOwnerKey(r.key_hash)))).filter((x) => !x).length;
        }
        if (n && mine) await stockCheck(env, MASTER, accountStoreName(MASTER), false);
        done = `Made ${name}, ${mine ? "an Only mine inbox: only your own FAFO's slots get its accounts" : "an inbox For buyers"}.${n ? ` Put the ${plural(n, "account")} that had no inbox in it.` : ""}`
          + (k === 1 ? " One is with a buyer, who keeps it until it's given back." : k ? ` ${k} are with buyers, who keep them until they're given back.` : "");
      }
    }
  } else if (action === "inbox" || (["inbox-rename", "inbox-mine", "inbox-delete"].includes(action) && post)) {
    const b = inboxById.get(get("inbox"));
    if (!b) err = "That inbox isn't there any more.";
    else if (action === "inbox") return inboxPage(b, "");
    else if (action === "inbox-rename") {
      const name = inboxNameOf(get("name"));
      if (!name) return inboxPage(b, "Type its new name.", { name: "" });
      if (name.length > INBOX_NAME_MAX) return inboxPage(b, `That name is too long: ${INBOX_NAME_MAX} characters at most.`, { name });
      if (name === b.name) done = "Nothing changed.";
      else {
        const r = await env.DB.prepare("UPDATE account_inboxes SET name = ?1, name_norm = ?2 WHERE id = ?3 AND NOT EXISTS (SELECT 1 FROM account_inboxes x WHERE x.name_norm = ?2 AND x.id <> ?3)")
          .bind(name, inboxNorm(name), b.id).run().catch(() => null);
        if (!r || !r.meta || !r.meta.changes) return inboxPage(b, `You have an inbox named ${name} already.`, { name });
        done = `Renamed ${b.name} to ${name}.`;
      }
    } else if (action === "inbox-mine") {
      const mine = get("mine") === "1" ? 1 : 0;
      if (mine === b.mine) done = `${b.name} is ${inboxKind(mine)} already.`;
      else {
        await env.DB.prepare("UPDATE account_inboxes SET mine = ? WHERE id = ?").bind(mine, b.id).run();
        await stockCheck(env, MASTER, accountStoreName(MASTER), false);
        // Its accounts that buyers have stay theirs until given back.
        const { results: held } = mine ? await env.DB.prepare(`SELECT a.key_hash FROM account_inbox_of i JOIN accounts a ON a.store = '${MASTER}' AND a.email_norm = i.email_norm
          WHERE i.inbox_id = ? AND a.key_hash IS NOT NULL`).bind(b.id).all() : { results: [] };
        const k = (await Promise.all(held.map((r) => isOwnerKey(r.key_hash)))).filter((x) => !x).length;
        done = mine ? `${b.name} is Only mine now: only your own FAFO's slots get its accounts.${k === 1 ? " One is with a buyer, who keeps it until it's given back." : k ? ` ${k} are with buyers, who keep them until they're given back.` : ""}`
          : `${b.name} is For buyers now: buyers' slots get its free accounts.`;
      }
    } else {
      // Only while none of the list's accounts is in it (checked as it's deleted); rows left by accounts that are gone go too.
      const r = await env.DB.prepare(`DELETE FROM account_inboxes WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM account_inbox_of i JOIN accounts a ON a.store = '${MASTER}'
        AND a.email_norm = i.email_norm WHERE i.inbox_id = ?1) AND NOT EXISTS (SELECT 1 FROM accounts_aside WHERE inbox_id = ?1)`).bind(b.id).run();
      if (r.meta && r.meta.changes) { await sweepInboxes(env); done = `Deleted ${b.name}.`; }
      else {
        const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM account_inbox_of i JOIN accounts a ON a.store = '${MASTER}' AND a.email_norm = i.email_norm WHERE i.inbox_id = ?`).bind(b.id).first();
        const { n: k } = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts_aside WHERE inbox_id = ?").bind(b.id).first();
        err = n ? `${b.name} has ${plural(n, "account")}: move ${n === 1 ? "it" : "them"} to another inbox first (tick ${n === 1 ? "it" : "them"}, then Move to inbox).`
          : `${plural(k, "account")} set aside (Account disabled or Need to generate) ${k === 1 ? "was" : "were"} in ${b.name}, and would come back in No inbox, for buyers: remove ${k === 1 ? "it" : "them"}, or put ${k === 1 ? "it" : "them"} back on your list and move ${k === 1 ? "it" : "them"}, first.`;
      }
    }
  } else if (email && store && (action === "edit" || ((action === "save" || action === "giveback") && post))) {
    const a = await one(store, email), on = listName(store);
    if (!a) done = `${email} isn't on ${on} any more.`;
    else if (action === "edit" || isReuse(a)) return editPage(a, action === "edit" ? "" : a.offer_id === USE ? "It's an account from your list: change it there." : `It follows your ${reusedFrom(a)} account: change that one.`);
    else if (action === "giveback") {
      if (!a.key_hash) done = `${a.email} is already free on ${on}.`;
      else {
        const held = `SELECT store FROM accounts WHERE email_norm = ? AND store <> ? AND batch LIKE '${PARKED}%' AND key_hash = ?`;
        const { results: before } = await env.DB.prepare(held).bind(a.email_norm, a.store, a.key_hash).all();
        await freeAccounts(env, "store = ? AND email_norm = ?", a.store, a.email_norm);
        // Every store, as /admin/accounts/free does: freeing it can also free a Target account parked for it (sweepParked).
        const { results: stores } = await env.DB.prepare("SELECT DISTINCT store FROM accounts").all();
        for (const x of stores) await stockCheck(env, x.store, accountStoreName(x.store), false);
        const { results: still } = await env.DB.prepare(held).bind(a.email_norm, a.store, a.key_hash).all();
        const freed = before.filter((r) => !still.some((x) => x.store === r.store)).map((r) => accountStoreName(r.store));
        done = `Gave ${a.email} back to ${on}. It's free for the next slot.${freed.length ? ` Your ${freed.join(" and ")} account with this email came free too.` : ""}`;
      }
    } else {
      const newEmail = get("new_email").trim(), pw = get("password").trim();
      // Checked only when it changes: one on the list from before may not pass today's check, and still takes a password.
      if (newEmail !== a.email && (!LIST_EMAIL.test(newEmail) || newEmail.length > 120)) return editPage(a, "That isn't an email address.");
      if (pw.length > 200) return editPage(a, "That password is too long: 200 characters at most.");
      if (/[\r\n]/.test(pw)) return editPage(a, "That password can't have a line break.");
      const norm = newEmail.toLowerCase();
      if (newEmail !== a.email) {
        if (a.key_hash) return editPage(a, "It's on a buyer's slot, so its email can't change. Give it back to your list first.");
        if (norm !== a.email_norm && await one(a.store, norm)) return editPage(a, `${newEmail} is already on ${on}.`);
        // One set aside (Account disabled, Need to generate) comes back by Back on my list, or Add with its password: never
        // as another account's new email, which would put it on the list while it's still set aside.
        const sa = norm !== a.email_norm ? (await asideOf([norm])).get(norm) : null;
        if (sa) return editPage(a, `${newEmail} is on ${asideList(sa.list)}: use Back on my list there, or Add it with its password.`);
        // Only while it's still free: one given to a slot meanwhile keeps the email that slot got. On the one list, in one batch
        // (a transaction) with it: a free row with that email left on Target's or Pokémon Center's own list from before goes
        // (addToList), and its inbox goes with it (2026-10-23), so it's never in no inbox for a moment, open to buyers. The
        // inbox rows change only once the email has (it's on the list under the new one, and not under the old one).
        const master = a.store === MASTER && norm !== a.email_norm, onNew = `EXISTS (SELECT 1 FROM accounts WHERE store = '${MASTER}' AND email_norm = ?1)`;
        const res = await env.DB.batch([
          ...(master ? [env.DB.prepare(`DELETE FROM account_inbox_of WHERE email_norm = ?1 AND NOT ${onNew}`).bind(norm)] : []),
          env.DB.prepare(`UPDATE accounts SET email = ?, email_norm = ?${pw ? ", password = ?" : ""} WHERE store = ? AND email_norm = ? AND key_hash IS NULL AND ${OWN_ACCOUNT}
            AND NOT EXISTS (SELECT 1 FROM accounts_aside s WHERE s.email_norm = ? AND s.email_norm <> ?)`)
            .bind(newEmail, norm, ...(pw ? [pw] : []), a.store, a.email_norm, norm, a.email_norm),
          ...(a.store === MASTER ? [env.DB.prepare(`DELETE FROM accounts WHERE store IN ('target', 'pokemoncenter') AND email_norm = ?1 AND key_hash IS NULL AND ${OWN_ACCOUNT}
            AND ${onNew}`).bind(norm)] : []),
          ...(master ? [env.DB.prepare(`UPDATE account_inbox_of SET email_norm = ?1 WHERE email_norm = ?2 AND ${onNew}
            AND NOT EXISTS (SELECT 1 FROM accounts WHERE store = '${MASTER}' AND email_norm = ?2)`).bind(norm, a.email_norm)] : []),
        ]).catch(() => null);
        const r = res && res[master ? 1 : 0];
        if (!r || !r.meta || !r.meta.changes) return editPage((await one(a.store, a.email_norm)) || a, "It changed meanwhile (given to a slot, or edited). Look again, then try again.");
        done = `Changed ${a.email} to ${newEmail}${pw ? ", with its new password," : ""} on ${on}.`;
      } else if (pw) {
        // A reuse of it at another store (same buyer), or a slot's row of it from the one list, checks out with it too, so it
        // gets the new password with it.
        await env.DB.batch([
          env.DB.prepare(`UPDATE accounts SET password = ? WHERE store = ? AND email_norm = ? AND ${OWN_ACCOUNT}`).bind(pw, a.store, a.email_norm),
          env.DB.prepare("UPDATE accounts SET password = ? WHERE email_norm = ? AND offer_id = ? AND key_hash IS ?").bind(pw, a.email_norm, "reuse:" + a.store, a.key_hash),
        ]);
        done = `Changed the password of ${a.email} on ${on}.`;
      } else done = "Nothing changed.";
    }
  }

  // Where Add puts accounts: the one list (Target and Pokémon Center: what FAFO's store pickers offer), or a store's own list
  // that's on the page already. No store picked (no other list to pick from) means the one list.
  const { results: listed } = await env.DB.prepare("SELECT DISTINCT store FROM accounts").all();
  const ownLists = listed.map((r) => r.store).filter((x) => x !== MASTER && !MASTER_STORES.has(x));
  const addStores = [MASTER, ...ownLists], addTo = (x) => x === "" ? MASTER : addStores.includes(listStoreOf(x)) ? listStoreOf(x) : "";
  // With inboxes (2026-10-23), accounts added to the one list go in the inbox picked, which has to be picked; the page comes
  // back with what was typed when it isn't (keepAdd).
  let keepAdd = null;
  if (action === "add" && post) {
    const st = addTo(store), name = accountStoreName(st);
    const text = get("accounts");
    const { rows, bad, bare } = text.length > 400_000 ? { rows: [], bad: [], bare: [] } : parseListLines(text, get("password").trim());
    const ib = st === MASTER && inboxes.length ? inboxById.get(get("inbox")) : null;
    if (!st) err = "Pick a store to add them to.";
    else if (text.length > 400_000 || rows.length > ACCOUNT_OFFER_MAX) err = `That's too many at once: ${ACCOUNT_OFFER_MAX} at most.`;
    else if (st === MASTER && inboxes.length && !ib && rows.length) {
      err = get("inbox") ? "That inbox isn't there any more: choose another." : "Choose the inbox they go in.";
      keepAdd = { accounts: text, password: get("password") };
    } else {
      const { added: n, kept, gone, back } = await addToList(env, st, rows, "list:" + o.id, now, ib ? ib.id : null);
      if (gone) { err = "That inbox isn't there any more: choose another."; keepAdd = { accounts: text, password: get("password") }; }
      else {
        if (n || ib) await stockCheck(env, st, name, false);
        const already = rows.length - n;
        done = rows.length ? `Added ${n} to ${listName(st)}${ib ? `, in ${ib.name}` : ""}.${already ? ` ${already} ${already === 1 ? "was" : "were"} already on it, and kept ${already === 1 ? "its" : "their"} password (Edit changes one).` : ""}`
          + (kept ? ` ${kept} already in another inbox stayed there (Move to inbox moves ${kept === 1 ? "it" : "them"}).` : "")
          + (back ? ` ${back === 1 ? "1 was" : `${back} were`} set aside (Account disabled or Need to generate), and ${back === 1 ? "is" : "are"} back on your list with the password typed.` : "") : "";
        err = [bad.length ? `${lineList(bad)} couldn't be read: write each account as email:password.` : "",
          bare.length ? `${lineList(bare)} ${bare.length === 1 ? "has" : "have"} only an email: add ${bare.length === 1 ? "it" : "them"} again with the password box filled in.` : "",
          !rows.length && !bad.length && !bare.length ? "Paste the accounts to add, one per line." : ""].filter(Boolean).join(" ");
      }
    }
  }
  // After a change, back to the list by its link (303), with what happened, so reloading the page doesn't send it again.
  if (post && !keepAdd && (["remove", "giveback", "save", "add", "do-reassign", "move-inbox", "aside", "inbox-new", "inbox-rename", "inbox-mine", "inbox-delete"].includes(action)
    || (["ask-many", "reassign", "inbox"].includes(action) && err))) {
    const q = new URLSearchParams({ t });
    if (done) q.set("done", done);
    if (err) q.set("err", err);
    // Accounts a reassign gave out come ticked, for Copy email:password.
    for (const k of ticks) q.append("tick", k);
    if (action === "add" && addTo(store) && addTo(store) !== MASTER) q.set("store", addTo(store));
    return new Response(null, { status: 303, headers: { location: `${url.pathname}?${q}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  if (!action) { done = get("done").slice(0, 600); err = get("err").slice(0, 600); }
  // The one list first (its store, "*", sorts first); its accounts' slots' rows (USE) show in their accounts' status.
  const { results: rowsAll } = await env.DB.prepare(`SELECT ${COLS} FROM accounts ORDER BY store, key_hash IS NOT NULL, email_norm`).all();
  const all = rowsAll.filter((a) => a.offer_id !== USE), usesBy = new Map();
  for (const u of rowsAll) if (u.offer_id === USE) { const k = u.email_norm + "|" + u.key_hash; if (!usesBy.has(k)) usesBy.set(k, []); usesBy.get(k).push(u); }
  const usOf = (a) => usesIn(usesBy.get(a.email_norm + "|" + a.key_hash) || [], a);
  const byStore = new Map();
  for (const a of all) { if (!byStore.has(a.store)) byStore.set(a.store, []); byStore.get(a.store).push(a); }
  const tickNow = new Set(action ? [] : url.searchParams.getAll("tick"));
  const own = (a) => !isReuse(a);
  // With inboxes (2026-10-23), the one list's accounts show in a section per inbox (in the order they were made), then No
  // inbox; each section's box ticks its own rows. Which inbox each account is in, by email_norm.
  const inboxAt = new Map(inboxes.length ? (await env.DB.prepare("SELECT i.email_norm, i.inbox_id FROM account_inbox_of i JOIN account_inboxes b ON b.id = i.inbox_id").all())
    .results.map((r) => [r.email_norm, r.inbox_id]) : []);
  // `ib`: undefined for a store's section, else the inbox (null: No inbox) of a section of the one list.
  const section = (st, rows, ib) => {
    const mine = rows.filter(own), free = mine.filter((a) => !a.key_hash).length, byInbox = ib !== undefined;
    const label = byInbox ? (ib ? ib.name : "No inbox") : accountStoreName(st), kind = byInbox ? inboxKind(ib && ib.mine) : "";
    // Each row carries what the search box looks in: its email, its store (and inbox) and its status, in lowercase without
    // accents.
    return `<section class="store" data-store="${esc(st)}"${byInbox ? ` data-inbox="${esc(ib ? ib.id : "none")}"` : ""}><h3><input type="checkbox" class="all js" hidden data-store="${esc(st)}" aria-label="Tick every ${byInbox ? `account in ${esc(label)}` : `${esc(label)} account`}"> ${esc(label)}${byInbox ? ` <span class="tag${ib && ib.mine ? " mine" : ""}">${kind}</span>` : ""} <span class="count">${free} free of ${mine.length}</span></h3>
      <table><thead><tr><th class="pick"></th><th>Account</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((a) => `<tr${a.key_hash ? "" : ' class="free"'}${own(a) ? "" : " data-reuse"} data-q="${esc(searchText(`${a.email} ${accountStoreName(st)}${byInbox ? ` ${label} ${kind}` : ""} ${statusText(a, usOf(a))}`))}">
        <td class="pick"><input type="checkbox" name="pick" form="bulk" value="${esc(a.store + " " + a.email_norm)}" data-store="${esc(a.store)}" data-email="${esc(a.email)}" aria-label="Tick ${esc(a.email)}"${tickNow.has(a.store + " " + a.email_norm) ? " checked" : ""}></td>
        <td class="em">${esc(a.email)}</td><td>${statusCell(a, usOf(a))}</td>
        <td class="act"><form method="get" action="${esc(url.pathname)}">${hidden}${keep("store", a.store)}${keep("email", a.email_norm)}<button class="ed" type="submit" name="action" value="edit">Edit</button></form>${a.store === MASTER && a.key_hash ? `<form method="get" action="${esc(url.pathname)}">${hidden}${keep("email", a.email_norm)}<button class="ed" type="submit" name="action" value="reassign">Reassign</button></form>` : ""}<form method="get" action="${esc(url.pathname)}">${hidden}${keep("email", a.email_norm)}<button class="rm" type="submit" name="action" value="ask">Remove</button></form></td></tr>`).join("")}</tbody></table></section>`;
  };
  // Accounts that don't work (2026-10-23): a section for each list they're set aside on, after the rest. Their ticks' store is
  // aside:<list>: Copy, Remove and the bar's Not working… take them; Reassign and Move to inbox leave them.
  const { results: asideAll } = await env.DB.prepare("SELECT email, email_norm, list, inbox_id, from_last4, from_profile, set_at FROM accounts_aside ORDER BY set_at DESC, email_norm").all();
  const asideText = (x) => [`Set aside ${when(x.set_at)}`, x.from_last4 ? `was with license …${x.from_last4}${x.from_profile ? `, ${x.from_profile}` : ""}` : "",
    x.inbox_id ? (inboxById.has(x.inbox_id) ? `inbox ${inboxById.get(x.inbox_id).name}` : "its inbox is gone") : ""].filter(Boolean).join(" · ");
  const asideSection = (k) => {
    const rows = asideAll.filter((x) => x.list === k), st = ASIDE_PICK + k;
    if (!rows.length) return "";
    return `<section class="store" data-store="${st}"><h3><input type="checkbox" class="all js" hidden data-store="${st}" aria-label="Tick every account on ${esc(ASIDE[k])}"> ${esc(ASIDE[k])} <span class="tag off">Not given out</span> <span class="count">${rows.length}</span></h3>
      <table><thead><tr><th class="pick"></th><th>Account</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr data-q="${esc(searchText(`${x.email} ${ASIDE[k]} not working ${asideText(x)}`))}">
        <td class="pick"><input type="checkbox" name="pick" form="bulk" value="${esc(st + " " + x.email_norm)}" data-store="${st}" data-email="${esc(x.email)}" aria-label="Tick ${esc(x.email)}"${tickNow.has(st + " " + x.email_norm) ? " checked" : ""}></td>
        <td class="em">${esc(x.email)}</td><td>${esc(asideText(x))}</td>
        <td class="act"><form method="post" action="${esc(url.pathname)}">${hidden}${keep("email", x.email_norm)}${keep("aside_to", "back")}<button class="ed" type="submit" name="action" value="aside">Back on my list</button></form><form method="get" action="${esc(url.pathname)}">${hidden}${keep("email", x.email_norm)}<button class="rm" type="submit" name="action" value="ask">Remove</button></form></td></tr>`).join("")}</tbody></table></section>`;
  };
  const asideSections = Object.keys(ASIDE).map(asideSection).join("");
  const noInbox = (byStore.get(MASTER) || []).filter((a) => !inboxAt.has(a.email_norm));
  const sections = [...byStore].flatMap(([st, rows]) => st !== MASTER || !inboxes.length ? [section(st, rows)]
    : [...inboxes.map((b) => [b, rows.filter((a) => inboxAt.get(a.email_norm) === b.id)]).filter(([, rs]) => rs.length).map(([b, rs]) => section(st, rs, b)),
      ...(noInbox.length ? [section(st, noInbox, null)] : [])]).join("");
  // The Inboxes panel: each inbox, what it's for, its counts, and Edit… (its page, inboxPage: Rename, the switch, which it
  // explains first either way, and Delete); then New inbox.
  const ownerSet = inboxes.some((b) => b.mine) ? !!(await ownerHash(env)) : true;
  const btnForm = (act, fields, label, cls, method = "post", aria = "") => `<form method="${method}" action="${esc(url.pathname)}">${hidden}${fields}<button class="${cls}" type="submit" name="action" value="${act}"${aria ? ` aria-label="${esc(aria)}"` : ""}>${label}</button></form>`;
  const freeOf = (rs) => rs.filter((a) => !a.key_hash).length;
  const firstInbox = !inboxes.length;
  const panel = `<section class="inboxes" id="inboxes"><h3>Inboxes</h3>
     <p class="small">${firstInbox ? "Put each account of your list under the inbox its emails go to. " : ""}${INBOX_KINDS_HINT}${firstInbox ? " Until you make one, every account is for buyers." : ""}</p>
     ${ownerSet ? "" : `<p class="small err">No FAFO sends order alerts yet, so no slot gets the accounts in your Only mine inboxes: let your own FAFO send them (Settings → Order alerts for buyers).</p>`}
     ${inboxes.map((b) => `<div class="ibx"><div><strong>${esc(b.name)}</strong> <span class="tag${b.mine ? " mine" : ""}">${inboxKind(b.mine)}</span><br><span class="count">${plural(b.n, "account")}, ${b.free} free</span></div>
       <div class="ibx-a">${btnForm("inbox", keep("inbox", b.id), "Edit…", "ed", "get", `Edit ${b.name}: rename it, change who gets its accounts, or delete it`)}</div></div>`).join("")}
     ${inboxes.length && noInbox.length ? `<div class="ibx"><div><strong>No inbox</strong> <span class="tag">For buyers</span><br><span class="count">${plural(noInbox.length, "account")}, ${freeOf(noInbox)} free</span></div></div>` : ""}
     <details${firstInbox ? " open" : ""}><summary>New inbox</summary>
       <form method="post" class="edit" id="ibx-new">${hidden}
         <label>Name<input type="text" name="name" maxlength="${INBOX_NAME_MAX}" autocomplete="off" spellcheck="false" placeholder="The email address its accounts' mail goes to"></label>
         <label>Who gets its accounts<select name="kind"><option value="buyers">For buyers</option><option value="mine">Only mine</option></select></label>
         ${noInbox.length ? `<label class="opt"><input type="checkbox"${firstInbox ? " checked" : ""} name="adopt" value="1"><span>Put the ${plural(noInbox.length, "account")} that ${noInbox.length === 1 ? "has" : "have"} no inbox in it</span></label>` : ""}
         <div class="row"><button class="ok" type="submit" name="action" value="inbox-new">Make the inbox</button></div>
       </form></details>
     ${noInbox.length ? `<script>(() => { const f = document.getElementById("ibx-new"), k = f.elements.kind, a = f.elements.adopt; let touched = false;
       a.addEventListener("change", () => { touched = true; }); k.addEventListener("change", () => { if (!touched) a.checked = ${firstInbox} && k.value === "buyers"; }); })();</script>` : ""}
   </section>`;
  const total = all.filter(own).length;
  const pick = addTo(store) || MASTER;
  const who = [o.name, o.username ? "@" + o.username : "", "license …" + o.key_last4].filter(Boolean).join(" · ");
  return page(200, "Your list for Use Assigned Account", done,
    `${err ? `<p class="err">${esc(err)}</p>` : ""}
     <p class="who">${total ? `${total} account${total === 1 ? "" : "s"}, ${all.filter((a) => own(a) && !a.key_hash).length} free${inboxes.some((b) => b.mine)
       ? ` (${all.filter((a) => own(a) && !a.key_hash && !(a.store === MASTER && (inboxById.get(inboxAt.get(a.email_norm)) || {}).mine)).length} for buyers)` : ""}` : "Your list is empty"}</p>
     <p class="small">One list for Target and Pokémon Center: a buyer's slots at both stores for one profile get the same account, and no other buyer gets it while they have it. Edit sets a new password, or a new email while the account is free. One given to a buyer can be given back to your list from there, or reassigned: Reassign gives their slots another account in its place, if something's wrong with it. Tick accounts (Shift+click ticks a run of them) to copy, reassign or remove them together. Search matches emails, stores and what each says (Free, a buyer's license, a profile name). <a href="#add">Add accounts</a> is at the end. Changes count at once.</p>
     ${panel}
     ${all.length || asideAll.length ? `<div class="find js" hidden><input type="search" id="find" placeholder="Search your list" aria-label="Search your list" autocomplete="off" spellcheck="false"><button type="button" class="ed" data-pickall>Tick all</button><span class="shown" id="shown" role="status"></span></div>
     <p class="small" id="none-match" hidden>No accounts match your search.</p>` : ""}
     ${sections}${asideSections}
     ${all.length || asideAll.length ? `<form id="bulk" method="post" class="bulk" action="${esc(url.pathname)}">${hidden}
       <span class="n">Ticked accounts</span><span class="msg" id="bulk-msg" role="status"></span>
       <button type="button" class="ed js" hidden data-copy="emails">Copy emails</button>
       <button type="button" class="ed js" hidden data-copy="logins">Copy email:password</button>
       <button type="submit" class="ed" name="action" value="reassign">Reassign</button>
       ${inboxes.length ? `<select name="to_inbox" aria-label="The inbox to move the ticked accounts to">${inboxOptions(inboxes, "", "Move to inbox…", true)}</select><button type="submit" class="ed" name="action" value="move-inbox">Move</button>` : ""}
       <select name="aside_to" aria-label="Where the ticked accounts that don't work go"><option value="" selected disabled>Not working…</option>${Object.entries(ASIDE).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}<option value="back">Back on my list</option></select><button type="submit" class="ed" name="action" value="aside">Apply</button>
       <button type="submit" class="rm" name="action" value="ask-many">Remove</button>
       <button type="button" class="ed js" hidden data-clear>Clear</button>
     </form>${LIST_SCRIPT}` : ""}
     <h3 id="add">Add accounts</h3>
     <form method="post" class="edit">${hidden}
       ${ownLists.length ? `<label>Add to<select name="store">${addStores.map((st) => `<option value="${esc(st)}"${st === pick ? " selected" : ""}>${esc(st === MASTER ? "Your list (Target and Pokémon Center)" : accountStoreName(st) + "'s own list")}</option>`).join("")}</select></label>`
         : `<p class="small">They go on your list, for Target and Pokémon Center both.</p>`}
       ${inboxes.length ? `<label>Inbox<select name="inbox"${ownLists.length ? "" : " required"}${keepAdd ? " autofocus" : ""}>${inboxOptions(inboxes, "", "Choose an inbox…")}</select></label>
         <p class="hint">The inbox their emails go to${ownLists.length ? " (for your list: a store's own list has no inboxes)" : ""}. One already on your list stays in its inbox, or goes in this one if it has none.</p>` : ""}
       <label>Accounts<textarea name="accounts" rows="5" spellcheck="false" autocomplete="off" placeholder="One per line: email:password">${keepAdd ? esc(keepAdd.accounts) : ""}</textarea></label>
       <label>Password for lines with only an email<input type="text" name="password" maxlength="200" autocomplete="off" spellcheck="false"${keepAdd && keepAdd.password ? ` value="${esc(keepAdd.password)}"` : ""}></label>
       <p class="hint">The store account's password: Target's logins file gets email:password, and Pokémon Center checks out as a guest with the email. One already on the list keeps its password: Edit changes it.</p>
       <div class="row"><button class="ok" type="submit" name="action" value="add">Add to my list</button></div>
     </form>
     <p class="small">Passwords are never shown here (Copy email:password puts them on your clipboard only). Asked by ${esc(who)}; this link works until ${esc(when(until))}.</p>`, true);
}

// ---- order alerts ----------------------------------------------------------------------
//
// Buyers hear about orders placed on the accounts they were given (app 1.9.69+). The owner's Orbit
// reads those accounts' order emails; once the owner allows that license from the review link posted
// to their channel, it sends each order's store, number, item, total and step (placed, shipped, …)
// with the account it went to. This finds the buyer the account was given to and keeps the alert for
// their Orbit, without the account, and posts it to the buyer's own Discord webhook if they set one.

const ALERT_STAGES = ["placed", "shipped", "arriving", "delivered", "canceled"];
const ALERT_STAGE_TEXT = { placed: ["✅", "Order placed"], shipped: ["📦", "Shipped"], arriving: ["🚚", "Out for delivery"], delivered: ["🏠", "Delivered"], canceled: ["❌", "Canceled"] };
const ALERT_SENDER_ASKS_PER_DAY = 5;
const ALERTS_PER_POST = 200;
const ALERT_KEEP_MS = 60 * 86400000;
// Buyers' webhooks: Discord's only. Tests point them at a stand-in (ALERT_WEBHOOK_TEST_PREFIX).
const DISCORD_HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d{1,2}\/)?webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,120}$/;
const okHookUrl = (env, u) => DISCORD_HOOK_RE.test(u) || (!!env.ALERT_WEBHOOK_TEST_PREFIX && u.startsWith(env.ALERT_WEBHOOK_TEST_PREFIX) && /^[\x21-\x7e]+$/.test(u));

const currentAlertSender = (env) => env.DB.prepare("SELECT * FROM alert_senders WHERE status = 'allowed' ORDER BY decided_at DESC LIMIT 1").first();

async function alertSenderGet(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const cur = await currentAlertSender(env);
  const last = await env.DB.prepare("SELECT status, created_at FROM alert_senders WHERE key_hash = ? ORDER BY created_at DESC LIMIT 1").bind(lic.hash).first();
  const status = cur && cur.key_hash === lic.hash ? "allowed"
    : last && last.status === "pending" && last.created_at > Date.now() - REVIEW_TTL_MS ? "pending"
    : last && last.status === "refused" ? "refused" : "none";
  return json({ status, canAsk: !!env.DISCORD_WEBHOOK_URL }, 200, { "cache-control": "no-store" });
}

function alertSenderMessage(origin, s) {
  const who = [s.name ? `**${md(s.name)}**` : "", s.username ? `@${md(s.username)}` : "", `license …${s.key_last4}`].filter(Boolean).join(" · ");
  const head = { allowed: "🔔 **Sends order alerts to buyers**", refused: "⛔ **Not allowed to send order alerts**",
    replaced: "🔕 **No longer sends order alerts** (another FAFO does now)", expired: "⌛ **Order alerts request expired**" }[s.status]
    || "🔔 **Let this FAFO send order alerts to buyers?**";
  return `${head}\n${who}${s.status === "pending" ? `\n[Review: allow or refuse](${origin}/alerts/review/${s.id}?t=${s.review_token})` : ""}`;
}

async function alertSenderPost(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  let b; try { b = JSON.parse(await request.text()) || {}; } catch { b = {}; }
  const cur = await currentAlertSender(env);
  if (cur && cur.key_hash === lic.hash) return json({ status: "allowed" });
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM alert_senders WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= ALERT_SENDER_ASKS_PER_DAY) return json({ error: "too many tries today" }, 429);
  // Asking again replaces this license's request that's still waiting.
  await env.DB.prepare("UPDATE alert_senders SET status = 'expired', decided_at = ? WHERE key_hash = ? AND status = 'pending'").bind(now, lic.hash).run();
  const s = { id: randomId(12), key_hash: lic.hash, key_last4: lic.last4, name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60),
    username: lic.username, review_token: randomId(24), status: "pending", created_at: now };
  await env.DB.prepare("INSERT INTO alert_senders (id, key_hash, key_last4, name, username, review_token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(s.id, s.key_hash, s.key_last4, s.name, s.username, s.review_token, now).run();
  ctx.waitUntil((async () => {
    const id = await webhookPost(env, { content: alertSenderMessage(url.origin, s) });
    if (id) await env.DB.prepare("UPDATE alert_senders SET webhook_message_id = ? WHERE id = ?").bind(id, s.id).run();
  })().catch((e) => console.error("webhook", e)));
  return json({ status: "pending" });
}

async function alertSenderReview(request, env, ctx, url, id) {
  const s = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM alert_senders WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!s || !(await sameText(t, s.review_token))) return page(404, "Request not found", "This review link isn't valid.");
  const now = Date.now();
  let done = "", before = [];
  if (s.status === "pending" && s.created_at < now - REVIEW_TTL_MS) {
    await env.DB.prepare("UPDATE alert_senders SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, s.id).run();
  } else if (s.status === "pending" && action === "allow") {
    before = (await env.DB.prepare("SELECT * FROM alert_senders WHERE status = 'allowed'").all()).results || [];
    await env.DB.batch([
      env.DB.prepare("UPDATE alert_senders SET status = 'replaced', decided_at = ? WHERE status = 'allowed'").bind(now),
      env.DB.prepare("UPDATE alert_senders SET status = 'allowed', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, s.id),
    ]);
    done = "Allowed. Orders on the accounts you assign now reach the buyers who have them.";
  } else if (s.status === "pending" && action === "refuse") {
    await env.DB.prepare("UPDATE alert_senders SET status = 'refused', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, s.id).run();
    done = "Refused. This FAFO won't send order alerts.";
  }
  const cur = await env.DB.prepare("SELECT * FROM alert_senders WHERE id = ?").bind(s.id).first();
  if (done && cur.webhook_message_id) ctx.waitUntil(webhookEdit(env, cur.webhook_message_id, { content: alertSenderMessage(url.origin, cur) }).catch(() => {}));
  for (const o of before) if (o.id !== cur.id && o.webhook_message_id) ctx.waitUntil(webhookEdit(env, o.webhook_message_id, { content: alertSenderMessage(url.origin, { ...o, status: "replaced" }) }).catch(() => {}));
  const label = { pending: "Waiting for you", allowed: "Sends order alerts to buyers", refused: "Refused",
    replaced: "Replaced: another FAFO sends order alerts now", expired: "Expired. Turn order alerts on again from FAFO." }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : "", "license …" + cur.key_last4].filter(Boolean).join(" · ");
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  return page(200, "Order alerts for buyers", done || label,
    `<p class="who">${esc(who)}</p>
     <p class="small">Allowing it lets this FAFO tell buyers about orders placed on the accounts you assigned them: the store, their profile, the item, the total and the status. Never the account's email or password. One FAFO sends them at a time.</p>
     ${cur.status === "pending" ? `<p class="small"><strong>Only allow it if you turned it on</strong> in your own FAFO (Settings → Order alerts for buyers).</p>
     <div class="row">${btn("allow", "Allow", "ok")}${btn("refuse", "Refuse", "no")}</div>` : ""}`);
}

async function alertSender(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return { error: json({ error: "license not recognized" }, 401) };
  const cur = await currentAlertSender(env);
  if (!cur || cur.key_hash !== lic.hash) return { error: json({ error: "not the alert sender" }, 403) };
  return { lic };
}

// The accounts given out, so the sender only sends orders placed on them.
async function alertAccounts(request, env, ctx) {
  const { error, lic } = await alertSender(request, env);
  if (error) return error;
  ctx.waitUntil(alertsSeen(env, lic, Date.now()).catch((e) => console.error("billing", e)));
  // A slot's row at its store: the one list's account row itself (store "*") is at no store.
  const { results } = await env.DB.prepare(`SELECT email, store FROM accounts WHERE key_hash IS NOT NULL AND sent_at IS NOT NULL AND store <> '${MASTER}'`).all();
  return json({ accounts: results.map((a) => ({ email: a.email, store: a.store })) }, 200, { "cache-control": "no-store" });
}

async function alertsPost(request, env, ctx) {
  const { error, lic } = await alertSender(request, env);
  if (error) return error;
  const text = await request.text();
  if (text.length > 300_000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const list = Array.isArray(b.events) ? b.events : null;
  if (!list || !list.length || list.length > ALERTS_PER_POST) return json({ error: "events" }, 400);
  const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const now = Date.now(), fresh = [];
  let unknown = 0, already = 0;
  // Payments: each order on a given-out account goes on that buyer's invoice, and a canceled one comes off whoever's it is.
  // Written together after the loop; a billing error never stops the alerts.
  const bill = billingOn(env) ? billCtx(env, now) : null, billing = [];
  for (const ev of list) {
    const account = clip(ev && ev.account, 120).toLowerCase(), store = clip(ev && ev.store, 64), stage = clip(ev && ev.stage, 12);
    const orderNo = clip(ev && ev.orderNo, 40).toUpperCase(), at = /^\d{4}-\d{2}-\d{2}$/.test(String(ev && ev.at || "")) ? ev.at : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || !store || !ALERT_STAGES.includes(stage) || !orderNo) { unknown++; continue; }
    if (bill && stage === "canceled") try { billing.push(cancelStmt(env, bill, store, orderNo)); } catch (e) { console.error("billing", e); }
    const a = await env.DB.prepare("SELECT key_hash, profile, store_name, assigned_at, batch FROM accounts WHERE email_norm = ? AND store = ? AND key_hash IS NOT NULL AND sent_at IS NOT NULL")
      .bind(account, store).first();
    // Only orders from the day before it was given out on: an older one was placed for someone else.
    if (!a || (at && at < new Date((a.assigned_at || 0) - 86400000).toISOString().slice(0, 10))) { unknown++; continue; }
    const oid = (await sha256Hex(`${a.key_hash}|${store}|${orderNo}`)).slice(0, 20);
    const row = { id: randomId(12), key_hash: a.key_hash, oid, store, store_name: clip(ev.storeName, 40) || a.store_name || store, profile: a.profile || "",
      order_no: orderNo, item: clip(ev.item, 120), qty: clip(ev.qty, 6) || "1", total: clip(ev.total, 20), stage, at, created_at: now + fresh.length };
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, key_hash, oid, store, store_name, profile, order_no, item, qty, total, stage, at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.key_hash, oid, store, row.store_name, row.profile, orderNo, row.item, row.qty, row.total, stage, at, row.created_at).run();
    if (r.meta && r.meta.changes) fresh.push(row); else already++;   // that step was already sent
    if (bill && stage !== "canceled") {
      try { const l = await alertLine(env, bill, a, store, orderNo, { account, at, storeName: clip(ev.storeName, 40), item: row.item, qty: row.qty }); if (l) billing.push(l); }
      catch (e) { console.error("billing", e); }
    }
  }
  if (billing.length) {
    try {
      const gone = (await env.DB.batch(billing)).flatMap((r) => (r.results || []).map((x) => x.id)).filter(Boolean);
      if (gone.length) ctx.waitUntil(expireFor(env, bill, gone));
    } catch (e) { console.error("billing", e); }
  }
  ctx.waitUntil(alertsSeen(env, lic, now).catch((e) => console.error("billing", e)));
  if (fresh.length) ctx.waitUntil(alertWebhooks(env, fresh).catch((e) => console.error("alert webhooks", e)));
  ctx.waitUntil(env.DB.prepare("DELETE FROM alerts WHERE created_at < ?").bind(now - ALERT_KEEP_MS).run().catch(() => {}));
  return json({ ok: true, sent: fresh.length, already, unknown });
}

async function alertsGet(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const since = Math.max(0, Math.floor(Number(url.searchParams.get("since"))) || 0);
  const { results } = await env.DB.prepare("SELECT * FROM alerts WHERE key_hash = ? AND created_at > ? ORDER BY created_at LIMIT 200").bind(lic.hash, since).all();
  return json({ alerts: results.map((a) => ({ id: a.id, oid: a.oid, store: a.store, storeName: a.store_name, profile: a.profile, orderNo: a.order_no,
    item: a.item, qty: a.qty, total: a.total, stage: a.stage, at: a.at, createdAt: a.created_at })), now: Date.now() }, 200, { "cache-control": "no-store" });
}

function alertText(a) {
  const [icon, what] = ALERT_STAGE_TEXT[a.stage] || ["🔔", a.stage];
  const total = a.total ? (/^[$€£]/.test(a.total) ? a.total : "$" + a.total) : "";
  const line = [a.profile, a.item ? a.item + (Number(a.qty) > 1 ? ` ×${a.qty}` : "") : "", total].filter(Boolean).map(md).join(" · ");
  return `${icon} **${what}** · ${md(a.store_name)}${line ? "\n" + line : ""}\n-# Order #${md(a.order_no)}${a.at ? " · " + a.at : ""}`;
}

async function hookPost(url, content) {
  const send = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, flags: SUPPRESS_EMBEDS, allowed_mentions: { parse: [] } }) });
  try {
    let r = await send();
    if (r.status === 429) {
      const wait = Number((await r.json().catch(() => ({}))).retry_after) || 1;
      if (wait <= 10) { await new Promise((ok) => setTimeout(ok, wait * 1000)); r = await send(); }
    }
    return r.ok ? { ok: true } : { ok: false, error: `Discord answered ${r.status}` };
  } catch { return { ok: false, error: "Discord couldn't be reached" }; }
}

async function alertWebhooks(env, rows) {
  for (const k of new Set(rows.map((r) => r.key_hash))) {
    const h = await env.DB.prepare("SELECT url FROM alert_webhooks WHERE key_hash = ?").bind(k).first();
    if (!h) continue;
    for (const r of rows.filter((x) => x.key_hash === k)) {
      const res = await hookPost(h.url, alertText(r));
      await (res.ok ? env.DB.prepare("UPDATE alert_webhooks SET last_ok = ?, last_error = NULL WHERE key_hash = ?").bind(Date.now(), k)
        : env.DB.prepare("UPDATE alert_webhooks SET last_error = ? WHERE key_hash = ?").bind(res.error, k)).run();
    }
  }
}

async function alertWebhookGet(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const h = await env.DB.prepare("SELECT set_at, last_ok, last_error FROM alert_webhooks WHERE key_hash = ?").bind(lic.hash).first();
  return json(h ? { set: true, setAt: h.set_at, lastOk: h.last_ok, lastError: h.last_error } : { set: false }, 200, { "cache-control": "no-store" });
}

async function alertWebhookPut(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  let b; try { b = JSON.parse(await request.text()) || {}; } catch { b = {}; }
  const u = String(b.url || "").trim();
  if (!u) {
    await env.DB.prepare("DELETE FROM alert_webhooks WHERE key_hash = ?").bind(lic.hash).run();
    return json({ set: false });
  }
  if (u.length > 300 || !okHookUrl(env, u)) return json({ error: "That isn't a Discord webhook link." }, 400);
  const now = Date.now();
  const had = await env.DB.prepare("SELECT set_at FROM alert_webhooks WHERE key_hash = ?").bind(lic.hash).first();
  if (had && had.set_at > now - 5000) return json({ error: "Wait a moment, then try again." }, 429);
  // A test post first, so a wrong or deleted webhook is caught now.
  const res = await hookPost(u, "✅ FAFO will post your order alerts here.");
  if (!res.ok) return json({ error: `${res.error}. Check the webhook link.` }, 400);
  await env.DB.prepare(`INSERT INTO alert_webhooks (key_hash, url, set_at, last_ok) VALUES (?, ?, ?, ?)
    ON CONFLICT (key_hash) DO UPDATE SET url = excluded.url, set_at = excluded.set_at, last_ok = excluded.last_ok, last_error = NULL`).bind(lic.hash, u, now, now).run();
  return json({ set: true });
}

// ---- pulls ---------------------------------------------------------------------------
//
// Pulling slots on the Submit page after they were sent tells the owner, in the same channel, so they
// can take them off their list. Only what it takes to find them goes there, in plain text: store,
// profile name, account email, and card brand and last 4. Never card numbers or passwords.

const PULLS_PER_HOUR = 30;
const PULL_MAX_CHARS = 200_000;
// A pull still unposted after this long was cut off, and a retry takes it over (PULL_STALE_MS overrides it for tests).
const pullStaleMs = (env) => Number(env.PULL_STALE_MS) > 0 ? Number(env.PULL_STALE_MS) : 2 * 60 * 1000;

async function pull(request, env, ctx) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  if (Number(request.headers.get("content-length") || 0) > PULL_MAX_CHARS) return json({ error: "too large" }, 413);
  const text = await request.text();
  if (text.length > PULL_MAX_CHARS) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const keyId = String(b.keyId || "").toUpperCase();
  // A collecting key's ID, or "CSV" for slots that were sent as CSV (app 1.9.52+).
  if (!/^([0-9A-F]{4}-[0-9A-F]{4}|CSV)$/.test(keyId)) return json({ error: "keyId" }, 400);
  if (!Array.isArray(b.slots) || !b.slots.length || b.slots.length > SLOT_MAX) return json({ error: "slots" }, 400);
  const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  const slots = b.slots.map((x) => {
    const t = Number(x && x.sentAt);
    return {
      store: clip(x && x.store, 40), profile: clip(x && x.profile, 80), email: clip(x && x.email, 120), card: clip(x && x.card, 30),
      // When it was sent, in epoch ms; left off if it isn't a date.
      sentAt: Number.isFinite(t) && t > 0 && t <= 8.64e15 ? t : 0,
      // For payments: the store's key (page 1.9.130+), and the slot's own account (not "Assigned account").
      storeKey: STORE_KEY.test(String(x && x.storeKey || "")) ? String(x.storeKey) : "",
      own: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clip(x && x.email, 120)) ? clip(x && x.email, 120) : "",
    };
  }).filter((x) => x.store || x.profile);
  if (!slots.length) return json({ error: "slots" }, 400);
  // A slot on Use Assigned Account (the app sends "Assigned account", it never knows which): the
  // account it went out with, so the owner knows which one to take back.
  const asks = slots.filter((x) => x.email === "Assigned account" && x.profile);
  if (asks.length) {
    const found = await env.DB.batch(asks.map((x) => env.DB.prepare(
      `SELECT email, store, batch FROM accounts WHERE key_hash = ? AND store_name = ? AND profile = ? AND sent_at IS NOT NULL ORDER BY store = '${MASTER}', sent_at DESC, assigned_at DESC LIMIT 1`
    ).bind(lic.hash, x.store, x.profile)));
    // The slot's own row at its store comes first (an account from the one list has the same email on the list's row).
    asks.forEach((x, i) => { const a = found[i].results[0]; if (a) { x.email = `${a.email} (assigned account)`; if (a.store !== MASTER) x.acct = { store: a.store, batch: a.batch }; } });
  }
  // Only slots this license sent through here reached the owner's list, so a pull of anything else
  // (sent as a code, or to another seller) isn't posted.
  const sent = await env.DB.prepare("SELECT 1 FROM submissions WHERE key_hash = ? AND key_id = ? AND webhook_message_id IS NOT NULL LIMIT 1")
    .bind(lic.hash, keyId).first();
  if (!sent) return json({ ok: true, forwarded: false });
  // The app sends the same batch id when it retries, so a pull whose answer got lost isn't posted twice.
  const batch = /^[A-Za-z0-9_-]{16,40}$/.test(String(b.batch || "")) ? String(b.batch) : randomId(12);
  const now = Date.now();
  const seen = await env.DB.prepare("SELECT key_hash, webhook_message_id FROM pulls WHERE id = ?").bind(batch).first();
  let takeover = false;
  if (seen) {
    if (seen.key_hash !== lic.hash) return json({ error: "batch id taken" }, 409);
    if (seen.webhook_message_id) return json({ ok: true, forwarded: true, duplicate: true, id: batch });
    // The app keeps its batch id for good, so an attempt that never recorded its message would
    // otherwise answer "still sending" forever. Once it's stale, one retry takes it over (the UPDATE
    // only matches once). If that attempt did reach the channel, the owner sees it twice: rare, and harmless.
    const t = await env.DB.prepare("UPDATE pulls SET created_at = ? WHERE id = ? AND webhook_message_id IS NULL AND created_at < ?")
      .bind(now, batch, now - pullStaleMs(env)).run();
    if (!t.meta || !t.meta.changes) return json({ error: "still sending" }, 425);
    takeover = true;
  }
  if (!takeover) {
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM pulls WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 3600 * 1000).first();
    if (recent && recent.n >= PULLS_PER_HOUR) return json({ error: "too many pulls this hour" }, 429);
  }

  const p = { id: batch, key_hash: lic.hash, key_last4: lic.last4, username: lic.username, name: clip(b.name, 60), slots: slots.length, key_id: keyId };
  const who = [p.name ? `**${md(p.name)}**` : "", p.username ? `@${md(p.username)}` : "", `license …${p.key_last4}`].filter(Boolean).join(" · ");
  const head = `🔻 **${p.slots} slot${p.slots === 1 ? "" : "s"} pulled** by ${who}`;
  // One line per slot, leaving out what the app didn't send.
  const line = (x, f, sep) => [f(x.store), f(x.profile), f(x.email), f(x.card), x.sentAt ? `sent ${day(x.sentAt)}` : ""].filter(Boolean).join(sep);
  const sentAs = keyId === "CSV" ? "Sent as CSV." : `Sent for key ${keyId}.`;
  let content = `${head}\n${slots.map((x) => line(x, md, " · ")).join("\n")}\n-# Take ${p.slots === 1 ? "it" : "them"} off their list. ${sentAs}`;
  let file;
  // Discord allows 2000 characters in a message, so a long list is attached as a file instead.
  if (content.length > 1900) {
    const counts = new Map();
    for (const x of slots) if (x.store) counts.set(x.store, (counts.get(x.store) || 0) + 1);
    const storeLine = [...counts].map(([name, n]) => `${md(name)} ${n}`).join(" · ").slice(0, 1200);
    content = `${head}${storeLine ? `\n${storeLine}` : ""}\n-# The full list is attached. Take them off their list. ${sentAs}`;
    const stamp = new Date(now).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const slug = p.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    file = { name: `orbit-pulled-${stamp}${slug ? "-" + slug : ""}.txt`, text: slots.map((x) => line(x, String, " | ")).join("\n") + "\n" };
  }
  // Recorded before posting, so a retry that arrives while this one is still posting isn't posted too.
  if (!takeover) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO pulls (id, key_hash, key_last4, name, username, slots, key_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(p.id, p.key_hash, p.key_last4, p.name, p.username, p.slots, p.key_id, now).run();
    if (!ins.meta || !ins.meta.changes) return json({ error: "still sending" }, 425);
  }
  // Finished even if the app hangs up mid-post (it quit, or lost its connection), so the row is
  // either posted and recorded or removed for a clean retry.
  const work = (async () => {
    let msgId = null;
    try { msgId = await webhookPost(env, { content }, file); }
    catch (e) { console.error("webhook", e); }
    if (!msgId) {
      // Only this attempt's row (by its time): a retry that took it over meanwhile keeps its own.
      await env.DB.prepare("DELETE FROM pulls WHERE id = ? AND created_at = ? AND webhook_message_id IS NULL").bind(p.id, now).run();
      return json({ error: "couldn't post to the channel" }, 502);
    }
    await env.DB.prepare("UPDATE pulls SET webhook_message_id = ? WHERE id = ?").bind(msgId, p.id).run().catch((e) => console.error("record", e));
    // Payments: a pulled slot's own account stops being billed after the pull, and so does an account the owner gave, once
    // the owner has heard of it (so they take it off). Kept whether billing is on or off, and never fails the pull.
    try { await pullAccounts(env, lic.hash, slots, now); } catch (e) { console.error("billing", e); }
    return json({ ok: true, forwarded: true, id: p.id });
  })();
  ctx.waitUntil(work.catch((e) => console.error("pull", e)));
  return await work;
}

// ---- web version and sync ----------------------------------------------------------------

const VAULT_MAX_CHARS = 8_000_000;          // the app's own copy lives in the browser, which holds about 5 MB
const VAULT_CHUNK = 900_000;                // characters per row (D1 rows top out at 2 MB)
const VAULT_FAILS = 10;                     // wrong tokens in a row before the vault stops taking tokens...
const vaultLockMs = (env) => Number(env.VAULT_LOCK_MS) > 0 ? Number(env.VAULT_LOCK_MS) : 15 * 60 * 1000;   // ...for this long
// Saves closer together than this are turned away (the app waits a few seconds after a change anyway).
const vaultGapMs = (env) => String(env.VAULT_MIN_GAP_MS ?? "").trim() !== "" && Number(env.VAULT_MIN_GAP_MS) >= 0 ? Number(env.VAULT_MIN_GAP_MS) : 1000;
const validVaultToken = (t) => /^[A-Za-z0-9_-]{32,128}$/.test(t || "");
const NO_STORE = { "cache-control": "no-store" };

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// null when the token opens the vault, otherwise the response to send. Wrong tokens count toward
// VAULT_FAILS; a right one clears the count.
async function vaultAuthCheck(env, row, token, now) {
  const lockMs = vaultLockMs(env);
  const locked = row.fails >= VAULT_FAILS && now - row.fail_at < lockMs;
  if (locked) return json({ error: "too many wrong passwords", retryAfter: Math.ceil((lockMs - (now - row.fail_at)) / 1000) }, 429, NO_STORE);
  const hash = validVaultToken(token) ? await sha256Hex(token) : "";
  if (hash && await sameText(hash, row.auth_hash)) {
    if (row.fails) await env.DB.prepare("UPDATE vaults SET fails = 0, fail_at = 0 WHERE key_hash = ?").bind(row.key_hash).run();
    return null;
  }
  // A device still on the previous password: it isn't guessing, so it doesn't count.
  if (hash && row.prev_auth_hash && await sameText(hash, row.prev_auth_hash)) return json({ error: "password changed" }, 403, NO_STORE);
  const fails = (now - row.fail_at < lockMs ? row.fails : 0) + 1;
  await env.DB.prepare("UPDATE vaults SET fails = ?, fail_at = ? WHERE key_hash = ?").bind(fails, now, row.key_hash).run();
  return json({ error: "wrong password" }, 403, NO_STORE);
}

async function vaultInfo(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const row = await env.DB.prepare("SELECT rev, salt, iter, size, device, created_at, updated_at FROM vaults WHERE key_hash = ?").bind(lic.hash).first();
  return json(row ? { exists: true, rev: row.rev, created: row.created_at, salt: row.salt, iter: row.iter, size: row.size, device: row.device, updatedAt: row.updated_at } : { exists: false }, 200, NO_STORE);
}

async function vaultGet(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const row = await env.DB.prepare("SELECT * FROM vaults WHERE key_hash = ?").bind(lic.hash).first();
  if (!row) return json({ error: "no vault" }, 404, NO_STORE);
  const bad = await vaultAuthCheck(env, row, request.headers.get("x-vault-auth"), Date.now());
  if (bad) return bad;
  if (Number(url.searchParams.get("have")) === row.rev) return json({ rev: row.rev, created: row.created_at, same: true }, 200, NO_STORE);
  const { results } = await env.DB.prepare("SELECT data FROM vault_chunks WHERE key_hash = ? AND rev = ? ORDER BY idx").bind(lic.hash, row.rev).all();
  if (results.length !== row.chunks) return json({ error: "being saved, try again" }, 503, NO_STORE);
  // The record goes out as the app sent it, without parsing it here.
  const head = JSON.stringify({ rev: row.rev, created: row.created_at, device: row.device, updatedAt: row.updated_at });
  return new Response(head.slice(0, -1) + ',"record":' + results.map((r) => r.data).join("") + "}",
    { status: 200, headers: { "content-type": "application/json", ...CORS, ...NO_STORE } });
}

async function vaultPut(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const now = Date.now();
  const base = Number(url.searchParams.get("base")), vid = Number(url.searchParams.get("vid") || 0);
  const device = String(url.searchParams.get("device") || "").replace(/[^\w .,()-]/g, "").slice(0, 40);
  const token = request.headers.get("x-vault-auth") || "", newToken = request.headers.get("x-vault-new-auth") || "";
  const salt = request.headers.get("x-vault-salt") || "", iter = Number(request.headers.get("x-vault-iter"));
  if (!Number.isInteger(base) || base < 0 || !validVaultToken(token) || (newToken && !validVaultToken(newToken))
    || !/^[A-Za-z0-9+/]{16,88}={0,2}$/.test(salt) || !Number.isInteger(iter) || iter < 1000 || iter > 10_000_000) return json({ error: "bad request" }, 400);
  if (Number(request.headers.get("content-length") || 0) > VAULT_MAX_CHARS * 4) return json({ error: "vault too large" }, 413);
  const text = await request.text();
  if (text.length > VAULT_MAX_CHARS) return json({ error: "vault too large" }, 413);
  // Only a sealed record is taken, and only one sealed with the salt it says.
  if (!/^\{[\s\S]*\}$/.test(text) || !text.includes(`"salt":"${salt}"`) || !/"ct":"[A-Za-z0-9+/=]+"/.test(text)) return json({ error: "not a sealed vault" }, 400);
  const chunks = [];
  for (let i = 0; i < text.length; i += VAULT_CHUNK) chunks.push(text.slice(i, i + VAULT_CHUNK));
  const row = await env.DB.prepare("SELECT * FROM vaults WHERE key_hash = ?").bind(lic.hash).first();
  const current = async () => {
    const r = await env.DB.prepare("SELECT rev, created_at FROM vaults WHERE key_hash = ?").bind(lic.hash).first();
    return r ? { rev: r.rev, created: r.created_at } : { rev: 0, created: 0 };
  };
  if (!row) {
    if (base !== 0) return json({ error: "not saved yet", rev: 0, created: 0 }, 409, NO_STORE);
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO vaults (key_hash, rev, auth_hash, salt, iter, size, chunks, device, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(lic.hash, await sha256Hex(newToken || token), salt, iter, text.length, chunks.length, device, now, now),
        ...chunks.map((c, i) => env.DB.prepare("INSERT INTO vault_chunks (key_hash, rev, idx, data) VALUES (?, 1, ?, ?)").bind(lic.hash, i, c)),
      ]);
    } catch (e) { return json({ error: "saved from another device first", ...await current() }, 409, NO_STORE); }
    return json({ rev: 1, created: now }, 200, NO_STORE);
  }
  const bad = await vaultAuthCheck(env, row, token, now);
  if (bad) return bad;
  if (base !== row.rev || (vid && vid !== row.created_at)) return json({ error: "changed on another device", rev: row.rev, created: row.created_at }, 409, NO_STORE);
  // A new password comes with its own token; otherwise the record has to stay on the vault's password.
  if ((salt !== row.salt || iter !== row.iter) && !newToken) return json({ error: "a new password needs its token" }, 400);
  if (now - row.updated_at < vaultGapMs(env)) return json({ error: "too fast", retryAfter: 1 }, 429, NO_STORE);
  const next = row.rev + 1;
  let changed = 0;
  try {
    // Two devices saving at once both write revision `next`: the second one's rows clash, and its
    // whole batch is undone.
    const res = await env.DB.batch([
      ...chunks.map((c, i) => env.DB.prepare("INSERT INTO vault_chunks (key_hash, rev, idx, data) VALUES (?, ?, ?, ?)").bind(lic.hash, next, i, c)),
      env.DB.prepare("UPDATE vaults SET rev = ?, auth_hash = ?, prev_auth_hash = ?, salt = ?, iter = ?, size = ?, chunks = ?, device = ?, updated_at = ? WHERE key_hash = ? AND rev = ? AND created_at = ?")
        .bind(next, newToken ? await sha256Hex(newToken) : row.auth_hash, newToken ? row.auth_hash : (row.prev_auth_hash || ""), salt, iter, text.length, chunks.length, device, now, lic.hash, row.rev, row.created_at),
      env.DB.prepare("DELETE FROM vault_chunks WHERE key_hash = ? AND rev < ?").bind(lic.hash, next - 1),
    ]);
    changed = res[chunks.length].meta ? res[chunks.length].meta.changes : 0;
  } catch (e) { return json({ error: "changed on another device", ...await current() }, 409, NO_STORE); }
  if (!changed) {
    await env.DB.prepare("DELETE FROM vault_chunks WHERE key_hash = ? AND rev = ? AND rev <> (SELECT rev FROM vaults WHERE key_hash = ?)").bind(lic.hash, next, lic.hash).run();
    return json({ error: "changed on another device", ...await current() }, 409, NO_STORE);
  }
  return json({ rev: next, created: row.created_at }, 200, NO_STORE);
}

async function vaultDelete(request, env) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM vaults WHERE key_hash = ?").bind(lic.hash),
    env.DB.prepare("DELETE FROM vault_chunks WHERE key_hash = ?").bind(lic.hash),
  ]);
  return json({ ok: true, deleted: !!(res[0].meta && res[0].meta.changes) }, 200, NO_STORE);
}

// ---- owner tools ---------------------------------------------------------------------

// ---- premium buyers --------------------------------------------------------------------------
// Generate is for premium buyers (2026-10-17, the owner's request: "only allow premium buyers to use it"; the owner picks
// them by hand). Pages from 1.9.127 ask GET /premium with their license and show Generate only when it says premium. The
// owner picks buyers on a page their FAFO asks for (POST /premium/list posts its link to the channel, for 24 hours, as
// See my list does). The license allowed to send order alerts (the owner's own FAFO) is premium too, so the owner keeps it.
const PREMIUM_LISTS_PER_DAY = 10;
const PREMIUM_LIST_TTL_MS = 24 * 3600 * 1000;
const last4Of = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-4);

async function isPremium(env, hash) {
  if (await env.DB.prepare("SELECT 1 AS p FROM premium WHERE key_hash = ?").bind(hash).first()) return true;
  const s = await currentAlertSender(env);
  return !!(s && s.key_hash === hash);
}

async function premiumGet(request, env) {
  // The license as slotLicense reads it, but from one look at each list: a key that isn't in this database while the
  // list of keys made by hand can't be read is unknown, not refused (503, so the app keeps its last answer; a 401 takes
  // Generate away).
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  const norm = m ? m[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!/^PVLT[A-Z0-9]{16}$/.test(norm)) return json({ error: "license not recognized" }, 401);
  const hash = await keyHash(norm);
  const row = await env.DB.prepare("SELECT revoked_at FROM licenses WHERE key_hash = ?").bind(hash).first();
  const on = row ? !row.revoked_at : await ghListHas(env, hash);
  if (on === null) return json({ error: "the list of keys made by hand can't be read just now" }, 503);
  if (!on) return json({ error: "license not recognized" }, 401);
  // owner: this license sends order alerts, so it's the seller's own FAFO, which offers Settings → Premium buyers.
  const s = await currentAlertSender(env), owner = !!(s && s.key_hash === hash);
  return json({ premium: owner || await isPremium(env, hash), owner }, 200, { "cache-control": "no-store" });
}

async function premiumListAsk(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  const text = await request.text();
  if (text.length > 2000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const now = Date.now();
  await env.DB.prepare("DELETE FROM premium_lists WHERE created_at < ?").bind(now - 7 * 86400000).run();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM premium_lists WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= PREMIUM_LISTS_PER_DAY) return json({ error: "too many tries today" }, 429);
  const o = { id: randomId(12), key_hash: lic.hash, key_last4: lic.last4, username: lic.username,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), view_token: randomId(24), created_at: now };
  await env.DB.prepare("INSERT INTO premium_lists (id, key_hash, key_last4, name, username, view_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(o.id, o.key_hash, o.key_last4, o.name, o.username, o.view_token, o.created_at).run();
  const who = [o.name ? `**${md(o.name)}**` : "", o.username ? `@${md(o.username)}` : "", `license …${o.key_last4}`].filter(Boolean).join(" · ");
  const id = await webhookPost(env, { content: `⭐ **Premium buyers**\nAsked by ${who}\n[Choose who's premium](${url.origin}/premium/list/${o.id}?t=${o.view_token}) · the link works for 24 hours` });
  if (!id) { await env.DB.prepare("DELETE FROM premium_lists WHERE id = ?").bind(o.id).run(); return json({ error: "couldn't post to the channel" }, 502); }
  return json({ status: "sent" });
}

// The page: every buyer with a license from Continue with Discord (not turned off), premium or not, with a button to change
// it; premium keys made by hand (licenses.json) too, and a box to make one premium by its key. Changes only by POST.
// The search is kept for the tab (sessionStorage), as on See my list, so it's still there after Make or Remove premium
// sends the page again.
const PREMIUM_SCRIPT = `<script>
(() => {
  const f = document.getElementById("find"), rows = [...document.querySelectorAll("tr[data-q]")], shown = document.getElementById("shown");
  const KEY = "premium-find:" + location.pathname;
  const fold = (x) => x.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  const filter = () => {
    const w = fold(f.value).split(/\\s+/).filter(Boolean); let n = 0;
    rows.forEach((r) => { r.hidden = !w.every((x) => r.dataset.q.includes(x)); if (!r.hidden) n++; });
    shown.textContent = w.length ? n + " of " + rows.length + " shown" : "";
    try { sessionStorage.setItem(KEY, f.value); } catch (e) {}
  };
  f.addEventListener("input", filter);
  f.addEventListener("keydown", (e) => { if (e.key === "Escape" && f.value) { f.value = ""; filter(); } });
  let q0 = null; try { q0 = sessionStorage.getItem(KEY); } catch (e) {}
  if (q0) f.value = q0;
  filter();
  addEventListener("pageshow", filter);
})();
</script>`;
async function premiumListPage(request, env, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM premium_lists WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", form = null;
  if (request.method === "POST") {
    form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.view_token))) return page(404, "Not found", "This link isn't valid.");
  const now = Date.now();
  if (now > o.created_at + PREMIUM_LIST_TTL_MS) return page(410, "Premium buyers", "This link has expired. Ask again from FAFO: Settings → Premium buyers.");
  let msg = "", err = "";
  if (form) {
    const action = String(form.get("action") || ""), key = String(form.get("key") || "");
    const grant = (hash, last4) => env.DB.prepare("INSERT OR IGNORE INTO premium (key_hash, key_last4, granted_at) VALUES (?, ?, ?)").bind(hash, last4, now).run();
    if (action === "grant" && /^[0-9a-f]{64}$/.test(key)) {
      const row = await env.DB.prepare("SELECT username, license_key FROM licenses WHERE key_hash = ? AND revoked_at IS NULL").bind(key).first();
      if (row) { await grant(key, last4Of(row.license_key)); msg = `@${row.username} is premium now.`; }
      else err = "That license isn't on the list any more.";
    } else if (action === "remove" && /^[0-9a-f]{64}$/.test(key)) {
      const row = await env.DB.prepare("SELECT key_last4 FROM premium WHERE key_hash = ?").bind(key).first();
      await env.DB.prepare("DELETE FROM premium WHERE key_hash = ?").bind(key).run();
      msg = row ? `License …${row.key_last4} isn't premium any more.` : "";
    } else if (action === "add") {
      const norm = String(form.get("license") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!/^PVLT[A-Z0-9]{16}$/.test(norm)) err = "That isn't a license key. One looks like PVLT-XXXX-XXXX-XXXX-XXXX.";
      else {
        const hash = await keyHash(norm), row = await env.DB.prepare("SELECT revoked_at FROM licenses WHERE key_hash = ?").bind(hash).first();
        const onList = row ? !row.revoked_at : await ghListHas(env, hash);
        if (onList === null) err = "The list of keys made by hand couldn't be read just now. Try again in a minute.";
        else if (!onList) err = "FAFO doesn't know that license key, or it was turned off.";
        else { await grant(hash, norm.slice(-4)); msg = `License …${norm.slice(-4)} is premium now.`; }
      }
    }
  }
  const [lics, prem, named] = await env.DB.batch([
    env.DB.prepare("SELECT username, license_key, key_hash, issued_at, revoked_at FROM licenses ORDER BY issued_at DESC"),
    env.DB.prepare("SELECT key_hash, key_last4, granted_at FROM premium ORDER BY granted_at DESC"),
    // The name each license last sent slots under (SQLite takes the bare column from the row with the latest time).
    env.DB.prepare("SELECT key_hash, name, MAX(created_at) AS at FROM submissions WHERE name <> '' GROUP BY key_hash"),
  ]);
  const sender = await currentAlertSender(env), sent = new Map(named.results.map((x) => [x.key_hash, x.name]));
  const premSet = new Map(prem.results.map((p) => [p.key_hash, p]));
  const off = new Map(lics.results.filter((l) => l.revoked_at).map((l) => [l.key_hash, l]));
  // Every license that isn't turned off. One that is shows only while it's still premium ("License turned off": its
  // FAFO isn't told premium, and turned back on it would be again), as does a key made by hand gone from the list.
  const rows = lics.results.filter((l) => !l.revoked_at).map((l) => ({ hash: l.key_hash, user: l.username, last4: last4Of(l.license_key), since: l.issued_at }));
  const known = new Set(rows.map((r) => r.hash));
  const extra = prem.results.map((p) => ({ hash: p.key_hash, last4: p.key_last4 }));
  if (sender) extra.push({ hash: sender.key_hash, last4: sender.key_last4, user: sender.username });
  for (const x of extra) {
    if (known.has(x.hash)) continue;
    known.add(x.hash);
    const l = off.get(x.hash);
    if (l) rows.push({ hash: x.hash, user: l.username, last4: last4Of(l.license_key), since: l.issued_at, off: true });
    else {
      const on = await ghListHas(env, x.hash), listed = !!(ghList && ghList.keys.has(x.hash));
      rows.push({ hash: x.hash, user: x.user || "", last4: x.last4, since: 0, hand: true, expired: on === false && listed, gone: on === false && !listed });
    }
  }
  for (const r of rows) { r.name = sent.get(r.hash) || ""; r.sender = !!(sender && sender.key_hash === r.hash); r.premium = premSet.has(r.hash) || r.sender; r.out = !!(r.off || r.gone || r.expired); }
  rows.sort((a, b) => (a.out - b.out) || (b.sender - a.sender) || (b.premium - a.premium) || (b.since - a.since));
  const day = (x) => new Date(x).toISOString().slice(0, 10);
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (r) => r.sender ? "" : `<form method="post">${hidden}<input type="hidden" name="key" value="${esc(r.hash)}">${r.premium
    ? `<button class="rm" type="submit" name="action" value="remove">Remove premium</button>` : `<button class="ed" type="submit" name="action" value="grant">Make premium</button>`}</form>`;
  const fold = (x) => String(x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const who = (r) => r.user ? "@" + r.user + (r.name ? " · " + r.name : "") : r.name || "Key made by hand";
  // Not premium reads Standard, so the search's "premium" finds only the premium ones.
  const state = (r) => r.off ? "License turned off" : r.expired ? "Key expired" : r.gone ? "Not on the list of keys any more" : r.sender ? "Premium · your FAFO (it sends order alerts)" : r.premium ? "Premium" : "Standard";
  // Three cells, as See my list's rows lay out on a phone: the buyer (with the license under it), premium or not, the button.
  const lic = (r) => `License …${r.last4}${r.since ? `, issued ${day(r.since)}` : r.hand ? ", made by hand" : ""}`;
  const body = rows.map((r) => `<tr data-q="${esc(fold(`${who(r)} ${r.last4} ${state(r)}`))}"><td class="em">${esc(who(r))}<br><span style="font-size:12px;color:#8090b8">${esc(lic(r))}</span></td><td${r.out ? ' style="color:#ff8a80"' : r.premium ? ' style="color:#5fd39a"' : ""}>${esc(state(r))}</td><td class="act">${btn(r)}</td></tr>`).join("");
  // Buyers: not the seller's own FAFO, nor a license that's off or gone.
  const buyers = rows.filter((r) => !r.sender && !r.out), n = buyers.filter((r) => r.premium).length;
  return page(200, "Premium buyers", "",
    `${msg ? `<p class="hint" style="color:#5fd39a;font-weight:600">${esc(msg)}</p>` : ""}${err ? `<p class="hint err">${esc(err)}</p>` : ""}
     <p class="who">${n} of ${buyers.length} ${buyers.length === 1 ? "buyer" : "buyers"} ${n === 1 ? "is" : "are"} premium</p>
     <p class="small">Generate (making profiles in bulk) shows in FAFO only for premium buyers. Their FAFO picks a change up within 10 minutes, or when it's next unlocked. Your own FAFO is premium while it sends order alerts for buyers.</p>
     ${rows.length ? `<div class="find"><input type="search" id="find" placeholder="Search by name, last 4, premium or standard" aria-label="Search buyers by Discord name, the name they send slots under, the license's last 4, premium or standard"><span class="shown" id="shown"></span></div>
     <table><thead><tr><th>Buyer</th><th>Premium</th><th></th></tr></thead><tbody>${body}</tbody></table>` : `<p>No buyers have a license yet.</p>`}
     <h3>A key made by hand</h3>
     <form class="edit" method="post">${hidden}<label>License key<input name="license" autocomplete="off" spellcheck="false" placeholder="PVLT-XXXX-XXXX-XXXX-XXXX"></label>
     <p class="go"><button class="go" type="submit" name="action" value="add">Make premium</button></p></form>
     <p class="hint">The link works until ${esc(new Date(o.created_at + PREMIUM_LIST_TTL_MS).toISOString().replace("T", " ").slice(0, 16))} UTC.</p>
     ${rows.length ? PREMIUM_SCRIPT : ""}`, true);
}

// ---- payments (Stripe) --------------------------------------------------------------------------
// The owner's decisions (2026-10-18): "$10 per checkout or $25 a month plan or 10 slots", paid with Stripe, plus "an
// additional 15 slots for additional $25"; buyers already approved are Friends and Family and never charged; a buyer who
// isn't paid up can't submit. Anyone else not on a paid monthly plan pays $10 for each checkout on slots they sent: an order
// on an account the owner gave them (order alerts), or on their own account while it was out as a slot (their FAFO reports
// those, checked against when it went out and was pulled: billing_accounts), or one the owner adds. Each is due 3 days
// after the order and free if the store cancels it before it's paid. The worker keeps the invoice lines and plans, and
// Stripe takes the money: a Checkout session for what's owed, or a subscription for the monthly plan. Webhooks only make it
// quicker: each answer is checked with Stripe again (reconcile), so a lost one changes nothing. Off until both
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set; a test key (not _live_) reaches only licenses marked Tester (and the
// owner's own FAFO, which is never charged). Removing the keys turns it off here, while Stripe goes on billing subscriptions.
const STRIPE_VERSION = "2026-09-30.endive";
const stripeApi = (env) => String(env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");   // tests set it
const PRICE_CHECKOUT = 1000, PRICE_MONTHLY = 2500, PRICE_EXTRA = 2500;   // cents, usd
const MONTHLY_SLOTS = 10, EXTRA_SLOTS = 15, EXTRA_MAX = 1;
const DUE_MS = 3 * 86400000;
// An order's date is the day where whoever reported it is: windows and plans stretch this much either side, in the buyer's favour.
const TZ_SLACK_MS = 14 * 3600000;
const LOOKUP_BASE = "fafo_monthly_base", LOOKUP_EXTRA = "fafo_monthly_extra", PRODUCT_BASE = "fafo_monthly", PRODUCT_EXTRA = "fafo_extra_slots";
const SESSION_TTL_S = 31 * 60;
const PAY_METHODS = ["card", "link"];   // no bank debits or other delayed methods, so a paid session is paid
const BILL_LIST_TTL_MS = 24 * 3600 * 1000, BILL_LISTS_PER_DAY = 10, REFUSE_NOTE_MS = 6 * 3600 * 1000;
const REPORTS_PER_HOUR = 30, STRIPE_CALLS_PER_HOUR = 20, BUYER_LINES_PER_DAY = 300, DISPUTES_OPEN_MAX = 5, DISPUTES_PER_DAY = 10;
const RECONCILE_MS = 60 * 1000, SUB_RESYNC_MS = 24 * 3600 * 1000;
const LIVE_SUB = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];
// A line still owed (due, overdue or disputed), and one disputed and not answered yet (owed, never overdue).
const OWED = "paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL AND held_sub IS NULL";
const DISPUTED = "(dispute_at IS NOT NULL AND dispute_answer IS NULL)";
const STORE_KEY = /^([a-z0-9]{2,24}|other:[^\r\n]{1,40})$/;
const ORDER_DAY = /^\d{4}-\d{2}-\d{2}$/;

const billingOn = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
const stripeMode = (env) => /_live_/.test(String(env.STRIPE_SECRET_KEY || "")) ? "live" : "test";
// An account as billing knows it (the page works it out the same way): never the email itself.
const acctHash = (email) => sha256Hex("acct:" + String(email).trim().toLowerCase());
const money = (c) => "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
const dayStart = (d) => Date.parse(d + "T00:00:00Z");
const realDay = (d) => ORDER_DAY.test(String(d || "")) && Number.isFinite(dayStart(d));
const storeKeyOfName = (name) => {
  const p = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return p === "target" ? "target" : /^pokemon ?cent(er|re)$/.test(p) ? "pokemoncenter" : "";
};
const lineState = (l, now) => l.paid_at ? "paid" : l.canceled_at ? "canceled" : l.waived_at ? "waived" : l.held_sub ? "held"
  : l.dispute_at && !l.dispute_answer ? "disputed" : l.due_at < now ? "overdue" : "due";
const subEnded = (s) => s.status === "canceled" || s.status === "incomplete_expired" || (s.status === "unpaid" && !!s.ended_at);
const subOut = (s) => s ? { status: s.status, cancelAtEnd: !!s.cancel_at_end, extras: s.extras, paused: !!s.paused, periodEnd: s.period_end, slots: MONTHLY_SLOTS + EXTRA_SLOTS * s.extras } : null;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// Who isn't charged, first that applies: the owner's own FAFO (the license that sends order alerts), then Friends and Family:
// marked so, or (unless marked Charge) approved before billing came on, or a key made by hand. A Tester in test mode is
// Friends and Family only when marked so, or test mode would have no one to try it with.
const exemptOf = (hash, p, l, sender, since, mode) => sender && sender.key_hash === hash ? "owner"
  : p && p.family === 1 ? "family"
  : p && p.family === 0 ? null
  : mode === "test" && p && p.tester ? null
  : !l || l.issued_at < since ? "family" : null;

// When billing first saw itself on in this mode (since): licenses issued before then are Friends and Family. Stamped once
// (INSERT OR IGNORE). And since when orders are billed (from): then, or when it was on again after a request saw the keys
// gone (off_seen), since no FAFO reported its checkouts meanwhile and they aren't billed late. {since, from}.
let onSinceStamped = "";
async function onSince(env, mode, now) {
  if (onSinceStamped !== mode) {
    await env.DB.prepare("INSERT OR IGNORE INTO billing_config (k, v, updated_at) VALUES (?, ?, ?)").bind("on_since:" + mode, String(now), now).run();
    onSinceStamped = mode;
  }
  const { results } = await env.DB.prepare("SELECT k, v FROM billing_config WHERE k IN (?, ?, 'off_seen')").bind("on_since:" + mode, "back_on:" + mode).all();
  const v = Object.fromEntries(results.map((r) => [r.k, Number(r.v)]));
  const since = v["on_since:" + mode] || now;
  let from = Math.max(since, v["back_on:" + mode] || 0);
  if (v.off_seen > from) {
    await env.DB.prepare(`INSERT INTO billing_config (k, v, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
      WHERE CAST(billing_config.v AS INTEGER) < ?3`).bind("back_on:" + mode, now, v.off_seen).run();
    from = now;
  }
  return { since, from };
}
// Payments off (the keys taken away) after they were on: noted at most every 5 minutes, for onSince.
let offStamped = 0;
async function offSeen(env, now) {
  if (now - offStamped < 5 * 60000) return;
  const r = await env.DB.prepare(`INSERT INTO billing_config (k, v, updated_at) SELECT 'off_seen', ?1, ?1 WHERE EXISTS (SELECT 1 FROM billing_config WHERE k LIKE 'on_since:%')
    ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at WHERE billing_config.updated_at < ?2`).bind(now, now - 5 * 60000).run();
  if (r.meta && r.meta.changes) offStamped = now;
}

// What billing knows about licenses within one request, each read once: the mode, when billing started, the owner, and per
// license whether billing reaches it (who) and its monthly subscriptions (subs).
function billCtx(env, now = Date.now()) {
  const mode = stripeMode(env), on = billingOn(env), memo = new Map(), subMemo = new Map();
  let starts = null, sender;
  const c = { mode, on, now };
  c.since = async () => (await (starts || (starts = onSince(env, mode, now)))).since;
  c.from = async () => (await (starts || (starts = onSince(env, mode, now)))).from;
  c.sender = async () => sender !== undefined ? sender : (sender = await currentAlertSender(env));
  c.forget = (hash) => { memo.delete(hash); subMemo.delete(hash); };
  // {hash, on, tester, owner, exempt, person, bill}: on is billing on for this license (live, or test and a Tester, or the
  // owner's own FAFO, which is never charged but gets Settings → Billing).
  c.who = (hash) => {
    if (!memo.has(hash)) memo.set(hash, (async () => {
      const [p, b, l] = (await env.DB.batch([
        env.DB.prepare("SELECT * FROM billing_people WHERE key_hash = ?").bind(hash),
        env.DB.prepare("SELECT * FROM billing WHERE key_hash = ? AND mode = ?").bind(hash, mode),
        env.DB.prepare("SELECT issued_at FROM licenses WHERE key_hash = ?").bind(hash),
      ])).map((r) => r.results[0] || null);
      const s = await c.sender(), owner = !!(s && s.key_hash === hash), tester = !!(p && p.tester);
      const lon = on && (mode === "live" || tester || owner);
      return { hash, on: lon, tester, owner, exempt: lon ? exemptOf(hash, p, l, s, await c.since(), mode) : null, person: p, bill: b };
    })());
    return memo.get(hash);
  };
  c.subs = (hash) => {
    if (!subMemo.has(hash)) subMemo.set(hash, env.DB.prepare("SELECT * FROM billing_subs WHERE key_hash = ? AND mode = ?").bind(hash, mode).all().then((r) => r.results));
    return subMemo.get(hash);
  };
  // The slots on accounts the owner gave that this license pulled (billing_pulled), read once per request.
  const pullMemo = new Map();
  c.pulled = (hash) => {
    if (!pullMemo.has(hash)) pullMemo.set(hash, env.DB.prepare("SELECT store, profile, batch, pulled_at FROM billing_pulled WHERE key_hash = ?").bind(hash).all().then((r) => r.results));
    return pullMemo.get(hash);
  };
  return c;
}

// ---- Stripe's API (form-encoded, pinned version, no SDK) ----
class StripeError extends Error {
  constructor(status, e) { super(e && e.message || `Stripe answered ${status}`); this.status = status; this.type = e && e.type || ""; this.code = e && e.code || ""; this.param = e && e.param || ""; }
}
class BillLimit extends Error {}
// Nested parameters as Stripe reads them (a[b][0][c]=v), null or "" as an empty value (which unsets), booleans as true/false.
function stripeForm(params, out = new URLSearchParams(), pre = "") {
  for (const [k, v] of Object.entries(params || {})) {
    const key = pre ? `${pre}[${k}]` : k;
    if (v === undefined) continue;
    if (v === null) out.append(key, "");
    else if (Array.isArray(v)) v.forEach((x, i) => x !== null && typeof x === "object" ? stripeForm(x, out, `${key}[${i}]`) : out.append(`${key}[${i}]`, String(x)));
    else if (typeof v === "object") stripeForm(v, out, key);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, method, path, params, o = {}) {
  const form = stripeForm(params), get = method === "GET";
  let r;
  try {
    r = await fetch(stripeApi(env) + path + (get && [...form].length ? "?" + form : ""), { method,
      headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "stripe-version": STRIPE_VERSION,
        ...(get ? {} : { "content-type": "application/x-www-form-urlencoded" }), ...(o.idem ? { "idempotency-key": o.idem } : {}) },
      body: get ? undefined : String(form), signal: AbortSignal.timeout(o.timeout || 8000) });
  } catch (e) { throw new StripeError(0, { message: "Stripe couldn't be reached" }); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new StripeError(r.status, j && j.error);
  return j;
}
// What a buyer's FAFO is told when Stripe says no: a card declined (Stripe's own words), or try again.
const stripeFail = (e) => e.type === "card_error" && e.status >= 400 && e.status < 500
  ? json({ error: e.message }, 402, NO_STORE) : json({ error: "Stripe didn't answer. Try again in a minute." }, 502, NO_STORE);
const missing = (e, what) => e instanceof StripeError && e.code === "resource_missing" && new RegExp(what).test(e.param);

// Calls counted for a license's limits: at most `max` of `kind` in `ms`. False once it's reached (nothing counted then).
async function billCount(env, hash, kind, max, ms, now) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_calls WHERE key_hash = ? AND kind = ? AND at > ?").bind(hash, kind, now - ms).first();
  if (r && r.n >= max) return false;
  await env.DB.prepare("INSERT INTO billing_calls (key_hash, kind, at) VALUES (?, ?, ?)").bind(hash, kind, now).run();
  if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM billing_calls WHERE at < ?").bind(now - 2 * 86400000).run();
  return true;
}

// The name a buyer goes by in the channel: the one they last sent slots under, else their Discord name, else their license.
async function billName(env, hash) {
  const [l, s] = (await env.DB.batch([
    env.DB.prepare("SELECT username, license_key FROM licenses WHERE key_hash = ?").bind(hash),
    env.DB.prepare("SELECT name, key_last4 FROM submissions WHERE key_hash = ? ORDER BY created_at DESC LIMIT 1").bind(hash),
  ])).map((r) => r.results[0] || null);
  return md(s && s.name || (l ? "@" + l.username : s ? `license …${s.key_last4}` : "a key made by hand"));
}
const billNote = (env, content) => webhookPost(env, { content }).catch((e) => console.error("billing note", e));

// ---- coverage, lines, state ----
// Since when a buyer the owner moved from Friends and Family to Charge (or marked Tester, in test mode) is charged: orders
// from before then were placed while they weren't. 0 when that isn't so.
const chargeFrom = (c, p) => p && p.charge_from && (p.family === 0 || (c.mode === "test" && p.tester && p.family == null)) ? p.charge_from : 0;
// Whether an order dated `d` goes on this license's invoice: billing reaches it and it isn't exempt, it's from after billing
// came on (and after they were charged), and no monthly plan of theirs covers that day. `held`: their monthly plan is waiting
// on a payment (one that failed, or a renewal still being paid) and the order is after what they paid for, so it waits for
// that payment (covered if it's paid, due if the plan ends). {ok, held} or {why}.
async function billable(c, w, d) {
  if (!w.on) return { why: "off" };
  if (w.exempt) return { why: w.exempt };
  const start = dayStart(d), end = start + 86400000, charged = chargeFrom(c, w.person);
  if (await c.from() + TZ_SLACK_MS >= end) return { why: "before" };
  if (charged && charged + TZ_SLACK_MS >= end) return { why: "charge" };
  const subs = await c.subs(w.hash);
  if (subs.some((s) => s.started_at != null && s.paid_through != null && s.started_at - TZ_SLACK_MS < end && s.paid_through + TZ_SLACK_MS >= start)) return { why: "monthly" };
  const cur = w.bill && w.bill.sub_id ? subs.find((s) => s.sub_id === w.bill.sub_id) : null;
  const waiting = cur && !cur.ended_at && (cur.status === "past_due" || cur.status === "unpaid"
    || ((cur.status === "active" || cur.status === "trialing") && cur.started_at != null && (cur.invoice_status === "draft" || cur.invoice_status === "open")));
  const held = waiting && (cur.paid_through == null || cur.paid_through + TZ_SLACK_MS < start);
  return { ok: true, held: held ? cur.sub_id : null };
}
// The statement that puts one order on a buyer's invoice (billable already checked): $10, due 3 days after the order's day
// (or after now, if that's later). One order belongs to one buyer, so an alert or the owner never adds one that an alert or
// the owner put on another buyer's invoice (another buyer's own report doesn't count: it's only their word). An alert or the
// owner takes over a line the buyer's FAFO reported, unless their FAFO said the store canceled it (the owner can charge it
// again); a buyer's report never touches one from an alert or the owner. Nothing if it's there already.
function lineStmt(env, c, l) {
  const due = Math.max(dayStart(l.orderAt) + 86400000, c.now) + DUE_MS;
  const solo = l.source === "buyer" ? "1" : "NOT EXISTS (SELECT 1 FROM billing_lines o WHERE o.store = ?3 AND o.order_no = ?4 AND o.mode = ?2 AND o.key_hash <> ?1 AND o.source <> 'buyer')";
  return env.DB.prepare(`INSERT INTO billing_lines (id, key_hash, mode, store, store_name, order_no, item, qty, order_at, acct_hash, profile, source, amount, created_at, due_at, held_sub)
    SELECT ?5, ?1, ?2, ?3, ?6, ?4, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16 WHERE ${solo}
    ON CONFLICT (key_hash, mode, store, order_no) DO UPDATE SET source = excluded.source, acct_hash = excluded.acct_hash, due_at = excluded.due_at
    WHERE billing_lines.source = 'buyer' AND excluded.source <> 'buyer' AND billing_lines.paid_at IS NULL AND billing_lines.waived_at IS NULL AND billing_lines.canceled_at IS NULL`)
    .bind(l.hash, c.mode, l.store, l.orderNo, randomId(12), String(l.storeName || "").slice(0, 40), String(l.item || "").slice(0, 120), String(l.qty || "").slice(0, 6),
      l.orderAt, l.acctHash || "", String(l.profile || "").slice(0, 80), l.source, PRICE_CHECKOUT, c.now, due, l.held || null);
}
const orderNoOf = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
// A canceled order: unpaid lines go (free), from an alert (any buyer's line from an alert or the owner) or from the buyer's
// own report (only their own lines: one their FAFO reported, or one the owner added on an account of theirs that was out as a
// slot, as from the bot's log; the owner sees who canceled it and can charge it again). Returns the statement (RETURNING the
// lines' ids).
const cancelStmt = (env, c, store, orderNo, hash) => hash
  ? env.DB.prepare(`UPDATE billing_lines SET canceled_at = ?1, cancel_src = 'buyer' WHERE key_hash = ?2 AND mode = ?3 AND store = ?4 AND order_no = ?5
      AND (source = 'buyer' OR (source = 'owner' AND EXISTS (SELECT 1 FROM billing_accounts a WHERE a.key_hash = ?2 AND a.acct_hash = billing_lines.acct_hash)))
      AND paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL RETURNING id`).bind(c.now, hash, c.mode, store, orderNo)
  : env.DB.prepare(`UPDATE billing_lines SET canceled_at = ?, cancel_src = 'alert' WHERE mode = ? AND store = ? AND order_no = ? AND source IN ('alert', 'owner')
      AND paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL RETURNING id`).bind(c.now, c.mode, store, orderNo);
// A line that stops being owed (canceled, waived, marked paid) while a pay session holds it: that session is expired, so the
// buyer pays the rest in a new one (best effort: if it's paid anyway, the difference is refunded).
async function expireFor(env, c, ids) {
  if (!ids.length) return;
  try {
    const { results } = await env.DB.prepare(`SELECT id, session_id FROM billing_payments WHERE kind = 'pay' AND status = 'open' AND mode = ? AND session_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(billing_payments.line_ids) j WHERE j.value IN (SELECT value FROM json_each(?)))`).bind(c.mode, JSON.stringify(ids)).all();
    for (const p of results) {
      try {
        const s = await stripe(env, "POST", `/v1/checkout/sessions/${encodeURIComponent(p.session_id)}/expire`);
        if (s.status === "expired") await env.DB.prepare("UPDATE billing_payments SET status = 'expired' WHERE id = ? AND status = 'open'").bind(p.id).run();
      } catch (e) { console.error("billing expire", e && e.message); }
    }
  } catch (e) { console.error("billing expire", e && e.message); }
}

// What a buyer owes: owed (due, overdue and disputed), overdue (never a disputed one), n (lines owed), late (lines overdue).
async function lineTotals(env, c, hash) {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS owed, COUNT(*) AS n,
    COALESCE(SUM(CASE WHEN due_at < ?1 AND NOT ${DISPUTED} THEN amount END), 0) AS overdue, COALESCE(SUM(CASE WHEN due_at < ?1 AND NOT ${DISPUTED} THEN 1 END), 0) AS late
    FROM billing_lines WHERE key_hash = ?2 AND mode = ?3 AND ${OWED}`).bind(c.now, hash, c.mode).first();
  return { owed: r.owed, overdue: r.overdue, n: r.n, late: r.late };
}

// A buyer's billing as GET /billing and the Submit check read it. block: why they can't submit, first that applies (null when
// billing is off for them or they're exempt). A monthly plan is checked with Stripe once a day, once its period has ended,
// and every minute while it waits on a payment (one that failed, a renewal or more slots being paid, a plan being set up),
// so a payment made counts without its webhook; if Stripe doesn't answer, what's kept stands.
async function billingState(env, c, hash) {
  let w = await c.who(hash);
  const out = { on: w.on, mode: c.mode, exempt: w.exempt, tester: w.tester, plan: null, nextPlan: null, sub: null, monthlyOk: false, block: null, owed: 0, overdue: 0, n: 0, late: 0 };
  if (!w.on) return out;
  let s = w.bill && w.bill.sub_id ? (await c.subs(hash)).find((x) => x.sub_id === w.bill.sub_id) : null;
  const waiting = (x) => !w.exempt && !x.ended_at && x.synced_at < c.now - RECONCILE_MS
    && (["past_due", "unpaid", "incomplete", "paused"].includes(x.status) || x.invoice_status === "draft" || x.invoice_status === "open");
  if (s && (w.bill.plan === "monthly" || s.status === "incomplete") && (s.synced_at < c.now - SUB_RESYNC_MS || (s.period_end && s.period_end < c.now) || waiting(s))) {
    try {
      await syncSubscription(env, c, s.sub_id, { timeout: 4000 });
      c.forget(hash); w = await c.who(hash);
      s = w.bill && w.bill.sub_id ? (await c.subs(hash)).find((x) => x.sub_id === w.bill.sub_id) : null;
    } catch (e) { console.error("billing resync", e && e.message); }
  }
  const b = w.bill;
  Object.assign(out, { exempt: w.exempt, plan: b ? b.plan : null, nextPlan: b ? b.next_plan : null, sub: s && !subEnded(s) ? subOut(s) : null });
  out.monthlyOk = out.plan === "monthly" && !!s && (s.status === "active" || s.status === "trialing");
  if (w.exempt) return out;
  Object.assign(out, await lineTotals(env, c, hash));
  if (b && b.dispute_hold) out.block = { reason: "disputed-payment", text: "A payment is disputed with your bank. Contact your seller." };
  else if (out.late) out.block = { reason: "overdue", text: `${plural(out.late, "checkout")} overdue: ${money(out.overdue)}.` };
  else if (out.plan === "monthly" && s && ["past_due", "unpaid", "incomplete", "paused"].includes(s.status) && !s.paused) out.block = { reason: "past-due", text: "Your monthly payment didn't go through." };
  else if (!out.plan && s && s.status === "incomplete") out.block = { reason: "setting-up", text: "Your monthly plan is being set up on Stripe." };
  else if (!out.plan) out.block = { reason: "no-plan", text: "Pick a plan to submit." };
  return out;
}

// The slots a monthly plan gives (10, or 25 with the extra 15) to a license billed on one: while its plan is monthly (whatever
// its subscription's state), and for 30 days after one ended with no plan picked. Null otherwise: Friends and Family and pay
// per checkout keep the limit the owner approved, or the default.
async function planSlots(env, hash) {
  if (!billingOn(env)) return null;
  const c = billCtx(env), w = await c.who(hash);
  if (!w.on || w.exempt || !w.bill || !w.bill.sub_id) return null;
  const s = (await c.subs(hash)).find((x) => x.sub_id === w.bill.sub_id);
  if (!s) return null;
  return w.bill.plan === "monthly" || (!w.bill.plan && s.ended_at && s.ended_at > c.now - 30 * 86400000) ? MONTHLY_SLOTS + EXTRA_SLOTS * s.extras : null;
}

// ---- own accounts out as slots (recorded whether billing is on or off) ----
// A batch's own accounts, read from its profiles CSVs before assigned accounts are filled in: each row with an email (a store
// login's, or Pokémon Center's checkout email), as its store, profile and the email's hash.
async function slotAccounts(files) {
  const out = [];
  for (const f of files) {
    if (f.kind !== "profiles") continue;
    const rows = parseCsv(f.text), col = (rows[0] || []).map((h) => h.replace(/^﻿/, "").trim().toLowerCase()).indexOf("email");
    const store = f.storeKey || storeKeyOfName(f.store);
    if (col < 0 || !store) continue;
    for (const r of rows.slice(1)) {
      const email = String(r[col] || "").trim();
      if (email) out.push({ store, storeName: f.store, profile: String(r[0] || "").slice(0, 80), acct: await acctHash(email) });
    }
  }
  return out;
}
// Written once the batch reached the channel, so nothing needs undoing when it doesn't.
async function recordAccounts(env, hash, batch, rows, now) {
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100).map((x) => env.DB.prepare(
    "INSERT OR IGNORE INTO billing_accounts (key_hash, store, store_name, profile, acct_hash, batch, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(hash, x.store, x.storeName, x.profile, x.acct, batch, now)));
}
// Pulled slots: an own account's window closes (by the slot's store and profile, else by its email), and a slot on an account
// the owner gave is noted, so orders on it after the pull aren't billed. `x.acct` is that account's row ({store, batch}).
async function pullAccounts(env, hash, slots, now) {
  const stmts = [];
  for (const x of slots) {
    stmts.push(env.DB.prepare("UPDATE billing_accounts SET pulled_at = ? WHERE key_hash = ? AND store_name = ? AND profile = ? AND pulled_at IS NULL").bind(now, hash, x.store, x.profile));
    const store = x.storeKey || storeKeyOfName(x.store);
    if (x.own && store) stmts.push(env.DB.prepare(`UPDATE billing_accounts SET pulled_at = ? WHERE key_hash = ? AND store = ? AND acct_hash = ? AND pulled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM billing_accounts s WHERE s.key_hash = ? AND s.store_name = ? AND s.profile = ? AND s.pulled_at = ?)`).bind(now, hash, store, await acctHash(x.own), hash, x.store, x.profile, now));
    if (x.acct) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO billing_pulled (key_hash, store, profile, batch, pulled_at) VALUES (?, ?, ?, ?, ?)").bind(hash, x.acct.store, x.profile, x.acct.batch, now));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  if (Math.random() < 0.05) await env.DB.batch([
    env.DB.prepare("DELETE FROM billing_accounts WHERE pulled_at < ?").bind(now - 120 * 86400000),
    env.DB.prepare("DELETE FROM billing_pulled WHERE pulled_at < ?").bind(now - 120 * 86400000)]);
}
// Whether an own account (by its hash) was out as one of this license's slots at that store on that day, among its windows.
const inWindow = (wins, store, acct, d) => wins.some((x) => x.store === store && x.acct_hash === acct && x.sent_at < dayStart(d) + 86400000 + TZ_SLACK_MS
  && (x.pulled_at == null || x.pulled_at >= dayStart(d) - TZ_SLACK_MS));

// A declined batch's own accounts: the lines the buyer's FAFO reported on them, unpaid, come off (cancel_src 'declined',
// so the owner can still Charge again one they did run), unless another batch of theirs had that account out that day.
async function declineLines(env, keyHash, batch) {
  const { results: lines } = await env.DB.prepare(`SELECT id, mode, store, acct_hash, order_at FROM billing_lines WHERE key_hash = ? AND source = 'buyer'
    AND paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL AND acct_hash IN (SELECT acct_hash FROM billing_accounts WHERE key_hash = ? AND batch = ?)`)
    .bind(keyHash, keyHash, batch).all();
  if (!lines.length) return;
  const { results: wins } = await env.DB.prepare(`SELECT store, acct_hash, sent_at, pulled_at FROM billing_accounts WHERE key_hash = ? AND batch <> ?
    AND acct_hash IN (SELECT acct_hash FROM billing_accounts WHERE key_hash = ? AND batch = ?)`).bind(keyHash, batch, keyHash, batch).all();
  const off = lines.filter((l) => !inWindow(wins, l.store, l.acct_hash, l.order_at)), now = Date.now();
  if (!off.length) return;
  await env.DB.batch(off.map((l) => env.DB.prepare("UPDATE billing_lines SET canceled_at = ?, cancel_src = 'declined' WHERE id = ? AND paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL")
    .bind(now, l.id)));
  for (const mode of new Set(off.map((l) => l.mode))) await expireFor(env, { mode }, off.filter((l) => l.mode === mode).map((l) => l.id));
}

// An order alert's line (the owner's FAFO saw an order on an account given to a buyer): placed from the day it was given out
// on (no day before, for billing), and not after the buyer pulled that slot. The statement, or null.
async function alertLine(env, c, a, store, orderNo, ev) {
  const d = realDay(ev.at) ? ev.at : day(c.now);
  if (a.assigned_at && a.assigned_at >= dayStart(d) + 86400000) return null;
  const w = await c.who(a.key_hash), ok = await billable(c, w, d);
  if (!ok.ok) return null;
  if ((await c.pulled(a.key_hash)).some((x) => x.store === store && x.profile === (a.profile || "") && x.batch === a.batch && x.pulled_at + TZ_SLACK_MS < dayStart(d))) return null;
  return lineStmt(env, c, { hash: a.key_hash, store, storeName: ev.storeName || a.store_name || store, orderNo, item: ev.item, qty: ev.qty, orderAt: d,
    acctHash: await acctHash(ev.account), profile: a.profile || "", source: "alert", held: ok.held });
}
// The owner's FAFO is sending order alerts: noted at most every 5 minutes, for the Billing page (and, with payments off, that
// they are: onSince).
const alertsSeen = (env, lic, now) => billingOn(env) ? env.DB.prepare(`INSERT INTO billing_config (k, v, updated_at) VALUES ('alerts_seen', ?, ?)
  ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at WHERE billing_config.updated_at < ?`).bind(JSON.stringify({ at: now, last4: lic.last4 }), now, now - 5 * 60000).run() : offSeen(env, now);

// ---- POST /submissions: who can send ----
const REFUSAL_WORDS = { "no-plan": () => "they haven't picked a plan", "past-due": () => "their monthly payment didn't go through",
  "setting-up": () => "their monthly plan is still being set up on Stripe", "disputed-payment": () => "a payment is disputed with their bank",
  overdue: (x) => `${plural(x.late, "checkout")} overdue (${money(x.overdue)})`, "over-limit": (x) => `their plan has ${x.slots} slots and they'd have ${x.on} switched on` };
// Billing on for this license and not exempt: a buyer who isn't paid up gets 402 (block), as does a monthly buyer sending
// more slots than their plan has. Nothing is recorded or posted then. The channel hears of a refusal at most every 6 hours.
async function billingGate(env, ctx, lic, b, files) {
  if (!billingOn(env)) return null;
  const c = billCtx(env), w = await c.who(lic.hash);
  if (!w.on || w.exempt) return null;
  await reconcile(env, c, lic.hash);
  const st = await billingState(env, c, lic.hash);
  const on = typeof b.on === "number" && Number.isFinite(b.on) ? Math.max(0, Math.floor(b.on)) : null;
  if (on !== null) await env.DB.prepare(`INSERT INTO billing_people (key_hash, last_on, last_on_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key_hash) DO UPDATE SET last_on = excluded.last_on, last_on_at = excluded.last_on_at, updated_at = excluded.updated_at`).bind(lic.hash, on, c.now, c.now).run();
  let billing = null, error = "";
  if (st.block) { billing = { reason: st.block.reason, due: st.owed, overdue: st.overdue, n: st.n }; error = st.block.text; }
  else if (st.monthlyOk) {
    const rows = files ? files.filter((f) => f.kind === "profiles").reduce((n, f) => n + parseCsv(f.text).length - 1, 0) : Math.floor(Number(b.slots)) || 0;
    const all = on !== null ? Math.max(on, rows) : rows, slots = st.sub.slots;
    if (all > slots) { billing = { reason: "over-limit", slots, on: all }; error = `Your plan has ${slots} slots. Switch ${all - slots} off first.`; }
  }
  if (!billing) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO billing_people (key_hash, updated_at) VALUES (?, ?)").bind(lic.hash, c.now).run();
  const claim = await env.DB.prepare("UPDATE billing_people SET refused_at = ? WHERE key_hash = ? AND (refused_at IS NULL OR refused_at < ?)").bind(c.now, lic.hash, c.now - REFUSE_NOTE_MS).run();
  if (claim.meta && claim.meta.changes) {
    const name = md(String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || (lic.username ? "@" + lic.username : `license …${lic.last4}`));
    const n = Math.floor(Number(b.slots)) || 0;
    await billNote(env, `⛔ **${name}** tried to send ${plural(n, "slot")}: ${REFUSAL_WORDS[billing.reason]({ ...st, ...billing })}${on === null ? " · on an older FAFO that can't show why: ask them to restart FAFO or reload app.fafoaco.com" : ""}`);
  }
  return json({ error, billing }, 402, NO_STORE);
}

// ---- reconcile: Stripe's answer without waiting for a webhook ----
// From GET /billing, the Submit check and /billing/checkout, at most every minute per payment: each open session is asked
// about (a paid one is fulfilled, an expired one marked). A monthly plan's lazy check is in billingState. Stripe not
// answering changes nothing.
async function reconcile(env, c, hash) {
  const { results } = await env.DB.prepare("SELECT * FROM billing_payments WHERE key_hash = ? AND mode = ? AND status = 'open' AND session_id IS NOT NULL AND (checked_at IS NULL OR checked_at < ?)")
    .bind(hash, c.mode, c.now - RECONCILE_MS).all();
  for (const p of results) {
    const claim = await env.DB.prepare("UPDATE billing_payments SET checked_at = ? WHERE id = ? AND status = 'open' AND (checked_at IS NULL OR checked_at < ?)").bind(c.now, p.id, c.now - RECONCILE_MS).run();
    if (!(claim.meta && claim.meta.changes)) continue;
    try {
      const s = await stripe(env, "GET", `/v1/checkout/sessions/${encodeURIComponent(p.session_id)}`);
      if (s.status === "complete") await fulfillSession(env, c, s);
      else if (s.status === "expired") await env.DB.prepare("UPDATE billing_payments SET status = 'expired' WHERE id = ? AND status = 'open'").bind(p.id).run();
    } catch (e) { console.error("billing reconcile", e && e.message); }
  }
  c.forget(hash);
}

// ---- fulfilling a paid session ----
// A session Stripe says is done. Monthly: the subscription is synced and the sign-up marked paid. Pay: its lines are marked
// paid (only those still owed, and only by the request that marks the payment paid), and whatever it paid for lines no
// longer owed (canceled, waived or paid another way meanwhile) is refunded. The channel hears once. {kind, state}.
async function fulfillSession(env, c, s) {
  if (typeof s === "string") s = await stripe(env, "GET", `/v1/checkout/sessions/${encodeURIComponent(s)}`);
  const payId = String(s.metadata && s.metadata.fafo_pay || s.client_reference_id || "");
  const row = payId ? await env.DB.prepare("SELECT * FROM billing_payments WHERE id = ?").bind(payId).first() : null;
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  if (s.mode === "subscription") {
    if (s.status !== "complete" || !s.subscription) return { kind: "monthly", state: s.status === "expired" ? "expired" : "processing" };
    const sub = await syncSubscription(env, c, typeof s.subscription === "string" ? s.subscription : s.subscription.id);
    if (row && paid) await env.DB.prepare("UPDATE billing_payments SET status = 'paid', paid_at = ? WHERE id = ? AND status <> 'paid'").bind(c.now, row.id).run();
    return { kind: "monthly", state: sub && (sub.status === "active" || sub.status === "trialing") ? "on" : "processing" };
  }
  if (s.status !== "complete" || s.payment_status !== "paid") return { kind: "pay", state: s.status === "expired" ? "expired" : "processing" };
  if (!row || row.kind !== "pay" || row.mode !== c.mode) return { kind: "pay", state: "paid" };
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id || null;
  const name = await billName(env, row.key_hash);
  if (s.amount_total !== row.amount || s.currency !== "usd") {
    const r = await env.DB.prepare("UPDATE billing_payments SET status = 'paid', paid_at = ?, payment_intent = ?, applied = 0 WHERE id = ? AND status <> 'paid' RETURNING id").bind(c.now, pi, row.id).first();
    if (r) await billNote(env, `⚠️ **${name}** paid ${money(s.amount_total || 0)} ${String(s.currency || "").toUpperCase()} on Stripe for an invoice of ${money(row.amount)}: nothing was marked paid. Check it in Stripe.`);
    return { kind: "pay", state: "paid" };
  }
  const [first] = await env.DB.batch([
    env.DB.prepare("UPDATE billing_payments SET status = 'paid', paid_at = ?, payment_intent = ? WHERE id = ? AND status <> 'paid' RETURNING id").bind(c.now, pi, row.id),
    env.DB.prepare(`UPDATE billing_lines SET paid_at = ?1, pay_id = ?2 WHERE id IN (SELECT value FROM json_each(?3)) AND key_hash = ?4 AND paid_at IS NULL AND canceled_at IS NULL
      AND waived_at IS NULL AND EXISTS (SELECT 1 FROM billing_payments p WHERE p.id = ?2 AND p.paid_at = ?1)`).bind(c.now, row.id, row.line_ids, row.key_hash),
  ]);
  const fresh = !!(first.results && first.results.length);
  // What it paid for: the same on every try, since a paid line never changes.
  const got = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS applied, COUNT(*) AS n FROM billing_lines WHERE pay_id = ?").bind(row.id).first();
  const refund = Math.max(0, (s.amount_total || 0) - got.applied);
  await env.DB.prepare("UPDATE billing_payments SET applied = ?, refund = ? WHERE id = ?").bind(got.applied, refund, row.id).run();
  const cur = await env.DB.prepare("SELECT refund_id, refund_err FROM billing_payments WHERE id = ?").bind(row.id).first();
  if (refund > 0 && !cur.refund_id) {
    try {
      if (!pi) throw new Error("no payment to refund");
      const had = await stripe(env, "GET", "/v1/refunds", { payment_intent: pi, limit: 20 });
      const r = (had.data || []).find((x) => x.metadata && x.metadata.fafo_pay === row.id)
        || await stripe(env, "POST", "/v1/refunds", { payment_intent: pi, amount: refund, metadata: { fafo_pay: row.id } }, { idem: `refund:${row.id}` });
      await env.DB.prepare("UPDATE billing_payments SET refund_id = ?, refund_err = NULL WHERE id = ?").bind(r.id, row.id).run();
    } catch (e) {
      console.error("billing refund", e && e.message);
      await env.DB.prepare("UPDATE billing_payments SET refund_err = ? WHERE id = ?").bind(String(e && e.message || "failed").slice(0, 300), row.id).run();
      if (!cur.refund_err) await billNote(env, `⚠️ Couldn't refund ${money(refund)} to **${name}**: refund it in Stripe.`);
    }
  }
  const k = JSON.parse(row.line_ids || "[]").length - got.n;
  if (fresh) await billNote(env, `💳 **${name}** paid ${money(s.amount_total)} for ${plural(got.n, "checkout")}${refund ? ` · refunded ${money(refund)} for ${k} canceled, waived or already paid` : ""}`);
  return { kind: "pay", state: "paid" };
}

// ---- a monthly subscription, as Stripe has it ----
// Kept in billing_subs, whatever its state; then for its license: live (active, trialing) makes it their plan (unless they
// have another live one: the newer is canceled, since Stripe allows two), with held lines it now covers canceled; ended makes
// their plan what they picked for after (pay per checkout) or none, and held lines due. It covers a period only once that
// period's invoice is paid: a renewal is made (and the subscription still active) about an hour before it's charged, and
// that charge can fail. The channel hears of each change once. Returns Stripe's subscription, or null when it's no license's.
async function syncSubscription(env, c, subId, o = {}) {
  const sub = await stripe(env, "GET", `/v1/subscriptions/${encodeURIComponent(subId)}`, { expand: ["latest_invoice"] }, { timeout: o.timeout });
  const cus = typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id;
  let hash = sub.metadata && /^[0-9a-f]{64}$/.test(sub.metadata.fafo_license || "") ? sub.metadata.fafo_license : null;
  if (!hash && cus) { const b = await env.DB.prepare("SELECT key_hash FROM billing WHERE customer_id = ? AND mode = ?").bind(cus, c.mode).first(); hash = b && b.key_hash; }
  if (!hash) return null;
  const prices = await cachedPrices(env, c.mode), items = sub.items && sub.items.data || [];
  const extras = items.filter((i) => i.price && (i.price.lookup_key === LOOKUP_EXTRA || (prices && i.price.id === prices.extra))).reduce((n, i) => n + (i.quantity || 0), 0);
  const ends = items.map((i) => i.current_period_end).filter((x) => x > 0), periodEnd = ends.length ? Math.min(...ends) * 1000 : null;
  const live = sub.status === "active" || sub.status === "trialing", paused = sub.pause_collection ? 1 : 0;
  const ended = subEnded({ status: sub.status, ended_at: sub.ended_at });
  const inv = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice && sub.latest_invoice.id || null;
  const invStatus = sub.latest_invoice && typeof sub.latest_invoice === "object" ? String(sub.latest_invoice.status || "") || null : null;
  const before = await env.DB.prepare("SELECT * FROM billing_subs WHERE sub_id = ?").bind(subId).first();
  // Paid through the end of the period once its invoice is paid (not while it's paused, when Stripe voids them); it never
  // moves on otherwise, and back only to when it ended, if it was ended before then (canceled at once in Stripe).
  await env.DB.prepare(`INSERT INTO billing_subs (sub_id, key_hash, mode, status, cancel_at_end, extras, paused, started_at, paid_through, period_end, ended_at, latest_invoice, invoice_status, synced_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?14, ?13, ?13)
    ON CONFLICT (sub_id) DO UPDATE SET status = excluded.status, cancel_at_end = excluded.cancel_at_end, extras = excluded.extras, paused = excluded.paused,
      started_at = COALESCE(billing_subs.started_at, excluded.started_at),
      paid_through = CASE WHEN excluded.ended_at IS NOT NULL AND billing_subs.paid_through > excluded.ended_at THEN excluded.ended_at
        WHEN excluded.paid_through IS NULL THEN billing_subs.paid_through WHEN billing_subs.paid_through IS NULL OR excluded.paid_through > billing_subs.paid_through
        THEN excluded.paid_through ELSE billing_subs.paid_through END,
      period_end = excluded.period_end, ended_at = excluded.ended_at, latest_invoice = excluded.latest_invoice, invoice_status = excluded.invoice_status, synced_at = excluded.synced_at`)
    .bind(subId, hash, c.mode, sub.status, sub.cancel_at_period_end ? 1 : 0, extras, paused, live ? Math.min(c.now, sub.start_date ? sub.start_date * 1000 : c.now) : null,
      live && !paused && invStatus === "paid" ? periodEnd : null, periodEnd, ended ? (sub.ended_at ? sub.ended_at * 1000 : c.now) : null, inv, c.now, invStatus).run();
  const row = await env.DB.prepare("SELECT * FROM billing_subs WHERE sub_id = ?").bind(subId).first();
  const b = await env.DB.prepare("SELECT * FROM billing WHERE key_hash = ? AND mode = ?").bind(hash, c.mode).first();
  c.forget(hash);
  const name = () => billName(env, hash);
  if (live) {
    const other = b && b.sub_id && b.sub_id !== subId ? await env.DB.prepare("SELECT * FROM billing_subs WHERE sub_id = ?").bind(b.sub_id).first() : null;
    // (One that was never paid, left being set up, doesn't count: the paid one takes its place.)
    if (other && LIVE_SUB.includes(other.status) && !other.ended_at && other.started_at != null) {
      const gone = await stripe(env, "DELETE", `/v1/subscriptions/${encodeURIComponent(subId)}`, null, { idem: `dupcancel:${subId}` });
      // It never covered anything: canceled before anyone could use it.
      await env.DB.prepare("UPDATE billing_subs SET status = ?, ended_at = ?, started_at = NULL, paid_through = NULL WHERE sub_id = ?").bind(gone.status || "canceled", c.now, subId).run();
      if (await env.DB.prepare("UPDATE billing_subs SET told = 'dup' WHERE sub_id = ? AND told IS NOT 'dup' RETURNING sub_id").bind(subId).first())
        await billNote(env, `⚠️ **${await name()}** paid for a second monthly plan; it was canceled. Refund its first payment in Stripe.`);
      return gone;
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO billing (key_hash, mode, plan, plan_at, customer_id, sub_id, updated_at) VALUES (?1, ?2, 'monthly', ?3, ?4, ?5, ?3)
        ON CONFLICT (key_hash, mode) DO UPDATE SET sub_id = excluded.sub_id, plan = 'monthly', plan_at = CASE WHEN billing.plan = 'monthly' THEN billing.plan_at ELSE excluded.plan_at END,
          next_plan = CASE WHEN billing.plan = 'monthly' THEN billing.next_plan ELSE NULL END, customer_id = COALESCE(billing.customer_id, excluded.customer_id), updated_at = excluded.updated_at`)
        .bind(hash, c.mode, c.now, cus || null, subId),
      env.DB.prepare("UPDATE billing_lines SET canceled_at = ?, cancel_src = 'covered' WHERE held_sub = ? AND paid_at IS NULL AND canceled_at IS NULL AND order_at <= ?")
        .bind(c.now, subId, day((row.paid_through || 0) + TZ_SLACK_MS)),
    ]);
  } else if (!ended && !(b && b.sub_id === subId)) {
    // Not paid up yet (being set up) or any more: theirs while they have no other, so Invoice can say so and offer its invoice.
    await env.DB.prepare(`INSERT INTO billing (key_hash, mode, customer_id, sub_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (key_hash, mode) DO UPDATE SET sub_id = excluded.sub_id, customer_id = COALESCE(billing.customer_id, excluded.customer_id), updated_at = excluded.updated_at
      WHERE billing.sub_id IS NULL OR NOT EXISTS (SELECT 1 FROM billing_subs s WHERE s.sub_id = billing.sub_id AND s.status IN ('${LIVE_SUB.join("', '")}') AND s.ended_at IS NULL)`)
      .bind(hash, c.mode, cus || null, subId, c.now).run();
  } else if (ended && b && b.sub_id === subId) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE billing SET plan = CASE WHEN next_plan = 'checkout' THEN 'checkout' ELSE NULL END, plan_at = ?1, next_plan = NULL, updated_at = ?1
        WHERE key_hash = ?2 AND mode = ?3 AND sub_id = ?4 AND plan = 'monthly'`).bind(c.now, hash, c.mode, subId),
      env.DB.prepare("UPDATE billing_lines SET held_sub = NULL, due_at = ? WHERE held_sub = ? AND paid_at IS NULL AND canceled_at IS NULL").bind(c.now + DUE_MS, subId),
    ]);
  }
  // The channel, once per change (told is claimed): started, more or fewer slots, set to end, payment failed, ended.
  const told = `${row.status}:${row.extras}:${row.cancel_at_end}`, was = before && before.told || "", [ws, wx, wc] = was.split(":");
  if (was !== "dup" && told !== was && await env.DB.prepare("UPDATE billing_subs SET told = ? WHERE sub_id = ? AND told IS NOT ? RETURNING sub_id").bind(told, subId, told).first()) {
    const slots = MONTHLY_SLOTS + EXTRA_SLOTS * row.extras, wasLive = ws === "active" || ws === "trialing";
    const out = async () => { const p = await env.DB.prepare("SELECT last_on FROM billing_people WHERE key_hash = ?").bind(hash).first(); return p && p.last_on != null ? ` · about ${plural(p.last_on, "slot")} out` : ""; };
    let msg = "";
    if (live && !wasLive && ws !== "past_due" && ws !== "unpaid") msg = `🗓️ **${await name()}** started the monthly plan (${slots} slots)`;
    else if (live && wasLive && String(row.extras) !== wx) msg = `🗓️ **${await name()}**'s monthly plan is now ${slots} slots`;
    else if (live && wasLive && row.cancel_at_end && wc !== "1") msg = `🗓️ **${await name()}**'s monthly plan will end <t:${Math.floor((row.period_end || c.now) / 1000)}:D>`;
    else if ((row.status === "past_due" || row.status === "unpaid") && !ended && ws !== "past_due" && ws !== "unpaid") msg = `⚠️ **${await name()}**'s monthly payment failed${await out()}`;
    else if (ended && row.started_at && b && b.sub_id === subId) {
      const pl = await env.DB.prepare("SELECT plan FROM billing WHERE key_hash = ? AND mode = ?").bind(hash, c.mode).first();
      msg = `🗓️ **${await name()}**'s monthly plan ended · ${pl && pl.plan === "checkout" ? "pay per checkout" : "no plan"}${await out()}`;
    }
    if (msg) await billNote(env, msg);
  }
  return sub;
}

// Stripe's ids for the monthly plan's prices, kept per mode; made the first time they're needed (products with fixed ids,
// prices found again by their lookup keys). `n`: made again after Stripe said it no longer has them (a new idempotency key,
// or Stripe would answer with the one that's gone).
async function cachedPrices(env, mode) {
  const row = await env.DB.prepare("SELECT v FROM billing_config WHERE k = ?").bind("prices:" + mode).first();
  try { const v = row && JSON.parse(row.v); return v && v.base && v.extra ? v : null; } catch { return null; }
}
async function ensurePrices(env, c, call, n = 0) {
  const kept = await cachedPrices(env, c.mode);
  if (kept) return kept;
  const list = await call("GET", "/v1/prices", { lookup_keys: [LOOKUP_BASE, LOOKUP_EXTRA], limit: 10 });
  const found = Object.fromEntries((list.data || []).map((p) => [p.lookup_key, p.id]));
  const make = async (lookup, product, name, amount) => {
    try { await call("POST", "/v1/products", { id: product, name }); }
    catch (e) { if (!(e instanceof StripeError && e.code === "resource_already_exists")) throw e; }
    return (await call("POST", "/v1/prices", { product, unit_amount: amount, currency: "usd", recurring: { interval: "month" }, lookup_key: lookup }, { idem: `price:${c.mode}:${lookup}${n ? ":" + n : ""}` })).id;
  };
  const v = { base: found[LOOKUP_BASE] || await make(LOOKUP_BASE, PRODUCT_BASE, "FAFO monthly plan (10 slots)", PRICE_MONTHLY),
    extra: found[LOOKUP_EXTRA] || await make(LOOKUP_EXTRA, PRODUCT_EXTRA, "FAFO extra 15 slots", PRICE_EXTRA) };
  await env.DB.prepare("INSERT INTO billing_config (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at")
    .bind("prices:" + c.mode, JSON.stringify(v), c.now).run();
  return v;
}
const dropPrices = (env, mode) => env.DB.prepare("DELETE FROM billing_config WHERE k = ?").bind("prices:" + mode).run();
// One Stripe customer per license and mode, made the first time it's needed (`n` as for ensurePrices).
async function customerFor(env, c, lic, call, n = 0) {
  const b = await env.DB.prepare("SELECT customer_id FROM billing WHERE key_hash = ? AND mode = ?").bind(lic.hash, c.mode).first();
  if (b && b.customer_id) return b.customer_id;
  const cus = await call("POST", "/v1/customers", { name: lic.username || `License …${lic.last4}`, metadata: { fafo_license: lic.hash } }, { idem: `cus:${c.mode}:${lic.hash}${n ? ":" + n : ""}` });
  await env.DB.prepare(`INSERT INTO billing (key_hash, mode, customer_id, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key_hash, mode) DO UPDATE SET customer_id = COALESCE(billing.customer_id, excluded.customer_id), updated_at = excluded.updated_at`).bind(lic.hash, c.mode, cus.id, c.now).run();
  return (await env.DB.prepare("SELECT customer_id FROM billing WHERE key_hash = ? AND mode = ?").bind(lic.hash, c.mode).first()).customer_id;
}
const dropCustomer = (env, c, hash) => env.DB.prepare("UPDATE billing SET customer_id = NULL WHERE key_hash = ? AND mode = ?").bind(hash, c.mode).run();
// A customer or price Stripe no longer has (deleted in the Dashboard, or with a sandbox's test data) is made again, once:
// `fn(n)` with n = 0, then 1 after the one that's gone is forgotten.
async function remade(env, c, hash, fn) {
  try { return await fn(0); }
  catch (e) {
    if (missing(e, "customer")) await dropCustomer(env, c, hash);
    else if (missing(e, "price")) await dropPrices(env, c.mode);
    else throw e;
    return fn(1);
  }
}

// ---- buyer routes ----
// The license as premiumGet reads it (one look at each list): a key not in this database while the list of keys made by hand
// can't be read is unknown (503, so the page keeps its last answer), not refused.
async function billingLicense(request, env) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  const norm = m ? m[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!/^PVLT[A-Z0-9]{16}$/.test(norm)) return { error: json({ error: "license not recognized" }, 401, NO_STORE) };
  const hash = await keyHash(norm);
  const row = await env.DB.prepare("SELECT discord_id, username, revoked_at FROM licenses WHERE key_hash = ?").bind(hash).first();
  const on = row ? !row.revoked_at : await ghListHas(env, hash);
  if (on === null) return { error: json({ error: "the list of keys made by hand can't be read just now" }, 503, NO_STORE) };
  if (!on) return { error: json({ error: "license not recognized" }, 401, NO_STORE) };
  return { lic: { hash, last4: norm.slice(-4), discordId: row ? row.discord_id : null, username: row ? row.username : null } };
}
const PRICES = { checkout: PRICE_CHECKOUT, monthly: PRICE_MONTHLY, extra: PRICE_EXTRA, monthlySlots: MONTHLY_SLOTS, extraSlots: EXTRA_SLOTS, extraMax: EXTRA_MAX, dueDays: DUE_MS / 86400000 };
// GET /billing's answer: the plan, the invoice (lines still owed, held or disputed, and the rest from the last 60 days, newest
// first), what's owed, the last day's payments, and which of their own accounts their FAFO should report checkouts on (those
// out as slots in the last 45 days, from the earliest day one was).
async function billingBody(env, c, lic) {
  const st = await billingState(env, c, lic.hash);
  if (!st.on) return { on: false };
  const out = { on: true, mode: c.mode, exempt: st.exempt, plan: st.plan, nextPlan: st.nextPlan, block: st.block, now: c.now, prices: PRICES, sub: st.sub,
    lines: [], owed: 0, overdue: 0, paid30: 0, payments: [], report: null };
  if (st.exempt) return out;
  const [lines, paid, pays, wins] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM billing_lines WHERE key_hash = ? AND mode = ? AND ((paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL) OR created_at > ?)
      ORDER BY (paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL) DESC, created_at DESC LIMIT 300`).bind(lic.hash, c.mode, c.now - 60 * 86400000),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM billing_lines WHERE key_hash = ? AND mode = ? AND paid_at > ?").bind(lic.hash, c.mode, c.now - 30 * 86400000),
    env.DB.prepare("SELECT id, kind, status, amount, refund FROM billing_payments WHERE key_hash = ? AND mode = ? AND created_at > ? ORDER BY created_at DESC LIMIT 20").bind(lic.hash, c.mode, c.now - 86400000),
    env.DB.prepare("SELECT acct_hash, MIN(sent_at) AS first FROM billing_accounts WHERE key_hash = ? AND (pulled_at IS NULL OR pulled_at > ?) GROUP BY acct_hash").bind(lic.hash, c.now - 45 * 86400000),
  ]);
  out.lines = lines.results.sort((a, b) => b.created_at - a.created_at).map((l) => {
    const state = lineState(l, c.now);
    return { id: l.id, store: l.store, storeName: l.store_name, orderNo: l.order_no, item: l.item, qty: l.qty, orderAt: l.order_at, source: l.source, amount: l.amount,
      createdAt: l.created_at, dueAt: l.due_at, state, paidAt: l.paid_at, acctHash: l.acct_hash, profile: l.profile,
      disputable: l.source === "buyer" && !l.dispute_at && (state === "due" || state === "overdue") };
  });
  Object.assign(out, { owed: st.owed, overdue: st.overdue, paid30: paid.results[0].s, payments: pays.results });
  // Not from before billing came on (or on again), nor from before the owner charged them: none of those are billed.
  if (wins.results.length) {
    const from = Math.max(await c.from(), chargeFrom(c, (await c.who(lic.hash)).person)) + TZ_SLACK_MS;
    out.report = { from: day(Math.max(c.now - 45 * 86400000, Math.min(...wins.results.map((x) => x.first)) - TZ_SLACK_MS, from)), accts: wins.results.map((x) => x.acct_hash) };
  }
  return out;
}

async function billingGet(request, env) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  if (!billingOn(env)) {
    await offSeen(env, Date.now()).catch((e) => console.error("billing", e));
    return json({ on: false }, 200, NO_STORE);
  }
  const c = billCtx(env), w = await c.who(lic.hash);
  if (!w.on) return json({ on: false }, 200, NO_STORE);
  // When their FAFO last asked (the Billing page tells an older FAFO apart), once a day.
  await env.DB.prepare(`INSERT INTO billing_people (key_hash, seen_at, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT (key_hash) DO UPDATE SET seen_at = excluded.seen_at
    WHERE billing_people.seen_at IS NULL OR billing_people.seen_at < ?3`).bind(lic.hash, c.now, c.now - 86400000).run();
  if (!w.exempt) await reconcile(env, c, lic.hash);
  return json(await billingBody(env, c, lic), 200, NO_STORE);
}

// Billing on for this license, and not exempt (`family` lets a Friends and Family buyer through, for cancelling a plan paused
// for them): {c, w}, or the answer to give.
async function billingBuyer(env, lic, family) {
  const c = billCtx(env), w = await c.who(lic.hash);
  if (!c.on || !w.on) return { error: json({ error: "Your seller doesn't take payments here.", on: false }, 409, NO_STORE) };
  if (w.exempt && !(family && w.exempt === "family")) return { error: json({ error: "Your seller doesn't charge you.", exempt: w.exempt }, 409, NO_STORE) };
  return { c, w };
}
const readBody = async (request, max) => {
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text) || {}; } catch { return {}; }
};
const liveSubOf = async (env, c, w) => {
  const s = w.bill && w.bill.sub_id ? (await c.subs(w.hash)).find((x) => x.sub_id === w.bill.sub_id) : null;
  return s && !subEnded(s) ? s : null;
};

// POST /billing/plan {plan:"checkout"}: pay per checkout. From a monthly plan: one that's paid up ends at its period's end
// and they pay per checkout after; one that isn't paid up is canceled now. Stripe saying no changes nothing.
async function billingPlan(request, env) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  const b = await readBody(request, 2000);
  if (!b) return json({ error: "too large" }, 413, NO_STORE);
  if (b.plan !== "checkout") return json({ error: "plan" }, 400, NO_STORE);
  const g = await billingBuyer(env, lic, false);
  if (g.error) return g.error;
  const { c, w } = g;
  let message = "";
  try {
    const s = w.bill && w.bill.plan === "monthly" ? await liveSubOf(env, c, w) : null;
    if (s) {
      const sub = await syncSubscription(env, c, s.sub_id);
      const now = await env.DB.prepare("SELECT * FROM billing_subs WHERE sub_id = ?").bind(s.sub_id).first();
      if (sub && (now.status === "active" || now.status === "trialing")) {
        if (!now.cancel_at_end) await stripe(env, "POST", `/v1/subscriptions/${encodeURIComponent(s.sub_id)}`, { cancel_at_period_end: true });
        await env.DB.prepare("UPDATE billing SET next_plan = 'checkout', updated_at = ? WHERE key_hash = ? AND mode = ?").bind(c.now, lic.hash, c.mode).run();
        await syncSubscription(env, c, s.sub_id);
        message = `Your monthly plan ends ${day(now.period_end || c.now)}; after that you pay per checkout.`;
      } else if (sub && !subEnded(now)) {
        await stripe(env, "DELETE", `/v1/subscriptions/${encodeURIComponent(s.sub_id)}`, null, { idem: `subcancel:${s.sub_id}` });
        // What it ends into, before it's synced (which tells the channel).
        await env.DB.prepare("UPDATE billing SET next_plan = 'checkout', updated_at = ? WHERE key_hash = ? AND mode = ?").bind(c.now, lic.hash, c.mode).run();
        await syncSubscription(env, c, s.sub_id);
      }
    }
  } catch (e) {
    if (e instanceof StripeError) { console.error("billing plan", e.message); return stripeFail(e); }
    throw e;
  }
  // Pay per checkout now, unless a paid-up monthly plan runs to its end first.
  await env.DB.prepare(`INSERT INTO billing (key_hash, mode, plan, plan_at, updated_at) VALUES (?1, ?2, 'checkout', ?3, ?3)
    ON CONFLICT (key_hash, mode) DO UPDATE SET plan = 'checkout', plan_at = CASE WHEN billing.plan = 'checkout' THEN billing.plan_at ELSE excluded.plan_at END, next_plan = NULL, updated_at = excluded.updated_at
    WHERE billing.plan IS NULL OR billing.plan = 'checkout' OR (billing.next_plan IS NULL AND NOT EXISTS (SELECT 1 FROM billing_subs s WHERE s.sub_id = billing.sub_id AND s.status IN ('active', 'trialing')))`)
    .bind(lic.hash, c.mode, c.now).run();
  return json({ ...(await billingBody(env, billCtx(env), lic)), ...(message ? { message } : {}) }, 200, NO_STORE);
}

// POST /billing/checkouts {orders:[{account, store, orderNo, at, stage, item?, qty?}]}: orders on the buyer's own accounts that
// their FAFO found (1.9.130+). Placed: a line, if that account was out as one of their slots at that store on that day.
// Canceled: their reported line goes, if unpaid. Placed ones before canceled ones; the same report again adds nothing.
async function billingCheckouts(request, env, ctx) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  const b = await readBody(request, 200_000);
  if (!b) return json({ error: "too large" }, 413, NO_STORE);
  const list = Array.isArray(b.orders) ? b.orders : null;
  if (!list || !list.length || list.length > 200) return json({ error: "orders" }, 400, NO_STORE);
  const none = { ok: true, added: 0, canceled: 0, ignored: list.length };
  if (!billingOn(env)) return json(none, 200, NO_STORE);
  const c = billCtx(env), w = await c.who(lic.hash);
  if (!w.on || w.exempt) return json(none, 200, NO_STORE);
  if (!(await billCount(env, lic.hash, "report", REPORTS_PER_HOUR, 3600 * 1000, c.now))) return json({ error: "too many reports this hour" }, 429, NO_STORE);
  const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const orders = [];
  let ignored = 0, added = 0, canceled = 0, capped = false;
  for (const o of list) {
    const x = { account: clip(o && o.account, 120).toLowerCase(), store: clip(o && o.store, 64), orderNo: orderNoOf(o && o.orderNo), at: String(o && o.at || ""),
      stage: o && o.stage, item: clip(o && o.item, 120), qty: clip(o && o.qty, 6) };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.account) || !STORE_KEY.test(x.store) || !x.orderNo || !realDay(x.at) || (x.stage !== "placed" && x.stage !== "canceled")) ignored++;
    else orders.push(x);
  }
  const [today, wins] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM billing_lines WHERE key_hash = ? AND mode = ? AND source = 'buyer' AND created_at > ?").bind(lic.hash, c.mode, c.now - 86400000),
    env.DB.prepare("SELECT store, acct_hash, sent_at, pulled_at FROM billing_accounts WHERE key_hash = ?").bind(lic.hash),
  ]);
  const placed = [];
  for (const x of orders.filter((o) => o.stage === "placed")) {
    const acct = await acctHash(x.account), ok = await billable(c, w, x.at);
    if (ok.ok && inWindow(wins.results, x.store, acct, x.at)) placed.push({ x, acct, ok }); else ignored++;
  }
  // New ones only count toward the day's limit (the same report again is common).
  const had = new Set(placed.length ? (await env.DB.prepare("SELECT store, order_no FROM billing_lines WHERE key_hash = ? AND mode = ? AND order_no IN (SELECT value FROM json_each(?))")
    .bind(lic.hash, c.mode, JSON.stringify(placed.map((p) => p.x.orderNo))).all()).results.map((r) => r.store + "|" + r.order_no) : []);
  let room = BUYER_LINES_PER_DAY - today.results[0].n;
  const adds = [];
  for (const { x, acct, ok } of placed) {
    const k = x.store + "|" + x.orderNo;
    if (had.has(k)) { ignored++; continue; }
    had.add(k);
    if (room <= 0) { capped = true; ignored++; continue; }
    room--;
    adds.push(lineStmt(env, c, { hash: lic.hash, store: x.store, storeName: accountStoreName(x.store), orderNo: x.orderNo, item: x.item, qty: x.qty, orderAt: x.at,
      acctHash: acct, profile: "", source: "buyer", held: ok.held }));
  }
  for (const r of adds.length ? await env.DB.batch(adds) : []) if (r.meta && r.meta.changes) added++; else ignored++;
  const cancels = orders.filter((o) => o.stage === "canceled"), gone = [];
  (cancels.length ? await env.DB.batch(cancels.map((x) => cancelStmt(env, c, x.store, x.orderNo, lic.hash))) : []).forEach((r) => {
    const ids = (r.results || []).map((x) => x.id);
    if (ids.length) { canceled += ids.length; gone.push(...ids); } else ignored++;
  });
  if (gone.length) ctx.waitUntil(expireFor(env, c, gone));
  if (capped) {
    await env.DB.prepare("INSERT OR IGNORE INTO billing_people (key_hash, updated_at) VALUES (?, ?)").bind(lic.hash, c.now).run();
    if ((await env.DB.prepare("UPDATE billing_people SET note_at = ? WHERE key_hash = ? AND (note_at IS NULL OR note_at < ?)").bind(c.now, lic.hash, c.now - 86400000).run()).meta.changes)
      await billNote(env, `⚠️ **${await billName(env, lic.hash)}**'s FAFO reported more than ${BUYER_LINES_PER_DAY} checkouts on their own accounts today; the rest weren't added. Add any that should be from the Billing page.`);
  }
  return json({ ok: true, added, canceled, ignored }, 200, NO_STORE);
}

// POST /billing/checkout {kind, extras?, on?, web?, then?}: whatever needs Stripe. pay: a Checkout session for what's owed
// (one at a time; the same one again while it's good). monthly: a Checkout session for the plan. extras: add or remove the
// extra 15 slots. cancel / resume: a monthly plan set to end at its period's end, or not. invoice: the open invoice of a
// plan whose payment failed. {url} to open, or GET /billing's answer. `web` (the web version's address) sends the buyer back
// there after Stripe.
async function billingCheckout(request, env, ctx, url) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  const b = await readBody(request, 4000);
  if (!b) return json({ error: "too large" }, 413, NO_STORE);
  const kind = String(b.kind || "");
  if (!["pay", "monthly", "extras", "cancel", "resume", "invoice"].includes(kind)) return json({ error: "kind" }, 400, NO_STORE);
  const g = await billingBuyer(env, lic, kind === "cancel" || kind === "resume");
  if (g.error) return g.error;
  const { c } = g;
  const web = WEB_APPS.indexOf(String(b.web || "")), back = web >= 0 ? `&w=${web}` : "";
  const on = typeof b.on === "number" && Number.isFinite(b.on) ? Math.max(0, Math.floor(b.on)) : null;
  await reconcile(env, c, lic.hash);
  // Only calls that reach Stripe count toward the hour's limit (once per request).
  let counted = false;
  const call = async (...a) => {
    if (!counted) { if (!(await billCount(env, lic.hash, "stripe", STRIPE_CALLS_PER_HOUR, 3600 * 1000, c.now))) throw new BillLimit(); counted = true; }
    return stripe(env, ...a);
  };
  const body = async (status = 200, extra = {}) => json({ ...(await billingBody(env, billCtx(env), lic)), ...extra }, status, NO_STORE);
  const redirect = { success_url: `${url.origin}/billing/done?s={CHECKOUT_SESSION_ID}${back}`, cancel_url: `${url.origin}/billing/done?c=1${back}`, expires_at: Math.floor(c.now / 1000) + SESSION_TTL_S };
  try {
    const w = await c.who(lic.hash);
    if (kind === "pay" || kind === "monthly") {
      const extras = kind === "monthly" ? Math.floor(Number(b.extras)) || 0 : 0;
      let lines = [], want = "";
      if (kind === "pay") {
        const owed = () => env.DB.prepare(`SELECT id, store, store_name, order_no, amount FROM billing_lines WHERE key_hash = ? AND mode = ? AND ${OWED} AND NOT ${DISPUTED} ORDER BY created_at LIMIT 300`)
          .bind(lic.hash, c.mode).all().then((r) => r.results);
        lines = await owed();
        if (!lines.length) return body(409, { error: "Nothing to pay" });
        // A session already open: paid meanwhile (fulfilled, then what's left), still going through, still good for the same
        // lines (its link again), or replaced (expired first).
        const old = await openPayment(env, c, lic.hash, "pay");
        if (old && old.session_id) {
          const r = await settleOpen(env, c, old, call, (s) => old.line_ids === JSON.stringify(lines.map((l) => l.id)) && s.expires_at * 1000 - c.now > 5 * 60000);
          if (r.reuse) return json({ url: old.url, pay: old.id, amount: old.amount, n: lines.length }, 200, NO_STORE);
          if (r.busy) return json({ error: "Your last payment is still going through." }, 409, NO_STORE);
          if (r.paid) { lines = await owed(); if (!lines.length) return body(409, { error: "Nothing to pay" }); }
        } else if (old) return json({ error: "Try again in a moment." }, 409, NO_STORE);
        want = JSON.stringify(lines.map((l) => l.id));
      } else {
        if (on === null) return json({ error: "on" }, 400, NO_STORE);
        if (extras < 0 || extras > EXTRA_MAX) return json({ error: "extras" }, 400, NO_STORE);
        const slots = MONTHLY_SLOTS + EXTRA_SLOTS * extras;
        if (on > slots) return json({ error: `You have ${on} slots switched on; this plan covers ${slots}. Switch ${on - slots} off on Submit first.`, on, slots }, 409, NO_STORE);
        const subs = await remade(env, c, lic.hash, async (n) => call("GET", "/v1/subscriptions", { customer: await customerFor(env, c, lic, call, n), status: "all", limit: 20 }));
        const have = (subs.data || []).find((s) => s.status !== "canceled" && s.status !== "incomplete_expired");
        if (have) { await syncSubscription(env, c, have.id); return body(409, { error: "You already have a monthly plan." }); }
        const old = await openPayment(env, c, lic.hash, "monthly");
        if (old && old.session_id) {
          const r = await settleOpen(env, c, old, call, (s) => old.extras === extras && s.expires_at * 1000 - c.now > 5 * 60000);
          if (r.reuse) return json({ url: old.url, pay: old.id }, 200, NO_STORE);
          if (r.busy || r.paid) return body(409, { error: "Your monthly plan is being set up on Stripe." });
        } else if (old) return json({ error: "Try again in a moment." }, 409, NO_STORE);
      }
      // Claimed before Stripe is asked: a second request meanwhile gets this one's link (one open per kind, by the index).
      const id = randomId(12), amount = kind === "pay" ? lines.reduce((n, l) => n + l.amount, 0) : PRICE_MONTHLY + PRICE_EXTRA * extras;
      const ins = await env.DB.prepare(`INSERT OR IGNORE INTO billing_payments (id, key_hash, mode, kind, extras, line_ids, amount, status, web, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
        .bind(id, lic.hash, c.mode, kind, extras, kind === "pay" ? want : "[]", amount, web >= 0 ? web : null, c.now).run();
      if (!(ins.meta && ins.meta.changes)) {
        const win = await openPayment(env, c, lic.hash, kind);
        return win && win.url ? json({ url: win.url, pay: win.id, ...(kind === "pay" ? { amount: win.amount, n: JSON.parse(win.line_ids).length } : {}) }, 200, NO_STORE)
          : json({ error: "Try again in a moment." }, 409, NO_STORE);
      }
      try {
        // Each line at the amount it was written at (one Stripe line per amount), so what's paid is the row's amount even if
        // the price changed since.
        const groups = [...lines.reduce((m, l) => m.set(l.amount, [...(m.get(l.amount) || []), l]), new Map())];
        const s = await remade(env, c, lic.hash, async (n) => {
          const customer = await customerFor(env, c, lic, call, n);
          const prices = kind === "monthly" ? await ensurePrices(env, c, call, n) : null;
          const params = kind === "pay"
            ? { mode: "payment", customer, line_items: groups.map(([unit, ls]) => ({ price_data: { currency: "usd", unit_amount: unit, product_data: { name: "FAFO checkouts",
                description: `${plural(ls.length, "checkout")}: ${ls.map((l) => `${l.store_name || accountStoreName(l.store)} #${l.order_no}`).join(", ")}`.slice(0, 500) } }, quantity: ls.length })),
                payment_intent_data: { metadata: { fafo_pay: id } } }
            : { mode: "subscription", customer, line_items: [{ price: prices.base, quantity: 1 }, ...(extras ? [{ price: prices.extra, quantity: 1 }] : [])],
                subscription_data: { metadata: { fafo_license: lic.hash } } };
          return call("POST", "/v1/checkout/sessions", { ...params, allowed_payment_method_types: PAY_METHODS, client_reference_id: id, metadata: { fafo_license: lic.hash, fafo_pay: id }, ...redirect },
            { idem: `${kind}:${id}${n ? ":" + n : ""}` });
        });
        await env.DB.prepare("UPDATE billing_payments SET session_id = ?, url = ?, expires_at = ? WHERE id = ?").bind(s.id, s.url, (s.expires_at || 0) * 1000, id).run();
        return json(kind === "pay" ? { url: s.url, pay: id, amount, n: lines.length } : { url: s.url, pay: id }, 200, NO_STORE);
      } catch (e) {
        await env.DB.prepare("UPDATE billing_payments SET status = 'failed' WHERE id = ?").bind(id).run();
        throw e;
      }
    }
    const st = await billingState(env, c, lic.hash), s = await liveSubOf(env, c, w);
    if (!s) return body(409, { error: "You don't have a monthly plan." });
    const path = `/v1/subscriptions/${encodeURIComponent(s.sub_id)}`;
    if (kind === "extras") {
      if (!st.monthlyOk) return body(409, { error: "Your monthly plan needs to be paid up for that." });
      const want = Math.floor(Number(b.extras)) || 0;
      if (want < 0 || want > EXTRA_MAX) return json({ error: "extras" }, 400, NO_STORE);
      if (want < s.extras) {
        if (on === null) return json({ error: "on" }, 400, NO_STORE);
        if (on > MONTHLY_SLOTS) return json({ error: `You have ${on} slots switched on. Switch ${on - MONTHLY_SLOTS} off first.`, on, slots: MONTHLY_SLOTS }, 409, NO_STORE);
        const prices = await cachedPrices(env, c.mode), cur = await call("GET", path);
        const item = (cur.items && cur.items.data || []).find((i) => i.price && (i.price.lookup_key === LOOKUP_EXTRA || (prices && i.price.id === prices.extra)));
        if (item) await call("POST", path, { items: [{ id: item.id, deleted: true }], proration_behavior: "create_prorations" });
      } else if (want > s.extras) {
        // Charged now for the rest of the month; a card that needs the buyer (3D Secure) waits on its invoice's page.
        const sub = await call("POST", path, { items: [{ price: (await ensurePrices(env, c, call)).extra, quantity: 1 }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" });
        if (sub.pending_update) {
          const inv = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice && sub.latest_invoice.id;
          const i = inv ? await call("GET", `/v1/invoices/${encodeURIComponent(inv)}`) : null;
          if (i && i.hosted_invoice_url) return json({ url: i.hosted_invoice_url }, 200, NO_STORE);
        }
      }
      await syncSubscription(env, c, s.sub_id);
      return body();
    }
    if (kind === "cancel" || kind === "resume") {
      await call("POST", path, { cancel_at_period_end: kind === "cancel" });
      await env.DB.prepare("UPDATE billing SET next_plan = ?, updated_at = ? WHERE key_hash = ? AND mode = ?")
        .bind(kind === "cancel" && b.then === "checkout" ? "checkout" : null, c.now, lic.hash, c.mode).run();
      await syncSubscription(env, c, s.sub_id);
      return body();
    }
    // invoice: the oldest open invoice of a plan whose payment failed (or that's being set up), to pay on Stripe's page.
    const open = await call("GET", "/v1/invoices", { subscription: s.sub_id, status: "open", limit: 10 });
    const inv = (open.data || []).filter((i) => i.hosted_invoice_url).sort((x, y) => x.created - y.created)[0];
    if (inv) return json({ url: inv.hosted_invoice_url }, 200, NO_STORE);
    await syncSubscription(env, c, s.sub_id);
    return body();
  } catch (e) {
    if (e instanceof BillLimit) return json({ error: "Too many tries this hour. Try again later." }, 429, NO_STORE);
    if (e instanceof StripeError) { console.error("billing checkout", kind, e.message); return stripeFail(e); }
    throw e;
  }
}
const openPayment = async (env, c, hash, kind) => {
  // A claim whose session was never made (its worker stopped) stops holding the place after 2 minutes.
  await env.DB.prepare("UPDATE billing_payments SET status = 'failed' WHERE key_hash = ? AND mode = ? AND kind = ? AND status = 'open' AND url IS NULL AND created_at < ?")
    .bind(hash, c.mode, kind, c.now - 120000).run();
  return env.DB.prepare("SELECT * FROM billing_payments WHERE key_hash = ? AND mode = ? AND kind = ? AND status = 'open'").bind(hash, c.mode, kind).first();
};
// An open session asked about before another is made: {reuse} (still good: `good(session)`), {busy} (paid but still going
// through), {paid} (fulfilled now), or {} once it's expired (marked only once Stripe says so).
async function settleOpen(env, c, p, call, good) {
  let s = await call("GET", `/v1/checkout/sessions/${encodeURIComponent(p.session_id)}`);
  if (s.status === "open" && good(s)) return { reuse: true };
  if (s.status === "open") {
    try { s = await call("POST", `/v1/checkout/sessions/${encodeURIComponent(p.session_id)}/expire`); }
    catch (e) { if (!(e instanceof StripeError && e.status >= 400 && e.status < 500)) throw e; s = await call("GET", `/v1/checkout/sessions/${encodeURIComponent(p.session_id)}`); }
  }
  if (s.status === "complete") {
    if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { busy: true };
    await fulfillSession(env, c, s);
    return { paid: true };
  }
  if (s.status !== "expired") return { busy: true };
  await env.DB.prepare("UPDATE billing_payments SET status = 'expired' WHERE id = ? AND status = 'open'").bind(p.id).run();
  return {};
}

// POST /billing/dispute {id, note}: "Not my seller's checkout?" on a line their FAFO reported. It still counts as owed, never
// as overdue, until the owner answers (Waive or Keep) from the Billing page, whose link the channel gets with the note.
async function billingDispute(request, env, ctx, url) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  const b = await readBody(request, 4000);
  if (!b) return json({ error: "too large" }, 413, NO_STORE);
  const g = await billingBuyer(env, lic, false);
  if (g.error) return g.error;
  const { c } = g;
  const l = /^[A-Za-z0-9_-]{8,40}$/.test(String(b.id || "")) ? await env.DB.prepare("SELECT * FROM billing_lines WHERE id = ? AND key_hash = ? AND mode = ?").bind(b.id, lic.hash, c.mode).first() : null;
  if (!l || l.source !== "buyer" || l.paid_at || l.canceled_at || l.waived_at || l.held_sub || l.dispute_at) return json({ error: "That checkout can't be disputed." }, 409, NO_STORE);
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM billing_lines WHERE key_hash = ? AND mode = ? AND ${DISPUTED} AND paid_at IS NULL AND waived_at IS NULL AND canceled_at IS NULL`).bind(lic.hash, c.mode).first();
  if (open && open.n >= DISPUTES_OPEN_MAX) return json({ error: `You have ${DISPUTES_OPEN_MAX} waiting for your seller already.` }, 429, NO_STORE);
  if (!(await billCount(env, lic.hash, "dispute", DISPUTES_PER_DAY, 86400000, c.now))) return json({ error: "too many today" }, 429, NO_STORE);
  const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const r = await env.DB.prepare("UPDATE billing_lines SET dispute_at = ?, dispute_note = ? WHERE id = ? AND dispute_at IS NULL AND paid_at IS NULL").bind(c.now, note, l.id).run();
  if (r.meta && r.meta.changes) {
    const { link } = await billingListLink(env, lic, url.origin, "", c.now);
    await billNote(env, `❓ **${await billName(env, lic.hash)}** says ${md(l.store_name || accountStoreName(l.store))} #${md(l.order_no)} (${l.order_at}) wasn't your checkout${note ? `: "${md(note)}"` : ""} · [Answer](${link}&b=${lic.hash.slice(0, 16)})`);
  }
  return json(await billingBody(env, billCtx(env), lic), 200, NO_STORE);
}

// GET /billing/done: where Stripe sends the buyer back (no license needed). A paid session is fulfilled at once.
async function billingDone(env, url) {
  const i = /^\d$/.test(url.searchParams.get("w") || "") ? WEB_APPS[Number(url.searchParams.get("w"))] : "";
  const msg = i ? "You can close this tab and go back to FAFO." : "Go back to the FAFO app. It updates by itself.", back = i ? backToWeb(i) : "";
  if (url.searchParams.get("c")) return page(200, "No payment was made", msg, back);
  const id = url.searchParams.get("s") || "";
  let r = null;
  if (billingOn(env) && /^cs_[A-Za-z0-9_]{6,200}$/.test(id)) { try { r = await fulfillSession(env, billCtx(env), id); } catch (e) { console.error("billing done", e && e.message); } }
  return page(200, r && r.state === "paid" ? "Payment received" : r && r.state === "on" ? "Your monthly plan is on" : "Payment is processing", msg, back);
}

// ---- POST /stripe/webhook ----
// Signed with the endpoint's secret (Stripe-Signature: t=…,v1=…, HMAC-SHA256 of "t.body", any v1, within 5 minutes). Every
// valid delivery runs: each handler asks Stripe again and writes only what changes, so a repeat does nothing. A Stripe or D1
// error answers 500 (Stripe tries again); an object that's no license's, or that Stripe no longer has, 200.
async function stripeSigned(env, header, raw, now) {
  let t = "";
  const v1 = [];
  for (const part of String(header).split(",")) {
    const i = part.indexOf("="), k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v; else if (k === "v1" && v) v1.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || !v1.length || Math.floor(now / 1000) - Number(t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`))), (x) => x.toString(16).padStart(2, "0")).join("");
  let ok = false;
  for (const v of v1) if (await sameText(v, mac)) ok = true;
  return ok;
}
async function stripeWebhook(request, env) {
  if (!billingOn(env)) return json({ error: "payments aren't set up" }, 503);
  const raw = await request.text();
  if (raw.length > 1_000_000) return json({ error: "too large" }, 413);
  const c = billCtx(env);
  if (!(await stripeSigned(env, request.headers.get("stripe-signature") || "", raw, c.now))) return json({ error: "bad signature" }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: "bad event" }, 400); }
  if (!!ev.livemode !== (c.mode === "live")) return json({ received: true });
  try { await stripeEvent(env, c, ev); }
  catch (e) {
    if (e instanceof StripeError && (e.code === "resource_missing" || e.status === 404)) return json({ received: true });
    console.error("stripe webhook", ev.type, e && e.message);
    return json({ error: "try again" }, 500);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, type, created_at) VALUES (?, ?, ?)").bind(String(ev.id || randomId(12)).slice(0, 100), String(ev.type || "").slice(0, 100), c.now)
    .run().catch((e) => console.error("billing events", e));
  return json({ received: true });
}
// A payment's license: its payment row (by the PaymentIntent, or the PaymentIntent's fafo_pay), else the Stripe customer's.
async function licenseOfPayment(env, c, pi, customer) {
  if (pi) {
    const p = await env.DB.prepare("SELECT key_hash FROM billing_payments WHERE payment_intent = ? AND mode = ?").bind(pi, c.mode).first();
    if (p) return p.key_hash;
    if (!customer) {
      const intent = await stripe(env, "GET", `/v1/payment_intents/${encodeURIComponent(pi)}`);
      const q = intent.metadata && intent.metadata.fafo_pay ? await env.DB.prepare("SELECT key_hash FROM billing_payments WHERE id = ?").bind(intent.metadata.fafo_pay).first() : null;
      if (q) return q.key_hash;
      customer = typeof intent.customer === "string" ? intent.customer : intent.customer && intent.customer.id;
    }
  }
  const b = customer ? await env.DB.prepare("SELECT key_hash FROM billing WHERE customer_id = ? AND mode = ?").bind(customer, c.mode).first() : null;
  return b ? b.key_hash : null;
}
async function stripeEvent(env, c, ev) {
  const o = ev.data && ev.data.object || {}, idOf = (x) => typeof x === "string" ? x : x && x.id || null;
  const seen = async () => !!(await env.DB.prepare("SELECT 1 AS s FROM billing_events WHERE id = ?").bind(String(ev.id || "")).first());
  switch (ev.type) {
    case "checkout.session.completed": case "checkout.session.async_payment_succeeded":
      return fulfillSession(env, c, String(o.id || ""));
    case "checkout.session.expired": case "checkout.session.async_payment_failed":
      return env.DB.prepare("UPDATE billing_payments SET status = ? WHERE (session_id = ? OR id = ?) AND status = 'open'")
        .bind(ev.type === "checkout.session.expired" ? "expired" : "failed", String(o.id || ""), String(o.metadata && o.metadata.fafo_pay || "")).run();
    case "customer.subscription.created": case "customer.subscription.updated": case "customer.subscription.deleted":
    case "customer.subscription.paused": case "customer.subscription.resumed":
      return syncSubscription(env, c, String(o.id || ""));
    case "invoice.paid": case "invoice.payment_failed": {
      const sub = idOf(o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      return sub ? syncSubscription(env, c, sub) : null;
    }
    case "charge.dispute.created": case "charge.dispute.closed": {
      const hash = await licenseOfPayment(env, c, idOf(o.payment_intent), null);
      if (!hash) return null;
      if (ev.type === "charge.dispute.created") {
        await env.DB.prepare("INSERT OR IGNORE INTO billing (key_hash, mode, updated_at) VALUES (?, ?, ?)").bind(hash, c.mode, c.now).run();
        const r = await env.DB.prepare("UPDATE billing SET dispute_hold = 1, updated_at = ? WHERE key_hash = ? AND mode = ? AND dispute_hold = 0 RETURNING key_hash").bind(c.now, hash, c.mode).first();
        if (r) await billNote(env, `⚠️ **${await billName(env, hash)}** disputed ${money(o.amount || 0)} with their bank. Submit is off for them until you clear it on the Billing page.`);
      } else if (!(await seen())) await billNote(env, `⚖️ **${await billName(env, hash)}**'s dispute of ${money(o.amount || 0)} was closed (${md(o.status || "closed")}). Clear their hold on the Billing page if they should submit again.`);
      return null;
    }
    case "charge.refunded": {
      const pi = idOf(o.payment_intent);
      if (!pi || await seen()) return null;
      const hash = await licenseOfPayment(env, c, pi, idOf(o.customer));
      if (!hash) return null;
      // Not for the refunds the worker made itself (what a payment paid for lines no longer owed).
      const ours = new Set((await env.DB.prepare("SELECT refund_id FROM billing_payments WHERE payment_intent = ? AND refund_id IS NOT NULL").bind(pi).all()).results.map((x) => x.refund_id));
      const theirs = ((await stripe(env, "GET", "/v1/refunds", { payment_intent: pi, limit: 20 })).data || []).filter((r) => !ours.has(r.id) && r.status !== "failed" && r.status !== "canceled")
        .sort((x, y) => y.created - x.created);
      if (theirs.length) await billNote(env, `↩️ Refunded ${money(theirs[0].amount)} to **${await billName(env, hash)}**`);
      return null;
    }
  }
  return null;
}

// ---- the owner's Billing page ----
// A link to it, posted by the owner's FAFO (POST /billing/list) or by a buyer's dispute, for 24 hours. Null if it couldn't be posted.
async function billingListLink(env, lic, origin, name, now) {
  const o = { id: randomId(12), key_hash: lic.hash, key_last4: lic.last4, username: lic.username, name, view_token: randomId(24), created_at: now };
  await env.DB.prepare("INSERT INTO billing_lists (id, key_hash, key_last4, name, username, view_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(o.id, o.key_hash, o.key_last4, o.name, o.username, o.view_token, o.created_at).run();
  return { id: o.id, link: `${origin}/billing/list/${o.id}?t=${o.view_token}` };
}
// POST /billing/list {name}: the owner's own FAFO only (the license that sends order alerts), once payments are set up (either
// mode), 10 a day.
async function billingListAsk(request, env, ctx, url) {
  const { lic, error } = await billingLicense(request, env);
  if (error) return error;
  const s = await currentAlertSender(env);
  if (!s || s.key_hash !== lic.hash) return json({ error: "Only your own FAFO can open billing" }, 403, NO_STORE);
  if (!billingOn(env)) return json({ error: "payments aren't set up" }, 503, NO_STORE);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503, NO_STORE);
  const b = await readBody(request, 2000);
  if (!b) return json({ error: "too large" }, 413, NO_STORE);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM billing_lists WHERE created_at < ?").bind(now - 7 * 86400000).run();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_lists WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 86400000).first();
  if (recent && recent.n >= BILL_LISTS_PER_DAY) return json({ error: "too many tries today" }, 429, NO_STORE);
  const o = await billingListLink(env, lic, url.origin, String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), now);
  const id = await webhookPost(env, { content: `💳 **Billing**\n[See billing](${o.link}) · the link works for 24 hours` });
  if (!id) { await env.DB.prepare("DELETE FROM billing_lists WHERE id = ?").bind(o.id).run(); return json({ error: "couldn't post to the channel" }, 502, NO_STORE); }
  return json({ status: "sent" }, 200, NO_STORE);
}
// A line of the bot's success log, pasted on the Billing page: an email, an order number (a word with a digit, 6 to 25 long,
// that isn't the email or the date), a store's name (else the store picked), and a date (YYYY-MM-DD, M/D or M/D/YY, else the
// date picked).
function pasteLine(line, store, date) {
  const text = String(line).replace(/\s+/g, " ").trim(), plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const email = (text.match(/[^\s@<>()"',;:|]+@[^\s@<>()"',;:|]+\.[A-Za-z]{2,}/) || [""])[0];
  let rest = email ? text.replace(email, " ") : text, d = date;
  const iso = rest.match(/\b\d{4}-\d{2}-\d{2}\b/), us = !iso && rest.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/);
  if (iso) { d = iso[0]; rest = rest.replace(iso[0], " "); }
  else if (us) { d = `${us[3] ? (us[3].length === 2 ? "20" + us[3] : us[3]) : date.slice(0, 4)}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`; rest = rest.replace(us[0], " "); }
  const order = rest.split(/[\s,;|]+/).map((x) => x.replace(/^[#(\[]+|[)\].:]+$/g, "")).find((x) => /\d/.test(x) && x.length >= 6 && x.length <= 25 && /^[A-Za-z0-9-]+$/.test(x)) || "";
  return { text: text.slice(0, 300), email: email.toLowerCase(), store: /pokemon/i.test(plain) ? "pokemoncenter" : /\btarget\b/i.test(plain) ? "target" : store,
    date: realDay(d) ? d : "", orderNo: orderNoOf(order) };
}
// The buyers who had that email out at that store that day: as their own account (a slot's login or checkout email) or as an
// account the owner gave them (sent, and not pulled before that day, as for order alerts). The email is only hashed for the
// first; the second is the owner's own list.
async function pasteMatches(env, x) {
  if (!x.email || !x.orderNo || !x.date) return [];
  const acct = await acctHash(x.email), start = dayStart(x.date);
  const [own, given] = await env.DB.batch([
    env.DB.prepare("SELECT key_hash, profile FROM billing_accounts WHERE acct_hash = ? AND store = ? AND sent_at < ? AND (pulled_at IS NULL OR pulled_at >= ?)")
      .bind(acct, x.store, start + 86400000 + TZ_SLACK_MS, start - TZ_SLACK_MS),
    env.DB.prepare(`SELECT a.key_hash, a.profile FROM accounts a WHERE a.email_norm = ?1 AND a.store = ?2 AND a.key_hash IS NOT NULL AND a.sent_at IS NOT NULL AND a.assigned_at < ?3
      AND NOT EXISTS (SELECT 1 FROM billing_pulled p WHERE p.key_hash = a.key_hash AND p.store = a.store AND p.profile = COALESCE(a.profile, '') AND p.batch = a.batch AND p.pulled_at + ?4 < ?5)`)
      .bind(x.email, x.store, start + 86400000, TZ_SLACK_MS, start),
  ]);
  const m = new Map();
  for (const r of [...own.results, ...given.results]) if (!m.has(r.key_hash)) m.set(r.key_hash, { hash: r.key_hash, profile: r.profile || "", acct });
  return [...m.values()];
}
const WHY_TEXT = { off: "Billing is off for them (test mode)", owner: "Your FAFO", family: "Friends and Family", before: "Before billing started", monthly: "Monthly plan, not billed",
  charge: "From before you charged them (Friends and Family then)" };
// Whether an order the owner adds would go on that buyer's invoice: {ok, held} or {why} in words. Their own report of it is
// taken over, unless it's paid, waived, or their FAFO said the store canceled it (Charge again on their invoice undoes that).
async function ownerOutcome(env, c, hash, x) {
  const ok = await billable(c, await c.who(hash), x.date);
  if (!ok.ok) return { why: WHY_TEXT[ok.why] || ok.why };
  const { results } = await env.DB.prepare("SELECT key_hash, source, paid_at, waived_at, canceled_at FROM billing_lines WHERE mode = ? AND store = ? AND order_no = ?").bind(c.mode, x.store, x.orderNo).all();
  const mine = results.find((l) => l.key_hash === hash);
  if (mine && (mine.source !== "buyer" || mine.paid_at || mine.waived_at)) return { why: "Already on the invoice" };
  if (mine && mine.canceled_at) return { why: "Canceled by the store, their FAFO said" };
  if (results.some((l) => l.key_hash !== hash && l.source !== "buyer")) return { why: "On another buyer's invoice" };
  return { ok: true, held: ok.held };
}

const SOURCE_TEXT = { alert: "Account you gave", buyer: "Their account", owner: "Added by you" };
const STATE_TEXT = { paid: "Paid", canceled: "Canceled · no charge", covered: "Covered by their monthly plan", waived: "Waived", held: "On hold", disputed: "Disputed", overdue: "Overdue", due: "Due" };
const STATE_COLOR = { paid: "#5fd39a", overdue: "#ff8a80", disputed: "#9cc7ff", due: "#ffd27a" };
// The page (24 hours): what's owed, every buyer with their plan, a buyer's invoice (?b=: their key's hash, first 16), and the
// bot's success log pasted to add checkouts. Views answer GET; changes only POST, then back to the view (303), so reloading
// doesn't send them again. Never a whole key, and pasted emails are only matched, never kept.
async function billingListPage(request, env, ctx, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM billing_lists WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", form = null;
  if (request.method === "POST") {
    form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.view_token))) return page(404, "Not found", "This link isn't valid.");
  const now = Date.now();
  if (now > o.created_at + BILL_LIST_TTL_MS) return page(410, "Billing", "This link has expired. Ask again from FAFO: Settings → Billing.");
  if (!billingOn(env)) return page(503, "Billing", "Payments aren't set up: the Stripe keys aren't there.");
  const c = billCtx(env, now);
  const get = (k) => String((form ? form.get(k) : url.searchParams.get(k)) ?? "");
  const action = form ? get("action") : "", bq = get("b").replace(/[^0-9a-f]/g, "").slice(0, 16);
  const key = /^[0-9a-f]{64}$/.test(get("key")) ? get("key") : "", lineId = get("line").slice(0, 40);
  const today = day(now), date = realDay(get("date")) ? get("date") : today, pickStore = get("store") === "pokemoncenter" ? "pokemoncenter" : "target";
  let done = "", err = "", preview = null;
  const lineOf = async () => lineId ? env.DB.prepare("SELECT * FROM billing_lines WHERE id = ? AND mode = ?").bind(lineId, c.mode).first() : null;
  const known = async (h) => !!h && !!(await env.DB.prepare(`SELECT 1 AS k FROM licenses WHERE key_hash = ?1 AND revoked_at IS NULL UNION ALL SELECT 1 FROM billing_people WHERE key_hash = ?1
    UNION ALL SELECT 1 FROM billing WHERE key_hash = ?1`).bind(h).first());
  if (form) {
    if ((action === "family" || action === "charge") && await known(key)) {
      // A live monthly plan stops being charged while they're Friends and Family (Stripe pauses its collection), and starts
      // again when they're charged; if Stripe says no, nothing changes.
      const b = await env.DB.prepare("SELECT sub_id FROM billing WHERE key_hash = ? AND mode = ?").bind(key, c.mode).first();
      const s = b && b.sub_id ? await env.DB.prepare("SELECT * FROM billing_subs WHERE sub_id = ?").bind(b.sub_id).first() : null;
      try {
        if (s && !subEnded(s)) {
          await stripe(env, "POST", `/v1/subscriptions/${encodeURIComponent(s.sub_id)}`, { pause_collection: action === "family" ? { behavior: "void" } : "" });
          await syncSubscription(env, c, s.sub_id).catch((e) => console.error("billing sync", e && e.message));
        }
        // Charged from now on: orders from while they were Friends and Family aren't billed (chargeFrom). A second Charge keeps the first's time.
        await env.DB.prepare(`INSERT INTO billing_people (key_hash, family, charge_from, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (key_hash) DO UPDATE SET family = excluded.family,
          charge_from = CASE WHEN excluded.charge_from IS NULL OR billing_people.family = 0 THEN billing_people.charge_from ELSE excluded.charge_from END, updated_at = excluded.updated_at`)
          .bind(key, action === "family" ? 1 : 0, action === "charge" ? now : null, now).run();
        done = action === "family" ? "They're Friends and Family now: never charged, and Submit is never off for them."
          : "They're charged now, like any buyer approved after payments began, for checkouts from now on.";
        if (s && !subEnded(s)) done += action === "family" ? " Stripe stopped charging their monthly plan." : " Stripe charges their monthly plan again.";
      } catch (e) { err = e instanceof StripeError ? `Stripe said no: ${e.message}` : "That didn't work. Try again."; if (!(e instanceof StripeError)) console.error("billing", e); }
    } else if ((action === "tester" || action === "untester") && await known(key)) {
      // In test mode, billing reaches a Tester from now on (unless the owner charged them already, from then).
      const from = action === "tester" && c.mode === "test" ? now : null;
      await env.DB.prepare(`INSERT INTO billing_people (key_hash, tester, charge_from, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (key_hash) DO UPDATE SET tester = excluded.tester,
        charge_from = CASE WHEN excluded.charge_from IS NULL OR billing_people.family = 0 THEN billing_people.charge_from ELSE excluded.charge_from END, updated_at = excluded.updated_at`)
        .bind(key, action === "tester" ? 1 : 0, from, now).run();
      done = action === "tester" ? "Marked as a tester: in test mode they pick a plan and pay with Stripe's test cards." : "Not a tester any more.";
    } else if (action === "clear-hold" && await known(key)) {
      await env.DB.prepare("UPDATE billing SET dispute_hold = 0, updated_at = ? WHERE key_hash = ? AND mode = ?").bind(now, key, c.mode).run();
      done = "Hold cleared: they can submit again.";
    } else if (["waive", "unwaive", "mark-paid", "charge-again", "dispute-waive", "dispute-keep"].includes(action)) {
      const l = await lineOf();
      const sql = {
        waive: ["UPDATE billing_lines SET waived_at = ?1 WHERE id = ?2 AND paid_at IS NULL AND canceled_at IS NULL AND waived_at IS NULL", "Waived."],
        unwaive: ["UPDATE billing_lines SET waived_at = NULL, dispute_answer = CASE WHEN dispute_answer = 'waived' THEN NULL ELSE dispute_answer END WHERE id = ?2 AND paid_at IS NULL AND waived_at IS NOT NULL AND ?1 > 0", "Waive undone: it's owed again."],
        "mark-paid": ["UPDATE billing_lines SET paid_at = ?1, pay_id = 'manual' WHERE id = ?2 AND paid_at IS NULL AND canceled_at IS NULL", "Marked paid."],
        "charge-again": [`UPDATE billing_lines SET canceled_at = NULL, cancel_src = NULL, held_sub = NULL, due_at = ?1 + ${DUE_MS} WHERE id = ?2 AND paid_at IS NULL AND canceled_at IS NOT NULL
          AND COALESCE(cancel_src, '') <> 'covered'`, "It's owed again, due in 3 days."],
        "dispute-waive": [`UPDATE billing_lines SET dispute_answer = 'waived', waived_at = ?1 WHERE id = ?2 AND ${DISPUTED} AND paid_at IS NULL`, "Waived: not their checkout."],
        "dispute-keep": [`UPDATE billing_lines SET dispute_answer = 'kept', due_at = MAX(due_at, ?1 + ${DUE_MS}) WHERE id = ?2 AND ${DISPUTED} AND paid_at IS NULL`, "Kept: it's owed, due in 3 days at the earliest."],
      }[action];
      const r = l ? await env.DB.prepare(sql[0]).bind(now, l.id).run() : null;
      if (r && r.meta && r.meta.changes) {
        done = sql[1];
        if (["waive", "mark-paid", "dispute-waive"].includes(action)) ctx.waitUntil(expireFor(env, c, [l.id]));
      } else err = "That checkout changed meanwhile, so nothing was done.";
    } else if (action === "add" && await known(key)) {
      // Add a checkout: the owner's word, so no slot has to have been out; exemption and plans still count.
      const x = { store: pickStore, orderNo: orderNoOf(get("order")), date: realDay(get("date")) ? get("date") : "" };
      const item = [get("item"), get("note")].map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
      if (!x.orderNo || !x.date) err = "Fill in the order number and its date.";
      else {
        const out = await ownerOutcome(env, c, key, x);
        if (!out.ok) err = `Not added: ${out.why.toLowerCase().replace(/\bfafo\b/g, "FAFO")}.`;
        else {
          const r = await lineStmt(env, c, { hash: key, store: x.store, storeName: accountStoreName(x.store), orderNo: x.orderNo, item, qty: "", orderAt: x.date, source: "owner", held: out.held }).run();
          if (r.meta && r.meta.changes) done = `Added ${accountStoreName(x.store)} #${x.orderNo} to their invoice.`; else err = "Not added: already on the invoice.";
        }
      }
    } else if (action === "paste-preview" || action === "paste-add") {
      const lines = get("paste").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
      const rows = [];
      for (const [i, text] of lines.entries()) {
        const x = pasteLine(text, pickStore, date), m = await pasteMatches(env, x), pick = get("pick" + i);
        const chosen = m.length === 1 ? m[0] : m.find((y) => y.hash === pick) || null;
        rows.push({ i, x, m, chosen, out: !x.email || !x.orderNo || !x.date ? { why: !x.email ? "No email in this line" : !x.orderNo ? "No order number in this line" : "No date" }
          : !m.length ? { why: "No slot out with this email on that date" } : !chosen ? { why: "Pick a buyer" } : await ownerOutcome(env, c, chosen.hash, x) });
      }
      if (action === "paste-preview") preview = { rows, paste: get("paste"), store: pickStore, date };
      else {
        let added = 0;
        for (const r of rows.filter((y) => y.out.ok)) {
          const res = await lineStmt(env, c, { hash: r.chosen.hash, store: r.x.store, storeName: accountStoreName(r.x.store), orderNo: r.x.orderNo, item: "", qty: "", orderAt: r.x.date,
            acctHash: r.chosen.acct, profile: r.chosen.profile, source: "owner", held: r.out.held }).run();
          if (res.meta && res.meta.changes) added++;
        }
        done = `Added ${plural(added, "checkout")}.`;
        if (rows.length > added) err = `${plural(rows.length - added, "line")} weren't added (preview them to see why).`;
      }
    }
    // After a change, back to the view by its link (303), with what happened.
    if (action !== "paste-preview") {
      const q = new URLSearchParams({ t });
      if (bq) q.set("b", bq);
      if (done) q.set("done", done);
      if (err) q.set("err", err);
      return new Response(null, { status: 303, headers: { location: `${url.pathname}?${q}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    }
  } else { done = get("done").slice(0, 600); err = get("err").slice(0, 600); }

  const [lics, people, bills, subs, totals, named, paid30, seenRow] = await env.DB.batch([
    env.DB.prepare("SELECT username, license_key, key_hash, issued_at, revoked_at FROM licenses"),
    env.DB.prepare("SELECT * FROM billing_people"),
    env.DB.prepare("SELECT * FROM billing WHERE mode = ?").bind(c.mode),
    env.DB.prepare("SELECT s.* FROM billing_subs s JOIN billing b ON b.sub_id = s.sub_id WHERE b.mode = ?").bind(c.mode),
    env.DB.prepare(`SELECT key_hash, SUM(amount) AS owed, SUM(CASE WHEN due_at < ? AND NOT ${DISPUTED} THEN amount ELSE 0 END) AS overdue FROM billing_lines WHERE mode = ? AND ${OWED} GROUP BY key_hash`).bind(now, c.mode),
    env.DB.prepare("SELECT key_hash, name, key_last4, MAX(created_at) AS at FROM submissions GROUP BY key_hash"),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM billing_lines WHERE mode = ? AND paid_at > ?").bind(c.mode, now - 30 * 86400000),
    env.DB.prepare("SELECT v FROM billing_config WHERE k = 'alerts_seen'"),
  ]);
  const since = await c.since(), sender = await c.sender();
  const L = new Map(lics.results.map((l) => [l.key_hash, l])), P = new Map(people.results.map((p) => [p.key_hash, p])), B = new Map(bills.results.map((b) => [b.key_hash, b]));
  const S = new Map(subs.results.map((s) => [s.sub_id, s])), T = new Map(totals.results.map((x) => [x.key_hash, x])), N = new Map(named.results.map((x) => [x.key_hash, x]));
  const keys = new Set([...lics.results.filter((l) => !l.revoked_at).map((l) => l.key_hash), ...P.keys(), ...B.keys(), ...T.keys()]);
  const when = (x) => new Date(x).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const buyers = [...keys].map((h) => {
    const l = L.get(h), p = P.get(h), b = B.get(h), s = b && b.sub_id ? S.get(b.sub_id) : null, tot = T.get(h) || { owed: 0, overdue: 0 }, n = N.get(h);
    const exempt = exemptOf(h, p, l, sender, since, c.mode), tester = !!(p && p.tester), reach = c.mode === "live" || tester || exempt === "owner";
    const last4 = l ? last4Of(l.license_key) : n ? n.key_last4 : "";
    const name = [l ? "@" + l.username : "", n && n.name || ""].filter(Boolean).join(" · ") || (last4 ? `License …${last4}` : "A key made by hand");
    const live = s && !subEnded(s);
    const plan = exempt === "owner" ? "Your FAFO" : exempt === "family" ? "Friends and Family" + (live ? " · monthly plan paused" : "")
      : !b || !b.plan ? "No plan" : b.plan === "checkout" ? "Pay per checkout"
      : `Monthly · ${s ? MONTHLY_SLOTS + EXTRA_SLOTS * s.extras : MONTHLY_SLOTS} slots${s && s.period_end ? ` · ${s.cancel_at_end ? "ends" : "renews"} ${day(s.period_end)}` : ""}`;
    const status = exempt ? "Not charged" : !reach ? "Not a tester" : b && b.dispute_hold ? "Dispute hold" : tot.overdue ? `${money(tot.overdue)} overdue`
      : b && b.plan === "monthly" && s && ["past_due", "unpaid", "incomplete", "paused"].includes(s.status) && !s.paused ? "Payment failed"
      : tot.owed ? `${money(tot.owed)} owed` : !(p && p.seen_at) ? "Older FAFO" : "Paid up";
    return { h, l, p, b, s, tot, exempt, tester, reach, last4, name, plan, status, off: !!(l && l.revoked_at), monthly: !exempt && b && b.plan === "monthly" && live };
  });
  buyers.sort((x, y) => (y.tot.overdue - x.tot.overdue) || (y.tot.owed - x.tot.owed) || ((x.exempt === "owner") - (y.exempt === "owner")) || x.name.localeCompare(y.name));
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const base = `${url.pathname}?t=${encodeURIComponent(t)}`;
  const btn = (fields, action, text, cls = "ed") => `<form method="post" action="${esc(url.pathname)}">${hidden}${bq ? `<input type="hidden" name="b" value="${esc(bq)}">` : ""}${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}<button class="${cls}" type="submit" name="action" value="${action}">${esc(text)}</button></form>`;
  const msgs = `${done ? `<p class="hint" style="color:#5fd39a;font-weight:600">${esc(done)}</p>` : ""}${err ? `<p class="hint err">${esc(err)}</p>` : ""}`;
  const storeSelect = (cur) => `<select name="store"><option value="target"${cur === "target" ? " selected" : ""}>Target</option><option value="pokemoncenter"${cur === "pokemoncenter" ? " selected" : ""}>Pokémon Center</option></select>`;

  const one = bq.length === 16 ? buyers.find((x) => x.h.startsWith(bq)) : null;
  if (one) {
    const [lines, batches] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM billing_lines WHERE key_hash = ? AND mode = ? ORDER BY created_at DESC LIMIT 200").bind(one.h, c.mode),
      env.DB.prepare(`SELECT batch, store_name, COUNT(*) AS n, GROUP_CONCAT(profile, ', ') AS profiles, MIN(sent_at) AS sent, MAX(pulled_at) AS pulled,
        SUM(CASE WHEN pulled_at IS NULL THEN 0 ELSE 1 END) AS pulled_n FROM billing_accounts WHERE key_hash = ? GROUP BY batch, store_name ORDER BY sent DESC LIMIT 20`).bind(one.h),
    ]);
    const k = { key: one.h };
    const acts = one.exempt === "owner" ? "" : [one.exempt === "family" ? btn(k, "charge", "Charge") : btn(k, "family", "Friends and Family"),
      c.mode === "test" ? (one.tester ? btn(k, "untester", "Not a tester") : btn(k, "tester", "Tester")) : "",
      one.b && one.b.dispute_hold ? btn(k, "clear-hold", "Clear dispute hold", "ok") : ""].join("");
    const rows = lines.results.map((l) => {
      // A held line its monthly plan's payment then covered was never owed: no Charge again for it.
      const st = lineState(l, now) === "canceled" && l.cancel_src === "covered" ? "covered" : lineState(l, now), f = { line: l.id };
      const a = st === "due" || st === "overdue" ? btn(f, "waive", "Waive") + btn(f, "mark-paid", "Mark paid")
        : st === "disputed" ? btn(f, "dispute-waive", "Waive") + btn(f, "dispute-keep", "Keep", "rm") : st === "waived" ? btn(f, "unwaive", "Undo waive")
        : st === "canceled" ? btn(f, "charge-again", "Charge again") : st === "held" ? btn(f, "waive", "Waive") : "";
      const note = l.dispute_at ? `<br><span style="font-size:12px">“${esc(l.dispute_note || "No note")}”${l.dispute_answer ? ` · ${l.dispute_answer === "waived" ? "you waived it" : "you kept it"}` : ""}</span>` : "";
      return `<tr><td>${esc(l.order_at)}</td><td class="em">${esc(l.store_name || accountStoreName(l.store))} #${esc(l.order_no)}<br><span style="font-size:12px">${esc([l.item + (l.qty && l.qty !== "1" ? ` ×${l.qty}` : ""), l.profile, SOURCE_TEXT[l.source] || l.source].filter((x) => String(x).trim()).join(" · "))}</span></td>
        <td><span style="color:${STATE_COLOR[st] || "#b9c6ea"}">${esc(STATE_TEXT[st])}</span>${st === "due" || st === "overdue" ? `<br><span style="font-size:12px">due ${esc(day(l.due_at))}</span>` : ""}${note}</td><td>${money(l.amount)}</td><td class="act">${a}</td></tr>`;
    }).join("");
    const bat = batches.results.map((x) => `<tr><td>${esc(day(x.sent))}</td><td class="em">${esc(x.store_name)}: ${esc(String(x.profiles || "").slice(0, 300))}</td><td>${x.pulled_n ? `${x.pulled_n} of ${x.n} pulled, last ${esc(day(x.pulled))}` : "Still out"}</td></tr>`).join("");
    return page(200, "Billing", "", `${msgs}<p><a class="back" href="${esc(base)}">← All buyers</a></p>
      <p class="who">${esc(one.name)}</p>
      <p class="small">${one.last4 ? `License …${esc(one.last4)} · ` : ""}${esc(one.plan)} · ${esc(one.status)}${one.off ? " · License turned off" : ""}${one.tester ? " · Tester" : ""}</p>
      ${acts ? `<div class="row">${acts}</div>` : ""}
      <p class="small">Friends and Family are never charged and Submit is never off for them. Charge makes them pay like any buyer approved after payments began, for checkouts from then on.${c.mode === "test" ? " In test mode only testers see plans and pay, with Stripe's test cards." : ""}</p>
      <h3>Their invoice</h3>
      ${rows ? `<table><thead><tr><th>Date</th><th>Checkout</th><th>State</th><th>Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="small">No checkouts yet.</p>`}
      <h3>Add a checkout</h3>
      <form class="edit" method="post" action="${esc(url.pathname)}">${hidden}<input type="hidden" name="b" value="${esc(bq)}"><input type="hidden" name="key" value="${esc(one.h)}">
        <label>Store${storeSelect("target")}</label><label>Order number<input name="order" maxlength="40" autocomplete="off" spellcheck="false"></label>
        <label>Date<input name="date" type="date" value="${esc(today)}"></label><label>Item<input name="item" maxlength="80"></label><label>Note<input name="note" maxlength="60"></label>
        <p class="go"><button class="go" type="submit" name="action" value="add">Add to their invoice</button></p></form>
      ${bat ? `<h3>Recent batches</h3><table><thead><tr><th>Sent</th><th>Slots on their own accounts</th><th>Pulled</th></tr></thead><tbody>${bat}</tbody></table>` : ""}
      <p class="hint">The link works until ${esc(when(o.created_at + BILL_LIST_TTL_MS))}.</p>`, true);
  }

  let seen = null;
  try { seen = seenRow.results[0] ? JSON.parse(seenRow.results[0].v) : null; } catch {}
  const ago = (x) => { const m = Math.max(0, Math.round((now - x) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const alerts = !sender || !seen || now - seen.at > 86400000
    ? `<p class="hint err">Checkouts on accounts you give out aren't being billed: turn on Order alerts for buyers in your desktop FAFO and keep it running.${seen ? ` Last from your FAFO ${esc(ago(seen.at))}.` : ""}</p>`
    : `<p class="small">Order alerts: last from your FAFO ${esc(ago(seen.at))}.</p>`;
  const sum = (f) => buyers.filter((x) => !x.exempt).reduce((n, x) => n + f(x), 0);
  const fam = buyers.filter((x) => x.exempt === "family" && !x.off).length, monthly = buyers.filter((x) => x.monthly).length;
  let pastePart;
  if (preview) {
    const ok = preview.rows.filter((r) => r.out.ok).length;
    const who = (h) => (buyers.find((x) => x.h === h) || { name: "A buyer" }).name;
    pastePart = `<h3>Paste checkouts: check before adding</h3>
      <form class="edit" method="post" action="${esc(url.pathname)}">${hidden}<input type="hidden" name="store" value="${esc(preview.store)}"><input type="hidden" name="date" value="${esc(preview.date)}">
      <textarea name="paste" hidden>${esc(preview.paste)}</textarea>
      <table><thead><tr><th>Line</th><th>Buyer</th><th>Outcome</th></tr></thead><tbody>${preview.rows.map((r) => `<tr><td class="em">${esc(r.x.text)}<br><span style="font-size:12px">${esc([accountStoreName(r.x.store), r.x.orderNo ? "#" + r.x.orderNo : "", r.x.date].filter(Boolean).join(" · "))}</span></td>
        <td>${r.m.length > 1 ? `<select name="pick${r.i}" aria-label="Pick a buyer"><option value="">Pick a buyer</option>${r.m.map((y) => `<option value="${esc(y.hash)}"${r.chosen && r.chosen.hash === y.hash ? " selected" : ""}>${esc(who(y.hash))}${y.profile ? ` · ${esc(y.profile)}` : ""}</option>`).join("")}</select>`
          : r.chosen ? `${esc(who(r.chosen.hash))}${r.chosen.profile ? `<br><span style="font-size:12px">${esc(r.chosen.profile)}</span>` : ""}` : ""}</td>
        <td${r.out.ok ? ' style="color:#5fd39a"' : ""}>${esc(r.out.ok ? (r.out.held ? "Will add (on hold: their monthly payment failed)" : "Will add") : r.out.why)}</td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="ok" type="submit" name="action" value="paste-add">Add ${plural(ok, "checkout")}</button><button class="ed" style="width:auto" type="submit" name="action" value="paste-preview">Check again</button></div></form>
      <p><a class="back" href="${esc(base)}">← Start over</a></p>`;
  } else {
    pastePart = `<h3>Paste checkouts</h3>
      <form class="edit" method="post" action="${esc(url.pathname)}">${hidden}
        <label>Your bot's success log, one checkout per line<textarea name="paste" rows="5" spellcheck="false" autocomplete="off" placeholder="Each line needs the account's email and the order number"></textarea></label>
        <label>Store, for lines that don't name one${storeSelect("target")}</label><label>Date, for lines without one<input name="date" type="date" value="${esc(today)}"></label>
        <p class="hint">Each line is matched to the buyer who had that email out as a slot that day (their own account, or one you gave them). Nothing is added until you check and confirm.</p>
        <p class="go"><button class="go" type="submit" name="action" value="paste-preview">Check</button></p></form>`;
  }
  const fold = (x) => String(x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const body = buyers.filter((x) => !x.off || x.tot.owed).map((x) => `<tr data-q="${esc(fold(`${x.name} ${x.last4} ${x.plan} ${x.status}`))}"><td class="em">${esc(x.name)}${x.last4 ? `<br><span style="font-size:12px;color:#8090b8">License …${esc(x.last4)}${x.tester ? " · Tester" : ""}</span>` : ""}</td>
    <td>${esc(x.plan)}</td><td class="st"${/overdue|failed|hold/.test(x.status) ? ' style="color:#ff8a80"' : / owed/.test(x.status) ? ' style="color:#ffd27a"' : ""}>${esc(x.status)}</td>
    <td class="act"><a href="${esc(base)}&b=${x.h.slice(0, 16)}">Details</a></td></tr>`).join("");
  return page(200, "Billing", "", `${msgs}
    <p class="who">${c.mode === "test" ? "Test mode: only testers are charged" : "Payments are on"}</p>
    <p class="small">Owed ${money(sum((x) => x.tot.owed))} · Overdue ${money(sum((x) => x.tot.overdue))} · Paid in the last 30 days ${money(paid30.results[0].s)} · ${plural(monthly, "monthly plan")} · ${fam} Friends and Family</p>
    ${alerts}
    <p class="small">$10 per checkout, due 3 days after it (free if the store cancels it first), or $25 a month for 10 slots ($50 for 25). Buyers you approved before payments began are Friends and Family and never charged; Details moves anyone either way. Refunds are made in your Stripe Dashboard; the prices are set in FAFO (a change to the license worker).</p>
    ${pastePart}
    <h3>Buyers</h3>
    ${body ? `<div class="find"><input type="search" id="find" placeholder="Search by name, last 4, plan or status" aria-label="Search buyers"><span class="shown" id="shown"></span></div>
    <table><thead><tr><th>Buyer</th><th>Plan</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table>${PREMIUM_SCRIPT}` : "<p>No buyers yet.</p>"}
    <p class="hint">The link works until ${esc(when(o.created_at + BILL_LIST_TTL_MS))}.</p>`, true);
}

async function admin(request, env, path) {
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || !(await sameText(auth, "Bearer " + env.ADMIN_TOKEN))) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" && path === "/admin/pictures") {
    const q = String(new URL(request.url).searchParams.get("q") || "").slice(0, 300), words = pictureWords(q), trace = { groups: [], fits: [] };
    const cached = await env.DB.prepare("SELECT q, product_id, name, until, at FROM picture_finds WHERE q = ?").bind(picKeyOf(words)).first();
    const r = new Set(words.filter((w) => !isSeries(w))).size < 2 ? { product: null, short: true } : await pictureSearch(env, words, Date.now(), trace);
    return json({ q, words, cached, result: r, ...trace }, 200, NO_STORE);
  }
  if (request.method === "GET" && path === "/admin/billing") {
    const mode = stripeMode(env), now = Date.now();
    const [people, plans, owed, cfg] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN family = 1 THEN 1 ELSE 0 END), 0) AS family, COALESCE(SUM(CASE WHEN family = 0 THEN 1 ELSE 0 END), 0) AS charge,
        COALESCE(SUM(tester), 0) AS testers, COALESCE(SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS seen FROM billing_people`),
      env.DB.prepare("SELECT COALESCE(plan, 'none') AS plan, COUNT(*) AS n FROM billing WHERE mode = ? GROUP BY plan").bind(mode),
      env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS owed, COALESCE(SUM(CASE WHEN due_at < ? AND NOT ${DISPUTED} THEN amount END), 0) AS overdue, COUNT(*) AS lines
        FROM billing_lines WHERE mode = ? AND ${OWED}`).bind(now, mode),
      env.DB.prepare("SELECT k, v FROM billing_config"),
    ]);
    const conf = Object.fromEntries(cfg.results.map((x) => [x.k, x.v])), parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
    const num = (k) => conf[k] ? Number(conf[k]) : null;
    return json({ on: billingOn(env), mode, onSince: { live: num("on_since:live"), test: num("on_since:test") }, backOn: { live: num("back_on:live"), test: num("back_on:test") }, offSeen: num("off_seen"),
      alertsSeen: parse(conf.alerts_seen || "null"), prices: { live: parse(conf["prices:live"] || "null"), test: parse(conf["prices:test"] || "null") },
      people: people.results[0], plans: Object.fromEntries(plans.results.map((x) => [x.plan, x.n])), owed: owed.results[0] }, 200, NO_STORE);
  }
  if (request.method === "GET" && path === "/admin/premium") {
    const { results } = await env.DB.prepare(
      "SELECT p.key_last4, p.granted_at, l.username FROM premium p LEFT JOIN licenses l ON l.key_hash = p.key_hash ORDER BY p.granted_at DESC").all();
    const s = await currentAlertSender(env);
    return json({ premium: results, alertSender: s ? { key_last4: s.key_last4, username: s.username || null } : null });
  }
  if (request.method === "GET" && path === "/admin/licenses") {
    const { results } = await env.DB.prepare(
      "SELECT discord_id, username, license_key, issued_at, revoked_at FROM licenses ORDER BY issued_at DESC").all();
    return json({ licenses: results });
  }
  if (request.method === "GET" && path === "/admin/slots") {
    const origin = new URL(request.url).origin;
    const [limits, reqs] = await env.DB.batch([
      env.DB.prepare("SELECT key_hash, slot_limit, updated_at FROM slot_limits ORDER BY updated_at DESC"),
      env.DB.prepare("SELECT * FROM slot_requests ORDER BY created_at DESC LIMIT 200"),
    ]);
    return json({ default: slotDefault(env), limits: limits.results, requests: reqs.results.map(({ review_token, key_hash, ...q }) => ({ ...q, review_url: `${origin}/slots/review/${q.id}?t=${review_token}` })) });
  }
  if (request.method === "GET" && path === "/admin/submissions") {
    const origin = new URL(request.url).origin;
    const [keys, subs, pulls] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM submit_keys ORDER BY created_at DESC LIMIT 50"),
      env.DB.prepare(`SELECT s.id, s.key_last4, s.name, s.username, s.slots, s.bytes, s.key_id, s.created_at, r.status AS review, r.decided_at, r.review_token
        FROM submissions s LEFT JOIN submission_reviews r ON r.id = s.id ORDER BY s.created_at DESC LIMIT 200`),
      env.DB.prepare("SELECT id, key_last4, name, username, slots, key_id, created_at FROM pulls ORDER BY created_at DESC LIMIT 200"),
    ]);
    return json({ keys: keys.results.map(({ review_token, key_hash, ...k }) => ({ ...k, review_url: `${origin}/submit/review/${k.id}?t=${review_token}` })),
      submissions: subs.results.map(({ review_token, ...x }) => review_token ? { ...x, review_url: `${origin}/submissions/review/${x.id}?t=${review_token}` } : x), pulls: pulls.results });
  }
  if (request.method === "GET" && path === "/admin/applications") {
    const { results } = await env.DB.prepare(
      "SELECT discord_id, username, status, created_at, decided_at, review_token FROM applications ORDER BY created_at DESC").all();
    const origin = new URL(request.url).origin;
    return json({ applications: results.map(({ review_token, ...a }) => ({ ...a, review_url: `${origin}/review/${a.discord_id}?t=${review_token}` })) });
  }
  if (request.method === "GET" && path === "/admin/accounts") {
    const origin = new URL(request.url).origin;
    const [stores, given, offers, removals] = await env.DB.batch([
      env.DB.prepare(`SELECT store, COUNT(*) AS total, SUM(CASE WHEN key_hash IS NULL THEN 1 ELSE 0 END) AS free,
        SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent FROM accounts WHERE ${OWN_ACCOUNT} GROUP BY store ORDER BY store`),
      env.DB.prepare(`SELECT store, email, key_last4, store_name, profile, batch, assigned_at, sent_at, NOT (${OWN_ACCOUNT}) AS reused FROM accounts WHERE key_hash IS NOT NULL ORDER BY assigned_at DESC LIMIT 500`),
      env.DB.prepare("SELECT id, store, store_name, count, key_last4, name, username, status, added, created_at, decided_at, review_token FROM account_offers ORDER BY created_at DESC LIMIT 50"),
      env.DB.prepare("SELECT id, count, key_last4, name, username, status, removed, created_at, decided_at, review_token FROM account_removals ORDER BY created_at DESC LIMIT 50"),
    ]);
    // The one list's inboxes (2026-10-23): how many accounts each has, and how many are free.
    const inboxes = (await listInboxes(env)).map((b) => ({ name: b.name, mine: !!b.mine, total: b.n, free: b.free }));
    // Accounts that don't work, set aside (2026-10-23): how many on each list.
    const { results: setAside } = await env.DB.prepare("SELECT list, COUNT(*) AS n FROM accounts_aside GROUP BY list").all();
    const aside = Object.fromEntries(Object.keys(ASIDE).map((k) => [k, (setAside.find((r) => r.list === k) || { n: 0 }).n]));
    return json({ limit: assignLimit(env), stores: stores.results, inboxes, aside, given: given.results,
      offers: offers.results.map(({ review_token, ...o }) => ({ ...o, review_url: `${origin}/accounts/review/${o.id}?t=${review_token}` })),
      removals: removals.results.map(({ review_token, ...o }) => ({ ...o, review_url: `${origin}/accounts/removal/${o.id}?t=${review_token}` })) });
  }
  // {email} (with {store} if it's on more than one store's list), or free: {key} for every account a license has.
  if (request.method === "POST" && (path === "/admin/accounts/free" || path === "/admin/accounts/remove")) {
    const b = await request.json().catch(() => ({}));
    const free = path === "/admin/accounts/free", email = String(b.email || "").trim().toLowerCase();
    const where = free && b.key && !email ? ["key_hash = ?", await keyHash(b.key)]
      : email ? (b.store ? ["email_norm = ? AND store = ?", email, String(b.store)] : ["email_norm = ?", email]) : null;
    if (!where) return json({ error: free ? "send {email} or {key}" : "send {email}" }, 400);
    const r = free ? await freeAccounts(env, where[0], ...where.slice(1)) : await env.DB.prepare(`DELETE FROM accounts WHERE ${where[0]}`).bind(...where.slice(1)).run();
    await sweepParked(env);   // a Target account parked for a Pokémon Center slot freed here goes back too
    if (!free) await sweepInboxes(env);
    const { results: stores } = await env.DB.prepare("SELECT DISTINCT store FROM accounts").all();
    for (const x of stores) await stockCheck(env, x.store, x.store, false);
    return json({ ok: true, changed: r.meta ? r.meta.changes : 0 });
  }
  if (request.method === "POST" && (path === "/admin/revoke" || path === "/admin/restore")) {
    const b = await request.json().catch(() => ({}));
    const where = b.discord_id ? ["discord_id = ?", String(b.discord_id)]
      : b.key ? ["key_hash = ?", await keyHash(b.key)] : null;
    if (!where) return json({ error: "send {discord_id} or {key}" }, 400);
    const set = path === "/admin/revoke" ? "revoked_at = " + Date.now() : "revoked_at = NULL";
    const [upd] = await env.DB.batch([
      env.DB.prepare(`UPDATE licenses SET ${set} WHERE ${where[0]}`).bind(where[1]),
      env.DB.prepare("UPDATE list_state SET version = version + 1 WHERE id = 1"),
    ]);
    return json({ ok: true, changed: upd.meta ? upd.meta.changes : 0 });
  }
  if (path === "/admin/vaults" && request.method === "GET") {
    const { results } = await env.DB.prepare(`SELECT v.key_hash, v.rev, v.size, v.device, v.created_at, v.updated_at, v.fails, l.username, l.discord_id
      FROM vaults v LEFT JOIN licenses l ON l.key_hash = v.key_hash ORDER BY v.updated_at DESC`).all();
    return json({ vaults: results.map((r) => ({ license: r.key_hash.slice(0, 12), username: r.username || null, discordId: r.discord_id || null, rev: r.rev, size: r.size, device: r.device, createdAt: r.created_at, updatedAt: r.updated_at, wrongPasswords: r.fails })) });
  }
  if (path === "/admin/alerts" && request.method === "GET") {
    const senders = await env.DB.prepare("SELECT id, key_last4, name, username, status, created_at, decided_at FROM alert_senders ORDER BY created_at DESC LIMIT 50").all();
    const sent = await env.DB.prepare(`SELECT a.key_hash, COUNT(*) AS n, MAX(a.created_at) AS last, l.username, w.key_hash IS NOT NULL AS hook
      FROM alerts a LEFT JOIN licenses l ON l.key_hash = a.key_hash LEFT JOIN alert_webhooks w ON w.key_hash = a.key_hash GROUP BY a.key_hash ORDER BY last DESC`).all();
    return json({ senders: senders.results, buyers: sent.results.map((r) => ({ license: r.key_hash.slice(0, 12), username: r.username || null, alerts: r.n, last: r.last, discordWebhook: !!r.hook })) });
  }
  return json({ error: "not found" }, 404);
}

async function sameText(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(x, y)
    : btoa(String.fromCharCode(...new Uint8Array(x))) === btoa(String.fromCharCode(...new Uint8Array(y)));
}

// ---- keys ----------------------------------------------------------------------------

// Matches the app: PVLT-XXXX-XXXX-XXXX-XXXX, hashed as sha256("pvlt:" + key without dashes).
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => KEY_ALPHABET[b & 31]).join("");
  return "PVLT-" + chars.match(/.{4}/g).join("-");
}
async function keyHash(key) {
  const norm = String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pvlt:" + norm));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomId(n) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- copy of GitHub's files ---------------------------------------------------------------
// The app's update.json, released pages and licenses.json, from GitHub, for networks that block
// raw.githubusercontent.com (security filters often do: anyone can host files there). Only those names, always
// from MIRROR_BASE, never with the request's query, so this can't fetch anything else. Pages never change once
// released, so they're kept a day; update.json and licenses.json a minute. A page goes out as text, so opened in
// a browser it shows rather than runs (the desktop app checks its bytes, not its type).
const MIRROR_BASE = "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/";
const MIRROR_FILES = /^(update\.json|licenses\.json|index-\d{1,3}\.\d{1,3}\.\d{1,4}\.html)$/;
async function mirror(env, name) {
  if (!MIRROR_FILES.test(name)) return json({ error: "not found" }, 404);
  const pageFile = name.endsWith(".html");
  let r;
  try {
    r = await fetch((env.MIRROR_BASE || MIRROR_BASE) + name, {
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": pageFile ? 86400 : 60, "404": 30, "500-599": 0 } },
    });
  } catch (e) {
    return json({ error: "GitHub didn't answer" }, 502, { "cache-control": "no-store" });
  }
  if (!r.ok) return json({ error: "GitHub answered " + r.status }, r.status === 404 ? 404 : 502, { "cache-control": "no-store" });
  return new Response(r.body, { status: 200, headers: { ...CORS,
    "content-type": pageFile ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": pageFile ? "public, max-age=86400" : "no-store" } });
}

// ---- product pictures (app 1.9.113) ---------------------------------------------------------
// The owner's request (2026-10-12: "make FAFO put the picture on automatically after every order completion"): an
// order whose email has no product photo (Target's pre-orders show a gray bag, Pokémon Center's emails have none) gets
// one by itself. The app sends the item's name; the worker looks it up among the sealed Pokémon TCG products in
// TCGplayer's catalog, as tcgcsv.com publishes it each day (the Pokémon category's groups, one per set or kind of
// product, and each group's products), and answers the one whose name has the same words, written the same way
// (pictureWords: "Elite Trainer Box" is ETB, Pokémon Center's own edition is not the store's, a Booster Display is
// the Booster Box, a series' name is one word), with its picture. Never a near match: an order without a picture shows
// its store's mark, while another product's picture would be wrong, so a name with a word the product's lacks, or the
// other way round, another series' product, or two products that fit, gets nothing. Lists read from the catalog are
// kept a day and what a name found a week (nothing found, 6 hours) in D1, so the catalog is asked about once a day per
// list whoever asks, and its pictures once a week per product. A list that can't be read is tried again after an hour,
// and its last copy is used meanwhile. Asks need a license key; what's kept about who asked is a count per license per
// day, for the daily limit (PIC_ASKS_PER_DAY, asks not answered from what's kept), for two days.
const PIC_CATALOG = "https://tcgcsv.com/tcgplayer/3/";   // 3 is Pokémon
const PIC_IMAGES = ["https://product-images.tcgplayer.com/fit-in/200x200/{id}.jpg", "https://product-images.tcgplayer.com/fit-in/400x400/{id}.jpg",
  "https://tcgplayer-cdn.tcgplayer.com/product/{id}_200w.jpg"];
const PIC_LIST_MS = 86400000, PIC_RETRY_MS = 3600000, PIC_FOUND_MS = 7 * 86400000, PIC_MISS_MS = 6 * 3600000;
const PIC_KEEP_MS = 30 * 86400000;      // rows older than this go
const PIC_NEWEST = 10;                  // the newest groups are searched for every name (new sets, pre-orders)
const PIC_NAMED = 6;                    // and up to this many more that share a word with it ("Delta Reign", a series)
const PIC_BUILDS = 3;                   // groups read from the catalog in one ask; the rest on the next (the app asks again)
const PIC_ASKS_PER_DAY = 300;
const PIC_LIST_MAX = 8_000_000, PIC_IMAGE_MAX = 600_000;
const PIC_UA = "FAFO license worker (+https://fafoaco.com)";
const picListMs = (env) => Number(env.PICTURES_LIST_MS) > 0 ? Number(env.PICTURES_LIST_MS) : PIC_LIST_MS;   // tests set it
const picAsksPerDay = (env) => Number(env.PICTURES_ASKS_PER_DAY) > 0 ? Number(env.PICTURES_ASKS_PER_DAY) : PIC_ASKS_PER_DAY;
// Written the same way on both sides, on the lowercase name without accents or punctuation, in this order.
const PIC_PHRASES = [
  [/(?<= )pokemon center(?= )/g, "pkc"],
  [/(?<= )(pokemon )?trading card game(?= )/g, ""], [/(?<= )tcg(?= )/g, ""],
  [/(?<= )elite trainer box(es)?(?= )/g, "etb"],
  [/(?<= )ultra premium collection(?= )/g, "upc"],
  [/(?<= )super premium collection(?= )/g, "spc"],
  [/(?<= )(3|three) (booster |pack )?blister(?= )/g, "blister3"],
  [/(?<= )booster bundle box(es)?(?= )/g, "booster bundle"],      // Target's name for the Booster Bundle
  [/(?<= )(booster )?display( box)?(?= )|(?<= )booster box(?= )/g, "boosterbox"],
  [/(?<= )\d+ (booster )?packs?(?= )/g, ""],      // what's inside: "(36 Packs)", "6 Booster Packs"
  // A series' name is one word (s_…): a store writes "Mega Evolution—Delta Reign" where the catalog writes "Delta Reign"
  // (its group is "ME03: Delta Reign"), but a series' own set is named after it ("Mega Evolution Booster Bundle"), so
  // it's not dropped (pictureFits).
  [/(?<= )scarlet and violet(?= )/g, "s_sv"], [/(?<= )sword and shield(?= )/g, "s_swsh"],
  [/(?<= )sun and moon(?= )/g, "s_sm"], [/(?<= )mega evolution(?= )/g, "s_me"],
  [/(?<= )pre ?order(?= )|(?<= )only at(?= )/g, ""],
];
const PIC_STOP = new Set(["the", "and", "a", "an", "of", "for", "with", "by", "in", "on", "new", "english", "sealed", "exclusive",
  "target", "pokemon", "sv", "swsh", "sm", "xy", "bw", "me"]);
// Words that say what kind of product it is: a group isn't picked for sharing one of these with a name.
const PIC_KIND = new Set(["pkc", "etb", "upc", "spc", "blister3", "blister", "boosterbox", "booster", "bundle", "pack", "collection", "box",
  "tin", "case", "premium", "figure", "poster", "binder", "build", "battle", "stadium", "deck", "sleeved", "mini", "pin", "kit", "calendar",
  "chest", "portfolio", "playmat", "sleeve", "theme", "starter", "trainer", "toolkit", "accessory", "pouch", "holiday", "special", "card",
  "product", "miscellaneou", "promo"]);
const isSeries = (w) => w.startsWith("s_");
function pictureWords(name) {
  let s = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/['’`]/g, "");
  s = s.replace(/\b(sv|swsh|sm|xy|bw|me|s)\d{1,2}(\.\d|pt\d)?[a-z]?\b/g, " ");   // set codes: "S8.5", "SV8.5", "ME03"
  s = " " + s.replace(/[^a-z0-9]+/g, " ").trim() + " ";
  for (const [re, to] of PIC_PHRASES) s = s.replace(re, to).replace(/ {2,}/g, " ");
  return s.trim().split(" ").filter(Boolean)
    .map((w) => w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)
    .filter((w) => !PIC_STOP.has(w));
}
// A product fits a name when every word of its name is in the name, its series too, and every word of the name is in
// its name (or its group's: an "Elite Trainer Box" in the group "Delta Reign"), but for the name's series, which the
// catalog leaves to its group's code. Never another series' product. `exact`: the product's name alone has them all.
function pictureFits(q, words, groupWords) {
  const c = new Set(words);
  if ([...c].filter((w) => !isSeries(w)).length < 2) return null;
  for (const w of c) if (!q.has(w)) return null;
  const its = [...c, ...groupWords].filter(isSeries);
  if (its.length && [...q].some(isSeries) && !its.some((w) => q.has(w))) return null;
  let fromGroup = 0;
  for (const w of q) if (!c.has(w) && !isSeries(w)) { if (groupWords.has(w)) fromGroup++; else return null; }
  return { exact: fromGroup === 0 };
}
const picKeyOf = (words) => [...new Set(words)].sort().join(" ");
const catalogBase = (env) => String(env.PICTURES_CATALOG || PIC_CATALOG).replace(/\/*$/, "/");
async function catalogGet(env, path) {
  const r = await fetch(catalogBase(env) + path, { headers: { "user-agent": PIC_UA, accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 3600 }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("catalog answered " + r.status);
  const text = await r.text();
  if (text.length > PIC_LIST_MAX) throw new Error("catalog list too big");
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j && j.success !== false && Array.isArray(j.results) ? j.results : null;
  if (!list) throw new Error("catalog answer without a list");
  return list;
}
// A list kept in D1 (`body`: the list as JSON, or {"unread":1} for one that couldn't be read and has no copy yet).
const picBody = (row) => { try { const v = JSON.parse(row.body); return Array.isArray(v) ? v : null; } catch (e) { return null; } };
async function picRows(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, body, until, at FROM picture_lists WHERE id IN (${part.map(() => "?").join(", ")})`).bind(...part).all();
    for (const r of results) out.set(r.id, r);
  }
  return out;
}
const PIC_PUT = "INSERT INTO picture_lists (id, body, until, at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, until = excluded.until, at = excluded.at";
// Reads a list from the catalog and keeps it. One that can't be read keeps its last copy (used meanwhile), or an
// "unread" mark, for an hour, so the next asks don't try it again straight away. {list} or {list: null}.
async function picRead(env, id, read, now, row) {
  try {
    const list = await read();
    await env.DB.prepare(PIC_PUT).bind(id, JSON.stringify(list), now + picListMs(env), now).run();
    return { list, read: true };
  } catch (e) {
    console.error("picture catalog", id, e && e.message);
    await env.DB.prepare(PIC_PUT).bind(id, row ? row.body : '{"unread":1}', now + PIC_RETRY_MS, row ? row.at : now).run();
    return { list: row ? picBody(row) : null };
  }
}
// The groups, newest first: {id, name, at}.
const picGroupsRead = (env) => async () => (await catalogGet(env, "groups"))
  .filter((g) => g && Number.isInteger(g.groupId) && g.name)
  .map((g) => ({ id: g.groupId, name: String(g.name).slice(0, 200), at: String(g.publishedOn || g.modifiedOn || "") }))
  .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
// A group's sealed products (no card number or rarity, which cards have): {id, name}.
const picSealedRead = (env, gid) => async () => (await catalogGet(env, gid + "/products"))
  .filter((p) => p && Number.isInteger(p.productId) && (p.name || p.cleanName)
    && !(Array.isArray(p.extendedData) && p.extendedData.some((e) => e && /^(number|rarity)$/i.test(String(e.name || "")))))
  .map((p) => ({ id: p.productId, name: String(p.name || p.cleanName).slice(0, 300) }));
// The product a name is, or none. Groups are searched from what's kept: a fresh copy, or one read now (PIC_BUILDS an
// ask), or a day-old copy past that. `more`: a group never read yet was left for the next ask, and nothing was found.
// `incomplete`: a group couldn't be read (so nothing found isn't kept long). `trace` (admin) lists the groups searched and
// every product that fit.
async function pictureSearch(env, words, now, trace) {
  const q = new Set(words);
  const gRows = await picRows(env, ["groups"]), gRow = gRows.get("groups");
  let groupList = gRow && gRow.until > now ? picBody(gRow) : null;
  if (!groupList) groupList = (await picRead(env, "groups", picGroupsRead(env), now, gRow && picBody(gRow) ? gRow : null)).list;
  if (!groupList) return { failed: true };
  const groups = groupList.map((x) => ({ ...x, words: new Set(pictureWords(x.name)) }));
  const shares = (x) => [...x.words].filter((w) => q.has(w) && !PIC_KIND.has(w)).length;
  const named = groups.map((x) => [x, shares(x)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, PIC_NAMED).map(([x]) => x);
  const pick = [...new Set([...named, ...groups.slice(0, PIC_NEWEST)])];
  const rows = await picRows(env, pick.map((x) => "g:" + x.id));
  let builds = 0, more = false, unread = 0;
  const fits = [];
  for (const x of pick) {
    const id = "g:" + x.id, row = rows.get(id);
    let list;
    if (row && row.until > now) list = picBody(row);
    else if (builds < PIC_BUILDS) { builds++; list = (await picRead(env, id, picSealedRead(env, x.id), now, row && picBody(row) ? row : null)).list; }
    else if (row && picBody(row)) list = picBody(row);
    else { more = true; continue; }
    if (!list) { unread++; continue; }
    if (trace) trace.groups.push(x.name);
    for (const p of list) {
      const f = pictureFits(q, pictureWords(p.name), x.words);
      if (f) fits.push({ id: p.id, name: p.name, group: x.name, exact: f.exact });
    }
  }
  if (trace) trace.fits = fits;
  if (!fits.length) return more ? { more: true } : { product: null, incomplete: unread > 0 };
  const exact = fits.filter((f) => f.exact), pool = exact.length ? exact : fits;
  // Two different products fit: neither (the same product found in two groups is one).
  if (new Set(pool.map((f) => f.id)).size > 1) return { product: null, ambiguous: true };
  return { product: pool[0] };
}
// The product's picture as a data: address, from TCGplayer's image servers (only its own addresses, by number).
async function pictureImage(env, id) {
  const tries = env.PICTURES_IMAGES ? String(env.PICTURES_IMAGES).split(/\s+/).filter(Boolean) : PIC_IMAGES;
  for (const t of tries) {
    try {
      const r = await fetch(t.replace("{id}", String(id)), { headers: { "user-agent": PIC_UA, accept: "image/*" },
        cf: { cacheEverything: true, cacheTtl: 7 * 86400 }, signal: AbortSignal.timeout(15000) });
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length || buf.length > PIC_IMAGE_MAX) continue;
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return `data:${type};base64,${btoa(bin)}`;
    } catch (e) { console.error("picture image", id, e && e.message); }
  }
  return null;
}
const pictureOut = (row) => row && row.product_id && row.image
  ? { found: true, name: row.name, product: row.product_id, source: "TCGplayer", image: row.image }
  : { found: false };
// GET /pictures/find?q=NAME (license Bearer): {found, name, product, source, image} or {found:false}, {more:true} (ask
// again in a minute: the catalog's lists are still being read), 502 when the catalog can't be reached, 429 past the
// day's asks.
async function pictureFind(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  const words = pictureWords(String(url.searchParams.get("q") || "").slice(0, 300));
  if (new Set(words.filter((w) => !isSeries(w))).size < 2) return json({ found: false }, 200, NO_STORE);
  const key = picKeyOf(words), now = Date.now();
  const row = await env.DB.prepare("SELECT * FROM picture_finds WHERE q = ?").bind(key).first();
  if (row && row.until > now) return json(pictureOut(row), 200, NO_STORE);
  const asked = await env.DB.prepare(`INSERT INTO picture_asks (key_hash, day, n) VALUES (?, ?, 1)
    ON CONFLICT (key_hash, day) DO UPDATE SET n = n + 1 RETURNING n`).bind(lic.hash, day(now)).first();
  if (asked && asked.n > picAsksPerDay(env)) return json({ error: "too many lookups today" }, 429, NO_STORE);
  // Old rows go now and then (indexed, so it's cheap).
  if (Math.random() < 0.05) ctx.waitUntil(env.DB.batch([
    env.DB.prepare("DELETE FROM picture_finds WHERE at < ?").bind(now - PIC_KEEP_MS),
    env.DB.prepare("DELETE FROM picture_lists WHERE at < ?").bind(now - PIC_KEEP_MS),
    env.DB.prepare("DELETE FROM picture_asks WHERE day < ?").bind(day(now - 2 * 86400000)),
  ]).catch((e) => console.error("picture purge", e)));
  const r = await pictureSearch(env, words, now);
  if (r.failed) return json({ error: "the catalog didn't answer" }, 502, NO_STORE);
  if (r.more) return json({ found: false, more: true }, 200, NO_STORE);
  const p = r.product, image = p ? await pictureImage(env, p.id) : null;
  const out = { q: key, product_id: p && image ? p.id : null, name: p && image ? p.name : null, image,
    until: now + (p ? (image ? PIC_FOUND_MS : PIC_RETRY_MS) : r.incomplete ? PIC_RETRY_MS : PIC_MISS_MS), at: now };
  await env.DB.prepare("INSERT INTO picture_finds (q, product_id, name, image, until, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(q) DO UPDATE SET product_id = excluded.product_id, name = excluded.name, image = excluded.image, until = excluded.until, at = excluded.at")
    .bind(out.q, out.product_id, out.name, out.image, out.until, out.at).run();
  return json(pictureOut(out), 200, NO_STORE);
}

// ---- responses -----------------------------------------------------------------------

function json(data, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status: statusCode, headers: { "content-type": "application/json", ...CORS, ...headers } });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function page(statusCode, title, msg, extra = "", wide = false) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>FAFO · ${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bruno+Ace+SC&text=FAFO&display=swap">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1433;color:#e6ecff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
  main{max-width:440px;width:100%;background:#0f1d45;border:1px solid #2a3f7a;border-radius:16px;padding:28px;box-sizing:border-box}
  h1{margin:0 0 4px;font:400 34px "Bruno Ace SC",system-ui,sans-serif;letter-spacing:.06em;color:#4a9dff}
  h2{margin:0 0 12px;font-size:18px}
  p{margin:0 0 12px;color:#b9c6ea}
  .small{font-size:14px;margin-top:20px;overflow-wrap:anywhere}
  .who{font-size:20px;font-weight:600;color:#e6ecff;margin:16px 0 0;overflow-wrap:anywhere}
  .key{font:600 18px ui-monospace,Consolas,monospace;color:#e6ecff;background:#07102b;border-radius:8px;padding:10px 12px;user-select:all;overflow-wrap:anywhere}
  .row{display:flex;gap:10px;margin-top:20px}
  .stack .row{margin-top:12px}
  input[type=number]{width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid #2a3f7a;background:#07102b;color:#e6ecff;font:600 18px system-ui,sans-serif}
  .row form{flex:1;margin:0}
  button{width:100%;padding:12px;border:0;border-radius:10px;font:600 16px system-ui,sans-serif;cursor:pointer;color:#fff}
  button.ok{background:#1f9d5c} button.no{background:#c4372f}
  p.go{margin:20px 0 0} button.go{background:#4a9dff;color:#06122e}
  button.copy{width:auto;padding:8px 14px;font-size:14px;background:#2a3f7a}
  main.wide{max-width:900px}
  h3{margin:24px 0 8px;font-size:16px;overflow-wrap:anywhere} h3 .count{font-weight:400;color:#b9c6ea;margin-left:6px} h3 input.all{vertical-align:-2px;margin-right:6px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;font-weight:600;color:#b9c6ea;padding:6px 8px;border-bottom:1px solid #2a3f7a}
  td{padding:6px 8px;border-bottom:1px solid #1c2c5c;vertical-align:middle;color:#b9c6ea}
  td.em{color:#e6ecff;overflow-wrap:anywhere;min-width:24ch} tr.free td:nth-child(3){color:#5fd39a}
  th.pick,td.pick{width:22px;padding-right:0} input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:#4a9dff;cursor:pointer}
  .bulk{position:sticky;bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;padding:10px 12px;background:#132556;border:1px solid #2a3f7a;border-radius:12px;box-shadow:0 8px 24px #0009}
  .bulk[hidden]{display:none} section.store[hidden],table tr[hidden],.find[hidden]{display:none !important}
  .find{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 4px} .find .shown{font-size:13px;color:#b9c6ea}
  .find input{flex:1;min-width:180px;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #2a3f7a;background:#07102b;color:#e6ecff;font:15px system-ui,sans-serif} .bulk .n{font-weight:600;color:#e6ecff} .bulk .msg{flex:1;min-width:120px;font-size:13px;color:#5fd39a}
  .tag{display:inline-block;font-size:12px;font-weight:600;line-height:1.5;padding:0 8px;border-radius:999px;border:1px solid #2a3f7a;color:#9cc7ff;vertical-align:1px}
  .tag.mine{border-color:#7a5bc4;color:#cdb6ff} .tag.off{border-color:#7a3a3a;color:#ffb3ad}
  .ibx{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px;padding:8px 0;border-bottom:1px solid #1c2c5c;color:#e6ecff;overflow-wrap:anywhere}
  .ibx .count{font-size:13px;color:#b9c6ea} .ibx-a form{display:inline-block;margin:2px 0 2px 6px}
  details summary{cursor:pointer;color:#9cc7ff;margin-top:14px;font-size:15px}
  .bulk select{padding:6px 8px;border-radius:8px;border:1px solid #2a3f7a;background:#07102b;color:#e6ecff;font:13px system-ui,sans-serif;max-width:min(100%,320px)}
  td form{margin:0} button.rm{width:auto;padding:6px 12px;font-size:13px;background:transparent;border:1px solid #c4372f;color:#ff8a80}
  td.act{text-align:right} td.act form{display:inline-block;margin:2px 0 2px 6px}
  button.ed{width:auto;padding:6px 12px;font-size:13px;background:transparent;border:1px solid #4a9dff;color:#9cc7ff}
  form.edit label{display:block;margin-top:14px;font-size:14px;color:#b9c6ea}
  form.edit input,form.edit select,form.edit textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid #2a3f7a;background:#07102b;color:#e6ecff;font:15px system-ui,sans-serif}
  form.edit textarea{font-family:ui-monospace,Consolas,monospace;min-height:110px;resize:vertical}
  form.edit input[readonly]{color:#8090b8}
  form.edit fieldset{border:0;margin:18px 0 0;padding:0;min-width:0} form.edit legend{padding:0;font-size:14px;color:#b9c6ea}
  form.edit label.opt{display:flex;align-items:flex-start;gap:10px;margin-top:10px;font-size:15px;color:#e6ecff;cursor:pointer}
  form.edit label.opt input{display:block;flex:none;width:18px;height:18px;margin:2px 0 0;padding:0;accent-color:#4a9dff}
  form.edit label.opt input:disabled + span{opacity:.5}
  .hint{font-size:13px;margin:6px 0 0} .err{color:#ff8a80;font-weight:600} a{color:#9cc7ff} a.back{display:inline-block;margin-top:16px}
  @media (max-width:560px){
    main{padding:22px 18px}
    table thead{display:none}
    table tr{display:grid;grid-template-columns:auto 1fr auto;column-gap:10px;padding:8px 0;border-bottom:1px solid #1c2c5c}
    table td{border:0;padding:2px 0}
    td.pick{grid-column:1;grid-row:1 / span 2;align-self:center}
    td.em{grid-column:2;overflow-wrap:break-word;word-break:break-word;min-width:0} td.em + td, td.st{grid-column:2}
    td.act{grid-column:3;grid-row:1 / span 2;align-self:center}
    td.act form{display:block;margin:4px 0}
  }
</style></head><body><main${wide ? ' class="wide"' : ""}><h1>FAFO</h1><h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ""}${extra}</main></body></html>`,
    { status: statusCode, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
