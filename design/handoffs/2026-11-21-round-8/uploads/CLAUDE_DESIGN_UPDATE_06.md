# Claude Design follow-up #6: Whiteboard studio, pens and handwriting, shapes, palettes, layers, the mixed Board, the Architecture & diagram studio, drag and drop everywhere, presentation, and export for every visual

> Paste everything below the line into the **same Claude Design project** (after updates 01–05).
> Attach the files listed in `design/brief-06/README.md`: the design system, icon rules, feature list, the whiteboard roadmap, **the architecture & diagram studio spec (`docs/ARCHITECTURE_DIAGRAMS.md`)**, the current glyph set (`lumen-glyphs.js`) and the 15 current-state screenshots in `design/brief-06/screens/`.

---

## Why this round
Lumen has three visual workspaces today: **Canvas** (cards and arrows, JSON Canvas), **Whiteboard** (free drawing on Excalidraw, `.excalidraw`) and **Mermaid diagram**. This round adds two more on the same foundations: the mixed **Board** (§7) and the **Architecture & diagram studio** (§11, an Eraser-like mode of the canvas: drag-and-drop *and* code, kept in two-way sync). §13 explains how all five share one library, one palette, one export dialog, one AI review and one drag-and-drop model, so they feel like one product. The whiteboard now loads photos fast and plays GIFs, video and web pages, and every workspace has undo/redo. The look and the depth of the drawing tools are behind:
- Two toolbars that look like two products (Excalidraw's tool island and Lumen's code/media/Mermaid/export cluster).
- A tall Excalidraw style panel that scrolls.
- One generic pen.
- One fixed colour row.
- No layers, no board background options, no presentation.
- A three-item export menu on the whiteboard, while the canvas and Mermaid have a full export dialog.

This round designs **the whole drawing and visual-thinking experience**. Logic will be built **after** your design arrives (the reverse of round 5), so design freely. Each item below carries a feasibility tag so you know how close to the engine it sits:
- **[Native]:** Excalidraw already does it; restyle it in Lumen chrome.
- **[Lumen]:** we build it on top. Design the full UI.
- **[AI]:** runs on the free Workers AI vision model on the user's Cloudflare account. Always a review step, never a silent change.
- **[Later]:** design it now (one screen or state is enough), ship after.

Everything from rounds 1–5 still applies:
- **Visual system:** Lamplight / Paper tokens; one amber accent for the current or primary thing only; radius 6 / 10 / 14 / 999; Inter + IBM Plex Sans Arabic.
- **Icons:** the round-4 **Lumen glyph set** (1.75 stroke on a 20 grid). **No emoji anywhere**, not in tools, stamps, palettes, empty states or this document's deliverables. Every new tool, pen, shape, stamp, architecture node and export option needs a glyph. Section 14 lists the names we expect; add more if a control has none.
- **AI:** no "AI look" (no sparkles, gradients or glow; plain labels like "Convert to text").
- **Interaction:** one inline confirm bar, one menu style, one sheet style.
- **Layout:** desktop 1440×900 and phone 412×915 for every screen, Lamplight and Paper where marked **(both themes)**, Arabic RTL for one screen per section.

## 0. What's wrong today (see the screenshots)
- `01-whiteboard-desktop-*`: two islands at the top with different rhythm; the left is Excalidraw's tools (with number hints 1–0), the right is Lumen's code / script / media / web / Mermaid / export.
- `02-whiteboard-pen-tool-*`: the pen has only Stroke (5 colours), Background, three widths, Opacity, Layers (4 arrows). No pen types, no presets, no pressure.
- `03-whiteboard-shape-selected-*`: Lumen's sticky style bar (6 paper colours, size, font, duplicate, delete) **overlaps** Excalidraw's style panel; the panel is a long vertical list (Stroke, Background, Fill, Stroke width, Stroke style, Sloppiness, Edges, Arrow type, Font family, Font size, …).
- `04-whiteboard-export-menu-*`: export is three rows (PNG, SVG, .excalidraw), with no options.
- `05`/`06-canvas-*`: the canvas toolbar is now responsive with a ⋯ menu (Edit, View, Convert, Edges, Export). The canvas already has a full image export dialog (format PNG/SVG/JPEG/WebP, scale, background transparent/theme/custom colour, theme, padding, quality, text as SVG text, embed font, file name, copy image/SVG/source). The whiteboard should get the same dialog, and both need the additions in §9.
- `09`–`11` (phone): the whiteboard dock is Hand · Pen · Rectangle · Arrow · Sticky · Text · More (grid of Select, Eraser, Frame, Image, Diamond, Ellipse, Line, Web embed, GIF/video, Code, Script, Mermaid, Export, Undo/Redo).

