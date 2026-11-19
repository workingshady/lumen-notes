# Dev simulator

Dummy data for every data type and scenario, plus network/runtime fault injection, so any situation can be
tested without touching real notes.

Everything runs in **demo mode**: a separate IndexedDB database `lumen-demo` (`src/lib/db.ts` `DEMO`), the clock
pinned by `src/lib/demo-clock.ts`, and sync disabled (`src/lib/sync.ts`). Demo data never syncs and never
touches the real `lumen` database.

## Opening it

| How | What happens |
|---|---|
| `?demo=1&dev=panel` | Switches to demo mode (other URL params survive the reload) and opens the panel |
| `?dev=panel` | Opens the panel on load (in real mode it only offers "Enter dev mode") |
| **Ctrl+Shift+D** | Toggles the panel anywhere (listener registered in `src/main.tsx`) |
| `openDevPanel()` | Exported from `src/views/DevPanel.tsx` (also `closeDevPanel`, `toggleDevPanel`) |
| `?demo=0` | Leaves demo mode |
| `?dev=reset` | Escape hatch (demo mode): forgets scenario, faults, clock and UI state, wipes notes and reseeds the design sample before the UI reads anything |

`main.tsx` renders `<DevPanel/>` in its own React root (`#dev-panel-root`) so it works on every screen,
including the Welcome flow. Mounting another `<DevPanel/>` (e.g. in `App.tsx`) is harmless: only the first
mounted instance renders.

## Files

| File | Role |
|---|---|
| `src/lib/sim/index.ts` | Scenario registry (`SCENARIOS`), `seedScenario(db, s)`, `currentScenario()`, `tableCounts(db)` |
| `src/lib/sim/kit.ts` | Record builders (`note`, `space`, `folder`, `card`, `version`, `session`, `attachment`), seeded PRNG, clock helpers, real media blobs (PNG via canvas, WAV, PDF, SVG), `writeVault()` |
| `src/lib/sim/content.ts` | Kitchen-sink Markdown, Mermaid gallery, slides, roadmap, JSON Canvas and Excalidraw bodies |
| `src/lib/sim/scenarios-a.ts` | empty, starter, showcase, spaces, study |
| `src/lib/sim/scenarios-b.ts` | big vault, sharing, edge cases, conflicts |
| `src/lib/sim/scenarios-slides.ts` | Slides lab: one deck per Slides capability + edge-case decks, real PNG/SVG/WebM/WAV/PDF attachments |
| `src/lib/sim/faults.ts` | Fault state (`lumen.sim.faults` in localStorage) + `simApi()` / `simSync()` hooks |
| `src/lib/sim/hooks.ts` | Dexie middleware for upload faults, `simulateConflict()` |
| `src/lib/demo.ts` | Original design seed (`seedDemo`, `DEMO_NOW`, `DEMO_SETTINGS`, `DEMO_IDS`): the "design" scenario |
| `src/views/DevPanel.tsx` | The panel |

## Scenarios

Loading a scenario wipes the demo tables, seeds, applies `DEMO_SETTINGS`, sets the landing view and reloads.
The choice is remembered in localStorage (`lumen.sim.scenario`), so the app's own "Reset" (demo badge) and
"Reset demo DB" in the panel reseed the **current** scenario. All seeds are deterministic and timestamps are
relative to the (pinned) clock at seed time.

