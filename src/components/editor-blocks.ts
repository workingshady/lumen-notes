// Block editing for the CodeMirror Markdown editor (Notion block handle, Confluence multi-select drag & drop,
// Obsidian block references). Pure block logic lives in lib/blocks.ts; this file is the CodeMirror glue:
//   ⋮⋮ handle beside the hovered block (phone: beside the caret's block) · drag = move (drop line) · click = block menu
//   Shift/Ctrl-click (phone: long-press) = multi-select · Alt+↑/↓ move · Mod+Shift+D duplicate · Del/Backspace deletes a
//   block selection · every action is one undo step.
import { isolateHistory } from "@codemirror/commands";
import { type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, Direction, EditorView, MatchDecorator, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  blockIndexAt, blockPreview, deleteBlocks, duplicateBlocks, idInsertion, moveBlocks, newBlockId, parseBlocks, turnBlocks,
  type Block, type LineEdit, type TurnTarget,
} from "../lib/blocks";

// ------------------------------------------------------------------ block cache (parsed once per document version)
const cache = new WeakMap<Text, { lines: string[]; blocks: Block[] }>();
export function blocksOf(state: EditorState) {
  let c = cache.get(state.doc);
  if (!c) { const lines = state.doc.toString().split("\n"); c = { lines, blocks: parseBlocks(lines) }; cache.set(state.doc, c); }
  return c;
}

// ------------------------------------------------------------------ multi-select (start positions of the selected blocks)
const setSel = StateEffect.define<number[]>();
const selField = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSel)) return e.value;
    return tr.docChanged && v.length ? v.map((p) => tr.changes.mapPos(p)) : v;
  },
});
function selectedIdx(state: EditorState): number[] {
  const { blocks } = blocksOf(state);
  const out = new Set<number>();
  for (const p of state.field(selField)) { const i = blockIndexAt(blocks, state.doc.lineAt(Math.min(p, state.doc.length)).number - 1); if (i >= 0) out.add(i); }
  return [...out].sort((a, b) => a - b);
}
const selDeco = EditorView.decorations.compute([selField, "doc"], (state) => {
  const idx = selectedIdx(state);
  if (!idx.length) return Decoration.none;
  const { blocks } = blocksOf(state);
  const b = new RangeSetBuilder<Decoration>();
  for (const i of idx) for (let l = blocks[i].a; l <= blocks[i].b; l++) { const ln = state.doc.line(l + 1); b.add(ln.from, ln.from, Decoration.line({ class: "cm-blk-sel" })); }
  return b.finish();
});
const startOf = (state: EditorState, blk: Block) => state.doc.line(blk.a + 1).from;
function selectBlocks(view: EditorView, idx: number[]) {
  const { blocks } = blocksOf(view.state);
  view.dispatch({ effects: setSel.of(idx.filter((i) => blocks[i]).map((i) => startOf(view.state, blocks[i]))) });
}

// ------------------------------------------------------------------ commands
/** Blocks an action applies to: the multi-selection, else the given block, else the blocks under the text selection. */
export function targets(view: EditorView, idx?: number): number[] {
  const sel = selectedIdx(view.state);
  if (idx != null) return sel.includes(idx) ? sel : [idx];
  if (sel.length) return sel;
  const { blocks } = blocksOf(view.state);
  const { from, to } = view.state.selection.main;
  const la = view.state.doc.lineAt(from).number - 1, lb = view.state.doc.lineAt(to).number - 1;
  const out: number[] = [];
  blocks.forEach((b, i) => { if (b.b >= la && b.a <= lb) out.push(i); });
  return out;
}

function apply(view: EditorView, e: LineEdit | null, event: string, keepSel = 0) {
  if (!e) return false;
  const doc = view.state.doc;
  const from = doc.line(e.aLine + 1).from, to = doc.line(e.bLine + 1).to;
  const k = e.cursor - e.aLine;
  const anchor = from + e.insert.split("\n").slice(0, Math.max(0, k)).reduce((s, l) => s + l.length + 1, 0);
  view.dispatch({
    changes: { from, to, insert: e.insert },
    selection: { anchor: Math.min(anchor, from + e.insert.length) },
    effects: [setSel.of([]), EditorView.scrollIntoView(Math.min(anchor, from + e.insert.length), { y: "nearest", yMargin: 60 })],
    userEvent: event,
    annotations: isolateHistory.of("full"),
  });
  if (keepSel > 1) {
    // keep a moved multi-selection selected
    const { blocks } = blocksOf(view.state);
    const first = blockIndexAt(blocks, view.state.doc.lineAt(view.state.selection.main.head).number - 1);
    if (first >= 0) selectBlocks(view, Array.from({ length: keepSel }, (_, j) => first + j));
  }
  return true;
}

