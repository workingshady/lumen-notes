import { BookOpen, Copy, Ellipsis, Eraser, Highlighter, Keyboard, ListTree, MessageSquare, Minus, Moon, Pause, PenLine, Play, Plus, Search, Sun, Trash2, Volume2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { applyToMarkdown, fromSelection, HL_COLORS, highlightsMarkdown, loadSession, reapply, saveSession, unwrap, wrapRange, type Highlight, type HlColor } from "../lib/highlights";
import { HL_PALETTES, hlVars, setExtraPrefs, useExtraPrefs } from "../lib/reading-prefs";
import { setSettings, type Settings } from "../lib/settings";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { Button, cx, Sheet } from "./ui";

const THEMES: { t: Settings["theme"]; label: string; icon: "sun" | "moon" | "auto" }[] = [
  { t: "auto", label: "Auto", icon: "auto" }, { t: "paper", label: "Light", icon: "sun" }, { t: "sepia", label: "Sepia", icon: "sun" }, { t: "lamplight", label: "Dark", icon: "moon" }, { t: "midnight", label: "Midnight", icon: "moon" },
];
const WPM = 200;
const SPEEDS = [0.8, 1, 1.2, 1.5, 2];
const BLOCKS = ".prose > p, .prose > h1, .prose > h2, .prose > h3, .prose > ul > li, .prose > ol > li, .prose > blockquote";

// Design round 4 (Lumen 17 · R4-17E/F): Source Serif 19/34 at a 640 px measure (Focus adds +2 px to the reading size),
// highlights at 32% of their colour, the sentence being read at 22% blue with an underline, later paragraphs dimmed.
const FOCUS_CSS = `
.focus-r4 .prose{font-family:var(--read-font);font-size:calc(var(--read-size) + 2px);line-height:1.79;max-width:none}
.focus-r4 .prose>*{margin-top:0!important;margin-bottom:20px!important}
.focus-r4 .prose>:is(h2,h3,h4){margin-top:34px!important;padding-top:0!important}
.focus-r4 .prose h1{font-size:36px;line-height:42px;margin-bottom:20px}
.focus-r4 mark.hl-live,.focus-r4 .prose mark[class*="hl-"]{border:0;border-radius:2px;padding:0;color:inherit}
${(Object.keys(HL_PALETTES.default) as HlColor[]).map((c) => `.focus-r4 mark.hl-${c}{background:color-mix(in srgb,var(--hl-${c}) 32%,transparent)}`).join("\n")}
.focus-r4 .prose mark:not([class*="hl-"]){background:color-mix(in srgb,var(--hl-yellow) 32%,transparent);border-radius:2px;color:inherit}
.focus-r4 .tts-after{opacity:.35;transition:opacity .3s}
::highlight(tts-sentence){background-color:color-mix(in srgb,var(--info) 22%,transparent);text-decoration:underline 2px var(--info);text-underline-offset:6px}
.focus-write .cm-editor .cm-content{max-width:640px;margin:0 auto;padding:max(240px,30vh) 0 45vh;font-family:var(--read-font);font-size:calc(var(--read-size) + 2px);line-height:34px}
.focus-write .cm-editor .cm-cursor{border-left:2px solid var(--accent)}
.focus-write .focus-mode .cm-editor.cm-focused .cm-line{color:color-mix(in srgb,var(--text) 25%,transparent)}
.focus-write .focus-mode .cm-editor.cm-focused .cm-line.cm-cur-para{color:var(--text)}
.focus-nodim.focus-write .focus-mode .cm-editor.cm-focused .cm-line{color:var(--text)}
`;

/** Sentences of a block with their offsets in its textContent (Intl.Segmenter, else a punctuation split). */
function sentencesOf(el: HTMLElement): { s: number; e: number; text: string }[] {
  const t = el.textContent ?? "";
  const out: { s: number; e: number; text: string }[] = [];
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Seg) for (const x of new Seg(undefined, { granularity: "sentence" }).segment(t)) { if (x.segment.trim()) out.push({ s: x.index, e: x.index + x.segment.length, text: x.segment.trim() }); }
  else for (const m of t.matchAll(/[^.!?؟]+[.!?؟]*\s*/g)) if (m[0].trim()) out.push({ s: m.index!, e: m.index! + m[0].length, text: m[0].trim() });
  return out.length ? out : [{ s: 0, e: t.length, text: t.trim() }];
}
/** A DOM Range over characters [s, e) of an element's text. */
function rangeOf(el: HTMLElement, s: number, e: number): Range | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, started = false;
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const len = n.data.length;
    if (!started && s <= pos + len) { r.setStart(n, Math.max(0, s - pos)); started = true; }
    if (started && e <= pos + len) { r.setEnd(n, Math.max(0, e - pos)); return r; }
    pos += len;
  }
  return started ? r : null;
}
type HighlightReg = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
const highlights = (): HighlightReg | null => ((globalThis.CSS as unknown as { highlights?: HighlightReg }).highlights) || null;

