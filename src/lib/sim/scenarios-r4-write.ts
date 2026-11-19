// Dev simulator, round 4 · "Write, present & share": demo data for the editor ("/" menu, insert gallery, blocks,
// block refs + embeds, paste menu), Read (page widths, layout blocks, tables, includes, status pills, toc, callouts),
// Focus Read/Write, slides (one deck per layout, Arrange, doc → deck), the project hub, sharing + public pages + blog,
// navigation, icons / empty states / moments / favicon badge, and Arabic content.
// Add-only: returns a Vault without the Inbox and never clears anything itself, so "Everything (round 4)" can merge
// it with the other builders. Every id starts with `r4w-`. Checklist: docs/DEV_SIMULATOR.md › "Write, present & share".
import { SLASH } from "../slash";
import { addFile, cardsFor, clock, emptyVault, folder, note, pdfBlob, pngBlob, session, space, svgBlob, version, wavBlob, type Vault } from "./kit";

const F = "```";
const W = "r4w-s-write", SL = "r4w-s-talks", SH = "r4w-s-shared", BL = "r4w-s-blog", AR = "r4w-s-ar", PJ = "r4w-s-proj", IC = "r4w-s-icons", EM = "r4w-s-empty";
const SRC = "Chain rule (source)";

/** Sample text for each "/" block (what the block looks like once something is typed into it). */
const SAMPLE: Record<string, string> = {
  text: "A plain paragraph written with the Text block.", h1: "Heading 1 block", h2: "Heading 2 block", h3: "Heading 3 block",
  bullet: "Bulleted item", numbered: "Numbered item", todo: "Task from the / menu", quote: "A quote block.", code: "loss = (y - y_hat) ** 2",
  "math-block": "\\frac{\\partial L}{\\partial w} = \\delta \\cdot x", table: "", highlight: "highlighted text", footnote: " with a footnote",
  "embed-note": SRC, include: "", link: "", "block-ref": "", tag: "writing", flashcard: "", "math-inline": "x^2",
  youtube: "aircAruvnKk", linkcard: "en.wikipedia.org/wiki/Backpropagation", status: "", query: "r4w", "details-props": "draft",
  mermaid: "", toc: "",
};
const OVERRIDE: Record<string, string> = {
  include: `![[${SRC}#Local gradients]]\n`,
  link: `[[${SRC}]]`,
  "block-ref": `[[${SRC}#^chain-def]]`,
  flashcard: "What does the / menu insert for Flashcard? :: A Question :: Answer line.",
  status: ":status[In progress] :status[Approved]{green} :status[Blocked]{red}",
  file: "![chart.png](att:r4w-png)",
  voice: "![lecture-07.wav](att:r4w-wav)",
  "details-props": "Page properties live in the front-matter at the top of a note (status, tags, width…).",
};

/** One section per "/" group with every block of the catalog, rendered the way it looks after typing into it. */
function slashGallery(): string {
  const groups: string[] = [];
  const out: string[] = [];
  for (const cmd of SLASH) {
    if (!groups.includes(cmd.group)) { groups.push(cmd.group); out.push(`\n## ${cmd.group}\n`); }
    let md = OVERRIDE[cmd.id];
    if (md === undefined) {
      let t = "";
      try { t = typeof cmd.text === "function" ? cmd.text() : cmd.text; } catch { t = ""; }
      md = t.split("$0").join(SAMPLE[cmd.id] ?? `${cmd.label} sample`);
    }
    out.push(`### ${cmd.label}\n\n\`/${cmd.id}\` · ${cmd.hint}\n\n${md.trim()}\n`);
  }
  return out.join("\n");
}

