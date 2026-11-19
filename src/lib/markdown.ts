import MarkdownIt, { type StateInline, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";
import { attMime, resolveAtt } from "./attachments";
import { blockSource, pendingBlock, setPendingBlock } from "./blocks";
import { audioFileHtml, hydrateEmbeds, linkCardHtml, pdfHtml, videoFileHtml, videoThumbHtml, type EmbedCtx } from "../components/ws-embeds";
import { timestampChip } from "../components/video-players";
import { fromMatch, TS_AT } from "./video-notes";
import { icon } from "../components/ws-icons";
import { glyphSvg } from "./glyph-svg";
import { hasGlyph } from "./glyphs";
import { clozeEnabled } from "./cloze";
import { clozePlugin, occlusionHtml } from "./cloze-md";

type MD = ReturnType<typeof MarkdownIt>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const enc = (s: string) => encodeURIComponent(s);

// Callout glyphs (design R4, Lumen 13 B4 "Callouts": c-note … c-abstract).
const CALLOUT_GLYPH: Record<string, string> = {
  note: "c-note", info: "c-info", tip: "c-tip", hint: "c-tip", important: "c-warning", warning: "c-warning", caution: "c-warning",
  danger: "c-danger", error: "c-danger", example: "c-example", question: "c-question", faq: "c-question", quote: "c-quote", cite: "c-quote",
  success: "c-success", check: "c-success", done: "c-success", todo: "task", abstract: "c-abstract", summary: "c-abstract", tldr: "c-abstract", bug: "c-danger", failure: "c-danger",
};
const MERMAID_KIND = (src: string) => (src.trim().split(/\r?\n/).find((l) => l.trim() && !/^\s*%%/.test(l)) ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

/** Direction of the first strong letter (callouts mirror their furniture in RTL: icon and title move right). */
function strongDir(s: string): "ltr" | "rtl" | "auto" {
  const m = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(s.replace(/\[[^\]]*\]\([^)]*\)|\x60[^\x60]*\x60|\$[^$]*\$/g, ""));
  return !m ? "auto" : /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]) ? "rtl" : "ltr";
}

/** Opening HTML of a callout / panel (blockquote `> [!type]` and `::: info` panels share it). */
function calloutOpen(md: MD, callout: string, title: string, fold: string, line: string, dir: string) {
  const ic = `<span class="callout-icon">${glyphSvg(CALLOUT_GLYPH[callout] ?? "c-info", 17)}</span>`;
  const type = callout[0].toUpperCase() + callout.slice(1);
  if (fold) {
    // Folded: chevron · icon · Type (colored) · title · "folded" (design: 5A "Question … folded")
    const t = title && title.toLowerCase() !== callout ? `<span class="callout-t2" dir="auto">${md.renderInline(title)}</span>` : "";
    return `<details class="callout" data-callout="${esc(callout)}"${line} dir="${dir}"${fold === "+" ? " open" : ""}><summary class="callout-title"><span class="callout-chev">${icon("chevron-right", 14)}</span>${ic}<span class="callout-type">${esc(type)}</span>${t}<span class="callout-fold"></span></summary><div class="callout-body">`;
  }
  return `<div class="callout" data-callout="${esc(callout)}"${line} dir="${dir}"><div class="callout-title">${ic}<span dir="auto">${md.renderInline(title || type)}</span></div><div class="callout-body">`;
}

