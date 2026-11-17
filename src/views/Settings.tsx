import { useLiveQuery } from "dexie-react-hooks";
import { setUiDir, useUiDir, type UiDir } from "../components/ws-dir";
import { AppLockSetting } from "./Welcome";
import {
  ArrowLeft, Check, ChevronRight, CircleCheck, Clock, Code, Copy, Database, Eye, File, FileAudio, FileText, FileVideo, Globe, GraduationCap, HardDrive, Image, Info,
  Layers, LayoutDashboard, Link2, Link2Off, Loader2, LogOut, Palette, PenTool, Pencil, Presentation, RefreshCw, Rss, Share, Sparkles, Trash2, type LucideIcon,
  Waypoints, BookOpenText,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import { API_BASE, api, getAccount, getToken, setToken } from "../lib/api";
import { updateNote } from "../lib/actions";
import { db, DEFAULT_SPACE, patch } from "../lib/db";
import { exportBackup } from "../lib/io";
import { render } from "../lib/markdown";
import { activeTheme, setSettings, THEMES, useSettings, type Settings as S, type Theme } from "../lib/settings";
import { setUI, toast, useVault } from "../lib/store";
import { syncNow, useSync } from "../lib/sync";
import { bareUrl, blogUrl, SETTINGS_SECTION_KEY, shareUrl, Toggle, turnOffLink } from "../components/ShareSheet";
import { LumenMark, Wordmark } from "../components/LumenMark";
import { Button, cx, inputCls, relTime } from "../components/ui";
import { setAdvanced, useAdvanced, type Advanced } from "./settings-advanced";
import { DeveloperSection } from "./settings-developer";
import { AISection, BlogSection } from "./settings-blog-ai";
import { DiagramsSection } from "./settings-diagrams";
import { AccountSwitcher } from "../components/AccountSwitcher";
import { ReadingSection } from "./settings-reading";

type SecId = "appearance" | "branding" | "reading" | "diagrams" | "sync" | "sharing" | "blog" | "storage" | "ai" | "developer" | "about";
// Round-3 settings nav (Lumen 09 / 11): Appearance · Branding · Sync · Sharing · Blog · Storage · AI · Developer · About.
const SECTIONS: { id: SecId; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "branding", label: "Branding", icon: PenTool },
  { id: "reading", label: "Reading", icon: BookOpenText },
  { id: "diagrams", label: "Diagrams", icon: Waypoints },
  { id: "sync", label: "Sync", icon: RefreshCw },
  { id: "sharing", label: "Sharing", icon: Share },
  { id: "blog", label: "Blog", icon: Rss },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "developer", label: "Developer", icon: Code },
  { id: "about", label: "About", icon: Info },
];
/** Binary units, shown as MB/GB (as the design: 92 MB, 9.8 MB, 1.38 GB). */
const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const mb = (b: number) => (b >= GB ? `${(b / GB).toFixed(b >= 10 * GB ? 0 : 2)} GB` : b >= MB ? `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1)} MB` : `${Math.max(0, Math.round(b / KB))} KB`);

/** Branding also lives on the Inbox space so it syncs and the public blog can read it. */
async function saveBranding(s: S) {
  const inbox = await db.spaces.get(DEFAULT_SPACE);
  if (!inbox) return;
  const props = { ...inbox.props, blogName: s.blogName, tagline: s.tagline, author: s.author, avatar: s.avatar };
  if (JSON.stringify(props) !== JSON.stringify(inbox.props)) await patch("space", DEFAULT_SPACE, { props });
}

const Head = ({ title, hint, right }: { title: string; hint?: ReactNode; right?: ReactNode }) => (
  <div className="flex items-end gap-4">
    <div className="flex flex-1 flex-col gap-1"><span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{title}</span>{hint && <span className="text-muted">{hint}</span>}</div>
    {right}
  </div>
);
const Group = ({ label, right, children, className }: { label: string; right?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={cx("flex flex-col gap-2.5", className)}><div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{label}</span>{right}</div>{children}</div>
);
function Seg<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("grid gap-0.5 rounded-[8px] border border-line bg-surface p-[3px] max-md:rounded-[10px]", className)} style={{ gridTemplateColumns: `repeat(${options.length},1fr)` }}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx("flex h-[26px] items-center justify-center rounded-[6px] max-md:h-10 max-md:rounded-[8px]", value === o.value ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>{o.label}</button>
      ))}
    </div>
  );
}
/** Custom-drawn slider: a native range input sits invisibly on top for input + a11y. */
function Slider({ value, min, max, onChange, track, knob, height }: { value: number; min: number; max: number; onChange: (v: number) => void; track: ReactNode; knob: string; height: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative" style={{ height }}>
      {track}
      <span className={cx("pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", knob)} style={{ left: `${pct}%` }} />
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-x-0 -top-2 h-[calc(100%+16px)] w-full cursor-pointer opacity-0" />
    </div>
  );
}

function readStoredSection(): SecId | null {
  try {
    const v = sessionStorage.getItem(SETTINGS_SECTION_KEY);
    sessionStorage.removeItem(SETTINGS_SECTION_KEY);
    const id = v === "editor" ? "appearance" : v === "data" ? "storage" : v;
    return SECTIONS.some((s) => s.id === id) ? (id as SecId) : null;
  } catch { return null; }
}

