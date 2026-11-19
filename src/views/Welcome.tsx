// Unlock + first-run (design handoff: ScreenUnlock, "Lumen 01 Welcome and Home" screens 2A–2F,
// "Lumen 12 Android Loading Sync" R3-5A–C for the Capacitor app's first launch).
import { AvatarGlyph } from "../components/SpaceIcon";
import { AVATAR_CHOICES, avatarGlyph } from "../lib/space-icon";
import { Capacitor } from "@capacitor/core";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Camera, ChevronRight, CircleCheck, CloudOff, Eye, EyeOff, Fingerprint, ImagePlus, Lock, Moon, RefreshCw, Smartphone, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getToken } from "../lib/api";
import { db } from "../lib/db";
import {
  appLockEnabled, deviceUnlockAvailable, enrollDeviceUnlock, forgetDeviceCredential, hasDeviceCredential, lockActive, markDeviceUnlockOffered, setAppLock,
  shouldOfferDeviceUnlock, unlockWithDevice, unlockWithServer, verifyPasscodeLocally, type UnlockResult,
} from "../lib/home-lock";
import { APP_VERSION, lastSyncAt, pickAvatar, setAvatarImage, syncLabel, useAvatarImage } from "../lib/home-meta";
import { activeTheme, setSettings, THEMES, useSettings } from "../lib/settings";
import { syncNow } from "../lib/sync";
import { LumenMark, Wordmark } from "../components/LumenMark";
import { cx } from "../components/ui";
import { AccountsComing, AuthWelcome } from "../components/auth/WelcomeAccounts"; // accounts (off: one quiet line)

const WELCOMED = "lumen.welcomed";
const NATIVE_FLAG = "lumen.launchAndroid";
let devicePending = false; // one WebAuthn prompt at a time (StrictMode mounts effects twice)

/** True when the gate must show: first run (no sync token, never welcomed) or the device app lock. */
export function needsWelcome(): boolean {
  try { return (!getToken() && localStorage.getItem(WELCOMED) !== "1") || lockActive(); } catch { return false; }
}
const markWelcomed = () => { try { localStorage.setItem(WELCOMED, "1"); } catch { /* private mode */ } };

/** The Android (Capacitor) app gets the round-3 first launch; `?launch=android` previews it in a browser. */
function nativeLaunch() {
  try {
    const q = new URLSearchParams(location.search).get("launch");
    if (q === "android") sessionStorage.setItem(NATIVE_FLAG, "1");
    if (q === "web") sessionStorage.removeItem(NATIVE_FLAG);
    return Capacitor.isNativePlatform() || sessionStorage.getItem(NATIVE_FLAG) === "1";
  } catch { return false; }
}

function usePhone() {
  const [p, setP] = useState(() => innerWidth < 640);
  useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}

/** Steps push history entries so the browser / Android back gesture steps back (nothing is lost). */
function useSteps(initial: number) {
  const [step, setStepRaw] = useState(initial);
  useEffect(() => {
    const f = (e: PopStateEvent) => { const s = (e.state as { lumenStep?: number } | null)?.lumenStep; setStepRaw(typeof s === "number" ? s : initial); };
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, [initial]);
  const setStep = (n: number) => {
    if (n > step) history.pushState({ lumenStep: n }, "");
    else if (n < step && (history.state as { lumenStep?: number } | null)?.lumenStep === step) { history.back(); return; }
    setStepRaw(n);
  };
  return [step, setStep] as const;
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [locked] = useState(lockActive);
  const [native] = useState(() => !locked && nativeLaunch());
  if (locked) return <Unlock lock onNext={onDone} />;
  if (native) return <NativeFirstRun onDone={() => { markWelcomed(); onDone(); }} />;
  return <WebWelcome onDone={onDone} />;
}

function WebWelcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useSteps(0); // 0 = unlock, 1..3 = first run
  const finish = () => { markWelcomed(); onDone(); };
  if (step === 0) return <AuthWelcome><Unlock onNext={() => { markWelcomed(); setStep(1); }} /></AuthWelcome>;
  return <FirstRun step={step} setStep={setStep} onDone={finish} />;
}

// ------------------------------------------------------------------ shared bits

