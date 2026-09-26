# Orbit (formerly Profile Vault)

Orbit is a desktop app for keeping shopping profiles, cards, store logins and
orders, encrypted locally. It was called Profile Vault until version 1.9.36, so
older code, storage keys (`pv-license`), license keys (`PVLT-…`) and this repo's
name still say "profile vault". Keep those names as they are: changing them
breaks installed copies.

**This repo is public.** Never commit secrets, private keys, tokens or `.env`
files here.

## What this repo is

The release feed for installed copies of Orbit. It is not the full source tree.

- `index-<version>.html`: the whole app UI for that version, one self-contained
  HTML file (inline CSS and JS). Old versions are kept.
- `update.json`: points installed apps at the current release (`version`,
  `url`, `sha256`, `signature`, `notes`, `publishedAt`). Apps accept an update
  only if the signature verifies against the publisher key built into them.
- `licenses.json`: signed list of SHA-256 hashes of license keys made by hand,
  fetched by the app from
  `raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/licenses.json`.
  Each hash is `sha256("pvlt:" + normalized key)`. `body` is signed with
  ECDSA P-256 (the public key is `LICENSE_PUB` in the HTML). Apps work offline
  for 30 days after their last successful check.
- `license-worker/`: the Cloudflare Worker (`orbit-license`, D1 database) that
  hands out keys automatically after "Continue with Discord" (app 1.9.41+).
  It serves a second signed list in the same format at `/licenses`, signed with
  its own key (public half is `LICENSE_AUTO_PUB` in the HTML). The app saves which
  list a key came from as `src` (`"gh"` or `"auto"`) in the `pv-license` record.
  With `REQUIRE_APPROVAL = "true"` (in `wrangler.toml`) sign-ins become requests
  posted to `DISCORD_WEBHOOK_URL`, approved or denied at `/review/:discord_id`;
  `/discord/status` then answers `review` until decided. 1.9.42+ keeps waiting on
  `review`; 1.9.41 shows the message and asks the user to try again later.
  Setup and admin commands are in `license-worker/README.md`; `npm test` there
  runs it end to end in Wrangler's local runtime.

- GitHub Releases: the app links new users to
  `releases/latest/download/Orbit-Windows.zip` on this repo.

`licenses.json` goes live as soon as it's on `main`. The address installed apps
check for `update.json` is built into the desktop wrapper (users can override
it under Settings → Updates), so confirm where it points before assuming a
push to `main` ships an update.

## Releases

One commit per release, titled `Release X.Y.Z`, which adds
`index-X.Y.Z.html` and updates `update.json`. To make a new release, copy the
latest `index-*.html`, make the change, then regenerate `update.json` with the
publisher's signing tool. Don't edit `sha256` or `signature` by hand: an
unsigned or mis-signed update is rejected by every installed app.

## Pieces that live outside this repo

As of 2026-09-26, none of these are in `dolamv-coder/profile-vault-updates` or
`dolamv-coder/profile-vault`. The original local project folder was lost.

- **Relay worker**: a Cloudflare Worker at `https://orders.orbit-app.workers.dev`
  (`PHONE_RELAY` in the HTML). The old address,
  `profile-vault-orders.profile-vault-phone-relay.workers.dev`, is redirected in
  the app (`OLD_RELAYS`). Endpoints the app uses:
  - `PUT /s/:id`: encrypted order snapshot for the phone tracker (AES-GCM,
    key derived from the phone passcode; the relay can't read it).
    Authorization is `Bearer <license key>`, or a write token for a
    self-hosted relay.
  - `GET /cmd/:id` and `DELETE /cmd/:id`: encrypted requests from the phone,
    such as deleting orders.
  - Web push forwarding: the app encrypts alerts itself (RFC 8291), and the
    relay only forwards them.
  - `GET /discord/ready`, `/discord/start`, `/discord/status/:r`: the manual
    "Continue with Discord" key request used by 1.9.40 only. From 1.9.41 the
    app sends these to the license worker in `license-worker/` instead.

  To recover the source, open the Cloudflare dashboard, go to Workers & Pages,
  open `orders` and choose Edit code. Or use the Cloudflare Developer Platform
  connector. Once recovered, it should get its own repo.
- **Desktop wrapper**: provides `window.pvDesktop` (updates, inbox sync, promo
  scanning, attention and focus). The app HTML runs inside it.
- **`tools/license.mjs`**: makes license keys and signs `licenses.json`. It
  holds the license private key.
- **Update signing tool and key**: produces `update.json`'s `signature`.

Without the two private keys, no one can issue new license keys or ship updates
that installed apps will accept. Keep them backed up somewhere safe, outside
git.

## Related repo

`dolamv-coder/profile-vault` (private) is a separate Next.js + Prisma web
dashboard with Discord OAuth login (`/api/auth/discord/callback`). It is not
the Orbit desktop app or the relay.
