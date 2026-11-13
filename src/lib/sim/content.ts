// Dev simulator: Markdown/Canvas/Excalidraw bodies that exercise every renderer feature.
// Uses String.raw so KaTeX backslashes stay literal; F = a code fence (``` can't sit inside a template literal).
import type { Clock } from "./kit";

const R = String.raw;
export const F = "```";

export const CALLOUT_TYPES = ["note", "abstract", "summary", "tldr", "info", "todo", "tip", "hint", "important", "success", "check", "done", "question", "help", "faq", "warning", "caution", "attention", "failure", "fail", "missing", "danger", "error", "bug", "example", "quote", "cite"];

/** Every Mermaid diagram type (one fence each). */
export const MERMAID: [string, string][] = [
  ["Flowchart", "flowchart LR\n  A[Start] --> B{Converged?}\n  B -- no --> C[Step against ∇J] --> B\n  B -- yes --> D((Done))"],
  ["Sequence", "sequenceDiagram\n  participant C as Client\n  participant S as Server\n  C->>S: SYN\n  S-->>C: SYN-ACK\n  C->>S: ACK\n  Note over C,S: connection established"],
  ["Class", "classDiagram\n  class Note {\n    +string title\n    +string body\n    +save()\n  }\n  class Space\n  Space \"1\" --> \"*\" Note : contains"],
  ["State", "stateDiagram-v2\n  [*] --> New\n  New --> Learning : first review\n  Learning --> Review : graduated\n  Review --> Learning : lapse\n  Review --> [*]"],
  ["Entity relationship", "erDiagram\n  SPACE ||--o{ FOLDER : has\n  FOLDER ||--o{ NOTE : holds\n  NOTE ||--o{ CARD : generates"],
  ["User journey", "journey\n  title Study evening\n  section Review\n    Open due cards: 4: Me\n    Grade 30 cards: 3: Me\n  section Write\n    Draft a lesson: 5: Me"],
  ["Gantt", "gantt\n  title Thesis plan\n  dateFormat YYYY-MM-DD\n  section Research\n  Literature review :done, a1, 2026-09-01, 30d\n  Experiments :active, a2, after a1, 45d\n  section Writing\n  Draft chapters :a3, after a2, 30d"],
  ["Pie", "pie title Study time by space\n  \"ML\" : 42\n  \"Arabic\" : 28\n  \"Thesis\" : 20\n  \"Other\" : 10"],
  ["Quadrant", "quadrantChart\n  title Topics: effort vs value\n  x-axis Low effort --> High effort\n  y-axis Low value --> High value\n  quadrant-1 Plan\n  quadrant-2 Do now\n  quadrant-3 Skip\n  quadrant-4 Delegate\n  Backprop: [0.7, 0.9]\n  Idafa: [0.3, 0.8]\n  Trivia: [0.2, 0.1]"],
  ["Requirement", "requirementDiagram\n  requirement sync_req {\n    id: 1\n    text: notes sync within 5 s\n    risk: medium\n    verifymethod: test\n  }\n  element worker {\n    type: service\n  }\n  worker - satisfies -> sync_req"],
  ["Git graph", "gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature\n  commit"],
  ["C4 context", "C4Context\n  title Lumen system context\n  Person(owner, \"Owner\", \"Writes notes\")\n  System(app, \"Lumen\", \"Local-first notebook\")\n  System_Ext(d1, \"Cloudflare D1\", \"Sync store\")\n  Rel(owner, app, \"Uses\")\n  Rel(app, d1, \"Syncs to\")"],
  ["Mindmap", "mindmap\n  root((ML))\n    Optimization\n      GD\n      Adam\n    Neural nets\n      Backprop\n      Attention"],
  ["Timeline", "timeline\n  title Course progress\n  September : Linear algebra\n  October : Optimization : Neural nets\n  November : Attention"],
  ["Sankey", "sankey-beta\n\nStudy,ML,42\nStudy,Arabic,28\nML,Lessons,30\nML,Flashcards,12"],
  ["XY chart", "xychart-beta\n  title \"Cards reviewed per week\"\n  x-axis [w1, w2, w3, w4, w5]\n  y-axis \"Cards\" 0 --> 200\n  bar [60, 120, 90, 160, 140]\n  line [60, 120, 90, 160, 140]"],
  ["Block", "block-beta\n  columns 3\n  a[\"Editor\"] b[\"Dexie\"] c[\"Worker\"]\n  a --> b\n  b --> c"],
  ["Packet", "packet-beta\n  0-15: \"Source port\"\n  16-31: \"Destination port\"\n  32-63: \"Sequence number\""],
  ["Kanban", "kanban\n  Todo\n    t1[Write intro]\n  Doing\n    t2[Run baseline]\n  Done\n    t3[Pick topic]"],
  ["Architecture", "architecture-beta\n  group api(cloud)[API]\n  service db(database)[D1] in api\n  service server(server)[Worker] in api\n  db:L -- R:server"],
  ["Radar", "radar-beta\n  axis m[\"Math\"], c[\"Code\"], w[\"Writing\"]\n  curve a[\"Me\"]{4, 3, 5}\n  max 5"],
  ["Treemap", "treemap-beta\n\"Vault\"\n    \"ML\": 42\n    \"Arabic\": 28\n    \"Thesis\": 20"],
  ["ZenUML (needs plugin: expect an error card)", "zenuml\n  Client->Server.sync() {\n    return ok\n  }"],
];

