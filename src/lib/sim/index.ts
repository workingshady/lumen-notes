// Dev simulator: scenario registry + loader. Demo mode only (separate "lumen-demo" database, never syncs).
// See docs/DEV_SIMULATOR.md.
import type { UI } from "../store";
import type { LumenDB } from "../db";
import { seeding } from "./faults";
import { emptyVault, writeVault, type Vault } from "./kit";
import { seedEmpty, seedShowcase, seedSpaces, seedStarter, seedStudy } from "./scenarios-a";
import { seedPaths } from "./scenarios-paths";
import { seedProject } from "./scenarios-project";
import { seedSlides } from "./scenarios-slides";
import { seedR4Organize } from "./scenarios-r4-organize";
import { seedR4Write } from "./scenarios-r4-write";
import { seedR4Study } from "./scenarios-r4-study";
import { seedR5Chat } from "./scenarios-r5-chat";
import { seedR5Arabic } from "./scenarios-r5-arabic";
import { CONFLICT_NOTE, seedBig, seedConflicts, seedEdge, seedSharing } from "./scenarios-b";
import { seedR6Big } from "./scenarios-r6-big";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Build the vault (design uses the original seedDemo instead). */
  build?: () => Promise<Vault>;
  /** Where the app should land after loading. */
  ui?: Partial<UI>;
  /** Show the first-run Welcome flow (brand-new user). */
  welcome?: boolean;
}

