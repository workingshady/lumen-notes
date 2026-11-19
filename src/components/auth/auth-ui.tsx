// Accounts: shared pieces (Google button, password meter, fields, the "coming soon" card). docs/ACCOUNTS.md
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { passwordStrength } from "../../lib/auth";
import { activeTheme } from "../../lib/settings";
import { cx } from "../ui";

const T = {
  google: "Continue with Google",
  googleLink: "Connect Google",
  show: "Show password",
  hide: "Hide password",
  comingTitle: "Sign-in and registration",
  comingBadge: "Coming soon",
  comingLead: "Today one passcode unlocks sync on each device. Accounts will add:",
  comingItems: [
    "Sign in with Google, email and password, or a magic link",
    "Your own account, with email verification",
    "Your devices in one list, and sign out everywhere",
    "Export all your data, or delete your account",
  ],
  comingFoot: "Nothing changes for you until then.",
  comingLine: "Accounts are coming: sign in with Google, email",
} as const;

/** Google's standard "G" mark (multicolour, unmodified), per the Sign in with Google branding guidelines. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Google's button spec: light = white fill, #747775 1px stroke, #1F1F1F text; dark = #131314 fill, #8E918F stroke,
 * #E3E3E3 text; Roboto Medium 14/20, 12px side padding, 10px between logo and text, pill or rectangle. The logo is never
 * recoloured; the label is one of Google's ("Continue with Google").
 */
export function GoogleButton({ onClick, busy, big, label = T.google, className }: { onClick: () => void; busy?: boolean; big?: boolean; label?: string; className?: string }) {
  const dark = activeTheme().dark;
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={cx("flex w-full items-center justify-center gap-[10px] rounded-full border px-3 disabled:opacity-60", big ? "h-12" : "h-10", className)}
      style={{ background: dark ? "#131314" : "#FFFFFF", borderColor: dark ? "#8E918F" : "#747775", color: dark ? "#E3E3E3" : "#1F1F1F", fontFamily: "Roboto, 'Segoe UI', Arial, sans-serif", fontWeight: 500, fontSize: 14, lineHeight: "20px" }}>
      <GoogleG size={20} /><span>{label}</span>
    </button>
  );
}
export const GOOGLE_LINK_LABEL = T.googleLink;

export function AuthField({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-muted"><span>{label}</span>{hint}</span>
      {children}
      {error && <span className="text-[12px] text-bad" role="alert">{error}</span>}
    </label>
  );
}
export const authInputCls = (big?: boolean) => cx(
  "w-full border border-line bg-bg px-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)] aria-[invalid=true]:border-bad",
  big ? "h-12 rounded-[10px] text-[15px]" : "h-10 rounded-[8px] text-[14px]",
);
export function PasswordInput({ big, ...p }: InputHTMLAttributes<HTMLInputElement> & { big?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative flex">
      <input {...p} type={show ? "text" : "password"} className={cx(authInputCls(big), "pr-11")} />
      <button type="button" aria-label={show ? T.hide : T.show} onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}
/** Four bars + a word; colours follow the app's status tokens. */
export function PasswordMeter({ value }: { value: string }) {
  const s = passwordStrength(value);
  const color = ["var(--line)", "var(--danger)", "var(--warning)", "var(--info)", "var(--success)"][s.score];
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= s.score ? color : "var(--line)" }} />)}</div>
      <span className="w-14 text-right text-[11.5px] text-muted">{s.label}</span>
    </div>
  );
}
export function OrRule({ label }: { label: string }) {
  return <div className="flex items-center gap-3 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />{label}<span className="h-px flex-1 bg-line" /></div>;
}

/** Settings › Account while accounts are off: a muted card that says what's coming (no buttons that do nothing). */
export function ComingSoonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-dashed border-line bg-surface/60 p-4 text-muted">
      <div className="flex items-center gap-2">
        <Sparkles size={15} />
        <span className="font-semibold text-ink/80">{T.comingTitle}</span>
        <span className="rounded-full border border-line px-2 py-[1px] text-[11px] font-medium">{T.comingBadge}</span>
      </div>
      <span className="text-[12.5px] leading-[19px]">{T.comingLead}</span>
      <ul className="flex flex-col gap-1.5 text-[12.5px] leading-[18px]">
        {T.comingItems.map((x) => <li key={x} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />{x}</li>)}
      </ul>
      <span className="text-[12px]">{T.comingFoot}</span>
    </div>
  );
}
/** Unlock screen while accounts are off: one quiet line under the passcode flow. */
export function AccountsComingLine({ className }: { className?: string }) {
  return <div className={cx("flex items-center justify-center gap-1.5 text-[12px] text-muted", className)}><GoogleG size={12} /><span>{T.comingLine}</span></div>;
}
