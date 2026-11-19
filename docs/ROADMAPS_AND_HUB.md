# Course roadmaps and the project hub (design round 4)

Design: `design/handoffs/2026-11-19-round-4/` "Lumen 15 Roadmaps and Project Hub", `RoadmapDesk`, `HubDesk`. Verify pairs: `design/verify/r4/roadmaps/`.

## Roadmap (course spaces)
Code: `src/views/RoadmapView.tsx` (wiring + exports), `roadmap-outline.tsx` (outline, builder, phone ⋯ menu), `roadmap-tree.tsx`, `roadmap-timeline.tsx`, `roadmap-sheet.tsx`, `roadmap-parts.tsx`. Pure rewrites in `src/lib/parse.ts`.

Format (unchanged, plain Markdown):
```
## Module name 📅 2026-12-01
- [/] Topic (needs: Other topic) 📅 2026-12-01 → [[Lesson note]]
```
New: dates may also be written as `due:2026-12-01` or `@due(2026-12-01)` (no emoji). The app still writes `📅` (Obsidian Tasks compatible, read by Today/plan).

- Drop on the top/bottom third of a row inserts; the middle third makes the dragged topic a prerequisite. A drop that would create a loop is refused with the chain (`needChain` in parse.ts) and writes nothing.
- Module fold state: `localStorage["lumen.rm.fold.<roadmapNoteId>"]` = `{ "<module name lowercased>": open }`, shared by Outline and Skill tree. Notes tray toggle: `lumen.rm.tray`.
- Unlock moment: a topic whose prerequisites all became done plays a 600 ms ring/settle, its incoming link draws in green, toast "X is now open." Reduced motion: end frame only.

## Project hub (project spaces)
Code: `src/views/ProjectHub.tsx` (header, links, tabs, Overview, Docs), `hub-board.tsx`, `hub-plan.tsx` (Requirements, Gantt, Diagrams), `hub-assistant.tsx`, `hub-parts.tsx`. Logic in `src/lib/project.ts`, templates `src/lib/project-templates.ts`.

Task line: `- [>] backlog · [ ] todo · [/] doing · [?] review · [x] done · [-] cancelled`, markers `!p1 ~3d #epic/x @owner REQ-n [[Doc]]`.
Dates: due `📅 2026-12-01` | `due:2026-12-01` | `@due(2026-12-01)`; start `🛫` | `⏳` | `start:` | `@start(…)`. Templates now write `@due(…)` (no emoji). Cards render these as glyph chips.

Doc front-matter: `doc`, `docstatus` (draft/review/approved/superseded/rejected), `owner`; new optional `approved: YYYY-MM-DD` (stamped when approved), `supersededby: ADR-3`, `reason: …` (shown in the status header).

Health (`projectHealth`): Behind / At risk / On track from time used vs work done, must-have requirements without tasks, overdue cards, epics whose start date passed while still todo; the reasons fill "Why at risk".

Assistant: preset actions use `/api/ai` (`project_*` prompts); "Ask" is `POST /api/ai/project {question, context}` (`worker/ext/hub.ts`, off-switch "project" in Settings › AI). Nothing is written until "Insert as note".

UI state: `lumen.hub.tab.<spaceId>`, `lumen.hub.doc.<spaceId>` (doc in the preview), `lumen.hub.filter.<spaceId>` (board filter).
