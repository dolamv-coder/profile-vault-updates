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
