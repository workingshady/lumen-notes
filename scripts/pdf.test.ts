// npx tsx scripts/pdf.test.ts — pure logic of the PDF reader (lib/pdf-format.ts, lib/pdf-geom.ts).
import assert from "node:assert/strict";
import {
  filterHighlights, findAll, flashcardLine, highlightsMarkdown, hlCanvasNode, hlLink, hlNoteBody, newHlId, newPdfBody, pageOfSubpath, parseHighlights, parseHlCard, parseHlLink,
  pdfMeta, progressOf, removeHighlight, searchPages, serializeHighlight, setPdfMeta, shortTitle, sortHighlights, titleFromFile, upsertHighlight, escapeMd, unescapeMd, colorFromPreset,
  type Highlight,
} from "../src/lib/pdf-format";
import { dragRect, imageRegions, mergeLines, mul, normRects, unionRect, type Matrix } from "../src/lib/pdf-geom";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok", name); };

const h1: Highlight = { id: "hl-aaaa11", color: "yellow", page: 4, quote: "The Transformer follows this overall architecture [1] using #stacked self-attention", comment: "key sentence", tags: ["architecture", "attention"], rects: [[0.1176, 0.3021, 0.7647, 0.0142], [0.1176, 0.3163, 0.4, 0.0142]], text: [1234, 87], created: "2026-11-19T10:22:31Z" };
const h2: Highlight = { id: "hl-bbbb22", color: "blue", page: 3, quote: "", image: "att:img-1", tags: [], rects: [[0.1, 0.2, 0.5, 0.4]], created: "2026-11-19T11:00:00Z" };
const h3: Highlight = { id: "hl-cccc33", color: "green", page: 4, quote: "Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V", tags: ["math"], rects: [[0.2, 0.1, 0.5, 0.02]], created: "2026-11-19T09:00:00Z" };