## 1. Whiteboard shell (both themes)
Design **one** Lumen toolbar and a contextual property bar that replace the two islands and the tall panel.
- **Main toolbar** (top centre, desktop), grouped with hairline dividers:
  - **Navigate:** Select, Lasso, Hand.
  - **Ink:** pen slot showing the current pen's icon and colour dot, Highlighter, Eraser, Laser.
  - **Shapes:** a split button that remembers the last shape and opens the shape library.
  - **Lines:** line/arrow/connector split button.
  - **Content:** Text, Sticky.
  - **Media:** image, GIF/video, web embed, note card.
  - **Structure:** Frame.
  - **More:** Mermaid, code, script, board settings.
  - Keyboard hints stay as small numerals. Lock-tool toggle.
  - Every button is a glyph with a tooltip "Name · key".
- **Contextual property bar:** a horizontal bar that floats above the selection (or docks under the toolbar when nothing is selected and a tool is active).
  - Shows only what the selected thing has, as compact controls that open small popovers: colour, thickness, style, font, opacity, arrange, more.
  - Replaces both Excalidraw's tall panel and today's sticky bar. They must never overlap.
- **Tool wheel [Lumen]:** right-click or long-press on the board (Concepts-style).
  - A radial menu with the 6 last-used tools and pens, plus Undo/Redo at the centre.
  - Show it open on desktop and phone.
- **Bottom-left cluster:** zoom − / % / +, fit, Undo · Redo, minimap toggle.
- **Bottom-right:** a page/frames navigator chip ("Frame 2 of 5") when frames exist.
- **Board header (⋯):** board settings (§6), layers (§5), presentation (§8), export (§9), convert, history.
- **States:** empty board (one line + three start actions: Draw, Add a note card, Paste an image), view-only (shared link), offline, large board ("Performance mode: shadows off").

## 2. Pens, handwriting and erasing (both themes)
- **Pen types** (each its own glyph and a stroke preview line in the picker):
  - **Ballpoint [Lumen]:** even width, no pressure.
  - **Fountain [Native]:** pressure and speed thinning.
  - **Brush [Lumen]:** strong pressure taper.
  - **Marker [Lumen]:** wide, flat, slightly translucent.
  - **Highlighter [Lumen]:** translucent, draws *behind* ink, straight-line assist when held.
  - **Pencil [Later]:** textured.
  - **Calligraphy [Later]:** fixed nib angle.
  - **Laser [Native]:** a fading trail for presenting.
- **Per-pen settings popover:**
  - thickness slider 0.5–24 px with five preset dots;
  - colour (from the active palette, §4);
  - opacity;
  - smoothing / stabiliser (Off · Low · High);
  - pressure (On / Off, and a 3-point pressure curve: soft · linear · firm);
  - "Draw straight when I pause" (hold-to-straighten).
- **Pen presets / favourites [Lumen]:** a row of up to 8 saved pens (type + colour + width) in the toolbar's pen slot and the phone dock. Add, reorder, delete. Synced across devices.
- **Pen mode [Native+Lumen]:** "Stylus draws, finger pans". Auto-detected on first stylus touch, with a visible toggle. Palm rejection note.
- **Eraser:**
  - **Stroke eraser [Native]:** removes whole strokes.
  - **Partial eraser [Later]:** splits strokes.
  - **Lasso erase [Lumen].**
  - **Scratch-out gesture [Later]:** scribble over to delete.
  - Size options for each.
- **Lasso select [Lumen]:** free-form lasso. The selection gets an action bar:
  - Move, Resize, Recolour, Change pen, Duplicate, Copy as image, Group.
  - **Convert to shapes**, **Convert to text [AI]**, **Convert to math (LaTeX) [AI]**, **Convert to Mermaid [AI]**.
- **Shape recognition [Lumen]:** "Auto-shape" toggle, or hold at the end of a stroke. A rough circle, rectangle, triangle, line or arrow snaps to a clean shape, with a small inline "Undo snap" chip for 3 s.
- **Ruler / straight edge [Later]:** a draggable, rotatable ruler (MyScript / Goodnotes style). Shift = 15° angle snap.
- **AI review sheet [AI]**, used by every convert action:
  - left: the selected ink as an image; right: the result;
  - result types: typed text (editable), LaTeX with a rendered preview, or Mermaid with a live preview;
  - buttons: "Replace ink", "Add next to it", "Copy", "Try again";
  - states: working, low confidence (highlight unsure words), error, offline.
- **Handwriting search [AI, Later]:** recognised text is stored invisibly so search finds handwritten words; show a "Searchable" badge on the board.

