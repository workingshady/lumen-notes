-- Free-tier file storage without R2: files are split into fixed 1.5 MB parts (D1 rows max ~2 MB).
-- Part i holds bytes [i*CHUNK, (i+1)*CHUNK). `size` on part 0 = total file size, `parts` = part count.
CREATE TABLE file_parts (
  id TEXT NOT NULL,
  part INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (id, part)
);
CREATE TABLE file_meta (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
