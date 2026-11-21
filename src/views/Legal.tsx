// /terms and /privacy: plain pages linked from the account sign-up (Lumen 27). No sign-in, no vault.
import { t } from "../lib/i18n";

const SERIF = "'Source Serif 4', Georgia, serif";
const TERMS: [string, string][] = [
  ["Your notes are yours", "Lumen is a personal notes app. What you write, import or upload belongs to you. We claim no rights over it."],
  ["How the service works", "Lumen keeps your notes on your device and, when you turn sync on, in the Cloudflare account that hosts your copy of the app. Features can change; we aim to keep export open so you can always take your notes with you."],
  ["Acceptable use", "Do not use Lumen to break the law, to harm others, to attack the service, or to publish content you have no right to share. Shared links and published posts are public to anyone who has the address."],
  ["No warranty", "Lumen is provided as is, without warranties. Keep your own backups (Settings › Import and export). To the extent the law allows, we are not liable for lost data or indirect damages."],
  ["Changes", "If these terms change in a way that matters, the new version is shown here with its date."],
];
const PRIVACY: [string, string][] = [
  ["What is stored", "Your notes, files, settings and, if you create an account, your email address and a hashed password or the sign-in provider id."],
  ["Where it is stored", "On your device, and when sync is on in the Cloudflare D1 database and storage of the Lumen server you use. Nothing is sold or shared with advertisers."],
  ["AI features", "When you use an AI action, the text you send is processed by Cloudflare Workers AI to answer you. You can switch each AI feature off in Settings › AI."],
  ["Public pages", "A shared link or published post can be read by anyone with the address. Shared links are not indexed by search engines. Link previews on those pages show only metadata the server already cached."],
  ["Your choices", "Export or delete your notes at any time. Deleting your account removes its server data."],
];

export function Legal({ kind }: { kind: "terms" | "privacy" }) {
  const rows = kind === "terms" ? TERMS : PRIVACY;
  const title = kind === "terms" ? t("Terms") : t("Privacy policy");
  document.title = `${title} · Lumen`;
  return (
    <div className="min-h-full bg-bg text-[15px] leading-[26px] text-ink">
      <header className="flex h-14 items-center border-b border-line px-5 md:px-14"><a href="/" className="text-[17px] font-bold" style={{ fontFamily: SERIF }}>Lumen</a></header>
      <main className="mx-auto flex max-w-[680px] flex-col gap-5 px-5 py-8 md:py-14">
        <h1 className="text-[30px] font-bold leading-9 md:text-[40px] md:leading-[46px]" style={{ fontFamily: SERIF }}>{title}</h1>
        {rows.map(([h, p]) => (
          <section key={h} className="flex flex-col gap-1.5">
            <h2 className="text-[17px] font-semibold">{t(h)}</h2>
            <p className="text-muted">{t(p)}</p>
          </section>
        ))}
      </main>
    </div>
  );
}
