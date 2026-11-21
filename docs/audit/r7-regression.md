# Round 7 · Stage 4: regression + compatibility audit

Date 2026-11-20. Browser checks: puppeteer-core + Edge, `/?demo=1` on the dev server (:5330) and, for sync / REST /
accounts / share / blog, an **isolated** `wrangler dev` (:8799, own `--persist-to` state, three test passcodes) with the
app served by `vite --mode app` (:5341, `VITE_API_BASE=http://localhost:8799`, i.e. the Android-style cross-origin build).
Scripts: `rg-*.mjs` in the session scratchpad; screenshots in `design/verify/r7/audit/regression/`.
No page errors or console errors in any run unless listed below.

## Older features

| Feature | Result |
|---|---|
| Views: home, today, notes, tasks, kanban, calendar, review, graph, table, space, settings, trash, folders | OK (all render, 0 errors) |
| Notes: create, edit (typing saves), Read / Split / Edit for note, lesson, flashcards, moc, roadmap, post, journal, slides, pdf | OK |
| Editor: slash menu, tasks (`[ ]` `[x]`), KaTeX inline + block, Mermaid (toolbar, zoom), callouts, `Q :: A` cards, cloze, wikilinks, `![[note]]` transclusion, inline ```` ```canvas ```` | OK |
| `- [/] doing` task in **Read** mode | open (pre-existing, minor): rendered as a plain bullet with the literal `[/]`; parse.ts counts it as doing, markdown.ts (markdown-it-task-lists) does not draw it |
| Flashcards + review (start, reveal, grade; due count drops, review log written) | OK |
| Learning paths (path note: stages, concepts, courses, sidebar entry) | OK |
| Roadmaps, course spaces, project hub (Thesis) | OK |
| PDF reader (pages render, rail) | OK |
| Slides mode (next / prev / presenter) + phone remote (room, presenter key, phone → presenter `cmd`, bad key 401) | OK |
| Ask chat (simulator answer, sources, follow-ups) | **fixed**: a source passage made only of `Q :: A` lines showed an empty `“”` quote (plainText strips card lines). `ChatParts.tsx` now quotes it as "Q — A" and hides the quote if still empty |
| Tutor (explain steps, from-note badge) | OK |
| Search palette (plain, `tag:`, `type: status:`, scoped to the current space) | OK |
| Bases (table / board views from YAML) | OK |
| Dashboards (bar + number tiles) | OK |
| Smart folders (module + sidebar), graph view | OK |
| Settings: every section opens (Account … About) | OK |
| Themes: lamplight, paper, midnight, sepia, forest, contrast | OK (background tokens apply; note + whiteboard render) |
| Arabic UI (`dir=rtl`, home / today / review / tasks / settings / note / whiteboard) | OK |
| Unit scripts (`scripts/*.test.ts`, 22 files incl. import 145, i18n 1780, today 71, dnd 78, sync-plan 25) | OK, all pass |

## Imports

| Source | Result |
|---|---|
| Anki (.apkg/.colpkg), Notion (md + csv → base), Obsidian (md + .canvas) through the dialog pipeline (readSource → plan → writePlan) | OK (browser + import.test.ts); imported notes open |
| `.canvas` (no `lumen*` keys), `.excalidraw` (inline dataURL), `.md` via Import / drop | OK |
| `.mermaid` / `.mmd` via Settings › Import / note-list drop / vault zip | **fixed**: were silently skipped (only the New-visual chooser read them). `io.ts` now imports them as diagram files (`type: "diagram"`, title `name.mermaid`, fence stripped); IO dialog accepts them |
| Vault zip export → re-import of a **Board** | **fixed**: came back as a plain whiteboard. Export now tags Board scenes with `lumenType: "board"` (a `lumen*` key, ignored by Excalidraw); import restores the type. Diagram files round-trip as `.mermaid` |

## Compatibility

| Check | Result |
|---|---|
| Pre-round-7 `.canvas` (text / link / file / group nodes, edge sides, labels, preset + hex colours): open, drag a card, save | OK: same ids, edges, colours, text; no keys added (`nodes,edges` only) |
| Pre-round-7 `.excalidraw` with inline dataURL image + text / arrow / freedraw: open, add an element, save, reopen | OK: all elements kept; image moved to an attachment (`files.file1.lumenAtt`, blob stored), shown again on reopen; `lumenBoard` / `lumenLayers` added as `lumen*` keys |
| Old note front matter (tags, status) | OK |
| REST: notes CRUD, append under heading, markdown, search, canvas GET/PUT + validation, whiteboard GET/PUT/elements, `type=board` list, 401 without token, DELETE → Trash | OK |
| REST: `POST /notes` with `type: canvas / whiteboard / board` and no body | **fixed**: body was `# Title`, which the whiteboard / canvas editors can't parse. Now an empty JSON Canvas / .excalidraw scene (`worker/ext/rest.ts`) |
| REST: `PUT /whiteboard/:id` creating a Board | **fixed**: always created `whiteboard`. `?type=board` now creates a Board; existing notes keep their type (`worker/index.ts`). docs/API.md + OpenAPI updated |
| Android: `capacitor.config.json` unchanged since the Capacitor 6 commit; no same-origin `/api` calls in `src/` (all via `API_BASE`); the app-mode bundle synced cross-origin against the worker | OK |
| 3 accounts (main, roadmap, languages) log in; each runs the full two-device sync script; tokens can't read another account's notes | OK |

## Sync between two devices (two browser contexts, same account; run for all 3 accounts)

| Check | Result |
|---|---|
| Note / whiteboard / Board / architecture diagram created on A appear on B with the right type | OK |
| Sequential edits A → B | OK |
| Concurrent note edits (B later): last write wins on both devices, no duplicate, no conflict copy | OK |
| Whiteboard open in A's editor while B adds an element: A's live scene updates, both stored scenes equal | OK |
| Architecture diagram edited on B (open in its editor) → A: nodes / edges / `lumenArch` intact | OK |
| Trash on A → tombstone on B, visible in B's Trash; restore on B → live again on A; delete forever → `(deleted)` tombstone | OK |
| Server: one live row per note, nothing lost | OK |

## Open (round-7 files, not fixed here)

| Item | Where |
|---|---|
| Shared whiteboard / Board page (`/s/<token>`) shows "Saved · Synced" and undo / redo buttons on a read-only view | `Shared.tsx` / `wb/BoardHeader` |
| Element **without** `index` arriving by sync / REST while the board is open is placed at the bottom (z-order), e.g. REST `PUT /whiteboard` with index-less elements or pre-0.17 Excalidraw files merged live. Initial open keeps file order; elements the app writes always carry `index` | **Fixed** earlier (`ensureIndices` in the external-change effect keeps array order) |
| An old `.excalidraw` whose `appState.viewBackgroundColor` is white opens on the Lumen board background (dark in dark themes); the value is kept in the file | by design? (`lumenBoard`) |
| Single-note `.excalidraw` export via `exportNoteMd` writes the stored body (attachment refs, no `lumenType`); the vault zip and the round-7 export dialog inline images | `io.ts exportNoteMd` callers vs `DiagramExport` |
| IO dialog hint still reads ".md · .zip vault · .canvas · JSON backup" (now also .excalidraw / .mermaid); left unchanged to keep the Arabic string table in sync | `Dialogs.tsx` + `src/i18n/ar` |

## Files changed
- `worker/ext/rest.ts`: empty JSON body for canvas / whiteboard / board on `POST /notes`; OpenAPI text.
- `worker/index.ts`: `PUT /whiteboard/:id?type=board` creates a Board.
- `src/lib/io.ts`: `.mermaid` / `.mmd` import (files, zips); Board `lumenType` on vault export + restore on import.
- `src/components/Dialogs.tsx`: IO picker / input accept `.mermaid,.mmd`.
- `src/components/ChatParts.tsx`: source quote for card-only passages.
- `docs/API.md`: Board notes on `/notes` and `/whiteboard`.

`npx tsc -b` and `npx vite build` pass.
