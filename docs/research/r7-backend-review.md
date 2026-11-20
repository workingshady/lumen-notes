# R7 backend / logic / database review (Stage 3)

Date: 2026-11-20. Scope: `worker/**`, `src/lib/{sync,db,attachments,wb-files,activity}.ts`, `migrations/`, `wrangler.jsonc`. Read-only review, no source changed.

Docs fetched on 2026-11-20:
- D1 limits https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing https://developers.cloudflare.com/d1/platform/pricing/
- Workers limits https://developers.cloudflare.com/workers/platform/limits/
- R2 limits https://developers.cloudflare.com/r2/platform/limits/ and pricing https://developers.cloudflare.com/r2/pricing/
- Workers AI pricing https://developers.cloudflare.com/workers-ai/platform/pricing/ and limits https://developers.cloudflare.com/workers-ai/platform/limits/

Facts used from those pages:
- D1: max string/BLOB/row = 2,000,000 bytes. SQL statement max 100,000 bytes. 100 bound parameters. A `db.batch()` counts as one query. Free = 50 queries per invocation (paid 1,000). Free database size 500 MB per database (account total 5 GB; paid 10 GB per database). Query result max 50 MB (effective 2026-11-04). Free daily limits: 5 M rows read, 100 k rows written; each indexed column written costs one extra row written.
- Workers: request body 100 MB on Free/Pro. CPU per request 10 ms on Free (paid default 30 s, max 5 min). Memory 128 MB per isolate. Subrequests 50 on Free.
- R2: single PUT up to 5 GiB; free tier 10 GB-month, 1 M Class A and 10 M Class B operations per month; concurrent writes to one key limited to 1 per second.
- Workers AI: 10,000 neurons/day free (resets 00:00 UTC, per Cloudflare account). Llama-3.3-70B-fp8-fast 26,668 neurons/M input tokens and 204,805/M output. Llama-3.2-11B-vision 4,410/M input and 61,493/M output. Text generation 300 requests/min, image-to-text 720/min.

Plan assumption: `wrangler.jsonc` talks about the free plan and R2 is NOT bound (`FILES` commented out). Items marked "(Free)" apply only if the account is on Workers Free. Verify with `wrangler d1 info lumen-notes`.

Severity: **C** critical (data loss or total sync stop), **H** high, **M** medium, **L** low. Effort: S under 0.5 d, M 1-2 d, L 3+ d.

## Top findings at a glance

| # | Sev | Finding |
|---|-----|---------|
| F1.1 | C | A record over about 1.9 MB is a poison pill: one oversized board makes every `/sync` batch fail forever |
| F2.1 | C | Client sends all dirty rows, server keeps 2000, client marks all clean (silent data loss on big imports) |
| F2.2 | H | Sync page has no byte budget (50 MB result cap, 128 MB memory); `rev` ties can be skipped |
| F3.1 | H | Storage limit assumed 5 GB; free D1 is 500 MB per database; versions of big boards fill it fast (F5.1) |
| F6.1 | H | `/api/att` serves any MIME inline on the app origin with no nosniff/CSP (stored XSS, token in localStorage) |
| F2.3 | M | Future-clock LWW trap: server trusts client `updatedAt`; REST writes silently dropped |
| F3.4 | M | Uploads buffer up to 100 MB before validation; D1 stream breaks above about 70 MB (Free) |
| F6.2 | M | `/api/unfurl` is an unauthenticated open fetch proxy |
| F4.1 | M | AI: meter runs before auth, soft cap races, estimates wrong, 3 accounts share one 10k allowance |
| F6.4 | M | REST `PUT /canvas`, `/whiteboard` retype any note with that id |
| F7 | M | Vault wipe deletes the entire R2 bucket, including other accounts' files (once R2 is on) |

---

## 1. Size limits (D1 vs Lumen records)

### F1.1 (C) Oversized record = sync poison pill
Evidence:
- `worker/index.ts:141-150` (`upserts`) stringifies `it.data` with no size check.
- `worker/index.ts:158-159` runs `db.batch(stmts.slice(i, i+100))`. A batch is atomic, so one statement over 2 MB (SQLITE_TOOBIG) fails the other items in that batch too.
- Failure surfaces as a 500; `src/lib/sync.ts:79-83` only backs off (1, 2, 4, 8, 15 min) and retries the same payload forever. Nothing else syncs behind it, because the dirty set goes in one request.
- Real ceiling: stored `data` is `JSON.stringify(record)`, and `body` is already a JSON string inside the record, so quotes are escaped twice. About 10-15% overhead: practical limit is about 1.7 MB of body.

