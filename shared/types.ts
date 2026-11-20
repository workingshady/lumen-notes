// Shared between the app (src) and the Worker (worker).

/** `diagram` = a `.mermaid` file: body is raw Mermaid source (no front-matter), title ends in `.mermaid` (lib/diagrams.ts).
 *  `pdf` = a PDF document note (reader + highlights). `dashboard` = chart tiles built from base queries.
 *  `base` = a database view of notes (Obsidian Bases style): the body holds the view definition (filters, views, columns) as YAML-ish Markdown. */
export type NoteType = "note" | "lesson" | "journal" | "flashcards" | "slides" | "post" | "canvas" | "whiteboard" | "board" | "roadmap" | "moc" | "path" | "diagram" | "base" | "pdf" | "dashboard";
export type Status = "todo" | "learning" | "review" | "mastered";
export const STATUSES: Status[] = ["todo", "learning", "review", "mastered"];
export const NOTE_TYPES: NoteType[] = ["note", "lesson", "journal", "flashcards", "slides", "post", "canvas", "whiteboard", "board", "roadmap", "moc", "path", "diagram", "base", "pdf", "dashboard"];

/** PARA-style space kinds. A space encapsulates its own folder tree, notes, roadmap and settings. */
export type SpaceKind = "project" | "area" | "course" | "resource" | "archive";
export const SPACE_KINDS: SpaceKind[] = ["project", "area", "course", "resource", "archive"];

/** Every synced record carries these. `dirty` is local-only (1 = not pushed yet). */
export interface Synced {
  id: string;
  updatedAt: number;
  deleted: 0 | 1;
  dirty?: 0 | 1;
}

export interface Note extends Synced {
  title: string;
  /** Markdown, or JSON Canvas text when type === "canvas". */
  body: string;
  spaceId: string;
  folderId: string | null;
  tags: string[];
  type: NoteType;
  status: Status | null;
  pinned: 0 | 1;
  favorite: 0 | 1;
  published: 0 | 1;
  slug: string;
  props: Record<string, string>;
  createdAt: number;
  /** Unlisted share link token (/s/<token>); null/absent = not shared. */
  shareId?: string | null;
}

export interface Space extends Synced {
  name: string;
  kind: SpaceKind;
  icon: string; // emoji
  color: string | null;
  description: string;
  /** project: goal/deadline; course: provider/url/target date. Free-form key/values. */
  props: Record<string, string>;
  /** Note id of this space's roadmap (type "roadmap"), if any. */
  roadmapId: string | null;
  sort: number;
  archived: 0 | 1;
  createdAt: number;
  /** Unlisted share link token for the whole space (course/project page). */
  shareId?: string | null;
}

export interface Folder extends Synced {
  spaceId: string;
  name: string;
  parentId: string | null;
  color: string | null;
  sort: number;
}

export interface Version extends Synced {
  noteId: string;
  title: string;
  body: string;
  label: string;
  createdAt: number;
  /** Device that saved it ("Pixel 8", "Windows PC"); shown in the history panel. Older versions have none. */
  device?: string;
}

/** Spaced-repetition state of one flashcard (id = noteId:hash(question)). */
export interface Card extends Synced {
  noteId: string;
  ease: number;
  interval: number; // days
  due: number; // epoch ms
  reps: number;
  lapses: number;
  /** 1 = suspended (S in review): never shows up as due until unsuspended. */
  suspended?: 0 | 1;
  /** FSRS memory state (absent on cards scheduled by the older SM-2 ladder; they migrate on their next review). */
  stability?: number; // days until recall probability drops to 90 %
  difficulty?: number; // 1 (easy) … 10 (hard)
  lastReview?: number; // epoch ms
  state?: "new" | "learning" | "review" | "relearning";
}

/** Study timer session. */
export interface Session extends Synced {
  noteId: string | null;
  minutes: number;
  at: number;
}

/** One flashcard review (FSRS review log, synced like cards; append-only). Feeds Settings › Review › Optimize. */
export interface ReviewLog extends Synced {
  cardId: string;
  noteId: string;
  /** epoch ms of the review */
  at: number;
  /** 0 Again · 1 Hard · 2 Good · 3 Easy */
  grade: 0 | 1 | 2 | 3;
  /** card state before this review */
  state: "new" | "learning" | "review" | "relearning";
  /** days since the previous review (fractional; 0 for a new card) */
  elapsed: number;
  /** days until the card is due after this review (fractional; minutes count as parts of a day) */
  scheduled: number;
}

/** Attachment metadata (bytes live in IndexedDB locally and in R2 remotely). */
export interface AttachmentMeta extends Synced {
  name: string;
  mime: string;
  size: number;
}

