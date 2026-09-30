// Orbit license worker: "Continue with Discord" gives a new user a license key, and this
// worker serves the signed list of those keys that the app checks.
//
// Two modes:
//   automatic (default)       every Discord account that passes the checks gets a key at once
//   REQUIRE_APPROVAL = "true" each sign-in becomes a request posted to DISCORD_WEBHOOK_URL with a
//                             private review link; the owner approves or denies it there
//
// The app (index-*.html) talks to it through LICENSE_RELAY:
//   GET  /discord/ready        {ready} – the app only shows the Discord button when true
//   GET  /discord/start?r=ID   browser: sends the user to Discord's sign-in
//   GET  /discord/callback     browser: Discord sends the user back here
//   GET  /discord/status/ID    app polls: pending | review | issued (with key + signed list) | error
//   GET  /licenses             {body, sig}: SHA-256 hashes of valid keys, ECDSA P-256 signed
// Slots (app sends "Authorization: Bearer <license key>"):
//   GET  /slots/limit          {limit, request}: how many slots this license can have on at once
//   POST /slots/request        {requested, name, note}: ask for more; posted to DISCORD_WEBHOOK_URL
// Submissions (slots sent from the Submit page):
//   GET  /submit/key           {pub, keyId}: the collecting key apps before 1.9.52 encrypt to (null until
//                              the owner confirms one)
//   POST /submit/key           {pub, name}: offer a collecting key; the owner confirms it in Discord
//   POST /submissions          {csv, name, slots, stores, batch} (app 1.9.52+): posted to DISCORD_WEBHOOK_URL
//                              as a .csv attachment in plain text, with full card numbers, CVVs and
//                              passwords (the owner chose this over encryption). Older apps send
//                              {code, keyId, ...}, a code encrypted to the collecting key, posted as a .txt.
//                              Neither is kept here. From 1.9.53 each store in `stores` may carry
//                              `seller`: how many of its slots ask the owner to assign an account.
//   POST /pull                 {keyId, name, batch, slots}: slots pulled after being sent; posted to
//                              DISCORD_WEBHOOK_URL as a plain list, only for keys (or "CSV") this license
//                              sent submissions to
// Owner:
//   GET/POST /review/DISCORD_ID?t=TOKEN   approve or deny one request (link posted to the webhook)
//   GET/POST /slots/review/ID?t=TOKEN     approve (optionally a different number) or deny more slots
//   GET/POST /submit/review/ID?t=TOKEN    confirm or refuse a collecting key
//   GET  /admin/licenses       every key issued            (Authorization: Bearer ADMIN_TOKEN)
//   GET  /admin/applications   every request and decision
//   GET  /admin/submissions    collecting keys (with review links), submissions sent and slots pulled
//   POST /admin/revoke         {discord_id} or {key}: the app locks on its next check
//   POST /admin/restore        {discord_id} or {key}

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const REQUEST_TTL_MS = 15 * 60 * 1000;          // matches how long the app waits for a sign-in
const REVIEW_TTL_MS = 7 * 24 * 3600 * 1000;     // how long an app can wait for the owner's decision
const STARTS_PER_IP_PER_HOUR = 20;
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 symbols, no 0/O or 1/I
const DISCORD_EPOCH = 1420070400000;
const SUPPRESS_EMBEDS = 1 << 2;

