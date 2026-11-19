// Settings › Appearance › Language extras (design R5-25H): the date format preview right under the digit style,
// and (Arabic interface) the Arabic reading font. Stored in the `lumen.settings` object (`arReadFont`) on this device.
import { useSettings, setSettings } from "../lib/settings";
import { fmtDate, t, useLang } from "../lib/i18n";
import { cx } from "../components/ui";

export type ArReadFont = "naskh" | "plex";
const FONTS: { id: ArReadFont; label: string; family: string }[] = [
  { id: "naskh", label: "Noto Naskh", family: "'Noto Naskh Arabic', serif" },
  { id: "plex", label: "IBM Plex Sans Arabic", family: "'IBM Plex Sans Arabic', sans-serif" },
];
export function arReadFont(s: unknown): ArReadFont { return (s as { arReadFont?: string })?.arReadFont === "plex" ? "plex" : "naskh"; }
/** `<html data-ar-font>`: layout.css maps it to the font Arabic blocks are read in. */
export function applyArReadFont(f: ArReadFont) { if (typeof document !== "undefined") document.documentElement.dataset.arFont = f; }

export function LangExtras() {
  const { lang } = useLang();
  const s = useSettings();
  const cur = arReadFont(s);
  applyArReadFont(cur);
  const row = "flex min-h-[36px] items-center justify-between gap-3 max-md:px-4";
  return (
    <>
      <div className={row} data-date-format>
        <span className="font-semibold">{t("Date")}</span>
        <span className="text-muted tabular-nums">{fmtDate(Date.now(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </div>
      {lang === "ar" && (
        <div className={row} data-ar-font-row>
          <span className="font-semibold">{t("Reading font")}</span>
          <div role="radiogroup" aria-label={t("Arabic reading font")} className="flex gap-1.5">
            {FONTS.map((f) => (
              <button key={f.id} role="radio" aria-checked={cur === f.id} onClick={() => { setSettings({ arReadFont: f.id } as never); applyArReadFont(f.id); }}
                className={cx("h-9 rounded-[8px] border px-3 text-[13px]", cur === f.id ? "border-line bg-surface font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
                style={{ fontFamily: f.family }}>{f.id === "naskh" ? t("Noto Naskh") : t("IBM Plex Sans Arabic")}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
