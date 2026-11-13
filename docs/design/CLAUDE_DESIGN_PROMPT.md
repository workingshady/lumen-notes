# Prompt for Claude Design: "Lumen" study notebook + personal blog

> Paste everything below the line into Claude Design. It's self-contained.
> Companion files in this repo: `docs/design/DESIGN_SYSTEM.md` (tokens) and `docs/FEATURES.md` (full feature list).

---

## Role & goal
You are a senior product designer. Design **Lumen**, a local-first personal study notebook that is also a personal blog. One person uses it to track what they learn (lessons, notes, flashcards, canvases, slides) and publishes selected notes as public blog posts.

Deliver **high-fidelity screens for desktop (1440×900), tablet (1024×768) and phone (412×915, Android)**, a **component sheet**, and **light + dark** variants of the key screens. The same React codebase ships as a website (Cloudflare), a PWA, and an Android APK (Capacitor), so mobile must feel native: bottom tab bar, bottom sheets, thumb-reachable actions, safe areas.

## Brand
- **Name:** Lumen. **Idea:** "a lamp on a desk at night": calm, warm, focused. The UI recedes and the writing glows.
- **Personality:** quiet, precise, studious, warm. Not playful-cartoony, not corporate, no AI-generic gradients or glassmorphism soup.
- **Logo direction:** a small rounded-square mark with a single warm dot or flame-like glyph (light source) above a horizontal line (desk/page). Wordmark "lumen" in lowercase Inter Semibold, tight tracking.
- **The user can personalize:** blog name, tagline, author name, avatar (emoji or image), accent hue, theme, reading font, density. Show the Settings › Appearance screen with live preview.

## Color system (use exactly)
Cool low-glare neutrals + **one warm accent** (lamplight amber). Accent marks only the *current/primary* thing. Semantic colors only carry meaning.

**Lamplight (default dark):** bg `#0F1115` · surface `#161A21` · surface-2 `#1D222B` · border `#2A303B` · text `#E8E6E1` · muted `#9AA0AA` · accent `#F2A93B` (text on accent `#1A1206`) · link `#5CC8C2`
**Paper (light):** bg `#FAF8F3` · surface `#FFFFFF` · surface-2 `#F2EFE7` · border `#E4DFD3` · text `#1F1D1A` · muted `#6A655C` · accent `#B45F0E` (text on accent `#FFFFFF`) · link `#0F7C78`
**Other themes to show as swatches in Settings:** Midnight (`#0B1020` / accent `#8EA8FF`), Sepia (`#F4ECD8` / `#9C4A1A`), Forest (`#0E1512` / `#7FD49B`), High contrast (`#000` / `#FFD400`).
**Semantic (dark/light):** success `#6BCB8B`/`#1F8A4C` (mastered, synced) · warning `#E8B34A`/`#A86A00` (review due, unsynced) · danger `#EF6B6B`/`#C42B2B` · info `#7AA2F7`/`#2F5BD3` · learn `#B48EF0`/`#7A4BD1` (flashcards).
**Canvas/folder presets:** red `#E5534B`, orange `#E8893A`, yellow `#E3B341`, green `#57AB5A`, cyan `#39C5CF`, purple `#A371F7` (fill at 14% alpha, border 100%).
Rules: never pure black/white in default themes; elevation in dark = lighter surface step, not shadow; 60/30/10 split; WCAG AA everywhere.

## Typography & layout
- UI: Inter 13–14 px. Reading: user-selectable Inter / Source Serif 4 / JetBrains Mono, 17/30 desktop, 16/28 mobile, max 68ch measure. Code: JetBrains Mono.
- 4 px spacing grid. Radius 6 (inputs/chips), 10 (cards/buttons), 14 (panels/sheets). Lucide icons 1.75 stroke.
- Motion 120–240 ms ease-out, no bounce.

## UX principles (must be visible in the designs)
1. **Progressive disclosure.** Each screen has one obvious primary action. Secondary tools sit behind `⋯`, collapsible right panel, command palette (`Ctrl/⌘K`), long-press, or "Advanced" accordions. Note toolbar shows 5–6 core actions; the rest goes in overflow.
2. **Content first.** Note body ≥ 70% of the desktop viewport. Panels collapse to icons.
3. **Keyboard-first on desktop, thumb-first on phone.**
4. **Always show the save/sync state** quietly (dot + "Saved · Synced 2m ago" / "Offline · 3 changes queued").
5. **Nothing is ever lost:** trash, version history, restore-as-new-version.

