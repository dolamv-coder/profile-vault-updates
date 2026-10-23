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

-- The owner's approval of each batch posted to the channel (the owner's request, 2026-10-06): its message carries a
-- link to approve or decline it, and app 1.9.91+ shows the buyer Pending approval until the owner decides, then Success
-- (1.9.92+ also Declined).
-- One row per batch (its id is the submission's), kept 90 days. Its own table, since db:init can't add columns.
CREATE TABLE IF NOT EXISTS submission_reviews (
  id                 TEXT PRIMARY KEY,                  -- the batch id (submissions.id)
  key_hash           TEXT NOT NULL,                     -- license that sent it
  status             TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | declined
  review_token       TEXT NOT NULL,
  content            TEXT NOT NULL DEFAULT '',          -- its message, without the approval line, until decided
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
-- Lookups by email alone (every store's rows of an account: See my list, Reassign, the list's pickers).
CREATE INDEX IF NOT EXISTS accounts_email ON accounts (email_norm);

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

-- See my list (app 1.9.102+): links to the list posted to the owner's channel, each working for 24 hours; rows go
-- after 7 days.
CREATE TABLE IF NOT EXISTS account_lists (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL,                     -- the license that asked
  key_last4   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  username    TEXT,
  view_token  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_lists_key ON account_lists (key_hash, created_at);

-- Whether the owner's channel was told a store's list is low (ACCOUNTS_LOW_AT free accounts or fewer)
-- or has run out. Adding or freeing accounts clears these again.
CREATE TABLE IF NOT EXISTS account_stock (
  store    TEXT PRIMARY KEY,
  low_at   INTEGER,
  empty_at INTEGER
);

-- Inboxes on the one list (2026-10-23, the owner's request): a label for the mailbox an account's email goes to (the
-- owner's accounts are aliases that forward to one of their mailboxes; nothing signs in to it). An inbox is For buyers
-- (mine = 0: buyers' slots get its accounts) or Only mine (mine = 1: only slots sent from the owner's own FAFO, the one
-- allowed to send order alerts, get them, before any For buyers one). `name` is what the owner typed (the mailbox's
-- address, say); name_norm keeps two from having the same name. Their own tables, since db:init can't add columns.
CREATE TABLE IF NOT EXISTS account_inboxes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_norm  TEXT NOT NULL UNIQUE,
  mine       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- Which inbox an account of the one list (store '*') is in, by its email (all of an account's rows share it). An account
-- with no row here (or whose inbox is gone) is in No inbox, which buyers' slots get as they did before inboxes.
CREATE TABLE IF NOT EXISTS account_inbox_of (
  email_norm TEXT PRIMARY KEY,
  inbox_id   TEXT NOT NULL,
  set_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_inbox_of_inbox ON account_inbox_of (inbox_id);
-- Accounts of the one list that don't work, set aside (2026-10-23, the owner's request: "For accounts that doesn't work,
-- make 2 lists. One for Account disabled and another list for need to generate"): off the list, so no slot gets them,
-- with their password, the inbox they were in (Back on my list puts them in it again) and whose they were when a Reassign
-- set them aside. list is 'disabled' or 'generate'. An email is here or on the list, never both.
CREATE TABLE IF NOT EXISTS accounts_aside (
  email_norm   TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  password     TEXT NOT NULL,
  list         TEXT NOT NULL,
  inbox_id     TEXT,
  from_last4   TEXT,
  from_profile TEXT,
  set_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_aside_list ON accounts_aside (list, set_at);

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

-- Product pictures (app 1.9.113): the lists the worker read from TCGplayer's catalog (tcgcsv.com), each kept a day
-- ("groups", and "g:<groupId>" for a group's sealed products; one that couldn't be read is tried again after an hour),
-- and what each order name found (its words, sorted): the product and its picture for a week, nothing for 6 hours.
-- Rows go after 30 days.
CREATE TABLE IF NOT EXISTS picture_lists (
  id    TEXT PRIMARY KEY,
  body  TEXT NOT NULL,                          -- JSON
  until INTEGER NOT NULL,                       -- read again after this
  at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS picture_finds (
  q          TEXT PRIMARY KEY,
  product_id INTEGER,                           -- null: nothing found
  name       TEXT,
  image      TEXT,                              -- the picture as a data: address
  until      INTEGER NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS picture_lists_at ON picture_lists (at);
CREATE INDEX IF NOT EXISTS picture_finds_at ON picture_finds (at);
-- How many picture lookups not answered from what's kept a license made each day (UTC), for the daily limit. Kept two
-- days.
CREATE TABLE IF NOT EXISTS picture_asks (
  key_hash TEXT NOT NULL,
  day      TEXT NOT NULL,                       -- YYYY-MM-DD
  n        INTEGER NOT NULL,
  PRIMARY KEY (key_hash, day)
);

-- Premium buyers (2026-10-17, the owner's request: Generate only for premium buyers). A license is premium while it has
-- a row here, or while it's the FAFO allowed to send order alerts (the owner's own). Pages from 1.9.127 ask GET /premium.
CREATE TABLE IF NOT EXISTS premium (
  key_hash   TEXT PRIMARY KEY,
  key_last4  TEXT NOT NULL,
  granted_at INTEGER NOT NULL
);

-- Links to the Premium buyers page, posted to the owner's channel when their FAFO asks (24 hours, like account_lists).
CREATE TABLE IF NOT EXISTS premium_lists (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL,                     -- the license that asked
  key_last4   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  username    TEXT,
  view_token  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS premium_lists_key ON premium_lists (key_hash, created_at);

-- Payments (2026-10-18, the owner's request: "$10 per checkout or $25 a month plan or 10 slots", paid with Stripe). Off until
-- both Stripe secrets are set. Every column is here from the start, since db:init can't add columns later. Times are epoch
-- ms; amounts are cents (usd); `mode` is "live" or "test" (the Stripe key's), and a mode's reads never see the other's rows.
-- Per buyer, whatever the mode: Friends and Family (1 never charged, 0 charged; NULL: Friends and Family if approved before
-- billing came on), a Tester (test mode reaches only them), since when they're charged after being Friends and Family
-- (charge_from: the owner's Charge, or a Tester marked in test mode; orders dated before it aren't billed), when their FAFO
-- last asked GET /billing, when a refused batch was last told to the channel, how many slots they last said were switched
-- on, and when the channel was last told they hit the day's limit of reported checkouts.
CREATE TABLE IF NOT EXISTS billing_people (
  key_hash    TEXT PRIMARY KEY,
  family      INTEGER,
  tester      INTEGER NOT NULL DEFAULT 0,
  charge_from INTEGER,
  seen_at     INTEGER,
  refused_at  INTEGER,
  last_on     INTEGER,
  last_on_at  INTEGER,
  note_at     INTEGER,
  updated_at  INTEGER NOT NULL
);

-- Plan and Stripe state per buyer per mode. plan: NULL (none picked) | checkout | monthly; next_plan: what a monthly plan set
-- to end turns into (checkout, or NULL for none); sub_id: the current (or last) monthly subscription; dispute_hold: a card
-- payment disputed with the bank, which turns Submit off until the owner clears it.
CREATE TABLE IF NOT EXISTS billing (
  key_hash     TEXT NOT NULL,
  mode         TEXT NOT NULL,
  plan         TEXT,
  plan_at      INTEGER,
  next_plan    TEXT,
  customer_id  TEXT,
  sub_id       TEXT,
  dispute_hold INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (key_hash, mode)
);
CREATE INDEX IF NOT EXISTS billing_customer ON billing (customer_id);

-- Every monthly subscription a buyer has had, as Stripe last said (the current one is billing.sub_id). Orders dated from
-- started_at to paid_through are covered by the plan (paid_through moves on only once a period's invoice is paid);
-- invoice_status: its latest invoice's (draft or open while a renewal is being paid); told: the state the channel was last
-- told about.
CREATE TABLE IF NOT EXISTS billing_subs (
  sub_id         TEXT PRIMARY KEY,
  key_hash       TEXT NOT NULL,
  mode           TEXT NOT NULL,
  status         TEXT NOT NULL,                     -- Stripe's: active | trialing | past_due | unpaid | incomplete | incomplete_expired | paused | canceled
  cancel_at_end  INTEGER NOT NULL DEFAULT 0,
  extras         INTEGER NOT NULL DEFAULT 0,         -- how many "15 more slots" it has
  paused         INTEGER NOT NULL DEFAULT 0,         -- collection paused (Friends and Family)
  started_at     INTEGER,
  paid_through   INTEGER,
  period_end     INTEGER,
  ended_at       INTEGER,
  latest_invoice TEXT,
  invoice_status TEXT,                              -- Stripe's: draft | open | paid | uncollectible | void
  told           TEXT,
  synced_at      INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_subs_key ON billing_subs (key_hash, mode);

-- Invoice lines: one per order per buyer, $10 each, due 3 days after the order. An order belongs to one buyer.
CREATE TABLE IF NOT EXISTS billing_lines (
  id             TEXT PRIMARY KEY,
  key_hash       TEXT NOT NULL,
  mode           TEXT NOT NULL,
  store          TEXT NOT NULL,                     -- the app's store key ("target", "pokemoncenter")
  store_name     TEXT NOT NULL DEFAULT '',
  order_no       TEXT NOT NULL,
  item           TEXT NOT NULL DEFAULT '',
  qty            TEXT NOT NULL DEFAULT '',
  order_at       TEXT NOT NULL,                     -- the order's date, YYYY-MM-DD
  acct_hash      TEXT NOT NULL DEFAULT '',          -- acctHash of the account it was placed on
  profile        TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL,                     -- alert: an account the owner gave | buyer: their own account, reported by their FAFO | owner: added or pasted by the owner
  amount         INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  due_at         INTEGER NOT NULL,
  held_sub       TEXT,                              -- set while the buyer's monthly payment is past due: not due yet (dropped if that invoice gets paid)
  paid_at        INTEGER,
  pay_id         TEXT,                              -- billing_payments.id, or 'manual'
  canceled_at    INTEGER,
  cancel_src     TEXT,                              -- alert | buyer | covered (by a monthly plan)
  waived_at      INTEGER,
  dispute_at     INTEGER,
  dispute_note   TEXT NOT NULL DEFAULT '',
  dispute_answer TEXT,                              -- waived | kept
  UNIQUE (key_hash, mode, store, order_no)
);
CREATE INDEX IF NOT EXISTS billing_lines_key ON billing_lines (key_hash, mode, created_at);
CREATE INDEX IF NOT EXISTS billing_lines_order ON billing_lines (store, order_no);

-- A buyer's own accounts that were out as slots, and when (from the batch reaching the channel until a pull): the hash of
-- the email only, which their FAFO's reported checkouts are checked against. Kept whether billing is on or off; a declined
-- batch's go, and pulled ones go after 120 days.
CREATE TABLE IF NOT EXISTS billing_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash   TEXT NOT NULL,
  store      TEXT NOT NULL,
  store_name TEXT NOT NULL,
  profile    TEXT NOT NULL,
  acct_hash  TEXT NOT NULL,
  batch      TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  pulled_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_one ON billing_accounts (key_hash, batch, store, acct_hash);
CREATE INDEX IF NOT EXISTS billing_accounts_acct ON billing_accounts (key_hash, acct_hash);
CREATE INDEX IF NOT EXISTS billing_accounts_slot ON billing_accounts (key_hash, store_name, profile);

-- A slot on an account the owner gave that the buyer pulled: orders on it after the pull aren't billed.
CREATE TABLE IF NOT EXISTS billing_pulled (
  key_hash  TEXT NOT NULL,
  store     TEXT NOT NULL,
  profile   TEXT NOT NULL,
  batch     TEXT NOT NULL,
  pulled_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, store, profile, batch)
);

-- Stripe Checkout sessions: 'pay' (what's owed for checkouts) and 'monthly' (signing up for the plan). One open per kind per
-- buyer; a payment that covered lines no longer owed is refunded the difference.
CREATE TABLE IF NOT EXISTS billing_payments (
  id             TEXT PRIMARY KEY,
  key_hash       TEXT NOT NULL,
  mode           TEXT NOT NULL,
  kind           TEXT NOT NULL,                     -- pay | monthly
  extras         INTEGER NOT NULL DEFAULT 0,
  session_id     TEXT,
  url            TEXT,
  line_ids       TEXT NOT NULL DEFAULT '[]',        -- JSON [billing_lines.id]
  amount         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,                     -- open | paid | expired | failed
  web            INTEGER,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  checked_at     INTEGER,
  paid_at        INTEGER,
  applied        INTEGER,
  refund         INTEGER NOT NULL DEFAULT 0,
  refund_id      TEXT,
  refund_err     TEXT,
  payment_intent TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_open ON billing_payments (key_hash, mode, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS billing_payments_key ON billing_payments (key_hash, mode, created_at);
CREATE INDEX IF NOT EXISTS billing_payments_session ON billing_payments (session_id);
CREATE INDEX IF NOT EXISTS billing_payments_pi ON billing_payments (payment_intent);

-- Stripe webhook events handled (a log, not a gate), calls counted for limits, settings (when billing came on, and on again
-- after the keys were gone, Stripe's price ids, when the owner's FAFO last sent order alerts), and links to the owner's
-- Billing page (24 hours, like premium_lists).
CREATE TABLE IF NOT EXISTS billing_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_calls (
  key_hash TEXT NOT NULL,
  kind     TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_calls_key ON billing_calls (key_hash, kind, at);
CREATE TABLE IF NOT EXISTS billing_config (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_lists (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL,                     -- the license that asked (the owner's, or a buyer's dispute)
  key_last4   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  username    TEXT,
  view_token  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_lists_key ON billing_lists (key_hash, created_at);
