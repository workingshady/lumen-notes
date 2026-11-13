import { CircleCheck, Info, Network, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createNote } from "../lib/actions";
import { go, openNote, useUI, useVault } from "../lib/store";
import { cx } from "./ui";

type Kind = "canvas" | "whiteboard" | "graph";
const KINDS: { k: Kind; e: string; n: string; u: string; f: string; ed: string; cta: string }[] = [
  { k: "canvas", e: "🧩", n: "Canvas", u: "you want cards — notes, text, links — arranged and connected by arrows.", f: ".canvas · JSON Canvas 1.0", ed: "Drag & drop · JSON · script · REST API", cta: "Create canvas" },
  { k: "whiteboard", e: "🖍️", n: "Whiteboard", u: "you want to sketch freely — pen, shapes, stickies, frames, images.", f: ".excalidraw", ed: "Draw · JSON · script · Mermaid → shapes · REST", cta: "Create whiteboard" },
  { k: "graph", e: "", n: "Graph from note", u: "you want to see how a note connects to everything else.", f: "Generated · not stored", ed: "Filters only", cta: "Open graph" },
];

/** Silhouette previews drawn from primitives, in a 280×150 design space scaled to the box. */
function shapes(kind: Kind, W: number, H: number): CSSProperties[] {
  const sx = W / 280, sy = H / 150;
  const R = (x: number, y: number, w: number, h: number, o: { f?: string; b?: string; r?: string; t?: string } = {}): CSSProperties => ({ left: x * sx, top: y * sy, width: w * sx, height: h * sy, background: o.f ?? "var(--surface)", border: o.b ?? "1px solid var(--border)", borderRadius: o.r ?? 6, transform: o.t });
  const L = (x1: number, y1: number, x2: number, y2: number, c = "var(--muted)"): CSSProperties => {
    const X1 = x1 * sx, Y1 = y1 * sy, X2 = x2 * sx, Y2 = y2 * sy;
    return { left: X1, top: Y1, width: Math.hypot(X2 - X1, Y2 - Y1), height: 1.5, background: c, borderRadius: 1, transform: `rotate(${Math.atan2(Y2 - Y1, X2 - X1)}rad)`, transformOrigin: "0 50%" };
  };
  const tint = (c: string) => ({ b: `1.5px solid ${c}`, f: `color-mix(in srgb,${c} 14%,var(--surface))` });
  if (kind === "canvas") return [L(110, 48, 160, 48), L(205, 70, 205, 98), R(30, 26, 80, 46), R(160, 24, 90, 46, tint("#A371F7")), R(150, 98, 110, 34), R(30, 92, 90, 40, tint("#39C5CF"))];
  if (kind === "whiteboard") return [R(30, 30, 64, 58, { f: "#fff3bf", b: "none", r: "2px", t: "rotate(-4deg)" }), R(104, 36, 64, 58, { f: "#d0ebff", b: "none", r: "2px", t: "rotate(3deg)" }), R(60, 92, 64, 46, { f: "#ffc9c9", b: "none", r: "2px", t: "rotate(-2deg)" }), R(190, 30, 62, 62, { f: "transparent", b: "2px solid var(--text)", r: "50%" }), L(160, 112, 200, 104, "var(--text)"), L(200, 104, 240, 118, "var(--text)")];
  const N = [[60, 40], [120, 70], [200, 40], [230, 100], [150, 120], [70, 110], [180, 80]];
  const E = [[0, 1], [1, 2], [1, 4], [2, 3], [4, 5], [1, 6], [6, 3]];
  const C = ["#39C5CF", "var(--text)", "#E8893A", "#E8893A", "#A371F7", "#A371F7", "#57AB5A"];
  return [...E.map(([a, b]) => L(N[a][0], N[a][1], N[b][0], N[b][1])), ...N.map(([x, y], i) => { const d = i === 1 ? 16 : i === 6 ? 11 : 8; return { left: x * sx - d / 2, top: y * sy - d / 2, width: d, height: d, background: C[i], borderRadius: "50%" }; })];
}

function Preview({ kind, w, h, className }: { kind: Kind; w: number; h: number; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden bg-bg", className)} style={{ width: w, height: h }}>
      {shapes(kind, w, h).map((s, i) => <div key={i} className="absolute" style={s} />)}
    </div>
  );
}

