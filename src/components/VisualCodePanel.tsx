// Shared side panel for canvas + whiteboard (Lumen 07b): two tabs, </> JSON and >_ Script.
// Right side on desktop, bottom sheet on phone.
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { BookOpen, Check, ChevronDown, ChevronUp, CircleCheck, CircleX, Code2, Play, SquareTerminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { Glyph } from "./Glyph";
import { cx } from "./ui";

export type CodeTab = "json" | "script";
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function CodePanel({ tab, onTab, onClose, children, phoneRight }: { tab: CodeTab; onTab: (t: CodeTab) => void; onClose: () => void; children: ReactNode; phoneRight?: ReactNode }) {
  const tabBtn = (id: CodeTab, icon: ReactNode, label: string) => (
    <button onClick={() => onTab(id)} className={cx("flex h-[34px] items-center gap-1.5 rounded-[7px] px-3 text-[13px] md:h-8 md:rounded-[8px]", tab === id ?"bg-surface-2 font-semibold text-ink [&>svg]:text-accent" : "text-muted hover:text-ink")}>
      {icon}{label}
    </button>
  );
  return (
    <div className="relative z-10 -mt-3.5 flex h-[60%] min-h-0 shrink-0 flex-col rounded-t-[14px] border-t border-line bg-surface text-[13px] md:mt-0 md:h-auto md:w-[480px] md:rounded-none md:border-s md:border-t-0">
      <div className="flex justify-center pb-1 pt-2.5 md:hidden"><button aria-label={t("Close panel")} onClick={onClose} className="h-1 w-9 rounded-full bg-line" /></div>
      <div className="flex h-12 shrink-0 items-center gap-1 border-line px-4 md:h-11 md:border-b md:px-2">
        <div className="flex rounded-[10px] border border-line bg-bg p-[3px] md:gap-1 md:border-0 md:bg-transparent md:p-0">
          {tabBtn("json", <Code2 size={14} />, "JSON")}
          {tabBtn("script", <SquareTerminal size={14} />, t("Script"))}
        </div>
        <span className="flex-1" />
        <span className="flex items-center md:hidden">{phoneRight}</span>
        <button aria-label={t("Close panel")} title={t("Close")} onClick={onClose} className="hidden size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink md:flex"><X size={16} /></button>
      </div>
      {children}
    </div>
  );
}

/** Second header row (format name, chips, actions). */
export function PanelBar({ children, phone }: { children: ReactNode; phone?: ReactNode }) {
  return (
    <>
      <div className="hidden shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 md:flex">{children}</div>
      {phone && <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5 md:hidden">{phone}</div>}
    </>
  );
}

export function ValidChip({ error, big }: { error: string | null; big?: boolean }) {
  return error ? (
    <span className={cx("flex items-center gap-1 rounded-full bg-bad/14 px-2.5 font-semibold text-bad", big ? "h-7 text-[12.5px]" : "h-6 text-[12px]")}><CircleX size={12} />{t("Invalid")}</span>
  ) : (
    <span className={cx("flex items-center gap-1 rounded-full bg-ok/14 px-2.5 font-semibold text-ok", big ? "h-7 text-[12.5px]" : "h-6 text-[12px]")}>{t("Valid")} <Check size={13} strokeWidth={2.5} /></span>
  );
}

/** Red banner shown above the editor while the JSON is invalid. */
export function ErrorBanner({ error, line, onGoto }: { error: string; line?: number | null; onGoto?: () => void }) {
  const msg = line ? t("Line {line}: {error}", { line, error: error.replace(/^JSON:\s*/, "").replace(/\s*(\(line \d+ column \d+\)|at position \d+.*)$/i, "") }) : error;
  return (
    <div className="mx-3 mt-2.5 flex shrink-0 items-center gap-2 rounded-[8px] border px-2.5 py-2 text-[12.5px] font-medium text-bad" style={{ background: "color-mix(in srgb,var(--danger) 12%,transparent)", borderColor: "color-mix(in srgb,var(--danger) 35%,transparent)" }}>
      <CircleX size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{msg}</span>
      {line && onGoto && <button onClick={onGoto} className="shrink-0 font-medium text-ink underline underline-offset-[3px]">{t("Go to line")}</button>}
    </div>
  );
}

export function StatusFooter({ children }: { children: ReactNode }) {
  return <div className="hidden h-8 shrink-0 items-center gap-2.5 border-t border-line px-3 text-[11.5px] text-muted md:flex">{children}</div>;
}
export function ValidFooter({ error, detail, cursor }: { error: string | null; detail: ReactNode; cursor?: { line: number; col: number } | null }) {
  return (
    <StatusFooter>
      {error ? <span className="truncate">{t("Board keeps last valid state")}</span>
        : <><CircleCheck size={14} className="shrink-0 text-ok" /><span className="font-medium text-ok">{t("Valid")}</span><span className="truncate">{detail}</span></>}
      <span className="flex-1" />
      {cursor && <span className="shrink-0 tabular-nums">{t("Ln {line}, Col {col}", { line: cursor.line, col: cursor.col })}</span>}
    </StatusFooter>
  );
}

/** Phone sheet: the big bottom actions (Download + Apply, or Run). */
export function PhoneActions({ children }: { children: ReactNode }) {
  return <div className="safe-b flex shrink-0 gap-2.5 p-3 md:hidden">{children}</div>;
}

export interface Example { icon: ReactNode; title: string; desc: string; code: string }
export function ExamplesMenu({ examples, onPick }: { examples: Example[]; onPick: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("mousedown", k);
    return () => removeEventListener("mousedown", k);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cx("flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] md:h-[30px] md:rounded-[8px] md:bg-surface-2 md:px-2.5", open ? "border-accent" : "border-line")}>
        <BookOpen size={13} className="hidden text-muted md:block" />{t("Examples")}{open ? <ChevronUp size={12} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="absolute end-0 top-10 z-30 flex w-[300px] flex-col gap-0.5 rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] md:start-0 md:end-auto md:top-9 fade-in">
          {examples.map((e) => (
            <button key={e.title} onClick={() => { onPick(e.code); setOpen(false); }} className="flex gap-2.5 rounded-[8px] px-2.5 py-[9px] text-start hover:bg-bg">
              <span className="mt-px text-muted">{e.icon}</span>
              <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t(e.title)}</span><span className="text-[12px] text-muted">{t(e.desc)}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RunButton({ onRun, big }: { onRun: () => void; big?: boolean }) {
  return big ? (
    <button onClick={onRun} className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg"><Play size={14} />{t("Run")}</button>
  ) : (
    <button onClick={onRun} className="flex h-[30px] items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:brightness-110">
      <Play size={12} />{t("Run")} <span dir="ltr" className="font-mono text-[11px] font-medium opacity-65">{MAC ? "⌘↵" : "Ctrl↵"}</span>
    </button>
  );
}

/** Output strip under the script editor: muted mono lines; done / error lines (the runner prefixes ✓ / ✖) get a check / x glyph in semantic colour. */
export function OutputStrip({ logs, onClear, empty }: { logs: string[]; onClear: () => void; empty: string }) {
  return (
    <div className="mx-3 mt-2.5 flex max-h-40 shrink-0 flex-col gap-1 overflow-auto rounded-[10px] bg-bg px-3 py-2 font-mono text-[11.5px] leading-[18px] text-muted md:mx-0 md:mt-0 md:rounded-none md:border-t md:border-line md:px-3.5 md:py-2.5 md:text-[12px] md:leading-[19px]">
      <div className="hidden items-center pb-0.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.06em] md:flex">
        <span className="flex-1">{t("Output")}</span>
        {logs.length > 0 && <button onClick={onClear} className="font-medium normal-case tracking-normal hover:text-ink">{t("Clear")}</button>}
      </div>
      {logs.length ? logs.map((l, i) => (
        <span key={i} className={cx("whitespace-pre-wrap break-words", l.startsWith("✓") && "text-ok", l.startsWith("✖") && "text-bad")}>{l.startsWith("✓") ? <span className="inline-flex items-start gap-1.5"><Check size={13} className="mt-[3px] shrink-0" />{l.slice(1).trim()}</span> : l.startsWith("✖") ? <span className="inline-flex items-start gap-1.5"><Glyph name="x" size={13} className="mt-[3px] shrink-0" />{l.slice(1).trim()}</span> : `› ${l}`}</span>
      )) : <span className="font-sans">{empty}</span>}
    </div>
  );
}

/** Ctrl/Cmd+Enter inside the editor runs the script. */
export const runKey = (run: () => void) => (e: React.KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
};

// ------------------------------------------------------------------ code editor with board ↔ JSON selection sync
/** Amber band over the JSON object of the selected board item. */
const setBand = StateEffect.define<{ from: number; to: number } | null>();
const bandField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setBand)) {
      if (!e.value) { deco = Decoration.none; continue; }
      const doc = tr.state.doc;
      const from = Math.min(e.value.from, doc.length), to = Math.min(e.value.to, doc.length);
      const b = new RangeSetBuilder<Decoration>();
      for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) b.add(doc.line(l).from, doc.line(l).from, Decoration.line({ class: "cm-lumen-band" }));
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const bandTheme = EditorView.baseTheme({ ".cm-lumen-band": { backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)" } });
/** JSON colours from the design: keys info-blue, strings teal, numbers orange, punctuation muted. */
const jsonColors = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--info)" },
  { tag: tags.string, color: "var(--link)" },
  { tag: tags.number, color: "#E8893A" },
  { tag: [tags.bool, tags.null], color: "var(--learn)" },
  { tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket], color: "var(--muted)" },
  { tag: tags.comment, color: "var(--muted)" },
  { tag: tags.keyword, color: "var(--learn)" },
]));
const codeTheme = EditorView.theme({
  ".cm-gutters": { background: "transparent", border: "none", color: "var(--muted)" },
  ".cm-lineNumbers .cm-gutterElement": { fontSize: "11px", opacity: "0.5", padding: "0 14px 0 6px", minWidth: "30px" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "transparent" },
  ".cm-foldGutter .cm-gutterElement": { opacity: "0.5" },
  ".cm-content": { padding: "12px 0" },
});
/** Mono 12.5/21 (desktop) and 12/20 (phone), like the code panel design. */
export const CODE_TEXT = "[&_.cm-editor]:!text-[12px] [&_.cm-scroller]:!leading-[20px] md:[&_.cm-editor]:!text-[12.5px] md:[&_.cm-scroller]:!leading-[21px]";

/** Spans of every object at depth 2 (`nodes[i]`, `edges[i]`, `elements[i]`) keyed by their "id". */
export function jsonItemSpans(text: string): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  const stack: number[] = [];
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? i : -1);
    else if (c === "}" || c === "]") {
      const start = stack.pop();
      if (c === "}" && start !== undefined && start >= 0 && stack.length === 2) {
        const m = /"id"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text.slice(start, i + 1));
        if (m && !out.has(m[1])) out.set(m[1], { from: start, to: i + 1 });
      }
    }
  }
  return out;
}
/** Id of the item whose JSON object contains `pos`. */
export function itemAt(spans: Map<string, { from: number; to: number }>, pos: number) {
  for (const [id, s] of spans) if (pos >= s.from && pos <= s.to) return id;
  return null;
}

