# Orbit on the web

`https://app.fafoaco.com` (from 2026-10-10; still `https://app.orbit-app.workers.dev` for older pages and bookmarks)
opens FAFO in any browser. This worker serves the newest released page, an `index-X.Y.Z.html` from this repo:

1. It reads `web-update.json` (at most once a minute per worker instance): the web version's own feed, signed like
   installed apps' `update.json`.
2. It downloads the page that file names.
3. It serves the page only if its SHA-256 matches and the feed's signature checks out
   against the publisher key built into the apps. Anything else keeps the last good page.

New releases need nothing here: once the "Publish Orbit update" Action ships one, the web version
serves it within a minute or so. The address it reads is `UPDATE_URL` in `wrangler.toml`.

## Its own feed (since 2026-10-11)

The owner paused desktop updates on 2026-10-11, until further notice, and asked for work on the fafoaco website only.
Until then this worker read `update.json`, the same feed installed apps read, so any release reached both. Now it reads
`web-update.json`. The "Publish Orbit update" Action signs each new page into it, and into `update.json` only while the
repo's `channels.json` doesn't say `"desktop": "paused"`. So releases reach the web while installed apps stay where
they are (1.9.112). See the Releases section of the repo's `CLAUDE.md`.

## Paused at 1.9.67 until 1.9.106

From 2026-10-01, at the owner's request, the web version stayed on Orbit 1.9.67 for one big update: `UPDATE_URL`
pointed at `update.json` in the "Release 1.9.67" commit, so releases reached installed apps but not the web. With
1.9.106 (2026-10-10) the owner had it follow releases again: `UPDATE_URL` was main's `update.json` (main's
`web-update.json` since 2026-10-11, below). To hold the web version at one release again, point `UPDATE_URL` at a feed in
that release's commit and merge.

The page keeps its vault in the browser, encrypted, as the desktop app does. With sync on (Orbit
1.9.65+), it opens the same vault as the desktop app through the license worker's `/vault`
(see `license-worker/README.md`). Email sync and Clean emails stay in the desktop app: browsers
can't sign in to email.

## fafoaco.com

The owner's domain points at this worker as Cloudflare custom domains, added in the dashboard (Workers & Pages → app →
Settings → Domains & Routes), not in `wrangler.toml`, so a deploy needs no access to the domain and leaves them as they
are: `app.fafoaco.com` (the app), `fafoaco.com` (FAFO's front page, `src/site.js`, with `/download` going to the newest
Windows download and `/app` to the app) and `www.fafoaco.com` (to `fafoaco.com`). Since 2026-10-13 (the owner's request)
the front page's button is Login with Discord, which opens the app; it no longer offers the Windows download, and
`/download` stays for links people already have. Its design (also 2026-10-13) is light with a dark theme, following the
system or the switch in its header (kept in the browser as `fafo-site-theme`). Its logo (2026-10-14, the owner's pick)
is drawn inline from `src/brand.js` (`logoSVG`) in the theme's colours. Both addresses serve FAFO's icons from the same
file, so the app's tab and home-screen icon come from the worker, not the page: `/favicon.svg` and `/favicon.ico` (16,
32 and 48 px PNGs) for the tab, and `/apple-touch-icon.png` (180 px, also as `-precomposed`) for a phone's home screen.
`brand.js` holds the PNGs as base64; to change them, draw new ones from the SVGs and replace the strings. It shows the web version's release when
the feed answers within 800 ms, and finishes the check in the background otherwise. `SITE_HOST` in the environment
changes the front page's address (the tests use `localhost`). Every `http://` request goes to `https://` (301), since the
page needs a secure context and a browser keeps each origin's vault apart; turning on SSL/TLS → Edge Certificates →
Always Use HTTPS for the zone does the same at Cloudflare's edge.

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
