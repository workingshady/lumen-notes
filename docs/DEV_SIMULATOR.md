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
| `slides` | Slides lab | Space "Slides lab" with 19 decks; each first slide lists what to check. **Capabilities**: 01 basics (separators, kicker, comma title break, bullets / ordered / text auto layouts, `Note:` / `Notes:`, `---` inside a code fence, task list), 02 every `<!-- layout: -->` (title, section, default, center, two-cols ± split / markers, image-left/right ± `split:` / `image:`, cards numbered / from `###` / from list, stat, quote, full, blank) + every alias + `_layout` + unknown name + overflowing columns, 03 `class: invert` carry / `_class: accent` / reset / `align: left` / `bg:` / Marp `![bg]` `![bg left:40%]` `![bg right]` / `class: left`, 04 front-matter defaults (`layout`, `class`, `align`, `paginate`, `theme`), 05 `::: box` (card, center, rotate, z, id, h=auto, out-of-range / non-numeric values, unclosed) for Arrange mode, 06 code (6 languages, 60-line block, 300-char line) + KaTeX (inline, display, aligned, matrix, broken), 07 Mermaid (diagram layout + caption, full layout, with text, 30-node chart, invalid), 08 callouts (incl. folded), `:::` panels / columns / tabs / expand, tables (small, 12-column, 25-row, `{.compact}`), footnotes, tags, wiki links (existing / alias / heading / missing), `![[Note]]` + `![[Note#Heading]]`, attachment link, 09 media (PNG, SVG, URL image, WebM video, WAV audio, PDF attachments; YouTube watch + youtu.be `t=`, Vimeo, mp4 / mp3 / PDF URLs, autolink card, bare URL card), 10 mixed media (several players per slide, media in columns / cards / side / over background), Arabic RTL deck (every layout in Arabic, mixed bidi, Arabic notes), 00 kitchen sink (one slide per feature). **Edge cases**: 11 one slide, 12 80 slides (jump / overview / thumbnails), 13 4000×3000 / 300×3000 / 3000×200 PNGs in every placement, missing attachment, broken URL, empty `att:`, 14 wall of text / 40 bullets / long heading / 280-char word / long URL / overflowing center + cards / long notes / emoji, 15 empty slides and odd separators, 16 doc → deck (a lesson without separators: auto layout + "Save as deck"), 17 implicit deck (type note with `---`). **Round 4 design samples** (Lumen 17): "Backprop for the study group" (12 slides, one per layout incl. `_class: accent`; A opens Arrange, O overview, phone remote), "Backprop, by hand" lesson (Slides opens the doc → deck preview with Split at H1 / H2 / ---; Focus read: outline drawer, highlighter, read aloud), "Training loop" `.mermaid` file (split view, viewer toolbar, Export). Plus a "start here" index and a snippets note for transclusion. Seeding records a 2 s WebM with MediaRecorder (≈2 s) | 2 / 21 / 0 / 0 / 0 / 10 |
| `sharing` | Sharing & blog | Shared course space (with a private prop that must not leak) and shared project space; shared lesson, canvas, deck; a private note in a shared space; 6 published posts (slugs, excerpts in props + front-matter, tags, Arabic, very long title, no excerpt, cover image); duplicate slug; unpublished drafts (with and without slug) | 4 / 16 / 0 / 0 / 0 / 1 |
| `edge` | Edge cases & broken data | Canvas: invalid JSON, edges to missing nodes + self-loop, duplicate ids / negative size / NaN position / unknown node type / missing id / far-away node / empty file / `javascript:` URL / non-array edges, empty body, JSON array. Whiteboard: invalid JSON, empty. Invalid / unknown / empty Mermaid. Front-matter: unclosed, malformed values, front-matter only. Titles: empty, whitespace, 3× duplicate + case duplicate, 480 chars, zero-width chars, RLM/RLO/ALM marks, emoji ZWJ. Placement: deleted folder, missing folder, missing space, deleted space, orphan folder, folder in missing space, empty folder name, space with missing roadmap id / invalid colour / bad dates. 6 trashed notes (every type). Missing attachments (no meta, meta without bytes, empty id, broken URL). XSS strings. Impossible task dates, unknown task marker. Cyclic roadmap prerequisites, empty roadmap. Malformed flashcards. Unknown note type. 200k-char single line. Future and epoch-0 timestamps. Non-string props, odd tags, undefined folderId. Tombstones and orphans for versions, cards (incl. NaN due), sessions (0 min, 30 h), attachments; an orphan blob | 5 / 38 (+6 trashed) / 3 / 4 / 2 / 3 |
| `conflicts` | Conflicts & history | Note with 60 versions over 30 days (labels: "Other version · Pixel 8", "Before keeping the other version", "Restored from …", "First draft"), a note with unsynced local edits (`dirty: 1`), a remotely deleted note (tombstone), a note with no history. Opens on the history panel | 2 / 3 (+1 trashed) / 0 / 0 / 65 / 0 |
| `r4-organize` | Organize & connect (round 4) | `src/lib/sim/scenarios-r4-organize.ts` (`seedR4Organize(v?)`: only **adds** records to the vault it is given, ids `r4o-`, so it composes into a bigger seed; merges its smart folders into an existing Inbox). Courses CS231n / CS224n / DL Spec. / Karpathy / fast.ai (design colours) + ML Foundations with folders 01–05; 16 lessons with `course`, multi-value `courses: [..]`, tags, `due`, `difficulty`, covers (`att:` images); base “Lessons by status × course” (Table, Board, Gallery, List, Calendar, By tag + By courses = notes in several groups) and an empty “New base”; “AI Engineer dashboard” (number ×3, ring, stackedBar, line, area, donut, heatmap, bar, table ×2, list over sessions / cards / path / notes / base); 14 smart folders (pinned, coloured, every operator, one empty); unlinked mentions of Attention (English + Arabic proclitics incl. stacked `وبال`, one ignored via `mentions-ignore`); shared tags, orphans, 3 broken links, a MOC; CS231n / CS224n / Karpathy roadmaps with branching `needs:`, implied links, `after:` / `related:`; learning path “AI Engineer path” (merged concepts, path-level needs, review dates); canvas “Transformer study map” (2 groups, 2 pinned cards, PDF highlight cards, PDF card, `.mermaid` card, link card, Arabic card); whiteboard “Transformer sketch”; `transformer-forward.mermaid`; 3 PDFs (one with highlights); 20 weeks of sessions; flashcards in every state | 7 / 50 / 18 / ~126 / 0 / 6 |
| `r4-study` | Study features (round 4) | `src/lib/sim/scenarios-r4-study.ts` (`seedR4Study(v?)`: only **appends** to the vault it is given, ids `r4s-` + the fixed-id Today plan log `lumen-study-plan`; review-log rows go into `Vault.reviews`, written by `writeVault`). 3 courses with roadmaps (Deep Learning Specialization with a `target`, NLP with Transformers, Arabic «النحو العربي»): done / in-progress / todo / skipped topics, 7 overdue `📅` topics in all three courses, `(needs: …)` chains, lesson notes with `duration`. Timer sessions for 10 weeks up to Tue, none Wed + Thu (2 missed study days on the design clock); every record is dated before today (streak moment on today's first activity). Plan log: 4 weekly goals, Mon/Tue done + skip + "later" items. Learning path "Transformers from zero": mastered concepts, an overdue revision (Gradient descent, 7-day step: masters on Got it), learning, unlocked-not-started (Mini-batch: test-out practice), locked concepts, an alias merge. ~60 flashcards: Q :: A, a multi-line `?` card, `{{c1::}}` / `{{c2::…::hint}}` clozes in lessons (incl. Arabic + math), `==x==` clozes in a flashcards note and a `cloze: true` note, plain `==highlights==` and `==x=={.hl-green}` that are not cards, 2 occlusion blocks on real PNG attachments (hide-one with a 2-box group, hide-all) + a bare image. Card records are simulated with the real FSRS scheduler (new = no record, learning, review due / not due, relearning, suspended) with ~290 review-log rows (~155 a day or more apart; outcomes from a memory 40 % stronger than the default weights, so Optimize lowers the log loss). PDFs: "Transformers study edition" (real 15-page PDF from `lib/demo-pdf.ts`: outline, 6 text highlights in 5 colours with comments / tags + 1 area highlight with a PNG crop, read to p. 6 = Continue pill), "Exam answers (locked)" (RC4-encrypted, user password `lumen`), "Lecture 4 handout (scanned)" (2 JPEG-only pages), "FSRS cheat sheet" (100 % read); back-links to highlights in "Attention notes"; canvas "Attention map" (highlight card + PDF card). "Backprop video lecture": YouTube URL + `[m:ss]` chips, a real 10 s MP4 (canvas + MediaRecorder, H.264 in Chrome/Edge; WebM where MP4 recording is missing, which then has no duration header) showing a big running clock, `[0:05](#video-2)` chips, a `#video-3` chip with no player (grey), a flashcard with a timestamp, an escaped `\[12:34]`. Seeding takes ~11 s (the video is recorded in real time). Lands on Today | 4 / 22 / ~50 records (+~10 new) / ~85 / 0 / 8 |

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

## Round 4 · Write, present & share (`r4-write`) and Everything (`r4-all`)

| Id | Name | What it contains | Counts (spaces excl. Inbox / notes / cards / sessions / versions / files) |
|---|---|---|---|
| `r4-write` | Write, present & share (round 4) | `seedR4Write(v)` in `src/lib/sim/scenarios-r4-write.ts` (ids `r4w-`, add-only: adds to the vault it is given, never clears). **Writing studio**: "Read mode showcase" (status pills in every colour, `[[toc]]`, columns 2 / sidebar 30% / cards / divided 240 px, tabs, expand, 6 `:::` panels, 7 callouts incl. folded, aside, center, `::: wide` table, `::: full` image, a 4-row table with a `Table:` caption, a 24-row `{.wide .compact}` table, an Arabic `{.plain}` table, includes `![[Note#Heading]]` + `![[Note#^id]]`, block links, `^id` anchors, highlights in 5 colours + a comment footnote, link card, SVG, Mermaid, Arabic section, tasks), "Chain rule (source)" (blocks with `^ids`, one without), "Block refs & embeds across notes" (block / alias / heading / missing-block links, embedded block, section, whole note, nested include), "Every / block" (generated from `lib/slash.ts`: one heading per "/" command, rendered), "Editor playground" (blocks to drag / turn into / multi-select, block-ref autocomplete, paste-menu text + a lone link, Arabic block), "Focus: reading the backprop paper" (outline, saved highlights, Arabic paragraph for read aloud), "Read · wide page" / "Read · full page" (`width:` front-matter), an empty folder. **Talks & decks**: one deck per layout (title, section, default, center, two-cols, image-left, image-right, cards, stat, quote, full, blank; with invert / accent / split variants), "Every layout in one deck" (speaker notes), "Arrange workspace" (`::: box` cards, stacked + rotated), "Backprop for beginners (doc → deck)" lesson, an Arabic deck. **Deep Learning notes (shared)** course: share token `r4wShCourse`, roadmap, shared lesson `r4wShNote1`, deck `r4wShDeck1`, flashcards `r4wShCards1`, canvas `r4wShCanv1`. **Blog**: 3 published posts (one Arabic, one also shared `r4wShPost1`), a draft. **Lumen Reader (project)**: PRD (approved, REQ-1…5 must → wont), RFC in review, ADR approved + superseded, spec draft, rejected draft, action plan with every card marker (`>` `␣` `/` `?` `x` `-`, one overdue, epics, owners, estimates), meeting, diagram, links. Icon spaces (glyph, `shape-hex`, `initials:QA`, Arabic initials `initials:عر`), "Empty course" (no roadmap, no notes). 2 versions on the showcase, 5 cards (3 due → favicon badge), sessions on the last 3 days but not today (streak moment on the first study activity). Lands on the showcase in Read | 9 / 45 / 5 / 3 / 2 / 6 |
| `r4-all` | Everything (round 4) | One click for every round-4 feature: `seedR4Study` + `seedR4Organize` + `seedR4Write` add to one vault, then `seedProject` (Software project hub) is merged in, first id wins (the Inbox keeps the Organize smart folders). `seedPaths` ("Learning paths") is deliberately left out: Organize reuses its course and lesson titles (CS231n, Backpropagation, Gradient descent…) and `[[links]]`, bases, dashboards and path courses resolve by title, so two copies would collide; Organize's "AI Engineer path" over branching course roadmaps covers learning paths. Lands on Home, All spaces | see the three scenarios + project hub |

**Load Everything**: open `http://localhost:5330/?demo=1&dev=panel` (or Ctrl+Shift+D) → Scenarios → **Everything (round 4)** → Load. The app reloads onto Home. "Reset" on the demo badge reseeds it.

### Checklist · Write, present & share (load `r4-write`, or `r4-all` and pick the space)

| Feature | Where to click | What you should see |
|---|---|---|
| New… menu | Note list header **+** (desktop) / tab bar **+** (phone) | Popover (sheet "New…" on phone): New note · New dashboard · New base · New PDF note · New canvas or whiteboard · New learning path · From template. PDF opens a file picker, then the reader; dashboard / base open in their own full-height view |
| Palette commands | Ctrl/⌘K, type `>new` or `today` | "New dashboard", "New base", "New PDF note", "New smart folder" (opens the smart-folder editor), "Open Today" |
| "/" menu | Editor playground › Edit, new line, type `/` | Grouped menu (Basic … Advanced), Recent after first use; `/kanban` → "No block called “kanban”" + suggestion + Search all commands; phone: bottom sheet with a search field |
| Insert gallery | Note ⋯ › Insert… | 15 layout thumbnails in three rows, hover preview |
| Block handles | Hover "Second paragraph" | ⋮⋮ handle; click → Turn into grid + Duplicate / Copy link to block / Move / Delete; drag → accent drop line; Shift-click two handles → "2 blocks selected · Delete · Move · Turn into" |
| Block refs | Type `[[Chain rule (source)#^` | Block list with `^id` (green) or "add id"; picking a block without an id writes one into the source note |
| Embeds / includes | "Block refs & embeds across notes" › Read | Links read "Chain rule (source) › ^chain-def"; dashed include frames with source chip + **Go to source →** (opens the note at that block, amber wash) |
| Paste menu | Copy the long Backpropagation paragraph, paste | Keep · Clean up formatting · As quote · As link card · Summarize · Make flashcards; a lone link → Preview card · Embed · Plain link |
| Read page width | Showcase header Fixed / Wide / Full; "Read · wide page", "Read · full page" | 680 / 920 / pane − 72 px; choice written to front-matter `width:` |
| Read blocks | Showcase, scroll | Columns (stack on phone), cards, divided, tabs, expand, panels, callouts (folded one opens), aside as a margin note beside the next paragraph (in the flow on narrow panes / phone), centred line, wide table + full image breaking out |
| Tables | Showcase › Tables | "Optimizers on MNIST · 4 rows" caption; 24-row table: Filter, sort by header, full screen, sticky first column; Arabic table reads right-to-left |
| Status pills, toc | Showcase top | Seven coloured pills; Contents box with the section being read in bold (Arabic note: the box reads right-to-left) |
| Focus Read / Write | "Focus: reading the backprop paper" › Focus | 640 px column, outline drawer (O), select text → highlighter bar (5 colours · Note · Card), Read aloud with the sentence underlined; Write = typewriter |
| Slides | Talks & decks › any "Layout · …" deck › Slides | Each layout + variants; O overview, P presenter, number + Enter jumps, B black; "Arrange workspace" › A: rail, layout picker, Normal / Invert / Accent, drag / resize boxes; the doc → deck lesson › Slides opens the preview dialog (Split at H1 / H2 / ---, Save as deck); phone remote needs a signed-in Worker |
| Project hub | Lumen Reader (project) | Health badge "Behind" with reasons, links row, Overview / Docs (every status) / Board (6 columns) / Requirements (MoSCoW + traceability) / Timeline / Diagrams / Assistant (AI mock in the Dev panel) |
| Sharing | Shared lesson › Shared, or `/s/r4wShCourse?demo=1`, `/s/r4wShNote1`, `/s/r4wShDeck1` | Share sheet works in demo (links served from the demo DB); public course page with progress ring, roadmap, notes, graph; never shows the `secret` space prop |
| Blog + OG | `/blog?demo=1`, `/blog/backprop-one-neuron`, `/blog/backprop-arabic` | Index with tags and excerpts (no `:::` / `<!-- -->` / `^id` noise), post pages, Arabic post right-to-left; OG image + tags come from the Worker (`/api/og/…`) when deployed |
| Navigation | Open several notes, then ← / → in the header; long-press ← | History list; breadcrumb space → space page, folder → its list; when the one-row header has no room (e.g. a Diagrams tab) the breadcrumb moves to its own row instead of being cut |
| Icons / empty states | Spaces "Icons: shape + initials", "QA initials", "ملاحظات عربية"; "Empty course" | Glyph / shape / initials tiles (space ⋯ › Change icon… opens the picker); empty course: "This course has no roadmap." + Build roadmap / Generate with AI |
| Moments, favicon | Start a timer or review a card (first activity today) | Streak moment; violet dot on the favicon while cards are due |
| Accounts / devices / unlock | Settings › Sync | Devices (this device + "Demo mode" row), Accounts on this device, App lock; the unlock lockout needs the Worker (`/api/unlock`) and is not simulated in demo |
| Settings | Settings › Reading / Review / Diagrams / Study plan / Developer | Each page renders; Developer › simulator drawer |
| Phone More | Phone tab bar › More | Profile card, Today / Daily note / Tasks / Calendar / Graph / Canvases / Learning paths, "Spaces, folders & tags", then settings |

## Checklist · Organize & connect (round 4)

Load **Organize & connect (round 4)** in the Dev panel (`?demo=1&dev=panel`). Desktop 1440×900 and phone 412×915;
screenshots of every step: `design/verify/r4/features-organize/`. Design artboards: BaseDesk / DashDesk (Lumen 18),
Lumen 20b (smart folders, mentions), ConnGraph + PathDesk (Lumen 14b), CanvasBoard / WhiteboardBoard (Lumen 07),
Lumen 17 (diagram files), Lumen 20 (Ask).

| Feature | Where to click | What you should see |
|---|---|---|
| Base · Table | Lands on “Lessons by status × course” | 16 notes · filtered, Filter 3 / Sort 1 / Properties 6, status pills, course bars in the course colour, tag chips, “Due ↑” sorted header, Cards column (Backpropagation 3) |
| Filter rows + groups | Filter | *Where status is any of learning × to revise × todo × mastered ×* (chips wrap), *and tags does not have tag archived*, This view / All views, + Add group (any of); phone: a sheet, the value wraps under the operator |
| Cell editors | Click Dropout’s status cell | Glyph menu Todo ✓ / Learning / To revise / Mastered / No status; ↓ Enter writes `status: learning` |
| Board + drag + undo | Board tab, drag Attention from Todo to Learning | Tilted amber card, dashed slot; toast “Moved from Todo to Learning · Undo”; Undo restores `todo` |
| Multi-group notes | By tag (board) / By courses (table) | “16 notes · 7 shown in several groups”; cards “also in #llm”; dragging Attention #llm → #cv: “Moved from #llm to #cv, still in #nlp” |
| Gallery / List / Calendar | Tabs | Covers from `att:` images (Gradient descent, Attention, Convolution) else stripes; list grouped by course; month grid by `due`, “1 note without a due” |
| Templates picker | Open “New base” (front-matter + H1 only) | New from template: 6 cards, Cancel / Create base |
| Dashboard | Open “AI Engineer dashboard” | Every tile type with real numbers; donut “84 h studied” + legend in whole hours; range “Last 8 weeks” writes `range:`; the Table toggle swaps a chart for rows |
| Edit layout / Add tile | Edit layout → drag a tile, drag its amber corner; Add tile → Source → Chart → Fields | `layout:` changes in the YAML; 3-step dialog with live preview; picking Donut after a date chart slices by a category |
| Smart folders | Sidebar › Smart folders | Pinned “#llm learning”, “To revise” first; live counts; “Lessons due this week” list with the chips header (scrolls when long), Edit opens the editor (“N notes match right now”, operator chips, colour, pin); “Nothing matches” = empty state; Ctrl K + `tag:#cv -status:mastered` → *Save search as smart folder* / *Save as base*; phone folders sheet |
| Unlinked mentions | Attention › right panel › Links | Linked mentions 5; Unlinked: Arabic notes (والانتباه, بالانتباه, للانتباه, وبالانتباه), Week 6 log, Transformer block, RAG pipeline; “1 ignored note” (Week 5 log); Link / Link all (confirm) → toast Undo restores; Ignore adds the note to `mentions-ignore` |
| Graph | Sidebar › Graph | Display panel; Tags as nodes (# rings), Shared tags (dotted) with counts; Checks: 18 orphans, 3 broken links (clickable list); Tidy up → preview banner (moves N · crossings before → after) → Apply → Undo; phone: Display sheet |
| Path + prerequisites | “AI Engineer path” › Graph | Step columns, Display: Prerequisites 18 / Recommended 2 / Related 1 / Added by you 2 / Implied 4 hidden, Group by stage, Bundle; Tidy up preview → Apply → Undo |
| Skill tree | Space CS231n › Skill tree | Branching tree, implied Neural networks → Optimization hidden, dashed `after:`, dotted `related:` |
| Canvas | “Transformer study map” | Groups Read / Understand, amber pin dots on Attention + Transformer block, PDF card (“3 highlights”), 2 highlight cards with page chips, `.mermaid` file card with its back-link; ⇧T → “2 pinned cards kept”, Apply, Undo |
| Whiteboard | “Transformer sketch” | Shapes, frame “Transformer block”, sticky, Arabic text; toast “Added 10 elements from the API” on first open |
| Diagram file + export | `transformer-forward.mermaid` › Export | Split view, “From Transformer block › Forward pass”, Export dialog SVG / PNG / JPEG / WebP |
| Ask your vault | Attention › AI › Ask vault; Dev panel AI = Mock, then Network = Offline | Mock: streamed answer with ¹ ² ³ citations + source cards; Offline: “Ask needs a connection.” + the passages |
| Big vault progressive | Use the `big-1k` scenario | Not in this seed (it needs 700+ notes) |

## Checklist · Study features (round 4)

Load **Study features (round 4)** in the dev panel (`?demo=1&dev=panel`; seeding takes ~11 s because it records the video). Clock: the design moment, Fri 13 Nov 2026. Verified shots: `design/verify/r4/features-study/`.

| Feature | Where to click | What you should see |
|---|---|---|
| Today · sections | Lands on Today | Reviews (cards due, ~8 min) · Continue "Backpropagation" (accent border, filled Start: the last timer session) · New lessons 1 of max 2 "Regularization · Moved from Tue · overdue 1 day" · Revise & practice "Gradient descent · Revision overdue 2 days" + "Practice: Mini-batch gradient descent · Test out" · If you have time (Self-attention 70 min, Mini-batch, the Arabic lesson). Planned 57 of 60 min, 0 day streak |
| Missed days | Banner on Today | "You missed 2 study days. 7 topics are overdue. Spread them over the next 4 study days?"; Before (7 overdue, red) / After bars |
| Reschedule | Adjust → − / +, then Accept new dates | Every move listed (course, old → new date, "after its prerequisite"); Accept writes the `📅` dates into the three roadmaps, toast "Rescheduled 7 topics", banner gone; Not now hides it for today |
| Skip / Tomorrow / Done + Undo | ⋯ on a row (phone: tap the row) | Skip → "Skipped or moved · 1 Show" → Undo; Mark done ticks the topic `[x]` in its roadmap, toast with Undo |
| Week view + goals | Right column | M / T bars (green done, dashed goal); 4 goals: 4 lessons · Deep Learning Specialization 1 / 4, 150 cards, 300 minutes, 3 revisions (edit in Settings › Study plan) |
| Revision → mastered moment | Start on Gradient descent → Got it | Sheet with notes; Got it moves `review:` to +14 days and the "Gradient descent · mastered" moment flashes (from any view: `useAllPathMoments` in App.tsx) |
| Test out | Start on Practice: Mini-batch | "Test out: Mini-batch gradient descent · 5 questions from 1 note"; offline it uses the note's flashcards; ≥ 80 % marks it learned → "Adam is open" unlock moment |
| Review · states | Sidebar › Review | New cards first (Arabic deck), then learning / relearning / due review cards; S suspends (toast), U undoes the last grade (its review-log row is marked deleted) |
| Grade previews | Space on a card | Again 1m · Hard 6m · Good 10m or 2d · Easy 4d style previews from FSRS |
| Streak moment | Grade the first card of the day | "19 days in a row · Today counted after 1 review" |
| Workload + states | Settings › Reading › Review | 30-day chart + dashed 0.95 line; chips New / Learning / Review / Relearning / Suspended with counts (New = flashcards that have no record yet) |
| Optimize from history | Review › Advanced › Optimize from history | "≈290 reviews logged · ≈155 a day or more apart" → "Fitted to … reviews: prediction error (log loss) 0.378 → 0.344", Scheduler "FSRS-6, fitted to …"; Use defaults resets |
| Cloze | "Attention notes" (Read), then its Review | Dotted underlines; the `==reading highlight==` and the green highlight make no cards; front "Attention is a […] of the values…", back with the answers boxed; "Positional encoding" (`cloze: true`) and "Deep learning cards" turn `==x==` into cards |
| Image occlusion | "Image cards: transformer block" → Read / Review | Outlined boxes + "6 cards · Hide one, show others"; review hide-one (target solid accent; the two Add & norm boxes are one card) and hide-all (all solid); Edit boxes chip in Edit; "Make image cards" on the bare image line |
| PDF reader | "Transformers study edition" | Continue pill "p. 6 (40%)", Pages / Outline (Abstract, 1 Introduction …) / Highlights rail, margin markers, Find "softmax" → 1 of 8 |
| Text + area highlights | Select text → a colour; Area → drag a box | A new `- green · p. 1 · … ^hl-…` line in the note; the area box waits for a colour / Note / Card |
| Highlight → card / note / canvas | Click a margin marker → Card / Note / Canvas | Card sheet (Front = quote, Back, "Transformers study edition: cards"), toast "Card added … Open"; Note → "Note created … Open"; Canvas picker |
| Highlights panel | ⋯ → Highlights panel | "Highlights · 7" by page: colour squares, tags, comments, an area row, Make a note from all highlights, Export as Markdown |
| Back-links | "Attention notes" → a "Transformers study edition · p. 4" chip | Opens the reader at p. 4 and flashes the highlight |
| Password PDF | "Exam answers (locked)" | Lock card; a wrong password → "That password didn't work. Try again."; `lumen` opens it |
| Scanned PDF | "Lecture 4 handout (scanned)" | "Scanned PDF: no text to select. Use Area …" pill |
| PDF library | Space "Study reading" → PDFs | 4 PDFs with % read and highlight counts (40 % · 7, 0 %, 0 %, 100 %) |
| Video timestamps | "Backprop video lecture" (Read) | YouTube thumbnail + chips 0:45 / 3:10 / 8:24; MP4 chips 0:02 / 0:05 / 0:08 seek the uploaded video (the clock in the frame shows the time) and the playing chip gets a ring; 0:30 (`#video-3`) is grey "No video at this position in the note" |
| Speed + dock | Split view: the video bar | 1× pill (0.75–2×), Timestamp (Alt+T), Flashcard at this moment, Pause while typing; Dock → the player above the editor with a Video 1 / 2 select |
| Canvas | "Attention map" | Highlight card with a yellow edge + page chip, PDF card "7 highlights · Open at p. 6" |
