// Home dashboard (design handoff: "Lumen 01 Welcome and Home", screens 3A desktop / 3B tablet / 3C phone).
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Ellipsis, Eye, FileText, Flame, Layers, LayoutDashboard, ListChecks, Loader2, Lock, Map as MapIcon, Mic, PenLine, PenTool, Pin, Plus, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { STATUSES } from "../../shared/types";
import { api, getToken } from "../lib/api";
import { db } from "../lib/db";
import { appLockEnabled } from "../lib/home-lock";
import { capture as runCapture, PHONE_DEFAULT, pullAvatarImage, useHomeLayout, type SectionId } from "../lib/home-meta";
import { flashcards, progress, roadmap, tasks } from "../lib/parse";
import { useSettings } from "../lib/settings";
import { go, openNote, setUI, toast, useUI, useVault } from "../lib/store";
import { useSync } from "../lib/sync";
import { useDueCards } from "../lib/due-cards";
import { StudyTimer } from "../components/Timer";
import { cx, relTime as relTimeEn, STATUS_COLOR } from "../components/ui";
import { CustomizeHome } from "./home-customize";
import { TodayCard } from "../components/today-card";
import { Avatar } from "./Welcome";
import { SpaceIcon } from "../components/SpaceIcon";
import { digits, fmtDate, fmtNum, fmtRelative, getLang, isRtl, t, tk } from "../lib/i18n";
import { isWbType } from "../../shared/types";

/** Compact "5m ago" in English, the Intl relative time in Arabic. */
const relTime = (ts: number) => (getLang() === "ar" ? fmtRelative(ts) : relTimeEn(ts));

const CAPTURE_ID = "lumen-capture";
// Quick capture from anywhere: Ctrl/⌘ + Shift + N jumps to Home and focuses the capture field (design 3A note 1).
addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "n") return;
  e.preventDefault();
  go("home");
  setTimeout(() => (document.getElementById(CAPTURE_ID) as HTMLInputElement | null)?.focus(), 60);
});

