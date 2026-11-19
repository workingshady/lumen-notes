// Accounts (active state): the profile page — avatar, name, email + verified badge, language, time zone, sign-in
// methods (Google link/unlink, password), sessions and devices, export, delete with typed confirmation.
import { BadgeCheck, CircleAlert, Download, ImagePlus, KeyRound, Laptop, Loader2, LogOut, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AuthError, authApi, accountsPreview, downloadExport, peekAuthReturn, signOut, startGoogle, takeAuthReturn, timeZones, useAccountsConfig, type AuthSession, type AuthUser,
} from "../../lib/auth";
import { cropAvatar } from "../../lib/home-meta";
import { AVATAR_CHOICES } from "../../lib/space-icon";
import { toast } from "../../lib/store";
import { AvatarGlyph } from "../SpaceIcon";
import { Button, cx, inputCls, relTime } from "../ui";
import { AuthField, GoogleButton, GoogleG, GOOGLE_LINK_LABEL, PasswordInput, PasswordMeter } from "./auth-ui";

const T = {
  title: "Account",
  hint: "Your profile and how you sign in.",
  verified: "Verified",
  unverified: "Not verified",
  photo: "Upload photo",
  removePhoto: "Use a glyph",
  name: "Name",
  language: "Language",
  tz: "Time zone",
  langs: { en: "English", ar: "العربية" } as Record<string, string>,
  save: "Save profile",
  saved: "Profile saved",
  methods: "Sign-in methods",
  google: "Google",
  googleNot: "Not connected",
  disconnect: "Disconnect",
  password: "Password",
  passwordSet: (d: string) => `Set · changed ${d}`,
  passwordNone: "No password yet",
  change: "Change password",
  add: "Add a password",
  current: "Current password",
  next: "New password",
  savePw: "Save password",
  pwSaved: "Password saved. Other devices were signed out.",
  cancel: "Cancel",
  sessions: "Devices and sessions",
  thisDevice: "This device",
  lastActive: (t: string) => `Active ${t}`,
  via: { google: "Google", password: "Password", magic: "Magic link", email: "Email link" } as Record<string, string>,
  signOut: "Sign out",
  signOutAll: "Sign out everywhere",
  danger: "Danger zone",
  export: "Export my data",
  exportHint: "One JSON file: profile, devices and every note and record.",
  del: "Delete account",
  delHint: "Deletes your account and all of its data from the server. Export first: this can't be undone.",
  delType: (e: string) => `Type ${e} to confirm`,
  delGo: "Delete my account",
  linked: "Google connected",
  loadFail: "Couldn't load your account.",
  badImage: "Couldn't read that image.",
  addPwFirst: "Add a password first",
} as const;

const isPhoto = (a: string) => a.startsWith("data:image/");
export function UserAvatar({ value, size }: { value: string; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2" style={{ width: size, height: size }}>
      {isPhoto(value) ? <img src={value} alt="" className="size-full object-cover" /> : <AvatarGlyph value={value} size={Math.round(size * 0.4)} />}
    </span>
  );
}
const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-baseline justify-between gap-2"><h2 className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">{title}</h2>{right}</div>
    <div className="flex flex-col rounded-[12px] border border-line bg-surface">{children}</div>
  </section>
);
const Row = ({ children, first }: { children: ReactNode; first?: boolean }) => <div className={cx("flex flex-wrap items-center gap-3 px-4 py-3", !first && "border-t border-line")}>{children}</div>;