## 3. Shapes, connectors, text, stickers (both themes)
- **Library panel: one for every workspace** (§13). Searchable, with recent and favourite rows; you drag items out of it (§12) or click to place at the centre. The whiteboard shows the drawing categories first; the Architecture studio shows the architecture categories first (§11.3); every category is reachable from both.
- **Drawing categories:**
  - **Basic:** rectangle, rounded rectangle, ellipse, diamond, triangle, hexagon, star, parallelogram, trapezoid, cylinder, cloud, heart, speech bubble, callout.
  - **Flowchart:** process, decision, terminator, data, document, multi-document, database, manual input, predefined process, delay, off-page connector.
  - **UML / structure:** class box (3 compartments), actor, package, note.
  - **Mind map:** central topic and branch topic, with "Tab = child, Enter = sibling" [Lumen].
  - **Containers:** frame, section with title [Lumen], table grid [Later].
  - **Math & study:** axes (x/y), number line, Venn (2/3), timeline, Cornell layout, Kanban columns [Lumen templates].
- **Connectors [Native]:**
  - paths: straight, curved, elbow;
  - heads per end: none, arrow, triangle, triangle outline, bar, dot, dot outline, diamond, diamond outline, crow's foot (one / many / one-or-many);
  - line style: solid, dashed, dotted;
  - label on the line;
  - bound to shapes (they follow when shapes move).
- **Shape style:**
  - fill: none, solid, hachure, cross-hatch, zigzag [Native], dots [Later];
  - stroke: width (thin, regular, bold, custom), style (solid / dashed / dotted);
  - sloppiness: architect / artist / cartoonist;
  - edges: sharp / round;
  - opacity.
- **Text:**
  - fonts: Hand, Sans, Serif, Code, Arabic, with live samples in each;
  - size S / M / L / XL / custom;
  - align, vertical align;
  - background highlight;
  - link.
- **Sticky notes [Lumen, exists]:**
  - six paper colours plus palette colours;
  - three sizes;
  - "stack" (several stickies in a pile);
  - sticky with author/device line.
- **Stamps [Lumen]:** quick marks for study boards, drawn as Lumen glyphs, never emoji:
  - check, cross, question, important, idea, star, warning, flag, heart, pin;
  - numbered circles 1–9;
  - an arrow-pointer and a "see note" link stamp.
- **Icon insert [Lumen]:** the whole Lumen glyph set as insertable, recolourable vector icons.

## 4. Colours and palettes (both themes)
- **Palette switcher** at the top of every colour popover. Several palettes ship:
  1. **Lumen ink** (default, theme-aware: dark ink shows light on Lamplight).
  2. **Paper stickies:** the 6 pastels in use today: #fff3bf #d3f9d8 #d0ebff #ffd8a8 #eebefa #ffc9c9.
  3. **Highlighters:** 5 translucent: yellow, green, blue, pink, orange.
  4. **Colour-blind safe (Okabe-Ito):** #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000.
  5. **Greys:** 6 steps.
  6. **Vivid:** 10 saturated colours.
  7. **Board palette:** colours used on this board.
  8. **Custom palettes [Lumen]:** create, name, add from the eyedropper or hex, reorder, delete. Synced.
- **Colour popover:**
  - swatch grid; a shades row for the selected swatch;
  - **Recent** (last 8);
  - hex input; eyedropper [Native];
  - opacity;
  - "Keep exact colour in dark theme" toggle (turns off the ink flip for this element);
  - a contrast warning when text on a fill fails AA.
- Swatches carry a tooltip name ("Okabe orange"). Never rely on colour alone: the selected swatch gets a ring, not just a shade change.

## 5. Layers and arrangement
- **Layers panel [Lumen]:** a right-side panel on desktop, a sheet on phone.
  - Named layers, with defaults "Background", "Sketch", "Notes". Add, rename, reorder by drag, delete.
  - Per layer: show/hide (eye), lock, opacity.
  - "Move selection to layer". The active layer is highlighted; new strokes go there.
  - Shows element counts.
  - Explain in a one-line hint that layers are a Lumen feature saved inside the `.excalidraw` file.
- **Arrange [Native]:**
  - bring to front, forward, backward, to back;
  - group / ungroup; lock / unlock;
  - align (6) and distribute (2); flip horizontal / vertical.
- **Frames navigator:** a list of frames with thumbnails. Rename, reorder, zoom to, hide from presentation.

## 6. Board settings and backgrounds (both themes)
- **Background colour:** Theme (follows Lamplight/Paper), Paper white, Warm paper, Chalkboard green, Blueprint, Custom, Transparent.
- **Pattern:** None, Dots, Grid, Lines (ruled), Isometric, Cornell, Graph (5 mm), Music staff [Later]; density slider; pattern colour follows the theme.
- **Mode:** Infinite (default), or Pages [Lumen] (A4 / Letter / 16:9 pages stacked vertically, for handwriting notes and printing).
- **Snapping:** snap to grid; snap to objects [Native]; angle snap.
- **View:** zen mode (hide UI), view-only, grid on/off, minimap.
- **Defaults for new boards** (in Settings › Diagrams): default pen, palette, background, pattern.