// ------------------------------------------------------------------ light regex highlighting (script console, Mermaid)
type Rule = [RegExp, string];
/** Colours a line with the first matching rule at each position (the design's tokenizer, as CodeMirror marks). */
function regexHighlighter(rules: Rule[]) {
  const marks = new Map(rules.map(([, c]) => [c, Decoration.mark({ attributes: { style: `color:${c}` } })]));
  const build = (v: EditorView) => {
    const b = new RangeSetBuilder<Decoration>();
    for (const { from, to } of v.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = v.state.doc.lineAt(pos);
        const text = line.text;
        let i = 0;
        while (i < text.length) {
          let hit: [number, string] | null = null;
          for (const [re, c] of rules) { re.lastIndex = i; const m = re.exec(text); if (m && m.index === i && m[0].length) { hit = [m[0].length, c]; break; } }
          if (hit) { b.add(line.from + i, line.from + i + hit[0], marks.get(hit[1])!); i += hit[0]; } else i++;
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  const safe = (v: EditorView) => { try { return build(v); } catch { return Decoration.none; } };
  return ViewPlugin.fromClass(class { decorations: DecorationSet; constructor(v: EditorView) { this.decorations = safe(v); } update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = safe(u.view); } }, { decorations: (p) => p.decorations });
}
const JS_RULES: Rule[] = [
  [/\/\/.*$/y, "var(--muted)"], [/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/y, "#E3B341"],
  [/\b(?:const|let|var|for|of|in|await|async|return|if|else|new|function)\b/y, "var(--learn)"], [/\b(?:board|sk|canvas|helpers|log|note)\b/y, "var(--link)"],
  [/\.\w+(?=\()/y, "var(--info)"], [/\b\d+(?:\.\d+)?\b/y, "#E8893A"],
];
const MERMAID_RULES: Rule[] = [
  [/%%.*$/y, "var(--muted)"], [/-->|---|-\.->|==>|\|[^|]*\|/y, "var(--muted)"],
  [/\b(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|TD|TB|LR|RL|BT|participant|subgraph|end)\b/y, "var(--learn)"],
  [/\w+(?=[[({])/y, "var(--info)"], [/[[({]+[^\])}]*[\])}]+/y, "#E3B341"],
];
const jsColors = regexHighlighter(JS_RULES);
const mermaidColors = regexHighlighter(MERMAID_RULES);

export interface CodeEditorHandle { goto: (line: number) => void; format: () => void }
/** CodeMirror for .canvas / .excalidraw JSON (or a script): band highlight, cursor reporting, go-to-line, ⇧⌥F format. */
export function CodeEditor({ value, onChange, band, onCursor, handle, lang = "json", onKeyDown, className }: {
  value: string; onChange: (t: string) => void; band?: { from: number; to: number } | null;
  onCursor?: (c: { pos: number; line: number; col: number; user: boolean }) => void;
  handle?: React.MutableRefObject<CodeEditorHandle | null>; lang?: "json" | "js" | "mermaid"; onKeyDown?: (e: React.KeyboardEvent) => void; className?: string;
}) {
  const view = useRef<EditorView | null>(null);
  const cb = useRef(onCursor);
  cb.current = onCursor;
  const exts = useMemo(() => [
    ...(lang === "json" ? [json(), jsonColors] : lang === "js" ? [jsColors] : [mermaidColors]), codeTheme, bandField, bandTheme,
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged && !u.focusChanged) return;
      const pos = u.state.selection.main.head, line = u.state.doc.lineAt(pos);
      const user = u.view.hasFocus && u.transactions.some((t) => t.isUserEvent("select") || t.isUserEvent("input") || t.isUserEvent("delete"));
      cb.current?.({ pos, line: line.number, col: pos - line.from + 1, user });
    }),
  ], [lang]);
  const bandRef = useRef(band);
  bandRef.current = band;
  const applyBand = (v: EditorView | null) => {
    const b = bandRef.current;
    if (!v) return;
    const effects: StateEffect<unknown>[] = [setBand.of(b ?? null)];
    if (b && !v.hasFocus) effects.push(EditorView.scrollIntoView(Math.min(b.from, v.state.doc.length), { y: "center" }));
    v.dispatch({ effects });
  };
  useEffect(() => { applyBand(view.current); }, [band?.from, band?.to, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch { /* invalid: leave as is */ } };
  if (handle) handle.current = {
    goto: (line) => {
      const v = view.current;
      if (!v) return;
      const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
      v.focus();
    },
    format,
  };
  return (
    <div dir="ltr" className={className ?? cx("mx-3 min-h-0 flex-1 overflow-auto rounded-[10px] border border-line bg-bg md:mx-0 md:rounded-none md:border-0 md:bg-transparent", CODE_TEXT)}
      onKeyDown={(e) => {
        if (lang === "json" && e.shiftKey && e.altKey && e.code === "KeyF") { e.preventDefault(); format(); }
        onKeyDown?.(e);
      }}>
      <CodeMirror value={value} theme="none" extensions={exts} basicSetup={{ lineNumbers: true, foldGutter: lang === "json", highlightActiveLine: false, highlightActiveLineGutter: false }} onChange={onChange} onCreateEditor={(v) => { view.current = v; setTimeout(() => applyBand(v), 0); }} />
    </div>
  );
}

/** Line number from a JSON.parse message (V8: "(line 15 column 5)" or "at position N"). */
export function errorLine(err: string | null, text: string): number | null {
  if (!err) return null;
  const l = /line (\d+)/i.exec(err);
  if (l) return Number(l[1]);
  const p = /position (\d+)/i.exec(err);
  return p ? text.slice(0, Number(p[1])).split("\n").length : null;
}