What happens by size (whiteboard/board note body):

| Body | Result |
|------|--------|
| 1 MB | Syncs. Each push rewrites 1 MB plus its index rows; a 1 MB Version row every 2 min (F5.1). |
| 5 MB | D1 rejects the row (SQLITE_TOOBIG), the whole 100-statement batch fails, all sync stops, status "error", pending never drops. Local data stays safe in IndexedDB. No UI says which note. |
| 20 MB | Same failure, and each retry uploads 20 MB; the editor's main thread also stringifies it per save (F5.2). |
| Imported `.excalidraw` with inline dataURL images | Fails on first sync: images become `lumenAtt` refs only when the board is opened and saved (`src/components/Whiteboard.tsx:578`, `src/lib/wb-files.ts:1-10`). |

Fix (S, do now):
- Worker: `if (data.length > 1_900_000) { rejected.push({kind,id,reason:"too_large"}); continue; }`; return `rejected` in the `/sync` response; wrap each batch in try/catch and on failure retry item by item so one bad row never blocks the rest.
- Client (`sync.ts`): keep `dirty=1` for rejected rows, record a per-id sync error (meta table), show "Note X is too large to sync (n MB)", and exclude it from the "pending" count.
- Import (`io.ts`): convert inline `.excalidraw` files to attachments at import time (same code as `Whiteboard.tsx:578`).

### F1.2 (H, design) Big bodies: spill to a content-addressed blob
Keep the open-format body in the record up to a soft limit (512 KB). Above it, store the body as a blob and keep a small stub in `items.data`:
`{..., "body": "", "lumenBody": {"blob": "b:<sha256>", "size": 3145728, "enc": "gzip"}}`.
- Blob storage: R2 key `body/<sha256>` when `FILES` is bound, else the existing `file_meta` / `file_parts` tables under id `b:<sha256>` (1.5 MB parts, same Range code).
- Gzip first with `CompressionStream("gzip")` (Excalidraw JSON and JSON Canvas shrink 5-10x), so most boards stay under the soft limit and never spill.
- Content addressing dedups Version snapshots (unchanged body = same blob) and makes uploads idempotent. Reference table below enables safe GC (F3.3).
- Push order mirrors attachments (`sync.ts:40`): upload blob, then push stub. Pull gets stubs only; the editor fetches the blob lazily (cached in `db.blobs`). First sync of a new device becomes small (helps F2.2). Keep `title` and a `props.lumenCount` in the stub for lists and activity.
- REST: `GET /whiteboard/:id` and `/canvas/:id` resolve the blob and return it; `PUT` writes blob + stub.
- Rollout: ship the client first, then enable spilling on the server behind `SPILL=1`; old clients show an empty body for a spilled note, so do not enable it while old builds (Android APK) are in use. Never spill markdown bodies.
- Effort: L (3-4 d). Do F1.1 first.

Migration `migrations/0013_body_blobs.sql` (apply to all three databases: `lumen-notes`, `lumen-roadmap`, `lumen-languages`):
```sql
CREATE TABLE IF NOT EXISTS item_blobs (
  kind TEXT NOT NULL, id TEXT NOT NULL, blob_id TEXT NOT NULL,
  PRIMARY KEY (kind, id, blob_id)
);
CREATE INDEX IF NOT EXISTS item_blobs_blob ON item_blobs(blob_id);
-- completion marker so half-uploaded files are never served (F3.4)
ALTER TABLE file_meta ADD COLUMN complete INTEGER NOT NULL DEFAULT 1;
```
No data migration: notes without `lumenBody` work unchanged.

Cheaper alternative (M, 1 d): hard cap at 1.7 MB with an editor warning "Board too large: remove images or split it", and make sure saved scenes never contain dataURLs or deleted elements.

### F1.3 (M) Other size facts
- `GET /api/notes`, `/search`, `/tags`, `/cards/due`, space `/share/:token` and `posts()` load every note body (`worker/index.ts:196`, `worker/ext/rest.ts:96,155`). N rows of up to 2 MB can pass the 50 MB result cap and 128 MB memory. Fix (S): select `json_extract(data,'$.title')`, `LENGTH(data)`; paginate with `LIMIT`; search with SQL `LIKE` first.
- Statement length (100 KB) and parameter limit (100) are fine: values are bound, `kinds` capped at 12 (`index.ts:161`).
- `PUT /api/canvas/:id` pretty-prints (`JSON.stringify(cv, null, 2)`, `index.ts:250`), 30-40% bigger than compact. Use compact output.
- `lumenArch` lives inside the canvas JSON, so the same limit and the same spill design apply.

