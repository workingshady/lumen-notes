# Print, PDF and HTML export: research, weaknesses, plan (2026-11-22)

## 1. What Lumen does today (from the code)
- **Note ⋯ › Print / PDF** (`printNote`, `src/lib/io.ts`): `noteHtml()` is written into a new tab, then `window.print()` runs after 900 ms. The PDF is whatever the browser's "Save as PDF" makes.
- **Ctrl+K › Import / export… › This note:**
  - `.md`: raw Markdown plus front matter.
  - `.html`: `noteHtml()`, a styled page with KaTeX CSS and Mermaid loaded from a CDN at open time.
  - PDF: the same as Print.
- **Vault:** `.zip` of Markdown (Obsidian folders) or a JSON backup.
- **Canvas / whiteboard / Board / architecture / Mermaid:** the full Export dialog: PNG, SVG, JPEG, WebP, vector PDF (pdf-lib / svg2pdf), HTML (zoom / pan page), `.canvas` / `.excalidraw`, Markdown / Mermaid, scale, background, theme, padding and frames.

## 2. Weaknesses found
| # | Problem | Why it happens |
|---|---|---|
| 1 | Notes print in the current theme: Lamplight gives a dark PDF, and browsers may drop backgrounds and give light text on white | `noteHtml` copies the active theme vars; no print theme, no `print-color-adjust` |
| 2 | No print stylesheet: headings left alone at a page bottom, code / callouts / images / table rows cut across pages | no `@media print`, `break-*`, `orphans` / `widows` rules |
| 3 | Wide tables, long code lines and wide Mermaid diagrams get clipped at the right edge | `overflow:auto` works on screen, not on paper |
| 4 | Long tables lose their header on page 2+ | rendered tables may lack a proper `thead` repeat rule |
| 5 | No TOC with page numbers, no page numbers, no running header / footer | browser print-to-PDF has no CSS support for these; needs Paged.js or a server renderer |
| 6 | HTML export is not self-contained: math, Mermaid and fonts come from CDNs, so offline they show raw code; attachment images point at authenticated URLs and may break when opened elsewhere | `noteHtml` links CDNs and keeps app URLs |
| 7 | Embedded videos / iframes print as empty boxes; links print as plain words with no URL | no print fallback for media; no `a::after` URL / footnote |
| 8 | No one-click "Download PDF" file; pop-up blockers can stop Print; phone print is clumsy | uses `window.open` + `print()` only |
| 9 | No options: page size, margins, orientation, font size, what to include (front matter, TOC, page numbers, link URLs, flashcard answers) | single fixed path |
| 10 | Arabic / RTL and the app fonts may fall back to system fonts in print / PDF | fonts not embedded or awaited before printing |
| 11 | Wikilinks / transclusions / block refs are app-only links in exports | not resolved for the export target |

## 3. Best practice (sources at the end)
- **Print CSS:**
  - Scope everything in `@media print`.
  - `@page { size: A4; margin: 18mm 16mm }` (physical units).
  - `break-inside: avoid` on figures, callouts, short code blocks, images, table rows and cards.
  - `break-after: avoid` on headings.
  - `orphans` / `widows: 3`.
  - `break-*` is the current name; `page-break-*` is a fallback.
  - "avoid" is a request, not a guarantee: very tall blocks must still be allowed to split.
- **Tables:** a real `<thead>` with `display: table-header-group` repeats the header on each page. For wide tables: smaller font, wrapping cells, or a landscape page.
- **Colour:**
  - Print a light theme by default.
  - Where colour matters (callouts, status pills, diagrams), set `print-color-adjust: exact` (plus `-webkit-`), otherwise browsers drop backgrounds.
  - Never print light text that relies on a dark background.
- **Links:**
  - `a[href^="http"]::after { content: " (" attr(href) ")" }` inline, or (cleaner) numbered link footnotes at the end of the document.
  - Skip `#` and `javascript:` links.
