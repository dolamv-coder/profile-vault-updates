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

From Orbit 1.9.52, every batch people submit from a licensed Orbit is posted to the same Discord
channel as a `.csv` file you can open directly, in a spreadsheet or your bot. It has the same
columns as **Export → CSV** in Orbit: one row per profile, with the address, the full card number,
expiry and CVV, and the account email and password (and email app password) for each store the
profile was submitted for. Profiles with no group of their own get the sender's name as their group.
There's nothing to set up; it uses the same `DISCORD_WEBHOOK_URL`.

> 📦 **6 slots** from **Kim** · @kim · license …ABCD
> Target 3 (2 need an account) · Walmart 3
> CSV attached.

From Orbit 1.9.53 a buyer can set a store on a profile to **Assign me an account** instead of adding
their own login. Those slots are counted on the store line ("2 need an account"), and in the file
their `<store>_account_label` column says `Assign me an account`, with no email or password. Import
the file into your Orbit and those stores come in waiting for a login: the "no login linked" alert
on Profiles lists them, so you can link one of your store logins to each.

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
and changed, slot limits, submissions and collecting keys, and pulled slots.