---

## 2. Sync

### F2.1 (C) Silent drop of everything past 2000 dirty items
Evidence: client builds `items` from all dirty rows (`src/lib/sync.ts:45-51`) in one request; server does `(body.items ?? []).slice(0, 2000)` (`worker/index.ts:158`); client then clears `dirty` on every sent id (`sync.ts:58-67`). A 3,000-note import (Obsidian/Notion) or a first push after weeks offline loses the last 1,000 permanently: they are clean locally and never reach other devices.
Fix (S): client pushes in chunks of 200 items or 3 MB, clears dirty only for acknowledged ids. Server returns `{accepted, rejected[]}` and answers 413 (not a silent slice) if `items.length > 2000`.

### F2.2 (H) Pull page has no byte budget; same-`rev` ties can be skipped
Evidence:
- `PAGE = 1500` rows (`index.ts:129,163-164`); rows up to 2 MB, response built as one string (`:173-179`). 50 MB result cap and 128 MB isolate memory.
- Cursor = last row's `rev`, next page asks `rev > cursor`. Revs are normally unique (one BUMP per item) but the vault wipe gives every row the same rev (`worker/ext/account-data.ts:340`); a page boundary inside the tie skips the rest, so other devices keep data that was wiped.
Fix (S-M): in code, accumulate `LENGTH(data)` and cut the page at 8 MB (always return at least one row), set `cursor` to the last returned rev and `more=true`; for ties, after the page include remaining rows with `rev = lastRev` (`SELECT * FROM items WHERE rev = ?`), or make the wipe assign distinct revs by running it in chunks of 500 through `upserts()`.

### F2.3 (M) LWW details: clock skew, silent losers
- `UPSERT ... WHERE excluded.updated_at > items.updated_at` (`index.ts:130-134`); the server never clamps `updatedAt`. `save()` ratchets `Math.max(now(), prev+1, stored+1)` (`db.ts:237`), so a device whose clock is a year ahead stamps year-ahead rows and every other device, and the REST API (`index.ts:213-216`, `rest.ts:141` use `Date.now()`), loses until real time catches up. REST `PUT` still answers `ok`.
- Fix (S): server clamps `updatedAt = min(client, now + 5 min)` before the compare and stores/echo-compares the clamped value (`sent`, `:176`); REST uses `Math.max(Date.now(), old.updatedAt + 1)`. Return `serverNow` in `/sync` so a client can warn when its clock differs by more than 2 min.
- Losers: a row rejected by LWW is not reported; the loser's dirty flag is cleared and the pull overwrites it. For notes, the conflict hook (`src/components/ws-conflict.tsx:40-67`) saves the losing body as a Version. For every other kind (cards, spaces, folders, activity, attachments) the loser is silently dropped. Fix (S): server returns rejected ids; client keeps them dirty after re-basing on the remote copy.
- `space.props` (pens, palettes, `aiOff`, `aiLimit`, `aiModel`, blog settings; all in the Inbox space) is one LWW record: two devices changing different keys clobber each other. Fix (M): merge props per key using `propsAt: {key: ts}` written by `save()`, applied in both `apply()` and the server upsert. Keep values small: Inbox props are read on every AI call and blog hit (`index.ts:120,461`).

### F2.4 (M) Per-element merge for boards and canvases: feasible, minimal safe design
Facts: `reconcileElements` is exported by the installed `@excalidraw/excalidraw` 0.18.1 (found in its `index.d.ts`). It chooses the element with the higher `version`, ties by lower `versionNonce` (as used by Excalidraw collab). The official docs page could not be fetched today (redirect target 404), so this is from the library source, not a doc link.
Design (client-only, no server change, M-L, 2-3 d):
1. At pull time in `apply()`: if the remote note is `whiteboard`/`board` and the local row is dirty or was written by another `lumenDevice` (already tagged by the conflict middleware), parse both bodies and merge: `elements = reconcileElements(local, remote, appState)`, `files` = union by id, other fields from the newer note, `lumenPending` concatenated and de-duplicated. Save the result as a normal dirty edit (`updatedAt = max + 1`) and still store the loser as a Version.
2. Deletions: saved scenes drop deleted elements (`serializeAsJSON`, `Whiteboard.tsx:592-609`), so a merge would resurrect an element deleted on the other device. Keep tombstones (`{id,type,version,versionNonce,isDeleted:true,updated}`) in the stored scene for 7 days.
3. JSON Canvas: nodes have ids but no version. Add `lumenV` (integer bumped on each edit; allowed by the `lumen*` rule) and `lumenDel:1` tombstones for 7 days (hidden by the renderer, stripped on `.canvas` export). Merge nodes/edges by id on higher `lumenV`, tie by device id; `lumenArch` is derived, take the newer note's.
4. Guardrails: parse failure or merged size over the cap falls back to LWW; never merge markdown/diagram bodies this way; unit-test disjoint and overlapping edits.
Lower-risk first step (S): keep LWW and add a "Merge both" button in `ws-conflict.tsx` that runs the same merge on demand.