export const SCENARIOS: Scenario[] = [
  { id: "design", name: "Design sample", description: "The Claude Design handoff data (default): 6 spaces, ~150 notes, 23 cards due, 12-day streak, clock pinned to Fri 13 Nov 2026 21:41." },
  { id: "empty", name: "Empty / brand-new user", description: "Only the Inbox, no notes, cards, sessions or files. Shows the Welcome flow and every empty state.", build: seedEmpty, welcome: true, ui: { view: "home", spaceId: "inbox" } },
  { id: "starter", name: "Starter", description: "Two spaces and one note of every type: note, lesson, journal, flashcards, slides, post, canvas, whiteboard, roadmap, MOC.", build: seedStarter, ui: { view: "home", spaceId: "st-s-course" } },
  { id: "showcase", name: "Every type showcase", description: "Kitchen-sink Markdown (tasks overdue/today/upcoming/doing/done, tables, footnotes, KaTeX, all callouts incl. folded, 14 code languages, wiki links existing + missing, nested tags, YouTube/Vimeo/mp4/mp3/PDF/link-card embeds, real PNG/SVG/WAV/PDF/CSV attachments, front-matter, Arabic+English, long words, emoji), a Mermaid gallery with every diagram type, plus canvas/whiteboard/roadmap/slides/MOC/journal/post.", build: seedShowcase, ui: { view: "notes", spaceId: "sc-s", noteId: "sc-kitchen" } },
  { id: "spaces", name: "All spaces & kinds", description: "Project (+ overdue project), area, course with roadmap (locked/learning/done/skipped, overdue/today/upcoming modules), empty course, resource, archived spaces, folders nested 4 deep with colours, Johnny-Decimal tree.", build: seedSpaces, ui: { view: "space", spaceId: "sp-course" } },
  { id: "study", name: "Study heavy", description: "720 flashcards across 25 decks in every SRS state (new, learning, due, later, lapsed, suspended); a year of sessions with a 23-day current streak, 64-day best and gaps.", build: seedStudy, ui: { view: "home", spaceId: "sd-s" } },
  { id: "big-1k", name: "Big vault · 1k notes", description: "1,000 linked notes (dense graph with hubs), 12 spaces, 60 folders, 2 canvases × 500 nodes, 2 notes × 50k words, 10 notes × 40 versions.", build: seedBig(1000), ui: { view: "home", spaceId: "bg-s-0" } },
  { id: "big-3k", name: "Big vault · 3,000 notes", description: "Same as 1k with 3,000 notes (the simulator drawer's Big vault toggle; Lumen 22 / 32 scale states).", build: seedBig(3000), ui: { view: "home", spaceId: "bg-s-0" } },
  { id: "r6-big", name: "AI Engineer · 3,142 notes (round 6 big data)", description: "Check Lumen 32 / 22 scale states: graph above 300 notes asks first (Full · Grouped · Tree · Local · Filter, Remember my choice), grouped by folder (03 Deep learning ↔ 04 NLP thickest), tree with “+ N more”, the 214-topic “AI Engineer skill tree” (compact stages, Find a topic), Folders view (palette › Folders) with search counts, “Video lectures index” (47 videos, 14 diagrams, 212 links), a 12,140-word note with 48 headings, a 2,000-row table (Read mode pages, Open as base), 512 cards due after a 12-day break.", build: seedR6Big, ui: { view: "graph", spaceId: "ai-s", noteId: null, folderId: null, tag: null, filter: null } },
  { id: "big-5k", name: "Big vault · 5k notes", description: "Same as 1k with 5,000 notes. Takes a few seconds to seed.", build: seedBig(5000), ui: { view: "home", spaceId: "bg-s-0" } },
  { id: "paths", name: "Learning paths", description: "Three overlapping courses (ML Foundations, CS231n, fast.ai) combined into one concept path: merged topics, cross-course prerequisites, video resources, revision due today.", build: seedPaths, ui: { view: "notes", spaceId: "all", filter: "paths", noteId: "lp-path", folderId: null, tag: null } },
  { id: "project", name: "Software project hub", description: "An AI-feature project: PRD, RFC in review, ADRs (one superseded), requirements with MoSCoW, an action plan with cards in every state (backlog/todo/doing/review/done/cancelled, one overdue), meeting notes, repo/PR/Figma links.", build: seedProject, ui: { view: "space", spaceId: "pj-s", noteId: null, folderId: null, tag: null, filter: null } },
  { id: "slides", name: "Slides lab", description: "19 dummy decks, one per Slides capability: auto layouts, every layout directive + alias, classes/backgrounds/Marp bg, front-matter defaults, free boxes + Arrange, code + KaTeX, Mermaid, callouts/panels/columns/tabs/tables/transclusion, PNG/SVG/WebM/WAV/PDF attachments + YouTube/Vimeo/mp4/mp3/PDF URLs + link cards, mixed media, Arabic RTL deck, kitchen sink, and edge cases (1 slide, 80 slides, 4000×3000 / tall / wide images, missing attachment, very long text, empty slides, doc → deck). First slide of each deck says what to check.", build: seedSlides, ui: { view: "notes", spaceId: "sl-s", noteId: "sl-start", folderId: null, tag: null, filter: null } },
  { id: "sharing", name: "Sharing & blog", description: "Shared course + project spaces, shared note/canvas/deck, published posts (slugs, excerpts, tags, Arabic, long title, duplicate slug), unpublished drafts.", build: seedSharing, ui: { view: "home", spaceId: "sh-s-course" } },
  { id: "edge", name: "Edge cases & broken data", description: "Invalid/odd JSON Canvas, edges to missing nodes, broken whiteboards, invalid Mermaid, malformed front-matter, empty/duplicate/very long/zero-width/RTL titles, notes in deleted/missing folders and spaces, trash, tombstones of every kind, missing attachments, XSS strings, bad dates, cyclic roadmap.", build: seedEdge, ui: { view: "notes", spaceId: "ed-s" } },
  { id: "conflicts", name: "Conflicts & history", description: "A note with 60 versions (incl. conflict copies), a note with pending dirty edits, a remote tombstone. Use “Simulate incoming conflict” to fire the live conflict toast.", build: seedConflicts, ui: { view: "notes", spaceId: "cf-s", noteId: CONFLICT_NOTE, panel: "versions" } },
  { id: "r4-organize", name: "Organize & connect (round 4)", description: "Check: base “Lessons by status × course” (Table/Board/Gallery/List/Calendar + By tag / By courses multi-group, filter rows + groups, sort, cell editors, board drag + Undo) and an empty “New base” (template picker); “AI Engineer dashboard” with every tile type (range bar, Edit layout drag/resize, Add tile, Table toggle); 14 smart folders (pinned, coloured, every operator, one empty); unlinked mentions of Attention (English + Arabic prefixes, one ignored: Link / Link all + Undo / Ignore); shared tags, orphans, broken links for the graph (Display, Tidy up, tag nodes); CS231n / CS224n / Karpathy roadmaps with branching + implied prerequisites and the “AI Engineer path” over them; canvas “Transformer study map” (groups, pinned cards, PDF highlight cards, PDF card, .mermaid card); whiteboard; transformer-forward.mermaid; Ask (offline / passages / AI mock citations).", build: () => seedR4Organize(), ui: { view: "notes", spaceId: "all", noteId: "r4o-base", folderId: null, tag: null, filter: null } },
  { id: "r4-write", name: "Write, present & share (round 4)", description: "Check: “Read mode showcase” (every Read block: columns/cards/divided, tabs, expand, panels, callouts, aside/center/wide/full, tables with caption/filter/sort/full screen, includes + Go to source, block refs, status pills, [[toc]], highlights, Arabic) + wide/full page notes; “Every / block” (the whole slash catalog); “Editor playground” (handles, drag, Turn into, multi-select, [[Note#^ autocomplete, paste menu); Focus Read/Write note; “Talks & decks”: one deck per slide layout (12), every layout in one deck, Arrange, doc → deck, Arabic deck; shared course page + shared lesson/deck/cards/canvas, 3 published posts (one Arabic) for the blog + OG previews; project hub with every doc state / card marker / MoSCoW level; icon spaces (glyph, shape, initials incl. Arabic), an empty course; due cards for the favicon badge; a 3-day streak without today (streak moment).", build: () => seedR4Write(), ui: { view: "notes", spaceId: "r4w-s-write", noteId: "r4w-showcase", folderId: null, tag: null, filter: null, mode: "read" } },
  { id: "r4-study", name: "Study features (round 4)", description: "Check: Today (Reviews / Continue / New lessons / Revise & practice / If you have time, missed Wed + Thu → spread 7 overdue topics with Before/After + Adjust + Accept, week view + 4 goals, Skip / Tomorrow / Done + Undo); Review (cards in new / learning / review / relearning / suspended, grade previews, S suspend, U undo, Practice anyway); Settings › Review › Advanced (workload chart, ~300-row review log, Optimize from history, Use defaults); path “Transformers from zero” (mastered, revisions due, Gradient descent masters on Got it, Mini-batch test-out practice, locked concepts unlock); cloze ({{c1::}} in lessons, ==x== in flashcard / cloze: true notes, Arabic); image occlusion (hide-one with a group, hide-all, Make image cards); PDF reader “Transformers study edition” (outline, find, text + area highlights, Continue pill, highlight → note / card / canvas, back-links in “Attention notes”), locked PDF (password lumen), scanned PDF, PDF library; “Backprop video lecture” (YouTube chips, a real 10 s MP4 with a clock: seek, speed, dock, grey chip); streak moment on today's first review. Seeding records the video (~10 s).", build: () => seedR4Study(), ui: { view: "today", spaceId: "all", noteId: null, folderId: null, tag: null, filter: null } },
  { id: "r5-chat", name: "Ask chat & AI tutor (round 5)", description: "Check: Ask (palette › Ask your notes…) as threads: pinned “AdamW vs Adam” with a follow-up rewrite (Searched for), 👍 feedback and follow-up chips; a long thread with “Earlier messages summarized”; Not in your notes → Answer from general knowledge; a general-knowledge answer with 👎; an Arabic thread. Tutor: AI Engineer path › Attention › Learn with tutor (history: Explain passed with summary, Socratic mid-question on Hint 1), Backpropagation Feynman review with clarity score + quoted jargon/gap. New turns use the simulator mock when signed out or AI = mock. Builds on r4-organize.", build: () => seedR5Chat(), ui: { view: "notes", spaceId: "all", noteId: "r4o-path", folderId: null, tag: null, filter: null } },
  { id: "r5-arabic", name: "Arabic interface (round 5)", description: "Check the Arabic interface: switch Settings › Appearance › Language to العربية (and Numbers to ٠١٢٣). Adds the course space «مهندس ذكاء اصطناعي» with folders ٠١–٠٤, mixed Arabic / English lessons («الانتشار العكسي» with callout, formula and a table with numeric cells; “Backprop, by hand” with code for Split), Arabic flashcards. Builds on r4-organize.", build: () => seedR5Arabic(), ui: { view: "home", spaceId: "r5a-s", noteId: null, folderId: null, tag: null, filter: null } },
  { id: "r4-all", name: "Everything (round 4)", description: "One click for every round-4 feature: Study (r4-study) + Organize & connect (r4-organize, incl. the AI Engineer learning path) + Write, present & share (r4-write) + the Software project hub, merged into one vault (ids r4s- / r4o- / r4w- / pj-). Lands on Home.", build: seedR4All, ui: { view: "home", spaceId: "all", noteId: null, folderId: null, tag: null, filter: null } },
];

