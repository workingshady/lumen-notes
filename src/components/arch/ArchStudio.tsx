// Architecture & diagram studio (frames 46C–46Q, 47, 48A–B, 48G–I), ported from ArchStudio.dc.html.
// Library · canvas · code (Code · Mermaid · JSON). The note's JSON Canvas body is the single source of truth: typing in
// any tab parses and writes back to it (debounced, last valid state wins); dragging, renaming or connecting on the board
// rewrites the code. Positions live only in the JSON; only new nodes get placed.
import { Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type NodeChange, type OnConnectEnd } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note, Version } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { ShareSheet, shareUrl } from "../ShareSheet";
import { useSaving, useSyncLook } from "../ws-sync";
import { createNote, restoreNote, restoreVersion, snapshot, trashNote, updateNote } from "../../lib/actions";
import { fmtDate, fmtTime, t, useLang } from "../../lib/i18n";
import { back, openNote, setUI, toast, useVault } from "../../lib/store";
import { openExportJob } from "../../lib/export-job";
import { archJob } from "../../lib/export-arch";
import { uid } from "../../lib/db";
import { applyMinimalEdit } from "../../lib/arch-ops";
import { diffDsl, diffSummary } from "../../lib/ai-convert";
import { applyDsl, dslFor, parseDsl, printDsl, type DslError } from "../../lib/arch-dsl";
import {
  childrenMap, depthOf, descendants, unreadCount, seqLayout, seqLife, laneLayout, diffArch, displayOf, EDGE_STYLE, fitGroups, hiddenBy, isGroup, kindOfIcon, nameOf, parentOf, parseArch, setParent, stringifyArch,
  type AEdge, type ANode, type ArchCanvas, type ArchDiff, type Split,
} from "../../lib/arch-model";
import { defaultFlavor, detectPaste, MERMAID_FLAVORS, PASTE_LABEL, slug, toDsl, toMermaid, type MermaidFlavor, type PasteKind } from "../../lib/arch-convert";
import { edgeRoute } from "../../lib/arch-render";
import { archVersions, c4Chain, C4_LABEL, c4LevelOf, canZoom, ensureRef, listObjects, propagate, usedIn, zoomInto, type ModelObject } from "../../lib/arch-objects";
import type { LayoutOpts } from "../../lib/arch-layout";
import { ArchCode } from "./ArchCode";
import { Ctx, edgeTypes, FLOW_CSS, nodeTypes, type FlowCtx, type FlowEdge, type FlowNode } from "./ArchFlow";
import { EdgeProps, GroupProps, LabelOptions, NodeProps, type Shape } from "./ArchPanels";
import { LibraryPanel } from "../library/LibraryPanel";
import { canvasNodeFor, getLibraryItem, type LibItem } from "../../lib/library-items";
import { registerZone } from "../../lib/dnd";
import { archZone, type ArchDropApi } from "../dnd/arch-drop";
import { labelSpot, type LabelPart } from "../../lib/arch-label";
import { AC, Block, Btn, Pop } from "./ArchUi";
import { ConvertMenu } from "../wb/cards/ConvertMenu";
import { ArchPresenter } from "../wb/present/workspaces";
import { sourceOf } from "../../lib/convert";
import { sideOfPoint } from "../../lib/arch-route";
import type { Side } from "../../../shared/types";
import { ArchAIPanel, ArchDiffBar, ArchDiffCode, ArchReviewPanel, type ArchAIMode, type ArchProposal } from "../ArchAIPanel";

type Tab = "Code" | "Mermaid" | "JSON";
type Sel = { kind: "node" | "edge"; id: string } | null;
type PopKind = null | "layout" | "insert" | "versions" | "library" | "menu" | "more" | "props" | "connectTo" | "moveTo" | "sendTo";
/** Fit the diagram: readable bounds (never microscopic, never blown up), the same everywhere the studio refits. */
// fit: tight padding so the starter reads at a useful size in the split view; small diagrams stay at 100%, never below 50%
const FIT = { padding: 0.05, minZoom: 0.5, maxZoom: 1 } as const;
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 640); useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
const typing = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, .cm-editor, [contenteditable=true]");

/** In-app clipboard for nodes (survives switching diagrams, so copy here and paste in another one). */
let archClip: { nodes: ANode[]; edges: AEdge[] } | null = null;

