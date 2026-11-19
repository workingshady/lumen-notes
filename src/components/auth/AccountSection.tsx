// Settings › Account. Accounts off (now): the local profile that already exists (avatar, name, language) + a muted
// "Sign-in and registration · coming soon" card. Accounts on: the profile page when signed in, else a sign-in card.
import { ImagePlus, LogIn, X } from "lucide-react";
import { useState } from "react";
import { hasUserSession, useAccountsConfig } from "../../lib/auth";
import { pickAvatar, setAvatarImage, useAvatarImage } from "../../lib/home-meta";
import { setLang, useLang, type LangPref } from "../../lib/i18n";
import { setSettings, useSettings } from "../../lib/settings";
import { AVATAR_CHOICES, avatarGlyph } from "../../lib/space-icon";
import { AvatarGlyph } from "../SpaceIcon";
import { Button, cx, inputCls } from "../ui";
import { ComingSoonCard } from "./auth-ui";
import { Profile } from "./Profile";
import { AuthFlow } from "./SignIn";

const T = {
  title: "Account",
  hintOff: "Your profile on this device. It shows on Home, the unlock screen and your blog.",
  hintOn: "Your profile, and how you sign in.",
  avatar: "Avatar",
  photo: "Upload photo",
  removePhoto: "Use a glyph",
  name: "Your name",
  language: "Language",
  langs: [["auto", "Automatic (device)"], ["en", "English"], ["ar", "العربية"]] as [LangPref, string][],
  signInTitle: "Sign in or create an account",
  signInText: "Keep your notes in your own Lumen account and sign in with Google, email or a magic link. Your passcode keeps working.",
  signIn: "Sign in",
  register: "Create account",
  close: "Close",
} as const;

export function AccountSection() {
  const cfg = useAccountsConfig();
  const [flow, setFlow] = useState<"signin" | "register" | null>(null);
  if (cfg.enabled && hasUserSession()) return <Profile />;
  return (
    <div className="flex max-w-[560px] flex-col gap-[22px]" data-account={cfg.enabled ? "signed-out" : "off"}>
      <div className="flex flex-col gap-1"><span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{T.title}</span><span className="text-muted">{cfg.enabled ? T.hintOn : T.hintOff}</span></div>
      <LocalProfile />
      {cfg.enabled ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
          <span className="font-semibold">{T.signInTitle}</span>
          <span className="text-[12.5px] leading-[19px] text-muted">{T.signInText}</span>
          <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setFlow("signin")}><LogIn size={14} />{T.signIn}</Button><Button size="sm" onClick={() => setFlow("register")}>{T.register}</Button></div>
        </div>
      ) : <ComingSoonCard />}
      {flow && (
        <div className="fixed inset-0 z-50 bg-bg">
          <button type="button" aria-label={T.close} onClick={() => setFlow(null)} className="safe-t absolute right-3 top-3 z-[1] flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
          <AuthFlow initial={flow} />
        </div>
      )}
    </div>
  );
}

/** What exists today, stored on this device (and synced on the Inbox space like Branding). */
function LocalProfile() {
  const s = useSettings();
  const img = useAvatarImage();
  const lang = useLang();
  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2">
          {img ? <img src={img} alt="" className="size-full object-cover" /> : <AvatarGlyph value={s.avatar} size={26} />}
        </span>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-muted">{T.avatar}</span>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={T.avatar}>
            {AVATAR_CHOICES.map((a) => {
              const on = !img && `glyph:${avatarGlyph(s.avatar)}` === a;
              return (
                <button key={a} type="button" role="radio" aria-checked={on} aria-label={a.slice(6)} onClick={() => { setSettings({ avatar: a }); if (img) void setAvatarImage(""); }}
                  className="flex size-9 items-center justify-center rounded-full bg-surface-2" style={on ? { boxShadow: "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" } : undefined}>
                  <AvatarGlyph value={a} size={15} />
                </button>
              );
            })}
            <Button size="sm" variant="ghost" onClick={() => pickAvatar()}><ImagePlus size={14} />{T.photo}</Button>
            {img && <Button size="sm" variant="ghost" onClick={() => void setAvatarImage("")}>{T.removePhoto}</Button>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{T.name}</span>
          <input dir="auto" className={inputCls} value={s.author} onChange={(e) => setSettings({ author: e.target.value })} /></label>
        <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{T.language}</span>
          <select className={cx(inputCls)} value={lang.pref} onChange={(e) => setLang(e.target.value as LangPref)}>
            {T.langs.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
      </div>
    </div>
  );
}
