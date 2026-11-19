# Bases (database views of notes)

A **base** is a note of type `base` that shows other notes as a database: **Table**, **Board**, **Gallery**,
**List** or **Calendar**, with filters, sort, grouping and a search box. It works like
[Obsidian Bases](https://help.obsidian.md/bases/syntax) and Notion database views. The definition is plain YAML
inside the note, in the same shape as an Obsidian `.base` file, so it stays readable and portable.

Code: `src/lib/base.ts` (YAML subset, filters, query, grouping), `src/views/BaseView.tsx` (UI),
templates `base` and `base-lessons` in `src/lib/templates.ts`. Demo: dev simulator scenario **Learning paths**
(`lp-base` note).

## Creating one
- Desktop: the table icon in the note list header (or right-click the new-note button) opens *New from template*.
  Base templates are listed first: **Base (database view)** and **Lessons by status × course**.
- Phone: *New from template · base* at the end of the note list.
- Or type the YAML yourself in any note and add `type: base` to its front-matter.
- **New base · template picker** (design R4-18T): a freshly created, untouched base (the default template, or a base
  note with an empty body) opens on *New from template*: **Base (database view)** (empty table of all notes),
  **Lessons by status × course** (board by status, filtered to lessons, plus Table / Gallery / List / Calendar views),
  **Due this month** (calendar by `due`), **Cards by deck** (table of flashcard notes), **Reading list** (PDFs with
  progress) and **Dashboard** (turns the note into a dashboard with starter tiles). *Create base* writes the template's
  YAML into the note (and its title when the note is still "New base"); *Cancel* keeps the note as it is. Templates:
  `BASE_TEMPLATES` in `src/lib/base.ts`.

## Stored format
~~~markdown
---
type: base
---
# Lessons by status × course

Optional prose.

```base
filters:                 # applies to every view
  and:
    - type == "lesson"
    - '!file.hasTag("archived")'
views:
  - type: board          # table | board | cards | list | calendar
    name: By status
    groupBy:             # board columns / table / gallery groups
      property: status
      direction: ASC
    order: [file.name, space, due]   # visible columns / card fields, in order
  - type: table
    name: By course
    filters:             # extra filters for this view only
      or:
        - due >= today()
        - due.isEmpty()
    sort:
      - property: file.mtime
        direction: DESC
    limit: 50
    columnSize: { file.name: 260 }
  - type: calendar
    name: Due dates
    date: due            # Lumen key: which date property places notes on the calendar
  - type: board
    name: By tag
    groupBy: { property: file.tags }
    groupMulti: each     # Lumen key: notes with several values show in each group (each, default) or the first only (first)
```
~~~
The YAML can also be the whole body after the front-matter and H1 (like a raw `.base` file pasted in).
Keys Lumen doesn't use (`formulas`, `summaries`, `properties`, view options from Obsidian) are kept when Lumen
rewrites the block. Lumen rewrites the block (normalized YAML, comments dropped) whenever you change a view from the
toolbar. *View settings › Download .base* saves the YAML as an Obsidian `.base` file.

### Properties
| Name in YAML | Meaning |
|---|---|
| `file.name` | title (always the first, sticky table column; opens the note) |
| `file.ctime` / `file.mtime` | created / updated |
| `file.tags` | tags (front-matter + inline `#tags`) |
| `file.folder` | folder path (`Parent/Child`) |
| `type`, `status`, `space` | Lumen record fields (`space` = the space name, i.e. the course) |
| `course` | front-matter `course`, else the space name |
| `cards` | number of flashcards made from the note (computed; a front-matter `cards` key wins; read-only) |
| any other key, or `note.<key>` | front-matter property (`due`, `difficulty`, …) |

### Filters
A filter is one expression string, or a nested `and:` / `or:` / `not:` list of them.
- Comparisons: `prop == value`, `!=`, `>`, `>=`, `<`, `<=`. Dates compare by day.
- Functions: `prop.contains("x")`, `prop.startsWith("x")`, `prop.isEmpty()`, `file.hasTag("a", "b")` (nested tags
  match: `ml` matches `ml/cnn`), `file.inFolder("Week 1")`, `file.hasProperty("due")`. Prefix `!` negates.
- Values: `"text"` or `'text'`, numbers, `true`/`false`, `today()`, `now()`, `date("2026-11-13")`.
- Text compares case-insensitively; a list property (`[a, b]`) matches when any item matches.
- **Filter popover** (design R4-18A): rows read like a sentence, *Where · property · operator · value · ×*, joined by
  *and* (click it to switch the whole list to *or*). Operators: is, **is any of**, is not, contains, does not contain,
  starts with, > ≥ < ≤, is empty, is not empty, has tag, does not have tag, in folder. *is any of* is stored as
  `or: [status == "learning", status == "review"]` (an `or:` of `==` on one property is read back as one row).
  *+ Add group (any of)* adds a nested `or:` list (one level; deeper nesting stays as read-only YAML rows). A switch at
  the top edits *This view* (`views[].filters`) or *All views* (the top-level `filters`).
- Expressions Lumen can't evaluate (formulas, arithmetic) are **ignored, never hide notes**, and are listed in a hint
  under the toolbar.

## Using it
Layout: `design/handoffs/2026-11-19-round-4/BaseDesk.dc.html` (Lumen 18, R4-18A..J). Glyphs: `base`, view glyphs
`v-table v-board v-gallery v-list v-calendar`, status glyphs `s-todo s-learning s-revise s-mastered`.
- **Header**: base glyph, title, **New <type>** (the type implied by the view's filters, e.g. *New lesson*; creates a
  note pre-filled from the view's simple `==` / `hasTag` filters and opens it; on phones it is in View settings).
- **View tabs** with view glyphs; click the active tab (or ⋯) for **View settings** (a popover; a sheet on phones):
  Name, Layout, Group by (Date property for calendars), Several values, Limit, then Duplicate view, Edit YAML (switches
  to the editor), Download .base, Delete view. `+` adds a view.
- **Toolbar** pills with counts: Filter (n conditions), Sort (n keys), Group (`Group: status` when set), Properties
  (n shown), ⋯, a search pill (title, tags, properties, text; not saved), and the count on the right:
  "38 notes · filtered", or "18 notes · 4 shown in several groups". Each pill opens an anchored popover on desktop and a
  sheet on phones (phones show Filter / Sort / Group; Properties and Search are in View settings).
- **Table**: bordered table, sticky header and title column (note-type glyph + title), horizontal scroll on phones,
  click a header to sort (the sorted header is ink with an arrow), drag a header edge to resize (saved as
  `columnSize`), group headers with counts. Status cells are glyph pills; course / space cells carry the course colour
  bar (the space's canvas colour, else a stable preset from the name); tags are chips; dates show "24 Nov".
  **Cell editors** (R4-18B): status opens a glyph menu (Todo, Learning, To revise, Mastered, No status; arrows +
  Enter work), space / type a select, dates a date picker, tags and list properties a chip input (Enter or comma adds,
  Backspace removes the last), other properties a text input. Title, created, updated, folder and cards are read-only.
- **Board** (R4-18C/H): one column per value of the group property (all four statuses are always shown for `status`;
  status columns get their glyph, other columns a colour bar). Cards: title, course bar + course, other shown
  properties. Drag a card to another column to change that property (mouse: drag; touch: long-press then drag; the
  board auto-scrolls at the edges): the dragged card tilts with an amber outline, its origin fades, the target column
  gets a faint amber ring and a dashed amber drop slot. Every move shows a toast with **Undo** (restores the previous
  value). Phones show one column at a time (swipe). `+` in a column header creates a note with that value.
  Notes in several groups: see below.
- **Notes in several groups**: when the group property has several values (tags, a list front-matter property such as
  `courses: [CS231n, fast.ai]`), the note shows in **each** group, in tables, boards, galleries and lists. Tables put an
  "also in N groups" chip on the row (hover for the group names). Boards show the same card in each column with an
  "also in #llm" (or "also in 2 groups") chip. Dragging one copy changes only that value and says so in a toast:
  "Moved from #cv to #nlp, still in #llm" with Undo (dropping on a column the note is already in just removes the
  dragged value). The Group popover and View settings have *Several values: show in each group / first group only*,
  stored as `groupMulti: each | first` on the view (default `each`; kept when Lumen rewrites the YAML).
- **Gallery** (R4-18D): cover = a `cover:` / `image:` / `banner:` / `thumbnail:` URL, else the first image in the note,
  else a striped placeholder; title (two lines max); status glyph + label · course. 4 columns on desktop, 2 on phones.
- **List** (R4-18E): the densest view: status glyph, title, course, date (the view's `date:` or the first date
  property shown), under uppercase group headers when grouped.
- **Calendar** (R4-18F): month grid (Monday first, 5 or 6 weeks filling the height) by `date:` (default `file.ctime`);
  month name with ‹ Today › in the toolbar. Items carry the course colour bar. Drag a note to another day to change a
  front-matter date (toast with Undo); tap a day to list its notes. Notes without a date are counted below the grid.

All writes go through `updateNote` (record + front-matter stay in sync; the same path as the Properties panel), and
view changes rewrite only the ```` ```base ```` block of the base note.

## Limits
- Formulas, summaries, the `map` view and Obsidian's `this` context are not evaluated (kept in the YAML).
- `created` / `updated` / `folder` / `title` are read-only in cells and can't be dragged to.
- Bases query the whole vault (all spaces); narrow with `space == "…"` or `file.inFolder(…)`.
- Editing from the toolbar re-serializes the YAML: comments and custom formatting inside the block are lost.
- `.base` files can be downloaded, but importing a `.base` file is not wired into Import yet (paste its YAML into a
  base note instead).
- The table renders 200 rows at a time (*Show more*); boards show up to 300 cards per column.
