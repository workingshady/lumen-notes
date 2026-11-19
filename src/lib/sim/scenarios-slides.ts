// Dev simulator scenario: "Slides lab". One deck per slides capability group (src/components/Slides.tsx,
// src/lib/deck.ts, src/lib/markdown.ts), a kitchen-sink deck and edge-case decks. Every deck's first slide
// says what to check. Real attachment bytes: PNG (incl. huge / extreme aspect), SVG, WebM video, WAV audio, PDF, CSV.
import { addFile, clock, emptyVault, folder, note, pdfBlob, pngBlob, space, svgBlob, wavBlob, type Vault } from "./kit";

const F = "```";
const SP = "sl-s";

/** A few seconds of real WebM video (canvas + MediaRecorder); a tiny placeholder blob where that is unavailable. */
async function webmBlob(seconds = 2, w = 640, h = 360, label = "clip.webm"): Promise<Blob> {
  try {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    const stream = (cv as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(24);
    if (!stream || typeof MediaRecorder === "undefined") throw new Error("no MediaRecorder");
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: type });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      g.fillStyle = "#101820"; g.fillRect(0, 0, w, h);
      g.fillStyle = `hsl(${(t * 120) % 360}, 70%, 55%)`;
      g.beginPath(); g.arc(w * (0.15 + 0.7 * ((t / seconds) % 1)), h / 2, h / 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.font = `bold ${Math.round(h / 10)}px sans-serif`; g.textAlign = "center";
      g.fillText(`${label} · ${t.toFixed(1)} s`, w / 2, h * 0.9);
      raf = requestAnimationFrame(draw);
    };
    draw();
    rec.start(250);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await Promise.race([done, new Promise((r) => setTimeout(r, 1500))]);
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((tr) => tr.stop());
    const b = new Blob(parts, { type: "video/webm" });
    if (b.size) return b;
  } catch { /* fall through */ }
  return new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "video/webm" });
}

/** Deck body: front-matter, slides joined with `---`. */
function deckBody(slides: string[], fm: Record<string, string> = {}) {
  const extra = Object.entries(fm).map(([k, v]) => `${k}: ${v}\n`).join("");
  return `---\ntype: slides\ntags: [slides-lab]\n${extra}---\n${slides.map((s) => s.trim()).join("\n\n---\n\n")}\n`;
}
/** First slide of every deck: title + the checklist. */
const intro = (title: string, checks: string[]) => `# ${title}\n\n${checks.map((c) => `- ${c}`).join("\n")}\n\nNote: Checklist slide. Open presenter view (P) to see these notes.`;

// URLs used by media slides (network needed for these; attachments work offline).
const URLS = {
  img: "https://picsum.photos/seed/lumen-slides/1600/900.jpg",
  imgTall: "https://picsum.photos/seed/lumen-tall/600/1400.jpg",
  yt: "https://www.youtube.com/watch?v=aircAruvnKk",
  ytShort: "https://youtu.be/IHZwWFHWa-w?t=90",
  vimeo: "https://vimeo.com/76979871",
  mp4: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  mp3: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
  pdf: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  card: "https://developer.mozilla.org/en-US/docs/Web/HTML",
};

// ------------------------------------------------------------------ decks
function basicsDeck() {
  return deckBody([
    intro("01 · Basics & navigation", [
      "`---` on its own line splits slides; front-matter is not a slide",
      "Keys: → / Space / Enter next, ← / Backspace prev, Home / End, type 12 + Enter to jump",
      "O or G overview grid, P presenter view, B or . blank, F full screen, Esc exits",
      "Phone: swipe left / right, the X top-left exits",
      "Thumbnail strip at ≥ 1200 px wide; progress bar on top",
    ]),
    `# Auto layout: title\n\nA heading and one short line is centred as a title slide`,
    `KICKER LINE\n\n# Kicker above the title\n\nThe short paragraph above the H1 renders as an uppercase kicker`,
    `# A very long title slide, which should break after its first comma when it wraps\n\nCheck the line break after "slide,"`,
    `## Auto layout: bullets\n\n- First point\n- Second point with **bold**, *italic*, \`code\` and a [link](https://example.com)\n- Third point\n  - Nested point\n  - Another nested point\n- Fourth point`,
    `## Ordered list\n\n1. Plan\n2. Build\n3. Measure\n4. Learn`,
    `## Auto layout: text\n\nA plain paragraph slide. Text that is too long for the slide auto-shrinks (down to 62 %) and then scrolls.\n\n> A blockquote on a text slide.\n\nAnother paragraph after the quote.`,
    `## Speaker notes with \`Note:\`\n\nOnly the part above "Note:" is on the slide.\n\nNote: These are the speaker notes. They appear in presenter view (P) and on the phone remote.\n\nThey can span several paragraphs, **with Markdown** that is shown as plain text.`,
    `## Speaker notes with \`Notes:\`\n\nThe plural spelling works too.\n\nNotes: Plural notes line.`,
    `## \`---\` inside a code fence\n\n${F}yaml\n---\nkey: value\n---\n${F}\n\nThis must stay ONE slide (fenced \`---\` is not a separator).`,
    `## Task list on a slide\n\n- [x] Done item\n- [ ] Open item\n- [/] Doing item`,
    `## Last slide\n\nEnd should disable "Next"; the counter reads ${"`"}12 / 12${"`"}.`,
  ]);
}

