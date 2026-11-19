// Space icons without emoji (design round 4, "Lumen 13 Icon System" › Space icon picker).
// Stored in `space.icon` as `glyph:<name>` (a glyph from src/lib/glyphs.ts) or `initials:AB` (one or two letters).
// Colour always comes from `space.color` (preset "1".."6" or a hex).
// Legacy values (emoji, from before round 4) are never shown as emoji: they map to a glyph through EMOJI_GLYPH,
// and an unknown emoji falls back to the initials of the space name.
import type { Space, SpaceKind } from "../../shared/types";
import { PRESETS } from "./canvas";
import { hasGlyph } from "./glyphs";

export type SpaceIconValue = { glyph: string; initials?: undefined } | { glyph?: undefined; initials: string };

/** Subject glyphs shown in the picker grid (design order, 3 rows of 8). */
export const SPACE_SUBJECTS = ["math", "code", "language", "neural", "eye", "nlp", "robot-arm", "database", "cloud", "book", "flask", "globe", "music", "health", "money", "briefcase", "home", "course", "project", "area", "resource", "moc", "path", "base"] as const;
/** Extra glyphs reachable through search (with the subjects + shapes ≈ 48). */
export const SPACE_EXTRA = ["archive", "inbox", "folder", "owl", "flame", "graph", "flashcards", "slides", "journal", "lesson", "roadmap", "canvas", "diagram", "pdf", "highlight", "dashboard"] as const;
export const SPACE_SHAPES = ["shape-circle", "shape-square", "shape-triangle", "shape-diamond", "shape-hex", "shape-star", "shape-wave", "shape-spark"] as const;

/** Search words per glyph (English; the picker also matches the glyph name). */
export const SPACE_GLYPH_WORDS: Record<string, string> = {
  math: "math maths mathematics algebra calculus numbers statistics stats geometry linear",
  code: "code coding programming software dev developer web javascript python",
  language: "language languages arabic english french spanish grammar translation linguistics",
  neural: "neural network ai ml machine learning deep brain engineer",
  eye: "eye vision computer vision cv image see",
  nlp: "nlp natural language processing text chat llm transformer",
  "robot-arm": "robot robotics arm automation hardware",
  database: "database data sql storage db",
  cloud: "cloud devops server infrastructure aws",
  book: "book books reading reference library literature",
  flask: "flask science chemistry lab experiment biology physics research",
  globe: "globe world networking internet geography travel",
  music: "music audio sound song piano guitar",
  health: "health fitness sleep medicine sport gym body",
  money: "money finance budget economics investing",
  briefcase: "briefcase work job career business",
  home: "home house family personal life",
  course: "course class study school university education graduation",
  project: "project rocket launch thesis build",
  area: "area target goal focus ongoing",
  resource: "resource reference material",
  moc: "map of content moc hub index",
  path: "path learning path journey",
  base: "base table database grid",
  archive: "archive old finished box",
  inbox: "inbox incoming capture",
  folder: "folder files",
  owl: "owl night wisdom",
  flame: "flame candle fire light lamp",
  graph: "graph network connections",
  flashcards: "flashcards cards memory review",
  slides: "slides presentation talk",
  journal: "journal diary notebook",
  lesson: "lesson notes",
  roadmap: "roadmap plan map",
  canvas: "canvas board puzzle",
  diagram: "diagram chart",
  pdf: "pdf paper document",
  highlight: "highlight marker writing",
  dashboard: "dashboard chart stats metrics",
  "shape-circle": "circle round dot shape", "shape-square": "square box shape", "shape-triangle": "triangle shape",
  "shape-diamond": "diamond gem shape", "shape-hex": "hexagon hex shape", "shape-star": "star favourite shape",
  "shape-wave": "wave sea water shape", "shape-spark": "spark idea shape",
};

/** Default glyph per space kind (new space without a picked icon). */
export const KIND_GLYPH: Record<SpaceKind, string> = { project: "project", area: "area", course: "course", resource: "resource", archive: "archive" };

