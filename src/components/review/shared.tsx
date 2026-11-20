// Shared bits for the Lumen 57 review screens (ReviewStudio): design tokens, phone media query, streak.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { db } from "../../lib/db";
import { useVault } from "../../lib/store";

/** The design's short tokens (--sf, --bd, …) mapped onto the app's CSS variables, so styles port 1:1. */
export const TOKENS = {
  "--sf": "var(--surface)", "--sf2": "var(--surface-2)", "--bd": "var(--border)", "--tx": "var(--text)", "--mu": "var(--muted)",
  "--ac": "var(--accent)", "--af": "var(--accent-fg)", "--ln": "var(--link)", "--ok": "var(--success)", "--wa": "var(--warning)",
  "--da": "var(--danger)", "--le": "var(--learn)",
} as CSSProperties;

/** Phone layout (< 768px), live. */
export function usePhone() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return m;
}

const DAY = 86_400_000;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/** Days in a row with study activity (edits, timer sessions, reviews), ending today or yesterday. Same rule as Home's streak. */
export function useStreak(tick: number) {
  const v = useVault();
  const data = useLiveQuery(async () => ({
    sessions: await db.sessions.toArray(),
    versions: await db.versions.where("createdAt").above(Date.now() - 400 * DAY).toArray(),
    reviews: await db.reviews.where("at").above(Date.now() - 400 * DAY).toArray(),
  }), [tick]);
  return useMemo(() => {
    if (!data) return 0;
    const days = new Set<string>();
    for (const x of data.versions) days.add(dayKey(x.createdAt));
    for (const n of v.notes) days.add(dayKey(n.updatedAt));
    for (const s of data.sessions) if (!s.deleted) days.add(dayKey(s.at));
    for (const r of data.reviews) if (!r.deleted) days.add(dayKey(r.at));
    let streak = 0;
    let d = days.has(dayKey(Date.now())) ? Date.now() : Date.now() - DAY;
    for (; days.has(dayKey(d)); d -= DAY) streak++;
    return streak;
  }, [data, v.notes]);
}

/** Hover, animation and card-face styles for the review screens (scoped to .rv57). */
export const RV_CSS = `
.rv57 button{color:inherit;background:none;border:0;font:inherit;cursor:pointer}
.rv57 .rv-hover:hover,.rv57 .rv-row:hover{background:color-mix(in srgb,var(--sf2) 70%,var(--sf)) !important}
.rv57 .rv-bright:hover{filter:brightness(1.08)}
.rv57 .rv-bar{transition:height .4s var(--ease)}
.rv57 .rv-fade{animation:rvFade .18s ease-out}
.rv57 .rv-pop{animation:rvPop .2s var(--ease)}
.rv57 .rv-sheet{animation:rvSheet .26s var(--ease)}
@keyframes rvFade{from{opacity:0}}
@keyframes rvPop{from{opacity:0;transform:translateY(8px) scale(.98)}}
@keyframes rvSheet{from{transform:translateY(100%)}}
.rv57 .rv-q.prose,.rv57 .rv-q.prose :is(p,li,h1,h2,h3,h4,td,th,blockquote,strong,em){font-family:'Source Serif 4',Georgia,serif!important}
.rv57 .rv-q.prose{font-size:var(--qfs)!important;line-height:1.45!important;margin:0!important;max-width:none!important;text-wrap:pretty}
.rv57 .rv-a.prose,.rv57 .rv-a.prose :is(p,li,h1,h2,h3,h4,td,th,blockquote,strong,em){font-family:'Source Serif 4',Georgia,serif!important}
.rv57 .rv-a.prose{font-size:var(--afs)!important;line-height:1.5!important;margin:0!important;max-width:none!important;text-wrap:pretty}
.rv57 .rv-q.prose>:first-child,.rv57 .rv-a.prose>:first-child{margin-top:0}.rv57 .rv-q.prose>:last-child,.rv57 .rv-a.prose>:last-child{margin-bottom:0}
.rv57 .rv-q .cloze-gap{background:var(--sf2);border-bottom:2px solid var(--ln);padding:0 6px;border-radius:4px;font-weight:600}
.rv57 .rv-q .cloze-ans{background:color-mix(in srgb,var(--ln) 16%,transparent)!important;color:var(--ln)!important;border-bottom:2px solid var(--ln);padding:0 6px!important;border-radius:4px!important;font-weight:600!important;box-shadow:none!important}
.rv57 .rv-in{animation:rvIn .22s var(--ease)}
@keyframes rvIn{from{opacity:0;transform:translateY(6px)}}
`;
