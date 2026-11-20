// Drop target for the whiteboard / Board (Excalidraw). Registered with registerWb("drop", wbDrop): Whiteboard.tsx calls it first
// in its drop handler (wbDrop(event, ctx) returns true when it handled the drop). Position = pointer in scene coordinates
// (zoom + scroll respected). OS photos / GIF / video stay with Whiteboard's own fast path.
import { attBlob } from "../../lib/attachments";
import { alignSnap, askDuplicate, describe, DIAGRAM_EXT, findDuplicate, layoutLikeGraph, linksAmong, markNest, notesOf, readDrop, readWithProgress, showChip, videoEmbed, type DndPayload, type Probe, type Pt, type Zone } from "../../lib/dnd";
import { addFile } from "../../lib/attachments";
import { blobToDataURL, isPhoto } from "../../lib/wb-files";
import { t } from "../../lib/i18n";
import type { WbAPI, WbCtx } from "../wb/hooks";
import { noteCardSkeleton } from "../wb/NoteCard";
import { getLibraryItem, placeOnBoard } from "../../lib/library-items";

type El = Record<string, unknown> & { id: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; type: string; link?: string | null; angle?: number };
const sid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
let bound: { api: WbAPI; el: HTMLElement | null } | null = null;
/** Optional: Whiteboard hands over its API so the drop zone can hit-test elements and auto-scroll. */
export function bindWbApi(api: WbAPI | null, host?: HTMLElement | null) { bound = api ? { api, el: host ?? null } : null; }
/** The bound board API (cards edit their own element through it: lib/convert cards, W3-B). */
export const getBoundApi = (): WbAPI | null => bound?.api ?? null;

function view(api: WbAPI) {
  const a = api.getAppState() as { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft?: number; offsetTop?: number };
  const z = a.zoom?.value ?? 1;
  const toScene = (p: Pt) => ({ x: (p.x - (a.offsetLeft ?? 0)) / z - a.scrollX, y: (p.y - (a.offsetTop ?? 0)) / z - a.scrollY });
  const toScreen = (p: Pt) => ({ x: (p.x + a.scrollX) * z + (a.offsetLeft ?? 0), y: (p.y + a.scrollY) * z + (a.offsetTop ?? 0) });
  return { a, z, toScene, toScreen };
}
function elementAt(api: WbAPI, sc: Pt): El | null {
  const els = api.getSceneElements() as unknown as El[];
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.isDeleted || e.type === "text" && (e as { containerId?: string }).containerId) continue;
    if (e.type === "arrow" || e.type === "line" || e.type === "freedraw") continue;
    if (sc.x >= e.x && sc.x <= e.x + e.width && sc.y >= e.y && sc.y <= e.y + e.height) return e;
  }
  return null;
}
const SIZE = { w: 260, h: 96 };
const sizeOf = (p: DndPayload): [number, number] => (p.kind === "url" && videoEmbed(p.url) ? [480, 300] : p.kind === "text" ? [320, Math.min(300, 50 + 26 * Math.ceil(p.text.length / 30))] : [SIZE.w, SIZE.h]);

type Sk = Record<string, unknown>;
const card = (label: string, link: string | undefined, x: number, y: number, fill: string, extra: Sk = {}): Sk => ({
  type: "rectangle", x, y, width: SIZE.w, height: SIZE.h, backgroundColor: fill, fillStyle: "solid", strokeColor: "#1e1e1e", roughness: 0, roundness: { type: 3 }, ...(link ? { link } : {}),
  label: { text: label, fontSize: 20, fontFamily: 6, strokeColor: "#000000", textAlign: "left", verticalAlign: "middle" }, ...extra,
});

