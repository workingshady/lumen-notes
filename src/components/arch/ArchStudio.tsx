// Architecture & diagram studio (frames 46C–46Q, 47, 48A–B, 48G–I), ported from ArchStudio.dc.html.
// Library · canvas · code (Code · Mermaid · JSON). The note's JSON Canvas body is the single source of truth: typing in
// any tab parses and writes back to it (debounced, last valid state wins); dragging, renaming or connecting on the board
// rewrites the code. Positions live only in the JSON; only new nodes get placed.
import { Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type NodeChange, type OnConnectEnd } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note, Version } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { ShareSheet } from "../ShareSheet";
import { useSaving, useSyncLook } from "../ws-sync";
import { restoreVersion, snapshot, updateNote } from "../../lib/actions";
import { fmtDate, fmtTime, t, useLang } from "../../lib/i18n";
import { back, openNote, toast, useVault } from "../../lib/store";
import { openExport } from "../../lib/diagram-export";
import { uid } from "../../lib/db";
import { applyDsl, dslFor, parseDsl, printDsl, type DslError } from "../../lib/arch-dsl";
import {
  childrenMap, depthOf, descendants, diffArch, displayOf, EDGE_STYLE, fitGroups, hiddenBy, isGroup, kindOfIcon, nameOf, parentOf, parseArch, setParent, stringifyArch,
  type AEdge, type ANode, type ArchCanvas, type ArchDiff, type Split,
} from "../../lib/arch-model";
import { defaultFlavor, detectPaste, MERMAID_FLAVORS, PASTE_LABEL, slug, toDsl, toMermaid, type MermaidFlavor, type PasteKind } from "../../lib/arch-convert";
import { edgeRoute, archSvg } from "../../lib/arch-render";
import { archVersions, c4Chain, C4_LABEL, ensureRef, listObjects, propagate, usedIn, zoomInto, type ModelObject } from "../../lib/arch-objects";
import type { LayoutOpts } from "../../lib/arch-layout";
import { ArchCode } from "./ArchCode";
import { Ctx, edgeTypes, FLOW_CSS, nodeTypes, type FlowCtx, type FlowEdge, type FlowNode } from "./ArchFlow";
import { EdgeProps, GroupProps, Library, MIME, NodeProps, type Shape } from "./ArchPanels";
import { AC, Block, Btn, Pop } from "./ArchUi";
import { archAiReview } from "./ai-hooks";

type Tab = "Code" | "Mermaid" | "JSON";
type Sel = { kind: "node" | "edge"; id: string } | null;
type PopKind = null | "layout" | "insert" | "versions" | "library" | "menu" | "more" | "props" | "connectTo" | "moveTo" | "sendTo";
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 640); useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
const typing = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, .cm-editor, [contenteditable=true]");

export default function ArchStudio({ note }: { note: Note }) {
  return <ReactFlowProvider><Studio note={note} /></ReactFlowProvider>;
}

