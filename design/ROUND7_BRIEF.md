# Round 7 brief: build the round-6 design (whiteboard studio, Board, architecture studio, export, canvas, drag and drop)

Handoff: **`design/handoffs/2026-11-20-round-7/`** (from `Lumen Index Design Rounds (2).zip`). New pages **33–52** (`Lumen NN ….dc.html`), built from the components `WBStudio.dc.html`, `ArchStudio.dc.html`, `R6Parts.dc.html`, `R6Block.dc.html`, `ExportDlg.dc.html`, `CanvasBoard.dc.html`, `WhiteboardBoard.dc.html` and `lumen-glyphs.js`. The brief the designer worked from: `docs/design/CLAUDE_DESIGN_UPDATE_06.md` (feature tags Native / Lumen / AI / Later).

## Reference material (read these, in this order)
1. **Frame PNGs:** `design/handoffs/2026-11-20-round-7/frames/<ID>.png` (e.g. `40D.png`), one per artboard (141 frames), at 1440×900 desktop or 412×915 phone. `frames/index.json` lists every frame with its label and the designer's note. **Match these pixel-for-pixel in layout, spacing, sizes, colours, type, icons, copy and states.**
2. **Exact values** (px, colours, fonts, radii, shadows, copy): open the component source (`WBStudio.dc.html` etc.) and read the markup and logic for the state the frame uses. The page file (`Lumen NN ….dc.html`) shows which props each frame passes (e.g. `{ overlay:'convert', kind:'board' }`).
3. **Live render** of any page: http://localhost:5397/ + URL-encoded file name (server already running; don't start another).
4. Behaviour and data: `docs/design/CLAUDE_DESIGN_UPDATE_06.md`, `docs/ARCHITECTURE_DIAGRAMS.md` (architecture studio), `docs/WHITEBOARD_CANVAS_PLAN.md` (engine facts, file plan).

## The owner's bar (applies to every package in every wave)
**Identical to Claude Design in everything:** UI, UX, layout, sizes, colours, type, icons, copy, animations, every click and flow, plus the logic and backend behind them, working with real data. Accurate, complete and fast. When the design shows it, the app does it.

## Port the design code, don't redraw it
- Translate the component's markup from the `.dc.html` source (WBStudio, ArchStudio, R6Parts, ExportDlg, CanvasBoard…) **1:1 into JSX**: same element structure, same inline values (px, colours via the token map, radii, fonts, gaps), same copy, same SVG. Templates map directly: `<sc-for>` → `.map()`, `<sc-if>` → `&&`, `{{ x }}` → `{x}`, `<dc-import name="LumenGlyph">` → `<Glyph>`. Then wire it to real state and data. Use the screenshots only to check the result.
- **Nothing static.** Port the animations and transitions too (keyframes, durations, easing from the source), and make every click, hover, menu, popover, sheet, drag and state change in the design really work with real data and real logic, end to end. Each flow the frames show (open → choose → apply → undo, error → retry, phone gestures) must be clickable in the app, not a picture.
- Helper scripts: Node.js (no Python).