function layoutsDeck() {
  return deckBody([
    intro("02 · Layout directives", [
      "Each slide sets `<!-- layout: … -->`: title, section, default, center, two-cols, image-left, image-right, cards, stat, quote, full, blank",
      "Aliases: cover, statement, fact, comparison, grid, image, none, end",
      "`split:` widths, `image:` side image, `_layout` (Marp one-slide key)",
      "Text auto-shrinks inside regions",
    ]),
    `<!-- layout: title -->\nLAYOUT: TITLE\n\n# The title layout\n\nSubtitle line under the title`,
    `<!-- layout: section -->\n## Section layout\n\nAccent bar above the heading, muted subtitle`,
    `<!-- layout: default -->\n## Default layout\n\nHeader region on top, body below.\n\n- Point one\n- Point two`,
    `<!-- layout: center -->\n## Center layout\n\nOne big centred statement`,
    `<!-- layout: two-cols -->\n## Two columns\n\n::left::\n### Left\n\n- Alpha\n- Beta\n\n::right::\n### Right\n\n- Gamma\n- Delta`,
    `<!-- layout: two-cols; split: 30% -->\n## Two columns, split 30 %\n\n::left::\nNarrow left column\n\n::right::\nWide right column with more text so the difference in width is visible at a glance.`,
    `<!-- layout: two-cols -->\n## Two columns without markers\n\nEverything lands in the left column; the right one stays empty.`,
    `<!-- layout: image-right -->\n## Image right (default 45 %)\n\n![chart](att:sl-png)\n\n- The first image line becomes the side image\n- Text stays on the left`,
    `<!-- layout: image-left; split: 40% -->\n## Image left, split 40 %\n\n![photo](att:sl-png-photo)\n\nThe image fills the left 40 % (object-fit: cover).`,
    `<!-- layout: image-right; image: att:sl-svg -->\n## \`image:\` directive\n\nThe side image comes from the directive (an SVG attachment), not from the body.`,
    `<!-- layout: cards -->\n## Cards (numbered regions)\n\n::1::\n### Fast\nLocal-first, instant.\n\n::2::\n### Open\nPlain Markdown files.\n\n::3::\n### Synced\nCloudflare D1.`,
    `<!-- layout: cards -->\n## Cards from ### headings (auto)\n\n### One\nFirst card\n\n### Two\nSecond card\n\n### Three\nThird card\n\n### Four\nFourth card (2 × 2 grid)`,
    `<!-- layout: cards -->\n## Cards from a list (auto, max 6)\n\n- **Read** the chapter\n- **Write** a summary\n- **Quiz** yourself\n- **Teach** it\n- **Review** in 3 days\n- **Apply** it\n- **Seventh** item is dropped`,
    `<!-- layout: stat -->\n## Stat layout\n\n**94 %**\n\nof cards reviewed on time`,
    `<!-- layout: quote -->\n> The best way to learn is to teach.\n\n— Frank Oppenheimer`,
    `<!-- layout: full -->\n## Full layout (table)\n\n| Layout | Regions |\n|---|---|\n| two-cols | left, right |\n| cards | 1 … 6 |\n| image-left/right | side + body |`,
    `<!-- layout: full -->\n## Full layout (image)\n\n![big image](att:sl-png-photo)`,
    `<!-- layout: blank -->\n::: box x=35 y=40 w=30 {.card .center}\nBlank layout: no padding, only this box\n:::`,
    `<!-- layout: cover -->\n# Alias: cover → title`,
    `<!-- layout: statement -->\n## Alias: statement → center`,
    `<!-- layout: fact -->\n## Alias: fact → stat\n\n**42**\n\nthe answer`,
    `<!-- layout: comparison -->\n## Alias: comparison → two-cols\n\n::left::\nBefore\n\n::right::\nAfter`,
    `<!-- layout: grid -->\n## Alias: grid → cards\n\n### A\nx\n\n### B\ny\n\n### C\nz`,
    `<!-- layout: image -->\n## Alias: image → full\n\n![chart](att:sl-png)`,
    `<!-- layout: end -->\n## Alias: end → center\n\nThanks!`,
    `<!-- _layout: center -->\n## \`_layout\` (Marp one-slide key)\n\nCentred here only`,
    `## Next slide has no directive\n\nShould be back to automatic layout (bullets / text).`,
    `<!-- layout: does-not-exist -->\n## Unknown layout name\n\nFalls back to automatic layout, no crash.`,
    `<!-- layout: two-cols -->\n## Overflowing two columns\n\n::left::\n${Array.from({ length: 14 }, (_, i) => `- Left item ${i + 1} with some extra words to wrap`).join("\n")}\n\n::right::\n${Array.from({ length: 14 }, (_, i) => `- Right item ${i + 1}`).join("\n")}`,
  ]);
}

function classesDeck() {
  return deckBody([
    intro("03 · Classes, alignment & backgrounds", [
      "`class: invert` carries to following slides until changed; `_class:` is one slide only",
      "`class: accent` fills the slide with the accent colour",
      "`align: left` left-aligns centred layouts",
      "`bg:` directive and Marp `![bg](…)`, `![bg left:40%](…)`, `![bg right](…)`",
    ]),
    `<!-- _class: accent; layout: center -->\n## \`_class: accent\` (this slide only)`,
    `## Back to normal\n\nThe accent class must NOT carry here (it had an underscore).`,
    `<!-- class: invert; bg: att:sl-png-photo; layout: center -->\n## \`class: invert\` + \`bg:\`\n\nWhite text over a darkened background image`,
    `## Invert carried\n\n\`class: invert\` has no underscore, so it carries to this slide (no background here).`,
    `<!-- class: -->\n## Class reset\n\nAn empty \`class:\` clears it again.`,
    `<!-- layout: center; align: left -->\n## \`align: left\`\n\nCentre layout, but left aligned`,
    `<!-- layout: center; align: -->\n## Align reset\n\nCentred again`,
    `![bg](att:sl-png-photo)\n\n<!-- layout: center -->\n## Marp \`![bg](…)\`\n\nBackground image behind the text (directive comment not first: check it still applies or shows as text)`,
    `![bg left:40%](att:sl-png)\n\n## Marp \`![bg left:40%]\`\n\nSide image on the left at 40 %, layout becomes image-left`,
    `![bg right](${URLS.img})\n\n## Marp \`![bg right]\` (URL)\n\nSide image on the right at the default width (network image)`,
    `<!-- class: left; layout: center -->\n## \`class: left\`\n\ndeck.ts docs list "left" as a class; check whether it changes anything`,
  ]);
}

