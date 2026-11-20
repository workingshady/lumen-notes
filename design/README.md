# Design references

Everything visual that Lumen is built from. Keep old handoffs; add new ones as new dated folders.

| Folder | What | Source |
|---|---|---|
| [`handoffs/2026-11-13-rounds-1-3/`](handoffs/2026-11-13-rounds-1-3/) | Claude Design handoff, rounds 1–3: brand & splash, components, all app screens (desktop/tablet/phone, Lamplight + Paper), visual workspaces, bidi & embeds, sharing, public pages, slides/media/storage, Android/loading/sync | claude.ai/design project `63433e31-4ade-49fd-84c7-38169c29b116` |
| [`handoffs/2026-11-19-round-4/`](handoffs/2026-11-19-round-4/) | Claude Design round 4 (from `docs/design/CLAUDE_DESIGN_UPDATE_04.md`): icon system (no emoji, `lumen-glyphs.js` → `src/lib/glyphs.ts` + `<Glyph>`), learning paths, graph & connections, roadmaps + project hub, editor & Read, slides/focus/diagrams, bases & dashboards, PDF/cloze/occlusion, Today/Ask/review/access, smart folders/video/big vaults, assets & components; rounds 1–3 files retrofitted with glyphs. Implementation brief: [`ROUND4_BRIEF.md`](ROUND4_BRIEF.md). Source zip: `Lumen Index Design Rounds.zip` | claude.ai/design project `63433e31-4ade-49fd-84c7-38169c29b116` |

## How to use a handoff
- Start at `project/Lumen Index.dc.html`: it lists every design file by round. The `.dc.html` files are HTML/CSS prototypes (open them in a browser through a local server, since they load `support.js`).
- Shared pieces: `LumenMark` (logo), `LumenSidebar`, `LumenTabBar`, `ShareSheet`, `CanvasBoard`, `WhiteboardBoard`, `SlideFrame`, `Screen*` (full screens reused across rounds).
- Tokens in the prototypes (`--bg --sf --sf2 --bd --tx --mu --ac --af --ln --ok --in --wa --da --le --sh`) map 1:1 to `src/index.css` / `src/lib/settings.ts` (`--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-fg`, `--link`, `--success`, `--info`, `--warning`, `--danger`, `--learn`).
- `shots/` are reference screenshots of real content the designer used.

## Prompts that produced them
`../docs/design/`: `CLAUDE_DESIGN_PROMPT.md` → `CLAUDE_DESIGN_UPDATE_01.md` → `CLAUDE_DESIGN_UPDATE_02.md`. A new design round = a new `CLAUDE_DESIGN_UPDATE_NN.md`, then save the returned handoff here as a new dated folder.

## Implementation status (handoff 2026-11-13)
| Area | Design file | Status |
|---|---|---|
| Brand mark, app icon | Lumen 00, LumenMark | Done round 2 |
| Sidebar + collapsed rail | LumenSidebar | Done round 2 |
| Phone tab bar | LumenTabBar | Done round 2 |
| Workspace: note list, header, modes, editor, reading pane | ScreenWorkspace, Lumen 02 | Done round 2 |
| Unlock / welcome | ScreenUnlock, Lumen 01 | Done round 2 |
| Share sheet | ShareSheet, Lumen 09 | Done round 2 |
| Home dashboard, first run | Lumen 01 | Done round 2 |
| Spaces, course roadmap, project | Lumen 03, ScreenCourse | Done round 2 |
| Palette, graph, canvas, history | Lumen 04, CanvasBoard | Done round 2 |
| Review, slides | Lumen 05, SlideFrame, Lumen 11 | Done round 2 |
| Tasks, kanban, calendar, database, properties, AI, timer | Lumen 05b | Done round 2 |
| Settings, import/export, storage, developer, sharing list | Lumen 06, 07b, 11, ScreenSettings | Done round 2 |
| Blog, states | Lumen 06b | Done round 2 |
| Whiteboard, chooser, code/script panels | Lumen 07, 07b, WhiteboardBoard | Done round 2 |
| Bidi note, embeds | Lumen 08, NoteBidi | Done round 2 |
| Public shared pages, visitor types | Lumen 10, 10b, PublicCourse, PublicNote | Done round 2 |
| Android first launch, share-to-Lumen, skeletons, sync states | Lumen 12 | Done round 2 |

## Built after the handoff, not designed yet (sent as `docs/design/CLAUDE_DESIGN_UPDATE_04.md`)
| Area | Status |
|---|---|
| Learning paths (header, stages, matrix, graph, timeline, revise, concept sheet, mastery, practice) | ⏳ code-designed, redesign requested |
| Course roadmap drag-and-drop editors (outline, skill tree, builder, phone menus) | ⏳ |
| Project hub (docs, board, requirements, timeline, diagrams, assistant) | ⏳ |
| Diagram files, Diagrams tab, export dialog, Settings › Diagrams | ⏳ |
| Editor: slash menu, Insert layout gallery, block handles/menu, block references, paste menu | ⏳ |
| Read mode: page width, layout blocks, tables, includes, status pills, contents box | ⏳ |
| Slides: 11 layouts, Arrange mode, doc → deck, presenter, phone remote | ⏳ |
| Focus Read/Write, highlighter, read aloud, Settings › Reading | ⏳ |
| Bases, Ask your vault, FSRS review settings, navigation/history, accounts, big-vault states | ⏳ |
| Icon system replacing every emoji; layout/slide thumbnails; chart style | ⏳ |
| New: PDF reader + highlights, cloze + image occlusion, Today plan, dashboards, multi-group bases, unlinked mentions, smart folders, video timestamps | ⏳ designs requested, not built |

## Verification
Round 2 compared every screen with its design at desktop 1440, tablet 1024 (where designed) and phone 412, in Lamplight and Paper, using demo data (`?demo=1`, clock pinned to the design's moment). Pairs live in `verify/<area>/<screen>-design.png` / `-app.png` (areas: home, spaces, navigate, study, settings, workspace). Each area's remaining, intentional differences are listed in the round-2 reports (mostly demo data vs hand-written mock copy, OS status bars, and Excalidraw-drawn stickies).

Tools: `tools/serve-design.mjs [port] [folder]` (serve a handoff on :5390; round 4: `node design/tools/serve-design.mjs 5390 design/handoffs/2026-11-19-round-4`), `tools/shot.mjs` (screenshot design or app at the same size; injects tokens into component files).
