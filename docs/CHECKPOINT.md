# Checkpoint: where work stopped (2026-11-20)

Live: https://lumen-notes.workingshady.workers.dev · deploy `1645b33d` · commit `2f2fe69` on `main` (everything deployed, committed and pushed; nothing running).

## Done and live
- Round 4 Claude Design applied (icons/glyphs, editor & Read, learning paths, roadmaps & hub, slides/focus/diagrams, graph & canvas, bases & dashboards, PDF/cloze/occlusion, Today/Ask/review/navigation/devices, smart folders/video/big vaults) + 3-part final audit.
- Demo scenarios for every feature in the dev panel (`?demo=1&dev=panel`): Study, Organize, Write, Everything (round 4), r5-chat. Checklists in `docs/DEV_SIMULATOR.md`.
- New features (built before their design): Ask as a multi-turn chat + AI tutor modes (`docs/CHAT_AND_TUTOR.md`), Anki/Notion/Obsidian imports (`docs/IMPORT.md`), accounts behind `ACCOUNTS_ENABLED` = **off** (`docs/ACCOUNTS.md`).
- Live account data enhanced (video previews next to links, lesson durations, course formats, AI Engineer dashboard, 5 smart folders). Backup of the account before that: `private/backups/live-2026-11-19T18-08-37-857Z.json` (git-ignored).

## Next steps (in order)
1. **Finish the Arabic interface.** The i18n agent was stopped midway: `src/lib/i18n.ts` + `src/i18n/ar/*` exist and type-check; some files are not wrapped with `t()` yet, and the files it was told to skip (Ask/chat/tutor, imports, accounts) still need their strings wrapped + Arabic entries. Run `npx tsx scripts/i18n.test.ts` for the coverage report. See `docs/I18N.md`.
2. **Apply the round-5 Claude Design handoff** (`design/handoffs/2026-11-20-round-5/`, brief `design/ROUND5_BRIEF.md`, serve with `node design/tools/serve-design.mjs 5391 design/handoffs/2026-11-20-round-5`). Areas: 22 Scale & long content, 23 Ask chat (`AskChat`), 24 Tutor (`TutorDesk`), 25 Arabic (`ArabicDesk`), 26 Imports (`ImportDesk`), 27 Accounts (`AccountDesk`, active + not-active states), 28 Components R5. Suggested agents: chat+tutor, imports+accounts, Arabic (with step 1), scale & long content.
3. Then: type-check, quick screen check, `npm run deploy`, commit + push (no Co-Authored-By trailer; never commit SETUP.md / .dev.vars / private/ or the design zip).

## Later / optional
- Architecture & diagram studio (Eraser-like): spec only, `docs/ARCHITECTURE_DIAGRAMS.md`; recommended to wait until system-design / project work starts.
- Other candidates: Git backup of the vault, semantic search (embeddings), mastery map / knowledge tracing.
- Turning accounts on: steps in `docs/ACCOUNTS.md` (migration `0010_users.sql`, email + Google secrets, `ACCOUNTS_ENABLED=1`, terms/privacy pages).
- Known small gaps: graph tag-node click and some flows only checked by logic tests; course target dates not set (owner's choice); Today uses 30 min for lessons without lecture lengths.

## How to resume
Dev server: `npx vite --port 5330 --strictPort` in the repo (demo at `/?demo=1`). Tests: `scripts/*.test.ts` via `npx tsx`. Screenshot tool: `design/tools/shot.mjs` (needs puppeteer-core + Edge).
