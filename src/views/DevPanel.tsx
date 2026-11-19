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
  if (!first) return null;
  return (
    <>
      {DEMO && <SimBanner />}
      {isOpen && <Drawer />}
    </>
  );
}

// ------------------------------------------------------------------ round 6 drawer (Lumen 29 · R6-29I / 29K)
/** What the simulator is faking right now (banner text); empty = nothing. */
function useFaked(): string[] {
  const f = useFaults();
  const dir = useUiDir();
  const cur = currentScenario();
  useSyncExternalStore(subscribe, () => open);
  const out: string[] = [];
  if (f.net === "offline") out.push("Offline");
  else if (f.net === "slow") out.push(`Slow sync (${Math.round(f.slowMs / 1000)} s)`);
  else if (f.net === "error") out.push("Sync error");
  else if (f.net === "unauthorized") out.push("Signed out (401)");
  else if (f.net === "upload-fail") out.push("Uploads failing");
  if (cur.id.startsWith("big-")) out.push(cur.name.replace("Big vault · ", "Big vault (") + ")");
  if (cur.id === "empty") out.push("Empty vault");
  if (dir === "rtl") out.push("RTL");
  if (f.ai === "quota") out.push("AI limit reached");
  else if (f.ai === "error") out.push("AI error 500");
  else if (f.ai === "mock") out.push("Mock AI");
  if (f.upload !== "ok") out.push(f.upload === "fail" ? "Upload fails" : "File too big");
  if (clockShifted()) out.push("Date " + new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", ""));
  return out;
}

async function resetAll() {
  resetFaults();
  setDemoClock(null);
  setUiDir("auto");
  const cur = currentScenario();
  if (cur.id.startsWith("big-") || cur.id === "empty") {
    const d = SCENARIOS.find((x) => x.id === "design");
    if (d) { await seedScenario(db, d); setTimeout(() => location.reload(), 300); }
  }
}

/** Amber banner across the top of the whole app while anything is faked. Sets body.sim-on (layout.css pushes the app down 30px). */
function SimBanner() {
  const faked = useFaked();
  const isOpen = useSyncExternalStore(subscribe, () => open);
  const on = faked.length > 0;
  useEffect(() => { document.body.classList.toggle("sim-on", on); return () => document.body.classList.remove("sim-on"); }, [on]);
  if (!on) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[70] flex h-[30px] items-center justify-center gap-2.5 overflow-hidden whitespace-nowrap px-3 text-[12px] text-ink" style={{ background: "color-mix(in srgb, var(--warning) 18%, var(--bg))", borderBottom: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)" }}>
      <Glyph name="simulator" size={14} color="var(--warning)" />
      <span className="truncate"><b className="font-semibold">Simulator on</b> · {faked.join(" · ")}</span>
      <button onClick={() => void resetAll()} className="shrink-0 text-link hover:underline">Reset all</button>
      {!isOpen && <button onClick={openDevPanel} className="shrink-0 text-muted hover:text-ink">Open</button>}
    </div>
  );
}

function MiniToggle({ on }: { on: boolean }) {
  return (
    <span className="relative h-4 w-7 shrink-0 rounded-[8px]" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-0.5 size-3 rounded-full" style={{ insetInlineStart: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </span>
  );
}

