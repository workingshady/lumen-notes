// Drop target for the JSON Canvas editor (brief §12.1, "canvas / Board" column). CanvasEditor builds a CanvasDropApi
// from its own state and registers canvasZone(api); everything about what a drop creates lives here.
import type { ReactFlowInstance } from "@xyflow/react";
import type { CanvasEdge, CanvasNode } from "../../../shared/types";
import { addFile } from "../../lib/attachments";
import { canvasFromText, cloneFragment, parseCanvas } from "../../lib/canvas";
import { alignSnap, askDuplicate, describe, DIAGRAM_EXT, fileMd, findDuplicate, layoutLikeGraph, linksAmong, markNest, notesOf, readWithProgress, showChip, videoEmbed, type DndPayload, type Guide, type Probe, type Pt, type Zone } from "../../lib/dnd";
import { t } from "../../lib/i18n";
import { canvasNodeFor, getLibraryItem } from "../../lib/library-items";

export interface CanvasDropApi {
  rf: ReactFlowInstance<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  el: HTMLElement;
  name: string;
  noteId: string;
  grid?: number;
  nodes: () => CanvasNode[];
  /** Add nodes + edges as one history step, select them. */
  add: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;
  update: (id: string, patch: Partial<CanvasNode>) => void;
  undo: () => void;
  pan: (dx: number, dy: number) => void;
}

const sid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const SIZE: Record<string, [number, number]> = { note: [300, 200], text: [260, 120], link: [300, 84], embed: [480, 300], image: [360, 240], audio: [320, 90], pdf: [360, 120] };