/** Skeletons for a payload placed with its top-left at (x, y) in scene coords. */
async function skeletons(p: DndPayload, x: number, y: number, kind: "whiteboard" | "board", noteId: string, api: WbAPI): Promise<{ sk: Sk[]; files?: unknown[]; label: string } | null> {
  const fill = kind === "board" ? "#d0ebff" : "#fff3bf";
  switch (p.kind) {
    case "note": case "notes": case "diagram": case "workspace": {
      const list = notesOf(p).filter((n) => n.id !== noteId);
      if (!list.length) return null;
      const cols = Math.ceil(Math.sqrt(list.length));
      return { sk: list.map((n, i) => { const px = x + (i % cols) * (SIZE.w + 24), py = y + Math.floor(i / cols) * (SIZE.h + 24); return kind === "board" ? noteCardSkeleton(n, px, py) as Sk : card(n.title, `lumen:note/${n.id}`, px, py, fill, { customData: { lumenNote: n.id } }); }), label: list[0].title };
    }
    case "graph-nodes": {
      const list = notesOf(p);
      if (!list.length) return null;
      const ids = list.map((n) => n.id);
      const pos = layoutLikeGraph(ids, p.edges ?? linksAmong(ids), { w: SIZE.w, h: SIZE.h });
      let mx = Infinity, my = Infinity; pos.forEach((q) => { mx = Math.min(mx, q.x); my = Math.min(my, q.y); });
      const eid = new Map(ids.map((i) => [i, sid()]));
      const cards = list.map((n) => { const q = pos.get(n.id)!; const c = kind === "board" ? noteCardSkeleton(n, x + q.x - mx, y + q.y - my) as Sk : card(n.title, `lumen:note/${n.id}`, x + q.x - mx, y + q.y - my, fill, { customData: { lumenNote: n.id } }); return { ...c, id: eid.get(n.id)! }; });
      const arrows: Sk[] = (p.edges ?? linksAmong(ids)).filter(([a, b]) => eid.has(a) && eid.has(b)).map(([a, b]) => ({ type: "arrow", x, y, start: { id: eid.get(a) }, end: { id: eid.get(b) }, strokeColor: "#1e1e1e", roughness: 0 }));
      return { sk: kind === "board" ? [...cards, ...arrows] : [...cards, ...arrows], label: t("{n} note|{n} notes", { n: list.length }) };
    }
    case "text": {
      const [w] = sizeOf(p);
      const sk: Sk[] = [{ type: "text", x, y, text: p.text.trim(), fontSize: 20, fontFamily: 6, width: w, ...(p.from ? { link: `lumen:note/${p.from.id}`, customData: { lumenSource: p.from.id } } : {}) }];
      if (p.from) sk.push({ type: "rectangle", x, y: y + 12 + 26 * Math.ceil(p.text.length / 30), width: 200, height: 28, backgroundColor: "#e9ecef", fillStyle: "solid", strokeColor: "#868e96", roughness: 0, roundness: { type: 3 }, link: `lumen:note/${p.from.id}`, label: { text: `${t("from")} ${p.from.title}`, fontSize: 14, fontFamily: 6, strokeColor: "#495057" } });
      return { sk, label: t("text") };
    }
    case "url": {
      const emb = videoEmbed(p.url);
      if (emb) return { sk: [{ type: "embeddable", x, y, width: 480, height: 300, link: p.url }], label: p.title ?? p.url };
      return { sk: [card(p.title || p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), p.url, x, y, "#e7f5ff")], label: p.title ?? p.url };
    }
    case "library-item": {
      const s = (p.item.skeleton ?? p.item.sk) as Sk | Sk[] | undefined;
      const arr = (s ? (Array.isArray(s) ? s : [s]) : [card(String(p.item.label ?? p.item.l ?? t("Shape")), undefined, x, y, "transparent")]) as Sk[];
      const ox = Math.min(...arr.map((e) => Number(e.x ?? 0))), oy = Math.min(...arr.map((e) => Number(e.y ?? 0)));
      return { sk: arr.map((e) => ({ ...e, x: x + Number(e.x ?? 0) - ox, y: y + Number(e.y ?? 0) - oy })), label: describe(p).label };
    }
    case "file": case "files": {
      const files = p.kind === "files" ? p.files : [];
      const out: Sk[] = [], fl: unknown[] = [];
      let i = 0;
      const items: { name: string; attId?: string; mime: string; file?: File }[] = p.kind === "file" ? [{ name: p.name, attId: p.attId, mime: p.mime ?? "" }] : files.map((f) => ({ name: f.name, mime: f.type, file: f }));
      for (const it of items) {
        const px = x + i * 24, py = y + i * 24; i++;
        let attId = it.attId, f = it.file;
        if (f) {
          const dupe = await findDuplicate(f);
          let use: boolean | null = false;
          if (dupe) use = await askDuplicate(f.name);
          if (use === null) continue;
          if (dupe && use) attId = dupe.id;
          else { f = await readWithProgress(f, (pct) => showChip(`${f!.name} · ${pct}%`, undefined, 1200)); attId = /\(att:([^)]+)\)/.exec(await addFile(f))![1]; }
        }
        const blob = attId ? await attBlob(attId) : null;
        if (blob && isPhoto(it.mime || blob.type)) {
          const fid = sid();
          const url = await blobToDataURL(blob);
          const bmp = await createImageBitmap(blob).catch(() => null);
          const w = Math.min(420, bmp?.width ?? 320), h = bmp ? Math.round((w / bmp.width) * bmp.height) : 240;
          fl.push({ id: fid, mimeType: blob.type, dataURL: url, created: Date.now(), lumenAtt: attId });
          out.push({ type: "image", fileId: fid, status: "saved", x: px, y: py, width: w, height: h });
        } else out.push(card(`${it.name}${DIAGRAM_EXT.test(it.name) ? " · " + t("Import") : ""}`, undefined, px, py, "#f1f3f5", { customData: { lumenAtt: attId } }));
      }
      return out.length ? { sk: out, files: fl, label: items[0]?.name ?? "" } : null;
    }
  }
  void api;
}

