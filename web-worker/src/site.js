// FAFO's front page at https://fafoaco.com (the owner's domain, 2026-10-10): what FAFO is, the Windows download and the
// web version. The same worker serves the app itself at app.fafoaco.com (and app.orbit-app.workers.dev); see index.js.

export const SITE_HOST = "fafoaco.com";
export const APP_URL = "https://app.fafoaco.com";
// The newest Windows download (the "Release desktop app" Action attaches it to each GitHub release).
export const DOWNLOAD_URL = "https://github.com/dolamv-coder/profile-vault-updates/releases/latest/download/FAFO-Windows.zip";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// `version`: the release the web version serves now ("" when it isn't known yet). It's labelled the web version's: the
// Windows download stays on the release installed apps have while desktop updates are paused (channels.json).
export function sitePage(version, appUrl = APP_URL) {
  const v = /^[0-9.]{1,20}$/.test(version || "") ? version : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FAFO</title>
<meta name="description" content="FAFO keeps your checkout profiles, cards and store logins encrypted, sends your slots to the seller in one batch, and tracks every order.">
<meta name="theme-color" content="#040A1C">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&family=Cormorant+Garamond:wght@600;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bruno+Ace+SC&text=FAFO&display=swap">
<style>
:root{
  --ink:#E6F0FF; --ink-2:#9DB4DA; --ink-3:#6A84B0;
  --sheet:rgba(14,28,64,.64); --line:rgba(110,160,255,.20);
  --accent:#3D9BFF; --accent-2:#6DB6FF; --on-accent:#031027;
  --sky:radial-gradient(1200px 700px at 80% -10%, rgba(40,110,255,.32), transparent 60%),radial-gradient(900px 700px at -10% 100%, rgba(0,190,255,.20), transparent 60%),radial-gradient(700px 500px at 50% 45%, rgba(90,70,230,.14), transparent 70%),linear-gradient(180deg,#07142F 0%,#030817 100%);
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;background-color:#040A1C;background-image:var(--sky);background-attachment:fixed;color:var(--ink);font:400 16px/1.55 "Archivo","Helvetica Neue",Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before,body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:0}
body::before{background-image:radial-gradient(1px 1px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 140px 90px,#fff,transparent),radial-gradient(1px 1px at 260px 20px,#fff,transparent),radial-gradient(1.5px 1.5px at 330px 160px,#fff,transparent),radial-gradient(1px 1px at 90px 210px,#fff,transparent),radial-gradient(1px 1px at 210px 260px,#BFE1FF,transparent),radial-gradient(1px 1px at 380px 300px,#fff,transparent),radial-gradient(1px 1px at 40px 340px,#8FD3FF,transparent);background-size:400px 360px;animation:tw 4.7s ease-in-out infinite alternate}
body::after{background-image:radial-gradient(1.5px 1.5px at 70px 120px,#fff,transparent),radial-gradient(2px 2px at 300px 60px,#8FD3FF,transparent),radial-gradient(1.5px 1.5px at 520px 240px,#BFE1FF,transparent),radial-gradient(1px 1px at 180px 420px,#fff,transparent),radial-gradient(2px 2px at 620px 460px,#fff,transparent);background-size:700px 600px;animation:tw 3.1s ease-in-out infinite alternate}
@keyframes tw{from{opacity:.55}to{opacity:1}}
@media (prefers-reduced-motion:reduce){body::before,body::after{animation:none}}
.wrap{position:relative;z-index:1;max-width:1040px;margin:0 auto;padding:0 20px}
header{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.wordmark{font-family:"Bruno Ace SC",system-ui,sans-serif;font-size:30px;letter-spacing:.02em;color:var(--ink);text-decoration:none}
.nav{display:flex;gap:18px;align-items:center}
.nav a{color:var(--ink-2);text-decoration:none;font-weight:600;font-size:15px}
.nav a:hover{color:var(--ink)}
.hero{text-align:center;padding:64px 0 40px}
.hero .mark{font-family:"Bruno Ace SC",system-ui,sans-serif;font-size:clamp(64px,14vw,120px);line-height:1;letter-spacing:.02em;text-shadow:0 0 40px rgba(61,155,255,.35)}
.eyebrow{margin:18px 0 0;color:var(--accent-2);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:13px}
h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:700;font-size:clamp(34px,5.4vw,54px);line-height:1.1;margin:14px auto 0;max-width:760px}
.lead{color:var(--ink-2);font-size:clamp(16px,2vw,19px);max-width:640px;margin:16px auto 0}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.btn{display:inline-flex;align-items:center;gap:10px;padding:13px 22px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;border:1px solid var(--line);color:var(--ink);background:var(--sheet);transition:transform .15s ease,background .15s ease}
.btn:hover{transform:translateY(-1px);background:rgba(24,44,92,.7)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);box-shadow:0 10px 30px -10px rgba(61,155,255,.7)}
.btn-primary:hover{background:var(--accent-2)}
.btn svg{width:18px;height:18px;flex:none}
.small{color:var(--ink-3);font-size:14px;margin-top:14px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:40px 0 0}
.card{background:var(--sheet);border:1px solid var(--line);border-radius:16px;padding:22px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.card h2{margin:0 0 8px;font-size:18px}
.card p{margin:0;color:var(--ink-2);font-size:15px}
.ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:rgba(61,155,255,.14);color:var(--accent-2);margin-bottom:14px}
.ic svg{width:20px;height:20px}
.steps{margin:56px 0 0;background:var(--sheet);border:1px solid var(--line);border-radius:16px;padding:26px 26px 10px}
.steps h2{margin:0 0 14px;font-family:"Cormorant Garamond",Georgia,serif;font-size:30px}
.steps ol{margin:0;padding:0;list-style:none;counter-reset:s}
.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start;padding:0 0 16px;color:var(--ink-2)}
.steps li::before{content:counter(s);flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:14px}
.steps strong{color:var(--ink)}
footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--ink-3);font-size:14px;padding:40px 0 34px;margin-top:40px;border-top:1px solid var(--line)}
footer a{color:var(--ink-2)}
@media (max-width:760px){
  .grid{grid-template-columns:minmax(0,1fr)}
  .hero{padding:36px 0 24px}
  .nav a.hide-sm{display:none}
  .btn{width:100%;justify-content:center}
  .cta{flex-direction:column;max-width:360px;margin-left:auto;margin-right:auto}
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="wordmark" href="/" aria-label="FAFO home">FAFO</a>
    <nav class="nav"><a class="hide-sm" href="/download">Download</a><a href="${esc(appUrl)}">Open FAFO</a></nav>
  </header>
  <main>
    <section class="hero">
      <div class="mark" aria-hidden="true">FAFO</div>
      <p class="eyebrow">ACO for Pokémon Center and Target</p>
      <h1>Your slots in. Your orders tracked.</h1>
      <p class="lead">FAFO keeps your checkout profiles, cards and store logins encrypted, sends your slots to the seller in one batch, and follows every order from your email.</p>
      <div class="cta">
        <a class="btn btn-primary" href="/download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>Download for Windows</a>
        <a class="btn" href="${esc(appUrl)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>Open in your browser</a>
      </div>
      <p class="small">Windows 10 and 11, or any browser${v ? ` · Web version ${esc(v)}` : ""}</p>
    </section>
    <section class="grid" aria-label="What FAFO does">
      <div class="card"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div><h2>Profiles, cards and logins</h2><p>One profile per store, for Target and Pokémon Center. Generate, jig and edit them in bulk. Everything is encrypted with your master password.</p></div>
      <div class="card"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg></div><h2>Submit your slots</h2><p>Switch slots on and send them to the seller in one batch. They show Pending approval, then Success once the seller approves them.</p></div>
      <div class="card"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.8"/><circle cx="18" cy="18" r="1.8"/></svg></div><h2>Every order, tracked</h2><p>The desktop app reads your order emails: placed, shipped, delivered or canceled, with your stick rate for each drop.</p></div>
    </section>
    <section class="steps">
      <h2>Getting started</h2>
      <ol>
        <li><span><strong>Get FAFO.</strong> Download it for Windows, or open it in your browser.</span></li>
        <li><span><strong>Get your license.</strong> Choose Continue with Discord in FAFO. Your key arrives once the seller approves you.</span></li>
        <li><span><strong>Add your profiles and submit.</strong> Turn on sync to use the same vault on your computer and your phone.</span></li>
      </ol>
    </section>
  </main>
  <footer><span>FAFO · fafoaco.com</span><span>Web version: <a href="${esc(appUrl)}">${esc(appUrl.replace(/^https:\/\//, ""))}</a></span></footer>
</div>
</body>
</html>`;
}