function frontMatterDeck() {
  return deckBody([
    intro("04 · Front-matter defaults", [
      "Front-matter `layout: center` applies to every slide after the first",
      "Front-matter `class: accent` and `align: left` carry to every slide",
      "`paginate: true` / `theme: dark` are carried keys: check whether they do anything",
    ]),
    `## Slide two\n\nShould be centred, accent coloured, left aligned`,
    `<!-- layout: two-cols -->\n## Overrides the default layout\n\n::left::\nLeft\n\n::right::\nRight`,
    `## Slide four\n\nBack to the front-matter default`,
  ], { layout: "center", class: "accent", align: "left", paginate: "true", theme: "dark" });
}

function boxesDeck() {
  return deckBody([
    intro("05 · Free placement boxes & Arrange", [
      "`::: box x= y= w= h=` places a box in percent of the slide",
      "`{.card}` frame, `{.center}` centring, `rotate=`, `z=`, `id=`, `h=auto`",
      "Press A (or the Move icon) to Arrange: drag a box, drag its corner to resize; numbers are written back to the note",
      "\"+ Box\" adds a new box before the speaker notes",
    ]),
    `## Two cards\n\n::: box x=8 y=35 w=38 h=40 {.card}\n### Left card\nx=8 y=35 w=38 h=40\n:::\n\n::: box x=54 y=35 w=38 h=40 {.card .center}\n### Right card\nCentred content\n:::\n\nNote: Try Arrange (A) here and drag a card. The ::: box line in the note must update.`,
    `## Rotated and stacked\n\n::: box x=20 y=30 w=30 h=30 z=1 {.card .center}\nUnder (z=1)\n:::\n\n::: box x=30 y=40 w=30 h=30 z=3 rotate=-8 {.card .center}\nOver, rotated −8° (z=3)\n:::`,
    `## Image in a box\n\n::: box x=55 y=20 w=40 h=60\n![chart](att:sl-png)\n:::\n\n::: box x=5 y=30 w=45 h=auto\nAuto height text box next to an image box. id=\n:::`,
    `## Out-of-range coordinates\n\n::: box x=-10 y=90 w=40 h=20 {.card}\nPartly off the bottom-left\n:::\n\n::: box x=95 y=-5 w=30 h=20 {.card}\nPartly off the top-right\n:::\n\n::: box x=abc y=NaN w=foo {.card}\nNon-numeric values fall back to defaults\n:::`,
    `## Box with an id and quoted attrs\n\n::: box x=10 y=30 w=80 h=40 id=hero {.card .center}\n**Hero** box with \`id=hero\`\n:::`,
    `## Unclosed box\n\n::: box x=10 y=30 w=50 h=30 {.card}\nThis box has no closing fence: it should swallow the rest of the slide, not the deck`,
    `## Slide after the unclosed box\n\nMust render normally.`,
  ]);
}

function codeMathDeck() {
  const longCode = Array.from({ length: 60 }, (_, i) => `    result_${i} = compute(step=${i}, values=[${i}, ${i * 2}, ${i * 3}])  # line ${i + 1}`).join("\n");
  return deckBody([
    intro("06 · Code & math", [
      "Syntax highlighting for several languages; long lines and long blocks",
      "KaTeX inline, display, aligned; a broken formula shows an error, not a crash",
    ]),
    `## Python\n\n${F}python\ndef fib(n: int) -> int:\n    """Return the n-th Fibonacci number."""\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n${F}`,
    `## TypeScript\n\n${F}ts\nexport const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\ninterface Slide { md: string; notes?: string }\n${F}`,
    `## Shell, JSON, SQL\n\n${F}bash\nnpx vite --port 5288 --strictPort\n${F}\n\n${F}json\n{ "type": "slides", "count": 3 }\n${F}\n\n${F}sql\nSELECT id, title FROM notes WHERE type = 'slides';\n${F}`,
    `## Long code block (60 lines)\n\n${F}python\ndef long_function():\n${longCode}\n${F}`,
    `## Very long code line\n\n${F}js\nconst x = "${"a".repeat(300)}";\n${F}`,
    `## Code without a language\n\n${F}\nplain preformatted text\n  indented\n${F}`,
    `## Inline math\n\nEuler: $e^{i\\pi} + 1 = 0$, and the mean $\\bar x = \\frac{1}{n}\\sum_i x_i$.`,
    `## Display math\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$`,
    `## Aligned\n\n$$\n\\begin{aligned}\n\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\\n\\nabla \\cdot \\mathbf{B} &= 0 \\\\\n\\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t}\n\\end{aligned}\n$$`,
    `## Matrix\n\n$$\nA = \\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}\n$$`,
    `## Broken math\n\n$$\\frac{1}{$$\n\nInline broken: $\\notacommand{x}$`,
  ]);
}

function diagramsDeck() {
  return deckBody([
    intro("07 · Mermaid diagrams", [
      "A slide that is only a mermaid fence gets the diagram layout + a `mermaid · …` caption",
      "Mermaid in `layout: full`, mixed with text, very large, and invalid",
    ]),
    `## Flowchart\n\n${F}mermaid\nflowchart LR\n  A[Write] --> B[Present] --> C{Questions?}\n  C -- yes --> D[Answer]\n  C -- no --> E[Done]\n${F}`,
    `## Sequence\n\n${F}mermaid\nsequenceDiagram\n  participant P as Presenter\n  participant R as Phone remote\n  R->>P: next\n  P-->>R: state (slide 3)\n${F}`,
    `${F}mermaid\npie title Slides by layout\n  "bullets" : 40\n  "image" : 25\n  "diagram" : 15\n  "title" : 20\n${F}`,
    `<!-- layout: full -->\n## Mermaid in full layout\n\n${F}mermaid\nstateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Published\n  Published --> [*]\n${F}`,
    `## Diagram with text\n\nSome text before the diagram (not the diagram layout).\n\n${F}mermaid\nflowchart TD\n  X --> Y\n${F}`,
    `## Big flowchart\n\n${F}mermaid\nflowchart LR\n${Array.from({ length: 30 }, (_, i) => `  N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`).join("\n")}\n${F}`,
    `## Invalid mermaid\n\n${F}mermaid\nflowchart LR\n  A -->> -- B ((\n${F}`,
  ]);
}

