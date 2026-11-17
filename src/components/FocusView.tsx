import { BookOpen, Copy, Eraser, Highlighter, Keyboard, ListTree, MessageSquare, Minus, Moon, Pause, PenLine, Play, Plus, Search, Square, Sun, Trash2, Volume2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { applyToMarkdown, fromSelection, HL_COLORS, highlightsMarkdown, loadSession, reapply, saveSession, unwrap, wrapRange, type Highlight, type HlColor } from "../lib/highlights";
import { setSettings, useSettings, type Settings } from "../lib/settings";
import { openNote, setUI, toast } from "../lib/store";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { Button, cx, Sheet } from "./ui";

const SWATCH: Record<HlColor, string> = { yellow: "#facc15", green: "#4ade80", blue: "#60a5fa", pink: "#f472b6", purple: "#c084fc" };
const THEMES: { t: Settings["theme"]; label: string; icon: "sun" | "moon" | "auto" }[] = [
  { t: "auto", label: "Auto", icon: "auto" }, { t: "paper", label: "Light", icon: "sun" }, { t: "sepia", label: "Sepia", icon: "sun" }, { t: "lamplight", label: "Dark", icon: "moon" }, { t: "midnight", label: "Midnight", icon: "moon" },
];
const WPM = 230;

/**
 * Focus: a full-screen, chrome-free layer with two modes.
 *  Read  — the rendered note at a comfortable measure; highlighter (5 colours, eraser, comments), outline, read aloud,
 *          text size / width / font / theme, reading progress and time left. Highlights stay on the page until you
 *          leave; then they can be saved into the note as ==Markdown== (colours + comment footnotes), saved as a
 *          separate highlights note, copied, or discarded.
 *  Write — the editor; optional dimming of every paragraph except the one with the cursor (only while typing).
 * The toolbar fades out while reading and comes back when the mouse moves (always visible on touch).
 */
export function FocusView({ note, wide, onExit }: { note: Note; wide: boolean; onExit: () => void }) {
  const s = useSettings();
  const mode = s.focusMode ?? "read";
  const [bar, setBar] = useState(true);
  const [panel, setPanel] = useState<null | "outline" | "highlights" | "keys">(null);
  const [list, setList] = useState<Highlight[]>(() => loadSession(note.id));
  const [pen, setPen] = useState<{ on: boolean; color: HlColor; eraser: boolean }>({ on: false, color: "yellow", eraser: false });
  const [pop, setPop] = useState<null | { x: number; y: number; kind: "sel" | "mark"; id?: string }>(null);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heads, setHeads] = useState<{ id: number; text: string; level: number }[]>([]);
  const [tts, setTts] = useState<"off" | "play" | "pause">("off");
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const hideT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const words = useMemo(() => (note.body.match(/[\p{L}\p{N}]+/gu) ?? []).length, [note.body]);

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
    const text = prompt(h ? "Comment on this highlight" : "Comment (saved with the highlight)", h?.comment ?? "");
    if (text === null) return;
    if (h) setList((l) => l.map((x) => (x.id === h.id ? { ...x, comment: text } : x)));
    else add(pen.color, text);
    setPop(null);
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

  // ---------------------------------------------------------------- read aloud (Web Speech API)
  const ttsQueue = useRef<HTMLElement[]>([]);
  const speakNext = useCallback(() => {
    const el = ttsQueue.current.shift();
    document.querySelectorAll(".tts-reading").forEach((x) => x.classList.remove("tts-reading"));
    if (!el) { setTts("off"); return; }
    el.classList.add("tts-reading");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const u = new SpeechSynthesisUtterance(el.innerText);
    u.rate = Math.min(3, Math.max(0.5, s.ttsRate ?? 1));
    u.onend = () => speakNext();
    u.onerror = () => setTts("off");
    speechSynthesis.speak(u);
  }, [s.ttsRate]);
  const ttsStart = (fromEl?: HTMLElement) => {
    if (!("speechSynthesis" in window)) { toast("Read aloud isn't available in this browser"); return; }
    speechSynthesis.cancel();
    const blocks = [...(article.current?.querySelectorAll<HTMLElement>(".prose > p, .prose > h1, .prose > h2, .prose > h3, .prose > ul > li, .prose > ol > li, .prose > blockquote") ?? [])];
    const top = scroller.current?.getBoundingClientRect().top ?? 0;
    const start = fromEl ? blocks.findIndex((b) => b.contains(fromEl)) : blocks.findIndex((b) => b.getBoundingClientRect().bottom > top + 40);
    ttsQueue.current = blocks.slice(Math.max(0, start));
    setTts("play");
    speakNext();
  };
  const ttsToggle = () => {
    if (tts === "off") ttsStart();
    else if (tts === "play") { speechSynthesis.pause(); setTts("pause"); }
    else { speechSynthesis.resume(); setTts("play"); }
  };
  const ttsStop = () => { speechSynthesis.cancel(); ttsQueue.current = []; setTts("off"); document.querySelectorAll(".tts-reading").forEach((x) => x.classList.remove("tts-reading")); };
  useEffect(() => () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); }, []);

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

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // While the save dialog is open, Esc means "keep reading" (never leave without a decision).
      if (asking) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); } return; }
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor, [contenteditable=true]");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (panel || pop) { setPanel(null); setPop(null); } else leave(); return; }
      if (typing || mode !== "read" || e.ctrlKey || e.metaKey || e.altKey) return;
      const sel = selectionText();
      if (e.key === "h" || e.key === "H") { e.preventDefault(); if (sel) add(pen.color); else highlightParagraph(); }
      else if (/^[1-5]$/.test(e.key)) { const c = HL_COLORS[Number(e.key) - 1].c; setPen((p) => ({ ...p, color: c, eraser: false })); if (sel) add(c); }
      else if (e.key === "e" || e.key === "E") setPen((p) => ({ ...p, eraser: !p.eraser }));
      else if (e.key === "c" || e.key === "C") { if (sel) { e.preventDefault(); comment(); } }
      else if (e.key === "+" || e.key === "=") setSettings({ fontSize: Math.min(26, (s.fontSize ?? 16) + 1) });
      else if (e.key === "-" || e.key === "_") setSettings({ fontSize: Math.max(12, (s.fontSize ?? 16) - 1) });
      else if (e.key === " " && tts !== "off") { e.preventDefault(); ttsToggle(); }
      else if (e.key === "?") setPanel((p) => (p === "keys" ? null : "keys"));
      else if (e.key === "o" || e.key === "O") setPanel((p) => (p === "outline" ? null : "outline"));
      poke();
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  });

  const onScroll = () => {
    const sc = scroller.current;
    if (!sc) return;
    setProgress(sc.scrollHeight > sc.clientHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight) : 1);
  };
  const left = Math.max(0, Math.ceil((words * (1 - progress)) / WPM));
  const tb = "flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink";
  const on = "!bg-surface-2 !text-ink";

  return (
    <div className={cx("fixed inset-0 z-[45] flex flex-col bg-bg fade-in", mode === "write" && !s.focusDim && "focus-nodim")} onMouseMove={poke}>
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
          <select title="Line width" value={String(s.measure)} onChange={(e) => setSettings({ measure: Number(e.target.value) as Settings["measure"] })} className="h-8 rounded-[8px] bg-transparent px-1 text-[12.5px] text-muted hover:text-ink">
            <option value="60">Narrow</option><option value="68">Normal</option><option value="80">Wide</option><option value="0">Full</option>
          </select>
          <select title="Font" value={s.readingFont} onChange={(e) => setSettings({ readingFont: e.target.value as Settings["readingFont"] })} className="h-8 rounded-[8px] bg-transparent px-1 text-[12.5px] text-muted hover:text-ink">
            <option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option>
          </select>
          <div className="flex items-center">{THEMES.map((t) => <button key={t.t} title={`Theme: ${t.label}`} className={cx(tb, s.theme === t.t && on)} onClick={() => setSettings({ theme: t.t })}>{t.icon === "moon" ? <Moon size={13} /> : t.icon === "sun" ? <Sun size={13} /> : <span className="text-[11px] font-semibold">A</span>}<span className="hidden text-[11.5px] lg:inline">{t.label}</span></button>)}</div>
          {mode === "read" && (
            <>
              <span className="mx-1 h-5 w-px bg-line" />
              <button className={cx(tb, pen.on && !pen.eraser && on)} title="Highlighter pen: selecting text highlights it (H)" onClick={() => setPen((p) => ({ ...p, on: !p.on, eraser: false }))}><Highlighter size={14} /></button>
              {HL_COLORS.map((c, i) => <button key={c.c} title={`${c.label} (${i + 1})`} onClick={() => setPen((p) => ({ ...p, color: c.c, eraser: false }))} className={cx("mx-0.5 size-[18px] rounded-full border", pen.color === c.c && !pen.eraser ? "border-ink ring-2 ring-[color-mix(in_srgb,var(--text)_25%,transparent)]" : "border-transparent")} style={{ background: SWATCH[c.c] }} />)}
              <button className={cx(tb, pen.eraser && on)} title="Eraser: click a highlight to remove it (E)" onClick={() => setPen((p) => ({ ...p, eraser: !p.eraser }))}><Eraser size={14} /></button>
              <button className={cx(tb, panel === "highlights" && on)} title="Highlights in this session" onClick={() => setPanel((p) => (p === "highlights" ? null : "highlights"))}><MessageSquare size={14} />{list.length > 0 && <span className="text-[11.5px] font-semibold text-ink">{list.length}</span>}</button>
              <span className="mx-1 h-5 w-px bg-line" />
              <button className={cx(tb, panel === "outline" && on)} title="Outline (O)" onClick={() => setPanel((p) => (p === "outline" ? null : "outline"))}><ListTree size={14} /></button>
              <button className={cx(tb, tts !== "off" && on)} title={tts === "play" ? "Pause reading (Space)" : "Read aloud from here"} onClick={ttsToggle}>{tts === "play" ? <Pause size={14} /> : tts === "pause" ? <Play size={14} /> : <Volume2 size={14} />}</button>
              {tts !== "off" && (
                <>
                  <button className={tb} title="Stop reading" onClick={ttsStop}><Square size={13} /></button>
                  <select title="Reading speed" value={String(s.ttsRate ?? 1)} onChange={(e) => setSettings({ ttsRate: Number(e.target.value) })} className="h-8 rounded-[8px] bg-transparent px-1 text-[12.5px] text-muted">
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((r) => <option key={r} value={r}>{r}×</option>)}
                  </select>
                </>
              )}
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
          <div ref={article} onMouseUp={onMouseUp} className={cx("focus-read mx-auto px-5 pb-[40vh] pt-24", pen.on && !pen.eraser && "cursor-text", pen.eraser && "hl-erasing")} style={{ maxWidth: s.measure ? `calc(${s.measure}ch + 40px)` : undefined }}>
            <Preview note={note} className="reading read-wide max-w-none" />
          </div>
        </div>
      )}

      {/* footer: progress + time left (read) */}
      {mode === "read" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[3px]"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="safe-b pointer-events-none absolute bottom-3 right-4 z-10 text-[11.5px] text-muted">{Math.round(progress * 100)}% · {left ? `${left} min left` : "done"}</div>
        </>
      )}

      {/* selection / highlight popup */}
      {pop && mode === "read" && (
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2" style={{ left: Math.min(innerWidth - 160, Math.max(160, pop.x)), top: Math.max(56, pop.y) }}>
          <div className="flex items-center gap-0.5 rounded-[10px] border border-line bg-surface p-1 shadow-xl" onMouseDown={(e) => e.preventDefault()}>
            {HL_COLORS.map((c) => <button key={c.c} title={c.label} onClick={() => (pop.kind === "mark" ? recolor(pop.id!, c.c) : add(c.c))} className="mx-0.5 size-[20px] rounded-full border border-line" style={{ background: SWATCH[c.c] }} />)}
            <span className="mx-1 h-5 w-px bg-line" />
            <button className={tb} title="Comment" onClick={() => comment(pop.kind === "mark" ? pop.id : undefined)}><MessageSquare size={14} /></button>
            {pop.kind === "sel" && <button className={tb} title="Copy as quote with a link" onClick={() => void copyQuote()}><Copy size={14} /></button>}
            {pop.kind === "sel" && <button className={tb} title="Search notes for this" onClick={searchSel}><Search size={14} /></button>}
            {pop.kind === "sel" && <button className={tb} title="Read aloud from here" onClick={() => { const n = getSelection()?.anchorNode; ttsStart(n instanceof HTMLElement ? n : n?.parentElement ?? undefined); setPop(null); }}><Volume2 size={14} /></button>}
            {pop.kind === "mark" && <button className={tb} title="Remove highlight" onClick={() => remove(pop.id!)}><Trash2 size={14} /></button>}
          </div>
        </div>
      )}

      {/* side panels */}
      {panel && (
        <div className="absolute bottom-4 right-4 top-16 z-30 flex w-[min(340px,calc(100vw-32px))] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-xl">
          <div className="flex items-center border-b border-line px-3 py-2 text-[13px] font-semibold">
            <span className="flex-1">{panel === "outline" ? "Outline" : panel === "keys" ? "Keyboard shortcuts" : `Highlights · ${list.length}`}</span>
            <button className="text-muted hover:text-ink" onClick={() => setPanel(null)}><X size={15} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[13px]">
            {panel === "outline" && (heads.length ? heads.map((h) => (
              <button key={h.id} className="block w-full truncate rounded-[6px] px-2 py-1.5 text-left hover:bg-surface-2" style={{ paddingInlineStart: 8 + (h.level - 1) * 14 }}
                onClick={() => article.current?.querySelectorAll("h1, h2, h3")[h.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}>{h.text}</button>
            )) : <div className="p-2 text-muted">No headings.</div>)}
            {panel === "highlights" && (list.length ? (
              <div className="flex flex-col gap-2">
                {list.map((h) => (
                  <div key={h.id} className="rounded-[8px] border border-line p-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: SWATCH[h.color] }} />
                      <button className="line-clamp-3 flex-1 text-left" onClick={() => article.current?.querySelector(`mark[data-hl="${CSS.escape(h.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{h.exact}</button>
                      <button className="text-muted hover:text-bad" title="Remove" onClick={() => remove(h.id)}><Trash2 size={13} /></button>
                    </div>
                    <button className="mt-1 w-full text-left text-[12px] text-muted hover:text-ink" onClick={() => comment(h.id)}>{h.comment ? `💬 ${h.comment}` : "+ Add comment"}</button>
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
                {[["H", "Highlight selection (or the paragraph in view)"], ["1–5", "Pick colour (and highlight a selection)"], ["E", "Eraser on/off"], ["C", "Comment on selection"], ["O", "Outline"], ["+ / −", "Text size"], ["Space", "Pause / resume reading aloud"], ["?", "This list"], ["Esc", "Close panel / leave focus"]].map(([k, d]) => (
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
            {list.map((h) => <div key={h.id} className="flex gap-2 py-1"><span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: SWATCH[h.color] }} /><span className="line-clamp-2">{h.exact}{h.comment && <span className="text-muted"> — {h.comment}</span>}</span></div>)}
          </div>
          <div className="text-muted">Save into the note as Markdown (<code>==highlight==</code>, colours and comments as footnotes), keep them in a separate note, or discard them.</div>
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
