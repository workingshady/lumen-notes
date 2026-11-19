// Block menu (Notion "⋮⋮" menu): Turn into · Duplicate · Copy link to block · Move up / down · Delete.
// Opened from the block handle (editor-blocks.ts). Turn-into options reuse the slash catalog's labels and icons.
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Link2, Repeat2, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PANEL_COLOR, SLASH } from "../lib/slash";
import type { TurnTarget } from "../lib/blocks";
import { toast } from "../lib/store";
import { cx } from "./ui";
import { blocksOf, duplicate, ensureId, moveBy, remove, turn, type BlockMenuRequest } from "./editor-blocks";

const slash = (id: string) => SLASH.find((c) => c.id === id);
const CALLOUTS = ["note", "tip", "info", "warning", "important", "question", "example", "danger"];
const TURN: { t: TurnTarget; label: string; icon: string; panel?: string }[] = [
  { t: "paragraph", label: "Text", icon: "¶" },
  { t: "h1", label: slash("h1")?.label ?? "Heading 1", icon: slash("h1")?.icon ?? "H1" },
  { t: "h2", label: slash("h2")?.label ?? "Heading 2", icon: slash("h2")?.icon ?? "H2" },
  { t: "h3", label: slash("h3")?.label ?? "Heading 3", icon: slash("h3")?.icon ?? "H3" },
  { t: "bullet", label: slash("bullet")?.label ?? "Bulleted list", icon: slash("bullet")?.icon ?? "•" },
  { t: "numbered", label: slash("numbered")?.label ?? "Numbered list", icon: slash("numbered")?.icon ?? "1." },
  { t: "todo", label: slash("todo")?.label ?? "Task list", icon: slash("todo")?.icon ?? "☐" },
  { t: "quote", label: slash("quote")?.label ?? "Quote", icon: slash("quote")?.icon ?? "❝" },
  { t: "code", label: slash("code")?.label ?? "Code block", icon: slash("code")?.icon ?? "</>" },
  { t: "toggle", label: slash("toggle")?.label ?? "Toggle / expand", icon: slash("toggle")?.icon ?? "▸" },
  ...CALLOUTS.map((k) => ({ t: `callout:${k}` as TurnTarget, label: `Callout · ${k[0].toUpperCase() + k.slice(1)}`, icon: "", panel: k })),
];

