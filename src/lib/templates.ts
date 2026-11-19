import type { NoteType, Status } from "../../shared/types";

export interface Template { id: string; name: string; type: NoteType; status?: Status; title: string; body: string; hint: string }

const today = () => new Date().toISOString().slice(0, 10);

export const TEMPLATES: Template[] = [
  { id: "blank", name: "Blank note", type: "note", title: "Untitled", hint: "Empty page", body: "" },
  {
    id: "lesson", name: "Lesson", type: "lesson", status: "learning", title: "New lesson", hint: "Objectives, notes, summary, questions",
    body: `## 🎯 Objectives
-

## 📝 Notes


## 🔑 Key terms
Term :: Definition

## 🧠 Summary
> [!summary]
> In one paragraph…

## ❓ Questions to review
- [ ]
`,
  },
  {
    id: "cornell", name: "Cornell notes", type: "lesson", status: "learning", title: "Cornell notes", hint: "Cues · notes · summary",
    body: `| Cues / questions | Notes |
|---|---|
| | |
| | |

> [!summary] Summary
>
`,
  },
  {
    id: "journal", name: "Daily journal", type: "journal", title: `Journal ${today()}`, hint: "What I learned today",
    body: `## Today I learned
-

## Struggled with
-

## Tomorrow
- [ ]

#journal
`,
  },
  {
    id: "flashcards", name: "Flashcard deck", type: "flashcards", status: "review", title: "New deck", hint: "Q :: A cards with spaced repetition",
    body: `What is the derivative of $x^2$? :: $2x$
Capital of Egypt :: Cairo

Explain the TCP three-way handshake
?
SYN → SYN-ACK → ACK
`,
  },
  {
    id: "slides", name: "Slide deck", type: "slides", title: "New deck", hint: "--- separates slides",
    body: `# Title slide
Subtitle

---

## Agenda
- Point one
- Point two

---

## Diagram
\`\`\`mermaid
flowchart LR
  A[Idea] --> B[Draft] --> C[Publish]
\`\`\`

---

## Thank you
`,
  },
  {
    id: "post", name: "Blog post", type: "post", title: "New post", hint: "Publishable article",
    body: `> [!abstract] TL;DR
> One-sentence summary.

## Introduction


## What I learned


## Conclusion
`,
  },
  {
    id: "roadmap", name: "Course roadmap", type: "roadmap", title: "Roadmap", hint: "Modules → topics with status & prerequisites",
    body: `## Module 1: Foundations
- [ ] Topic one
- [ ] Topic two (needs: Topic one)

## Module 2: Core
- [ ] Topic three (needs: Topic two)
- [ ] Topic four

<!-- Status marks: [ ] todo · [/] learning · [x] done · [-] skipped
     Add a due date with 📅 2026-12-01 and link a lesson with → [[Note title]] -->
`,
  },
  {
    id: "moc", name: "Map of Content", type: "moc", title: "Topic MOC", hint: "Hub note linking a topic",
    body: `## Overview


## Notes
- [[ ]]

## Open questions
-
`,
  },
  {
    id: "meeting", name: "Meeting / class", type: "note", title: `Class ${today()}`, hint: "Attendees, notes, actions",
    body: `**Date:** ${today()}

## Notes


## Action items
- [ ]
`,
  },
  {
    id: "base", name: "Base (database view)", type: "base", title: "New base", hint: "Table, board, gallery & calendar of notes",
    body: `Notes shown as a database. Change views with the toolbar, or edit the YAML below (Obsidian Bases format).

\`\`\`base
views:
  - type: table
    name: All notes
    order:
      - file.name
      - type
      - status
      - space
      - file.tags
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
\`\`\`
`,
  },
  {
    id: "base-lessons", name: "Lessons by status × course", type: "base", title: "Lessons by status × course", hint: "Base: board by status, table grouped by course",
    body: `Every lesson in one place: drag a card to change its status, group the table by course (space).

\`\`\`base
filters:
  and:
    - type == "lesson"
views:
  - type: board
    name: By status
    groupBy:
      property: status
      direction: ASC
    order:
      - file.name
      - space
      - file.tags
  - type: table
    name: By course
    groupBy:
      property: space
      direction: ASC
    order:
      - file.name
      - status
      - space
      - file.tags
      - file.mtime
    sort:
      - property: status
        direction: ASC
  - type: cards
    name: Gallery
    order:
      - file.name
      - status
      - space
  - type: calendar
    name: Calendar
    date: file.mtime
\`\`\`
`,
  },
  {
    id: "whiteboard", name: "Whiteboard", type: "whiteboard", title: "New whiteboard", hint: "Freehand drawing, shapes, stickies (Excalidraw)",
    body: "",
  },
  {
    id: "canvas", name: "Canvas", type: "canvas", title: "New canvas", hint: "Infinite board (JSON Canvas)",
    body: JSON.stringify({ nodes: [{ id: "n1", type: "text", text: "# Central idea", x: 0, y: 0, width: 260, height: 120, color: "6" }], edges: [] }, null, 2),
  },
];

export const ROADMAP_PRESETS: { name: string; body: string }[] = [
  { name: "Blank roadmap", body: TEMPLATES.find((t) => t.id === "roadmap")!.body },
  {
    name: "Learn a language",
    body: `## Module 1: Basics
- [ ] Alphabet & pronunciation
- [ ] 100 core words (needs: Alphabet & pronunciation)
- [ ] Greetings & introductions

## Module 2: Grammar
- [ ] Present tense (needs: 100 core words)
- [ ] Past tense (needs: Present tense)
- [ ] Questions & negation

## Module 3: Fluency
- [ ] Daily conversation practice (needs: Past tense)
- [ ] Read a short story
- [ ] Write a journal entry
`,
  },
  {
    name: "CS fundamentals",
    body: `## Module 1: Programming
- [ ] Variables, types, control flow
- [ ] Functions & recursion (needs: Variables, types, control flow)

## Module 2: Data structures
- [ ] Arrays & linked lists (needs: Functions & recursion)
- [ ] Stacks & queues (needs: Arrays & linked lists)
- [ ] Hash tables (needs: Arrays & linked lists)
- [ ] Trees & graphs (needs: Stacks & queues)

## Module 3: Algorithms
- [ ] Big-O notation
- [ ] Sorting (needs: Big-O notation)
- [ ] Graph search BFS/DFS (needs: Trees & graphs)
- [ ] Dynamic programming (needs: Functions & recursion)

## Module 4: Systems
- [ ] How the CPU & memory work
- [ ] Operating systems & processes
- [ ] Networking: TCP/IP, HTTP
`,
  },
  {
    name: "Web development",
    body: `## Module 1: Web basics
- [ ] HTML semantics
- [ ] CSS layout: flexbox & grid (needs: HTML semantics)
- [ ] JavaScript fundamentals

## Module 2: Frontend
- [ ] DOM & events (needs: JavaScript fundamentals)
- [ ] TypeScript (needs: JavaScript fundamentals)
- [ ] React (needs: DOM & events)

## Module 3: Backend
- [ ] HTTP & REST APIs
- [ ] SQL databases
- [ ] Auth & security (needs: HTTP & REST APIs)

## Module 4: Ship it
- [ ] Deploy to Cloudflare Workers (needs: HTTP & REST APIs)
- [ ] Testing & CI
`,
  },
];
