# Imports: Anki, Notion, Obsidian, Markdown

One **Import** dialog (`src/components/ImportDialog.tsx`) brings in Anki decks, Notion exports, Obsidian vaults and
plain Markdown. Everything runs in the browser; nothing is uploaded until normal sync. Each import is **one batch you
can undo**. Spec: `docs/design/CLAUDE_DESIGN_UPDATE_05.md` §4 (Claude Design is drawing the final dialog; this one is
the working round-4-style version).

Open it from: the **+ New** menu › *Import…*, **Ctrl+K** › *Import…*, or **Import & export** › *From another app*
(Anki / Notion / Obsidian buttons). The old Import & export dialog keeps `.md`, vault `.zip`, `.canvas` and the JSON
backup restore.

## Flow
1. **Source**: Anki deck · Notion export · Obsidian vault · Markdown files (cards with glyphs and file types). Recent
   imports are listed under the cards with **Undo import**.
2. **Pick**: drop zone (files, or a whole folder for Obsidian / Markdown), *choose a file*, *Choose folder*
   (`<input webkitdirectory>`).
3. **Reading** with progress.
4. **Preview**: counts (notes, attachments, cards, schedules, reviews, bases), the tree with checkboxes (folders select
   their contents), Anki note types with field mapping and *Keep review history*, Notion databases → bases, title
   conflicts (Skip / Rename / Merge, for all or per note), warnings, and the target (space, folder, *In a new folder*
   named after the source, on by default).
5. **Importing** with progress and Cancel (what was written so far stays one undoable batch).
6. **Result**: counts, **Open** (first imported note), **Undo import**, Done.
7. **Errors**: a readable message and *Choose another file*.

Phone: the same steps in a full-screen sheet (back chevron in the header, sticky footer).

## Code
| File | Role |
|---|---|
| `src/lib/import-model.ts` | Shared model (`ImportPlan`, `PlanNote`, `PlanCard`, `PlanReview`, `VFile`), zip / folder readers, HTML → Markdown, protobuf reader, image-size sniffing, preview tree. Pure. |
| `src/lib/import-anki.ts` | `.apkg` / `.colpkg` reader and mapping. Pure apart from the injected SQLite + zstd decoders. |
| `src/lib/import-notion.ts` | Notion "Markdown & CSV" export → notes + bases. Pure. |
| `src/lib/import-obsidian.ts` | Obsidian vault / Markdown folder → notes. Pure. |
| `src/lib/import-write.ts` | Conflicts, writing a plan as one tagged batch, undo, counts. Pure over an `ImportStore`. |
| `src/lib/import-db.ts` | Dexie `ImportStore` (all writes through `save()`), lazy Anki decoders, `readSource`. |
| `src/components/ImportDialog.tsx` | The dialog (lazy-loaded by `NewMenuHost`; `openImport(source?)` in `NewMenu.tsx`). |

Dependencies (lazy, only loaded when an Anki file is imported): **sql.js** 1.17 (SQLite WASM; `sql-wasm-browser.wasm`
~690 KB is bundled by Vite as an asset, not loaded from a CDN; JS ~62 KB) and **fzstd** 0.1.1 (zstd decoder, ~24 KB).
JSZip (already used) reads the zips.

## Anki
Package = zip. The collection is read from `collection.anki21b` (zstd-compressed SQLite, schema 18, Anki 2.1.50+),
else `collection.anki21`, else `collection.anki2` (in new exports `anki2` is only a "please update" placeholder; an
export with only that placeholder gives an error explaining how to re-export). Media: `media` is a JSON map
(`{"0": "cat.jpg"}`) or, in new exports, a zstd-compressed protobuf list whose entry *i* is zip file `i`; each media
file may itself be zstd-compressed (sniffed by magic bytes).

Note types come from the `notetypes` / `fields` / `templates` tables (schema 18; kind = protobuf field 1, 1 = cloze) or
from `col.models` JSON (`type: 1` = cloze). Decks come from `decks` (name parts joined by `\x1f`) or `col.decks`.

