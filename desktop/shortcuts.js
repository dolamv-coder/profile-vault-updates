// Windows shortcuts for this copy of the app. Windows shows a notification's app name and icon from
// the Start menu shortcut that has the app's ID, so there's always one, FAFO.lnk, pointing here.
// The app was called Profile Vault, then Orbit (Orbit.exe), and is FAFO.exe from the 1.9.76 download:
// the Start menu shortcuts from before go, and desktop and pinned taskbar shortcuts that open an older
// copy are pointed at this one so they keep working. Desktop ones are renamed too; renaming a pinned
// one would unpin it.
const NAME = "FAFO";
const OLD_NAMES = ["Orbit", "Profile Vault"];

// d: {shell, fs, path, execPath, appId, startMenu, desktop, pinned}. Never throws.
function ensureShortcuts(d) {
  const { shell, fs, path, execPath, appId } = d;
  for (const old of OLD_NAMES) {
    try {
      const p = path.join(d.startMenu, old + ".lnk");
      if (fs.existsSync(p) && shell.readShortcutLink(p).appUserModelId === appId) fs.unlinkSync(p);
    } catch {}
  }
  try {
    const lnk = path.join(d.startMenu, NAME + ".lnk");
    let cur = null;
    try { cur = shell.readShortcutLink(lnk); } catch {}
    if (cur && cur.target === execPath && cur.appUserModelId === appId) return;
    shell.writeShortcutLink(lnk, cur ? "replace" : "create", {
      target: execPath, cwd: path.dirname(execPath), description: NAME,
      icon: execPath, iconIndex: 0, appUserModelId: appId
    });
  } catch {}
  // Only the renamed app moves shortcuts over (not a copy someone renamed, or Electron itself).
  const isFafo = path.basename(execPath).toLowerCase() === NAME.toLowerCase() + ".exe";
  // An older copy: Orbit.exe or Profile Vault.exe that's this app (its shortcut has our ID, or the
  // folder is an Electron app's), so another program that happens to be called Orbit is left alone.
  const olderCopy = (s) => OLD_NAMES.some(n => path.basename(s.target || "").toLowerCase() === n.toLowerCase() + ".exe")
    && s.target !== execPath && (s.appUserModelId === appId || fs.existsSync(path.join(path.dirname(s.target), "resources", "app.asar")));
  for (const dir of [d.desktop, d.pinned]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.lnk$/i.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const p = path.join(dir, f), s = shell.readShortcutLink(p);
        // Shortcuts that open this copy get the app's ID, so the running window groups with a pinned
        // icon instead of showing a second taskbar button.
        if (s.target === execPath) { if (s.appUserModelId !== appId) shell.writeShortcutLink(p, "update", { appUserModelId: appId }); continue; }
        if (!isFafo || !olderCopy(s)) continue;
        shell.writeShortcutLink(p, "update", { target: execPath, cwd: path.dirname(execPath), icon: execPath, iconIndex: 0, appUserModelId: appId, description: NAME });
        if (dir !== d.desktop) continue;
        const renamed = path.join(dir, OLD_NAMES.reduce((n, old) => n.replace(new RegExp(old, "i"), NAME), f));
        if (renamed !== p && !fs.existsSync(renamed)) fs.renameSync(p, renamed);
      } catch {}
    }
  }
}

module.exports = { ensureShortcuts, NAME, OLD_NAMES };
