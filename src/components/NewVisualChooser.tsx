// "New visual workspace" chooser (design round 4, Lumen 17 · A5): four options with silhouette previews and glyphs,
// the format each one makes and what it can be edited with; says where it will be created ("in Inbox ▾", a picker).
import { useEffect, useMemo, useRef, useState } from "react";
import { createNote } from "../lib/actions";
import { newDiagramFile } from "../lib/diagrams";
import { go, openNote, useUI, useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { cx } from "./ui";

type Kind = "canvas" | "whiteboard" | "mermaid" | "graph";
interface Shape { x: number; y: number; w: number; h: number; f: string; r?: number; b?: string; rot?: string }
const R = (x: number, y: number, w: number, h: number, f: string, o: { b?: string; r?: number; rot?: string } = {}): Shape => ({ x, y, w, h, f, r: o.r ?? 4, b: o.b, rot: o.rot });
const KINDS: { k: Kind; g: string; n: string; d: string; f: string; caps: string[]; cta: string; prev: Shape[] }[] = [
  { k: "canvas", g: "canvas", n: "Canvas", d: "Cards, notes and links joined by arrows.", f: ".canvas", caps: ["Drag & drop", "JSON", "Script", "REST"], cta: "Create canvas",
    prev: [R(16, 20, 70, 40, "var(--surface-2)", { b: "1px solid var(--border)" }), R(130, 60, 70, 40, "var(--surface-2)", { b: "1.5px solid #A371F7" }), R(86, 40, 44, 2, "var(--muted)", { r: 1 }), R(30, 80, 60, 26, "var(--surface-2)", { b: "1px solid var(--border)" })] },
  { k: "whiteboard", g: "whiteboard", n: "Whiteboard", d: "Sketch freely: pen, shapes, stickies.", f: ".excalidraw", caps: ["Draw", "JSON", "Mermaid → shapes"], cta: "Create whiteboard",
    prev: [R(18, 18, 52, 46, "#fff3bf", { r: 2, rot: "-4deg" }), R(80, 24, 52, 46, "#d0ebff", { r: 2, rot: "3deg" }), R(150, 30, 46, 46, "transparent", { b: "2px solid var(--text)", r: 23 }), R(40, 82, 120, 2, "var(--text)", { r: 1, rot: "-6deg" })] },
  { k: "mermaid", g: "diagram", n: "Mermaid diagram", d: "Write text, get a flowchart or sequence.", f: ".mermaid", caps: ["Live preview", "Export", "On canvases"], cta: "Create diagram",
    prev: [R(16, 46, 40, 22, "var(--surface-2)", { b: "1px solid var(--border)" }), R(56, 56, 20, 2, "var(--muted)"), R(76, 46, 40, 22, "var(--surface-2)", { b: "1px solid var(--border)" }), R(116, 56, 20, 2, "var(--muted)"), R(136, 44, 46, 26, "transparent", { b: "1.5px solid var(--warning)", r: 13 })] },
  { k: "graph", g: "graph", n: "Graph from note", d: "See how this note connects.", f: "not saved", caps: ["Filters", "Local or whole vault"], cta: "Open graph",
    prev: [R(90, 48, 14, 14, "var(--text)", { r: 7 }), R(40, 24, 9, 9, "#39C5CF", { r: 5 }), R(150, 30, 9, 9, "#E8893A", { r: 5 }), R(60, 86, 9, 9, "#A371F7", { r: 5 }), R(140, 84, 9, 9, "#57AB5A", { r: 5 })] },
];

function Preview({ shapes }: { shapes: Shape[] }) {
  return (
    <div className="relative h-[120px] overflow-hidden border-b border-line bg-bg">
      {shapes.map((r, i) => <span key={i} className="absolute box-border" style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r, background: r.f, border: r.b ?? "none", transform: `rotate(${r.rot ?? "0deg"})` }} />)}
    </div>
  );
}