### F2.5 (M) Offline queue, backoff, tombstones, new kinds
- Queue: the per-record `dirty` flag in IndexedDB is a sound offline queue and survives restarts; the `updatedAt` compare avoids clearing a record edited mid-flight (`sync.ts:63-65`). Weak points: one request carries everything (F2.1); errors are not classified, so permanent 4xx (400/413) retry forever; backoff has no jitter (`:81`); no `Retry-After`. Fix (S): permanent 4xx marks that record failed (F1.1), add 20% jitter, honour `Retry-After`.
- Tombstones: the server keeps them all (tiny). Client `compactTombstones` (`sync.ts:146-154`) only handles notes titled "(deleted)" above 50; tombstoned `version`/`activity` rows (activity is capped at 300 per note, `activity.ts:16,193-196`) are never compacted. Pruning on the server risks a device offline longer than retention never learning of a deletion. Fix (S-M): purge tombstoned `version`/`activity` rows older than 90 days and store `meta.min_cursor`; a client whose cursor is older does a full resync.
- New kinds: server is generic (`KINDS` in `shared/types.ts:216`), so `activity` and `board` rows sync without server changes; old clients ignore unknown kinds. Cost note: a typing session rewrites one activity row per flush, and each synced item costs about 4-6 rows written (F5.1).

---

## 3. Attachments

### F3.1 (H) Storage limit is wrong for free D1
Evidence: `worker/ext/settings.ts:128` `limitBytes: 5 * 1024 ** 3`; `src/lib/attachments.ts:358-368` pauses uploads at 98% of that; `wrangler.jsonc` comment says "5 GB total on the free plan", which is the account total shared by three databases. Per docs each database is capped at 500 MB on Free. A full database fails every write including `/sync` (same symptom as F1.1).
Fix (S): `limitBytes` from a var (`D1_LIMIT_BYTES`, default 500 MB, 10 GB on paid), use the `dbBytes` (`size_after`) already returned, warn at 80%. Strongly consider enabling R2 (10 GB-month free, needs a card): the code path exists (`index.ts:306-309,324-347`). Prefix keys per account first (F7).

### F3.2 (M) R2 path only works for single-part files
`index.ts:306` `if (c.env.FILES && parts === 1)`; the client always sends `parts = ceil(size/1.5 MB)` (`attachments.ts:383`). With R2 bound, files over 1.5 MB still go to D1 (GET prefers R2, falls back to D1, so it works but wastes D1).
Fix (S): the client reads `/api/health` `r2` once and in R2 mode sends one PUT per file (100 MB body limit; R2 single PUT up to 5 GiB); Worker streams `c.req.raw.body` into `FILES.put` after a `content-length` check. For larger files use R2 multipart (parts of at least 5 MiB, max 10,000). Keep 1.5 MB parts only for the D1 fallback.

### F3.3 (M) No orphan cleanup
Images removed from a board leave `files[...].lumenAtt` only in history; the attachment record, D1/R2 bytes and the IndexedDB `blobs` entry live until someone deletes them in Settings › Storage (`settings.ts:137-147`). Nothing deletes on element or note removal, and Versions (F5.1) keep refs alive.
Fix (M, 1.5 d): server mark-and-sweep on a Cron Trigger (`"triggers": {"crons": ["17 3 * * *"]}` plus a `scheduled()` export):
1. Page through `items` by `rev`, regex-extract ids (`att:<id>`, `"lumenAtt":"<id>"`, later `lumenBody.blob`) into a Set (versions included until retired).
2. For `file_meta.created_at < now - 7 days` and id not in the Set:
```sql
DELETE FROM file_parts WHERE id = ?1;
DELETE FROM file_meta  WHERE id = ?1;
DELETE FROM files      WHERE id = ?1;
```
plus `FILES.delete(["att/<id>", ...])` (up to 1000 keys per call) and a tombstone of the `attachment` item so devices drop the cached blob.
3. Dry-run first (log counts to observability). The 7-day grace protects an offline device that uploads files before notes (`sync.ts:40`).
Client: evict `db.blobs` entries no live note references and call `navigator.storage.persist()`.

