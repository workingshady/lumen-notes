# Imports: Anki, Notion, Obsidian, Markdown

One **Import** dialog (`src/components/ImportDialog.tsx`) brings in Anki decks, Notion exports, Obsidian vaults and
plain Markdown. Everything runs in the browser; nothing is uploaded until normal sync. Each import is **one batch you
can undo**. Spec: `docs/design/CLAUDE_DESIGN_UPDATE_05.md` §4 (Claude Design is drawing the final dialog; this one is
the working round-4-style version).

Open it from: the **+ New** menu › *Import…*, **Ctrl+K** › *Import…*, or **Import & export** › *From another app*
(Anki / Notion / Obsidian buttons). The old Import & export dialog keeps `.md`, vault `.zip`, `.canvas` and the JSON
backup restore.

## Flow (Claude Design round 5/6: "Lumen 26 Imports" + `ImportDesk`)
Desktop: a 960×640 modal with a 4-step indicator (Source · Preview · Target · Import) and a footer note + secondary +
primary button. Phone: full-screen steps, Back (←) and "Step N of 4" in the header, two equal 50 px buttons at the bottom.

1. **Source**: four cards (glyph, one-line result, accepted files); a card selects the source, **Next** opens the picker
   (folder picker for Obsidian / Markdown, file picker otherwise; "or choose a file" in the drop zone always picks files
   or a zip; double-click a card = Next). The **drop zone accepts any source and detects it** (`detectSource` /
   `detectSourceInZip`: `.apkg`, Notion 32-hex ids or `.html` pages, `.obsidian/`, `.canvas`, loose `.md`). Drag-over:
   amber dashed outline, "Drop to read <file>" and its size (when the browser exposes the file during the drag; else
   the item count). *Recent imports* (with Undo import) are listed under the drop zone.
2. **Reading**: the file is streamed (`File.stream()`), progress in MB ("58% · 14.2 of 24.6 MB"); folder files count as
   the parsers read them. Cancel drops the result.
3. **Preview**: left, the tree with checkboxes (folder = all its notes; mixed = "–"), counts per row and tags
   ("title exists", "→ base", "audio"); `.trash` notes are listed but unticked; vault attachments are listed as files and
   can be unticked (they are then not imported and their links stay as they are). Right, panels per source:
   - Obsidian / Markdown: **Same title already in Lumen · n** (per title Merge / Rename / Skip; an "All titles" row when
     there are more than 3), **Counts** (notes, canvases, attachments · size, links · tags), warnings.
   - Anki: **Note types found** (Basic → Front / Back, Cloze → `{{c1::…}}`, Image Occlusion → occlusion block),
     **Field mapping · <type>** per basic note type (each Anki field → Front / Back / Back · below a line / Not
     imported; Reverse cards when the type has two templates), **Options** (Keep review history, One note per sub-deck,
     Import N media files), warnings.
   - Notion: **Databases → bases** (each CSV with its row count and the chosen first view: Table / Board / Gallery /
     List / Calendar), **Can't be imported · n** (embeds by provider, other warnings), **Links** (page links → [[links]]).
4. **Target**: New space (default for vaults and Notion; named after the source, kind Resource), Existing space (pick
   one), or Inbox; **Folder inside the space** defaults to `Imported / <Source> <YYYY-MM-DD>` (`/` makes nested folders;
   empty = top level).
5. **Importing**: "812 of 1,284 notes", remaining time, and rows per kind (Notes, Canvases, Attachments, Links resolved)
   from `writePlan`'s `onCounts`. **Run in background** (or ×) closes the dialog; the import keeps running in a
   module-level job and a toast ("Import finished · N notes", Open) reports the end. Cancel stops after the current
   batch (what was written is still one undoable batch).
6. **Result**: title per source ("N notes / cards / pages imported"), "Into the new space “X”", stat tiles, a box with
   the titles handled ("Attention merged · Backpropagation renamed to “Backpropagation (2)” · AdamW skipped") or the
   Notion items skipped, all listed in the **Import report** note. **Undo import** (whole batch) and **Open**.
