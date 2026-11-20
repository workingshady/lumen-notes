// Settings, round 6 (Lumen 29 · SettingsDesk): one pattern for all 13 sections — grouped rows (label, one-line
// description, one control), Advanced folded at the bottom, danger actions in red outline only. Nav grouped
// You · Learning · Data · Advanced with search and badges (AI usage, sync); phone = list, then one section per screen.
// The round-4 section bodies (Settings.tsx, settings-*.tsx) live on inside each section's Advanced fold.
import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Glyph } from "../components/Glyph";
import { SETTINGS_SECTION_KEY, turnOffLink } from "../components/ShareSheet";
import { AccountSection, AccountsGate } from "../components/auth/AccountSection";
import { AvatarGlyph } from "../components/SpaceIcon";
import { cx, Sheet } from "../components/ui";
import { limitState, usedPct, useAiUsage } from "../lib/ai-usage";
import { API_BASE, api, forgetAccount, getAccount, getToken, setToken } from "../lib/api";
import { db, DEFAULT_SPACE, DEMO } from "../lib/db";
import { APP_VERSION } from "../lib/home-meta";
import { fmtDate, fmtNum, fmtRelative, t, tk, useLang } from "../lib/i18n";
import { setExtraPrefs, useExtraPrefs } from "../lib/reading-prefs";
import { OPTIONS, setScale, useScale, type GraphDefault } from "../lib/scale-prefs";
import { setSettings, useSettings, type Settings as S } from "../lib/settings";
import { getUI, setUI, toast, useVault } from "../lib/store";
import { runNav } from "../components/Sidebar";
import { syncNow, useSync } from "../lib/sync";
import { MODE_LABEL, setAssistantPrefs, setTabPrefs, TAB_META, useAssistantPrefs, useTabPrefs, type TabPref } from "../lib/tab-prefs";
import { AppearanceClassic, SharingSection, StorageSection, SyncSection, Branding as BrandingClassic, saveBranding } from "./Settings";
import { VersionSettings } from "../components/versions/VersionSettings";
import { AISection } from "./settings-ai";
import { BlogSection, setInboxProps } from "./settings-blog-ai";
import { DeveloperSection } from "./settings-developer";
import { DevicesPanel } from "./settings-devices";
import { DiagramsSection } from "./settings-diagrams";
import { SAdvanced, SBtn, SEdit, SGroup, SPage, SRow, SSeg, SToggle } from "./settings-kit";
import { useSidebarMode, useSidebarOpen } from "../components/sidebar-auto";
import { setAdvanced, useAdvanced } from "./settings-advanced";
import { ReadingSection } from "./settings-reading";
import { ReviewSettings } from "./settings-review";
import { StudyPlanSettings } from "./settings-plan";
import { AppLockSetting } from "./Welcome";
import { openSidebarCustomise, openKeyboardMap } from "../components/sidebar-r6";
/** Always group thousands (3,120 · 10,000) like the design. */
const G: Intl.NumberFormatOptions = { useGrouping: true };

export type SecId = "account" | "appearance" | "branding" | "reading" | "plan" | "diagrams" | "sync" | "sharing" | "blog" | "storage" | "versions" | "ai" | "developer" | "about";
type NavItem = { id: SecId; label: string; glyph: string; words: string };
const NAV: { h: string; items: NavItem[] }[] = [
  { h: tk("You"), items: [
    { id: "account", label: tk("Account"), glyph: "account", words: "profile devices passcode sign out delete" },
    { id: "appearance", label: tk("Appearance"), glyph: "canvas", words: "theme lamplight paper accent colour language arabic density font motion css sidebar" },
    { id: "branding", label: tk("Branding"), glyph: "owl", words: "blog name tagline author avatar" },
  ] },
  { h: tk("Learning"), items: [
    { id: "reading", label: tk("Reading"), glyph: "lesson", words: "font size line width arabic hyphenation voice read aloud" },
    { id: "plan", label: tk("Study plan"), glyph: "date", words: "daily goal reviews lessons rest day algorithm fsrs sm-2 retention flashcards" },
    { id: "diagrams", label: tk("Diagrams"), glyph: "diagrams-tab", words: "mermaid zoom edge hand-drawn tabs note tabs export big graph" },
  ] },
  { h: tk("Data"), items: [
    { id: "sync", label: tk("Sync"), glyph: "switch", words: "status mobile data files conflict cache lock devices" },
    { id: "sharing", label: tk("Sharing"), glyph: "link", words: "links posts turn off" },
    { id: "blog", label: tk("Blog"), glyph: "post", words: "address rss comments posts license" },
    { id: "storage", label: tk("Storage"), glyph: "archive", words: "cloudflare device largest files quota" },
    { id: "versions", label: tk("Versions & history"), glyph: "history", words: "versions history keep retention hourly daily named prune automatic snapshot restore" },
  ] },
  { h: tk("Advanced"), items: [
    { id: "ai", label: tk("AI"), glyph: "assistant", words: "usage limit neurons summarize flashcards voice model" },
    { id: "developer", label: tk("Developer"), glyph: "code", words: "tokens api endpoints simulator curl" },
    { id: "about", label: tk("About"), glyph: "c-info", words: "version updates shortcuts licences report" },
  ] },
];
const ALL = NAV.flatMap((g) => g.items);
const GOTO: [string, string, string][] = [["today", "date", tk("Today")], ["daily", "journal", tk("Daily note")], ["tasks", "task", tk("Tasks")], ["calendar", "v-calendar", tk("Calendar")], ["graph", "graph", tk("Graph")], ["canvas", "canvas", tk("Canvases")], ["paths", "path", tk("Learning paths")], ["drawer", "folder", tk("Spaces, folders & tags")]];

let lastRead: { v: string | null; at: number } | null = null; // StrictMode runs the initializer twice: keep the first read
function readStoredSection(): SecId | null {
  try {
    let v = sessionStorage.getItem(SETTINGS_SECTION_KEY);
    if (v === null && lastRead && Date.now() - lastRead.at < 2000) v = lastRead.v;
    else lastRead = { v, at: Date.now() };
    sessionStorage.removeItem(SETTINGS_SECTION_KEY);
    const id = v === "editor" || v === "palette" ? "appearance" : v === "data" ? "storage" : v === "study" ? "plan" : v;
    return ALL.some((s) => s.id === id) ? (id as SecId) : null;
  } catch { return null; }
}
/** Open Settings at a section (used by other screens and the sitemap). */
export function openSettings(sec: SecId) {
  try { sessionStorage.setItem(SETTINGS_SECTION_KEY, sec); } catch { /* ignore */ }
  setUI({ view: "settings" });
  window.dispatchEvent(new CustomEvent("lumen:settings-section", { detail: sec }));
}

