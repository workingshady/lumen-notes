// Cloze + image occlusion parser tests. Run: npx tsx scripts/cloze.test.ts
import assert from "node:assert/strict";
import { clozeBack, clozeBlocks, clozeCards, clozeEnabled, clozeFront, findClozes } from "../src/lib/cloze";
import { clampBox, newOcclusion, nextBoxId, noteImages, occlusionBlocks, occlusionCards, occlusionFence, parseOcclusion, serializeOcclusion, writeOcclusion } from "../src/lib/occlusion";
import { flashcards } from "../src/lib/parse";
import MarkdownIt from "markdown-it";
import mark from "markdown-it-mark";
import { clozePlugin, occlusionHtml } from "../src/lib/cloze-md";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };

t("anki syntax with hint, same number = one card", () => {
  const s = findClozes("The {{c1::mitochondria::organelle}} is the {{c2::powerhouse}} of the {{c1::cell}}.", false);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.n), [1, 2, 1]);
  assert.equal(s[0].answer, "mitochondria");
  assert.equal(s[0].hint, "organelle");
  const cards = clozeCards("The {{c1::mitochondria::organelle}} is the {{c2::powerhouse}} of the {{c1::cell}}.");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].q, "The [organelle] is the powerhouse of the […].");
  assert.equal(cards[0].a, "mitochondria · cell");
  assert.equal(cards[1].q, "The mitochondria is the [powerhouse] of the cell.".replace("[powerhouse]", "[…]"));
});

t("math inside cloze, inline code ignored", () => {
  const s = findClozes("Derivative: {{c1::$\\frac{d}{dx}x^2 = 2x$}} and `{{c2::code}}`", false);
  assert.equal(s.length, 1);
  assert.equal(s[0].answer, "$\\frac{d}{dx}x^2 = 2x$");
});

t("==mark== only in flashcard notes", () => {
  const plain = "Some ==highlight== here.";
  assert.equal(flashcards(plain).length, 0);
  const deck = "---\ntype: flashcards\n---\nParis is the ==capital== of ==France==.\n\nColour ==green=={.hl-green} stays a highlight.";
  assert.ok(clozeEnabled(deck));
  const c = flashcards(deck);
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.kind === "cloze"));
  assert.equal(c[0].line, 3);
  assert.equal(c[0].q, "Paris is the […] of France.");
  assert.ok(clozeEnabled("---\ncloze: true\n---\nx"));
  assert.ok(!clozeEnabled("---\ntype: note\n---\nx"));
});

t("marks numbered after anki numbers in a block", () => {
  const s = findClozes("A {{c1::x}} and ==y== and {{c2::z}}", true);
  assert.deepEqual(s.map((x) => [x.n, x.kind]), [[1, "anki"], [3, "mark"], [2, "anki"]]);
});

t("front/back markup", () => {
  const b = clozeBlocks("- The {{c1::heart::organ}} pumps {{c2::blood}}")[0];
  assert.equal(clozeFront(b, 1), "The {{?::organ}} pumps blood");
  assert.equal(clozeBack(b, 1), "The {{!::heart}} pumps blood");
  assert.equal(clozeFront(b, 2), "The heart pumps {{?::}}");
});

t("stable keys: editing another block keeps the key", () => {
  const a = flashcards("Intro.\n\nThe {{c1::sun}} is a star.\n\nOther.");
  const b = flashcards("Intro changed a lot.\n\nNew paragraph.\n\nThe {{c1::sun}} is a star.\n\nOther {{c1::thing}}.");
  assert.equal(a.length, 1);
  assert.ok(b.some((x) => x.key === a[0].key));
  assert.notEqual(b[0].key, b[1].key);
});

t("basic cards untouched, code fences skipped, Q :: A lines not cloze", () => {
  const md = "Q :: A\n\n```\n{{c1::no}}\n```\n\nQ2 :: {{c1::A2}}\n\nreal {{c1::yes}}";
  const c = flashcards(md);
  assert.equal(c.length, 3);
  assert.equal(c[0].key, flashcards("Q :: A")[0].key);
  assert.equal(c[2].kind, "cloze");
  assert.equal(c[2].line, 8);
});

t("paragraph across lines = one block; list items separate", () => {
  const bl = clozeBlocks("line {{c1::a}}\nline {{c1::b}}\n\n- item {{c1::c}}\n- item {{c1::d}}");
  assert.equal(bl.length, 3);
  assert.equal(bl[0].line, 0);
  assert.equal(bl[2].line, 4);
});

