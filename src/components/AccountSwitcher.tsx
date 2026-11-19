import { Check, KeyRound, Loader2, Plus, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { accountLabel, forgetAccount, getAccount, getToken, savedAccounts, switchAccount, type SavedAccount } from "../lib/api";
import { unlockWithServer } from "../lib/home-lock";
import { PasscodeHelp } from "../views/settings-devices";
import { syncNow } from "../lib/sync";
import { toast } from "../lib/store";
import { Button, cx } from "./ui";

/** Saved accounts on this device, live (updates when one is added, switched or forgotten, also from other tabs). */
export function useSavedAccounts(): SavedAccount[] {
  const [list, setList] = useState(savedAccounts);
  useEffect(() => {
    const up = () => setList(savedAccounts());
    addEventListener("lumen:accounts", up);
    addEventListener("storage", up);
    return () => { removeEventListener("lumen:accounts", up); removeEventListener("storage", up); };
  }, []);
  return list;
}

const tint = (id: string) => (id === "main" ? "#39C5CF" : id === "roadmap" ? "#E8893A" : "#A371F7");
function Avatar({ id, size = 28 }: { id: string; size?: number }) {
  const c = tint(id);
  return <span className="flex shrink-0 items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.42, color: c, background: `color-mix(in srgb, ${c} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 45%, transparent)` }}>{accountLabel(id)[0]?.toUpperCase()}</span>;
}

/**
 * Accounts on this device: the current one, one-click Switch for the others (each keeps its own notes; the app
 * reloads), Forget, and Add account (passcode once, remembered by default). Passcodes are never stored, only the
 * sign-in token the server issued for that passcode.
 */
export function AccountSwitcher({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const list = useSavedAccounts();
  const cur = getAccount();
  const signedIn = !!getToken();
  const [adding, setAdding] = useState(false);
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  // Lumen 20 · "Unlock · wrong passcode, lockout": tries left, then a lockout countdown (server: worker/ext/home.ts /unlock)
  const [wrong, setWrong] = useState<{ left?: number; error: string } | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [help, setHelp] = useState(false);
  useEffect(() => { if (lockedUntil <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [lockedUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const accounts = [...list].sort((a, b) => (a.id === cur ? -1 : b.id === cur ? 1 : b.lastUsed - a.lastUsed));
  if (!accounts.some((a) => a.id === cur)) accounts.unshift({ id: cur, token: "", savedAt: 0, lastUsed: 0 });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockLeft) return;
    setBusy(true);
    try {
      const r = await unlockWithServer(pass);
      if (!r.ok) {
        if (r.retryAfterSec) { setLockedUntil(Date.now() + r.retryAfterSec * 1000); setNow(Date.now()); setWrong(null); }
        else setWrong({ left: r.attemptsLeft, error: r.error });
        return;
      }
      if (!remember) forgetAccount(getAccount());
      setPass(""); setAdding(false); setWrong(null);
      toast("Signed in");
      await syncNow();
      onDone?.();
    } finally { setBusy(false); }
  };

  const row = cx("flex items-center gap-2.5 rounded-[8px]", compact ? "px-2 py-1.5" : "px-2.5 py-2");
  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      {accounts.map((a) => {
        const isCur = a.id === cur;
        return (
          <div key={a.id} className={cx(row, isCur ? "bg-surface-2" : "hover:bg-surface-2")}>
            <Avatar id={a.id} size={compact ? 22 : 28} />
            <div className="min-w-0 flex-1">
              <div className={cx("truncate font-medium", compact ? "text-[13px]" : "text-[13.5px]")}>{accountLabel(a.id)}</div>
              {!compact && <div className="text-[11.5px] text-muted">{isCur ? (signedIn ? "Open on this device · syncing" : "Open on this device · locked") : a.token ? "Saved · switch without a passcode" : "Not saved"}</div>}
            </div>
            {isCur ? <Check size={15} className="shrink-0 text-ok" /> : (
              <button className="shrink-0 rounded-[7px] border border-line px-2 py-1 text-[12px] font-medium hover:border-accent hover:text-accent" onClick={() => { onDone?.(); switchAccount(a.id); }}>Switch</button>
            )}
            {!compact && a.token && (
              <button className="shrink-0 text-muted hover:text-bad" title={isCur ? "Sign out and forget this account on this device" : "Forget this account on this device"}
                onClick={() => {
                  if (!confirm(`Forget “${accountLabel(a.id)}” on this device? Its notes stay on the server; you'll need its passcode to open it here again.`)) return;
                  forgetAccount(a.id);
                  if (isCur) { localStorage.removeItem("lumen.token"); void syncNow(); }
                  toast(`${accountLabel(a.id)} forgotten on this device`);
                }}><X size={15} /></button>
            )}
          </div>
        );
      })}
      {adding ? (
        <form onSubmit={(e) => void add(e)} className={cx("flex flex-col gap-2 rounded-[8px] border border-line", compact ? "p-2" : "p-3")}>
          <div className="flex items-center gap-2 text-[12.5px] text-muted"><KeyRound size={13} />Passcode of the account to add (or of this one, to unlock)</div>
          <div className="flex gap-2">
            <input autoFocus type="password" autoComplete="current-password" value={pass} onChange={(e) => { setPass(e.target.value); setWrong(null); }} placeholder="Passcode" aria-invalid={!!wrong}
              className="min-w-0 flex-1 rounded-[8px] bg-surface px-3 py-1.5 text-[13px] outline-none focus:border-accent" style={{ border: wrong ? "1.5px solid var(--danger)" : "1px solid var(--border)", letterSpacing: pass ? ".3em" : undefined }} />
            <Button size="sm" variant="primary" disabled={!pass || busy || !!lockLeft}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Sign in"}</Button>
          </div>
          {wrong && <span role="alert" className="text-[12.5px] text-bad">{wrong.left != null ? `Wrong passcode · ${wrong.left} ${wrong.left === 1 ? "try" : "tries"} left before a short lockout.` : wrong.error}</span>}
          {lockLeft > 0 && (
            <div role="alert" className="flex items-center gap-3 rounded-[10px] p-3" style={{ background: "color-mix(in srgb, var(--warning) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)" }}>
              <b className="font-mono text-[22px] font-semibold tabular-nums">{String(Math.floor(lockLeft / 60)).padStart(2, "0")}:{String(lockLeft % 60).padStart(2, "0")}</b>
              <span className="flex-1 text-[12.5px] leading-[18px]">Too many tries from this network. Try again when the timer ends. Next lockout doubles (max 24 h).</span>
            </div>
          )}
          <button type="button" onClick={() => setHelp(true)} className="self-start text-[12.5px] text-link hover:underline">Forgot the passcode?</button>
          <PasscodeHelp open={help} onClose={() => setHelp(false)} />
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" />Remember on this device (switch later without the passcode)</label>
        </form>
      ) : (
        <button data-unlock-account className={cx(row, "text-[13px] text-muted hover:bg-surface-2 hover:text-ink")} onClick={() => setAdding(true)}>
          {compact ? <Plus size={15} /> : <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-line"><UserRound size={14} /></span>}
          {signedIn ? "Add another account" : "Unlock or add an account"}
        </button>
      )}
    </div>
  );
}
