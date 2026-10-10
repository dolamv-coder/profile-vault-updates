# Orbit on the web

`https://app.orbit-app.workers.dev` opens Orbit in any browser. This worker serves the newest
released page, the same `index-X.Y.Z.html` installed apps update to:

1. It reads `update.json` (at most once a minute per worker instance).
2. It downloads the page that file names.
3. It serves the page only if its SHA-256 matches and `update.json`'s signature checks out
   against the publisher key built into the apps. Anything else keeps the last good page.

New releases need nothing here: once the "Publish Orbit update" Action ships one, the web version
serves it within a minute or so. The address it reads is `UPDATE_URL` in `wrangler.toml`.

## Paused at 1.9.67 until 1.9.106

From 2026-10-01, at the owner's request, the web version stayed on Orbit 1.9.67 for one big update: `UPDATE_URL`
pointed at `update.json` in the "Release 1.9.67" commit, so releases reached installed apps but not the web. With
1.9.106 (2026-10-10) the owner had it follow releases again: `UPDATE_URL` is main's `update.json`. To hold the web
version at one release again, point `UPDATE_URL` at `update.json` in that release's commit and merge.

The page keeps its vault in the browser, encrypted, as the desktop app does. With sync on (Orbit
1.9.65+), it opens the same vault as the desktop app through the license worker's `/vault`
(see `license-worker/README.md`). Email sync and Clean emails stay in the desktop app: browsers
can't sign in to email.

## Deploying

The "Deploy web app" Action (`.github/workflows/deploy-web-app.yml`) tests and deploys it when
`web-worker/` changes on main, or by hand from the Actions tab. It uses the same
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets as the license worker.

## Tests

```
npm install
npm test
```

Runs the worker in Wrangler's local runtime against a mock of GitHub, with a test publisher key.
It checks signed pages are served with safe headers, and that a page that doesn't match, a release
signed with another key, a signed field changed afterwards, and `update.json` being down all keep
the last good page.