/** Legacy emoji → glyph. Keys are emoji without variation selectors / skin tones. */
export const EMOJI_GLYPH: Record<string, string> = {
  // brains, AI, robots
  "🧠": "neural", "🤖": "robot-arm", "🦾": "robot-arm", "🦿": "robot-arm", "👾": "code", "🧬": "flask", "🔮": "neural",
  // eyes / vision
  "👁": "eye", "👀": "eye", "🔭": "eye", "🔬": "flask", "📷": "eye", "📸": "eye", "🎥": "eye", "🖼": "eye",
  // language / text
  "🕌": "language", "🗣": "language", "💬": "nlp", "🗨": "nlp", "🔤": "language", "🔡": "language", "🈳": "language", "🀄": "language", "🇸🇦": "language", "🇬🇧": "language", "🇺🇸": "language", "🇫🇷": "language", "🇪🇸": "language", "🇩🇪": "language", "🇯🇵": "language", "🇨🇳": "language", "🌍": "globe", "🌎": "globe", "🌏": "globe", "🌐": "globe", "🗺": "globe", "✈": "globe", "🧭": "moc",
  // maths / science
  "➗": "math", "➕": "math", "✖": "math", "🧮": "math", "📐": "math", "📏": "math", "🔢": "math", "∑": "math", "📊": "dashboard", "📈": "dashboard", "📉": "dashboard",
  "🧪": "flask", "⚗": "flask", "⚛": "flask", "🔋": "flask", "💡": "shape-spark", "✨": "shape-spark", "⚡": "shape-spark",
  // code / tech
  "💻": "code", "🖥": "code", "⌨": "code", "🖱": "code", "🐍": "code", "🦀": "code", "☕": "code", "🐛": "code", "🛠": "code", "🔧": "code", "⚙": "code", "🧰": "code", "📱": "code", "🕹": "code", "🎮": "code",
  "🗄": "archive", "💾": "database", "💿": "database", "📀": "database", "🗃": "base", "🧱": "database",
  "☁": "cloud", "⛅": "cloud", "🌥": "cloud", "🌩": "cloud", "🛰": "cloud", "📡": "cloud",
  // books / study
  "📚": "book", "📖": "book", "📕": "book", "📗": "book", "📘": "book", "📙": "book", "📓": "journal", "📔": "journal", "📒": "journal", "📑": "resource", "🔖": "resource", "📜": "resource", "📰": "resource", "🗞": "resource",
  "🎓": "course", "🏫": "course", "🧑‍🎓": "course", "👩‍🎓": "course", "👨‍🎓": "course", "✏": "lesson", "✍": "highlight", "🖊": "highlight", "🖋": "highlight", "🖍": "highlight", "📝": "lesson", "📄": "pdf", "📃": "pdf",
  "🗂": "folder", "📁": "folder", "📂": "folder", "📥": "inbox", "📤": "inbox", "📨": "inbox", "📩": "inbox", "📬": "inbox", "📭": "inbox", "📮": "inbox", "✉": "inbox", "📦": "archive",
  "🃏": "flashcards", "🎴": "flashcards", "🔁": "flashcards", "📽": "slides", "🎞": "slides", "🧩": "canvas", "🛤": "path", "🛣": "path", "🪜": "path",
  // projects / work / money
  "🚀": "project", "🏗": "project", "🎯": "area", "🌱": "area", "🌿": "area", "🌳": "area", "🪴": "area", "💼": "briefcase", "👔": "briefcase", "🏢": "briefcase", "🏦": "money",
  "💰": "money", "💵": "money", "💶": "money", "💷": "money", "💴": "money", "💸": "money", "🪙": "money", "💳": "money", "🧾": "money",
  // home / life / health
  "🏠": "home", "🏡": "home", "🏘": "home", "👪": "home", "🛋": "home", "🛏": "home",
  "💪": "health", "🏃": "health", "🧘": "health", "🏋": "health", "🚴": "health", "❤": "health", "🫀": "health", "🩺": "health", "💊": "health", "🍎": "health", "🥗": "health", "😴": "health", "🛌": "health", "⚽": "health", "🏀": "health", "🎾": "health",
  "🎵": "music", "🎶": "music", "🎸": "music", "🎹": "music", "🎧": "music", "🎤": "music", "🎻": "music", "🥁": "music", "🎼": "music", "🎙": "music",
  // night / light / owls
  "🦉": "owl", "🌙": "owl", "🌛": "owl", "🌜": "owl", "🕯": "flame", "🔥": "flame", "🪔": "flame", "☀": "flame",
  // shapes
  "⭐": "shape-star", "🌟": "shape-star", "⭕": "shape-circle", "🔴": "shape-circle", "🟠": "shape-circle", "🟡": "shape-circle", "🟢": "shape-circle", "🔵": "shape-circle", "🟣": "shape-circle", "⚪": "shape-circle", "⚫": "shape-circle",
  "🟥": "shape-square", "🟧": "shape-square", "🟨": "shape-square", "🟩": "shape-square", "🟦": "shape-square", "🟪": "shape-square", "⬛": "shape-square", "⬜": "shape-square",
  "🔺": "shape-triangle", "🔻": "shape-triangle", "🔷": "shape-diamond", "🔶": "shape-diamond", "🔹": "shape-diamond", "🔸": "shape-diamond", "💎": "shape-diamond", "🌊": "shape-wave", "〰": "shape-wave",
  // misc
  "🕸": "graph", "🔗": "graph", "🧷": "graph", "📌": "area", "📍": "area", "🗓": "journal", "📅": "journal", "📆": "journal", "⏳": "archive", "⌛": "archive",
  "🔍": "eye", "🔎": "eye", "🧑‍💻": "code", "👩‍💻": "code", "👨‍💻": "code", "🧑‍🔬": "flask", "🎨": "canvas", "🖌": "canvas", "📋": "base",
};

