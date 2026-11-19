import type { Note } from "../../shared/types";
import { api } from "../lib/api";
import { db, DEFAULT_SPACE, DEMO } from "../lib/db";
import { getSettings } from "../lib/settings";

/**
 * Public pages (blog, /s/<token>) read the Worker. Demo mode (?demo=1) never syncs, so there the same
 * responses are built from the local demo database with the Worker's exact rules (worker/index.ts).
 */
export function publicApi<T>(path: string): Promise<T> {
  // ?state=loading (demo only) holds the loading skeleton for screenshots.
  if (DEMO && new URLSearchParams(location.search).get("state") === "loading") return new Promise<T>(() => {});
  return DEMO ? (local(path) as Promise<T>) : api<T>(path);
}

const excerpt = (md: string) =>
  md.replace(/^---[\s\S]*?---/, "").replace(/^\s*#\s.*$/m, "").replace(/^\s*(---|\*\*\*)\s*$/gm, "").replace(/\[![\w-]+\][+-]?/g, "").replace(/^\s*[-*+]\s+\[[ xX/>?-]\]\s+/gm, "").replace(/\s*\p{Extended_Pictographic}\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[^$\n]+\$/g, "…").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*_`[\]!]|\(.*?\)/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
const publicNote = (n: Note) => ({ id: n.id, title: n.title, body: n.body, type: n.type, tags: n.tags, status: n.status, createdAt: n.createdAt, updatedAt: n.updatedAt });
const toPost = (n: Note, full = false) => ({
  id: n.id, title: n.title, slug: n.slug || n.id, tags: n.tags, createdAt: n.createdAt, updatedAt: n.updatedAt, props: n.props ?? {},
  excerpt: n.props?.excerpt || excerpt(n.body), words: n.body.split(/\s+/).filter(Boolean).length, ...(full ? { body: n.body } : {}),
});
class NotFound extends Error { status = 404; }

async function branding() {
  const p = (await db.spaces.get(DEFAULT_SPACE))?.props ?? {};
  const s = getSettings();
  return { name: p.blogName || s.blogName || "Lumen", tagline: p.tagline ?? s.tagline ?? "", author: p.author ?? s.author ?? "", avatar: p.avatar ?? s.avatar ?? "glyph:owl" };
}
async function posts() {
  const all = (await db.notes.toArray()).filter((n) => !n.deleted && n.published);
  const t = (n: Note) => (n.props?.date ? Date.parse(n.props.date) : n.createdAt);
  return all.sort((a, b) => t(b) - t(a));
}

async function local(path: string): Promise<unknown> {
  let m: RegExpExecArray | null;
  if (path === "/public/posts") return { blog: await branding(), posts: (await posts()).map((n) => toPost(n)) };
  if ((m = /^\/public\/posts\/(.+)$/.exec(path))) {
    const slug = decodeURIComponent(m[1]);
    const all = await posts();
    const i = all.findIndex((n) => (n.slug || n.id) === slug);
    if (i < 0) throw new NotFound("Not found");
    return { blog: await branding(), post: toPost(all[i], true), prev: all[i + 1] ? toPost(all[i + 1]) : null, next: all[i - 1] ? toPost(all[i - 1]) : null };
  }
  if (path === "/public/blog-meta") {
    const p = (await db.spaces.get(DEFAULT_SPACE))?.props ?? {};
    return { license: p.license ?? "CC BY 4.0", rss: p.rss !== "0" };
  }
  if ((m = /^\/share\/([^/]+)\/refs(?:\?note=(.+))?$/.exec(path))) {
    const token = m[1];
    const root = (await db.notes.toArray()).find((n) => n.shareId === token && !n.deleted);
    const sp = root ? undefined : (await db.spaces.toArray()).find((x) => x.shareId === token && !x.deleted);
    const cv = root ?? (sp && m[2] ? await db.notes.get(decodeURIComponent(m[2])) : undefined);
    if (!cv || (sp && cv.spaceId !== sp.id)) return { refs: {} };
    let files: string[] = [];
    try { files = ((JSON.parse(cv.body) as { nodes?: { type: string; file?: string }[] }).nodes ?? []).filter((n) => n.type === "file" && n.file).map((n) => n.file!); } catch { /* not a canvas */ }
    const all = (await db.notes.toArray()).filter((n) => !n.deleted);
    const refs: Record<string, { title: string; status: string | null; excerpt: string }> = {};
    for (const f of files) { const t = f.split("/").pop()!.replace(/\.md$/, ""); const n = all.find((x) => x.title === t); if (n) refs[f] = { title: n.title, status: n.status, excerpt: refExcerpt(n.body) }; }
    return { refs };
  }
  if ((m = /^\/share\/([^/]+)(?:\/note\/(.+))?$/.exec(path))) {
    const token = m[1];
    const note = (await db.notes.toArray()).find((n) => n.shareId === token && !n.deleted);
    const sp = note ? undefined : (await db.spaces.toArray()).find((s) => s.shareId === token && !s.deleted);
    if (m[2]) {
      if (!sp) throw new NotFound("Not found");
      const n = await db.notes.get(m[2]);
      if (!n || n.deleted || n.spaceId !== sp.id) throw new NotFound("Not found");
      return { note: publicNote(n) };
    }
    if (!note && !sp) throw new NotFound("This link doesn't exist or was turned off.");
    const blog = await branding();
    if (note) return { kind: "note", blog, note: publicNote(note) };
    const notes = (await db.notes.where("spaceId").equals(sp!.id).toArray()).filter((n) => !n.deleted);
    const roadmap = sp!.roadmapId ? notes.find((n) => n.id === sp!.roadmapId) : undefined;
    return {
      kind: "space", blog,
      space: { name: sp!.name, kind: sp!.kind, icon: sp!.icon, color: sp!.color, description: sp!.description, props: Object.fromEntries(Object.entries(sp!.props ?? {}).filter(([k]) => ["goal", "deadline", "target", "url"].includes(k))) },
      roadmap: roadmap ? publicNote(roadmap) : null,
      notes: notes.filter((n) => n.id !== sp!.roadmapId).map((n) => ({ id: n.id, title: n.title, type: n.type, status: n.status, tags: n.tags, updatedAt: n.updatedAt, links: [...n.body.matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1].trim()).slice(0, 50), excerpt: excerpt(n.body).slice(0, 160) })),
    };
  }
  throw new NotFound("Not found");
}

/** Same as worker/ext/settings.ts refExcerpt. */
function refExcerpt(md: string) {
  const greek: Record<string, string> = { theta: "θ", eta: "η", sigma: "σ", alpha: "α", beta: "β", lambda: "λ", nabla: "∇", mu: "μ" };
  // first prose paragraph (skip front-matter, headings, callouts, math/code blocks, lists)
  const para = md.replace(/\r\n/g, "\n").replace(/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/, "").split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !/^(#|>|```|\$\$|[-*+] |\d+\. |!\[|\|)/.test(p)) ?? "";
  return para.replace(/\$([^$\n]+)\$/g, (_, x: string) => x.replace(/\\([a-z]+)/gi, (m: string, g: string) => greek[g] ?? m).replace(/[\\{}]/g, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}
