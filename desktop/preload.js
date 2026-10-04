// Exposes a small, fixed API to the page. The page never gets Node access.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pvDesktop", {
  version: 12,
  focusApp: () => ipcRenderer.invoke("app:focus"),
  attention: () => ipcRenderer.invoke("app:attention"),
  rescueSpam: (cfg) => ipcRenderer.invoke("imap:rescue-spam", cfg),
  testInbox: (cfg) => ipcRenderer.invoke("imap:test", cfg),
  syncInbox: (cfg) => ipcRenderer.invoke("imap:sync", cfg),
  onSyncProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on("imap:progress", h);
    return () => ipcRenderer.removeListener("imap:progress", h);
  },
  scanPromos: (cfg) => ipcRenderer.invoke("imap:scan-promos", cfg),
  trashPromos: (cfg, uids, uidValidity) => ipcRenderer.invoke("imap:trash-promos", cfg, uids, uidValidity),
  appReady: () => ipcRenderer.invoke("app:ready"),
  updateInfo: () => ipcRenderer.invoke("update:info"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  setUpdateSource: (url) => ipcRenderer.invoke("update:set-source", url),
  restartToUpdate: () => ipcRenderer.invoke("update:restart"),
  onUpdateStatus: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on("update:status", h);
    return () => ipcRenderer.removeListener("update:status", h);
  }
});