function blocksDeck() {
  return deckBody([
    intro("08 · Markdown blocks on slides", [
      "Callouts (open, folded), `:::` panels, columns, tabs, expand",
      "Tables: small, wide, long, `{.compact}`; footnotes; tags",
      "Wiki links: existing, missing, alias, heading; `![[Note]]` and `![[Note#Heading]]` transclusion",
    ]),
    `## Callouts\n\n> [!note] Note\n> A note callout.\n\n> [!warning] Careful\n> A warning callout.\n\n> [!tip]- Folded tip\n> Hidden until opened.`,
    `## \`:::\` panels\n\n::: info Panel title\nAn info panel written as a fenced div.\n:::\n\n::: danger\nDanger panel.\n:::`,
    `## Columns\n\n::: columns\n::: column 40%\n**Left (40 %)**\n\nText\n:::\n::: column\n**Right**\n\nMore text\n:::\n:::`,
    `## Tabs\n\n::: tabs\n### Python\n${F}python\nprint("hi")\n${F}\n### JavaScript\n${F}js\nconsole.log("hi")\n${F}\n:::`,
    `## Expand\n\n::: expand Click to reveal the answer\nThe answer is 42.\n:::`,
    `## Small table\n\n| Name | Grade | Note |\n|:--|:-:|--:|\n| Amir | A | 95 |\n| Sara | B+ | 88 |\n| ليلى | A− | 91 |`,
    `## Wide table\n\n| ${Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`).join(" | ")} |\n|${Array.from({ length: 12 }, () => "---").join("|")}|\n| ${Array.from({ length: 12 }, (_, i) => `value ${i + 1}`).join(" | ")} |`,
    `## Long table (25 rows)\n\n| # | Item | Value |\n|---|---|---|\n${Array.from({ length: 25 }, (_, i) => `| ${i + 1} | Row ${i + 1} | ${(i * 37) % 100} |`).join("\n")}`,
    `## Compact table\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n{.compact}`,
    `## Footnotes & tags\n\nA claim with a footnote[^1]. Tags: #slides-lab #nested/tag\n\n[^1]: The footnote text.`,
    `## Wiki links\n\n- Existing: [[Slides lab · snippets]]\n- Alias: [[Slides lab · snippets|the snippets note]]\n- Heading: [[Slides lab · snippets#Definition]]\n- Missing: [[This note does not exist]]`,
    `## Transclusion: whole note\n\n![[Slides lab · snippets]]`,
    `## Transclusion: one heading\n\n![[Slides lab · snippets#Definition]]`,
    `## Attachment link\n\n[📎 grades.csv](att:sl-csv) opens / downloads the CSV`,
  ]);
}

function mediaDeck() {
  return deckBody([
    intro("09 · Images, video, audio, PDF, links", [
      "Single image → image layout with caption (alt text); tap / click to zoom (Esc closes)",
      "Local attachments: PNG, SVG, WebM video, WAV audio, PDF; plus URL image / mp4 / mp3 / PDF",
      "YouTube (watch + youtu.be with t=), Vimeo: thumbnail until play",
      "Space plays / pauses media on the slide instead of advancing; media never autoplays",
      "`<https://…>` autolink → link card; bare non-media URL → card",
    ]),
    `## PNG attachment\n\n![chart.png · attachment](att:sl-png)`,
    `## SVG attachment\n\n![diagram.svg](att:sl-svg)`,
    `## Image from a URL\n\n![picsum photo](${URLS.img})`,
    `![Image with no heading](att:sl-png-photo)`,
    `## Two images\n\n![a](att:sl-png) ![b](att:sl-svg)`,
    `## Video attachment (WebM)\n\n![clip.webm](att:sl-webm)`,
    `## Audio attachment (WAV)\n\n![tone.wav](att:sl-wav)`,
    `## PDF attachment\n\n![handout.pdf](att:sl-pdf)`,
    `## YouTube\n\n${URLS.yt}`,
    `## YouTube short link with t=90\n\n${URLS.ytShort}`,
    `## Vimeo\n\n${URLS.vimeo}`,
    `## mp4 URL\n\n${URLS.mp4}`,
    `## mp3 URL\n\n${URLS.mp3}`,
    `## PDF URL\n\n${URLS.pdf}`,
    `## Link card (autolink)\n\n<${URLS.card}>`,
    `## Bare URL card\n\n${URLS.card}`,
    `${URLS.yt}`,
  ]);
}

function mixedMediaDeck() {
  return deckBody([
    intro("10 · Mixed media", [
      "Several media on one slide: image + video + audio, media in columns and cards",
      "Space should play the FIRST media element; check nothing autoplays",
    ]),
    `## Image + video + audio\n\n![chart](att:sl-png)\n\n![clip.webm](att:sl-webm)\n\n![tone.wav](att:sl-wav)`,
    `<!-- layout: two-cols -->\n## Video vs image\n\n::left::\n![clip.webm](att:sl-webm)\n\n::right::\n![photo](att:sl-png-photo)`,
    `<!-- layout: two-cols -->\n## YouTube vs notes\n\n::left::\n${URLS.yt}\n\n::right::\n- Watch the first minute\n- Pause with Space`,
    `<!-- layout: cards -->\n## Media cards\n\n::1::\n![png](att:sl-png)\n\n::2::\n![svg](att:sl-svg)\n\n::3::\n![tone.wav](att:sl-wav)`,
    `<!-- layout: image-left -->\n## Side image + audio\n\n![photo](att:sl-png-photo)\n\nListen:\n\n![tone.wav](att:sl-wav)`,
    `<!-- bg: att:sl-png-photo; class: invert -->\n## Background + video\n\n![clip.webm](att:sl-webm)`,
    `## Image + math + code\n\n![chart](att:sl-png)\n\n$E = mc^2$\n\n${F}js\nplay()\n${F}`,
  ]);
}