/**
 * Focus: a full-screen, chrome-free layer with two modes.
 *  Read  — the rendered note at a 640 px measure; outline drawer (O), highlighter (5 colours, eraser, comments, cards),
 *          read aloud (sentence by sentence, the current sentence underlined, speed, voice), reading time.
 *          Highlights stay on the page until you leave; then they can be saved into the note as ==Markdown==
 *          (colours + comment footnotes), saved as a separate highlights note, copied, or discarded.
 *  Write — the editor at the same measure; other paragraphs dimmed, typewriter scrolling.
 * The toolbar fades out while reading and comes back when the mouse moves (always visible on touch).
 */
export function FocusView({ note, wide, onExit }: { note: Note; wide: boolean; onExit: () => void }) {
  const s = useExtraPrefs();
  const v = useVault();
  const mode = s.focusMode ?? "read";
  const [bar, setBar] = useState(true);
  const [panel, setPanel] = useState<null | "highlights" | "keys">(null);
  const [outline, setOutline] = useState(() => s.focusOutline && wide && innerWidth >= 1100);
  const [list, setList] = useState<Highlight[]>(() => loadSession(note.id));
  const [pen, setPen] = useState<{ on: boolean; color: HlColor; eraser: boolean }>({ on: false, color: "yellow", eraser: false });
  const [pop, setPop] = useState<null | { x: number; y: number; kind: "sel" | "mark"; id?: string; more?: boolean }>(null);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heads, setHeads] = useState<{ id: number; text: string; level: number }[]>([]);
  const [curHead, setCurHead] = useState(0);
  const [tts, setTts] = useState<"off" | "play" | "pause">("off");
  const [ttsAt, setTtsAt] = useState({ bi: 0, n: 0, f: 0 });
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const hideT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const words = useMemo(() => (note.body.match(/[\p{L}\p{N}]+/gu) ?? []).length, [note.body]);
  const SWATCH = HL_PALETTES[s.hlPalette] ?? HL_PALETTES.default;

  useEffect(() => saveSession(note.id, list), [note.id, list]);

  // Toolbar: visible on mouse move, fades after 2.5 s of reading (never on touch, or while a panel is open).
  const poke = useCallback(() => {
    setBar(true);
    clearTimeout(hideT.current);
    if (!touch) hideT.current = setTimeout(() => setBar(false), 2500);
  }, [touch]);
  useEffect(() => { poke(); return () => clearTimeout(hideT.current); }, [poke]);

  // Keep live highlights on the page when the preview re-renders (it replaces its HTML).
  useEffect(() => {
    const el = article.current;
    if (!el || mode !== "read") return;
    const apply = () => {
      reapply(el, list);
      setHeads([...el.querySelectorAll("h1, h2, h3")].map((h, i) => ({ id: i, text: h.textContent ?? "", level: Number(h.tagName[1]) })));
    };
    apply();
    const mo = new MutationObserver(() => { mo.disconnect(); apply(); mo.observe(el, { childList: true, subtree: true }); });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [list, mode, note.body]);

  // ---------------------------------------------------------------- highlighter
  const add = (color: HlColor, comment = "") => {
    const el = article.current, sel = getSelection();
    if (!el || !sel) return;
    const r = fromSelection(el, sel, color);
    if (!r) return;
    r.h.comment = comment;
    wrapRange(r.range, r.h);
    sel.removeAllRanges();
    setList((l) => [...l, r.h]);
    setPop(null);
    return r.h;
  };
  const remove = (id: string) => { if (article.current) unwrap(article.current, id); setList((l) => l.filter((h) => h.id !== id)); setPop(null); };
  const recolor = (id: string, color: HlColor) => {
    article.current?.querySelectorAll<HTMLElement>(`mark[data-hl="${CSS.escape(id)}"]`).forEach((m) => { m.className = `hl-live hl-${color}`; });
    setList((l) => l.map((h) => (h.id === id ? { ...h, color } : h)));
  };
  const comment = (id?: string) => {
    const h = id ? list.find((x) => x.id === id) : undefined;
    const text = prompt(h ? "Note on this highlight" : "Note (saved with the highlight)", h?.comment ?? "");
    if (text === null) return;
    if (h) setList((l) => l.map((x) => (x.id === h.id ? { ...x, comment: text } : x)));
    else add(pen.color, text);
    setPop(null);
  };
  /** Card: the highlighted words become a cloze (==…==) in their sentence, added to the note's "Cards · …" flashcards note. */
  const makeCard = async (id?: string) => {
    const el = article.current;
    let exact = "", context = "";
    if (id) {
      const m = el?.querySelector<HTMLElement>(`mark[data-hl="${CSS.escape(id)}"]`);
      exact = list.find((h) => h.id === id)?.exact ?? m?.textContent ?? "";
      context = m?.closest("p, li, blockquote, h1, h2, h3")?.textContent ?? exact;
    } else {
      const sel = getSelection();
      exact = sel?.toString().trim() ?? "";
      const n = sel?.anchorNode;
      context = (n instanceof HTMLElement ? n : n?.parentElement)?.closest("p, li, blockquote, h1, h2, h3")?.textContent ?? exact;
      if (exact) add(pen.color);
    }
    exact = exact.replace(/\s+/g, " ").trim();
    if (!exact) return;
    setPop(null);
    const sentence = sentencesOfText(context).find((x) => x.includes(exact)) ?? context;
    const card = sentence.includes(exact) ? sentence.replace(exact, `==${exact}==`) : `==${exact}==`;
    const title = `Cards · ${note.title}`;
    const deck = v.notes.find((n) => !n.deleted && n.title === title && n.type === "flashcards");
    const line = `${card.trim()} ([[${note.title}]])`;
    if (deck) await updateNote(deck.id, { body: deck.body.replace(/\s*$/, "\n\n") + line + "\n" });
    else await createNote({ type: "flashcards", title, spaceId: note.spaceId, folderId: note.folderId, tags: ["cards"], body: `---\ntype: flashcards\ntags: [cards]\n---\n# ${title}\n\nCloze cards made from highlights in [[${note.title}]].\n\n${line}\n` });
    toast(`Card added to “${title}”`, { label: "Open", run: () => { const d = v.notes.find((n) => n.title === title); if (d) openNote(d.id, "read"); } });
  };
  const highlightParagraph = () => {
    // H with no selection: the paragraph closest to the middle of the screen (Readwise-style).
    const el = article.current, sc = scroller.current;
    if (!el || !sc) return;
    const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2;
    const blocks = [...el.querySelectorAll<HTMLElement>(".prose > p, .prose > ul > li, .prose > ol > li, .prose > blockquote")];
    const b = blocks.sort((a, z) => Math.abs(a.getBoundingClientRect().top - mid) - Math.abs(z.getBoundingClientRect().top - mid))[0];
    if (!b) return;
    const sel = getSelection()!;
    const r = document.createRange(); r.selectNodeContents(b);
    sel.removeAllRanges(); sel.addRange(r);
    add(pen.color);
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const mark = t.closest<HTMLElement>("mark.hl-live");
    const sel = getSelection();
    if (mark && (!sel || sel.isCollapsed)) {
      if (pen.eraser) { remove(mark.dataset.hl!); return; }
      const r = mark.getBoundingClientRect();
      setPop({ x: r.left + r.width / 2, y: r.top, kind: "mark", id: mark.dataset.hl });
      return;
    }
    if (!sel || sel.isCollapsed || !article.current?.contains(sel.anchorNode)) { setPop(null); return; }
    if (pen.on && !pen.eraser) { add(pen.color); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setPop({ x: r.left + r.width / 2, y: r.top, kind: "sel" });
  };
  const selectionText = () => getSelection()?.toString().trim() ?? "";
  const copyQuote = async () => { const t = selectionText(); if (!t) return; await navigator.clipboard.writeText(`> ${t.replace(/\s+/g, " ")}\n> — [[${note.title}]]`); toast("Quote copied with a link to the note"); setPop(null); };
  const searchSel = () => { const t = selectionText(); if (!t) return; setPop(null); leave(true); setUI({ palette: true }); setTimeout(() => { const i = document.querySelector<HTMLInputElement>("[role=dialog] input, .palette input"); if (i) { i.value = t; i.dispatchEvent(new Event("input", { bubbles: true })); } }, 120); };

  // ---------------------------------------------------------------- read aloud (Web Speech API), sentence by sentence
  const q = useRef<{ blocks: HTMLElement[]; bi: number; sents: { s: number; e: number; text: string }[]; si: number; gen: number } | null>(null);
  const rate = useRef(s.ttsRate ?? 1);
  rate.current = Math.min(3, Math.max(0.5, s.ttsRate ?? 1));
  const voice = useRef(s.ttsVoice);
  voice.current = s.ttsVoice;
  const clearMarks = () => {
    highlights()?.delete("tts-sentence");
    article.current?.querySelectorAll(".tts-after").forEach((x) => x.classList.remove("tts-after"));
  };
  const speak = useCallback(() => {
    const st = q.current;
    if (!st) return;
    while (st.si >= st.sents.length) {
      st.bi++; st.si = 0;
      if (st.bi >= st.blocks.length) { q.current = null; clearMarks(); setTts("off"); return; }
      st.sents = sentencesOf(st.blocks[st.bi]);
    }
    const el = st.blocks[st.bi], sen = st.sents[st.si];
    // dim what comes after the paragraph being read; underline the sentence
    st.blocks.forEach((b, k) => b.classList.toggle("tts-after", k > st.bi));
    const r = rangeOf(el, sen.s, sen.e);
    const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (r && H) highlights()?.set("tts-sentence", new H(r));
    const rect = (r ?? el).getBoundingClientRect(), sc = scroller.current?.getBoundingClientRect();
    if (sc && (rect.top < sc.top + 80 || rect.bottom > sc.bottom - 120)) el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTtsAt({ bi: st.bi, n: st.blocks.length, f: st.si / st.sents.length });
    const u = new SpeechSynthesisUtterance(sen.text);
    u.rate = rate.current;
    const vv = voice.current && speechSynthesis.getVoices().find((x) => x.voiceURI === voice.current);
    if (vv) { u.voice = vv; u.lang = vv.lang; }
    const gen = st.gen;
    u.onend = () => { if (q.current?.gen !== gen) return; st.si++; speak(); };
    u.onerror = (e) => { if (q.current?.gen !== gen || e.error === "interrupted" || e.error === "canceled") return; q.current = null; clearMarks(); setTts("off"); };
    speechSynthesis.speak(u);
  }, []);
  const ttsStart = (fromEl?: HTMLElement) => {
    if (!("speechSynthesis" in window)) { toast("Read aloud isn't available in this browser"); return; }
    speechSynthesis.cancel();
    const blocks = [...(article.current?.querySelectorAll<HTMLElement>(BLOCKS) ?? [])].filter((b) => (b.textContent ?? "").trim());
    if (!blocks.length) return;
    const top = scroller.current?.getBoundingClientRect().top ?? 0;
    const start = Math.max(0, fromEl ? blocks.findIndex((b) => b.contains(fromEl)) : blocks.findIndex((b) => b.getBoundingClientRect().bottom > top + 40));
    q.current = { blocks, bi: start, sents: sentencesOf(blocks[start]), si: 0, gen: (q.current?.gen ?? 0) + 1 };
    setTts("play");
    speak();
  };
  const ttsToggle = () => {
    if (tts === "off") ttsStart();
    else if (tts === "play") { speechSynthesis.pause(); setTts("pause"); }
    else { speechSynthesis.resume(); setTts("play"); }
  };
  const ttsStop = () => { if (q.current) q.current.gen++; q.current = null; if ("speechSynthesis" in window) speechSynthesis.cancel(); setTts("off"); clearMarks(); };
  const nextSpeed = () => { const r = s.ttsRate ?? 1; const i = SPEEDS.findIndex((x) => x > r + 0.001); setSettings({ ttsRate: SPEEDS[i < 0 ? 0 : i] }); };
  useEffect(() => () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); highlights()?.delete("tts-sentence"); }, []);

  // ---------------------------------------------------------------- leave (save / discard highlights)
  const saveInto = async () => {
    const r = applyToMarkdown(note.body, list);
    if (r.saved) await updateNote(note.id, { body: r.body });
    setList([]); saveSession(note.id, []);
    toast(r.missed.length ? `Saved ${r.saved} highlight${r.saved === 1 ? "" : "s"}; ${r.missed.length} could not be matched to the text (kept nothing for those)` : `Saved ${r.saved} highlight${r.saved === 1 ? "" : "s"} into the note`);
  };
  const saveAsNote = async () => {
    const n = await createNote({ title: `Highlights · ${note.title}`, body: `# Highlights · ${note.title}\n\nFrom [[${note.title}]] · ${new Date().toLocaleDateString()}\n\n${highlightsMarkdown(list, note.title)}\n`, spaceId: note.spaceId, folderId: note.folderId, tags: ["highlights"] });
    setList([]); saveSession(note.id, []);
    toast("Highlights note created", { label: "Open", run: () => openNote(n.id, "read") });
  };
  const leave = (force = false) => {
    ttsStop();
    if (!force && list.length && mode === "read") {
      const pref = s.highlightOnExit ?? "ask";
      if (pref === "ask") { setAsking(true); return; }
      if (pref === "save") void saveInto();
      else { setList([]); saveSession(note.id, []); }
    }
    onExit();
  };
  const toggleOutline = () => setOutline((o) => { setExtraPrefs({ focusOutline: !o }); return !o; });

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // While the save dialog is open, Esc means "keep reading" (never leave without a decision).
      if (asking) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); } return; }
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor, [contenteditable=true]");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (panel || pop) { setPanel(null); setPop(null); } else if (tts !== "off") ttsStop(); else leave(); return; }
      if (typing || mode !== "read" || e.ctrlKey || e.metaKey || e.altKey) return;
      const sel = selectionText();
      if (e.key === "h" || e.key === "H") { e.preventDefault(); if (sel) add(pen.color); else highlightParagraph(); }
      else if (/^[1-5]$/.test(e.key)) { const c = HL_COLORS[Number(e.key) - 1].c; setPen((p) => ({ ...p, color: c, eraser: false })); if (sel) add(c); }
      else if (e.key === "e" || e.key === "E") setPen((p) => ({ ...p, eraser: !p.eraser }));
      else if (e.key === "c" || e.key === "C") { if (sel) { e.preventDefault(); comment(); } }
      else if (e.key === "k" || e.key === "K") { if (sel) { e.preventDefault(); void makeCard(); } }
      else if (e.key === "+" || e.key === "=") setSettings({ fontSize: Math.min(26, (s.fontSize ?? 16) + 1) });
      else if (e.key === "-" || e.key === "_") setSettings({ fontSize: Math.max(12, (s.fontSize ?? 16) - 1) });
      else if (e.key === " " && tts !== "off") { e.preventDefault(); ttsToggle(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); ttsToggle(); }
      else if (e.key === "?") setPanel((p) => (p === "keys" ? null : "keys"));
      else if (e.key === "o" || e.key === "O") toggleOutline();
      poke();
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  });

  const onScroll = () => {
    const sc = scroller.current;
    if (!sc) return;
    setProgress(sc.scrollHeight > sc.clientHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight) : 1);
    const hs = [...(article.current?.querySelectorAll<HTMLElement>("h1, h2, h3") ?? [])];
    const top = sc.getBoundingClientRect().top + 140;
    let c = 0;
    hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= top) c = i; });
    setCurHead(c);
  };
  const mins = Math.max(1, Math.round(words / WPM));
  const tb = "flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink";
  const on = "!bg-surface-2 !text-ink";
  // the outline lists headings below the note title (the H1)
  const outlineHeads = heads.filter((h, i) => !(i === 0 && h.level === 1));

  return (
    <div className={cx("fixed inset-0 z-[45] flex flex-col bg-bg fade-in", mode === "read" ? "focus-r4" : "focus-write", mode === "write" && !s.focusDim && "focus-nodim")} style={hlVars(s.hlPalette) as React.CSSProperties} onMouseMove={poke}>
      <style>{FOCUS_CSS}</style>
      {/* toolbar */}
      <div className={cx("safe-t absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3 transition-opacity duration-300", bar || panel || touch ? "opacity-100" : "pointer-events-none opacity-0")}>
        <div className="flex max-w-full flex-wrap items-center gap-0.5 rounded-[12px] border border-line bg-surface/95 p-1 shadow-lg backdrop-blur">
          <div className="flex rounded-[9px] bg-surface-2 p-0.5">
            <button className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px]", mode === "read" ? "bg-surface font-semibold text-ink shadow-sm" : "text-muted")} onClick={() => setSettings({ focusMode: "read" })}><BookOpen size={13} />Read</button>
            <button className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px]", mode === "write" ? "bg-surface font-semibold text-ink shadow-sm" : "text-muted")} onClick={() => { ttsStop(); setSettings({ focusMode: "write" }); }}><PenLine size={13} />Write</button>
          </div>
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={tb} title="Smaller text (−)" onClick={() => setSettings({ fontSize: Math.max(12, (s.fontSize ?? 16) - 1) })}><Minus size={14} /></button>
          <span className="w-9 text-center text-[12px] tabular-nums text-muted">{s.fontSize}px</span>
          <button className={tb} title="Larger text (+)" onClick={() => setSettings({ fontSize: Math.min(26, (s.fontSize ?? 16) + 1) })}><Plus size={14} /></button>
          <select title="Font" value={s.readingFont} onChange={(e) => setSettings({ readingFont: e.target.value as Settings["readingFont"] })} className="h-8 rounded-[8px] bg-transparent px-1 text-[12.5px] text-muted hover:text-ink">
            <option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option>
          </select>
          <div className="flex items-center">{THEMES.map((t) => <button key={t.t} title={`Theme: ${t.label}`} className={cx(tb, s.theme === t.t && on)} onClick={() => setSettings({ theme: t.t })}>{t.icon === "moon" ? <Moon size={13} /> : t.icon === "sun" ? <Sun size={13} /> : <span className="text-[11px] font-semibold">A</span>}<span className="hidden text-[11.5px] lg:inline">{t.label}</span></button>)}</div>
          {mode === "read" && (
            <>
              <span className="mx-1 h-5 w-px bg-line" />
              <button className={cx(tb, pen.on && !pen.eraser && on)} title="Highlighter pen: selecting text highlights it (H)" onClick={() => setPen((p) => ({ ...p, on: !p.on, eraser: false }))}><Highlighter size={14} /></button>
              {HL_COLORS.map((c, i) => <button key={c.c} title={`${c.label} (${i + 1})`} onClick={() => setPen((p) => ({ ...p, color: c.c, eraser: false }))} className={cx("mx-0.5 size-[18px] rounded-[5px]", pen.color === c.c && !pen.eraser ? "shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--text)]" : "")} style={{ background: SWATCH[c.c] }} />)}
              <button className={cx(tb, pen.eraser && on)} title="Eraser: click a highlight to remove it (E)" onClick={() => setPen((p) => ({ ...p, eraser: !p.eraser }))}><Eraser size={14} /></button>
              <button className={cx(tb, panel === "highlights" && on)} title="Highlights in this session" onClick={() => setPanel((p) => (p === "highlights" ? null : "highlights"))}><MessageSquare size={14} />{list.length > 0 && <span className="text-[11.5px] font-semibold text-ink">{list.length}</span>}</button>
              <span className="mx-1 h-5 w-px bg-line" />
              <button className={cx(tb, outline && on)} title="Outline (O)" onClick={toggleOutline}><ListTree size={14} /></button>
              <button className={cx(tb, tts !== "off" && on)} title={tts === "play" ? "Pause reading (Space)" : "Read aloud from here (R)"} onClick={ttsToggle}>{tts === "play" ? <Pause size={14} /> : tts === "pause" ? <Play size={14} /> : <Volume2 size={14} />}</button>
            </>
          )}
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={cx(tb, panel === "keys" && on)} title="Keyboard shortcuts (?)" onClick={() => setPanel((p) => (p === "keys" ? null : "keys"))}><Keyboard size={14} /></button>
          <button className={tb} title="Leave focus (Esc)" onClick={() => leave()}><X size={15} /></button>
        </div>
      </div>

      {/* body */}
      {mode === "write" ? (
        <div className="safe-t min-h-0 flex-1"><Editor key={note.id} note={note} focus /></div>
      ) : (
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div ref={article} onMouseUp={onMouseUp} className={cx("focus-read mx-auto box-content px-5 pb-[40vh] pt-[110px]", pen.on && !pen.eraser && "cursor-text", pen.eraser && "hl-erasing")} style={{ maxWidth: 640 }}>
            <Preview note={note} className="reading read-wide max-w-none" />
          </div>
        </div>
      )}

      {/* outline drawer (R4-17E) */}
      {mode === "read" && outline && (
        <div className="absolute bottom-0 left-0 top-0 z-10 box-content flex w-[260px] flex-col gap-2.5 border-r border-line bg-surface px-[18px] py-5 text-[13px]">
          <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Outline</span>
          <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            {outlineHeads.length ? outlineHeads.map((h) => (
              <button key={h.id} className={cx("truncate text-left", h.id === Math.max(curHead, outlineHeads[0]?.id ?? 0) ? "font-semibold text-ink" : "text-muted hover:text-ink")} style={{ paddingInlineStart: Math.max(0, h.level - 2) * 12 }} dir="auto"
                onClick={() => article.current?.querySelectorAll("h1, h2, h3")[h.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}>{h.text}</button>
            )) : <span className="text-muted">No headings.</span>}
          </div>
          <span className="mt-auto text-[12px] text-muted">O toggles · {list.length} highlight{list.length === 1 ? "" : "s"}</span>
        </div>
      )}

      {/* footer: progress (read) and the status line */}
      {mode === "read" && <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[3px]"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      <div className="safe-b pointer-events-none absolute bottom-6 right-6 z-10 text-[12px] text-muted md:bottom-7">
        {mode === "read" ? `${words.toLocaleString()} words · ${mins} min` : `Write · ${words.toLocaleString()} words · typewriter on · Esc`}
      </div>

      {/* read-aloud bar (R4-17E) */}
      {mode === "read" && tts !== "off" && (
        <div className="safe-b absolute bottom-7 left-1/2 z-20 flex h-12 -translate-x-1/2 items-center gap-3.5 rounded-[12px] border border-line bg-surface pl-3.5 pr-2.5">
          <button aria-label={tts === "play" ? "Pause" : "Resume"} onClick={ttsToggle} className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg">{tts === "play" ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}</button>
          <span className="whitespace-nowrap text-[12px] text-muted">Reading paragraph {ttsAt.bi + 1} of {ttsAt.n}</span>
          <span className="h-1 w-[160px] rounded-[2px] bg-surface-2"><span className="block h-full rounded-[2px] bg-ink transition-[width]" style={{ width: `${Math.round(((ttsAt.bi + ttsAt.f) / Math.max(1, ttsAt.n)) * 100)}%` }} /></span>
          <button title="Reading speed" onClick={nextSpeed} className="text-[12px] tabular-nums hover:text-accent">{s.ttsRate ?? 1}×</button>
          <button title="Stop reading (Esc)" onClick={ttsStop} className="text-[12px] text-muted hover:text-ink">Esc</button>
        </div>
      )}

      {/* highlighter bar (R4-17E): colours · Note · Card (· more) */}
      {pop && mode === "read" && (
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2" style={{ left: Math.min(innerWidth - 180, Math.max(180, pop.x)), top: Math.max(56, pop.y) }}>
          <div className="flex items-stretch gap-1 rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_12px_28px_rgba(0,0,0,.4)]" onMouseDown={(e) => e.preventDefault()}>
            {HL_COLORS.map((c) => {
              const cur = pop.kind === "mark" ? list.find((h) => h.id === pop.id)?.color === c.c : pen.color === c.c;
              return <button key={c.c} title={c.label} onClick={() => { setPen((p) => ({ ...p, color: c.c, eraser: false })); if (pop.kind === "mark") recolor(pop.id!, c.c); else add(c.c); }} className="size-6 rounded-[6px]" style={{ background: SWATCH[c.c], boxShadow: cur ? "0 0 0 2px var(--surface-2), 0 0 0 3.5px var(--text)" : "none" }} />;
            })}
            <span className="mx-1 my-0.5 w-px bg-line" />
            <button className="flex h-6 items-center rounded-[6px] px-2 hover:bg-surface" title="Add a note to this highlight (C)" onClick={() => comment(pop.kind === "mark" ? pop.id : undefined)}>Note</button>
            <button className="flex h-6 items-center rounded-[6px] px-2 hover:bg-surface" title="Make a flashcard (cloze) from it (K)" onClick={() => void makeCard(pop.kind === "mark" ? pop.id : undefined)}>Card</button>
            <button className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink" title="More" onClick={() => setPop((p) => p && { ...p, more: !p.more })}><Ellipsis size={14} /></button>
            {pop.more && <>
              <span className="mx-1 my-0.5 w-px bg-line" />
              {pop.kind === "sel" && <button className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink" title="Copy as quote with a link" onClick={() => void copyQuote()}><Copy size={13} /></button>}
              {pop.kind === "sel" && <button className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink" title="Search notes for this" onClick={searchSel}><Search size={13} /></button>}
              {pop.kind === "sel" && <button className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink" title="Read aloud from here" onClick={() => { const n = getSelection()?.anchorNode; ttsStart(n instanceof HTMLElement ? n : n?.parentElement ?? undefined); setPop(null); }}><Volume2 size={13} /></button>}
              {pop.kind === "mark" && <button className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-bad" title="Remove highlight" onClick={() => remove(pop.id!)}><Trash2 size={13} /></button>}
            </>}
          </div>
        </div>
      )}

      {/* side panels */}
      {panel && (
        <div className="absolute bottom-4 right-4 top-16 z-30 flex w-[min(340px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-xl">
          <div className="flex items-center border-b border-line px-3 py-2 text-[13px] font-semibold">
            <span className="flex-1">{panel === "keys" ? "Keyboard shortcuts" : `Highlights · ${list.length}`}</span>
            <button className="text-muted hover:text-ink" onClick={() => setPanel(null)}><X size={15} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[13px]">
            {panel === "highlights" && (list.length ? (
              <div className="flex flex-col gap-2">
                {list.map((h) => (
                  <div key={h.id} className="rounded-[8px] border border-line p-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: SWATCH[h.color] }} />
                      <button className="line-clamp-3 flex-1 text-left" onClick={() => article.current?.querySelector(`mark[data-hl="${CSS.escape(h.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{h.exact}</button>
                      <button className="text-muted hover:text-bad" title="Remove" onClick={() => remove(h.id)}><Trash2 size={13} /></button>
                    </div>
                    <button className="mt-1 flex w-full items-center gap-1 text-left text-[12px] text-muted hover:text-ink" onClick={() => comment(h.id)}>{h.comment ? <><MessageSquare size={12} className="shrink-0" />{h.comment}</> : "+ Add note"}</button>
                  </div>
                ))}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" onClick={() => void saveInto()}>Save into note</Button>
                  <Button size="sm" onClick={() => void saveAsNote()}>As highlights note</Button>
                  <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(highlightsMarkdown(list, note.title)).then(() => toast("Highlights copied as Markdown"))}>Copy</Button>
                </div>
              </div>
            ) : <div className="p-2 text-muted">Select text and pick a colour, or press H to highlight the paragraph in view.</div>)}
            {panel === "keys" && (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 p-1">
                {[["H", "Highlight selection (or the paragraph in view)"], ["1–5", "Pick colour (and highlight a selection)"], ["E", "Eraser on/off"], ["C", "Note on the selection"], ["K", "Card (cloze) from the selection"], ["O", "Outline drawer"], ["R", "Read aloud / pause"], ["+ / −", "Text size"], ["Space", "Pause / resume reading aloud"], ["?", "This list"], ["Esc", "Stop reading · close panel · leave focus"]].map(([k, d]) => (
                  <Fragment key={k}><kbd className="rounded-[5px] border border-line px-1.5 py-0.5 text-center font-mono text-[11.5px]">{k}</kbd><span className="text-muted">{d}</span></Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* leaving with highlights */}
      <Sheet open={asking} onClose={() => setAsking(false)} title={`Save ${list.length} highlight${list.length === 1 ? "" : "s"}?`}>
        <div className="flex flex-col gap-3 text-[13.5px]">
          <div className="max-h-[200px] overflow-y-auto rounded-[8px] border border-line p-2 text-[12.5px]">
            {list.map((h) => <div key={h.id} className="flex gap-2 py-1"><span className="mt-1.5 size-2 shrink-0 rounded-[2px]" style={{ background: SWATCH[h.color] }} /><span className="line-clamp-2">{h.exact}{h.comment && <span className="text-muted"> — {h.comment}</span>}</span></div>)}
          </div>
          <div className="text-muted">Save into the note as Markdown (<code>==highlight==</code>, colours and notes as footnotes), keep them in a separate note, or discard them.</div>
          <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" id="hl-remember" className="accent-[var(--accent)]" />Remember my choice (change it in Settings › Reading)</label>
          <div className="flex flex-wrap gap-2">
            {([["Save into note", "save", () => saveInto()], ["Save as highlights note", "", () => saveAsNote()], ["Discard", "discard", async () => { setList([]); saveSession(note.id, []); }]] as const).map(([label, pref, run]) => (
              <Button key={label} variant={pref === "save" ? "primary" : label === "Discard" ? "ghost" : undefined}
                onClick={async () => { if (pref && (document.getElementById("hl-remember") as HTMLInputElement)?.checked) setSettings({ highlightOnExit: pref as "save" | "discard" }); await run(); setAsking(false); onExit(); }}>{label}</Button>
            ))}
            <Button variant="ghost" onClick={() => setAsking(false)}>Keep reading</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

const sentencesOfText = (t: string) => {
  const d = document.createElement("div");
  d.textContent = t;
  return sentencesOf(d).map((x) => x.text);
};
