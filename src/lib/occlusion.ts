// Image occlusion flashcards. Pure: no DOM, no React. Docs: docs/FLASHCARDS.md.
//
// A fenced block in any note:
//
//   ```occlusion
//   id: oc-k3f9
//   image: att:4f2a…            (attachment, https:// URL, or a relative path)
//   alt: Transformer block
//   mode: hide-one              (hide-one = hide one, show others · hide-all = hide all, guess one)
//   boxes:
//     - {id: b1, x: 0.112, y: 0.08, w: 0.21, h: 0.06, label: Multi-head attention}
//     - {id: b2, x: 0.112, y: 0.31, w: 0.21, h: 0.06, label: Add & norm, group: norm}
//   ```
//
// JSON with the same keys works too. x / y / w / h are fractions of the image (0…1, top-left origin).
// Each box is one card; boxes sharing a `group` form one card (hidden and revealed together).
// Card key = `oc-<block id>-<box id or g.group>`, so moving or relabelling a box keeps its schedule.

export type OcclusionMode = "hide-one" | "hide-all";
export interface OcclusionBox { id: string; x: number; y: number; w: number; h: number; label?: string; group?: string }
export interface Occlusion { id: string; image: string; alt?: string; mode: OcclusionMode; boxes: OcclusionBox[] }
export interface OcclusionBlock { data: Occlusion; /** 0-based lines of the opening and closing fence in the full note. */ from: number; to: number; raw: string; error?: string }
export interface OcclusionCardData { key: string; line: number; label: string; target: string[]; data: Occlusion }

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Keep a box inside the image with a minimum size. */
export function clampBox(b: OcclusionBox, min = 0.01): OcclusionBox {
  const w = Math.min(1, Math.max(min, Math.abs(b.w)));
  const h = Math.min(1, Math.max(min, Math.abs(b.h)));
  return { ...b, x: r4(Math.min(1 - w, clamp01(b.x))), y: r4(Math.min(1 - h, clamp01(b.y))), w: r4(w), h: r4(h) };
}

const ID_CH = "abcdefghijkmnpqrstuvwxyz23456789";
export function shortId(len = 4, rnd: () => number = Math.random) {
  let s = "";
  for (let i = 0; i < len; i++) s += ID_CH[Math.floor(rnd() * ID_CH.length)];
  return s;
}
/** Next box id: b<highest + 1> (never reuses a deleted box's id while later boxes exist, so schedules don't jump). */
export function nextBoxId(o: Pick<Occlusion, "boxes">) {
  const max = Math.max(0, ...o.boxes.map((b) => Number(/^b(\d+)$/.exec(b.id)?.[1] ?? 0)));
  return `b${max + 1}`;
}

