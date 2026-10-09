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
//   GET/POST /alerts/review/ID?t=TOKEN    allow or refuse a license sending order alerts to buyers
//   GET  /admin/licenses       every key issued            (Authorization: Bearer ADMIN_TOKEN)
//   GET  /admin/applications   every request and decision
//   GET  /admin/submissions    collecting keys (with review links), submissions sent (whether approved or declined,
//                              with their review links) and slots pulled
//   POST /admin/revoke         {discord_id} or {key}: the app locks on its next check
//   POST /admin/restore        {discord_id} or {key}
//   GET  /admin/accounts       the account list: free and given out per store, who got which, offers
//   GET  /admin/vaults         synced vaults: whose, how big, from which device, when (never their contents)
//   GET  /admin/alerts         order alerts: who asked to send them and the decisions, and how many each buyer got
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
      }
      if (path.startsWith("/review/")) return await review(request, env, ctx, url, path.slice("/review/".length));
      if (path === "/slots/limit" && request.method === "GET") return await slotLimit(request, env);
      if (path === "/slots/request" && request.method === "POST") return await slotRequest(request, env, ctx, url);
      if (path.startsWith("/slots/review/")) return await slotReview(request, env, ctx, url, path.slice("/slots/review/".length));
      if (path === "/submit/key" && request.method === "GET") return await submitKeyGet(env, url);
      if (path === "/submit/key" && request.method === "POST") return await submitKeyPost(request, env, ctx, url);
      if (path.startsWith("/submit/review/")) return await submitKeyReview(request, env, ctx, url, path.slice("/submit/review/".length));
      if (path === "/submissions" && request.method === "POST") return await submission(request, env, url);
      if (path === "/submissions/status" && request.method === "GET") return await submissionStatus(request, env, url);
      if (path === "/submissions/batches" && request.method === "GET") return await submissionBatches(request, env, url);
      if (path.startsWith("/submissions/review/")) return await submissionReview(request, env, ctx, url, path.slice("/submissions/review/".length));
      if (path === "/pull" && request.method === "POST") return await pull(request, env, ctx);
      if (path === "/accounts/offer" && request.method === "POST") return await accountOffer(request, env, ctx, url);
      if (path.startsWith("/accounts/review/")) return await accountReview(request, env, ctx, url, path.slice("/accounts/review/".length));
      if (path === "/accounts/remove" && request.method === "POST") return await accountRemove(request, env, ctx, url);
      if (path.startsWith("/accounts/removal/")) return await accountRemovalReview(request, env, ctx, url, path.slice("/accounts/removal/".length));
      if (path === "/alerts/sender" && request.method === "GET") return await alertSenderGet(request, env);
      if (path === "/alerts/sender" && request.method === "POST") return await alertSenderPost(request, env, ctx, url);
      if (path.startsWith("/alerts/review/")) return await alertSenderReview(request, env, ctx, url, path.slice("/alerts/review/".length));
      if (path === "/alerts/accounts" && request.method === "GET") return await alertAccounts(request, env);
      if (path === "/alerts/webhook" && request.method === "GET") return await alertWebhookGet(request, env);
      if (path === "/alerts/webhook" && request.method === "PUT") return await alertWebhookPut(request, env);
      if (path === "/alerts" && request.method === "GET") return await alertsGet(request, env, url);
      if (path === "/alerts" && request.method === "POST") return await alertsPost(request, env, ctx);
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

  const state = randomId(24);
  const res = await env.DB.prepare(
    `INSERT INTO requests (r, state, ip, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (r) DO UPDATE SET state = excluded.state, created_at = excluded.created_at
     WHERE requests.status = 'pending'`
  ).bind(r, state, ip, now).run();
  if (!res.meta || !res.meta.changes) return page(200, "Already done", "Go back to FAFO.");

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
  if (!req || Date.now() - req.created_at > REQUEST_TTL_MS) {
    return page(400, "This sign-in expired", "Go back to FAFO and click Continue with Discord again.");
  }
  if (req.status === "issued") return page(200, "You're all set", "Go back to FAFO. It has your key.");
  if (req.status === "review") return page(200, "Request sent", "The seller will review your request.");
  if (req.status !== "pending") return page(400, "Something went wrong", req.error || "Go back to FAFO and try again.");

  const fail = async (title, msg, statusCode = 403) => {
    await env.DB.prepare("UPDATE requests SET status = 'error', error = ? WHERE r = ? AND status = 'pending'").bind(msg, req.r).run();
    return page(statusCode, title, msg);
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
      return page(200, "Request sent", "The seller will review your request. Once it's approved, FAFO activates by itself if it's waiting, or click Continue with Discord in FAFO again.");
    }
  }

  const lic = await issueLicense(env, ctx, user.id, username, !approvalOn(env));
  if (lic.revoked_at) {
    const app = await env.DB.prepare("SELECT status FROM applications WHERE discord_id = ?").bind(user.id).first();
    return app && app.status === "denied" ? fail("Request declined", DECLINED_MSG) : fail("License turned off", REVOKED_MSG);
  }
  await env.DB.prepare("UPDATE requests SET status = 'issued', discord_id = ? WHERE r = ? AND status = 'pending'").bind(user.id, req.r).run();
  return page(200, "You're all set", "Go back to FAFO. It activates by itself in a few seconds.",
    `<p class="small">Your license key, in case you need it later:</p><p class="key">${esc(lic.license_key)}</p>`);
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
  if (!ghList || !ghList.keys.has(hash)) return false;
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
  return json({ limit: await currentSlotLimit(env, lic.hash), request: slotRequestOut(latest), canRequest: !!env.DISCORD_WEBHOOK_URL }, 200, { "cache-control": "no-store" });
}

