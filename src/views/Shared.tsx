import { API_BASE } from "../lib/api";
import { setOgMeta } from "../lib/og";
import { AvatarGlyph, SpaceIcon } from "../components/SpaceIcon";
import { Glyph } from "../components/Glyph";
import { spaceColor } from "../lib/space-icon";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, GraduationCap, Hand, Layers, Loader2, Lock, Minus, Moon, Play, Plus, Scan, Sun, Target } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note, NoteType, Status } from "../../shared/types";
import { publicApi } from "./settings-public-demo";
import CanvasView, { type FileRef } from "./settings-canvas-view";
import { parseCanvas, previewSvg } from "../lib/canvas";
import { download } from "../lib/io";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { flashcards, outline, progress, readingMinutes, roadmap, type TopicStatus } from "../lib/parse";
import { activeTheme, setSettings } from "../lib/settings";
import { splitSlides } from "../components/Slides";
import { LumenMark } from "../components/LumenMark";
import { cx, STATUS_COLOR } from "../components/ui";
import { fmtDate, fmtRelative, t, tk, tx } from "../lib/i18n";
/** "12 min ago" · "3 h ago" · "3 d ago" · "7 Nov" (design copy for public pages). */
function relTime(ts: number) {
  const d = Date.now() - ts;
  if (d < 60_000) return t("just now");
  if (d < 7 * 86_400_000) return fmtRelative(ts);
  return fmtDate(ts, { day: "numeric", month: "short" });
}
import { Canvas2D, type GLink, type GNode } from "./GraphView";

/** Read-only whiteboard with an API handle (zoom bar + PNG export). Excalidraw is a big chunk, so it loads on demand. */
type ExApi = { getAppState: () => { zoom: { value: number } }; updateScene: (s: { appState: Record<string, unknown> }) => void; scrollToContent: (t?: unknown, o?: { fitToContent?: boolean; animate?: boolean }) => void; getSceneElements: () => readonly unknown[]; getFiles: () => Record<string, unknown>; onChange: (cb: (els: unknown, st: { zoom: { value: number } }) => void) => () => void };
const BoardViewer = lazy(async () => {
  const [{ Excalidraw }] = await Promise.all([import("@excalidraw/excalidraw"), import("@excalidraw/excalidraw/index.css")]);
  const loaded = await loadScene();
  const [{ embedProps }, { hydrateFiles, serverSource }] = await Promise.all([import("../components/wb-media"), import("../lib/wb-files")]);
  const embeds = embedProps(async (id) => `${API_BASE}/api/att/${id}`);
  function V({ body, onApi }: { body: string; onApi: (a: ExApi) => void }) {
    const r = useMemo(() => loaded(body), [body]);
    const initialData = useMemo(() => ({ elements: r.elements, files: r.files, appState: { viewBackgroundColor: "transparent", viewModeEnabled: true, gridModeEnabled: true, gridSize: 20, gridStep: 5 }, scrollToContent: true }), [r]);
    return <Excalidraw initialData={initialData as never} viewModeEnabled {...(embeds as object)} theme={activeTheme().dark ? "dark" : "light"}
      excalidrawAPI={(a) => { onApi(a as unknown as ExApi); void hydrateFiles(r.refs as never, serverSource((id) => `${API_BASE}/api/att/${id}`)).then((f) => { if (f.length) a.addFiles(f as never); }); }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false, saveAsImage: false } }} />;
  }
  return { default: V };
});
/** Scene → Excalidraw elements, including skeletons queued by the REST API / canvas conversion (lumenPending). */
async function loadScene() {
  const [{ restore, convertToExcalidrawElements }, { parseScene }] = await Promise.all([import("@excalidraw/excalidraw"), import("../lib/whiteboard")]);
  const { placeBoundArrows } = await import("../lib/whiteboard");
  return (body: string) => {
    const { scene } = parseScene(body);
    const pending = (scene as { lumenPending?: unknown[] }).lumenPending ?? [];
    let els = scene.elements as unknown[];
    if (pending.length) { try { els = [...els, ...convertToExcalidrawElements(placeBoundArrows(pending as never, els as never) as never, { regenerateIds: false })]; } catch { /* bad skeleton: show the rest */ } }
    const r = restore({ elements: els as never, files: scene.files as never }, null, null);
    return { elements: r.elements as readonly unknown[], files: r.files as Record<string, unknown>, refs: scene.files as Record<string, unknown> };
  };
}
async function boardPng(note: PubNote, ex: ExApi | null) {
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  let elements: readonly unknown[], files: Record<string, unknown>;
  if (ex) { elements = ex.getSceneElements(); files = ex.getFiles(); }
  else {
    const r = (await loadScene())(note.body);
    const { hydrateFiles, serverSource } = await import("../lib/wb-files");
    elements = r.elements;
    files = { ...r.files, ...Object.fromEntries((await hydrateFiles(r.refs as never, serverSource((id) => `${API_BASE}/api/att/${id}`))).map((f) => [f.id, f])) };
  }
  const dark = activeTheme().dark;
  const blob = await exportToBlob({ elements: elements as never, files: files as never, mimeType: "image/png", exportPadding: 32, appState: { exportBackground: true, viewBackgroundColor: dark ? "#0F1115" : "#FFFFFF", exportWithDarkMode: dark } as never });
  download(`${note.title}.png`, blob, "image/png");
}