/** The Read showcase: every Read block, in the order the round-4 ReadDoc artboards show them. */
const SHOWCASE = (iso: (n: number) => string) => `---
type: lesson
status: learning
tags: [r4w, read]
---
# Read mode showcase

:status[In review] :status[Draft]{grey} :status[Approved]{green} :status[At risk]{amber} :status[Blocked]{red} :status[Idea]{violet} :status[Shipped]{blue} · updated ${iso(-1)}

Every block the reader knows, on one page. Switch **Fixed / Wide / Full** with ↔ in the header; the two notes "Read · wide page" and "Read · full page" store \`width:\` in their front-matter.

[[toc]]

## Columns

::: columns
::: column
### Forward pass
Compute $z = wx + b$ and cache every activation. ^fwd
:::
::: column
### Backward pass
Multiply the local gradients from the loss back to every weight.
:::
:::

::: columns
::: column 30%
**Sidebar** (30%)

- Inputs
- Weights
- Loss
:::
::: column
**Main** column: the sidebar keeps its width, the main column takes the rest. On a phone both stack.
:::
:::

::: columns cards
::: column
#### Forward
Cache activations.
:::
::: column
#### Backward
Multiply local gradients.
:::
::: column
#### Update
w ← w − η · ∂L/∂w
:::
:::

::: columns divided
::: column 240px
Fixed 240 px column, divided.
:::
::: column
Fluid column. Three and four columns come from the "/" menu (Layout).
:::
:::

## Tabs

::: tabs
## Python
${F}python
dw = upstream * a * (1 - a) * x
${F}

## JavaScript
${F}js
const dw = upstream * a * (1 - a) * x;
${F}

## Maths
$$\\frac{\\partial L}{\\partial w} = \\delta \\cdot \\sigma'(z) \\cdot x$$
:::

## Expand

::: expand Why cache activations?
Because the backward pass needs every forward value: recomputing them would double the work.
:::

## Panels and callouts

::: info Info panel
Blue panel with the info glyph.
:::

::: note Note panel
Grey panel.
:::

::: tip Tip panel
Green tip.
:::

::: success Success
Training converged in 12 epochs.
:::

::: warning Warning
The learning rate is close to diverging.
:::

::: danger Danger
Never test on the training set.
:::

> [!note] One-line callout
> A callout with one short paragraph reads as one line.

> [!tip] Tip callout
> Cache activations on the forward pass.

> [!question] Question
> What happens if η is ten times bigger?

> [!example] Example
> z = 2·3 + 1 = 7

> [!quote] Quote
> Backprop is just the chain rule, organised.

> [!abstract] Summary
> Forward, backward, update.

> [!warning]- Folded callout (click to open)
> Hidden until opened.

## Wide, full, aside, center

::: aside
An **aside** sits beside the text in a muted box.
:::

The paragraph next to the aside keeps its normal measure. Asides are for margin notes, definitions and sources.

::: center
**Centred:** $E = mc^2$
:::

::: wide
| Layer | Input | Output | Params | Activation | Init | Dropout | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dense 1 | 784 | 256 | 200,960 | ReLU | He | 0.2 | wide block breaks out of the text column |
| Dense 2 | 256 | 128 | 32,896 | ReLU | He | 0.2 | |
| Output | 128 | 10 | 1,290 | Softmax | Xavier | 0 | |
:::

::: full
![Full-width image](att:r4w-png-wide)
:::

## Tables

| Optimizer | Learning rate | Epochs | Accuracy |
| --- | ---: | ---: | ---: |
| SGD | 0.1 | 30 | 91.2% |
| Momentum | 0.05 | 20 | 93.0% |
| Adam | 0.001 | 12 | 93.4% |
| RMSprop | 0.001 | 15 | 92.7% |
Table: Optimizers on MNIST

| # | Run | Optimizer | Batch | LR | Epoch | Train loss | Val loss | Train acc | Val acc | Time | Notes |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${Array.from({ length: 24 }, (_, i) => `| ${i + 1} | run-${String(i + 1).padStart(2, "0")} | ${["SGD", "Adam", "RMSprop", "Momentum"][i % 4]} | ${[32, 64, 128][i % 3]} | ${[0.1, 0.01, 0.001][i % 3]} | ${i % 12 + 1} | ${(1.2 - i * 0.04).toFixed(2)} | ${(1.3 - i * 0.035).toFixed(2)} | ${(70 + i).toFixed(1)}% | ${(68 + i * 0.9).toFixed(1)}% | ${3 + (i % 5)}m | ${i === 3 ? "spike at epoch 4" : ""} |`).join("\n")}
{.wide .compact}
Table: 24 training runs (filter, sort, full screen, sticky first column)

| Term | العربية |
| --- | --- |
| Gradient | التدرج |
| Loss | الخسارة |
{.plain}

## Includes

A whole section of another note, kept in sync (dashed frame, source chip, **Go to source →**):

![[${SRC}#Local gradients]]

One block by its id:

![[${SRC}#^cache-tip]]

## Block references

Links to one block: [[${SRC}#^chain-def]] · [[${SRC}#^cache-tip|the caching tip]] · a heading: [[${SRC}#Two layers]].

This paragraph has its own id so other notes can link to it. ^showcase-para

## Highlights and footnotes

Reading highlights are plain Markdown: ==yellow==, ==green=={.hl-green}, ==blue=={.hl-blue}, ==pink=={.hl-pink}, ==purple=={.hl-purple} and one with a comment ==the chain rule==[^hl-1].

[^hl-1]: Comment saved by the Focus highlighter.

## Media

<https://en.wikipedia.org/wiki/Backpropagation>

![diagram.svg](att:r4w-svg)

${F}mermaid
flowchart LR
  x[Input] --> f[Forward] --> L((Loss)) --> b[Backward] --> u[Update]
${F}

## Arabic

### الانتشار العكسي

الانتشار العكسي هو تطبيق قاعدة السلسلة من الخسارة رجوعاً إلى كل وزن. Mixed with English: the **chain rule** (قاعدة السلسلة).

::: tip نصيحة
احفظ كل التنشيطات في المرور الأمامي.
:::

- [ ] Re-read this page in Focus › Read 📅 ${iso(1)}
- [x] Try every Read block
`;