function rtlDeck() {
  return deckBody([
    `# ٠١ · عرض باللغة العربية\n\n- كل كتلة تأخذ \`dir="auto"\`: النص العربي يبدأ من اليمين\n- العناوين والقوائم والجداول والملاحظات بالعربية\n- نص مختلط عربي و English في نفس السطر\n\nNote: ملاحظات المتحدث بالعربية. تظهر في عرض المقدم (P).`,
    `<!-- layout: title -->\n# مقدمة في تعلم الآلة\n\nالمحاضرة الأولى`,
    `## النقاط الرئيسية\n\n- الانحدار الخطي\n- الشبكات العصبية\n  - الانتشار العكسي\n- التقييم والاختبار`,
    `## نص مختلط\n\nنستخدم **Python** و \`numpy\` لحساب المتوسط $\\bar x$ ثم نرسم النتائج باستخدام matplotlib.`,
    `<!-- layout: two-cols -->\n## مقارنة\n\n::left::\n### قبل\n- بطيء\n- يدوي\n\n::right::\n### بعد\n- سريع\n- آلي`,
    `<!-- layout: cards -->\n## ثلاث بطاقات\n\n### اقرأ\nالفصل الأول\n\n### اكتب\nملخصاً قصيراً\n\n### راجع\nبعد ثلاثة أيام`,
    `## جدول\n\n| الاسم | الدرجة |\n|---|---|\n| أحمد | ٩٥ |\n| سارة | ٨٨ |`,
    `<!-- layout: quote -->\n> اطلبوا العلم من المهد إلى اللحد\n\n— قول مأثور`,
    `<!-- layout: stat -->\n## إحصائية\n\n**٩٤٪**\n\nمن البطاقات تمت مراجعتها في الوقت`,
    `## صورة\n\n![رسم بياني](att:sl-png)`,
    `> [!tip] نصيحة\n> ملاحظة بالعربية داخل صندوق تنبيه.`,
    `## English slide inside an Arabic deck\n\nThis slide is left-to-right; the next one is Arabic again.`,
    `## النهاية\n\nشكراً لكم`,
  ]);
}

function kitchenSinkDeck() {
  return deckBody([
    intro("00 · Kitchen sink", [
      "One slide per capability, quick tour: auto layouts, every directive family, boxes, code, math, mermaid, callouts, table, media, Arabic, notes",
      "Run through with → and check each slide renders without errors",
      "Open overview (O) and presenter view (P); try the audience window from presenter view",
    ]),
    `<!-- layout: title -->\nKITCHEN SINK\n\n# Everything at once\n\nA tour of every slide feature`,
    `## Bullets\n\n- One\n- Two\n  - Nested\n- Three\n\nNote: Notes on the bullets slide.`,
    `<!-- layout: section -->\n## Section divider`,
    `<!-- layout: two-cols -->\n## Two columns\n\n::left::\nLeft side\n\n::right::\nRight side`,
    `<!-- layout: cards -->\n## Cards\n\n::1::\n### A\none\n\n::2::\n### B\ntwo\n\n::3::\n### C\nthree`,
    `<!-- layout: image-right; split: 40% -->\n## Image right\n\n![chart](att:sl-png)\n\nText left`,
    `<!-- layout: stat -->\n## Stat\n\n**1,024**\n\nslides presented`,
    `<!-- layout: quote -->\n> Simplicity is prerequisite for reliability.\n\n— Dijkstra`,
    `<!-- class: invert; bg: att:sl-png-photo; layout: center -->\n## Background, inverted`,
    `<!-- class: ; layout: blank -->\n::: box x=10 y=15 w=35 h=30 {.card .center}\nFree box A\n:::\n\n::: box x=55 y=55 w=35 h=30 rotate=4 {.card .center}\nFree box B\n:::`,
    `## Code\n\n${F}ts\nconst deck = deckSlides(note.body);\n${F}`,
    `## Math\n\n$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$`,
    `${F}mermaid\nflowchart LR\n  Markdown --> Deck --> Audience\n${F}`,
    `## Callout\n\n> [!important] Remember\n> Press P for presenter view.`,
    `## Table\n\n| Key | Action |\n|---|---|\n| O | Overview |\n| P | Presenter |\n| B | Blank |`,
    `## Image\n\n![photo](att:sl-png-photo)`,
    `## Video\n\n![clip.webm](att:sl-webm)`,
    `## Audio\n\n![tone.wav](att:sl-wav)`,
    `## YouTube\n\n${URLS.yt}`,
    `## PDF\n\n![handout.pdf](att:sl-pdf)`,
    `## Link card\n\n<${URLS.card}>`,
    `## Wiki link + transclusion\n\n[[Slides lab · snippets]]\n\n![[Slides lab · snippets#Definition]]`,
    `## عربي\n\nشريحة باللغة العربية مع **English** في المنتصف`,
    `## Missing attachment\n\n![gone.png](att:sl-missing)`,
    `<!-- layout: center -->\n## The end\n\nNote: Final notes.`,
  ]);
}

function edgeOneSlide() {
  return deckBody([`# 11 · One-slide deck\n\n- Exactly one slide: Prev and Next are both disabled\n- Counter shows 1 / 1, progress bar is full\n- Overview shows a single thumbnail`]);
}

