import { ArrowLeft, ArrowUp, BookOpenText, Check, Copy, FilePlus2, History, Loader2, MessagesSquare, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { getToken } from "../lib/api";
import { ask, citedNumbers, closeAsk, NEEDS_SIGNIN, scopeLabel, setAsk, showTurn, stopAsk, useAsk, type AskTurn, type Retrieved, type Scope, type ScopeKind } from "../lib/ask";
import { render } from "../lib/markdown";
import { openNote, toast, useUI, useVault, type Vault } from "../lib/store";
import { plainText } from "./nav-text";
import { cx } from "./ui";

const SECTION = "px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted";
const EXAMPLES = ["Explain AdamW using my Géron and Coursera notes", "What is batch normalization and why does it help?", "اشرح آلية الانتباه في المحولات"];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** `[1]`, `[2, 3]`, `[1][2]` in the model's answer → placeholders that survive Markdown rendering. */
const markCitations = (md: string) => md.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (_m, list: string) => list.split(",").map((x) => `⟦${x.trim()}⟧`).join(""));

/** Answer Markdown with citations as [[Note]] links (for Copy / Save as note). */
function answerAsMarkdown(t: AskTurn) {
  const by = new Map(t.sources.map((s) => [s.n, s]));
  const body = t.answer.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (m, list: string) => {
    const links = list.split(",").map((x) => by.get(Number(x.trim()))).filter((s): s is Retrieved => !!s);
    return links.length ? links.map((s) => `[[${s.title.replace(/[[\]|#]/g, " ")}|${s.n}]]`).join("") : m;
  });
  const used = citedNumbers(t.answer);
  const srcs = t.sources.filter((s) => used.has(s.n));
  return `${body.trim()}\n\n**Sources**\n${(srcs.length ? srcs : t.sources).map((s) => `${s.n}. [[${s.title.replace(/[[\]|#]/g, " ")}]]${s.heading ? ` › ${s.heading}` : ""}`).join("\n")}\n`;
}

/** Rendered answer: Markdown + KaTeX, citations as numbered wikilink chips (click opens the note). */
function Answer({ turn, onHover, onOpen }: { turn: AskTurn; onHover: (n: number | null) => void; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = useMemo(() => new Map(turn.sources.map((s) => [s.n, s])), [turn.sources]);
  const html = useMemo(() => {
    let h = "";
    try { h = render(markCitations(turn.answer)); } catch { h = `<p>${esc(turn.answer)}</p>`; }
    return h.replace(/⟦(\d+)⟧/g, (_m, d: string) => {
      const s = by.get(Number(d));
      return s
        ? `<a class="wikilink ask-cite" href="#" data-n="${d}" data-note="${esc(s.title)}" title="${esc(s.title + (s.heading ? " › " + s.heading : ""))}">${d}</a>`
        : `<sup class="ask-cite-x">${d}</sup>`;
    });
  }, [turn.answer, by]);
  useEffect(() => { if (ref.current) ref.current.innerHTML = html; }, [html]);
  return (
    <div ref={ref} dir="auto" className={cx("prose ask-answer !text-[13.5px]", turn.status === "streaming" && "ask-streaming")}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>(".ask-cite");
        if (!a) return;
        e.preventDefault();
        const s = by.get(Number(a.dataset.n));
        if (s) onOpen(s.noteId);
      }}
      onMouseOver={(e) => { const a = (e.target as HTMLElement).closest<HTMLElement>(".ask-cite"); onHover(a ? Number(a.dataset.n) : null); }}
      onMouseLeave={() => onHover(null)} />
  );
}

function SourceCard({ s, cited, done, hot, v, onOpen }: { s: Retrieved; cited: boolean; done: boolean; hot: boolean; v: Vault; onOpen: (id: string) => void }) {
  const space = v.spaceMap.get(s.spaceId);
  const snip = useMemo(() => plainText(s.text).replace(/\s+/g, " ").trim().slice(0, 220), [s.text]);
  return (
    <div data-src={s.n} className={cx("group flex gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors", hot ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "border-line bg-surface", done && !cited && "opacity-60")}>
      <span className={cx("mt-px flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold", cited || !done ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent" : "bg-surface-2 text-muted")}>{s.n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button onClick={() => onOpen(s.noteId)} dir="auto" className="line-clamp-2 text-left font-semibold leading-[18px] text-link hover:underline" title={s.title}>[[{s.title}]]</button>
        {(s.heading || space) && <span dir="auto" className="truncate text-[11.5px] text-muted">{[space ? `${space.icon ?? ""} ${space.name}`.trim() : "", s.heading].filter(Boolean).join(" › ")}</span>}
        <span dir="auto" className="line-clamp-3 text-[12.5px] leading-[18px] text-muted">{snip}</span>
      </div>
      <button onClick={() => onOpen(s.noteId)} className="h-7 shrink-0 self-start rounded-[7px] border border-line px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">Open</button>
    </div>
  );
}

function ScopePicker({ scope, setScope, note, v, spaceId }: { scope: Scope; setScope: (s: Scope) => void; note?: Note; v: Vault; spaceId: string }) {
  const paths = useMemo(() => v.notes.filter((n) => n.type === "path"), [v.notes]);
  const space = v.spaceMap.get(spaceId);
  const opts: { kind: ScopeKind; label: string; hint: string; off?: boolean }[] = [
    { kind: "vault", label: "Vault", hint: "Every note" },
    { kind: "space", label: space ? `${space.icon ?? ""} ${space.name}`.trim() : "Space", hint: "Current space", off: !space },
    { kind: "note", label: "Note + links", hint: note ? `${note.title} and the notes it links / that link to it` : "Open a note first", off: !note },
    { kind: "path", label: "Path", hint: "A learning path's courses", off: !paths.length },
  ];
  const pick = (k: ScopeKind) => {
    if (k === "vault") setScope({ kind: "vault" });
    else if (k === "space") setScope({ kind: "space", spaceId });
    else if (k === "note") setScope({ kind: "note", noteId: note?.id });
    else setScope({ kind: "path", pathId: (scope.kind === "path" && scope.pathId) || (note?.type === "path" ? note.id : paths[0]?.id) });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Search in" className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <button key={o.kind} role="radio" aria-checked={scope.kind === o.kind} disabled={o.off} title={o.hint} onClick={() => pick(o.kind)}
            className={cx("h-7 max-w-[160px] truncate rounded-full border px-2.5 text-[12px] disabled:opacity-40", scope.kind === o.kind ? "border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-semibold text-ink" : "border-line text-muted hover:bg-surface-2 hover:text-ink")}>
            {o.label}
          </button>
        ))}
      </div>
      {scope.kind === "path" && paths.length > 0 && (
        <select aria-label="Learning path" value={scope.pathId ?? ""} onChange={(e) => setScope({ kind: "path", pathId: e.target.value })}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink">
          {paths.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * "Ask your vault": question → passages retrieved on this device → grounded answer with numbered citations.
 * Used inside the right panel's AI tab (`note` given) and as the full sheet opened from the palette.
 */
export function AskVault({ note, autoFocus, onOpened }: { note?: Note; autoFocus?: boolean; onOpened?: () => void }) {
  const st = useAsk();
  const v = useVault();
  const ui = useUI();
  const spaceId = note?.spaceId ?? (ui.spaceId === "all" ? "" : ui.spaceId);
  const scope: Scope = st.scope ?? { kind: "vault" };
  const setScope = (s: Scope) => setAsk({ scope: s });
  const [hot, setHot] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const t = st.turn;
  const busy = t && (t.status === "indexing" || t.status === "asking" || t.status === "streaming");

  useEffect(() => { if (autoFocus) setTimeout(() => input.current?.focus(), 30); }, [autoFocus]);
  // A question handed over from the palette ("Ask your notes: …") runs once.
  useEffect(() => {
    try {
      const q = sessionStorage.getItem("lumen.askAuto");
      if (q && v.ready) { sessionStorage.removeItem("lumen.askAuto"); void ask(q, scope, v); }
    } catch { /* ignore */ }
  }, [v.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hovering a citation brings its source card into view.
  useEffect(() => { if (hot != null) document.querySelector(`[data-src="${hot}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [hot]);

  const submit = (q = st.draft) => { if (q.trim() && !busy) void ask(q, scope, v); };
  const open = (id: string) => { openNote(id); onOpened?.(); };
  const cited = t ? citedNumbers(t.answer) : new Set<number>();
  const done = t?.status === "done" || t?.status === "error";
  const signedOut = !getToken();

  const copyAnswer = async () => { if (!t) return; try { await navigator.clipboard.writeText(answerAsMarkdown(t)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast("Couldn't copy"); } };
  const saveNote = async () => {
    if (!t) return;
    const title = t.question.replace(/[#[\]|]/g, "").slice(0, 90);
    const n = await createNote({ title, spaceId: note?.spaceId ?? (ui.spaceId === "all" ? "inbox" : ui.spaceId), body: `# ${title}\n\n${answerAsMarkdown(t)}` });
    toast("Saved as a note");
    open(n.id);
  };

  let status: ReactNode = null;
  if (t?.status === "indexing") status = "Reading your notes…";
  else if (t?.status === "asking") status = `Answering from ${t.sources.length} passage${t.sources.length === 1 ? "" : "s"}…`;

  return (
    <div className="flex flex-col gap-3">
      <ScopePicker scope={scope} setScope={setScope} note={note} v={v} spaceId={spaceId || ""} />
      {/* Question field */}
      <div className="flex items-end gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-accent">
        <textarea ref={input} dir="auto" rows={2} value={st.draft} onChange={(e) => setAsk({ draft: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={`Ask ${scopeLabel(scope, v) === "Whole vault" ? "your notes" : scopeLabel(scope, v)}…`} aria-label="Question"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent text-[14px] leading-[20px] text-ink !outline-none placeholder:text-muted" />
        {busy
          ? <button aria-label="Stop" title="Stop" onClick={stopAsk} className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-line text-muted hover:text-ink"><Square size={13} /></button>
          : <button aria-label="Ask" title="Ask (Enter)" onClick={() => submit()} disabled={!st.draft.trim()} className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-accent text-accent-fg hover:brightness-110 disabled:opacity-40"><ArrowUp size={16} /></button>}
      </div>

      {!t && (
        <div className="flex flex-col gap-2">
          <span className={SECTION}>Try</span>
          {EXAMPLES.map((q) => (
            <button key={q} dir="auto" onClick={() => { setAsk({ draft: q }); submit(q); }} className="rounded-[10px] border border-line px-3 py-2 text-left text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">{q}</button>
          ))}
        </div>
      )}

      {t && (
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface-2 fade-in">
          <div className="flex items-start gap-2 border-b border-line px-3.5 py-3">
            <MessagesSquare size={14} className="mt-0.5 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span dir="auto" className="font-semibold leading-[18px]">{t.question}</span>
              <span dir="auto" className="truncate text-[11.5px] text-muted">in {t.scopeLabel}</span>
            </span>
          </div>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            {status && <span className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={13} className="animate-spin" />{status}</span>}
            {t.notice && <span dir="auto" className="rounded-[8px] bg-surface px-2.5 py-2 text-[12.5px] leading-[18px] text-muted">{t.notice}</span>}
            {t.error && <span dir="auto" className="rounded-[8px] bg-[color-mix(in_srgb,var(--danger,#e5534b)_12%,transparent)] px-2.5 py-2 text-[12.5px] leading-[18px]">{t.error}</span>}
            {t.answer && <Answer turn={t} onHover={setHot} onOpen={open} />}
          </div>
          {done && t.answer && t.sources.length > 0 && (
            <div className="flex gap-2 border-t border-line px-3.5 py-2.5">
              <button onClick={copyAnswer} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] hover:bg-surface">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button>
              <button onClick={saveNote} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] hover:bg-surface"><FilePlus2 size={13} />Save as note</button>
            </div>
          )}
        </div>
      )}

      {t && t.sources.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={cx(SECTION, "flex items-center gap-1.5")}><BookOpenText size={12} />Sources · {t.sources.length}{done && t.answer && cited.size > 0 ? ` · ${[...cited].filter((n) => t.sources.some((s) => s.n === n)).length} cited` : ""}</span>
          {t.sources.map((s) => <SourceCard key={s.id} s={s} v={v} cited={cited.has(s.n)} done={!!done && !!t.answer} hot={hot === s.n} onOpen={open} />)}
        </div>
      )}

      {st.history.filter((h) => h.id !== t?.id).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={cx(SECTION, "flex items-center gap-1.5")}><History size={12} />Recent questions</span>
          {st.history.filter((h) => h.id !== t?.id).slice(0, 6).map((h) => (
            <button key={h.id + h.question} dir="auto" onClick={() => showTurn(h)} className="truncate rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">{h.question}</button>
          ))}
        </div>
      )}

      <span className="text-[12px] leading-[18px] text-muted">
        {signedOut ? `${NEEDS_SIGNIN} Passages are still found on this device.` : "Passages are found on this device; only the ones listed under Sources are sent to Cloudflare Workers AI. Nothing is stored. Answers use your notes only."}
      </span>
    </div>
  );
}

/** Full Ask sheet (palette → "Ask your notes…"): centered dialog on desktop, full screen on phone. */
export function AskSheet() {
  const st = useAsk();
  const ui = useUI();
  const v = useVault();
  const note = ui.view === "notes" && ui.noteId ? v.byId.get(ui.noteId) : undefined;
  useEffect(() => {
    if (!st.open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeAsk(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [st.open]);
  if (!st.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center md:bg-[rgba(5,6,8,.6)] md:pt-[80px] fade-in" onMouseDown={(e) => e.target === e.currentTarget && closeAsk()}>
      <div role="dialog" aria-label="Ask your notes" className="safe-t flex h-full w-full flex-col overflow-hidden bg-bg text-[13px] md:h-auto md:max-h-[calc(100vh-120px)] md:max-w-[680px] md:rounded-[14px] md:border md:border-line md:bg-surface md:shadow-[0_24px_64px_rgba(0,0,0,.5)]">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
          <button aria-label="Close" onClick={closeAsk} className="flex size-10 items-center justify-center md:hidden"><ArrowLeft size={20} /></button>
          <MessagesSquare size={16} className="hidden text-accent md:block" />
          <span className="flex-1 font-semibold">Ask your notes</span>
          <button aria-label="Close" onClick={closeAsk} className="hidden size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink md:flex"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5 md:p-4">
          <AskVault note={note} autoFocus onOpened={closeAsk} />
        </div>
      </div>
    </div>
  );
}
