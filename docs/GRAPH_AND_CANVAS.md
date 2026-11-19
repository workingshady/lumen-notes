# Graph & connections (round 4, design 14b / 04 / 20b)

## Notes graph (`src/views/GraphView.tsx`)
- **Display panel** (desktop floating, collapses to an icon; phone = bottom sheet with Edges, link chips, Tidy up first):
  filter, Tags as nodes, Orphans, Journal notes, Colour by, Local graph depth, **Layout** (Free · Top-down · Radial),
  **Edges** (Curved · Elbow · Straight), **Show links** (Links · Note to tag · Shared tags, with counts),
  **Declutter** (Dim notes outside focus, Keep pinned notes, Spacing Compact/Roomy), **Checks** (orphans, broken
  `[[links]]` with a clickable list), colour legend, **Tidy up ⇧T**. Reset restores defaults and live physics.
- Choices are saved in `localStorage["lumen.graphDisplay"]` (JSON `{layout, edges, links, tagNodes, shared, dim,
  keepPinned, spacing}`); `lumen.graphTags` (`off|nodes|shared|both`) is still written for older builds.
- **Tag nodes** (20b): 22px ring in `--link` with a muted `#`; tag edges dashed 4 4 in `--link`; Link/Tag legend
  bottom-left when the panel is closed. Tag card: Show notes (Notes list filtered by the tag) / Filter graph (`tag:#x`).
- **Tidy up**: always a preview banner (moves N · crossings before → after · pinned kept) → Apply (toast with Undo)
  or Cancel/Esc. Free = force layout + overlap removal, Top-down = layered (tags head their notes), Radial = rings
  around the local centre / selection. A tidied view is fixed (no physics); dragging a node then pins it (amber dot).
  Tidied positions are kept per view for the session (module memory, not stored in notes). Choosing Free returns
  to live physics (undoable).
- Big vaults: the global graph shows the 300 most linked of 700+ notes first (`lib/big-vault.ts`), "Show all".
- Export (SVG/PNG/…) uses the on-screen edge shape and tag styling.

## Big graphs and big data (round 6 · Lumen 32 / 22)
- **Ask first** (`src/views/graph-big.tsx`, hooked in `GraphView.tsx`): above `graphAsk` notes (Settings › Diagrams › Advanced › Big-data limits, `src/lib/scale-prefs.ts`, default 300) the graph shows a cheap dot backdrop and the “too big” card: Full graph (the original view, always first), Grouped by folder (pre-selected suggestion), Tree, Filter first. “Remember my choice for this space” stores `graphChoice[space]`; `graphDefault` (Full / Grouped / Tree / Ask) applies when nothing is remembered. The view switch (Full · Grouped · Tree · Local · Filter) stays in the top bar.
- **Grouped**: one circle per group — spaces in an all-spaces scope, else top folders, else child folders after *Open group* (drill path shown top-left). Circle size ∝ √notes, line width ∝ links between groups, laid out once with d3-force. Click = summary card (top 3 most-linked notes, strongest neighbour “118 links to 04 NLP”), *Open group* drills in (a folder without sub-folders draws its notes with `in:"folder"`), *As tree* opens the tree there. Zoom bar + minimap.
- **Tree**: space → folders → notes left to right, counts on every branch, a branch shows 8 notes (most-linked first) then “+ N more” (+`pageSize` per click); branches fold. Zoom bar + minimap (click to jump).
- **Filter first**: nothing is drawn until a query (`tag:`, `in:`, `status:`, words) is typed.
- **Full graph above the threshold**: labels only on the 30 most-linked notes, the rest on zoom. **Slow devices**: `reportDrawTime()` — two draws over 120 ms switch on Reduce effects once (no easing animation, labels on zoom) and the graph says so (“Simple view…” + Change).
- Elsewhere: Folders view (`src/views/FoldersView.tsx`, palette › Folders), compact skill tree (`src/views/path-compact.tsx`, paths over 100 concepts), month headers + date scrubber (`src/components/date-scrubber.tsx`), palette “Showing 50 of N” + narrowing chips (`narrowingFilters` in `src/lib/search.ts`), backlinks grouped by folder (`grouped-links.tsx`), long notes (`long-read.tsx`), Read-mode table paging (`src/lib/table-pager.ts`), review backlog (`review-backlog.tsx`), Today over budget (`today-overplan.tsx`), first sync notes-first (`lib/sync.ts` `firstSync`, `/api/sync` accepts `kinds`), uploads pause at 98 % of storage (`lib/attachments.ts`), lazy Media tab (`lazy-more.tsx`).

## Layout engine (`src/lib/graph-layout.ts`)
`tidy(nodes, edges, {mode: layered|radial|force, dir, spacing, center, keepPinned})` → positions + stats. Layered =
DFS cycle breaking, longest-path layers, dummy nodes for ordering, barycenter sweeps (Fenwick crossing count), median
placement, wide layers wrapped into sub-rows; components packed, isolated nodes in a grid; pinned nodes fixed and
others pushed off them. Tests: `npx tsx scripts/graph-layout.test.ts`.

## Canvas (`src/components/CanvasEditor.tsx`, `src/lib/canvas.ts`)
- **Tidy up** (Arrange group, ⇧T, also `canvas.layout("tidy")` in scripts): groups laid out as compound nodes and
  resized around their cards, edges lifted between levels, layered left → right, edge sides straightened; preview
  banner + Undo toast.
- **Pin** (Arrange): writes `"lumenPinned": true` on the card (JSON Canvas extension field; other readers ignore it).
  Pinned cards show an amber pin and never move in Tidy up.
- **Edges** shape (⋯ menu): Curved / Elbow / Straight, a per-canvas view choice in `localStorage["lumen.canvasEdges.<id>"]`
  (not written to the file).
- **Connection check** on connect: a card can't link to itself; a second edge between the same two cards is refused
  with "Already connected" (`lib/graph-checks.ts`).