export const CODE: [string, string][] = [
  ["ts", "export function schedule(card: Card, grade: Grade): Card {\n  const ease = Math.max(1.3, card.ease - 0.2);\n  return { ...card, ease };\n}"],
  ["python", "import numpy as np\n\ndef gd(f_grad, theta, lr=1e-3, steps=100):\n    for _ in range(steps):\n        theta -= lr * f_grad(theta)\n    return theta"],
  ["rust", "fn main() {\n    let v: Vec<i32> = (1..=5).map(|x| x * x).collect();\n    println!(\"{:?}\", v);\n}"],
  ["go", "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"hello, lumen\") }"],
  ["sql", "SELECT kind, COUNT(*) FROM items WHERE deleted = 0 GROUP BY kind ORDER BY 2 DESC;"],
  ["bash", "npx tsc -b && npx vite build\ncurl -s https://example.com/api/sync | jq '.items | length'"],
  ["json", "{\n  \"nodes\": [{ \"id\": \"a\", \"type\": \"text\", \"text\": \"hi\", \"x\": 0, \"y\": 0, \"width\": 120, \"height\": 60 }],\n  \"edges\": []\n}"],
  ["css", ":root { --accent: #f2a93b; }\n.reading p { unicode-bidi: plaintext; }"],
  ["html", "<p dir=\"auto\">مرحبا · hello</p>"],
  ["java", "public class Hello {\n  public static void main(String[] a) { System.out.println(\"hi\"); }\n}"],
  ["cpp", "#include <iostream>\nint main() { std::cout << \"hi\\n\"; }"],
  ["yaml", "type: lesson\nstatus: learning\ntags: [ml, optimization]"],
  ["diff", "- old line\n+ new line"],
  ["", "plain text block without a language"],
];

const LONG_WORD = "Pneumonoultramicroscopicsilicovolcanoconiosis".repeat(6);
const LONG_URL = "https://example.com/" + "very-long-path-segment/".repeat(12) + "?q=" + "x".repeat(80);

