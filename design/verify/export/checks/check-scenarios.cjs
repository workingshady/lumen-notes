const { open } = require("./boot.cjs");
const seed = require("./seed.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
const results = [];
const rec = (name, ok, extra = "") => { results.push([name, ok]); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
(async () => {
  const { b, p } = await open();
  const ids = await seed(p);
  await p.evaluate(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push({ name: this.download, href: this.href }); return; } return orig.call(this); };
    window.__open = 0; window.open = () => { window.__open++; return null; };
  });
  const ev = (fn, ...a) => p.evaluate(fn, ...a);

  const more = await ev(async () => {
    const act = await import("/src/lib/actions.ts");
    const db = await import("/src/lib/db.ts");
    const ar = await act.createNote({ title: "ملاحظة عربية", body: "# ملاحظة عربية\n\nهذه فقرة طويلة بالعربية للتحقق من اتجاه النص ومن الخطوط المضمّنة في ملف PDF.\n\n## جدول\n\n| الاسم | القيمة |\n|---|---|\n| أحمد | 12 |\n| سارة | 15 |\n\n- بند أول\n- بند ثان with English words\n", spaceId: "inbox" });
    const empty = await act.createNote({ title: "Empty note", body: "", spaceId: "inbox" });
    const cv = await act.createNote({ title: "Canvas only", body: '```canvas\n{"nodes":[{"id":"a","type":"text","text":"Only a canvas","x":0,"y":0,"width":200,"height":80}],"edges":[]}\n```\n', spaceId: "inbox" });
    const f = db.newFolder({ spaceId: "inbox", parentId: null, name: "Twenty" });
    await db.save("folder", f);
    for (let i = 1; i <= 20; i++) await act.createNote({ title: `Folder note ${i}`, body: `# Folder note ${i}\n\n## Part\n\nBody of note ${i}, see [[Folder note ${(i % 20) + 1}]].\n`, spaceId: "inbox", folderId: f.id });
    return { ar: ar.id, empty: empty.id, cv: cv.id, folder: f.id };
  });

  const build = (scope, format, opts = {}) => ev(async (scope, format, opts) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const r = await run.previewDoc({ format, scope, opts: { ...pd.PRINT_DEFAULTS, ...opts }, htmlFolder: false, engine: "auto" }, {});
    return { paged: r.paged, notes: r.doc.notes.length, toc: r.doc.toc.length, tocL1: r.doc.toc.filter((e) => e.level === 1).length, warnings: r.doc.warnings, css: r.doc.css, body: r.doc.body };
  }, scope, format, opts);

  // 1 dark theme active
  const dark = await ev(() => document.documentElement.dataset.dark);
  const paper = await build({ kind: "note", ids: [ids.ks] }, "pdf", { theme: "paper" });
  const screen = await build({ kind: "note", ids: [ids.ks] }, "pdf", { theme: "screen" });
  rec("dark app theme: paper theme prints light", dark === "1" && /--bg:#ffffff/.test(paper.css), "app dark=" + dark);
  rec("dark app theme: as-on-screen keeps the dark palette", /--bg:#0f1115/i.test(screen.css));
  // 2 Arabic
  const ar = await build({ kind: "note", ids: [more.ar] }, "html");
  rec("Arabic note: blocks carry dir, text intact", /dir="auto"/.test(ar.body) && /ملاحظة عربية/.test(ar.body));
  // 3 empty, canvas-only
  const em = await build({ kind: "note", ids: [more.empty] }, "pdf", { toc: true });
  rec("empty note exports (title only)", em.notes === 1 && em.toc === 1);
  const cvn = await build({ kind: "note", ids: [more.cv] }, "pdf");
  rec("canvas-embed-only note renders the canvas as SVG", /figure class="diagram"/.test(cvn.body) && /<svg/.test(cvn.body));
  // 4 twenty-note folder
  const tw = await build({ kind: "folder", folderId: more.folder }, "pdf", { toc: true, titlePage: true });
  rec("folder of 20 notes: one document, 20 sections, one TOC", tw.notes === 20 && tw.tocL1 === 20);
  // 5 offline
  await ev(async () => { const e = await import("/src/lib/print-env.ts"); await e.inlineKatexCss("x"); });
  await p.setOfflineMode(true);
  const off = await build({ kind: "note", ids: [ids.ks] }, "html", { toc: true });
  await p.setOfflineMode(false);
  rec("offline: still builds; math and diagrams present", off.notes === 1 && /class="katex/.test(off.body) && /figure class="diagram"/.test(off.body), JSON.stringify(off.warnings));
  // 6 Browser Rendering outcomes
  await ev((id) => { window.__ks = id; }, ids.ks);
  const flow = (status, mode) => ev(async (status, mode) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const realFetch = window.fetch;
    window.fetch = async (u, init) => {
      if (String(u).includes("/api/export/pdf")) {
        if (mode === "reject") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ reason: "x" }), { status, headers: { "content-type": "application/json", ...(status === 429 ? { "retry-after": "5" } : {}) } });
      }
      return realFetch(u, init);
    };
    try {
      const r = await run.runExport({ format: "pdf", scope: { kind: "note", ids: [window.__ks] }, opts: { ...pd.PRINT_DEFAULTS }, htmlFolder: false, engine: "server" }, {});
      return { engine: r.engine, fell: r.fellBack || "" };
    } finally { window.fetch = realFetch; }
  }, status, mode);
  const f501 = await flow(501);
  rec("PDF service missing (501): falls back to the print dialog with a message", f501.engine === "paged" && /isn.t set up/.test(f501.fell), f501.fell);
  const f429 = await flow(429);
  rec("PDF quota used up (429): falls back with a clear message", f429.engine === "paged" && /allowance/.test(f429.fell), f429.fell);
  const f429b = await flow(0, "reject");
  rec("after a 429 the service is not hammered (cool-down)", f429b.engine === "paged" && /resting/.test(f429b.fell), f429b.fell);
  await p.setOfflineMode(true);
  const foff = await flow(0, "reject");
  await p.setOfflineMode(false);
  rec("offline: falls back to the print dialog", foff.engine === "paged" && /resting|offline/i.test(foff.fell), foff.fell);
  // 7 pop-up blocked
  const pr = await ev(async (id) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const r = await run.runExport({ format: "print", scope: { kind: "note", ids: [id] }, opts: { ...pd.PRINT_DEFAULTS }, htmlFolder: false, engine: "paged" }, {});
    return { engine: r.engine, open: window.__open };
  }, ids.ks);
  rec("pop-up blocked scenario: print uses a hidden iframe, window.open never called", pr.open === 0 && pr.engine === "paged", JSON.stringify(pr));
  // 8 Firefox / Safari
  const ff = await ev(async (id) => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0", configurable: true });
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const r = await run.runExport({ format: "print", scope: { kind: "note", ids: [id] }, opts: { ...pd.PRINT_DEFAULTS, toc: true }, htmlFolder: false, engine: "auto" }, {});
    return { engine: r.engine, fell: r.fellBack, supported: run.pagedSupported() };
  }, ids.ks);
  rec("Firefox/Safari: plain print css, no TOC numbers, with a message", ff.engine === "native" && !ff.supported && /plain page CSS/.test(ff.fell || ""), JSON.stringify(ff));
  await ev(() => { delete navigator.userAgent; });
  // 9 cancel mid-export
  const cx = await ev(async (folder) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const ctl = new AbortController();
    let seen = 0;
    const n0 = window.__dl.length;
    const pr = run.runExport({ format: "html", scope: { kind: "folder", folderId: folder }, opts: { ...pd.PRINT_DEFAULTS }, htmlFolder: false, engine: "auto" }, { signal: ctl.signal, onProgress: (d) => { seen = d; if (d >= 3) ctl.abort(); } });
    try { await pr; return { cancelled: false }; } catch (e) { return { cancelled: run.isCancel(e), seen, saved: window.__dl.length - n0 }; }
  }, more.folder);
  rec("cancelling mid-export stops it and saves nothing", cx.cancelled && cx.seen >= 3 && cx.saved === 0, JSON.stringify(cx));
  // 10 HTML folder zip
  const zip = await ev(async (folder) => {
    const run = await import("/src/lib/print-run.ts");
    const pd = await import("/src/lib/print-doc.ts");
    const n0 = window.__dl.length;
    const r = await run.runExport({ format: "html", scope: { kind: "folder", folderId: folder }, opts: { ...pd.PRINT_DEFAULTS }, htmlFolder: true, engine: "auto" }, {});
    const d = window.__dl[window.__dl.length - 1];
    const blob = await (await fetch(d.href)).blob();
    const txt = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
    const names = [...txt.matchAll(/PK[\s\S]{26}([\w\-./ ]+?\.(?:html|css|png|jpg|webp))/g)].map((m) => m[1]);
    return { file: r.file, names: names.length, hasIndex: names.includes("index.html"), css: names.includes("assets/doc.css"), saved: window.__dl.length - n0 };
  }, more.folder);
  rec("HTML folder export: index + 20 pages + assets, one .zip", zip.hasIndex && zip.css && zip.names >= 22 && zip.saved === 1, JSON.stringify(zip));
  // 11 server route requires auth
  const auth = await ev(async () => (await fetch("/api/export/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status);
  rec("POST /api/export/pdf requires auth", auth === 401, "status " + auth);
  // 12 selection scope dialog
  await ev(async (a, bID) => { const m = await import("/src/lib/note-export.ts"); window.dispatchEvent(new CustomEvent("lumen:note-export", { detail: m.selectionExportJob([a, bID]) })); }, ids.ks, ids.inc);
  await p.waitForSelector("[data-note-export]", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const sel = await ev(() => document.querySelector("[data-note-export]").innerText.replace(/\n+/g, " | ").slice(0, 400));
  rec("selected-notes scope opens the dialog", /Selected notes/.test(sel) && /2 notes/.test(sel), sel);
  await p.screenshot({ path: OUT + "/06-dialog-selection.png" });
  console.log("\n" + results.filter((r) => r[1]).length + " passed, " + results.filter((r) => !r[1]).length + " failed");
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
