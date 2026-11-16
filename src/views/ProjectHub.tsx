import { AlertTriangle, BookText, CalendarRange, Check, ChevronDown, Columns3, Copy, ExternalLink, FilePlus2, GitBranch, Link2, ListChecks, Loader2, Network, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { patch } from "../lib/db";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { relTime } from "../components/ui";
import {
  CARD_COLUMNS, DOC_KINDS, DOC_STATUS_COLOR, DOC_STATUSES, docOf, epicMermaid, ganttMermaid, nextReqId, projectHealth, projectTasks, requirements,
  setCardStatus, setDocStatus, traceMermaid, type CardStatus, type DocKind, type DocStatus, type Requirement, type TaskCard,
} from "../lib/project";
import { DOC_TEMPLATES } from "../lib/project-templates";
import { openNote, toast, useVault } from "../lib/store";
import { Button, cx, inputCls } from "../components/ui";
import { openNoteAtLine } from "../components/study-nav";

type Tab = "overview" | "docs" | "board" | "requirements" | "timeline" | "diagrams" | "ai";

/** Software project hub on a Project space: docs, task cards, requirements, timeline, diagrams, AI assistant, links. */
export function ProjectHub({ sp, overview }: { sp: Space; overview: ReactNode }) {
  const v = useVault();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem(`lumen.hub.tab.${sp.id}`) as Tab) || "overview");
  useEffect(() => { try { localStorage.setItem(`lumen.hub.tab.${sp.id}`, tab); } catch { /* ignore */ } }, [tab, sp.id]);
  const notes = useMemo(() => v.notes.filter((n) => n.spaceId === sp.id), [v.notes, sp.id]);
  const docs = useMemo(() => notes.map(docOf).filter((d): d is NonNullable<ReturnType<typeof docOf>> => !!d), [notes]);
  const cards = useMemo(() => projectTasks(notes), [notes]);
  const reqs = useMemo(() => requirements(notes, cards), [notes, cards]);
  const deadline = sp.props.deadline || null;
  const health = projectHealth(cards, deadline, sp.createdAt);
  const tabs: { id: Tab; label: string; icon: ReactNode; n?: number }[] = [
    { id: "overview", label: "Overview", icon: <GitBranch size={14} /> },
    { id: "docs", label: "Docs", icon: <BookText size={14} />, n: docs.length },
    { id: "board", label: "Board", icon: <Columns3 size={14} />, n: cards.filter((c) => c.status !== "done" && c.status !== "cancelled").length },
    { id: "requirements", label: "Requirements", icon: <ListChecks size={14} />, n: reqs.length },
    { id: "timeline", label: "Timeline", icon: <CalendarRange size={14} /> },
    { id: "diagrams", label: "Diagrams", icon: <Network size={14} /> },
    { id: "ai", label: "AI assistant", icon: <Sparkles size={14} /> },
  ];
  const toneCls = health.tone === "ok" ? "text-ok bg-ok/12" : health.tone === "warn" ? "text-warn bg-warn/12" : health.tone === "bad" ? "text-bad bg-bad/12" : "text-muted bg-surface-2";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 md:px-12">
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx("flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px]", tab === t.id ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
              {t.icon}{t.label}{!!t.n && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{t.n}</span>}
            </button>
          ))}
        </nav>
        <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-medium", toneCls)} title={`${Math.round(health.pct * 100)}% of tasks done${health.overdue ? ` · ${health.overdue} overdue` : ""}`}>{health.label} · {Math.round(health.pct * 100)}%</span>
      </div>
      <Links sp={sp} />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "overview" ? overview
          : tab === "docs" ? <Docs sp={sp} docs={docs} />
          : tab === "board" ? <Board sp={sp} cards={cards} notes={notes} />
          : tab === "requirements" ? <Requirements sp={sp} reqs={reqs} docs={docs.map((d) => d.note)} />
          : tab === "timeline" ? <Timeline sp={sp} cards={cards} />
          : tab === "diagrams" ? <Diagrams sp={sp} cards={cards} reqs={reqs} notes={notes} />
          : <Assistant sp={sp} notes={notes} cards={cards} reqs={reqs} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ links (repo, PRs, designs, docs: links only, no API connection)
