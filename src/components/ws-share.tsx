import { SpaceIcon } from "./SpaceIcon";
import { Capacitor } from "@capacitor/core";
import { Inbox, PenLine, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createNote } from "../lib/actions";
import { unfurl, type Unfurl } from "../lib/api";
import { addFile } from "../lib/attachments";
import { useVault, toast } from "../lib/store";
import { LumenMark } from "./LumenMark";
import { cx } from "./ui";
import { t } from "../lib/i18n";

/*
 * Share to Lumen (design: Lumen 12 · R3-5E "Save to Lumen sheet").
 * Sources: the PWA Web Share Target (manifest share_target → "/?share_title=…&share_text=…&share_url=…")
 * and the Android share intent (send-intent plugin; SendIntentActivity opens translucently over the source app).
 * Inbox is the default; the last-used space is remembered as the second chip. Saving works offline (queued by sync).
 */
export interface Shared { title: string; text: string; url: string; fileUrl?: string; mime?: string; native?: boolean }
let shared: Shared | null = null;
const subs = new Set<() => void>();
const set = (s: Shared | null) => { shared = s; subs.forEach((f) => f()); };
export const useShared = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => shared);
export const openShare = (s: Shared) => set(s);

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const LAST = "lumen.shareLastSpace";

/** Read share params from the URL (PWA share target) once on load, then clean the URL. */
export function readWebShare() {
  const q = new URLSearchParams(location.search);
  if (!q.has("share_title") && !q.has("share_text") && !q.has("share_url")) return;
  const text = q.get("share_text") ?? "";
  const url = q.get("share_url") || URL_RE.exec(text)?.[0] || "";
  set({ title: q.get("share_title") ?? "", text: text.replace(url, "").trim(), url });
  ["share_title", "share_text", "share_url"].forEach((k) => q.delete(k));
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
}

/** Android: ask the send-intent plugin whether this activity was opened from the system share sheet. */
export async function readNativeShare(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { SendIntent } = await import("send-intent");
    const r = await SendIntent.checkSendIntentReceived();
    if (!r || (!r.url && !r.title)) return false;
    const raw = decodeURIComponent(r.url ?? "");
    const isText = !r.type || r.type.startsWith("text/");
    const url = isText ? URL_RE.exec(raw)?.[0] ?? "" : "";
    set({ title: r.title ?? "", text: isText ? raw.replace(url, "").trim() : "", url, fileUrl: isText ? undefined : raw, mime: r.type, native: true });
    return true;
  } catch { return false; }
}
async function finishNative() {
  try { const { SendIntent } = await import("send-intent"); SendIntent.finish(); } catch { /* not native */ }
}

