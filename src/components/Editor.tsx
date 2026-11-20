import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { dismissSlash, slashKeys, slashMenu, SlashMenu, type SlashState } from "./SlashMenu";
import { InsertGallery, setGalleryEditor } from "./InsertGallery";
import { Glyph } from "./Glyph";
import { glyphSvg } from "../lib/glyph-svg";
import { liveLook } from "./editor-live";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { t, useLang } from "../lib/i18n";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { Bold, Braces, CheckSquare, Code, Diamond, Heading, ImagePlus, Italic, Link2, List, ListTodo, Loader2, Mic, MoreHorizontal, Quote, Sigma, Square, Table, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { api, getToken } from "../lib/api";
import { addFile } from "../lib/attachments";
import { getSettings } from "../lib/settings";
import { toast, useVault } from "../lib/store";
import { cx } from "./ui";
import { isTooBig, TooBigDialog } from "./StorageTooBig";
import { setSaving } from "./ws-sync";
import { blockEditing, blockRefSource, type BlockMenuRequest } from "./editor-blocks";
import { clozeEditing } from "./editor-cloze";
import { BlockMenu } from "./BlockMenu";
import { PasteMenu, pasteWatch, type PasteInfo } from "./PasteMenu";
import { parseBlocks, pendingBlock } from "../lib/blocks";
import { videoNotes } from "./editor-video";
import { VideoNoteBar } from "./video-dock";

let showTooBig: ((f: File) => void) | null = null;

// The one active editor, so panels (AI, templates, toolbar) can insert text.
let active: EditorView | null = null;
/** The active editor view (Insert gallery, block menu). */
export const getActiveEditor = () => active;
setGalleryEditor(() => active);
export function insertText(text: string, mode: "cursor" | "end" = "cursor") {
  if (!active) return false;
  const st = active.state;
  const pos = mode === "end" ? st.doc.length : st.selection.main.head;
  active.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
  active.focus();
  return true;
}
/** 0-based line of the caret in the active editor, or -1. */
export const cursorLine = () => (active ? active.state.doc.lineAt(active.state.selection.main.head).number - 1 : -1);
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

// Token classes (design ScreenWorkspace: bold headings, muted markup; 6A: muted marks + sized headings in live editing).
const mdStyle = HighlightStyle.define([
  { tag: [tags.heading1], class: "cm-h cm-h1" },
  { tag: [tags.heading2], class: "cm-h cm-h2" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: "cm-h" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.atom], class: "cm-mk" },
  { tag: tags.strong, class: "cm-strong" },
  { tag: tags.emphasis, class: "cm-em" },
  { tag: tags.monospace, class: "cm-code" },
  { tag: tags.url, class: "cm-url" },
  { tag: tags.quote, class: "cm-quote" },
]);

