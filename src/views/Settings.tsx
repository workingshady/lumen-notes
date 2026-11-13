import { useLiveQuery } from "dexie-react-hooks";
import { Check, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { API_BASE, api, getToken, login, setToken } from "../lib/api";
import { db, DEFAULT_SPACE, patch } from "../lib/db";
import { exportBackup } from "../lib/io";
import { setSettings, THEMES, useSettings, type Settings as S } from "../lib/settings";
import { setUI, toast, useVault } from "../lib/store";
import { syncNow, useSync } from "../lib/sync";
import { Button, cx, Field, inputCls, Segmented } from "../components/ui";

const Section = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <section className="rounded-[14px] border border-line bg-surface p-4">
    <div className="mb-3"><div className="font-semibold">{title}</div>{hint && <div className="text-[12.5px] text-muted">{hint}</div>}</div>
    <div className="space-y-3">{children}</div>
  </section>
);

/** Branding also lives on the Inbox space so it syncs and the public blog can read it. */
async function saveBranding(s: S) {
  const inbox = await db.spaces.get(DEFAULT_SPACE);
  if (!inbox) return;
  const props = { ...inbox.props, blogName: s.blogName, tagline: s.tagline, author: s.author, avatar: s.avatar };
  if (JSON.stringify(props) !== JSON.stringify(inbox.props)) await patch("space", DEFAULT_SPACE, { props });
}

