# FAFO (formerly Orbit, before that Profile Vault)

FAFO is a desktop app for keeping shopping profiles, cards, store logins and
orders, encrypted locally. It was called Profile Vault until version 1.9.36 and
Orbit until 1.9.75, so older code, storage keys (`pv-license`, `orbit-…`), license
keys (`PVLT-…`), the workers' names and addresses (`orbit-license`,
`*.orbit-app.workers.dev`) and this repo's name still say "profile vault" or
"orbit", and most of this file still says Orbit. Keep those names as they are:
changing them breaks installed copies.

**This repo is public.** Never commit secrets, private keys, tokens or `.env`
files here, or a real person's name, address, phone number or email: pages, tests and notes use sample data.

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
  for 30 days after their last successful check. From 1.9.83 they also try the
  license worker's copy (`/mirror/licenses.json`) when GitHub's can't be reached.
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
  Since 2026-10-06 (the owner's choice) each store's slots also go out as an AYCD profile list,
  `…-<store>-aycd.json`, posted just before its CSV, with the same rows in the same order and laid out
  as AYCD exports a profile (`name, notes, billingAddress, shippingAddress, paymentDetails,
  sameBillingAndShippingAddress, onlyCheckoutOnce, matchNameOnCardAndAddress`; states and countries
  written out). App 1.9.87+ sends it (`kind: "aycd"`, `slotAycd`), with the card's own name and Only one
  checkout; for older apps the worker makes it from the CSV (`aycdFromCsv`), with the billing name as
  the name on card. A list that doesn't have one profile for each CSV row is refused. Later on 2026-10-06 the owner
  dropped the CSV: the channel gets each store's AYCD list and its logins file only. Since 2026-10-07 (the owner's
  request: "a login:password is not required") Pokémon Center gets no logins file (`isPokemonCenterFile`, by the profiles
  file's `storeKey` or the store's name): its slots check out with the email on each AYCD profile. The file is still made,
  since `assignAccounts` counts its lines to find the assigned rows. The app still sends the CSV,
  which the worker reads to give out accounts and, for apps before 1.9.87, to make the AYCD list, and 1.9.91 says
  "AYCD files" where the app said "CSV files" (the Submit page and window, Send somewhere else, the seller's Discord note).
  Since 2026-10-06 (the owner's requests) the owner approves or declines each batch: its message (the first, when there
  are several) ends with **Pending your approval · Approve or decline**, a link to `/submissions/review/:id?t=…` (D1
  `submission_reviews`, kept 90 days; its own table, since `db:init` can't add columns). Approve edits the message to
  **✅ Approved** with the time; Decline asks once more (`decline-ask`, with Keep it waiting), then edits it to
  **⛔ Declined** and puts the accounts given to that batch's slots back on the list (`freeBatch`, which drops the batch's
  reuses and frees its other accounts), except, since 2026-10-07 (the owner's request), a Target account the same
  profile's Pokémon Center slot in another batch still uses: it stays held, parked (its `batch` becomes `parked:` + the
  declined batch, so it doesn't depend on `submission_reviews`, which is purged after 90 days), until no such slot is left
  (`sweepParked`, run by `freeBatch`, `freeAccounts` and both `/admin/accounts/free` and `/remove`; `declineEffect` gives
  the page's counts), so the list can't give it to a second buyer, and the declined Target slot sent again gets it back.
  A slot sent again takes its account to the new batch before posting and back if nothing posted (`takeAccount`,
  `undoMoves`, also when assigning throws), so a decline meanwhile can't free it, and `freeAccounts` drops the reuses of a
  Target account it frees. A reuse is only written while its Target account is still that buyer's, and reuses the worker
  before 2026-10-07 left in declined batches (a slot sent again may still use one) count as in use until freed by hand.
  Either decision is final. `/submissions` answers `review: "pending"`, and app 1.9.91+ keeps
  the batch id on each slot it sent that way (`S.subs[key].batch`), shows **Pending approval** until
  `GET /submissions/status?ids=` (license Bearer, that license's batches only) says approved, then **Success** (`okAt`)
  with a message (`refreshApprovals`: about every 30 seconds with Submit in front, otherwise every 5 minutes); 1.9.92+
  also shows **Declined** (`declinedAt`). 1.9.91 keeps a declined batch at Pending approval. Slots sent before, through a
  worker that doesn't answer `review`, or as a code show Submitted as before; from 1.9.98 those an older app sent through
  the worker after approvals began (it kept no batch id) find their batch with `GET /submissions/batches` (1.9.98 below).
  The owner opened these in Excel (since the change above, only 1.9.52's single CSV is still posted), which shows a 16-digit card number as 5.55556E+15 (keeping only 15
  digits) and drops leading zeros. So since 2026-10-02 the worker writes each slots CSV's phone, card
  number, expiry month, CVV and zip code cells as `="…"` Excel text (`excelSafe`), and does the same
  to any cell that starts with `= + - @`, so nothing a buyer typed runs as a formula. This works for
  files from every app version. Orbit's CSV import reads `="…"` cells as their text from 1.9.68
  (`xlUnwrap` in `parseCSV`).
  How each store on a profile checks out (`stores[].mode`, from 1.9.57): Pokémon Center on the
  buyer's own email, as a guest with no login (`"email"`; from 1.9.62 nothing asks for or shows whether it's
  verified, and `verified` is only kept for older data); every other store on a store login (`"login"`);
  and any store on **Use Assigned Account** (`"seller"`, Pokémon Center too from 1.9.67, where the
  editor then shows no checkout email): the buyer adds no login or email and the owner provides one
  of their own accounts.
  (1.9.53 had that mode as "Assign me an account" beside the other two; 1.9.54 removed it; 1.9.57
  put it in place of "Verified email only". Pages move older data onto these in `fixMode`.)
  From 1.9.66 the profile's email follows its stores: a profile whose stores are all on Use Assigned
  Account has none (the editor hides the field and saves it blank), and one on a store login has to
  use that login's email (one of them, if its logins use different emails; picking a login fills it
  in, and the error offers each as a button). Each slot's `email` column is the account it checks
  out with: its store login's, blank on Use Assigned Account until `/submissions` puts the assigned
  account's there (blank for one still waiting), or Pokémon Center's checkout email.
  `stores[].seller` counts those slots on the Discord line, and importing a submission brings them
  in as a store login with none linked (at Pokémon Center, on an empty checkout email for the owner
  to fill in). From 1.9.58 the owner's own accounts go to them on the
  worker: the owner sends accounts from Settings → Accounts to assign (`POST /accounts/offer`; from
  1.9.67 Pokémon Center too, an email and its inbox's password) and
  adds them from the review link (`/accounts/review/:id`, D1 `accounts`). Each profiles file carries
  `storeKey` and `assigned` (how many of its rows, right after the ones with a login, are on Use
  Assigned Account), and `/submissions` gives each such row a random free account: its email in the
  row's `email` column (and on both addresses of its AYCD profile) and `email:password` on the matching
  line of the logins file. Buyers never
  see them; each account goes to one slot; a license gets `ASSIGNED_LIMIT` (20 since 2026-10-07, when it was 10) in
  all; an account picked for a batch that never reached the channel goes back. Rows left without one come last, and
  since 2026-10-07 the store line says why ("N need an account: this license is at its limit of N", or "your list has
  none"; the owner couldn't tell what happened to a batch's Target logins). Also since 2026-10-07 (the owner's request)
  a profile sent again whose slot isn't out any more gets back the account it had, while it's still that license's,
  rather than a new one: app 1.9.99+ sends which of its slots are still out on each store (`active`: {storeKey:
  [profile names]}), and `assignAccounts` moves the account into the new batch (`takeAccount`; `undoMoves` if nothing
  posts), counted on the line as "N they had before". Pulls don't free an account; older apps get new ones as before.
  Since 2026-10-06 (the owner's request) a Pokémon Center row whose profile (by name, same license) already has a
  Target account, in that batch or one sent before, gets that account again (`reuseAccount`, `REUSE_FROM`): kept as a
  Pokémon Center row with `offer_id` `reuse:target`, which `freeAccounts` deletes where others are freed and
  `OWN_ACCOUNT` leaves out of stock counts and the limit; an offered account with that email takes it over. If the
  email is on the Pokémon Center list too, that account is used (with its password) unless another license has it.
  From 1.9.90 the owner can take accounts off the list from FAFO (Settings → Accounts to assign → Remove accounts,
  `openRemoveAccounts`): `POST /accounts/remove {emails, name}` posts the count and a review link (never the emails,
  D1 `account_removals`), and `/accounts/removal/:id` shows where each email is and removes it from every store's
  list (given ones too) or keeps them; asks expire like offers.
  The channel is told once when a store's list is down to `ACCOUNTS_LOW_AT` (15) free accounts and
  once when it runs out (D1 `account_stock`); adding or freeing accounts arms it again.
  Never put the accounts or their password in this repo or a page: it's public.
  From 1.9.69 buyers hear about orders placed on the accounts they were given (Settings → Order
  alerts for buyers). The owner's Orbit asks to send them (`POST /alerts/sender`), and the owner
  allows that license from the review link (`/alerts/review/:id`, D1 `alert_senders`). One license
  sends at a time; allowing another replaces it. After each email sync it sends the orders it found
  on accounts given out (`GET /alerts/accounts`). An order is matched by `sentTo` (the address the
  store's email went to, kept on orders from 1.9.69) or its inbox, and must be at that account's store.
  It goes as `POST /alerts {events:[{account, store, storeName, orderNo, item, qty, total, stage, at}]}`,
  each step (placed, shipped, arriving, delivered, canceled) once per order (`o.buyerTold`). The worker
  routes each event to the license holding that account, and drops an order dated more than a day
  before the account was given out. It keeps the alert 60 days without the account (D1 `alerts`), and
  posts it to the buyer's own Discord webhook if they set one (`PUT /alerts/webhook`, D1
  `alert_webhooks`; Discord's URLs only, and a test post first). The buyer's Orbit checks
  `GET /alerts?since=` every 5 minutes (cursor `settings.sellerSince`). It adds each alert as an order
  with id `sa-<oid>`, `fromSeller` and `profile`, moves it along, and notifies (`sendAlert`).
  A deleted one stays deleted: from 1.9.69 the order editor's Delete also records `deletedOrders`.
  From 1.9.57 a store waiting for a login is linked to the saved login with the profile's email on
  its own: once per vault at unlock (`settings._linkedByEmail`), on Import profiles and inbox
  submissions, and by ticking the profile in the store login editor (`linkByEmail`).
  From 1.9.50, pulling a submitted slot sends `POST /pull` (`keyId` is the key, or `CSV`), which
  posts a plain list (store, profile name, account email, card brand and last 4) to the same
  channel, only for keys that license already sent submissions to. Pull alerts never carry card
  numbers or passwords.
  Setup and admin commands are in `license-worker/README.md`; `npm test` there
  runs it end to end in Wrangler's local runtime.

- `desktop/`: the Windows app itself (Electron), recovered from the v1.9.49
  download. See "Desktop app" below and `desktop/README.md`.
- `web-worker/`: the web version, a Cloudflare Worker (`app`) at
  `https://app.orbit-app.workers.dev`. See "Web version and sync" below.
- GitHub Releases: the app links new users to
  `releases/latest/download/FAFO-Windows.zip` on this repo (`Orbit-Windows.zip`
  until 1.9.75; each release also carries the same zip as `Orbit-Windows.zip` and
  `ProfileVault-Windows.zip` for older pages). From v1.9.61 the "Release desktop
  app" Action makes these from `desktop/`.

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

## Desktop app (`desktop/`)

The Windows app the page runs in. It provides `window.pvDesktop` (updates,
inbox sync, promo scanning, attention and focus). The original project folder
was lost; `desktop/` holds the code from the v1.9.49 download's
`resources/app.asar` and what came after. Changes there need a new download:
"Release desktop app" (`.github/workflows/desktop-release.yml`) tests and
builds `FAFO-Windows.zip` on pull requests, and publishes release
`v<desktop/package.json version>` when run by hand on main, once the page of
that version is out. `pvDesktop.version` is 10 in the v1.9.49 download, 11
from the v1.9.61 download and 12 from the v1.9.76 download, the first that is
`FAFO.exe` (in `FAFO-win32-x64`; `build.mjs` renames the base's `Orbit.exe` and
writes FAFO into its version information). It keeps Profile Vault's data folder
and Windows app ID, and on its first start `shortcuts.js` replaces the Orbit
Start menu shortcut with FAFO and points desktop and pinned shortcuts to an
older `Orbit.exe` or `Profile Vault.exe` at it.

Email connections check the mail server's certificate before signing in. From
desktop 11 they also trust Windows' trusted root certificates (`trust.js`,
read with PowerShell at startup), like Chrome and Outlook, so antivirus email
scanning, VPNs and work networks that re-sign connections no longer stop sync.
A certificate error then adds what was seen: who issued the certificate, its
dates against the computer's clock, or another server's name. From page 1.9.61
`mailError` turns that into advice (`certAdvice`), says it isn't the
password, and offers older apps the new download.

Which emails Clean emails finds is decided there (`scanPromos`), so changing
detection used to need a new app download. From page 1.9.49 the page sends
`CLEAN_RULES` (regex sources for plain sales and survey senders) with each
scan. A wrapper with `pvDesktop.version` 10+ uses them in place of its
built-in copies, so those two rules can then change with a page update.
Older wrappers ignore them. The sale rule also decides when shipping words
("on the way", "arrived", "pick up") in a subject don't protect it, so a sale
event it doesn't name is kept like an order (Target Circle Deal Days was,
until 1.9.59). When `CLEAN_RULES` change, auto-clean looks back 30 days once
(`settings.autoClean.sweptRules`). Mail relayed by iCloud Hide My Email comes
from `<sender>_at_<domain, dots as underscores>_<code>_<code>@icloud.com` with
its unsubscribe headers stripped, so the wrapper takes it for personal mail.
From 1.9.60 the page adds `CLEAN_RELAYED` (relayed newsletter senders, by the
wrapper's own sender tests) to `surveyFrom`, since the wrapper hands survey
senders back without its subject check. The page then groups them by the real
sender (`relayedFrom`) and checks their subjects itself: `CLEAN_PROTECT` plus
`CLEAN_APP_PROTECT`, a copy of the wrapper's `PROTECT`. The page's `SPAM_KEEP`
is the wrapper's plus the order wording it lacks and, from 1.9.63, sign-in
codes in other words (Target's "Enter code 123456 to sign in…"), which "Clear
all of Spam" used to move to Trash. From 1.9.63 Clean emails tells a wrapper
older than 10, which ignores `CLEAN_RULES`, to get the new download
(`CLEAN_OLD_APP`). A page update reaches Clean emails only after Orbit
restarts: until then auto-clean keeps running the old page's rules, so a user
who never restarts still sees mail a newer page would clear.

## Web version and sync

`web-worker/` serves the newest released page to any browser: it reads
`update.json` (at most once a minute), downloads the page it names, and serves
it only if the SHA-256 matches and the signature checks out against the
publisher key built into the apps; otherwise it keeps the last good page. So a
release reaches the web the same way it reaches installed apps, and the
worker itself only changes for its own fixes ("Deploy web app",
`.github/workflows/deploy-web-app.yml`, on `web-worker/` changes to `main`).
Opening it needs no license key (`licenseGate` only runs in the desktop app),
and email sync and Clean emails stay in the desktop app.

**The web version is paused at 1.9.67** (since 2026-10-01, at the owner's request, until one big
update): `web-worker/wrangler.toml`'s `UPDATE_URL` points at `update.json` in the "Release 1.9.67"
commit, so releases reach installed apps but not the web. Resume by setting it back to main's
`update.json`. Meanwhile the web page (1.9.67) still syncs with newer desktops, and it only syncs the
top-level vault keys it knows (`SYNC_LISTS`, `SYNC_MAPS`, `SYNC_SETS`, `SYNC_VALUES`) and rewrites
store modes it doesn't know (`fixMode`). A release in the meantime that adds either would have it
undone by a web device that syncs a change, so keep those for the big update. New fields on existing
items and new shared settings keys are safe (a new per-device setting would still sync through a web
device, which doesn't know to keep it local). Its Import profiles also predates `xlUnwrap`, so it
doesn't read the `="…"` cells in slot files.

From 1.9.71, **Generate** (sidebar, under Cards) makes profiles in bulk: one address, a name prefix
(`<name> #n`, numbered after the highest in use), how many, and pasted emails (the first word of each
line, so `email:password` works). Each draft gets the address, a random name (`GEN_FEMALE`/`GEN_MALE`,
`GEN_LAST`), a random phone number with one of the state's area codes (`GEN_AREA`) and the next email.
The drafts are edited one by one (to jig the address), then imported into Profiles on the stores picked
then, each with an address of its own, billing the same, no card, and store logins linked by email
(`linkByEmail`). Because of the pause, drafts aren't a vault list: they're the shared setting
`genDrafts` (`{id: draft}`), which 1.9.67 keeps and syncs as it is, and which merges per draft. They can
move to a list of their own in the big update.

From 1.9.72, right-clicking a profile (or touch and hold, or Shift+F10) opens its menu, and on one of
several selected profiles the menu acts on all of them: Move to group, Export, Delete. (1.9.72 also had
Mass edit there, with `{jig}`-style expressions; the owner wanted profiles left alone once they're done,
so 1.9.73 moved it to Generate and dropped the expressions.)

From 1.9.73, **Jig and Mass edit** are on the Generate page, for drafts: right-click a draft (or the
selection bar) for Mass edit, Jig addresses, Import and Delete. Jig must stay simple, since stores cancel
orders to addresses that look made up (the owner's rule), so it only writes an address the ways USPS reads
as the same address (Publication 28, which USPS's own lookup follows; its site is blocked from Claude's
environment, so the rules came from public copies of its tables). `jigChoices` works on parts (line 1,
line 2, city, ZIP) and uses, in order: the usual spellings, fewest changes first (a direction N, N.,
North; the street type's USPS standard abbreviation Dr, Dr., Drive, or Way/Wy; the unit Apt 4, Apt #4,
`# 4` as USPS writes it, on line 1 or line 2; Saint/St/St., Fort/Ft, Mount/Mt in the city; the ZIP with or
without its ZIP+4), then the address as it was, then a numbered street written out (18th/Eighteenth, 21st/
Twenty First; USPS treats them as one street unless an area has both), then the other spellings USPS lists
for street types (`JIG_C1`, Appendix C1: Str, Strt, Avn, Drv… they look like typos; the owner wanted to
test them), and last a dot inside a street-name word ("Or.chard"), which USPS's rules don't cover and works
some of the time. Never letters in front. `jigAssign` gives each draft an address no other draft or saved
address has (`jigTaken`); ones with no way left keep theirs and are counted, as are those that needed
the later tiers (`jigNotes`). A draft keeps a ZIP+4 Jig left off in `zip4`, so Jig can put it back.
Jig addresses applies at once with Undo; Mass edit (`openDraftMassEdit`, `dmPlan`) shows every draft as
it will be before Change, with Jig on each address line, City and ZIP, and New random names and numbers,
as boxes instead of codes. The draft editor has the same Jig links (`jigNext`). Drafts only gain the
`zip4` field, so the paused web version is unaffected.

From 1.9.74 one profile can be jigged on Profiles too (never several at once: the owner keeps bulk Jig on
Generate): Jig address in its ⋯ and right-click menu (`jigProfile`, with Undo), and in the profile editor
Jig links on the shipping address's Address 1 and 2, City and ZIP plus Jig all beside Standardize
(`data-pe-jig`, `jigOneAddr`). A jigged address mustn't match any saved address or draft (`jigTakenAll`),
and a copy is made when other profiles share it. Billing never gets jigged: a profile billing to its
shipping address keeps the address as it was as billing (`billSame` off, the old address as `billId`),
since the bank checks it against the card. At the owner's request the Shipping address section says not
to jig a billing address unless the card is a virtual credit card.

From 1.9.75 each draft keeps the address typed in the Generate window (`billTo`, a draft field). Jig never
changes it; a street, city, state or ZIP typed in Mass edit is a correction and changes it too. Import asks
which billing address the profiles get (`planDraftImport(ids, picked, bill)`): the typed address, for
regular cards and picked by default (each jigged profile gets it as a billing address with its own name,
`billSame` off), or the jigged shipping address, for virtual cards (`billSame` on, as before). The last
choice is the shared setting `genBill`. Drafts made before 1.9.75 have no `billTo` and bill to their
shipping address; the Import window counts them.

From 1.9.76 the app is called **FAFO** (the owner's choice, in capitals), everywhere a person reads it: the
window title, every message, the Discord messages and pages from the license worker, the share image's footer,
and files it saves (`fafo-backup-<date>.json`, `fafo-template.csv`). The name itself (`.wordmark`) is in
Bruno Ace SC, loaded from Google Fonts with only its letters (`text=FAFO`), at 59px on the lock and license
screens and 30px in the top bar (times `--fs`), the same in every theme. Messages that name the app's file
say `FAFO.exe` on desktop 12 and `Orbit.exe` on older downloads (`DESK_EXE`); download links point at
`FAFO-Windows.zip`; Import still says it reads Orbit exports. Still Orbit, on purpose: the web version
(paused at 1.9.67), the relay's phone page (not in this repo), every storage key, sync format (`orbit-sync…`,
`orbit-cmd`) and worker name or address, the hidden "Profile Vault" username for password managers, and the
Actions' names ("Publish Orbit update").

From 1.9.77, **Duplicate** on the Generate page (selection bar and right-click menu, `openDraftDuplicate`,
`dupPlan`) adds drafts like the ones picked: How many (one of each picked to start; more goes round them in the
order shown), each numbered after the highest `<name> #n` in use for its name (drafts and profiles,
`genNextNumber`), so Target #1–#10 give Target #11 on. A copy keeps its draft's name, group, address, `zip4`
and `billTo`, never its email; Jig each address (on) gives every copy its own spelling (`jigAssign` against all
drafts and saved addresses), New random phone numbers (on) uses the state's area codes, New random names is
off, and pasted emails go one each. The new drafts come selected, with Undo. They're ordinary entries in
`genDrafts`, so the paused web version is unaffected.

From 1.9.78 a red icon (`issueIcon`) by the name of a profile (every layout) or draft says it couldn't check
out as it is; hovering, focusing or tapping it shows what's wrong, one line per part (a floating `.issue-tip`).
`profileProblems` makes the profile editor's own checks: shipping and billing addresses (`addrProblems`), the
card (`cardProblems`: missing, `validateCard`, expiry, CVV, name on card), the email (none needed when every
store is on Use Assigned Account; otherwise a store login's email, the 1.9.66 rule), the phone, and each store's
login or Pokémon Center checkout email. `draftProblems` checks a draft's name, address, email and phone. Mass
edit's Email is a box of emails, one per draft in the order shown (`dmPlan`): fewer leaves the drafts after
them out of the whole edit, more makes new drafts for the rest (copies from `dupPlan`, jigged, new numbers)
that get the edit too, and both ask first (`confirmDialog`, which now takes a `cancel` label).

From 1.9.79 a profile's name comes first on Profiles, before its group tag (which used to squeeze it to a
letter or two in Compact and the List). On a card (`slipTitleHTML`, `.slip-title`) the name takes up to two lines
(its text is in `.sn-t` inside the button, as Electron 33 may not clamp a button's own lines), the group moves
under it when both don't fit on one line, and the checkbox, problem icon and buttons line up with its first line.
The icon and the name stay together (`.slip-nm`). In the List the Name column is wider (20%), and the group gets
shorter, then goes onto a hidden second line (`.pl-name` wraps and clips), before the name is cut; hovering the
name shows its group. Generate's Profile column is 19%. Tests that find a card's name button by its exact text
need `:has-text` or a `hasText` regex now, since the text is in the span.

From 1.9.80 Jig is for **Target or Pokémon Center** (the shared setting `jigFor`; the choice is on the Generate page,
in the draft and profile editors and in Mass edit, and Jig's buttons and menus name it). Target is the USPS-spelling
Jig above. Pokémon Center (`pkcAssign`) follows the owner's notes on the Mega Evolution drop (18 orders, none
canceled): each draft at one building gets a line 2 of its own, a unit the building doesn't have (`PKC_MADE`: Ste,
#fl, Bldg, Ofc, Suite, Dept or Ste. with a letter, Spc, Apt, with a new number each time), a bare number on line 1,
or no unit with the street type the other way. A building with a real apartment keeps its number and only the word
before it changes (`pkcRealUnit`), so the package still gets there. Up to five per address went through; more get
a warning (`pkcCrowded`, counting every draft there). A name already on the street (other drafts', and other
profiles' shipping addresses: `pkcNamesTaken`) gets a letter doubled so it reads the same (`pkcNameForms`: a
consonant between vowels, e or o away from other vowels, an e or h where names have one), the last name and the
first name taking turns, and both only once those run out. Each draft remembers what that Jig changed (`d.pkc`: the
lines and name it wrote, and what they were), and `pkcBase` gives those back while the draft still shows them: so
jigging again, the editors and Duplicate start from the building, and Import bills to the real name and (for a
draft with no typed address) the address before the Jig. One profile (menu, editor) gets a unit, and a doubled
letter when its name is on the street; billing keeps the address and name as they were. Drafts only gain `pkc` and
settings `jigFor`, so the paused web version is unaffected. Clicks on `data-act="jig-for"` are handled inside
layers too (the global handler skips other layer clicks).

From 1.9.81 Room (1–40) is one of Jig for Pokémon Center's made-up units (`PKC_MADE`), and `Room n` one of the
words for a real unit's number. Line 1 still only reads Apt, Unit, Ste, Suite or # at its end as a unit
(`JIG_UNIT_AT_END`, shared with Target's Jig), so Room, like Bldg or Spc, counts as a unit on line 2.

From 1.9.82 Import cards takes a CSV file (Choose a CSV file beside the Cards box, or dropped on it) into its box;
`readTextFile` reads UTF-8, or Windows-1252 for Excel's plain CSV. A list whose first line names its columns, comma
or tab separated, is read by those names (`parseCardTable`, `cardColumn`: Import profiles' card names `C_AL` plus
`CARD_COL_AL`). Before, a separate year column was taken as the CVV. FAFO's own Export cards (`CARD_CSV_COLS`) comes
back as it went out: Category Virtual or Physical, Provider by name (`vcProviderOf`), Provider Card, Website, Notes'
`Limit …`, and Target RedCard in Card Type. A rounded card number (4.24242E+15) is skipped and said, a CVV gets back
the leading zeros a spreadsheet drops, `="…"` cells read as text, and Card State's closed cards are skipped. The
summary names columns with values that no card took. Lines without column names are read as before
(`parseCardLines`). Cards gain no fields, so the paused web version is unaffected.

From 1.9.83 FAFO gets through networks that block `raw.githubusercontent.com` (the owner's did: security filters in
routers, internet providers' apps and antivirus often block it, since anyone can host files there). The license
worker serves a copy fetched from GitHub there: `GET /mirror/update.json`, `/mirror/index-X.Y.Z.html` and
`/mirror/licenses.json`, only those names from this repo's main branch, never with the request's query; pages are
kept a day and go out as `text/plain` with `nosniff`, the JSON a minute. Everything in them is signed, so the copy
can't change anything. `licFetch` tries GitHub, then the copy, for hand-made keys (a copy whose signature fails moves
on too). A failed update check on the built-in address with a `net::ERR_…` error tries once more through the copy
(`updViaMirror`: `setUpdateSource(UPDATE_MIRROR)`, check, then back to the built-in address unless another was saved
meanwhile), whether the user clicked Check for updates or a check ran on its own (those at most every 20 minutes);
an update address of the user's own is left alone. `updErrorText` puts update errors in words, with Chromium's code
at the end. Older pages that are blocked can get 1.9.83 by pasting `…/mirror/update.json` into Settings → Updates →
Update address once.

From 1.9.84 **Edit names** in the Cards selection bar (`openCardNames`, `cardNamesPlan`) changes the name on every
selected card at once: the first and the last name each stay as they are on each card unless ticked, then they're
what's typed or New random first (or last) names, each card its own (`genName`; Shuffle rolls again). A name splits
at its last word (`cardNameParts`: Mary Ann | Smith). A card named in capitals gets capitals; one with no name follows
most of the others, and the preview says when a card would end up with one name. Change has Undo. Generate's Mass
edit has New random first names and New random last names as two modes (`rfirst`, `rlast`) where 1.9.73–1.9.83 had
one (`names`) for both; each list is rolled once per set of drafts and avoids another draft's full name. Cards and
drafts gain no fields, so the paused web version is unaffected.

From 1.9.85 Shift+click (or Shift+Space) on a row's tick on Profiles (every layout), Cards and Generate gives every
row between it and the last one clicked, in the order shown, the same tick (`selRange`, `SEL_LAST`, by the order of
`#main input[data-act=…]`), as Orders already did (`UI.orderLast`). The text selection a Shift+click makes is cleared.

From 1.9.86 a card has a note (`c.note`, up to 200 characters): the Cards list's Note column edits it in place
(`cardNoteBtn`, `editCardNote`; an empty one says Add a note on hover), the card editor has a Note field, and card tiles
show it. Export cards writes it in Notes before a virtual card's limit (`note; Limit …`) and Import cards splits them
back. Searching Cards needs every word typed to match (`cardMatches`): digits match any part of the number or the expiry
(07/31), words the nickname, name on card, note, brand, group, virtual card details and the names of the profiles using
it. Ctrl+F goes to the search box in the desktop app. Put in profiles can go to Profiles I pick (a list to search and
tick, Shift+click for a range). Import drafts to profiles has a third billing choice, A different billing address
(`planDraftImport(ids, picked, bill, other)` with `bill` `"other"`), typed or started from a saved address, which every
profile gets with its own name; the last one used is the shared setting `genBillAddr`. In the profile editor a store
with more than six logins has a search box over them (`loginFind`: a single match is picked, Enter picks the first), the
Name on card field only shows for a card named other than the shipping name (no checkbox: Different name on card, in the
Payment heading, shows it; a card named in capitals keeps capitals, `capsLike`), and there's no Email box (the owner's
request). The profile's email follows its stores
(`emailToSave`): its store login's (the one it had, when its logins use different emails and it's one of them), or
Pokémon Center's checkout email with no login, or none on Use Assigned Account. A store waiting for a login still gets
the saved login with the profile's email, and a profile needs a store to save. Cards gain `note` and settings
`genBillAddr`, so the paused web version is unaffected.

From 1.9.87 Submit sends each store's slots as an AYCD profile list too (`slotsFiles` adds `kind: "aycd"` after each
store's CSV, `slotAycd` per row): the account the slot checks out with (`slotEmail`, as in the CSV) on both addresses,
the state and country written out (`aycdCountry`, `aycdState`, which Export → AYCD JSON shares), the card's own name,
and `matchNameOnCardAndAddress` true when that's the billing name. The worker posts it as `…-<store>-aycd.json`.

From 1.9.88 Ungrouped (in the Profiles and Cards sidebars, and Cards' chip) has the group menu too, with only Rename
(`nameUngrouped`, the owner's request): the name becomes a real group holding every profile or card that had none
(their `groupId`), shown in its place, with Undo. A name already in use, or Ungrouped itself, is refused, and ones
added later without a group show under Ungrouped again. `promptDialog` takes a `hint` and clears its error as you type.

From 1.9.89 right-clicking a store login (any layout; or touch and hold it, or Shift+F10 on one of its buttons) opens its
menu (`data-lmenu`, `loginContextMenu`, the owner's request): Rename (its label, the name under the store; empty removes
it, `renameLogin`), Copy password, Edit and Delete (`deleteLogin`, which its Delete button uses too). Any scroll closes a
menu, so tests that right-click scroll the item into view and let it settle first.

From 1.9.90 **Mass edit** is back on Profiles (the owner's request; 1.9.73 had moved it to Generate): right-click one of
several selected profiles, or Mass edit on the selection bar (`openProfileMassEdit`, `pmPlan`, `pmApply`, `pmUndo`). As on
Generate, each ticked field goes onto every selected profile, the window shows every profile as it will be (columns only
for what changes), and Change has Undo. Fields: Group, Profile name (numbered in the order shown, after the highest
`<name> #n` in use: `genNextNumber` now skips the selected profiles too), Phone (or Random, by state), Size, Only one
checkout, Stores (add, in Store login or Use Assigned Account, which also switches a store a profile has; remove; a
profile can't be left with none), the shipping name (or New random first or last names) and address, and Bills to
(their shipping address, or one typed address in each profile's own name). No Jig (bulk Jig stays on Generate) and no
Email: the email follows the stores (`pmEmail`, as `emailToSave`). A card in the old shipping name takes the new one
(`capsLike`) when every profile using it goes the same way, and a billing address of its own in that name does too.
Addresses go through `resolveAddr`, so one shared with unselected profiles gets a copy. Pokémon Center's mark is a
Pokéball (`pokeballSVG`, `isPokemonCenter`; `drawPokeball` in the share image), in its pills and lists and its store
filter chip; the relay's phone page still shows PC. Settings → Accounts to assign gains Remove accounts (the worker
section above). Profiles gain no fields, so the paused web version is unaffected.

From 1.9.91 Submit shows whether the seller has approved each batch sent to their channel (the worker section above):
**Pending approval** with a clock (`.pill-wait`), then **Success** with a check, also counted in the store's chips and
the Submitted stat (`subState`). The channel gets each store's AYCD list and logins only, and the app says "AYCD files".
Submitted slots (`subs` entries) gain `batch` and `okAt`, which the paused web version keeps and shows as Submitted.

From 1.9.92 a batch the seller declines (the worker section above) shows **Declined** with an x (`.pill-no`, `declinedAt`,
`subState` "no"), counted in the store's chips and the Submitted stat, with a note in the store and a message. Switching a
declined slot off (or Deselect all, or swapping it out at the cap) clears it without asking and without a `/pull`
(`clearDeclined`; `pullSlots` never tells the seller about one), and switched on again it goes out in a new batch. Clean
emails also catches mail from senders named for a sale event (`CLEAN_SALE_FROM`: "Deal Days", "Circle Week"), the owner's
screenshot of a dozen "Target Circle Deal Days is here 🔥" at once: copies from ordinary-looking addresses with no
newsletter headers reached the Inbox unfound (Spam already cleared them). It goes to the desktop app in `surveyFrom`,
which it tests against the sender's name too and hands back whatever the subject says, so `applyCleanSafety` gives those
the app's subject check (`CLEAN_APP_PROTECT`) like relayed mail; the new `CLEAN_RULES_KEY` makes auto-clean look back 30
days once. `subs` entries gain `declinedAt`, so the paused web version is unaffected.

From 1.9.93 Store logins can be selected as on Cards (the owner's request): a tick on each login in every layout
(`login-sel`, `loginPick`), Select all, and Shift+click for a range (`selRange`). The selection bar and the right-click
menu on one of several selected (`loginContextMenu`) then move them to a group, edit them or delete them. Logins have groups:
chips above the list, the sidebar under Store logins, a Group column in the List once there are groups, and a Group
field in the login editor. The group menu (`groupKind("login")`, whose `add`/`remove` the other kinds now have too) renames
or deletes one, with no Duplicate since a store takes each account once. While the web version is paused, groups are the
shared setting `loginGroups` (`{id: {id, name}}`, merged per group like `genDrafts`), and a login's group is its `groupId`.
Edit (`openLoginMassEdit`, `lmPlan`, `lmApply`, `lmUndo`) sets the group, name, password or inbox of every selected login,
shows each as it will be, and has Undo. Delete (`deleteLogins`) takes them off their profiles, also with Undo.
Clean emails also clears forwarded store newsletters. The desktop app reads the start of a forward whose subject isn't a
sale, to protect forwarded orders, and Target's Magnolia newsletter came in a version opening "And... Wrangler's new drop
has arrived", which it kept in the Inbox and in Spam (the owner's screenshots). `CLEAN_STORE_FROM` (a store's newsletter
address: a marketing subdomain of a store the app knows, so not `orders@oe.target.com`) goes in `surveyFrom`, so the app
hands that mail back, forwarded or not, and `applyCleanSafety` checks its original subject, with `CLEAN_APP_PROTECT` too.
"Alert" no longer protects a plain sale (`CLEAN_WEAK`, for KOHL'S DEAL DAYS ALERT). Auto-clean's folders are its own
setting (`autoClean.folder`, the Folders menu in its box, `AUTO_FOLDERS`). Until 1.9.93 the Folder menu above the scan set
them too, so a Spam only scan left the owner's Inbox uncleaned. Changing them looks back 30 days on the next run.
Logins gain `groupId` and settings gain `loginGroups`, so the paused web version is unaffected.

From 1.9.94 the store pickers offer only Pokémon Center and Target (`PICK_STORES`, the owner's request: "remove other
retailers except Pokémon Center and Target"), with no Another store (`storePillsHTML` shows it only with `allowNew`,
which nothing passes). `STORES` keeps the rest for what's already saved: an item's own stores still show in its picker
(`extra`, and they stay offered while its editor is open, so one taken off can go back on), Mass edit's Remove offers the
stores the selected profiles have, Put in profiles' Limit to a store the stores profiles use, and the filters on Profiles,
Orders and Submit list every store the data uses (`allStoreOptions`). Target's mark is its red bullseye (`bullseyeSVG`,
`isTarget`; `drawBullseye` in the share image), as Pokémon Center's is a Pokéball: the owner's request, where it was a red
tile with a T. The relay's phone page still shows T. Nothing gains a field, so the paused web version is unaffected.

From 1.9.95 selected store logins can be copied (the owner's request): the right-click menu on one of several selected
and the selection bar's Copy (`logins-copy`) offer Copy N emails and Copy N email:password (`loginCopyItems`,
`copyLogins`), one per line (CRLF) in the order the list shows them, then any selected that the search or group hides
(`loginsInOrder`); the toast counts any without a password. One login's menu has Copy email and, when it has a
password, Copy email:password. Nothing gains a field, so the paused web version is unaffected.

From 1.9.96 each profile is for **one store**, Target or Pokémon Center, with its own shipping and billing address (the
owner's choice: "each retailer should have its own billing and shipping"). For the other store there's **Duplicate**: its
button, the ⋯ menu and right-click offer Duplicate for Target and Duplicate for Pokémon Center (`dupMenuItems`, with the
store marks `openMenu` now takes as `mark`; `copyProfile(p, k, names)`, `duplicateProfile` with Undo). A copy for the other
store keeps the name exactly unless a profile on that store has it, since the license worker pairs a buyer's Target and
Pokémon Center profiles by name (`reuseAccount`): a Pokémon Center slot on Use Assigned Account gets the account its Target
slot got. Names are unique store by store (`nameOnStore`); renaming one of a pair (`twinsOf`) asks whether to rename both
(`confirmDialog` now resolves `false` for its cancel button and `null` when closed), and Mass edit numbers a pair together.
The editor's Store pills pick one store (`setStore`, no ×), and a profile can't move off a store while its slot there is on
or submitted (in Mass edit too, whose Add and Remove became one Store row). Store logins never add a store (`linkLogin`
returns false), the login editor lists only the profiles on its store, and Import accounts says which accounts only match a
profile on another store. Imports make one profile per store: one in a file on several stores becomes one for each
(`planImport(flat, picked)`, which also takes the stores picked for rows that name none, and skips one already here by name,
store, address and card), a submitted slot keeps only its store (`slotFlat`, codes and the inbox), and Generate's Import
makes one profile per draft per store picked. Put in profiles gives a pair the same card, and Duplicate on a group gives a
pair's copies one new name between them. Every profile has addresses of its
own: `resolveAddr` never takes another profile's address (no match by content any more), Fill copies one, and Duplicate and
imports make copies. A vault from before, and whatever an older device or the paused web version syncs in, is put right by
`oneStorePass` (between `ONE-STORE-START` and `ONE-STORE-END`; `.github/scripts/one-store.test.mjs` tests it on pull
requests), run after every merge with the online copy and once after unlocking: at unlock with sync off, and with sync on
after the first sync round (`SYNC.oneStoreDue`), so the device catches up first. Split before that, its out-of-date copy
would count as its own edits, made then, and undo what other devices changed or deleted meanwhile.
If that round can't merge (offline, an error), or nothing has after 10 seconds, it splits the copy it has (`oneStoreLate`),
as it does before a profile on several stores is edited, duplicated or mass edited (`splitNow`); a device that updates
while offline can then still undo another device's change to a profile it split. The pass works on a person's profiles,
those with the same name: each keeps a store (a copy the pass made the one its id names, a profile on one store that one,
the rest the first of Target, Pokémon Center and the others that no other keeps), and each other store goes back to the one
that keeps it, filling in only a missing login or checkout email, unless both have that slot switched on (two slots need two
profiles), or else to a copy with the id `<id>.<store>` (`.o` + a hash for a typed store, then `.2`… if taken), taking that
store's switched-on slot, `subs` mark, last batch, pulls and checkouts with it. A slot left under a profile's old store goes
to the same person's profile on it. An address two profiles use goes, for every one but the lowest profile id, to a copy
with the id `a` + `syncHash(address id + "|" + profile id)`, numbered when a profile uses that one (an unused one from
before gets the address as it is now). `syncAdopt` no longer drops a submitted mark whose slot isn't on: `syncTrim` does,
after the pass has moved any a 1.9.95 device submitted under a profile's old store. Every id comes from the data, so
devices that split the same vault agree, and a second run changes nothing. The first split is noted in the shared setting
`storeSplit` (`{at, n, addrs}`) for a note on Profiles until Got it (`_storeSplitSeen`, kept per device). The store's mark shows by each profile's name (`slipStoreHTML`). Profiles gain no fields
and there's no new list, so the paused web version is unaffected; it can still put two stores on a profile or link an
address, which the next 1.9.96 sync puts right (sent in the same round, and then nothing more to send).

From 1.9.97 the store chips on Profiles count the profiles shown before a store is picked: those in the group picked that
match the search (`profilesInView`, which `visibleProfiles` narrows to the store; the owner's request: a group's Pokémon
Center chip counted every group's profiles there). Each store any profile is on keeps its chip, at 0 where the group has
none, and picking one there says which stores the group's profiles are on, with Show all stores, where it said the group
was empty. Nothing gains a field, so the paused web version is unaffected.

From 1.9.98 slots that an app before 1.9.91 sent through the worker after approvals began show the seller's decision too
(the owner's report: a buyer's slots said Submitted while their batch waited for approval). Those apps didn't keep the
batch id they sent, so `adoptBatches` (run by `refreshApprovals`) asks `GET /submissions/batches?since=&until=` (license
Bearer: that license's batches, each with `at`, `slots`, the sender's `name`, `status` and `decided`, and the worker's
`now`) and gives each such send (its `subs` entries share `at`; `to` `"CSV"`, from `APPROVALS_FROM` on) the batch sent
under its `from` name, with room for its slots, nearest in time once the computer's clock is set against `now`, and later
than the batch the send before it got, never one a `subs` entry already has. It then shows Pending approval, Success or
Declined like any other. A send with none is marked `noBatch` (Submitted, with a tooltip saying why) and isn't asked
about again. `subs` entries gain `noBatch`, so the paused web version is unaffected.

From 1.9.99 Submit tells the license worker which of the buyer's slots are still out on each store it asks accounts for
(`slotsOut`: `active` {storeKey: [profile names]} with `/submissions`, leaving out declined ones), so a slot on Use
Assigned Account that was switched off and sent again gets back the account it had (the worker section above; the
owner's report: a buyer's re-sent Target slots got no accounts, and so no logins file, once the license reached its
limit). Nothing gains a field, so the paused web version is unaffected.

From 1.9.65, Settings → Web version & sync keeps a vault in step across the
desktop app, the web version and other computers. The license worker stores
one copy per license (`/vault`, D1 `vaults` and `vault_chunks`), sealed in the
page with the vault's own key before it's sent (`syncSeal`: gzip, then
AES-GCM). `deriveKeys` runs PBKDF2 once: its 256 bits are the vault key (the
same key `deriveKey` always made) and an HMAC of them is the access token, of
which the worker keeps only a hash; 10 wrong tokens lock the copy for 15
minutes. The license key is the copy's identity, so the web version asks for
it (or fills it in with Discord) in **Open my synced vault**
on the lock screen. Each device merges per unit, three ways, against what the
two last agreed on (`syncMerge`, between `SYNC-CORE-START` and
`SYNC-CORE-END`; `.github/scripts/sync-merge.test.mjs` tests it against the
newest page on every pull request that changes a page): list items by id, map
entries (settings, caps, subs, deletedOrders) by key, slots by value. A change
on one side wins. The same unit changed on both is merged field by field
against its starting version (`L.orig`, kept for what this device changed), and
a field both changed takes the later change (`mt`, noted within a second of the
change, also with sync off); an edit beats a deletion, except that an order
deleted on purpose (its key in `deletedOrders`) stays deleted. Never synced:
`S._local` (that device's bookkeeping: `base` hashes, `rev`, `vid`, `mt`,
`orig`), `pulls`, `LOCAL_SETTINGS`, and the email-sync progress fields on each
inbox (`SYNC_DEVICE_FIELDS`). **A new setting key, or a new field email sync
writes on an inbox, syncs unless it's added there**, so add per-device ones. A
collecting key that loses a merge goes to `shareOld`, and codes for it still
open (`openSubmissionAny`). Merges wait while a window is open or email is
syncing (`syncBlocked`). The record isn't compressed (its size would leak what's
in it), carries its revision and vault id (`seq`, `vid`, so a stale, replayed or
other copy is refused), and a vault id that changes turns sync off rather than
merging into a new copy. The page only derives the token with a 16-byte salt and
at least `ITER` rounds, whatever `/vault/info` says. A password change moves the
online copy first (`syncChangePassword`); other devices then get 403 (the old
password's token answers "password changed" and doesn't count toward the
lockout), stop retrying, and ask for the new password, or take it on the lock
screen and ask for the previous one to bring their own copy along
(`syncUnlockOnline`). Restoring a backup turns sync off; erasing a device keeps
the online copy. 1.9.65 also stops `sanitizeState` dropping `deletedOrders`,
which until then lasted only until Orbit closed.

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
