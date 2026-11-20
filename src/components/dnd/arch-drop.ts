// Drop target for the Architecture studio (brief §12.1). W2-D mounts it:
//   const api: ArchDropApi = { screenToFlow: rf.screenToFlowPosition, hit, addNode, addLink, appendText, addEdge, undo };
//   useEffect(() => registerZone(archZone(canvasEl.current!, note.title, api)), [...]);   // feedback + drop in one
// or, from an existing onDrop: `await handleArchDrop(readDrop(e.dataTransfer)!, { x: e.clientX, y: e.clientY }, api, e.altKey)`.
import { addFile } from "../../lib/attachments";
import { describe, askDuplicate, findDuplicate, layoutLikeGraph, linksAmong, markNest, notesOf, showChip, videoEmbed, type DndPayload, type Probe, type Pt, type Zone } from "../../lib/dnd";
import { t } from "../../lib/i18n";

export interface ArchDropApi {
  /** React Flow's screenToFlowPosition. */
  screenToFlow: (p: Pt) => Pt;
  /** Node (or group) under a screen point. */
  hit: (p: Pt) => { id: string; label: string; group: boolean; el?: HTMLElement | null } | null;
  /** Create a node at a flow position (relative to `parentId` when nesting); returns its id. */
  addNode: (spec: { label: string; glyph?: string; item?: Record<string, unknown>; links?: string[]; description?: string }, at: Pt, parentId?: string) => string;
  /** Add to the node's Links list (note: `lumen:note/<id>`, URL, attachment: `att:<id>`). */
  addLink: (nodeId: string, link: string) => void;
  /** Append text to the node's description. */
  appendText: (nodeId: string, text: string) => void;
  /** Optional: join two nodes (used for graph-node drops). */
  addEdge?: (from: string, to: string) => void;
  /** Undo the last drop (one history step). */
  undo: () => void;
  /** Pan by screen px while dragging near an edge. */
  pan?: (dx: number, dy: number) => void;
}

const noteLink = (id: string) => `lumen:note/${id}`;

export function probeArchDrop(p: DndPayload, pt: Pt, api: ArchDropApi, alt = false): Probe {
  const h = api.hit(pt);
  if (h?.group) return { ok: true, nest: h.el ?? null, hint: t("Drop into {name}", { name: h.label }) };
  if (h) {
    if (p.kind === "library-item") return { ok: false, nest: null, reason: t("Shapes can’t drop onto a node") };
    if (p.kind === "diagram" || p.kind === "workspace") return alt ? { ok: true, hint: t("Add as a node") } : { ok: true, nest: h.el ?? null, hint: t("+ Link to {name}", { name: h.label }) };
    if (p.kind === "note" || p.kind === "notes" || p.kind === "graph-nodes") return alt ? { ok: true, hint: t("Add as a node") } : { ok: true, nest: h.el ?? null, hint: t("+ Link to {name}", { name: h.label }) };
    if (p.kind === "text") return { ok: true, nest: h.el ?? null, hint: t("Append to {name}", { name: h.label }) };
    if (p.kind === "url") return { ok: true, nest: h.el ?? null, hint: t("+ Add as {name}’s link", { name: h.label }) };
    return { ok: true, nest: h.el ?? null, hint: t("Attach to {name}", { name: h.label }) };
  }
  return { ok: true, hint: describe(p).count > 1 ? describe(p).label : undefined };
}

