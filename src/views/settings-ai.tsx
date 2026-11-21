// Settings › AI (Lumen 29 · R6-29A–E): per-feature switches with typical cost, the daily free allowance as a meter
// (coloured by feature, reset countdown, 7-day bars), near (≥ 80 %) and reached states, and an optional own daily cap.
// Usage comes from src/lib/ai-usage.ts (server: worker/ext/ai-usage.ts).
import { useEffect, useState } from "react";
import { Glyph } from "../components/Glyph";
import { api, getToken } from "../lib/api";
import { FREE_NEURONS, leftEstimate, limitState, setAiLimit, TYPICAL, useAiUsage, type AiUsage, type Feature } from "../lib/ai-usage";
import { fmtNum, t, tk } from "../lib/i18n";
import { useVault } from "../lib/store";
import { DEFAULT_SPACE } from "../lib/db";
import { setInboxProps } from "./settings-blog-ai";
import { SAdvanced, SBtn, SGroup, SHead, SPage, SRow, SSeg, SToggle } from "./settings-kit";
import { setAdvanced, useAdvanced } from "./settings-advanced";
/** Always group thousands (3,120 · 10,000) like the design. */
const G: Intl.NumberFormatOptions = { useGrouping: true };

const CLOUD: { id: Feature; glyph: string; name: string; what: string }[] = [
  { id: "summarize", glyph: "c-abstract", name: tk("Summarize"), what: tk("3–6 bullet summary") },
  { id: "flashcards", glyph: "flashcards", name: tk("Make flashcards"), what: tk("Question :: Answer cards") },
  { id: "explain", glyph: "c-question", name: tk("Explain"), what: tk("Plain-language explanation") },
  { id: "tags", glyph: "tag", name: tk("Suggest tags"), what: tk("3–6 tags") },
  { id: "quiz", glyph: "c-question", name: tk("Quiz me"), what: tk("5 questions + answers") },
  { id: "roadmap", glyph: "roadmap", name: tk("Draft a roadmap"), what: tk("Modules and topics") },
  { id: "voice", glyph: "voice", name: tk("Voice to text"), what: tk("Dictation (Whisper)") },
  // Separate switches (the Worker refuses each one when it is off)
  { id: "ask", glyph: "search", name: tk("Ask your notes"), what: tk("Answers with sources from your vault") },
  { id: "chat", glyph: "assistant", name: tk("Chat"), what: tk("Open-ended conversation about a note or space") },
  { id: "tutor", glyph: "lesson", name: tk("Tutor"), what: tk("Explain, Socratic and Feynman sessions") },
];
const LOCAL = [
  { glyph: "search", name: tk("Search"), what: tk("Full-text, Arabic normalisation") },
  { glyph: "graph", name: tk("Outline, backlinks, graph"), what: tk("Computed from your notes") },
  { glyph: "flashcards", name: tk("Spaced repetition"), what: tk("Review scheduling (SM-2)") },
];
/** Meter legend: the four biggest features, the rest as Other. */
const PARTS: { ids: Feature[]; label: string; color: string }[] = [
  { ids: ["summarize"], label: tk("Summarize"), color: "var(--accent)" },
  { ids: ["flashcards"], label: tk("Flashcards"), color: "var(--learn)" },
  { ids: ["voice"], label: tk("Voice"), color: "var(--info)" },
  { ids: ["explain"], label: tk("Explain"), color: "var(--link)" },
  { ids: ["tags", "quiz", "roadmap", "ask", "chat", "tutor", "project", "practice", "other"], label: tk("Other"), color: "var(--muted)" },
];
const DAY = [tk("Su"), tk("Mo"), tk("Tu"), tk("We"), tk("Th"), tk("Fr"), tk("Sa")];

function countdown(at: number) {
  const ms = Math.max(0, at - Date.now()), h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return t("{h} h {m} min", { h, m });
}

