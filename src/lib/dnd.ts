// Drag and drop model (brief §12): one typed payload, one engine for native HTML5 drag, touch long-press (pointer events)
// and keyboard pick-up, one place for feedback state. Workspaces register a Zone; <DndHost/> (components/dnd) renders the feedback.
//   payload  → application/x-lumen+json on DataTransfer (own sources) · OS files / text / URLs are read from the drop itself
//   zone     → { el, name, probe(), drop(), scroll() }; probe says allowed / why not / nest target / snap / guides
import { useSyncExternalStore } from "react";
import type { Note } from "../../shared/types";
import { t } from "./i18n";
import { getLibraryItem } from "./library-items";
import { getVault } from "./store";

export const MIME = "application/x-lumen+json";

export type DndPayload =
  | { kind: "library-item"; item: Record<string, unknown>; label?: string }
  | { kind: "note"; id: string }
  | { kind: "notes"; ids: string[] }
  | { kind: "graph-nodes"; ids: string[]; edges?: [string, string][] }
  | { kind: "file"; attId: string; name: string; mime?: string; size?: number }
  | { kind: "files"; files: File[] } // OS files (only readable on drop)
  | { kind: "text"; text: string; from?: { id: string; title: string } }
  | { kind: "url"; url: string; title?: string }
  | { kind: "diagram"; id: string }
  | { kind: "workspace"; id: string };

export type Pt = { x: number; y: number };
export type Guide = { x1: number; y1: number; x2: number; y2: number; gap?: boolean };
/** What a zone says about the drop under the pointer (all coordinates are screen px). */
export interface Probe {
  ok: boolean;
  /** One-line reason shown under the pointer when not allowed. */
  reason?: string;
  /** Short hint when allowed ("Drop into VPC", "+ Link to Payments API"). */
  hint?: string;
  /** Group / card element that lights up. */
  nest?: HTMLElement | null;
  /** Where the item will land (snapped), for the ghost. */
  snap?: Pt;
  guides?: Guide[];
}
export interface Zone {
  el: HTMLElement;
  /** Zones that cover many hosts (whiteboards): match by element, and give the host for geometry. */
  match?: (el: Element) => boolean;
  host?: () => HTMLElement | null;
  /** The drop is performed by the host editor itself (whiteboard: registerWb drop): the engine only draws feedback. */
  external?: boolean;
  /** Leave some drags to the editor's own handler (PDF highlight cards on a canvas). */
  ignore?: (dt: DataTransfer) => boolean;
  /** Screen-reader name: "Canvas Backprop study board". */
  name: string;
  probe(p: DndPayload, pt: Pt, alt: boolean): Probe;
  drop(p: DndPayload, pt: Pt, alt: boolean): void | Promise<void>;
  /** Pan the board by (dx, dy) screen px while the pointer is near an edge. */
  scroll?(dx: number, dy: number): void;
}

// ------------------------------------------------------------------ payload helpers
export const URL_RE = /^https?:\/\/\S+$/i;
export const videoEmbed = (u: string): string | null => {
  try {
    const x = new URL(u), h = x.hostname.replace(/^www\./, "");
    if (h === "youtu.be") return `https://www.youtube.com/embed/${x.pathname.slice(1)}`;
    if (h.endsWith("youtube.com")) { const id = x.searchParams.get("v"); return id ? `https://www.youtube.com/embed/${id}` : null; }
    if (h === "vimeo.com") { const id = x.pathname.split("/").filter(Boolean)[0]; return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null; }
  } catch { /* not a URL */ }
  return null;
};

let active: { payload: DndPayload; label: string } | null = null;
export const activeDrag = () => active;

/** Put a typed payload on a native drag (call from onDragStart). Also sets text/plain so other apps get something useful. */
export function setDrag(e: { dataTransfer: DataTransfer | null }, payload: DndPayload, label?: string) {
  const dt = e.dataTransfer;
  if (!dt) return;
  active = { payload, label: label ?? describe(payload).label };
  dt.setData(MIME, JSON.stringify(payload, (_k, v) => (v instanceof File ? undefined : v)));
  dt.effectAllowed = "copyMove";
  if (!dt.types.includes("text/plain")) {
    const p = payload;
    dt.setData("text/plain", p.kind === "url" ? p.url : p.kind === "text" ? p.text : describe(p).label);
  }
  setGhostImage(dt, describe(payload));
  document.documentElement.classList.add("ldnd-active");
  document.addEventListener("dragend", endDrag, { once: true, capture: true });
}
export function endDrag() {
  active = null;
  document.documentElement.classList.remove("ldnd-active");
  engine.leave();
}

