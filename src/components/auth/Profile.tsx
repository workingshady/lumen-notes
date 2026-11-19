// Settings › Account, design 27B/27D (off) and 27M/27N/27R/27S (active): the profile header (avatar with edit badge,
// name, email + Verified), the profile table (each row's action edits in place), and — signed in — sign-in methods,
// sessions and devices ("Sign out everywhere" = every other session), and the danger zone (export .zip, delete with
// a typed confirmation). Every action calls the real route (worker/ext/auth.ts) or, in the demo preview, its stand-in.
import { Loader2, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  authApi, authErrorText, deletePhrase, onEmailChange, peekAuthReturn, signOut, signOutOthers, startGoogle, takeAuthReturn, timeZones, tzOffset,
  useAccountsConfig, type AuthSession, type AuthUser,
} from "../../lib/auth";
import { downloadAccountZip } from "../../lib/auth-export";
import { cropAvatar } from "../../lib/home-meta";
import { t, tk, tx, useLang } from "../../lib/i18n";
import { AVATAR_CHOICES, avatarColor, avatarGlyph } from "../../lib/space-icon";
import { toast } from "../../lib/store";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { GoogleG, PasswordInput, PasswordMeter } from "./auth-ui";

// ------------------------------------------------------------------ shared pieces (also used by the "off" state)
function usePhone() {
  const [p, setP] = useState(() => innerWidth < 768);
  useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}
export const isPhoto = (a: string) => a.startsWith("data:image/");
const GLYPH_NAMES: Record<string, string> = { owl: tk("Owl"), flame: tk("Flame"), book: tk("Book") };
/** "Owl glyph · amber" (27B), "Photo". */
export function avatarLabel(value: string, photo: boolean) {
  if (photo) return t("Photo");
  const g = avatarGlyph(value);
  return t("{glyph} glyph · {color}", { glyph: t(GLYPH_NAMES[g] ?? g), color: avatarColor(g) === "var(--accent)" ? t("amber") : t("yellow") });
}
export const LANG_LABEL: Record<string, string> = { auto: tk("Automatic (device)"), en: "English", ar: "العربية" };
export const tzLabel = (tz: string) => `${tz} · ${tzOffset(tz)}`;

