// Anki .apkg / .colpkg import (docs/IMPORT.md). Pure apart from the injected SQLite + zstd decoders, so tests run in Node.
//
// Package = zip with the collection database and media:
//   collection.anki21b  zstd-compressed SQLite, schema 18 (Anki 2.1.50+ exports): note types in `notetypes`/`fields`/
//                       `templates`, decks in `decks` (name parts joined by \x1f); `media` = zstd protobuf
//                       MediaEntries { repeated MediaEntry { string name = 1; … } = 1 }; media files "0", "1", … zstd each.
//   collection.anki21   plain SQLite, schema 11: note types / decks as JSON in col.models / col.decks; `media` = JSON
//                       {"0": "file.jpg"}. collection.anki2: the same, older (in new exports a dummy "please update" deck).
// Tables used: notes(id, mid, tags, flds 0x1f-separated), cards(id, nid, did, ord, type, queue, due, ivl, factor, reps,
// lapses, odue, odid, data), revlog(id = epoch ms, cid, ease 1-4, ivl, type).
//
// Mapping: one flashcards note per deck (sub-decks → a folder per parent deck). Basic (+ reversed) → `Q :: A` (or
// `Q\n?\nA` for multi-line answers), Cloze → `{{cN::…}}` paragraphs, Image Occlusion → an ```occlusion block.
// Review history → Lumen review-log rows; FSRS state from Anki's own FSRS memory (cards.data s/d) when present, else a
// replay of the review log with FSRS-6 (lib/fsrs.ts formulas); due dates are kept.
import { DEFAULT_W, forgetStability, initDifficulty, initStability, nextDifficulty, recallStability, retrievability, shortTermStability } from "./fsrs";
import {
  attLink, attRef, DAY, emptyPlan, htmlText, htmlToMd, imageSize, isZstd, mimeOf, readProto, yieldUI, zipFiles,
  type ImportPlan, type PlanAttachment, type PlanCard, type PlanNote, type Progress, type VFile,
} from "./import-model";
import { serializeOcclusion, type Occlusion, type OcclusionBox } from "./occlusion";
import { flashcards, toFrontMatter } from "./parse";
import { t } from "./i18n";

export const ANKI_TEXT = {
  noCollection: () => t("This file has no Anki collection inside (collection.anki21b / .anki21 / .anki2)."),
  dummy: () => t("This export only has the placeholder collection for old Anki versions. Export again from Anki with “Support older Anki versions” off, or use a newer export."),
  notAnki: () => t("This isn't an Anki package (.apkg / .colpkg)."),
  missingMedia: (n: number) => t("{n} media file is referenced but missing from the package.|{n} media files are referenced but missing from the package.", { n }),
  emptyQuestion: (n: number) => t("{n} note has an empty front and was skipped.|{n} notes have an empty front and were skipped.", { n }),
  extraTemplates: (n: number) => t("{n} card from extra card templates (beyond front/back) has no Lumen equivalent and was skipped.|{n} cards from extra card templates (beyond front/back) have no Lumen equivalent and were skipped.", { n }),
  sameQuestion: (n: number) => t("{n} card repeats a question already in the same deck; it shares one schedule.|{n} cards repeat a question already in the same deck; they share one schedule.", { n }),
  oldOcclusion: (n: number) => t("{n} note from the old Image Occlusion add-on (SVG masks) imported as basic cards.|{n} notes from the old Image Occlusion add-on (SVG masks) imported as basic cards.", { n }),
  noShapes: (n: number) => t("{n} image occlusion note has no shapes and was imported as a plain image.|{n} image occlusion notes have no shapes and were imported as plain images.", { n }),
  filtered: () => t("Cards in filtered decks were put back in their home decks."),
};

// ------------------------------------------------------------------ SQLite access (sql.js shape)
export interface SqlDb { exec(sql: string): { columns: string[]; values: unknown[][] }[]; close(): void }
export interface AnkiDeps { openDb(bytes: Uint8Array): SqlDb | Promise<SqlDb>; zstd(bytes: Uint8Array): Uint8Array }

