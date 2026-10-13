// FAFO's front page at https://fafoaco.com (the owner's domain, 2026-10-10): what FAFO is, and Login with Discord, which
// opens the web version (since 2026-10-13, the owner's request: no Windows download on it; /download still works for old
// links). Its look follows the site the owner pointed at that day (light, with a dark theme, big tight headings, mockups of
// FAFO's own screens with sample data); nothing of that site's is used. The same worker serves the app itself at
// app.fafoaco.com (and app.orbit-app.workers.dev); see index.js.

export const SITE_HOST = "fafoaco.com";
export const APP_URL = "https://app.fafoaco.com";
// The newest Windows download (the "Release desktop app" Action attaches it to each GitHub release), for /download.
export const DOWNLOAD_URL = "https://github.com/dolamv-coder/profile-vault-updates/releases/latest/download/FAFO-Windows.zip";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Line icons (24×24, drawn with the stroke), and the marks the app itself uses.
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M13.5 9.5l2 2"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
};
const ic = (name, cls = "") => `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const DISCORD = `<svg class="dc" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>`;
const POKEBALL = `<svg class="mk" viewBox="0 0 32 32" aria-hidden="true"><path d="M2 16a14 14 0 0 1 28 0z" fill="#EE1515"/><path d="M2 16a14 14 0 0 0 28 0z" fill="#F7F7F7"/><path d="M2 16h28" stroke="#222" stroke-width="3"/><circle cx="16" cy="16" r="14" fill="none" stroke="#222" stroke-width="2"/><circle cx="16" cy="16" r="5.4" fill="#222"/><circle cx="16" cy="16" r="3.1" fill="#F7F7F7"/></svg>`;
const BULLSEYE = `<svg class="mk" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#CC0000"/><circle cx="16" cy="16" r="10" fill="#FFFFFF"/><circle cx="16" cy="16" r="5.2" fill="#CC0000"/></svg>`;
const mark = (store) => (store === "pc" ? POKEBALL : BULLSEYE);
const PILLS = {
  ok: ["ok", "check", "Success"], wait: ["wait", "clock", "Pending approval"], no: ["no", "x", "Declined"],
  delivered: ["ok", "check", "Delivered"], shipped: ["sky", "truck", "Shipped"], placed: ["mute", "box", "Placed"], canceled: ["no", "x", "Canceled"],
};
const pill = (k) => `<span class="pill ${PILLS[k][0]}">${ic(PILLS[k][1])}${PILLS[k][2]}</span>`;
const check = (t) => `<li>${ic("check")}<span>${t}</span></li>`;

// Sample data for the mockups (this repo is public: no real names, addresses, cards or accounts).
const SUBMIT_ROWS = [
  ["t", "Target #1", "Visa •••• 4242", "ok"], ["t", "Target #2", "Visa •••• 1881", "ok"],
  ["pc", "Pokémon Center #1", "Mastercard •••• 5100", "wait"], ["t", "Target #3", "Amex •••• 0005", "ok"],
  ["pc", "Pokémon Center #2", "Visa •••• 7310", "wait"],
];
const ORDERS = [
  ["Elite Trainer Box", "t", 2, "delivered", "a"], ["Booster Bundle", "pc", 3, "shipped", "b"],
  ["Mini Tin", "t", 4, "placed", "c"], ["Booster Box", "pc", 1, "canceled", "d"],
];
const JIGS = [["Target #1", "214 Maple <b>Ave</b>"], ["Target #2", "214 Maple <b>Avenue</b>"], ["Target #3", "214 Maple <b>Ave.</b>"], ["Target #4", "214 Maple <b>Av</b>"]];

const loginBtn = (app, cls = "") => `<a class="btn btn-primary${cls ? " " + cls : ""}" href="${app}">${DISCORD}<span>Login with Discord</span></a>`;
// The header's, which says "Log in" on a phone.
const loginBtnSm = (app) => `<a class="btn btn-primary btn-sm" href="${app}" aria-label="Login with Discord">${DISCORD}<span class="long">Login with Discord</span><span class="short" aria-hidden="true">Log in</span></a>`;

