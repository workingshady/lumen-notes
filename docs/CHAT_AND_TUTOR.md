# Ask as a chat + AI tutor

Round 5 (design: `docs/design/CLAUDE_DESIGN_UPDATE_05.md` §1–§2). Logic, backend and AI are built; the screens use plain
round-4 styling (glyphs, no sparkle) until the Claude Design handoff arrives. All UI strings live in one object each:
`CHAT_STR` (`src/lib/chat.ts`) and `TUTOR_STR` (`src/lib/tutor.ts`).

## Files

| Area | File |
|---|---|
| Record type | `shared/types.ts`: `ChatThread`, `ChatMessage`, `ChatSource`, `TutorCard`, kind `chat` in `KINDS` |
| Local table | `src/lib/db.ts`: Dexie v3 `chats: "id, updatedAt, conceptKey, dirty, deleted"` |
| Pure chat logic (tested) | `src/lib/chat.ts`: rewrite trigger, history window, summary, caps, rank fusion, titles, follow-up parsing, Markdown export, simulator mock |
| Chat runtime | `src/lib/ask.ts`: store, threads (save / pin / rename / delete), `sendChat`, `regenerate`, `stopChat`, `openTutor`, `aiChat` / `aiTutor` transport (+ mock) |
| Retrieval | `src/lib/ask-retrieve.ts` (unchanged: on-device BM25 passages) |
| Pure tutor logic (tested) | `src/lib/tutor.ts`: state machine, scoring, JSON parsing, material → numbered sources, simulator mock |
| UI | `src/components/AskVault.tsx` (thread list, conversation, composer, Ask sheet), `ChatParts.tsx` (answer with citation chips, source cards, icons), `TutorSession.tsx` (session, concept picker, history, entry button) |
| Worker | `worker/ext/chat.ts` `POST /api/ai/chat`, `worker/ext/tutor.ts` `POST /api/ai/tutor` (registered in `worker/index.ts`) |
| Entry points | palette "Ask your notes…", right panel AI › Ask vault, concept sheet (Mastery) "Learn with tutor", note ⋯ › Tutor, the Ask/Tutor switch in the composer |
| Demo | `src/lib/sim/scenarios-r5-chat.ts` (scenario `r5-chat`) |
| Tests | `npx tsx scripts/chat.test.ts` |

## Record format (kind `chat`)

```jsonc
{
  "id": "uuid", "title": "AdamW vs Adam", "mode": "ask",            // ask | explain | socratic | feynman
  "scope": { "kind": "path", "pathId": "…" },                       // vault | space | note | path
  "pathId": "…", "conceptKey": "attention", "noteId": "…",          // tutor subject (path concept, or a note on its own)
  "pinned": 0, "createdAt": 0, "updatedAt": 0, "deleted": 0,
  "summary": "- asked what AdamW is …",  "summarized": 6,          // running summary covers messages[0..6)
  "messages": [
    { "id": "…", "role": "user", "text": "And how does that compare to Adam?", "at": 0 },
    { "id": "…", "role": "assistant", "text": "… [1]", "at": 0,
      "sources": [{ "n": 1, "noteId": "…", "title": "AdamW", "heading": "…", "text": "≤ 500 chars" }],
      "rewrite": "AdamW vs Adam weight decay", "feedback": 1, "followups": ["…", "…", "…"],
      "general": 1,            // answered from general knowledge (explicit choice)
      "empty": "none",         // "Not in your notes" placeholder
      "tutor": { "kind": "step", "i": 1, "of": 3 } }               // tutor card (step | question | feedback | hint | answer | review | summary | explanation)
  ],
  "tutor": { "v": 1, "mode": "explain", "phase": "check", "…": "TutorState" }
}
```

Synced through the generic `items(kind,id,data,…)` table: the Worker's `/api/sync` accepts any kind in `KINDS`, so no
migration is needed. Deleting = tombstone (`deleted: 1`, messages emptied).

**Size caps** (`chat.ts`): 40 messages per thread (oldest whole turns dropped; anything not yet in the summary is folded
in as a question list first), message text 6 000 chars, ≤ 10 sources × 500 chars, 3 follow-ups, summary 1 800 chars,
200 threads (oldest unpinned tombstoned). Tutor messages don't store passages; they're rebuilt from the concept's notes.

## Chat flow (one turn)

1. The question is appended and saved (new thread: title = first sentence, ≤ 60 chars).
2. Small talk ("thanks", "ok", "شكرا") skips retrieval and the rewrite.
3. **Rewrite** when there are earlier turns and the message points back (pronoun / connective cue, English or Arabic) or
   is ≤ 8 words: one small AI call (`op: rewrite`, last 4 turns, Llama 3.1 8B with a 70B fallback) → standalone query,
   shown as "Searched for: …".
