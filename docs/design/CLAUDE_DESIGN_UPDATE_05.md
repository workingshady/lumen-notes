# Claude Design follow-up #5: AI tutor, Ask as a chat, Arabic interface, imports, accounts

> Paste everything below the line into the **same Claude Design project** (after updates 01–04).
> Attach `docs/design/DESIGN_SYSTEM.md`, `docs/FEATURES.md`, and screenshots of the current Ask page, Settings › Sync,
> the unlock screen and the import dialog from the live app.

---

## Why this round
Five features are being built **now in code** while you design them: AI tutor modes, Ask as a real chat, a full Arabic interface, imports (Anki, Notion, Obsidian), and accounts (profile, sign-in with Google, registration).

The logic will exist before your design arrives. Design the screens and states below, and we restyle onto the working features.

Everything from rounds 1–4 still applies:
- **Visual system:** Lamplight / Paper tokens; one amber accent for the current or primary thing only; the round-4 **Lumen glyph set** (no emoji); radius 6 / 10 / 14 / 999; Inter + IBM Plex Sans Arabic.
- **AI:** no "AI look" (no sparkles, gradients or glow; AI actions use plain labels).
- **Interaction:** one inline confirm bar, one menu style, one sheet style.
- **Layout:** desktop 1440×900 and phone 412×915 for every screen; Lamplight and Paper where marked ★.

## 1. Ask as a chat ★
**Today:** one question, one answer with numbered citations [n] from your notes; history keeps the last 12 questions; scopes are Vault / Space / Note + links / Learning path.

**New:** a conversation.
- **Follow-ups remember earlier turns.** "And how does that compare to Adam?" works. The app rewrites each follow-up into a standalone question behind the scenes before searching your notes, and shows that rewrite in small muted text: "Searched for: AdamW vs Adam weight decay".
- **Thread layout:** a list of conversations on the left (desktop), or a sheet (phone).
  - Each thread has a title (auto-named from the first question, editable), a scope chip, a date, and pin / rename / delete.
  - Threads sync across devices.
- **Messages:**
  - Your question bubble.
  - The answer in reading type with citation chips.
  - Under each answer: its source cards (collapsible), then Copy · Save as note · Make flashcards · Regenerate · 👍/👎 as glyphs.
- **Composer:**
  - Multiline, Enter to send, Shift+Enter for a new line.
  - Scope chip, plus a "Tutor mode" switch (see 2).
  - Stop while streaming.
  - "Suggest follow-ups": 3 small chips after an answer.
- **Context indicator:** "Using the last 4 turns · 8 passages". When a thread gets long, a quiet line appears: "Earlier messages summarized".
- **States:**
  - empty thread (one line + 3 starter questions from your current note / path);
  - streaming;
  - Not in your notes (offer "Answer from general knowledge" as an explicit choice, clearly labelled as not from your notes);
  - offline; signed out; error with retry.
- **Arabic:** answers RTL, mixed English terms.

## 2. AI tutor modes ★
The tutor teaches a concept from your path using your own notes as the source. You start it from:
- the concept sheet in a learning path ("Learn with tutor");
- a lesson note (⋯ › Tutor);
- the Ask page mode switch.

**Modes:**
- **Explain (step by step):** short steps; after each step, "Got it / Explain differently / Example". Ends with a 3-question check.
- **Socratic:** the tutor asks guiding questions and never gives the answer straight away. Hint ladder: Hint 1 → Hint 2 → Show answer. Each reply is marked correct / partly / not yet.
- **Feynman:** *you* explain the concept in your own words (typed or voice). The tutor finds gaps, wrong statements and jargon you didn't explain, quotes your sentence, and asks you to fix it. It produces a "clarity score" with reasons (plain bars, no gamified confetti).

