import { localOgCard, publishOgImage } from "../lib/og";
import { ArrowUpRight, Check, CircleCheck, CloudOff, Copy, Globe, Info, Link2, Share2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { API_BASE, getToken } from "../lib/api";
import { DEMO, patch } from "../lib/db";
import { slugify } from "../lib/parse";
import { getSettings } from "../lib/settings";
import { setUI, toast } from "../lib/store";
import { syncNow } from "../lib/sync";
import { cx } from "./ui";
// Applies Settings › Appearance › Advanced (UI size, reduced motion, custom CSS) at startup; this module loads eagerly.
import "../views/settings-advanced";

export type ShareTarget = { kind: "note"; note: Note } | { kind: "space"; space: Space };

const origin = () => API_BASE || location.origin;
const token = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const shareUrl = (t: string) => `${origin()}/s/${t}`;
export const blogUrl = (slug: string) => `${origin()}/blog/${slug}`;
/** Host + path without the scheme, for compact display. */
export const bareUrl = (u: string) => u.replace(/^https?:\/\//, "");
/** Settings reads this once on mount to open a given section (e.g. "All links: Settings › Sharing"). */
export const SETTINGS_SECTION_KEY = "lumen.settingsSection";
export function openSettings(section: string) {
  try { sessionStorage.setItem(SETTINGS_SECTION_KEY, section); } catch { /* ignore */ }
  setUI({ view: "settings" });
}

async function shareOrCopy(url: string, title: string) {
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
  } catch (e) { if ((e as Error).name === "AbortError") return; }
  await navigator.clipboard.writeText(url);
  toast("Link copied");
}

/** Turn a note/space link on or off; shared with Settings › Sharing so toasts stay consistent. */
export async function setShareId(target: ShareTarget, v: string | null) {
  if (target.kind === "note") await updateNote(target.note.id, { shareId: v });
  else await patch("space", target.space.id, { shareId: v });
  await syncNow();
}
export async function turnOffLink(target: ShareTarget) {
  const old = target.kind === "note" ? target.note.shareId : target.space.shareId;
  await setShareId(target, null);
  toast("Link turned off. Anyone who had it can no longer open it.", old ? { label: "Undo", run: () => void setShareId(target, old) } : undefined);
}

const Badge = ({ c, icon, children }: { c: string; icon: ReactNode; children: ReactNode }) => (
  <span className="inline-flex items-center gap-[5px] rounded-full px-2 text-[11.5px] font-semibold leading-5" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{icon}{children}</span>
);

export function ShareSheet({ target, open, onClose }: { target: ShareTarget; open: boolean; onClose: () => void }) {
  const isNote = target.kind === "note";
  const title = isNote ? target.note.title : target.space.name;
  const shareId = isNote ? target.note.shareId : target.space.shareId;
  const published = isNote && !!target.note.published;
  // Demo mode serves /s/… and /blog from the local demo database (views/settings-public-demo), so links work unsynced.
  const synced = !!getToken() || DEMO;
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [shareId]);
  // OG image (Lumen 21): render the 1200×630 card from local data and upload its PNG for link previews.
  useEffect(() => {
    if (!open || !getToken()) return;
    const t = setTimeout(() => void localOgCard(target).then((card) => Promise.all([
      shareId ? publishOgImage("s", shareId, card) : null,
      isNote && target.note.published ? publishOgImage("post", target.note.slug || target.note.id, card) : null,
    ])), 400);
    return () => clearTimeout(t);
  }, [open, synced, shareId, published, title]); // eslint-disable-line react-hooks/exhaustive-deps

  const setShare = async (on: boolean) => {
    if (!on) return turnOffLink(target);
    const v = token();
    await setShareId(target, v);
    toast("Link is live", { label: "Copy", run: () => void navigator.clipboard.writeText(shareUrl(v)).then(() => toast("Link copied")) });
  };
  const url = shareId ? shareUrl(shareId) : "";
  const copy = async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const canPublish = isNote && !["canvas", "whiteboard"].includes(target.note.type);
  const off = !synced;

  const btn = "flex h-[46px] md:h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-line px-3 max-md:flex-1";
  return (
    <Overlay open={open} onClose={onClose}>
      <div className="flex flex-col text-[14px] leading-[normal] text-ink md:text-[13px]">
        <div className="flex justify-center pt-2.5 md:hidden"><span className="h-1 w-9 rounded-sm bg-line" /></div>
        <div className="flex items-center gap-2.5 px-5 pb-1 pt-5 md:px-[22px] md:pt-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span dir="auto" className="truncate text-[18px] font-[650] md:text-[17px]">{isNote ? `Share “${title}”` : `Share space “${title}”`}</span>
            <span className="flex items-center gap-2 text-[12.5px] text-muted">Visibility
              {published ? <Badge c="var(--success)" icon={<Globe size={11} />}>Published</Badge>
                : shareId ? <Badge c="var(--info)" icon={<Link2 size={11} />}>Shared</Badge>
                : <span>Private</span>}
            </span>
          </div>
          <button aria-label="Close" onClick={onClose} className="hidden text-muted hover:text-ink md:block"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3 px-5 pt-3 md:px-[22px]">
          {off && (
            <div className="flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 leading-[19px]" style={{ background: "color-mix(in srgb, var(--warning) 10%, transparent)", borderColor: "color-mix(in srgb, var(--warning) 32%, transparent)" }}>
              <CloudOff size={16} className="mt-0.5 shrink-0 text-warn" />
              <div className="flex flex-1 flex-col gap-2">
                <span><b className="font-semibold">Sharing needs sync on.</b> Links are served from your Cloudflare, so this device has to sync first.</span>
                <button onClick={() => { onClose(); openSettings("sync"); }} className="flex h-8 items-center self-start rounded-[10px] bg-accent px-3 text-[13px] font-semibold text-accent-fg">Turn on sync</button>
              </div>
            </div>
          )}

          <div className={cx("rounded-[12px] border border-line bg-surface", off && "opacity-45")}>
            <Row icon={<Link2 size={16} />} c="var(--info)" title="Share link" hint="Anyone with the link can view. Read-only, not listed anywhere."
              on={!!shareId && !off} disabled={off} onChange={setShare} />
            {shareId && !off && (
              <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">
                <div className="flex flex-wrap gap-2 md:flex-nowrap">
                  <div className="flex h-[46px] min-w-[220px] flex-1 items-center overflow-hidden whitespace-nowrap rounded-md border border-line bg-bg px-2.5 font-mono text-[12.5px] md:h-[38px]" onClick={copy}>
                    <span className="text-muted">{bareUrl(origin())}/s/</span>{shareId}
                  </div>
                  <button onClick={copy} className={cx(btn, "font-semibold")} style={copied ? { color: "var(--success)", borderColor: "color-mix(in srgb, var(--success) 45%, transparent)" } : undefined}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}
                  </button>
                  <button onClick={() => shareOrCopy(url, title)} className={cx(btn, "md:hidden")}><Share2 size={14} />Share…</button>
                  <button onClick={() => window.open(url, "_blank")} className={btn}><ArrowUpRight size={14} />Open</button>
                </div>
                <span className="text-[12.5px] text-muted"><button className="text-link underline underline-offset-[3px]" onClick={() => setShare(true)}>Make a new link</button> (old one stops working)</span>
              </div>
            )}
          </div>

          {!isNote && (
            <div className={cx("flex gap-2.5 rounded-[10px] bg-surface px-3.5 py-3 text-[13px] leading-[19px]", off && "opacity-45")}>
              <Info size={15} className="mt-0.5 shrink-0 text-info" />
              <span>Everything in this space is visible through the link, <b className="font-semibold">including notes you add later.</b> Only safe properties (goal, dates, course URL) are shown.</span>
            </div>
          )}

          {canPublish && <BlogSection note={target.note} off={off} />}
        </div>

        <div className="flex items-center gap-2.5 p-5 md:p-[22px]">
          <span className="flex-1 text-[12.5px] text-muted">All links: <button className="text-link" onClick={() => { onClose(); openSettings("sharing"); }}>Settings › Sharing</button></span>
          <button onClick={onClose} className="flex h-[50px] items-center rounded-[10px] border border-line bg-surface-2 px-[18px] font-semibold md:h-[38px]">Done</button>
        </div>
      </div>
    </Overlay>
  );
}

