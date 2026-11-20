# Icons, space icons, assets (design round 4: Lumen 13 + 21)

## Glyphs
`src/lib/glyphs.ts` (ported from the handoff's `lumen-glyphs.js`) + `<Glyph name size color tile initials />` (`src/components/Glyph.tsx`). The app shows no emoji in its own UI.

## Space icon format (`space.icon`)
- `glyph:<name>`: a glyph from `glyphs.ts`, e.g. `glyph:neural`.
- `initials:AB`: one or two letters.
- The colour always comes from `space.color` (preset `"1".."6"` or a hex).
- Legacy values (emoji from before round 4) are never drawn as emoji. They map to a glyph through `EMOJI_GLYPH` in `src/lib/space-icon.ts` (🧠→neural, 📥→inbox, 🦉→owl, 📚→book, 🎓→course, 🗂️→folder, 🚀→project…). An unknown emoji falls back to the initials of the space name. Picking an icon in the picker always writes the new form.
- An empty value falls back to the default glyph for the space kind.
- Components: `SpaceIcon`, `SpaceTile`, `SpaceIconPicker` and `AvatarGlyph` (`src/components/SpaceIcon.tsx`).

## Avatar (`settings.avatar`, blog branding)
- Stored as `glyph:owl | glyph:flame | glyph:book`. Legacy emoji map the same way, and anything unknown becomes the owl.

## Assets
- Empty state: `src/components/EmptyState.tsx` (one glyph, one line, one action).
- Moments: `src/components/Moments.tsx`. `UnlockMoment`, `MasteredMoment` and `StreakMoment` are inline components; `showMoment({kind,…})` flashes one for about 1.8 s and mounts itself on first use. Animations are 200 ms; with reduced motion only the end frame shows.
- Favicon badge: `src/lib/favicon.ts`. When cards are due, the tab icon gets a violet dot (no number at 16/32 px). It is hooked from the sidebar.
- OG image (1200×630):
  - The template is in `shared/og-card.ts`. The Worker serves it from `worker/ext/og.ts`: `GET /api/og/{s|post}/<key>.svg`, plus `.png`, which returns the stored PNG or redirects to the SVG.
  - `PUT` of the PNG requires auth and stores it in D1 `files` with id `og:<kind>:<key>`.
  - The app draws the PNG on a canvas with its real fonts and uploads it when the share sheet opens on a shared or published note (`src/lib/og.ts`).
  - `ogPages(app)` injects og:/twitter: meta into `/s/:token` and `/blog/:slug`. This only takes effect once `"/s/*"` and `"/blog/*"` are added to `assets.run_worker_first` in `wrangler.jsonc`. Until then the client sets the same tags at runtime.
- Play store: `design/assets/play-feature-graphic.html` → `.png` (1024×500) and `design/assets/play-screenshot-frame.html` → `.png` (1080×2160; `?title=Line|Line&shot=<img>`).
