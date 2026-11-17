import MarkdownIt, { type StateInline, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";
import { attMime, resolveAtt } from "./attachments";
import { audioFileHtml, hydrateEmbeds, linkCardHtml, pdfHtml, videoFileHtml, videoThumbHtml, type EmbedCtx } from "../components/ws-embeds";
import { icon } from "../components/ws-icons";

type MD = ReturnType<typeof MarkdownIt>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const enc = (s: string) => encodeURIComponent(s);

// Callout icons (design: Components · Callouts) as Lucide SVGs.
const CALLOUT_ICONS: Record<string, string> = {
  note: "info", info: "info", tip: "lightbulb", hint: "lightbulb", important: "triangle-alert", warning: "triangle-alert", caution: "triangle-alert",
  danger: "octagon-alert", error: "octagon-alert", example: "list", question: "circle-help", faq: "circle-help", quote: "quote",
  success: "circle-check", check: "circle-check", todo: "clipboard-list", abstract: "list", summary: "list", bug: "bug",
};
const MERMAID_KIND = (src: string) => (src.trim().split(/\r?\n/).find((l) => l.trim() && !/^\s*%%/.test(l)) ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

/** Direction of the first strong letter (callouts mirror their furniture in RTL: icon and title move right). */
function strongDir(s: string): "ltr" | "rtl" | "auto" {
  const m = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(s.replace(/\[[^\]]*\]\([^)]*\)|\x60[^\x60]*\x60|\$[^$]*\$/g, ""));
  return !m ? "auto" : /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]) ? "rtl" : "ltr";
}