/** The little lifted chip the browser uses as the drag image (with the count badge for several items). */
function setGhostImage(dt: DataTransfer, d: { label: string; count: number }) {
  try {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:-999px;top:-999px;padding:8px 12px;border-radius:10px;font:500 12px Inter,system-ui,sans-serif;background:var(--surface-2,#1D222B);color:var(--text,#E8E6E1);border:1.5px solid var(--accent,#F2A93B);box-shadow:0 16px 32px rgba(0,0,0,.35);transform:rotate(-2deg);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    el.textContent = d.label;
    if (d.count > 1) { const b = document.createElement("span"); b.textContent = String(d.count); b.style.cssText = "margin-inline-start:8px;padding:1px 7px;border-radius:999px;background:var(--accent,#F2A93B);color:var(--accent-ink,#1A1206);font-weight:700;font-size:11px"; el.appendChild(b); }
    document.body.appendChild(el);
    dt.setDragImage(el, 16, 16);
    setTimeout(() => el.remove(), 0);
  } catch { /* drag image is cosmetic */ }
}

export function notesOf(p: DndPayload): Note[] {
  const v = getVault();
  const ids = p.kind === "note" ? [p.id] : p.kind === "notes" || p.kind === "graph-nodes" ? p.ids : p.kind === "diagram" || p.kind === "workspace" ? [p.id] : [];
  return ids.map((id) => v.byId.get(id)).filter((n): n is Note => !!n && !n.deleted);
}

/** Label, count and glyph for the ghost, announcements and the count badge. */
export function describe(p: DndPayload): { label: string; count: number; glyph: string } {
  switch (p.kind) {
    case "library-item": return { label: String(p.label ?? p.item.label ?? p.item.l ?? t("Shape")), count: 1, glyph: String(p.item.glyph ?? p.item.g ?? "shape-square") };
    case "note": case "diagram": case "workspace": { const n = notesOf(p)[0]; return { label: n?.title || t("Untitled"), count: 1, glyph: p.kind === "diagram" ? "diagram" : "note-card" }; }
    case "notes": return { label: t("{n} note|{n} notes", { n: p.ids.length }), count: p.ids.length, glyph: "note-card" };
    case "graph-nodes": return { label: t("{n} note|{n} notes", { n: p.ids.length }), count: p.ids.length, glyph: "graph" };
    case "file": return { label: p.name, count: 1, glyph: "file" };
    case "files": return { label: p.files.length === 1 ? p.files[0].name : t("{n} file|{n} files", { n: p.files.length }), count: p.files.length, glyph: "file" };
    case "text": return { label: p.text.replace(/\s+/g, " ").slice(0, 48), count: 1, glyph: "text" };
    case "url": return { label: p.title || p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48), count: 1, glyph: "link" };
  }
}

/** Parse our payload, or fall back to OS files / URL / text from a native drop. */
/** Our payloads use `kind`; the shared library (W2-B) puts { type: "library-item", id } on the same MIME: normalise both. */
function normalise(o: unknown): DndPayload | null {
  const x = o as { kind?: string; type?: string; id?: string } | null;
  if (!x) return null;
  if (x.kind) return x as DndPayload;
  if (x.type === "library-item" && x.id) { const it = getLibraryItem(x.id); return { kind: "library-item", item: { libId: x.id, glyph: it?.glyph, label: it?.name }, label: it?.name }; }
  return null;
}
export function readDrop(dt: DataTransfer): DndPayload | null {
  try {
    const raw = dt.getData(MIME);
    if (raw) { const p = normalise(JSON.parse(raw)); if (p) return p; }
  } catch { /* fall through */ }
  if (active && !dt.files?.length) return active.payload;
  if (dt.files?.length) return { kind: "files", files: [...dt.files] };
  const uri = (dt.getData("text/uri-list") || "").split("\n").find((l) => l && !l.startsWith("#"))?.trim();
  if (uri && URL_RE.test(uri)) return { kind: "url", url: uri };
  const txt = dt.getData("text/plain");
  if (txt) return URL_RE.test(txt.trim()) ? { kind: "url", url: txt.trim() } : { kind: "text", text: txt };
  return null;
}
/** During dragover only the types are readable: enough to show the right ghost. */
export function peekDrag(dt: DataTransfer): DndPayload | null {
  if (active) return active.payload;
  const ty = [...dt.types];
  if (ty.includes(MIME)) return { kind: "library-item", item: {}, label: t("Shape") }; // own drags set `active`; this is the shared library's
  if (ty.includes("Files")) return { kind: "files", files: [...(dt.files ?? [])] };
  if (ty.includes("text/uri-list")) return { kind: "url", url: "https://" };
  if (ty.includes("text/plain")) return { kind: "text", text: "…" };
  return null;
}
export const isLumenDrag = (dt: DataTransfer) => [...dt.types].some((x) => x === MIME || x === "Files" || x === "text/uri-list" || x === "text/plain");

