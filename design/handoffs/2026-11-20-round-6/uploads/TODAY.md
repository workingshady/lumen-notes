# Today: the study plan

Today (sidebar "Today", Home card "Today") builds each day from your course roadmaps, learning paths and due reviews.
It uses fixed rules, not AI: the same data on the same day always gives the same plan.

- Logic: `src/lib/plan.ts` (pure, tested by `scripts/today.test.ts`, run `npx tsx scripts/today.test.ts`).
- Glue and actions: `src/components/today-data.tsx`. UI: `src/views/TodayView.tsx`, `src/components/today-*.tsx`.
- Settings: Settings > Reading > Study plan (`src/views/settings-plan.tsx`), or the sliders icon on the Today page.

## Inputs

| Source | Used for |
| --- | --- |
| Course spaces with a roadmap, plus roadmaps a learning path lists in `courses:` | Topics: status (`[ ]` `[/]` `[x]` `[-]`), `(needs: …)`, `📅` dates, `→ [[lesson note]]` |
| Learning paths (notes of type `path`) | Concept locks (path-level `needs:`), "unlocks N concepts", concepts already learned in another course, `review:` dates |
| Lesson notes linked from topics | Minutes: property or front matter `duration` / `minutes` / `length` / `video_duration` (`1:12:00`, `48:30`, `45m`, `1h 20m`, `90`) |
| Flashcards (FSRS) | Number of cards due now |
| Study timer sessions | "Continue" (last note studied), done minutes, streak, missed days |
| Space prop `target` on a course | "Behind target" boost |
| Plan log note (below) | What you did / skipped / moved today, weekly goals |

## Rules

### Sections
1. **Continue**: one topic in progress (`[/]`). The one whose lesson note you last ran the study timer on; otherwise the
   in-progress topic whose lesson note was edited most recently; otherwise the first by the lesson order below.
2. **New lessons**: topics that are `[ ]` or `[/]` and unlocked:
   - the roadmap's own `(needs: …)` are all done or skipped;
   - if a learning path covers the topic, its concept is not locked by a path prerequisite and not already learned
     (learned through another course = the other courses' lessons on it are optional, so they are not planned);
   - one lesson per path concept a day (the same idea taught by two courses is learned once).
3. **Reviews**: flashcards due (one item, 15 s per card, at least 5 min), then concept revisions whose `review:` date is
   today or earlier (5 min each, at most 4, oldest first).
4. **Practice**: one learning-path concept that is unlocked and not started, to test out of (the one that unlocks the most
   concepts, then earliest stage). 10 min.

### Lesson order
Lessons are sorted by tier, then due date, then course priority, then roadmap position:

| Tier | Meaning | Reason shown |
| --- | --- | --- |
| 0 | Moved to tomorrow on the previous logged day | "moved from yesterday" |
| 1 | `📅` before today | "overdue 2 days" |
| 2 | `📅` within 7 days | "due Fri for CS231n" |
| 3 | In progress | "in progress" |
| 4 | Course with a `target` date that needs at least half the daily new-lesson cap per remaining study day | "CS231n target Dec 12: 8 left" |
| 5 | Everything else | "next in CS231n" |

"unlocks N concepts" is added when the topic's path concept is a prerequisite of others. At most two reasons are shown.
Course priority = Settings order; courses not ordered there follow by space order.

### Fitting the day
- Budget = daily minutes on a study day, 0 on a rest day. Minutes already marked done today count against it.
- Continue and Reviews are always included (reviews never wait).
- New lessons: at most "max new lessons per day"; each must fit the remaining budget (the very first item of an empty day
  may overflow, so a 90-minute lecture still fits a 60-minute day). Up to three lessons that didn't fit are listed under
  "If you have time".
- Practice only if it fits.
- Rest days (not in "Study days"): only reviews. "Plan lessons anyway" plans the day as a study day (this session only).
- Lesson minutes: from the linked note's duration property, else 30.

### Plan state
- **Start**: lessons set the topic to `[/]` (if it was `[ ]`), open the linked lesson note and start the study timer
  (no linked note: opens the course page). Flashcards open Review. Revisions open a sheet (notes, then "Got it" / "Again",
  which moves the path's `review:` ladder). Practice opens the path's test-out quiz.
- **Done**: logged; lessons also set the topic to `[x]` in the course roadmap (Undo sets it back to `[/]`).
- **Skip**: hidden today (under "Skipped or moved", undoable).
- **Move to tomorrow**: hidden today, first in line on the next day you open Today.

### Missed days and rescheduling
- Overdue = open topics whose `📅` is before today. When there are any, a banner offers to spread them.
- Missed days = study days before today without activity (timer session or a Done item), counted back to the last active
  day (within 14 days). No activity at all in 14 days counts as a fresh start, not missed days.
- Proposal: the next N study days starting today (default ceil(overdue / max new lessons), 2–7; Adjust changes N, 1–14).
  Overdue topics are taken one course at a time in priority order (round robin, each course in roadmap order), at most
  ceil(overdue / N) a day. Then any open topic dated before one of its (re)scheduled prerequisites moves to that
  prerequisite's date ("after its prerequisite").
- The before/after chart shows open topics due per day from today to the last new date (before: overdue column).
- **Accept** writes the new `📅` dates into each course roadmap (`setTopicDue`; other lines untouched). "Not now" hides
  the banner for today on this device.

### Week view
- Per day Monday–Sunday: goal = daily minutes on study days; done = study timer minutes.
- Weekly goals: `lessons` (optionally for one course: Done lesson items in Today this week), `cards` (cards reviewed this
  week), `minutes` (timer minutes this week), `revisions` (Done revision items this week).

### Streak
Days in a row, ending today (or yesterday if today has nothing yet), with a timer session or a Done item.

## Stored formats

### Plan log note (synced)
One ordinary Markdown note, id `lumen-study-plan` (fixed, so every device writes the same record), title
"Study plan log", in Inbox. It syncs like any note and can be edited by hand.

```markdown
---
lumen: study-plan
---
# Study plan log

Written by Today (see docs/TODAY.md). One section per day; you can edit it.

## Goals
- 3 lessons · CS231n
- 150 cards
- 300 minutes

## 2026-11-13
- done: Eigenvectors (30 min) ^lesson:ml-foundations:eigenvectors
- later: Neural net foundations (30 min) ^lesson:fast-ai-practical-dl:neural-net-foundations
- skip: Review 6 flashcards (5 min) ^cards
```

- Goal line: `- <n> <lessons|cards|minutes|revisions>[ · <course title>]`.
- Day line: `- <done|skip|later>: <title> (<minutes> min) ^<item id>`. Lines use no checkbox and no `::`, so they never
  show up as tasks or flashcards. Unknown lines are kept.
- Item ids: `lesson:<course slug>:<topic slug>`, `cards`, `rev:<path slug>:<concept key>`, `practice:<path slug>:<concept key>`.

### Settings (this device, `lumen.settings`)
`planDailyMinutes` (60), `planStudyDays` (weekday numbers, 0 = Sunday; default Mon–Sat), `planMaxNew` (2),
`planCourseOrder` (course titles, highest priority first).

### Course roadmaps
Only existing syntax is written: topic status marks and `📅 YYYY-MM-DD` dates.
