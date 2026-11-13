import MarkdownIt, { type StateInline, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";
import { attMime, resolveAtt } from "./attachments";
import { unfurl } from "./api";

type MD = ReturnType<typeof MarkdownIt>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const enc = (s: string) => encodeURIComponent(s);

const CALLOUT_ICONS: Record<string, string> = {
  note: "✎", info: "ℹ", tip: "💡", hint: "💡", important: "❗", warning: "⚠", caution: "⚠", danger: "⛔", error: "⛔",
  example: "◆", question: "?", faq: "?", quote: "❝", success: "✓", check: "✓", todo: "☐", abstract: "≡", summary: "≡", bug: "🐞",
};

function build() {
  const md: MD = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(code, lang) {
      const l = lang?.trim().split(/\s+/)[0];
      const html = l && hljs.getLanguage(l) ? hljs.highlight(code, { language: l, ignoreIllegals: true }).value : esc(code);
      return `<pre class="code"><div class="code-head"><span>${esc(l || "text")}</span><button class="copy" type="button">Copy</button></div><code class="hljs">${html}</code></pre>`;
    },
  });
  md.use(footnote).use(taskLists, { enabled: true, label: true });
  md.use((katexPlugin as { default?: unknown }).default ?? katexPlugin, { throwOnError: false, enableMathBlockInHtml: true });

  // Fenced specials: mermaid, canvas (JSON Canvas), query (Dataview-lite).
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0];
    const line = t.map ? ` data-line="${t.map[0]}"` : "";
    if (lang === "mermaid") return `<div class="mermaid-block"${line} data-src="${enc(t.content)}"><div class="muted">Rendering diagram…</div></div>`;
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
      const [target, alias] = inner.split("|");
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
    if (/\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)(\?|$)/i.test(src) || /youtu\.?be|vimeo\.com/.test(src)) return embedHtml(src);
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
      toks[i].meta = { callout: m[1].toLowerCase(), fold: m[2], title: m[3] || m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() };
      inl.content = inl.content.slice(m[0].length);
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type === "blockquote_open") depth++;
        if (toks[j].type === "blockquote_close" && --depth === 0) { toks[j].meta = { callout: m[1], fold: m[2] }; break; }
      }
    }
  });
  md.renderer.rules.blockquote_open = (tokens, idx, opts, _env, self) => {
    const m = tokens[idx].meta as { callout?: string; fold?: string; title?: string } | null;
    if (!m?.callout) return self.renderToken(tokens, idx, opts);
    const icon = CALLOUT_ICONS[m.callout] ?? "✎";
    const head = `<span class="callout-icon">${icon}</span><span>${md.renderInline(m.title ?? "")}</span>`;
    const line = tokens[idx].map ? ` data-line="${tokens[idx].map![0]}"` : "";
    return m.fold
      ? `<details class="callout" data-callout="${esc(m.callout)}"${line}${m.fold === "+" ? " open" : ""}><summary class="callout-title">${head}</summary><div class="callout-body">`
      : `<div class="callout" data-callout="${esc(m.callout)}"${line}><div class="callout-title">${head}</div><div class="callout-body">`;
  };
  md.renderer.rules.blockquote_close = (tokens, idx, opts, _env, self) => {
    const m = tokens[idx].meta as { callout?: string; fold?: string } | null;
    if (!m?.callout) return self.renderToken(tokens, idx, opts);
    return m.fold ? "</div></details>" : "</div></div>";
  };

  // data-line on top-level blocks (scroll sync) + dir="auto" so Arabic and English lines each get the right direction.
  const BIDI = new Set(["paragraph_open", "heading_open", "list_item_open", "th_open", "td_open", "blockquote_open"]);
  md.core.ruler.push("lines", (state) => {
    for (const t of state.tokens as Token[]) {
      if (t.map && t.nesting === 1 && t.level === 0 && !t.meta?.callout) t.attrSet("data-line", String(t.map[0]));
      if (BIDI.has(t.type)) t.attrSet("dir", "auto");
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
      tok.content = embedHtml(href).replace(/^<(\w+)/, `<$1${line}`);
      toks.splice(i, 3, tok);
    }
  });
  return md;
}

const ytId = (u: URL) =>
  u.hostname === "youtu.be" ? u.pathname.slice(1) : /(^|\.)youtube\.com$/.test(u.hostname) ? u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[1] ?? null : null;

