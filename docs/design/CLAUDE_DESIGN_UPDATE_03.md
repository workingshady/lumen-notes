# Claude Design follow-up #3: learning paths (multi-course roadmaps) + project hub

> Paste below the line into the **same Claude Design project** (after the main prompt and updates 01–02).
> Everything from earlier rounds still applies (Lamplight/Paper tokens, one amber accent, 4 px grid, radius 6/10/14,
> Inter + IBM Plex Sans Arabic, progressive disclosure). Both features already work in the app; this round designs them properly.

---

## 1. Learning paths: one roadmap over several overlapping courses
The user learns one subject from several courses at once (e.g. ML Foundations on Coursera, Stanford CS231n on YouTube, fast.ai). Each course keeps its **own independent roadmap**. A **learning path** sits on top: a concept-first roadmap where topics taught by more than one course become **one concept** with all their material. Readable, organized, and honest about what each course covers.

### Model (already built)
- **Concept**: a name, the course topics it merges ("Gradient descent" = ML Foundations › Gradient descent + CS231n › Optimization: SGD + fast.ai › SGD from scratch), prerequisites merged across courses, status (todo / learning / done / locked), resources, lesson notes, revision schedule.
- **Stage**: an ordered group of concepts (Foundations → Core → Applied → Advanced). Plus a "Not placed yet" lane for course topics not organized yet.
- **Courses**: each has a color (from the canvas presets) used everywhere as a small bar/dot.

### Screens to design (desktop 1440 + phone 412, Lamplight + Paper)
1. **Path header**: progress ring, "Learning path · 3 courses", "8 of 19 concepts · 3 learning · 1 to revise", course chips (color dot, icon, name, done/total), "+ Courses" picker, Auto-organize, AI organize. An **overlap banner**: "3 possible overlaps between courses: same idea, different names?" expanding to rows "Backprop by hand (fast.ai) ≈ Backpropagation (CS231n) [Merge] [Different]".
2. **Stages view**: horizontal stage columns (number, editable name, done/total, thin progress bar). Concept cards: status dot or lock, name, course color dots + "3 courses", resource count, a violet "revise" pill when due. Drag between stages; a dashed "Not placed yet" column; "+ New stage".
3. **Matrix view**: rows = concepts grouped by stage, columns = courses, cells = status in that course (● done, ● learning, ○ to learn, — not covered), last column "Overlap" (2×, 3× as amber pills). This is the "what overlaps, what's missing" screen. Make it scannable.
4. **Graph view**: left→right by prerequisite depth across all courses; nodes show course color bars and a stage badge (S1…); done edges green; locked nodes dimmed; legend of courses.
5. **Timeline view**: one lane per course (topic due dates) + a "Revision" lane; pills packed in rows; today line in amber.
6. **Revise view**: one concept at a time: name, "taught in" chips, a recall prompt, resource chips; buttons "Again (tomorrow)" / "Got it"; list "Coming up".
7. **Concept side sheet** (right panel desktop, full sheet phone):
   - **Taught in**: one row per course with the topic name, course › module, due date, a status select that edits that course's own roadmap, and an open-lesson button.
   - **Prerequisites**: merged chips plus an "Unlocks" line.
   - **Resources**: video rows with ▶ Play that plays inline, articles, books and courses, each labelled with where it came from (Path or a course name), plus an add-link form.
   - **Notes**, **Revision** (next date, interval) and **Merge with another concept**.
8. **New learning path dialog**: name + course multi-select (icon, name, provider) + explanation.
9. **Learning paths list** (sidebar item "Learning paths"): cards with ring, course dots, "N to revise".

## 2. Project hub: building software (no GitHub/Bitbucket connection, links only)
For projects the user builds (e.g. "AI feature at work"). A space of kind Project becomes a **hub**:
- **Docs**: PRDs, RFCs, requirements (numbered REQ-1…, priority, status), ADR/decision log, action plans, meeting notes, drafts. Each doc type has a template, a status (Draft → In review → Approved/Superseded), owner, and links to tasks.
- **Tasks as cards**: board (Backlog / Todo / Doing / Review / Done), epics/milestones grouping, priority, estimate, due date, links to docs and requirements; list and timeline (Gantt-like) views.
- **Visualize**: Mermaid (flowcharts, sequence, gantt, C4-style), canvas architecture boards, requirement traceability (requirement → tasks → status).
- **AI project assistant**: plan from a goal, weekly status report, next actions, risks, decision summary (reads the project's notes).
- **Links**: repo / PR / design / doc URLs as link cards (no API connection).
Design: project overview (goal, deadline, health, docs by type, board preview, milestones), doc page with status header and linked tasks, requirements table, board, timeline, AI assistant panel. Desktop + phone.
