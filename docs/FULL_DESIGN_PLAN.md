# Full design coverage plan (owner request, 2026-11-22)

Goal: everything in Claude Design pages 00-58 (+ Components, Sitemap) works as designed, with real logic, wiring and backend. Nothing stays "won't fix". Designer "Later" items are in scope. Every agent searches the web for best practice and cites it. Deploy + commit + push after each wave.

| Wave | Scope | Status |
|---|---|---|
| Now | Architecture edges (drag, bend, reconnect), edge labels + panel options, panel overlap, vendor name overlap, C4 drill-down, library layout | running |
| Now | Canvas + Board performance (big canvases, blank open, Tidy up), canvas open items | running |
| Now | Pages 53-58: every open row in `docs/audit/r8-final.md` incl. 30-day Trash purge (worker + D1 + sync) | running |
| Now | Gap audit of pages 00-32 -> `docs/audit/r1-6-gaps.md` (read only) | running |
| A | Pages 33-52: every open row in `docs/audit/r7-whiteboard.md`, `r7-arch-canvas-export.md`, `r7-consistency.md`, `r7-regression.md` (export colours, whiteboard Markdown/Mermaid export, eraser popover, palette grid, offline strip, fonts...) | queued |
| B | Pages 00-32: every gap in `docs/audit/r1-6-gaps.md`, incl. missing backend | queued (after audit) |
| C | Designer "Later" items: dotted fill, text highlight, HTML export, canvas portals, serif/Arabic board fonts, signed-in phone remote | queued |
| Final | Click through every frame of 00-58 (real flows, not just shots); one Done table per frame | queued |

**2026-11-22 status:** current agents + combined wave A/B/C deployed (`6de6ff5`). Still open for the final pass: 54M-54P phone plan app bar (needs a back button in the plan header first), 43A canvas header wrap (NoteView), canvas `runScript` still `new Function`, 46L hub-cards link type, 49F Stamps/Icons customise tabs, course graph hover card (10), visitor unfurl stored with the note, "both collapsed 96%" state, `- [/]` in Read mode, shared board undo/redo buttons, IO dialog hint. Owner decisions pending: accounts on/off (+ D1 migrations 0010-0012), storage 500 MB vs R2 5 GB. Brief 09 (website/docs/changelog) prompt in `design/brief-09/send/`.

**Speed mode (owner, 2026-11-22, usage at 91%):** waves A + B + C run as ONE wave right after the current agents finish, on Sonnet, 2-3 agents split by area. Testing per agent: tsc + build + one quick check per area. No extra research unless blocked. One deploy at the end of the wave.

Limits: the PC has ~1.3 GB free RAM, so at most 3 browser-using agents at a time; one browser per agent, closed after each check. Demo data only, never the owner's live data.
