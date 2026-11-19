// Dev simulator: scenario registry + loader. Demo mode only (separate "lumen-demo" database, never syncs).
// See docs/DEV_SIMULATOR.md.
import type { UI } from "../store";
import type { LumenDB } from "../db";
import { seeding } from "./faults";
import { writeVault, type Vault } from "./kit";
import { seedEmpty, seedShowcase, seedSpaces, seedStarter, seedStudy } from "./scenarios-a";
import { seedPaths } from "./scenarios-paths";
import { seedProject } from "./scenarios-project";
import { seedSlides } from "./scenarios-slides";
import { CONFLICT_NOTE, seedBig, seedConflicts, seedEdge, seedSharing } from "./scenarios-b";

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
  { id: "big-5k", name: "Big vault · 5k notes", description: "Same as 1k with 5,000 notes. Takes a few seconds to seed.", build: seedBig(5000), ui: { view: "home", spaceId: "bg-s-0" } },
  { id: "paths", name: "Learning paths", description: "Three overlapping courses (ML Foundations, CS231n, fast.ai) combined into one concept path: merged topics, cross-course prerequisites, video resources, revision due today.", build: seedPaths, ui: { view: "notes", spaceId: "all", filter: "paths", noteId: "lp-path", folderId: null, tag: null } },
  { id: "project", name: "Software project hub", description: "An AI-feature project: PRD, RFC in review, ADRs (one superseded), requirements with MoSCoW, an action plan with cards in every state (backlog/todo/doing/review/done/cancelled, one overdue), meeting notes, repo/PR/Figma links.", build: seedProject, ui: { view: "space", spaceId: "pj-s", noteId: null, folderId: null, tag: null, filter: null } },
  { id: "slides", name: "Slides lab", description: "19 dummy decks, one per Slides capability: auto layouts, every layout directive + alias, classes/backgrounds/Marp bg, front-matter defaults, free boxes + Arrange, code + KaTeX, Mermaid, callouts/panels/columns/tabs/tables/transclusion, PNG/SVG/WebM/WAV/PDF attachments + YouTube/Vimeo/mp4/mp3/PDF URLs + link cards, mixed media, Arabic RTL deck, kitchen sink, and edge cases (1 slide, 80 slides, 4000×3000 / tall / wide images, missing attachment, very long text, empty slides, doc → deck). First slide of each deck says what to check.", build: seedSlides, ui: { view: "notes", spaceId: "sl-s", noteId: "sl-start", folderId: null, tag: null, filter: null } },
  { id: "sharing", name: "Sharing & blog", description: "Shared course + project spaces, shared note/canvas/deck, published posts (slugs, excerpts, tags, Arabic, long title, duplicate slug), unpublished drafts.", build: seedSharing, ui: { view: "home", spaceId: "sh-s-course" } },
  { id: "edge", name: "Edge cases & broken data", description: "Invalid/odd JSON Canvas, edges to missing nodes, broken whiteboards, invalid Mermaid, malformed front-matter, empty/duplicate/very long/zero-width/RTL titles, notes in deleted/missing folders and spaces, trash, tombstones of every kind, missing attachments, XSS strings, bad dates, cyclic roadmap.", build: seedEdge, ui: { view: "notes", spaceId: "ed-s" } },
  { id: "conflicts", name: "Conflicts & history", description: "A note with 60 versions (incl. conflict copies), a note with pending dirty edits, a remote tombstone. Use “Simulate incoming conflict” to fire the live conflict toast.", build: seedConflicts, ui: { view: "notes", spaceId: "cf-s", noteId: CONFLICT_NOTE, panel: "versions" } },
];

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