/** Perform a drop. Returns false when nothing was created. */
export async function handleArchDrop(p: DndPayload, point: Pt, api: ArchDropApi, alt = false): Promise<boolean> {
  markNest(null);
  const h = api.hit(point);
  const at = api.screenToFlow(point);
  const parent = h?.group ? h.id : undefined;
  const target = h && !h.group ? h : null;
  const rel = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });
  const done = (label: string) => showChip(t("Added {name} · Undo", { name: label }), api.undo);

  if (target && !alt) {
    const nts = notesOf(p);
    switch (p.kind) {
      case "library-item": return false;
      case "note": case "notes": case "graph-nodes": case "diagram": case "workspace":
        for (const n of nts) api.addLink(target.id, noteLink(n.id));
        showChip(t("Linked {name} to {node} · Undo", { name: nts.length > 1 ? describe(p).label : nts[0]?.title ?? "", node: target.label }), api.undo);
        return nts.length > 0;
      case "text": api.appendText(target.id, p.text.trim() + (p.from ? `\n— ${p.from.title}` : "")); showChip(t("Appended to {name} · Undo", { name: target.label }), api.undo); return true;
      case "url": api.addLink(target.id, p.url); showChip(t("Added link to {name} · Undo", { name: target.label }), api.undo); return true;
      case "file": api.addLink(target.id, `att:${p.attId}`); showChip(t("Attached {name} · Undo", { name: p.name }), api.undo); return true;
      case "files": {
        for (const f of p.files) {
          const dupe = await findDuplicate(f);
          let use: boolean | null = false;
          if (dupe) use = await askDuplicate(f.name);
          if (use === null) continue;
          const id = dupe && use ? dupe.id : /\(att:([^)]+)\)/.exec(await addFile(f))![1];
          api.addLink(target.id, `att:${id}`);
        }
        showChip(t("Attached to {name} · Undo", { name: target.label }), api.undo);
        return true;
      }
    }
  }

  switch (p.kind) {
    case "library-item": api.addNode({ label: String(p.label ?? p.item.l ?? p.item.label ?? t("Node")), glyph: String(p.item.g ?? p.item.glyph ?? "service"), item: p.item }, rel(at.x, at.y), parent); done(describe(p).label); return true;
    case "note": case "notes": case "diagram": case "workspace": {
      const list = notesOf(p);
      list.forEach((n, i) => api.addNode({ label: n.title, glyph: n.type === "diagram" ? "diagram" : "note-card", links: [noteLink(n.id)] }, rel(at.x + (i % 3) * 190, at.y + Math.floor(i / 3) * 90), parent));
      if (list.length) done(list.length > 1 ? describe(p).label : list[0].title);
      return list.length > 0;
    }
    case "graph-nodes": {
      const list = notesOf(p);
      const pos = layoutLikeGraph(list.map((n) => n.id), p.edges ?? linksAmong(list.map((n) => n.id)), { w: 160, h: 56 });
      let mx = Infinity, my = Infinity; pos.forEach((q) => { mx = Math.min(mx, q.x); my = Math.min(my, q.y); });
      const ids = new Map<string, string>();
      for (const n of list) { const q = pos.get(n.id)!; ids.set(n.id, api.addNode({ label: n.title, glyph: "note-card", links: [noteLink(n.id)] }, rel(at.x + q.x - mx, at.y + q.y - my), parent)); }
      for (const [a, b] of p.edges ?? linksAmong(list.map((n) => n.id))) { const x = ids.get(a), y = ids.get(b); if (x && y) api.addEdge?.(x, y); }
      if (list.length) done(describe(p).label);
      return list.length > 0;
    }
    case "text": api.addNode({ label: p.text.trim().split("\n")[0].slice(0, 40), glyph: "text", description: p.text.trim() + (p.from ? `\n— ${p.from.title}` : ""), links: p.from ? [noteLink(p.from.id)] : undefined }, rel(at.x, at.y), parent); done(t("text")); return true;
    case "url": api.addNode({ label: p.title || p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 32), glyph: videoEmbed(p.url) ? "video" : "link", links: [p.url] }, rel(at.x, at.y), parent); done(p.title ?? p.url); return true;
    case "file": api.addNode({ label: p.name, glyph: "file", links: [`att:${p.attId}`] }, rel(at.x, at.y), parent); done(p.name); return true;
    case "files": {
      let i = 0;
      for (const f of p.files) {
        const dupe = await findDuplicate(f);
        let use: boolean | null = false;
        if (dupe) use = await askDuplicate(f.name);
        if (use === null) continue;
        const id = dupe && use ? dupe.id : /\(att:([^)]+)\)/.exec(await addFile(f))![1];
        api.addNode({ label: f.name, glyph: "file", links: [`att:${id}`] }, rel(at.x + i * 24, at.y + i * 24), parent); i++;
      }
      if (i) done(p.files.length > 1 ? describe(p).label : p.files[0].name);
      return i > 0;
    }
  }
}

/** Feedback + drop zone for the studio's canvas element (mount with registerZone). */
export function archZone(el: HTMLElement, name: string, api: ArchDropApi): Zone {
  return { el, name: t("Architecture {name}", { name }), scroll: api.pan, probe: (p, pt, alt) => probeArchDrop(p, pt, api, alt), drop: (p, pt, alt) => void handleArchDrop(p, pt, api, alt) };
}
