// "Ask your vault" (design: Lumen 20 · A11; citation chip + source card: Lumen 21). A search box that answers only
// from your notes, with numbered citations. Same styling as search: no glow, no sparkles.
// Desktop: page with a History column (palette → "Ask your notes…"). Phone: bottom sheet. Right panel: compact.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { ask, citedNumbers, closeAsk, NEEDS_SIGNIN, newQuestion, scopeLabel, setAsk, showTurn, stopAsk, useAsk, type AskTurn, type Retrieved, type Scope } from "../lib/ask";
import { db, DEMO } from "../lib/db";
import { render } from "../lib/markdown";
import { openNote, setUI, toast, useUI, useVault, type Vault } from "../lib/store";
import { Glyph } from "./Glyph";
import { plainText } from "./nav-text";
import { cx } from "./ui";

const SERIF = "'Source Serif 4', Georgia, serif";
const EXAMPLES = ["Explain AdamW using my Géron and Coursera notes", "What is batch normalization and why does it help?", "اشرح آلية الانتباه في المحولات"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const isAr = (s: string) => /[؀-ۿ]/.test(s);

/** `[1]`, `[2, 3]`, `[1][2]` in the model's answer → placeholders that survive Markdown rendering. */
const markCitations = (md: string) => md.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (_m, list: string) => list.split(",").map((x) => `⟦${x.trim()}⟧`).join(""));

/** Answer Markdown with citations as [[Note]] links (Copy with citations / Save / Insert as note). */
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

