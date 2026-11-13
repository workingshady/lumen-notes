-- Generic synced store: one row per record of any kind. `rev` is a server-side, monotonically increasing
-- change counter used as the sync cursor (independent of device clocks).
CREATE TABLE items (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX items_rev ON items(rev);
CREATE INDEX items_published ON items(kind, deleted, json_extract(data, '$.published'));
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT INTO meta (k, v) VALUES ('rev', '0');