t("escape round trip", () => {
  for (const s of ["a [b] #c *d* _e_ `f` <g> ==h== x^2 | y \\ z", "plain"]) assert.equal(unescapeMd(escapeMd(s)), s);
  assert.ok(!/(^|\s)#\w/.test(escapeMd("#tag")), "hashtags are escaped so they don't become note tags");
});

t("serialize / parse round trip", () => {
  for (const h of [h1, h2, h3]) {
    const [p] = parseHighlights(serializeHighlight(h));
    assert.deepEqual(p, h);
  }
});

t("new body + meta", () => {
  const b = newPdfBody({ title: "Attention Is All You Need", file: "att:abc", pages: 15 });
  assert.deepEqual(pdfMeta(b), { file: "att:abc", page: 1, pages: 15, progress: 0 });
  assert.match(b, /^---\ntype: pdf\n/);
  assert.match(b, /\n# Attention Is All You Need\n/);
  const b2 = setPdfMeta(b, { page: 4, progress: progressOf(4, 15) });
  assert.deepEqual(pdfMeta(b2), { file: "att:abc", page: 4, pages: 15, progress: 27 });
  assert.equal(b2.split("\n---\n")[1], b.split("\n---\n")[1], "body untouched");
});

t("upsert keeps page order, replace, remove", () => {
  let b = newPdfBody({ title: "P", file: "att:x" });
  b = upsertHighlight(b, h1);
  b = upsertHighlight(b, h2); // page 3 goes before page 4
  b = upsertHighlight(b, h3); // page 4, y 0.1 goes before h1 (y 0.30)
  assert.deepEqual(parseHighlights(b).map((h) => h.id), ["hl-bbbb22", "hl-cccc33", "hl-aaaa11"]);
  b = upsertHighlight(b, { ...h1, color: "red", comment: "changed" });
  const got = parseHighlights(b).find((h) => h.id === h1.id)!;
  assert.equal(got.color, "red"); assert.equal(got.comment, "changed");
  assert.equal(parseHighlights(b).length, 3);
  b = removeHighlight(b, h3.id);
  assert.deepEqual(parseHighlights(b).map((h) => h.id), ["hl-bbbb22", "hl-aaaa11"]);
  assert.match(b, /^## Highlights$/m);
});

t("upsert creates a Highlights section and keeps other sections", () => {
  const b = "---\ntype: pdf\nfile: x\n---\n# P\n\nMy notes.\n\n## Questions\n\n- why?\n";
  const out = upsertHighlight(b, h1);
  assert.match(out, /## Questions\n\n- why\?\n\n## Highlights\n\n- yellow · p\. 4/);
  const b2 = "# P\n\n## Highlights\n\n## Later\n\ntext\n";
  const out2 = upsertHighlight(b2, h3);
  assert.ok(out2.indexOf("hl-cccc33") < out2.indexOf("## Later"), "inserted inside the section");
});

t("ids, titles, links", () => {
  assert.match(newHlId(), /^hl-[a-z2-9]{6}$/);
  assert.equal(titleFromFile("vaswani_2017-attention.pdf"), "vaswani 2017-attention");
  assert.equal(hlLink("Attention", h1), "[[Attention#^hl-aaaa11|Attention · p. 4]]");
  assert.deepEqual(parseHlLink("see [[Attention#^hl-aaaa11|Attention · p. 4]]"), { title: "Attention", id: "hl-aaaa11", label: "Attention · p. 4" });
  assert.equal(shortTitle("one two three four five six seven eight nine ten"), "one two three four five six seven eight…");
  assert.equal(shortTitle("", "Fallback"), "Fallback");
});

t("note, flashcard, export", () => {
  const body = hlNoteBody("Attention", h1);
  assert.match(body, /^# The Transformer follows/);
  assert.match(body, /\n> The Transformer .*\\\[1\\\] using \\#stacked/);
  assert.match(body, /\[\[Attention#\^hl-aaaa11\|Attention · p\. 4\]\]/);
  assert.equal(flashcardLine("What does the Transformer use?", "stacked self-attention", "Attention", h1), "What does the Transformer use? :: stacked self-attention [[Attention#^hl-aaaa11|Attention · p. 4]]");
  assert.equal(flashcardLine("The Transformer uses {{c1::self-attention}}", "", "A", h1), "The Transformer uses {{c1::self-attention}} [[A#^hl-aaaa11|A · p. 4]]");
  const md = highlightsMarkdown("Attention", [h1, h2, h3]);
  assert.ok(md.indexOf("## p. 3") < md.indexOf("## p. 4"));
  assert.match(md, /!\[Area, p\. 3\]\(att:img-1\)/);
});

t("filter / sort", () => {
  const hs = [h1, h2, h3];
  assert.deepEqual(filterHighlights(hs, { color: "green" }).map((h) => h.id), ["hl-cccc33"]);
  assert.deepEqual(filterHighlights(hs, { tag: "attention" }).map((h) => h.id), ["hl-aaaa11"]);
  assert.deepEqual(sortHighlights(hs, "page").map((h) => h.id), ["hl-bbbb22", "hl-cccc33", "hl-aaaa11"]);
  assert.deepEqual(sortHighlights(hs, "date").map((h) => h.id), ["hl-bbbb22", "hl-aaaa11", "hl-cccc33"]);
});

t("canvas card text round trip", () => {
  const node = hlCanvasNode("Attention", h1, 10, 20, "n1");
  assert.equal(node.color, "3"); assert.equal(colorFromPreset(node.color), "yellow");
  const c = parseHlCard(node.text)!;
  assert.equal(c.quote, h1.quote); assert.equal(c.id, h1.id); assert.equal(c.page, 4); assert.equal(c.title, "Attention");
  const a = parseHlCard(hlCanvasNode("Attention", h2, 0, 0, "n2").text)!;
  assert.equal(a.image, "att:img-1"); assert.equal(a.page, 3);
  assert.equal(parseHlCard("# Just a card\n\ntext"), null);
  assert.equal(pageOfSubpath("#page=12"), 12); assert.equal(pageOfSubpath(undefined), 0);
});

t("search", () => {
  assert.deepEqual(findAll("Attention is attention. ATTENTION", "attention"), [0, 13, 24]);
  const hits = searchPages(["no", "self-Attention and attention", null, "attention"], "attention");
  assert.deepEqual(hits.map((h) => [h.page, h.index]), [[2, 0], [2, 1], [4, 0]]);
  assert.deepEqual(searchPages(["x"], "  "), []);
});

t("geometry: normalize + merge selection rects", () => {
  const page = { left: 100, top: 50, width: 600, height: 800 };
  const rs = normRects([
    { left: 160, top: 290, width: 200, height: 12 }, { left: 362, top: 290, width: 150, height: 12 }, // same line, touching
    { left: 160, top: 304, width: 100, height: 12 }, // next line
    { left: 160, top: 304, width: 0.5, height: 12 }, // degenerate
  ], page);
  assert.equal(rs.length, 2);
  assert.ok(Math.abs(rs[0][0] - 0.1) < 1e-9 && Math.abs(rs[0][2] - 352 / 600) < 1e-9);
  assert.deepEqual(mergeLines([[0, 0, 0.1, 0.02], [0.5, 0, 0.1, 0.02]]).length, 2, "far apart on a line stay separate");
  const d = dragRect(400, 450, 100, 50, page);
  assert.deepEqual(d, [0, 0, 0.5, 0.5]);
  assert.deepEqual(unionRect([[0.1, 0.1, 0.1, 0.1], [0.3, 0.5, 0.1, 0.1]]), [0.1, 0.1, 0.30000000000000004, 0.5]);
});

t("geometry: image regions from an operator list", () => {
  const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
  // viewport: scale 1, flip y for a 800-high page
  const base: Matrix = [1, 0, 0, -1, 0, 800];
  const fn = [10, 12, 85, 11, 74, 12, 86, 75, 85];
  const args = [null, [200, 0, 0, 100, 50, 600], ["img1"], null, [[1, 0, 0, 1, 10, 10], null], [20, 0, 0, 20, 0, 0], [{}], null, ["tiny"]];
  const r = imageRegions(fn, args, OPS, base);
  assert.equal(r.length, 2, "the last one paints a 1×1 unit square: too small");
  assert.deepEqual(r[0], { left: 50, top: 100, width: 200, height: 100 });
  assert.deepEqual(r[1], { left: 10, top: 770, width: 20, height: 20 });
  assert.deepEqual(mul([1, 0, 0, 1, 5, 5], [2, 0, 0, 2, 0, 0]), [2, 0, 0, 2, 5, 5]);
});

console.log(`\n${n} groups passed`);