/** Add skeletons to the board as one step: selected afterwards, with an Undo chip. */
async function addToBoard(ctx: WbCtx, sk: Sk[], files: unknown[] | undefined, label: string) {
  const api = ctx.api!;
  const { convertSkeleton } = await import("../../lib/convert/bind"); // live cards (embeddables) and arrows bound to them
  const els = (await convertSkeleton(sk as never, { regenerateIds: false })) as unknown as El[];
  if (files?.length) api.addFiles(files);
  const sel: Record<string, true> = {};
  els.forEach((e) => { if (!(e.type === "text" && (e as { containerId?: string }).containerId)) sel[e.id] = true; });
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: sel } });
  ctx.save();
  const ids = new Set(els.map((e) => e.id));
  showChip(els.filter((e) => !(e as { containerId?: string }).containerId).length > 1 && sk.length > 1 ? t("Added {n} items · Undo", { n: sk.length }) : t("Added {name} · Undo", { name: label }), () => {
    api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (ids.has(e.id as string) ? { ...e, isDeleted: true } : e)) });
    ctx.save();
  });
}

/** Drop handler for the whiteboard (W2-A calls it first). true = handled (the caller must not run its own handling). */
export async function dropOnWhiteboard(p: DndPayload, point: Pt, alt: boolean, ctx: WbCtx): Promise<boolean> {
  const api = ctx.api;
  if (!api) return false;
  const v = view(api);
  const sc = v.toScene(point);
  const hitEl = elementAt(api, sc);
  // onto an element: link it (note / URL)
  if (hitEl && !alt && (p.kind === "note" || p.kind === "url") && hitEl.type !== "frame") {
    const link = p.kind === "note" ? `lumen:note/${p.id}` : p.url;
    const before = hitEl.link ?? null;
    api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === hitEl.id ? { ...e, link } : e)) });
    ctx.save();
    showChip(t("Linked · Undo"), () => { api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === hitEl.id ? { ...e, link: before } : e)) }); ctx.save(); });
    return true;
  }
  if (p.kind === "library-item" && typeof p.item.libId === "string") {
    const it = getLibraryItem(p.item.libId);
    if (!it) return false;
    const ids = await placeOnBoard(api, it, { at: sc });
    ctx.save();
    const set = new Set(ids);
    showChip(t("Added {name} · Undo", { name: it.name }), () => { api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (set.has(e.id as string) ? { ...e, isDeleted: true } : e)) }); ctx.save(); });
    return true;
  }
  const [w, h] = sizeOf(p);
  const others = (api.getSceneElements() as unknown as El[]).filter((e) => !e.isDeleted).slice(-200).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }));
  const sn = alignSnap({ x: sc.x - w / 2, y: sc.y - h / 2, w, h }, others, { grid: 0 });
  const r = await skeletons(p, Math.round(sn.x), Math.round(sn.y), ctx.kind, ctx.noteId, api);
  if (!r) return false;
  let sk = r.sk;
  if (alt && (p.kind === "note" || p.kind === "notes")) sk = sk.map((s) => (s.type === "rectangle" ? { ...s, backgroundColor: "transparent", strokeStyle: "dashed" } : s)); // Alt on a whiteboard: a plain link, not a card
  await addToBoard(ctx, sk, r.files, r.label);
  return true;
}