export function Avatar({ size, ring, font, glyph, className, style }: { size: number; ring?: boolean; font?: number; /** glyph size (default ≈ 38.5% of the circle, design 44 → 17) */ glyph?: number; className?: string; style?: React.CSSProperties }) {
  const s = useSettings();
  const img = useAvatarImage();
  return (
    <span className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2", className)}
      style={{ width: size, height: size, fontSize: font ?? Math.round(size / 2), boxShadow: ring ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)" : undefined, ...style }}>
      {img ? <img src={img} alt="" className="size-full object-cover" /> : <AvatarGlyph value={s.avatar} size={glyph ?? Math.round(size * 0.385)} />}
    </span>
  );
}

/** Wrong-passcode message with attempts left / lockout countdown (design 2A note 1). */
function useUnlockError() {
  const [err, setErr] = useState<{ text: string; until?: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!err?.until) return;
    const i = setInterval(() => { tick((x) => x + 1); if (Date.now() >= err.until!) setErr(null); }, 1000);
    return () => clearInterval(i);
  }, [err]);
  const lockedFor = err?.until ? Math.max(0, Math.ceil((err.until - Date.now()) / 1000)) : 0;
  const text = !err ? "" : lockedFor ? `Too many attempts · try again in ${Math.floor(lockedFor / 60)}:${String(lockedFor % 60).padStart(2, "0")}` : err.text;
  const show = (r: Extract<UnlockResult, { ok: false }>) => {
    if (r.retryAfterSec) setErr({ text: "", until: Date.now() + r.retryAfterSec * 1000 });
    else if (typeof r.attemptsLeft === "number") setErr({ text: `Try again · ${r.attemptsLeft} left` });
    else setErr({ text: r.error });
  };
  return { text, locked: lockedFor > 0, show, clear: () => !lockedFor && setErr(null) };
}

/** Passcode field drawn like the design: dots + lamp caret; a transparent real input sits on top. */
function PassField({ big, value, onChange, show, error, inputRef, right }: {
  big: boolean; value: string; onChange: (v: string) => void; show: boolean; error: boolean; inputRef: React.RefObject<HTMLInputElement | null>; right: React.ReactNode;
}) {
  const [focus, setFocus] = useState(true);
  const dot = big ? 8 : 7;
  return (
    <div className={cx("relative flex items-center border", big ? "h-[52px] rounded-[10px] bg-surface px-4" : "h-10 rounded-[6px] bg-bg px-3", error ? "border-bad" : focus ? "border-accent" : "border-line")}
      style={{ gap: big ? 8 : 7, boxShadow: error ? "0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent)" : focus ? `0 0 0 3px color-mix(in srgb, var(--accent) ${big ? 20 : 22}%, transparent)` : undefined }}>
      <style>{"@keyframes lumen-caret{0%,49%{opacity:1}50%,100%{opacity:0}}"}</style>
      {show
        ? <span className={cx("whitespace-pre text-ink", big ? "text-[15px]" : "text-[14px]")}>{value}</span>
        : Array.from({ length: Math.min(value.length, 24) }, (_, i) => <span key={i} className="shrink-0 rounded-full bg-ink" style={{ width: dot, height: dot }} />)}
      {focus && <span className="shrink-0 bg-accent" style={{ width: 1.5, height: big ? 20 : 18, animation: "lumen-caret 1.06s step-end infinite" }} />}
      <span className="flex-1" />
      <input id="lumen-pass" ref={inputRef} type={show ? "text" : "password"} autoComplete="current-password" value={value} aria-label="Passcode"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full cursor-text rounded-[inherit] bg-transparent text-transparent caret-transparent selection:bg-transparent" style={{ paddingRight: big ? 52 : 40, outline: "none" }} />
      <span className="relative z-[1] flex">{right}</span>
    </div>
  );
}

// ------------------------------------------------------------------ unlock (2A/2B desktop, 2C phone; also the app lock)

