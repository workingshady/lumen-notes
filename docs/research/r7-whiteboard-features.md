# R7 Stage 2: whiteboard, ink, library, DnD and list research

Written 2026-11-20. Read-only pass: no source code was changed. Code references are to the working tree at `D:\90_Graveyard\lumen-notes`.
Method: read the current implementation first, then web search and page fetches. Where a search returned nothing solid the text says "not verified" instead of guessing. Competitor facts are weakest for Notability, Concepts, Heptabase and AFFiNE (no first-party pages found); treat those lines as indicative.

Effort key: S = under a day, M = 1 to 3 days, L = a week or more.

## 0. Ground facts that shape every recommendation

- The board is **Excalidraw 0.18.1** (`node_modules/@excalidraw/excalidraw/package.json`). Ink is an Excalidraw `freedraw` element.
- Verified in `dist/dev/chunk-4FTI6OG3.js` (`getFreeDrawSvgPath`): Excalidraw renders every freedraw with **fixed** perfect-freehand options: `size = strokeWidth*4.25, thinning .6, smoothing .5, streamline .5, easing sine, last = !!lastCommittedPoint`. There is no `start`/`end` option, so **caps are always round** and there is no taper. The result is cached as a `Path2D` per element (`pathsCache`).
- So a pen's look in Lumen can only come from the point list, `pressures[]`, `strokeWidth`, colour and opacity. `pens/model.ts` `penPressures()` already exploits exactly this (speed, direction, arc taper, noise).
- `pens/LiveInk.ts` imports `perfect-freehand` directly, but it is **not in Lumen's `package.json`**. It resolves only because Excalidraw depends on `perfect-freehand@1.2.0` and npm hoists it. Add it as a direct, pinned dependency (S); a dedupe or upgrade could otherwise silently break the live overlay.
- Existing perf mode: `PERF_LIMIT = 3000` in `Whiteboard.tsx` switches the dark-theme filter from the SVG `feComponentTransfer` to a GPU CSS filter and drops chrome shadows. That is the only large-board lever today.
- Lumen already ships much of what competitors have: 8 pens, ruler, partial and lasso eraser, scratch-out, hold-to-straighten, auto-shape with undo chip, layers, frames as slides, phone remote, pages mode, 8 board patterns, vendor icon packs with SHA-256 integrity, typed DnD with keyboard pick-up. The gaps below are polish, correctness and a few missing pieces.

---

## 1. Pens and ink

### What Lumen does now
- `pens/model.ts`: 8 pen types (ballpoint, fountain, brush, marker, highlighter, pencil, calligraphy, laser) mapped to freedraw props; smoothing off/low/high done as a **moving average** of window 0/1/4 (`smooth()`); pressure curve soft/linear/firm; per-device prefs in `localStorage["lumen.wbPens"]`; up to 8 saved pens synced via Inbox space props.
- Pressure: real stylus pressure is used if seen (`hadPressure`: spread above 0.02). Otherwise a speed, direction or arc-length profile gives each pen a distinct look with a mouse.
- `pens/LiveInk.ts`: two overlay canvases (top for ink, under for highlighter) draw the stroke in progress with the same `finishStroke` and perfect-freehand maths, so nothing changes on pointer-up. `inkFlip()` mirrors the dark-theme SVG filter table.
- Hold-to-straighten (`Whiteboard.tsx` `inkUp`/`processStroke`): hold 450 ms without moving more than 3 px, the stroke becomes a straight line (Shift snaps to 15 degrees). Auto-shape (`pens/shapes.ts`): hold or "always" recognises line, arrow, ellipse, rotated rectangle, triangle using RDP corners plus an ellipse fit, with a 3 s "Undo snap" chip.
- Scratch-out: `isScratch` needs at least 4 reversals and path length at least 3.2 times the span; deletes elements with at least 50 percent overlap.
- Palm rejection: Excalidraw `penMode`/`penDetected` through `updateScene`. In pen mode a touch pointer returns false from `inkDown`, so Excalidraw pans. The ruler handles two-finger rotate.
- Handwriting search (`pens/Handwriting.tsx`): clusters strokes with a 40 px pad, exports each cluster as PNG, sends it to the vision route, stores text in `customData.lumenText`.
- Not found anywhere in `src`: `getCoalescedEvents`, `getPredictedEvents`, `desynchronized`.

### Best practice and competitor behaviour
- **perfect-freehand README** (fetched 2026-11-20): `size 8, thinning .5, smoothing .5, streamline .5, simulatePressure true`; `start`/`end` take `{cap, taper, easing}`; `cap` is ignored when `taper > 0`; `last:true` draws to the final point. https://raw.githubusercontent.com/steveruizok/perfect-freehand/main/README.md . A flat-ended stroke is `start:{cap:false}, end:{cap:false}`, which Excalidraw cannot pass.
- **tldraw**: pen strokes are stored with pressure (3D) and mouse strokes without (2D); `isPen` marks stylus strokes; Shift gives angle snap; `highlight` is a separate shape that draws two passes (underlay opacity 0.82, overlay 0.35) and splits long strokes at `maxPointsPerShape = 600`. https://tldraw.dev/sdk-features/default-shapes . Lesson: a highlighter is its own render path, and long strokes should be split.
- **tldraw touch** (post dated 2026-07-13): once an Apple Pencil touches, iPadOS stops delivering finger events to the page, so palm rejection on iPad Safari is largely done by the OS. https://tldraw.dev/blog/a-touchy-subject
- **Excalidraw upstream** is moving the same way as Lumen: commit #11551 "tweak freedraw settings and tablet UI/UX" lowers streamline for non-mouse input and switches to variable width the first time pen mode is toggled; a `currentItemStrokeVariability` setting exists upstream. https://gitea.maison43.duckdns.org/gilles/excalidraw/src/commit/2a82821ec5970691199e1ffc6a49ac31f311ab59 (git mirror, no date shown). **Not verified**: whether it is in a release newer than 0.18.1.
- Upstream Excalidraw issue (about 2 years old when found, via a mirror): in pen mode, fast handwriting strokes were skipped when a stroke began soon after the previous one. Worth a regression test on Lumen's pen path.
- **Apple iPadOS/Freeform**: hold the Pencil still at the end of a stroke to smooth or straighten; Freeform has a Snap to Shape option. https://support.apple.com/ta-in/guide/ipad/ipadf825a0bd/17.0/ipados/17.0
- **Goodnotes** (2020-09-25): draw and hold snaps to clean shapes, also with the highlighter; distinguishes circle from oval; supports curves; a multi-stroke shape (triangle in three strokes) becomes one shape; lines can snap to other strokes' endpoints; snapped shapes get control points to edit. https://www.goodnotes.com/blog/shape-recognition
- **Miro** (2020-11-03): palm rejection, 3 drawing presets, highlighter, lasso for hand-drawn objects. Android palm rejection took weeks of fixes (canvas jumped when a palm touched before the pen). https://community.miro.com/product-news-31/pen-tool-updates-palm-rejection-highlighter-lasso-tool-and-drawing-presets-2536
- **FigJam** (May to July 2025 forum threads): marker "automatic stroke adjustment" made strokes visibly reshape while drawing and variable width stopped working with a tablet. Lesson: never reshape under the pen. Lumen's "same maths live and committed" design avoids this. https://forum.figma.com/report-a-problem-6/updates-to-marker-tool-in-figjam-may-2025-41198
- **Web input APIs**: `getCoalescedEvents()` returns the intermediate samples the browser merged into one `pointermove` (Chrome 58+, MDN marks limited availability; a 2023 Apple developer thread said Safari lacked it). `desynchronized: true` on a canvas context is Chrome's low-latency hint, feature-detected with `getContextAttributes()`. https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents ; https://developer.chrome.com/blog/aligning-input-events ; https://developer.apple.com/forums/thread/689375 . `getPredictedEvents` was not covered by the sources found (not verified).
- **$-family recognisers** ($1, $P, $P+, $Q) are template matchers; $Q is up to 142 times faster than $P (MobileHCI 2018); $P reports about 98 percent accuracy on gesture sets. No source gave per-shape (circle, rectangle) accuracy. https://depts.washington.edu/acelab/proj/dollar/qdollar.html . Lumen's geometric RDP plus ellipse fit suits 5 shapes; templates pay off only if more shapes (star, heart, cloud, pentagon, bubble) are wanted.
- Grain: `destination-out` / `destination-in` compositing with a pattern is standard canvas, but no source with a ready pencil recipe was found, so the grain recipe below is design, not citation.