**Screens:**
- **Session header:** concept name, the course chips it comes from, mode switch, progress (steps / questions), End session.
- **Message styles per mode:** tutor step card, question card with your answer box, feedback card (correct / partly / not yet in green / amber / red with text), hint ladder buttons.
- **End-of-session summary:** what you got right, gaps, 3–5 suggested flashcards (Save all / pick), "Mark concept learned" if the score passed (it feeds the path's mastery), and "Schedule a review".
- **Tutor history:** inside the concept sheet: sessions with date, mode, score.
- **Phone:** full-screen chat, mode switch as a segmented control, hint ladder as chips.
- **States:** no notes for this concept (the tutor says so and offers general knowledge only if you choose it), signed out, offline.

## 3. Full Arabic interface ★
The whole app chrome in Arabic, not only note text.
- **Setting › Appearance › Language:** English / العربية / Auto (from the device). The direction follows the language.
- **Mirrored layout:** sidebar on the right, back arrows flipped, chevrons flipped, progress bars filling from the right, tab order reversed; glyphs that imply direction (back, forward, timeline, arrows) mirrored, others (play, check) not.
- **Typography:**
  - IBM Plex Sans Arabic for UI.
  - Numbers: Western digits by default, with a toggle for Arabic-Indic digits.
  - Dates in Arabic month names.
  - Line heights and sizes tuned for Arabic (UI 14/22 instead of 13/20).
- **Mixed content:** English note titles and code stay LTR inside an RTL interface (show examples: breadcrumbs, note list, palette results, tables, the editor with an English note).
- **Screens to show in Arabic:** Home, Today, notes workspace (3-pane), note in Read, the path Stages view, Review, Settings, palette, the phone tab bar and More page.

## 4. Imports
A single **Import** dialog (Settings › Data and the `+` menu › Import…) with sources:

| Source | What happens | What to design |
|---|---|---|
| **Anki deck** (`.apkg`, `.colpkg`) | Notes become flashcard notes (one note per deck, or per sub-deck); scheduling history is kept as the FSRS starting state; media (images, audio) become attachments | Preview: decks with card counts, note types found (Basic, Cloze, Image Occlusion), a "keep review history" toggle, a mapping of Anki fields → Front/Back |
| **Notion export** (`.zip`, Markdown & CSV) | Pages become notes, keeping the folder tree; databases (CSV) become **Bases**; links between pages become `[[links]]` | Preview: the page tree with checkboxes, databases → bases list, warnings ("12 embeds can't be imported") |
| **Obsidian vault** (folder or `.zip`) | Notes, folders, attachments, `[[links]]`, tags, front matter, `.canvas` files are imported as they are (they're already compatible) | Preview: folder tree, counts, conflicts with existing titles (Skip / Rename / Merge) |
| **Markdown files / folder** | As today | Merge into the same dialog |

**Shared states:**
- choose a source (cards with glyphs and the accepted file types);
- drop zone;
- reading the file (progress);
- the preview;
- choosing the target space and folder;
- importing (progress with counts);
- the result (counts, "Open", "Undo import": the import is one undoable batch);
- errors.

Phone: the same flow as full-screen steps.

## 5. Accounts: profile, sign-in, registration (built now, **not active yet**)
**Today:** Lumen has no accounts. One passcode unlocks sync on each device; a second passcode opens a second, separate account.

**Coming:** real user accounts so other people can use Lumen.
- **Profile:** name, avatar (glyph tile or photo), email, language, time zone.
- **Sign-in:** with Google, or email + password, or a magic link.
- **Registration:** with email verification and accepting the terms.
- **Sessions:** a devices list (already built) and sign out everywhere.
- **Danger zone:** export all my data, delete my account.

These flows are being built behind a switch and stay **off** until launch. Design **both states for every screen**:
- **Not active (now):**
  - **Unlock screen:** keeps the passcode flow. Under it, a quiet "Accounts are coming: sign in with Google, email" line (no buttons that do nothing).
  - **Settings › Account:** shows the profile (name, avatar, language, which already exist locally), plus a muted card "Sign-in and registration · coming soon" with what it will add.
- **Active (later):**
  - **Welcome / sign in:** Continue with Google · email + password · magic link, plus "Use a passcode instead" (kept for the owner).
  - **Register:** name, email, password with strength meter, terms checkbox, then "Check your inbox" verification.
  - **Forgot password; verification states;** Google consent return / error.
  - **Profile page:** avatar, name, email (verified badge), language, time zone, connected sign-in methods (Google linked / unlink), password change, sessions and devices, export data, delete account (typed confirmation).
  - **Phone versions of all.**
- **Avatar:** glyph tile (the space-icon picker style) or uploaded photo, round.

## Deliverables
- **Screens:** every screen above on desktop and phone; Paper for ★.
- **Component sheet additions:**
  - chat bubble (user / answer), rewrite note, suggestion chips;
  - tutor step / question / feedback cards, hint ladder, clarity bars;
  - language switch, RTL examples;
  - import source card, preview tree;
  - account card, Google button (follow Google's sign-in button guidelines for the logo), password meter;
  - the "coming soon" card.
- **Sample content:** use the AI Engineer path (concepts: Backpropagation, AdamW, Attention, LoRA, RAG), Arabic: «الانتشار العكسي».