| Anki | Lumen |
|---|---|
| deck `A::B::C` | flashcards note **C** in folder `A/B` (one note per deck; a note lives in the deck of its first card; filtered decks → home deck) |
| Basic, custom types | `Front :: Back`; multi-line answers use `Front\n?\nBack lines`. The **field mapping** (preview) picks the front and back field per note type; defaults by field name (Front/Question/Term/Word, Back/Answer/Definition/Meaning) |
| Basic (and reversed) | two lines, `Front :: Back` and `Back :: Front` (*Reverse cards* toggle; "optional reversed" only where Anki made the reverse card) |
| Cloze | the Text field as one paragraph with `{{cN::…}}`; Back Extra as a quote under it |
| Image Occlusion (Anki 23.10+) | an ```` ```occlusion ```` block: one box per shape (`rect`, `ellipse`, `polygon` bounding box), shapes sharing a cloze number form a group; `oi=1` → `hide-all`; pixel coordinates (older versions) are normalised with the image size read from its header |
| field HTML | Markdown: bold/italic/lists/links/headings/code, `\(…\)` / `\[…\]` / `[latex]` → `$…$` / `$$…$$`; `<img>` and `[sound:…]` → attachments |
| tags (`a::b`) | the deck note's front-matter tags (`a/b`), union of its notes' tags |
| scheduling | `Card` records: due date kept (`due` = days since `col.crt` for review cards, epoch seconds for learning cards), interval, ease (factor / 1000), reps, lapses, state, suspended (`queue = -1`). FSRS stability / difficulty: Anki's own FSRS memory (`cards.data` `s` / `d`) when present, else a **replay** of the card's review log with FSRS-6 (`replayFsrs`, the same rules as `fsrs-optimize` `replayLoss`, using your fitted weights if you have them). New cards need no record. |
| review log | one `review` row per `revlog` entry (`ease` 1–4 → grade 0–3; manual reschedules (`ease 0`, type 4/5) skipped), `state` before the review, `elapsed` / `scheduled` in days. Settings › Review › *Optimize from history* can then fit weights to it. |

*Keep review history* off: every card starts new (no card records, no review rows).

Card keys follow `docs/FLASHCARDS.md` (`hash(question)`, `cz<n>-<hash>`, `oc-<id>-<box|g.group>`); after building each
deck note the importer re-parses it with `flashcards()` and keeps only schedules whose key really exists. Text that
would change meaning in a flashcards note is escaped (`==` → `=\=`, ` :: ` inside a question → ` : `).

Warnings: missing media, empty fronts, extra card templates (beyond front/back), repeated questions in one deck (one
shared schedule), old Image Occlusion add-on notes (imported as basic cards), occlusion notes without shapes.

## Notion
Export with **Markdown & CSV** (nested "Part" zips are unpacked). Ids (`Name <32 hex>`) are stripped from titles,
file and folder names.

- Pages → notes, the folder tree kept (`Page <id>.md` + `Page <id>/children`); the H1 is the title.
- Links to other pages (relative, URL-encoded `.md` paths, `../` too) → `[[Title]]` (or `[[Title|text]]`); links to a
  database CSV → `[[Database]]`. `notion.so` links to pages outside the export stay web links (warning).
- Images and files → attachments.
- `<aside>` callouts → `> [!note]` callouts; `<iframe>`/`<video>`/`<embed>` → a bare link + a warning.
- Databases (`DB <id>.csv`, or `_all.csv` when present) → a **base note** named after the database (in the database's
  parent folder) with a table view filtered by `file.inFolder("<full folder path>")`, columns in CSV order; its rows →
  notes in the folder `DB/`, body from the row page (the `Property: value` lines Notion writes under the H1 are
  removed), properties as front matter: dates → `YYYY-MM-DD`, Yes/No columns → `true`/`false`, a `Tags` column →
  Lumen tags, relations → `[[Page]]` links. Columns named like Lumen fields (Status, Type, Created, …) get a
  `notion-` prefix so the base shows Notion's values, not Lumen's.

## Obsidian vault and Markdown
Folder (picker or drop) or `.zip`. `.obsidian/`, `.trash/` and other dot-folders are skipped.

- Notes keep folders, `[[links]]`, tags (front matter + inline), front matter (YAML block lists are rewritten as flow
  lists `tags: [a, b]`, which Lumen reads). A `# Title` H1 (the file name) is added where the note doesn't start with it.
- `![[file.png]]`, `![[file.png|300]]`, `![alt](relative/path.png)`, `[[file.pdf]]` → attachments (resolved relative
  to the note, then from the vault root, then by file name like Obsidian). Markdown links to notes → `[[Title]]`.
  Code blocks are left alone.
- `.canvas` (JSON Canvas) and `.base` (Obsidian Bases) come over as they are. `.excalidraw.md` with a plain
  ```` ```json ```` scene → whiteboard; compressed drawings stay Markdown notes (warning).
- Files not linked from any note are left out (warning with the count).

**Markdown files** uses the same reader for loose `.md` files or a folder (no new folder by default).

## Conflicts
A conflict = an imported note whose title already exists in the target space (any folder, since links resolve by
title). **Skip** keeps the existing note; **Rename** imports it as "Title 2" and rewrites `[[Title]]` links in the
other imported notes; **Merge** appends the imported text (without its front matter and H1) to the existing note and
merges tags; undo restores the previous text. Choose for all, or per note.

## Undo
Every created record (notes, folders, attachments, cards, review rows) carries `lumenImport: <import id>` (a `lumen*`
key, synced as part of the record). *Undo import* marks them all `deleted: 1` (tombstones, so other devices drop them
too), drops the local attachment bytes and restores merged notes. The registry of the last 30 imports (id, source,
counts, merged notes' previous text) is local (`meta` key `imports`); undo is available from the result step and
from *Recent imports* in the dialog.

## Large imports
Writes go in batches (100 notes, 300 cards, 500 review rows per IndexedDB transaction) and yield to the UI between
batches; parsing yields every few hundred notes. Progress shows real counts.

## Limits
- Anki: one note per deck, so per-note Anki tags become deck-note tags; card templates beyond front/back aren't
  converted; the old Image Occlusion add-on (SVG masks) imports as basic cards; scheduling options (steps, limits)
  aren't imported; `.colpkg` imports like an `.apkg` (no profile settings).
- Notion: only the "Markdown & CSV" export (not HTML); formulas, rollups and views aren't kept (values are);
  synced blocks, embeds and comments aren't available in the export.
- Obsidian: plugin data (Dataview queries, Templater) stays as text; compressed Excalidraw drawings stay Markdown.
- Undo only covers records created by the import (and merged notes); notes edited after the import are still removed.

## Tests
`npx tsx scripts/import.test.ts` (107 checks): builds two tiny `.apkg` files with sql.js (schema 11 JSON and schema 18
with a hand-made zstd frame + protobuf media list), a nested Notion export zip and an Obsidian vault, and checks
mapping, links, cloze / occlusion conversion, schedules and review-log conversion, conflicts and undo against an
in-memory store. `FIXTURES=<dir>` also writes the fixture files (for browser checks).
