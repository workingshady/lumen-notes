// Accounts: shared pieces (Google button, fields, password meter, message box, buttons, the "coming soon" card and
// the unlock-screen line). Sizes follow design/handoffs/2026-11-20-round-6/AccountDesk.dc.html. docs/ACCOUNTS.md
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { passwordStrength } from "../../lib/auth";
import { t, tk, useLang } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { cx } from "../ui";

/** Google's standard "G" mark (multicolour, unmodified), per the Sign in with Google branding guidelines. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="no-flip shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Roboto Medium is the font Google's button spec asks for; loaded once, only when a Google button is on screen. */
let robotoRequested = false;
function useRoboto() {
  useEffect(() => {
    if (robotoRequested || typeof document === "undefined") return;
    robotoRequested = true;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@500&display=swap";
    document.head.appendChild(l);
  }, []);
}
export const GOOGLE_LABELS = { continue: tk("Continue with Google"), signIn: tk("Sign in with Google"), tryAgain: tk("Try Google again") } as const;
/**
 * "Sign in with Google" button, per Google's branding guidelines: light = #FFFFFF fill, 1px #747775 stroke, #1F1F1F
 * text; dark = #131314 fill, 1px #8E918F stroke, #E3E3E3 text; Roboto Medium 14/20; 12px side padding; 10px between
 * the unmodified multicolour logo (20px) and the label; pill shape. The design draws the light variant on both
 * themes (27E/27O), 44px tall, full width. Labels are Google's own wording.
 */
export function GoogleButton({ onClick, busy, label = GOOGLE_LABELS.continue, variant = "light", className }: {
  onClick: () => void; busy?: boolean; label?: string; variant?: "light" | "dark"; className?: string;
}) {
  useLang();
  useRoboto();
  const dark = variant === "dark";
  return (
    <button type="button" onClick={onClick} disabled={busy} data-google-button={variant}
      className={cx("flex h-[46px] w-full shrink-0 items-center justify-center gap-[10px] rounded-full border px-3 transition-[filter] hover:brightness-[.97] disabled:opacity-60", className)}
      style={{ background: dark ? "#131314" : "#FFFFFF", borderColor: dark ? "#8E918F" : "#747775", color: dark ? "#E3E3E3" : "#1F1F1F", fontFamily: "Roboto, Inter, system-ui, sans-serif", fontWeight: 500, fontSize: 14, lineHeight: "20px", letterSpacing: ".25px" }}>
      <GoogleG size={20} /><span>{t(label)}</span>
    </button>
  );
}

/** Label (12px muted) above a control, 6px gap (27E/27F). */
export function AuthField({ label, right, children, htmlFor }: { label: string; right?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[12px]"><label htmlFor={htmlFor} className="flex-1 text-muted">{label}</label>{right}</div>
      {children}
    </div>
  );
}
export const authInputCls = "h-[46px] w-full rounded-[9px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent aria-[invalid=true]:border-bad";
export function PasswordInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative flex">
      <input {...p} type={show ? "text" : "password"} className={cx(authInputCls, "pe-10 [&::-ms-reveal]:hidden", !show && !!p.value && "tracking-[.2em]", className)} />
      <button type="button" aria-label={show ? t("Hide password") : t("Show password")} onClick={() => setShow(!show)} className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted hover:text-ink">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}
/** 27F: four 4px segments (red weak, amber fair, green strong) and a hint that says how to improve. */
export function PasswordMeter({ value }: { value: string }) {
  useLang();
  const s = passwordStrength(value);
  const color = s.level === "strong" ? "var(--success)" : s.level === "fair" ? "var(--warning)" : "var(--danger)";
  return (
    <>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <span key={i} className="h-1 flex-1 rounded-[2px]" style={{ background: i <= s.score ? color : "var(--surface-2)" }} />)}
      </div>
      <span className="min-h-[16px] text-[12px] leading-[16px]" style={{ color: s.level ? color : undefined }} aria-live="polite">
        {s.level ? t("{level} · {hint}", { level: t(s.label), hint: t(s.hint) }) : ""}
      </span>
    </>
  );
}
export function OrRule() {
  return <div className="flex items-center gap-2.5 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" /></div>;
}
export function PrimaryButton({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cx("flex h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-accent font-semibold text-accent-fg hover:brightness-105 disabled:opacity-60", className)} />;
}
export function SecondaryButton({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cx("flex h-[42px] w-full shrink-0 items-center justify-center gap-2 rounded-[10px] border border-line text-ink hover:bg-surface disabled:cursor-default", className)} />;
}
/** The design's inline glyphs sit on the text baseline (a box ~6px taller than the glyph, glyph at its bottom). */
const DROP = (size: number) => ({ height: size + 6, alignItems: "flex-end" }) as const;
export type Tone = "info" | "ok" | "danger" | "warning";
const TONE: Record<Tone, [string, string]> = { info: ["var(--info)", "c-info"], ok: ["var(--success)", "s-done"], danger: ["var(--danger)", "c-danger"], warning: ["var(--warning)", "c-warning"] };
/** The tinted message card of the recovery / error screens (27G–27L). */
export function MsgBox({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const [c, g] = TONE[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className="flex flex-col gap-2 rounded-[12px] p-[14px] leading-[20px]"
      style={{ background: `color-mix(in srgb, ${c} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
      <span className="flex items-center gap-2 font-semibold" style={{ color: c }}><Glyph name={g} size={16} style={DROP(16)} />{title}</span>
      {children && <span>{children}</span>}
    </div>
  );
}

/** Settings › Account while accounts are off (27B/27D): a dashed card that says what's coming, nothing to click. */
const COMING: [string, string][] = [
  ["owner", tk("Sign in with Google, email and password, or a magic link")],
  ["date", tk("Email verification and a proper account")],
  ["refresh-cw", tk("Sign out of every device at once")],
  ["export", tk("Export all your data, delete your account")],
];
export function ComingSoonCard() {
  useLang();
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-dashed border-line p-4" style={{ background: "color-mix(in srgb, var(--surface) 50%, transparent)" }} data-accounts-coming>
      <div className="flex items-center gap-2.5">
        <span className="flex-1 font-semibold text-muted">{t("Sign-in and registration")}</span>
        <span className="rounded-full bg-surface-2 px-2 text-[11.5px] font-semibold leading-[20px] text-muted">{t("Coming soon")}</span>
      </div>
      {COMING.map(([g, x]) => <span key={x} className="flex items-center gap-2.5 leading-[19px] text-muted"><Glyph name={g} size={14} style={DROP(14)} />{t(x)}</span>)}
      <span className="text-[12px] text-muted">{t("Today this device uses a passcode. Nothing changes until accounts launch.")}</span>
    </div>
  );
}
/** Unlock screen while accounts are off (27A/27C): one muted line under the passcode flow, no links. */
export function AccountsComingLine({ className }: { className?: string }) {
  useLang();
  return (
    <div className={cx("flex items-center gap-2.5 border-t border-line pt-[14px] text-[12.5px] leading-[18px] text-muted", className)} data-accounts-coming>
      <Glyph name="owner" size={15} style={DROP(15)} /><span>{t("Accounts are coming: sign in with Google or email.")}</span>
    </div>
  );
}
