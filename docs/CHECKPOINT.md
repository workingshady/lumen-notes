# Checkpoint: where work stopped (2026-11-20, round 7 wave 1 done)

## Plan after wave 3 (owner's request, 2026-11-20)
1. Deploy wave 3 when all its agents are done (W3-A layers/settings/frames/present + pen live overlay, size, distinct pens, minimap overlap, multi-select bar, sticky author; QA arch+canvas incl. edges static, keyboard shortcuts, property panels, ConvertMenu mounts; vendor icon packs AWS/Azure/GCP/k8s/top companies).
2. **Design audit:** fresh Opus reviewers compare all 141 frames (`design/handoffs/2026-11-20-round-7/frames/`) and their flows against the live app, area by area, giving one gap list.
3. **Per-feature deep web research + backend/logic/DB review:**
   - **Features to cover:** whiteboard pens/palettes/layers/presentation, Board cards + conversions, canvas, architecture studio (code sync, ELK layout, AI), export, drag and drop, library + vendor icons, AI convert backend, sync + storage, sidebar + note list.
   - **Benchmark against** Excalidraw, tldraw, Miro, FigJam, Eraser, Obsidian and Goodnotes.
   - **Backend and data:** D1 row size vs big scenes, attachments/R2, sync conflicts, offline queue, AI limits/retries, performance on large boards. Add migrations if needed.
3b. **Regression + consistency + small details:**
   - **Old features:** check notes, editor/Read, review/flashcards, paths/roadmaps, hub, PDF, slides, Ask/tutor, imports, share/blog, Android, Arabic.
   - **Compatibility:** old `.canvas` / `.excalidraw` files and notes still open; sync between devices stays correct with the new data (layers, pens, palettes, activity, board, `lumenArch`); share links and exports still work.
   - **Consistency:** same shortcuts, menus, delete/undo, icons, themes, wording and Arabic everywhere.
   - **Small details:** focus rings, tooltips, empty/error/loading states, phone sizes, RTL, keyboard order, missing translations, stray emoji, console errors, leftover "not available yet" toasts.
4. **Fix wave** closes every gap and adds the enhancements: identical design, every flow and use case, consistency across workspaces, backend/logic/UX/optimisation.
5. Final check, then deploy, commit and push.

## Update: wave 2 done and live (deploy `39120b8f`, merge commit `70f74f2`)
- **W2-A:** pens (8 types, settings, saved pens synced in Inbox `props.lumenPens`, pen mode, erasers, ruler, auto-shape), lasso + AI convert, handwriting search, palettes (+ custom, synced in `props.lumenPalettes`), whiteboard export via `openExportJob`, direct Delete row in the board ⋯ menu. Paper-theme frames 34B/37C/37F not verified.
- **W2-B:** shared library (`src/components/library/*`, `src/lib/library-items.ts`), stamps, icon insert, connector/style/text/sticky popovers. "Later" in the UI: dotted fill, Serif/Arabic fonts, text highlight, sticky author line. Vendor packs come from the user's own SVGs.
- **W2-C:** drag and drop (`src/lib/dnd.ts`, `src/components/dnd/*`). Tested with synthetic events only; diagram "insert as shapes" and canvas portal cards are not built.
- **W2-D:** architecture edges: reconnect, bend points, label drag, reset route, label options (start/mid/end, styles, placement, protocol chip).
- **Extras (deployed between waves from a worktree, now merged):**
  - sidebar mode open / hover / click, plus On top / Push per mode;
  - note list: Del, Ctrl/Shift multi-select, Ctrl+A, right-click menu, Shift+Delete for the open note;
  - architecture desktop ⋯ menu + Delete diagram;
  - the architecture studio uses the shared library and the drop zone.
- **Next: wave 3** (W3-A layers / board settings / frames / presentation; W3-B Mixed Board cards + conversions; W3-C architecture AI hook-up + Shared.tsx view-only), then the final Opus review and the first real AI-convert test.

## Round 7 (Claude Design pages 33–52), paused after wave 1
Live: deploy `c012e97c` · commit `f3a4d49` on `main`. Everything deployed, committed and pushed; no agents running.

