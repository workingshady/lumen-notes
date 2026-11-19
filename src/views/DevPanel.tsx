// Dev simulator panel: switch dummy-data scenarios, inject network/AI/upload faults and move the demo clock.
// Open with openDevPanel(), Ctrl+Shift+D (registered in main.tsx) or the URL ?dev=panel. See docs/DEV_SIMULATOR.md.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Glyph } from "../components/Glyph";
import { setUiDir, useUiDir } from "../components/ws-dir";
import { setSettings, useSettings } from "../lib/settings";
import { db, DEMO, setDemo } from "../lib/db";
import { clockShifted, setDemoClock, shiftDemoClock } from "../lib/demo-clock";
import { exportBackup, exportVaultZip } from "../lib/io";
import { currentScenario, SCENARIOS, seedScenario, tableCounts, type Scenario } from "../lib/sim";
import { DEFAULT_FAULTS, resetFaults, setFaults, useFaults, type AiMode, type NetMode, type UploadMode } from "../lib/sim/faults";
import { getUI, toast } from "../lib/store";
import { Button, cx, inputCls } from "../components/ui";

// ------------------------------------------------------------------ open state + single host
let open = false;
let hosts: string[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export function openDevPanel() { open = true; emit(); }
export function closeDevPanel() { open = false; emit(); }
export const toggleDevPanel = () => (open ? closeDevPanel() : openDevPanel());

/** Mount anywhere (several mounts are fine: only the first one renders). */
export function DevPanel() {
  const id = useId();
  const isOpen = useSyncExternalStore(subscribe, () => open);
  const first = useSyncExternalStore(subscribe, () => hosts[0] === id);
  useEffect(() => {
    hosts = [...hosts, id];
    emit();
    return () => { hosts = hosts.filter((h) => h !== id); emit(); };
  }, [id]);
  useEffect(() => {
    if (!isOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeDevPanel(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [isOpen]);
  if (!first || !isOpen) return null;
  // Developer › Simulator (Lumen 20 · A14): a bottom drawer to test the app.
  return (
    <div className="fixed inset-0 z-[60] bg-[rgba(5,6,8,.45)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && closeDevPanel()}>
      <div role="dialog" aria-label="Simulator" className="sheet-in safe-b absolute inset-x-0 bottom-0 mx-auto flex max-h-[82dvh] w-full max-w-[760px] flex-col rounded-t-[14px] border border-b-0 border-line bg-surface text-[13px]">
        <div className="flex justify-center pt-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex items-center gap-2 px-[18px] pb-1 pt-2">
          <span className="flex-1 text-[15px] font-[650]">Simulator</span>
          <button aria-label="Close simulator" onClick={closeDevPanel} className="flex size-8 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={15} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto px-[18px] pb-[18px]">{DEMO ? <Body /> : <Enter />}</div>
      </div>
    </div>
  );
}

/** The quick toggles row (design: Date, Offline, Slow sync, big vault, RTL, Paper): 28px chips, accent when on. */
function QuickToggles({ onBig, busy }: { onBig: () => void; busy: boolean }) {
  const faults = useFaults();
  const dir = useUiDir();
  const s = useSettings();
  const dateRef = useRef<HTMLInputElement>(null);
  const cur = currentScenario();
  const paper = s.theme === "paper";
  const shifted = clockShifted();
  const chip = (on: boolean) => cx("flex h-7 items-center rounded-[7px] border px-2.5 text-[12.5px]", on ? "border-accent" : "border-line hover:bg-surface-2");
  const bg = (on: boolean) => (on ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined);
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick toggles">
      <span className="relative">
        <button aria-pressed={shifted} className={chip(shifted)} style={bg(shifted)} onClick={() => { const el = dateRef.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); } }}>Date: {date}</button>
        <input ref={dateRef} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0"
          onChange={(e) => { const t = new Date(e.target.value + "T12:00:00").getTime(); if (t > 0) setDemoClock(t); }} />
      </span>
      <button aria-pressed={faults.net === "offline"} className={chip(faults.net === "offline")} style={bg(faults.net === "offline")} onClick={() => setFaults({ net: faults.net === "offline" ? "local" : "offline" })}>Offline</button>
      <button aria-pressed={faults.net === "slow"} className={chip(faults.net === "slow")} style={bg(faults.net === "slow")} onClick={() => setFaults({ net: faults.net === "slow" ? "local" : "slow" })}>Slow sync</button>
      <button aria-pressed={cur.id === "big-1k"} disabled={busy} className={chip(cur.id === "big-1k")} style={bg(cur.id === "big-1k")} onClick={onBig} title="Load the big vault scenario">1,000 notes</button>
      <button aria-pressed={dir === "rtl"} className={chip(dir === "rtl")} style={bg(dir === "rtl")} onClick={() => setUiDir(dir === "rtl" ? "auto" : "rtl")}>RTL</button>
      <button aria-pressed={paper} className={chip(paper)} style={bg(paper)} onClick={() => setSettings({ theme: paper ? "lamplight" : "paper" })}>Paper</button>
    </div>
  );
}

function Enter() {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-muted">The simulator works in demo mode: a separate local database (<code>lumen-demo</code>) filled with dummy data. Your real notes are not touched and demo data never syncs.</p>
      <div><Button variant="primary" onClick={() => { try { localStorage.setItem("lumen.demo", "1"); } catch { /* ignore */ } location.href = location.pathname + "?dev=panel"; }}>Enter dev mode</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ body
function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-[13px] font-semibold">{title}</h3>{hint && <span className="text-[11.5px] text-muted">{hint}</span>}</div>
      {children}
    </section>
  );
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cx("h-7 rounded-[7px] border px-2.5 text-[12.5px] transition-colors", value === v ? "border-accent text-ink" : "border-line text-muted hover:bg-surface-2 hover:text-ink")}
          style={value === v ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)" } : undefined}>
          {label}
        </button>
      ))}
    </div>
  );
}

