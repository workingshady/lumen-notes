# Claude Design follow-up #2: sharing, public pages, slides with media, files, Android

> Paste everything below the line into the **same Claude Design project** (after `CLAUDE_DESIGN_PROMPT.md` and
> `CLAUDE_DESIGN_UPDATE_01.md`). It adds and changes screens only; all tokens and rules from round 1 still apply.

---

## Context
Lumen (study notebook + personal blog) now ships these features. They work, but the current UI is a developer pass. Design them properly, keeping the Lamplight/Paper themes, one amber accent, the 4 px grid, radius 6/10/14, Inter + IBM Plex Sans Arabic, and progressive disclosure.

## 1. Sharing (unlisted links)
Three levels of visibility, shown consistently everywhere with one small badge:

| Level | Badge | Meaning |
|---|---|---|
| Private | none | Only on your devices + your Cloudflare |
| **Shared link** | 🔗 "Shared" (info blue) | Anyone with the link can view, read-only, not listed |
| **Published** | 🌐 "Published" (success green) | On the public blog `/blog`, in RSS, readable URL |

Design:
- **Share button** in every note header (next to the side-panel button) and on every space/course page. Filled state when shared or published.
- **Share sheet** (dialog on desktop, bottom sheet on phone):
  1. "Share link" row: icon, title, one-line explanation, toggle. When on: read-only URL field + Copy (turns into ✓) + Share… (native share sheet on phone) + Open. Small link: "Make a new link (old one stops working)".
  2. For spaces: a calm warning card: "Everything in this space is visible through the link, including notes you add later."
  3. "Publish to blog" row (Markdown notes only): toggle, URL slug field, excerpt field, URL row when on.
  4. Offline / sync-off state: a warning card "Sharing needs sync on", toggles disabled.
- **"Shared with link" list** in Settings → Sharing: every shared note/space with type icon, link, last updated, and a Turn off button. Bulk "Turn off all links".
- Toasts: "Link is live" / "Link turned off. Anyone who had it can no longer open it."

## 2. Public read-only pages (what visitors see)
Visitors have no account. The pages must look like a polished personal site, not an app with disabled buttons.
- **Shared course/space page** `/s/<token>`: header (emoji tile, kind label, title, description, goal/target date/course link, note count), **progress ring** on the right, tabs **Overview · Graph**. Overview: roadmap modules (status icons, locked topics dimmed, a 📄 button on topics that have a lesson) then a 2-column grid of note cards (status dot, title, 2-line excerpt, type · updated). Graph: full-width force graph, status-colored nodes, hover card, click opens the note.
- **Shared note page** `/s/<token>/<note>`: "← Back to overview", big title, "Updated 3d ago · 6 min read · #tags", reading typography identical to the blog. Wiki links inside the shared space are live; links to unshared notes show as plain text.
- **Per type**:
  - Slides: a "▶ Present" action, full-screen presenter for visitors with progress bar, ← → and swipe.
  - Flashcards: a "Practice" card (tap to reveal, Previous/Next, "nothing is saved") above the deck.
  - Canvas: a large static board preview + "Download .canvas (opens in Lumen or Obsidian)".
  - Whiteboard: view-only board with pan/zoom.
  - Roadmap: the read-only outline.
- **Footer**: avatar + "Shared from <blog name> · read-only", theme toggle (light/dark).
- **States**: loading skeleton; "Link unavailable" (lock icon, "This link doesn't exist or was turned off").
- Phone versions of all of the above.

## 3. Slides with media
Slides can contain uploaded images, image URLs, YouTube/Vimeo, uploaded video/audio, Mermaid diagrams, math, tables and code.
- Design 5 slide layouts as examples (they're written in Markdown, so this is styling, not a layout engine): **Title**, **Bullets**, **Full image** (image centered, max 62% of slide height, rounded, optional caption), **Video** (16:9 player centered), **Diagram** (Mermaid centered).
- Presenter bar: progress line on top, ← n/N →, a thumbnail strip (desktop) where image slides show "🖼 Image" and video slides show "▶ Media", "F fullscreen · Esc exit" hint.
- Phone: swipe left/right, bottom bar only.

## 4. Files & storage (free tier)
Files are stored free on Cloudflare D1 in 1.5 MB parts (max 100 MB per file, 5 GB total). No paid storage.
- **Upload progress** on an attachment while it syncs: a thin progress ring on the image/video placeholder + "Uploading 3/7 parts", and a queued state when offline ("Will upload when online").
- **Too-big file** dialog (over 100 MB): "Upload long videos to YouTube as Unlisted and paste the link" + Copy tip.
- **Settings → Storage**: a bar showing space used on Cloudflare (notes · files) of 5 GB, and on this device, plus a list of the largest files with Delete.

## 5. Android app (Capacitor APK)
- **App icon**: the lamp mark on `#0F1115` (adaptive icon: glyph inside the 66 dp safe zone). Provide a monochrome version for Android themed icons.
- **Splash**: plain `#0F1115` with the centered mark, no text.
- **First launch on phone**: 3 short steps (pick theme · name your blog · unlock sync or "stay local") with big thumb-reachable buttons.
- **Share-to-Lumen**: when the user shares a link or text from another app → a small sheet "Save to Lumen": title, target space picker, "Inbox" default, Save.
- Respect safe areas, Android back gesture closes sheets first, keyboard toolbar sits above the keyboard.

## 6. Speed and loading
Heavy screens (canvas, whiteboard, graph, roadmap, settings) now load on demand.
- Design one consistent **loading skeleton** per screen type (list, note, board, graph), shown under 300 ms only if needed. No spinners in the middle of empty pages.
- Sync indicator states (sidebar footer + phone header): Local only · Syncing… · Synced 3:42 PM · Offline · 3 queued · Sync error (tap for details).

## Deliverables for this round
Desktop (1440×900) + phone (412×915): Share sheet (note, space, sync-off), Settings → Sharing list, shared course page (Overview + Graph), shared note, shared slides presenter, shared flashcards practice, "Link unavailable", 5 slide layouts, upload progress + too-big dialog + Settings → Storage, Android icon/splash/first launch/Share-to-Lumen sheet, loading skeletons. Light (Paper) variants for the shared course page and shared note.