/** Rendered answer: Markdown + KaTeX in the reading serif, citations as numbered chips (click opens the note). */
function Answer({ turn, big, onHover, onOpen }: { turn: AskTurn; big: boolean; onHover: (n: number | null) => void; onOpen: (id: string) => void }) {
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
    <div ref={ref} dir="auto" className={cx("prose ask-answer flex flex-col gap-3", turn.status === "streaming" && "ask-streaming")}
      style={{ fontSize: big ? 17 : 16, lineHeight: big ? "30px" : "28px", fontFamily: isAr(turn.answer) ? "'Noto Naskh Arabic', 'IBM Plex Sans Arabic', serif" : SERIF }}
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

const glyphOf = (v: Vault, id: string) => v.byId.get(id)?.type ?? "note";

/** Source card (Lumen 21): number, note-type glyph, title, quoted passage. `row` = the phone list row. */
function SourceCard({ s, hot, dim, row, v, onOpen }: { s: Retrieved; hot: boolean; dim: boolean; row: boolean; v: Vault; onOpen: (id: string) => void }) {
  // the roadmap date marker (an emoji in stored note text) is dropped from quotes
  const quote = useMemo(() => plainText(s.text).replace(/\u{1F4C5}\s?/gu, "").replace(/\s+/g, " ").trim().slice(0, 140), [s.text]);
  const title = s.heading ? `${s.title} · ${s.heading}` : s.title;
  if (row) return (
    <button data-src={s.n} onClick={() => onOpen(s.noteId)} className={cx("flex min-h-[52px] items-center gap-2.5 rounded-[10px] border bg-bg px-3 py-2 text-left", hot ? "border-accent" : "border-line", dim && "opacity-60")}>
      <span className="font-bold text-link">{s.n}</span>
      <Glyph name={glyphOf(v, s.noteId)} size={16} color="var(--muted)" />
      <span dir="auto" className="min-w-0 flex-1 truncate">{title}</span>
    </button>
  );
  return (
    <button data-src={s.n} onClick={() => onOpen(s.noteId)} title={`Open ${s.title}`}
      className={cx("flex min-w-0 flex-col gap-1.5 rounded-[10px] border bg-surface px-3 py-2.5 text-left hover:bg-surface-2", hot ? "border-accent" : "border-line", dim && "opacity-60")}>
      <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
        <span className="font-bold text-link">{s.n}</span>
        <Glyph name={glyphOf(v, s.noteId)} size={13} color="var(--muted)" />
        <span dir="auto" className="truncate font-semibold">{title}</span>
      </span>
      <span dir="auto" className="line-clamp-3 text-[13.5px] leading-[19px] text-muted" style={{ fontFamily: SERIF }}>“{quote}”</span>
    </button>
  );
}

/** Scope chip ("AI Engineer ▾"): Vault · current space · note + links · each learning path. */
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
  const cur = opts.find((o) => same(o.s, scope)) ?? opts[0];
  return (
    <div ref={ref} className="relative shrink-0">
      <button aria-haspopup="listbox" aria-expanded={open} aria-label={`Search in: ${cur.label}`} onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-[180px] items-center gap-1.5 rounded-[7px] bg-surface-2 px-2.5 text-[12px] hover:text-ink">
        <Glyph name={cur.glyph} size={13} /><span dir="auto" className="truncate">{cur.label}</span><Glyph name="chevron-down" size={12} />
      </button>
      {open && (
        <div role="listbox" aria-label="Search in" className="absolute right-0 top-[calc(100%+4px)] z-40 flex max-h-[300px] w-[240px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
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

const btn = "flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line px-3 hover:bg-surface-2 disabled:opacity-50";

/**
 * The Ask column: question field + scope, progress, the answer with citations, source cards, actions and the
 * empty / offline states. `layout`: "page" (desktop Ask page), "sheet" (phone), "panel" (right panel AI tab).
 */
export function AskVault({ note, autoFocus, onOpened, layout = "panel" }: { note?: Note; autoFocus?: boolean; onOpened?: () => void; layout?: "page" | "sheet" | "panel" }) {
  const st = useAsk();
  const v = useVault();
  const ui = useUI();
  const spaceId = note?.spaceId ?? (ui.spaceId === "all" ? "" : ui.spaceId);
  const scope: Scope = st.scope ?? { kind: "vault" };
  const setScope = (s: Scope) => setAsk({ scope: s });
  const [hot, setHot] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAct, setBusyAct] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = st.turn;
  const busy = !!t && (t.status === "indexing" || t.status === "asking" || t.status === "streaming");
  const page = layout === "page";

  useEffect(() => { if (autoFocus) setTimeout(() => input.current?.focus(), 30); }, [autoFocus]);
  // A question handed over from the palette ("Ask your notes: …") runs once.
  useEffect(() => {
    try {
      const q = sessionStorage.getItem("lumen.askAuto");
      if (q && v.ready) { sessionStorage.removeItem("lumen.askAuto"); void ask(q, scope, v); }
    } catch { /* ignore */ }
  }, [v.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hot != null) document.querySelector(`[data-src="${hot}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [hot]);

  const submit = (q = st.draft) => { if (q.trim() && !busy) void ask(q, scope, v); };
  const open = (id: string) => { openNote(id); onOpened?.(); };
  const cited = t ? citedNumbers(t.answer) : new Set<number>();
  const done = t?.status === "done" || t?.status === "error";
  const signedIn = !!getToken() || DEMO;
  const targetSpace = note?.spaceId ?? (ui.spaceId === "all" ? "inbox" : ui.spaceId);
  const citedNotes = t ? new Set(t.sources.filter((s) => !t.answer || cited.has(s.n)).map((s) => s.noteId)).size : 0;

  const copyAnswer = async () => { if (!t) return; try { await navigator.clipboard.writeText(answerAsMarkdown(t)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { toast("Couldn't copy"); } };
  const saveNote = async () => {
    if (!t) return;
    const title = t.question.replace(/[#[\]|]/g, "").slice(0, 90);
    const n = await createNote({ title, spaceId: targetSpace, body: `# ${title}\n\n${answerAsMarkdown(t)}` });
    toast("Saved as a note");
    open(n.id);
  };
  const insertIntoNote = async () => {
    if (!t || !note) return;
    const n = await db.notes.get(note.id);
    if (!n) return;
    await updateNote(n.id, { body: `${n.body.replace(/\s*$/, "")}\n\n> [!question] ${t.question.replace(/\n/g, " ")}\n\n${answerAsMarkdown(t)}` });
    toast(`Added to ${n.title}`);
  };
  const makeCards = async () => {
    if (!t) return;
    if (!signedIn) { toast(NEEDS_SIGNIN); return; }
    setBusyAct("cards");
    try {
      const out = (await aiRun("flashcards", `${t.question}\n\n${t.answer.replace(/\[\d+(?:,\s*\d+)*\]/g, "")}`)).trim();
      const cards = out.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim()).filter((l) => / :: /.test(l));
      if (!cards.length) { toast("The AI didn't return any cards."); return; }
      const title = `${t.question.replace(/[#[\]|]/g, "").slice(0, 80)} · cards`;
      const src = t.sources.filter((s) => cited.has(s.n)).map((s) => `[[${s.title.replace(/[[\]|#]/g, " ")}]]`).filter((x, i, a) => a.indexOf(x) === i);
      const n = await createNote({ title, spaceId: targetSpace, type: "flashcards", body: `# ${title}\n\n${cards.join("\n")}\n${src.length ? `\nFrom ${src.join(", ")}\n` : ""}` });
      toast(`${cards.length} flashcard${cards.length === 1 ? "" : "s"} made (they show in Review)`, { label: "Open", run: () => openNote(n.id) });
    } catch (e) { toast((e as Error).message); } finally { setBusyAct(null); }
  };

  const field = (
    <div className={cx("flex items-center gap-2.5 rounded-[12px] border border-line px-3.5 focus-within:border-accent", page ? "h-12 bg-surface" : "min-h-12 bg-bg")}>
      {page && <Glyph name="query" size={18} color="var(--muted)" />}
      <input ref={input} dir="auto" value={st.draft} onChange={(e) => setAsk({ draft: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape" && busy) { e.stopPropagation(); stopAsk(); } }}
        placeholder={t && !st.draft ? t.question : "Ask your notes…"} aria-label="Question"
        className={cx("min-w-0 flex-1 bg-transparent text-ink !outline-none", page ? "text-[15px]" : "text-[14px]", t && !st.draft ? "placeholder:text-ink" : "placeholder:text-muted")} />
      {busy && <button aria-label="Stop" onClick={stopAsk} className="h-7 shrink-0 rounded-[7px] px-2 text-[12px] text-muted hover:text-ink">Stop</button>}
      <ScopeChip scope={scope} setScope={setScope} note={note} v={v} spaceId={spaceId || ""} />
    </div>
  );

  const scopeName = t ? t.scopeLabel : scopeLabel(scope, v);
  let meta: string | null = null;
  if (t?.status === "done" && t.answer) meta = `Answered from ${citedNotes} note${citedNotes === 1 ? "" : "s"} in ${scopeName}${t.secs != null ? ` · ${t.secs} s` : ""} · nothing leaves your Cloudflare`;
  else if (t?.status === "asking" || t?.status === "streaming") meta = `Answering from ${t.sources.length} passage${t.sources.length === 1 ? "" : "s"} in ${scopeName}…`;

  const empty = (line: string, sub: string) => (
    <div className="flex flex-col items-start gap-2" role="status">
      <span className="font-semibold">{line}</span>
      <span className="text-muted">{sub}</span>
      {t!.sources.length > 0 && (
        <div className="flex w-full flex-col gap-1.5">
          {t!.sources.slice(0, 3).map((s) => <SourceCard key={s.id} s={s} hot={false} dim={false} row v={v} onOpen={open} />)}
        </div>
      )}
      <button onClick={() => searchInstead(t!.question)} className="text-link hover:underline">Search instead</button>
    </div>
  );

  return (
    <div className={cx("flex flex-col text-[13px]", page ? "w-full max-w-[760px] gap-[18px]" : "gap-3")}>
      <div className="flex flex-col gap-2.5">
        {field}
        {meta && <span className="text-[12px] text-muted">{meta}</span>}
      </div>

      {!t && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Try</span>
          {EXAMPLES.map((q) => (
            <button key={q} dir="auto" onClick={() => { setAsk({ draft: q }); submit(q); }} className="rounded-[8px] px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-ink">{q}</button>
          ))}
          <span className="pt-2 text-[12px] leading-[18px] text-muted">
            {getToken() || DEMO ? "Passages are found on this device; only the ones listed as sources are sent to your Cloudflare Worker. Answers use your notes only." : `${NEEDS_SIGNIN} Passages are still found on this device.`}
          </span>
        </div>
      )}

      {t?.status === "indexing" && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <span className="font-semibold" dir="auto">Reading {t.total ?? 0} note{t.total === 1 ? "" : "s"} in {scopeName}…</span>
          <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-ink transition-[width]" style={{ width: `${t.total ? Math.round(((t.read ?? 0) / t.total) * 100) : 0}%` }} /></span>
        </div>
      )}

      {t?.empty === "none" && empty(isAr(t.question) ? "ليس في ملاحظاتك." : "Not in your notes.", t.sources.length ? "These are the closest notes. Ask never guesses." : "Nothing in your notes matches this question. Ask never guesses.")}
      {t?.empty === "offline" && empty("Ask needs a connection.", "Search still works offline.")}
      {t?.notice && <span dir="auto" className="text-muted">{t.notice}</span>}
      {t?.error && <span dir="auto" className="text-bad">{t.error}</span>}

      {t?.answer && <Answer turn={t} big={page} onHover={setHot} onOpen={open} />}

      {t && !t.empty && t.sources.length > 0 && (t.answer || done) && (
        <div className={cx(page ? "grid grid-cols-3 gap-2.5" : "flex flex-col gap-2")} aria-label="Sources">
          {(page ? t.sources.filter((s) => !t.answer || cited.has(s.n) || cited.size === 0) : t.sources).map((s) => (
            <SourceCard key={s.id} s={s} v={v} row={!page} hot={hot === s.n} dim={done && !!t.answer && cited.size > 0 && !cited.has(s.n)} onOpen={open} />
          ))}
        </div>
      )}

      {done && t?.answer && (
        <div className="flex flex-wrap gap-2">
          {note && <button onClick={insertIntoNote} className={btn} title={`Add the answer to ${note.title}`}>Insert as note</button>}
          <button onClick={copyAnswer} className={btn}>{copied ? "Copied" : "Copy with citations"}</button>
          <button onClick={makeCards} disabled={busyAct === "cards"} className={btn}>{busyAct === "cards" ? "Making cards…" : "Make flashcards"}</button>
          <button onClick={saveNote} className={btn}>Save as note</button>
        </div>
      )}

      {layout === "panel" && st.history.filter((h) => h.id !== t?.id).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">History</span>
          {st.history.filter((h) => h.id !== t?.id).slice(0, 6).map((h) => (
            <button key={h.id + h.question} dir="auto" onClick={() => showTurn(h)} className="truncate rounded-[7px] p-2 text-left text-muted hover:bg-surface-2 hover:text-ink">{h.question}</button>
          ))}
        </div>
      )}
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
  useEffect(() => {
    if (!st.open) return;
    const r = document.querySelector("aside")?.getBoundingClientRect();
    setLeft(r && r.left < 4 && r.width < 400 ? Math.round(r.right) : 0);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeAsk(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [st.open]);
  if (!st.open) return null;
  if (phone) return (
    <div className="fixed inset-0 z-50 bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && closeAsk()}>
      <div role="dialog" aria-label="Ask" className="absolute inset-x-0 bottom-0 flex h-[calc(100%-95px)] flex-col gap-3 rounded-t-[14px] bg-surface px-4 pt-2.5 text-[13px]">
        <button aria-label="Close" onClick={closeAsk} className="flex justify-center py-1"><span className="h-1 w-9 rounded-[2px] bg-line" /></button>
        <span className="text-[18px] font-[650]">Ask</span>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4"><AskVault note={note} autoFocus onOpened={closeAsk} layout="sheet" /></div>
      </div>
    </div>
  );
  const hist = st.history;
  return (
    <div role="dialog" aria-label="Ask" className="fixed inset-y-0 right-0 z-50 flex bg-bg text-[13px] fade-in" style={{ left }}>
      <div className="flex w-[260px] shrink-0 flex-col gap-1 border-e border-line px-3 py-4">
        <div className="flex items-center px-1.5 pb-2.5">
          <span className="flex-1 text-[15px] font-[650]">Ask</span>
          <button aria-label="Close Ask" onClick={closeAsk} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={15} /></button>
        </div>
        <button onClick={newQuestion} className="mb-2.5 flex h-8 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2">New question</button>
        <span className="p-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">History</span>
        <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {!hist.length && <span className="px-2 text-muted">Questions you ask show here.</span>}
          {hist.map((h) => (
            <button key={h.id + h.question} dir="auto" onClick={() => showTurn(h)} className={cx("truncate rounded-[7px] p-2 text-left", st.turn?.question === h.question ? "bg-surface-2" : "hover:bg-surface-2")}>{h.question}</button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center overflow-y-auto px-10 py-8">
        <AskVault note={note} autoFocus onOpened={closeAsk} layout="page" />
      </div>
    </div>
  );
}
