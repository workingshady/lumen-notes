// Reading + diagram preferences added in design round 4 (Settings › Reading, Settings › Diagrams). They are stored in
// the same `lumen.settings` object as lib/settings.ts (which keeps unknown keys), typed here so that file stays as is.
import { getSettings, setSettings, useSettings, type Settings } from "./settings";
import type { HlColor } from "./highlights";
import { tk } from "./i18n";

export interface ReadingPrefs {
  /** Read-aloud voice (SpeechSynthesisVoice.voiceURI); "" = the system default. */
  ttsVoice: string;
  /** Write focus: keep the line with the cursor in the middle of the screen. */
  typewriter: boolean;
  /** Highlighter colour set used by Focus (and offered to the PDF reader). */
  hlPalette: "default" | "soft" | "bold";
  /** Focus · Read: the outline drawer starts open. */
  focusOutline: boolean;
}
export interface DiagramPrefs {
  /** Theme for diagram files and the Diagrams tab ("app" = follow the app theme). */
  diagramTheme: "app" | "default" | "dark" | "neutral" | "forest";
  /** Mermaid's hand-drawn look (rough strokes like the whiteboard). */
  diagramHand: boolean;
  /** How a .mermaid file opens. */
  diagramOpenIn: "edit" | "split" | "read";
  /** Diagrams larger than this (px, either side) open fitted to the view with a Fit button; 0 = never. */
  diagramMaxPx: number;
}
export type ExtraPrefs = ReadingPrefs & DiagramPrefs;
export const EXTRA_DEFAULTS: ExtraPrefs = { ttsVoice: "", typewriter: true, hlPalette: "default", focusOutline: true, diagramTheme: "app", diagramHand: false, diagramOpenIn: "split", diagramMaxPx: 4000 };

type All = Settings & Partial<ExtraPrefs>;
export const useExtraPrefs = (): Settings & ExtraPrefs => ({ ...EXTRA_DEFAULTS, ...(useSettings() as All) } as Settings & ExtraPrefs);
export const getExtraPrefs = (): Settings & ExtraPrefs => ({ ...EXTRA_DEFAULTS, ...(getSettings() as All) } as Settings & ExtraPrefs);
export const setExtraPrefs = (p: Partial<ExtraPrefs>) => setSettings(p as unknown as Partial<Settings>);

/** The five highlighter colours (design round 4: #E3B341 #57AB5A #7AA2F7 #E5534B #A371F7), per palette. */
export const HL_PALETTES: Record<ReadingPrefs["hlPalette"], Record<HlColor, string>> = {
  default: { yellow: "#E3B341", green: "#57AB5A", blue: "#7AA2F7", pink: "#E5534B", purple: "#A371F7" },
  soft: { yellow: "#E8CF7A", green: "#8FC79A", blue: "#A9C1F5", pink: "#EE9A96", purple: "#C2A6F2" },
  bold: { yellow: "#F2B90C", green: "#2FA84F", blue: "#3D7BF5", pink: "#E5332A", purple: "#8B4CF0" },
};
export const HL_LABEL: Record<ReadingPrefs["hlPalette"], string> = { default: tk("Default"), soft: tk("Soft"), bold: tk("Bold") };
/** CSS custom properties for a container: --hl-yellow … --hl-purple. */
export const hlVars = (p: ReadingPrefs["hlPalette"]) => Object.fromEntries(Object.entries(HL_PALETTES[p] ?? HL_PALETTES.default).map(([k, v]) => [`--hl-${k}`, v]));

/** Mermaid front-matter that turns on the hand-drawn look (Mermaid ≥ 11 reads `config:` from the diagram). */
export function withLook(src: string, hand: boolean): string {
  if (!hand || /^\s*---\s*\n[\s\S]*?\blook\s*:/.test(src)) return src;
  const fm = /^\s*---\s*\n([\s\S]*?)\n---\s*\n/.exec(src);
  if (fm) return src.replace(fm[0], `---\n${/\bconfig\s*:/.test(fm[1]) ? fm[1].replace(/\bconfig\s*:\s*\n/, "config:\n  look: handDrawn\n") : `${fm[1]}\nconfig:\n  look: handDrawn`}\n---\n`);
  return `---\nconfig:\n  look: handDrawn\n---\n${src}`;
}
