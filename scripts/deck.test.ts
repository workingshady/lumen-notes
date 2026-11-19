// Deck editing + doc → deck tests (src/lib/deck.ts). Run: npx tsx scripts/deck.test.ts
import assert from "node:assert/strict";
import { autoSplit, deckSlides, docToDeck, moveSlide, planSlide, setSlideDirectives } from "../src/lib/deck";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const deck = "---\ntype: slides\n---\n# One\n\n---\n\n<!-- layout: center; class: invert -->\n## Two\n\nText\n\n---\n\n## Three\n";

t("setSlideDirectives adds a comment line to a slide without one", () => {
  const b = setSlideDirectives(deck, 0, { layout: "title" });
  const s = deckSlides(b);
  assert.equal(s.length, 3);
  assert.equal(s[0].dirs.layout, "title");
  assert.equal(planSlide(s[0].md, s[0].dirs).layout, "title");
  assert.match(b, /^---\ntype: slides\n---\n<!-- layout: title -->\n# One/);
});
t("setSlideDirectives rewrites an existing comment, keeps other keys, `_class` keeps the carried class", () => {
  const b = setSlideDirectives(deck, 1, { layout: "two-cols", _class: "accent" });
  assert.match(b, /<!-- layout: two-cols; class: invert; _class: accent -->/);
  const s = deckSlides(b);
  assert.equal(s[1].dirs.class, "accent");
  assert.equal(s[2].dirs.class, "invert"); // carried to the next slide
});
t("setSlideDirectives removes the comment when empty; layout replaces _layout", () => {
  const a = setSlideDirectives("<!-- _layout: stat -->\n# X\n", 0, { layout: "quote" });
  assert.equal(a, "<!-- layout: quote -->\n# X\n");
  assert.equal(setSlideDirectives("<!-- layout: stat -->\n# X\n", 0, { layout: null }), "# X\n");
});
t("moveSlide reorders and keeps front-matter", () => {
  const b = moveSlide(deck, 2, 0);
  const s = deckSlides(b);
  assert.match(b, /^---\ntype: slides\n---\n## Three/);
  assert.equal(s.length, 3);
  assert.match(s[2].md, /## Two/);
  assert.equal(moveSlide(deck, 1, 1), deck);
});
const doc = "# Backprop\n\nShort intro.\n\n## A\n\nText a.\n\n### A1\n\nMore.\n\n## B\n\nText b.\n";
t("docToDeck split options", () => {
  const h2 = deckSlides(docToDeck(doc, "Backprop", "h2"));
  assert.equal(h2.length, 3); // title + A + B
  const auto = docToDeck(doc, "Backprop");
  assert.equal(docToDeck(doc, "Backprop"), auto, "deterministic");
  assert.equal(autoSplit(doc), "h2");
  const hr = deckSlides(docToDeck("# T\n\nIntro\n\n---\n\n## X\n\nOne\n\n---\n\nPlain part\n", "T", "hr"));
  assert.equal(hr.length, 3);
  assert.equal(autoSplit("# T\n\nA\n\n---\n\nB\n"), "hr");
});
console.log(`${n} passed`);
