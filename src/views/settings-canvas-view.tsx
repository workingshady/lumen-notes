import { FileText, Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JsonCanvas } from "../../shared/types";
import { unfurl, type Unfurl } from "../lib/api";
import { colorOf } from "../lib/canvas";
import { render } from "../lib/markdown";

/**
 * Read-only JSON Canvas for visitors (design: CanvasBoard in Lumen 10b R3-2P/2R): dot grid, groups with label pills,
 * text/file/link cards, labelled edges, minimap. Drag to pan, wheel/pinch to zoom.
 */
export type FileRef = { title: string; status: string | null; excerpt: string };
type Node = NonNullable<JsonCanvas["nodes"]>[number];
type Side = "top" | "right" | "bottom" | "left";

const STATUS: Record<string, string> = { todo: "var(--muted)", learning: "var(--info)", review: "var(--warning)", mastered: "var(--success)" };
const anchor = (n: Node, side: Side | undefined, other: Node): [number, number] => {
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
  let s = side;
  if (!s) { const dx = other.x + other.width / 2 - cx, dy = other.y + other.height / 2 - cy; s = Math.abs(dx) * n.height > Math.abs(dy) * n.width ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top"; }
  return s === "top" ? [cx, n.y] : s === "bottom" ? [cx, n.y + n.height] : s === "left" ? [n.x, cy] : [n.x + n.width, cy];
};

function TextCard({ n }: { n: Node & { text?: string } }) {
  const c = colorOf(n.color);
  const [title, body] = useMemo(() => {
    const t = (n.text ?? "").trim();
    const m = /^(#{1,6}\s+|\*\*)(.+?)(\*\*)?\s*(\n|$)/.exec(t);
    return m ? [m[2].replace(/\*\*$/, ""), t.slice(m[0].length)] : ["", t];
  }, [n.text]);
  // line breaks as typed (design: white-space pre-line)
  const html = useMemo(() => render(body.replace(/([^\n])\n(?=[^\n])/g, "$1  \n")), [body]);
  return (
    <div className="absolute box-border flex flex-col gap-1.5 overflow-hidden rounded-[10px] border px-3.5 py-3" style={{ left: n.x, top: n.y, width: n.width, height: n.height, background: c ? `color-mix(in srgb, ${c} 14%, var(--surface))` : "var(--surface)", borderColor: c ?? "var(--border)" }}>
      {title && <span dir="auto" className="text-[14px] font-[650]">{title}</span>}
      <div dir="auto" className="text-[13px] leading-[19px] opacity-85 [&_.katex]:text-[15px] [&_p]:m-0 [&_ul]:m-0 [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
function FileCard({ n, ref_ }: { n: Node & { file?: string }; ref_?: FileRef }) {
  const parts = (n.file ?? "").replace(/\.md$/, "").split("/");
  const title = ref_?.title ?? parts[parts.length - 1];
  const folder = parts.length > 1 ? parts[parts.length - 2] : "";
  const c = colorOf(n.color);
  return (
    <div className="absolute box-border flex flex-col rounded-[10px] border bg-surface" style={{ left: n.x, top: n.y, width: n.width, height: n.height, borderColor: c ?? "var(--border)" }}>
      <div className="flex h-[30px] shrink-0 items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted"><FileText size={12} /><span className="flex-1 truncate">{folder}</span>
        <span className="size-[7px] rounded-full" style={{ background: STATUS[ref_?.status ?? ""] ?? "var(--info)" }} /></div>
      <div className="flex flex-col gap-[5px] overflow-hidden px-3 py-2.5"><span dir="auto" className="text-[14px] font-[650]">{title}</span>{ref_?.excerpt && <span dir="auto" className="line-clamp-4 text-[12px] leading-[17px] text-muted">{ref_.excerpt}</span>}</div>
    </div>
  );
}
function LinkCard({ n }: { n: Node & { url?: string } }) {
  const [meta, setMeta] = useState<Unfurl | null>(null);
  useEffect(() => { if (n.url) void unfurl(n.url).then(setMeta); }, [n.url]);
  let host = n.url ?? "";
  try { const u = new URL(n.url ?? ""); host = (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, ""); } catch { /* keep raw */ }
  const initials = host.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  let h = 0; for (const ch of host.split(".")[0] ?? "") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <a href={n.url} target="_blank" rel="noreferrer" className="absolute box-border flex items-center gap-3 rounded-[10px] border border-line bg-surface p-3" style={{ left: n.x, top: n.y, width: n.width, height: n.height }}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: `oklch(0.42 0.15 ${h})` }}>{initials}</span>
      <div className="flex min-w-0 flex-col gap-[3px]"><span className="truncate font-semibold">{meta?.title ?? host.split("/")[0]}</span><span className="flex items-center gap-1 text-[12px] text-link"><Link2 size={12} className="shrink-0" /><span className="break-all">{host}</span></span></div>
    </a>
  );
}

export default function CanvasView({ canvas, refs, minimap = true }: { canvas: JsonCanvas; refs?: Record<string, FileRef>; minimap?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = canvas.nodes ?? [];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const bb = useMemo(() => {
    if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y), xe = nodes.map((n) => n.x + n.width), ye = nodes.map((n) => n.y + n.height);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xe) - x, h: Math.max(...ye) - y };
  }, [nodes]);
  const [view, setView] = useState<{ s: number; tx: number; ty: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const fit = () => {
    const el = box.current; if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const s = Math.min(1, (W - 32) / bb.w, (H - 32) / bb.h);
    setView({ s, tx: (W - bb.w * s) / 2 - bb.x * s - 40 * s, ty: W < 600 ? 72 - bb.y * s : (H - bb.h * s) / 2 - bb.y * s - 23 * s }); // phone: top-aligned under the header
  };
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { setSize({ w: el.clientWidth, h: el.clientHeight }); setView((v) => v ?? null); });
    ro.observe(el); fit();
    return () => ro.disconnect();
  }, [bb]); // eslint-disable-line react-hooks/exhaustive-deps
  // pan (pointer) + zoom (wheel / pinch)
  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        if (!e.ctrlKey && !e.metaKey) return { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
        const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        const s = Math.min(3, Math.max(0.15, v.s * Math.exp(-e.deltaY * 0.0025)));
        return { s, tx: px - ((px - v.tx) * s) / v.s, ty: py - ((py - v.ty) * s) / v.s };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("a")) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
  const onMove = (e: React.PointerEvent) => {
    const p = pts.current.get(e.pointerId); if (!p) return;
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, d] = [...pts.current.values()];
      const d1 = Math.hypot(c.x - d.x, c.y - d.y);
      const r = box.current!.getBoundingClientRect(), mx = (c.x + d.x) / 2 - r.left, my = (c.y + d.y) / 2 - r.top;
      setView((v) => { if (!v || !d0) return v; const s = Math.min(3, Math.max(0.15, (v.s * d1) / d0)); return { s, tx: mx - ((mx - v.tx) * s) / v.s, ty: my - ((my - v.ty) * s) / v.s }; });
      return;
    }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setView((v) => (v ? { ...v, tx: v.tx + e.clientX - p.x, ty: v.ty + e.clientY - p.y } : v));
  };
  const onUp = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); };

  const groups = nodes.filter((n) => n.type === "group");
  const edges = (canvas.edges ?? []).flatMap((e) => {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) return [];
    const [x1, y1] = anchor(a, e.fromSide as Side | undefined, b), [x2, y2] = anchor(b, e.toSide as Side | undefined, a);
    return [{ e, x1, y1, x2, y2, c: colorOf(e.color) ?? "var(--muted)" }];
  });
  const v = view ?? { s: 1, tx: 0, ty: 0 };
  // minimap: scene bbox scaled into 176×112 with the viewport rectangle
  const mm = { W: 176, H: 112, pad: 8 };
  const ms = Math.min((mm.W - mm.pad * 2) / bb.w, (mm.H - mm.pad * 2) / bb.h);
  const mox = (mm.W - bb.w * ms) / 2 - bb.x * ms, moy = (mm.H - bb.h * ms) / 2 - bb.y * ms;
  return (
    <div ref={box} className="absolute inset-0 touch-none select-none overflow-hidden bg-bg text-[13px] leading-[normal] text-ink"
      style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--muted) 35%, transparent) 1px, transparent 1.2px)", backgroundSize: `${22 * v.s}px ${22 * v.s}px`, backgroundPosition: `${v.tx}px ${v.ty}px`, cursor: "grab" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={fit}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`, visibility: view ? "visible" : "hidden" }}>
        {groups.map((g) => {
          const c = colorOf(g.color) ?? "var(--muted)";
          return (
            <div key={g.id} className="absolute rounded-[14px] border-[1.5px]" style={{ left: g.x, top: g.y, width: g.width, height: g.height, borderColor: c, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>
              {(g as { label?: string }).label && <span className="absolute -top-[30px] left-0 whitespace-nowrap rounded-[6px] px-2.5 py-[3px] text-[12.5px] font-semibold text-[#0F1115]" style={{ background: c }}>{(g as { label?: string }).label}</span>}
            </div>
          );
        })}
        {edges.map(({ e, x1, y1, x2, y2, c }) => {
          const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
          const arrow = (e as { toEnd?: string }).toEnd !== "none";
          return (
            <div key={e.id}>
              <div className="absolute -mt-px h-0.5 origin-[0_50%]" style={{ left: x1, top: y1, width: len, background: c, transform: `rotate(${ang}rad)` }}>
                {arrow && <span className="absolute -right-0.5 -top-[5px] border-y-[6px] border-l-[10px] border-y-transparent" style={{ borderLeftColor: c }} />}
              </div>
              {e.label && <span className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[6px] border border-line bg-bg px-2 py-0.5 text-[11.5px] text-muted" style={{ left: (x1 + x2) / 2, top: (y1 + y2) / 2 }}>{e.label}</span>}
            </div>
          );
        })}
        {nodes.map((n) => n.type === "text" ? <TextCard key={n.id} n={n} />
          : n.type === "file" ? <FileCard key={n.id} n={n} ref_={refs?.[(n as { file?: string }).file ?? ""]} />
          : n.type === "link" ? <LinkCard key={n.id} n={n} /> : null)}
      </div>
      {minimap && view && size.w > 600 && (
        <div className="absolute bottom-4 end-4 h-[112px] w-[176px] overflow-hidden rounded-[10px] border border-line bg-surface">
          {nodes.map((n) => {
            const c = colorOf(n.color);
            if (n.type !== "group" && groups.some((g) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height)) return null;
            return <div key={n.id} className="absolute rounded-[2px]" style={{ left: mox + n.x * ms, top: moy + n.y * ms, width: n.width * ms, height: n.height * ms, background: c ? `color-mix(in srgb, ${c} ${n.type === "group" ? 35 : 60}%, transparent)` : "var(--muted)", opacity: c ? 1 : 0.6 }} />;
          })}
          {(() => { const x0 = Math.max(4, mox + (-v.tx / v.s) * ms), y0 = Math.max(4, moy + (-v.ty / v.s) * ms); const x1 = Math.min(mm.W - 6, mox + ((size.w - v.tx) / v.s) * ms), y1 = Math.min(mm.H - 6, moy + ((size.h - v.ty) / v.s) * ms); return x1 > x0 && y1 > y0 ? <div className="absolute rounded-[4px] border-[1.5px] border-accent" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} /> : null; })()}
        </div>
      )}
    </div>
  );
}
