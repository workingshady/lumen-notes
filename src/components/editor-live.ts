// Page look for the Markdown editor (design R4 EditorDesk): the note reads like the page it renders to.
// Heading marks (`## `) hide when the caret is elsewhere, heading lines get their size, and the blank line between two
// blocks is drawn short (10 px) so blocks sit 4 px apart like the design; the caret's own line always keeps full height.
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

class Hidden extends WidgetType { toDOM() { const s = document.createElement("span"); s.className = "cm-hidemk"; return s; } ignoreEvent() { return false; } }
const hide = Decoration.replace({ widget: new Hidden() });

function build(v: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const { doc, selection } = v.state;
  const caretLines = !v.hasFocus ? new Set<number>() : new Set(selection.ranges.flatMap((r) => { const a = doc.lineAt(r.from).number, z = doc.lineAt(r.to).number; return Array.from({ length: z - a + 1 }, (_, i) => a + i); }));
  let fence = false, fm = doc.lines > 1 && doc.line(1).text === "---";
  for (const { from, to } of v.visibleRanges) {
    // fence / front-matter state before the visible range
    if (from > 0) {
      fence = false; fm = doc.lines > 1 && doc.line(1).text === "---";
      for (let n = 1; n < doc.lineAt(from).number; n++) {
        const t = doc.line(n).text;
        if (fm) { if (n > 1 && t === "---") fm = false; continue; }
        if (/^\s*(```|~~~)/.test(t)) fence = !fence;
      }
    }
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const t = line.text;
      const n = line.number;
      if (fm) { if (n > 1 && t === "---") fm = false; pos = line.to + 1; continue; }
      if (/^\s*(```|~~~)/.test(t)) { fence = !fence; pos = line.to + 1; continue; }
      if (!fence) {
        const h = /^(#{1,6}) /.exec(t);
        if (h) {
          b.add(line.from, line.from, Decoration.line({ class: `cm-hline cm-hline${Math.min(h[1].length, 3)}` }));
          if (!caretLines.has(n)) b.add(line.from, line.from + h[0].length, hide);
        } else if (!t.trim() && !caretLines.has(n) && n > 1 && n < doc.lines && doc.line(n - 1).text.trim() && doc.line(n + 1).text.trim()) {
          b.add(line.from, line.from, Decoration.line({ class: "cm-gapline" }));
        }
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export function liveLook(): Extension {
  return ViewPlugin.fromClass(class {
    d: DecorationSet;
    constructor(v: EditorView) { this.d = build(v); }
    update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.d = build(u.view); }
  }, { decorations: (p) => p.d });
}
