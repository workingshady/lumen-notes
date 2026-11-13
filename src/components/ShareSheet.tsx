import { Check, Copy, ExternalLink, Globe, Link2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Note, Space } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { API_BASE, getToken } from "../lib/api";
import { patch } from "../lib/db";
import { slugify } from "../lib/parse";
import { toast } from "../lib/store";
import { syncNow } from "../lib/sync";
import { Button, cx, Field, inputCls, Sheet } from "./ui";

export type ShareTarget = { kind: "note"; note: Note } | { kind: "space"; space: Space };

const origin = () => API_BASE || location.origin;
const token = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const shareUrl = (t: string) => `${origin()}/s/${t}`;

async function shareOrCopy(url: string, title: string) {
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
  } catch (e) { if ((e as Error).name === "AbortError") return; }
  await navigator.clipboard.writeText(url);
  toast("Link copied");
}

function LinkRow({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={url} className={inputCls + " h-9 font-mono text-[12px]"} onFocus={(e) => e.target.select()} />
      <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</Button>
      <Button size="sm" onClick={() => shareOrCopy(url, title)} title="Share…"><Share2 size={14} /></Button>
      <Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank")} title="Open"><ExternalLink size={14} /></Button>
    </div>
  );
}

export function ShareSheet({ target, open, onClose }: { target: ShareTarget; open: boolean; onClose: () => void }) {
  const isNote = target.kind === "note";
  const title = isNote ? target.note.title : target.space.name;
  const shareId = isNote ? target.note.shareId : target.space.shareId;
  const synced = !!getToken();

  const setShare = async (on: boolean) => {
    const v = on ? token() : null;
    if (isNote) await updateNote(target.note.id, { shareId: v });
    else await patch("space", target.space.id, { shareId: v });
    await syncNow();
    toast(on ? "Link is live" : "Link turned off. Anyone who had it can no longer open it.");
  };

  const what = isNote
    ? { note: "note", lesson: "lesson", journal: "journal entry", flashcards: "flashcard deck", slides: "slide deck (viewers can present it)", post: "post", canvas: "canvas (read-only board)", whiteboard: "whiteboard (view only)", roadmap: "roadmap", moc: "map of content" }[target.note.type]
    : target.space.kind === "course" ? "course: roadmap, progress, every note and a graph" : "space: overview, every note and a graph";

  return (
    <Sheet open={open} onClose={onClose} title={`Share “${title}”`}>
      <div className="space-y-5">
        {!synced && <div className="rounded-[10px] bg-warn/15 p-3 text-[13px] text-warn">Sharing needs sync on (Settings → Sync), because the link is served from your Cloudflare.</div>}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-muted" />
            <div className="flex-1"><div className="font-semibold">Share link</div><div className="text-[12.5px] text-muted">Anyone with the link can view this {what}. It isn't listed anywhere.</div></div>
            <Toggle on={!!shareId} disabled={!synced} onChange={setShare} />
          </div>
          {shareId && <LinkRow url={shareUrl(shareId)} title={title} />}
          {shareId && <button className="text-[12px] text-link" onClick={() => setShare(true)}>Make a new link (old one stops working)</button>}
          {!isNote && <p className="text-[12px] text-muted">Everything in this space is visible through the link, including new notes you add later. Move private notes to another space first.</p>}
        </section>

        {isNote && target.note.type !== "canvas" && target.note.type !== "whiteboard" && <BlogSection note={target.note} synced={synced} />}
      </div>
    </Sheet>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40", on ? "bg-accent" : "bg-surface-2 border border-line")}>
      <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function BlogSection({ note, synced }: { note: Note; synced: boolean }) {
  const [slug, setSlug] = useState(note.slug || slugify(note.title));
  const [excerpt, setExcerpt] = useState(note.props.excerpt ?? "");
  useEffect(() => { setSlug(note.slug || slugify(note.title)); setExcerpt(note.props.excerpt ?? ""); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = `${origin()}/blog/${slug}`;
  return (
    <section className="space-y-2 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-muted" />
        <div className="flex-1"><div className="font-semibold">Publish to blog</div><div className="text-[12.5px] text-muted">Listed on /blog and in RSS, with a readable URL.</div></div>
        <Toggle on={!!note.published} disabled={!synced} onChange={async (on) => { await updateNote(note.id, { published: on ? 1 : 0, slug, props: { ...note.props, excerpt } }); await syncNow(); toast(on ? "Published" : "Unpublished"); }} />
      </div>
      <Field label="URL slug"><input className={inputCls + " h-9"} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} onBlur={() => note.published && updateNote(note.id, { slug })} /></Field>
      <Field label="Excerpt (optional)"><input className={inputCls + " h-9"} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} onBlur={() => updateNote(note.id, { props: { ...note.props, excerpt } })} /></Field>
      {note.published ? <LinkRow url={url} title={note.title} /> : null}
    </section>
  );
}
