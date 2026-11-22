import { readFileSync } from "node:fs";
const lib = await import("file:///D:/90_Graveyard/lumen-export/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const file = process.argv[2];
const doc = await lib.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
console.log("pages", doc.numPages);
const want = (process.argv[3] || "1,2,3").split(",").map(Number);
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i);
  const vp = pg.getViewport({ scale: 1 });
  if (!want.includes(i)) { if (process.argv[4] === "sizes") console.log("page", i, Math.round(vp.width), "x", Math.round(vp.height)); continue; }
  const tc = await pg.getTextContent();
  // group by line (y)
  const lines = new Map();
  for (const it of tc.items) { const y = Math.round(it.transform[5]); lines.set(y, (lines.get(y) || "") + (lines.get(y) ? " " : "") + it.str); }
  console.log(`--- page ${i} (${Math.round(vp.width)}x${Math.round(vp.height)})`);
  console.log([...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.trim()).filter(Boolean).join("\n"));
}