### F3.4 (M) Upload and serving behaviour
- Range/ETag: D1 path handles single and suffix ranges and 416 (`index.ts:359-367`); multi-range falls back to 200 (fine). The strong ETag = id (`:349`) is correct (ids never reused). R2 path delegates conditionals and ranges to R2 (`:327`).
- Partial files: `file_meta` is written with every part (`:313`), so a GET during upload streams until the first missing part and errors. Fix (S): `complete` column (migration above), set after all parts exist; GET answers 404 until then.
- Free stream limit: each part is one D1 query in one invocation, Free allows 50, so a non-Range GET of a file larger than about 70 MB dies mid-stream. `MAX_FILE` is 100 MB (`index.ts:293`, `attachments.ts:343`). Fix (S): cap D1-stored files at 50 MB unless R2 is bound.
- Memory: `await c.req.arrayBuffer()` runs before validation (`index.ts:302`); a 100 MB body in a 128 MB isolate can crash. Check `content-length` first (reject above `CHUNK` in D1 mode).

### F3.5 (M) Server-side quota
Quota is client-only (`attachments.ts:376-381`); a token holder can PUT without limit. Fix (S): in PUT check `SELECT COALESCE(SUM(size),0) FROM file_meta` (small table) against the cap and answer 507/413.

---

## 4. AI

### F4.1 (M) Meter, caps, estimates, quota scope
- Order: `registerAiUsage` mounts the meter on `/ai`, `/ai/*`, `/transcribe` before each route's `auth` (`ai-usage.ts:320-323`, `index.ts:77`). An unauthenticated POST triggers `CREATE TABLE IF NOT EXISTS` (once per isolate), two D1 reads and a body clone (`:278-297`) before `auth` returns 401. Fix (S): `api.use("/ai/*", auth, meter)`; skip the clone when `content-length` is above 8 MB.
- Soft cap: checked before the call, counted after in `waitUntil` (`:281,303-317`); parallel requests all pass; streams are counted when they end. Fix (M): reserve neurons up front (`INSERT ... ON CONFLICT DO UPDATE SET neurons = neurons + ?`), true up afterwards, or document it as soft.
- Quota scope: 10,000 neurons/day is per Cloudflare account, but the meter and `_reached` marker live in each account's D1 (`accounts.ts:20-24` swaps `DB`). Three accounts each think they have 10,000. Fix (S): keep `ai_usage` in the main DB (capture the original binding before the swap) or default each account to about 3,300.
- Estimates: `neurons()` (`ai-visual.ts:122`) uses 6.41 per 1,000 output tokens; the vision model is 61,493 per M (61.5 per 1,000): output under-counted about 10x. The meter separately uses 70B text rates from the response size (`ai-usage.ts:224,311`), so the returned `neurons` and the metered value disagree. Fix (S): one estimator keyed by model id from the pricing page.
- `aiOff`: `auth` checks only `/api/ai` and `/api/transcribe` (`index.ts:119`); chat/tutor/ask/practice/hub check themselves; `/api/ai/visual/*` checks nothing, so "AI off" does not stop vision and architecture calls. Fix (S): add the check to the four routes or enforce in the meter for all `/ai/*`.

### F4.2 (M) Timeouts, caching, abuse
- Timeouts: `withTimeout` (`ai-visual.ts:77-78`) races a timer but the underlying `ai.run` keeps running and burning neurons; vision may try 2 models x 2 attempts (`:92-112`). `/api/ai` and `/api/ai/chat` have no timeout. Fix (S): `AbortSignal.timeout(45000)` where supported, no retry after a timeout.
- Caching: none. Deterministic actions (`tags`, `diagram_name`, `summarize`, vision convert of the same pixels) should be cached. Fix (S-M): key = SHA-256 of route + model + system + input, stored in `caches.default` (7 days) or D1 `ai_cache(key TEXT PRIMARY KEY, out TEXT, at INTEGER)` with 30-day cleanup; hits cost 0 neurons and are not metered. Skip streaming chat.
- Input caps: `/ai` slices at 24,000 chars (`index.ts:422`); image 3.5 M base64 chars (`ai-visual.ts:25,135`); arch/edit/review sliced to 24,000 in `chat()` (`:117`); `/transcribe` rejects above 6 MB but only after buffering (`index.ts:433-435`). Add `content-length` pre-checks.
- Abuse: only the owner token or `rw` tokens reach AI (`r` tokens are blocked on POST, `index.ts:106`). The daily cap is the main protection; fix the items above to make it reliable, and add a 60/min guard under the 300/min text limit. Map rate-limit errors to a separate code (`ai_rate`) from the daily `ai_limit` (`ai-visual.ts:84`).

