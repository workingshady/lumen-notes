-- Named API tokens for scripts and agents (Settings › Developer). Only a SHA-256 hash of each token is stored;
-- the token itself is shown once, when it is created or regenerated.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  last_ip TEXT
);
