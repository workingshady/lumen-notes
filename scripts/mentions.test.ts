// Unlinked mentions: masking, word boundaries (English + Arabic), link rewrites.
// Run: npx tsx scripts/mentions.test.ts
import { aliasesOf, findMentions, ignoredOf, linkFor, linkMentions, maskBody, relocate } from "../src/lib/mentions";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }

// masking keeps length
const b0 = "---\ntitle: Gradient descent\n---\n# Notes\nSee `Gradient descent` and [[Gradient descent]] or [x](https://a.b/Gradient-descent).";
ok(maskBody(b0).length === b0.length, "mask keeps length");
ok(findMentions(b0, ["Gradient descent"]).length === 0, "no mentions inside front-matter, code, wikilink, md link");

// plain mention, case-insensitive
const b1 = "# Week 1\n\nToday we covered gradient descent. Then Gradient Descent again.\n";
const m1 = findMentions(b1, ["Gradient descent"]);
ok(m1.length === 2, "two plain mentions");
ok(m1[0].text === "gradient descent" && m1[0].match === "gradient descent", "text as written");
ok(m1[0].before.includes("Today we covered") && m1[0].after.startsWith("."), "sentence context");
ok(linkFor(m1[0], "Gradient descent") === "[[Gradient descent|gradient descent]]", "case differs → alias form");
ok(linkFor({ text: "Gradient descent" }, "Gradient descent") === "[[Gradient descent]]", "same case → plain link");

// word boundaries
ok(findMentions("Transformers are big.", ["Transformer"]).length === 0, "no match inside a longer word");
ok(findMentions("A subtransformer.", ["transformer"]).length === 0, "no match with a prefix");
ok(findMentions("Use a transformer, then stop.", ["Transformer"]).length === 1, "punctuation is a boundary");
ok(findMentions("A tag #transformer here", ["transformer"]).length === 0, "#tags are not mentions");
ok(findMentions("See https://x.com/transformer now", ["transformer"]).length === 0, "URL is not a mention");
ok(findMentions("```\ntransformer\n```\n", ["transformer"]).length === 0, "fenced code is not a mention");
ok(findMentions("Math $transformer$ here", ["transformer"]).length === 0, "inline math is not a mention");
ok(findMentions("ab", ["ab"]).length === 0, "terms shorter than 3 chars are ignored");

// aliases: longest wins, alias form keeps written text
const m2 = findMentions("We use SGD and stochastic gradient descent.", ["Stochastic gradient descent", "SGD", "gradient descent"]);
ok(m2.length === 2 && m2[1].text === "stochastic gradient descent", "longest overlapping term wins");
ok(m2[0].term === "SGD", "alias recorded");

// Arabic: normalization + proclitics + diacritics
const ar = "درسنا الشبكة العصبية اليوم. والشبكةُ مهمة. شبكات أخرى.";
const m3 = findMentions(ar, ["شبكة"]);
ok(m3.length === 2, "Arabic: الشبكة + والشبكةُ (not شبكات): got " + m3.length);
ok(m3[0].text === "الشبكة", "Arabic proclitic included in link text");
ok(m3[1].text === "والشبكةُ", "trailing diacritic kept in the link text");
ok(findMentions("إحصاء وصفي", ["احصاء"]).length === 1, "alef forms normalized");
ok(findMentions("مدرسة", ["رسه"]).length === 0, "no Arabic match inside a word");

// rewrite
const linked = linkMentions(b1, m1, "Gradient descent");
ok(linked.includes("covered [[Gradient descent|gradient descent]].") && linked.includes("Then [[Gradient descent|Gradient Descent]] again"), "linkMentions rewrites all");
ok(findMentions(linked, ["Gradient descent"]).length === 0, "after linking no unlinked mention remains");
ok(linkMentions(ar, [m3[0]], "شبكة").includes("درسنا [[شبكة|الشبكة]] العصبية"), "Arabic rewrite");

// relocate after an edit shifted offsets
const edited = "Intro line.\n" + b1;
const r = relocate(edited, ["Gradient descent"], m1[1], 0);
ok(!!r && r.text === "Gradient Descent" && r.start === m1[1].start + 12, "relocate finds the shifted occurrence");

// front-matter helpers
ok(aliasesOf("[SGD, \"Stochastic GD\"]", "sgd").join("|") === "SGD|Stochastic GD|sgd", "aliasesOf merges");
ok(ignoredOf("[Week 1, Week 2]").length === 2, "ignoredOf parses list");

// performance: 800 notes × 3 KB
const big = Array.from({ length: 800 }, (_, i) => `# Note ${i}\n\n` + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(50) + (i % 10 ? "" : " gradient descent here."));
const t0 = performance.now();
let n = 0;
for (const b of big) n += findMentions(b, ["Gradient descent", "GD"]).length;
const ms = performance.now() - t0;
ok(n === 80, "perf corpus mentions: " + n);
console.log(`800 notes scanned in ${ms.toFixed(0)} ms (without the pre-filter)`);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
