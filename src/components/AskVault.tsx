// Ask your notes as a multi-turn chat — design round 5, Lumen 23 (AskChat): R5-23A…N.
// Desktop: full page beside the app sidebar: thread column (280 px: New, Search chats, Pinned / Today / Earlier) +
// conversation (header with title, context line and ⋯; 760 px column; composer with scope chip, Tutor mode switch,
// Enter hint and Send / Stop). Phone: full screen, threads in a sheet from the list icon. Tutor threads render
// TutorSession full width. Logic: lib/ask.ts (store, network) + lib/chat.ts (pure). The note Assistant (right panel)
// lives in Assistant.tsx and shares the engine.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, ChatThread, Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import {
  closeAsk, deleteThread, getAsk, getPendingTutor, newChat, openThread, pinThread, regenerate, renameThread, scopeLabel, sendChat, setAsk, setFeedback, stopChat, useAsk,
  type Live, type Scope,
} from "../lib/ask";
import { answerMarkdown, citedIn, starterQuestions, threadMarkdown, WINDOW_TURNS } from "../lib/chat";
import { db, DEMO } from "../lib/db";
import { fmtDate, fmtTime, isRtl, t, useLang } from "../lib/i18n";
import { parsePath } from "../lib/path";
import { openNote, setUI, toast, useUI, useVault, type Vault } from "../lib/store";
import { actBtn, ChatIcon, RichAnswer, sidebarInset, SourceCard, useAiLocked, useOnline } from "./ChatParts";
import { Glyph } from "./Glyph";
import { openSettings } from "./ShareSheet";
import { ConceptPicker, TutorSession } from "./TutorSession";
import { cx } from "./ui";

type Layout = "page" | "sheet" | "panel";

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