function build() {
  const md: MD = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(code, lang) {
      const l = lang?.trim().split(/\s+/)[0];
      const html = l && hljs.getLanguage(l) ? hljs.highlight(code, { language: l, ignoreIllegals: true }).value : esc(code);
      return `<pre class="code" dir="ltr"><div class="code-head"><span>${esc(l || "text")}</span><button class="copy" type="button">${icon("copy", 13)}<span>Copy</span></button></div><code class="hljs">${html}</code></pre>`;
    },
  });
  md.use(footnote).use(taskLists, { enabled: true, label: true }).use(mark).use(sub).use(sup); // ==mark==, H~2~O, x^2^
  // Highlight colours (lib/highlights.ts): ==text=={.hl-green} → <mark class="hl-green">; plain ==text== stays yellow.
  md.core.ruler.after("inline", "hl-color", (state) => {
    for (const blk of state.tokens) {
      const ch = blk.children;
      if (blk.type !== "inline" || !ch) continue;
      for (let i = 0; i < ch.length; i++) {
        if (ch[i].type !== "mark_close") continue;
        const next = ch[i + 1];
        const m = next?.type === "text" ? /^\{\.hl-(yellow|green|blue|pink|purple)\}/.exec(next.content) : null;
        if (!m) continue;
        next!.content = next!.content.slice(m[0].length);
        for (let j = i - 1; j >= 0; j--) if (ch[j].type === "mark_open") { ch[j].attrJoin("class", `hl-${m[1]}`); break; }
      }
    }
  });
  // Footnote refs as a bare superscript number (design 5A), back-links as ↩
  md.renderer.rules.footnote_caption = (tokens, idx) => { const m = tokens[idx].meta as { id: number; subId: number }; return String(m.id + 1) + (m.subId > 0 ? `:${m.subId}` : ""); };
  md.renderer.rules.footnote_anchor = (tokens, idx, opts, env, slf) => ` <a href="#fnref${slf.rules.footnote_anchor_name!(tokens, idx, opts, env, slf)}${(tokens[idx].meta as { subId: number }).subId > 0 ? `:${(tokens[idx].meta as { subId: number }).subId}` : ""}" class="footnote-backref">↩</a>`;
  md.use((katexPlugin as { default?: unknown }).default ?? katexPlugin, { throwOnError: false, enableMathBlockInHtml: true });

  // Fenced specials: mermaid, canvas (JSON Canvas), query (Dataview-lite).
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0];
    const line = t.map ? ` data-line="${t.map[0]}"` : "";
    if (lang === "mermaid") return `<div class="mermaid-card"${line} tabindex="-1"><div class="mm-head"><span>mermaid · ${esc(MERMAID_KIND(t.content))}</span><span class="mm-tools"><button type="button" class="mm-zout" title="Zoom out (−)" aria-label="Zoom out">${icon("minus", 13)}</button><button type="button" class="mm-zlabel" title="Fit (0) · double-click the diagram to switch between fit and 100%">Fit</button><button type="button" class="mm-zin" title="Zoom in (+)" aria-label="Zoom in">${icon("plus", 13)}</button><button type="button" class="mm-z100" title="Actual size (100%)">1:1</button><span class="mm-sep"></span><button type="button" class="mm-export" title="Export: SVG, PNG, JPEG, WebP · copy image">${icon("download", 13)}</button><button type="button" class="mm-src" title="Show source">${icon("code", 14)}</button><button type="button" class="mm-full" title="Full screen">${icon("maximize-2", 13)}</button></span></div><div class="mermaid-block" data-src="${enc(t.content)}"><div class="muted">Rendering diagram…</div></div><pre class="mm-code" hidden><code>${esc(t.content)}</code></pre></div>`;
    if (lang === "canvas") return `<div class="canvas-embed"${line} data-canvas="${enc(t.content)}"></div>`;
    if (lang === "query") return `<div class="query-block"${line} data-q="${enc(t.content.trim())}"></div>`;
    return fence(tokens, idx, opts, env, self).replace("<pre", `<pre${line}`);
  };

  // [[Wiki links]] and ![[embeds]] (embeds render as links in v1).
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src;
    let pos = state.pos;
    if (src[pos] === "!" && src[pos + 1] === "[") pos++;
    if (src[pos] !== "[" || src[pos + 1] !== "[") return false;
    const end = src.indexOf("]]", pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner || inner.includes("\n")) return false;
    if (!silent) {
      // `[[Note\|Alias]]` is how Obsidian escapes the pipe inside tables: drop the backslash.
      const [target, alias] = inner.replace(/\\\|/g, "|").split("|");
      const [title, heading] = target.split("#");
      const tok = state.push("wikilink", "", 0);
      tok.meta = { title: title.trim(), heading: heading?.trim() ?? "", label: (alias ?? target).trim() };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx) => {
    const m = tokens[idx].meta as { title: string; heading: string; label: string };
    return `<a class="wikilink" href="#" data-note="${esc(m.title)}" data-heading="${esc(m.heading)}">${esc(m.label)}</a>`;
  };

  // #tags
  md.inline.ruler.after("wikilink", "hashtag", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== "#" || (pos > 0 && !/\s/.test(src[pos - 1]))) return false;
    const m = /^#([\p{L}\p{N}_/-]+)/u.exec(src.slice(pos));
    if (!m || /^\d+$/.test(m[1])) return false;
    if (!silent) state.push("hashtag", "", 0).meta = { tag: m[1] };
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.hashtag = (tokens, idx) => { const t = String((tokens[idx].meta as { tag: string }).tag); return `<a class="tag" href="#" data-tag="${esc(t.toLowerCase())}">#${esc(t)}</a>`; };

  // Attachments: ![](att:id) and [x](att:id)
  md.validateLink = (url) => !/^(javascript|vbscript|file|data):/i.test(url.trim()) || /^data:image\/(png|jpe?g|gif|webp);/i.test(url.trim());
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const src = String(tokens[idx].attrGet("src") ?? "");
    if (src.startsWith("att:")) return `<img data-att="${esc(src.slice(4))}" alt="${esc(tokens[idx].content)}" loading="lazy">`;
    if (/\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|pdf)(\?|$)/i.test(src) || /youtu\.?be|vimeo\.com/.test(src)) return embedHtml(src, tokens[idx].content);
    tokens[idx].attrSet("loading", "lazy");
    return image(tokens, idx, opts, env, self);
  };
  const linkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = String(tokens[idx].attrGet("href") ?? "");
    if (href.startsWith("att:")) { tokens[idx].attrSet("data-att", href.slice(4)); tokens[idx].attrSet("href", "#"); }
    else if (/^https?:/.test(href)) { tokens[idx].attrSet("target", "_blank"); tokens[idx].attrSet("rel", "noopener noreferrer"); }
    return linkOpen(tokens, idx, opts, env, self);
  };

  // Callouts: > [!type]± Title
  md.core.ruler.before("inline", "callout", (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== "blockquote_open" || toks[i + 2]?.type !== "inline") continue;
      const inl = toks[i + 2];
      const m = /^\[!(\w+)\]([-+]?)[ \t]*(.*)(?:\n|$)/.exec(inl.content);
      if (!m) continue;
      toks[i].meta = { callout: m[1].toLowerCase(), fold: m[2], title: m[3] || m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), dir: strongDir((m[3] || "") + " " + inl.content.slice(m[0].length)) };
      inl.content = inl.content.slice(m[0].length);
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type === "blockquote_open") depth++;
        if (toks[j].type === "blockquote_close" && --depth === 0) { toks[j].meta = { callout: m[1], fold: m[2] }; break; }
      }
    }
  });
  md.renderer.rules.blockquote_open = (tokens, idx, opts, _env, self) => {
    const m = tokens[idx].meta as { callout?: string; fold?: string; title?: string; dir?: string } | null;
    if (!m?.callout) return self.renderToken(tokens, idx, opts);
    const ic = `<span class="callout-icon">${icon(CALLOUT_ICONS[m.callout] ?? "info", 15)}</span>`;
    const line = tokens[idx].map ? ` data-line="${tokens[idx].map![0]}"` : "";
    const type = m.callout[0].toUpperCase() + m.callout.slice(1);
    if (m.fold) {
      // Folded: chevron · icon · Type (colored) · title · "folded" (design: 5A "Question … folded")
      const t = m.title && m.title.toLowerCase() !== m.callout ? `<span class="callout-t2" dir="auto">${md.renderInline(m.title)}</span>` : "";
      return `<details class="callout" data-callout="${esc(m.callout)}"${line} dir="${m.dir ?? "auto"}"${m.fold === "+" ? " open" : ""}><summary class="callout-title"><span class="callout-chev">${icon("chevron-right", 14)}</span>${ic}<span class="callout-type">${esc(type)}</span>${t}<span class="callout-fold"></span></summary><div class="callout-body">`;
    }
    return `<div class="callout" data-callout="${esc(m.callout)}"${line} dir="${m.dir ?? "auto"}"><div class="callout-title">${ic}<span dir="auto">${md.renderInline(m.title ?? "")}</span></div><div class="callout-body">`;
  };
  md.renderer.rules.blockquote_close = (tokens, idx, opts, _env, self) => {
    const m = tokens[idx].meta as { callout?: string; fold?: string } | null;
    if (!m?.callout) return self.renderToken(tokens, idx, opts);
    return m.fold ? "</div></details>" : "</div></div>";
  };

  // Force one block's direction: end the block with {dir=rtl} or {dir=ltr} (design 08: "the ¶ menu can force a block").
  md.core.ruler.before("inline", "forcedir", (state) => {
    const toks = state.tokens as Token[];
    for (let i = 1; i < toks.length; i++) {
      if (toks[i].type !== "inline") continue;
      const m = /[ 	]*\{dir=(rtl|ltr)\}[ 	]*$/.exec(toks[i].content);
      if (!m) continue;
      toks[i].content = toks[i].content.slice(0, m.index);
      toks[i - 1].meta = { ...(toks[i - 1].meta ?? {}), forceDir: m[1] };
    }
  });

  // 📅 2026-11-18 / @due(2026-11-18) → date chip (design 5A: task with due date).
  // (done at render time: 📅 isn't a markdown-it terminator char, so an inline rule would never see it)
  const dueChip = (date: string) => {
    const d = new Date(date + "T00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return `<span class="${d < today ? "due over" : "due"}">${icon("calendar", 13)}${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")}</span>`;
  };
  md.renderer.rules.text = (tokens, idx) => {
    const h = esc(tokens[idx].content);
    return /📅|@due\(/u.test(h) ? h.replace(/(?:📅\s*|@due\()(\d{4}-\d{2}-\d{2})\)?/gu, (_m, d: string) => dueChip(d)) : h;
  };

  // data-line on top-level blocks (scroll sync) + dir="auto" so Arabic and English lines each get the right direction.
  const BIDI = new Set(["paragraph_open", "heading_open", "list_item_open", "th_open", "td_open", "blockquote_open"]);
  md.core.ruler.push("lines", (state) => {
    for (const t of state.tokens as Token[]) {
      if (t.map && t.nesting === 1 && t.level === 0 && !t.meta?.callout) t.attrSet("data-line", String(t.map[0]));
      if (BIDI.has(t.type)) t.attrSet("dir", (t.meta?.forceDir as string) ?? "auto");
      if (t.meta?.forceDir) t.attrJoin("class", "dir-forced");
    }
  });

  // Paragraphs made only of `Question :: Answer` lines → flashcard rows.
  md.core.ruler.push("cards", (state) => {
    const toks = state.tokens as Token[];
    for (let i = 0; i < toks.length - 2; i++) {
      if (toks[i].type !== "paragraph_open" || toks[i + 1].type !== "inline" || toks[i + 2].type !== "paragraph_close") continue;
      const lines = toks[i + 1].content.split("\n");
      if (!lines.every((l) => /^(?:[-*]\s+)?\S.*?\s+::\s+\S/.test(l))) continue;
      const tok = new state.Token("html_block", "", 0);
      tok.content = lines.map((l) => {
        const m = /^(?:[-*]\s+)?(.+?)\s+::\s+(.+)$/.exec(l)!;
        return `<div class="fc-row"${toks[i].map ? ` data-line="${toks[i].map![0]}"` : ""}><span class="fc-tag"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>Card</span><span class="fc-q" dir="auto">${md.renderInline(m[1])}</span><span class="fc-a" dir="auto">${md.renderInline(m[2])}</span></div>`;
      }).join("");
      toks.splice(i, 3, tok);
    }
  });

  // A paragraph that is only a URL → embed (YouTube / Vimeo / video / audio) or a link-preview card.
  md.core.ruler.push("embeds", (state) => {
    const toks = state.tokens as Token[];
    for (let i = 0; i < toks.length - 2; i++) {
      if (toks[i].type !== "paragraph_open" || toks[i + 1].type !== "inline" || toks[i + 2].type !== "paragraph_close") continue;
      const kids = toks[i + 1].children ?? [];
      if (kids.length !== 3 || kids[0].type !== "link_open" || kids[2].type !== "link_close") continue;
      const href = String(kids[0].attrGet("href") ?? "");
      const bare = (x: string) => x.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (!/^https?:\/\//.test(href) || bare(kids[1].content) !== bare(href)) continue;
      const line = toks[i].map ? ` data-line="${toks[i].map![0]}"` : "";
      const tok = new state.Token("html_block", "", 0);
      // <https://…> (autolink) always renders a preview card; a bare URL embeds known media, else a card.
      tok.content = (kids[0].markup === "autolink" ? linkCardHtml(href) : embedHtml(href)).replace(/^<(\w+)/, `<$1${line}`);
      toks.splice(i, 3, tok);
    }
  });
  return md;
}

const ytId = (u: URL) =>
  u.hostname === "youtu.be" ? u.pathname.slice(1) : /(^|\.)youtube\.com$/.test(u.hostname) ? u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[1] ?? null : null;

/** HTML for an embeddable URL: YouTube / Vimeo thumbnail-until-play, video / audio player cards, PDF viewer, or a link-preview card. */
export function embedHtml(href: string, name?: string): string {
  let u: URL;
  try { u = new URL(href); } catch { return `<p><a href="${esc(href)}">${esc(href)}</a></p>`; }
  const yt = ytId(u);
  if (yt && /^[\w-]{6,20}$/.test(yt)) return videoThumbHtml("youtube", yt, href, parseInt(u.searchParams.get("t") ?? "", 10) || 0);
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(href);
  if (vm) return videoThumbHtml("vimeo", vm[1], href);
  const nm = name?.trim() || undefined;
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return videoFileHtml(href, nm);
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(u.pathname)) return audioFileHtml(href, nm);
  if (/\.pdf$/i.test(u.pathname)) return pdfHtml(href, nm);
  return linkCardHtml(href);
}

let instance: MD | null = null;
export function render(src: string): string {
  instance ??= build();
  // Front-matter becomes blank lines (not removed) so data-line numbers match the editor's lines.
  return instance.render(src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, (m) => "\n".repeat((m.match(/\n/g) ?? []).length)));
}

// ------------------------------------------------------------------ post-render hydration
let mermaidMod: Promise<typeof import("mermaid")> | null = null;
/** Lazy-load Mermaid; a failed load (e.g. a chunk missing right after a deploy) is not cached, so the next try works. */
async function loadMermaid() {
  mermaidMod ??= import("mermaid");
  try { return (await mermaidMod).default; } catch (e) { mermaidMod = null; throw e; }
}
let mermaidTheme = "";
let seq = 0;
async function renderMermaid(el: HTMLElement) {
  const mermaid = await loadMermaid();
  // Diagram colors come from the theme tokens (design 5A: surface-2 nodes, border strokes, muted edges, 12 px Inter).
  const css = getComputedStyle(document.documentElement);
  const tok = (k: string) => css.getPropertyValue(k).trim();
  const theme = [tok("--surface-2"), tok("--border"), tok("--text"), tok("--muted"), tok("--surface")].join("|");
  if (theme !== mermaidTheme) {
    mermaid.initialize({
      startOnLoad: false, theme: "base", securityLevel: "strict", fontFamily: "Inter, system-ui, sans-serif",
      themeVariables: {
        darkMode: document.documentElement.dataset.dark === "1", fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px",
        primaryColor: tok("--surface-2"), primaryBorderColor: tok("--border"), primaryTextColor: tok("--text"), secondaryColor: tok("--surface-2"), tertiaryColor: tok("--surface"),
        lineColor: tok("--muted"), textColor: tok("--text"), mainBkg: tok("--surface-2"), nodeBorder: tok("--border"), clusterBkg: tok("--surface"), edgeLabelBackground: tok("--surface"),
      },
      flowchart: { curve: "basis", padding: 12, nodeSpacing: 24, rankSpacing: 28 },
    });
    mermaidTheme = theme;
  }
  const id = `mmd-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, decodeURIComponent(el.dataset.src ?? ""));
    el.innerHTML = svg;
    const card = el.closest<HTMLElement>(".mermaid-card");
    if (card) diagramViewer(card, el);
  } catch (e) {
    el.innerHTML = `<div class="render-error">Mermaid: ${esc(String((e as Error).message ?? e).split("\n")[0])}</div>`;
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Zoom + pan for a rendered Mermaid diagram (card toolbar: − / Fit / + / 1:1).
 * - Starts fitted to the card width (never upscaled inline), so wide diagrams are readable on demand, not squished.
 * - Ctrl/⌘ + wheel or trackpad pinch zooms at the pointer (plain wheel too in full screen); two-finger pinch on touch.
 * - Drag to pan once zoomed in; double-click toggles fit ↔ 100%; keys + − 0 while the card has focus or is full screen.
 * The SVG keeps its natural size and is moved with a CSS transform, so text stays crisp at every zoom level.
 */
function diagramViewer(card: HTMLElement, stage: HTMLElement) {
  const svg = stage.querySelector("svg");
  if (!svg || stage.dataset.viewer || card.closest(".lslide")) return; // slides size diagrams themselves
  stage.dataset.viewer = "1";
  const vb = svg.viewBox.baseVal;
  const W = vb && vb.width ? vb.width : svg.getBoundingClientRect().width || 600;
  const H = vb && vb.height ? vb.height : svg.getBoundingClientRect().height || 400;
  svg.removeAttribute("width");
  svg.style.maxWidth = "none";
  svg.style.width = `${W}px`;
  svg.style.height = `${H}px`;
  const pan = document.createElement("div");
  pan.className = "mm-pan";
  svg.replaceWith(pan);
  pan.appendChild(svg);
  stage.classList.add("mm-stage");
  const label = card.querySelector<HTMLElement>(".mm-zlabel");
  const MIN = 0.1, MAX = 8;
  let k = 1, x = 0, y = 0, fitted = true;

  const full = () => document.fullscreenElement === card;
  // Full screen, or a diagram card on a canvas: the stage fills its box, fits both ways and zooms on plain wheel.
  const boxed = () => full() || !!card.closest(".diagram-node");
  const pad = () => (full() ? 24 : 16);
  const fitScale = () => {
    const w = stage.clientWidth - pad() * 2;
    const s = w / W;
    if (!boxed()) return Math.min(1, s);
    const h = stage.clientHeight - pad() * 2;
    const t = Math.min(s, h / H);
    return t > 0.01 ? t : Math.max(0.05, Math.min(1, s)); // box not laid out yet: fit the width for now
  };
  const apply = () => {
    // Inline: the stage grows with the diagram up to 75% of the screen; full screen: the card's flex area.
    if (!boxed()) stage.style.height = `${Math.round(Math.min(Math.max(H * k, H * fitScale()) + pad() * 2, innerHeight * 0.75))}px`;
    else stage.style.height = "";
    const sw = stage.clientWidth, sh = stage.clientHeight, cw = W * k, ch = H * k;
    // Keep the drawing on screen: centred when smaller than the stage, clamped to its edges when larger.
    x = cw <= sw ? (sw - cw) / 2 : Math.min(pad(), Math.max(sw - cw - pad(), x));
    y = ch <= sh ? (sh - ch) / 2 : Math.min(pad(), Math.max(sh - ch - pad(), y));
    pan.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    stage.classList.toggle("mm-zoomed", cw > sw + 1 || ch > sh + 1);
    if (label) label.textContent = fitted ? `Fit · ${Math.round(k * 100)}%` : `${Math.round(k * 100)}%`;
  };
  /** Zoom to `nk`, keeping the stage point (px, py) still. */
  const zoomTo = (nk: number, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
    nk = Math.min(MAX, Math.max(MIN, nk));
    x = px - ((px - x) * nk) / k;
    y = py - ((py - y) * nk) / k;
    k = nk;
    fitted = false;
    apply();
  };
  const fit = () => { k = fitScale(); fitted = true; x = 0; y = 0; apply(); };
  const step = (dir: 1 | -1) => zoomTo(dir > 0 ? k * 1.25 : k / 1.25);

  card.querySelector(".mm-zin")?.addEventListener("click", () => step(1));
  card.querySelector(".mm-zout")?.addEventListener("click", () => step(-1));
  label?.addEventListener("click", fit);
  card.querySelector(".mm-z100")?.addEventListener("click", () => zoomTo(1));
  stage.addEventListener("dblclick", (e) => {
    e.stopPropagation(); e.preventDefault(); // the reader's double-click-to-edit must not fire on a diagram
    const r = stage.getBoundingClientRect();
    if (fitted && Math.abs(k - 1) > 0.01) zoomTo(1, e.clientX - r.left, e.clientY - r.top); else fit();
  });
  stage.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey || boxed())) return; // plain wheel scrolls the page inline
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomTo(k * Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Drag to pan (mouse / pen / one finger when zoomed); two fingers pinch-zoom.
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; k: number } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!stage.classList.contains("mm-zoomed") && e.pointerType !== "touch") return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k }; }
    if (stage.classList.contains("mm-zoomed") || pts.size === 2) { stage.setPointerCapture(e.pointerId); stage.classList.add("mm-grabbing"); }
  });
  stage.addEventListener("pointermove", (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, cur);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const r = stage.getBoundingClientRect();
      zoomTo(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (stage.classList.contains("mm-zoomed")) {
      x += cur.x - prev.x; y += cur.y - prev.y; fitted = false; apply();
    }
  });
  const end = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) stage.classList.remove("mm-grabbing"); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  card.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); step(1); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); step(-1); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
  });
  stage.addEventListener("pointerdown", () => card.focus({ preventScroll: true }));
  // Re-fit when the card resizes (window, side panel, full screen) unless the reader picked a zoom.
  new ResizeObserver(() => { if (fitted) fit(); else apply(); }).observe(stage);
  const onFs = () => {
    if (!card.isConnected) { document.removeEventListener("fullscreenchange", onFs); return; }
    if (document.fullscreenElement === card || !document.fullscreenElement) requestAnimationFrame(fit);
  };
  document.addEventListener("fullscreenchange", onFs);
  fit();
}

