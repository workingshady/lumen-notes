// Plain-text helpers for previews in the navigate area (palette snippets, graph cards, canvas note cards).
import { splitFrontMatter } from "../lib/parse";

const TEX: Record<string, string> = { lambda: "λ", theta: "θ", eta: "η", nabla: "∇", sigma: "σ", Sigma: "Σ", alpha: "α", beta: "β", mu: "μ", pi: "π", partial: "∂", cdot: "·", times: "×", sum: "Σ", top: "ᵀ" };

/** Markdown body → readable plain text: no front-matter, no title line, no marks; inline TeX kept as symbols. */
export function plainText(md: string) {
  return splitFrontMatter(md).body
    .replace(/^#\s+.*\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$([^$\n]+)\$/g, (_, m: string) => m.replace(/\\([a-zA-Z]+)/g, (_x, c: string) => TEX[c] ?? c).replace(/[{}]/g, ""))
    .replace(/^>\s*\[![^\]]*\][+-]?\s*/gm, "")
    .replace(/!?\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^.*\s::\s.*$/gm, "")
    // task dates (calendar / hourglass / plane + 2026-11-20, @due(…)) and other pictographs: no emoji in UI snippets
    .replace(/\s*\p{Extended_Pictographic}️?(\s*\d{4}-\d{2}-\d{2})?/gu, "").replace(/@due\(\d{4}-\d{2}-\d{2}\)/g, "")
    .replace(/[#*_`>~]|^\s*[-+]\s+(\[.\]\s*)?|^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First `n` characters of the plain text, cut at a word, with an ellipsis. */
export function plainExcerpt(md: string, n = 140) {
  const t = plainText(md);
  if (t.length <= n) return t;
  const cut = t.lastIndexOf(" ", n);
  return t.slice(0, cut > n * 0.6 ? cut : n).replace(/[,.;:]$/, "") + "…";
}
