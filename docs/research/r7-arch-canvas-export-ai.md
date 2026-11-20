# R7 research: architecture studio, JSON Canvas, export, AI convert

Stage 2, read-only research. Date: 2026-11-20. All links fetched or searched on that date ("accessed 2026-11-20").
Effort: S = under a day, M = 1-3 days, L = a week or more. Evidence tags: [doc] read on an official page, [search] seen only in search results, [code] read in the repo, [unverified] not confirmed, treat as a hypothesis.

## 0. Correctness risks (read first)

1. **Export on iOS Safari can yield blank or failed images.** `src/lib/diagram-export.ts` sets `MAX_AREA = 268_435_456` (2^28) and `MAX_SIDE = 32_767`. Those are Chrome and Firefox numbers. WebKit on iOS-family platforms caps canvas area at 16,777,216 px (4096x4096) [search: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ , https://bugs.webkit.org/show_bug.cgi?id=230855]. A 3x export of a mid-size diagram on an iPhone or iPad can produce an empty bitmap. Fix: probe the real limit (the `canvas-size` approach, https://github.com/jhildenbiddle/canvas-size) or use a UA-aware cap, and fall back to tiling or vector.
2. **draw.io import fails on compressed files.** `arch-convert.ts` ~L286-287 has a comment saying compressed `<diagram>` payloads are "not inflated here", then uses `textContent` of `<diagram>` as if it were XML. A compressed file holds base64 raw-deflate of URL-encoded XML [search: https://www.drawio.com/docs/reference/diagram-generation/], so the parse fails. Fix with `DecompressionStream("deflate-raw")` then `decodeURIComponent`.
3. **AI request format: the Llama 3.2 path matches the official tutorial.** The tutorial passes `{ messages, image: "data:image/png;base64,..." }` (https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/index.md [doc]). `ai-visual.ts` does this. Not a bug.
4. **AI request format: the Scout fallback is not documented by Cloudflare.** The Scout page (https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/) says Vision = yes but gives no image schema. Community material and `workers-ai-provider` 3.1.4 use OpenAI-style `{type:"image_url", image_url:{url:"data:..."}}` and say HTTP URLs are rejected [search: https://newreleases.io/project/github/cloudflare/ai/release/workers-ai-provider@3.1.4]. Lumen's shape is plausible but unverified end to end. Needs a live smoke test (I1).
5. **Image size ceiling is unverified.** An OpenRouter doc says Workers AI estimates tokens from base64 length (about 4 chars per token) and returns 413 over a 65,536-token window, advising images under about 300 KB. It sits under a different model heading ("Clef"), so it may not apply to Llama [search: https://openrouter.ai/docs/guides/community/multimodal-decisions.md, unverified]. Lumen allows 3.5 MB base64 (`MAX_IMAGE`). Measure rejection thresholds on both models.
6. **Licence handling is correct but narrow.** Doc: send one request with `prompt: "agree"` per account [doc: https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/]. `agree()` does that, but only fires when the error text matches `/agree|licen[cs]e|5016|terms/`. If real text differs, the user sees "AI request failed" and Scout masks the cause. Log raw error codes.
7. **Review endpoint trusts model JSON.** `/ai/visual/review` slices first `{` to last `}` and returns whatever parses; the client maps `spof` and `missing`, so a non-array crashes the panel. Validate shape server-side (A11).
8. **Canvas load drops a whole file on one bad item.** `parseCanvas` returns an empty canvas when `validate()` fails (e.g. one edge to a missing node). Confirm in `CanvasEditor.tsx` (~L524-540, L642) that autosave never writes that empty canvas over the user's file. Needs a manual test.
9. **Unknown top-level keys are dropped on save.** `parseCanvas` keeps only `nodes`, `edges` and `lumen*`. Other plugins' top-level data (Advanced Canvas metadata, field names unverified) would be lost.

## 1. Architecture studio

### 1.1 What Lumen does now [code]
- **DSL** (`src/lib/arch-dsl.ts`): hand-written line parser: `Name [icon, tech, status, label, color, size, kind] {`, edges `A > B: label (async|data|control|sync)`, operators `> < <> - -- --> <-->`, fan-out, chains, ERD field blocks. Errors carry line, col, message, icon suggestion.
- **Two-way sync:** `printDsl(canvas, cachedDsl)` re-attaches comments by anchor keys (`n:Name`, `e:A>B`, `end:Name`, `dir`, `eof`); leftover comments go to the end. `applyDsl` matches nodes by name with a rename heuristic (same declaration line). Matched nodes keep id, position, size and non-DSL fields. Edges keep id, ports, shape when the same pair still connects. Positions never appear in the DSL.
- **Layout** (`arch-layout.ts`): elkjs layered in a worker: `ORTHOGONAL`, `INCLUDE_CHILDREN`, BRANDES_KOEPF, one fixed centre port per side, INTERACTIVE strategies when "keep positions" is on, spacing set on every container. Routes stored with a geometry key (`pointsKey`), valid only while nodes have not moved. `snapRoute` pins ends to side centres.
- **Routing** (`arch-route.ts`): fallback elbow uses one midline bend with no obstacle avoidance. Manual bend editing exists.
- **Mermaid** (`arch-convert.ts`): export architecture-beta (groups, services, junctions, T/B/L/R ports, arrows), flowchart, erDiagram, C4, sequence. Import: Mermaid architecture, ER, C4, draw.io XML, SQL DDL.
- **AI** (`worker/ext/ai-visual.ts`, `src/lib/ai-convert.ts`): `/arch`, `/edit` (whole DSL in and out), `/review` (JSON, docs, flashcards). Client `checkDsl` is a light regex check; `diffDsl` is an LCS line diff for Accept / Reject.

### 1.2 Best practice and competitors
- **Source is truth, layout is derived.** Eraser, D2 and Mermaid keep positions out of source and re-run layout (Eraser: docs/ARCHITECTURE_DIAGRAMS.md section 1.1, https://docs.eraser.io/). draw.io keeps XML with ids on every cell. Lumen's name-keyed matching fits a text-first DSL; weak points are duplicate edges and renames (A3).
- **Model once, view many (C4).** IcePanel stores objects once, shows them on many diagrams, rename and edits apply everywhere, reused objects keep connections and metadata; flows are tied to the model; tags show or hide objects per audience [search: https://docs.icepanel.io/core-features/diagramming , https://docs.icepanel.io/core-features/modelling]. Structurizr does it in text (one model, many views with include/exclude and autoLayout) [unverified, not retrieved]. Lumen's `arch-objects.ts` is the reuse layer; verify live rename across diagrams and C4 level views as filters.
- **ELK layered:** supports straight, orthogonal and spline routing; orthogonal respects arbitrary port constraints; `hierarchyHandling` default INHERIT; `mergeHierarchyEdges`, `considerModelOrder` exist [doc: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html ; https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html].
- **Mermaid architecture-beta:** `group id(icon)[Title] in parent`, `service`, edges `a:R --> L:b`, `{group}` modifier to attach to a group border, `junction`. Built-in icons only `cloud, database, disk, internet, server`; edge labels not documented; layout can overlap siblings (issue 6120); `align` since v11.16.0; `randomize`/`seed`; ids must be declared before use [doc: https://mermaid.js.org/syntax/architecture.html].
- **draw.io:** docs recommend uncompressed `mxGraphModel` when generating, but importers must read compressed [search: https://www.drawio.com/docs/reference/diagram-generation/ , https://www.drawio.com/doc/faq/ai-drawio-generation].
- **LLM to DSL:** parse or render check, feed parser error back, retry cap 2-3, deterministic fallback. A JSON-first then deterministic-converter pipeline raised validity from about 70% to near 100% in one student project (weak evidence). Raw execution feedback closes most of the gap on a 630-task Mermaid benchmark [search: https://neurips.cc/virtual/2026/173008 , https://microsoft.github.io/genaiscript/blog/mermaids , https://llm-enabled-development-41d6d8.pages.cms.hu-berlin.de/en/experiments/diagram/diagram-long].

### 1.3 Gaps and enhancements, ranked by user value

| # | Enhancement | Effort | Files |
|---|---|---|---|
| A1 | **Parse-validate AI output with the real parser and auto-repair.** Run `parseDsl`, send `errors[]` (line, message) back with the failing DSL, max 2 rounds, then show remaining errors in the Accept panel. Replace `checkDsl`. | M | `ai-convert.ts`, `ai-visual.ts` (share parser), `arch/ArchPanels.tsx`, `arch/ai-hooks.ts` |
| A2 | **AI edit as minimal ops.** Ask for ops (add/rename/remove node or edge, set attr), apply to the parsed doc, print with `printDsl`. Keeps ids, comments, order; fewer tokens. Keep line diff as review UI. | M | `ai-visual.ts` `/edit`, `arch-dsl.ts`, `ArchPanels.tsx` |
| A3 | **Round-trip safety for parallel edges and renames.** Anchor `e:A>B` and pair matching collapse two edges between the same nodes. Key by `from>to#n`. Add optional `id:` attr so renames survive. | M | `arch-dsl.ts` (`printDsl`, `applyDsl`), tests |
| A4 | **ELK options.** `considerModelOrder.strategy` NODES_AND_EDGES for stable re-layout, `favorStraightEdges`, `mergeEdges` for fan-in, `separateConnectedComponents`, pass edge labels to ELK so they reserve space (today labels can overlap lines). Test each option against elkjs 0.12.1. | S-M | `arch-layout.ts` |
| A5 | **Multiple ports per side.** One centre port per side stacks 4+ edges on one point. Use several slots per side (ELK `FREE` then snap to even slots) and draw handles there. | M-L | `arch-layout.ts`, `arch-route.ts`, `arch/ArchEdge.tsx`, `ArchFlow.tsx` |
| A6 | **Obstacle-aware routing after a drag.** Stored routes are discarded when nodes move and the fallback elbow ignores other nodes. Add a grid A* or visibility-graph router for moved edges, or ELK on the affected sub-graph (`scope: "selection"` exists). | M | `arch-route.ts`, `arch/ArchStudio.tsx` |
| A7 | **Group edges and self-loops in layout.** `elkLayout` drops edges with a group endpoint and self-loops. Lift them to a child or hierarchical port; draw self-loops as a loop. | M | `arch-layout.ts`, `arch-route.ts` |
| A8 | **C4 views from one model.** Filter by level, tag, boundary; live rename across diagrams; "neighbours of X" view. | L | `arch-objects.ts`, `arch-model.ts`, `arch/ArchChooser.tsx`, `ArchPanels.tsx` |
| A9 | **Mermaid fidelity.** architecture-beta has no edge labels: fall back to flowchart when labels exist or warn. Emit `{group}` for group endpoints. C4: `Rel`, `System_Boundary`, `Person`, `ContainerDb`, `System_Ext` by kind. Import `junction`, `{group}`, `in parent`. Avoid reserved ids (`end`, `graph`). | M | `arch-convert.ts` |
| A10 | **draw.io fidelity.** Inflate compressed files (risk 2). Export: uncompressed `mxfile`, ids from node ids, `parent` for groups, `edgeStyle=orthogonalEdgeStyle`, `exitX/exitY/entryX/entryY` from stored sides, `<Array as="points">` from stored routes. Import: relative geometry, container groups, HTML labels, multiple `<diagram>` pages. | M | `arch-convert.ts` |
| A11 | **Review schema via `response_format`.** The text model `llama-3.3-70b-instruct-fp8-fast` is on the JSON Mode list; JSON Mode does not guarantee schema, can throw "JSON Mode couldn't be met", no streaming [doc: https://developers.cloudflare.com/workers-ai/features/json-mode/]. Use `json_schema`, then clamp server-side (arrays, max 5, enum severity) and drop items that name no existing node. | S | `ai-visual.ts` `/review`, `ai-convert.ts` types |
| A12 | **Describe prompt.** Add 1-2 few-shot DSL examples; generate the icon list from `ARCH_ICONS` instead of hard-coding; require every edge endpoint to be declared. The prompt shares one grammar across flowchart, sequence, erd and c4 although only ERD has field syntax. | S | `ai-visual.ts` |
| A13 | **Canvas-side diff.** Colour added/removed/changed nodes and edges on the board (`diffSummary` already gives names). | S-M | `ArchPanels.tsx`, `ai-convert.ts` |

### 1.4 Edge cases and failure modes
- Duplicate node names in different groups are an error; AI output with two `API` nodes fails whole. Add to repair loop ("rename duplicates").
- `-` and `--` need spaces around them to count as operators (`findOps`); tell the model.
- `//` inside quoted attribute values (`tech: "http://..."`) must not start a comment; add a test.
- Rename heuristic by line: inserting a line above plus a rename in one edit can swap ids. Require same parent too.
- Reversing an edge changes its comment anchor, so its comment moves.
- Mermaid slug ids for non-Latin names fall back to `n`, `n2`; collisions are handled.
- ELK on 500+ nodes needs a timeout, cancel and a "taking long" state.
- INTERACTIVE strategies with stale group x/y can overlap groups; `fitGroups` runs after, clamp as well.

## 2. Canvas (JSON Canvas)

### 2.1 What Lumen does now [code]
- `shared/types.ts`: nodes text, file (`subpath`), link, group (`label`, `background`, `backgroundStyle`); edges with sides, ends, color, label. `canvas.ts`: strict `validate`, `parseCanvas`, `stringify`, layouts (grid, tree, force, tidy with compound groups and pinned cards).
- Style extensions are `lumen*` keys (`canvas-style.ts`), defaults removed on write so plain cards stay plain JSON Canvas.
- Editor: `@xyflow/react` 12.12, `ConnectionMode.Loose`, snap grid, `minZoom 0.05`, custom `CanvasEdge` with bend points and label drag. No `onlyRenderVisibleElements` (`CanvasEditor.tsx` ~L1210).

### 2.2 Spec and interop
- **Spec 1.0** [doc: https://jsoncanvas.org/spec/1.0/]: `nodes`, `edges` optional; node required `id,type,x,y,width,height`; color hex or preset "1"-"6" (appearance undefined); text needs `text`, file needs `file` (optional `subpath` starting `#`), link needs `url`; group optional `label`, `background`, `backgroundStyle` (`cover|ratio|repeat`); edge required `id,fromNode,toNode`; `fromEnd` default `none`, `toEnd` default `arrow`; z-order is array order; unknown fields unspecified. Lumen's types and defaults match.
- **Obsidian / Advanced Canvas:** Advanced Canvas extends the format ("Advanced JSON Canvas") and claims compatibility with the base spec [search: https://community.obsidian.md/plugins/advanced-canvas , https://obsidian.md/blog/json-canvas/]. Field list not retrieved; check its README before building a compatibility layer.

### 2.3 Gaps and enhancements, ranked

| # | Enhancement | Effort | Files |
|---|---|---|---|
| C1 | **Lenient load with repair report.** Keep valid items, drop or park edges to missing nodes, generate missing ids, default missing sizes, banner "N items repaired". Never replace file content with empty on error; open read-only showing raw JSON. | M | `canvas.ts`, `CanvasEditor.tsx` |
| C2 | **Preserve unknown fields.** Keep unrecognised top-level keys in a bag in `pickMeta` and write them back. | S | `canvas-style.ts`, `canvas.ts` |
| C3 | **Viewport culling for big boards.** Add `onlyRenderVisibleElements` (verify in React Flow 12 docs), keep node and edge components memoised, avoid rebuilding `shownEdges` per drag tick. Measure on a 2,000-node synthetic file first. | M | `CanvasEditor.tsx`, `CanvasEdge.tsx` |
| C4 | **Edge editing UX.** Floating nearest-side when sides are absent, drag an edge end to reconnect (`onReconnect`), insert-node-on-edge, keyboard edge selection and label edit, sides always stored so Obsidian shows a sane route (bend points are Lumen-only). | M | `CanvasEdge.tsx`, `CanvasEditor.tsx` L96-136 |
| C5 | **Groups the Obsidian way.** Membership is geometric (Lumen's centre-in-box `membersOf` matches). Add drag-group-moves-members, resize without moving members, fit-to-contents, background image UI. Check groups precede members in array order so they draw underneath (`reorder`). | M | `CanvasEditor.tsx`, `canvas.ts` |
| C6 | **Round-trip fixtures.** Obsidian default file, nodes-only file, `fromEnd:"arrow"`, group with `backgroundStyle`, `subpath:"#^block"`, a `lumen*` file read by plain readers. Obsidian writes tabs, Lumen 2 spaces; match to avoid noisy vault diffs. | S | new `canvas.test.ts`, `canvas.ts` |
| C7 | **File-node subpaths** (`#heading`, `#^block`) open the right spot (PDF `#page=` already works). | S | `CanvasEditor.tsx` FileNode |
| C8 | **Layout off main thread** over about 300 nodes (force runs 300 ticks on main). | M | `canvas.ts`, new worker |

### 2.4 Edge cases
- Self-loop edges, duplicate edge ids, negative or huge coordinates (1e7); `fitView` with `minZoom 0.05` cannot frame a very wide board.
- File nodes pointing at deleted notes: show a "missing file" card, never drop the node.
- Text nodes are Markdown: keep raw text exactly.
- Colour presets may arrive as numbers; accept both.

## 3. Export

### 3.1 What Lumen does now [code]
- Dialog `DiagramExport.tsx`; job pipeline `export-job.ts`, `export-run.ts`, `export-encode.ts`, `export-worker.ts`. Formats: PNG, JPEG, WebP, SVG, PDF, Markdown, Mermaid, source. Raster path: SVG to Image to ImageBitmap to OffscreenCanvas in a worker.
- **PDF is raster:** each page is a JPEG (quality at least 0.85, PNG if transparent) placed with pdf-lib on A4, Letter, 16:9 or fit pages. Text is not selectable; zoom shows pixels.
- **Embed scene:** SVG `<metadata id="lumen-scene">` CDATA; PNG `tEXt` chunk `lumen-scene` (base64 JSON, after IHDR at byte 33). Not for PDF.
- Hand-written stored ZIP (CRC32, no ZIP64).
- SVG output has no `<title>`, `<desc>`, `role="img"` or `aria-labelledby` (grep of `arch-render.ts`, `canvas-render.ts`, `diagram-export.ts` found none).

### 3.2 Best practice and competitors
- **Vector PDF.** `svg2pdf.js` on jsPDF draws vector paths; non-basic fonts must be registered first; text selectability not confirmed in what I read [search: https://github.com/yWorks/svg2pdf.js]. Rust `typst/svg2pdf` can embed text, some wrappers do not yet [search: https://pypi.org/project/svg2pdf-py/]. `pdf-lib` has no SVG renderer in what I found (`embedSvg` unconfirmed). Alternative: `pdfkit` + `svg-to-pdfkit` (https://github.com/Kittl/SVG-to-PDFKit). Keep raster fallback for filters or `foreignObject`.
- **Embedded scene.** Excalidraw `exportEmbedScene` (default false) for PNG and SVG; the PNG re-opens by drop; recompressors such as ImageOptim can strip it, some editor plugins had read problems [search: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export , https://github.com/excalidraw/excalidraw/issues/8025]. Lumen's SVG metadata plus PNG tEXt matches.
- **Canvas limits** [search: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ , https://github.com/jhildenbiddle/canvas-size]: Chrome 32,767 per side and 2^28 px; Firefox 32,767 per side plus a byte cap (sources disagree on area); iOS Safari 16,777,216 px. Probe at runtime.
- **Print sizes:** A4 is 794x1123 CSS px at 96 dpi, 2480x3508 px at 300 dpi. Vector PDF is dpi-independent.

### 3.3 Gaps and enhancements, ranked

| # | Enhancement | Effort | Files |
|---|---|---|---|
| E1 | **Per-browser canvas limits** (risk 1). Probe or UA-cap; show the `limited` notice; for SVG-sourced jobs fall back to vector. | S | `diagram-export.ts` (`maxScale`), `export-run.ts` |
| E2 | **Vector PDF** option using svg2pdf.js + jsPDF (lazy import), embedded font, PDF title, author and `/Lang`; raster fallback for unsupported SVG features. Weigh bundle size. | L | `export-encode.ts` (`buildPdf`), `export-run.ts`, `DiagramExport.tsx` |
| E3 | **Accessible SVG.** `role="img"`, `<title id>` (diagram name), `<desc id>` (generated summary: counts, groups, main flows), `aria-labelledby`, `lang`. Offer a Markdown text-alternative export. Check palette contrast of status colours. | S | `arch-render.ts`, `canvas-render.ts`, `diagram-export.ts` |
| E4 | **Scene in PDF** (pdf-lib `attach` or XMP) so a PDF re-opens as editable; **compress** (deflate) scene JSON before base64 in PNG and SVG to keep files small. | M | `export-run.ts`, `export-encode.ts` |
| E5 | **Re-import embedded scene** from a dropped PNG or SVG (not verified in this pass). | S-M | import path, `export-encode.ts` |
| E6 | **Tiled export** for huge boards when the capped scale makes text tiny (multi-page PDF or ZIP). | M | `export-run.ts` |
| E7 | **Print presets** A3, A5, Tabloid and dpi picker (150, 300) with pixel and file-size estimate. | S | `DiagramExport.tsx`, `export-job.ts` |
| E8 | ZIP64 guard (over 4 GB or 65,535 entries). | S | `export-encode.ts` |

### 3.4 Edge cases
- SVG drawn via `Image` cannot use page web fonts or external images. Confirm Inter is embedded and `vendorIconUrl` returns data URLs, or exports show fallback fonts and missing icons.
- JPEG has no alpha: background is forced (done).
- `pngWithText` assumes IHDR ends at byte 33; add a signature and first-chunk check.
- Large `tEXt` chunks can be truncated by some tools; compress (E4).

## 4. AI convert backend

### 4.1 What Lumen does now [code]
- `POST /api/ai/visual/convert {image, kind: text|math|mermaid|shapes-hint}`. Llama 3.2 11B Vision first with `{messages:[{role:"user",content:prompt}], image: dataUri, max_tokens:1024, temperature:0.1}`; then Llama 4 Scout with OpenAI-style content parts. Two tries per model; licence-like error triggers `{prompt:"agree"}` once.
- Timeout 50 s per attempt (worker), 60 s (client); `MAX_IMAGE` 3.5M chars; client shrinks to at most 1600 px PNG.
- Output: `cleanCode` strips fences and a leading "Here is"; `{{best|alt|alt}}` markers become low-confidence `spans`. Neurons are estimated (fixed 1,100 image tokens), not measured.
- Errors: timeout/499 to 504; limit/quota/429/3036/4006 to 429 `ai_limit`; empty to 422 `unreadable`.

### 4.2 Official facts [doc, accessed 2026-11-20]
- Llama 3.2 11B Vision: 128k context, `max_tokens` default 256, $0.0485 per M input and $0.676 per M output, one-time `prompt:"agree"` licence step; no deprecation notice (https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/).
- Llama 4 Scout: 131k context, $0.27 per M input and $0.85 per M output, output has `response`, `usage`, `tool_calls`; supports `guided_json`, `response_format`; no image schema or image limits on the page (https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/).
- Tutorial: 3.2 takes `messages` plus top-level `image` (data URI or URL); says nothing on size limits.
- JSON Mode listed models include `llama-3.3-70b-instruct-fp8-fast`; no streaming.
- Per-task rate limits exist (20 req/min default for some tasks) [search: https://developers.cloudflare.com/workers-ai/platform/limits/, not read in full].
- No source found on handwriting accuracy for either model. Build a small ink test set.

### 4.3 Gaps and enhancements, ranked

| # | Enhancement | Effort | Files |
|---|---|---|---|
| I1 | **Live smoke test of both request shapes** with a tiny PNG; log model and raw error code on failure. | S | `ai-visual.ts`, test script |
| I2 | **Use real usage.** Read the response `usage` (Scout documents it) instead of the fixed image guess; keep the estimate as fallback. | S | `ai-visual.ts` (`neurons`, `vision`) |
| I3 | **Right-size images.** Crop to ink bounds, grayscale, max side 1280-1600, aim under about 300-500 KB; lower `MAX_IMAGE` to the measured limit; friendly 413. | M | `ai-convert.ts` (`blobToDataUri`), `ai-visual.ts` |
| I4 | **Confidence.** Self-reported `{{a|b}}` is poorly calibrated. Run Scout as a second opinion when output has many markers or fails validation; mark disagreements as low-confidence spans; always show ink beside result. | M | `ai-visual.ts` `/convert`, review sheet |
| I5 | **Per-kind validation.** math: strip `$`, `\[`, `\(`, check braces and environments, try KaTeX render; mermaid: parse with Mermaid or arch-dsl parser, retry once with the error; text: strip "Transcription:" style chatter. | M | `ai-visual.ts`, `ai-convert.ts` |
| I6 | **Prompt design.** Use a system message; add "if nothing legible reply exactly `NO_TEXT`" (maps to 422); "do not correct spelling or maths"; LaTeX: `\frac`, `\sqrt`, `aligned` for multi-line; Mermaid: explicit node ids, quoted labels, `flowchart LR`, label edges only if drawn; handwriting: Markdown bullets and line breaks; temperature 0 to 0.1. | S | `ai-visual.ts` (`CONVERT`) |
| I7 | **Cache** by SHA-256 of kind + image bytes in KV for about 7 days, scoped per user, so re-convert is free. | M | `ai-visual.ts`, wrangler KV binding |
| I8 | **Retry and deadline.** Worst case today is about 200 s (2 tries x 2 models x 50 s) against a 60 s client abort, so the server keeps spending neurons after the user left. Use one total deadline (about 45 s), retry only 5xx or empty, jittered backoff, never 429 (done). | S | `ai-visual.ts` (`vision`, `withTimeout`) |
| I9 | **Licence hardening.** Run `agree` once per isolate, log raw code, return a distinct `ai_licence` code for "needs one-time setup". | S | `ai-visual.ts` |
| I10 | **Arch endpoints.** See A1, A2, A11. `chat()` silently truncates input at 24,000 chars; return a flag so the user knows. | S | `ai-visual.ts` |
| I11 | **Abuse and cost.** Add per-minute limit; verify image magic bytes (the server prefixes `data:image/png` blindly). | S | `ai-visual.ts` |

### 4.4 Edge cases and failure modes
- Empty reply from 3.2 falls through to Scout (good); if Scout then fails with another message the user sees the generic error instead of "unreadable".
- Model refuses or says "I cannot read handwriting": detect and map to `unreadable`.
- Truncation at `max_tokens: 1024` on long pages: detect an incomplete last line, warn, allow 2048 for text.
- Matrices and multi-line derivations give partial LaTeX; show a render preview before insert.
- Mixed or right-to-left scripts and faint ink: preprocess contrast.
- The "limit" regex maps any message containing "limit" to the daily-limit text, which misleads on per-minute throttling.

## 5. Suggested order
1. Safety: E1, draw.io inflate, C1, C2, I1, I8, A11.
2. AI quality: A1, A2, I3, I5, I6.
3. Layout and routing: A4, A3, A5, A6.
4. Export depth: E3, E2, E4.
5. Model and views: A8, C3.

## 6. Sources (accessed 2026-11-20)
- Cloudflare: https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/ ; https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/ ; https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/index.md ; https://developers.cloudflare.com/workers-ai/features/json-mode/ ; https://developers.cloudflare.com/workers-ai/platform/limits/ ; https://newreleases.io/project/github/cloudflare/ai/release/workers-ai-provider@3.1.4
- OpenRouter note (unverified for Llama): https://openrouter.ai/docs/guides/community/multimodal-decisions.md
- JSON Canvas: https://jsoncanvas.org/spec/1.0/ ; https://obsidian.md/blog/json-canvas/ ; https://community.obsidian.md/plugins/advanced-canvas
- Mermaid: https://mermaid.js.org/syntax/architecture.html
- ELK: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html ; https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html
- draw.io: https://www.drawio.com/docs/reference/diagram-generation/ ; https://www.drawio.com/doc/faq/ai-drawio-generation
- IcePanel: https://docs.icepanel.io/core-features/diagramming ; https://docs.icepanel.io/core-features/modelling
- PDF: https://github.com/yWorks/svg2pdf.js ; https://github.com/Kittl/SVG-to-PDFKit
- Excalidraw: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export ; https://github.com/excalidraw/excalidraw/issues/8025
- Canvas limits: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ ; https://github.com/jhildenbiddle/canvas-size ; https://bugs.webkit.org/show_bug.cgi?id=230855
- LLM diagram repair: https://neurips.cc/virtual/2026/173008 ; https://microsoft.github.io/genaiscript/blog/mermaids ; https://llm-enabled-development-41d6d8.pages.cms.hu-berlin.de/en/experiments/diagram/diagram-long

Not covered (no useful results or not fetched): Structurizr DSL specifics, D2, Lucidchart, Eraser import fidelity, tldraw SVG accessibility, Advanced Canvas field names, handwriting accuracy of the two vision models.
