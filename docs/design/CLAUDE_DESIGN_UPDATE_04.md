# Claude Design follow-up #4: redesign everything built without you, a real icon and asset system, and new features

> Paste everything below the line into the **same Claude Design project** (after the main prompt and updates 01–03).
> Attach:
> - `docs/design/DESIGN_SYSTEM.md` (tokens)
> - `docs/FEATURES.md` (full feature list)
> - `docs/BASES.md` (Bases format)
> - screenshots of the current app for every screen in Part A, taken from the live app. They show what exists today and what to replace.
>
> Note: update 03 (learning paths + project hub) was written but **never designed**, so Part A covers it fully again.

---

## 0. Why this round
Your handoff for rounds 1–3 covered the core app, and it was implemented screen by screen to match. Since then a lot was built **in code without a design**. It all works, but it looks like a developer designed it:
- mixed spacing;
- emoji used as icons;
- menus, sheets and confirm dialogs that each look different;
- hand-drawn thumbnails;
- the learning path screens too crowded at 28 courses.

This round has four parts:

| Part | What |
|---|---|
| **A** | Redesign every feature built after your handoff. Each item says **what it does**, **how it works today** and **what to design**. |
| **B** | A custom **icon system** that replaces every emoji in the app. |
| **C** | All **assets**: thumbnails, previews, chart style, empty states, app-store and share images. |
| **D** | New features (none of them need AI). |

### What still applies from earlier rounds
- **Themes:** Lamplight (dark, default) and Paper (light) tokens.
- **Accent:** one amber accent, only for the current or primary thing.
- **Layout:** 4 px grid; radius 6/10/14/999.
- **Type:** Inter + IBM Plex Sans Arabic.
- **Icons:** line icons in Lucide style, 1.75 stroke.
- **Motion:** 120–240 ms, ease-out.
- **Principles:** progressive disclosure, WCAG AA, 44 px touch targets.
- **Arabic + English:** mixed text with per-paragraph direction.

### Deliverables
- Desktop 1440×900 and phone 412×915 for every screen; tablet 1024 where noted.
- Lamplight and Paper for screens marked (both themes).
- Additions to the component sheet.
- Use the sample content at the end, never lorem ipsum.

## 1. Hard rules
- **No emoji anywhere in the UI**: not as icons, headings, empty states, buttons, list markers or space icons. Every place that shows an emoji today gets a glyph from Part B.
- **No "AI look"**: no gradients, glows, glassmorphism, sparkle or magic-wand icons, purple-blue "AI" washes, robots, or "Unlock the power of…" copy. AI actions are ordinary actions with plain labels ("Summarize", "Make flashcards", "Organize").
- **No decoration for its own sake**: no stock illustrations, 3D blobs, confetti, or badges that carry no information. An empty state is one line and one action.
- **Copy**: sentence case, short, specific, honest. Say what happens ("Marks this concept learned and starts its reviews").
- **Color only carries meaning**:
  - success green: done, mastered
  - warning amber: review due
  - danger red: delete
  - info blue: learning, links
  - learn violet: flashcards, practice

  Courses, folders and highlights use the six canvas presets.
- **One way to do each thing.** Every confirm is the same inline confirm bar, every menu the same menu, every bottom sheet the same sheet.
- **Density**: this is a study tool used for hours. Calm, readable, and compact enough to see a whole stage or a whole table on one screen.

---

# Part A. Redesign every feature built after the handoff

## A1. Learning paths (both themes) (the most important screen of this round)
**What it is:** the user learns one subject from many overlapping courses at once. Their real path is "AI Engineer": 28 courses, 101 concepts, 7 stages. Each course keeps its own roadmap. The **learning path** sits on top as one concept-first roadmap: topics that several courses teach become **one concept** carrying all their material.

**How it works today:**
- **Storage.** A path is a note of type `path` stored as Markdown:
  - `## Stage`
  - `- Concept = alias | alias`
  - sub-lines `resource:`, `note:`, `review:`, `done:`, `needs:`
- **Merging.** Course topics with the same name merge automatically.
- **Overlap suggestions.** Similar names are suggested as overlaps ("Backprop by hand" ≈ "Backpropagation"), each with Merge / Different.
- **Prerequisites.** Merged across all courses, then reduced to the direct ones (101 edges for 101 concepts).
- **Mastery rules.** A concept is:
  - **learned** when the user marks it, or finishes its lessons in **any one** course (the other courses become optional extra material);
  - **locked** until its prerequisites are learned;
  - **mastered** when spaced reviews reach the 14-day step.

  Learning a concept counts as a review of its direct prerequisites. Revision steps are 1 → 3 → 7 → 14 → 30 → 60 → 120 days, and "Again" resets.