### Flat-ended marker and grainy pencil: custom renderer needed?
**Yes for a true flat nib or real grain. Only an Excalidraw patch or a Lumen-owned render path can do it; the current fake is about as good as freedraw allows.**
- Marker today: pressure fixed at 1, so a constant-width ribbon with round caps. It reads as a round marker, not a chisel marker. Goodnotes users are still asking for flat and angled highlighter tips, so it is a visible differentiator: https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/46386358-flat-marker-pen-streamline-option
- Pencil today: `grain(i)` noise on pressure makes the *edge* wobble. The fill is solid, so it is not grainy.
- Options, cheapest first:
  1. **Blunt ends by geometry (S)**: for marker and highlighter, give the first and last 1 to 2 points a pressure ramp so round caps look squarer. Never truly flat, but fine for highlighter where overlap hides it.
  2. **Patch Excalidraw's freedraw renderer (M to L)**: `getFreeDrawSvgPath` is about 10 lines. With `patch-package`, read `element.customData?.lumenPen` and pass `start:{cap:false}, end:{cap:false}` (optionally `taper`) to `getStroke`. One patch covers the static canvas, SVG export and PNG export, so the committed look equals the live overlay (which already calls perfect-freehand directly). Cost: re-test on every Excalidraw upgrade; the canvas and SVG export paths in both dev and prod bundles must be patched. Check upstream first (#11551 shows pen work in flight).
  3. **Grain (M)**: with the patch, fill the pencil Path2D with a pre-rendered tileable noise `CanvasPattern` (128 px alpha-noise tile at fixed screen scale), offset per stroke from `element.seed` so exports match. Without the patch, grain exists only on the live overlay and vanishes at commit, which is worse than none.
  4. **Rasterise strokes to image elements**: not recommended (kills editing, bloats files).
- Recommendation: option 1 now; options 2 plus 3 as one stage; pin the Excalidraw version until then.

### Gaps and enhancements (ranked by user value)

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Palm rejection hardening.** Today it is a manual toggle. Add: first `pointerType==="pen"` turns pen mode on with a one-time chip (upstream `penDetected` does this); ignore touches that begin while a pen hovers or within about 300 ms after pen-up; reject touch contacts with large `width/height` where reported (Chrome only; iOS does not expose radius); add a "Finger draws" option for users without a stylus. | M | `Whiteboard.tsx` (`inkDown`, `togglePenMode`), `pens/live.ts`, `pens/PenPanel.tsx` |
| 2 | **Coalesced and predicted samples.** Append `getCoalescedEvents()` samples (feature-tested) in the pointer path feeding the live overlay so fast strokes keep their shape; draw 1 to 2 predicted points on the overlay only, never committed; add `desynchronized: true` (feature-detected) to the two LiveInk canvases; add a regression test for the "stroke skipped soon after previous" upstream issue. | M | `pens/LiveInk.ts`, `Whiteboard.tsx` (`inkMove`) |
| 3 | **Real stabiliser instead of moving average.** `smooth()` averages neighbours (shortens corners, shrinks loops) and runs after pointer-up, so live and final can differ. Use a one-pole stabiliser applied as samples arrive (k about 0.35 low, 0.18 high, speed-gated to keep corners) so live equals final. | M | `pens/model.ts` (`smooth`, `finishStroke`), `pens/LiveInk.ts` |
| 4 | **Flat marker and grainy pencil** as above. | S then L | `pens/model.ts` (`penPressures`), new `patches/@excalidraw+excalidraw+0.18.1.patch`, `LiveInk.ts` |
| 5 | **Auto-shape upgrades**: multi-stroke merge (a rectangle in 2 to 4 strokes within 1.5 s), arrow ends auto-bind to the shape they land on, more shapes (diamond, pentagon, star, heart, cloud) via $Q-style templates, show the recognised name live while holding. | M | `pens/shapes.ts`, `pens/engine.ts` (`snapStroke`), `Whiteboard.tsx` (`processStroke`) |
| 6 | **Hold timing is fixed** at 450 ms and 3 px client movement, so a trembling hand or hi-DPI tablet misses it. Scale tolerance by DPR, add a setting (300, 450, 700 ms), and show a ring that fills during the hold so users know it is armed. | S | `Whiteboard.tsx` (`inkUp`, `penDown`), `pens/InkBars.tsx` |
| 7 | **Scratch-out false positives**: zig-zag shading or hatching deletes what it covers. Require the scribble to start over existing ink, cap deletion to about 25 elements without confirm, and make sure the toast carries Undo (the toast "Scratched out {n} items" exists; confirm Undo). | S | `pens/engine.ts` (`scratchOut`, `isScratch`), `Whiteboard.tsx` |
| 8 | **Highlighter as two-pass render and long-stroke splitting** (tldraw model). `sendBehindInk()` does an O(n) scan of all elements per stroke. | M | `pens/engine.ts` (`sendBehindInk`), `pens/model.ts` |
| 9 | **Add `perfect-freehand` to `package.json`** pinned to `1.2.0`. | S | `package.json` |
| 10 | **Quick pen switch**: stylus barrel button or Apple Pencil double-tap opens a radial of saved pens (Miro: 3 presets; Lumen: 8 saved pens in a panel; a long-press wheel `openWheel` at 550 ms already exists for touch). | M | `Whiteboard.tsx` (`openWheel`), `pens/PenPanel.tsx` |