4. **Retrieve** with the raw turn AND the rewrite; reciprocal-rank fusion (k = 60), top 8, renumbered [1]…[n].
5. **Answer** (`op: answer`, streamed): last 4 turns verbatim (citations stripped) + the running summary + this turn's
   passages. Nothing found → "Not in your notes" with "Answer from general knowledge" (re-runs with `general: true`;
   the answer is labelled and has no citations).
6. After the answer: 3 follow-ups (`op: followups`), and when ≥ 4 messages sit before the window un-summarized, the
   summary is updated (`op: summarize`, local question-list fallback).
7. Stop keeps the partial answer (or shows "Stopped" with Retry); Regenerate drops the last answer and re-runs.

Context line under the composer: "Using the last N turns · M passages", plus "Earlier messages summarized".

## Prompts (worker)

- `REWRITE_PROMPT`: rewrite into ONE standalone search query, resolve references only, keep terms and language, ≤ 20 words.
- `CHAT_PROMPT` = the Ask prompt (excerpts only, cite every claim, "Not in your notes.", language) + "earlier turns are
  context only, cite only this turn's excerpts; small talk → one short sentence".
- `GENERAL_PROMPT`: explicit general-knowledge answer, no citation numbers, say when unsure.
- `FOLLOWUP_PROMPT`: 3 follow-up questions, one per line, < 12 words.
- `SUMMARY_PROMPT`: merge previous summary + new turns, ≤ 120 words, keep what "it/that" referred to.
- `TUTOR_PROMPTS` (`tutor.ts`): shared base (teach ONE concept from the learner's own numbered notes, cite [n], mark
  general knowledge as (general), JSON only) + one per op:
  - `plan` → `{"steps":[{"title","text"}],"check":[{"q","answer"}]}` (3–5 steps of 40–110 words, 3 checks)
  - `rephrase` → `{"title","text"}` (same idea, new angle or a worked example)
  - `grade` → `{"verdict":"correct|partly|not_yet","feedback"}`
  - `socratic` → `{"verdict","feedback","question","hints":[2],"answer","done"}` (never reveals the answer; on a
    not-yet reply the question stays and the learner uses the hints)
  - `feynman` → `{"score","reasons":[Accuracy, Completeness, Clarity],"issues":[{"quote","kind":"gap|wrong|jargon","comment"}],"ask"}`
  - `summary` → `{"right":[],"gaps":[],"cards":[{"q","a"}]}`

Both routes respect Settings › AI: `all` off, or `ask` / `chat` (chat), `tutor` (tutor).

## Tutor state machine (`tutorReduce`)

| Mode | Phases | Score |
|---|---|---|
| Explain | `start` → `step` (Got it → next step; Explain differently / Example add a card) → `check` ×3 (graded) → `done` → `summary` | mean of checks (correct 1, partly 0.5, not yet 0) |
| Socratic | `start` → `question` (reply graded; not-yet keeps the question; Hint 1 → Hint 2 → Show answer) → `closed` → next question … ×4 → `done` → `summary` | per question: correct = 1 − 0.25 × hints used, Show answer = 0 |
| Feynman | `explain` (review → explain again …) → See summary → `summary` | last clarity score / 100 |

Passed = score ≥ 80 % with enough evidence (all checks, ≥ 3 Socratic questions, one Feynman review). The summary offers:
save cards (checked ones, appended under `## Tutor cards` in the concept's note, created + linked in the path if needed),
**Mark concept learned** (only when passed; `setManualDone`, which also starts the revision ladder), **Schedule a review**
(path `review:` date in 3 days when passed, else tomorrow), Try again. Sessions per concept show in the concept sheet.

## Demo / offline

In `?demo=1` without an account (or Dev panel › AI = mock) `aiChat` / `aiTutor` answer from the simulator mock
(`mockRewrite`, `mockAnswer`, `mockFollowups`, `mockTutor`): deterministic, built from the passages, streamed word by
word, same JSON shapes as the Worker. AI = quota / error / offline modes surface as errors with Retry.
Scenario **Ask chat & AI tutor (round 5)** (`r5-chat`) seeds 5 chat threads (pinned, rewritten follow-up, summarized,
not-in-notes, general knowledge, Arabic) and 3 tutor sessions on the AI Engineer path.

## Limits

- Retrieval is still keyword BM25 on the device (no embeddings); the rewrite is what makes follow-ups work.
- The summary is best effort (small model); if it fails a question list is kept instead.
- Tutor output depends on the model returning JSON; unreadable replies show "couldn't be read" with Retry.
- Feynman dictation uses the browser's Web Speech API (not Whisper) and only shows where available.
- Settings › AI has no separate toggles for chat / tutor yet (the Worker honours `ask`, `chat`, `tutor` in `aiOff`).