async function slotRequest(request, env, ctx, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
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

async function submission(request, env, url) {
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
  const limit = assignLimit(env);
  const accts = (x) => {
    const p = picks.get(x.name) || {}, got = p.got || 0, need = short(x);
    // Pokémon Center slots given their profile's Target account again (reuseAccount) say so, as do slots given back the
    // account they had, and why the rest got none (2026-10-07: the owner couldn't tell).
    const parts = [got ? `${got} assigned account${got === 1 ? "" : "s"}${p.reused ? `, ${p.reused} reused from Target` : ""}${p.back ? `, ${p.back} they had before` : ""}` : "",
      need ? `${need} need${need === 1 ? "s" : ""} an account${p.why === "limit" ? `: this license is at its limit of ${limit}` : p.why === "empty" ? ": your list has none" : ""}` : ""].filter(Boolean);
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
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(s.id).run();
    if (reviewed) await env.DB.prepare("DELETE FROM submission_reviews WHERE id = ?").bind(s.id).run().catch((e) => console.error("review", e));
    // Accounts that can't have reached the channel go back to the list (or to the batch they came from); if part of the
    // batch went out, they're kept for this batch, and sending it again posts the same ones.
    if (!postedAny) await undoMoves(env, lic, batch, moves).catch((e) => console.error("accounts", e));
    if (picks.size) await settleAccounts(env, lic, batch, postedAny, Date.now());
    return json({ error: "couldn't post to the channel" }, 502);
  }
  await env.DB.prepare("UPDATE submissions SET webhook_message_id = ? WHERE id = ?").bind(msgId, s.id).run().catch((e) => console.error("record", e));
  if (picks.size) await settleAccounts(env, lic, batch, true, Date.now()).catch((e) => console.error("accounts", e));
  for (const f of files || []) if (f.assigned > 0) await stockCheck(env, f.storeKey, f.store, true).catch((e) => console.error("stock", e));
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
  // Accounts from the owner's list given to this batch's slots (Use Assigned Account), which declining puts back.
  const given = async () => (await env.DB.prepare(`SELECT store FROM accounts WHERE key_hash = ? AND batch = ? AND ${OWN_ACCOUNT}`).bind(r.key_hash, r.id).all()).results;
  let done = "", asking = false;
  if (r.status === "pending" && (action === "approve" || action === "decline")) {
    const now = Date.now(), status = action === "approve" ? "approved" : "declined";
    const back = status === "declined" ? await given() : [];
    // Worked out before the batch is marked: accounts that stay for a Pokémon Center slot elsewhere, and parked ones
    // whose last slot is in this batch.
    const eff = status === "declined" ? await declineEffect(env, r.key_hash, r.id) : { kept: 0, released: 0 };
    // Its message is no longer needed once it's marked.
    const res = await env.DB.prepare("UPDATE submission_reviews SET status = ?, decided_at = ?, content = '' WHERE id = ? AND status = 'pending'").bind(status, now, r.id).run();
    if (res.meta && res.meta.changes) {
      if (r.webhook_message_id) ctx.waitUntil(webhookEdit(env, r.webhook_message_id, { content: submissionMessage(url.origin, { ...r, status, decided_at: now }) }).catch(() => {}));
      // Every decline, so a batch whose only accounts are reuses drops them too.
      if (status === "declined") {
        await freeBatch(env, r.key_hash, r.id);
        for (const st of new Set([...back.map((a) => a.store), ...Object.values(REUSE_FROM)])) await stockCheck(env, st, accountStoreName(st), false);
      }
      const kept = eff.kept, freed = back.length - eff.kept + eff.released;
      done = status === "approved" ? "Approved. Their FAFO now shows these slots as Success."
        : `Declined. Their FAFO now shows these slots as Declined.${freed ? ` ${freed} account${freed === 1 ? "" : "s"} given to them ${freed === 1 ? "is" : "are"} back on your list.` : ""}${keptNote(kept)}`;
    }
    Object.assign(r, await env.DB.prepare("SELECT status, decided_at FROM submission_reviews WHERE id = ?").bind(r.id).first());
  } else if (r.status === "pending" && action === "decline-ask") asking = true;
  const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const label = r.status === "approved" ? `Approved ${when(r.decided_at)}. Their FAFO shows these slots as Success.`
    : r.status === "declined" ? `Declined ${when(r.decided_at)}. Their FAFO shows these slots as Declined.` : "Waiting for you.";
  const who = [r.name, r.username ? "@" + r.username : "", "license …" + r.key_last4].filter(Boolean).join(" · ");
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  const eff = asking ? await declineEffect(env, r.key_hash, r.id) : { kept: 0, released: 0 }, kept = eff.kept;
  const n = r.status === "pending" ? (await given()).length - eff.kept + eff.released : 0;
  const head = `<p class="who">${r.slots} slot${r.slots === 1 ? "" : "s"}${r.name ? ` from ${esc(r.name)}` : ""}</p>
     ${r.stores ? `<p class="small" style="margin-top:8px">${esc(r.stores)}</p>` : ""}`;
  const sent = `<p class="small">Sent by ${esc(who)}, ${esc(when(r.created_at))}</p>`;
  if (asking) return page(200, "Decline these slots?", "",
    `${head}
     <p class="small">Their FAFO will show these slots as Declined, and they can send them again.${n ? ` The ${n} account${n === 1 ? "" : "s"} given to them go${n === 1 ? "es" : ""} back on your list.` : ""}${keptNote(kept)} This can't be undone.</p>
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
// row N. An account goes to one slot only; the buyer never sees it. A license gets ASSIGNED_LIMIT at
// most in all, and an account picked for a batch that never reached the channel goes back to the list.

const ACCOUNT_OFFERS_PER_DAY = 5;
const ACCOUNT_OFFER_MAX = 1000;
// An offer nobody decided on expires, and the accounts it holds (with their passwords) are dropped
// (ACCOUNT_OFFER_TTL_MS overrides it for tests).
const offerTtlMs = (env) => Number(env.ACCOUNT_OFFER_TTL_MS) > 0 ? Number(env.ACCOUNT_OFFER_TTL_MS) : 7 * 86400000;
const expireOffers = (env, now) => env.DB.prepare("UPDATE account_offers SET status = 'expired', accounts = '[]', decided_at = ? WHERE status = 'pending' AND created_at < ?")
  .bind(now, now - offerTtlMs(env)).run();
const assignLimit = (env) => { const n = Math.floor(Number(env.ASSIGNED_LIMIT)); return String(env.ASSIGNED_LIMIT ?? "").trim() !== "" && n >= 0 ? n : 10; };
// A pick whose batch never reached the channel is freed after this (ASSIGN_STALE_MS overrides it for tests).
const assignStaleMs = (env) => Number(env.ASSIGN_STALE_MS) > 0 ? Number(env.ASSIGN_STALE_MS) : 60 * 60 * 1000;
const FREE_ACCOUNT = "key_hash = NULL, key_last4 = NULL, batch = NULL, store_name = NULL, profile = NULL, assigned_at = NULL, sent_at = NULL";
// A Pokémon Center slot can get its profile's Target account again (reuseAccount). That account is kept as a
// Pokémon Center row marked offer_id "reuse:target", which isn't on the owner's list: it's deleted where others are
// freed, and doesn't count in a store's stock or toward a license's limit (OWN_ACCOUNT).
const OWN_ACCOUNT = "COALESCE(offer_id, '') NOT LIKE 'reuse:%'";
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
    const k = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND batch = ? AND store = ? AND ${usedBy("r.batch <> accounts.batch")}`)
      .bind(keyHash, batch, from, to).first();
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND store = ? AND batch LIKE '${PARKED}%'
      AND ${usedBy("r.batch = ?")} AND NOT ${usedBy("r.batch <> ?")}`).bind(keyHash, from, to, batch, to, batch).first();
    kept += k ? k.n : 0; released += r ? r.n : 0;
  }
  return { kept, released };
}
// What the decline page says about the ones that stay (one pair of stores so far: REUSE_FROM).
const keptNote = (k) => {
  if (!k) return "";
  const [[to, from]] = PAIRS(), one = k === 1;
  return ` ${k} ${accountStoreName(from)} account${one ? " stays" : "s stay"} with them: their ${accountStoreName(to)} slot${one ? " in another batch uses it" : "s in other batches use them"} too.`;
};
// Run once the batch is marked declined (and again by undoMoves for a batch declined while a move was out).
async function freeBatch(env, keyHash, batch) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM accounts WHERE key_hash = ? AND batch = ? AND NOT (${OWN_ACCOUNT})`).bind(keyHash, batch),
    ...PAIRS().map(([to, from]) => env.DB.prepare(`UPDATE accounts SET batch = '${PARKED}' || batch WHERE key_hash = ? AND batch = ? AND store = ?
      AND ${usedBy("r.batch <> accounts.batch")}`).bind(keyHash, batch, from, to)),
    env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE key_hash = ? AND batch = ?`).bind(keyHash, batch),
  ]);
  await sweepParked(env);
}
// A parked account no slot uses any more goes back on the list.
async function sweepParked(env) {
  await env.DB.batch(PAIRS().map(([to, from]) => env.DB.prepare(`UPDATE accounts SET ${FREE_ACCOUNT} WHERE store = ? AND batch LIKE '${PARKED}%' AND NOT ${usedBy("1")}`)
    .bind(from, to)));
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
  const t = await env.DB.prepare(`SELECT email, email_norm, password FROM accounts WHERE key_hash = ? AND store = ? AND profile = ? AND (sent_at IS NOT NULL OR batch = ?)
    ORDER BY batch = ? DESC, sent_at DESC, assigned_at DESC LIMIT 1`).bind(lic.hash, from, profile, batch, batch).first();
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

async function assignAccounts(env, lic, batch, files, now, moves, active) {
  const picks = new Map();
  // Pokémon Center after Target, so it can reuse the Target accounts given out in the same batch.
  const want = files.filter((f) => f.kind === "profiles" && f.assigned > 0).sort((a, b) => (REUSE_FROM[a.storeKey] ? 1 : 0) - (REUSE_FROM[b.storeKey] ? 1 : 0));
  if (!want.length) return picks;
  await freeAccounts(env, "sent_at IS NULL AND key_hash IS NOT NULL AND assigned_at < ?", now - assignStaleMs(env));
  const limit = assignLimit(env);
  for (const f of want) {
    const logins = files.find((x) => x.kind === "logins" && x.store === f.store);
    const eol = /\r\n/.test(f.text) ? "\r\n" : "\n";
    const lines = logins ? logins.text.split(/\r?\n/).filter((x) => x.trim()) : [];
    const rows = parseCsv(f.text), col = (rows[0] || []).findIndex((h) => h.replace(/^\uFEFF/, "").trim() === "email");
    // The app puts these slots right after the ones with a login, so they start at row N + 1.
    const start = 1 + lines.length, asked = Math.min(f.assigned, Math.max(0, rows.length - start));
    // Sending the same batch again gets the same accounts, each for the same profile.
    const { results: had } = await env.DB.prepare("SELECT email, password, profile FROM accounts WHERE key_hash = ? AND batch = ? AND store = ? ORDER BY assigned_at, rowid")
      .bind(lic.hash, batch, f.storeKey).all();
    const res = [];
    let reused = 0, back = 0, more = true, why = "";
    for (let i = 0; i < asked; i++) {
      const profile = String(rows[start + i][0] || "").slice(0, 80);
      const r = await reuseAccount(env, lic, batch, f, profile, now + i, moves);
      if (r) { res[i] = r; reused++; continue; }
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
      const out = active && active.get(f.storeKey);
      if (out && profile && !out.has(profile)) {
        const k = await env.DB.prepare(`SELECT email, email_norm, password, batch FROM accounts WHERE key_hash = ? AND store = ? AND profile = ?
          AND sent_at IS NOT NULL AND batch IS NOT NULL AND batch != ? AND batch NOT LIKE '${PARKED}%' AND ${OWN_ACCOUNT}
          ORDER BY sent_at DESC, assigned_at DESC LIMIT 1`).bind(lic.hash, f.storeKey, profile, batch).first();
        if (k && await takeAccount(env, lic, batch, f.storeKey, k.email_norm, k.batch, f.store, moves)) { res[i] = k; back++; continue; }
      }
      if (!more) continue;
      const held = await env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE key_hash = ? AND ${OWN_ACCOUNT}`).bind(lic.hash).first();
      const atLimit = (held ? held.n : 0) >= limit;
      const a = !atLimit ? await env.DB.prepare(
        `UPDATE accounts SET key_hash = ?, key_last4 = ?, batch = ?, store_name = ?, profile = ?, assigned_at = ?, sent_at = NULL
         WHERE rowid = (SELECT rowid FROM accounts WHERE store = ? AND key_hash IS NULL ORDER BY random() LIMIT 1) RETURNING email, password`
      ).bind(lic.hash, lic.last4, batch, f.store, profile, now + i, f.storeKey).first() : null;
      if (a) res[i] = a; else { more = false; why = atLimit ? "limit" : "empty"; }   // only reuse from here on
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
    picks.set(f.store, { asked: f.assigned, got: got.length, ...(reused ? { reused } : {}), ...(back ? { back } : {}), ...(why && got.length < asked ? { why } : {}) });
  }
  return picks;
}