const rows = (db: SqlDb, sql: string): Record<string, unknown>[] => {
  const r = db.exec(sql)[0];
  if (!r) return [];
  return r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]])));
};
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v ?? 0) || 0);
const str = (v: unknown) => (v == null ? "" : v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v));

// ------------------------------------------------------------------ collection model
export type AnkiKind = "basic" | "cloze" | "occlusion";
export interface AnkiNoteType { id: string; name: string; kind: AnkiKind; fields: string[]; templates: string[]; notes: number; legacyOcclusion?: boolean }
export interface AnkiDeck { id: string; /** Full name, parts joined by "::". */ name: string; filtered: boolean }
export interface AnkiNote { id: number; mid: string; tags: string[]; fields: string[] }
export interface AnkiCard { id: number; nid: number; did: string; ord: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number; data: string }
export interface AnkiRev { id: number; cid: number; ease: number; ivl: number; type: number }
export interface AnkiCollection {
  name: string;
  crt: number;
  types: Map<string, AnkiNoteType>;
  decks: Map<string, AnkiDeck>;
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlog: AnkiRev[];
  /** media file name → bytes */
  media: Map<string, () => Promise<Uint8Array>>;
  warnings: string[];
}

/** Read an .apkg / .colpkg (zip bytes or its file list). */
export async function readAnki(input: Uint8Array | VFile[], name: string, deps: AnkiDeps, onProgress?: Progress): Promise<AnkiCollection> {
  const files = Array.isArray(input) ? input : await zipFiles(input, onProgress);
  const by = new Map(files.map((f) => [f.path.replace(/^.*\//, ""), f]));
  onProgress?.(1, 4, "collection");
  let dbBytes: Uint8Array | null = null;
  for (const n of ["collection.anki21b", "collection.anki21", "collection.anki2"]) {
    const f = by.get(n);
    if (!f) continue;
    const b = await f.bytes();
    dbBytes = isZstd(b) ? deps.zstd(b) : b;
    break;
  }
  if (!dbBytes) throw new Error(ANKI_TEXT.noCollection());
  const db = await deps.openDb(dbBytes);
  try {
    onProgress?.(2, 4, "note types");
    const col = rows(db, "select crt, models, decks from col")[0] ?? {};
    const crt = num(col.crt) || Math.floor(Date.now() / 1000);
    const types = new Map<string, AnkiNoteType>();
    const decks = new Map<string, AnkiDeck>();
    const tables = new Set(rows(db, "select name from sqlite_master where type = 'table'").map((r) => str(r.name)));
    if (tables.has("notetypes")) {
      const fields = rows(db, "select ntid, ord, name from fields order by ntid, ord");
      const tmpls = rows(db, "select ntid, ord, name from templates order by ntid, ord");
      for (const t of rows(db, "select id, name, config from notetypes")) {
        const id = str(t.id);
        const cfg = t.config instanceof Uint8Array ? readProto(t.config) : [];
        const cloze = cfg.find((f) => f.no === 1 && f.wire === 0)?.int === 1;
        types.set(id, { id, name: str(t.name), kind: cloze ? "cloze" : "basic", fields: fields.filter((f) => str(f.ntid) === id).map((f) => str(f.name)), templates: tmpls.filter((f) => str(f.ntid) === id).map((f) => str(f.name)), notes: 0 });
      }
      for (const d of rows(db, "select id, name, kind from decks")) {
        const kind = d.kind instanceof Uint8Array ? readProto(d.kind) : [];
        decks.set(str(d.id), { id: str(d.id), name: str(d.name).split("\x1f").join("::"), filtered: kind.some((f) => f.no === 2) });
      }
    } else {
      const models = safeJson(str(col.models)) as Record<string, { id: number | string; name: string; type?: number; flds?: { name: string }[]; tmpls?: { name: string }[] }>;
      for (const m of Object.values(models ?? {})) {
        const id = str(m.id);
        types.set(id, { id, name: m.name, kind: m.type === 1 ? "cloze" : "basic", fields: (m.flds ?? []).map((f) => f.name), templates: (m.tmpls ?? []).map((t) => t.name), notes: 0 });
      }
      const dj = safeJson(str(col.decks)) as Record<string, { id: number | string; name: string; dyn?: number }>;
      for (const d of Object.values(dj ?? {})) decks.set(str(d.id), { id: str(d.id), name: d.name.split("\x1f").join("::"), filtered: !!d.dyn });
    }
    for (const t of types.values()) {
      const f = t.fields.map((x) => x.toLowerCase());
      if (t.kind === "cloze" && (f.includes("occlusion") || f.includes("occlusions")) && f.includes("image")) t.kind = "occlusion";
      // The old "Image Occlusion Enhanced" add-on: basic note type with SVG mask fields.
      if (t.kind === "basic" && /image occlusion/i.test(t.name) && f.some((x) => /mask/.test(x))) t.legacyOcclusion = true;
    }
    onProgress?.(3, 4, "notes and cards");
    const notes: AnkiNote[] = rows(db, "select id, mid, tags, flds from notes order by id").map((n) => ({
      id: num(n.id), mid: str(n.mid), fields: str(n.flds).split("\x1f"),
      tags: str(n.tags).trim().split(/\s+/).filter(Boolean),
    }));
    for (const n of notes) { const t = types.get(n.mid); if (t) t.notes++; }
    const cards: AnkiCard[] = rows(db, "select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odue, odid, data from cards order by id").map((c) => {
      const odid = num(c.odid);
      return {
        id: num(c.id), nid: num(c.nid), did: str(odid ? c.odid : c.did), ord: num(c.ord), type: num(c.type), queue: num(c.queue),
        due: odid ? num(c.odue) || num(c.due) : num(c.due), ivl: num(c.ivl), factor: num(c.factor), reps: num(c.reps), lapses: num(c.lapses), data: str(c.data),
      };
    });
    const warnings: string[] = [];
    if (cards.some((c) => decks.get(c.did)?.filtered === false) && rows(db, "select count(*) as n from cards where odid != 0")[0]?.n) warnings.push(ANKI_TEXT.filtered());
    const revlog: AnkiRev[] = tables.has("revlog") ? rows(db, "select id, cid, ease, ivl, type from revlog order by id").map((r) => ({ id: num(r.id), cid: num(r.cid), ease: num(r.ease), ivl: num(r.ivl), type: num(r.type) })) : [];
    if (notes.length === 1 && cards.length <= 1 && /update|newer|latest version/i.test(notes[0].fields.join(" ")) && !by.has("collection.anki21b")) throw new Error(ANKI_TEXT.dummy());
    onProgress?.(4, 4, "media");
    const media = await readMedia(by, deps);
    return { name: name.replace(/\.(apkg|colpkg)$/i, ""), crt, types, decks, notes, cards, revlog, media, warnings };
  } finally { db.close(); }
}
function safeJson(s: string): unknown { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

async function readMedia(by: Map<string, VFile>, deps: AnkiDeps): Promise<Map<string, () => Promise<Uint8Array>>> {
  const out = new Map<string, () => Promise<Uint8Array>>();
  const f = by.get("media");
  if (!f) return out;
  const raw = await f.bytes();
  const entry = (zipName: string) => async () => {
    const b = await by.get(zipName)!.bytes();
    return isZstd(b) ? deps.zstd(b) : b;
  };
  if (isZstd(raw)) {
    // MediaEntries protobuf: entries = 1 → { name = 1, size = 2, sha1 = 3, legacy_zip_filename = 255 }
    readProto(deps.zstd(raw)).filter((x) => x.no === 1 && x.bytes).forEach((e, i) => {
      const fields = readProto(e.bytes!);
      const nm = fields.find((x) => x.no === 1)?.bytes;
      const legacy = fields.find((x) => x.no === 255)?.int;
      const zipName = String(legacy ?? i);
      if (nm && by.has(zipName)) out.set(new TextDecoder().decode(nm), entry(zipName));
    });
  } else {
    const map = safeJson(new TextDecoder().decode(raw)) as Record<string, string>;
    for (const [zipName, nm] of Object.entries(map ?? {})) if (by.has(zipName)) out.set(nm, entry(zipName));
  }
  return out;
}

// ------------------------------------------------------------------ options
/** Which Anki field is the front and the back; `extra` fields go under the back, below a line. */
export interface FieldMap { front: number; back: number; reverse: boolean; extra?: number[] }
export interface AnkiOptions {
  keepHistory: boolean;
  /** Per basic note type: which field is the front / back, and whether reverse cards are made. */
  mapping: Record<string, FieldMap>;
  /** FSRS weights used to replay the history (the user's fitted weights, default FSRS-6). */
  w?: readonly number[];
  now?: number;
  /** One flashcards note per sub-deck (default). Off: one note per top-level deck, sub-decks as `##` sections. */
  perSubdeck?: boolean;
  /** Import media files (default). Off: images and sounds stay as their file name. */
  media?: boolean;
}
export function defaultMapping(col: AnkiCollection): Record<string, FieldMap> {
  const out: Record<string, FieldMap> = {};
  for (const t of col.types.values()) {
    if (t.kind !== "basic") continue;
    const f = t.fields.map((x) => x.toLowerCase());
    const pick = (re: RegExp, fb: number) => { const i = f.findIndex((x) => re.test(x)); return i >= 0 ? i : fb; };
    const front = pick(/^(front|question|q|term|word|prompt|vorderseite|recto)$/, 0);
    const back = pick(/^(back|answer|a|definition|meaning|translation|rückseite|verso)$/, front === 0 ? 1 : 0);
    const extra = f.map((x, i) => (i !== front && i !== back && /^(back extra|extra)$/.test(x) ? i : -1)).filter((i) => i >= 0);
    out[t.id] = { front, back: back < t.fields.length ? back : -1, reverse: t.templates.length >= 2, ...(extra.length ? { extra } : {}) };
  }
  return out;
}

// ------------------------------------------------------------------ FSRS replay
/** FSRS-6 memory after replaying a card's reviews (same rules as fsrs-optimize replayLoss). Grades 0..3. */
export function replayFsrs(revs: { at: number; grade: 0 | 1 | 2 | 3 }[], w: readonly number[] = DEFAULT_W): { s: number; d: number; last: number } | null {
  if (!revs.length) return null;
  let s = 0, d = 0, last = 0;
  revs.forEach((r, i) => {
    const g = (r.grade + 1) as 1 | 2 | 3 | 4;
    if (i === 0) { s = initStability(w, g); d = Math.min(10, Math.max(1, initDifficulty(w, g))); last = r.at; return; }
    const t = (r.at - last) / DAY;
    if (t < 1) { s = shortTermStability(w, s, g); d = nextDifficulty(w, d, g); last = r.at; return; }
    const R = retrievability(t, s, w);
    s = g === 1 ? Math.min(forgetStability(w, d, s, R), s / Math.exp(w[17] * w[18])) : recallStability(w, d, s, R, g);
    s = Math.min(Math.max(s, 0.001), 36500);
    d = nextDifficulty(w, d, g);
    last = r.at;
  });
  return { s: +s.toFixed(4), d: +d.toFixed(4), last };
}

// ------------------------------------------------------------------ image occlusion field
/** `{{c1::image-occlusion:rect:left=.2:top=.3:width=.1:height=.05:oi=1}}` shapes (Anki 23.10+; older = pixels). */
export function parseOcclusionField(text: string): { n: number; shape: string; x: number; y: number; w: number; h: number; hideAll: boolean }[] {
  const out: { n: number; shape: string; x: number; y: number; w: number; h: number; hideAll: boolean }[] = [];
  for (const m of text.matchAll(/\{\{c(\d+)::image-occlusion:(\w+):([^}]*)\}\}/g)) {
    const props: Record<string, string> = {};
    for (const part of m[3].split(":")) { const i = part.indexOf("="); if (i > 0) props[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    const f = (k: string) => parseFloat(props[k] ?? "");
    let x = f("left"), y = f("top"), w = f("width"), h = f("height");
    if (m[2] === "ellipse") { const rx = f("rx"), ry = f("ry"); if (!isNaN(rx)) w = 2 * rx; if (!isNaN(ry)) h = 2 * ry; }
    if (m[2] === "polygon" && props.points) {
      const pts = props.points.trim().split(/\s+/).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        x = isNaN(x) ? minX : x; y = isNaN(y) ? minY : y;
        w = Math.max(...xs) - minX; h = Math.max(...ys) - minY;
      }
    }
    if (m[2] === "text" || [x, y, w, h].some((v) => isNaN(v))) continue;
    out.push({ n: Number(m[1]), shape: m[2], x, y, w, h, hideAll: props.oi === "1" });
  }
  return out;
}

// ------------------------------------------------------------------ plan
/** Text safe for a flashcards note: `==` would turn into a cloze there, ` :: ` would split a card. */
const safe = (s: string) => s.replace(/==/g, "=\\=");
const oneLine = (s: string) => safe(s).replace(/\s*\n+\s*/g, " ").replace(/\s+::\s+/g, " : ").replace(/^([-*+]|\d+[.)]|#{1,6}|>)\s/, "\\$1 ").trim();
/** Lines of a cloze paragraph: no blank lines, no line that would start its own block. */
const paragraph = (s: string) => safe(s).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^([-*+]|\d+[.)]|#{1,6}|>|\|)(\s|$)/, "\\$1$2")).join("\n");
const FM_CARDS = "---\ntype: flashcards\n---\n";
const keysOf = (block: string) => flashcards(FM_CARDS + block);

export async function ankiPlan(col: AnkiCollection, opts: AnkiOptions, onProgress?: Progress): Promise<ImportPlan> {
  const plan = emptyPlan("anki", col.name);
  plan.warnings.push(...col.warnings);
  const w = opts.w ?? DEFAULT_W;
  const now = opts.now ?? Date.now();
  // media → attachments (only what notes reference)
  const mediaRef = new Map<string, string>();
  let missing = 0;
  const useMedia = opts.media !== false;
  const media = (name: string) => {
    if (!useMedia) return null;
    const get = col.media.get(name);
    if (!get) { missing++; return null; }
    let ref = mediaRef.get(name);
    if (!ref) {
      ref = `m${mediaRef.size}`;
      mediaRef.set(name, ref);
      const a: PlanAttachment = { ref, name, mime: mimeOf(name), size: 0, bytes: get };
      plan.attachments.set(ref, a);
    }
    return ref;
  };
  const md = (html: string) => htmlToMd(html, (name) => { const r = media(name); return r ? attLink(name, r) : null; });

  // cards per note, notes per deck (a note lives in the deck of its first card)
  const cardsByNote = new Map<number, AnkiCard[]>();
  for (const c of col.cards) { const a = cardsByNote.get(c.nid); if (a) a.push(c); else cardsByNote.set(c.nid, [c]); }
  const revByCard = new Map<number, AnkiRev[]>();
  if (opts.keepHistory) for (const r of col.revlog) { if (r.ease < 1 || r.type === 4 || r.type === 5) continue; const a = revByCard.get(r.cid); if (a) a.push(r); else revByCard.set(r.cid, [r]); }

  interface DeckOut { key: string; deck: AnkiDeck; blocks: string[]; tags: Set<string>; cards: number; firstAt: number; seen: Set<string> }
  const out = new Map<string, DeckOut>();
  const counts = { empty: 0, extra: 0, same: 0, legacy: 0, noShapes: 0 };
  let done = 0;
  for (const note of col.notes) {
    if (++done % 400 === 0) { onProgress?.(done, col.notes.length, "notes"); await yieldUI(); }
    const type = col.types.get(note.mid);
    const cs = cardsByNote.get(note.id) ?? [];
    if (!type || !cs.length) continue;
    const deck = col.decks.get(cs[0].did) ?? { id: cs[0].did, name: "Default", filtered: false };
    let d = out.get(deck.id);
    if (!d) { d = { key: "deck:" + deck.id, deck, blocks: [], tags: new Set(), cards: 0, firstAt: note.id, seen: new Set() }; out.set(deck.id, d); }
    for (const t of note.tags) d.tags.add(t.toLowerCase().replace(/::/g, "/").replace(/[^\p{L}\p{N}_/-]+/gu, "-"));
    /** Anki card ord → Lumen card key for this note. */
    const keyByOrd = new Map<number, string>();
    const fieldOf = (re: RegExp, fb = 0) => { const i = type.fields.findIndex((f) => re.test(f)); return note.fields[i >= 0 ? i : fb] ?? ""; };

    if (type.kind === "cloze") {
      const text = paragraph(md(fieldOf(/^text$/i)));
      if (!text) { counts.empty++; continue; }
      const extra = md(fieldOf(/^(back extra|extra)$/i, -1));
      const block = text + (extra ? `\n\n> ${oneLine(extra)}` : "");
      d.blocks.push(block);
      for (const c of keysOf(block)) if (c.cloze) keyByOrd.set(c.cloze.n - 1, c.key);
    } else if (type.kind === "occlusion") {
      const imgHtml = fieldOf(/^image$/i);
      const src = /<img[^>]+src\s*=\s*["']?([^"'>\s]+)/i.exec(imgHtml)?.[1];
      const ref = src ? media(decodeURIComponent(src)) : null;
      const shapes = parseOcclusionField(fieldOf(/^occlusions?$/i));
      const header = oneLine(md(fieldOf(/^header$/i, -1)));
      const extra = oneLine(md(fieldOf(/^(back extra|extra)$/i, -1)));
      if (!ref || !shapes.length) {
        if (useMedia) counts.noShapes++;
        const lines = [header && `**${header}**`, ref ? attLink(src!, ref) : "", extra].filter(Boolean);
        if (lines.length) d.blocks.push(lines.join("\n\n"));
        continue;
      }
      let scale = { w: 1, h: 1 };
      if (shapes.some((s) => s.x > 1.0001 || s.y > 1.0001 || s.w > 1.0001 || s.h > 1.0001)) {
        const size = imageSize(await col.media.get(decodeURIComponent(src!))!());
        if (size) scale = { w: size.w, h: size.h };
      }
      const byN = new Map<number, typeof shapes>();
      for (const s of shapes) { const a = byN.get(s.n); if (a) a.push(s); else byN.set(s.n, [s]); }
      const boxes: OcclusionBox[] = [];
      for (const [n, list] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
        list.forEach((s, i) => {
          const box: OcclusionBox = { id: list.length === 1 ? `c${n}` : `c${n}-${i + 1}`, x: s.x / scale.w, y: s.y / scale.h, w: s.w / scale.w, h: s.h / scale.h, label: `c${n}` };
          if (list.length > 1) box.group = `c${n}`;
          boxes.push(box);
        });
      }
      const o: Occlusion = { id: "oc-" + note.id.toString(36), image: attRef(ref), alt: header || undefined, mode: shapes.some((s) => s.hideAll) ? "hide-all" : "hide-one", boxes };
      const block = (header ? `**${header}**\n\n` : "") + "```occlusion\n" + serializeOcclusion(o) + "\n```" + (extra ? `\n\n${extra}` : "");
      d.blocks.push(block);
      for (const n of byN.keys()) keyByOrd.set(n - 1, `oc-${o.id}-${byN.get(n)!.length === 1 ? `c${n}` : `g.c${n}`}`);
    } else {
      if (type.legacyOcclusion) counts.legacy++;
      const map = opts.mapping[type.id] ?? { front: 0, back: 1, reverse: type.templates.length >= 2 };
      const q = md(note.fields[map.front] ?? "");
      const extra = (map.extra ?? []).map((i) => md(note.fields[i] ?? "")).filter((x) => htmlText(x) || x.includes("att:")).join("\n");
      const a0 = map.back >= 0 ? md(note.fields[map.back] ?? "") : "";
      const a = extra ? `${a0 || "…"}\n***\n${extra}` : a0;
      if (!htmlText(q) && !q.includes("att:")) { counts.empty++; continue; }
      const card = (front: string, back: string) => {
        const ql = oneLine(front);
        const al = safe(back).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).join("\n");
        return !al || !al.includes("\n") ? `${ql} :: ${al || "…"}` : `${ql}\n?\n${al}`;
      };
      const fwd = card(q, a);
      d.blocks.push(fwd);
      const k0 = keysOf(fwd)[0]?.key;
      if (k0) keyByOrd.set(0, k0);
      // "Basic (optional reversed card)" only has a reverse card when Anki made one.
      const wantReverse = map.reverse && !!a && (cs.some((c) => c.ord === 1) || !/optional/i.test(type.name));
      if (wantReverse) {
        const rev = card(a, q);
        d.blocks.push(rev);
        const k1 = keysOf(rev)[0]?.key;
        if (k1) keyByOrd.set(1, k1);
      }
    }
    // schedules + review log
    for (const c of cs) {
      const key = keyByOrd.get(c.ord);
      if (!key) { if (type.kind === "basic" && c.ord > 1) counts.extra++; continue; }
      if (d.seen.has(key)) { counts.same++; continue; }
      d.seen.add(key);
      d.cards++;
      if (!opts.keepHistory) continue;
      const pc = cardState(c, col.crt, revByCard.get(c.id) ?? [], w, now);
      if (pc) plan.cards.push({ ...pc, noteKey: d.key, cardKey: key });
      let prev = 0;
      (revByCard.get(c.id) ?? []).forEach((r, i) => {
        plan.reviews.push({
          noteKey: d!.key, cardKey: key, at: r.id, grade: (Math.min(4, Math.max(1, r.ease)) - 1) as 0 | 1 | 2 | 3,
          state: i === 0 ? "new" : r.type === 0 ? "learning" : r.type === 2 ? "relearning" : "review",
          elapsed: i === 0 ? 0 : +((r.id - prev) / DAY).toFixed(4), scheduled: r.ivl > 0 ? r.ivl : +(-r.ivl / 86400).toFixed(4),
        });
        prev = r.id;
      });
    }
  }
  // deck notes + folders for parent decks (or one note per top-level deck with `##` sections)
  const audioIn = (blocks: string[]) => blocks.reduce((s, b) => s + [...b.matchAll(/\]\(att:@@(m\d+)@@\)/g)].filter((m) => /^audio\//.test(plan.attachments.get(m[1])?.mime ?? "")).length, 0);
  const sorted = [...out.values()].sort((a, b) => a.deck.name.localeCompare(b.deck.name));
  if (opts.perSubdeck === false) {
    const groups = new Map<string, DeckOut[]>();
    for (const d of sorted) { const top = d.deck.name.split("::")[0].trim() || "Default"; groups.set(top, [...(groups.get(top) ?? []), d]); }
    for (const [top, ds] of groups) {
      if (!ds.some((d) => d.blocks.length)) continue;
      const key = "deck:" + ds[0].deck.id;
      const sections = ds.filter((d) => d.blocks.length).map((d) => {
        const sub = d.deck.name.split("::").slice(1).map((p) => p.trim()).filter(Boolean).join(" › ");
        return (sub ? `## ${sub}\n\n` : "") + d.blocks.join("\n\n");
      });
      const tags = [...new Set(ds.flatMap((d) => [...d.tags]))].filter(Boolean).sort();
      const body = toFrontMatter({ type: "flashcards", tags, "anki-deck": top }) + `# ${top}\n\n` + sections.join("\n\n") + "\n";
      for (const d of ds) { for (const c of plan.cards) if (c.noteKey === d.key) c.noteKey = key; for (const r of plan.reviews) if (r.noteKey === d.key) r.noteKey = key; }
      plan.notes.push({ key, folder: [], title: top, type: "flashcards", body, tags, props: { "anki-deck": top }, createdAt: Math.min(...ds.map((d) => d.firstAt)), badge: "deck", cards: ds.reduce((s, d) => s + d.cards, 0), audio: audioIn(ds.flatMap((d) => d.blocks)) });
    }
  } else {
    for (const d of sorted) {
      if (!d.blocks.length) continue;
      const parts = d.deck.name.split("::").map((p) => p.trim()).filter(Boolean);
      const title = parts.pop() || "Default";
      const tags = [...d.tags].filter(Boolean).sort();
      const body = toFrontMatter({ type: "flashcards", tags, "anki-deck": d.deck.name }) + `# ${title}\n\n` + d.blocks.join("\n\n") + "\n";
      const n: PlanNote = { key: d.key, folder: parts, title, type: "flashcards", body, tags, props: { "anki-deck": d.deck.name }, createdAt: d.firstAt, badge: "deck", cards: d.cards, audio: audioIn(d.blocks) };
      plan.notes.push(n);
    }
  }
  if (missing) plan.warnings.push(ANKI_TEXT.missingMedia(missing));
  if (counts.empty) plan.warnings.push(ANKI_TEXT.emptyQuestion(counts.empty));
  if (counts.extra) plan.warnings.push(ANKI_TEXT.extraTemplates(counts.extra));
  if (counts.same) plan.warnings.push(ANKI_TEXT.sameQuestion(counts.same));
  if (counts.legacy) plan.warnings.push(ANKI_TEXT.oldOcclusion(counts.legacy));
  if (counts.noShapes) plan.warnings.push(ANKI_TEXT.noShapes(counts.noShapes));
  // keep only schedules whose card exists in the final note text
  const valid = new Map(plan.notes.map((n) => [n.key, new Set(flashcards(n.body).map((c) => c.key))]));
  plan.cards = plan.cards.filter((c) => valid.get(c.noteKey)?.has(c.cardKey));
  plan.reviews = plan.reviews.filter((r) => valid.get(r.noteKey)?.has(r.cardKey));
  return plan;
}

/** Lumen schedule for one Anki card (null = a new card that needs no record). */
export function cardState(c: AnkiCard, crt: number, revs: AnkiRev[], w: readonly number[], now: number): Omit<PlanCard, "noteKey" | "cardKey"> | null {
  const suspended = c.queue === -1 ? 1 : 0;
  if (c.type === 0) return suspended ? { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0, suspended: 1, state: "new" } : null;
  const dueMs = c.due > 1e9 ? c.due * 1000 : (crt + c.due * 86400) * 1000;
  const state = c.type === 1 ? "learning" : c.type === 3 ? "relearning" : "review";
  let mem: { s: number; d: number; last: number } | null = null;
  const data = (() => { try { return c.data ? (JSON.parse(c.data) as { s?: number; d?: number; lrt?: number }) : {}; } catch { return {}; } })();
  const replay = replayFsrs(revs.map((r) => ({ at: r.id, grade: (Math.min(4, Math.max(1, r.ease)) - 1) as 0 | 1 | 2 | 3 })), w);
  if (data.s && data.d) mem = { s: data.s, d: data.d, last: replay?.last ?? (data.lrt ? data.lrt * 1000 : dueMs - Math.max(1, c.ivl) * DAY) };
  else mem = replay;
  const interval = c.type === 2 ? Math.max(1, c.ivl) : 0;
  return {
    due: dueMs, interval, ease: c.factor ? c.factor / 1000 : 2.5, reps: c.reps, lapses: c.lapses, suspended: suspended as 0 | 1, state,
    ...(mem ? { stability: mem.s, difficulty: Math.min(10, Math.max(1, mem.d)), lastReview: mem.last } : { lastReview: dueMs - interval * DAY }),
  };
}

/** Preview numbers for the Anki step. */
export function ankiSummary(col: AnkiCollection) {
  const deckCards = new Map<string, number>();
  for (const c of col.cards) deckCards.set(c.did, (deckCards.get(c.did) ?? 0) + 1);
  return {
    decks: [...col.decks.values()].filter((d) => deckCards.get(d.id)).map((d) => ({ name: d.name, cards: deckCards.get(d.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name)),
    types: [...col.types.values()].filter((t) => t.notes > 0),
    notes: col.notes.length, cards: col.cards.length, reviews: col.revlog.filter((r) => r.ease > 0).length, media: col.media.size,
  };
}
