// Version retention + automatic named versions (Settings › Versions & history, design 58H). Stored in the synced
// `lumen.settings` object like reading-prefs.ts. The thinning itself is lib/sync-plan.ts versionsToPrune (run by
// actions.pruneVersions after a good sync round); this file only holds the three ages it uses.
import { getSettings, setSettings, useSettings, type Settings } from "./settings";

export interface VersionPrefs {
  /** Keep every save for this many hours. */
  verAllHours: number;
  /** Then the newest per hour until this many days old. */
  verHourlyDays: number;
  /** Then the newest per day until this many days old (per week after that). */
  verDailyDays: number;
  /** Automatic versions the owner switched on or off (id -> on); ids not listed use AUTO_DEFAULT. */
  verAuto: Record<string, boolean>;
  /** Per-space override of the thinning (space id -> mode); spaces not listed use the global ages. */
  verSpace: Record<string, SpaceKeep>;
}
export type SpaceKeep = "default" | "all90" | "daily";
export const VERSION_DEFAULTS: VersionPrefs = { verAllHours: 24, verHourlyDays: 7, verDailyDays: 90, verAuto: {}, verSpace: {} };
/** Automatic versions (Settings › Versions & history): id, English label, default. Triggers live in lib/auto-versions.ts. */
export const AUTO_DEFAULT: Record<string, boolean> = { ai: true, restore: true, convert: true, plan: false, paste: true, daily: true };
/** Options per tier (the backend default is the first one). */
export const ALL_HOURS = [24, 72, 168];
export const HOURLY_DAYS = [7, 14, 30];
export const DAILY_DAYS = [90, 180, 365];

type All = Settings & Partial<VersionPrefs>;
const num = (v: unknown, d: number, opts: number[]) => (typeof v === "number" && opts.includes(v) ? v : d);
export function normalize(s: Partial<VersionPrefs>): VersionPrefs {
  return {
    verAllHours: num(s.verAllHours, VERSION_DEFAULTS.verAllHours, ALL_HOURS),
    verHourlyDays: num(s.verHourlyDays, VERSION_DEFAULTS.verHourlyDays, HOURLY_DAYS),
    verDailyDays: num(s.verDailyDays, VERSION_DEFAULTS.verDailyDays, DAILY_DAYS),
    verSpace: s.verSpace && typeof s.verSpace === "object" ? Object.fromEntries(Object.entries(s.verSpace).filter(([, v]) => v === "all90" || v === "daily")) as Record<string, SpaceKeep> : {},
    verAuto: s.verAuto && typeof s.verAuto === "object" ? Object.fromEntries(Object.entries(s.verAuto).filter(([, v]) => typeof v === "boolean")) : {},
  };
}
export const getVersionPrefs = (): VersionPrefs => normalize(getSettings() as All);
export const useVersionPrefs = (): VersionPrefs => normalize(useSettings() as All);
export const setVersionPrefs = (p: Partial<VersionPrefs>) => setSettings(p as unknown as Partial<Settings>);
/** Retention ages in ms for versionsToPrune. */
export function retentionMs(p: VersionPrefs = getVersionPrefs(), mode: SpaceKeep = "default") {
  const D = 86_400_000;
  const daily = p.verDailyDays * D;
  if (mode === "all90") return { all: 90 * D, hourly: 90 * D, daily: Math.max(daily, 90 * D) }; // every save for 90 days
  if (mode === "daily") return { all: 0, hourly: 0, daily }; // one per day only
  return { all: p.verAllHours * 3_600_000, hourly: p.verHourlyDays * D, daily };
}
/** Is this automatic named version on? (callers: AI edits, restore, convert, big paste, plan topic done). */
export const autoVersionOn = (id: string) => getVersionPrefs().verAuto[id] ?? AUTO_DEFAULT[id] ?? false;
