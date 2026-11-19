// "/" menu (design R4-16A slash · recent + groups, R4-16B no results, R4-16P1 phone sheet with search).
// The CodeMirror side (slashMenu) only detects "/query" at the caret and forwards the keys; the menu itself is React:
// desktop = a 380 px popover under the "/", phone = a bottom sheet with its own search field.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applySlash, recentSlash, SLASH, SLASH_GROUPS, slashContext, slashMatch, slashSearchAll, slashSuggest, type SlashCommand, type SlashContext } from "../lib/slash";
import { t, tk } from "../lib/i18n";
import { setUI } from "../lib/store";
import { Glyph } from "./Glyph";
import { openInsertGallery } from "./InsertGallery";

export interface SlashState { ctx: SlashContext; view: EditorView }
interface Hooks { change: (s: SlashState | null) => void; key: (k: "up" | "down" | "enter" | "esc") => boolean }

// ------------------------------------------------------------------ CodeMirror glue
const plugin = ViewPlugin.fromClass(class {
  ctx: SlashContext | null = null;
  dismissed: number | null = null;
  hooks: Hooks | null = null;
  constructor(readonly view: EditorView) {}
  update(u: ViewUpdate) {
    if (!u.docChanged && !u.selectionSet && !u.focusChanged) return;
    this.refresh();
  }
  refresh() {
    const c = slashContext(this.view.state);
    if (!c || c.from !== this.dismissed) this.dismissed = null;
    const next = c && this.dismissed == null ? c : null;
    const same = (next && this.ctx && next.from === this.ctx.from && next.query === this.ctx.query && next.to === this.ctx.to) || (!next && !this.ctx);
    this.ctx = next;
    if (!same) { const h = this.hooks, v = this.view; queueMicrotask(() => h?.change(next ? { ctx: next, view: v } : null)); }
  }
  dismiss() { if (this.ctx) { this.dismissed = this.ctx.from; this.ctx = null; const h = this.hooks; queueMicrotask(() => h?.change(null)); } }
});
export function dismissSlash(view: EditorView) { view.plugin(plugin)?.dismiss(); }

export function slashMenu(hooks: Hooks): Extension {
  const run = (k: "up" | "down" | "enter" | "esc") => (v: EditorView) => {
    const p = v.plugin(plugin);
    if (!p?.ctx) return false;
    if (k === "esc") { p.dismiss(); return true; }
    return hooks.key(k);
  };
  return [
    plugin,
    ViewPlugin.define((v) => { const p = v.plugin(plugin); if (p) { p.hooks = hooks; p.refresh(); } return {}; }),
    Prec.highest(keymap.of([
      { key: "ArrowDown", run: run("down") }, { key: "ArrowUp", run: run("up") },
      { key: "Enter", run: run("enter") }, { key: "Tab", run: run("enter") }, { key: "Escape", run: run("esc") },
    ])),
  ];
}

// ------------------------------------------------------------------ menu
type Row = { kind: "head"; label: string } | { kind: "cmd"; c: SlashCommand; i: number };
function rowsFor(query: string, all = false): { rows: Row[]; cmds: SlashCommand[] } {
  const rows: Row[] = [];
  const cmds: SlashCommand[] = [];
  const push = (c: SlashCommand) => { rows.push({ kind: "cmd", c, i: cmds.length }); cmds.push(c); };
  if (!query && !all) {
    const rec = recentSlash();
    if (rec.length) { rows.push({ kind: "head", label: tk("Recent") }); rec.forEach(push); }
    for (const g of SLASH_GROUPS) { rows.push({ kind: "head", label: g }); SLASH.filter((c) => c.group === g).forEach(push); }
  } else (all ? slashSearchAll(query) : slashMatch(query)).forEach(push);
  return { rows, cmds };
}