// ------------------------------------------------------------------ engine state (feedback)
export interface DndState {
  payload: DndPayload;
  label: string;
  count: number;
  glyph: string;
  mode: "native" | "pointer" | "keyboard";
  x: number; y: number;
  alt: boolean;
  zone: Zone | null;
  probe: Probe | null;
  /** Edge auto-scroll direction (-1..1 per axis) for the gradient hint. */
  edge: { x: number; y: number };
}
export interface Chip { id: number; text: string; undo?: () => void; ms: number }
export interface Dup { name: string; resolve: (useExisting: boolean | null) => void }
export interface SendTo { payload: DndPayload }

let state: DndState | null = null;
let chip: Chip | null = null;
let dup: Dup | null = null;
let sendTo: SendTo | null = null;
let live = "";
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => (subs.add(f), () => { subs.delete(f); });
export const useDndState = () => useSyncExternalStore(sub, () => state);
export const useDndChip = () => useSyncExternalStore(sub, () => chip);
export const useDndDup = () => useSyncExternalStore(sub, () => dup);
export const useDndSend = () => useSyncExternalStore(sub, () => sendTo);
export const useDndLive = () => useSyncExternalStore(sub, () => live);

export function announce(text: string) { live = ""; emit(); live = text; emit(); }
export function showChip(text: string, undo?: () => void, ms = 3000) {
  const id = Date.now() + Math.random();
  chip = { id, text, undo, ms };
  emit();
  setTimeout(() => { if (chip?.id === id) { chip = null; emit(); } }, ms);
}
export const dismissChip = () => { chip = null; emit(); };
export const openSendTo = (payload: DndPayload) => { sendTo = { payload }; emit(); };
export const closeSendTo = () => { sendTo = null; emit(); };
/** "Use the existing attachment?" Resolves true = use it, false = upload again, null = cancelled. */
export function askDuplicate(name: string): Promise<boolean | null> {
  return new Promise((resolve) => { dup = { name, resolve: (v) => { dup = null; emit(); resolve(v); } }; emit(); });
}

// ------------------------------------------------------------------ zones + engine
const zones = new Set<Zone>();
export function registerZone(z: Zone) { zones.add(z); return () => { zones.delete(z); }; }
export const zoneEl = (z: Zone): HTMLElement => z.host?.() ?? z.el;
export const allZones = () => [...zones].filter((z) => { const e = zoneEl(z); return e.isConnected && e !== document.body && e.offsetParent !== null; });
/** Zones are matched by DOM containment, innermost first. */
export function zoneAt(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y);
  let best: Zone | null = null;
  for (const z of zones) if (el && (z.match ? z.match(el) : z.el.contains(el)) && (!best || (best.match ? true : best.el.contains(z.el)))) best = z;
  return best;
}

const EDGE = 48, SPEED = 14;
let raf = 0;
function edgeOf(z: Zone, x: number, y: number) {
  const r = zoneEl(z).getBoundingClientRect();
  const k = (d: number) => Math.max(0, Math.min(1, (EDGE - d) / EDGE));
  return { x: k(x - r.left) * -1 + k(r.right - x), y: k(y - r.top) * -1 + k(r.bottom - y) };
}
function loop() {
  raf = 0;
  if (!state?.zone?.scroll) return;
  const { x, y } = state.edge;
  if (x || y) state.zone.scroll(-x * SPEED, -y * SPEED);
  if (x || y) raf = requestAnimationFrame(loop);
}

