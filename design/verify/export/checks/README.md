# Note export: browser checks

Node scripts that drive the real app in Edge (puppeteer-core) against `npx vite --port 5337 --strictPort`, with the "kitchen sink" fixture
(`scripts/fixtures/kitchen-sink.ts`). Run from a folder that has puppeteer-core installed:

1. `node check-dialog.cjs`        dialog in Lamplight / Paper / phone / Arabic RTL, the note menu items (shots `01`-`05`)
2. `node gen-docs.cjs`            builds `kitchen-sink.html` and `kitchen-sink.paged.html` with the app's real services
3. `node check-offline-html.cjs`  opens the HTML with the network blocked: math, diagrams, images, fonts; light / dark / print (shots `10`, `11`)
4. `node check-paged-pdf.cjs`     Paged.js layout + `page.pdf()`: page count, TOC page numbers, clipping, page shots `20-*`
5. `node check-scenarios.cjs`     dark theme, Arabic, empty / canvas-only note, 20-note folder, offline, 429 / 501, pop-up blocked, Firefox, cancel, HTML folder zip
6. `node pdftext.mjs <pdf> 2,3`   text of PDF pages (uses pdfjs-dist from the repo)

Paths inside the scripts point at this worktree; adjust `OUT` and the `file:///` URLs when running elsewhere.
