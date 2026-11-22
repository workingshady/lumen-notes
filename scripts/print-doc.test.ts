// npx tsx scripts/print-doc.test.ts
// The note export's document builder (src/lib/print-doc.ts, print-css.ts, print-env.ts, print-run.ts) against the "kitchen sink" fixture.
// Runs in Node: Vite loads the TypeScript sources (so import.meta.env / ?inline / ?raw work) and linkedom stands in for the DOM.
// Services that need a browser (Mermaid, attachments, fonts) are stubs; the Markdown renderer and the KaTeX css embedding are real.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { createServer } from "vite";
import { kitchenSink, PIXEL_RED } from "./fixtures/kitchen-sink";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
function eq<T>(a: T, b: T, msg: string) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, `${msg}\n   got:      ${A}\n   expected: ${B}`); }

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
Object.defineProperty(document, "compatMode", { value: "CSS1Compat" });
Object.assign(globalThis, { window, document, DOMParser: window.DOMParser, Node: window.Node, HTMLElement: window.HTMLElement, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: "http://x/" } });
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true } });
const root = join(import.meta.dirname, "..");
type Mod = Record<string, any>;
const md: Mod = await vite.ssrLoadModule("/src/lib/markdown.ts");
const pd: Mod = await vite.ssrLoadModule("/src/lib/print-doc.ts");
const penv: Mod = await vite.ssrLoadModule("/src/lib/print-env.ts");
const canvas: Mod = await vite.ssrLoadModule("/src/lib/canvas.ts");
const run: Mod = await vite.ssrLoadModule("/src/lib/print-run.ts");
const themes: Mod = await vite.ssrLoadModule("/src/lib/settings.ts");

// ---- real KaTeX css with the real woff2 files (the same pure function the app uses)
const katexCss = readFileSync(join(root, "node_modules/katex/dist/katex.min.css"), "utf8");
const fontDir = join(root, "node_modules/katex/dist/fonts");
const fontMap: Record<string, () => Promise<string>> = Object.fromEntries(readdirSync(fontDir).filter((f) => f.endsWith(".woff2")).map((f) => [f, async () => "data:font/woff2;base64," + readFileSync(join(fontDir, f)).toString("base64")]));

const FONT_STUB = '@font-face{font-family:Inter;src:url(data:font/woff2;base64,AAAA) format("woff2")}';
const baseEnv = (over: Mod = {}) => ({
  doc: document, render: (s: string) => md.render(s),
  mermaid: async () => `<svg id="mmd-1" viewBox="0 0 2400 200" width="100%" style="max-width: 2400px;"><text>wide diagram</text></svg>`,
  canvasSvg: async (json: string) => { const { canvas: c, error } = canvas.parseCanvas(json); return error ? null : canvas.previewSvg(c, 760, 460); },
  attachment: async (id: string) => (id === "img-red" ? { mime: "image/png", data: PIXEL_RED, name: "red.png" } : null),
  image: async () => null,
  media: async (_p: string, id: string) => ({ title: "Video " + id, poster: PIXEL_RED }),
  qr: async () => "data:image/svg+xml;base64,PHN2Zy8+",
  fonts: async () => FONT_STUB,
  katexCss: (html: string) => penv.embedKatexFonts(katexCss, html, fontMap),
  screen: () => ({ vars: themes.THEMES.find((x: any) => x.id === "lamplight").vars, dark: true }),
  bodyFont: () => "sans",
  now: () => new Date(Date.UTC(2026, 10, 22)),
  ...over,
});
const build = (notes: any[], opts: Mod = {}, env: Mod = baseEnv(), title = notes.length === 1 ? notes[0].title : "Export") =>
  pd.buildPrintDoc({ title, notes }, { engine: "paged", ...opts }, env);

const [ks, inc] = kitchenSink();
const dom = (html: string) => parseHTML(html).document;
const text = (e: Element | null | undefined) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, "");

// ================================================================== 1. the kitchen sink, defaults (paper, footnoted links, answers shown)
const d1 = await build([ks, inc], { toc: true, titlePage: true });
const doc1 = dom(d1.html);
const main1 = doc1.querySelector("main")!;

