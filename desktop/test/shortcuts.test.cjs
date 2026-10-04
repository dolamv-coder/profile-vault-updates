// shortcuts.js against a pretend Windows profile (Windows paths, a Start menu, a desktop and pinned
// taskbar icons): moving from Orbit.exe (or Profile Vault.exe) to FAFO.exe, and later starts.
"use strict";
const path = require("path").win32;
const { ensureShortcuts } = require("../shortcuts.js");

let failed = 0, passed = 0;
const ok = (cond, name, got) => { if (cond) passed++; else failed++; console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "\n     got: " + JSON.stringify(got)}`); };

const ID = "com.profilevault.app";
const HOME = "C:\\Users\\Ann\\AppData\\Roaming";
const DIRS = {
  startMenu: HOME + "\\Microsoft\\Windows\\Start Menu\\Programs",
  desktop: "C:\\Users\\Ann\\Desktop",
  pinned: HOME + "\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"
};
const OLD = "C:\\Users\\Ann\\Downloads\\Orbit-win32-x64\\Orbit.exe";
const PV = "C:\\Users\\Ann\\Downloads\\Profile Vault-win32-x64\\Profile Vault.exe";
const NEW = "C:\\Users\\Ann\\Downloads\\FAFO-win32-x64\\FAFO.exe";
const OTHER = "C:\\Program Files\\Orbit Downloader\\Orbit.exe";   // someone else's app called Orbit

// A pretend file system and Electron's shell.readShortcutLink / writeShortcutLink.
function windows(links, files) {
  const lnk = new Map(Object.entries(links)), file = new Set(files), log = [];
  const fs = {
    existsSync: (p) => lnk.has(p) || file.has(p),
    unlinkSync: (p) => { if (!lnk.delete(p)) throw new Error("ENOENT " + p); log.push(["delete", p]); },
    renameSync: (a, b) => { if (!lnk.has(a)) throw new Error("ENOENT " + a); lnk.set(b, lnk.get(a)); lnk.delete(a); log.push(["rename", a, b]); },
    readdirSync: (dir) => { const out = [...lnk.keys(), ...file].filter(p => path.dirname(p) === dir).map(p => path.basename(p)); if (!out.length && !Object.values(DIRS).includes(dir)) throw new Error("ENOENT " + dir); return out; }
  };
  const shell = {
    readShortcutLink: (p) => { if (!lnk.has(p)) throw new Error("Failed to read shortcut link"); return Object.assign({}, lnk.get(p)); },
    writeShortcutLink: (p, op, o) => {
      if (op !== "create" && !lnk.has(p)) return false;
      lnk.set(p, op === "update" ? Object.assign({}, lnk.get(p), o) : Object.assign({}, o));
      log.push([op, p]); return true;
    }
  };
  return { fs, shell, lnk, log, run: (execPath) => ensureShortcuts(Object.assign({ shell, fs, path, execPath, appId: ID }, DIRS)) };
}
const at = (dir, name) => path.join(DIRS[dir], name);

// 1. Someone on Orbit opens FAFO.exe for the first time.
{
  const w = windows({
    [at("startMenu", "Orbit.lnk")]: { target: OLD, appUserModelId: ID },
    [at("startMenu", "Profile Vault.lnk")]: { target: PV, appUserModelId: ID },
    [at("desktop", "Orbit.lnk")]: { target: OLD, appUserModelId: ID, description: "Orbit" },
    [at("desktop", "Orbit.exe - Shortcut.lnk")]: { target: OLD },
    [at("desktop", "Orbit Downloader.lnk")]: { target: OTHER },
    [at("desktop", "Notes.lnk")]: { target: "C:\\Windows\\notepad.exe" },
    [at("pinned", "Orbit.lnk")]: { target: OLD, appUserModelId: ID }
  }, [path.join(path.dirname(OLD), "resources", "app.asar"), path.join(path.dirname(NEW), "resources", "app.asar")]);
  w.run(NEW);
  const sm = w.lnk.get(at("startMenu", "FAFO.lnk"));
  ok(sm && sm.target === NEW && sm.appUserModelId === ID && sm.description === "FAFO" && sm.icon === NEW, "the Start menu gets FAFO, pointing at FAFO.exe with the app's ID", sm);
  ok(!w.lnk.has(at("startMenu", "Orbit.lnk")) && !w.lnk.has(at("startMenu", "Profile Vault.lnk")), "the Orbit and Profile Vault Start menu shortcuts are gone");
  const d1 = w.lnk.get(at("desktop", "FAFO.lnk"));
  ok(d1 && d1.target === NEW && d1.appUserModelId === ID && d1.description === "FAFO" && !w.lnk.has(at("desktop", "Orbit.lnk")), "the desktop's Orbit shortcut opens FAFO.exe and is called FAFO", d1);
  const d2 = w.lnk.get(at("desktop", "FAFO.exe - Shortcut.lnk"));
  ok(d2 && d2.target === NEW && !w.lnk.has(at("desktop", "Orbit.exe - Shortcut.lnk")), "a Send to → Desktop shortcut to Orbit.exe too (no app ID, but Orbit's folder)", d2);
  ok(w.lnk.get(at("desktop", "Orbit Downloader.lnk")).target === OTHER, "another program called Orbit.exe is left alone");
  ok(w.lnk.get(at("desktop", "Notes.lnk")).target === "C:\\Windows\\notepad.exe", "other shortcuts are left alone");
  const pin = w.lnk.get(at("pinned", "Orbit.lnk"));
  ok(pin && pin.target === NEW && pin.appUserModelId === ID && !w.lnk.has(at("pinned", "FAFO.lnk")), "a pinned taskbar icon opens FAFO.exe and keeps its name (renaming would unpin it)", pin);
  // 2. The next start changes nothing.
  const before = JSON.stringify([...w.lnk]), n = w.log.length;
  w.run(NEW);
  ok(JSON.stringify([...w.lnk]) === before && w.log.length === n, "the next start changes nothing", w.log.slice(n));
}

// 3. From Profile Vault: its desktop shortcut becomes FAFO; an Orbit shortcut already renamed keeps the name.
{
  const w = windows({
    [at("desktop", "Profile Vault.lnk")]: { target: PV },
    [at("desktop", "FAFO.lnk")]: { target: NEW }
  }, [path.join(path.dirname(PV), "resources", "app.asar")]);
  w.run(NEW);
  ok(w.lnk.get(at("desktop", "Profile Vault.lnk")).target === NEW, "a Profile Vault shortcut opens FAFO.exe; the name FAFO is taken, so it keeps its own");
  ok(w.lnk.get(at("desktop", "FAFO.lnk")).appUserModelId === ID, "a shortcut to FAFO.exe without the app's ID gets it");
}

// 4. Not the renamed app (Electron itself, or a renamed copy): the Start menu shortcut only.
{
  const w = windows({ [at("desktop", "Orbit.lnk")]: { target: OLD, appUserModelId: ID } }, []);
  const dev = "C:\\dev\\node_modules\\electron\\dist\\electron.exe";
  w.run(dev);
  ok(w.lnk.get(at("startMenu", "FAFO.lnk")).target === dev, "the Start menu shortcut points at whatever is running");
  ok(w.lnk.get(at("desktop", "Orbit.lnk")).target === OLD, "but Orbit shortcuts only move to a copy named FAFO.exe");
}

// 5. Someone else's Start menu shortcut called Orbit stays; the FAFO one is fixed if it points elsewhere.
{
  const w = windows({
    [at("startMenu", "Orbit.lnk")]: { target: OTHER },
    [at("startMenu", "FAFO.lnk")]: { target: "D:\\old\\FAFO-win32-x64\\FAFO.exe", appUserModelId: ID }
  }, []);
  w.run(NEW);
  ok(w.lnk.has(at("startMenu", "Orbit.lnk")), "a Start menu Orbit shortcut without the app's ID isn't ours, so it stays");
  ok(w.lnk.get(at("startMenu", "FAFO.lnk")).target === NEW, "a FAFO Start menu shortcut to another folder is pointed here");
}

// 6. Nothing there at all, and folders that can't be read: no errors.
{
  const w = windows({}, []);
  w.fs.readdirSync = () => { throw new Error("EACCES"); };
  let threw = null; try { w.run(NEW); } catch (e) { threw = e; }
  ok(!threw && w.lnk.get(at("startMenu", "FAFO.lnk")).target === NEW, "an empty profile gets the Start menu shortcut, and unreadable folders are skipped", threw && threw.message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