/** Design (Lumen 09): desktop = panel under the header Share button (top 52, right 70, 560 wide); phone = bottom sheet. */
function Overlay({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-50" style={{ background: "rgba(5,6,8,.6)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="sheet-in safe-b absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-[14px] bg-surface-2 md:inset-x-auto md:bottom-auto md:right-[70px] md:top-[52px] md:w-[562px] md:max-w-[calc(100vw-32px)] md:rounded-[14px] md:border md:border-line md:shadow-[0_24px_64px_rgba(0,0,0,.5)]">
        {children}
      </div>
    </div>
  );
}

function Row({ icon, c, title, hint, on, disabled, onChange }: { icon: ReactNode; c: string; title: string; hint: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 p-3.5">
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px]" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{icon}</span>
      <div className="flex flex-1 flex-col gap-0.5"><span className="font-semibold">{title}</span><span className="text-[12.5px] leading-[18px] text-muted">{hint}</span></div>
      <Toggle on={on} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={cx("relative mt-1 h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed md:h-[22px] md:w-[38px]", on ? "bg-accent" : "bg-line")}>
      <span className={cx("absolute top-[3px] size-5 rounded-full transition-all md:size-4", on ? "left-[23px] bg-accent-fg md:left-[19px]" : "left-[3px] bg-muted")} />
    </button>
  );
}

