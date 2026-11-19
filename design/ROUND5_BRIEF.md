# Round 5 brief: apply the Claude Design round-5 handoff

Handoff: `design/handoffs/2026-11-20-round-5/` (unzipped from `Lumen Index Design Rounds.zip`, round 5 = files 22–28 plus
`AskChat`, `TutorDesk`, `ArabicDesk`, `ImportDesk`, `AccountDesk`). Prompt that produced it: `docs/design/CLAUDE_DESIGN_UPDATE_05.md`.
Everything in `design/ROUND4_BRIEF.md` still applies (identical to the design, real logic for everything shown, glyphs, no
emoji, file ownership, verify pairs), with these differences:

- Design server for round 5: **http://localhost:5391/** (round 4 stays on :5390). App dev server: http://localhost:5330/?demo=1.
- The features already exist in code (built before the design): chat + tutor (`docs/CHAT_AND_TUTOR.md`), Arabic i18n
  (`docs/I18N.md`), imports (`docs/IMPORT.md`), accounts behind `ACCOUNTS_ENABLED` (off; `docs/ACCOUNTS.md`). Your job is to
  make them **identical to the design** and add any state/flow/logic the design shows that is missing.
- UI strings: keep them in the file's existing const string object (`CHAT_STR`, `TUTOR_STR`, `IMPORT_TEXT`, `AUTH_TEXT`, …) and
  use the i18n helper (`t()` / `tk()` from `src/lib/i18n.ts`) the way the i18n agent set it up; add Arabic entries for new
  strings in `src/i18n/`.
- Speed: one screenshot comparison per artboard (desktop + phone; Paper where drawn), fix, move on. `npx tsc -b` once at the end.
- Verify pairs → `design/verify/r5/<area>/`.