/** Bottom drawer: Network · Data · Look · Faults, then every other tool under "All tools". */
function Drawer() {
  const f = useFaults();
  const dir = useUiDir();
  const s = useSettings();
  const cur = currentScenario();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [conf, setConf] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const shifted = clockShifted();
  const load = async (id: string) => {
    const sc = SCENARIOS.find((x) => x.id === (cur.id === id ? "design" : id));
    if (!sc || busy) return;
    setBusy(true);
    try { await seedScenario(db, sc); toast(`Loaded “${sc.name}”`); setTimeout(() => location.reload(), 300); }
    catch (e) { setBusy(false); toast(`Seeding failed: ${(e as Error).message}`, undefined, { icon: "error" }); }
  };
  type Item = { l: string; on: boolean; v?: string; run: () => void };
  const groups: [string, Item[]][] = [
    ["Network", [
      { l: "Offline", on: f.net === "offline", run: () => setFaults({ net: f.net === "offline" ? "local" : "offline" }) },
      { l: "Slow sync · 3 s", on: f.net === "slow", run: () => setFaults(f.net === "slow" ? { net: "local" } : { net: "slow", slowMs: 3000 }) },
      { l: "Sync conflict", on: conf, run: () => { setConf(true); void conflict(true).then(() => toast("Conflict created on the open note")).catch((e) => toast((e as Error).message)).finally(() => setTimeout(() => setConf(false), 1500)); } },
    ]],
    ["Data", [
      { l: "Big vault · 3,000 notes", on: cur.id === "big-3k", run: () => void load("big-3k") },
      { l: "Empty vault", on: cur.id === "empty", run: () => void load("empty") },
      { l: "Dummy: student, 2 courses", on: cur.id === "study", run: () => void load("study") },
    ]],
    ["Look", [
      { l: "RTL · Arabic UI", on: dir === "rtl", run: () => setUiDir(dir === "rtl" ? "auto" : "rtl") },
      { l: "Paper theme", on: s.theme === "paper", run: () => setSettings({ theme: s.theme === "paper" ? "lamplight" : "paper" }) },
      { l: "Fake date", on: shifted, v: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", ""), run: () => { if (shifted) setDemoClock(null); else { const el = dateRef.current; if (el) { try { el.showPicker(); } catch { el.focus(); } } } } },
    ]],
    ["Faults", [
      { l: "AI limit reached", on: f.ai === "quota", run: () => setFaults({ ai: f.ai === "quota" ? "real" : "quota" }) },
      { l: "AI error 500", on: f.ai === "error", run: () => setFaults({ ai: f.ai === "error" ? "real" : "error" }) },
      { l: "Upload fails", on: f.upload === "fail", run: () => setFaults({ upload: f.upload === "fail" ? "ok" : "fail" }) },
    ]],
  ];
  return (
    <div role="dialog" aria-label="Simulator" className="safe-b fixed bottom-0 end-0 start-0 z-[60] flex flex-col border-t border-line bg-surface text-[13px] text-ink shadow-[0_-8px_24px_rgba(0,0,0,.25)] md:start-14" style={{ height: more ? "min(82dvh, 640px)" : undefined }}>
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Glyph name="simulator" size={16} color="var(--accent)" />
        <b className="font-semibold">Simulator</b>
        <span className="font-mono text-[12px] text-muted max-md:hidden">Ctrl+Shift+D</span>
        <span className="flex-1" />
        {DEMO && <button onClick={() => setMore(!more)} className="text-[12px] text-link">{more ? "Fewer tools" : "All tools"}</button>}
        <button aria-label="Close simulator" onClick={closeDevPanel} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink">⌄</button>
      </div>
      {!DEMO ? <div className="p-4"><Enter /></div> : (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 px-4 py-3 md:min-h-[218px] md:grid-cols-4">
            {groups.map(([h, items]) => (
              <div key={h} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{h}</span>
                {items.map((i) => (
                  <button key={i.l} role="switch" aria-checked={i.on} disabled={busy} onClick={i.run} className="flex h-[30px] items-center gap-2 text-start disabled:opacity-50">
                    <MiniToggle on={i.on} /><span className="min-w-0 flex-1 truncate">{i.l}</span>{i.v && i.on && <span className="text-[11.5px] text-muted">{i.v}</span>}
                  </button>
                ))}
              </div>
            ))}
            <input ref={dateRef} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute size-0 opacity-0"
              onChange={(e) => { const t = new Date(e.target.value + "T09:00:00").getTime(); if (t > 0) setDemoClock(t); }} />
          </div>
          {more && <div className="border-t border-line px-4 py-3"><Body /></div>}
        </div>
      )}
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