export function AiMeter({ u }: { u: AiUsage }) {
  const st = limitState(u);
  const color = st === "reached" ? "var(--danger)" : st === "near" ? "var(--warning)" : "var(--accent)";
  const cap = u.limit || FREE_NEURONS;
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(i); }, []);
  const parts = PARTS.map((p) => ({ ...p, n: p.ids.reduce((s, id) => s + (u.features[id]?.neurons ?? 0), 0) }));
  const left = leftEstimate(u);
  const pct = cap ? Math.round((u.used / cap) * 100) : 0;
  const leftLine = st === "reached" ? t("Nothing left today. AI buttons are paused until the reset; search, review and everything else keep working.")
    : !u.limit ? t("No daily cap set. Usage is shown for reference.")
    : t("About {s} summaries or {m} minutes of voice left today.", { s: fmtNum(left.summaries, G), m: fmtNum(left.voiceMin, G) });
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border bg-surface p-4" data-ai-meter={st} style={{ borderColor: st === "reached" ? "color-mix(in srgb, var(--danger) 40%, transparent)" : "var(--border)" }}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="self-center"><Glyph name="meter" size={18} color={color} /></span>
        <b className="text-[22px] font-bold">{fmtNum(Math.max(0, u.used), G)}</b>
        <span className="text-muted">{t("of {n} neurons today", { n: fmtNum(cap, G) })}</span>
        <span className="flex-1" />
        <span className="text-[12px] text-muted">{t("Resets in {t} · 00:00 UTC", { t: countdown(u.resetAt) })}</span>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={u.used} aria-label={t("AI used today")}>
        {parts.filter((p) => p.n > 0).map((p) => <span key={p.label} style={{ width: `${Math.min(100, (p.n / cap) * 100)}%`, background: p.color }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">
        {parts.map((p) => <span key={p.label} className="flex items-center gap-1.5"><span className="size-2 rounded-[2px]" style={{ background: p.color }} />{t(p.label)} · {fmtNum(p.n, G)}</span>)}
      </div>
      <span className="text-[12.5px] leading-[18px]">{leftLine}</span>
      {st !== "normal" && (
        <div className="flex items-center gap-2.5 rounded-[9px] px-3 py-[9px]" role="status" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
          <Glyph name="limit" size={16} color={color} />
          <span className="flex-1 leading-[18px]">{st === "reached" ? t("Daily free AI limit reached. Try tomorrow. Nothing is charged.") : t("You've used {p}% of today's free AI. Long notes use more.", { p: pct })}</span>
        </div>
      )}
      <div className="flex h-14 items-end gap-1.5 border-t border-line pt-1.5">
        <span className="w-[52px] self-center text-[11px] text-muted">{t("Last 7 days")}</span>
        {u.week.map((d, i) => {
          const v = cap ? Math.min(100, (d.used / cap) * 100) : 0, last = i === u.week.length - 1;
          const c = last ? color : v >= 100 ? "color-mix(in srgb, var(--danger) 60%, transparent)" : "var(--surface-2)";
          return (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-[3px]" title={`${d.day} · ${fmtNum(d.used, G)}`}>
              <span className="w-full max-w-[26px] rounded-t-[3px]" style={{ height: Math.max(2, v * 0.4), background: c }} />
              <span className="text-[10.5px] text-muted">{t(DAY[new Date(d.day + "T12:00:00Z").getUTCDay()])}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LIMITS = [
  { v: "free", label: tk("Free · 10,000") },
  { v: "5000", label: "5,000" },
  { v: "2000", label: "2,000" },
  { v: "0", label: tk("No cap") },
] as const;

export function AISection() {
  const vault = useVault();
  const p = vault.spaceMap.get(DEFAULT_SPACE)?.props ?? {};
  const off = (p.aiOff ?? "").split(",").filter(Boolean);
  const all = off.includes("all");
  const u = useAiUsage();
  const st = limitState(u);
  const reached = st === "reached";
  const adv = useAdvanced();
  const [health, setHealth] = useState<{ ai: boolean } | null>(null);
  const tok = getToken();
  useEffect(() => { if (tok) api<{ ai: boolean }>("/health").then(setHealth).catch(() => setHealth(null)); }, [tok]);
  const set = (id: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(id); else next.add(id);
    void setInboxProps({ aiOff: [...next].join(",") });
  };
  const limitV = p.aiLimit === undefined || p.aiLimit === "" ? "free" : p.aiLimit;
  const status = all ? t("Off. AI buttons explain that they're turned off here.")
    : !tok ? t("On · runs on your Cloudflare once sync is on")
    : health && !health.ai ? t("Your Worker has no AI binding. Add \"ai\": { \"binding\": \"AI\" } to wrangler.jsonc and deploy.")
    : t("On · Workers AI is bound to your Worker");

  return (
    <SPage title={t("AI")} sub={t("Optional helpers. They run on Workers AI inside your own Cloudflare account; nothing goes to any other company.")}>
      <SGroup>
        <SRow label={t("AI features")} desc={status} glyph="assistant" glyphColor="var(--accent)" tile="#F2A93B" control={<SToggle on={!all} onChange={(on) => set("all", on)} label={t("AI features")} />} />
      </SGroup>

      <SHead title={t("Daily free limit")} desc={t("Workers AI includes 10,000 neurons a day free. Without the paid plan, requests simply stop at the limit — nothing is ever charged.")} />
      {u ? <AiMeter u={u} /> : <div className="h-[220px] animate-pulse rounded-[12px] border border-line bg-surface" />}

      <SGroup title={t("Your Cloudflare · Llama 3.3 70B · Whisper")}>
        {CLOUD.map((a) => (
          <SRow key={a.id} label={t(a.name)} glyph={a.glyph} glyphColor="var(--text)" off={reached || all}
            desc={reached ? t("Daily free AI limit reached. Try tomorrow.") : `${t(a.what)} · ${t(TYPICAL[a.id] ?? "")}`}
            control={<SToggle on={!all && !off.includes(a.id)} disabled={all} onChange={(on) => set(a.id, on)} label={t(a.name)} />} />
        ))}
      </SGroup>

      <SGroup title={t("This device · always on, works offline")}>
        {LOCAL.map((a) => <SRow key={a.name} label={t(a.name)} desc={t(a.what)} glyph={a.glyph} value={t("No AI")} />)}
      </SGroup>

      <SAdvanced summary={t("Model override · log requests on this device")}>
        <SGroup>
          <SRow label={t("Daily cap")} desc={t("Stop AI before Cloudflare's free allowance runs out. AI buttons then say the limit is reached.")}
            control={<SSeg value={limitV} label={t("Daily cap")} options={LIMITS.map((l) => ({ value: l.v as string, label: t(l.label) }))} onChange={(v) => void setAiLimit(v === "free" ? null : Number(v))} />} />
          <SRow label={t("Model override")} desc={t("Workers AI model id for text features. Empty = Llama 3.3 70B.")}
            control={<input dir="ltr" className="h-[30px] w-[230px] rounded-[8px] border border-line bg-bg px-2.5 font-mono text-[12px]" placeholder="@cf/meta/llama-3.3-70b-instruct-fp8-fast" defaultValue={p.aiModel ?? ""} onBlur={(e) => void setInboxProps({ aiModel: e.target.value.trim() })} />} />
          <SRow label={t("Log requests on this device")} desc={t("Keeps the last 50 AI calls (feature, time, result) in this browser for troubleshooting.")}
            control={<SToggle on={!!adv.aiLog} onChange={(v) => setAdvanced({ aiLog: v })} label={t("Log requests on this device")} />} />
        </SGroup>
        {adv.aiLog && <AiLog />}
        <SRow label={t("Refresh usage")} desc={u?.local ? t("Estimated on this device (demo or offline).") : t("Counted by your Worker.")} control={<SBtn onClick={() => void import("../lib/ai-usage").then((m) => m.getUsage(true))}>{t("Refresh")}</SBtn>} />
      </SAdvanced>
    </SPage>
  );
}

/** The on-device request log (Advanced › Log requests). */
function AiLog() {
  const [rows] = useState<{ at: number; path: string; status: number }[]>(() => { try { return JSON.parse(localStorage.getItem("lumen.aiLog") ?? "[]"); } catch { return []; } });
  return (
    <SGroup title={t("Recent AI requests")}>
      {rows.length === 0 ? <SRow label={t("Nothing logged yet")} /> : rows.slice(-50).reverse().map((r, i) => (
        <SRow key={i} label={<span className="font-mono text-[12px]">{r.path}</span>} value={`${new Date(r.at).toLocaleTimeString()} · ${r.status === 200 ? "OK" : r.status}`} valueColor={r.status === 200 ? undefined : "var(--danger)"} />
      ))}
    </SGroup>
  );
}
