// Ask your notes as a multi-turn chat (design round 5 §1 pending: plain round-4 styling, restyle-ready).
// Desktop: page with the thread list on the left (palette → "Ask your notes…"). Phone: bottom sheet, threads in a sheet.
// Right panel AI tab: the same conversation, compact. Tutor threads render TutorSession. Logic: lib/ask.ts + lib/chat.ts.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChatMessage, ChatThread, Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import {
  aiReady, closeAsk, deleteThread, getAsk, getPendingTutor, newChat, openThread, pinThread, regenerate, renameThread, scopeLabel, sendChat, setAsk, setFeedback, stopChat, useAsk,
  type Live, type Scope,
} from "../lib/ask";
import { answerMarkdown, CHAT_STR, citedIn, MODE_LABEL, starterQuestions, threadMarkdown, WINDOW_TURNS } from "../lib/chat";
import { db, DEMO } from "../lib/db";
import { parsePath } from "../lib/path";
import { openNote, setUI, toast, useUI, useVault, type Vault } from "../lib/store";
import { TUTOR_STR } from "../lib/tutor";
import { actBtn, ChatIcon, isAr, RichAnswer, SourceCard } from "./ChatParts";
import { Glyph } from "./Glyph";
import { ConceptPicker, TutorSession } from "./TutorSession";
import { cx, relTime } from "./ui";

type Layout = "page" | "sheet" | "panel";
const MODE_GLYPH: Record<ChatThread["mode"], string> = { ask: "query", explain: "lesson", socratic: "c-question", feynman: "voice" };

/** Active thread (stored, or the pending tutor thread not saved yet). */
export function useThread(id: string | null): ChatThread | undefined {
  const stored = useLiveQuery(() => (id ? db.chats.get(id) : undefined), [id]);
  const pending = getPendingTutor();
  if (stored && !stored.deleted) return stored;
  return pending && pending.id === id ? pending : undefined;
}
export function useThreads(): ChatThread[] {
  return useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().filter((t) => !t.deleted).toArray(), []) ?? [];
}

