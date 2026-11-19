// Shared pieces of Ask chat + tutor: rendered answer with citation chips, source cards, small stroke icons that the
// round-4 glyph set doesn't have yet (copy, thumbs, send, stop, pin). Plain, restyle-ready (design round 5 pending).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSource } from "../../shared/types";
import { getToken } from "../lib/api";
import { DEMO } from "../lib/db";
import { render } from "../lib/markdown";
import { useFaults } from "../lib/sim/faults";
import type { Vault } from "../lib/store";
import { Glyph } from "./Glyph";
import { plainText } from "./nav-text";
import { cx } from "./ui";

export const SERIF = "'Source Serif 4', Georgia, serif";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const isAr = (s: string) => /[؀-ۿ]/.test(s);

// 24 px grid, 1.75 stroke, round caps (same drawing rules as lib/glyphs.ts).
const ICONS: Record<string, string[]> = {
  copy: ["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  up: ["M7 11v9H4v-9z", "M7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"],
  down: ["M7 13V4H4v9z", "M7 13l4 8a2 2 0 0 0 2-2v-4h5.5a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.3 4H7"],
  send: ["M12 19V5", "M6 11l6-6 6 6"],
  stop: ["M7 7h10v10H7z"],
  pin: ["M9 4h6l-1 6 3 3H7l3-3z", "M12 13v8"],
  edit: ["M4 20h4l11-11-4-4L4 16z"],
  list: ["M8 6h13 M8 12h13 M8 18h13", "M3 6h1 M3 12h1 M3 18h1"],
};
export function ChatIcon({ name, size = 15, filled }: { name: keyof typeof ICONS | string; size?: number; filled?: boolean }) {
  const d = ICONS[name];
  if (!d) return <Glyph name={name} size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
      {d.map((p, i) => <path key={i} d={p} fill={filled && i === 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

/** `[1]`, `[2, 3]` → placeholders that survive Markdown rendering. */
const markCitations = (md: string) => md.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (_m, list: string) => list.split(",").map((x) => `⟦${x.trim()}⟧`).join(""));

/** Answer Markdown + KaTeX in the reading serif, citations as numbered chips (click opens the note). */
export function RichAnswer({ text, sources, streaming, size = 16, onOpen, onHover, ui }: { text: string; sources: ChatSource[]; streaming?: boolean; size?: number; onOpen: (noteId: string) => void; onHover?: (n: number | null) => void; /** UI font (Assistant panel) instead of the reading serif. */ ui?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = useMemo(() => new Map(sources.map((s) => [s.n, s])), [sources]);
  const html = useMemo(() => {
    let h = "";
    try { h = render(markCitations(text)); } catch { h = `<p>${esc(text)}</p>`; }
    return h.replace(/⟦(\d+)⟧/g, (_m, d: string) => {
      const s = by.get(Number(d));
      return s ? `<a class="wikilink ask-cite" href="#" data-n="${d}" title="${esc(s.title + (s.heading ? " › " + s.heading : ""))}">${d}</a>` : `<sup class="ask-cite-x">${d}</sup>`;
    });
  }, [text, by]);
  useEffect(() => { if (ref.current) ref.current.innerHTML = html; }, [html]);
  return (
    <div ref={ref} dir="auto" className={cx("prose ask-answer flex w-full !max-w-none flex-col !mx-0 gap-3", streaming && "ask-streaming")}
      style={{ fontSize: size, lineHeight: ui ? `${Math.round(size * 1.54)}px` : `${Math.round(size * 1.75)}px`, fontFamily: ui ? (isAr(text) ? "'IBM Plex Sans Arabic', Inter, sans-serif" : "inherit") : isAr(text) ? "'Noto Naskh Arabic', 'IBM Plex Sans Arabic', serif" : SERIF }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>(".ask-cite");
        if (!a) return;
        e.preventDefault();
        const s = by.get(Number(a.dataset.n));
        if (s) onOpen(s.noteId);
      }}
      onMouseOver={(e) => { const a = (e.target as HTMLElement).closest<HTMLElement>(".ask-cite"); onHover?.(a ? Number(a.dataset.n) : null); }}
      onMouseLeave={() => onHover?.(null)} />
  );
}

/** Source card: number, note-type glyph, title, quoted passage. `row` = compact list row (phone / panel). */
export function SourceCard({ s, hot, dim, row, v, onOpen }: { s: ChatSource; hot?: boolean; dim?: boolean; row?: boolean; v: Vault; onOpen: (id: string) => void }) {
  const quote = useMemo(() => plainText(s.text).replace(/\u{1F4C5}\s?/gu, "").replace(/\s+/g, " ").trim().slice(0, 140), [s.text]);
  const title = s.heading ? `${s.title} · ${s.heading}` : s.title;
  const glyph = v.byId.get(s.noteId)?.type ?? "note";
  if (row) return (
    <button data-src={s.n} onClick={() => onOpen(s.noteId)} className={cx("flex min-h-[40px] items-center gap-2.5 rounded-[10px] border bg-surface px-2.5 py-1.5 text-start hover:bg-surface-2", hot ? "border-accent" : "border-line", dim && "opacity-60")}>
      <span className="text-[12px] font-semibold text-link">{s.n}</span>
      <Glyph name={glyph} size={13} color="var(--muted)" />
      <span dir="auto" className="min-w-0 flex-1 truncate text-[12.5px]">{title}</span>
    </button>
  );
  // R5-23: radius 10, surface, 8×10 padding; 12px/600 head (number in link colour), 12.5px muted quote (UI font)
  return (
    <button data-src={s.n} onClick={() => onOpen(s.noteId)} title={s.title}
      className={cx("flex min-w-0 flex-col gap-1 rounded-[10px] border bg-surface px-2.5 py-2 text-start hover:bg-surface-2", hot ? "border-accent" : "border-line", dim && "opacity-60")}>
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
        <span className="text-link">{s.n}</span>
        <Glyph name={glyph} size={13} color="var(--muted)" />
        <span dir="auto" className="truncate">{title}</span>
      </span>
      <span dir="auto" className="line-clamp-3 text-[12.5px] leading-[17px] text-muted">“{quote}”</span>
    </button>
  );
}

export const actBtn = "flex h-[28px] items-center gap-[5px] whitespace-nowrap rounded-[7px] px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50";

/** Online/offline as React state (the Dev simulator's "Offline" counts too). */
export function useOnline() {
  const f = useFaults();
  const [on, setOn] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const g = () => setOn(navigator.onLine !== false);
    addEventListener("online", g); addEventListener("offline", g);
    return () => { removeEventListener("online", g); removeEventListener("offline", g); };
  }, []);
  return on && !(DEMO && f.net === "offline");
}
/** AI is locked on this device: signed out (or the simulator's "unauthorized"). */
export function useAiLocked() {
  const f = useFaults();
  return (!getToken() && !DEMO) || (DEMO && f.net === "unauthorized");
}

/** Width the app's left sidebar / rail takes (mirrored in RTL), so full-page layers (Ask, diagram Expand) keep it visible. */
export function sidebarInset(): number {
  const rtl = document.documentElement.dir === "rtl";
  for (const a of document.querySelectorAll("aside, nav")) {
    const r = a.getBoundingClientRect();
    if (!r.width || r.width >= 400 || r.height < innerHeight * 0.6) continue;
    if (!rtl && r.left < 4) return Math.round(r.right);
    if (rtl && r.right > innerWidth - 4) return Math.round(innerWidth - r.left);
  }
  return 0;
}