| Id | Name | What it contains | Counts (spaces incl. Inbox / notes / cards / sessions / versions / files) |
|---|---|---|---|
| `design` | Design sample (default) | The Claude Design handoff data, unchanged (`seedDemo`). See `docs/DEMO_DATA.md` | 10 / 263 / 125 / 144 / 23 / 7 |
| `empty` | Empty / brand-new user | Only the Inbox. `lumen.welcomed` is cleared so the Welcome flow runs; every list, Home card, Review, Graph, Calendar, Trash shows its empty state | 1 / 0 / 0 / 0 / 0 / 0 |
| `starter` | Starter | A course (with folder + roadmap) and a project; one note of every type: note, lesson, journal, flashcards, slides, post (published), canvas, whiteboard, roadmap, MOC, plus a task list | 3 / 11 / 4 / 2 / 0 / 0 |
| `showcase` | Every type showcase | **Kitchen sink** lesson: headings 1-6, nested lists, tasks overdue / yesterday / today / tomorrow / next week / far future / doing `[/]` / done / no date / nested, aligned table (+ Arabic row), footnotes, KaTeX inline + block + aligned + broken, all 27 callout types, folded `-` and open `+` callouts, nested callout, 14 code languages, inline mermaid, fenced `canvas`, `query` block, wiki links existing / alias / heading / missing / embed, nested + Arabic tags, YouTube (watch + youtu.be with `t=`), Vimeo, mp4, mp3, PDF, autolink card, bare-URL card, real attachments (PNG, SVG, WAV, PDF, CSV) + a missing one, Arabic/English mixed paragraphs, 270-char word, very long URL and line, emoji incl. ZWJ/flags, flashcards. **Mermaid gallery**: flowchart, sequence, class, state, ER, journey, gantt, pie, quadrant, requirement, gitGraph, C4, mindmap, timeline, sankey, xychart, block, packet, kanban, architecture, radar, treemap, zenuml (expected error: needs a plugin) and an invalid diagram. Plus front-matter of every value shape, 4 journal days, flashcards (one-line, multi-line `?`, math, Arabic, bulleted), slides deck (notes, math, code, mermaid, image, Arabic, table), published + draft post, JSON Canvas with every node type / colour / edge end / background group, Excalidraw whiteboard with every element type + sticky + frame, roadmap, MOC, all-Arabic note. Cards cycle through all 6 SRS states | 2 / 18 / 10 / 2 / 2 / 5 |
| `spaces` | All spaces & kinds | Project with milestones roadmap, overdue project, area, course with roadmap (done / learning / skipped / locked topics; modules overdue, due today, upcoming; missing linked note), empty course, resource, archived archive-kind space, archived project, Johnny-Decimal area (`11 Finance` / `11.01 Taxes` / `11.10 …`), folders nested 4 levels deep, folder colours | 10 / 18 / 6 / 0 / 0 / 0 |
| `study` | Study heavy | 24 decks × 25 + a 120-card Japanese deck = 720 cards; ~18% new, 6% learning, 22% due, 42% later, 7% lapsed, 5% suspended. 365 days of sessions: 23-day current streak, a 64-day best streak, gaps of 1-30 days, 1-4 sessions per day, some without a note | 3 / 25 / 720 / ~456 / 0 / 0 |
| `big-1k` | Big vault · 1k | 1,000 notes across 12 spaces / 60 folders (some nested), 3-8 wiki links each with hubs (dense graph), tasks, flashcards, posts; 2 canvases with 500 nodes / 700 edges; 2 notes of 50,000 words; 10 notes × 40 versions; a year of sessions | 13 / 1,004 / 338 / ~283 / 400 / 0 |
| `big-5k` | Big vault · 5k | Same with 5,000 notes (seeding takes a few seconds) | 13 / 5,004 / 1,692 / ~277 / 400 / 0 |
| `slides` | Slides lab | Space "Slides lab" with 19 decks; each first slide lists what to check. **Capabilities**: 01 basics (separators, kicker, comma title break, bullets / ordered / text auto layouts, `Note:` / `Notes:`, `---` inside a code fence, task list), 02 every `<!-- layout: -->` (title, section, default, center, two-cols ± split / markers, image-left/right ± `split:` / `image:`, cards numbered / from `###` / from list, stat, quote, full, blank) + every alias + `_layout` + unknown name + overflowing columns, 03 `class: invert` carry / `_class: accent` / reset / `align: left` / `bg:` / Marp `![bg]` `![bg left:40%]` `![bg right]` / `class: left`, 04 front-matter defaults (`layout`, `class`, `align`, `paginate`, `theme`), 05 `::: box` (card, center, rotate, z, id, h=auto, out-of-range / non-numeric values, unclosed) for Arrange mode, 06 code (6 languages, 60-line block, 300-char line) + KaTeX (inline, display, aligned, matrix, broken), 07 Mermaid (diagram layout + caption, full layout, with text, 30-node chart, invalid), 08 callouts (incl. folded), `:::` panels / columns / tabs / expand, tables (small, 12-column, 25-row, `{.compact}`), footnotes, tags, wiki links (existing / alias / heading / missing), `![[Note]]` + `![[Note#Heading]]`, attachment link, 09 media (PNG, SVG, URL image, WebM video, WAV audio, PDF attachments; YouTube watch + youtu.be `t=`, Vimeo, mp4 / mp3 / PDF URLs, autolink card, bare URL card), 10 mixed media (several players per slide, media in columns / cards / side / over background), Arabic RTL deck (every layout in Arabic, mixed bidi, Arabic notes), 00 kitchen sink (one slide per feature). **Edge cases**: 11 one slide, 12 80 slides (jump / overview / thumbnails), 13 4000×3000 / 300×3000 / 3000×200 PNGs in every placement, missing attachment, broken URL, empty `att:`, 14 wall of text / 40 bullets / long heading / 280-char word / long URL / overflowing center + cards / long notes / emoji, 15 empty slides and odd separators, 16 doc → deck (a lesson without separators: auto layout + "Save as deck"), 17 implicit deck (type note with `---`). Plus a "start here" index and a snippets note for transclusion. Seeding records a 2 s WebM with MediaRecorder (≈2 s) | 2 / 21 / 0 / 0 / 0 / 10 |
| `sharing` | Sharing & blog | Shared course space (with a private prop that must not leak) and shared project space; shared lesson, canvas, deck; a private note in a shared space; 6 published posts (slugs, excerpts in props + front-matter, tags, Arabic, very long title, no excerpt, cover image); duplicate slug; unpublished drafts (with and without slug) | 4 / 16 / 0 / 0 / 0 / 1 |
| `edge` | Edge cases & broken data | Canvas: invalid JSON, edges to missing nodes + self-loop, duplicate ids / negative size / NaN position / unknown node type / missing id / far-away node / empty file / `javascript:` URL / non-array edges, empty body, JSON array. Whiteboard: invalid JSON, empty. Invalid / unknown / empty Mermaid. Front-matter: unclosed, malformed values, front-matter only. Titles: empty, whitespace, 3× duplicate + case duplicate, 480 chars, zero-width chars, RLM/RLO/ALM marks, emoji ZWJ. Placement: deleted folder, missing folder, missing space, deleted space, orphan folder, folder in missing space, empty folder name, space with missing roadmap id / invalid colour / bad dates. 6 trashed notes (every type). Missing attachments (no meta, meta without bytes, empty id, broken URL). XSS strings. Impossible task dates, unknown task marker. Cyclic roadmap prerequisites, empty roadmap. Malformed flashcards. Unknown note type. 200k-char single line. Future and epoch-0 timestamps. Non-string props, odd tags, undefined folderId. Tombstones and orphans for versions, cards (incl. NaN due), sessions (0 min, 30 h), attachments; an orphan blob | 5 / 38 (+6 trashed) / 3 / 4 / 2 / 3 |
| `conflicts` | Conflicts & history | Note with 60 versions over 30 days (labels: "Other version · Pixel 8", "Before keeping the other version", "Restored from …", "First draft"), a note with unsynced local edits (`dirty: 1`), a remotely deleted note (tombstone), a note with no history. Opens on the history panel | 2 / 3 (+1 trashed) / 0 / 0 / 65 / 0 |