## Information architecture
- **Organization model:** **Space → Folders → Notes.** Spaces are self-contained containers of a PARA kind: **Project** (goal, deadline), **Area**, **Course** (with a roadmap), **Resource**, **Archive**. Each has its own emoji icon, color and folder tree. Links, tags, search, graph and tasks can work across all spaces.
- **Desktop shell:** left **sidebar** (240 px, collapsible to 56 px rail): at the top a **space switcher** (current space icon + name + kind badge, dropdown listing spaces grouped by kind, "All spaces", "New space", "Archived"), then search button, Home, Inbox, Daily note, Tasks, Calendar, Review (due count), Graph, Canvases, Blog; then **Folders** tree (colored, nested, drag-drop); **Tags**; Trash; bottom: sync status, settings, avatar. **Middle**: note list (320 px, collapsible). **Main**: note. **Right panel** (300 px, hidden by default): tabs Outline · Backlinks · Properties · Versions · AI.
- **Phone shell:** bottom tab bar **Home · Notes · [+ FAB] · Review · More**. Folder tree opens as a bottom sheet. Note screen has top bar (back, title, mode toggle, `⋯`) and a formatting toolbar pinned above the keyboard.

## Screens to design (all three breakpoints unless noted)
0. **Spaces:** (a) space switcher dropdown open; (b) "New space" dialog: pick kind (5 cards with one-line explanation each), name, emoji, color, optional template; (c) **Course space overview**: header (emoji, name, provider, target date, overall progress ring), **roadmap** in three toggleable views: **Outline** (modules as collapsible sections with progress bars; topics with status icon todo ○ / learning ◐ / done ● / skipped ⊘, lock icon when prerequisites aren't done, linked lesson note, due date), **Skill tree** (left-to-right graph of topics, prerequisite edges, locked nodes dimmed, done nodes filled with success color), **Timeline** (topics by target date). Topic click opens a side sheet: status selector, prerequisites, linked note (open/create), notes count. (d) **Project space overview**: goal, deadline countdown, milestones, tasks board, recent notes. (e) Folder tree interactions: drag-and-drop with drop indicator, inline rename, context menu (New note / New folder / Rename / Move to… / Color / Delete), "Move to…" dialog with search across spaces.
1. **Unlock / welcome:** brand, "Continue offline" (local only) vs "Unlock sync" (passcode). First-run: pick theme + accent + blog name (3 small steps).
2. **Home / dashboard:** greeting + date; Quick capture field; **Due today** (flashcards due, tasks due, notes in "review"); **Continue** (last 5 notes); **Learning progress** (notes by status: todo/learning/review/mastered as a segmented bar); **Study activity heatmap** (GitHub-style, 20 weeks) + streak + minutes studied; pinned notes.
3. **Notes workspace (desktop 3-pane):** sidebar + list + note in **Split** mode. List item: title, 2-line excerpt, tag chips, status dot, relative time, pin icon. Header above the note: breadcrumb (folder path), title, **segmented mode switch: Edit · Split · Read · Focus · Slides · Review**, sync dot, share/publish, `⋯`.
4. **Note in Read mode:** beautiful long-form typography showing headings, callouts (note/tip/warning/question, one folded), a Mermaid flowchart, a KaTeX block equation + inline math, a code block with language label + copy, a task list, a table, footnotes, a wiki link and a `#tag`. Right panel open on **Backlinks**.
5. **Note in Edit mode (phone):** keyboard up; toolbar above keyboard: **B · I · H · list · task · `{}` · ∑ math · ◇ mermaid · 🖼 image · 🎙 voice · ⋯**.
6. **Focus mode:** only text, centered, faint word count bottom-right, Esc hint.
7. **Command palette / search:** results grouped (Notes, Commands, Tags) with highlighted matches, operator hints (`tag:` `type:` `status:` `in:`), keyboard hints.
8. **Graph view:** force-directed graph, nodes sized by link count, colored by folder (legend). Floating control panel (collapsible): search filter, tags toggle, orphans toggle, color-by (folder/type/status), depth slider for **Local graph**. Hover highlights neighbors; selected node shows a mini preview card.
9. **Canvas:** infinite dotted-grid board (JSON Canvas). Text cards with Markdown, note cards (file nodes showing note preview), link cards (URL with favicon/title), labelled **groups** with preset colors, edges with arrows + labels. Top toolbar: add text · add note · add link · add group · auto-layout · fit · **`</> Code`** toggle. Minimap bottom-right. Show the **Code split view**: board left, JSON editor right with validation status. Show the **Script console** drawer: a JS snippet like `canvas.addNode({type:'text', text:'# Idea'}); canvas.layout('tree')` with a Run button and output log.
10. **Version history:** right panel list (time, label, +/− chars), main shows a **diff** (green additions, red deletions, unchanged collapsed), buttons "Restore as new version" and "Copy". Mobile: full-screen sheet.
11. **Flashcard review:** one card centered, progress "7 / 23", front, tap/space to flip, then 4 grade buttons **Again · Hard · Good · Easy** with next-interval hints (1m · 6m · 1d · 4d). End screen with summary.
12. **Slides / presenter:** full-screen slide with title + bullets + a Mermaid diagram, slide counter, progress bar, keyboard/swipe hints; presenter thumbnail strip on desktop.
13. **Tasks:** grouped Overdue / Today / Upcoming / No date / Done; each task shows the note it came from. **Kanban:** notes as cards in columns Todo · Learning · Review · Mastered. **Calendar:** month grid with dots for daily notes, created notes, due tasks; selecting a day lists items.
14. **Database / table view:** notes as rows: Title · Type · Status · Tags · Folder · Updated · Words; sortable headers, filter chips, column toggle.
15. **Properties panel:** key/value list (course, source URL, due date, difficulty) with add-property.
16. **AI assist panel:** actions Summarize · Generate flashcards · Explain selection · Suggest tags; results shown as an insertable card ("Insert below" / "Copy").
17. **Study timer:** compact pill in note header (25:00, play/pause) expanding to a popover; logs to dashboard.
18. **Import / Export dialog:** tabs Import (drop zone: .md, .zip vault, .canvas, JSON backup) / Export (this note: .md · .html · PDF; vault: .zip · JSON backup). Show progress + result summary.
19. **Settings:** sections Appearance (theme swatches, accent hue slider with live preview, reading font, size, line width, density), Branding (blog name, tagline, author, avatar), Sync (status, last sync, passcode, "Sync now"), Blog (published posts, base URL, RSS), AI, Data (storage used, backup, clear), About. Use progressive disclosure: Advanced accordions.
20. **Public blog:** index (blog name, tagline, author, post cards with title, date, reading time, tags, excerpt; tag filter) and a post page (same Read typography, table of contents on desktop, prev/next). Light theme default for readers, dark toggle.
21. **States:** empty (no notes / no results / no due cards, each with a helpful illustration-free empty state and one action), loading skeletons, offline banner, sync conflict toast ("Kept newer version · View other"), delete confirm + undo toast, publish dialog (slug, tags, excerpt, preview link).

## Components sheet
Buttons (primary/secondary/ghost/danger, sizes, icon), segmented control, inputs, search field, chips/tags, status pills (todo/learning/review/mastered), list items, tree items (folder with color dot, chevron, count), tabs, right-panel tabs, toasts, dialog, bottom sheet, bottom tab bar + FAB, command palette row, callouts (5 types), code block, math block, Mermaid frame, flashcard, slide frame, canvas nodes (text/file/link/group) + edge, graph node + legend, heatmap cell scale, sync indicator states, theme swatch, accent slider.

## Output expectations
- Annotate key interactions (what's hidden, how it's revealed).
- Show desktop + phone for screens 2, 3/5, 4, 7, 8, 9, 10, 11, 13, 19, 20. Tablet for 3 and 9 only.
- Provide light (Paper) variants for 2, 4, 20.
- Use realistic study content (e.g. "Gradient descent", "TCP handshake", "Arabic grammar: idafa", "Linear algebra: eigenvectors"), not lorem ipsum.
