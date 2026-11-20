# Smart folders (saved searches)

A **smart folder** is a saved search. It shows up in the sidebar (and in the phone folders sheet) with its own glyph,
colour and a live count; opening it lists the matching notes in the note list. Smart folders never move notes: a note
can be in any number of them.

Code: `src/lib/smart.ts` (format, query, matching, "Save as base"), `src/components/SmartFolders.tsx` (sidebar
section, editor sheet, note-list search box, phone rows). Tests: `npx tsx scripts/smart-folders.test.ts`.

## Creating one
- **Search palette** (Ctrl/Cmd K): type a search, then pick **Save search as smart folder**. When the palette is
  scoped to the current space, `space:<name>` is added so the folder keeps that scope.
- **Note list search box** (desktop, under the list header): type a filter, then the bookmark button. The current
  scope (space, folder, tag, list filter) is added as operators.
- **Sidebar** › Smart folders › **+** (starts from the current scope).
- **Phone**: folders sheet › Smart folders › **+**, or from the search screen.

The editor has: name, search, optional **filter rows** (Bases expressions, combined with All / Any), glyph, colour,
pin, a live preview of the first matches, **Save as base** and Delete (with Undo).

Sidebar row menu (⋯ or right-click): Edit, Rename (or double-click the name), Pin to top / Unpin, Move up / down,
colour, Save as base, Delete (Undo in the toast). Pinned folders are listed first; Move up/down reorders within the
pinned and unpinned groups.

## Query syntax
Everything the search palette understands:

| Operator | Meaning |
|---|---|
| `tag:#llm` or `#llm` | has the tag (nested tags match: `ml` matches `ml/cnn`) |
| `type:lesson` | note type |
| `status:learning` (`status:none`) | status |
| `in:week` | folder name (any ancestor) contains the text |
| `space:"machine learning"` | space name contains the text |
| `is:pinned` `is:fav` `is:published` | flags |
| free words | every word appears in the title or body (Arabic-normalized, case-insensitive) |

Smart-folder-only operators:

| Operator | Meaning |
|---|---|
| `due:overdue` `due:today` `due:week` `due:month` | front-matter `due` (or `deadline`): before today / today / next 7 days / next 31 days |
| `due:none` `due:any` `due:<2026-12-01` (`<=` `>` `>=` `=`) | no due date / any due date / compared with a date |
| `has:links` `has:backlinks` `has:tasks` `has:tags` `has:status` | the note links out / is linked to / has open tasks / … |
| `has:<property>` / `no:<property>` | a front-matter or record property is set / not set (`no:` works for the specials too) |
| `updated:7d` `updated:>30d` `created:2w` | changed within / more than a span ago (`d` days, `w` weeks, `m` 30-day months) |

Examples: `tag:#llm status:learning`, "Lessons due this week" = `type:lesson due:week`,
"PDFs with no notes" = `type:pdf no:backlinks`, "Stale drafts" = `status:todo updated:>30d`.

Filter rows use the Bases syntax (`docs/BASES.md`): `due < today()`, `file.hasTag("ml")`, `difficulty >= 3`,
`!course.isEmpty()`. Expressions Lumen can't evaluate are ignored (they never hide notes).

## Stored format (synced)
Smart folders are stored as a JSON array in the **Inbox space** record, property `lumenSmartFolders`
(`space.props.lumenSmartFolders`). Spaces sync through `/api/sync` like every other record, so the list is the same
on every device. The key is under the `lumen*` prefix (Lumen-specific
data, see the rules in `CLAUDE.md`).

```json
[
  { "id": "sf-k2j9x0aa", "name": "LLM, learning", "query": "tag:#llm status:learning", "glyph": "book", "color": "5", "pinned": true, "sort": 0 },
  { "id": "sf-p01mz9qq", "name": "Lessons due this week", "query": "type:lesson due:week", "sort": 1 },
  { "id": "sf-a8c7d6e5", "name": "Hard ones", "query": "status:review", "filters": ["difficulty >= 4", "due < today()"], "match": "or", "sort": 2 }
]
```

| Field | |
|---|---|
| `id` | stable id (`sf-` + random) |
| `name` | shown name |
| `query` | search query (syntax above) |
| `filters` | optional Bases filter expressions; `match`: `"and"` (default, omitted) or `"or"` |
| `glyph` | `search` (default) `star` `book` `flag` `clock` `file` `tag` `bolt` `inbox` `layers` |
| `color` | colour preset key `"1"`–`"6"` (same presets as folders) or a CSS colour; omitted = none |
| `pinned` | listed first |
| `sort` | order within the pinned / unpinned group |

Why the Inbox space: it always exists, it already carries vault-wide settings (blog licence, RSS), and a space record
never shows up in note lists, search, the graph or unlinked mentions (a hidden note would have to be filtered out
everywhere). The trade-off: sync is last-write-wins per record, so editing smart folders on two devices at the same
moment keeps the later list.

The note list shows a smart folder through the UI filter `filter: "smart:<id>"` (`src/lib/store.ts`); every other
navigation sets `filter` and so leaves the smart folder.

## Save as base
**Save as base** creates a new base note (`type: base`, `docs/BASES.md`) in the Inbox with the same filters:
`tag:` → `file.hasTag(...)`, `type:` / `status:` → `==`, `in:` → `file.folder.contains(...)`, `space:` →
`space.contains(...)`, `due:` and `updated:` / `created:` → date comparisons (relative spans are written as fixed
dates from the day you save), `has:x` / `no:x` → `!x.isEmpty()` / `x.isEmpty()`, filter rows as they are.
Free words become `file.name.contains(...)` (Bases filter on properties, not on full text). Parts with no Bases
equivalent (`is:` flags, `has:`/`no:` links, backlinks, tasks) are listed in the note's first paragraph and in the
toast.
