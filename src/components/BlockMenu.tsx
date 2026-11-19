// Block menu (design R4-16E desktop popover, R4-16P2 phone sheet): Turn into (glyph grid) · Duplicate · Copy link to
// block · Move up / down · Delete. Opened from the ⋮⋮ handle or the multi-select bar (editor-blocks.ts).
// Every action is one undo step. Keyboard: arrows move (grid then list), Enter picks, Esc closes.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { turnTargetOf, type TurnTarget } from "../lib/blocks";
import { isRtl, t, tk } from "../lib/i18n";
import { toast } from "../lib/store";
import { Glyph } from "./Glyph";
import { blocksOf, duplicate, ensureId, moveBy, remove, turn, type BlockMenuRequest } from "./editor-blocks";

/** Turn-into grid: the design's 12 (text, H1–H3, lists, quote, code, toggle, info, tip) + the other callouts. */
const TURN: { t: TurnTarget; label: string; glyph: string }[] = [
  { t: "paragraph", label: tk("Text"), glyph: "text" }, { t: "h1", label: tk("Heading 1"), glyph: "h1" }, { t: "h2", label: tk("Heading 2"), glyph: "h2" },
  { t: "h3", label: tk("Heading 3"), glyph: "h3" }, { t: "bullet", label: tk("Bulleted list"), glyph: "list" }, { t: "numbered", label: tk("Numbered list"), glyph: "numbered" },
  { t: "todo", label: tk("Task list"), glyph: "task" }, { t: "quote", label: tk("Quote"), glyph: "quote" }, { t: "code", label: tk("Code"), glyph: "code" },
  { t: "toggle", label: tk("Toggle"), glyph: "expand" }, { t: "callout:info", label: tk("Info callout"), glyph: "c-info" }, { t: "callout:tip", label: tk("Tip callout"), glyph: "c-tip" },
  { t: "callout:note", label: tk("Note callout"), glyph: "c-note" }, { t: "callout:warning", label: tk("Warning callout"), glyph: "c-warning" }, { t: "callout:important", label: tk("Important callout"), glyph: "c-warning" },
  { t: "callout:question", label: tk("Question callout"), glyph: "c-question" }, { t: "callout:example", label: tk("Example callout"), glyph: "c-example" }, { t: "callout:danger", label: tk("Danger callout"), glyph: "c-danger" },
];
const COLS = 6;
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
// Shortcut hints as plain text (no symbol glyphs that render as emoji on some platforms)
const K = { dup: MAC ? "Cmd+Shift+D" : "Ctrl+Shift+D", up: MAC ? "Opt+↑" : "Alt+↑", down: MAC ? "Opt+↓" : "Alt+↓", del: "Del" };

