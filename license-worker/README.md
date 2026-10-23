# FAFO license worker

FAFO was called Orbit until 1.9.75 (and Profile Vault before that), so older versions are called Orbit here.
The worker's own names (`orbit-license`, its address and its D1 database) stay as they are: installed apps use them.

Gives new users a license key through Discord. In FAFO (1.9.41 and later), a new user
clicks **Continue with Discord** and signs in with Discord in their browser. Then either:

- **You approve each request** (`REQUIRE_APPROVAL = "true"`, the setting in
  `wrangler.toml`): the request appears in your Discord channel with a link to approve or
  deny it. See [Approving each key yourself](#approving-each-key-yourself).
- **Or keys are handed out straight away** (`REQUIRE_APPROVAL = ""`): FAFO activates by
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
   (Since 2026-10-10 the worker also answers at `https://license.fafoaco.com`, a custom domain added in the
   dashboard: Workers & Pages → orbit-license → Settings → Domains & Routes. Pages from 1.9.109 use that address
   first and this one when a network blocks it, so both must keep working, and Discord's OAuth2 redirects need
   `https://license.fafoaco.com/discord/callback` as well as the workers.dev one.)

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
   calls (`RELAY_OLD` in `index-*.html` from 1.9.109, `LICENSE_RELAY` before; from 1.9.109 the app tries
   `RELAY_NEW`, `https://license.fafoaco.com`, first). If it prints something else, the app
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

5. **Add the redirects in Discord.** On the application's **OAuth2** page, under
   **Redirects**, add both of these and save:

   ```
   https://orbit-license.orbit-app.workers.dev/discord/callback
   https://license.fafoaco.com/discord/callback
   ```

   The worker gives Discord the callback on the address the sign-in started from, and FAFO 1.9.109+ starts it on
   `license.fafoaco.com` whenever that answers: without the second redirect, Continue with Discord ends on Discord's
   "Invalid OAuth2 redirect_uri". Add it before a page that uses the new address is released.
   Add them to the application whose Client ID is `DISCORD_CLIENT_ID` (its Application ID on **General Information**;
   the sign-in link shows it as `client_id=`), not another one on the same Discord account: on 2026-10-11 they went to the
   web dashboard's application first, and Discord kept answering "Invalid OAuth2 redirect_uri".

6. **Check it.** Open https://orbit-license.orbit-app.workers.dev/discord/ready in a
   browser. It should say `{"ready":true}`. Until it does, FAFO hides the Discord
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

Optional: a **secret `NOTIFY_USER_ID`** there is copied to the worker on each deploy (see
[Getting pinged for each post](#getting-pinged-for-each-post)).

## Approving each key yourself

With `REQUIRE_APPROVAL = "true"`, each new Discord account that signs in is posted to a
channel of yours:

> 📝 **New FAFO key request** from **@name** · Discord ID … · account created …
> [Review: approve or deny](…)

The link opens a page with **Approve** and **Deny** buttons. Approving issues the key
and shows it on that page with a **Copy key** button, in case you want to send it to
someone yourself (it's never posted in the channel);
the message in your channel then changes to ✅ Approved or ⛔ Denied, and keeps the link
so you can change your mind later (denying someone you approved turns their key off).
Opening the link by itself changes nothing: only the buttons do.

What the person sees:
- **Orbit 1.9.42 and later** says it's waiting for your approval and activates by itself
  once you approve, even if they closed FAFO in between (for up to 7 days).
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

Until the webhook is set, `/discord/ready` says `false` and FAFO hides the Discord
button, so requests can't get lost.

If posting a request to your channel fails (for example Discord is down), it's posted
again the next time that person signs in, and every request's review link is also in
the `/admin/applications` list below.

To go back to handing keys out straight away, set `REQUIRE_APPROVAL = ""` in
`wrangler.toml` and run `npm run deploy`. People you denied stay denied.

## Getting pinged for each post

Discord only shows a red badge for messages that @mention you, even on a channel set to All
Messages. So each new post in your channel (key and slot requests, batches, pulled slots,
accounts, and the rest) can start with an @mention of you:

> @you 📝 **New FAFO key request** from **@name** · …

Nobody else is ever pinged, and edits don't ping again (a request changing to ✅ Approved, for
example). A message that's already at Discord's 2,000 characters goes out without it.

To turn it on, get your Discord user ID (Developer Mode on, then right-click your name and
**Copy User ID**; several IDs can be separated with commas) and either:

- add it in the GitHub repo as the **secret `NOTIFY_USER_ID`** (**Settings → Secrets and
  variables → Actions**). The deploy Action copies it to the worker each time it runs, and you
  can start that run from the **Actions** tab; or
- run `npx wrangler secret put NOTIFY_USER_ID` in this folder.

Don't put it in `wrangler.toml`: this repo is public. To turn it off, delete the GitHub secret and
run `npx wrangler secret delete NOTIFY_USER_ID`.

## Slot limits

FAFO (1.9.46 and later) lets each license have at most **20 slots** switched on at once on
the Submit page, across all stores. Change the starting number with `DEFAULT_SLOT_LIMIT` in
`wrangler.toml`.

When someone needs more, they press **Request more slots** in FAFO, say how many they need in
total and why. The request is posted to the same Discord channel as key requests:

> 🎟️ **More slots requested** · **Kim** · @kim · license …ABCD
> 20 → 40 slots
> [Review: approve or deny](…)

The link opens a page where you can approve the number they asked for, change it first, or
deny it. Their FAFO picks up the new limit within a minute or so while the Submit page is
open, or the next time they unlock. You can change your mind later from the same link:
denying an approved request puts their limit back to what it was.

Each license can have one request waiting at a time and send at most 3 a day. Every limit and
request, with its review link, is in `/admin/slots`:

```
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/slots
```

## Slots sent to your Discord

Every batch people submit from a licensed FAFO is posted to the same Discord channel as files you
can load directly into AYCD or Shikari. There's nothing to set up; it uses the same `DISCORD_WEBHOOK_URL`.
Each store gets its own files, named after the person who sent them (the name they typed when sending, or
their Discord name) and the store, for example `Kim-target-aycd.json` (since 2026-10-09, at your
request; before, `orbit-slots-<date>-<time>-Kim-target-aycd.json`):

- `Kim-target-aycd.json`: that store's slots as an AYCD profile list,
  one profile each, in the order the app sent them and laid out as AYCD exports it: `name`,
  `notes`, `billingAddress` and `shippingAddress` (`name, email, phone, line1, line2, line3, postCode,
  city, country, state`, with the state and country written out), `paymentDetails` (`nameOnCard,
  cardType, cardNumber, cardExpMonth, cardExpYear, cardCvv`), `sameBillingAndShippingAddress`,
  `onlyCheckoutOnce` and `matchNameOnCardAndAddress`. Each profile's email is the account its slot
  checks out with. FAFO 1.9.87 and later write it, with the card's own name and Only
  one checkout; for older versions this worker makes it from the CSV the app sends, with the billing
  name as the name on card.
- `Kim-target-shikari.csv` (since 2026-10-09, at your request): the same slots, in the same order, as a
  Shikari profile CSV, laid out as Shikari writes one: `profile_name, first_name, last_name, email,
  phone_num, cc_number, cc_exp_month, cc_exp_year, cc_cvv, shipping_street, shipping_street_2,
  shipping_city, shipping_state, shipping_zip_code, shipping_country, billing_first_name,
  billing_last_name, billing_street, billing_street_2, billing_city, billing_state, billing_zip_code,
  billing_country`, with the values as Shikari has them: the month without a leading 0 (`9`), a 4-digit
  year, the phone's 10 digits, the card number's digits, state and country codes (`FL`, `US`), and a CRLF
  after every line. The email is the account its slot checks out with, as on the AYCD profile. A file
  Shikari made comes out of this unchanged. It's made here from the CSV every FAFO since 1.9.53 sends
  (the same columns), so it comes from every version. It's for loading into the bot, so its cells aren't
  Excel text (below); a cell that would start with `=`, `+`, `-` or `@` loses those characters instead,
  so nothing a buyer typed runs as a formula if you open it in Excel. (Excel shows a long card number
  rounded, so load the file into Shikari rather than saving it from Excel.)
- `Kim-target-logins.txt`: that store's logins, one `email:password` per line, in the same
  order as the first profiles of the AYCD list and the Shikari CSV. AYCD's profile format has no place
  for them. Pokémon Center gets none (since 2026-10-07, at your request): it checks out with just an
  email, which is on each of its profiles, so a Pokémon Center batch is its AYCD list and Shikari CSV.

The app sends each store's slots as that CSV: this worker reads it to give out accounts and, for apps
before 1.9.87, to make the AYCD list, and posts it as the Shikari CSV. From 2026-10-06 to 2026-10-09 it
wasn't posted; until 2026-10-06 it went out as it came, as `orbit-slots-…-target.csv`.

In a CSV posted for Excel (only FAFO 1.9.52's single file now), the phone, card number, expiry month, CVV and zip code cells are written as `="…"`, for
example `="5555555555554444"`, so Excel shows the full card number and keeps leading zeros. Without
it, Excel turns them into numbers: 5.55556E+15, with the last digit lost if the file is saved. Any
other cell that starts with `=`, `+`, `-` or `@` is written the same way, so nothing a buyer typed
runs as a formula. Excel saves these cells as the plain value. A bot reading the file directly would
see the `="…"`, and FAFO's **Import** (1.9.68+) reads them as the text inside.

> 📦 **6 slots** from **Kim** · @kim · license …ABCD
> Target 3 · Walmart 3
> Per store: its profiles for AYCD (.json) and Shikari (.csv), with its logins (email:password, .txt) in the same order.
> ⏳ **Pending your approval** · Approve or decline

### Approving or declining a batch

Since 2026-10-06 (your requests) each batch's message ends with **Pending your approval** and an
**Approve or decline** link (on the first message, when a batch needs more than one). The link opens a
page with who sent it, how many slots per store and when, and **Approve** and **Decline** buttons.
Approving edits the message to **✅ Approved** with the time. Declining asks once more (**Keep it
waiting** goes back), then edits it to **⛔ Declined**, and any of your accounts given to that batch's
slots go back on your list, except one that the same profile's slot at the other store, in another batch,
still checks out with (since 2026-10-07, both ways since the one list of 2026-10-13): it stays with that
buyer, the page says so ("1 account stays with them…"), and it goes back once you decline the batch that
slot was last sent in (or give it back, or free it by hand). If they send the declined slot again, it gets
that same account back. Until you decide, the sender's FAFO (1.9.91 and later) shows those slots as
**Pending approval**, then **Success**, or from 1.9.92 **Declined** (they can switch a declined slot off
and on, and send it again in a new batch). FAFO asks this worker about every 30 seconds while its Submit
page is open, and every 5 minutes otherwise (`GET /submissions/status`, with the license key, only about
that license's batches). Neither decision can be undone, and a batch you don't decide on stays pending.
Slots sent before this show Submitted as they did. An older FAFO kept no batch id for what it sent, so its
slots showed Submitted too; FAFO 1.9.98 and later find each of those sends' batch (`GET
/submissions/batches`: that license's batches, with when each arrived, its size and the sender's name) and
show it like any other. Each decision is kept 90 days. `/admin/submissions` shows each batch's (`review`, `decided_at`), with its review link.

Slots without a store login come after the ones with logins and have no line in the logins file; one
on a verified email only (Pokémon Center) has that account's email on its AYCD profile. Slots set to
**Use Assigned Account** (Orbit 1.9.57+; 1.9.53 called it "Assign me an account") come last: the
buyer added no login because you provide one, and the store line says so, e.g. "Target 3 (2 need an
account)". An account given out for a slot (see below) goes on its AYCD profile, on both addresses, and in
its Shikari row's `email`.
Discord takes 10 files a message, so a batch with more stores continues in a follow-up message.

To load a store into your own FAFO, **Import** its AYCD file and pick that store under Retailers, then on
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

People still on an older FAFO send an encrypted `.txt` instead, once you've set up a collecting
key. The file is encrypted in their FAFO before it's sent, for a key only your own FAFO has, so
card numbers and passwords are never readable by Discord or by this worker. Without a key, those
versions give people a code to send you themselves.

Turn it on once, from your own FAFO (the one you'll open submissions with):

1. **Settings → Password and sharing**. Under **Collect profiles from others**, choose **Set up
   collecting** if you haven't already.
2. Under **Receive slots in Discord**, choose **Send my key to Discord**.
3. FAFO shows a **key ID** and a longer **fingerprint**. In your channel, a message asks you to
   confirm that key. Open its link and choose **Confirm**, but only if the key ID and fingerprint on
   that page match the ones in your FAFO.

From then on, their batches arrive in your channel with the same message and a `.txt` file attached.
To open one, download the file, then in your FAFO choose **Import** and drop it in.

- **Back up your vault.** Only the FAFO with that key can open the files. If it's lost, files
  already sent can't be opened; set up collecting again and send the new key.
- To switch to a new key, send it the same way and confirm it. FAFO seals new batches for the new
  one; older files still need the old vault. Each person's FAFO remembers the key it last sent
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
list you keep here. Since 2026-10-13 (your request) it's **one list for Target and Pokémon Center both**:
an account goes to one buyer's profile and covers its Target and its Pokémon Center slot, and no other
buyer gets it while they have it.

1. In your own FAFO, open **Settings → Accounts to assign → Send accounts**. FAFO asks for a store:
   Target or Pokémon Center, it doesn't matter, they go on your one list. Paste `email:password` lines,
   or just emails with the password in the box below (for a list that all uses one password), or click
   **Add my Target logins that no profile uses**. The password is the store account's: Target's
   logins file gets it, and Pokémon Center checks out as a guest with the email. An email already on
   the list keeps the password it came with first.
2. Your channel gets a message with the count and a review link. Open it, check the emails, and
   choose **Add to my list**. Only add accounts you sent yourself: anyone with a license can send
   some, but only you can add them. The channel never shows the accounts; the review page shows the
   emails, never the passwords.
3. When a batch with slots on Use Assigned Account reaches your channel, each of those slots gets a
   random free account from your list: its email goes in the slot's row (the `email` column, and on
   both addresses of its AYCD profile) and `email:password` goes in that store's logins file, on the
   line that matches the row (Pokémon Center has no logins file: just the email). The store line says
   how many: "Target 3 (2 assigned accounts)".

- **Buyers never see the accounts.** They go only to your channel. The app is told how many slots
  got one, never which.
- **Each account goes to one buyer only.** One picked for a batch that never reached your channel
  (the post failed) goes back to the list. If part of a batch went out, its accounts stay with it,
  and sending the batch again posts the same ones.
- **A profile's slots at both stores get the same account**: when the same profile (by its name)
  already has an account from your list, given for its slot at the other store in that batch or one sent
  before, its slot here gets that account, so the profile checks out with one email at both stores
  (Pokémon Center's slots used to reuse Target's, from 2026-10-06; now it works both ways). The store
  line says so: "Pokémon Center 3 (3 assigned accounts, 2 reused from Target)", or "Target 1 (1 assigned
  account, 1 reused from Pokémon Center)". It counts once toward the license's limit. It stays with that
  buyer while any of their slots uses it: declining a batch keeps it while their slot at the other store,
  in another batch, still uses it (the decline page says "1 account stays with them…"), and it goes back
  once you decline the last batch that uses it, give it back, or free it by hand. A slot sent again in a
  new batch takes its account along ("1 they had before"), and gets it back if that batch doesn't reach
  your channel. In `/admin/accounts` the account is under store `*`, and each slot that uses it has a row
  of its own at its store, shown with `reused: 1`.
- **Other stores keep lists of their own**: accounts an older FAFO sent for another store go on that
  store's list, for its slots only. Target or Pokémon Center accounts on their own lists from before the
  one list (there were none on yours) still work as they did.
- **Taking accounts off the list** (FAFO 1.9.90+): in your FAFO, **Settings → Accounts to assign →
  Remove accounts**, paste the emails (one per line; `email:password` lines work too, and only the
  email is sent) and choose **Ask to remove**. Your channel gets the count and a review link, never
  the emails; the review page shows where each one is (free, or given to which license and profile)
  and **Remove from my list** takes each off your list (and any store's own list it's on), with every
  slot's use of it. One already given to a
  buyer's slot goes too, so order alerts on it stop reaching them. **Keep them** removes nothing, and
  an ask nobody decided on expires after a week. Anyone with a license can ask, but only you can
  confirm, so only remove ones you asked for. The `/admin/accounts/remove` command below still works.
- **Seeing and editing the list** (FAFO 1.9.102+): in your FAFO, **Settings → Accounts to assign → See
  my list**. Your channel gets a link ("📋 Your list for Use Assigned Account", with who asked), and the
  page shows your list (Target and Pokémon Center) as it is when you open it, and any store's own list:
  how many are free, and each account once, Free or Given to license …XXXX with the profile, and a line
  for each of its slots that uses it, with when it was sent ("Target, sent …", "Pokémon Center, sent …").
  Passwords are never shown. There you can:
  - **Edit** an account: a new password (empty keeps it; the slots that use it get it too), and its email
    while it's free. One given to a buyer keeps its email, as it was posted, and has **Give it back to my
    list**: it's free again for the next slot, the buyer stops getting order alerts for it, and their
    Target and Pokémon Center slots lose it (as `/admin/accounts/free` does).
  - **Reassign** an account given to a buyer (its button on the list, or **Reassign…** on its Edit page),
    when something's wrong with it: their slots get another account in its place, everything the old
    one had (the license, the profile, its slots' rows at Target and Pokémon Center, in the same batches),
    so slots sent again, pulls, declines and order alerts go by the new one. It asks first: **a free
    account from your list, picked at random**, or **this account** (the email of a free one on your list,
    or `email:password` to put a new one on it), and whether the old one **comes off your list** (the
    start: something's wrong with it) or **goes back on it as free**. It's done once, as one change, and
    only while the buyer's slots that use it were sent: while a batch of theirs is being sent, it says to
    try again in a minute. What was posted to your channel keeps the old email, so change it in the bot
    (and Target's login): the page comes back with the new account ticked, so **Copy email:password**
    copies it, and your channel gets a note of what changed ("🔁 Reassigned 1 account", old → new,
    never a password). Order alerts for the new account reach the buyer from then on (an order from
    before the day before it was reassigned was someone else's), and none for the old one.
  - **Remove** an account: it asks first, saying where it is, then takes it off the list (one given to a
    buyer too, so order alerts on it stop reaching them); **Keep it** goes back.
  - **Tick** accounts to work on several at once (Shift+click ticks every one between, the box by a
    list's name ticks all of its accounts, and Tick all ticks the whole list). The bar that shows
    then has **Copy emails** and **Copy email:password** (one per line, in the order shown, onto your
    clipboard; the passwords come from the worker when you click and never go in the page),
    **Reassign**, which asks as it does for one, with a box of accounts (one for each, in the order
    shown) or free ones from your list, and **Remove**, which asks first, naming each one, as Remove
    does for one. One Copy or Remove takes up to 5000, and one Reassign 100; past that, it says how
    many it left out.
  - **Search** (the box above the list): shows only the accounts with every word typed in their email,
    store or status (Free, a buyer's license ending, a profile name; accents don't matter, so "pokemon"
    finds Pokémon Center), and hides a store with none. While searching, Tick all (Tick shown), a
    store's box and Shift+click tick only what's shown; ticks on accounts the search hides stay, and the
    bar counts them. The search stays in that tab after a change or a reload; Escape clears it.
  - **Add accounts**: paste them one per line (`email:password`, or the CSV lines FAFO's Send accounts
    takes, quoted cells too). They go on your list, for Target and Pokémon Center both (with a store's own
    list on the page too, you pick which), at once, with no review link. One already on the list keeps its
    password (Edit changes it), and the page says which lines it couldn't read. Once you have inboxes
    (below), you pick the inbox they go in.
  - **Inboxes** (from 2026-10-23, your request): put each account of your list under the inbox its emails
    go to (the mailbox its alias forwards to; it's a label, nothing signs in to it). Make them in the
    **Inboxes** panel at the top: a name (the inbox's address, say) and who gets its accounts:
    - **For buyers**: buyers' slots get these, as every account did before inboxes.
    - **Only mine**: only slots sent from your own FAFO (the one you allowed to send order alerts) get
      these, and they get them first; once those run out, your FAFO's slots get For buyers ones. Buyers'
      slots never get them, nor does a Reassign of a buyer's account (picked or typed).

    The first inbox you make can take every account that has none ("Put the N accounts that have no inbox
    in it", ticked to start for a For buyers one). An account in no inbox counts as For buyers. The list
    then shows a section per inbox ("For buyers" or "Only mine", "N free of M", a box that ticks its
    accounts), then **No inbox**; the search looks in the inbox's name too. Tick accounts and use **Move to
    inbox…** in the bar (or an account's Edit page) to move them: who has an account doesn't change, so one
    a buyer has stays theirs until it's given back. **Add accounts** and an offer's review link ask which
    inbox they go in (an account already on the list stays in its inbox, or goes in this one if it has
    none); an account goes on the list and in its inbox in one step, so a buyer's batch can never take one
    meant for an Only mine inbox in between. A new account typed in a Reassign goes in the inbox of the one
    it replaces, or in none when that's an Only mine inbox and the slot is a buyer's (so buyers can get
    it). Changing an account's email keeps it in its inbox. Each inbox's **Edit…** opens its page:
    rename it, make it Only mine or For buyers (the page says first what that does: how many free accounts
    buyers gain or lose, and that buyers keep the ones they have), and delete it once no account is in it.
    With Only mine inboxes, the list says how many of its free accounts buyers can get ("15 free (10 for
    buyers)"), as the low and out-of-accounts alerts count them, and a buyer's store line says "(1 needs an
    account: your list has none for buyers, only in your Only mine inboxes)" when that's why. Other
    stores' own lists have no inboxes (a free row on Target's or Pokémon Center's own list from before
    whose email is in an Only mine inbox doesn't go to a buyer either).
  - **Accounts that don't work** (from 2026-10-23, your request): set them aside on **Account disabled**
    or **Need to generate**, off your list, so no slot gets them. Reassign asks what happens to the old
    account: one of those two lists, back on your list as free, or off your list for good. A free account
    goes on one from its Edit page (Doesn't work?) or the bar's **Not working…** for the ticked, which
    also moves them between the two lists, or puts them **Back on my list**, free, in the inbox each was
    in. Each list is a section at the end of the page, with whose it was and when; Copy email:password
    copies them (to generate them again, say), and adding an email set aside again (Add, an offer) puts it
    back on your list with the password you typed. Remove takes one off for good.

  The link works for 24 hours, and a license can ask 10 times a day. Anyone with a license can ask, but
  the link only goes to your channel, so only someone who can read your channel can change the list.
- **A slot sent again gets back the account it had** (FAFO 1.9.99+, from 2026-10-07): when a buyer
  switches a slot off and sends it again, or sends it again after you declined it, its profile gets the
  account it went out with before, while that's still theirs, instead of a new one. The store line says
  so: "Target 9 (9 assigned accounts, 7 they had before)". If the new batch doesn't reach your channel,
  the account goes back to the batch it came from, and declining the batch it came from leaves it with
  the new one. For a store's own list, FAFO says which of its slots are still out, so a profile whose
  slot is still out (or another with the same name) never gets that account, and older FAFOs, which
  don't say, get new accounts as before. An account from your list stays with its buyer's profile
  whichever FAFO sent it.
- **Each license can be given as many accounts in all as its slot limit** (from 2026-10-12): 20
  (`DEFAULT_SLOT_LIMIT`), or the number you approved when it asked for more slots, so a buyer you
  approved 50 slots can be given 50 accounts. Before, it was a fixed `ASSIGNED_LIMIT` for everyone (20
  from 2026-10-07, 10 before that), which still sets the default if you put it back in `[vars]`. An
  account given back (above) isn't a new one. Slots past
  that, or past the end of the list, come last with no login line, and the store line says how many
  and why, so you can assign those by hand: "(1 needs an account: this license is at its limit of 20)"
  or "(1 needs an account: your list has none)". With no login for any of a store's slots, there's no
  logins file for that store.
- **When the list runs low**, your channel is told: once when it's down to `ACCOUNTS_LOW_AT` free
  accounts (15), "⚠️ Only 15 accounts left…", and once more when it runs out, "🚫 No accounts left…" (a
  store's own list is named: "No Kohl's accounts left…"). Sending more and adding them, or freeing some,
  sets these up again. Change the number in `[vars]` in `wrangler.toml`.
- **Pulling** such a slot names the account it had: "Target · Kim Lee · acct7@example.com (assigned
  account)". The account stays with that buyer (it isn't put back on your list), so the slot gets it
  again if it's sent again; free it by hand to give it to someone else.
- The list, the waiting offers, asks to remove, See my list links, those alerts and the inboxes are in the
  `accounts`, `account_offers`, `account_removals`, `account_lists`, `account_stock`, `account_inboxes` and
  `account_inbox_of` tables, which `npm run db:init` (and the deploy Action) adds. With `ADMIN_TOKEN` set:

```
# The list: how many are free (your list is store "*"), its inboxes, who got which, and each offer with its review link
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/accounts

# Give an account back to the list, with every slot's use of it. With "store":"target" only that
# slot's goes, and the account goes back once none of its slots uses it.
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"email\":\"someone@outlook.com\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/free

# Give back every account one license has (lets them get more)
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"key\":\"PVLT-XXXX-XXXX-XXXX-XXXX\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/free

# Take an account off the list
curl.exe -X POST -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -d "{\"email\":\"someone@outlook.com\"}" https://orbit-license.orbit-app.workers.dev/admin/accounts/remove
```

The passwords are kept in your D1 database so they can go in the logins files, and they're in your
channel with each batch (Target's; Pokémon Center's aren't posted), like every other login there. Keep
the channel private.

## Order alerts for buyers

From Orbit 1.9.69, when you place an order for a buyer's slot on one of your accounts, the buyer can
hear about it in their FAFO without ever seeing the account:

1. Make sure the account's emails reach an inbox your own FAFO syncs (**Settings → Email import**).
   With iCloud Hide My Email or a catch-all domain, that's the one inbox they all land in.
2. In your FAFO, open **Settings → Order alerts for buyers → Turn on**. Your channel gets a review
   link: open it and choose **Allow**. Only that license sends alerts, and allowing another one
   replaces it.
3. After each email sync, your FAFO sends this worker the orders it found on accounts that were given
   out, with the account each went to: the store, the order number, the item, the quantity, the total
   and the step (placed, shipped, out for delivery, delivered, canceled). This worker finds who has
   that account and keeps the alert for them. Their FAFO adds it to **Orders** as "From your seller",
   with a notification. Each step of an order goes out once.

- **Buyers never get the account's email or password.** An order placed on an account more than a day
  before it was given out isn't sent, since it was someone else's.
- **A buyer can add their own Discord webhook** in **Settings → Alerts** to get the alerts there too.
  It's checked with a test post when they save it.
- **Alerts are kept 60 days.** They're in the `alert_senders`, `alerts` and `alert_webhooks` tables,
  which `npm run db:init` (and the deploy Action) adds.

```
# Who asked to send alerts and your decisions, and how many alerts each buyer got
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/alerts
```

## Premium buyers

From FAFO 1.9.127, **Generate** (making profiles in bulk, Jig and Mass edit on drafts) is only for the buyers you
make premium. The others don't see it: no Generate in the sidebar or the phone's tabs. Drafts they made before are
kept and come back if you make them premium.

1. In your FAFO, open **Settings → Premium buyers → Choose who's premium**. Your channel gets a link that works for
   24 hours (10 a day). Only the FAFO that sends order alerts (`owner`) shows Premium buyers in Settings.
2. The page lists every buyer with a license, by Discord name and the name they last sent slots under, each with
   **Make premium** or **Remove premium** (a buyer who isn't premium reads Standard), and a search box (type `premium`
   or `standard` to see only those). A key you made by hand
   is added by pasting it under **A key made by hand**.
3. A buyer's FAFO asks `GET /premium` (their license as `Authorization: Bearer`; it answers `{premium, owner}`) when it
   opens and every 10 minutes, so a change reaches them within that.

- **Your own FAFO is always premium while it sends order alerts** (the license you allowed under Order alerts for
  buyers). If another license sends them, make yours premium on the page.
- **It hides Generate in the app; it isn't a lock.** Someone who edits the page in their browser could show it
  again, since everything Generate does happens on their own computer.
- **A key you turn off isn't premium while it's off.** If it was, the page shows it as "License turned off" (not counted)
  until you remove premium; turned back on before that, it's premium again. A key made by hand that has expired shows as "Key
  expired", and one taken off the list as "Not on the list of keys any more".
- If this worker can't read the list of keys made by hand on GitHub just then, a buyer with such a key keeps what FAFO
  last heard (the answer is 503, not "not a license").
- Who's premium is in the `premium` table, and the links in `premium_lists`, which `npm run db:init` (and the deploy
  Action) adds.

```
# Who's premium, and which license sends order alerts
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/premium
```

## Payments (Stripe)

From FAFO 1.9.130 your buyers can pay you for checkouts through Stripe (the owner's decisions, 2026-10-18): **$10 per
checkout**, or a **monthly plan, $25 for 10 slots switched on at once** with nothing per checkout, plus **15 more slots
for another $25** (25 slots, $50 a month). It stays off until you add the two Stripe secrets below; until then nothing
changes anywhere.

- **Who pays.** Anyone who isn't Friends and Family and isn't on a paid monthly plan pays $10 for each checkout on the
  slots they sent: an order on an account you gave them (from your FAFO's order alerts), an order on their own account
  while it was out as one of their slots (their FAFO finds it in their email and reports it; this worker checks the
  account was out then), or one you add on the Billing page. One order is one checkout, whatever the quantity. Each is
  due 3 days after the order, and free if the store cancels it before it's paid. Orders from before payments came on
  are never billed, and neither are checkouts on a declined batch's slots (add one by hand if you ran it), nor ones
  after a slot was pulled (once your channel was told of the pull).
- **The monthly plan** covers a month once Stripe says its invoice is paid (and stops covering when it ends, if you
  cancel it at once in Stripe). Checkouts while a renewal is being charged, or retried after it failed, wait: free if
  it's paid, $10 each if the plan ends unpaid.
- **Who can submit.** A buyer has to pick a plan in FAFO's **Invoice** page first. Submit stays off for them while a
  checkout is overdue, their monthly payment has failed, or a payment is disputed with their bank, and a monthly buyer
  can't have more slots on than their plan has (10 or 25; they add the extra 15 in Invoice instead of asking you). A
  batch refused this way is never posted, and your channel hears about it (at most every 6 hours per buyer). FAFOs older
  than 1.9.130 can't say why; the channel's message says so.
- **Friends and Family** are never charged, Submit is never off for them, and their slot limits stay as you approved
  them. Everyone you approved before payments came on is Friends and Family (the first request that sees the Stripe
  keys notes when that was), and so is every key you made by hand. The Billing page moves anyone either way: **Charge**
  makes a buyer pay like one approved after payments began, for checkouts from then on (never for ones from while they
  were Friends and Family). If you make a buyer with a monthly plan Friends and Family, Stripe stops charging it (its
  collection is paused) until you charge them again.
- **Your own FAFO** (the license that sends order alerts) is never charged, and is the only one that can open the
  Billing page.

### Turning it on

1. **A Stripe account.** Sign up at https://stripe.com and finish activating it (your business details and the bank
   account payouts go to). Stripe decides which businesses it takes; check yours is allowed before you charge anyone.
   Under **Settings → Payments → Payment methods**, cards and Link are what FAFO uses.
2. **A restricted key** (Developers → API keys → **Create restricted key**), with only what the worker needs:
   - Checkout Sessions: **Write** (opens the payment page, and closes one that's no longer right)
   - Customers: **Write** (one Stripe customer per buyer)
   - Subscriptions: **Write** (the monthly plan: end it, add or remove the extra slots, pause it for Friends and Family)
   - Products and Prices: **Write** (the worker makes "FAFO monthly plan (10 slots)" and "FAFO extra 15 slots" the first
     time a buyer subscribes)
   - Invoices: **Read** (the page to pay a failed monthly payment)
   - Refunds: **Write** (when a buyer paid for a checkout the store canceled meanwhile, that $10 goes back by itself)
   - PaymentIntents: **Read** (to tell whose payment a bank dispute is about)

   A live key (its name has `_live_` in it) puts payments in **live mode**; a sandbox's test key, in **test mode**.
3. **A webhook** (Developers → Webhooks → **Add destination**): your account's events, **snapshot** payloads, API
   version **2026-09-30.endive** (it can't be changed later; make a new destination instead), sent to

   ```
   https://license.fafoaco.com/stripe/webhook
   ```

   with exactly these events:

   ```
   checkout.session.completed            checkout.session.async_payment_succeeded
   checkout.session.expired              checkout.session.async_payment_failed
   customer.subscription.created         customer.subscription.updated
   customer.subscription.deleted         customer.subscription.paused
   customer.subscription.resumed         invoice.paid
   invoice.payment_failed                charge.dispute.created
   charge.dispute.closed                 charge.refunded
   ```

   Then copy its **Signing secret**. Test mode (a sandbox) has its own webhooks and its own signing secret.
   The webhook only makes things quicker: the worker asks Stripe again whenever a buyer's FAFO checks, so a missed one
   changes nothing.
4. **Add the two secrets** to the worker: in the Cloudflare dashboard, **Workers & Pages → orbit-license → Settings →
   Variables and Secrets → Add**, type **Secret**, once for each; or here:

   ```
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   Never put them in `wrangler.toml` or anywhere in this repo: it's public. Payments are on as soon as both are there.
5. **Try test mode first.** Use the sandbox's restricted key and its webhook's secret. In test mode only licenses you
   mark **Tester** see plans and pay, for checkouts from when you marked them (everyone else carries on as if payments
   were off), and nothing counts in live mode later. Take a second license of your own (yours is never charged), open the Billing page (step below), open that
   buyer's **Details** and choose **Tester**. In that FAFO, pick a plan in Invoice and pay with Stripe's test card
   **4242 4242 4242 4242** (any future date, any CVC and ZIP). When it all works, swap both secrets for the live ones.

### The Billing page

In your FAFO, **Settings → Billing → See billing**. Your channel gets a link that works for 24 hours (10 a day). It shows
what's owed and overdue, what was paid in the last 30 days, whether your FAFO's order alerts are coming in (if they
stop, checkouts on accounts you give out aren't billed: keep Order alerts for buyers on in your desktop FAFO), and every
buyer with their plan and status. A buyer's **Details** has:

- **Friends and Family** or **Charge**, **Tester** (in test mode), and **Clear dispute hold** after a bank dispute.
- Their invoice, with **Waive**, **Undo waive**, **Mark paid** (paid some other way), **Charge again** (one canceled
  because the store canceled it, if you think it wasn't; not one their monthly plan covered), and **Waive** or **Keep**
  for a checkout they said wasn't yours ("Not my seller's checkout?" in their Invoice; your channel gets a link to
  answer it).
- **Add a checkout**, and their recent batches to match your bot's log against.

**Paste checkouts** takes your bot's success log, one checkout per line: each line needs the account's email and the
order number (a store's name and a date are read too, else the ones you pick). You see who each one goes to first (the
buyer who had that email out as a slot that day, or a list to pick from when two did) and whether it would be billed;
**Add** writes them. Pasted emails are only matched, never kept. If the store cancels one you added on a buyer's own
account, their FAFO says so and it's free, as for the checkouts it reports itself (you can charge it again).

- **Refunds** are made in your Stripe Dashboard; your channel hears about them. The prices are FAFO's own (the
  `PRICE_*` numbers in `src/index.js`, also shown in the app), so changing one is a change here, not in Stripe. A new
  checkout price applies to checkouts from then on: each one owed is paid at what it cost when it was added.
- **Removing either secret turns payments off here, but Stripe keeps charging monthly plans.** Cancel those in Stripe
  first if you're stopping for good. Checkouts from while they were gone aren't billed once you add them back.
- Payments are in the `billing_*` tables, which `npm run db:init` (and the deploy Action) adds.

```
# Payments: on or off, the mode, since when, plans, what's owed, Stripe's price ids, the last order alerts from your FAFO
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://orbit-license.orbit-app.workers.dev/admin/billing
```

## The web version's synced vaults

From Orbit 1.9.65, a desktop app can keep an encrypted copy of its vault here (Settings → Web
version & sync), so the web version at https://app.fafoaco.com (`web-worker/`; also app.orbit-app.workers.dev) and other
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

## A copy of the update files, for networks that block GitHub

Some networks block `raw.githubusercontent.com`, where FAFO gets its updates and the list of
license keys you made by hand: security filters in routers, internet providers' apps and antivirus
often do, since anyone can host files there. So this worker hands out a copy, fetched from GitHub
here, where it isn't blocked:

```
https://orbit-license.orbit-app.workers.dev/mirror/update.json
https://orbit-license.orbit-app.workers.dev/mirror/index-1.9.83.html   (any released page)
https://orbit-license.orbit-app.workers.dev/mirror/licenses.json
```

From FAFO 1.9.83 the app uses it by itself when GitHub's address can't be reached. Anyone still on
an older version who's blocked can paste the first address into Settings → Updates → Update address
once to get 1.9.83. Nothing to set up. Only these files, from this repo's main branch, are ever
fetched, and everything in them is signed (updates with your update key, `licenses.json` with your
license key), so the copy can't change anything. Pages are kept for a day, the other two for a
minute.

## Product pictures for orders

From FAFO 1.9.113, an order whose email had no product photo (Target's pre-orders show a gray bag,
Pokémon Center's emails have none) gets its product's picture by itself. FAFO sends the item's name
to `GET /pictures/find?q=…` with its license key, and this worker looks it up among the sealed
Pokémon TCG products in TCGplayer's catalog, as [tcgcsv.com](https://tcgcsv.com) publishes it each
day: the Pokémon category's groups (one per set or kind of product) and each group's products. It
answers only a product whose name has the same words as the order's, written the same way
("Elite Trainer Box" is ETB, Pokémon Center's own edition isn't the store's, a Booster Display is
the Booster Box, a series' name like Mega Evolution is one word), with its picture from TCGplayer's
image servers. A name with a word the product's lacks, or the other way round, another series'
product, or two products that fit, gets nothing: no picture is better than another product's. FAFO
keeps a small copy and puts it on every order of the item.

Nothing to set up. The catalog's lists are read here about once a day each and kept in the
`picture_lists` table (one that can't be read is tried again an hour later, and its last copy is
used meanwhile); what a name found is kept a week (nothing found, 6 hours) in `picture_finds`, so a
name is looked up once for everyone. Rows go after 30 days. Each license can make 300 lookups a day
that aren't answered from what's kept (`picture_asks` counts them per day, for two days); that's
all that's kept about who asked. `npm run db:init` (and the deploy Action) adds the tables.
`PICTURES_CATALOG`, `PICTURES_IMAGES`, `PICTURES_LIST_MS` and `PICTURES_ASKS_PER_DAY` point the
tests at a stand-in catalog and shorten its times.

To see what a name finds, and why:

```
curl.exe -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "https://orbit-license.orbit-app.workers.dev/admin/pictures?q=Delta%20Reign%20Elite%20Trainer%20Box"
```

It shows the name's words, the groups searched, every product that fit and the answer.

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
and changed, slot limits, submissions and collecting keys, pulled slots, product pictures
(against a stand-in catalog: exact names only, never a case, another edition or two that fit),
synced vaults (revisions, two devices saving at once, large vaults, a new password, and the lock
after wrong passwords), and payments against a stand-in Stripe (plans, invoices, Submit refused and allowed, sessions,
signed webhooks, refunds, the monthly plan's states, disputes, the Billing page, test mode, and that the tables a
database from the last release gets are the same as a new one's).
