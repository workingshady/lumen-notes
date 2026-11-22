const puppeteer = require("puppeteer-core");
const { EDGE } = require("./boot.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const reqs = [];
  await p.setRequestInterception(true);
  p.on("request", (r) => { const u = r.url(); reqs.push(u.slice(0, 100)); if (u.startsWith("file:") || u.startsWith("data:") || u.startsWith("about:")) r.continue(); else r.abort(); });
  await p.setOfflineMode(true);
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await p.goto("file:///D:/90_Graveyard/lumen-export/design/verify/export/kitchen-sink.html", { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const res = await p.evaluate(async () => {
    const q = (s) => [...document.querySelectorAll(s)];
    const faces = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/['"]/g, ""));
    const katexOk = document.fonts.check('1em KaTeX_Main') && q(".katex").length > 0;
    const k = q(".katex-html")[0]; const kr = k?.getBoundingClientRect();
    return {
      requestsOutsideFile: null,
      fontsLoaded: [...new Set(faces)],
      katexFont: katexOk, katexBox: kr ? [Math.round(kr.width), Math.round(kr.height)] : null,
      katexMathmlHidden: q(".katex-mathml").every((m) => getComputedStyle(m).position === "absolute"),
      svgs: q("figure.diagram svg").map((s) => { const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      imgs: q("img").map((i) => [i.complete && i.naturalWidth > 0, i.naturalWidth, i.className || "img"]),
      imgMissing: q(".img-missing").length,
      tables: q("table").length, sidebar: !!document.querySelector(".doc-side"),
      bodyBg: getComputedStyle(document.body).backgroundColor, bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 40),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  console.log(JSON.stringify(res));
  console.log("requests:", reqs.filter((u) => !/^(file|data):/.test(u)));
  console.log("request count (file/data only):", reqs.length);
  await p.screenshot({ path: OUT + "/10-html-offline-light.png" });
  // dark: system preference then the toggle
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await new Promise((r) => setTimeout(r, 300));
  const dark = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.screenshot({ path: OUT + "/11-html-offline-dark.png" });
  await p.click(".theme-toggle");
  const toggled = await p.evaluate(() => [document.documentElement.getAttribute("data-theme"), getComputedStyle(document.body).backgroundColor]);
  console.log("dark system bg:", dark, "after toggle:", toggled);
  // print media: palette is the paper one even in dark
  await p.emulateMediaType("print");
  console.log("print bg:", await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "sidebar hidden:", await p.evaluate(() => getComputedStyle(document.querySelector(".doc-side")).display));
  await p.pdf({ path: OUT + "/kitchen-sink-from-html.pdf", preferCSSPageSize: true, printBackground: true });
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
