import { API_BASE, unfurl, type Unfurl } from "../lib/api";
import { icon } from "./ws-icons";
import { fmtNum, t } from "../lib/i18n";
import { hydrateTimestamps, mediaCtl, remoteCtl } from "./video-players"; // video notes (D8): player registry + [12:34] chips

/*
 * Embeds & link previews (design: Lumen 08 · R2-2A/2B/2C). Same renderer in notes and public posts; nothing autoplays.
 *  - YouTube / Vimeo: static thumbnail (proxied by our Worker, so no third-party load before play) → no-cookie player on click.
 *  - Video files: surface card, name badge, slim custom control bar.   - Audio: slim bar, speed, volume, file name.
 *  - PDF: 70vh viewer card (pdf.js), scrolls internally; select text → "Quote in note".
 *  - Link preview: loading skeleton (≤ 2 s) → loaded / no image / failed (dashed, still a working link, Retry).
 */
export interface EmbedCtx {
  /** Append a quote from a PDF to the note (only inside the app, not on public pages). */
  quote?: (text: string, page: number, name: string) => void;
  /** Turn a bare-URL preview card into a plain link in the note source. */
  convert?: (href: string) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (s: number) => { if (!isFinite(s)) return "0:00"; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const fmt2 = (s: number) => { if (!isFinite(s)) return "00:00"; s = Math.floor(s); const m = Math.floor(s / 60); return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const fileName = (src: string) => { try { return decodeURIComponent(new URL(src, location.href).pathname.split("/").pop() || "file"); } catch { return "file"; } };

// ------------------------------------------------------------------ static markup (used by markdown.ts)
export function videoThumbHtml(provider: "youtube" | "vimeo", id: string, href: string, start = 0) {
  const site = provider === "youtube" ? "youtube.com" : "vimeo.com";
  return `<figure class="vthumb" data-provider="${provider}" data-id="${esc(id)}" data-start="${start}" data-href="${esc(href)}">`
    + `<div class="embed video"><button type="button" class="vt-frame" aria-label="${esc(t("Play video"))}"><img class="vt-img" alt="" hidden>`
    + `<span class="vt-play">${icon("play", 26)}</span>`
    + `<span class="vt-bottom"><span class="vt-meta"><span class="vt-title" dir="auto"></span><span class="vt-sub">${site}</span></span></span><span class="vt-dur" hidden></span></button></div>`
    + `<figcaption class="embed-cap"><span class="cap-wide">${esc(t("Plays inline · no autoplay"))}</span><span class="cap-phone" dir="auto">${site}</span><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t("Open on {site} ↗", { site: provider === "youtube" ? "YouTube" : "Vimeo" }))}</a></figcaption></figure>`;
}
export const videoFileHtml = (src: string, name = fileName(src)) => `<div class="embed vfile" data-src="${esc(src)}" data-name="${esc(name)}"><video src="${esc(src)}" controls preload="metadata" playsinline></video></div>`;
export const audioFileHtml = (src: string, name = fileName(src)) => `<div class="embed afile" data-src="${esc(src)}" data-name="${esc(name)}"><audio src="${esc(src)}" controls preload="metadata"></audio></div>`;
/** `att` = attachment id when the PDF is an `att:` attachment (lets "Open as PDF note" point the note at the file). */
export const pdfHtml = (src: string, name = fileName(src), att = "") => `<div class="embed pdfcard" data-src="${esc(src)}" data-name="${esc(name)}"${att ? ` data-att-id="${esc(att)}"` : ""}><div class="pdf-head">${icon("file-text", 15, 'style="color:var(--danger)"')}<b class="pdf-name">${esc(name)}</b><span class="pdf-meta"></span><span class="sp"></span><span class="pdf-page"></span></div><div class="pdf-body"><a class="pdf-fallback" href="${esc(src)}" target="_blank" rel="noopener">${esc(t("Open {name}", { name }))}</a></div></div>`;
export function linkCardHtml(href: string) {
  let host = href;
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  return `<a class="link-card lc-loading" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-unfurl="${esc(href)}">`
    + `<span class="lc-body"><span class="lc-title" dir="auto">${esc(host)}</span><span class="lc-desc" dir="auto"></span><span class="lc-host"><img alt="" loading="lazy" src="${API_BASE}/api/ws/favicon?d=${esc(host)}" onerror="this.style.visibility='hidden'">${esc(host)}</span>`
    + `<span class="lc-skel"><i></i><i></i><i></i><i></i></span></span>`
    + `<span class="lc-fail">${icon("link-2", 16)}<span class="lc-fail-t"><b>${esc(host)}</b><code>${esc(href)}</code></span><span class="lc-retry" role="button" tabindex="0">${icon("refresh-cw", 13)}${esc(t("Retry"))}</span></span>`
    + `<span class="lc-media"></span><span class="lc-more" role="button" tabindex="0" title="${esc(t("More"))}" hidden>${icon("ellipsis", 16)}</span></a>`;
}

// ------------------------------------------------------------------ hydration
export function hydrateEmbeds(root: HTMLElement, ctx: EmbedCtx = {}) {
  hydrateTimestamps(root);
  root.querySelectorAll<HTMLElement>("figure.vthumb:not([data-h])").forEach((el) => videoThumb(el));
  root.querySelectorAll<HTMLElement>(".vfile:not([data-h])").forEach((el) => videoFile(el));
  root.querySelectorAll<HTMLElement>(".afile:not([data-h])").forEach((el) => audioFile(el));
  root.querySelectorAll<HTMLElement>(".pdfcard:not([data-h])").forEach((el) => void pdfCard(el, ctx));
  root.querySelectorAll<HTMLAnchorElement>("a.link-card[data-unfurl]:not([data-h])").forEach((a) => linkCard(a, ctx));
}

interface VideoMeta { title?: string; author?: string; duration?: number; thumb?: string }
const vcache = new Map<string, Promise<VideoMeta | null>>();
function videoMeta(href: string) {
  if (!vcache.has(href)) vcache.set(href, (async () => {
    const key = "lumen.vmeta." + href;
    try { const c = localStorage.getItem(key); if (c) return JSON.parse(c) as VideoMeta; } catch { /* ignore */ }
    try {
      const r = await fetch(`${API_BASE}/api/ws/video?url=${encodeURIComponent(href)}`);
      if (!r.ok) return null;
      const m = (await r.json()) as VideoMeta;
      try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* full */ }
      return m;
    } catch { return null; }
  })());
  return vcache.get(href)!;
}

function videoThumb(fig: HTMLElement) {
  fig.dataset.h = "1";
  const { provider, id, start, href } = fig.dataset as Record<string, string>;
  const img = fig.querySelector<HTMLImageElement>(".vt-img")!;
  const site = provider === "youtube" ? "youtube.com" : "vimeo.com";
  void videoMeta(href).then((m) => {
    if (!m) return;
    if (m.thumb) { img.src = (m.thumb.startsWith("/") ? API_BASE : "") + m.thumb; img.onload = () => (img.hidden = false); }
    if (m.title) { fig.querySelector(".vt-title")!.textContent = m.title; fig.querySelector(".cap-phone")!.textContent = `${m.title} · ${site}`; }
    if (m.author) fig.querySelector(".vt-sub")!.textContent = `${site} · ${m.author}`;
    if (m.duration) { const d = fig.querySelector<HTMLElement>(".vt-dur")!; d.textContent = fmt(m.duration); d.hidden = false; }
  });
  // play → no-cookie player with the JS API on (video-players.ts: seek / speed / timestamps)
  const ctl = remoteCtl(fig, provider as "youtube" | "vimeo", id, Number(start) || 0);
  fig.querySelector(".vt-frame")!.addEventListener("click", () => ctl.load());
}

function bar(media: HTMLMediaElement, el: HTMLElement) {
  // Shared transport logic for the custom audio / video bars.
  const play = el.querySelector<HTMLElement>(".mb-play")!;
  const track = el.querySelector<HTMLElement>(".mb-track")!;
  const fill = el.querySelector<HTMLElement>(".mb-fill")!;
  const knob = el.querySelector<HTMLElement>(".mb-knob");
  const cur = el.querySelector<HTMLElement>(".mb-cur");
  const dur = el.querySelector<HTMLElement>(".mb-dur");
  const vol = el.querySelector<HTMLElement>(".mb-vol");
  const audio = media instanceof HTMLAudioElement;
  const tf = audio ? fmt2 : fmt;
  const sync = () => {
    const p = media.duration ? media.currentTime / media.duration : 0;
    fill.style.width = `${p * 100}%`;
    if (knob) knob.style.insetInlineStart = `${p * 100}%`;
    if (cur) cur.textContent = el.classList.contains("vfile") ? `${tf(media.currentTime)} / ${tf(media.duration)}` : tf(media.currentTime);
    if (dur) dur.textContent = tf(media.duration);
    play.innerHTML = icon(media.paused ? "play" : "pause", Number(play.dataset.s || 15));
    play.setAttribute("aria-label", media.paused ? t("Play") : t("Pause"));
    if (vol) vol.innerHTML = icon(media.muted ? "volume-x" : "volume-2", 16);
  };
  ["timeupdate", "loadedmetadata", "play", "pause", "volumechange", "durationchange"].forEach((e) => media.addEventListener(e, sync));
  play.addEventListener("click", (e) => { e.stopPropagation(); void (media.paused ? media.play() : media.pause()); });
  const seek = (x: number) => { const r = track.getBoundingClientRect(); const rtl = getComputedStyle(track).direction === "rtl"; let p = (x - r.left) / r.width; if (rtl) p = 1 - p; if (media.duration) media.currentTime = Math.max(0, Math.min(1, p)) * media.duration; };
  track.addEventListener("pointerdown", (e) => { seek(e.clientX); track.setPointerCapture(e.pointerId); const mv = (ev: PointerEvent) => seek(ev.clientX); track.addEventListener("pointermove", mv); track.addEventListener("pointerup", () => track.removeEventListener("pointermove", mv), { once: true }); });
  vol?.addEventListener("click", () => (media.muted = !media.muted));
  const speed = el.querySelector<HTMLElement>(".mb-speed");
  speed?.addEventListener("click", () => { const r = [1, 1.25, 1.5, 2, 0.75]; media.playbackRate = r[(r.indexOf(media.playbackRate) + 1) % r.length]; speed.textContent = `${media.playbackRate}×`; });
  sync();
}

function videoFile(el: HTMLElement) {
  el.dataset.h = "1";
  const v = el.querySelector("video")!;
  v.controls = false;
  const name = el.dataset.name || "video";
  const stage = document.createElement("div");
  stage.className = "vf-stage";
  v.replaceWith(stage);
  stage.append(v);
  stage.insertAdjacentHTML("beforeend", `<span class="vf-name">${esc(name)}</span>`);
  el.insertAdjacentHTML("beforeend", `<div class="vf-bar"><button type="button" class="mb-play" data-s="15"></button><span class="mb-cur"></span><span class="mb-track"><span class="mb-fill"></span></span><button type="button" class="mb-vol" aria-label="${esc(t("Mute"))}"></button><button type="button" class="mb-full" aria-label="${esc(t("Full screen"))}">${icon("maximize-2", 15)}</button></div>`);
  stage.addEventListener("click", () => void (v.paused ? v.play() : v.pause()));
  el.querySelector(".mb-full")!.addEventListener("click", () => { const anyV = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }; if (v.requestFullscreen) void v.requestFullscreen(); else anyV.webkitEnterFullscreen?.(); });
  bar(v, el);
  mediaCtl(el, v);
}

function audioFile(el: HTMLElement) {
  el.dataset.h = "1";
  const a = el.querySelector("audio")!;
  a.controls = false;
  a.hidden = true;
  const name = el.dataset.name || "audio";
  el.insertAdjacentHTML("beforeend", `<button type="button" class="mb-play" data-s="14"></button><span class="mb-cur"></span><span class="mb-track"><span class="mb-fill"></span><span class="mb-knob"></span></span><span class="mb-dur"></span><button type="button" class="mb-speed" title="${esc(t("Playback speed"))}">1×</button><button type="button" class="mb-vol" aria-label="${esc(t("Mute"))}"></button><span class="mb-div"></span><span class="mb-name">${icon("file-audio", 14)}<span>${esc(name)}</span></span><span class="mb-both"></span>`);
  const both = el.querySelector<HTMLElement>(".mb-both")!;
  const upd = () => (both.textContent = `${fmt2(a.currentTime)} / ${fmt2(a.duration)}`);
  ["timeupdate", "loadedmetadata", "durationchange"].forEach((e) => a.addEventListener(e, upd));
  bar(a, el);
  upd();
  mediaCtl(el, a);
}

// ------------------------------------------------------------------ PDF viewer (pdf.js, loaded on demand)
type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
async function loadPdfJs() {
  pdfjs ??= (async () => {
    const m = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    m.GlobalWorkerOptions.workerSrc = worker;
    return m;
  })();
  return pdfjs;
}

async function pdfCard(el: HTMLElement, ctx: EmbedCtx) {
  el.dataset.h = "1";
  const src = el.dataset.src!;
  const name = el.dataset.name || "document.pdf";
  const head = el.querySelector<HTMLElement>(".pdf-head")!;
  const body = el.querySelector<HTMLElement>(".pdf-body")!;
  head.insertAdjacentHTML("beforeend", `<span class="pdf-sep"></span><button type="button" class="pdf-zo" aria-label="${esc(t("Zoom out"))}">${icon("zoom-out", 15)}</button><button type="button" class="pdf-zi" aria-label="${esc(t("Zoom in"))}">${icon("zoom-in", 15)}</button><button type="button" class="pdf-full">${icon("maximize-2", 13)}<span>${esc(t("Open full screen"))}</span></button>`);
  // In the app (not on public pages): open this file in the PDF reader as a `type: pdf` note (lib/pdf-note.ts).
  if (ctx.quote) {
    head.insertAdjacentHTML("beforeend", `<button type="button" class="pdf-full pdf-open-note" title="${esc(t("Open in the PDF reader with highlights"))}">${icon("bookmark", 13)}<span>${esc(t("Open as PDF note"))}</span></button>`);
    head.querySelector(".pdf-open-note")!.addEventListener("click", () => { const file = el.dataset.attId ? `att:${el.dataset.attId}` : src; void import("../lib/pdf-note").then((m) => m.openPdfFromCard(file, name)); });
  }
  const pageEl = head.querySelector<HTMLElement>(".pdf-page")!;
  const metaEl = head.querySelector<HTMLElement>(".pdf-meta")!;
  head.querySelector(".pdf-full")!.addEventListener("click", () => {
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen();
    else window.open(src, "_blank");
  });
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
  let lib: PdfJs;
  try {
    lib = await loadPdfJs();
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength; // read before pdf.js transfers the buffer to its worker
    doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    metaEl.textContent = t("{n} page · {size}|{n} pages · {size}", { n: doc.numPages, size: size(bytes) });
  } catch {
    metaEl.textContent = t("Couldn't open this PDF");
    return;
  }
  body.replaceChildren();
  let scale = 1;
  const pages: HTMLElement[] = [];
  const rendered = new Map<number, number>();
  for (let i = 1; i <= doc.numPages; i++) {
    const p = document.createElement("div");
    p.className = "pdf-page-box";
    p.dataset.page = String(i);
    body.append(p);
    pages.push(p);
  }
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const fitWidth = () => Math.min(body.clientWidth - 40, 560);
  const layout = () => {
    const w = fitWidth() * scale;
    pages.forEach((p) => { p.style.width = `${w}px`; p.style.height = `${(w * base.height) / base.width}px`; });
  };
  async function render(i: number) {
    const w = fitWidth() * scale;
    if (rendered.get(i) === w) return;
    rendered.set(i, w);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: w / page.getViewport({ scale: 1 }).width });
    const box = pages[i - 1];
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
    cv.style.width = `${vp.width}px`; cv.style.height = `${vp.height}px`;
    await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    const tl = document.createElement("div");
    tl.className = "textLayer";
    tl.style.setProperty("--scale-factor", String(vp.scale));
    box.replaceChildren(cv, tl);
    try { await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render(); } catch { /* text layer optional */ }
  }
  layout();
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && void render(Number((e.target as HTMLElement).dataset.page))), { root: body, rootMargin: "400px 0px" });
  pages.forEach((p) => io.observe(p));
  const cur = () => {
    const top = body.scrollTop + body.clientHeight / 3;
    let n = 1;
    for (const p of pages) if (p.offsetTop - body.offsetTop <= top) n = Number(p.dataset.page);
    pageEl.textContent = `${fmtNum(n)} / ${fmtNum(doc.numPages)}`;
    return n;
  };
  body.addEventListener("scroll", cur, { passive: true });
  cur();
  const zoom = (d: number) => { scale = Math.max(0.5, Math.min(2.5, Math.round((scale + d) * 100) / 100)); layout(); pages.forEach((_, i) => { const r = pages[i].getBoundingClientRect(); const b = body.getBoundingClientRect(); if (r.bottom > b.top - 400 && r.top < b.bottom + 400) void render(i + 1); }); };
  head.querySelector(".pdf-zo")!.addEventListener("click", () => zoom(-0.2));
  head.querySelector(".pdf-zi")!.addEventListener("click", () => zoom(0.2));
  document.addEventListener("fullscreenchange", () => { rendered.clear(); layout(); cur(); pages.forEach((p, i) => { const r = p.getBoundingClientRect(); if (r.top < innerHeight + 400 && r.bottom > -400) void render(i + 1); }); });
  // Highlights → quotes in the note.
  if (ctx.quote) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pdf-quote"; btn.hidden = true;
    btn.innerHTML = `${icon("quote", 13)}<span>${esc(t("Quote in note"))}</span>`;
    el.append(btn);
    let pending: { text: string; page: number } | null = null;
    body.addEventListener("mouseup", () => setTimeout(() => {
      const sel = getSelection();
      const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!sel || !text || !body.contains(sel.anchorNode)) { btn.hidden = true; return; }
      const box = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest<HTMLElement>(".pdf-page-box");
      pending = { text, page: Number(box?.dataset.page ?? cur()) };
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const er = el.getBoundingClientRect();
      btn.style.top = `${r.bottom - er.top + 6}px`;
      btn.style.left = `${Math.max(8, Math.min(er.width - 150, r.left - er.left))}px`;
      btn.hidden = false;
    }, 0));
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => { if (pending) ctx.quote!(pending.text, pending.page, name); btn.hidden = true; getSelection()?.removeAllRanges(); });
  }
}