const NET: [NetMode, string][] = [["local", "Local (default)"], ["online", "Online · synced"], ["offline", "Offline"], ["error", "Sync error"], ["slow", "Slow sync"], ["upload-fail", "Upload failing"], ["unauthorized", "API 401 · signed out"]];
const AI: [AiMode, string][] = [["real", "Real"], ["mock", "Mock answer"], ["quota", "Quota exceeded"], ["error", "AI error"]];
const UPLOAD: [UploadMode, string][] = [["ok", "OK"], ["fail", "Upload fails"], ["too-big", "File too big"]];

function Body() {
  const cur = currentScenario();
  const [busy, setBusy] = useState<string | null>(null);
  const faults = useFaults();
  const counts = useLiveQuery(() => tableCounts(db), []);
  const [custom, setCustom] = useState(() => toLocalInput(Date.now()));

  async function load(s: Scenario) {
    setBusy(s.id);
    try {
      const t = performance.now();
      await seedScenario(db, s);
      toast(`Loaded “${s.name}” in ${Math.round(performance.now() - t)} ms`);
      setTimeout(() => location.reload(), 300);
    } catch (e) {
      setBusy(null);
      toast(`Seeding failed: ${(e as Error).message}`, undefined, { icon: "error" });
    }
  }
  async function run(label: string, f: () => Promise<unknown>) {
    try { await f(); toast(label); } catch (e) { toast(`${label} failed: ${(e as Error).message}`, undefined, { icon: "error" }); }
  }

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <span className="leading-[18px] text-muted">Bottom drawer to test the app: fake date, offline, slow sync, big vault, RTL, Paper. Dummy data lives in the separate <code>lumen-demo</code> database and never syncs.</span>
      <QuickToggles busy={!!busy} onBig={() => { const big = SCENARIOS.find((x) => x.id === (cur.id === "big-1k" ? "design" : "big-1k")); if (big) void load(big); }} />

      <Section title="Scenario" hint={<>Current: <b className="text-ink">{cur.name}</b></>}>
        <ul className="flex flex-col gap-1.5">
          {SCENARIOS.map((s) => (
            <li key={s.id} className={cx("flex items-center gap-3 rounded-[10px] border px-3 py-2", s.id === cur.id ? "border-accent" : "border-line")} style={s.id === cur.id ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{s.name}{s.id === cur.id && <span className="ml-2 text-[11px] font-normal text-accent">loaded</span>}</div>
                <div className="text-[12px] leading-[17px] text-muted">{s.description}</div>
              </div>
              <button disabled={!!busy} onClick={() => void load(s)} data-scenario={s.id} className="h-7 shrink-0 rounded-[7px] border border-line px-2.5 text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-50">
                {busy === s.id ? "Seeding…" : s.id === cur.id ? "Reload" : "Load"}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Records" hint="live counts in lumen-demo">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" data-testid="sim-counts">
          {counts ? Object.entries(counts).map(([k, n]) => (
            <div key={k} className="rounded-[8px] bg-surface-2 px-2 py-1.5" data-count={k}>
              <div className="text-[15px] font-semibold tabular-nums">{n.toLocaleString()}</div>
              <div className="text-[11px] text-muted">{k}</div>
            </div>
          )) : <div className="text-muted">Counting…</div>}
        </div>
      </Section>

      <Section title="Network & sync" hint="status bar / sync indicator follow this">
        <Pills value={faults.net} options={NET} onChange={(net) => setFaults({ net })} />
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">Queued records
            <input type="number" min={0} className={cx(inputCls, "h-7 w-20")} value={faults.queued} onChange={(e) => setFaults({ queued: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">Slow delay (ms)
            <input type="number" min={0} step={500} className={cx(inputCls, "h-7 w-24")} value={faults.slowMs} onChange={(e) => setFaults({ slowMs: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
      </Section>

      <Section title="AI" hint="/api/ai and /api/transcribe">
        <Pills value={faults.ai} options={AI} onChange={(ai) => setFaults({ ai })} />
      </Section>

      <Section title="Uploads" hint="new attachments (paste / drop / pick)">
        <Pills value={faults.upload} options={UPLOAD} onChange={(upload) => setFaults({ upload })} />
      </Section>

      <Section title="Clock" hint={<>{new Date().toLocaleString()}{clockShifted() && <span className="ml-1 text-accent">· time-travelled</span>}</>}>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => shiftDemoClock(-86_400_000)}>−1 day</Button>
          <Button size="sm" onClick={() => shiftDemoClock(3_600_000)}>+1 hour</Button>
          <Button size="sm" onClick={() => shiftDemoClock(86_400_000)}>+1 day</Button>
          <Button size="sm" onClick={() => shiftDemoClock(7 * 86_400_000)}>+1 week</Button>
          <Button size="sm" onClick={() => shiftDemoClock(30 * 86_400_000)}>+30 days</Button>
          <Button size="sm" variant="ghost" onClick={() => setDemoClock(null)}>Reset to design moment</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" className={cx(inputCls, "h-7 w-auto")} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button size="sm" onClick={() => { const t = new Date(custom).getTime(); if (t > 0) setDemoClock(t); }}>Set date</Button>
        </div>
      </Section>

      <Section title="Sync conflict" hint="fires the real conflict middleware">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => void run("Simulated conflict: remote newer", () => conflict(true))}>Incoming newer remote edit</Button>
          <Button size="sm" onClick={() => void run("Simulated conflict: local newer", () => conflict(false))}>Incoming older remote edit</Button>
        </div>
        <div className="text-[11.5px] text-muted">Uses the open note (or the first note). A losing copy is saved to history and a “Kept newer version · View other” toast appears.</div>
      </Section>

      <Section title="Demo database">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={!!busy} onClick={() => void load(cur)}>Reset demo DB</Button>
          <Button size="sm" onClick={() => void run("Exported zip", () => exportVaultZip())}>Export zip</Button>
          <Button size="sm" onClick={() => void run("Exported JSON", () => exportBackup())}>Export JSON</Button>
          <Button size="sm" variant="ghost" onClick={() => resetFaults()} disabled={JSON.stringify(faults) === JSON.stringify(DEFAULT_FAULTS)}>Clear all faults</Button>
          <Button size="sm" variant="danger" onClick={() => setDemo(false)}>Exit dev mode</Button>
        </div>
      </Section>
    </div>
  );
}

async function conflict(remoteNewer: boolean) {
  const { simulateConflict } = await import("../lib/sim/hooks");
  const id = getUI().noteId ?? (await db.notes.where("deleted").equals(0).filter((n) => n.type !== "canvas" && n.type !== "whiteboard").first())?.id;
  if (!id) throw new Error("no note to conflict on");
  await simulateConflict(id, remoteNewer);
}

function toLocalInput(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