/** 64px round avatar (glyph on an 18% tint, or a photo) with the 24px edit badge (27B/27M). */
export function BigAvatar({ value, photo, onEdit }: { value: string; photo?: string; onEdit: () => void }) {
  const g = avatarGlyph(value);
  const c = avatarColor(g) === "var(--accent)" ? "#F2A93B" : avatarColor(g);
  return (
    <div className="relative shrink-0">
      <span className="flex size-16 items-center justify-center overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${c} 18%, transparent)` }}>
        {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <Glyph name={g} size={30} color={c} />}
      </span>
      <button type="button" aria-label={t("Change avatar")} onClick={onEdit}
        className="absolute -bottom-0.5 -end-0.5 flex size-6 items-center justify-center rounded-full border-2 border-bg bg-surface-2 text-ink hover:text-accent">
        <Pencil size={11} strokeWidth={2.4} />
      </button>
    </div>
  );
}
export function ProfileHead({ avatar, photo, name, line, verified, onAvatar }: { avatar: string; photo?: string; name: string; line: ReactNode; verified?: boolean | null; onAvatar: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-[14px]">
      <BigAvatar value={avatar} photo={photo} onEdit={onAvatar} />
      <div className="flex min-w-[160px] flex-1 flex-col gap-[3px]">
        <span dir="auto" className="self-start text-[17px] font-[650]">{name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-muted">
          {line}
          {verified === true && <span className="rounded-full px-[7px] text-[11.5px] font-semibold leading-[19px] text-ok" style={{ background: "color-mix(in srgb, var(--success) 14%, transparent)" }}>{t("Verified")}</span>}
          {verified === false && <span className="rounded-full px-[7px] text-[11.5px] font-semibold leading-[19px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }}>{t("Not verified")}</span>}
        </span>
      </div>
    </div>
  );
}
/** A bordered list (r12) of rows on the surface colour; the first row has no top border. */
export function Table({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col overflow-hidden rounded-[12px] border border-line [&>*+*]:border-t [&>*+*]:border-line">{children}</div>;
}
/** One profile row: label (110px, phone 84px) · value · action (12px muted). `editor` replaces the value while editing. */
export function ProfileRow({ label, value, action, onAction, editing, editor, below }: {
  label: string; value: ReactNode; action: string; onAction: () => void; editing?: boolean; editor?: ReactNode; below?: ReactNode;
}) {
  const phone = usePhone();
  return (
    <div className="bg-surface">
      <div className="flex min-h-[46px] items-center gap-3 px-[14px]">
        <span className="shrink-0 text-muted" style={{ width: phone ? 84 : 110 }}>{label}</span>
        <span className="min-w-0 flex-1 truncate">{editing && editor ? editor : value}</span>
        <button type="button" onClick={onAction} className={cx("shrink-0 text-[12px] hover:text-ink", editing ? "font-semibold text-accent" : "text-muted")}>{action}</button>
      </div>
      {below}
    </div>
  );
}
const rowInput = "h-8 w-full rounded-[7px] border border-accent bg-bg px-2 text-[13px] text-ink outline-none";
/** Inline text editor: Enter saves, Escape cancels. */
export function InlineText({ value, onSave, onCancel, type = "text", ltr }: { value: string; onSave: (v: string) => void; onCancel: () => void; type?: string; ltr?: boolean }) {
  const [v, setV] = useState(value);
  return <input autoFocus type={type} dir={ltr ? "ltr" : "auto"} className={rowInput} value={v} onChange={(e) => setV(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") onSave(v.trim()); if (e.key === "Escape") onCancel(); }} onBlur={() => onSave(v.trim())} />;
}
export function InlineSelect({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <select autoFocus className={rowInput} value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
}
export const tzOptions = (cur: string): [string, string][] => { const z = timeZones(); return (z.includes(cur) ? z : [cur, ...z]).map((x) => [x, tzLabel(x)]); };

/** Avatar picker under the Avatar row (or opened from the edit badge): glyph tiles, a photo, back to a glyph. */
export function AvatarPicker({ value, photo, onGlyph, onPhoto, onRemovePhoto, onClose }: {
  value: string; photo: boolean; onGlyph: (v: string) => void; onPhoto: (dataUrl: string) => void; onRemovePhoto: () => void; onClose: () => void;
}) {
  const pick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { onPhoto(await cropAvatar(f)); } catch { toast(t("Couldn't read that image.")); } };
    inp.click();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-[14px] py-2.5" role="radiogroup" aria-label={t("Avatar")} data-avatar-picker
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      {AVATAR_CHOICES.map((a) => {
        const on = !photo && `glyph:${avatarGlyph(value)}` === a;
        const g = a.slice(6);
        return (
          <button key={a} type="button" role="radio" aria-checked={on} aria-label={t(GLYPH_NAMES[g] ?? g)} onClick={() => onGlyph(a)}
            className="flex size-9 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${avatarColor(g) === "var(--accent)" ? "#F2A93B" : avatarColor(g)} 18%, transparent)`, boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : undefined }}>
            <Glyph name={g} size={17} color={avatarColor(g) === "var(--accent)" ? "#F2A93B" : avatarColor(g)} />
          </button>
        );
      })}
      <button type="button" onClick={pick} className="h-[30px] rounded-[8px] border border-line px-3 hover:bg-surface-2">{t("Upload photo")}</button>
      {photo && <button type="button" onClick={onRemovePhoto} className="h-[30px] rounded-[8px] px-2 text-muted hover:text-ink">{t("Use a glyph")}</button>}
      <button type="button" onClick={onClose} className="ms-auto text-[12px] font-semibold text-accent">{t("Done")}</button>
    </div>
  );
}

// ------------------------------------------------------------------ active profile
const ago = (ts: number, now = Date.now()) => {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 5) return t("active now");
  if (m < 60) return t("{n} min ago", { n: m });
  if (m < 24 * 60) return t("{n} h ago", { n: Math.floor(m / 60) });
  return t("{n} day ago|{n} days ago", { n: Math.floor(m / 1440) });
};
const smallBtn = "flex h-[30px] shrink-0 items-center gap-1.5 rounded-[8px] border border-line px-3 hover:bg-surface-2 disabled:opacity-50";

export function Profile() {
  useLang();
  const cfg = useAccountsConfig();
  const phone = usePhone();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [fail, setFail] = useState("");
  const [edit, setEdit] = useState<"" | "name" | "email" | "lang" | "tz" | "avatar" | "password">("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ at: string; text: string } | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [del, setDel] = useState("");
  const zones = useMemo(() => (user ? tzOptions(user.tz) : []), [user?.tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    try {
      const [{ user: u }, { sessions: s }] = await Promise.all([authApi<{ user: AuthUser }>("/auth/me"), authApi<{ sessions: AuthSession[] }>("/auth/sessions")]);
      setUser(u); setSessions(s);
    } catch (e) { setFail(authErrorText(e) || t("Couldn't load your account.")); }
  };
  useEffect(() => {
    if (peekAuthReturn()?.kind === "google-linked") { takeAuthReturn(); toast(t("Google linked")); }
    void load();
    return onEmailChange((r) => { if (r.ok) void load(); });
  }, []);
  const act = async (at: string, fn: () => Promise<void>) => {
    setBusy(at); setErr(null);
    try { await fn(); } catch (e) { setErr({ at, text: authErrorText(e) }); } finally { setBusy(""); }
  };
  const errAt = (at: string) => err?.at === at && <div className="px-[14px] pb-2.5 text-[12.5px] text-bad" role="alert">{err.text}</div>;
  const save = (at: string, patch: Partial<Pick<AuthUser, "name" | "avatar" | "lang" | "tz">>) => act(at, async () => {
    const r = await authApi<{ user: AuthUser }>("/auth/me", { method: "PUT", json: patch }); setUser(r.user); setEdit("");
  });

  if (fail) return <div className="text-bad" data-account="profile">{fail}</div>;
  if (!user) return <div className="flex items-center gap-2 text-muted" data-account="profile"><Loader2 size={15} className="animate-spin" /></div>;
  const google = user.identities.find((i) => i.provider === "google");
  const phrase = deletePhrase(user);
  const toggle = (k: typeof edit) => setEdit(edit === k ? "" : k);

  return (
    <div className={cx("flex max-w-[820px] flex-col text-[13px] leading-[normal]", phone ? "gap-2.5" : "gap-3")} data-account="profile">
      <span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{t("Account")}</span>
      <ProfileHead avatar={user.avatar} photo={isPhoto(user.avatar) ? user.avatar : undefined} name={user.name || user.email} verified={user.emailVerified}
        line={<span className="ltr">{user.email}</span>} onAvatar={() => toggle("avatar")} />
      <Table>
        <ProfileRow label={t("Name")} value={<span dir="auto">{user.name}</span>} action={edit === "name" ? t("Save") : t("Edit")} editing={edit === "name"}
          onAction={() => (edit === "name" ? setEdit("") : setEdit("name"))}
          editor={<InlineText value={user.name} onCancel={() => setEdit("")} onSave={(v) => (v !== user.name ? void save("name", { name: v }) : setEdit(""))} />}
          below={errAt("name")} />
        <ProfileRow label={t("Email")} value={<span className="ltr">{user.email}</span>} action={edit === "email" ? t("Cancel") : t("Change")} onAction={() => toggle("email")}
          below={edit === "email" ? <EmailChange user={user} onDone={() => setEdit("")} /> : null} />
        <ProfileRow label={t("Language")} value={t(LANG_LABEL[user.lang] ?? user.lang)} action={edit === "lang" ? t("Done") : t("Change")} editing={edit === "lang"} onAction={() => toggle("lang")}
          editor={<InlineSelect value={user.lang} options={[["en", "English"], ["ar", "العربية"]]} onChange={(v) => void save("lang", { lang: v })} />} below={errAt("lang")} />
        <ProfileRow label={t("Time zone")} value={<span className="ltr">{tzLabel(user.tz)}</span>} action={edit === "tz" ? t("Done") : t("Change")} editing={edit === "tz"} onAction={() => toggle("tz")}
          editor={<InlineSelect value={user.tz} options={zones} onChange={(v) => void save("tz", { tz: v })} />} below={errAt("tz")} />
        {edit === "avatar" && (
          <div className="bg-surface">
            <AvatarPicker value={user.avatar} photo={isPhoto(user.avatar)} onClose={() => setEdit("")}
              onGlyph={(a) => void save("avatar", { avatar: a })} onPhoto={(d) => void save("avatar", { avatar: d })} onRemovePhoto={() => void save("avatar", { avatar: "glyph:owl" })} />
            {errAt("avatar")}
          </div>
        )}
      </Table>

      {/* sign-in methods */}
      <div className="flex flex-col gap-2">
        <span className="font-semibold">{t("Sign-in methods")}</span>
        <Table>
          <div className="bg-surface">
            <div className="flex min-h-[50px] items-center gap-3 px-[14px] py-1.5">
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-white"><GoogleG size={14} /></span>
              <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">Google</span><span className="truncate text-[12px] text-muted">{google ? google.email : t("Not linked")}</span></div>
              {google
                ? <button type="button" className={cx(smallBtn, "text-bad")} disabled={!user.hasPassword || busy === "google"} title={user.hasPassword ? undefined : t("Add a password first, so you can still sign in.")}
                    onClick={() => void act("google", async () => { const r = await authApi<{ user: AuthUser }>("/auth/identities/google", { method: "DELETE" }); setUser(r.user); toast(t("Google unlinked")); })}>{t("Unlink")}</button>
                : cfg.providers.google && <button type="button" className={smallBtn} disabled={busy === "google"} onClick={() => void act("google", () => startGoogle(true))}>{t("Link")}</button>}
            </div>
            {errAt("google")}
          </div>
          <div className="bg-surface">
            <div className="flex min-h-[50px] items-center gap-3 px-[14px] py-1.5">
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[12px] font-bold" style={{ fontFamily: "Arial, sans-serif" }}>@</span>
              <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{t("Email and password")}</span><span className="truncate text-[12px] text-muted">{user.hasPassword ? <span className="ltr">{user.email}</span> : t("No password yet")}</span></div>
              {edit !== "password" && <button type="button" className={smallBtn} onClick={() => setEdit("password")}>{user.hasPassword ? t("Change password") : t("Add password")}</button>}
            </div>
            {edit === "password" && <PasswordChange has={user.hasPassword} onDone={(ended) => { setEdit(""); void load(); toast(ended ? t("Password saved. Other devices were signed out.") : t("Password saved")); }} onCancel={() => setEdit("")} />}
          </div>
        </Table>
      </div>

      {/* sessions */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 font-semibold">{t("Sessions and devices")}</span>
          <button type="button" className="text-[12.5px] text-bad hover:underline disabled:opacity-50" disabled={busy === "others" || sessions.length < 2}
            title={sessions.length < 2 ? t("No other sessions") : t("Signs out every other device; this one stays signed in.")}
            onClick={() => void act("others", async () => { const n = await signOutOthers(); setSessions((s) => s.filter((x) => x.current)); toast(t("Signed out of {n} other device|Signed out of {n} other devices", { n })); })}>{t("Sign out everywhere")}</button>
        </div>
        <Table>
          {sessions.map((s) => {
            const live = s.current || Date.now() - s.lastSeen < 24 * 3600_000;
            return (
              <div key={s.id} className="flex min-h-[46px] items-center gap-3 bg-surface px-[14px] py-1.5" data-session={s.current ? "current" : "other"}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: live ? "var(--success)" : "var(--muted)" }} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.current ? t("{device} · this device", { device: s.device }) : s.device}</span>
                  <span className="truncate text-[12px] text-muted">{t(s.platform)} · {s.current ? t("active now") : ago(s.lastSeen)}</span>
                </div>
                {!s.current && <button type="button" className="shrink-0 text-[12.5px] text-muted hover:text-ink disabled:opacity-50" disabled={busy === "s" + s.id}
                  onClick={() => void act("s" + s.id, async () => { await authApi("/auth/sessions/" + s.id, { method: "DELETE" }); setSessions((x) => x.filter((y) => y.id !== s.id)); })}>{t("Sign out")}</button>}
              </div>
            );
          })}
        </Table>
        {err && err.at.startsWith("s") && err.at !== "s" && <div className="text-[12.5px] text-bad" role="alert">{err.text}</div>}
        {errAt("others")}
        <button type="button" className="self-start text-[12.5px] text-muted hover:text-ink" onClick={() => void signOut()}>{t("Sign out on this device")}</button>
      </div>

      {/* danger zone */}
      <div className="flex flex-col gap-2">
        <span className="font-semibold text-bad">{t("Danger zone")}</span>
        <div className="shrink-0 overflow-hidden rounded-[12px]" style={{ border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)" }}>
          <div className="flex min-h-[52px] items-center gap-3 bg-surface px-[14px] py-1.5">
            <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{t("Export all my data")}</span><span className="text-[12px] text-muted">{t(".zip with every note, file, card and setting")}</span></div>
            <button type="button" className={smallBtn} disabled={busy === "export"}
              onClick={() => void act("export", async () => { const r = await downloadAccountZip(); toast(t("Exported {file}", { file: r.file })); })}>
              {busy === "export" ? <Loader2 size={13} className="animate-spin" /> : null}{t("Export")}</button>
          </div>
          {errAt("export")}
          <div className="flex flex-col gap-2.5 px-[14px] py-3" style={{ borderTop: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 6%, var(--surface))" }}>
            <div className="flex flex-col"><span className="font-medium">{t("Delete my account")}</span><span className="text-[12px] text-muted">{t("Removes all notes and files. Can't be undone.")}</span></div>
            {delOpen ? (
              <form className="contents" onSubmit={(e) => { e.preventDefault(); if (del.trim().toLowerCase() === phrase) void act("del", async () => { await authApi("/auth/delete", { json: { confirm: del } }); await signOut(); }); }}>
                <span className="text-[12.5px]">{tx("Type {phrase} to confirm", { phrase: <b className="font-mono font-bold" dir="ltr">{phrase}</b> })}</span>
                <div className="flex gap-2">
                  <input autoFocus value={del} onChange={(e) => setDel(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setDelOpen(false); setDel(""); } }}
                    autoComplete="off" spellCheck={false} dir="ltr" aria-label={t("Type {phrase} to confirm", { phrase })}
                    className="h-[40px] min-w-0 flex-1 rounded-[8px] border border-bad bg-bg px-2.5 font-mono text-ink caret-[var(--danger)] outline-none" />
                  <button className="flex h-[38px] shrink-0 items-center rounded-[8px] px-[14px] font-semibold disabled:opacity-45" style={{ background: "var(--danger)", color: "#1A0B0B" }}
                    disabled={del.trim().toLowerCase() !== phrase || busy === "del"}>{busy === "del" ? t("Deleting…") : t("Delete forever")}</button>
                </div>
                {errAt("del")}
              </form>
            ) : (
              <button type="button" onClick={() => setDelOpen(true)} className="flex h-[30px] items-center self-start rounded-[8px] px-3 text-bad hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]"
                style={{ border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)" }}>{t("Delete account…")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Profile › Email › Change: new address (+ current password) → a link to the new address; nothing changes until then. */
function EmailChange({ user, onDone }: { user: AuthUser; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  if (sent) return (
    <div className="flex items-center gap-3 border-t border-line px-[14px] py-2.5 text-[12.5px] leading-[18px]">
      <Glyph name="c-info" size={15} color="var(--info)" /><span className="flex-1">{t("We sent a link to {email}. Your email changes when you open it.", { email: sent })}</span>
      <button type="button" className="text-[12px] font-semibold text-accent" onClick={onDone}>{t("Done")}</button>
    </div>
  );
  return (
    <form className="flex flex-col gap-2 border-t border-line px-[14px] py-2.5" onSubmit={(e) => { e.preventDefault(); setBusy(true); setErr("");
      authApi<{ email: string }>("/auth/email", { json: { email, password: pw } }).then((r) => setSent(r.email)).catch((x) => setErr(authErrorText(x))).finally(() => setBusy(false)); }}>
      <input ref={ref} type="email" required dir="ltr" autoComplete="email" placeholder={t("New email")} value={email} onChange={(e) => setEmail(e.target.value)} className={rowInput} aria-label={t("New email")} />
      {user.hasPassword && <PasswordInput autoComplete="current-password" placeholder={t("Current password")} aria-label={t("Current password")} value={pw} onChange={(e) => setPw(e.target.value)} className="!h-8 !rounded-[7px] !bg-bg" />}
      {err && <span className="text-[12.5px] text-bad" role="alert">{err}</span>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] text-muted">{t("We'll send a link to the new address. Your email changes when you open it.")}</span>
        <button className={smallBtn} disabled={busy || !email || (user.hasPassword && !pw)}>{busy ? t("Sending…") : t("Send link")}</button>
      </div>
    </form>
  );
}

function PasswordChange({ has, onDone, onCancel }: { has: boolean; onDone: (endedOthers: boolean) => void; onCancel: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form className="flex flex-col gap-2 border-t border-line px-[14px] py-2.5" onSubmit={(e) => { e.preventDefault(); setBusy(true); setErr("");
      authApi("/auth/password", { json: { current: cur, next } }).then(() => onDone(true)).catch((x) => setErr(authErrorText(x))).finally(() => setBusy(false)); }}>
      {has && <PasswordInput autoFocus autoComplete="current-password" placeholder={t("Current password")} aria-label={t("Current password")} value={cur} onChange={(e) => setCur(e.target.value)} className="!h-9 !bg-bg" />}
      <PasswordInput autoFocus={!has} autoComplete="new-password" minLength={10} placeholder={t("New password")} aria-label={t("New password")} value={next} onChange={(e) => setNext(e.target.value)} className="!h-9 !bg-bg" />
      <PasswordMeter value={next} />
      {err && <span className="text-[12.5px] text-bad" role="alert">{err}</span>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="h-[30px] px-2 text-muted hover:text-ink" onClick={onCancel}>{t("Cancel")}</button>
        <button className={cx(smallBtn, "bg-accent font-semibold text-accent-fg hover:bg-accent")} disabled={busy || next.length < 10 || (has && !cur)}>{t("Save password")}</button>
      </div>
    </form>
  );
}
