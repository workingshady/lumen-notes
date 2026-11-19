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