// Shown by the app while a request waits. Orbit 1.9.41 shows it as the final message and stops
// waiting; later versions keep waiting and activate once it's approved.
const REVIEW_MSG = "Request sent. You can use Orbit once the seller approves it. Then click Continue with Discord again.";
const DECLINED_MSG = "Your request for a key was declined. Contact the seller if you think this is a mistake.";
const REVOKED_MSG = "The license for this Discord account was turned off. Contact the seller for help.";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
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
      }
      if (path.startsWith("/review/")) return await review(request, env, ctx, url, path.slice("/review/".length));
      if (path === "/slots/limit" && request.method === "GET") return await slotLimit(request, env);
      if (path === "/slots/request" && request.method === "POST") return await slotRequest(request, env, ctx, url);
      if (path.startsWith("/slots/review/")) return await slotReview(request, env, ctx, url, path.slice("/slots/review/".length));
      if (path === "/submit/key" && request.method === "GET") return await submitKeyGet(env, url);
      if (path === "/submit/key" && request.method === "POST") return await submitKeyPost(request, env, ctx, url);
      if (path.startsWith("/submit/review/")) return await submitKeyReview(request, env, ctx, url, path.slice("/submit/review/".length));
      if (path === "/submissions" && request.method === "POST") return await submission(request, env, url);
      if (path === "/pull" && request.method === "POST") return await pull(request, env, ctx);
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
  if (!validId(r)) return page(400, "This link isn't valid", "Go back to Orbit and click Continue with Discord again.");
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
  if (!res.meta || !res.meta.changes) return page(200, "Already done", "Go back to Orbit.");

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
    return page(400, "This sign-in expired", "Go back to Orbit and click Continue with Discord again.");
  }
  if (req.status === "issued") return page(200, "You're all set", "Go back to Orbit. It has your key.");
  if (req.status === "review") return page(200, "Request sent", "The seller will review your request.");
  if (req.status !== "pending") return page(400, "Something went wrong", req.error || "Go back to Orbit and try again.");

  const fail = async (title, msg, statusCode = 403) => {
    await env.DB.prepare("UPDATE requests SET status = 'error', error = ? WHERE r = ? AND status = 'pending'").bind(msg, req.r).run();
    return page(statusCode, title, msg);
  };
  if (url.searchParams.get("error") || !code) return fail("Sign-in cancelled", "Discord sign-in was cancelled. Click Continue with Discord in Orbit to try again.", 400);

  const token = await exchangeCode(env, code, url.origin + "/discord/callback");
  if (!token) return fail("Sign-in failed", "Discord didn't accept the sign-in. Click Continue with Discord in Orbit to try again.", 502);
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
      return page(200, "Request sent", "The seller will review your request. Once it's approved, Orbit activates by itself if it's waiting, or click Continue with Discord in Orbit again.");
    }
  }

  const lic = await issueLicense(env, ctx, user.id, username, !approvalOn(env));
  if (lic.revoked_at) {
    const app = await env.DB.prepare("SELECT status FROM applications WHERE discord_id = ?").bind(user.id).first();
    return app && app.status === "denied" ? fail("Request declined", DECLINED_MSG) : fail("License turned off", REVOKED_MSG);
  }
  await env.DB.prepare("UPDATE requests SET status = 'issued', discord_id = ? WHERE r = ? AND status = 'pending'").bind(user.id, req.r).run();
  return page(200, "You're all set", "Go back to Orbit. It activates by itself in a few seconds.",
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
    ctx.waitUntil(webhookPost(env, { content: `🔑 New Orbit license issued to **@${md(username)}** (Discord ID ${discordId}).` }).catch(() => {}));
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
  return `📝 **New Orbit key request** from ${who}\n[Review: approve or deny](${link})`;
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

// `file` ({name, text, type}) is sent as an attachment on the message (type defaults to text/plain).
async function webhookPost(env, payload, file) {
  if (!env.DISCORD_WEBHOOK_URL) return null;
  const u = new URL(env.DISCORD_WEBHOOK_URL);
  u.searchParams.set("wait", "true");
  const body = JSON.stringify({ ...payload, flags: SUPPRESS_EMBEDS, allowed_mentions: { parse: [] } });
  const send = () => {
    if (!file) return fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body });
    const form = new FormData();
    form.append("payload_json", body);
    form.append("files[0]", new Blob([file.text], { type: file.type || "text/plain" }), file.name);
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
// From app 1.9.52 the Submit page sends each batch as CSV (Orbit's Export → CSV columns), and it's
// posted to the owner's channel as a .csv they open directly. That's plain text: full card numbers,
// CVVs, and store and email passwords pass through here and sit in the channel. The owner chose
// this. Nothing is kept here but who sent how many slots.
//
// Older apps seal each batch with the owner's collecting key from Orbit (Settings → Password and
// sharing), so for them the worker and Discord only see ciphertext. The owner downloads that .txt
// and opens it with Import in Orbit.

const SUBMISSIONS_PER_HOUR = 30;
const SUBMISSION_MAX_CHARS = 4_000_000;     // well under Discord's attachment limit
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
  const note = k.status === "pending" ? "\nOnly confirm if the key ID and fingerprint on the review page match your own Orbit (Settings → Password and sharing)." : "";
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
    done = "Confirmed. Submissions now come to your channel, and only the Orbit with this key can open them.";
  } else if (action === "deny" && k.status !== "denied") {
    await env.DB.prepare("UPDATE submit_keys SET status = 'denied', decided_at = ? WHERE id = ?").bind(now, k.id).run();
    touched.push(k.id);
    done = k.status === "active" ? "Stopped. Orbit won't send submissions to your channel until you confirm a key again." : "Refused.";
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
     <p class="small">Only confirm if the key ID and fingerprint match the ones in your own Orbit, under Settings → Password and sharing. Submissions are encrypted for it, and only the Orbit that has this key can open them.</p>
     <p class="small">Offered by ${esc(who)}<br>${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC${done ? `<br>Status: ${esc(label)}` : ""}</p>
     <div class="row">${cur.status !== "active" ? btn("confirm", cur.status === "pending" ? "Confirm" : "Use this key", "ok") : ""}${cur.status !== "denied" ? btn("deny", cur.status === "active" ? "Stop using it" : "Refuse", "no") : ""}</div>`);
}

async function submission(request, env, url) {
  const lic = await slotLicense(request, env);
  if (!lic) return json({ error: "license not recognized" }, 401);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "the Discord channel isn't set up" }, 503);
  if (Number(request.headers.get("content-length") || 0) > SUBMISSION_MAX_CHARS + 20000) return json({ error: "too large" }, 413);
  const text = await request.text();
  if (text.length > SUBMISSION_MAX_CHARS + 20000) return json({ error: "too large" }, 413);
  let b; try { b = JSON.parse(text) || {}; } catch { b = {}; }
  // App 1.9.52 and later send the batch as CSV (no key needed); older apps send a sealed code.
  const csv = typeof b.csv === "string" ? b.csv : null;
  let code = "", keyId;
  if (csv !== null) {
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
  const seen = await env.DB.prepare("SELECT key_hash, webhook_message_id FROM submissions WHERE id = ?").bind(batch).first();
  if (seen) {
    if (seen.key_hash !== lic.hash) return json({ error: "batch id taken" }, 409);
    return seen.webhook_message_id ? json({ ok: true, id: batch, duplicate: true }) : json({ error: "still sending" }, 425);
  }
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE key_hash = ? AND created_at > ?").bind(lic.hash, now - 3600 * 1000).first();
  if (recent && recent.n >= SUBMISSIONS_PER_HOUR) return json({ error: "too many submissions this hour" }, 429);

  const s = {
    id: batch, key_hash: lic.hash, key_last4: lic.last4, username: lic.username,
    name: String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60), slots, key_id: keyId,
  };
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const slug = s.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const who = [s.name ? `**${md(s.name)}**` : "", s.username ? `@${md(s.username)}` : "", `license …${s.key_last4}`].filter(Boolean).join(" · ");
  const storeLine = stores.map((x) => `${md(x.name)} ${x.n}${x.seller ? ` (${x.seller} need${x.seller === 1 ? "s" : ""} an account)` : ""}`).join(" · ").slice(0, 1200);
  const tail = csv !== null ? "-# CSV attached." : `-# Encrypted for key ${keyId}. To open: download the file, then in Orbit choose **Import** and drop it in.`;
  const content = `📦 **${slots} slot${slots === 1 ? "" : "s"}** from ${who}${storeLine ? `\n${storeLine}` : ""}\n${tail}`;
  const base = `orbit-slots-${stamp}${slug ? "-" + slug : ""}`;
  const file = csv !== null ? { name: base + ".csv", text: csv, type: "text/csv" } : { name: base + ".txt", text: code };
  // Recorded before posting, so a retry that arrives while this one is still posting isn't posted too.
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO submissions (id, key_hash, key_last4, name, username, slots, bytes, key_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(s.id, s.key_hash, s.key_last4, s.name, s.username, slots, file.text.length, s.key_id, now).run();
  if (!ins.meta || !ins.meta.changes) return json({ error: "still sending" }, 425);
  let msgId = null;
  try { msgId = await webhookPost(env, { content }, file); }
  catch (e) { console.error("webhook", e); }
  if (!msgId) {
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(s.id).run();
    return json({ error: "couldn't post to the channel" }, 502);
  }
  await env.DB.prepare("UPDATE submissions SET webhook_message_id = ? WHERE id = ?").bind(msgId, s.id).run().catch((e) => console.error("record", e));
  return json({ ok: true, id: s.id });
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
      env.DB.prepare("SELECT id, key_last4, name, username, slots, bytes, key_id, created_at FROM submissions ORDER BY created_at DESC LIMIT 200"),
      env.DB.prepare("SELECT id, key_last4, name, username, slots, key_id, created_at FROM pulls ORDER BY created_at DESC LIMIT 200"),
    ]);
    return json({ keys: keys.results.map(({ review_token, key_hash, ...k }) => ({ ...k, review_url: `${origin}/submit/review/${k.id}?t=${review_token}` })), submissions: subs.results, pulls: pulls.results });
  }
  if (request.method === "GET" && path === "/admin/applications") {
    const { results } = await env.DB.prepare(
      "SELECT discord_id, username, status, created_at, decided_at, review_token FROM applications ORDER BY created_at DESC").all();
    const origin = new URL(request.url).origin;
    return json({ applications: results.map(({ review_token, ...a }) => ({ ...a, review_url: `${origin}/review/${a.discord_id}?t=${review_token}` })) });
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

// ---- responses -----------------------------------------------------------------------

function json(data, statusCode = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status: statusCode, headers: { "content-type": "application/json", ...CORS, ...headers } });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function page(statusCode, title, msg, extra = "") {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Orbit · ${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1433;color:#e6ecff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
  main{max-width:440px;width:100%;background:#0f1d45;border:1px solid #2a3f7a;border-radius:16px;padding:28px;box-sizing:border-box}
  h1{margin:0 0 4px;font:600 34px Georgia,serif;color:#4a9dff}
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
</style></head><body><main><h1>Orbit</h1><h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ""}${extra}</main></body></html>`,
    { status: statusCode, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
