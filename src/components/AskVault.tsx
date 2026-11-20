// Ask your notes as a multi-turn chat. Round 8 (Lumen 56 Ask enhanced, AskStudio): Ask takes the sidebar's place
// (rail + chat list + conversation + sources panel), suggestions from real activity, the waiting made visible
// (steps, streamed text, Stop, a "still working" state), answer actions (save / append / flashcards) and a scope menu.
// Phone: full screen, chats in a sheet. Tutor threads render TutorSession full width. Logic: lib/ask.ts (store,
// network, streaming + cancel) + lib/chat.ts (pure); pieces in components/ask/*. The note Assistant (right panel)
// lives in Assistant.tsx and shares the engine.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { ChatMessage, ChatThread, Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import {
  closeAsk, deleteThread, getAsk, getPendingTutor, newChat, openThread, pinThread, regenerate, renameThread, scopeLabel, scopeNotes, sendChat, setAsk, setFeedback, stopChat, useAsk,
  type Live, type Scope,
} from "../lib/ask";
import { answerMarkdown, citedIn, starterQuestions, threadMarkdown, WINDOW_TURNS } from "../lib/chat";
import { db } from "../lib/db";
import { isRtl, t, useLang } from "../lib/i18n";
import { parsePath } from "../lib/path";
import { openNote, setUI, toast, useUI, useVault, type Vault } from "../lib/store";
import { ChatIcon, RichAnswer, SourceCard, useAiLocked, useOnline } from "./ChatParts";
import { Glyph } from "./Glyph";
import { openSettings } from "./ShareSheet";
import { ConceptPicker, TutorSession } from "./TutorSession";
import { appendAnswerToNote, makeCards, questionOf, saveAnswerAsNote, shareThread, useSaved } from "./ask/actions";
import { DoneLine, LiveSteps, providerLabel, Rail, SavedBanner, SourcesPanel } from "./ask/Parts";
import { ScopeMenu } from "./ask/ScopeMenu";
import { useSuggestions, type Pin } from "./ask/suggestions";
import { cx } from "./ui";

type Layout = "page" | "sheet" | "panel";
const AC = "color-mix(in srgb,var(--accent) 16%,transparent)";

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
export const usePhone = () => {
  const q = "(max-width: 767px)";
  const [p, setP] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setP(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return p;
};

/** Open the search palette with the question typed in ("Search instead" / "Show closest notes"). */
export function searchInstead(q: string) {
  closeAsk();
  setUI({ palette: true });
  setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>('[role="dialog"] input, [cmdk-input], input[aria-label*="earch"]');
    if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, q);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, 60);
}

/** "Tutor mode" switch (R5-23): on → concept picker, off → back to Ask. Used inside tutor sessions. */
export function TutorToggle({ on }: { on: boolean }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => (on ? newChat() : setAsk({ picking: true }))} data-act="tutor-mode"
      className="flex h-7 shrink-0 items-center gap-2 rounded-full border border-line px-2.5 text-[12.5px] hover:bg-surface-2">
      {t("Tutor mode")}
      <span className="relative h-[15px] w-[26px] rounded-[8px]" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
        <span className="absolute top-[2px] size-[11px] rounded-full" style={{ insetInlineStart: on ? 13 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
      </span>
    </button>
  );
}

const outlineBtn = "flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";