type PubNote = Pick<Note, "id" | "title" | "body" | "type" | "tags" | "status" | "createdAt" | "updatedAt">;
type Brand = { name: string; avatar: string };
type ListItem = { id: string; title: string; type: NoteType; status: Status | null; tags: string[]; updatedAt: number; links: string[]; excerpt: string };
type SpaceInfo = { name: string; kind: string; icon: string; color: string | null; description: string; props: Record<string, string> };
type SpaceData = { kind: "space"; blog: Brand; space: SpaceInfo; roadmap: PubNote | null; notes: ListItem[] };
type NoteData = { kind: "note"; blog: Brand; note: PubNote };

const go = (path: string) => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")); };
const SERIF = "'Source Serif 4', Georgia, serif";
const KIND: Partial<Record<NoteType, string>> = { note: tk("Note"), lesson: tk("Lesson"), journal: tk("Journal"), flashcards: tk("Flashcards"), slides: tk("Slides"), post: tk("Post"), canvas: tk("Canvas"), whiteboard: tk("Whiteboard"), roadmap: tk("Roadmap"), moc: tk("Map of content") };
const SPACE_KIND: Record<string, string> = { project: tk("Project"), area: tk("Area"), course: tk("Course"), resource: tk("Resource"), archive: tk("Archive") };
const STATUS_LABEL: Record<string, string> = { todo: tk("To do"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered") };
const isBoard = (t: NoteType) => t === "canvas" || t === "whiteboard";

function useTheme() {
  const [dark, setDark] = useState(activeTheme().dark);
  return { dark, toggle: () => { setSettings({ theme: dark ? "paper" : "lamplight" }); setDark(!dark); } };
}
const ThemeBtn = ({ dark, toggle, className }: { dark: boolean; toggle: () => void; className?: string }) => (
  <button aria-label={dark ? t("Light theme") : t("Dark theme")} onClick={toggle} className={cx("flex size-[34px] shrink-0 items-center justify-center rounded-[8px] border border-line hover:bg-surface", className)}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
);
const BrandName = ({ blog }: { blog: Brand }) => <span className="truncate text-[16px] font-bold" style={{ fontFamily: SERIF }}><AvatarGlyph value={blog.avatar} size={14} style={{ verticalAlign: "-1px" }} /> {blog.name}</span>;

/** Read-only viewer for unlisted share links: /s/<token> and /s/<token>/<noteId>. Never touches local data. */
export function Shared({ path }: { path: string }) {
  const [, , token, noteId] = path.split("/");
  const [data, setData] = useState<SpaceData | NoteData | null>(null);
  const [err, setErr] = useState("");
  const theme = useTheme();
  useEffect(() => { publicApi<SpaceData | NoteData>(`/share/${token}`).then((d) => { setData(d); document.title = d.kind === "note" ? d.note.title : d.space.name;
    setOgMeta({ kicker: d.blog.name, title: document.title, meta: "", description: d.kind === "note" ? "" : d.space.description ?? "" }, `${API_BASE || location.origin}/api/og/s/${encodeURIComponent(token)}.png`); }).catch((e) => setErr(e.message)); }, [token]);

  if (err) return <Unavailable />;
  if (!data) return <Loading />;
  if (data.kind === "note" && isBoard(data.note.type)) return <BoardPage blog={data.blog} note={data.note} theme={theme} refsPath={`/share/${token}/refs`} />;

  const bar = data.kind === "space" && noteId ? (
    <a href={`/s/${token}`} onClick={(e) => { e.preventDefault(); go(`/s/${token}`); }} className="flex min-w-0 flex-1 items-center gap-1.5 text-muted hover:text-ink">
      <ArrowLeft size={16} className="shrink-0" />{t("Back to overview")}<span className="hidden truncate opacity-60 md:inline">· <SpaceIcon space={data.space} size={15} style={{ verticalAlign: "-3px" }} /> {data.space.name}</span>
    </a>
  ) : <span className="flex min-w-0 flex-1"><BrandName blog={data.blog} /></span>;

  return (
    <div className="flex min-h-full flex-col bg-bg text-[14px] leading-[normal] text-ink md:text-[13.5px]">
      <div className="safe-t sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-bg px-5 md:h-[60px] md:px-10">
        {bar}
        {data.kind === "space" && !noteId && <span className="hidden items-center gap-1.5 text-[12px] text-muted md:flex"><Eye size={13} />{t("Read-only")}</span>}
        <ThemeBtn {...theme} />
      </div>
      <div className="flex-1 px-5 md:px-10">
        <div className="mx-auto w-full max-w-[1080px]">
          {data.kind === "note" ? <NoteViewer note={data.note} /> : noteId ? <SpaceNote token={token} id={noteId} titles={data.notes} /> : <SpaceViewer token={token} data={data} />}
        </div>
      </div>
      <footer className="safe-b mt-12 flex items-center gap-2.5 border-t border-line px-4 py-[13px] text-[12.5px] text-muted md:px-10">
        <span className="flex size-[26px] items-center justify-center rounded-full bg-surface-2"><AvatarGlyph value={data.blog.avatar} size={15} /></span>
        <span className="flex-1">{tx("Shared from {name} · read-only", { name: <b dir="auto" className="font-semibold text-ink">{data.blog.name}</b> })}</span>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ states
function Unavailable() {
  const [name, setName] = useState("");
  useEffect(() => { document.title = t("Link unavailable"); publicApi<{ blog: Brand }>("/public/posts").then((d) => setName(d.blog.name)).catch(() => {}); }, []);
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-10 text-center text-[15px] text-ink md:gap-3.5">
      <span className="flex size-14 items-center justify-center rounded-[16px] bg-surface-2 text-muted"><Lock size={24} /></span>
      <span className="mt-1.5 text-[26px] font-bold md:text-[30px]" style={{ fontFamily: SERIF }}>{t("Link unavailable")}</span>
      <span className="max-w-[360px] leading-6 text-muted">{t("This link doesn't exist or was turned off by its owner.")}</span>
      {name && <a href="/blog" className="mt-2 font-medium text-link">{t("Visit {name} →", { name })}</a>}
      <span className="absolute bottom-7 flex items-center gap-2 text-[12.5px] text-muted"><LumenMark size={18} tile="light" glyph="dot" cone={false} glow={false} />{t("written in lumen")}</span>
    </div>
  );
}
function Loading() {
  const b = "rounded bg-surface-2";
  return (
    <div className="min-h-dvh bg-bg">
      <div className="flex h-[60px] items-center border-b border-line px-4 md:px-10"><span className={cx(b, "h-3.5 w-40 rounded-[5px]")} /></div>
      <div className="mx-auto flex max-w-[1080px] animate-pulse flex-col gap-[22px] px-4 pt-10">
        <div className="flex items-center gap-4">
          <span className={cx(b, "size-16 rounded-[14px]")} />
          <div className="flex flex-1 flex-col gap-2.5"><span className={cx(b, "h-2.5 w-20")} /><span className={cx(b, "h-7 w-full max-w-[340px] rounded-md")} /><span className={cx(b, "h-2.5 w-full max-w-[520px]")} /></div>
          <span className="hidden size-[84px] rounded-full border-8 border-surface-2 md:block" />
        </div>
        <div className="flex gap-5 border-b border-line pb-2.5"><span className={cx(b, "h-2.5 w-[70px]")} /><span className={cx(b, "h-2.5 w-[50px]")} /></div>
        <span className="h-24 rounded-[12px] border border-line bg-surface" /><span className="h-24 rounded-[12px] border border-line bg-surface" />
        <div className="grid gap-3 md:grid-cols-2"><span className="h-[100px] rounded-[12px] border border-line bg-surface" /><span className="h-[100px] rounded-[12px] border border-line bg-surface" /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ space (course / project page)
function ProgressRing({ pct, size }: { pct: number; size: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(var(--success) 0 ${pct}%, var(--surface-2) ${pct}% 100%)` }}>
      <div className="flex items-center justify-center rounded-full bg-bg font-bold" style={{ width: size - 14, height: size - 14, fontSize: size > 70 ? 16 : 13 }}>{t("{n}%", { n: pct })}</div>
    </div>
  );
}

function SpaceViewer({ token, data }: { token: string; data: SpaceData }) {
  const [tab, setTab] = useState<"overview" | "graph">("overview");
  const sp = data.space;
  const mods = useMemo(() => (data.roadmap ? roadmap(data.roadmap.body) : []), [data.roadmap]);
  const p = progress(mods);
  const due = sp.props.deadline || sp.props.target;
  const dueDate = due ? new Date(due) : null;
  const dueOk = dueDate && !isNaN(+dueDate);
  const daysLeft = dueOk ? Math.ceil((+dueDate! - Date.now()) / 864e5) : null;
  const c = spaceColor(sp, "var(--accent)");
  const notes = useMemo(() => [...data.notes].sort((a, b) => b.updatedAt - a.updatedAt), [data.notes]);
  const open = (id: string) => go(`/s/${token}/${id}`);
  return (
    <div className="flex flex-col gap-5 pt-5 md:gap-[26px] md:pt-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="flex flex-1 items-start gap-4">
          <span className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] border md:size-16" style={{ background: `color-mix(in srgb, ${c} 18%, transparent)`, borderColor: `color-mix(in srgb, ${c} 50%, transparent)` }}><SpaceIcon space={sp} size={15} color={c} /></span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{SPACE_KIND[sp.kind] ? t(SPACE_KIND[sp.kind]) : sp.kind}</span>
            <h1 dir="auto" className="text-[28px] font-bold leading-[1.1] tracking-[-.02em] md:text-[38px]">{sp.name}</h1>
            {sp.description && <p dir="auto" className="max-w-[560px] leading-normal text-muted">{sp.description}</p>}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
              {sp.props.goal && <span dir="auto" className="flex items-center gap-1.5"><Target size={13} />{sp.props.goal}</span>}
              {due && <span className="flex items-center gap-1.5"><Target size={13} />{t("Finish by {date}", { date: dueOk ? fmtDate(dueDate!, { day: "numeric", month: "short" }) : due })}</span>}
              {sp.props.url && <a className="flex items-center gap-1.5 text-link" href={sp.props.url} target="_blank" rel="noreferrer"><GraduationCap size={13} />{(() => { try { return new URL(sp.props.url).hostname.replace(/^www\./, ""); } catch { return t("Course page"); } })()} ↗</a>}
              <span className="flex items-center gap-1.5"><FileText size={13} />{t("{n} note|{n} notes", { n: data.notes.length + (data.roadmap ? 1 : 0) })}</span>
            </div>
          </div>
        </div>
        {mods.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="md:hidden"><ProgressRing pct={p.pct} size={64} /></div>
            <div className="hidden md:block"><ProgressRing pct={p.pct} size={84} /></div>
            <span className="flex flex-col gap-0.5 text-[12px] text-muted"><b className="text-[13px] font-semibold text-ink">{t("{done} of {total} topics", { done: p.done, total: p.total })}</b>{daysLeft !== null && daysLeft >= 0 && t("{n} day left|{n} days left", { n: daysLeft })}</span>
          </div>
        )}
      </header>
      <div className="flex gap-5 border-b border-line">
        {(["overview", "graph"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={cx("pb-2.5", tab === tb ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:text-ink")}>{tb === "overview" ? t("Overview") : t("Graph")}</button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="flex flex-col gap-5 md:gap-[26px]">
          {mods.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <span className="text-[15px] font-[650]">{t("Roadmap")}</span>
              <RoadmapReadOnly body={data.roadmap!.body} titles={data.notes} onOpen={open} />
            </section>
          )}
          <section className="flex flex-col gap-2.5">
            <span className="text-[15px] font-[650]">{t("Notes")}</span>
            <div className="grid gap-3 md:grid-cols-2">
              {notes.map((n) => (
                <a key={n.id} href={`/s/${token}/${n.id}`} onClick={(e) => { e.preventDefault(); open(n.id); }} className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-3.5 hover:border-accent">
                  <div className="flex items-center gap-2"><span className="size-[7px] shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} /><span dir="auto" className="flex-1 truncate font-semibold">{n.title}</span></div>
                  <span dir="auto" className="line-clamp-2 h-9 text-[12.5px] leading-[18px] text-muted">{n.type === "canvas" ? t("Canvas board") : n.type === "whiteboard" ? t("Whiteboard") : n.excerpt}</span>
                  <span className="text-[11.5px] text-muted">{t(KIND[n.type] ?? "Note")} · {relTime(n.updatedAt)}</span>
                </a>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <SpaceGraph token={token} notes={data.notes} />
      )}
    </div>
  );
}

function SpaceGraph({ token, notes }: { token: string; notes: ListItem[] }) {
  const { nodes, links } = useMemo(() => {
    const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
    const links: GLink[] = [];
    for (const n of notes) for (const t of n.links) { const to = byTitle.get(t.toLowerCase()); if (to && to !== n.id) links.push({ source: n.id, target: to }); }
    const deg = new Map<string, number>();
    links.forEach((l) => { deg.set(l.source as string, (deg.get(l.source as string) ?? 0) + 1); deg.set(l.target as string, (deg.get(l.target as string) ?? 0) + 1); });
    const nodes: GNode[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", deg: deg.get(n.id) ?? 0, color: n.status ? STATUS_COLOR[n.status] : STATUS_COLOR.todo, note: { id: n.id, title: n.title, type: n.type, status: n.status, body: n.excerpt } as Note }));
    return { nodes, links };
  }, [notes]);
  return (
    <div className="relative h-[420px] overflow-hidden rounded-[14px] border border-line bg-surface md:h-[480px]">
      <Canvas2D nodes={nodes} links={links} focus={null} onOpen={(id) => go(`/s/${token}/${id}`)} />
      <div className="pointer-events-none absolute bottom-3 start-3.5 flex flex-wrap gap-3 text-[12px] text-muted">
        {(["todo", "learning", "review", "mastered"] as Status[]).map((s) => <span key={s} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />{t(STATUS_LABEL[s])}</span>)}
      </div>
    </div>
  );
}

function SpaceNote({ token, id, titles }: { token: string; id: string; titles: ListItem[] }) {
  const [note, setNote] = useState<PubNote | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setNote(null); publicApi<{ note: PubNote }>(`/share/${token}/note/${id}`).then((d) => { setNote(d.note); scrollTo(0, 0); }).catch((e) => setErr(e.message)); }, [token, id]);
  if (err) return <p className="py-16 text-center text-muted">{err}</p>;
  if (!note) return <div className="mx-auto mt-14 h-60 max-w-[680px] animate-pulse rounded-[14px] bg-surface" />;
  return <NoteViewer note={note} refsPath={`/share/${token}/refs?note=${encodeURIComponent(id)}`} onWiki={(t) => { const hit = titles.find((n) => n.title.toLowerCase() === t.toLowerCase()); if (hit) go(`/s/${token}/${hit.id}`); }} />;
}

// ------------------------------------------------------------------ single note, by type
function NoteViewer({ note, onWiki, refsPath }: { note: PubNote; onWiki?: (title: string) => void; refsPath?: string }) {
  if (note.type === "slides") return <SlidesPage note={note} />;
  if (note.type === "flashcards") return <FlashcardsPage note={note} />;
  if (isBoard(note.type)) return (
    <div className="flex flex-col gap-4 pt-6 md:pt-10">
      <h1 dir="auto" className="text-[28px] font-bold tracking-[-.02em]" style={{ fontFamily: SERIF }}>{note.title}</h1>
      <BoardInline note={note} refsPath={refsPath} />
    </div>
  );
  return <Article note={note} onWiki={onWiki} />;
}

function BoardInline({ note, refsPath }: { note: PubNote; refsPath?: string }) {
  const [ex, setEx] = useState<ExApi | null>(null);
  return <div className="relative h-[70vh] overflow-hidden rounded-[14px] border border-line bg-surface"><BoardBody note={note} onApi={setEx} ex={ex} refsPath={refsPath} /></div>;
}

const Meta = ({ note, extra }: { note: PubNote; extra?: ReactNode }) => (
  <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 font-sans text-[13px] text-muted">
    <span>{t("Updated {when}", { when: relTime(note.updatedAt) })}</span>{extra}
    {note.tags.map((t) => <span key={t} className="text-link">#{t}</span>)}
  </div>
);

function useActiveHeading(lines: number[], root: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!lines.length) return;
    const on = () => {
      let cur: number | null = lines[0];
      for (const l of lines) { const el = root.current?.querySelector(`[data-line="${l}"]`); if (el && el.getBoundingClientRect().top < 140) cur = l; }
      setActive(cur);
    };
    on();
    addEventListener("scroll", on, { passive: true, capture: true });
    return () => removeEventListener("scroll", on, { capture: true });
  }, [lines, root]);
  return active;
}

function Article({ note, onWiki }: { note: PubNote; onWiki?: (t: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const toc = useMemo(() => outline(note.body).filter((h) => h.level >= 2 && h.level <= 3), [note.body]);
  const lines = useMemo(() => toc.map((h) => h.line), [toc]);
  const active = useActiveHeading(lines, ref);
  return (
    <div className="flex justify-center gap-14 pt-6 md:pt-14">
      {toc.length > 1 && (
        <aside className="sticky top-[100px] hidden w-[200px] shrink-0 flex-col gap-2.5 self-start pt-[140px] text-[13px] lg:flex">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{t("On this page")}</span>
          {toc.map((h) => (
            <button key={h.line} dir="auto" onClick={() => ref.current?.querySelector(`[data-line="${h.line}"]`)?.scrollIntoView({ behavior: "smooth" })}
              className={cx("flex items-center gap-2 text-start", h.level === 3 && "ps-3", active === h.line ? "font-semibold text-ink" : "text-muted hover:text-ink")}>
              {active === h.line && <span className="-ms-2.5 h-4 w-0.5 shrink-0 bg-accent" />}{h.text}
            </button>
          ))}
        </aside>
      )}
      <article ref={ref} className="flex w-full max-w-[680px] min-w-0 flex-col gap-4 md:gap-5" style={{ fontFamily: SERIF }}>
        <h1 dir="auto" className="text-[32px] font-bold leading-[1.15] tracking-[-.02em] md:text-[46px]">{note.title}</h1>
        <Meta note={note} extra={note.type !== "roadmap" && <><span>·</span><span>{t("{n} min read", { n: readingMinutes(note.body) })}</span>{note.tags.length > 0 && <span>·</span>}</>} />
        {note.type === "roadmap" ? <div className="font-sans"><RoadmapReadOnly body={note.body} titles={[]} /></div>
          : <Markdown body={withoutTitle(note.body, note.title)} onWiki={onWiki} className="!max-w-none" style={{ "--read-font": SERIF, "--read-size": "17px", lineHeight: "30px" } as React.CSSProperties} />}
      </article>
    </div>
  );
}

/** The page already shows the title: drop a leading "# Title" line that repeats it. */
function withoutTitle(body: string, title: string) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body)?.[0] ?? "";
  const rest = body.slice(fm.length);
  const m = /^\s*#\s+(.+?)\s*(\r?\n|$)/.exec(rest);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? fm + rest.slice(m[0].length) : body;
}
function Markdown({ body, onWiki, className, style }: { body: string; onWiki?: (t: string) => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => render(body), [body]);
  useEffect(() => {
    const el = ref.current!;
    el.innerHTML = html;
    el.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((c) => (c.disabled = true));
    hydrate(el, { canvas: (c, json) => { const { canvas, error } = parseCanvas(json); c.innerHTML = error ? "" : previewSvg(canvas); } });
  }, [html]);
  return (
    <div ref={ref} style={style} className={"prose " + (className ?? "")} onClick={(e) => {
      if (handleCopyClick(e)) return;
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.wikilink, a.tag");
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains("wikilink")) onWiki?.(a.dataset.note ?? "");
    }} />
  );
}

// ------------------------------------------------------------------ roadmap
const TOPIC_DOT: Record<TopicStatus, React.CSSProperties> = {
  done: { background: "var(--success)" },
  learning: { border: "2px solid var(--info)" },
  skipped: { border: "1.5px dashed var(--muted)" },
  todo: { border: "1.5px solid var(--muted)" },
};
function RoadmapReadOnly({ body, titles, onOpen }: { body: string; titles: ListItem[]; onOpen?: (id: string) => void }) {
  const mods = useMemo(() => roadmap(body), [body]);
  return (
    <div className="flex flex-col gap-2.5">
      {mods.map((m, i) => {
        const p = progress([m]);
        return (
          <section key={i} className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            <div className="flex items-center gap-3">
              <span dir="auto" className="flex-1 font-semibold">{m.name}</span>
              <span className="h-[5px] w-[60px] overflow-hidden rounded-[3px] bg-surface-2 md:w-[200px]"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
              <span className="w-[34px] text-end text-[12px] tabular-nums text-muted">{t("{done}/{total}", { done: p.done, total: p.total })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-md:gap-2">
              {m.topics.map((tp) => {
                const linked = titles.find((n) => n.title.toLowerCase() === (tp.note ?? tp.name).toLowerCase());
                return (
                  <span key={tp.line} className={cx("flex h-[30px] items-center gap-[7px] whitespace-nowrap rounded-[8px] border border-line bg-bg ps-2.5 text-[12.5px]", linked && onOpen ? "pe-1.5" : "pe-2.5", tp.locked && "opacity-45")}>
                    <span className="box-border flex size-3 shrink-0 items-center justify-center rounded-full" style={TOPIC_DOT[tp.status]}>{tp.status === "done" && <Check size={9} strokeWidth={3} className="text-bg" />}</span>
                    <span dir="auto" className={cx(tp.status === "skipped" && "line-through")}>{tp.name}</span>
                    {tp.locked && <Lock size={11} className="text-muted" />}
                    {linked && onOpen && <button onClick={() => onOpen(linked.id)} title={t("Open lesson")} className="flex size-[22px] items-center justify-center rounded-[6px] bg-surface-2 text-link"><FileText size={12} /></button>}
                  </span>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ slides
function slideInfo(md: string) {
  const first = md.split("\n").map((l) => l.trim()).find((l) => l && !/^(<!--|note:)/i.test(l)) ?? "";
  const img = /!\[([^\]]*)\]\(([^)]*)\)/.exec(first);
  const head = /^#{1,3}\s+(.+)$/m.exec(md)?.[1]
    ?? (img ? img[1] || img[2].replace(/^att:/, "") : /^https?:\/\//.test(first) ? (/youtu\.?be|vimeo/.test(first) ? t("Video") : first.replace(/^https?:\/\/(www\.)?/, "")) : first.replace(/^[-*>\s]+/, ""));
  const media = /youtu\.?be|vimeo|\.(mp4|webm|mov|mp3|m4a)\b|```mermaid/i.test(md) ? t("Media") : /!\[/.test(md) ? t("Image") : "";
  return { head: head.slice(0, 80), media };
}
function SlidesPage({ note }: { note: PubNote }) {
  const slides = useMemo(() => splitSlides(note.body), [note.body]);
  const [present, setPresent] = useState<number | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-[22px] pt-6 md:pt-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-5">
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{t("Slides · {n}", { n: slides.length })}</span>
          <h1 dir="auto" className="text-[30px] font-bold leading-[1.15] tracking-[-.02em] md:text-[40px]" style={{ fontFamily: SERIF }}>{note.title}</h1>
          <Meta note={note} extra={<><span>·</span><span>{t("~{n} min talk", { n: Math.max(1, Math.round(slides.length * 1.25)) })}</span></>} />
        </div>
        <button onClick={() => setPresent(0)} className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] bg-accent px-[22px] text-[15px] font-semibold text-accent-fg"><Play size={16} />{t("Present")}</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {slides.map((s, i) => {
          const info = slideInfo(s);
          return (
            <button key={i} onClick={() => setPresent(i)} className="flex flex-col gap-1.5 text-start">
              <div className="relative box-border flex aspect-video w-full flex-col gap-2 overflow-hidden rounded-[8px] bg-[#0F1115] p-3 text-[#E8E6E1] hover:ring-2 hover:ring-accent md:p-4">
                <span dir="auto" className="line-clamp-2 text-[12px] font-bold md:text-[14px]">{info.head}</span>
                <span className="h-1 w-[70%] rounded-sm bg-[#9AA0AA] opacity-40" /><span className="h-1 w-[55%] rounded-sm bg-[#9AA0AA] opacity-40" />
                {info.media && <span className="absolute bottom-2.5 end-2.5 rounded-[5px] bg-white/[.12] px-[7px] py-px text-[10.5px]">{info.media}</span>}
              </div>
              <span className="text-[12px] text-muted">{t("{i} / {n}", { i: i + 1, n: slides.length })}</span>
            </button>
          );
        })}
      </div>
      {present !== null && <MiniSlides title={note.title} slides={slides} start={present} onExit={() => setPresent(null)} />}
    </div>
  );
}

function MiniSlides({ title, slides, start, onExit }: { title: string; slides: string[]; start: number; onExit: () => void }) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const next = () => setI((x) => Math.min(slides.length - 1, x + 1));
  const prev = () => setI((x) => Math.max(0, x - 1));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", " ", "PageDown"].includes(e.key)) next();
      else if (["ArrowLeft", "PageUp"].includes(e.key)) prev();
      else if (e.key === "f" || e.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
      else if (e.key === "Escape") onExit();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [slides.length, onExit]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = "flex items-center justify-center rounded-[10px] border border-[#2A303B] text-[#E8E6E1] disabled:opacity-40";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0A0C0F] text-[#E8E6E1]"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => { if (touch.current === null) return; const d = e.changedTouches[0].clientX - touch.current; if (Math.abs(d) > 50) (d < 0 ? next : prev)(); touch.current = null; }}>
      <div className="safe-t h-[3px] shrink-0 bg-[#1D222B]"><div className="h-full bg-[#F2A93B] transition-all" style={{ width: `${((i + 1) / slides.length) * 100}%` }} /></div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-3 md:px-[120px]" onClick={next}>
        <div className="slide box-border flex aspect-video w-full max-w-[1200px] flex-col overflow-hidden rounded-[10px] bg-[#0F1115] px-[18px] py-4 md:px-20 md:py-16" style={{ fontSize: "clamp(11px, 2.1vw, 28px)", "--text": "#E8E6E1", "--muted": "#9AA0AA" } as React.CSSProperties}>
          <Markdown key={i} body={slides[i]} className="!max-w-none !text-[1em]" />
        </div>
      </div>
      <div className="relative hidden h-16 items-center justify-center gap-4 text-[13px] text-[#9AA0AA] md:flex">
        <span dir="auto" className="absolute start-6 truncate">{title}</span>
        <button aria-label={t("Previous")} disabled={i === 0} onClick={prev} className={cx(nav, "size-10")}><ChevronLeft size={18} /></button>
        <span className="tabular-nums text-[#E8E6E1]">{t("{i} / {n}", { i: i + 1, n: slides.length })}</span>
        <button aria-label={t("Next")} disabled={i === slides.length - 1} onClick={next} className={cx(nav, "size-10")}><ChevronRight size={18} /></button>
        <button onClick={onExit} className="absolute end-6 hover:text-[#E8E6E1]">{t("F fullscreen · Esc exit")}</button>
      </div>
      <div className="safe-b flex flex-col md:hidden">
        <div className="flex items-center gap-3 px-4 pb-4">
          <button aria-label={t("Previous")} disabled={i === 0} onClick={prev} className={cx(nav, "h-[52px] flex-1 rounded-[12px]")}><ChevronLeft size={20} /></button>
          <span className="w-[60px] text-center text-[14px] tabular-nums">{t("{i} / {n}", { i: i + 1, n: slides.length })}</span>
          <button aria-label={t("Next")} disabled={i === slides.length - 1} onClick={next} className={cx(nav, "h-[52px] flex-1 rounded-[12px]")}><ChevronRight size={20} /></button>
        </div>
        <div className="flex items-center justify-center gap-3 px-4 pb-2 text-[12px] text-[#9AA0AA]">{t("Swipe to move · rotate for full screen")}<button onClick={onExit} className="text-[#E8E6E1] underline">{t("Exit")}</button></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ flashcards
function FlashcardsPage({ note }: { note: PubNote }) {
  const cards = useMemo(() => flashcards(note.body), [note.body]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const move = (d: number) => { setI((x) => Math.max(0, Math.min(cards.length - 1, x + d))); setFlip(false); };
  const c = cards[i];
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[22px] pt-6 md:pt-10">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-learn">{t("Flashcards · {n}", { n: cards.length })}</span>
        <h1 dir="auto" className="text-[26px] font-bold tracking-[-.02em] md:text-[36px]" style={{ fontFamily: SERIF }}>{note.title}</h1>
      </div>
      {c ? (
        <>
          <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-5 py-5 shadow-[var(--sh,none)] md:px-[26px] md:py-[22px]">
            <div className="flex items-center text-[12.5px] text-muted">
              <span className="flex items-center gap-1.5 font-semibold text-learn"><Layers size={13} />{t("Practice")}</span><span className="flex-1" />{t("{i} / {n}", { i: i + 1, n: cards.length })}
            </div>
            <button onClick={() => setFlip((f) => !f)} className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center">
              <Markdown body={c.q} className={cx("!m-0 !max-w-none text-center [&_p]:m-0", flip ? "text-muted" : "font-semibold")} style={{ "--read-font": SERIF, "--read-size": flip ? "19px" : "26px" } as React.CSSProperties} />
              {flip ? (
                <><span className="h-px w-2/3 bg-line" /><Markdown body={c.a} className="!m-0 !max-w-none text-center font-semibold" style={{ "--read-size": "22px" } as React.CSSProperties} /></>
              ) : <span className="flex h-9 items-center gap-2 rounded-full border border-dashed border-line px-4 text-[13px] text-muted"><Eye size={14} />{t("Tap to reveal")}</span>}
            </button>
            <div className="flex items-center gap-2.5">
              <button disabled={i === 0} onClick={() => move(-1)} className="flex h-[52px] items-center justify-center gap-1.5 rounded-[12px] border border-line px-3.5 disabled:opacity-40 max-md:flex-1 md:h-[38px] md:rounded-[10px]"><ChevronLeft size={15} />{t("Previous")}</button>
              <span className="hidden flex-1 text-center text-[12px] text-muted md:block">{t("Practice mode — nothing is saved")}</span>
              <button disabled={i === cards.length - 1} onClick={() => move(1)} className="flex h-[52px] items-center justify-center gap-1.5 rounded-[12px] bg-accent px-4 font-semibold text-accent-fg disabled:opacity-40 max-md:flex-1 md:h-[38px] md:rounded-[10px]">{t("Next")}<ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="flex flex-col">
            {cards.map((k, j) => (
              <div key={j} className="grid grid-cols-2 gap-5 border-t border-line py-3 text-[14px] leading-[20px] [&_p]:m-0">
                <Markdown body={k.q} className="!m-0 !max-w-none font-medium" style={{ "--read-size": "14px", "--read-font": "Inter, system-ui, sans-serif", lineHeight: "20px" } as React.CSSProperties} />
                <Markdown body={k.a} className="!m-0 !max-w-none text-muted" style={{ "--read-size": "14px", "--read-font": "Inter, system-ui, sans-serif", lineHeight: "20px" } as React.CSSProperties} />
              </div>
            ))}
          </div>
        </>
      ) : <Markdown body={note.body} />}
    </div>
  );
}

// ------------------------------------------------------------------ canvas / whiteboard (full-bleed page)
function ZoomBar({ ex }: { ex: ExApi | null }) {
  const [z, setZ] = useState(1);
  useEffect(() => { if (!ex) return; setZ(ex.getAppState().zoom.value); return ex.onChange((_e, st) => setZ(st.zoom.value)); }, [ex]);
  const zoom = (f: number) => { if (!ex) return; const v = Math.min(30, Math.max(0.1, Math.round(ex.getAppState().zoom.value * f * 10) / 10)); ex.updateScene({ appState: { zoom: { value: v } } }); };
  const b = "flex size-[30px] items-center justify-center rounded-[7px] hover:bg-surface-2 disabled:opacity-40";
  return (
    <div className="absolute bottom-4 start-4 z-10 hidden items-center gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] md:flex">
      <button aria-label={t("Zoom out")} title={t("Zoom out")} disabled={!ex} onClick={() => zoom(1 / 1.2)} className={b}><Minus size={14} /></button>
      <button title={t("Reset to 100%")} disabled={!ex} onClick={() => ex?.updateScene({ appState: { zoom: { value: 1 } } })} className="w-10 text-center text-[12px] tabular-nums">{t("{n}%", { n: Math.round(z * 100) })}</button>
      <button aria-label={t("Zoom in")} title={t("Zoom in")} disabled={!ex} onClick={() => zoom(1.2)} className={b}><Plus size={14} /></button>
      <button aria-label={t("Fit to screen")} title={t("Fit to screen")} disabled={!ex} onClick={() => ex?.scrollToContent(undefined, { fitToContent: true, animate: true })} className={b}><Scan size={14} /></button>
    </div>
  );
}
function BoardBody({ note, onApi, ex, refsPath }: { note: PubNote; onApi?: (a: ExApi) => void; ex?: ExApi | null; refsPath?: string }) {
  const [refs, setRefs] = useState<Record<string, FileRef>>({});
  useEffect(() => { if (refsPath && note.type === "canvas") publicApi<{ refs: Record<string, FileRef> }>(refsPath).then((r) => setRefs(r.refs ?? {})).catch(() => {}); }, [refsPath, note.type]);
  if (note.type === "whiteboard") return (
    <>
      <style>{".lumen-board .excalidraw .layer-ui__wrapper__footer-left,.lumen-board .excalidraw .layer-ui__wrapper__footer-right,.lumen-board .excalidraw .App-menu_top,.lumen-board .excalidraw .exit-view-mode{display:none!important}.lumen-board .excalidraw{--color-surface-low:transparent}"}</style>
      <div className="lumen-board absolute inset-0"><Suspense fallback={null}><BoardViewer body={note.body} onApi={onApi ?? (() => {})} /></Suspense></div>
      <ZoomBar ex={ex ?? null} />
      <span className="pointer-events-none absolute left-1/2 top-4 z-10 hidden h-[30px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] text-muted md:flex"><Hand size={13} />{t("View only · drag to pan, pinch or ⌘ scroll to zoom")}</span>
    </>
  );
  const { canvas, error } = parseCanvas(note.body);
  return (
    <>
      {error ? <div className="render-error absolute inset-4">{error}</div> : <CanvasView canvas={canvas} refs={refs} />}
      <span className="pointer-events-none absolute start-5 top-4 hidden h-[30px] md:flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] text-muted"><Eye size={13} />{t("Preview · opens in Lumen or Obsidian")}</span>
    </>
  );
}
const downloadBoard = (note: PubNote) => note.type === "canvas"
  ? download(`${note.title}.canvas`, note.body, "application/json")
  : download(`${note.title}.excalidraw`, note.body, "application/json");

function BoardPage({ blog, note, theme, refsPath }: { blog: Brand; note: PubNote; theme: { dark: boolean; toggle: () => void }; refsPath?: string }) {
  const isCanvas = note.type === "canvas";
  const [ex, setEx] = useState<ExApi | null>(null);
  const [busy, setBusy] = useState(false);
  const png = async () => { setBusy(true); try { await boardPng(note, ex); } finally { setBusy(false); } };
  const label = isCanvas ? t("Download .canvas") : t("Download .excalidraw");
  return (
    <div className="flex h-dvh flex-col bg-bg text-[14px] leading-[normal] text-ink">
      <div className={cx("safe-t hidden h-[60px] shrink-0 items-center gap-3.5 border-b border-line px-10 md:flex", !isCanvas && "bg-surface")}>
        <BrandName blog={blog} /><span className="text-muted">/</span>
        <span dir="auto" className="flex-1 truncate font-semibold"><Glyph name={isCanvas ? "canvas" : "whiteboard"} size={15} style={{ verticalAlign: "-3px" }} /> {note.title}</span>
        {isCanvas ? <button onClick={() => downloadBoard(note)} className="flex h-[38px] items-center gap-2 rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg"><Download size={15} />{label}</button>
          : <button onClick={png} disabled={busy} title={t("Download as PNG image")} className="flex h-[38px] items-center gap-2 rounded-[10px] border border-line px-3.5 disabled:opacity-60">{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}PNG</button>}
        <ThemeBtn {...theme} />
      </div>
      <div className={cx("safe-t flex items-center gap-2 border-b border-line px-5 pb-3.5 pt-2.5 md:hidden", !isCanvas && "bg-surface")}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12px] text-muted">{blog.name} · {isCanvas ? t("canvas") : t("whiteboard · view only")}</span>
          <span dir="auto" className="truncate text-[18px] font-[650]"><Glyph name={isCanvas ? "canvas" : "whiteboard"} size={15} style={{ verticalAlign: "-1px" }} /> {note.title}</span>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden"><BoardBody note={note} onApi={setEx} ex={ex} refsPath={refsPath} /></div>
      {isCanvas && <div className="safe-b p-4 md:hidden"><button onClick={() => downloadBoard(note)} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] bg-accent font-semibold text-accent-fg"><Download size={16} />{label}</button></div>}
    </div>
  );
}
