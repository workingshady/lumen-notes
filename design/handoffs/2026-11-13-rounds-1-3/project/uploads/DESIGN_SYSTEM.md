# Lumen Design System

> Brand idea: **"a lamp on a desk at night."** Calm, warm, focused. The UI recedes and the writing glows.
> One warm accent (lamplight amber) on cool, low-glare surfaces. Everything else is quiet.

## 1. Principles
1. **Content first, chrome second.** Notes take ≥ 70% of the viewport on desktop and 100% on mobile in Read/Edit.
2. **Progressive disclosure.** Each screen shows only the primary action. Secondary tools live behind one tap: a `⋯` menu, a collapsible panel, the command palette, or a long-press. Advanced settings sit inside "Advanced" accordions.
3. **One accent, used rarely.** Amber marks the *current* thing: the active note, the primary button, the cursor, the focused node. Never for decoration.
4. **Semantic color only for meaning.** Green = mastered/success, amber = review/warning, red = danger/delete, blue = info/link-ish, violet = flashcards/learning.
5. **Calm motion.** 120–200 ms, ease-out, no bounce. `prefers-reduced-motion` turns it off.
6. **Same app, three shells.** Desktop (3 panes), tablet (2 panes), phone (1 pane + bottom bar). Same components and tokens.
7. **Accessible by default.** WCAG AA contrast (4.5:1 text, 3:1 UI), 44×44 px touch targets, visible focus rings, full keyboard support.

## 2. Color theory used
- **Temperature contrast:** cool blue-grey neutrals plus a single warm accent. Warm-on-cool reads as "light source", the brand metaphor, and gives the strongest focus pull at low saturation.
- **Never pure black or white** in the default themes. Dark floors are blue-black (`#0F1115`) to cut halation and eye strain in long study sessions. Light floors are warm paper (`#FAF8F3`).
- **Elevation by lightness, not shadow** (dark themes): bg → surface → surface-2 each step ≈ +4–6% L in OKLCH. Light themes use hairline borders + soft shadow.
- **60-30-10:** 60% background/surface, 30% text and neutral UI, 10% accent + semantic.
- **Customizable accent:** the user picks a hue (OKLCH hue 0–360). Lightness and chroma stay fixed per theme, so contrast stays AA whatever hue they pick.

## 3. Tokens

### 3.1 Themes
| Token | Lamplight (dark, default) | Paper (light) | Midnight | Sepia | Forest | High contrast |
|---|---|---|---|---|---|---|
| `--bg` | `#0F1115` | `#FAF8F3` | `#0B1020` | `#F4ECD8` | `#0E1512` | `#000000` |
| `--surface` | `#161A21` | `#FFFFFF` | `#111830` | `#FBF5E6` | `#141D19` | `#0A0A0A` |
| `--surface-2` | `#1D222B` | `#F2EFE7` | `#18213D` | `#EDE2C8` | `#1B2621` | `#161616` |
| `--border` | `#2A303B` | `#E4DFD3` | `#263156` | `#DCCDA8` | `#29372F` | `#6A6A6A` |
| `--text` | `#E8E6E1` | `#1F1D1A` | `#E3E8F5` | `#3B2F1E` | `#E2EBE4` | `#FFFFFF` |
| `--text-muted` | `#9AA0AA` | `#6A655C` | `#93A0C0` | `#75654A` | `#93A69A` | `#D6D6D6` |
| `--accent` | `#F2A93B` | `#B45F0E` | `#8EA8FF` | `#9C4A1A` | `#7FD49B` | `#FFD400` |
| `--accent-fg` (text on accent) | `#1A1206` | `#FFFFFF` | `#0B1020` | `#FFFFFF` | `#0E1512` | `#000000` |
| `--link` | `#5CC8C2` | `#0F7C78` | `#6EE7D8` | `#2F6B5C` | `#F2C46D` | `#66CCFF` |

### 3.2 Semantic
| Token | Dark | Light | Use |
|---|---|---|---|
| `--success` | `#6BCB8B` | `#1F8A4C` | mastered, synced |
| `--warning` | `#E8B34A` | `#A86A00` | review due, unsynced |
| `--danger` | `#EF6B6B` | `#C42B2B` | delete, conflict |
| `--info` | `#7AA2F7` | `#2F5BD3` | tips, learning |
| `--learn` | `#B48EF0` | `#7A4BD1` | flashcards |

### 3.3 Canvas presets (JSON Canvas colors 1–6)
`1` red `#E5534B` · `2` orange `#E8893A` · `3` yellow `#E3B341` · `4` green `#57AB5A` · `5` cyan `#39C5CF` · `6` purple `#A371F7`.
Cards use the color at 14% alpha as fill and 100% as border.

### 3.4 Typography
| Role | Family | Size / line-height |
|---|---|---|
| UI | Inter (system-ui fallback) | 13/20 compact, 14/22 comfortable |
| Reading body | user choice: Inter · Source Serif 4 · JetBrains Mono | 17/30 (desktop), 16/28 (mobile) |
| H1 / H2 / H3 | same as body, weight 700/650/600 | 2.0 / 1.5 / 1.25 em |
| Code | JetBrains Mono | 0.9em |
| Reading measure | 68ch max (user: 60/68/80/full) | |

### 3.5 Space, radius, elevation, motion
- Spacing scale 4 px: `4 8 12 16 20 24 32 40 56`.
- Radius: `6` inputs/chips · `10` cards/buttons · `14` panels/sheets · `999` pills.
- Elevation (light themes): `0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)`. Dark themes use surface steps instead.
- Motion: `120ms` hover · `180ms` panels · `240ms` sheets · easing `cubic-bezier(.2,.8,.2,1)`.
- Focus ring: `2px solid var(--accent)` + `2px offset`.

## 4. Components (inventory)
App shell · Sidebar (folder tree, tags, smart sections) · Note list item (title, excerpt, tags, status dot, updated) · Tab/segmented control (view modes) · Editor toolbar · Markdown preview (callouts, code block with copy, Mermaid frame, math block, task list, table, footnotes) · Command palette · Search results with highlights · Backlinks panel · Outline panel · Version list + diff view · Flashcard (front/back + 4 grade buttons) · Slide frame · Canvas node (text/file/link/group) · Canvas edge with label · Graph node/edge + legend · Status pill · Tag chip · Toast · Dialog · Bottom sheet (mobile) · Bottom tab bar (mobile) · FAB (mobile "new note") · Empty states · Sync indicator · Theme/accent picker · Settings rows.

## 5. Iconography
Lucide icons, 1.75 stroke, 16 px in UI and 20 px on mobile tab bar. Folder colors use the canvas presets.