function hit(api: CanvasDropApi, pt: Pt): { node: CanvasNode; el: HTMLElement } | null {
  const el = document.elementFromPoint(pt.x, pt.y)?.closest<HTMLElement>(".react-flow__node");
  const id = el?.dataset.id;
  const node = id ? api.nodes().find((n) => n.id === id) : undefined;
  return node && el ? { node, el } : null;
}
const sizeFor = (p: DndPayload): [number, number] => {
  switch (p.kind) {
    case "note": case "notes": case "workspace": case "graph-nodes": return SIZE.note;
    case "diagram": return [560, 380];
    case "text": return [260, Math.min(400, 60 + 19 * Math.ceil(p.text.length / 34))];
    case "url": return videoEmbed(p.url) ? SIZE.embed : SIZE.link;
    case "files": { const f = p.files[0]; return /^image\//.test(f?.type ?? "") ? SIZE.image : /^audio\//.test(f?.type ?? "") ? SIZE.audio : /^video\//.test(f?.type ?? "") ? SIZE.embed : /pdf/.test(f?.type ?? "") ? SIZE.pdf : SIZE.text; }
    case "file": return /^image\//.test(p.mime ?? "") ? SIZE.image : SIZE.pdf;
    case "library-item": { const li = typeof p.item.libId === "string" ? getLibraryItem(p.item.libId) : undefined; if (li) return li.group ? [300, 200] : [150, 60]; const n = p.item.node as Partial<CanvasNode> | undefined; return [n?.width ?? (Number(p.item.width) || 180), n?.height ?? (Number(p.item.height) || 64)]; }
  }
};

export function canvasZone(api: CanvasDropApi): Zone {
  /** Where the dropped item's top-left lands (flow coords) for a pointer position, plus guides. */
  const place = (p: DndPayload, pt: Pt, group?: CanvasNode) => {
    const [w, h] = sizeFor(p);
    const c = api.rf.screenToFlowPosition(pt);
    let x = c.x - w / 2, y = c.y - h / 2;
    const others = api.nodes().filter((n) => n.type !== "group").map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
    const s = alignSnap({ x, y, w, h }, others, { grid: api.grid });
    x = s.x; y = s.y;
    if (group) { x = Math.min(Math.max(x, group.x + 12), group.x + group.width - w - 12); y = Math.min(Math.max(y, group.y + 36), group.y + group.height - h - 12); }
    return { x: Math.round(x), y: Math.round(y), w, h, guides: group ? [] : s.guides };
  };
  const toScreen = (x: number, y: number) => api.rf.flowToScreenPosition({ x, y });
  const guidesOf = (g: ReturnType<typeof place>["guides"]): Guide[] => g.map((l) => {
    if (l.v !== undefined) { const a = toScreen(l.v, l.from), b = toScreen(l.v, l.to); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    const a = toScreen(l.from, l.h!), b = toScreen(l.to, l.h!); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });

  return {
    el: api.el,
    name: t("Canvas {name}", { name: api.name }),
    scroll: (dx, dy) => api.pan(dx, dy),
    probe(p, pt, alt): Probe {
      const h = hit(api, pt);
      const d = describe(p);
      if (h && h.node.type === "group") {
        const g = h.node;
        const pl = place(p, pt, g);
        const s = toScreen(pl.x + pl.w / 2, pl.y + pl.h / 2);
        return { ok: true, nest: h.el, hint: t("Drop into {name}", { name: g.label || t("group") }), snap: s };
      }
      if (h) {
        const n = h.node;
        if (p.kind === "library-item") return { ok: false, nest: null, reason: t("Shapes can’t drop onto a card") };
        if (p.kind === "workspace" && notesOf(p)[0]?.id === api.noteId) return { ok: false, reason: t("A canvas can’t contain itself") };
        const title = n.type === "text" ? t("this card") : n.type === "file" ? n.file.replace(/\.md$/i, "") : t("this card");
        const verb = alt ? t("Add as a card") : p.kind === "text" || (p.kind === "url" && n.type === "text") ? t("Append to {name}", { name: title }) : (p.kind === "note" || p.kind === "notes") && n.type === "text" ? t("+ Link to {name}", { name: title }) : t("Attach to {name}", { name: title });
        return { ok: true, nest: h.el, hint: verb };
      }
      if (p.kind === "note" && notesOf(p)[0]?.id === api.noteId) return { ok: false, reason: t("This note is the canvas itself") };
      const pl = place(p, pt);
      return { ok: true, hint: alt && (p.kind === "note" || p.kind === "notes") ? t("Alt: link instead of card") : d.count > 1 ? d.label : undefined, snap: toScreen(pl.x + pl.w / 2, pl.y + pl.h / 2), guides: guidesOf(pl.guides) };
    },
    async drop(p, pt, alt) {
      markNest(null);
      const h = hit(api, pt);
      const group = h?.node.type === "group" ? h.node : undefined;
      const card = h && !group ? h.node : undefined;
      const pl = place(p, pt, group);
      let nodes: CanvasNode[] = [], edges: CanvasEdge[] = [], label = describe(p).label;

      // ---- onto a card: link / append / attach
      if (card && !alt) {
        const nts = notesOf(p).filter((n) => n.id !== api.noteId);
        const appendTo = (add: string) => { if (card.type === "text") { api.update(card.id, { text: `${card.text.replace(/\s+$/, "")}\n${add}` } as Partial<CanvasNode>); return true; } return false; };
        if ((p.kind === "note" || p.kind === "notes" || p.kind === "graph-nodes") && card.type === "text" && nts.length) {
          appendTo(nts.map((n) => `[[${n.title}]]`).join(" "));
          showChip(t("Linked {name} · Undo", { name: nts.length > 1 ? describe(p).label : nts[0].title }), api.undo);
          return;
        }
        if (p.kind === "text" && appendTo(p.text + (p.from ? `\n— [[${p.from.title}]]` : ""))) { showChip(t("Appended to card · Undo"), api.undo); return; }
        if (p.kind === "url" && appendTo(p.url)) { showChip(t("Added link · Undo"), api.undo); return; }
        // otherwise a new card to the right of the target, joined by an edge
        const built = await build(api, p, { x: card.x + card.width + 80, y: card.y }, false, undefined);
        if (!built) return;
        nodes = built.nodes; edges = [...(built.edges ?? []), ...built.nodes.slice(0, 1).map((n) => ({ id: sid(), fromNode: card.id, toNode: n.id, fromSide: "right" as const, toSide: "left" as const, toEnd: "arrow" as const }))];
        api.add(nodes, edges);
        showChip(t("Attached {name} · Undo", { name: label }), api.undo);
        return;
      }

      const built = await build(api, p, { x: pl.x, y: pl.y }, alt, group);
      if (!built) return;
      nodes = built.nodes; edges = built.edges ?? []; label = built.label ?? label;
      api.add(nodes, edges);
      showChip(nodes.length > 1 ? t("Added {n} cards · Undo", { n: nodes.length }) : t("Added {name} · Undo", { name: label }), api.undo);
    },
  };
}

interface Built { nodes: CanvasNode[]; edges?: CanvasEdge[]; label?: string }

/** Cards (and edges) a payload becomes. `at` is the top-left of the first card in flow coordinates. */
export async function build(api: Pick<CanvasDropApi, "add" | "update" | "noteId" | "nodes" | "undo">, p: DndPayload, at: Pt, alt: boolean, group?: CanvasNode): Promise<Built | null> {
  const mk = (n: Partial<CanvasNode> & { type: CanvasNode["type"] }, x: number, y: number, size: [number, number]): CanvasNode => ({ id: sid(), x, y, width: size[0], height: size[1], ...n }) as CanvasNode;
  const grid = (count: number, size: [number, number]) => {
    const cols = Math.ceil(Math.sqrt(count));
    return (i: number) => ({ x: at.x + (i % cols) * (size[0] + 28), y: at.y + Math.floor(i / cols) * (size[1] + 28) });
  };
  switch (p.kind) {
    case "note": case "notes": case "diagram": case "workspace": {
      const list = notesOf(p).filter((n) => n.id !== api.noteId);
      if (!list.length) return null;
      if (p.kind === "workspace" && alt && list[0].type === "canvas") {
        const c = parseCanvas(list[0].body).canvas;
        if (c.nodes?.length) { const r = cloneFragment(c, { at }); return { nodes: r.canvas.nodes ?? [], edges: r.canvas.edges ?? [], label: t("contents of {name}", { name: list[0].title }) }; }
      }
      if (alt) { const sz = SIZE.text; const pos = grid(list.length, sz); return { nodes: list.map((n, i) => mk({ type: "text", text: `[[${n.title}]]` }, pos(i).x, pos(i).y, [260, 64])), edges: [] }; }
      const sz = p.kind === "diagram" || list[0].type === "diagram" ? ([560, 380] as [number, number]) : SIZE.note;
      const pos = grid(list.length, sz);
      return { nodes: list.map((n, i) => mk({ type: "file", file: n.title }, pos(i).x, pos(i).y, sz)), edges: [], label: list[0].title };
    }
    case "graph-nodes": {
      const list = notesOf(p).filter((n) => n.id !== api.noteId || p.ids.length === 1);
      if (!list.length) return null;
      const sz: [number, number] = [240, 140];
      const ids = list.map((n) => n.id);
      const pos = layoutLikeGraph(ids, p.edges ?? linksAmong(ids), { w: sz[0], h: sz[1] });
      let minX = Infinity, minY = Infinity;
      pos.forEach((q) => { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); });
      const byNote = new Map<string, CanvasNode>();
      for (const n of list) { const q = pos.get(n.id)!; byNote.set(n.id, mk({ type: "file", file: n.title }, Math.round(at.x + q.x - minX), Math.round(at.y + q.y - minY), sz)); }
      const edges: CanvasEdge[] = (p.edges ?? linksAmong(ids)).filter(([a, b]) => byNote.has(a) && byNote.has(b)).map(([a, b]) => ({ id: sid(), fromNode: byNote.get(a)!.id, toNode: byNote.get(b)!.id, toEnd: "arrow" as const }));
      return { nodes: [...byNote.values()], edges, label: t("{n} note|{n} notes", { n: list.length }) };
    }
    case "text": return { nodes: [mk({ type: "text", text: p.from ? `${p.text.trim()}\n\n*${t("from")}* [[${p.from.title}]]` : p.text.trim() }, at.x, at.y, sizeFor(p))] };
    case "url": {
      const emb = videoEmbed(p.url);
      const n = mk({ type: "link", url: p.url }, at.x, at.y, sizeFor(p));
      if (emb) (n as unknown as Record<string, unknown>).lumenEmbed = emb;
      return { nodes: [n], edges: [], label: p.title ?? p.url };
    }
    case "library-item": {
      const li = typeof p.item.libId === "string" ? getLibraryItem(p.item.libId) : undefined;
      if (li) { const [w, h] = sizeFor(p); const n = canvasNodeFor(li, { x: at.x + w / 2, y: at.y + h / 2 }, sid()) as unknown as CanvasNode; return { nodes: [n], label: li.name }; }
      const base = (p.item.node as Partial<CanvasNode> | undefined) ?? { type: "text" as const, text: String(p.item.label ?? p.item.l ?? "") };
      return { nodes: [mk({ ...(base as { type: CanvasNode["type"] }), ...(group ? {} : {}) }, at.x, at.y, sizeFor(p))], edges: [], label: describe(p).label };
    }
    case "file": return { nodes: [mk({ type: "text", text: fileMd(p.name, p.attId, p.mime ?? "") }, at.x, at.y, sizeFor(p))] };
    case "files": return buildFiles(api, p.files, at);
  }
}

/** OS files: placeholder cards with progress first, then the stored attachment. Duplicates ask once. */
async function buildFiles(api: Pick<CanvasDropApi, "add" | "update" | "undo">, files: File[], at: Pt): Promise<Built | null> {
  let i = 0;
  const added: CanvasNode[] = [];
  for (const f of files) {
    const x = at.x + (i % 3) * 40, y = at.y + i * 40;
    i++;
    const id = sid();
    const ph = (text: string) => api.update(id, { text } as Partial<CanvasNode>);
    try {
      const text = f.type.startsWith("text/") || /\.(md|markdown|txt)$/i.test(f.name) ? await f.text() : null;
      if (/\.canvas$/i.test(f.name)) {
        const c = canvasFromText(await f.text());
        if (c?.nodes?.length) { const r = cloneFragment(c, { at: { x, y } }); added.push(...(r.canvas.nodes ?? [])); api.add(r.canvas.nodes ?? [], r.canvas.edges ?? []); showChip(t("Imported {name} · Undo", { name: f.name }), api.undo); continue; }
      }
      if (text !== null && /\.(md|markdown|txt)$/i.test(f.name)) { const n = { id, type: "text", text: text.slice(0, 20000), x, y, width: 320, height: 240 } as CanvasNode; api.add([n], []); added.push(n); continue; }
      if (/\.(mermaid|mmd)$/i.test(f.name)) { const n = { id, type: "text", text: "```mermaid\n" + (await f.text()).trim() + "\n```", x, y, width: 420, height: 280 } as CanvasNode; api.add([n], []); added.push(n); continue; }
      const dupe = await findDuplicate(f);
      let attId: string, mime = f.type, name = f.name;
      const size: [number, number] = /^image\//.test(f.type) ? SIZE.image : /^audio\//.test(f.type) ? SIZE.audio : /^video\//.test(f.type) ? SIZE.embed : SIZE.pdf;
      const node = { id, type: "text", text: `*${f.name}* · 0%`, x, y, width: size[0], height: size[1] } as CanvasNode;
      let useExisting: boolean | null = false;
      if (dupe) useExisting = await askDuplicate(f.name);
      if (useExisting === null) continue;
      api.add([node], []); added.push(node);
      if (dupe && useExisting) { attId = dupe.id; }
      else {
        const body = await readWithProgress(f, (pct) => ph(`*${f.name}* · ${pct}%`));
        ph(`*${f.name}* · ${t("adding…")}`);
        const md = await addFile(body);
        attId = /\(att:([^)]+)\)/.exec(md)![1]; mime = body.type || mime; name = f.name;
      }
      ph(fileMd(name, attId, mime) + (DIAGRAM_EXT.test(name) ? `\n\n*${t("Diagram file attached")}*` : ""));
    } catch (e) { showChip((e as Error).message); }
  }
  if (added.length) showChip(added.length > 1 ? t("Added {n} cards · Undo", { n: added.length }) : t("Added {name} · Undo", { name: files[0].name }), api.undo);
  return null; // already added above (progress cards must exist before the bytes arrive)
}