type LinkItem = { label: string; url: string };
const linkIcon = (u: string) => /github\.com|gitlab|bitbucket/.test(u) ? "⌥" : /figma\.com/.test(u) ? "🎨" : /docs\.google|notion|confluence|atlassian/.test(u) ? "📄" : /jira|linear\.app|trello/.test(u) ? "🎫" : "🔗";
function Links({ sp }: { sp: Space }) {
  const links: LinkItem[] = useMemo(() => { try { return JSON.parse(sp.props.links || "[]"); } catch { return []; } }, [sp.props.links]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const set = (l: LinkItem[]) => void patch("space", sp.id, { props: { ...sp.props, links: JSON.stringify(l) } });
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 md:px-12">
      <span className="mr-1 flex items-center gap-1 text-[11.5px] text-muted"><Link2 size={13} /> Links</span>
      {links.map((l) => (
        <span key={l.url} className="group flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface pl-2.5 pr-1 text-[12.5px]">
          <span>{linkIcon(l.url)}</span>
          <a href={l.url} target="_blank" rel="noreferrer" className="max-w-[220px] truncate hover:text-link" title={l.url}>{l.label}</a>
          <ExternalLink size={11} className="text-muted" />
          <button onClick={() => set(links.filter((x) => x.url !== l.url))} className="hidden rounded-full p-0.5 text-muted hover:text-bad group-hover:block"><X size={11} /></button>
        </span>
      ))}
      {adding ? (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (!/^https?:\/\//.test(url)) return toast("Paste a full link (https://…)"); set([...links, { url, label: label.trim() || url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) }]); setUrl(""); setLabel(""); setAdding(false); }}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/… (repo, PR, Figma, doc)" className={inputCls + " !h-7 !w-64"} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className={inputCls + " !h-7 !w-28"} />
          <Button size="sm" variant="primary" type="submit">Add</Button>
          <button type="button" onClick={() => setAdding(false)} className="text-muted"><X size={14} /></button>
        </form>
      ) : <button onClick={() => setAdding(true)} className="flex h-7 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-[12px] text-muted hover:text-ink"><Plus size={12} /> Add link</button>}
      <span className="ml-auto hidden text-[11px] text-muted md:block">Links only: nothing is connected to GitHub/Bitbucket.</span>
    </div>
  );
}

// ------------------------------------------------------------------ Docs
function NewDocMenu({ sp, onDone }: { sp: Space; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  async function create(kind: DocKind) {
    const meta = DOC_KINDS.find((d) => d.kind === kind)!;
    const title = kind === "meeting" ? `Meeting ${new Date().toISOString().slice(0, 10)}` : `${meta.short}: ${sp.name}`;
    const n = await createNote({ title, body: `# ${title}\n\n${DOC_TEMPLATES[kind](sp.name)}`, spaceId: sp.id, fm: { doc: kind, docstatus: "draft", ...(kind === "adr" ? { decided: new Date().toISOString().slice(0, 10) } : {}) } });
    setOpen(false); onDone?.();
    openNote(n.id, "edit");
  }
  return (
    <div className="relative">
      <Button size="sm" variant="primary" onClick={() => setOpen((o) => !o)}><FilePlus2 size={14} /> New doc <ChevronDown size={13} /></Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
            {DOC_KINDS.map((d) => (
              <button key={d.kind} onClick={() => create(d.kind)} className="flex w-full items-start gap-2.5 rounded-[8px] px-2 py-2 text-left hover:bg-surface-2">
                <span className="text-[16px]">{d.icon}</span>
                <span><span className="block text-[13px] font-medium">{d.label}</span><span className="block text-[11.5px] text-muted">{d.hint}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ s, onChange }: { s: DocStatus; onChange: (s: DocStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize" style={{ color: DOC_STATUS_COLOR[s], background: `color-mix(in srgb, ${DOC_STATUS_COLOR[s]} 14%, transparent)` }}>
        <span className="size-1.5 rounded-full" style={{ background: DOC_STATUS_COLOR[s] }} />{s === "review" ? "In review" : s}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-[10px] border border-line bg-surface p-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {DOC_STATUSES.map((x) => <button key={x} onClick={() => { onChange(x); setOpen(false); }} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] capitalize hover:bg-surface-2"><span className="size-2 rounded-full" style={{ background: DOC_STATUS_COLOR[x] }} />{x === "review" ? "In review" : x}</button>)}
          </div>
        </>
      )}
    </span>
  );
}

function Docs({ sp, docs }: { sp: Space; docs: NonNullable<ReturnType<typeof docOf>>[] }) {
  const [filter, setFilter] = useState<DocKind | "all">("all");
  const shown = docs.filter((d) => filter === "all" || d.kind === filter).sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  const counts = new Map<DocKind, number>();
  docs.forEach((d) => counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1));
  return (
    <div className="space-y-4 px-4 py-5 md:px-12">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setFilter("all")} className={cx("h-7 rounded-full px-3 text-[12.5px]", filter === "all" ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>All · {docs.length}</button>
        {DOC_KINDS.filter((d) => counts.get(d.kind)).map((d) => <button key={d.kind} onClick={() => setFilter(d.kind)} className={cx("h-7 rounded-full px-3 text-[12.5px]", filter === d.kind ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>{d.icon} {d.short} · {counts.get(d.kind)}</button>)}
        <span className="flex-1" />
        <NewDocMenu sp={sp} />
      </div>
      {shown.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line">
          {shown.map((d) => {
            const meta = DOC_KINDS.find((k) => k.kind === d.kind)!;
            return (
              <div key={d.note.id} onClick={() => openNote(d.note.id)} className="flex cursor-pointer items-center gap-3 border-b border-line/60 bg-surface px-4 py-3 last:border-0 hover:bg-surface-2">
                <span className="w-12 shrink-0 rounded-[6px] bg-surface-2 py-0.5 text-center text-[11px] font-semibold text-muted">{meta.short}</span>
                <span className="min-w-0 flex-1"><span dir="auto" className="block truncate text-[14px] font-medium">{d.note.title}</span><span className="block truncate text-[12px] text-muted">{d.owner ? `@${d.owner} · ` : ""}updated {relTime(d.note.updatedAt)}</span></span>
                <StatusPill s={d.status} onChange={(s) => void updateNote(d.note.id, { body: setDocStatus(d.note.body, s) })} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-[13px] text-muted">
          No docs yet. Start with a <b className="text-ink">PRD</b> (what & why), then an <b className="text-ink">RFC</b> (how), record decisions as <b className="text-ink">ADRs</b>, and turn the plan into task cards.
        </div>
      )}
      <p className="text-[12px] text-muted">Docs are normal notes with <code>doc:</code> and <code>docstatus:</code> in their header. Draft → In review → Approved; superseded decisions stay for history.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Board (task cards)
const PRIO_COLOR = { 1: "var(--danger)", 2: "var(--warning)", 3: "var(--info)" } as const;
function Card({ c, drag }: { c: TaskCard; drag?: boolean }) {
  const overdue = c.due && c.status !== "done" && c.due < new Date().toISOString().slice(0, 10);
  return (
    <div draggable={drag} onDragStart={(e) => e.dataTransfer.setData("text/lumen-card", c.key)} onClick={() => openNoteAtLine(c.note.id, c.line)}
      className="cursor-pointer rounded-[10px] border border-line bg-surface p-2.5 text-[13px] shadow-sm hover:border-ink/40" style={c.priority ? { borderLeft: `3px solid ${PRIO_COLOR[c.priority]}` } : undefined}>
      <div dir="auto" className={cx("leading-snug", c.status === "done" && "text-muted line-through")}>{c.text}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {c.epic && <span className="rounded-full bg-learn/15 px-1.5 text-learn">#{c.epic}</span>}
        {c.priority && <span style={{ color: PRIO_COLOR[c.priority] }}>P{c.priority}</span>}
        {c.estimate && <span>~{c.estimate}</span>}
        {c.due && <span className={overdue ? "text-bad" : ""}>📅 {c.due.slice(5)}</span>}
        {c.owner && <span>@{c.owner}</span>}
        {c.reqs.map((r) => <span key={r} className="rounded bg-surface-2 px-1">{r}</span>)}
        <span className="ml-auto truncate opacity-70">{c.note.title}</span>
      </div>
    </div>
  );
}
function Board({ sp, cards, notes }: { sp: Space; cards: TaskCard[]; notes: Note[] }) {
  const [over, setOver] = useState<CardStatus | null>(null);
  const [epic, setEpic] = useState<string | null>(null);
  const [text, setText] = useState("");
  const epics = [...new Set(cards.map((c) => c.epic).filter((e): e is string => !!e))];
  const shown = cards.filter((c) => !epic || c.epic === epic);
  async function add() {
    const t = text.trim();
    if (!t) return;
    let tasksNote = notes.find((n) => n.title === `${sp.name} tasks`);
    const line = `- [ ] ${t}`;
    if (tasksNote) await updateNote(tasksNote.id, { body: tasksNote.body.replace(/\s*$/, "\n") + line + "\n" });
    else tasksNote = await createNote({ title: `${sp.name} tasks`, body: `# ${sp.name} tasks\n\n${line}\n`, spaceId: sp.id });
    setText("");
  }
  async function drop(e: React.DragEvent, s: CardStatus) {
    e.preventDefault(); setOver(null);
    const c = cards.find((x) => x.key === e.dataTransfer.getData("text/lumen-card"));
    if (c && c.status !== s) await updateNote(c.note.id, { body: setCardStatus(c.note.body, c.line, s) });
  }
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 py-4 md:px-12">
      <div className="flex flex-wrap items-center gap-1.5">
        <form className="flex min-w-[280px] flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a card… e.g. Build upload endpoint !p1 ~2d 📅 2026-12-01 #epic/api REQ-1" className={inputCls + " flex-1"} />
          <Button size="sm" variant="primary" type="submit"><Plus size={14} /></Button>
        </form>
        <button onClick={() => setEpic(null)} className={cx("h-7 rounded-full px-2.5 text-[12px]", !epic ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>All epics</button>
        {epics.map((e) => <button key={e} onClick={() => setEpic(epic === e ? null : e)} className={cx("h-7 rounded-full px-2.5 text-[12px]", epic === e ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>#{e}</button>)}
      </div>
      <div className="flex min-h-[420px] flex-1 gap-3 overflow-x-auto pb-2">
        {CARD_COLUMNS.map((col) => {
          const items = shown.filter((c) => c.status === col.s).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.due ?? "9").localeCompare(b.due ?? "9"));
          const est = items.reduce((a, c) => a + c.estDays, 0);
          return (
            <section key={col.s} onDragOver={(e) => { e.preventDefault(); setOver(col.s); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, col.s)}
              className={cx("flex w-[270px] shrink-0 flex-col rounded-[14px] bg-surface-2/40 p-2", over === col.s && "ring-2 ring-accent/50")}>
              <header className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-[13px] font-semibold">
                <span className="size-2 rounded-full" style={{ background: col.color }} />{col.label}
                <span className="ml-auto text-[11.5px] font-normal tabular-nums text-muted">{items.length}{est ? ` · ${Math.round(est * 10) / 10}d` : ""}</span>
              </header>
              <div className="flex flex-col gap-1.5">{items.map((c) => <Card key={c.key} c={c} drag />)}</div>
            </section>
          );
        })}
      </div>
      <p className="text-[12px] text-muted">Cards are task lines in any note of this project. Drag to change status; click to open the line. Markers: [&gt;] backlog · [ ] todo · [/] in progress · [?] review · [x] done.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Requirements (traceability)
const REQ_STATE = { met: ["Met", "var(--success)"], progress: ["In progress", "var(--info)"], planned: ["Planned", "var(--muted)"], none: ["No tasks", "var(--danger)"] } as const;
const MOSCOW_COLOR = { must: "var(--danger)", should: "var(--warning)", could: "var(--info)", wont: "var(--muted)" } as const;
function Requirements({ sp, reqs, docs }: { sp: Space; reqs: Requirement[]; docs: Note[] }) {
  const [text, setText] = useState("");
  const [prio, setPrio] = useState<"must" | "should" | "could" | "wont">("must");
  const reqDoc = docs.find((d) => docOf(d)?.kind === "requirements");
  async function add() {
    const t = text.trim();
    if (!t) return;
    const line = `- ${nextReqId(reqs)} (${prio}) ${t}`;
    if (reqDoc) await updateNote(reqDoc.id, { body: reqDoc.body.replace(/\s*$/, "\n") + line + "\n" });
    else await createNote({ title: `Requirements: ${sp.name}`, body: `# Requirements: ${sp.name}\n\n${line}\n`, spaceId: sp.id, fm: { doc: "requirements", docstatus: "draft" } });
    setText("");
  }
  const counts = { must: 0, should: 0, could: 0, wont: 0 };
  reqs.forEach((r) => { if (r.priority) counts[r.priority]++; });
  const met = reqs.filter((r) => r.state === "met").length;
  return (
    <div className="space-y-4 px-4 py-5 md:px-12">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <span><b className="text-ink">{met}</b> of {reqs.length} met</span>
        {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => <span key={k} className="flex items-center gap-1 capitalize"><span className="size-2 rounded-full" style={{ background: MOSCOW_COLOR[k] }} />{k} {counts[k]}</span>)}
        <span className="text-bad">{reqs.filter((r) => r.state === "none").length} without tasks</span>
      </div>
      <form className="flex flex-wrap gap-1.5" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <select value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)} className={inputCls + " !w-28"}>{(["must", "should", "could", "wont"] as const).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${nextReqId(reqs)}: The system shall…`} className={inputCls + " min-w-0 flex-1"} />
        <Button size="sm" variant="primary" type="submit"><Plus size={14} /> Add</Button>
      </form>
      {reqs.length ? (
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead><tr className="text-left text-[11.5px] uppercase tracking-[.06em] text-muted">{["ID", "Priority", "Requirement", "Tasks", "Status", "Source"].map((h) => <th key={h} className="border-b border-line px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <td className="border-b border-line/60 px-2 py-2 font-mono text-[12px]">{r.id}</td>
                <td className="border-b border-line/60 px-2 py-2">{r.priority ? <span className="rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize" style={{ color: MOSCOW_COLOR[r.priority], background: `color-mix(in srgb, ${MOSCOW_COLOR[r.priority]} 14%, transparent)` }}>{r.priority}</span> : "—"}</td>
                <td dir="auto" className="border-b border-line/60 px-2 py-2">{r.text}</td>
                <td className="border-b border-line/60 px-2 py-2 text-muted">{r.tasks.length ? <span title={r.tasks.map((t) => `${t.status}: ${t.text}`).join("\n")}>{r.tasks.filter((t) => t.status === "done").length}/{r.tasks.length}</span> : "0"}</td>
                <td className="border-b border-line/60 px-2 py-2"><span className="flex items-center gap-1.5 text-[12px]" style={{ color: REQ_STATE[r.state][1] }}>{r.state === "none" && <AlertTriangle size={12} />}{REQ_STATE[r.state][0]}</span></td>
                <td className="border-b border-line/60 px-2 py-2"><button onClick={() => openNoteAtLine(r.doc.id, r.line)} className="max-w-[180px] truncate text-[12px] text-link">{r.doc.title}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-[13px] text-muted">No requirements yet. Write them as <code>- REQ-1 (must) …</code> in any doc, or add one above. Link tasks by writing the id in the task.</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Mermaid block (rendered, with copy / insert)
function MermaidBlock({ code, title, sp }: { code: string; title: string; sp: Space }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) { ref.current.innerHTML = render("```mermaid\n" + code + "\n```"); hydrate(ref.current); } }, [code]);
  return (
    <section className="rounded-[12px] border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold">
        {title}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText("```mermaid\n" + code + "\n```"); toast("Mermaid copied"); }}><Copy size={13} /> Copy</Button>
          <Button size="sm" variant="ghost" onClick={async () => { const n = await createNote({ title: `${title}: ${sp.name}`, body: `# ${title}: ${sp.name}\n\nGenerated ${new Date().toLocaleDateString()}. Edit freely.\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`, spaceId: sp.id, fm: { doc: "spec", docstatus: "draft" } }); openNote(n.id); }}><FilePlus2 size={13} /> Save as doc</Button>
        </span>
      </header>
      <div ref={ref} className="prose !max-w-none p-3" onClick={(e) => handleCopyClick(e)} />
    </section>
  );
}

function Timeline({ sp, cards }: { sp: Space; cards: TaskCard[] }) {
  const g = ganttMermaid(cards, sp.name);
  return (
    <div className="space-y-3 px-4 py-5 md:px-12">
      {g ? <MermaidBlock code={g} title="Timeline (Gantt)" sp={sp} /> : <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-[13px] text-muted">Give cards a due date (📅 2026-12-01) and an estimate (~3d) to see them on the timeline. Grouped by #epic.</div>}
      <p className="text-[12px] text-muted">Generated from task cards: start = 🛫 date or due − estimate. Done = grey, in progress = active, P1 = critical.</p>
    </div>
  );
}

function Diagrams({ sp, cards, reqs, notes }: { sp: Space; cards: TaskCard[]; reqs: Requirement[]; notes: Note[] }) {
  const trace = traceMermaid(reqs);
  const epics = epicMermaid(cards, sp.name);
  const withDiagrams = notes.filter((n) => n.type === "canvas" || n.type === "whiteboard" || /```mermaid/.test(n.body));
  return (
    <div className="space-y-4 px-4 py-5 md:px-12">
      {trace && <MermaidBlock code={trace} title="Requirements → tasks" sp={sp} />}
      {epics && <MermaidBlock code={epics} title="Epic breakdown" sp={sp} />}
      <section>
        <div className="mb-2 flex items-center gap-2"><h3 className="text-[13px] font-semibold">Diagrams in this project</h3>
          <span className="ml-auto flex gap-1">
            <Button size="sm" onClick={async () => openNote((await createNote({ template: "canvas", title: `${sp.name} architecture`, spaceId: sp.id })).id)}><Plus size={13} /> Architecture canvas</Button>
            <Button size="sm" onClick={async () => openNote((await createNote({ template: "whiteboard", title: `${sp.name} whiteboard`, spaceId: sp.id })).id)}><Plus size={13} /> Whiteboard</Button>
          </span>
        </div>
        {withDiagrams.length ? withDiagrams.map((n) => <button key={n.id} onClick={() => openNote(n.id)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"><span>{n.type === "canvas" ? "🧩" : n.type === "whiteboard" ? "🖍️" : "◇"}</span><span className="flex-1 truncate">{n.title}</span><span className="text-[11.5px] text-muted">{relTime(n.updatedAt)}</span></button>)
          : <p className="text-[12.5px] text-muted">No Mermaid diagrams, canvases or whiteboards yet. PRD, RFC and spec templates include Mermaid starters.</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ AI assistant (reads this project's notes)
const AI_ACTIONS = [
  { id: "project_plan", label: "Plan from goal", hint: "Milestones + task cards from the goal and docs", kind: "plan" as DocKind },
  { id: "project_status", label: "Weekly status report", hint: "Done / in progress / blocked / next, for stakeholders", kind: "draft" as DocKind },
  { id: "project_next", label: "Next actions", hint: "The 5 most useful things to do now", kind: "plan" as DocKind },
  { id: "project_risks", label: "Risks & open questions", hint: "From docs, overdue cards and gaps", kind: "draft" as DocKind },
  { id: "project_decisions", label: "Decision summary", hint: "What was decided, by whom, superseded", kind: "adr" as DocKind },
  { id: "project_reqs", label: "Draft requirements", hint: "REQ-n (MoSCoW) lines from the PRD", kind: "requirements" as DocKind },
];
function Assistant({ sp, notes, cards, reqs }: { sp: Space; notes: Note[]; cards: TaskCard[]; reqs: Requirement[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && out) { ref.current.innerHTML = render(out.text); hydrate(ref.current); } }, [out]);
  function context() {
    const today = new Date().toISOString().slice(0, 10);
    const docs = notes.map(docOf).filter(Boolean).map((d) => `### ${d!.kind.toUpperCase()} (${d!.status}): ${d!.note.title}\n${d!.note.body.replace(/^---[\s\S]*?---/, "").slice(0, 2500)}`).join("\n\n");
    const board = cards.map((c) => `- [${c.status}] ${c.text}${c.due ? ` (due ${c.due})` : ""}${c.epic ? ` #${c.epic}` : ""}${c.owner ? ` @${c.owner}` : ""}`).join("\n");
    const rq = reqs.map((r) => `- ${r.id} (${r.priority ?? "?"}) ${r.text} → ${r.state}`).join("\n");
    return `Project: ${sp.name}\nGoal: ${sp.props.goal ?? "(none)"}\nDeadline: ${sp.props.deadline ?? "(none)"}\nToday: ${today}\n\n## Docs\n${docs || "(none)"}\n\n## Task cards\n${board || "(none)"}\n\n## Requirements\n${rq || "(none)"}`.slice(0, 22000);
  }
  async function run(id: string) {
    if (!getToken()) return toast("AI needs sync on (Settings → Sync).");
    setBusy(id);
    try { setOut({ id, text: await aiRun(id, context()) }); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  async function save() {
    if (!out) return;
    const a = AI_ACTIONS.find((x) => x.id === out.id)!;
    const title = `${a.label}: ${sp.name} (${new Date().toISOString().slice(0, 10)})`;
    const n = await createNote({ title, body: `# ${title}\n\n${out.text}\n`, spaceId: sp.id, fm: { doc: a.kind, docstatus: "draft" } });
    openNote(n.id);
  }
  return (
    <div className="grid gap-4 px-4 py-5 md:grid-cols-[300px_1fr] md:px-12">
      <div className="space-y-1.5">
        {AI_ACTIONS.map((a) => (
          <button key={a.id} onClick={() => run(a.id)} disabled={!!busy} className="flex w-full items-start gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left hover:border-ink/40 disabled:opacity-60">
            {busy === a.id ? <Loader2 size={15} className="mt-0.5 animate-spin" /> : <Sparkles size={15} className="mt-0.5 text-accent" />}
            <span><span className="block text-[13px] font-medium">{a.label}</span><span className="block text-[11.5px] text-muted">{a.hint}</span></span>
          </button>
        ))}
        <p className="pt-1 text-[11.5px] text-muted">Reads this project's docs, cards and requirements (sent to Cloudflare Workers AI). Output can be wrong; review before saving.</p>
      </div>
      <div className="min-h-[300px] rounded-[12px] border border-line bg-surface">
        {out ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold">{AI_ACTIONS.find((x) => x.id === out.id)?.label}
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(out.text); toast("Copied"); }}><Copy size={13} /> Copy</Button>
                <Button size="sm" variant="primary" onClick={save}><Check size={13} /> Save as doc</Button>
                <button onClick={() => setOut(null)} className="px-1 text-muted"><Trash2 size={14} /></button>
              </span>
            </div>
            <div ref={ref} className="prose !max-w-none p-4" />
          </>
        ) : <div className="flex h-full min-h-[300px] items-center justify-center p-6 text-center text-[13px] text-muted">Pick an action. Plans come back as task cards you can save straight into the board.</div>}
      </div>
    </div>
  );
}
