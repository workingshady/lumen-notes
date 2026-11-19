// Accounts (active state), design 27E–27L / 27O–27Q / 27T: sign in · register (strength meter + terms) · check your
// inbox · email verified · forgot password · reset link sent · choose a new password · Google error · link expired.
// Only shown when the server switch is on (or in the demo preview). docs/ACCOUNTS.md
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  accountsPreview, AuthError, authApi, authErrorText, completeSignIn, deviceInfo, emailAppUrl, previewScreen, startGoogle, takeAuthReturn,
  useAccountsConfig, type AuthUser, type MailState,
} from "../../lib/auth";
import { t, tk, tx, useLang } from "../../lib/i18n";
import { activeTheme } from "../../lib/settings";
import { localTimeZone } from "../../lib/profile-local";
import { LumenMark } from "../LumenMark";
import { cx } from "../ui";
import { AuthField, authInputCls, GoogleButton, GOOGLE_LABELS, MsgBox, OrRule, PasswordInput, PasswordMeter, PrimaryButton, SecondaryButton } from "./auth-ui";

type LinkKind = "verify" | "magic" | "reset";
type SignedIn = { token: string; user: AuthUser };
type Screen =
  | { s: "signin" } | { s: "register" } | { s: "forgot" }
  | { s: "inbox"; kind: "verify" | "magic"; email: string; mail: MailState }
  | { s: "verified"; result: SignedIn }
  | { s: "reset-sent"; email: string; mail: MailState }
  | { s: "reset"; token: string }
  | { s: "working"; label: string }
  | { s: "google-error"; reason: string }
  | { s: "expired"; kind: LinkKind; token: string }
  | { s: "invalid"; text: string };

/** Google error reasons (worker/ext/auth.ts callback) → what happened, and what to do. */
const GOOGLE_ERR: Record<string, [string, string]> = {
  cancelled: [tk("You closed the Google window or denied access"), tk("Nothing was changed. Try again, or use email instead.")],
  state: [tk("The sign-in took too long or started in another browser"), tk("Nothing was changed. Try again, or use email instead.")],
  "email-unverified": [tk("Your Google account's email isn't verified"), tk("Nothing was changed. Verify it with Google, or use email instead.")],
  "already-linked": [tk("That Google account belongs to another Lumen account"), tk("Nothing was changed. Sign in with that account, or use email instead.")],
  "not-configured": [tk("Google sign-in isn't set up on this server"), tk("Nothing was changed. Use email instead.")],
  default: [tk("Google couldn't confirm who you are"), tk("Nothing was changed. Try again, or use email instead.")],
};
const EXPIRED_TITLE: Record<LinkKind, string> = { verify: tk("Links work for 24 hours"), magic: tk("Sign-in links work for 15 minutes"), reset: tk("Reset links work for 1 hour") };