/** The function registered for registerWb("drop"): reads the DataTransfer of a React/DOM drop event. */
export function wbDrop(e: { dataTransfer: DataTransfer | null; clientX: number; clientY: number; altKey: boolean; preventDefault(): void; stopPropagation(): void; nativeEvent?: Event }, ctx: WbCtx): boolean {
  const done = handled.has((e.nativeEvent ?? e) as object);
  if (done) return true;
  const dt = e.dataTransfer;
  if (!dt) return false;
  const p = readDrop(dt);
  if (!p) return false;
  // OS photos / GIF / video / audio: Whiteboard's own fast path. Other files, text, URLs and Lumen payloads are ours.
  if (p.kind === "files" && p.files.every((f) => isPhoto(f.type) || /^(video|audio)\//.test(f.type) || f.type === "image/gif")) return false;
  e.preventDefault(); e.stopPropagation();
  handled.add((e.nativeEvent ?? e) as object);
  markNest(null);
  void dropOnWhiteboard(p, { x: e.clientX, y: e.clientY }, e.altKey, ctx);
  return true;
}
const handled = new WeakSet<object>();

/** Whiteboard feedback zone (matched by `.lumen-wb`): ghost, "not allowed" over frames' locked layers is up to W3, auto-scroll when bound. */
export const whiteboardZone: Zone = {
  el: document.body,
  name: t("Whiteboard"),
  external: true,
  match: (el) => !!el.closest(".lumen-wb"),
  host: () => document.querySelector<HTMLElement>(".lumen-wb"),
  probe(p, pt, alt): Probe {
    let hint: string | undefined;
    if (bound && (p.kind === "note" || p.kind === "url")) { const el = elementAt(bound.api, view(bound.api).toScene(pt)); if (el && !alt) hint = t("+ Link to this shape"); }
    else if (p.kind === "notes" || p.kind === "graph-nodes") hint = describe(p).label;
    return { ok: true, hint };
  },
  async drop() { /* the drop itself arrives through registerWb("drop") */ },
  scroll(dx, dy) {
    if (!bound) return;
    const a = bound.api.getAppState() as { scrollX: number; scrollY: number; zoom: { value: number } };
    bound.api.updateScene({ appState: { scrollX: a.scrollX + dx / a.zoom.value, scrollY: a.scrollY + dy / a.zoom.value } });
  },
};

/** "Send to…" a whiteboard / Board note that isn't open: appends the converted elements to its .excalidraw body. */
export async function sendToWhiteboardNote(p: DndPayload, body: string, kind: "whiteboard" | "board", noteId: string): Promise<{ body: string; label: string } | null> {
  let doc: { elements?: El[]; files?: Record<string, unknown> } & Record<string, unknown>;
  try { doc = JSON.parse(body || "{}"); } catch { return null; }
  const els = (doc.elements ?? []).filter((e) => !e.isDeleted);
  const x = els.length ? Math.max(...els.map((e) => e.x + e.width)) + 60 : 0;
  const y = els.length ? Math.min(...els.map((e) => e.y)) : 0;
  const r = await skeletons(p, x, y, kind, noteId, null as unknown as WbAPI);
  if (!r) return null;
  const { convertSkeleton } = await import("../../lib/convert/bind");
  const added = (await convertSkeleton(r.sk as never, { regenerateIds: false })) as unknown as El[];
  const files = { ...(doc.files ?? {}) };
  for (const f of (r.files ?? []) as { id: string; mimeType: string; created: number; lumenAtt?: string }[]) files[f.id] = { id: f.id, mimeType: f.mimeType, created: f.created, lumenAtt: f.lumenAtt };
  return { body: JSON.stringify({ ...doc, elements: [...(doc.elements ?? []), ...added], files }), label: r.label };
}