export function NewVisualChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const [sel, setSel] = useState(0);
  const selRef = useRef(0);
  selRef.current = sel;
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const space = v.spaceMap.get(spaceId);
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const canGraph = !!ui.noteId;

  async function create(i = sel) {
    const k = KINDS[i].k;
    onClose();
    if (k === "graph") {
      // GraphView is lazy-loaded; hand it the "start local" request through sessionStorage.
      try { if (ui.noteId) sessionStorage.setItem("lumen.graphLocal", ui.noteId); } catch { /* ignore */ } // no note open → the whole graph
      go("graph");
      return;
    }
    const n = await createNote({ template: k, spaceId, folderId: ui.spaceId === "all" ? null : ui.folderId });
    openNote(n.id);
  }

  useEffect(() => {
    if (!open) return;
    setSel(0);
    const openedAt = performance.now();
    const key = (e: KeyboardEvent) => {
      if (e.timeStamp <= openedAt) return; // the Enter that opened us (palette) is still bubbling
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(KINDS.length - 1, s + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); void create(selRef.current); }
      else if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const where = [space ? `${space.icon ?? ""} ${space.name}`.trim() : "", folder?.name].filter(Boolean).join(" / ");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.62)] text-[14px] md:items-center md:text-[13px] fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="New visual workspace" className="sheet-in safe-b flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-[14px] bg-surface md:w-[960px] md:max-w-[calc(100vw-32px)] md:rounded-[14px] md:border md:border-line">
        <div className="flex justify-center pb-1 pt-2.5 md:hidden"><button aria-label="Close" onClick={onClose} className="h-1 w-9 rounded-[2px] bg-line" /></div>
        {/* Desktop header */}
        <div className="hidden items-center px-6 pb-1.5 pt-5 md:flex">
          <span className="flex-1 text-[18px] font-[650]">New visual workspace</span>
          {where && <span className="mr-3.5 text-[12px] text-muted">in {where}</span>}
          <button aria-label="Close" onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="hidden px-6 pb-[18px] text-muted md:block">Pick by what you want to do with your hands.</div>
        {/* Phone header */}
        <div className="flex flex-col gap-0.5 px-5 pb-3.5 pt-2 md:hidden">
          <span className="text-[18px] font-[650]">New…</span>
          {where && <span className="text-[12.5px] text-muted">in {folder?.name ?? where}</span>}
        </div>
        <div className="flex flex-col gap-2.5 px-4 md:grid md:grid-cols-3 md:gap-3.5 md:px-6">
          {KINDS.map((k, i) => {
            const on = sel === i;
            return (
              <button key={k.k} onClick={() => setSel(i)} onDoubleClick={() => create(i)}
                className={cx("box-border flex items-center gap-3.5 overflow-hidden rounded-[14px] p-3 text-left md:flex-col md:items-stretch md:gap-0 md:p-0", on ? "border-[1.5px] border-accent" : "border border-line")}
                style={{ background: on ? "color-mix(in srgb,var(--accent) 6%,var(--surface))" : "var(--surface)", boxShadow: on ? "0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)" : "none" }}>
                <Preview kind={k.k} w={96} h={80} className="shrink-0 rounded-[10px] border border-line md:hidden" />
                <div className="relative hidden h-[150px] overflow-hidden border-b border-line md:block"><PreviewFill kind={k.k} /></div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 md:gap-2 md:px-4 md:pb-[18px] md:pt-4">
                  <div className="flex items-center gap-2">
                    <span className="hidden md:contents">{k.e ? <span className="text-[18px] leading-none">{k.e}</span> : <Network size={18} className="text-muted" />}</span>
                    <span className="font-[650] md:text-[15px]"><span className="md:hidden">{k.e ? k.e + " " : ""}</span>{k.n}</span>
                    <span className="flex-1" />
                    {on && <CircleCheck size={17} className="hidden text-accent md:block" />}
                  </div>
                  <span className="text-[13px] leading-[18px] text-muted md:text-[13px] md:leading-[19px] md:text-ink"><span className="hidden text-muted md:inline">Use it when </span>{k.u}</span>
                  <span className="font-mono text-[11px] font-medium text-muted md:hidden">{k.f}</span>
                  <div className="hidden flex-col gap-1 border-t border-line pt-2 text-[12px] text-muted md:flex">
                    <span className="font-mono text-ink">{k.f}</span>
                    <span>{k.k === "graph" && !canGraph ? "Opens the whole graph (no note open)" : k.ed}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 px-4 pb-3 pt-4 md:px-6 md:py-[18px]">
          <Info size={14} className="hidden shrink-0 text-muted md:block" />
          <span className="hidden flex-1 text-[12.5px] text-muted md:block">You can convert later: note outline → canvas, canvas → whiteboard, Mermaid → whiteboard.</span>
          <button className="hidden h-9 items-center rounded-[10px] px-3.5 text-muted hover:text-ink md:flex" onClick={onClose}>Cancel</button>
          <button className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg hover:brightness-110 md:h-9 md:flex-none md:rounded-[10px] md:px-4 md:text-[13px]" onClick={() => create()}>
            {KINDS[sel].cta} <span className="hidden font-mono text-[11px] font-medium opacity-65 md:inline">↵</span>
          </button>
        </div>
        <div className="flex h-6 items-center justify-center md:hidden"><span className="h-1 w-[108px] rounded-full bg-muted opacity-45" /></div>
      </div>
    </div>
  );
}

/** Desktop card preview: fills the card width (shapes laid out for 296×150 like the design). */
function PreviewFill({ kind }: { kind: Kind }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(296);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  return <div ref={ref} className="absolute inset-0 bg-bg">{shapes(kind, w, 150).map((st, i) => <div key={i} className="absolute" style={st} />)}</div>;
}