export function moveTo(view: EditorView, idx: number[], before: number) {
  const { lines, blocks } = blocksOf(view.state);
  return apply(view, moveBlocks(lines, blocks, idx, before), "move.block", idx.length);
}
export function moveBy(view: EditorView, dir: -1 | 1, idx?: number[]) {
  const t = idx ?? targets(view);
  if (!t.length) return false;
  const { blocks } = blocksOf(view.state);
  const before = dir < 0 ? t[0] - 1 : t[t.length - 1] + 2;
  if (before < 0 || before > blocks.length) return true;
  return moveTo(view, t, before);
}
export function duplicate(view: EditorView, idx?: number[]) {
  const t = idx ?? targets(view);
  const { lines, blocks } = blocksOf(view.state);
  return apply(view, duplicateBlocks(lines, blocks, t), "input.block.duplicate");
}
export function remove(view: EditorView, idx?: number[]) {
  const t = idx ?? targets(view);
  const { lines, blocks } = blocksOf(view.state);
  return apply(view, deleteBlocks(lines, blocks, t), "delete.block");
}
export function turn(view: EditorView, idx: number[], target: TurnTarget) {
  const { lines, blocks } = blocksOf(view.state);
  return apply(view, turnBlocks(lines, blocks, idx, target), "input.block.turn");
}
/** Ensures the block has a `^id` (one undo step when one is added) and returns it. */
export function ensureId(view: EditorView, idx: number): string | null {
  const { lines, blocks } = blocksOf(view.state);
  const blk = blocks[idx];
  if (!blk) return null;
  if (blk.id) return blk.id;
  const id = newBlockId();
  const ins = idInsertion(lines, blk, id);
  const at = view.state.doc.line(ins.line + 1).from + ins.ch;
  view.dispatch({ changes: { from: at, insert: ins.text }, userEvent: "input.block.id", annotations: isolateHistory.of("full") });
  return id;
}
export const clearBlockSelection = (view: EditorView) => { if (view.state.field(selField, false)?.length) view.dispatch({ effects: setSel.of([]) }); };

// ------------------------------------------------------------------ handle + drag & drop + drop indicator
export interface BlockMenuRequest { view: EditorView; idx: number[]; rect: DOMRect }
export interface BlockHooks { menu: (r: BlockMenuRequest) => void; handles: boolean }