- **Organize.** Auto-organize builds stages from prerequisite depth. AI organize groups and merges concepts.
- **Course chips.** They open the course page, and Back returns to the path.
- **Navigation.** Every view, filter and sheet is a browser-history entry.

**Problems to solve:**
- With 28 courses the header, chips, matrix and graph become walls.
- The tabs and secondary actions aren't organized.
- Collapse and expand behave differently from one place to the next.
- Most of the skill tree is off-screen.

**What to design:**
1. **Path header, collapsible.**
   - **Collapsed (the default when there are more than 6 courses):** one line with a progress ring, "AI Engineer · 41 / 101 learned · 6 learning · 3 to revise · 12 mastered", a "4 overlaps" badge, and an expand chevron.
   - **Expanded:** stats, course chips, and actions (+ Courses, Organize ▾ with Auto / AI, Overlaps). The state is remembered per path.
2. **Course chips.** Each has a color bar, course glyph (Part B), name and done/total. They swipe on phone and show "+22 more" on desktop, which opens a searchable course list with progress bars. Clicking a chip opens the course page.
3. **Overlaps panel.** Rows like "Backprop by hand (fast.ai) ≈ Backpropagation (CS231n)" with Merge / Different, plus "Review all" for bulk decisions.
4. **Tabs organization.** Design a clear tab bar:
   - **Main:** Stages · Graph · Matrix · Timeline · Revise (with a due count).
   - **Secondary:** filters (course, status, stage) and a "Group by" control in one filter row under the tabs.
   - **Phone:** tabs scroll horizontally with an active underline, and the filter row becomes a "Filter" button that opens a sheet.
5. **Stages.**
   - **Desktop:** horizontal stage columns. Each has a number, editable name, done/total and a thin progress bar, and can **collapse to a narrow vertical strip** that shows only its name and progress.
   - **Expand/collapse all:** a control for every stage at once.
   - **Concept cards:** status mark or lock, name, course color dots, "3 courses", resource count, and a violet "revise" pill.
   - **"Not placed yet":** a dashed column at the end.
   - **Phone:** an accordion of stages. One opens at a time, and each header shows its progress.
6. **Skill tree / graph (redesign properly).**
   - **Layout:** left → right by prerequisite depth, with column headers "Step 1 · Foundations".
   - **Nodes:** course color bars and a stage badge; done edges green, locked nodes dimmed.
   - **Focus:** hover or select highlights all ancestors and descendants and fades the rest.
   - **Controls:** collapse a stage group into one summary node, a minimap, fit, zoom, a collapsible course legend, and "focus on this concept" (show only its chain).
   - **Phone:** pinch/pan, and tapping a node opens the sheet.
   - **Drawing prerequisites:** drag from one node's dot to another to add a prerequisite. Edges the path added are dashed and can be removed; edges from a course can't be removed here.
