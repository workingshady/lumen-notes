// Note tabs + assistant defaults (Lumen 32 · "Note tabs, assistant and diagram defaults"; Lumen 29 · Settings › Diagrams
// › Note tabs). Per device, stored in the `lumen.settings` object (lib/settings keeps unknown keys) under `noteTabs`,
// `hideEmptyTabs` and `assistant`. The note tab bar (round 6 part A) reads these; Settings › Diagrams edits them.
import { getSettings, setSettings, useSettings, type Settings } from "./settings";
import { tk } from "./i18n";

export type TabId = "note" | "diagrams" | "media" | "links" | "outline" | "history";
/** always = every note; content = only notes that have something for it; off = never; panel = lives in the right panel. */
export type TabMode = "always" | "content" | "off" | "panel";
export interface TabPref { id: TabId; mode: TabMode }
export const TAB_META: Record<TabId, { glyph: string; label: string; modes: TabMode[] }> = {
  note: { glyph: "lesson", label: tk("Note"), modes: ["always"] },
  diagrams: { glyph: "diagrams-tab", label: tk("Diagrams"), modes: ["content", "always", "off"] },
  media: { glyph: "media", label: tk("Media"), modes: ["content", "always", "off"] },
  links: { glyph: "links-tab", label: tk("Links"), modes: ["content", "always", "off"] },
  outline: { glyph: "toc", label: tk("Outline"), modes: ["always", "content", "off"] },
  history: { glyph: "history", label: tk("History"), modes: ["panel", "always", "off"] },
};
export const MODE_LABEL: Record<TabMode, string> = { always: tk("Always"), content: tk("Only when content"), off: tk("Off"), panel: tk("In right panel") };
export const DEFAULT_TABS: TabPref[] = [
  { id: "note", mode: "always" }, { id: "diagrams", mode: "content" }, { id: "media", mode: "content" },
  { id: "links", mode: "content" }, { id: "outline", mode: "off" }, { id: "history", mode: "panel" },
];

export interface AssistantPrefs {
  opens: "closed" | "panel";
  length: "short" | "normal" | "detailed";
  onlyMyNotes: boolean;
  citations: boolean;
  showCost: boolean;
  language: "match" | "en" | "ar";
}
export const ASSISTANT_DEFAULTS: AssistantPrefs = { opens: "panel", length: "normal", onlyMyNotes: true, citations: true, showCost: true, language: "match" };

type X = Settings & { noteTabs?: TabPref[]; hideEmptyTabs?: boolean; assistant?: Partial<AssistantPrefs> };
function norm(list: TabPref[] | undefined): TabPref[] {
  const ok = (list ?? []).filter((p) => p && TAB_META[p.id]);
  const seen = new Set(ok.map((p) => p.id));
  const out = [...ok, ...DEFAULT_TABS.filter((d) => !seen.has(d.id))];
  return out.map((p) => (p.id === "note" ? { id: "note", mode: "always" } : p));
}
export const getTabPrefs = () => { const s = getSettings() as X; return { tabs: norm(s.noteTabs), hideEmpty: s.hideEmptyTabs !== false }; };
export const useTabPrefs = () => { const s = useSettings() as X; return { tabs: norm(s.noteTabs), hideEmpty: s.hideEmptyTabs !== false }; };
export const setTabPrefs = (p: { tabs?: TabPref[]; hideEmpty?: boolean }) =>
  setSettings({ ...(p.tabs ? { noteTabs: norm(p.tabs) } : {}), ...(p.hideEmpty !== undefined ? { hideEmptyTabs: p.hideEmpty } : {}) } as unknown as Partial<Settings>);
/** Should this tab show for a note? `has` = the note has content for it. */
export function tabVisible(p: TabPref, has: boolean, hideEmpty = true): boolean {
  if (p.mode === "off" || p.mode === "panel") return false;
  if (p.mode === "always") return !hideEmpty || p.id === "note" || p.id === "outline" || has;
  return has;
}

export const getAssistantPrefs = (): AssistantPrefs => ({ ...ASSISTANT_DEFAULTS, ...((getSettings() as X).assistant ?? {}) });
export const useAssistantPrefs = (): AssistantPrefs => ({ ...ASSISTANT_DEFAULTS, ...((useSettings() as X).assistant ?? {}) });
export const setAssistantPrefs = (p: Partial<AssistantPrefs>) => setSettings({ assistant: { ...getAssistantPrefs(), ...p } } as unknown as Partial<Settings>);
