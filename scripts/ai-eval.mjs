// Small eval for POST /api/ai/visual/convert (worker/ext/ai-visual.ts).
//
//   node scripts/ai-eval.mjs                      # against http://localhost:8787 (wrangler dev), needs LUMEN_PASSCODE or LUMEN_TOKEN
//   LUMEN_URL=https://your.workers.dev LUMEN_TOKEN=... node scripts/ai-eval.mjs   # deployed: ONLY runs when LUMEN_TOKEN is set
//
// Renders 5 sample images (handwriting-like text in a cursive font, a math line, a hand-drawn flowchart) with sharp + SVG,
// sends each, and prints per-sample accuracy (text: 1 - normalised edit distance; math: same on whitespace-free LaTeX;
// mermaid: share of expected labels found, minus a penalty when arrows are missing). Each call spends neurons.
// Note: cached results (24 h) come back instantly with neurons 0; vary the samples to re-test the model.
import sharp from "sharp";

const BASE = (process.env.LUMEN_URL || "http://localhost:8787").replace(/\/$/, "");
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
let token = process.env.LUMEN_TOKEN || "";
if (!local && !token) { console.error("Refusing to call a non-local endpoint without LUMEN_TOKEN set."); process.exit(2); }

async function login() {
  if (token) return token;
  const passcode = process.env.LUMEN_PASSCODE;
  if (!passcode) { console.error("Set LUMEN_TOKEN, or LUMEN_PASSCODE for a local wrangler dev."); process.exit(2); }
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed", r.status); process.exit(2); }
  return (await r.json()).token;
}

const FONT = "'Segoe Script','Brush Script MT','Lucida Handwriting','Comic Sans MS',cursive";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const textSvg = (lines, w = 900) => {
  const h = 90 + lines.length * 80;
  const rows = lines.map((l, i) => `<text x="40" y="${90 + i * 80}" font-family="${FONT}" font-size="46" fill="#1a1a2e" transform="rotate(${(i % 2 ? 0.8 : -0.6)} 40 ${90 + i * 80})">${esc(l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${rows}</svg>`;
};
// Wobbly hand-drawn box / arrow paths (deterministic jitter).
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 5;
const box = (x, y, w, h, label) => {
  const p = `M${x + rnd()},${y + rnd()} L${x + w + rnd()},${y + rnd()} L${x + w + rnd()},${y + h + rnd()} L${x + rnd()},${y + h + rnd()} Z`;
  return `<path d="${p}" fill="none" stroke="#222" stroke-width="3" stroke-linejoin="round"/><text x="${x + w / 2}" y="${y + h / 2 + 8}" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#222">${esc(label)}</text>`;
};
const diamond = (cx, cy, r, label) => `<path d="M${cx + rnd()},${cy - r} L${cx + r},${cy + rnd()} L${cx + rnd()},${cy + r} L${cx - r},${cy + rnd()} Z" fill="none" stroke="#222" stroke-width="3"/><text x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="${FONT}" font-size="24" fill="#222">${esc(label)}</text>`;
const arrow = (x1, y1, x2, y2) => {
  const a = Math.atan2(y2 - y1, x2 - x1), hx = (d) => [x2 - 14 * Math.cos(a + d), y2 - 14 * Math.sin(a + d)];
  const [ax, ay] = hx(0.4), [bx, by] = hx(-0.4);
  return `<path d="M${x1},${y1} Q${(x1 + x2) / 2 + rnd()},${(y1 + y2) / 2 + rnd()} ${x2},${y2} M${ax},${ay} L${x2},${y2} L${bx},${by}" fill="none" stroke="#222" stroke-width="3" stroke-linecap="round"/>`;
};
const flowSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="360"><rect width="100%" height="100%" fill="#fff"/>
${box(30, 130, 150, 80, "Start")}${arrow(180, 170, 270, 170)}${box(270, 130, 170, 80, "Read file")}${arrow(440, 170, 530, 170)}${diamond(600, 170, 70, "Valid?")}
${arrow(670, 170, 780, 170)}${box(780, 130, 170, 80, "Save")}${arrow(600, 240, 600, 300)}${box(520, 300, 160, 50, "Error")}</svg>`;

const SAMPLES = [
  { name: "note-1", kind: "text", svg: textSvg(["Buy milk and eggs", "Call Sarah on Monday", "Finish the report draft"]), expect: "Buy milk and eggs\nCall Sarah on Monday\nFinish the report draft" },
  { name: "note-2", kind: "text", svg: textSvg(["Meeting moved to Thursday 3 pm", "Bring the signed contract"]), expect: "Meeting moved to Thursday 3 pm\nBring the signed contract" },
  { name: "math-1", kind: "math", svg: textSvg(["x = (-b ± √(b² - 4ac)) / 2a"]), expect: "x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}" },
  { name: "flow-1", kind: "mermaid", svg: flowSvg(), labels: ["Start", "Read file", "Valid?", "Save", "Error"], arrows: 4 },
  { name: "flow-text", kind: "text", svg: flowSvg(), expect: "Start Read file Valid? Save Error", bag: true },
];

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

function score(s, out) {
  if (s.kind === "text" && s.bag) { const words = norm(out).split(/[^\p{L}\p{N}?]+/u); return s.expect.split(/\s+(?=[A-Z])/).length && ["start", "read", "file", "valid?", "save", "error"].filter((w) => words.includes(w)).length / 6; }
  if (s.kind === "text") return sim(norm(out), norm(s.expect));
  if (s.kind === "math") return sim(out.replace(/\s+/g, "").replace(/\\left|\\right|\\,/g, ""), s.expect);
  const found = s.labels.filter((l) => norm(out).includes(norm(l))).length / s.labels.length;
  const arrows = (out.match(/-->|---|==>|-\.->/g) || []).length;
  return found * Math.min(1, 0.6 + 0.4 * (arrows / s.arrows));
}

const tk = await login();
let total = 0;
console.log(`Endpoint ${BASE}\n`);
for (const s of SAMPLES) {
  const png = await sharp(Buffer.from(s.svg)).flatten({ background: "#fff" }).png().toBuffer();
  const t0 = Date.now();
  let r, body;
  try {
    r = await fetch(BASE + "/api/ai/visual/convert", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tk }, body: JSON.stringify({ image: "data:image/png;base64," + png.toString("base64"), kind: s.kind }) });
    body = await r.json().catch(() => ({}));
  } catch (e) { console.log(`${s.name.padEnd(10)} ${s.kind.padEnd(8)} NETWORK ERROR ${e.message}`); continue; }
  const ms = Date.now() - t0;
  if (!r.ok) { console.log(`${s.name.padEnd(10)} ${s.kind.padEnd(8)} HTTP ${r.status} ${body.code || ""} ${body.error || ""}`); continue; }
  const acc = score(s, body.text || "");
  total += acc;
  console.log(`${s.name.padEnd(10)} ${s.kind.padEnd(8)} ${(acc * 100).toFixed(0).padStart(3)}%  ${ms} ms  ${body.model}  neurons ${body.neurons}${body.cached ? " (cached)" : ""}`);
  console.log("   " + (body.text || "").replace(/\n/g, "\n   ").slice(0, 400));
}
console.log(`\nMean accuracy ${(total / SAMPLES.length * 100).toFixed(0)}% over ${SAMPLES.length} samples`);
