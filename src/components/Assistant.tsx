// Note Assistant — design round 6, Lumen 31 (NoteTabsDesk): R6-31M…T. Right panel (360 px) or phone sheet (72 % height,
// drag up for full screen). Context chips say what it can read (This note · Selection · added notes / PDFs, "+ Add");
// answers use the Ask chat engine scoped to the note (lib/ask.ts slot "assistant": retrieval in the note + its links,
// the selection as passage 1), are cited, and can be inserted below, replace the selection, become a flashcard or be
// copied. Quick actions show their typical neuron cost; the usage chip shows today's free AI (lib/ai-usage.ts, part B).
// States: empty (quick actions), daily limit reached (red chip, dimmed actions, "Back tomorrow", See usage), offline,
// collapsed to the rail (one click reopens; Ctrl/⌘ J toggles). "Only from my notes" (on by default) off = answers may
// fall back to general knowledge, labelled.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, ChatThread, Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { autoVersion } from "../lib/auto-versions";
import { aiRun, getToken } from "../lib/api";
import { getUsage, limitState, TYPICAL, useAiUsage, usedPct } from "../lib/ai-usage";
import { useFaults } from "../lib/sim/faults";
import { getAsk, msg, newThread, openThread, saveThread, sendChat, setAsk, stopChat, updateThread, useAsk, type Live, type Scope } from "../lib/ask";
import { citedIn } from "../lib/chat";
import { db, DEMO } from "../lib/db";
import { fmtDate, fmtNum, isRtl, t, useLang } from "../lib/i18n";
import { splitFrontMatter } from "../lib/parse";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { RichAnswer, useAiLocked, useOnline } from "./ChatParts";
import { getActiveEditor, getSelectionText } from "./Editor";
import { Glyph } from "./Glyph";
import { openSettings } from "./ShareSheet";
import { VoiceButton } from "./TutorSession";
import { cx } from "./ui";

// ------------------------------------------------------------------ rail state (collapsed) + ⌘J
const RAIL_KEY = "lumen.assistant.rail";
let rail = (() => { try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; } })();
const railSubs = new Set<() => void>();
const setRail = (on: boolean) => { rail = on; try { localStorage.setItem(RAIL_KEY, on ? "1" : "0"); } catch { /* ignore */ } railSubs.forEach((f) => f()); };
export const useAssistantRail = () => useSyncExternalStore((f) => (railSubs.add(f), () => { railSubs.delete(f); }), () => rail);
/** Header button: open the Assistant (as the rail when the owner last collapsed it), or close it. */
export function toggleAssistantPanel(open: boolean) { setUI({ panel: open ? "ai" : null }); }
/** Ctrl/⌘ J: expanded ↔ rail (opens it when closed). */
export function toggleAssistantRail(panelOpen: boolean) { if (panelOpen && !rail) setRail(true); else { setRail(false); setUI({ panel: "ai" }); } }

const ONLY_KEY = "lumen.assistant.onlyNotes";
const MODEL = "Llama 3.3 70B";

