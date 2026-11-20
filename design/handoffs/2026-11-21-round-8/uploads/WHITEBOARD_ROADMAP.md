# Whiteboard, canvas and Mermaid: what's next

Saved 2026-11-20 from the research pass (web + Excalidraw 0.18 source). The first four items in the list are **done** (see "Shipped"). Everything else is waiting here, in the order I'd build it.

## Shipped (2026-11-20)
- **Fast image upload.** Images no longer live as base64 inside the board JSON (that made every autosave, History snapshot and sync push rewrite megabytes). They're stored as Lumen attachments; the board keeps a small ref `files[id] = { id, mimeType, created, lumenAtt }`. Old boards migrate on their first save. Exported `.excalidraw` files (board export + vault zip) get the images inlined again, so the file opens anywhere. Code: `src/lib/wb-files.ts`, `storeBlob/attBlob` in `src/lib/attachments.ts`.
- **GIFs that animate** and **video/audio files** on the board: drop, paste or the Film icon button (lucide `Film`) in the board's top-right cluster. They're Excalidraw `embeddable` elements with `link = /api/att/<id>` and `customData.lumenMedia`, rendered as a real `<img>/<video>` (`src/components/wb-media.tsx`). They also play on shared links.
- **YouTube / Vimeo / any https page** as web embeds (Globe icon button, lucide `Globe`, or Excalidraw's Web Embed tool). On phones both live in the "More tools" grid.

Icons rule (docs/ICONS.md): no emoji anywhere in the app UI. Whiteboard chrome uses lucide line icons like the rest of its toolbar; space/empty-state art uses `<Glyph>` from `src/lib/glyphs.ts`. A feature with no fitting icon gets a new glyph added to `glyphs.ts` in the same stroke style.
- **Smoother pen:** no autosave mid-stroke; Excalidraw's props are stable so saves and vault updates no longer re-render the drawing surface; no per-move selection work while drawing.

## Limits to know
- GIF / video / web embeds show as a placeholder frame in PNG/SVG exports (Excalidraw can't rasterize live media).
- Excalidraw shrinks inserted photos to 1440 px and refuses anything still over 4 MB after that (rare: only huge PNGs).
- Mermaid → editable shapes only covers flowchart, sequence and class diagrams; other kinds come in as one picture.

## Next (in order)
1. **Pen mode / "Sketch" option** in the New visual chooser: pen-first toolbar, Excalidraw `penMode` (touch pans, stylus draws = palm rejection), laser pointer, stroke width/colour presets, pressure on.
2. **Snap shapes while drawing:** hold the stroke for ~0.5 s or toggle "Auto-shape" → recognise circle / ellipse / rectangle / triangle / line / arrow and replace the stroke with a clean element. On-device, no AI ($1/$P-style recognizer or simple geometry fitting).
3. **Hand-drawn diagram → Mermaid (AI):** select strokes or a frame → export PNG → `/api/ai` with a vision model on Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct` or `@cf/meta/llama-4-scout-17b-16e-instruct`) → Mermaid code shown in the Mermaid dialog for review → "Add as editable shapes" or "Replace sketch". Layout won't be kept exactly.
4. **Photo of a paper diagram → Mermaid** (same pipeline, input is an image file).
5. **Handwriting → typed text:** same vision route (no reliable offline engine in the browser). Option: keep the ink and add the text as a hidden searchable layer.
6. **Better exports:** PDF; JPEG/WebP; scale 1×/2×/3×; transparent background; export only the selection or one frame; copy as PNG to the clipboard; dark/light choice; Mermaid text from shapes (flowcharts only).
7. **All-in-one board (option A from the discussion):** grow the whiteboard into the mixed board: note cards (embeddable that renders a Lumen note), `.mermaid` file cards, images, GIF, video, web pages and pen, all in one `.excalidraw` file. Add "Board" to the New visual chooser next to Canvas / Whiteboard / Mermaid.
8. **Canvas (JSON Canvas) additions:** image/GIF/video file cards using the same attachment refs; a light sketch layer later (lower priority, pen there would start weak).

## Not possible (or not worth it)
- Animated media inside PNG/SVG exports.
- Fully offline handwriting recognition with good quality (needs the AI route).
- Keeping the exact hand-drawn layout when converting to Mermaid (Mermaid lays out by itself).

## Sources
- Excalidraw props (`validateEmbeddable`, `renderEmbeddable`): https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props
- Excalidraw Mermaid support: https://plus.excalidraw.com/use-cases/mermaid-diagrams
- Workers AI Llama 3.2 Vision: https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct
- Llama 4 Scout on Workers AI: https://blog.cloudflare.com/meta-llama-4-is-now-available-on-workers-ai/
- $-family gesture recognizers: https://depts.washington.edu/acelab/proj/dollar/index.html
- Excali Up (GIF playback idea): https://github.com/klysman08/Excaliup