function edge80() {
  const kinds = [
    (i: number) => `## Slide ${i}: bullets\n\n- Point A of ${i}\n- Point B of ${i}\n- Point C of ${i}`,
    (i: number) => `<!-- layout: center -->\n## Slide ${i}: center`,
    (i: number) => `<!-- layout: two-cols -->\n## Slide ${i}: two columns\n\n::left::\nLeft ${i}\n\n::right::\nRight ${i}`,
    (i: number) => `## Slide ${i}: image\n\n![image ${i}](att:sl-png)`,
    (i: number) => `<!-- layout: stat -->\n## Slide ${i}: stat\n\n**${i * 7} %**\n\nof something`,
    (i: number) => `## Slide ${i}: code\n\n${F}js\nconsole.log(${i});\n${F}`,
    (i: number) => `## Slide ${i}: math\n\n$$x_{${i}} = ${i}^2 = ${i * i}$$`,
    (i: number) => `## Slide ${i}: text\n\nParagraph on slide ${i}.\n\nNote: Notes for slide ${i}.`,
  ];
  const slides = [intro("12 · 80 slides", [
    "80 slides: overview grid scrolls, thumbnail strip scrolls horizontally",
    "Type 4 0 Enter to jump to slide 40, 8 0 Enter to the last, End / Home",
    "Every 10th slide is a section divider",
  ])];
  for (let i = 2; i <= 80; i++) slides.push(i % 10 === 0 ? `<!-- layout: section -->\n## Part ${i / 10}\n\nSlide ${i}` : kinds[i % kinds.length](i));
  return deckBody(slides);
}

function edgeImages() {
  return deckBody([
    intro("13 · Huge & odd images", [
      "4000 × 3000 PNG must fit the slide (contain), not overflow",
      "Very tall (300 × 3000) and very wide (3000 × 200) images",
      "Missing attachment, broken URL, image in a tiny box, zoom on a huge image",
    ]),
    `## 4000 × 3000 attachment\n\n![huge.png 4000×3000](att:sl-png-huge)`,
    `![huge.png without heading](att:sl-png-huge)`,
    `## Very tall image\n\n![tall.png 300×3000](att:sl-png-tall)`,
    `## Very wide image\n\n![wide.png 3000×200](att:sl-png-wide)`,
    `<!-- layout: image-right -->\n## Huge side image\n\n![huge](att:sl-png-huge)\n\nObject-fit cover in the side panel`,
    `<!-- bg: att:sl-png-huge; class: invert; layout: center -->\n## Huge background`,
    `## Tall URL image\n\n![tall picsum](${URLS.imgTall})`,
    `## Missing attachment\n\n![gone.png](att:sl-missing)`,
    `## Broken URL\n\n![broken](https://invalid.example.invalid/nope.png)`,
    `## Empty attachment id\n\n![empty](att:)`,
    `## Tiny box\n\n::: box x=45 y=45 w=5 h=5\n![huge](att:sl-png-huge)\n:::`,
    `## Image + long caption alt\n\n![${"A very long alt text that becomes the caption ".repeat(4).trim()}](att:sl-png)`,
  ]);
}

function edgeText() {
  const wall = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`).join("\n\n");
  return deckBody([
    intro("14 · Very long text & overflow", [
      "Auto-shrink stops at 62 %, then the text slide scrolls (l-text overflow:auto)",
      "40-item list, 270-char word, very long URL, very long heading, long speaker notes",
      "Bullets slide that overflows (no scroll there: check clipping)",
    ]),
    `## Wall of text\n\n${wall}`,
    `## 40 bullets\n\n${Array.from({ length: 40 }, (_, i) => `- Bullet number ${i + 1}`).join("\n")}`,
    `## ${"Very long heading that keeps going ".repeat(6).trim()}\n\nShort body`,
    `# ${"Enormous title slide text ".repeat(5).trim()}`,
    `## Long word\n\n${"Supercalifragilistic".repeat(14)}`,
    `## Long URL\n\nhttps://example.com/${"very-long-path-segment/".repeat(15)}end?query=${"x".repeat(80)}`,
    `<!-- layout: center -->\n## Center overflow\n\n${wall.slice(0, 900)}`,
    `<!-- layout: cards -->\n## Cards overflow\n\n::1::\n${wall.slice(0, 600)}\n\n::2::\n${wall.slice(0, 600)}\n\n::3::\n${wall.slice(0, 600)}`,
    `## Long speaker notes\n\nSee presenter view (P).\n\nNote: ${wall}`,
    `## Emoji\n\n👩‍👩‍👧‍👦 🇸🇦 🇬🇧 🧠✨ — ZWJ sequences and flags`,
  ]);
}

function edgeEmpty() {
  // Raw body: empty chunks between separators are dropped by slideChunks().
  return `---\ntype: slides\ntags: [slides-lab]\n---\n# 15 · Empty & odd slides\n\n- Consecutive \`---\` lines (empty slides) are skipped\n- A slide with only a directive comment, only notes, only whitespace\n- Separator with trailing spaces, \`***\` (not a separator)\n\n---\n\n---\n\n\n---\n\n## After two empty separators\n\nThe empty chunks above should not appear.\n\n---\n\n<!-- layout: center -->\n\n---\n\nNote: A slide that is only speaker notes\n\n---   \n\n## Separator with trailing spaces above\n\n***\n\nThe *** above is a horizontal rule, not a separator.\n\n---\n\n<!-- just a comment without a colon -->\n\n## Comment without a colon\n\n---\n\n   \n\n---\n\n## Last real slide\n`;
}

function docNote() {
  return `---\ntype: lesson\ntags: [slides-lab]\nsubtitle: Auto layout from a normal lesson\n---\n# 16 · Doc → deck (auto layout)\n\nThis lesson has no slide separators. Open Slides: it is laid out automatically, and the bar shows "Auto layout · Save as deck".\n\n## Why spaced repetition\n\nReviewing just before you forget strengthens memory. This paragraph is intentionally long so that it is trimmed to its first sentence on the slide and the full text moves to the speaker notes, which you can see in presenter view. More words follow here to pass the forty-word threshold used by the deck builder.\n\n## Two ideas\n\n### Spacing\nSpread reviews out.\n\n### Retrieval\nTest yourself.\n\n## Four habits\n\n### Read\nA chapter a day.\n\n### Write\nA summary.\n\n### Quiz\nFlashcards.\n\n### Teach\nExplain it.\n\n## Numbers\n\n**94 %** retention after 30 days\n\n**3×** fewer reviews\n\n## A quote\n\n> Memory is the residue of thought.\n\n## The diagram\n\n${F}mermaid\nflowchart LR\n  Learn --> Review --> Remember\n${F}\n\n## With an image\n\n![chart](att:sl-png)\n\nThe image and this text become an image-left / image-right slide.\n\n## Long list\n\n${Array.from({ length: 14 }, (_, i) => `- Habit ${i + 1}: something worth doing`).join("\n")}\n\n## Big table\n\n| Day | Cards |\n|---|---|\n${Array.from({ length: 14 }, (_, i) => `| ${i + 1} | ${10 + i * 3} |`).join("\n")}\n\n## Short\n\nOne short line.\n`;
}

