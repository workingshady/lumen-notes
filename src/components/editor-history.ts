// Undo / redo for the Markdown editor: our own CodeMirror history config, the shortcut keymap, a tiny store the
// toolbar buttons and the editor footer read, and the "apply an outside change" path used when the note's body
// changes from somewhere else (sync, Preview checkbox, Assistant "add as card", tag edits) while it is open.
import { history, historyField, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { ExternalChange } from "@uiw/react-codemirror";
import { useSyncExternalStore } from "react";
import { t } from "../lib/i18n";

/** True on Apple keyboards (labels say ⌘ instead of Ctrl). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

/**
 * Word-sized undo steps (Google Docs / Word feel): typing joins into one step until a pause of 1 s, a new word
 * starts after whitespace, or a line break. Programmatic edits (toolbar, AI, slash blocks) never merge with typing.
 */
function joinToEvent(tr: Transaction, adjacent: boolean) {
  if (!adjacent) return false;
  if (!tr.isUserEvent("input.type") && !tr.isUserEvent("delete")) return false;
  let join = true;
  tr.changes.iterChanges((fromA, _toA, _fromB, _toB, ins) => {
    const s = ins.toString();
    if (s.includes("\n")) join = false;
    else if (s && /^\S/.test(s) && fromA > 0 && /\s/.test(tr.startState.sliceDoc(fromA - 1, fromA))) join = false;
  });
  return join;
}

// ------------------------------------------------------------------ store read by the buttons and the footer
export interface EdStats { undo: number; redo: number; words: number; chars: number; selWords: number; selChars: number }
let stats: EdStats = { undo: 0, redo: 0, words: 0, chars: 0, selWords: 0, selChars: 0 };
const subs = new Set<() => void>();
let current: EditorView | null = null;
const countWords = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;

function publish(state: EditorState, docChanged: boolean) {
  const sel = state.selection.main;
  const selText = sel.empty ? "" : state.sliceDoc(sel.from, sel.to);
  const next: EdStats = {
    undo: state.field(historyField, false) ? undoDepth(state) : 0,
    redo: state.field(historyField, false) ? redoDepth(state) : 0,
    words: docChanged || !stats.chars ? countWords(state.doc.toString()) : stats.words,
    chars: state.doc.length,
    selWords: selText ? countWords(selText) : 0,
    selChars: selText.length,
  };
  if (Object.keys(next).some((k) => next[k as keyof EdStats] !== stats[k as keyof EdStats])) { stats = next; subs.forEach((f) => f()); }
}
/** The view the buttons act on (the editor that was opened or focused last). */
export function setHistoryView(v: EditorView | null) {
  current = v;
  if (v) publish(v.state, true);
  else { stats = { undo: 0, redo: 0, words: 0, chars: 0, selWords: 0, selChars: 0 }; subs.forEach((f) => f()); }
}
export const historyView = () => current;
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
/** Undo / redo depth + word counts of the active editor; re-renders only when they change. */
export const useEdStats = () => useSyncExternalStore(subscribe, () => stats, () => stats);

export function runUndo() { const v = current; if (!v) return false; const ok = undo(v); v.focus(); return ok; }
export function runRedo() { const v = current; if (!v) return false; const ok = redo(v); v.focus(); return ok; }
/** Find & replace bar (CodeMirror search panel); the phone toolbar has no Ctrl+F. */
export function runFind() { const v = current; if (!v) return false; return openSearchPanel(v); }

// ------------------------------------------------------------------ history across Edit / Split / Focus switches
// Switching view mode remounts the editor; the last note's state (doc, selection, history) is kept in one slot so
// undo keeps working. Opening a different note replaces the slot: history never crosses notes.
// The new editor renders before the old one unmounts, so the slot follows every update (a reference, no copying).
let kept: { id: string; state: EditorState; at: number } | null = null;
/** Saved state for this note if it still matches its body (or changed a moment ago, before the save landed). */
export function restoreHistory(id: string, body: string) {
  if (!kept || kept.id !== id) { kept = null; return undefined; }
  if (!kept.state.field(historyField, false)) return undefined;
  const json = kept.state.toJSON({ history: historyField }) as { doc: string };
  if (json.doc !== body && Date.now() - kept.at > 3000) return undefined;
  return { json, fields: { history: historyField } };
}

// ------------------------------------------------------------------ extensions
let shortcutsOpener: (() => void) | null = null;
export const setShortcutsOpener = (f: (() => void) | null) => { shortcutsOpener = f; };

/** `noteId`: the editor is keyed per note, so its history is kept for that note only. */
export function editorHistory(noteId: string): Extension {
  return [
    EditorView.updateListener.of((u) => { if (u.docChanged || u.selectionSet || !kept || kept.id !== noteId) kept = { id: noteId, state: u.state, at: Date.now() }; }),
    history({ newGroupDelay: 1000, joinToEvent }),
    // Above the defaults: Ctrl+Shift+Z redoes on Windows too (CodeMirror binds it only on macOS / Linux).
    Prec.high(keymap.of([
      { key: "Mod-z", run: undo, preventDefault: true },
      { key: "Mod-Shift-z", run: redo, preventDefault: true },
      { key: "Mod-y", run: redo, preventDefault: true },
      { key: "Mod-/", run: () => { shortcutsOpener?.(); return !!shortcutsOpener; }, preventDefault: true },
    ])),
    EditorView.updateListener.of((u) => {
      if (u.focusChanged && u.view.hasFocus) current = u.view;
      if (u.view === current && (u.docChanged || u.selectionSet || u.transactions.length || u.focusChanged)) publish(u.state, u.docChanged);
    }),
    // search panel words follow the interface language
    EditorState.phrases.of({
      Find: t("Find"), Replace: t("Replace"), next: t("next"), previous: t("previous"), all: t("all"),
      "match case": t("match case"), regexp: t("regexp"), "by word": t("by word"), replace: t("replace"),
      "replace all": t("replace all"), close: t("close"), "Go to line": t("Go to line"), go: t("go"),
    }),
    searchTheme,
  ];
}

// The default search panel is unstyled under theme="none": give it the app's tokens and phone-sized targets.
const searchTheme = EditorView.theme({
  ".cm-panels": { background: "var(--surface)", color: "var(--text)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "8px 10px", fontSize: "13px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: "0" },
  ".cm-search .cm-textfield": { height: "32px", minWidth: "0", flex: "1 1 150px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg)", color: "var(--text)", padding: "0 8px", fontSize: "14px", margin: "0" },
  ".cm-search .cm-button": { height: "32px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface-2)", backgroundImage: "none", color: "var(--text)", padding: "0 10px", margin: "0", fontSize: "12.5px" },
  ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--muted)", fontSize: "12.5px", margin: "0" },
  ".cm-panel.cm-search [name=close]": { position: "static", marginInlineStart: "auto", width: "32px", height: "32px", padding: "0", fontSize: "20px", lineHeight: "20px", color: "var(--muted)", background: "transparent", border: "0", cursor: "pointer" },
  ".cm-searchMatch": { background: "color-mix(in srgb, var(--warning) 28%, transparent)", borderRadius: "2px" },
  ".cm-searchMatch-selected": { background: "color-mix(in srgb, var(--accent) 38%, transparent)" },
});

/**
 * Apply a body that changed outside the editor (another device, Preview checkbox, Assistant, tag edits) as one
 * minimal, isolated transaction: the caret and the local undo history stay mapped, and Ctrl+Z undoes just that
 * change. `ExternalChange` keeps react-codemirror from echoing it back as a save.
 */
export function applyExternal(v: EditorView, next: string) {
  const cur = v.state.doc.toString();
  if (cur === next) return;
  let a = 0;
  const max = Math.min(cur.length, next.length);
  while (a < max && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
  let z = 0;
  while (z < max - a && cur.charCodeAt(cur.length - 1 - z) === next.charCodeAt(next.length - 1 - z)) z++;
  v.dispatch({
    changes: { from: a, to: cur.length - z, insert: next.slice(a, next.length - z) },
    annotations: [ExternalChange.of(true), isolateHistory.of("full"), Transaction.userEvent.of("external")],
  });
}