## 7. The mixed Board (new option)
Today the New visual chooser offers Canvas, Whiteboard, Mermaid diagram and Graph from note.
- **Board** is a new option: **everything on one surface**. Free ink and shapes, **note cards** (live title, excerpt, tags, open or edit inline), **.mermaid file cards** (live diagram), canvas-style link cards with previews, images, GIF/video, web embeds, stickies and frames. Arrows connect anything.
- **Chooser:**
  - redesign it with six cards, each with its own glyph and a 3-word "for hands" line: Canvas, Whiteboard, **Board** ("Draw, link notes, drop media"), Mermaid diagram, **Architecture & diagrams** ("Drag or type a system", §11.1), Graph from note;
  - keep the folder picker;
  - each card lists its capabilities as chips;
  - a "From template" row and an "Import" row (Mermaid, draw.io, `.excalidraw`, `.canvas`, Terraform, SQL) under the cards.
- **On the board:**
  - **Note card states:** collapsed (title), card (title + excerpt), expanded (inline editor, scroll), missing note.
  - Mermaid card with an edit toggle. Link card. PDF page card [Later].
  - "Send to board" from a note, from a search result, and from the canvas.
- **Conversions:** Canvas → Board and Whiteboard → Board (copies; originals stay), shown in the Convert menu.
- **Page / board toggle [Later]:** AFFiNE-style. A note can open "as page" or "on board".

## 8. Presentation (both themes)
- **Frames become slides:**
  - a Present button in the header;
  - full-screen, slide-to-slide animation between frames;
  - laser and pen while presenting;
  - a slide counter;
  - presenter notes (frame description);
  - the phone works as a remote (Lumen already has a phone remote for slides).
- **Frames panel order** = slide order; a "Hide from presentation" eye per frame.
- **Export frames:** PDF (one page per frame) or a PNG zip (§9).
- **One presenter for every workspace:** whiteboard and Board step through frames; canvas steps through groups; the Architecture studio steps through layers, groups or C4 levels (§11). Same controls everywhere.

## 9. Export, one dialog for every visual (both themes)
Use the existing canvas export dialog layout (live preview on the left, options on the right, size estimate, Download + Copy) for the **Whiteboard, Board, Canvas, Mermaid and the Architecture studio**. Show it for each.
- **Scope:** Whole board, Selection, Visible area, Frame(s) (multi-select with thumbnails).
- **Format:**
  - PNG, JPEG, WebP, SVG;
  - PDF (single page, or one page per frame, page size Fit / A4 / Letter / 16:9, orientation, margins);
  - the source file (.excalidraw / .canvas / .mermaid);
  - Markdown (board text and links as an outline, images as attachments);
  - Mermaid text (flowchart-like boards only, with a "best effort" note; for the Architecture studio also `architecture-beta`, `erDiagram`, C4, `block-beta`, sequence, state, class);
  - Architecture studio extras: Lumen diagram code (`.lumendiagram`), draw.io XML, SQL DDL (from an ERD), Markdown with a component table (name, kind, tech, owner, status);
  - HTML (interactive, read-only) [Later].
- **Look:**
  - scale 1× / 2× / 3× / 4× or "max px";
  - background: Transparent, Theme, Custom colour, Board background;
  - include pattern (dots/grid) on or off;
  - theme: Match app / Paper / Lamplight;
  - padding; quality (lossy formats).
