const { app, BrowserWindow, shell, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const imap = require("./imap-sync");
const { Updater } = require("./updater");

// The app was called Profile Vault before it became Orbit. Keep using that data folder so the
// vault, saved inboxes, license and page updates carry over. (Must run before anything touches it.)
app.setPath("userData", path.join(app.getPath("appData"), "Profile Vault"));

if (!app.requestSingleInstanceLock()) app.quit();

// Windows shows a notification's app name and icon from the app's ID, which it looks up
// on a Start menu shortcut. Set the ID and keep a Start menu shortcut pointing at this copy.
const APP_ID = "com.profilevault.app";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const START_MENU = () => path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
function ensureStartMenuShortcut() {
  if (process.platform !== "win32") return;
  // The old Start menu shortcut from before the rename; Orbit.lnk below replaces it.
  try {
    const old = path.join(START_MENU(), "Profile Vault.lnk");
    if (fs.existsSync(old) && shell.readShortcutLink(old).appUserModelId === APP_ID) fs.unlinkSync(old);
  } catch {}
  try {
    const lnk = path.join(START_MENU(), "Orbit.lnk");
    let cur = null;
    try { cur = shell.readShortcutLink(lnk); } catch {}
    if (cur && cur.target === process.execPath && cur.appUserModelId === APP_ID) return;
    shell.writeShortcutLink(lnk, cur ? "replace" : "create", {
      target: process.execPath, cwd: path.dirname(process.execPath), description: "Orbit",
      icon: process.execPath, iconIndex: 0, appUserModelId: APP_ID
    });
  } catch {}
  // Give the same ID to desktop and pinned-taskbar shortcuts that open this copy, so the
  // running window groups with a pinned icon instead of showing a second taskbar button.
  // Shortcuts to the old "Profile Vault.exe" are pointed at this copy so they keep working
  // (a desktop one is also renamed; renaming a pinned one would unpin it).
  for (const dir of [app.getPath("desktop"), path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar")]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.lnk$/i.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const p = path.join(dir, f), s = shell.readShortcutLink(p);
        if (s.target === process.execPath && s.appUserModelId !== APP_ID) shell.writeShortcutLink(p, "update", { appUserModelId: APP_ID });
        else if (path.basename(s.target || "") === "Profile Vault.exe" && process.execPath !== s.target && path.basename(process.execPath) === "Orbit.exe") {
          shell.writeShortcutLink(p, "update", { target: process.execPath, cwd: path.dirname(process.execPath), icon: process.execPath, iconIndex: 0, appUserModelId: APP_ID, description: "Orbit" });
          const renamed = path.join(dir, "Orbit.lnk");
          if (dir === app.getPath("desktop") && f === "Profile Vault.lnk" && !fs.existsSync(renamed)) fs.renameSync(p, renamed);
        }
      } catch {}
    }
  }
}

let updater = null;
let win = null;

const clean = (cfg) => ({
  email: String(cfg && cfg.email || "").trim(),
  password: String(cfg && cfg.password || ""),
  host: String(cfg && cfg.host || "").trim(),
  port: Number(cfg && cfg.port) || 993,
  days: Math.min(365, Math.max(1, Number(cfg && cfg.days) || 90)),
  id: String(cfg && cfg.id || ""),
  folder: String(cfg && cfg.folder || "inbox") === "spam" ? "spam" : "inbox",
  loose: !!(cfg && cfg.loose),   // Spam folder: keep only orders and sign-in codes
  // Clean emails rules from the page (regex sources); imap-sync checks them and falls back to its own.
  rules: { promoSubject: String(cfg && cfg.rules && cfg.rules.promoSubject || "").slice(0, 4000), surveyFrom: String(cfg && cfg.rules && cfg.rules.surveyFrom || "").slice(0, 4000) }
});

ipcMain.handle("imap:test", async (_e, cfg) => {
  const c = clean(cfg);
  if (!c.email || !c.password || !c.host) return { ok: false, error: "Email, app password and server are all needed." };
  return imap.test(c);
});
ipcMain.handle("imap:sync", async (e, cfg) => {
  const c = clean(cfg);
  if (!c.email || !c.password || !c.host) return { ok: false, error: "Email, app password and server are all needed." };
  return imap.sync(c, (p) => { if (!e.sender.isDestroyed()) e.sender.send("imap:progress", Object.assign({ id: c.id }, p)); });
});

ipcMain.handle("imap:scan-promos", async (e, cfg) => {
  const c = clean(cfg);
  if (!c.email || !c.password || !c.host) return { ok: false, error: "Email, app password and server are all needed." };
  c.days = Math.min(365, Math.max(1, Number(cfg && cfg.days) || 30));
  return imap.scanPromos(c, (p) => { if (!e.sender.isDestroyed()) e.sender.send("imap:progress", Object.assign({ id: c.id, clean: true }, p)); });
});
ipcMain.handle("imap:trash-promos", async (_e, cfg, uids, uidValidity) => {
  const c = clean(cfg);
  if (!c.email || !c.password || !c.host) return { ok: false, error: "Email, app password and server are all needed." };
  return imap.trashPromos(c, uids, uidValidity);
});

ipcMain.handle("imap:rescue-spam", async (_e, cfg) => {
  const c = clean(cfg);
  if (!c.email || !c.password || !c.host) return { ok: false, error: "Email, app password and server are all needed." };
  c.days = Math.min(90, Math.max(1, Number(cfg && cfg.days) || 30));
  return imap.rescueSpam(c);
});

// --- updates ---
ipcMain.handle("update:info", () => ({ appVersion: app.getVersion(), version: updater.currentVersion(), source: updater.manifestUrl(), builtInSource: !!updater.cfg.manifestUrl, signed: !!updater.pubKey, status: updater.status }));
ipcMain.handle("update:check", () => updater.check(true));
ipcMain.handle("update:set-source", (_e, url) => { try { updater.setManifestUrl(url); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("update:restart", () => { app.relaunch(); app.exit(0); });
ipcMain.handle("app:ready", () => { updater.confirmStarted(); return true; });
// Bring the window forward (clicking a notification), and flash the taskbar button for attention.
ipcMain.handle("app:focus", () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } return true; });
ipcMain.handle("app:attention", () => { if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); return true; });

function createWindow(){
  // The background shows until the page paints: Deep space blue's, the default theme from page 1.9.70.
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 560,
    title: "Orbit", backgroundColor: "#040A1C", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  const page = updater.pageToLoad();
  win.loadFile(page);
  // If an updated page can't even load, fall back to the built-in one right away.
  win.webContents.on("did-fail-load", () => { if (page !== path.join(__dirname, "index.html")) { app.relaunch(); app.exit(0); } });
  // Web links open in the browser; mailto: opens the email app (Share → Email…).
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) || /^mailto:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (ev, url) => { if (!url.startsWith("file:")) { ev.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  updater.onStatus((s) => { if (win && !win.isDestroyed()) win.webContents.send("update:status", s); });
  win.on("focus", () => win.flashFrame(false));
}

app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  updater = new Updater(__dirname);
  createWindow();
  updater.start();
  ensureStartMenuShortcut();
});
app.on("window-all-closed", () => app.quit());