/** First strong letter is Arabic / Hebrew (lines use unicode-bidi: plaintext, so the computed direction stays ltr). */
const rtlText = (s: string) => {
  const m = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]|[֐-ࣿיִ-﷿ﹰ-﻿]/.exec(s.replace(/\[![\w-]+\]|```\w*|:::\s*\w+/g, ""));
  return !!m && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]);
};
const coarse = () => typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
const GRIP = `<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><g fill="currentColor"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="8" r="1.4"/><circle cx="8.5" cy="8" r="1.4"/><circle cx="3.5" cy="13" r="1.4"/><circle cx="8.5" cy="13" r="1.4"/></g></svg>`;

function handlePlugin(hooks: BlockHooks) {
  return ViewPlugin.fromClass(class {
    handle: HTMLButtonElement;
    drop: HTMLDivElement;
    cur = -1;
    hideT: ReturnType<typeof setTimeout> | undefined;
    drag: { id: number; x: number; y: number; idx: number; moving: boolean; moved: number[]; t: number; long: boolean; lpT?: ReturnType<typeof setTimeout>; raf?: number; cy: number } | null = null;
    tight = false;
    lastX = 0;
    constructor(readonly view: EditorView) {
      const h = (this.handle = document.createElement("button"));
      h.type = "button";
      h.className = "cm-blk-handle";
      h.tabIndex = -1;
      h.title = "Drag to move · click for block menu · Shift-click to select several";
      h.setAttribute("aria-label", "Block menu");
      h.innerHTML = GRIP;
      h.style.display = "none";
      this.drop = document.createElement("div");
      this.drop.className = "cm-blk-drop";
      this.drop.style.display = "none";
      view.scrollDOM.append(h, this.drop);
      view.scrollDOM.addEventListener("pointermove", this.onHover);
      view.scrollDOM.addEventListener("pointerleave", this.onLeave);
      h.addEventListener("pointerdown", this.onDown);
      h.addEventListener("pointermove", this.onMove);
      h.addEventListener("pointerup", this.onUp);
      h.addEventListener("pointercancel", this.onCancel);
      h.addEventListener("contextmenu", (e) => e.preventDefault());
      if (coarse()) this.follow();
    }
    update(u: ViewUpdate) {
      if (this.drag?.moving) return;
      if (coarse() && (u.selectionSet || u.focusChanged || u.docChanged)) { this.follow(); return; }
      if (u.docChanged) { const { blocks } = blocksOf(u.state); if (this.cur >= blocks.length) this.cur = -1; }
      if (u.docChanged || u.geometryChanged || u.viewportChanged) this.place();
    }
    /** Phone: the handle sits beside the block with the caret. */
    follow() {
      const st = this.view.state;
      this.cur = this.view.hasFocus ? blockIndexAt(blocksOf(st).blocks, st.doc.lineAt(st.selection.main.head).number - 1) : -1;
      this.place();
    }
    onHover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || this.drag) return;
      if (e.target === this.handle || this.handle.contains(e.target as Node)) { clearTimeout(this.hideT); return; }
      const v = this.view;
      const lb = v.lineBlockAtHeight(e.clientY - v.documentTop);
      const i = blockIndexAt(blocksOf(v.state).blocks, v.state.doc.lineAt(lb.from).number - 1);
      if (i < 0) { this.hideSoon(); return; }
      clearTimeout(this.hideT);
      if (i !== this.cur) { this.cur = i; this.place(); }
    };
    onLeave = () => { if (!this.drag && !coarse()) this.hideSoon(); };
    hideSoon() { clearTimeout(this.hideT); this.hideT = setTimeout(() => { this.cur = -1; this.handle.style.display = "none"; }, 250); }
    place() {
      const v = this.view;
      if (!hooks.handles || this.cur < 0) { this.handle.style.display = "none"; return; }
      v.requestMeasure({
        key: this,
        read: () => {
          const { blocks } = blocksOf(v.state);
          const blk = blocks[this.cur];
          if (!blk) return null;
          const line = v.state.doc.line(blk.a + 1);
          if (line.from < v.viewport.from || line.from > v.viewport.to) return null;
          const sr = v.scrollDOM.getBoundingClientRect();
          const cr = v.contentDOM.getBoundingClientRect();
          const cs = getComputedStyle(v.contentDOM);
          const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
          const c = v.coordsAtPos(line.from, 1) ?? v.coordsAtPos(line.from);
          const lb = v.lineBlockAt(line.from);
          const top = c ? c.top : lb.top + v.documentTop;
          const h = c ? Math.min(c.bottom - c.top, 44) : Math.min(lb.height, v.defaultLineHeight);
          const gut = v.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
          const limit = gut && gut.width ? gut.right : sr.left;
          const textL = cr.left + padL, textR = cr.right - padR;
          const natural = textL - (this.tight ? 20 : 0) - limit;
          const rtl = rtlText(line.text) || v.textDirectionAt(line.from) === Direction.RTL;
          const roomR = sr.right - 14 - textR;
          const x = rtl && roomR >= 26 ? textR + 4 : Math.max(limit, textL - 24);
          return { x: x - sr.left + v.scrollDOM.scrollLeft, y: top + h / 2 - 12 - sr.top + v.scrollDOM.scrollTop, needTight: natural < 24, sel: selectedIdx(v.state).includes(this.cur) };
        },
        write: (m) => {
          if (!m) { this.handle.style.display = "none"; return; }
          if (m.needTight !== this.tight) { this.tight = m.needTight; v.dom.classList.toggle("cm-blk-tight", this.tight); requestAnimationFrame(() => this.place()); }
          this.handle.style.display = "";
          this.lastX = m.x;
          this.handle.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`;
          this.handle.classList.toggle("on", m.sel);
        },
      });
    }
    // --- pointer: click = menu, Shift/Ctrl-click or long-press = select, drag = move
    onDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.cur < 0) return;
      e.preventDefault();
      clearTimeout(this.hideT);
      this.handle.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, idx: this.cur, moving: false, moved: [], t: -1, long: false, cy: e.clientY };
      if (e.pointerType !== "mouse") {
        const d = this.drag;
        d.lpT = setTimeout(() => { if (this.drag === d && !d.moving) { d.long = true; this.toggle(d.idx); navigator.vibrate?.(15); } }, 480);
      }
    };
    onMove = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      d.cy = e.clientY;
      if (!d.moving) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 || d.long) return;
        clearTimeout(d.lpT);
        d.moving = true;
        d.moved = targets(this.view, d.idx);
        selectBlocks(this.view, d.moved);
        this.view.dom.classList.add("cm-blk-dragging");
        this.autoScroll();
      }
      this.track();
    };
    track() {
      const d = this.drag!;
      const v = this.view;
      const { blocks } = blocksOf(v.state);
      const top = (i: number) => v.lineBlockAt(v.state.doc.line(blocks[i].a + 1).from).top + v.documentTop;
      const bot = (i: number) => v.lineBlockAt(v.state.doc.line(blocks[i].b + 1).to).bottom + v.documentTop;
      let t = blocks.length;
      for (let i = 0; i < blocks.length; i++) if ((top(i) + bot(i)) / 2 > d.cy) { t = i; break; }
      d.t = t;
      const y = !blocks.length ? 0 : t === 0 ? top(0) - 3 : t === blocks.length ? bot(blocks.length - 1) + 3 : (bot(t - 1) + top(t)) / 2;
      const sr = v.scrollDOM.getBoundingClientRect(), cr = v.contentDOM.getBoundingClientRect();
      const noop = d.moved.every((x, k) => x === d.moved[0] + k) && t >= d.moved[0] && t <= d.moved[d.moved.length - 1] + 1;
      Object.assign(this.drop.style, { display: noop ? "none" : "", transform: `translate(${Math.round(cr.left - sr.left + v.scrollDOM.scrollLeft)}px, ${Math.round(y - sr.top + v.scrollDOM.scrollTop - 1)}px)`, width: `${Math.round(cr.width)}px` });
      this.handle.style.transform = `translate(${Math.round(this.lastX)}px, ${Math.round(d.cy - sr.top + v.scrollDOM.scrollTop - 12)}px)`;
    }
    autoScroll() {
      const step = () => {
        const d = this.drag;
        if (!d?.moving) return;
        const sr = this.view.scrollDOM.getBoundingClientRect();
        const dy = d.cy < sr.top + 48 ? -Math.ceil((sr.top + 48 - d.cy) / 4) : d.cy > sr.bottom - 48 ? Math.ceil((d.cy - sr.bottom + 48) / 4) : 0;
        if (dy) { this.view.scrollDOM.scrollTop += dy; this.track(); }
        d.raf = requestAnimationFrame(step);
      };
      this.drag!.raf = requestAnimationFrame(step);
    }
    onUp = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.end();
      if (d.moving) {
        if (d.t >= 0) moveTo(this.view, d.moved, d.t);
        if (d.moved.length < 2) clearBlockSelection(this.view);
        this.view.focus();
      } else if (!d.long) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggle(d.idx);
        else hooks.menu({ view: this.view, idx: targets(this.view, d.idx), rect: this.handle.getBoundingClientRect() });
      }
      if (coarse()) this.follow(); else this.place();
    };
    onCancel = () => { if (this.drag?.moving) clearBlockSelection(this.view); this.end(); this.place(); };
    end() {
      const d = this.drag;
      if (d) { clearTimeout(d.lpT); if (d.raf) cancelAnimationFrame(d.raf); try { this.handle.releasePointerCapture(d.id); } catch { /* ignore */ } }
      this.drag = null;
      this.drop.style.display = "none";
      this.view.dom.classList.remove("cm-blk-dragging");
    }
    toggle(i: number) {
      const cur = selectedIdx(this.view.state);
      selectBlocks(this.view, cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]);
      this.place();
    }
    destroy() {
      this.end();
      clearTimeout(this.hideT);
      this.view.scrollDOM.removeEventListener("pointermove", this.onHover);
      this.view.scrollDOM.removeEventListener("pointerleave", this.onLeave);
      this.handle.remove();
      this.drop.remove();
      this.view.dom.classList.remove("cm-blk-tight");
    }
  });
}

