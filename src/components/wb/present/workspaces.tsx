// 41F: the same presenter for the canvas (steps = groups; the camera fits each group) and the architecture studio
// (steps = layers revealed one by one, groups, or C4 levels). Mount (owners of those editors):
//   canvas:        {presenting && <CanvasPresenter canvas={data} notes={vaultNotes} title={note.title} noteId={note.id} spaceId={note.spaceId} onExit={() => setPresenting(false)} />}
//   architecture:  {presenting && <ArchPresenter arch={c} title={note.title} noteId={note.id} spaceId={note.spaceId} onExit={() => setPresenting(false)} />}
import { useEffect, useMemo, useState } from "react";
import type { JsonCanvas, Note } from "../../../../shared/types";
import { t } from "../../../lib/i18n";
import { DIAGRAM_EXPORT_DEFAULTS, type DiagramExportPrefs } from "../../../lib/settings";
import { Presenter, type PresenterStep } from "./Presenter";

const PREFS: DiagramExportPrefs = { ...DIAGRAM_EXPORT_DEFAULTS, background: "transparent", padding: 0, theme: "app" };
type Box = { x: number; y: number; width: number; height: number };
const rectOf = (n: Box, pad = 24) => ({ x: n.x - pad, y: n.y - pad, w: n.width + pad * 2, h: n.height + pad * 2 });
const bounds = (ns: Box[]) => { const x = Math.min(...ns.map((n) => n.x)), y = Math.min(...ns.map((n) => n.y)); return { x, y, width: Math.max(...ns.map((n) => n.x + n.width)) - x, height: Math.max(...ns.map((n) => n.y + n.height)) - y }; };
const readingOrder = <T extends Box>(a: T, b: T) => (Math.abs(a.y - b.y) > 80 ? a.y - b.y : a.x - b.x);

/** Canvas: groups in reading order (a canvas without groups presents as one step). */
export function CanvasPresenter({ canvas, notes = [], title, noteId, spaceId, onExit, phone }: { canvas: JsonCanvas; notes?: Note[]; title: string; noteId: string; spaceId: string; onExit: () => void; phone?: boolean }) {
  const [svg, setSvg] = useState<{ html: string; x0: number; y0: number; w: number; h: number } | null>(null);
  const nodes = canvas.nodes ?? [];
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!nodes.length) return;
      const { canvasSvg } = await import("../../../lib/visual-export");
      const b = await canvasSvg(canvas, notes, PREFS, { cardStyle: true, groupLabels: true, edgeLabels: true });
      const all = bounds(nodes as Box[]);
      if (live) setSvg({ html: b.svg.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<svg\b/, `<svg style="display:block"`), x0: all.x, y0: all.y, w: b.width, h: b.height });
    })();
    return () => { live = false; };
  }, [canvas]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps: PresenterStep[] = useMemo(() => {
    const groups = (nodes as (Box & { id: string; type: string; label?: string })[]).filter((n) => n.type === "group").sort(readingOrder);
    if (groups.length) return groups.map((g, i) => ({ id: g.id, label: g.label || t("Group {n}", { n: i + 1 }), rect: rectOf(g) }));
    return nodes.length ? [{ id: "all", label: title, rect: rectOf(bounds(nodes as Box[]), 40) }] : [];
  }, [nodes, title]);
  if (!steps.length) return null;
  return <Presenter steps={steps} phone={phone} remote={{ noteId, spaceId, title }} onExit={onExit}
    counter={(i, n, s) => (s.id === "all" ? title : t("Group {n} of {total}", { n: i + 1, total: n }))}
    scene={svg ? { node: <div dangerouslySetInnerHTML={{ __html: svg.html }} />, x0: svg.x0, y0: svg.y0, w: svg.w, h: svg.h } : undefined}
    renderStep={svg ? undefined : () => null} />;
}

type ANode = Box & { id: string; type: string; label?: string; lumenNode?: { kind?: string; name?: string; zoom?: string; parent?: string }; lumenGroup?: { kind: string; name?: string; parent?: string } };
type ArchLike = Omit<JsonCanvas, "nodes" | "edges"> & { nodes: ANode[]; edges: { id: string; fromNode: string; toNode: string }[]; lumenArch: { direction?: "right" | "down"; c4?: { level: string } } };
type Mode = "layers" | "groups" | "c4";

