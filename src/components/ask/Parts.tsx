// R8-56 pieces: the visible waiting (step line + steps card + slow state), the sources panel, the left rail that
// replaces the app sidebar while Ask is open, and the saved-as-note banner.
import { useEffect, useState } from "react";
import type { ChatMessage, ChatSource } from "../../../shared/types";
import type { Live } from "../../lib/ask";
import { citedIn } from "../../lib/chat";
import { DEMO } from "../../lib/db";
import { getToken } from "../../lib/api";
import { t } from "../../lib/i18n";
import { go, openNote, setUI } from "../../lib/store";
import { closeAsk } from "../../lib/ask";
import { plainText } from "../nav-text";
import { Glyph } from "../Glyph";
import type { SavedInfo } from "./actions";

export const SLOW_MS = 6000;
const AC = "color-mix(in srgb,var(--accent) 16%,transparent)";
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Re-render every 250 ms while `on` (elapsed-time labels). */
export function useNow(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => { if (!on) return; const i = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(i); }, [on]);
  return Date.now();
}
const isMock = () => DEMO && !getToken();
export const providerLabel = () => (isMock() ? t("Demo model") : "Workers AI");

export const AnswerBadge = () => (
  <span className="flex size-[22px] items-center justify-center rounded-[7px]" style={{ background: "color-mix(in srgb,var(--accent) 14%,transparent)", color: "var(--accent)" }}><Glyph name="assistant" size={13} stroke={1.9} /></span>
);

/** "Answered in 3.4 s · Workers AI · from 4 notes" above a finished answer. */
export function DoneLine({ m, n }: { m: ChatMessage; n: number }) {
  const parts = [m.ms ? t("Answered in {s}", { s: sec(m.ms) }) : t("Answered"), m.general ? t("general knowledge") : providerLabel(), !m.general && n ? t("from {n} notes", { n }) : ""].filter(Boolean);
  return <div className="flex items-center gap-2 text-[12px] text-muted"><AnswerBadge /><span dir="auto">{parts.join(" · ")}</span></div>;
}

/** The waiting, made visible: a status line + steps (searched, read, writing) with real timings. */
export function LiveSteps({ live, total, onStop, onScope }: { live: Live; total: number; onStop: () => void; onScope: () => void }) {
  const working = ["indexing", "rewriting", "asking", "streaming"].includes(live.status);
  const now = useNow(working);
  const t0 = live.t0 ?? now;
  const elapsed = now - t0;
  const waitingModel = live.status === "asking" && !live.text;
  const slow = waitingModel && elapsed - (live.tRead ?? 0) > SLOW_MS;
  const searching = live.status === "indexing" || live.status === "rewriting";
  const reading = !searching && live.tRead === undefined;
  const big = total > 500;
  const line = slow ? t("Still working · {s} s{big}", { s: Math.round(elapsed / 1000), big: big ? ` · ${t("large scope")}` : "" })
    : live.status === "streaming" ? t("Writing · {s} to first word", { s: sec(live.tFirst ?? elapsed) })
    : searching ? (live.status === "rewriting" ? t("Understanding the follow-up…") : t("Searching {n} notes…", { n: total.toLocaleString() }))
    : reading ? t("Reading the best matches…") : t("Writing…");
  const written = live.status === "streaming";
  type Step = { l: string; time: string; s: "done" | "run" | "wait" };
  const steps: Step[] = live.general ? [{ l: t("Answering from general knowledge"), time: written ? "" : sec(elapsed), s: "run" }] : [
    { l: searching ? (live.status === "rewriting" ? t("Understanding the follow-up…") : t("Searching {n} notes…", { n: total.toLocaleString() })) : t("Searched {n} notes", { n: total.toLocaleString() }), time: live.tIndex !== undefined ? sec(live.tIndex) : "", s: searching ? "run" : "done" },
    { l: live.tRead !== undefined ? t("Read {n} best matches", { n: live.nRead ?? live.sources.length }) : t("Reading the best matches"), time: live.tRead !== undefined ? sec(live.tRead - (live.tIndex ?? 0)) : "", s: live.tRead !== undefined ? "done" : searching ? "wait" : "run" },
    { l: slow ? t("Waiting for the model (busy)") : t("Writing the answer"), time: written ? "" : slow ? `${Math.round((elapsed - (live.tRead ?? 0)) / 1000)} s` : "", s: live.tRead !== undefined || live.general ? "run" : "wait" },
  ];
  if (!working) return null;
  return (
    <div className="flex flex-col gap-2.5" data-live-steps>
      <div className="flex items-center gap-2 text-[12px] text-muted" role="status"><AnswerBadge /><span dir="auto" data-step-line>{line}</span></div>
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
        {steps.map((s) => (
          <div key={s.l} className="flex items-center gap-2 text-[12.5px]" style={{ color: s.s === "done" ? "var(--muted)" : s.s === "wait" ? "var(--muted)" : "var(--text)", opacity: s.s === "wait" ? 0.6 : 1 }}>
            <span className={s.s === "run" ? "ask-spin" : ""} style={{ width: 14, height: 14, borderRadius: "50%", boxSizing: "border-box", border: `2px solid ${s.s === "done" ? "var(--success)" : "var(--border)"}`, borderTopColor: s.s === "done" ? "var(--success)" : s.s === "run" ? "var(--accent)" : "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>{s.s === "done" ? "✓" : ""}</span>
            <span dir="auto">{s.l}</span><span className="flex-1" /><span className="text-[11.5px] text-muted">{s.time}</span>
          </div>
        ))}
      </div>
      {slow && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted" data-slow>
          <span>{t("The model is busy. You can wait, or:")}</span>
          <button onClick={onStop} className="flex h-[28px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-ink hover:bg-surface-2"><Glyph name="stop" size={12} />{t("Stop")}</button>
          {big && <button onClick={onScope} className="flex h-[28px] items-center rounded-[8px] border border-line px-2.5 text-ink hover:bg-surface-2">{t("Use a smaller scope")}</button>}
        </div>
      )}
    </div>
  );
}

/** Saved-as-note banner under the answer. */
export function SavedBanner({ info }: { info: SavedInfo }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ background: "color-mix(in srgb,var(--success) 12%,transparent)" }} data-saved>
      <span style={{ color: "var(--success)" }}>✓</span>
      <span className="flex-1" dir="auto">{info.links ? t("Saved as {title} in {where}, with {n} source links and the question as a callout.", { title: info.title, where: info.where, n: info.links }) : t("Saved as {title} in {where}, with the question as a callout.", { title: info.title, where: info.where })}</span>
      <button onClick={() => { closeAsk(); openNote(info.noteId); }} className="font-semibold text-accent">{t("Open")}</button>
    </div>
  );
}

