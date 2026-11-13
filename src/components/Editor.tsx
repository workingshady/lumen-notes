import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { Bold, Braces, CheckSquare, Code, Heading2, ImagePlus, Italic, Link2, List, Loader2, Mic, MoreHorizontal, Quote, Sigma, Square, Table, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { api, getToken } from "../lib/api";
import { addFile } from "../lib/attachments";
import { getSettings } from "../lib/settings";
import { toast, useVault } from "../lib/store";
import { cx, IconButton } from "./ui";

// The one active editor, so panels (AI, templates, toolbar) can insert text.
let active: EditorView | null = null;
export function insertText(text: string, mode: "cursor" | "end" = "cursor") {
  if (!active) return false;
  const st = active.state;
  const pos = mode === "end" ? st.doc.length : st.selection.main.head;
  active.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
  active.focus();
  return true;
}
export const getSelectionText = () => (active ? active.state.sliceDoc(active.state.selection.main.from, active.state.selection.main.to) : "");
export function scrollEditorToLine(line: number) {
  if (!active) return;
  const l = active.state.doc.line(Math.min(active.state.doc.lines, line + 1));
  active.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 40 }) });
  active.focus();
}

function wrap(v: EditorView, before: string, after = before, placeholder = "text") {
  const { from, to } = v.state.selection.main;
  const sel = v.state.sliceDoc(from, to) || placeholder;
  v.dispatch({ changes: { from, to, insert: before + sel + after }, selection: { anchor: from + before.length, head: from + before.length + sel.length } });
  v.focus();
}
function linePrefix(v: EditorView, prefix: string) {
  const { from, to } = v.state.selection.main;
  const changes = [];
  for (let pos = from; pos <= to; ) {
    const line = v.state.doc.lineAt(pos);
    changes.push(line.text.startsWith(prefix) ? { from: line.from, to: line.from + prefix.length, insert: "" } : { from: line.from, insert: prefix });
    pos = line.to + 1;
  }
  v.dispatch({ changes });
  v.focus();
}
function block(v: EditorView, text: string, cursorOffset?: number) {
  const pos = v.state.selection.main.head;
  const line = v.state.doc.lineAt(pos);
  const pre = line.text.trim() ? "\n\n" : "";
  const at = line.text.trim() ? line.to : line.from;
  v.dispatch({ changes: { from: at, insert: pre + text }, selection: { anchor: at + pre.length + (cursorOffset ?? text.length) } });
  v.focus();
}

const ACTIONS = {
  bold: (v: EditorView) => wrap(v, "**"),
  italic: (v: EditorView) => wrap(v, "_"),
  code: (v: EditorView) => wrap(v, "`", "`", "code"),
  h2: (v: EditorView) => linePrefix(v, "## "),
  list: (v: EditorView) => linePrefix(v, "- "),
  task: (v: EditorView) => linePrefix(v, "- [ ] "),
  quote: (v: EditorView) => linePrefix(v, "> "),
  link: (v: EditorView) => wrap(v, "[[", "]]", "Note title"),
  math: (v: EditorView) => block(v, "$$\n\\int_a^b f(x)\\,dx\n$$\n", 3),
  mermaid: (v: EditorView) => block(v, "```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]\n```\n", 23),
  codeblock: (v: EditorView) => block(v, "```ts\n\n```\n", 6),
  table: (v: EditorView) => block(v, "| Column | Column |\n|---|---|\n| | |\n", 2),
  callout: (v: EditorView) => block(v, "> [!tip] Title\n> Content\n"),
  card: (v: EditorView) => block(v, "Question :: Answer\n", 0),
  slide: (v: EditorView) => block(v, "\n---\n\n## New slide\n"),
};

