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
| Code highlighting (highlight.js, 190+ languages) + copy button | ✅ | |
| Obsidian-style callouts `> [!note]`, `[!tip]`, `[!warning]`, `[!example]`, `[!question]` | ✅ | foldable with `[!note]-` |
| Wiki links `[[Note]]`, `[[Note\|alias]]` + backlinks panel | ✅ | |
| Inline `#tags` + front-matter tags | ✅ | |
| Embedded canvas in a note (fenced `canvas` block with JSON Canvas) | ✅ | |
| Formatting toolbar (bold, italic, heading, list, task, quote, code, math, mermaid, table, link) | ✅ | mobile: sticky above keyboard |
| Slash commands `/` in editor | 🔜 | |
| Images & files: paste, drag-drop, pick, or phone camera → stored on device (IndexedDB) and uploaded free to **Cloudflare D1 in 1.5 MB parts** (max 100 MB/file, Range streaming for video); `![](att:id)` links work offline and online | ✅ | |
| Voice notes → text (Workers AI Whisper, Arabic + English) | ✅ | |
| Properties panel (front-matter key/value: source, course, due, url…) | ✅ | |
| Query blocks (Dataview-lite): ```` ```query tag:#ml type:lesson ```` ```` renders a live list/table | ✅ | |
| Word count, reading time, outline (table of contents) | ✅ | |

## 2. View modes (progressive disclosure)
| Mode | Status | What it shows |
|---|---|---|
| **Edit** | ✅ | editor only |
| **Split** | ✅ | editor + live preview (desktop default) |
| **Read** | ✅ | rendered note, typographic reading layout (mobile default) |
| **Focus / Zen** | ✅ | chrome hidden, centered column, typewriter feel |
| **Slides** | ✅ | `---` separates slides; images (uploaded or URL), YouTube/Vimeo and uploaded video, Mermaid, math, tables, code; media auto-fits the slide; keyboard / swipe; fullscreen |
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
| Saved searches / smart folders | 🔜 |

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
| Spaced repetition scheduling (SM-2) with due counts | ✅ |
| Learning status + progress dashboard (notes by status, streak, due cards, words written) | ✅ |
| Study streak / activity heatmap | ✅ |
| Cornell notes template, lesson template with objectives / summary / questions | ✅ |
| FSRS scheduler | 🔜 |
| Cloze deletions `==text==` | 🔜 |

## 7b. Productivity views
| Feature | Status |
|---|---|
| **Tasks** view: every `- [ ]` across all notes, with due dates (`📅 2026-11-20`), filter today / overdue / done, tick from the list | ✅ |
| **Kanban** board of notes by learning status (drag between columns) | ✅ |
| **Calendar**: daily notes, notes created/updated per day, tasks due | ✅ |
| **Study timer** (Pomodoro 25/5) attached to a note, logs minutes studied to the dashboard | ✅ |
| **AI assist** (Cloudflare Workers AI, free tier): summarize note, generate flashcards, explain selection, suggest tags | ✅ |
| Share-to-Lumen (Android share sheet / PWA share target) → clip text or URL into an Inbox note | ✅ |
| PDF viewer with highlights → notes | 🔜 |

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