function implicitDeck() {
  // type: note, but 3+ `---` chunks → shown as written (isWrittenDeck).
  return `# 17 · Implicit deck (type note)\n\n- This is a plain note (type note) with \`---\` separators\n- With 3+ chunks it is shown as written, not auto laid out\n\n---\n\n## Second\n\nText\n\n---\n\n## Third\n\nText\n`;
}

const SNIPPETS = `# Slides lab · snippets\n\nA normal note used by wiki links and \`![[…]]\` transclusion in the decks.\n\n## Definition\n\nA **slide deck** is Markdown with \`---\` between slides.\n\n## Other section\n\nNot included when only "Definition" is transcluded.\n`;

// ------------------------------------------------------------------ round 4 design samples (Lumen 17)
/** R4-17A/C/D: the design's 12-slide deck, one slide per layout (title, default, section · accent, two-cols, …). */
function r4Deck() {
  return deckBody([
    `<!-- layout: title -->\nStudy group · week 6\n\n# Backprop, from one neuron up\n\nAmir Hakim · Night Shift Notes\n\nNote: Open with the one-neuron picture; ask who has seen the chain rule.`,
    `<!-- layout: default -->\n## The chain rule\n\n- Forward: $z = wx + b$, $a = \\sigma(z)$\n- Backward: multiply the local gradients\n- Each node only needs its local gradient\n- Cache activations — you'll need them\n- The same rule repeats at every layer\n\nNote: Keep it to one neuron first.`,
    `<!-- layout: section; _class: accent -->\n## Part 2 · Neural networks\n\nTwo layers, same rule`,
    `<!-- layout: two-cols -->\n## Sigmoid vs ReLU\n\n::left::\n### Sigmoid\n\n- Smooth, 0 to 1\n- Saturates: gradients vanish\n- Fine for outputs\n\n::right::\n### ReLU\n\n- max(0, z)\n- Cheap and sparse\n- Dead units if η is too big\n\nNote: Ask the group: what if η were ten times bigger? Then show the divergence plot.`,
    `<!-- layout: image-right -->\n## Loss curve\n\n![Loss curve](att:sl-png)\n\n- Falls fast, then flattens\n- Spikes mean η is too big\n- Plateaus: try a schedule`,
    `<!-- layout: cards -->\n## Three steps\n\n::1::\n### Forward\n\nCompute and cache every activation.\n\n::2::\n### Backward\n\nMultiply local gradients from the loss back.\n\n::3::\n### Update\n\nw ← w − η · ∂L/∂w`,
    `<!-- layout: stat -->\n## Accuracy after one epoch\n\n**93.4%**\n\non the held-out set`,
    `<!-- layout: quote -->\n> Backprop is just the chain rule, organised.\n\n— study group, week 6`,
    `<!-- layout: full -->\n## Week 6 · study group\n\n![Study group](att:sl-png-photo)`,
    `<!-- layout: default -->\n## Recap\n\n- Chain rule, one neuron\n- Same rule per layer\n- Cache, multiply, update`,
    `<!-- layout: center -->\n## Cache every activation\n\nYou will need it going back.`,
    `<!-- layout: blank -->`,
  ]);
}
/** R4-17B / E / F: a lesson to turn into a deck and to read in Focus (highlighter, read aloud, outline). */
function r4Lesson() {
  return `---\ntype: lesson\ntags: [slides-lab, nn]\n---\n# Backprop, by hand\n\nBackpropagation is the chain rule applied from the loss back to every weight. Each node only needs its local gradient and the gradient arriving from above.\n\n## Local gradients\n\nCache every activation on the forward pass — you will need it going back. The local gradient of a node is the derivative of its output with respect to each input.\n\n### One neuron\n\nFor one neuron, z = wx + b and a = σ(z). The gradient for w is the gradient arriving from above times σ'(z) times x.\n\n- Forward: compute z, then a\n- Backward: multiply the local gradients\n- Update: w ← w − η · ∂L/∂w\n\n### Two layers\n\nFor a two-layer network the same rule repeats at each layer. The gradient for the first weights passes through the second layer's local gradient first.\n\n## In code\n\nIn code, it's three lines per layer: the forward pass, the backward pass, and the update.\n\n${F}python\nz = w * x + b\na = sigmoid(z)\ndw = upstream * a * (1 - a) * x\n${F}\n\n## Sigmoid vs ReLU\n\n### Sigmoid\n\nSmooth between 0 and 1, but its gradient vanishes for large inputs.\n\n### ReLU\n\nCheap and sparse; units can die when the learning rate is too big.\n\n## Results\n\n93.4% accuracy after one epoch on the held-out set.\n\n## Takeaway\n\n> Backprop is just the chain rule, organised.\n`;
}
const R4_DIAGRAM = "flowchart LR\n  x[Input x] --> f[Forward]\n  f --> L((Loss))\n  L --> b[Backward]\n  b --> u[Update w]\n  u -. next batch .-> f\n";