- **Content toggles:**
  - include frame names;
  - include hidden layers (off);
  - media as still frame or a placeholder (GIF/video can't animate in images: say so);
  - embed scene data (a PNG/SVG that reopens as an editable board) [Native];
  - canvas only: card style (as on screen / flat / print), group labels, edge labels.
- **Presets:** Slides 16:9, A4 print, Social square, Transparent sticker. Remember last-used settings per workspace.
- **Copy menu:** copy PNG, copy SVG, copy source, copy as Markdown, copy link (if shared).
- **States:** rendering, too large ("limited to 3× by the browser"), media placeholders warning, done toast.

## 10. Canvas (JSON Canvas) options to design
- **Node shapes [Lumen, saved as `lumen*` keys]:** rectangle, rounded, pill, diamond, circle, parallelogram, cylinder (Advanced Canvas style).
- **Border styles:** solid, dashed, dotted, none. **Card background:** none / tint / solid.
- **Edge style:** path (curved / elbow / straight, exists), line style, heads per end, thickness, label style.
- **Colours:** the six presets plus the palettes from §4.
- **Groups:** collapsible groups [Lumen] with a "N cards" chip; group background pattern.
- **Portals [Later]:** canvas-in-canvas (a card that shows another canvas live).
- **Canvas background:** dots / grid / none, colour.
- **Presentation:** walk through groups as slides (§8).
- **Export:** §9.

## 11. Architecture & diagram studio (both themes)
Source spec: `docs/ARCHITECTURE_DIAGRAMS.md` (research, full feature list, data model). It is **a mode of the canvas**, not a separate tool. **The canvas JSON is the single source of truth**; the text code, Mermaid and the visual board are all views of it, and an edit in any view writes back to the same JSON. Everything canvases already have keeps working: sync, versions, share links, export, Tidy up, undo/redo, activity log. Design the screens below; the spec has the details for each.

### 11.1 Entry points
- The chooser card "Architecture & diagrams" (§7) opens a sub-chooser:
  - diagram types: Architecture · Flowchart · Sequence · ERD · C4 · Network · Data / ML pipeline · State · Class · BPMN-lite · Threat model;
  - From template (§11.7) · Describe it (AI) · Import (Mermaid / draw.io / Terraform / CloudFormation / docker-compose / k8s / SQL DDL / OpenAPI).
- In a note: slash menu (`/architecture`, `/diagram`, `/erd`), "Make a diagram" on selected text or code, the project hub's Diagrams tab ("New architecture").

### 11.2 Main screen (desktop)
Layout from the spec §5.2: **Library** (left) · **canvas** (centre, dot grid) · **Code** (right: tabs **Code · Mermaid · JSON**). The **Properties** panel slides over the code pane when a node is selected. Header: breadcrumb · title · Saved · Layout · Code toggle · Present · Export · Share.
- **Split ratios:** canvas only, 50/50, code only. Remember per diagram.
- **Two-way sync states:**
  - typing → the canvas updates within 300 ms; existing nodes keep their positions; only new nodes get placed;
  - dragging, renaming or connecting rewrites the code;
  - "last valid state wins": a syntax error shows an inline marker and a one-line banner, and the canvas keeps the last good diagram;
  - hover a line of code and its node highlights on the canvas, and the reverse.
- **Code editor:** line numbers, autocomplete (icons, node names, keywords), error markers, format button, "copy Mermaid". Show the spec's DSL example.
- **Paste-in conversion:** paste Mermaid / draw.io XML / SQL DDL into the code pane → "Convert to Lumen diagram?" inline confirm bar.

### 11.3 Nodes, groups, connections
- **Node kinds** with glyph icons: service, database, queue/topic, cache, storage/bucket, function, container/pod, gateway/LB, CDN, user/actor, external system, web client, mobile client, note, text, image, embedded note card, embedded diagram card.
- **Node look:** icon + name + small tech line ("Postgres 16") + status ring (planned / building / live / deprecated) + optional cost or SLA chip. Sizes S / M / L.
- **Groups / boundaries:** region, VPC, subnet, zone, cluster, namespace, account, team, trust boundary. Nestable; label + icon + colour; collapse a group into a summary node with an "N inside" chip.
- **Connections:** ports on four sides (anchors), junctions to split/merge, straight / orthogonal / curved, arrow ends none/one/both, label (protocol, port, payload), dashed = async, colour by kind (sync / async / data / control) with a small legend.
- **Library categories (the shared library, §3):** Generic · Compute · Data · Network · Messaging · AI / ML · Security · Clients · Kubernetes · SaaS, plus optional vendor packs (AWS / Azure / GCP) shown **unmodified** (never recoloured, licence rule in the spec §1.4) with a "Vendor icons" toggle in settings.
- **Properties panel:** name, kind, icon, technology, description, owner, links (notes, RFC, ADR, REQ-n, repo URL, project-hub cards), tags, status, cost label, SLA.

### 11.4 Layout
- **Layout menu:** Auto layout (elkjs layered with nested groups and orthogonal routing), direction (right / down), spacing (compact / roomy), "keep my positions" vs "re-layout all", **preview → Apply → Undo** (the same flow as canvas Tidy up), layout only the selection or one group.
- Alignment guides and distribute while dragging (shared with the canvas, §12).

### 11.5 AI flows [AI]
One review pattern for all AI in this round (shared with the whiteboard convert sheet, §2):
- **Create:** Describe → diagram; Code / OpenAPI / docker-compose / k8s → diagram; Terraform / CloudFormation → diagram (parser first, AI fallback); SQL / ORM → ERD; RFC or PRD note → diagram; **sketch on the whiteboard → architecture** (§2 lasso "Convert to Mermaid" offers "Open as architecture diagram").
- **Edit by instruction:** "add a Redis cache between API and DB". The change shows as a **diff on the canvas** (added nodes green, removed red, changed amber) plus the code diff, with Accept / Reject.
- **Review:** prose explanation, single points of failure, missing auth / encryption / backups, STRIDE threats as a list you can turn into notes or tasks.
- **Diagram → docs:** ADR / RFC section, component table, Mermaid for a README; **flashcards** ("What sits between API and DB?").
- AI output is always diagram code, validated before it touches the canvas.

### 11.6 Model features
- **Reused objects** (IcePanel-style): the same "Payments API" can appear in several diagrams; editing it updates all. Show the "Used in 3 diagrams" chip and the picker to insert an existing object.
- **C4 zoom levels:** double-click a container → its component diagram, breadcrumb back (Context › Container › Component).
- **Links to work:** status ring fed by linked project-hub cards.
- **Version diff:** compare two versions from History (green / red / amber), using the activity log and versions that exist now.

### 11.7 Templates
3-tier web app, serverless API, event-driven microservices, RAG / LLM app, ML training + serving pipeline, data lakehouse, k8s deployment, mobile + backend, C4 starter, ERD starter, threat-model starter, interview system designs (URL shortener, chat, feed, payments; with a **review mode that hides labels** for recall).

### 11.8 Phone
Full-screen canvas; bottom bar **Library · Connect · Code · Layout · ⋯**; the library and properties as sheets; code as a full-screen tab with a Preview toggle. Every drag action has a menu path (§12.5).

## 12. Drag and drop everywhere (both themes)
Drag and drop is the main way to build boards and diagrams, so it needs one consistent model across the app. Design the states, not just the happy path.

### 12.1 Sources → targets
| Drag from | Drop on a canvas / Board / Architecture | Drop on a whiteboard | Drop on a card or node | Drop in a note |
|---|---|---|---|---|
| Library item | new shape / node at the drop point; into a group if dropped inside | new shape | (not allowed: the drop indicator says why) | — |
| Note from the sidebar, note list, search, backlinks, Ask sources | **note card** (live) | note card (Board) / link card (whiteboard) | link the note to the node (Architecture: adds to its Links) | wiki link `[[Note]]` |
| Files from the desktop (images, PDF, video, GIF, audio, `.md`, `.canvas`, `.excalidraw`, `.mermaid`, `.drawio`, `.sql`) | image / media / file card; diagram files are offered as "Import" | photo (fast path) / media embed | attach to the node | attachment |
| Selected text from a note or the PDF reader (highlights) | text card with a "from Note" source chip | text | append to the card | quote block |
| URL (from the browser bar or a link) | link card with preview; YouTube/Vimeo as an embed | web embed | add as the node's link | link card |
| **Graph node(s)** from "Graph from note" (one, a selection, or "this node + neighbours") | note cards **with the links between them as edges**, laid out like the graph | link cards | link the note to the node | wiki links |
| A `.mermaid` file or diagram card | live diagram card | "Insert as shapes" or "as picture" | — | `![[diagram]]` embed |
| A whole canvas / whiteboard / board from the sidebar | **portal card** [Later] (a live window into it) or "Copy contents here" | picture of it (refreshable) | link | `![[name]]` embed |
| Shapes / cards inside the board | move; into or out of a group; reorder frames and layers in their panels | move | **combine** (Board: drop a sticky on a note card → "Add to note?") | — |
| Out of the app [Later] | — | drag a selection out as a PNG | — | — |

### 12.2 Feedback while dragging
- **Ghost preview** of what will be created (not just the cursor).
- **Drop indicators:** group outlines light up in the accent when the drop will nest; a not-allowed state with a one-line reason; an insertion line for lists (frames, layers, library favourites).
- **Alignment guides and snap** (grid, objects, centre lines) while moving.
- **Auto-scroll** when dragging near the edge; zoom stays put.
- **Multi-item drags** show a count badge ("3 notes").
- **After the drop:** the new item is selected, with a 3-second "Undo" chip; it is one undo step.

### 12.3 Rules
- Drop position = under the pointer in board coordinates (zoom and pan respected); into a group = relative to the group.
- Dropping a big file shows progress on the card itself; the board never freezes (photos are shrunk off the main thread, already built).
- Duplicate files dropped twice ask "Use the existing attachment?".
- Hold Alt while dropping = alternative (e.g. link instead of card, copy instead of move).

### 12.4 Touch and phone
- Long-press to pick up (with a haptic tick), drag, release; or **Send to…** from the item's menu (Board, canvas, a group, a frame).
- The share sheet (Android "Share to Lumen", already built) can target "Add to board…".

### 12.5 Without a mouse (accessibility)
- Every drag has a menu or keyboard path: "Move to group…", "Add to board…", "Connect to…", "Move up/down" in panels.
- Keyboard: Space / Enter picks up a focused item, arrows move it (Shift = bigger step), Enter drops, Escape cancels; drop targets get labels that a screen reader announces.

## 13. How the workspaces fit together (overlaps resolved)
The five visual workspaces share these parts. Design each **once** and show where it appears:

| Shared part | Whiteboard | Board | Canvas | Architecture | Mermaid file |
|---|---|---|---|---|---|
| Library panel (§3, §11.3) | drawing first | all | cards + node kinds | architecture first | — |
| Palettes + colour popover (§4) | yes | yes | card colours | node / edge colours | theme only |
| Layers panel (§5) | element layers | element layers | tag filters as layers | network / data-flow / security layers | — |
| Properties: floating bar (drawing) or side panel (architecture) | bar | bar | bar | side panel | — |
| Export dialog (§9) | yes | yes | yes | + DSL, draw.io, SQL, Markdown table | yes |
| AI review (§2, §11.5) | convert ink | convert ink | — | create / edit / review | create |
| Presenter (§8) | frames | frames | groups | layers / groups / C4 levels | — |
| Drag and drop (§12) | yes | yes | yes | yes | — |
| Undo/redo + Activity log (built) | yes | yes | yes | yes | yes |
| Code panel | `.excalidraw` JSON + script | JSON + script | JSON Canvas + script | **Code · Mermaid · JSON** | Mermaid |

"Graph from note" is the sixth, read-only view: its nodes can be dragged out (§12.1) and it has "Open as canvas" (keeps the layout and links).

### 13.1 Conversions (Convert menu in every workspace; always a **copy**, the original stays; the new file opens with an "Undo conversion" chip)
| From ↓ / To → | Whiteboard | Board | Canvas | Architecture | Mermaid file | Note (Markdown) |
|---|---|---|---|---|---|---|
| **Whiteboard** | — | yes (all elements kept) | shapes with text → cards, arrows → edges | ink → [AI] diagram, shapes → nodes | flowchart-like → Mermaid [best effort]; ink → [AI] | text + images as an outline |
| **Board** | ink + shapes, cards as pictures | — | cards + edges, ink as an image card | cards and shapes → nodes | best effort | outline with links |
| **Canvas** | exists (cards → shapes) | yes | — | cards → nodes (kinds guessed, editable) | flowchart | outline (exists in reverse: note outline → canvas) |
| **Architecture** | sketch-style copy | yes | plain cards | — | architecture-beta / flowchart / ER / C4 | component table + Mermaid |
| **Mermaid file** | exists (editable shapes) | diagram card or shapes | flowchart → cards + edges | parsed into nodes | — | `mermaid` block |
| **Graph from note** | — | note cards + edges | yes, layout kept | — | flowchart of links | list of links |
| **Note** | — | "Send to board" | outline → canvas (exists) | "Make a diagram" [AI] | `/diagram` | — |

Show the Convert menu with this list for one workspace and the "what will be kept / lost" line under each target (e.g. "Ink becomes an image card").

### 13.2 Saving and editability rules (show them as small hints, not dialogs)
- Everything autosaves (no Save button), syncs, has version history, the activity log and undo/redo. A "Saved · Synced" line stays in the header.
- **Everything stays editable and movable after it is placed:** shapes, ink, cards, nodes, groups, edges, media, embeds; locked items show a lock glyph and explain how to unlock.
- Each workspace keeps its **open file format** (`.excalidraw`, `.canvas` JSON Canvas, `.mermaid`); Lumen-only data rides in `lumen*` keys, so other apps open the files and ignore the extras.
- Selection is the same everywhere: click, Shift+click, marquee, lasso (drawing), Ctrl+A; the floating property bar shows what the selection shares; multi-selections can be moved, aligned, recoloured, grouped, exported or sent to another workspace (§12, "Send to…").

### 13.3 Choosing a workspace (the chooser in §7)
Each chooser card says what it is best at, what you do with your hands, its file format and what it converts to, so picking is easy:
- Canvas: arrange notes and ideas.
- Whiteboard: sketch and handwrite.
- Board: everything together.
- Mermaid: type a diagram.
- Architecture & diagrams: drag or type a system.
- Graph from note: see connections.

A small "Not sure? Start with Board" hint sits under the cards. A workspace can always be converted later (§13.1).

## 14. Icons (glyphs) needed
In the round-4 style, with a tooltip label for each.

| Area | Glyphs |
|---|---|
| Tools | lasso, highlighter, laser, eraser-stroke, eraser-partial, ruler, auto-shape, frame, sticky, stamp, connector, note-card, board |
| Pens | pen-ballpoint, pen-fountain, pen-brush, pen-marker, pen-pencil, pen-calligraphy |
| Shapes | shape-library, rounded-rect, triangle, hexagon, star, parallelogram, trapezoid, cylinder, cloud, callout, speech-bubble |
| Flowchart | process, decision, terminator, data, document, database, manual-input, predefined, delay, off-page |
| UML and mind map | uml-class, actor, package, mind-map |
| Arrowheads | arrowhead-none, arrowhead-arrow, triangle, triangle-outline, bar, dot, dot-outline, diamond, crowfoot-one, crowfoot-many |
| Style | fill-none, fill-solid, fill-hachure, fill-crosshatch, fill-zigzag; stroke-solid, stroke-dashed, stroke-dotted; sloppiness-0/1/2; edges-sharp, edges-round |
| Arrange | layers, layer-add, layer-hidden, layer-locked, bring-front, bring-forward, send-backward, send-back, align ×6, distribute ×2, flip-h, flip-v, group, ungroup |
| Board | palette, eyedropper, swatch-add, background, pattern-dots, pattern-grid, pattern-lines, pattern-isometric, pattern-cornell, pages, infinite, snap, zen |
| Presentation | present, presenter-notes, slide-next, slide-prev |
| Export | export, scope-selection, scope-frame, scope-visible, pdf, image, vector, transparent, embed-scene, copy-image |
| AI convert | to-text, to-math, to-mermaid, to-shapes, to-architecture (plain glyphs, no sparkle) |
| Architecture nodes (about 80, generic, glyph style) | service, server, database, queue, topic, cache, bucket, function, container, pod, cluster, gateway, load-balancer, cdn, dns, api, user, team, browser, mobile, desktop, external-system, firewall, key, lock-shield, vault, identity, monitoring, logs, metrics, alert, scheduler, worker, stream, etl, warehouse, lake, feature-store, model, gpu, vector-db, llm, embedding, notebook, registry, ci, repo, webhook, email, sms, payment, search, file, region, vpc, subnet, zone, namespace, account, trust-boundary, internet, on-prem |
| Architecture UI | library, code-view, split-view, layout-auto, layout-direction, port, junction, edge-sync, edge-async, edge-data, status-planned, status-live, status-deprecated, c4-level, reused-object, diff, template |
| Drag and drop | drag-handle, drop-into, not-allowed, send-to, move-to-group |
| Stamps | check, cross, question, important, idea, star, warning, flag, heart, pin, number-1…9 |
| Emoji left in the app | a **calendar chip** and **start chip**: task lines store a due date as the calendar emoji (U+1F4C5) + `2026-11-20` and a start date as the departing-plane emoji (U+1F6EB) (Obsidian Tasks format, kept in the file) but the live editor should draw them as glyph chips; **thumbs up / down** for Ask feedback |

Deliver an updated `lumen-glyphs.js` with all names above.

## 15. Phone (Lamplight)
- **Dock:**
  - Hand, Pen slot (current pen; long-press for presets), Highlighter, Eraser, Shapes, Text, More;
  - the dock sits above the home indicator;
  - Undo/Redo float at top-left while drawing.
- **Sheets:** pen settings, palette, shape library, layers, board settings, export (one sheet with sections), AI review (full screen).
- Tool wheel (long-press with a finger while in pen mode = pan; show the rule).
- **Arabic RTL:** toolbars and sheets mirror; the drawing, arrows and handwriting never mirror.

## 16. Deliverables
- Screens, numbered from 33, one file per area as in earlier rounds:
  - 33 Whiteboard shell
  - 34 Pens & handwriting
  - 35 AI review
  - 36 Shapes & connectors
  - 37 Palettes
  - 38 Layers & arrange
  - 39 Board settings
  - 40 Mixed Board + chooser
  - 41 Presentation
  - 42 Export dialog (4 workspaces)
  - 43 Canvas options
  - 44 Phone
  - 45 Components R6 (toolbar buttons, split buttons, property bar, popovers, swatch, slider, layer row, frame row, stamp, note card on board)
  - 46 Architecture studio (sub-chooser, main screen in 3 split ratios, sync and error states, properties panel)
  - 47 Architecture nodes, groups and connections (all kinds, status rings, collapsed group, ports, junctions, legend)
  - 48 Architecture layout, AI flows (create, edit-by-instruction diff, review) and model features (reused object, C4 levels, version diff)
  - 49 Shared library panel (drawing and architecture categories, vendor packs toggle)
  - 50 Drag and drop states (ghost, nest indicator, not-allowed, guides, auto-scroll, count badge, undo chip, touch long-press, keyboard pick-up)
  - 51 Templates gallery (study, whiteboard and architecture templates)
  - 52 Conversions (Convert menu with keep/lose lines, "Undo conversion" chip) and graph → canvas / drag from graph
- Updated `lumen-glyphs.js`.
- Show key states (empty, selected, hover, active, disabled, loading, error) on the components page.
- Out of scope: real-time multi-user collaboration and cursors.
