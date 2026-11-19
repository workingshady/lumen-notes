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
the first free spot. A top-level `range:` (e.g. `range: 8w`, set by the range picker in the top bar) replaces the
range of every chart over time (bar / stacked / line / area on a date axis); numbers, rings, heatmaps and tables keep
their own. Layout units: a row is 68 px with 14 px gaps, so `h: 2` = a 150 px tile and `h: 4` = 314 px.

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
| `delta` | number: `false` hides the "+8 vs last week" delta (shown when a past `range` is set); `percent` shows it as "−18%" |
| `better` | number: `down` when a lower value is good (cards due); the delta is green when it moves the good way, red otherwise |
| `caption` | number: the line under the value (default "of 101 in AI Engineer" for a filtered count, else the range: "this week") |
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
Layout: `design/handoffs/2026-11-19-round-4/DashDesk.dc.html` (Lumen 18, R4-18K..Q).
- **Top bar**: dashboard glyph + title, the range picker ("Tile ranges" = each tile's own, or Last 7 days … Last
  year, stored as `range:`), **Edit layout** / Done, **YAML** (switches to the editor), **Add tile**.
- **Add tile** (a dialog with steps 1 Source · 2 Chart · 3 Fields and a live preview on desktop): 1. what the tile
  counts (Study sessions, Flashcards, A learning path, A base view, Notes; path / base pickers appear on the chosen
  card), 2. chart type (Number, Bar, Stacked, Line, Area, Donut, Ring, Table, Heatmap, List as glyph tiles),
  3. fields: Title, X axis, Bucket, Value, Series, Range, Filter, Filled part (ring), Delta + Up/Down is good and
  Caption (number), Running total (line / area), Columns (table / list). Back / Next / *Add to dashboard*. Edit a
  tile from its ⋯ menu (Edit tile, Show as table, Duplicate, Move or resize, Delete); editing opens on step 3.
- **Edit layout** shows the 12 columns as faint stripes. Drag a tile to move it, its amber corner to resize it; the
  selected tile gets the amber outline. Other tiles move down out of the way and everything floats up. Keyboard:
  focus a tile, arrows move, Shift+arrows resize.
- **Data table**: the *Table* toggle in each chart tile's header (also in ⋯) swaps the chart for a table with exact
  values ("· as table" is added to the title).
- **Charts**: hover or focus a column / slice / day for exact values; Tab reaches each chart, arrows move between
  points (Home / End jump). Multi-series charts get a legend under the chart.
- **Phone**: two columns: number tiles (up to 4 columns wide) take one, everything else spans both; moving and
  resizing is desktop-only.
- **YAML**: the toolbar's YAML button switches to the editor (Read mode switches back).

## Chart style
- Series colors are the six canvas presets in a fixed order: purple 6, cyan 5, orange 2, green 4, yellow 3, red 1,
  as CSS variables `--chart-c1..6` (darker steps on light themes). Course series use their space's canvas color.
  Statuses use the status tokens (todo muted, learning info, review warning, mastered success).
  The presets are not fully colorblind-safe past four series (green / orange / red), so charts always carry
  a legend (multi-series), exact tooltips and the data table.
- Chart tiles (design Lumen 18 / 21): no y axis (exact values are in tooltips and the data table); bars sit on one
  baseline with 6 px gaps and 3 px top corners, stacked fills touch; lines are 2 px with three quiet gridlines, the
  first series filled at 18 % (area) and comparison series dashed (5 4); thinned x labels at 10.5 px.
- Numbers: 34 px value, delta in 12.5 px semibold (green good / red bad), caption muted. Ring: the share and
  "41 / 101" inside, filled in the success colour. Donut: total inside, legend with values.
- Heatmap: weeks as columns filling the tile, one hue (purple, `--chart-c6`), steps 35 / 65 / 100 % over surface-2.
- Text in charts uses ink / muted tokens, never the series color.

## Limits
- Aggregation runs in the browser over the local vault (fine for tens of thousands of records).
- No formulas, no dual axes, max 6 series and 12 categories per chart (rest folded into "Other"; `limit` changes it).
- Card history isn't stored (only the current state), so "reviews per day" isn't available; `lastReview` is.
- Dropping a tile on a narrower layout keeps its width; tiles never overlap but can leave a gap until moved.