export function Editor({ note, focus }: { note: Note; focus?: boolean }) {
  const vault = useVault();
  const [text, setText] = useState(note.body);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(note.body);
  const fileRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);

  // Switch notes, or remote update while not typing.
  useEffect(() => {
    if (note.body !== latest.current) { setText(note.body); latest.current = note.body; }
  }, [note.id, note.body]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  // flush pending save when switching away
  useEffect(() => {
    const id = note.id;
    return () => {
      if (timer.current) { clearTimeout(timer.current); void updateNote(id, { body: latest.current }); timer.current = undefined; }
    };
  }, [note.id]);

  const onChange = (v: string) => {
    setText(v);
    latest.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = undefined; void updateNote(note.id, { body: v }); }, 400);
  };

  const titles = useMemo(() => vault.notes.map((n) => n.title), [vault.notes]);
  const extensions = useMemo(() => {
    const wikiComplete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!m) return null;
      return { from: m.from + 2, options: titles.map((t) => ({ label: t, apply: `${t}]]` })), validFor: /^[^\]\n]*$/ };
    };
    const tagComplete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}_/-]*/u);
      if (!m) return null;
      const start = m.text.indexOf("#") + m.from + 1;
      return { from: start, options: vault.tags.map(([t]) => ({ label: t })), validFor: /^[\p{L}\p{N}_/-]*$/u };
    };
    const files = async (list: FileList | File[] | null, v: EditorView, pos?: number) => {
      if (!list?.length) return false;
      const parts: string[] = [];
      for (const f of Array.from(list)) { try { parts.push(await addFile(f)); } catch (e) { toast((e as Error).message); } }
      if (!parts.length) return true;
      const at = pos ?? v.state.selection.main.head;
      const ins = parts.join("\n") + "\n";
      v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length } });
      return true;
    };
    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true), // Arabic lines RTL, English lines LTR, in the same note
      EditorView.contentAttributes.of({ spellcheck: String(getSettings().spellcheck), dir: "auto", autocorrect: "on", autocapitalize: "sentences" }),
      autocompletion({ override: [wikiComplete, tagComplete], icons: false }),
      keymap.of([
        { key: "Mod-b", run: (v) => (ACTIONS.bold(v), true) },
        { key: "Mod-i", run: (v) => (ACTIONS.italic(v), true) },
        { key: "Mod-e", run: (v) => (ACTIONS.code(v), true) },
        { key: "Mod-Shift-x", run: (v) => (ACTIONS.task(v), true) },
        { key: "Mod-Shift-m", run: (v) => (ACTIONS.math(v), true) },
      ]),
      EditorView.domEventHandlers({
        paste: (e, v) => { const fl = e.clipboardData?.files; if (fl?.length) { e.preventDefault(); void files(fl, v); return true; } return false; },
        drop: (e, v) => {
          const fl = e.dataTransfer?.files;
          if (!fl?.length) return false;
          e.preventDefault();
          void files(fl, v, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined);
          return true;
        },
      }),
    ];
  }, [titles, vault.tags]);

  const run = (k: keyof typeof ACTIONS) => { if (active) ACTIONS[k](active); setMore(false); };

  async function toggleVoice() {
    if (rec) { rec.stop(); return; }
    if (!getToken()) { toast("Voice notes need sync unlocked (Settings → Sync)."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        setBusy(true);
        try {
          const blob = new Blob(chunks, { type: r.mimeType });
          const { text: t } = await api<{ text: string }>("/transcribe", { method: "POST", body: blob, headers: { "Content-Type": r.mimeType } });
          if (t) insertText(t + " "); else toast("Didn't catch anything.");
        } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
      };
      r.start();
      setRec(r);
    } catch { toast("Microphone not available."); }
  }

  const tb = [
    { k: "bold", icon: <Bold size={17} />, label: "Bold (Ctrl+B)" },
    { k: "italic", icon: <Italic size={17} />, label: "Italic (Ctrl+I)" },
    { k: "h2", icon: <Heading2 size={17} />, label: "Heading" },
    { k: "list", icon: <List size={17} />, label: "List" },
    { k: "task", icon: <CheckSquare size={17} />, label: "Task" },
    { k: "link", icon: <Link2 size={17} />, label: "Link a note [[ ]]" },
  ] as const;
  const extra = [
    { k: "math", icon: <Sigma size={16} />, label: "Math block" },
    { k: "mermaid", icon: <Workflow size={16} />, label: "Mermaid diagram" },
    { k: "codeblock", icon: <Braces size={16} />, label: "Code block" },
    { k: "code", icon: <Code size={16} />, label: "Inline code" },
    { k: "table", icon: <Table size={16} />, label: "Table" },
    { k: "quote", icon: <Quote size={16} />, label: "Quote" },
    { k: "callout", icon: <Square size={16} />, label: "Callout" },
    { k: "card", icon: <span className="text-[13px] font-bold">::</span>, label: "Flashcard" },
    { k: "slide", icon: <span className="text-[13px] font-bold">—</span>, label: "New slide" },
  ] as const;

  return (
    <div className={cx("relative flex h-full min-h-0 flex-col", focus && "focus-mode")}>
      <div className="min-h-0 flex-1 overflow-hidden px-4 md:px-8">
        <CodeMirror
          value={text}
          onChange={onChange}
          onCreateEditor={(v) => (active = v)}
          extensions={extensions}
          theme="none"
          height="100%"
          className="h-full"
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: !focus, autocompletion: false, searchKeymap: true }}
          placeholder="Start writing… Markdown, $math$, ```mermaid, [[links]], #tags"
        />
      </div>
      {!focus && (
        <div className="safe-b relative flex items-center gap-0.5 overflow-x-auto border-t border-line bg-surface px-2 py-1">
          {tb.map((b) => (
            <IconButton key={b.k} label={b.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(b.k)}>{b.icon}</IconButton>
          ))}
          <IconButton label="Insert image or file" onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}><ImagePlus size={17} /></IconButton>
          <IconButton label={rec ? "Stop recording" : "Voice note → text"} active={!!rec} onClick={toggleVoice}>
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Mic size={17} className={rec ? "text-bad animate-pulse" : ""} />}
          </IconButton>
          <IconButton label="More formatting" active={more} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore((m) => !m)}><MoreHorizontal size={17} /></IconButton>
          <div className="ml-auto pr-2 text-[11.5px] text-muted tabular-nums whitespace-nowrap">{(text.match(/[\p{L}\p{N}]+/gu) ?? []).length} words</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf,audio/*,video/*,.zip,.txt,.csv"
            hidden
            onChange={async (e) => {
              const fl = e.target.files;
              if (!fl) return;
              const md: string[] = [];
              for (const f of Array.from(fl)) { try { md.push(await addFile(f)); } catch (err) { toast((err as Error).message); } }
              insertText(md.join("\n") + "\n");
              e.target.value = "";
            }}
          />
          {more && (
            <div className="absolute bottom-full right-2 z-20 mb-2 grid grid-cols-3 gap-1 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
              {extra.map((b) => (
                <button key={b.k} onMouseDown={(e) => e.preventDefault()} onClick={() => run(b.k)} className="flex h-14 w-20 flex-col items-center justify-center gap-1 rounded-[8px] text-[11px] text-muted hover:bg-surface-2 hover:text-ink">
                  {b.icon}
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
