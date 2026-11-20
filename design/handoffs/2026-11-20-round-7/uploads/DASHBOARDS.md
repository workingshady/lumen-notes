# Dashboards (chart tiles over your notes, cards and sessions)

A **dashboard** is a note of type `dashboard` that shows a 12-column grid of tiles: numbers with a delta, bar, stacked
bar, line, area and donut charts, a study heatmap, a progress ring, a mini table and a list. Each tile reads one
**source** (flashcards, study sessions, a learning path, notes narrowed by a Bases filter, or a base view) and
aggregates it. The definition is plain YAML inside the note, so it stays readable and portable.

Code: `src/lib/dashboard.ts` (format, grid layout, sources, aggregation; pure), `src/components/charts/*` (hand-written
SVG charts), `src/views/DashboardView.tsx` (grid, drag / resize, tile editor). Template **AI Engineer path dashboard**
(`dashboard-path` in `src/lib/templates.ts`). Demo: dev simulator scenario **Learning paths** (`lp-dash` note).
Tests: `npx tsx scripts/dashboards.test.ts`.

## Stored format
~~~markdown
---
type: dashboard
---
# AI Engineer path

Optional prose.

```dashboard
tiles:
  - id: minutes                  # stable id (generated when missing)
    title: Minutes per course per week
    type: stackedBar             # number | bar | stackedBar | line | area | donut | heatmap | ring | table | list
    source: sessions             # cards | sessions | notes | path | path:<path title> | base:<base title>
    x: at                        # category or date field (alias: groupBy)
    bucket: week                 # day | week | month (date x only; automatic when left out)
    y: minutes                   # value field for sum / avg / min / max
    aggregate: sum               # count (default without y) | sum (default with y) | avg | min | max
    series: course               # optional second dimension (stacked / grouped bars, several lines)
    range: 12w                   # 7d, 30d, 12w, 6m, 1y (past, ending today), next 14d (future), all (default)
    layout: { x: 0, y: 0, w: 8, h: 4 }   # grid cell: column 0–11, row, width 1–12, height in rows (76 px)
  - title: Concepts mastered
    type: number
    source: path:Deep learning, end to end
    filter: mastered == true     # any Bases filter expression or and:/or:/not: tree
    layout: { x: 8, y: 0, w: 4, h: 2 }
```
~~~
The YAML can also be the whole body after the front-matter and H1 (it must start with `tiles:`). Keys Lumen doesn't
know (on the dashboard or on a tile) are kept when Lumen rewrites the block. Lumen rewrites the block (normalized YAML,
comments dropped) when you move, resize, add, edit, duplicate or delete a tile. Tiles without `layout` are placed at
the first free spot.

### Tile keys
| Key | Meaning |
|---|---|
| `type` | `number`, `bar`, `stackedBar`, `line`, `area`, `donut`, `heatmap`, `ring`, `table`, `list` (`pie` → donut, `progress` → ring) |
| `source` | see *Sources* |
| `view` | for `base:` sources: the view name (default: the first view) |
| `filter` | Bases filter on the source's records (`state == "review"`, `course == "CS231n"`, `mastered == true`, `file.hasTag("ml")`, …) |
| `x` / `groupBy` | category field (multi-value fields put a record in each category) or a date field (bucketed) |
| `bucket` | `day`, `week` (Monday), `month` |
| `y`, `aggregate` | value: `count` of records, or `sum` / `avg` / `min` / `max` of a number field |
| `series` | split each category by this field (max 6 series; the rest fold into "Other") |
| `range` | `Nd`, `Nw`, `Nm`, `Ny` = the last N days/weeks/months/years ending today; `next Nd` = the future; empty = all |
| `cumulative` | `true`: running total (line / area). Starts from everything before the range. |
| `part`, `target` | ring: the filled share is the records matching `part` (a filter), out of `target` or of all records |
| `delta` | number: `false` hides the "+8 vs last week" line (shown when a past `range` is set) |
| `fields`, `sort`, `limit` | table / list: record fields to show, sort field (`-field` = descending), row count |
| `unit` | value unit shown in labels (`min` formats as `1h 20m`; sessions minutes default to `min`) |
| `colors` | series / slice colors: `{ CS231n: 5, review: "#E3B341" }` (canvas preset 1–6 or a hex) |
| `layout` | `{ x, y, w, h }` on the 12-column grid |

### Sources
| Source | Records and fields |
|---|---|
| `cards` | one per flashcard: `dueOn` (due date; overdue cards count today; new and suspended cards have none), `due`, `state` (new, learning, relearning, review, suspended), `course` (the note's space), `note`, `interval`, `reps`, `lapses`, `stability`, `difficulty`, `lastReview`, `suspended` |
| `sessions` | one per study-timer session: `at`, `minutes`, `course`, `note`, `weekday`, `hour` |
| `path` / `path:<title>` | one per concept of a learning path (bare `path` = the most recently edited one): `concept`, `stage`, `status` (locked, todo, learning, learned, mastered), `learned`, `mastered`, `reviewDue`, `learnedOn`, `review`, `due`, `interval`, `courses` |
| `notes` | every note matching `filter` (full Bases semantics): `title`, `type`, `status`, `tags`, `space`, `folder`, `created`, `updated`, plus every front-matter property |
| `base:<title>` | the notes a base view shows (its filters, not its limit), with the same fields as `notes` |

`learnedOn` is the concept's `done:` date, else its first review date (`review` minus `interval`), else the date of the
course roadmap that finished it.

## Using it
- **Add tile** (toolbar): 1. source (sessions, flashcards, a learning path, a base view, notes), 2. chart type,
  3. fields (title, x, bucket, value, series, range, filter, running total, ring part, table fields), with a live
  preview of the tile. Edit a tile from its ⋯ menu (Edit, Duplicate, Delete).
- **Move**: drag a tile by its grip (top-left); **resize**: drag its bottom corner. Other tiles move down out of the
  way and everything floats up. Keyboard: focus the grip, arrows move, Shift+arrows resize.
- **Data table**: the table icon on each chart tile swaps the chart for an accessible table with exact values.
- **Charts**: hover or focus a column / slice / day for exact values; Tab reaches each chart, arrows move between
  points (Home / End jump). Lines label their ends directly (up to 4 series); bars and stacked bars get a legend.
- **Phone**: tiles stack in one column (top to bottom, then left to right); moving and resizing is desktop-only.
- **YAML**: the toolbar's YAML button switches to the editor (Read mode switches back).

## Chart style
- Series colors are the six canvas presets in a fixed order: purple 6, cyan 5, orange 2, green 4, yellow 3, red 1,
  as CSS variables `--chart-c1..6` (darker steps on light themes). Course series use their space's canvas color.
  Statuses use the status tokens (todo muted, learning info, review warning, mastered success).
  The presets are not fully colorblind-safe past four series (green / orange / red), so charts always carry
  a legend or direct labels, 2 px gaps between stacked fills, exact tooltips and the data table.
- Quiet horizontal gridlines, one y axis from zero, whole-number ticks for counts, thinned x labels.
- Heatmap: one hue (cyan), five steps from the surface; empty days stay surface-2.
- Text in charts uses ink / muted tokens, never the series color.

## Limits
- Aggregation runs in the browser over the local vault (fine for tens of thousands of records).
- No formulas, no dual axes, max 6 series and 12 categories per chart (rest folded into "Other"; `limit` changes it).
- Card history isn't stored (only the current state), so "reviews per day" isn't available; `lastReview` is.
- Dropping a tile on a narrower layout keeps its width; tiles never overlap but can leave a gap until moved.