// ------------------------------------------------------------------ seed
export async function seedSlides(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(space({ id: SP, name: "Slides lab", kind: "resource", icon: "glyph:slides", color: "#E8893A", description: "Dummy decks for every Slides capability (dev simulator)." }));
  v.folders.push(
    folder({ id: "sl-f-cap", spaceId: SP, name: "Capabilities", sort: 1 }),
    folder({ id: "sl-f-edge", spaceId: SP, name: "Edge cases", sort: 2 }),
  );
  const decks: { id: string; title: string; body: string; folder?: string; type?: "slides" | "lesson" | "note" }[] = [
    { id: "sl-kitchen", title: "00 · Kitchen sink", body: kitchenSinkDeck() },
    { id: "sl-basics", title: "01 · Basics & navigation", body: basicsDeck(), folder: "sl-f-cap" },
    { id: "sl-layouts", title: "02 · Layout directives", body: layoutsDeck(), folder: "sl-f-cap" },
    { id: "sl-classes", title: "03 · Classes, alignment & backgrounds", body: classesDeck(), folder: "sl-f-cap" },
    { id: "sl-fm", title: "04 · Front-matter defaults", body: frontMatterDeck(), folder: "sl-f-cap" },
    { id: "sl-boxes", title: "05 · Free placement boxes & Arrange", body: boxesDeck(), folder: "sl-f-cap" },
    { id: "sl-code", title: "06 · Code & math", body: codeMathDeck(), folder: "sl-f-cap" },
    { id: "sl-mermaid", title: "07 · Mermaid diagrams", body: diagramsDeck(), folder: "sl-f-cap" },
    { id: "sl-blocks", title: "08 · Markdown blocks on slides", body: blocksDeck(), folder: "sl-f-cap" },
    { id: "sl-media", title: "09 · Images, video, audio, PDF, links", body: mediaDeck(), folder: "sl-f-cap" },
    { id: "sl-mixed", title: "10 · Mixed media", body: mixedMediaDeck(), folder: "sl-f-cap" },
    { id: "sl-rtl", title: "٠١ · عرض باللغة العربية", body: rtlDeck(), folder: "sl-f-cap" },
    { id: "sl-one", title: "11 · One-slide deck", body: edgeOneSlide(), folder: "sl-f-edge" },
    { id: "sl-80", title: "12 · 80 slides", body: edge80(), folder: "sl-f-edge" },
    { id: "sl-images", title: "13 · Huge & odd images", body: edgeImages(), folder: "sl-f-edge" },
    { id: "sl-text", title: "14 · Very long text & overflow", body: edgeText(), folder: "sl-f-edge" },
    { id: "sl-empty", title: "15 · Empty & odd slides", body: edgeEmpty(), folder: "sl-f-edge" },
    { id: "sl-doc", title: "16 · Doc → deck (auto layout)", body: docNote(), type: "lesson" },
    { id: "sl-implicit", title: "17 · Implicit deck (type note)", body: implicitDeck(), type: "note", folder: "sl-f-edge" },
    { id: "sl-r4-deck", title: "Backprop for the study group", body: r4Deck() },
    { id: "sl-r4-doc", title: "Backprop, by hand", body: r4Lesson(), type: "lesson" },
  ];
  decks.forEach((d, k) => v.notes.push(note({ id: d.id, title: d.title, space: SP, folder: d.folder ?? null, type: d.type ?? "slides", body: d.body, updated: c.ago(10 + k * 7), pinned: d.id === "sl-kitchen" ? 1 : 0 })));
  v.notes.push(
    note({ id: "sl-snippets", title: "Slides lab · snippets", space: SP, body: SNIPPETS, updated: c.ago(300) }),
    note({ id: "sl-r4-diagram", title: "Training loop", space: SP, type: "diagram", body: R4_DIAGRAM, tags: ["diagram"], updated: c.ago(4) }),
    note({
      id: "sl-start", title: "Slides lab · start here", space: SP, pinned: 1, updated: c.ago(1),
      text: "Every note here is a dummy deck for one Slides capability. Open a deck, then **Slides** (or More › Present as slides). The first slide of each deck lists what to check.\n\n"
        + decks.map((d) => `- [[${d.title}]]`).join("\n")
        + "\n\nPhone remote needs a signed-in Worker (in demo mode the popover shows the sign-in message). The audience window (presenter view › Audience window) works locally.\n",
    }),
  );
  // Real attachment bytes (ids referenced as att:sl-… in the decks; att:sl-missing intentionally has none).
  addFile(v, "sl-png", "chart.png", await pngBlob(960, 540, "#1D222B", "chart.png · slides lab"));
  addFile(v, "sl-png-photo", "photo.png", await pngBlob(1600, 1000, "#24476B", "photo.png 1600×1000"));
  addFile(v, "sl-png-huge", "huge.png", await pngBlob(4000, 3000, "#3B2A4A", "huge.png 4000×3000"));
  addFile(v, "sl-png-tall", "tall.png", await pngBlob(300, 3000, "#2A4A3B", "tall"));
  addFile(v, "sl-png-wide", "wide.png", await pngBlob(3000, 200, "#4A3B2A", "wide.png 3000×200"));
  addFile(v, "sl-svg", "diagram.svg", svgBlob(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0f172a"/><circle cx="220" cy="225" r="140" fill="#F2A93B"/><rect x="420" y="110" width="260" height="230" rx="24" fill="#39C5CF"/><text x="400" y="420" fill="#fff" font-size="32" text-anchor="middle" font-family="sans-serif">diagram.svg</text></svg>`));
  addFile(v, "sl-wav", "tone.wav", wavBlob(2, 523));
  addFile(v, "sl-pdf", "handout.pdf", pdfBlob("Slides lab handout"));
  addFile(v, "sl-csv", "grades.csv", new Blob(["name,grade\nAmir,A\nSara,B+\n"], { type: "text/csv" }));
  addFile(v, "sl-webm", "clip.webm", await webmBlob(2));
  return v;
}

/** Note ids of every deck (used by browser checks). */
export const SLIDES_LAB_DECKS = ["sl-kitchen", "sl-basics", "sl-layouts", "sl-classes", "sl-fm", "sl-boxes", "sl-code", "sl-mermaid", "sl-blocks", "sl-media", "sl-mixed", "sl-rtl", "sl-one", "sl-80", "sl-images", "sl-text", "sl-empty", "sl-doc", "sl-implicit", "sl-r4-deck", "sl-r4-doc"];