/** Architecture studio: Layers (bands along the flow, revealed one by one) · Groups · C4 levels. */
export function ArchPresenter({ arch, title, noteId, spaceId, onExit, phone, mode: mode0 = "layers" }: { arch: ArchLike; title: string; noteId: string; spaceId: string; onExit: () => void; phone?: boolean; mode?: Mode }) {
  const [mode, setMode] = useState<Mode>(mode0);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const nodes = arch.nodes.filter((n) => n.type !== "group");
  const groups = arch.nodes.filter((n) => n.type === "group" && !n.lumenGroup?.parent).sort(readingOrder);
  const down = arch.lumenArch?.direction === "down";
  // Layers: cluster nodes into bands across the flow direction (columns for →, rows for ↓)
  const layers = useMemo(() => {
    const key = (n: ANode) => (down ? n.y : n.x);
    const sorted = [...nodes].sort((a, b) => key(a) - key(b));
    const bands: ANode[][] = [];
    for (const n of sorted) { const b = bands[bands.length - 1]; if (b && key(n) - key(b[0]) < (down ? 60 : 90)) b.push(n); else bands.push([n]); }
    return bands;
  }, [arch]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (n: ANode) => n.lumenNode?.name || n.lumenGroup?.name || n.label || n.lumenNode?.kind || "";
  const steps: PresenterStep[] = useMemo(() => {
    if (mode === "groups" && groups.length) return groups.map((g, i) => ({ id: g.id, label: name(g) || t("Group {n}", { n: i + 1 }), rect: rectOf(g) }));
    if (mode === "c4") {
      const zoomable = nodes.filter((n) => n.lumenNode?.zoom).sort(readingOrder);
      return [{ id: "ctx", label: t("Context"), rect: rectOf(bounds(arch.nodes), 40) }, ...zoomable.map((n) => ({ id: n.id, label: t("Container · {name}", { name: name(n) }), rect: rectOf(n, 60) }))];
    }
    return layers.map((b, i) => { const kinds = [...new Set(b.map((n) => n.lumenNode?.kind).filter(Boolean))]; return { id: "L" + i, label: kinds.length === 1 ? String(kinds[0]) : name(b[0]) || t("Layer {n}", { n: i + 1 }) }; });
  }, [mode, arch, layers]); // eslint-disable-line react-hooks/exhaustive-deps
  // one SVG per reveal step (layers mode) or one for the whole diagram (camera modes)
  useEffect(() => {
    let live = true;
    void (async () => {
      const { archSvg } = await import("../../../lib/arch-render");
      const out: Record<string, string> = {};
      const clean = (s: string) => s.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<svg\b/, `<svg style="display:block;width:100%;height:100%"`);
      if (mode === "layers") {
        for (let i = 0; i < layers.length; i++) {
          const keep = new Set(layers.slice(0, i + 1).flat().map((n) => n.id));
          const parents = new Set(arch.nodes.filter((g) => g.type === "group" && arch.nodes.some((n) => keep.has(n.id) && (n.lumenNode?.parent === g.id))).map((g) => g.id));
          const c = { ...arch, nodes: arch.nodes.filter((n) => keep.has(n.id) || parents.has(n.id)), edges: arch.edges.filter((e) => keep.has(e.fromNode) && keep.has(e.toNode)) };
          try { out["L" + i] = clean((await archSvg(c as never, PREFS)).svg); } catch { /* empty */ }
        }
      } else {
        try { const b = await archSvg(arch as never, PREFS); out.all = b.svg.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<svg\b/, `<svg style="display:block"`); out.w = String(b.width); out.h = String(b.height); } catch { /* empty */ }
      }
      if (live) setSvgs(out);
    })();
    return () => { live = false; };
  }, [arch, mode, layers]);
  if (!steps.length) return null;
  const all = bounds(arch.nodes);
  const counter = (i: number, n: number, s: PresenterStep) => (mode === "layers" ? t("Layer · {name}", { name: s.label }) : mode === "c4" ? t("C4 · {name}", { name: s.label }) : t("Group {n} of {total}", { n: i + 1, total: n }));
  return <Presenter key={mode} steps={steps} phone={phone} remote={{ noteId, spaceId, title }} onExit={onExit} counter={counter}
    modes={{ items: [["layers", t("Layers")], ["groups", t("Groups")], ["c4", t("C4 levels")]], value: mode, onChange: (v) => setMode(v as Mode) }}
    scene={mode !== "layers" && svgs.all ? { node: <div dangerouslySetInnerHTML={{ __html: svgs.all }} />, x0: all.x, y0: all.y - 12, w: Number(svgs.w), h: Number(svgs.h) } : undefined}
    renderStep={mode === "layers" || !svgs.all ? (i) => <div className="absolute inset-[4%]" dangerouslySetInnerHTML={{ __html: svgs["L" + i] ?? "" }} /> : undefined} />;
}
