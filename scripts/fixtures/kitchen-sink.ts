// The "kitchen sink" fixture for the note export: every block type the print document has to handle.
// Used by scripts/print-doc.test.ts (Node, with stub services) and by the browser check (scripts seeded into the demo DB).
import type { PrintNote } from "../../src/lib/print-doc";

/** 1x1 pixel PNGs (red / blue) as data URIs: stand-ins for attachments. */
export const PIXEL_RED = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
export const PIXEL_BLUE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";

const rows = (n: number) => Array.from({ length: n }, (_, i) => `| Row ${i + 1} | ${(i * 37) % 101} | item-${i + 1} with a longer description to wrap | ${i % 2 ? "yes" : "no"} |`).join("\n");
const wideHead = Array.from({ length: 15 }, (_, i) => `Col ${i + 1}`);
const wideRow = (r: number) => Array.from({ length: 15 }, (_, i) => `r${r}c${i + 1} value`).join(" | ");
const longCode = Array.from({ length: 60 }, (_, i) => `const value${i} = compute(${i}, "string number ${i}");`).join("\n");
const longLine = "x".repeat(300);
const mermaidWide = `graph LR\n${Array.from({ length: 14 }, (_, i) => `  N${i}[Step ${i + 1} of the long pipeline] --> N${i + 1}[Step ${i + 2} of the long pipeline]`).join("\n")}`;

export const KITCHEN_TITLE = "Kitchen sink";
export const kitchenSinkBody = `---
cloze: true
tags: [export, fixture]
status: draft
owner: Lumen test
---
# ${KITCHEN_TITLE}

[[toc]]

## Text and links

Plain paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, H~2~O, x^2^ and \`inline code\`. An external link [Example](https://example.com/page) and a bare one https://example.org/docs/a/very/long/path/that/keeps/going. A mail link [write](mailto:hi@example.com), an in-page [anchor](#text-and-links) and a wikilink to [[Included note]] and a missing [[Nowhere]]. Tags #export #fixture.

Status :status[In review]{amber} :status[Done]{green} :status[Blocked]{red}. Due @due(2026-12-24). Footnote here[^1].

[^1]: The footnote text.

## Tasks and lists

- [x] A finished task
- [ ] An open task
- [/] A task in progress
- Plain bullet
  - Nested bullet
1. First
2. Second

## Callouts

> [!note] Note title
> A note callout with **markup**.

> [!warning]
> Watch out for this.

> [!danger] Danger
> Something dangerous, long enough to show how the callout colours print on paper.

> [!tip]- Folded tip
> Hidden until opened on screen; always open on paper.

::: columns
::: column
Left column text.
:::
::: column
Right column text.
:::
:::

::: expand More detail
Details inside an expander.
:::

## Code

\`\`\`ts
export function add(a: number, b: number) {
  return a + b;
}
\`\`\`

\`\`\`ts
${longCode}
\`\`\`

\`\`\`text
${longLine}
\`\`\`

## Long table

| Name | Score | Description | Ok |
|------|------:|-------------|----|
${rows(100)}

## Wide table

| ${wideHead.join(" | ")} |
|${wideHead.map(() => "---").join("|")}|
${Array.from({ length: 6 }, (_, r) => `| ${wideRow(r + 1)} |`).join("\n")}

## Math

Inline $E = mc^2$ and a display equation:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Diagrams

\`\`\`mermaid
${mermaidWide}
\`\`\`

\`\`\`mermaid
pie title Pets
  "Dogs" : 5
  "Cats" : 3
\`\`\`

\`\`\`canvas
{"nodes":[{"id":"a","type":"text","text":"Idea","x":0,"y":0,"width":160,"height":60},{"id":"b","type":"text","text":"Plan","x":260,"y":80,"width":160,"height":60}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}
\`\`\`

## Images and media

![Red pixel attachment](att:img-red)

![Missing attachment](att:img-missing)

![Remote image](https://images.example.invalid/photo.png)

![Inline data image](${PIXEL_BLUE})

https://www.youtube.com/watch?v=dQw4w9WgXcQ

![Lecture clip](https://media.example.invalid/lecture.mp4)

![Podcast](https://media.example.invalid/episode.mp3)

<https://example.com/article>

## Arabic

# عنوان بالعربية

هذه فقرة عربية للتحقق من اتجاه النص من اليمين إلى اليسار، مع كلمة English في الوسط.

| الاسم | القيمة |
|-------|--------|
| أحمد | ١٢ |

## Flashcards and cloze

The capital of France is {{c1::Paris}} and the capital of Japan is {{c2::Tokyo::an East Asian capital}}.

What is 2 + 2? :: 4
Largest planet? :: Jupiter

## Transclusion

![[Included note]]

![[Included note#Part B]]

![[Included note#^blk1]]

## Final

The end.
`;

export const includedBody = `# Included note

Intro of the included note with a link to [[${KITCHEN_TITLE}]].

## Part A

Text of part A.

## Part B

Text of part B that is quoted on its own. ^partb

Block with an id. ^blk1
`;

/** The fixture notes: the kitchen sink and the note it includes. */
export function kitchenSink(): PrintNote[] {
  return [
    { id: "ks", title: KITCHEN_TITLE, body: kitchenSinkBody, createdAt: Date.UTC(2026, 10, 1), tags: ["export", "fixture"], status: "draft", type: "note" },
    { id: "inc", title: "Included note", body: includedBody, createdAt: Date.UTC(2026, 10, 2), tags: [], type: "note" },
  ];
}
