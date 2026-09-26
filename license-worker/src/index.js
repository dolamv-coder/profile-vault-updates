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
// Owner:
//   GET/POST /review/DISCORD_ID?t=TOKEN   approve or deny one request (link posted to the webhook)
//   GET  /admin/licenses       every key issued            (Authorization: Bearer ADMIN_TOKEN)
//   GET  /admin/applications   every request and decision
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

  // Accounts that already have a key always get it straight back.
  const existing = await env.DB.prepare("SELECT discord_id FROM licenses WHERE discord_id = ?").bind(user.id).first();
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

// One request per Discord account. Only the first sign-in posts to the owner's channel.
async function ensureApplication(env, ctx, origin, discordId, username) {
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO applications (discord_id, username, review_token, created_at) VALUES (?, ?, ?, ?)"
  ).bind(discordId, username, randomId(24), Date.now()).run();
  const app = await env.DB.prepare("SELECT * FROM applications WHERE discord_id = ?").bind(discordId).first();
  if (res.meta && res.meta.changes) {
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
  const btn = (a, text, cls) => `<form method="post"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="action" value="${a}"><button class="${cls}" type="submit">${text}</button></form>`;
  return page(200, "Key request", done || label,
    `<p class="who">@${esc(cur.username)}</p>
     <p class="small">Discord ID ${esc(cur.discord_id)}<br>Account created ${day(accountCreated(cur.discord_id))}<br>Requested ${esc(new Date(cur.created_at).toISOString().replace("T", " ").slice(0, 16))} UTC</p>
     ${done ? `<p class="small">Status: ${esc(label)}</p>` : ""}
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

async function webhookPost(env, payload) {
  if (!env.DISCORD_WEBHOOK_URL) return null;
  const u = new URL(env.DISCORD_WEBHOOK_URL);
  u.searchParams.set("wait", "true");
  const r = await fetch(u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, flags: SUPPRESS_EMBEDS, allowed_mentions: { parse: [] } }),
  });
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

// ---- owner tools ---------------------------------------------------------------------

async function admin(request, env, path) {
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || !(await sameText(auth, "Bearer " + env.ADMIN_TOKEN))) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" && path === "/admin/licenses") {
    const { results } = await env.DB.prepare(
      "SELECT discord_id, username, license_key, issued_at, revoked_at FROM licenses ORDER BY issued_at DESC").all();
    return json({ licenses: results });
  }
  if (request.method === "GET" && path === "/admin/applications") {
    const { results } = await env.DB.prepare(
      "SELECT discord_id, username, status, created_at, decided_at FROM applications ORDER BY created_at DESC").all();
    return json({ applications: results });
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
  .row form{flex:1;margin:0}
  button{width:100%;padding:12px;border:0;border-radius:10px;font:600 16px system-ui,sans-serif;cursor:pointer;color:#fff}
  button.ok{background:#1f9d5c} button.no{background:#c4372f}
</style></head><body><main><h1>Orbit</h1><h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ""}${extra}</main></body></html>`,
    { status: statusCode, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