- **Media:** hide `video` / `iframe` in print and show a poster image + title + URL (optionally a QR code, generated locally only when printing).
- **Diagrams:** Mermaid / SVG scaled to the page width (`max-width: 100%; height: auto`), never inside a scrolling box. This is the most-reported Obsidian PDF bug and is fixed by plugins in exactly this way.
- **Code:** in print, `white-space: pre-wrap; overflow-wrap: anywhere` so long lines wrap instead of being cut (another top Obsidian complaint). Light code theme in print.
- **TOC with page numbers and running headers / footers:**
  - Chromium print-to-PDF can't do these in CSS.
  - **Paged.js** (polyfill for CSS Paged Media) can: `target-counter(attr(href), page)` for TOC numbers, `@page` margin boxes for headers / footers / page numbers.
  - Build the TOC before Paged.js splits pages (`beforeParsed`).
  - Print only after Paged.js finished and fonts loaded (`document.fonts.ready`), or numbers come out 0 / blank.
- **PDF engines, the tradeoffs:**
  - **Browser print (window.print):** free, offline, selectable text, full CSS. But: a dialog, browser-dependent, no file without the dialog.
  - **html2canvas + jsPDF / html2pdf.js:** an image of the page, not text. Large files, not searchable, not accessible. Avoid for documents.
  - **pdfmake / jsPDF text API:** selectable text, but no HTML / CSS: the layout must be rebuilt in code. Poor fit for rich Markdown.
  - **Headless Chromium on a server:** pixel-perfect, selectable text, a real file, one click. Lumen can use **Cloudflare Browser Rendering** (`page.setContent` + `page.pdf` with paper size and margins; custom fonts via `addStyleTag` with `@font-face`). Limits: free plan has about 10 browser-minutes a day, then 429; it needs the network.
- **Self-contained HTML:**
  - Inline all CSS.
  - Render math to HTML at export time and embed the KaTeX fonts (or a subset).
  - Pre-render Mermaid to inline SVG.
  - Turn images into `data:` URIs: fetch attachments with the user's auth during export.
  - Embed fonts as base64 `@font-face`.
  - Include the same print CSS, so printing the HTML file also works.
  - Respect `prefers-color-scheme` or a fixed chosen theme.

## 4. Plan for Lumen
**A. One shared "print document" builder** (`src/lib/print-doc.ts`), used by Print, PDF and HTML:
- renders the note(s) to a standalone document with a **print theme** (Paper by default; options: "as on screen" with `print-color-adjust: exact`, or high-contrast B/W);
- runs math to KaTeX HTML and Mermaid / inline canvases to inline SVG at build time (no CDN);
- inlines images as data URIs (with auth), embeds fonts (Inter, Source Serif 4, JetBrains Mono, IBM Plex Sans Arabic; subset where possible);
- resolves wikilinks: inside a multi-note export → internal anchors; otherwise plain text with the note title; transclusions inlined;
- media: video / YouTube / iframe → poster or thumbnail + title + URL (+ optional local QR); audio → title + URL;
- links: choice of inline URL, numbered footnotes at the end, or none;
- flashcards / cloze: answers shown, hidden or as a separate answer key;
- tasks keep their check state; callouts, status pills and tables keep colour (exact);
- RTL: `dir="auto"` per block, Arabic fonts embedded.

**B. Print CSS** (one stylesheet, reused by all exports): the rules in §3 (`@page`, `break-*`, `orphans` / `widows`, `thead` repeat, wide table / code / diagram handling, link footnotes, hidden UI).
- Options: break before each H1 / H2, start each note on a new page.
- Wide tables: shrink → wrap → landscape page via a named `@page wide { size: landscape }`.

**C. Export dialog for notes** (same look as the visual Export dialog):
- **Format:** PDF, HTML, Markdown, Print.
- **Paper:** A4 / Letter / A5, portrait / landscape, margins, font size.
- **Theme:** Paper / as on screen / B&W.
- **Include:** title page, TOC (with page numbers for PDF), page numbers, header / footer (title · date · page X of Y), front matter, link style, media style, flashcard answers.
- **Scope:** this note / selected notes / folder / space, with one TOC and each note on a new page.
- Live preview pane using Paged.js; settings remembered per device.

**D. PDF engines:**
1. **Default: Paged.js in a hidden iframe** → preview → `print()`. Free, offline, TOC page numbers, headers / footers.
2. **"Download PDF" (one click, real file):** worker endpoint using Cloudflare Browser Rendering `page.pdf()` on the same print document, with fonts embedded. Fall back to (1) when offline or the daily quota is used up, and say so.
3. **Phone:** use (2) when online, else the share sheet to print.