7. **Matrix.** Rows are concepts grouped by stage, and each stage group collapses. Columns are courses (rotated or abbreviated headers, with a tooltip for the full name), plus a sticky concept column and an "overlap" column (2×, 3×). It must stay readable with 28 courses. Allow "show only overlapping" and "show only missing coverage".
8. **Timeline.** One lane per course plus a revision lane, with pills packed into rows. Lanes collapse; the today line is amber.
9. **Revise.** One concept at a time, with "taught in" chips, a recall prompt, resources, Again / Got it, and a "Coming up" list.
10. **Concept sheet** (right panel on desktop, full-height sheet on phone). Sections are collapsible with remembered state:
    - **Mastery:** state ("In progress", "Learned via CS231n", "Mastered", "Locked by 2 prerequisites"), Mark learned / Unmark, review progress toward 14 days, and blockers that open their concepts.
    - **Practice:** "Practice · 5 questions from 4 notes" and Test out. Design the quiz flow: multiple choice and short answer, feedback, score, "Save as flashcards". When signed out it falls back to the flashcards in the notes. Scoring 80% or more marks the concept learned.
    - **Taught in:** grouped by course, each a collapsible header with done/total. Each topic row has a status select (it edits that course's own roadmap) and an open-lesson button. Rows can be dragged onto another concept to move them there.
    - **Prerequisites and Unlocks:** chips plus "+ Add". Path-added prerequisites are removable; course-defined ones are shown but not removable.
    - **Resources:** videos play inline; articles, books and courses are labelled with where they came from; plus an add-link form.
    - **Also:** notes, revision schedule, merge with another concept (confirm), take out of the path (confirm).
11. **Learning paths list.** Cards with a ring, course dots, "N to revise", and last studied.
12. **New learning path dialog.** Name plus a course multi-select (glyph, name, provider). It can start empty.

## A2. Course roadmaps: Outline, Skill tree, Timeline, with drag-and-drop editing (both themes)
**What it is:** every course space has a roadmap. It's stored as Markdown: `## Module`, then `- [ ] Topic (needs: A, B) 📅 2026-12-01 → [[Lesson note]]`. Topic statuses are todo / learning / done / skipped.

**How it works today:**
- **Outline:**
  - Drag topics to reorder them or move them between modules. Dropping on the top or bottom third of a row inserts there; dropping on the middle makes the dragged topic a **prerequisite**.
  - Drag module headers to reorder modules. Drop onto "+ New module" to create one.
  - Inline "Add topic". Double-click or F2 renames a module; empty modules can be deleted.
  - A **Notes tray** lets you drag notes in as linked topics.
  - Alt+↑/↓ moves things from the keyboard.
- **Empty roadmap:** opens as a **builder** with the tray open.
- **Skill tree:**
  - Hover or select highlights ancestors and descendants.
  - A "+ Topic" chip can be dragged onto the canvas or onto a node (a new topic that needs it).
  - Letting go of a connection on empty space creates a dependent topic.
  - Click or long-press an arrow for "Remove prerequisite". Delete removes a node after confirming.
- **Loops:** a change that would create a loop is refused with a message.
- **Topic sheet:** status, due date, prerequisites, linked note, and an Organize section (up/down, Move to module, rename, delete).
- **Phone:** no dragging; every card has a "⋯" menu with the same actions.

**What to design:**
- **Outline:** collapsible modules, each showing a progress bar and done/total, plus an expand/collapse-all control.
- **Skill tree:** column headers, curved edges colored by status, a minimap, and collapsible modules.
- **Timeline:** drag to reschedule.
- **Topic sheet.**
- **Drag states:** drag ghost, insert line, "becomes prerequisite" highlight, refused drop, and the notes tray.
- **Builder:** the empty-roadmap builder state.
- **Phone menus.**
- **Unlock moment:** a quiet animation when a topic unlocks.

## A3. Project hub
**What it is:** a project space for software work. Repo, PR, Figma and Jira are plain links; nothing is connected.

**How it works:**
- **Tabs:** Overview · Docs · Board · Requirements · Timeline · Diagrams · Assistant, plus a links row and a health badge (on track / at risk / behind).
- **Docs:** each kind has a template: PRD, RFC, ADR, Requirements, Action plan, Meeting notes, Spec, Draft. Each doc has a status header (draft / in review / approved / superseded / rejected) and an owner.
- **Task cards** come from checkbox lines in any note:
  - Markers: `[>]` backlog, `[ ]` todo, `[/]` doing, `[?]` review, `[x]` done, `[-]` cancelled.
  - Inline fields: `!p1` priority, `~3d` estimate, due date, start date, `#epic/x`, `@owner`, `REQ-n`.
- **Board:** dragging a card between columns writes the marker back. Filter by epic; estimate totals; quick-add.
- **Requirements:** `REQ-n (must/should/could/wont)` with MoSCoW counts and traceability (met / in progress / planned / no tasks).
- **Timeline:** a Gantt chart generated from the cards.
- **Diagrams:** a requirements → tasks flowchart and an epic mindmap.
- **Assistant:** plan from a goal, weekly status, next actions, risks, decision summary.

**What to design:** every tab on desktop and phone, the doc status header, card anatomy (task glyphs from Part B, no emoji), and the traceability table.

## A4. Diagrams as files, and export
**What it is:** a Mermaid diagram can be its own file (`.mermaid`, note type "diagram").

**How it works:**
- **File view:** source and live preview side by side, with a zoom/pan viewer.
- **Location:** diagram files go into a `diagrams/` folder.
- **From a note:** a Mermaid block in a note can be saved as a diagram file and placed on a canvas as a file card, with links both ways.
- **Diagrams tab:** lists every diagram in a space.
- **Export dialog** (also used for whole canvases and the graph):
  - formats SVG / PNG / JPEG / WebP;
  - scale, quality, background, theme, padding;
  - copy image, SVG or source.
- **Settings › Diagrams:** destination folder, auto-save, AI names, export defaults.

**What to design:** the file view (split, source-only and preview-only), the viewer toolbar, the Diagrams tab, the export dialog with a live preview, and Settings › Diagrams.

## A5. "New visual workspace" chooser
**What it is:** the dialog for creating a Canvas, Whiteboard, Mermaid diagram or Graph from a note. You designed it in round 2, but today it uses emoji (puzzle piece, crayon, chart) and a plain list.

**What to design:**
- Four large options, each with a **live-looking preview**:
  - **Canvas:** cards connected by arrows.
  - **Whiteboard:** a hand-drawn sketch.
  - **Mermaid diagram:** a small flowchart.
  - **Graph:** nodes around a note.
- Each option keeps a glyph from Part B, the one-line "use it when…", the format line (".canvas · JSON Canvas 1.0") and capability chips.
- Keep the idea "Pick by what you want to do with your hands." Say where it will be created ("in Inbox", with the folder glyph, not an emoji).

## A6. Editor: slash commands, insert gallery, block editing, block references, paste menu (both themes)
**Slash commands.**
- **How it works:**
  - **Opening:** `/` at line start or after a space opens a grouped menu: Basic · Layout · Panels & callouts · Media & embeds · Knowledge · Advanced, 55 blocks in all.
  - **Matching:** Confluence, Notion and Obsidian names work as aliases, and results are ranked by label then alias. `//` inserts today's date.
  - **Where it doesn't open:** never inside URLs or code fences.
  - **Media:** Image and Voice open the picker or recorder.
- **Design:**
  - **Rows:** glyph, label, one-line hint, shortcut, and group headers.
  - **States:** keyboard selection, a no-results state with "Search all commands", and a recently used group at the top.
  - **Phone:** a bottom sheet with search.

**Insert layout gallery** (note ⋯ menu › Insert).
- **How it works:** a visual gallery built from the same catalog, with sections Layout, Panels & callouts and Advanced.
- **Design:** a thumbnail per block (see Part C), a hover preview, and the phone sheet.

**Block editing.**
- **How it works:**
  - **Handle:** a ⋮⋮ handle beside the hovered top-level block (paragraph, heading, list item with its children, quote/callout, code, math, `:::` container, table, divider).
  - **Drag:** dragging moves the block, with a drop line and auto-scroll.
  - **Block menu:** a click opens it with:
    - Turn into: Text, H1–H3, bulleted/numbered/task list, quote, code, toggle, and 8 callout types.
    - Duplicate, Copy link to block, Move up/down, Delete.
  - **Multi-select:** Shift- or Ctrl-click, or long-press on phone.
  - **Keyboard:** Alt+↑/↓ moves a block; Mod+Shift+D duplicates.
  - **Arabic:** on RTL lines the handle sits on the right.
  - **Undo:** one undo step per action.
  - **Phone:** the handle sits beside the current block and opens a bottom sheet.
- **Design:** the handle in its rest, hover, dragging and selected states; the drop line; the block menu (desktop popover and phone sheet); the multi-selection look.

**Block references.**
- **How it works:**
  - **Anchors:** `^id` at the end of a block is its anchor (Obsidian rules).
  - **Links and embeds:** `[[Note#^id]]` opens the note scrolled to the block and briefly highlights it. `![[Note#^id]]` embeds only that block.
  - **Autocomplete:** typing `[[Note#^` lists the note's blocks, and picking one adds the id if missing.
- **Design:** a faint anchor marker on hover, the arrival highlight, the embedded-block frame (source chip), and the autocomplete rows.

**Paste menu.**
- **How it works:** after pasting more than 200 characters, or a URL in the middle of a line, a small floating row offers Keep · Clean up formatting · As quote · As link card · Summarize · Make flashcards. Esc or typing dismisses it, and it fades after 12 s. A link pasted alone on a line offers Preview card / Embed / Plain link.
- **Design:** both floating rows and the result states.

## A7. Read mode and preview (both themes)
**How it works today:**
- **Page width:** Fixed / Wide / Full per note (a ↔ button in the header, or `width:` in front matter). Wide tables and `::: wide` / `::: full` blocks break out of the text column.
- **Page layout blocks:**
  - Columns: `::: columns` with `::: column 30%` (2, 3, or main + sidebar). They stack on narrow screens; variants `{.cards}` and `{.divided}`.
  - Tabs: `::: tabs`, where each heading is a tab.
  - Toggle: `::: expand Title`.
  - Panels: `::: info / note / tip / warning / danger / success Title`.
  - Width and placement: `::: wide`, `::: full`, `::: aside`, `::: center`.
  - Pandoc and Quarto spellings are accepted too.
- **Tables:**
  - framed scroll box, sticky header, zebra rows;
  - click a header to sort; a filter box on long tables; row count;
  - full screen; sticky first column with a scroll fade; columns sized by content;
  - options `{.wide .compact .nowrap .plain}`.
- **Doc extras:**
  - `![[Note]]` / `![[Note#Heading]]` live includes (3 levels deep);
  - `:status[In review]` pills (color from the text or `{green}`);
  - a `[[toc]]` contents box.
- **Already designed by you, keep consistent:** callouts (foldable), Mermaid, math, code with copy, footnotes, embeds (YouTube/Vimeo inline, link cards, PDF viewer, audio/video players).

**What to design:**
- one consistent visual language for all layout blocks, on both themes and in Arabic;
- the width switch;
- every table state;
- includes, with a source chip and a "go to source" link;
- status pills in every color;
- the contents box;
- a full sample note that uses everything (desktop and phone).

## A8. Slides
**How it works today:**
- **Slide breaks:** `---` separates slides.
- **Layouts:** each slide can set `<!-- layout: … -->` to one of title, section, default, center, two-cols, image-left / image-right (with `split: 40%`), cards, stat, quote, full or blank.
- **Regions and backgrounds:** regions `::left::`, `::right::`, `::1::`…; Marp background images `![bg](url)` / `![bg left:40%](url)`; `class: invert / accent`.
- **Fitting:** text shrinks automatically to fit (down to 62%).
- **Free placement:** `::: box x=10 y=20 w=40 h=30` (percent of the slide). Arrange mode (A) drags and resizes boxes and writes the numbers back; "+ Box" adds one.
- **Doc → deck:** any note without slides is laid out automatically:
  - H1 becomes the cover and sections get section slides;
  - the layout is picked from the content: 2 sub-sections → two-cols, 3–6 → cards, numbers → stat, quotes, image + text, full diagrams or tables;
  - long prose becomes speaker notes, and long lists continue onto "(cont.)" slides.

  "Save as deck" turns this into editable slide Markdown.
- **Presenting:**
  - overview grid (O), type a number + Enter to jump, B to black the screen;
  - P for presenter view, plus an audience window;
  - a phone remote over the network.

**What to design:**
- all 11 layouts as a set, in both themes and in invert/accent;
- Arrange mode (handles, guides, coordinates);
- the doc → deck preview with "Save as deck";
- the overview grid;
- presenter view;
- the phone remote screen;
- a layout picker with thumbnails (Part C).

## A9. Focus mode: Read and Write
**How it works:**
- **Two sub-modes:**
  - **Read:** a clean reading view, with a **highlighter** whose highlights are saved into the Markdown, **read aloud** (text to speech, with progress and controls), and an outline drawer.
  - **Write:** distraction-free writing.
- **Settings › Reading:** Focus defaults, highlights and read aloud.

**What to design:**
- both modes;
- the highlight color bar and highlighted text;
- the read-aloud bar (play/pause, speed, current sentence follow);
- the outline drawer;
- the Esc hint;
- Settings › Reading.

## A10. Bases (database views of notes) (both themes)
**What it is:** a note of type "base" holds a view definition in Obsidian Bases YAML, and shows notes as Table · Board · Gallery · List · Calendar.

**How it works:**
- **Filters:** expressions such as `status == "learning"`, `file.hasTag("cv")`, `due < today()`, `file.inFolder()`, with AND / OR / NOT.
- **Toolbar:** search, row count, Filter rows (property · operator · value), multi-key Sort, Group, Properties (show/hide/reorder), and New (pre-filled from the filters).
- **Table:**
  - sticky header and title column; resizable columns (the width is saved);
  - grouped rows with counts;
  - inline editing: selects for status/type/space, text for tags and properties, date pickers.
- **Board:**
  - one column per value;
  - mouse drag, or long-press drag on touch with edge auto-scroll;
  - columns snap on phone; "+" per column.
- **Gallery:** cover or excerpt. **List:** compact rows.
- **Calendar:** a month grid; drag a note to another day to change its date; dots on phone.
- **Saving:** every change writes the note's front matter.
- **View settings:** rename, layout, limit, duplicate, delete, Edit YAML, Download .base.
- **Unsupported expressions:** shown in a hint line.

**What to design:** all five views, the toolbar and every popover, cell editors, board drag states, the view settings, and the "New base" template picker.

## A11. Ask your vault
**What it is:** ask a question and get an answer **only from your own notes**, with numbered citations.

**How it works:**
- **Retrieval:** passages are found on the device by keyword search, and only those passages go to the model.
- **Scope:** Vault / This space / This note + links / a learning path.
- **Entry points:** AI panel tab "This note | Ask vault"; palette "Ask your notes: …" (Ctrl/⌘⇧A) opens a centered dialog on desktop and a full-screen sheet on phone.
- **Progress:** "Reading your notes…" → "Answering from 8 passages…" → the answer streams in.
- **Citations:** inline [n] chips. Hovering one highlights its source card; clicking opens the note.
- **Source cards:** number, note link, space › heading, snippet, Open. Uncited sources are dimmed.
- **Actions and history:** Copy, Save as note, and the last 12 questions.
- **States:** "Not in your notes.", signed out (still shows passages), offline.
- **Arabic:** answers render right-to-left.

**What to design:** the panel and the dialog/sheet in every state. It's a plain search-and-answer tool, with no glowing AI styling.

## A12. Review, FSRS and practice
**How it works:**
- **Scheduler:** flashcards now use FSRS, which predicts when you'd forget a card. Settings › Review has a target retention slider (0.80–0.97, default 0.90) that trades more reviews for less forgetting.
- **Card states:** New / Learning / Review / Relearning. Grade buttons show the next interval.
- **Card actions:** suspend, edit, undo.
- **Old cards:** cards from the previous scheduler switch over on their next review.

**What to design:**
- Settings › Review, with a small chart of workload vs. retention;
- grade buttons;
- card state badges;
- the session summary.

## A13. Navigation, history and accounts
**How it works:**
- **History:** every page (note, space, list, filter, tag) is a browser-history entry, so Back/Forward, the Android back gesture and the in-app Back arrow walk the same sequence. Back closes sheets, modes and the keyboard first.
- **Phone exit:** "Swipe again to exit".
- **Breadcrumb:** clickable (the space opens its page, a folder opens its list). The phone header shows the current list name ("Learning paths", "Canvases & whiteboards").
- **Accounts:** several accounts saved on the device. Switch, add or forget them in Settings; the passcode is asked only when needed.

**What to design:**
- breadcrumb states;
- the back/forward affordance on desktop;
- the phone header;
- the exit toast;
- the account switcher (sidebar footer and Settings).

## A14. Settings pages added since the handoff
- **Reading:** see A9.
- **Review:** see A12.
- **Diagrams:** see A4.
- **Developer › Simulator:** a dev panel that switches demo-data scenarios (learning paths, project hub, slides lab), injects network/AI/upload faults and moves the demo clock. Design it as a compact developer drawer.

Fit all of them into the round-1 Settings structure.

## A15. Big vaults (700+ notes)
**How it works:**
- the note list loads in pages;
- search and graph indexes build in the background;
- the graph lays out progressively.

**What to design:**
- loading and progress states for each;
- "showing 200 of 738 · Show more";
- a calm "indexing…" indicator.

---

# Part B. Icon system (replaces every emoji)
A **custom glyph set** on Lucide's grid: 24 px canvas, 2 px padding, 1.75 stroke, round caps and joins, so it mixes with Lucide seamlessly.
- **Sizes and themes:** show every glyph at 16, 20 and 24 px, on Lamplight and Paper, both plain and on a tinted tile (preset color at 14% fill, glyph at 100%).
- **Format:** deliver as individual SVGs named `lm-<group>-<name>.svg`, plus one sprite sheet.

1. **Note types (16):** note, lesson, journal, flashcards, slides, post, canvas, whiteboard, roadmap, map of content, learning path, diagram, base, plus PDF, highlight and dashboard for Part D.
2. **Space kinds (5):** project, area, course, resource, archive.
3. **Space icon picker:** about 48 user-pickable glyphs on a colored tile.
   - **Subjects:** math, code, language, neural network, vision/eye, text/NLP, robot arm, database, cloud, book, flask, globe, music, health, money, briefcase, home.
   - **Generic shapes:** a set of simple shapes.
   - **Other options:** "Use initials" (1–2 letters on the tile).
   - **Design:** the picker (desktop popover and phone sheet) with search and a color row.
4. **Slash and block commands (~60):**
   - **Text:** text, H1–H3, bulleted/numbered/task list, quote, code, math, divider, table, Mermaid.
   - **Layout:** columns 2/3, main + sidebar, tabs, expand, wide, full, aside, center, box.
   - **Media and links:** image, video, audio, file, PDF, link card, embed.
   - **Knowledge:** wiki link, block embed, include, query, contents, status pill, date, voice.
   - **Cards and new features:** flashcard, cloze, image occlusion, timestamp, smart folder.
5. **Callouts and panels (10):** note, info, tip, success, warning, danger, question, example, quote, abstract.
6. **Statuses (small marks, not pictures):**
   - **Topics:** todo, learning, done, skipped, locked.
   - **Concepts:** mastered, revise due.
   - **Docs:** draft, in review, approved, superseded, rejected.
7. **Tasks:** backlog, todo, doing, review, done, cancelled, priority p1–p3, estimate, due, start, owner, epic, requirement.
8. **Course kinds:** video course, book, university lecture, interactive notebook, paper, podcast, article.
9. **Visual workspaces:** canvas, whiteboard, Mermaid, graph, export.
10. **Base views:** table, board, gallery, list, calendar.

**Before/after crops:** note list, space switcher, sidebar, slash menu, visual workspace chooser, project board card, path course chips.

# Part C. Assets
1. **Layout thumbnails** (Insert gallery and slash menu previews): one for each layout block and panel type. They're about 96×64, built from the theme tokens, and work in both themes. They replace the rough SVGs drawn in code.
2. **Slide layout thumbnails** for all 11 layouts, plus invert and accent.
3. **Visual workspace previews** (A5).
4. **Chart style guide** (Part D4):
   - series colors from the canvas presets;
   - gridlines, axis labels, direct labels, tooltips, number formatting;
   - an empty chart state;
   - both themes.
5. **Empty states:** one line + one action each, for paths, bases, Ask, PDFs, the Today plan, smart folders and dashboards. No illustrations; at most a single large glyph from Part B.
6. **Unlock and progress moments:** topic unlocked, concept mastered, streak day. Quiet, about 200 ms, no confetti.
7. **Share and store images:** an Open Graph image template for shared notes, courses and paths; Android feature graphic; Play Store screenshots frame.
8. **Favicon variants per view:** optional. The Lumen mark with a small corner glyph for Review due.

---

# Part D. New features to design (no AI needed)

## D1. PDF reader with highlights (both themes) (the biggest one)
Today PDFs open in a basic inline viewer with "quote to note". Design a real reader for course PDFs, papers and book chapters.
- **Reader:**
  - continuous scroll or single page; fit width / fit page / zoom;
  - a page field ("12 / 15") and keyboard navigation;
  - a left rail with **Thumbnails / Outline** (from the PDF's bookmarks) **/ Highlights**;
  - in-document search with hit markers on the scrollbar;
  - a reading-progress line and "Continue where you left off";
  - dark-mode page inversion, kept off for images.
- **Highlight:**
  - selecting text shows a floating bar: 5 colors (presets), Note, Card, Copy, Link;
  - **Area mode** draws a rectangle over a figure or equation and captures it as an image;
  - margin markers show where the highlights are.
- **Highlights panel:**
  - each item shows color, the quote (or area thumbnail), page, comment and tags;
  - filter by color or tag; sort by page or date;
  - "Make a note from all highlights" and "Export as Markdown".
- **Highlight → note / card / flashcard:**
  - every highlight can become a note or a card;
  - the new item keeps a back-link chip "Attention.pdf · p. 4" that opens the PDF at that spot with the highlight flashing;
  - "Flashcard" opens a mini editor, with the front prefilled and a cloze option.
- **Canvas:**
  - drag a highlight onto a canvas to make a highlight card (quote or image, colored left edge, page chip);
  - the PDF itself can be a canvas card that opens at a page.
- **Library:** the PDFs in each space, with cover, title, pages, progress %, and highlight count.
- **Phone:**
  - pages fill the width, with page and zoom in the bottom bar;
  - the rail becomes a sheet;
  - long-press to select, then the color bar;
  - an area-mode toggle.
- **States:**
  - page skeletons;
  - a large file loading in parts;
  - a password-protected PDF;
  - a scanned PDF with no text layer: area highlights still work, and the reader says why text selection doesn't.

## D2. Cloze and image-hiding flashcards
- **Cloze:**
  - `==hidden text==` or `{{c1::text}}` makes a fill-in-the-blank card;
  - in the editor it shows a subtle underline and a card-count chip in the margin, with its own look in Read mode;
  - in review the gap appears, then the reveal.
- **Image occlusion:**
  - on an image or a PDF area capture (e.g. a transformer block diagram), draw boxes over labels, and each box becomes a card;
  - modes: "Hide one, show others" and "Hide all, guess one"; boxes can be grouped, reordered and deleted;
  - in review the target box is solid accent and the others are outlined.
- **Phone:** draw with a finger, pinch to zoom, and the box list in a sheet.

## D3. Today: the study plan (both themes)
A Today page, plus a Home section, that builds the day from the learning path, course target dates and due reviews. It uses rules, not AI.
- **Header:** date, planned minutes vs. daily goal, streak.
- **Sections:**
  - **Continue:** the lesson you were in.
  - **New lessons:** the next unlocked topics, respecting prerequisites and dates.
  - **Reviews:** cards due and concept revisions due.
  - **Practice:** one concept to test out.
- **Each item:** course color, estimated minutes, the reason it's there ("due Fri for CS231n", "unlocks 3 concepts"), and Start / Skip / Move to tomorrow.
- **Missed days:** "You missed 2 days. Spread 6 lessons over the next 5 days?", with a before/after of the rescheduled week, and Accept / Adjust.
- **Week view:** planned vs. done minutes per day, plus weekly goals ("3 CS231n lectures", "150 cards") with progress.
- **Settings:** daily minutes, study days, max new lessons per day, and course priority (drag to order).
- **Timer:** starting an item starts the study timer.

## D4. Dashboards and charts
A dashboard note is built from tiles, using Bases queries.
- **Tiles:**
  - a number with a delta ("Cards due · 42 · +8 vs last week");
  - bar, line, area, donut and stacked bar charts;
  - a study heatmap, a progress ring, a mini table, a list.
- **Example dashboard, "AI Engineer path":** minutes per course per week, concepts learned over time, cards due over the next 14 days, status split, mastered count, a 20-week heatmap.
- **Editing:**
  - add a tile → choose its source (a base view, cards, sessions, a path) → chart type → fields;
  - drag and resize tiles on a 12-column grid;
  - phone stacks the tiles.
- **Accessibility:** a data-table toggle for each chart.

## D5. Bases: a note in several groups
When the group property has several values (tags, courses), the note shows in **each** group.
- **Table:** an "also in 2 groups" marker on the row.
- **Board:** the same card in two columns, with the second copy subtly marked. Dragging one copy changes only that value and says so: "Moved from #cv to #nlp, still in #llm".
- **View setting:** "Notes with several values: show in each group / first group only".

## D6. Unlinked mentions and tag links in the graph
- **Backlinks panel:**
  - "Linked mentions", then **"Unlinked mentions"**: plain-text appearances of the note's title or aliases;
  - each row shows the sentence with the match highlighted and a Link button;
  - "Link all (12)" with a confirm; ignored mentions can be hidden.
- **Graph:**
  - a "Tags" toggle adds tag nodes in a different shape, connecting notes that share a tag;
  - or a "Shared tags" option draws faint dashed edges between such notes;
  - the legend explains link edges vs. tag edges.

## D7. Saved searches / smart folders
- Save any search or filter as a **smart folder** (e.g. `tag:#llm status:learning`, "Lessons due this week", "PDFs with no notes").
- **Sidebar section:** each smart folder has its own glyph and a live count, and can be pinned, renamed, reordered and colored.
- **Editing:** the same filter rows as Bases, plus "Save as base".
- **Phone:** smart folders appear in the folders sheet.

## D8. Video notes with timestamps
- **Inserting:** while a course video plays in a note, a button (or the key T) inserts a `[12:34]` chip plus your text.
- **Jumping:** clicking a chip seeks the player to that time.
- **Player:** playback speed, "Pause while typing", and "Make a flashcard at this moment".
- **Phone:** the player docks at the top and you write below it.

---

## Component sheet additions
- **Drag and confirm:** drag ghost, insert line, invalid drop, inline confirm bar.
- **Collapsing:** collapsible section header (one style for the whole app), expand/collapse-all control.
- **Editor:** block handle and block menu, slash row, paste row.
- **Ask:** citation chip, source card.
- **Bases:** cell editors, board card and column, calendar cell.
- **Charts:** chart tiles.
- **PDF:** highlight bar, highlight card (quote and area), page back-link chip.
- **Flashcards:** occlusion box states.
- **Planning and search:** Today plan item, smart folder row.
- **Paths:** stage column (expanded and collapsed), concept card, course chip, filter row, tab bar with counts.

## Sample content (use these, not lorem ipsum)
- **Path:** "AI Engineer", stages Math foundations → ML basics → Deep learning → Vision → NLP and transformers → LLM engineering → MLOps.
- **Courses:** Coursera Deep Learning Specialization, Stanford CS231n, Stanford CS224n, Stanford CS336, MIT 6.S191, fast.ai Practical Deep Learning, Hands-On Machine Learning (Géron), Hands-On Large Language Models, Karpathy Neural Networks: Zero to Hero, 3Blue1Brown Neural networks, Dive into Deep Learning.
- **Concepts:** Gradient descent, Backpropagation, AdamW, Batch normalization, Convolution, ResNet, Attention, Transformer block, Tokenization (BPE), Fine-tuning with LoRA, RAG, Evaluation.
- **PDFs:** *Attention Is All You Need* (15 pages), *Deep Residual Learning for Image Recognition*, CS231n lecture 5 slides, HOML chapter 11.
- **Arabic mix:** a note titled "الانتشار العكسي (ملخص)" with English terms inside.
