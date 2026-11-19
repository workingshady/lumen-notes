// Project hub on a Project space (design round 4: HubDesk, "Lumen 15 Roadmaps and Project Hub" R4-15J…U).
// Header (tile, name, "Project · ships 30 Jan · 61 tasks", health badge, primary action), links row (plain links,
// nothing is connected), tabs Overview · Docs · Board · Requirements · Timeline · Diagrams · Assistant.
// Logic: lib/project.ts (docs, cards, requirements, Gantt rows, health), templates in lib/project-templates.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { patch } from "../lib/db";
import { DOC_KINDS, DOC_STATUS_COLOR, DOC_STATUS_GLYPH, DOC_STATUS_LABEL, DOC_STATUSES, docOf, ganttMermaid, nextReqId, projectHealth, projectTasks, requirements, setDocStatus, MOSCOW, type DocKind, type Moscow, type ProjectDoc, type Requirement, type TaskCard } from "../lib/project";
import { splitFrontMatter, setFrontMatter } from "../lib/parse";
import { DOC_TEMPLATES } from "../lib/project-templates";
import { openNote, toast, useVault } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { SpaceIcon } from "../components/SpaceIcon";
import { cx, relTime } from "../components/ui";
import { Assistant, type AssistantHandle } from "./hub-assistant";
import { Board } from "./hub-board";
import { addDays, addTask, cardDay, cardsOfDoc, dayMon, DocPill, menuRow, Popover, TaskGlyph, todayISO } from "./hub-parts";
import { diagramNotes, Diagrams, Gantt, Requirements } from "./hub-plan";
import { usePhone } from "./spaces-util";

type Tab = "overview" | "docs" | "board" | "requirements" | "timeline" | "diagrams" | "assistant";
const PRIMARY: Record<Tab, string> = { overview: "New task", docs: "New doc", board: "Quick add", requirements: "New requirement", timeline: "Export", diagrams: "New diagram", assistant: "Ask" };
const TONE = { ok: "var(--success)", warn: "var(--warning)", bad: "var(--danger)", muted: "var(--muted)" } as const;

