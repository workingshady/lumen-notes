import { ArrowLeft, Moon, Rss, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { outline, readingMinutes } from "../lib/parse";
import { activeTheme, setSettings } from "../lib/settings";

interface Brand { name: string; tagline: string; author: string; avatar: string }
interface Post { id: string; title: string; slug: string; tags: string[]; createdAt: number; updatedAt: number; excerpt: string; words: number; body?: string; props: Record<string, string> }

const nav = (path: string) => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")); };
const date = (p: Post) => new Date(p.props.date ? Date.parse(p.props.date) : p.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export function Blog({ path }: { path: string }) {
  const slug = decodeURIComponent(path.replace(/^\/blog\/?/, "").replace(/\/$/, ""));
  const [dark, setDark] = useState(activeTheme().dark);
  const toggle = () => { setSettings({ theme: dark ? "paper" : "lamplight" }); setDark(!dark); };
  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto max-w-3xl px-5 py-8 md:py-14">
        {slug ? <PostPage slug={slug} /> : <Index />}
        <footer className="mt-16 flex items-center gap-3 border-t border-line pt-6 text-[12.5px] text-muted">
          <span>Written with Lumen</span>
          <a href="/rss.xml" className="flex items-center gap-1 hover:text-ink"><Rss size={13} /> RSS</a>
          <button onClick={toggle} className="ml-auto flex items-center gap-1 hover:text-ink">{dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light" : "Dark"}</button>
        </footer>
      </div>
    </div>
  );
}

function Index() {
  const [data, setData] = useState<{ blog: Brand; posts: Post[] } | null>(null);
  const [err, setErr] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => { api<{ blog: Brand; posts: Post[] }>("/public/posts").then((d) => { setData(d); document.title = d.blog.name; }).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-muted">Couldn't load posts: {err}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-[14px] bg-surface" />;
  const tags = [...new Set(data.posts.flatMap((p) => p.tags))];
  const posts = tag ? data.posts.filter((p) => p.tags.includes(tag)) : data.posts;
  return (
    <>
      <header className="mb-10">
        <div className="text-4xl">{data.blog.avatar}</div>
        <h1 className="mt-3 text-[34px] font-bold tracking-tight">{data.blog.name}</h1>
        {data.blog.tagline && <p className="mt-1 text-[17px] text-muted">{data.blog.tagline}</p>}
        {data.blog.author && <p className="mt-1 text-[13px] text-muted">by {data.blog.author}</p>}
      </header>
      {tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {tags.map((t) => <button key={t} onClick={() => setTag(tag === t ? null : t)} className={"rounded-full px-2.5 py-0.5 text-[12.5px] " + (tag === t ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-ink")}>#{t}</button>)}
        </div>
      )}
      <div className="space-y-2">
        {posts.map((p) => (
          <a key={p.id} href={`/blog/${p.slug}`} onClick={(e) => { e.preventDefault(); nav(`/blog/${p.slug}`); }} className="block rounded-[14px] p-4 -mx-4 hover:bg-surface">
            <div className="text-[12.5px] text-muted">{date(p)} · {Math.max(1, Math.round(p.words / 220))} min read</div>
            <h2 className="mt-1 text-[21px] font-semibold tracking-tight">{p.title}</h2>
            <p className="mt-1 line-clamp-2 text-[15px] text-muted">{p.excerpt}</p>
            {p.tags.length > 0 && <div className="mt-2 flex gap-1.5 text-[12px] text-muted">{p.tags.map((t) => <span key={t}>#{t}</span>)}</div>}
          </a>
        ))}
        {!posts.length && <p className="text-muted">No posts yet.</p>}
      </div>
    </>
  );
}

function PostPage({ slug }: { slug: string }) {
  const [data, setData] = useState<{ blog: Brand; post: Post; prev: Post | null; next: Post | null } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null);
    api<{ blog: Brand; post: Post; prev: Post | null; next: Post | null }>(`/public/posts/${encodeURIComponent(slug)}`).then((d) => { setData(d); document.title = `${d.post.title} · ${d.blog.name}`; scrollTo(0, 0); }).catch((e) => setErr(e.message));
  }, [slug]);
  const html = useMemo(() => (data?.post.body ? render(data.post.body) : ""), [data]);
  const toc = useMemo(() => (data?.post.body ? outline(data.post.body).filter((h) => h.level <= 3) : []), [data]);
  useEffect(() => { const el = document.getElementById("post-body"); if (el && html) { el.innerHTML = html; hydrate(el); } }, [html]);
  if (err) return <div><Back /><p className="mt-6 text-muted">{err === "Not found" ? "This post doesn't exist or was unpublished." : err}</p></div>;
  if (!data) return <div className="h-60 animate-pulse rounded-[14px] bg-surface" />;
  const p = data.post;
  return (
    <article>
      <Back name={data.blog.name} />
      <header className="mb-8 mt-6">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight">{p.title}</h1>
        <div className="mt-2 text-[13.5px] text-muted">{date(p)} · {readingMinutes(p.body ?? "")} min read{data.blog.author ? ` · ${data.blog.author}` : ""}</div>
      </header>
      {toc.length > 2 && (
        <details className="mb-8 rounded-[12px] border border-line bg-surface px-4 py-2 text-[14px]">
          <summary className="cursor-pointer font-medium">Contents</summary>
          <ul className="mt-2 space-y-1 pb-2">{toc.map((h) => <li key={h.line} style={{ paddingLeft: (h.level - 1) * 14 }}><a className="text-muted hover:text-ink" href="#" onClick={(e) => { e.preventDefault(); document.querySelector(`#post-body [data-line="${h.line}"]`)?.scrollIntoView({ behavior: "smooth" }); }}>{h.text}</a></li>)}</ul>
        </details>
      )}
      <div id="post-body" className="prose" onClick={(e) => { handleCopyClick(e); const a = (e.target as HTMLElement).closest("a.wikilink,a.tag"); if (a) e.preventDefault(); }} />
      <nav className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
        {data.next ? <a href={`/blog/${data.next.slug}`} onClick={(e) => { e.preventDefault(); nav(`/blog/${data.next!.slug}`); }} className="rounded-[12px] border border-line p-3 hover:border-accent"><div className="text-[12px] text-muted">← Newer</div><div className="font-medium">{data.next.title}</div></a> : <span />}
        {data.prev ? <a href={`/blog/${data.prev.slug}`} onClick={(e) => { e.preventDefault(); nav(`/blog/${data.prev!.slug}`); }} className="rounded-[12px] border border-line p-3 text-right hover:border-accent"><div className="text-[12px] text-muted">Older →</div><div className="font-medium">{data.prev.title}</div></a> : null}
      </nav>
    </article>
  );
}

const Back = ({ name }: { name?: string }) => (
  <a href="/blog" onClick={(e) => { e.preventDefault(); nav("/blog"); }} className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink"><ArrowLeft size={15} /> {name ?? "All posts"}</a>
);