const DAY = 86_400_000;
/** "Friday, 13 November" / "Fri 13 Nov" (design order: weekday, day, month) in the user's language. */
function fmtDay(d: Date, w: "long" | "short") {
  if (getLang() === "ar") return fmtDate(d, { weekday: w, day: "numeric", month: w });
  const part = (o: Intl.DateTimeFormatOptions) => fmtDate(d, o);
  return `${part({ weekday: w })}${w === "long" ? "," : ""} ${part({ day: "numeric" })} ${part({ month: w })}`;
}
/** Status labels (the ids are stored values). */
const STATUS_NAME: Record<string, string> = { todo: tk("Todo"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered") };
const statusName = (st: string) => (STATUS_NAME[st] ? t(STATUS_NAME[st]) : st);
/** Local calendar day (YYYY-MM-DD), not UTC: a 23:30 session belongs to that evening. */
const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayKey = localDay;
const WEEKS = 20;
const LVL_PCT = [0, 22, 45, 70, 100];
const lvl = (x: number) => (x <= 0 ? 0 : x < 2 ? 1 : x < 5 ? 2 : x < 10 ? 3 : 4);
const cellBg = (x: number) => (lvl(x) ? `color-mix(in srgb, var(--accent) ${LVL_PCT[lvl(x)]}%, var(--surface-2))` : "var(--surface-2)");
const hm = (min: number) => (min >= 60 ? t("{h}h {m}m", { h: Math.floor(min / 60), m: digits(String(Math.round(min % 60)).padStart(2, "0")) }) : t("{m}m", { m: Math.round(min) }));

const card = "rounded-[14px] border border-line bg-surface";
const iconTile = (color: string, size = 32) => ({ width: size, height: size, background: `color-mix(in srgb, var(${color}) ${color === "--learn" ? 16 : 14}%, transparent)`, color: `var(${color})` });

export function Home() {
  const v = useVault();
  const ui = useUI();
  const s = useSettings();
  const sync = useSync();
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const versions = useLiveQuery(() => db.versions.where("createdAt").above(Date.now() - 140 * DAY).toArray(), []) ?? [];
  const dueCards = useDueCards(v.notes);
  const due = dueCards?.length ?? 0;
  const decks = new Set(dueCards?.map((c) => c.note.id)).size;
  const [capture, setCapture] = useState("");
  const today = dayKey(Date.now());

  const openTasks = useMemo(() => v.notes.filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body).filter((t) => !t.done && t.due && t.due <= today).map((t) => ({ ...t, note: n }))), [v.notes, today]);
  const overdue = openTasks.filter((t) => t.due! < today).length;
  const revisit = v.notes.filter((n) => n.status === "review");
  const byStatus = STATUSES.map((st) => [st, v.notes.filter((n) => n.status === st).length] as const);
  const totalStatus = byStatus.reduce((a, [, c]) => a + c, 0);
  const courses = v.spaces.filter((sp) => sp.kind === "course" && !sp.archived && sp.roadmapId).map((sp) => ({ sp, p: progress(roadmap(v.byId.get(sp.roadmapId!)?.body ?? "")) }));

  // Activity: edits (versions, notes updated) + study minutes, last 20 weeks.
  const { activity, edits, minutes } = useMemo(() => {
    const edits = new Map<string, number>(), minutes = new Map<string, number>(), activity = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, x: number) => m.set(k, (m.get(k) ?? 0) + x);
    for (const x of versions) { add(edits, dayKey(x.createdAt), 1); add(activity, dayKey(x.createdAt), 1); }
    for (const n of v.notes) { add(edits, dayKey(n.updatedAt), 1); add(activity, dayKey(n.updatedAt), 1); }
    for (const se of sessions) if (!se.deleted) { add(minutes, dayKey(se.at), se.minutes); add(activity, dayKey(se.at), se.minutes / 10); }
    return { activity, edits, minutes };
  }, [versions, v.notes, sessions]);
  let streak = 0;
  for (let d = Date.now(); activity.get(dayKey(d)); d -= DAY) streak++;
  if (!streak && activity.get(dayKey(Date.now() - DAY))) for (let d = Date.now() - DAY; activity.get(dayKey(d)); d -= DAY) streak++;
  let best = streak;
  for (let d = Date.now() - 140 * DAY, run = 0; d <= Date.now(); d += DAY) { run = activity.get(dayKey(d)) ? run + 1 : 0; best = Math.max(best, run); }
  const weekMin = sessions.filter((x) => !x.deleted && x.at > Date.now() - 7 * DAY).reduce((a, x) => a + x.minutes, 0);
  const recent = [...v.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const pinned = v.notes.filter((n) => n.pinned).slice(0, 6);

  const hour = new Date().getHours();
  const hello = hour < 5 ? t("Burning the midnight oil") : hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
  const greeting = s.author ? t("{greeting}, {name}", { greeting: hello, name: s.author.split(" ")[0] }) : hello;
  const curSpace = ui.spaceId !== "all" ? v.spaceMap.get(ui.spaceId) : undefined;
  const dateLong = fmtDay(new Date(), "long");
  const dateShort = fmtDay(new Date(), "short");
  const syncInfo = sync.status === "local" ? { c: "transparent", ring: "0 0 0 1.5px var(--muted) inset", t: t("Local only") } : sync.status === "syncing" ? { c: "var(--info)", t: t("Syncing…") } : sync.status === "offline" ? { c: "var(--warning)", t: t("Offline") } : sync.status === "error" ? { c: "var(--danger)", t: t("Sync error") } : { c: "var(--success)", t: sync.last ? t("Synced {ago}", { ago: relTime(sync.last) }) : t("Synced") };
  const startReview = () => go("review");

  // "R" starts review (design: kbd hint on the button).
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "r" || e.ctrlKey || e.metaKey || e.altKey || t.closest("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault(); go("review");
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);

  const onCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capture.trim()) return;
    const msg = await runCapture(capture, ui.spaceId);
    setCapture("");
    if (msg) toast(msg);
  };
  const phone = useIsPhone();
  const voice = useVoice((t) => setCapture((c) => (c.trim() ? c.replace(/\s*$/, " ") : "") + t));
  const layout = useHomeLayout();
  const [customize, setCustomize] = useState(false);
  const [menu, setMenu] = useState(false);
  const inboxImg = v.spaceMap.get("inbox")?.props?.avatarImage ?? "";
  useEffect(() => { void pullAvatarImage(); }, [inboxImg]);
  const pathOf = (n: Note) => {
    const sp = v.spaceMap.get(n.spaceId);
    const f = n.folderId ? v.folderMap.get(n.folderId)?.name : "";
    return f || (sp ? sp.name : "");
  };
  const tasksSub = openTasks.slice(0, 2).map((t) => t.text).join(", ");
  const items = due + openTasks.length + revisit.length;

  // ---------------------------------------------------------------- pieces
  const captureBar = (
    <form onSubmit={onCapture} className={cx("flex h-12 shrink-0 items-center gap-2.5 rounded-[12px] border bg-surface ps-[14px] pe-[14px] sm:gap-3 sm:rounded-[10px] sm:px-4", voice.state === "rec" ? "border-bad" : "border-line focus-within:border-accent")}>
      <Plus size={16} className="hidden shrink-0 text-muted sm:block" />
      <PenLine size={16} className="shrink-0 text-muted sm:hidden" />
      <input id={CAPTURE_ID} value={capture} onChange={(e) => setCapture(e.target.value)} aria-label={t("Quick capture")}
        placeholder={voice.state === "rec" ? t("Listening… {time}", { time: digits(voice.elapsed) }) : voice.state === "busy" ? t("Transcribing…") : phone ? t("Capture a thought…") : t("Capture a thought, link or task…")}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted" style={{ outline: "none", caretColor: "var(--accent)" }} />
      <span className="hidden rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted xl:inline rtl:font-sans">{t("↵ to Inbox")}</span>
      <button type="button" onClick={voice.toggle} aria-label={voice.state === "rec" ? t("Stop recording") : t("Voice capture")} title={voice.state === "rec" ? t("Stop recording") : t("Voice capture")}
        className={cx("flex shrink-0 items-center justify-center sm:hidden", voice.state === "rec" ? "text-bad" : "text-muted")}>
        {voice.state === "busy" ? <Loader2 size={18} className="animate-spin" /> : voice.state === "rec" ? <span className="flex items-center gap-1.5"><span className="size-2 animate-pulse rounded-full bg-bad" /><Mic size={18} /></span> : <Mic size={18} />}
      </button>
    </form>
  );

  const progressBar = (h: number) => (
    <div className="flex overflow-hidden" style={{ height: h, borderRadius: h / 2, gap: 2 }}>
      {/* Arabic (R5-25A): the bar fills from the right, mastered first. */}
      {(isRtl() ? [...byStatus].reverse() : byStatus).map(([st, c]) => c ? <span key={st} title={`${statusName(st)}: ${c}`} style={{ width: `${(c / totalStatus) * 100}%`, background: STATUS_COLOR[st], opacity: st === "todo" ? 0.55 : 1 }} /> : null)}
    </div>
  );

  const dueRow = (icon: React.ReactNode, color: string, title: string, sub: React.ReactNode, onClick: () => void, action: React.ReactNode, last = false) => (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className={cx("flex cursor-pointer items-center gap-[14px] rounded-[6px]", last ? "pt-2.5" : "border-b border-line py-2.5")}>
      <span className="flex shrink-0 items-center justify-center rounded-[8px]" style={iconTile(color)}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]"><span className="text-[14px] font-semibold">{title}</span><span className="truncate text-[12px] text-muted">{sub}</span></div>
      {action}
    </div>
  );

  const dueDesktop = (
    <div className={cx(card, "hidden flex-col gap-1 px-5 py-[18px] xl:flex")}>
      <div className="mb-2 flex items-center justify-between"><span className="text-[14px] font-semibold">{t("Due today")}</span><span className="text-[12px] text-muted">{t("{n} item|{n} items", { n: items })}</span></div>
      {dueRow(<Layers size={16} />, "--learn", t("{n} flashcard|{n} flashcards", { n: due }), due ? `${t("{n} deck|{n} decks", { n: decks })} · ${t("about {n} min", { n: Math.max(1, Math.round(due * 0.5)) })}` : t("All caught up"), startReview,
        <button onClick={(e) => { e.stopPropagation(); startReview(); }} className="flex h-[34px] shrink-0 items-center gap-2 rounded-[10px] bg-accent px-[14px] font-semibold text-accent-fg">{t("Start review")} <span className="font-mono text-[11px] font-medium opacity-65">R</span></button>)}
      {dueRow(<ListChecks size={16} />, "--warning", t("{n} task|{n} tasks", { n: openTasks.length }), openTasks.length ? <>{overdue > 0 && <span className="text-bad">{t("{n} overdue", { n: overdue })} · </span>}<span dir="auto">{tasksSub}</span></> : t("Nothing due"), () => go("tasks"), <ChevronRight size={16} className="text-muted" />)}
      {dueRow(<Eye size={16} />, "--info", t("{n} note to revisit|{n} notes to revisit", { n: revisit.length }), revisit.length ? `${t("Status “review”")} · ${revisit.slice(0, 3).map((n) => n.title).join(t(", "))}` : t("Nothing marked for review"), () => go("kanban"), <ChevronRight size={16} className="text-muted" />, true)}
    </div>
  );

  const dueTablet = (
    <div className={cx(card, "hidden flex-col gap-[14px] p-[18px] sm:flex xl:hidden")}>
      <span className="text-[14px] font-semibold">{t("Due today")}</span>
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 items-center justify-center rounded-[8px]" style={iconTile("--learn")}><Layers size={16} /></span>
        <div className="flex flex-col gap-[2px]"><b className="text-[14px] font-semibold">{t("{n} flashcard|{n} flashcards", { n: due })}</b><span className="text-[12px] text-muted">{due ? t("about {n} min", { n: Math.max(1, Math.round(due * 0.5)) }) : t("All caught up")}</span></div>
      </div>
      <button onClick={startReview} className="flex h-10 items-center justify-center rounded-[10px] bg-accent font-semibold text-accent-fg">{t("Start review")}</button>
      <div className="flex gap-4 text-[12px] text-muted">
        <button onClick={() => go("tasks")} className="hover:text-ink">{t("{n} task|{n} tasks", { n: openTasks.length })}{overdue > 0 && <> · <span className="text-bad">{t("{n} overdue", { n: overdue })}</span></>}</button>
        <button onClick={() => go("kanban")} className="hover:text-ink">{t("{n} note to revisit|{n} notes to revisit", { n: revisit.length })}</button>
      </div>
    </div>
  );

  const duePhone = (
    <div className={cx(card, "flex flex-col gap-[14px] p-4 sm:hidden")}>
      <div className="flex items-center justify-between"><span className="font-semibold">{t("Due today")}</span><span className="text-[12px] text-muted">{t("{n} item|{n} items", { n: items })}</span></div>
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 items-center justify-center rounded-[10px]" style={iconTile("--learn", 36)}><Layers size={18} /></span>
        <div className="flex flex-col gap-[2px]"><b className="font-semibold">{t("{n} flashcard|{n} flashcards", { n: due })}</b><span className="text-[12px] text-muted">{due ? `${t("{n} deck|{n} decks", { n: decks })} · ${t("about {n} min", { n: Math.max(1, Math.round(due * 0.5)) })}` : t("All caught up")}</span></div>
      </div>
      <button onClick={startReview} className="flex h-12 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg">{t("Start review")}</button>
      <div className="flex gap-2">
        <button onClick={() => go("tasks")} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-surface-2 text-[13px]"><ListChecks size={15} className="text-warn" />{t("{n} task|{n} tasks", { n: openTasks.length })}</button>
        <button onClick={() => go("kanban")} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-surface-2 text-[13px]"><Eye size={15} className="text-info" />{t("{n} to revisit", { n: revisit.length })}</button>
      </div>
    </div>
  );

  const legend = (
    <div className="grid grid-cols-2 gap-x-4 gap-y-[10px] xl:gap-x-5 xl:gap-y-3">
      {byStatus.map(([st, c]) => (
        <button key={st} onClick={() => go("kanban")} className="flex items-center gap-2 text-start">
          <span className="size-2 shrink-0 rounded-full" style={st === "todo" ? { border: "1.5px solid var(--muted)" } : { background: STATUS_COLOR[st] }} />
          <span className="flex-1 text-muted">{statusName(st)}</span><b className="font-semibold tabular-nums">{fmtNum(c)}</b>
        </button>
      ))}
    </div>
  );

  const progressCard = (
    <div className={cx(card, "hidden flex-col gap-4 p-[18px] sm:flex xl:px-5")}>
      <div className="flex items-center justify-between"><span className="text-[14px] font-semibold">{t("Learning progress")}</span><span className="text-[12px] text-muted">{t("{n} note|{n} notes", { n: totalStatus })}</span></div>
      {totalStatus ? <>{progressBar(10)}{legend}</> : <div className="text-[13px] text-muted">{t("Set a status on lessons (Info panel) to track what you're learning.")}</div>}
      {courses.length > 0 && (
        <div className="hidden flex-col gap-1 border-t border-line pt-3 xl:flex">
          {courses.map(({ sp, p }) => (
            <button key={sp.id} onClick={() => go("space", { spaceId: sp.id })} className="flex items-center gap-2.5 rounded-[6px] py-0.5 text-[12px] text-muted hover:text-ink">
              <span className="flex max-w-[45%] items-center gap-1.5 truncate"><SpaceIcon space={sp} size={15} /><span className="truncate">{sp.name}</span></span>
              <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-ink opacity-70" style={{ width: `${p.pct}%` }} /></span>
              <span className="tabular-nums">{t("{pct}%", { pct: Math.round(p.pct) })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const heat = <Heatmap data={activity} edits={edits} minutes={minutes} />;
  const activityCard = (
    <div className={cx(card, "hidden items-end justify-between gap-10 p-[18px] sm:flex xl:justify-start xl:px-5")}>
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="text-[14px] font-semibold">{t("Study activity")}</span>
        <div className="overflow-x-auto"><div className="hidden xl:block"><MonthLabels /></div>{heat}</div>
        <div className="hidden items-center gap-1 text-[11px] text-muted xl:flex">{t("Less")}{LVL_PCT.map((_, i) => <span key={i} className="size-2.5 rounded-[2px]" style={{ background: i ? (i === 4 ? "var(--accent)" : `color-mix(in srgb, var(--accent) ${LVL_PCT[i]}%, var(--surface-2))`) : "var(--surface-2)" }} />)}{t("More")}</div>
      </div>
      {/* desktop: side-by-side stats; tablet: stacked, right-aligned */}
      <div className="hidden gap-10 pb-[22px] xl:flex">
        <div className="flex flex-col gap-1"><span className="flex items-center gap-2 text-[28px] font-[650] tracking-[-0.02em]"><Flame size={22} className="text-accent" />{fmtNum(streak)}</span><span className="text-muted">{t("day streak · best {best}", { best })}</span></div>
        <div className="flex flex-col gap-1"><span className="text-[28px] font-[650] tracking-[-0.02em]">{hm(weekMin)}</span><span className="text-muted">{t("studied this week")}</span></div>
      </div>
      <div className="flex shrink-0 flex-col gap-[14px] text-end xl:hidden">
        <div><div className="text-[24px] font-[650]">{t("{n} day|{n} days", { n: streak })}</div><div className="text-muted">{t("streak")}</div></div>
        <div><div className="text-[24px] font-[650]">{hm(weekMin)}</div><div className="text-muted">{t("this week")}</div></div>
      </div>
    </div>
  );

  const showProgress = !layout.hidden.includes("progress");
  const activityPhone = (withHeat: boolean) => (withHeat || (showProgress && totalStatus > 0)) && (
    <div className={cx(card, "flex flex-col gap-3 p-4 sm:hidden")}>
      {withHeat ? <>
        <div className="flex items-center justify-between"><span className="font-semibold">{t("Activity")}</span><span className="flex items-center gap-1 text-[13px] text-muted"><Flame size={14} className="text-accent" />{t("{n} day|{n} days", { n: streak })} · {t("{time} wk", { time: hm(weekMin) })}</span></div>
        <Heatmap data={activity} edits={edits} minutes={minutes} fluid />
      </> : <div className="flex items-center justify-between"><span className="font-semibold">{t("Learning progress")}</span><span className="text-[12px] text-muted">{t("{n} note|{n} notes", { n: totalStatus })}</span></div>}
      {showProgress && totalStatus > 0 && <>
        <div className="mt-1">{progressBar(8)}</div>
        <div className="flex justify-between text-[11px] text-muted">{byStatus.map(([st, c]) => <button key={st} onClick={() => go("kanban")} >{statusName(st)} {fmtNum(c)}</button>)}</div>
      </>}
    </div>
  );

  const emptyContinue = (
    <div className="space-y-2 px-3 pb-2 text-[13px] text-muted">
      <p>{t("Welcome to Lumen. Start with a space for something you're learning.")}</p>
      <button className="flex items-center gap-1.5 text-link" onClick={() => setUI({ newSpace: true })}><Sparkles size={14} /> {t("Create a course space with a roadmap")}</button>
    </div>
  );

  const continueCard = (
    <div className={cx(card, "hidden flex-col px-2 pb-2 pt-3.5 sm:flex")}>
      <div className="px-3 pb-1.5 text-[14px] font-semibold">{t("Continue")}</div>
      {recent.length ? recent.map((n, i) => (
        <button key={n.id} onClick={() => openNote(n.id)} className={cx("flex h-[34px] items-center gap-3 rounded-[6px] px-3 text-start hover:bg-surface-2", i === 0 && "xl:bg-surface-2")}>
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
          <span className="max-w-[55%] truncate whitespace-nowrap font-medium" dir="auto">{n.title || t("Untitled")}</span>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted" dir="auto">{pathOf(n)}</span>
          <span className="shrink-0 text-[12px] text-muted">{relTime(n.updatedAt)}</span>
        </button>
      )) : emptyContinue}
    </div>
  );

  const continuePhone = (
    <div className="flex flex-col gap-2.5 sm:hidden">
      <span className="font-semibold">{t("Continue")}</span>
      {recent.length ? (
        <div className="-me-4 flex gap-2.5 overflow-x-auto pe-4">
          {recent.slice(0, 5).map((n) => (
            <button key={n.id} onClick={() => openNote(n.id)} className={cx(card, "flex w-[150px] shrink-0 flex-col gap-1.5 rounded-[12px] p-3 text-start")}>
              <span className="size-[7px] rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
              <span className="line-clamp-2 text-[13px] font-semibold leading-[18px]" dir="auto">{n.title || t("Untitled")}</span>
              <span className="text-[11px] text-muted">{relTime(n.updatedAt)}</span>
            </button>
          ))}
        </div>
      ) : <div className={cx(card, "pt-3")}>{emptyContinue}</div>}
    </div>
  );

  const pinIcon = (n: Note) => n.type === "roadmap" ? <MapIcon size={16} /> : n.type === "canvas" ? <LayoutDashboard size={16} /> : isWbType(n.type) ? <PenTool size={16} /> : flashcards(n.body).length ? <Layers size={16} /> : <FileText size={16} />;
  const pinSub = (n: Note) => {
    const fc = n.type === "canvas" || isWbType(n.type) ? 0 : flashcards(n.body).length;
    return fc ? `${t("Flashcards")} · ${t("{n} card|{n} cards", { n: fc })}` : pathOf(n) || n.type;
  };
  const pinnedCard = pinned.length > 0 && (
    <div className={cx(card, "flex flex-col px-2 pb-2 pt-3.5")}>
      <div className="flex justify-between px-3 pb-1.5 text-[14px] font-semibold">{t("Pinned")}<Pin size={14} className="text-muted" /></div>
      {pinned.map((n) => (
        <button key={n.id} onClick={() => openNote(n.id)} className="flex items-center gap-3 rounded-[6px] px-3 py-2 text-start hover:bg-surface-2">
          <span className="shrink-0 text-muted">{pinIcon(n)}</span>
          <span className="flex min-w-0 flex-col gap-px"><span className="truncate font-medium" dir="auto">{n.title || t("Untitled")}</span><span className="truncate text-[12px] text-muted">{pinSub(n)}</span></span>
        </button>
      ))}
    </div>
  );

  // ---------------------------------------------------------------- layout (Customize home)
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const phoneVisible = (layout.custom ? layout.order : PHONE_DEFAULT).filter((id) => !layout.hidden.includes(id));
  const wideCard: Record<SectionId, React.ReactNode> = {
    today: <TodayCard />,
    due: <>{dueDesktop}{dueTablet}</>,
    progress: progressCard,
    activity: activityCard,
    continue: continueCard,
    pinned: pinnedCard || null,
  };
  // Tablet + desktop rows: Activity spans the width; other cards pair up 7fr/5fr (design 3A), 1fr/1fr on tablet (3B).
  const rows: SectionId[][] = [];
  for (const id of visible) {
    if (id === "pinned" && !pinnedCard) continue;
    const last = rows[rows.length - 1];
    if (id !== "activity" && last && last.length === 1 && last[0] !== "activity") last.push(id);
    else rows.push([id]);
  }
  const phoneCard = (id: SectionId) =>
    id === "today" ? <TodayCard /> : id === "due" ? duePhone : id === "continue" ? continuePhone : id === "activity" ? activityPhone(true)
      : id === "progress" ? (layout.hidden.includes("activity") ? activityPhone(false) : null) : id === "pinned" ? pinnedCard : null;

  return (
    <div className="safe-t h-full overflow-y-auto text-[14px] leading-[normal] sm:text-[13px]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 pb-6 pt-3 sm:gap-[18px] sm:px-8 sm:py-7 xl:gap-5 xl:px-14 xl:py-8">
        {/* header */}
        <div className="group flex items-center justify-between gap-3 sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px] sm:gap-1.5">
            <div className="truncate text-[22px] font-[650] tracking-[-0.02em] sm:text-[24px] xl:text-[26px]">{greeting}</div>
            <div className="hidden text-[13px] text-muted sm:block">{dateLong}{curSpace && <span className="hidden xl:inline"> · <SpaceIcon space={curSpace} size={15} style={{ verticalAlign: "-3px" }} /> <bdi>{curSpace.name}</bdi></span>}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-muted sm:hidden">{dateShort} · <span className="size-1.5 rounded-full" style={{ background: syncInfo.c, boxShadow: "ring" in syncInfo ? syncInfo.ring : undefined }} />{syncInfo.t}</div>
          </div>
          <div className="relative hidden items-center gap-2 sm:flex">
            <button aria-label={t("Home options")} data-home-options aria-haspopup="menu" onClick={() => setMenu((m) => !m)}
              className={cx("absolute bottom-0 end-full me-2 flex size-8 items-center justify-center rounded-full text-muted transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100")}><Ellipsis size={16} /></button>
            {menu && <HomeMenu onClose={() => setMenu(false)} onCustomize={() => { setMenu(false); setCustomize(true); }} />}
            <span className="flex items-center gap-1.5 text-[12px] text-muted xl:hidden"><span className="size-[7px] rounded-full" style={{ background: syncInfo.c, boxShadow: "ring" in syncInfo ? syncInfo.ring : undefined }} />{syncInfo.t}</span>
            <div className="hidden xl:block"><StudyTimer /></div>
          </div>
          <button onClick={() => go("settings")} aria-label={t("Settings")} className="shrink-0 rounded-full sm:hidden"><Avatar size={40} /></button>
        </div>

        {captureBar}

        {/* phone: single column in the chosen order */}
        {phoneVisible.map((id) => { const c = phoneCard(id); return c ? <div key={id} className="flex flex-col sm:hidden">{c}</div> : null; })}

        {/* tablet + desktop */}
        {rows.map((r) => (
          <div key={r.join("+")} className={cx("hidden gap-4 sm:grid xl:gap-5", r.length === 2 && (r.includes("continue") ? "xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "sm:grid-cols-2 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"))}>
            {r.map((id) => <div key={id} className="contents">{wideCard[id]}</div>)}
          </div>
        ))}

        <div className="flex items-center justify-center pt-2 text-[12px] text-muted sm:hidden">
          <button onClick={() => setCustomize(true)} className="flex items-center gap-1.5"><SlidersHorizontal size={13} />{t("Customize home")}</button>
        </div>
      </div>
      {customize && <CustomizeHome onClose={() => setCustomize(false)} />}
    </div>
  );
}

function useIsPhone() {
  const [p, setP] = useState(() => innerWidth < 640);
  useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}

function HomeMenu({ onClose, onCustomize }: { onClose: () => void; onCustomize: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-home-options]") && onClose();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", h); addEventListener("keydown", k);
    return () => { removeEventListener("mousedown", h); removeEventListener("keydown", k); };
  }, [onClose]);
  const item = "flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-start hover:bg-surface";
  return (
    <div ref={ref} role="menu" className="absolute end-0 top-full z-30 mt-2 flex w-[200px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.35)] fade-in">
      <button role="menuitem" onClick={onCustomize} className={item}><SlidersHorizontal size={14} className="text-muted" />{t("Customize home")}</button>
      {appLockEnabled() && <button role="menuitem" onClick={() => { try { sessionStorage.removeItem("lumen.unlocked"); } catch { /* ignore */ } location.reload(); }} className={item}><Lock size={14} className="text-muted" />{t("Lock now")}</button>}
    </div>
  );
}

/** Mic → MediaRecorder → /api/transcribe (needs the sync token) → text into the capture field. */
function useVoice(onText: (t: string) => void) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [start, setStart] = useState(0);
  const [, tick] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  useEffect(() => { if (state !== "rec") return; const i = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(i); }, [state]);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);
  const secs = state === "rec" ? Math.floor((Date.now() - start) / 1000) : 0;
  const toggle = async () => {
    if (state === "busy") return;
    if (rec.current) { rec.current.stop(); return; }
    if (!getToken()) { toast(t("Voice capture needs sync unlocked (Settings › Sync).")); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.current = null;
        setState("busy");
        try {
          const blob = new Blob(chunks, { type: r.mimeType });
          const { text } = await api<{ text: string }>("/transcribe", { method: "POST", body: blob, headers: { "Content-Type": r.mimeType || "audio/webm" } });
          if (text) { onText(text); setTimeout(() => document.getElementById(CAPTURE_ID)?.focus(), 30); } else toast(t("Didn't catch anything."));
        } catch (e) { toast((e as Error).message); } finally { setState("idle"); }
      };
      r.start();
      rec.current = r;
      setStart(Date.now());
      setState("rec");
    } catch { toast(t("Microphone not available.")); }
  };
  return { state, toggle, elapsed: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` };
}

/** Month labels aligned to heatmap columns (12px cell + 3px gap). */
function MonthLabels() {
  const cols = weekStarts();
  return (
    <div className="mb-[3px] flex gap-[3px] text-[10px] text-muted">
      {cols.map((t, i) => {
        const m = new Date(t).getMonth();
        const show = i === 0 ? new Date(t).getDate() <= 7 : new Date(cols[i - 1]).getMonth() !== m;
        return <span key={t} className="w-3 shrink-0 overflow-visible whitespace-nowrap">{show ? fmtDate(t, { month: "short" }) : ""}</span>;
      })}
    </div>
  );
}

function weekStarts() {
  const end = new Date();
  const start = new Date(end.getTime() - ((WEEKS - 1) * 7 + end.getDay()) * DAY);
  return Array.from({ length: WEEKS }, (_, w) => start.getTime() + w * 7 * DAY);
}

function Heatmap({ data, edits, minutes, fluid }: { data: Map<string, number>; edits: Map<string, number>; minutes: Map<string, number>; fluid?: boolean }) {
  const now = Date.now();
  return (
    <div className={cx("flex gap-[3px]", fluid && "justify-between")}>
      {weekStarts().map((ws) => (
        <div key={ws} className="flex flex-col gap-[3px]">
          {Array.from({ length: 7 }, (_, d) => {
            const ts = ws + d * DAY, k = dayKey(ts), future = ts > now;
            const label = `${fmtDate(ts, { weekday: "short", day: "numeric", month: "short" })} · ${t("{n} min", { n: Math.round(minutes.get(k) ?? 0) })} · ${t("{n} note|{n} notes", { n: edits.get(k) ?? 0 })}`;
            return (
              <button key={k} title={future ? undefined : label} aria-label={future ? undefined : label} disabled={future}
                onClick={() => { try { sessionStorage.setItem("lumen.calendarDay", localDay(ts)); } catch { /* ignore */ } go("calendar"); }}
                className={cx("rounded-[3px]", fluid ? "size-[14px]" : "size-3")}
                style={{ background: future ? "transparent" : cellBg(data.get(k) ?? 0) }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}