export function ProjectHub({ sp, overview, more, color }: { sp: Space; overview: ReactNode; more?: ReactNode; color?: string; onSettings?: () => void }) {
  const v = useVault();
  const phone = usePhone();
  const [tab, setTabState] = useState<Tab>(() => { const t = localStorage.getItem(`lumen.hub.tab.${sp.id}`); return (t === "ai" ? "assistant" : t as Tab) || "overview"; });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(`lumen.hub.tab.${sp.id}`, t); } catch { /* ignore */ } };
  const [docSel, setDocSel] = useState<string | null>(() => localStorage.getItem(`lumen.hub.doc.${sp.id}`));
  const pickDoc = (id: string) => { setDocSel(id); try { localStorage.setItem(`lumen.hub.doc.${sp.id}`, id); } catch { /* ignore */ } };
  const [pop, setPop] = useState(false);
  const assistant = useRef<AssistantHandle>(null);
  const notes = useMemo(() => v.notes.filter((n) => n.spaceId === sp.id && !n.deleted), [v.notes, sp.id]);
  const docs = useMemo(() => notes.map(docOf).filter((d): d is ProjectDoc => !!d).sort((a, b) => b.note.updatedAt - a.note.updatedAt), [notes]);
  const cards = useMemo(() => projectTasks(notes), [notes]);
  const reqs = useMemo(() => requirements(notes, cards), [notes, cards]);
  const deadline = sp.props.deadline || null;
  const health = projectHealth(cards, deadline, sp.props.start ? Date.parse(sp.props.start) : sp.createdAt, reqs);
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "overview", label: "Overview" }, { id: "docs", label: "Docs", n: docs.length }, { id: "board", label: "Board", n: cards.length },
    { id: "requirements", label: "Requirements", n: reqs.length }, { id: "timeline", label: "Timeline" }, { id: "diagrams", label: "Diagrams", n: diagramNotes(notes).length }, { id: "assistant", label: "Assistant" },
  ];
  const sub = ["Project", deadline ? `ships ${dayMon(deadline)}` : null, `${cards.length} task${cards.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  const tone = TONE[health.tone];
  const primary = () => { if (tab === "assistant") assistant.current?.ask(); else setPop((x) => !x); };

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px] leading-[normal]">
      <div className="safe-t shrink-0"><div className={cx("flex flex-col gap-3", phone ? "px-4 pt-3" : "px-8 pt-5")}>
        <div className="flex items-center gap-3">
          <SpaceIcon space={sp} size={22} tile color={color} />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className={cx("truncate whitespace-nowrap font-[650] tracking-[-.02em]", phone ? "text-[17px]" : "text-[20px]")} dir="auto" title={sp.props.goal ? `Goal: ${sp.props.goal}` : sp.description || undefined}>{sp.name}</span>
            <span className="truncate whitespace-nowrap text-muted">{sub}</span>
          </div>
          <span title={health.reasons.join(" ") || `${Math.round(health.pct * 100)}% of tasks done`} className="flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold"
            style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}><span className="size-[7px] rounded-full" style={{ background: tone }} />{health.label}</span>
          {!phone && (
            <span className="relative">
              <button onClick={primary} className="flex h-[34px] items-center whitespace-nowrap rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110">{PRIMARY[tab]}</button>
              {pop && <PrimaryPopover tab={tab} sp={sp} notes={notes} cards={cards} reqs={reqs} docs={docs} onDone={(id) => { setPop(false); if (id) { pickDoc(id); } }} onClose={() => setPop(false)} />}
            </span>
          )}
          {more}
        </div>
        <Links sp={sp} phone={phone} />
        <nav className="no-scrollbar flex gap-[18px] overflow-x-auto whitespace-nowrap border-b border-line" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx("flex shrink-0 items-center gap-1.5 px-0.5 pb-2.5", tab === t.id ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "font-[450] text-muted hover:text-ink")}>
              {t.label}{!!t.n && <span className="text-[11px] font-medium text-muted">{t.n}</span>}
            </button>
          ))}
        </nav>
      </div></div>
      <div className={cx("min-h-0 flex-1", tab === "board" ? "flex flex-col overflow-hidden" : "overflow-y-auto", phone ? "px-4 py-3.5" : "px-8 py-[18px]")}>
        {tab === "overview" ? <Overview cards={cards} docs={docs} health={health} phone={phone} onDoc={(id) => { pickDoc(id); setTab("docs"); }}>{overview}</Overview>
          : tab === "docs" ? <Docs sp={sp} docs={docs} cards={cards} sel={docSel} onSel={pickDoc} phone={phone} />
          : tab === "board" ? <Board sp={sp} cards={cards} notes={notes} phone={phone} />
          : tab === "requirements" ? <Requirements reqs={reqs} phone={phone} />
          : tab === "timeline" ? <Gantt cards={cards} phone={phone} />
          : tab === "diagrams" ? <Diagrams sp={sp} cards={cards} reqs={reqs} notes={notes} phone={phone} />
          : <Assistant ref={assistant} sp={sp} notes={notes} cards={cards} reqs={reqs} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ primary action per tab
function PrimaryPopover({ tab, sp, notes, cards, reqs, docs, onDone, onClose }: { tab: Tab; sp: Space; notes: Note[]; cards: TaskCard[]; reqs: Requirement[]; docs: ProjectDoc[]; onDone: (docId?: string) => void; onClose: () => void }) {
  const [prio, setPrio] = useState<Moscow>("must");
  const cls = "right-0 top-full mt-1.5";
  if (tab === "overview" || tab === "board") return (
    <Popover onClose={onClose} className={cx(cls, "w-[360px] p-2.5")}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get("t") ?? ""); if (t.trim()) void addTask(sp, notes, t).then(() => onDone()); }}>
        <input name="t" autoFocus placeholder="Build upload endpoint !p1 ~2d due:2026-12-01 #epic/api REQ-1" aria-label="New task" dir="auto" className="h-9 rounded-[8px] border border-line bg-bg px-2.5 outline-none focus:border-accent" />
        <span className="text-[11.5px] leading-4 text-muted">Goes to “{sp.name} tasks”. Markers: !p1 priority · ~3d estimate · due:/start: dates · #epic/name · @owner · REQ-n</span>
        <button className="h-8 self-end rounded-[8px] bg-accent px-3 font-semibold text-accent-fg">Add task</button>
      </form>
    </Popover>
  );
  if (tab === "docs") return (
    <Popover onClose={onClose} className={cx(cls, "w-72")}>
      {DOC_KINDS.map((d) => (
        <button key={d.kind} onClick={() => void newDoc(sp, d.kind).then((id) => onDone(id))} className={cx(menuRow, "items-start py-2")}>
          <Glyph name={d.glyph} size={16} color="var(--muted)" style={{ marginTop: 1 }} />
          <span className="flex flex-col"><span className="font-medium">{d.label}</span><span className="text-[11.5px] text-muted">{d.hint}</span></span>
        </button>
      ))}
    </Popover>
  );
  if (tab === "requirements") return (
    <Popover onClose={onClose} className={cx(cls, "w-[380px] p-2.5")}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get("t") ?? "").trim(); if (t) void addRequirement(sp, docs, reqs, prio, t).then(() => onDone()); }}>
        <div className="flex gap-1">{MOSCOW.map((m) => <button type="button" key={m.k} onClick={() => setPrio(m.k)} className={cx("h-7 flex-1 rounded-[7px] border text-[12px]", prio === m.k ? "font-semibold" : "border-line text-muted")} style={prio === m.k ? { borderColor: m.color, color: m.color } : undefined}>{m.label}</button>)}</div>
        <input name="t" autoFocus placeholder={`${nextReqId(reqs)}: The system shall…`} aria-label="New requirement" dir="auto" className="h-9 rounded-[8px] border border-line bg-bg px-2.5 outline-none focus:border-accent" />
        <button className="h-8 self-end rounded-[8px] bg-accent px-3 font-semibold text-accent-fg">Add {nextReqId(reqs)}</button>
      </form>
    </Popover>
  );
  if (tab === "timeline") {
    const g = ganttMermaid(cards, sp.name);
    return (
      <Popover onClose={onClose} className={cx(cls, "w-60")}>
        <button disabled={!g} className={menuRow} onClick={() => { void navigator.clipboard?.writeText("```mermaid\n" + g + "\n```"); toast("Gantt copied as Mermaid"); onDone(); }}><Glyph name="mermaid" size={16} />Copy as Mermaid</button>
        <button disabled={!g} className={menuRow} onClick={async () => { const n = await createNote({ title: `Timeline: ${sp.name}`, body: `# Timeline: ${sp.name}\n\nGenerated ${todayISO()} from task cards.\n\n\`\`\`mermaid\n${g}\n\`\`\`\n`, spaceId: sp.id, fm: { doc: "plan", docstatus: "draft" } }); onDone(); openNote(n.id); }}><Glyph name="export" size={16} />Save as doc</button>
      </Popover>
    );
  }
  if (tab === "diagrams") return (
    <Popover onClose={onClose} className={cx(cls, "w-60")}>
      <button className={menuRow} onClick={async () => { const n = await createNote({ title: `${sp.name} diagram`, body: `# ${sp.name} diagram\n\n\`\`\`mermaid\nflowchart LR\n  A[Client] --> B[API] --> C[(Database)]\n\`\`\`\n`, spaceId: sp.id }); onDone(); openNote(n.id, "edit"); }}><Glyph name="mermaid" size={16} />Mermaid diagram</button>
      <button className={menuRow} onClick={async () => { const n = await createNote({ template: "canvas", title: `${sp.name} architecture`, spaceId: sp.id }); onDone(); openNote(n.id); }}><Glyph name="canvas" size={16} />Canvas</button>
      <button className={menuRow} onClick={async () => { const n = await createNote({ template: "whiteboard", title: `${sp.name} whiteboard`, spaceId: sp.id }); onDone(); openNote(n.id); }}><Glyph name="whiteboard" size={16} />Whiteboard</button>
    </Popover>
  );
  return null;
}

