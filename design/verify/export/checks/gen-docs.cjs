// Build the kitchen-sink HTML and the paged document inside the app (real services), save them as files.
const fs = require("fs");
const { open } = require("./boot.cjs");
const seed = require("./seed.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
(async () => {
  const { b, p } = await open();
  const ids = await seed(p);
  const r = await p.evaluate(async (ksId) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const mk = (format, extra = {}) => ({ format, scope: { kind: "note", ids: [ksId] }, opts: { ...pd.PRINT_DEFAULTS, toc: true, titlePage: true, headerFooter: true, ...extra }, htmlFolder: false, engine: "auto" });
    const h = await run.previewDoc(mk("html"), {});
    const pg = await run.previewDoc(mk("pdf"), {});
    return { html: h.html, hw: h.doc.warnings, paged: await run.pagedDocument(pg.doc.html), pw: pg.doc.warnings, plain: pg.doc.html };
  }, ids.ks);
  fs.writeFileSync(OUT + "/kitchen-sink.html", r.html);
  fs.writeFileSync(OUT + "/kitchen-sink.paged.html", r.paged);
  console.log("html bytes", r.html.length, "paged bytes", r.paged.length, JSON.stringify(r.hw));
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
