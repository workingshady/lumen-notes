// R4 Editor & Read: slash catalog / detection, block glyphs, Read-mode Markdown (status, glyph, cards, caption, px columns).
// Run: npx tsx scripts/editor-read.test.ts  (Read-mode Markdown checks run in the browser: kj/r4-md.mjs)
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { GALLERY, SLASH, slashById, slashContext, slashMatch, slashSearchAll, slashSuggest } from "../src/lib/slash";
import { blockGlyph, parseBlocks, turnTargetOf } from "../src/lib/blocks";
import { hasGlyph } from "../src/lib/glyphs";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };

t("catalog: 55+ commands, unique ids, every glyph exists, design groups", () => {
  assert.ok(SLASH.length >= 55);
  assert.equal(new Set(SLASH.map((c) => c.id)).size, SLASH.length);
  for (const c of SLASH) assert.ok(hasGlyph(c.glyph), `glyph ${c.glyph} for ${c.id}`);
  assert.equal(slashById("occlusion")?.glyph, "occlusion");
  assert.equal(slashById("timestamp")?.glyph, "timestamp");
  for (const g of GALLERY) for (const id of g.ids) assert.ok(slashById(id)?.thumb, `gallery ${id} has a thumbnail`);
});
t("matching: label prefix first, aliases (Notion/Confluence/Obsidian), // = date", () => {
  assert.equal(slashMatch("col")[0].id, "cols2");
  assert.equal(slashMatch("h2")[0].id, "h2");
  assert.ok(slashMatch("admonition").length > 3);
  assert.ok(slashMatch("todo").some((c) => c.id === "todo"));
  assert.deepEqual(slashMatch("/").map((c) => c.id), ["date"]);
  assert.equal(slashMatch("kanban").length, 0);
  assert.equal(slashSuggest("kanban").word, "board");
  assert.ok(slashSearchAll("clmns").some((c) => c.id === "cols2"));
});
t("detection: line start / after space, not in URLs or code fences", () => {
  const at = (doc: string) => slashContext(EditorState.create({ doc, selection: { anchor: doc.length } }));
  assert.deepEqual(at("/"), { from: 0, to: 1, query: "" });
  assert.equal(at("hello /tab")?.query, "tab");
  assert.equal(at("see https://x.com/a"), null);
  assert.equal(at("```\n/"), null);
  assert.ok(at("```\nx\n```\n/"));
});
t("blocks: glyph + current Turn-into target", () => {
  const lines = ["# T", "", "## Sub", "", "- [ ] a", "", "> [!tip] x", "", "text"];
  const b = parseBlocks(lines);
  assert.deepEqual(b.map((x) => blockGlyph(x, lines[x.a])), ["h1", "h2", "task", "c-tip", "text"]);
  assert.deepEqual(b.map((x) => turnTargetOf(x, lines[x.a])), ["h1", "h2", "todo", "callout:tip", "paragraph"]);
});
console.log(`\n${n} tests passed`);