/** The kitchen-sink Markdown note: every inline/block feature the renderer supports. */
export function kitchenSink(c: Clock) {
  const callouts = CALLOUT_TYPES.map((t) => `> [!${t}]\n> This is a **${t}** callout with \`code\` and $x^2$.`).join("\n\n");
  const code = CODE.map(([l, s]) => `${F}${l}\n${s}\n${F}`).join("\n\n");
  return R`---
type: lesson
status: learning
tags: [showcase, markdown/features, nested/tag/deep]
aliases: [Everything note]
source: https://example.com
rating: 5
---
# Markdown kitchen sink

Every feature the renderer knows, in one note. Inline: **bold**, *italic*, ***both***, ~~strike~~, ` + "`inline code`" + R`, ==highlight==, H~2~O, x^2^, a [link](https://example.com), an autolink <https://developer.mozilla.org/>, a footnote[^1] and another[^long]. Emoji: 🧠 📚 ✅ 🔥 🦉 👩🏽‍💻 🇸🇦.

## Headings
### Level 3
#### Level 4
##### Level 5
###### Level 6

## Lists
- Bullet one
  - Nested two
    - Nested three
      - Nested four
1. First
2. Second
   1. Second · a
3. Third

## Tasks
- [ ] Overdue task 📅 ${c.iso(-5)}
- [ ] Overdue yesterday @due(${c.iso(-1)})
- [ ] Due today 📅 ${c.iso(0)}
- [ ] Due tomorrow 📅 ${c.iso(1)}
- [ ] Upcoming next week 📅 ${c.iso(7)}
- [ ] Far future 📅 ${c.iso(120)}
- [/] In progress (doing) 📅 ${c.iso(2)}
- [x] Done task 📅 ${c.iso(-2)}
- [X] Done with capital X
- [ ] No due date
  - [ ] Nested sub-task 📅 ${c.iso(3)}

## Table
| Optimizer | Learning rate | Momentum | Notes |
|:--|--:|:-:|---|
| SGD | 0.1 | — | baseline |
| Momentum | 0.01 | 0.9 | narrow valleys |
| Adam | 1e-3 | β₁ 0.9 | default choice |
| عربي | ٠٫٠١ | — | جدول بالعربية |

## Math
Inline $e^{i\pi} + 1 = 0$ and $\nabla_\theta J(\theta)$.

$$
\begin{aligned}
\theta_{t+1} &= \theta_t - \eta \nabla J(\theta_t) \\
\mathcal{L}(y, \hat y) &= -\sum_i y_i \log \hat y_i
\end{aligned}
$$

$$\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}$$

Broken math stays visible: $\frac{1}{$ and $$\badcommand{x}$$

## Callouts
${callouts}

> [!faq]- Folded (closed) callout
> Hidden until opened.

> [!tip]+ Folded (open) callout
> Visible by default, can be closed.

> [!warning] Custom title with **markdown**
> Body text.
>
> > [!note] Nested callout
> > Inside another.

> A plain blockquote.

## Code
${code}

## Mermaid
${F}mermaid
flowchart TD
  Q[Question] --> A{Know it?}
  A -->|yes| G[Good]
  A -->|no| R[Again]
${F}

## Embedded canvas
${F}canvas
{"nodes":[{"id":"a","type":"text","text":"Inline **canvas**","x":0,"y":0,"width":200,"height":80},{"id":"b","type":"text","text":"Second node","x":280,"y":0,"width":200,"height":80,"color":"4"}],"edges":[{"id":"e","fromNode":"a","toNode":"b","toEnd":"arrow"}]}
${F}

## Query block
${F}query
tag:showcase sort:title view:table
${F}

## Links
- Existing: [[Gradient descent (showcase)]], with alias [[Flashcards showcase|my cards]], heading [[Kitchen sink roadmap#Module 1]]
- Missing: [[This note does not exist]] and [[Another missing page]]
- Embed: ![[Showcase canvas]]
- Tags: #showcase #markdown/features #nested/tag/deep #عربي #2026goals

## Embeds
https://www.youtube.com/watch?v=aircAruvnKk

https://youtu.be/IHZwWFHWa-w?t=42

https://vimeo.com/76979871

https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4

https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3

https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf

<https://github.com/>

https://en.wikipedia.org/wiki/Gradient_descent

## Attachments
![chart.png](att:sim-att-png)

![diagram.svg](att:sim-att-svg)

![tone.wav](att:sim-att-wav)

![handout.pdf](att:sim-att-pdf)

[📎 grades.csv](att:sim-att-csv)

![missing-photo.jpg](att:sim-att-does-not-exist)

## Arabic + English (RTL / LTR)
الإضافة تركيب من اسمين: **كتابُ الطالبِ** means “the student's book”. Mixed line: Lumen يحفظ الملاحظات locally ثم يزامنها.

- عنصر أول في قائمة
- Second item in English
- [ ] مهمة بالعربية 📅 ${c.iso(1)}

> [!note] ملاحظة
> هذا تنبيه باللغة العربية مع $x^2$.

## Very long content
${LONG_WORD}

${LONG_URL}

${"A very long line without breaks ".repeat(40)}

## Flashcards
What does η control? :: The step size.
Inverse of a 2×2 matrix?
?
Swap the diagonal, negate the off-diagonal, divide by the determinant.

---

Horizontal rule above. Final paragraph.

[^1]: A short footnote.
[^long]: A longer footnote with **formatting**, a [link](https://example.com) and $math$.
`;
}

