-- User accounts (docs/ACCOUNTS.md). Built behind the ACCOUNTS_ENABLED switch, which stays OFF: these tables are
-- only read or written by worker/ext/auth.ts when the switch is on. Creating them changes nothing for the owner,
-- whose passcode sign-in and `items` table are untouched.

-- One row per person. Email is stored lower-cased (unique); `password_hash` is PBKDF2-SHA256 with a per-user salt
-- (format "pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>"), NULL when the user only signs in with Google
-- or magic links.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT 'glyph:owl',
  lang TEXT NOT NULL DEFAULT 'en',
  tz TEXT NOT NULL DEFAULT 'UTC',
  password_hash TEXT,
  password_changed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- External sign-in methods linked to a user (provider 'google', subject = the Google `sub` claim).
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- Signed-in devices. `id` is the SHA-256 of the bearer token (the token itself is never stored).
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One-time tokens sent by email (verify / magic / reset) and the short Google hand-off code. Only SHA-256 hashes.
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'magic', 'reset', 'handoff')),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, kind);

-- Pending Google sign-ins (OAuth state → PKCE verifier + nonce), single use, 10 minutes.
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  link_user TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Rate limiting / lockout for sign-in and email sending, like unlock_attempts (keys are HMACs, never raw IPs/emails).
CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Security log (sign-in, password change, linking, deletion …). `client` is an HMAC of the IP.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  event TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_user ON audit(user_id, at);

-- Per-user synced records: same shape as `items` plus `uid`. The owner keeps using `items`; signed-in users only
-- ever see their own rows here (worker/ext/auth.ts scopes /api/sync by session). `urev` is their sync cursor.
CREATE TABLE user_items (
  uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  PRIMARY KEY (uid, kind, id)
);
CREATE INDEX user_items_rev ON user_items(uid, rev);
INSERT OR IGNORE INTO meta (k, v) VALUES ('urev', '0');