async function newDoc(sp: Space, kind: DocKind) {
  const meta = DOC_KINDS.find((d) => d.kind === kind)!;
  const title = kind === "meeting" ? `Meeting ${todayISO()}` : `${meta.short}: ${sp.name}`;
  const n = await createNote({ title, body: `# ${title}\n\n${DOC_TEMPLATES[kind](sp.name)}`, spaceId: sp.id, fm: { doc: kind, docstatus: "draft", ...(kind === "adr" ? { decided: todayISO() } : {}) } });
  openNote(n.id, "edit");
  return n.id;
}
async function addRequirement(sp: Space, docs: ProjectDoc[], reqs: Requirement[], prio: Moscow, text: string) {
  const line = `- ${nextReqId(reqs)} (${prio}) ${text}`;
  const reqDoc = docs.find((d) => d.kind === "requirements")?.note;
  if (reqDoc) await updateNote(reqDoc.id, { body: reqDoc.body.replace(/\s*$/, "\n") + line + "\n" });
  else await createNote({ title: `Requirements: ${sp.name}`, body: `# Requirements: ${sp.name}\n\n${line}\n`, spaceId: sp.id, fm: { doc: "requirements", docstatus: "draft" } });
  toast(`Added ${nextReqId(reqs)}`);
}

// ------------------------------------------------------------------ links (repo, PRs, designs, docs: plain links)
type LinkItem = { label: string; url: string };
function Links({ sp, phone }: { sp: Space; phone: boolean }) {
  const links: LinkItem[] = useMemo(() => { try { return JSON.parse(sp.props.links || "[]"); } catch { return []; } }, [sp.props.links]);
  const [adding, setAdding] = useState(false);
  const set = (l: LinkItem[]) => void patch("space", sp.id, { props: { ...sp.props, links: JSON.stringify(l) } });
  const shown = phone ? links.slice(0, 2) : links;
  return (
    <div className="flex h-[18px] items-center gap-3.5 overflow-hidden whitespace-nowrap text-[12.5px]">
      {shown.map((l) => (
        <span key={l.url} className="group flex shrink-0 items-center gap-1.5 text-link">
          <Glyph name="link-card" size={14} />
          <a href={l.url} target="_blank" rel="noreferrer" className="max-w-[240px] truncate hover:underline" title={`${l.url} · opens in a new tab`}>{l.label}</a>
          {!phone && <button aria-label={`Remove link ${l.label}`} onClick={() => set(links.filter((x) => x.url !== l.url))} className="hidden text-muted hover:text-bad group-hover:block"><Glyph name="x" size={11} /></button>}
        </span>
      ))}
      {!phone && (adding ? (
        <form className="flex items-center gap-1.5" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget); const url = String(f.get("u") ?? "").trim(), label = String(f.get("l") ?? "").trim();
          if (!/^https?:\/\//.test(url)) return toast("Paste a full link (https://…)");
          set([...links, { url, label: label || url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) }]); setAdding(false);
        }}>
          <input name="u" autoFocus placeholder="https://… (repo, PR, Figma, ticket)" className="h-7 w-64 rounded-[7px] border border-line bg-bg px-2 outline-none focus:border-accent" />
          <input name="l" placeholder="Label" className="h-7 w-28 rounded-[7px] border border-line bg-bg px-2 outline-none focus:border-accent" />
          <button className="h-7 rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="text-muted">Cancel</button>
        </form>
      ) : <button onClick={() => setAdding(true)} title="Links only: nothing is connected to GitHub, Jira or Figma." className="shrink-0 text-muted hover:text-ink">+ Add link</button>)}
    </div>
  );
}