// The owner's channel is told once when a store's list is down to ACCOUNTS_LOW_AT free accounts (15),
// and once more when it runs out. post=false only clears those again, after accounts are added or freed.
const lowAt = (env) => { const n = Math.floor(Number(env.ACCOUNTS_LOW_AT)); return String(env.ACCOUNTS_LOW_AT ?? "").trim() !== "" && n >= 0 ? n : 15; };
async function stockCheck(env, store, name, post) {
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN key_hash IS NULL THEN 1 ELSE 0 END) AS free FROM accounts WHERE store = ? AND ${OWN_ACCOUNT}`).bind(store).first();
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
  await webhookPost(env, { content: empty
    ? `🚫 **No ${md(name)} accounts left** on your list for Use Assigned Account. Slots on it wait for you to assign one by hand until you send more from FAFO (Settings → Accounts to assign).`
    : `⚠️ **Only ${free} ${md(name)} account${free === 1 ? "" : "s"} left** on your list for Use Assigned Account. Send more from FAFO (Settings → Accounts to assign).` });
}

// sent: the batch (or part of it) reached the channel, so its accounts are given out for good.
// Otherwise they go back to the list.
async function settleAccounts(env, lic, batch, sent, now) {
  if (sent) await env.DB.prepare("UPDATE accounts SET sent_at = ? WHERE key_hash = ? AND batch = ? AND sent_at IS NULL").bind(now, lic.hash, batch).run();
  else await freeAccounts(env, "key_hash = ? AND batch = ? AND sent_at IS NULL", lic.hash, batch);
}

const offerStoreName = (x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 40);

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
  const n = (k) => `${k} ${md(o.store_name)} account${k === 1 ? "" : "s"}`;
  const head = o.status === "added" ? `✅ **Added ${n(o.added || 0)} to your list** for Use Assigned Account`
    : o.status === "refused" ? `⛔ **${n(o.count)} refused**` : o.status === "expired" ? `⌛ **${n(o.count)} expired** before they were added`
    : `🗂️ **Add ${n(o.count)} to your list for Use Assigned Account?**`;
  return `${head}\nSent by ${who}${o.status === "pending" ? `\n[Review: add or refuse](${link})` : ""}`;
}

async function accountReview(request, env, ctx, url, id) {
  const o = /^[A-Za-z0-9_-]{8,40}$/.test(id) ? await env.DB.prepare("SELECT * FROM account_offers WHERE id = ?").bind(id).first() : null;
  let t = url.searchParams.get("t") || "", action = "";
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    t = form && String(form.get("t") || "") || t;
    action = form && String(form.get("action") || "");
  } else if (request.method !== "GET") {
    return page(405, "Not allowed", "");
  }
  if (!o || !(await sameText(t, o.review_token))) return page(404, "Accounts not found", "This review link isn't valid.");
  let done = "";
  const now = Date.now();
  if (o.status === "pending" && o.created_at < now - offerTtlMs(env)) { await expireOffers(env, now); o.status = "expired"; }
  if (o.status === "pending" && action === "add") {
    const list = JSON.parse(o.accounts || "[]");
    let added = 0;
    for (let i = 0; i < list.length; i += 100) {
      const res = await env.DB.batch(list.slice(i, i + 100).map((a) => env.DB.prepare(
        // A reused Target account on this store's list (reuseAccount) becomes this one, and stays with its slot.
        `INSERT INTO accounts (store, email, email_norm, password, added_at, offer_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (store, email_norm) DO UPDATE SET password = excluded.password, added_at = excluded.added_at, offer_id = excluded.offer_id WHERE NOT (${OWN_ACCOUNT})`
      ).bind(o.store, a.email, a.email.toLowerCase(), a.password, now, o.id)));
      added += res.reduce((n, r) => n + (r.meta && r.meta.changes || 0), 0);
    }
    await env.DB.prepare("UPDATE account_offers SET status = 'added', added = ?, accounts = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(added, now, o.id).run();
    await stockCheck(env, o.store, o.store_name, false);
    done = `Added ${added} to your list.${added < list.length ? ` ${list.length - added} ${list.length - added === 1 ? "was" : "were"} already on it.` : ""}`;
  } else if (o.status === "pending" && action === "refuse") {
    await env.DB.prepare("UPDATE account_offers SET status = 'refused', accounts = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, o.id).run();
    done = "Refused. Nothing was added.";
  }
  const cur = await env.DB.prepare("SELECT * FROM account_offers WHERE id = ?").bind(o.id).first();
  if (done && cur.webhook_message_id) ctx.waitUntil(webhookEdit(env, cur.webhook_message_id, { content: offerMessage(url.origin, cur) }).catch(() => {}));
  const stats = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN key_hash IS NULL THEN 1 ELSE 0 END) AS free FROM accounts WHERE store = ? AND ${OWN_ACCOUNT}`).bind(cur.store).first();
  const label = { pending: "Waiting for you", added: `Added ${cur.added} to your list`, refused: "Refused", expired: "Expired before it was added. Send the accounts again from FAFO." }[cur.status] || cur.status;
  const who = [cur.name, cur.username ? "@" + cur.username : "", "license …" + cur.key_last4].filter(Boolean).join(" · ");
  const emails = cur.status === "pending" ? JSON.parse(cur.accounts || "[]").map((a) => a.email) : [];
  const hidden = `<input type="hidden" name="t" value="${esc(t)}">`;
  const btn = (a, text, cls) => `<form method="post">${hidden}<button class="${cls}" type="submit" name="action" value="${a}">${esc(text)}</button></form>`;
  return page(200, `${cur.store_name} accounts`, done || label,
    `<p class="who">${cur.count} account${cur.count === 1 ? "" : "s"} for Use Assigned Account</p>
     <p class="small">Each slot on Use Assigned Account gets one of your free accounts when its batch reaches your channel, with the email on its AYCD profile${cur.store === "pokemoncenter" ? "" : " and email:password in the logins file"}. Buyers never see them, and each one goes to one slot only.</p>
     ${cur.status === "pending" ? `<p class="small"><strong>Only add these if you sent them</strong> from your own FAFO (Settings → Accounts to assign).</p>` : ""}
     ${emails.length ? `<p class="small">${emails.slice(0, 12).map(esc).join("<br>")}${emails.length > 12 ? `<br>and ${emails.length - 12} more` : ""}</p>` : ""}
     <p class="small">Your ${esc(cur.store_name)} list: ${stats.n || 0} account${stats.n === 1 ? "" : "s"}, ${stats.free || 0} free.<br>Sent by ${esc(who)}, ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${cur.status === "pending" ? `<div class="row">${btn("add", "Add to my list", "ok")}${btn("refuse", "Refuse", "no")}</div>` : ""}`);
}

