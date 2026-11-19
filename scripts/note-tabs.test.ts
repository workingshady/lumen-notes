// Note tabs (Diagrams / Media / Links) pure logic. Run: npx tsx scripts/note-tabs.test.ts
import assert from "node:assert/strict";
import { addTimestamp, noteDiagrams, noteLinks, noteMedia, noteTimestamps, promoteLink, tabCounts } from "../src/lib/note-tabs";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const body = `# Attention

## Encoder stack
\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

## Concept map
\`\`\`mermaid
graph LR
  X --> Y
\`\`\`

![Heads visualised · fig 3](att:abc123)
![a photo](https://example.com/cat.jpg)

https://www.youtube.com/watch?v=eMlx5fFNoYc
[03:10] Why attention, not RNNs
[08:42] The √d trick

![lecture-07-attention.m4a](att:aud1)

See also [this talk](https://vimeo.com/76979871) and https://youtu.be/kCc8FmEb1nY inline.

Read [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/) twice: https://jalammar.github.io/illustrated-transformer/
Paper: [Attention is all you need](https://arxiv.org/abs/1706.03762) and the [PDF](https://arxiv.org/pdf/1706.03762.pdf).
Links: [[Softmax]] [[Softmax|soft]] [[Missing note]] ![[Embedded]]
\`\`\`
https://not-a-link-in-code.example
\`\`\`
`;
const exists = (x: string) => x.toLowerCase() === "softmax" || x.toLowerCase() === "embedded";

t("diagrams: mermaid blocks + diagram images, not photos", () => {
  const d = noteDiagrams(body);
  assert.deepEqual(d.map((x) => x.kind), ["mermaid", "mermaid", "image"]);
  assert.equal(d[0].title, "Encoder stack");
  assert.equal(d[0].type, "flowchart TD");
  assert.equal(d[1].type, "graph LR");
  assert.equal(d[2].url, "att:abc123");
});
t("media: players in order + inline video links detected", () => {
  const m = noteMedia(body);
  assert.deepEqual(m.map((x) => [x.kind, x.player ?? 0, !!x.detected]), [["youtube", 1, false], ["audio", 2, false], ["vimeo", 0, true], ["youtube", 0, true]]);
  assert.equal(m[1].title, "lecture-07-attention.m4a");
  assert.equal(m[2].title, "this talk");
});
t("timestamps: per player with labels", () => {
  const s = noteTimestamps(body);
  assert.deepEqual(s.map((x) => [x.label, x.video, x.text]), [["03:10", 1, "Why attention, not RNNs"], ["08:42", 1, "The √d trick"]]);
});
t("add timestamp goes after the player's last stamp", () => {
  const r = addTimestamp(body, 900, 1, 18, "[15:00]");
  const lines = r.body.split("\n");
  assert.equal(lines[r.line], "[15:00] ");
  assert.equal(lines[r.line - 1], "[08:42] The √d trick");
});
t("links: grouped kinds, use counts, broken notes, code ignored", () => {
  const l = noteLinks(body, exists);
  const by = (k: string) => l.filter((x) => x.kind === k).map((x) => x.title);
  assert.deepEqual(by("web"), ["The Illustrated Transformer", "Attention is all you need"]);
  assert.equal(l.find((x) => x.title === "The Illustrated Transformer")!.count, 2);
  assert.deepEqual(by("video"), ["youtube.com/watch?v=eMlx5fFNoYc", "this talk", "youtu.be/kCc8FmEb1nY"]);
  assert.deepEqual(by("pdf"), ["PDF"]);
  assert.deepEqual(by("note"), ["Softmax"]);
  assert.equal(l.find((x) => x.target === "Softmax")!.count, 2);
  assert.deepEqual(by("broken"), ["Missing note"]);
  assert.ok(!l.some((x) => x.url.includes("not-a-link-in-code")));
  assert.ok(!l.some((x) => x.target === "Embedded"));
});
t("links: a link check marks a web link broken", () => {
  const l = noteLinks(body, exists, (u) => (u.includes("arxiv.org/abs") ? "404 since 2 Nov" : null));
  const b = l.find((x) => x.url.includes("arxiv.org/abs"))!;
  assert.equal(b.kind, "broken");
  assert.equal(b.why, "404 since 2 Nov");
});
t("promote a link to its own line (player / card)", () => {
  const out = promoteLink("Intro\nSee https://vimeo.com/1 now.\nMore text\n\nNext", "https://vimeo.com/1");
  assert.equal(out, "Intro\nSee https://vimeo.com/1 now.\nMore text\n\nhttps://vimeo.com/1\n\nNext");
  assert.equal(promoteLink("https://vimeo.com/1", "https://vimeo.com/1"), "https://vimeo.com/1");
});
t("tab counts; a note with only links shows only Links", () => {
  assert.deepEqual(tabCounts("Just [a](https://a.com) and [[Softmax]].", exists), { diagrams: 0, media: 0, links: 2 });
});
console.log(`\n${n} tests passed`);