### Not seeded: folder parent cycles

A folder whose parent chain loops (A → B → A) freezes the app today: the parent walks in `src/lib/search.ts`
(folder names for search), `src/components/NoteView.tsx` (breadcrumbs), `src/lib/io.ts` (export paths) and
`src/views/GraphView.tsx` have no cycle guard. `moveFolder` in `actions.ts` prevents creating one locally, but
two devices moving folders into each other before syncing could still produce it. Add a visited-set guard
there, then add the cycle back to `seedEdge`.

## Network & runtime toggles (demo mode only)

Stored in localStorage `lumen.sim.faults`; they persist across reloads until "Clear all faults".
Outside demo mode every hook returns immediately (`SIM_ON` is false).

| Toggle | Effect |
|---|---|
| **Local (default)** | Original demo behaviour: sync status "local", nothing queued |
| **Online · synced** | Each sync round shows "syncing" for 0.4 s, then "idle" with `last = now`, 0 pending |
| **Offline** | Sync status "offline" with *Queued records* pending (0 = real count of dirty demo records). `navigator.onLine` reports false and an `offline` event fires (an `online` event fires when you leave this mode). API calls fail with "Failed to fetch"; link previews return nothing |
| **Sync error** | "syncing" for 0.9 s, then status "error" ("HTTP 500 (simulated sync error)") with N queued |
| **Slow sync** | "syncing" for *Slow delay* ms (default 6000) then "idle"; every API call is delayed by the same amount |
| **Upload failing** | Sync ends in "error": "Upload failed: lecture-07-attention.m4a" |
| **API 401 · signed out** | Every API call (except `/login`) throws `ApiError(401)` and clears the token like a real 401; sync shows an error "Signed out…" |
| **AI: Real / Mock / Quota / Error** | `/api/ai` and `/api/transcribe`: pass through; return a canned answer after 0.6 s; throw 429 "AI quota exceeded…"; throw 502 "AI service error…" |
| **Uploads: OK / Upload fails / File too big** | New attachments (paste, drop, file picker) are rejected when their bytes are stored (Dexie middleware on `blobs`), so the app's own error toast appears with "upload failed" / "is over 100 MB" messages; `PUT /api/att/*` also fails with 500 / 413 |
| **Clock** | −1 day, +1 hour, +1 day, +1 week, +30 days, custom date/time, reset to the design moment (Fri 13 Nov 2026 21:41). Stored as `lumen.sim.clock` and applied on reload, so due cards, overdue tasks, streaks and relative times all move. Seeded data keeps its timestamps: reload the scenario to re-seed relative to the new date |
| **Sync conflict** | "Incoming newer remote edit" / "Incoming older remote edit": saves a local edit on the open note (or the first note), then writes a copy from "Pixel 8 (simulated)" that wasn't based on it. The real conflict middleware (`ws-conflict.tsx`) keeps the newer one, stores the other in history and shows "Kept newer version · View other" |

## Database tools

- **Records**: live counts for spaces, folders, notes, trashed notes, versions, cards, sessions, attachments, blobs.
- **Reset demo DB**: reseeds the current scenario.
- **Export zip / Export JSON**: `exportVaultZip()` / `exportBackup()` from `src/lib/io.ts` over the demo database.
- **Exit dev mode**: `setDemo(false)`; back to the real database.

## Adding a scenario

Write `async (): Promise<Vault>` with the builders from `kit.ts` (`emptyVault()`, `note({...})`, `cardsFor()`,
`addFile()` for real bytes) and add an entry to `SCENARIOS` in `sim/index.ts` with a `ui` landing view.
Use a unique id prefix for records. `writeVault` adds the Inbox and writes everything with `dirty: 0`.
