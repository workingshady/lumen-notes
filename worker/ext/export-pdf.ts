import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * POST /api/export/pdf   (owner token or API token)
 * Body: { html, mode: "paged" | "native", paper, landscape, marginMm, widthMm, heightMm, headerTemplate?, footerTemplate? }
 * Renders the note export document with Cloudflare Browser Rendering (headless Chromium) and returns the PDF bytes.
 *
 * The binding is optional (`browser` in wrangler.jsonc → BROWSER): without it the route answers 501 and the app falls back to
 * its own print dialog. A used-up daily allowance (the free plan has a few browser minutes a day) answers 429 + Retry-After.
 * The page may not touch the network: every request that isn't a data: URI is aborted, so the document is rendered exactly as sent.
 */
const MAX_HTML = 22_000_000;
const PAPERS = new Set(["a4", "letter", "a5"]);
let inflight = 0;

const json = (c: { json: (b: unknown, s?: number, h?: Record<string, string>) => Response }, error: string, reason: string, status: number, headers?: Record<string, string>) => c.json({ error, reason }, status, headers);

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/export/pdf", h.auth, async (c) => {
    if (!c.env.BROWSER) return json(c, "Browser Rendering is not configured on this server.", "no_binding", 501);
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_HTML + 100_000) return json(c, "Document too large.", "too_large", 413);
    let body: Record<string, unknown>;
    try { body = (await c.req.json()) as Record<string, unknown>; } catch { return json(c, "Bad request.", "bad_json", 400); }
    const html = typeof body.html === "string" ? body.html : "";
    if (!html || html.length > MAX_HTML) return json(c, html ? "Document too large." : "No document.", html ? "too_large" : "empty", html ? 413 : 400);
    const paper = PAPERS.has(String(body.paper)) ? String(body.paper) : "a4";
    const mm = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.min(60, Math.max(0, Number(v))) : d);
    const landscape = body.landscape === true;
    const margin = mm(body.marginMm, 18);
    const paged = body.mode !== "native";
    if (inflight >= 1) return json(c, "Another PDF is being made; try again in a moment.", "busy", 429, { "Retry-After": "10" });
    inflight++;
    let browser: import("@cloudflare/puppeteer").Browser | null = null;
    try {
      const puppeteer = (await import("@cloudflare/puppeteer")).default;
      try { browser = await puppeteer.launch(c.env.BROWSER); } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/429|rate|limit|too many|quota/i.test(msg)) return json(c, "Daily PDF allowance used up.", "quota", 429, { "Retry-After": "3600" });
        throw e;
      }
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (r) => { const u = r.url(); if (u.startsWith("data:") || u.startsWith("about:") || u.startsWith("blob:")) void r.continue(); else void r.abort(); });
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "networkidle0" as never, timeout: 30_000 });
      if (paged) await page.waitForFunction("window.__pagedDone === true", { timeout: 60_000 }).catch(() => undefined); // a stuck layout still prints (plain page css)
      const pdf = paged
        ? await page.pdf({ preferCSSPageSize: true, printBackground: true })
        : await page.pdf({
            format: paper === "letter" ? "letter" : paper === "a5" ? "a5" : "a4", landscape, printBackground: true,
            margin: { top: `${margin}mm`, bottom: `${margin}mm`, left: `${margin}mm`, right: `${margin}mm` },
            displayHeaderFooter: true,
            headerTemplate: typeof body.headerTemplate === "string" ? body.headerTemplate.slice(0, 4000) : "<div></div>",
            footerTemplate: typeof body.footerTemplate === "string" ? body.footerTemplate.slice(0, 4000) : "<div></div>",
          });
      return new Response(pdf as unknown as BodyInit, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
    } catch (e) {
      console.error("export/pdf", e);
      const msg = String((e as Error)?.message ?? e);
      if (/429|rate limit|limit exceeded|quota/i.test(msg)) return json(c, "Daily PDF allowance used up.", "quota", 429, { "Retry-After": "3600" });
      return json(c, "Could not render the PDF.", "render_failed", 500);
    } finally {
      inflight--;
      try { await browser?.close(); } catch { /* already closed */ }
    }
  });
}
