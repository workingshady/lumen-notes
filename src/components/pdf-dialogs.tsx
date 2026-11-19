// PDF reader overlays: the floating highlight bar, the flashcard mini editor, the canvas picker and the password prompt.
import { Check, LayoutDashboard, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HL_COLORS, type HlColor, type Highlight } from "../lib/pdf-format";
import { useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { Button, cx, inputCls, Sheet } from "./ui";

// ------------------------------------------------------------------ floating bar (Lumen 19 · R4-19A/C/I)
export interface BarProps {
  kind: "new" | "edit" | "area";
  h?: Highlight;
  /** colour ringed in the swatch row (the highlight's, or the last one used) */
  color: HlColor;
  x: number;
  y: number;
  /** y of the selection's bottom edge (the bar flips below when there's no room above) */
  below: number;
  phone: boolean;
  onColor: (c: HlColor) => void;
  onNote: () => void;
  onCard: () => void;
  onCopy: () => void;
  onLink: () => void;
  onCanvas?: () => void;
  onDelete?: () => void;
  onMeta?: (comment: string, tags: string[]) => void;
}
const act = "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[9px] text-[12.5px] text-ink hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]";

export function HighlightBar(p: BarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: p.x, top: p.y });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current, parent = el.offsetParent as HTMLElement | null;
    const w = el.offsetWidth, pw = parent?.clientWidth ?? innerWidth, h = el.offsetHeight;
    const above = p.y - h - 8;
    const top = above >= 8 ? above : p.below + 8;
    setPos({ left: p.phone ? 16 : Math.max(8, Math.min(pw - w - 8, p.x - w / 2)), top });
  }, [p.x, p.y, p.below, p.phone, p.kind]);
  const [comment, setComment] = useState(p.h?.comment ?? "");
  const [tags, setTags] = useState(p.h?.tags.map((t) => "#" + t).join(" ") ?? "");
  useEffect(() => { setComment(p.h?.comment ?? ""); setTags(p.h?.tags.map((t) => "#" + t).join(" ") ?? ""); }, [p.h?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => p.onMeta?.(comment.trim(), [...tags.matchAll(/#?([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1].toLowerCase()));
  return (
    <div ref={ref} role="toolbar" aria-label="Highlight" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input")) e.preventDefault(); }}
      className="pdfr-bar absolute z-30 flex flex-col gap-1 rounded-[10px] border border-line bg-surface-2 p-1 font-sans shadow-[0_14px_34px_rgba(0,0,0,.45)]"
      style={{ ...pos, maxWidth: p.phone ? "calc(100% - 16px)" : undefined }}>
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {HL_COLORS.map((c) => (
          <button key={c.name} className="size-6 shrink-0 rounded-[6px]" aria-label={`Highlight ${c.name}`} title={c.name} onClick={() => p.onColor(c.name)}
            style={{ background: c.hex, boxShadow: p.color === c.name ? "0 0 0 2px var(--surface-2), 0 0 0 3.5px var(--text)" : "none" }} />
        ))}
        <span className="mx-[3px] h-5 w-px shrink-0 bg-line" />
        <button className={act} onClick={p.onNote} title="New note from this highlight"><Glyph name="d-draft" size={14} color="var(--muted)" />Note</button>
        <button className={act} onClick={p.onCard} title="Make a flashcard"><Glyph name="flashcards" size={14} color="var(--muted)" />Card</button>
        <button className={act} onClick={p.onCopy} title="Copy the quote with its page"><Glyph name="columns-2" size={14} color="var(--muted)" />Copy</button>
        <button className={act} onClick={p.onLink} title="Copy a link to this highlight"><Glyph name="wikilink" size={14} color="var(--muted)" />Link</button>
        {p.onCanvas && <button className={act} onClick={p.onCanvas} title="Add to a canvas"><Glyph name="canvas" size={14} color="var(--muted)" />Canvas</button>}
        {p.onDelete && <button className={act} onClick={p.onDelete} aria-label="Delete highlight" title="Delete highlight"><Trash2 size={14} className="text-bad" /></button>}
      </div>
      {p.kind === "edit" && (
        <div className="flex gap-1 px-0.5 pb-0.5">
          <input dir="auto" className={cx(inputCls, "h-8 flex-[2] text-[12.5px]")} placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <input dir="auto" className={cx(inputCls, "h-8 flex-1 text-[12.5px]")} placeholder="#tags" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ small dropdown menu (toolbar ⋯, Fit width ▾, By page ▾)
export type MenuItem = { label: string; run: () => void; on?: boolean; swatch?: string; hint?: string; danger?: boolean } | "-";
export function PopMenu({ items, onClose, className }: { items: MenuItem[]; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => addEventListener("pointerdown", down), 0);
    addEventListener("keydown", key, true);
    return () => { clearTimeout(t); removeEventListener("pointerdown", down); removeEventListener("keydown", key, true); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className={cx("absolute z-40 flex min-w-[190px] flex-col rounded-[10px] border border-line bg-surface p-1 text-[13px] shadow-[0_14px_34px_rgba(0,0,0,.35)]", className)}>
      {items.map((it, i) => it === "-" ? <span key={i} className="my-1 h-px bg-line" /> : (
        <button key={i} role="menuitem" onClick={() => { it.run(); onClose(); }} className={cx("flex h-8 items-center gap-2 whitespace-nowrap rounded-[7px] px-2.5 text-start hover:bg-surface-2", it.danger ? "text-bad" : "text-ink")}>
          {it.swatch && <span className="size-2.5 rounded-[3px]" style={{ background: it.swatch }} />}
          <span className="flex-1">{it.label}</span>
          {it.hint && <span className="text-[11.5px] text-muted">{it.hint}</span>}
          {it.on && <Check size={14} className="text-muted" />}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ flashcard mini editor
export function FlashcardSheet({ open, onClose, quote, pdfTitle, onSave }: { open: boolean; onClose: () => void; quote: string; pdfTitle: string; onSave: (target: string, q: string, a: string) => void }) {
  const v = useVault();
  const [q, setQ] = useState(quote);
  const [a, setA] = useState("");
  const [cloze, setCloze] = useState(false);
  const [target, setTarget] = useState(() => { try { return localStorage.getItem("lumen.pdf.cardTarget." + pdfTitle) || `${pdfTitle}: cards`; } catch { return `${pdfTitle}: cards`; } });
  const qa = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) { setQ(quote); setA(""); setCloze(false); } }, [open, quote]);
  const decks = useMemo(() => v.notes.filter((n) => n.type === "flashcards" || /\s::\s/.test(n.body)).map((n) => n.title).slice(0, 200), [v.notes]);
  const hide = () => {
    const el = qa.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    if (s === e) return;
    const k = (q.match(/\{\{c(\d+)::/g) ?? []).length + 1;
    setQ(q.slice(0, s) + `{{c${k}::${q.slice(s, e)}}}` + q.slice(e));
  };
  const save = () => {
    try { localStorage.setItem("lumen.pdf.cardTarget." + pdfTitle, target); } catch { /* ignore */ }
    onSave(target, q, cloze ? "" : a);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Flashcard">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={cloze} onChange={(e) => setCloze(e.target.checked)} />Cloze</label>
          {cloze && <Button size="sm" onClick={hide}>Hide selection</Button>}
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-muted">{cloze ? "Text (select words, then Hide selection)" : "Front"}
          <textarea ref={qa} dir="auto" rows={4} className={cx(inputCls, "h-auto py-2 text-[13.5px] text-ink")} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {!cloze && (
          <label className="flex flex-col gap-1 text-[12px] text-muted">Back
            <textarea dir="auto" rows={3} autoFocus className={cx(inputCls, "h-auto py-2 text-[13.5px] text-ink")} value={a} onChange={(e) => setA(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[12px] text-muted">Add to note
          <input dir="auto" list="pdf-card-decks" className={cx(inputCls, "text-[13.5px]")} value={target} onChange={(e) => setTarget(e.target.value)} />
          <datalist id="pdf-card-decks">{decks.map((d) => <option key={d} value={d} />)}</datalist>
        </label>
        <div className="text-[12px] text-muted">The card keeps a link back to this page.</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!q.trim() || (!cloze && !a.trim()) || (cloze && !/\{\{c\d+::/.test(q))} onClick={save}>Add card</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ canvas picker
export function CanvasPickSheet({ open, onClose, spaceId, onPick }: { open: boolean; onClose: () => void; spaceId: string; onPick: (id: string) => void }) {
  const v = useVault();
  const list = useMemo(() => v.notes.filter((n) => n.type === "canvas").sort((a, b) => (a.spaceId === spaceId ? 0 : 1) - (b.spaceId === spaceId ? 0 : 1) || b.updatedAt - a.updatedAt).slice(0, 100), [v.notes, spaceId]);
  return (
    <Sheet open={open} onClose={onClose} title="Add to canvas">
      {list.length ? (
        <div className="flex flex-col gap-0.5">
          {list.map((n) => <button key={n.id} onClick={() => onPick(n.id)} className="flex h-11 items-center gap-2.5 rounded-[8px] px-2.5 text-start text-[13.5px] hover:bg-surface-2"><LayoutDashboard size={15} className="text-muted" /><span dir="auto" className="truncate">{n.title}</span></button>)}
        </div>
      ) : <div className="text-[13px] text-muted">No canvases yet. Create one, then drag highlights onto it or add them from here.</div>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ password (R4-19G)
export function PasswordPrompt({ retry, onSubmit, onCancel }: { retry: boolean; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <form className="flex w-[380px] max-w-[calc(100%-32px)] flex-col gap-3 rounded-[14px] border border-line bg-surface p-[22px]" onSubmit={(e) => { e.preventDefault(); if (pw) onSubmit(pw); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <Glyph name="s-locked" size={24} color="var(--muted)" />
      <span className="text-[16px] font-[650]">This PDF has a password</span>
      <span className="leading-[19px] text-muted">Lumen never stores it. You'll be asked each time it opens.</span>
      <input autoFocus type="password" aria-label="Password" aria-invalid={retry || undefined} value={pw} onChange={(e) => setPw(e.target.value)}
        className="h-[38px] rounded-[7px] border border-accent bg-bg px-2.5 tracking-[.2em] text-ink outline-none" />
      {retry && <span className="text-[12.5px] text-bad">That password didn't work. Try again.</span>}
      <button type="submit" disabled={!pw} className="h-9 rounded-[9px] bg-accent font-semibold text-accent-fg disabled:opacity-60">Open</button>
    </form>
  );
}
