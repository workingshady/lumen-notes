const { open } = require("./boot.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
(async () => {
  const { b, p } = await open();
  await p.evaluate(async () => { const m = await import("/src/lib/diagram-export.ts"); m.openDiagramExport("graph LR\n A[Start] --> B[End]", "demo"); });
  await p.waitForSelector("[role=dialog][aria-label=Export]", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => [...document.querySelectorAll("[role=dialog] [role=button]")].find((x) => /^PDF/.test(x.textContent))?.click());
  await new Promise((r) => setTimeout(r, 2500));
  const txt = await p.evaluate(() => document.querySelector("[role=dialog][aria-label=Export]").innerText.replace(/\n+/g, " | "));
  console.log(/Print theme/.test(txt) ? "PASS print theme toggle present" : "FAIL no print theme toggle", "\n", txt.slice(0, 600));
  await p.screenshot({ path: OUT + "/07-visual-export-pdf-print-theme.png" });
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
