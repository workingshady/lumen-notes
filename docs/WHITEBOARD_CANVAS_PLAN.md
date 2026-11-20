# Whiteboard, Board and Canvas: implementation plan (waits for Claude Design round 6)

Design brief: `docs/design/CLAUDE_DESIGN_UPDATE_06.md` (attachments in `design/brief-06/`). **No feature logic is built before the handoff arrives**; then implement to the design 1:1, deploy, commit and push after each wave (the owner's usual flow). Earlier list of ideas: `docs/WHITEBOARD_ROADMAP.md`.

Tags as in the brief: **Native** = Excalidraw 0.18 already does it (restyle or expose), **Lumen** = build on top, **AI** = Workers AI vision with a review step, **Later** = after the main waves.

## Engine facts that shape the build
- Whiteboard = Excalidraw 0.18 (`src/components/Whiteboard.tsx`). We keep its scene format; extra data lives under `customData.lumen*` on elements and `lumen*` keys on the scene (format rule in CLAUDE.md).
- Freedraw uses perfect-freehand with real pressure (stylus) or simulated pressure (mouse). Pen types are mapped to element props: `strokeWidth`, `opacity`, `simulatePressure`, constant `pressures` for ballpoint, plus our own stroke post-processing for brush taper and highlighter. Pencil texture and calligraphy need a custom renderer, so they are tagged Later.
- Excalidraw has no real layers. Lumen layers = `customData.lumenLayer` + z-order bands; hide = filtered out of the scene with the elements kept in a side store until shown again; lock = `locked: true` on the band. Saved in the file, so other `.excalidraw` viewers see all elements flat.
- Excalidraw's UI can be hidden piece by piece (we already hide the menu, help and hints). The new toolbar and property bar drive it through `excalidrawAPI` (`setActiveTool`, `updateScene`, `getAppState`, current-item app state like `currentItemStrokeColor`, `currentItemStrokeWidth`, `currentItemOpacity`, `currentItemRoughness`, `currentItemFillStyle`, `currentItemStrokeStyle`, `currentItemFontFamily`, `currentItemFontSize`, `currentItemStartArrowhead`/`EndArrowhead`).
- Exports: Excalidraw's `exportToBlob`/`exportToSvg` (scale through `getDimensions`/`maxWidthOrHeight`, `exportPadding`, `exportBackground`, `exportWithDarkMode`, `exportEmbedScene`, selection or frame via the elements passed). PDF = our own (jsPDF or pdf-lib, lazy chunk) from per-frame PNG/SVG. One shared export dialog: generalise `src/components/DiagramExport.tsx` (already used by canvas and Mermaid).
- Media embeds (GIF/video/web) can't be rasterised; exports draw a still or a placeholder (the brief asks for that state).

## Architecture studio and drag and drop (merged into round 6)
`docs/ARCHITECTURE_DIAGRAMS.md` is now part of this round (brief §11–§13). Its build phases 1–7 are folded into the waves below. What it reuses and what it adds:
- **One library panel** (brief §3, §11.3) shared by whiteboard, Board, canvas and Architecture: one data file of items, where each item knows how to become an Excalidraw skeleton (`src/lib/whiteboard.ts` helpers) and/or a JSON Canvas node with `lumenNode` (`src/lib/canvas.ts`).
- **Drag and drop model** (brief §12) in one module, `src/lib/dnd.ts`:
  - a typed payload (`library-item`, `note`, `notes`, `graph-nodes`, `file`, `text`, `url`, `diagram`, `workspace`) put on the native DataTransfer as `application/x-lumen+json`;
  - drop handlers per workspace convert screen to board coordinates: React Flow `screenToFlowPosition`, Excalidraw `scrollX/Y` and zoom (already used in `Whiteboard.tsx`);
  - group nesting: React Flow `parentId` with a relative position; JSON Canvas stays flat, with group membership by geometry plus `lumenGroup.parent`;
  - native HTML5 DnD on desktop; a pointer-events fallback on touch (HTML5 DnD doesn't work on touch, React Flow docs);
  - keyboard pick-up / move / drop and "Send to…" menus for accessibility (React Aria / Atlassian Pragmatic DnD guidance);
  - drop sources are added to the sidebar, note list, search, backlinks, Ask sources, the PDF reader and Graph.
- **Two-way code sync:** a Lumen DSL parser/printer (`src/lib/arch-dsl.ts`); canvas JSON stays the source of truth and the DSL is derived (comments cached in `lumenArch.dsl`); the last valid state wins. Mermaid import/export for flowchart, `architecture-beta` (icons through `mermaid.registerIconPacks`, lazy), `erDiagram`, C4, `block-beta`.
- **Layout:** elkjs (lazy, in a Web Worker) for compound groups and orthogonal edges, with preview → apply → undo like Tidy up.
- **AI:** the same `/api/ai` with new prompts that output DSL, which is validated before it is applied; the edit-by-instruction diff reuses the version-diff colours.
- **Shared parts are built once:** export dialog, palettes, layers panel, presenter, AI review and convert menu (brief §13 table). Conversions follow the matrix in brief §13.1, always as copies with an "Undo conversion" chip.

## Waves after the handoff
1. **Shell:** the new toolbar, contextual property bar (replaces Excalidraw's panel and the sticky bar, fixes the overlap seen in `03-whiteboard-shape-selected-*`), bottom clusters, board header menu, new glyphs (`src/lib/glyphs.ts` from the new `lumen-glyphs.js`). Phone dock and sheets.
2. **Pens:** pen types, per-pen settings, presets/favourites (synced in settings), pen mode toggle, highlighter-behind-ink, laser restyle, eraser options, hold-to-straighten.
3. **Palettes:** palette switcher, the shipped palettes (Lumen ink, Paper stickies, Highlighters, Okabe-Ito, Greys, Vivid, Board), custom palettes (synced), recent colours, eyedropper, shades, "keep exact colour in dark theme" (per-element `customData.lumenExact`, excluded from the ink filter by drawing those elements on an overlay, or by a per-element counter-filter: decide in implementation).
4. **Shapes:** shape library (basic, flowchart, UML, mind map, study templates) as skeleton generators in `src/lib/whiteboard.ts`, stamps and icon insert (glyph SVG paths → Excalidraw elements or image files), connector heads (Native), text fonts.
5. **Layers & arrange:** layers panel, frames navigator, arrange actions (Native wiring).
6. **Board settings:** backgrounds and patterns (CSS layer behind the transparent Excalidraw canvas, exported by drawing the pattern into the export), pages mode (frame-like page elements + snapping), defaults in Settings › Diagrams.
7. **Export dialog for all:** scope, formats incl. PDF per frame, presets, content toggles; canvas options (card style, group/edge labels, background pattern).
8. **Lasso & recognition:** lasso selection, auto-shape (on-device geometric fit or a $P-style recogniser), Undo-snap chip.
9. **AI convert:** `/api/ai` vision action (Workers AI `@cf/meta/llama-3.2-11b-vision-instruct` or `llama-4-scout-17b-16e-instruct`; the request sends a PNG of the selection) for text / LaTeX / Mermaid, the review sheet, daily-limit handling (the AI usage meter exists).
10. **Mixed Board:** new note type `board` (an `.excalidraw` body with `lumen` card embeddables: note cards rendered through `renderEmbeddable`, live from the vault), chooser card, conversions Canvas → Board and Whiteboard → Board, "Send to board".
11. **Presentation:** frames as slides, present mode, phone remote via the existing `SlidesRemote` Durable Object, PDF per frame.
12. **Canvas options:** node shapes, border styles, edge heads/thickness, collapsible groups, background, all as `lumen*` keys in JSON Canvas.
13. **Drag and drop:** `src/lib/dnd.ts`, drop targets in all workspaces, sources across the app (sidebar, list, search, backlinks, Ask, PDF, Graph), ghost / nest / not-allowed / guides / count / undo-chip states, touch long-press, keyboard and "Send to…".
14. **Architecture studio part 1:** node kinds and the generic icon set, nested groups, properties panel, ports, junctions and edge kinds, Architecture chooser + templates (ARCHITECTURE_DIAGRAMS phase 1).
15. **Architecture studio part 2:** DSL parser/printer, two-way sync, errors and autocomplete, Code · Mermaid · JSON tabs, paste-in conversion (phase 2).
16. **Architecture studio part 3:** Mermaid import/export (architecture-beta, ER, C4, block), elkjs layout, PDF / draw.io / SQL / Markdown export, `![[Diagram]]` live embed (phases 3–4).
17. **Architecture studio part 4:** AI create / edit-by-instruction diff / review / docs / flashcards (phase 5); reused objects, C4 zoom, version diff, hub status rings (phase 6); optional vendor icon packs and threat-model tags (phase 7).
18. **Conversions matrix and Graph:** every Convert path in brief §13.1, "Open as canvas" from Graph, drag from Graph.
19. **Later:** pencil / calligraphy renderers, partial eraser, scratch-out gesture, ruler, handwriting search, portals, HTML export, page/board toggle, music staff pattern.

## Emoji clean-up still open (UI)
- Live editor: draw task-date markers (calendar / start emoji in the stored text) as glyph chips; the stored text stays as-is for Obsidian Tasks compatibility.
- Docs keep only plain words for status (FEATURES.md, design/README.md were converted).

## Research sources
- tldraw draw shape (pressure, dash styles, sizes): https://tldraw.dev/sdk-features/draw-shape · stroke size picker: https://tldraw.dev/examples/stroke-size-picker · lasers: https://tldraw.dev/blog/redesigning-lasers
- Goodnotes pen tool (ballpoint / fountain / brush, pressure): https://support.goodnotes.com/hc/en-us/articles/7353756785679-Write-and-customize-ink-with-the-Pen-tool
- Notability favourites toolbar: https://www.macrumors.com/2020/08/31/notability-10-new-tools-shop/
- Excalidraw export utilities: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export · presentations: https://plus.excalidraw.com/use-cases/presentations
- MyScript / Nebo convert (text, math, shapes, ruler, gestures): https://help.myscript.com/nebo/edit-content/convert
- Concepts (tool wheel, layers, precision): https://apps.apple.com/app/id560586497
- AFFiNE edgeless (docs + whiteboard on one surface): https://www.mintlify.com/toeverything/AFFiNE/features/whiteboard
- Miro presentation mode: https://help.miro.com/hc/articles/34307373858450-Presentation-mode
- Obsidian Advanced Canvas (node shapes, edge styles, portals, presentations): https://github.com/Developer-Mike/obsidian-advanced-canvas · CanvasPort export options: https://community.obsidian.md/plugins/canvasport
- Okabe-Ito palette: https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference · accessible palettes: https://accessibility.huit.harvard.edu/color
- Adobe Fresco colours (recent, eyedropper): https://helpx.adobe.com/sea/fresco/using/colors.html
- Workers AI vision: https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct
- Architecture studio research: all sources in `docs/ARCHITECTURE_DIAGRAMS.md` §9
- React Flow drag and drop (sidebar, `screenToFlowPosition`, touch caveat): https://reactflow.dev/examples/interaction/drag-and-drop · sub flows (`parentId`, relative position, `extent`): https://reactflow.dev/learn/layouting/sub-flows
- Accessible drag and drop: https://react-aria.adobe.com/blog/drag-and-drop · https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines/ · https://frontendchecklist.io/rules/accessibility/draggable-accessibility
- Mermaid icon packs for architecture-beta: https://mermaid.js.org/config/icons.html
- Obsidian canvas drag and drop (files, folders, notes): https://obsidian.md/help/plugins/canvas · Heptabase drag into whiteboards (PDF, journal, highlights): https://wiki.heptabase.com/user-interface-logic
- Eraser 2026 reviews (DaC, AI, MCP, GitHub sync): https://toolradar.com/tools/eraser-io · https://newsletter.systemdesigncodex.com/p/erasers-new-ai-driven-diagramming