export const engine = {
  begin(payload: DndPayload, mode: DndState["mode"], at: Pt, label?: string) {
    const d = describe(payload);
    state = { payload, label: label ?? d.label, count: d.count, glyph: d.glyph, mode, x: at.x, y: at.y, alt: false, zone: null, probe: null, edge: { x: 0, y: 0 } };
    document.documentElement.classList.add("ldnd-active");
    emit();
  },
  over(x: number, y: number, alt: boolean, payload?: DndPayload) {
    const p = payload ?? state?.payload;
    if (!p) return null;
    if (!state) engine.begin(p, "native", { x, y });
    const z = zoneAt(x, y);
    const probe = z ? z.probe(p, { x, y }, alt) : null;
    const edge = z && z.scroll ? edgeOf(z, x, y) : { x: 0, y: 0 };
    const d = describe(p);
    state = { ...state!, payload: p, label: state!.label || d.label, count: d.count, glyph: d.glyph, x, y, alt, zone: z, probe, edge };
    if ((edge.x || edge.y) && !raf) raf = requestAnimationFrame(loop);
    emit();
    return probe;
  },
  leave() {
    if (state?.mode === "native" || !state) { state = null; document.documentElement.classList.remove("ldnd-active"); emit(); }
    markNest(null);
  },
  end() { state = null; if (raf) cancelAnimationFrame(raf); raf = 0; document.documentElement.classList.remove("ldnd-active"); markNest(null); emit(); },
  async drop(x: number, y: number, alt: boolean, payload?: DndPayload): Promise<boolean> {
    const p = payload ?? state?.payload;
    const z = zoneAt(x, y);
    const probe = p && z ? z.probe(p, { x, y }, alt) : null;
    engine.end();
    active = null;
    if (!p || !z) return false;
    if (!probe?.ok) { if (probe?.reason) { announce(probe.reason); showChip(probe.reason, undefined, 2500); } return false; }
    try { await z.drop(p, probe.snap ?? { x, y }, alt); } catch (e) { showChip((e as Error).message); return false; }
    return true;
  },
};
let nestEl: HTMLElement | null = null;
export function markNest(el: HTMLElement | null | undefined) {
  if (nestEl === el) return;
  nestEl?.classList.remove("ldnd-nest");
  nestEl = el ?? null;
  nestEl?.classList.add("ldnd-nest");
}

// ------------------------------------------------------------------ geometry shared by the zones
export type Rect = { id?: string; x: number; y: number; w: number; h: number };
/** Snap a moving box to other boxes' edges and centres (alignment guides), then to the grid. Works in board units. */
export function alignSnap(box: Rect, others: Rect[], opts: { grid?: number; tol?: number } = {}): { x: number; y: number; guides: { v?: number; h?: number; from: number; to: number }[] } {
  const tol = opts.tol ?? 6;
  let { x, y } = box;
  const guides: { v?: number; h?: number; from: number; to: number }[] = [];
  let bx = tol + 1, by = tol + 1;
  for (const o of others) {
    for (const [mine, theirs] of [[x, o.x], [x + box.w / 2, o.x + o.w / 2], [x + box.w, o.x + o.w], [x, o.x + o.w], [x + box.w, o.x]] as const) {
      const d = theirs - mine;
      if (Math.abs(d) < Math.min(bx, tol)) { bx = Math.abs(d); x += d; }
    }
    for (const [mine, theirs] of [[y, o.y], [y + box.h / 2, o.y + o.h / 2], [y + box.h, o.y + o.h], [y, o.y + o.h], [y + box.h, o.y]] as const) {
      const d = theirs - mine;
      if (Math.abs(d) < Math.min(by, tol)) { by = Math.abs(d); y += d; }
    }
  }
  if (bx > tol && opts.grid) x = Math.round(x / opts.grid) * opts.grid;
  if (by > tol && opts.grid) y = Math.round(y / opts.grid) * opts.grid;
  for (const o of others) {
    for (const t2 of [o.x, o.x + o.w / 2, o.x + o.w]) for (const m of [x, x + box.w / 2, x + box.w]) if (Math.abs(t2 - m) < 0.5) guides.push({ v: t2, from: Math.min(y, o.y), to: Math.max(y + box.h, o.y + o.h) });
    for (const t2 of [o.y, o.y + o.h / 2, o.y + o.h]) for (const m of [y, y + box.h / 2, y + box.h]) if (Math.abs(t2 - m) < 0.5) guides.push({ h: t2, from: Math.min(x, o.x), to: Math.max(x + box.w, o.x + o.w) });
  }
  return { x, y, guides: guides.slice(0, 6) };
}

