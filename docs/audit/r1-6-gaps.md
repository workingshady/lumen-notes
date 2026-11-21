# Gap audit: Claude Design Lumen 00-32 + Components vs the app

Static audit (no browser) against design/handoffs/2026-11-21-round-8. Only Missing/Partly rows are listed. "Partly" sometimes means "could not confirm statically". Pixel and motion parity was not checked.

# Gap audit A: Lumen 00-04 (round 8 handoff vs. src/ and worker/)

Static audit; "not found" means a grep of `src/` found no handler (app not run). Pages 00, 01, 03, 04 are close to fully built (splash, unlock and first-run, Home cards, skill tree and timeline, graph, canvas code/script, version studio all have real code). Rows below are only what was missing or incomplete. No backend gaps found for these five pages: unlock attempts (`worker/` + migration 0005), accounts (0010), REST `/canvas/:id` (`worker/ext/rest.ts`), spaces and versions are wired.

## Lumen 00 Brand and Splash
All frames (mark, lockups, adaptive/themed icon, favicon set, splash S1/S2/S3) are implemented: `src/App.tsx` `Splash` (300 ms skip, 240 ms warm-up), `public/manifest.webmanifest` (maskable and monochrome icons), `android/app/src/main/res/values/styles.xml` (SplashScreen API, 240 ms).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none) | | | | |

Counts: Missing 0, Partly 0

## Lumen 01 Welcome and Home

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 3C | Phone FAB: long-press gives Daily note / Voice note / Flashcard | Missing | The phone bar "+" has no long-press speed-dial; no touch/press handler found. | `src/App.tsx` `TabBar`, `src/components/NewMenu.tsx` |
| 3B | Tablet: swipe from the left edge opens the 240 px sidebar as overlay; rail tooltips on long-press | Missing | No edge-swipe handler found (only list-row swipes in `ws-phone.tsx`); rail tooltips are hover/title only. | `src/components/Sidebar.tsx`, `src/App.tsx` |
| 3A | Customize home on tablet layout | Partly | Customize exists (`views/home-customize.tsx`); not confirmed every design card is toggleable on the 1024 layout. Low risk. | `src/views/home-customize.tsx` |

Counts: Missing 2, Partly 1

## Lumen 02 Notes

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 4A n2 | Mode switch shortcuts Cmd 1-6 | Missing | No Cmd 1-6 handler. Only Ctrl+E (edit/read) exists. | `src/components/NoteView.tsx` (keydown ~l.100) |
| 4A n1 | Cmd+Shift+\ hides the note list (Cmd+\ sidebar works) | Missing | Only Cmd+\ (`App.tsx` l.90) bound; no list-collapse shortcut or "both collapsed = 96% width" state. | `src/App.tsx`, `src/components/NoteList.tsx` |
| 4A n5 | List keyboard: J/K step, P pin | Missing | `NoteList.tsx` keydown handles only Esc and Ctrl+A in select mode. Del, multi-select and context menu exist (`note-list-desk.tsx`). | `src/components/NoteList.tsx`, `note-list-desk.tsx` |
| 4A n3 | Sync pill hover reveals "Last change 21:39 · 0 queued" | Partly | `ws-sync.tsx` shows "Saved · status" / "Saved locally · N queued" as text/title; no last-change time card. Click = Sync now works. | `src/components/ws-sync.tsx` |
| 5A n1 | Right panel shortcuts Cmd+Shift+B (backlinks), Cmd+Shift+O (outline) | Missing | Panel tabs exist (`RightPanel.tsx`, linked/unlinked mentions with Link); no key binding found. | `src/components/RightPanel.tsx`, `NoteView.tsx` |
| 5A n4 | Wiki-link hover preview card after 400 ms; Cmd-click opens in split | Missing | No hover-card code for wiki links (`markdown.ts` / `Preview.tsx`); Cmd-click-split not found. | `src/components/Preview.tsx`, `src/lib/markdown.ts` |
| 5A n3 | Mermaid frame in Read: code toggle + expand to full-screen pan/zoom | Partly | Source toggle and pan/zoom exist in `DiagramsTab.tsx`, not on the inline frame in the note body. Code Copy-on-hover exists (`markdown.ts` `handleCopyClick`). | `src/lib/markdown.ts`, `src/components/ws-embeds.tsx` |
| 5B | Phone Outline pill hides on scroll down, returns on scroll up | Partly | Pill exists (`NoteView.tsx` l.419/468); no scroll-direction logic found. | `src/components/NoteView.tsx` |
| 6A | Phone edit voice = hold to dictate (Arabic/English) | Partly | Voice is a tap toggle (`Editor.tsx` `toggleVoice`) and requires sync unlocked (server transcription); no hold-to-talk. | `src/components/Editor.tsx`, `worker/ext/` |
| 7B | Focus phone: swipe down to exit | Missing | `FocusView.tsx` has Esc and a button; no swipe-down gesture. | `src/components/FocusView.tsx` |
| 7A | Focus: Cmd+4 toggles; mode switch fades in on mouse move, hides after 1.5 s typing | Partly | Typewriter + dimming exist (`FocusView.tsx`, `Editor.tsx` l.172); Cmd+4 binding not found. | `src/components/FocusView.tsx` |

Counts: Missing 6, Partly 5

## Lumen 03 Spaces

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 1K | "Move to..." fuzzy dialog (type to search every space/folder, arrows + Enter, current marked) | Missing | Only a nested menu of spaces/folders in the list context menu (`note-list-desk.tsx` l.358); no search field or keyboard dialog. | `src/components/note-list-desk.tsx`, new Move dialog |
| 1A n1 | Space switcher Cmd+O and Cmd+1-9 jump | Partly | Switcher exists with PARA grouping. Shortcuts are Cmd+0 and Cmd+1-5 (core nav items) in `Sidebar.tsx` l.110-118; no Cmd+O, no Cmd+1-9 space jump (page 30 may supersede). | `src/components/Sidebar.tsx` |
| 1H | Folder drag: hover a collapsed folder 600 ms expands it | Partly | DnD engine exists (`lib/dnd.ts`, `components/dnd/*`); auto-expand-on-hover timer not found in sidebar folder rows. | `src/components/Sidebar.tsx`, `dnd/DndHost.tsx` |
| 1B n5 | Marking Done animates newly unlocked topics (180 ms fade-up) | Missing | No unlock transition in `roadmap-tree.tsx` / `roadmap-sheet.tsx`. | `src/views/roadmap-tree.tsx`, `roadmap-sheet.tsx` |
| 1B n4 | Skill tree: hover a node highlights its prerequisite path (course roadmap) | Partly | Done for learning-path graph (`path-graph.tsx` hover, drag-to-connect); course `roadmap-tree.tsx` not confirmed. | `src/views/roadmap-tree.tsx` |
| 1G | Project overview: "91 days · 41% of time used · 48% of tasks done", click deadline to change | Partly | `ProjectHub.tsx` has health, deadline, task board; the exact time-used / tasks-done line and click-to-edit deadline not confirmed. | `src/views/ProjectHub.tsx`, `hub-parts.tsx` |
| 1E′ | Phone skill tree: tap raises peek sheet, drag up for prerequisites | Partly | `roadmap-sheet.tsx` is a sheet; peek/drag-up detents not confirmed. | `src/views/roadmap-sheet.tsx` |

Counts: Missing 2, Partly 5

## Lumen 04 Navigate

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 8A | Palette Cmd+Enter opens in split | Partly | `Palette.tsx` l.305 passes ctrl/meta into `choose`; footer hint present; not verified it opens a split pane. | `src/components/Palette.tsx` |
| 9A/9B | Graph touch: pinch zoom, two-finger pan, long-press drag | Partly | Legend isolate, drag, hover exist (`GraphView.tsx`); no pinch/two-finger handling found. | `src/views/GraphView.tsx` |
| 10A | Canvas: hold Alt to ignore snap | Partly | Snap toggle exists (`CanvasEditor.tsx` l.640); Alt-bypass not found. | `src/components/CanvasEditor.tsx` |
| 10B n3 | Selecting a node highlights its JSON object, and vice versa | Partly | `VisualCodePanel.tsx` has band highlight + goto; two-way selection sync not confirmed. | `VisualCodePanel.tsx`, `CanvasEditor.tsx` |
| 10D | Phone canvas: tap-hold a connect dot to draw an edge | Missing | No long-press connect handling found. | `src/components/CanvasEditor.tsx` |
| 11A | Restore toast offers Undo for 8 s | Partly | Restore exists (`versions/VersionStudio.tsx`, `restoreFromVersion`); toast/Undo timing not confirmed. | `src/components/versions/VersionStudio.tsx` |