export type ExportTheme = "app" | "default" | "dark" | "neutral" | "forest";
/**
 * Render Mermaid source for export (diagram-export.ts) with the chosen theme and labels as SVG <text> (no
 * foreignObject: HTML labels taint a canvas when rasterized and don't open in Figma/Illustrator/Inkscape), then
 * reset so the next in-app render re-applies the app theme.
 */
export async function renderMermaidForExport(src: string, theme: ExportTheme, svgText = true): Promise<string> {
  const mermaid = await loadMermaid();
  const css = getComputedStyle(document.documentElement);
  const tok = (k: string) => css.getPropertyValue(k).trim();
  const font = "Inter, \"IBM Plex Sans Arabic\", system-ui, sans-serif";
  mermaid.initialize({
    startOnLoad: false, securityLevel: "strict", fontFamily: font,
    theme: theme === "app" ? "base" : theme,
    themeVariables: theme === "app" ? {
      darkMode: document.documentElement.dataset.dark === "1", fontFamily: font, fontSize: "14px",
      primaryColor: tok("--surface-2"), primaryBorderColor: tok("--border"), primaryTextColor: tok("--text"), secondaryColor: tok("--surface-2"), tertiaryColor: tok("--surface"),
      lineColor: tok("--muted"), textColor: tok("--text"), mainBkg: tok("--surface-2"), nodeBorder: tok("--border"), clusterBkg: tok("--surface"), edgeLabelBackground: tok("--surface"),
    } : { fontFamily: font, fontSize: "14px" },
    htmlLabels: !svgText,
    flowchart: { curve: "basis", padding: 12, nodeSpacing: 24, rankSpacing: 28, htmlLabels: !svgText },
  });
  mermaidTheme = ""; // force the in-app theme back on the next in-app render
  const id = `mmx-${++seq}`;
  try {
    return (await mermaid.render(id, src)).svg;
  } finally {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

export interface HydrateCtx extends EmbedCtx {
  /** Renders a ```query block (Dataview-lite) into the element. */
  query?: (el: HTMLElement, q: string) => void;
  /** Renders a ```canvas block preview into the element. */
  canvas?: (el: HTMLElement, json: string) => void;
}

export function hydrate(root: HTMLElement, ctx: HydrateCtx = {}) {
  markArabic(root);
  root.querySelectorAll<HTMLElement>(".mermaid-block").forEach((el) => void renderMermaid(el));
  root.querySelectorAll<HTMLElement>(".mermaid-card").forEach((card) => {
    card.querySelector(".mm-src")?.addEventListener("click", () => { const c = card.querySelector<HTMLElement>(".mm-code")!; c.hidden = !c.hidden; card.classList.toggle("src-open", !c.hidden); });
    card.querySelector(".mm-full")?.addEventListener("click", () => { if (document.fullscreenElement === card) void document.exitFullscreen(); else void card.requestFullscreen?.(); });
    card.querySelector(".mm-export")?.addEventListener("click", () => {
      const src = decodeURIComponent(card.querySelector<HTMLElement>(".mermaid-block")?.dataset.src ?? "");
      if (document.fullscreenElement) void document.exitFullscreen();
      void import("./diagram-export").then((m) => m.openDiagramExport(src, card.dataset.name || "diagram"));
    });
  });
  root.querySelectorAll<HTMLImageElement>("img[data-att]").forEach(async (img) => {
    const id = img.dataset.att!;
    const [url, mime] = await Promise.all([resolveAtt(id), attMime(id)]);
    const name = img.alt || "file";
    const html = mime.startsWith("video/") ? videoFileHtml(url, name) : mime.startsWith("audio/") ? audioFileHtml(url, name) : mime === "application/pdf" ? pdfHtml(url, name) : null;
    if (html) {
      const t = document.createElement("template");
      t.innerHTML = html;
      const el = t.content.firstElementChild as HTMLElement;
      (img.closest("p") && img.closest("p")!.childNodes.length === 1 ? img.closest("p")! : img).replaceWith(el);
      hydrateEmbeds(el.parentElement ?? root, ctx);
    } else img.src = url;
  });
  hydrateEmbeds(root, ctx);
  root.querySelectorAll<HTMLAnchorElement>("a[data-att]").forEach(async (a) => { a.href = await resolveAtt(a.dataset.att!); a.target = "_blank"; });
  if (ctx.query) root.querySelectorAll<HTMLElement>(".query-block").forEach((el) => ctx.query!(el, decodeURIComponent(el.dataset.q ?? "")));
  if (ctx.canvas) root.querySelectorAll<HTMLElement>(".canvas-embed").forEach((el) => ctx.canvas!(el, decodeURIComponent(el.dataset.canvas ?? "")));
}

/** Delegated click handler for copy buttons inside rendered markdown. Returns true if handled. */
export function handleCopyClick(e: MouseEvent | React.MouseEvent) {
  const btn = (e.target as HTMLElement).closest("button.copy");
  if (!btn) return false;
  const code = btn.closest("pre")?.querySelector("code")?.textContent ?? "";
  void navigator.clipboard.writeText(code);
  const label = btn.querySelector("span");
  if (label) { label.textContent = "Copied"; setTimeout(() => (label.textContent = "Copy"), 1200); }
  return true;
}

/** Arabic runs inside reading text get the Arabic face at ~1.12× (design: Lumen 08 / NoteBidi optical size bump). */
const AR_RUN = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[\s\u060C\u061B\u061F\u0640.,:!?«»()-]*[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;
function markArabic(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("pre, code, .katex, .mermaid-block, .mermaid-card, .ar, svg, .fc-tag") ? NodeFilter.FILTER_REJECT : /[\u0600-\u06FF]/.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const t of nodes) {
    const text = t.nodeValue ?? "";
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(AR_RUN)) {
      if (m.index! > last) frag.append(text.slice(last, m.index));
      const span = document.createElement("span");
      span.className = "ar";
      span.dir = "rtl";
      span.textContent = m[0];
      frag.append(span);
      last = m.index! + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    t.replaceWith(frag);
  }
}
