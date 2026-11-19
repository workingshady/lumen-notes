# PDF notes and highlights

A PDF document note is a Markdown note with `type: pdf`. Its front matter points at the file; its body holds your own notes and the highlights, as plain Markdown that reads fine in any editor. Opening the note shows the reader (`src/components/PdfReader.tsx`); **Edit** shows the Markdown.

Code: `src/lib/pdf-format.ts` (format, pure), `src/lib/pdf-geom.ts` (rects, image regions), `src/lib/pdf-doc.ts` (pdf.js), `src/lib/pdf-note.ts` (actions). Tests: `npx tsx scripts/pdf.test.ts`.

## Front matter

```yaml
---
type: pdf
file: att:3f2c9a…        # an attachment (bytes in IndexedDB + D1 parts), or an https URL
page: 4                  # last page read (the reader reopens here)
pages: 15
progress: 27             # furthest point read, percent
---
# Attention Is All You Need
```

The title is the first `# H1`, as for every note. Reading position is written with `keepTime`, so scrolling doesn't change the note's "updated" time.

## Highlights

Highlights live under `## Highlights` (created when missing), in page order. One list item per highlight:

```markdown
## Highlights

- yellow · p. 4 · The Transformer follows this overall architecture ^hl-k3x9a2
  - comment: the key sentence
  - tags: #architecture #attention
  - rects: 0.1176 0.3021 0.7647 0.0142, 0.1176 0.3163 0.4 0.0142
  - text: 1234 87
  - created: 2026-11-19T10:22:31Z
- blue · p. 3 · area ![Figure 1](att:9ab1…) ^hl-ab12cd
  - rects: 0.1 0.2 0.5 0.4
```

- **Head line:** `- <color> · p. <page> · <quote> ^<id>`.
  - Colors: `yellow green blue red purple`. They map to JSON Canvas presets `3 4 5 1 6`.
  - The quote is one line, with Markdown characters escaped (`\#`, `\[`, `\*`, `\=`, …), so a quote never becomes a tag, link or mark.
  - The id is `hl-` plus 6 characters. It is also an Obsidian block id.
- **Area highlight:** the quote slot is `area ![<words under the rect>](<image>)`. The image is a PNG attachment cropped from the page, rendered without dark-mode inversion.
- **Sub-items** (all optional, any order):
  - `comment:` one line.
  - `tags:` `#tag` words. These also become note tags, like any inline tag.
  - `rects:` normalized `x y w h` boxes (0 to 1 of the page width and height), comma-separated, one per text line. Overlays come from these, so they survive zoom and re-render.
  - `text:` start offset and length of the quote in the page text (pdf.js text items joined without separators).
  - `created:` ISO time.

Anything else in the note (paragraphs, other sections, flashcards) is left alone.

## Links back to a highlight

A highlight is referenced with the standard block reference, labelled with the page:

```markdown
[[Attention Is All You Need#^hl-k3x9a2|Attention Is All You Need · p. 4]]
```

It renders as a chip (`a.wikilink.pdf-ref`). Clicking it opens the reader at that page and flashes the highlight (`pendingBlock` from `lib/blocks.ts`). `![[Paper#^hl-id]]` transcludes the Markdown line.

- **Note from a highlight:** a new note with the quote (or image), the comment, the back-link and the tags.
- **Card:** appends one line to a chosen note (default `<Title>: cards`):
  - Q and A: `Front :: Back [[Paper#^hl-id|Paper · p. 4]]`
  - Cloze: `Text with {{c1::hidden}} words [[Paper#^hl-id|…]]`
- **Make a note from all highlights / Export as Markdown:** sections `## p. N`, each with the quote, the comment and tags, and the back-link.

## Canvas

No format change. Everything is standard JSON Canvas 1.0:

- **Highlight card:** a `text` node whose text is `> quote` (or `![…](att:…)`), a blank line, then the back-link. `color` is the highlight's preset. `CanvasEditor` recognises this shape (`parseHlCard`) and draws a colored left edge and a page chip. Create one by dragging a highlight from the reader's panel onto a canvas (drag type `application/x-lumen-pdf-highlight`), or with **Add to canvas** on a highlight.
- **PDF card:** a `file` node pointing at the PDF note, with an optional `subpath: "#page=4"`. It shows pages, progress and the highlight count, and opens the reader at that page.

## Reader (round 4, Lumen 19 · PdfDesk)

- **Toolbar:** PDF glyph + title, furthest-read bar + %, Scroll / Single, Fit width ▾ (fit width = page up to 640 px on desktop, fit page, 50–300 %, zoom in/out), page field `4 / 15` (click to type), Area, Find, ⋯ (pages sidebar, Highlights panel, dark pages, make a note from all highlights, export). Phone: glyph, title, page, Area, ⋯ (highlights sheet, pages and outline, find, layout, zoom, dark pages, export).
- **Single page:** one page at a time; arrows, page field, thumbnails and wheel past the page edge turn pages. Stored per device (`lumen.pdf.single`).
- **Continue:** reopening a paper no longer jumps; a pill offers "Continue where you left off · p. N (P%)". The saved page is only overwritten after the reader has been moved.
- **Area:** dragging a box no longer saves at once: the dashed box waits for a colour, Note, Card, Copy or Link, like a text selection.
- **Margin markers:** one numbered square per highlight to the right of the page (a pen when it has a comment); click to edit.
- **Highlights panel** (right, 320 px): by page / newest, filter by colour and tag, kind (text / area), make a note from all, export as Markdown. Phone: sheet from ⋯.
- **Page colours:** Lamplight tints pages to `#F4F1EA` (multiply), Paper keeps white, dark pages invert to `#16191F` with `#D8D5CE` ink (images kept).
- **States:** skeleton with "Loading part 2 of 3 · 1.4 of 2.1 MB" (1.5 MB D1 parts), password card (never stored), scanned pill pointing to Area.
- Blue highlights draw as `#7AA2F7` (canvas preset stays `5`).

Demo vault: `lib/demo-pdf.ts` builds a real 15-page PDF (original text, outline, figures) for `dm-att-vaswani`; the note `dm-pdf-attention` carries 9 highlights whose rects come from the generator's layout.