function usePhone() {
  const [p, setP] = useState(() => innerWidth < 640);
  useEffect(() => { const f = () => setP(innerWidth < 640); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Preview only (`&authScreen=`): open on one screen with the design's sample data. */
function previewInitial(): Screen | null {
  if (!accountsPreview || !previewScreen) return null;
  const sara: AuthUser = { id: "u-preview", email: "sara@uni.edu", emailVerified: true, name: "Sara Kim", avatar: "glyph:owl", lang: "en", tz: "UTC", createdAt: 0, hasPassword: true, passwordChangedAt: null, identities: [] };
  switch (previewScreen) {
    case "register": return { s: "register" };
    case "verify": return { s: "inbox", kind: "verify", email: "sara@uni.edu", mail: "sent" };
    case "verified": return { s: "verified", result: { token: "", user: sara } };
    case "forgot": return { s: "forgot" };
    case "reset-sent": return { s: "reset-sent", email: "amir@nightshift.dev", mail: "sent" };
    case "reset": return { s: "reset", token: "preview" };
    case "google-error": return { s: "google-error", reason: "cancelled" };
    case "expired": return { s: "expired", kind: "verify", token: "preview" };
    default: return null;
  }
}

/** The whole signed-out flow. `onPasscode` shows the owner's passcode screen instead. */
export function AuthFlow({ onPasscode, initial = "signin" }: { onPasscode?: () => void; initial?: "signin" | "register" }) {
  useLang();
  const cfg = useAccountsConfig();
  const phone = usePhone();
  const [screen, setScreen] = useState<Screen>(() => previewInitial() ?? (initial === "register" ? { s: "register" } : { s: "signin" }));
  const [email, setEmail] = useState(() => (previewScreen === "forgot" ? "amir@nightshift.dev" : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = (s: Screen) => { setError(""); setScreen(s); };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(authErrorText(e)); } finally { setBusy(false); }
  };
  const google = () => run(() => startGoogle(false));
  const linkFailed = (kind: LinkKind, token: string, e: unknown) => {
    if (e instanceof AuthError && e.data.code === "expired") go({ s: "expired", kind, token });
    else go({ s: "invalid", text: authErrorText(e) });
  };

  // Opened from an email link or the Google return.
  useEffect(() => {
    const r = takeAuthReturn();
    if (!r || r.kind === "google-linked") return;
    if (r.kind === "google-error") { go({ s: "google-error", reason: r.reason }); return; }
    if (r.kind === "reset") { go({ s: "reset", token: r.token }); return; }
    go({ s: "working", label: r.kind === "verify" ? tk("Confirming your email…") : tk("Signing you in…") });
    if (r.kind === "google") {
      authApi<SignedIn>("/auth/exchange", { json: { code: r.code, ...deviceInfo() } }).then(completeSignIn).catch(() => go({ s: "google-error", reason: "exchange" }));
      return;
    }
    authApi<SignedIn>(`/auth/${r.kind}/confirm`, { json: { token: r.token, ...deviceInfo() } })
      .then((res) => (r.kind === "verify" ? go({ s: "verified", result: res }) : completeSignIn(res)))
      .catch((e) => linkFailed(r.kind, r.token, e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dark = activeTheme().dark;
  const errLine = error && <div className="text-[12.5px] leading-[18px] text-bad" role="alert">{error}</div>;
  const link = "text-link hover:underline";
  const googleBlock = cfg.providers.google && <><GoogleButton busy={busy} onClick={() => void google()} /><OrRule /></>;
  const sendMagic = () => run(async () => {
    if (!email.trim()) { setError(t("Enter your email first.")); document.getElementById("auth-email")?.focus(); return; }
    const r = await authApi<{ mail: MailState }>("/auth/magic", { json: { email } });
    go({ s: "inbox", kind: "magic", email, mail: r.mail });
  });
  const renew = (token: string) => run(async () => {
    const r = await authApi<{ mail: MailState; kind: LinkKind; email: string }>("/auth/link/renew", { json: { token } });
    if (r.kind === "reset") go({ s: "reset-sent", email: r.email, mail: r.mail });
    else go({ s: "inbox", kind: r.kind === "magic" ? "magic" : "verify", email: r.email, mail: r.mail });
  });

  let title = "", sub = "", body: ReactNode = null;
  switch (screen.s) {
    case "signin":
      title = t("Sign in to Lumen"); sub = t("Your notes, paths and cards on every device.");
      body = <>
        {googleBlock}
        <SignInForm email={email} setEmail={setEmail} busy={busy} errLine={errLine} focus={!phone}
          onForgot={() => go({ s: "forgot" })}
          onSubmit={(pw) => run(async () => {
            try { completeSignIn(await authApi<SignedIn>("/auth/login", { json: { email, password: pw, ...deviceInfo() } })); }
            catch (e) {
              if (!(e instanceof AuthError && e.data.needsVerification)) throw e;
              const r = await authApi<{ mail: MailState }>("/auth/verify/resend", { json: { email } }).catch(() => ({ mail: "sent" as MailState }));
              go({ s: "inbox", kind: "verify", email, mail: r.mail });
            }
          })} />
        {cfg.providers.magic && <SecondaryButton disabled={busy} onClick={() => void sendMagic()}>{t("Email me a sign-in link")}</SecondaryButton>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1 text-[12.5px]">
          <span className="text-muted">{t("New here?")} <button type="button" className={link} onClick={() => go({ s: "register" })}>{t("Create an account")}</button></span>
          {onPasscode && <button type="button" className="text-muted hover:text-ink" onClick={onPasscode}>{t("Use a passcode instead")}</button>}
        </div>
      </>;
      break;
    case "register":
      title = t("Create your account"); sub = t("Free. Your notes stay in plain Markdown.");
      body = <RegisterForm email={email} setEmail={setEmail} busy={busy} errLine={errLine} onSignIn={() => go({ s: "signin" })}
        onSubmit={(f) => run(async () => {
          const r = await authApi<{ mail: MailState }>("/auth/register", { json: { ...f, email, terms: true, lang: document.documentElement.lang || "en", tz: localTimeZone() } });
          go({ s: "inbox", kind: "verify", email: email.trim(), mail: r.mail });
        })} />;
      break;
    case "inbox":
      title = t("Check your inbox"); sub = t("We sent a link to {email}.", { email: screen.email });
      body = <InboxBody key={screen.email + screen.kind} screen={screen} busy={busy} errLine={errLine} onBack={() => go({ s: "signin" })}
        onResend={() => run(async () => { await authApi(screen.kind === "verify" ? "/auth/verify/resend" : "/auth/magic", { json: { email: screen.email } }); })} />;
      break;
    case "verified": {
      const first = screen.result.user.name.trim().split(/\s+/)[0];
      title = t("Email verified"); sub = first ? t("Welcome, {name}.", { name: first }) : t("Welcome.");
      body = <>
        <MsgBox tone="ok" title={t("You're all set")}>{t("Your account is ready. Next: pick a theme and name your blog.")}</MsgBox>
        <PrimaryButton onClick={() => completeSignIn(screen.result)}>{t("Continue")}</PrimaryButton>
      </>;
      break;
    }
    case "forgot":
      title = t("Reset your password"); sub = t("We'll email you a link to set a new one.");
      body = (
        <form className="contents" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await authApi<{ mail: MailState }>("/auth/forgot", { json: { email } }); go({ s: "reset-sent", email: email.trim(), mail: r.mail }); }); }}>
          <MsgBox tone="info" title={t("Enter the email you signed up with")} />
          <input id="auth-email" className={cx(authInputCls, "ltr")} type="email" autoComplete="email" required value={email} placeholder={t("you@example.com")} aria-label={t("Email")} onChange={(e) => setEmail(e.target.value)} autoFocus={!phone} />
          {errLine}
          <PrimaryButton disabled={busy || !email}>{busy ? t("Sending…") : t("Send reset link")}</PrimaryButton>
          <SecondaryButton onClick={() => go({ s: "signin" })}>{t("Back to sign in")}</SecondaryButton>
        </form>
      );
      break;
    case "reset-sent":
      title = t("Link sent"); sub = t("Check {email}.", { email: screen.email });
      body = <>
        {screen.mail === "sent"
          ? <MsgBox tone="ok" title={t("Reset link sent")}>{t("It works once and expires in 1 hour.")}</MsgBox>
          : <MsgBox tone="warning" title={t("Email isn't set up on this server yet")}>{t("No link was sent. Ask the person who runs this Lumen to set up email.")}</MsgBox>}
        <PrimaryButton onClick={() => go({ s: "signin" })}>{t("Back to sign in")}</PrimaryButton>
      </>;
      break;
    case "reset":
      title = t("Choose a new password"); sub = t("You'll be signed out on your other devices.");
      body = <ResetForm busy={busy} errLine={errLine}
        onSubmit={(pw) => run(async () => {
          try { completeSignIn(await authApi<SignedIn>("/auth/reset", { json: { token: screen.token, password: pw, ...deviceInfo() } })); }
          catch (e) { if (e instanceof AuthError && e.data.code) linkFailed("reset", screen.token, e); else throw e; }
        })} />;
      break;
    case "working":
      body = <div className="flex flex-col items-center gap-3 py-6 text-muted"><Loader2 size={22} className="animate-spin text-accent" />{t(screen.label)}</div>;
      break;
    case "google-error": {
      const [what, next] = GOOGLE_ERR[screen.reason.startsWith("state-") ? "state" : screen.reason] ?? GOOGLE_ERR.default;
      title = t("Google sign-in didn't finish");
      body = <>
        <MsgBox tone="danger" title={t(what)}>{t(next)}</MsgBox>
        {errLine}
        {cfg.providers.google && screen.reason !== "not-configured" && <PrimaryButton disabled={busy} onClick={() => void google()}>{t(GOOGLE_LABELS.tryAgain)}</PrimaryButton>}
        <SecondaryButton onClick={() => go({ s: "signin" })}>{t("Use email instead")}</SecondaryButton>
      </>;
      break;
    }
    case "expired":
      title = t("This link has expired");
      body = <>
        <MsgBox tone="warning" title={t(EXPIRED_TITLE[screen.kind])}>{t("Ask for a new one and we'll send it right away.")}</MsgBox>
        {errLine}
        <PrimaryButton disabled={busy} onClick={() => void renew(screen.token)}>{busy ? t("Sending…") : t("Send a new link")}</PrimaryButton>
        <SecondaryButton onClick={() => go({ s: "signin" })}>{t("Back to sign in")}</SecondaryButton>
      </>;
      break;
    case "invalid":
      title = t("This link didn't work");
      body = <>
        <MsgBox tone="danger" title={t("It was already used or isn't complete")}>{t("Nothing was changed. Sign in, or ask for a new link.")}</MsgBox>
        <PrimaryButton onClick={() => go({ s: "signin" })}>{t("Back to sign in")}</PrimaryButton>
      </>;
      break;
  }

  return (
    <div className={cx("flex h-full overflow-y-auto bg-bg text-[13px] leading-[normal] text-ink", phone ? "safe-t safe-b items-start" : "items-center")} data-auth-screen={screen.s}>
      <div className={cx("mx-auto flex flex-col gap-[14px]", phone ? "w-full px-5 pb-5 pt-[72px]" : "w-[400px] max-w-[calc(100%-32px)] py-10")}>
        <div className="flex flex-col items-center gap-3 pb-1.5 text-center">
          <LumenMark size={52} tile={dark ? "dark" : "light"} />
          {title && <h1 className="text-[22px] font-[650] tracking-[-.02em]">{title}</h1>}
          {title && <p className="max-w-[360px] leading-[20px] text-muted" dir="auto">{sub}</p>}
        </div>
        {body}
      </div>
    </div>
  );
}

function SignInForm({ email, setEmail, busy, errLine, focus, onForgot, onSubmit }: {
  email: string; setEmail: (v: string) => void; busy: boolean; errLine: ReactNode; focus: boolean; onForgot: () => void; onSubmit: (pw: string) => void;
}) {
  const [pw, setPw] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, [focus]);
  return (
    <form className="contents" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(pw); }}>
      <AuthField label={t("Email")} htmlFor="auth-email">
        <input id="auth-email" ref={ref} className={cx(authInputCls, "ltr")} type="email" autoComplete="email" required value={email} placeholder={t("you@example.com")} onChange={(e) => setEmail(e.target.value)} />
      </AuthField>
      <AuthField label={t("Password")} htmlFor="auth-password" right={<button type="button" className="text-link hover:underline" onClick={onForgot}>{t("Forgot password?")}</button>}>
        <PasswordInput id="auth-password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
      </AuthField>
      {errLine}
      <PrimaryButton disabled={busy || !email || !pw}>{busy ? t("Signing in…") : t("Sign in")}</PrimaryButton>
    </form>
  );
}

function RegisterForm({ email, setEmail, busy, errLine, onSignIn, onSubmit }: {
  email: string; setEmail: (v: string) => void; busy: boolean; errLine: ReactNode; onSignIn: () => void; onSubmit: (f: { name: string; password: string }) => void;
}) {
  const [name, setName] = useState(() => (previewScreen === "register" ? "Sara Kim" : ""));
  const [pw, setPw] = useState("");
  const [terms, setTerms] = useState(previewScreen === "register");
  useEffect(() => { if (previewScreen === "register" && !email) setEmail("sara@uni.edu"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); if (terms) onSubmit({ name, password: pw }); }}>
      <AuthField label={t("Name")} htmlFor="auth-name"><input id="auth-name" dir="auto" className={authInputCls} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></AuthField>
      <AuthField label={t("Email")} htmlFor="auth-email"><input id="auth-email" className={cx(authInputCls, "ltr")} type="email" autoComplete="email" required value={email} placeholder={t("you@example.com")} onChange={(e) => setEmail(e.target.value)} /></AuthField>
      <AuthField label={t("Password")} htmlFor="auth-new-password">
        <PasswordInput id="auth-new-password" autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        <PasswordMeter value={pw} />
      </AuthField>
      <label className="flex cursor-pointer items-start gap-2.5 leading-[19px]">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="peer sr-only" />
        <span aria-hidden="true" className={cx("mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] peer-focus-visible:ring-2 peer-focus-visible:ring-accent", terms ? "bg-accent text-accent-fg" : "border border-line bg-surface")}>
          {terms && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
        </span>
        <span>{tx("I agree to the {terms} and {privacy}.", { terms: <a href="/terms" target="_blank" rel="noreferrer" className="text-link hover:underline">{t("Terms")}</a>, privacy: <a href="/privacy" target="_blank" rel="noreferrer" className="text-link hover:underline">{t("Privacy policy")}</a> })}</span>
      </label>
      {errLine}
      <PrimaryButton disabled={busy || !email || pw.length < 10 || !terms}>{busy ? t("Creating…") : t("Create account")}</PrimaryButton>
      <span className="text-center text-[12.5px] text-muted">{t("Have an account?")} <button type="button" className="text-link hover:underline" onClick={onSignIn}>{t("Sign in")}</button></span>
    </form>
  );
}
function ResetForm({ busy, errLine, onSubmit }: { busy: boolean; errLine: ReactNode; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}>
      <AuthField label={t("New password")} htmlFor="auth-new-password">
        <PasswordInput id="auth-new-password" autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <PasswordMeter value={pw} />
      </AuthField>
      {errLine}
      <PrimaryButton disabled={busy || pw.length < 10}>{t("Save and sign in")}</PrimaryButton>
    </form>
  );
}