---

## 5. Performance

### F5.1 (H) Version snapshots and write amplification
Evidence: `maybeSnapshot` (`src/lib/actions.ts:92-106`) writes a full-body Version row every 2 minutes of editing; versions sync like any record and are never pruned (no prune code exists; only `compactTombstones` for notes deleted forever). A 1.2 MB board in a 30-minute session: 15 versions, about 18 MB local and 18 MB in D1, plus the note row rewritten per push. Per synced item D1 writes the `meta` bump, the row and its indexes (`items_rev` always; the expression indexes only when the value is non-null): about 4-6 rows written; with the 100,000 rows/day Free limit a day of heavy editing gets close (D1 pricing page).
Fixes:
- Retention (S): all versions for 24 h, then one per day for 30 days, then one per week; tombstone the rest and add them to compaction.
- No-op detection (S): compare Excalidraw `getSceneVersion` or a hash of element versions instead of `last.body === n.body` on multi-MB strings (`actions.ts:104`).
- Big bodies (M): with F1.2 a Version is a small stub referencing a shared blob. Until then do not sync Versions whose body exceeds the soft limit.
- Activity (S): capped at 300 per note and coalesced within 5 minutes (good); but each `put` runs two Dexie scans (`activity.ts:157,193`). Keep an in-memory count per note and scan only above the cap.

### F5.2 (M) Main-thread JSON cost
- Whiteboard autosave: `serializeAsJSON` then `JSON.parse` then `JSON.stringify` of the scene (`Whiteboard.tsx:592-615`).
- `save()` does a `get` plus `put`, and the `lumenConflicts` dbcore middleware does another `get` per notes put (`ws-conflict.tsx:46-54`): up to three structured clones of the body per save.
- Activity: `boardItems()` runs `JSON.parse` for both before and after per flush (`activity.ts:99-115`).
- Sync: `api()` stringifies the whole dirty set; `apply()` bulkPuts whole bodies.
Rough scale (engine-dependent, measure with the Performance panel): `JSON.parse`/`stringify` at about 100-300 MB/s means 5 MB costs about 20-50 ms per pass and 20 MB about 100-200 ms, doubled by the activity flush. Under 1 MB it is not a concern.
Fixes: (S) derive activity deltas from an element-id `Map` cached per note and updated from the editor's `onChange`; (S) skip autosave when `getSceneVersion` is unchanged; (S) avoid the extra middleware `get`; (M) move parse/merge/diff of bodies over 1 MB to a module Web Worker (pattern: `src/lib/export-worker.ts`).

### F5.3 (M, Free only) Worker CPU
Free allows 10 ms CPU per request (D1 wait does not count; JSON parse does). Paths that parse many or large documents: `GET /notes`, `/search`, `/tags`, `/cards/due` (`rest.ts:96`), blog `posts()`/RSS/OG (`index.ts:449-452`, `og.ts:40`), REST board writes (`saveBoard`, `index.ts:262-274`), space `/share/:token`. They risk error 1102 as the vault grows. `/sync` is well built (rows are emitted without parse, `index.ts:173-179`). Fixes: select columns with `json_extract`, add `LIMIT`, cache blog/RSS/OG in `caches.default`, search in SQL. On a paid plan the limit is 30 s default and this is moot.

---

## 6. Security