// `version`: the release the web version serves now ("" when it isn't known yet). It's labelled the web version's: installed
// apps stay on their release while desktop updates are paused (channels.json).
export function sitePage(version, appUrl = APP_URL) {
  const v = /^[0-9.]{1,20}$/.test(version || "") ? version : "";
  const app = esc(appUrl), appHost = esc(appUrl.replace(/^https?:\/\//, ""));
  const year = new Date().getUTCFullYear();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FAFO</title>
<meta name="description" content="FAFO keeps your checkout profiles, cards and store logins encrypted, sends your slots to the seller in one batch, and tracks every order.">
<meta name="theme-color" content="#F8FAFC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B0F19" media="(prefers-color-scheme: dark)">
<script>try{var t=localStorage.getItem("fafo-site-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}document.documentElement.className+=" js"</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700;800&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bruno+Ace+SC&text=FAFO&display=swap">
<style>
:root{
  --bg:#F8FAFC; --bg-2:#F1F5F9; --card:#FFFFFF; --card-2:#F8FAFC; --ink:#0F172A; --ink-2:#475569; --ink-3:#64748B;
  --line:#E2E8F0; --line-2:#EEF2F6; --dot:rgba(15,23,42,.11); --glass:rgba(248,250,252,.78);
  --btn:#027BBB; --btn-hover:#0369A1; --link:#0369A1; --glow:rgba(14,165,233,.45);
  --grad:linear-gradient(180deg,#1FA9E8 0%,#0284C7 52%,#075985 100%);
  --ok:#047857; --ok-bg:#ECFDF5; --ok-line:#A7F3D0; --wait:#B45309; --wait-bg:#FFFBEB; --wait-line:#FDE68A;
  --no:#DC2626; --no-bg:#FEF2F2; --no-line:#FECACA; --sky:#0369A1; --sky-bg:#F0F9FF; --sky-line:#BAE6FD;
  --mute:#475569; --mute-bg:#F1F5F9; --mute-line:#E2E8F0;
  --shadow:0 1px 2px rgba(15,23,42,.06),0 10px 30px -14px rgba(15,23,42,.18);
  --shadow-lg:0 2px 6px rgba(15,23,42,.05),0 30px 70px -28px rgba(15,23,42,.32);
  --phone:#0F172A; --hero-glow:rgba(14,165,233,.13);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0B0F19; --bg-2:#0E1421; --card:#111827; --card-2:#0D1320; --ink:#F1F5F9; --ink-2:#A3B1C6; --ink-3:#8392A9;
  --line:rgba(148,163,184,.17); --line-2:rgba(148,163,184,.10); --dot:rgba(148,163,184,.15); --glass:rgba(11,15,25,.74);
  --link:#7DD3FC; --glow:rgba(14,165,233,.5);
  --grad:linear-gradient(180deg,#B5E8FF 0%,#38BDF8 50%,#0EA5E9 100%);
  --ok:#34D399; --ok-bg:rgba(16,185,129,.13); --ok-line:rgba(52,211,153,.32); --wait:#FBBF24; --wait-bg:rgba(245,158,11,.13); --wait-line:rgba(251,191,36,.32);
  --no:#F87171; --no-bg:rgba(239,68,68,.13); --no-line:rgba(248,113,113,.32); --sky:#7DD3FC; --sky-bg:rgba(14,165,233,.13); --sky-line:rgba(56,189,248,.32);
  --mute:#A3B1C6; --mute-bg:rgba(148,163,184,.12); --mute-line:rgba(148,163,184,.22);
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7);
  --shadow-lg:0 2px 6px rgba(0,0,0,.3),0 30px 70px -28px rgba(0,0,0,.9);
  --phone:#020617; --hero-glow:rgba(14,165,233,.16);
  color-scheme:dark;
}}
:root[data-theme="dark"]{
  --bg:#0B0F19; --bg-2:#0E1421; --card:#111827; --card-2:#0D1320; --ink:#F1F5F9; --ink-2:#A3B1C6; --ink-3:#8392A9;
  --line:rgba(148,163,184,.17); --line-2:rgba(148,163,184,.10); --dot:rgba(148,163,184,.15); --glass:rgba(11,15,25,.74);
  --link:#7DD3FC; --glow:rgba(14,165,233,.5);
  --grad:linear-gradient(180deg,#B5E8FF 0%,#38BDF8 50%,#0EA5E9 100%);
  --ok:#34D399; --ok-bg:rgba(16,185,129,.13); --ok-line:rgba(52,211,153,.32); --wait:#FBBF24; --wait-bg:rgba(245,158,11,.13); --wait-line:rgba(251,191,36,.32);
  --no:#F87171; --no-bg:rgba(239,68,68,.13); --no-line:rgba(248,113,113,.32); --sky:#7DD3FC; --sky-bg:rgba(14,165,233,.13); --sky-line:rgba(56,189,248,.32);
  --mute:#A3B1C6; --mute-bg:rgba(148,163,184,.12); --mute-line:rgba(148,163,184,.22);
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7);
  --shadow-lg:0 2px 6px rgba(0,0,0,.3),0 30px 70px -28px rgba(0,0,0,.9);
  --phone:#020617; --hero-glow:rgba(14,165,233,.16);
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:84px}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:400 16px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
a{color:inherit}
.i{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.dc{width:1.15em;height:1.15em;flex:none}
.mk{width:1em;height:1em;flex:none;display:block}
.wrap{max-width:1224px;margin:0 auto;padding:0 24px}
.skip{position:absolute;left:12px;top:-60px;z-index:100;background:var(--card);color:var(--ink);padding:10px 14px;border-radius:10px;box-shadow:var(--shadow)}
.skip:focus{top:12px}
:focus-visible{outline:2px solid #0EA5E9;outline-offset:3px;border-radius:8px}
.wordmark{font-family:"Bruno Ace SC",system-ui,sans-serif;letter-spacing:.02em;line-height:1;text-decoration:none;color:var(--ink)}
.display{font-family:"Inter Tight","Inter",system-ui,sans-serif;font-weight:700;letter-spacing:-.035em;line-height:1.02;margin:0;color:var(--ink)}
.grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;padding-bottom:.06em}

/* Header */
.top{position:sticky;top:0;z-index:50;background:var(--glass);-webkit-backdrop-filter:saturate(1.6) blur(14px);backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid transparent;transition:border-color .2s}
.scrolled .top{border-bottom-color:var(--line)}
.top .wrap{height:64px;display:flex;align-items:center;gap:16px}
.top .wordmark{font-size:25px;margin-right:auto}
.nav{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:4px}
.nav a,.navlink{display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:10px;color:var(--ink-2);font-size:14.5px;font-weight:500;text-decoration:none;white-space:nowrap}
.nav a:hover,.navlink:hover{color:var(--ink);background:var(--bg-2)}
.acts{display:flex;align-items:center;gap:8px}
.tbtn{display:none;width:40px;height:40px;border-radius:12px;border:0;background:transparent;color:var(--ink-2);font-size:19px;align-items:center;justify-content:center;cursor:pointer}
.js .tbtn{display:inline-flex}
.tbtn:hover{background:var(--bg-2);color:var(--ink)}
.tbtn .i-moon{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .tbtn .i-moon{display:block}:root:not([data-theme="light"]) .tbtn .i-sun{display:none}}
:root[data-theme="dark"] .tbtn .i-moon{display:block}:root[data-theme="dark"] .tbtn .i-sun{display:none}
.menu{display:none;position:relative}
.menu summary{list-style:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--ink-2);font-size:21px;cursor:pointer}
.menu summary::-webkit-details-marker{display:none}
.menu summary:hover{background:var(--bg-2)}
.menu .panel{position:absolute;right:0;top:48px;min-width:210px;padding:8px;border-radius:16px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow-lg);display:grid}
.menu .panel a{padding:11px 12px;border-radius:10px;text-decoration:none;color:var(--ink);font-weight:500}
.menu .panel a:hover{background:var(--bg-2)}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:54px;padding:0 26px 0 24px;border-radius:16px;font-weight:600;font-size:16px;letter-spacing:-.005em;text-decoration:none;white-space:nowrap;transition:background .15s,transform .15s,box-shadow .15s,border-color .15s}
.btn:active{transform:translateY(1px)}
.btn-primary{background:var(--btn);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(2,6,23,.12),0 10px 28px -10px var(--glow)}
.btn-primary:hover{background:var(--btn-hover)}
.btn-ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.btn-ghost:hover{border-color:var(--ink-3)}
.btn-sm{height:40px;padding:0 16px 0 14px;border-radius:12px;font-size:14.5px;gap:8px}
.btn-sm .short{display:none}

/* Hero */
.hero{position:relative;overflow-x:hidden;background:radial-gradient(900px 520px at 78% -8%,var(--hero-glow),transparent 70%)}
@supports (overflow:clip){.hero{overflow-x:clip}}
.hero-grid{display:grid;grid-template-columns:minmax(0,600px) minmax(0,1fr);gap:40px;align-items:center;padding-top:72px;padding-bottom:72px;min-height:640px}
.hero h1{font-size:clamp(42px,4vw + 12px,70px)}
.hero h1 span{display:block}
.lead{margin:28px 0 0;color:var(--ink-2);font-size:18.5px;line-height:1.62;max-width:34em}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:36px}
.meta{display:flex;align-items:center;gap:10px;margin:28px 0 0;color:var(--ink-3);font-size:14.5px}
.live{width:8px;height:8px;border-radius:50%;background:#10B981;box-shadow:0 0 0 4px rgba(16,185,129,.16);flex:none}

/* Hero mockups */
.scene{position:relative;height:560px}
.win{position:absolute;left:0;top:56px;width:780px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow-lg);overflow:hidden;transform:perspective(2200px) rotateY(-9deg) rotateX(3deg);transform-origin:left center}
.bar{display:flex;align-items:center;gap:7px;height:42px;padding:0 16px;border-bottom:1px solid var(--line-2);background:var(--card-2)}
.bar i{width:11px;height:11px;border-radius:50%;background:#F87171}
.bar i:nth-child(2){background:#FBBF24}.bar i:nth-child(3){background:#34D399}
.url{margin:0 auto;display:flex;align-items:center;gap:6px;height:26px;padding:0 12px;border-radius:8px;background:var(--bg-2);color:var(--ink-3);font-size:12.5px}
.url .i{font-size:11px}
.app{display:grid;grid-template-columns:52px 1fr;min-height:430px}
.side{border-right:1px solid var(--line-2);padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:4px}
.side .wordmark{font-size:11px;padding:4px 0 12px}
.side span{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;color:var(--ink-3)}
.side span .i{font-size:16px}
.side span.on{background:var(--sky-bg);color:var(--sky)}
.main{padding:18px 20px}
.mh{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.mh h4{margin:0;font:700 19px/1.2 "Inter Tight","Inter",sans-serif;letter-spacing:-.02em}
.mh small{display:block;color:var(--ink-3);font-size:12px;margin-top:3px}
.chips{display:flex;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:8px;border:1px solid var(--line);font-size:11.5px;font-weight:500;color:var(--ink-2);background:var(--card)}
.chip.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
.chip b{font-weight:700}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0 14px}
.stat{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center}
.stat .t{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none}
.stat strong{display:block;font:700 18px/1 "Inter Tight","Inter",sans-serif;font-variant-numeric:tabular-nums}
.stat small{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-top:3px}
.t.ok{background:var(--ok-bg);color:var(--ok)}.t.wait{background:var(--wait-bg);color:var(--wait)}.t.sky{background:var(--sky-bg);color:var(--sky)}.t.no{background:var(--no-bg);color:var(--no)}.t.mute{background:var(--mute-bg);color:var(--mute)}
.rows{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{display:grid;grid-template-columns:30px 18px 1fr auto;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--line-2);font-size:12.5px}
.row:first-child{border-top:0}
.row .mk{font-size:16px}
.row b{font-weight:600}
.row small{color:var(--ink-3);font-size:11.5px;margin-left:8px}
.sw{width:28px;height:16px;border-radius:9px;background:#0EA5E9;position:relative}
.sw::after{content:"";position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff}
.sw.off{background:var(--line)}.sw.off::after{right:auto;left:2px}
.pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid;white-space:nowrap}
.pill .i{font-size:11px;stroke-width:2.6}
.pill.ok{color:var(--ok);background:var(--ok-bg);border-color:var(--ok-line)}
.pill.wait{color:var(--wait);background:var(--wait-bg);border-color:var(--wait-line)}
.pill.no{color:var(--no);background:var(--no-bg);border-color:var(--no-line)}
.pill.sky{color:var(--sky);background:var(--sky-bg);border-color:var(--sky-line)}
.pill.mute{color:var(--mute);background:var(--mute-bg);border-color:var(--mute-line)}

.phone{position:absolute;right:-96px;top:96px;width:262px;height:534px;border-radius:46px;background:var(--phone);padding:10px;box-shadow:0 40px 80px -30px rgba(2,6,23,.55),0 0 0 1px rgba(148,163,184,.25)}
.screen{height:100%;border-radius:37px;background:var(--bg);overflow:hidden;position:relative;padding:44px 14px 14px}
.notch{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:92px;height:26px;border-radius:14px;background:#020617}
.sbar{position:absolute;left:24px;right:22px;top:14px;display:flex;justify-content:space-between;font:600 12px/1 "Inter",sans-serif}
.sbar i{width:22px;height:10px;border-radius:3px;border:1.5px solid currentColor;display:block;position:relative}
.sbar i::after{content:"";position:absolute;inset:1.5px 5px 1.5px 1.5px;background:currentColor;border-radius:1px}
.screen h5{margin:6px 2px 10px;font:700 24px/1 "Inter Tight","Inter",sans-serif;letter-spacing:-.03em}
.screen .chips{margin-bottom:12px}
.screen .chip{height:24px;font-size:10.5px;padding:0 9px}
.stick{border:1px solid var(--line);background:var(--card);border-radius:16px;padding:12px}
.stick .lab{display:flex;justify-content:space-between;align-items:baseline;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.stick strong{font:800 30px/1 "Inter Tight","Inter",sans-serif;letter-spacing:-.03em;color:var(--ok);display:block;margin:6px 0 8px}
.meter{display:flex;height:7px;border-radius:5px;overflow:hidden;gap:2px}
.meter i{background:#10B981}.meter i+i{background:#F87171}
.stick small{display:block;margin-top:7px;font-size:10.5px;color:var(--ink-3)}
.olist{margin-top:10px;display:grid;gap:8px}
.order{display:grid;grid-template-columns:36px 1fr;gap:9px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px}
.thumb{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.95);font-size:17px}
.thumb.a{background:linear-gradient(135deg,#FDE68A,#F59E0B)}.thumb.b{background:linear-gradient(135deg,#C4B5FD,#7C3AED)}.thumb.c{background:linear-gradient(135deg,#99F6E4,#0D9488)}.thumb.d{background:linear-gradient(135deg,#FECACA,#E11D48)}
.order b{display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.order span.s{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:3px;font-size:10.5px;color:var(--ink-3)}
.order .pill{height:19px;font-size:9.5px;padding:0 6px}
.order .q{display:inline-flex;align-items:center;gap:5px}
.order .q .mk{font-size:12px}

.toast{position:absolute;display:flex;align-items:center;gap:11px;padding:11px 16px 11px 11px;border-radius:16px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow-lg);z-index:3;animation:float 6s ease-in-out infinite}
.toast .t{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:17px;flex:none}
.toast b{display:block;font-size:13.5px;font-weight:600}
.toast small{display:block;font-size:12px;color:var(--ink-3);margin-top:1px}
.toast.a{left:230px;top:0}
.toast.b{left:-12px;bottom:28px;animation-delay:-3s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

/* Stores */
.stores{display:flex;align-items:center;flex-wrap:wrap;gap:14px 40px;padding:30px 0 0;border-top:1px solid var(--line);color:var(--ink-3);font-size:15.5px}
.store{display:inline-flex;align-items:center;gap:10px;color:var(--ink-2);font-weight:600;font-size:17px}
.store .mk{font-size:22px}

/* Sections */
section.sec{padding:120px 0 0}
.head{max-width:680px}
.head h2{font-size:clamp(34px,3.2vw + 10px,56px);letter-spacing:-.034em;line-height:1.04}
.head p{margin:20px 0 0;color:var(--ink-2);font-size:18px;line-height:1.62}
.center{margin:0 auto;text-align:center}

/* Steps, stacked as you scroll */
.stack{margin-top:64px;display:grid;gap:36px}
.step{position:sticky;top:calc(92px + var(--n) * 14px);display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:48px;align-items:center;min-height:560px;padding:40px;border-radius:30px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden;isolation:isolate}
.step::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(640px 360px at 100% 0%,var(--tint-bg),transparent 70%)}
.step.s1{--tint:#6366F1;--tint-bg:rgba(99,102,241,.10)}.step.s2{--tint:#0EA5E9;--tint-bg:rgba(14,165,233,.11)}
.step.s3{--tint:#10B981;--tint-bg:rgba(16,185,129,.11)}.step.s4{--tint:#F59E0B;--tint-bg:rgba(245,158,11,.12)}
.num{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;font-weight:700;font-size:15px;color:var(--tint);background:color-mix(in srgb,var(--tint) 12%,transparent);border:1px solid color-mix(in srgb,var(--tint) 35%,transparent)}
.step h3{margin:22px 0 0;font-size:clamp(28px,1.6vw + 14px,38px);letter-spacing:-.03em;line-height:1.08}
.step p{margin:14px 0 0;color:var(--ink-2);font-size:17px;line-height:1.62}
.ticks{list-style:none;margin:26px 0 0;padding:0;display:grid;gap:12px;color:var(--ink-2);font-size:15px}
.ticks li{display:flex;gap:10px;align-items:flex-start}
.ticks .i{width:18px;height:18px;padding:3px;margin-top:1px;border-radius:50%;color:var(--tint,#0EA5E9);background:color-mix(in srgb,var(--tint,#0EA5E9) 14%,transparent);stroke-width:3}
.art{position:relative;height:100%;min-height:470px;border-radius:22px;border:1px solid var(--line);background:radial-gradient(circle,var(--dot) 1px,transparent 1.3px) 0 0/18px 18px,radial-gradient(520px 320px at 85% 15%,var(--tint-bg),transparent 70%),var(--card-2);display:flex;align-items:center;justify-content:center;padding:28px;overflow:hidden}
.panel-card{width:min(100%,380px);background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow-lg);padding:18px}
.pc-h{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:600;font-size:14.5px;margin-bottom:12px}
.pc-h small{color:var(--ink-3);font-weight:500;font-size:12.5px}
.flow{display:flex;align-items:center;justify-content:center;gap:12px;margin:6px 0 18px}
.tile{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;box-shadow:0 10px 24px -10px rgba(2,6,23,.5)}
.tile.dc-t{background:#5865F2}.tile.ff{background:#0F172A;font-size:15px}
.tile.ff .wordmark{color:#fff}
.dash{width:70px;height:2px;background:repeating-linear-gradient(90deg,var(--ink-3) 0 6px,transparent 6px 11px);opacity:.6}
.srow{display:flex;align-items:center;gap:12px;padding:11px 4px;border-top:1px solid var(--line-2)}
.srow .t{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.srow b{display:block;font-size:13.5px;font-weight:600}
.srow small{display:block;color:var(--ink-3);font-size:12px;margin-top:1px;font-variant-numeric:tabular-nums}
.lock-c{text-align:center;padding:26px 22px}
.lock-c .wordmark{font-size:34px}
.lock-c p{margin:8px 0 18px;color:var(--ink-3);font-size:13px}
.field{display:flex;align-items:center;justify-content:space-between;height:46px;padding:0 14px;border-radius:12px;border:1.5px solid #0EA5E9;box-shadow:0 0 0 4px rgba(14,165,233,.14);font-size:20px;letter-spacing:.12em;color:var(--ink);background:var(--card)}
.field .i{font-size:17px;color:var(--ink-3);letter-spacing:0}
.fake-btn{margin-top:12px;height:44px;border-radius:12px;background:var(--btn);color:#fff;font-weight:600;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:8px}
.badge{position:absolute;display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:12px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;font-weight:600;color:var(--ink-2);white-space:nowrap}
.badge .i{font-size:15px;color:var(--tint)}
.badge.b1{left:6%;top:14%}.badge.b2{right:6%;bottom:14%}
.jig{display:grid;grid-template-columns:18px 86px 1fr;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid var(--line-2);font-size:13px}
.jig .mk{font-size:17px}
.jig span{font-weight:600}
.jig em{font-style:normal;color:var(--ink-2)}
.jig em b{color:var(--ok);font-weight:700}
.chip.tint{border-color:color-mix(in srgb,var(--tint) 40%,transparent);color:var(--tint);background:color-mix(in srgb,var(--tint) 10%,transparent)}
.sub{display:grid;grid-template-columns:30px 18px 1fr auto;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid var(--line-2);font-size:13px}
.sub .mk{font-size:17px}
.sub b{font-weight:600}

/* Bento */
.bento{margin-top:56px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px}
.cell{grid-column:span 6;border-radius:26px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);padding:22px;display:flex;flex-direction:column;overflow:hidden}
.cell.w7{grid-column:span 7}.cell.w5{grid-column:span 5}
.cell .art{min-height:250px;height:auto;border-radius:18px;--tint-bg:rgba(14,165,233,.09)}
.cell h3{margin:22px 6px 0;font:700 21px/1.25 "Inter Tight","Inter",sans-serif;letter-spacing:-.02em}
.cell p{margin:8px 6px 6px;color:var(--ink-2);font-size:15.5px;line-height:1.6}
.track{width:min(100%,430px)}
.track .top-r{display:flex;gap:12px;align-items:center}
.track .thumb{width:46px;height:46px;border-radius:12px;font-size:22px}
.track b{display:block;font-size:14px}
.track small{display:block;color:var(--ink-3);font-size:12px;margin-top:2px}
.steps-line{display:grid;grid-template-columns:repeat(4,1fr);margin-top:22px;position:relative}
.steps-line::before{content:"";position:absolute;left:12.5%;right:12.5%;top:9px;height:3px;border-radius:2px;background:linear-gradient(90deg,#10B981 0 66%,var(--line) 66%)}
.steps-line span{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-3)}
.steps-line span::before{content:"";width:20px;height:20px;border-radius:50%;background:var(--card);border:3px solid var(--line);box-sizing:border-box}
.steps-line span.d::before{border-color:#10B981;background:#10B981;box-shadow:inset 0 0 0 3px var(--card)}
.steps-line span.d{color:var(--ink);font-weight:600}
.big{text-align:center}
.big strong{display:block;font:800 64px/1 "Inter Tight","Inter",sans-serif;letter-spacing:-.04em;color:var(--ok)}
.big .meter{width:250px;height:10px;margin:16px auto 10px}
.big small{color:var(--ink-3);font-size:13px}
.pics{display:grid;grid-template-columns:repeat(3,64px);gap:12px}
.pics .thumb{width:64px;height:64px;border-radius:16px;font-size:26px;box-shadow:var(--shadow)}
.pics .thumb.e{background:linear-gradient(135deg,#BAE6FD,#0284C7)}.pics .thumb.f{background:linear-gradient(135deg,#FBCFE8,#DB2777)}
.pics .found{position:relative}
.pics .found::after{content:"";position:absolute;inset:-5px;border-radius:20px;border:2px solid #0EA5E9}
.pics .spark{position:absolute;right:-9px;top:-9px;width:24px;height:24px;border-radius:50%;background:#0EA5E9;color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;z-index:1}
.devices{display:flex;align-items:center;gap:18px}
.dev{background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--ink-2);font-size:12.5px;font-weight:600}
.dev .i{font-size:28px;color:var(--ink)}
.dev.pc{width:170px;height:118px;border-radius:16px}.dev.ph{width:84px;height:140px;border-radius:20px}
.syncdot{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--ok);font-size:11.5px;font-weight:600}
.syncdot .t{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px}

/* FAQ */
.faq{display:grid;grid-template-columns:minmax(0,400px) minmax(0,1fr);gap:64px;align-items:start}
.faq .head p a{color:var(--link)}
.qs{border-top:1px solid var(--line)}
.qs details{border-bottom:1px solid var(--line)}
.qs summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;cursor:pointer;font-weight:600;font-size:17.5px;letter-spacing:-.01em}
.qs summary::-webkit-details-marker{display:none}
.qs summary .pm{width:32px;height:32px;border-radius:50%;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--ink-2);flex:none;transition:transform .2s,background .2s,color .2s,border-color .2s}
.qs details[open] summary .pm{transform:rotate(45deg);background:var(--btn);border-color:var(--btn);color:#fff}
.qs details p{margin:-6px 56px 24px 0;color:var(--ink-2);font-size:16px;line-height:1.65}

/* Last call */
.final{position:relative;isolation:isolate;overflow:hidden;margin-top:128px;border-radius:34px;background:#040914;color:#F8FAFC;text-align:center;padding:100px 24px 104px}
.final::before{content:"";position:absolute;inset:-30% -10%;z-index:-2;background:radial-gradient(42% 22% at 28% 74%,rgba(56,189,248,.55),transparent 70%),radial-gradient(36% 16% at 74% 36%,rgba(14,165,233,.45),transparent 72%),radial-gradient(70% 34% at 50% 112%,rgba(2,132,199,.85),transparent 70%),radial-gradient(40% 30% at 90% 90%,rgba(99,102,241,.35),transparent 70%);filter:blur(28px)}
.streak{position:absolute;left:-15%;right:-15%;height:3px;z-index:-1;border-radius:3px;background:linear-gradient(90deg,transparent 0%,rgba(125,211,252,.0) 12%,rgba(186,230,253,.95) 48%,rgba(56,189,248,.6) 62%,transparent 88%);filter:blur(1.2px);box-shadow:0 0 24px 6px rgba(56,189,248,.45)}
.streak.a{top:64%;transform:rotate(-7deg)}.streak.b{top:30%;transform:rotate(5deg);opacity:.55}.streak.c{top:84%;transform:rotate(-2deg);opacity:.4}
.final .wordmark{color:#fff;font-size:44px;text-shadow:0 0 34px rgba(56,189,248,.55)}
.final h2{color:#fff;margin:26px auto 0;font-size:clamp(34px,3vw + 12px,56px);max-width:12em}
.final p{margin:18px auto 0;max-width:30em;color:#CBD5E1;font-size:18px;line-height:1.6}
.final .cta{justify-content:center}
.final .btn-ghost{background:rgba(255,255,255,.06);color:#fff;border-color:rgba(255,255,255,.22)}
.final .btn-ghost:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.4)}

/* Footer */
footer{margin-top:96px;border-top:1px solid var(--line)}
.foot{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(2,minmax(0,1fr));gap:40px;padding:56px 0 48px}
.foot .wordmark{font-size:26px}
.foot p{margin:16px 0 0;color:var(--ink-2)}
.foot h4{margin:0 0 14px;font-size:14.5px;font-weight:600}
.foot ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.foot li a{color:var(--ink-2);text-decoration:none}
.foot li a:hover{color:var(--ink)}
.base{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:24px 0 36px;border-top:1px solid var(--line);color:var(--ink-3);font-size:14px}
.base a{color:var(--ink-2)}

@media (max-width:1100px){
  .win{width:640px}
  .phone{right:-60px}
}
@media (max-width:980px){
  .hero-grid{grid-template-columns:minmax(0,1fr);padding-top:48px;padding-bottom:48px;min-height:0}
  .scene{height:600px;max-width:520px;width:100%;margin:8px auto 0}
  .win{display:none}
  .phone{left:50%;right:auto;top:30px;transform:translateX(-50%)}
  .toast.a{left:auto;right:0;top:120px}
  .toast.b{left:0;bottom:70px}
  .step{grid-template-columns:minmax(0,1fr);gap:32px;min-height:0}
  .art{min-height:380px}
  .faq{grid-template-columns:minmax(0,1fr);gap:28px}
}
@media (max-width:860px){
  .nav,.acts .navlink{display:none}
  .menu{display:block}
}
@media (max-width:760px){
  .wrap{padding-left:16px;padding-right:16px}
  .top .wordmark{font-size:22px}
  .acts .btn-sm .long{display:none}
  .acts .btn-sm .short{display:inline}
  .acts{gap:4px}
  .lead{font-size:17px}
  .cta .btn{width:100%}
  .scene{height:570px}
  .toast{padding:9px 12px 9px 9px}
  .toast.a{top:96px;right:-4px}
  .toast.b{left:-4px;bottom:54px}
  section.sec{padding-top:88px}
  .stack{gap:20px}
  .step{position:relative;top:auto;padding:22px;border-radius:24px}
  .art{min-height:340px;padding:18px;border-radius:18px}
  .badge.b1{left:10px;top:12px}.badge.b2{right:10px;bottom:12px}
  .bento{grid-template-columns:minmax(0,1fr);gap:16px}
  .cell,.cell.w7,.cell.w5{grid-column:auto;padding:16px}
  .qs details p{margin-right:0}
  .devices{gap:10px}
  .dev.pc{width:120px;height:96px}.dev.ph{width:68px;height:116px}
  .stores{gap:12px 28px}
  .final{margin-top:96px;padding:72px 20px 76px;border-radius:26px}
  .final .wordmark{font-size:36px}
  footer{margin-top:88px}
  .foot{grid-template-columns:repeat(2,minmax(0,1fr));gap:32px 20px}
  .foot>div:first-child{grid-column:1/-1}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.toast{animation:none}.btn,.qs summary .pm{transition:none}}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="wordmark" href="/" aria-label="FAFO home">FAFO</a>
    <nav class="nav" aria-label="Sections"><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a></nav>
    <div class="acts">
      <button class="tbtn" type="button" aria-label="Switch between light and dark" title="Light or dark">${ic("sun", "i-sun")}${ic("moon", "i-moon")}</button>
      <a class="navlink" href="${app}">Open FAFO</a>
      ${loginBtnSm(app)}
      <details class="menu"><summary aria-label="Menu">${ic("menu")}</summary><div class="panel"><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a><a href="${app}">Open FAFO</a></div></details>
    </div>
  </div>
</header>
<main id="main">
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <h1 class="display"><span>Your slots in.</span><span class="grad">Your orders tracked.</span></h1>
        <p class="lead">FAFO keeps your checkout profiles, cards and store logins encrypted, sends your slots to the seller in one batch, and follows every order from your email.</p>
        <div class="cta">${loginBtn(app)}<a class="btn btn-ghost" href="#how">How it works</a></div>
        <p class="meta"><span class="live" aria-hidden="true"></span><span>${v ? `Web version ${esc(v)} · ` : ""}Encrypted with your master password</span></p>
      </div>
      <div class="scene" aria-hidden="true">
        <div class="toast a"><span class="t ok">${ic("check")}</span><span><b>Batch approved</b><small>8 slots · just now</small></span></div>
        <div class="win">
          <div class="bar"><i></i><i></i><i></i><span class="url">${ic("lock")}${appHost}</span></div>
          <div class="app">
            <div class="side"><span class="wordmark">FAFO</span><span>${ic("user")}</span><span>${ic("card")}</span><span>${ic("key")}</span><span class="on">${ic("send")}</span><span>${ic("box")}</span><span>${ic("layers")}</span></div>
            <div class="main">
              <div class="mh"><div><h4>Submit</h4><small>Slots switched on go to your seller in one batch</small></div><div class="chips"><span class="chip on">All</span><span class="chip">${POKEBALL}<b>4</b></span><span class="chip">${BULLSEYE}<b>8</b></span></div></div>
              <div class="stats"><div class="stat"><span class="t sky">${ic("send")}</span><span><strong>12</strong><small>Slots on</small></span></div><div class="stat"><span class="t wait">${ic("clock")}</span><span><strong>4</strong><small>Pending</small></span></div><div class="stat"><span class="t ok">${ic("check")}</span><span><strong>8</strong><small>Success</small></span></div></div>
              <div class="rows">${SUBMIT_ROWS.map(([s, n, c, p]) => `<div class="row"><span class="sw"></span>${mark(s)}<span><b>${n}</b><small>${c}</small></span>${pill(p)}</div>`).join("")}</div>
            </div>
          </div>
        </div>
        <div class="phone"><div class="screen"><span class="notch"></span><span class="sbar"><span>9:41</span><i></i></span>
          <h5>Orders</h5>
          <div class="chips"><span class="chip">Today</span><span class="chip on">Weekly</span><span class="chip">Overall</span></div>
          <div class="stick"><span class="lab"><span>Stick rate</span><span>This week</span></span><strong>92%</strong><span class="meter"><i style="flex:23"></i><i style="flex:2"></i></span><small>23 kept · 2 canceled</small></div>
          <div class="olist">${ORDERS.map(([n, s, q, st, th]) => `<div class="order"><span class="thumb ${th}">${ic("box")}</span><span><b>${n}</b><span class="s"><span class="q">${mark(s)}×${q}</span>${pill(st)}</span></span></div>`).join("")}</div>
        </div></div>
        <div class="toast b"><span class="t sky">${ic("truck")}</span><span><b>Delivered</b><small>Target · 2:14 PM</small></span></div>
      </div>
    </div>
    <div class="wrap"><div class="stores"><span>Made for</span><span class="store">${POKEBALL}Pokémon Center</span><span class="store">${BULLSEYE}Target</span></div></div>
  </section>

  <section class="sec" id="how">
    <div class="wrap">
      <div class="head"><h2 class="display">From sign-in to Success.</h2><p>Set up once, switch your slots on when the drop is announced, and watch them go from Pending approval to Success.</p></div>
      <div class="stack">
        <article class="step s1" style="--n:0">
          <div><span class="num">1</span><h3 class="display">Log in with Discord</h3><p>One click with your Discord account. Your seller approves you, and your license arrives in FAFO on its own.</p>
            <ul class="ticks">${check("Nothing to install or copy")}${check("Your seller approves every new member")}</ul></div>
          <div class="art" aria-hidden="true"><div class="panel-card">
            <div class="flow"><span class="tile dc-t">${DISCORD}</span><span class="dash"></span><span class="tile ff"><span class="wordmark">FAFO</span></span></div>
            <div class="srow"><span class="t ok">${ic("check")}</span><span><b>Signed in with Discord</b><small>@yourname</small></span></div>
            <div class="srow"><span class="t ok">${ic("check")}</span><span><b>Approved by your seller</b><small>You're in</small></span></div>
            <div class="srow"><span class="t sky">${ic("key")}</span><span><b>License ready</b><small>PVLT-••••-••••-••••-7Q2C</small></span></div>
          </div></div>
        </article>
        <article class="step s2" style="--n:1">
          <div><span class="num">2</span><h3 class="display">Choose your master password</h3><p>It encrypts your profiles, cards and logins before they're saved or synced. Only you know it, so only you can open your vault.</p>
            <ul class="ticks">${check("With sync, the same vault on your computer and phone")}${check("No one can reset it, not even your seller")}</ul></div>
          <div class="art" aria-hidden="true">
            <span class="badge b1">${ic("lock")}Encrypted before it's saved</span>
            <div class="panel-card lock-c"><span class="wordmark">FAFO</span><p>Cop it. Track it. FAFO.</p><div class="field"><span>••••••••••••</span>${ic("eye")}</div><div class="fake-btn">${ic("lock")}Unlock</div></div>
            <span class="badge b2">${ic("sync")}Sealed before it syncs</span>
          </div>
        </article>
        <article class="step s3" style="--n:2">
          <div><span class="num">3</span><h3 class="display">Build your profiles</h3><p>One profile per store. Generate them in bulk, jig each address the ways USPS reads as the same one, and add your cards and store logins.</p>
            <ul class="ticks">${check("Generate, Mass edit and Duplicate")}${check("Jig for Target or Pokémon Center")}</ul></div>
          <div class="art" aria-hidden="true"><div class="panel-card">
            <div class="pc-h"><span>Generate</span><span class="chip tint">${ic("shuffle")}Jig for Target</span></div>
            ${JIGS.map(([n, a]) => `<div class="jig">${BULLSEYE}<span>${n}</span><em>${a}</em></div>`).join("")}
            <div class="fake-btn">${ic("plus")}Import 4 profiles</div>
          </div></div>
        </article>
        <article class="step s4" style="--n:3">
          <div><span class="num">4</span><h3 class="display">Submit your slots</h3><p>Switch slots on and send them to your seller in one batch. Each shows Pending approval, then Success once your seller approves it.</p>
            <ul class="ticks">${check("Use Assigned Account when you have no store login")}${check("Declined slots can go out again in a new batch")}</ul></div>
          <div class="art" aria-hidden="true">
            <div class="panel-card">
              <div class="pc-h"><span>Submit</span><small>4 slots on</small></div>
              <div class="sub"><span class="sw"></span>${BULLSEYE}<b>Target #1</b>${pill("ok")}</div>
              <div class="sub"><span class="sw"></span>${BULLSEYE}<b>Target #2</b>${pill("ok")}</div>
              <div class="sub"><span class="sw"></span>${POKEBALL}<b>Pokémon Center #1</b>${pill("wait")}</div>
              <div class="sub"><span class="sw"></span>${POKEBALL}<b>Pokémon Center #2</b>${pill("wait")}</div>
              <div class="fake-btn">${ic("send")}Send to your seller</div>
            </div>
            <span class="badge b2">${ic("check")}Your seller approved 2 slots</span>
          </div>
        </article>
      </div>
    </div>
  </section>

  <section class="sec" id="features">
    <div class="wrap">
      <div class="head"><h2 class="display">Everything after checkout, handled.</h2><p>Your orders, their pictures and your stick rate keep themselves up to date, so all that's left is the next drop.</p></div>
      <div class="bento">
        <div class="cell w7"><div class="art" aria-hidden="true"><div class="panel-card track">
          <div class="top-r"><span class="thumb a">${ic("box")}</span><span><b>Elite Trainer Box ×2</b><small>Target · Order #4471-0290</small></span></div>
          <div class="steps-line"><span class="d">Placed</span><span class="d">Shipped</span><span class="d">Arriving</span><span>Delivered</span></div>
        </div></div><h3>Every order, tracked.</h3><p>Placed, shipped, arriving, delivered or canceled: every step, read from your order emails.</p></div>
        <div class="cell w5"><div class="art" aria-hidden="true"><div class="big"><strong>92%</strong><span class="meter"><i style="flex:23"></i><i style="flex:2"></i></span><small>23 kept · 2 canceled</small></div></div><h3>Your stick rate, per drop.</h3><p>See how many of a drop's items weren't canceled, right on its success card.</p></div>
        <div class="cell w5"><div class="art" aria-hidden="true"><div class="pics"><span class="thumb a">${ic("box")}</span><span class="thumb e">${ic("box")}</span><span class="thumb b">${ic("box")}</span><span class="thumb c">${ic("box")}</span><span class="thumb found f"><span class="spark">${ic("sparkle")}</span>${ic("image")}</span><span class="thumb d">${ic("box")}</span></div></div><h3>Pictures, found for you.</h3><p>Orders get their product's picture on their own. Paste or drop your own any time.</p></div>
        <div class="cell w7"><div class="art" aria-hidden="true"><div class="devices"><span class="dev pc">${ic("monitor")}Computer</span><span class="syncdot"><span class="t ok">${ic("sync")}</span>Synced</span><span class="dev ph">${ic("phone")}Phone</span></div></div><h3>One vault, every screen.</h3><p>Turn on sync to use the same vault on your computer and your phone. It's encrypted before it leaves either one.</p></div>
      </div>
    </div>
  </section>

  <section class="sec" id="faq">
    <div class="wrap faq">
      <div class="head"><h2 class="display">Questions, answered.</h2><p>Still stuck? Ask your seller in their Discord.</p></div>
      <div class="qs">
        <details open><summary>How do I get a license?<span class="pm">${ic("plus")}</span></summary><p>Choose Login with Discord. Your seller approves you, and your license arrives in FAFO on its own.</p></details>
        <details><summary>Do I need to download anything?<span class="pm">${ic("plus")}</span></summary><p>No. FAFO runs in your browser at ${appHost}, on your computer or your phone.</p></details>
        <details><summary>Who can see my cards and passwords?<span class="pm">${ic("plus")}</span></summary><p>Your vault is encrypted with your master password before it's saved or synced, so only you can open it. When you submit slots, those slots go to your seller so they can check out with them.</p></details>
        <details><summary>What if I forget my master password?<span class="pm">${ic("plus")}</span></summary><p>No one can reset it, not even your seller: it's the key your vault is encrypted with. Keep it somewhere safe.</p></details>
        <details><summary>Which stores does FAFO work with?<span class="pm">${ic("plus")}</span></summary><p>Pokémon Center and Target. Each profile is for one store, and Duplicate makes its twin for the other.</p></details>
        <details><summary>How do my orders get into FAFO?<span class="pm">${ic("plus")}</span></summary><p>From your order emails: paste them into Orders, or let the desktop app read them from your inbox. With sync on, every device gets them.</p></details>
        <details><summary>Can I use FAFO on my phone and my computer?<span class="pm">${ic("plus")}</span></summary><p>Yes. Turn on sync in Settings → Web version &amp; sync, then log in on the other device with the same license.</p></details>
      </div>
    </div>
  </section>

  <div class="wrap">
    <section class="final" aria-labelledby="final-h">
      <span class="streak a"></span><span class="streak b"></span><span class="streak c"></span>
      <span class="wordmark" aria-hidden="true">FAFO</span>
      <h2 class="display" id="final-h">Ready for the next drop?</h2>
      <p>Log in with Discord, choose your master password and add your first profile.</p>
      <div class="cta">${loginBtn(app)}<a class="btn btn-ghost" href="${app}">Open FAFO</a></div>
    </section>
  </div>
</main>
<footer>
  <div class="wrap">
    <div class="foot">
      <div><a class="wordmark" href="/" aria-label="FAFO home">FAFO</a><p>Cop it. Track it. FAFO.</p></div>
      <div><h4>FAFO</h4><ul><li><a href="#how">How it works</a></li><li><a href="#features">Features</a></li><li><a href="#faq">FAQ</a></li></ul></div>
      <div><h4>Account</h4><ul><li><a href="${app}">Login with Discord</a></li><li><a href="${app}">Open FAFO</a></li></ul></div>
    </div>
    <div class="base"><span>© ${year} FAFO</span><span>${v ? `Web version ${esc(v)} · ` : ""}<a href="${app}">${appHost}</a></span></div>
  </div>
</footer>
<script>
(function(){
  var root=document.documentElement,btn=document.querySelector(".tbtn");
  function dark(){var t=root.getAttribute("data-theme");return t?t==="dark":!!(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)}
  function label(){if(btn)btn.setAttribute("aria-label",dark()?"Switch to light theme":"Switch to dark theme")}
  label();
  if(btn)btn.addEventListener("click",function(){var t=dark()?"light":"dark";root.setAttribute("data-theme",t);try{localStorage.setItem("fafo-site-theme",t)}catch(e){}label()});
  var top=false;function onScroll(){var s=window.scrollY>4;if(s!==top){top=s;root.classList.toggle("scrolled",s)}}
  onScroll();window.addEventListener("scroll",onScroll,{passive:true});
  var menu=document.querySelector(".menu");
  if(menu){menu.addEventListener("click",function(e){if(e.target.closest&&e.target.closest(".panel a"))menu.removeAttribute("open")});
    document.addEventListener("click",function(e){if(menu.open&&!menu.contains(e.target))menu.removeAttribute("open")});}
})();
</script>
</body>
</html>`;
}
