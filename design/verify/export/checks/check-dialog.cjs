const { open } = require("./boot.cjs");
const seed = require("./seed.cjs");
const OUT = "D:/90_Graveyard/lumen-export/design/verify/export";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { b, p } = await open();
  const ids = await seed(p);
  const openDlg = (format) => p.evaluate((id, format) => { window.dispatchEvent(new CustomEvent("lumen:note-export", { detail: { start: "note", format, scopes: { note: { scope: { kind: "note", ids: [id] }, title: "Kitchen sink" }, space: { scope: { kind: "space", spaceId: "inbox" }, title: "Inbox" } } } })); }, ids.ks, format);
  const ready = async () => { await p.waitForSelector("[data-note-export] iframe", { timeout: 90000 }); await p.waitForFunction(() => /\d+ pages|Plain page|Web page/.test(document.querySelector("[data-note-export]")?.innerText || ""), { timeout: 120000 }).catch(() => console.log("  (no page count in time)")); await sleep(1200); };
  const status = () => p.evaluate(() => document.querySelector("[data-note-export]")?.innerText.split("\n").filter((l) => /pages|Plain|Web page|image|diagram/.test(l)).join(" | "));
  await openDlg("pdf"); await ready();
  console.log("lamplight:", await status());
  await p.screenshot({ path: OUT + "/01-dialog-lamplight-pdf.png" });
  // paper theme
  await p.evaluate(async () => { const s = await import("/src/lib/settings.ts"); s.setSettings({ theme: "paper" }); });
  await sleep(600);
  await p.screenshot({ path: OUT + "/02-dialog-paper-pdf.png" });
  // HTML format
  await p.evaluate(() => [...document.querySelectorAll("[data-note-export] [role=button]")].find((x) => /^HTML/.test(x.textContent))?.click());
  await ready();
  await p.screenshot({ path: OUT + "/03-dialog-paper-html.png" });
  await p.keyboard.press("Escape"); await sleep(400);
  // phone: full-screen sheet
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(600);
  await openDlg("pdf"); await ready();
  await p.screenshot({ path: OUT + "/04-dialog-phone.png" });
  await p.keyboard.press("Escape"); await sleep(400);
  // RTL / Arabic
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.evaluate(async () => { const i = await import("/src/lib/i18n.ts"); await i.loadCatalog("ar"); i.setLang("ar"); });
  await sleep(1200);
  await openDlg("pdf"); await ready();
  await p.screenshot({ path: OUT + "/05-dialog-arabic-rtl.png" });
  console.log("rtl dir:", await p.evaluate(() => document.documentElement.dir));
  await p.keyboard.press("Escape"); await sleep(300);
  // the note's ⋯ menu has Export… and Print (English again)
  await p.evaluate(async () => { const i = await import("/src/lib/i18n.ts"); i.setLang("en"); });
  await sleep(800);
  await p.evaluate((id) => import("/src/lib/store.ts").then((s) => s.openNote(id)), ids.ks);
  await sleep(2000);
  const labels = await p.evaluate(() => { const btn = [...document.querySelectorAll("button")].find((x) => /More|⋯|actions/i.test(x.getAttribute("aria-label") || x.title || "")); if (btn) btn.click(); return !!btn; });
  await sleep(500);
  console.log("menu opened:", labels, await p.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).filter((x) => /^(Export…|Print|Export \.md|Export \.html)$/.test(x))));
  await b.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
