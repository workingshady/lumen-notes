# Demo data

`src/lib/demo.ts` seeds the local database with the sample content of the Claude Design handoff
(`design/handoffs/2026-11-13-rounds-1-3/project/*.dc.html`), so app screenshots can be compared 1:1 with the designs.

- `DEMO_NOW`: Fri 13 Nov 2026, 21:41 local (status-bar time + "Friday, 13 November" in Lumen 01).
- `seedDemo(db)`: clears spaces, notes, folders, versions, cards, sessions, attachments and blobs (not `meta`), then writes everything below with fixed ids. Every record has `dirty: 0`, so nothing is pushed.
- `DEMO_SETTINGS`: Lamplight, serif 17 px, measure 68, blog "Night Shift Notes", tagline "Learning in public, one lamp-lit page at a time", author "Amir Hakim" (greeting shows "Amir"), avatar 🦉.

Timestamps are relative to `Date.now()`: minute/hour items ("12m", "2 h ago") are exact offsets, day items ("Yesterday", "Mon", "3 Nov") keep their local time and move by whole days. With the clock pinned to `DEMO_NOW`, every label and due date matches the design. Due dates in Markdown (`📅`) are written relative to today too.

## What is seeded

| Piece | Values | Source |
| --- | --- | --- |
| Spaces | 📥 Inbox (3 notes) · 🧠 ML Foundations (course, #A371F7, 94 notes, 62%, target 20 Dec = 37 days, Coursera · Stanford Online) · 🕌 Arabic Grammar (course, #39C5CF, 41 notes, 34%) · 🚀 Thesis: Sparse attention (project, #E8893A, deadline 12 Feb 2027 = 91 days, 41% of time used) · 🌐 Networking (area, #57AB5A, 28 notes) · 💪 Health & sleep (area, #E5534B) · 📚 Math reference (resource, #E3B341, 63 notes) · 3 archived spaces | Lumen 03 (switcher 1D), ScreenCourse (switcher, "Archived 3"), LumenSidebar |
| ML folders | 01 Linear algebra #39C5CF (8) · 02 Optimization #E8893A (12) · 03 Neural networks #A371F7 (9) · 04 Probability #57AB5A (6) · 05 Unsupervised #E3B341 (5) · 90 Exams #E5534B (4) | LumenSidebar, Lumen 02 (4D), Lumen 04 (graph legend) |
| 02 Optimization notes | Gradient descent (12m, pinned, learning, full source) · Learning rate schedules (1h) · Convexity & minima (Yesterday) · Momentum & Nesterov (Mon) · Adam optimizer (3 Nov, pinned) · Newton's method (28 Oct) · Problem set 3 (24 Oct); excerpts, tags and statuses as listed; + 5 more (Loss functions, Line search, Saddle points, Gradient descent — slides, Optimization cheat sheet) | ScreenWorkspace, Lumen 02 |
| Gradient descent body | ScreenWorkspace source verbatim, followed by an extra "More cards" section (12 cards total, Lumen 05b kanban) | ScreenWorkspace, Lumen 05 (12A card) |
| Linear algebra: eigenvectors | Full read-mode note (callouts, mermaid, python, table, folded question, practice tasks, footnotes) + 12 cards; updated 2 h ago, review | Lumen 02 (5A), ScreenCourse side sheet |
| Status counts (ML space) | todo 18 · learning 24 · review 11 · mastered 41 = 94 | Lumen 01 (Learning progress), Lumen 05b (kanban) |
| Tags | #ml 34 · #math 21 · #optimization 9 · #exam 7 (other tags stay ≤ 6, so these four lead) | LumenSidebar |
| ML roadmap | 01 LA 4/6 (67%) · 02 Optimization 3/6 (50%) · 03 NN 1/6 (17%) · 04 Probability 8/8 (Done) → 16/26 = 62%, 4 learning, Continue: Eigenvectors, GD overdue (12 Nov), Eigenvectors due 18 Nov, SVD locked "needs Eigenvectors" | ScreenCourse, Lumen 03 (1E), LumenSidebar |
| Thesis | Milestones Proposal ✓ 2 Sep · Literature review ✓ 14 Oct · Experiments 12 Dec · First draft 20 Jan · Submission 12 Feb; task board Todo 5 / Doing 2 (`[/]`) / Done 14 from 9 notes; recent notes Results log (1 h), Experiments plan (Yesterday), Block-sparse kernel notes (Tue), Meeting 6 Nov — Dr. Lim, Lit review: efficient transformers (2 Nov), Thesis outline (28 Oct); "Attention, explained" embeds note | Lumen 03 (1G), Lumen 08 (2A) |
| Tasks | Overdue: Ask Dr. Lim (10 Nov), Finish Problem set 3 Q1 (12 Nov) · Today: Problem set 3 Q2, Read Strang §6.2 · Upcoming: Longformer baseline (17), Derive PCA (18), Memorise idafa examples (19) · No date: Draw TCP state diagram, Find a video on KL divergence | Lumen 05b (14A), Lumen 01 ("4 tasks · 2 overdue") |
| Flashcards | 125 cards, all with Card records. 23 due now across 4 decks (Gradient descent 11, eigenvectors 5, idafa 4, verb forms 3); card 7 is the GD η card marked New; 14 due tomorrow | LumenSidebar (Review 23), Lumen 01, Lumen 05 (12A–C), Lumen 06b (22C) |
| Study sessions | Streak 12 days, best 31; 400 min (6 h 40 m) in the last 7 days; today 1 h 05 min on "Arabic grammar: idafa"; Thu 6 Nov 48 min; older days follow the design's heatmap formula | Lumen 01 (heatmap), Lumen 05b (16A, calendar) |
| Versions | Gradient descent · 23 versions: 21:12 auto-save, 19:40 "Before exam rewrite", Yesterday 23:05, Mon 20:18, "Restored from 8 Nov", Sat 8 Nov 18:02 "First draft", + auto-saves | Lumen 04 (11A/11B) |
| Canvases (6) | Backprop study board (JSON Canvas: Forward/Backward groups, Idea, Layer, Chain rule, Open question, Checked, 2 file cards, cs231n link, 4 labelled edges) · Optimizers map · TCP state machine | CanvasBoard, Lumen 04 (10B JSON) |
| Whiteboards | Study plan — November: `lumenPending` skeletons (frame "Week 3", 6 stickies in the design colours, "see the plot", loss-curve placeholder, forward → loss ok? → ship it); Arabic sentence diagrams; Thesis architecture sketch | WhiteboardBoard, Lumen 07, Lumen 07b |
| Slides | Backprop — study group deck (12 slides: title, bullets, image, video, mermaid layouts) · Gradient descent — slides (12 slides, speaker notes on slide 4) | Lumen 11, SlideFrame, Lumen 05 (13A) |
| Bidi note | الإضافة في اللغة العربية, block for block | NoteBidi, Lumen 08 |
| Arabic grammar: idafa | Focus-mode text, properties (course, source, due, difficulty), 6 cards incl. "In an idafa, what happens to the first noun?" | Lumen 02 (7A), Lumen 05b (16A), Lumen 05 (12D) |
| Arabic: verb forms I–X | 40 cards (4 per form; card 7 = Form II meaning), pinned, shared | Lumen 10b, Lumen 01 (Pinned) |
| TCP handshake | AI-panel note text, mastered, Tue | Lumen 05b (17A), Lumen 01 |
| Blog | 12 published posts: #ml 6 · #math 4 · #arabic 3 · #networking 2; top four: Eigenvectors, the directions a matrix leaves alone (12 Nov) · Idafa in five examples (5 Nov) · Gradient descent, gently (29 Oct, slug gradient-descent-gently) · The TCP handshake, slowly (18 Oct) | Lumen 06b, ShareSheet |
| Shared links (5) | ML Foundations space `m8Lq2Vd` · Gradient descent `k3f9Xq2` · Backprop — study group deck `p2Wn7Ra` · Arabic: verb forms I–X `f6Hc1Tz` · Study plan — November `w4Kd8Ys` | Lumen 09, ShareSheet |
| Pinned | ML Foundations — map of content (24 links), Exam 2 cheat sheet (due 28 Nov), Arabic: verb forms I–X (ids sort first) + Gradient descent, Adam | Lumen 01, ScreenWorkspace |
| Daily notes | `Journal YYYY-MM-DD` for 2–6 and 9–13 Nov (Health & sleep space) | Lumen 05b (calendar) |
| Attachments | Storage "largest files" metadata (entropy-per-layer.mp4 92 MB, lecture-07-attention.m4a 61 MB, backprop-demo.webm 48 MB, vaswani pdf 2.1 MB, whiteboard-photo.jpg 9.8 MB); real SVG blobs for feature-maps and loss-curve | Lumen 11 (4D) |

## Known gaps (the designs contradict each other)

- Thesis "48% of tasks done" vs the board's 5 / 2 / 14: the board wins (shows 67%).
- Roadmap "14 of 23 topics" with 62% can't both hold (14/23 = 61%); 62% and the per-module counts win (16 of 26).
- Home "Continue" (Gradient descent, eigenvectors, idafa, TCP, Backprop) vs the workspace times: Learning rate schedules (1h) and Results log (1h) also rank near the top.
- Home "3 notes to revisit" vs Review 11 in the same screen: status counts win (11).
- Sidebar Tasks 5 vs 14 open tasks across all spaces (Tasks view lists 9; Gradient descent's "Mini-batch + momentum" and extra thesis todos add the rest).
- Weekday names follow 2026 (Fri 13 Nov); some design labels ("Mon 10 Nov", "Tue 18 Nov") use 2025 weekdays.
- Opening the Study plan whiteboard converts the skeletons and saves (that save marks the note dirty).
- Blog pages are served by the Worker, so locally seeded posts show only in the in-app lists.
