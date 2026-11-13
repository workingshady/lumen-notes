// Screenshot a design file and/or an app URL at the same viewport for side-by-side comparison.
// Usage: node design/tools/shot.mjs <url> <out.png> [width] [height] [selector] [theme=dark|light]
// Design component files (Screen*.dc.html, LumenSidebar…) expect tokens from a parent; they're injected here.
// Needs puppeteer-core + Microsoft Edge (C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe).
import puppeteer from "puppeteer-core";
const [url, out, w = "1440", h = "900", sel, theme = "dark"] = process.argv.slice(2);
const TOKENS = {
  dark: "--bg:#0F1115;--sf:#161A21;--sf2:#1D222B;--bd:#2A303B;--tx:#E8E6E1;--mu:#9AA0AA;--ac:#F2A93B;--af:#1A1206;--ln:#5CC8C2;--ok:#6BCB8B;--in:#7AA2F7;--wa:#E8B34A;--da:#EF6B6B;--le:#B48EF0;--sh:none",
  light: "--bg:#FAF8F3;--sf:#FFFFFF;--sf2:#F2EFE7;--bd:#E4DFD3;--tx:#1F1D1A;--mu:#6A655C;--ac:#B45F0E;--af:#FFFFFF;--ln:#0F7C78;--ok:#1F8A4C;--in:#2F5BD3;--wa:#A86A00;--da:#C42B2B;--le:#7A4BD1;--sh:0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06)",
};
const b = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
if (url.includes(".dc.html")) await p.addStyleTag({ content: `:root{${TOKENS[theme]}} html,body{background:${theme === "dark" ? "#0F1115" : "#FAF8F3"};margin:0}` });
await new Promise((r) => setTimeout(r, 1500));
if (sel) { const el = await p.$(sel); await (el ? el.screenshot({ path: out }) : p.screenshot({ path: out })); }
else await p.screenshot({ path: out });
await b.close();
console.log("saved", out);
