// Confirm step of Plan my day and of Accept all (round 8, page 55): proposed blocks, each can be left out; nothing is
// written to the Calendar note before Add.
import { useRef, useState } from "react";
import type { CalItem } from "../../lib/calendar";
import { addBlocks } from "../../lib/calendar-store";
import { toast } from "../../lib/store";
import { hhmm, V } from "./parts";
import { t } from "../../lib/i18n";

/** The confirm step of Plan my day (and Accept all in the week): proposed blocks, each can be left out; nothing is written before Add. */
export function PlanSheet({ items, onClose, planTitle }: { items: CalItem[]; onClose: () => void; planTitle: (id: string | null | undefined) => string | null }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const keep = items.filter((x) => !off.has(x.id));
  const busy = useRef(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      <span style={{ color: V.mu }}>{items.length ? t("Free slots filled from each plan’s pace and today’s review load. Untick anything you don’t want, then confirm.") : t("No free slot or nothing left to plan today.")}</span>
      {items.map((x) => {
        const on = !off.has(x.id);
        return (
          <label key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, border: `1.5px dashed ${x.color}`, background: on ? `color-mix(in srgb,${x.color} 8%,transparent)` : "transparent", opacity: on ? 1 : 0.5, cursor: "pointer" }}>
            <input type="checkbox" checked={on} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} style={{ accentColor: "var(--accent)" }} />
            <span style={{ width: 92, fontSize: 12, color: V.mu, fontVariantNumeric: "tabular-nums" }}>{hhmm(x.start!)} – {hhmm(x.start! + x.dur)}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><b dir="auto" style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.title}</b><span dir="auto" style={{ fontSize: 11.5, color: V.mu }}>{x.sub}</span></span>
          </label>
        );
      })}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: `1px solid ${V.bd}` }}>{t("Cancel")}</button>
        <button disabled={!keep.length} onClick={async () => { if (busy.current) return; busy.current = true; await addBlocks(keep.map((x) => ({ title: x.title, date: x.date, start: x.start, dur: x.dur, plan: planTitle(x.planId) }))); toast(t("{n} blocks added to your calendar", { n: keep.length })); onClose(); }}
          className="disabled:opacity-50" style={{ height: 34, padding: "0 14px", borderRadius: 9, background: V.ac, color: V.af, fontWeight: 650 }}>{t("Add {n} blocks", { n: keep.length })}</button>
      </div>
    </div>
  );
}
