// One print stylesheet for every note export (Print, PDF, HTML). Pure strings: no DOM, no settings, safe in the Worker and in tests.
// See docs/research/print-pdf-html-export.md §3 and §4 B. Colours are concrete hex values (no color-mix / oklch), so Paged.js's
// CSS parser, Safari print and old Chromium all read the same sheet.

export type PrintTheme = "paper" | "screen" | "bw";
export type Paper = "a4" | "letter" | "a5";
export type Engine = "paged" | "native" | "html";

export interface Palette {
  bg: string; surface: string; surface2: string; border: string; text: string; muted: string; accent: string; link: string;
  success: string; warning: string; danger: string; info: string; learn: string; dark: boolean;
}
export const PAPER: Palette = { bg: "#ffffff", surface: "#f7f6f2", surface2: "#efede7", border: "#d6d2c8", text: "#1b1b1b", muted: "#5f5b53", accent: "#b45f0e", link: "#0b6e6a", success: "#1f8a4c", warning: "#a86a00", danger: "#c42b2b", info: "#2f5bd3", learn: "#7a4bd1", dark: false };
export const LAMPLIGHT: Palette = { bg: "#0f1115", surface: "#161a21", surface2: "#1d222b", border: "#2a303b", text: "#e8e6e1", muted: "#9aa0aa", accent: "#f2a93b", link: "#5cc8c2", success: "#6bcb8b", warning: "#e8b34a", danger: "#ef6b6b", info: "#7aa2f7", learn: "#b48ef0", dark: true };
/** High contrast black on white: every accent is a dark grey so a black-and-white printer keeps the distinctions in text, not colour. */
export const BW: Palette = { bg: "#ffffff", surface: "#f4f4f4", surface2: "#e9e9e9", border: "#555555", text: "#000000", muted: "#333333", accent: "#000000", link: "#000000", success: "#111111", warning: "#111111", danger: "#111111", info: "#111111", learn: "#111111", dark: false };

