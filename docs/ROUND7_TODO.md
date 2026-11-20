# Round 7 to-do (tracked)

Owner's bar for every item:
- **Design:** identical to Claude Design: UI, UX, animations, every click and flow.
- **Logic:** real logic and backend.
- **Process:** web research for best practice at every stage, then verification.

**Owner rule: deploy + commit + push after every stage that changes code.** Tick the boxes as work lands. The newest status sits at the top of `docs/CHECKPOINT.md`.

## Stage 0: finish wave 3 and deploy
- [x] **W3-A whiteboard (Opus):** done (deploy 1d9c7dda)
  - [ ] layers panel/sheet, frames navigator, arrange popover (38A–E, 44E);
  - [ ] board settings: backgrounds, patterns, pages mode, snapping, zen; defaults in Settings › Diagrams (39A–G, 44F);
  - [ ] presentation + phone remote; a `<Presenter>` reused by canvas and architecture (41A–F);
  - [ ] live pen effect while drawing (overlay = final stroke);
  - [ ] pen size applies everywhere (slider, property bar, preset dots); 1–24 px clearly different;
  - [ ] the 8 pens clearly distinct with a mouse;
  - [ ] the minimap no longer covers zoom/undo;
  - [ ] multi-selection gets the floating action bar and light selection boxes;
  - [ ] stickies with the author/device footer;
  - [ ] vendor icons never recoloured (colour control disabled).
- [x] **QA architecture + canvas (Opus):** done; edges editable with a real mouse (deploy 3e339ee6)
  - [ ] fit-to-view, library tabs overlap, edges meeting their nodes, empty node card, zoom jump, properties panel overlap;
  - [ ] edges selectable and draggable (reconnect, bend) with a real mouse and touch;
  - [ ] selection keyboard: Del, Ctrl+D / C / X / V / A, arrows, Esc, Enter/F2, undo/redo, Ctrl+G; the "?" sheet;
  - [ ] every control in the edge, node and group panels applies, saves and undoes;
  - [ ] ConvertMenu mounted in canvas + architecture;
  - [ ] vendor icons rendered on nodes/cards; old vendor toggle replaced; Mermaid icon packs registered.
- [x] Type-check + build → deploy → commit + push: waves 1–3 live (1d9c7dda, commit 3e25132).

## Stage 1: design audit: DONE. Gap lists in docs/audit/r7-whiteboard.md (52: 2 blockers, 10 major) and docs/audit/r7-arch-canvas-export.md (52: 2 blockers, 13 major). Fix agents running.
- [ ] Fresh Opus reviewers, area by area, compare the live app with every frame PNG and the `.dc.html` flow. Output: one gap list (missing, different, broken).
  - [ ] **Whiteboard:** 33, 34, 37, 38, 39, 41, 44, 45.
  - [ ] **Shared parts:** 35 AI review, 36 / 49 library, 50 drag and drop, 52 conversions.
  - [ ] **Board and chooser:** 40 Board + chooser, 51 templates.
  - [ ] **Export and canvas:** 42 export, 43 canvas.
  - [ ] **Architecture:** 46, 47, 48.

## Stage 2: per-feature web research: DONE (docs/research/r7-whiteboard-features.md, r7-arch-canvas-export-ai.md); enhancements go to stage 5
For each feature: search for current best practice and benchmark apps (Excalidraw, tldraw, Miro, FigJam, Eraser, Obsidian, Goodnotes, Notion), then list fixes, improvements and additions in logic, UX, performance and edge cases.
- [ ] Whiteboard: pens / ink, palettes, layers, presentation, lasso + handwriting
- [ ] Board cards + conversions
- [ ] Canvas: options, edges, groups
- [ ] Architecture studio: DSL two-way sync, ELK layout, AI flows, model objects
- [ ] Export (formats, PDF, sizes)
- [ ] Drag and drop (desktop, touch, keyboard)
- [ ] Library + vendor icon packs
- [ ] AI convert backend: vision model formats, limits, retries
- [ ] Sidebar modes + note list (shortcuts, multi-select)

## Stage 3: backend review: DONE (docs/research/r7-backend-review.md). Critical fixes running: poison-pill sync, dirty-flag data loss, pull paging, storage quota + versions retention, attachment XSS headers, unfurl auth, per-account AI meter, R2 prefixes
- [ ] **Data size:** D1 row and string size limits vs big whiteboards and boards; chunking or R2 for large scenes if needed (+ a migration).
- [ ] **Sync:** conflicts on boards and diagrams (merge per element vs last-write-wins); offline queue; backoff.
- [ ] **Attachments:** R2 / D1 files, Range, cache headers, cleanup of unused attachments.
- [ ] **AI:** quotas, the daily limit, caching, timeouts, and the first **real** vision-convert call on the live site.
- [ ] **Performance:** large boards (3,000+ elements), lazy chunks, workers, memory.
- [ ] **Security:** SVG sanitising, API token scopes, input validation on the new routes.

## Stage 4: regression, compatibility, consistency, small details: DONE and deployed (5b7ff3c8). All older features pass, old files open, 3 accounts + two-device sync OK, 0 missing Arabic. Results in docs/audit/r7-regression.md, r7-consistency.md
- [ ] **Old features:** notes, editor/Read, review/flashcards, paths/roadmaps, project hub, PDF, slides, Ask/tutor, imports, share/blog, Android, Arabic.
- [ ] **Compatibility:**
  - [ ] old `.canvas` / `.excalidraw` files and notes open;
  - [ ] sync between devices with the new data (layers, pens, palettes, activity, board, `lumenArch`);
  - [ ] share links;
  - [ ] exports;
  - [ ] the REST API.
- [ ] **Consistency:** shortcuts, menus, delete + undo, icons, themes, wording, Arabic everywhere.
- [ ] **Small details:**
  - [ ] focus rings, tooltips;
  - [ ] empty / error / loading states;
  - [ ] phone sizes, RTL, keyboard order;
  - [ ] missing translations (Arabic for vendor packs is known missing), stray emoji;
  - [ ] console errors, leftover "not available yet" toasts.
- [ ] **Known gaps:**
  - [ ] Paper-theme frames unverified (34B, 37C, 37F);
  - [ ] note → architecture without a review sheet;
  - [ ] ink → architecture drops ink;
  - [ ] Settings › Diagrams vendor section;
  - [ ] "Later" items still disabled (dotted fill, Serif / Arabic fonts, text highlight);
  - [ ] canvas portal cards.

## Stage 5a: audit + backend fix wave: DONE and deployed (63fb2a3e, f81ec95): whiteboard 33 fixed, arch/canvas/export 36 fixed + 5 partial, backend criticals all fixed (42/42 server tests)

## Stage 5b: research enhancements (palm rejection, low-latency ink, flat marker, spatial index, handwriting eval, vector PDF, AI edit as ops, board merge…)
- [ ] Agents close every item from stages 1–4 (each with web research and best practice), with file ownership and parallel waves as before.

## Stage 6: final check and deploy
- [ ] Final verification against the frames and flows; type-check + build; deploy; commit + push; update CHECKPOINT + memory.
