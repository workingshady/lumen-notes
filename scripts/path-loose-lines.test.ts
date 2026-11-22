// A save from the app (parse → serialize) must never drop the owner's loose lines inside a path.
import { parsePath, serializePath } from "../src/lib/path";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const body = `---
type: path
courses: [A]
---
# P

Intro text.

## Stage 1 · One
Stage note before any concept.
- Alpha = a | b
  - note: [[Alpha]]

https://www.youtube.com/watch?v=abc123

A paragraph the owner wrote.
- Beta
  - review: 2026-11-23 1
`;
const once = serializePath(parsePath(body));
ok(once.includes("https://www.youtube.com/watch?v=abc123"), "bare link kept");
ok(once.includes("A paragraph the owner wrote."), "paragraph kept");
ok(once.includes("Stage note before any concept."), "stage-level line kept");
ok(once.includes("  - review: 2026-11-23 1"), "review kept");
ok(serializePath(parsePath(once)) === once, "stable on a second save");
const d = parsePath(once);
ok(d.stages[0].concepts.length === 2 && d.stages[0].concepts[0].aliases.join("|") === "a|b", "concepts unchanged");
console.log(`path-loose-lines: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
