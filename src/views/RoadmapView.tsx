import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { CalendarDays, ChevronDown, Circle, CircleCheck, CircleDashed, CircleSlash, FileText, ListTree, Lock, Network } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { layout } from "../lib/canvas";
import { linkTopicNote, progress, roadmap, setTopicStatus, type Module, type Topic, type TopicStatus } from "../lib/parse";
import { openNote, useVault } from "../lib/store";
import { cx, Segmented } from "../components/ui";

const ICON: Record<TopicStatus, typeof Circle> = { todo: Circle, learning: CircleDashed, done: CircleCheck, skipped: CircleSlash };
const COLOR: Record<TopicStatus, string> = { todo: "var(--muted)", learning: "var(--info)", done: "var(--success)", skipped: "var(--muted)" };
const NEXT: Record<TopicStatus, TopicStatus> = { todo: "learning", learning: "done", done: "todo", skipped: "todo" };

export function Ring({ pct, size = 44 }: { pct: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-2)" strokeWidth={4} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--success)" strokeWidth={4} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" />
      <text x="50%" y="50%" transform={`rotate(90 ${size / 2} ${size / 2})`} textAnchor="middle" dominantBaseline="central" fontSize={size / 4} fill="var(--text)">{pct}%</text>
    </svg>
  );
}

export function RoadmapView({ note, compact }: { note: Note; compact?: boolean }) {
  const [view, setView] = useState<"outline" | "tree" | "timeline">("outline");
  const mods = useMemo(() => roadmap(note.body), [note.body]);
  const p = progress(mods);
  const v = useVault();

  const setStatus = (t: Topic, s: TopicStatus) => void updateNote(note.id, { body: setTopicStatus(note.body, t.line, s) });
  async function openTopic(t: Topic) {
    const existing = t.note ? v.byTitle.get(t.note.toLowerCase()) : v.byTitle.get(t.name.toLowerCase());
    if (existing) { if (!t.note) void updateNote(note.id, { body: linkTopicNote(note.body, t.line, existing.title) }); openNote(existing.id); return; }
    const n = await createNote({ template: "lesson", title: t.note ?? t.name, spaceId: note.spaceId, folderId: note.folderId });
    if (!t.note) await updateNote(note.id, { body: linkTopicNote(note.body, t.line, n.title) });
    if (t.status === "todo") await updateNote(note.id, { body: setTopicStatus(linkTopicNote(note.body, t.line, n.title), t.line, "learning") });
    openNote(n.id, "edit");
  }

  if (!mods.some((m) => m.topics.length)) {
    return <div className="p-8 text-[13px] text-muted">No topics yet. Switch to <b>Edit</b> and add lines like <code>- [ ] Topic (needs: Other)</code> under <code>## Module</code> headings.</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        {!compact && <Ring pct={p.pct} />}
        <div className="text-[13px]"><b>{p.done}</b> / {p.total} topics done<div className="text-[12px] text-muted">{mods.length} modules · {mods.flatMap((m) => m.topics).filter((t) => t.locked).length} locked</div></div>
        <Segmented className="ml-auto" value={view} onChange={setView} options={[
          { value: "outline", label: <><ListTree size={13} /> Outline</> },
          { value: "tree", label: <><Network size={13} /> Skill tree</> },
          { value: "timeline", label: <><CalendarDays size={13} /> Timeline</> },
        ]} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "outline" && <Outline mods={mods} onStatus={setStatus} onOpen={openTopic} />}
        {view === "tree" && <ReactFlowProvider><Tree mods={mods} onOpen={openTopic} /></ReactFlowProvider>}
        {view === "timeline" && <Timeline mods={mods} onOpen={openTopic} onStatus={setStatus} />}
      </div>
    </div>
  );
}

function TopicRow({ t, onStatus, onOpen }: { t: Topic; onStatus: (t: Topic, s: TopicStatus) => void; onOpen: (t: Topic) => void }) {
  const Icon = ICON[t.status];
  return (
    <div className={cx("group flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-surface-2", t.locked && "opacity-55")}>
      <button title={`${t.status}. Click: ${NEXT[t.status]}, right-click: skip`} onClick={() => onStatus(t, NEXT[t.status])} onContextMenu={(e) => { e.preventDefault(); onStatus(t, t.status === "skipped" ? "todo" : "skipped"); }} className="flex size-7 items-center justify-center">
        {t.locked ? <Lock size={16} className="text-muted" /> : <Icon size={18} style={{ color: COLOR[t.status] }} />}
      </button>
      <button onClick={() => onOpen(t)} className={cx("min-w-0 flex-1 truncate text-left text-[13.5px]", t.status === "done" && "text-muted line-through decoration-muted/50", t.status === "skipped" && "text-muted italic")}>
        {t.name}
        {t.needs.length > 0 && <span className="ml-2 text-[11.5px] text-muted">needs {t.needs.join(", ")}</span>}
      </button>
      {t.due && <span className={cx("text-[11.5px] tabular-nums", t.status !== "done" && t.due < new Date().toISOString().slice(0, 10) ? "text-bad" : "text-muted")}>{t.due}</span>}
      <button title={t.note ? `Open ${t.note}` : "Create lesson note"} onClick={() => onOpen(t)} className={cx("flex size-7 items-center justify-center rounded-md text-muted hover:text-ink", !t.note && "opacity-0 group-hover:opacity-100")}>
        <FileText size={15} className={t.note ? "text-link" : ""} />
      </button>
    </div>
  );
}

