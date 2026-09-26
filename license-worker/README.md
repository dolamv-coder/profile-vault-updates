# Orbit license worker

Gives new users a license key automatically. In Orbit (1.9.41 and later), a new user
clicks **Continue with Discord**, signs in with Discord in their browser, and Orbit
activates by itself a few seconds later. You don't have to do anything.

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
     Integrations > Webhooks). The worker posts there each time someone gets a new
     key. The key itself is never posted.

5. **Add the redirect in Discord.** On the application's **OAuth2** page, under
   **Redirects**, add this and save:

   ```
   https://orbit-license.orbit-app.workers.dev/discord/callback
   ```

6. **Check it.** Open https://orbit-license.orbit-app.workers.dev/discord/ready in a
   browser. It should say `{"ready":true}`. Until it does, Orbit hides the Discord
   button, so nothing breaks while you set up.

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
then goes through sign-in, key pickup, repeat sign-in, cancelled and refused sign-ins,
the account-age and server checks, revoke and restore, and the rate limit.
