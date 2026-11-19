# Lumen: Feature Inventory (researched)

Lumen is a **local-first study notebook + personal blog**. You write lessons and notes in Markdown, organize them in folders, tags, links, a graph and canvases, review them with flashcards, present them as slides, and publish selected notes as a public blog. It runs as a website (Cloudflare Workers), installs as a PWA, and builds into an Android APK from the same code (Capacitor).

Status legend: ✅ shipped in v0.1 · 🟡 partial · 🔜 planned

Research basis: Obsidian (plain Markdown files, `[[links]]`, backlinks, graph view, Canvas/JSON Canvas), Notion (databases, templates, toggles = progressive disclosure, slash commands), Confluence (page tree, templates, page history with diff + restore-as-new-version), spaced-repetition tools (FSRS / SM-2, cards from Markdown), local-first editors (CodeMirror 6 + IndexedDB + KaTeX + Mermaid). Sources at the bottom.

---

## 1. Writing & rendering
| Feature | Status | Notes |
|---|---|---|
| Markdown editor (CodeMirror 6), syntax highlight, line wrap | ✅ | |
| GitHub-flavoured Markdown: tables, task lists, strikethrough, footnotes | ✅ | |
| LaTeX math: inline `$…$` and block `$$…$$` (KaTeX) | ✅ | |
| Mermaid diagrams via fenced code blocks | ✅ | flowchart, sequence, class, state, ER, gantt, mindmap, timeline |
| **Diagram files** (`.mermaid`, note type `diagram`): source + live preview, zoom/pan viewer, saved to a `diagrams/` folder, a note's Mermaid block → diagram file → canvas file card (links both ways), Diagrams tab per space, Settings › Diagrams (default theme, hand-drawn look, export defaults, open .mermaid in, max render size, folder, auto-save, AI names); round 4 viewer: dot grid, − % + · Fit · Copy SVG, drag to pan, Ctrl+wheel zoom | ✅ | |
| **Export dialog** for diagrams, whole canvases and the graph: SVG / PNG / JPEG / WebP with scale, quality, background, theme, padding; copy image / SVG / source | ✅ | |
| Code highlighting (highlight.js, 190+ languages) + copy button | ✅ | |
| Obsidian-style callouts `> [!note]`, `[!tip]`, `[!warning]`, `[!example]`, `[!question]` | ✅ | foldable with `[!note]-` |
| Wiki links `[[Note]]`, `[[Note\|alias]]` + backlinks panel | ✅ | |
| Inline `#tags` + front-matter tags | ✅ | |
| Embedded canvas in a note (fenced `canvas` block with JSON Canvas) | ✅ | |
| Formatting toolbar (bold, italic, heading, list, task, quote, code, math, mermaid, table, link) | ✅ | mobile: sticky above keyboard |
| Slash commands `/` in editor | ✅ | see 3b |
| **Block editing** (`lib/blocks.ts`, `editor-blocks.ts`): ⋮⋮ handle on every top-level block (drag to move with drop line, click for menu, Shift/Ctrl-click or long-press to multi-select); **Turn into** text/H1–H3/lists/quote/code/toggle/callouts; duplicate, move (Alt+↑/↓), delete, Mod+Shift+D; RTL-aware; one undo step per action | ✅ | |
| **Block references**: `^id` anchors (Obsidian rules), `[[Note#^id]]` jumps + highlights, `![[Note#^id]]` embeds one block, `[[Note#^` autocomplete adds missing ids, Copy link to block | ✅ | |
| **Paste menu** (> 200 chars or inline URL): Keep · Clean up formatting · As quote · As link card · Summarize with AI · Make flashcards with AI | ✅ | |
| Images & files: paste, drag-drop, pick, or phone camera → stored on device (IndexedDB) and uploaded free to **Cloudflare D1 in 1.5 MB parts** (max 100 MB/file, Range streaming for video); `![](att:id)` links work offline and online | ✅ | |
| Voice notes → text (Workers AI Whisper, Arabic + English) | ✅ | |
| Properties panel (front-matter key/value: source, course, due, url…) | ✅ | |
| Query blocks (Dataview-lite): ```` ```query tag:#ml type:lesson ```` ```` renders a live list/table | ✅ | |
| Word count, reading time, outline (table of contents); in Read the title opens the page (R4-16J…L, P4) and the "Type · status · N min read · Updated" row closes the note | ✅ | |
| New visual workspace chooser (R4-17 A5): desktop dialog with previews; phone "New…" sheet opened by the tab bar + on the Canvases & whiteboards list (+ on Learning paths opens New learning path) | ✅ | |

## 2. View modes (progressive disclosure)
| Mode | Status | What it shows |
|---|---|---|
| **Edit** | ✅ | editor only |
| **Split** | ✅ | editor + live preview (desktop default) |
| **Read** | ✅ | rendered note, typographic reading layout (mobile default); page width Fixed / Wide / Full per note (↔ in the header, front-matter `width:`); wide tables and `::: wide` / `::: full` blocks break out of the text column |
| **Page layout blocks** | ✅ | `::: columns` + `::: column 30%` (2, 3, main + sidebar; stack on narrow screens; `{.cards}` `{.divided}`), `::: tabs` (each heading = a tab), `::: expand Title`, panels `::: info/note/tip/warning/danger/success Title`, `::: wide`, `::: full`, `::: aside`, `::: center`; Pandoc/Quarto spellings accepted (`:::: {.columns}`, `{.panel-tabset}`, `.column-page`). More › Insert layout adds them |
| **Tables** | ✅ | framed scroll box, sticky header, zebra rows, click a header to sort (view only), filter box on long tables, row count, full screen, sticky first column + scroll fade on wide tables, columns sized by content; `{.wide .compact .nowrap .plain}` under a table |
| **Doc extras** | ✅ | `![[Note]]` / `![[Note#Heading]]` live includes (3 levels, no loops), `:status[In review]` pills (colour from the text or `{green}`), `[[toc]]` contents box |
| **Focus / Zen** | ✅ | chrome hidden, centered column, typewriter feel; **Read** and **Write** sub-modes, highlighter that saves highlights into the Markdown, read aloud (text to speech) and an outline drawer; round 4: 640 px measure, left outline drawer (O) with the current section, highlighter bar (5 colours · Note · Card = cloze card into "Cards · <note>"), read aloud sentence by sentence (current sentence underlined, later paragraphs dimmed, speed chip, voice), Settings › Reading rows (font, size, width, highlighter palette, voice, write focus, study plan) |
| **Slides** | ✅ | `---` separates slides; images (uploaded or URL), YouTube/Vimeo and uploaded video, Mermaid, math, tables, code; media auto-fits the slide; keyboard / swipe; fullscreen. **Arrange workspace** (A): slide rail with drag-to-reorder, layout picker (11 layouts + blank) writing `<!-- layout: … -->`, style Normal / Invert / Accent (`_class`), free boxes with four corner handles, amber snap guides and coordinates; overview grid (O); phone remote shows current + next slide and notes |
| **Slide layouts** | ✅ | `<!-- layout: … -->` per slide: title, section, default, center, two-cols, image-left/right (`split: 40%`), cards, stat, quote, full, blank; regions `::left::` `::right::` `::1::`…; Marp `![bg](url)` / `![bg left:40%](url)`; `class: invert/accent`; text auto-shrinks to fit (to 62%) |
| **Free placement** | ✅ | `::: box x=10 y=20 w=40 h=30 {.card .center}` (percent of the slide); Arrange mode (A) drags/resizes boxes and writes the numbers back; + Box adds one |
| **Doc → deck** | ✅ | any note without `---` slides is laid out automatically: H1 cover, section slides, layout picked from content (2 sub-sections → two-cols, 3–6 → cards, numbers → stat, quote, image + text, diagram/table full), long prose → speaker notes, long lists/tables → "(cont.)" slides; "Save as deck" / More › Make a slide deck turns it into editable slide Markdown. Presenting a non-deck note first shows the **preview dialog** (Split at `# H1` / `## H2` / `---`, "Present without saving", "Save as deck" → opens the new deck in Arrange) |
| **Presenting** | ✅ | overview grid (O), type a number + Enter to jump, B / . black screen, P presenter view, audience window, phone remote |
| **Review** | ✅ | flashcards from the note (`Question :: Answer` or `?` lines) |
| Canvas | ✅ | infinite board of cards/notes/links/groups |
| Graph | ✅ | force-directed note graph, global + local |

## 3a. Spaces, courses & projects (encapsulation)
Model: **Space → Folders → Notes**. PARA gives the space kinds, Johnny-Decimal numbering is optional, and Zettelkasten links + Maps of Content work across spaces.
| Feature | Status |
|---|---|
| **Spaces**: self-contained containers, each with its own folder tree, icon, color, description, properties and default template | ✅ |
| Space kinds (PARA): **Project** (goal, deadline, milestones) · **Area** (ongoing responsibility) · **Course** (provider, URL, target date, roadmap) · **Resource** (reference topic) · **Archive** | ✅ |
| Space switcher in sidebar header (like Notion teamspaces / Obsidian vault switcher) + "All spaces" scope for search, graph, tasks | ✅ |
| Archive / unarchive a space (hidden from switcher, still searchable) | ✅ |
| Move notes/folders between spaces | ✅ |
| **Course roadmap** (roadmap.sh-style): modules → topics, status per topic `todo · learning · done · skipped`, prerequisites that lock/unlock topics, milestones, target dates, progress % per module and course | ✅ |
| Roadmap stored as plain Markdown (`## Module`, `- [/] Topic (needs: A) 📅 2026-12-01 → [[Note]]`), so it's editable in the editor, by scripts, by the REST API, or as a `.md` file | ✅ |
| Roadmap views: **Outline** (collapsible modules), **Skill tree** (auto-laid-out graph, locked topics dimmed), **Timeline** (by target date) | ✅ |
| Round 4 roadmap (see `docs/ROADMAPS_AND_HUB.md`): module fold state remembered per roadmap + Expand/Collapse all; drag ghost, insert line, "becomes prerequisite", refused loop with the reason; notes tray + empty-roadmap builder ("Add all N as topics"); skill tree by module with foldable modules, curved links coloured by status, minimap; timeline drag with ghost + new-date tooltip; topic sheet with Organize + inline delete confirm; phone ⋯ menu per topic; quiet unlock moment + "X is now open." | ✅ |
| Project hub (Round 4): header with health badge (On track / At risk / Behind + reasons), plain links row, tabs Overview · Docs (status header, owner, 5 states) · Board (6 columns, glyph chips, drag writes the marker, filters, per-column add) · Requirements (MoSCoW + traceability) · Timeline (Gantt from cards, Mermaid export) · Diagrams · Assistant (plain labels, free "Ask" via `/api/ai/project`) | ✅ |
| Click a topic → open or create its lesson note in the course space (lesson template prefilled) | ✅ |
| Roadmap templates (blank, "Learn a language", "CS fundamentals", "Web dev") + import a roadmap from any Markdown outline | ✅ |
| **Project space** overview: goal, deadline countdown, milestones, tasks board from the space's notes, recent notes | ✅ |
| Optional **Johnny-Decimal** IDs (`10-19 Area / 11 Category / 11.01 Note`) with natural numeric sorting | ✅ |
| **Map of Content (MOC)** note type: hub notes that link a topic, shown as hubs in the graph | ✅ |

## 3. Organization
| Feature | Status |
|---|---|
| Nested folders (create, inline rename, move, delete, color), natural sort, remembered collapse state, counts | ✅ |
| Folder tree UX: drag-drop notes & folders, keyboard navigation, "Reveal in tree", "Move to…" dialog with search, breadcrumbs | ✅ |
| Drag a note onto a folder to move it | ✅ |
| Tags (with counts) + tag filter | ✅ |
| Pinned and favourite notes | ✅ |
| Note types: Note · Lesson · Journal · Flashcards · Slides · Post | ✅ |
| Learning status per note: `todo → learning → review → mastered` | ✅ |
| Templates (Lesson, Daily journal, Cornell notes, Flashcard deck, Slide deck, Blog post, Meeting) | ✅ |
| Daily note (one click, dated) | ✅ |
| Trash with restore (soft delete) | ✅ |
| Sort: updated, created, title; filter by type/status/tag | ✅ |
| "Database" table view of notes (sortable columns: type, status, tags, updated) | ✅ |
| **Smart folders** (see `docs/SMART_FOLDERS.md`): save any search as a sidebar folder with a live count (extra operators `due:` `has:` `no:` `updated:` `created:`), synced, pin / rename / reorder / colour, Save as base; phone folders sheet | ✅ |
| **Unlinked mentions** in the Links tab (title + aliases, Arabic prefixes, Link / Link all with undo / Ignore) + graph **Tag links**: tag nodes or shared-tag edges, legend | ✅ |

## 4. Search & navigation
| Feature | Status |
|---|---|
| Full-text fuzzy search (MiniSearch) across title, body, tags; prefix + typo tolerance | ✅ |
| Command palette `Ctrl/⌘ K`: jump to note, run any command | ✅ |
| Quick switcher keyboard navigation | ✅ |
| Search operators `tag:`, `type:`, `status:`, `in:folder` | ✅ |
| Recent notes | ✅ |

## 5. Graph & Canvas (manipulable by UI, code, file and protocol)
| Feature | Status |
|---|---|
| **Graph view**: force-directed (d3-force), nodes = notes, edges = `[[links]]`, optional tag nodes | ✅ |
| Local graph (current note, depth 1–3) | ✅ |
| Graph filters (search, tag, type, orphans) and color groups (by folder / type / status) | ✅ |
| Zoom, pan, drag nodes, click to open | ✅ |
| **Canvas** in the open **JSON Canvas 1.0** format (`.canvas`, Obsidian-compatible) | ✅ |
| Node types: text (Markdown), file (link to a note), link (URL), group (labelled container) | ✅ |
| Edges with sides, arrow ends, labels, colors (presets 1–6 or hex) | ✅ |
| Drag, resize, connect, delete, multi-select, minimap, snap-to-grid | ✅ |
| **Code mode**: edit the canvas as raw JSON with validation, live round-trip | ✅ |
| **Script console**: run JS against an API (`canvas.addNode`, `addEdge`, `layout`, `fromOutline`) | ✅ |
| Generate canvas from a note's outline / from linked notes | ✅ |
| Import/export `.canvas` files | ✅ |
| **REST API** `GET/PUT /api/canvas/:id` (JSON Canvas body, bearer token) so external scripts/agents can read and write boards | ✅ |
| Auto-layout (grid / tree / force) | ✅ |
| Real-time multiplayer (Durable Objects) | 🔜 |

## 5b. Whiteboard (Excalidraw, manipulable by UI, code, file and protocol)
Chosen over tldraw because Excalidraw is MIT-licensed with no production license key, and its `.excalidraw` format is open JSON.
| Feature | Status |
|---|---|
| Freehand pen, shapes (rect, ellipse, diamond), arrows with binding, text, images, frames, eraser, laser pointer, hand-drawn or clean style | ✅ |
| Sticky notes (6 colors) via script helpers / skeleton API | ✅ |
| Stored as `.excalidraw` JSON in the note body: synced, versioned (History panel), searchable (text elements) | ✅ |
| **Code panel**: edit raw `.excalidraw` JSON and Apply | ✅ |
| **Script console**: `board.add([...skeletons])`, `sk.rect / sticky / text / arrow / connect / frame`, `board.fromMermaid(code)`, `board.clear()` | ✅ |
| **Mermaid → whiteboard**: flowcharts become editable shapes (official mermaid-to-excalidraw) | ✅ |
| **Canvas → whiteboard** conversion (cards → boxes, edges → bound arrows, groups → frames) | ✅ |
| **REST protocol**: `GET/PUT /api/whiteboard/:id` (full scene), `POST /api/whiteboard/:id/elements` `{ skeleton: [...] }` (scripts/agents append shapes; the app converts and merges them on open) | ✅ |
| Import/export `.excalidraw`, export PNG / SVG | ✅ |
| Live multiplayer whiteboard | 🔜 |

## 5c. Embeds, previews, languages
| Feature | Status |
|---|---|
| YouTube (incl. Shorts, `?t=` start time) and Vimeo players inline from a bare URL or `![](url)` | ✅ |
| Uploaded video/audio play inline; PDFs open in an inline viewer | ✅ |
| Link-preview cards for bare URLs (Open Graph title, description, image), fetched and cached by the Worker | ✅ |
| **Arabic + English mixed**: per-paragraph automatic direction (`dir="auto"`) in preview and blog; per-line direction in the editor | ✅ |
| Arabic fonts (IBM Plex Sans Arabic, Noto Naskh Arabic) paired with Inter / Source Serif | ✅ |
| Arabic-aware search (ignores tashkeel/tatweel; أ/إ/آ = ا, ة = ه, ى = ي) | ✅ |
| Full Arabic UI translation (RTL app chrome) | 🔜 |

## 6. Versioning
| Feature | Status |
|---|---|
| Automatic snapshots (on pause after edits, max 1 per 2 min) + manual "Save version" with label | ✅ |
| Version history panel with timestamps and size delta | ✅ |
| Line diff (added/removed) between a version and current | ✅ |
| Restore = creates a new version (Confluence behaviour; nothing is lost) | ✅ |
| Version history synced across devices | ✅ |
| Git export of the vault | 🔜 |

## 7. Learning features
| Feature | Status |
|---|---|
| Flashcards from Markdown (`Q :: A`, multiline `?` separator) | ✅ |
| Spaced repetition scheduling with due counts: **FSRS-6** (`lib/fsrs.ts`, target retention in Settings › Review, default 0.9); older SM-2 cards migrate on their next review | ✅ |
| **Review › Advanced** (Settings › Reading › Review): max interval (days), new cards a day (0 = no limit; counted from today's review log), learning / relearning steps (e.g. `1m 10m`), all wired into scheduling + the workload chart; **review log** (Dexie `reviews`, synced as kind `review`: card, time, grade, state before, elapsed and scheduled days; undo removes the row); **Optimize from history** fits the 21 FSRS-6 weights to the log (`lib/fsrs-optimize.ts`: per-rating initial-stability pretrain + coordinate-descent on log loss with an L2 pull to the defaults, ≥ 50 reviews a day or more apart), "Use defaults" resets. Weights and limits are per device (settings) | ✅ |
| **Concept practice** (path concept sheet): AI quiz (MCQ + short answer) from the concept's notes, falls back to their flashcards offline; save questions as cards; **test out** marks the concept learned | ✅ |
| **Ask your vault** (`lib/ask-retrieve.ts`, `/api/ai/ask`): question → on-device BM25 passages → streamed Workers AI answer with numbered citations; scope vault / space / note + links / learning path; Arabic + English; AI tab › Ask vault, palette "Ask your notes…" (Ctrl/⌘⇧A) | ✅ |
| Learning status + progress dashboard (notes by status, streak, due cards, words written) | ✅ |
| Study streak / activity heatmap | ✅ |
| Cornell notes template, lesson template with objectives / summary / questions | ✅ |
| FSRS scheduler | ✅ |
| **Cloze cards** `{{c1::answer::hint}}` anywhere (`==text==` only in flashcard notes / `cloze: true`; coloured highlights never count) + **image occlusion** (```` ```occlusion ```` block, draw boxes with mouse or finger, hide-one / hide-all, one card per box or group); see `docs/FLASHCARDS.md` | ✅ |

| **Bases** (`type: base`, Obsidian Bases YAML, see `docs/BASES.md`): Table · Board · Gallery · List · Calendar views of notes with filters, sort, group, inline editing, drag cards between columns/days (writes front matter); full-height with its own Back (view ⋯ › Edit YAML for the source) | ✅ |

| **Today** study plan (sidebar › Today, Home card; see `docs/TODAY.md`): Continue · New lessons · Reviews · Practice from paths, roadmaps and due cards, each with minutes and a reason; missed days → spread over the next days (writes 📅 dates); week view + goals; Settings › Study plan | ✅ |
| **Dashboards** (note type `dashboard`, see `docs/DASHBOARDS.md`): number, bar, stacked, line, area, donut, heatmap, ring, table, list tiles from cards, sessions, notes, paths or bases; drag / resize on a 12-column grid; full-height with its own bar (Back, range picker that names the tiles' shared range, YAML; phone: tile ⋯ › Edit dashboard YAML); keyboard + data-table accessible charts. **Multi-group bases** (`groupMulti: each | first`) | ✅ |

## 7b. Productivity views
| Feature | Status |
|---|---|
| **Tasks** view: every `- [ ]` across all notes, with due dates (`📅 2026-11-20`), filter today / overdue / done, tick from the list | ✅ |
| **Kanban** board of notes by learning status (drag between columns) | ✅ |
| **Calendar**: daily notes, notes created/updated per day, tasks due | ✅ |
| **Study timer** (Pomodoro 25/5) attached to a note, logs minutes studied to the dashboard | ✅ |
| **AI assist** (Cloudflare Workers AI, free tier): summarize note, generate flashcards, explain selection, suggest tags | ✅ |
| Share-to-Lumen (Android share sheet / PWA share target) → clip text or URL into an Inbox note | ✅ |
| **PDF reader** (note type `pdf`, see `docs/PDF.md`): virtualized pages, thumbnails / outline / highlights rail, search with scrollbar markers, zoom, resume where you left off, dark-mode page inversion (images kept), password + scanned-PDF states; full-height reader with its own bar (Back / Forward, phone Back, ⋯ › Edit as Markdown); text and **area** highlights in 5 colours with comments and tags; highlight → note / flashcard / canvas card with a `[[PDF#^hl-id]]` back-link that opens the page and flashes it; PDFs library with % read | ✅ |
| **Video notes with timestamps** (see `docs/VIDEO_NOTES.md`): Alt+T inserts `[12:34]`, chips seek YouTube / Vimeo / uploaded video (`[12:34](#video-2)` picks a player), speed 0.75–2×, flashcard at this moment, pause while typing, docked player on phone | ✅ |

## 8. Import / export
| Feature | Status |
|---|---|
| Import `.md` files (front-matter aware) or a `.zip` vault (folders preserved) | ✅ |
| Import `.canvas` | ✅ |
| Export note as `.md` (with YAML front-matter), `.html` (styled, standalone), print → PDF | ✅ |
| Export whole vault as `.zip` (folders → directories, canvases as `.canvas`) | ✅ |
| Full JSON backup + restore | ✅ |
| Obsidian vault compatible (Markdown + `[[links]]` + `.canvas`) | ✅ |

## 8b. Sharing
| Feature | Status |
|---|---|
| **Unlisted share link** for any note: Markdown, slides (visitors can present), flashcards (practice mode), canvas (board preview + .canvas download), whiteboard (view-only), roadmap | ✅ |
| **Share a whole space/course**: public page with progress ring, roadmap, all notes, and a graph of their links; only safe properties (goal, dates, URL) are exposed | ✅ |
| Revoke or regenerate a link anytime (old link stops working immediately) | ✅ |
| Copy link · native share sheet (Android / mobile browsers) · open | ✅ |
| Read-only viewer never writes to the visitor's device; works without an account | ✅ |
| "Shared with link" overview in Settings, link expiry dates, password-protected links | 🔜 |

## 3b. Learning paths (multi-course roadmaps)
One concept-first roadmap on top of several overlapping courses. Each course keeps its own independent roadmap.
| Feature | Status |
|---|---|
| Path = note type `path`, plain Markdown: `## Stage`, `- Concept = Topic A \| Topic B`, `resource:` / `note:` / `review:` lines | ✅ |
| Combine any course spaces / roadmap notes; same-named topics merge into one concept automatically | ✅ |
| **Overlap suggestions** across courses (similar names, e.g. "Backprop by hand" ≈ "Backpropagation") with one-click Merge / "Different" | ✅ |
| Prerequisites merged across all courses; locked/unlocked concepts | ✅ |
| **Mastery rules**: a concept is *learned* when you mark it ("I already know this") or finish its lessons in **any one** course (other courses = optional material); *locked* until its prerequisites are learned; *mastered* when spaced reviews reach the 14-day step; learning a concept counts as an implicit review of its direct prerequisites. Course lesson ticks stay per course | ✅ |
| Collapsible path summary (auto-collapsed for paths with > 6 courses); course chips open the course page; Back returns to the page a note was opened from | ✅ |
| **Slash commands** (`lib/slash.ts`): `/` at line start or after a space opens a grouped menu (Basic · Layout · Panels & callouts · Media & embeds · Knowledge · Advanced, 60 blocks with glyphs, hints and shortcuts, a Recent group, no-results suggestions, phone bottom sheet; Confluence/Notion/Obsidian names as aliases); `//` = today's date; never inside URLs or code fences. Same catalog drives the **Insert gallery** (layout thumbnails + preview, note ⋯ › Insert…) and the block menu. R4 details: `docs/EDITOR.md` | ✅ |
| **Browser history**: every page (note, space, list, filter) is a history entry: browser / Android Back + Forward, phone gesture and the in-app Back arrow walk the same sequence; Back closes sheets / modes / keyboard first; clickable breadcrumb (space → its page, folder → its list) | ✅ |
| **Stages** board (drag concepts between stages, rename/reorder stages, "Not placed yet" lane) | ✅ |
| **Matrix**: concepts × courses with per-course status and overlap count (2×, 3×) | ✅ |
| **Graph**: left→right by prerequisite depth, course color bars, stage badge | ✅ |
| **Timeline**: one lane per course + revision lane, packed pills, today line | ✅ |
| **Revise**: spaced revision of finished concepts (1→3→7→14→30→60→120 days, "Again" resets) | ✅ |
| Concept sheet: status in every course (edits that course's roadmap), resources, lesson notes, merge, rename | ✅ |
| Resources per concept: YouTube/Vimeo/course videos play inline; articles/books/courses as links; links in course lesson notes collected automatically | ✅ |
| Auto-organize (stages from prerequisite depth) and AI organize (Workers AI groups + merges) | ✅ |
| **Styled by reference** (not drawn in the round-4 design, built in its language): Organize ▾ (Auto / AI) menu with the `organize` glyph; "Merge with another concept" and "Take out of the path" rows in the concept sheet's collapsible "Merge or take out" section with the inline confirm bar | ✅ |
| Dev simulator scenario "Learning paths" (ML Foundations + CS231n + fast.ai) | ✅ |
| **Drag-and-drop editing**: roadmap outline (reorder topics/modules, drop on a topic = prerequisite, + New module, drag notes in from the Notes tray, Alt+↑/↓), skill tree (+ Topic chip, connect to empty canvas = new dependent topic, click an arrow to remove); path stages (reorder/move/merge concepts, reorder stages, drop notes, Alt+arrows), path graph `needs:` edges; loops refused; phones use ⋯ menus instead of drag; empty roadmap opens as a builder | ✅ |
| **Round 4 (Lumen 14 / PathDesk)**: collapsible header (collapsed above 6 courses: ring, learned · learning · to revise · mastered, overlaps badge); course chips with colour bar + course-kind glyph (space prop `format: video|book|lecture|notebook|paper|podcast|article`, else guessed from provider/url) + done/total, "+N more" searchable course list; Organize ▾ (Auto / AI) | ✅ |
| **Overlaps panel**: Merge / They're different per pair with a reason (same name, same notes cited, N shared lessons), **Review all** = bulk decisions + one Apply | ✅ |
| **Filters shared by every tab** (Course · Status · Stage, plus To revise / Only overlapping / Not placed) and **Group by** stage / course / status, remembered per path; phone: scrolling pill tabs + Filter sheet ("Show N concepts") | ✅ |
| Stages: columns collapse to a 44 px strip, Expand/Collapse all, design concept cards (status, course dots, N courses, N res, revise pill), dashed Not placed yet, drag ghost + insert line + invalid-drop states; phone accordion (one stage open at a time) | ✅ |
| Graph: Step N columns per stage (sub-columns by prerequisite depth), course bars + stage badge, focus chain (ancestors + dependants, "Only this chain"), collapse a stage into a summary node, minimap, zoom/fit, collapsible legend, "Focus in graph" from the concept sheet, drag a dot to add a dashed path prerequisite (loops shown as invalid) | ✅ |
| **Prerequisite graphs, round 4 · 14b** (path Graph + course Skill tree; `lib/prereq-graph.ts`, `components/prereq-ui.tsx`): one connection language (prerequisite coloured by progress · recommended order `after:` dashed · related `related:` dotted, no arrow · added in this path amber dashed · implied faint dots); **Hide implied links** = transitive reduction (A→C hidden when A→B→C; comes back while either end is hovered; count "N hidden"); **Display panel** (desktop 300 px; phone sheet with edge shape, link chips, Tidy up): Layout By stage / Top-down / Free (path), edges Curved / Elbow / Straight, Show links toggles with counts, **Group by stage** (off = columns by prerequisite depth across the whole path / roadmap), **Bundle links between stages** (routed through a shared gutter), Dim outside focus, Keep pinned cards, Compact/Roomy; saved per view. **Drag-to-connect checks** while dragging: valid → green "Becomes a prerequisite"; loop → red, refused, names the chain ("X is already needed (through Y) to reach Z"); already implied → amber, asks "Add anyway / Cancel"; duplicate → grey, nothing happens. **Link menu** (click a link; phone bottom sheet): Prerequisite / Recommended order / Related (rewrites one link: needs → after → related), Reverse direction (loop-checked), Remove link; path links rewrite the path, links from a course rewrite that course roadmap. **Tidy up** (path, ⇧T): preview banner (moves N cards · crossings before → after · pinned kept) → Apply (barycentre untangle, hides implied) → toast Undo; Free layout: drag cards (pinned, right-click toggles the pin). Skill tree fan-out: a topic without prerequisites sits next to what it unlocks | ✅ |
| Matrix: collapsible groups, rotated abbreviated course headers (full name on hover), sticky concept column, overlap column, Only overlapping / Missing from my courses; scrolls with 28+ courses. Timeline: collapsible lanes, lesson bars by date, revision lane, today line. Revise: one concept, taught-in chips, recall prompt from its flashcards, resources, Again / Got it (next step shown), Coming up | ✅ |
| Concept sheet: remembered collapsible sections (Mastery with Todo/Learning/Learned/Mastered + progress to 14 days, Practice quiz in place with ≥ 80 % = learned, Taught in rows with status + Open + drag, Prerequisites/Unlocks chips, Resources, Notes, Merge or take out with the inline confirm bar); phone full-height sheet. New learning path dialog (course chips, Organize from outlines with a stage preview, or empty stages); paths list cards (`views/path-list.tsx`) | ✅ |

## 3c. Project hub (software projects, links only)
Project spaces become a hub for building software. Nothing connects to GitHub/Bitbucket: repo, PR, Figma and Jira are plain links.
| Feature | Status |
|---|---|
| Tabs: Overview · Docs · Board · Requirements · Timeline · Diagrams · AI assistant, plus a links row and a health badge (on track / at risk / behind) | ✅ |
| **Docs**: PRD, RFC, ADR (decision), Requirements, Action plan, Meeting notes, Spec, Draft, each with a template; header `doc:` + `docstatus:` (draft / in review / approved / superseded / rejected), owner | ✅ |
| **Task cards** from any note's checkbox lines: `[>]` backlog · `[ ]` todo · `[/]` in progress · `[?]` review · `[x]` done · `[-]` cancelled; inline `!p1` priority, `~3d` estimate, `📅` due, `🛫` start, `#epic/x`, `@owner`, `REQ-n` | ✅ |
| Board with drag between columns (writes the marker back to the note), epic filter, estimate totals, quick-add card | ✅ |
| **Requirements** `- REQ-n (must/should/could/wont) …` with MoSCoW counts and traceability: met / in progress / planned / no tasks | ✅ |
| **Timeline**: Gantt generated from cards (by epic; done/active/critical colors) | ✅ |
| **Diagrams**: requirements → tasks flowchart, epic mindmap, list of the project's Mermaid notes / canvases / whiteboards; "Save as doc" | ✅ |
| **AI assistant** (Workers AI, reads docs + cards + requirements): plan from goal, weekly status, next actions, risks, decision summary, draft requirements; save as a doc | ✅ |
| Dev simulator scenario "Software project hub" (an AI-feature project with every doc type and card state) | ✅ |

## 8c. Round 2 (Claude Design handoff, 100% pass)
| Feature | Status |
|---|---|
| Whole UI rebuilt to the Claude Design handoff (rounds 1–3), verified screen by screen against the designs | ✅ |
| Unlock screen with attempts left + lockout timer; fingerprint / Windows Hello / Android biometric app lock | ✅ |
| Home: customize sections, voice quick capture, global study timer, heatmap → calendar day | ✅ |
| Course: skill tree with prerequisite path highlight + drag-to-link; timeline drag to reschedule; unlock animation | ✅ |
| Project board Todo / Doing (`[/]`) / Done | ✅ |
| Import with real progress, duplicate handling, tag mapping; export with size estimate, folder picker, attachment retry | ✅ |
| Palette operator chips, scope, AI + local-graph commands; canvas JSON ↔ selection sync; whiteboard sticky bar + phone dock; full-width side-by-side diffs | ✅ |
| Review: edit / suspend / undo, redo "Again", streak; slides presenter view, audience window, **phone as remote** (Durable Object) | ✅ |
| Database inline editing, secondary sort, draggable columns, filter chips; Tasks X / D shortcuts | ✅ |
| Settings: Blog (license, RSS), AI switches (enforced server-side), API tokens (create / regenerate / revoke, last used), real Cloudflare usage | ✅ |
| Interface direction Auto / LTR / RTL (mirrored app chrome) | ✅ |
| Embeds: privacy-first YouTube/Vimeo thumbnails, custom video/audio players, pdf.js viewer with quote-to-note, link-card states | ✅ |
| Share-to-Lumen (PWA share target + Android share sheet) | ✅ |
| Sync conflict detection with "View other" version; offline banner; undo toasts | ✅ |
| Dev mode: design demo data + 11 scenarios + network / AI / upload / clock / conflict simulation | ✅ |
| Round 4 final audit (A): **empty states** (Lumen 21: one glyph, one line, one action) on learning paths ("New path"), course without roadmap ("Build roadmap" + AI), base views ("Clear filters" / "Clear search"), PDF highlights, Review ("No cards due. Next ones tomorrow." → **Practice anyway** = review ahead the 20 soonest-due cards, graded normally), smart folders ("Edit search" opens the editor), Today ("Nothing planned. Today is a rest day." → "Plan anyway"), Tasks, Trash | ✅ |
| **Moments** (Lumen 21, quiet, 200 ms, reduced motion = end frame): unlock ("Weight init is open") and mastered ("Gradient descent · mastered · N revisions in a row · next in D days") fire on any change of a learning path; streak ("14 days in a row · Today counted after 1 timer session") on the first study activity of a day that extends a 2+ day streak, once a day | ✅ |
| **Favicon review badge** (violet dot, count in the icon title) on every layout incl. phones; **OG images + og:/twitter: tags** on `/s/*` and `/blog/*` (Worker first; RTL titles right-aligned; descriptions and public excerpts strip the title line, slide separators, callout headers, task markers and task dates) | ✅ |
| **Sidebar rail by page** (LumenSidebar `collapsed` in the R4 desks): Today, Graph, Settings, course roadmap, project hub, notes read without the list, paths / PDFs / bases / dashboards / canvases / whiteboards, Focus, Slides show the 56 px rail; expanding there (rail button, Ctrl \, palette) opens it for that page only. The open note's folder unfolds in the sidebar tree and the note row is the active one. Smart-folder lists are 360 px (Lumen 20b), other lists 320 px | ✅ |
| Phone **More** tab = the design's More page (Lumen 06 · 20C): profile card, Today / Daily note / Tasks / Calendar / Graph / Canvases / Learning paths, "Spaces, folders & tags" (the drawer), then settings. Phone exit toast is the inverted 40 px pill ("Swipe back again to close Lumen") | ✅ |
| Bidi fix: blocks whose first strong letter is Arabic (headings, list items, paragraphs) read right-to-left again in the reader (the Arabic-font spans had hidden them from `dir="auto"`); palette / graph snippets drop task-date emoji and show "Canvas board" / "Whiteboard" instead of scene JSON | ✅ |

## 9. Blog (public)
| Feature | Status |
|---|---|
| Mark a note **Published** with a slug → appears at `/blog/<slug>` | ✅ |
| Public blog index `/blog` with tags, reading time, excerpt | ✅ |
| Same renderer (math, Mermaid, code, callouts) for readers | ✅ |
| Public pages served by the Worker, no login | ✅ |
| RSS feed `/rss.xml` | ✅ |
| Custom domain | 🔜 (Cloudflare dashboard) |

## 10. Sync, storage, platforms
| Feature | Status |
|---|---|
| Local-first IndexedDB (Dexie). Works fully offline | ✅ |
| **Several accounts** on one device (each its own passcode, D1 database and local DB): switch, add, sign out in Settings; sign-in routed by the passcode | ✅ |
| **Big vaults** (700+ notes): paged note list, search index and graph layout built in the background, one shared vault snapshot | ✅ |
| Attachments in D1 (free, chunked) · optional R2 if a card is added later | ✅ |
| Sync to Cloudflare D1 (last-write-wins per note by `updatedAt`, incremental `since` cursor) | ✅ |
| Single-owner passcode auth (PBKDF2 hash + HMAC bearer tokens) | ✅ |
| PWA (manifest, installable) | ✅ |
| Android APK via Capacitor from the same build | ✅ (config) |
| iOS via Capacitor | 🔜 |

## 11. Personalization & branding
| Feature | Status |
|---|---|
| Themes: Lamplight (default dark), Paper (light), Midnight, Sepia, Forest, High-contrast | ✅ |
| Custom accent hue picker (OKLCH, keeps contrast) | ✅ |
| Font choices (sans / serif / mono for reading), size, line width | ✅ |
| Blog name, tagline, author, avatar emoji | ✅ |
| Density: comfortable / compact | ✅ |
| Respects `prefers-color-scheme` and `prefers-reduced-motion` | ✅ |

---

## Sources
- [Obsidian vs Notion (Taskade, 2026)](https://www.taskade.com/blog/notion-vs-obsidian.md) · [Obsidian vs Notion (Slite)](https://slite.com/en/learn/obsidian-vs-notion) · [DEV: Notion vs Obsidian for developers](https://dev.to/pickuma/notion-vs-obsidian-which-knowledge-base-fits-your-developer-brain-in-2026-f2k)
- [Obsidian Graph view help](https://obsidian.md/help/plugins/graph) · [Obsidian Canvas guide](https://www.obsibrain.com/blog/obsidian-canvas-complete-guide) · [Advanced Canvas plugin](https://community.obsidian.md/plugins/advanced-canvas)
- [JSON Canvas spec 1.0](https://jsoncanvas.org/spec/1.0/) · [JSON Canvas interoperable apps (DEV)](https://dev.to/benriemer/json-canvas-how-to-build-interoperable-infinite-canvas-apps-with-an-open-format-1187)
- [Confluence page history & comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) · [Confluence for technical docs](https://support.atlassian.com/confluence-cloud/docs/use-confluence-for-technical-documentation/)
- [Best Obsidian plugins 2026 (dsebastien)](https://dsebastien.net/the-must-have-obsidian-plugins-for-2026/) · [Obsibrain plugin list 2026](https://www.obsibrain.com/blog/top-obsidian-plugins-in-2026-the-essential-list-for-power-users) (Excalidraw, Dataview, Tasks, Templater, Kanban)
- [Best note apps for students 2026 (Goodnotes)](https://www.goodnotes.com/blog/best-free-note-taking-apps-for-students-2026) · [RemNote: AI note apps for students](https://alpha.remnote.com/blog/best-ai-note-taking-apps-for-students)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [PARA + Johnny.Decimal (NotePlan)](https://help.noteplan.co/article/155-how-to-organize-your-notes-and-folders-using-johnny-decimal-and-para) · [Zettelkasten vs PARA (DEV)](https://dev.to/secondbrainstarter/zettelkasten-vs-para-vs-minimal-which-obsidian-system-is-right-for-you-3gnk) · [PARA for engineers](https://glukhov.org/knowledge-management/methods/para-method-for-engineers/)
- [Developer Roadmap / roadmap.sh mirror](https://sourceforge.net/mirror/developer-roadmap/) (done / learning / skipped topics) · [Course → skill roadmap (Taskade)](https://www.taskade.com/convert/education/online-course-to-skill-roadmap)
- [Notion teamspaces](https://simonesmerilli.com/writing/notion-teamspaces)
- [Excalidraw element skeleton API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton) · [mermaid-to-excalidraw](https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api) · [tldraw license key (production requires key)](https://tldraw.dev/sdk-features/license-key)
- [Progressive disclosure (IxDF)](https://ixdf.org/literature/topics/progressive-disclosure)
- [Local-first Markdown editors: SvelteMark](https://dev.to/jqueryscript/sveltemark-local-first-markdown-editor-built-with-svelte-5-27h5), [jotter.live](https://github.com/cankoe/jotter.live), [7kfpun/markdown](https://github.com/7kfpun/markdown)
- [Spaced repetition from Markdown: carddown](https://www.linuxlinks.com/carddown-spaced-repetition-markdown-notes/), [hashcards (FSRS)](https://docs.rs/crate/hashcards/0.2.1/source/README.md)
- [Capacitor + React 2026](https://noqta.tn/en/tutorials/capacitor-react-mobile-app-ios-android-2026) · [Capawesome: web app to store](https://capawesome.io/blog/11-steps-to-get-your-web-app-on-the-app-store/)
- Palettes: [Obsidian design system notes](https://blakecrosley.com/guides/design/obsidian), [Reflect design system](https://www.shadcn.io/design/reflect), [Dark mode UI guide](https://uxmagic.ai/blog/dark-mode-ui-design-guide)
