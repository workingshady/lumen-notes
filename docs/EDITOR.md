# Editor & Read (round 4)

Design: `design/handoffs/2026-11-19-round-4/Lumen 16 Editor and Read.dc.html` (EditorDesk, ReadDoc, LayoutThumb). Verify pairs: `design/verify/r4/editor/`.

## Editor
- **Page surface** (desktop Edit, phone Edit): centred 680 px column in the reading font, 16/28; heading marks (`## `) hide when the caret is on another line; the blank line between two blocks is drawn 10 px tall (`components/editor-live.ts`). Split keeps the source editor with line numbers.
- **"/" menu** (`components/SlashMenu.tsx`, catalog `lib/slash.ts`): 60 blocks in Basic · Layout · Panels & callouts · Media & embeds · Knowledge · Advanced, each row = glyph tile, label, hint, Markdown shortcut. **Recent** group (last 3 used, per device: `localStorage["lumen.slashRecent"]`). No results: "No block called “x”", a suggestion (synonyms such as kanban → board, else the closest block word), **Search all commands** (looser search; when still empty it opens the command palette with the query). `//` = today's date. Never opens in URLs or code fences. Phone: bottom sheet with its own search field.
- **Insert gallery** (`components/InsertGallery.tsx`, thumbnails `components/LayoutThumb.tsx`): note ⋯ › Insert…, or "Insert gallery…" in the "/" menu. 15 layouts in three rows, hover preview with the Markdown it writes; arrows + Enter, Esc. Phone: bottom sheet, 3 per row.
- **Block handle** (`components/editor-blocks.ts`): ⋮⋮ beside the hovered block (block washes in --surface), solid while grabbed / menu open; drag lifts a copy, the source fades to 35%, a 2 px accent line marks the drop. Shift/Ctrl-click or long-press selects blocks (12% accent wash + ring, check in the margin, "N blocks selected · Delete · Move · Turn into" bar under the selection). Arabic blocks keep the handle on the right (the pane makes room when needed).
- **Block menu** (`components/BlockMenu.tsx`): Turn into glyph grid (text, H1–H3, lists, task, quote, code, toggle, 8 callouts; the current type is highlighted) + Duplicate · Copy link to block · Move up · Move down · Delete. Phone: sheet with a scrolling row of 48 px tiles.
- **Block references**: `[[Note#^` autocomplete lists the note's blocks (glyph, text, `^id` in green or "add id"); picking one without an id adds one. Arriving through a block link washes the block amber (fades over 1.2 s) in Read and in the editor.
- **Paste menu** (`components/PasteMenu.tsx`): long text → Keep · Clean up formatting · As quote · As link card (adds a card for the first link in the text; disabled when there is none) · Summarize · Make flashcards. Link alone on a line → Preview card · Embed · Plain link (remembered per domain). Both: "Esc · fades in 12 s".

## Read
- **Page width** switch in the header: Fixed (Aa › line width, 680 px by default) · Wide (920 px) · Full (the pane minus 72 px each side). Stored per note as front-matter `width: wide|full` (no key = fixed). In Fixed, tables break out of the text column by 60 px each side.
- Contents box `[[toc]]`: H2/H3 of the note; the section being read is bold (scroll spy).
- Callouts/panels use the callout glyphs (`c-note`, `c-info`, `c-tip`, `c-success`, `c-warning`, `c-danger`, `c-question`, `c-example`, `c-quote`, `c-abstract`); a callout with one short paragraph reads as one line: **Title** — text.
- Tables: header line "Caption · N rows" · Filter (becomes a field) · full screen (Esc / ✕ to leave); sticky header, zebra rows, click a header to sort (accent arrow), bold first column, sticky first column when the table scrolls sideways.
- Includes `![[Note#Heading]]` / `![[Note#^id]]`: dashed frame, source chip and **Go to source →** (opens the note scrolled to that section or block).

## New Markdown (all plain text, renders as text elsewhere)
| Syntax | Meaning |
| --- | --- |
| `:status[Text]{green\|amber\|red\|blue\|violet\|grey}` | status pill; `yellow`, `purple`, `gray`, `orange` still work as aliases; colour guessed from the text when omitted |
| `:glyph[name]` | a Lumen glyph inline (names from `lib/glyphs.ts`; unknown names stay as text) |
| `::: columns cards` (also `divided`, `boxed`) | same as `{.cards}`; in cards, a `####` heading is the card title |
| `::: column 240px` | fixed-width column (percentages still work) |
| `Table: Caption` on the line after a table (Pandoc) | the table's caption in its header line |
| `[[Note#Heading]]` | now opens the note scrolled to that heading |

Glyphs added to `lib/glyphs.ts` this round: `footnote`, `tag`, `columns-4`. Tests: `npx tsx scripts/editor-read.test.ts`; browser checks in the session `kj/` folder (`slashtest.mjs`, `blk-test.mjs`, `gallery.mjs`, `r4-md.mjs`).