export function SlashMenu({ state, onAction, phone, box }: {
  state: SlashState; phone: boolean; box: HTMLElement | null;
  onAction: (a: NonNullable<SlashCommand["action"]>, view: EditorView) => void;
}) {
  const { ctx, view } = state;
  const [search, setSearch] = useState(""); // phone sheet search / "Search all commands"
  const [all, setAll] = useState(false);
  const q = phone ? search : ctx.query;
  const { rows, cmds } = useMemo(() => rowsFor(q.replace(/^\/(?=.)/, "/"), all), [q, all]);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => setSel(0), [q, all]);
  useEffect(() => { setAll(false); }, [ctx.from]);

  const pick = (c: SlashCommand | undefined) => {
    if (!c) return;
    const cur = view.plugin(plugin)?.ctx ?? ctx;
    if (c.action) { view.dispatch({ changes: { from: cur.from, to: cur.to, insert: "" } }); onAction(c.action, view); return; }
    applySlash(view, c, cur.from, cur.to);
  };
  // keys forwarded from the editor (desktop)
  const keyRef = useRef<(k: "up" | "down" | "enter" | "esc") => boolean>(() => false);
  keyRef.current = (k) => {
    if (k === "down") setSel((s) => (cmds.length ? (s + 1) % cmds.length : 0));
    else if (k === "up") setSel((s) => (cmds.length ? (s + cmds.length - 1) % cmds.length : 0));
    else if (k === "enter") { if (!cmds.length) return false; pick(cmds[sel]); }
    return true;
  };
  slashKeys.current = keyRef;
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  // place the popover under the "/" (flip above when there is no room)
  useLayoutEffect(() => {
    if (phone || !box || !popRef.current) return;
    const c = view.coordsAtPos(ctx.from);
    if (!c) return;
    const b = box.getBoundingClientRect();
    const h = popRef.current.offsetHeight, w = popRef.current.offsetWidth;
    let top = c.bottom - b.top + 26;
    if (top + h > b.height - 8 && c.top - b.top - h - 10 > 8) top = c.top - b.top - h - 10;
    const left = Math.max(8, Math.min(c.left - b.left, b.width - w - 8));
    setPos({ left, top });
  }, [ctx.from, phone, box, view, rows.length]);

  const empty = !cmds.length;
  const sug = empty ? slashSuggest(q) : null;
  const searchAll = () => {
    // the command palette, prefilled with the query
    setUI({ palette: true });
    setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>("[data-palette] input, .palette input, [role=dialog] input[type=text], [role=dialog] input:not([type])");
      if (!inp) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(inp, q);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, 60);
  };
  const close = () => dismissSlash(view);

  if (phone) return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={(e) => { e.preventDefault(); close(); }} onTouchStart={close} />
      <div className="slash-sheet fixed inset-x-0 bottom-0 z-[61] flex h-[min(640px,72vh)] flex-col rounded-t-[14px] bg-surface text-[14px] text-ink fade-in" role="listbox" aria-label={t("Insert a block")}>
        <div className="flex justify-center py-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <label className="mx-4 mb-2 flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-accent bg-bg px-3 text-muted">
          <Glyph name="query" size={16} />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search blocks")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pick(cmds[sel]); } else if (e.key === "Escape") close(); }} />
        </label>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {rows.map((r, k) => r.kind === "head" ? (
            <div key={"h" + k} className="px-5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t(r.label)}</div>
          ) : (
            <button key={r.c.id + k} data-i={r.i} role="option" aria-selected={sel === r.i} onClick={() => pick(r.c)} className="flex h-[52px] w-full items-center gap-3 px-4 text-start active:bg-surface-2">
              <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] border border-line bg-bg"><Glyph name={r.c.glyph} size={18} /></span>
              <span className="flex min-w-0 flex-col"><span className="font-medium leading-[18px]">{t(r.c.label)}</span><span className="truncate text-[12px] leading-4 text-muted">{t(r.c.hint)}</span></span>
            </button>
          ))}
          {empty && <NoResults q={q} sug={sug!} onAll={() => setAll(true)} />}
        </div>
      </div>
    </>,
    document.body,
  );

  return (
    <div ref={popRef} className="slash-pop absolute z-40 flex w-[380px] max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-[12px] border border-line bg-surface-2 text-[13px] text-ink fade-in"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden", boxShadow: "0 18px 44px rgba(0,0,0,.45)" }}
      role="listbox" aria-label={t("Insert a block")} onMouseDown={(e) => e.preventDefault()}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-muted">
        <span className="font-mono text-ink" dir="auto">/{ctx.query}</span><span className="flex-1" />
        {empty || q ? t("{n} result|{n} results", { n: empty ? 0 : cmds.length }) : t("{n} block|{n} blocks", { n: SLASH.length })}
      </div>
      {!empty ? (
        <div ref={listRef} className="flex max-h-[430px] flex-col overflow-y-auto p-1">
          {rows.map((r, k) => r.kind === "head" ? (
            <div key={"h" + k} className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t(r.label)}</div>
          ) : (
            <button key={r.c.id + k} data-i={r.i} role="option" aria-selected={sel === r.i} onMouseMove={() => sel !== r.i && setSel(r.i)} onClick={() => pick(r.c)}
              className="flex h-10 shrink-0 items-center gap-2.5 rounded-[8px] px-2 text-start" style={{ background: sel === r.i ? "var(--bg)" : "transparent" }}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-line bg-bg"><Glyph name={r.c.glyph} size={16} /></span>
              <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium leading-4">{t(r.c.label)}</span><span className="truncate text-[11.5px] leading-[15px] text-muted">{t(r.c.hint)}</span></span>
              {r.c.sc && <span dir="ltr" className="shrink-0 font-mono text-[11px] font-medium text-muted">{r.c.sc}</span>}
            </button>
          ))}
        </div>
      ) : <NoResults q={q} sug={sug!} onAll={all ? searchAll : () => setAll(true)} />}
      <div className="flex gap-3 border-t border-line px-3 py-[7px] text-[11.5px] text-muted">
        <span>{t("↑↓ move")}</span><span>{t("↵ insert")}</span><span>{t("// today's date")}</span><span className="flex-1" />
        <button className="hover:text-ink" onClick={() => { const cur = view.plugin(plugin)?.ctx ?? ctx; openInsertGallery({ view, from: cur.from, to: cur.to }); }}>{t("Insert gallery…")}</button>
      </div>
    </div>
  );
}

function NoResults({ q, sug, onAll }: { q: string; sug: { word: string; more: string }; onAll: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2.5 px-4 py-[22px]">
      <span className="font-semibold">{t("No block called “{q}”", { q: q.trim() })}</span>
      <span className="leading-[18px] text-muted">{sug.more ? t("Try “{word}”, {more}", { word: sug.word, more: t(sug.more) }) : t("Try “{word}”.", { word: sug.word })}</span>
      <button onClick={onAll} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 hover:bg-bg"><Glyph name="query" size={14} />{t("Search all commands")}</button>
    </div>
  );
}

/** The open menu's key handler (the editor keymap calls it). */
export const slashKeys: { current: { current: (k: "up" | "down" | "enter" | "esc") => boolean } | null } = { current: null };