// ------------------------------------------------------------------ overview
function Overview({ cards, docs, health, phone, onDoc, children }: { cards: TaskCard[]; docs: ProjectDoc[]; health: ReturnType<typeof projectHealth>; phone: boolean; onDoc: (id: string) => void; children: ReactNode }) {
  const today = todayISO();
  const live = cards.filter((c) => c.status !== "cancelled");
  const n = (s: TaskCard["status"]) => live.filter((c) => c.status === s).length;
  const done = n("done"), doing = n("doing"), review = n("review"), todo = n("todo") + n("backlog");
  const total = Math.max(1, live.length);
  const left = live.filter((c) => c.status !== "done").reduce((a, c) => a + c.estDays, 0);
  const week = live.filter((c) => c.due && c.due >= addDays(today, -1) && c.due <= addDays(today, 7)).sort((a, b) => a.due!.localeCompare(b.due!)).slice(0, 6);
  const overdue = live.filter((c) => c.due && c.due < addDays(today, -1) && c.status !== "done");
  const tone = TONE[health.tone];
  const why = health.tone === "ok" ? "On track" : health.tone === "muted" ? "No deadline" : `Why ${health.label.toLowerCase()}`;
  const card = "rounded-[14px] border border-line bg-surface";
  return (
    <div className="flex flex-col gap-3.5">
      <div className={cx("grid content-start gap-3.5", phone ? "grid-cols-1" : "grid-cols-[1.2fr_1fr]")}>
        <div className={cx(card, "flex flex-col gap-3 p-4")}>
          <span className="font-semibold">Progress</span>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-label={`${done} done, ${doing} doing, ${review} review, ${todo} todo`}>
            {done > 0 && <span className="bg-ok" style={{ width: `${(done / total) * 100}%` }} />}
            {doing > 0 && <span style={{ width: `${(doing / total) * 100}%`, background: "var(--info)" }} />}
            {review > 0 && <span style={{ width: `${(review / total) * 100}%`, background: "var(--warning)" }} />}
            <span className="flex-1 bg-surface-2" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
            <span><b className="font-semibold text-ink">{done}</b> done</span><span><b className="font-semibold text-ink">{doing}</b> doing</span>
            <span><b className="font-semibold text-ink">{review}</b> review</span><span><b className="font-semibold text-ink">{todo}</b> todo</span>
            {left > 0 && <span>~{Math.round(left)}d estimated left</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] border p-4" style={{ background: `color-mix(in srgb, ${tone} 8%, var(--surface))`, borderColor: `color-mix(in srgb, ${tone} 30%, transparent)` }}>
          <span className="flex items-center gap-2 font-semibold"><Glyph name={health.tone === "ok" ? "c-success" : health.tone === "muted" ? "c-info" : "c-warning"} size={16} color={tone} />{why}</span>
          <span className="leading-[19px]">{health.reasons.length ? health.reasons.join(" ") : health.tone === "ok" ? "Work done keeps pace with the time used, and every must-have requirement has tasks." : "Set a deadline in Space settings to track whether the project is on time."}</span>
        </div>
        <div className={cx(card, "flex flex-col px-4 py-3")}>
          <span className="pb-1.5 font-semibold">Due this week</span>
          {week.map((c) => (
            <button key={c.key} onClick={() => openNote(c.note.id)} className="flex min-h-9 items-center gap-2.5 border-t border-line text-left">
              <TaskGlyph s={c.status} /><span className="min-w-0 flex-1 truncate" dir="auto">{c.text}</span><span className="text-[12px] text-muted">{cardDay(c.due!, today)}</span>
            </button>
          ))}
          {!week.length && <span className="border-t border-line py-2 text-muted">Nothing due this week.</span>}
          {overdue.length > 0 && <span className="border-t border-line pt-2 text-[12px] text-bad">{overdue.length} overdue from earlier</span>}
        </div>
        <div className={cx(card, "flex flex-col px-4 py-3")}>
          <span className="pb-1.5 font-semibold">Docs</span>
          {docs.slice(0, 5).map((d) => (
            <button key={d.note.id} onClick={() => onDoc(d.note.id)} className="flex min-h-9 items-center gap-2.5 border-t border-line text-left">
              <Glyph name={DOC_STATUS_GLYPH[d.status]} size={16} color={DOC_STATUS_COLOR[d.status]} /><span className="min-w-0 flex-1 truncate" dir="auto">{d.note.title}</span>
              <span className="text-[12px]" style={{ color: DOC_STATUS_COLOR[d.status] }}>{DOC_STATUS_LABEL[d.status]}</span>
            </button>
          ))}
          {!docs.length && <span className="border-t border-line py-2 text-muted">No docs yet. Start with a PRD.</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ docs
/** First paragraph (and the next one) of a doc, without front-matter, the H1, headings, lists and code. */
function paragraphs(md: string) {
  const body = splitFrontMatter(md).body.replace(/```[\s\S]*?```/g, "");
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^(#|>|[-*+]\s|\d+[.)]\s|\||!\[|<)/.test(p))
    .map((p) => p.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " "));
}
function Docs({ sp, docs, cards, sel, onSel, phone }: { sp: Space; docs: ProjectDoc[]; cards: TaskCard[]; sel: string | null; onSel: (id: string) => void; phone: boolean }) {
  const d = docs.find((x) => x.note.id === sel) ?? docs[0];
  const [owner, setOwner] = useState(false);
  useEffect(() => setOwner(false), [d?.note.id]);
  const setStatus = (doc: ProjectDoc, s: (typeof DOC_STATUSES)[number]) => void updateNote(doc.note.id, { body: setDocStatus(doc.note.body, s) });
  if (!d) return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-muted">No docs yet. Start with a <b className="text-ink">PRD</b> (what and why), then an <b className="text-ink">RFC</b> (how), record decisions as <b className="text-ink">ADRs</b>, and turn the plan into task cards.</div>
      <NewDocRow sp={sp} onSel={onSel} />
    </div>
  );
  const ps = paragraphs(d.note.body);
  const reqIds = [...new Set([...d.note.body.matchAll(/\bREQ-\d+\b/g)].map((m) => m[0]))].slice(0, 6);
  const linked = cardsOfDoc(cards, d.note).length;
  const kind = DOC_KINDS.find((k) => k.kind === d.kind)!;
  const ctx = d.status === "approved" && d.approved ? `Approved ${dayMon(d.approved)}` : d.status === "superseded" && d.supersededBy ? `→ ${d.supersededBy}` : d.status === "rejected" && d.reason ? d.reason : d.status === "review" && d.owner ? `${d.owner} reviewing` : "";
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
        <DocPill s={d.status} />
        <span className="text-muted">{kind.short}</span>
        {owner ? (
          <input autoFocus defaultValue={d.owner} aria-label="Owner" className="h-7 w-28 rounded-[6px] border border-accent bg-bg px-2 outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setOwner(false); }}
            onBlur={(e) => { setOwner(false); const v = e.target.value.trim(); if (v !== d.owner) void updateNote(d.note.id, { body: setFrontMatter(d.note.body, { owner: v }) }); }} />
        ) : (
          <button onClick={() => setOwner(true)} title="Change owner" className="flex items-center gap-1.5 hover:text-ink"><Glyph name="owner" size={14} color="var(--muted)" />{d.owner ? d.owner[0].toUpperCase() + d.owner.slice(1) : <span className="text-muted">Add owner</span>}</button>
        )}
        <span className="text-muted">{relTime(d.note.updatedAt)}</span>
        {ctx && <span className="text-muted" dir="auto">· {ctx}</span>}
        <span className="flex-1" />
        {!phone && (
          <div role="radiogroup" aria-label="Doc status" className="flex gap-0.5 rounded-[8px] border border-line bg-bg p-[3px] text-[12px]">
            {DOC_STATUSES.map((s) => (
              <button key={s} role="radio" aria-checked={d.status === s} onClick={() => setStatus(d, s)} className={cx("flex h-6 items-center gap-[5px] rounded-[6px] px-2", d.status === s ? "bg-surface-2 font-semibold" : "font-[450] text-muted hover:text-ink")}
                style={d.status === s ? { color: DOC_STATUS_COLOR[s] } : undefined}><Glyph name={DOC_STATUS_GLYPH[s]} size={12} />{DOC_STATUS_LABEL[s]}</button>
            ))}
          </div>
        )}
        {phone && (
          <select aria-label="Doc status" value={d.status} onChange={(e) => setStatus(d, e.target.value as ProjectDoc["status"])} className="h-7 rounded-[7px] border border-line bg-bg px-1.5 text-[12px]">
            {DOC_STATUSES.map((s) => <option key={s} value={s}>{DOC_STATUS_LABEL[s]}</option>)}
          </select>
        )}
      </div>
      <article className="flex max-w-[680px] flex-col gap-3 font-serif leading-[1.75]" style={{ fontSize: phone ? 16 : 17 }}>
        <h1 className="m-0 cursor-pointer font-bold leading-[1.2] hover:underline" style={{ fontSize: phone ? 24 : 32 }} onClick={() => openNote(d.note.id)} title="Open doc" dir="auto">{d.note.title}</h1>
        {ps[0] && <p className="m-0" dir="auto">{ps[0]}</p>}
        {(reqIds.length > 0 || linked > 0) && <p className="m-0 font-sans text-[13px] text-muted">{[reqIds.length ? `Covers ${reqIds.join(" · ")}` : null, linked ? `${linked} task${linked === 1 ? "" : "s"} link here` : null].filter(Boolean).join(" · ")}</p>}
        {ps[1] && <p className="m-0 opacity-50" dir="auto">{ps[1].length > 160 ? ps[1].slice(0, 160) + "…" : ps[1]}</p>}
      </article>
      {!phone && <NewDocRow sp={sp} onSel={onSel} />}
      <section className="flex flex-col rounded-[12px] border border-line">
        <span className="px-3.5 py-2 text-[12px] font-semibold text-muted">All docs · {docs.length}</span>
        {docs.map((x) => (
          <button key={x.note.id} onClick={() => onSel(x.note.id)} className={cx("flex min-h-10 items-center gap-2.5 border-t border-line px-3.5 text-left hover:bg-surface", x.note.id === d.note.id && "bg-surface")}>
            <Glyph name={DOC_STATUS_GLYPH[x.status]} size={16} color={DOC_STATUS_COLOR[x.status]} />
            <span className="w-10 shrink-0 text-[12px] text-muted">{DOC_KINDS.find((k) => k.kind === x.kind)?.short}</span>
            <span className="min-w-0 flex-1 truncate" dir="auto">{x.note.title}</span>
            {!phone && x.owner && <span className="text-[12px] text-muted">{x.owner}</span>}
            <span className="text-[12px]" style={{ color: DOC_STATUS_COLOR[x.status] }}>{DOC_STATUS_LABEL[x.status]}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
function NewDocRow({ sp, onSel }: { sp: Space; onSel: (id: string) => void }) {
  const label: Record<DocKind, string> = { prd: "PRD", rfc: "RFC", adr: "ADR", requirements: "Requirements", plan: "Action plan", meeting: "Meeting notes", spec: "Spec", draft: "Draft" };
  return (
    <div className="flex flex-wrap gap-2">
      <span className="self-center text-muted">New doc:</span>
      {(Object.keys(label) as DocKind[]).map((k) => <button key={k} title={DOC_KINDS.find((x) => x.kind === k)?.hint} onClick={() => void newDoc(sp, k).then(onSel)} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface">{label[k]}</button>)}
    </div>
  );
}
