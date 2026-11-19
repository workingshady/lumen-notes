# Flashcards in Lumen

Every card lives in plain Markdown inside a note. Review (FSRS, `src/lib/fsrs.ts`) stores only the schedule, in `Card` records with id `<noteId>:<card key>`. Parser: `flashcards(md)` in `src/lib/parse.ts`.

## 1. Basic cards (unchanged)

```
Question :: Answer
- Capital of Egypt :: Cairo

Explain the TCP handshake
?
SYN, SYN-ACK, ACK
```

Key: hash of the question.

## 2. Cloze (fill in the blank)

Anki-compatible syntax, in **any** note:

```
The {{c1::mitochondria}} is the {{c2::powerhouse}} of the {{c1::cell}}.
The {{c1::heart::organ}} pumps blood.        <- "::organ" is a hint shown in the gap
```

- Same number in one block = one card (all its gaps open together); different numbers = separate cards.
- A **block** is one paragraph (consecutive plain lines), or one list item, heading, table row or quote line. Numbers are per block, so `c1` in two paragraphs makes two cards.
- Math and Markdown work inside a cloze: `{{c1::$2x$}}`, `{{c1::**bold**}}`. Clozes inside code (fenced or inline) and `$$` blocks are ignored. `Q :: A` lines never become clozes.

### `==text==` as cloze

`==text==` is also a cloze, **but only in notes with `type: flashcards` or `cloze: true` in the front matter**:

```
---
type: flashcards          # or: cloze: true
---
Paris is the ==capital== of France.
```

Everywhere else `==text==` stays a reading highlight (the Focus highlighter saves highlights this way). Coloured highlights, `==text=={.hl-green}`, are never clozes. In a block, each `==…==` is its own card, numbered after the highest `{{cN}}` of that block.

### Card ids

`cz<n>-<hash of the block text>`. Editing other paragraphs keeps every schedule; editing the sentence itself starts that sentence's cards fresh.

### How it looks

- Read mode: the answer text with a subtle underline (no reveal).
- Editor: the same underline plus a small "N cards" chip at the end of the block's first line.
- Review: front = the block with the gap as `[…]` (or `[hint]`), other clozes shown as plain text; back = the block with the answer highlighted. Grades, suspend, edit (jumps to the block), undo and swipe work as for basic cards.

Internal review markup (generated, not for writing by hand): `{{?::hint}}` renders a gap, `{{!::answer}}` a revealed answer.

## 3. Image occlusion

A fenced block, in YAML (what Lumen writes) or JSON:

````
```occlusion
id: oc-k3f9
image: att:4f2a91c0-…          # attachment (uploads, PDF area captures), or an https:// URL
alt: Transformer block
mode: hide-one                 # hide-one = hide one, show others · hide-all = hide all, guess one
boxes:
  - {id: b1, x: 0.112, y: 0.08, w: 0.21, h: 0.06, label: Multi-head attention}
  - {id: b2, x: 0.112, y: 0.31, w: 0.21, h: 0.06, label: Add & norm, group: norm}
  - {id: b3, x: 0.112, y: 0.52, w: 0.21, h: 0.06, label: Add & norm, group: norm}
```
````

```json
{"id": "oc-k3f9", "image": "att:4f2a…", "mode": "hide-all",
 "boxes": [{"id": "b1", "x": 0.1, "y": 0.08, "w": 0.2, "h": 0.06, "label": "Encoder"}]}
```

- `x`, `y`, `w`, `h` are fractions of the image size (0 to 1, origin top-left), so boxes survive resizing.
- Block-style YAML (`- id: b1` with indented keys) is read too.
- Each box is one card; boxes with the same `group` form one card (hidden and revealed together). Order of `boxes` = review order.
- Card key: `oc-<block id>-<box id>` or `oc-<block id>-g.<group>`. Moving, resizing or relabelling a box keeps its schedule. New boxes get the next free `b<n>` id. A hand-written block without `id` uses a hash of the image until the editor saves it with a permanent id.
- A block without an image makes no cards.

### Editor

- Slash menu: **Image occlusion** inserts an empty block and opens the editor (pick an image from the note, upload one, or paste a link).
- On a line that is only an image (`![](att:…)`), a **Make image cards** chip appears while the cursor is on it.
- On an existing block, the **Edit boxes · N cards** chip on the fence line opens it.
- Drag on the image to draw a box; drag a box to move it; drag its corner handles to resize; Delete removes the selected box. Zoom with Ctrl + wheel, the +/- buttons or a two-finger pinch; pan with the hand tool or two fingers. The box list (side panel on desktop, bottom sheet on phone) edits labels, groups and order. Ctrl+Enter saves.

### Review and Read mode

- Review, hide-one: the target box is solid accent, the others are outlined. Hide-all: every box is solid, the target is accent. Showing the answer turns the target into an accent outline and shows its label.
- Read mode: the image with outlined boxes and an "N cards" chip.

## 4. Scheduling settings and the review log

Settings › Reading › Review › **Advanced** (Lumen 20 · A12):

- **Max interval** (days, default 36500): no answer schedules a card further out.
- **New cards a day** (default 0 = no limit): never-reviewed cards shown in Review / due counts are capped; new cards started today (from the review log) count against it.
- **Learning steps** / **Relearning steps** (minutes or hours under a day, e.g. `1m 10m`, default `1m 10m` / `10m`).
- **Optimize from history**: fits the 21 FSRS-6 weights to your review log (`src/lib/fsrs-optimize.ts`). It replays every card's logged reviews with FSRS-6, scores the predicted recall of each review a day or more after the previous one with log loss, pretrains the four initial stabilities per first rating (golden-section search) and then runs a coordinate descent over all weights inside the FSRS-6 bounds, with an L2 pull toward the defaults. Needs at least 50 such reviews. This is a derivative-free stand-in for the official fsrs-optimizer (gradient descent in PyTorch/Rust), not a port of it. "Use defaults" drops the fitted weights.

These values live in the device's settings (`lumen.settings`: `fsrsMaxInterval`, `fsrsNewPerDay`, `fsrsLearningSteps`, `fsrsRelearningSteps`, `fsrsWeights`, `fsrsFit`).

**Review log** (new synced record, kind `review`, Dexie table `reviews`, DB version 2): one row per graded card:

```json
{ "id": "…", "cardId": "<noteId>:<key>", "noteId": "…", "at": 1794598867341, "grade": 2,
  "state": "review", "elapsed": 3.02, "scheduled": 9, "updatedAt": 1794598867341, "deleted": 0 }
```

`grade` 0 Again · 1 Hard · 2 Good · 3 Easy; `state` = the card's state before the review; `elapsed` / `scheduled` in (fractional) days. Undo in a review session marks the row deleted. Older clients ignore the new kind (sync skips unknown kinds).