// ------------------------------------------------------------------ `^id` dimmed in the source
const idDeco = new MatchDecorator({ regexp: /(?<=^|\s)\^[A-Za-z0-9-]+\s*$/g, decoration: Decoration.mark({ class: "cm-blkid" }) });
const idMarks = ViewPlugin.fromClass(class { d: DecorationSet; constructor(v: EditorView) { this.d = idDeco.createDeco(v); } update(u: ViewUpdate) { this.d = idDeco.updateDeco(u, this.d); } }, { decorations: (p) => p.d });

export function blockEditing(hooks: BlockHooks): Extension {
  return [
    selField,
    selDeco,
    idMarks,
    handlePlugin(hooks),
    EditorView.theme({ ".cm-scroller": { position: "relative" } }),
    Prec.highest(EditorView.domEventHandlers({
      keydown: (e, v) => {
        // Mod+Shift+D duplicates the block (and must not reach the global dev-panel shortcut).
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); e.stopPropagation(); duplicate(v); return true; }
        return false;
      },
      mousedown: (e, v) => { if (!e.shiftKey) clearBlockSelection(v); return false; },
    })),
    Prec.high(keymap.of([
      { key: "Alt-ArrowUp", run: (v) => moveBy(v, -1) },
      { key: "Alt-ArrowDown", run: (v) => moveBy(v, 1) },
      { key: "Escape", run: (v) => { if (!v.state.field(selField).length) return false; clearBlockSelection(v); return true; } },
      { key: "Delete", run: (v) => (v.state.field(selField).length ? remove(v) : false) },
      { key: "Backspace", run: (v) => (v.state.field(selField).length ? remove(v) : false) },
    ])),
  ];
}