- **Handoff:** `design/handoffs/2026-11-20-round-7/` (from `Lumen Index Design Rounds (2).zip`). Reference PNG per artboard in `frames/` (141, with `frames/index.json` = labels + designer notes). Serve the pages with `node design/tools/serve-design.mjs 5397 design/handoffs/2026-11-20-round-7`. Frames are re-rendered by `design-frames.mjs` (in the old session scratchpad); rewrite it if needed: it screenshots each themed box under the `NNx` captions.
- **Build brief:** `design/ROUND7_BRIEF.md`. Every agent reads it first. It holds the owner's rules: identical to Claude Design in everything (UI, UX, animations, every click/flow, real logic + backend); port the `.dc.html` markup 1:1 into JSX; nothing static; fast with minimal testing; Node helper scripts, not Python; deploy after each wave. It also has the package table with file ownership and models (Opus for hard parts, Sonnet for the rest).
- **Glyphs:** `src/lib/glyphs.ts` was ported by script from the handoff's `lumen-glyphs.js` (473 names).

### Wave 1: done and live
| Pkg | Frames | Main files | Known gaps |
|---|---|---|---|
| W1-A Whiteboard shell | 33A–K, 44A/G/H/K/L, 45A–B | `src/components/wb/*` (hooks.ts = `registerWb` / `registerPanel` slots), `Whiteboard.tsx`, `WhiteboardView.tsx` | Shared-link page (`src/views/Shared.tsx`) still uses its old viewer; it should render `<WhiteboardView header … />` (33H). Large-board mode keeps sloppiness on. Lasso, pens, palette, layers, frames, present, settings, convert and handwriting are slots that show "not available yet" toasts until wave 2/3 registers them. |
| W1-B Export dialog | 42A–I, 43C | `DiagramExport.tsx`, `src/lib/export-job.ts` (job API, whiteboard example in the header), `export-jobs.ts`, `export-worker.ts`, `export-run.ts`, `export-encode.ts`; pdf-lib (lazy) | Checked only against 43C. PDF and ZIP never run in a browser. PDF is raster, not vector. The whiteboard isn't wired to it yet. |
| W1-C Canvas options | 43A/B/D | `CanvasOptions.tsx`, `src/lib/canvas-style.ts`, `canvas-render.ts`, `CanvasEditor.tsx` | Has a custom-palettes hook (`customPalettes` prop); "Present groups" is only a toast. |
| W1-D Architecture studio | 46A–Q, 47A–D, 48A–B, 48G–I | `src/components/arch/*`, `src/lib/arch-*.ts`, elkjs; demo note "Payments platform" | AI buttons call stubs in `arch/ai-hooks.ts` (`archAiDescribe` / `archAiEdit` / `archAiReview`). Vendor icon packs aren't there; the toggle only saves the preference. No project-hub status ring. `registerArchIcons()` is never called. |
| W1-E Chooser, templates, Board type | 40A–C, 51A–B | `NewVisualChooser.tsx`, `TemplatesGallery.tsx`, `src/lib/templates-visual.ts`, `src/lib/visual-import.ts`; note type `board` + `isWbType` | The interview "hide labels" mode is only drawn. `board` isn't handled in `ImportDialog` badges, `ws-phone.tsx` or the sim files. |
| W1-F AI convert + review | 35A–H, 44J, 48C–E, 48J | `worker/ext/ai-visual.ts` (`/api/ai/visual/{convert,arch,edit,review}`), `src/lib/ai-convert.ts`, `AIReview.tsx`, `ArchAIPanel.tsx` | **The real AI call is untested.** Llama 3.2 Vision gets the image in a top-level `image` field; Scout gets an `image_url` fallback; a Meta licence "agree" retry is built in. Unsure words are highlighted on the result side only. |

### Next: wave 2, then wave 3, then final review (prompts for each package are in the brief's table)
1. **W2-A Pens, palettes, lasso** (Opus; owns `Whiteboard.tsx` + `wb/*`): 34A–H, 37A–F, 44B/C/I.
   - Pen types, settings, synced presets, pen mode, erasers, ruler, auto-shape + undo chip.
   - Lasso actions + AI convert via `AIReview`; handwriting search badge.
   - Palettes + custom palette editor (also pass them to `CanvasOptions` `customPalettes`).
   - Wire whiteboard Export to `openExportJob`.
   - The full prompt was drafted (it was cancelled when the owner paused); rebuild it from this list + the brief.