/** Source note for block refs / includes: blocks with ^ids and headings. */
const SOURCE = `---
type: lesson
status: review
tags: [r4w, nn]
---
# ${SRC}

The chain rule multiplies the local derivatives along the computation graph. ^chain-def

## Local gradients

Each node only needs its local gradient and the gradient arriving from above.

Cache every activation on the forward pass: you will need it going back. ^cache-tip

## Two layers

The same rule repeats at each layer; the first layer's gradient passes through the second layer's local gradient first. ^two-layers

- Forward: compute z, then a ^step-fwd
- Backward: multiply the local gradients
- Update: w ← w − η · ∂L/∂w

## No id yet

A paragraph without an id: pick it in the \`[[${SRC}#^\` autocomplete and Lumen adds one.
`;

const deck = (slides: string[], fm: Record<string, string> = {}) =>
  `---\ntype: slides\ntags: [r4w, slides]\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}\n`).join("")}---\n${slides.map((s) => s.trim()).join("\n\n---\n\n")}\n`;
const intro = (title: string, lines: string[]) => `<!-- layout: title -->\n# ${title}\n\n${lines.join(" · ")}`;

/** One deck per layout (each with variants), so every layout can be checked in present mode, overview and Arrange. */
const LAYOUT_DECKS: { id: string; layout: string; slides: string[] }[] = [
  { id: "title", layout: "title", slides: [
    `<!-- layout: title -->\nStudy group · week 6\n\n# Backprop, from one neuron up\n\nAmir Hakim · Night Shift Notes\n\nNote: Title slide: kicker, title, byline.`,
    `<!-- layout: title; _class: invert -->\n# Inverted title\n\nclass invert`,
    `<!-- layout: title; _class: accent -->\n# Accent title\n\nclass accent`] },
  { id: "section", layout: "section", slides: [
    `<!-- layout: section -->\n## Part 1 · One neuron\n\nThe chain rule`,
    `<!-- layout: section; _class: accent -->\n## Part 2 · Two layers\n\nSame rule, repeated`] },
  { id: "default", layout: "default", slides: [
    `<!-- layout: default -->\n## The chain rule\n\n- Forward: $z = wx + b$\n- Backward: multiply local gradients\n- Cache activations\n\nNote: Default layout: heading + bullets.`,
    `<!-- layout: default -->\n## With code\n\n${F}python\ndw = upstream * a * (1 - a) * x\n${F}`] },
  { id: "center", layout: "center", slides: [`<!-- layout: center -->\n## Cache every activation\n\nYou will need it going back.`, `<!-- layout: center -->\n$$\\frac{\\partial L}{\\partial w} = \\delta x$$`] },
  { id: "two-cols", layout: "two-cols", slides: [
    `<!-- layout: two-cols -->\n## Sigmoid vs ReLU\n\n::left::\n### Sigmoid\n\n- Smooth, 0 to 1\n- Saturates\n\n::right::\n### ReLU\n\n- max(0, z)\n- Cheap, sparse`,
    `<!-- layout: two-cols; split: 35% -->\n## Split 35%\n\n::left::\nNarrow left\n\n::right::\nWide right column with more text in it.`] },
  { id: "image-left", layout: "image-left", slides: [`<!-- layout: image-left -->\n## Loss curve\n\n![Loss curve](att:r4w-png)\n\n- Falls fast\n- Then flattens`, `<!-- layout: image-left; split: 60% -->\n## Bigger image\n\n![Photo](att:r4w-png-photo)\n\nsplit: 60%`] },
  { id: "image-right", layout: "image-right", slides: [`<!-- layout: image-right -->\n## Loss curve\n\n![Loss curve](att:r4w-png)\n\n- Spikes: η too big\n- Plateaus: try a schedule`] },
  { id: "cards", layout: "cards", slides: [
    `<!-- layout: cards -->\n## Three steps\n\n::1::\n### Forward\n\nCompute and cache.\n\n::2::\n### Backward\n\nMultiply local gradients.\n\n::3::\n### Update\n\nw ← w − η · ∂L/∂w`,
    `<!-- layout: cards -->\n## Four from a list\n\n- **SGD**: plain steps\n- **Momentum**: average\n- **RMSprop**: scale\n- **Adam**: both`] },
  { id: "stat", layout: "stat", slides: [`<!-- layout: stat -->\n## Accuracy after one epoch\n\n**93.4%**\n\non the held-out set`, `<!-- layout: stat; _class: invert -->\n## Training time\n\n**12 min**\n\non one GPU`] },
  { id: "quote", layout: "quote", slides: [`<!-- layout: quote -->\n> Backprop is just the chain rule, organised.\n\n— study group, week 6`] },
  { id: "full", layout: "full", slides: [`<!-- layout: full -->\n## Week 6 · study group\n\n![Study group](att:r4w-png-photo)`, `<!-- layout: full -->\n${F}mermaid\nflowchart LR\n  x --> f --> L --> b --> u\n${F}`] },
  { id: "blank", layout: "blank", slides: [`<!-- layout: blank -->`, `<!-- layout: blank -->\n::: box x=30 y=35 w=40 h=30 {.card .center}\nA free box on a blank slide\n:::`] },
];

