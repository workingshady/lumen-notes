import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Brain, Check, Flame, Pin, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { STATUSES } from "../../shared/types";
import { createNote } from "../lib/actions";
import { db } from "../lib/db";
import { progress, roadmap, tasks, words } from "../lib/parse";
import { getSettings } from "../lib/settings";
import { go, openNote, setUI, useUI, useVault } from "../lib/store";
import { useDueCards } from "../components/Review";
import { STATUS_COLOR } from "../components/ui";
import { Ring } from "./RoadmapView";

const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export function Home() {
  const v = useVault();
  const ui = useUI();
  const s = getSettings();
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const versions = useLiveQuery(() => db.versions.where("createdAt").above(Date.now() - 140 * DAY).toArray(), []) ?? [];
  const due = useDueCards(v.notes)?.length ?? 0;
  const [capture, setCapture] = useState("");
  const today = dayKey(Date.now());

  const openTasks = useMemo(() => v.notes.filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body).filter((t) => !t.done && t.due && t.due <= today).map((t) => ({ ...t, note: n }))), [v.notes, today]);
  const byStatus = STATUSES.map((st) => [st, v.notes.filter((n) => n.status === st).length] as const);
  const totalStatus = byStatus.reduce((a, [, c]) => a + c, 0);
  const courses = v.spaces.filter((sp) => sp.kind === "course" && !sp.archived && sp.roadmapId).map((sp) => ({ sp, p: progress(roadmap(v.byId.get(sp.roadmapId!)?.body ?? "")) }));

  // Activity: edits (versions, notes updated) + study minutes, last 20 weeks.
  const activity = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of versions) m.set(dayKey(x.createdAt), (m.get(dayKey(x.createdAt)) ?? 0) + 1);
    for (const n of v.notes) m.set(dayKey(n.updatedAt), (m.get(dayKey(n.updatedAt)) ?? 0) + 1);
    for (const se of sessions) if (!se.deleted) m.set(dayKey(se.at), (m.get(dayKey(se.at)) ?? 0) + se.minutes / 10);
    return m;
  }, [versions, v.notes, sessions]);
  let streak = 0;
  for (let d = Date.now(); activity.get(dayKey(d)); d -= DAY) streak++;
  if (!streak && activity.get(dayKey(Date.now() - DAY))) for (let d = Date.now() - DAY; activity.get(dayKey(d)); d -= DAY) streak++;
  const weekMin = sessions.filter((x) => !x.deleted && x.at > Date.now() - 7 * DAY).reduce((a, x) => a + x.minutes, 0);
  const totalWords = useMemo(() => v.notes.reduce((a, n) => a + (n.type === "canvas" ? 0 : words(n.body)), 0), [v.notes]);
  const recent = [...v.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const pinned = v.notes.filter((n) => n.pinned).slice(0, 8);
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Burning the midnight oil" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const card = "rounded-[14px] border border-line bg-surface p-4";
  return (
    <div className="h-full overflow-y-auto">
      <div className="safe-t mx-auto max-w-5xl space-y-4 p-4 md:p-8">
        <div>
          <div className="text-[13px] text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="text-[26px] font-bold tracking-tight">{hello}{s.author ? `, ${s.author.split(" ")[0]}` : ""} {s.avatar}</h1>
        </div>

        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const text = capture.trim();
          if (!text) return;
          const [first, ...rest] = text.split("\n");
          await createNote({ title: first.slice(0, 80), body: rest.join("\n") || (first.length > 80 ? first : ""), spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId });
          setCapture("");
        }}>
          <input value={capture} onChange={(e) => setCapture(e.target.value)} placeholder="Quick capture: an idea, a link, something you learned…" className="h-12 flex-1 rounded-[12px] border border-line bg-surface px-4 text-[15px] outline-none focus:border-accent" />
          <button className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-accent text-accent-fg" aria-label="Capture"><Plus size={20} /></button>
        </form>

        <div className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => go("review")} className={card + " text-left hover:border-learn"}>
            <div className="flex items-center gap-2 text-[12px] text-muted"><Brain size={15} className="text-learn" /> Flashcards due</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{due}</div>
            <div className="text-[12px] text-muted">{due ? "Review now →" : "All caught up"}</div>
          </button>
          <button onClick={() => go("tasks")} className={card + " text-left hover:border-warn"}>
            <div className="flex items-center gap-2 text-[12px] text-muted"><Check size={15} className="text-warn" /> Tasks due today</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{openTasks.length}</div>
            <div className="truncate text-[12px] text-muted">{openTasks[0]?.text ?? "Nothing due"}</div>
          </button>
          <div className={card}>
            <div className="flex items-center gap-2 text-[12px] text-muted"><Flame size={15} className="text-accent" /> Study streak</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{streak}<span className="text-[14px] font-normal text-muted"> days</span></div>
            <div className="text-[12px] text-muted">{weekMin} min focused this week · {totalWords.toLocaleString()} words total</div>
          </div>
        </div>

        <div className={card}>
          <div className="mb-3 flex items-center justify-between"><div className="font-semibold">Activity</div><div className="text-[12px] text-muted">last 20 weeks</div></div>
          <Heatmap data={activity} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <div className="mb-3 font-semibold">Learning progress</div>
            {totalStatus ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
                  {byStatus.map(([st, c]) => c ? <div key={st} style={{ width: `${(c / totalStatus) * 100}%`, background: STATUS_COLOR[st] }} title={`${st}: ${c}`} /> : null)}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-muted">
                  {byStatus.map(([st, c]) => <button key={st} onClick={() => go("kanban")} className="flex items-center gap-1.5 capitalize"><span className="size-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />{st} {c}</button>)}
                </div>
              </>
            ) : <div className="text-[13px] text-muted">Set a status on lessons (Info panel) to track what you're learning.</div>}
            {courses.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-line pt-3">
                {courses.map(({ sp, p }) => (
                  <button key={sp.id} onClick={() => go("space", { spaceId: sp.id })} className="flex w-full items-center gap-3 rounded-[10px] p-1.5 text-left hover:bg-surface-2">
                    <Ring pct={p.pct} size={38} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{sp.icon} {sp.name}</span><span className="text-[12px] text-muted">{p.done}/{p.total} topics{sp.props.target ? ` · target ${sp.props.target}` : ""}</span></span>
                    <ArrowRight size={15} className="text-muted" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={card}>
            <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Continue</div><button className="text-[12px] text-link" onClick={() => go("notes", { spaceId: "all", folderId: null, tag: null })}>All notes</button></div>
            {recent.length ? recent.map((n) => (
              <button key={n.id} onClick={() => openNote(n.id)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2">
                <span className="size-1.5 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--border)" }} />
                <span className="flex-1 truncate">{n.title}</span><span className="text-[11.5px] text-muted">{v.spaceMap.get(n.spaceId)?.icon}</span>
              </button>
            )) : (
              <div className="space-y-2 text-[13px] text-muted">
                <p>Welcome to Lumen. Start with a space for something you're learning.</p>
                <button className="flex items-center gap-1.5 text-link" onClick={() => setUI({ newSpace: true })}><Sparkles size={14} /> Create a course space with a roadmap</button>
              </div>
            )}
          </div>
        </div>

        {pinned.length > 0 && (
          <div className={card}>
            <div className="mb-2 flex items-center gap-1.5 font-semibold"><Pin size={14} className="text-accent" /> Pinned</div>
            <div className="flex flex-wrap gap-2">{pinned.map((n) => <button key={n.id} onClick={() => openNote(n.id)} className="rounded-full border border-line px-3 py-1 text-[13px] hover:border-accent">{n.title}</button>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Heatmap({ data }: { data: Map<string, number> }) {
  const weeks = 20;
  const end = new Date();
  const start = new Date(end.getTime() - (weeks * 7 - 1 + end.getDay()) * DAY);
  const cols: { k: string; v: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks + 1; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const t = start.getTime() + (w * 7 + d) * DAY;
      col.push({ k: dayKey(t), v: data.get(dayKey(t)) ?? 0, future: t > end.getTime() });
    }
    cols.push(col);
  }
  const lvl = (x: number) => (x <= 0 ? 0 : x < 2 ? 1 : x < 5 ? 2 : x < 10 ? 3 : 4);
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {cols.map((c, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {c.map((d) => (
            <div key={d.k} title={`${d.k}: ${Math.round(d.v)}`} className="size-[13px] rounded-[3px]"
              style={{ background: d.future ? "transparent" : lvl(d.v) ? `color-mix(in oklab, var(--accent) ${[0, 25, 50, 75, 100][lvl(d.v)]}%, var(--surface-2))` : "var(--surface-2)" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
