// Block editing for the CodeMirror Markdown editor (Notion block handle, Confluence multi-select drag & drop,
// Obsidian block references). Pure block logic lives in lib/blocks.ts; this file is the CodeMirror glue:
//   ⋮⋮ handle beside the hovered block (phone: beside the caret's block) · drag = move (drop line) · click = block menu
//   Shift/Ctrl-click (phone: long-press) = multi-select · Alt+↑/↓ move · Mod+Shift+D duplicate · Del/Backspace deletes a
//   block selection · every action is one undo step.
import { isolateHistory } from "@codemirror/commands";
import { type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, Direction, EditorView, MatchDecorator, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  blockGlyph, blockIndexAt, blockPreview, deleteBlocks, duplicateBlocks, idInsertion, moveBlocks, newBlockId, parseBlocks, turnBlocks,
  type Block, type LineEdit, type TurnTarget,
} from "../lib/blocks";
import { t } from "../lib/i18n";

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
// Design R4-16D/E/F: ⋮⋮ handle 22×24 beside the hovered block (muted at rest, solid when grabbed or its menu is open),
// the hovered block washes in --surface, a dragged block lifts (copy follows the pointer) while the source fades to 35%,
// a 2 px accent line shows where it lands; selected blocks get a 12% accent wash + ring and a check in the margin.
export interface BlockMenuRequest { view: EditorView; idx: number[]; rect: DOMRect; page?: "turn"; closed?: () => void }
export interface BlockHooks { menu: (r: BlockMenuRequest) => void; handles: boolean }
const hooksOf = new WeakMap<EditorView, BlockHooks>();

