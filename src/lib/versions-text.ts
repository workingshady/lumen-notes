// Readable text for the diff studio and the conflict screen (design 58): front matter, tables, [[links]] and Markdown
// marks are shown as prose. Display only: a restore always works on the raw lines (see versions-diff.ts).

/** Front matter block at the very start of a note ("---" ... "---"): `fm` includes its trailing newline, so fm + body === text. */
export function splitFront(text: string): { fm: string; body: string } {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { fm: m[0], body: text.slice(m[0].length) } : { fm: "", body: text };
}

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** One source line as readable prose: [[links]], emphasis, code ticks, table pipes, list / task / callout markers. "" = nothing to draw. */
export function readable(line: string): string {
  let s = line;
  if (s.includes("|") && SEP.test(s)) return "";
  if (/^\s*\|.*\|\s*$/.test(s)) s = s.trim().slice(1, -1).split("|").map((c) => c.trim()).filter(Boolean).join("  ·  ");
  s = s.replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a: string, b?: string) => (b || a).trim());
  s = s.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1");
  s = s.replace(/^(\s*)>\s*\[![\w-]+\][+-]?\s*/, "$1").replace(/^(\s*)>\s?/, "$1");
  s = s.replace(/^(\s*)[-*+]\s+\[( |x|X|\/)\]\s+/, (_, i: string, c: string) => i + (c === " " ? "☐ " : c === "/" ? "◐ " : "☑ ")).replace(/^(\s*)[-*+]\s+/, "$1• ");
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2").replace(/`([^`]+)`/g, "$1").replace(/~~(.+?)~~/g, "$1").replace(/==(.+?)==/g, "$1");
  s = s.replace(/\$([^$]+)\$/g, "$1");
  return s;
}