export function mermaidGallery() {
  return `---\ntype: note\ntags: [showcase, mermaid]\n---\n# Mermaid gallery\n\nEvery diagram type Mermaid knows, one fence each.\n\n` +
    MERMAID.map(([n, s]) => `## ${n}\n${F}mermaid\n${s}\n${F}`).join("\n\n") +
    `\n\n## Invalid diagram (should show an error card)\n${F}mermaid\nflowchart LR\n  A --> \n  ??? -->> [[[\n${F}\n`;
}

export function slidesBody() {
  return `---\ntype: slides\ntags: [showcase]\n---\n# Showcase deck\n\nEvery slide feature\n\n---\n\n## Bullets\n\n- One\n- Two\n  - Nested\n\nNote: Speaker notes for slide 2.\n\n---\n\n## Math\n\n$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$\n\n---\n\n## Code\n\n${F}python\nprint("hello")\n${F}\n\n---\n\n## Diagram\n\n${F}mermaid\nflowchart LR\n  A --> B --> C\n${F}\n\n---\n\n## Image\n\n![chart.png](att:sim-att-png)\n\n---\n\n## عربي\n\nشريحة باللغة العربية\n\n---\n\n## Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`;
}

export function roadmapBody(c: Clock) {
  return `# Kitchen sink roadmap

## Module 1 📅 ${c.iso(-10)}
- [x] Vectors → [[Gradient descent (showcase)]]
- [x] Matrices
- [-] Skipped: tensors (optional)

## Module 2 · overdue 📅 ${c.iso(-2)}
- [/] Derivatives (needs: Matrices) 📅 ${c.iso(-1)}
- [ ] Chain rule (needs: Derivatives) 📅 ${c.iso(-3)}

## Module 3 · due today 📅 ${c.iso(0)}
- [ ] Gradient descent (needs: Chain rule) 📅 ${c.iso(0)} → [[Gradient descent (showcase)]]
- [/] Momentum 📅 ${c.iso(1)}

## Module 4 · upcoming 📅 ${c.iso(21)}
- [ ] Backprop (needs: Chain rule, Gradient descent)
- [ ] Attention (needs: Backprop) → [[Missing lesson note]]
- [ ] Transformers (needs: Attention, Unknown prerequisite)

## Module 5 · no date
- [ ] Reinforcement learning
`;
}