function Studio({ note }: { note: Note }) {
  useLang();
  const v = useVault();
  const phone = usePhone();
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const [c, setC] = useState<ArchCanvas>(() => parseArch(note.body)!);
  const cRef = useRef(c); cRef.current = c;
  const [code, setCode] = useState(() => dslFor(c));
  const [errors, setErrors] = useState<DslError[]>([]);
  const prevLines = useRef(parseDsl(code, c.lumenArch.kind).doc.lineOf);
  const [tab, setTab] = useState<Tab>("Code");
  const [flavor, setFlavor] = useState<MermaidFlavor>(defaultFlavor(c.lumenArch.kind));
  const [mmEdit, setMmEdit] = useState<string | null>(null), [mmErr, setMmErr] = useState<string | null>(null);
  const [jsEdit, setJsEdit] = useState<string | null>(null), [jsErr, setJsErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null), [hoverLine, setHoverLine] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pop, setPop] = useState<PopKind>(null);
  const [paste, setPaste] = useState<{ kind: PasteKind; text: string; before: string } | null>(null);
  const [lopts, setLopts] = useState<LayoutOpts>({ direction: c.lumenArch.direction, spacing: "roomy", keep: true, scope: "all" });
  const [preview, setPreview] = useState<ArchCanvas | null>(null);
  const [diff, setDiff] = useState<{ older: ArchCanvas; label: string; v: Version; n: number } | null>(null);
  const [present, setPresent] = useState<number | null>(null);
  const [share, setShare] = useState(false);
  const [phoneCode, setPhoneCode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const split: Split = c.lumenArch.split ?? "50";
  const kind = c.lumenArch.kind;

  // ------------------------------------------------------------ save + history
  const lastSaved = useRef(note.body);
  const saveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const undoS = useRef<string[]>([]), redoS = useRef<string[]>([]);
  const save = useCallback((next: ArchCanvas) => {
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { const body = stringifyArch(next); if (body === lastSaved.current) return; lastSaved.current = body; void updateNote(note.id, { body }); }, 300);
  }, [note.id]);
  useEffect(() => () => { clearTimeout(saveT.current); const body = stringifyArch(cRef.current); if (body !== lastSaved.current) void updateNote(note.id, { body }); }, [note.id]);
  const setFromCanvas = (next: ArchCanvas) => { const dsl = printDsl(next, next.lumenArch.dsl); next = { ...next, lumenArch: { ...next.lumenArch, dsl } }; setCode(dsl); setErrors([]); prevLines.current = parseDsl(dsl, next.lumenArch.kind).doc.lineOf; return next; };
  /** One step: canvas edits rewrite the code; code edits keep the typed text. */
  const commit = useCallback((next: ArchCanvas, src: "code" | "canvas" = "canvas", hist = true) => {
    if (src !== "code") next = setFromCanvas(next);
    if (hist) { undoS.current.push(stringifyArch(cRef.current)); if (undoS.current.length > 100) undoS.current.shift(); redoS.current = []; }
    cRef.current = next; setC(next); setMmEdit(null); setJsEdit(null); save(next);
    return next;
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = (body: string) => { const p = parseArch(body); if (!p) return; const n = setFromCanvas(p); n.lumenArch.dsl = p.lumenArch.dsl ?? n.lumenArch.dsl; setCode(dslFor(p)); cRef.current = p; setC(p); save(p); };
  const undo = () => { const b = undoS.current.pop(); if (!b) return; redoS.current.push(stringifyArch(cRef.current)); restore(b); };
  const redo = () => { const b = redoS.current.pop(); if (!b) return; undoS.current.push(stringifyArch(cRef.current)); restore(b); };
  // changes from elsewhere (sync, restore, another tab)
  useEffect(() => {
    if (note.body === lastSaved.current || note.body === stringifyArch(cRef.current)) return;
    const p = parseArch(note.body);
    if (!p) return;
    lastSaved.current = note.body; cRef.current = p; setC(p); setCode(dslFor(p)); setErrors([]);
  }, [note.body]);

  // ------------------------------------------------------------ code → canvas (debounced, last valid wins)
  const codeT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCode = (text: string) => {
    setCode(text);
    if (paste) return;
    clearTimeout(codeT.current);
    codeT.current = setTimeout(() => {
      const { doc, errors: errs } = parseDsl(text, cRef.current.lumenArch.kind);
      setErrors(errs);
      if (errs.length) return;
      const next = applyDsl(cRef.current, doc, text, prevLines.current);
      prevLines.current = doc.lineOf;
      commit(next, "code");
    }, 250);
  };
  const onPaste = (text: string) => {
    const k = detectPaste(text);
    if (!k || tab !== "Code") return false;
    setPaste({ kind: k, text, before: code });
    clearTimeout(codeT.current);
    return false; // the text goes in; the bar asks before converting
  };
  const convertPaste = () => {
    if (!paste) return;
    const r = toDsl(paste.text, paste.kind);
    const base = r.archKind && r.archKind !== kind ? { ...cRef.current, lumenArch: { ...cRef.current.lumenArch, kind: r.archKind } } : cRef.current;
    const { doc, errors: errs } = parseDsl(r.dsl, base.lumenArch.kind);
    setPaste(null);
    if (errs.length) { setCode(r.dsl); setErrors(errs); return; }
    // a fresh diagram from the paste: drop the old nodes, place everything, then lay out
    const next = applyDsl({ ...base, nodes: [], edges: [] }, doc, r.dsl);
    prevLines.current = doc.lineOf;
    setCode(r.dsl); setErrors([]);
    commit(next, "code");
    void runLayout({ ...lopts, keep: false, scope: "all" }, next, true);
    toast(t("Converted to a Lumen diagram"), { label: t("Undo"), run: undo }, { icon: "check" });
  };
  const keepPaste = () => { setPaste(null); onCode(code); };

  // ------------------------------------------------------------ Mermaid / JSON tabs write back too
  const mmText = mmEdit ?? toMermaid(c, flavor);
  const mmT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onMermaid = (text: string) => {
    setMmEdit(text);
    clearTimeout(mmT.current);
    mmT.current = setTimeout(() => {
      const k = detectPaste(text);
      if (!k || !k.startsWith("mermaid")) { setMmErr(t("Start with a Mermaid header: architecture-beta, flowchart, erDiagram, C4… or sequenceDiagram.")); return; }
      const cur = cRef.current;
      const known = new Map(cur.nodes.map((n) => [slug(nameOf(n)), nameOf(n)]));
      const { dsl } = toDsl(text, k, known);
      const { doc, errors: errs } = parseDsl(dsl, cur.lumenArch.kind);
      if (errs.length) { setMmErr(errs[0].message); return; }
      // Mermaid can't carry tech / status / edge kinds: keep them from the diagram
      const byName = new Map(cur.nodes.map((n) => [nameOf(n), n]));
      for (const d of doc.nodes) {
        const o = byName.get(d.name); if (!o) continue;
        const ln = o.lumenNode;
        if (ln?.tech && !d.attrs.tech) d.attrs.tech = ln.tech;
        if (ln?.status && !d.attrs.status) d.attrs.status = ln.status;
        if (ln?.icon && (!d.attrs.icon || d.attrs.icon === "service" || d.attrs.icon === "server" || d.attrs.icon === "process")) d.attrs.icon = ln.icon;
        if (o.type === "group" && o.lumenGroup) { d.attrs.icon = d.attrs.icon && d.attrs.icon !== "region" ? d.attrs.icon : o.lumenGroup.icon ?? o.lumenGroup.kind; if (o.lumenGroup.sub) d.attrs.label = o.lumenGroup.sub; }
        else if (o.type === "text" && o.text !== d.name && !d.attrs.label) d.attrs.label = o.text;
      }
      const ids = new Map(cur.nodes.map((n) => [nameOf(n), n.id]));
      for (const d of doc.edges) { const o = cur.edges.find((e) => e.fromNode === ids.get(d.from) && e.toNode === ids.get(d.to)); if (o) { d.style ??= o.lumenEdge?.style; d.label ??= o.label; } }
      setMmErr(null);
      const next = applyDsl(cur, doc, printDsl(cur, cur.lumenArch.dsl), prevLines.current);
      const n2 = commit(next);
      setMmEdit(text); void n2;
    }, 400);
  };
  const jsText = jsEdit ?? stringifyArch(c);
  const jsT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onJson = (text: string) => {
    setJsEdit(text);
    clearTimeout(jsT.current);
    jsT.current = setTimeout(() => {
      let p: ArchCanvas | null = null;
      try { JSON.parse(text); p = parseArch(text); } catch (e) { setJsErr(`JSON: ${(e as Error).message}`); return; }
      if (!p) { setJsErr(t("Keep the \"lumenArch\" block: it makes this canvas an architecture diagram.")); return; }
      const ids = new Set(p.nodes.map((n) => n.id));
      const bad = p.nodes.find((n) => typeof n.id !== "string" || typeof n.x !== "number" || typeof n.y !== "number") ?? p.edges.find((e) => !ids.has(e.fromNode) || !ids.has(e.toNode));
      if (bad) { setJsErr(t("Invalid node or edge: {id}", { id: (bad as { id?: string }).id ?? "?" })); return; }
      setJsErr(null);
      commit(p); setJsEdit(text);
    }, 400);
  };

  // ------------------------------------------------------------ derived
  const doc = useMemo(() => parseDsl(code, kind).doc, [code, kind]);
  const idByName = useMemo(() => new Map(c.nodes.map((n) => [nameOf(n), n.id])), [c.nodes]);
  const lineOfId = useMemo(() => { const m = new Map<string, number>(); for (const [nm, ln] of doc.lineOf) { const id = idByName.get(nm); if (id) m.set(id, ln); } return m; }, [doc, idByName]);
  const nodeAtLine = useMemo(() => { const m = new Map<number, string>(); for (const [id, ln] of lineOfId) m.set(ln, id); return m; }, [lineOfId]);
  const hl = hoverNode ?? (hoverLine ? nodeAtLine.get(hoverLine) ?? null : null);
  const band = hoverLine && nodeAtLine.has(hoverLine) ? hoverLine : (hoverNode ? lineOfId.get(hoverNode) ?? null : sel?.kind === "node" ? lineOfId.get(sel.id) ?? null : null);
  const usage = useMemo(() => { const m = new Map<string, number>(); for (const n of c.nodes) { const r = n.lumenNode?.ref; if (r && !m.has(r)) m.set(r, usedIn(v.notes, r)); } return m; }, [c.nodes, v.notes]);
  const vd: ArchDiff | null = useMemo(() => (diff ? diffArch(diff.older, c) : null), [diff, c]);
  const view: ArchCanvas = useMemo(() => (vd ? { ...c, nodes: [...c.nodes, ...vd.ghostNodes], edges: [...c.edges, ...vd.ghostEdges] } : c), [c, vd]);

  const flowNodes: FlowNode[] = useMemo(() => {
    const shown = view.nodes.filter((n) => !hiddenBy(view, n.id));
    const order = [...shown].sort((a, b) => (isGroup(a) === isGroup(b) ? depthOf(view, a.id) - depthOf(view, b.id) : isGroup(a) ? -1 : 1));
    const out: FlowNode[] = order.map((n) => {
      const ref = n.lumenNode?.ref, u = ref ? usage.get(ref) ?? 0 : 0;
      const chip = u > 1 ? t("Used in {n} diagram|Used in {n} diagrams", { n: u }) : [n.lumenNode?.cost, n.lumenNode?.sla].filter(Boolean).join(" · ") || undefined;
      const mark = vd?.nodes.get(n.id);
      return {
        id: n.id, type: isGroup(n) ? "archGroup" : "arch", position: { x: n.x, y: n.y }, width: n.width, height: n.height, style: { width: n.width, height: n.height },
        data: { n, mark, chip }, selected: sel?.kind === "node" && sel.id === n.id, draggable: !diff && present === null, selectable: mark !== "del", zIndex: isGroup(n) && !n.lumenGroup?.collapsed ? depthOf(view, n.id) : 1000,
      };
    });
    if (preview) for (const n of preview.nodes) if (!isGroup(n) && !hiddenBy(preview, n.id)) out.push({ id: `lp-${n.id}`, type: "archGhost", position: { x: n.x, y: n.y }, width: n.width, height: n.height, style: { width: n.width, height: n.height }, data: { n, ghost: true }, draggable: false, selectable: false, zIndex: 2000 });
    return out;
  }, [view, vd, usage, sel, preview, diff, present]);
  const flowEdges: FlowEdge[] = useMemo(() => {
    const by = new Map(view.nodes.map((n) => [n.id, n]));
    return view.edges.flatMap((e) => {
      const r = edgeRoute(view, e, by);
      if (!r) return [];
      return [{ id: e.id, source: r.from, target: r.to, sourceHandle: "right", targetHandle: "left", type: "arch", data: { e, r, mark: vd?.edges.get(e.id) }, selected: sel?.kind === "edge" && sel.id === e.id, zIndex: 1500 } as FlowEdge];
    });
  }, [view, vd, sel]);

  // ------------------------------------------------------------ board edits
  const dragStart = useRef<Map<string, { x: number; y: number }> | null>(null);
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const moves = changes.filter((ch): ch is Extract<NodeChange<FlowNode>, { type: "position" }> => ch.type === "position" && !!ch.position);
    if (!moves.length) return;
    setC((prev) => {
      const pos = new Map(prev.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      for (const m of moves) {
        const n = prev.nodes.find((x) => x.id === m.id);
        if (!n) continue;
        const dx = m.position!.x - n.x, dy = m.position!.y - n.y;
        pos.set(n.id, { x: m.position!.x, y: m.position!.y });
        if (isGroup(n)) for (const d of descendants(prev, n.id)) { const p = pos.get(d)!; const o = prev.nodes.find((x) => x.id === d)!; if (!moves.some((mm) => mm.id === d)) pos.set(d, { x: o.x + dx, y: o.y + dy }); void p; }
      }
      const next = { ...prev, nodes: prev.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) };
      cRef.current = next;
      return next;
    });
  }, []);
  const deepestGroupAt = (cv: ArchCanvas, x: number, y: number, exclude: Set<string>) => {
    let best: ANode | null = null, bd = -1;
    for (const g of cv.nodes) {
      if (!isGroup(g) || g.lumenGroup?.collapsed || exclude.has(g.id) || hiddenBy(cv, g.id)) continue;
      if (x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height) { const d = depthOf(cv, g.id); if (d > bd) { bd = d; best = g; } }
    }
    return best;
  };
  const onDragStop = (_: unknown, __: unknown, nodes: FlowNode[]) => {
    let cur = cRef.current;
    for (const fn of nodes) {
      const n = cur.nodes.find((x) => x.id === fn.id);
      if (!n) continue;
      const ex = new Set([n.id, ...descendants(cur, n.id)]);
      const g = deepestGroupAt(cur, n.x + n.width / 2, n.y + n.height / 2, ex);
      if ((g?.id ?? undefined) !== parentOf(n)) cur = { ...cur, nodes: cur.nodes.map((x) => (x.id === n.id ? setParent(x, g?.id) : x)) };
    }
    const before = dragStart.current;
    dragStart.current = null;
    const nextC = fitGroups(cur);
    // history: the step starts from the pre-drag positions
    if (before) { const pre = { ...cRef.current, nodes: cRef.current.nodes.map((n) => ({ ...n, ...(before.get(n.id) ?? {}) })) }; undoS.current.push(stringifyArch(pre)); redoS.current = []; }
    commit(nextC, "canvas", false);
  };
  const uniqueName = (base: string, cv = cRef.current) => { const names = new Set(cv.nodes.map(nameOf)); let nm = base, k = 2; while (names.has(nm)) nm = `${base} ${k++}`; return nm; };
  const addShape = (s: Shape, at?: { x: number; y: number }, connect?: { from: string; side?: string }) => {
    const cur = cRef.current;
    const p = at ?? (() => { const r = canvasEl.current?.getBoundingClientRect(); return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 }; })();
    const parent = deepestGroupAt(cur, p.x, p.y, new Set());
    const id = `n-${uid().slice(0, 8)}`;
    const name = uniqueName(s.l);
    const n: ANode = s.group
      ? { id, type: "group", x: p.x - 150, y: p.y - 100, width: 300, height: 200, label: name, lumenGroup: { kind: s.g, name, ...(parent ? { parent: parent.id } : {}) } } as ANode
      : { id, type: "text", text: name, x: p.x - 75, y: p.y - 30, width: 150, height: 60, lumenNode: { name, icon: s.g, kind: kindOfIcon(s.g), ...(parent ? { parent: parent.id } : {}) } } as ANode;
    if (s.g === "junction" && !s.group) Object.assign(n, { width: 12, height: 12, x: p.x - 6, y: p.y - 6 });
    const edges = connect ? [...cur.edges, { id: `e-${uid().slice(0, 8)}`, fromNode: connect.from, toNode: id, lumenEdge: { style: "sync" as const } }] : cur.edges;
    commit(fitGroups({ ...cur, nodes: [...cur.nodes, n], edges }));
    setSel({ kind: "node", id });
    return id;
  };
  const onConnect = (cn: Connection) => {
    if (!cn.source || !cn.target || cn.source === cn.target) return;
    const cur = cRef.current;
    const e: AEdge = { id: `e-${uid().slice(0, 8)}`, fromNode: cn.source, toNode: cn.target, ...(cn.sourceHandle ? { fromSide: cn.sourceHandle as AEdge["fromSide"] } : {}), ...(cn.targetHandle ? { toSide: cn.targetHandle as AEdge["toSide"] } : {}), lumenEdge: { style: "sync" } };
    commit({ ...cur, edges: [...cur.edges, e] });
    setSel({ kind: "edge", id: e.id });
  };
  const onConnectEnd: OnConnectEnd = (ev, st) => {
    if (st.isValid || !st.fromNode) return;
    const pt = "changedTouches" in ev ? ev.changedTouches[0] : ev;
    const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    const id = addShape({ g: "service", l: "Service", cat: "Compute" }, pos, { from: st.fromNode.id });
    setEditing(id);
  };
  const rename = (id: string, val: string) => {
    const x = val.trim(); const cur = cRef.current;
    const n = cur.nodes.find((m) => m.id === id);
    if (!x || !n || x === displayOf(n)) return;
    const nm = nameOf(n) === x ? x : uniqueName(x);
    commit({ ...cur, nodes: cur.nodes.map((m) => (m.id !== id ? m : isGroup(m) ? { ...m, label: nm, lumenGroup: { ...m.lumenGroup!, name: nm } } : { ...m, text: x, lumenNode: { ...m.lumenNode, name: nm } })) as ANode[] });
  };
  const removeSel = (ids?: string[]) => {
    const cur = cRef.current;
    if (!ids && sel?.kind === "edge") { commit({ ...cur, edges: cur.edges.filter((e) => e.id !== sel.id) }); setSel(null); return; }
    const del = new Set(ids ?? (sel?.kind === "node" ? [sel.id] : []));
    if (!del.size) return;
    const by = new Map(cur.nodes.map((n) => [n.id, n]));
    const nodes = cur.nodes.filter((n) => !del.has(n.id)).map((n) => { let p = parentOf(n); while (p && del.has(p)) p = parentOf(by.get(p)!); return p !== parentOf(n) ? setParent(n, p) : n; });
    commit(fitGroups({ ...cur, nodes, edges: cur.edges.filter((e) => !del.has(e.fromNode) && !del.has(e.toNode)) }));
    setSel(null);
  };
  const duplicate = (id: string) => {
    const cur = cRef.current, n = cur.nodes.find((x) => x.id === id);
    if (!n || isGroup(n)) return;
    const nid = `n-${uid().slice(0, 8)}`, nm = uniqueName(nameOf(n));
    commit(fitGroups({ ...cur, nodes: [...cur.nodes, { ...n, id: nid, x: n.x + 30, y: n.y + 30, text: nm, lumenNode: { ...n.lumenNode, name: nm, ref: undefined, zoom: undefined } } as ANode] }));
    setSel({ kind: "node", id: nid });
  };
  const toggleCollapse = (id: string) => { const cur = cRef.current; commit(fitGroups({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, lumenGroup: { ...n.lumenGroup!, collapsed: !n.lumenGroup?.collapsed } } : n)) })); };
  const insideCount = (id: string) => descendants(cRef.current, id).size;
  const editNode = (n: ANode) => {
    const cur = cRef.current;
    const next = commit(fitGroups({ ...cur, nodes: cur.nodes.map((x) => (x.id === n.id ? n : x)) }));
    const m = next.nodes.find((x) => x.id === n.id);
    if (m?.lumenNode?.ref) void propagate(m, v.notes, note.id).then((k) => k && toast(t("Updated in {n} other diagram|Updated in {n} other diagrams", { n: k }), undefined, { icon: "check" }));
  };
  const editEdge = (e: AEdge) => { const cur = cRef.current; commit({ ...cur, edges: cur.edges.map((x) => (x.id === e.id ? e : x)) }); };
  const makeReusable = (n: ANode) => {
    if (n.lumenNode?.ref) { setPop("insert"); return; }
    editNode({ ...n, lumenNode: { ...n.lumenNode, ref: `obj-${uid().slice(0, 8)}` } } as ANode);
    toast(t("Reusable: insert it in other diagrams with “Insert existing object”."), undefined, { icon: "check" });
  };

  // ------------------------------------------------------------ layout (preview → Apply → Undo)
  const layoutBefore = useRef<ArchCanvas | null>(null);
  const runLayout = async (o: LayoutOpts, base = cRef.current, apply = false) => {
    try {
      const { elkLayout } = await import("../../lib/arch-layout");
      const ids = o.scope === "selection" ? new Set(sel?.kind === "node" ? [sel.id, ...descendants(base, sel.id)] : []) : o.scope === "group" ? (() => { const g = scopeGroup(); return g ? new Set([...descendants(base, g.id)]) : new Set<string>(); })() : undefined;
      const next = await elkLayout(base, { ...o, ids });
      if (apply) { commit(next, "canvas", false); setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 60); return; }
      layoutBefore.current = base; setPreview(next);
    } catch (e) { toast(t("Auto layout failed: {msg}", { msg: (e as Error).message }), undefined, { icon: "error" }); }
  };
  const scopeGroup = () => { const s = sel?.kind === "node" ? cRef.current.nodes.find((n) => n.id === sel.id) : null; if (!s) return cRef.current.nodes.find(isGroup) ?? null; return isGroup(s) ? s : cRef.current.nodes.find((n) => n.id === parentOf(s)) ?? null; };
  const applyLayout = () => {
    if (!preview) return;
    commit(preview); setPreview(null); setPop(null);
    toast(t("Layout applied"), { label: t("Undo"), run: undo }, { icon: "check" });
  };
  const cancelLayout = () => { setPreview(null); };
  const setL = (p: Partial<LayoutOpts>) => { const o = { ...lopts, ...p }; setLopts(o); if (preview) void runLayout(o); };

  // ------------------------------------------------------------ versions (History) and C4
  const [versions, setVersions] = useState<Version[]>([]);
  const openVersions = async () => { setVersions(await archVersions(note.id)); setPop("versions"); };
  const compare = (ver: Version, all: Version[]) => {
    const older = parseArch(ver.body);
    if (!older) return;
    const n = all.length - all.indexOf(ver);
    setDiff({ older, v: ver, n, label: t("Comparing v{n} · {date} → now", { n, date: `${fmtDate(ver.createdAt, { month: "short", day: "numeric" })}, ${fmtTime(ver.createdAt)}` }) });
    setPop(null);
  };
  const chain = useMemo(() => c4Chain(v.notes, note), [v.notes, note]);
  const c4parent = c.lumenArch.c4?.parent ? v.notes.find((n) => n.id === c.lumenArch.c4!.parent) : undefined;
  const c4parentNode = c4parent && c.lumenArch.c4?.parentNode ? parseArch(c4parent.body)?.nodes.find((n) => n.id === c.lumenArch.c4!.parentNode) : undefined;
  const onNodeDouble = async (_: unknown, fn: FlowNode) => {
    const n = cRef.current.nodes.find((x) => x.id === fn.id);
    if (!n) return;
    if ((kind === "c4" || n.lumenNode?.zoom) && !isGroup(n)) { const id = await zoomInto(note, cRef.current, n); if (id) { openNote(id); return; } }
    setEditing(n.id);
  };

  // ------------------------------------------------------------ reused objects
  const [objQ, setObjQ] = useState(""), [objSel, setObjSel] = useState(0);
  const objects = useMemo(() => (pop === "insert" ? listObjects(v.notes).filter((o) => o.noteId !== note.id || o.ref) : []), [pop, v.notes, note.id]);
  const objHits = objects.filter((o) => !objQ.trim() || displayOf(o.node).toLowerCase().includes(objQ.trim().toLowerCase()));
  const insertObject = async (o: ModelObject, linked: boolean) => {
    const ref = linked ? await ensureRef(o, v.notes) : undefined;
    const cur = cRef.current;
    if (linked && cur.nodes.some((n) => n.lumenNode?.ref === ref)) { toast(t("This diagram already has it.")); return; }
    const r = canvasEl.current?.getBoundingClientRect();
    const p = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const id = `n-${uid().slice(0, 8)}`, nm = uniqueName(nameOf(o.node));
    const src = o.node.type === "text" ? o.node : null;
    const n = { id, type: "text", text: src?.text ?? nm, x: p.x - 75, y: p.y - 30, width: o.node.width, height: o.node.height, ...(o.node.color ? { color: o.node.color } : {}), lumenNode: { ...(o.node.lumenNode ?? {}), name: nm, parent: undefined, zoom: undefined, ref } } as ANode;
    if (!ref) delete n.lumenNode!.ref;
    commit(fitGroups({ ...cur, nodes: [...cur.nodes, n] }));
    setSel({ kind: "node", id }); setPop(null);
  };

  // ------------------------------------------------------------ keys
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); setPop("layout"); void runLayout(lopts); return; }
      if (e.key === "Escape") { if (present !== null) setPresent(null); else if (preview) cancelLayout(); else if (diff) setDiff(null); else if (pop) setPop(null); else if (paste) keepPaste(); else setSel(null); return; }
      if (typing(e)) return;
      if (preview && e.key === "Enter") { e.preventDefault(); applyLayout(); return; }
      if (present !== null) { if (e.key === "ArrowRight" || e.key === " ") setPresent((p) => (p ?? 0) + 1); if (e.key === "ArrowLeft") setPresent((p) => Math.max(0, (p ?? 0) - 1)); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "d" && sel?.kind === "node") { e.preventDefault(); duplicate(sel.id); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeSel(); return; }
      if (e.key === "F2" && sel?.kind === "node") { e.preventDefault(); setEditing(sel.id); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }); // re-bound every render: handlers read current state

  // ------------------------------------------------------------ present (steps through groups, then the whole)
  const steps = useMemo(() => [...c.nodes.filter(isGroup).sort((a, b) => depthOf(c, a.id) - depthOf(c, b.id)).map((g) => g.id), "__all"], [c]);
  useEffect(() => {
    if (present === null) return;
    const id = steps[Math.min(present, steps.length - 1)];
    const g = c.nodes.find((n) => n.id === id);
    if (g) rf.fitBounds({ x: g.x, y: g.y, width: g.width, height: g.height }, { padding: 0.2, duration: 450 }); else rf.fitView({ padding: 0.15, duration: 450 });
  }, [present]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ misc actions
  const canvasEl = useRef<HTMLDivElement>(null);
  const setSplit = (s: Split) => { const cur = cRef.current; const next = { ...cur, lumenArch: { ...cur.lumenArch, split: s } }; cRef.current = next; setC(next); save(next); setTimeout(() => rf.fitView({ padding: 0.12, duration: 200 }), 60); };
  const copyMermaid = async () => { try { await navigator.clipboard.writeText(toMermaid(cRef.current, flavor)); toast(t("Mermaid copied"), undefined, { icon: "copy" }); } catch { toast(t("Couldn't copy to the clipboard"), undefined, { icon: "error" }); } };
  const format = () => {
    if (tab === "Code") { if (errors.length) { toast(t("Fix the error first, then format.")); return; } const s = printDsl(cRef.current, code); setCode(s); commit({ ...cRef.current, lumenArch: { ...cRef.current.lumenArch, dsl: s } }, "code", false); }
    else if (tab === "JSON") setJsEdit(null); else setMmEdit(null);
  };
  const doExport = () => openExport({ name: note.title, title: t("Export diagram"), themable: true, build: (p) => archSvg(cRef.current, p) });
  const review = () => { void archAiReview(cRef.current).catch((e: Error) => toast(e.message, undefined, { icon: "info" })); };
  const fitOnce = useRef(false);
  const userMoved = useRef(false);
  // the board fits the diagram until the user pans or zooms (pane width changes with the split, list and side panels)
  useEffect(() => {
    const el = canvasEl.current;
    if (!el) return;
    let tm: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(() => { if (!userMoved.current) void rf.fitView({ padding: 0.12 }); }, 80); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(tm); };
  }, [split, phoneCode, phone, present]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ render pieces
  const selNode = sel?.kind === "node" ? c.nodes.find((n) => n.id === sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? c.edges.find((e) => e.id === sel.id) : undefined;
  const hasProps = !!(selNode || selEdge) && !phone;
  const codeOnly = split === "code" && !phone, canvasOnly = split === "canvas" || phone;
  const showCode = (!canvasOnly || hasProps) && !phone;
  const space = v.spaceMap.get(note.spaceId), folder = note.folderId ? v.folderMap.get(note.folderId) : undefined;
  const flowCtx: FlowCtx = { hl, sel: sel?.id ?? null, editing, setHover: setHoverNode, rename, stopEdit: () => setEditing(null), toggleCollapse, inside: insideCount };

  const H = ({ g, l, pri, onClick, title, children }: { g?: string; l?: string; pri?: boolean; onClick?: () => void; title?: string; children?: ReactNode }) => (
    <button type="button" title={title ?? l} onClick={onClick} className={pri ? "hover:brightness-110" : "hover:bg-surface-2"}
      style={{ height: 32, padding: `0 ${l || children ? "10px" : "8px"}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${pri ? "transparent" : l ? "var(--border)" : "transparent"}`, background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", fontSize: 12.5, fontWeight: pri ? 600 : 500, whiteSpace: "nowrap" }}>
      {g && <Glyph name={g} size={16} />}{l}{children}
    </button>
  );
  const savedLine = <SavedLine onClick={() => void openVersions()} />;
  const bar = (o: { g: string; gc: string; text: ReactNode; chips?: boolean; btns: ReactNode; bd: string }) => (
    <div style={{ position: "absolute", left: 12, right: 12, top: 12, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 14px", borderRadius: 12, background: "var(--surface-2)", border: `1px solid ${o.bd}`, boxShadow: "0 10px 26px rgba(0,0,0,.25)", fontSize: 12.5, flexWrap: "wrap", animation: "arch-in .18s var(--ease)" }}>
      <Glyph name={o.g} size={16} color={o.gc} />
      <span style={{ flex: 1, minWidth: 160 }}>{o.text}</span>
      {o.chips && ([[t("Added"), "var(--success)"], [t("Changed"), "var(--warning)"], [t("Removed"), "var(--danger)"]] as const).map(([l, col]) => <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: col, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col }} />{l}</span>)}
      {o.btns}
    </div>
  );
  const cb = paste ? { text: t("Looks like a {kind}. Convert to a Lumen diagram?", { kind: t(PASTE_LABEL[paste.kind]) }), c: "var(--text)", btns: <><Btn h={26} onClick={keepPaste}>{t("Keep as text")}</Btn><Btn h={26} pri onClick={convertPaste}>{t("Convert")}</Btn></> }
    : tab === "Code" && errors.length ? { text: t("Syntax error on line {n}. Showing the last valid diagram.", { n: errors[0].line }), c: "var(--danger)", btns: null }
    : tab === "Mermaid" && mmErr ? { text: mmErr, c: "var(--danger)", btns: null } : tab === "JSON" && jsErr ? { text: jsErr, c: "var(--danger)", btns: null } : null;
  const errText = errors[0] ? `${/^Line \d+:/.test(errors[0].message) ? "" : t("Line {n}: ", { n: errors[0].line })}${errors[0].message} ${t("The canvas shows the last valid diagram.")}` : "";

  const codePane = (
    <div style={{ width: codeOnly || phone ? "auto" : 590, flex: codeOnly || phone ? 1 : "0 0 590px", display: "flex", flexDirection: "column", borderInlineStart: phone ? "none" : "1px solid var(--border)", background: "var(--surface)", minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
          {(["Code", "Mermaid", "JSON"] as Tab[]).map((l) => <button key={l} onClick={() => { setTab(l); setMmEdit(null); setJsEdit(null); setMmErr(null); setJsErr(null); }} style={{ height: 26, padding: "0 10px", borderRadius: 6, display: "flex", alignItems: "center", fontSize: 12, background: l === tab ? "var(--surface)" : "transparent", color: l === tab ? "var(--text)" : "var(--muted)", fontWeight: l === tab ? 600 : 400 }}>{t(l)}</button>)}
        </div>
        {tab === "Mermaid" && <select value={flavor} onChange={(e) => { setFlavor(e.target.value as MermaidFlavor); setMmEdit(null); }} aria-label={t("Mermaid type")} style={{ height: 26, fontSize: 11.5, background: "transparent", color: "var(--muted)", border: "none", outline: "none" }}>{MERMAID_FLAVORS.map((f) => <option key={f} value={f}>{f}</option>)}</select>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{tab === "Code" && errors.length ? t("{n} error|{n} errors", { n: errors.length }) : t("Synced with canvas")}</span>
        <button onClick={format} className="hover:bg-surface-2" style={{ height: 26, padding: "0 9px", borderRadius: 7, border: "1px solid var(--border)", display: "flex", alignItems: "center", fontSize: 11.5 }}>{t("Format")}</button>
        <button onClick={() => void copyMermaid()} className="hover:bg-surface-2" style={{ height: 26, padding: "0 9px", borderRadius: 7, border: "1px solid var(--border)", display: "flex", alignItems: "center", fontSize: 11.5, whiteSpace: "nowrap" }}>{t("Copy Mermaid")}</button>
        {phone && <button onClick={() => setPhoneCode(false)} style={{ height: 26, padding: "0 9px", borderRadius: 7, background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>{t("Preview")}</button>}
      </div>
      {cb && <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 10px 0", padding: "8px 10px", borderRadius: 8, fontSize: 12, background: `color-mix(in srgb,${cb.c} 10%,transparent)`, color: cb.c, animation: "arch-in .16s var(--ease)" }}>{cb.text}<span style={{ flex: 1 }} />{cb.btns}</div>}
      {tab === "Code" ? (
        <ArchCode key="dsl" lang="dsl" value={code} onChange={onCode} errors={paste ? [] : errors} band={band} onHoverLine={setHoverLine} onPaste={onPaste}
          names={[...doc.lineOf].map(([name, line]) => ({ name, line, icon: c.nodes.find((n) => nameOf(n) === name)?.lumenNode?.icon }))} />
      ) : tab === "Mermaid" ? <ArchCode key="mm" lang="mermaid" value={mmText} onChange={onMermaid} /> : <ArchCode key="js" lang="json" value={jsText} onChange={onJson} />}
      {tab === "Code" && errors.length > 0 && !paste && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--danger)" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", flexShrink: 0 }} />{errText}</div>}
      {hasProps && (
        <div style={{ position: "absolute", inset: 0, background: "var(--surface)", display: "flex", flexDirection: "column", boxShadow: "-12px 0 30px rgba(0,0,0,.25)", zIndex: 5, animation: "arch-slide .18s var(--ease)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{t("Properties")}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{selEdge ? t("Connection") : selNode && isGroup(selNode) ? t("Group") : t(selNode?.lumenNode?.kind ? selNode.lumenNode.kind[0].toUpperCase() + selNode.lumenNode.kind.slice(1) : "Service")}</span>
            <button aria-label={t("Close")} onClick={() => setSel(null)} style={{ color: "var(--muted)", padding: "0 4px" }}>×</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px", overflow: "auto" }}>
            {selNode && (isGroup(selNode) ? <GroupProps n={selNode} onChange={editNode} inside={insideCount(selNode.id)} /> : <NodeProps n={selNode} onChange={editNode} usedIn={usage.get(selNode.lumenNode?.ref ?? "") ?? 0} onReuse={() => makeReusable(selNode)} />)}
            {selEdge && <EdgeProps e={selEdge} onChange={editEdge} names={[displayOf(c.nodes.find((n) => n.id === selEdge.fromNode)!), displayOf(c.nodes.find((n) => n.id === selEdge.toNode)!)]} />}
            {(selNode || selEdge) && <button onClick={() => removeSel()} style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}><Glyph name="trash" size={14} />{t("Delete")}</button>}
          </div>
        </div>
      )}
    </div>
  );

  const layoutPop = (
    <Pop title={t("Layout")} sub="elkjs · layered" onClose={() => setPop(null)} style={phone ? { left: 0, right: 0, bottom: 0, animation: "arch-sheet .2s var(--ease)" } : { right: split === "canvas" ? 12 : 432, top: 8, width: 300, animation: "arch-in .16s var(--ease)" }} sheet={phone}>
      <Block items={[{ g: "layout-auto", l: t("Auto layout"), sub: "⇧⌘L", on: true, onClick: () => void runLayout(lopts) }]} />
      <Block h={t("Direction")} seg={[t("Right"), t("Down")]} segOn={lopts.direction === "down" ? 1 : 0} onSeg={(i) => setL({ direction: i ? "down" : "right" })} />
      <Block h={t("Spacing")} seg={[t("Compact"), t("Roomy")]} segOn={lopts.spacing === "roomy" ? 1 : 0} onSeg={(i) => setL({ spacing: i ? "roomy" : "compact" })} />
      <Block seg={[t("Keep my positions"), t("Re-layout all")]} segOn={lopts.keep ? 0 : 1} onSeg={(i) => setL({ keep: i === 0 })} />
      <Block h={t("Scope")} seg={[t("Whole diagram"), t("Selection"), t("Group: {name}", { name: scopeGroup() ? displayOf(scopeGroup()!) : "—" })]} segOn={lopts.scope === "all" ? 0 : lopts.scope === "selection" ? 1 : 2} onSeg={(i) => setL({ scope: (["all", "selection", "group"] as const)[i] })} note={t("Preview first, then Apply. One undo step.")} />
    </Pop>
  );
  const insertPop = (
    <Pop title={t("Insert existing object")} sub={t("{n} in this vault", { n: objects.length })} onClose={() => setPop(null)} style={phone ? { left: 0, right: 0, bottom: 0 } : { left: 290 - (codeOnly ? 260 : 0), top: 8, width: 360, maxHeight: "calc(100% - 16px)", animation: "arch-in .16s var(--ease)" }} sheet={phone}
      foot={<><Btn disabled={!objHits[objSel]} onClick={() => objHits[objSel] && void insertObject(objHits[objSel], false)}>{t("Insert copy")}</Btn><Btn pri disabled={!objHits[objSel]} onClick={() => objHits[objSel] && void insertObject(objHits[objSel], true)}>{t("Insert linked")}</Btn></>}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", borderRadius: 8, border: "1px solid var(--accent)" }}><Glyph name="search" size={17} /><input autoFocus value={objQ} onChange={(e) => { setObjQ(e.target.value); setObjSel(0); }} placeholder={t("Search objects…")} style={{ flex: 1, background: "transparent", outline: "none", fontSize: 12.5 }} onKeyDown={(e) => { if (e.key === "ArrowDown") setObjSel((s) => Math.min(objHits.length - 1, s + 1)); if (e.key === "ArrowUp") setObjSel((s) => Math.max(0, s - 1)); if (e.key === "Enter" && objHits[objSel]) void insertObject(objHits[objSel], true); }} /></label>
      <Block gap="2px" items={objHits.slice(0, 40).map((o, i) => ({ g: o.node.lumenNode?.icon ?? "service", l: displayOf(o.node), sub: o.ref ? (i === 0 ? t("Used in {n} diagrams", { n: o.used }) : t("Used in {n}", { n: o.used })) : o.noteTitle, on: i === objSel, mh: "40px", onClick: () => setObjSel(i) }))}
        note={objHits.length ? t("Reused objects stay linked: rename it here and every diagram updates.") : t("No objects yet. Nodes from your other diagrams show up here.")} />
    </Pop>
  );
  const versionsPop = (
    <Pop title={t("Compare with a version")} sub={t("History")} onClose={() => setPop(null)} style={phone ? { left: 0, right: 0, bottom: 0 } : { left: 12, top: 64, width: 340, maxHeight: "calc(100% - 80px)", animation: "arch-in .16s var(--ease)" }} sheet={phone}
      foot={<><Btn onClick={() => void snapshot(note, "Manual save").then(async () => { setVersions(await archVersions(note.id)); toast(t("Version saved")); })}>{t("Save a version now")}</Btn>{diff && <Btn onClick={() => { setDiff(null); setPop(null); }}>{t("Stop comparing")}</Btn>}</>}>
      <Block gap="2px" items={versions.map((ver, i) => ({ g: "history", l: `v${versions.length - i} · ${fmtDate(ver.createdAt, { month: "short", day: "numeric" })}, ${fmtTime(ver.createdAt)}`, sub: ver.label || ver.device || "", on: diff?.v.id === ver.id, onClick: () => compare(ver, versions) }))}
        note={versions.length ? t("Added nodes show green, removed red, changed amber.") : t("No saved versions yet. Ctrl+S saves one.")} />
    </Pop>
  );
  const nodeMenu = menuFor && c.nodes.find((n) => n.id === menuFor);
  const others = c.nodes.filter((n) => n.id !== menuFor && !isGroup(n) && !hiddenBy(c, n.id));
  const menuPop = nodeMenu && (
    <Pop title={displayOf(nodeMenu)} sub={pop === "menu" ? t("long-press") : pop === "connectTo" ? t("Connect to…") : pop === "moveTo" ? t("Move into group…") : t("Send to…")} onClose={() => { setPop(null); setMenuFor(null); }} style={{ left: 40, right: 40, top: 8, animation: "arch-in .16s var(--ease)", maxHeight: "calc(100% - 16px)" }}>
      {pop === "menu" && <Block gap="0" items={([["text", t("Rename"), () => { setEditing(nodeMenu.id); setPop(null); }], ["connector", t("Connect to…"), () => setPop("connectTo")], ["move-to-group", t("Move into group…"), () => setPop("moveTo")], ["send-to", t("Send to…"), () => setPop("sendTo")], ["copy", t("Duplicate"), () => { duplicate(nodeMenu.id); setPop(null); }], ["trash", t("Delete"), () => { removeSel([nodeMenu.id]); setPop(null); }]] as const).map(([g, l, fn]) => ({ g, l, mh: "44px", onClick: fn }))} note={t("Every drag has a menu path.")} />}
      {pop === "connectTo" && <Block gap="0" items={others.map((n) => ({ g: n.lumenNode?.icon ?? "service", l: displayOf(n), mh: "44px", onClick: () => { onConnect({ source: nodeMenu.id, target: n.id, sourceHandle: null, targetHandle: null }); setPop(null); setMenuFor(null); } }))} />}
      {pop === "moveTo" && <Block gap="0" items={[{ g: "not-allowed", l: t("No group"), mh: "44px", onClick: () => { const cur = cRef.current; commit(fitGroups({ ...cur, nodes: cur.nodes.map((x) => (x.id === nodeMenu.id ? setParent(x, undefined) : x)) })); setPop(null); } }, ...c.nodes.filter((g) => isGroup(g) && g.id !== nodeMenu.id && !descendants(c, nodeMenu.id).has(g.id)).map((g) => ({ g: g.lumenGroup?.kind ?? "region", l: displayOf(g), mh: "44px", on: parentOf(nodeMenu) === g.id, onClick: () => {
        const cur = cRef.current; const kids = cur.nodes.filter((x) => parentOf(x) === g.id && !isGroup(x));
        const x0 = kids.length ? Math.max(...kids.map((k) => k.x + k.width)) + 40 : g.x + 24, y0 = kids.length ? kids[0].y : g.y + 36;
        commit(fitGroups({ ...cur, nodes: cur.nodes.map((x) => (x.id === nodeMenu.id ? { ...setParent(x, g.id), x: x0, y: y0 } : x)) })); setPop(null);
      } }))]} />}
      {pop === "sendTo" && <Block gap="0" items={v.notes.filter((n) => n.id !== note.id && !n.deleted && n.type === "canvas" && parseArch(n.body)).map((n) => ({ g: "diagram", l: n.title, mh: "44px", onClick: async () => {
        const ref = nodeMenu.lumenNode?.ref ?? `obj-${uid().slice(0, 8)}`;
        if (!nodeMenu.lumenNode?.ref) editNode({ ...nodeMenu, lumenNode: { ...nodeMenu.lumenNode, ref } } as ANode);
        const tc = parseArch(n.body)!; const maxX = tc.nodes.length ? Math.max(...tc.nodes.map((x) => x.x + x.width)) : 0;
        const copy = { ...nodeMenu, id: `n-${uid().slice(0, 8)}`, x: maxX + 80, y: tc.nodes[0]?.y ?? 0, lumenNode: { ...nodeMenu.lumenNode, ref, parent: undefined } } as ANode;
        const { withDsl } = await import("../../lib/arch-dsl");
        await updateNote(n.id, { body: stringifyArch(withDsl({ ...tc, nodes: [...tc.nodes, copy] })) });
        toast(t("Sent to {name} (linked)", { name: n.title }), undefined, { icon: "check" }); setPop(null); setMenuFor(null);
      } }))} note={t("The copy stays linked: edits update both.")} />}
    </Pop>
  );

  return (
    <div className="arch-flow" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "var(--bg)", fontFamily: "Inter,'IBM Plex Sans Arabic',system-ui,sans-serif", fontSize: 13, color: "var(--text)", display: "flex", flexDirection: "column" }}>
      <style>{FLOW_CSS}</style>
      {/* header */}
      {present === null && (
        <div style={{ height: phone ? 56 : 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid var(--border)", boxSizing: "border-box" }}>
          {phone && <button aria-label={t("Back")} onClick={back} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>‹</button>}
          {!phone && <span style={{ color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>{space?.name ?? ""}{folder ? ` / ${folder.name}` : ""} /</span>}
          <div style={{ display: "flex", flexDirection: phone ? "column" : "row", gap: phone ? 0 : 10, minWidth: 0, flex: phone ? 1 : "0 1 auto", alignItems: phone ? "flex-start" : "center" }}>
            <TitleEdit note={note} />
            {savedLine}
          </div>
          {!phone && chain.length > 1 && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "var(--surface-2)", whiteSpace: "nowrap" }}>
              {chain.map((x, i) => i < chain.length - 1 ? <button key={x.note.id} onClick={() => openNote(x.note.id)} style={{ color: "var(--muted)" }}>{t(C4_LABEL[x.level])} ›</button> : <b key={x.note.id}>{t(C4_LABEL[x.level])}</b>)}
            </span>
          )}
          {!phone && <span style={{ flex: 1 }} />}
          {phone ? (
            <><H g="code" onClick={() => setPhoneCode(true)} title={t("Code")} /><H g="more" onClick={() => setPop(pop === "more" ? null : "more")} title={t("More")} /></>
          ) : (
            <>
              <H g="layout-auto" l={t("Layout ▾")} onClick={() => setPop(pop === "layout" ? null : "layout")} />
              <span style={{ height: 32, padding: "0 10px", borderRadius: 8, display: "flex", alignItems: "center", border: "1px solid transparent" }}>
                <span style={{ display: "flex", gap: 2, padding: 2, borderRadius: 7, background: "var(--surface-2)" }}>
                  {([["canvas", "canvas", t("Canvas only")], ["50", "split-view", t("Canvas and code")], ["code", "code", t("Code only")]] as const).map(([s, g, l]) => (
                    <button key={s} title={l} aria-label={l} aria-pressed={split === s} onClick={() => setSplit(s)} style={{ width: 26, height: 22, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", background: split === s ? "var(--surface)" : "transparent", color: split === s ? "var(--accent)" : "var(--muted)" }}><Glyph name={g} size={15} /></button>
                  ))}
                </span>
              </span>
              <H g="c-question" l={t("Review")} onClick={review} />
              <H g="present" l={t("Present")} onClick={() => { setSel(null); setPresent(0); }} />
              <H g="export" l={t("Export")} onClick={doExport} />
              <H g="link" l={t("Share")} pri onClick={() => setShare(true)} />
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        {!phone && !codeOnly && present === null && (
          <div style={{ width: 260, flexShrink: 0, borderInlineEnd: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}><span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{t("Library")}</span><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("Architecture first")}</span></div>
            <div style={{ padding: "4px 14px 14px", overflow: "auto", minHeight: 0 }} className="[scrollbar-width:thin]"><Library onAdd={(s) => addShape(s)} /></div>
          </div>
        )}
        {(!codeOnly || phone) && !(phone && phoneCode) && (
          <div ref={canvasEl} style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(e) => { const raw = e.dataTransfer.getData(MIME); if (!raw) return; e.preventDefault(); addShape(JSON.parse(raw) as Shape, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}>
            <Ctx.Provider value={flowCtx}>
              <ReactFlow<FlowNode, FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
                onNodeDragStart={() => { dragStart.current = new Map(cRef.current.nodes.map((n) => [n.id, { x: n.x, y: n.y }])); }} onNodeDragStop={onDragStop}
                onNodeClick={(_, n) => { if (n.id.startsWith("lp-")) return; if (connectFrom && connectFrom !== n.id) { onConnect({ source: connectFrom, target: n.id, sourceHandle: null, targetHandle: null }); setConnectFrom(null); return; } setSel({ kind: "node", id: n.id }); if (phone && sel?.kind === "node" && sel.id === n.id) setPop("props"); }}
                onNodeDoubleClick={(e, n) => void onNodeDouble(e, n)} onEdgeClick={(_, e) => setSel({ kind: "edge", id: e.id })} onPaneClick={() => { setSel(null); setEditing(null); }}
                onNodeContextMenu={(e, n) => { e.preventDefault(); if (n.id.startsWith("lp-")) return; setSel({ kind: "node", id: n.id }); setMenuFor(n.id); setPop("menu"); }}
                onPaneContextMenu={(e) => { e.preventDefault(); setPop("insert"); }}
                onConnect={onConnect} onConnectEnd={onConnectEnd} connectionMode={ConnectionMode.Loose} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode="Shift"
                fitView={!fitOnce.current} onInit={() => { fitOnce.current = true; }} onMoveStart={(ev) => { if (ev) userMoved.current = true; }} fitViewOptions={{ padding: 0.12 }} minZoom={0.15} maxZoom={2.5} proOptions={{ hideAttribution: true }} nodesConnectable={!diff && present === null} elevateEdgesOnSelect>
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="color-mix(in srgb,var(--muted) 20%,transparent)" />
                {!phone && present === null && <MiniMap pannable zoomable style={{ width: 150, height: 96, right: 0, bottom: 0 }} nodeColor={(n) => (n.type === "archGroup" ? "transparent" : "color-mix(in srgb,var(--accent) 35%,transparent)")} nodeStrokeColor={(n) => (n.type === "archGroup" ? "var(--accent)" : "transparent")} maskColor="color-mix(in srgb,var(--bg) 55%,transparent)" />}
              </ReactFlow>
            </Ctx.Provider>
            {!phone && present === null && (
              <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)", zIndex: 5 }}>
                {(["sync", "async", "data", "control"] as const).map((k) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><svg width="22" height="6"><path d="M1 3H21" style={{ stroke: EDGE_STYLE[k][0], strokeWidth: 2, strokeDasharray: EDGE_STYLE[k][1] }} /></svg>{t(EDGE_STYLE[k][2])}</span>)}
              </div>
            )}
            {preview && bar({ g: "layout-auto", gc: "var(--accent)", bd: "var(--accent)", text: t("Preview: auto layout · {dir} · {spacing} · {keep}", { dir: t(lopts.direction), spacing: t(lopts.spacing), keep: lopts.keep ? t("keep my positions") : t("re-layout all") }), btns: <><Btn onClick={cancelLayout}>{t("Cancel")}</Btn><Btn pri onClick={applyLayout}>{t("Apply")}</Btn></> })}
            {!preview && diff && vd && bar({ g: "diff", gc: "var(--muted)", bd: "var(--border)", chips: true, text: diff.label, btns: <><Btn onClick={() => void openVersions()}>{t("Pick versions ▾")}</Btn><Btn onClick={() => { void restoreVersion(diff.v).then(() => { setDiff(null); toast(t("Restored v{n}", { n: diff.n }), undefined, { icon: "history" }); }); }}>{t("Restore v{n}", { n: diff.n })}</Btn></> })}
            {!preview && !diff && c4parent && bar({ g: "c4-level", gc: "var(--muted)", bd: "var(--border)", text: t("{level} view of {name}. Double-click any container to go one level deeper.", { level: t(C4_LABEL[c.lumenArch.c4!.level]), name: c4parentNode ? displayOf(c4parentNode) : c4parent.title }), btns: <Btn onClick={() => openNote(c4parent.id)}>{t("‹ Back to {level}", { level: t(C4_LABEL[parseArch(c4parent.body)?.lumenArch.c4?.level ?? "context"]) })}</Btn> })}
            {connectFrom && bar({ g: "connector", gc: "var(--accent)", bd: "var(--accent)", text: t("Tap the node to connect to."), btns: <Btn onClick={() => setConnectFrom(null)}>{t("Cancel")}</Btn> })}
            {present !== null && (
              <div style={{ position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 10px 26px rgba(0,0,0,.25)", zIndex: 20 }}>
                <Btn onClick={() => setPresent((p) => Math.max(0, (p ?? 0) - 1))}>‹</Btn>
                <span style={{ fontSize: 12.5, minWidth: 120, textAlign: "center" }}>{(() => { const g = c.nodes.find((n) => n.id === steps[Math.min(present, steps.length - 1)]); return g ? displayOf(g) : t("Whole diagram"); })()} · {Math.min(present, steps.length - 1) + 1}/{steps.length}</span>
                <Btn onClick={() => setPresent((p) => Math.min(steps.length - 1, (p ?? 0) + 1))}>›</Btn>
                <Btn pri onClick={() => setPresent(null)}>{t("Exit")}</Btn>
              </div>
            )}
          </div>
        )}
        {(showCode || (phone && phoneCode)) && present === null && codePane}
        {pop === "layout" && layoutPop}
        {pop === "insert" && insertPop}
        {pop === "versions" && versionsPop}
        {phone && pop === "library" && (
          <Pop title={t("Library")} sub={t("Architecture")} sheet onClose={() => setPop(null)} style={{ left: 0, right: 0, bottom: 0, maxHeight: "78%", animation: "arch-sheet .22s var(--ease)" }}>
            <Library sheet onAdd={(s) => addShape(s)} onClose={() => setPop(null)} />
          </Pop>
        )}
        {phone && pop === "props" && selNode && !isGroup(selNode) && (
          <Pop title={displayOf(selNode)} sub={t(selNode.lumenNode?.kind ?? "service")} sheet onClose={() => setPop(null)} style={{ left: 0, right: 0, bottom: 0, maxHeight: "70%", animation: "arch-sheet .22s var(--ease)" }}>
            <NodeProps phone n={selNode} onChange={editNode} usedIn={usage.get(selNode.lumenNode?.ref ?? "") ?? 0} onReuse={() => makeReusable(selNode)} />
          </Pop>
        )}
        {phone && pop === "more" && (
          <Pop title={note.title} sub={t("Diagram")} sheet onClose={() => setPop(null)} style={{ left: 0, right: 0, bottom: 0, animation: "arch-sheet .22s var(--ease)" }}>
            <Block gap="0" items={([["reused-object", t("Insert existing object"), () => setPop("insert")], ["diff", t("Compare versions"), () => void openVersions()], ["c-question", t("Review"), review], ["present", t("Present"), () => { setPop(null); setPresent(0); }], ["export", t("Export"), () => { setPop(null); doExport(); }], ["link", t("Share"), () => { setPop(null); setShare(true); }]] as const).map(([g, l, fn]) => ({ g, l, mh: "44px", onClick: fn }))} />
          </Pop>
        )}
        {(pop === "menu" || pop === "connectTo" || pop === "moveTo" || pop === "sendTo") && menuPop}
      </div>
      {phone && !phoneCode && present === null && (
        <div style={{ height: 94, flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "flex-start", justifyContent: "space-around", paddingTop: 8 }}>
          {([["library", t("Library"), () => setPop(pop === "library" ? null : "library"), pop === "library"], ["connector", t("Connect"), () => { if (sel?.kind === "node") setConnectFrom(sel.id); else toast(t("Select a node first, then tap Connect.")); }, !!connectFrom], ["code", t("Code"), () => setPhoneCode(true), false], ["layout-auto", t("Layout"), () => { setPop("layout"); void runLayout(lopts); }, pop === "layout"], ["more", "⋯", () => setPop(pop === "more" ? null : "more"), pop === "more"]] as const).map(([g, l, fn, on]) => (
            <button key={g} onClick={fn} style={{ width: 64, height: 52, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 10.5, background: on ? AC : "transparent", color: on ? "var(--accent)" : "var(--text)" }}><Glyph name={g} size={22} />{l}</button>
          ))}
        </div>
      )}
      <LongPress onLong={(id) => { setSel({ kind: "node", id }); setMenuFor(id); setPop("menu"); }} root={canvasEl} enabled={phone} />
      <ShareSheet target={{ kind: "note", note }} open={share} onClose={() => setShare(false)} />
    </div>
  );
}

function SavedLine({ onClick }: { onClick: () => void }) {
  const l = useSyncLook();
  const saving = useSaving();
  const ok = !saving && l.kind === "idle";
  const text = saving ? t("Saving…") : ok ? t("Saved · Synced") : l.text;
  const col = ok ? "var(--success)" : l.color;
  return (
    <button onClick={onClick} title={t("Compare with a version")} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: col, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "var(--success)" : (l.dot.background as string) ?? col }} />{text}
    </button>
  );
}

function TitleEdit({ note }: { note: Note }) {
  const [ed, setEd] = useState(false);
  if (ed) return <input autoFocus dir="auto" defaultValue={note.title} onBlur={(e) => { setEd(false); const x = e.target.value.trim(); if (x && x !== note.title) void updateNote(note.id, { title: x }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} style={{ fontWeight: 600, fontSize: 14, background: "transparent", outline: "none", borderBottom: "1px solid var(--accent)", minWidth: 0 }} />;
  return <span dir="auto" onDoubleClick={() => setEd(true)} title={t("Double-click to rename")} style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note.title}</span>;
}

/** Touch: long-press a node for its menu (every drag has a menu path). */
function LongPress({ onLong, root, enabled }: { onLong: (id: string) => void; root: React.RefObject<HTMLDivElement | null>; enabled: boolean }) {
  useEffect(() => {
    const el = root.current;
    if (!el || !enabled) return;
    let tm: ReturnType<typeof setTimeout> | undefined, sx = 0, sy = 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const n = (e.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
      const id = n?.dataset.id;
      if (!id || id.startsWith("lp-")) return;
      sx = e.clientX; sy = e.clientY;
      tm = setTimeout(() => { navigator.vibrate?.(10); onLong(id); }, 500);
    };
    const move = (e: PointerEvent) => { if (tm && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(tm); tm = undefined; } };
    const up = () => { clearTimeout(tm); tm = undefined; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
  });
  return null;
}
export { childrenMap };
