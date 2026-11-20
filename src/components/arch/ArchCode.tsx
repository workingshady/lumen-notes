// Code pane editor (46C, 46G–46J): CodeMirror with the design's look (12.5/21 JetBrains Mono, 38 px line numbers,
// 12 px marker column), DSL colouring (ArchStudio `tok()`), error markers with a wavy underline, the hover band that links
// a line to its node, autocomplete for icons / node names / keywords, and paste detection for conversion.
import CodeMirror from "@uiw/react-codemirror";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView, Decoration, ViewPlugin, GutterMarker, gutterLineClass, gutter, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { useEffect, useMemo, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Glyph } from "../Glyph";
import { ARCH_ICONS, isIcon } from "../../lib/arch-model";
import { GLYPHS } from "../../lib/glyphs";
import { DSL_KEYWORDS, type DslError } from "../../lib/arch-dsl";
import { t } from "../../lib/i18n";

export interface CodeMark { line: number; kind: "+" | "-" }
export interface CodeHandle { view: EditorView | null }

// ------------------------------------------------------------------ highlighting (design tok())
const TOK = /(\/\/.*$)|("[^"]*")|(\[|\]|\{|\}|:|,|<-->|-->|<>|>|<)|\b(icon|tech|status|label|direction|color|size|kind)(?=[:\s])|([^\s[\]{}:,<>"]+)|(\s+)/g;
const mk = (cls: string) => Decoration.mark({ class: cls });
const M = { c: mk("ad-c"), s: mk("ad-s"), p: mk("ad-p"), k: mk("ad-k") };
function dslDecos(v: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of v.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = v.state.doc.lineAt(pos);
      TOK.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOK.exec(line.text))) {
        if (!m[0]) { TOK.lastIndex++; continue; }
        const d = m[1] ? M.c : m[2] ? M.s : m[3] ? M.p : m[4] ? M.k : null;
        if (d) b.add(line.from + m.index, line.from + m.index + m[0].length, d);
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}
const dslColors = ViewPlugin.fromClass(class { decorations: DecorationSet; constructor(v: EditorView) { this.decorations = dslDecos(v); } update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = dslDecos(u.view); } }, { decorations: (p) => p.decorations });