/** HTML for an embeddable URL: YouTube / Vimeo player, <video>, <audio>, or a link-preview card. */
export function embedHtml(href: string): string {
  let u: URL;
  try { u = new URL(href); } catch { return `<p><a href="${esc(href)}">${esc(href)}</a></p>`; }
  const yt = ytId(u);
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const t = parseInt(u.searchParams.get("t") ?? "", 10) || 0;
    return `<div class="embed video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}${t ? `?start=${t}` : ""}" title="YouTube video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  }
  const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(href);
  if (vm) return `<div class="embed video"><iframe src="https://player.vimeo.com/video/${vm[1]}" title="Vimeo video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return `<div class="embed"><video src="${esc(href)}" controls preload="metadata" playsinline></video></div>`;
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(u.pathname)) return `<div class="embed"><audio src="${esc(href)}" controls preload="metadata"></audio></div>`;
  const host = u.hostname.replace(/^www\./, "");
  return `<a class="link-card" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-unfurl="${esc(href)}"><span class="lc-body"><span class="lc-title">${esc(host)}</span><span class="lc-desc">${esc(href)}</span><span class="lc-host"><img alt="" src="https://www.google.com/s2/favicons?domain=${esc(u.hostname)}&sz=32">${esc(host)}</span></span></a>`;
}

let instance: MD | null = null;
export function render(src: string): string {
  instance ??= build();
  return instance.render(src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
}

// ------------------------------------------------------------------ post-render hydration
let mermaidMod: Promise<typeof import("mermaid")> | null = null;
let mermaidTheme = "";
let seq = 0;
async function renderMermaid(el: HTMLElement) {
  mermaidMod ??= import("mermaid");
  const mermaid = (await mermaidMod).default;
  const theme = document.documentElement.dataset.dark === "1" ? "dark" : "neutral";
  if (theme !== mermaidTheme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: "strict", fontFamily: "Inter, system-ui, sans-serif" });
    mermaidTheme = theme;
  }
  const id = `mmd-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, decodeURIComponent(el.dataset.src ?? ""));
    el.innerHTML = svg;
  } catch (e) {
    el.innerHTML = `<div class="render-error">Mermaid: ${esc(String((e as Error).message ?? e).split("\n")[0])}</div>`;
    document.getElementById(`d${id}`)?.remove();
  }
}

export interface HydrateCtx {
  /** Renders a ```query block (Dataview-lite) into the element. */
  query?: (el: HTMLElement, q: string) => void;
  /** Renders a ```canvas block preview into the element. */
  canvas?: (el: HTMLElement, json: string) => void;
}

export function hydrate(root: HTMLElement, ctx: HydrateCtx = {}) {
  root.querySelectorAll<HTMLElement>(".mermaid-block").forEach((el) => void renderMermaid(el));
  root.querySelectorAll<HTMLImageElement>("img[data-att]").forEach(async (img) => {
    const id = img.dataset.att!;
    const [url, mime] = await Promise.all([resolveAtt(id), attMime(id)]);
    if (mime.startsWith("video/") || mime.startsWith("audio/")) {
      const m = document.createElement(mime.startsWith("video/") ? "video" : "audio");
      m.src = url;
      m.controls = true;
      m.preload = "metadata";
      m.setAttribute("playsinline", "");
      const wrap = document.createElement("div");
      wrap.className = "embed";
      wrap.append(m);
      img.replaceWith(wrap);
    } else if (mime === "application/pdf") {
      const f = document.createElement("iframe");
      f.src = url;
      f.className = "pdf-embed";
      f.title = img.alt;
      img.replaceWith(f);
    } else img.src = url;
  });
  root.querySelectorAll<HTMLAnchorElement>("a.link-card[data-unfurl]").forEach((a) => void unfurlCard(a));
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
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1200);
  return true;
}

async function unfurlCard(a: HTMLAnchorElement) {
  const meta = await unfurl(a.dataset.unfurl!);
  if (!meta) return;
  const title = a.querySelector<HTMLElement>(".lc-title");
  const desc = a.querySelector<HTMLElement>(".lc-desc");
  if (title && meta.title) { title.textContent = meta.title; title.dir = "auto"; }
  if (desc) { desc.textContent = meta.description || a.dataset.unfurl!; desc.dir = "auto"; }
  if (meta.image && !a.querySelector(".lc-img")) {
    const img = document.createElement("img");
    img.className = "lc-img";
    img.src = meta.image;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => img.remove();
    a.append(img);
  }
}
