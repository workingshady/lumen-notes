const puppeteer = require("puppeteer-core");
const { EDGE } = require("./boot.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1200 });
  const reqs = [];
  await p.setRequestInterception(true);
  p.on("request", (r) => { const u = r.url(); if (!/^(file|data|about|blob):/.test(u)) reqs.push(u.slice(0, 90)); if (/^(file|data|about|blob):/.test(u)) r.continue(); else r.abort(); });
  p.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
  const t0 = Date.now();
  await p.goto("file:///D:/90_Graveyard/lumen-export/design/verify/export/kitchen-sink.paged.html", { waitUntil: "load", timeout: 120000 });
  await p.waitForFunction("window.__pagedDone === true", { timeout: 150000 });
  console.log("paged done in", Date.now() - t0, "ms; failed:", await p.evaluate(() => window.__pagedFailed || "no"), "; external requests:", reqs);
  const info = await p.evaluate(() => {
    const pages = [...document.querySelectorAll(".pagedjs_page")];
    // clipping: any element wider than its page's content box (ignoring the page chrome itself)
    const clipped = [];
    for (const pg of pages) {
      const area = pg.querySelector(".pagedjs_page_content");
      if (!area) continue;
      const ar = area.getBoundingClientRect();
      for (const el of area.querySelectorAll("pre, table, svg, img, figure, .callout, .katex-display, .media-fallback")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > ar.right + 1.5 || r.left < ar.left - 1.5)) clipped.push({ page: pg.dataset.pageNumber, tag: el.tagName, cls: String(el.className.baseVal ?? el.className).slice(0, 30), over: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) });
      }
    }
    const tocLinks = [...document.querySelectorAll(".toc a.toc-link")];
    const tocNums = tocLinks.map((a) => { const cs = getComputedStyle(a, "::after").content; return [a.querySelector(".toc-text").textContent.slice(0, 22), cs]; });
    const sizes = [...new Set(pages.map((pg) => { const r = pg.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); }))];
    return { pages: pages.length, sizes, clipped, tocNums, margins: !!document.querySelector(".pagedjs_margin-bottom-center"), footer: document.querySelector(".pagedjs_margin-bottom-center")?.innerText?.slice(0, 80) };
  });
  console.log(JSON.stringify(info, null, 0).slice(0, 2500));
  for (const n of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12]) { const el = await p.$(`.pagedjs_page[data-page-number="${n}"]`); if (el) await el.screenshot({ path: `${OUT}/20-paged-page-${n}.png` }); }
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  require("fs").writeFileSync(OUT + "/kitchen-sink.paged.pdf", pdf);
  console.log("pdf bytes", pdf.length);
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
