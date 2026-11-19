// Settings › Sync › Devices (Lumen 20 · Access): devices that synced with this vault, rename / sign out / remove,
// the demo-mode and "sync paused" notes, and the passcode help sheet (forgot / change passcode).
// Backend: worker/ext/access.ts. Passcodes never pass through here.
import { useCallback, useEffect, useState } from "react";
import { Glyph } from "../components/Glyph";
import { Sheet } from "../components/ui";
import { getToken } from "../lib/api";
import { DEMO, setDemo } from "../lib/db";
import { deviceId, deviceName, listDevices, removeDevice, renameDevice, reportDevice, signOutDevice, type Device } from "../lib/devices";
import { go, toast } from "../lib/store";

const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Forgot / change the passcode: Lumen has one owner and no accounts, so the passcode is a Worker secret. */
export function PasscodeHelp({ open, onClose, change }: { open: boolean; onClose: () => void; change?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cmd = "wrangler secret put APP_PASSCODE";
  return (
    <Sheet open={open} onClose={onClose} title={change ? "Change passcode" : "Forgot passcode"}>
      <div className="flex flex-col gap-2.5 text-[13px]">
        <span className="leading-[19px]">Lumen has one owner and no accounts. To set a new passcode, run this in your project — <b className="font-semibold">no notes are lost</b>:</span>
        <button onClick={() => { void navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }} title="Copy"
          className="rounded-[8px] bg-surface p-2.5 text-start font-mono text-[12px] hover:bg-surface-2">{cmd}{copied && <span className="ms-2 font-sans text-muted">Copied</span>}</button>
        {change && <span className="leading-[19px] text-muted">Every device that holds the old passcode's token stops syncing and shows “Token expired” in Devices. Unlock each one again with the new passcode.</span>}
        <span className="text-[12.5px] text-muted">Notes on this device stay readable offline meanwhile.</span>
      </div>
    </Sheet>
  );
}

export function DevicesPanel() {
  const signed = !!getToken();
  const [list, setList] = useState<Device[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [help, setHelp] = useState<null | "forgot" | "change">(null);
  const me = deviceId();
  const load = useCallback(async () => {
    if (!signed || DEMO) return;
    try { await reportDevice(true); setList(await listDevices()); setErr(null); } catch (e) { setErr((e as Error).message); }
  }, [signed]);
  useEffect(() => { void load(); }, [load]);

  const rows: Device[] = DEMO
    ? [{ id: me, name: deviceName(), platform: "", firstSeen: Date.now(), unlockedAt: Date.now() - 17 * 864e5, lastSeen: Date.now() - 120e3, expired: false, signingOut: false }]
    : list ?? [];
  const act = async (d: Device, kind: "out" | "rm") => {
    setConfirm(null);
    try {
      if (kind === "out") { await signOutDevice(d.id); toast(`${d.name} signs out the next time it connects`); }
      else { await removeDevice(d.id); toast(`${d.name} removed`); }
      await load();
    } catch (e) { toast((e as Error).message); }
  };
  const saveName = async (d: Device) => {
    const n = name.trim();
    setEditing(null);
    if (!n || n === d.name) return;
    try { await renameDevice(d.id, n); await load(); } catch (e) { toast((e as Error).message); }
  };

  return (
    <section aria-label="Devices" className="flex flex-col gap-2 rounded-[14px] border border-line bg-bg p-[18px] text-[13px]">
      <div className="flex items-center">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[.08em] text-muted">Devices</span>
        <button onClick={() => setHelp("change")} className="text-[12.5px] text-link hover:underline">Change passcode</button>
      </div>
      {signed && !DEMO && !list && !err && <span className="py-2 text-muted">Loading devices…</span>}
      {err && <span className="py-2 text-muted">Couldn't load devices · {err}</span>}
      {rows.map((d) => {
        const mine = d.id === me;
        return (
          <div key={d.id} className="flex min-h-[44px] items-center gap-2.5 border-t border-line">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: d.expired ? "var(--warning)" : "var(--success)" }} />
            <div className="flex min-w-0 flex-1 flex-col py-1">
              {editing === d.id ? (
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Device name" maxLength={60}
                  onBlur={() => void saveName(d)} onKeyDown={(e) => { if (e.key === "Enter") void saveName(d); if (e.key === "Escape") setEditing(null); }}
                  className="h-7 rounded-[6px] border border-accent bg-transparent px-1.5 font-medium text-ink outline-none" />
              ) : (
                <button onClick={() => { setEditing(d.id); setName(d.name); }} title="Rename" className="truncate text-start font-medium hover:underline">{d.name}{mine ? " · this device" : ""}</button>
              )}
              <span className="text-[12px] text-muted">{d.signingOut ? "Signs out the next time it connects" : d.expired ? `Token expired · last seen ${day(d.lastSeen)}` : `Unlocked ${day(d.unlockedAt)} · synced ${ago(d.lastSeen)}`}</span>
            </div>
            {!mine && !d.signingOut && (confirm === d.id ? (
              <span className="flex items-center gap-2 text-[12.5px]">
                <span className="text-muted">{d.expired ? "Remove?" : "Sign out?"}</span>
                <button onClick={() => void act(d, d.expired ? "rm" : "out")} className="font-semibold text-bad">Yes</button>
                <button onClick={() => setConfirm(null)} className="text-muted hover:text-ink">No</button>
              </span>
            ) : (
              <button onClick={() => setConfirm(d.id)} className="text-[12.5px] text-bad hover:underline">{d.expired ? "Remove" : "Sign out"}</button>
            ))}
          </div>
        );
      })}
      {DEMO && (
        <div className="flex gap-2 pt-1.5">
          <div className="flex-1 rounded-[10px] px-2.5 py-2 text-[12.5px] leading-[18px]" style={{ background: "color-mix(in srgb, var(--info) 10%, transparent)" }}>
            Demo mode (?demo=1): sample data, never syncs. <button onClick={() => setDemo(false)} className="text-link hover:underline">Leave demo</button>
          </div>
        </div>
      )}
      {!signed && !DEMO && (
        <div className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2 text-[12.5px]">
          <Glyph name="s-locked" size={14} color="var(--warning)" />
          <span className="flex-1">Sync paused · this device's token expired.</span>
          <button onClick={() => { go("settings"); document.querySelector<HTMLButtonElement>("[data-unlock-account]")?.click(); }} className="text-link hover:underline">Unlock again</button>
        </div>
      )}
      <button onClick={() => setHelp("forgot")} className="self-start pt-1 text-[12.5px] text-link hover:underline">Forgot the passcode?</button>
      <PasscodeHelp open={!!help} change={help === "change"} onClose={() => setHelp(null)} />
    </section>
  );
}
