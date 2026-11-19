// PDF reader overlays: the floating highlight bar, the flashcard mini editor, the canvas picker and the password prompt.
import { Copy, Layers, LayoutDashboard, Link2, Lock, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HL_COLORS, type HlColor, type Highlight } from "../lib/pdf-format";
import { useVault } from "../lib/store";
import { Button, cx, inputCls, Sheet } from "./ui";

// ------------------------------------------------------------------ floating bar
export interface BarProps {
  kind: "new" | "edit";
  h?: Highlight;
  x: number;
  y: number;
  /** phone: docked above the bottom bar instead of floating at the selection */
  docked: boolean;
  onColor: (c: HlColor) => void;
  onNote: () => void;
  onCard: () => void;
  onCopy: () => void;
  onLink: () => void;
  onCanvas?: () => void;
  onDelete?: () => void;
  onMeta?: (comment: string, tags: string[]) => void;
}
const btn = "flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-ink hover:bg-surface-2";

export function HighlightBar(p: BarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: p.x, top: p.y });
  useEffect(() => {
    if (p.docked || !ref.current) return;
    const el = ref.current, parent = el.offsetParent as HTMLElement | null;
    const w = el.offsetWidth, pw = parent?.clientWidth ?? innerWidth;
    setPos({ left: Math.max(8, Math.min(pw - w - 8, p.x - w / 2)), top: Math.max(8, p.y - el.offsetHeight - 10) });
  }, [p.x, p.y, p.docked, p.kind]);
  const [comment, setComment] = useState(p.h?.comment ?? "");
  const [tags, setTags] = useState(p.h?.tags.map((t) => "#" + t).join(" ") ?? "");
  useEffect(() => { setComment(p.h?.comment ?? ""); setTags(p.h?.tags.map((t) => "#" + t).join(" ") ?? ""); }, [p.h?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => p.onMeta?.(comment.trim(), [...tags.matchAll(/#?([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1].toLowerCase()));
  return (
    <div ref={ref} role="toolbar" aria-label="Highlight" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input")) e.preventDefault(); }}
      className={cx("pdfr-bar z-30 flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,.35)]", p.docked ? "absolute inset-x-2 top-2" : "absolute")}
      style={p.docked ? undefined : pos}>
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {HL_COLORS.map((c) => (
          <button key={c.name} className={btn} aria-label={`Highlight ${c.name}`} title={c.name} onClick={() => p.onColor(c.name)}>
            <span className={cx("size-[18px] rounded-full", p.h?.color === c.name && "ring-2 ring-ink ring-offset-2 ring-offset-surface")} style={{ background: c.hex }} />
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />
        <button className={btn} onClick={p.onNote} title="New note from this highlight"><StickyNote size={15} /><span className={p.docked ? "sr-only" : ""}>Note</span></button>
        <button className={btn} onClick={p.onCard} title="Flashcard"><Layers size={15} /><span className={p.docked ? "sr-only" : ""}>Card</span></button>
        <button className={btn} onClick={p.onCopy} aria-label="Copy quote" title="Copy quote with page"><Copy size={15} /></button>
        <button className={btn} onClick={p.onLink} aria-label="Copy link" title="Copy a link to this highlight"><Link2 size={15} /></button>
        {p.onCanvas && <button className={btn} onClick={p.onCanvas} aria-label="Add to canvas" title="Add to a canvas"><LayoutDashboard size={15} /></button>}
        {p.onDelete && <button className={cx(btn, "text-bad")} onClick={p.onDelete} aria-label="Delete highlight" title="Delete highlight"><Trash2 size={15} /></button>}
      </div>
      {p.kind === "edit" && (
        <div className="flex gap-1 px-1 pb-1">
          <input dir="auto" className={cx(inputCls, "h-8 flex-[2] text-[12.5px]")} placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <input dir="auto" className={cx(inputCls, "h-8 flex-1 text-[12.5px]")} placeholder="#tags" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
        </div>
      )}
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

// ------------------------------------------------------------------ password
export function PasswordPrompt({ retry, onSubmit, onCancel }: { retry: boolean; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <form className="mx-auto mt-[12vh] flex w-full max-w-[360px] flex-col gap-3 rounded-[14px] border border-line bg-surface p-5" onSubmit={(e) => { e.preventDefault(); if (pw) onSubmit(pw); }}>
      <div className="flex items-center gap-2 text-[15px] font-semibold"><Lock size={16} className="text-muted" />Password-protected PDF</div>
      <div className="text-[13px] text-muted">Enter the password to open it. It's used on this device only and isn't saved.</div>
      <input autoFocus type="password" aria-invalid={retry || undefined} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
      {retry && <div className="text-[12.5px] text-bad">That password didn't work. Try again.</div>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" disabled={!pw}>Open</Button></div>
    </form>
  );
}