### Edge cases and failure modes
- Mouse reports `pressure` 0.5 or 0 depending on browser and automation. `hadPressure` guards with a spread check; add a test for styluses that report a constant pressure.
- A stroke ended by `pointercancel` (palm cancel, iOS gesture) must clear `penDown` and `pendingStroke`; verify that path.
- Excalidraw sets `last:true` only on pointer-up; the live overlay must stay until the committed element paints (handled with a one-frame delayed `clear`).
- Dark theme: the ink table exists in **3 copies** (`Whiteboard.tsx` filter, `LiveInk.INK_TABLE`, `palette/palettes.ts` `TABLE`). If they diverge, live and committed colours differ. Extract one (S).
- Straighten on a closed loop with a held end collapses it to a line or dot. Skip straighten when start and end are within about 18 px.
- Hold detection uses `performance.now()` deltas from the last move over 3 px; a hovering stylus lifting and re-touching in place should not count as a hold.

### Performance (3,000+ elements)
- Freedraw cost scales with points: each stroke is one cached Path2D. A page of handwriting is roughly 150 to 400 strokes of 50 to 300 points (estimate), so 3,000 strokes is on the order of 300k to 900k points. Keep smoothing and partial-erase linear in the touched stroke only (they are).
- `lassoed()` and `touches()` in `pens/engine.ts` are **O(n) over all elements on every pointer move** while erasing. tldraw moved the same queries to an R-tree (RBush, O(log n)) in 4.4 for "brushing, scribble selection, and erasing with many shapes" (no speedup figure published): https://tldraw.dev/releases/v4.4.0 . Add a bounding-box pre-filter first (S), then an RBush index rebuilt on element version change for boards over about 1,500 elements (M).
- Handwriting `clusters()` does O(n^2) pairwise box tests; 3,000 strokes is about 4.5 M tests. Use a grid hash (S).
- Reference numbers: tldraw culling can render about 50 of 10,000 shapes; debounced zoom above 500 shapes; `maxShapesPerPage` 4000; text outlines off below zoom 0.35 (https://tldraw.dev/sdk-features/performance). Confluence Whiteboards target 5K elements at 60 fps with 2048 px culling tiles (https://www.atlassian.com/engineering/rendering-like-butter-a-confluence-whiteboards-story).
- The biggest dark-board cost is the SVG ink filter on the static layer, already swapped for a CSS filter above 3,000 elements. Consider a lower threshold on phones, or switch dynamically on measured frame time (target p95 under 16 ms).

---

## 2. Palettes and colour

### What Lumen does now
- `palette/palettes.ts`: shipped palettes (Lumen ink, Paper stickies, Highlighters, Okabe-Ito colour-blind safe, Greys, Vivid), "This board" (colours in use), custom palettes synced via Inbox space, recents, OKLab shades, WCAG contrast with a 4.5:1 `suggestShade`, and "keep exact colour in dark theme" (`exactColour`).
- Dark theme is an **SVG `feComponentTransfer` table filter** on the static layer (`INK_TABLE`: near-black channels 0.09 to 0.17 are lifted to light) and `invert(93%) hue-rotate(180deg)` on other canvases. Stored colours stay as authored.
- `contrastPair()` in `pens/register.tsx` shows an AA warning for text on a fill.

### Best practice and competitor behaviour
- **Goodnotes** has a long-running "true dark mode / automatic ink inversion" request; users cite Notability as the model, where the page goes black and ink colours are adjusted for visibility rather than inverted, and notes are re-adjusted for printing. https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/46042741-true-dark-mode . First-party Notability documentation was not found; treat as secondhand.
- Excalidraw's own dark mode uses an invert plus hue-rotate filter, so Lumen's table filter is a refinement, not a departure.
- Okabe-Ito is the standard colour-blind-safe set (Lumen includes it). WCAG 2.2 (Level AA): 4.5:1 for text, 3:1 for meaningful non-text graphics (1.4.11).

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Perceptual dark flip (OKLab lightness mapping)** instead of a per-channel table. Per-channel tables can shift hue (a mid red drifting to orange). Reflect OKLab L (clamped about 0.18 to 0.92) and keep a, b; keep a lookup only for the SVG fast path and use the exact function for swatches, live ink and exports. `toLab`/`fromLab` already exist. | M | `palette/palettes.ts`, `pens/LiveInk.ts`, `Whiteboard.tsx` |
| 2 | **One source of truth for the table** (3 copies). | S | same three |
| 3 | **Ink vs board contrast check**: warn when stroke vs board colour is under 3:1 in the current theme and offer the nearest passing shade (`boardDark()`, `suggestShade()` exist). | S | `settings/model.ts`, `pens/register.tsx` |
| 4 | **Non-colour cues** for status colours (icon or pattern), keep `colourName` as `aria-label`. | S | `palette/ColourPopover.tsx` |
| 5 | **Explicit export choice** "as seen" (dark) vs "light". Confirm `exportBg.ts` applies the table to PNG and SVG on dark boards. | S | `settings/exportBg.ts` |
| 6 | **Palette import and export** (JSON, ASE) and "extract from image". | M | `palette/PaletteManager.tsx` |

### Edge cases
- `exactColour` handles channels only in about 0.085 to 0.175; a colour straddling the range (navy like `#1a2b3c`) maps per channel, so hue can shift. Test greys and navy.
- 8-digit hex highlighter swatches (`#ffd43b73`) must keep alpha through `parseHex`; a picker that drops alpha makes a highlighter opaque.
- Custom background: `lum()` uses Rec.601 with threshold 0.45; use WCAG relative luminance for consistency with `contrast()`.

### Performance
- The SVG filter cost scales with painted pixels, not elements; large retina canvases are worst. Keep the CSS-filter switch at the perf threshold and consider a user toggle "Faster dark mode".

---

## 3. Layers, frames, arrange, backgrounds, pages, presentation, phone remote

### What Lumen does now
- **Layers** (`layers/model.ts`): `customData.lumenLayer` per element plus z-order bands (Excalidraw has no layers). Hidden layers are moved out of the scene into a side store (still saved in the file); lock sets `locked:true` only on elements the layer locked; layer opacity multiplies element opacity (`lumenOpBase` keeps the original). Defaults Background, Sketch, Notes; saved as scene `lumenLayers`.
- **Frames** (`present/frames.ts`): order `lumenOrder`, hide-from-show `lumenHidden`, notes `lumenNotes`; thumbnails via `exportToBlob`, cached by frame content versions.
- **Settings** (`settings/model.ts`): 7 backgrounds, 8 patterns (none, dots, grid, ruled, iso, cornell, graph, music staff), density 12 to 48 px, modes infinite / a4 / letter / 16:9, snapping, minimap, zen, view only. Page sizes at 96 dpi, `PAGE_GAP` 48.
- **Presenter** (`present/Presenter.tsx`): fullscreen, 650 ms camera fly, laser and pen, notes, counter, phone remote through the SlidesRemote Durable Object (`DeckCmd`: next, prev, goto, blank, timer, timer-reset).

### Best practice and competitor behaviour
- **AFFiNE**: frames are slides placed anywhere; a Navigator panel lists them; Present runs them full screen; frames can be generated from a selection (blog posts plus a third-party docs mirror, so unverified). https://affine.pro/blog/affine-080-launch-week-day4
- **Heptabase** (2026 changelog): sections keep titles readable at low zoom and show in an outline; smart guides and a dotted snap grid shipped; shape elements still on the roadmap; no freehand ink found. https://wiki.heptabase.com/changelog ; https://wiki.heptabase.com/section
- **Apple Freeform** is an open canvas, not a slide tool (slides are Keynote); one 2026 forum thread reports freezes on large boards (single anecdote). https://discussions.apple.com/thread/256252166
- **Miro / FigJam presentation, phone remote, pages**: not found in this pass (open gap).
- **tldraw**: use a debounced zoom value for render-time sizing. https://tldraw.dev/sdk-features/performance

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Layer toggles should be O(changed).** Hide, lock and opacity rewrite every element of the layer through `restoreElements`; on 3,000 elements that is a full scene update per toggle. Batch in one `updateScene`, use `captureUpdate:"NEVER"` while an opacity slider drags and commit on release. | M | `layers/model.ts`, `layers/LayersPanel.tsx` |
| 2 | **Pages mode as a real feature**: visible page frames, strokes warned or clipped at page edges on export, Add / Delete / Reorder page, multi-page PDF export (frame export machinery exists). Today it is sizes plus a gap. | L | `settings/model.ts`, `Whiteboard.tsx`, `present/frames.ts`, export dialog |
| 3 | **Presentation polish**: presenter view on a second display (notes, next slide, timer) via `window.open` plus BroadcastChannel; phone as a laser pointer over the existing Durable Object; per-frame transition (none, fade, fly); start from current frame. | M | `present/Presenter.tsx`, `study-remote-link.ts`, worker SlidesRemote |
| 4 | **Remote security and failure modes**: pairing code expiry, disconnect state with keyboard fallback, command rate limit; verify the room cannot be joined by guessing `prettyCode`. | S | `study-remote-link.ts`, worker room |
| 5 | **Frame list UX**: auto-number, "Present selection only", confirm hidden frames are skipped in the counter. | S | `present/BoardPresenter.tsx`, `layers/FramesPanel.tsx` |
| 6 | **Pattern at low zoom**: CSS gradients scale by `z`; below about 0.4 zoom a 22 px grid is under 9 px and moires. Fade the pattern between zoom 0.5 and 0.25. | S | `settings/Backdrop.tsx`, `settings/model.ts` (`patternCss`) |
| 7 | **Backgrounds**: image or PDF as a locked bottom page background, gradient presets, export with or without pattern. | M | `settings/*`, `layers/model.ts` |
| 8 | **Arrange**: numeric distribute spacing, match size, align to frame, smart guides with spacing indicators (Heptabase shipped smart guides in 2026). `Arrange.tsx` is 76 lines. | M | `layers/Arrange.tsx` |
| 9 | **Layer-aware lasso and eraser**: skip hidden or locked layers (`touches()` already skips locked), optional "active layer only" lasso. | S | `pens/engine.ts`, `layers/model.ts` |

### Edge cases and failure modes
- Hidden layers live outside the scene: **search, export, lasso, minimap and handwriting recognition must use `hiddenElements()` deliberately**. Test: hide a layer, export; the file keeps it, the PNG excludes it.
- A layer deleted on another device leaves elements with an unknown `lumenLayer`; `layerOf` sends them to the bottom layer. Make that deterministic across devices so two devices do not fight over writes.
- An element the user locked first must stay locked after the layer unlocks (code claims this; add a test).
- `frameThumb` cache key is element `id:version`; include bound-text changes (`frameContents` already adds bound text).
- Fullscreen can be denied (iframes, iOS Safari); code swallows the rejection, add an "F11" hint.

### Performance
- `frameThumb` runs `exportToBlob` per frame: 30 frames on a 3,000-element board is 30 full exports on first open. Render lazily (IntersectionObserver), in idle time, and cancel on panel close.
- The camera fly uses CSS transform with `will-change` (good). On boards over 3,000 elements, rasterise once to an `ImageBitmap` for the fly (optional, M).

---

## 4. Lasso, handwriting recognition and AI convert

### What Lumen does now
- Lasso: `pens/engine.ts` `lassoed()`: freedraw by 70 percent of points inside the polygon, boxes by centre plus 3 of 4 corners; whole groups come along; `LassoBar.tsx` for actions.
- `AIReview.tsx`: review sheet with Text, LaTeX, Mermaid tabs over `convertImage()`; nothing is touched before Replace or Add; low-confidence spans via `{{best|alt|alt}}`; typed errors (offline, timeout 60 s, limit, unreadable, too-large) in `lib/ai-convert.ts`; image shrunk to 1600 px off the main thread.
- Worker `worker/ext/ai-visual.ts`: `@cf/meta/llama-3.2-11b-vision-instruct` first, then `@cf/meta/llama-4-scout-17b-16e-instruct`; text model Llama 3.3 70B; base64 cap 3.5 M chars (about 2.6 MB), 50 s timeout, a one-time licence "agree" retry for Llama 3.2.
- Handwriting search: text stored in `customData.lumenText` of each cluster's first stroke; max 12 clusters per run; re-runs 5 s after edits.

### Best practice and competitor behaviour
- **Goodnotes 6**: lasso then convert to text with "Included in Selection" settings, an Edit Handwriting menu (reflow, edit words, straighten lines), handwriting spellcheck in 4 languages, handwritten equations to text with math check. https://www.macrumors.com/2023/08/09/goodnotes-6-ai-powered-handwriting-spellcheck/ (2023-08-09); https://www.goodnotes.com/blog/handwriting-to-text-ipad
- **Workers AI catalogue (2026)**: Llama 4 Scout (vision), Kimi K2.5 and K2.6 (vision), **Moondream 3.1** (image-to-text, released 2026-07-08, 9B MoE, 2B active). Cloudflare's changelog calls Llama 3.2 vision older and points to newer models. https://developers.cloudflare.com/changelog/post/2026-07-08-moondream31-workers-ai/ ; https://developers.cloudflare.com/workers-ai/models/ . **Not verified**: handwriting accuracy of any of these on Workers AI.
- **Handwriting benchmarks (2025 to 2026)**: multimodal LLMs report character error rate under 5 percent on modern handwriting but are inconsistent on historical hands; on forms the best models struggled to exceed 95 percent field accuracy; a vendor-run cursive test claimed 100 percent for Gemini 3 Pro (marketing, treat with caution). https://arxiv.org/abs/2503.15195 ; https://sia.hackernoon.com/handwriting-vs-ai-real-performance-of-ai-on-handwritten-documents ; https://aimultiple.com/it/handwriting-recognition
- Design note (not cited): unlike scans, Lumen has **stroke order, timing and coordinates**. Vector-ink recognisers (Apple Scribble, Google ML Kit Digital Ink, MyScript) generally beat image OCR on cursive and maths, but none was found that runs offline in a browser for free. The image route is the pragmatic default; use stroke metadata to improve segmentation and reading order.

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Re-evaluate the vision model** with a small harness (20 to 30 labelled ink PNGs: print, cursive, maths, each supported script) comparing Llama 3.2 11B, Llama 4 Scout, Kimi K2.x, Moondream 3.1 on character error rate and neurons per call. Make the model order a setting; keep the fallback chain. | M | `worker/ext/ai-visual.ts` (VISION, SCOUT), new `scripts/` eval |
| 2 | **Render quality before the call**: black ink on white at 2x, 24 px padding; verify the dark-theme ink flip is not baked into the PNG (white ink on a white export fails); order strokes top-to-bottom, left-to-right before clustering. | S | `pens/Handwriting.tsx`, `lib/ai-convert.ts` |
| 3 | **Lasso then Convert in place**: selection action replaces ink with a text element, keeps the original ink on a hidden layer so Undo and "show ink" work. Skip the sheet unless low-confidence spans exist. | M | `pens/LassoBar.tsx`, `AIReview.tsx`, `Whiteboard.tsx` |
| 4 | **Cluster by line then word** (vertical projection, then horizontal gap) instead of 40 px box overlap, which joins close lines and splits wide-spaced words; cap clusters near 1,200 x 400 px. | M | `pens/Handwriting.tsx` (`clusters`) |
| 5 | **Consent, cap and visibility**: first-run consent (ink goes to a cloud model on a timer), per-board "do not recognise", surface the daily limit in the UI. | S | `pens/Handwriting.tsx`, `lib/ai-usage.ts` |
| 6 | **Stale recognised text**: moving, editing or erasing strokes makes `lumenText` wrong, and erasing the cluster's first stroke loses the text. Invalidate by a hash of member ids and versions; store text on a per-cluster anchor instead of the first stroke. | M | `pens/Handwriting.tsx`, scene text indexer |
| 7 | **Mermaid validation**: parse the model output with the same parser as `fromMermaid` before showing it; on failure retry once with the parse error appended. | S | `worker/ext/ai-visual.ts`, `AIReview.tsx` |
| 8 | **Lasso modes**: add rectangle marquee, "touches" vs "encloses" toggle (the 70 percent rule can miss long strokes that start inside), selection count chip. | S | `pens/engine.ts`, `pens/LassoBar.tsx` |

### Edge cases and failure modes
- Ink that is only a drawing can return invented text; map 422 to "no text found" and never write empty or hallucinated text silently.
- RTL and mixed scripts: ask for direction and insert with `dir=auto`.
- A large selection can exceed the 3.5 M char cap (413); the client downscales to 1600 px, also tile very large selections with overlap.
- The Llama 3.2 licence "agree" retry is an account side-effect; log it and never loop.
- Offline: the typed `offline` error keeps ink safe; stop the 5 s timer when offline instead of failing repeatedly.

### Performance
- Each cluster is a separate `exportToBlob` plus up to a 50 s model call, serial, 12 per run. At 3,000 strokes, run on idle, viewport strokes first, recently edited first, with a visible queue and concurrency 1 to 2 to respect the daily meter.

---

## 5. Board cards and conversions

### What Lumen does now
- `wb/cards/CardView.tsx`: cards are Excalidraw `embeddable` elements (note card collapsed / card / expanded editor / missing; Mermaid card view and edit; link card with unfurl; PDF page card). Bodies are inert (`pointer-events:none`) until double-clicked; controls opt back in via CSS.
- `src/lib/convert/*`: conversion matrix (`MATRIX` in `model.ts`) of whiteboard, board, canvas, architecture, mermaid, graph, note with "kept / lost" text; conversions always make a copy.

### Best practice and competitor behaviour
- **Heptabase**: cards are first-class and live on many whiteboards; PDF highlights drag onto a whiteboard as cards; tags and properties now show on cards (2026 changelog). https://wiki.heptabase.com/changelog ; https://wiki.heptabase.com/fundamental-elements
- **tldraw**: off-screen shapes are hidden with `display:none` (not unmounted) unless `canCull` is false; selected and edited shapes are exempt. Embedded DOM shapes are the main perf risk. https://tldraw.dev/sdk-features/culling

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Lazy live cards**: render a static snapshot (title, 3-line excerpt) when the card is small on screen (zoom under about 0.5) or off-screen, and mount the live editor only when selected or double-clicked. Each live card runs React, markdown and possibly Mermaid; this is the main scale risk for boards with hundreds of cards. | M | `cards/CardView.tsx`, `Whiteboard.tsx` (embeddable renderer) |
| 2 | **Backlinks**: "also on N boards" on note cards; "Open in side panel". | M | `cards/CardView.tsx`, `lib/convert/cards.ts` |
| 3 | **Conversion dry-run**: show real counts ("14 shapes to nodes, 9 strokes left out") before creating the copy. | S | `cards/ConvertMenu.tsx`, `lib/convert/index.ts` |
| 4 | **Keep ink searchable** when ink becomes an image card: carry `lumenText` into the card's text. | S | `lib/convert/scene.ts`, `lib/convert/cards.ts` |
| 5 | **Round-trip ids**: stamp copies with `convertedFrom` (note id, version) so re-convert can update instead of duplicating, and cycles cannot nest forever. | M | `lib/convert/copy.ts`, `lib/convert/index.ts` |
| 6 | **Missing note**: offer Relink (search) and Remove, keep the title. | S | `cards/CardView.tsx` |

### Edge cases
- Embeddables are inert until double-click; on touch, double-tap conflicts with zoom. Make the Edit button the primary path and test with `pen` pointers.
- Passcode-locked notes: a card must show a locked state without leaking an excerpt (check `plainExcerpt` against the passcode feature).

### Performance
- tldraw keeps culled DOM hidden, not removed, so memory still grows. For Lumen unmount off-screen live cards with a one-screen margin and cap simultaneously live cards near 30 (estimate; measure).

---

## 6. Shared library, stamps, vendor icons

### What Lumen does now
- `library/*`: tabbed panel (drawing shapes, stamps, icons, stickies), search, recolour of glyph stamps and icons on swatch pick, numbered stamps cycling 1 to 9, a "see note" stamp with a link, style popovers via `restyle()` which writes to the selection and to `currentItem*` defaults.
- `lib/vendor-icons.ts`: AWS (aws-icons 3.3.0), Azure (owner imports the official ZIP), GCP, Logos, Simple Icons (Iconify JSON), Kubernetes (pinned commit); on demand from jsDelivr; SHA-256 verified (JSON hash, flat listing hash, per-file manifest); sanitised; cached in IndexedDB; shown unrecoloured; none in the bundle.

### Best practice and competitor behaviour
- **FigJam**: stamps and stickers from a wheel; library items trace back to their source library by right-click (2022 blog). https://www.figma.com/blog/whats-new-in-figma-february-2022/ . No 2026 stamp change found.
- AWS icon terms forbid altering or implying endorsement; CC0 sets (Logos, Simple Icons) still carry trademark rules. Lumen's "never recoloured or edited" matches the AWS terms.

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Re-verify at use**: re-hash cached IndexedDB packs on open (cheap for JSON, lazy per icon for AWS), drop corrupted entries, show "re-download". | S | `lib/vendor-icons.ts`, `library/VendorPacks.tsx` |
| 2 | **Custom stamps**: save a selection as a personal stamp (SVG or fragment), synced across devices. | M | `library/*`, `lib/library-items.ts` |
| 3 | **One shared `fileId` per inserted icon** so 200 AWS icons do not store 200 copies in the board JSON (the base64-in-JSON problem fixed for photos on 2026-11-20 via attachments). Verify icons use the file ref path. | M | `library/apply.ts`, `lib/wb-files.ts` |
| 4 | **Recents and favourites**; keyboard: `/` to search, arrows through the grid, Enter inserts at viewport centre. | S | `library/LibraryPanel.tsx` |
| 5 | **Pack update check** (version check against npm metadata, diff of icon counts); never auto-update because hashes are pinned. | S | `lib/vendor-icons.ts` |
| 6 | **Accessibility**: icon `alt`/`title` from the icon name; keep `<title>` in SVG export. | S | `library/apply.ts` |

### Edge cases
- Sanitiser must strip `<script>`, `on*` handlers, `<foreignObject>`, external `href`/`xlink:href`, CSS `@import` and `url(http...)`; also run it on cached data; keep a hostile-SVG test corpus.
- Offline first use: pack not available, show a clear state, not an empty grid.
- The Kubernetes pack is pinned to a commit because jsDelivr refuses that repo as too large; the manifest hash check fails safe.
- Azure ZIP import: cap size and entry count (zip bomb).

### Performance
- Icon grids with 1,000+ items need virtualisation (`content-visibility:auto` is a cheap first step) and lazy decode. Excalidraw caches one image per `fileId`, so shared ids keep decoded bitmaps down.

---

## 7. Drag and drop

### What Lumen does now
- `lib/dnd.ts` (453 lines) and `components/dnd/*`: one typed payload (`application/x-lumen+json`; kinds library-item, note, notes, graph-nodes, file, files, text, url, diagram, workspace), zones with `probe()` (allowed, reason, hint, nest, snap, guides) and `drop()`, edge auto-scroll, a "Send to..." sheet.
- Mouse: native HTML5 drag. Touch and pen: **450 ms long-press** (`dragProps`, 8 px tolerance), then pointer-driven drag. Keyboard: Space picks up, arrows move (Shift = big), Tab changes target, Enter drops, Escape cancels, `S` opens Send to.
- Accessibility: `aria-roledescription="draggable item"`, polite live region (`role=status`) with announcements ("picked up", "Over {target}", "Cancelled"), `alertdialog` for duplicate attachments.

### Best practice and competitor behaviour
- **WCAG 2.2 SC 2.5.7 Dragging Movements (AA)**: any drag needs a single-pointer alternative; keyboard support alone does not satisfy it; essential drags (drawing) are exempt; a typical fix is up and down buttons. https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements . Lumen's Space pick-up and `S` Send-to are strong for keyboards, but a pointer-only path to "Send to" is not obvious.
- **dnd-kit**: touch activation 250 ms with 5 px tolerance (newer API), 200 ms for pen and mouse; accessibility plugin with announcements. https://docs.dndkit.com/api-documentation/sensors/touch ; https://mintlify.com/clauderic/dnd-kit/guides/accessibility . Lumen's 450 ms is slower than the norm.
- **tldraw blog (2026-07-13)**: iPadOS withholds finger events while the Pencil touches, so do not design drags that need a second input. https://tldraw.dev/blog/a-touchy-subject

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Pointer alternative for every drag** (WCAG 2.5.7): "Move to..." in row and card context menus and the long-press menu, reusing `openSendTo`; "Move up / down" for reorder lists (frames, layers). | S | `lib/dnd.ts`, `components/dnd/send.ts`, list rows, `FramesPanel.tsx`, `LayersPanel.tsx` |
| 2 | **Long-press timing**: about 300 ms pen, 350 to 400 ms finger, setting in accessibility; short haptic where supported; touch scroll must win unless the item is held. | S | `lib/dnd.ts` (`dragProps`) |
| 3 | **Screen-reader parity**: announce what will happen ("Link Payments API to Auth board") and the result after drop; test with NVDA and VoiceOver (no evidence of an SR test pass in the repo). | M | `lib/dnd.ts` (`announce`), `components/dnd/DndHost.tsx` |
| 4 | **Visible copy vs move toggle on touch** (Alt modifier is otherwise unreachable without a keyboard). | S | `components/dnd/DndHost.tsx` |
| 5 | **Auto-scroll tuning**: speed by distance into the edge band, stop on leave, respect `prefers-reduced-motion`. | S | `lib/dnd.ts` (scroll loop) |
| 6 | **Drop safety**: validate payloads on the receiving zone (kind allowlist, ids exist in the vault, size caps); sanitise foreign HTML or text drops. | S | `lib/dnd.ts`, `dnd/*-drop.ts` |
| 7 | **OS file drags**: files are readable only on drop; show a hint on `dragenter` using `dataTransfer.types`. | S | `components/dnd/DndHost.tsx` |

### Edge cases and failure modes
- Escape during a touch drag must release pointer capture and scroll locks; verify `engine.end()`.
- Dragging onto a zone inside an iframe or embeddable card: `elementFromPoint` hits the iframe; use `ignore` or an overlay during the drag.
- `draggable=true` rows conflict with text selection and double-click rename; test both.
- Mobile Safari does not fire `dragstart` for touch; the pointer path is the only one (as designed).

### Performance
- `probe()` runs on every pointer move: keep it allocation-free and throttle `elementFromPoint` to one per frame. Whiteboard zones must not scan elements; use the spatial index from section 1 for snap and nest checks.

---

## 8. Sidebar modes and note list

### What Lumen does now
- `sidebarMode: "open" | "hover" | "click"` (`sidebar-r6.tsx`), customisable rows.
- `NoteList.tsx` / `note-list-desk.tsx`: paged list (`usePaged`), groups (date, status, none) with month headers above 300 notes plus a date scrubber, memoised rows (`DeskRow` compares id and `updatedAt`), pinned first. Selection: Ctrl/Cmd click toggles, Shift range from an anchor, Ctrl+A, Esc exits, right-click menu acts on the selection. List keys: arrows move focus, Enter opens, Delete/Backspace trashes with undo and focuses the next row. Phone: long-press to select. Bulk bar: tag, move (undo toast), delete.

### Best practice and competitor behaviour
- Desktop list conventions (Finder, Explorer, Gmail): Shift+Arrow extends the selection, Ctrl+Arrow moves focus without selecting, Space toggles the focused row, Home/End jump, type-ahead jumps by title. The WAI-ARIA multi-select listbox pattern uses `aria-multiselectable`, `aria-selected` and one tab stop. (Pattern knowledge, W3C APG; no 2026 source fetched.)
- WCAG 2.5.7 applies to drag-to-reorder (section 7).

### Gaps and enhancements

| # | Enhancement | Effort | Files |
|---|---|---|---|
| 1 | **Shift+Arrow range select, Ctrl+Arrow focus-only, Space toggle, Home/End, type-ahead.** `onListKey` handles only arrows (focus), Delete, Ctrl+A, Escape. Keep `anchor.current` in sync. | S | `NoteList.tsx` (`onListKey`, `onRow`) |
| 2 | **Select-all scope**: Ctrl+A selects only **loaded** rows (`order` from `shown`) when paging; offer "Select all N in this view". | S | `NoteList.tsx` (`order`, `usePaged`) |
| 3 | **Roving tabindex and ARIA**: rows are `role=button tabIndex=0` (every row is a tab stop). Use a listbox with one tab stop, `aria-multiselectable`, `aria-selected`, `aria-activedescendant`; announce "3 selected" in a live region. | M | `note-list-desk.tsx` (`DeskRow`), `NoteList.tsx` |
| 4 | **Bulk bar**: pin, favourite, duplicate, export, change status; undo for status change. | M | `note-list-desk.tsx` (`BulkBar`) |
| 5 | **Hover sidebar edge cases**: intent delay (about 150 ms in, 300 ms out), stay open during a menu or drag, close on Escape, open on keyboard focus, auto-open on drag hover so DnD zones are reachable. | S | `Sidebar.tsx`, `sidebar-r6.tsx`, `lib/dnd.ts` |
| 6 | **Drag-select (marquee) in the list** and a pointer alternative for reordering pinned notes. | M | `NoteList.tsx` |
| 7 | **Shortcut cheat sheet** on `?` for list, sidebar and board tools (P, E, H, L pen shortcuts), remappable. | S | new overlay, `Whiteboard.tsx` |

### Edge cases
- Selection must survive resorts and sync arrivals: store by id (it does) and prune ids that left scope (`selIds` filters deleted).
- Deleting the focused row: next surviving row (done), the last row (focus previous), an empty list (focus the container).
- Month-grouped lists with the scrubber need `role=group` and labelled headers.

### Performance
- `usePaged` plus memoised rows is sound. For 10,000+ notes use windowing (fixed row height) instead of paging; sticky month headers need a measured offset list.

---

## 9. Cross-cutting large-board plan (3,000+ elements)

Numbers from other tools, for grounding targets:
- tldraw: 10,000 shapes can render about 50 after culling; debounced zoom above 500 shapes; `maxShapesPerPage` 4,000; `interaction-end` reports `fps` and `p95FrameTime`. https://tldraw.dev/sdk-features/performance
- Confluence Whiteboards: goal 5,000 elements at 60 fps; p90 interaction times 1.6 ms add, 2.5 ms drag, 2 ms pan and zoom on large boards; 2048 x 2048 px tiles for culling. https://www.atlassian.com/engineering/rendering-like-butter-a-confluence-whiteboards-story
- Excalidraw: no official performance documentation found. Verified in 0.18.1: per-element `Path2D` cache for freedraw. Lumen's own measurement is the source of truth.

Proposals:
1. **Frame-time probe** (rAF delta p95 over 60 frames) in a hidden debug overlay; auto-enable perf mode when p95 exceeds about 20 ms for 3 s, not only on element count (S).
2. **Spatial index** (RBush) for erase, lasso, scratch-out, snap and DnD probes; rebuild by version diff (M).
3. Lazy and unmountable live cards (section 5) and lazy frame thumbnails (section 3).
4. Stroke splitting at about 600 points for highlighter and very long ink.
5. Grid-hash clustering for handwriting (section 4).
6. **Stress boards** in the dev simulator (`docs/DEV_SIMULATOR.md`): 3,000 and 10,000 mixed elements (60 percent ink, 20 percent shapes, 10 percent text, 10 percent cards); record frame time for pan, zoom, erase, lasso and layer toggle.

---

## 10. Top 10 enhancements overall, ranked by user value

| Rank | Enhancement | Effort | Primary files |
|---|---|---|---|
| 1 | Reliable palm rejection and automatic pen mode | M | `Whiteboard.tsx`, `pens/live.ts`, `pens/PenPanel.tsx` |
| 2 | Coalesced and predicted samples plus `desynchronized` overlay for fast handwriting | M | `pens/LiveInk.ts`, `Whiteboard.tsx` |
| 3 | Stabiliser so live equals final (replace moving-average smoothing) | M | `pens/model.ts`, `pens/LiveInk.ts` |
| 4 | Flat marker and grainy pencil: blunt ends now, Excalidraw freedraw patch plus noise pattern later | S then L | `pens/model.ts`, `patches/`, `LiveInk.ts` |
| 5 | Pointer alternative for every drag (WCAG 2.5.7) and faster adjustable long-press | S | `lib/dnd.ts`, `dnd/send.ts`, list rows |
| 6 | Spatial index plus bounding-box pre-filter for erase, lasso, scratch-out; dynamic perf mode | M | `pens/engine.ts`, `Whiteboard.tsx` |
| 7 | Handwriting: model eval harness, line-based clustering, stale-text invalidation, consent and cap | M | `worker/ext/ai-visual.ts`, `pens/Handwriting.tsx` |
| 8 | Lasso to text in one step, ink kept on a hidden layer | M | `pens/LassoBar.tsx`, `AIReview.tsx`, `layers/model.ts` |
| 9 | Pages mode as a real feature: page frames, add and reorder, multi-page PDF | L | `settings/model.ts`, `present/frames.ts`, export |
| 10 | Note list keyboard and ARIA: Shift+Arrow, Space, select-all scope, roving tabindex | S to M | `NoteList.tsx`, `note-list-desk.tsx` |

Quick wins under half a day each: add `perfect-freehand` as a direct dependency; dedupe the three ink-table copies; scale hold-to-straighten by DPR with a setting; scratch-out must start over ink; IntersectionObserver for frame thumbnails; "Select all N in this view".

## 11. Open questions and things not verified

- Whether Excalidraw releases newer than 0.18.1 add pen options Lumen could use (commit #11551 seen only through a git mirror; no release or date confirmed).
- Handwriting accuracy of Moondream 3.1, Kimi K2.x and Llama 4 Scout on real ink: no benchmark found; the proposed harness settles it.
- Miro and FigJam presentation, remote and pages behaviour; Notability and Concepts palm rejection and dark-mode specifics: no first-party pages reachable. Treat as indicative.
- `getPredictedEvents` support matrix: not covered by sources found.
- Real Lumen frame times at 3,000 and 10,000 elements: not measured in this read-only pass.
- Stroke point counts per handwriting page (section 1) are estimates, not measurements.

## Sources (fetched or searched 2026-11-20)
- perfect-freehand README: https://raw.githubusercontent.com/steveruizok/perfect-freehand/main/README.md
- tldraw: https://tldraw.dev/sdk-features/default-shapes ; https://tldraw.dev/sdk-features/performance ; https://tldraw.dev/sdk-features/culling ; https://tldraw.dev/releases/v4.4.0 ; https://tldraw.dev/blog/a-touchy-subject (2026-07-13)
- Excalidraw commit #11551 mirror: https://gitea.maison43.duckdns.org/gilles/excalidraw/src/commit/2a82821ec5970691199e1ffc6a49ac31f311ab59
- Goodnotes: https://www.goodnotes.com/blog/shape-recognition (2020-09-25) ; https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/46386358-flat-marker-pen-streamline-option ; https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes/suggestions/46042741-true-dark-mode ; https://www.macrumors.com/2023/08/09/goodnotes-6-ai-powered-handwriting-spellcheck/
- Miro pen update (2020-11-03): https://community.miro.com/product-news-31/pen-tool-updates-palm-rejection-highlighter-lasso-tool-and-drawing-presets-2536
- FigJam marker thread (2025): https://forum.figma.com/report-a-problem-6/updates-to-marker-tool-in-figjam-may-2025-41198 ; stamps: https://www.figma.com/blog/whats-new-in-figma-february-2022/
- Apple: https://support.apple.com/ta-in/guide/ipad/ipadf825a0bd/17.0/ipados/17.0 ; https://discussions.apple.com/thread/256252166
- Heptabase: https://wiki.heptabase.com/changelog ; https://wiki.heptabase.com/roadmap ; https://wiki.heptabase.com/section
- AFFiNE: https://affine.pro/blog/affine-080-launch-week-day4 ; https://www.mintlify.com/toeverything/AFFiNE/features/whiteboard
- Confluence Whiteboards: https://www.atlassian.com/engineering/rendering-like-butter-a-confluence-whiteboards-story
- Workers AI: https://developers.cloudflare.com/changelog/post/2026-07-08-moondream31-workers-ai/ ; https://developers.cloudflare.com/workers-ai/models/
- Handwriting benchmarks: https://arxiv.org/abs/2503.15195 ; https://sia.hackernoon.com/handwriting-vs-ai-real-performance-of-ai-on-handwritten-documents ; https://aimultiple.com/it/handwriting-recognition
- Pointer events: https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents ; https://developer.chrome.com/blog/aligning-input-events ; https://developer.apple.com/forums/thread/689375
- $-family: https://depts.washington.edu/acelab/proj/dollar/qdollar.html
- WCAG 2.5.7: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements
- dnd-kit: https://docs.dndkit.com/api-documentation/sensors/touch ; https://mintlify.com/clauderic/dnd-kit/guides/accessibility
