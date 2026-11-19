-- Round 6 (Settings › Developer › Create token): access (r = GET only, rw = read + write) and expiry.
-- The Worker also adds these on first use (worker/ext/settings.ts ensureScopes), so this migration is optional.
ALTER TABLE api_tokens ADD COLUMN access TEXT NOT NULL DEFAULT 'rw';
ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER;
