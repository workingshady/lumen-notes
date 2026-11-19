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
| any other key, or `note.<key>` | front-matter property (`due`, `difficulty`, `course`, …) |

### Filters
A filter is one expression string, or a nested `and:` / `or:` / `not:` list of them.
- Comparisons: `prop == value`, `!=`, `>`, `>=`, `<`, `<=`. Dates compare by day.
- Functions: `prop.contains("x")`, `prop.startsWith("x")`, `prop.isEmpty()`, `file.hasTag("a", "b")` (nested tags
  match: `ml` matches `ml/cnn`), `file.inFolder("Week 1")`, `file.hasProperty("due")`. Prefix `!` negates.
- Values: `"text"` or `'text'`, numbers, `true`/`false`, `today()`, `now()`, `date("2026-11-13")`.
- Text compares case-insensitively; a list property (`[a, b]`) matches when any item matches.
- Expressions Lumen can't evaluate (formulas, arithmetic) are **ignored, never hide notes**, and are listed in a hint
  under the toolbar.

## Using it
- **View tabs** across the top; click the active tab (or ⋯) for View settings: name, layout, limit, calendar date
  property, duplicate, delete, *Edit YAML* (switches to the editor), *Download .base*. `+` adds a view.
- **Toolbar**: search (title, tags, properties, text; not saved), row count (`shown/total` when a limit cuts),
  Filter (this view + base filter, AND/OR), Sort (multi-key), Group / board columns, Properties (show/hide/reorder),
  **New** (creates a note pre-filled from the view's simple `==` / `hasTag` filters and opens it).
- **Table**: sticky header and sticky title column, horizontal scroll on phones, click a header to sort, drag a header
  edge to resize (saved as `columnSize`), group headers with counts. Click a row to open the note. Inline edit:
  status/type/space (select), tags (comma list), any front-matter property (text; date picker for date-like keys).
- **Board**: one column per value of the group property (all four statuses are always shown for `status`). Drag a card
  to another column to change that property (mouse: drag; touch: long-press then drag; the board auto-scrolls at the
  edges). Columns scroll-snap on phones (swipe between them). `+` in a column creates a note with that value.
  Notes in several groups: see below.
- **Notes in several groups**: when the group property has several values (tags, a list front-matter property such as
  `courses: [CS231n, fast.ai]`), the note shows in **each** group, in tables, boards, galleries and lists. Tables put an
  "also in N groups" marker on the row (hover for the group names). Boards show the same card in each column; every
  copy after the first is drawn dashed with "Copy · also in #llm". Dragging one copy changes only that value and says
  so in a toast: "Moved from #cv to #nlp, still in #llm" (dropping on a column the note is already in just removes the
  dragged value). The Group / Columns sheet has *Notes with several values: show in each group / first group only*,
  stored as `groupMulti: each | first` on the view (default `each`; kept when Lumen rewrites the YAML).
- **Gallery**: cards with an excerpt (or a `cover:`/`image:` URL) and the shown properties. **List**: compact rows.
- **Calendar**: month grid (Monday first) by `date:` (default `file.ctime`). Drag a note to another day to change a
  front-matter date; tap a day to list its notes. Notes without a date are counted below the grid.

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
