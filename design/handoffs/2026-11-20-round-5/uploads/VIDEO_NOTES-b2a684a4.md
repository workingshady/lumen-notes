# Video notes with timestamps

Course lesson notes usually start with the lesson video. Lumen turns `[12:34]` in such a note into a chip that
plays the video from that moment, and lets you add those timestamps while you watch.

## Syntax (plain Markdown)

| You write | Meaning |
|---|---|
| `[12:34]` | Play the note's first player from 12 min 34 s |
| `[1:02:03]` | Hours form (1 h 2 min 3 s) |
| `[125:30]` | Minutes may go up to 3 digits |
| `[12:34](#video-2)` | Play the note's **second** player from 12:34 |
| `\[12:34]` | Literal text, no chip |

Rules (exact):

- Pattern: `[` + `M:SS` or `H:MM:SS` + `]`. `M` = 1–3 digits, `H` = 1–2 digits, `MM`/`SS` = two digits `00`–`59`.
  `[12:60]`, `[1:2]`, `[ab:cd]` are not timestamps.
- Anywhere in a line: at the start (`[12:34] Backprop intuition`), inline (`At [3:10]: the loss…`), inside a list
  item, a callout, a table cell or a flashcard (`What is a neuron? [1:30] :: …`).
- Followed directly by `(`: only `(#video-N)` (N = 1–99) makes it a targeted timestamp; anything else, e.g.
  `[12:34](https://…)`, stays a normal Markdown link. Followed directly by `[`: a reference link, not a timestamp.
- Never matches footnotes `[^1]`, task boxes `[ ]` / `[x]`, wiki links `[[…]]`, inline code or code blocks.
- Players are counted top to bottom in the note: a line that is only a YouTube / Vimeo / video-file / audio-file
  URL, or a media embed `![name](url)` / uploaded `![lecture.mp4](att:id)`. `#video-2` = the second of those.
  Audio files count too (lectures recorded as audio).
- Other apps show `[12:34]` as plain text and `[12:34](#video-2)` as an anchor link: the format degrades cleanly.

## Reading (Read mode, split preview, shared pages, blog)

- A chip click seeks the targeted player and plays. A YouTube / Vimeo player that is still a thumbnail loads
  (privacy-first: nothing from YouTube loads before this click) and starts at that time.
- Every Lumen player gets a small row under it: speed (0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×) and, while an editor is
  open, **Timestamp** and **Flashcard at this moment**. Audio keeps its own speed button.
- A chip with no player at that position turns grey ("No video at this position in the note").

## Writing

- **Alt+T** (or **Ctrl/Cmd+Alt+T**) inserts `[mm:ss] ` for the video that is playing (the last player you used),
  on the caret's line if it is empty, else on a new line below. If that player is not the note's first one, it
  writes `[mm:ss](#video-N) `. No conflicting key existed in Editor.tsx / editor-blocks.ts.
- The `/` menu has **Timestamp** (Media & embeds) doing the same.
- The **video bar** above the editor (only in notes with a video, or while one plays): play/pause + current time,
  Timestamp, Flashcard, speed, **Pause while typing**, **Dock video**.
- **Flashcard at this moment** inserts ` [12:34] :: ` on a new line with the caret at its start: type the question,
  press End, type the answer. It is a regular `Q :: A` card, so it appears in Review.
- **Pause while typing** (off by default, remembered in `localStorage["lumen.video.pauseTyping"]`): after you insert
  a timestamp while the video plays, your first keystroke pauses it; it resumes when you press Enter on an empty
  line, or after 4 s without typing. Playing / pausing by hand cancels it.
- Timestamps are tinted in the editor; **Ctrl/Cmd+click** one plays from there.

## Dock (phone and split view)

- **Dock video** pins the note's player above the editor (phone: full width, at most 30% of the screen height;
  desktop: up to 560 px wide). You write below it; timestamps stay tappable. Remembered in
  `localStorage["lumen.video.dock"]`. With several players, a select picks which one is docked.
- The split preview re-renders as you type, which would restart an embedded player. So when a video playing in
  the preview is re-rendered while an editor is open, it continues in the dock at the same time and speed (one
  reload). Without an editor (Read mode) a re-rendered player continues in place.

## Code

- `src/lib/video-notes.ts` — pure: parse/format times, `findTimestamps`, `timestampAt`, `videoSources`,
  insert builders, the `TypingPause` state machine. Tests: `npx tsx scripts/video-notes.test.ts`.
- `src/components/video-players.ts` — player registry and adapters: YouTube (IFrame API script
  `https://www.youtube.com/iframe_api` loaded on demand, `enablejsapi=1`; postMessage fallback if the script is
  blocked), Vimeo (postMessage Player API, no script), `<video>`/`<audio>`; chips (`hydrateTimestamps`), extras row,
  re-render hand-off.
- `src/components/editor-video.ts` — CodeMirror extension (Alt+T, Mod+click, decorations, pause while typing).
- `src/components/video-dock.tsx` — the video bar and dock above the editor.
- Hooks: `markdown.ts` (inline rule `vtimestamp`), `ws-embeds.tsx` (video section registers players),
  `Editor.tsx` (extension + bar), `slash.ts` (Timestamp command), CSS block "Video notes (D8)" in `layout.css`.

## Limits

- Vimeo speed only works when the video owner allows speed controls; private/unlisted Vimeo videos may refuse the API.
- Insert buttons on players need an open editor (split view or the dock); in Read mode they are hidden.
- Video N is counted from the rendered players; a video inside an embedded note (`![[Other note]]`) shifts the count
  in the preview.
