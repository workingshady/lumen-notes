// Settings › Account. Accounts off (now, 27B/27D): the local profile that already exists on this device (name,
// avatar, language, time zone — each row edits in place) + the dashed "Sign-in and registration · Coming soon" card.
// Accounts on: the profile page when signed in (27M), else the local profile + "Sign in or create an account".
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { hasUserSession, useAccountsConfig } from "../../lib/auth";
import { setAvatarImage, useAvatarImage } from "../../lib/home-meta";
import { setLang, t, useLang, type LangPref } from "../../lib/i18n";
import { setLocalTimeZone, useLocalTimeZone } from "../../lib/profile-local";
import { setSettings, useSettings } from "../../lib/settings";
import { cx } from "../ui";
import { ComingSoonCard, PrimaryButton, SecondaryButton } from "./auth-ui";
import { avatarLabel, AvatarPicker, InlineSelect, InlineText, LANG_LABEL, Profile, ProfileHead, ProfileRow, Table, tzLabel, tzOptions } from "./Profile";
import { AuthFlow } from "./SignIn";

function usePhone() {
  const [p, setP] = useState(() => innerWidth < 768);
  useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return p;
}

/**
 * Settings › Account entry point: while accounts are off the owner page (`children`, Lumen 29L) stays as it is;
 * when they are on (server switch or the demo preview) the account screens take over (27M profile / sign in).
 */
export function AccountsGate({ children }: { children: ReactNode }) {
  const cfg = useAccountsConfig();
  return cfg.enabled ? <AccountSection /> : <>{children}</>;
}

export function AccountSection() {
  useLang();
  const cfg = useAccountsConfig();
  const phone = usePhone();
  const [flow, setFlow] = useState<"signin" | "register" | null>(null);
  if (cfg.enabled && hasUserSession()) return <Profile />;
  return (
    <div className={cx("flex max-w-[820px] flex-col text-[13px] leading-[normal]", phone ? "gap-2.5" : "gap-3")} data-account={cfg.enabled ? "signed-out" : "off"}>
      <span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{t("Account")}</span>
      <LocalProfile />
      {cfg.enabled ? (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
          <span className="font-semibold">{t("Sign in or create an account")}</span>
          <span className="leading-[19px] text-muted">{t("Keep your notes in your own Lumen account and sign in with Google, email or a magic link. Your passcode keeps working.")}</span>
          <div className="flex gap-2">
            <PrimaryButton className="!h-[34px] !w-auto px-4" onClick={() => setFlow("signin")}>{t("Sign in")}</PrimaryButton>
            <SecondaryButton className="!h-[34px] !w-auto px-4" onClick={() => setFlow("register")}>{t("Create account")}</SecondaryButton>
          </div>
        </div>
      ) : <ComingSoonCard />}
      {flow && (
        <div className="fixed inset-0 z-50 bg-bg" role="dialog" aria-modal="true">
          <button type="button" aria-label={t("Close")} onClick={() => setFlow(null)} className="safe-t absolute end-3 top-3 z-[1] flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
          <AuthFlow initial={flow} />
        </div>
      )}
    </div>
  );
}

/** What exists today, stored on this device (name/avatar synced on the Inbox space like Branding). */
function LocalProfile() {
  const s = useSettings();
  const img = useAvatarImage();
  const lang = useLang();
  const tz = useLocalTimeZone();
  const [edit, setEdit] = useState<"" | "name" | "avatar" | "lang" | "tz">("");
  const toggle = (k: typeof edit) => setEdit(edit === k ? "" : k);
  return (
    <>
      <ProfileHead avatar={s.avatar} photo={img || undefined} name={s.author || t("Add your name")} line={t("No sign-in yet · passcode on this device")} onAvatar={() => toggle("avatar")} />
      <Table>
        <ProfileRow label={t("Name")} value={<span dir="auto">{s.author}</span>} action={edit === "name" ? t("Save") : t("Edit")} editing={edit === "name"}
          onAction={() => toggle("name")}
          editor={<InlineText value={s.author} onCancel={() => setEdit("")} onSave={(v) => { setSettings({ author: v }); setEdit(""); }} />} />
        <ProfileRow label={t("Avatar")} value={avatarLabel(s.avatar, !!img)} action={edit === "avatar" ? t("Done") : t("Change")} onAction={() => toggle("avatar")}
          below={edit === "avatar" ? <AvatarPicker value={s.avatar} photo={!!img} onClose={() => setEdit("")}
            onGlyph={(a) => { setSettings({ avatar: a }); if (img) void setAvatarImage(""); }} onPhoto={(d) => void setAvatarImage(d)} onRemovePhoto={() => void setAvatarImage("")} /> : null} />
        <ProfileRow label={t("Language")} value={t(LANG_LABEL[lang.pref] ?? lang.pref)} action={edit === "lang" ? t("Done") : t("Change")} editing={edit === "lang"} onAction={() => toggle("lang")}
          editor={<InlineSelect value={lang.pref} options={[["auto", t(LANG_LABEL.auto)], ["en", "English"], ["ar", "العربية"]]} onChange={(v) => setLang(v as LangPref)} />} />
        <ProfileRow label={t("Time zone")} value={<span className="ltr">{tzLabel(tz)}</span>} action={edit === "tz" ? t("Done") : t("Change")} editing={edit === "tz"} onAction={() => toggle("tz")}
          editor={<InlineSelect value={tz} options={tzOptions(tz)} onChange={(v) => setLocalTimeZone(v)} />} />
      </Table>
    </>
  );
}