**E. HTML:** single self-contained `.html` (works offline, prints correctly, light / dark via toggle). Optional "HTML folder" (index + one page per note + assets) for a space.

**F. Visual exports:** already have PDF / HTML. Apply the same print theme option and fonts, and the poster + link fallback for GIF / video.

**G. Tests:**
- A golden "kitchen sink" note: every block type, a long table, long code, a wide Mermaid diagram, images, a video, links, Arabic, cloze.
- Automated: build the print document and assert no CDN URLs, all images are `data:`, `thead` present, the TOC matches headings.
- Visual: PDF via Browser Rendering compared page by page; check Chrome / Edge / Firefox / Safari print preview once.

**Order (smallest risk first):**
1. Print theme + print CSS (fixes #1–4, #7 links / media).
2. Self-contained HTML (#6, #10, #11).
3. Export dialog + Paged.js TOC / page numbers / headers (#5, #9).
4. One-click PDF via Browser Rendering (#8).
5. Multi-note / space export.

## Sources
- Print CSS:
  - [flaviocopes: complete guide to print CSS](https://flaviocopes.com/css-printing/)
  - [Piccalil: printing the web](https://piccalil.li/blog/printing-the-web-making-webpages-look-good-on-paper/)
  - [Print accessibility best practices](https://mgifford.github.io/ACCESSIBILITY.md/examples/PRINT_ACCESSIBILITY_BEST_PRACTICES.html)
  - [Control page breaks in HTML to PDF](https://dev.to/accreditly/how-to-control-page-breaks-in-html-to-pdf-output-1maj)
  - [Optimize HTML for PDF printing](https://htmlcsstoimage.com/blog/optimize-html-for-pdf-printing.md)
  - [MDN: Printing](https://developer.mozilla.org/docs/Web/CSS/Guides/Media_queries/Printing)
  - [Smashing: print style sheet tips](https://www.smashingmagazine.com/2013/03/tips-and-tricks-for-print-style-sheets/)
  - [Adrian Roselli: QR in print CSS only when needed](https://adrianroselli.com/2013/03/calling-qr-in-print-css-only-when-needed.html)
- PDF engines:
  - [Nutrient: HTML to PDF in JavaScript](https://www.nutrient.io/blog/html-to-pdf-in-javascript)
  - [Creating PDFs from HTML/CSS: what actually works](https://dev.to/joyfill/creating-pdfs-from-html-css-in-javascript-what-actually-works-43pl)
  - [Why HTML to PDF is harder than you think](https://dev.to/michael_lip_52d5151c3e364/generating-pdfs-from-html-why-it-is-harder-than-you-think-19b8)
- Paged.js:
  - [Build a TOC](https://pagedjs.org/posts/build-a-table-of-contents-from-your-html)
  - [Cross references / target-counter](https://pagedjs.org/en/documentation/-cross-references/)
- Cloudflare Browser Rendering:
  - [PDF generation](https://developers.cloudflare.com/browser-rendering/how-to/pdf-generation/)
  - [Custom fonts](https://developers.cloudflare.com/browser-rendering/features/custom-fonts)
  - [FAQ / limits](https://developers.cloudflare.com/browser-rendering/faq)
- Obsidian community (real-world failures and their fixes):
  - [long code blocks cut](https://forum.obsidian.md/t/export-to-pdf-is-cutting-off-long-code-blocks-for-certain-formats/23802)
  - [Mermaid cut off](https://forum.obsidian.md/t/mermaid-graphics-cut-off-on-pdf-export-horizontal-scrollbar-shown/16883)
  - [Mermaid overflow](https://forum.obsidian.md/t/prevent-mermaid-charts-from-overflowing-the-page-in-export-to-pdf/13381)
  - [page breaks after headings](https://forum.obsidian.md/t/page-breaks-after-headings-in-pdf-export/55144)
  - [dark mode code unreadable](https://forum.obsidian.md/t/export-to-pdf-makes-code-hard-to-read-if-exported-from-dark-mode/29646)
  - [Mermaid Fix plugin](https://community.obsidian.md/plugins/pdf-mermaid-fix)
  - [Advanced PDF Export plugin](https://community.obsidian.md/plugins/advanced-pdf-export)