/**
 * "Everything (round 4)": the three round-4 builders add to one vault, then the project-hub scenario is merged in
 * (first record with an id wins, so the Inbox keeps the Organize smart folders). The older "Learning paths" scenario is
 * left out on purpose: Organize reuses its course and lesson titles (CS231n, Backpropagation, …) and links, bases and
 * path courses resolve by title, so only one copy may exist; Organize's "AI Engineer path" covers learning paths.
 */
async function seedR4All(): Promise<Vault> {
  const v = emptyVault();
  await seedR4Study(v);
  await seedR4Organize(v);
  await seedR4Write(v);
  const extra = await seedProject();
  for (const k of ["spaces", "folders", "notes", "versions", "cards", "sessions", "attachments", "blobs"] as const) {
    const have = new Set((v[k] as { id: string }[]).map((r) => r.id));
    for (const r of extra[k] as { id: string }[]) if (!have.has(r.id)) { (v[k] as { id: string }[]).push(r); have.add(r.id); }
  }
  return v;
}

const KEY = "lumen.sim.scenario";
export function currentScenario(): Scenario {
  let id = "design";
  try { id = localStorage.getItem(KEY) || "design"; } catch { /* ignore */ }
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/**
 * Wipe the demo DB and seed `scenario` (default: the remembered one). Applies demo settings and the
 * scenario's landing view. Caller reloads the page afterwards.
 */
export async function seedScenario(db: LumenDB, scenario = currentScenario()): Promise<void> {
  try { localStorage.setItem(KEY, scenario.id); } catch { /* ignore */ }
  const m = await import("../demo");
  if (scenario.build) await writeVault(db, await scenario.build());
  else {
    seeding.on = true;
    try { await m.seedDemo(db); } finally { seeding.on = false; }
  }
  await db.meta.put({ k: "demoSeeded", v: Date.now() });
  await db.meta.put({ k: "simScenario", v: scenario.id });
  const { setSettings } = await import("../settings");
  setSettings(m.DEMO_SETTINGS);
  try {
    if (scenario.welcome) localStorage.removeItem("lumen.welcomed");
    else localStorage.setItem("lumen.welcomed", "1");
  } catch { /* ignore */ }
  const { setUI } = await import("../store");
  setUI({ view: "home", folderId: null, tag: null, filter: null, noteId: null, panel: null, spaceId: scenario.id === "design" ? m.DEMO_IDS.spaces.ml : "inbox", ...scenario.ui });
}

/** Record counts per table (for the Dev panel). */
export async function tableCounts(db: LumenDB) {
  const [spaces, folders, notes, trashed, versions, cards, sessions, attachments, blobs] = await Promise.all([
    db.spaces.count(), db.folders.count(), db.notes.where("deleted").equals(0).count(), db.notes.where("deleted").equals(1).count(),
    db.versions.count(), db.cards.count(), db.sessions.count(), db.attachments.count(), db.blobs.count(),
  ]);
  return { spaces, folders, notes, trashed, versions, cards, sessions, attachments, blobs };
}
