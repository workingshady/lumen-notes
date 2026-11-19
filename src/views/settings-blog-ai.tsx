import { ArrowUpRight, AudioLines, BookOpenCheck, Brain, Check, Cloud, Copy, Globe, HelpCircle, Layers, ListTree, Map as MapIcon, Rss, Search, Smartphone, Sparkles, Tags, Text, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { API_BASE, api, getToken } from "../lib/api";
import { updateNote } from "../lib/actions";
import { db, DEFAULT_SPACE, patch } from "../lib/db";
import { setSettings, useSettings } from "../lib/settings";
import { toast, useVault } from "../lib/store";
import { syncNow } from "../lib/sync";
import { Toggle } from "../components/ShareSheet";
import { cx } from "../components/ui";
import { fmtRelative, t, tk, tx } from "../lib/i18n";

/** Settings › Blog and Settings › AI. Both store their switches on the Inbox space props so they sync and the Worker can read them. */
const origin = () => API_BASE || location.origin;
const bare = (u: string) => u.replace(/^https?:\/\//, "");

export async function setInboxProps(p: Record<string, string>) {
  const inbox = await db.spaces.get(DEFAULT_SPACE);
  if (!inbox) return;
  const props = { ...inbox.props, ...p };
  if (JSON.stringify(props) !== JSON.stringify(inbox.props)) { await patch("space", DEFAULT_SPACE, { props }); void syncNow(); }
}
function useInboxProps() {
  const v = useVault();
  return v.spaceMap.get(DEFAULT_SPACE)?.props ?? {};
}

const Head = ({ title, hint }: { title: string; hint: ReactNode }) => (
  <div className="flex flex-col gap-1"><span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{title}</span><span className="text-muted">{hint}</span></div>
);
const Group = ({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) => (
  <div className="flex flex-col gap-2"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{label}</span>{right}</div>{children}</div>
);
const box = "flex items-center gap-2.5 rounded-[8px] border border-line bg-surface";
function UrlBox({ url, open }: { url: string; open?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div dir="ltr" className={cx(box, "h-10 pl-3 pr-1.5 font-mono")}>
      <span className="min-w-0 flex-1 truncate">{bare(url)}</span>
      <button onClick={async () => { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 2000); }} className={cx("flex h-7 items-center gap-1.5 rounded-[6px] border border-line px-2.5 font-sans", ok && "text-ok")}>{ok ? <Check size={13} /> : <Copy size={13} />}{ok ? t("Copied") : t("Copy")}</button>
      {open && <a href={url} target="_blank" rel="noreferrer" className="flex h-7 items-center gap-1.5 rounded-[6px] border border-line px-2.5 font-sans"><ArrowUpRight size={13} />{t("Open")}</a>}
    </div>
  );
}

// ------------------------------------------------------------------ blog
export const LICENSES: { v: string; label: string; hint: string }[] = [
  { v: "CC BY 4.0", label: "CC BY 4.0", hint: tk("Anyone may reuse with credit") },
  { v: "CC BY-SA 4.0", label: "CC BY-SA 4.0", hint: tk("Reuse with credit, share alike") },
  { v: "CC BY-NC 4.0", label: "CC BY-NC 4.0", hint: tk("Credit, non-commercial only") },
  { v: "CC0", label: "CC0", hint: tk("Public domain, no conditions") },
  { v: "All rights reserved", label: tk("All rights reserved"), hint: tk("© year + your name") },
  { v: "none", label: tk("No line"), hint: tk("Show nothing") },
];

export function BlogSection() {
  const s = useSettings();
  const v = useVault();
  const p = useInboxProps();
  const license = p.license ?? "CC BY 4.0";
  const rss = p.rss !== "0";
  const posts = useMemo(() => v.notes.filter((n) => n.published).sort((a, b) => b.updatedAt - a.updatedAt), [v.notes]);
  const blog = `${origin()}/blog`;
  const field = "h-10 w-full rounded-[8px] border border-line bg-bg px-3 focus:border-accent focus:outline-none max-md:h-11";
  const F = ({ label, children }: { label: string; children: ReactNode }) => <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{label}</span>{children}</label>;
  return (
    <div className="flex max-w-[760px] flex-col gap-[22px]">
      <Head title={t("Blog")} hint={t("Notes you publish appear on your public blog and in its RSS feed. Everything else stays private.")} />
      <Group label={t("Blog address")}><UrlBox url={blog} open /></Group>
      <Group label={t("Identity")} right={<span className="text-[12px] text-muted">{t("Same as Branding")}</span>}>
        <div className="grid gap-2.5 md:grid-cols-2">
          <F label={t("Blog name")}><input dir="auto" className={field} value={s.blogName} onChange={(e) => setSettings({ blogName: e.target.value })} /></F>
          <F label={t("Author")}><input dir="auto" className={field} value={s.author} onChange={(e) => setSettings({ author: e.target.value })} /></F>
        </div>
        <F label={t("Tagline")}><input dir="auto" className={field} value={s.tagline} onChange={(e) => setSettings({ tagline: e.target.value })} /></F>
      </Group>
      <Group label={t("License")} right={<span className="text-[12px] text-muted">{t("Shown at the end of every post")}</span>}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {LICENSES.map((l) => (
            <button key={l.v} onClick={() => void setInboxProps({ license: l.v })} className={cx("flex flex-col gap-0.5 rounded-[10px] p-3 text-start", license === l.v ? "border-[1.5px] border-accent" : "border border-line")}
              style={license === l.v ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
              <span className="font-semibold">{t(l.label)}</span><span className="text-[12px] text-muted">{t(l.hint)}</span>
            </button>
          ))}
        </div>
        <span className="text-[12.5px] text-muted">{t("Footer preview:")} <span className="text-ink" dir="ltr">Written in Lumen{license === "none" ? "" : license === "All rights reserved" ? ` · © ${new Date().getFullYear()}${s.author ? " " + s.author : ""}` : ` · ${license}`}</span></span>
      </Group>
      <Group label={t("RSS feed")}>
        <UrlBox url={`${origin()}/rss.xml`} />
        <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
          <Rss size={16} className="mt-0.5 shrink-0 text-warn" />
          <div className="flex flex-1 flex-col gap-0.5"><span className="font-medium">{t("Show “Subscribe via RSS” on the blog")}</span><span className="text-[12.5px] text-muted">{t("The feed lists your 50 newest posts with their excerpts. It stays reachable at /rss.xml either way.")}</span></div>
          <Toggle on={rss} onChange={(on) => void setInboxProps({ rss: on ? "1" : "0" })} />
        </div>
      </Group>
      <Group label={t("Published posts · {n}", { n: posts.length })}>
        {posts.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-line px-4 py-8 text-center text-muted">{t("Nothing published yet. Open a note, press Share and switch on Publish to blog.")}</div>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line max-md:rounded-[14px] max-md:border-0">
            {posts.map((n, i) => {
              const url = `${blog}/${n.slug || n.id}`;
              return (
                <div key={n.id} className={cx("flex min-h-[52px] items-center gap-3 bg-surface py-2 ps-3.5 pe-2", i > 0 && "border-t border-line")}>
                  <Globe size={15} className="shrink-0 text-ok" />
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span dir="auto" className="truncate font-medium">{n.title}</span>
                    <a href={url} target="_blank" rel="noreferrer" dir="ltr" className="truncate text-start font-mono text-[11.5px] text-link">/blog/{n.slug || n.id}</a>
                  </div>
                  <span className="text-muted max-md:hidden">{fmtRelative(n.updatedAt)}</span>
                  <button onClick={() => void updateNote(n.id, { published: 0 }).then(() => syncNow()).then(() => toast(t("Unpublished"), { label: t("Undo"), run: () => void updateNote(n.id, { published: 1 }).then(() => syncNow()) }))}
                    className="flex h-[30px] items-center rounded-[8px] border border-line px-2.5 max-md:h-9 max-md:rounded-[10px] max-md:px-3">{t("Unpublish")}</button>
                </div>
              );
            })}
          </div>
        )}
      </Group>
    </div>
  );
}

// ------------------------------------------------------------------ AI
type Act = { id: string; icon: LucideIcon; name: string; what: string };
const CLOUD: Act[] = [
  { id: "summarize", icon: Text, name: tk("Summarize"), what: tk("3–6 bullet summary of a note") },
  { id: "flashcards", icon: Layers, name: tk("Make flashcards"), what: tk("Question :: Answer cards from a note") },
  { id: "explain", icon: HelpCircle, name: tk("Explain"), what: tk("Plain-language explanation with an example") },
  { id: "tags", icon: Tags, name: tk("Suggest tags"), what: tk("3–6 tags for a note") },
  { id: "quiz", icon: BookOpenCheck, name: tk("Quiz me"), what: tk("5 questions + answers") },
  { id: "roadmap", icon: MapIcon, name: tk("Draft a roadmap"), what: tk("Modules and topics for a course space") },
  { id: "voice", icon: AudioLines, name: tk("Voice to text"), what: tk("Dictation in the editor (Whisper)") },
];
const LOCAL: { icon: LucideIcon; name: string; what: string }[] = [
  { icon: Search, name: tk("Search"), what: tk("Full-text search with Arabic normalisation") },
  { icon: ListTree, name: tk("Outline, backlinks, graph"), what: tk("Computed from your notes") },
  { icon: Brain, name: tk("Spaced repetition"), what: tk("Review scheduling (SM-2)") },
];

export function AISection() {
  const p = useInboxProps();
  const off = (p.aiOff ?? "").split(",").filter(Boolean);
  const all = off.includes("all");
  const [health, setHealth] = useState<{ ai: boolean } | null>(null);
  const tok = getToken();
  useEffect(() => { api<{ ai: boolean }>("/health").then(setHealth).catch(() => setHealth(null)); }, []);
  const set = (id: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(id); else next.add(id);
    void setInboxProps({ aiOff: [...next].join(",") });
  };
  const server = health?.ai;
  return (
    <div className="flex max-w-[760px] flex-col gap-[22px]">
      <Head title={t("AI")} hint={t("Optional helpers. They run on Workers AI inside your own Cloudflare account; nothing goes to any other company.")} />
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-learn" style={{ background: "color-mix(in srgb, var(--learn) 14%, transparent)" }}><Sparkles size={16} /></span>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-semibold">{t("AI features")}</span>
          <span className="text-[12.5px] text-muted">
            {!tok ? t("Needs sync on (Settings › Sync): AI runs on your Cloudflare, not on this device.")
              : health === null ? t("Checking your server…")
              : server ? (all ? t("Off. AI buttons explain that they're turned off here.") : t("On · Workers AI is bound to your Worker."))
              : tx("Your Worker has no AI binding. Add {code} to wrangler.jsonc and deploy.", { code: <code dir="ltr">{"\"ai\": { \"binding\": \"AI\" }"}</code> })}
          </span>
        </div>
        <Toggle on={!all} onChange={(on) => set("all", on)} />
      </div>

      <Group label={t("What runs where")}>
        <div className="overflow-hidden rounded-[12px] border border-line">
          <div className="flex h-9 items-center gap-2 bg-surface px-3.5 text-[12px] font-semibold text-muted"><Cloud size={13} className="text-info" />{t("Your Cloudflare · Llama 3.3 70B · Whisper")}</div>
          {CLOUD.map((a) => (
            <div key={a.id} className={cx("flex min-h-[52px] items-center gap-3 border-t border-line py-2 ps-3.5 pe-3", all && "opacity-45")}>
              <a.icon size={16} className="shrink-0 text-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-px"><span className="font-medium">{t(a.name)}</span><span className="text-[12px] text-muted">{t(a.what)}</span></div>
              <Toggle on={!all && !off.includes(a.id)} disabled={all} onChange={(on) => set(a.id, on)} />
            </div>
          ))}
          <div className="flex h-9 items-center gap-2 border-t border-line bg-surface px-3.5 text-[12px] font-semibold text-muted"><Smartphone size={13} className="text-ok" />{t("This device · always on, works offline")}</div>
          {LOCAL.map((a) => (
            <div key={a.name} className="flex min-h-[48px] items-center gap-3 border-t border-line py-2 ps-3.5 pe-3">
              <a.icon size={16} className="shrink-0 text-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-px"><span className="font-medium">{t(a.name)}</span><span className="text-[12px] text-muted">{t(a.what)}</span></div>
              <span className="text-[12px] text-muted">{t("No AI")}</span>
            </div>
          ))}
        </div>
      </Group>

      <Group label={t("Daily free limit")}>
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-3.5 py-3 leading-5">
          <span>{tx("Workers AI includes {free} free. That's roughly 50–100 summaries or a few minutes of voice each day, depending on note length.", { free: <b className="font-semibold">{t("{n} neurons a day", { n: 10000 })}</b> })}</span>
          <span className="text-[12.5px] text-muted">{t("The allowance resets at 00:00 UTC. When it runs out, AI buttons say “Daily free AI limit reached. Try tomorrow.” and nothing is charged: without the paid Workers plan, requests simply stop until the reset.")}</span>
          <a href="https://developers.cloudflare.com/workers-ai/platform/pricing/" target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start text-[12.5px] text-link">{t("Workers AI pricing")}<ArrowUpRight size={12} /></a>
        </div>
      </Group>
    </div>
  );
}