/** JSON Canvas 1.0 exercising every node type, colour, side and edge end. */
export function showcaseCanvas(): string {
  const colors = ["1", "2", "3", "4", "5", "6", "#5CC8C2"];
  const nodes: Record<string, unknown>[] = [
    { id: "grp", type: "group", label: "All node types", x: -40, y: -60, width: 1180, height: 520 },
    { id: "grp-bg", type: "group", label: "Group with background", x: -40, y: 520, width: 520, height: 300, background: "att:sim-att-png", backgroundStyle: "cover" },
    { id: "t1", type: "text", text: "# Text node\n**Markdown** with $x^2$ and a [[Kitchen sink]] link.", x: 0, y: 0, width: 260, height: 160 },
    { id: "f1", type: "file", file: "Showcase/Kitchen sink.md", x: 300, y: 0, width: 240, height: 160 },
    { id: "f2", type: "file", file: "att:sim-att-png", x: 580, y: 0, width: 240, height: 160 },
    { id: "f3", type: "file", file: "Missing/Does not exist.md", x: 860, y: 0, width: 240, height: 160 },
    { id: "l1", type: "link", url: "https://jsoncanvas.org/spec/1.0/", x: 0, y: 220, width: 260, height: 100 },
    { id: "ar", type: "text", text: "## عقدة عربية\nنص من اليمين إلى اليسار", x: 300, y: 220, width: 240, height: 120 },
    { id: "in-bg", type: "text", text: "Inside the background group", x: 0, y: 580, width: 240, height: 80 },
  ];
  colors.forEach((col, i) => nodes.push({ id: `c${i}`, type: "text", text: `color ${col}`, x: 580 + (i % 4) * 130, y: 220 + Math.floor(i / 4) * 90, width: 120, height: 70, color: col }));
  const edges = [
    { id: "e1", fromNode: "t1", fromSide: "right", toNode: "f1", toSide: "left", toEnd: "arrow", label: "arrow" },
    { id: "e2", fromNode: "f1", fromSide: "right", toNode: "f2", toSide: "left", fromEnd: "arrow", toEnd: "arrow", label: "both ends", color: "4" },
    { id: "e3", fromNode: "f2", fromSide: "right", toNode: "f3", toSide: "left", toEnd: "none", label: "no ends", color: "1" },
    { id: "e4", fromNode: "t1", fromSide: "bottom", toNode: "l1", toSide: "top" },
    { id: "e5", fromNode: "l1", toNode: "ar", color: "#E8893A", label: "طويل" },
  ];
  return JSON.stringify({ nodes, edges }, null, 2);
}

/** Excalidraw scene as Lumen skeletons (converted by the whiteboard on first open). */
export function showcaseWhiteboard() {
  return JSON.stringify({
    type: "excalidraw", version: 2, source: "lumen", elements: [], appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {},
    lumenPending: [
      { type: "rectangle", id: "wb-r", x: 0, y: 0, width: 200, height: 100, backgroundColor: "#d0ebff", fillStyle: "solid", roundness: { type: 3 }, label: { text: "rectangle", fontSize: 20 } },
      { type: "ellipse", id: "wb-e", x: 300, y: 0, width: 180, height: 100, backgroundColor: "#d3f9d8", fillStyle: "hachure", label: { text: "ellipse", fontSize: 20 } },
      { type: "diamond", id: "wb-d", x: 580, y: -10, width: 140, height: 120, backgroundColor: "#ffec99", fillStyle: "cross-hatch", label: { text: "diamond", fontSize: 18 } },
      { type: "text", id: "wb-t", x: 0, y: 180, text: "Free text · نص عربي · emoji 🎉", fontSize: 24 },
      { type: "arrow", id: "wb-a1", x: 0, y: 0, start: { id: "wb-r" }, end: { id: "wb-e" } },
      { type: "arrow", id: "wb-a2", x: 0, y: 0, start: { id: "wb-e" }, end: { id: "wb-d" }, strokeColor: "#e03131" },
      { type: "line", id: "wb-l", x: 0, y: 260, width: 400, height: 40, points: [[0, 0], [200, 40], [400, 0]] },
      { type: "rectangle", id: "wb-s", x: 300, y: 180, width: 160, height: 128, backgroundColor: "#fff3bf", fillStyle: "solid", strokeColor: "transparent", customData: { lumen: "sticky" }, label: { text: "sticky note", fontSize: 20 } },
      { type: "frame", id: "wb-f", name: "Frame", children: ["wb-r", "wb-e"] },
    ],
  });
}

export const LOREM = "Gradient descent minimizes a differentiable loss by repeatedly stepping against its gradient; the learning rate controls the step size and momentum smooths noisy updates across narrow valleys.".split(" ");
/** n words of deterministic filler (optionally with headings every ~400 words). */
export function words(n: number, headings = true) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (headings && i % 400 === 0) out.push(`\n\n## Section ${i / 400 + 1}\n\n`);
    else if (i % 60 === 0) out.push("\n\n");
    out.push(LOREM[(i * 7 + (i >> 3)) % LOREM.length]);
  }
  return out.join(" ").replace(/ \n/g, "\n");
}
