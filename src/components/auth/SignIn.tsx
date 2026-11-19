// Accounts (active state): sign in · register · check your inbox · forgot / reset password · email-link and Google
// returns. Only shown when the server switch is on (or in the demo preview). docs/ACCOUNTS.md
import { ArrowLeft, CircleAlert, KeyRound, Loader2, Mail, MailCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AuthError, authApi, completeSignIn, deviceInfo, startGoogle, takeAuthReturn, useAccountsConfig, type AuthReturn, type AuthUser,
} from "../../lib/auth";
import { activeTheme } from "../../lib/settings";
import { LumenMark, Wordmark } from "../LumenMark";
import { cx } from "../ui";
import { AuthField, authInputCls, GoogleButton, OrRule, PasswordInput, PasswordMeter } from "./auth-ui";

const T = {
  signInTitle: "Sign in to Lumen",
  signInSub: "Your notebook on every device.",
  email: "Email",
  emailPh: "you@example.com",
  password: "Password",
  forgot: "Forgot?",
  signIn: "Sign in",
  signingIn: "Signing in…",
  magicInstead: "Email me a sign-in link instead",
  passwordInstead: "Use my password instead",
  sendLink: "Send sign-in link",
  sending: "Sending…",
  or: "or",
  newHere: "New to Lumen?",
  create: "Create an account",
  passcode: "Use a passcode instead",
  registerTitle: "Create your account",
  registerSub: "Free, private, and yours to export any time.",
  name: "Name",
  namePh: "What should we call you?",
  newPassword: "Password",
  pwHint: "10+ characters",
  termsA: "I agree to the ",
  terms: "Terms",
  termsAnd: " and ",
  privacy: "Privacy policy",
  creating: "Creating…",
  haveAccount: "Already have an account?",
  inboxTitle: "Check your inbox",
  inboxVerify: (e: string) => `We sent a confirmation link to ${e}. Open it on this device to finish creating your account.`,
  inboxMagic: (e: string) => `If ${e} has a Lumen account, a sign-in link is on its way. It works once, for 15 minutes.`,
  inboxReset: (e: string) => `If ${e} has a Lumen account, a reset link is on its way. It works once, for 30 minutes.`,
  inboxNoMail: "Email isn't set up on this server yet, so no link was sent.",
  resend: "Send again",
  resendIn: (s: number) => `Send again in ${s}s`,
  otherEmail: "Use a different email",
  backToSignIn: "Back to sign in",
  needsVerify: "Confirm your email first.",
  forgotTitle: "Reset your password",
  forgotSub: "We'll email you a link to choose a new one.",
  sendReset: "Send reset link",
  resetTitle: "Choose a new password",
  resetSub: "You'll be signed out on your other devices.",
  saveSignIn: "Save and sign in",
  working: "Signing you in…",
  verifying: "Confirming your email…",
  linkProblem: "That link didn't work",
  googleErrTitle: "Google sign-in didn't finish",
  googleErr: {
    cancelled: "You closed the Google window before choosing an account.",
    "email-unverified": "Your Google account's email isn't verified, so it can't be used to sign in.",
    "already-linked": "That Google account is already connected to another Lumen account.",
    "not-configured": "Google sign-in isn't set up on this server.",
    default: "Something went wrong talking to Google. Please try again.",
  } as Record<string, string>,
  tryAgain: "Try again",
  useEmail: "Use email instead",
  tooMany: (s: number) => `Too many attempts · try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
  left: (n: number) => `Wrong email or password · ${n} ${n === 1 ? "try" : "tries"} left`,
} as const;

type Inbox = { kind: "verify" | "magic" | "reset"; email: string; mail: "sent" | "unavailable" };
type Screen =
  | { s: "signin"; magic?: boolean } | { s: "register" } | { s: "forgot" } | { s: "inbox"; inbox: Inbox }
  | { s: "reset"; token: string } | { s: "working"; label: string } | { s: "problem"; title: string; text: string; google?: boolean };

function usePhone() {
  const [p, setP] = useState(() => innerWidth < 640);
  useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}
const errText = (e: unknown) => {
  if (e instanceof AuthError) {
    const d = e.data as { retryAfterSec?: number; attemptsLeft?: number };
    if (e.status === 429 && d.retryAfterSec) return T.tooMany(d.retryAfterSec);
    if (e.status === 401 && typeof d.attemptsLeft === "number") return T.left(d.attemptsLeft);
    return e.message;
  }
  return String((e as Error)?.message ?? e);
};

/** The whole signed-out flow. `onPasscode` shows the owner's passcode screen instead. */
export function AuthFlow({ onPasscode, initial = "signin" }: { onPasscode?: () => void; initial?: "signin" | "register" }) {
  const cfg = useAccountsConfig();
  const phone = usePhone();
  const [screen, setScreen] = useState<Screen>(() => (initial === "register" ? { s: "register" } : { s: "signin" }));
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = (s: Screen) => { setError(""); setScreen(s); };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const finish = (r: { token: string; user: AuthUser }) => completeSignIn(r);
  const google = () => run(() => startGoogle(false));

  // Opened from an email link or the Google return.
  useEffect(() => {
    const r: AuthReturn | null = takeAuthReturn();
    if (!r || r.kind === "google-linked") return;
    if (r.kind === "google-error") { go({ s: "problem", title: T.googleErrTitle, text: T.googleErr[r.reason] ?? T.googleErr.default, google: true }); return; }
    if (r.kind === "reset") { go({ s: "reset", token: r.token }); return; }
    go({ s: "working", label: r.kind === "verify" ? T.verifying : T.working });
    const path = r.kind === "google" ? "/auth/exchange" : `/auth/${r.kind}/confirm`;
    const json = r.kind === "google" ? { code: r.code, ...deviceInfo() } : { token: r.token, ...deviceInfo() };
    authApi<{ token: string; user: AuthUser }>(path, { json }).then(finish)
      .catch((e) => go({ s: "problem", title: r.kind === "google" ? T.googleErrTitle : T.linkProblem, text: errText(e), google: r.kind === "google" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dark = activeTheme().dark;
  const big = phone;
  const input = authInputCls(big);
  const primary = cx("flex items-center justify-center gap-2 rounded-[10px] bg-accent font-semibold text-accent-fg disabled:opacity-60", big ? "h-12 rounded-[12px] text-[15px]" : "h-10 text-[14px]");
  const link = "font-medium text-link hover:underline";
  const errLine = error && <div className="flex items-start gap-1.5 text-[12.5px] text-bad" role="alert"><CircleAlert size={14} className="mt-[1px] shrink-0" />{error}</div>;
  const passcodeLink = onPasscode && (
    <button type="button" onClick={onPasscode} className="flex items-center justify-center gap-1.5 text-[13px] text-muted hover:text-ink"><KeyRound size={14} />{T.passcode}</button>
  );
  const googleBlock = cfg.providers.google && <><GoogleButton big={big} busy={busy} onClick={() => void google()} /><OrRule label={T.or} /></>;

  let title = "", sub = "", body: ReactNode = null, foot: ReactNode = null, back: (() => void) | null = null;
  switch (screen.s) {
    case "signin": {
      const magic = !!screen.magic && cfg.providers.magic;
      title = T.signInTitle; sub = T.signInSub;
      body = <SignInForm magic={magic} email={email} setEmail={setEmail} busy={busy} input={input} big={big} primary={primary} link={link} errLine={errLine}
        onForgot={() => go({ s: "forgot" })} onToggleMagic={cfg.providers.magic ? () => go({ s: "signin", magic: !magic }) : undefined}
        onSubmit={(pw) => run(async () => {
          if (magic) { const r = await authApi<{ mail: "sent" | "unavailable" }>("/auth/magic", { json: { email } }); go({ s: "inbox", inbox: { kind: "magic", email, mail: r.mail } }); return; }
          try { finish(await authApi("/auth/login", { json: { email, password: pw, ...deviceInfo() } })); }
          catch (e) { if (e instanceof AuthError && e.data.needsVerification) { go({ s: "inbox", inbox: { kind: "verify", email, mail: "sent" } }); return; } throw e; }
        })} />;
      foot = <><span className="text-[13px] text-muted">{T.newHere} <button type="button" className={link} onClick={() => go({ s: "register" })}>{T.create}</button></span>{passcodeLink}</>;
      body = <>{googleBlock}{body}</>;
      break;
    }
    case "register":
      title = T.registerTitle; sub = T.registerSub;
      body = <>{googleBlock}<RegisterForm email={email} setEmail={setEmail} busy={busy} input={input} big={big} primary={primary} errLine={errLine}
        onSubmit={(f) => run(async () => {
          const r = await authApi<{ mail: "sent" | "unavailable" }>("/auth/register", { json: { ...f, email, terms: true, lang: document.documentElement.lang || "en", tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
          go({ s: "inbox", inbox: { kind: "verify", email, mail: r.mail } });
        })} /></>;
      foot = <><span className="text-[13px] text-muted">{T.haveAccount} <button type="button" className={link} onClick={() => go({ s: "signin" })}>{T.signIn}</button></span>{passcodeLink}</>;
      break;
    case "forgot":
      title = T.forgotTitle; sub = T.forgotSub; back = () => go({ s: "signin" });
      body = (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await authApi<{ mail: "sent" | "unavailable" }>("/auth/forgot", { json: { email } }); go({ s: "inbox", inbox: { kind: "reset", email, mail: r.mail } }); }); }}>
          <AuthField label={T.email}><input className={input} type="email" autoComplete="email" required value={email} placeholder={T.emailPh} onChange={(e) => setEmail(e.target.value)} /></AuthField>
          {errLine}
          <button className={primary} disabled={busy || !email}>{busy ? T.sending : T.sendReset}</button>
        </form>
      );
      break;
    case "inbox":
      title = T.inboxTitle; back = () => go({ s: "signin" });
      body = <InboxBody inbox={screen.inbox} primary={primary} errLine={errLine} onOther={() => go({ s: screen.inbox.kind === "verify" ? "register" : "signin" })}
        onResend={() => run(async () => { await authApi(screen.inbox.kind === "verify" ? "/auth/verify/resend" : screen.inbox.kind === "magic" ? "/auth/magic" : "/auth/forgot", { json: { email: screen.inbox.email } }); })} />;
      break;
    case "reset":
      title = T.resetTitle; sub = T.resetSub;
      body = <ResetForm busy={busy} big={big} primary={primary} errLine={errLine}
        onSubmit={(pw) => run(async () => finish(await authApi("/auth/reset", { json: { token: screen.token, password: pw, ...deviceInfo() } })))} />;
      break;
    case "working":
      body = <div className="flex flex-col items-center gap-3 py-6 text-muted"><Loader2 size={22} className="animate-spin text-accent" />{screen.label}</div>;
      break;
    case "problem":
      title = screen.title;
      body = (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-[10px] border border-line bg-bg p-3 text-[13px] leading-[19px] text-muted"><CircleAlert size={16} className="mt-[1px] shrink-0 text-bad" />{screen.text}</div>
          {screen.google && cfg.providers.google && <GoogleButton big={big} busy={busy} onClick={() => void google()} label={T.tryAgain} />}
          <button type="button" className={cx(primary, screen.google && "border border-line bg-transparent text-ink")} onClick={() => go({ s: "signin" })}>{screen.google ? T.useEmail : T.backToSignIn}</button>
        </div>
      );
      foot = passcodeLink;
      break;
  }

  const card = (
    <div className={cx("flex flex-col gap-5", !phone && "rounded-[14px] border border-line bg-surface p-6")} style={!phone && !dark ? { boxShadow: "0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)" } : undefined}>
      {(title || back) && (
        <div className="flex flex-col gap-1">
          {back && <button type="button" onClick={back} className="-ml-1 mb-1 flex w-fit items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={14} />{T.backToSignIn}</button>}
          {title && <h1 className={cx("font-[650] tracking-[-.01em]", phone ? "text-[22px]" : "text-[18px]")}>{title}</h1>}
          {sub && <p className="text-[13px] text-muted">{sub}</p>}
        </div>
      )}
      {body}
    </div>
  );
  const bg = { background: `radial-gradient(${phone ? "420px 320px at 50% -60px" : "720px 440px at 50% -90px"}, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--bg)` };
  return (
    <div className={cx("flex h-full flex-col overflow-y-auto text-ink leading-[normal]", phone ? "safe-t safe-b text-[14px]" : "items-center justify-center text-[13px]")} style={bg} data-auth-screen={screen.s}>
      <div className={cx("flex flex-col gap-6", phone ? "px-5 py-8" : "w-[400px] max-w-[calc(100%-32px)] py-10")}>
        <div className="flex flex-col items-center gap-3"><LumenMark size={phone ? 52 : 48} tile={dark ? "dark" : "light"} /><Wordmark size={phone ? 28 : 26} /></div>
        {card}
        {foot && <div className="flex flex-col items-center gap-3">{foot}</div>}
      </div>
    </div>
  );
}

function SignInForm({ magic, email, setEmail, busy, input, big, primary, link, errLine, onForgot, onToggleMagic, onSubmit }: {
  magic: boolean; email: string; setEmail: (v: string) => void; busy: boolean; input: string; big: boolean; primary: string; link: string; errLine: ReactNode;
  onForgot: () => void; onToggleMagic?: () => void; onSubmit: (pw: string) => void;
}) {
  const [pw, setPw] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!big) ref.current?.focus(); }, [big]);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(pw); }}>
      <AuthField label={T.email}><input ref={ref} className={input} type="email" autoComplete="email" required value={email} placeholder={T.emailPh} onChange={(e) => setEmail(e.target.value)} /></AuthField>
      {!magic && (
        <AuthField label={T.password} hint={<button type="button" className={cx(link, "text-[12px]")} onClick={onForgot}>{T.forgot}</button>}>
          <PasswordInput big={big} autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        </AuthField>
      )}
      {errLine}
      <button className={primary} disabled={busy || !email || (!magic && !pw)}>
        {magic ? <Mail size={15} /> : null}{busy ? (magic ? T.sending : T.signingIn) : magic ? T.sendLink : T.signIn}
      </button>
      {onToggleMagic && <button type="button" className="text-center text-[13px] text-muted hover:text-ink" onClick={onToggleMagic}>{magic ? T.passwordInstead : T.magicInstead}</button>}
    </form>
  );
}

function RegisterForm({ email, setEmail, busy, input, big, primary, errLine, onSubmit }: {
  email: string; setEmail: (v: string) => void; busy: boolean; input: string; big: boolean; primary: string; errLine: ReactNode; onSubmit: (f: { name: string; password: string }) => void;
}) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [terms, setTerms] = useState(false);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (terms) onSubmit({ name, password: pw }); }}>
      <AuthField label={T.name}><input dir="auto" className={input} autoComplete="name" value={name} placeholder={T.namePh} onChange={(e) => setName(e.target.value)} /></AuthField>
      <AuthField label={T.email}><input className={input} type="email" autoComplete="email" required value={email} placeholder={T.emailPh} onChange={(e) => setEmail(e.target.value)} /></AuthField>
      <AuthField label={T.newPassword} hint={<span>{T.pwHint}</span>}>
        <PasswordInput big={big} autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        <PasswordMeter value={pw} />
      </AuthField>
      <label className="flex items-start gap-2.5 text-[13px] leading-[19px] text-muted">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-[2px] size-4 accent-[var(--accent)]" />
        <span>{T.termsA}<a href="/terms" target="_blank" className="text-link">{T.terms}</a>{T.termsAnd}<a href="/privacy" target="_blank" className="text-link">{T.privacy}</a></span>
      </label>
      {errLine}
      <button className={primary} disabled={busy || !email || pw.length < 10 || !terms}>{busy ? T.creating : T.create}</button>
    </form>
  );
}

function ResetForm({ busy, big, primary, errLine, onSubmit }: { busy: boolean; big: boolean; primary: string; errLine: ReactNode; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}>
      <AuthField label={T.newPassword} hint={<span>{T.pwHint}</span>}>
        <PasswordInput big={big} autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        <PasswordMeter value={pw} />
      </AuthField>
      {errLine}
      <button className={primary} disabled={busy || pw.length < 10}>{T.saveSignIn}</button>
    </form>
  );
}

function InboxBody({ inbox, primary, errLine, onResend, onOther }: { inbox: Inbox; primary: string; errLine: ReactNode; onResend: () => Promise<void>; onOther: () => void }) {
  const [wait, setWait] = useState(30);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const text = inbox.mail === "unavailable" ? T.inboxNoMail : inbox.kind === "verify" ? T.inboxVerify(inbox.email) : inbox.kind === "magic" ? T.inboxMagic(inbox.email) : T.inboxReset(inbox.email);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent"><MailCheck size={18} /></span>
        <p className="text-[13px] leading-[20px] text-muted">{text}</p>
      </div>
      {errLine}
      {inbox.mail === "sent" && <button type="button" className={cx(primary, "border border-line bg-transparent text-ink")} disabled={wait > 0} onClick={() => void onResend().then(() => setWait(60))}>{wait > 0 ? T.resendIn(wait) : T.resend}</button>}
      <button type="button" className="text-center text-[13px] text-muted hover:text-ink" onClick={onOther}>{T.otherEmail}</button>
    </div>
  );
}