export function BlockMenu({ req, title, onClose }: { req: BlockMenuRequest | null; title: string; onClose: () => void }) {
  const [page, setPage] = useState<"main" | "turn">("main");
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const phone = typeof innerWidth === "number" && innerWidth < 640;

  useEffect(() => { setPage("main"); setSel(0); }, [req]);
  useLayoutEffect(() => {
    if (!req || !ref.current || phone) return;
    const m = ref.current.getBoundingClientRect();
    const rtl = getComputedStyle(req.view.contentDOM).direction === "rtl";
    let left = rtl ? req.rect.left - m.width - 6 : req.rect.right + 6;
    if (left + m.width > innerWidth - 8) left = Math.max(8, req.rect.left - m.width - 6);
    if (left < 8) left = 8;
    const top = Math.max(8, Math.min(req.rect.top - 6, innerHeight - m.height - 8));
    setPos({ left, top });
  }, [req, page, phone]);

  if (!req) return null;
  const { view, idx } = req;
  const n = idx.length;
  const done = (fn: () => unknown) => { fn(); onClose(); view.focus(); };
  const main: { key: string; label: string; icon: React.ReactNode; hint?: string; run: () => void; danger?: boolean; sub?: boolean }[] = [
    { key: "turn", label: "Turn into", icon: <Repeat2 size={15} />, run: () => { setPage("turn"); setSel(0); }, sub: true },
    { key: "dup", label: n > 1 ? `Duplicate ${n} blocks` : "Duplicate", icon: <Copy size={15} />, hint: "Ctrl+Shift+D", run: () => done(() => duplicate(view, idx)) },
    ...(n === 1 ? [{ key: "link", label: "Copy link to block", icon: <Link2 size={15} />, run: () => done(() => copyLink()) }] : []),
    { key: "up", label: "Move up", icon: <ArrowUp size={15} />, hint: "Alt+↑", run: () => done(() => moveBy(view, -1, idx)) },
    { key: "down", label: "Move down", icon: <ArrowDown size={15} />, hint: "Alt+↓", run: () => done(() => moveBy(view, 1, idx)) },
    { key: "del", label: n > 1 ? `Delete ${n} blocks` : "Delete", icon: <Trash2 size={15} />, hint: "Del", run: () => done(() => remove(view, idx)), danger: true },
  ];
  function copyLink() {
    const id = ensureId(view, idx[0]);
    if (!id) return;
    const link = `[[${title}#^${id}]]`;
    void navigator.clipboard?.writeText(link).then(() => toast(`Copied ${link}`), () => toast(link));
  }
  const kinds = new Set(idx.map((i) => blocksOf(view.state).blocks[i]?.kind));
  const count = page === "main" ? main.length : TURN.length;
  const pick = (i: number) => (page === "main" ? main[i].run() : done(() => turn(view, idx, TURN[i].t)));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % count); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s + count - 1) % count); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(sel); }
    else if (e.key === "ArrowRight" && page === "main" && sel === 0) { e.preventDefault(); setPage("turn"); setSel(0); }
    else if ((e.key === "ArrowLeft" || e.key === "Backspace") && page === "turn") { e.preventDefault(); setPage("main"); setSel(0); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(); view.focus(); }
  };

  const row = "flex w-full items-center gap-2.5 rounded-[7px] px-2 text-start text-[13.5px]";
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={(e) => { e.preventDefault(); onClose(); }} onTouchStart={() => onClose()} />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        autoFocus
        onKeyDown={onKey}
        className={cx("blk-menu fixed z-[61] border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)] fade-in outline-none", phone ? "inset-x-2 bottom-2 max-h-[70vh] overflow-y-auto rounded-[14px]" : "w-[236px] max-h-[min(460px,80vh)] overflow-y-auto rounded-[12px]")}
        style={phone ? undefined : pos ? { left: pos.left, top: pos.top } : { left: req.rect.right + 6, top: req.rect.top, visibility: "hidden" }}
      >
        <FocusOnMount />
        {page === "main" ? (
          <>
            <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted">{n > 1 ? `${n} blocks` : [...kinds][0] ?? "Block"}</div>
            {main.map((it, i) => (
              <button key={it.key} role="menuitem" onMouseEnter={() => setSel(i)} onClick={it.run} className={cx(row, phone ? "h-11" : "h-8", sel === i && "bg-surface-2", it.danger && "text-bad")}>
                <span className={cx("flex w-5 justify-center", !it.danger && "text-muted")}>{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.hint && !phone && <span className="text-[11px] text-muted">{it.hint}</span>}
                {it.sub && <ChevronRight size={14} className="text-muted rtl:rotate-180" />}
              </button>
            ))}
          </>
        ) : (
          <>
            <button onClick={() => { setPage("main"); setSel(0); }} className={cx(row, "h-8 text-[12px] font-semibold text-muted")}><ChevronLeft size={14} className="rtl:rotate-180" />Turn into</button>
            {TURN.map((it, i) => (
              <button key={it.t} role="menuitem" onMouseEnter={() => setSel(i)} onClick={() => pick(i)} className={cx(row, phone ? "h-11" : "h-8", sel === i && "bg-surface-2")}>
                <span className="lm-slash-ic !h-6 !w-8 !text-[11.5px]">{it.panel ? <span className="lm-slash-panel" style={{ "--pc": PANEL_COLOR[it.panel] ?? "var(--info)" } as React.CSSProperties} /> : it.icon}</span>
                <span className="flex-1">{it.label}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** Moves keyboard focus into the menu when it opens (arrow keys / Enter / Esc work immediately). */
function FocusOnMount() {
  const r = useRef<HTMLSpanElement>(null);
  useEffect(() => { r.current?.closest<HTMLElement>("[role=menu]")?.focus({ preventScroll: true }); }, []);
  return <span ref={r} hidden />;
}