export default function ArchStudio({ note }: { note: Note }) {
  // a body that isn't readable JSON never reaches the studio (it would autosave an empty diagram over it)
  if (!parseArch(note.body)) return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--muted)", fontSize: 13, padding: 24, textAlign: "center" }}>
      <Glyph name="alert" size={28} color="var(--danger)" />
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{t("This diagram couldn't be read.")}</span>
      <span>{t("Nothing is saved over it. Restore an earlier version from History.")}</span>
      <button onClick={() => setUI({ panel: "versions" })} style={{ height: 32, padding: "0 14px", borderRadius: 8, background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600 }}>{t("Restore from History")}</button>
    </div>
  );
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
  const [sel, setSelS] = useState<Sel>(null);
  /** Multi-selection (Shift-click, Ctrl+A, paste): every selected node and edge. Single selection lives in `sel` (it opens Properties). */
  const [multi, setMulti] = useState<{ nodes: string[]; edges: string[] } | null>(null);
  const setSel = (x: Sel) => { setSelS(x); setMulti(null); };
  const selRef = useRef(sel); selRef.current = sel;
  const [keysOpen, setKeysOpen] = useState(false);
  const [hoverNode, setHoverNode] = useState<string | null>(null), [hoverLine, setHoverLine] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editEdgeS, setEditEdgeS] = useState<{ id: string; part: LabelPart } | null>(null);
  const [lblPop, setLblPop] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pop, setPop] = useState<PopKind>(null);
  const [paste, setPaste] = useState<{ kind: PasteKind; text: string; before: string } | null>(null);
  const [lopts, setLopts] = useState<LayoutOpts>({ direction: c.lumenArch.direction, spacing: "roomy", keep: true, scope: "all" });
  const [preview, setPreview] = useState<ArchCanvas | null>(null);
  const [diff, setDiff] = useState<{ older: ArchCanvas; label: string; v: Version; n: number } | null>(null);
  const [present, setPresent] = useState<number | null>(null);
  const [share, setShare] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  // Architecture AI (48C–48F, 48J): input panel mode, the proposal as a canvas diff, the review column; interview mode reveals
  const [ai, setAi] = useState<ArchAIMode | null>(null);
  const [aiProp, setAiProp] = useState<{ p: ArchProposal; next: ArchCanvas } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [phoneCode, setPhoneCode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** When the last long-press fired: the touch-up that follows must not count as a tap. */
  const longAt = useRef(0);
  const split: Split = c.lumenArch.split ?? "50";
  const rootEl = useRef<HTMLDivElement>(null);
  const [studioW, setStudioW] = useState(1440);
  useEffect(() => { const el = rootEl.current; if (!el) return; const ro = new ResizeObserver(() => setStudioW(el.clientWidth)); ro.observe(el); setStudioW(el.clientWidth); return () => ro.disconnect(); }, []);
  /** The library docks on the left when the studio is wide enough (260 library + ≥380 code + ≥560 canvas); otherwise it opens over the canvas from a button. */
  const libDocked = studioW >= 1200;
  const [libOver, setLibOver] = useState(false);
  const kind = c.lumenArch.kind;

  // ------------------------------------------------------------ save + history
  const lastSaved = useRef(note.body);
  const saveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const undoS = useRef<string[]>([]), redoS = useRef<string[]>([]);
  // data-loss guard: when some items couldn't be read, nothing is written until you edit (they are kept and written back then)
  const guard = useRef(unreadCount(c) > 0), edited = useRef(false);
  useEffect(() => {
    if (!guard.current) return;
    const n = unreadCount(cRef.current);
    toast(n === 1 ? t("1 item couldn't be read") : t("{n} items couldn't be read", { n }), { label: t("Restore from History"), run: () => setUI({ panel: "versions" }) }, { icon: "error", ms: 12000 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useCallback((next: ArchCanvas) => {
    clearTimeout(saveT.current);
    if (guard.current && !edited.current) return;
    saveT.current = setTimeout(() => { const body = stringifyArch(next); if (body === lastSaved.current) return; lastSaved.current = body; void updateNote(note.id, { body }); }, 300);
  }, [note.id]);
  useEffect(() => () => { clearTimeout(saveT.current); if (guard.current && !edited.current) return; const body = stringifyArch(cRef.current); if (body !== lastSaved.current) void updateNote(note.id, { body }); }, [note.id]);
  const setFromCanvas = (next: ArchCanvas) => { const dsl = printDsl(next, next.lumenArch.dsl); next = { ...next, lumenArch: { ...next.lumenArch, dsl } }; setCode(dsl); setErrors([]); prevLines.current = parseDsl(dsl, next.lumenArch.kind).doc.lineOf; return next; };
  /** One step: canvas edits rewrite the code; code edits keep the typed text. */
  const commit = useCallback((next: ArchCanvas, src: "code" | "canvas" = "canvas", hist = true) => {
    edited.current = true;
    if (next.lumenArch.kind === "sequence") next = seqLayout(next); // participants stay in one row, in the order they stand
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
  const errT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCode = (text: string) => {
    setCode(text);
    if (paste || pasteRef.current) return; // a paste waiting for Keep / Convert is not parsed as Lumen code
    clearTimeout(codeT.current); clearTimeout(errT.current);
    codeT.current = setTimeout(() => {
      const { doc, errors: errs } = parseDsl(text, cRef.current.lumenArch.kind);
      // an error shows once you pause, not while you're still typing the line (46H/46I keep "Synced with canvas" meanwhile)
      if (errs.length) { errT.current = setTimeout(() => setErrors(errs), 1200); return; }
      setErrors([]);
      const next = applyDsl(cRef.current, doc, text, prevLines.current);
      prevLines.current = doc.lineOf;
      commit(next, "code");
    }, 250);
  };
  /** Set in the paste handler itself: the editor change that follows runs before the paste state re-renders. */
  const pasteRef = useRef(false);
  const onPaste = (text: string) => {
    const k = detectPaste(text);
    if (!k || tab !== "Code") return false;
    setPaste({ kind: k, text, before: code }); pasteRef.current = true;
    clearTimeout(codeT.current);
    return false; // the text goes in; the bar asks before converting
  };
  const convertPaste = () => {
    if (!paste) return;
    const r = toDsl(paste.text, paste.kind);
    const base = r.archKind && r.archKind !== kind ? { ...cRef.current, lumenArch: { ...cRef.current.lumenArch, kind: r.archKind } } : cRef.current;
    const { doc, errors: errs } = parseDsl(r.dsl, base.lumenArch.kind);
    setPaste(null); pasteRef.current = false;
    if (errs.length) { setCode(r.dsl); setErrors(errs); return; }
    // a fresh diagram from the paste: drop the old nodes, place everything, then lay out
    const next = applyDsl({ ...base, nodes: [], edges: [] }, doc, r.dsl);
    prevLines.current = doc.lineOf;
    setCode(r.dsl); setErrors([]);
    commit(next, "code");
    void runLayout({ ...lopts, keep: false, scope: "all" }, next, true);
    toast(t("Converted to a Lumen diagram"), { label: t("Undo"), run: undo }, { icon: "check" });
  };
  const keepPaste = () => { setPaste(null); pasteRef.current = false; onCode(code); };

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
  // the JSON tab leads with the "lumenArch" header (46K); the stored body keeps JSON Canvas order (nodes, edges, then lumenArch)
  const jsText = jsEdit ?? (() => { const { lumenArch, nodes, edges, ...rest } = c; return JSON.stringify({ lumenArch, nodes, edges, ...rest }, null, 2); })();
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
  const vd: ArchDiff | null = useMemo(() => (diff ? diffArch(diff.older, c) : aiProp ? diffArch(c, aiProp.next) : null), [diff, c, aiProp]);
  const shown: ArchCanvas = aiProp && !diff ? aiProp.next : c; // an AI proposal is drawn over the canvas (added green, removed red ghosts, changed amber) until Accept / Reject
  const frozen = !!diff || !!aiProp;
  const view: ArchCanvas = useMemo(() => (vd ? { ...shown, nodes: [...shown.nodes, ...vd.ghostNodes], edges: [...shown.edges, ...vd.ghostEdges] } : shown), [shown, vd]);
  const interview = !!c.lumenArch.interview;
  const masked = useMemo(() => (interview ? new Set(c.nodes.filter((n) => !revealed.has(n.id) && n.lumenNode?.kind !== "junction").map((n) => n.id)) : undefined), [interview, c.nodes, revealed]);
  const maskable = useMemo(() => c.nodes.filter((n) => n.lumenNode?.kind !== "junction").length, [c.nodes]);

  const flowNodes: FlowNode[] = useMemo(() => {
    const shown = view.nodes.filter((n) => !hiddenBy(view, n.id));
    const order = [...shown].sort((a, b) => (isGroup(a) === isGroup(b) ? depthOf(view, a.id) - depthOf(view, b.id) : isGroup(a) ? -1 : 1));
    const out: FlowNode[] = order.map((n) => {
      const ref = n.lumenNode?.ref, u = ref ? usage.get(ref) ?? 0 : 0;
      const chip = u > 1 ? t("Used in {n} diagram|Used in {n} diagrams", { n: u }) : [n.lumenNode?.cost, n.lumenNode?.sla].filter(Boolean).join(" · ") || undefined;
      const mark = vd?.nodes.get(n.id);
      return {
        id: n.id, type: isGroup(n) ? "archGroup" : "arch", position: { x: n.x, y: n.y }, width: n.width, height: n.height, style: { width: n.width, height: n.height },
        data: { n, mark, chip, life: kind === "sequence" && !isGroup(n) ? seqLife(view) : undefined }, selected: multi ? multi.nodes.includes(n.id) : sel?.kind === "node" && sel.id === n.id, draggable: !frozen && present === null, selectable: mark !== "del", zIndex: isGroup(n) && !n.lumenGroup?.collapsed ? depthOf(view, n.id) : 1000,
      };
    });
    if (preview) for (const n of preview.nodes) if (!isGroup(n) && !hiddenBy(preview, n.id)) out.push({ id: `lp-${n.id}`, type: "archGhost", position: { x: n.x, y: n.y }, width: n.width, height: n.height, style: { width: n.width, height: n.height }, data: { n, ghost: true }, draggable: false, selectable: false, zIndex: 2000 });
    return out;
  }, [view, vd, usage, sel, multi, preview, diff, present]); // eslint-disable-line react-hooks/exhaustive-deps
  const flowEdges: FlowEdge[] = useMemo(() => {
    const by = new Map(view.nodes.map((n) => [n.id, n]));
    return view.edges.flatMap((e) => {
      const r = edgeRoute(view, e, by);
      if (!r) return [];
      return [{ id: e.id, source: r.from, target: r.to, sourceHandle: r.fs, targetHandle: r.ts, type: "arch", data: { e, r, src: r.src, mark: vd?.edges.get(e.id) }, selected: multi ? multi.edges.includes(e.id) : sel?.kind === "edge" && sel.id === e.id, reconnectable: false, zIndex: 500 } as FlowEdge];
    });
  }, [view, vd, sel, multi, diff, present]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const centre = () => { const r = canvasEl.current?.getBoundingClientRect(); return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 }; };
  /** Shared-library item -> node at `at` (default: canvas centre), nested into the group under it. One undo step. */
  const placeItem = (item: LibItem): void => {
    const cur = cRef.current, p = centre();
    const parent = deepestGroupAt(cur, p.x, p.y, new Set());
    const id = `n-${uid().slice(0, 8)}`;
    const n = canvasNodeFor(item, p, id, uniqueName(item.name));
    if (parent) { if (n.lumenGroup) n.lumenGroup = { ...n.lumenGroup, parent: parent.id }; else if (n.lumenNode) n.lumenNode = { ...n.lumenNode, parent: parent.id }; else (n as { lumenNode?: unknown }).lumenNode = { name: nameOf(n), parent: parent.id }; }
    commit(fitGroups({ ...cur, nodes: [...cur.nodes, n] }));
    setSel({ kind: "node", id });
  };
  // drag & drop (brief §12.1): a drop is one undo step even when it creates several nodes
  const dropAt = useRef(0);
  const dropHist = () => { const first = Date.now() - dropAt.current > 1500; dropAt.current = Date.now(); return first; };
  const dropApi = useRef<ArchDropApi>(null as unknown as ArchDropApi);
  dropApi.current = {
    screenToFlow: (p) => rf.screenToFlowPosition(p),
    hit: (pt) => {
      const cur = cRef.current, f = rf.screenToFlowPosition(pt);
      const mk = (n: ANode, group: boolean) => ({ id: n.id, label: displayOf(n), group, el: document.querySelector<HTMLElement>(`.react-flow__node[data-id="${n.id}"]`) });
      const on = [...cur.nodes].reverse().find((n) => !isGroup(n) && f.x >= n.x && f.x <= n.x + n.width && f.y >= n.y && f.y <= n.y + n.height);
      if (on) return mk(on, false);
      const g = deepestGroupAt(cur, f.x, f.y, new Set());
      return g ? mk(g, true) : null;
    },
    addNode: (spec, at, parentId) => {
      const cur = cRef.current, id = `n-${uid().slice(0, 8)}`, name = uniqueName(spec.label || "Node");
      const lib = spec.item && typeof spec.item.id === "string" ? getLibraryItem(spec.item.id) : undefined;
      let n: ANode;
      if (lib) n = canvasNodeFor(lib, at, id, name);
      else { const icon = spec.glyph ?? "service"; n = { id, type: "text", text: name, x: at.x - 75, y: at.y - 30, width: 150, height: 60, lumenNode: { name, icon, kind: kindOfIcon(icon) } } as ANode; }
      const ln = { ...(n.lumenNode ?? { name }), ...(parentId ? { parent: parentId } : {}), ...(spec.links ? { links: spec.links } : {}), ...(spec.description ? { description: spec.description } : {}) };
      if (n.type === "group") { if (parentId) n.lumenGroup = { ...n.lumenGroup!, parent: parentId }; } else n.lumenNode = ln as ANode["lumenNode"];
      commit(fitGroups({ ...cur, nodes: [...cur.nodes, n] }), "canvas", dropHist());
      return id;
    },
    addLink: (id, link) => { const cur = cRef.current; commit({ ...cur, nodes: cur.nodes.map((n) => (n.id !== id ? n : { ...n, lumenNode: { ...(n.lumenNode ?? { name: nameOf(n) }), links: [...(n.lumenNode?.links ?? []), link] } } as ANode)) }, "canvas", dropHist()); },
    appendText: (id, text) => { const cur = cRef.current; commit({ ...cur, nodes: cur.nodes.map((n) => (n.id !== id ? n : { ...n, lumenNode: { ...(n.lumenNode ?? { name: nameOf(n) }), description: [n.lumenNode?.description, text].filter(Boolean).join("\n\n") } } as ANode)) }, "canvas", dropHist()); },
    addEdge: (a, b) => { const cur = cRef.current; commit({ ...cur, edges: [...cur.edges, { id: `e-${uid().slice(0, 8)}`, fromNode: a, toNode: b, lumenEdge: { style: "sync" as const } }] }, "canvas", dropHist()); },
    undo: () => undo(),
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
    // released over a node (not exactly on a port): connect to it, at the side nearest the pointer
    const hit = nodeAtScreen(pt.clientX, pt.clientY);
    if (hit) { if (hit.id !== st.fromNode.id) onConnect({ source: st.fromNode.id, target: hit.id, sourceHandle: st.fromHandle?.id ?? null, targetHandle: hit.side }); return; }
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
  /** Everything selected right now (nodes, edges). */
  const selection = (): { nodes: string[]; edges: string[] } => multi ?? { nodes: sel?.kind === "node" ? [sel.id] : [], edges: sel?.kind === "edge" ? [sel.id] : [] };
  /** Delete the selection (or `ids`): edges, nodes and the edges touching them; a deleted group's children move up a level. One undo step; the code follows. */
  const removeSel = (ids?: string[]) => {
    const cur = cRef.current, s0 = ids ? { nodes: ids, edges: [] as string[] } : selection();
    const del = new Set(s0.nodes), delE = new Set(s0.edges);
    if (!del.size && !delE.size) return;
    const by = new Map(cur.nodes.map((n) => [n.id, n]));
    const nodes = cur.nodes.filter((n) => !del.has(n.id)).map((n) => { let p = parentOf(n); while (p && del.has(p)) p = parentOf(by.get(p)!); return p !== parentOf(n) ? setParent(n, p) : n; });
    commit(fitGroups({ ...cur, nodes, edges: cur.edges.filter((e) => !delE.has(e.id) && !del.has(e.fromNode) && !del.has(e.toNode)) }));
    setSel(null);
    toast(t("Deleted {n} item|Deleted {n} items", { n: del.size + delE.size }), { label: t("Undo"), run: () => undo() });
  };
  /** Copies of a set of nodes and the edges among them, shifted by (dx, dy): new ids, unique names, parents remapped. One undo step. */
  const cloneSet = (src: { nodes: ANode[]; edges: AEdge[] }, dx: number, dy: number) => {
    let cur = cRef.current;
    const idMap = new Map(src.nodes.map((n) => [n.id, `n-${uid().slice(0, 8)}`]));
    const exists = new Set(cur.nodes.map((n) => n.id));
    const out: ANode[] = [];
    for (const n of src.nodes) {
      const nm = uniqueName(nameOf(n), { ...cur, nodes: [...cur.nodes, ...out] });
      const p = parentOf(n), np = p ? idMap.get(p) ?? (exists.has(p) ? p : undefined) : undefined;
      let m = { ...n, id: idMap.get(n.id)!, x: n.x + dx, y: n.y + dy } as ANode;
      if (isGroup(m)) m = { ...m, label: nm, lumenGroup: { ...m.lumenGroup!, name: nm } } as ANode;
      else m = { ...m, ...(m.type === "text" && displayOf(n) === nameOf(n) ? { text: nm } : {}), lumenNode: { ...m.lumenNode, name: nm, ref: undefined, zoom: undefined } } as ANode;
      out.push(setParent(m, np));
    }
    const edges = src.edges.filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode)).map((e) => { const { points: _p, pointsKey: _k, manual: _m, ...le } = e.lumenEdge ?? {}; return { ...e, id: `e-${uid().slice(0, 8)}`, fromNode: idMap.get(e.fromNode)!, toNode: idMap.get(e.toNode)!, lumenEdge: le }; });
    cur = commit(fitGroups({ ...cur, nodes: [...cur.nodes, ...out], edges: [...cur.edges, ...edges] }));
    const ids = out.map((n) => n.id);
    if (ids.length === 1 && !edges.length) setSel({ kind: "node", id: ids[0] }); else { setSelS(null); setMulti({ nodes: ids, edges: edges.map((e) => e.id) }); }
  };
  /** The selected nodes with every descendant, and the edges among them (copy / duplicate payload). */
  const gather = () => {
    const cur = cRef.current, s0 = selection();
    const ids = new Set<string>();
    for (const id of s0.nodes) { ids.add(id); for (const d of descendants(cur, id)) ids.add(d); }
    return { nodes: cur.nodes.filter((n) => ids.has(n.id)), edges: cur.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) };
  };
  const pasteN = useRef(0);
  const copySel = (cut: boolean) => {
    const g = gather();
    if (!g.nodes.length) return;
    archClip = g; pasteN.current = 0;
    void navigator.clipboard?.writeText(JSON.stringify({ nodes: g.nodes, edges: g.edges })).catch(() => {});
    if (cut) removeSel(); else toast(t("Copied {n} node|Copied {n} nodes", { n: g.nodes.length }), undefined, { icon: "copy" });
  };
  const pasteClip = () => { if (!archClip?.nodes.length) return; const k = 30 * ++pasteN.current; cloneSet(archClip, k, k); };
  const nudgeAt = useRef(0);
  const nudge = (dx: number, dy: number) => {
    const cur = cRef.current, s0 = selection();
    if (!s0.nodes.length) return;
    const move = new Set<string>();
    for (const id of s0.nodes) { move.add(id); for (const d of descendants(cur, id)) move.add(d); }
    const hist = Date.now() - nudgeAt.current > 700; nudgeAt.current = Date.now(); // a burst of arrow presses is one undo step
    commit(fitGroups({ ...cur, nodes: cur.nodes.map((n) => (move.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }), "canvas", hist);
  };
  /** Ctrl+G: wrap the selected nodes in a new group (inside their common parent). Ctrl+Shift+G on a group: ungroup. */
  const groupSel = () => {
    const cur = cRef.current, ids = selection().nodes;
    if (!ids.length) return;
    const nodes = cur.nodes.filter((n) => ids.includes(n.id));
    const parents = new Set(nodes.map(parentOf)), common = parents.size === 1 ? [...parents][0] : undefined;
    const id = `n-${uid().slice(0, 8)}`, nm = uniqueName(t("Group"));
    const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y));
    const x1 = Math.max(...nodes.map((n) => n.x + n.width)), y1 = Math.max(...nodes.map((n) => n.y + n.height));
    const g = { id, type: "group", x: x0 - 24, y: y0 - 36, width: x1 - x0 + 48, height: y1 - y0 + 60, label: nm, lumenGroup: { kind: "zone", name: nm, ...(common ? { parent: common } : {}) } } as ANode;
    commit(fitGroups({ ...cur, nodes: [...cur.nodes.map((n) => (ids.includes(n.id) ? setParent(n, id) : n)), g] }));
    setSel({ kind: "node", id });
  };
  const ungroupSel = () => {
    const cur = cRef.current, g = sel?.kind === "node" ? cur.nodes.find((n) => n.id === sel.id) : undefined;
    if (!g || !isGroup(g)) return;
    const up = parentOf(g);
    commit(fitGroups({ ...cur, nodes: cur.nodes.filter((n) => n.id !== g.id).map((n) => (parentOf(n) === g.id ? setParent(n, up) : n)), edges: cur.edges.filter((e) => e.fromNode !== g.id && e.toNode !== g.id) }));
    setSel(null);
  };
  /** Ctrl+D / menu: copies of the selection (or of `id`), 30 px down-right. */
  const duplicate = (id?: string) => {
    const cur = cRef.current;
    const g = id ? (() => { const ids = new Set([id, ...descendants(cur, id)]); return { nodes: cur.nodes.filter((n) => ids.has(n.id)), edges: cur.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) }; })() : gather();
    if (g.nodes.length) cloneSet(g, 30, 30);
  };
  const toggleCollapse = (id: string) => { const cur = cRef.current; commit(fitGroups({ ...cur, nodes: cur.nodes.map((n) => (n.id === id ? { ...n, lumenGroup: { ...n.lumenGroup!, collapsed: !n.lumenGroup?.collapsed } } : n)) })); };
  const insideCount = (id: string) => descendants(cRef.current, id).size;
  const editNode = (n: ANode) => {
    const cur = cRef.current;
    const next = commit(fitGroups({ ...cur, nodes: cur.nodes.map((x) => (x.id === n.id ? n : x)) }));
    const m = next.nodes.find((x) => x.id === n.id);
    if (m?.lumenNode?.ref) void propagate(m, v.notes, note.id).then((k) => k && toast(t("Updated in {n} other diagram|Updated in {n} other diagrams", { n: k }), undefined, { icon: "check" }));
  };
  /** One undo step. The code is rewritten only when the topology or the middle text changes; points, label styles and the rest live in the JSON alone. */
  const editEdge = (e: AEdge) => {
    const cur = cRef.current, old = cur.edges.find((x) => x.id === e.id);
    const dslSame = !!old && old.fromNode === e.fromNode && old.toNode === e.toNode && old.label === e.label && old.lumenEdge?.style === e.lumenEdge?.style && old.fromEnd === e.fromEnd && old.toEnd === e.toEnd;
    commit({ ...cur, edges: cur.edges.map((x) => (x.id === e.id ? e : x)) }, dslSame ? "code" : "canvas");
  };
  const patchEdge = (id: string, fn: (e: AEdge) => AEdge) => { const e = cRef.current.edges.find((x) => x.id === id); if (e) editEdge(fn(e)); };
  const saveLabel = (id: string, part: LabelPart, text: string) => patchEdge(id, (e) => {
    const x = text.trim(), le = { ...e.lumenEdge }, labels = { ...le.labels };
    if (x) labels[part] = x; else delete labels[part];
    if (x && le.labelStyle?.hidden) le.labelStyle = { ...le.labelStyle, hidden: undefined };
    const out: AEdge = { ...e, lumenEdge: { ...le, labels: Object.keys(labels).length ? labels : undefined } };
    if (part === "mid") { if (x) out.label = x; else delete out.label; }
    return out;
  });
  const labelClick = (id: string) => { setSel({ kind: "edge", id }); setLblPop((p) => (p === id ? null : id)); };
  /** Our own end handles (pointer events: mouse, pen, touch): move one end of edge `id` onto `node`, pinned to `side`. One undo step. */
  const reconnectEnd = (id: string, end: "source" | "target", node: string, side?: Side) => {
    const e = cRef.current.edges.find((x) => x.id === id);
    if (!e) return;
    const fixed = end === "source" ? e.toNode : e.fromNode;
    if (node === fixed) { toast(t("An edge can't connect a node to itself.")); return; }
    const { fromSide: _a, toSide: _b, ...rest } = e;
    const { points: _p, pointsKey: _k, manual: _m, ...le } = e.lumenEdge ?? {};
    const keep = end === "source" ? { ...(e.toSide ? { toSide: e.toSide } : {}), ...(side ? { fromSide: side } : {}) } : { ...(e.fromSide ? { fromSide: e.fromSide } : {}), ...(side ? { toSide: side } : {}) };
    editEdge({ ...rest, ...(end === "source" ? { fromNode: node } : { toNode: node }), ...keep, lumenEdge: le } as AEdge);
    setSel({ kind: "edge", id });
  };
  /** The node under a screen point (leaf nodes first, then the deepest group) and the side nearest to the point. */
  const nodeAtScreen = (x: number, y: number): { id: string; side: Side } | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".react-flow__handle");
    const f = rf.screenToFlowPosition({ x, y }), cur = cRef.current;
    if (el?.dataset.nodeid && el.dataset.handleid) return { id: el.dataset.nodeid, side: el.dataset.handleid as Side };
    const on = [...cur.nodes].reverse().find((n) => (!isGroup(n) || n.lumenGroup?.collapsed) && !hiddenBy(cur, n.id) && f.x >= n.x - 6 && f.x <= n.x + n.width + 6 && f.y >= n.y - 6 && f.y <= n.y + n.height + 6);
    return on ? { id: on.id, side: sideOfPoint(on, f) } : null;
  };
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
      const next = base.lumenArch.kind === "sequence" ? seqLayout({ ...base, nodes: base.nodes.map((n) => ({ ...n, x: n.x + 0.001 })) }) : await elkLayout(base, { ...o, ids }).then((x) => (x.lumenArch.kind === "bpmn" && o.scope === "all" ? laneLayout(x) : x));
      if (apply) { commit(next, "canvas", false); setTimeout(() => rf.fitView({ ...FIT, duration: 300 }), 60); return; }
      layoutBefore.current = base; setPreview(next);
    } catch (e) { toast(t("Auto layout failed: {msg}", { msg: (e as Error).message }), undefined, { icon: "error" }); }
  };
  const scopeGroup = () => { const s = sel?.kind === "node" ? cRef.current.nodes.find((n) => n.id === sel.id) : null; if (!s) return cRef.current.nodes.find(isGroup) ?? null; return isGroup(s) ? s : cRef.current.nodes.find((n) => n.id === parentOf(s)) ?? null; };
  const applyLayout = () => {
    if (!preview) return;
    commit(preview); setPreview(null); setPop(null);
    // a new layout can move things far (Down, re-layout all): show all of it
    userMoved.current = false; setTimeout(() => void rf.fitView({ ...FIT, minZoom: 0.15, duration: 300 }), 60);
    toast(t("Layout applied"), { label: t("Undo"), run: undo }, { icon: "check" });
  };
  const cancelLayout = () => { setPreview(null); };
  const setL = (p: Partial<LayoutOpts>) => { const o = { ...lopts, ...p }; setLopts(o); if (preview) void runLayout(o); };

  // ------------------------------------------------------------ versions (History) and C4
  const [versions, setVersions] = useState<Version[]>([]);
  // Delete (owner request): same flow as canvas/whiteboard: trash + Undo toast.
  const deleteDiagram = async () => { const title = note.title; await trashNote(note.id); setUI({ noteId: null }); toast(t("“{title}” moved to Trash", { title }), { label: t("Undo"), run: () => { void restoreNote(note.id); openNote(note.id); } }); };
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
    // C4 drill-down (48H): a system / container opens its diagram one level deeper (created and linked the first time)
    if (canZoom(cRef.current, n) && !frozen) { const id = await zoomInto(note, cRef.current, n); if (id) { openNote(id); return; } }
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
      if (e.key === "Escape") { if (present !== null) setPresent(null); else if (aiProp || ai || reviewOpen) return; else if (preview) cancelLayout(); else if (diff) setDiff(null); else if (lblPop) setLblPop(null); else if (pop) setPop(null); else if (paste) keepPaste(); else if (keysOpen) setKeysOpen(false); else if (libOver) setLibOver(false); else setSel(null); return; }
      if (typing(e)) return;
      if (interview && e.altKey && (e.code === "KeyR" || e.key.toLowerCase() === "r" || e.key === "®")) { e.preventDefault(); revealAll(); return; }
      if (preview && e.key === "Enter") { e.preventDefault(); applyLayout(); return; }
      if (present !== null) { if (e.key === "ArrowRight" || e.key === " ") setPresent((p) => (p ?? 0) + 1); if (e.key === "ArrowLeft") setPresent((p) => Math.max(0, (p ?? 0) - 1)); return; }
      // stopPropagation: the app's global Ctrl+Z also runs the latest toast's Undo, which would undo twice
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); e.stopPropagation(); redo(); return; }
      if (frozen || editing || editEdgeS) return;
      const k = e.key.toLowerCase(), cur = selection(), any = cur.nodes.length + cur.edges.length > 0;
      if (!mod && e.shiftKey && (e.code === "Digit1" || e.key === "!")) { e.preventDefault(); userMoved.current = false; void rf.fitView({ ...FIT, minZoom: 0.1, duration: 250 }); return; }
      if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
      if (mod && k === "a") { e.preventDefault(); setSelS(null); setMulti({ nodes: cRef.current.nodes.filter((n) => !hiddenBy(cRef.current, n.id)).map((n) => n.id), edges: cRef.current.edges.map((x) => x.id) }); return; }
      if (mod && (k === "c" || k === "x") && cur.nodes.length) { e.preventDefault(); copySel(k === "x"); return; }
      if (mod && k === "v" && archClip) { e.preventDefault(); pasteClip(); return; }
      if (mod && k === "g") { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && any) { e.preventDefault(); removeSel(); return; }
      if (e.key.startsWith("Arrow") && cur.nodes.length && !mod) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; nudge(e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0); return; }
      if ((e.key === "F2" || e.key === "Enter") && sel?.kind === "node") { e.preventDefault(); setEditing(sel.id); return; }
      if ((e.key === "F2" || e.key === "Enter") && sel?.kind === "edge") { e.preventDefault(); setLblPop(null); setEditEdgeS({ id: sel.id, part: "mid" }); return; }
      if (!mod && (e.key === "?" || e.key === "؟")) { e.preventDefault(); e.stopPropagation(); setKeysOpen((o) => !o); }
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }); // re-bound every render: handlers read current state; capture phase so the app's global "?" sheet doesn't open too

  // ------------------------------------------------------------ present (steps through groups, then the whole)
  const steps = useMemo(() => [...c.nodes.filter(isGroup).sort((a, b) => depthOf(c, a.id) - depthOf(c, b.id)).map((g) => g.id), "__all"], [c]);
  useEffect(() => {
    if (present === null) return;
    const id = steps[Math.min(present, steps.length - 1)];
    const g = c.nodes.find((n) => n.id === id);
    if (g) rf.fitBounds({ x: g.x, y: g.y, width: g.width, height: g.height }, { padding: 0.2, duration: 450 }); else rf.fitView({ ...FIT, duration: 450 });
  }, [present]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ misc actions
  const canvasEl = useRef<HTMLDivElement>(null);
  const setSplit = (s: Split) => { const cur = cRef.current; const next = { ...cur, lumenArch: { ...cur.lumenArch, split: s } }; cRef.current = next; setC(next); save(next); setTimeout(() => rf.fitView({ ...FIT, duration: 200 }), 60); };
  const copyMermaid = async () => { try { await navigator.clipboard.writeText(toMermaid(cRef.current, flavor)); toast(t("Mermaid copied"), undefined, { icon: "copy" }); } catch { toast(t("Couldn't copy to the clipboard"), undefined, { icon: "error" }); } };
  const format = () => {
    if (tab === "Code") { if (errors.length) { toast(t("Fix the error first, then format.")); return; } const s = printDsl(cRef.current, code); setCode(s); commit({ ...cRef.current, lumenArch: { ...cRef.current.lumenArch, dsl: s } }, "code", false); }
    else if (tab === "JSON") setJsEdit(null); else setMmEdit(null);
  };
  const doExport = () => {
    const el = canvasEl.current, vp = rf.getViewport();
    const view = el ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: el.clientWidth / vp.zoom, h: el.clientHeight / vp.zoom } : undefined;
    const s0 = selection();
    openExportJob(archJob({ title: note.title, canvas: () => cRef.current, notes: v.notes, note, selectedIds: s0.nodes, view, link: note.shareId ? shareUrl(note.shareId) : undefined }));
  };
  const [reviewOpen, setReviewOpen] = useState(false);
  const review = () => { setPop(null); setAi(null); setAiProp(null); setSel(null); setReviewOpen(true); };
  const openAi = (m: "describe" | "edit") => { setPop(null); setReviewOpen(false); setAiProp(null); setAi(m); };
  /** The panel hands us the validated DSL; parse it into a canvas (describe = a fresh diagram, edit = keeps ids / positions) and show it as a diff. */
  const onAiProposal = (p: ArchProposal | null) => {
    if (!p) { setAiProp(null); return; }
    const cur = cRef.current;
    const base = ai === "describe" ? { ...cur, nodes: [], edges: [] } : cur;
    const { doc, errors: errs } = parseDsl(p.dsl, cur.lumenArch.kind);
    if (errs.length) { toast(t("The AI wrote diagram code that didn’t check out (line {n}). Try again or add detail.", { n: errs[0].line }), undefined, { icon: "error" }); return; }
    const put = (next: ArchCanvas) => { setAiProp({ p, next }); setSel(null); setTimeout(() => rf.fitView({ ...FIT, duration: 250 }), 60); };
    if (ai !== "describe") {
      // edit by instruction: apply the answer as minimal ops onto the current canvas (ids, positions, bend points, label styles and comments survive)
      try {
        const m = applyMinimalEdit(cur, p.base || code, p.dsl);
        const rows = diffDsl(p.base || code, m.dsl);
        setAiProp({ p: { ...p, dsl: m.dsl, rows, summary: diffSummary(rows) }, next: m.canvas }); setSel(null); setTimeout(() => rf.fitView({ ...FIT, duration: 250 }), 60);
      } catch (e) { toast((e as Error).message, undefined, { icon: "error" }); }
      return;
    }
    const next = applyDsl(base, doc, p.dsl, undefined);
    void import("../../lib/arch-layout").then(({ elkLayout }) => elkLayout(next, { ...lopts, keep: false, scope: "all" })).then(put, () => put(next));
  };
  /** Accept = one undo step (validated DSL → canvas → code), Reject = nothing changed. */
  const aiAccept = () => {
    if (!aiProp) return;
    const { p, next } = aiProp;
    const dsl = p.dsl;
    const out = commit({ ...next, lumenArch: { ...next.lumenArch, dsl } }, "code");
    const { doc } = parseDsl(dsl, out.lumenArch.kind); prevLines.current = doc.lineOf; setCode(dsl); setErrors([]);
    setAiProp(null); setAi(null); setRevealed(new Set());
    setTimeout(() => rf.fitView({ ...FIT, duration: 250 }), 60);
    toast(t("Applied. Undo restores the previous diagram."), { label: t("Undo"), run: undo }, { icon: "check" });
  };
  const aiReject = () => { setAiProp(null); setAi(null); };
  const noteFromAi = (title: string, md: string) => { void createNote({ title, spaceId: note.spaceId, folderId: note.folderId, body: md.startsWith("# ") ? md : `# ${title}\n\n${md}` }); };
  const revealAll = () => setRevealed((r) => (r.size >= maskable ? new Set() : new Set(c.nodes.map((n) => n.id))));
  const fitOnce = useRef(false);
  const userMoved = useRef(false);
  useEffect(() => {
    const el = canvasEl.current;
    if (!el) return;
    const api: ArchDropApi = new Proxy({} as ArchDropApi, { get: (_, k) => dropApi.current[k as keyof ArchDropApi] });
    return registerZone(archZone(el, note.title, api));
  }); // re-register each render: the canvas element remounts with the layout
  // the board fits the diagram until the user pans or zooms (pane width changes with the split, list and side panels);
  // opening / closing Properties never refits: selecting something must not change the zoom
  /** Phone (46N): the fitted diagram sits under the header, not centred in the tall pane. */
  const topAlign = () => {
    if (!phone) return;
    const vis = cRef.current.nodes.filter((n) => !hiddenBy(cRef.current, n.id));
    if (!vis.length) return;
    const vp = rf.getViewport(), minY = Math.min(...vis.map((n) => n.y)) - 24;
    void rf.setViewport({ x: vp.x, y: 16 - minY * vp.zoom, zoom: vp.zoom });
  };
  const propsNow = useRef(false), propsAtFit = useRef(false);
  /** When Properties takes room from the canvas, pan (never zoom) so the selected node / edge stays in view. */
  const keepSelVisible = () => {
    const el = canvasEl.current, s0 = selRef.current, cur = cRef.current;
    if (!el || !s0) return;
    const box = (() => {
      if (s0.kind === "node") return cur.nodes.find((n) => n.id === s0.id);
      const e = cur.edges.find((x) => x.id === s0.id), by = new Map(cur.nodes.map((n) => [n.id, n]));
      const r = e && edgeRoute(cur, e, by);
      if (!r) return undefined;
      const xs = r.poly.map((p) => p.x), ys = r.poly.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    })();
    if (!box) return;
    const { x, y, zoom } = rf.getViewport(), W = el.clientWidth, H = el.clientHeight;
    const sx0 = box.x * zoom + x, sx1 = (box.x + box.width) * zoom + x, sy0 = box.y * zoom + y, sy1 = (box.y + box.height) * zoom + y;
    if (sx0 >= 8 && sx1 <= W - 8 && sy0 >= 8 && sy1 <= H - 8) return;
    void rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration: 200 });
  };
  useEffect(() => {
    const el = canvasEl.current;
    if (!el) return;
    let tm: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(() => { if (propsNow.current !== propsAtFit.current) { propsAtFit.current = propsNow.current; keepSelVisible(); return; } if (!userMoved.current) void rf.fitView(FIT).then(topAlign); }, 80); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(tm); };
  }, [split, phoneCode, phone, present, libDocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ render pieces
  const selNode = sel?.kind === "node" ? c.nodes.find((n) => n.id === sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? c.edges.find((e) => e.id === sel.id) : undefined;
  const hasProps = !!(selNode || selEdge) && !phone;
  const codeOnly = split === "code" && !phone, canvasOnly = split === "canvas" || phone;
  const showCode = (!canvasOnly || hasProps || !!aiProp || reviewOpen) && !phone;
  propsNow.current = canvasOnly && hasProps; // only changes the canvas width in canvas-only mode
  // the code / properties column is the design's 590 px when there's room; in a narrower window it gives way so the canvas keeps ≥ 560 px
  const codeW = Math.round(Math.max(380, Math.min(590, studioW - (libDocked ? 260 : 0) - 560)));
  const space = v.spaceMap.get(note.spaceId), folder = note.folderId ? v.folderMap.get(note.folderId) : undefined;
  const flowCtx: FlowCtx = { hl, sel: sel?.id ?? null, editing, setHover: setHoverNode, rename, stopEdit: () => setEditing(null), toggleCollapse, inside: insideCount, ro: frozen || present !== null, masked, editEdge: editEdgeS, setEditEdge: (x) => { setEditEdgeS(x); if (x) setLblPop(null); }, saveLabel, patchEdge, labelClick, selectEdge: (id) => { setSel({ kind: "edge", id }); setLblPop(null); }, reconnect: reconnectEnd, nodeAt: nodeAtScreen };

  const H = ({ g, l, pri, onClick, title, children }: { g?: string; l?: string; pri?: boolean; onClick?: () => void; title?: string; children?: ReactNode }) => (
    <button type="button" title={title ?? l} onClick={onClick} className={pri ? "hover:brightness-110" : "hover:bg-surface-2"}
      style={{ height: 32, padding: `0 ${l || children ? "10px" : "8px"}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 6, border: `1px solid ${pri ? "transparent" : l ? "var(--border)" : "transparent"}`, background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", fontSize: 12.5, fontWeight: pri ? 600 : 500, whiteSpace: "nowrap" }}>
      {g && <Glyph name={g} size={16} />}{l}{children}
    </button>
  );
  const savedLine = <SavedLine onClick={() => void openVersions()} />;
  // the Layout popover hangs over the canvas's right part: the preview bar stops short of it so Apply / Cancel stay clickable
  const barRight = pop === "layout" && !phone ? Math.max(12, split === "canvas" ? 324 : 744 - (showCode ? codeW : 0)) : 12;
  const bar = (o: { g: string; gc: string; text: ReactNode; chips?: boolean; btns: ReactNode; bd: string }) => (
    <div style={{ position: "absolute", left: 12, right: barRight, top: 12, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 14px", borderRadius: 12, background: "var(--surface-2)", border: `1px solid ${o.bd}`, boxShadow: "0 10px 26px rgba(0,0,0,.25)", fontSize: 12.5, flexWrap: "nowrap", animation: "arch-in .18s var(--ease)" }}>
      <Glyph name={o.g} size={16} color={o.gc} />
      <span title={typeof o.text === "string" ? o.text : undefined} style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.text}</span>
      {o.chips && ([[t("Added"), "var(--success)"], [t("Changed"), "var(--warning)"], [t("Removed"), "var(--danger)"]] as const).map(([l, col]) => <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: col, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: col }} />{l}</span>)}
      {o.btns}
    </div>
  );
  const cb = paste ? { text: t("Looks like a {kind}. Convert to a Lumen diagram?", { kind: t(PASTE_LABEL[paste.kind]) }), c: "var(--text)", btns: <><Btn h={26} onClick={keepPaste}>{t("Keep as text")}</Btn><Btn h={26} pri onClick={convertPaste}>{t("Convert")}</Btn></> }
    : tab === "Code" && errors.length ? { text: t("Syntax error on line {n}. Showing the last valid diagram.", { n: errors[0].line }), c: "var(--danger)", btns: null }
    : tab === "Mermaid" && mmErr ? { text: mmErr, c: "var(--danger)", btns: null } : tab === "JSON" && jsErr ? { text: jsErr, c: "var(--danger)", btns: null } : null;
  const errText = errors[0] ? `${/^Line \d+:/.test(errors[0].message) ? "" : t("Line {n}: ", { n: errors[0].line })}${errors[0].message} ${t("The canvas shows the last valid diagram.")}` : "";

  const codePane = (
    <div style={{ width: codeOnly || phone ? "auto" : codeW, flex: codeOnly || phone ? 1 : `0 0 ${codeW}px`, display: "flex", flexDirection: "column", borderInlineStart: phone ? "none" : "1px solid var(--border)", background: "var(--surface)", minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
          {(["Code", "Mermaid", "JSON"] as Tab[]).map((l) => <button key={l} onClick={() => { setTab(l); setMmEdit(null); setJsEdit(null); setMmErr(null); setJsErr(null); }} style={{ height: 26, padding: "0 10px", borderRadius: 6, display: "flex", alignItems: "center", fontSize: 12, background: l === tab ? "var(--surface)" : "transparent", color: l === tab ? "var(--text)" : "var(--muted)", fontWeight: l === tab ? 600 : 400 }}>{t(l)}</button>)}
        </div>
        {tab === "Mermaid" && <select value={flavor} onChange={(e) => { setFlavor(e.target.value as MermaidFlavor); setMmEdit(null); }} aria-label={t("Mermaid type")} style={{ height: 26, fontSize: 11.5, background: "transparent", color: "var(--muted)", border: "none", outline: "none" }}>{MERMAID_FLAVORS.map((f) => <option key={f} value={f}>{f}</option>)}</select>}
        <span style={{ flex: 1, minWidth: 0 }} />
        <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{tab === "Code" && errors.length ? t("{n} error|{n} errors", { n: errors.length }) : t("Synced with canvas")}</span>
        <button onClick={format} className="hover:bg-surface-2" style={{ height: 26, padding: "0 9px", borderRadius: 7, border: "1px solid var(--border)", display: "flex", alignItems: "center", fontSize: 11.5 }}>{t("Format")}</button>
        <button onClick={() => void copyMermaid()} className="hover:bg-surface-2" style={{ height: 26, padding: "0 9px", borderRadius: 7, border: "1px solid var(--border)", display: "flex", alignItems: "center", fontSize: 11.5, whiteSpace: "nowrap" }}>{t("Copy Mermaid")}</button>
        {phone && <button onClick={() => setPhoneCode(false)} style={{ height: 26, padding: "0 9px", borderRadius: 7, background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>{t("Preview")}</button>}
      </div>
      {cb && <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 10px 0", padding: "8px 10px", borderRadius: 8, fontSize: 12, background: `color-mix(in srgb,${cb.c} 10%,transparent)`, color: cb.c, animation: "arch-in .16s var(--ease)" }}>{cb.text}<span style={{ flex: 1 }} />{cb.btns}</div>}
      {aiProp ? <ArchDiffCode p={aiProp.p} style={phone ? { position: "fixed", left: 0, right: 0, bottom: 0, height: "56%", borderRadius: "20px 20px 0 0", border: "1px solid var(--border)", zIndex: 90 } : { flex: 1 }} /> : tab === "Code" ? (
        <ArchCode key="dsl" lang="dsl" value={code} onChange={onCode} errors={paste ? [] : errors} band={band} onHoverLine={setHoverLine} onPaste={onPaste}
          names={[...doc.lineOf].map(([name, line]) => ({ name, line, icon: c.nodes.find((n) => nameOf(n) === name)?.lumenNode?.icon }))} />
      ) : tab === "Mermaid" ? <ArchCode key="mm" lang="mermaid" value={mmText} onChange={onMermaid} /> : <ArchCode key="js" lang="json" value={jsText} onChange={onJson} />}
      {tab === "Code" && errors.length > 0 && !paste && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--danger)" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", flexShrink: 0 }} />{errText}</div>}
      {reviewOpen && !phone && <ArchReviewPanel dsl={code} title={note.title} onClose={() => setReviewOpen(false)} onCreateNote={noteFromAi} style={{ position: "absolute", inset: 0, zIndex: 6 }} />}
      {hasProps && !reviewOpen && (
        <div style={{ position: "absolute", inset: 0, background: "var(--surface)", display: "flex", flexDirection: "column", boxShadow: "-12px 0 30px rgba(0,0,0,.25)", zIndex: 5, animation: "arch-slide .18s var(--ease)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{t("Properties")}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{selEdge ? t("Connection") : selNode && isGroup(selNode) ? t("Group") : t(selNode?.lumenNode?.kind ? selNode.lumenNode.kind[0].toUpperCase() + selNode.lumenNode.kind.slice(1) : "Service")}</span>
            <button aria-label={t("Close")} onClick={() => setSel(null)} style={{ color: "var(--muted)", padding: "0 4px" }}>×</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px", overflow: "auto" }}>
            {selNode && (isGroup(selNode) ? <GroupProps n={selNode} onChange={editNode} inside={insideCount(selNode.id)} /> : <NodeProps n={selNode} onChange={editNode} usedIn={usage.get(selNode.lumenNode?.ref ?? "") ?? 0} onReuse={() => makeReusable(selNode)} />)}
            {selEdge && <EdgeProps e={selEdge} onChange={editEdge} names={[displayOf(c.nodes.find((n) => n.id === selEdge.fromNode)!), displayOf(c.nodes.find((n) => n.id === selEdge.toNode)!)]} />}
          </div>
        </div>
      )}
    </div>
  );

  const layoutPop = (
    <Pop title={t("Layout")} sub="elkjs · layered" onClose={() => setPop(null)} style={phone ? { left: 0, right: 0, bottom: 0, animation: "arch-sheet .2s var(--ease)" } : { right: split === "canvas" ? 12 : 432, top: 8, width: 300, animation: "arch-in .16s var(--ease)" }} sheet={phone}>
      <Block items={[{ g: "layout-auto", l: t("Auto layout"), sub: MOD === "⌘" ? "⇧⌘L" : "Ctrl+Shift+L", on: true, onClick: () => void runLayout(lopts) }]} />
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
      <Block gap="2px" items={objHits.slice(0, 40).map((o, i) => ({ g: o.node.lumenNode?.icon ?? "service", l: displayOf(o.node), sub: o.ref ? (i === 0 ? t("Used in {n} diagram|Used in {n} diagrams", { n: o.used }) : t("Used in {n}", { n: o.used })) : o.noteTitle, on: i === objSel, mh: "40px", onClick: () => setObjSel(i) }))}
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
  /** Small popover on the label (46N): look, size, placement, rotation and visibility; the properties panel has the rest. */
  const labelPop = (() => {
    if (!selEdge) return null;
    const r = edgeRoute(c, selEdge, new Map(c.nodes.map((n) => [n.id, n]))), box = canvasEl.current?.getBoundingClientRect();
    if (!r || !box) return null;
    const sp = labelSpot(selEdge, r, "mid"), sc = rf.flowToScreenPosition({ x: sp.x, y: sp.y });
    const left = Math.max(8, Math.min(box.width - 276, sc.x - box.left - 130)), top = Math.max(8, Math.min(box.height - 330, sc.y - box.top + 26));
    return (
      <Pop title={t("Label")} sub={selEdge.label ?? ""} sheet={phone} onClose={() => setLblPop(null)} style={phone ? { left: 0, right: 0, bottom: 0, maxHeight: "70%", animation: "arch-sheet .22s var(--ease)" } : { left, top, width: 264, maxHeight: "calc(100% - 16px)", animation: "arch-in .16s var(--ease)" }}>
        <Block gap="2px" items={[
          { g: "text", l: t("Edit text"), sub: t("double-click"), onClick: () => { setLblPop(null); setEditEdgeS({ id: selEdge.id, part: "mid" }); } },
          ...(selEdge.lumenEdge?.labelPos != null ? [{ g: "undo", l: t("Reset label position"), onClick: () => editEdge({ ...selEdge, lumenEdge: { ...selEdge.lumenEdge, labelPos: undefined } }) }] : []),
          { g: "trash", l: t("Delete connection"), sub: "Del", onClick: () => { setLblPop(null); removeSel(); } },
        ]} />
        <LabelOptions e={selEdge} onChange={editEdge} pop />
      </Pop>
    );
  })();
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
    <div ref={rootEl} className={connecting ? "arch-flow connecting" : "arch-flow"} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "var(--bg)", fontFamily: "Inter,'IBM Plex Sans Arabic',system-ui,sans-serif", fontSize: 13, color: "var(--text)", display: "flex", flexDirection: "column" }}>
      <style>{FLOW_CSS}</style>
      {/* header */}
      {present === null && (
        <div style={{ height: phone ? 56 : 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid var(--border)", boxSizing: "border-box" }}>
          {phone && <button aria-label={t("Back")} onClick={back} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>‹</button>}
          {!phone && <span style={{ color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>{space?.name ?? ""}{folder ? ` / ${folder.name}` : ""} /</span>}
          <div style={{ display: "flex", flexDirection: phone ? "column" : "row", gap: phone ? 0 : 10, minWidth: phone ? 0 : 110, flex: phone ? 1 : "0 1 auto", alignItems: phone ? "flex-start" : "center" }}>
            <TitleEdit note={note} />
            {savedLine}
          </div>
          {!phone && (chain.length > 1 || kind === "c4") && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "var(--surface-2)", whiteSpace: "nowrap", color: "var(--muted)", minWidth: 0, overflow: "hidden", flexShrink: 1 }}>
              {(["context", "container", "component"] as const).map((lv, i) => {
                const hit = chain.find((x) => x.level === lv), cur = hit?.note.id === note.id;
                const sep = i < 2 ? " ›" : "";
                return cur ? <span key={lv}><b style={{ color: "var(--text)" }}>{t(C4_LABEL[lv])}</b>{sep}</span>
                  : hit ? <button key={lv} onClick={() => openNote(hit.note.id)} className="hover:text-[var(--text)]" style={{ color: "var(--muted)" }}>{t(C4_LABEL[lv])}{sep}</button>
                  : <span key={lv} title={t("Double-click a container to go one level deeper")}>{t(C4_LABEL[lv])}{sep}</span>;
              })}
            </span>
          )}
          {!phone && <span style={{ flex: 1 }} />}
          {phone ? (
            <><H g="code" onClick={() => setPhoneCode(true)} title={t("Code")} /><H g="more" onClick={() => setPop(pop === "more" ? null : "more")} title={t("More")} /></>
          ) : (
            <>
              {interview && <H g="c-question" l={t("Reveal labels ⌥R")} onClick={revealAll}><span style={{ fontSize: 11, color: "var(--muted)" }}>{`${[...revealed].filter((id) => c.nodes.some((n) => n.id === id)).length} / ${maskable}`}</span></H>}
              <H g="layout-auto" l={t("Layout ▾")} onClick={() => setPop(pop === "layout" ? null : "layout")} />
              <span style={{ height: 32, padding: "0 10px", borderRadius: 8, display: "flex", alignItems: "center", border: "1px solid transparent" }}>
                <span style={{ display: "flex", gap: 2, padding: 2, borderRadius: 7, background: "var(--surface-2)" }}>
                  {([["canvas", "canvas", t("Canvas only")], ["50", "split-view", t("Canvas and code")], ["code", "code", t("Code only")]] as const).map(([s, g, l]) => (
                    <button key={s} title={l} aria-label={l} aria-pressed={split === s} onClick={() => setSplit(s)} style={{ width: 26, height: 22, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", background: split === s ? "var(--surface)" : "transparent", color: split === s ? "var(--accent)" : "var(--muted)" }}><Glyph name={g} size={15} /></button>
                  ))}
                </span>
              </span>
              <H g="c-question" l={t("Review")} onClick={review} />
              <H g="present" l={t("Present")} onClick={() => { setSel(null); setPresenting(true); }} />
              <H g="export" l={t("Export")} onClick={doExport} />
              <H g="link" l={t("Share")} pri onClick={() => setShare(true)} />
              <H g="more" onClick={() => setPop(pop === "more" ? null : "more")} title={t("More")} />
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        {!phone && !codeOnly && present === null && libDocked && (
          <div style={{ width: 260, flexShrink: 0, borderInlineEnd: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <LibraryPanel workspace="architecture" variant="docked" onPlace={placeItem} />
          </div>
        )}
        {(!codeOnly || phone) && !(phone && phoneCode) && (
          <div ref={canvasEl} style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
            <Ctx.Provider value={flowCtx}>
              <ReactFlow<FlowNode, FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
                onNodeDragStart={() => { dragStart.current = new Map(cRef.current.nodes.map((n) => [n.id, { x: n.x, y: n.y }])); }} onNodeDragStop={onDragStop}
                onNodeClick={(_, n) => { if (n.id.startsWith("lp-")) return; if (interview) setRevealed((r) => (r.has(n.id) ? r : new Set(r).add(n.id))); if (connectFrom && connectFrom !== n.id) { onConnect({ source: connectFrom, target: n.id, sourceHandle: null, targetHandle: null }); setConnectFrom(null); return; } if (_.shiftKey && !phone) { const cur = selection(); const has = cur.nodes.includes(n.id); const nodes = has ? cur.nodes.filter((x) => x !== n.id) : [...cur.nodes, n.id]; setSelS(null); setMulti({ nodes, edges: cur.edges }); return; } if (Date.now() - longAt.current < 900) return; /* the lift after a long-press: its menu stays */ setSel({ kind: "node", id: n.id }); if (phone && !isGroup(cRef.current.nodes.find((x) => x.id === n.id) ?? ({} as ANode))) setPop("props"); /* phone: one tap opens Properties (46P) */ }}
                onNodeDoubleClick={(e, n) => void onNodeDouble(e, n)} onEdgeClick={(_, e) => { setSel({ kind: "edge", id: e.id }); setLblPop(null); }} onEdgeDoubleClick={(_, e) => { if (!diff && present === null) { setSel({ kind: "edge", id: e.id }); setEditEdgeS({ id: e.id, part: "mid" }); } }} onPaneClick={() => { setLibOver(false); setSel(null); setEditing(null); setLblPop(null); setEditEdgeS(null); }}
                edgesReconnectable={false} onConnectStart={() => setConnecting(true)} onEdgeContextMenu={(ev, e) => { ev.preventDefault(); if (frozen || present !== null) return; setSel({ kind: "edge", id: e.id }); setLblPop(e.id); }}
                onNodeContextMenu={(e, n) => { e.preventDefault(); if (n.id.startsWith("lp-")) return; setSel({ kind: "node", id: n.id }); setMenuFor(n.id); setPop("menu"); }}
                onPaneContextMenu={(e) => { e.preventDefault(); setPop("insert"); }}
                onConnect={onConnect} onConnectEnd={(ev, st) => { setConnecting(false); onConnectEnd(ev, st); }} connectionMode={ConnectionMode.Loose} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode="Shift"
                fitView={!fitOnce.current} onInit={() => { fitOnce.current = true; setTimeout(topAlign, 30); }} onMoveStart={(ev) => { if (ev) { userMoved.current = true; setLblPop(null); } }} fitViewOptions={FIT} minZoom={0.15} maxZoom={2.5} proOptions={{ hideAttribution: true }} nodesConnectable={!diff && present === null} elevateEdgesOnSelect>
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="color-mix(in srgb,var(--muted) 20%,transparent)" />
                {!phone && present === null && <MiniMap pannable zoomable style={{ width: 150, height: 96, right: 0, bottom: 0 }} nodeColor={(n) => (n.type === "archGroup" ? "transparent" : "color-mix(in srgb,var(--accent) 35%,transparent)")} nodeStrokeColor={(n) => (n.type === "archGroup" ? "var(--accent)" : "transparent")} maskColor="color-mix(in srgb,var(--bg) 55%,transparent)" />}
              </ReactFlow>
            </Ctx.Provider>
            {!phone && present === null && !libDocked && (libOver ? (
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 260, zIndex: 25, borderInlineEnd: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "12px 0 30px rgba(0,0,0,.25)", animation: "arch-in .16s var(--ease)" }}>
                <button aria-label={t("Close")} onClick={() => setLibOver(false)} style={{ position: "absolute", right: 8, top: 10, zIndex: 2, color: "var(--muted)", width: 24, height: 24 }}>×</button>
                <LibraryPanel workspace="architecture" variant="docked" onPlace={(it) => { placeItem(it); setLibOver(false); }} />
              </div>
            ) : (
              <button onClick={() => setLibOver(true)} title={t("Library")} style={{ position: "absolute", left: 12, top: 12, zIndex: 6, height: 32, padding: "0 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12.5 }}><Glyph name="library" size={16} />{t("Library")}</button>
            ))}
            {!phone && present === null && (
              <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)", zIndex: 5 }}>
                {(["sync", "async", "data", "control"] as const).map((k) => <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><svg width="22" height="6"><path d="M1 3H21" style={{ stroke: EDGE_STYLE[k][0], strokeWidth: 2, strokeDasharray: EDGE_STYLE[k][1] }} /></svg>{t(EDGE_STYLE[k][2])}</span>)}
              </div>
            )}
            {preview && bar({ g: "layout-auto", gc: "var(--accent)", bd: "var(--accent)", text: t("Preview: auto layout · {dir} · {spacing} · {keep}", { dir: t(lopts.direction), spacing: t(lopts.spacing), keep: lopts.keep ? t("keep my positions") : t("re-layout all") }), btns: <><Btn onClick={cancelLayout}>{t("Cancel")}</Btn><Btn pri onClick={applyLayout}>{t("Apply")}</Btn></> })}
            {!preview && diff && vd && bar({ g: "diff", gc: "var(--muted)", bd: "var(--border)", chips: true, text: diff.label, btns: <><Btn onClick={() => void openVersions()}>{t("Pick versions ▾")}</Btn><Btn onClick={() => { void restoreVersion(diff.v).then(() => { setDiff(null); toast(t("Restored v{n}", { n: diff.n }), undefined, { icon: "history" }); }); }}>{t("Restore v{n}", { n: diff.n })}</Btn></> })}
            {!preview && !diff && aiProp && <ArchDiffBar p={aiProp.p} counts={vd?.counts} onAccept={aiAccept} onReject={aiReject} style={{ position: "absolute", left: 12, right: 12, top: 12, zIndex: 20 }} />}
            {!preview && !diff && !aiProp && c4parent && bar({ g: "c4-level", gc: "var(--muted)", bd: "var(--border)", text: t("{level} view of {name}. Double-click any container to go one level deeper.", { level: t(C4_LABEL[c.lumenArch.c4!.level]), name: c4parentNode ? displayOf(c4parentNode) : c4parent.title }), btns: <Btn onClick={() => openNote(c4parent.id)}>{t("‹ Back to {level}", { level: t(C4_LABEL[(() => { const pc = parseArch(c4parent.body); return pc ? c4LevelOf(pc) : "context"; })()]) })}</Btn> })}
            {connectFrom && bar({ g: "connector", gc: "var(--accent)", bd: "var(--accent)", text: t("Tap the node to connect to."), btns: <Btn onClick={() => setConnectFrom(null)}>{t("Cancel")}</Btn> })}
            {present !== null && (
              <div style={{ position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 10px 26px rgba(0,0,0,.25)", zIndex: 20 }}>
                <Btn onClick={() => setPresent((p) => Math.max(0, (p ?? 0) - 1))}>‹</Btn>
                <span style={{ fontSize: 12.5, minWidth: 120, textAlign: "center" }}>{(() => { const g = c.nodes.find((n) => n.id === steps[Math.min(present, steps.length - 1)]); return g ? displayOf(g) : t("Whole diagram"); })()} · {Math.min(present, steps.length - 1) + 1}/{steps.length}</span>
                <Btn onClick={() => setPresent((p) => Math.min(steps.length - 1, (p ?? 0) + 1))}>›</Btn>
                <Btn pri onClick={() => setPresent(null)}>{t("Exit")}</Btn>
              </div>
            )}
            {lblPop && selEdge?.id === lblPop && present === null && !frozen && labelPop}
          </div>
        )}
        {(showCode || (phone && phoneCode)) && present === null && codePane}
        {pop === "layout" && layoutPop}
        {pop === "insert" && insertPop}
        {pop === "versions" && versionsPop}
        {phone && pop === "library" && (
          // the library's own sheet (one header, one close), not wrapped in a second popover
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "78%", display: "flex", flexDirection: "column", zIndex: 40, animation: "arch-sheet .22s var(--ease)" }}>
            <LibraryPanel workspace="architecture" variant="sheet" onClose={() => setPop(null)} onPlace={(it) => { placeItem(it); setPop(null); }} />
          </div>
        )}
        {phone && pop === "props" && selNode && !isGroup(selNode) && (
          <Pop title={displayOf(selNode)} sub={t(selNode.lumenNode?.kind ?? "service")} sheet onClose={() => setPop(null)} style={{ left: 0, right: 0, bottom: 0, maxHeight: "70%", animation: "arch-sheet .22s var(--ease)" }}>
            <NodeProps phone n={selNode} onChange={editNode} usedIn={usage.get(selNode.lumenNode?.ref ?? "") ?? 0} onReuse={() => makeReusable(selNode)} />
          </Pop>
        )}
        {pop === "more" && (
          <Pop title={note.title} sub={t("Diagram")} sheet={phone} onClose={() => setPop(null)} style={phone ? { left: 0, right: 0, bottom: 0, animation: "arch-sheet .22s var(--ease)" } : { right: 12, top: 52, width: 260 }}>
            <Block gap="0" items={([["reused-object", t("Insert existing object"), () => setPop("insert")], ["assistant", t("Describe a system"), () => openAi("describe")], ["assistant", t("Edit by instruction"), () => openAi("edit")], ["diff", t("Compare versions"), () => void openVersions()], ["switch", t("Convert…"), () => { setPop(null); setConvOpen(true); }], ["c-question", t("Review"), review], ["present", t("Present"), () => { setPop(null); setSel(null); setPresenting(true); }], ["export", t("Export"), () => { setPop(null); doExport(); }], ["link", t("Share"), () => { setPop(null); setShare(true); }], ["trash", t("Move to trash"), () => { setPop(null); void deleteDiagram(); }]] as const).map(([g, l, fn]) => ({ g, l, mh: "44px", onClick: fn }))} />
          </Pop>
        )}
        {(pop === "menu" || pop === "connectTo" || pop === "moveTo" || pop === "sendTo") && menuPop}
        {keysOpen && (
          <Pop title={t("Keyboard shortcuts")} sub="?" sheet={phone} onClose={() => setKeysOpen(false)} style={phone ? { left: 0, right: 0, bottom: 0, maxHeight: "80%" } : { left: "50%", top: 12, width: 380, transform: "translateX(-50%)", maxHeight: "calc(100% - 24px)", animation: "arch-in .16s var(--ease)" }}>
            <Block gap="0" items={([[t("Undo"), `${MOD} Z`], [t("Redo"), `${MOD} Shift Z · ${MOD} Y`], [t("Delete selected"), "Delete · Backspace"], [t("Duplicate"), `${MOD} D`], [t("Copy / cut / paste"), `${MOD} C · X · V`], [t("Select all"), `${MOD} A`], [t("Select several"), t("Shift click")], [t("Nudge (bigger step with Shift)"), "← ↑ → ↓"], [t("Rename node · edit edge label"), "Enter · F2"], [t("Group · ungroup"), `${MOD} G · ${MOD} Shift G`], [t("Deselect · close"), "Esc"], [t("Auto layout"), `${MOD} Shift L`], [t("Fit the diagram"), "Shift 1"], [t("Keyboard shortcuts"), "?"]] as const).map(([l, k]) => ({ l, sub: k, mh: "30px" }))} />
          </Pop>
        )}
        {presenting && <ArchPresenter arch={c} title={note.title} noteId={note.id} spaceId={note.spaceId} phone={phone} onExit={() => setPresenting(false)} />}
        {convOpen && <ConvertMenu source={() => sourceOf({ ...note, body: stringifyArch(cRef.current) })} phone={phone} onClose={() => setConvOpen(false)} />}
      </div>
      {phone && !phoneCode && present === null && (
        <div style={{ height: 94, flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "flex-start", justifyContent: "space-around", paddingTop: 8 }}>
          {([["library", t("Library"), () => setPop(pop === "library" ? null : "library"), pop === "library"], ["connector", t("Connect"), () => { if (sel?.kind === "node") setConnectFrom(sel.id); else toast(t("Select a node first, then tap Connect.")); }, !!connectFrom], ["code", t("Code"), () => setPhoneCode(true), false], ["layout-auto", t("Layout"), () => { setPop("layout"); void runLayout(lopts); }, pop === "layout"], ["more", "⋯", () => setPop(pop === "more" ? null : "more"), pop === "more"]] as const).map(([g, l, fn, on]) => (
            <button key={g} onClick={fn} style={{ width: 64, height: 52, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 10.5, background: on ? AC : "transparent", color: on ? "var(--accent)" : "var(--text)" }}><Glyph name={g} size={22} />{l}</button>
          ))}
        </div>
      )}
      <LongPress onLong={(id) => { longAt.current = Date.now(); setSel({ kind: "node", id }); setMenuFor(id); setPop("menu"); }} root={canvasEl} enabled={phone} />
      {ai && <ArchAIPanel slotted mode={ai} dsl={code} title={note.title} phone={phone} onProposal={onAiProposal} onApplyDsl={() => {}} onCreateNote={noteFromAi} onClose={() => { if (!aiProp) setAi(null); }} />}
      {reviewOpen && phone && <ArchReviewPanel ph dsl={code} title={note.title} onClose={() => setReviewOpen(false)} onCreateNote={noteFromAi} style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "86%", minHeight: "60%", borderRadius: "20px 20px 0 0", border: "1px solid var(--border)", zIndex: 90 }} />}
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