function BlogSection({ note, off }: { note: Note; off: boolean }) {
  const [slug, setSlug] = useState(note.slug || slugify(note.title));
  const [excerpt, setExcerpt] = useState(note.props.excerpt ?? "");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setSlug(note.slug || slugify(note.title)); setExcerpt(note.props.excerpt ?? ""); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = blogUrl(slug);
  const on = !!note.published && !off;
  const field = "rounded-md border border-line bg-bg px-2.5 focus:border-accent focus:outline-none";
  return (
    <div className={cx("rounded-[12px] border border-line bg-surface", off && "opacity-45")}>
      <Row icon={<Globe size={16} />} c="var(--success)" title="Publish to blog" hint="On /blog and in RSS, with a readable URL. Markdown notes only." on={on} disabled={off}
        onChange={async (v) => {
          await updateNote(note.id, { published: v ? 1 : 0, slug, props: { ...note.props, excerpt } });
          await syncNow();
          if (v) toast(`Published to ${getSettings().blogName || "your blog"}`, { label: "View", run: () => window.open(url, "_blank") });
          else toast("Unpublished");
        }} />
      {on && (
        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">
          <label className="flex flex-col gap-[5px]"><span className="text-[12px] font-medium text-muted">Slug</span>
            <div className={cx(field, "flex h-[46px] items-center font-mono text-[12.5px] focus-within:border-accent md:h-[38px]")}>
              <span className="text-muted">/blog/</span>
              <input className="min-w-0 flex-1 bg-transparent outline-none" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} onBlur={() => updateNote(note.id, { slug })} />
            </div>
          </label>
          <label className="flex flex-col gap-[5px]"><span className="text-[12px] font-medium text-muted">Excerpt</span>
            <textarea dir="auto" rows={2} className={cx(field, "resize-none py-2 text-[13px] leading-[19px]")} value={excerpt} placeholder="One or two sentences for the blog index and RSS." onChange={(e) => setExcerpt(e.target.value)} onBlur={() => updateNote(note.id, { props: { ...note.props, excerpt } })} />
          </label>
          <div className="flex items-center gap-2 text-[12.5px]">
            <CircleCheck size={14} className="shrink-0 text-ok" />
            <a href={url} target="_blank" rel="noreferrer" className="truncate font-mono text-link">{bareUrl(url)}</a>
            <span className="flex-1" />
            <button aria-label="Copy blog link" className={copied ? "text-ok" : "text-muted hover:text-ink"} onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          </div>
        </div>
      )}
    </div>
  );
}