function useBadges(): Partial<Record<SecId, { label: string; color: string }>> {
  const u = useAiUsage();
  const st = useSync();
  const tok = getToken();
  const ls = limitState(u);
  const out: Partial<Record<SecId, { label: string; color: string }>> = {};
  if (ls === "reached") out.ai = { label: t("Limit"), color: "var(--danger)" };
  else if (ls === "near") out.ai = { label: t("{n}%", { n: usedPct(u) }), color: "var(--warning)" };
  if (st.status === "error") out.sync = { label: t("Error"), color: "var(--danger)" };
  else if (st.status === "offline") out.sync = { label: t("Offline"), color: "var(--warning)" };
  else if (tok || DEMO) out.sync = { label: t("On"), color: "var(--success)" };
  return out;
}

export function SettingsView() {
  const [initial] = useState(readStoredSection);
  const [sec, setSec] = useState<SecId>(initial ?? "appearance");
  const [phoneRoot, setPhoneRoot] = useState(!initial);
  const [q, setQ] = useState("");
  const badges = useBadges();
  const s = useSettings();
  const vault = useVault();
  // Branding lives on the Inbox space too (synced; the public blog reads it): push edits, pull once from another device.
  useEffect(() => { const tm = setTimeout(() => void saveBranding(s), 800); return () => clearTimeout(tm); }, [s.blogName, s.tagline, s.author, s.avatar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = vault.spaceMap.get(DEFAULT_SPACE)?.props;
    if (p?.blogName && !localStorage.getItem("lumen.brandingPulled")) {
      setSettings({ blogName: p.blogName, tagline: p.tagline ?? s.tagline, author: p.author ?? s.author, avatar: p.avatar ?? s.avatar });
      try { localStorage.setItem("lumen.brandingPulled", "1"); } catch { /* ignore */ }
    }
  }, [vault.spaceMap]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<SecId>).detail; if (ALL.some((x) => x.id === id)) { setSec(id); setPhoneRoot(false); } };
    addEventListener("lumen:settings-section", on);
    return () => removeEventListener("lumen:settings-section", on);
  }, []);
  const go = (id: SecId) => { setSec(id); setPhoneRoot(false); };
  const ql = q.trim().toLowerCase();
  const match = (n: NavItem) => !ql || t(n.label).toLowerCase().includes(ql) || n.label.toLowerCase().includes(ql) || n.words.includes(ql);
  const cur = ALL.find((x) => x.id === sec)!;
  const nav = (phone: boolean) => (
    <>
      <div className={cx("flex items-center gap-2 px-2 pb-2.5", phone && "pt-1")}>
        {phone && <button aria-label={t("Back")} onClick={() => setUI({ view: "home" })} className="flex w-6 items-center text-[18px] rtl:-scale-x-100">←</button>}
        <span className={cx("flex-1 font-[650]", phone ? "text-[24px]" : "text-[18px]")}>{t("Settings")}</span>
      </div>
      <label className={cx("mx-1 mb-2.5 flex items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 text-muted", phone ? "h-[42px]" : "h-8")}>
        <Glyph name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search settings")} aria-label={t("Search settings")}
          onKeyDown={(e) => { if (e.key === "Enter") { const f = ALL.find(match); if (f) go(f.id); } if (e.key === "Escape") setQ(""); }}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
      </label>
      {phone && !ql && (
        // Phone "More" tab = this page (sitemap: More → Graph, paths, canvases, settings): the pages that aren't tabs first.
        <div className="flex flex-col gap-0.5" role="group" aria-label={t("Go to")}>
          <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Go to")}</div>
          {GOTO.map(([k, g, l]) => (
            <button key={k} onClick={() => (k === "drawer" ? setUI({ sidebar: true }) : void runNav(k as never, getUI().spaceId))} className="flex h-12 items-center gap-2.5 rounded-[8px] px-2.5 text-start text-ink">
              <Glyph name={g} size={16} color="var(--muted)" /><span className="flex-1">{t(l)}</span><span className="text-muted rtl:-scale-x-100">›</span>
            </button>
          ))}
        </div>
      )}
      {NAV.map((g) => {
        const items = g.items.filter(match);
        if (!items.length) return null;
        return (
          <div key={g.h} className="flex flex-col gap-0.5" role="group" aria-label={t(g.h)}>
            <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t(g.h)}</div>
            {items.map((n) => {
              const on = !phone && n.id === sec;
              const b = badges[n.id];
              return (
                <button key={n.id} onClick={() => go(n.id)} aria-current={on ? "page" : undefined} data-sec={n.id}
                  className={cx("flex items-center gap-2.5 rounded-[8px] px-2.5 text-start focus-visible:outline-2 focus-visible:outline-accent", phone ? "h-12 text-ink" : "h-[34px]", on ? "bg-surface-2 font-semibold text-ink" : !phone && "font-[450] text-muted hover:text-ink")}>
                  <Glyph name={n.glyph} size={16} color={on ? "var(--accent)" : "var(--muted)"} />
                  <span className="flex-1">{t(n.label)}</span>
                  {b && <span className="rounded-full px-1.5 text-[11px] font-semibold leading-[18px]" style={{ background: `color-mix(in srgb, ${b.color} 16%, transparent)`, color: b.color }}>{b.label}</span>}
                  {phone && <span className="text-muted rtl:-scale-x-100">›</span>}
                </button>
              );
            })}
          </div>
        );
      })}
      {ql && !ALL.some(match) && <span className="px-2.5 py-3 text-muted">{t("No setting matches “{q}”.", { q })}</span>}
    </>
  );

  return (
    <div className="flex h-full text-[14px] leading-[normal] text-ink md:text-[13px]">
      <nav aria-label={t("Settings")} className="hidden w-[252px] shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-line px-2.5 py-5 md:flex">{nav(false)}</nav>
      <nav aria-label={t("Settings")} className={cx("safe-t flex w-full flex-col gap-0.5 overflow-y-auto px-2 pb-6 pt-11 md:hidden", !phoneRoot && "hidden")}>{nav(true)}</nav>
      <div className={cx("flex min-w-0 flex-1 flex-col overflow-hidden", phoneRoot && "max-md:hidden")}>
        <div className="safe-t flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-3 md:hidden">
          <button aria-label={t("Back")} onClick={() => setPhoneRoot(true)} className="text-[18px] rtl:-scale-x-100">←</button>
          <span className="text-[16px] font-[650]">{t(cur.label)}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-12 md:px-10 md:py-7" key={sec}>
          {sec === "account" && <AccountsGate><AccountR6 /></AccountsGate>}
          {sec === "appearance" && <AppearanceR6 />}
          {sec === "branding" && <BrandingR6 />}
          {sec === "reading" && <ReadingR6 />}
          {sec === "plan" && <StudyR6 />}
          {sec === "diagrams" && <DiagramsR6 />}
          {sec === "sync" && <SyncR6 />}
          {sec === "sharing" && <SharingR6 go={go} />}
          {sec === "blog" && <BlogR6 />}
          {sec === "storage" && <StorageR6 />}
          {sec === "versions" && <VersionSettings />}
          {sec === "ai" && <AISection />}
          {sec === "developer" && <DeveloperSection />}
          {sec === "about" && <AboutR6 />}
        </div>
      </div>
    </div>
  );
}