// ------------------------------------------------------------------ errors, diff marks and hover band
const setMarks = StateEffect.define<{ errors: DslError[]; marks: CodeMark[]; band: number | null }>();
interface MarkState { deco: DecorationSet; errLines: Set<number>; marks: Map<number, string>; band: number | null }
const markField = StateField.define<MarkState>({
  create: () => ({ deco: Decoration.none, errLines: new Set(), marks: new Map(), band: null }),
  update(val, tr) {
    let v = tr.docChanged ? { ...val, deco: val.deco.map(tr.changes) } : val;
    for (const e of tr.effects) if (e.is(setMarks)) {
      const doc = tr.state.doc, items: { from: number; to: number; d: Decoration }[] = [];
      const errLines = new Set<number>(), marks = new Map<number, string>();
      for (const er of e.value.errors) {
        if (er.line < 1 || er.line > doc.lines) continue;
        const l = doc.line(er.line);
        errLines.add(er.line);
        items.push({ from: l.from, to: l.from, d: Decoration.line({ class: "ad-errline" }) });
        const a = Math.min(l.to, l.from + Math.max(0, er.col - 1)), z = Math.min(l.to, l.from + Math.max(er.col, er.endCol - 1));
        if (z > a) items.push({ from: a, to: z, d: Decoration.mark({ class: "ad-wavy" }) });
      }
      for (const m of e.value.marks) {
        if (m.line < 1 || m.line > doc.lines) continue;
        marks.set(m.line, m.kind);
        items.push({ from: doc.line(m.line).from, to: doc.line(m.line).from, d: Decoration.line({ class: m.kind === "+" ? "ad-add" : "ad-del" }) });
      }
      const band = e.value.band;
      if (band && band <= doc.lines && !errLines.has(band)) items.push({ from: doc.line(band).from, to: doc.line(band).from, d: Decoration.line({ class: "ad-band" }) });
      items.sort((x, y) => x.from - y.from || (x.to - x.from) - (y.to - y.from));
      v = { deco: Decoration.set(items.map((i) => i.d.range(i.from, i.to)), true), errLines, marks, band };
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});
class Dot extends GutterMarker { constructor(readonly s: string, readonly c: string) { super(); } toDOM() { const e = document.createElement("span"); e.textContent = this.s; e.style.color = this.c; return e; } }
const markGutter = gutter({
  class: "ad-markg",
  lineMarker(view, line) {
    const st = view.state.field(markField), n = view.state.doc.lineAt(line.from).number;
    if (st.errLines.has(n)) return new Dot("●", "var(--danger)");
    const m = st.marks.get(n);
    return m ? new Dot(m, m === "+" ? "var(--success)" : "var(--danger)") : null;
  },
  lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setMarks))),
});
class BandNum extends GutterMarker { elementClass = "ad-bandnum"; }
const bandNum = new BandNum();
const bandGutter = gutterLineClass.compute([markField], (s) => {
  const st = s.field(markField), b = new RangeSetBuilder<GutterMarker>();
  if (st.band && st.band <= s.doc.lines) b.add(s.doc.line(st.band).from, s.doc.line(st.band).from, bandNum);
  return b.finish();
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", lineHeight: "21px", padding: "0 0 8px" },
  ".cm-gutterElement": { fontSize: "12.5px", lineHeight: "21px" },
  ".cm-content": { padding: 0, caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 0 0 0", borderInlineStart: "2px solid transparent" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted)" },
  ".cm-lineNumbers .cm-gutterElement": { width: "38px", boxSizing: "border-box", textAlign: "right", paddingRight: "12px", minWidth: "38px" },
  ".ad-markg .cm-gutterElement": { width: "12px" },
  ".ad-bandnum": { color: "var(--accent)", backgroundColor: "color-mix(in srgb,var(--accent) 18%,transparent)" },
  ".ad-band": { backgroundColor: "color-mix(in srgb,var(--accent) 18%,transparent)", borderInlineStart: "2px solid var(--accent)" },
  ".ad-errline": { backgroundColor: "color-mix(in srgb,var(--danger) 8%,transparent)" },
  ".ad-add": { backgroundColor: "color-mix(in srgb,var(--success) 12%,transparent)" },
  ".ad-del": { backgroundColor: "color-mix(in srgb,var(--danger) 12%,transparent)", textDecoration: "line-through" },
  ".ad-wavy": { color: "var(--danger)", textDecoration: "underline wavy var(--danger)", textUnderlineOffset: "3px" },
  ".ad-c": { color: "var(--muted)", fontStyle: "italic" }, ".ad-s": { color: "var(--success)" }, ".ad-p": { color: "var(--muted)" }, ".ad-k": { color: "var(--link)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb,var(--accent) 25%,transparent) !important" },
  ".cm-tooltip.cm-tooltip-autocomplete": { width: "250px", padding: "4px", borderRadius: "10px", background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 14px 36px rgba(0,0,0,.35)", fontFamily: "Inter, system-ui, sans-serif" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "240px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "center", gap: "8px", height: "30px", padding: "0 8px", borderRadius: "7px", fontSize: "12.5px", color: "var(--text)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "color-mix(in srgb,var(--accent) 18%,transparent)", color: "var(--text)" },
  ".cm-completionLabel": { flex: 1, fontFamily: "'JetBrains Mono', monospace" },
  ".cm-completionDetail": { fontSize: "11px", color: "var(--muted)", fontStyle: "normal", marginLeft: "0" },
  ".cm-completionIcon": { display: "none" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: 600 },
});

const glyphHtml = new Map<string, string>();
const glyphEl = (g: string) => {
  if (!glyphHtml.has(g)) glyphHtml.set(g, renderToStaticMarkup(<Glyph name={g} size={16} color="var(--muted)" />));
  const s = document.createElement("span"); s.innerHTML = glyphHtml.get(g)!; s.style.display = "flex"; return s;
};

export function ArchCode({ value, onChange, lang, errors = [], marks = [], band, onHoverLine, onPaste, names = [], handle, readOnly }: {
  value: string; onChange: (v: string) => void; lang: "dsl" | "mermaid" | "json"; errors?: DslError[]; marks?: CodeMark[]; band?: number | null;
  onHoverLine?: (line: number | null) => void; onPaste?: (text: string) => boolean; names?: { name: string; line: number; icon?: string }[];
  handle?: React.MutableRefObject<CodeHandle | null>; readOnly?: boolean;
}) {
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onHoverLine, onPaste, names });
  cbs.current = { onHoverLine, onPaste, names };
  const exts = useMemo<Extension[]>(() => {
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      if (lang !== "dsl") return null;
      const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
      const iconM = /icon:\s*([\w-]*)$/.exec(before);
      if (iconM) {
        const w = iconM[1];
        const nodeHits = cbs.current.names.filter((n) => n.name.toLowerCase().startsWith(w.toLowerCase())).map((n) => ({ label: n.name, detail: t("node · line {n}", { n: n.line }), info: undefined, type: "node", g: n.icon ?? "service", apply: n.name }));
        // prefix matches first (architecture icons, then the rest of the glyph set), then names that contain the text
        const lw = w.toLowerCase(), arch = new Set(ARCH_ICONS);
        const rank = (i: string) => (i.startsWith(lw) ? (arch.has(i) ? 0 : 1) : i.includes(lw) ? (arch.has(i) ? 2 : 3) : 9);
        const icons = [...new Set([...ARCH_ICONS.filter((i) => isIcon(i)), ...Object.keys(GLYPHS)])].map((i) => [i, rank(i)] as const).filter(([, r]) => r < 9).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 40);
        return {
          from: ctx.pos - w.length, filter: false,
          options: [...icons.map(([i], k) => ({ label: i, detail: t("icon"), g: i, boost: 99 - k })), ...nodeHits.map((n) => ({ ...n, apply: (v: EditorView, _c: unknown, from: number, to: number) => v.dispatch({ changes: { from, to, insert: n.label } }) }))],
        };
      }
      const word = ctx.matchBefore(/[\p{L}\p{N}_-]+/u);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      return {
        from: word.from,
        options: [
          ...DSL_KEYWORDS.map((k) => ({ label: k, detail: t("keyword"), g: "code" })),
          ...cbs.current.names.map((n) => ({ label: n.name, detail: t("node · line {n}", { n: n.line }), g: n.icon ?? "service" })),
        ],
      };
    };
    return [
      theme, markField, markGutter, bandGutter, EditorView.lineWrapping, ...(lang === "dsl" ? [dslColors] : []),
      autocompletion({ override: [complete], icons: false, addToOptions: [{ render: (c) => glyphEl((c as { g?: string }).g ?? "code"), position: 20 }] }),
      EditorView.domEventHandlers({
        mousemove(e, v) { const p = v.posAtCoords({ x: e.clientX, y: e.clientY }); cbs.current.onHoverLine?.(p === null ? null : v.state.doc.lineAt(p).number); },
        mouseleave() { cbs.current.onHoverLine?.(null); },
        paste(e) { const s = e.clipboardData?.getData("text/plain") ?? ""; return !!cbs.current.onPaste?.(s); },
      }),
    ];
  }, [lang]);
  useEffect(() => { view.current?.dispatch({ effects: setMarks.of({ errors, marks, band: band ?? null }) }); }, [errors, marks, band, value]);
  if (handle) handle.current = { view: view.current };
  return (
    <div dir="ltr" style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }} className="[&_.cm-editor]:h-full">
      <CodeMirror value={value} height="100%" theme="none" readOnly={readOnly} extensions={exts} onChange={onChange}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, bracketMatching: true, closeBrackets: true }}
        onCreateEditor={(v) => { view.current = v; if (handle) handle.current = { view: v }; setTimeout(() => v.dispatch({ effects: setMarks.of({ errors, marks, band: band ?? null }) }), 0); }} style={{ height: "100%" }} />
    </div>
  );
}