// ------------------------------------------------------------------ tiny YAML subset (what serializeOcclusion writes, plus block-style boxes)
function scalar(v: string): string | number | boolean {
  const s = v.trim();
  if (/^".*"$/.test(s)) { try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return Number(s);
  if (s === "true" || s === "false") return s === "true";
  return s;
}
/** Split `a: 1, b: "x, y"` on top-level commas. */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let q: string | null = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ",") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function flowMap(s: string): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const part of splitFlow(s.trim().replace(/^\{|\}$/g, ""))) {
    const i = part.indexOf(":");
    if (i > 0) o[part.slice(0, i).trim()] = scalar(part.slice(i + 1));
  }
  return o;
}
function parseYaml(src: string): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const boxes: Record<string, unknown>[] = [];
  let inBoxes = false;
  let item: Record<string, unknown> | null = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const ind = /^\s*/.exec(line)![0].length;
    const t = line.trim();
    if (ind === 0 && !t.startsWith("-")) {
      inBoxes = false; item = null;
      const i = t.indexOf(":");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
      if (k === "boxes") { inBoxes = true; o.boxes = boxes; if (v.startsWith("[")) { inBoxes = false; o.boxes = parseFlowList(v); } continue; }
      o[k] = scalar(v);
      continue;
    }
    if (!inBoxes) continue;
    if (t.startsWith("-")) {
      const rest = t.slice(1).trim();
      if (rest.startsWith("{")) { boxes.push(flowMap(rest)); item = null; continue; }
      item = {};
      boxes.push(item);
      const i = rest.indexOf(":");
      if (i > 0) item[rest.slice(0, i).trim()] = scalar(rest.slice(i + 1));
      continue;
    }
    if (item) { const i = t.indexOf(":"); if (i > 0) item[t.slice(0, i).trim()] = scalar(t.slice(i + 1)); }
  }
  return o;
}
function parseFlowList(v: string): Record<string, unknown>[] {
  return [...v.matchAll(/\{[^{}]*\}/g)].map((m) => flowMap(m[0]));
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : NaN);
/** Parse the content of an ```occlusion block (JSON or YAML). Never throws: bad input gives `error` and no boxes. */
export function parseOcclusion(src: string, fallbackId?: string): { data: Occlusion; error?: string } {
  let raw: Record<string, unknown> = {};
  let error: string | undefined;
  const s = src.trim();
  try { raw = s.startsWith("{") ? (JSON.parse(s) as Record<string, unknown>) : parseYaml(src); } catch (e) { error = "Invalid JSON: " + (e as Error).message; }
  const boxesIn = Array.isArray(raw.boxes) ? (raw.boxes as Record<string, unknown>[]) : [];
  const boxes: OcclusionBox[] = [];
  const seen = new Set<string>();
  boxesIn.forEach((b, i) => {
    if (!b || typeof b !== "object") return;
    const x = num(b.x), y = num(b.y), w = num(b.w ?? b.width), h = num(b.h ?? b.height);
    if ([x, y, w, h].some((v) => isNaN(v))) return;
    let id = String(b.id ?? "").trim() || `b${i + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    const box: OcclusionBox = clampBox({ id, x, y, w, h });
    if (b.label != null && String(b.label).trim()) box.label = String(b.label).trim();
    if (b.group != null && String(b.group).trim()) box.group = String(b.group).trim();
    boxes.push(box);
  });
  const image = String(raw.image ?? raw.src ?? "").trim();
  const data: Occlusion = {
    id: String(raw.id ?? "").trim() || fallbackId || "oc-" + shortHash(image),
    image,
    mode: raw.mode === "hide-all" ? "hide-all" : "hide-one",
    boxes,
  };
  if (raw.alt != null && String(raw.alt).trim()) data.alt = String(raw.alt).trim();
  return { data, error };
}
function shortHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 6);
}

/** YAML scalar: quote only when needed. */
function ys(v: string): string {
  return /^[\p{L}\p{N}_ ./&()+:?=%~-]*[\p{L}\p{N}_./)]$/u.test(v) && !/:\s/.test(v) && !/^(true|false|-?\d[\d.e-]*)$/i.test(v) && !/^[-\s]/.test(v) ? v : JSON.stringify(v);
}
/** The block content (without fences): YAML, one box per line. */
export function serializeOcclusion(o: Occlusion): string {
  const lines = [`id: ${ys(o.id)}`, `image: ${ys(o.image)}`];
  if (o.alt) lines.push(`alt: ${ys(o.alt)}`);
  lines.push(`mode: ${o.mode}`);
  if (!o.boxes.length) lines.push("boxes: []");
  else {
    lines.push("boxes:");
    for (const b0 of o.boxes) {
      const b = clampBox(b0);
      const parts = [`id: ${ys(b.id)}`, `x: ${b.x}`, `y: ${b.y}`, `w: ${b.w}`, `h: ${b.h}`];
      if (b.label) parts.push(`label: ${ys(b.label)}`);
      if (b.group) parts.push(`group: ${ys(b.group)}`);
      lines.push(`  - {${parts.join(", ")}}`);
    }
  }
  return lines.join("\n");
}
export const occlusionFence = (o: Occlusion) => "```occlusion\n" + serializeOcclusion(o) + "\n```";
export function newOcclusion(image = "", rnd?: () => number): Occlusion {
  return { id: "oc-" + shortId(4, rnd), image, mode: "hide-one", boxes: [] };
}

/** Every ```occlusion block in a note (lines are 0-based in the full note). */
export function occlusionBlocks(md: string): OcclusionBlock[] {
  if (!md.includes("occlusion")) return [];
  const lines = md.split("\n");
  const out: OcclusionBlock[] = [];
  let fence: string | null = null, start = -1, isOcc = false;
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i]);
    if (!fence) {
      if (f) { fence = f[1]; start = i; isOcc = f[2] === "occlusion"; }
      continue;
    }
    if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) {
      if (isOcc) {
        const raw = lines.slice(start + 1, i).join("\n");
        const { data, error } = parseOcclusion(raw);
        out.push({ data, from: start, to: i, raw, error });
      }
      fence = null;
    }
  }
  return out;
}

