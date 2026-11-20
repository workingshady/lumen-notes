# Round 8 brief: pages 53–58 (Course timeline, Plans, Today/Calendar/Tasks, Ask, Review, Versioning)

Handoff: `design/handoffs/2026-11-21-round-8/` (from `Lumen Index Design Rounds (3).zip`).
- **Pages:** `Lumen 53 Course Timeline`, `54 Plans and Timelines`, `55 Today Calendar Tasks`, `56 Ask Enhanced`, `57 Review`, `58 Versioning`.
- **Components (the source to convert):** `CourseTimeline.dc.html`, `PlanDesk.dc.html`, `PlanViews.dc.html`, `PDTask.dc.html`, `PDMini.dc.html`, `AskStudio.dc.html`, `ReviewStudio.dc.html`, `VersionStudio.dc.html`, plus shared `R6Parts` / `support.js`.
- **Live render:** http://localhost:5398/ + the URL-encoded file name.
- **Reference PNGs:** `frames/<ID>.png` and `frames/index.json` (rendering may still be in progress).
- **Glyphs:** already ported (`src/lib/glyphs.ts`, 492 names).

**All the rules of `design/ROUND7_BRIEF.md` apply.** In short:
- Identical to Claude Design in everything: UI, UX, animations, every click and flow, with real logic and backend and real data.
- Convert the `.dc.html` markup 1:1 into JSX (`<sc-for>` → `.map`, `<sc-if>` → `&&`, `{{x}}` → `{x}`, LumenGlyph → `<Glyph>`), then wire it.
- Lamplight + Paper + phone + Arabic RTL.
- No emoji. Strings via `t()` + Arabic entries in `src/i18n/ar/*`.
- Open formats; synced writes via `save()` / `patch()`.
- Fast: screenshots only to verify at the end (one per main frame); Node scripts, not Python.
- `npx tsc -b` + `npx vite build` must pass; don't commit or deploy (the coordinator deploys after each batch).
- Dev server http://localhost:5330/?demo=1 → "Continue offline" → "Skip"; open notes in-page via `(await import("/src/lib/store.ts")).openNote(id)`.
- puppeteer-core + Edge in `C:\Users\worki\AppData\Local\Temp\claude\a36550ff316812e0\7d09b627-7163-423d-8ee0-6ea8dedb02b4\scratchpad`. Save verify shots to `design/verify/r8/<pkg>/`.

**Other agents are running at the same time:**
- **Whiteboard ink** owns `src/components/wb/pens/**` and the `Whiteboard.tsx` input code.
- **Board merge** owns `src/lib/board-merge.ts`, the `src/lib/sync.ts` apply path, and `Whiteboard.tsx`'s external-change effect.

Don't edit those. Re-read any shared file right before editing it.

**Research:** search the web for best practice in your area (cited in the report) and use what fits the design:
- **Review:** FSRS-5/6 scheduling, Anki deck options / filtered decks.
- **Calendar and plans:** iCal export and recurring events, Gantt dependencies.
- **Ask:** streaming answers and cancel.
- **Versioning:** word-level diff algorithms, 3-way merge UX.