export function SettingsView() {
  const s = useSettings();
  const set = (p: Partial<S>) => setSettings(p);
  const vault = useVault();
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
  return (
    <div className="h-full overflow-y-auto">
      <div className="safe-t mx-auto max-w-2xl space-y-4 p-4 md:p-8">
        <h1 className="text-[22px] font-bold">Settings</h1>

        <Section title="Appearance">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <button onClick={() => set({ theme: "auto" })} className={cx("rounded-[10px] border p-2 text-left text-[12.5px]", s.theme === "auto" ? "border-accent ring-1 ring-accent" : "border-line")}>
              <div className="mb-1.5 flex h-10 overflow-hidden rounded-md"><div className="flex-1 bg-[#0F1115]" /><div className="flex-1 bg-[#FAF8F3]" /></div>Auto
            </button>
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => set({ theme: t.id })} className={cx("rounded-[10px] border p-2 text-left text-[12.5px]", s.theme === t.id ? "border-accent ring-1 ring-accent" : "border-line")}>
                <div className="mb-1.5 flex h-10 items-end gap-1 rounded-md p-1.5" style={{ background: t.vars.bg }}>
                  <span className="h-2 flex-1 rounded" style={{ background: t.vars.surface }} /><span className="size-3 rounded-full" style={{ background: t.vars.accent }} />
                </div>{t.name}
              </button>
            ))}
          </div>
          <Field label={`Accent hue ${s.accentHue === null ? "(theme default)" : s.accentHue + "°"}`}>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={360} value={s.accentHue ?? 70} onChange={(e) => set({ accentHue: Number(e.target.value) })} className="h-2 flex-1 cursor-pointer appearance-none rounded-full"
                style={{ background: "linear-gradient(90deg, oklch(.75 .14 0), oklch(.75 .14 60), oklch(.75 .14 120), oklch(.75 .14 180), oklch(.75 .14 240), oklch(.75 .14 300), oklch(.75 .14 360))" }} />
              <Button size="sm" variant="ghost" onClick={() => set({ accentHue: null })}>Reset</Button>
            </div>
          </Field>
          <Field label="Reading font"><Segmented value={s.readingFont} onChange={(v) => set({ readingFont: v })} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: <span style={{ fontFamily: "'Source Serif 4', serif" }}>Serif</span> }, { value: "mono", label: <span className="font-mono">Mono</span> }]} /></Field>
          <Field label={`Text size ${s.fontSize}px`}><input type="range" min={14} max={22} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} className="w-full accent-[var(--accent)]" /></Field>
          <Field label="Line width"><Segmented value={String(s.measure)} onChange={(v) => set({ measure: Number(v) as S["measure"] })} options={[{ value: "60", label: "Narrow" }, { value: "68", label: "Comfort" }, { value: "80", label: "Wide" }, { value: "0", label: "Full" }]} /></Field>
          <Field label="Density"><Segmented value={s.density} onChange={(v) => set({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></Field>
          <div className="prose rounded-[10px] border border-line bg-bg p-4 !max-w-none"><h3 className="!mt-0">Preview: gradient descent</h3><p>We update <code>θ</code> by stepping against the gradient. Read <a href="#" onClick={(e) => e.preventDefault()}>more</a>.</p></div>
        </Section>

        <Section title="Branding" hint="Shown on your public blog and the Home screen. Synced with your notes.">
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <Field label="Avatar"><input className={inputCls + " text-center"} value={s.avatar} onChange={(e) => set({ avatar: e.target.value.slice(0, 4) })} /></Field>
            <Field label="Your name"><input className={inputCls} value={s.author} onChange={(e) => set({ author: e.target.value })} /></Field>
          </div>
          <Field label="Blog name"><input className={inputCls} value={s.blogName} onChange={(e) => set({ blogName: e.target.value })} /></Field>
          <Field label="Tagline"><input className={inputCls} value={s.tagline} onChange={(e) => set({ tagline: e.target.value })} /></Field>
        </Section>

        <SyncSection />

        <Section title="Editor & organization">
          <label className="flex items-center justify-between text-[13.5px]"><span>Spellcheck</span><input type="checkbox" checked={s.spellcheck} onChange={(e) => set({ spellcheck: e.target.checked })} className="size-4 accent-[var(--accent)]" /></label>
          <label className="flex items-center justify-between text-[13.5px]"><span>Johnny-Decimal sorting <span className="block text-[12px] text-muted">Sort folders by their number prefix (10-19 Area / 11 Category / 11.01)</span></span><input type="checkbox" checked={s.johnnyDecimal} onChange={(e) => set({ johnnyDecimal: e.target.checked })} className="size-4 accent-[var(--accent)]" /></label>
        </Section>

        <DataSection />
        <p className="pb-8 text-center text-[12px] text-muted">Lumen · local-first notes · JSON Canvas 1.0 · Markdown in, Markdown out</p>
      </div>
    </div>
  );
}

function SyncSection() {
  const st = useSync();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ r2: boolean; ai: boolean } | null>(null);
  const tok = getToken();
  useEffect(() => { if (tok) api<{ r2: boolean; ai: boolean }>("/health").then(setHealth).catch(() => {}); }, [tok]);
  return (
    <Section title="Sync & cloud" hint="Notes always save on this device first. Unlock sync to back them up to Cloudflare and use them on every device.">
      {tok ? (
        <>
          <div className="flex items-center gap-2 text-[13.5px]"><Check size={16} className="text-ok" /> Sync on · {st.status}{st.last ? ` · last ${new Date(st.last).toLocaleTimeString()}` : ""}{st.pending ? ` · ${st.pending} pending` : ""}</div>
          {st.error && <div className="text-[12.5px] text-bad">{st.error}</div>}
          {health && <div className="text-[12.5px] text-muted">Server: {API_BASE || location.host} · files in {health.r2 ? "R2" : "D1 (enable R2 for files over 1.9 MB)"} · AI {health.ai ? "on" : "off"}</div>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void syncNow()}>{st.status === "syncing" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</Button>
            <Button size="sm" variant="ghost" onClick={() => { setToken(null); void syncNow(); toast("Sync locked on this device. Your notes stay here."); }}><LogOut size={14} /> Lock</Button>
          </div>
        </>
      ) : (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await login(pass); setPass(""); toast("Sync unlocked"); await syncNow(); } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
        }}>
          <input type="password" autoComplete="current-password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" />
          <Button variant="primary" disabled={!pass || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : "Unlock"}</Button>
        </form>
      )}
    </Section>
  );
}

function DataSection() {
  const v = useVault();
  const versions = useLiveQuery(() => db.versions.count(), []) ?? 0;
  const blobs = useLiveQuery(() => db.blobs.toArray(), []) ?? [];
  const [est, setEst] = useState<string>("");
  useEffect(() => { navigator.storage?.estimate?.().then((e) => setEst(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used on this device`)); }, []);
  return (
    <Section title="Data">
      <div className="text-[13px] text-muted">{v.notes.length} notes · {v.folders.length} folders · {v.spaces.length} spaces · {versions} versions · {blobs.length} files. {est}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setUI({ io: true })}>Import / export…</Button>
        <Button size="sm" onClick={() => exportBackup()}>Download backup</Button>
        <Button size="sm" variant="ghost" onClick={async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? "Storage marked persistent" : "Browser declined persistent storage"); }}>Keep data persistent</Button>
      </div>
    </Section>
  );
}