7. **Errors**: "This file couldn't be read" + the reason; a Notion **HTML** export (`ImportError` code `notion-html`)
   names the file and gives the exact steps (⋯ › Export › Export format Markdown & CSV › Include subpages › Export); a
   file that isn't an Anki package gives the Anki export steps. **Try another file** / Close.

All strings go through `t()` / `tx()` (Arabic in `src/i18n/ar/imports.ts`); the parsers' warnings and errors are
translated where they are produced. Layout uses logical properties, so the dialog mirrors in Arabic.

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
| deck `A::B::C` | flashcards note **C** in folder `A/B` (one note per deck; a note lives in the deck of its first card; filtered decks → home deck). *One note per sub-deck* off: one note per top-level deck with a `## B › C` section per sub-deck (schedules follow). *Import media files* off: images and sounds stay as their file name |
| Basic, custom types | `Front :: Back`; multi-line answers use `Front\n?\nBack lines`. The **field mapping** (preview) sets each field to Front, Back, Back · below a line (`extra`: under the back after a `***` rule) or Not imported; defaults by field name (Front/Question/Term/Word, Back/Answer/Definition/Meaning, Extra/Back Extra → below a line) |
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
- Embeds (iframes, and embed blocks exported as a bare `[url](url)` line for Figma, Loom, YouTube, Miro…) are counted
  by provider (`plan.stats`); they stay as links. Synced blocks have no marker in the export, so they can't be counted.
- An HTML export (`.html` pages, no Markdown) stops with the `notion-html` error and the export steps.
- Databases (`DB <id>.csv`, or `_all.csv` when present) → a **base note** named after the database (in the database's
  parent folder) with a table view filtered by `file.inFolder("<full folder path>")`, columns in CSV order (the preview can make the first view a
  Board grouped by the Status-like column, a Calendar on the first date column, a Gallery or a List: `withBaseView`); its rows →
  notes in the folder `DB/`, body from the row page (the `Property: value` lines Notion writes under the H1 are
  removed), properties as front matter: dates → `YYYY-MM-DD`, Yes/No columns → `true`/`false`, a `Tags` column →
  Lumen tags, relations → `[[Page]]` links. Columns named like Lumen fields (Status, Type, Created, …) get a
  `notion-` prefix so the base shows Notion's values, not Lumen's.

## Obsidian vault and Markdown
Folder (picker or drop) or `.zip`. `.obsidian/` and other dot-folders are skipped; `.trash/` notes are in the plan with
`off: true` (unticked in the preview). Attachments keep their vault path (`PlanAttachment.path`) for the preview tree.

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
A conflict = an imported note whose title already exists in Lumen (any space and folder: `conflictsAcrossSpaces`, the
dialog's default; without it only the target space). **Skip** keeps the existing note; **Rename** imports it as
"Title (2)" and rewrites `[[Title]]` links in the
other imported notes; **Merge** appends the imported text (without its front matter and H1) to the existing note and
merges tags; undo restores the previous text. Choose for all, or per note.

## Import report
`writePlan(…, { report: true })` writes a note **Import report** (or "Import report (2)") in the import folder: date and
source, counts, each title that already existed and what happened to it, and the warnings. It belongs to the batch, so
Undo removes it too.

## Undo
Every created record (the new space, notes, folders, attachments, cards, review rows, the report) carries `lumenImport: <import id>` (a `lumen*`
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
`npx tsx scripts/import.test.ts` (145 checks): builds two tiny `.apkg` files with sql.js (schema 11 JSON and schema 18
with a hand-made zstd frame + protobuf media list), a nested Notion export zip and an Obsidian vault, and checks
mapping, links, cloze / occlusion conversion, schedules and review-log conversion, conflicts and undo against an
in-memory store. Round 5/6 checks: source detection, Notion HTML error, embeds by provider, page-tree folding, first-view choice,
`.trash`, attachment files in the tree and unticking them, new space + dated folder + report + live counts + undo of all
of it, conflicts across spaces, "Title (n)" renames, Anki one note per top deck / media off / extra field.
`FIXTURES=<dir>` also writes the fixture files (for browser checks, incl. `html/Notion-export.zip`, an HTML export).
