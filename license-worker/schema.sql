-- One license per Discord account.
CREATE TABLE IF NOT EXISTS licenses (
  discord_id  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  license_key TEXT NOT NULL UNIQUE,
  key_hash    TEXT NOT NULL UNIQUE,
  issued_at   INTEGER NOT NULL,
  revoked_at  INTEGER
);

-- A "Continue with Discord" click in the app, from sign-in until the app picks up its key.
CREATE TABLE IF NOT EXISTS requests (
  r          TEXT PRIMARY KEY,
  state      TEXT NOT NULL UNIQUE,
  ip         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  discord_id TEXT,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS requests_ip ON requests (ip, created_at);
CREATE INDEX IF NOT EXISTS requests_created ON requests (created_at);

-- The signed key list the app downloads. `version` goes up on every change to
-- `licenses`; the list is re-signed lazily when `built_version` falls behind.
CREATE TABLE IF NOT EXISTS list_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       INTEGER NOT NULL,
  built_version INTEGER NOT NULL,
  issued_ms     INTEGER NOT NULL DEFAULT 0,
  body          TEXT,
  sig           TEXT
);
INSERT OR IGNORE INTO list_state (id, version, built_version) VALUES (1, 1, 0);

-- With REQUIRE_APPROVAL on: one key request per Discord account, and the owner's decision.
CREATE TABLE IF NOT EXISTS applications (
  discord_id         TEXT PRIMARY KEY,
  username           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied
  review_token       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER,
  webhook_message_id TEXT
);

