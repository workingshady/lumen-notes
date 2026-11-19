// Shared between the app (src) and the Worker (worker).

/** `diagram` = a `.mermaid` file: body is raw Mermaid source (no front-matter), title ends in `.mermaid` (lib/diagrams.ts).
 *  `base` = a database view of notes (Obsidian Bases style): the body holds the view definition (filters, views, columns) as YAML-ish Markdown. */
export type NoteType = "note" | "lesson" | "journal" | "flashcards" | "slides" | "post" | "canvas" | "whiteboard" | "roadmap" | "moc" | "path" | "diagram" | "base";
export type Status = "todo" | "learning" | "review" | "mastered";
export const STATUSES: Status[] = ["todo", "learning", "review", "mastered"];
export const NOTE_TYPES: NoteType[] = ["note", "lesson", "journal", "flashcards", "slides", "post", "canvas", "whiteboard", "roadmap", "moc", "path", "diagram", "base"];

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

/** Attachment metadata (bytes live in IndexedDB locally and in R2 remotely). */
export interface AttachmentMeta extends Synced {
  name: string;
  mime: string;
  size: number;
}

export type Kind = "space" | "note" | "folder" | "version" | "card" | "session" | "attachment";
export const KINDS: Kind[] = ["space", "note", "folder", "version", "card", "session", "attachment"];

export interface SyncItem {
  kind: Kind;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: 0 | 1;
}
export interface SyncRequest { since: number; items: SyncItem[] }
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