2. **W2-B Shared library, stamps, icon insert** (Sonnet; new `src/components/library/*`): 36A–G, 49A–F, 44D, 45C–D. Registers `registerWb('shapes')` and replaces the studio's library panel.
3. **W2-C Drag and drop** (Sonnet; new `src/lib/dnd.ts`): 50A–C, sources everywhere (sidebar, list, search, backlinks, Ask, PDF, Graph), drop targets in whiteboard, Board, canvas and arch, touch + keyboard.
4. **W2-D Architecture edge editing** (Sonnet; owns `src/components/arch/*` + `src/lib/arch-route.ts` this wave). Today edges can be created, selected and edited in properties, and they follow their nodes. Missing:
   - **Reconnect:** drag either end to another node or side (React Flow `onReconnect` / reconnectable edges), plus a drop indicator.
   - **Reshape:** bend-point handles on the selected edge: drag a segment midpoint to add a point, drag points to move them, double-click to remove. Points are saved in `lumenEdge.points`; `route()` already accepts points. Orthogonal edges keep right angles while dragging.
   - **Label:** drag the label along the edge (`lumenEdge.labelPos` 0–1).
   - **Edge label options** (in the edge properties panel and a small popover on the label itself):
     - **Edit text:** double-click the label (or the edge) to edit it inline; Enter saves, Esc cancels.
     - **Three slots:** start, middle and end labels (e.g. cardinality "1" / "N" at the ends, protocol in the middle).
     - **Style:** plain / pill / boxed, font size S·M·L, text colour + background from the palettes, bold.
     - **Placement:** on the line, or above / below it (offset side); "follow the line" rotation on/off; show/hide.
     - **Architecture chips:** protocol and port (e.g. `HTTPS · 443`) shown as a chip next to the label.
     - **Storage:** `lumenEdge.labels {start, mid, end}` + `labelStyle`. The DSL keeps only the middle text (`A > B: label`); styles live in JSON. Also apply to canvas edges if cheap.
   - **Reset route:** clears the points back to auto routing.
   - **Rules:** every change is one undo step and rewrites the DSL only when the topology changes (positions and points live in JSON only). This works on canvas edges too if it's cheap (`CanvasEditor.tsx`, coordinate with W2-C).
5. **Wave 3:**
   - W3-A layers / board settings / frames / presentation (38, 39, 41, 44E/F).
   - W3-B Mixed Board cards + conversions (40D–H, 45E, 52).
   - W3-C architecture AI hook-up (connect `arch/ai-hooks.ts` to `ArchAIPanel`; 48C–F).
   - Plus the Shared.tsx view-only hook.
5. **Final:** a fresh Opus review against the frames, then the first real AI-convert test on the live site.

Flow per wave: launch the agents in parallel (disjoint files) → `npx tsc -b` + `npx vite build` → one quick smoke (open "Study plan", "Backprop study board" and "Payments platform"; note that Ctrl+K + Enter may pick "Ask", so click the note result) → `npm run deploy` → commit (no Co-Authored-By) + push.

---

# Earlier checkpoint (2026-11-20, after rounds 5 + 6)

Live: https://lumen-notes.workingshady.workers.dev · deploy `1645b33d` · commit `2f2fe69` on `main` (everything deployed, committed and pushed; nothing running).

## Done and live
- Round 4 Claude Design applied (icons/glyphs, editor & Read, learning paths, roadmaps & hub, slides/focus/diagrams, graph & canvas, bases & dashboards, PDF/cloze/occlusion, Today/Ask/review/navigation/devices, smart folders/video/big vaults) + 3-part final audit.
- Demo scenarios for every feature in the dev panel (`?demo=1&dev=panel`): Study, Organize, Write, Everything (round 4), r5-chat. Checklists in `docs/DEV_SIMULATOR.md`.
- New features (built before their design): Ask as a multi-turn chat + AI tutor modes (`docs/CHAT_AND_TUTOR.md`), Anki/Notion/Obsidian imports (`docs/IMPORT.md`), accounts behind `ACCOUNTS_ENABLED` = **off** (`docs/ACCOUNTS.md`).
- Live account data enhanced (video previews next to links, lesson durations, course formats, AI Engineer dashboard, 5 smart folders). Backup of the account before that: `private/backups/live-2026-11-19T18-08-37-857Z.json` (git-ignored).

## Rounds 5 + 6 (done, deploy 867bd11a)
- Claude Design rounds 5 + 6 applied from `design/handoffs/2026-11-20-round-6/` (brief `design/ROUND5_BRIEF.md`): Ask chat, Tutor, Note tabs (Diagrams / Media / Links), Assistant sidebar, Settings (13 sections, AI usage meter + daily limit), Sidebar best practice + space switcher, tags, history, big-data and long-content states, Arabic interface (0 missing translations), imports and accounts screens (accounts still OFF).
- Before turning accounts on, also apply `migrations/0011_email_change.sql` and `0012_token_scopes.sql`.

## Next steps (older list, mostly done)
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
