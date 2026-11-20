// "New visual" chooser (design round 7, Lumen 40 · A–C; markup ported from R6Parts.dc.html part "chooser"):
// six cards (Canvas, Whiteboard, Board, Mermaid, Architecture, Graph), a "From template" row (opens the templates gallery),
// an "Import" row (each chip imports a file) and a "Save in" picker.
import { useEffect, useMemo, useRef, useState } from "react";
import { createNote } from "../lib/actions";
import { isRtl, t, tk } from "../lib/i18n";
import { newDiagramFile } from "../lib/diagrams";
import { go, openNote, useUI, useVault } from "../lib/store";
import { CHIP_TEMPLATES, MINDMAP_SRC, templateById } from "../lib/templates-visual";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { createFromTemplate, TemplatesGallery } from "./TemplatesGallery";
import { cx } from "./ui";

type Kind = "canvas" | "whiteboard" | "board" | "mermaid" | "arch" | "graph";
const KINDS: { k: Kind; g: string; n: string; hand: string; d: string; chips: string[]; f: string; conv: string; col: string }[] = [
  { k: "canvas", g: "canvas", n: tk("Canvas"), hand: tk("Arrange notes and ideas"), d: tk("Best for linking notes into maps and outlines."), chips: [tk("note cards"), tk("groups"), tk("edges"), tk("present")], f: ".canvas", conv: tk("Board · Architecture · Mermaid"), col: "#39C5CF" },
  { k: "whiteboard", g: "whiteboard", n: tk("Whiteboard"), hand: tk("Sketch and handwrite"), d: tk("Best for free drawing with a pen or stylus."), chips: [tk("pens"), tk("shapes"), tk("layers"), tk("AI convert")], f: ".excalidraw", conv: tk("Board · Canvas · Note"), col: "#E8893A" },
  { k: "board", g: "board", n: tk("Board"), hand: tk("Draw, link notes, drop media"), d: tk("Everything on one surface: ink, live notes, diagrams, media."), chips: [tk("ink"), tk("note cards"), tk("Mermaid"), tk("media"), tk("frames")], f: ".excalidraw", conv: tk("Canvas · Architecture · Note"), col: "#F2A93B" },
  { k: "mermaid", g: "mermaid", n: tk("Mermaid diagram"), hand: tk("Type a diagram"), d: tk("Best when text is faster than dragging."), chips: [tk("code"), tk("live preview"), tk("14 kinds")], f: ".mermaid", conv: tk("Whiteboard · Canvas"), col: "#A371F7" },
  { k: "arch", g: "diagram", n: tk("Architecture & diagrams"), hand: tk("Drag or type a system"), d: tk("Systems, flowcharts, ERDs and C4 with code kept in sync."), chips: [tk("library"), tk("code ⇄ canvas"), tk("auto layout"), "AI"], f: ".canvas + lumenArch", conv: tk("Mermaid · draw.io · SQL"), col: "#57AB5A" },
  { k: "graph", g: "graph", n: tk("Graph from note"), hand: tk("See connections"), d: tk("Read-only map of a note's links; drag nodes out."), chips: [tk("read-only"), tk("drag out"), tk("Open as canvas")], f: tk("view"), conv: tk("Canvas · Board"), col: "#7AA2F7" },
];
type ImportKind = "mermaid" | "drawio" | "excalidraw" | "canvas" | "terraform" | "sql";
const IMPORTS: { k: ImportKind; g: string; l: string; accept: string }[] = [
  { k: "mermaid", g: "mermaid", l: "Mermaid", accept: ".mmd,.mermaid,.md,.txt" }, { k: "drawio", g: "diagram", l: "draw.io", accept: ".drawio,.xml" },
  { k: "excalidraw", g: "whiteboard", l: ".excalidraw", accept: ".excalidraw,.json" }, { k: "canvas", g: "canvas", l: ".canvas", accept: ".canvas,.json" },
  { k: "terraform", g: "code", l: "Terraform", accept: ".tf,.hcl,.txt" }, { k: "sql", g: "database", l: "SQL", accept: ".sql,.txt" },
];
const chip = "flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line px-2.5 text-[12px] hover:bg-surface-2";

type W = { spaceId: string; folderId: string | null };
/** "Architecture & diagrams" opens W1-D's chooser when it exists (src/components/arch/*, export openArchitectureChooser(where)); until then a starter architecture canvas. */
async function openArch(where: W) {
  const mods = import.meta.glob("./arch/*.{ts,tsx}") as Record<string, () => Promise<Record<string, unknown>>>;
  for (const load of Object.values(mods)) {
    try { const m = await load(); if (typeof m.openArchitectureChooser === "function") { (m.openArchitectureChooser as (w: W) => void)(where); return; } } catch { /* try the next module */ }
  }
  const tpl = templateById("three-tier")!;
  await createFromTemplate({ ...tpl, title: "New architecture" }, where);
}

