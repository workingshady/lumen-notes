// Project hub · Assistant (design round 4: HubDesk "assistant", Lumen 15 R4-15P). Plain labels, no sparkle.
// Reads this project's docs, cards and requirements; nothing is changed until "Insert as note".
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote } from "../lib/actions";
import { aiRun, api, getToken } from "../lib/api";
import { DEMO } from "../lib/db";
import { docOf, type DocKind, type Requirement, type TaskCard } from "../lib/project";
import { hydrate, render } from "../lib/markdown";
import { openNote, toast } from "../lib/store";
import { cx } from "../components/ui";
import { addDays, dayMon, todayISO } from "./hub-parts";

const ACTIONS: { id: string; label: string; title: string; kind: DocKind }[] = [
  { id: "project_plan", label: "Plan from a goal", title: "Plan", kind: "plan" },
  { id: "project_status", label: "Weekly status", title: "Weekly status", kind: "draft" },
  { id: "project_next", label: "Next actions", title: "Next actions", kind: "plan" },
  { id: "project_risks", label: "Risks", title: "Risks and open questions", kind: "draft" },
  { id: "project_decisions", label: "Decision summary", title: "Decision summary", kind: "adr" },
  { id: "project_reqs", label: "Draft requirements", title: "Draft requirements", kind: "requirements" },
];

/** The project context sent to the model: goal, deadline, docs (trimmed), cards, requirements. */
export function projectContext(sp: Space, notes: Note[], cards: TaskCard[], reqs: Requirement[]) {
  const docs = notes.map(docOf).filter(Boolean).map((d) => `### ${d!.kind.toUpperCase()} (${d!.status}): ${d!.note.title}\n${d!.note.body.replace(/^---[\s\S]*?---/, "").slice(0, 2500)}`).join("\n\n");
  const board = cards.map((c) => `- [${c.status}] ${c.text}${c.due ? ` (due ${c.due})` : ""}${c.start ? ` (start ${c.start})` : ""}${c.estimate ? ` ~${c.estimate}` : ""}${c.epic ? ` #${c.epic}` : ""}${c.owner ? ` @${c.owner}` : ""}${c.reqs.length ? ` ${c.reqs.join(" ")}` : ""}`).join("\n");
  const rq = reqs.map((r) => `- ${r.id} (${r.priority ?? "?"}) ${r.text} → ${r.state}`).join("\n");
  return `Project: ${sp.name}\nGoal: ${sp.props.goal ?? "(none)"}\nDeadline: ${sp.props.deadline ?? "(none)"}\nToday: ${todayISO()}\n\n## Docs\n${docs || "(none)"}\n\n## Task cards\n${board || "(none)"}\n\n## Requirements\n${rq || "(none)"}`.slice(0, 22000);
}

export interface AssistantHandle { ask: () => void }
export const Assistant = forwardRef<AssistantHandle, { sp: Space; notes: Note[]; cards: TaskCard[]; reqs: Requirement[] }>(function Assistant({ sp, notes, cards, reqs }, ref) {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<{ id: string; title: string; kind: DocKind; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");
  const askIn = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ ask: () => { setAsking(true); setTimeout(() => askIn.current?.focus(), 0); } }));
  useEffect(() => { if (box.current && out) { box.current.innerHTML = render(out.text); hydrate(box.current); } }, [out]);
  const sources = notes.filter((n) => !n.deleted && (docOf(n) || cards.some((c) => c.note.id === n.id))).length;
  const ready = () => { if (!getToken() && !DEMO) { toast("The assistant needs sync on (Settings › Sync)."); return false; } return true; };
  async function run(id: string) {
    if (!ready()) return;
    const a = ACTIONS.find((x) => x.id === id)!;
    setBusy(id);
    try {
      const text = await aiRun(id, projectContext(sp, notes, cards, reqs));
      const today = todayISO();
      const title = id === "project_status" ? `${a.title} · ${dayMon(addDays(today, -6)).split(" ")[0]}–${dayMon(today)}` : a.title;
      setOut({ id, title, kind: a.kind, text });
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  async function ask() {
    const question = q.trim();
    if (!question || !ready()) return;
    setBusy("ask");
    try {
      const r = await api<{ text: string }>("/ai/project", { method: "POST", json: { question, context: projectContext(sp, notes, cards, reqs) } });
      setOut({ id: "ask", title: question, kind: "draft", text: r.text });
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  async function insert() {
    if (!out) return;
    const title = `${out.title}: ${sp.name} (${todayISO()})`.replace(/\s+/g, " ");
    const n = await createNote({ title, body: `# ${title}\n\n${out.text}\n`, spaceId: sp.id, fm: { doc: out.kind, docstatus: "draft" } });
    openNote(n.id);
  }
  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => {
          const on = out?.id === a.id || busy === a.id;
          return (
            <button key={a.id} onClick={() => void run(a.id)} disabled={!!busy} title={a.label}
              className={cx("flex h-8 items-center rounded-[8px] border px-3 disabled:cursor-wait", on ? "font-semibold" : "font-[450] hover:bg-surface")}
              style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "color-mix(in srgb, var(--accent) 12%, transparent)" : undefined }}>
              {busy === a.id ? "Working…" : a.label}
            </button>
          );
        })}
      </div>
      {asking && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <input ref={askIn} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this project, e.g. what blocks the launch?" dir="auto" aria-label="Ask about this project"
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-3 outline-none focus:border-accent" />
          <button disabled={!q.trim() || !!busy} className="h-9 rounded-[8px] bg-accent px-3.5 font-semibold text-accent-fg disabled:opacity-50">{busy === "ask" ? "Working…" : "Ask"}</button>
        </form>
      )}
      {out ? (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5 leading-5">
          <span className="font-semibold" dir="auto">{out.title}</span>
          <div ref={box} className="prose prose-sm !max-w-none text-[13px]" />
          <span className="text-[12px] text-muted">From {sources} note{sources === 1 ? "" : "s"} in this project · nothing is changed until you insert it</span>
          <div className="flex gap-2">
            <button onClick={() => void insert()} className="flex h-[30px] items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg hover:brightness-110">Insert as note</button>
            <button onClick={() => { void navigator.clipboard?.writeText(out.text); toast("Copied"); }} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 hover:bg-surface-2">Copy</button>
            <button onClick={() => setOut(null)} className="ml-auto text-[12px] text-muted hover:text-ink">Clear</button>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-line p-6 text-muted">
          Pick an action. The assistant reads this project's docs, cards and requirements (sent to Cloudflare Workers AI); answers can be wrong, so review before you insert them.
        </div>
      )}
    </div>
  );
});