// ------------------------------------------------------------------ scope chip
function ScopeChip({ scope, setScope, note, v, spaceId }: { scope: Scope; setScope: (s: Scope) => void; note?: Note; v: Vault; spaceId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const paths = v.notes.filter((n) => n.type === "path" && !n.deleted);
  const space = v.spaceMap.get(spaceId);
  const opts: { s: Scope; label: string; glyph: string }[] = [
    { s: { kind: "vault" }, label: "Whole vault", glyph: "query" },
    ...(space ? [{ s: { kind: "space" as const, spaceId }, label: space.name, glyph: "folder" }] : []),
    ...(note ? [{ s: { kind: "note" as const, noteId: note.id }, label: `${note.title} + links`, glyph: note.type || "note" }] : []),
    ...paths.map((p) => ({ s: { kind: "path" as const, pathId: p.id }, label: p.title, glyph: "path" })),
  ];
  const same = (a: Scope, b: Scope) => a.kind === b.kind && (a.spaceId ?? "") === (b.spaceId ?? "") && (a.noteId ?? "") === (b.noteId ?? "") && (a.pathId ?? "") === (b.pathId ?? "");
  const cur = opts.find((o) => same(o.s, scope)) ?? { s: scope, label: scopeLabel(scope, v), glyph: "query" };
  return (
    <div ref={ref} className="relative shrink-0">
      <button aria-haspopup="listbox" aria-expanded={open} aria-label={`Search in: ${cur.label}`} onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-[180px] items-center gap-1.5 rounded-[7px] bg-surface-2 px-2.5 text-[12px] hover:text-ink">
        <Glyph name={cur.glyph} size={13} /><span dir="auto" className="truncate">{cur.label}</span><Glyph name="chevron-down" size={12} />
      </button>
      {open && (
        <div role="listbox" aria-label="Search in" className="absolute bottom-[calc(100%+4px)] left-0 z-40 flex max-h-[300px] w-[240px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
          {opts.map((o) => (
            <button key={o.label + o.s.kind} role="option" aria-selected={o === cur} onClick={() => { setScope(o.s); setOpen(false); }}
              className={cx("flex h-11 items-center gap-2 rounded-[6px] px-2 text-left sm:h-8", o === cur ? "bg-bg" : "hover:bg-bg")}>
              <Glyph name={o.glyph} size={13} color="var(--muted)" /><span dir="auto" className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Open the search palette with the question typed in ("Search instead"). */
function searchInstead(q: string) {
  closeAsk();
  setUI({ palette: true });
  setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>('[role="dialog"] input, [cmdk-input], input[aria-label*="earch"]');
    if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, q);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, 60);
}

/** Ask ↔ Tutor switch in the composer. */
export function ModeSwitch({ tutor }: { tutor: boolean }) {
  const seg = (on: boolean) => cx("h-7 rounded-[6px] px-2.5 text-[12px]", on ? "bg-bg font-semibold text-ink" : "text-muted hover:text-ink");
  return (
    <div role="radiogroup" aria-label="Mode" className="flex shrink-0 gap-0.5 rounded-[8px] bg-surface-2 p-0.5">
      <button role="radio" aria-checked={!tutor} className={seg(!tutor)} onClick={() => (tutor || getAsk().picking) && newChat()}>{CHAT_STR.modeAsk}</button>
      <button role="radio" aria-checked={tutor} className={seg(tutor)} onClick={() => !tutor && setAsk({ picking: true })}>{CHAT_STR.modeTutor}</button>
    </div>
  );
}

// ------------------------------------------------------------------ one assistant message
function AssistantMessage({ m, thread, last, v, note, layout, onOpen }: { m: ChatMessage; thread: ChatThread; last: boolean; v: Vault; note?: Note; layout: Layout; onOpen: (id: string) => void }) {
  const [showSrc, setShowSrc] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const page = layout === "page";
  const question = useMemo(() => { const i = thread.messages.indexOf(m); return [...thread.messages.slice(0, i)].reverse().find((x) => x.role === "user")?.text ?? ""; }, [thread.messages, m]);
  const cited = citedIn(m.text);
  const srcs = m.sources ?? [];
  const targetSpace = note?.spaceId ?? "inbox";

  const copy = async () => { try { await navigator.clipboard.writeText(answerMarkdown(m)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast("Couldn't copy"); } };
  const saveNote = async () => {
    const title = question.replace(/[#[\]|]/g, "").slice(0, 90) || thread.title;
    const n = await createNote({ title, spaceId: targetSpace, body: `# ${title}\n\n${answerMarkdown(m)}` });
    toast(CHAT_STR.savedNote, { label: "Open", run: () => openNote(n.id) });
  };
  const makeCards = async () => {
    setBusy(true);
    try {
      const plain = m.text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\*\*[^*]+\*\*/g, "");
      let out = "";
      if (DEMO && !getToken()) out = plain.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^[-*\s]+/, "").trim()).filter((s) => s.length > 12).slice(0, 4).map((s, i) => `${question.replace(/[?؟]$/, "")} (${i + 1})? :: ${s.replace(/[*_]/g, "")}`).join("\n");
      else out = (await aiRun("flashcards", `${question}\n\n${plain}`)).trim();
      const cards = out.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim()).filter((l) => / :: /.test(l));
      if (!cards.length) { toast("The AI didn't return any cards."); return; }
      const title = `${question.replace(/[#[\]|]/g, "").slice(0, 80) || thread.title} · cards`;
      const from = srcs.filter((s) => cited.has(s.n)).map((s) => `[[${s.title.replace(/[[\]|#]/g, " ")}]]`).filter((x, i, a) => a.indexOf(x) === i);
      const n = await createNote({ title, spaceId: targetSpace, type: "flashcards", body: `# ${title}\n\n${cards.join("\n")}\n${from.length ? `\nFrom ${from.join(", ")}\n` : ""}` });
      toast(`${cards.length} flashcard${cards.length === 1 ? "" : "s"} made (they show in Review)`, { label: "Open", run: () => openNote(n.id) });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const insertIntoNote = async () => {
    if (!note) return;
    const n = await db.notes.get(note.id);
    if (!n) return;
    await updateNote(n.id, { body: `${n.body.replace(/\s*$/, "")}\n\n> [!question] ${question.replace(/\n/g, " ")}\n\n${answerMarkdown(m)}` });
    toast(`Added to ${n.title}`);
  };

  if (m.empty === "none") return (
    <div className="flex flex-col items-start gap-2" role="status" data-msg="empty">
      {m.rewrite && <span className="text-[12px] text-muted" dir="auto" data-rewrite>{CHAT_STR.searchedFor} {m.rewrite}</span>}
      <span className="font-semibold">{isAr(question) ? CHAT_STR.notInNotesAr : CHAT_STR.notInNotes}</span>
      <span className="text-muted">{CHAT_STR.notInNotesSub}</span>
      {srcs.length > 0 && <div className="flex w-full flex-col gap-1.5">{srcs.slice(0, 3).map((s) => <SourceCard key={s.n} s={s} row v={v} onOpen={onOpen} />)}</div>}
      <div className="flex flex-wrap gap-2">
        {last && <button onClick={() => void regenerate(thread.id, v, true)} className="flex h-8 items-center rounded-[8px] border border-line px-3 hover:bg-surface-2" data-act="general">{CHAT_STR.answerGeneral}</button>}
        <button onClick={() => searchInstead(question)} className="flex h-8 items-center px-1 text-link hover:underline">Search instead</button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2" data-msg="assistant">
      {m.rewrite && <span className="text-[12px] text-muted" dir="auto" data-rewrite>{CHAT_STR.searchedFor} {m.rewrite}</span>}
      {m.general && <span className="self-start rounded-[6px] border border-line px-2 py-0.5 text-[11.5px] text-muted" data-general>{CHAT_STR.generalLabel}</span>}
      <RichAnswer text={m.text} sources={srcs} size={page ? 16.5 : 15} onOpen={onOpen} onHover={setHot} />
      {srcs.length > 0 && (
        <div className="flex flex-col gap-2">
          <button onClick={() => setShowSrc((s) => !s)} aria-expanded={showSrc} className="flex items-center gap-1 self-start text-[12px] text-muted hover:text-ink">
            <Glyph name={showSrc ? "chevron-down" : "chevron-right"} size={12} />{CHAT_STR.sources(cited.size || srcs.length)}
          </button>
          {showSrc && (
            <div className={cx(page ? "grid grid-cols-3 gap-2" : "flex flex-col gap-1.5")} aria-label="Sources">
              {srcs.map((s) => <SourceCard key={s.n} s={s} v={v} row={!page} hot={hot === s.n} dim={cited.size > 0 && !cited.has(s.n)} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      )}
      <div className="-ms-2 flex flex-wrap items-center gap-0.5" aria-label="Answer actions">
        <button className={actBtn} onClick={copy} title="Copy with citations"><ChatIcon name="copy" size={14} />{copied ? CHAT_STR.copied : CHAT_STR.copy}</button>
        <button className={actBtn} onClick={saveNote}><Glyph name="note" size={14} />{CHAT_STR.saveNote}</button>
        <button className={actBtn} onClick={makeCards} disabled={busy}><Glyph name="flashcards" size={14} />{busy ? CHAT_STR.makingCards : CHAT_STR.makeCards}</button>
        {note && layout === "panel" && <button className={actBtn} onClick={insertIntoNote}>Insert</button>}
        {last && <button className={actBtn} onClick={() => void regenerate(thread.id, v, !!m.general)}><Glyph name="s-revise" size={14} />{CHAT_STR.regenerate}</button>}
        <span className="flex-1" />
        <button className={cx(actBtn, m.feedback === 1 && "text-ink")} aria-pressed={m.feedback === 1} aria-label={CHAT_STR.helpful} title={CHAT_STR.helpful} onClick={() => void setFeedback(thread.id, m.id, m.feedback === 1 ? undefined : 1)}><ChatIcon name="up" size={14} filled={m.feedback === 1} /></button>
        <button className={cx(actBtn, m.feedback === -1 && "text-ink")} aria-pressed={m.feedback === -1} aria-label={CHAT_STR.notHelpful} title={CHAT_STR.notHelpful} onClick={() => void setFeedback(thread.id, m.id, m.feedback === -1 ? undefined : -1)}><ChatIcon name="down" size={14} filled={m.feedback === -1} /></button>
      </div>
      {last && m.followups && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={CHAT_STR.followups}>
          {m.followups.map((f) => <button key={f} dir="auto" onClick={() => void sendChat(f, v)} className="rounded-[999px] border border-line px-3 py-1 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink" data-followup>{f}</button>)}
        </div>
      )}
    </div>
  );
}

/** The answer in progress (indexing → rewriting → streaming), or the offline / signed-out / error state. */
function LiveAnswer({ live, v, layout, scope, onOpen }: { live: Live; v: Vault; layout: Layout; scope: Scope; onOpen: (id: string) => void }) {
  const name = scopeLabel(scope, v);
  const rows = live.sources.slice(0, 4).map((s) => <SourceCard key={s.id} s={s} row v={v} onOpen={onOpen} />);
  return (
    <div className="flex flex-col gap-2" aria-live="polite" data-msg="live">
      {live.rewrite && <span className="text-[12px] text-muted" dir="auto" data-rewrite>{CHAT_STR.searchedFor} {live.rewrite}</span>}
      {live.status === "indexing" && (
        <div className="flex flex-col gap-2" role="status">
          <span className="font-semibold" dir="auto">{CHAT_STR.readingNotes(live.total ?? 0, name)}</span>
          <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-ink transition-[width]" style={{ width: `${live.total ? Math.round(((live.read ?? 0) / live.total) * 100) : 0}%` }} /></span>
        </div>
      )}
      {live.status === "rewriting" && <span className="text-muted">Understanding the follow-up…</span>}
      {live.status === "asking" && <span className="text-muted">{live.general ? "Answering from general knowledge…" : CHAT_STR.answering(live.sources.length, name)}</span>}
      {live.general && live.text && <span className="self-start rounded-[6px] border border-line px-2 py-0.5 text-[11.5px] text-muted">{CHAT_STR.generalLabel}</span>}
      {live.text && <RichAnswer text={live.text} sources={live.sources} streaming={live.status === "streaming"} size={layout === "page" ? 16.5 : 15} onOpen={onOpen} />}
      {live.status === "offline" && <><span className="font-semibold">{CHAT_STR.offline}</span><span className="text-muted">{CHAT_STR.offlineSub}</span>{rows}</>}
      {live.status === "signedout" && <><span className="text-muted">{CHAT_STR.signedOut} Meanwhile, here are the most relevant passages from your notes.</span>{rows}</>}
      {live.status === "error" && (
        <div className="flex items-center gap-3"><span dir="auto" className="text-bad">{live.error}</span>
          <button onClick={() => void regenerate(live.threadId, v, !!live.general)} className="h-8 rounded-[8px] border border-line px-3 hover:bg-surface-2">{CHAT_STR.errorRetry}</button></div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the conversation column
export function AskVault({ note, autoFocus, onOpened, layout = "panel" }: { note?: Note; autoFocus?: boolean; onOpened?: () => void; layout?: Layout }) {
  const st = useAsk();
  const v = useVault();
  const ui = useUI();
  const thread = useThread(st.activeId);
  const spaceId = note?.spaceId ?? (ui.spaceId === "all" ? "" : ui.spaceId);
  const scope: Scope = (thread?.mode === "ask" ? (thread.scope as Scope) : null) ?? st.scope ?? { kind: "vault" };
  const setScope = (s: Scope) => { setAsk({ scope: s }); if (thread?.mode === "ask" && thread.messages.length) newChat(); };
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const live = st.live && (!thread || st.live.threadId === thread.id) ? st.live : null;
  const busy = !!live && ["indexing", "rewriting", "asking", "streaming"].includes(live.status);
  const page = layout === "page";
  const fill = layout !== "panel"; // page + phone sheet: messages scroll, composer stays at the bottom
  const open = (id: string) => { openNote(id); onOpened?.(); };

  useEffect(() => { if (autoFocus) setTimeout(() => input.current?.focus(), 30); }, [autoFocus, st.activeId]);
  // A question handed over from the palette ("Ask your notes: …") runs once, in a new chat.
  useEffect(() => {
    try {
      const q = sessionStorage.getItem("lumen.askAuto");
      if (q && v.ready) { sessionStorage.removeItem("lumen.askAuto"); newChat(); void sendChat(q, v, { scope }); }
    } catch { /* ignore */ }
  }, [v.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the newest content in view
  const msgCount = thread?.messages.length ?? 0;
  useEffect(() => { const el = fill ? scroller.current : null; if (el) el.scrollTop = el.scrollHeight; }, [msgCount, live?.text, live?.status, fill]);

  const starters = useMemo(() => {
    const cur = note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined);
    const headings = cur ? [...cur.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()) : [];
    const p = scope.kind === "path" && scope.pathId ? v.byId.get(scope.pathId) : undefined;
    const concepts = p ? parsePath(p.body).stages.flatMap((s) => s.concepts.map((c) => c.name)).slice(0, 3) : [];
    return starterQuestions({ noteTitle: cur && cur.type !== "path" ? cur.title : undefined, headings, concepts });
  }, [note, ui.noteId, v.byId, scope.kind, scope.pathId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (st.picking) return <ConceptPicker note={note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined)} layout={layout} />;
  if (thread && thread.mode !== "ask") return <TutorSession thread={thread} layout={layout} onOpened={onOpened} />;

  const submit = (q = st.draft) => { if (q.trim() && !busy) void sendChat(q, v, { scope }); };
  const msgs = thread?.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const lastSrc = lastAssistant?.sources?.length ?? 0;
  const turns = msgs.filter((m) => m.role === "user").length;

  const composer = (
    <div className={cx("flex shrink-0 flex-col gap-1.5", fill && "pb-3 pt-2", page && "pb-4")}>
      {thread && turns > 1 && (
        <span className="flex flex-wrap gap-x-3 text-[11.5px] text-muted" data-context>
          <span>{CHAT_STR.contextLine(Math.min(turns - 1, WINDOW_TURNS), live?.sources.length || lastSrc)}</span>
          {thread.summary && <span>{CHAT_STR.summarizedLine}</span>}
        </span>
      )}
      <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-accent">
        <textarea ref={input} dir="auto" rows={page ? 2 : 1} value={st.draft} onChange={(e) => setAsk({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === "Escape" && busy) { e.stopPropagation(); stopChat(); }
          }}
          placeholder={msgs.length ? CHAT_STR.placeholderFollow : CHAT_STR.placeholder} aria-label="Message"
          className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-[14.5px] leading-[22px] text-ink !outline-none placeholder:text-muted"
          style={{ fieldSizing: "content" } as CSSProperties} />
        <div className="flex items-center gap-2">
          <ScopeChip scope={scope} setScope={setScope} note={note} v={v} spaceId={spaceId || ""} />
          <ModeSwitch tutor={false} />
          <span className="flex-1" />
          {busy
            ? <button aria-label={CHAT_STR.stop} onClick={stopChat} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] hover:bg-surface-2"><ChatIcon name="stop" size={13} />{CHAT_STR.stop}</button>
            : <button aria-label={CHAT_STR.send} onClick={() => submit()} disabled={!st.draft.trim()} className="flex size-8 items-center justify-center rounded-[8px] bg-accent text-accent-fg disabled:opacity-40"><ChatIcon name="send" size={16} /></button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className={cx("flex min-h-0 flex-col text-[13px]", fill ? "h-full w-full max-w-[760px]" : "gap-3")}>
      <div ref={scroller} className={cx("flex flex-col gap-5", fill && "min-h-0 flex-1 overflow-y-auto pb-4", page && "pt-8")}>
        {!msgs.length && !live && (
          <div className="flex flex-col gap-1.5" data-empty>
            {page && <span className="pb-2 text-[22px] font-[650] tracking-[-.01em]">Ask your notes</span>}
            <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{CHAT_STR.starters}</span>
            {starters.map((q) => (
              <button key={q} dir="auto" onClick={() => submit(q)} className="rounded-[8px] px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-ink" data-starter>{q}</button>
            ))}
            <span className="pt-2 text-[12px] leading-[18px] text-muted">{aiReady() ? CHAT_STR.privacy : `${CHAT_STR.signedOut} Passages are still found on this device.`}</span>
          </div>
        )}
        {thread && msgs.map((m) => m.role === "user"
          ? <div key={m.id} dir="auto" data-msg="user" className="max-w-[85%] self-end whitespace-pre-wrap rounded-[14px] bg-surface-2 px-3.5 py-2 text-[14px] leading-[21px]">{m.text}</div>
          : <AssistantMessage key={m.id} m={m} thread={thread} last={m === lastMsg && !live} v={v} note={note} layout={layout} onOpen={open} />)}
        {live && !thread && <div dir="auto" className="max-w-[85%] self-end rounded-[14px] bg-surface-2 px-3.5 py-2 text-[14px]">{live.question}</div>}
        {live && <LiveAnswer live={live} v={v} layout={layout} scope={scope} onOpen={open} />}
      </div>
      {composer}
    </div>
  );
}

// ------------------------------------------------------------------ thread list
function ThreadRow({ t, active, v }: { t: ChatThread; active: boolean; v: Vault }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const sub = t.mode === "ask" ? scopeLabel(t.scope as Scope, v) : `${TUTOR_STR.tutor} · ${MODE_LABEL[t.mode]}`;
  if (renaming) return (
    <input autoFocus dir="auto" defaultValue={t.title} aria-label={CHAT_STR.rename} className="h-9 rounded-[7px] border border-accent bg-bg px-2 text-[13px] outline-none"
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
      onBlur={(e) => { void renameThread(t.id, e.target.value); setRenaming(false); }} />
  );
  if (confirm) return (
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-surface p-2 text-[12.5px]" role="alertdialog">
      <span>{CHAT_STR.deleteConfirm}</span>
      <div className="flex gap-1.5"><button className="h-7 rounded-[6px] bg-bad px-2.5 font-semibold text-white" onClick={() => void deleteThread(t.id)}>{CHAT_STR.delete}</button><button className="h-7 rounded-[6px] px-2.5 hover:bg-surface-2" onClick={() => setConfirm(false)}>Cancel</button></div>
    </div>
  );
  return (
    <div className={cx("group relative flex items-center rounded-[7px]", active ? "bg-surface-2" : "hover:bg-surface-2")} data-thread={t.id}>
      <button onClick={() => openThread(t.id)} className="flex min-w-0 flex-1 items-start gap-2 p-2 text-left">
        <Glyph name={MODE_GLYPH[t.mode]} size={14} color="var(--muted)" style={{ marginTop: 2 }} />
        <span className="flex min-w-0 flex-col">
          <span dir="auto" className="truncate">{t.title}</span>
          <span className="truncate text-[11.5px] text-muted">{sub} · {relTime(t.updatedAt)}</span>
        </span>
      </button>
      <button aria-label="Thread actions" aria-haspopup="menu" onClick={() => setMenu((m) => !m)} className={cx("me-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted hover:text-ink", !menu && "opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100")}><Glyph name="more" size={15} /></button>
      {menu && (
        <div role="menu" className="absolute right-1 top-[calc(100%-2px)] z-30 flex w-[150px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" onMouseLeave={() => setMenu(false)}>
          <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 hover:bg-bg" onClick={() => { setMenu(false); setRenaming(true); }}><ChatIcon name="edit" size={13} />{CHAT_STR.rename}</button>
          <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 hover:bg-bg" onClick={() => { setMenu(false); void pinThread(t.id, !t.pinned); }}><ChatIcon name="pin" size={13} />{t.pinned ? CHAT_STR.unpin : CHAT_STR.pin}</button>
          <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 hover:bg-bg" onClick={() => { setMenu(false); void navigator.clipboard?.writeText(threadMarkdown(t)).then(() => toast("Conversation copied")); }}><ChatIcon name="copy" size={13} />{CHAT_STR.copy}</button>
          <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 text-bad hover:bg-bg" onClick={() => { setMenu(false); setConfirm(true); }}><Glyph name="x" size={13} />{CHAT_STR.delete}</button>
        </div>
      )}
    </div>
  );
}
export function ThreadList({ activeId }: { activeId: string | null }) {
  const threads = useThreads();
  const v = useVault();
  const pinned = threads.filter((t) => t.pinned);
  const rest = threads.filter((t) => !t.pinned);
  const head = "px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[.06em] text-muted";
  return (
    <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-label={CHAT_STR.threads}>
      {!threads.length && <span className="px-2 py-2 text-muted">{CHAT_STR.noThreads}</span>}
      {pinned.length > 0 && <span className={head}>{CHAT_STR.pinned}</span>}
      {pinned.map((t) => <ThreadRow key={t.id} t={t} active={t.id === activeId} v={v} />)}
      {rest.length > 0 && <span className={head}>{CHAT_STR.recent}</span>}
      {rest.map((t) => <ThreadRow key={t.id} t={t} active={t.id === activeId} v={v} />)}
    </div>
  );
}

/** Full Ask (palette → "Ask your notes…"): a page beside the sidebar on desktop, a bottom sheet on phone. */
export function AskSheet() {
  const st = useAsk();
  const ui = useUI();
  const v = useVault();
  const note = ui.view === "notes" && ui.noteId ? v.byId.get(ui.noteId) : undefined;
  const [left, setLeft] = useState(0);
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const thread = useThread(st.activeId);
  useEffect(() => {
    if (!st.open) return;
    const r = document.querySelector("aside")?.getBoundingClientRect();
    setLeft(r && r.left < 4 && r.width < 400 ? Math.round(r.right) : 0);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) { if (getAsk().list) setAsk({ list: false }); else closeAsk(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [st.open]);
  if (!st.open) return null;
  const newBtn = <button onClick={newChat} className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-line px-3 hover:bg-surface-2"><Glyph name="plus" size={14} />{CHAT_STR.newChat}</button>;
  if (phone) return (
    <div className="fixed inset-0 z-50 bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && closeAsk()}>
      <div role="dialog" aria-label="Ask" className="absolute inset-x-0 bottom-0 flex h-[calc(100%-56px)] flex-col gap-2 rounded-t-[14px] bg-surface px-4 pt-2.5 text-[13px]">
        <button aria-label="Close" onClick={closeAsk} className="flex justify-center py-1"><span className="h-1 w-9 rounded-[2px] bg-line" /></button>
        <div className="flex items-center gap-2">
          <button aria-label={CHAT_STR.threads} onClick={() => setAsk({ list: true })} className="flex size-9 items-center justify-center rounded-[8px] border border-line"><ChatIcon name="list" size={16} /></button>
          <span dir="auto" className="min-w-0 flex-1 truncate text-[16px] font-[650]">{thread?.title ?? "Ask"}</span>
          <button aria-label={CHAT_STR.newChat} onClick={newChat} className="flex size-9 items-center justify-center rounded-[8px] border border-line"><Glyph name="plus" size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col"><AskVault note={note} autoFocus onOpened={closeAsk} layout="sheet" /></div>
        {st.list && (
          <div className="absolute inset-0 z-10 flex flex-col gap-2 rounded-t-[14px] bg-surface px-4 pt-4" role="dialog" aria-label={CHAT_STR.threads}>
            <div className="flex items-center gap-2"><span className="flex-1 text-[16px] font-[650]">{CHAT_STR.threads}</span>{newBtn}<button aria-label={CHAT_STR.close} onClick={() => setAsk({ list: false })} className="flex size-9 items-center justify-center"><Glyph name="x" size={16} /></button></div>
            <ThreadList activeId={st.activeId} />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div role="dialog" aria-label="Ask" className="fixed inset-y-0 right-0 z-50 flex bg-bg text-[13px] fade-in" style={{ left }}>
      <div className="flex w-[260px] shrink-0 flex-col gap-1 border-e border-line px-3 py-4">
        <div className="flex items-center px-1.5 pb-2.5">
          <span className="flex-1 text-[15px] font-[650]">Ask</span>
          <button aria-label="Close Ask" onClick={closeAsk} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={15} /></button>
        </div>
        {newBtn}
        <ThreadList activeId={st.activeId} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center px-10">
        <AskVault note={note} autoFocus onOpened={closeAsk} layout="page" />
      </div>
    </div>
  );
}
