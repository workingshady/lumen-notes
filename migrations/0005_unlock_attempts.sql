-- Wrong-passcode tracking for POST /api/unlock (home area). One row per client (HMAC of the IP, never the raw IP).
-- `fails` counts misses in the current round; after MAX misses the client is locked until `locked_until` and
-- `strikes` grows, so each further lockout doubles (1 min, 2 min, 4 min … capped at 24 h).
CREATE TABLE unlock_attempts (
  client TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
