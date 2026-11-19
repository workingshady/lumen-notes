/* Tag picker (design R6-30P "Tag picker in a note · create"): the note's tags as coloured chips with ×, then an input;
 * suggestions fuzzy-match the whole tag path with the matched part highlighted, counts and colour dots; ↵ picks the
 * highlighted tag, ⇧↵ creates exactly what was typed. Used in Properties (tags row) and the note list's bulk "Tag". */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { t } from "../lib/i18n";
import { useVault } from "../lib/store";
import { addTagToNotes, removeTagFromNote } from "../lib/tag-ops";
import { cleanTag, fuzzyTags, tagColor, tagTree, useTagMeta, type TagNode } from "../lib/tag-tree";
import { Glyph } from "./Glyph";
import { cx } from "./ui";

/** Flat [path, rolled-up count] for every tag including implicit parents (so "#ml" is offered when only "#ml/llm" exists). */
export function useAllTags(): [string, number][] {
  const v = useVault();
  return useMemo(() => {
    const out: [string, number][] = [];
    const walk = (ns: TagNode[]) => { for (const n of ns) { out.push([n.path, n.count]); walk(n.children); } };
    walk(tagTree(v.tags));
    return out;
  }, [v.tags]);
}

/** One coloured tag chip (list rows, picker, tag page). */
export function TagChip({ tag, color, onRemove, size = "sm", title }: { tag: string; color: string | null; onRemove?: () => void; size?: "sm" | "md"; title?: string }) {
  const c = color ?? "var(--muted)";
  return (
    <span dir="ltr" title={title} className={cx("flex shrink-0 items-center whitespace-nowrap text-ink", size === "md" ? "h-6 gap-[5px] rounded-[6px] pe-1 ps-2 text-[12.5px]" : "h-[18px] gap-1 rounded-[5px] px-1.5 text-[11px]")}
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      <span className={cx("shrink-0 rounded-full", size === "md" ? "size-1.5" : "size-[5px]")} style={{ background: c }} />#{tag}
      {onRemove && <button type="button" aria-label={t("Remove #{tag}", { tag })} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="px-0.5 opacity-60 hover:opacity-100">×</button>}
    </span>
  );
}

/** Input + suggestion popover. `onPick` gets a clean tag path. */
export function TagInput({ onPick, exclude = [], onCancel, autoFocus = true, placeholder, className, dropUp }: { onPick: (tag: string) => void; exclude?: string[]; onCancel?: () => void; autoFocus?: boolean; placeholder?: string; className?: string; dropUp?: boolean }) {
  const all = useAllTags();
  const { colors } = useTagMeta();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => fuzzyTags(q, all.filter(([x]) => !exclude.includes(x)), 6), [q, all, exclude]);
  const typed = cleanTag(q);
  useEffect(() => setI(0), [q]);
  // the popover is fixed to the viewport so narrow panels (Properties) and scroll boxes don't clip it
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    const r = ref.current?.parentElement?.getBoundingClientRect();
    if (!r || !q.trim()) return setPos(null);
    const left = Math.max(8, Math.min(r.left, innerWidth - 328));
    setPos(dropUp ? { left, bottom: innerHeight - r.top + 8 } : { left, top: r.bottom + 12 });
  }, [q, dropUp]);
  const pick = (tag: string | null) => { if (!tag) return; onPick(tag); setQ(""); };
  return (
    <div className={cx("relative", className)}>
      <span className="flex h-6 items-center gap-1 rounded-[6px] border border-accent px-2 text-[12.5px]">
        <input ref={ref} autoFocus={autoFocus} value={q} dir="ltr" spellCheck={false} placeholder={placeholder ?? t("Add tag")} aria-label={t("Add tag")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); pick(typed); }
            else if (e.key === "Enter" || e.key === "Tab") { if (q.trim()) { e.preventDefault(); pick(hits[i]?.tag ?? typed); } }
            else if (e.key === "Escape") { e.preventDefault(); if (q) setQ(""); else onCancel?.(); }
          }}
          onBlur={() => setTimeout(() => { if (document.activeElement !== ref.current && !q) onCancel?.(); }, 150)}
          className="w-[72px] min-w-0 bg-transparent text-ink caret-accent outline-none placeholder:text-muted" style={{ width: Math.max(72, q.length * 7.5 + 8) }} />
      </span>
      {q.trim() && pos && (
        <div style={pos} className="fixed z-[70] flex w-[320px] flex-col rounded-[12px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.4)]" data-tag-suggest onMouseDown={(e) => e.preventDefault()}>
          {hits.map((h, k) => {
            const tag = "#" + h.tag, a = tag.slice(0, h.from + 1), hit = tag.slice(h.from + 1, h.to + 1), b = tag.slice(h.to + 1);
            return (
              <button key={h.tag} type="button" onMouseEnter={() => setI(k)} onClick={() => pick(h.tag)} className={cx("flex h-[34px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-start", k === i && "bg-bg")}>
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: tagColor(h.tag, colors) ?? "var(--muted)" }} />
                <span dir="ltr" className="min-w-0 flex-1 truncate"><span className="text-muted">{a}</span><b className="font-semibold text-accent">{hit}</b>{b}</span>
                <span className="text-[11.5px] text-muted">{h.count}</span>
              </button>
            );
          })}
          {typed && !all.some(([x]) => x === typed) && <>
            {hits.length > 0 && <div className="m-1 h-px bg-line" />}
            <button type="button" onClick={() => pick(typed)} className={cx("flex h-[34px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-start", !hits.length && "bg-bg")}>
              <Glyph name="plus" size={14} color="var(--accent)" />{t("Create")} <b dir="ltr" className="font-semibold">#{typed}</b><span className="flex-1" /><span className="font-mono text-[11px] font-medium text-muted">⇧↵</span>
            </button>
          </>}
        </div>
      )}
    </div>
  );
}

/** The note's tags with × and an "add" input (Properties › tags). */
export function NoteTagPicker({ note, onDone }: { note: Note; onDone?: () => void }) {
  const { colors } = useTagMeta();
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1" data-tag-picker>
      {note.tags.map((tag) => <TagChip key={tag} tag={tag} size="md" color={tagColor(tag, colors)} onRemove={() => void removeTagFromNote(note.id, tag)} />)}
      <TagInput exclude={note.tags} onPick={(tag) => void addTagToNotes([note.id], tag)} onCancel={onDone} />
    </div>
  );
}
