import { useEffect, useState } from "react";
import { ChipSelect, PrefRow } from "../components/chip-select";
import { HL_LABEL, HL_PALETTES, setExtraPrefs, useExtraPrefs } from "../lib/reading-prefs";
import { setSettings, type Settings } from "../lib/settings";
import { fmtNum, t } from "../lib/i18n";

const FONTS: { value: Settings["readingFont"]; label: string }[] = [{ value: "serif", label: "Source Serif 4" }, { value: "sans", label: "Inter" }, { value: "mono", label: "JetBrains Mono" }];
const RATES = [0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3];

/** Settings › Reading (design round 4, Lumen 17 · R4-17G): reading font, size, line width, highlighter colours,
 *  read-aloud voice + speed, write focus, study plan, plus the Focus defaults. */
export function ReadingSection() {
  const s = useExtraPrefs();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const f = () => setVoices(speechSynthesis.getVoices());
    f();
    speechSynthesis.addEventListener("voiceschanged", f);
    return () => speechSynthesis.removeEventListener("voiceschanged", f);
  }, []);
  const voice = voices.find((v) => v.voiceURI === s.ttsVoice);
  const rate = s.ttsRate ?? 1;
  const test = () => {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Backpropagation is the chain rule, organised.");
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate;
    speechSynthesis.speak(u);
  };
  return (
    <div className="flex w-full max-w-[620px] flex-col gap-[18px] rounded-[14px] border border-line bg-bg p-6 text-[13px] text-ink">
      <span className="text-[20px] font-[650]">{t("Reading")}</span>
      <PrefRow label={t("Reading font")} desc={t("Used in Read and Focus")}>
        <ChipSelect value={s.readingFont} onChange={(v) => setSettings({ readingFont: v })} options={FONTS} />
      </PrefRow>
      <PrefRow label={t("Size")} desc={t("Focus adds +2 px")}>
        <ChipSelect value={s.fontSize} onChange={(v) => setSettings({ fontSize: v })} options={[13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((n) => ({ value: n, label: t("{n} px", { n }) }))} />
      </PrefRow>
      <PrefRow label={t("Line width")} desc={t("Characters per line")}>
        <ChipSelect value={s.measure} onChange={(v) => setSettings({ measure: v })} options={[{ value: 60, label: fmtNum(60) }, { value: 68, label: fmtNum(68) }, { value: 80, label: fmtNum(80) }, { value: 0, label: t("Full") }] as { value: Settings["measure"]; label: string }[]} />
      </PrefRow>
      <PrefRow label={t("Footnotes")} desc={t("How footnote marks read in notes")}>
        <ChipSelect value={s.footnoteStyle} onChange={(v) => setSettings({ footnoteStyle: v })} options={[{ value: "number", label: "1 2 3" }, { value: "symbol", label: "* † ‡" }]} />
      </PrefRow>
      <PrefRow label={t("Highlighter colours")} desc={t("Five, used by Focus and PDF")}>
        <span className="flex items-center gap-2">
          <span className="flex gap-[3px]">{Object.values(HL_PALETTES[s.hlPalette] ?? HL_PALETTES.default).map((c) => <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />)}</span>
          <ChipSelect value={s.hlPalette} onChange={(v) => setExtraPrefs({ hlPalette: v })} options={(Object.keys(HL_LABEL) as (keyof typeof HL_LABEL)[]).map((k) => ({ value: k, label: t(HL_LABEL[k]) }))} />
        </span>
      </PrefRow>
      <PrefRow label={t("Read aloud voice")} desc={<>{t("System voices")} · <button className="text-link hover:underline" onClick={test}>{t("Test")}</button></>}>
        <span className="flex items-center gap-1.5">
          <ChipSelect value={s.ttsVoice} onChange={(v) => setExtraPrefs({ ttsVoice: v })}
            label={`${voice?.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s+Online.*$/, "") ?? t("System default")} · ${fmtNum(rate)}×`}
            options={[{ value: "", label: t("System default") }, ...voices.map((v) => ({ value: v.voiceURI, label: v.name, hint: v.lang }))]} />
          <ChipSelect value={rate} onChange={(v) => setSettings({ ttsRate: v })} label={t("Speed")} options={RATES.map((r) => ({ value: r, label: `${fmtNum(r)}×` }))} />
        </span>
      </PrefRow>
      <PrefRow label={t("Write focus")} desc={t("Dim other paragraphs, typewriter scroll")}>
        <ChipSelect value={s.focusDim ? "on" : "off"} onChange={(v) => setSettings({ focusDim: v === "on" })} options={[{ value: "on", label: t("On") }, { value: "off", label: t("Off") }]} />
      </PrefRow>
      <PrefRow label={t("Study plan")} desc={t("Daily minutes and goals for Today")}>
        <ChipSelect value={s.planDailyMinutes ?? 60} onChange={(v) => setSettings({ planDailyMinutes: v })} options={[15, 30, 45, 60, 90, 120, 180].map((n) => ({ value: n, label: t("{n} min / day", { n }) }))} />
      </PrefRow>
      <PrefRow label={t("Focus opens for")} desc={t("The Focus tab and shortcut")}>
        <ChipSelect value={s.focusMode ?? "read"} onChange={(v) => setSettings({ focusMode: v })} options={[{ value: "read", label: t("Reading") }, { value: "write", label: t("Writing") }]} />
      </PrefRow>
      <PrefRow label={t("Leaving Focus with highlights")} desc={t("Ask, save them into the note as ==highlights==, or discard")}>
        <ChipSelect value={s.highlightOnExit ?? "ask"} onChange={(v) => setSettings({ highlightOnExit: v })} options={[{ value: "ask", label: t("Ask") }, { value: "save", label: t("Save into the note") }, { value: "discard", label: t("Discard") }]} />
      </PrefRow>
    </div>
  );
}
