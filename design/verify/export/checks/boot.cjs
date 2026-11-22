const puppeteer = require("puppeteer-core");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
async function open(opts = {}) {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: opts.w || 1440, height: opts.h || 900, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));
  p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERR", m.text().slice(0, 300)); });
  await p.goto("http://localhost:5337/?demo=1", { waitUntil: "networkidle2", timeout: 90000 });
  const click = async (re) => { const h = await p.evaluateHandle((s) => [...document.querySelectorAll("button,a,[role=button]")].find((x) => new RegExp(s, "i").test(x.textContent || "")), re); const el = h.asElement(); if (el) { await el.click(); return true; } return false; };
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 800)); if (await click("^\s*Continue offline")) continue; if (await click("^\s*Skip")) continue; }
  await new Promise((r) => setTimeout(r, 1500));
  return { b, p, click };
}
module.exports = { open, EDGE };
