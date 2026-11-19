# Note tabs and the note Assistant

Round 6, part A. Design: `design/handoffs/2026-11-20-round-6/Lumen 31 Note Tabs and Assistant.dc.html` (`NoteTabsDesk`).
Verify pairs: `design/verify/r6/a/R6-31*-{design,app}.png`.

## Files

| Area | File |
|---|---|
| Pure logic (tested: `npx tsx scripts/note-tabs.test.ts`) | `src/lib/note-tabs.ts` |
| Tab row, Media tab, Links tab | `src/components/NoteTabs.tsx` |
| Diagrams tab + Expand | `src/components/DiagramsTab.tsx` |
| Page snapshots + link check (client) | `src/lib/link-snapshots.ts` |
| Page snapshots + link check (Worker) | `worker/ext/links.ts` (registered in `worker/index.ts`) |
| Assistant panel / sheet / rail | `src/components/Assistant.tsx` (mounted by `RightPanel.tsx` for panel `ai`) |
| Hooks in the note view | `src/components/NoteView.tsx` (tab row, Assistant button, Ctrl/⌘ J, modes `media` / `links`) |
| Demo | `src/lib/sim/scenarios-r6-tabs.ts` (inside scenario `r5-chat`: note "Attention, explained") |

## Tabs

A tab shows only when the note has that content, with a count; a note with none of them has no tab row (R6-31L: a note
with only links shows Note + Links). Tabs are UI modes (`ui.mode`): `diagrams`, `media`, `links`; Note returns to the last
of edit / split / read; Outline (desktop, when the note also has diagrams or media) toggles the side panel's outline.

- **Diagrams**: every ```` ```mermaid ```` block + images whose alt or file name says diagram / figure / fig / chart / graph /
  flow / schema / architecture, or `.svg`. Grid 1 or 2 columns (`lumen.diagramCols`). Each card: view source, expand, zoom
  bar (−, %, +, fit) in the bottom corner; drag to pan, pinch or Ctrl+wheel to zoom, double-click toggles fit / 100 %.
  Save all to canvas. **Expand**: full screen, prev / next (‹ ›, arrow keys, swipe on phone), centred zoom bar (− % + · Fit
  · 100%), minimap (click to jump), PNG export, source panel that validates live; edits can be applied to the note
  (replaces that block), plus In note · To canvas · Export… · Copy.
- **Media**: players (a line that is only a YouTube / Vimeo / video / audio URL, or `![name.mp4](…)`, same rule as
  `video-notes.ts`) + inline links that look like a video ("Plain link, detected as video"). The player is the note's own
  player markup (`video-players.ts`), with a scrubber showing the note's `[mm:ss]` ticks and a speed button. Add timestamp
  writes `[mm:ss] ` on a new line after that player's last timestamp. Dock above note turns on the video dock and goes to
  the editor. "Show player?" (asked once per URL, `lumen.media.asked`) moves the link onto its own line so it renders as a
  player.
- **Links**: grouped Web / Video / PDF / Notes / Broken with filter chips and use counts. Broken = a `[[wikilink]]` to a
  missing note, or a web link the link check found failing (`lumen.linkcheck` `{url: {status, since}}`, checked once a
  day per note when online, or with "Check links"). The preview pane renders a page **snapshot**
  (`GET /api/links/snapshot`: title, description, image, headings, ≤ 2,400 chars of text), kept on the device
  (`lumen.snap.<url>`, last 60, saved ones kept) so it opens offline. Open · Show as card in note (the URL on its own line
  renders as a link card) · Save snapshot. Phone: tap a row → preview sheet.

## Assistant

Right panel 360 px (phone: sheet at 72 %, drag up for full screen), header with the usage chip (today's share of the
daily free AI, red "Limit" when reached; click → Settings › AI), history (this note's conversations, New conversation,
Open in Ask) and collapse to the rail (44 px; Ctrl/⌘ J toggles, `lumen.assistant.rail`).

- **Context chips**: This note (scope = the note + its links), Selection (the current selection in the editor or preview,
  sent first as passage [1]), notes / PDFs added with "+ Add". Each chip can be removed.
- **Answers** come from the Ask chat engine, slot `assistant` (see `docs/CHAT_AND_TUTOR.md`), cited ("1 · This note ›
  “The √d scaling…”"). Actions: Insert below (after the editor selection, else at the end), Replace selection (editor),
  Card (a `Question :: Answer` line under `## Flashcards`; for "Make flashcards" results all cards), Copy.
- **Quick actions** with typical neuron cost (from `TYPICAL` in `lib/ai-usage.ts`): Summarize this note, Make flashcards,
  Explain the selection, Suggest tags (→ Add tags), Quiz me, Draw a diagram of this (Worker `/api/ai` action `diagram`).
  Their results are kept in the conversation (`ChatMessage.action`).
- **Only from my notes** (on by default, `lumen.assistant.onlyNotes`): off = general-knowledge fallback, labelled.
- **States**: daily limit reached (dimmed quick actions, "Back tomorrow" composer, card with the reset time and See usage),
  offline (card + Retry), locked (Unlock).

## Worker routes

`GET /api/links/snapshot?url=` and `POST /api/links/check {urls}` (auth, http(s) only, private hosts refused, edge-cached
6 h). `/api/ai` gained the `diagram` action; `/api/ai/tutor` gained `ask`.