// Accounts come off the list the same way (app 1.9.90+, the owner's request): FAFO sends the emails, the channel
// gets the count and a review link (never the emails), and the owner removes them there, from every store's list
// they're on. One already given to a buyer's slot goes too, so order alerts on it stop reaching them; the review
// page says where each one is first. Asking is limited like offers, and an ask nobody decided on expires.
const ACCOUNT_REMOVALS_PER_DAY = 5;
const expireRemovals = (env, now) => env.DB.prepare("UPDATE account_removals SET status = 'expired', emails = '[]', decided_at = ? WHERE status = 'pending' AND created_at < ?")
  .bind(now, now - offerTtlMs(env)).run();
const ACCOUNT_STORE_NAMES = { target: "Target", walmart: "Walmart", bestbuy: "Best Buy", amazon: "Amazon", gamestop: "GameStop", pokemoncenter: "Pokémon Center", costco: "Costco", samsclub: "Sam's Club", nike: "Nike" };
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
    const res = await env.DB.batch(list.slice(i, i + 100).map((e) => env.DB.prepare("SELECT store, key_hash, key_last4, profile, sent_at FROM accounts WHERE email_norm = ? ORDER BY store").bind(e)));
    res.forEach((r, k) => where.set(list[i + k], r.results || []));
  }
  if (o.status === "pending" && action === "remove") {
    let removed = 0;
    const stores = new Set();
    for (let i = 0; i < list.length; i += 100) {
      const res = await env.DB.batch(list.slice(i, i + 100).map((e) => env.DB.prepare("DELETE FROM accounts WHERE email_norm = ?").bind(e)));
      res.forEach((r, k) => { if (r.meta && r.meta.changes) { removed++; (where.get(list[i + k]) || []).forEach((a) => stores.add(a.store)); } });
    }
    await env.DB.prepare("UPDATE account_removals SET status = 'removed', removed = ?, emails = '[]', decided_at = ? WHERE id = ? AND status = 'pending'").bind(removed, now, o.id).run();
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
  const line = (e) => { const rows = where.get(e) || []; return `<strong>${esc(e)}</strong>: ${rows.length ? rows.map(spot).join("; ") : "not on your list"}`; };
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
async function alertAccounts(request, env) {
  const { error } = await alertSender(request, env);
  if (error) return error;
  const { results } = await env.DB.prepare("SELECT email, store FROM accounts WHERE key_hash IS NOT NULL AND sent_at IS NOT NULL").all();
  return json({ accounts: results.map((a) => ({ email: a.email, store: a.store })) }, 200, { "cache-control": "no-store" });
}

async function alertsPost(request, env, ctx) {
  const { error } = await alertSender(request, env);
  if (error) return error;
  const text = await request.text();
  if (text.length > 300_000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  const list = Array.isArray(b.events) ? b.events : null;
  if (!list || !list.length || list.length > ALERTS_PER_POST) return json({ error: "events" }, 400);
  const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const now = Date.now(), fresh = [];
  let unknown = 0, already = 0;
  for (const ev of list) {
    const account = clip(ev && ev.account, 120).toLowerCase(), store = clip(ev && ev.store, 64), stage = clip(ev && ev.stage, 12);
    const orderNo = clip(ev && ev.orderNo, 40).toUpperCase(), at = /^\d{4}-\d{2}-\d{2}$/.test(String(ev && ev.at || "")) ? ev.at : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || !store || !ALERT_STAGES.includes(stage) || !orderNo) { unknown++; continue; }
    const a = await env.DB.prepare("SELECT key_hash, profile, store_name, assigned_at FROM accounts WHERE email_norm = ? AND store = ? AND key_hash IS NOT NULL AND sent_at IS NOT NULL")
      .bind(account, store).first();
    // Only orders from the day before it was given out on: an older one was placed for someone else.
    if (!a || (at && at < new Date((a.assigned_at || 0) - 86400000).toISOString().slice(0, 10))) { unknown++; continue; }
    const oid = (await sha256Hex(`${a.key_hash}|${store}|${orderNo}`)).slice(0, 20);
    const row = { id: randomId(12), key_hash: a.key_hash, oid, store, store_name: clip(ev.storeName, 40) || a.store_name || store, profile: a.profile || "",
      order_no: orderNo, item: clip(ev.item, 120), qty: clip(ev.qty, 6) || "1", total: clip(ev.total, 20), stage, at, created_at: now + fresh.length };
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, key_hash, oid, store, store_name, profile, order_no, item, qty, total, stage, at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.key_hash, oid, store, row.store_name, row.profile, orderNo, row.item, row.qty, row.total, stage, at, row.created_at).run();
    if (r.meta && r.meta.changes) fresh.push(row); else already++;   // that step was already sent
  }
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
    };
  }).filter((x) => x.store || x.profile);
  if (!slots.length) return json({ error: "slots" }, 400);
  // A slot on Use Assigned Account (the app sends "Assigned account", it never knows which): the
  // account it went out with, so the owner knows which one to take back.
  const asks = slots.filter((x) => x.email === "Assigned account" && x.profile);
  if (asks.length) {
    const found = await env.DB.batch(asks.map((x) => env.DB.prepare(
      "SELECT email FROM accounts WHERE key_hash = ? AND store_name = ? AND profile = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC, assigned_at DESC LIMIT 1"
    ).bind(lic.hash, x.store, x.profile)));
    asks.forEach((x, i) => { const a = found[i].results[0]; if (a) x.email = `${a.email} (assigned account)`; });
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

async function admin(request, env, path) {
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || !(await sameText(auth, "Bearer " + env.ADMIN_TOKEN))) return json({ error: "unauthorized" }, 401);

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
    return json({ limit: assignLimit(env), stores: stores.results, given: given.results,
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

// ---- responses -----------------------------------------------------------------------

function json(data, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status: statusCode, headers: { "content-type": "application/json", ...CORS, ...headers } });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function page(statusCode, title, msg, extra = "") {
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
  .small{font-size:14px;margin-top:20px}
  .who{font-size:20px;font-weight:600;color:#e6ecff;margin:16px 0 0;overflow-wrap:anywhere}
  .key{font:600 18px ui-monospace,Consolas,monospace;color:#e6ecff;background:#07102b;border-radius:8px;padding:10px 12px;user-select:all;overflow-wrap:anywhere}
  .row{display:flex;gap:10px;margin-top:20px}
  .stack .row{margin-top:12px}
  input[type=number]{width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border-radius:10px;border:1px solid #2a3f7a;background:#07102b;color:#e6ecff;font:600 18px system-ui,sans-serif}
  .row form{flex:1;margin:0}
  button{width:100%;padding:12px;border:0;border-radius:10px;font:600 16px system-ui,sans-serif;cursor:pointer;color:#fff}
  button.ok{background:#1f9d5c} button.no{background:#c4372f}
  button.copy{width:auto;padding:8px 14px;font-size:14px;background:#2a3f7a}
</style></head><body><main><h1>FAFO</h1><h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ""}${extra}</main></body></html>`,
    { status: statusCode, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