/** Card units of one occlusion: one per ungrouped box, one per group (in box order). */
export function occlusionUnits(o: Occlusion): { key: string; target: string[]; label: string }[] {
  const out: { key: string; target: string[]; label: string }[] = [];
  const groups = new Map<string, { key: string; target: string[]; label: string }>();
  o.boxes.forEach((b, i) => {
    if (b.group) {
      const g = groups.get(b.group);
      if (g) { g.target.push(b.id); if (b.label) g.label = g.label ? `${g.label} · ${b.label}` : b.label; return; }
      const u = { key: `g.${b.group}`, target: [b.id], label: b.label ?? "" };
      groups.set(b.group, u);
      out.push(u);
      return;
    }
    out.push({ key: b.id, target: [b.id], label: b.label ?? `Box ${i + 1}` });
  });
  for (const u of out) if (!u.label) u.label = u.key.startsWith("g.") ? `Group ${u.key.slice(2)}` : u.key;
  return out;
}
export const occlusionCardCount = (o: Occlusion) => occlusionUnits(o).length;

export function occlusionCards(md: string): OcclusionCardData[] {
  const out: OcclusionCardData[] = [];
  for (const b of occlusionBlocks(md)) {
    if (!b.data.image) continue;
    for (const u of occlusionUnits(b.data)) out.push({ key: `oc-${b.data.id}-${u.key}`, line: b.from, label: u.label, target: u.target, data: b.data });
  }
  return out;
}

/** Replace the block that starts at `fromLine` (or carries id `id`) with `o`. Returns the new note text (unchanged if not found). */
export function writeOcclusion(md: string, o: Occlusion, fromLine?: number): string {
  const blocks = occlusionBlocks(md);
  const b = blocks.find((x) => x.data.id === o.id) ?? blocks.find((x) => x.from === fromLine);
  if (!b) return md;
  const lines = md.split("\n");
  lines.splice(b.from + 1, b.to - b.from - 1, ...serializeOcclusion(o).split("\n"));
  return lines.join("\n");
}

/** `att:id` → attachment id, else null. */
export const attId = (src: string) => (/^att:([\w-]+)$/.exec(src.trim())?.[1] ?? null);
/** Image sources found in a note: ![](att:…) attachments and http(s) images, in order, unique. */
export function noteImages(md: string): { src: string; alt: string }[] {
  const out: { src: string; alt: string }[] = [];
  const seen = new Set<string>();
  for (const m of md.matchAll(/!\[([^\]]*)\]\(\s*<?((?:att:[\w-]+)|(?:https?:\/\/[^\s)>]+))>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ src: m[2], alt: m[1] });
  }
  return out;
}
/** Safe image URL for rendering (att: handled by the caller). */
export const safeImageUrl = (src: string) => (/^(https?:|data:image\/|blob:|\/|\.{0,2}\/)/i.test(src.trim()) ? src.trim() : "");
