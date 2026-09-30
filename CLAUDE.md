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
  It also keeps each license's slot limit (default 20 switched on at once on the
  Submit page, app 1.9.46+): `/slots/limit` and `/slots/request` take the license
  key as `Authorization: Bearer`, and requests are approved at `/slots/review/:id`.
  From 1.9.47, Submit sends slots straight to the owner's channel. 1.9.47–1.9.51 seal them for the
  owner's collecting key (`GET /submit/key`; the owner offers it from Settings → Password and
  sharing and confirms it at `/submit/review/:id`), and `POST /submissions` posts the sealed
  `PVSUB1.` code as a `.txt` attachment. From 1.9.52, at the owner's request, a licensed desktop
  app sends `POST /submissions {csv, …}` instead: no key needed, posted as a `.csv` attachment in
  plain text (Export → CSV's columns, so full card numbers, CVVs, and store and email passwords go
  to the channel). The worker keeps no copy, and a recipient set by hand still gets a sealed code.
  From 1.9.53 the app sends `POST /submissions {files, …}` instead, in the owner's format: for each
  store, its slots as a `.csv` with exactly the 23 columns in `SLOT_COLS` (profile_name, first_name,
  last_name, email, phone_num, cc_*, shipping_*, billing_*), one row per slot, and that store's
  logins as `email:password` lines in a separate `.txt`, in the same order as the first rows. The
  worker names them `orbit-slots-<time>-<sender>-<store>.csv` and `…-<store>-logins.txt`, 10
  attachments per message. Slots without a store login come after those rows.
  How each store on a profile checks out (`stores[].mode`, from 1.9.57): Pokémon Center only on a
  verified email (`"email"`); every other store on a store login (`"login"`) or **Use Assigned
  Account** (`"seller"`): the buyer adds no login and the owner provides one of their own accounts.
  (1.9.53 had that mode as "Assign me an account" beside the other two; 1.9.54 removed it; 1.9.57
  put it in place of "Verified email only". Pages move older data onto these in `fixMode`.) Those
  slots come last in their store's CSV with no login line, `stores[].seller` counts them on the
  Discord line, and importing a submission brings them in as a store login with none linked.
  From 1.9.57 a store waiting for a login is linked to the saved login with the profile's email on
  its own: once per vault at unlock (`settings._linkedByEmail`), on Import profiles and inbox
  submissions, and by ticking the profile in the store login editor (`linkByEmail`).
  From 1.9.50, pulling a submitted slot sends `POST /pull` (`keyId` is the key, or `CSV`), which
  posts a plain list (store, profile name, account email, card brand and last 4) to the same
  channel, only for keys that license already sent submissions to. Pull alerts never carry card
  numbers or passwords.
  Setup and admin commands are in `license-worker/README.md`; `npm test` there
  runs it end to end in Wrangler's local runtime.

- GitHub Releases: the app links new users to
  `releases/latest/download/Orbit-Windows.zip` on this repo.

`licenses.json` goes live as soon as it's on `main`. So does a new app version:
the desktop wrapper checks
`raw.githubusercontent.com/dolamv-coder/profile-vault-updates/main/update.json`
(its `update-config.json`; users can point it elsewhere under Settings → Updates),
and the publish Action below updates that file as soon as a new page and its
notes reach `main`.

## Releases

One commit per release, titled `Release X.Y.Z`, updates `update.json`. The
"Publish Orbit update" Action (`.github/workflows/publish-update.yml`) makes it:

1. Copy the latest `index-*.html` to `index-X.Y.Z.html` and make the change.
2. Add `release-notes/X.Y.Z.txt`: a sentence or two for the app's update notice.
   Customers read it, so write it for them.
3. Merge both into `main`. The Action signs `update.json` over the committed
   page with the `UPDATE_SIGNING_KEY` secret, checks the signature against the
   key built into the app, commits it as `Release X.Y.Z`, and waits until
   raw.githubusercontent.com serves it. Apps check at startup and every 6
   hours, and install it on their next restart. It first waits for the newest
   "Deploy license worker" run on `main` and doesn't publish unless that
   succeeded, since a page may need a worker change merged with it or before it.