// ------------------------------------------------------------------ layout blocks (`:::` fenced divs)
/** Parsed `:::` info string: `columns`, `column 30%`, `{.column width="40%"}`, `expand Title`, `box x=5 y=8 w=30`. */
export type BlockSpec = { name: string; title: string; classes: string[]; attrs: Record<string, string> };
const PANELS = new Set(["info", "note", "tip", "hint", "important", "warning", "caution", "danger", "error", "success", "check", "example", "question", "abstract", "summary", "todo", "bug", "quote"]);
/** Quarto / Pandoc / Docusaurus / HackMD spellings → Lumen names. */
const ALIAS: Record<string, string> = {
  "panel-tabset": "tabs", tabset: "tabs", "column-page": "wide", "column-body-outset": "wide", "column-screen": "full", "column-screen-inset": "full",
  details: "expand", spoiler: "expand", toggle: "expand", collapse: "expand", "column-margin": "aside", sidebar: "aside", grid: "columns", cols: "columns", col: "column",
};
export function parseBlockInfo(info: string): BlockSpec | null {
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  let rest = info.replace(/\{([^}]*)\}/g, (_m, inner: string) => {
    for (const p of inner.matchAll(/([.#])([\w-]+)|([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
      if (p[1] === ".") classes.push(p[2]);
      else if (p[1] === "#") attrs.id = p[2];
      else attrs[p[3]] = p[4] ?? p[5] ?? p[6] ?? "";
    }
    return " ";
  }).trim();
  // key=value pairs outside braces (`box x=5 y=8 w=30 h=20`)
  rest = rest.replace(/(^|\s)([a-z][\w-]*)=("[^"]*"|\S+)/gi, (_m, sp: string, k: string, v: string) => { attrs[k] = v.replace(/^"|"$/g, ""); return sp; }).trim();
  let name = (/^[\w-]+/.exec(rest)?.[0] ?? "").toLowerCase();
  let title = name ? rest.slice(name.length).trim() : rest;
  if (!name) {
    const cls = classes.find((c) => /^(columns?|panel-tabset|tabs|column-(page|screen|screen-inset|body-outset|margin)|callout-\w+|wide|full|expand|box|center)$/.test(c));
    if (!cls) return classes.length ? { name: "div", title, classes, attrs } : null;
    name = cls;
  }
  if (name.startsWith("callout-")) { attrs.callout = name.slice(8); name = "panel"; }
  name = ALIAS[name] ?? name;
  if (PANELS.has(name)) { attrs.callout = name; name = "panel"; }
  if (name === "column" && /^\d+(\.\d+)?(%|px)$/.test(title)) { attrs.width = title; title = ""; }
  if (name === "columns" && /^\d$/.test(title)) { attrs.count = title; title = ""; }
  // `::: columns cards` / `divided` / `boxed` = the {.cards} style class, written as a word
  if (name === "columns" && /^(cards|divided|boxed)$/i.test(title)) { classes.push(title.toLowerCase()); title = ""; }
  return { name, title, classes, attrs };
}

const num = (v: string | undefined, d: number) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) ? n : d; };

function layoutBlocks(md: MD) {
  const isFenceLine = (s: string) => /^\s*:{3,}/.test(s);
  md.block.ruler.before("fence", "lblock", (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    const m = /^(:{3,})\s*(.*)$/.exec(line);
    if (!m || !m[2].trim()) return false;
    const spec = parseBlockInfo(m[2].trim());
    if (!spec) return false;
    if (silent) return true;
    // Closer: a bare colon fence at the same depth. Nested blocks may use the same number of colons
    // (`::: columns` / `::: column`) or more on the outer one (Pandoc style); code fences are skipped.
    let depth = 1, close = -1, code = "";
    for (let l = startLine + 1; l < endLine; l++) {
      if (state.sCount[l] < state.blkIndent) break;
      const s = state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]);
      const f = /^(`{3,}|~{3,})/.exec(s);
      if (code) { if (f && s.startsWith(code)) code = ""; continue; }
      if (f) { code = f[1]; continue; }
      if (!isFenceLine(s)) continue;
      if (/^:{3,}\s*$/.test(s)) { if (--depth === 0) { close = l; break; } } else if (parseBlockInfo(s.replace(/^\s*:{3,}\s*/, ""))) depth++;
    }
    const end = close < 0 ? endLine : close;
    const oldParent = state.parentType, oldMax = state.lineMax;
    state.parentType = "lblock" as typeof state.parentType;
    state.lineMax = end;
    const open = state.push("lblock_open", "div", 1);
    open.block = true; open.meta = spec; open.map = [startLine, end]; open.markup = m[1];
    state.md.block.tokenize(state, startLine + 1, end);
    const cls = state.push("lblock_close", "div", -1);
    cls.block = true; cls.meta = spec;
    state.parentType = oldParent; state.lineMax = oldMax;
    state.line = close < 0 ? endLine : close + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });

  md.renderer.rules.lblock_open = (tokens, idx) => {
    const t = tokens[idx];
    const s = t.meta as BlockSpec;
    const line = t.map ? ` data-line="${t.map[0]}"` : "";
    const extra = s.classes.filter((c) => !/^(columns?|panel-tabset|column-.*|callout-.*)$/.test(c)).map(esc).join(" ");
    const cls = (base: string) => `class="${base}${extra ? " " + extra : ""}"`;
    switch (s.name) {
      case "columns": return `<div ${cls("md-cols")}${line}${s.attrs.count ? ` style="--n:${num(s.attrs.count, 2)}"` : ""}>`;
      case "column": {
        const px = s.attrs.width && /^\d+(\.\d+)?px$/.test(s.attrs.width) ? s.attrs.width : "";
        const w = !px && s.attrs.width && /^\d+(\.\d+)?%?$/.test(s.attrs.width) ? (s.attrs.width.endsWith("%") ? s.attrs.width : s.attrs.width + "%") : "";
        return `<div ${cls("md-col")}${line}${px ? ` style="flex:0 0 ${px}"` : w ? ` style="flex:0 1 ${w}"` : ""}>`;
      }
      case "tabs": return `<div ${cls("md-tabs")}${line}>`;
      case "wide": case "full": return `<div ${cls("md-" + s.name)}${line}>`;
      case "aside": return `<aside ${cls("md-aside")}${line}>`;
      case "center": return `<div ${cls("md-center")}${line}>`;
      case "expand": return `<details ${cls("md-expand")}${line}${s.attrs.open != null || s.classes.includes("open") ? " open" : ""}><summary dir="auto">${md.renderInline(s.title || "Details")}</summary><div class="md-expand-body">`;
      case "panel": {
        const fold = s.attrs.collapse === "true" ? "-" : s.attrs.collapse === "false" ? "+" : "";
        return calloutOpen(md, s.attrs.callout ?? "note", s.title || s.attrs.title || "", fold, line, "auto");
      }
      case "box": {
        const v = (k: string, d: number) => Math.max(-100, Math.min(200, num(s.attrs[k], d)));
        const h = s.attrs.h && s.attrs.h !== "auto" ? `;--h:${v("h", 20)}` : "";
        return `<div ${cls("md-box")}${line}${s.attrs.id ? ` data-id="${esc(s.attrs.id)}"` : ""} style="--x:${v("x", 10)};--y:${v("y", 10)};--w:${v("w", 30)}${h}${s.attrs.z ? `;z-index:${num(s.attrs.z, 1)}` : ""}${s.attrs.rotate ? `;--r:${num(s.attrs.rotate, 0)}deg` : ""}">`;
      }
      default: return `<div ${cls("md-div md-" + esc(s.name))}${line}>`;
    }
  };
  md.renderer.rules.lblock_close = (tokens, idx) => {
    const s = tokens[idx].meta as BlockSpec;
    if (s.name === "expand") return "</div></details>";
    if (s.name === "panel") return s.attrs.collapse === "true" || s.attrs.collapse === "false" ? "</div></details>" : "</div></div>";
    if (s.name === "aside") return "</aside>";
    return "</div>";
  };

  // Tables: a frame with its own scroll box (sticky header, sort, filter, full screen are added on hydrate).
  // `{.wide .compact .nowrap}` on the line right after a table sets options and is hidden.
  md.core.ruler.after("block", "table-attrs", (state) => {
    const toks = state.tokens as Token[];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== "table_close") continue;
      const p = toks[i + 1], inl = toks[i + 2];
      let open = i; while (open >= 0 && toks[open].type !== "table_open") open--;
      // Written right under the table (no blank line), GFM reads `{.wide}` as a last row: take it back out.
      let tr = i; while (tr > open && toks[tr].type !== "tr_open") tr--;
      const cells = toks.slice(tr, i).filter((t) => t.type === "inline");
      if (tr > open && cells.length && /^\{(\s*\.[\w-]+)+\s*\}$/.test(cells[0].content.trim()) && cells.slice(1).every((c) => !c.content.trim())) {
        toks[open].meta = { classes: [...cells[0].content.matchAll(/\.([\w-]+)/g)].map((x) => x[1]) };
        let end = tr; while (toks[end].type !== "tr_close") end++;
        toks.splice(tr, end - tr + 1);
        i = tr;
        continue;
      }
      if (p?.type === "paragraph_open" && inl?.type === "inline" && /^\{(\s*\.[\w-]+)+\s*\}$/.test(inl.content.trim())) {
        toks[open].meta = { ...(toks[open].meta ?? {}), classes: [...inl.content.matchAll(/\.([\w-]+)/g)].map((x) => x[1]) };
        toks.splice(i + 1, 3);
      }
      // Pandoc caption under the table: `Table: Activations compared` (or `: …`) → the table's header line (R4-16J)
      const p2 = toks[i + 1], inl2 = toks[i + 2];
      const cap = p2?.type === "paragraph_open" && inl2?.type === "inline" ? /^(?:Table)?:\s+(\S.*)$/.exec(inl2.content.trim()) : null;
      if (cap && !cap[1].includes("\n")) {
        toks[open].meta = { ...(toks[open].meta ?? {}), caption: cap[1] };
        toks.splice(i + 1, 3);
      }
    }
  });
  md.renderer.rules.table_open = (tokens, idx, opts, _env, self) => {
    const t = tokens[idx];
    const line = t.attrGet("data-line") ?? (t.map ? String(t.map[0]) : null);
    t.attrs = (t.attrs ?? []).filter(([k]) => k !== "data-line");
    const meta = t.meta as { classes?: string[]; caption?: string } | null;
    const cls = (meta?.classes ?? []).map((c) => " tbl-" + esc(c)).join("");
    const cap = meta?.caption ? ` data-caption="${esc(meta.caption)}"` : "";
    return `<div class="tbl${cls}"${cap}${line != null ? ` data-line="${line}"` : ""}><div class="tbl-scroll">` + self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.table_close = (tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts) + "</div></div>";

  // A paragraph that is only `::left::` / `::2::` marks a slide region: show it as a small label outside slides.
  md.core.ruler.push("slot-marks", (state) => {
    const toks = state.tokens as Token[];
    for (let i = 0; i < toks.length - 2; i++) {
      if (toks[i].type !== "paragraph_open" || toks[i + 1].type !== "inline" || toks[i + 2].type !== "paragraph_close") continue;
      const c = toks[i + 1].content.trim();
      const m = /^::([\w-]+)::$/.exec(c);
      const toc = /^\[{1,2}toc\]{1,2}$/i.test(c);
      if (!m && !toc) continue;
      const tok = new state.Token("html_block", "", 0);
      tok.content = toc ? `<nav class="md-toc"${toks[i].map ? ` data-line="${toks[i].map![0]}"` : ""}></nav>` : `<div class="slot-mark">${esc(m![1])}</div>`;
      toks.splice(i, 3, tok);
    }
  });
}

const STATUS_C: [RegExp, string][] = [[/\b(done|complete[d]?|approved|accepted|green|ok|live|shipped|pass(ed)?)\b/i, "green"], [/\b(blocked|blocker|fail(ed)?|rejected|red|at risk|overdue|stopped)\b/i, "red"], [/\b(review|in review|waiting|on hold|yellow|amber|pending|proposed|revise)\b/i, "amber"], [/\b(in progress|progress|doing|active|blue|wip|building|learning)\b/i, "blue"], [/\b(purple|violet|idea|exploring|has cards)\b/i, "violet"]];
// :status[…]{colour}: green · amber · red · blue · violet · grey (R4); yellow / purple / gray / orange are aliases.
const STATUS_ALIAS: Record<string, string> = { yellow: "amber", purple: "violet", gray: "grey", orange: "amber" };
const statusColor = (t: string, c?: string) => { const k = c ? STATUS_ALIAS[c.toLowerCase()] ?? c.toLowerCase() : ""; return /^(green|amber|red|blue|violet|grey)$/.test(k) ? k : STATUS_C.find(([re]) => re.test(t))?.[1] ?? "grey"; };

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
  md.use(clozePlugin); // {{c1::cloze}}, ==cloze== in flashcard notes (env.cloze), review gaps (lib/cloze-md.ts)

  // Fenced specials: mermaid, canvas (JSON Canvas), query (Dataview-lite).
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0];
    const line = t.map ? ` data-line="${t.map[0]}"` : "";
    if (lang === "mermaid") return `<div class="mermaid-card"${line} tabindex="-1"><div class="mm-head"><span>mermaid · ${esc(MERMAID_KIND(t.content))}</span><span class="mm-tools"><button type="button" class="mm-zout" title="Zoom out (−)" aria-label="Zoom out">${icon("minus", 13)}</button><button type="button" class="mm-zlabel" title="Fit (0) · double-click the diagram to switch between fit and 100%">Fit</button><button type="button" class="mm-zin" title="Zoom in (+)" aria-label="Zoom in">${icon("plus", 13)}</button><button type="button" class="mm-z100" title="Actual size (100%)">1:1</button><span class="mm-sep"></span><button type="button" class="mm-export" title="Export: SVG, PNG, JPEG, WebP · copy image">${icon("download", 13)}</button><button type="button" class="mm-src" title="Show source">${icon("code", 14)}</button><button type="button" class="mm-full" title="Full screen">${icon("maximize-2", 13)}</button></span></div><div class="mermaid-block" data-src="${enc(t.content)}"><div class="muted">Rendering diagram…</div></div><pre class="mm-code" hidden><code>${esc(t.content)}</code></pre></div>`;
    if (lang === "canvas") return `<div class="canvas-embed"${line} data-canvas="${enc(t.content)}"></div>`;
    if (lang === "query") return `<div class="query-block"${line} data-q="${enc(t.content.trim())}"></div>`;
    if (lang === "occlusion") return occlusionHtml(t.content, line); // image-occlusion cards (lib/cloze-md.ts)
    return fence(tokens, idx, opts, env, self).replace("<pre", `<pre${line}`);
  };

  // [[Wiki links]] and ![[embeds]] (embeds render as links in v1).
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src;
    let pos = state.pos;
    const embed = src[pos] === "!" && src[pos + 1] === "[";
    if (embed) pos++;
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
      tok.meta = { title: title.trim(), heading: heading?.trim() ?? "", label: (alias ?? target).trim(), embed };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx) => {
    const m = tokens[idx].meta as { title: string; heading: string; label: string; embed?: boolean };
    // ![[Note]] / ![[Note#Heading]] → live include (filled on hydrate); files (![[x.png]]) stay links.
    if (m.embed && !/\.[a-z0-9]{2,5}$/i.test(m.title)) return `<span class="transclude" data-note="${esc(m.title)}" data-heading="${esc(m.heading)}"><a class="wikilink" href="#" data-note="${esc(m.title)}" data-heading="${esc(m.heading)}">${esc(m.label)}</a></span>`;
    // [[Paper#^hl-id|Paper · p. 4]] → PDF highlight back-link chip (opens the reader at that highlight; lib/pdf-format.ts).
    return `<a class="wikilink${m.heading.startsWith("^hl-") ? " pdf-ref" : ""}" href="#" data-note="${esc(m.title)}" data-heading="${esc(m.heading)}">${esc(m.label)}</a>`;
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

  // [12:34] / [1:02:03] / [12:34](#video-2) → timestamp chip that seeks the note's player (video notes, docs/VIDEO_NOTES.md).
  // "[12:34](url)" stays a normal link and "[12:34][ref]" a reference link; [^1] footnotes and [ ] task boxes never match.
  md.inline.ruler.before("link", "vtimestamp", (state: StateInline, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b) return false;
    const m = TS_AT.exec(state.src.slice(state.pos));
    if (!m) return false;
    const next = state.src[state.pos + m[0].length];
    if (!m[6] && (next === "(" || next === "[")) return false;
    if (!silent) state.push("vtimestamp", "", 0).meta = fromMatch(m);
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.vtimestamp = (tokens, idx) => { const m = tokens[idx].meta as { seconds: number; video: number; label: string }; return timestampChip(m.seconds, m.video, m.label); };

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

  layoutBlocks(md);

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
    return calloutOpen(md, m.callout, m.title ?? "", m.fold ?? "", tokens[idx].map ? ` data-line="${tokens[idx].map![0]}"` : "", m.dir ?? "auto");
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

  // Stored due-date syntax (U+1F4C5 calendar char + date, or @due(2026-11-18)) → date chip with the `due` glyph.
  // (done at render time: the calendar char isn't a markdown-it terminator char, so an inline rule would never see it)
  const dueChip = (date: string) => {
    const d = new Date(date + "T00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return `<span class="${d < today ? "due over" : "due"}">${glyphSvg("due", 13)}${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")}</span>`;
  };
  md.renderer.rules.text = (tokens, idx) => {
    let h = esc(tokens[idx].content);
    if (/\u{1F4C5}|@due\(/u.test(h)) h = h.replace(/(?:\u{1F4C5}\s*|@due\()(\d{4}-\d{2}-\d{2})\)?/gu, (_m, d: string) => dueChip(d));
    // :status[In review]{yellow} → coloured pill (Confluence status lozenge); colour guessed from the text when omitted.
    if (h.includes(":status[")) h = h.replace(/:status\[([^\]]{1,40})\](?:\{(\w+)\})?/g, (_m, t: string, c?: string) => `<span class="status-pill" data-c="${statusColor(t, c)}">${t}</span>`);
    // :glyph[s-learning] → a Lumen glyph inline (cards, headings); unknown names stay as text
    if (h.includes(":glyph[")) h = h.replace(/:glyph\[([\w-]{1,32})\]/g, (m, n: string) => (hasGlyph(n) ? `<span class="md-glyph" data-g="${n}">${glyphSvg(n, 15)}</span>` : m));
    return h;
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

  // Block ids (Obsidian): `text ^id` at the end of a block, or `^id` on its own line after one → an anchor
  // (data-block-id) that [[Note#^id]] links scroll to; the id itself is dimmed until hover (lib/blocks.ts).
  md.core.ruler.push("blockrefs", (state) => {
    const toks = state.tokens as Token[];
    const anchor = (id: string, after = false) => `<span class="blk-id${after ? " blk-after" : ""}" data-block-id="${esc(id)}">${after ? "" : "^" + esc(id)}</span>`;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== "inline" || !t.children?.length) continue;
      const m = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(t.content);
      if (!m) continue;
      const kids = t.children;
      const last = kids[kids.length - 1];
      if (last.type !== "text" || !/(?:^|\s)\^[A-Za-z0-9-]+\s*$/.test(last.content)) continue;
      if (t.content.trim() === "^" + m[1] && toks[i - 1]?.type === "paragraph_open" && toks[i + 1]?.type === "paragraph_close") {
        const h = new state.Token("html_block", "", 0);
        h.content = anchor(m[1], true);
        toks.splice(i - 1, 3, h);
        i--;
        continue;
      }
      last.content = last.content.replace(/\s*\^[A-Za-z0-9-]+\s*$/, "");
      t.content = t.content.slice(0, m.index).replace(/\s+$/, "");
      if (!last.content) { kids.pop(); if (kids[kids.length - 1]?.type === "softbreak") kids.pop(); }
      const h = new state.Token("html_inline", "", 0);
      h.content = anchor(m[1]);
      kids.push(h);
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
  return instance.render(src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, (m) => "\n".repeat((m.match(/\n/g) ?? []).length)), { cloze: clozeEnabled(src) });
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
  /** Markdown of `![[Note#Heading]]` (the whole note or one section), or null when the note doesn't exist. */
  include?: (title: string, heading: string) => string | null;
}

// ------------------------------------------------------------------ layout hydration: tables, tabs, TOC, includes
const SORT_NUM = /^[-+]?[$€£]?\s*[\d.,]+\s*(%|[kKmMbB]|h|min|s|d|ms|GB|MB|KB)?$/;
function cellVal(td: Element | undefined) {
  const t = (td?.textContent ?? "").trim();
  if (SORT_NUM.test(t)) { const n = parseFloat(t.replace(/[^\d.+-]/g, "")); if (Number.isFinite(n)) return n; }
  const d = /^\d{4}-\d{2}-\d{2}/.test(t) ? Date.parse(t.slice(0, 10)) : NaN;
  return Number.isFinite(d) ? d : t.toLowerCase();
}
/** Tables: sticky header + scroll shadows, click a header to sort (viewer only), filter long tables, full screen. */
function hydrateTables(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".tbl:not([data-ok])").forEach((wrap) => {
    wrap.dataset.ok = "1";
    const box = wrap.querySelector<HTMLElement>(".tbl-scroll");
    const table = box?.querySelector("table");
    const body = table?.tBodies[0];
    if (!box || !table) return;
    const rows = body ? [...body.rows] : [];
    if (rows.length > 14) wrap.classList.add("tbl-tall");
    // Size columns by content: short values (ids, numbers, dates) stay on one line, prose columns get room.
    const all = [...table.rows];
    const ncol = Math.max(0, ...all.map((r) => r.cells.length));
    for (let c = 0; c < ncol; c++) {
      let max = 0;
      for (const r of rows.slice(0, 200)) max = Math.max(max, (r.cells[c]?.textContent ?? "").trim().length);
      const cls = max <= 22 ? "c-short" : max >= 32 ? "c-long" : "";
      if (cls) for (const r of all) r.cells[c]?.classList.add(cls);
    }
    // Header line (R4-16J): "Caption · 5 rows" · Filter (a field once clicked) · full screen.
    const tools = document.createElement("div");
    tools.className = "tbl-tools";
    const caption = wrap.dataset.caption ?? "";
    const nrows = (n: number, of?: number) => `${of != null ? `${n} of ${of}` : n} row${(of ?? n) === 1 ? "" : "s"}`;
    tools.innerHTML = `<span class="tbl-count">${caption ? `${esc(caption)} · ` : ""}${nrows(rows.length)}</span>`
      + (rows.length >= 5 ? `<label class="tbl-filter">${glyphSvg("query", 12)}<span class="tbl-filter-l">Filter</span><input type="search" placeholder="Filter rows" aria-label="Filter rows"></label>` : "")
      + `<button type="button" class="tbl-full" title="Full screen" aria-label="Show table full screen">${glyphSvg("full", 12)}</button>`;
    wrap.prepend(tools);
    const input = tools.querySelector("input");
    const count = tools.querySelector<HTMLElement>(".tbl-count")!;
    const filter = tools.querySelector<HTMLElement>(".tbl-filter");
    filter?.addEventListener("click", () => { filter.classList.add("on"); input?.focus(); });
    input?.addEventListener("blur", () => { if (!input.value) filter?.classList.remove("on"); });
    input?.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); input.value = ""; input.dispatchEvent(new Event("input")); input.blur(); } });
    input?.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      for (const r of rows) { const hit = !q || (r.textContent ?? "").toLowerCase().includes(q); r.hidden = !hit; if (hit) shown++; }
      count.textContent = (caption ? `${caption} · ` : "") + (q ? nrows(shown, rows.length) : nrows(rows.length));
    });
    const full = tools.querySelector<HTMLButtonElement>(".tbl-full")!;
    full.addEventListener("click", () => { if (document.fullscreenElement === wrap) void document.exitFullscreen(); else void wrap.requestFullscreen?.(); });
    wrap.addEventListener("fullscreenchange", () => {
      const on = document.fullscreenElement === wrap;
      full.innerHTML = glyphSvg(on ? "x" : "full", 12);
      full.title = on ? "Exit full screen (Esc)" : "Full screen";
    });
    // Sort: asc → desc → original order. Only the view changes; the Markdown stays as written.
    const heads = [...(table.tHead?.rows[0]?.cells ?? [])];
    if (body && rows.length > 1) heads.forEach((th, col) => {
      th.classList.add("tbl-sortable");
      th.tabIndex = 0;
      const sort = () => {
        const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : th.getAttribute("aria-sort") === "descending" ? "none" : "ascending";
        heads.forEach((h) => h.removeAttribute("aria-sort"));
        const order = dir === "none" ? rows : [...rows].sort((a, b) => {
          const x = cellVal(a.cells[col]), y = cellVal(b.cells[col]);
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return dir === "ascending" ? c : -c;
        });
        if (dir !== "none") th.setAttribute("aria-sort", dir);
        body.append(...order);
      };
      th.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("a")) sort(); });
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); } });
    });
    // Scroll cues + sticky first column when the table is wider than its box; break out of the text column first.
    const edges = () => {
      const over = box.scrollWidth > box.clientWidth + 2;
      wrap.classList.toggle("tbl-over", over);
      wrap.classList.toggle("tbl-sl", over && Math.abs(box.scrollLeft) > 2);
      wrap.classList.toggle("tbl-sr", over && Math.abs(box.scrollLeft) + box.clientWidth < box.scrollWidth - 2);
    };
    requestAnimationFrame(() => {
      if (!wrap.isConnected) return;
      if (wrap.closest(".reading") && !wrap.closest(".md-col, .md-box, .lslide") && box.scrollWidth > box.clientWidth + 2) wrap.classList.add("tbl-auto-wide");
      edges();
    });
    box.addEventListener("scroll", edges, { passive: true });
    new ResizeObserver(edges).observe(box);
  });
}
/** `::: tabs`: each heading directly inside becomes a tab; the content under it is its panel. */
function hydrateTabs(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".md-tabs:not([data-ok])").forEach((tabs, ti) => {
    tabs.dataset.ok = "1";
    const kids = [...tabs.children] as HTMLElement[];
    const level = kids.map((k) => /^H([1-6])$/.exec(k.tagName)?.[1]).filter(Boolean).sort()[0];
    if (!level) return;
    const bar = document.createElement("div");
    bar.className = "md-tablist";
    bar.setAttribute("role", "tablist");
    const panels: HTMLElement[] = [];
    let cur: HTMLElement | null = null;
    const pre = document.createElement("div");
    for (const k of kids) {
      if (k.tagName === "H" + level) {
        const i = panels.length;
        const b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "tab"); b.id = `tab-${ti}-${i}`; b.dir = "auto";
        b.innerHTML = k.innerHTML;
        b.addEventListener("click", () => select(i));
        bar.append(b);
        cur = document.createElement("div");
        cur.className = "md-tabpanel"; cur.setAttribute("role", "tabpanel"); cur.setAttribute("aria-labelledby", b.id);
        if (k.dataset.line) cur.dataset.line = k.dataset.line;
        panels.push(cur);
        k.remove();
      } else (cur ?? pre).append(k);
    }
    const select = (i: number) => {
      panels.forEach((p, j) => { p.hidden = j !== i; });
      [...bar.children].forEach((b, j) => { b.setAttribute("aria-selected", String(j === i)); (b as HTMLElement).tabIndex = j === i ? 0 : -1; });
      panels[i]?.querySelectorAll<HTMLElement>(".tbl").forEach((t) => t.querySelector(".tbl-scroll")?.dispatchEvent(new Event("scroll")));
    };
    bar.addEventListener("keydown", (e) => {
      const i = [...bar.children].findIndex((b) => b.getAttribute("aria-selected") === "true");
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = (i + d + panels.length) % panels.length;
      select(n); (bar.children[n] as HTMLElement).focus();
    });
    tabs.replaceChildren(...(pre.childNodes.length ? [pre] : []), bar, ...panels);
    select(0);
  });
}
/** `[[toc]]` / `[TOC]`: the H2–H3 headings of the note (not of included notes), click to scroll. */
function hydrateToc(root: HTMLElement) {
  const tocs = root.querySelectorAll<HTMLElement>(".md-toc");
  if (!tocs.length) return;
  const hs = [...root.querySelectorAll<HTMLElement>("h2, h3")].filter((h) => !h.closest(".transclusion, .md-toc, .md-tabs"));
  for (const toc of tocs) {
    toc.innerHTML = `<div class="md-toc-t">Contents</div>` + (hs.length ? `<ol>${hs.map((h, i) => `<li class="toc-${h.tagName.toLowerCase()}"><a href="#" data-i="${i}" dir="auto">${esc(h.textContent ?? "")}</a></li>`).join("")}</ol>` : `<div class="muted">No headings yet.</div>`);
    toc.onclick = (e) => { const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-i]"); if (!a) return; e.preventDefault(); e.stopPropagation(); hs[Number(a.dataset.i)]?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  }
  // The section being read is bold (R4 "Contents" box): the last heading above the top fifth of the pane.
  if (!hs.length) return;
  const pane = root.closest<HTMLElement>(".read-pane, .focus-read, [data-scroll]") ?? null;
  const spy = () => {
    if (!root.isConnected) { (pane ?? window).removeEventListener("scroll", spy); return; }
    const top = (pane ? pane.getBoundingClientRect().top : 0) + Math.min(160, (pane?.clientHeight ?? innerHeight) / 5);
    let cur = 0;
    hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= top) cur = i; });
    for (const toc of tocs) toc.querySelectorAll<HTMLElement>("a[data-i]").forEach((a) => a.classList.toggle("on", Number(a.dataset.i) === cur));
  };
  const host = root as HTMLElement & { _tocSpy?: [EventTarget, () => void] };
  if (host._tocSpy) host._tocSpy[0].removeEventListener("scroll", host._tocSpy[1]);
  host._tocSpy = [pane ?? window, spy];
  (pane ?? window).addEventListener("scroll", spy, { passive: true });
  requestAnimationFrame(spy);
}
/** `![[Note]]` / `![[Note#Heading]]`: the note or section rendered in place (3 levels deep at most, no loops). */
function hydrateIncludes(root: HTMLElement, ctx: HydrateCtx) {
  if (!ctx.include) return;
  root.querySelectorAll<HTMLElement>("span.transclude").forEach((span) => {
    const title = span.dataset.note ?? "", heading = span.dataset.heading ?? "";
    const chain = [...ancestors(span)].map((x) => x.dataset.from).filter(Boolean);
    const key = `${title}#${heading}`.toLowerCase();
    if (chain.length >= 3 || chain.includes(key)) return;
    // ![[Note#^id]] → just that block (lib/blocks.ts), cut from the whole note.
    const blockId = heading.startsWith("^") ? heading.slice(1) : "";
    const whole = blockId ? ctx.include!(title, "") : null;
    const src = blockId ? (whole == null ? null : blockSource(whole, blockId) ?? `*No block ^${blockId} in ${title}.*`) : ctx.include!(title, heading);
    if (src == null) { span.querySelector("a")?.classList.add("missing"); return; }
    const box = document.createElement("div");
    box.className = "transclusion";
    box.dataset.from = key;
    // R4-16J: dashed frame, source chip "Note › Section" and "Go to source →" (opens the note at that section / block)
    const link = `href="#" data-note="${esc(title)}" data-heading="${esc(heading)}"`;
    box.innerHTML = `<div class="tc-head"><a class="wikilink tc-chip" ${link} title="Live copy of ${esc(title)}${heading ? ` › ${esc(heading)}` : ""}">${glyphSvg(blockId ? "block-embed" : "include", 12)}<span>${esc(title)}${heading ? ` › ${esc(heading)}` : ""}</span></a><span class="tc-fill"></span><a class="wikilink tc-go" ${link}>Go to source →</a></div><div class="tc-body">${render(src).replace(/ data-line="\d+"/g, "")}</div>`;
    const p = span.parentElement;
    if (p?.tagName === "P" && p.childNodes.length === 1) p.replaceWith(box); else span.replaceWith(box);
    hydrateIncludes(box.querySelector<HTMLElement>(".tc-body")!, ctx); // nested includes; the rest hydrates with the page
  });
}
function* ancestors(el: HTMLElement) { for (let p = el.parentElement?.closest<HTMLElement>(".transclusion"); p; p = p.parentElement?.closest<HTMLElement>(".transclusion")) yield p; }