export function NewVisualChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const [where, setWhere] = useState<W>({ spaceId: "inbox", folderId: null });
  const [picking, setPicking] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [err, setErr] = useState("");
  const whereRef = useRef(where);
  whereRef.current = where;
  const fileRef = useRef<HTMLInputElement>(null);
  const importKind = useRef<ImportKind>("mermaid");
  const space = v.spaceMap.get(where.spaceId);
  const folder = where.folderId ? v.folderMap.get(where.folderId) : null;
  const isInbox = where.spaceId === "inbox" && !folder;
  const label = folder?.name ?? (where.spaceId === "inbox" ? t("Inbox") : space?.name ?? t("Inbox"));

  async function create(k: Kind) {
    const w = whereRef.current;
    onClose();
    if (k === "graph") {
      // GraphView is lazy-loaded; hand it the "start local" request through sessionStorage.
      try { if (ui.noteId) sessionStorage.setItem("lumen.graphLocal", ui.noteId); } catch { /* ignore */ } // no note open → the whole graph
      go("graph");
    } else if (k === "mermaid") openNote((await newDiagramFile({ spaceId: w.spaceId, folderId: w.folderId }, v.notes)).id, "split");
    else if (k === "arch") await openArch(w);
    else if (k === "board") openNote((await createNote({ type: "board", title: "New board", body: "", spaceId: w.spaceId, folderId: w.folderId })).id);
    else openNote((await createNote({ template: k, spaceId: w.spaceId, folderId: w.folderId })).id);
  }
  async function chipTemplate(id: string) {
    const w = whereRef.current;
    onClose();
    if (id === "mindmap") { openNote((await newDiagramFile(w, v.notes, "mindmap", MINDMAP_SRC)).id, "split"); return; }
    await createFromTemplate(templateById(id)!, w);
  }
  async function importFile(f: File) {
    const w = whereRef.current, k = importKind.current;
    const title = f.name.replace(/\.[^.]+$/, "") || "Imported";
    try {
      const text = await f.text();
      let n;
      if (k === "mermaid") n = await newDiagramFile(w, v.notes, "imported", text.replace(/^```mermaid\s*\n?|```\s*$/g, ""));
      else if (k === "excalidraw") { const { parseScene } = await import("../lib/whiteboard"); const r = parseScene(text); if (r.error) throw new Error(r.error); n = await createNote({ type: "whiteboard", title, body: text, spaceId: w.spaceId, folderId: w.folderId }); }
      else if (k === "canvas") { const { parseCanvas } = await import("../lib/canvas"); const r = parseCanvas(text); if (r.error) throw new Error(r.error); n = await createNote({ type: "canvas", title, body: text, spaceId: w.spaceId, folderId: w.folderId }); }
      else {
        const m = await import("../lib/visual-import");
        const body = k === "drawio" ? m.drawioToCanvas(text) : k === "terraform" ? m.terraformToCanvas(text) : m.sqlToCanvas(text);
        n = await createNote({ type: "canvas", title, body, spaceId: w.spaceId, folderId: w.folderId });
      }
      onClose();
      openNote(n.id);
    } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
  }

  useEffect(() => {
    if (!open) return;
    setPicking(false); setGallery(false); setErr("");
    setWhere({ spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId, folderId: ui.spaceId === "all" ? null : ui.folderId });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input")) onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const whereIcon = isInbox ? <Glyph name="inbox" size={14} /> : folder ? <Glyph name="folder" size={14} /> : <SpaceIcon space={space} size={14} />;
  return (
    <div role="dialog" aria-label={t("New visual")} dir={isRtl() ? "rtl" : "ltr"} className="fixed inset-0 z-50 overflow-y-auto bg-bg text-[13px] text-ink fade-in">
      <button aria-label={t("Close")} onClick={onClose} className="absolute end-2 top-2 flex h-8 w-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={16} /></button>
      <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-[18px] px-4 pb-8 pt-[26px] md:px-[60px] md:py-[48px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-[22px] font-[650] leading-[34px] tracking-[-.02em] md:text-[28px] md:leading-[36px]">{t("New visual")}</span>
          <span className="relative">
            <button onClick={() => setPicking((p) => !p)} aria-haspopup="listbox" aria-expanded={picking} title={t("Where it will be created")} className="flex h-[34px] items-center gap-2 whitespace-nowrap rounded-[9px] border border-line px-3 text-[12.5px]">
              <span className="text-muted">{t("Save in")}</span>{whereIcon}<span dir="auto">{label}</span><span className="text-[9px]">▾</span>
            </button>
            {picking && <WherePicker value={where} onPick={(w) => { setWhere(w); setPicking(false); }} onClose={() => setPicking(false)} />}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {KINDS.map((c) => {
            const rec = c.k === "board";
            return (
              <button key={c.k} onClick={() => void create(c.k)} className="flex min-w-0 flex-col gap-2.5 rounded-[14px] bg-surface p-4 text-start transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[.99]"
                style={{ border: `1px solid ${rec ? "var(--accent)" : "var(--border)"}`, boxShadow: rec ? "0 0 0 1px var(--accent)" : "none" }}>
                <span className="flex items-center gap-3">
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px]" style={{ background: `color-mix(in srgb,${c.col} 14%,transparent)`, color: c.col }}><Glyph name={c.g as never} size={22} /></span>
                  <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[15px] font-[650]">{t(c.n)}</span><span className="text-[12.5px]" style={{ color: rec ? "var(--accent)" : "var(--text)" }}>{t(c.hand)}</span></span>
                </span>
                <span className="hidden text-[12.5px] leading-[18px] text-muted md:block">{t(c.d)}</span>
                <span className="flex flex-wrap gap-[5px]">{c.chips.map((x) => <span key={x} className="whitespace-nowrap rounded-full bg-surface-2 px-2 py-[2px] text-[11px]">{t(x)}</span>)}</span>
                <span className="flex justify-between gap-2 border-t border-line pt-2 font-mono text-[11px] font-medium text-muted" dir="ltr"><span>{t(c.f)}</span><span className="truncate">→ {t(c.conv)}</span></span>
              </button>
            );
          })}
        </div>
        <span className="text-center text-[12.5px] text-muted">{t("Not sure? Start with")} <b className="text-ink">{t("Board")}</b>{t(". You can convert any workspace later.")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-[11px] font-semibold tracking-[.06em] text-muted md:w-[110px]">{t("FROM TEMPLATE")}</span>
          {CHIP_TEMPLATES.map((c) => <button key={c.id} className={chip} onClick={() => void chipTemplate(c.id)}><Glyph name={c.g as never} size={14} color="var(--muted)" />{t(c.l)}</button>)}
          <button className={chip} onClick={() => setGallery(true)}><Glyph name="template" size={14} color="var(--muted)" />{t("All templates…")}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-[11px] font-semibold tracking-[.06em] text-muted md:w-[110px]">{t("IMPORT")}</span>
          {IMPORTS.map((c) => <button key={c.k} className={chip} onClick={() => { importKind.current = c.k; setErr(""); if (fileRef.current) { fileRef.current.accept = c.accept; fileRef.current.click(); } }}><Glyph name={c.g as never} size={14} color="var(--muted)" />{c.l}</button>)}
        </div>
        {err && <span role="alert" className="text-[12.5px] text-[var(--danger,#EF6B6B)]" dir="auto">{err}</span>}
      </div>
      <TemplatesGallery open={gallery} where={where} onClose={() => setGallery(false)} onPicked={onClose} />
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
    const tm = setTimeout(() => addEventListener("mousedown", h), 0);
    return () => { clearTimeout(tm); removeEventListener("mousedown", h); };
  }, [onClose]);
  const rows = useMemo(() => {
    type Row = { spaceId: string; folderId: string | null; name: string; depth: number; space?: (typeof v.spaces)[number] };
    const out: Row[] = [];
    const spaces = [...v.spaces].filter((s) => !s.deleted && !s.archived).sort((a, b) => (a.id === "inbox" ? -1 : b.id === "inbox" ? 1 : (a.sort ?? 0) - (b.sort ?? 0)));
    for (const s of spaces) {
      out.push({ spaceId: s.id, folderId: null, name: s.id === "inbox" ? t("Inbox") : s.name, depth: 0, space: s });
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
    <div ref={ref} role="listbox" className="absolute start-0 top-full z-10 mt-1.5 flex max-h-[340px] w-[280px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface-2 text-[13px] shadow-[0_12px_28px_rgba(0,0,0,.4)] md:start-auto md:end-0">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a space or folder")} className="h-9 border-b border-line bg-transparent px-3 outline-none placeholder:text-muted" />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((r) => {
          const on = r.spaceId === value.spaceId && r.folderId === value.folderId;
          return (
            <button key={r.spaceId + (r.folderId ?? "")} role="option" aria-selected={on} onClick={() => onPick({ spaceId: r.spaceId, folderId: r.folderId })}
              className={cx("flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-start hover:bg-surface", on && "bg-surface font-semibold")} style={{ paddingInlineStart: 8 + r.depth * 14 }}>
              {r.folderId ? <Glyph name="folder" size={14} color="var(--muted)" /> : r.spaceId === "inbox" ? <Glyph name="inbox" size={14} /> : <SpaceIcon space={r.space} size={14} />}
              <span className="min-w-0 flex-1 truncate" dir="auto">{r.name}</span>
            </button>
          );
        })}
        {!rows.length && <div className="px-2 py-3 text-muted">{t("Nothing found.")}</div>}
      </div>
    </div>
  );
}
