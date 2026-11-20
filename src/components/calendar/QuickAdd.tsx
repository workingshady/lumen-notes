// Quick add (round 8, page 55 I: "Quick add parses dates, #tags and !priority"). Live preview of what was understood;
// Enter adds the task as a Markdown checkbox.
import { useMemo, useState } from "react";
import { Glyph } from "../Glyph";
import { quickParse, type Parsed } from "../../lib/calendar-tasks";
import type { CalPlan } from "../../lib/calendar-plans";
import { dueText, hhmm, V } from "./parts";
import { t } from "../../lib/i18n";

export function QuickAdd({ today, plans, defaultDue, onAdd, onDone, inline, phone }: { today: string; plans: CalPlan[]; defaultDue?: string | null; onAdd: (p: Parsed, plan: CalPlan | null) => Promise<void> | void; onDone?: () => void; inline?: boolean; phone?: boolean }) {
  const [v, setV] = useState("");
  const p = useMemo(() => quickParse(v, today, plans), [v, today, plans]);
  const due = p.due ?? defaultDue ?? null;
  const plan = plans.find((x) => x.id === p.planId) ?? null;
  const submit = async () => {
    if (!p.text) return;
    await onAdd({ ...p, due }, plan);
    setV("");
    if (!inline) onDone?.();
  };
  const chip = (k: string, l: string, c = V.mu) => <span key={k} style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, background: V.sf2, color: c, whiteSpace: "nowrap" }}>{l}</span>;
  const chips = [
    due && chip("d", dueText({ due, time: p.time }, today, true) + (p.time != null && due !== today ? ` ${hhmm(p.time)}` : ""), due < today ? V.da : V.ac),
    p.prio && chip("p", t(p.prio === "high" ? "High" : p.prio === "medium" ? "Medium" : "Low"), p.prio === "high" ? V.da : V.mu),
    plan && chip("pl", plan.title, plan.color),
    p.est && chip("e", t("{n} min", { n: p.est })),
    p.repeat && chip("r", t("every {r}", { r: p.repeat })),
    ...p.tags.filter((g) => !plan || !plan.aliases.includes(g.slice(1).toLowerCase())).map((g) => chip(g, g, V.ln)),
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${V.bd}`, background: V.sf, fontSize: 13, color: V.mu }} className="focus-within:border-accent">
        <span style={{ fontSize: 16 }}>+</span>
        <input id="lumen-add-task" autoFocus={!inline} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onDone?.(); }} dir="auto"
          placeholder={t("Add a task… try “lab report fri #dl !high”")} aria-label={t("Add a task")} className="placeholder:text-muted" style={{ flex: 1, minWidth: 0, background: "transparent", color: V.tx, outline: "none" }} />
        {inline && !phone && <span style={{ fontSize: 11, border: `1px solid ${V.bd}`, padding: "1px 6px", borderRadius: 5 }}>N</span>}
      </label>
      {v.trim() && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "0 4px" }}><Glyph name="check" size={12} color="var(--muted)" />{chips.length ? chips : <span style={{ fontSize: 11, color: V.mu }}>{t("No date · goes to Inbox")}</span>}</div>}
    </div>
  );
}
