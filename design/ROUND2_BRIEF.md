# Round 2 brief: 100% identical to the Claude Design handoff, every feature real

The owner's requirement: every screen must be **100% identical** to the design (layout, spacing, sizes, colors, type, icons, copy, states, interactions) and **every feature shown in the design must work for real**. Nothing gets skipped as "out of scope" or "no backend": if logic is missing, research how it's normally done (web search is fine) and build it.

## Ground rules
- Project: `D:/90_Graveyard/lumen-notes` (read `CLAUDE.md`). Design: `design/handoffs/2026-11-13-rounds-1-3/project/*.dc.html` (read the source; `design/README.md` maps tokens).
- Only edit the files your area owns (listed in your prompt). Need a backend route? Put it in your `worker/ext/<area>.ts` (gets `api` + helpers `auth, getNote, putNote, upserts, hmac, safeEqual`). Need a D1 table? Add a migration with **your number** (home 0005, spaces 0006, navigate 0007, study 0008, settings 0009, workspace 0010) in `migrations/`, then run `npx wrangler d1 migrations apply lumen-notes --local`. Need a wrangler binding (e.g. Durable Object)? Only the study area may edit `wrangler.jsonc`.
- Never edit `src/index.css` or `src/components/ui.tsx` (shared). Area-specific CSS goes in your component (a `<style>` element or Tailwind arbitrary values).
- Keep stored formats open (Markdown, JSON Canvas, .excalidraw) and keep existing exports/signatures other files import.

## Demo data (dev mode)
`src/lib/demo.ts` (being written in parallel) seeds the exact sample content from the designs into a separate database `lumen-demo`. Open the app with `?demo=1` to enter demo mode (it reloads into the demo DB, seeds once, never syncs); `?demo=0` leaves. If `src/lib/demo.ts` doesn't exist yet, do your feature work first and come back to visual checks when it appears.

## Visual verification loop (required)
1. Servers already running: app at `http://localhost:5299` (Vite dev, hot reload), design files at `http://localhost:5390/<file>.dc.html`.
2. Screenshot both at the same size:
   `node C:/Users/worki/AppData/Local/Temp/claude/ffe8b9ca95779c1f/fa6b7656-3f8f-4b0c-9c27-3ab0cea0e29d/scratchpad/shot.mjs <url> <out.png> <w> <h> [cssSelector] [dark|light]`
   (puppeteer-core is installed next to that script; run it with that absolute path). For the big multi-artboard design files, pass a selector for the artboard (they're fixed-size divs, e.g. `div[style*="width:1440px"]`, use `:nth-of-type` or a more specific selector), or screenshot component files (`Screen*.dc.html`, `LumenSidebar.dc.html`…) directly. For the app, use `http://localhost:5299/?demo=1` then navigate (or set `localStorage['lumen.ui']` before reload) to reach the screen.
3. Read both PNGs and list every difference. Fix. Repeat until you can't find any difference. Check desktop 1440×900 and phone 412×915 (and tablet 1024×768 where the design has it), Lamplight and Paper where the design has both.
4. Save the final pairs as `design/verify/<area>/<screen>-design.png` and `-app.png`.

## Done means
`npx tsc -b` has no errors in your files; every item in your list is implemented and working; verify pairs are saved. Report: what you built, and any remaining difference with the exact reason. Expect pushback on "skipped".
