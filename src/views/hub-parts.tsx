// Project hub shared parts (design round 4: HubDesk + "Lumen 15" task card anatomy, doc status header).
import { useEffect, useRef, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { CARD_META, DOC_STATUS_COLOR, DOC_STATUS_GLYPH, DOC_STATUS_LABEL, taskLine, type CardStatus, type DocStatus, type TaskCard } from "../lib/project";
import { toast } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { fmtDate, getLang, t } from "../lib/i18n";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const D = (iso: string) => new Date(iso + "T00:00:00");
export const todayISO = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
export const addDays = (iso: string, n: number) => { const x = D(iso); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
/** "30 Jan" */
export const dayMon = (iso: string) => (getLang() === "ar" ? fmtDate(D(iso), { day: "numeric", month: "short" }) : `${D(iso).getDate()} ${MON[D(iso).getMonth()]}`);
/** "30 Jan" in English whatever the interface language (generated note titles). */
export const dayMonEn = (iso: string) => `${D(iso).getDate()} ${MON[D(iso).getMonth()]}`;
/** "Dec 1" (Gantt ticks) */
export const monDay = (iso: string) => (getLang() === "ar" ? fmtDate(D(iso), { day: "numeric", month: "short" }) : `${MON[D(iso).getMonth()]} ${D(iso).getDate()}`);
/** Card date: weekday within the coming week ("Wed"), else "2 Dec". */
export const cardDay = (iso: string, today = todayISO()) => (iso >= addDays(today, -6) && iso <= addDays(today, 6) ? (getLang() === "ar" ? fmtDate(D(iso), { weekday: "short" }) : WD[D(iso).getDay()]) : dayMon(iso));

/** Task status glyph (t-backlog … t-cancelled) in its colour. */
export function TaskGlyph({ s, size = 16 }: { s: CardStatus; size?: number }) {
  return <Glyph name={CARD_META[s].glyph} size={size} color={CARD_META[s].color} />;
}

/** Doc status pill (design: glyph + label on a 14% tint). */
export function DocPill({ s, onClick, className }: { s: DocStatus; onClick?: () => void; className?: string }) {
  const c = DOC_STATUS_COLOR[s];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag onClick={onClick} className={cx("flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold", className)} style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
      <Glyph name={DOC_STATUS_GLYPH[s]} size={14} />{t(DOC_STATUS_LABEL[s])}
    </Tag>
  );
}

/** Small anchored menu / popover that closes on outside click and Esc. */
export function Popover({ onClose, children, className }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const id = setTimeout(() => addEventListener("mousedown", down));
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [onClose]);
  return <div ref={ref} className={cx("fade-in absolute z-40 flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface-2 p-1.5 text-[13px] shadow-xl", className)}>{children}</div>;
}
export const menuRow = "flex min-h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg";

/**
 * Append a task line to the project's tasks note ("<Project> tasks", created on first use). The text may carry
 * markers (!p1 ~2d due:2026-12-01 #epic/x @owner REQ-3); `status` picks the checkbox marker.
 */
export async function addTask(sp: Space, notes: Note[], text: string, status: CardStatus = "todo") {
  const txt = text.trim();
  if (!txt) return;
  const line = taskLine(txt, status);
  const tasksNote = notes.find((n) => n.title === `${sp.name} tasks` && !n.deleted);
  if (tasksNote) await updateNote(tasksNote.id, { body: tasksNote.body.replace(/\s*$/, "\n") + line + "\n" });
  else await createNote({ title: `${sp.name} tasks`, body: `# ${sp.name} tasks\n\n${line}\n`, spaceId: sp.id });
  toast(t("Added to {name}", { name: t(CARD_META[status].label) }));
}

/** Cards that point at a doc: written in it, or linking it with [[Doc]]. */
export const cardsOfDoc = (cards: TaskCard[], doc: Note) => cards.filter((c) => c.note.id === doc.id || c.links.some((l) => l.toLowerCase() === doc.title.toLowerCase()));