// ------------------------------------------------------------------ append-to-note picker
function AppendPicker({ onPick, onClose }: { onPick: (n: Note) => void; onClose: () => void }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return v.notes.filter((n) => !n.deleted && ["note", "lesson", "journal", "moc", "post"].includes(n.type) && (!k || n.title.toLowerCase().includes(k))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  }, [v.notes, q]);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="dialog" aria-label={t("Append to note…")} className="absolute start-0 top-[calc(100%+4px)] z-40 flex max-h-[320px] w-[300px] max-w-[88vw] flex-col gap-1 rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-[0_16px_40px_rgb(0_0_0/.35)]" data-append-picker>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={t("Find a note")} aria-label={t("Find a note")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
          className="h-8 rounded-[7px] border border-line bg-bg px-2.5 text-[12.5px] outline-none focus:border-accent" />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!list.length && <span className="px-2.5 py-3 text-[12.5px] text-muted">{t("No notes match.")}</span>}
          {list.map((n) => (
            <button key={n.id} onClick={() => onPick(n)} className="flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-start text-[13px] hover:bg-bg">
              <Glyph name={n.type || "note"} size={14} color="var(--muted)" /><span dir="auto" className="flex-1 truncate">{n.title}</span><span className="max-w-[90px] truncate text-[11px] text-muted">{v.spaceMap.get(n.spaceId)?.name}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ one assistant message
function AssistantMessage({ m, thread, last, v, note, layout, phone, onOpen, onHot, hot }: { m: ChatMessage; thread: ChatThread; last: boolean; v: Vault; note?: Note; layout: Layout; phone: boolean; onOpen: (id: string) => void; onHot: (n: number | null) => void; hot: number | null }) {
  const [showSrc, setShowSrc] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [closest, setClosest] = useState(false);
  const saved = useSaved()[m.id];
  const question = questionOf(thread, m);
  const cited = citedIn(m.text);
  const srcs = m.sources ?? [];
  const shown = cited.size ? srcs.filter((s) => cited.has(s.n)) : srcs;
  const panel = layout === "page" && !phone; // sources live in the right panel there

  const copy = async () => { try { await navigator.clipboard.writeText(answerMarkdown(m)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast(t("Couldn't copy")); } };

  if (m.empty === "none") {
    // R5-23E: "Your notes don't cover this yet." + two plain choices
    const names = [...new Set(srcs.map((s) => s.title))].slice(0, 2);
    return (
      <div className="flex flex-col gap-2.5" role="status" data-msg="empty">
        {m.rewrite && <Rewrite text={m.rewrite} />}
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5" data-notfound>
          <span className="font-semibold">{t("Your notes don't cover this yet.")}</span>
          <span className="leading-[1.5] text-muted" dir="auto">{names.length ? t("The closest notes are about {topics}, but none answer this.", { topics: names.join(t(" and ")) }) : t("Nothing in your notes matches this question.")}</span>
          {closest && srcs.length > 0 && <div className="flex flex-col gap-1.5">{srcs.slice(0, 4).map((s) => <SourceCard key={s.n} s={s} row v={v} onOpen={onOpen} />)}</div>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => (srcs.length ? setClosest((c) => !c) : searchInstead(question))} className="flex h-8 items-center rounded-[8px] border border-line px-3 hover:bg-surface-2" data-act="closest">{t("Show closest notes")}</button>
            {last && <button onClick={() => void regenerate(thread.id, v, true)} className="flex h-8 items-center rounded-[8px] border px-3 text-warn hover:bg-surface-2" style={{ borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)" }} data-act="general">{t("Answer from general knowledge")}</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-msg="assistant">
      <DoneLine m={m} n={new Set(shown.map((s) => s.noteId)).size} />
      {m.rewrite && <Rewrite text={m.rewrite} />}
      {m.general && <GeneralLabel />}
      <RichAnswer text={m.text} sources={srcs} size={15.5} lh={25} onOpen={onOpen} onHover={onHot} />
      {!panel && shown.length > 0 && !m.general && (
        <div className="flex flex-col gap-2">
          <button onClick={() => setShowSrc((s) => !s)} aria-expanded={showSrc} className="flex items-center gap-1.5 self-start text-[12px] text-muted hover:text-ink">
            <span aria-hidden className="text-[9px]">{showSrc ? "▼" : isRtl() ? "◀" : "▶"}</span>{t("Sources")} · {shown.length}
          </button>
          {showSrc && (
            <div className={cx("grid gap-2", phone || layout === "panel" ? "grid-cols-1" : "grid-cols-2")} aria-label={t("Sources")}>
              {shown.map((s) => <SourceCard key={s.n} s={s} v={v} hot={hot === s.n} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1" aria-label={t("Answer actions")}>
        <button className={outlineBtn} onClick={() => void saveAnswerAsNote(thread, m, v, note)} aria-label={t("Save as note")}><Glyph name="note" size={14} />{t("Save as note")}</button>
        <span className="relative">
          <button className={outlineBtn} onClick={() => setPick((p) => !p)} aria-haspopup="dialog" aria-expanded={pick} aria-label={t("Append to note…")}><Glyph name="plus" size={14} />{t("Append to note…")}</button>
          {pick && <AppendPicker onClose={() => setPick(false)} onPick={(n) => { setPick(false); void appendAnswerToNote(thread, m, n); }} />}
        </span>
        <button className={outlineBtn} onClick={async () => { setBusy(true); try { await makeCards(thread, m, v, note, 5); } finally { setBusy(false); } }} disabled={busy} aria-label={t("Make flashcards")}><Glyph name="flashcards" size={14} />{busy ? t("Making cards…") : t("Make 5 flashcards")}</button>
        <button className={outlineBtn} onClick={copy} title={t("Copy with citations")} aria-label={t("Copy")}><Glyph name="copy" size={14} />{copied ? t("Copied") : t("Copy")}</button>
        {last && <button className={outlineBtn} onClick={() => void regenerate(thread.id, v, !!m.general)} aria-label={t("Retry")}><Glyph name="refresh" size={14} />{t("Retry")}</button>}
        <button className={cx(outlineBtn, m.feedback === 1 && "!text-ok")} aria-pressed={m.feedback === 1} aria-label={t("Helpful")} title={t("Helpful")} onClick={() => void setFeedback(thread.id, m.id, m.feedback === 1 ? undefined : 1)}><Glyph name="thumbs-up" size={14} /></button>
        <button className={cx(outlineBtn, m.feedback === -1 && "!text-bad")} aria-pressed={m.feedback === -1} aria-label={t("Not helpful")} title={t("Not helpful")} onClick={() => void setFeedback(thread.id, m.id, m.feedback === -1 ? undefined : -1)}><Glyph name="thumbs-down" size={14} /></button>
      </div>
      {saved && <SavedBanner info={saved} />}
      {last && m.followups && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("Follow-ups")}>
          {m.followups.map((f) => <button key={f} dir="auto" onClick={() => void sendChat(f, v, { scope: thread.scope as Scope })} className="flex h-[30px] items-center whitespace-nowrap rounded-full border border-line px-3 text-[12.5px] hover:bg-surface-2" data-followup>{f}</button>)}
        </div>
      )}
    </div>
  );
}
const Rewrite = ({ text }: { text: string }) => (
  <span className="flex items-center gap-1.5 text-[12px] text-muted" data-rewrite><Glyph name="query" size={12} />{t("Searched for:")} <bdi dir="auto">{text}</bdi></span>
);
export const GeneralLabel = () => (
  <span className="self-start rounded-[6px] px-2 text-[12px] font-semibold leading-[22px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }} data-general>{t("Not from your notes · general knowledge")}</span>
);

/** Offline / locked / error banner (R5-23G·H·I). */
export function StateBanner({ glyph, color, text, action, onAction }: { glyph: string; color: string; text: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3" style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, var(--surface))` }} role="alert" data-banner>
      <Glyph name={glyph} size={16} color={color} />
      <span dir="auto" className="flex-1 leading-[1.5]">{text}</span>
      <button onClick={onAction} className="flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-[8px] border border-line px-3 hover:bg-surface-2">{action}</button>
    </div>
  );
}

/** The answer in progress: steps + streamed words with Stop, or the offline / signed-out / error / limit state. */
function LiveAnswer({ live, v, scope, onOpen, onHot, onScope }: { live: Live; v: Vault; scope: Scope; onOpen: (id: string) => void; onHot: (n: number | null) => void; onScope: () => void }) {
  const retry = () => void regenerate(live.threadId, v, !!live.general);
  const working = ["indexing", "rewriting", "asking", "streaming"].includes(live.status);
  const total = live.total ?? (scopeNotes(scope, v)?.size ?? v.notes.length);
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite" data-msg="live" data-status={live.status}>
      {live.rewrite && <Rewrite text={live.rewrite} />}
      {working && <LiveSteps live={live} total={total} onStop={() => stopChat()} onScope={onScope} />}
      {live.general && live.text && <GeneralLabel />}
      {live.text && <RichAnswer text={live.text} sources={live.sources} streaming={live.status === "streaming"} size={15.5} lh={25} onOpen={onOpen} onHover={onHot} />}
      {live.status === "offline" && <StateBanner glyph="c-info" color="var(--info)" text={t("Ask needs a connection. Search and your notes still work offline.")} action={t("Search instead")} onAction={() => searchInstead(live.question)} />}
      {live.status === "signedout" && <StateBanner glyph="s-locked" color="var(--muted)" text={t("Unlock sync to use Ask on this device.")} action={t("Unlock")} onAction={() => { closeAsk(); openSettings("sync"); }} />}
      {live.status === "error" && <StateBanner glyph="c-danger" color="var(--danger)" text={live.error === "Stopped before an answer." ? t("Stopped before an answer. Your question is kept.") : t("Something went wrong while answering. Your question is kept.")} action={t("Retry")} onAction={retry} />}
      {live.status === "limit" && <StateBanner glyph="limit" color="var(--danger)" text={t("Daily free AI limit reached. Try tomorrow.")} action={t("See usage")} onAction={() => { closeAsk(); openSettings("ai"); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ the conversation column
export function AskVault({ note, autoFocus, onOpened, layout = "page" }: { note?: Note; autoFocus?: boolean; onOpened?: () => void; layout?: Layout }) {
  const st = useAsk();
  const v = useVault();
  const ui = useUI();
  useLang();
  const online = useOnline();
  const phone = usePhone();
  const thread = useThread(st.activeId);
  const spaceId = note?.spaceId ?? (ui.spaceId === "all" ? "" : ui.spaceId);
  const scope: Scope = (thread?.mode === "ask" ? (thread.scope as Scope) : null) ?? st.scope ?? { kind: "vault" };
  const setScope = (s: Scope) => { setAsk({ scope: s }); if (thread?.mode === "ask" && thread.messages.length) newChat(); };
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const live = st.live && (!thread || st.live.threadId === thread.id) ? st.live : null;
  const busy = !!live && ["indexing", "rewriting", "asking", "streaming"].includes(live.status);
  const open = (id: string) => { openNote(id); onOpened?.(); };
  const locked = useAiLocked();
  const [hot, setHot] = useState<number | null>(null);
  const [scopeSignal, setScopeSignal] = useState(0);
  const [queued, setQueued] = useState<string | null>(null);
  const suggestions = useSuggestions(phone ? 3 : 4);

  useEffect(() => { if (autoFocus && !phone) setTimeout(() => input.current?.focus(), 30); }, [autoFocus, st.activeId, phone]);
  // A question handed over from the palette ("Ask your notes: …") runs once, in a new chat.
  useEffect(() => {
    try {
      const q = sessionStorage.getItem("lumen.askAuto");
      if (q && v.ready) { sessionStorage.removeItem("lumen.askAuto"); newChat(); void sendChat(q, v, { scope }); }
    } catch { /* ignore */ }
  }, [v.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const msgCount = thread?.messages.length ?? 0;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgCount, live?.text, live?.status]);
  // "Type your next question; it sends when this one finishes": the queued question goes out once the answer is saved.
  useEffect(() => { if (queued && !busy && online && !locked) { const q = queued; setQueued(null); void sendChat(q, v, { scope }); } }, [queued, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const starters = useMemo(() => {
    const cur = note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined);
    const headings = cur ? [...cur.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()) : [];
    const p = scope.kind === "path" && scope.pathId ? v.byId.get(scope.pathId) : undefined;
    const concepts = p ? parsePath(p.body).stages.flatMap((s) => s.concepts.map((c) => c.name)).slice(0, 3) : [];
    return starterQuestions({ noteTitle: cur && cur.type !== "path" ? cur.title : undefined, headings, concepts });
  }, [note, ui.noteId, v.byId, scope.kind, scope.pathId]); // eslint-disable-line react-hooks/exhaustive-deps

  const msgs = thread?.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  const lastAnswer = [...msgs].reverse().find((m) => m.role === "assistant" && !m.empty && !m.general);
  const panelSources = live?.sources.length ? live.sources.map((s) => ({ n: s.n, noteId: s.noteId, title: s.title, heading: s.heading, text: s.text })) : lastAnswer?.sources ?? [];
  const panelText = live?.sources.length ? "" : lastAnswer?.text ?? "";
  const showPanel = layout === "page" && !phone && panelSources.length > 0 && !live?.general;

  if (st.picking) return <ConceptPicker note={note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined)} layout={layout} />;
  if (thread && thread.mode !== "ask") return <TutorSession thread={thread} layout={layout} onOpened={onOpened} />;

  const submit = (q = st.draft, s: Scope = scope, pins?: Pin[]) => {
    if (!q.trim() || !online || locked) return;
    if (busy) { setQueued(q.trim()); setAsk({ draft: "" }); return; }
    if (s !== scope) setAsk({ scope: s });
    void sendChat(q, v, { scope: s, ...(pins?.length ? { pinned: pins } : {}) });
  };
  const dim = !online || locked;
  const px = phone ? 16 : 28;

  const composer = (
    <div className="relative mx-auto w-full max-w-[820px] shrink-0" style={{ padding: `10px ${px}px ${phone ? 28 : 20}px` }}>
      {queued && <div className="mb-2 flex items-center gap-2 px-1 text-[12px] text-muted" data-queued><span className="min-w-0 flex-1 truncate" dir="auto">{t("Sends when this finishes:")} {queued}</span><button aria-label={t("Cancel")} onClick={() => setQueued(null)} className="flex size-5 items-center justify-center"><Glyph name="x" size={12} /></button></div>}
      <div className="flex flex-col gap-2 rounded-[16px] bg-surface p-3" style={{ border: `1.5px solid ${busy ? "var(--border)" : "color-mix(in srgb,var(--accent) 60%,var(--border))"}`, opacity: dim ? 0.55 : 1 }} data-composer>
        <textarea ref={input} dir="auto" rows={1} value={dim ? "" : st.draft} disabled={dim} onChange={(e) => setAsk({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === "Escape" && busy) { e.stopPropagation(); stopChat(); }
          }}
          placeholder={!online ? t("Offline") : locked ? t("Locked") : busy ? t("Type your next question; it sends when this one finishes…") : msgs.length ? t("Ask a follow-up…") : t("Ask your notes…")} aria-label={t("Message")}
          className="max-h-[200px] min-h-[22px] w-full resize-none bg-transparent text-[14px] leading-[22px] text-ink !outline-none placeholder:text-muted"
          style={{ fieldSizing: "content" } as CSSProperties} />
        <div className="flex flex-wrap items-center gap-1.5">
          <ScopeMenu scope={scope} setScope={setScope} note={note} v={v} spaceId={spaceId || ""} openSignal={scopeSignal} />
          <button onClick={() => setAsk({ picking: true })} data-act="tutor-mode" className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 text-[12px] hover:bg-surface-2"><Glyph name="lesson" size={13} stroke={1.9} />{t("Tutor mode")} · {t("off")}</button>
          {!phone && <span className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 text-[12px] text-muted" title={t("The model that writes answers")}><Glyph name="model" size={13} stroke={1.9} />{providerLabel()}</span>}
          <span className="flex-1" />
          {!phone && <span className="text-[11px] text-muted">{t("Enter to send · Shift+Enter new line")}</span>}
          {busy
            ? <button aria-label={t("Stop")} onClick={() => stopChat()} className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-line px-3.5 text-[13px] font-[650] hover:bg-surface-2"><Glyph name="stop" size={14} stroke={1.9} />{t("Stop")}</button>
            : <button aria-label={t("Send")} onClick={() => submit()} disabled={dim} className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-accent px-3.5 text-[13px] font-[650] text-accent-fg disabled:opacity-60"><Glyph name="send" size={14} stroke={1.9} />{t("Send")}</button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 text-[13px]" data-ask={layout}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!msgs.length && !live && (
            <div className="flex flex-1 flex-col items-center justify-center gap-[18px] pb-6" style={{ padding: `0 ${px}px` }} data-empty>
              <span className="flex size-12 items-center justify-center rounded-[14px]" style={{ background: "color-mix(in srgb,var(--accent) 14%,transparent)", color: "var(--accent)" }}><Glyph name="assistant" size={24} /></span>
              <div className="flex flex-col items-center gap-1.5 text-center">
                <span className="font-[650]" style={{ fontSize: phone ? 19 : 22 }}>{t("Ask your notes anything")}</span>
                <span className="max-w-[460px] text-[13.5px] text-muted" dir="auto" style={{ textWrap: "pretty" }}>{t("Answers come only from your vault and always show their sources. Only the matching excerpts are sent to the AI.")}</span>
              </div>
              <div className="grid w-full max-w-[720px] gap-2.5" style={{ gridTemplateColumns: phone ? "1fr" : "1fr 1fr" }}>
                {suggestions.length ? suggestions.map((s) => (
                  <button key={s.id} onClick={() => submit(s.text, s.scope, s.pins)} disabled={dim} data-suggest={s.id} className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-start hover:bg-surface-2 disabled:opacity-60">
                    <span className="flex items-center gap-1.5 text-[11px] font-[650] tracking-[.05em]" style={{ color: s.color }}><Glyph name={s.glyph} size={13} stroke={1.9} />{s.kind}</span>
                    <span dir="auto" className="text-[13px] leading-[18px]">{s.text}</span>
                    <span dir="auto" className="text-[11px] text-muted">{s.src}</span>
                  </button>
                )) : starters.map((q) => (
                  <button key={q} dir="auto" onClick={() => submit(q)} disabled={dim} className="flex min-h-10 items-center rounded-[12px] border border-line bg-surface px-3.5 py-3 text-start text-[13px] hover:bg-surface-2" data-starter>{q}</button>
                ))}
              </div>
            </div>
          )}
          {(msgs.length > 0 || live) && (
            <div className="mx-auto flex w-full max-w-[820px] flex-col gap-[18px]" style={{ padding: `22px ${px}px 12px` }}>
              {thread?.summary && msgs.length > 0 && (
                <div className="flex items-center gap-2.5 text-[12px] text-muted" data-summarized><span className="h-px flex-1 bg-line" />{t("Earlier messages summarized")}<span className="h-px flex-1 bg-line" /></div>
              )}
              {thread && msgs.map((m) => m.role === "user"
                ? <div key={m.id} className="flex justify-end"><span dir="auto" data-msg="user" className="max-w-[80%] whitespace-pre-wrap rounded-[14px] rounded-ee-[4px] bg-surface-2 px-3.5 py-2.5 text-[14px] leading-[21px]">{m.text}</span></div>
                : <AssistantMessage key={m.id} m={m} thread={thread} last={m === lastMsg && !live} v={v} note={note} layout={layout} phone={phone} onOpen={open} onHot={setHot} hot={hot} />)}
              {live && !thread && <div className="flex justify-end"><span dir="auto" className="max-w-[80%] rounded-[14px] rounded-ee-[4px] bg-surface-2 px-3.5 py-2.5 text-[14px] leading-[21px]">{live.question}</span></div>}
              {live && <LiveAnswer live={live} v={v} scope={scope} onOpen={open} onHot={setHot} onScope={() => setScopeSignal((x) => x + 1)} />}
            </div>
          )}
        </div>
        {composer}
      </div>
      {showPanel && <SourcesPanel sources={panelSources} text={panelText} scopeName={scopeLabel(scope, v)} hot={hot} onOpen={open} />}
    </div>
  );
}

/** "Using the last 4 turns · 8 passages" for the conversation header. */
function contextLine(thread: ChatThread | undefined, live: Live | null) {
  if (!thread || thread.mode !== "ask") return "";
  const turns = thread.messages.filter((m) => m.role === "user").length;
  if (!turns) return "";
  const lastA = [...thread.messages].reverse().find((m) => m.role === "assistant");
  const passages = live?.sources.length || lastA?.sources?.length || 0;
  return `${t("Using the last {n} turn|Using the last {n} turns", { n: Math.min(turns, WINDOW_TURNS) })} · ${t("{n} passage|{n} passages", { n: passages })}`;
}

// ------------------------------------------------------------------ thread list
const DAY = 86_400_000;
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

function ThreadMenu({ t: th, onRename, onDelete, onClose, extra }: { t: ChatThread; onRename: () => void; onDelete: () => void; onClose: () => void; extra?: ReactNode }) {
  const item = "flex h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg";
  const saveAll = async () => { const n = await createNote({ title: th.title, spaceId: "inbox", body: threadMarkdown(th) }); toast(t("Saved as a note"), { label: t("Open"), run: () => openNote(n.id) }); };
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="menu" className="absolute end-1 top-[calc(100%+2px)] z-40 flex w-[200px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" onClick={onClose}>
        <button role="menuitem" className={item} onClick={onRename}><ChatIcon name="edit" size={13} />{t("Rename")}</button>
        <button role="menuitem" className={item} onClick={() => void pinThread(th.id, !th.pinned)}><ChatIcon name="pin" size={13} />{th.pinned ? t("Unpin") : t("Pin")}</button>
        <button role="menuitem" className={item} onClick={() => void shareThread(threadMarkdown(th))}><Glyph name="copy" size={13} />{t("Copy conversation")}</button>
        <button role="menuitem" className={item} onClick={() => void saveAll()}><Glyph name="note" size={13} />{t("Save conversation as note")}</button>
        {extra}
        <button role="menuitem" className={cx(item, "text-bad")} onClick={onDelete}><Glyph name="x" size={13} />{t("Delete")}</button>
      </div>
    </>
  );
}

function ThreadRow({ t: th, active }: { t: ChatThread; active: boolean }) {
  const v = useVault();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const lastA = [...th.messages].reverse().find((m) => m.role === "assistant" && m.sources?.length);
  const n = lastA ? new Set(lastA.sources!.map((s) => s.noteId)).size : 0;
  const sub = th.mode === "ask" ? [scopeLabel(th.scope as Scope, v), n ? t("{n} source|{n} sources", { n }) : ""].filter(Boolean).join(" · ") : t("Tutor");
  if (renaming) return (
    <input autoFocus dir="auto" defaultValue={th.title} aria-label={t("Rename")} className="mx-2 h-9 rounded-[8px] border border-accent bg-bg px-2 text-[13px] outline-none"
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
      onBlur={(e) => { void renameThread(th.id, e.target.value); setRenaming(false); }} />
  );
  if (confirm) return (
    <div className="mx-2 flex flex-col gap-1.5 rounded-[8px] border border-line bg-surface p-2 text-[12.5px]" role="alertdialog">
      <span>{t("Delete this conversation?")}</span>
      <div className="flex gap-1.5"><button className="h-7 rounded-[6px] bg-bad px-2.5 font-semibold text-white" onClick={() => void deleteThread(th.id)}>{t("Delete")}</button><button className="h-7 rounded-[6px] px-2.5 hover:bg-surface-2" onClick={() => setConfirm(false)}>{t("Cancel")}</button></div>
    </div>
  );
  return (
    <div className="group relative mx-2 rounded-[9px]" style={{ background: active ? AC : undefined }} data-thread={th.id}>
      <button onClick={() => openThread(th.id)} className={cx("flex w-full flex-col gap-0.5 rounded-[9px] px-2.5 py-2 text-start", !active && "hover:bg-surface-2")}>
        <span className="flex w-full items-center gap-1.5 pe-6">
          {th.pinned ? <span className="text-[11px] text-accent" aria-hidden>●</span> : null}
          <span dir="auto" className="min-w-0 flex-1 truncate text-[13px]" style={{ fontWeight: active ? 600 : 400 }}>{th.title}</span>
        </span>
        <span dir="auto" className="truncate text-[11.5px] text-muted">{sub}</span>
      </button>
      <button aria-label={t("Thread actions")} aria-haspopup="menu" onClick={() => setMenu((m) => !m)} className={cx("absolute end-1.5 top-1.5 flex size-6 items-center justify-center rounded-[6px] text-muted hover:text-ink", !active && !menu && "opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100")}><span aria-hidden>⋯</span></button>
      {menu && <ThreadMenu t={th} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} onDelete={() => setConfirm(true)} />}
    </div>
  );
}
export function ThreadList({ activeId, query = "" }: { activeId: string | null; query?: string }) {
  const all = useThreads();
  const q = query.trim().toLowerCase();
  const threads = q ? all.filter((th) => th.title.toLowerCase().includes(q) || th.messages.some((m) => m.text.toLowerCase().includes(q))) : all;
  const today = startOfDay(Date.now());
  const groups: [string, string, ChatThread[]][] = [
    ["pinned", t("PINNED"), threads.filter((th) => th.pinned)],
    ["today", t("TODAY"), threads.filter((th) => !th.pinned && th.updatedAt >= today)],
    ["yesterday", t("YESTERDAY"), threads.filter((th) => !th.pinned && th.updatedAt < today && th.updatedAt >= today - DAY)],
    ["week", t("PREVIOUS 7 DAYS"), threads.filter((th) => !th.pinned && th.updatedAt < today - DAY && th.updatedAt >= today - 7 * DAY)],
    ["earlier", t("EARLIER"), threads.filter((th) => !th.pinned && th.updatedAt < today - 7 * DAY)],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label={t("Chats")}>
      {!threads.length && (q
        ? <span className="px-4 py-2 text-muted">{t("No chats match.")}</span>
        : <div className="m-4 rounded-[12px] border border-dashed border-line p-3.5 text-[12.5px] leading-[18px] text-muted">{t("Your chats show here. Each one can be saved as a note.")}</div>)}
      {groups.map(([k, label, list]) => list.length > 0 && (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="px-4 pb-1 pt-2.5 text-[11px] font-[650] tracking-[.06em] text-muted">{label}</span>
          {list.map((th) => <ThreadRow key={th.id} t={th} active={th.id === activeId} />)}
        </div>
      ))}
    </div>
  );
}
function ThreadColumn({ activeId, searchRef }: { activeId: string | null; searchRef: RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex w-[270px] shrink-0 flex-col border-e border-line bg-surface" data-threads>
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-4">
        <span className="flex-1 text-[16px] font-[650]">{t("Ask")}</span>
        <button onClick={() => newChat()} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] hover:bg-surface-2" data-act="new-chat" title="Ctrl+J"><span aria-hidden>+</span>{t("New")} <span className="text-[11px] text-muted">⌘J</span></button>
      </div>
      <label className="mx-3.5 mb-2.5 flex h-[34px] items-center gap-2 rounded-[9px] border border-line px-2.5 text-muted focus-within:border-accent">
        <Glyph name="search" size={14} stroke={1.9} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search chats")} aria-label={t("Search chats")} dir="auto" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-muted" />
      </label>
      <ThreadList activeId={activeId} query={q} />
    </div>
  );
}

/** Conversation header: title, context line, Save as note, Share, History, ⋯ (thread actions + close). */
function ConvHeader({ phone, thread, live, note, searchRef }: { phone: boolean; thread: ChatThread | undefined; live: Live | null; note?: Note; searchRef?: RefObject<HTMLInputElement | null> }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const st = useAsk();
  const v = useVault();
  const saved = useSaved();
  const ctx = phone ? "" : contextLine(thread, live);
  const title = st.picking ? t("Tutor") : thread?.title ?? t("New chat");
  const item = "flex h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg";
  const ask = !!thread && thread.mode === "ask";
  const lastA = ask ? [...thread!.messages].reverse().find((m) => m.role === "assistant" && m.text.trim() && !m.empty) : undefined;
  const isSaved = !!lastA && !!saved[lastA.id];
  const tail = <><button role="menuitem" className={item} onClick={() => newChat()}><Glyph name="plus" size={13} />{t("New chat")}</button><button role="menuitem" className={item} onClick={closeAsk}><Glyph name="x" size={13} />{t("Close Ask")}</button></>;
  const ghost = "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] border px-2.5 text-[12.5px] font-medium";
  return (
    <div className={cx("relative flex shrink-0 items-center gap-2.5 border-b border-line", phone ? "h-[52px] px-4" : "h-14 px-7")} data-ask-header>
      {phone && <button aria-label={t("Close")} onClick={closeAsk} className="-ms-2 flex size-10 items-center justify-center text-[22px]"><span aria-hidden>{isRtl() ? "›" : "‹"}</span></button>}
      {renaming && thread ? (
        <input autoFocus dir="auto" defaultValue={thread.title} aria-label={t("Rename")} className="h-8 min-w-0 flex-1 rounded-[7px] border border-accent bg-bg px-2 font-semibold outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
          onBlur={(e) => { void renameThread(thread.id, e.target.value); setRenaming(false); }} />
      ) : <span dir="auto" className="min-w-0 flex-1 truncate text-[14px] font-[650]">{title}</span>}
      {ctx && <span className="whitespace-nowrap text-[12px] text-muted" data-context>{ctx}</span>}
      {lastA && thread && (
        <button onClick={() => void saveAnswerAsNote(thread, lastA, v, note)} className={ghost} data-act="save-note"
          style={isSaved ? { borderColor: "var(--border)" } : { borderColor: "transparent", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 650 }}><Glyph name="note" size={15} />{isSaved ? t("Saved") : t("Save as note")}</button>
      )}
      {lastA && thread && !phone && <button onClick={() => void shareThread(threadMarkdown(thread))} className={cx(ghost, "border-line")} data-act="share"><Glyph name="link" size={15} />{t("Share")}</button>}
      {!lastA && !phone && <button onClick={() => searchRef?.current?.focus()} className={cx(ghost, "border-transparent text-muted")} data-act="history"><Glyph name="history" size={15} />{t("History")}</button>}
      {phone && <button aria-label={t("Chats")} onClick={() => setAsk({ list: true })} className="flex size-9 items-center justify-center"><Glyph name="history" size={18} /></button>}
      <div className="relative">
        <button aria-label={t("More")} aria-haspopup="menu" onClick={() => setMenu((m) => !m)} className="flex h-8 items-center justify-center rounded-[8px] px-2.5 text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="more" size={15} /></button>
        {menu && (thread && thread.mode === "ask"
          ? <ThreadMenu t={thread} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} onDelete={() => setConfirm(true)} extra={tail} />
          : (<><div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute end-1 top-[calc(100%+2px)] z-40 flex w-[170px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" onClick={() => setMenu(false)}>{tail}</div></>))}
      </div>
      {confirm && thread && (
        <div className="absolute end-4 top-[calc(100%+4px)] z-40 flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" role="alertdialog">
          <span>{t("Delete this conversation?")}</span>
          <div className="flex gap-1.5"><button className="h-7 rounded-[6px] bg-bad px-2.5 font-semibold text-white" onClick={() => { setConfirm(false); void deleteThread(thread.id); }}>{t("Delete")}</button><button className="h-7 rounded-[6px] px-2.5 hover:bg-surface-2" onClick={() => setConfirm(false)}>{t("Cancel")}</button></div>
        </div>
      )}
    </div>
  );
}

/**
 * Full Ask (palette → "Ask your notes…"): takes the sidebar's place on desktop (rail + chat list + conversation +
 * sources), full screen on phone. The notes sidebar is back as soon as Ask closes.
 */
export function AskSheet() {
  const st = useAsk();
  const ui = useUI();
  const v = useVault();
  useLang();
  const note = ui.view === "notes" && ui.noteId ? v.byId.get(ui.noteId) : undefined;
  const phone = usePhone();
  const thread = useThread(st.activeId);
  const live = st.live && (!thread || st.live.threadId === thread.id) ? st.live : null;
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!st.open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) { if (getAsk().list) setAsk({ list: false }); else closeAsk(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); newChat(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [st.open]);
  if (!st.open) return null;
  const tutor = !!thread && thread.mode !== "ask";
  if (phone) return (
    <div role="dialog" aria-label={t("Ask")} className="fixed inset-0 z-50 flex flex-col bg-bg text-[13px] fade-in" data-r6-layer>
      {!tutor && <ConvHeader phone thread={thread} live={live} note={note} />}
      <div className="flex min-h-0 flex-1 flex-col"><AskVault note={note} autoFocus onOpened={closeAsk} layout="sheet" /></div>
      {st.list && (
        <div className="fixed inset-0 z-50 bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setAsk({ list: false })}>
          <div className="absolute inset-x-0 bottom-0 flex h-[78%] flex-col gap-2 rounded-t-[14px] bg-surface px-1 pt-2" role="dialog" aria-label={t("Chats")}>
            <span className="flex justify-center pb-1"><span className="h-1 w-9 rounded-[2px] bg-line" /></span>
            <div className="flex items-center gap-2 px-3"><span className="flex-1 text-[16px] font-[650]">{t("Chats")}</span>
              <button onClick={() => newChat()} className="flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3"><span aria-hidden>+</span>{t("New")}</button>
              <button aria-label={t("Close")} onClick={() => setAsk({ list: false })} className="flex size-9 items-center justify-center"><Glyph name="x" size={16} /></button></div>
            <ThreadList activeId={st.activeId} />
          </div>
        </div>
      )}
    </div>
  );
  return (
    <div role="dialog" aria-label={t("Ask")} className="fixed inset-0 z-50 flex bg-bg text-[13px] fade-in" data-r6-layer data-ask-takeover>
      <Rail />
      {!tutor && <ThreadColumn activeId={st.activeId} searchRef={search} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!tutor && <ConvHeader phone={false} thread={thread} live={live} note={note} searchRef={search} />}
        <AskVault note={note} autoFocus onOpened={closeAsk} layout="page" />
      </div>
    </div>
  );
}

/** Ask page "Tutor mode" switch (kept under the old name for callers). */
export const ModeSwitch = ({ tutor }: { tutor: boolean }) => <TutorToggle on={tutor} />;