function Unlock({ onNext, lock = false }: { onNext: () => void; lock?: boolean }) {
  const s = useSettings();
  const phone = usePhone();
  const count = useLiveQuery(() => db.notes.filter((n) => !n.deleted).count(), []) ?? 0;
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState(false);
  const [fp] = useState(hasDeviceCredential);
  const e = useUnlockError();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const dark = activeTheme().dark;
  const last = lastSyncAt();

  const after = async () => {
    if (!lock) void syncNow().catch(() => {});
    if (await shouldOfferDeviceUnlock()) { setBusy(false); setOffer(true); return; }
    onNext();
  };
  const submit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!pass || busy || e.locked) return;
    setBusy(true);
    const r = lock && getToken() ? await verifyPasscodeLocally(pass) : await unlockWithServer(pass);
    if (r.ok) return after();
    e.show(r);
    setBusy(false);
    ref.current?.focus();
  };
  const device = async (auto = false) => {
    if (devicePending) return;
    devicePending = true;
    const r = await unlockWithDevice().finally(() => { devicePending = false; });
    if (r.ok) onNext();
    else if (!auto) e.show(r); // a dismissed automatic prompt stays quiet; the passcode is right there
  };
  // App lock: ask for the fingerprint straight away; the passcode stays as the fallback.
  useEffect(() => { if (lock && fp) void device(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = s.author ? s.author.split(" ")[0] : "";
  const hello = name ? `Welcome back, ${name}` : "Welcome to Lumen";
  const sub = [count ? `${count.toLocaleString()} notes on this device` : "Your notebook, synced across devices", last ? `last sync ${syncLabel(last)}` : ""].filter(Boolean).join(" · ");
  const primary = busy ? "Unlocking…" : lock ? "Unlock" : "Unlock sync";

  if (offer) return <DeviceOffer phone={phone} onDone={onNext} />;

  const errLine = e.text && <div className="text-[12px] text-bad" role="alert">{e.text}</div>;
  const eye = (big: boolean) => (
    <button type="button" aria-label={show ? "Hide passcode" : "Show passcode"} onClick={() => setShow(!show)} className="text-muted hover:text-ink">
      {show ? <EyeOff size={big ? 20 : 16} /> : <Eye size={big ? 20 : 16} />}
    </button>
  );
  const field = (big: boolean) => (
    <div className="flex flex-col" style={{ gap: big ? 8 : 6 }}>
      <label htmlFor="lumen-pass" className={cx("font-medium text-muted", big ? "text-[13px]" : "text-[12px]")}>Passcode</label>
      <PassField big={big} value={pass} onChange={(v) => { setPass(v); e.clear(); }} show={show} error={!!e.text} inputRef={ref}
        right={big && fp ? <button type="button" aria-label="Unlock with fingerprint" onClick={() => void device()} className="text-muted hover:text-ink"><Fingerprint size={20} /></button> : eye(big)} />
      {errLine}
    </div>
  );

  const themeToggle = (
    <div className="flex gap-[2px] rounded-[8px] border border-line bg-surface p-[3px]">
      {([["paper", <Sun key="s" size={14} />, false, "Light theme"], ["lamplight", <Moon key="m" size={14} />, true, "Dark theme"]] as const).map(([id, icon, d, label]) => (
        <button key={id} type="button" aria-label={label} onClick={() => setSettings({ theme: id })}
          className={cx("flex h-6 w-7 items-center justify-center rounded-[6px]", dark === d ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>{icon}</button>
      ))}
    </div>
  );

  if (phone) {
    return (
      <form onSubmit={submit} className="safe-t safe-b flex h-full flex-col text-[14px] text-ink leading-[normal]" style={{ background: "radial-gradient(420px 320px at 50% -60px, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--bg)" }}>
        <div className="flex flex-1 flex-col items-center justify-center gap-[14px] px-6">
          <LumenMark size={64} tile={dark ? "dark" : "light"} />
          <Wordmark size={34} />
          <div className="text-muted">{hello}</div>
        </div>
        <div className="flex flex-col gap-[14px] px-5 pb-5">
          {field(true)}
          <button disabled={busy || !pass || e.locked} className="flex h-[52px] items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-60">{primary}</button>
          {lock
            ? <div className="flex h-12 items-center justify-center gap-2 text-[13px] text-muted"><Lock size={14} />Locked on this device</div>
            : <button type="button" onClick={onNext} className="flex h-12 items-center justify-center gap-2 rounded-[12px] font-medium text-ink">
                <CloudOff size={16} className="text-muted" />Continue offline <span className="font-normal text-muted">· local only</span>
              </button>}
          {!lock && <AccountsComing />}
        </div>
      </form>
    );
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto text-[13px] text-ink leading-[normal]" style={{ background: "radial-gradient(720px 440px at 50% -90px, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--bg)" }}>
      <form onSubmit={submit} className="flex w-[380px] max-w-[calc(100%-32px)] flex-col gap-7">
        <div className="flex flex-col items-center gap-[14px]">
          <LumenMark size={60} tile={dark ? "dark" : "light"} />
          <Wordmark size={30} />
          <div className="text-[14px] text-muted">A quiet notebook for what you learn.</div>
        </div>
        <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-6" style={{ boxShadow: dark ? "none" : "0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)" }}>
          <div className="flex items-center gap-3">
            <Avatar size={38} font={18} className="border border-line" />
            <div className="flex min-w-0 flex-col gap-[2px]"><div className="text-[14px] font-semibold">{hello}</div><div className="truncate text-[12px] text-muted">{sub}</div></div>
          </div>
          {field(false)}
          <button disabled={busy || !pass || e.locked} className="flex h-10 items-center justify-center gap-[10px] rounded-[10px] bg-accent text-[14px] font-semibold text-accent-fg disabled:opacity-60">
            {primary} <span className="font-mono text-[11px] font-medium opacity-70">↵</span>
          </button>
          <div className="flex items-start gap-2 text-[12px] leading-[18px] text-muted"><Lock size={13} className="mt-[2px] shrink-0" /><span>{lock ? "Locked on this device. Use your fingerprint or passcode to open Lumen." : "Hashed on this device. Lumen never stores your passcode."}</span></div>
        </div>
        {(!lock || fp) && <div className="flex items-center gap-3 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>}
        {lock ? fp && (
          <button type="button" onClick={() => void device()} className="flex h-[50px] items-center gap-3 rounded-[10px] border border-line px-4 text-left hover:bg-surface">
            <Fingerprint size={16} className="text-muted" />
            <span className="flex-1 text-[14px] font-medium">Use fingerprint</span>
            <span className="text-[12px] text-muted">This device</span>
          </button>
        ) : (
          <button type="button" onClick={onNext} className="flex h-[50px] items-center gap-3 rounded-[10px] border border-line px-4 text-left hover:bg-surface">
            <CloudOff size={16} className="text-muted" />
            <span className="flex-1 text-[14px] font-medium">Continue offline</span>
            <span className="text-[12px] text-muted">Local only</span>
          </button>
        )}
        {!lock && <AccountsComing className="-mt-3" />}
      </form>
      <div className="absolute inset-x-8 bottom-6 flex items-center justify-between text-[12px] text-muted">
        <span>v{APP_VERSION} · Local-first · Works offline</span>
        {themeToggle}
      </div>
    </div>
  );
}

/** After the first successful passcode: offer fingerprint / face / device-PIN unlock for this device. */
function DeviceOffer({ phone, onDone }: { phone: boolean; onDone: () => void }) {
  const s = useSettings();
  const [lockOn, setLockOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dark = activeTheme().dark;
  const yes = async () => {
    setBusy(true); setErr("");
    try { await enrollDeviceUnlock(s.author); setAppLock(lockOn); onDone(); }
    catch (x) { setErr((x as Error).message === "Cancelled" ? "Cancelled · you can turn it on later from Home › ⋯" : (x as Error).message); setBusy(false); }
  };
  const no = () => { markDeviceUnlockOffered(); onDone(); };
  return (
    <div className="flex h-full items-center justify-center px-5 text-[13px] text-ink leading-[normal]" style={{ background: `radial-gradient(${phone ? "420px 320px at 50% -60px" : "720px 440px at 50% -90px"}, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--bg)` }}>
      <div className="flex w-[380px] max-w-full flex-col gap-4 rounded-[14px] border border-line bg-surface p-6" style={{ boxShadow: dark ? "none" : "0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)" }}>
        <span className="flex size-11 items-center justify-center rounded-[12px] text-accent" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}><Fingerprint size={22} /></span>
        <div className="flex flex-col gap-1.5">
          <div className="text-[18px] font-[650] tracking-[-0.01em]">Use fingerprint next time?</div>
          <div className="leading-[20px] text-muted">Unlock Lumen with this device's fingerprint, face or PIN. The key is created and kept on this device only; it never leaves it and isn't your sync passcode.</div>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-surface-2 p-3">
          <input type="checkbox" checked={lockOn} onChange={(x) => setLockOn(x.target.checked)} className="mt-[3px] accent-[var(--accent)]" />
          <span className="flex flex-col gap-0.5"><span className="font-medium">Lock Lumen when it opens</span><span className="text-[12px] text-muted">On this device only. Fingerprint or passcode to get in.</span></span>
        </label>
        {err && <div className="text-[12px] text-bad">{err}</div>}
        <div className="flex gap-2">
          <button onClick={no} className="flex h-10 flex-1 items-center justify-center rounded-[10px] border border-line font-medium hover:bg-surface-2">Not now</button>
          <button onClick={yes} disabled={busy} className="flex h-10 flex-[1.4] items-center justify-center gap-2 rounded-[10px] bg-accent font-semibold text-accent-fg disabled:opacity-60"><Fingerprint size={15} />{busy ? "Waiting…" : "Use fingerprint"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ first run (web, Lumen 01 2D–2F)

const SWATCHES: (number | null)[] = [null, 25, 140, 200, 265, 320];
const AVATARS: string[] = [...AVATAR_CHOICES];
/** The selected avatar first, then the next ones in the list (the design shows a short row, not a grid). Legacy emoji count as their glyph. */
const avatarRow = (cur: string, n: number) => { const c = cur ? `glyph:${avatarGlyph(cur)}` : ""; const i = AVATARS.indexOf(c); return Array.from({ length: n - 1 }, (_, k) => AVATARS[(Math.max(i, -1) + 1 + k) % AVATARS.length]).filter((a) => a !== c); };

function FirstRun({ step, setStep, onDone }: { step: number; setStep: (n: number) => void; onDone: () => void }) {
  const s = useSettings();
  const img = useAvatarImage();
  const t = activeTheme();
  const next = () => (step >= 3 ? onDone() : setStep(step + 1));
  const big = "flex h-[52px] items-center justify-center rounded-[12px] font-semibold text-[15px]";
  const input = "h-12 w-full rounded-[10px] border border-line bg-surface px-[14px] text-[14px] text-ink outline-none focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)]";
  const head = [
    ["Choose a theme", "Pick what's easy on your eyes at 1 a.m."],
    ["Your lamp colour", "It marks only what's current: the active note, the primary button, the cursor."],
    ["Name your blog", "Only notes you publish appear there. You can leave this for later."],
  ][step - 1];
  const hue = s.accentHue ?? 72;

  return (
    <div className="safe-t safe-b flex h-full justify-center overflow-y-auto bg-bg text-[14px] text-ink leading-[normal]">
      <div className="flex min-h-full w-full max-w-[460px] flex-col">
        <div className="flex items-center gap-[6px] px-5 pt-4">
          {[1, 2, 3].map((i) => <span key={i} className={cx("h-1 flex-1 rounded-[2px]", i <= step ? "bg-accent" : "bg-line")} />)}
          <button onClick={onDone} className="ml-[10px] text-[13px] text-muted hover:text-ink">Skip</button>
        </div>
        <div className="flex flex-col gap-[6px] px-5 pb-5 pt-7">
          <div className="text-[13px] text-muted">{step} of 3</div>
          <div className="text-[26px] font-[650] tracking-[-0.02em]">{head[0]}</div>
          <div className="leading-[22px] text-muted">{head[1]}</div>
        </div>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 px-5">
            {THEMES.map((th) => {
              const on = s.theme === th.id || (s.theme === "auto" && t.id === th.id);
              return (
                <button key={th.id} onClick={() => setSettings({ theme: th.id })} className="flex flex-col gap-[10px] rounded-[14px] bg-surface p-2 text-left" style={{ border: `2px solid ${on ? "var(--accent)" : "var(--border)"}` }}>
                  <div className="flex h-[84px] w-full flex-col gap-[7px] rounded-[8px] p-3" style={{ background: th.vars.bg }}>
                    <div className="flex items-center gap-[6px]"><span className="size-2 rounded-full" style={{ background: th.vars.accent }} /><span className="h-[6px] w-[50px] rounded-[3px] opacity-90" style={{ background: th.vars.text }} /></div>
                    <span className="h-[5px] w-4/5 rounded-[3px] opacity-35" style={{ background: th.vars.text }} />
                    <span className="h-[5px] w-[62%] rounded-[3px] opacity-35" style={{ background: th.vars.text }} />
                    <span className="mt-[2px] h-[14px] w-11 shrink-0 rounded-[4px]" style={{ background: th.vars.accent }} />
                  </div>
                  <div className="flex min-h-[18px] w-full items-center justify-between px-1 pb-[2px] text-[13px] font-medium"><span>{th.name}</span>{on && <CircleCheck size={16} className="text-accent" />}</div>
                </button>
              );
            })}
          </div>
        )}

        {step === 2 && (
          <>
            <div className="mx-5 flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
              <div className="text-[12px] text-muted">02 Optimization</div>
              <div className="text-[20px] font-[650] tracking-[-0.01em]">Gradient descent</div>
              <div className="text-[16px] leading-[26px]" style={{ fontFamily: "'Source Serif 4', serif" }}>
                Step against the gradient, scaled by a <span className="text-link underline underline-offset-[3px]">learning rate</span>
                <span className="ml-px inline-block h-[18px] w-[2px] bg-accent align-[-3px]" />
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-[34px] items-center rounded-[10px] bg-accent px-[14px] text-[13px] font-semibold text-accent-fg">Start review</span>
                <span className="flex h-9 items-center rounded-[10px] border border-line px-[14px] text-[13px]">Later</span>
              </div>
            </div>
            <div className="flex flex-col gap-[14px] px-5 pt-7">
              <div className="flex justify-between text-[13px]"><span className="font-medium">Hue</span><span className="font-mono text-muted">{hue}°</span></div>
              <div className="relative h-7 rounded-[14px]" style={{ background: "linear-gradient(90deg,oklch(.79 .15 0),oklch(.79 .15 60),oklch(.79 .15 120),oklch(.79 .15 180),oklch(.79 .15 240),oklch(.79 .15 300),oklch(.79 .15 360))" }}>
                <div className="pointer-events-none absolute -top-1 size-9 rounded-full border-[3px] border-ink bg-accent" style={{ left: `calc(${(hue / 360) * 100}% - 18px)` }} />
                <input type="range" min={0} max={360} value={hue} aria-label="Accent hue" onChange={(x) => setSettings({ accentHue: +x.target.value })} className="absolute inset-0 w-full cursor-pointer opacity-0" />
              </div>
              <div className="flex justify-between">
                {SWATCHES.map((h) => {
                  const on = s.accentHue === h;
                  const bg = h === null ? t.vars.accent : `oklch(.79 .15 ${h})`;
                  return <button key={String(h)} aria-label={h === null ? "Theme default" : `Hue ${h}`} onClick={() => setSettings({ accentHue: h })} className="size-9 rounded-full" style={{ background: bg, boxShadow: on ? "0 0 0 2px var(--bg), 0 0 0 4px var(--text)" : undefined }} />;
                })}
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted"><CircleCheck size={14} className="text-ok" />Lightness and chroma are locked — contrast stays AA at every hue.</div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex flex-col gap-4 px-5">
              <label className="flex flex-col gap-[6px]"><span className="text-[13px] font-medium text-muted">Blog name</span>
                <input autoFocus className={input} style={{ outline: "none", caretColor: "var(--accent)" }} value={s.blogName} onChange={(x) => setSettings({ blogName: x.target.value })} /></label>
              <label className="flex flex-col gap-[6px]"><span className="text-[13px] font-medium text-muted">Tagline</span>
                <input className={input} style={{ outline: "none", caretColor: "var(--accent)" }} value={s.tagline} onChange={(x) => setSettings({ tagline: x.target.value })} /></label>
              <div className="flex flex-col gap-[6px]"><span className="text-[13px] font-medium text-muted">Author &amp; avatar</span>
                <div className="flex items-center gap-[10px]">
                  <input className={cx(input, "min-w-0 flex-1")} style={{ outline: "none", caretColor: "var(--accent)" }} placeholder="Your name" aria-label="Author" value={s.author} onChange={(x) => setSettings({ author: x.target.value })} />
                  <button aria-label="Current avatar" className="rounded-full"><Avatar size={44} ring /></button>
                  {avatarRow(img ? "" : s.avatar, 2).slice(0, 1).map((a) => (
                    <button key={a} aria-label={`Avatar ${a.replace("glyph:", "")}`} onClick={() => { setSettings({ avatar: a }); if (img) void setAvatarImage(""); }} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2"><AvatarGlyph value={a} size={17} /></button>
                  ))}
                  <button aria-label="Upload a photo" title="Upload a photo" onClick={() => pickAvatar()} className="flex size-[46px] shrink-0 items-center justify-center rounded-full border border-dashed border-line text-muted hover:text-ink"><ImagePlus size={18} /></button>
                </div>
              </div>
            </div>
            <div className="mx-5 mt-6 flex flex-col gap-[6px] rounded-[14px] bg-[#FAF8F3] p-4 text-[#1F1D1A]">
              <div className="font-mono text-[11px] font-medium text-[#6A655C]">PREVIEW · /blog</div>
              <div className="text-[22px] font-bold tracking-[-0.01em]" style={{ fontFamily: "'Source Serif 4', serif" }}>{s.blogName || "Untitled blog"}</div>
              <div className="text-[13px] text-[#6A655C]">{s.tagline}{s.author ? <> · {img ? <img src={img} alt="" className="inline size-[14px] rounded-full align-[-2px] object-cover" /> : <AvatarGlyph value={s.avatar} size={15} style={{ verticalAlign: "-3px" }} />} {s.author}</> : ""}</div>
            </div>
          </>
        )}

        <div className="min-h-6 flex-1" />
        <div className="flex items-start gap-[10px] px-5 pb-4">
          {step > 1 && <button aria-label="Back" onClick={() => setStep(step - 1)} className="flex size-[54px] items-center justify-center rounded-[12px] border border-line"><ArrowLeft size={18} /></button>}
          <button onClick={next} className={cx(big, "flex-1 bg-accent text-accent-fg")}>{step === 3 ? "Start writing" : "Continue"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ first launch on the Android app (Lumen 12 R3-5A–C)

function NativeFirstRun({ onDone }: { onDone: () => void }) {
  const s = useSettings();
  const img = useAvatarImage();
  const t = activeTheme();
  const [step, setStep] = useSteps(1);
  const [choice, setChoice] = useState<"sync" | "local">("sync");
  const passRef = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const e = useUnlockError();
  const main = "flex h-14 w-full items-center justify-center rounded-[14px] bg-accent text-[16px] font-semibold text-accent-fg disabled:opacity-60";
  const bars = (skip: boolean) => (
    <div className="flex items-center gap-[6px] px-5 pt-4">
      {[1, 2, 3].map((i) => <span key={i} className={cx("h-1 flex-1 rounded-[2px]", i <= step ? "bg-accent" : "bg-line")} />)}
      {skip && <button onClick={() => setStep(step + 1)} className="ml-[10px] text-[13px] text-muted">Skip</button>}
    </div>
  );
  const finish = async () => {
    if (choice === "local") return onDone();
    if (!pass) { passRef.current?.focus(); return; }
    if (busy || e.locked) return;
    setBusy(true);
    const r = await unlockWithServer(pass);
    if (r.ok) { void syncNow().catch(() => {}); return onDone(); }
    e.show(r); setBusy(false);
  };
  const themeCard = (id: "lamplight" | "paper") => {
    const th = THEMES.find((x) => x.id === id)!;
    const on = t.id === id;
    return (
      <button onClick={() => setSettings({ theme: id })} className="flex flex-col gap-[10px] rounded-[16px] bg-surface p-[10px] text-left" style={{ border: `2px solid ${on ? "var(--accent)" : "var(--border)"}` }}>
        <div className="flex h-[150px] w-full flex-col gap-2 rounded-[10px] p-[14px]" style={{ background: th.vars.bg }}>
          <span className="size-[10px] rounded-full" style={{ background: th.vars.accent }} />
          <span className="h-[6px] w-[70%] rounded-[3px] opacity-80" style={{ background: th.vars.text }} />
          <span className="h-[5px] w-[90%] rounded-[3px] opacity-30" style={{ background: th.vars.text }} />
          <span className="h-[5px] w-[60%] rounded-[3px] opacity-30" style={{ background: th.vars.text }} />
        </div>
        <span className="flex min-h-[19px] w-full items-center justify-between px-1 font-semibold">{th.name}{on && <CircleCheck size={18} className="text-accent" />}</span>
      </button>
    );
  };

  return (
    <div className="safe-t safe-b flex h-full justify-center overflow-y-auto bg-bg text-[15px] text-ink leading-[normal]">
      <div className="flex min-h-full w-full max-w-[460px] flex-col">
        {step === 1 && (
          <>
            {bars(false)}
            <div className="flex flex-col gap-[10px] px-6 pt-10">
              <LumenMark size={48} tile={t.dark ? "dark" : "light"} />
              <span className="mt-[10px] text-[28px] font-[650] tracking-[-0.02em]">Light or dark?</span>
              <span className="leading-[22px] text-muted">You can switch any time — there are four more themes in Settings.</span>
            </div>
            <div className="flex-1" />
            <div className="grid grid-cols-2 gap-3 px-4">{themeCard("lamplight")}{themeCard("paper")}</div>
            <div className="px-4 pb-3 pt-5"><button onClick={() => setStep(2)} className={main}>Continue</button></div>
          </>
        )}
        {step === 2 && (
          <>
            {bars(true)}
            <div className="flex flex-col gap-[10px] px-6 pt-8">
              <span className="text-[28px] font-[650] tracking-[-0.02em]">Name your blog</span>
              <span className="leading-[22px] text-muted">Only notes you choose to publish appear there.</span>
            </div>
            <div className="flex flex-col gap-3 px-4 pt-6">
              <input autoFocus aria-label="Blog name" value={s.blogName} onChange={(x) => setSettings({ blogName: x.target.value })}
                className="h-14 w-full rounded-[12px] border-[1.5px] border-line bg-surface px-4 text-[17px] text-ink focus:border-accent" style={{ caretColor: "var(--accent)", outline: "none" }} />
              <div className="flex gap-[10px]">
                <button aria-label="Current avatar" className="rounded-full"><Avatar size={52} ring /></button>
                {avatarRow(img ? "" : s.avatar, 3).slice(0, 2).map((a) => (
                  <button key={a} aria-label={`Avatar ${a.replace("glyph:", "")}`} onClick={() => { setSettings({ avatar: a }); if (img) void setAvatarImage(""); }} className="flex size-[52px] items-center justify-center rounded-full bg-surface-2"><AvatarGlyph value={a} size={20} /></button>
                ))}
                <button aria-label="Take or choose a photo" onClick={() => pickAvatar(true)} className="flex size-[54px] items-center justify-center rounded-full border border-dashed border-line text-muted"><Camera size={20} /></button>
              </div>
            </div>
            <div className="flex-1" />
            <div className="px-4 pb-[10px]"><button onClick={() => setStep(3)} className={main}>Continue</button></div>
          </>
        )}
        {step === 3 && (
          <form onSubmit={(x) => { x.preventDefault(); void finish(); }} className="flex flex-1 flex-col">
            {bars(false)}
            <div className="flex flex-col gap-[10px] px-6 pt-8">
              <span className="text-[28px] font-[650] tracking-[-0.02em]">Sync your notes?</span>
              <span className="leading-[22px] text-muted">Sync uses your own free Cloudflare. Without it, everything stays on this phone.</span>
            </div>
            <div className="flex-1" />
            <div className="flex flex-col gap-3 px-4">
              <div onClick={() => setChoice("sync")} className="flex flex-col gap-3 rounded-[16px] bg-surface p-4" style={{ border: choice === "sync" ? "2px solid var(--accent)" : "1px solid var(--border)" }}>
                <span className="flex items-center gap-[10px] font-semibold"><RefreshCw size={18} className="text-accent" />Unlock sync</span>
                <label className={cx("flex h-[52px] items-center gap-2 rounded-[10px] border bg-bg px-[14px]", e.text ? "border-bad" : "border-line focus-within:border-accent")}>
                  <Lock size={16} className="shrink-0 text-muted" />
                  <input ref={passRef} type="password" autoComplete="current-password" placeholder="Passcode" aria-label="Passcode" value={pass}
                    onChange={(x) => { setPass(x.target.value); setChoice("sync"); e.clear(); }} className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted" style={{ outline: "none" }} />
                </label>
                {e.text && <div className="-mt-1 text-[13px] text-bad" role="alert">{e.text}</div>}
              </div>
              <button type="button" onClick={() => { setChoice("local"); onDone(); }} className="flex items-center gap-3 rounded-[16px] border border-line p-4 text-left">
                <Smartphone size={18} className="text-muted" />
                <span className="flex flex-1 flex-col gap-[2px]"><span className="font-semibold">Stay local</span><span className="text-[13px] text-muted">Turn on sync later in Settings</span></span>
                <ChevronRight size={18} className="text-muted" />
              </button>
            </div>
            <div className="px-4 pb-3 pt-5"><button disabled={busy || e.locked} className={main}>{busy ? "Unlocking…" : "Unlock & start"}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ app lock setting (for Settings / Home menu)

/** "App lock" toggle: fingerprint / passcode on launch, on this device only. */
export function AppLockSetting() {
  const [on, setOn] = useState(appLockEnabled);
  const [fp, setFp] = useState(hasDeviceCredential);
  const [avail, setAvail] = useState(false);
  const [err, setErr] = useState("");
  const s = useSettings();
  useEffect(() => { void deviceUnlockAvailable().then(setAvail); }, []);
  const canLock = fp || !!getToken();
  const toggle = async () => {
    setErr("");
    if (on) { setAppLock(false); setOn(false); return; }
    if (!fp && avail) {
      try { await enrollDeviceUnlock(s.author); setFp(true); } catch (x) { if (!getToken()) { setErr((x as Error).message); return; } }
    }
    if (!hasDeviceCredential() && !getToken()) { setErr("Set up sync or fingerprint first, so there's a way back in."); return; }
    setAppLock(true); setOn(true);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Fingerprint size={18} className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">App lock</span>
          <span className="text-[12px] text-muted">Ask for {fp ? "fingerprint or passcode" : avail ? "fingerprint or passcode" : "the passcode"} when Lumen opens. This device only.</span>
        </div>
        <button role="switch" aria-checked={on} aria-label="App lock" onClick={toggle} disabled={!on && !canLock && !avail}
          className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-accent" : "bg-line")}>
          <span className="absolute top-[3px] size-4 rounded-full bg-white transition-all" style={{ left: on ? 19 : 3 }} />
        </button>
      </div>
      {fp && <button onClick={() => { forgetDeviceCredential(); setFp(false); }} className="self-start pl-[30px] text-[12px] text-link">Remove fingerprint from this device</button>}
      {err && <div className="pl-[30px] text-[12px] text-bad">{err}</div>}
    </div>
  );
}