/** Lay out dropped graph nodes the way the graph does: a small force layout around the drop point (links pull, nodes repel). */
export function layoutLikeGraph(ids: string[], edges: [string, string][], size: { w: number; h: number }): Map<string, Pt> {
  const n = ids.length;
  const pos = new Map<string, Pt>();
  const r0 = Math.max(120, Math.sqrt(n) * (size.w + 40) * 0.55);
  ids.forEach((id, i) => { const a = (i / Math.max(1, n)) * Math.PI * 2; pos.set(id, { x: Math.cos(a) * r0, y: Math.sin(a) * r0 * 0.7 }); });
  if (n < 2) { pos.set(ids[0], { x: 0, y: 0 }); return pos; }
  const ix = new Map(ids.map((id, i) => [id, i]));
  const ed = edges.filter(([a, b]) => ix.has(a) && ix.has(b) && a !== b);
  const gapX = size.w + 48, gapY = size.h + 48;
  for (let it = 0; it < 160; it++) {
    const f = new Map<string, Pt>(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
      let dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01; dx /= d; dy /= d;
      const rep = 40000 / (d * d);
      f.get(ids[i])!.x += dx * rep; f.get(ids[i])!.y += dy * rep; f.get(ids[j])!.x -= dx * rep; f.get(ids[j])!.y -= dy * rep;
    }
    for (const [s, e] of ed) {
      const a = pos.get(s)!, b = pos.get(e)!;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const k = (d - (size.w + 90)) * 0.04;
      f.get(s)!.x += (dx / d) * k; f.get(s)!.y += (dy / d) * k; f.get(e)!.x -= (dx / d) * k; f.get(e)!.y -= (dy / d) * k;
    }
    for (const id of ids) { const p = pos.get(id)!, q = f.get(id)!; p.x -= p.x * 0.01; p.y -= p.y * 0.01; p.x += Math.max(-12, Math.min(12, q.x)); p.y += Math.max(-12, Math.min(12, q.y)); }
  }
  // push apart any boxes that still overlap
  for (let it = 0; it < 30; it++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
    const ox = gapX - Math.abs(a.x - b.x), oy = gapY - Math.abs(a.y - b.y);
    if (ox > 0 && oy > 0) { if (ox < oy) { const s = a.x < b.x ? -1 : 1; a.x += (s * ox) / 2; b.x -= (s * ox) / 2; } else { const s = a.y < b.y ? -1 : 1; a.y += (s * oy) / 2; b.y -= (s * oy) / 2; } }
  }
  return pos;
}
/** Links between the given notes (resolved from the vault's outlinks). */
export function linksAmong(ids: string[]): [string, string][] {
  const v = getVault(), set = new Set(ids), out: [string, string][] = [];
  for (const id of ids) for (const to of v.outlinks.get(id) ?? []) if (set.has(to) && to !== id) out.push([id, to]);
  return out;
}

// ------------------------------------------------------------------ files: duplicate check, progress
import { db } from "./db";
/** An earlier attachment with the same name and size (the "Use the existing attachment?" check). */
export async function findDuplicate(f: File): Promise<{ id: string; name: string } | null> {
  const all = await db.attachments.toArray();
  const m = all.find((a) => !a.deleted && a.name === f.name && a.size === f.size);
  return m ? { id: m.id, name: m.name } : null;
}
/** Read a (big) file with progress so the card can show it and the main thread never blocks; returns a File with the same bytes. */
export async function readWithProgress(f: File, onProgress: (pct: number) => void): Promise<File> {
  if (f.size < 1_000_000 || !f.stream) return f;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const rd = f.stream().getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.round((got / f.size) * 100));
    await new Promise((r) => setTimeout(r, 0));
  }
  return new File(chunks as BlobPart[], f.name, { type: f.type });
}
export const fileMd = (name: string, id: string, mime: string) => {
  const n = name.replace(/[[\]]/g, "");
  return /^(image|video|audio)\/|^application\/pdf$/.test(mime) ? `![${n}](att:${id})` : `[${n}](att:${id})`;
};
export const DIAGRAM_EXT = /\.(mermaid|mmd|drawio|sql|excalidraw|canvas)$/i;