export function ShareSheet() {
  const s = useShared();
  const v = useVault();
  const [title, setTitle] = useState("");
  const [thought, setThought] = useState("");
  const [space, setSpace] = useState("inbox");
  const [more, setMore] = useState(false);
  const [meta, setMeta] = useState<Unfurl | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!s) return;
    setTitle(s.title || s.text.split("\n")[0].slice(0, 120) || (s.url ? new URL(s.url).hostname.replace(/^www\./, "") : "Shared"));
    setThought(""); setSpace("inbox"); setMore(false); setMeta(undefined);
    if (s.url) void unfurl(s.url).then((m) => { setMeta(m); if (m?.title && !s.title) setTitle(m.title); });
  }, [s]);

  if (!s) return null;
  const last = (() => { try { return localStorage.getItem(LAST); } catch { return null; } })();
  const live = v.spaces.filter((x) => !x.archived);
  const chips = [live.find((x) => x.id === "inbox"), live.find((x) => x.id === last && x.id !== "inbox"), ...live.filter((x) => x.id !== "inbox" && x.id !== last)].filter(Boolean).slice(0, 3) as typeof live;
  if (space !== "inbox" && !chips.some((c) => c.id === space)) { const sp = live.find((x) => x.id === space); if (sp) chips.push(sp); }
  let host = "";
  try { host = s.url ? new URL(s.url).hostname.replace(/^www\./, "") : ""; } catch { /* ignore */ }

  const close = () => { set(null); if (s.native) void finishNative(); };
  async function saveIt() {
    if (busy || !s) return;
    setBusy(true);
    try {
      const parts: string[] = [];
      if (s.url) parts.push(s.url);
      if (s.text) parts.push(s.text);
      if (s.fileUrl) {
        try {
          const blob = await (await fetch(Capacitor.convertFileSrc(s.fileUrl))).blob();
          parts.push(await addFile(new File([blob], s.title || s.fileUrl.split("/").pop() || "file", { type: s.mime || blob.type })));
        } catch (e) { toast((e as Error).message); }
      }
      if (thought.trim()) parts.push(thought.trim());
      const nt = title.trim() || "Shared";
      await createNote({ spaceId: space, title: nt, body: `# ${nt}\n\n${parts.join("\n\n")}\n`, tags: [] });
      try { localStorage.setItem(LAST, space); } catch { /* ignore */ }
      const name = v.spaceMap.get(space)?.name ?? t("Inbox");
      set(null);
      toast(t("Saved to {name}", { name }), undefined, { icon: "check" });
      if (s.native) setTimeout(() => void finishNative(), 700);
    } finally { setBusy(false); }
  }

  const chip = (on: boolean) => cx("flex h-10 items-center gap-2 rounded-full px-3.5 text-[14px]", on ? "font-semibold" : "border border-line");
  const onStyle = { background: "color-mix(in srgb,var(--accent) 16%,transparent)", boxShadow: "inset 0 0 0 1.5px var(--accent)" };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center fade-in md:items-center" style={{ background: "rgba(0,0,0,.45)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet-in flex w-full flex-col gap-3.5 rounded-t-[14px] bg-surface px-4 pt-2.5 text-[14px] md:max-w-[440px] md:rounded-[14px] md:border md:border-line md:pb-4" role="dialog" aria-label={t("Save to Lumen")}>
        <div className="flex justify-center md:hidden"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex items-center gap-2.5 px-1">
          <LumenMark size={28} />
          <span className="flex-1 text-[18px] font-[650]">{t("Save to Lumen")}</span>
          <button aria-label={t("Close")} onClick={close} className="text-muted hover:text-ink"><X size={20} /></button>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="px-1 text-[12.5px] font-medium text-muted">{t("Title")}</span>
          <input ref={titleRef} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} className="h-[52px] rounded-[10px] border border-line bg-bg px-3.5 text-ink outline-none focus:border-accent" />
        </label>
        {s.url ? (
          meta === undefined ? (
            <div className="flex h-[72px] overflow-hidden rounded-[12px] border border-line bg-bg"><div className="flex flex-1 flex-col justify-center gap-2 px-3"><span className="h-2 w-4/5 rounded bg-surface-2" /><span className="h-2 w-2/5 rounded bg-surface-2" /></div><div className="w-[72px] bg-surface-2" /></div>
          ) : (
            <div className="flex h-[72px] overflow-hidden rounded-[12px] border border-line bg-bg">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5">
                <span dir="auto" className="truncate text-[13px] text-muted">{meta?.description || meta?.title || s.url}</span>
                <span dir="ltr" className="text-start text-[12px] text-link">{host}</span>
              </div>
              {meta?.image ? <img src={meta.image} alt="" className="w-[72px] object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} /> : <div className="w-[72px]" style={{ background: "repeating-linear-gradient(135deg,var(--surface-2) 0 8px,var(--surface) 8px 16px)" }} />}
            </div>
          )
        ) : s.text || s.fileUrl ? (
          <div dir="auto" className="line-clamp-3 rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[13px] text-muted">{s.text || s.fileUrl?.split("/").pop()}</div>
        ) : null}
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[12.5px] font-medium text-muted">{t("Save into")}</span>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button key={c.id} onClick={() => setSpace(c.id)} className={chip(space === c.id)} style={space === c.id ? onStyle : undefined}>
                {c.id === "inbox" ? <Inbox size={15} /> : <SpaceIcon space={c} size={15} />}<span dir="auto">{c.name}</span>
              </button>
            ))}
            <button onClick={() => setMore((m) => !m)} className="flex h-10 items-center rounded-full border border-line px-3 text-muted">{t("More…")}</button>
          </div>
          {more && (
            <div className="flex max-h-48 flex-col overflow-y-auto rounded-[10px] border border-line bg-bg p-1">
              {live.map((c) => <button key={c.id} onClick={() => { setSpace(c.id); setMore(false); }} className={cx("flex h-9 items-center gap-2 rounded-[6px] px-2 text-start", space === c.id ? "bg-surface-2 font-semibold" : "hover:bg-surface-2")}><SpaceIcon space={c} size={15} /><span dir="auto">{c.name}</span></button>)}
            </div>
          )}
        </div>
        <label className="flex h-12 items-center gap-2 rounded-[10px] border border-dashed border-line px-3.5 text-muted focus-within:border-accent">
          <PenLine size={15} className="shrink-0" />
          <input dir="auto" value={thought} onChange={(e) => setThought(e.target.value)} placeholder={t("Add a thought (optional)")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
        </label>
        <button disabled={busy} onClick={saveIt} className="h-14 rounded-[14px] bg-accent text-[16px] font-semibold text-accent-fg disabled:opacity-60">{t("Save")}</button>
        <div className="safe-b h-2 md:hidden" />
      </div>
    </div>
  );
}