### F6.1 (H) Attachments served same-origin with arbitrary MIME
Evidence: PUT stores the request `content-type` (`index.ts:299,313`); GET returns it unchanged with no `content-disposition`, `x-content-type-options` or CSP (`:357,391`, R2 `:329-345`), publicly (`:320-321`). `storeBlob` keeps SVG as is (`attachments.ts:318-327`). Navigating to `/api/att/<id>` of an `image/svg+xml` or `text/html` upload runs its script in the app origin, where the owner token is in `localStorage`. Sources: imports, drag-and-drop, REST uploads.
Fix (S): GET adds `X-Content-Type-Options: nosniff`; for MIME outside `image/(png|jpe?g|webp|gif|avif|bmp)`, `video/*`, `audio/*`, `application/pdf` send `Content-Disposition: attachment`; always send `Content-Security-Policy: sandbox; default-src 'none'` for SVG (still renders in `<img>`). PUT rejects `text/html`, `application/xhtml+xml`, `text/xml`.
Also (S): add `public/_headers` (none exists today) with a CSP (`script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`. Trial in report-only mode first.

### F6.2 (M) `/api/unfurl` is an unauthenticated fetch proxy
`index.ts:493-528`: no `auth`, no private-host check, `redirect: "follow"`, `access-control-allow-origin: *`, 24 h cache. Anyone can make the Worker fetch any URL and burn the Free request budget. Fix (S): add `auth` (the app sends the token), apply `okUrl()` (`links.ts:242`), `redirect: "manual"` with one re-check.

### F6.3 (L) `links.ts` private-host filter
`PRIVATE` (`links.ts:241`) is a string test on the hostname; bypasses include decimal/hex IPs, IPv4-mapped IPv6 and DNS names resolving to private ranges. Workers cannot reach a private LAN, so impact is low. Fix (S): reject any IP-literal host.

### F6.4 (M) REST type confusion and missing caps
`PUT /api/canvas/:id` forces `type: "canvas"` over any existing note and replaces the body (`index.ts:248-251`); `saveBoard` turns any non-`board` note into a `whiteboard` (`:270`). A script or id typo can destroy a markdown note, board or diagram. `PUT /notes/:id` and `POST /notes` accept any `type` string and any body size (`index.ts:209-220`, `rest.ts:101-113`). Fix (S): if `old && old.type !== wanted` return 409; validate `type` against `NOTE_TYPES`; cap body at 1.9 MB (413).

### F6.5 (L-M) Token scopes, login brake, CORS
- Scopes are only `r`/`rw` plus expiry (`settings.ts:24-29`, `index.ts:106`). An `rw` token can sync any kind (including Inbox `props` such as `aiOff`/`aiLimit`/`aiModel`), write attachments, delete notes and call AI. Wipe, token management and accounts need the owner session (`ownerOnly`, `account-data.ts:325`): good. Add scopes (M): `notes`, `files`, `ai`; keep `/sync` owner-only.
- The owner token is the unsalted `HMAC(passcode, "lumen:owner:v1")` (`index.ts:68-72`): valid until the passcode changes, shared by all devices. Acceptable for one owner; the device `gen` check (`access.ts`) helps.
- `/api/login` brute-force brake is a per-isolate `Map` (`index.ts:79-93`), so it is soft; `/api/unlock` uses D1 (`migrations/0005`). Point both at the D1 table or retire `/login` (S).
- CORS reflects any origin (`index.ts:51`). Safe now (bearer header, no cookies, no credentials); tighten to an allow-list (`https://localhost`, `capacitor://localhost`, site origin) if cookies are ever added.

### F6.6 (L-M) SVG sanitising and shared pages
- `sanitizeSvg` (`src/lib/vendor-icons.ts:54-65`) is an allow-list; strips `on*`, external `url()`, non-`#` `href`, `foreignObject`, `<script>`; refuses over 400 KB. Gaps: runs only in the browser (server never sanitises, hence F6.1), and `<style>` is allowed with arbitrary selectors, so an SVG inlined via `innerHTML` can restyle the page. Fix (S): drop `<style>` or scope selectors; render third-party icons through `<img>` data URIs when possible.
- Shared and blog pages: markdown-it `html: false` (`markdown.ts:245`), Mermaid `securityLevel: "strict"` (`markdown.ts:554,710`), OG meta values escaped (`og.ts:91`), `setInnerContent` escapes. `Shared.tsx:358` and `Blog.tsx:126` assign `innerHTML` from renderer output only. I found no XSS path. Canvas preview SVG escapes `<>&` but not quotes (`canvas.ts:300`); colours come from a map, so low risk.
- `/share/:token/refs` accepts tokens from 6 chars (`settings.ts:155`) vs 16 elsewhere: align.
- `publicNote(n)` returns the full body, including `lumenArch`, `lumenPending`, device names and (after F2.4) tombstoned elements. Strip private `lumen*` keys on share (S).
- Share responses are cached 30 s (`index.ts:535`): revoking takes up to 30 s.

### F6.7 (OK) New AI routes
`/api/ai/visual/{convert,arch,edit,review}` use `auth` (`ai-visual.ts:127,148,162,175`), validate `kind`/`type` against allow-lists, cap image and text sizes, and sit under the meter. Gaps are those in F4.1/F4.2 only.

---

## 7. Compatibility

- Old `.canvas`: `validCanvas` (`index.ts:222-235`) accepts JSON Canvas 1.0 (`text|file|link|group`); extra keys such as `lumenArch` survive because the parsed object is re-serialised. It rejects edges pointing at missing nodes and any future node type; relax unknown node types to keep-and-log (S). Output is re-indented (F1.3).
- Old `.excalidraw`: `GET/PUT /api/whiteboard` store the scene unchanged (`Object.assign(s, body, {type:"excalidraw"})`); only the inline-dataURL size trap (F1.1) applies.
- New types: server treats `type` as opaque; `board` is handled by `isWbType` in REST (`index.ts:259,270`); `NOTE_TYPES` is not validated (F6.4). `/api/notes?type=board` works. OpenAPI (`rest.ts:200-225`) does not mention `board` or `lumenPending`: update (S).
- Third "languages" account (commit eebe9c3): `accounts.ts` routes by token/passcode and swaps `DB`/`APP_PASSCODE`, so sync, REST, attachments and tokens work unchanged for every new route. Caveats:
  - Every migration must be applied to all three databases separately (shared `migrations_dir`); numbering skips 0006-0008 because those tables are created lazily (`ai_usage`, `devices` use `CREATE TABLE IF NOT EXISTS`). Include the proposed `0013` for all three.
  - `ogPages` is mounted on `app`, not `api`, so `/s/:token` for a share from the roadmap/languages accounts gets no OG tags (queries main DB only, `og.ts:27-31`; the client falls back to runtime tags). Fix (S): try each DB.
  - AI quota is account-wide (F4.1).
  - (M) Shared R2 bucket: keys are `att/<id>` with no account prefix, and the vault wipe lists and deletes the whole bucket (`account-data.ts:343-349`), including other accounts' files. Prefix keys per account (`att/<account>/<id>`, migrate existing) or delete only ids found in this account's `file_meta` before enabling R2.
- Old clients keep working if new response fields (`rejected`, `accepted`, `serverNow`) are additive and body spilling is flag-gated (F1.2).

---

## Recommended order of work

1. (S, today) F1.1 per-item size guard + `rejected`; F2.1 chunked push, no silent `slice(0, 2000)`.
2. (S) F6.1 attachment headers + CSP; F6.2 auth on `/api/unfurl`; F6.4 type guards and caps.
3. (S) F3.1 correct storage limit; decide on R2 (prefix keys first, F7); F3.2 single PUT in R2 mode; F3.4 content-length pre-checks.
4. (S) F2.3 clamp `updatedAt` and report rejected rows; F4.1 meter after auth, one estimator, `aiOff` on visual routes, quota in main DB.
5. (M) F5.1 version retention and no-op detection; F2.2 byte-budgeted pull and tie-safe cursor.
6. (M) F3.3 orphan GC cron; F4.2 AI cache and abort signals.
7. (M-L) F2.4 element merge (start with a "Merge both" button), F1.2 body blobs, token scopes.

---

## Design note: per-element board merge (not built; follow-up to F2.4)

Status 2026-11-20: F1.1, F2.1, F2.2, F2.3 (clamp), F3.1, F4.1 (auth order + per-account counters), F5.1 (retention + no-op), F6.1, F6.2 and the R2 prefix (F7) are fixed; this merge is designed only.

- **Where:** client only, in `apply()` (`src/lib/sync.ts`), for `whiteboard`/`board` notes when the local row is dirty (or was written by another `lumenDevice`). Server stays LWW.
- **Merge:** parse both scenes; `elements = reconcileElements(local, remote, appState)` from `@excalidraw/excalidraw` 0.18.1 (higher `version` wins, tie on lower `versionNonce`); `files` = union by id; other scene fields from the newer note; `lumenPending` concatenated and de-duplicated by content. Save the result through `save()` (dirty, `updatedAt = max + 1`) and still keep the losing body as a Version (the existing conflict hook).
- **Tombstones:** saved scenes drop deleted elements today, so a merge would resurrect them. Keep `{id, type, version, versionNonce, isDeleted: true, updated}` in the stored scene for 7 days (pruned on save), hidden by Excalidraw and stripped on `.excalidraw` export.
- **JSON Canvas:** nodes/edges get `lumenV` (bumped per edit) and `lumenDel: 1` tombstones for 7 days; merge by id on higher `lumenV`, tie by device id; `lumenArch` taken from the newer note. Allowed by the `lumen*` rule.
- **Guardrails:** parse failure, or a merged body over `MAX_ITEM_BYTES` (1.8 MB), falls back to LWW; never merge markdown or diagram bodies; bodies over 1 MB merge in a Web Worker. Unit tests: disjoint edits, same-element edits, delete vs edit, tombstone expiry.
- **First step:** a "Merge both" button in `ws-conflict.tsx` running the same function on demand, before making it automatic.
