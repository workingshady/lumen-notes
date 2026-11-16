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

## Design & dev mode
- Design source of truth: `design/handoffs/<date>/` (Claude Design handoffs; index `design/README.md`). New design rounds: prompt in `docs/design/CLAUDE_DESIGN_UPDATE_NN.md`, save the handoff as a new dated folder, implement to 100% identical, verify with `design/tools/shot.mjs`.
- Demo / dev mode: `?demo=1` → separate Dexie DB `lumen-demo`, clock pinned (`src/lib/demo-clock.ts`), never syncs. Dev panel: Ctrl+Shift+D or `?dev=panel` (scenarios + network/AI/upload/clock/conflict simulation, `src/lib/sim/`, docs `docs/DEV_SIMULATOR.md`). `?dev=reset` reseeds the design data. Design seed: `src/lib/demo.ts` (`docs/DEMO_DATA.md`).
- Backend is split per area: `worker/ext/{home,spaces,navigate,study,settings,workspace}.ts` registered in `worker/index.ts`. Phone-as-remote = Durable Object `SlidesRemote` (`worker/study-remote.ts`, binding REMOTE).
- Notes: title = first `# H1`; type/status/tags live in front-matter and sync both ways with the record (`src/lib/actions.ts` updateNote). Tasks support `[/]` doing (`tasks(md, { doing: true })`).
- Passcodes/secrets: `SETUP.md` (git-ignored); public guide `docs/PASSCODES.md`. Unlock = `/api/unlock` with D1 attempt limits; API tokens (`lmn_…`, hashed in D1) accepted by `auth`.
- Android: extra Capacitor plugins send-intent (share-to-Lumen, `ShareActivity`) and @capgo/capacitor-native-biometric (fingerprint lock via `src/lib/native-biometric.ts`). Build with `-Dorg.gradle.jvmargs=-Xmx1536m` on this PC.

## Learning paths & project hub
- Learning path = note type `path` (`src/lib/path.ts` parse/build/mutations, `src/views/PathView.tsx`). Body: front-matter `courses: [...]` (space names or roadmap note titles), `## Stage`, `- Concept = Alias | Alias`, sub-lines `resource:` `note:` `review: date interval` `done:`. Course roadmaps stay the source of truth for topic status.
- Project hub = `src/views/ProjectHub.tsx` on Project spaces, logic in `src/lib/project.ts`, doc templates in `src/lib/project-templates.ts`. Docs are notes with front-matter `doc:` + `docstatus:`; cards are checkbox lines with markers `> / ? x -`; requirements are `- REQ-n (must) …` lines. Links live in `space.props.links` (JSON). No VCS integration by design.
- When editing files from scripts, never let `\b` become a literal backspace (0x08): a regex silently broke that way once. Prefer the Edit tool for regex-heavy lines.

## Rules
- All writes go through `save()/patch()` in `src/lib/db.ts` (sets `dirty`, `updatedAt`). Never write Dexie tables directly for synced kinds.
- Never delete synced records: set `deleted: 1` (tombstones sync to other devices).
- Keep stored formats open: Markdown, JSON Canvas 1.0, .excalidraw. Don't add proprietary fields except under a `lumen*` key.
- Arabic + English: block elements get `dir="auto"`; keep `unicode-bidi: plaintext` rules.
- Commits: no Co-Authored-By trailer. `SETUP.md` (passphrase), `.dev.vars`, `private/` are git-ignored; never commit them.
- Checks: `npx tsc -b` + `npx vite build`; browser checks with puppeteer-core + Edge from the session scratchpad.
