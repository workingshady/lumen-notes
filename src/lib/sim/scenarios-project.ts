// Dev simulator scenario: a software project hub ("AI feature at work") with PRD, RFC, ADRs, requirements,
// an action plan, meeting notes and task cards in every state.
import { clock, emptyVault, INBOX, note, space, type Vault } from "./kit";

export async function seedProject(): Promise<Vault> {
  const c = clock();
  const d = (n: number) => c.iso(n);
  const v = emptyVault();
  v.spaces.push(INBOX, space({
    id: "pj-s", name: "Smart Summaries (AI feature)", kind: "project", icon: "glyph:robot-arm", color: "6", sort: 1, createdAt: c.at(24), updatedAt: c.ago(30),
    description: "LLM summaries for support tickets, shipped behind a flag.",
    props: {
      goal: "Ship AI ticket summaries to 100% of agents with p95 < 2 s and ≥ 4/5 helpfulness",
      deadline: d(26),
      links: JSON.stringify([
        { label: "Repo · support-app", url: "https://github.com/example/support-app" },
        { label: "PR #482 · summary API", url: "https://github.com/example/support-app/pull/482" },
        { label: "Figma · summary panel", url: "https://www.figma.com/file/example" },
        { label: "JIRA · SUP-1200 epic", url: "https://example.atlassian.net/browse/SUP-1200" },
      ]),
    },
  }));
  const P = "pj-s";
  const fm = (doc: string, status: string, owner = "amir") => `---\ndoc: ${doc}\ndocstatus: ${status}\nowner: ${owner}\n---\n`;
  v.notes.push(
    note({ id: "pj-prd", space: P, title: "PRD: Smart Summaries", updated: c.at(6), body: `${fm("prd", "approved")}# PRD: Smart Summaries

## Summary
Agents read 30+ message threads before replying. A 3-line AI summary at the top of each ticket cuts handling time.

## Problem
Median time-to-first-reply is 14 min; 40% of it is reading history.

## Goals
- Cut time-to-first-reply by 25%
- Helpfulness ≥ 4/5 in agent feedback
## Non-goals
- Auto-replying to customers

## Requirements
- REQ-1 (must) Show a ≤ 3-sentence summary on tickets with ≥ 5 messages
- REQ-2 (must) p95 generation latency under 2 s
- REQ-3 (must) No PII leaves our region (EU tenants)
- REQ-4 (should) Agents can rate a summary 👍/👎
- REQ-5 (should) Summaries refresh when new messages arrive
- REQ-6 (could) Summaries in the customer's language
- REQ-7 (wont) Auto-send replies

## Success metrics
| Metric | Today | Target |
|---|---|---|
| Time to first reply | 14 min | 10.5 min |
| Helpfulness | n/a | ≥ 4/5 |

## User flow
\`\`\`mermaid
flowchart LR
  T[Ticket opened] --> C{≥5 messages?}
  C -->|yes| S[Fetch summary]
  S --> P[Show panel]
  C -->|no| N[No panel]
  P --> R[Agent rates 👍/👎]
\`\`\`
` }),
    note({ id: "pj-rfc", space: P, title: "RFC: Summary service", updated: c.at(3), body: `${fm("rfc", "review", "sara")}# RFC: Summary service

## Summary
A stateless service that builds the prompt from the ticket thread, calls the model, caches by thread hash.

## Detailed design
\`\`\`mermaid
sequenceDiagram
  participant UI as Agent UI
  participant API as Summary API
  participant C as Cache
  participant M as LLM
  UI->>API: GET /tickets/:id/summary
  API->>C: lookup(threadHash)
  alt hit
    C-->>API: summary
  else miss
    API->>M: prompt(thread)
    M-->>API: summary
    API->>C: store
  end
  API-->>UI: summary + id
\`\`\`

## Alternatives considered
1. **Client-side generation**: rejected (keys in browser, REQ-3).
2. **Batch nightly**: rejected (stale, REQ-5).

## Rollout
- [/] Feature flag + shadow mode ~2d !p1 📅 ${d(2)} #epic/backend @sara REQ-2
- [ ] Gradual rollout 10% → 100% ~3d 📅 ${d(19)} #epic/launch REQ-1
` }),
    note({ id: "pj-adr1", space: P, title: "ADR-1: Use a hosted LLM in the EU region", updated: c.at(9), body: `${fm("adr", "approved")}# ADR-1: Use a hosted LLM in the EU region

## Context
REQ-3 forbids PII leaving the region; latency budget 2 s.

## Decision
Use the provider's EU endpoint with zero data retention.

## Consequences
- Positive: compliance, low ops.
- Negative: vendor lock-in; mitigated by a thin client interface.
` }),
    note({ id: "pj-adr2", space: P, title: "ADR-2: Cache summaries by thread hash", updated: c.at(5), body: `${fm("adr", "superseded")}# ADR-2: Cache summaries by thread hash

Superseded by ADR-3 (cache key includes the prompt version).
` }),
    note({ id: "pj-adr3", space: P, title: "ADR-3: Cache key = thread hash + prompt version", updated: c.at(2), body: `${fm("adr", "approved")}# ADR-3: Cache key = thread hash + prompt version

## Decision
Changing the prompt must invalidate cached summaries.
` }),
    note({ id: "pj-req", space: P, title: "Requirements: non-functional", updated: c.at(4), body: `${fm("requirements", "review")}# Requirements: non-functional

- REQ-8 (must) Summary endpoint returns 503 within 300 ms when the model is down (graceful fallback)
- REQ-9 (should) Cost per summary under $0.002
- REQ-10 (could) Admin can disable summaries per queue
` }),
    note({ id: "pj-plan", space: P, title: "Action plan: MVP", updated: c.ago(40), body: `${fm("plan", "approved")}# Action plan: MVP

## Discovery
- [x] Measure reading time per ticket ~1d #epic/discovery @amir
- [x] Pick model + region ~1d #epic/discovery REQ-3
## Backend
- [x] Prompt v1 + eval set (50 threads) ~2d !p1 #epic/backend @amir
- [/] Summary API with cache ~3d !p1 📅 ${d(4)} #epic/backend @sara REQ-1 REQ-2
- [?] PII redaction before prompt ~2d !p1 📅 ${d(1)} #epic/backend @amir REQ-3
- [ ] Fallback when model is down ~1d !p2 📅 ${d(8)} #epic/backend REQ-8
- [>] Per-queue kill switch ~1d !p3 #epic/backend REQ-10
## Frontend
- [/] Summary panel component ~2d !p1 📅 ${d(6)} #epic/frontend @lina REQ-1
- [ ] 👍/👎 rating ~1d !p2 📅 ${d(10)} #epic/frontend @lina REQ-4
- [ ] Live refresh on new message ~2d !p2 📅 ${d(13)} #epic/frontend REQ-5
- [>] Translate summary ~2d !p3 #epic/frontend REQ-6
## Launch
- [ ] Shadow mode for 1 week 🛫 ${d(7)} 📅 ${d(14)} #epic/launch
- [ ] Agent training doc ~1d 📅 ${d(17)} #epic/launch @amir
- [ ] Overdue: legal review of data flow ~1d !p1 📅 ${d(-2)} #epic/launch REQ-3
- [-] Auto-reply prototype #epic/launch REQ-7
` }),
    note({ id: "pj-meet", space: P, title: `Meeting ${d(-1)}: weekly sync`, updated: c.at(1), body: `${fm("meeting", "approved")}# Meeting ${d(-1)}: weekly sync

**Attendees:** @amir @sara @lina

## Decisions
- Ship behind a flag first (see ADR-3 for cache).

## Action items
- [ ] Share eval results with support leads @amir 📅 ${d(3)} #epic/launch
- [ ] Load test summary API @sara 📅 ${d(9)} #epic/backend REQ-2
` }),
    note({ id: "pj-draft", space: P, title: "Draft: prompt ideas", updated: c.ago(200), body: `${fm("draft", "draft")}# Draft: prompt ideas\n\n- Ask for "who wants what" first\n- Keep under 60 words\n` }),
  );
  return v;
}