function Outline({ mods, onStatus, onOpen }: { mods: Module[]; onStatus: (t: Topic, s: TopicStatus) => void; onOpen: (t: Topic) => void }) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      {mods.map((m, i) => {
        const p = progress([m]);
        const open = !closed.has(i);
        return (
          <section key={i} className="rounded-[12px] border border-line bg-surface">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setClosed((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
              <ChevronDown size={16} className={cx("text-muted transition-transform", !open && "-rotate-90")} />
              <span className="flex-1 font-semibold">{m.name}</span>
              {m.due && <span className="text-[11.5px] text-muted">🏁 {m.due}</span>}
              <span className="text-[12px] tabular-nums text-muted">{p.done}/{p.total}</span>
              <span className="h-1.5 w-20 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
            </button>
            {open && <div className="border-t border-line p-1.5">{m.topics.map((t) => <TopicRow key={t.line} t={t} onStatus={onStatus} onOpen={onOpen} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}

type TData = { t: Topic };
const TopicNode = memo(({ data }: NodeProps<RFNode<TData>>) => {
  const t = data.t;
  const Icon = t.locked ? Lock : ICON[t.status];
  return (
    <div className={cx("flex h-full items-center gap-2 rounded-[12px] border-2 px-3 text-[13px]", t.locked && "opacity-50")}
      style={{ borderColor: t.status === "done" ? "var(--success)" : t.status === "learning" ? "var(--info)" : "var(--border)", background: t.status === "done" ? "color-mix(in oklab, var(--success) 14%, var(--surface))" : "var(--surface)" }}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Icon size={16} style={{ color: t.locked ? "var(--muted)" : COLOR[t.status] }} className="shrink-0" />
      <span className="line-clamp-2">{t.name}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

function Tree({ mods, onOpen }: { mods: Module[]; onOpen: (t: Topic) => void }) {
  const { nodes, edges } = useMemo(() => {
    const topics = mods.flatMap((m) => m.topics);
    const byName = new Map(topics.map((t) => [t.name.toLowerCase(), t]));
    const es: { from: string; to: string }[] = [];
    for (const t of topics) for (const n of t.needs) { const d = byName.get(n.toLowerCase()); if (d) es.push({ from: String(d.line), to: String(t.line) }); }
    // Topics without explicit prerequisites follow the previous topic in their module, so the tree reads left→right.
    for (const m of mods) m.topics.forEach((t, i) => { if (i > 0 && !t.needs.length) es.push({ from: String(m.topics[i - 1].line), to: String(t.line) }); });
    const laid = layout({ nodes: topics.map((t) => ({ id: String(t.line), type: "text", text: t.name, x: 0, y: 0, width: 220, height: 56 })), edges: es.map((e, i) => ({ id: `e${i}`, fromNode: e.from, toNode: e.to })) }, "tree");
    const pos = new Map(laid.nodes!.map((n) => [n.id, n]));
    return {
      // tree layout is top→down; rotate to left→right
      nodes: topics.map((t): RFNode<TData> => ({ id: String(t.line), type: "topic", position: { x: pos.get(String(t.line))!.y * 1.4, y: pos.get(String(t.line))!.x * 0.4 }, width: 220, height: 56, data: { t }, draggable: false, connectable: false })),
      edges: es.map((e, i): Edge => ({ id: `e${i}`, source: e.from, target: e.to, markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 1.5 } })),
    };
  }, [mods]);
  return (
    <div className="h-full min-h-[420px]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ topic: TopicNode }} fitView proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onOpen((n.data as TData).t)} nodesConnectable={false} minZoom={0.1}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}

function Timeline({ mods, onOpen, onStatus }: { mods: Module[]; onOpen: (t: Topic) => void; onStatus: (t: Topic, s: TopicStatus) => void }) {
  const topics = mods.flatMap((m) => m.topics.map((t) => ({ ...t, due: t.due ?? m.due })));
  const dated = topics.filter((t) => t.due).sort((a, b) => a.due!.localeCompare(b.due!));
  const undated = topics.filter((t) => !t.due);
  const byMonth = new Map<string, typeof dated>();
  dated.forEach((t) => byMonth.set(t.due!.slice(0, 7), [...(byMonth.get(t.due!.slice(0, 7)) ?? []), t]));
  return (
    <div className="mx-auto max-w-3xl p-4">
      {!dated.length && <p className="mb-4 text-[13px] text-muted">Add dates with <code>📅 2026-12-01</code> on topics or module headings to see them here.</p>}
      {[...byMonth].map(([month, ts]) => (
        <div key={month} className="mb-5">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted">{new Date(month + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
          <div className="border-l-2 border-line pl-3">{ts.map((t) => <TopicRow key={t.line} t={t} onOpen={onOpen} onStatus={onStatus} />)}</div>
        </div>
      ))}
      {undated.length > 0 && (
        <div><div className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted">No date · {undated.length}</div>
          {undated.map((t) => <TopicRow key={t.line} t={t} onOpen={onOpen} onStatus={onStatus} />)}</div>
      )}
    </div>
  );
}