/** Hide the round-4 body's own title (its page header is now the section header). */
const Classic = ({ children }: { children: ReactNode }) => <div className="r6-classic">{children}</div>;
/** Small inline text editor for a value row (›). */
function TextEdit({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  return (
    <SEdit>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
        <input autoFocus dir="auto" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2.5 focus:border-accent focus:outline-none" />
        <SBtn primary onClick={() => onSave(v.trim())}>{t("Save")}</SBtn>
      </form>
    </SEdit>
  );
}
function useOpen() { const [open, setOpen] = useState<string | null>(null); return { open, toggle: (k: string) => setOpen((o) => (o === k ? null : k)) }; }
function Confirm({ title, body, action, danger, onOk, onClose, input }: { title: string; body: ReactNode; action: string; danger?: boolean; onOk: (v: string) => Promise<void> | void; onClose: () => void; input?: { label: string; type?: string; need?: string }[] }) {
  const [vals, setVals] = useState<string[]>(() => (input ?? []).map(() => ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = (input ?? []).every((f, i) => (f.need ? vals[i] === f.need : !!vals[i]));
  return (
    <Sheet open onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await onOk(vals.join("\u0000")); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }} className="-m-4 flex flex-col gap-3.5 bg-surface p-5">
        <span className="text-[16px] font-[650]">{title}</span>
        <span className="leading-5 text-muted">{body}</span>
        {(input ?? []).map((f, i) => (
          <label key={f.label} className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">{f.label}</span>
            <input autoFocus={i === 0} type={f.type ?? "text"} value={vals[i]} onChange={(e) => setVals((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className="h-[38px] rounded-[8px] border border-line bg-bg px-3 focus:border-accent focus:outline-none" /></label>
        ))}
        {err && <span className="text-[12.5px] text-bad">{err}</span>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-[34px] px-3 text-muted">{t("Cancel")}</button>
          <button disabled={busy || !ok} className={cx("h-[34px] rounded-[9px] px-3.5 font-semibold disabled:opacity-50", danger ? "border text-bad" : "bg-accent text-accent-fg")} style={danger ? { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" } : undefined}>{action}</button>
        </div>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Account (R6-29L / 29Y)
function AccountR6() {
  const s = useSettings();
  const tok = getToken();
  const { open, toggle } = useOpen();
  const [devices, setDevices] = useState<{ name: string }[] | null>(null);
  const [dlg, setDlg] = useState<"passcode" | "signout" | "delete" | null>(null);
  useEffect(() => { if (tok) api<{ devices: { name: string }[] }>("/access/devices").then((r) => setDevices(r.devices)).catch(() => setDevices(null)); }, [tok]);
  const wipeLocal = async () => { await db.delete(); try { localStorage.removeItem("lumen.brandingPulled"); } catch { /* ignore */ } location.reload(); };
  return (
    <SPage title={t("Account")} sub={t("Signed in as one owner. Lumen has no shared accounts on this server.")}>
      <SGroup>
        <SRow label={s.author || t("You")} desc={tok ? t("Owner · {host}", { host: (API_BASE || location.host).replace(/^https?:\/\//, "") }) : t("This device · not syncing")}
          control={<><span className="order-first flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2"><AvatarGlyph value={s.avatar} size={14} /></span><SBtn onClick={() => toggle("profile")}>{t("Edit profile")}</SBtn></>} />
        {open === "profile" && <SEdit><Classic><BrandingClassic /></Classic></SEdit>}
        <SRow label={t("Devices unlocked for sync")} desc={devices ? devices.slice(0, 3).map((d) => d.name).join(" · ") || t("None yet") : tok ? t("Loading…") : t("Sync is off on this device")}
          value={devices ? fmtNum(devices.length, G) : undefined} onOpen={() => toggle("devices")} />
        {open === "devices" && <SEdit><DevicesPanel /></SEdit>}
        <SRow label={t("Passcode")} desc={t("A secret on your Worker. Changing it signs every device out.")} control={<SBtn onClick={() => setDlg("passcode")}>{t("Change")}</SBtn>} />
      </SGroup>
      <SGroup title={t("Danger zone")}>
        <SRow label={t("Sign out of this device")} control={<SBtn onClick={() => setDlg("signout")}>{t("Sign out")}</SBtn>} />
        <SRow label={t("Delete account and all data")} desc={t("Removes notes from your Cloudflare. Export first.")} control={<SBtn danger onClick={() => setDlg("delete")}>{t("Delete…")}</SBtn>} />
      </SGroup>
      <SAdvanced summary={t("App lock · accounts")}>
        <SGroup><div className="px-3.5 py-3"><AppLockSetting /></div></SGroup>
        <Classic><AccountSection /></Classic>
      </SAdvanced>
      {dlg === "passcode" && <Confirm title={t("Change passcode")} action={t("Done")} onClose={() => setDlg(null)} onOk={() => {}}
        body={<>{t("The passcode is a secret on your Cloudflare Worker, so it is changed there. Run this in the project folder, then unlock each device with the new passcode:")}<code dir="ltr" className="mt-2 block rounded-[8px] border border-line bg-bg px-3 py-2 font-mono text-[12.5px] text-ink">npx wrangler secret put APP_PASSCODE</code></>} />}
      {dlg === "signout" && <Confirm title={t("Sign out of this device?")} action={t("Sign out")} onClose={() => setDlg(null)}
        body={t("Sync stops on this device and the token is forgotten. Notes stay here; unlock again with the passcode to sync.")}
        onOk={() => { forgetAccount(getAccount()); setToken(null); toast(t("Signed out of this device")); void syncNow(); }} />}
      {dlg === "delete" && <Confirm danger title={t("Delete account and all data?")} action={t("Delete everything")} onClose={() => setDlg(null)}
        body={t("Every note, card, file and token is removed from your Cloudflare and from this device. Other devices clear their copies when they next sync. This can't be undone. Export first (Settings › Storage).")}
        input={[{ label: t("Type DELETE to confirm"), need: "DELETE" }, ...(DEMO || !tok ? [] : [{ label: t("Passcode"), type: "password" }])]}
        onOk={async (v) => { const [, pass] = v.split("\u0000"); if (tok && !DEMO) await api("/vault/wipe", { method: "POST", json: { confirm: "DELETE", passcode: pass } }); await wipeLocal(); }} />}
    </SPage>
  );
}

// ------------------------------------------------------------------ Appearance (R6-29M)
function AppearanceR6() {
  useLang();
  const adv = useAdvanced();
  const sbMode = useSidebarMode();
  const openKey = sbMode === "click" ? "sidebarOpenClick" : "sidebarOpenHover";
  const sbOpen = useSidebarOpen(sbMode === "click" ? "click" : "hover");
  // Owner request: keep every theme (Lamplight, Paper, Midnight, Sepia, Forest, High contrast) with the palette swatches
  // and the live preview from the round-2/4 Appearance page as the main view; round-6 extras sit below it.
  return (
    <div className="flex flex-col gap-6">
      {/* AppearanceClassic carries its own "Appearance" heading, theme swatches and live preview */}
      <AppearanceClassic />
      <div className="max-w-[560px]"><SGroup>
        <SRow label={t("Customise sidebar")} desc={t("Reorder, hide, show counts, row height")} glyph="rail" onOpen={openSidebarCustomise} />
        <SRow label={t("Sidebar")} desc={t("Collapsed to the rail on desktop and tablet. Opens over the content; Esc closes it.")} control={<SSeg label={t("Sidebar")} value={sbMode} onChange={(v) => setSettings({ sidebarMode: v })} options={[{ value: "open", label: t("Always open") }, { value: "hover", label: t("Expand on hover") }, { value: "click", label: t("Expand on click") }]} />} />
        <SRow label={t("Open")} desc={sbMode === "open" ? t("Not used while the sidebar is always open.") : t("On top floats over the page; Push content makes room for it. Saved separately for hover and click.")} control={<span className={sbMode === "open" ? "pointer-events-none opacity-50" : ""} aria-disabled={sbMode === "open"}><SSeg label={t("Open")} value={sbOpen} onChange={(v) => setSettings({ [openKey]: v } as Partial<S>)} options={[{ value: "overlay", label: <span className="inline-flex items-center gap-1"><Glyph name="layers" size={13} />{t("On top")}</span> }, { value: "push", label: <span className="inline-flex items-center gap-1"><Glyph name="rail" size={13} />{t("Push content")}</span> }]} /></span>} />
        <SRow label={t("Reduce effects")} desc={t("Simpler graph and canvas: no animation, labels on zoom. Turns on by itself on slow devices.")} control={<SToggle on={!!adv.reduceEffects} onChange={(v) => setAdvanced({ reduceEffects: v })} label={t("Reduce effects")} />} />
      </SGroup></div>
    </div>
  );
}

// ------------------------------------------------------------------ Branding (R6-29N)
function BrandingR6() {
  const s = useSettings();
  const { open, toggle } = useOpen();
  const save = (k: keyof S) => (v: string) => { setSettings({ [k]: v } as Partial<S>); toggle(String(k)); };
  return (
    <SPage title={t("Branding")} sub={t("How your blog and shared pages introduce you.")}>
      <SGroup>
        <SRow label={t("Blog name")} value={s.blogName} onOpen={() => toggle("blogName")} />
        {open === "blogName" && <TextEdit value={s.blogName} onSave={save("blogName")} />}
        <SRow label={t("Tagline")} value={s.tagline} onOpen={() => toggle("tagline")} />
        {open === "tagline" && <TextEdit value={s.tagline} onSave={save("tagline")} />}
        <SRow label={t("Author")} value={s.author || t("Not set")} onOpen={() => toggle("author")} />
        {open === "author" && <TextEdit value={s.author} onSave={save("author")} />}
        <SRow label={t("Avatar")} control={<><span className="order-first flex size-7 items-center justify-center rounded-[8px]" style={{ background: "color-mix(in srgb, #E8E6E1 14%, transparent)" }}><AvatarGlyph value={s.avatar} size={16} /></span><SBtn onClick={() => toggle("avatar")}>{t("Change")}</SBtn></>} />
        {open === "avatar" && <SEdit><Classic><BrandingClassic /></Classic></SEdit>}
      </SGroup>
    </SPage>
  );
}

// ------------------------------------------------------------------ Reading (R6-29O)
const AR_FONTS = ["Noto Naskh Arabic", "IBM Plex Sans Arabic", "Amiri"];
function ReadingR6() {
  const s = useSettings();
  const x = useSettings() as S & { arabicFont?: string; hyphenate?: boolean; codeWrap?: boolean };
  const { open, toggle } = useOpen();
  const width = s.measure === 0 ? "full" : s.measure >= 80 ? "wide" : "fixed";
  return (
    <SPage title={t("Reading")} sub={t("Text and layout for Read mode and the blog.")}>
      <SGroup>
        <SRow label={t("Reading font")} control={<SSeg label={t("Reading font")} value={s.readingFont} onChange={(v) => setSettings({ readingFont: v })} options={[{ value: "sans", label: t("Sans") }, { value: "serif", label: t("Serif") }, { value: "mono", label: t("Mono") }]} />} />
        <SRow label={t("Size")} value={t("{n} px", { n: s.fontSize })} onOpen={() => toggle("size")} />
        {open === "size" && <SEdit><input type="range" min={14} max={22} value={s.fontSize} aria-label={t("Size")} onChange={(e) => setSettings({ fontSize: Number(e.target.value) })} className="w-full accent-[var(--accent)]" /></SEdit>}
        <SRow label={t("Line width")} control={<SSeg label={t("Line width")} value={width} onChange={(v) => setSettings({ measure: v === "full" ? 0 : v === "wide" ? 80 : 68 })} options={[{ value: "fixed", label: t("Fixed") }, { value: "wide", label: t("Wide") }, { value: "full", label: t("Full") }]} />} />
        <SRow label={t("Arabic reading font")} value={x.arabicFont || AR_FONTS[0]} onOpen={() => toggle("ar")} />
        {open === "ar" && (
          <SEdit>{AR_FONTS.map((f) => <button key={f} onClick={() => { setSettings({ arabicFont: f } as unknown as Partial<S>); toggle("ar"); }} className={cx("flex h-9 items-center justify-between rounded-[8px] px-2.5 text-start hover:bg-surface-2", (x.arabicFont || AR_FONTS[0]) === f && "font-semibold")}><span>{f}</span><span dir="rtl" style={{ fontFamily: `'${f}', serif` }}>قراءة</span></button>)}</SEdit>
        )}
      </SGroup>
      <SAdvanced summary={t("Hyphenation · code wrap · read aloud")}>
        <SGroup>
          <SRow label={t("Hyphenation")} desc={t("Break long words at line ends in Read mode")} control={<SToggle on={!!x.hyphenate} onChange={(v) => setSettings({ hyphenate: v } as unknown as Partial<S>)} label={t("Hyphenation")} />} />
          <SRow label={t("Wrap code blocks")} desc={t("Long lines wrap instead of scrolling sideways")} control={<SToggle on={!!x.codeWrap} onChange={(v) => setSettings({ codeWrap: v } as unknown as Partial<S>)} label={t("Wrap code blocks")} />} />
        </SGroup>
        <Classic><ReadingSection /></Classic>
      </SAdvanced>
    </SPage>
  );
}

// ------------------------------------------------------------------ Study plan (R6-29P)
const WD = [tk("Sunday"), tk("Monday"), tk("Tuesday"), tk("Wednesday"), tk("Thursday"), tk("Friday"), tk("Saturday")];
function StudyR6() {
  const s = useSettings() as S & { planReviewsFirst?: boolean; srsAlgo?: "fsrs" | "sm2" };
  const { open, toggle } = useOpen();
  const rest = [0, 1, 2, 3, 4, 5, 6].filter((d) => !s.planStudyDays.includes(d));
  const chips = (vals: number[], cur: number, on: (v: number) => void, fmt: (v: number) => string) => (
    <SEdit><div className="flex flex-wrap gap-1.5">{vals.map((v) => <button key={v} onClick={() => on(v)} className={cx("h-8 rounded-[8px] border px-3", v === cur ? "border-accent font-semibold" : "border-line")}>{fmt(v)}</button>)}</div></SEdit>
  );
  return (
    <SPage title={t("Study plan")} sub={t("How Today builds your plan.")}>
      <SGroup>
        <SRow label={t("Daily goal")} value={t("{n} min", { n: s.planDailyMinutes })} onOpen={() => toggle("goal")} />
        {open === "goal" && chips([30, 45, 60, 90, 120, 180], s.planDailyMinutes, (v) => setSettings({ planDailyMinutes: v }), (v) => t("{n} min", { n: v }))}
        <SRow label={t("Reviews first")} desc={t("Due cards always come before new lessons")} control={<SToggle on={s.planReviewsFirst !== false} onChange={(v) => setSettings({ planReviewsFirst: v } as unknown as Partial<S>)} label={t("Reviews first")} />} />
        <SRow label={t("New lessons per day")} value={fmtNum(s.planMaxNew, G)} onOpen={() => toggle("new")} />
        {open === "new" && chips([0, 1, 2, 3, 4, 5], s.planMaxNew, (v) => setSettings({ planMaxNew: v }), (v) => fmtNum(v, G))}
        <SRow label={t("Rest day")} value={rest.length ? rest.map((d) => t(WD[d])).join(", ") : t("None")} onOpen={() => toggle("rest")} />
        {open === "rest" && (
          <SEdit><div className="flex flex-wrap gap-1.5">{WD.map((w, d) => { const off = rest.includes(d); return (
            <button key={w} aria-pressed={off} onClick={() => setSettings({ planStudyDays: off ? [...s.planStudyDays, d].sort() : s.planStudyDays.filter((x) => x !== d) })} className={cx("h-8 rounded-[8px] border px-3", off ? "border-accent font-semibold" : "border-line")}>{t(w)}</button>); })}</div></SEdit>
        )}
      </SGroup>
      <SGroup title={t("Review scheduling")}>
        <SRow label={t("Algorithm")} control={<SSeg label={t("Algorithm")} value={s.srsAlgo === "sm2" ? "sm2" : "fsrs"} onChange={(v) => setSettings({ srsAlgo: v } as unknown as Partial<S>)} options={[{ value: "sm2", label: "SM-2" }, { value: "fsrs", label: "FSRS" }]} />} />
        <SRow label={t("Target retention")} value={t("{n}%", { n: Math.round(s.retention * 100) })} onOpen={() => toggle("ret")} />
        {open === "ret" && chips([80, 85, 90, 93, 95], Math.round(s.retention * 100), (v) => setSettings({ retention: v / 100 }), (v) => t("{n}%", { n: v }))}
      </SGroup>
      <SAdvanced summary={t("Course order · study days · FSRS steps and optimizer")}>
        <Classic><StudyPlanSettings embedded /></Classic>
        <Classic><ReviewSettings /></Classic>
      </SAdvanced>
    </SPage>
  );
}

// ------------------------------------------------------------------ Diagrams + note tabs + big data (R6-29Q, Lumen 32 customize)
function DiagramsR6() {
  const p = useExtraPrefs();
  const tabs = useTabPrefs();
  const { open, toggle } = useOpen();
  const diagTab = tabs.tabs.find((x) => x.id === "diagrams")!;
  const setTab = (id: TabPref["id"], mode: TabPref["mode"]) => setTabPrefs({ tabs: tabs.tabs.map((x) => (x.id === id ? { ...x, mode } : x)) });
  const order = tabs.tabs.filter((x) => x.mode !== "off").map((x) => t(TAB_META[x.id].label)).join(" · ");
  return (
    <SPage title={t("Diagrams")} sub={t("Defaults for Mermaid, graphs and the Diagrams tab.")}>
      <SGroup>
        <SRow label={t("Show Diagrams tab")} desc={t("Only on notes with at least one diagram")} control={<SToggle on={diagTab.mode !== "off"} onChange={(v) => setTab("diagrams", v ? "content" : "off")} label={t("Show Diagrams tab")} />} />
        <SRow label={t("Default zoom")} control={<SSeg label={t("Default zoom")} value={p.diagramZoom} onChange={(v) => setExtraPrefs({ diagramZoom: v })} options={[{ value: "fit", label: t("Fit") }, { value: "100", label: "100%" }, { value: "fill", label: t("Fill") }]} />} />
        <SRow label={t("Edge style")} control={<SSeg label={t("Edge style")} value={p.diagramEdge} onChange={(v) => setExtraPrefs({ diagramEdge: v })} options={[{ value: "curved", label: t("Curved") }, { value: "elbow", label: t("Elbow") }, { value: "straight", label: t("Straight") }]} />} />
        <SRow label={t("Hand-drawn look")} control={<SToggle on={p.diagramHand} onChange={(v) => setExtraPrefs({ diagramHand: v })} label={t("Hand-drawn look")} />} />
      </SGroup>
      <SGroup title={t("Note tabs")}>
        <SRow label={t("Tab order")} desc={order} onOpen={() => toggle("tabs")} />
        {open === "tabs" && <SEdit><TabOrder /></SEdit>}
        <SRow label={t("Hide empty tabs")} control={<SToggle on={tabs.hideEmpty} onChange={(v) => setTabPrefs({ hideEmpty: v })} label={t("Hide empty tabs")} />} />
      </SGroup>
      <SAdvanced summary={t("Export defaults · big-data limits · assistant")}>
        <BigDataLimits />
        <AssistantDefaults />
        <Classic><DiagramsSection /></Classic>
      </SAdvanced>
    </SPage>
  );
}

/** Lumen 32 "Note tabs": drag (or Alt+↑/↓) to reorder, mode per tab. */
function TabOrder() {
  const { tabs } = useTabPrefs();
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => { if (to < 1 || to >= tabs.length || from < 1) return; const l = [...tabs]; const [x] = l.splice(from, 1); l.splice(to, 0, x); setTabPrefs({ tabs: l }); };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="leading-[18px] text-muted">{t("Drag to reorder. Off tabs never show; “Only when content” hides a tab on notes that have nothing for it.")}</span>
      {tabs.map((x, i) => {
        const m = TAB_META[x.id];
        return (
          <div key={x.id} draggable={i > 0} onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }} onDragEnd={() => setDrag(null)}
            tabIndex={0} onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); } if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); } }}
            className={cx("flex h-[46px] items-center gap-2.5 rounded-[9px] border bg-bg px-2.5 focus-visible:outline-2 focus-visible:outline-accent", drag === i ? "border-accent" : "border-line", x.mode === "off" && "opacity-55")}>
            <Glyph name="grip" size={14} color="var(--muted)" className={i > 0 ? "cursor-grab" : "opacity-30"} />
            <Glyph name={m.glyph} size={16} />
            <span className="flex-1 font-medium">{t(m.label)}</span>
            {m.modes.length > 1 ? (
              <select value={x.mode} onChange={(e) => setTabPrefs({ tabs: tabs.map((y) => (y.id === x.id ? { ...y, mode: e.target.value as TabPref["mode"] } : y)) })} className="bg-transparent text-[12px] text-muted" aria-label={t(m.label)}>
                {m.modes.map((mo) => <option key={mo} value={mo}>{t(MODE_LABEL[mo])}</option>)}
              </select>
            ) : <span className="text-[12px] text-muted">{t(MODE_LABEL[x.mode])}</span>}
          </div>
        );
      })}
    </div>
  );
}

const GV_LABEL: Record<GraphDefault, string> = { ask: tk("Ask when big"), full: tk("Full"), grouped: tk("Grouped"), tree: tk("Tree") };
function BigDataLimits() {
  const sc = useScale();
  const pick = <K extends keyof typeof OPTIONS>(k: K, fmt: (v: (typeof OPTIONS)[K][number]) => string) => (
    <select value={String(sc[k as keyof typeof sc])} onChange={(e) => setScale({ [k]: k === "graphDefault" ? e.target.value : Number(e.target.value) } as never)} className="h-7 rounded-[7px] border border-line bg-transparent px-2 text-[12px]" aria-label={String(k)}>
      {(OPTIONS[k] as readonly (string | number)[]).map((v) => <option key={String(v)} value={String(v)}>{fmt(v as never)}</option>)}
    </select>
  );
  return (
    <SGroup title={<span className="flex items-center gap-2"><Glyph name="graph" size={17} />{t("Big-data limits")}</span>}>
      <SRow label={t("Graph: default view")} desc={t("Full · Grouped · Tree · Ask when big")} control={pick("graphDefault", (v) => t(GV_LABEL[v as GraphDefault]))} />
      <SRow label={t("Graph: ask above")} desc={t("Shows the choice instead of drawing straight away")} control={pick("graphAsk", (v) => t("{n} notes", { n: fmtNum(v as number, G) }))} />
      <SRow label={t("Skill tree: topics per column")} desc={t("Rest behind “+N more”")} control={pick("topicsPerColumn", (v) => fmtNum(v as number, G))} />
      <SRow label={t("Folder: page size")} desc={t("“Show 200 more”")} control={pick("pageSize", (v) => fmtNum(v as number, G))} />
      <SRow label={t("Media tab: thumbnails at once")} desc={t("Lazy-loaded as you scroll")} control={pick("mediaBatch", (v) => fmtNum(v as number, G))} />
      <SRow label={t("Table: rows in Read mode")} desc={t("Then pages or “Open as base”")} control={pick("tableRows", (v) => fmtNum(v as number, G))} />
    </SGroup>
  );
}

function AssistantDefaults() {
  const a = useAssistantPrefs();
  return (
    <SGroup title={<span className="flex items-center gap-2"><Glyph name="assistant" size={17} color="var(--accent)" />{t("Assistant defaults")}</span>}>
      <SRow label={t("Opens")} control={<SSeg value={a.opens} onChange={(v) => setAssistantPrefs({ opens: v })} options={[{ value: "closed", label: t("Closed") }, { value: "panel", label: t("Right panel") }]} />} />
      <SRow label={t("Answer length")} control={<SSeg value={a.length} onChange={(v) => setAssistantPrefs({ length: v })} options={[{ value: "short", label: t("Short") }, { value: "normal", label: t("Normal") }, { value: "detailed", label: t("Detailed") }]} />} />
      <SRow label={t("Only from my notes")} control={<SToggle on={a.onlyMyNotes} onChange={(v) => setAssistantPrefs({ onlyMyNotes: v })} />} />
      <SRow label={t("Show citations")} control={<SToggle on={a.citations} onChange={(v) => setAssistantPrefs({ citations: v })} />} />
      <SRow label={t("Show cost on quick actions")} control={<SToggle on={a.showCost} onChange={(v) => setAssistantPrefs({ showCost: v })} />} />
      <SRow label={t("Language")} control={<SSeg value={a.language} onChange={(v) => setAssistantPrefs({ language: v })} options={[{ value: "match", label: t("Match note") }, { value: "en", label: "English" }, { value: "ar", label: "العربية" }]} />} />
    </SGroup>
  );
}

// ------------------------------------------------------------------ Sync (R6-29R)
function SyncR6() {
  const st = useSync();
  const v = useVault();
  const tok = getToken();
  const x = useSettings() as S & { syncMobile?: boolean; syncFiles?: "always" | "wifi" | "open" };
  const ok = st.status !== "error" && st.status !== "offline";
  const desc = !tok && !DEMO ? t("Off · this device only")
    : st.status === "syncing" ? t("Syncing…")
    : st.status === "error" ? (st.error || t("Sync failed"))
    : st.status === "offline" ? t("Offline · {n} changes waiting", { n: fmtNum(st.pending, G) })
    : t("Synced {ago} · {n} notes", { ago: st.last ? fmtRelative(st.last) : t("just now"), n: fmtNum(v.notes.length, G) });
  return (
    <SPage title={t("Sync")} sub={t("This device syncs with your own Cloudflare Worker.")}>
      <SGroup>
        <SRow label={t("Status")} desc={desc} glyph={ok ? "s-done" : "limit"} glyphColor={ok ? "var(--success)" : "var(--danger)"}
          control={tok || DEMO ? <SBtn primary onClick={() => void syncNow()}>{t("Sync now")}</SBtn> : <SBtn primary onClick={() => document.getElementById("r6-sync-classic")?.scrollIntoView({ behavior: "smooth" })}>{t("Unlock sync")}</SBtn>} />
        <SRow label={t("Sync on mobile data")} desc={t("Off: notes still sync; files wait for Wi-Fi")} control={<SToggle on={!!x.syncMobile} onChange={(v) => setSettings({ syncMobile: v } as unknown as Partial<S>)} label={t("Sync on mobile data")} />} />
        <SRow label={t("Sync files")} control={<SSeg label={t("Sync files")} value={x.syncFiles ?? "wifi"} onChange={(v) => setSettings({ syncFiles: v } as unknown as Partial<S>)} options={[{ value: "always", label: t("Always") }, { value: "wifi", label: t("On Wi-Fi") }, { value: "open", label: t("On open") }]} />} />
      </SGroup>
      <SAdvanced summary={t("Conflict policy · reset local cache")} defaultOpen={!tok && !DEMO}>
        <div id="r6-sync-classic"><Classic><SyncSection /></Classic></div>
        <SGroup><div className="px-3.5 py-3"><AppLockSetting /></div></SGroup>
      </SAdvanced>
    </SPage>
  );
}

// ------------------------------------------------------------------ Sharing (R6-29S)
function SharingR6({ go }: { go: (s: SecId) => void }) {
  const v = useVault();
  const { open, toggle } = useOpen();
  const [dlg, setDlg] = useState(false);
  const notes = v.notes.filter((n) => n.shareId), spaces = v.spaces.filter((x) => x.shareId);
  const links = notes.length + spaces.length;
  const posts = v.notes.filter((n) => n.published).length;
  return (
    <SPage title={t("Sharing")} sub={t("Everything reachable without your passcode.")}>
      <SGroup>
        <SRow label={t("Shared links")} value={fmtNum(links, G)} glyph="link" glyphColor="var(--info)" onOpen={() => toggle("links")} />
        {open === "links" && <SEdit><Classic><SharingSection /></Classic></SEdit>}
        <SRow label={t("Published posts")} value={fmtNum(posts, G)} glyph="post" glyphColor="var(--success)" onOpen={() => go("blog")} />
        <SRow label={t("Turn off all links")} control={<SBtn danger disabled={!links} onClick={() => setDlg(true)}>{t("Turn off")}</SBtn>} />
      </SGroup>
      {dlg && <Confirm danger title={t("Turn off all {n} links?", { n: links })} action={t("Turn off")} onClose={() => setDlg(false)}
        body={t("Anyone holding a link sees “This link was turned off”. Published blog posts stay up. You can share again any time; new links get a new address.")}
        onOk={async () => { for (const n of notes) await turnOffLink({ kind: "note", note: n }); for (const sp of spaces) await turnOffLink({ kind: "space", space: sp }); toast(t("All links turned off")); }} />}
    </SPage>
  );
}

// ------------------------------------------------------------------ Blog (R6-29T)
function BlogR6() {
  const v = useVault();
  const p = v.spaceMap.get(DEFAULT_SPACE)?.props ?? {};
  const { open, toggle } = useOpen();
  const posts = v.notes.filter((n) => n.published).length;
  const drafts = v.notes.filter((n) => !n.published && (n.props as Record<string, string> | undefined)?.draft === "1").length;
  const addr = (API_BASE || location.origin).replace(/^https?:\/\//, "") + "/blog";
  return (
    <SPage title={t("Blog")} sub={t("Your public site.")}>
      <SGroup>
        <SRow label={t("Address")} value={<span dir="ltr">{addr}</span>} valueColor="var(--link)" onOpen={() => window.open((API_BASE || location.origin) + "/blog", "_blank")} />
        <SRow label={t("RSS feed")} control={<SToggle on={p.rss !== "0"} onChange={(on) => void setInboxProps({ rss: on ? "1" : "0" })} label={t("RSS feed")} />} />
        <SRow label={t("Contact by email")} desc={p.contact ? t("Readers see “Email {who}” under each post.", { who: p.contact }) : t("Off. Readers can email you instead of commenting once you add an address.")} value={p.contact || undefined} onOpen={() => toggle("contact")} />
        {open === "contact" && <TextEdit value={p.contact ?? ""} placeholder="you@example.com" onSave={(x) => { void setInboxProps({ contact: x }); toggle("contact"); }} />}
        <SRow label={t("Posts")} value={t("{n} published · {d} drafts", { n: fmtNum(posts, G), d: fmtNum(drafts, G) })} onOpen={() => toggle("posts")} />
      </SGroup>
      {open === "posts" && <Classic><BlogSection /></Classic>}
    </SPage>
  );
}

// ------------------------------------------------------------------ Storage (R6-29U)
const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const size = (b: number) => (b >= GB ? `${(b / GB).toFixed(2)} GB` : b >= MB ? `${Math.round(b / MB)} MB` : `${Math.max(0, Math.round(b / KB))} KB`);
function StorageR6() {
  const tok = getToken();
  const { open, toggle } = useOpen();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [server, setServer] = useState<{ dbBytes: number | null; limitBytes: number; records: { bytes: number }; files: { bytes: number }; r2: { bytes: number } | null } | null>(null);
  useEffect(() => { navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {}); }, []);
  useEffect(() => { if (tok) api<typeof server>("/usage").then(setServer).catch(() => {}); }, [tok]);
  const atts = useLiveQuery(() => db.attachments.filter((a) => !a.deleted).toArray(), []) ?? [];
  const cloudUsed = server ? server.records.bytes + server.files.bytes + (server.r2?.bytes ?? 0) : atts.reduce((s, a) => s + (a.size || 0), 0);
  const limit = server?.limitBytes ?? 500_000_000;
  const largest = [...atts].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 5);
  const pct = cloudUsed / limit;
  return (
    <SPage title={t("Storage")} sub={t("Free Cloudflare D1 · 100 MB per file.")}>
      {pct >= 0.9 && (
        <div className="flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3" role="status" style={{ background: "color-mix(in srgb, var(--warning) 10%, transparent)", borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)" }}>
          <Glyph name="limit" size={16} color="var(--warning)" />
          <div className="flex flex-1 flex-col gap-0.5"><b className="font-semibold">{t("Storage almost full")}</b><span className="text-[12.5px] text-muted">{t("Uploads pause at {n}. Notes keep syncing — they're small.", { n: size(limit * 0.98) })}</span></div>
          <SBtn onClick={() => toggle("largest")}>{t("Review largest files")}</SBtn>
        </div>
      )}
      <SGroup>
        <SRow label={t("Cloudflare")} glyph="archive" glyphColor="var(--text)" value={t("{a} of {b}", { a: size(cloudUsed), b: size(limit) })} valueColor={pct >= 0.9 ? "var(--warning)" : undefined} onOpen={() => toggle("cloud")} />
        <SRow label={t("This device")} value={est ? size(est.usage) : "…"} onOpen={() => toggle("cloud")} />
        <SRow label={t("Largest files")} onOpen={() => toggle("largest")} />
        {open === "largest" && (
          <SEdit>{largest.length ? largest.map((a) => <div key={a.id} className="flex h-8 items-center gap-2"><Glyph name="media" size={14} color="var(--muted)" /><span className="flex-1 truncate" dir="auto">{a.name}</span><span className="text-muted">{size(a.size || 0)}</span></div>) : <span className="text-muted">{t("No files yet")}</span>}</SEdit>
        )}
      </SGroup>
      {open === "cloud" && <Classic><StorageSection usage={est} /></Classic>}
    </SPage>
  );
}

// ------------------------------------------------------------------ About (R6-29V)
const WHATS_NEW = [
  tk("Settings in one pattern, with an AI usage meter and an optional daily limit"),
  tk("Sidebar you can customise, resize and fold to a rail; keyboard map on ?"),
  tk("Big vaults: grouped and tree graph views, compact skill trees, long-list virtualisation"),
  tk("Access tokens with read-only access and expiry"),
];
const LICENCES = ["React · MIT", "Dexie · Apache-2.0", "markdown-it · MIT", "KaTeX · MIT", "Mermaid · MIT", "Excalidraw · MIT", "MiniSearch · MIT", "Hono · MIT", "Lucide · ISC", "Inter · OFL-1.1", "JetBrains Mono · OFL-1.1", "IBM Plex Sans Arabic · OFL-1.1"];
function AboutR6() {
  const { open, toggle } = useOpen();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      await reg?.update();
      const r = await fetch("/?v=" + Date.now(), { cache: "no-store" }).then((x) => x.text()).catch(() => "");
      const cur = [...document.scripts].map((s) => s.src).find((s) => /assets\/index-/.test(s));
      if (reg?.waiting || (cur && r && !r.includes(cur.split("/").pop()!))) toast(t("A new version is ready. Reload to update."), { label: t("Reload"), run: () => location.reload() });
      else toast(t("You're on the latest version."));
    } finally { setChecking(false); }
  };
  return (
    <SPage title={t("About")}>
      <SGroup>
        <SRow label="Lumen" desc={t("Version {v} · {d}", { v: APP_VERSION, d: fmtDate(Date.now(), { month: "short", year: "numeric" }) })} glyph="flame" glyphColor="var(--accent)" tile="#F2A93B"
          control={<SBtn onClick={() => void check()} disabled={checking}>{checking ? t("Checking…") : t("Check for updates")}</SBtn>} />
        <SRow label={t("What's new")} onOpen={() => toggle("new")} />
        {open === "new" && <SEdit><ul className="flex list-disc flex-col gap-1 ps-5">{WHATS_NEW.map((w) => <li key={w}>{t(w)}</li>)}</ul></SEdit>}
        <SRow label={t("Keyboard shortcuts")} value="?" onOpen={openKeyboardMap} />
        <SRow label={t("Open-source licences")} onOpen={() => toggle("lic")} />
        {open === "lic" && <SEdit><div className="grid grid-cols-2 gap-1 text-[12.5px] text-muted">{LICENCES.map((l) => <span key={l}>{l}</span>)}</div></SEdit>}
        <SRow label={t("Report a problem")} onOpen={() => { location.href = `mailto:?subject=${encodeURIComponent("Lumen problem report")}&body=${encodeURIComponent(`Version ${APP_VERSION}\n${navigator.userAgent}\n\nWhat happened:\n`)}`; }} />
      </SGroup>
    </SPage>
  );
}