-- How many slots a license can have switched on at once (DEFAULT_SLOT_LIMIT if no row).
CREATE TABLE IF NOT EXISTS slot_limits (
  key_hash   TEXT PRIMARY KEY,
  slot_limit INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Requests for more slots, and the owner's decision.
CREATE TABLE IF NOT EXISTS slot_requests (
  id                 TEXT PRIMARY KEY,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  discord_id         TEXT,
  username           TEXT,
  current_limit      INTEGER NOT NULL,
  requested          INTEGER NOT NULL,
  granted            INTEGER,
  note               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied
  review_token       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS slot_requests_key ON slot_requests (key_hash, created_at);

-- Collecting keys submissions are encrypted to (from the owner's Orbit, Settings → Collecting).
-- A key offered by the app waits until the owner confirms it from their Discord channel; one is
-- active at a time.
CREATE TABLE IF NOT EXISTS submit_keys (
  id                 TEXT PRIMARY KEY,
  pub                TEXT NOT NULL,
  key_id             TEXT NOT NULL,
  key_hash           TEXT NOT NULL,                     -- license that offered it
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | active | denied | replaced
  review_token       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS submit_keys_pub ON submit_keys (pub, created_at);

-- Submissions posted to the channel. The encrypted code itself isn't kept.
CREATE TABLE IF NOT EXISTS submissions (
  id                 TEXT PRIMARY KEY,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  slots              INTEGER NOT NULL,
  bytes              INTEGER NOT NULL,
  key_id             TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS submissions_key ON submissions (key_hash, created_at);

-- The owner's approval of each batch posted to the channel (the owner's request, 2026-10-06): its message carries an
-- Approve link, and app 1.9.91+ shows the buyer Pending approval until the owner approves it, then Success.
-- One row per batch (its id is the submission's), kept 90 days. Its own table, since db:init can't add columns.
CREATE TABLE IF NOT EXISTS submission_reviews (
  id                 TEXT PRIMARY KEY,                  -- the batch id (submissions.id)
  key_hash           TEXT NOT NULL,                     -- license that sent it
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | approved
  review_token       TEXT NOT NULL,
  content            TEXT NOT NULL DEFAULT '',          -- its message, without the approval line, until approved
  stores             TEXT NOT NULL DEFAULT '',          -- its store line, for the review page
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER
);
CREATE INDEX IF NOT EXISTS submission_reviews_key ON submission_reviews (key_hash, created_at);

-- Slots pulled after being submitted, posted to the channel so the owner can take them off their list.
CREATE TABLE IF NOT EXISTS pulls (
  id                 TEXT PRIMARY KEY,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  slots              INTEGER NOT NULL,
  key_id             TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS pulls_key ON pulls (key_hash, created_at);

-- Store accounts the owner provides for slots set to "Use Assigned Account" (app 1.9.58+). The owner
-- sends them from Orbit (Settings → Accounts to assign) and adds them from the review link posted to
-- their channel. When a buyer's batch reaches the channel, each of those slots gets a random free one:
-- its email goes in the slot's row and email:password in that store's logins file. Buyers never see
-- them. An account goes to one slot only; one picked for a batch that never reached the channel is
-- freed again. `store` is the app's store key ("target", "other:topps").
CREATE TABLE IF NOT EXISTS accounts (
  store       TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_norm  TEXT NOT NULL,
  password    TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  offer_id    TEXT,
  key_hash    TEXT,                          -- license it went to; NULL while free
  key_last4   TEXT,
  batch       TEXT,                          -- submission it went out in
  store_name  TEXT,
  profile     TEXT,                          -- profile_name of that slot
  assigned_at INTEGER,
  sent_at     INTEGER,                       -- when that batch reached the channel; NULL until then
  PRIMARY KEY (store, email_norm)
);
CREATE INDEX IF NOT EXISTS accounts_free ON accounts (store, key_hash);
CREATE INDEX IF NOT EXISTS accounts_key ON accounts (key_hash, batch);

-- Accounts sent from Orbit, waiting for the owner to add or refuse them. The list (with passwords)
-- is cleared once decided.
CREATE TABLE IF NOT EXISTS account_offers (
  id                 TEXT PRIMARY KEY,
  store              TEXT NOT NULL,
  store_name         TEXT NOT NULL,
  accounts           TEXT NOT NULL,                     -- JSON [{email, password}]
  count              INTEGER NOT NULL,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | added | refused | expired
  added              INTEGER,
  review_token       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS account_offers_key ON account_offers (key_hash, created_at);

-- Asks from FAFO (1.9.90+) to take accounts off the list, from every store's; done once the owner confirms
-- from the review link posted to the channel.
CREATE TABLE IF NOT EXISTS account_removals (
  id                 TEXT PRIMARY KEY,
  emails             TEXT NOT NULL,                     -- JSON [email], emptied once decided or expired
  count              INTEGER NOT NULL,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | removed | kept | expired
  removed            INTEGER,
  review_token       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER,
  webhook_message_id TEXT
);
CREATE INDEX IF NOT EXISTS account_removals_key ON account_removals (key_hash, created_at);

-- Whether the owner's channel was told a store's list is low (ACCOUNTS_LOW_AT free accounts or fewer)
-- or has run out. Adding or freeing accounts clears these again.
CREATE TABLE IF NOT EXISTS account_stock (
  store    TEXT PRIMARY KEY,
  low_at   INTEGER,
  empty_at INTEGER
);

-- Web version and sync (app 1.9.65+): one vault per license, exactly as the app sealed it (AES-GCM,
-- with a key from the vault's password, which never leaves the devices), so nothing here can read it.
-- auth_hash is the SHA-256 of the access token the app derives from that same password: reading or
-- replacing the vault takes the license key and that token. rev goes up by one on every save; a save
-- names the revision it started from, so two devices can't overwrite each other (the app merges and
-- tries again). After 10 wrong tokens in a row the vault refuses tokens for 15 minutes.
CREATE TABLE IF NOT EXISTS vaults (
  key_hash   TEXT PRIMARY KEY,
  rev        INTEGER NOT NULL,
  auth_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  iter       INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  chunks     INTEGER NOT NULL,
  device     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  fails      INTEGER NOT NULL DEFAULT 0,
  fail_at    INTEGER NOT NULL DEFAULT 0,
  -- the token hash of the password before the last change: a device still on it is told the password
  -- changed, without it counting as a wrong guess
  prev_auth_hash TEXT NOT NULL DEFAULT ''
);

-- A vault's text, split up because D1 rows top out at 2 MB. The current revision and the one before
-- it are kept.
CREATE TABLE IF NOT EXISTS vault_chunks (
  key_hash TEXT NOT NULL,
  rev      INTEGER NOT NULL,
  idx      INTEGER NOT NULL,
  data     TEXT NOT NULL,
  PRIMARY KEY (key_hash, rev, idx)
);

-- Order alerts (app 1.9.69+): buyers hear about orders placed on the accounts they were given. The
-- owner's Orbit, which reads those accounts' order emails, sends them once the owner allows that
-- license from the review link posted to their channel. One license sends at a time.
CREATE TABLE IF NOT EXISTS alert_senders (
  id                 TEXT PRIMARY KEY,
  key_hash           TEXT NOT NULL,
  key_last4          TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  username           TEXT,
  review_token       TEXT NOT NULL,
  webhook_message_id TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | allowed | refused | replaced | expired
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER
);
CREATE INDEX IF NOT EXISTS alert_senders_key ON alert_senders (key_hash, created_at);

-- One row per step of an order (placed, shipped, …) for the buyer whose account it was placed on:
-- the store, that slot's profile name and the order's details, never the account. `oid` is the
-- same for every step of one order. Kept 60 days.
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  key_hash   TEXT NOT NULL,                     -- the buyer's license
  oid        TEXT NOT NULL,
  store      TEXT NOT NULL,                     -- the app's store key ("target", "other:topps")
  store_name TEXT NOT NULL,
  profile    TEXT NOT NULL DEFAULT '',
  order_no   TEXT NOT NULL,
  item       TEXT NOT NULL DEFAULT '',
  qty        TEXT NOT NULL DEFAULT '1',
  total      TEXT NOT NULL DEFAULT '',
  stage      TEXT NOT NULL,                     -- placed | shipped | arriving | delivered | canceled
  at         TEXT NOT NULL DEFAULT '',          -- the order's date, YYYY-MM-DD
  created_at INTEGER NOT NULL,
  UNIQUE (key_hash, store, order_no, stage)
);
CREATE INDEX IF NOT EXISTS alerts_key ON alerts (key_hash, created_at);

-- A buyer's own Discord webhook, which gets their order alerts too (optional).
CREATE TABLE IF NOT EXISTS alert_webhooks (
  key_hash   TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  set_at     INTEGER NOT NULL,
  last_ok    INTEGER,
  last_error TEXT
);