// ------------------------------------------------------------------ [[Note#^ → blocks of that note
export interface RefNote { id: string; title: string; body: string }
/**
 * Completion after `[[Note#^` (or `[[#^` for this note): lists the note's blocks; picking one without an id adds
 * `^id` to that block (in this editor for the current note, via `saveOther` for another note).
 */
export function blockRefSource(notes: () => RefNote[], currentTitle: () => string, saveOther: (id: string, body: string) => void) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[([^\]\n#|]*)#\^[\w-]*/);
    if (!m) return null;
    const hash = m.text.indexOf("#^");
    const title = m.text.slice(2, hash).trim();
    const q = m.text.slice(hash + 2).toLowerCase();
    const self = !title || title.toLowerCase() === currentTitle().toLowerCase();
    const note = self ? null : notes().find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (!self && !note) return null;
    const lines = self ? ctx.state.doc.toString().split("\n") : note!.body.split("\n");
    const blocks = parseBlocks(lines).filter((b) => b.kind !== "hr");
    const options: Completion[] = [];
    for (const blk of blocks) {
      const text = lines.slice(blk.a, blk.b + 1).join("\n");
      const label = blockPreview(text, blk.kind);
      if (q && !(blk.id ?? "").toLowerCase().startsWith(q) && !label.toLowerCase().includes(q)) continue;
      options.push({
        label,
        detail: blk.id ? `^${blk.id}` : blk.kind,
        type: "text",
        apply: (view, _c, from, to) => {
          const id = blk.id ?? newBlockId();
          const close = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
          const changes = [{ from, to, insert: id + close }];
          if (!blk.id) {
            const ins = idInsertion(lines, blk, id);
            if (self) changes.push({ from: view.state.doc.line(ins.line + 1).from + ins.ch, to: view.state.doc.line(ins.line + 1).from + ins.ch, insert: ins.text });
            else {
              const ls = [...lines];
              ls[ins.line] = ls[ins.line].slice(0, ins.ch) + ins.text + ls[ins.line].slice(ins.ch);
              saveOther(note!.id, ls.join("\n"));
            }
          }
          const cs = view.state.changes(changes.sort((a, b) => a.from - b.from));
          view.dispatch({ changes: cs, selection: { anchor: cs.mapPos(to, 1) }, userEvent: "input.complete" });
        },
      });
    }
    return { from: m.from + hash + 2, options, filter: false };
  };
}
