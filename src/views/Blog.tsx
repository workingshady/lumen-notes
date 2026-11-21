import { API_BASE } from "../lib/api";
import { setOgMeta } from "../lib/og";
import { AvatarGlyph } from "../components/SpaceIcon";
import { ArrowLeft, List, Moon, Rss, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { publicApi } from "./settings-public-demo";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { outline, readingMinutes } from "../lib/parse";
import { activeTheme, setSettings } from "../lib/settings";
import { cx, Sheet } from "../components/ui";
import { fmtDate, t } from "../lib/i18n";

interface Brand { name: string; tagline: string; author: string; avatar: string }
interface Post { id: string; title: string; slug: string; tags: string[]; createdAt: number; updatedAt: number; excerpt: string; words: number; body?: string; props: Record<string, string> }

const SERIF = "'Source Serif 4', Georgia, serif";
const nav = (path: string) => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")); };
const date = (p: Post) => fmtDate(p.props.date ? Date.parse(p.props.date) : p.createdAt);
/** License line + RSS link setting (Settings › Blog, stored on the Inbox space props). */
type BlogMeta = { license: string; rss: boolean };
let metaP: Promise<BlogMeta> | null = null;
function useBlogMeta() {
  const [m, setM] = useState<BlogMeta>({ license: "", rss: true });
  useEffect(() => { (metaP ??= publicApi<BlogMeta>("/public/blog-meta").catch(() => ({ license: "", rss: true }))).then(setM); }, []);
  return m;
}
function Footer({ author }: { author?: string }) {
  const m = useBlogMeta();
  const lic = !m.license || m.license === "none" ? "" : m.license === "All rights reserved" ? `© ${new Date().getFullYear()}${author ? " " + author : ""}` : m.license;
  return (
    <>
      <span>{t("Written in Lumen")}{lic ? ` · ${lic}` : ""}</span>
      {m.rss && <a href="/rss.xml" className="text-link">{t("Subscribe via RSS")}</a>}
    </>
  );
}
/** The post page shows the title above the body: drop a leading "# Title" that repeats it. */
function withoutTitle(body: string, title: string) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body)?.[0] ?? "";
  const rest = body.slice(fm.length);
  const m = /^\s*#\s+(.+?)\s*(\r?\n|$)/.exec(rest);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? fm + rest.slice(m[0].length) : body;
}
const Link = ({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) => (
  <a href={to} className={className} onClick={(e) => { e.preventDefault(); nav(to); }}>{children}</a>
);

export function Blog({ path }: { path: string }) {
  const rest = decodeURIComponent(path.replace(/^\/blog\/?/, "").replace(/\/$/, ""));
  const tagPage = rest.startsWith("tag/") ? rest.slice(4) : null; // /blog/tag/:tag (Lumen 06b)
  const slug = tagPage !== null ? "" : rest;
  const [dark, setDark] = useState(activeTheme().dark);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const meta = useBlogMeta();
  const toggle = () => { setSettings({ theme: dark ? "paper" : "lamplight" }); setDark(!dark); };
  return (
    <div className="min-h-full bg-bg text-[14px] text-ink">
      <header className="safe-t sticky top-0 z-10 flex h-14 items-center gap-6 border-b border-line bg-bg ps-5 pe-2 md:h-16 md:px-14">
        <Link to="/blog" className="flex-1 truncate text-[17px] font-bold md:text-[18px]"><span style={{ fontFamily: SERIF }}>{brand ? <><AvatarGlyph value={brand.avatar} size={15} style={{ verticalAlign: "-2px" }} /> {brand.name}</> : ""}</span></Link>
        <Link to="/blog" className={cx("hidden md:inline", slug ? "text-muted hover:text-ink" : "font-semibold")}>{t("Posts")}</Link>
        <a href="/blog#tags" onClick={(e) => { e.preventDefault(); if (slug) nav("/blog"); setTimeout(() => document.getElementById("tags")?.scrollIntoView({ behavior: "smooth" }), 50); }} className="hidden text-muted hover:text-ink md:inline">{t("Tags")}</a>
        {meta.rss && <a href="/rss.xml" className="hidden items-center gap-1.5 text-muted hover:text-ink md:flex"><Rss size={14} />RSS</a>}
        <div className="flex items-center">
          <button aria-label={dark ? t("Light theme") : t("Dark theme")} onClick={toggle} className="flex size-11 items-center justify-center md:size-8 md:rounded-[8px] md:border md:border-line">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
          {slug && <button aria-label={t("Contents")} onClick={() => setTocOpen(true)} className="flex size-11 items-center justify-center md:hidden"><List size={20} /></button>}
        </div>
      </header>
      {slug ? <PostPage slug={slug} onBrand={setBrand} tocOpen={tocOpen} setTocOpen={setTocOpen} /> : <Index onBrand={setBrand} tagParam={tagPage} />}
    </div>
  );
}

function Index({ onBrand, tagParam }: { onBrand: (b: Brand) => void; tagParam: string | null }) {
  const [data, setData] = useState<{ blog: Brand; posts: Post[] } | null>(null);
  const [err, setErr] = useState("");
  const tag = tagParam;
  const setTag = (x: string | null) => nav(x ? `/blog/tag/${encodeURIComponent(x)}` : "/blog");
  useEffect(() => { publicApi<{ blog: Brand; posts: Post[] }>("/public/posts").then((d) => { setData(d); onBrand(d.blog); document.title = tagParam ? `#${tagParam} · ${d.blog.name}` : d.blog.name; }).catch((e) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => { const m = new Map<string, number>(); data?.posts.forEach((p) => p.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1))); return [...m].sort((a, b) => b[1] - a[1]); }, [data]);
  const wrap = "mx-auto w-full max-w-[720px] px-5 pt-6 md:px-0 md:pt-14";
  if (err) return <p className={cx(wrap, "text-muted")}>{t("Couldn't load posts: {error}", { error: err })}</p>;
  if (!data) return <div className={wrap}><div className="h-40 animate-pulse rounded-[14px] bg-surface" /></div>;
  const posts = tag ? data.posts.filter((p) => p.tags.includes(tag)) : data.posts;
  const chip = (active: boolean) => cx("flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] md:h-8 md:px-3", active ? "bg-ink font-semibold text-bg" : "border border-line text-muted hover:text-ink");
  return (
    <div className={cx(wrap, "flex flex-col gap-3.5 pb-10 md:gap-7")}>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[30px] font-bold leading-9 tracking-[-.02em] md:text-[44px] md:leading-[50px]" style={{ fontFamily: SERIF }}>{data.blog.name}</h1>
        {(data.blog.tagline || data.blog.author) && <p dir="auto" className="leading-[22px] text-muted md:text-[17px] md:leading-5">{data.blog.tagline}{data.blog.author ? `${data.blog.tagline ? " " : ""}${t("by {author}.", { author: data.blog.author })}` : ""}</p>}
      </div>
      {tags.length > 0 && (
        <div id="tags" className="-mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
          <button onClick={() => setTag(null)} className={chip(!tag)}>{t("All")}<span className="hidden md:inline">&nbsp;· {data.posts.length}</span></button>
          {tags.map(([t, n]) => <button key={t} onClick={() => setTag(tag === t ? null : t)} className={chip(tag === t)}>#{t}<span className="hidden md:inline">&nbsp;{n}</span></button>)}
        </div>
      )}
      <div className="flex flex-col pt-2 md:pt-0">
        {posts.map((p) => (
          <Link key={p.id} to={`/blog/${p.slug}`} className="group flex flex-col gap-1.5 border-t border-line py-4 md:gap-2 md:py-[22px]">
            <div className="flex flex-wrap gap-x-2.5 text-[12px] text-muted md:text-[13px]">
              <span>{date(p)}</span><span>·</span><span>{t("{n} min read", { n: Math.max(1, Math.round(p.words / 220)) })}</span>
              <span className="ms-auto hidden gap-2.5 md:flex">{p.tags.map((t) => <span key={t} className="text-link">#{t}</span>)}</span>
            </div>
            <span dir="auto" className="text-[19px] font-[650] leading-[25px] tracking-[-.01em] group-hover:text-link md:text-[24px] md:leading-[30px]" style={{ fontFamily: SERIF }}>{p.title}</span>
            {p.excerpt && <span dir="auto" className="line-clamp-2 text-[15px] leading-[23px] text-muted md:text-[16.5px] md:leading-[27px]" style={{ fontFamily: SERIF }}>{p.excerpt}</span>}
          </Link>
        ))}
        {!posts.length && <p className="border-t border-line py-6 text-muted">{t("No posts yet.")}</p>}
      </div>
      <div className="flex justify-between border-t border-line py-6 text-[12.5px] text-muted"><Footer author={data.blog.author} /></div>
    </div>
  );
}

function PostPage({ slug, onBrand, tocOpen, setTocOpen }: { slug: string; onBrand: (b: Brand) => void; tocOpen: boolean; setTocOpen: (v: boolean) => void }) {
  const [data, setData] = useState<{ blog: Brand; post: Post; prev: Post | null; next: Post | null } | null>(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [read, setRead] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setData(null);
    publicApi<{ blog: Brand; post: Post; prev: Post | null; next: Post | null }>(`/public/posts/${encodeURIComponent(slug)}`).then((d) => { setData(d); onBrand(d.blog); document.title = `${d.post.title} · ${d.blog.name}`; scrollTo(0, 0);
      setOgMeta({ kicker: d.blog.name, title: d.post.title, meta: "", description: d.post.excerpt ?? "" }, `${API_BASE || location.origin}/api/og/post/${encodeURIComponent(d.post.slug || d.post.id)}.png`); }).catch((e) => setErr(e.message));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const html = useMemo(() => (data?.post.body ? render(withoutTitle(data.post.body, data.post.title)) : ""), [data]);
  const toc = useMemo(() => (data?.post.body ? outline(data.post.body).filter((h) => h.level >= 2 && h.level <= 3) : []), [data]);
  useEffect(() => { const el = bodyRef.current; if (el && html) { el.innerHTML = html; hydrate(el); } }, [html]);
  useEffect(() => {
    const on = () => {
      const se = document.scrollingElement ?? document.documentElement;
      setRead(Math.min(1, se.scrollTop / Math.max(1, se.scrollHeight - se.clientHeight)));
      let cur: number | null = toc[0]?.line ?? null;
      for (const h of toc) { const el = bodyRef.current?.querySelector(`[data-line="${h.line}"]`); if (el && el.getBoundingClientRect().top < 140) cur = h.line; }
      setActive(cur);
    };
    on();
    addEventListener("scroll", on, { passive: true, capture: true });
    return () => removeEventListener("scroll", on, { capture: true });
  }, [toc]);
  const jump = (line: number) => { setTocOpen(false); bodyRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ behavior: "smooth" }); };

  if (err) return <div className="mx-auto max-w-[680px] px-5 pt-10"><Link to="/blog" className="inline-flex items-center gap-1.5 text-muted hover:text-ink"><ArrowLeft size={15} /> {t("All posts")}</Link><p className="mt-6 text-muted">{err === "Not found" ? t("This post doesn't exist or was unpublished.") : err}</p></div>;
  if (!data) return <div className="mx-auto max-w-[680px] px-5 pt-16"><div className="h-60 animate-pulse rounded-[14px] bg-surface" /></div>;
  const p = data.post;
  const tocList = (
    <>
      {toc.map((h) => (
        <button key={h.line} dir="auto" onClick={() => jump(h.line)} className={cx("flex items-center gap-2 text-start", h.level === 3 && "ps-3", active === h.line ? "font-semibold text-ink" : "text-muted hover:text-ink")}>
          {active === h.line && <span className="-ms-2.5 h-4 w-0.5 shrink-0 bg-accent" />}{h.text}
        </button>
      ))}
    </>
  );
  const card = "flex flex-col gap-1 rounded-[10px] border border-line p-4 hover:border-accent";
  return (
    <div className="flex justify-center gap-16 px-5 pt-6 md:px-14 md:pt-16">
      <aside className="sticky top-[100px] hidden w-[220px] shrink-0 flex-col gap-2.5 self-start pt-[150px] text-[13px] xl:flex">
        {toc.length > 1 && <><span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{t("On this page")}</span>{tocList}</>}
      </aside>
      <article className="flex w-full max-w-[680px] min-w-0 flex-col gap-4 md:gap-5" style={{ fontFamily: SERIF }}>
        <div className="flex flex-wrap gap-x-2.5 font-sans text-[12.5px] text-muted md:text-[13px]">
          <span>{date(p)}</span><span>·</span><span>{t("{n} min read", { n: readingMinutes(p.body ?? "") })}</span>
          {p.tags.length > 0 && <span className="hidden md:inline">·</span>}
          {p.tags.map((tg) => <Link key={tg} to={`/blog/tag/${encodeURIComponent(tg)}`} className="hidden text-link md:inline">#{tg}</Link>)}
        </div>
        <h1 dir="auto" className="text-[30px] font-bold leading-9 tracking-[-.01em] md:text-[44px] md:leading-[50px] md:tracking-[-.02em]">{p.title}</h1>
        {data.blog.author && (
          <div className="hidden items-center gap-2.5 font-sans text-[13.5px] md:flex">
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-2"><AvatarGlyph value={data.blog.avatar} size={15} /></span><span>{data.blog.author}</span>
          </div>
        )}
        <div id="post-body" ref={bodyRef} className="prose !max-w-none" style={{ "--read-font": SERIF, "--read-size": "17px", lineHeight: "30px" } as React.CSSProperties}
          onClick={(e) => { handleCopyClick(e); const a = (e.target as HTMLElement).closest("a.wikilink,a.tag"); if (a) e.preventDefault(); }} />
        <nav className="mt-10 grid gap-4 border-t border-line pt-6 font-sans sm:grid-cols-2">
          {data.prev ? <Link to={`/blog/${data.prev.slug}`} className={card}><span className="text-[12px] text-muted">{t("← Previous")}</span><span dir="auto" className="text-[17px] font-[650]" style={{ fontFamily: SERIF }}>{data.prev.title}</span></Link> : <span />}
          {data.next ? <Link to={`/blog/${data.next.slug}`} className={cx(card, "text-end")}><span className="text-[12px] text-muted">{t("Next →")}</span><span dir="auto" className="text-[17px] font-[650]" style={{ fontFamily: SERIF }}>{data.next.title}</span></Link> : null}
        </nav>
        <div className="flex justify-between py-6 font-sans text-[12.5px] text-muted"><Footer author={data.blog.author} /></div>
      </article>
      <div className="hidden w-[220px] shrink-0 xl:block" />
      <div className="fixed inset-x-0 bottom-0 z-10 h-[3px] bg-surface-2 md:hidden"><div className="h-full bg-muted" style={{ width: `${read * 100}%` }} /></div>
      <Sheet open={tocOpen} onClose={() => setTocOpen(false)} title={t("On this page")}>
        <div className="flex flex-col gap-3 ps-2.5 text-[15px]">{toc.length ? tocList : <span className="text-muted">{t("No sections in this post.")}</span>}</div>
      </Sheet>
    </div>
  );
}