Counts: Missing 1, Partly 5


# Gap audit B (static): Lumen 05, 05b, 06, 06b, 07, 07b

Method: design page markup and data arrays read, then searched in `src/` and `worker/`. These pages are mostly built, and in several places the app goes further than the design (Notion/Anki import, multi-token API, Board kind). The pages carry no reference PNGs; they are earlier-round screens (12-22, R2) and were re-audited in r7/r8, so only residual gaps are listed.

## Lumen 05 Review and Slides

Review (12A-D) and Slides/presenter (13A-B) are implemented: 1-4 grading with SM-2/FSRS interval preview, E/S/U/F/B keys, swipe left/right with haptic, summary with "Missed most" and "Review missed again", Study N new, streak, tomorrow count, presenter window, thumbnails (>=1200 px), Note: speaker notes, B blank, phone remote via the `SlidesRemote` Durable Object (`worker/study-remote.ts`).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 13A | Presenter header "08:24 elapsed · 21:52" | Partly | Right-hand text is wall-clock time labelled "elapsed · HH:MM"; the design shows elapsed time and the clock as two values | `src/components/Slides.tsx` (~l.556) |

Counts: Missing 0, Partly 1

## Lumen 05b Productivity

Tasks screen, Learning board (status kanban with front-matter write), database table (column toggles, shift-click secondary sort, inline status/tags edit), properties panel (typed rows, dots, Advanced), study timer (chime, Notification, "Logs to this note") and AI assist (insert below under `## Flashcards`) are all present.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 14C | Month calendar showing note activity: layers "Daily note / Notes created / Tasks due" and a day panel (Daily note link, Tasks due, Created, "Studied · 1 h 05 min") | **Fixed (r8 pass 3: Daily notes / Notes created / Studied time layers, off by default, with day-panel rows)** | The Calendar (`CalendarScreen`) was rebuilt as the round-8 planner (study blocks, events, reviews, tasks). It has no notes-created layer, no per-day daily-note link and no studied-minutes line from timer logs | `src/components/calendar/CalendarScreen.tsx`, `src/lib/calendar.ts` (new CalItem kinds from `db.notes.createdAt` and the timer log) |
| 14A | Tasks lenses "List / Kanban / Calendar" in one screen | Partly | Tasks has List and Board only. Calendar is a separate screen. The "D sets a date" shortcut is absent (keys n, j, k, x, Enter exist) | `src/components/calendar/TasksScreen.tsx` (key handler l.68-73) |

Counts: Missing 1, Partly 1

## Lumen 06 Settings and Data

Appearance (hue, font, size, live preview, Advanced), Branding, Sync, Sharing, Storage, Data > Advanced with "type the space name", phone root list, import dialog (progress, Run in background, Cancel, duplicate policy, tag mapping) and export dialog (note md/html/PDF, vault zip, JSON backup, result summary, fetch & retry, Show in folder) exist. `settings-r6.tsx` has 13 sections plus a search box.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 20A | "Searchable via ⌘K 'settings: …'" | Partly | The palette has a single "Settings" command. There are no per-section entries, so `settings: sync` cannot be typed. Search exists only inside the Settings page. The `lumen:settings-section` event is already wired | `src/components/Palette.tsx` (~l.135), `src/views/settings-r6.tsx` (NAV) |
| 19C | "Tip: share a .md file to Lumen from any app" | Partly | The PWA `share_target` is GET with title/text/url only (`public/manifest.webmanifest` l.19). There is no POST multipart target, so a shared `.md` file is not received | `public/manifest.webmanifest`, service worker or `worker/index.ts` POST `/share`, `src/components/ws-share.tsx` |
| 20D | Phone Appearance with live preview on top | Partly | Not verified at phone width. The preview card exists (`Settings.tsx`) but its position on phone is unconfirmed | `src/views/Settings.tsx` |

Counts: Missing 0, Partly 3

## Lumen 06b Blog and States

