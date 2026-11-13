import { ArrowLeft, Brain, ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDashed, CircleSlash, Download, FileText, Lock, Moon, Network, Presentation, Sun, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteType, Status } from "../../shared/types";
import { api } from "../lib/api";
import { parseCanvas, previewSvg } from "../lib/canvas";
import { download } from "../lib/io";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { flashcards, progress, readingMinutes, roadmap, type TopicStatus } from "../lib/parse";
import { activeTheme, setSettings } from "../lib/settings";
import { splitSlides } from "../components/Slides";
import { cx, relTime, Segmented, STATUS_COLOR } from "../components/ui";
import { Canvas2D, type GLink, type GNode } from "./GraphView";
import { Ring } from "./RoadmapView";

const WhiteboardView = lazy(() => import("../components/WhiteboardView"));

type PubNote = Pick<Note, "id" | "title" | "body" | "type" | "tags" | "status" | "createdAt" | "updatedAt">;
type Brand = { name: string; avatar: string };
type ListItem = { id: string; title: string; type: NoteType; status: Status | null; tags: string[]; updatedAt: number; links: string[]; excerpt: string };
type SpaceData = { kind: "space"; blog: Brand; space: { name: string; kind: string; icon: string; color: string | null; description: string; props: Record<string, string> }; roadmap: PubNote | null; notes: ListItem[] };
type NoteData = { kind: "note"; blog: Brand; note: PubNote };

const go = (path: string) => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")); };