export function NewVisualChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const [sel, setSel] = useState(0);
  const selRef = useRef(0);
  selRef.current = sel;
  const [where, setWhere] = useState<{ spaceId: string; folderId: string | null }>({ spaceId: "inbox", folderId: null });
  const [picking, setPicking] = useState(false);
  const whereRef = useRef(where);
  whereRef.current = where;
  const space = v.spaceMap.get(where.spaceId);
  const folder = where.folderId ? v.folderMap.get(where.folderId) : null;
  const isInbox = where.spaceId === "inbox" && !folder;
  const label = folder?.name ?? (where.spaceId === "inbox" ? "Inbox" : space?.name ?? "Inbox");

  async function create(i = sel) {
    const k = KINDS[i].k;
    const w = whereRef.current;
    onClose();
    if (k === "graph") {
      // GraphView is lazy-loaded; hand it the "start local" request through sessionStorage.
      try { if (ui.noteId) sessionStorage.setItem("lumen.graphLocal", ui.noteId); } catch { /* ignore */ } // no note open → the whole graph
      go("graph");
      return;
    }
    if (k === "mermaid") {
      const d = await newDiagramFile({ spaceId: w.spaceId, folderId: w.folderId }, v.notes);
      openNote(d.id, "split");
      return;
    }
    const n = await createNote({ template: k, spaceId: w.spaceId, folderId: w.folderId });
    openNote(n.id);
  }

  useEffect(() => {
    if (!open) return;
    setSel(0);
    setPicking(false);
    setWhere({ spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId, folderId: ui.spaceId === "all" ? null : ui.folderId });
    const openedAt = performance.now();
    const key = (e: KeyboardEvent) => {
      if (e.timeStamp <= openedAt) return; // the Enter that opened us (palette) is still bubbling
      if ((e.target as HTMLElement)?.closest?.("input")) { if (e.key === "Escape") setPicking(false); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(KINDS.length - 1, s + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); void create(selRef.current); }
      else if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const whereIcon = isInbox ? <Glyph name="inbox" size={14} /> : folder ? <Glyph name="folder" size={14} /> : <SpaceIcon space={space} size={14} />;
  const whereBtn = (cls: string, caret: boolean) => (
    <span className={cx("relative", cls)}>
      <button onClick={() => setPicking((p) => !p)} aria-haspopup="listbox" aria-expanded={picking} title="Where it will be created" className="flex items-center gap-1.5 text-muted hover:text-ink">
        in{whereIcon}<b className="font-medium text-ink" dir="auto">{label}</b>{caret && " ▾"}
      </button>
      {picking && <WherePicker value={where} onPick={(w) => { setWhere(w); setPicking(false); }} onClose={() => setPicking(false)} />}
    </span>
  );
  const k = KINDS[sel];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.55)] text-[13px] text-ink md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="New visual workspace" className="sheet-in safe-b flex max-h-[92dvh] w-full flex-col rounded-t-[14px] bg-surface px-4 pt-2.5 md:w-[980px] md:max-w-[calc(100vw-32px)] md:rounded-[14px] md:border md:border-line md:p-0">
        {/* Phone sheet header */}
        <div className="flex flex-col gap-2.5 md:hidden">
          <div className="flex justify-center"><button aria-label="Close" onClick={onClose} className="h-1 w-9 rounded-[2px] bg-line" /></div>
          <span className="text-[18px] font-[650]">New…</span>
          {whereBtn("self-start", false)}
        </div>
        {/* Desktop header */}
        <div className="hidden items-center gap-2.5 px-[22px] pb-1 pt-[18px] md:flex">
          <span className="flex-1 text-[18px] font-[650]">New visual workspace</span>
          {whereBtn("", true)}
        </div>
        <span className="hidden px-[22px] pb-4 text-muted md:block">Pick by what you want to do with your hands.</span>
        <div className="mt-2.5 flex min-h-0 flex-col gap-2.5 overflow-y-auto md:mt-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-[22px]">
          {KINDS.map((c, i) => {
            const on = sel === i;
            const gc = on ? "var(--accent)" : "var(--text)";
            return (
              <button key={c.k} onClick={() => setSel(i)} onDoubleClick={() => void create(i)} aria-pressed={on}
                className="box-border flex min-h-16 shrink-0 items-center gap-3 overflow-hidden rounded-[12px] px-3.5 text-left md:min-h-0 md:flex-col md:items-stretch md:gap-0 md:px-0"
                style={{ border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "color-mix(in srgb,var(--accent) 6%,var(--surface))" : "var(--surface)" }}>
                <span className="flex md:hidden"><Glyph name={c.g} size={22} color={gc} tile={gc} /></span>
                <span className="hidden md:block"><Preview shapes={c.prev} /></span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:gap-1.5 md:p-3">
                  <span className="flex items-center gap-2 font-semibold md:font-[650]"><span className="hidden md:inline-flex"><Glyph name={c.g} size={18} color={gc} /></span>{c.n}</span>
                  <span className="text-[12.5px] text-muted md:leading-[18px]">{c.d}</span>
                  <code className="hidden font-mono text-[11px] text-muted md:block">{c.f}</code>
                  <span className="hidden flex-wrap gap-1 md:flex">{c.caps.map((t) => <span key={t} className="rounded-[5px] border border-line px-1.5 text-[10.5px] leading-[17px] text-muted">{t}</span>)}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 justify-end gap-2 pt-2.5 md:px-[22px] md:py-4">
          <button className="hidden h-[34px] items-center px-3.5 text-muted hover:text-ink md:flex" onClick={onClose}>Cancel</button>
          <button className="mt-1 flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg hover:brightness-110 md:mt-0 md:h-[34px] md:flex-none md:rounded-[10px] md:px-4" onClick={() => void create()}>{k.cta}</button>
        </div>
        <div className="h-6 shrink-0 md:hidden" />
      </div>
    </div>
  );
}

/** Where to create it: Inbox, a space, or one of its folders (searchable). */
function WherePicker({ value, onPick, onClose }: { value: { spaceId: string; folderId: string | null }; onPick: (w: { spaceId: string; folderId: string | null }) => void; onClose: () => void }) {
  const v = useVault();
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => addEventListener("mousedown", h), 0);
    return () => { clearTimeout(t); removeEventListener("mousedown", h); };
  }, [onClose]);
  const rows = useMemo(() => {
    type Row = { spaceId: string; folderId: string | null; name: string; depth: number; space?: (typeof v.spaces)[number] };
    const out: Row[] = [];
    const spaces = [...v.spaces].filter((s) => !s.deleted && !s.archived).sort((a, b) => (a.id === "inbox" ? -1 : b.id === "inbox" ? 1 : (a.sort ?? 0) - (b.sort ?? 0)));
    for (const s of spaces) {
      out.push({ spaceId: s.id, folderId: null, name: s.id === "inbox" ? "Inbox" : s.name, depth: 0, space: s });
      const walk = (parent: string | null, depth: number) => {
        for (const f of v.folders.filter((f) => !f.deleted && f.spaceId === s.id && (f.parentId ?? null) === parent).sort((a, b) => a.name.localeCompare(b.name))) {
          out.push({ spaceId: s.id, folderId: f.id, name: f.name, depth });
          if (depth < 4) walk(f.id, depth + 1);
        }
      };
      walk(null, 1);
    }
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((r) => r.name.toLowerCase().includes(needle)) : out;
  }, [v.spaces, v.folders, q]);
  return (
    <div ref={ref} role="listbox" className="absolute left-0 top-full z-10 mt-1.5 flex max-h-[340px] w-[280px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface-2 text-[13px] shadow-[0_12px_28px_rgba(0,0,0,.4)] md:left-auto md:right-0">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a space or folder" className="h-9 border-b border-line bg-transparent px-3 outline-none placeholder:text-muted" />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((r) => {
          const on = r.spaceId === value.spaceId && r.folderId === value.folderId;
          return (
            <button key={r.spaceId + (r.folderId ?? "")} role="option" aria-selected={on} onClick={() => onPick({ spaceId: r.spaceId, folderId: r.folderId })}
              className={cx("flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left hover:bg-surface", on && "bg-surface font-semibold")} style={{ paddingInlineStart: 8 + r.depth * 14 }}>
              {r.folderId ? <Glyph name="folder" size={14} color="var(--muted)" /> : r.spaceId === "inbox" ? <Glyph name="inbox" size={14} /> : <SpaceIcon space={r.space} size={14} />}
              <span className="min-w-0 flex-1 truncate" dir="auto">{r.name}</span>
            </button>
          );
        })}
        {!rows.length && <div className="px-2 py-3 text-muted">Nothing found.</div>}
      </div>
    </div>
  );
}
