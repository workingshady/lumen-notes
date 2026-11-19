# Rounds 5 + 6 brief: apply the Claude Design handoff

Handoff: **`design/handoffs/2026-11-20-round-6/`** (unzipped from `Lumen Index Design Rounds (1).zip`; it contains every round,
including round 5 = files 22–28 + `AskChat`, `TutorDesk`, `ArabicDesk`, `ImportDesk`, `AccountDesk`, and round 6 = files
29–32 + `SettingsDesk`, `SideNav`, `SideNav2`, `NoteTabsDesk`, `BigDataDesk`, `Lumen Sitemap`). Served at
**http://localhost:5392/** (URL-encode spaces). App dev server: http://localhost:5330/?demo=1 (shared; don't start your own).

Everything in `design/ROUND4_BRIEF.md` still applies: identical to the design (layout, spacing, sizes, colours, type, icons,
copy, states, interactions; desktop + phone + tablet where drawn; Lamplight + Paper where drawn; Arabic where drawn), every
feature shown must really work (build missing logic/backend), glyphs via `<Glyph>` (`src/lib/glyphs.ts` is already updated to
the round-6 set), no emoji, file ownership + surgical hooks, re-read shared files before editing, never commit/deploy.

- Features already built in code before their design: chat + tutor (`docs/CHAT_AND_TUTOR.md`), imports (`docs/IMPORT.md`),
  accounts behind `ACCOUNTS_ENABLED` = off (`docs/ACCOUNTS.md`), Arabic i18n partly done (`docs/I18N.md`, `src/lib/i18n.ts`,
  `src/i18n/ar/*`).
- UI strings: use the i18n helper (`t()` / `tk()` from `src/lib/i18n.ts`) for new/changed strings and add Arabic entries in
  `src/i18n/ar/*`.
- Speed: one screenshot comparison per artboard, fix, move on; `npx tsc -b` once at the end; one Edge at a time (memory is tight).
- Verify pairs → `design/verify/r6/<area>/`. Screenshot tool: `C:\Users\worki\AppData\Local\Temp\claude\a36550ff316812e0\f4706a35-9fc9-41e6-b179-e12454161219\scratchpad\kj\shot.mjs`.
