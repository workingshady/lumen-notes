# Round 4 brief: the Claude Design handoff is the reference bible

Handoff: `design/handoffs/2026-11-19-round-4/` (unzipped from `design/Lumen Index Design Rounds.zip`). Start at `Lumen Index.dc.html`; the designer's own plan is `round4-plan.md` (read it). The prompt that produced it: `docs/design/CLAUDE_DESIGN_UPDATE_04.md`.

## The owner's requirement
Every screen in your area must be **identical** to the design: layout, spacing, sizes, colours, type, icons, copy, states, interactions, desktop and phone (and tablet where drawn), Lamplight and Paper where drawn. **Every feature the design shows must really work**: if the design adds or changes something that has no logic yet (a new button, a new state, a new flow, e.g. graph "Tidy up", passcodes/devices screens), **build the logic and backend** for it (research how it's normally done; Worker routes go in `worker/ext/<area>.ts` registered with one line in `worker/index.ts`). Don't remove existing features the design doesn't show: keep them, styled consistently. Don't change things that aren't in your area.

## Ground rules
- Project `D:/90_Graveyard/lumen-notes`: read `CLAUDE.md`, `docs/FEATURES.md`, the feature doc for your area (`docs/*.md`). Never commit, push or deploy.
- **Icons:** use the ported glyph set: `src/lib/glyphs.ts` (verbatim from `lumen-glyphs.js`) and `<Glyph name size color tile initials />` in `src/components/Glyph.tsx` (= the design's `LumenGlyph`). Wherever the design uses `LumenGlyph`, use `<Glyph>` with the same name/size/colour/tile. Lucide stays where the design uses Lucide (`<i class="icon-…">` = Lucide). **No emoji anywhere in your area.** If the design needs a glyph that's missing, add it to `src/lib/glyphs.ts` (append, don't rename) and say so.
- **Tokens** in the design (`--bg --sf --sf2 --bd --tx --mu --ac --af --ln --ok --in --wa --da --le --sh`) map 1:1 to the app's CSS variables (see `design/README.md`). Use the design's exact px sizes, radii, weights, letter-spacing.
- **Only edit files your area owns** (listed in your prompt) + new files you create. Surgical one-line hooks elsewhere only when listed. Re-read a shared file right before editing it (others edit in parallel). CSS: append your own labelled block at the end of `src/layout.css` (re-read before appending), or use component-local styles/Tailwind arbitrary values. Don't edit `src/index.css`, `src/components/ui.tsx`, `package.json` (ask the lead if you truly need a dependency), `wrangler.jsonc`, `SETUP.md`, `.dev.vars`, `private/`.
- Never let `\b` become a literal backspace: use the Edit tool for regex lines.
- Keep stored formats compatible (existing notes must keep working). Document any new format in the area's `docs/*.md`.

## Servers (shared, already running — do NOT start your own; memory is tight)
- App (Vite dev, hot reload, demo mode): `http://localhost:5330/?demo=1` (`&dev=panel` opens the scenario panel: "Learning paths", "Software project hub", "Slides lab", …; `localStorage['lumen.ui']` sets view/note; set it, then reload).
- Design files: `http://localhost:5390/<File>.dc.html` (URL-encode spaces).
- Screenshot tool (puppeteer-core lives there): `node C:\Users\worki\AppData\Local\Temp\claude\a36550ff316812e0\f4706a35-9fc9-41e6-b179-e12454161219\scratchpad\kj\shot.mjs <url> <out.png> <w> <h> [cssSelector] [dark|light]`. Put your own test scripts in that `kj` folder. Other agents' edits trigger Vite reloads: in your puppeteer scripts block the HMR socket (`page.setRequestInterception` or evaluate `import.meta.hot` off) or retry.
- Memory is tight: one Edge instance at a time per agent, close it when done; don't run `npx vite build` (the lead does); run `npx tsc -b` only at the end.

## Visual loop (required)
For each screen in your area: screenshot the design artboard and the app at the same size (desktop 1440×900, phone 412×915, tablet 1024×768 where drawn; dark and light where drawn) → list every difference → fix → repeat until you can't find one. Save final pairs as `design/verify/r4/<area>/<screen>-design.png` and `-app.png`.

## Done means
`npx tsc -b` clean in your files; every screen/state/interaction of your design files implemented and working with real logic; verify pairs saved; existing features in your area still work (re-run their tests in `scripts/*.test.ts` and the scripts in `kj/` if they exist). Report: files, new logic/backend, new formats, remaining differences with the exact reason (expect pushback on "skipped").
