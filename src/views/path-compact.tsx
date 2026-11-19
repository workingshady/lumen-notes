// Compact Stages density for big paths (design Lumen 32 · R6-32D "Skill tree · 214 topics · compact", Lumen 22 §4):
// done stages fold to vertical strips, open stages show `topicsPerColumn` 20 px topics then "+N more", locked topics
// dim, "Find a topic" jumps to a topic (opens its stage, reveals it past the cap) and highlights it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { fmtNum, t } from "../lib/i18n";
import { UNPLACED, type BuiltConcept, type BuiltPath } from "../lib/path";
import { useScale } from "../lib/scale-prefs";
import { normalize } from "../lib/search";
import { ZoomBar } from "./graph-big";

/** Paths with more concepts than this open in compact density by default. */
export const COMPACT_ABOVE = 100;
const dot = (c: BuiltConcept) => (c.status === "done" ? "var(--success)" : c.status === "learning" ? "var(--info)" : "var(--muted)");

export function CompactStages({ path, onOpen, sel, onComfortable }: { path: BuiltPath; onOpen: (k: string) => void; sel: string | null; onComfortable: () => void }) {
  const { topicsPerColumn: cap } = useScale();
  const stages = path.stages.filter((s) => s.name !== UNPLACED || s.concepts.length);
  /** Stage name → true (open) / false (strip); unset = open unless every topic is done. */
  const [openOv, setOpenOv] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<string | null>(null);
  const [k, setK] = useState(1);
  const board = useRef<HTMLDivElement>(null);
  const isOpen = (s: { name: string; concepts: BuiltConcept[] }) => openOv[s.name] ?? !(s.concepts.length && s.concepts.every((c) => c.status === "done"));
  const matches = useMemo(() => { const n = normalize(q.trim()); return n ? path.concepts.filter((c) => normalize(c.def.name).includes(n) || c.def.aliases.some((a) => normalize(a).includes(n))) : []; }, [q, path]);
  const shown = stages.reduce((a, s) => a + (isOpen(s) ? (all[s.name] ? s.concepts.length : Math.min(cap, s.concepts.length)) : 0), 0);
  const jump = (c: BuiltConcept | undefined) => {
    if (!c) return;
    const s = stages.find((x) => x.concepts.includes(c));
    if (!s) return;
    setOpenOv((o) => ({ ...o, [s.name]: true }));
    if (s.concepts.indexOf(c) >= cap) setAll((a) => ({ ...a, [s.name]: true }));
    setHit(c.key);
  };
  useEffect(() => { if (!hit) return; requestAnimationFrame(() => board.current?.querySelector(`[data-concept="${CSS.escape(hit)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })); }, [hit, openOv, all]);
  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ backgroundImage: "radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1px,transparent 1.2px)", backgroundSize: "22px 22px" }}>
      <div ref={board} className="absolute inset-0 overflow-auto">
        <div className="flex h-full origin-top-left gap-2 p-4 pe-[232px]" style={{ transform: k === 1 ? undefined : `scale(${k})`, width: k === 1 ? undefined : `${100 / k}%`, height: `${100 / k}%` }}>
          {stages.map((s) => {
            const done = s.concepts.filter((c) => c.status === "done").length;
            const label = s.name === UNPLACED ? t(UNPLACED) : s.name;
            if (!isOpen(s)) return (
              <button key={s.name} onClick={() => setOpenOv((o) => ({ ...o, [s.name]: true }))} title={t("Expand {name}", { name: label })} data-stage={s.name}
                className="flex w-[34px] shrink-0 flex-col rounded-[12px] p-2 hover:bg-surface" style={{ background: "color-mix(in srgb,var(--surface) 60%,transparent)" }}>
                <span className="flex items-center gap-1.5 whitespace-nowrap px-1 pb-1.5 pt-0.5 text-[12px] [writing-mode:vertical-rl]" dir="auto"><b className="font-semibold">{label}</b><span className="text-muted" dir="ltr">{fmtNum(done)}/{fmtNum(s.concepts.length)}</span></span>
              </button>
            );
            const list = all[s.name] ? s.concepts : s.concepts.slice(0, cap);
            const rest = s.concepts.length - list.length;
            return (
              <section key={s.name} data-stage={s.name} className="flex w-[200px] shrink-0 flex-col gap-[3px] overflow-hidden rounded-[12px] p-2" style={{ background: "color-mix(in srgb,var(--surface) 60%,transparent)" }}>
                <button onClick={() => setOpenOv((o) => ({ ...o, [s.name]: false }))} title={t("Collapse {name}", { name: label })} className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5 text-start text-[12px]">
                  <b className="truncate font-semibold" dir="auto">{label}</b><span className="whitespace-nowrap text-muted" dir="ltr">{fmtNum(done)}/{fmtNum(s.concepts.length)}</span>
                </button>
                {list.map((c) => (
                  <button key={c.key} data-concept={c.key} onClick={() => onOpen(c.key)} title={c.def.name}
                    className="flex h-5 shrink-0 items-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[5px] bg-surface-2 px-1.5 text-start text-[11px] hover:brightness-110"
                    style={{ opacity: c.status === "locked" ? 0.45 : 1, boxShadow: hit === c.key || sel === c.key ? "inset 0 0 0 1.5px var(--accent)" : "none" }}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot(c) }} /><span className="truncate" dir="auto">{c.def.name}</span>
                  </button>
                ))}
                {rest > 0 && <button onClick={() => setAll((a) => ({ ...a, [s.name]: true }))} className="p-1 text-start text-[11px] text-link hover:underline">{t("+{n} more", { n: rest })}</button>}
                {all[s.name] && s.concepts.length > cap && <button onClick={() => setAll((a) => ({ ...a, [s.name]: false }))} className="p-1 text-start text-[11px] text-muted hover:text-ink">{t("Show less")}</button>}
              </section>
            );
          })}
        </div>
      </div>
      <div className="absolute end-4 top-4 z-10 flex w-[200px] flex-col gap-1.5 rounded-[10px] border border-line bg-surface-2 p-2.5 text-[12px]">
        <b className="font-semibold">{t("Density · compact")}</b>
        <span className="text-muted">{t("Done modules fold to strips. Locked topics dim. {n} topics, {shown} shown.", { n: path.concepts.length, shown })}</span>
        <label className="flex h-7 items-center gap-1.5 rounded-[7px] border border-line bg-bg px-2 text-muted focus-within:border-accent">
          <Glyph name="search" size={12} />
          <input value={q} onChange={(e) => { setQ(e.target.value); const n = normalize(e.target.value.trim()); if (n) jump(path.concepts.find((c) => normalize(c.def.name).startsWith(n)) ?? path.concepts.find((c) => normalize(c.def.name).includes(n))); else setHit(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && matches.length) { const i = matches.findIndex((c) => c.key === hit); jump(matches[(i + 1) % matches.length]); } if (e.key === "Escape") { setQ(""); setHit(null); } }}
            placeholder={t("Find a topic")} aria-label={t("Find a topic")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
          {q.trim() && <span className="whitespace-nowrap text-[11px]">{matches.length ? `${fmtNum(Math.max(1, matches.findIndex((c) => c.key === hit) + 1))}/${fmtNum(matches.length)}` : t("none")}</span>}
        </label>
        <button onClick={onComfortable} className={cx("self-start text-[11.5px] text-muted hover:text-ink")}>{t("Show full cards")}</button>
      </div>
      <ZoomBar k={k} onIn={() => setK((x) => Math.min(1.5, x * 1.25))} onOut={() => setK((x) => Math.max(0.4, x * 0.8))} onFit={() => setK(1)} />
    </div>
  );
}
