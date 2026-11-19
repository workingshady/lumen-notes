// Video notes in the editor (design update 04, D8): Alt+T / Mod+Alt+T inserts `[mm:ss] ` for the playing video,
// timestamps are tinted chips and Mod+click seeks, "Pause while typing" pauses on the first keystroke after an
// insert and resumes on Enter on an empty line or after 4 s without typing. Registered from Editor.tsx.
import { Prec } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { flashcardInsert, formatTime, timestampAt, timestampInsert, TypingPause } from "../lib/video-notes";
import { toast } from "../lib/store";
import { currentPlayer, indexOf, PLAYER_SEL, seekNote, twinOf, videoRegistry, type VideoCtl } from "./video-players";

const PREF = "lumen.video.pauseTyping";
export const pauseTyping = {
  get: () => { try { return localStorage.getItem(PREF) === "1"; } catch { return false; } },
  set: (on: boolean) => { try { localStorage.setItem(PREF, on ? "1" : "0"); } catch { /* ignore */ } },
};

let view: EditorView | null = null;
const typing = new TypingPause(4000);
let pausedCtl: VideoCtl | null = null;
let idle: ReturnType<typeof setInterval> | undefined;
let touchTap = false;

/** The editor the video tools write into (the last focused one). */
export const videoEditor = () => (view?.dom.isConnected ? view : null);

function resume() {
  const c = pausedCtl && twinOf(pausedCtl); // the preview may have re-rendered (or handed the video to the dock) meanwhile
  if (pausedCtl) pausedCtl.held = false;
  pausedCtl = null;
  if (c) { c.held = false; c.play(); }
}

/** Insert a timestamp (or a flashcard line) for `ctl` (default: the current player) at the caret. */
export function insertVideoMark(kind: "timestamp" | "card", ctl: VideoCtl | null = currentPlayer(), v: EditorView | null = videoEditor()): boolean {
  if (!v) return false;
  if (!ctl) { toast("Play the video first, then add a timestamp."); return true; }
  const doc = v.state.doc.toString();
  const t = Math.floor(ctl.time());
  const r = (kind === "card" ? flashcardInsert : timestampInsert)(doc, v.state.selection.main.head, t, indexOf(ctl));
  v.dispatch({ changes: { from: r.at, insert: r.text }, selection: { anchor: r.caret }, scrollIntoView: true, userEvent: "input.video" });
  v.focus();
  if (pauseTyping.get()) { typing.inserted(ctl.playing()); pausedCtl = null; }
  showInserted(v, r.caret, formatTime(t), kind);
  return true;
}

/** 20b: a short notice under the caret, "[41:07] Inserted from the playing video · Alt+T". */
let notice: HTMLElement | null = null;
let noticeT: ReturnType<typeof setTimeout> | undefined;
function showInserted(v: EditorView, pos: number, label: string, kind: "timestamp" | "card") {
  requestAnimationFrame(() => {
    const c = v.coordsAtPos(pos);
    if (!c) return;
    notice?.remove();
    clearTimeout(noticeT);
    const el = document.createElement("div");
    el.className = "vn-inserted";
    el.setAttribute("role", "status");
    const b = document.createElement("b"); b.textContent = label;
    const i = document.createElement("i"); i.textContent = kind === "card" ? "· type the question" : "· Alt+T";
    el.append(b, kind === "card" ? "Flashcard at this moment" : "Inserted from the playing video", i);
    el.style.left = `${Math.max(8, Math.min(innerWidth - 340, c.left - 8))}px`;
    el.style.top = `${Math.min(innerHeight - 48, c.bottom + 10)}px`;
    document.body.append(el);
    notice = el;
    noticeT = setTimeout(() => { el.remove(); if (notice === el) notice = null; }, 2600);
  });
}

const tsDeco = new MatchDecorator({
  regexp: /(?<!\\)\[(?:\d{1,2}:[0-5]\d:[0-5]\d|\d{1,3}:[0-5]\d)\](?:\(#video-\d{1,2}\))?(?![([])/g,
  decoration: () => Decoration.mark({ class: "cm-vts", attributes: { title: "Ctrl/Cmd+click to play from here" } }),
});

/** CodeMirror extension (one per editor). */
export function videoNotes() {
  return [
    ViewPlugin.fromClass(class {
      d: DecorationSet;
      constructor(readonly v: EditorView) {
        this.d = tsDeco.createDeco(v);
        view = v;
        document.body.classList.add("vn-has-editor");
        videoRegistry.insert = (kind, ctl) => void insertVideoMark(kind, ctl);
        idle ??= setInterval(() => { if (typing.tick(Date.now()) === "resume") resume(); }, 500);
      }
      update(u: ViewUpdate) {
        this.d = tsDeco.updateDeco(u, this.d);
        if (u.focusChanged && u.view.hasFocus) view = u.view;
        // "Pause while typing": the first typed change after an insert pauses; later typing just pushes the idle timer
        if (u.docChanged && u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete") || tr.isUserEvent("input.paste"))) {
          const a = typing.key(Date.now());
          if (a === "pause") { const c = currentPlayer(); if (c?.playing()) { c.held = true; c.pause(); pausedCtl = c; } else typing.reset(); }
        }
      }
      destroy() {
        if (view === this.v) { view = null; document.body.classList.remove("vn-has-editor"); videoRegistry.insert = null; }
      }
    }, { decorations: (p) => p.d }),
    Prec.high(keymap.of([
      { key: "Alt-t", run: (v) => insertVideoMark("timestamp", currentPlayer(), v) },
      { key: "Mod-Alt-t", run: (v) => insertVideoMark("timestamp", currentPlayer(), v) },
      {
        key: "Enter",
        run: (v) => {
          // resume on Enter on an empty line (never consumes the key)
          if (pausedCtl && !v.state.doc.lineAt(v.state.selection.main.head).text.trim() && typing.key(Date.now(), true) === "resume") resume();
          return false;
        },
      },
    ])),
    EditorView.domEventHandlers({
      // Phone: with the video docked, tapping a timestamp also plays from there (the caret still moves, so it stays editable).
      pointerdown: (e) => { touchTap = e.pointerType === "touch"; return false; },
      click: (e, v) => {
        if (!touchTap || !videoRegistry.dock?.root()?.querySelector(PLAYER_SEL)) return false;
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const line = v.state.doc.lineAt(pos);
        const ts = timestampAt(line.text, pos - line.from);
        if (ts) seekNote(ts.video, ts.seconds);
        return false;
      },
      mousedown: (e, v) => {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const line = v.state.doc.lineAt(pos);
        const ts = timestampAt(line.text, pos - line.from);
        if (!ts) return false;
        e.preventDefault();
        if (!seekNote(ts.video, ts.seconds)) toast("No video in this note to play.");
        return true;
      },
    }),
  ];
}

/** Manual play/pause from the video bar cancels a pending "Pause while typing" state. */
export const resetTypingPause = () => { typing.reset(); if (pausedCtl) pausedCtl.held = false; pausedCtl = null; };
