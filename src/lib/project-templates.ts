// Project doc templates (PRD, RFC, ADR, requirements, action plan, meeting notes, spec, draft).
// Front-matter `doc` + `docstatus` make a note show up in the project hub's Docs tab.
import type { DocKind } from "./project";

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const DOC_TEMPLATES: Record<DocKind, (title: string) => string> = {
  prd: (t) => `## Summary
One paragraph: what we're building and why now.

## Problem
Who has the problem, how often, and what it costs them today.

## Users & use cases
- **Primary user:** …
- Use case 1: …

## Goals
- …
## Non-goals
- …

## Requirements
- REQ-1 (must) …
- REQ-2 (should) …
- REQ-3 (could) …

## Success metrics
| Metric | Today | Target |
|---|---|---|
| … | … | … |

## User flow
\`\`\`mermaid
flowchart LR
  A[User opens feature] --> B{Has data?}
  B -->|yes| C[Show result]
  B -->|no| D[Guide to add data]
\`\`\`

## Risks & open questions
> [!question] Open
> …

## Milestones
- [ ] Spec approved @due(${inDays(7)}) #epic/${t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20) || "mvp"}
- [ ] MVP behind flag @due(${inDays(21)})
- [ ] GA @due(${inDays(35)})
`,
  rfc: () => `## Summary
What this proposes, in three sentences.

## Motivation
Why this is needed; link the PRD: [[ ]]

## Detailed design
### Architecture
\`\`\`mermaid
flowchart LR
  Client --> API --> Service --> DB[(Database)]
\`\`\`

### API
\`\`\`http
POST /v1/…
\`\`\`

### Data model
| Field | Type | Notes |
|---|---|---|

## Alternatives considered
1. **Option A**: …, rejected because …
2. **Option B**: …

## Drawbacks & risks
- …

## Rollout & migration
- [ ] Behind a feature flag ~1d
- [ ] Shadow traffic ~2d
- [ ] Gradual rollout 10% → 100%

## Unresolved questions
- …
`,
  adr: () => `## Context
What forces are at play; what we need to decide.

## Options
1. **…**: pros / cons
2. **…**: pros / cons

## Decision
We will …

## Consequences
- Positive: …
- Negative: …
- Follow-ups: - [ ] …

> [!note] ADRs are immutable. If this changes, write a new ADR that supersedes this one (set this one's status to superseded).
`,
  requirements: () => `Priorities use MoSCoW: must · should · could · wont. Link tasks to requirements by writing the id in the task (e.g. \`- [ ] Build upload endpoint REQ-1\`).

## Functional
- REQ-1 (must) …
- REQ-2 (must) …
- REQ-3 (should) …

## Non-functional
- REQ-4 (must) p95 latency under 300 ms
- REQ-5 (should) Works offline for viewing
`,
  plan: () => `## Goal
What "done" looks like.

## Steps
- [>] Research & spike ~2d !p2 #epic/discovery
- [ ] Write the RFC ~1d !p1 @due(${inDays(5)}) #epic/design
- [ ] Build the core ~5d !p1 @due(${inDays(14)}) #epic/build
- [ ] Tests & review ~2d @due(${inDays(17)}) #epic/build
- [ ] Release + announce ~1d @due(${inDays(21)}) #epic/launch

Markers: [>] backlog · [ ] todo · [/] doing · [?] review · [x] done · [-] cancelled. Inline: !p1 priority, ~3d estimate, @due(2026-12-01) due, @start(2026-11-20) start, #epic/name, @owner, REQ-12.
`,
  meeting: () => `**Date:** ${today()} · **Attendees:** @…

## Agenda
1. …

## Notes
- …

## Decisions
- …

## Action items
- [ ] … @owner @due(${inDays(3)})
`,
  spec: () => `## Overview

## Sequence
\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant M as Model
  U->>A: request
  A->>M: inference
  M-->>A: result
  A-->>U: response
\`\`\`

## Data model
\`\`\`mermaid
erDiagram
  USER ||--o{ ITEM : owns
\`\`\`

## Edge cases
- …
`,
  draft: () => `Start writing. Change the doc type (header) when it becomes a PRD, RFC or decision.\n`,
};