Public blog (index, tags with counts, post page, TOC, prev/next, dark toggle, RSS at `/rss.xml`, license from `/public/blog-meta`), empty note list, offline banner, "Kept newer version · View other", delete + Undo toast and the skeleton threshold are implemented.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 22B | "No notes match 'hessain'. Did you mean hessian?" | Missing | `FilterEmpty` shows "Nothing matches {filter} in {where}" with Clear filter and Search all spaces. There is no typo suggestion. MiniSearch fuzzy matching exists but no suggestion list is built | `src/components/note-list-desk.tsx` (FilterEmpty), `src/lib/search.ts` |
| 22C | Review empty "All caught up · Next cards due tomorrow (14) · Generate from a note" | Partly | EmptyState has text plus "Practice anyway" only. There is no "Generate from a note" action (the Assistant's flashcards command exists) and no due-tomorrow count in the empty state | `src/components/Review.tsx` l.245, `src/components/review/ReviewHub.tsx` |
| 22G | Folder or space delete confirm naming the count ("Delete 12 notes in 02 Optimization?") | Partly | Folder delete has no confirm; notes move up one level, with a toast. Space delete uses a native `confirm()`. The designed dialog naming the count is not built | `src/components/Sidebar.tsx` l.698, `src/components/ws-phone.tsx` l.264, `src/views/SpaceView.tsx` l.415 |
| 22H | Publish dialog: Slug, Tags chips, Excerpt, "Private notes linked from this post stay private", Preview, Publish button | Partly | Publishing is a toggle row in the Share sheet (slug and excerpt only). There is no tags editor in the publish step, no Preview and no private-links explanation. The renderer does keep wikilinks non-clickable | `src/components/ShareSheet.tsx` (~l.190-240) |
| 21A/21C | Blog "Tags" tab/page and RSS link in header | Partly | The tag list is in-page (`#tags` anchor, client-side filter). There are no `/blog/tag/x` routes, so a tag view cannot be shared or crawled. `sitemap.xml` lists only posts | `src/views/Blog.tsx`, `worker/index.ts` (sitemap l.658, `ogPages`) |

Counts: Missing 1, Partly 4

## Lumen 07 Visual Workspaces

Chooser (superset: Canvas, Whiteboard, Board, Mermaid, Architecture, Graph, templates, import), canvas toolbar groups and phone tab card, ⋯ conversions, whiteboard sticky colors (`wb/tools.ts` PAPER), Lumen cluster, PhoneDock with palm rejection are in.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R2-1C | Drag a connection dot and release on empty space gives a "New card here" menu | Missing | `onConnectEnd` only clears the connecting flag, so releasing on empty space does nothing | `src/components/CanvasEditor.tsx` l.1339 (`onConnectEnd` with `screenToFlowPosition`) | **Fixed (round 8)**: `endConnect` opens a "New card here" menu (Text card / Link card) and adds the card plus the edge |
| R2-1C | Group captions visible >=1280 px and icon-only below | Partly | Captions are driven by an available-width level (`lvl`), not by the 1280 px breakpoint. Behaviour is close, but the spec is not literal | `src/components/CanvasEditor.tsx` l.1358 |
| R2-1B | Phone chooser "Create canvas" button text changes to "Open graph" for Graph | Partly | Not confirmed; the chooser handles graph via a sessionStorage hand-off | `src/components/NewVisualChooser.tsx` l.62 |

Counts: Missing 1, Partly 2

## Lumen 07b Code Script Mermaid API

Code panel (JSON validation, Line/Go to line, Board keeps last valid state, Ln/Col, selection sync both ways), script console (Examples, Run, Output), Mermaid dialog (250 ms debounce, hand-drawn, frame), Developer sheet (base URL, endpoints, curl/fetch/Python, tokens with scopes and expiry, revoke) and REST (`worker/ext/rest.ts`, `docs/API.md`, OpenAPI, `api_tokens` migrations 0009/0012) exist.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 1H | Auto-apply toggle in ⋯ ("when valid, edits auto-apply") | Missing | Apply is manual only | `src/components/VisualCodePanel.tsx`, JSON panel state in `Whiteboard.tsx` and `CanvasEditor.tsx` | **Fixed (round 8)**: whiteboard JSON panel has an Auto-apply switch (700 ms pause, remembered); the canvas JSON already round-trips live. Phone code sheet: drag the grip to resize (25 to 90 %). Scripts now run in a sandboxed Worker (`lib/script-sandbox.ts`) and one run is one undo step |
| 1I | "Scripts run sandboxed against the board API only" | Partly | Whiteboard scripts run via `new Function` in the page, with `window`, `fetch` and `db` reachable. The canvas `runScript` is the same. A Worker or iframe sandbox is not built | `src/components/Whiteboard.tsx` l.1074, `src/lib/canvas.ts` l.285 |
| 1I | ⌘Z undoes the whole script run; picking an example keeps the previous script in history | Partly | The output says "restore from History" (Version history), not one undo step. Examples overwrite the editor, and the previous script is not kept. The last script is saved in `localStorage` only | `src/components/Whiteboard.tsx` runScript l.1062, `VisualCodePanel.tsx` ExamplesMenu |
| 1I | Script reads notes ("read 6 items from note 'This week'", API labelled `board · sk · note`) | Partly | The whiteboard script API is `board`, `sk`, `log` only, with no note reader. The canvas script has a `notes` metadata helper (no bodies) | `src/components/Whiteboard.tsx` l.1065 (board object), `src/components/CanvasEditor.tsx` l.1130 |
| 1K | Phone script and JSON sheet snaps at 60% and full height; drag handle dismisses, script kept | Partly | The sheet is fixed at 60% height. No second snap and no drag-to-dismiss | `src/components/VisualCodePanel.tsx` l.25 |
| 1N | Token display: hidden "lmn_•••3f9a", Reveal asks passcode and shows 30 s, Copy clears clipboard after 60 s, "last used from 102.x.x.x" | Partly | The design is deliberately different: tokens are shown once at creation and only last4 is kept. There is no Reveal-with-passcode flow and no clipboard auto-clear. `last_ip` is stored but not shown. Regenerate exists only as revoke plus create | `src/views/settings-developer.tsx`, `worker/ext/auth.ts` or `rest.ts` (tokens API) |
| 1N | Endpoint table | Partly | Matches the design (notes, canvas, whiteboard, elements) and adds more. `PUT /api/notes/:id` takes JSON, with Markdown at `/notes/:id/markdown`, not Markdown directly | `docs/API.md`, `worker/ext/rest.ts` |

Counts: Missing 1, Partly 6


# Gap audit C: Lumen 08, 09, 10, 10b, 11, 12, 13 (static; round-8 handoff vs src/ + worker/)

Method note: these seven pages are the most complete part of the app. Almost every frame has a real implementation (not just i18n strings). Only real gaps are listed. Things checked and found Implemented (not listed): per-block `dir="auto"` + forced `{dir=rtl|ltr}` + hover ⇄ (`src/lib/markdown.ts`, `ws-bidi.tsx`, `index.css`); YouTube/Vimeo facade, audio/video/PDF cards with Quote-in-note, link card 4 states + Retry + "Convert to plain link" (`ws-embeds.tsx`); paste-URL chip with per-domain memory (`Editor.tsx`); share sheet all 6 states + toggles + slug/excerpt + sync-off card (`ShareSheet.tsx`); Settings › Sharing list / Turn off / Turn off all / undo 8 s (`Settings.tsx`, `settings-r6.tsx`); public course page (ring, roadmap, locked topics, notes, graph tab), shared note TOC, slides present, flashcards practice, canvas download, whiteboard view-only + PNG, unavailable + loading (`Shared.tsx`, worker `/api/share/*`); five slide layouts + presenter + media flags + image zoom (`Slides.tsx`); too-big dialog/sheet (`StorageTooBig.tsx`); Settings › Storage with largest files, free up device (`Settings.tsx` `StorageSection`, worker `/api/usage`, `DELETE /api/att/:id`); first launch 3 steps, Save to Lumen sheet, back-gesture order, skeletons (300 ms), sync states + error popover (`Welcome.tsx`, `ws-share.tsx`, `App.tsx`, `Skeleton.tsx`, `ws-sync.tsx`); all 130+ glyph names of Lumen 13 exist in `glyphs.ts`, space icon picker with search/colours/shapes/initials (`SpaceIcon.tsx`), no emoji in UI code.

## Lumen 08 Bidi and Embeds
Frames: R2-3A–3D mixed note desktop/phone x Lamplight/Paper, R2-3E Arabic RTL shell (concept, built under Lumen 25), R2-2A embeds desktop, R2-2B embeds phone, R2-2C link preview 4 states, R2-2D paste-URL chip.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R2-2C | "Previews are fetched server-side and cached with the note so they work offline" | Partly | Unfurl results are cached only in this device's `localStorage` (`lumen.unfurl.<url>`), not stored in the note / synced, so a second device or a fresh install shows loading then "failed" until it is online again. | `src/lib/api.ts` `unfurl()`, `src/components/ws-embeds.tsx` `preview()`; persist into note (front-matter/attachment) or a synced `link` record via `src/lib/link-snapshots.ts` |
| R2-2A / 2C | "Same renderer in notes and public posts" (link cards on /s and /blog) | Partly | `GET /api/unfurl` requires auth (`worker/index.ts` l.669, by design to avoid an open fetch proxy) and `unfurl()` returns null with no token, so anonymous visitors of shared/blog pages always get the dashed "failed" card (domain + URL), never title/description/OG image. | Bake the preview into the public payload (`publicNote()` in `worker/index.ts`) or add a cached, allow-listed public unfurl; `src/lib/api.ts` |
| R2-2D | Paste chip lifetime | Partly | Design: chip for 6 s; app keeps it 12 s (`setPaste(null)` 12000). Cosmetic. | `src/components/Editor.tsx` l.252 |

Counts: Missing 0, Partly 3

## Lumen 09 Sharing
Frames: R3-1 levels, R3-1A–C share sheet desktop (link on / space / sync off), R3-1D–F phone, R3-1G/H Settings › Sharing desktop/phone, R3-1I toasts.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R3-1 | Visibility badge "shown the same way in note headers, list items, the tree, the database and space pages" | Partly | Header button is done (`NoteView.tsx` l.166). Note list rows show only a bare link icon or globe, no "Shared"/"Published" pill (`NoteList.tsx` l.341, `note-list-desk.tsx` l.192). Nothing in the sidebar tree, Base/database rows (`BaseView.tsx`, `lib/base.ts`) or the space page header. | `src/components/NoteList.tsx`, `note-list-desk.tsx`, `Sidebar.tsx`/`sidebar-r6.tsx`, `src/views/BaseView.tsx`, `SpaceView.tsx`; one shared `<VisBadge>` |
| R3-1I | Toasts: "5 s, pause on hover", bottom-centre desktop / above tab bar phone | Partly | Durations are 3/6/8 s (undo = 8 s ok) and there is no hover/focus pause (timer is a plain `setTimeout`). | `src/lib/store.ts` `toast()`, `src/App.tsx` `Toasts` |
| R3-1G | "Link expiry dates and passwords are coming later" | (design says later) | Not a gap vs design; FEATURES.md already lists expiry/password as Planned. No backend column or check exists yet. | `worker/index.ts` `sharedRoot()` |

Counts: Missing 0, Partly 2

## Lumen 10 Public Shared Pages
Frames: R3-2A/B course overview (Lamplight / Paper), 2C course graph with hover card, 2D/E overview phone, 2F graph phone, 2G–J shared note desktop/phone.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R3-2C | Graph "Hover shows the card; click opens the shared note" | Partly | Click opens the note; there is no hover card (title/status/excerpt) on the public graph, `SpaceGraph` passes no select/hover to `Canvas2D` although `/api/share/:token` already sends `excerpt`. | `src/views/Shared.tsx` `SpaceGraph`, `src/views/GraphView.tsx` `Canvas2D` |
| R3-2G–J | "Links to unshared notes render as plain text with a faint dashed underline and no target" | Missing | Every `[[wikilink]]` renders as a dotted teal link (`.prose a.wikilink`); when the title is not in the shared space the click does nothing but still looks live. Shared render should downgrade to a non-link span with dashed underline. | `src/views/Shared.tsx` `Md`/`SpaceNote` (post-process anchors against `titles`), `src/index.css` |
| R3-2B | Paper is the "visitor default" | Partly | Visitors get theme `auto` (OS preference) like the app, not Paper. | `src/views/Shared.tsx` `useTheme()` / `src/lib/settings.ts` default for `/s/*` |
| R3-1 (cover) | Link "not listed, not in RSS, **not indexed**" | Partly | `robots.txt` only has `Disallow: /s/`; no `X-Robots-Tag: noindex` header or `<meta name="robots">` on `/s/*` HTML or `/api/share` responses, so linked URLs can still be indexed. | `worker/index.ts` robots + `worker/ext/og.ts` `page()` |

Counts: Missing 1, Partly 3

## Lumen 10b Visitor Types
Frames: R3-2K shared slides page, 2L/2M visitor presenter desktop/phone, 2N/2O shared flashcards practice, 2P canvas, 2Q whiteboard, 2R/2S phone boards, 2T/2U link unavailable, 2V loading.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (all) | No functional gaps found vs these frames; everything is rendered by `Shared.tsx` (`SlidesPage`, `FlashcardsPage`, `BoardPage`, unavailable and loading components). | n/a | Only cross-cutting items already listed under Lumen 10 (unshared wikilinks, noindex, visitor theme). Unverified in a browser: the phone "rotate for full screen" for the visitor presenter and `F` fullscreen. | `src/views/Shared.tsx` |

Counts: Missing 0, Partly 0

## Lumen 11 Slides Media and Storage
Frames: five-layout key, R3-3A presenter desktop (video slide), R3-3B presenter phone, R3-4A attachment states in a note, R3-4B too-big dialog, R3-4C phone sheet, R3-4D Settings › Storage desktop, R3-4E phone.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R3-4A | Attachment states in a note: "Uploading 3/7 parts · already viewable on this device" with % bar, "Queued · will upload when online", "Synced · 48 MB · streams by range" | Missing | No per-attachment status UI exists anywhere. `uploadPending()` loops parts silently and only flips `blobs.uploaded` 0 to 1; progress is not stored or observable, and a failed upload restarts at part 0 (not resumable). Queued/uploading/synced cannot be seen on image/video/pdf/audio cards. Settings only lists cached blobs. | `src/lib/attachments.ts` (emit progress per part, persist `partsDone` in `db.blobs`), status chip in `src/components/ws-embeds.tsx` cards + `Preview.tsx` file/image blocks |
| R3-4D/E | "1.38 GB of 5 GB", "no paid storage, 5 GB total" | Partly | Server measures against a D1 database cap (`d1Limit`, 500 MB default on Workers Free, `worker/ext/settings.ts` l.6) and files live in D1 `file_parts`; the 5 GB figure is only reachable via R2 (`FILES` binding, optional). UI therefore shows MB-scale limits and pauses uploads at 98 % of 500 MB, which contradicts the design's headline. Needs a decision (R2 bucket for files, D1 for notes) and separate Notes / Files bars. | `worker/ext/settings.ts` `/usage`, `worker/index.ts` `/att` (R2 path), `src/lib/attachments.ts` `storageRoom()`, `src/views/Settings.tsx` `StorageSection` |
| R3-4D | "Drop older attachments from this device" | Partly | A single "Free up space" action exists; no per-age rule / "older than N days" choice or automatic eviction when browser quota is near. | `src/views/Settings.tsx` l.526, `src/lib/attachments.ts` |

Counts: Missing 1, Partly 2

## Lumen 12 Android Loading Sync
Frames: R3-5A–C first launch (theme, name blog with keyboard, sync or local), 5D Android share sheet (system), 5E Save to Lumen sheet, 5F safe areas + back gesture, skeletons (list/note/board/graph), sync indicator states and error popover.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R3-5B | "The window resizes with the keyboard (adjustResize), so Continue rides above it" | Partly | `AndroidManifest.xml` sets no `android:windowSoftInputMode` on either activity (only `configChanges`), and no `visualViewport` handling in JS, so keyboard-up behaviour depends on the WebView default. Needs on-device check. | `android/app/src/main/AndroidManifest.xml`, `capacitor.config.json` (Keyboard `resize`) |
| R3-5F | "Edge strips (20 dp) reserved for the system back swipe; canvas/whiteboard panning starts inset; sheets pad by the gesture inset; keyboard toolbar sits on the IME inset" | Partly | Only `.safe-b` / `.safe-t` (`env(safe-area-inset-*)`) exist. No 20 dp edge guard on canvas / whiteboard / roadmap horizontal drags, and no IME inset for the editor toolbar. Back-gesture order (sheet, mode, keyboard, back, "swipe again to exit") is implemented in `App.tsx`. | `src/index.css`, `src/components/CanvasEditor.tsx`, `src/components/wb/*`, `src/components/Editor.tsx` toolbar |
| R3-5A–C | Onboarding with exactly three steps: Theme (Lamplight / Paper), Name your blog (Skip), Sync or stay local | Partly | Built, but the sequence is different: the app has an extra "Your lamp colour" step and Welcome/unlock screen before it, so first launch is not the design's 3 steps (`head` array in `Welcome.tsx` l.325 is theme / lamp colour / blog name; sync step is in the unlock screen). Cosmetic ordering. | `src/views/Welcome.tsx` |

Counts: Missing 0, Partly 3

## Lumen 13 Icon System
Frames: R4 B1–B6 glyph groups, size/tile rules, space icon picker, before/after emoji.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (all) | No gaps found: every glyph name from B1–B6 plus shapes/subjects exists in `src/lib/glyphs.ts`; picker (desktop popover and phone sheet, search, preset colours, Subjects, Shapes · initials, preview) in `SpaceIcon.tsx`; legacy emoji map in `space-icon.ts`; no emoji literals in UI code (only task-syntax in demo data / parsers). | n/a | Not browser-verified: tile radius 28 % and 14 % tint on every surface. | `src/components/Glyph.tsx` |

Counts: Missing 0, Partly 0


# Part D: gap audit, Lumen 14 to 20b (static)

Context: these nine pages are byte-identical to the round 4 handoff (2026-11-19-round-4). Round 4 was applied and audited, so this area is mature. Every frame family has a real implementation under `src/` (views `path-*.tsx`, `roadmap-*.tsx`, `hub-*.tsx`, `BaseView`, `DashboardView`, `PdfReader`, `TodayView`, `SmartFolders`, `slides-deck`, `editor-*`, `PasteMenu`) and the backend pieces the design implies exist in `worker/` (`ext/home.ts` unlock lockout in D1 `unlock_attempts`, `ext/access.ts` devices, `study-remote.ts` Durable Object for the phone remote, `/att` 1.5 MB D1 parts for PDFs, `ext/ask.ts`). Method limits: static only; I confirmed code paths and strings exist, not pixel parity or runtime behaviour. Items I could not prove either way are listed under "Not verifiable statically" at the end.

## Lumen 14 Learning Paths
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | 14A-14M: stage columns collapse to 44 px strip, course chips + "+N more" searchable list, Overlaps panel (Merge / They're different), concept sheet (mastery, prereqs dashed amber removable, practice quiz with save wrong as flashcards, 14-day mastered rule), Graph/Matrix/Timeline/Revise (ladder 1,3,7,14,30,60,120), phone accordion + filter sheet, New path dialog with Organize preview | Implemented | none | `src/views/path-*.tsx`, `src/lib/path.ts`, `src/components/ConceptPractice.tsx`, `NewPathDialog.tsx` |

Counts: Missing 0, Partly 0

## Lumen 14b Graph and Connections
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 14b-C | Display panel "Layout" segment: By stage / Top-down / Radial / Free on the learning-path Graph tab | **Fixed (r8 pass 3: Radial added to the path graph)** | Path graph offers only By stage, Top-down, Free (`LAYOUT_LABEL` in prereq-ui). Radial exists only in the notes Graph (`GraphView.tsx`, `lib/graph-layout.ts` "radial") and is not wired for the path/skill-tree graphs | `src/components/prereq-ui.tsx` (`PrereqLayout`, `LAYOUT_LABEL`), `src/views/path-graph.tsx` `layoutFor`, reuse `graph-layout.ts` radial |

Everything else on 14b is present: link vocabulary (`linkLook`), edge shapes curved/elbow/straight, Tidy up preview + Apply + Undo toast + Shift T (`graph-display.tsx isTidyKey`), keep pinned cards, hide implied links with hover dots, bundle links, drag-to-connect with valid/loop/implied/duplicate checks, link menu (type, reverse, remove) with phone variant, spacing Compact/Roomy.

Counts: Missing 0, Partly 1

## Lumen 15 Roadmaps and Project Hub
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | 15A-15U outline drag insert line / drop-on-middle prerequisite / refused loop, builder with "Add all N as topics", skill tree link menu, timeline drag with ghost + tooltip, topic sheet with inline delete confirm, Hub tabs Overview / Docs / Board / Requirements (MoSCoW + traceability) / Timeline (Gantt from cards) / Diagrams (`epicMermaid`, `traceMermaid`) / Assistant weekly status, health "Why at risk" | Implemented | none | `src/views/roadmap-*.tsx`, `ProjectHub.tsx`, `hub-*.tsx`, `src/lib/project.ts` |

Counts: Missing 0, Partly 0

## Lumen 16 Editor and Read
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 16I | Paste of a lone link: "Choice is remembered per domain" | Missing | The Preview card / Embed / Plain link chip never persists the pick; no per-host store exists (`PasteChoice` in `Editor.tsx` has no storage). Also "Embed" is only offered for YouTube/Vimeo/media/PDF URLs (`EMBEDDABLE`), not any URL as the frame implies | `src/components/Editor.tsx` (paste handler ~l.192-300 and ~l.381), a small `lumen.pasteChoice` host map (device-local like `lumen.slashRecent` in `src/lib/slash.ts`) |

Rest of 16 verified present: slash menu with recent group and aliases and NoResults suggestion, Insert gallery with preview pane, block handle / Turn into / multi-select (shift/ctrl click, phone long-press), block-ref autocomplete + 1.2 s arrival wash, long-text paste menu (Keep, Clean up, As quote, As link card, Summarize, Make flashcards), Fixed/Wide/Full width, sticky/zebra/sortable tables.

Counts: Missing 1, Partly 0

## Lumen 17 Slides Focus Diagrams
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | 17A-17I: 12 layout keys + invert/accent in `lib/deck.ts`, Arrange mode with drag reorder + layout picker, doc to deck dialog (Split at, Present without saving, Save as deck), Overview grid (O), phone remote (DO in `worker/study-remote.ts`), Focus Read/Write (outline drawer, highlighter, read aloud, typewriter), `.mermaid` file split view + export dialog (SVG/PNG/JPEG/WebP, size estimate, Copy/Download), Settings Reading/Diagrams, New visual chooser | Implemented | none | `src/components/slides-deck.tsx`, `Slides.tsx`, `FocusView.tsx`, `DiagramFile.tsx`, `DiagramExport.tsx`, `NewVisualChooser.tsx` |

Counts: Missing 0, Partly 0

## Lumen 18 Bases and Dashboards
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | 18A-18Q: filter popover (any-of groups, same operators as search), in-place cell editors, board drag writes property + toast, gallery, grouped list, calendar with date property in View settings, phone table/board, "also in N groups" chip, group by tag, dashboard edit grid (12 col drag/resize), Table toggle per chart, Add tile wizard (sources: cards, sessions, path, notes, base) with live preview, phone dashboard | Implemented | none | `src/views/BaseView.tsx`, `DashboardView.tsx`, `src/lib/base.ts`, `dashboard.ts`, `src/components/charts/*` |

Counts: Missing 0, Partly 0

## Lumen 19 PDF Cloze Occlusion
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | 19A-19J: highlight bar (5 colours, Note, Card, Copy, Link), highlights panel, Area mode with image crop, search hits on pages + thumbnails, dark inversion, "Continue where you left off", loading in 1.5 MB D1 parts, password prompt (not stored), scanned-PDF pill, phone bar and highlights sheet; occlusion editor + cloze | Implemented | none | `src/components/PdfReader.tsx`, `pdf-*.tsx`, `OcclusionEditor.tsx`, `worker/index.ts` `/att` parts, `migrations/0003_file_parts.sql` |

Counts: Missing 0, Partly 0

## Lumen 20 Today Ask Review Nav
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| Unlock (backend) | Wrong-passcode lockout "doubles, max 24 h" | Partly | The UI path is correct (`home-lock.ts` posts to `/api/unlock`, D1 `unlock_attempts`, doubling to 24 h in `worker/ext/home.ts`). But the old `POST /api/login` in `worker/index.ts` is still routed with only a per-isolate in-memory brake (5 tries then up to about 2^8 min, resets on cold start, no `attemptsLeft`). `lib/api.ts login()` is unused by the UI, so this is a hardening leftover, not a user-visible gap | `worker/index.ts` `/login` (delete it or make it delegate to the D1 counter in `worker/ext/home.ts`) |

Verified present: Today (Start, Done, Skip, Move to tomorrow + Undo, reschedule missed days, phone), Study plan log note + Settings Study plan (daily minutes, study days, max new lessons, course priority drag, weekly goals), Ask (cited answer, Copy with citations, Make flashcards, scope menu, history), FSRS settings (target retention + dashed comparison, Advanced, Optimize from history), back/forward + breadcrumb + long-press history, phone exit toast, Simulator drawer, Forgot passcode sheet, Leave demo, expired-token banner + Unlock again.

Counts: Missing 0, Partly 1

## Lumen 20b Smart Folders Video Big Vaults
| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (none found) | Smart folders (editor sheet, glyph + colour, pin, live count, Save as base, save search as smart folder, operator chips incl. course:/space:/has:), video notes (Alt+T, `[mm:ss]` chips, grey chip when no video, dock/undock, speed), big vaults (Indexing N / total, Showing 200 of N + Show 200 more), unlinked mentions + Link all + ignore, tag nodes in graph | Implemented | none | `src/components/SmartFolders.tsx`, `src/lib/smart.ts`, `editor-video.ts`, `video-dock.tsx`, `lib/search.ts`, `lib/big-vault.ts`, `RightPanel.tsx` |

Counts: Missing 0, Partly 0


# Gap audit E: Lumen 21-26 (round 8 handoff, static)

Overall: these six pages are almost fully built. Docs (CHAT_AND_TUTOR, IMPORT, I18N) were checked, then each claim was verified in code. Imports are client-only by design (no Worker import endpoint needed). Chat/tutor Worker routes (`worker/ext/chat.ts`, `worker/ext/tutor.ts`), the `ai_usage` meter and daily limit (`worker/ext/ai-usage.ts`) and generic `items` sync for kind `chat` all exist and are wired. Runtime-only visuals (animations, exact spacing) were not judged.

## Lumen 21 Assets and Components R4
Sheet without numbered frames (sections: C Empty states, Moments, Outside the app, Component sheet).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| C-Empty (8th tile) | Today empty state "Nothing planned. Today is a rest day." + "Plan anyway" | **Fixed (r8 pass 3: rest-day card + Plan anyway forces the plan)** | Arabic string exists in `src/i18n/ar/home.ts:85` but no English call site. Today shows a dashed "Nothing scheduled yet. Plan my day" button (`src/views/TodayView.tsx:141`) with no rest-day detection and no "Plan anyway" action. Logic: `plan.ts` already has a "plan lessons even on a rest day" option to hook to. | `src/views/TodayView.tsx`, `src/lib/plan.ts` |
| C-Outside | Play feature graphic 1024x500 and store screenshot frame | Partly | Only design HTML templates (`design/assets/play-feature-graphic.html`, `play-screenshot-frame.html`). No exported PNGs or export script in `scripts/`; nothing wired into the Android listing. OG image (`worker/ext/og.ts`) and the favicon due badge (`src/lib/favicon.ts`) are done. | `scripts/`, `android/` store assets |

Counts: Missing 0, Partly 2

## Lumen 22 Scale and Long Content
Sheet without numbered frames. Checked and found implemented: truncation rules (`file-name.tsx`, breadcrumb "..." in `NoteView.tsx:238`, 3 chips then +N), virtualised note list and date scrubber (`date-scrubber.tsx`), Outline jump, table paging with "Open as base" (`table-pager.ts`), backlinks grouped over 20 (`grouped-links.tsx`), compact Stages with "+N more" (`views/path-compact.tsx`), grouped graph over 300 notes (`graph-big.tsx`), simple-view fallback note (`GraphView.tsx:516`), Today trimming and "Moved to tomorrow", review backlog "Do 50 now / Spread over 7 days" (`review-backlog.tsx`), first sync (`first-sync.tsx`), storage limit and "Review largest files" (`settings-r6.tsx`, `attachments.ts`), palette "Showing 50 of N" with narrowing filters. No static gap found; remaining differences would be pixel or perf level and need a browser.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| none | | | | |

Counts: Missing 0, Partly 0

## Lumen 23 Ask Chat
Frames 23A-N: thread with rewrite note, Paper, streaming/Stop, empty + 3 starters, not in your notes, general knowledge, offline, locked, error/retry, phone x4, Arabic phone and desktop. All states exist in `src/components/AskVault.tsx` / `ChatParts.tsx` (thread list with Pinned/Today/Earlier, search chats, rewrite line, summarized divider, citation chips, source cards, Copy / Save as note / Make flashcards / Regenerate / thumbs, follow-up chips, offline/locked/error banners, Stop, queued send). Backend present (rewrite, answer, followups, summarize ops; 429 limit banner).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (no frame; behind 23/24) | Separate Ask / Chat / Tutor on-off switches | Partly | Worker honours `aiOff` ids `ask`, `chat`, `tutor` (`worker/ext/chat.ts:83`, `tutor.ts:67`), but Settings > AI only lists summarize / flashcards / explain / tags / quiz / roadmap / voice (`src/views/settings-ai.tsx:18-24`). Chat and tutor can only be turned off with the global switch. Also noted in docs/CHAT_AND_TUTOR.md. | `src/views/settings-ai.tsx` |

Counts: Missing 0, Partly 1

## Lumen 24 Tutor Modes
Frames 24A-S: Explain / Socratic / Feynman (Lamplight + Paper), summary, no notes, signed out, offline, phone x5, Arabic x3. All in `src/components/TutorSession.tsx` + `src/lib/tutor.ts` + `worker/ext/tutor.ts` (hint ladder, verdict labels, quoted Feynman issues, four clarity bars, suggested cards with checkboxes, Mark learned, Schedule review, concept picker, past sessions, End session, note menu Tutor items). No static gap found. Minor: Feynman dictation uses the browser Web Speech API and is explained where unsupported (documented, not in the frames).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| (see 23) | Tutor on/off switch in Settings > AI | Partly | Same gap as Lumen 23 (no `tutor` / `chat` toggle in the UI). | `src/views/settings-ai.tsx` |

Counts: Missing 0, Partly 1

## Lumen 25 Arabic Interface
Frames 25A-O: Home, Today, Notes workspace, Read, Path stages, Review, Settings > Language, Palette, phone Home / More / Today / Read / Review / Path. Mirroring, logical CSS, Plex Sans Arabic UI, Naskh reading font, Arabic-Indic digits toggle, palette highlight by colour only (`Palette.tsx:41`), LTR islands for code and kbd are all in place (`src/index.css:46-65`, `src/lib/i18n.ts`, `src/i18n/ar/*`).

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 25H | Date format control under Language ("Digit style and date format sit right under it") | Partly | Settings has Language and Numbers only (`src/views/Settings.tsx:212-213`). No date-format option exists; dates follow the fixed Gregorian `fmtDate`. | `src/views/Settings.tsx`, `src/lib/i18n.ts` (fmtDate) |
| RTL plan views (not a 25 frame; spec line "timelines run right to left") | Gantt / course timeline mirroring | Partly | Known open item in `docs/audit/r8-final.md`: the time axis still runs left to right in Arabic while labels sit on the right. | `src/components/plan/plan-views-parts.tsx`, `src/components/plan/CourseTimeline.tsx` |

Counts: Missing 0, Partly 2

## Lumen 26 Imports
Frames 26A-P: source cards + drop, drag-over, reading, preview (Obsidian conflicts, Anki mapping, Notion bases), target, importing counts, result + Undo, Notion wrong-format error, phone x5. `src/components/ImportDialog.tsx` (745 lines) plus `src/lib/import-*.ts` cover the full flow, including Run in background, recent imports with Undo, Import report note, merge/rename/skip, field mapping, "Keep review history" and per-view base choice.

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 26J | Notion preview lists "synced blocks that can't come over" up front | Partly | Embeds are counted by provider, but synced blocks leave no marker in the export so they are never counted or listed (stated in docs/IMPORT.md). | `src/lib/import-notion.ts` (cannot be fully solved from the export) |

Counts: Missing 0, Partly 1


# Gap audit F: Lumen 27-32 + Lumen Components (static)

Method note: all seven pages and their helper desks (AccountDesk, SettingsDesk, SideNav, SideNav2, NoteTabsDesk, BigDataDesk, Lumen Components) are byte-identical in round 6, 7 and 8. The code was built against them (docs/ACCOUNTS.md, NOTE_TABS.md, TAGS.md), so almost every frame is Implemented. Only gaps I could confirm in code are listed. Settings is device-local by design ("Changes apply instantly on this device"), so non-sync of settings is not counted as a gap.

## Lumen 27 Accounts

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R5-27E..T (all "ACTIVE" frames) | Sign in, register, verify, recovery, profile, delete | Partly | The whole flow is built but behind `accountsEnabled()`, which is OFF by default. No user can see it until the `ACCOUNTS_ENABLED` var, a D1 `meta.accounts_enabled` row and the Google/Resend secrets are set. | `worker/ext/auth.ts`, wrangler vars and secrets (docs/ACCOUNTS.md "How to turn it on") |
| 27F | Register form links "terms" and "privacy" | Missing | The links go to `/terms` and `/privacy`. No such pages, routes or static files exist. | `src/App.tsx` route, `public/terms.html`, or a Worker route |
| 27E/27K | Continue with Google on Android | Partly | The OAuth redirect returns to the web origin. There is no Capacitor custom-tab or deep-link return, so Google sign-in is not usable in the Android app. Email, password and magic link work. | `src/lib/auth.ts` (Capacitor Browser plus appUrlOpen), `worker/ext/auth.ts` `/auth/google/callback` |
| 27M | Signed-in user's data surface | Partly | Sessions get 403 on attachments PUT, notes/canvas/whiteboard REST, AI (`/api/ai/*`, transcribe), API tokens, device list, share links and blog publishing. A real user can sync items only. Files, AI, sharing and the blog need a per-user `uid` on `file_meta`/`file_parts`/share/blog and a user branch in the AI gate. | `worker/ext/auth.ts` `authGate`, `worker/index.ts`, new migration (`file_meta.uid` etc.), `worker/ext/ai-usage.ts` |
| 27M | Profile language and time zone | Partly | Stored on the user row, but not applied to the UI on sign-in (left to the i18n layer). | `src/lib/auth.ts` after `/auth/me`, `src/lib/i18n.ts` `setLang` |
| 27E/27F | Bot protection and stronger sign-in | Missing | No Turnstile/CAPTCHA on register (rate limits only). No 2FA or passkeys for accounts. Not drawn in the design, but a launch blocker in ACCOUNTS.md. | `worker/ext/auth.ts` `/auth/register`, `src/components/auth/SignIn.tsx` |
| 27E | Owner signs in with an account | Missing | The passcode stays a separate path. `users.role = 'owner'` is not built (deliberate). | `worker/ext/auth.ts`, `worker/index.ts` `auth` middleware |

Counts: Missing 3, Partly 4

## Lumen 28 Components R5

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| Account card, Google button, password meter, "Coming soon" card | Account components | Implemented | `auth-ui.tsx` (GoogleButton, `passwordStrength`) and the `AccountSection` dashed card. | none |
| Chat, Tutor, Language switch, Import cards | Chat/tutor/import components | Implemented | The matching components exist (`src/components/ask`, `TutorSession.tsx`, `ImportDialog.tsx`, `settings-language.tsx`). | none |

No gaps found on this page.

Counts: Missing 0, Partly 0

## Lumen 29 Settings

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R6-29R | Sync › Advanced "Conflict policy" | Missing | The Advanced header says "Conflict policy · reset local cache", but there is no conflict-policy control. Advanced holds only the classic SyncSection and the App lock. `src/lib` has no policy setting. Conflicts are handled only by the conflict screens in `components/versions`. | `src/views/settings-r6.tsx` SyncR6, `src/lib/conflicts.ts` and `settings.ts` (new pref) |
| R6-29O | Reading › Advanced "footnote style" | Missing | The design lists "Hyphenation · footnote style · code wrap". Hyphenation and code wrap exist. There is no footnote-style pref and `markdown.ts` always renders the superscript number with a back-link arrow. | `src/views/settings-r6.tsx` line ~351, `src/lib/markdown.ts` (footnote renderer), `settings.ts` |
| R6-29I | Simulator "Upload fails at 60%" | Partly | `DevPanel` has Upload fails and File too big, but nothing that fails mid-progress. The design also shows the simulator as a bottom drawer with a top-of-app banner. Worth a visual check. | `src/lib/sim/faults.ts`, `src/lib/attachments.ts`, `src/views/DevPanel.tsx` |
| R6-29Q | Diagrams › Hand-drawn look | Partly | `diagramHand` is read only in `diagram-view.tsx` (the Diagrams tab/viewer). Editor Mermaid blocks, Read mode and exports don't clearly follow it. | `src/components/diagram-view.tsx`, `Editor.tsx`, `lib/diagram-export.ts` |
| R6-29P | Review algorithm SM-2 vs FSRS | **Fixed (r8 pass 3: Review.tsx is the only scheduler; the workload forecast now follows srsAlgo too)** | `srsAlgo` is read in `Review.tsx` only. Today workload, due-card counts and the plan builder don't use it. | `src/components/Review.tsx`, `src/lib/due-cards.ts`, `src/lib/workload.ts` |
| R6-29A..E | AI limit enforcement on streaming routes | Partly | The gate covers `/api/ai`, `/api/ai/*` and `/api/transcribe`, and chat/ask/tutor/practice/hub live under `/ai/*`, so all are gated. Billing for streamed replies is estimated from body size, not real usage, so the meter is approximate. | `worker/ext/ai-usage.ts` |

Counts: Missing 2, Partly 4

## Lumen 30 Sidebars Tags Spaces

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R6-30A..C | Space switcher | Implemented | Search, pinned spaces with Cmd+1-9, "Show all N", Archived, Accounts with Switch and New space are all in `Sidebar.tsx` and `AccountSwitcher.tsx`. | none |
| R6-30D..U | Sidebar, note list, multi-select, tag page, picker, history, phone drawer | Implemented | Present in `Sidebar.tsx`, `NoteList.tsx`, `note-list-desk.tsx`, `TagPage.tsx`, `TagPicker.tsx`, `HistoryPanel.tsx`. | none |
| 30-wide | Pinned spaces and sidebar layout across devices | Partly | Sidebar prefs (`pinnedSpaces`, width, hidden items, row height) live in local `sidebar-r6.tsx` prefs. They aren't synced like tag colours (`lumenTagMeta`), so a second device starts from defaults. | `src/components/sidebar-r6.tsx`, a synced settings record (not built) |

Counts: Missing 0, Partly 1

## Lumen 30b Sidebar Best Practice

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| 30b-A..N | Checklist, desktop, rail, tablet, phone, customise, keyboard map | Implemented | `sidebar-r6.tsx` (customise sheet, `?` keyboard map, `resetSb`), tree keyboard model, resize 200-360 with double-click reset, offline footer. No gap found by static review. Runtime items such as Smart folders folded by default on tablet and the contrast ratios need a browser check. | none |

Counts: Missing 0, Partly 0

## Lumen 31 Note Tabs and Assistant

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R6-31A..T | Diagrams, Media and Links tabs, Assistant (chat, empty, limit, offline, rail, phone sheet) | Implemented | All present: `DiagramsTab.tsx`, `NoteTabs.tsx`, `Assistant.tsx` (Back tomorrow, offline card, Ctrl+J, 72% sheet with swipe), `link-snapshots.ts` and `worker/ext/links.ts`. Only a browser check could find residual gaps. | none |
| 31I/31K | Link preview works offline | Partly | Snapshots are cached on the device only after a click. There is no background prefetch. `/api/links/snapshot` is auth-only, so it fails for a shared or signed-in user session (403). | `src/lib/link-snapshots.ts`, `worker/ext/links.ts` |

Counts: Missing 0, Partly 1

## Lumen 32 Big Data and Customization

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| R6-32A..J | Too-big banner, grouped, tree, skill tree, folder tree, 47-video note, phone | Implemented | `views/graph-big.tsx`, `path-compact.tsx`, `FoldersView.tsx` (virtualised, sticky path headers), `lib/big-vault.ts`. | none |
| 32F | Media tab with 47 videos, filters, lazy thumbnails | Partly | The "thumbnails at once" setting exists. I found no filter bar (kind or status) in the Media tab for very large lists. Verify in a browser. | `src/components/NoteTabs.tsx` Media panel |

Counts: Missing 0, Partly 1

## Lumen Components

| ID | Feature | Status | What's missing | Where it would live |
|---|---|---|---|---|
| Inputs | Error state ("bad slug!" + hint "Use lowercase letters, numbers and dashes.") | Partly | `inputCls` documents `aria-invalid` styling, but the blog slug field (`ShareSheet.tsx`) silently slugifies on input. No invalid style or hint text is shown. Only `settings-review` and the PDF password field use `aria-invalid`. | `src/components/ShareSheet.tsx`, `src/components/ui.tsx` Field hint/error |
| Inputs | Slug uniqueness | Missing | Nothing tells the user when a published slug collides with another post. | `ShareSheet.tsx`, publish handler in `worker/index.ts` |
| Buttons | "Touch 48+" size | Partly | `Button` has sm 28, md 36 and lg 48, so the size exists. There is no shared touch-target rule for icon buttons on phone. | `src/components/ui.tsx` IconButton |
| Components sheet | The remaining basics (chips, list items, callouts, code, math, flashcard, toast, dialog, palette, sheet, tab bar, link card, PDF card, heatmap, whiteboard tools, stickies) | Implemented | Present across `ui.tsx`, `index.css`, `editor-blocks.ts`, `charts/Heatmap.tsx`, `wb/cards/CardView.tsx`, `components/wb/*`. | none |

Counts: Missing 1, Partly 2


## Summary

### Counts (Missing / Partly)
00: 0/0 | 01: 2/1 | 02: 6/5 | 03: 2/5 | 04: 1/5 | 05: 0/1 | 05b: 1/1 | 06: 0/3 | 06b: 1/4 | 07: 1/2 | 07b: 1/6 | 08: 0/3 | 09: 0/2 | 10: 1/3 | 10b: 0/0 | 11: 1/2 | 12: 0/3 | 13: 0/0 | 14: 0/0 | 14b: 0/1 | 15: 0/0 | 16: 1/0 | 17: 0/0 | 18: 0/0 | 19: 0/0 | 20: 0/1 | 20b: 0/0 | 21: 0/2 | 22: 0/0 | 23: 0/1 | 24: 0/1 | 25: 0/2 | 26: 0/1 | 27: 3/4 | 28: 0/0 | 29: 2/4 | 30: 0/1 | 30b: 0/0 | 31: 0/1 | 32: 0/1 | Components: 1/2

### Top 15 gaps
1. Accounts (27) are invisible in production: all sign-in, register, profile, sessions and delete UI sits behind `accountsEnabled()` (off), and signed-in users get 403 on files, AI, sharing, blog and tokens until per-user scoping exists. `/terms` and `/privacy` (linked from register) do not exist; Google sign-in has no Android return.
2. Attachment upload state (11/R3-4A) is missing: no queued / "3 of 7 parts" / synced on file cards; `uploadPending()` in `src/lib/attachments.ts` retries from part 0 silently.
3. Storage numbers contradict the design: it says "of 5 GB" but the server caps at 500 MB D1 (`worker/ext/settings.ts` `d1Limit`), uploads pause at 98%.
4. Visitors never see link-preview cards on shared/blog pages (`/api/unfurl` needs login); previews are only in localStorage, not cached with the note.
5. Note-mode keyboard shortcuts (02): Mod+1-6, Mod+4 focus, Mod+Shift+\, Mod+Shift+B/O, and note list J/K/P are not bound (Mod+1-5 go to sidebar nav).
6. Wiki-link hover preview card (400 ms) and Cmd-click open in split do not exist; wikilinks to notes outside a shared space still look live (10).
7. "Move to..." (03/02) is a nested menu, not the fuzzy-search dialog across spaces; "Save as template" is missing from the note menu.
8. Phone/tablet gestures (01-04): long-press "+" speed dial, hold to dictate, swipe-down to exit Focus, tablet left-edge swipe for the sidebar, hover-expand folders while dragging, tap-hold connect dot on phone canvas.
9. Android back-swipe/keyboard (12): no `adjustResize`/IME-inset toolbar in `AndroidManifest.xml`, no 20 dp edge-swipe guard on boards, toasts do not pause on hover.
10. Canvas: dragging a connection dot onto empty space does nothing (design opens "New card here"; `CanvasEditor.tsx` `onConnectEnd`).
11. Publish (06b): the Share sheet has only a toggle; no tags editor, Preview or "private notes stay private" note; slug field has no error/collision check; no `/blog/tag/x` routes. Folder delete has no confirm and space delete uses native `confirm()`.
12. Public pages (10): course graph has no hover card, visitors get OS theme not Paper, `/s/*` has no noindex; Shared/Published badge only in the note header (not list rows, sidebar, bases).
13. Settings gaps (29/25): Sync > Advanced "Conflict policy" has no control; no "footnote style" option; no separate Ask/Chat/Tutor switches (worker enforces them); no date-format setting; `srsAlgo` (SM-2/FSRS) honoured only in `Review.tsx`; hand-drawn look only in `diagram-view.tsx`.
14. Today (20/21): no "Nothing planned. Today is a rest day" state or "Plan anyway" button; Calendar lacks notes-created, daily-note and studied-minutes layers (14C day panel); empty search has no "Did you mean" suggestion.
15. Whiteboard scripts (07b) run via unsandboxed `new Function` (`Whiteboard.tsx` ~l.1074), one Cmd+Z does not undo a run; code panel has no auto-apply toggle and the phone sheet is fixed 60%. Also: paste-link chip (16I) does not remember the choice per domain, Radial layout missing in path graph, legacy `/api/login` has only an in-memory brute-force brake, Arabic Gantt/course timeline not mirrored.


# Round 9 status (agent: notes/spaces/publish/settings/mobile, 2026-11-22)

Checked in browser (demo): Ctrl+3 read mode, Ctrl+Shift+B panel, wiki-link hover card. tsc, worker tsc and vite build pass.

| Item | Status |
|---|---|
| 02 Cmd+1-6 modes, Cmd+4 Focus toggle, Cmd+Shift+B/O panels | Done (capture-phase in `NoteView.tsx`; sidebar Cmd+1-5 still works when no markdown note is open) |
| 02 Cmd+Shift+\ hides the note list | Done (`App.tsx`); the "both collapsed = 96% width" state not added |
| 02 J / K / P in the list | Done (`NoteList.tsx`) |
| 02 wiki-link hover card 400 ms, Ctrl/Cmd-click opens split view | Done (`wiki-hover.ts`, `Preview.tsx`) |
| 10 links to unshared notes are plain text on shared pages | Done (`Shared.tsx`) |
| 03 Move to... fuzzy dialog (list menu, bulk bar, note menu) | Done (`dialogs-r9.tsx`) |
| 02 Save as template | Done: copies the note into a top-level "Templates" folder of its space; "My templates" in the New-from-template sheet |
| Folder delete confirm, space delete in-app confirm | Done (`ConfirmHost`); other native `confirm()` calls elsewhere untouched |
| 06b tags editor, Preview, private-notes note, slug collision, /blog/tag/:tag (app + worker) | Done |
| 06b Shared / Published badge | Rows already had it; added a "Visibility" base column. Sidebar has no per-note rows to badge |
| 10 visitors default to Paper; X-Robots-Tag noindex on /s/* | Done |
| 10 unfurl for visitors | Partly: `GET /api/public/unfurl` is cache-only (edge cache filled by signed-in `/api/unfurl`); not stored in the note, so previews can lapse after the cache expires |
| 10 course graph hover card | Not done |
| 11 upload state on file cards (queued / "3 of 7 parts") | Done (`attachments.ts` progress + chip in `markdown.ts`) |
| 11 resumable upload from last part | Done (`GET /api/att/:id/status`; older Worker falls back to full send) |
| 11 storage meter | Already shows the real server cap (`limitBytes`, 500 MB D1 default) in the design layout; the design's "5 GB" kept out on purpose |
| 29 conflict policy (Ask / Newest wins) | Done (`settings.conflictPolicy`, `conflicts.ts`) |
| 29 footnote style, date format | Done (Settings > Reading, Settings > Language; applied in markdown render and `fmtDate`) |
| 29 separate Ask / Chat / Tutor switches | Done (settings-ai list; Worker already enforces) |
| 29 hand-drawn look on all diagrams | Done (inline note diagrams now follow it too) |
| 01 long-press "+" speed dial | Done: new phone FAB on the note list (`PhoneFab.tsx`); there was no phone "+" before |
| 02 swipe-down exits Focus; tablet left-edge swipe opens sidebar | Done |
| 03 hover-expand folders while dragging | Done (600 ms, sidebar) |
| 12 Android adjustResize | Done in `AndroidManifest.xml`; the keyboard toolbar is a flex footer so it rides above the keyboard (not tested on a device) |
| 12 toasts pause on hover | Done |
| 04 empty-search "Did you mean" | Done (palette) |
| paste-link chip remembers per domain | Already existed |
| /api/login brake in D1 | Done; uses `auth_attempts` from migration 0010 (falls back to memory if the table is missing) |
| 27 /terms and /privacy | Done (`views/Legal.tsx`); accountsEnabled untouched |


## Round 8 wave (whiteboard / canvas / architecture / export)

- Whiteboard scripts (07b) run in a Worker (`src/lib/script-sandbox.ts`): no DOM, storage or network, 15 s timeout, changes applied as one history step (Ctrl+Z undoes a run; the Ctrl+Z step itself could not be driven in the headless harness, where even a plain undo did not fire). Canvas scripts (`lib/canvas.ts` `runScript`) still use `new Function`: its helpers are synchronous and return ids, so they cannot cross a Worker boundary without an API change.
- Dotted fill: Excalidraw has no dotted fill. Dots is stored as `customData.lumenFill = "dots"` and drawn as cross-hatch (the sparsest hatch).
- Text highlight: a pale marker rectangle grouped behind each free text (toggle in the Text popover).
- Serif and Arabic board fonts: two extra Excalidraw font ids (20 Source Serif 4, 21 IBM Plex Sans Arabic) registered in the exported `FONT_FAMILY` table (`lib/wb-fonts.ts`); they draw natively. Other Excalidraw apps show their default font for those two ids.
- HTML export: self-contained read-only page (inline SVG, wheel zoom, drag, double-click to fit) for every workspace that can export SVG.
- Canvas portals: Canvas options > Portals; file cards that point at another canvas show it live (`lumenPortals` meta key).
- Tidy up on big canvases (120+ cards) runs in a Worker (`lib/tidy-worker.ts`, inline fallback).