const ARRANGE = deck([
  intro("Arrange workspace", ["Press A", "drag the rail to reorder", "pick a layout", "Normal / Invert / Accent", "drag boxes, resize with the four corners"]),
  `## Two cards\n\n::: box x=8 y=35 w=38 h=40 {.card}\n### Left card\nDrag me in Arrange (A).\n:::\n\n::: box x=54 y=35 w=38 h=40 {.card .center}\n### Right card\nResize from any corner.\n:::\n\nNote: The ::: box numbers in the note change when you drag.`,
  `## Stacked\n\n::: box x=20 y=30 w=30 h=30 z=1 {.card .center}\nUnder\n:::\n\n::: box x=30 y=40 w=30 h=30 z=3 rotate=-6 {.card .center}\nOver, rotated\n:::`,
  `<!-- layout: image-right -->\n## Image + text\n\n![chart](att:r4w-png)\n\n- Change the layout in Arrange\n- Snap guides are amber`,
]);

const ALL_LAYOUTS = deck(LAYOUT_DECKS.map((d) => d.slides[0]).concat([`<!-- layout: default -->\n## Speaker notes\n\nPress P for the presenter view, O for the overview, a number + Enter to jump, B to black out.\n\nNote: These notes show in the presenter view and on the phone remote.`]));

const DOC_TO_DECK = `---
type: lesson
status: learning
tags: [r4w, slides]
---
# Backprop for beginners (doc → deck)

A lesson with no slide separators. **Slides** opens the preview dialog: split at H1 / H2 / ---, Present without saving, or Save as deck (opens Arrange).

## Why it matters

Every modern network learns with backprop. Without it you'd estimate each gradient numerically, which is far too slow for millions of weights.

## Two ideas

### Local gradients

Each node knows its own derivative.

### Chain rule

Multiply them from the loss back.

## Three steps

- Forward
- Backward
- Update

## Result

93.4% after one epoch.

## Takeaway

> Backprop is just the chain rule, organised.
`;

const RTL_DECK = deck([
  `<!-- layout: title -->\nحلقة دراسية · الأسبوع ٦\n\n# الانتشار العكسي\n\nعرض باللغة العربية`,
  `<!-- layout: two-cols -->\n## Sigmoid مقابل ReLU\n\n::left::\n- ناعمة بين ٠ و١\n- تتشبع\n\n::right::\n- max(0, z)\n- رخيصة`,
  `<!-- layout: quote -->\n> الانتشار العكسي هو قاعدة السلسلة، منظمة.`,
], { dir: "rtl" });

const FOCUS = `---
type: lesson
status: learning
tags: [r4w, focus]
---
# Focus: reading the backprop paper

Open **Focus** (More › Focus, or F) and pick **Read**: a 640 px column, the outline drawer on the left (O), the highlighter bar when you select text (5 colours · Note · Card), and **Read aloud** with the current sentence underlined.

## The idea

The chain rule multiplies local derivatives from the loss back to every weight. Each node only needs the gradient arriving from above and its own local derivative. This makes the backward pass cost about as much as the forward pass.

## Why it is fast

Caching activations means nothing is computed twice. In a network with millions of weights, numerical gradients would need millions of forward passes; backprop needs one forward and one backward pass.

## A worked example

For one neuron, z = wx + b and a = σ(z). With x = 2, w = 0.5 and b = 0, z = 1 and a ≈ 0.73. The gradient for w is the upstream gradient times σ'(z) times x.

## Already highlighted

Highlights saved from Focus are Markdown: ==the chain rule== and ==caching activations=={.hl-green} and ==numerical gradients are slow=={.hl-pink}[^n1].

[^n1]: Saved with a comment from the highlighter.

## In Arabic

الانتشار العكسي يضرب المشتقات المحلية من الخسارة رجوعاً. اقرأ هذه الفقرة بصوت عالٍ لتجربة الصوت العربي.

## Write mode

Focus › **Write** hides everything but the text and keeps the current line in the middle (typewriter).
`;

const EDITOR_PLAY = `---
tags: [r4w, editor]
---
# Editor playground

Type **/** at the start of a line (or after a space) for the block menu: Basic · Layout · Panels & callouts · Media & embeds · Knowledge · Advanced, a **Recent** group after you've used some, and "No block called …" with a suggestion for an unknown word (try \`/kanban\`). On a phone it opens as a bottom sheet. Type \`//\` for today's date.

Hover a block for the ⋮⋮ handle: drag to move (accent drop line), click for the menu (**Turn into**, Duplicate, Copy link to block, Move up / down, Delete). Shift-click or long-press several blocks to multi-select.

## Blocks to move

First paragraph. Drag me below the third one.

Second paragraph. Turn me into a heading.

Third paragraph. Turn me into a callout.

- A list item
- Another list item

> A quote to turn into a toggle.

## Block references

Type \`[[${SRC}#^\` here to get the block autocomplete:

[[${SRC}#^chain-def]]

![[${SRC}#^two-layers]]

## Paste menu

Copy the long paragraph below and paste it back: the paste menu offers **Keep · Clean up formatting · As quote · As link card · Summarize · Make flashcards**. Paste a link alone on a line (e.g. https://distill.pub/2017/momentum/) for **Preview card · Embed · Plain link**.

Backpropagation, short for backward propagation of errors, is an algorithm for supervised learning of artificial neural networks using gradient descent. Given an artificial neural network and an error function, the method calculates the gradient of the error function with respect to the network's weights. See https://en.wikipedia.org/wiki/Backpropagation for the history.

## Insert gallery

Note ⋯ › Insert… (or "Insert gallery…" at the bottom of the / menu): 15 layouts in three rows with a hover preview.

## Arabic block

هذه فقرة عربية: مقبض الكتلة يظهر على اليمين.
`;