## Rules (all packages)
- **Identical to the design**, Lamplight + Paper where drawn, phone where drawn, Arabic RTL where drawn. Design tokens map to the app's CSS variables (`--bg --sf --sf2 --bd --tx --mu --ac …` in the design = `var(--bg) var(--surface) var(--surface-2) var(--border) var(--text) var(--muted) var(--accent) …` in the app; check `src/index.css`).
- **Everything shown must really work**, including logic and backend. Items tagged [Later] in the brief: build them if the package's scope allows; otherwise render the designed UI and say exactly what's missing in your report (never fake success).
- **Icons:** `<Glyph name=… />` from `src/components/Glyph.tsx`; `src/lib/glyphs.ts` already holds the round-7 set (473 names, incl. pens, shapes, arrowheads, architecture nodes, stamps). **No emoji anywhere.** If a frame shows an icon that has no glyph, add it to `glyphs.ts` in the same style and say so.
- **Strings:** `t()` / `tk()` from `src/lib/i18n.ts` for every new string; add Arabic entries under `src/i18n/ar/` (new file per area is fine, imported in `src/i18n/ar.ts`).
- **Data:** all synced writes via `save()` / `patch()` in `src/lib/db.ts` (or `updateNote`). Open formats stay open: `.excalidraw`, JSON Canvas 1.0, `.mermaid`; Lumen-only data only under `lumen*` keys / `customData.lumen*`. Never delete synced records (tombstones). User prefs that sync (pen presets, custom palettes) go in settings the way existing synced settings do.
- **Performance:** no main-thread freezes (images already shrink off-thread: `src/lib/wb-files.ts`); heavy libs (elkjs, pdf) are lazy chunks.
- **File ownership:** only edit the files your package owns (table below) plus new files you create. Shared files: re-read right before editing, keep the change to a small hook, and mention it in the report. Other agents work at the same time.
- **Don't** commit, deploy, start a second dev server, or run more than one Edge at a time; close the browser when done.
- **Speed (owner's rule):** go fast, minimal testing: at most one quick screenshot check per main frame, no long test loops. Deploy happens after each wave.
- **Check:** `npx tsc -b` and `npx vite build` must pass at the end. Browser check against the frames: app at http://localhost:5330/?demo=1 → click "Continue offline" → "Skip" through onboarding; demo whiteboard "Study plan — November", canvas "Backprop study board" (open with Ctrl+K + title, clicking the app shell first). puppeteer-core + Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) are installed in `C:\Users\worki\AppData\Local\Temp\claude\a36550ff316812e0\7d09b627-7163-423d-8ee0-6ea8dedb02b4\scratchpad` (scripts go there). Save your app screenshots next to the frame they match: `design/verify/r7/<package>/<frameID>-app.png`.
- **Report** (under 350 words): frames done (IDs), frames partly done and what's missing, files changed, new files, shared-file hooks, anything the next wave needs.

## Packages and waves
| Pkg | Frames | Owns | Model |
|---|---|---|---|
| **W1-A Whiteboard shell** | 33A–K, 44A, 44G, 44H, 44K, 44L, 45A–B (toolbar, property bar, header menu, tool wheel, empty/view-only/offline/perf states, phone dock) | `src/components/Whiteboard.tsx`, `WhiteboardView.tsx`, `wb-media.tsx`, new `src/components/wb/*` | Opus |
| **W1-B Export dialog** | 42A–I, 43C | `src/components/DiagramExport.tsx`, `src/lib/visual-export.ts`, new `src/lib/export-*.ts` | Sonnet |
| **W1-C Canvas options** | 43A, 43B, 43D | `src/components/CanvasEditor.tsx`, `src/lib/canvas.ts`, `src/lib/canvas-history.ts`, `src/components/CanvasKeys.tsx` | Sonnet |
| **W1-D Architecture studio core** | 46A–Q, 47A–D, 48A–B, 48G–I (types chooser, split view, two-way code sync, Mermaid/JSON tabs, errors, autocomplete, paste-in, properties, nodes kit, layout, reused objects, C4, version diff, phone) | new `src/components/arch/*`, new `src/lib/arch-*.ts`; hook in `src/components/NoteView.tsx` (render the studio for canvas notes with `lumenArch`) | Opus |
| **W1-E Chooser, templates, Board type** | 40A–C, 51A–B | `src/components/NewVisualChooser.tsx`, new `src/components/TemplatesGallery.tsx`, new `src/lib/templates-visual.ts`; `shared/types.ts` (add note type `board`) + routing hook so a `board` note opens in `Whiteboard` with `kind="board"` | Sonnet |
| **W1-F AI convert backend + review sheet** | 35A–H, 44J, 48C–E, 48J | new `src/components/AIReview.tsx`, new `src/lib/ai-convert.ts`, worker AI routes (new `worker/ext/ai-visual.ts`, registered in `worker/index.ts`) | Sonnet |
| W2-A Pens, palettes, lasso | 34A–H, 37A–F, 44B, 44C, 44I | whiteboard (after W1-A) | Opus |
| W2-B Shared library, stamps, icon insert | 36A–G, 49A–F, 44D, 45C–D | new `src/components/library/*` | Sonnet |
| W2-C Drag and drop | 50A–C | new `src/lib/dnd.ts` + drop sources | Sonnet |
| W2-D Architecture edge editing | 46C/N + 47A–B (edges) | `src/components/arch/*`, `src/lib/arch-route.ts`: reconnect ends, bend points (add/move/remove, orthogonal keeps right angles), drag label, reset route; **edge label options**: inline edit, start / middle / end labels, style plain·pill·boxed, size, colours, bold, above/on/below the line, follow-the-line rotation, show/hide, protocol·port chip (`lumenEdge.labels` + `labelStyle`); one undo step each; points in `lumenEdge.points` (JSON only) | Sonnet |
| W3-A Layers, board settings, frames, presentation | 38A–E, 39A–G, 41A–F, 44E, 44F | whiteboard + presenter | Opus |
| W3-B Mixed Board cards + conversions | 40D–H, 45E, 52A–C | whiteboard (board kind) + conversions | Sonnet |
| W3-C Architecture AI hook-up | 48C–F | arch + AI | Sonnet |
| Final review | all | read-only | Opus (fresh) |
