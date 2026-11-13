# Lumen: notes for Claude

Single-owner study notebook + blog. Local-first (Dexie/IndexedDB) with sync to Cloudflare D1. See README.md for formats and the REST protocol.

## Layout
- `shared/types.ts`: every synced record type (Space, Folder, Note, Version, Card, Session, AttachmentMeta) + JSON Canvas types. Note `type` decides the editor: markdown types, `canvas` (JSON Canvas body), `whiteboard` (.excalidraw body), `roadmap` (Markdown roadmap syntax).
- `worker/index.ts`: Hono API: `/api/login`, `/api/sync`, notes/canvas/whiteboard REST, `/api/att/:id` (R2 or D1 `files` fallback), `/api/ai`, `/api/transcribe`, `/api/unfurl` (link previews), `/api/public/*` + `/rss.xml` (blog). D1 = one generic `items(kind,id,data,updated_at,deleted,rev)` table; `meta.rev` is the sync cursor.
- `src/lib/`: `db.ts` (Dexie + `save/patch` mark records dirty → debounced push), `sync.ts`, `markdown.ts` (markdown-it pipeline: KaTeX, Mermaid, callouts, wikilinks, tags, embeds, link cards, `dir="auto"`), `parse.ts` (front-matter, tasks, flashcards, roadmap parser), `search.ts` (MiniSearch + Arabic normalization + query operators), `canvas.ts` (JSON Canvas validate/layout/script API), `whiteboard.ts` (Excalidraw skeleton helpers, canvas→whiteboard), `store.ts` (UI store + `useVault` derived indexes), `settings.ts` (themes/tokens), `io.ts` (import/export).
- `src/components/`, `src/views/`: UI. Whiteboard is lazy-loaded (big chunk).
- Sharing: `shareId` on a note or space = unlisted link `/s/<token>` (`src/views/Shared.tsx`, read-only, never writes local data). Space shares expose only goal/deadline/target/url props.
- Android: Capacitor **6** (runs on JDK 17 at `C:/Program Files/Java/jdk-17`); config is `capacitor.config.json` (CLI 6 can't load .ts with this TypeScript). Icons rendered from `public/icon.svg` into `android/app/src/main/res`.
- `docs/`: FEATURES.md (status table: keep it updated), design/ (Claude Design prompt + numbered follow-ups `CLAUDE_DESIGN_UPDATE_NN.md`; add a new numbered file for each design round).

## Rules
- All writes go through `save()/patch()` in `src/lib/db.ts` (sets `dirty`, `updatedAt`). Never write Dexie tables directly for synced kinds.
- Never delete synced records: set `deleted: 1` (tombstones sync to other devices).
- Keep stored formats open: Markdown, JSON Canvas 1.0, .excalidraw. Don't add proprietary fields except under a `lumen*` key.
- Arabic + English: block elements get `dir="auto"`; keep `unicode-bidi: plaintext` rules.
- Commits: no Co-Authored-By trailer. `SETUP.md` (passphrase), `.dev.vars`, `private/` are git-ignored; never commit them.
- Checks: `npx tsc -b` + `npx vite build`; browser checks with puppeteer-core + Edge from the session scratchpad.
