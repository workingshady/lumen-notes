// Learning path resources: from the path (`resource:` lines) + links inside the course lesson notes + the linked notes themselves.
import type { Note } from "../../shared/types";
import type { GlyphName } from "../lib/glyphs";
import type { BuiltConcept } from "../lib/path";

export interface Res { label: string; url: string; kind: "video" | "article" | "book" | "course" | "file" | "link"; from: string }
export const kindOf = (u: string): Res["kind"] =>
  /youtu\.?be|vimeo\.com|\.(mp4|webm|mov)(\?|$)/i.test(u) ? "video" : /\.(pdf|epub)(\?|$)/i.test(u) ? "book" : /coursera|edx|udemy|khanacademy|fast\.ai|stanford\.edu|mit\.edu|deeplearning\.ai/i.test(u) ? "course" : /^att:/.test(u) ? "file" : /medium|blog|substack|dev\.to|wikipedia|arxiv|github\.io|distill/i.test(u) ? "article" : "link";
export const RES_GLYPH: Record<Res["kind"], GlyphName> = { video: "k-video", article: "k-article", book: "k-book", course: "course", file: "pdf", link: "link-card" };

export function conceptResources(c: BuiltConcept, notes: Map<string, Note>): Res[] {
  const out: Res[] = c.def.resources.map((r) => ({ ...r, kind: kindOf(r.url), from: "Path" }));
  const seen = new Set(out.map((r) => r.url));
  const lessonTitles = new Set([...c.def.notes, ...c.coverage.map((x) => x.topic.note ?? x.topic.name)]);
  for (const t of lessonTitles) {
    const n = notes.get(t.toLowerCase());
    if (!n || n.type === "canvas" || n.type === "whiteboard") continue;
    const course = c.coverage.find((x) => (x.topic.note ?? x.topic.name).toLowerCase() === t.toLowerCase())?.course.spaceName ?? "Note";
    for (const m of n.body.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+|att:[^)\s]+)\)|(?:^|\s)(https?:\/\/[^\s)]+)/gm)) {
      const url = m[2] ?? m[3];
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ label: m[1] ?? url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url, kind: kindOf(url), from: course });
    }
  }
  return out;
}

/** Notes linked to a concept (its `note:` lines + course lesson notes), resolved. */
export function conceptNotes(c: BuiltConcept, byTitle: Map<string, Note>) {
  const titles = [...new Set([...c.def.notes, ...c.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)])];
  return titles.map((t) => ({ title: t, note: byTitle.get(t.toLowerCase()) ?? null }));
}

/** Resource count shown on a concept card: path resources + lesson-note links + linked notes. */
export function resourceCount(c: BuiltConcept, byTitle: Map<string, Note>) {
  return conceptResources(c, byTitle).length + conceptNotes(c, byTitle).filter((x) => x.note).length;
}

export function ago(iso: string | null, today: string) {
  if (!iso) return "";
  const d = Math.round((new Date(today + "T12:00").getTime() - new Date(iso + "T12:00").getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
export function until(iso: string, today: string) {
  const d = Math.round((new Date(iso + "T12:00").getTime() - new Date(today + "T12:00").getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} d`;
}