// ------------------------------------------------------------------ pointer (touch) pick-up: long-press, drag, release
/** Start a pointer-driven drag now (used by long-press on touch and by drag-out from the graph). */
export function startPointerDrag(payload: DndPayload, e: { clientX: number; clientY: number; pointerId?: number; altKey?: boolean }, label?: string) {
  engine.begin(payload, "pointer", { x: e.clientX, y: e.clientY }, label);
  try { navigator.vibrate?.(12); } catch { /* haptic tick is optional */ }
  engine.over(e.clientX, e.clientY, !!e.altKey);
  const move = (ev: PointerEvent) => { ev.preventDefault(); engine.over(ev.clientX, ev.clientY, ev.altKey); };
  const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key, true); };
  const up = (ev: PointerEvent) => { cleanup(); const z = zoneAt(ev.clientX, ev.clientY); if (z) void engine.drop(ev.clientX, ev.clientY, ev.altKey, payload); else { engine.end(); openSendTo(payload); } };
  const cancel = () => { cleanup(); engine.end(); };
  const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); cancel(); } };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

/** Props that make any element a drag source: native drag (mouse), long-press (touch / pen), Space to pick up with the keyboard. */
export function dragProps(payload: () => DndPayload, label?: () => string | undefined) {
  let timer = 0, sx = 0, sy = 0;
  const clear = () => { clearTimeout(timer); timer = 0; };
  return {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); setDrag(e, payload(), label?.()); },
    onDragEnd: () => endDrag(),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      sx = e.clientX; sy = e.clientY; clear();
      timer = window.setTimeout(() => { timer = 0; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ } startPointerDrag(payload(), { clientX: sx, clientY: sy }, label?.()); }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clear(); },
    onPointerUp: clear, onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => { if (timer || (e.nativeEvent as PointerEvent).pointerType === "touch") e.preventDefault(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === " " && !e.repeat && !(e.target as HTMLElement).matches("input,textarea,[contenteditable=true]")) { e.preventDefault(); e.stopPropagation(); startKeyboardDrag(payload(), e.currentTarget as HTMLElement, label?.()); }
    },
    "aria-roledescription": t("draggable item"),
  };
}

// ------------------------------------------------------------------ keyboard pick-up: Space picks up, arrows move (Shift = big), Enter drops, Esc cancels
export function startKeyboardDrag(payload: DndPayload, from: HTMLElement | null, label?: string) {
  const zs = allZones();
  const r = (zs[0] ? zoneEl(zs[0]) : document.body).getBoundingClientRect();
  let x = r.left + r.width / 2, y = r.top + r.height / 2, zi = 0;
  const name = label ?? describe(payload).label;
  engine.begin(payload, "keyboard", { x, y }, name);
  const say = (pr: Probe | null, z: Zone | null) => announce(!z ? t("{item}, picked up. Not over a drop target.", { item: name }) : pr?.ok ? t("{item}, picked up. Over {target}.{hint}", { item: name, target: z.name, hint: pr.hint ? ` ${pr.hint}.` : "" }) : t("{item}: {reason}", { item: name, reason: pr?.reason ?? t("can't drop here") }));
  const upd = () => { const pr = engine.over(x, y, false, payload); say(pr, state?.zone ?? null); };
  announce(t("{item}, picked up. Arrow keys move, Tab changes target, Enter drops, Escape cancels.", { item: name }));
  upd();
  const done = (drop: boolean) => {
    window.removeEventListener("keydown", key, true);
    if (drop) void engine.drop(x, y, false, payload); else { engine.end(); announce(t("Cancelled")); }
    from?.focus?.();
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 80 : 16;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) { e.preventDefault(); e.stopPropagation(); x += mv[e.key][0]; y += mv[e.key][1]; upd(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); done(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
    else if (e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      const list = allZones(); if (!list.length) return;
      zi = (zi + (e.shiftKey ? list.length - 1 : 1)) % list.length;
      const b = zoneEl(list[zi]).getBoundingClientRect(); x = b.left + b.width / 2; y = b.top + b.height / 2; upd();
    } else if (e.key === "s" || e.key === "S") { e.preventDefault(); e.stopPropagation(); window.removeEventListener("keydown", key, true); engine.end(); openSendTo(payload); }
  };
  window.addEventListener("keydown", key, true);
}

/** Payload for a note drag from anywhere (several selected notes drag as one "notes" payload). */
export const notePayload = (ids: string[]): DndPayload => (ids.length > 1 ? { kind: "notes", ids } : { kind: "note", id: ids[0] });
/** Spread onto a button/row: `{...noteDrag(id)}`. */
export const noteDrag = (id: string | (() => string[])) => dragProps(() => notePayload(typeof id === "function" ? id() : [id]));
