// Dev simulator: shared builders for scenario seeds. Every record is written with `dirty: 0`
// (demo data never syncs) straight into the demo database by writeVault().
import type { AttachmentMeta, Card, Folder, Note, NoteType, Session, Space, SpaceKind, Status, Version } from "../../../shared/types";
import type { AttachmentBlob, LumenDB } from "../db";
import { flashcards, inlineTags, splitFrontMatter } from "../parse";
import { seeding } from "./faults";

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Deterministic PRNG (mulberry32) so a scenario looks the same every time it is loaded. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

/** Time helpers relative to the (possibly pinned) clock at seed time. */
export function clock() {
  const now = Date.now();
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  const day = (off: number, hm = "18:00") => {
    const d = new Date(t0);
    d.setDate(d.getDate() + off);
    const [h, m] = hm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const iso = (off: number) => {
    const d = new Date(t0);
    d.setDate(d.getDate() + off);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  /** k days ago at HH:MM, never in the future. */
  const at = (k: number, hm = "18:00") => Math.min(day(-k, hm), now - MIN);
  const ago = (min: number) => now - min * MIN;
  return { now, t0: t0.getTime(), day, iso, at, ago };
}
export type Clock = ReturnType<typeof clock>;

export interface Vault {
  spaces: Space[]; folders: Folder[]; notes: Note[]; versions: Version[]; cards: Card[]; sessions: Session[];
  attachments: AttachmentMeta[]; blobs: AttachmentBlob[];
  /** Extra meta rows (e.g. sync cursor) written alongside. */
  meta?: { k: string; v: unknown }[];
}
export const emptyVault = (): Vault => ({ spaces: [], folders: [], notes: [], versions: [], cards: [], sessions: [], attachments: [], blobs: [] });

export const INBOX: Space = {
  id: "inbox", name: "Inbox", kind: "area", icon: "📥", color: null, description: "Default space", props: {}, roadmapId: null,
  sort: 0, archived: 0, createdAt: 0, updatedAt: 0, deleted: 0, dirty: 0,
};

export function space(p: Partial<Space> & { id: string; name: string; kind: SpaceKind }): Space {
  const t = Date.now() - 30 * DAY;
  return { icon: "📁", color: null, description: "", props: {}, roadmapId: null, sort: 1, archived: 0, createdAt: t, updatedAt: t, deleted: 0, dirty: 0, ...p };
}
export function folder(p: Partial<Folder> & { id: string; spaceId: string; name: string }): Folder {
  return { parentId: null, color: null, sort: 1, updatedAt: Date.now() - 30 * DAY, deleted: 0, dirty: 0, ...p };
}

export interface NoteSpec {
  id: string; title: string; space?: string; folder?: string | null; type?: NoteType; status?: Status | null;
  tags?: string[]; /** Markdown after a generated front-matter + H1. */ text?: string; /** Raw body (overrides text). */ body?: string;
  updated?: number; created?: number; pinned?: 0 | 1; favorite?: 0 | 1; published?: 0 | 1; slug?: string;
  props?: Record<string, string>; shareId?: string | null; deleted?: 0 | 1; fm?: Record<string, string>;
}
/** Build a Note like the app would store it: front-matter tags + inline #tags merged into `tags`. */
export function note(s: NoteSpec): Note {
  const type = s.type ?? "note";
  const status = s.status ?? null;
  let body = s.body;
  if (body === undefined) {
    const fm: string[] = [];
    if (type !== "note") fm.push(`type: ${type}`);
    if (status) fm.push(`status: ${status}`);
    if (s.tags?.length) fm.push(`tags: [${s.tags.join(", ")}]`);
    for (const [k, v] of Object.entries(s.fm ?? {})) fm.push(`${k}: ${v}`);
    body = `${fm.length ? `---\n${fm.join("\n")}\n---\n` : ""}# ${s.title}\n\n${s.text ?? ""}`;
  }
  const md = type !== "canvas" && type !== "whiteboard" && type !== "roadmap";
  const split = md ? splitFrontMatter(body) : { data: {} as Record<string, string>, body };
  const fmTags = md ? (split.data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
  const tags = [...new Set([...(s.tags ?? []), ...fmTags, ...(md ? inlineTags(split.body) : [])])];
  const updated = s.updated ?? Date.now() - HOUR;
  return {
    id: s.id, title: s.title, body, spaceId: s.space ?? "inbox", folderId: s.folder ?? null, tags, type, status,
    pinned: s.pinned ?? 0, favorite: s.favorite ?? 0, published: s.published ?? 0, slug: s.slug ?? "", props: s.props ?? {},
    createdAt: s.created ?? updated - 3 * DAY, updatedAt: updated, deleted: s.deleted ?? 0, dirty: 0, shareId: s.shareId ?? null,
  };
}

export type CardState = "new" | "learning" | "due" | "later" | "lapsed" | "suspended";
/** One SRS record in a given state (ids follow the app: noteId:hash(question)). */
export function card(noteId: string, key: string, state: CardState, c: Clock, i = 0): Card {
  const base = { id: `${noteId}:${key}`, noteId, deleted: 0 as const, dirty: 0 as const };
  switch (state) {
    case "new": return { ...base, ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0, updatedAt: 0 };
    case "learning": return { ...base, ease: 2.5, interval: 0, due: c.now + ((i % 9) + 1) * MIN, reps: 1, lapses: 0, updatedAt: c.ago(10) };
    case "due": return { ...base, ease: 2.3 + (i % 5) / 10, interval: 1 + (i % 12), due: c.now - ((i % 48) + 1) * HOUR, reps: 2 + (i % 6), lapses: 0, updatedAt: c.ago(60 * 24 * 3) };
    case "later": return { ...base, ease: 2.5 + (i % 4) / 10, interval: 3 + (i % 60), due: c.now + (1 + (i % 45)) * DAY + (i % 7) * HOUR, reps: 3 + (i % 8), lapses: 0, updatedAt: c.ago(60 * 24 * 2) };
    case "lapsed": return { ...base, ease: 1.3 + (i % 4) / 10, interval: 0, due: c.now - ((i % 5) + 1) * MIN, reps: 0, lapses: 1 + (i % 4), updatedAt: c.ago(5) };
    case "suspended": return { ...base, ease: 2.1, interval: 8, due: c.now - 2 * DAY, reps: 4, lapses: 2, suspended: 1, updatedAt: c.ago(60 * 24 * 7) };
  }
}
/** Card records for every flashcard in the given notes; state chosen per card. */
export function cardsFor(notes: Note[], c: Clock, pick: (i: number, n: Note) => CardState): Card[] {
  const out: Card[] = [];
  let i = 0;
  for (const n of notes) {
    if (n.type === "canvas" || n.type === "whiteboard" || n.deleted) continue;
    for (const fc of flashcards(n.body)) { out.push(card(n.id, fc.key, pick(i, n), c, i)); i++; }
  }
  return out;
}

export function version(id: string, n: Note, body: string, createdAt: number, label = ""): Version {
  return { id, noteId: n.id, title: n.title, body, label, createdAt, updatedAt: createdAt, deleted: 0, dirty: 0 };
}
export function session(id: string, noteId: string | null, minutes: number, at: number): Session {
  return { id, noteId, minutes, at, updatedAt: at, deleted: 0, dirty: 0 };
}
export function attachment(id: string, name: string, mime: string, size: number, updatedAt = Date.now() - DAY): AttachmentMeta {
  return { id, name, mime, size, updatedAt, deleted: 0, dirty: 0 };
}

// ------------------------------------------------------------------ small real media files
export async function pngBlob(w: number, h: number, bg: string, label: string): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { g.fillStyle = `hsla(${i * 60}, 70%, 60%, .55)`; g.beginPath(); g.arc(w * (0.15 + i * 0.14), h * 0.45, h * 0.18, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#fff"; g.font = `bold ${Math.round(h / 9)}px sans-serif`; g.textAlign = "center"; g.fillText(label, w / 2, h * 0.85);
  return new Promise((r) => cv.toBlob((b) => r(b ?? new Blob([], { type: "image/png" })), "image/png"));
}
/** 16-bit mono PCM WAV with a sine tone. */
export function wavBlob(seconds: number, freq = 440, rate = 8000): Blob {
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * Math.min(1, (n - i) / 800), true);
  return new Blob([buf], { type: "audio/wav" });
}
/** Minimal one-page PDF with a line of text. */
export function pdfBlob(text: string): Blob {
  const safe = text.replace(/[()\\]/g, "");
  const stream = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}
export const svgBlob = (svg: string) => new Blob([svg], { type: "image/svg+xml" });

/** Store a real blob + its attachment meta in the vault. */
export function addFile(v: Vault, id: string, name: string, blob: Blob) {
  v.attachments.push(attachment(id, name, blob.type, blob.size));
  v.blobs.push({ id, blob, uploaded: 1 });
}

// ------------------------------------------------------------------ write
/** Wipe every demo table (meta keeps only UI-independent keys) and bulk-write the vault. */
export async function writeVault(db: LumenDB, v: Vault) {
  const tables = [db.spaces, db.notes, db.folders, db.versions, db.cards, db.sessions, db.attachments, db.blobs];
  seeding.on = true;
  try { await write(); } finally { seeding.on = false; }
  async function write() { await db.transaction("rw", [...tables, db.meta], async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.meta.where("k").anyOf("cursor").delete();
    const spaces = v.spaces.some((s) => s.id === "inbox") ? v.spaces : [INBOX, ...v.spaces];
    await db.spaces.bulkPut(spaces);
    await db.folders.bulkPut(v.folders);
    await db.notes.bulkPut(v.notes);
    await db.versions.bulkPut(v.versions);
    await db.cards.bulkPut(v.cards);
    await db.sessions.bulkPut(v.sessions);
    await db.attachments.bulkPut(v.attachments);
    await db.blobs.bulkPut(v.blobs);
    if (v.meta?.length) await db.meta.bulkPut(v.meta);
  }); }
}