/** Block anchors: [[Note#^id]] remembers the target so the next render scrolls to it; [[#^id]] scrolls in place. */
function blockTarget(el: HTMLElement) {
  return (el.classList.contains("blk-after") ? (el.previousElementSibling as HTMLElement | null) : el.closest<HTMLElement>("[data-line]") ?? el.parentElement) ?? el;
}
function findBlock(root: ParentNode, id: string) {
  if (id.startsWith("h:")) {
    const want = id.slice(2).replace(/[*_`[\]]/g, "").trim().toLowerCase();
    return [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].find((x) => !x.closest(".transclusion, .md-toc") && (x.textContent ?? "").replace(/\s*\^[\w-]+\s*$/, "").trim().toLowerCase() === want) ?? null;
  }
  return [...root.querySelectorAll<HTMLElement>("[data-block-id]")].find((x) => x.dataset.blockId === id && !x.closest(".transclusion")) ?? null;
}
function flashBlock(el: HTMLElement) {
  const t = blockTarget(el);
  requestAnimationFrame(() => { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("blk-flash"); void t.offsetWidth; t.classList.add("blk-flash"); setTimeout(() => t.classList.remove("blk-flash"), 1700); });
}
function hydrateBlockRefs(root: HTMLElement) {
  if (!root.dataset.blkNav) {
    root.dataset.blkNav = "1";
    root.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.wikilink");
      const h = a?.dataset.heading ?? "";
      if (!a) return;
      // [[Note#Heading]] / include "Go to source": remember the section so the note opens scrolled to it
      if (h && !h.startsWith("^")) { if (a.dataset.note) setPendingBlock(a.dataset.note, "h:" + h); return; }
      if (!h.startsWith("^")) return;
      const id = h.slice(1), title = a.dataset.note ?? "";
      if (!title) { e.preventDefault(); e.stopPropagation(); const el = findBlock(root, id); if (el) flashBlock(el); return; }
      setPendingBlock(title, id);
      // Same note (nothing re-renders): scroll here once the click has been handled.
      setTimeout(() => { if (pendingBlock.id !== id) return; const el = findBlock(root.isConnected ? root : document, id); if (el) { pendingBlock.id = ""; flashBlock(el); } }, 350);
    }, true);
  }
  if (pendingBlock.id && Date.now() - pendingBlock.at < 8000) {
    const el = findBlock(root, pendingBlock.id);
    if (el) { pendingBlock.id = ""; flashBlock(el); }
  }
}

/** Callouts with one short paragraph read as one line: glyph · **Title** — text (R4-16J "Watch out — …"). */
function hydrateCallouts(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("div.callout:not([data-ok])").forEach((c) => {
    c.dataset.ok = "1";
    const body = c.querySelector<HTMLElement>(":scope > .callout-body");
    const title = c.querySelector<HTMLElement>(":scope > .callout-title > span[dir]");
    const p = body?.children.length === 1 && body.firstElementChild?.tagName === "P" ? (body.firstElementChild as HTMLElement) : null;
    if (!p || !title || (p.textContent ?? "").length > 360) return;
    const b = document.createElement("b");
    b.className = "callout-lead";
    b.innerHTML = title.innerHTML;
    p.prepend(b, " — ");
    c.classList.add("callout-inline");
  });
}

export function hydrate(root: HTMLElement, ctx: HydrateCtx = {}) {
  hydrateIncludes(root, ctx);
  hydrateCallouts(root);
  // a paragraph of only :status[] pills lays out as a pill row (6 px gaps)
  root.querySelectorAll<HTMLElement>("p").forEach((p) => { if (p.children.length > 1 && [...p.childNodes].every((n) => (n.nodeType === 1 ? (n as Element).classList.contains("status-pill") : !(n.textContent ?? "").trim()))) p.classList.add("pill-row"); });
  hydrateBlockRefs(root);
  hydrateTabs(root);
  hydrateTables(root);
  hydrateToc(root);
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
    const html = mime.startsWith("video/") ? videoFileHtml(url, name) : mime.startsWith("audio/") ? audioFileHtml(url, name) : mime === "application/pdf" ? pdfHtml(url, name, id) : null;
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