// ---------- Ask chat threads + AI tutor sessions (kind "chat"; docs/CHAT_AND_TUTOR.md) ----------
export type ChatMode = "ask" | "explain" | "socratic" | "feynman";
export interface ChatScope { kind: "vault" | "space" | "note" | "path"; spaceId?: string; noteId?: string; pathId?: string }
/** A cited passage kept on an answer (text trimmed to keep threads small). */
export interface ChatSource { n: number; noteId: string; title: string; heading?: string; text: string }
/** Tutor card on a message: what the tutor UI draws (step, question, feedback, hint, Feynman review, summary). */
export interface TutorCard {
  kind: "step" | "question" | "feedback" | "hint" | "answer" | "review" | "summary" | "explanation";
  /** explanation: what produced it (Example / Explain differently / a question about the step). */
  how?: "example" | "differently" | "ask";
  verdict?: "correct" | "partly" | "not_yet";
  /** 1-based position + total (step 2 of 4, question 1 of 3). */
  i?: number; of?: number;
  /** Feynman review: clarity score 0–100, reasons, quoted issues. */
  score?: number;
  reasons?: { label: string; score: number; note?: string }[];
  issues?: { quote: string; kind: "gap" | "wrong" | "jargon"; comment: string }[];
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Passages the answer was given (Ask) or the tutor's numbered notes. */
  sources?: ChatSource[];
  /** The standalone query a follow-up was rewritten into ("Searched for: …"). */
  rewrite?: string;
  /** 1 = thumbs up, -1 = thumbs down. */
  feedback?: 1 | -1;
  /** 1 = answered from general knowledge (not from your notes), on explicit request. */
  general?: 1;
  /** "none" = the notes don't cover it (the UI offers general knowledge). */
  empty?: "none";
  followups?: string[];
  tutor?: TutorCard;
  /** Note Assistant quick action that produced this answer (summarize, flashcards, explain, tags, quiz, diagram). */
  action?: string;
}
export interface ChatThread extends Synced {
  title: string;
  mode: ChatMode;
  scope: ChatScope;
  /** Tutor: the learning-path concept (path note id + concept key), or a lesson note studied on its own. */
  pathId?: string;
  conceptKey?: string;
  noteId?: string;
  /** 1 = a note Assistant conversation (right panel, R6-31) about `noteId`. */
  assistant?: 1;
  pinned: 0 | 1;
  messages: ChatMessage[];
  /** Running summary of turns older than the window (and of messages dropped by the cap). */
  summary?: string;
  /** How many leading messages `summary` already covers. */
  summarized?: number;
  /** Tutor session state (src/lib/tutor.ts TutorState), JSON-safe. */
  tutor?: Record<string, unknown>;
  createdAt: number;
}

/** What happened to a note (activity log, kind "activity"; src/lib/activity.ts). */
export type ActivityAction =
  | "created" | "imported" | "duplicated" | "edited" | "renamed" | "moved" | "tagged" | "type" | "status"
  | "trashed" | "restored" | "shared" | "unshared" | "published" | "unpublished" | "reverted";
/**
 * One entry of a note's activity log (synced; capped per note, older entries become tombstones).
 * Edits within a few minutes on one device coalesce into one entry (`at` = start, `end` = last change).
 */
export interface Activity extends Synced {
  noteId: string;
  action: ActivityAction;
  at: number;
  end?: number;
  device?: string;
  /** Note title when the entry was written (for app-wide lists). */
  title?: string;
  /** edited: characters (Markdown) or items (`unit`: canvas cards, whiteboard elements) added / removed. */
  add?: number;
  del?: number;
  unit?: "chars" | "cards" | "elements";
  /** whiteboard: images added. */
  img?: number;
  /** renamed / type / status: old and new value; moved: "spaceId/folderId" before and after; duplicated: source title. */
  from?: string;
  to?: string;
  /** tagged: tags added / removed (net within the session). */
  plus?: string[];
  minus?: string[];
  /** Version that holds the note's text at (or near) the end of this entry; reverted: the version restored. */
  ver?: string;
}

export type Kind = "space" | "note" | "folder" | "version" | "card" | "session" | "attachment" | "review" | "chat" | "activity";
export const KINDS: Kind[] = ["space", "note", "folder", "version", "card", "session", "attachment", "review", "chat", "activity"];

export interface SyncItem {
  kind: Kind;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: 0 | 1;
}
export interface SyncRequest { since: number; items: SyncItem[]; /** First sync on a new device: pull only these kinds (notes first, then cards…). */ kinds?: Kind[] }
export interface SyncResponse { cursor: number; items: SyncItem[] }

// ---------- JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/) ----------
export type CanvasColor = string; // "1".."6" or "#RRGGBB"
export type Side = "top" | "right" | "bottom" | "left";
interface NodeBase { id: string; x: number; y: number; width: number; height: number; color?: CanvasColor }
export type CanvasNode =
  | (NodeBase & { type: "text"; text: string })
  | (NodeBase & { type: "file"; file: string; subpath?: string })
  | (NodeBase & { type: "link"; url: string })
  | (NodeBase & { type: "group"; label?: string; background?: string; backgroundStyle?: "cover" | "ratio" | "repeat" });
export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: "none" | "arrow";
  toNode: string;
  toSide?: Side;
  toEnd?: "none" | "arrow";
  color?: CanvasColor;
  label?: string;
}
export interface JsonCanvas { nodes?: CanvasNode[]; edges?: CanvasEdge[] }

/** Notes whose body is an .excalidraw scene and that open in the Whiteboard editor (whiteboard = free drawing, board = mixed surface). */
export const isWbType = (t: string | undefined | null): boolean => t === "whiteboard" || t === "board";