export function BlockMenu({ req, title, onClose: close }: { req: BlockMenuRequest | null; title: string; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const phone = typeof innerWidth === "number" && innerWidth < 640;
  const onClose = () => { req?.closed?.(); close(); };

  useEffect(() => { setSel(req?.page === "turn" ? 0 : -1); }, [req]);
  useLayoutEffect(() => {
    if (!req || !ref.current || phone) return;
    const m = ref.current.getBoundingClientRect();
    const rtl = getComputedStyle(req.view.contentDOM).direction === "rtl";
    let left = rtl ? req.rect.right - m.width : req.rect.left;
    if (left + m.width > innerWidth - 8) left = Math.max(8, innerWidth - m.width - 8);
    if (left < 8) left = 8;
    let top = req.rect.bottom + 6;
    if (top + m.height > innerHeight - 8) top = Math.max(8, req.rect.top - m.height - 6);
    setPos({ left, top });
  }, [req, phone]);

  if (!req) return null;
  const { view, idx } = req;
  const n = idx.length;
  const done = (fn: () => unknown) => { fn(); onClose(); view.focus(); };
  const { lines, blocks } = blocksOf(view.state);
  const curT = n === 1 && blocks[idx[0]] ? turnTargetOf(blocks[idx[0]], lines[blocks[idx[0]].a]) : null;
  const acts: { key: string; label: string; glyph: string; k?: string; run: () => void; danger?: boolean; flip?: boolean }[] = [
    { key: "dup", label: n > 1 ? t("Duplicate {n} blocks", { n }) : t("Duplicate"), glyph: "columns-2", k: K.dup, run: () => done(() => duplicate(view, idx)) },
    ...(n === 1 ? [{ key: "link", label: t("Copy link to block"), glyph: "wikilink", run: () => done(() => copyLink()) }] : []),
    { key: "up", label: t("Move up"), glyph: "expand", k: K.up, flip: true, run: () => done(() => moveBy(view, -1, idx)) },
    { key: "down", label: t("Move down"), glyph: "expand", k: K.down, run: () => done(() => moveBy(view, 1, idx)) },
    { key: "del", label: n > 1 ? t("Delete {n} blocks", { n }) : t("Delete"), glyph: "c-danger", k: K.del, run: () => done(() => remove(view, idx)), danger: true },
  ];
  function copyLink() {
    const id = ensureId(view, idx[0]);
    if (!id) return;
    const link = `[[${title}#^${id}]]`;
    void navigator.clipboard?.writeText(link).then(() => toast(t("Copied {link}", { link })), () => toast(link));
  }
  const total = TURN.length + acts.length;
  const pick = (i: number) => (i < TURN.length ? done(() => turn(view, idx, TURN[i].t)) : acts[i - TURN.length].run());
  const onKey = (e: React.KeyboardEvent) => {
    if (sel < 0 && /Arrow/.test(e.key)) { e.preventDefault(); setSel(TURN.length); return; }
    const inGrid = sel < TURN.length;
    let d = 0;
    const fwd = isRtl() ? -1 : 1; // the grid flows with the interface direction
    if (e.key === "ArrowRight") d = inGrid ? fwd : 0;
    else if (e.key === "ArrowLeft") d = inGrid ? -fwd : 0;
    else if (e.key === "ArrowDown") d = inGrid ? (sel + COLS < TURN.length ? COLS : TURN.length - sel) : 1;
    else if (e.key === "ArrowUp") d = inGrid ? -COLS : sel === TURN.length ? -(((TURN.length - 1) % COLS) + 1) : -1;
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(sel); return; }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(); view.focus(); return; }
    if (d) { e.preventDefault(); setSel((s) => Math.max(0, Math.min(total - 1, s + d))); }
  };

  const cell = (it: (typeof TURN)[number], i: number) => {
    const on = sel === i, cur = curT === it.t;
    return (
      <button key={it.t} role="menuitem" title={t(it.label)} aria-label={t("Turn into {type}", { type: t(it.label) })} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}
        className={phone ? "flex size-12 shrink-0 items-center justify-center rounded-[10px] border border-line" : "flex h-8 items-center justify-center rounded-[7px]"}
        style={{ background: cur || (on && !phone) ? "var(--bg)" : "transparent", color: cur ? "var(--accent)" : "var(--text)", boxShadow: on && !cur && !phone ? "inset 0 0 0 1px var(--border)" : undefined }}>
        <Glyph name={it.glyph} size={phone ? 20 : 16} />
      </button>
    );
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" style={phone ? { background: "rgba(5,6,8,.35)" } : undefined} onMouseDown={(e) => { e.preventDefault(); onClose(); }} onTouchStart={() => onClose()} />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKey}
        className={phone
          ? "blk-menu fixed inset-x-0 bottom-0 z-[61] flex max-h-[80vh] flex-col overflow-y-auto rounded-t-[14px] bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5 text-[14px] outline-none fade-in"
          : "blk-menu fixed z-[61] flex w-[250px] flex-col rounded-[12px] border border-line bg-surface-2 p-1 text-[13px] outline-none fade-in"}
        style={phone ? undefined : { left: pos?.left ?? req.rect.left, top: pos?.top ?? req.rect.bottom + 6, visibility: pos ? "visible" : "hidden", boxShadow: "0 18px 44px rgba(0,0,0,.45)" }}
      >
        <FocusOnMount />
        {phone && <div className="flex justify-center pb-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>}
        <span className={phone ? "pb-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted" : "px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted"}>{n > 1 ? t("Turn into · {n} blocks", { n }) : t("Turn into")}</span>
        {phone
          ? <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3">{TURN.map(cell)}</div>
          : <div className="grid grid-cols-6 gap-0.5 px-1 pb-1">{TURN.map(cell)}</div>}
        {!phone && <div className="mx-1 my-0.5 h-px bg-line" />}
        {acts.map((it, j) => {
          const i = TURN.length + j;
          return (
            <button key={it.key} role="menuitem" onMouseEnter={() => setSel(i)} onClick={it.run}
              className={phone ? "flex h-[52px] w-full shrink-0 items-center gap-3 border-t border-line text-start" : "flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-start"}
              style={{ color: it.danger ? "var(--danger)" : "var(--text)", background: sel === i && !phone ? "var(--bg)" : "transparent" }}>
              <Glyph name={it.glyph} size={phone ? 18 : 15} style={it.flip ? { transform: "rotate(180deg)" } : undefined} />
              <span className="flex-1">{it.label}</span>
              {it.k && !phone && <span dir="ltr" className="font-mono text-[11px] font-medium text-muted">{it.k}</span>}
            </button>
          );
        })}
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