/** First strong letter is Arabic / Hebrew (lines use unicode-bidi: plaintext, so the computed direction stays ltr). */
const rtlText = (s: string) => {
  const m = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]|[֐-ࣿיִ-﷿ﹰ-﻿]/.exec(s.replace(/\[![\w-]+\]|```\w*|:::\s*\w+/g, ""));
  return !!m && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]);
};
const coarse = () => typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
const GRIP = "⋮⋮";

interface Geo { x: number; y: number; bl: number; bt: number; bw: number; bh: number; rtl: boolean }
function openMenu(view: EditorView, idx: number[], rect: DOMRect, page?: "turn", closed?: () => void) {
  hooksOf.get(view)?.menu({ view, idx, rect, page, closed });
}

function handlePlugin(hooks: BlockHooks) {
  return ViewPlugin.fromClass(class {
    handle: HTMLButtonElement;
    drop: HTMLDivElement;
    hl: HTMLDivElement;
    lift: HTMLDivElement;
    sels: HTMLDivElement[] = [];
    cur = -1;
    menuOpen = false;
    hideT: ReturnType<typeof setTimeout> | undefined;
    drag: { id: number; x: number; y: number; idx: number; moving: boolean; moved: number[]; t: number; long: boolean; lpT?: ReturnType<typeof setTimeout>; raf?: number; cy: number; off: number } | null = null;
    tight = false;
    rtlRoom = false;
    geo: Geo | null = null;
    constructor(readonly view: EditorView) {
      hooksOf.set(view, hooks);
      const h = (this.handle = document.createElement("button"));
      h.type = "button";
      h.className = "cm-blk-handle";
      h.tabIndex = -1;
      h.title = t("Drag to move · click for block menu · Shift-click to select several");
      h.setAttribute("aria-label", t("Block menu"));
      h.textContent = GRIP;
      h.style.display = "none";
      this.drop = document.createElement("div");
      this.drop.className = "cm-blk-drop";
      this.drop.style.display = "none";
      this.hl = document.createElement("div");
      this.hl.className = "cm-blk-hl";
      this.hl.style.display = "none";
      this.lift = document.createElement("div");
      this.lift.className = "cm-blk-lift";
      this.lift.style.display = "none";
      view.scrollDOM.prepend(this.hl);
      view.scrollDOM.append(h, this.drop, this.lift);
      view.scrollDOM.addEventListener("pointermove", this.onHover);
      view.scrollDOM.addEventListener("pointerleave", this.onLeave);
      h.addEventListener("pointerdown", this.onDown);
      h.addEventListener("pointermove", this.onMove);
      h.addEventListener("pointerup", this.onUp);
      h.addEventListener("pointercancel", this.onCancel);
      h.addEventListener("contextmenu", (e) => e.preventDefault());
      if (coarse()) this.follow(); else this.place();
    }
    update(u: ViewUpdate) {
      if (this.drag?.moving) return;
      if (coarse() && (u.selectionSet || u.focusChanged || u.docChanged)) { this.follow(); return; }
      if (u.docChanged) { const { blocks } = blocksOf(u.state); if (this.cur >= blocks.length) this.cur = -1; }
      if (u.docChanged || u.geometryChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setSel)))) this.place();
    }
    /** Phone: the handle sits beside the block with the caret. */
    follow() {
      const st = this.view.state;
      this.cur = this.view.hasFocus ? blockIndexAt(blocksOf(st).blocks, st.doc.lineAt(st.selection.main.head).number - 1) : -1;
      this.place();
    }
    onHover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || this.drag || this.menuOpen) return;
      if (e.target === this.handle || this.handle.contains(e.target as Node)) { clearTimeout(this.hideT); return; }
      const v = this.view;
      const lb = v.lineBlockAtHeight(e.clientY - v.documentTop);
      const i = blockIndexAt(blocksOf(v.state).blocks, v.state.doc.lineAt(lb.from).number - 1);
      if (i < 0) { this.hideSoon(); return; }
      clearTimeout(this.hideT);
      if (i !== this.cur) { this.cur = i; this.place(); }
    };
    onLeave = () => { if (!this.drag && !coarse() && !this.menuOpen) this.hideSoon(); };
    hideSoon() { clearTimeout(this.hideT); this.hideT = setTimeout(() => { this.cur = -1; this.place(); }, 250); }
    /** Rect of a block in scroller coordinates: text box + where the handle / check go. */
    measure(i: number, page: boolean): Geo | null {
      const v = this.view;
      const { blocks } = blocksOf(v.state);
      const blk = blocks[i];
      if (!blk) return null;
      const doc = v.state.doc;
      const line = doc.line(blk.a + 1), last = doc.line(Math.min(doc.lines, blk.b + 1));
      const sr = v.scrollDOM.getBoundingClientRect();
      const cr = v.contentDOM.getBoundingClientRect();
      const cs = getComputedStyle(v.contentDOM);
      const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
      const lbA = v.lineBlockAt(line.from), lbB = v.lineBlockAt(last.from);
      const top = lbA.top + v.documentTop;
      let bottom = lbB.bottom + v.documentTop;
      // the "N blocks selected" bar sits in the last block's line box: keep it outside the wash
      const bar = v.dom.querySelector(".cm-blk-selbar")?.getBoundingClientRect();
      if (bar && bar.top > top && bar.top < bottom) bottom = bar.top;
      const inView = line.from >= v.viewport.from && line.from <= v.viewport.to;
      const c = inView ? v.coordsAtPos(line.from, 1) ?? v.coordsAtPos(line.from) : null;
      const lh = c ? Math.min(c.bottom - c.top, 44) : Math.min(lbA.height, v.defaultLineHeight);
      const lt = c ? c.top : top;
      const gut = v.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
      const limit = gut && gut.width ? gut.right : sr.left;
      const textL = cr.left + padL, textR = cr.right - padR;
      const rtl = rtlText(line.text) || v.textDirectionAt(line.from) === Direction.RTL;
      const roomR = sr.right - 14 - textR;
      const x = rtl && roomR >= 26 ? textR + (page ? 18 : 4) : Math.max(limit, textL - (page ? 40 : 24));
      const pad = page ? 10 : 6;
      return { x: x - sr.left + v.scrollDOM.scrollLeft, y: lt + lh / 2 - 12 - sr.top + v.scrollDOM.scrollTop, bl: textL - pad - sr.left + v.scrollDOM.scrollLeft, bt: top - 3 - sr.top + v.scrollDOM.scrollTop, bw: textR - textL + pad * 2, bh: bottom - top + 6, rtl };
    }
    place() {
      const v = this.view;
      const page = !!v.dom.closest(".ed-page, .ed-live");
      v.requestMeasure({
        key: this,
        read: () => {
          const sr = v.scrollDOM.getBoundingClientRect(), cr = v.contentDOM.getBoundingClientRect();
          const gut = v.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
          const limit = gut && gut.width ? gut.right : sr.left;
          const natural = cr.left + (parseFloat(getComputedStyle(v.contentDOM).paddingLeft) || 0) - (this.tight ? 20 : 0) - limit;
          const sel = selectedIdx(v.state);
          return {
            g: hooks.handles && this.cur >= 0 ? this.measure(this.cur, page) : null,
            sel: hooks.handles ? sel.map((i) => this.measure(i, page)).filter((x): x is Geo => !!x) : [],
            on: sel.includes(this.cur), needTight: natural < (page ? 40 : 24), page,
            // Arabic / Hebrew blocks keep their handle on the right (R4-16P3): make room there when the pane has none
            rtlRoom: hooks.handles && sr.right - 14 - (cr.right - (parseFloat(getComputedStyle(v.contentDOM).paddingRight) || 0)) < 26 + (this.rtlRoom ? 40 : 0)
              && v.visibleRanges.some(({ from, to }) => { for (let p = from; p <= to;) { const l = v.state.doc.lineAt(p); if (rtlText(l.text)) return true; p = l.to + 1; } return false; }),
          };
        },
        write: (m) => {
          if (m.needTight !== this.tight) { this.tight = m.needTight; v.scrollDOM.classList.toggle("cm-blk-tight", this.tight); requestAnimationFrame(() => this.place()); }
          if (m.rtlRoom !== this.rtlRoom) { this.rtlRoom = m.rtlRoom; v.scrollDOM.classList.toggle("cm-blk-rtlroom", this.rtlRoom); requestAnimationFrame(() => this.place()); }
          this.geo = m.g;
          // selection washes + margin checks
          while (this.sels.length < m.sel.length) { const d = document.createElement("div"); d.className = "cm-blk-selbox"; d.innerHTML = `<span class="cm-blk-check"></span>`; v.scrollDOM.prepend(d); this.sels.push(d); }
          this.sels.forEach((d, k) => {
            const g = m.sel[k];
            if (!g) { d.style.display = "none"; return; }
            Object.assign(d.style, { display: "", transform: `translate(${Math.round(g.bl)}px, ${Math.round(g.bt)}px)`, width: `${Math.round(g.bw)}px`, height: `${Math.round(g.bh)}px` });
            d.classList.toggle("rtl", g.rtl);
            d.classList.toggle("nocheck", !m.page || this.tight);
          });
          const g = m.g;
          if (!g) { this.handle.style.display = "none"; this.hl.style.display = "none"; return; }
          this.handle.style.display = "";
          this.handle.style.transform = `translate(${Math.round(g.x)}px, ${Math.round(g.y)}px)`;
          this.handle.classList.toggle("on", m.on);
          this.handle.classList.toggle("open", this.menuOpen);
          // hover wash (not on a selected block: that one already has its own)
          if (m.on || coarse()) this.hl.style.display = "none";
          else Object.assign(this.hl.style, { display: "", transform: `translate(${Math.round(g.bl)}px, ${Math.round(g.bt)}px)`, width: `${Math.round(g.bw)}px`, height: `${Math.round(g.bh)}px` });
        },
      });
    }
    // --- pointer: click = menu, Shift/Ctrl-click or long-press = select, drag = move
    onDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.cur < 0) return;
      e.preventDefault();
      clearTimeout(this.hideT);
      this.handle.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, idx: this.cur, moving: false, moved: [], t: -1, long: false, cy: e.clientY, off: 0 };
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
        this.view.scrollDOM.classList.add("cm-blk-dragging");
        this.startLift(d);
        this.autoScroll();
      }
      this.track();
    };
    /** The lifted copy of the dragged block(s) that follows the pointer. */
    startLift(d: { y: number; moved: number[]; off: number }) {
      const v = this.view;
      const { blocks } = blocksOf(v.state);
      const g = this.geo;
      this.lift.replaceChildren();
      for (const i of d.moved) for (let l = blocks[i].a; l <= blocks[i].b; l++) {
        const pos = v.state.doc.line(l + 1).from;
        if (pos < v.viewport.from || pos > v.viewport.to) continue;
        const el = (v.domAtPos(pos).node as Node);
        const lineEl = (el.nodeType === 1 ? (el as HTMLElement) : el.parentElement)?.closest(".cm-line");
        if (lineEl) { const c = lineEl.cloneNode(true) as HTMLElement; c.classList.remove("cm-blk-sel", "cm-activeLine"); this.lift.append(c); }
      }
      if (!g) return;
      const sr = v.scrollDOM.getBoundingClientRect();
      d.off = d.y - (g.bt + sr.top - v.scrollDOM.scrollTop);
      Object.assign(this.lift.style, { display: "", width: `${Math.round(g.bw)}px`, left: "0px", top: "0px" });
      this.lift.dataset.x = String(g.bl);
    }
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
      const sr = v.scrollDOM.getBoundingClientRect();
      const g = this.geo;
      const noop = d.moved.every((x, k) => x === d.moved[0] + k) && t >= d.moved[0] && t <= d.moved[d.moved.length - 1] + 1;
      const bl = g ? g.bl : 0, bw = g ? g.bw : v.contentDOM.getBoundingClientRect().width;
      Object.assign(this.drop.style, { display: noop ? "none" : "", transform: `translate(${Math.round(bl)}px, ${Math.round(y - sr.top + v.scrollDOM.scrollTop - 1)}px)`, width: `${Math.round(bw)}px` });
      const ly = d.cy - d.off - sr.top + v.scrollDOM.scrollTop;
      this.lift.style.transform = `translate(${Math.round(Number(this.lift.dataset.x ?? 0))}px, ${Math.round(ly)}px)`;
      if (g) this.handle.style.transform = `translate(${Math.round(g.x)}px, ${Math.round(ly + 3 + (g.y - g.bt - 3))}px)`;
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
        else {
          this.menuOpen = true;
          this.handle.classList.add("open");
          hooks.menu({ view: this.view, idx: targets(this.view, d.idx), rect: this.handle.getBoundingClientRect(), closed: () => { this.menuOpen = false; this.handle.classList.remove("open"); this.place(); } });
        }
      }
      if (coarse()) this.follow(); else this.place();
    };
    onCancel = () => { if (this.drag?.moving) clearBlockSelection(this.view); this.end(); this.place(); };
    end() {
      const d = this.drag;
      if (d) { clearTimeout(d.lpT); if (d.raf) cancelAnimationFrame(d.raf); try { this.handle.releasePointerCapture(d.id); } catch { /* ignore */ } }
      this.drag = null;
      this.drop.style.display = "none";
      this.lift.style.display = "none";
      this.lift.replaceChildren();
      this.view.scrollDOM.classList.remove("cm-blk-dragging");
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
      this.hl.remove();
      this.lift.remove();
      this.sels.forEach((d) => d.remove());
      this.view.scrollDOM.classList.remove("cm-blk-tight", "cm-blk-rtlroom");
    }
  });
}

// ------------------------------------------------------------------ "3 blocks selected · Delete · Move · Turn into" (R4-16F)
class SelBar extends WidgetType {
  constructor(readonly n: number) { super(); }
  eq(o: SelBar) { return o.n === this.n; }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-blk-selbar";
    el.setAttribute("contenteditable", "false");
    const act = (label: string, run: (b: HTMLElement) => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onmousedown = (e) => e.preventDefault(); b.onclick = () => run(b); return b; };
    el.append(t("{n} blocks selected", { n: this.n }), " · ", act(t("Delete"), () => { remove(view); view.focus(); }), " · ",
      act(t("Move"), (b) => openMenu(view, targets(view), b.getBoundingClientRect())), " · ",
      act(t("Turn into"), (b) => openMenu(view, targets(view), b.getBoundingClientRect(), "turn")));
    return el;
  }
  ignoreEvent() { return true; }
}
const selBar = EditorView.decorations.compute([selField, "doc"], (state) => {
  const idx = selectedIdx(state);
  if (idx.length < 2) return Decoration.none;
  const { blocks } = blocksOf(state);
  const last = blocks[idx[idx.length - 1]];
  const at = state.doc.line(last.b + 1).to;
  return Decoration.set([Decoration.widget({ widget: new SelBar(idx.length), block: true, side: 1 }).range(at)]);
});

// ------------------------------------------------------------------ `^id` dimmed in the source
const idDeco = new MatchDecorator({ regexp: /(?<=^|\s)\^[A-Za-z0-9-]+\s*$/g, decoration: Decoration.mark({ class: "cm-blkid" }) });
const idMarks = ViewPlugin.fromClass(class { d: DecorationSet; constructor(v: EditorView) { this.d = idDeco.createDeco(v); } update(u: ViewUpdate) { this.d = idDeco.updateDeco(u, this.d); } }, { decorations: (p) => p.d });

export function blockEditing(hooks: BlockHooks): Extension {
  return [
    selField,
    selDeco,
    selBar,
    idMarks,
    handlePlugin(hooks),
    EditorView.theme({ ".cm-scroller": { position: "relative", isolation: "isolate" } }),
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
    const blocks = parseBlocks(lines).filter((b) => b.kind !== "hr" && !(b.kind === "heading" && /^#\s/.test(lines[b.a])));
    const options: (Completion & { lmGlyph: string; lmId: string })[] = [];
    const name = self ? currentTitle() : note!.title;
    // "Blocks in <b>Note</b>" header (design R4-16G); the "adds an id" footnote is the tooltip's ::after (layout.css)
    const head = t("Blocks in {name}"); // "{name}" stays in the string so the bold title goes where the language puts it
    const section = { name: head.replace("{name}", name), header: () => { const h = document.createElement("completion-section"); h.className = "lm-blk-head"; const [pre, post = ""] = head.split("{name}"); h.append(pre); const b = document.createElement("b"); b.textContent = name; b.dir = "auto"; h.append(b, post); return h; } };
    for (const blk of blocks) {
      const text = lines.slice(blk.a, blk.b + 1).join("\n");
      const label = blockPreview(text, blk.kind);
      if (q && !(blk.id ?? "").toLowerCase().startsWith(q) && !label.toLowerCase().includes(q)) continue;
      options.push({
        label,
        lmId: blk.id ? `^${blk.id}` : t("add id"),
        lmGlyph: blockGlyph(blk, lines[blk.a] ?? ""),
        section,
        boost: -options.length,
        type: blk.id ? "blk-id" : "blk-noid",
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
