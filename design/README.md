# Design references

Everything visual that Lumen is built from. Keep old handoffs; add new ones as new dated folders.

| Folder | What | Source |
|---|---|---|
| [`handoffs/2026-11-13-rounds-1-3/`](handoffs/2026-11-13-rounds-1-3/) | Claude Design handoff, rounds 1–3: brand & splash, components, all app screens (desktop/tablet/phone, Lamplight + Paper), visual workspaces, bidi & embeds, sharing, public pages, slides/media/storage, Android/loading/sync | claude.ai/design project `63433e31-4ade-49fd-84c7-38169c29b116` |

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
| Brand mark, app icon | Lumen 00, LumenMark | ✅ round 2 |
| Sidebar + collapsed rail | LumenSidebar | ✅ round 2 |
| Phone tab bar | LumenTabBar | ✅ round 2 |
| Workspace: note list, header, modes, editor, reading pane | ScreenWorkspace, Lumen 02 | ✅ round 2 |
| Unlock / welcome | ScreenUnlock, Lumen 01 | ✅ round 2 |
| Share sheet | ShareSheet, Lumen 09 | ✅ round 2 |
| Home dashboard, first run | Lumen 01 | ✅ round 2 |
| Spaces, course roadmap, project | Lumen 03, ScreenCourse | ✅ round 2 |
| Palette, graph, canvas, history | Lumen 04, CanvasBoard | ✅ round 2 |
| Review, slides | Lumen 05, SlideFrame, Lumen 11 | ✅ round 2 |
| Tasks, kanban, calendar, database, properties, AI, timer | Lumen 05b | ✅ round 2 |
| Settings, import/export, storage, developer, sharing list | Lumen 06, 07b, 11, ScreenSettings | ✅ round 2 |
| Blog, states | Lumen 06b | ✅ round 2 |
| Whiteboard, chooser, code/script panels | Lumen 07, 07b, WhiteboardBoard | ✅ round 2 |
| Bidi note, embeds | Lumen 08, NoteBidi | ✅ round 2 |
| Public shared pages, visitor types | Lumen 10, 10b, PublicCourse, PublicNote | ✅ round 2 |
| Android first launch, share-to-Lumen, skeletons, sync states | Lumen 12 | ✅ round 2 |

## Verification
Round 2 compared every screen with its design at desktop 1440, tablet 1024 (where designed) and phone 412, in Lamplight and Paper, using demo data (`?demo=1`, clock pinned to the design's moment). Pairs live in `verify/<area>/<screen>-design.png` / `-app.png` (areas: home, spaces, navigate, study, settings, workspace). Each area's remaining, intentional differences are listed in the round-2 reports (mostly demo data vs hand-written mock copy, OS status bars, and Excalidraw-drawn stickies).

Tools: `tools/serve-design.mjs` (serve a handoff on :5390), `tools/shot.mjs` (screenshot design or app at the same size; injects tokens into component files).
