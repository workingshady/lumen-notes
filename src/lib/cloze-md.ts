// markdown-it rendering for cloze and image occlusion (wired in lib/markdown.ts). No DOM.
//   {{c1::answer::hint}}  → <span class="cloze" data-c="1">answer</span>   (Read mode: the text with a subtle underline)
//   ==answer== in notes with env.cloze (flashcard notes) → <mark class="cloze">
//   {{?::hint}}           → <span class="cloze-gap">[hint]</span>   (Review front, built by clozeFront)
//   {{!::answer}}         → <span class="cloze-ans">answer</span>   (Review back, built by clozeBack)
//   ```occlusion          → image with outlined boxes and an "N cards" chip
import type MarkdownIt from "markdown-it";
import type { StateCore, StateInline } from "markdown-it";
import { closeAt, sepAt } from "./cloze";
import { attId, occlusionCardCount, parseOcclusion, safeImageUrl } from "./occlusion";

type MD = ReturnType<typeof MarkdownIt>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function clozePlugin(md: MD) {
  md.inline.ruler.before("emphasis", "cloze", (state: StateInline, silent: boolean) => {
    const src = state.src, pos = state.pos;
    if (src.charCodeAt(pos) !== 0x7b || src.charCodeAt(pos + 1) !== 0x7b) return false;
    const m = /^\{\{(c(\d+)|\?|!)::/.exec(src.slice(pos, pos + 14));
    if (!m) return false;
    const start = pos + m[0].length;
    const close = closeAt(src, start);
    if (close < 0 || close + 2 > state.posMax) return false;
    const inner = src.slice(start, close);
    const k = sepAt(inner);
    const ansEnd = k >= 0 ? start + k : close;
    const hint = k >= 0 ? inner.slice(k + 2).trim() : "";
    if (!silent) {
      if (m[1] === "?") {
        const t = state.push("html_inline", "", 0);
        t.content = `<span class="cloze-gap">[${esc(inner.trim() || "…")}]</span>`;
      } else {
        const o = state.push("cloze_open", "span", 1);
        o.attrSet("class", m[1] === "!" ? "cloze-ans" : "cloze");
        if (m[2]) o.attrSet("data-c", m[2]);
        if (hint) o.attrSet("title", hint);
        const oldMax = state.posMax;
        state.pos = start;
        state.posMax = ansEnd;
        state.md.inline.tokenize(state);
        state.posMax = oldMax;
        state.push("cloze_close", "span", -1);
      }
    }
    state.pos = close + 2;
    return true;
  });
  // ==text== in flashcard notes is a cloze (coloured highlights, ==x=={.hl-green}, stay highlights). Runs after hl-color.
  md.core.ruler.push("cloze-mark", (state: StateCore) => {
    if (!(state.env as { cloze?: boolean } | undefined)?.cloze) return;
    for (const blk of state.tokens) {
      if (blk.type !== "inline" || !blk.children) continue;
      for (const t of blk.children) if (t.type === "mark_open" && !/\bhl-/.test(String(t.attrGet("class") ?? ""))) t.attrJoin("class", "cloze");
    }
  });
}

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
/** Read-mode HTML for an ```occlusion block. */
export function occlusionHtml(content: string, lineAttr: string): string {
  const { data, error } = parseOcclusion(content);
  const id = attId(data.image);
  const url = id ? "" : safeImageUrl(data.image);
  const alt = esc(data.alt ?? "Image occlusion");
  const img = id ? `<img data-att="${esc(id)}" alt="${alt}" loading="lazy" draggable="false">` : url ? `<img src="${esc(url)}" alt="${alt}" loading="lazy" draggable="false">` : `<div class="occl-empty">No image yet. Open the editor to pick one.</div>`;
  const boxes = data.boxes.map((b) => `<span class="occl-box" style="left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}"${b.label ? ` title="${esc(b.label)}"` : ""}></span>`).join("");
  const n = occlusionCardCount(data);
  const mode = data.mode === "hide-all" ? "Hide all, guess one" : "Hide one, show others";
  return `<figure class="occl-card"${lineAttr} data-occl="${esc(data.id)}"><div class="occl-stage">${img}${boxes}</div><figcaption class="occl-meta"><span class="occl-chip">${n} ${n === 1 ? "card" : "cards"}</span><span>${mode}</span>${error ? `<span class="occl-err">${esc(error)}</span>` : ""}</figcaption></figure>`;
}