// Teal [[links]] / #tags, $math$ delimiters muted, $$ display math in mono.
const wlDeco = new MatchDecorator({
  regexp: /\[\[[^\]\n]+\]\]|(?<=^|\s)#[\p{L}\p{N}_/-]+|\$\$[^\n]*?\$\$|\$[^$\n]+\$/gu,
  decorate: (add, from, to, m) => {
    const s = m[0];
    if (s.startsWith("$$")) add(from, to, Decoration.mark({ class: "cm-mathblock" }));
    else if (s.startsWith("$")) { add(from, from + 1, Decoration.mark({ class: "cm-mathd" })); add(to - 1, to, Decoration.mark({ class: "cm-mathd" })); }
    else add(from, to, Decoration.mark({ class: s.startsWith("#") ? "cm-tg" : "cm-wl" }));
  },
});
const linkMarks = ViewPlugin.fromClass(class { d: DecorationSet; constructor(v: EditorView) { this.d = wlDeco.createDeco(v); } update(u: ViewUpdate) { this.d = wlDeco.updateDeco(u, this.d); } }, { decorations: (p) => p.d });
// Whole-line tints: front-matter, done tasks and callout heads muted; `Q :: A` cards violet.
const lineMarks = ViewPlugin.fromClass(class {
  d: DecorationSet;
  constructor(v: EditorView) { this.d = this.build(v); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.d = this.build(u.view); }
  build(v: EditorView) {
    const b = new RangeSetBuilder<Decoration>();
    const doc = v.state.doc;
    let fmEnd = 0;
    if (doc.lines > 1 && doc.line(1).text === "---") for (let i = 2; i <= Math.min(doc.lines, 60); i++) if (doc.line(i).text === "---") { fmEnd = i; break; }
    for (const { from, to } of v.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = doc.lineAt(pos);
        const cls = fmEnd && line.number <= fmEnd ? "cm-fm" : /^\s*[-*+] \[[xX]\]/.test(line.text) ? "cm-done" : /^>\s*\[![\w-]+\]/.test(line.text) ? "cm-chead" : /^(?:[-*]\s+)?\S.*?\s+::\s+\S/.test(line.text) ? "cm-fc" : "";
        if (cls) b.add(line.from, line.from, Decoration.line({ class: cls }));
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (p) => p.d });

// Focus mode (7A/7B): highlight the paragraph under the cursor, dim the rest, keep the caret line centred (typewriter).
const focusPara = ViewPlugin.fromClass(class {
  d: DecorationSet;
  constructor(v: EditorView) { this.d = this.build(v); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.d = this.build(u.view);
    if (u.docChanged || u.selectionSet) { const head = u.state.selection.main.head; queueMicrotask(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) })); }
  }
  build(v: EditorView) {
    const doc = v.state.doc;
    const cur = doc.lineAt(v.state.selection.main.head).number;
    let a = cur, z = cur;
    while (a > 1 && doc.line(a - 1).text.trim()) a--;
    while (z < doc.lines && doc.line(z + 1).text.trim()) z++;
    const b = new RangeSetBuilder<Decoration>();
    for (let i = a; i <= z; i++) b.add(doc.line(i).from, doc.line(i).from, Decoration.line({ class: "cm-cur-para" }));
    return b.finish();
  }
}, { decorations: (p) => p.d });

