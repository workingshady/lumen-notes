// Edge identity (parallel edges, renames) and AI edits as minimal ops.
// Run: npx esbuild scripts/arch-ops.test.ts --bundle --platform=node --format=cjs --outfile=/tmp/t.cjs && node /tmp/t.cjs
import { archFromDsl, emptyArch } from "../src/lib/arch-starters";
import { printDsl, applyDsl, parseDsl } from "../src/lib/arch-dsl";
import { applyMinimalEdit } from "../src/lib/arch-ops";
import { diffArch } from "../src/lib/arch-model";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fail++; };
const pts = (e: { lumenEdge?: unknown } | undefined) => (e?.lumenEdge as { points?: { x: number }[] } | undefined)?.points;

const dsl0 = `direction right
// the entry point
User [icon: user]
API [icon: service, tech: "Go"]
DB [icon: database]
User > API: HTTPS
// first call
API > DB: read
API > DB: write (async)
`;
let c = archFromDsl("architecture", dsl0, emptyArch("architecture"));
c = { ...c, nodes: c.nodes.map((n, i) => ({ ...n, x: 100 * i, y: 7 * i })), lumenArch: { ...c.lumenArch, dsl: dsl0 } };
const [e1, e2, e3] = c.edges;
c = { ...c, edges: c.edges.map((e) => (e.id === e3.id ? { ...e, lumenEdge: { ...e.lumenEdge, points: [{ x: 5, y: 6 }] } } : e.id === e2.id ? { ...e, lumenEdge: { ...e.lumenEdge, points: [{ x: 1, y: 2 }] } } : e)) as typeof c.edges };

// 4. parallel edges: drop the first one in the code, the surviving edge keeps its id and points
const r1 = applyDsl(c, parseDsl(dsl0.replace("API > DB: read\n", ""), "architecture").doc, "x");
const w = r1.edges.find((e) => e.label === "write");
ok(w?.id === e3.id && pts(w)?.[0].x === 5, "parallel: remaining edge keeps its id and points");
const p = printDsl(c, dsl0);
ok(p.split("\n").filter((l) => /^API (>|-->) DB/.test(l)).length === 2, "both parallel edges printed");
ok(p.includes("// first call"), "comment of first parallel edge kept");
const dslC = dsl0.replace("API > DB: write (async)", "// write note\nAPI --> DB: write");
const pc = printDsl({ ...c, lumenArch: { ...c.lumenArch, dsl: dslC } }, dslC).split("\n");
ok(pc[pc.indexOf("API --> DB: write") - 1] === "// write note", "comment stays above the 2nd parallel edge");

// 3. AI edit as minimal ops: rename DB -> Database, add Cache + edge, drop tech on API
const ai = `direction right
User [icon: user]
API [icon: service]
Database [icon: database]
Cache [icon: cache]
User > API: HTTPS
API > Cache: lookup
API > Database: read
API > Database: write (async)
`;
const m = applyMinimalEdit(c, dsl0, ai);
console.log(m.ops.map((o) => o.op).join(" | "));
const db0 = c.nodes.find((n) => n.lumenNode?.name === "DB")!;
const dbN = m.canvas.nodes.find((n) => n.lumenNode?.name === "Database");
ok(!!dbN && dbN.id === db0.id && dbN.x === db0.x, "rename keeps id and position");
ok(m.ops.some((o) => o.op === "renameNode"), "rename detected as an op, not remove + add");
ok(pts(m.canvas.edges.find((e) => e.id === e3.id))?.[0].x === 5, "edge points survive a rename of its endpoint");
ok(m.dsl.includes("// the entry point") && m.dsl.includes("// first call"), "DSL comments survive");
const cache = m.canvas.nodes.find((n) => n.lumenNode?.name === "Cache");
ok(!!cache, "Cache added");
const d = diffArch(c, m.canvas);
ok(d.nodes.get(cache!.id) === "add" && d.nodes.get(db0.id) === "chg", "diff colours: added green, renamed amber");
ok([...d.edges.values()].filter((v) => v === "add").length === 1 && ![...d.edges.values()].includes("del"), "diff edges: one added, none removed");

// reconnect keeps the edge (id, label style), drops its old route
const m2 = applyMinimalEdit(c, dsl0, dsl0.replace("User > API: HTTPS", "User > DB: HTTPS"));
const re = m2.canvas.edges.find((e) => e.id === e1.id);
ok(!!re && re.toNode === db0.id && m2.ops.some((o) => o.op === "reconnect"), "reconnect keeps the edge id");

let threw = false;
try { applyMinimalEdit(c, dsl0, "A > > B ["); } catch { threw = true; }
ok(threw, "parse error throws (caller retries once)");
process.exit(fail ? 1 : 0);