/** The app's theme variables (settings THEMES entry) → a palette; semantic colours follow the light / dark set of the app. */
export function paletteFromTheme(vars: Record<string, string>, dark: boolean): Palette {
  const base = dark ? LAMPLIGHT : PAPER;
  const hex = (k: string, d: string) => (/^#[0-9a-f]{6}$/i.test(vars[k] ?? "") ? vars[k] : d);
  return {
    bg: hex("bg", base.bg), surface: hex("surface", base.surface), surface2: hex("surface-2", base.surface2), border: hex("border", base.border), text: hex("text", base.text), muted: hex("muted", base.muted),
    accent: hex("accent", base.accent), link: hex("link", base.link), success: base.success, warning: base.warning, danger: base.danger, info: base.info, learn: base.learn, dark,
  };
}

const h2n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** `pct` percent of colour `a` over `b`, as hex. */
export function mix(a: string, b: string, pct: number): string {
  const [ar, ag, ab] = h2n(a), [br, bg, bb] = h2n(b), k = pct / 100;
  return "#" + [ar * k + br * (1 - k), ag * k + bg * (1 - k), ab * k + bb * (1 - k)].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

/** CSS custom properties for a palette (including the pre-mixed tints the callouts and pills use). */
export function paletteVars(p: Palette): string {
  const tints = (["success", "warning", "danger", "info", "learn", "accent", "muted"] as const).map((k) => `--t-${k}:${mix(p[k], p.bg, 9)};--b-${k}:${mix(p[k], p.bg, 32)};`).join("");
  return `--bg:${p.bg};--surface:${p.surface};--surface-2:${p.surface2};--border:${p.border};--text:${p.text};--muted:${p.muted};--accent:${p.accent};--link:${p.link};--success:${p.success};--warning:${p.warning};--danger:${p.danger};--info:${p.info};--learn:${p.learn};${tints}--code-bg:${p.dark ? mix(p.text, p.bg, 5) : "#f6f6f3"};--code-fg:${p.dark ? p.text : "#24292e"};`;
}

export const PAPER_MM: Record<Paper, [number, number]> = { a4: [210, 297], letter: [215.9, 279.4], a5: [148, 210] };
export const PAPER_NAME: Record<Paper, string> = { a4: "A4", letter: "Letter", a5: "A5" };

export interface CssOptions {
  engine: Engine;
  paper: Paper; landscape: boolean; marginMm: number; fontPt: number;
  /** Colour palette for print (paper / the chosen app theme / black and white). */
  palette: Palette; theme: PrintTheme;
  /** Body face: the reading font of the app. */
  bodyFont: "sans" | "serif" | "mono";
  /** Page furniture (paged engine margin boxes; the native engine uses the Worker's header / footer templates instead). */
  pageNumbers: boolean; headerFooter: boolean; tocNumbers: boolean;
  docTitle: string; dateLabel: string; pageWord: string; ofWord: string; contentsWord: string;
  breakH: "none" | "h1" | "h2"; newPagePerNote: boolean;
  /** html: the dark palette used when the viewer's system / toggle is dark. */
  darkPalette?: Palette;
  rtl?: boolean;
}

const cssStr = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ")}"`;
export const FONT_STACKS = {
  sans: `Inter, "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Arabic", sans-serif`,
  serif: `"Source Serif 4", "Noto Naskh Arabic", "IBM Plex Sans Arabic", Georgia, "Times New Roman", serif`,
  mono: `"JetBrains Mono", "IBM Plex Sans Arabic", ui-monospace, "SF Mono", Consolas, "Courier New", monospace`,
};

/** `@page` rules: size, margins in mm, a named landscape page for wide tables, and (paged engine) the running header / footer. */
function pageRules(o: CssOptions): string {
  const [w, h] = PAPER_MM[o.paper];
  const size = `${o.landscape ? h : w}mm ${o.landscape ? w : h}mm`;
  const wide = `${h}mm ${w}mm`; // the named wide page is always landscape
  const m = `${o.marginMm}mm`;
  const box = (pos: string, content: string, extra = "") => `@${pos}{content:${content};font:8.5pt ${FONT_STACKS.sans};color:#666;${extra}}`;
  let furniture = "";
  if (o.engine === "paged") {
    // Paged.js writes string(...) as an unterminated quoted string, so it only works as the sole value of a margin box:
    // the title and date run in the header, "page X of Y" in the footer.
    const foot = o.headerFooter ? `${cssStr(o.pageWord)} counter(page) ${cssStr(o.ofWord)} counter(pages)` : o.pageNumbers ? `counter(page)` : "";
    furniture = (o.headerFooter ? box("top-left", `string(doctitle)`, "text-align:left;") + box("top-right", cssStr(o.dateLabel), "text-align:right;") : "") + (foot ? box("bottom-center", foot) : "");
  } else if (o.engine === "native" && o.pageNumbers) {
    // Chromium 131+ draws margin boxes natively; older engines ignore them (the Worker adds its own footer template).
    furniture = "";
  }
  // Paged.js lays pages out at one size (named page sizes aren't supported by its print output): wide tables shrink and wrap there;
  // the native engines (plain print, Worker, HTML file) switch to the named landscape page.
  return `@page{size:${size};margin:${m};${furniture}}`
    + (o.engine === "paged" ? "" : `@page wide{size:${wide};margin:${m};${furniture}}`)
    + (o.engine === "paged" ? `@page titlepage{margin:${m};@top-left{content:none}@top-right{content:none}@bottom-center{content:none}}@page toc{${furniture}}` : "");
}

const BASE = (o: CssOptions) => `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:${FONT_STACKS[o.bodyFont]};font-size:${o.fontPt}pt;line-height:1.55;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-kerning:normal;text-rendering:optimizeLegibility}
h1,h2,h3,h4,h5,h6{font-family:${FONT_STACKS.sans};line-height:1.25;margin:1.5em 0 .45em;letter-spacing:-.005em;font-weight:650}
h1{font-size:1.9em;font-weight:700;margin-top:0}h2{font-size:1.45em}h3{font-size:1.2em}h4{font-size:1.05em}h5,h6{font-size:1em}
p,ul,ol,pre,blockquote,figure,.tbl{margin:.75em 0}
ul,ol{padding-inline-start:1.5em}li{margin:.2em 0}li::marker{color:var(--muted)}
a{color:var(--link);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:.5px}
strong{font-weight:650}hr{border:0;border-top:1px solid var(--border);margin:1.6em 0}
img,svg,video,canvas{max-width:100%}img{height:auto}
mark{background:#fde68a;color:inherit;padding:0 .12em;border-radius:2px}mark.hl-green{background:#bbf7d0}mark.hl-blue{background:#bfdbfe}mark.hl-pink{background:#fbcfe8}mark.hl-purple{background:#e9d5ff}
blockquote:not(.callout){border-inline-start:3px solid var(--border);padding-inline-start:1em;color:var(--muted);margin-inline:0}
sub,sup{line-height:0}
.ar{font-family:"IBM Plex Sans Arabic","Noto Naskh Arabic",${FONT_STACKS.sans};font-size:1.08em;unicode-bidi:isolate}
[dir=rtl] ul,[dir=rtl] ol{padding-inline-start:1.5em}
.note-head{margin-bottom:1em}.note-head h1.note-title{margin:0 0 .25em}
.note-meta{font:9pt ${FONT_STACKS.sans};color:var(--muted);display:flex;flex-wrap:wrap;gap:.2em .9em}
.note-meta .status{border:1px solid var(--border);border-radius:99px;padding:0 .6em}
.fm{font:9pt ${FONT_STACKS.sans};border-collapse:collapse;margin:.5em 0 1em;width:auto}.fm th,.fm td{border:1px solid var(--border);padding:2px 8px;text-align:start;font-weight:400}.fm th{color:var(--muted);background:var(--surface)}
a.tag,.tag{font:.82em ${FONT_STACKS.sans};color:var(--link);background:var(--t-accent);border:1px solid var(--b-accent);padding:0 .45em;border-radius:5px;text-decoration:none;white-space:nowrap}
.wikilink-text{color:var(--link);text-decoration:underline dotted;text-underline-offset:3px}
a.wikilink{text-decoration:underline dotted}
.md-glyph svg,.callout-icon svg{vertical-align:-.15em}
.due{display:inline-flex;align-items:center;gap:.3em;font:.85em ${FONT_STACKS.sans};color:var(--accent);white-space:nowrap}.due svg{flex:none}.due.over{color:var(--danger)}
.status-pill{--c:var(--muted);font:600 .8em ${FONT_STACKS.sans};color:var(--c);background:var(--tt,var(--surface-2));border:1px solid var(--c);border-radius:99px;padding:.05em .6em;white-space:nowrap}
.status-pill[data-c=green]{--c:var(--success);--tt:var(--t-success)}.status-pill[data-c=red]{--c:var(--danger);--tt:var(--t-danger)}.status-pill[data-c=amber],.status-pill[data-c=yellow]{--c:var(--warning);--tt:var(--t-warning)}
.status-pill[data-c=blue]{--c:var(--info);--tt:var(--t-info)}.status-pill[data-c=violet],.status-pill[data-c=purple]{--c:var(--learn);--tt:var(--t-learn)}.status-pill[data-c=grey]{--c:var(--muted);--tt:var(--t-muted)}
p.pill-row{display:flex;flex-wrap:wrap;gap:6px}
.callout{--c:var(--info);--ct:var(--t-info);--cb:var(--b-info);font:10.5pt/1.5 ${FONT_STACKS.sans};border:1px solid var(--cb);border-inline-start:3px solid var(--c);background:var(--ct);border-radius:8px;padding:9px 14px;margin:1em 0}
.callout[data-callout=tip],.callout[data-callout=hint],.callout[data-callout=success],.callout[data-callout=check],.callout[data-callout=done]{--c:var(--success);--ct:var(--t-success);--cb:var(--b-success)}
.callout[data-callout=warning],.callout[data-callout=caution],.callout[data-callout=important]{--c:var(--warning);--ct:var(--t-warning);--cb:var(--b-warning)}
.callout[data-callout=danger],.callout[data-callout=error],.callout[data-callout=bug],.callout[data-callout=failure]{--c:var(--danger);--ct:var(--t-danger);--cb:var(--b-danger)}
.callout[data-callout=question],.callout[data-callout=faq],.callout[data-callout=example]{--c:var(--learn);--ct:var(--t-learn);--cb:var(--b-learn)}
.callout[data-callout=summary],.callout[data-callout=abstract],.callout[data-callout=quote],.callout[data-callout=tldr],.callout[data-callout=cite]{--c:var(--accent);--ct:var(--t-accent);--cb:var(--b-accent)}
.callout-title{display:flex;gap:8px;align-items:center;font-weight:600;color:var(--c)}.callout-icon{display:inline-flex;flex-shrink:0}
.callout-type{font-weight:600}.callout-t2{font-weight:500;color:var(--text)}
.callout-body>:first-child{margin-top:.35em}.callout-body>:last-child{margin-bottom:0}.callout-body p{margin:.35em 0}
.callout summary{list-style:none}.callout summary::-webkit-details-marker{display:none}.callout-chev,.callout-fold{display:none}
.md-expand>summary{font-weight:600;font-family:${FONT_STACKS.sans};list-style:none}.md-expand{border:1px solid var(--border);border-radius:8px;padding:6px 12px}
.md-cols{display:flex;gap:1.2em;align-items:flex-start}.md-col{flex:1 1 0;min-width:0}
.md-aside,.md-aside-box{font-size:.92em;color:var(--muted)}.md-aside-box{border-inline-start:2px solid var(--border);padding-inline-start:1em}
.md-center{text-align:center}
.md-tabs>*{break-inside:auto}
.md-toc{border:1px solid var(--border);border-radius:8px;padding:8px 14px;font:10pt ${FONT_STACKS.sans}}.md-toc-t{font-weight:600;margin-bottom:.3em}.md-toc ol{margin:.2em 0;padding-inline-start:1.4em;list-style:none}.md-toc .toc-h3{padding-inline-start:1em}
.slot-mark{display:none}
.crumbs{font:12.5px ${FONT_STACKS.sans};margin-bottom:1em}.index-list{font:15px/1.9 ${FONT_STACKS.sans}}
.task-list-item{list-style:none;display:flex;align-items:flex-start;gap:.6em;margin:.15em 0}.contains-task-list,ul:has(>.task-list-item){padding-inline-start:.2em;list-style:none}
.task-list-item label{display:contents}
.chk{flex:0 0 auto;width:1em;height:1em;margin-top:.28em;border:1.5px solid var(--muted);border-radius:3px;display:inline-block;position:relative;background:#fff}
.chk.on{background:var(--success);border-color:var(--success)}.chk.on::after{content:"";position:absolute;inset-inline-start:.28em;top:.06em;width:.26em;height:.52em;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.task-doing{flex:0 0 auto;width:1em;height:1em;margin-top:.28em;border:1.5px solid var(--accent);border-radius:3px;background:linear-gradient(135deg,var(--accent) 50%,#fff 50%);display:inline-block}
.task-list-item.done-item{color:var(--muted);text-decoration:line-through}
pre{font:8.6pt/1.5 ${FONT_STACKS.mono};background:var(--code-bg);color:var(--code-fg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;tab-size:2}
pre code{font:inherit;background:none;padding:0;white-space:inherit;overflow-wrap:inherit}
code{font-family:${FONT_STACKS.mono};font-size:.88em}:not(pre)>code{background:var(--code-bg);border-radius:4px;padding:.05em .3em}
.code-head,main button,.copy,.mm-head,.mm-tools,.mm-code,.tbl-tools,.lc-more,.lc-skel,.lc-fail,.vt-play{display:none!important}
.hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-literal{color:#7a2fb5}.hljs-title,.hljs-section,.hljs-title.function_{color:#1f58b8}.hljs-string,.hljs-attr,.hljs-template-string{color:#8a5a00}.hljs-number,.hljs-symbol{color:#b0470a}.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}.hljs-type,.hljs-variable,.hljs-params,.hljs-property{color:inherit}.hljs-meta{color:#555}.hljs-deletion{color:#b31d28}.hljs-addition{color:#22863a}
.tbl{overflow:visible}.tbl-scroll{overflow:visible}
table{border-collapse:collapse;width:100%;font:.92em/1.4 ${FONT_STACKS.sans};table-layout:auto}
th,td{border:1px solid var(--border);padding:4px 8px;text-align:start;vertical-align:top;overflow-wrap:anywhere;word-break:normal}
th{background:var(--surface2);font-weight:600}tbody tr:nth-child(even) td{background:var(--surface)}
.tbl[data-caption]::before{content:attr(data-caption);display:block;font:600 9.5pt ${FONT_STACKS.sans};color:var(--muted);margin-bottom:.3em}
.tbl.cols-8 table,.tbl.cols-9 table{font-size:.8em}.tbl.cols-10 table,.tbl.cols-wide table{font-size:.72em}
.tbl.cols-wide td,.tbl.cols-wide th{padding:3px 5px}
figure{margin:1em 0}figcaption{font:9pt ${FONT_STACKS.sans};color:var(--muted);margin-top:.3em}
figure.diagram{text-align:center;overflow:visible}figure.diagram svg{max-width:100%;height:auto!important;max-height:235mm}
figure.diagram-fallback{border:1px dashed var(--border);border-radius:6px;padding:6px 10px}
figure.diagram-fallback figcaption{margin:0 0 .3em;font-weight:600}
.img-missing{display:inline-block;border:1px dashed var(--border);border-radius:6px;padding:4px 10px;color:var(--muted);font:9.5pt ${FONT_STACKS.sans}}
img{max-height:240mm;object-fit:contain}
.transclusion{border:1px dashed var(--border);border-radius:8px;padding:6px 14px;margin:1em 0}.tc-head{font:600 8.5pt ${FONT_STACKS.sans};color:var(--muted);margin-bottom:.3em}
.media-fallback{border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:8px;display:flex;gap:12px;align-items:center;font-family:${FONT_STACKS.sans}}
.media-fallback .poster{flex:0 0 38%;max-width:38%;border-radius:5px;display:block}.media-fallback .poster-none{flex:0 0 18mm;height:12mm;border-radius:5px;background:var(--surface2);border:1px solid var(--border)}
.media-fallback .m-body{min-width:0;flex:1}.media-fallback .m-kind{font:600 8pt ${FONT_STACKS.sans};text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.media-fallback .m-title{font-weight:600;font-size:10.5pt}.media-fallback .m-url{font:8.5pt ${FONT_STACKS.mono};color:var(--muted);overflow-wrap:anywhere}
.media-fallback .qr{flex:0 0 22mm;width:22mm;height:22mm}
.fc-row{display:flex;border:1px solid var(--b-learn);border-radius:8px;overflow:hidden;font:10.5pt/1.5 ${FONT_STACKS.sans};margin:.7em 0}.fc-row>*{padding:6px 12px}
.fc-row .fc-q{flex:1 1 50%;background:var(--t-learn)}.fc-row .fc-a{flex:1 1 50%;border-inline-start:1px solid var(--b-learn)}.fc-tag{display:none}.fc-row .fc-sep{display:none}
.cloze,mark.cloze{background:none;border-bottom:1.5px solid var(--learn);color:inherit;padding:0}.cloze-ans{border-bottom:1.5px solid var(--learn)}
.cloze-hidden{display:inline-block;min-width:3.2em;border-bottom:1.5px solid var(--text);text-align:center;color:transparent;user-select:none}
.cloze-key{font:.72em ${FONT_STACKS.sans};color:var(--learn);vertical-align:super;margin-inline-start:1px}
.fc-hidden{display:inline-block;min-width:5em;border-bottom:1.5px solid var(--text);color:transparent;user-select:none}
.answer-key{break-before:page}.answer-key ol{font:10.5pt/1.5 ${FONT_STACKS.sans}}.answer-key h3{margin-top:1em}
.link-notes{font:9pt/1.45 ${FONT_STACKS.sans};color:var(--text)}.link-notes ol{padding-inline-start:2em}.link-notes li{margin:.15em 0;break-inside:avoid;overflow-wrap:anywhere}
.link-notes a{color:inherit;text-decoration:none;font-family:${FONT_STACKS.mono};font-size:.95em}
sup.lfn a{text-decoration:none;font:.75em ${FONT_STACKS.sans}}.lurl{font:.82em ${FONT_STACKS.mono};color:var(--muted);overflow-wrap:anywhere}
.footnotes{font:9pt/1.5 ${FONT_STACKS.sans};color:var(--muted)}.footnotes-sep{border:0;border-top:1px solid var(--border);margin:2em 0 .6em}.footnotes ol{padding-inline-start:1.4em}
.footnote-ref a,.footnote-backref{text-decoration:none;font-size:.8em}.footnote-backref{display:none}
.occl-card{margin:1em 0}.occl-stage{position:relative;display:inline-block;max-width:100%}.occl-box{position:absolute;border:2px solid var(--accent);background:rgba(180,95,14,.25)}.occl-chip,.occl-meta{font:9pt ${FONT_STACKS.sans};color:var(--muted)}
.query-block table{font-size:.88em}.render-error{color:var(--danger);font:9.5pt ${FONT_STACKS.sans}}
.blk-id{display:none}.pdf-ref{color:var(--link)}.katex{font-size:1.08em}.katex-display{overflow:visible;margin:.8em 0;break-inside:avoid}.katex-display>.katex{white-space:normal}
.titlepage{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;min-height:230mm;page:titlepage}.titlepage h1{font-size:2.6em;margin:0 0 .3em;line-height:1.15}.titlepage .tp-sub{font:12pt ${FONT_STACKS.sans};color:var(--muted)}.titlepage .tp-rule{width:30mm;border-top:3px solid var(--accent);margin:0 0 1em}
.toc{page:toc;break-after:page}.toc h2{margin-top:0}.toc ol{list-style:none;padding:0;margin:0;font-family:${FONT_STACKS.sans}}
.toc li{margin:0}.toc a.toc-link{display:flex;align-items:baseline;gap:.4em;color:var(--text);text-decoration:none;padding:.12em 0}
.toc .toc-l1>a{font-weight:600;margin-top:.5em}.toc .toc-l2>a{padding-inline-start:1.2em}.toc .toc-l3>a{padding-inline-start:2.4em;color:var(--muted);font-size:.93em}
.toc .toc-text{flex:0 1 auto;min-width:0}.toc .toc-dots{flex:1 1 1em;border-bottom:1px dotted var(--muted);transform:translateY(-.2em);min-width:1em}
`;

const BREAKS = (o: CssOptions) => `
h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid;break-inside:avoid}
p,li,blockquote,dd{orphans:3;widows:3}
figure,img,.callout:not(.tall),.fc-row,.occl-card,.media-fallback,.transclusion.short,pre.short,.tbl.short,.link-notes li,.katex-display,.status-pill,.md-toc,table.fm{break-inside:avoid;page-break-inside:avoid}
tr,thead,td,th{break-inside:avoid;page-break-inside:avoid}
thead{display:table-header-group}tfoot{display:table-footer-group}
.tall,pre:not(.short),.tbl:not(.short){break-inside:auto}
${o.landscape || o.engine === "paged" ? "" : ".tbl.cols-wide{page:wide;break-before:page;break-after:page}"}
${o.breakH === "h1" ? "h1:not(.note-title){break-before:page}" : o.breakH === "h2" ? "h1:not(.note-title),h2{break-before:page}" : ""}
${o.newPagePerNote ? "section.note+section.note{break-before:page}" : ""}
section.note:first-of-type h1.note-title{break-before:auto}
.titlepage{break-after:page}
`;

/** The sheet for screen-only extras of the HTML export: a sidebar TOC, a readable measure and the light / dark toggle. */
const HTML_SCREEN = `
@media screen{
  body{display:block}
  .doc-wrap{display:flex;align-items:flex-start;max-width:1180px;margin:0 auto}
  .doc-side{position:sticky;top:0;align-self:flex-start;flex:0 0 260px;max-height:100vh;overflow:auto;padding:28px 16px 28px 22px;font:13px/1.4 ${FONT_STACKS.sans};border-inline-end:1px solid var(--border)}
  .doc-side .side-t{font-weight:700;margin:0 0 10px;color:var(--text)}
  .doc-side ol{list-style:none;margin:0;padding:0}.doc-side li{margin:0}
  .doc-side a{display:block;padding:3px 0;color:var(--muted);text-decoration:none;overflow-wrap:anywhere}.doc-side a:hover{color:var(--text)}
  .doc-side .toc-l1>a{color:var(--text);font-weight:600;margin-top:6px}.doc-side .toc-l2>a{padding-inline-start:12px}.doc-side .toc-l3>a{padding-inline-start:24px;font-size:12px}
  .doc-side .toc-dots,.doc-side .toc-num{display:none}
  .doc-main{flex:1;min-width:0;max-width:78ch;padding:36px 28px 80px;margin:0 auto}
  .doc-main>.toc{display:none}.titlepage{min-height:0;padding:20px 0 30px;border-bottom:1px solid var(--border);margin-bottom:2em}
  section.note{padding-top:1em}section.note+section.note{border-top:1px solid var(--border);margin-top:3em;padding-top:2em}
  .theme-toggle{position:fixed;top:12px;inset-inline-end:14px;z-index:5;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;font:12px ${FONT_STACKS.sans};padding:5px 12px;cursor:pointer}
  .tbl{overflow-x:auto}.tbl-scroll{overflow-x:auto}pre{white-space:pre;overflow-x:auto}
  .tbl.cols-wide{page:auto;break-before:auto}
}
@media screen and (max-width:900px){.doc-side{display:none}.doc-main{padding:56px 16px 60px}}
@media print{.doc-side,.theme-toggle{display:none!important}.doc-wrap{display:block}}
`;

/** The complete sheet. `html` adds the sidebar / toggle and the dark palette; print always uses the print palette. */
export function printCss(o: CssOptions): string {
  const root = `:root{${paletteVars(o.palette)}}`;
  const dark = o.engine === "html" && o.darkPalette
    ? `@media screen and (prefers-color-scheme:dark){:root:not([data-theme=light]){${paletteVars(o.darkPalette)}}}:root[data-theme=dark]{${paletteVars(o.darkPalette)}}`
      + `@media print{:root,:root[data-theme]{${paletteVars(o.palette)}}}` // printing a dark-mode view still prints the print palette
    : "";
  const tocNum = o.engine === "paged" && o.tocNumbers ? `.toc a.toc-link::after{content:target-counter(attr(href),page);font-variant-numeric:tabular-nums;flex:0 0 auto}` : "";
  const strings = o.engine === "paged" ? `.doc-main{string-set:doctitle ${cssStr(o.docTitle)}}h1.note-title{string-set:doctitle content(text)}` : "";
  return `${root}${dark}${pageRules(o)}${BASE(o)}${BREAKS(o)}${tocNum}${strings}${o.engine === "html" ? HTML_SCREEN : ""}${o.theme === "screen" ? "html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{background:var(--bg)}" : ""}`
    + `@media print{html,body{background:var(--bg)}.no-print{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
}