/** 27G: the link is on its way; "Open email app"; resend unlocks after a short countdown. */
function InboxBody({ screen, busy, errLine, onResend, onBack }: {
  screen: Extract<Screen, { s: "inbox" }>; busy: boolean; errLine: ReactNode; onResend: () => Promise<void>; onBack: () => void;
}) {
  const [wait, setWait] = useState(60);
  const [sentAgain, setSentAgain] = useState(false);
  useEffect(() => { if (wait <= 0) return; const tm = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(tm); }, [wait]);
  if (screen.mail === "unavailable") {
    return <>
      <MsgBox tone="warning" title={t("Email isn't set up on this server yet")}>{t("No link was sent. Ask the person who runs this Lumen to set up email.")}</MsgBox>
      <PrimaryButton onClick={onBack}>{t("Back to sign in")}</PrimaryButton>
    </>;
  }
  const verify = screen.kind === "verify";
  const lead = verify ? t("It expires in 24 hours.") : t("It works once, for 15 minutes.");
  const tail = wait > 0 ? t("Didn't get it? Check spam, or resend in {time}.", { time: mmss(wait) }) : t("Didn't get it? Check spam, or resend it now.");
  const app = emailAppUrl(screen.email);
  return <>
    <MsgBox tone="info" title={verify ? t("Open the link to finish") : t("Open the link to sign in")}>{sentAgain ? t("We sent a new link.") + " " : ""}{lead} {tail}</MsgBox>
    {errLine}
    <PrimaryButton onClick={() => { if (app.web) window.open(app.url, "_blank", "noopener"); else location.href = app.url; }}>{t("Open email app")}</PrimaryButton>
    <SecondaryButton disabled={busy || wait > 0} aria-disabled={busy || wait > 0} onClick={() => void onResend().then(() => { setSentAgain(true); setWait(60); })}>{t("Resend link")}</SecondaryButton>
  </>;
}