export function Profile() {
  const cfg = useAccountsConfig();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [fail, setFail] = useState("");
  const [draft, setDraft] = useState({ name: "", avatar: "glyph:owl", lang: "en", tz: "UTC" });
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [del, setDel] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ at: string; text: string } | null>(null);
  const zones = useMemo(timeZones, []);

  const load = async () => {
    try {
      const [{ user: u }, { sessions: s }] = await Promise.all([authApi<{ user: AuthUser }>("/auth/me"), authApi<{ sessions: AuthSession[] }>("/auth/sessions")]);
      setUser(u); setSessions(s); setDraft({ name: u.name, avatar: u.avatar, lang: u.lang, tz: u.tz });
    } catch (e) { setFail((e as Error).message || T.loadFail); }
  };
  useEffect(() => {
    if (peekAuthReturn()?.kind === "google-linked") { takeAuthReturn(); toast(T.linked); }
    void load();
  }, []);
  const act = async (at: string, fn: () => Promise<void>) => {
    setBusy(at); setErr(null);
    try { await fn(); } catch (e) { setErr({ at, text: e instanceof AuthError ? e.message : String(e) }); } finally { setBusy(""); }
  };
  const errAt = (at: string) => err?.at === at && <div className="flex items-start gap-1.5 text-[12.5px] text-bad" role="alert"><CircleAlert size={14} className="mt-[1px] shrink-0" />{err.text}</div>;

  if (fail) return <div className="text-bad">{fail}</div>;
  if (!user) return <div className="flex items-center gap-2 text-muted"><Loader2 size={15} className="animate-spin" /></div>;
  const google = user.identities.find((i) => i.provider === "google");
  const dirty = draft.name !== user.name || draft.avatar !== user.avatar || draft.lang !== user.lang || draft.tz !== user.tz;
  const pick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try { const url = await cropAvatar(f); setDraft((d) => ({ ...d, avatar: url })); } catch { toast(T.badImage); }
    };
    inp.click();
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-6" data-account="profile">
      {/* header */}
      <div className="flex items-center gap-4">
        <UserAvatar value={draft.avatar || user.avatar} size={64} />
        <div className="flex min-w-0 flex-col gap-1">
          <span dir="auto" className="truncate text-[20px] font-[650]">{user.name || user.email}</span>
          <span className="flex flex-wrap items-center gap-2 text-muted">
            <span className="truncate">{user.email}</span>
            {user.emailVerified
              ? <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-[1px] text-[11.5px] font-medium text-ok"><BadgeCheck size={12} />{T.verified}</span>
              : <span className="rounded-full bg-surface-2 px-2 py-[1px] text-[11.5px] font-medium text-warn">{T.unverified}</span>}
          </span>
        </div>
      </div>

      {/* profile */}
      <Section title={T.title}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Avatar">
            {AVATAR_CHOICES.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={draft.avatar === a} aria-label={a.slice(6)} onClick={() => setDraft({ ...draft, avatar: a })}
                className="flex size-10 items-center justify-center rounded-full bg-surface-2" style={draft.avatar === a ? { boxShadow: "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)" } : undefined}>
                <AvatarGlyph value={a} size={16} />
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={pick}><ImagePlus size={14} />{T.photo}</Button>
            {isPhoto(draft.avatar) && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, avatar: "glyph:owl" })}>{T.removePhoto}</Button>}
          </div>
          <AuthField label={T.name}><input dir="auto" className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></AuthField>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <AuthField label={T.language}>
              <select className={inputCls} value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value })}>
                {Object.entries(T.langs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </AuthField>
            <AuthField label={T.tz}>
              <select className={inputCls} value={draft.tz} onChange={(e) => setDraft({ ...draft, tz: e.target.value })}>
                {(zones.includes(draft.tz) ? zones : [draft.tz, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            </AuthField>
          </div>
          {errAt("profile")}
          <div><Button size="sm" variant="primary" disabled={!dirty || busy === "profile"} onClick={() => void act("profile", async () => {
            const r = await authApi<{ user: AuthUser }>("/auth/me", { method: "PUT", json: draft }); setUser(r.user); toast(T.saved);
          })}>{T.save}</Button></div>
        </div>
      </Section>

      {/* sign-in methods */}
      <Section title={T.methods}>
        <Row first>
          <span className="flex size-8 items-center justify-center rounded-full border border-line bg-bg"><GoogleG size={16} /></span>
          <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{T.google}</span><span className="truncate text-[12px] text-muted">{google ? google.email : T.googleNot}</span></span>
          {google
            ? <Button size="sm" variant="ghost" disabled={!user.hasPassword || busy === "google"} title={user.hasPassword ? undefined : T.addPwFirst}
                onClick={() => void act("google", async () => { const r = await authApi<{ user: AuthUser }>("/auth/identities/google", { method: "DELETE" }); setUser(r.user); })}>{T.disconnect}</Button>
            : cfg.providers.google && <div className="w-[190px]"><GoogleButton label={GOOGLE_LINK_LABEL} onClick={() => void act("google", () => startGoogle(true))} /></div>}
        </Row>
        {errAt("google")}
        <Row>
          <span className="flex size-8 items-center justify-center rounded-full border border-line bg-bg text-muted"><KeyRound size={15} /></span>
          <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{T.password}</span>
            <span className="text-[12px] text-muted">{user.hasPassword ? T.passwordSet(relTime(user.passwordChangedAt ?? user.createdAt)) : T.passwordNone}</span></span>
          {!pwOpen && <Button size="sm" variant="ghost" onClick={() => setPwOpen(true)}>{user.hasPassword ? T.change : T.add}</Button>}
        </Row>
        {pwOpen && (
          <form className="flex flex-col gap-3 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); void act("pw", async () => {
            await authApi("/auth/password", { json: pw }); setPw({ current: "", next: "" }); setPwOpen(false); toast(T.pwSaved); await load();
          }); }}>
            {user.hasPassword && <AuthField label={T.current}><PasswordInput autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></AuthField>}
            <AuthField label={T.next}><PasswordInput autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><PasswordMeter value={pw.next} /></AuthField>
            {errAt("pw")}
            <div className="flex gap-2"><Button size="sm" variant="primary" disabled={pw.next.length < 10 || busy === "pw"}>{T.savePw}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setPwOpen(false)}>{T.cancel}</Button></div>
          </form>
        )}
      </Section>

      {/* sessions */}
      <Section title={T.sessions} right={<button type="button" className="text-[12.5px] text-link hover:underline" onClick={() => void signOut(true)}>{T.signOutAll}</button>}>
        {sessions.map((s, i) => (
          <Row key={s.id} first={i === 0}>
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-muted">{s.platform === "android" || s.platform === "ios" ? <Smartphone size={15} /> : <Laptop size={15} />}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 font-medium"><span className="truncate">{s.device}</span>{s.current && <span className="rounded-full bg-surface-2 px-2 py-[1px] text-[11px] text-ok">{T.thisDevice}</span>}</span>
              <span className="text-[12px] text-muted">{T.via[s.method] ?? s.method} · {T.lastActive(relTime(s.lastSeen))}</span>
            </span>
            {s.current
              ? <Button size="sm" variant="ghost" onClick={() => void signOut(false)}><LogOut size={14} />{T.signOut}</Button>
              : <Button size="sm" variant="ghost" onClick={() => void act("sess", async () => { await authApi("/auth/sessions/" + s.id, { method: "DELETE" }); setSessions(sessions.filter((x) => x.id !== s.id)); })}>{T.signOut}</Button>}
          </Row>
        ))}
      </Section>
      {errAt("sess")}

      {/* danger zone */}
      <Section title={T.danger}>
        <Row first>
          <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{T.export}</span><span className="text-[12px] text-muted">{T.exportHint}</span></span>
          <Button size="sm" variant="secondary" disabled={accountsPreview} onClick={() => void act("export", downloadExport)}><Download size={14} />{T.export}</Button>
        </Row>
        <Row>
          <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium text-bad">{T.del}</span><span className="text-[12px] text-muted">{T.delHint}</span></span>
          {!delOpen && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setDelOpen(true)}><Trash2 size={14} />{T.del}</Button>}
        </Row>
        {delOpen && (
          <div className="flex flex-col gap-3 border-t border-line p-4">
            <AuthField label={T.delType(user.email)}><input className={inputCls} value={del} autoComplete="off" spellCheck={false} onChange={(e) => setDel(e.target.value)} aria-invalid={!!del && del.trim().toLowerCase() !== user.email} /></AuthField>
            {errAt("del")}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void act("export", downloadExport)} disabled={accountsPreview}><Download size={14} />{T.export}</Button>
              <Button size="sm" variant="danger" disabled={del.trim().toLowerCase() !== user.email || busy === "del"} onClick={() => void act("del", async () => {
                await authApi("/auth/delete", { json: { confirm: del } }); await signOut(false);
              })}>{T.delGo}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDelOpen(false); setDel(""); }}>{T.cancel}</Button>
            </div>
          </div>
        )}
      </Section>
      {errAt("export")}
    </div>
  );
}