// ------------------------------------------------------------------ paste a URL → Preview card / Embed / Plain link (R2-2D)
type PasteChoice = "card" | "embed" | "plain";
interface PasteState { url: string; from: number; to: number; x: number; y: number; embed: boolean; sel: PasteChoice }
const EMBEDDABLE = /youtu\.?be|vimeo\.com|\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|pdf)(\?|#|$)/i;
const choiceKey = (url: string) => { try { return "lumen.pasteChoice." + new URL(url).hostname; } catch { return "lumen.pasteChoice.x"; } };

export function Editor({ note, focus, live, page }: { note: Note; focus?: boolean; live?: boolean; page?: boolean }) {
  const { rtl: uiRtl } = useLang();
  const vault = useVault();
  const [text, setText] = useState(note.body);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(note.body);
  const fileRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [tooBig, setTooBig] = useState<File | null>(null);
  const [paste, setPaste] = useState<PasteState | null>(null);
  const pasteRef = useRef<PasteState | null>(null);
  pasteRef.current = paste;
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Block handle menu + paste options (editor-blocks.ts, PasteMenu.tsx)
  const [blockMenu, setBlockMenu] = useState<BlockMenuRequest | null>(null);
  const [pasteMenu, setPasteMenu] = useState<PasteInfo | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [pasteBusy, setPasteBusy] = useState<"keep" | "clean" | "quote" | "card" | "summary" | "cards" | null>(null);
  const pasteBusyRef = useRef(pasteBusy);
  pasteBusyRef.current = pasteBusy;
  const titleRef = useRef(note.title);
  titleRef.current = note.title;
  showTooBig = setTooBig;
  const wide = typeof innerWidth === "number" && innerWidth >= 900;

  // Switch notes, or remote update while not typing.
  useEffect(() => {
    if (note.body !== latest.current && !timer.current) { setText(note.body); latest.current = note.body; }
  }, [note.id, note.body]);
  useEffect(() => () => { clearTimeout(timer.current); setSaving(false); }, []);
  // flush pending save when switching away
  useEffect(() => {
    const id = note.id;
    return () => {
      if (timer.current) { clearTimeout(timer.current); void updateNote(id, { body: latest.current }); timer.current = undefined; setSaving(false); }
    };
  }, [note.id]);
  // the paste chip lasts 12 s or until you type ("Esc · fades in 12 s")
  useEffect(() => { if (!paste) return; const tm = setTimeout(() => setPaste(null), 12000); return () => clearTimeout(tm); }, [paste]);
  // the paste-options menu lasts 12 s (not while the AI works)
  useEffect(() => { if (!pasteMenu || pasteBusy) return; const tm = setTimeout(() => setPasteMenu(null), 12000); return () => clearTimeout(tm); }, [pasteMenu, pasteBusy]);
  // Arrived through a [[Note#^id]] link while editing: put the caret on that block (the preview scrolls on its own).
  useEffect(() => {
    if (!pendingBlock.id || Date.now() - pendingBlock.at > 8000 || pendingBlock.title.toLowerCase() !== note.title.toLowerCase()) return;
    const blk = parseBlocks(note.body).find((b) => b.id === pendingBlock.id);
    if (!blk) return;
    const tm = setTimeout(() => {
      const v = viewRef.current;
      if (!v || blk.a + 1 > v.state.doc.lines) return;
      const l = v.state.doc.line(blk.a + 1);
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
      // arrival wash on the block's lines (R4-16G), fades over 1.2 s
      requestAnimationFrame(() => {
        for (let n = blk.a; n <= blk.b && n < v.state.doc.lines; n++) {
          const node = v.domAtPos(v.state.doc.line(n + 1).from).node;
          const el = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest(".cm-line");
          if (el) { el.classList.add("blk-arrive"); setTimeout(() => el.classList.remove("blk-arrive"), 1600); }
        }
      });
    }, 60);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const onChange = (v: string) => {
    setText(v);
    latest.current = v;
    clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(() => { timer.current = undefined; void updateNote(note.id, { body: v }).finally(() => setSaving(false)); }, 400);
  };

  function applyPaste(choice: PasteChoice) {
    const p = pasteRef.current;
    if (!p || !active) return;
    try { localStorage.setItem(choiceKey(p.url), choice); } catch { /* ignore */ }
    const cur = active.state.sliceDoc(p.from, p.to);
    if (cur === p.url) {
      let host = p.url;
      try { const u = new URL(p.url); host = (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, ""); } catch { /* keep */ }
      const md = choice === "plain" ? `[${host}](${p.url})` : choice === "card" && EMBEDDABLE.test(p.url) ? `<${p.url}>` : choice === "embed" && !/youtu\.?be|vimeo\.com/i.test(p.url) ? `![](${p.url})` : p.url;
      active.dispatch({ changes: { from: p.from, to: p.to, insert: md }, selection: { anchor: p.from + md.length } });
    }
    setPaste(null);
    active.focus();
  }

  // Completion sources read the vault through refs: a vault rebuild (every save) must not reconfigure CodeMirror.
  const notesRef = useRef(vault.notes);
  notesRef.current = vault.notes;
  const tagsRef = useRef(vault.tags);
  tagsRef.current = vault.tags;
  const pasteMenuRef = useRef(pasteMenu);
  pasteMenuRef.current = pasteMenu;
  const extensions = useMemo(() => {
    const wikiComplete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!m || m.text.includes("#^")) return null; // [[Note#^ → block completion (editor-blocks.ts)
      return { from: m.from + 2, options: notesRef.current.map((n) => ({ label: n.title, apply: `${n.title}]]` })), validFor: /^[^\]\n]*$/ };
    };
    const tagComplete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}_/-]*/u);
      if (!m) return null;
      const start = m.text.indexOf("#") + m.from + 1;
      return { from: start, options: tagsRef.current.map(([x]) => ({ label: x })), validFor: /^[\p{L}\p{N}_/-]*$/u };
    };
    const files = async (list: FileList | File[] | null, v: EditorView, pos?: number) => {
      if (!list?.length) return false;
      const parts: string[] = [];
      for (const f of Array.from(list)) { if (isTooBig(f)) { showTooBig?.(f); continue; } try { parts.push(await addFile(f)); } catch (e) { toast((e as Error).message); } }
      if (!parts.length) return true;
      const at = pos ?? v.state.selection.main.head;
      const ins = parts.join("\n") + "\n";
      v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length } });
      return true;
    };
    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(mdStyle),
      EditorView.lineWrapping,
      linkMarks,
      lineMarks,
      ...(focus ? [focusPara] : []),
      // R4 page surface: centred serif column, heading marks hidden off the caret line, blank lines between blocks shortened
      ...((page || live) && !focus ? [liveLook()] : []),
      // "/" menu (components/SlashMenu.tsx): popover on desktop, bottom sheet on phone
      slashMenu({ change: (s) => setSlash(s), key: (k) => slashKeys.current?.current(k) ?? false }),
      // ⋮⋮ block handle / drag / block menu / Alt+↑↓ / Mod+Shift+D (handles hidden in focus mode and .mermaid files)
      blockEditing({ menu: (r) => setBlockMenu(r), handles: !focus && note.type !== "diagram" }),
      clozeEditing(), // cloze underline + card chips, ```occlusion editor (editor-cloze.ts)
      videoNotes(), // [12:34] timestamps: Alt+T insert, Mod+click seek, pause while typing (editor-video.ts)
      pasteWatch(
        (p, v) => {
          // under the pasted block, aligned with the text column (R4-16H)
          const c = v.coordsAtPos(p.to);
          const l = v.coordsAtPos(v.state.doc.lineAt(p.from).from);
          const box = wrapRef.current?.getBoundingClientRect();
          setPasteMenu({ ...p, x: (l?.left ?? c?.left ?? 0) - (box?.left ?? 0), y: (c?.bottom ?? 0) - (box?.top ?? 0) + 10 });
        },
        (ch) => setPasteMenu((m) => (!m ? m : pasteBusyRef.current ? { ...m, from: ch.mapPos(m.from), to: ch.mapPos(m.to, 1) } : null)),
      ),
      EditorView.perLineTextDirection.of(true), // Arabic lines RTL, English lines LTR, in the same note
      EditorView.contentAttributes.of({ spellcheck: String(getSettings().spellcheck), dir: "auto", autocorrect: "on", autocapitalize: "sentences" }),
      // [[wiki]], [[Note#^block]] and #tag completion (block rows: glyph · text · ^id / "add id", R4-16G)
      autocompletion({
        override: [blockRefSource(() => notesRef.current, () => titleRef.current, (id, body) => void updateNote(id, { body })), wikiComplete, tagComplete],
        icons: false, addToOptions: [blockRefIcon, blockRefId], maxRenderedOptions: 80,
        tooltipClass: (st) => "lm-complete" + (BLKREF.test(st.sliceDoc(Math.max(0, st.selection.main.head - 160), st.selection.main.head)) ? " lm-blkref" : ""),
      }),
      keymap.of([
        { key: "Mod-b", run: (v) => (ACTIONS.bold(v), true) },
        { key: "Mod-i", run: (v) => (ACTIONS.italic(v), true) },
        { key: "Mod-e", run: (v) => (ACTIONS.code(v), true) },
        { key: "Mod-Shift-x", run: (v) => (ACTIONS.task(v), true) },
        { key: "Mod-Shift-m", run: (v) => (ACTIONS.math(v), true) },
      ]),
      EditorView.domEventHandlers({
        paste: (e, v) => {
          const fl = e.clipboardData?.files;
          if (fl?.length) { e.preventDefault(); void files(fl, v); return true; }
          const s = e.clipboardData?.getData("text/plain")?.trim() ?? "";
          if (/^https?:\/\/\S+$/.test(s)) {
            const line = v.state.doc.lineAt(v.state.selection.main.head);
            if (!line.text.trim() || v.state.selection.main.from === line.from && v.state.selection.main.to === line.to) {
              // bare URL on its own line → offer Preview card / Embed / Plain link
              setTimeout(() => {
                const at = v.state.doc.lineAt(v.state.selection.main.head);
                if (at.text.trim() !== s) return;
                const c = v.coordsAtPos(at.from);
                const box = wrapRef.current?.getBoundingClientRect();
                let remembered: PasteChoice | null = null;
                try { remembered = localStorage.getItem(choiceKey(s)) as PasteChoice | null; } catch { /* ignore */ }
                const embed = EMBEDDABLE.test(s);
                setPaste({ url: s, from: at.from + at.text.indexOf(s), to: at.from + at.text.indexOf(s) + s.length, x: (c?.left ?? 0) - (box?.left ?? 0), y: (c?.bottom ?? 0) - (box?.top ?? 0) + 8, embed, sel: remembered && (remembered !== "embed" || embed) ? remembered : "card" });
              }, 0);
            }
          }
          return false;
        },
        keydown: (e) => {
          // paste-options menu: Esc dismisses (keeps the paste); any other key just closes it and goes through
          if (pasteMenuRef.current && !pasteBusyRef.current && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
            setPasteMenu(null);
            if (e.key === "Escape") { e.preventDefault(); return true; }
          }
          const p = pasteRef.current;
          if (!p) return false;
          if (e.key === "Enter") { e.preventDefault(); applyPaste(p.sel); return true; }
          if (e.key === "Escape") { e.preventDefault(); setPaste(null); return true; }
          if (e.key === "Tab" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
            const opts: PasteChoice[] = p.embed ? ["card", "embed", "plain"] : ["card", "plain"];
            const i = opts.indexOf(p.sel);
            e.preventDefault();
            setPaste({ ...p, sel: opts[(i + (e.key === "ArrowLeft" || e.shiftKey ? opts.length - 1 : 1)) % opts.length] });
            return true;
          }
          setPaste(null);
          return false;
        },
        drop: (e, v) => {
          const fl = e.dataTransfer?.files;
          if (!fl?.length) return false;
          e.preventDefault();
          void files(fl, v, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined);
          return true;
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, note.type, page, live]);

  const run = (k: keyof typeof ACTIONS) => { if (active) ACTIONS[k](active); setMore(false); };

  async function toggleVoice() {
    if (rec) { rec.stop(); return; }
    if (!getToken()) { toast(t("Voice notes need sync unlocked (Settings → Sync).")); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        setRec(null);
        setBusy(true);
        try {
          const blob = new Blob(chunks, { type: r.mimeType });
          const { text: tx } = await api<{ text: string }>("/transcribe", { method: "POST", body: blob, headers: { "Content-Type": r.mimeType } });
          if (tx) insertText(tx + " "); else toast(t("Didn't catch anything."));
        } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
      };
      r.start();
      setRec(r);
    } catch { toast(t("Microphone not available.")); }
  }
  editorBridge.voice = toggleVoice;
  editorBridge.image = () => fileRef.current?.click();

  // Phone keyboard toolbar, design order (6A): B · I · H · list · task · {} · ∑ · ◇ · image · voice, then ⋯ pinned.
  const tb = [
    { k: "bold", icon: <Bold size={19} />, label: t("Bold (Ctrl+B)") },
    { k: "italic", icon: <Italic size={19} />, label: t("Italic (Ctrl+I)") },
    { k: "h2", icon: <Heading size={19} />, label: t("Heading") },
    { k: "list", icon: <List size={19} />, label: t("List") },
    { k: "task", icon: <ListTodo size={19} />, label: t("Task") },
    { k: "codeblock", icon: <Braces size={19} />, label: t("Code block") },
    { k: "math", icon: <Sigma size={19} />, label: t("Math block") },
    { k: "mermaid", icon: <Diamond size={19} />, label: t("Diagram (Mermaid)") },
  ] as const;
  const extra = [
    { k: "link", icon: <Link2 size={16} />, label: t("Link a note") },
    { k: "callout", icon: <Square size={16} />, label: t("Callout") },
    { k: "code", icon: <Code size={16} />, label: t("Inline code") },
    { k: "table", icon: <Table size={16} />, label: t("Table") },
    { k: "quote", icon: <Quote size={16} />, label: t("Quote") },
    { k: "task", icon: <CheckSquare size={16} />, label: t("Task") },
    { k: "card", icon: <span className="text-[13px] font-bold">::</span>, label: t("Flashcard") },
    { k: "slide", icon: <span className="text-[13px] font-bold">—</span>, label: t("New slide") },
    { k: "mermaid", icon: <Workflow size={16} />, label: "Mermaid" },
  ] as const;
  const showBar = !focus && (live || !wide);
  const pasteOpts: { k: PasteChoice; glyph: string; label: string }[] = [
    { k: "card", glyph: "link-card", label: t("Preview card") },
    ...(paste?.embed ? [{ k: "embed" as const, glyph: "embed", label: t("Embed") }] : []),
    { k: "plain", glyph: "wikilink", label: t("Plain link") },
  ];

  // Arabic interface: the editor follows the note's own script (an English note keeps gutter/handles on the left).
  const edDir = uiRtl ? (arabicDominant(text) ? "rtl" : "ltr") : undefined;
  return (
    <div ref={wrapRef} className={cx("relative flex h-full min-h-0 flex-col", focus && "focus-mode", live && !focus && "ed-live", page && !focus && "ed-page", slash && !wide && "slash-sheet-open")}>
      {!focus && <VideoNoteBar body={text} />}
      <div dir={edDir} className={cx("ed-pad min-h-0 flex-1 overflow-hidden", focus ? "px-6" : live ? "px-5" : "px-4 md:px-8")}>
        <CodeMirror
          value={text}
          onChange={onChange}
          onCreateEditor={(v) => { active = v; viewRef.current = v; }}
          extensions={extensions}
          theme="none"
          height="100%"
          className="h-full"
          basicSetup={{ lineNumbers: !focus && !live && !page && wide, foldGutter: false, highlightActiveLine: !focus && !live && !page, highlightActiveLineGutter: !focus && !live && !page, autocompletion: false, searchKeymap: true, syntaxHighlighting: false }}
          placeholder={t("Start writing… Markdown, $math$, ```mermaid, [[links]], #tags")}
        />
      </div>
      {/* paste-a-URL chip (R4-16I): floating on desktop, a pill row above the toolbar on phone */}
      {paste && wide && (
        <div className="paste-menu absolute z-30 flex items-center gap-0.5 rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] fade-in" style={{ left: Math.max(8, paste.x), top: paste.y, boxShadow: "0 14px 34px rgba(0,0,0,.45)" }} onMouseDown={(e) => e.preventDefault()}>
          {pasteOpts.map((o) => (
            <button key={o.k} title={o.k === paste.sel ? t("↵ to choose") : undefined} onClick={() => applyPaste(o.k)} className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5" style={paste.sel === o.k ? { background: "color-mix(in srgb,var(--accent) 14%,transparent)", boxShadow: "inset 0 0 0 1px var(--accent)", fontWeight: 600 } : { fontWeight: 450 }}>
              <Glyph name={o.glyph} size={14} color="var(--muted)" />{o.label}
            </button>
          ))}
          <span className="mx-1 h-[18px] w-px bg-line" /><span className="whitespace-nowrap pe-1.5 text-[11.5px] text-muted">{t("Esc · fades in {s} s", { s: 12 })}</span>
        </div>
      )}
      {pasteMenu && viewRef.current && (wide || !showBar) && (
        <PasteMenu info={pasteMenu} view={viewRef.current} phone={false} busy={pasteBusy} setBusy={setPasteBusy} onClose={() => setPasteMenu(null)} />
      )}
      {pasteMenu && viewRef.current && showBar && !wide && (
        <PasteMenu info={pasteMenu} view={viewRef.current} phone busy={pasteBusy} setBusy={setPasteBusy} onClose={() => setPasteMenu(null)} />
      )}
      <BlockMenu req={blockMenu} title={note.title} onClose={() => setBlockMenu(null)} />
      {slash && <SlashMenu state={slash} phone={!wide} box={wrapRef.current} onAction={(a) => { dismissSlash(slash.view); if (a === "file") editorBridge.image?.(); else void toggleVoice(); }} />}
      <InsertGallery />
      {showBar && paste && (
        <div className="flex gap-2 border-t border-line bg-surface-2 px-3 py-2" onMouseDown={(e) => e.preventDefault()}>
          {pasteOpts.map((o) => (
            <button key={o.k} onClick={() => applyPaste(o.k)} className={cx("flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px]", paste.sel === o.k ? "font-semibold" : "border border-line")} style={paste.sel === o.k ? { background: "color-mix(in srgb,var(--accent) 14%,transparent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : undefined}><Glyph name={o.glyph} size={14} color="var(--muted)" />{o.label}</button>
          ))}
        </div>
      )}
      {showBar && (
        <div className="safe-b relative flex h-12 shrink-0 items-stretch border-t border-line bg-surface">
          <div className="flex min-w-0 flex-1 items-center justify-around overflow-x-auto px-1">
            {tb.map((b) => (
              <button key={b.k} aria-label={b.label} title={b.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(b.k)} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink active:bg-surface-2">{b.icon}</button>
            ))}
            <button aria-label={t("Insert image or file")} title={t("Insert image or file")} onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink active:bg-surface-2"><ImagePlus size={19} /></button>
            <button aria-label={rec ? t("Stop recording") : t("Voice note → text")} title={t("Voice note → text")} onClick={toggleVoice} className={cx("flex h-10 w-9 shrink-0 items-center justify-center rounded-[8px]", rec ? "text-bad" : "text-accent")}>
              {busy ? <Loader2 size={19} className="animate-spin" /> : <Mic size={19} className={rec ? "animate-pulse" : ""} />}
            </button>
          </div>
          <div className="my-2 w-px bg-line" />
          <button aria-label={t("More formatting")} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore((m) => !m)} className={cx("flex w-12 shrink-0 items-center justify-center", more ? "text-accent" : "text-ink")}><MoreHorizontal size={20} /></button>
          {more && (
            <div className="absolute bottom-full end-2 z-20 mb-2 grid grid-cols-3 gap-1 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
              {extra.map((b, i) => (
                <button key={b.k + i} onMouseDown={(e) => e.preventDefault()} onClick={() => run(b.k)} className="flex h-14 w-20 flex-col items-center justify-center gap-1 rounded-[8px] text-[11px] text-muted hover:bg-surface-2 hover:text-ink">
                  {b.icon}
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
          for (const f of Array.from(fl)) { if (isTooBig(f)) { setTooBig(f); continue; } try { md.push(await addFile(f)); } catch (err) { toast((err as Error).message); } }
          insertText(md.join("\n") + "\n");
          e.target.value = "";
        }}
      />
      <TooBigDialog file={tooBig} onClose={() => setTooBig(null)} onChooseAnother={() => { setTooBig(null); fileRef.current?.click(); }} onPasteLink={() => { setTooBig(null); insertText("\nhttps://youtu.be/\n"); }} />
    </div>
  );
}

/** Glyph column of [[Note#^ block completions (editor-blocks.ts sets `lmGlyph`). */
const BLKREF = /\[\[[^\]\n]*#\^[\w-]*$/;
const blockRefIcon = {
  render: (c: Completion) => {
    const g = (c as Completion & { lmGlyph?: string }).lmGlyph;
    if (!g) return null;
    const el = document.createElement("span");
    el.className = "lm-blk-ic";
    el.innerHTML = glyphSvg(g, 15);
    return el;
  },
  position: 20,
};
const blockRefId = {
  render: (c: Completion) => {
    const id = (c as Completion & { lmId?: string }).lmId;
    if (!id) return null;
    const el = document.createElement("span");
    el.className = "lm-blk-id" + (id.startsWith("^") ? " has" : "");
    el.textContent = id;
    return el;
  },
  position: 80,
};

/** Lets the note header's ⋯ menu (desktop, no toolbar) trigger image insert / voice note on the active editor. */
export const editorBridge: { voice: (() => void) | null; image: (() => void) | null } = { voice: null, image: null };

/** More Arabic than Latin letters in the first few thousand characters (front-matter included). */
function arabicDominant(s: string) { const h = s.slice(0, 4000); return (h.match(/[؀-ۿ]/g)?.length ?? 0) > (h.match(/[A-Za-z]/g)?.length ?? 0); }