t("occlusion YAML round trip", () => {
  const o = { ...newOcclusion("att:abc123"), id: "oc-test", alt: "Transformer block" };
  o.boxes.push({ id: "b1", x: 0.1, y: 0.2, w: 0.3, h: 0.05, label: "Multi-head attention" });
  o.boxes.push({ id: "b2", x: 0.1, y: 0.4, w: 0.3, h: 0.05, label: "Add & norm", group: "norm" });
  o.boxes.push({ id: "b3", x: 0.1, y: 0.6, w: 0.3, h: 0.05, label: "Add & norm", group: "norm" });
  o.boxes.push({ id: "b4", x: 0.5, y: 0.6, w: 0.2, h: 0.05, label: "true" });
  const back = parseOcclusion(serializeOcclusion(o));
  assert.equal(back.error, undefined);
  assert.deepEqual(back.data, o);
  assert.equal(nextBoxId(o), "b5");
});

t("occlusion JSON and block-style YAML", () => {
  const j = parseOcclusion('{"image":"https://x.org/a.png","mode":"hide-all","boxes":[{"id":"k","x":0.9,"y":0.9,"w":0.3,"h":0.3}]}');
  assert.equal(j.data.mode, "hide-all");
  assert.deepEqual(clampBox(j.data.boxes[0]), j.data.boxes[0]);
  assert.equal(j.data.boxes[0].x, 0.7);
  const y = parseOcclusion("image: att:zz\nboxes:\n  - id: a\n    x: 0.1\n    y: 0.1\n    w: 0.2\n    h: 0.2\n    label: \"Encoder, left\"\n");
  assert.equal(y.data.boxes.length, 1);
  assert.equal(y.data.boxes[0].label, "Encoder, left");
  assert.ok(parseOcclusion("{bad json").error);
});

t("occlusion cards: one per box, one per group, stable keys", () => {
  const o = newOcclusion("att:img1");
  o.id = "oc-q";
  o.boxes = [{ id: "b1", x: 0, y: 0, w: 0.1, h: 0.1 }, { id: "b2", x: 0.2, y: 0, w: 0.1, h: 0.1, group: "g" }, { id: "b3", x: 0.4, y: 0, w: 0.1, h: 0.1, group: "g" }];
  const md = `# Note\n\n${occlusionFence(o)}\n\nafter`;
  const cards = occlusionCards(md);
  assert.deepEqual(cards.map((c) => c.key), ["oc-oc-q-b1", "oc-oc-q-g.g"]);
  assert.deepEqual(cards[1].target, ["b2", "b3"]);
  assert.equal(cards[0].line, 2);
  const fc = flashcards(md);
  assert.equal(fc.length, 2);
  assert.equal(fc[0].kind, "occlusion");
  // moving a box keeps its key
  const moved = { ...o, boxes: o.boxes.map((b) => (b.id === "b1" ? { ...b, x: 0.5 } : b)) };
  const md2 = writeOcclusion(md, moved);
  assert.equal(occlusionBlocks(md2)[0].data.boxes[0].x, 0.5);
  assert.equal(occlusionCards(md2)[0].key, cards[0].key);
  assert.ok(md2.endsWith("\n\nafter"));
});

t("no image → no cards; images found in note", () => {
  assert.equal(occlusionCards("```occlusion\nimage: \nboxes: []\n```").length, 0);
  assert.deepEqual(noteImages("![a](att:x1) text ![b](https://e.com/p.png) ![a](att:x1)").map((i) => i.src), ["att:x1", "https://e.com/p.png"]);
});

t("markdown-it rendering (cloze-md plugin)", () => {
  const md = new MarkdownIt().use(mark).use(clozePlugin);
  const h = md.render("A {{c1::**bold**::hint}} b ==hl== c {{?::}} d {{?::organ}} e {{!::ans}}");
  assert.ok(h.includes('<span class="cloze" data-c="1" title="hint"><strong>bold</strong></span>'), h);
  assert.ok(h.includes("<mark>hl</mark>"));
  assert.ok(h.includes('<span class="cloze-gap">[…]</span>') && h.includes('<span class="cloze-gap">[organ]</span>'));
  assert.ok(h.includes('<span class="cloze-ans">ans</span>'));
  assert.ok(md.render("x ==y==", { cloze: true }).includes('<mark class="cloze">y</mark>'));
  const occ = occlusionHtml("image: att:abc\nboxes:\n  - {id: b1, x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: Hi}", ' data-line="0"');
  assert.ok(occ.includes('data-att="abc"') && occ.includes("left:10%;top:20%;width:30%;height:10%") && occ.includes("1 card<"));
  assert.ok(!occlusionHtml("image: javascript:alert(1)", "").includes("javascript:"));
});

console.log(`\n${n} tests passed`);
