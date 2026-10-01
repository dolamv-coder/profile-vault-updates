// Orbit on the web: this worker's address serves the newest released Orbit page, the same file
// installed apps update to, so Orbit opens in any browser. It reads update.json, downloads the page it
// names, and serves it only if the page's SHA-256 matches and update.json's signature checks out
// against the publisher key built into the apps. Anything else keeps the last good page (or a short
// "try again" note if there's none yet).
//
// The page keeps its vault in the browser, encrypted, as it does in the desktop app. With sync on
// (1.9.65+), it opens the same vault as the desktop app through the license worker.

const UPDATE_URL = "https://raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/update.json";
// The apps' update key (index.html's updater checks the same signature).
const PUBLISHER_KEY = "MCowBQYDK2VwAyEAjMqbFzE6HEjJ+PZAxJdcRPQutn4Eh6YjedtapiYe48o=";
const SIG_CONTEXT = "profile-vault-update";
const CHECK_EVERY_MS = 60 * 1000;

const HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

let current = null;   // {version, sha256, html, checkedAt}: the last page that checked out

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed.");
    if (url.pathname === "/robots.txt") return text(200, "User-agent: *\nDisallow: /\n");
    if (url.pathname !== "/" && url.pathname !== "/index.html") return Response.redirect(url.origin + "/", 302);
    try { await refresh(env); } catch (e) { console.error("refresh", e && e.message || e); }
    if (!current) return text(503, "Orbit couldn't be loaded just now. Try again in a minute.");
    return new Response(request.method === "HEAD" ? null : current.html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-orbit-version": current.version, ...HEADERS },
    });
  },
};

// Looks at update.json at most once a minute per worker instance; downloads the page only when the
// release changed.
async function refresh(env) {
  const now = Date.now(), every = Number(env.CHECK_EVERY_MS) >= 0 && String(env.CHECK_EVERY_MS ?? "") !== "" ? Number(env.CHECK_EVERY_MS) : CHECK_EVERY_MS;
  if (current && now - current.checkedAt < every) return;
  if (current) current.checkedAt = now;   // a failed check isn't retried on every request
  const src = env.UPDATE_URL || UPDATE_URL;
  const res = await fetch(src + (src.includes("?") ? "&" : "?") + "t=" + now, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error("update.json answered " + res.status);
  const m = await res.json();
  if (current && m.version === current.version && m.sha256 === current.sha256) return;
  if (!m || typeof m.version !== "string" || typeof m.url !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256 || "") || typeof m.signature !== "string") throw new Error("update.json is incomplete");
  if (!(await signed(env, m))) throw new Error("update.json's signature doesn't check out");
  const page = await fetch(new URL(m.url, src).toString(), { headers: { "cache-control": "no-cache" } });
  if (!page.ok) throw new Error("the page answered " + page.status);
  const html = await page.arrayBuffer();
  if (hex(await crypto.subtle.digest("SHA-256", html)) !== m.sha256) throw new Error("the page doesn't match update.json");
  current = { version: m.version, sha256: m.sha256, html, checkedAt: now };
}

async function signed(env, m) {
  const der = Uint8Array.from(atob(env.PUBLISHER_KEY || PUBLISHER_KEY), (c) => c.charCodeAt(0));
  const msg = new TextEncoder().encode([SIG_CONTEXT, m.version, m.sha256, m.minAppVersion || "0"].join("\n"));
  let sig;
  try { sig = Uint8Array.from(atob(m.signature), (c) => c.charCodeAt(0)); } catch { return false; }
  for (const alg of [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }]) {
    try {
      const key = await crypto.subtle.importKey("spki", der, alg, false, ["verify"]);
      return await crypto.subtle.verify(alg, key, sig, msg);
    } catch { /* this runtime calls it the other name */ }
  }
  return false;
}

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const text = (status, body) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...HEADERS } });
