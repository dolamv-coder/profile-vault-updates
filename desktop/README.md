# Orbit desktop app (Windows)

The app people download: an Electron shell that runs the page (`index-X.Y.Z.html` from the repo root)
and gives it `window.pvDesktop` for email (IMAP), updates and notifications. Page changes ship on
their own through `update.json`; changes to the files here need a new download.

The original project folder was lost; this is the code from the v1.9.49 download's
`resources/app.asar`, unminified, plus what came after (see git history).

| File | What it does |
| --- | --- |
| `main.js` | Starts the app, the window and the IPC handlers the page calls. |
| `preload.js` | `window.pvDesktop` for the page. Its `version` tells pages what this app can do. |
| `imap-sync.js` | Email: order sync, Clean emails (scan and trash), moving orders out of Spam. |
| `trust.js` | Certificates for email connections: Node's list plus the ones Windows trusts. |
| `updater.js` | Checks `update.json`, verifies the page's signature, installs it on restart. |
| `update-config.json` | The update address and the public key updates must be signed with. |

## Versions

- `package.json`'s `version` is the version of the page the download starts with, and `build.mjs`
  bundles `../index-<version>.html` as `index.html`. The updater loads a downloaded page only when it's
  newer than this, so it must be a real page's version. Build a release only once that page is
  published (`update.json`).
- `preload.js`'s `version` is what pages check for features (`pvDesktop.version >= 11`). Bump it when
  the page gets something new to use. 10 was the v1.9.49 download; 11 trusts Windows' certificates and
  explains certificate errors (`CERT_ERROR` plus what it saw).

## Test, build, release

```bash
npm ci                                              # also fetches Electron 33.4.11 for the tests
ELECTRON="$(node -p "require('electron')")" npm test  # under Electron's own Node; plain `npm test` uses yours
npm run build                                       # dist/Orbit-Windows.zip
ELECTRON="$(node -p "require('electron')")" node test/check-build.mjs dist/Orbit-Windows.zip
```

The tests make throwaway certificates with openssl and run the email code against a local TLS server
posing as imap.gmail.com: normal, re-signed by antivirus, self-signed, expired, not yet valid, another
server's name, and with the antivirus root trusted by Windows. `test/powershell.test.cjs` checks the
PowerShell that reads Windows' certificates (skipped without `pwsh`).

`build.mjs` doesn't compile anything. It takes the v1.9.49 download (Electron 33.4.11 already named and
iconed as Orbit, checked by sha256), keeps everything in it, and replaces `resources/app.asar` with one
made from these files, the locked libraries (`npm ci --omit=dev`) and the page. That works because
Orbit.exe's asar integrity fuse is off (the build checks). Changing Electron itself would need a real
packaging step (`@electron/packager`, with Wine for the icon on Linux).

To publish: set `package.json` to the new page's version, add `release-notes/<version>.md` (the text on
the GitHub release, for people downloading it), merge, wait for "Publish Orbit update" to ship that
page, then run **Release desktop app** from the Actions tab on main. It builds, tests and checks the zip,
then creates release `v<version>` with `Orbit-Windows.zip` and `ProfileVault-Windows.zip` (the name
older pages link to). The app's download links point at the latest release.
