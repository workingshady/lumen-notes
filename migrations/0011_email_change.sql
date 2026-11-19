-- User accounts (docs/ACCOUNTS.md), still behind the ACCOUNTS_ENABLED switch (OFF). Adds the "change email" flow:
-- a signed-in user asks for a new address, a one-time link goes to that NEW address, and opening it moves the account.
-- Only the SHA-256 of the link token is stored. Nothing else changes; safe to apply while the switch is off.
CREATE TABLE IF NOT EXISTS email_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS email_changes_user ON email_changes(user_id);
