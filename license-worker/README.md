# Orbit license worker

Gives new users a license key through Discord. In Orbit (1.9.41 and later), a new user
clicks **Continue with Discord** and signs in with Discord in their browser. Then either:

- **You approve each request** (`REQUIRE_APPROVAL = "true"`, the setting in
  `wrangler.toml`): the request appears in your Discord channel with a link to approve or
  deny it. See [Approving each key yourself](#approving-each-key-yourself).
- **Or keys are handed out straight away** (`REQUIRE_APPROVAL = ""`): Orbit activates by
  itself a few seconds after sign-in, and you don't have to do anything.

- Each Discord account gets one key. Signing in again gives the same key back.
- Keys are listed (as SHA-256 hashes) in a list this worker signs with its own key.
  The app checks that list as well as `licenses.json` on GitHub, so the keys you
  make by hand keep working.
- Revoke a key and the app locks on its next check (at launch and every 6 hours).
- The browser page after sign-in also shows the key, so the user can keep a copy.

It is separate from the `orders` relay worker (phone tracker), whose source is lost.
Nothing here touches that worker.

## One-time setup

You need Node.js (https://nodejs.org, the LTS version) and your Cloudflare login.
Run these in a terminal inside this `license-worker` folder.

1. **Install and log in**

   ```
   npm install
   npx wrangler login
   ```

   Log in with the Cloudflare account that owns `orbit-app.workers.dev`.

2. **Create the database**

   ```
   npx wrangler d1 create orbit-license
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing the zeros. Then:

   ```
   npm run db:init
   ```

3. **Deploy**

   ```
   npm run deploy
   ```

   It prints the worker's address. It must be
   `https://orbit-license.orbit-app.workers.dev`, because that is what the app
   calls (`LICENSE_RELAY` in `index-*.html`). If it prints something else, the app
   needs that address instead.

4. **Add the secrets.** Each command asks you to paste the value.

   ```
   npx wrangler secret put DISCORD_CLIENT_ID
   npx wrangler secret put DISCORD_CLIENT_SECRET
   npx wrangler secret put LICENSE_SIGNING_KEY
   ```

   - The Client ID and Client Secret are on your Discord application's **OAuth2** page
     (https://discord.com/developers/applications).
   - `LICENSE_SIGNING_KEY` is the private key that goes with the public key built into
     Orbit 1.9.41. Paste the whole line, starting with `{"kty":"EC"`.

   Optional:

   ```
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put DISCORD_WEBHOOK_URL
   ```

   - `ADMIN_TOKEN`: any long random password. It turns on the list, revoke and
     restore commands below.
   - `DISCORD_WEBHOOK_URL`: a webhook for one of your channels (Channel settings >
     Integrations > Webhooks). Required when approving requests yourself (see below);
     otherwise the worker posts there each time someone gets a new key. Keys themselves
     are never posted.

5. **Add the redirect in Discord.** On the application's **OAuth2** page, under
   **Redirects**, add this and save:

   ```
   https://orbit-license.orbit-app.workers.dev/discord/callback
   ```

6. **Check it.** Open https://orbit-license.orbit-app.workers.dev/discord/ready in a
   browser. It should say `{"ready":true}`. Until it does, Orbit hides the Discord
   button, so nothing breaks while you set up.

## Deploying automatically

After the one-time setup, you don't need to deploy by hand. The GitHub Action in
`.github/workflows/deploy-license-worker.yml` runs whenever a change to this folder is
merged into `main`: it runs the tests and, only if they pass, updates the database
tables and deploys. You can also start it from the repo's **Actions** tab (**Deploy
license worker**, then **Run workflow**).

It needs three settings in the GitHub repo, under **Settings → Secrets and variables →
Actions**:

- **Secret `CLOUDFLARE_API_TOKEN`**: in Cloudflare, go to **My Profile → API Tokens →
  Create Token**, start from the **Edit Cloudflare Workers** template, add
  **Account → D1 → Edit**, and create it.
- **Secret `CLOUDFLARE_ACCOUNT_ID`**: shown by `npx wrangler whoami`, or on the right of
  the **Workers & Pages** page in Cloudflare.
- **Variable `D1_DATABASE_ID`** (on the **Variables** tab): shown by
  `npx wrangler d1 list`. The copy of `wrangler.toml` in the repo keeps zeros, and the
  Action fills in this id when it deploys.

The worker's own secrets (Discord, signing key, webhook) stay in Cloudflare and are kept
across deploys.

## Approving each key yourself

With `REQUIRE_APPROVAL = "true"`, each new Discord account that signs in is posted to a
channel of yours:

> 📝 **New Orbit key request** from **@name** · Discord ID … · account created …
> [Review: approve or deny](…)

The link opens a page with **Approve** and **Deny** buttons. Approving issues the key
and shows it on that page with a **Copy key** button, in case you want to send it to
someone yourself (it's never posted in the channel);
the message in your channel then changes to ✅ Approved or ⛔ Denied, and keeps the link
so you can change your mind later (denying someone you approved turns their key off).
Opening the link by itself changes nothing: only the buttons do.

What the person sees:
- **Orbit 1.9.42 and later** says it's waiting for your approval and activates by itself
  once you approve, even if they closed Orbit in between (for up to 7 days).
- **Orbit 1.9.41** says "Request sent" and asks them to click Continue with Discord
  again after you approve. Doing that activates it straight away.

People who already have a key always get it back without a new request.

### Setting it up

1. **Make a private channel** in your Discord server, for example `#orbit-requests`, that
   only you can see. Anyone who can see the messages there can approve requests.
2. In that channel: **Edit Channel → Integrations → Webhooks → New Webhook**, then
   **Copy Webhook URL**.
3. In this folder:

   ```
   npx wrangler secret put DISCORD_WEBHOOK_URL
   npm run db:init
   npm run deploy
   ```

   Paste the webhook address when asked. `db:init` adds the table for requests; running it
   again is safe and keeps the keys already issued.

Until the webhook is set, `/discord/ready` says `false` and Orbit hides the Discord
button, so requests can't get lost.

If posting a request to your channel fails (for example Discord is down), it's posted
again the next time that person signs in, and every request's review link is also in
the `/admin/applications` list below.

To go back to handing keys out straight away, set `REQUIRE_APPROVAL = ""` in
`wrangler.toml` and run `npm run deploy`. People you denied stay denied.

## Slot limits

Orbit (1.9.46 and later) lets each license have at most **20 slots** switched on at once on
the Submit page, across all stores. Change the starting number with `DEFAULT_SLOT_LIMIT` in
`wrangler.toml`.

When someone needs more, they press **Request more slots** in Orbit, say how many they need in
total and why. The request is posted to the same Discord channel as key requests:

> 🎟️ **More slots requested** · **Kim** · @kim · license …ABCD
> 20 → 40 slots
> [Review: approve or deny](…)

The link opens a page where you can approve the number they asked for, change it first, or
deny it. Their Orbit picks up the new limit within a minute or so while the Submit page is
open, or the next time they unlock. You can change your mind later from the same link:
denying an approved request puts their limit back to what it was.

Each license can have one request waiting at a time and send at most 3 a day. Every limit and
request, with its review link, is in `/admin/slots`:

```
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/slots
```

## Slots sent to your Discord

Every batch people submit from a licensed Orbit is posted to the same Discord channel as files you
can open directly, in a spreadsheet or your bot. There's nothing to set up; it uses the same
`DISCORD_WEBHOOK_URL`. From Orbit 1.9.53 each store gets its own two files:

- `orbit-slots-…-target.csv`: that store's slots, one row each, in these columns: `profile_name,
  first_name, last_name, email, phone_num, cc_number, cc_exp_month, cc_exp_year, cc_cvv,
  shipping_street, shipping_street_2, shipping_city, shipping_state, shipping_zip_code,
  shipping_country, billing_first_name, billing_last_name, billing_street, billing_street_2,
  billing_city, billing_state, billing_zip_code, billing_country`.
- `orbit-slots-…-target-logins.txt`: that store's logins, one `email:password` per line, in the same
  order as the first rows of the CSV.

> 📦 **6 slots** from **Kim** · @kim · license …ABCD
> Target 3 · Walmart 3
> One profiles file (.csv) per store, with its logins (email:password, .txt) in the same order.

Slots without a store login come after the ones with logins and have no line in the logins file; one
on a verified email only (Pokémon Center) has that account's email in the `email` column. Slots set to
**Use Assigned Account** (Orbit 1.9.57+; 1.9.53 called it "Assign me an account") come last: the
buyer added no login because you provide one, and the store line says so, e.g. "Target 3 (2 need an
account)". Discord takes 10 files a message, so a batch with more stores continues in a follow-up
message.

To load a store into your own Orbit, **Import** its CSV and pick that store under Retailers, then on
Store logins use **Import accounts** with the logins file and **Link to profiles** on: each account
goes to the profile with the same email, and the "no login linked" alert lists any left over.
From Orbit 1.9.57, a profile waiting for a login is also linked to a login you already saved with the
same email, when you import the profiles.
Orbit 1.9.52 sent one `.csv` in **Export → CSV**'s columns instead, with each store's login in it.

**The file is plain text.** Anyone who can read the channel, any bot in the server, and Discord
itself can read every card number and password in it, and this worker passes it through (it keeps
no copy, only who sent how many slots). Keep the channel private, keep the server's members and bots
to ones you trust, turn on two-factor sign-in for your Discord account, and delete the files once
you've loaded them.

- Someone who set a recipient by hand on their Submit page (**Send somewhere else**) keeps getting a
  sealed code for that recipient instead.
- Each license can send at most 30 batches an hour. A batch sent again because the answer got lost
  on the way isn't posted twice. Every batch (who, how many slots, never the contents) is in
  `/admin/submissions`, CSV batches with key `CSV`.

### Encrypted files from Orbit 1.9.47–1.9.51

People still on an older Orbit send an encrypted `.txt` instead, once you've set up a collecting
key. The file is encrypted in their Orbit before it's sent, for a key only your own Orbit has, so
card numbers and passwords are never readable by Discord or by this worker. Without a key, those
versions give people a code to send you themselves.

Turn it on once, from your own Orbit (the one you'll open submissions with):

1. **Settings → Password and sharing**. Under **Collect profiles from others**, choose **Set up
   collecting** if you haven't already.
2. Under **Receive slots in Discord**, choose **Send my key to Discord**.
3. Orbit shows a **key ID** and a longer **fingerprint**. In your channel, a message asks you to
   confirm that key. Open its link and choose **Confirm**, but only if the key ID and fingerprint on
   that page match the ones in your Orbit.

From then on, their batches arrive in your channel with the same message and a `.txt` file attached.
To open one, download the file, then in your Orbit choose **Import** and drop it in.

- **Back up your vault.** Only the Orbit with that key can open the files. If it's lost, files
  already sent can't be opened; set up collecting again and send the new key.
- To switch to a new key, send it the same way and confirm it. Orbit seals new batches for the new
  one; older files still need the old vault. Each person's Orbit remembers the key it last sent
  with, and the first time they send after a change it tells them the key changed and asks them to
  press **Send to the new key**, so tell people when you change it. The link in each key's message lets you change your
  mind later, and **Stop using it** turns encrypted sending off for those versions (they then give
  people a code to send you). It doesn't affect CSV batches from 1.9.52.
- Every key and batch (never the contents) is in `/admin/submissions`:

  ```
  curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/submissions
  ```

## Pulled slots

When someone pulls slots on the Submit page after sending them to your channel (Orbit 1.9.50 and
later), a plain list is posted to the same channel so you can take those slots off their list:

> 🔻 **2 slots pulled** by **Kim** · @kim · license …ABCD
> Target · Kim Lee · kim@example.com · Visa 4242 · sent 2026-09-26
> Walmart · Sam Park · sam@example.com · Amex 1005 · sent 2026-09-25
> Take them off their list. Sent for key 1A2B-3C4D.

Each line has the store, profile name, account email, card brand and last 4, and the day it was
sent. Card numbers and passwords are never in it. A list too long for one Discord message comes as
a `.txt` file, with a count per store in the message.

- It's only posted for slots that license sent through this worker: if the license never sent a
  batch to your channel for that key ID (for example it gave you a code instead), nothing is posted.
  Slots sent as CSV (1.9.52 and later) count too; their message ends with **Sent as CSV.**
- A pull sent again because the answer got lost isn't posted twice, and each license can post at
  most 30 pulls an hour. Every pull (who, how many slots, which key, never the list itself) is under
  `pulls` in `/admin/submissions`.
- It needs no new secrets: it uses the same `DISCORD_WEBHOOK_URL`. It does need the `pulls` table,
  which `npm run db:init` adds (running it again is safe) and the deploy Action adds on its own.

## Your accounts for Use Assigned Account

A store on a buyer's profile can be set to **Use Assigned Account** (Orbit 1.9.57+): they add no
login, and you provide one of your own accounts. From Orbit 1.9.58 this worker hands them out from a
list you keep here:

1. In your own Orbit, open **Settings → Accounts to assign → Send accounts**. Pick the store, then
   paste `email:password` lines, or just emails with the password in the box below (for a list that
   all uses one password), or click **Add my Target logins that no profile uses**.
2. Your channel gets a message with the count and a review link. Open it, check the emails, and
   choose **Add to my list**. Only add accounts you sent yourself: anyone with a license can send
   some, but only you can add them. The channel never shows the accounts; the review page shows the
   emails, never the passwords.
3. When a batch with slots on Use Assigned Account reaches your channel, each of those slots gets a
   random free account from the list for its store: its email goes in the slot's row (the `email`
   column) and `email:password` goes in that store's logins file, on the line that matches the row.
   The store line says how many: "Target 3 (2 assigned accounts)".

- **Buyers never see the accounts.** They go only to your channel. The app is told how many slots
  got one, never which.
- **Each account goes to one slot only.** One picked for a batch that never reached your channel
  (the post failed) goes back to the list. If part of a batch went out, its accounts stay with it,
  and sending the batch again posts the same ones.
- **Each license can be given `ASSIGNED_LIMIT` accounts in all** (10; change it in `[vars]` in
  `wrangler.toml`). Slots past that, or past the end of the list, come last with no login line, and
  the store line says "(1 needs an account)" so you can assign those by hand.
- **When the list runs low**, your channel is told: once when a store is down to `ACCOUNTS_LOW_AT` free
  accounts (15), "⚠️ Only 15 Target accounts left…", and once more when it runs out, "🚫 No Target
  accounts left…". Sending more and adding them, or freeing some, sets these up again. Change the
  number in `[vars]` in `wrangler.toml`.
- **Pulling** such a slot names the account it had: "Target · Kim Lee · acct7@example.com (assigned
  account)".
- The list, the waiting offers and those alerts are in the `accounts`, `account_offers` and
  `account_stock` tables, which
  `npm run db:init` (and the deploy Action) adds. With `ADMIN_TOKEN` set:

```
# The list: how many are free per store, who got which, and each offer with its review link
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/accounts

# Give an account back to the list (add "store":"target" if it's on more than one store's list)
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"email\":\"someone@outlook.com\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/free

# Give back every account one license has (lets them get more)
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"key\":\"PVLT-XXXX-XXXX-XXXX-XXXX\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/free

# Take an account off the list
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"email\":\"someone@outlook.com\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/remove
```

The passwords are kept in your D1 database so they can go in the logins files, and they're in your
channel with each batch, like every other login there. Keep the channel private.

## The web version's synced vaults

From Orbit 1.9.65, a desktop app can keep an encrypted copy of its vault here (Settings → Web
version & sync), so the web version at https://app.orbit-app.workers.dev (`web-worker/`) and other
computers can open the same profiles, cards, logins and orders. Nothing to set up: the deploy
creates the `vaults` and `vault_chunks` tables.

- The app seals the vault with a key from the vault's password before it sends it, so the copy
  here can't be read here, by you or anyone with access to the database.
- Reading or saving takes the license key and an access token the app derives from that same
  password. Only a hash of the token is kept. After 10 wrong passwords in a row, the vault
  refuses tokens for 15 minutes. A device still on the password before the last change is told
  it changed, and that doesn't count.
- Each save names the revision it started from, and which vault (when it was made), so a save
  never lands on a copy that was deleted and made again. If another device saved in between, the
  save is refused and the app merges the two before trying again. The current revision and the
  one before it are kept.
- Vaults up to 8 million characters (the app's own copy has to fit in a browser, which holds
  about 5 MB).

```
# Synced vaults: whose, how big, from which device, when. Never what's in them.
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/vaults
```

Someone who forgot the online copy's password can delete it from the app with their license key
alone (Settings → Web version & sync → Delete the online copy, or Replace it when turning sync on),
and turn sync on again. Their devices keep their own copies.

## Limiting who gets a key

By default, any Discord account except bots gets a key. To limit it, edit `[vars]` in
`wrangler.toml` and run `npm run deploy` again:

- `REQUIRED_GUILD_ID`: only members of your Discord server get a key. Get the ID in
  Discord with Developer Mode on: right-click the server, then **Copy Server ID**.
- `MIN_ACCOUNT_AGE_DAYS`: turns away Discord accounts newer than this, which stops
  people making throwaway accounts for extra keys. `30` is a reasonable value.

A single network address can start at most 20 sign-ins an hour.

## Managing keys

These need `ADMIN_TOKEN`. In PowerShell, use `curl.exe` rather than `curl`.

```
# Every key issued, newest first
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/licenses

# Every request and your decision, each with its review link
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/applications

# Turn a key off (by key, or by Discord ID with {"discord_id":"..."})
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"key\":\"PVLT-XXXX-XXXX-XXXX-XXXX\"}" https://orbit-license.orbit-app.workers.dev/admin/revoke

# Turn it back on
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"key\":\"PVLT-XXXX-XXXX-XXXX-XXXX\"}" https://orbit-license.orbit-app.workers.dev/admin/restore
```

A revoked account that signs in again is told its license was turned off. It doesn't
get a new key.

## The signing key

The app only trusts lists signed by the private key in `LICENSE_SIGNING_KEY`.
**Keep a backup of it somewhere safe and outside git**, such as a password manager.
If it's lost, the worker can't sign a list the app accepts. You'd have to make a new
pair with `node scripts/gen-key.mjs`, put the new public key in `LICENSE_AUTO_PUB` in
the app, and ship a new release.

## Tests

```
npm test
```

Runs the worker in Wrangler's local runtime with a local database and a mock Discord,
once handing out keys straight away and once with approval on. It goes through sign-in,
key pickup, repeat sign-in, cancelled and refused sign-ins, the account-age and server
checks, revoke and restore, the rate limit, requests being posted, approved, denied
and changed, slot limits, submissions and collecting keys, pulled slots, and synced
vaults (revisions, two devices saving at once, large vaults, a new password, and the lock
after wrong passwords).