// ------------------------------------------------------------------ scope chip (composer)
const sameScope = (a: Scope, b: Scope) => a.kind === b.kind && (a.spaceId ?? "") === (b.spaceId ?? "") && (a.noteId ?? "") === (b.noteId ?? "") && (a.pathId ?? "") === (b.pathId ?? "");
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
  const opts: { s: Scope; label: string; glyph: string; color?: string }[] = [
    { s: { kind: "vault" }, label: t("Whole vault"), glyph: "query" },
    ...(space ? [{ s: { kind: "space" as const, spaceId }, label: space.name, glyph: "folder" }] : []),
    ...(note ? [{ s: { kind: "note" as const, noteId: note.id }, label: t("{title} + links", { title: note.title }), glyph: note.type || "note" }] : []),
    ...paths.map((p) => ({ s: { kind: "path" as const, pathId: p.id }, label: p.title, glyph: "path", color: "#A371F7" })),
  ];
  const cur = opts.find((o) => sameScope(o.s, scope)) ?? { s: scope, label: scopeLabel(scope, v), glyph: scope.kind === "path" ? "path" : "query", color: scope.kind === "path" ? "#A371F7" : undefined };
  return (
    <div ref={ref} className="relative shrink-0">
      <button aria-haspopup="listbox" aria-expanded={open} aria-label={t("Search in: {scope}", { scope: cur.label })} onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12.5px] hover:text-ink" data-scope>
        <Glyph name={cur.glyph} size={13} color={cur.color ?? "var(--muted)"} /><span dir="auto" className="truncate">{cur.label}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="listbox" aria-label={t("Search in")} className="absolute bottom-[calc(100%+4px)] start-0 z-40 flex max-h-[300px] w-[240px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
          {opts.map((o) => (
            <button key={o.label + o.s.kind} role="option" aria-selected={o === cur} onClick={() => { setScope(o.s); setOpen(false); }}
              className={cx("flex h-11 items-center gap-2 rounded-[6px] px-2 text-start sm:h-8", o === cur ? "bg-bg" : "hover:bg-bg")}>
              <Glyph name={o.glyph} size={13} color={o.color ?? "var(--muted)"} /><span dir="auto" className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

/** "Tutor mode" switch in the composer (R5-23): on → concept picker, off → back to Ask. */
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

// ------------------------------------------------------------------ one assistant message
function AssistantMessage({ m, thread, last, v, note, layout, phone, onOpen }: { m: ChatMessage; thread: ChatThread; last: boolean; v: Vault; note?: Note; layout: Layout; phone: boolean; onOpen: (id: string) => void }) {
  const [showSrc, setShowSrc] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [closest, setClosest] = useState(false);
  const question = useMemo(() => { const i = thread.messages.indexOf(m); return [...thread.messages.slice(0, i)].reverse().find((x) => x.role === "user")?.text ?? ""; }, [thread.messages, m]);
  const cited = citedIn(m.text);
  const srcs = m.sources ?? [];
  const shown = cited.size ? srcs.filter((s) => cited.has(s.n)) : srcs;
  const targetSpace = note?.spaceId ?? "inbox";
  const label = (s: string) => (phone ? null : <span>{s}</span>);

  const copy = async () => { try { await navigator.clipboard.writeText(answerMarkdown(m)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast(t("Couldn't copy")); } };
  const saveNote = async () => {
    const title = question.replace(/[#[\]|]/g, "").slice(0, 90) || thread.title;
    const n = await createNote({ title, spaceId: targetSpace, body: `# ${title}\n\n${answerMarkdown(m)}` });
    toast(t("Saved as a note"), { label: t("Open"), run: () => openNote(n.id) });
  };
  const makeCards = async () => {
    setBusy(true);
    try {
      const plain = m.text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\*\*[^*]+\*\*/g, "");
      let out = "";
      if (DEMO && !getToken()) out = plain.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^[-*\s]+/, "").trim()).filter((s) => s.length > 12).slice(0, 4).map((s, i) => `${question.replace(/[?؟]$/, "")} (${i + 1})? :: ${s.replace(/[*_]/g, "")}`).join("\n");
      else out = (await aiRun("flashcards", `${question}\n\n${plain}`)).trim();
      const cards = out.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim()).filter((l) => / :: /.test(l));
      if (!cards.length) { toast(t("The AI didn't return any cards.")); return; }
      const title = `${question.replace(/[#[\]|]/g, "").slice(0, 80) || thread.title} · cards`;
      const from = srcs.filter((s) => cited.has(s.n)).map((s) => `[[${s.title.replace(/[[\]|#]/g, " ")}]]`).filter((x, i, a) => a.indexOf(x) === i);
      const n = await createNote({ title, spaceId: targetSpace, type: "flashcards", body: `# ${title}\n\n${cards.join("\n")}\n${from.length ? `\nFrom ${from.join(", ")}\n` : ""}` });
      toast(t("{n} flashcard made (it shows in Review)|{n} flashcards made (they show in Review)", { n: cards.length }), { label: t("Open"), run: () => openNote(n.id) });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

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
      {m.rewrite && <Rewrite text={m.rewrite} />}
      {m.general && <GeneralLabel />}
      <RichAnswer text={m.text} sources={srcs} size={phone ? 16 : 17} onOpen={onOpen} onHover={setHot} />
      {shown.length > 0 && !m.general && (
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
      <div className="-ms-2 flex flex-wrap items-center gap-1" aria-label={t("Answer actions")}>
        <button className={actBtn} onClick={copy} title={t("Copy with citations")} aria-label={t("Copy")}><Glyph name="columns-2" size={14} />{label(copied ? t("Copied") : t("Copy"))}</button>
        <button className={actBtn} onClick={saveNote} aria-label={t("Save as note")}><Glyph name="note" size={14} />{label(t("Save as note"))}</button>
        <button className={actBtn} onClick={makeCards} disabled={busy} aria-label={t("Make flashcards")}><Glyph name="flashcards" size={14} />{label(busy ? t("Making cards…") : t("Make flashcards"))}</button>
        {last && <button className={actBtn} onClick={() => void regenerate(thread.id, v, !!m.general)} aria-label={t("Regenerate")}><Glyph name="undo" size={14} />{label(t("Regenerate"))}</button>}
        <button className={cx(actBtn, m.feedback === 1 && "!text-ok")} aria-pressed={m.feedback === 1} aria-label={t("Helpful")} title={t("Helpful")} onClick={() => void setFeedback(thread.id, m.id, m.feedback === 1 ? undefined : 1)}><Glyph name="s-done" size={14} /></button>
        <button className={cx(actBtn, m.feedback === -1 && "!text-bad")} aria-pressed={m.feedback === -1} aria-label={t("Not helpful")} title={t("Not helpful")} onClick={() => void setFeedback(thread.id, m.id, m.feedback === -1 ? undefined : -1)}><Glyph name="d-rejected" size={14} /></button>
      </div>
      {last && m.followups && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("Follow-ups")}>
          {m.followups.map((f) => <button key={f} dir="auto" onClick={() => void sendChat(f, v, { scope: thread.scope as Scope })} className="flex h-[30px] items-center rounded-full border border-line px-3 text-[12.5px] hover:bg-surface-2" data-followup>{f}</button>)}
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

/** The answer in progress (indexing → rewriting → streaming), or the offline / signed-out / error / limit state. */
function LiveAnswer({ live, v, layout, phone, scope, onOpen }: { live: Live; v: Vault; layout: Layout; phone: boolean; scope: Scope; onOpen: (id: string) => void }) {
  const name = scopeLabel(scope, v);
  const retry = () => void regenerate(live.threadId, v, !!live.general);
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite" data-msg="live" data-status={live.status}>
      {live.rewrite && <Rewrite text={live.rewrite} />}
      {live.status === "indexing" && (
        <div className="flex flex-col gap-2" role="status">
          <span className="text-muted" dir="auto">{t("Reading {n} notes in {scope}…", { n: live.total ?? 0, scope: name })}</span>
          <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-accent transition-[width]" style={{ width: `${live.total ? Math.round(((live.read ?? 0) / live.total) * 100) : 0}%` }} /></span>
        </div>
      )}
      {live.status === "rewriting" && <span className="text-muted">{t("Understanding the follow-up…")}</span>}
      {live.status === "asking" && <span className="text-muted">{live.general ? t("Answering from general knowledge…") : t("Answering from {n} passages in {scope}…", { n: live.sources.length, scope: name })}</span>}
      {live.general && live.text && <GeneralLabel />}
      {live.text && <RichAnswer text={live.text} sources={live.sources} streaming={live.status === "streaming"} size={phone || layout === "panel" ? 16 : 17} onOpen={onOpen} />}
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

  const starters = useMemo(() => {
    const cur = note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined);
    const headings = cur ? [...cur.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()) : [];
    const p = scope.kind === "path" && scope.pathId ? v.byId.get(scope.pathId) : undefined;
    const concepts = p ? parsePath(p.body).stages.flatMap((s) => s.concepts.map((c) => c.name)).slice(0, 3) : [];
    return starterQuestions({ noteTitle: cur && cur.type !== "path" ? cur.title : undefined, headings, concepts });
  }, [note, ui.noteId, v.byId, scope.kind, scope.pathId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (st.picking) return <ConceptPicker note={note ?? (ui.noteId ? v.byId.get(ui.noteId) : undefined)} layout={layout} />;
  if (thread && thread.mode !== "ask") return <TutorSession thread={thread} layout={layout} onOpened={onOpened} />;

  const submit = (q = st.draft) => { if (q.trim() && !busy && online && !locked) void sendChat(q, v, { scope }); };
  const msgs = thread?.messages ?? [];
  const lastMsg = msgs[msgs.length - 1];
  const dim = !online || locked;

  const composer = (
    <div className={cx("flex shrink-0 justify-center", phone ? "px-3 pb-5 pt-2" : "px-6 pb-5")}>
      <div className={cx("flex w-[760px] max-w-full flex-col gap-2.5 rounded-[14px] border bg-surface px-3 py-2.5", busy ? "border-line" : "border-accent")} style={{ opacity: dim ? 0.55 : 1 }} data-composer>
        <textarea ref={input} dir="auto" rows={1} value={dim ? "" : st.draft} disabled={dim} onChange={(e) => setAsk({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === "Escape" && busy) { e.stopPropagation(); stopChat(); }
          }}
          placeholder={!online ? t("Offline") : locked ? t("Locked") : msgs.length ? t("Ask a follow-up…") : t("Ask your notes…")} aria-label={t("Message")}
          className="max-h-[200px] min-h-[22px] w-full resize-none bg-transparent text-[13px] leading-[1.5] text-ink !outline-none placeholder:text-muted"
          style={{ fieldSizing: "content" } as CSSProperties} />
        <div className="flex flex-wrap items-center gap-2">
          <ScopeChip scope={scope} setScope={setScope} note={note} v={v} spaceId={spaceId || ""} />
          <TutorToggle on={false} />
          <span className="flex-1" />
          {!phone && <span className="text-[11.5px] text-muted">{t("Enter to send · Shift+Enter new line")}</span>}
          {busy
            ? <button aria-label={t("Stop")} onClick={() => stopChat()} className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-3.5 font-semibold hover:bg-surface-2"><span aria-hidden>■</span>{t("Stop")}</button>
            : <button aria-label={t("Send")} onClick={() => submit()} disabled={dim} className="flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3.5 font-semibold text-accent-fg disabled:opacity-60">{t("Send")}</button>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col text-[13px]" data-ask={layout}>
      <div ref={scroller} className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div className={cx("flex w-[760px] max-w-full flex-col gap-4", phone ? "p-4" : "py-6")}>
          {!msgs.length && !live && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3.5 pb-20 text-center" data-empty>
              <Glyph name="query" size={24} color="var(--muted)" tile="#9AA0AA" />
              <span className="text-[17px] font-semibold">{t("Ask your notes anything")}</span>
              <span className="text-muted" dir="auto">{t("Answers come from {scope}, with sources.", { scope: scope.kind === "vault" ? t("your whole vault") : scopeLabel(scope, v) })}</span>
              <div className="flex w-full max-w-[440px] flex-col gap-2">
                {starters.map((q) => (
                  <button key={q} dir="auto" onClick={() => submit(q)} disabled={dim} className="flex min-h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 py-2 text-start hover:bg-surface-2" data-starter>{q}</button>
                ))}
              </div>
            </div>
          )}
          {thread?.summary && msgs.length > 0 && (
            <div className="flex items-center gap-2.5 text-[12px] text-muted" data-summarized><span className="h-px flex-1 bg-line" />{t("Earlier messages summarized")}<span className="h-px flex-1 bg-line" /></div>
          )}
          {thread && msgs.map((m) => m.role === "user"
            ? <div key={m.id} className="flex justify-end"><span dir="auto" data-msg="user" className="max-w-[78%] whitespace-pre-wrap rounded-[14px] rounded-ee-[4px] bg-surface-2 px-3.5 py-2.5 leading-[1.5]">{m.text}</span></div>
            : <AssistantMessage key={m.id} m={m} thread={thread} last={m === lastMsg && !live} v={v} note={note} layout={layout} phone={phone} onOpen={open} />)}
          {live && !thread && <div className="flex justify-end"><span dir="auto" className="max-w-[78%] rounded-[14px] rounded-ee-[4px] bg-surface-2 px-3.5 py-2.5 leading-[1.5]">{live.question}</span></div>}
          {live && <LiveAnswer live={live} v={v} layout={layout} phone={phone} scope={scope} onOpen={open} />}
        </div>
      </div>
      {composer}
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
  return t("Using the last {turns} turns · {passages} passages", { turns: Math.min(turns, WINDOW_TURNS), passages });
}

// ------------------------------------------------------------------ thread list
const SCOPE_SHORT: Record<string, string> = { vault: "Vault", space: "Space", note: "Note + links", path: "Path" };
const DAY = 86_400_000;
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
function when(ts: number, inToday: boolean) {
  const today = startOfDay(Date.now());
  if (ts >= today) return inToday ? fmtTime(ts) : t("Today");
  if (ts >= today - 6 * DAY) return fmtDate(ts, { weekday: "short" });
  return fmtDate(ts, { day: "numeric", month: "short" });
}

function ThreadMenu({ t: th, onRename, onDelete, onClose, extra }: { t: ChatThread; onRename: () => void; onDelete: () => void; onClose: () => void; extra?: ReactNode }) {
  const item = "flex h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg";
  const saveAll = async () => { const n = await createNote({ title: th.title, spaceId: "inbox", body: threadMarkdown(th) }); toast(t("Saved as a note"), { label: t("Open"), run: () => openNote(n.id) }); };
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="menu" className="absolute end-1 top-[calc(100%+2px)] z-40 flex w-[200px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" onClick={onClose}>
        <button role="menuitem" className={item} onClick={onRename}><ChatIcon name="edit" size={13} />{t("Rename")}</button>
        <button role="menuitem" className={item} onClick={() => void pinThread(th.id, !th.pinned)}><ChatIcon name="pin" size={13} />{th.pinned ? t("Unpin") : t("Pin")}</button>
        <button role="menuitem" className={item} onClick={() => void navigator.clipboard?.writeText(threadMarkdown(th)).then(() => toast(t("Conversation copied")))}><Glyph name="columns-2" size={13} />{t("Copy conversation")}</button>
        <button role="menuitem" className={item} onClick={() => void saveAll()}><Glyph name="note" size={13} />{t("Save conversation as note")}</button>
        {extra}
        <button role="menuitem" className={cx(item, "text-bad")} onClick={onDelete}><Glyph name="x" size={13} />{t("Delete")}</button>
      </div>
    </>
  );
}

function ThreadRow({ t: th, active, group }: { t: ChatThread; active: boolean; group: string }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const scope = th.mode === "ask" ? t(SCOPE_SHORT[th.scope.kind] ?? "Vault") : t("Tutor");
  if (renaming) return (
    <input autoFocus dir="auto" defaultValue={th.title} aria-label={t("Rename")} className="h-9 rounded-[8px] border border-accent bg-bg px-2 text-[13px] outline-none"
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
      onBlur={(e) => { void renameThread(th.id, e.target.value); setRenaming(false); }} />
  );
  if (confirm) return (
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-surface p-2 text-[12.5px]" role="alertdialog">
      <span>{t("Delete this conversation?")}</span>
      <div className="flex gap-1.5"><button className="h-7 rounded-[6px] bg-bad px-2.5 font-semibold text-white" onClick={() => void deleteThread(th.id)}>{t("Delete")}</button><button className="h-7 rounded-[6px] px-2.5 hover:bg-surface-2" onClick={() => setConfirm(false)}>{t("Cancel")}</button></div>
    </div>
  );
  return (
    <div className={cx("group relative rounded-[8px]", active ? "bg-surface-2" : "hover:bg-surface-2")} data-thread={th.id}>
      <button onClick={() => openThread(th.id)} className="flex w-full flex-col gap-1 p-2 text-start">
        <span className="flex w-full items-center gap-1.5 pe-6">
          {th.pinned ? <span className="text-[11px] text-accent" aria-hidden>●</span> : null}
          <span dir="auto" className={cx("min-w-0 flex-1 truncate", active ? "font-semibold" : "font-[450]")}>{th.title}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="rounded-[5px] px-1.5 leading-[18px]" style={{ background: active ? "var(--bg)" : "var(--surface-2)" }}>{scope}</span>
          {when(th.updatedAt, group === "today")}
        </span>
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
    ["pinned", t("Pinned"), threads.filter((th) => th.pinned)],
    ["today", t("Today"), threads.filter((th) => !th.pinned && th.updatedAt >= today)],
    ["earlier", t("Earlier"), threads.filter((th) => !th.pinned && th.updatedAt < today)],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label={t("Chats")}>
      {!threads.length && <span className="px-2 py-2 text-muted">{q ? t("No chats match.") : t("Conversations you start show here.")}</span>}
      {groups.map(([k, label, list]) => list.length > 0 && (
        <div key={k} className="flex flex-col gap-1">
          <span className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{label}</span>
          {list.map((th) => <ThreadRow key={th.id} t={th} active={th.id === activeId} group={k} />)}
        </div>
      ))}
    </div>
  );
}
function ThreadColumn({ activeId }: { activeId: string | null }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-1 border-e border-line px-2.5 py-3.5" data-threads>
      <div className="flex items-center gap-2 px-1.5 pb-2.5">
        <span className="flex-1 text-[15px] font-[650]">{t("Ask")}</span>
        <button onClick={() => newChat()} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 hover:bg-surface-2" data-act="new-chat"><span aria-hidden>+</span>{t("New")}</button>
      </div>
      <label className="mx-0.5 mb-2 flex h-8 items-center gap-2 rounded-[7px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
        <Glyph name="query" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search chats")} aria-label={t("Search chats")} dir="auto" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
      </label>
      <ThreadList activeId={activeId} query={q} />
    </div>
  );
}

/** Conversation header: title, context line, ⋯ (thread actions + close). */
function ConvHeader({ phone, thread, live }: { phone: boolean; thread: ChatThread | undefined; live: Live | null }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const st = useAsk();
  const ctx = phone ? "" : contextLine(thread, live);
  const title = st.picking ? t("Tutor") : thread?.title ?? t("New chat");
  const item = "flex h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg";
  const tail = <><button role="menuitem" className={item} onClick={() => newChat()}><Glyph name="plus" size={13} />{t("New chat")}</button><button role="menuitem" className={item} onClick={closeAsk}><Glyph name="x" size={13} />{t("Close Ask")}</button></>;
  return (
    <div className={cx("relative flex shrink-0 items-center gap-2.5 border-b border-line", phone ? "h-14 px-3" : "h-[52px] px-6")} data-ask-header>
      {phone && <button aria-label={t("Close")} onClick={closeAsk} className="flex size-7 items-center justify-center text-[18px]"><span aria-hidden>{isRtl() ? "→" : "←"}</span></button>}
      {renaming && thread ? (
        <input autoFocus dir="auto" defaultValue={thread.title} aria-label={t("Rename")} className="h-8 min-w-0 flex-1 rounded-[7px] border border-accent bg-bg px-2 font-semibold outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); } }}
          onBlur={(e) => { void renameThread(thread.id, e.target.value); setRenaming(false); }} />
      ) : <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{title}</span>}
      {ctx && <span className="whitespace-nowrap text-[12px] text-muted" data-context>{ctx}</span>}
      {phone && <button aria-label={t("Chats")} onClick={() => setAsk({ list: true })} className="flex size-9 items-center justify-center"><Glyph name="v-list" size={18} /></button>}
      <div className="relative">
        <button aria-label={t("More")} aria-haspopup="menu" onClick={() => setMenu((m) => !m)} className="flex size-7 items-center justify-center rounded-[7px] text-[16px] text-muted hover:bg-surface-2 hover:text-ink"><span aria-hidden>⋯</span></button>
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

/** Full Ask (palette → "Ask your notes…"): a page beside the sidebar on desktop, full screen on phone. */
export function AskSheet() {
  const st = useAsk();
  const ui = useUI();
  const v = useVault();
  useLang();
  const note = ui.view === "notes" && ui.noteId ? v.byId.get(ui.noteId) : undefined;
  const [inset, setInset] = useState(0);
  const phone = usePhone();
  const thread = useThread(st.activeId);
  const live = st.live && (!thread || st.live.threadId === thread.id) ? st.live : null;
  useEffect(() => {
    if (!st.open) return;
    // keep the app's sidebar (rail) visible: start where it ends (mirrored in RTL)
    const measure = () => setInset(sidebarInset());
    measure();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) { if (getAsk().list) setAsk({ list: false }); else closeAsk(); } };
    addEventListener("keydown", k); addEventListener("resize", measure);
    return () => { removeEventListener("keydown", k); removeEventListener("resize", measure); };
  }, [st.open]);
  if (!st.open) return null;
  const tutor = !!thread && thread.mode !== "ask";
  if (phone) return (
    <div role="dialog" aria-label={t("Ask")} className="fixed inset-0 z-50 flex flex-col bg-bg text-[13px] fade-in" data-r6-layer>
      {!tutor && <ConvHeader phone thread={thread} live={live} />}
      <div className="flex min-h-0 flex-1 flex-col"><AskVault note={note} autoFocus onOpened={closeAsk} layout="sheet" /></div>
      {st.list && (
        <div className="fixed inset-0 z-50 bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setAsk({ list: false })}>
          <div className="absolute inset-x-0 bottom-0 flex h-[78%] flex-col gap-2 rounded-t-[14px] bg-surface px-3 pt-2" role="dialog" aria-label={t("Chats")}>
            <span className="flex justify-center pb-1"><span className="h-1 w-9 rounded-[2px] bg-line" /></span>
            <div className="flex items-center gap-2 px-1"><span className="flex-1 text-[16px] font-[650]">{t("Chats")}</span>
              <button onClick={() => newChat()} className="flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3"><span aria-hidden>+</span>{t("New")}</button>
              <button aria-label={t("Close")} onClick={() => setAsk({ list: false })} className="flex size-9 items-center justify-center"><Glyph name="x" size={16} /></button></div>
            <ThreadList activeId={st.activeId} />
          </div>
        </div>
      )}
    </div>
  );
  return (
    <div role="dialog" aria-label={t("Ask")} className="fixed inset-y-0 z-50 flex bg-bg text-[13px] fade-in" style={{ insetInlineStart: inset, insetInlineEnd: 0 }} data-r6-layer>
      {!tutor && <ThreadColumn activeId={st.activeId} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!tutor && <ConvHeader phone={false} thread={thread} live={live} />}
        <AskVault note={note} autoFocus onOpened={closeAsk} layout="page" />
      </div>
    </div>
  );
}

/** Ask page "Tutor mode" switch (kept under the old name for callers). */
export const ModeSwitch = ({ tutor }: { tutor: boolean }) => <TutorToggle on={tutor} />;