const POSTS: { id: string; title: string; slug: string; ago: number; tags: string[]; ex: string; body: string }[] = [
  { id: "r4w-post-1", title: "Backprop, explained with one neuron", slug: "backprop-one-neuron", ago: 3, tags: ["ml", "backprop"], ex: "The chain rule, organised: one neuron, three lines of code.",
    body: `The chain rule, organised.\n\n![chart](att:r4w-png)\n\n## One neuron\n\n$$\\frac{\\partial L}{\\partial w} = \\delta \\cdot x$$\n\n${F}python\ndw = upstream * a * (1 - a) * x\n${F}\n\n> [!tip] Cache activations\n> You will need them going back.\n` },
  { id: "r4w-post-2", title: "What I learned teaching a study group", slug: "teaching-study-group", ago: 10, tags: ["learning", "meta"], ex: "Six weeks of explaining backprop to friends.",
    body: "Six weeks of explaining backprop to friends taught me more than reading about it.\n\n::: columns\n::: column\n### Worked\n- Drawing the graph\n- One neuron first\n:::\n::: column\n### Didn't\n- Starting with matrices\n:::\n:::\n" },
  { id: "r4w-post-ar", title: "الانتشار العكسي ببساطة", slug: "backprop-arabic", ago: 17, tags: ["عربي", "ml"], ex: "قاعدة السلسلة، منظمة: شرح مبسط.",
    body: "الانتشار العكسي هو تطبيق قاعدة السلسلة من الخسارة رجوعاً إلى كل وزن.\n\n## الخطوات\n\n1. المرور الأمامي\n2. المرور الخلفي\n3. التحديث\n" },
];

