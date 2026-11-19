// CodeMirror extension for cloze + image-occlusion cards (registered in Editor.tsx).
// - {{c1::…}} (and ==…== in flashcard notes) get a subtle underline; each block with clozes gets a small "N cards" chip.
// - ```occlusion blocks get an "Edit boxes" chip on the fence line that opens the box editor (OcclusionEditor.tsx).
// - A line that is only an image shows "Make image cards" while the cursor is on it.
// - Inserting an ```occlusion block from the slash menu opens the editor right away.
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { clozeBlocks } from "../lib/cloze";
import { newOcclusion, occlusionBlocks, occlusionCardCount, serializeOcclusion, type Occlusion } from "../lib/occlusion";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

class ChipWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string, readonly act?: (v: EditorView) => void, readonly title?: string) { super(); }
  eq(o: ChipWidget) { return o.text === this.text && o.cls === this.cls && o.act === this.act; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.act ? "button" : "span");
    el.className = `cm-card-chip ${this.cls}`;
    el.textContent = this.text;
    el.setAttribute("aria-hidden", this.act ? "false" : "true");
    if (this.title) el.title = this.title;
    if (this.act) {
      (el as HTMLButtonElement).type = "button";
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.act!(view); });
    }
    return el;
  }
  ignoreEvent() { return !!this.act; }
}

/** Open the box editor for the occlusion block whose opening fence is on 0-based line `line`. */
export function openOcclusionAt(view: EditorView, line: number) {
  const doc = view.state.doc.toString();
  const b = occlusionBlocks(doc).find((x) => x.from === line);
  if (!b) return;
  const origId = b.data.id;
  // a hand-written block without `id:` gets a permanent one when first saved from the editor
  const initial: Occlusion = /^\s*"?id"?\s*:/m.test(b.raw) ? b.data : { ...b.data, id: newOcclusion().id };
  void import("./OcclusionEditor").then((m) => m.openOcclusionEditor({
    initial,
    noteBody: doc,
    onSave: (o) => {
      const d = view.state.doc;
      const blocks = occlusionBlocks(d.toString());
      const cur = blocks.find((x) => x.data.id === origId && x.from === line) ?? blocks.find((x) => x.data.id === origId) ?? blocks.find((x) => x.from === line);
      if (!cur || cur.to + 1 > d.lines) return;
      const from = cur.from + 2 <= cur.to + 1 ? d.line(cur.from + 2).from : d.line(cur.to + 1).from;
      const to = d.line(cur.to + 1).from;
      view.dispatch({ changes: { from, to, insert: serializeOcclusion(o) + "\n" }, userEvent: "input.occlusion" });
    },
    onClose: () => view.focus(),
  }));
}

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const text = doc.toString();
  const out: Range<Decoration>[] = [];
  const mark = Decoration.mark({ class: "cm-cloze" });
  for (const b of clozeBlocks(text)) {
    if (b.line + 1 > doc.lines) continue;
    const base = doc.line(b.line + 1).from;
    for (const s of b.spans) out.push(mark.range(base + s.from, base + s.to));
    const n = new Set(b.spans.map((s) => s.n)).size;
    out.push(Decoration.widget({ widget: new ChipWidget(plural(n, "card"), "cm-cloze-chip", undefined, "Cloze cards in this block"), side: 1 }).range(doc.line(b.line + 1).to));
  }
  for (const b of occlusionBlocks(text)) {
    if (b.from + 1 > doc.lines) continue;
    const n = occlusionCardCount(b.data);
    const label = b.data.image ? `Edit boxes · ${plural(n, "card")}` : "Choose image";
    const line = b.from;
    out.push(Decoration.widget({ widget: new ChipWidget(label, "cm-occl-chip", (v) => openOcclusionAt(v, line), "Open the image occlusion editor"), side: 1 }).range(doc.line(b.from + 1).to));
  }
  return Decoration.set(out, true);
}

const clozeMarks = ViewPlugin.fromClass(class {
  d: DecorationSet;
  constructor(v: EditorView) { this.d = build(v); }
  update(u: ViewUpdate) { if (u.docChanged) this.d = build(u.view); }
}, { decorations: (p) => p.d });

const IMG_LINE = /^\s*!\[([^\]]*)\]\(\s*<?(att:[\w-]+|https?:\/\/[^\s)>]+)>?\s*\)\s*$/;
/** "Make image cards" on an image-only line while the cursor is on it. */
const imageAction = ViewPlugin.fromClass(class {
  d: DecorationSet = Decoration.none;
  constructor(v: EditorView) { this.d = this.build(v); }
  update(u: ViewUpdate) { if (u.docChanged || u.selectionSet) this.d = this.build(u.view); }
  build(v: EditorView) {
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const m = IMG_LINE.exec(line.text);
    if (!m) return Decoration.none;
    const next = line.number < v.state.doc.lines ? v.state.doc.line(line.number + 1).text : "";
    if (/^\s*```occlusion/.test(next)) return Decoration.none;
    const src = m[2], alt = m[1].trim();
    const make = (view: EditorView) => {
      const l = view.state.doc.lineAt(view.state.selection.main.head);
      const o = { ...newOcclusion(src), ...(alt ? { alt } : {}) };
      view.dispatch({ changes: { from: l.to, insert: "\n```occlusion\n" + serializeOcclusion(o) + "\n```" }, userEvent: "input.occlusion" });
      openOcclusionAt(view, l.number); // the new fence is on the next line (0-based = l.number)
    };
    return Decoration.set([Decoration.widget({ widget: new ChipWidget("Make image cards", "cm-occl-chip", make, "Hide parts of this image as flashcards"), side: 1 }).range(line.to)]);
  }
}, { decorations: (p) => p.d });

/** The slash menu's "Image occlusion" inserts an empty block: open the editor on it. */
const openAfterSlash = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  let hit = false;
  for (const tr of u.transactions) {
    if (!tr.isUserEvent("input.complete")) continue;
    tr.changes.iterChanges((_a, _b, _c, _d, ins) => { if (ins.toString().includes("```occlusion")) hit = true; });
  }
  if (!hit) return;
  const doc = u.state.doc;
  const cur = doc.lineAt(u.state.selection.main.head).number - 1;
  const b = occlusionBlocks(doc.toString()).filter((x) => x.from <= cur + 1).pop();
  if (b) setTimeout(() => openOcclusionAt(u.view, b.from), 0);
});

export const clozeEditing = () => [clozeMarks, imageAction, openAfterSlash];