// ------------------------------------------------------------------ helpers
/** The selection in the note (preview or editor), never one inside the Assistant itself. */
const selectedText = () => {
  const s = typeof getSelection === "function" ? getSelection() : null;
  const inPanel = !!s?.anchorNode && !!(s.anchorNode.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode.parentElement)?.closest("[data-assistant]");
  const dom = !inPanel ? s?.toString() ?? "" : "";
  return dom.trim() ? dom : inPanel ? "" : getSelectionText();
};
const parseCards = (s: string) => s.split("\n").map((l) => /^\s*(?:[-*\d.)]+\s*)?(.+?)\s*::\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ q: m[1].replace(/\*\*/g, ""), a: m[2] }));
const parseTags = (s: string) => [...new Set((s.match(/#?[\p{L}\p{N}][\p{L}\p{N}_/-]*/gu) ?? []).map((x) => x.replace(/^#/, "").toLowerCase()))].slice(0, 8);
/** Append flashcards under a "## Flashcards" heading (created if missing) so Review picks them up. */
export function withCards(body: string, cards: { q: string; a: string }[]) {
  const lines = cards.map((c) => `${c.q} :: ${c.a}`);
  const m = /^##\s+Flashcards\s*$/im.exec(body);
  if (!m) return `${body.replace(/\s*$/, "")}\n\n## Flashcards\n\n${lines.join("\n")}\n`;
  const start = m.index + m[0].length;
  const next = body.slice(start).search(/\n#{1,2}\s/);
  const end = next < 0 ? body.length : start + next;
  return `${body.slice(0, end).replace(/\s*$/, "")}\n${lines.join("\n")}\n${body.slice(end)}`;
}
const plain = (s: string) => s.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, "").replace(/\s+\./g, ".").trim();

interface Quick { id: string; glyph: string; label: string; cost: string }
const QUICK = (): Quick[] => [
  { id: "summarize", glyph: "c-abstract", label: t("Summarize this note"), cost: "~120" },
  { id: "flashcards", glyph: "flashcards", label: t("Make flashcards"), cost: TYPICAL.flashcards ?? "~180" },
  { id: "explain", glyph: "c-question", label: t("Explain the selection"), cost: TYPICAL.explain ?? "~150" },
  { id: "tags", glyph: "tag", label: t("Suggest tags"), cost: TYPICAL.tags ?? "~40" },
  { id: "quiz", glyph: "c-question", label: t("Quiz me"), cost: TYPICAL.quiz ?? "~200" },
  { id: "diagram", glyph: "diagrams-tab", label: t("Draw a diagram of this"), cost: "~160" },
];
/** Demo without a Worker: deterministic stand-ins built from the note, so every action can be tried. */
function demoRun(action: string, text: string, title: string) {
  const sents = text.replace(/[#>*_`|-]/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30).slice(0, 6);
  if (action === "flashcards") return sents.slice(0, 4).map((s, i) => `${title} (${i + 1})? :: ${s}`).join("\n");
  if (action === "tags") return "#" + [...new Set(title.toLowerCase().split(/\W+/).filter((w) => w.length > 3))].slice(0, 4).join(" #");
  if (action === "quiz") return sents.slice(0, 3).map((s, i) => `${i + 1}. What does your note say about: ${s.split(" ").slice(0, 6).join(" ")}…?`).join("\n") + "\n\n**Answers**\n" + sents.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join("\n");
  if (action === "diagram") return "```mermaid\nflowchart LR\n  A[" + title.replace(/[[\]]/g, "") + "] --> B[Key idea]\n  B --> C[Example]\n  B --> D[Why it matters]\n```";
  return (action === "explain" ? "**In simple terms (demo).** " : "**Summary (demo).**\n\n") + sents.slice(0, 3).map((s) => `- ${s}`).join("\n");
}

// ------------------------------------------------------------------ the panel
export function AssistantPanel({ note, phone }: { note: Note; phone: boolean }) {
  useLang();
  const v = useVault();
  const st = useAsk();
  const online = useOnline();
  const usage = useAiUsage();
  const ls = limitState(usage);
  const [onlyNotes, setOnly] = useState(() => { try { return localStorage.getItem(ONLY_KEY) !== "0"; } catch { return true; } });
  const [sel, setSel] = useState<string>("");
  const [useSel, setUseSel] = useState(true);
  const [useNote, setUseNote] = useState(true);
  const [extra, setExtra] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [hist, setHist] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const locked = useAiLocked();

  // this note's assistant conversations (newest first); the active one follows the note
  const threads = useLiveQuery(() => db.chats.filter((x) => !x.deleted && x.assistant === 1 && x.noteId === note.id).toArray(), [note.id]) ?? [];
  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  useEffect(() => {
    let live = true;
    void db.chats.filter((x) => !x.deleted && x.assistant === 1 && x.noteId === note.id).toArray().then((ts) => {
      if (!live) return;
      const cur = getAsk().aActive;
      if (!ts.some((x) => x.id === cur)) openThread(ts.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null, "assistant");
    });
    setExtra([]); setUseNote(true);
    return () => { live = false; };
  }, [note.id]);
  const thread = useLiveQuery(() => (st.aActive ? db.chats.get(st.aActive) : undefined), [st.aActive]);
  const live = st.aLive && (!thread || st.aLive.threadId === thread.id) ? st.aLive : null;
  const running = !!live && ["indexing", "rewriting", "asking", "streaming"].includes(live.status);
  const msgs = thread && !thread.deleted ? thread.messages : [];
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, live?.text, busy]);

  // the selection in the note (editor or preview) becomes a context chip
  useEffect(() => {
    const f = () => { const s = selectedText().trim(); if (s && s.length > 2) { setSel(s.slice(0, 1500)); setUseSel(true); } };
    document.addEventListener("selectionchange", f);
    document.addEventListener("keyup", f);
    f();
    return () => { document.removeEventListener("selectionchange", f); document.removeEventListener("keyup", f); };
  }, []);
  useEffect(() => { setSel(""); }, [note.id]);

  // linked PDFs / notes offered as context (the design's third chip), plus anything added with "+ Add"
  const extraNotes = extra.map((id) => v.byId.get(id)).filter((n): n is Note => !!n);
  const faults = useFaults();
  useEffect(() => { void getUsage(true); }, [faults.ai]);
  const limited = online && (ls === "reached" || (DEMO && faults.ai === "quota") || live?.status === "limit");
  const dim = limited || !online || locked;
  const scope: Scope = useNote ? { kind: "note", noteId: note.id } : extraNotes.length ? { kind: "note", noteId: extraNotes[0].id } : { kind: "vault" };
  const send = (q: string) => {
    if (!q.trim() || dim || running) return;
    void sendChat(q, v, {
      slot: "assistant", scope, assistantFor: note.id, allowGeneral: !onlyNotes, extraNotes: extra,
      pinned: useSel && sel ? [{ noteId: note.id, title: t("This note"), heading: `“${sel.slice(0, 26)}${sel.length > 26 ? "…" : ""}”`, text: sel }] : undefined,
    });
  };

  // quick actions (the note-level AI actions, kept in the conversation)
  const ensureThread = async (title: string): Promise<ChatThread> => {
    const cur = st.aActive ? await db.chats.get(st.aActive) : undefined;
    if (cur && !cur.deleted) return cur;
    const th = await saveThread(newThread({ title, mode: "ask", scope: { kind: "note", noteId: note.id }, noteId: note.id, assistant: 1 }));
    openThread(th.id, "assistant");
    return th;
  };
  const quick = async (q: Quick) => {
    if (dim || busy) return;
    const s = selectedText().trim() || sel;
    if (q.id === "explain" && !s) { toast(t("Select some text in the note first.")); return; }
    const text = q.id === "explain" ? s : splitFrontMatter(note.body).body;
    if (!text.trim()) { toast(t("Note is empty")); return; }
    setBusy(q.id);
    try {
      const th = await ensureThread(q.label);
      await updateThread(th.id, (x) => { x.messages.push(msg("user", q.label)); });
      const out = DEMO && !getToken() ? (await new Promise((r) => setTimeout(r, 500)), demoRun(q.id, text, note.title)) : await aiRun(q.id, text);
      if (DEMO && !getToken()) window.dispatchEvent(new CustomEvent("lumen:ai", { detail: { path: "/ai", status: 200, action: q.id } }));
      await updateThread(th.id, (x) => { x.messages.push(msg("assistant", out.trim(), { action: q.id, sources: [{ n: 1, noteId: note.id, title: t("This note"), text: (q.id === "explain" ? s : note.title).slice(0, 300) }] })); });
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  // palette "Generate flashcards from …" opens the Assistant and runs it once
  useEffect(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem("lumen.aiAuto") ?? "null") as { id: string; action: string } | null;
      if (r?.id === note.id) { sessionStorage.removeItem("lumen.aiAuto"); const q = QUICK().find((x) => x.id === r.action); if (q) void quick(q); }
    } catch { /* ignore */ }
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (glyph: string, label: string, color: string, onX: () => void, key: string) => (
    <span key={key} className="flex h-6 max-w-full items-center gap-[5px] whitespace-nowrap rounded-[6px] pe-1 ps-2 text-[12px]" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }} data-ctx={key}>
      <Glyph name={glyph} size={12} /><span dir="auto" className="truncate">{label}</span>
      <button aria-label={t("Remove {name} from context", { name: label })} onClick={onX} className="opacity-60 hover:opacity-100"><span aria-hidden>×</span></button>
    </span>
  );
  const pct = usedPct(usage);
  const resetIn = usage ? Math.max(0, usage.resetAt - Date.now()) : 0;
  const hrs = Math.floor(resetIn / 3_600_000), mins = Math.floor((resetIn % 3_600_000) / 60_000);
  const stateCard = (glyph: string, color: string, title: string, desc: string, action: string, onA: () => void) => (
    <div className="mt-5 flex flex-col gap-2 rounded-[12px] border p-4" style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 7%, var(--bg))` }} data-assistant-state>
      <Glyph name={glyph} size={20} color={color} />
      <b className="font-semibold">{title}</b><span className="leading-[19px] text-muted">{desc}</span>
      <button onClick={onA} className="flex h-[30px] items-center self-start rounded-[8px] border border-line px-2.5 hover:bg-surface-2">{action}</button>
    </div>
  );
  const showEmpty = !msgs.length && !live && !busy;

  const body = (
    <>
      {/* header */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line pe-2.5 ps-3.5">
        <Glyph name="assistant" size={17} color="var(--accent)" />
        <b className="flex-1 font-semibold">{t("Assistant")}</b>
        <button onClick={() => openSettings("ai")} title={t("Today's free AI · Settings › AI usage")} className="flex h-[22px] items-center gap-[5px] rounded-full px-2 text-[11.5px] font-semibold"
          style={{ background: `color-mix(in srgb, ${limited ? "var(--danger)" : ls === "near" ? "var(--warning)" : "var(--accent)"} 14%, transparent)`, color: limited ? "var(--danger)" : ls === "near" ? "var(--warning)" : "var(--accent)" }} data-usage>
          <Glyph name="meter" size={12} />{limited ? t("Limit") : `${fmtNum(pct)}%`}
        </button>
        <div className="relative">
          <button aria-label={t("Conversations")} aria-expanded={hist} onClick={() => setHist((h) => !h)} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="history" size={15} /></button>
          {hist && (<><div className="fixed inset-0 z-30" onClick={() => setHist(false)} />
            <div role="menu" className="absolute end-0 top-[calc(100%+4px)] z-40 flex max-h-[320px] w-[260px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]" onClick={() => setHist(false)}>
              <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg" onClick={() => openThread(null, "assistant")}><Glyph name="plus" size={13} />{t("New conversation")}</button>
              {threads.map((x) => (
                <button key={x.id} role="menuitem" className="flex min-h-8 items-center gap-2 rounded-[6px] px-2 text-start hover:bg-bg" style={x.id === st.aActive ? { background: "var(--bg)" } : undefined} onClick={() => openThread(x.id, "assistant")}>
                  <span dir="auto" className="min-w-0 flex-1 truncate">{x.title}</span><span className="text-[11px] text-muted">{fmtDate(x.updatedAt, { day: "numeric", month: "short" })}</span>
                </button>
              ))}
              {!threads.length && <span className="px-2 py-1.5 text-muted">{t("No earlier conversations about this note.")}</span>}
              <button role="menuitem" className="flex h-8 items-center gap-2 rounded-[6px] px-2 text-start text-link hover:bg-bg" onClick={() => { setAsk({ open: true }); if (st.aActive) openThread(st.aActive); }}>{t("Open in Ask")}</button>
            </div></>)}
        </div>
        {phone
          ? <button aria-label={t("Close")} onClick={() => setUI({ panel: null })} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2"><Glyph name="x" size={15} /></button>
          : <>
            <button aria-label={t("Collapse to the rail (Ctrl+J)")} title={t("Collapse (Ctrl+J)")} onClick={() => setRail(true)} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="rail" size={15} /></button>
            <button aria-label={t("Close panel")} title={t("Close panel")} onClick={() => setUI({ panel: null })} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={15} /></button>
          </>}
      </div>
      {/* context chips */}
      <div className="relative flex shrink-0 flex-wrap gap-1.5 border-b border-line px-3 py-2" data-context-chips>
        {useNote && chip("lesson", t("This note"), "var(--accent)", () => setUseNote(false), "note")}
        {sel && useSel && chip("quote", t("Selection"), "var(--info)", () => setUseSel(false), "selection")}
        {extraNotes.map((n) => chip(n.type === "pdf" ? "pdf" : n.type || "note", n.title, "var(--muted)", () => setExtra((e) => e.filter((x) => x !== n.id)), n.id))}
        <button onClick={() => setAdding((a) => !a)} className="flex h-6 items-center rounded-[6px] border border-dashed border-line px-2 text-[12px] text-muted hover:text-ink" data-act="add-context">{t("+ Add")}</button>
        {adding && <AddContext note={note} onPick={(id) => { setExtra((e) => (e.includes(id) ? e : [...e, id])); setAdding(false); }} onClose={() => setAdding(false)} />}
      </div>
      {/* conversation */}
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {(showEmpty || limited) && !msgs.length && (
          <div className="flex flex-col gap-2.5 pt-1.5" data-assistant-empty>
            <span className="leading-[19px] text-muted">{t("Ask about this note, or start from one of these. Answers cite your notes.")}</span>
            {QUICK().map((q) => (
              <button key={q.id} onClick={() => void quick(q)} disabled={dim || !!busy} className="flex h-[38px] items-center gap-2.5 rounded-[9px] border border-line bg-bg px-2.5 text-start hover:bg-surface-2 disabled:cursor-not-allowed" style={{ opacity: limited ? 0.4 : 1 }} data-quick={q.id}>
                <Glyph name={q.glyph} size={15} color="var(--muted)" /><span className="flex-1">{busy === q.id ? t("Working…") : q.label}</span><span className="text-[11px] text-muted" title={t("Typical cost in neurons")}>{q.cost.replace(/ neurons$/, "")}</span>
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => m.role === "user"
          ? <div key={m.id} dir="auto" className="max-w-[85%] self-end whitespace-pre-wrap rounded-[12px] bg-surface-2 px-3 py-2 leading-[19px]">{m.text}</div>
          : <AnswerBlock key={m.id} m={m} note={note} last={i === msgs.length - 1 && !live} threadId={thread!.id} onRetryGeneral={() => send([...msgs.slice(0, i)].reverse().find((x) => x.role === "user")?.text ?? "")} />)}
        {busy && <span className="text-muted" role="status">{t("Working…")}</span>}
        {live && <LiveBlock live={live} />}
        {limited && stateCard("limit", "var(--danger)", t("Daily free AI limit reached. Try tomorrow."), t("Resets in {h} h {m} min (00:00 UTC). Nothing is charged. Search, review and everything else still work.", { h: hrs, m: mins }), t("See usage"), () => openSettings("ai"))}
        {!limited && !online && stateCard("c-info", "var(--info)", t("The assistant needs a connection"), t("It runs on your Cloudflare. Your notes, search and review keep working offline."), t("Retry"), () => { if (navigator.onLine) location.reload(); else toast(t("Still offline.")); })}
        {!limited && online && locked && stateCard("s-locked", "var(--muted)", t("Unlock to use the assistant"), t("The assistant runs on your Cloudflare and needs this device to be unlocked."), t("Unlock"), () => openSettings("sync"))}
      </div>
      {/* composer */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-3 py-2.5">
        <Composer disabled={dim} running={running} placeholder={limited ? t("Back tomorrow") : !online ? t("Offline") : locked ? t("Locked") : t("Ask about this note…")} onSend={send} />
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <button role="switch" aria-checked={onlyNotes} aria-label={t("Only from my notes")} onClick={() => { setOnly((o) => { try { localStorage.setItem(ONLY_KEY, o ? "0" : "1"); } catch { /* ignore */ } return !o; }); }}
            className="relative h-4 w-7 shrink-0 rounded-[8px]" style={{ background: onlyNotes ? "var(--accent)" : "var(--border)" }}>
            <span className="absolute top-[2px] size-3 rounded-full" style={{ insetInlineStart: onlyNotes ? 14 : 2, background: onlyNotes ? "var(--accent-fg)" : "var(--muted)" }} />
          </button>
          <span>{t("Only from my notes")}</span><span className="flex-1" /><span className="min-w-0 text-start">{t("{model} · your Cloudflare", { model: MODEL })}</span>
        </div>
      </div>
    </>
  );

  if (phone) return (
    <div className="fixed inset-0 z-40 bg-[rgba(5,6,8,.35)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setUI({ panel: null })}>
      <div role="dialog" aria-label={t("Assistant")} className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[14px] border-t border-line bg-surface text-[13px] transition-[height]" style={{ height: full ? "100%" : "72%" }} data-assistant="sheet">
        <button aria-label={full ? t("Shrink") : t("Full screen")} className="flex shrink-0 justify-center pt-2" onClick={() => setFull((f) => !f)}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.y = String(e.touches[0].clientY); }}
          onTouchEnd={(e) => { const y0 = Number((e.currentTarget as HTMLElement).dataset.y || 0); const dy = e.changedTouches[0].clientY - y0; if (dy < -40) setFull(true); else if (dy > 60) (full ? setFull(false) : setUI({ panel: null })); }}>
          <span className="h-1 w-9 rounded-[2px] bg-line" />
        </button>
        {body}
      </div>
    </div>
  );
  return <aside className="flex w-[360px] shrink-0 flex-col border-s border-line bg-surface text-[13px] fade-in" aria-label={t("Assistant")} data-assistant="panel">{body}</aside>;
}

function Composer({ disabled, running, placeholder, onSend }: { disabled: boolean; running: boolean; placeholder: string; onSend: (q: string) => void }) {
  const st = useAsk();
  const ref = useRef<HTMLTextAreaElement>(null);
  const go = () => { if (st.aDraft.trim()) onSend(st.aDraft); };
  return (
    <div className="flex min-h-[42px] items-center gap-2 rounded-[10px] border border-line bg-bg pe-1.5 ps-3 focus-within:border-accent" style={{ opacity: disabled ? 0.5 : 1 }} data-assistant-composer>
      <textarea ref={ref} dir="auto" rows={1} value={disabled ? "" : st.aDraft} disabled={disabled} onChange={(e) => setAsk({ aDraft: e.target.value })} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } if (e.key === "Escape" && running) { e.stopPropagation(); stopChat("assistant"); } }}
        className="max-h-[140px] min-h-[20px] flex-1 resize-none bg-transparent py-2.5 leading-[20px] !outline-none placeholder:text-muted" style={{ fieldSizing: "content" } as CSSProperties} />
      {!disabled && <VoiceButton size={30} onText={(x) => setAsk({ aDraft: (getAsk().aDraft ? getAsk().aDraft + " " : "") + x })} />}
      {disabled && <span className="flex size-[30px] items-center justify-center text-muted"><Glyph name="voice" size={15} /></span>}
      {running
        ? <button aria-label={t("Stop")} onClick={() => stopChat("assistant")} className="flex size-[30px] items-center justify-center rounded-[8px] border border-line text-[11px]"><span aria-hidden>■</span></button>
        : <button aria-label={t("Send")} onClick={go} disabled={disabled} className="flex size-[30px] items-center justify-center rounded-[8px] bg-accent font-bold text-accent-fg disabled:opacity-80"><span aria-hidden>{isRtl() ? "←" : "→"}</span></button>}
    </div>
  );
}

/** Cited sources under an answer: "1 · This note › “The √d scaling…”". */
function Citations({ m }: { m: ChatMessage }) {
  const used = citedIn(m.text);
  const list = (m.sources ?? []).filter((s) => !used.size || used.has(s.n));
  if (!list.length || m.general) return null;
  return (
    <div className="flex flex-col gap-1 text-[12px]" data-citations>
      {list.map((s) => <button key={s.n} onClick={() => openNote(s.noteId)} dir="auto" className="truncate text-start text-link hover:underline">{s.n} · {s.title}{s.heading ? ` › ${s.heading}` : ""}</button>)}
    </div>
  );
}

function AnswerBlock({ m, note, last, threadId, onRetryGeneral }: { m: ChatMessage; note: Note; last: boolean; threadId: string; onRetryGeneral: () => void }) {
  const [hasSel, setHasSel] = useState(false);
  useEffect(() => { const f = () => setHasSel(!!getSelectionText()); f(); document.addEventListener("selectionchange", f); return () => document.removeEventListener("selectionchange", f); }, []);
  const md = plain(m.text);
  const btn = "flex h-7 items-center gap-[5px] rounded-[7px] border border-line px-[9px] hover:bg-surface-2 disabled:opacity-50";
  const insertBelow = async () => {
    await autoVersion("ai", note.id); // Settings › Versions: a version before an AI edit is applied
    const block = `\n\n${md}\n`;
    const ed = getActiveEditor();
    if (ed) { const { to } = ed.state.selection.main; const line = ed.state.doc.lineAt(to); ed.dispatch({ changes: { from: line.to, insert: block }, selection: { anchor: line.to + block.length } }); ed.focus(); }
    else { const n = await db.notes.get(note.id); if (n) await updateNote(n.id, { body: n.body.replace(/\s*$/, "") + block }); }
    toast(t("Inserted below"));
  };
  const replaceSel = () => {
    const ed = getActiveEditor();
    if (!ed || ed.state.selection.main.empty) { toast(t("Select text in the editor to replace.")); return; }
    void autoVersion("ai", note.id);
    const { from, to } = ed.state.selection.main;
    ed.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
    ed.focus();
    toast(t("Selection replaced"));
  };
  const asCard = async () => {
    const thread = await db.chats.get(threadId);
    const i = thread?.messages.findIndex((x) => x.id === m.id) ?? -1;
    const q = [...(thread?.messages.slice(0, i) ?? [])].reverse().find((x) => x.role === "user")?.text ?? note.title;
    const cards = m.action === "flashcards" ? parseCards(m.text) : [{ q: q.replace(/\n/g, " ").replace(/::/g, ":"), a: md.split(/(?<=[.!?])\s+/)[0].replace(/\n/g, " ").replace(/::/g, ":").slice(0, 300) }];
    const n = await db.notes.get(note.id);
    if (n && cards.length) await updateNote(n.id, { body: withCards(n.body, cards) });
    toast(t("{n} flashcard added under “Flashcards”|{n} flashcards added under “Flashcards”", { n: cards.length }));
  };
  const addTags = async () => { const tags = parseTags(m.text); await updateNote(note.id, { tags: [...new Set([...note.tags, ...tags])] }); toast(t("Added {n} tag|Added {n} tags", { n: tags.length })); };
  const copy = async () => { try { await navigator.clipboard.writeText(md); toast(t("Copied")); } catch { toast(t("Couldn't copy")); } };
  if (m.empty === "none") return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3" data-msg="empty">
      <span className="font-semibold">{t("Not in this note or its links.")}</span>
      <span className="text-muted">{t("Turn off “Only from my notes” to allow a general-knowledge answer, or add more notes with + Add.")}</span>
      {last && <button onClick={onRetryGeneral} className="flex h-7 items-center self-start rounded-[7px] border border-line px-2.5 text-warn hover:bg-surface-2">{t("Ask again")}</button>}
    </div>
  );
  const tags = m.action === "tags" ? parseTags(m.text) : [];
  return (
    <div className="flex flex-col gap-2 leading-[20px]" data-msg="assistant">
      {m.general && <span className="self-start rounded-[6px] px-2 text-[12px] font-semibold leading-[22px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }}>{t("Not from your notes · general knowledge")}</span>}
      {tags.length ? <div className="flex flex-wrap gap-1.5">{tags.map((x) => <span key={x} className={cx("rounded-full px-2 py-0.5 text-[12px]", note.tags.includes(x) ? "bg-surface-2 text-muted" : "text-link")} style={note.tags.includes(x) ? undefined : { background: "color-mix(in srgb, var(--link) 14%, transparent)" }}>#{x}</span>)}</div>
        : <div className="r6-assist"><RichAnswer text={m.text} sources={m.sources ?? []} size={13} ui onOpen={(id) => openNote(id)} /></div>}
      <Citations m={m} />
      <div className="flex flex-wrap gap-1.5">
        {m.action === "tags" ? <button onClick={() => void addTags()} className={btn}><Glyph name="tag" size={13} />{t("Add tags")}</button>
          : <button onClick={() => void insertBelow()} className={btn} data-act="insert-below"><Glyph name="insert" size={13} />{t("Insert below")}</button>}
        {m.action !== "tags" && <button onClick={replaceSel} disabled={!hasSel} title={hasSel ? undefined : t("Select text in the editor first")} className={btn} data-act="replace"><Glyph name="replace" size={13} />{t("Replace selection")}</button>}
        {m.action !== "tags" && <button onClick={() => void asCard()} className={btn} data-act="card"><Glyph name="flashcards" size={13} />{m.action === "flashcards" ? t("Add cards") : t("Card")}</button>}
        <button aria-label={t("Copy")} onClick={() => void copy()} className={cx(btn, "w-7 justify-center px-0")}><Glyph name="copy" size={13} /></button>
      </div>
    </div>
  );
}

function LiveBlock({ live }: { live: Live }) {
  const status: Record<string, ReactNode> = {
    indexing: t("Reading this note and its links…"), rewriting: t("Understanding the follow-up…"), asking: live.general ? t("Answering from general knowledge…") : t("Answering from {n} passages…", { n: live.sources.length }),
  };
  return (
    <div className="flex flex-col gap-2 leading-[20px]" aria-live="polite" data-msg="live" data-status={live.status}>
      {status[live.status] && !live.text && <span className="text-muted">{status[live.status]}</span>}
      {live.general && live.text && <span className="self-start rounded-[6px] px-2 text-[12px] font-semibold leading-[22px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }}>{t("Not from your notes · general knowledge")}</span>}
      {live.text && <div className="r6-assist"><RichAnswer text={live.text} sources={live.sources} streaming={live.status === "streaming"} size={13} ui onOpen={(id) => openNote(id)} /></div>}
      {live.status === "error" && <span className="text-bad">{live.error === "Stopped before an answer." ? t("Stopped before an answer.") : t("Something went wrong while answering.")}</span>}
      {live.status === "signedout" && <span className="text-muted">{t("Unlock sync to use the assistant on this device.")}</span>}
      {live.status === "offline" && <span className="text-muted">{t("The assistant needs a connection.")}</span>}
    </div>
  );
}

/** "+ Add": pick another note or PDF the assistant may read. */
function AddContext({ note, onPick, onClose }: { note: Note; onPick: (id: string) => void; onClose: () => void }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const linked = useMemo(() => [...(v.outlinks.get(note.id) ?? [])].map((id) => v.byId.get(id)).filter((n): n is Note => !!n && !n.deleted), [v, note.id]);
  const ql = q.trim().toLowerCase();
  const list = (ql ? v.notes.filter((n) => !n.deleted && n.id !== note.id && n.title.toLowerCase().includes(ql)) : linked).slice(0, 8);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute start-3 top-[calc(100%-2px)] z-40 flex w-[280px] flex-col gap-1 rounded-[10px] border border-line bg-surface-2 p-1.5 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a note or PDF…")} aria-label={t("Find a note or PDF")} dir="auto" className="h-8 rounded-[7px] border border-line bg-bg px-2 outline-none focus:border-accent" />
        {!ql && <span className="px-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Linked from this note")}</span>}
        {list.map((n) => <button key={n.id} onClick={() => onPick(n.id)} className="flex h-8 items-center gap-2 rounded-[6px] px-1.5 text-start hover:bg-bg"><Glyph name={n.type || "note"} size={13} color="var(--muted)" /><span dir="auto" className="min-w-0 flex-1 truncate">{n.title}</span></button>)}
        {!list.length && <span className="px-1.5 py-1 text-muted">{ql ? t("No note matches.") : t("This note links to no other notes.")}</span>}
      </div>
    </>
  );
}

/** Collapsed Assistant (R6-31R): 44 px rail. One click reopens; the other icons open Outline / Links / Versions. */
export function AssistantRail() {
  useLang();
  const b = "flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-s border-line bg-surface pt-2.5" aria-label={t("Assistant (collapsed)")} data-assistant="rail">
      <button aria-label={t("Open the assistant (Ctrl+J)")} title={t("Assistant (Ctrl+J)")} onClick={() => setRail(false)} className="flex size-8 items-center justify-center rounded-[8px]" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}><Glyph name="assistant" size={17} color="var(--accent)" /></button>
      <button aria-label={t("Outline")} title={t("Outline")} onClick={() => { setRail(false); setUI({ panel: "outline" }); }} className={b}><Glyph name="toc" size={16} /></button>
      <button aria-label={t("Links")} title={t("Links")} onClick={() => { setRail(false); setUI({ panel: "backlinks" }); }} className={b}><Glyph name="wikilink" size={16} /></button>
      <button aria-label={t("Versions")} title={t("Versions")} onClick={() => { setRail(false); setUI({ panel: "versions" }); }} className={b}><Glyph name="history" size={16} /></button>
      {/* close; the collapsed preference is kept, so the header button reopens the rail */}
      <button aria-label={t("Close panel")} title={t("Close panel")} onClick={() => setUI({ panel: null })} className={b}><Glyph name="x" size={16} /></button>
    </div>
  );
}