export function SettingsView() {
  const s = useSettings();
  const vault = useVault();
  const st = useSync();
  const [initial] = useState(readStoredSection);
  const [sec, setSec] = useState<SecId>(initial ?? "appearance");
  const [phoneRoot, setPhoneRoot] = useState(!initial);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => { navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => void saveBranding(s), 800);
    return () => clearTimeout(t);
  }, [s.blogName, s.tagline, s.author, s.avatar]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pull branding synced from another device the first time.
  useEffect(() => {
    const p = vault.spaceMap.get(DEFAULT_SPACE)?.props;
    if (p?.blogName && !localStorage.getItem("lumen.brandingPulled")) {
      setSettings({ blogName: p.blogName, tagline: p.tagline ?? s.tagline, author: p.author ?? s.author, avatar: p.avatar ?? s.avatar });
      try { localStorage.setItem("lumen.brandingPulled", "1"); } catch { /* ignore */ }
    }
  }, [vault.spaceMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = vault.notes.filter((n) => n.shareId).length + vault.spaces.filter((x) => x.shareId).length;
  const posts = vault.notes.filter((n) => n.published).length;
  const tok = getToken();
  const values: Partial<Record<SecId, string>> = {
    appearance: s.theme === "auto" ? "Auto" : activeTheme().name, sync: tok ? "On" : "Off", sharing: links ? `${links} link${links === 1 ? "" : "s"}` : "",
    blog: `${posts} post${posts === 1 ? "" : "s"}`, storage: usage ? mb(usage.usage) : "", about: "v1.0",
  };
  const go = (id: SecId) => { setSec(id); setPhoneRoot(false); };
  const cur = SECTIONS.find((x) => x.id === sec)!;

  return (
    <div className="flex h-full text-[14px] leading-[normal] text-ink md:text-[13px]">
      {/* desktop nav */}
      <nav className="hidden w-[240px] shrink-0 flex-col gap-0.5 border-r border-line px-2.5 py-5 md:flex">
        <span className="px-2.5 pb-3 text-[18px] font-[650]">Settings</span>
        {SECTIONS.map((n) => (
          <button key={n.id} onClick={() => setSec(n.id)} className={cx("flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-left", sec === n.id ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>
            <n.icon size={15} className={sec === n.id ? "text-accent" : "text-muted"} />{n.label}
          </button>
        ))}
      </nav>

      {/* phone root list */}
      <div className={cx("safe-t flex-1 overflow-y-auto pb-6 md:hidden", !phoneRoot && "hidden")}>
        <div className="px-5 pb-3 pt-4 text-[26px] font-[650] tracking-[-.02em]">Settings</div>
        <button onClick={() => go("branding")} className="mx-4 flex w-[calc(100%-32px)] items-center gap-3 rounded-[14px] bg-surface p-3.5 text-left">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-[22px]">{s.avatar}</span>
          <div className="flex flex-1 flex-col gap-0.5"><span className="font-semibold">{s.blogName}</span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><span className={cx("size-1.5 rounded-full", tok ? "bg-ok" : "bg-muted")} />{tok ? (st.last ? `Synced ${relTime(st.last)}` : "Sync on") : "Sync off · this device only"}</span>
          </div>
          <ChevronRight size={16} className="text-muted" />
        </button>
        <div className="flex flex-col gap-3 px-4 pt-4">
          {[SECTIONS.filter((x) => ["appearance", "sync", "sharing", "blog"].includes(x.id)), SECTIONS.filter((x) => ["storage", "ai", "developer", "about"].includes(x.id))].map((grp, g) => (
            <div key={g} className="overflow-hidden rounded-[14px] bg-surface">
              {grp.map((n, i) => (
                <button key={n.id} onClick={() => go(n.id)} className={cx("flex h-[52px] w-full items-center gap-3.5 px-3.5 text-left", i > 0 && "border-t border-line")}>
                  <n.icon size={19} className="text-muted" /><span className="flex-1">{n.label}</span><span className="text-[13px] text-muted">{values[n.id]}</span><ChevronRight size={15} className="text-muted" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* section */}
      <div className={cx("min-w-0 flex-1 overflow-y-auto", phoneRoot && "max-md:hidden")}>
        <div className="safe-t flex h-14 items-center gap-1 px-1 md:hidden">
          <button aria-label="Back" onClick={() => setPhoneRoot(true)} className="flex size-12 items-center justify-center"><ArrowLeft size={20} /></button>
          <span className="text-[17px] font-[650]">{cur.label}</span>
        </div>
        <div className={cx("pb-10 md:px-10 md:py-7", sec === "appearance" ? "max-md:px-0" : "px-4")}>
          {sec === "appearance" && <Appearance />}
          {sec === "branding" && <Branding />}
          {sec === "reading" && <ReadingSection />}
          {sec === "diagrams" && <DiagramsSection />}
          {sec === "sync" && <><SyncSection /><div className="mt-6"><AppLockSetting /></div></>}
          {sec === "sharing" && <SharingSection />}
          {sec === "blog" && <BlogSection />}
          {sec === "storage" && <StorageSection usage={usage} />}
          {sec === "ai" && <AISection />}
          {sec === "developer" && <DeveloperSection />}
          {sec === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ appearance
/** sRGB hex → OKLCH hue in degrees (for showing the theme's own accent hue). */
function hexHue(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.round(((Math.atan2(B, A) * 180) / Math.PI + 360) % 360);
}
/** Any CSS colour → [r,g,b] via a 1×1 canvas (handles oklch()). */
function rgbOf(css: string): [number, number, number] {
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
}
function contrast(a: string, b: string) {
  const L = (rgb: [number, number, number]) => { const [r, g, bl] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [L(rgbOf(a)), L(rgbOf(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const FONT: Record<S["readingFont"], string> = { sans: "Inter, system-ui, sans-serif", serif: "'Source Serif 4', Georgia, serif", mono: "'JetBrains Mono', monospace" };

/** The most recently edited Markdown note: the preview shows your own writing. */
function usePreviewNote() {
  const v = useVault();
  return useMemo(() => {
    const n = [...v.notes].filter((x) => !["canvas", "whiteboard", "slides", "flashcards", "roadmap"].includes(x.type) && x.body.trim()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!n) return null;
    const para = n.body.replace(/^---[\s\S]*?\n---\n?/, "").split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|```|\$\$|>|-|\*|\d+\.|!\[|\||<)/.test(p)) ?? "";
    const where = (n.folderId && v.folderMap.get(n.folderId)?.name) || v.spaceMap.get(n.spaceId)?.name || "Inbox";
    return { title: n.title, where, html: render(para.length > 260 ? para.slice(0, 260).replace(/\s+\S*$/, "") + "…" : para) };
  }, [v.notes, v.folderMap, v.spaceMap]);
}

function Appearance() {
  const s = useSettings();
  const adv = useAdvanced();
  const set = (p: Partial<S>) => setSettings(p);
  const act = activeTheme();
  const [hoverTheme, setHoverTheme] = useState<Theme | null>(null);
  const [hoverFont, setHoverFont] = useState<S["readingFont"] | null>(null);
  const [open, setOpen] = useState(false);
  const real = usePreviewNote();
  const hue = s.accentHue ?? hexHue(act.vars.accent);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setRatio(contrast(cs.getPropertyValue("--accent").trim(), cs.getPropertyValue("--surface").trim()));
  }, [s.theme, s.accentHue, act.id]);
  const pv = hoverTheme ? Object.fromEntries(Object.entries(hoverTheme.vars).map(([k, v]) => [`--${k}`, v])) : {};
  const font = FONT[hoverFont ?? s.readingFont];
  const preview = (
    <div className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-ink shadow-[var(--sh,none)]" style={pv as React.CSSProperties}>
      <div className="flex h-10 items-center gap-2 border-b border-line px-3.5 text-[12px] text-muted max-md:hidden">
        <span>{real?.where ?? "02 Optimization"}</span><ChevronRight size={11} /><span className="truncate text-ink">{real?.title ?? "Gradient descent"}</span><span className="flex-1" /><span className="size-1.5 shrink-0 rounded-full bg-ok" />Synced
      </div>
      <div className="flex flex-col gap-3 px-[26px] py-[22px] max-md:gap-2 max-md:px-[18px] max-md:py-4" style={{ fontFamily: font, fontSize: s.fontSize, lineHeight: `${Math.round(s.fontSize * 1.76)}px` }}>
        <span dir="auto" className="text-[1.53em] font-bold leading-[1.23] max-md:text-[20px]">{real?.title ?? "Gradient descent"}</span>
        <span dir="auto" className="max-md:text-[16px] max-md:leading-7 [&_a]:text-link [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-4 [&_p]:m-0 [&_p]:inline">
          {real?.html ? <span dangerouslySetInnerHTML={{ __html: real.html }} /> : <>Step against the gradient, scaled by a <span className="text-link underline decoration-dotted underline-offset-4">learning rate</span> <i>η</i>. Too large diverges; too small crawls.</>}
          <span className="ml-0.5 inline-block h-5 w-0.5 bg-accent align-[-4px] max-md:h-[18px] max-md:align-[-3px]" />
        </span>
        <div className="rounded-[10px] border px-3.5 py-2.5 font-sans text-[14px] leading-[22px] max-md:hidden" style={{ background: "color-mix(in srgb, var(--success) 9%, transparent)", borderColor: "color-mix(in srgb, var(--success) 28%, transparent)" }}><b className="text-ok">Tip</b> — start at 1e-3, then sweep.</div>
        <div className="flex gap-2 font-sans text-[13px]">
          <span className="flex h-[34px] items-center rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg max-md:h-8 max-md:px-3">Start review</span>
          <span className="flex h-[34px] items-center rounded-[10px] border border-line px-3.5 max-md:hidden">Later</span>
        </div>
      </div>
    </div>
  );
  const widthSeg = <Seg value={String(s.measure)} onChange={(v) => set({ measure: Number(v) as S["measure"] })} options={[{ value: "60", label: "60" }, { value: "68", label: "68" }, { value: "80", label: "80" }, { value: "0", label: "Full" }]} />;
  const densitySeg = <Seg className="md:w-[280px]" value={s.density} onChange={(v) => set({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />;
  return (
    <div className="flex gap-10">
      <div className="flex w-full max-w-[560px] flex-col gap-[26px] max-md:gap-5">
        <Head title="Appearance" hint={<span className="max-md:hidden">Changes apply instantly on this device and sync to your others.</span>} />
        <div className="-mt-5 px-4 md:hidden">{preview}</div>
        <Group label="Theme" className="max-md:px-4">
          <div className="grid grid-cols-6 gap-2.5 max-md:flex" onMouseLeave={() => setHoverTheme(null)}>
            {THEMES.map((t) => {
              const sel = s.theme !== "auto" ? s.theme === t.id : act.id === t.id;
              return (
                <button key={t.id} onClick={() => set({ theme: t.id })} onMouseEnter={() => setHoverTheme(t)} onFocus={() => setHoverTheme(t)} onBlur={() => setHoverTheme(null)} className="flex flex-col items-center gap-1.5" title={t.name}>
                  <div className="box-border flex h-[60px] w-full flex-col gap-[5px] rounded-[10px] border p-[9px] max-md:size-[52px] max-md:items-end max-md:justify-end max-md:rounded-[12px] max-md:p-1.5"
                    style={{ background: t.vars.bg, borderColor: t.vars.border, boxShadow: sel ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)" : "none" }}>
                    <span className="size-2 rounded-full max-md:size-2.5" style={{ background: t.vars.accent }} />
                    <span className="h-1 w-4/5 rounded-sm opacity-50 max-md:hidden" style={{ background: t.vars.text }} />
                    <span className="h-1 w-3/5 rounded-sm opacity-30 max-md:hidden" style={{ background: t.vars.text }} />
                  </div>
                  <span className={cx("text-[12px] max-md:hidden", sel ? "font-semibold text-ink" : "text-muted")}>{t.name}</span>
                </button>
              );
            })}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted max-md:hidden">
            <button role="switch" aria-checked={s.theme === "auto"} onClick={() => set({ theme: s.theme === "auto" ? act.id : "auto" })}
              className={cx("relative h-4 w-7 shrink-0 rounded-full", s.theme === "auto" ? "bg-accent" : "bg-line")}>
              <span className={cx("absolute top-0.5 size-3 rounded-full transition-all", s.theme === "auto" ? "left-[14px] bg-accent-fg" : "left-0.5 bg-muted")} />
            </button>
            Follow system light/dark (Paper ↔ Lamplight)
          </label>
        </Group>
        <Group label="Accent hue" className="max-md:gap-3 max-md:px-4" right={<span className="flex items-center gap-2 font-mono text-muted">{hue}°{s.accentHue !== null && <button className="font-sans text-[12px] text-link" onClick={() => set({ accentHue: null })}>Reset</button>}</span>}>
          <div className="max-md:py-1"><Slider value={hue} min={0} max={360} onChange={(v) => set({ accentHue: v })} height={20}
            knob="size-[26px] border-[3px] border-ink bg-accent max-md:size-9"
            track={<div className="absolute inset-0 rounded-full max-md:-inset-y-1 max-md:[background:linear-gradient(90deg,oklch(.79_.15_0),oklch(.79_.15_60),oklch(.79_.15_120),oklch(.79_.15_180),oklch(.79_.15_240),oklch(.79_.15_300),oklch(.79_.15_360))!important]" style={{ background: "linear-gradient(90deg,oklch(.75 .15 0),oklch(.75 .15 60),oklch(.75 .15 120),oklch(.75 .15 180),oklch(.75 .15 240),oklch(.75 .15 300),oklch(.75 .15 360))" }} />} /></div>
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted max-md:hidden"><CircleCheck size={13} className="text-ok" />{ratio ? `Contrast ${ratio.toFixed(1)} : 1 on surface · AA at every hue` : "AA contrast at every hue"}</span>
        </Group>
        <Group label="Reading font" className="max-md:px-4">
          <div className="hidden grid-cols-3 gap-2.5 md:grid" onMouseLeave={() => setHoverFont(null)}>
            {([["sans", "Inter"], ["serif", "Source Serif 4"], ["mono", "JetBrains Mono"]] as const).map(([v, n]) => (
              <button key={v} onClick={() => set({ readingFont: v })} onMouseEnter={() => setHoverFont(v)} className={cx("flex flex-col gap-1 rounded-[10px] p-3 text-left", s.readingFont === v ? "border-[1.5px] border-accent" : "border border-line")}
                style={s.readingFont === v ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                <span className={cx(v === "mono" ? "text-[20px] font-medium" : "text-[22px] font-semibold")} style={{ fontFamily: FONT[v] }}>Aa</span>
                <span className={cx("text-[12px]", s.readingFont !== v && "text-muted")}>{n}</span>
              </button>
            ))}
          </div>
          <Seg className="md:hidden" value={s.readingFont} onChange={(v) => set({ readingFont: v })} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: <span style={{ fontFamily: FONT.serif }}>Serif</span> }, { value: "mono", label: <span className="font-mono">Mono</span> }]} />
        </Group>
        <div className="grid gap-6 max-md:px-4 md:grid-cols-2">
          <Group label="Size" className="max-md:hidden" right={<span className="text-muted">{s.fontSize} px</span>}>
            <div className="pt-2">
              <Slider value={s.fontSize} min={14} max={22} onChange={(v) => set({ fontSize: v })} height={4} knob="size-[18px] bg-ink"
                track={<div className="absolute inset-0 overflow-hidden rounded-sm bg-surface-2"><span className="block h-full bg-ink opacity-70" style={{ width: `${((s.fontSize - 14) / 8) * 100}%` }} /></div>} />
            </div>
          </Group>
          <Group label="Text size" className="gap-3.5 md:hidden" right={<span className="text-muted">{s.fontSize} px</span>}>
            <Slider value={s.fontSize} min={14} max={22} onChange={(v) => set({ fontSize: v })} height={4} knob="size-6 bg-ink"
              track={<div className="absolute inset-0 overflow-hidden rounded-sm bg-surface-2"><span className="block h-full bg-ink opacity-70" style={{ width: `${((s.fontSize - 14) / 8) * 100}%` }} /></div>} />
          </Group>
          <Group label="Line width" className="max-md:hidden">{widthSeg}</Group>
        </div>
        <Group label="Density" className="max-md:hidden">{densitySeg}</Group>
        <Group label="Interface direction"><DirSeg /></Group>
        <div className="flex flex-col gap-[18px] max-md:px-4">
          <button onClick={() => setOpen(!open)} aria-expanded={open}
            className="flex items-center gap-2 border-t border-line pt-3.5 text-left text-muted max-md:h-[52px] max-md:gap-2.5 max-md:rounded-[12px] max-md:border-0 max-md:bg-surface max-md:px-3.5 max-md:pt-0">
            <ChevronRight size={14} className={cx("shrink-0 transition-transform max-md:size-[15px]", open && "rotate-90")} />
            <span className="font-medium text-ink max-md:flex-1 max-md:font-normal">Advanced</span>
            <span className="text-[12px] max-md:hidden">UI font size · reduce motion · custom CSS snippet</span>
            <span className="text-[12.5px] md:hidden">width · density · motion</span>
          </button>
          {open && <AdvancedPanel adv={adv} widthSeg={widthSeg} densitySeg={densitySeg} />}
        </div>
      </div>
      <div className="hidden min-w-[300px] flex-1 flex-col gap-2.5 xl:flex">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted"><Eye size={13} />Live preview</span>
        {preview}
        <span className="text-[12px] leading-[18px] text-muted">Preview uses your real note and current settings. Hover any control to preview it before committing.</span>
      </div>
    </div>
  );
}

function AdvancedPanel({ adv, widthSeg, densitySeg }: { adv: Advanced; widthSeg: ReactNode; densitySeg: ReactNode }) {
  const s = useSettings();
  const [css, setCss] = useState(adv.css);
  useEffect(() => { const t = setTimeout(() => adv.css !== css && setAdvanced({ css }), 400); return () => clearTimeout(t); }, [css]); // eslint-disable-line react-hooks/exhaustive-deps
  const Row = ({ title, hint, on, onChange }: { title: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-start gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
      <div className="flex flex-1 flex-col gap-0.5"><span className="font-medium">{title}</span>{hint && <span className="text-[12.5px] text-muted">{hint}</span>}</div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <Group label="Line width" className="md:hidden">{widthSeg}</Group>
      <Group label="Density" className="md:hidden">{densitySeg}</Group>
      <Group label="UI font size" right={<span className="text-muted">{adv.uiScale}%</span>}>
        <Seg value={String(adv.uiScale)} onChange={(v) => setAdvanced({ uiScale: Number(v) as Advanced["uiScale"] })}
          options={[{ value: "90", label: "Small" }, { value: "100", label: "Default" }, { value: "110", label: "Large" }, { value: "125", label: "Larger" }]} />
      </Group>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <Row title="Reduce motion" hint="Turn off animations and transitions in the app." on={adv.reduceMotion} onChange={(v) => setAdvanced({ reduceMotion: v })} />
        <Row title="Spellcheck" hint="Underline misspellings while you write." on={s.spellcheck} onChange={(v) => setSettings({ spellcheck: v })} />
        <Row title="Johnny-Decimal sorting" hint="Sort folders by their number prefix (10-19 Area / 11 Category / 11.01)" on={s.johnnyDecimal} onChange={(v) => setSettings({ johnnyDecimal: v })} />
      </div>
      <Group label="Custom CSS snippet" right={css && <button onClick={() => setCss("")} className="text-[12px] text-link">Clear</button>}>
        <textarea value={css} onChange={(e) => setCss(e.target.value)} spellCheck={false} rows={5} placeholder={".prose h2 { letter-spacing: -.01em; }"}
          className="resize-y rounded-[10px] border border-line bg-surface p-3 font-mono text-[12.5px] leading-5 focus:border-accent focus:outline-none" />
        <span className="text-[12.5px] text-muted">Applied to this device only, right away. Tokens like <code className="font-mono">--accent</code> and <code className="font-mono">--read-font</code> are yours to override.</span>
      </Group>
    </div>
  );
}

// ------------------------------------------------------------------ branding / about
function Branding() {
  const s = useSettings();
  const set = (p: Partial<S>) => setSettings(p);
  const F = ({ label, children }: { label: string; children: ReactNode }) => <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{label}</span>{children}</label>;
  return (
    <div className="flex max-w-[560px] flex-col gap-[22px]">
      <Head title="Branding" hint="Shown on your public blog, shared pages and the Home screen. Synced with your notes." />
      <div className="grid grid-cols-[72px_1fr] gap-2.5">
        <F label="Avatar"><input className={inputCls + " text-center text-[20px]"} value={s.avatar} onChange={(e) => set({ avatar: e.target.value.slice(0, 4) })} /></F>
        <F label="Your name"><input className={inputCls} value={s.author} onChange={(e) => set({ author: e.target.value })} /></F>
      </div>
      <F label="Blog name"><input className={inputCls} value={s.blogName} onChange={(e) => set({ blogName: e.target.value })} /></F>
      <F label="Tagline"><input dir="auto" className={inputCls} value={s.tagline} onChange={(e) => set({ tagline: e.target.value })} /></F>
      <a href="/blog" target="_blank" className="flex items-center gap-1.5 text-link"><Globe size={14} />Open your blog</a>
    </div>
  );
}

function About() {
  return (
    <div className="flex max-w-[560px] flex-col gap-[22px]">
      <Head title="About" />
      <div className="flex items-center gap-3"><LumenMark size={44} /><div className="flex flex-col gap-1"><Wordmark size={26} /><span className="text-muted">v1.0 · local-first notes</span></div></div>
      <p className="leading-[21px] text-muted">JSON Canvas 1.0 · .excalidraw · Markdown in, Markdown out. Your notes live on this device first and sync to your own Cloudflare.</p>
    </div>
  );
}

// ------------------------------------------------------------------ sync
const accountName = (a: string) => (a === "main" ? "Main" : a === "roadmap" ? "Road-map" : a);
function SyncSection() {
  const st = useSync();
  const [health, setHealth] = useState<{ r2: boolean; ai: boolean } | null>(null);
  const tok = getToken();
  useEffect(() => { if (tok) api<{ r2: boolean; ai: boolean }>("/health").then(setHealth).catch(() => {}); }, [tok]);
  return (
    <div className="flex max-w-[560px] flex-col gap-[22px]">
      <Head title="Sync" hint="Notes always save on this device first. Unlock sync to back them up to Cloudflare and use them on every device." />
      {tok ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
          <div className="flex items-center gap-2"><Check size={16} className="text-ok" /><span className="font-semibold">Sync on</span><span className="text-muted">· {st.status}{st.last ? ` · last ${new Date(st.last).toLocaleTimeString()}` : ""}{st.pending ? ` · ${st.pending} pending` : ""}</span></div>
          {st.error && <div className="text-[12.5px] text-bad">{st.error}</div>}
          {health && <div className="text-[12.5px] text-muted">Server: {API_BASE || location.host} · files in {health.r2 ? "R2" : "D1 (1.5 MB parts)"} · AI {health.ai ? "on" : "off"}</div>}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void syncNow()}>{st.status === "syncing" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</Button>
            <Button size="sm" variant="ghost" title="Stop syncing on this device until you sign in again (the account stays saved)" onClick={() => { setToken(null); void syncNow(); toast("Sync locked on this device. Your notes stay here."); }}><LogOut size={14} /> Lock</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-line bg-surface p-4 text-[13px] text-muted">Sync is locked on this device for <b className="text-ink">{accountName(getAccount())}</b>. Switch to a saved account below, or sign in again (“Unlock or add an account”).</div>
      )}
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">Accounts on this device</div>
        <div className="text-[12.5px] text-muted">Each passcode opens its own account with its own notes. Sign in once and switch here (or from the space menu) without typing the passcode again. Only the sign-in token is kept on this device, never the passcode.</div>
        <div className="rounded-[12px] border border-line bg-surface p-1.5"><AccountSwitcher /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sharing
const NOTE_ICON: Partial<Record<Note["type"], LucideIcon>> = { slides: Presentation, flashcards: Layers, whiteboard: Pencil, canvas: LayoutDashboard };
const NOTE_KIND: Partial<Record<Note["type"], string>> = { slides: "Slides", flashcards: "Flashcards", whiteboard: "Whiteboard", canvas: "Canvas", roadmap: "Roadmap" };
/** "12 min ago" · "2 h ago" · "Mon" · "7 Nov" (Lumen 09 Settings › Sharing). */
function ago(t: number) {
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return new Date(t).toLocaleDateString("en-GB", { weekday: "short" });
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
type LinkRow = { space: boolean; key: string; icon: LucideIcon; title: string; kind: string; url: string; updated: number; off: () => void };

function CopyBtn({ text, className, size = 13 }: { text: string; className?: string; size?: number }) {
  const [ok, setOk] = useState(false);
  return (
    <button aria-label="Copy" title="Copy" className={cx(ok ? "text-ok" : "text-muted hover:text-ink", className)}
      onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); }}>
      {ok ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

function SharingSection() {
  const v = useVault();
  const [tab, setTab] = useState<"links" | "published">("links");
  const counts = useMemo(() => { const m = new Map<string, number>(); v.notes.forEach((n) => m.set(n.spaceId, (m.get(n.spaceId) ?? 0) + 1)); return m; }, [v.notes]);
  const links: LinkRow[] = useMemo(() => [
    ...v.spaces.filter((s) => s.shareId).map((s: Space) => ({ space: true, key: s.id, icon: s.kind === "course" ? GraduationCap : Layers, title: s.name, kind: `${s.kind === "course" ? "Course space" : "Space"} · ${counts.get(s.id) ?? 0} notes`, url: shareUrl(s.shareId!), updated: s.updatedAt, off: () => void turnOffLink({ kind: "space", space: s }) })),
    ...v.notes.filter((n) => n.shareId).map((n) => ({ space: false, key: n.id, icon: NOTE_ICON[n.type] ?? FileText, title: n.title, kind: NOTE_KIND[n.type] ?? "Note", url: shareUrl(n.shareId!), updated: n.updatedAt, off: () => void turnOffLink({ kind: "note", note: n }) })),
  // spaces first (they expose the most), then notes; newest first within each
  ].sort((a, b) => Number(b.space) - Number(a.space) || b.updated - a.updated), [v.notes, v.spaces, counts]);
  const pubs: LinkRow[] = useMemo(() => v.notes.filter((n) => n.published).sort((a, b) => b.updatedAt - a.updatedAt).map((n) => ({
    space: false, key: n.id, icon: Globe, title: n.title, kind: NOTE_KIND[n.type] ?? "Post", url: blogUrl(n.slug || n.id), updated: n.updatedAt,
    off: () => void updateNote(n.id, { published: 0 }).then(() => syncNow()).then(() => toast("Unpublished", { label: "Undo", run: () => void updateNote(n.id, { published: 1 }).then(() => syncNow()) })),
  })), [v.notes]);
  const rows = tab === "links" ? links : pubs;
  const offAll = async () => {
    if (!links.length || !confirm(`Turn off all ${links.length} share links? Anyone who has them will lose access.`)) return;
    for (const s of v.spaces.filter((x) => x.shareId)) await patch("space", s.id, { shareId: null });
    for (const n of v.notes.filter((x) => x.shareId)) await updateNote(n.id, { shareId: null });
    await syncNow();
    toast("All links turned off.");
  };
  const offBtn = "flex items-center justify-center gap-1.5 rounded-[10px] border font-medium text-bad";
  const offStyle = { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" };
  const offLabel = tab === "links" ? "Turn off" : "Unpublish";
  return (
    <div className="flex max-w-[960px] flex-col gap-[18px] max-md:min-h-[calc(100dvh-196px)] max-md:gap-0">
      <span className="-mt-1 pb-3 text-[13px] text-muted md:hidden">{links.length} shared link{links.length === 1 ? "" : "s"} · {pubs.length} published</span>
      <Head title="Sharing" hint={<span className="max-md:hidden">Everything reachable without your passcode. {links.length} link{links.length === 1 ? "" : "s"} · {pubs.length} published post{pubs.length === 1 ? "" : "s"}.</span>}
        right={links.length > 0 && <button onClick={offAll} className={cx(offBtn, "h-9 px-3 max-md:hidden")} style={offStyle}><Link2Off size={14} />Turn off all links</button>} />
      <div className="flex gap-0.5 self-start rounded-[10px] border border-line bg-surface p-[3px] max-md:hidden">
        {([["links", Link2, "Shared links", links.length, "text-info"], ["published", Globe, "Published", pubs.length, "text-ok"]] as const).map(([id, I, l, c, col]) => (
          <button key={id} onClick={() => setTab(id)} className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-3", tab === id ? "bg-surface-2 font-semibold" : "text-muted")}><I size={13} className={tab === id ? col : ""} />{l} {c}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-line px-4 py-10 text-center text-muted">{tab === "links" ? "Nothing is shared. Use Share on a note or space to make a link." : "No published posts yet."}</div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-[12px] border border-line md:block">
            <div className="grid h-9 grid-cols-[2.2fr_2.4fr_1fr_120px] items-center bg-surface text-[12px] font-semibold text-muted"><span className="px-3.5">Item</span><span className="px-3.5">Link</span><span className="px-3.5">Updated</span><span /></div>
            {rows.map((r) => (
              <div key={r.key} className="grid min-h-[53px] grid-cols-[2.2fr_2.4fr_1fr_120px] items-center border-t border-line">
                <span className="flex min-w-0 items-center gap-2.5 px-3.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-2"><r.icon size={14} className="text-muted" /></span>
                  <span className="flex min-w-0 flex-col gap-px"><span dir="auto" className="truncate font-medium">{r.title}</span><span className="text-[11.5px] text-muted">{r.kind}</span></span>
                </span>
                <span className="flex min-w-0 items-center gap-2 px-3.5 font-mono text-[12px] text-link"><a href={r.url} target="_blank" rel="noreferrer" className="truncate">{bareUrl(r.url)}</a><CopyBtn text={r.url} /></span>
                <span className="px-3.5 text-muted">{ago(r.updated)}</span>
                <span className="px-3.5"><button onClick={r.off} className="inline-flex h-7 items-center rounded-[8px] border border-line px-2.5 hover:text-bad">{offLabel}</button></span>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-[14px] bg-surface md:hidden">
            {rows.map((r, i) => (
              <div key={r.key} className={cx("flex min-h-[84px] items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-line")}>
                <r.icon size={18} className="shrink-0 text-muted" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span dir="auto" className="truncate font-medium">{r.title}</span>
                  <button onClick={() => navigator.clipboard.writeText(r.url).then(() => toast("Link copied"))} className="truncate text-left font-mono text-[11.5px] text-link">{bareUrl(r.url)}</button></div>
                <button onClick={r.off} className="flex h-[38px] items-center rounded-[10px] border border-line px-3 text-[13px]">{offLabel}</button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "links" && links.length > 0 && <><span className="flex-1 md:hidden" /><button onClick={offAll} className={cx(offBtn, "mt-4 h-[54px] rounded-[12px] font-semibold md:hidden")} style={offStyle}>Turn off all links</button></>}
      <span className="flex items-center gap-2 text-[12.5px] text-muted max-md:hidden"><Clock size={13} />Link expiry dates and passwords are coming later.</span>
    </div>
  );
}

// ------------------------------------------------------------------ storage
const CLOUD_LIMIT = 5 * GB;
function fileIcon(mime: string): LucideIcon {
  return mime.startsWith("video/") ? FileVideo : mime.startsWith("audio/") ? FileAudio : mime.startsWith("image/") ? Image : mime === "application/pdf" ? FileText : File;
}
type ServerUsage = { at: number; dbBytes: number | null; limitBytes: number; notes: { count: number; bytes: number }; records: { bytes: number }; files: { count: number; parts: number; bytes: number }; r2: { n: number; bytes: number } | null };
function StorageSection({ usage }: { usage: { usage: number; quota: number } | null }) {
  const v = useVault();
  const st = useSync();
  const tok = getToken();
  const atts = useLiveQuery(() => db.attachments.filter((a) => !a.deleted).toArray(), []) ?? [];
  const versions = useLiveQuery(() => db.versions.count(), []) ?? 0;
  const cached = useLiveQuery(() => db.blobs.toArray().then((bs) => bs.map((b) => ({ id: b.id, size: b.blob.size, uploaded: b.uploaded }))), []) ?? [];
  const [server, setServer] = useState<ServerUsage | null>(null);
  const [serverErr, setServerErr] = useState("");
  const [adv, setAdv] = useState(false);
  const loadServer = () => { if (tok) api<ServerUsage>("/usage").then((u) => { setServer(u); setServerErr(""); }).catch((e) => setServerErr((e as Error).message)); };
  useEffect(loadServer, [tok, st.last]); // eslint-disable-line react-hooks/exhaustive-deps
  // Device-side estimate (used when sync is off or the server can't be reached).
  const estNotes = useMemo(() => v.notes.reduce((s, n) => s + new Blob([n.body]).size + 512, 0), [v.notes]);
  const estFiles = atts.reduce((s, a) => s + (a.size || 0), 0);
  const notesBytes = server ? server.records.bytes : estNotes;
  const filesBytes = server ? server.files.bytes + (server.r2?.bytes ?? 0) : estFiles;
  const fileCount = server ? server.files.count + (server.r2?.n ?? 0) : atts.length;
  const limit = server?.limitBytes ?? CLOUD_LIMIT;
  const used = notesBytes + filesBytes;
  const largest = useMemo(() => [...atts].sort((a, b) => b.size - a.size).slice(0, 5).map((a) => ({ ...a, note: v.notes.find((n) => n.body.includes(`att:${a.id}`))?.title })), [atts, v.notes]);
  const pct = (b: number, of: number) => `${Math.min(100, (b / of) * 100)}%`;
  const del = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? Notes that embed it will show a missing file.`)) return;
    await patch("attachment", id, { deleted: 1 });
    await db.blobs.delete(id);
    // Free the bytes on Cloudflare too (D1 parts or R2 object), not just the record.
    if (tok) await api(`/att/${id}`, { method: "DELETE" }).catch(() => {});
    toast(`${name} deleted`);
    loadServer();
  };
  const dropCached = async () => {
    const up = cached.filter((b) => b.uploaded);
    if (!up.length) return;
    await db.blobs.bulkDelete(up.map((b) => b.id));
    toast(`Freed ${mb(up.reduce((s, b) => s + b.size, 0))} on this device. Files download again when opened.`);
  };
  const Bar = ({ children }: { children: ReactNode }) => <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-surface-2">{children}</div>;
  const card = "flex flex-col gap-2.5 max-md:rounded-[14px] max-md:bg-surface max-md:p-4";
  const gb = (b: number) => (b / GB).toFixed(2);
  return (
    <div className="flex max-w-[900px] flex-col gap-6 max-md:gap-3">
      <Head title="Storage" hint={<span className="max-md:hidden">Free Cloudflare D1 · files split into 1.5 MB parts · 100 MB per file.</span>} />
      <div className={card} title={server ? `Measured on your Cloudflare at ${new Date(server.at).toLocaleTimeString()}${server.dbBytes ? ` · D1 database file ${mb(server.dbBytes)}` : ""}` : "Estimated from this device"}>
        <div className="flex items-baseline gap-2"><span className="font-semibold">Cloudflare</span><span className="flex-1" />
          <span className="max-md:hidden"><b className="text-[15px] font-[650]">{mb(used)}</b> <span className="text-muted">of 5 GB</span></span>
          <span className="md:hidden"><b className="font-[650]">{used >= 100 * MB ? gb(used) : mb(used)}</b><span className="text-muted">&nbsp;/ 5 GB</span></span>
        </div>
        <Bar><span className="bg-ink opacity-75" style={{ width: pct(notesBytes, limit), minWidth: notesBytes ? 2 : 0 }} /><span className="bg-info" style={{ width: pct(filesBytes, limit), minWidth: filesBytes ? 2 : 0 }} /></Bar>
        <div className="flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-muted max-md:hidden">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-ink opacity-75" />Notes {mb(notesBytes)}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-info" />Files {mb(filesBytes)} · {fileCount} file{fileCount === 1 ? "" : "s"}</span>
          <span className="flex-1" />{!server && <span>{tok ? (serverErr ? "estimate · server unreachable" : "measuring…") : "estimate · sync off"}</span>}<span>{mb(Math.max(0, limit - used))} free</span>
        </div>
        <span className="text-[12.5px] text-muted md:hidden">Notes {mb(notesBytes)} · Files {mb(filesBytes)}{!server ? " · estimate" : ""}</span>
      </div>
      <div className={card}>
        <div className="flex items-baseline gap-2"><span className="font-semibold"><span className="max-md:hidden">This device</span><span className="md:hidden">This phone</span></span><span className="flex-1" /><span><b className="font-[650] md:text-[15px]">{usage ? mb(usage.usage) : "…"}</b>{usage?.quota ? <span className="text-muted max-md:hidden"> of ~{mb(usage.quota)} browser quota</span> : null}</span></div>
        <Bar><span className="block h-full bg-ink opacity-75" style={{ width: usage?.quota ? pct(usage.usage, usage.quota) : "0%", minWidth: 2 }} /></Bar>
        <span className="text-[12.5px] text-muted max-md:hidden">Older attachments can be dropped from this device and fetched again when opened.</span>
      </div>
      {largest.length > 0 && (
        <div className="flex flex-col gap-2 max-md:gap-0">
          <span className="font-semibold max-md:px-1 max-md:pb-2 max-md:pt-2 max-md:text-[11px] max-md:uppercase max-md:tracking-[.06em] max-md:text-muted">Largest files</span>
          <div className="overflow-hidden rounded-[12px] border border-line max-md:rounded-[14px] max-md:border-0">
            {largest.map((f, i) => {
              const I = fileIcon(f.mime);
              return (
                <div key={f.id} className={cx("flex min-h-12 items-center gap-3 bg-surface pl-3.5 pr-2 max-md:min-h-[76px] max-md:py-2", i > 0 && "border-t border-line")}>
                  <I size={16} className="shrink-0 text-muted max-md:size-[18px]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-px max-md:gap-0.5"><span className="truncate font-mono text-[12.5px]">{f.name}</span><span className="text-[11.5px] text-muted max-md:text-[12px]"><span className="md:hidden">{mb(f.size)}</span><span className="max-md:hidden">{f.note ? `in ${f.note}` : "not used in any note"}</span></span></div>
                  <span className="w-[70px] text-right tabular-nums max-md:hidden">{mb(f.size)}</span>
                  <button onClick={() => del(f.id, f.name)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-bad max-md:size-11 max-md:justify-center max-md:border-0"><Trash2 size={13} className="max-md:size-[18px]" /><span className="max-md:hidden">Delete</span></button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className={cx(card, "md:border-t md:border-line md:pt-5")}>
        <span className="flex items-center gap-2 font-semibold"><Database size={15} className="text-muted" />Backup &amp; import</span>
        <span className="text-[12.5px] text-muted">{v.notes.length} notes · {v.folders.length} folders · {v.spaces.length} spaces · {versions} versions kept</span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setUI({ io: true })}>Import / export…</Button>
          <Button size="sm" onClick={() => exportBackup()}>Download backup</Button>
          <Button size="sm" variant="ghost" onClick={async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? "Storage marked persistent" : "Browser declined persistent storage"); }}>Keep data persistent</Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <button onClick={() => setAdv(!adv)} aria-expanded={adv} className="flex items-center gap-2 text-left text-muted"><ChevronRight size={14} className={cx("transition-transform", adv && "rotate-90")} /><span className="font-medium text-ink">Advanced</span><span className="text-[12px]">free up this device · clear local data</span></button>
        {adv && <StorageAdvanced cached={cached} onDrop={dropCached} pending={st.pending} synced={!!tok} />}
      </div>
    </div>
  );
}

function StorageAdvanced({ cached, onDrop, pending, synced }: { cached: { size: number; uploaded: 0 | 1 }[]; onDrop: () => void; pending: number; synced: boolean }) {
  const inbox = useVault().spaceMap.get(DEFAULT_SPACE);
  const name = inbox?.name ?? "Inbox";
  const [typed, setTyped] = useState("");
  const up = cached.filter((b) => b.uploaded);
  const upBytes = up.reduce((s, b) => s + b.size, 0);
  const safe = synced && pending === 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3">
        <div className="flex flex-1 flex-col gap-0.5"><span className="font-medium">Free up space on this device</span><span className="text-[12.5px] text-muted">{up.length} uploaded file{up.length === 1 ? "" : "s"} cached here ({mb(upBytes)}). They stay on Cloudflare and download again when opened.</span></div>
        <button onClick={onDrop} disabled={!up.length} className="flex h-8 shrink-0 items-center rounded-[8px] border border-line px-3 disabled:opacity-45">Free {mb(upBytes)}</button>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[12px] border px-3.5 py-3" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }}>
        <span className="font-medium text-bad">Clear local data</span>
        <span className="text-[12.5px] leading-[19px] text-muted">Deletes every note, file and setting stored on this device, then reloads. {safe ? "Everything is synced, so it downloads again from your Cloudflare." : synced ? `${pending} change${pending === 1 ? " is" : "s are"} not synced yet and would be lost. Sync first.` : "Sync is off: this would delete your only copy, so it's disabled."}</span>
        <label className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">Type <b className="font-semibold text-ink">{name}</b> to confirm</span>
          <input className={inputCls + " md:h-9"} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} /></label>
        <button disabled={typed !== name || !safe} onClick={async () => { db.close(); await db.delete(); try { localStorage.removeItem("lumen.brandingPulled"); } catch { /* ignore */ } location.reload(); }}
          className="flex h-9 items-center gap-1.5 self-start rounded-[10px] bg-bad px-3.5 font-semibold text-white disabled:opacity-45"><Trash2 size={14} />Clear local data</button>
      </div>
    </div>
  );
}

/** Interface direction (workspace area: ws-dir) — Auto follows the device language, RTL mirrors the app chrome. */
function DirSeg() {
  const d = useUiDir();
  return <Seg className="md:w-[280px]" value={d} onChange={(v) => setUiDir(v as UiDir)} options={[{ value: "auto", label: "Auto" }, { value: "ltr", label: "LTR" }, { value: "rtl", label: "RTL ←" }]} />;
}
