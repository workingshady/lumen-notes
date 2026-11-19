import { useEffect, useState } from "react";
import { ChipSelect, PrefRow } from "../components/chip-select";
import { HL_LABEL, HL_PALETTES, setExtraPrefs, useExtraPrefs } from "../lib/reading-prefs";
import { setSettings, type Settings } from "../lib/settings";

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
      <span className="text-[20px] font-[650]">Reading</span>
      <PrefRow label="Reading font" desc="Used in Read and Focus">
        <ChipSelect value={s.readingFont} onChange={(v) => setSettings({ readingFont: v })} options={FONTS} />
      </PrefRow>
      <PrefRow label="Size" desc="Focus adds +2 px">
        <ChipSelect value={s.fontSize} onChange={(v) => setSettings({ fontSize: v })} options={[13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((n) => ({ value: n, label: `${n} px` }))} />
      </PrefRow>
      <PrefRow label="Line width" desc="Characters per line">
        <ChipSelect value={s.measure} onChange={(v) => setSettings({ measure: v })} options={[{ value: 60, label: "60" }, { value: 68, label: "68" }, { value: 80, label: "80" }, { value: 0, label: "Full" }] as { value: Settings["measure"]; label: string }[]} />
      </PrefRow>
      <PrefRow label="Highlighter colours" desc="Five, used by Focus and PDF">
        <span className="flex items-center gap-2">
          <span className="flex gap-[3px]">{Object.values(HL_PALETTES[s.hlPalette] ?? HL_PALETTES.default).map((c) => <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />)}</span>
          <ChipSelect value={s.hlPalette} onChange={(v) => setExtraPrefs({ hlPalette: v })} options={(Object.keys(HL_LABEL) as (keyof typeof HL_LABEL)[]).map((k) => ({ value: k, label: HL_LABEL[k] }))} />
        </span>
      </PrefRow>
      <PrefRow label="Read aloud voice" desc={<>System voices · <button className="text-link hover:underline" onClick={test}>Test</button></>}>
        <span className="flex items-center gap-1.5">
          <ChipSelect value={s.ttsVoice} onChange={(v) => setExtraPrefs({ ttsVoice: v })}
            label={`${voice?.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s+Online.*$/, "") ?? "System default"} · ${rate}×`}
            options={[{ value: "", label: "System default" }, ...voices.map((v) => ({ value: v.voiceURI, label: v.name, hint: v.lang }))]} />
          <ChipSelect value={rate} onChange={(v) => setSettings({ ttsRate: v })} label="Speed" options={RATES.map((r) => ({ value: r, label: `${r}×` }))} />
        </span>
      </PrefRow>
      <PrefRow label="Write focus" desc="Dim other paragraphs, typewriter scroll">
        <ChipSelect value={s.focusDim ? "on" : "off"} onChange={(v) => setSettings({ focusDim: v === "on" })} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
      </PrefRow>
      <PrefRow label="Study plan" desc="Daily minutes and goals for Today">
        <ChipSelect value={s.planDailyMinutes ?? 60} onChange={(v) => setSettings({ planDailyMinutes: v })} options={[15, 30, 45, 60, 90, 120, 180].map((n) => ({ value: n, label: `${n} min / day` }))} />
      </PrefRow>
      <PrefRow label="Focus opens for" desc="The Focus tab and shortcut">
        <ChipSelect value={s.focusMode ?? "read"} onChange={(v) => setSettings({ focusMode: v })} options={[{ value: "read", label: "Reading" }, { value: "write", label: "Writing" }]} />
      </PrefRow>
      <PrefRow label="Leaving Focus with highlights" desc="Ask, save them into the note as ==highlights==, or discard">
        <ChipSelect value={s.highlightOnExit ?? "ask"} onChange={(v) => setSettings({ highlightOnExit: v })} options={[{ value: "ask", label: "Ask" }, { value: "save", label: "Save into the note" }, { value: "discard", label: "Discard" }]} />
      </PrefRow>
    </div>
  );
}
