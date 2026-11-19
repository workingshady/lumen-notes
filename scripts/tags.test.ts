// Nested tags + tag rewrite (src/lib/tag-tree.ts, src/lib/tag-ops.ts). Run: npx tsx scripts/tags.test.ts
import assert from "node:assert/strict";
import { cleanTag, fuzzyTags, tagColor, tagTree } from "../src/lib/tag-tree";
import { mapTag, rewriteTagInBody } from "../src/lib/tag-ops";

// tree + roll-up
const tree = tagTree([["ml/llm", 38], ["ml/vision", 64], ["ml", 10], ["arabic", 91], ["ml/llm/rag", 7]], { ml: "6", arabic: "5" }, ["arabic"]);
assert.equal(tree[0].path, "arabic"); // pinned first
const ml = tree.find((n) => n.path === "ml")!;
assert.equal(ml.count, 10 + 64 + 38 + 7);
assert.equal(ml.children[0].path, "ml/vision");
assert.equal(ml.children[1].children[0].path, "ml/llm/rag");
assert.equal(ml.children[1].count, 45);
assert.equal(ml.children[1].color, "#A371F7"); // inherited
assert.equal(tagColor("x", {}), null);
// implicit parents
assert.equal(tagTree([["a/b/c", 2]])[0].children[0].children[0].count, 2);

// fuzzy
const f = fuzzyTags("to", [["ml/tokenization", 12], ["ml/torch", 3], ["tools", 6], ["nlp", 9]]);
assert.deepEqual(f.map((x) => x.tag), ["tools", "ml/tokenization", "ml/torch"]);
assert.equal(f[1].from, 3);
assert.equal(fuzzyTags("ml/to", [["ml/tokenization", 12], ["tools", 6]])[0].tag, "ml/tokenization");
assert.equal(cleanTag("#ML/ To "), "ml/to");
assert.equal(cleanTag("#Deep Learning"), "deep-learning");

// rename / delete in bodies
assert.equal(mapTag("ml/llm/rag", "ml/llm", "ai/llm"), "ai/llm/rag");
assert.equal(mapTag("ml/llmx", "ml/llm", "ai"), "ml/llmx");
const body = "---\ntags: [ml/llm, nlp]\n---\n# T\n\nAbout #ml/llm and #ml/llm/rag, not #ml/llmx.\n```\n#ml/llm in code\n```\n#ml/llm\n";
const r = rewriteTagInBody(body, "ml/llm", "ai");
assert.match(r, /tags: \[ai, nlp\]/);
assert.match(r, /About #ai and #ai\/rag, not #ml\/llmx\./);
assert.match(r, /#ml\/llm in code/);
assert.match(r, /\n#ai\n$/);
const d = rewriteTagInBody(body, "ml/llm", null);
assert.match(d, /tags: \[nlp\]/);
assert.match(d, /About and, not #ml\/llmx\./);
assert.match(d, /#ml\/llm in code/);
console.log("tags: all passed");
const g = fuzzyTags("ml/to", [["ml/tokenization", 12], ["ml/torch", 3], ["tools", 6]]);
assert.deepEqual(g.map((x) => [x.tag, x.from, x.to]), [["ml/tokenization", 3, 5], ["ml/torch", 3, 5], ["tools", 0, 2]]);
console.log("fuzzy path: passed");