/** Right panel: the exact quotes behind the numbered citations. */
export function SourcesPanel({ sources, text, scopeName, hot, onOpen }: { sources: ChatSource[]; text: string; scopeName: string; hot?: number | null; onOpen: (id: string) => void }) {
  const used = citedIn(text);
  const list = used.size ? sources.filter((s) => used.has(s.n)) : sources;
  const notes = new Set(list.map((s) => s.noteId)).size;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-2 overflow-y-auto border-s border-line bg-surface p-3.5" aria-label={t("Sources")} data-sources-panel>
      <div className="flex items-center"><span className="flex-1 text-[13.5px] font-[650]">{t("Sources")}</span><span className="text-[11.5px] text-muted">{t("{n} notes", { n: notes })}</span></div>
      {list.map((s, i) => {
        const q = plainText(s.text).replace(/\s+/g, " ").trim().slice(0, 150) || s.text.replace(/\s+/g, " ").slice(0, 150);
        return (
          <button key={s.n} data-src={s.n} onClick={() => onOpen(s.noteId)} className="flex flex-col gap-1.5 rounded-[10px] border bg-bg p-2.5 text-start hover:bg-surface-2"
            style={{ borderColor: hot === s.n || (hot == null && i === 0) ? "color-mix(in srgb,var(--link) 50%,var(--border))" : "var(--border)" }}>
            <span className="flex items-center gap-2"><span className="rounded-[5px] px-1.5 text-[10.5px] font-bold" style={{ background: "color-mix(in srgb,var(--link) 18%,transparent)", color: "var(--link)" }}>{s.n}</span><span dir="auto" className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{s.title}</span></span>
            <span dir="auto" className="text-[11.5px] leading-4 text-muted">“{q}”</span>
            {s.heading && <span dir="auto" className="text-[10.5px] text-muted">{s.heading}</span>}
          </button>
        );
      })}
      <span className="pt-1 text-[11.5px] leading-4 text-muted">{t("Searched in {scope}. Change the scope below the input.", { scope: scopeName })}</span>
    </aside>
  );
}

/** Left rail shown instead of the app sidebar while Ask is open. */
export function Rail({ onNav }: { onNav?: () => void }) {
  const items: [string, string, () => void][] = [
    ["home", "Home", () => go("home")], ["today", "Today", () => go("today")], ["calendar", "Calendar", () => go("calendar")], ["task", "Tasks", () => go("tasks")],
    ["flashcards", "Review", () => go("review")], ["timeline", "Learning paths", () => go("notes", { filter: "paths" })], ["assistant", "Ask", () => {}], ["note", "Notes", () => go("notes")],
    ["search", "Search", () => setUI({ palette: true })],
  ];
  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-e border-line bg-surface pt-3.5" aria-label={t("Navigate")} data-ask-rail>
      {items.map(([g, label, run]) => {
        const on = g === "assistant";
        return (
          <button key={g} aria-label={t(label)} title={t(label)} aria-current={on ? "page" : undefined} onClick={() => { if (on) return; closeAsk(); onNav?.(); run(); }}
            className="flex size-10 items-center justify-center rounded-[10px] hover:bg-surface-2" style={{ background: on ? AC : undefined, color: on ? "var(--accent)" : "var(--muted)" }}>
            <Glyph name={g} size={19} />
          </button>
        );
      })}
    </nav>
  );
}
