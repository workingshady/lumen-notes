-- Fast lookup of unlisted share links (/s/<token>) and of a space's notes.
CREATE INDEX items_share ON items(json_extract(data, '$.shareId')) WHERE json_extract(data, '$.shareId') IS NOT NULL;
CREATE INDEX items_space ON items(kind, json_extract(data, '$.spaceId'));