**So merging a new page with its notes ships it to every installed app.** Pull
requests that touch pages, notes or `update.json` run the same checks without
the key (and the publisher's tests, `.github/scripts/publish-update.test.mjs`).
The Action fails instead of publishing when a page newer than `update.json` has
no notes, and when the released page was changed or removed after release (apps
would refuse it): put changes in a new version instead. It can also be run by
hand from the Actions tab, optionally for one version. Don't edit `sha256` or
`signature` by hand: an unsigned or mis-signed update is rejected by every
installed app. A page that needs a newer desktop app can't go out this way: sign
it on the desktop with `--min-app` and `--installer-url` so older apps get a
download link instead (later versions keep those values).

The key must be an environment secret of the `release` environment, with
Deployment branches set to Selected branches with only `main` (Settings →
Environments; "Protected branches only" lets every branch in while none is
protected). The Action refuses to run if the key is also a repository secret or
other branches can use the environment. A required reviewer there would hold each release for one
click. Anyone who can change `main` or its workflows can ship an update, so keep
write access tight.

Publishing from the desktop still works, for example if the Action can't.
**Sign the bytes GitHub serves, not a Windows working copy.** Apps download
`index-X.Y.Z.html` from raw.githubusercontent.com and hash it as-is, and git
stores it with LF line endings. A clone on Windows with `core.autocrlf=true`
checks it out with CRLF, which hashes differently, so an `update.json` signed
over that copy is rejected by every app. Sign a copy taken from git instead:

    git show HEAD:index-X.Y.Z.html > /path/outside/repo/index-X.Y.Z.html
    node tools/release.mjs publish --version X.Y.Z --no-push \
      --html /path/outside/repo/index-X.Y.Z.html --notes "What changed"

(`tools/release.mjs` is the signing tool in the publisher's project folder.)
Copy its `release/update.json` here and commit it as `Release X.Y.Z`. Before
pushing, check that the `sha256` matches
`git show HEAD:index-X.Y.Z.html | sha256sum`. After pushing, raw.githubusercontent.com
can keep serving the old `update.json` for about 5 minutes.

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
  - `GET /cmd/:id` and `DELETE /cmd/:id`: encrypted requests from the phone:
    `{v:1, op:"delete", ids}` deletes orders, and `{v:1, op:"clean"}` (app
    1.9.48+) runs one Clean emails pass on auto-clean's inboxes and folders,
    even with auto-clean off. The snapshot's `canClean` shows the phone's
    Clean emails button, and `clean` carries the last result. A clean request
    stays on the relay until its pass ends. The relay just stores these, so
    new request types only need the phone page (`phone.html` in the relay)
    and the desktop to agree.
  - Web push forwarding: the app encrypts alerts itself (RFC 8291), and the
    relay only forwards them.
  - `GET /discord/ready`, `/discord/start`, `/discord/status/:r`: the manual
    "Continue with Discord" key request used by 1.9.40 only. From 1.9.41 the
    app sends these to the license worker in `license-worker/` instead.

  To recover the source, open the Cloudflare dashboard, go to Workers & Pages,
  open `orders` and choose Edit code. Or use the Cloudflare Developer Platform
  connector. Once recovered, it should get its own repo.
- **Desktop wrapper**: provides `window.pvDesktop` (updates, inbox sync, promo
  scanning, attention and focus). The app HTML runs inside it. Which emails
  Clean emails finds is decided there (`scanPromos`), so changing detection
  used to need a new app download. From page 1.9.49 the page sends
  `CLEAN_RULES` (regex sources for plain sales and survey senders) with each
  scan. A wrapper with `pvDesktop.version` 10+ uses them in place of its
  built-in copies, so those two rules can then change with a page update.
  Older wrappers ignore them.
- **`tools/license.mjs`**: makes license keys and signs `licenses.json`. It
  holds the license private key.
- **Update signing tool and key**: produces `update.json`'s `signature`. A copy
  of the key is the `UPDATE_SIGNING_KEY` secret the publish Action uses; GitHub
  never shows a secret again, so that copy isn't a backup.

Without the two private keys, no one can issue new license keys or ship updates
that installed apps will accept. Keep them backed up somewhere safe, outside
git.

## Related repo

`dolamv-coder/profile-vault` (private) is a separate Next.js + Prisma web
dashboard with Discord OAuth login (`/api/auth/discord/callback`). It is not
the Orbit desktop app or the relay.
Claude may merge its own pull requests into main once tests pass, except changes to licenses.json