// ------------------------------------------------------------------ link preview card
/** Preview metadata; `fresh` skips the caches (Retry). Results are cached in localStorage so cards work offline. */
async function preview(href: string, fresh: boolean): Promise<Unfurl | null> {
  if (!fresh) return unfurl(href);
  try {
    const r = await fetch(`${API_BASE}/api/unfurl?url=${encodeURIComponent(href)}&r=${Date.now()}`);
    if (!r.ok) return null;
    const d = (await r.json()) as Unfurl;
    try { localStorage.setItem("lumen.unfurl." + href, JSON.stringify(d)); } catch { /* full */ }
    return d;
  } catch { return null; }
}
function linkCard(a: HTMLAnchorElement, ctx: EmbedCtx) {
  a.dataset.h = "1";
  const href = a.dataset.unfurl!;
  const state = (s: "loading" | "ok" | "noimg" | "failed") => { a.classList.remove("lc-loading", "lc-ok", "lc-noimg", "lc-failed"); a.classList.add(`lc-${s}`); };
  const load = (fresh = false) => {
    state("loading");
    let done = false;
    const slow = setTimeout(() => { if (!done) state("failed"); }, 2000); // ≤ 2 s skeleton, then fall through
    void preview(href, fresh).then((m) => {
      done = true; clearTimeout(slow);
      if (!m || (!m.title && !m.description)) { state("failed"); return; }
      a.querySelector(".lc-title")!.textContent = m.title || a.querySelector(".lc-title")!.textContent;
      a.querySelector(".lc-desc")!.textContent = m.description ?? "";
      const media = a.querySelector<HTMLElement>(".lc-media")!;
      if (m.image) {
        const img = document.createElement("img");
        img.alt = ""; img.loading = "lazy"; img.src = m.image;
        img.onerror = () => { media.replaceChildren(); state("noimg"); };
        media.replaceChildren(img);
        state("ok");
      } else state("noimg");
    });
  };
  a.querySelector(".lc-retry")?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); load(true); });
  const more = a.querySelector<HTMLElement>(".lc-more");
  if (more && ctx.convert) {
    more.hidden = false;
    more.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      a.querySelector(".lc-menu")?.remove();
      const m = document.createElement("span");
      m.className = "lc-menu";
      m.innerHTML = `<span role="button" tabindex="0">${icon("link-2", 14)}${esc(t("Convert to plain link"))}</span>`;
      m.firstElementChild!.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); ctx.convert!(href); });
      a.append(m);
      const off = (ev: MouseEvent) => { if (!m.contains(ev.target as Node)) { m.remove(); removeEventListener("click", off, true); } };
      setTimeout(() => addEventListener("click", off, true), 0);
    });
  }
  load();
}