const strip = (s: string) => s.replace(/[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "").trim();

/** Two-letter initials of a name ("AI Engineer" → "AE", "Arabic" → "AR"). */
export function initialsOf(name: string): string {
  const words = (name || "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "·";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Initials candidates offered by the picker (unique, up to 4). */
export function initialsChoices(name: string): string[] {
  const words = (name || "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const c = [initialsOf(name)];
  if (words[0]) c.push(words[0].slice(0, 2).toUpperCase());
  if (words.length > 1) c.push((words[0][0] + words[words.length - 1][0]).toUpperCase());
  if (words[1]) c.push(words[1].slice(0, 2).toUpperCase());
  if (words[0]) c.push(words[0][0].toUpperCase());
  return [...new Set(c.filter((x) => x && x !== "·"))].slice(0, 4);
}

/** Map a legacy emoji to a glyph name (or null when unknown). */
export function emojiGlyph(icon: string): string | null {
  const e = strip(icon);
  if (!e) return null;
  if (EMOJI_GLYPH[e]) return EMOJI_GLYPH[e];
  // try the first grapheme (e.g. "🧠✨")
  const first = [...e][0];
  return (first && EMOJI_GLYPH[first]) || null;
}

/** Resolve any stored icon value (new form or legacy emoji) to what to draw. */
export function resolveSpaceIcon(icon: string | null | undefined, name = "", kind?: SpaceKind): SpaceIconValue {
  const v = (icon ?? "").trim();
  if (v.startsWith("glyph:")) { const g = v.slice(6); if (hasGlyph(g)) return { glyph: g }; }
  if (v.startsWith("initials:")) { const t = v.slice(9).trim().slice(0, 2); if (t) return { initials: t.toUpperCase() }; }
  if (v && hasGlyph(v)) return { glyph: v }; // bare glyph name
  const g = v ? emojiGlyph(v) : null;
  if (g) return { glyph: g };
  if (!v && kind && KIND_GLYPH[kind]) return { glyph: KIND_GLYPH[kind] };
  return { initials: initialsOf(name) };
}

/** The stored form for a resolved value. */
export const iconValue = (x: SpaceIconValue) => (x.glyph ? `glyph:${x.glyph}` : `initials:${x.initials}`);

/** Normalize a stored icon to the new form (used when seeding / migrating; idempotent). */
export const normalizeSpaceIcon = (icon: string | null | undefined, name = "", kind?: SpaceKind) => iconValue(resolveSpaceIcon(icon, name, kind));

/** Space colour as a CSS colour (preset "1".."6" → hex), or the fallback. */
export function spaceColor(s: Pick<Space, "color"> | null | undefined, fallback = "#A371F7"): string {
  const c = s?.color;
  return c ? PRESETS[c] ?? c : fallback;
}

/** Picker search: subjects + extras + shapes whose name or words match. */
export function searchSpaceGlyphs(q: string): string[] {
  const all = [...SPACE_SUBJECTS, ...SPACE_EXTRA, ...SPACE_SHAPES] as string[];
  const t = q.trim().toLowerCase();
  if (!t) return [...SPACE_SUBJECTS];
  return all.filter((g) => g.includes(t) || (SPACE_GLYPH_WORDS[g] ?? "").split(" ").some((w) => w.startsWith(t)));
}

/** Profile / blog avatar: stored as `glyph:<name>` (legacy emoji map through EMOJI_GLYPH; anything else → owl). */
export const AVATAR_CHOICES = ["glyph:owl", "glyph:flame", "glyph:book"] as const;
export function avatarGlyph(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (s.startsWith("glyph:") && hasGlyph(s.slice(6))) return s.slice(6);
  return (s && emojiGlyph(s)) || "owl";
}
/** Avatar glyph colour (design: owl/flame in the accent amber, book in preset yellow). */
export const avatarColor = (g: string) => (g === "book" ? "#E3B341" : "var(--accent)");