/** Read-only viewer for unlisted share links: /s/<token> and /s/<token>/<noteId>. Never touches local data. */
export function Shared({ path }: { path: string }) {
  const [, , token, noteId] = path.split("/");
  const [data, setData] = useState<SpaceData | NoteData | null>(null);
  const [err, setErr] = useState("");
  const [dark, setDark] = useState(activeTheme().dark);
  useEffect(() => { api<SpaceData | NoteData>(`/share/${token}`).then((d) => { setData(d); document.title = d.kind === "note" ? d.note.title : d.space.name; }).catch((e) => setErr(e.message)); }, [token]);

  const body = err ? (
    <div className="py-24 text-center"><Lock className="mx-auto mb-3 text-muted" /><div className="font-semibold">Link unavailable</div><div className="text-[13px] text-muted">{err}</div></div>
  ) : !data ? (
    <div className="h-60 animate-pulse rounded-[14px] bg-surface" />
  ) : data.kind === "note" ? (
    <NoteViewer note={data.note} />
  ) : noteId ? (
    <SpaceNote token={token} id={noteId} titles={data.notes} />
  ) : (
    <SpaceViewer token={token} data={data} />
  );

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto max-w-4xl px-5 py-6 md:py-10">
        {body}
        <footer className="mt-16 flex items-center gap-3 border-t border-line pt-5 text-[12.5px] text-muted">
          <span>{data?.blog.avatar} Shared from {data?.blog.name ?? "Lumen"} · read-only</span>
          <button onClick={() => { setSettings({ theme: dark ? "paper" : "lamplight" }); setDark(!dark); }} className="ml-auto flex items-center gap-1 hover:text-ink">{dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light" : "Dark"}</button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ space (course / project page)
function SpaceViewer({ token, data }: { token: string; data: SpaceData }) {
  const [tab, setTab] = useState<"overview" | "graph">("overview");
  const sp = data.space;
  const mods = useMemo(() => (data.roadmap ? roadmap(data.roadmap.body) : []), [data.roadmap]);
  const p = progress(mods);
  const due = sp.props.deadline || sp.props.target;
  return (
    <>
      <header className="mb-6 flex items-start gap-4">
        <div className="flex size-14 items-center justify-center rounded-[14px] bg-surface text-3xl">{sp.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{sp.kind}</div>
          <h1 dir="auto" className="text-[28px] font-bold tracking-tight">{sp.name}</h1>
          {sp.description && <p dir="auto" className="text-muted">{sp.description}</p>}
          <div className="mt-1 flex flex-wrap gap-3 text-[12.5px] text-muted">
            {sp.props.goal && <span>🎯 {sp.props.goal}</span>}{due && <span>📅 {due}</span>}
            {sp.props.url && <a className="text-link" href={sp.props.url} target="_blank" rel="noreferrer">Course page ↗</a>}
            <span>{data.notes.length} notes</span>
          </div>
        </div>
        {mods.length > 0 && <Ring pct={p.pct} size={60} />}
      </header>
      <Segmented value={tab} onChange={setTab} className="mb-4" options={[{ value: "overview", label: "Overview" }, { value: "graph", label: <><Network size={13} /> Graph</> }]} />
      {tab === "overview" ? (
        <div className="space-y-5">
          {mods.length > 0 && <RoadmapReadOnly body={data.roadmap!.body} titles={data.notes} onOpen={(id) => go(`/s/${token}/${id}`)} />}
          <section>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Notes</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.notes.sort((a, b) => b.updatedAt - a.updatedAt).map((n) => (
                <a key={n.id} href={`/s/${token}/${n.id}`} onClick={(e) => { e.preventDefault(); go(`/s/${token}/${n.id}`); }} className="rounded-[12px] border border-line bg-surface p-3 hover:border-accent">
                  <div dir="auto" className="flex items-center gap-2 font-medium">{n.status && <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[n.status] }} />}{n.title}</div>
                  <div dir="auto" className="mt-1 line-clamp-2 text-[12.5px] text-muted">{n.type === "canvas" ? "Canvas" : n.type === "whiteboard" ? "Whiteboard" : n.excerpt}</div>
                  <div className="mt-1 text-[11px] text-muted">{n.type} · {relTime(n.updatedAt)}</div>
                </a>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <SpaceGraph token={token} notes={data.notes} />
      )}
    </>
  );
}

function SpaceGraph({ token, notes }: { token: string; notes: ListItem[] }) {
  const { nodes, links } = useMemo(() => {
    const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
    const links: GLink[] = [];
    for (const n of notes) for (const t of n.links) { const to = byTitle.get(t.toLowerCase()); if (to && to !== n.id) links.push({ source: n.id, target: to }); }
    const deg = new Map<string, number>();
    links.forEach((l) => { deg.set(l.source as string, (deg.get(l.source as string) ?? 0) + 1); deg.set(l.target as string, (deg.get(l.target as string) ?? 0) + 1); });
    const nodes: GNode[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", deg: deg.get(n.id) ?? 0, color: n.status ? STATUS_COLOR[n.status] : "#7AA2F7", note: { id: n.id, title: n.title, type: n.type, status: n.status, body: n.excerpt } as Note }));
    return { nodes, links };
  }, [notes]);
  return <div className="h-[65vh] overflow-hidden rounded-[14px] border border-line"><Canvas2D nodes={nodes} links={links} focus={null} onOpen={(id) => go(`/s/${token}/${id}`)} /></div>;
}

function SpaceNote({ token, id, titles }: { token: string; id: string; titles: ListItem[] }) {
  const [note, setNote] = useState<PubNote | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setNote(null); api<{ note: PubNote }>(`/share/${token}/note/${id}`).then((d) => { setNote(d.note); scrollTo(0, 0); }).catch((e) => setErr(e.message)); }, [token, id]);
  const back = <a href={`/s/${token}`} onClick={(e) => { e.preventDefault(); go(`/s/${token}`); }} className="mb-5 inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink"><ArrowLeft size={15} /> Back to overview</a>;
  if (err) return <>{back}<p className="text-muted">{err}</p></>;
  if (!note) return <>{back}<div className="h-60 animate-pulse rounded-[14px] bg-surface" /></>;
  return <>{back}<NoteViewer note={note} onWiki={(t) => { const hit = titles.find((n) => n.title.toLowerCase() === t.toLowerCase()); if (hit) go(`/s/${token}/${hit.id}`); }} /></>;
}

// ------------------------------------------------------------------ single note, by type
function NoteViewer({ note, onWiki }: { note: PubNote; onWiki?: (title: string) => void }) {
  const [present, setPresent] = useState(false);
  const head = (
    <header className="mb-6">
      <h1 dir="auto" className="text-[30px] font-bold leading-tight tracking-tight">{note.title}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>Updated {relTime(note.updatedAt)}</span>
        {!["canvas", "whiteboard"].includes(note.type) && <span>{readingMinutes(note.body)} min read</span>}
        {note.type === "slides" && <button onClick={() => setPresent(true)} className="flex items-center gap-1 text-link"><Presentation size={14} /> Present</button>}
        {note.tags.map((t) => <span key={t}>#{t}</span>)}
      </div>
    </header>
  );
  if (present) return <MiniSlides body={note.body} onExit={() => setPresent(false)} />;
  if (note.type === "canvas") {
    const { canvas, error } = parseCanvas(note.body);
    return (<>{head}
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface p-3" dangerouslySetInnerHTML={{ __html: error ? `<div class="render-error">${error}</div>` : previewSvg(canvas, 1200, 560) }} />
      <button onClick={() => download(`${note.title}.canvas`, note.body, "application/json")} className="mt-3 flex items-center gap-1.5 text-[13px] text-link"><Download size={14} /> Download .canvas (opens in Lumen or Obsidian)</button>
    </>);
  }
  if (note.type === "whiteboard") return (<>{head}<div className="h-[70vh] overflow-hidden rounded-[14px] border border-line"><Suspense fallback={null}><WhiteboardView body={note.body} /></Suspense></div></>);
  if (note.type === "roadmap") return (<>{head}<RoadmapReadOnly body={note.body} titles={[]} /></>);
  if (note.type === "flashcards") return (<>{head}<Cards body={note.body} /><Markdown body={note.body} onWiki={onWiki} /></>);
  return (<>{head}<Markdown body={note.body} onWiki={onWiki} /></>);
}

function Markdown({ body, onWiki, className }: { body: string; onWiki?: (t: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => render(body), [body]);
  useEffect(() => {
    const el = ref.current!;
    el.innerHTML = html;
    el.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((c) => (c.disabled = true));
    hydrate(el, { canvas: (c, json) => { const { canvas, error } = parseCanvas(json); c.innerHTML = error ? "" : previewSvg(canvas); } });
  }, [html]);
  return (
    <div ref={ref} className={"prose " + (className ?? "")} onClick={(e) => {
      if (handleCopyClick(e)) return;
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.wikilink, a.tag");
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains("wikilink")) onWiki?.(a.dataset.note ?? "");
    }} />
  );
}

const ICON: Record<TopicStatus, typeof Circle> = { todo: Circle, learning: CircleDashed, done: CircleCheck, skipped: CircleSlash };
const COLOR: Record<TopicStatus, string> = { todo: "var(--muted)", learning: "var(--info)", done: "var(--success)", skipped: "var(--muted)" };
function RoadmapReadOnly({ body, titles, onOpen }: { body: string; titles: ListItem[]; onOpen?: (id: string) => void }) {
  const mods = useMemo(() => roadmap(body), [body]);
  return (
    <div className="space-y-3">
      {mods.map((m, i) => {
        const p = progress([m]);
        return (
          <section key={i} className="rounded-[12px] border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <span dir="auto" className="flex-1 font-semibold">{m.name}</span>
              <span className="text-[12px] tabular-nums text-muted">{p.done}/{p.total}</span>
              <span className="h-1.5 w-20 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
            </div>
            <div className="p-1.5">
              {m.topics.map((t) => {
                const Icon = t.locked ? Lock : ICON[t.status];
                const linked = t.note ? titles.find((n) => n.title.toLowerCase() === t.note!.toLowerCase()) : titles.find((n) => n.title.toLowerCase() === t.name.toLowerCase());
                return (
                  <div key={t.line} className={cx("flex items-center gap-2 rounded-[8px] px-2 py-1.5", t.locked && "opacity-55")}>
                    <Icon size={17} style={{ color: t.locked ? "var(--muted)" : COLOR[t.status] }} />
                    <span dir="auto" className={cx("flex-1 text-[14px]", t.status === "done" && "text-muted line-through")}>{t.name}</span>
                    {t.due && <span className="text-[11.5px] text-muted">{t.due}</span>}
                    {linked && onOpen && <button onClick={() => onOpen(linked.id)} className="text-link" title="Open lesson"><FileText size={15} /></button>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Cards({ body }: { body: string }) {
  const cards = useMemo(() => flashcards(body), [body]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  if (!cards.length) return null;
  const c = cards[i];
  return (
    <div className="mb-8 rounded-[14px] border border-line bg-surface p-5">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted"><Brain size={14} className="text-learn" /> Practice · {i + 1}/{cards.length} (nothing is saved)</div>
      <button onClick={() => setFlip((f) => !f)} className="block w-full text-left">
        <Markdown body={c.q} className="!m-0 text-[1.1em] font-medium" />
        {flip ? <div className="mt-4 border-t border-line pt-4"><Markdown body={c.a} className="!m-0" /></div> : <div className="mt-4 text-[12px] text-muted">Tap to reveal</div>}
      </button>
      <div className="mt-4 flex gap-2">
        <button disabled={i === 0} onClick={() => { setI(i - 1); setFlip(false); }} className="rounded-[8px] bg-surface-2 px-3 py-1.5 text-[13px] disabled:opacity-40">Previous</button>
        <button disabled={i === cards.length - 1} onClick={() => { setI(i + 1); setFlip(false); }} className="rounded-[8px] bg-accent px-3 py-1.5 text-[13px] text-accent-fg disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function MiniSlides({ body, onExit }: { body: string; onExit: () => void }) {
  const slides = useMemo(() => splitSlides(body), [body]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", " ", "PageDown"].includes(e.key)) setI((x) => Math.min(slides.length - 1, x + 1));
      else if (["ArrowLeft", "PageUp"].includes(e.key)) setI((x) => Math.max(0, x - 1));
      else if (e.key === "Escape") onExit();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [slides.length, onExit]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="h-1 bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / slides.length) * 100}%` }} /></div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6 md:p-16" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))}>
        <div className="slide w-full max-w-5xl" style={{ fontSize: "clamp(16px, 2.2vw, 28px)" }}><Markdown key={i} body={slides[i]} className="!max-w-none !text-[1em]" /></div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
        <button onClick={() => setI((x) => Math.max(0, x - 1))}><ChevronLeft size={18} /></button>
        <span className="tabular-nums">{i + 1} / {slides.length}</span>
        <button onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))}><ChevronRight size={18} /></button>
        <button className="ml-auto" onClick={onExit}><X size={18} /></button>
      </div>
    </div>
  );
}