// no external requests: no stylesheets / scripts / media from the network, no url(http), every http(s) text is a link of the user's own
ok(!/<link\b/i.test(d1.html), "no <link> tags");
ok(!/<script[^>]*\ssrc=/i.test(d1.html), "no external scripts");
ok(!/(src|poster|data)="https?:/i.test(d1.html), "no http(s) src attributes");
ok(!/url\(\s*["']?https?:/i.test(d1.html), "no url(http...) in CSS");
ok(!/@import/i.test(d1.html), "no @import");
const own = [...ks.body.matchAll(/https?:\/\/[^\s)>"]+/g), ...inc.body.matchAll(/https?:\/\/[^\s)>"]+/g)].map((m) => m[0]);
const seen = [...d1.html.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)].map((m) => m[0]).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u));
const stray = seen.filter((u) => !own.some((o) => u.startsWith(o) || o.startsWith(u)));
eq(stray, [], "every http(s) URL in the document is one the user wrote");
// KaTeX: math is HTML, css + fonts are embedded as data URIs
ok(main1.querySelector(".katex .katex-html"), "math is pre-rendered KaTeX");
ok(d1.katexCss.length > 20000 && /font-family:\s*KaTeX_Main/.test(d1.katexCss) && !/url\((?!data:)/.test(d1.katexCss), "KaTeX css has its fonts as data: URIs only");
ok(!/\.ttf|\.woff[^2]/.test(d1.katexCss), "KaTeX css keeps woff2 only");
// images: every <img> is a data URI (the missing / remote ones turned into the labelled fallback)
const imgs = [...main1.querySelectorAll("img")];
ok(imgs.length >= 3, "has images (attachment, inline data, media posters)");
ok(imgs.every((i) => /^data:image\//.test(i.getAttribute("src") ?? "")), "every image is a data: URI");
eq(main1.querySelectorAll(".img-missing").length, 2, "missing attachment and unreachable remote image use the fallback");
ok([...main1.querySelectorAll(".img-missing")].every((n) => /image not available offline/.test(text(n))), "fallback says: image not available offline");
ok(/Missing attachment/.test(text(main1.querySelector(".img-missing"))), "fallback keeps the alt text");
// tables
const tables = [...main1.querySelectorAll("table")].filter((t) => !t.classList.contains("fm"));
ok(tables.length >= 3, "tables present");
ok(tables.every((t) => t.querySelector("thead th")), "every table has a thead with header cells");
ok(/thead\{display:table-header-group\}/.test(d1.css), "thead repeats on each page (css)");
const longTable = tables.find((t) => t.querySelectorAll("tbody tr").length === 100);
ok(longTable, "the 100-row table is complete");
ok(!longTable!.closest(".tbl")!.classList.contains("short"), "a long table may split across pages");
const wide = tables.find((t) => (t.querySelector("tr")?.children.length ?? 0) === 15);
ok(wide?.closest(".tbl")?.classList.contains("cols-wide"), "15-column table is marked wide (landscape page)");
ok(/\.tbl\.cols-wide\{page:wide;break-before:page;break-after:page\}/.test(d1.css) && /@page wide\{size:297mm 210mm/.test(d1.css), "wide tables go on a named landscape page");
// a table without a header row gets one
const headless = await build([{ id: "h", title: "Headless", body: "<table><tr><td>a</td></tr></table>", type: "note" }]);
ok(headless.html.length > 0, "builds when markup has no table");
// code
const codes = [...main1.querySelectorAll("pre")];
ok(codes.some((p) => /x{300}/.test(p.textContent ?? "")), "the 300-character line is kept whole in the markup");
ok(/pre\{[^}]*white-space:pre-wrap;overflow-wrap:anywhere/.test(d1.css), "long code wraps (pre-wrap, overflow-wrap:anywhere)");
ok(codes.filter((p) => p.classList.contains("short")).length >= 2 && codes.some((p) => !p.classList.contains("short")), "short code stays together, the 60-line block may split");
// print css rules
for (const [rule, re] of [
  ["@page size", /@page\{size:210mm 297mm;margin:18mm/], ["named wide page", /@page wide\{/], ["break-after avoid on headings", /h1,h2,h3,h4,h5,h6\{break-after:avoid/], ["break-inside avoid", /break-inside:avoid/],
  ["orphans", /orphans:3/], ["widows", /widows:3/], ["thead group", /thead\{display:table-header-group\}/], ["print-color-adjust", /print-color-adjust:exact/], ["-webkit-print-color-adjust", /-webkit-print-color-adjust:exact/],
  ["diagram max-width", /figure\.diagram svg\{max-width:100%/], ["images max-width", /img,svg,video,canvas\{max-width:100%\}/], ["app UI hidden", /\.code-head,button/], ["margin boxes (paged)", /@bottom-center\{content:counter\(page\)/],
  ["TOC page numbers", /target-counter\(attr\(href\),page\)/],
] as [string, RegExp][]) ok(re.test(d1.css), `print css has: ${rule}`);
// diagrams: SVG inline, fitted to the page
const figs = [...main1.querySelectorAll("figure.diagram")];
ok(figs.length >= 3, "mermaid (2) and canvas diagrams are inline SVG");
ok(figs.every((f) => f.querySelector("svg")), "diagram figures hold an <svg>");
ok(/max-width:100%;height:auto/.test(figs[0].querySelector("svg")!.getAttribute("style") ?? ""), "wide diagram scales to the page width");
// links: footnoted by default, `#` / javascript skipped
ok(d1.linkCount >= 3, "external links are collected");
const notesList = main1.querySelector(".link-notes");
ok(notesList && /https:\/\/example\.com\/page/.test(notesList.textContent ?? ""), "footnote list holds the link URL");
ok(main1.querySelectorAll("sup.lfn").length >= 3, "numbered footnote marks are in the text");
ok(![...main1.querySelectorAll(".link-notes a")].some((a) => (a.getAttribute("href") ?? "").startsWith("#")), "# links are not footnoted");
ok(!/javascript:/i.test(d1.html), "no javascript: links");
// media replaced by its fallback
ok(!/<(iframe|video|audio|embed|object)\b/i.test(d1.html), "no iframe / video / audio elements remain");
const mf = [...main1.querySelectorAll(".media-fallback")];
ok(mf.length >= 4, "video, mp4, mp3 and the link card became fallbacks");
ok(mf.some((m) => /YouTube/.test(text(m)) && /youtube\.com\/watch\?v=dQw4w9WgXcQ/.test(text(m)) && m.querySelector("img.poster")), "YouTube: poster + title + URL");
ok(mf.some((m) => /lecture\.mp4/.test(text(m))) && mf.some((m) => /episode\.mp3/.test(text(m))), "file media keeps its URL");
// RTL
const arH = [...main1.querySelectorAll("h1, h2")].find((h) => /عنوان/.test(h.textContent ?? ""));
ok(arH && /^(auto|rtl)$/.test(arH.getAttribute("dir") ?? ""), "Arabic heading has dir");
ok([...main1.querySelectorAll("p, li, h2, h3, td, th")].every((b) => b.hasAttribute("dir")), "every block has a dir attribute: " + [...main1.querySelectorAll("p, li, h2, h3, td, th")].filter((b) => !b.hasAttribute("dir")).map((b) => b.outerHTML.slice(0, 80)).join(" | "));
ok(main1.querySelector("table[dir=rtl]"), "Arabic header row makes the table right-to-left");
// transclusion, block refs, wikilinks
const tcs = [...main1.querySelectorAll(".transclusion")];
eq(tcs.length, 3, "three transclusions (note, section, block ref)");
ok(tcs.some((t) => /Text of part A/.test(text(t))) && tcs.some((t) => /Text of part B/.test(text(t)) && !/Text of part A/.test(text(t))) && tcs.some((t) => /Block with an id/.test(text(t)) && !/Text of part B/.test(text(t))), "note, section and block transclusions inline the right text");
ok(!main1.querySelector("span.transclude"), "no unresolved transclusion placeholders");
const wl = [...main1.querySelectorAll("a.wikilink")];
ok(wl.some((a) => a.getAttribute("href") === "#note-2"), "multi-note export: wikilink becomes an internal anchor");
ok(main1.querySelector("#note-2"), "the anchor target exists");
ok([...main1.querySelectorAll(".wikilink-text")].some((s) => /Nowhere/.test(s.textContent ?? "")), "a wikilink to a note outside the export is plain title text");
// TOC matches the headings
const tocLinks = [...main1.querySelectorAll("nav.toc a.toc-link")];
const tocIds = tocLinks.map((a) => (a.getAttribute("href") ?? "").slice(1));
ok(tocIds.every((id) => main1.querySelector(`#${id}`)), "every TOC entry points at an element");
eq(tocLinks.map((a) => text(a.querySelector(".toc-text"))), tocIds.map((id) => text(main1.querySelector(`#${id}`))), "TOC texts equal the heading texts");
const realHeadings = [...main1.querySelectorAll("section.note h1, section.note h2, section.note h3")].filter((h) => !h.closest(".transclusion, .md-toc, .callout, .fm"));
eq(realHeadings.length, tocLinks.length, "every h1-h3 is in the TOC and nothing else");
ok(d1.toc.filter((e: any) => e.level === 1).length >= 3, "note titles and body h1 are level-1 entries");
ok(main1.querySelector("section.titlepage h1"), "title page");
// tasks, callouts, pills keep state and colour
ok(main1.querySelector(".chk.on") && main1.querySelectorAll(".chk").length >= 2, "task check state is kept: " + (main1.querySelector(".task-list-item")?.outerHTML ?? "none"));
ok(!main1.querySelector("input"), "no form inputs in the printed document");
ok(main1.querySelector('.callout[data-callout="warning"]') && /--t-warning/.test(d1.css), "callouts keep their kind (colour)");
ok(main1.querySelector('.status-pill[data-c="amber"]') && /\.status-pill\[data-c=green\]/.test(d1.css), "status pills keep their colour");
ok([...main1.querySelectorAll("details")].every((d) => d.hasAttribute("open")), "folded callouts print open");
ok(main1.querySelector(".footnotes"), "Markdown footnotes are kept");
// page furniture options
ok(!/@top-left\{content:string/.test(d1.css), "no header unless asked for");
const d1h = await build([ks], { headerFooter: true });
ok(/@top-left\{content:string\(doctitle\)/.test(d1h.css) && /counter\(page\) " of " counter\(pages\)/.test(d1h.css), "header / footer: title, date, page X of Y");
ok(!/class="copy"|class="mm-tools"|class="code-head"/.test(d1.html), "app UI (copy buttons, diagram tools) is removed");

// ================================================================== 2. link styles
const dFoot = await build([ks], { links: "footnote" });
const dInline = await build([ks], { links: "inline" });
const dNone = await build([ks], { links: "none" });
ok(dom(dFoot.html).querySelector(".link-notes li") && !dom(dFoot.html).querySelector(".lurl"), "footnote style: numbered list at the end");
const inl = dom(dInline.html);
ok(inl.querySelectorAll(".lurl").length >= 2 && !inl.querySelector(".link-notes"), "inline style: (url) after the link text");
ok([...inl.querySelectorAll(".lurl")].some((u) => /example\.com\/page/.test(u.textContent ?? "")), "inline style shows the URL");
const none = dom(dNone.html);
ok(!none.querySelectorAll("section.note a[href^='http'], section.note a[href^='mailto']").length && !none.querySelector(".link-notes"), "link style none: links are plain text");
eq(dNone.linkCount, 0, "none: no collected links");
eq([...dom(dFoot.html).querySelectorAll("sup.lfn a")][0]?.textContent, "[1]", "footnote marks start at [1]");

// ================================================================== 3. media styles
const dq = await build([ks], { media: "qr" });
ok(dom(dq.html).querySelectorAll("img.qr").length >= 2, "media style qr: a local QR code next to the URL");
const dt = await build([ks], { media: "text" });
ok(!dom(dt.html).querySelector("img.poster"), "media style text: no poster");
const dNoMeta = await build([ks], {}, baseEnv({ media: async () => null }));
ok(dom(dNoMeta.html).querySelector(".media-fallback .poster-none") && /YouTube/.test(dNoMeta.html), "no thumbnail available: placeholder + title + URL");

// ================================================================== 4. flashcard / cloze answer modes
const show = dom((await build([ks], { answers: "show" })).html).querySelector("section.note")!;
ok(/Paris/.test(text(show)) && /Tokyo/.test(text(show)) && /Jupiter/.test(text(show)), "answers shown: cloze and card answers are visible");
const hide = await build([ks], { answers: "hide" });
const hbody = dom(hide.html).querySelector("section.note")!;
ok(!/Paris|Tokyo|Jupiter/.test(strip(hide.html)), "answers hidden: the answers are nowhere in the document");
ok(hbody.querySelectorAll(".cloze-hidden").length === 3 && hbody.querySelectorAll(".fc-hidden").length === 2, "answers hidden: blanks in their place");
ok(/What is 2 \+ 2\?/.test(text(hbody)), "answers hidden: questions stay");
const key = await build([ks], { answers: "key" });
const kdoc = dom(key.html);
const kn = kdoc.querySelector("section.answer-key");
ok(kn && /Paris/.test(text(kn)) && /Tokyo/.test(text(kn)) && /Jupiter/.test(text(kn)) && /<b>4<\/b>/.test(kn.innerHTML), "answer key: a separate section lists every answer");
ok(!/Paris|Tokyo|Jupiter/.test(kdoc.querySelector("section.note")!.textContent ?? ""), "answer key: the note itself has no answers");
eq([...kdoc.querySelectorAll("sup.cloze-key")].map((s) => s.textContent), ["1", "2", "3", "4", "5"], "answer key: blanks are numbered");
eq([...kn!.querySelectorAll("li")].map((l) => l.getAttribute("value")), ["1", "2", "3", "4", "5"], "answer key: numbers match the blanks");

// ================================================================== 5. themes (paper by default, even when the app is dark)
const paper = await build([ks], {});
ok(/:root\{--bg:#ffffff/.test(paper.css), "paper theme prints light although the app theme is dark");
const screenT = await build([ks], { theme: "screen" });
ok(/:root\{--bg:#0f1115/i.test(screenT.css) && /print-color-adjust:exact/.test(screenT.css), "as on screen: the app's colours, forced to print");
const bwT = await build([ks], { theme: "bw" });
ok(/--link:#000000/.test(bwT.css) && /--bg:#ffffff/.test(bwT.css), "black and white palette");
// HTML target: light / dark toggle, sidebar TOC, same print css
const html = await pd.buildPrintDoc({ title: "Pack", notes: [ks, inc] }, { engine: "html" }, baseEnv());
const hd = dom(html.html);
ok(hd.querySelector(".doc-side ol li") && hd.querySelector(".theme-toggle"), "html: sidebar TOC and a theme toggle");
ok(/prefers-color-scheme:dark/.test(html.css) && /:root\[data-theme=dark\]/.test(html.css) && /@media print\{:root,:root\[data-theme\]\{--bg:#ffffff/.test(html.css), "html: follows the system colour scheme, prints with the print palette");
ok(/@page\{size:210mm 297mm/.test(html.css) && /break-inside:avoid/.test(html.css), "html file carries the same print css");
ok(!/<script[^>]*\ssrc=/.test(html.html) && /<script>\(function/.test(html.html), "html: the toggle script is inline");
ok(!/@bottom-center/.test(html.css), "html: no margin boxes (they need Paged.js)");

// ================================================================== 6. fallbacks: services failing
const offline = baseEnv({ mermaid: async () => { throw new Error("no"); }, canvasSvg: async () => null, attachment: async () => null, fonts: async () => "", katexCss: async () => "", media: async () => null, image: async () => { throw new Error("offline"); } });
const dOff = await build([ks], {}, offline);
const off = dom(dOff.html).querySelector("main")!;
eq(off.querySelectorAll("figure.diagram-fallback").length, 3, "diagram failures: labelled source blocks (2 mermaid + canvas)");
ok(/graph LR/.test(off.querySelector("figure.diagram-fallback pre")?.textContent ?? "") && /could not be drawn/.test(text(off.querySelector("figure.diagram-fallback figcaption"))), "fallback shows the code, labelled");
eq(off.querySelectorAll(".img-missing").length, 3, "offline: all three images fall back to alt text");
ok(dOff.warnings.fonts && dOff.warnings.katex, "fonts / KaTeX failures are reported");
ok(!/<style id="fonts">/.test(dOff.html) && /Inter, "IBM Plex Sans Arabic", system-ui/.test(dOff.css), "no embedded fonts: the system font stack carries the document");
eq(dOff.warnings.diagramsFallback, 3, "warning counts diagrams");

// ================================================================== 7. single-note export: wikilinks are plain text
const single = dom((await build([ks])).html).querySelector("main")!;
ok(!single.querySelector("a.wikilink") && [...single.querySelectorAll(".wikilink-text")].some((s) => /Included note/.test(s.textContent ?? "")), "single note: wikilinks are plain title text");

// ================================================================== 8. empty note, canvas-only note, 20-note folder
const empty = await build([{ id: "e", title: "Empty", body: "", type: "note" }], { toc: true });
ok(dom(empty.html).querySelector("h1.note-title") && empty.toc.length === 1, "empty note exports (title only)");
const onlyCanvas = await build([{ id: "c", title: "Canvas embed", body: '```canvas\n{"nodes":[{"id":"a","type":"text","text":"Only","x":0,"y":0,"width":100,"height":50}],"edges":[]}\n```\n', type: "note" }]);
ok(dom(onlyCanvas.html).querySelector("figure.diagram svg"), "a note with only a canvas embed renders the canvas as SVG");
const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, title: `Note ${i + 1}`, body: `# Note ${i + 1}\n\n## Part\n\nText of note ${i + 1}, see [[Note ${(i + 1) % 20 + 1}]].`, type: "note" }));
const d20 = await build(twenty, { toc: true });
const doc20 = dom(d20.html);
eq(doc20.querySelectorAll("section.note").length, 20, "20 notes: 20 sections");
eq(d20.toc.filter((e: any) => e.level === 1).length, 20, "one TOC, 20 note entries");
eq(doc20.querySelectorAll("nav.toc").length, 1, "multi-note scope has exactly one TOC");
ok(/section\.note\+section\.note\{break-before:page\}/.test(d20.css), "each note starts on a new page");
ok([...doc20.querySelectorAll("a.wikilink")].every((a) => /^#note-\d+$/.test(a.getAttribute("href") ?? "")) && doc20.querySelectorAll("a.wikilink").length === 20, "wikilinks between exported notes are internal anchors");
// options: break before headings, front matter
const dh2 = await build([ks], { breakH: "h2" });
ok(/h1:not\(\.note-title\),h2\{break-before:page\}/.test(dh2.css), "break before H2 option");
const dfm = dom((await build([ks], { frontMatter: true })).html);
ok(dfm.querySelector(".note-meta") && dfm.querySelector("table.fm"), "front matter option shows the properties");
ok(!dom((await build([ks], {})).html).querySelector("table.fm"), "front matter hidden by default");
// paper size / orientation / margins
const a5 = await build([ks], { paper: "a5", landscape: true, marginMm: 12, fontPt: 9 });
ok(/@page\{size:210mm 148mm;margin:12mm/.test(a5.css) && /font-size:9pt/.test(a5.css), "paper, orientation, margin and font size reach the css");
ok(!/\.tbl\.cols-wide\{page:wide/.test(a5.css), "landscape already: no extra wide page");
const lt = await build([ks], { paper: "letter" });
ok(/@page\{size:215.9mm 279.4mm/.test(lt.css), "US Letter");

// ================================================================== 9. cancelling mid-export
const ac = new AbortController();
let cancelled = false;
try { await build(twenty, {}, baseEnv({ signal: ac.signal, onProgress: (i: number) => { if (i === 3) ac.abort(); } })); } catch (e) { cancelled = (e as Error).name === "AbortError"; }
ok(cancelled, "aborting mid-export stops the build with AbortError");
const ac2 = new AbortController(); ac2.abort();
let cancelled2 = false;
try { await build([ks], {}, baseEnv({ signal: ac2.signal })); } catch (e) { cancelled2 = (e as Error).name === "AbortError"; }
ok(cancelled2, "an already-aborted signal never starts");

// ================================================================== 10. file names
const fn = pd.exportFileName;
eq(fn("My: note/with*bad?chars", "pdf"), "My- note-with-bad-chars.pdf", "path characters replaced");
eq(fn("", "md"), "Untitled.md", "empty title");
eq(fn("CON", "html"), "CON-.html", "Windows reserved name");
eq(fn("  trailing dots...  ", "pdf"), "trailing dots.pdf", "trailing dots and spaces trimmed");
eq(fn("عنوان عربي: ملاحظة", "pdf"), "عنوان عربي- ملاحظة.pdf", "Arabic titles survive");
eq(fn("a".repeat(300), "pdf").length, 80 + 4, "length capped");
eq(fn("tab\tand\nnewline\u0000nul", "md"), "tab and newlinenul.md", "control characters dropped");
eq(fn("..", "md"), "Untitled.md", "dots only");
ok(!/[\\/:*?"<>|]/.test(fn('a\\b/c:d*e?f"g<h>i|j', "pdf")), "no forbidden characters");

// ================================================================== 11. worker header / footer templates and the Paged.js wrapper
const hf = pd.headerFooterTemplates("Title <x>", "22 November 2026", { headerFooter: true, pageNumbers: true }, { page: "page", of: "of" });
ok(/pageNumber/.test(hf.footerTemplate) && /totalPages/.test(hf.footerTemplate) && /Title &lt;x&gt;/.test(hf.headerTemplate), "header / footer templates: title, date, page X of Y, escaped");
const pdoc = await run.pagedDocument("<!doctype html><html><head></head><body><main>x</main></body></html>");
ok(/PagedConfig=\{auto:false\}/.test(pdoc) && /PagedPolyfill\.preview\(\)/.test(pdoc) && /lumenPaged/.test(pdoc) && pdoc.length > 300000, "Paged.js wrapper: polyfill inline, runs after fonts and images");
eq((pdoc.match(/<\/script>/g) ?? []).length, 3, "Paged.js source can't close the script tag early");

// ================================================================== 12. HTML folder zip (index + one page per note + assets)
const JSZip = (await import("jszip")).default;
const req = { format: "html", scope: { kind: "folder", folderId: "x" }, opts: { ...pd.PRINT_DEFAULTS }, htmlFolder: true, engine: "auto" };
const blob: Blob = await run.buildHtmlFolder([ks, inc], "Pack", (t: string) => [ks, inc].find((n) => n.title.toLowerCase() === t.toLowerCase()) ?? null, req, baseEnv());
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
const names = Object.keys(zip.files);
ok(names.includes("index.html") && names.includes("assets/doc.css"), "folder zip: index.html and assets/doc.css");
eq(names.filter((n) => /^\d\d-.*\.html$/.test(n)).length, 2, "folder zip: one page per note");
ok(names.some((n) => /^assets\/img-\d+\.png$/.test(n)), "folder zip: images are files in assets/");
const page1 = await zip.file(names.find((n) => /^01-/.test(n))!)!.async("string");
ok(/<link rel="stylesheet" href="assets\/doc\.css">/.test(page1) && !/<style id="print">/.test(page1), "folder pages share one stylesheet");
ok(!/src="data:image/.test(page1) && /src="assets\/img-1\.png"/.test(page1), "folder pages reference the asset files");
ok(/href="02-Included note\.html"/.test(page1), "wikilinks between pages are relative file links");
const css = await zip.file("assets/doc.css")!.async("string");
ok(/@font-face\{font-family:Inter/.test(css) && /font-family:\s*KaTeX_Main/.test(css), "shared css holds the fonts and KaTeX: " + css.slice(0, 120));

await vite.close();
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
