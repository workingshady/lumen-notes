-- Attachment bytes when R2 isn't enabled (D1 rows max ~2 MB; the app compresses images first).
CREATE TABLE files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL);
