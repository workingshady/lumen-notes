# Round 7 · stage 4 · consistency and small details

Browser pass (puppeteer-core + Edge, `/?demo=1`) over whiteboard, Board, canvas, architecture studio, Mermaid file, export dialog, chooser, library and the shell, at 1440×900 (Lamplight, Paper + Arabic) and 412×915. Screenshots: `design/verify/r7/audit/consistency/`. No console errors or page errors came up in any workspace during the pass.

| Item | Status |
|---|---|
| **i18n test was broken**: the Arabic catalog became a lazy chunk (`loadCatalog`), so `scripts/i18n.test.ts` saw 0 entries and reported 5,217 missing. The test now awaits `loadCatalog("ar")` and prints every missing key (was capped at 80) | fixed |
| 85 real missing Arabic keys (architecture studio, chooser, panels, vendor packs, library, export, whiteboard, templates, canvas edge) + new keys from this pass → `src/i18n/ar/r7-consistency.ts` (registered last in `src/i18n/ar.ts`). Test: **0 missing, 1780 passed** | fixed |
| `src/i18n/ar/canvas-options.ts` overrode the plural `{n} card|{n} cards` with a plain string (broke Arabic plural forms) | fixed (removed) |
| Untranslated dynamic key `"Mixed"` (font name in the property bar, `t(var)`) | fixed |
| **"?" in the whiteboard / Board opened two sheets at once**: the app's "Sidebar keys" and Excalidraw's own Help dialog (external links to Excalidraw docs / blog / YouTube, and Excalidraw's tool keys `R or 2 = Rectangle`, which are wrong in Lumen where 2 = lasso) | fixed: new `src/components/wb/KeysSheet.tsx` (same style as the canvas and architecture sheets; lists Lumen's real tool keys from `TOOL_META` plus the edit keys); small hook in `Whiteboard.tsx` (`?` / `؟`, Esc closes) |
| Delete + Undo toast: whiteboard element deletes had none (canvas / architecture don't either) | fixed for whiteboard / Board: Delete / Backspace and the property-bar trash show "Deleted {n} items · Undo" (hook in `Whiteboard.tsx`; verified: Undo restores the sticky) · **fixed** for canvas cards (React Flow `onDelete`) and architecture nodes / edges (`removeSel`): same toast, Undo runs each editor's own undo stack, one step (verified in browser) |
| Wording for removing a whole workspace: app term is "Move to trash" (note header, note list, whiteboard menu, phone). Architecture ⋯ said "Delete diagram" | fixed (`ArchStudio.tsx` label only) · canvas keeps "Delete canvas" (it's in the round-7 design frame 07) and its toast now says "“{title}” moved to Trash · Undo" like the others: **fixed** |
| Tooltips with shortcuts: whiteboard property bar Duplicate / Delete, lasso bar Duplicate / Group had none | fixed (`· Ctrl D`, `· Delete`, `· Ctrl G`) |
| Note list "+" in the Visual filter had aria-label "New note" but opens the visual chooser | fixed (label follows the filter) |
| Keys sheets: canvas and architecture list the real keys and match in wording (Ctrl Z / Ctrl Shift Z · Ctrl Y, Delete · Backspace, Shift 1 fit) | ok |
| Whiteboard ⋯ hints use Mac signs (⌥P, ⇧⌘E, ⌥Z) on Windows while the sheets say Ctrl / Alt | **fixed**: `HeaderMenu.tsx` shows Ctrl / Alt / Shift on Windows / Linux, signs on Mac (`mod-label.ts`) |
| ⋯ menu structure differs per workspace: whiteboard "Export…", "Convert to…" + Note submenu; architecture "Export", "Convert…", no Note submenu; canvas "Export .canvas", "Duplicate canvas" | open (follows each design source; aligning needs a design call) |
| Icons for the same action: Export is the `export` glyph (arrow up) in whiteboard / architecture, lucide `Download` (arrow down) in the Mermaid file and canvas; canvas and the note header menu still use lucide icons rather than `<Glyph>` | **fixed** for canvas (Export = `export` glyph in canvas, Mermaid file, whiteboard, architecture; canvas icons via `canvas-glyphs.tsx`; the few with no glyph — Scissors, Paste, Keyboard, Sliders, Focus, Grid layout, Rotate, Arrow — stay lucide) · `NoteView.tsx` menu body: other agent, open |
| Icon buttons without accessible names: scanned every visible control in each workspace and dialog at desktop and phone. None found in the round-7 workspaces | ok · one disabled future cell in the Home heatmap has no label (`src/views`, other agent) |
| Focus rings: Tab through shell (69 stops), whiteboard (54) and canvas (69): every button shows the ring | ok · canvas group title inputs (`group-handle`) have no label and no ring: **open** (`CanvasEditor.tsx`) · global `:focus-visible` also sets `border-radius: 8px`, which squares round buttons on focus: open (`index.css`) |
| Tab order: whiteboard goes header › toolbar › bottom bar › frames › then the sidebar (main before sidebar) | ok (consistent across workspaces) |
| Phone 412×915: whiteboard dock, keys sheet, export sheet, architecture bottom bar render; export sheet doesn't close on Esc on phone | ok · Esc on the phone sheet: minor, open |
| RTL Arabic: whiteboard toolbar, header, bottom clusters mirror; the drawing doesn't; keys sheet mirrors | ok · export dialog range slider: **fixed** (fills and knob from the right in RTL) |
| Stray emoji in UI strings: none in owned files (only the stored task date `📅`, demo/sim seed content and the emoji → glyph map) | ok · `BaseView.tsx` uses a literal "✓" for the selected option: open (`src/views`) |
| Leftover "not available yet" toasts: none. Remaining "Later" tags (dotted fill, Serif / Arabic fonts, text highlight, author/device, HTML export, canvas portals) are the designed [Later] items | ok (known gap list) |
| Empty states: Board ("A blank board. Start anywhere." + Draw / Add a note card / Paste an image), architecture objects / versions, vendor packs (new strings) | ok |
| Mermaid file error state: the error box sits under the chip row (kind · updated, Add to canvas, Suggest name, Export) and the text is covered | **fixed** (`DiagramFile.tsx`: chip row is its own row above the view; verified) |
| Contrast, Lamplight: text 15.2, muted 6.1–7.2, accent 8.0–9.5, link 8.0–9.4 | ok |
| Contrast, Paper: text 15.8, muted 5.0–5.5; **accent as text 4.3 on bg / 4.0 on surface-2** (below 4.5 for small text, e.g. "New path", Board subtitle in the chooser); canvas "Later" pill hard-coded `#B48EF0` (2.6 on white): **fixed** (uses `--learn`, 5.6+ in both themes) · Paper accent `#B45F0E` stays as designed; the design system has no darker accent text token (only `accent` and `link`), so small accent text is left as is |

## Files changed
`scripts/i18n.test.ts`, `src/i18n/ar.ts`, `src/i18n/ar/r7-consistency.ts` (new), `src/i18n/ar/canvas-options.ts`, `src/components/wb/KeysSheet.tsx` (new), `src/components/wb/PropertyBar.tsx`, `src/components/wb/pens/LassoBar.tsx`, `src/components/NoteList.tsx`; shared-file hooks: `src/components/Whiteboard.tsx` (keys sheet + delete toast), `src/components/arch/ArchStudio.tsx` (one label).

Checks: `npx tsc -b` ok, `npx vite build` ok, `npx tsx scripts/i18n.test.ts` 0 missing.