export async function seedR4Write(v: Vault = emptyVault()): Promise<Vault> {
  const c = clock();
  // (adds to v)
  const n = (p: Parameters<typeof note>[0]) => { const x = note({ ...p }); v.notes.push(x); return x; };

  // ------------------------------------------------------------ spaces (icon system: glyphs, shapes, initials, colours)
  v.spaces.push(
    space({ id: W, name: "Writing studio", kind: "resource", icon: "glyph:text", color: "#F2A93B", sort: 41, description: "Editor, Read and Focus samples (round 4)." }),
    space({ id: SL, name: "Talks & decks", kind: "resource", icon: "glyph:slides", color: "#E8893A", sort: 42, description: "One deck per slide layout, Arrange, doc → deck." }),
    space({ id: SH, name: "Deep Learning notes (shared)", kind: "course", icon: "glyph:neural", color: "#A371F7", sort: 43, shareId: "r4wShCourse", roadmapId: "r4w-rm", description: "A course shared with an unlisted link.",
      props: { provider: "Study group", url: "https://cs231n.stanford.edu/", target: c.iso(30), secret: "never in a share" } }),
    space({ id: BL, name: "Blog", kind: "area", icon: "glyph:post", color: "#57AB5A", sort: 44, description: "Published posts and drafts." }),
    space({ id: AR, name: "ملاحظات عربية", kind: "area", icon: "initials:عر", color: "#39C5CF", sort: 45, description: "محتوى عربي لاختبار الاتجاه." }),
    space({ id: PJ, name: "Lumen Reader (project)", kind: "project", icon: "glyph:code", color: "#E5534B", sort: 46, description: "Project hub sample: docs in every state, a board with every card marker, requirements, links.",
      props: { goal: "Ship the reader to the study group by the end of the month", deadline: c.iso(12), links: JSON.stringify([
        { label: "Repo · lumen-reader", url: "https://github.com/example/lumen-reader" },
        { label: "PR #12 · read aloud", url: "https://github.com/example/lumen-reader/pull/12" },
        { label: "Figma · reader", url: "https://www.figma.com/file/example-reader" },
      ]) } }),
    space({ id: IC, name: "Icons: shape + initials", kind: "area", icon: "glyph:shape-hex", color: "#E3B341", sort: 47, description: "Space icon picker: glyph, shape, initials (try Change icon…)." }),
    space({ id: "r4w-s-qa", name: "QA initials", kind: "resource", icon: "initials:QA", color: "#7AA2F7", sort: 48 }),
    space({ id: EM, name: "Empty course", kind: "course", icon: "glyph:course", color: "#B48EF0", sort: 49, description: "No roadmap and no notes: shows the empty states." }),
  );
  v.folders.push(
    folder({ id: "r4w-f-read", spaceId: W, name: "Read", sort: 1, color: "4" }),
    folder({ id: "r4w-f-edit", spaceId: W, name: "Editor", sort: 2, color: "2" }),
    folder({ id: "r4w-f-layouts", spaceId: SL, name: "One deck per layout", sort: 1 }),
    folder({ id: "r4w-f-posts", spaceId: BL, name: "Posts", sort: 1 }),
    folder({ id: "r4w-f-drafts", spaceId: BL, name: "Drafts", sort: 2 }),
    folder({ id: "r4w-f-empty", spaceId: W, name: "Empty folder", sort: 3 }),
  );

  // ------------------------------------------------------------ Writing studio
  const show = n({ id: "r4w-showcase", title: "Read mode showcase", space: W, folder: "r4w-f-read", body: SHOWCASE(c.iso), updated: c.ago(2), pinned: 1, favorite: 1 });
  n({ id: "r4w-source", title: SRC, space: W, folder: "r4w-f-read", body: SOURCE, updated: c.ago(30) });
  n({ id: "r4w-slash", title: "Every / block", space: W, folder: "r4w-f-edit", type: "lesson", tags: ["r4w", "editor"], updated: c.ago(6),
    text: `Each heading is one entry of the "/" menu (${SLASH.length} blocks), rendered the way it looks once you type into it. The line under each heading names the command id and its hint.\n${slashGallery()}` });
  n({ id: "r4w-editor", title: "Editor playground", space: W, folder: "r4w-f-edit", body: EDITOR_PLAY, updated: c.ago(4), pinned: 1 });
  n({ id: "r4w-focus", title: "Focus: reading the backprop paper", space: W, body: FOCUS, updated: c.ago(12) });
  n({ id: "r4w-wide", title: "Read · wide page", space: W, folder: "r4w-f-read", fm: { width: "wide" }, tags: ["r4w"], updated: c.ago(40),
    text: `Front-matter \`width: wide\` (920 px).\n\n${"Wide pages suit tables and diagrams. ".repeat(12)}\n\n| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n` });
  n({ id: "r4w-full", title: "Read · full page", space: W, folder: "r4w-f-read", fm: { width: "full" }, tags: ["r4w"], updated: c.ago(41),
    text: `Front-matter \`width: full\` (pane minus 72 px each side).\n\n${"Full width uses the whole pane. ".repeat(14)}\n\n![wide](att:r4w-png-wide)\n` });
  n({ id: "r4w-embeds", title: "Block refs & embeds across notes", space: W, folder: "r4w-f-read", tags: ["r4w"], updated: c.ago(8),
    text: `Links and embeds pointing at blocks of other notes.\n\n- Block link: [[${SRC}#^chain-def]]\n- Block link with alias: [[${SRC}#^cache-tip|cache tip]]\n- Heading link: [[${SRC}#Two layers]]\n- Block of the showcase: [[Read mode showcase#^showcase-para]]\n- Missing block: [[${SRC}#^does-not-exist]]\n\n## Embedded block\n\n![[${SRC}#^two-layers]]\n\n## Embedded section\n\n![[${SRC}#Local gradients]]\n\n## Embedded note\n\n![[${SRC}]]\n\n## Nested include (3 levels, no loops)\n\n![[Read mode showcase#Includes]]\n` });
  n({ id: "r4w-ar-note", title: "ملاحظة: الانتشار العكسي", space: AR, type: "lesson", status: "learning", tags: ["r4w", "عربي"], updated: c.ago(25),
    text: `[[toc]]\n\n## المقدمة\n\nالانتشار العكسي هو قاعدة السلسلة. ^ar-def\n\n## الأعمدة\n\n::: columns\n::: column\n### الأمامي\nاحسب التنشيطات.\n:::\n::: column\n### الخلفي\nاضرب المشتقات.\n:::\n:::\n\n::: warning تحذير\nمعدل التعلم كبير جداً.\n:::\n\n| المصطلح | English |\n| --- | --- |\n| التدرج | Gradient |\n| الخسارة | Loss |\n\n:status[قيد المراجعة]{amber}\n\nما هي قاعدة السلسلة؟ :: ضرب المشتقات المحلية.\n` });
  n({ id: "r4w-ar-mixed", title: "Mixed: English + العربية", space: AR, tags: ["r4w"], updated: c.ago(26),
    text: `English paragraph first.\n\nفقرة عربية ثانية مع **كلمة English** في الوسط.\n\n- English item\n- عنصر عربي\n\n![[ملاحظة: الانتشار العكسي#^ar-def]]\n` });

  // ------------------------------------------------------------ Talks & decks
  LAYOUT_DECKS.forEach((d, i) => n({ id: `r4w-deck-${d.id}`, title: `Layout · ${d.layout}`, space: SL, folder: "r4w-f-layouts", type: "slides", body: deck([intro(`Layout · ${d.layout}`, [`<!-- layout: ${d.layout} -->`, `${d.slides.length} variant${d.slides.length === 1 ? "" : "s"}`]), ...d.slides]), updated: c.ago(60 + i) }));
  n({ id: "r4w-deck-all", title: "Every layout in one deck", space: SL, type: "slides", body: ALL_LAYOUTS, updated: c.ago(3), pinned: 1 });
  n({ id: "r4w-deck-arrange", title: "Arrange workspace", space: SL, type: "slides", body: ARRANGE, updated: c.ago(9) });
  n({ id: "r4w-doc-deck", title: "Backprop for beginners (doc → deck)", space: SL, type: "lesson", body: DOC_TO_DECK, updated: c.ago(14) });
  n({ id: "r4w-deck-rtl", title: "عرض: الانتشار العكسي", space: SL, type: "slides", body: RTL_DECK, updated: c.ago(20) });

  // ------------------------------------------------------------ shared course (public page) + roadmap
  n({ id: "r4w-rm", title: "Deep Learning roadmap", space: SH, type: "roadmap", updated: c.ago(90),
    body: `# Deep Learning\n\n## Basics 📅 ${c.iso(-3)}\n- [x] Chain rule → [[${"Shared lesson: chain rule"}]]\n- [/] Backprop (needs: Chain rule) 📅 ${c.iso(2)}\n\n## Networks 📅 ${c.iso(14)}\n- [ ] Two layers (needs: Backprop)\n- [ ] Optimizers (needs: Two layers)\n` });
  n({ id: "r4w-sh-lesson", title: "Shared lesson: chain rule", space: SH, type: "lesson", status: "learning", shareId: "r4wShNote1", updated: c.ago(35),
    text: "Shared with an unlisted link (`/s/r4wShNote1`).\n\n$$\\frac{dz}{dx} = \\frac{dz}{dy}\\frac{dy}{dx}$$\n\n::: tip\nVisitors can read but never write.\n:::\n\nWhat does the chain rule multiply? :: Local derivatives.\n" });
  n({ id: "r4w-sh-deck", title: "Shared deck: three steps", space: SH, type: "slides", shareId: "r4wShDeck1", body: deck([LAYOUT_DECKS[0].slides[0], LAYOUT_DECKS[7].slides[0], LAYOUT_DECKS[8].slides[0]]), updated: c.ago(50) });
  n({ id: "r4w-sh-cards", title: "Shared flashcards", space: SH, type: "flashcards", shareId: "r4wShCards1", updated: c.ago(55),
    text: "What is backprop? :: The chain rule applied from the loss back.\nWhy cache activations? :: The backward pass needs them.\nWhat is η? :: The learning rate.\n" });
  n({ id: "r4w-sh-canvas", title: "Shared canvas", space: SH, type: "canvas", shareId: "r4wShCanv1", updated: c.ago(70),
    body: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Forward", x: 0, y: 0, width: 160, height: 60, color: "4" }, { id: "b", type: "text", text: "Backward", x: 240, y: 0, width: 160, height: 60, color: "1" }, { id: "c", type: "file", file: `${SRC}.md`, x: 120, y: 120, width: 220, height: 80 }], edges: [{ id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow" }, { id: "e2", fromNode: "b", toNode: "c" }] }) });
  n({ id: "r4w-sh-private", title: "Every note of a shared space is public", space: SH, updated: c.ago(80), text: "A space share lists every note in the space; of the space's properties only goal, dates and URL are exposed (the `secret` property never is). Keep private notes in another space.\n" });

  // ------------------------------------------------------------ blog (published posts, OG previews) + drafts
  for (const p of POSTS) n({ id: p.id, title: p.title, space: BL, folder: "r4w-f-posts", type: "post", status: "mastered", published: 1, slug: p.slug, tags: ["blog", ...p.tags], props: { excerpt: p.ex }, fm: { excerpt: JSON.stringify(p.ex) }, shareId: p.id === "r4w-post-1" ? "r4wShPost1" : null, text: p.body, updated: c.at(p.ago, "10:00"), created: c.at(p.ago + 1, "10:00") });
  n({ id: "r4w-draft", title: "Draft: Focus mode tips", space: BL, folder: "r4w-f-drafts", type: "post", status: "learning", tags: ["blog"], updated: c.ago(15), text: "Unpublished draft: Publish from the note's Share sheet.\n" });

  // ------------------------------------------------------------ project hub (every doc state, card marker, requirement level)
  const fm = (doc: string, st: string, owner = "amir") => `---\ndoc: ${doc}\ndocstatus: ${st}\nowner: ${owner}\n---\n`;
  n({ id: "r4w-pj-prd", title: "PRD: Lumen Reader", space: PJ, updated: c.at(5), body: `${fm("prd", "approved")}# PRD: Lumen Reader\n\n## Goals\n- Read aloud with the sentence underlined\n- Highlights saved as Markdown\n\n## Requirements\n- REQ-1 (must) Read aloud follows the current sentence\n- REQ-2 (must) Highlights round-trip as ==text==\n- REQ-3 (should) Outline drawer with the current section\n- REQ-4 (could) Arabic voices\n- REQ-5 (wont) Cloud TTS\n` });
  n({ id: "r4w-pj-rfc", title: "RFC: sentence tracking", space: PJ, updated: c.at(2), body: `${fm("rfc", "review", "sara")}# RFC: sentence tracking\n\nUse speechSynthesis boundary events; fall back to a timer.\n` });
  n({ id: "r4w-pj-adr1", title: "ADR-1: Markdown highlights", space: PJ, updated: c.at(9), body: `${fm("adr", "approved")}# ADR-1: Markdown highlights\n\n**Decision:** \`==text==\` with \`{.hl-color}\`.\n` });
  n({ id: "r4w-pj-adr0", title: "ADR-0: highlights in a sidecar file", space: PJ, updated: c.at(20), body: `${fm("adr", "superseded")}# ADR-0: highlights in a sidecar file\n\nSuperseded by ADR-1.\n` });
  n({ id: "r4w-pj-spec", title: "Spec: highlighter bar", space: PJ, updated: c.at(4), body: `${fm("spec", "draft", "lina")}# Spec: highlighter bar\n\nFive colours, Note, Card.\n` });
  n({ id: "r4w-pj-rej", title: "Draft: cloud voices", space: PJ, updated: c.at(14), body: `${fm("draft", "rejected")}# Draft: cloud voices\n\nRejected: offline first.\n` });
  n({ id: "r4w-pj-plan", title: "Action plan", space: PJ, updated: c.ago(40), body: `${fm("plan", "approved")}# Action plan\n\n## Board\n- [>] Voice picker in settings ~1d #epic/voice\n- [ ] Speed chip ~2h !p2 📅 ${c.iso(3)} #epic/voice REQ-1\n- [/] Sentence underline ~3d !p1 🛫 ${c.iso(-4)} 📅 ${c.iso(2)} @amir #epic/voice REQ-1\n- [?] Highlight → Markdown ~1d 🛫 ${c.iso(-6)} 📅 ${c.iso(-1)} @sara #epic/highlights REQ-2\n- [x] Outline drawer ~2d 🛫 ${c.iso(-12)} 📅 ${c.iso(-8)} #epic/outline REQ-3\n- [-] Cloud TTS #epic/voice REQ-5\n- [ ] Overdue: QA pass !p1 📅 ${c.iso(-2)} @lina #epic/highlights\n` });
  n({ id: "r4w-pj-meet", title: "Meeting 2026-11-12", space: PJ, updated: c.at(7), body: `${fm("meeting", "approved")}# Meeting 2026-11-12\n\n- Decided: Markdown highlights\n- [ ] Lina: QA pass 📅 ${c.iso(1)}\n` });
  n({ id: "r4w-pj-diagram", title: "Reader flow", space: PJ, type: "diagram", updated: c.ago(100), body: "flowchart LR\n  open[Open note] --> focus[Focus › Read]\n  focus --> hl[Highlight]\n  hl --> save[Save to Markdown]\n" });

  // ------------------------------------------------------------ history for navigation / back list; due cards (favicon badge); sessions (streak moment)
  v.versions.push(version("r4w-v-1", show, show.body.replace("Read mode showcase", "Read showcase (draft)"), c.ago(60 * 24 * 2), "First draft"), version("r4w-v-2", show, show.body, c.ago(60 * 5)));
  const cardNotes = v.notes.filter((x) => x.id === "r4w-sh-cards" || x.id === "r4w-ar-note" || x.id === "r4w-sh-lesson");
  v.cards.push(...cardsFor(cardNotes, c, (i) => (i < 3 ? "due" : i === 3 ? "learning" : "later")));
  // studied the last 3 days but not today → the first study activity today shows the streak moment
  for (let k = 1; k <= 3; k++) v.sessions.push(session(`r4w-se-${k}`, "r4w-focus", 20 + k * 5, c.at(k, "20:15")));

  // ------------------------------------------------------------ real files
  addFile(v, "r4w-png", "chart.png", await pngBlob(960, 540, "#1D222B", "chart.png · r4 write"));
  addFile(v, "r4w-png-photo", "photo.png", await pngBlob(1600, 1000, "#24476B", "study group"));
  addFile(v, "r4w-png-wide", "wide.png", await pngBlob(2400, 600, "#3B2A4A", "wide.png 2400×600"));
  addFile(v, "r4w-svg", "diagram.svg", svgBlob(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300"><rect width="640" height="300" fill="#161A21"/><circle cx="160" cy="150" r="90" fill="#F2A93B"/><rect x="330" y="70" width="200" height="160" rx="20" fill="#39C5CF"/></svg>`));
  addFile(v, "r4w-wav", "lecture-07.wav", wavBlob(2, 440));
  addFile(v, "r4w-pdf", "reader-spec.pdf", pdfBlob("Lumen Reader spec"));
  return v;
}

/** Note ids used by the browser checks and the checklist. */
export const R4W = {
  showcase: "r4w-showcase", source: "r4w-source", slash: "r4w-slash", editor: "r4w-editor", focus: "r4w-focus", wide: "r4w-wide", full: "r4w-full",
  embeds: "r4w-embeds", deckAll: "r4w-deck-all", arrange: "r4w-deck-arrange", docDeck: "r4w-doc-deck", rtlDeck: "r4w-deck-rtl", post: "r4w-post-1",
  spaces: { write: W, talks: SL, shared: SH, blog: BL, ar: AR, project: PJ, icons: IC, empty: EM },
};
