# Claude Design follow-up #1: canvas, whiteboard, embeds, Arabic, spaces

> Paste everything below the line into the **same Claude Design project** you started with
> `CLAUDE_DESIGN_PROMPT.md`. It only adds or changes screens. Keep every token, color and rule from the first prompt.
> Next follow-ups go in `CLAUDE_DESIGN_UPDATE_02.md`, `_03.md`… (one file per round, newest wins).

---

## Context
Lumen is the study notebook and personal blog you designed in round 1. The build is live, and these features now exist in code. They need proper designs. Keep the same brand (Lamplight dark default, Paper light, one amber accent `#F2A93B` / `#B45F0E`), the same type, radius and spacing scales, and progressive disclosure throughout.

## 1. Three visual workspaces: Canvas, Whiteboard, Graph
Explain the difference visually so users pick the right one:

| | **Canvas** | **Whiteboard** | **Graph** |
|---|---|---|---|
| What | Cards of notes, text, links, groups connected by arrows | Freehand: pen, shapes, arrows, sticky notes, frames, images | Auto map of how notes link |
| Format | JSON Canvas 1.0 (`.canvas`, Obsidian-compatible) | Excalidraw (`.excalidraw`) | Generated, not stored |
| Edit by | Drag & drop · JSON code panel · script console · REST API | Drawing tools · JSON code panel · script console · Mermaid → shapes · REST API | Filters only |
| Icon | plugin | highlighter️ | network |

Design:
- **"New…" chooser**: a sheet with three large cards (Canvas / Whiteboard / Graph-from-note), each with a one-line "use it when…" and a tiny preview illustration made of shapes, not stock art.
- **Canvas screen** (refine round 1): the floating toolbar is grouped as *Add* (text · note · link · group) | *Arrange* (tree · grid · force layout) | *Style* (6 color presets) | *Code* (`</>` JSON, `>_` script, download). Selected card: resize handles + 4 connection dots in the accent color. Edge labels sit on a bg-colored pill.
- **Whiteboard screen**: Excalidraw's tool bar restyled to the Lumen tokens (surface `#161A21`, border `#2A303B`, active tool = accent). Top-right Lumen cluster: `</>` code · `>_` script · Mermaid · export. Show sticky notes in 6 soft paper colors (`#fff3bf #d3f9d8 #d0ebff #ffd8a8 #eebefa #ffc9c9`) with dark ink text, a frame titled "Week 3", a hand-drawn arrow, and a pasted image.
- **Code side panel** (shared by canvas + whiteboard): right on desktop, bottom sheet on phone. Header: format name, a validation chip (green "valid check" / red error message), Apply, Download. Monospace editor with line numbers.
- **Script console**: code editor, a Run button (accent), an output log strip (monospace, muted, `check done` / `x error` lines), and an **Examples** dropdown with "Mind map from headings", "Stickies from list" and "Flowchart from Mermaid".
- **Mermaid → whiteboard** dialog: Mermaid text on the left, live diagram preview on the right, and an "Add as editable shapes" button.
- **Conversions** (in the ⋯ menu): Note outline → Canvas · Canvas → Whiteboard · Mermaid block → Whiteboard. Show the menu with these three, each with a small "from → to" glyph.
- **Developer/API sheet** (Settings → Developer): shows the endpoints with copy buttons: `GET/PUT /api/notes/:id`, `GET/PUT /api/canvas/:id`, `GET/PUT /api/whiteboard/:id`, `POST /api/whiteboard/:id/elements`, plus "Copy token" behind a reveal button and a warning that the token gives full access.

## 2. Embeds and link previews (inside notes and blog posts)
- **YouTube / Vimeo**: a 16:9 player card with a 12 px radius, plays inline. Phone: full-bleed width.
- **Uploaded video/audio**: native player inside a surface card. Audio is a slim bar with the waveform-free default controls.
- **PDF**: an inline viewer card (70 vh) with "Open full screen".
- **Link preview card**: the result of pasting a bare URL on its own line. Title (2 lines max), description (2 lines, muted), favicon + domain, and an Open Graph image on the right (132 px, 88 px on phone). States: loading skeleton, loaded, no-image, failed (just the domain + URL).
- **Editor affordance**: when a URL is pasted, a small inline chip offers "Preview card · Embed · Plain link".

## 3. Arabic + English (bidirectional)
The user writes in Arabic and English, often mixed in one note.
- Each paragraph/heading/list item picks its own direction automatically (RTL for Arabic-first lines, LTR for English-first).
- Fonts: Inter for Latin + **IBM Plex Sans Arabic** for Arabic (sans); Source Serif 4 + **Noto Naskh Arabic** (serif reading mode).
- Design one **mixed-language note in Read mode** (Arabic H1, English paragraph with inline Arabic, an Arabic bullet list, an English code block that must stay LTR) on desktop and phone. Callout icons and list bullets mirror on RTL lines.
- **Optional app UI in Arabic** (future): show the sidebar + note header mirrored (RTL layout) as a concept frame.

## 4. Spaces & organization (refine round 1)
- **Space switcher**: grouped by kind (Projects, Areas, Courses, Resources, Archive) with emoji + color dot. A "pinned spaces" row at the top.
- **Course overview**: progress ring, target-date countdown, and a roadmap with Outline / Skill tree / Timeline toggle. The Skill tree is left→right; locked topics are dimmed with a lock, done topics are success-green filled, learning topics have an info-blue ring.
- **Topic side sheet**: status selector (todo / learning / done / skipped), prerequisites as chips, linked lesson note (open / create), due date.
- **Folder tree**: drag indicator line between rows, a drop-into highlight (accent 15% fill), and a right-click menu (New note, New subfolder, Rename, Move to…, Color, Delete).

## 5. Small additions to the component sheet
Whiteboard tool bar (restyled) · sticky note (6 colors) · frame label · link preview card (4 states) · video card · PDF card · validation chip · script output log · API endpoint row with copy · RTL paragraph sample.

## Deliverables for this round
Desktop (1440×900) + phone (412×915) for: New… chooser, Canvas, Whiteboard, Code panel, Script console, Mermaid dialog, mixed Arabic/English note, link preview + video in a note, Course overview with skill tree. Light (Paper) variant for the whiteboard and the mixed-language note.
