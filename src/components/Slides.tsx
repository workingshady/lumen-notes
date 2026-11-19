import { ChevronLeft, ChevronRight, LayoutGrid, Move, PanelRight, Save, Smartphone, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { deckSlides, docToDeck, flatSlide, planSlide, slideChunks, splitNotes, type Dirs, type SplitAt } from "../lib/deck";
import { DeckWorkspace, DocToDeckDialog, OverviewGrid, type DeckTab } from "./slides-deck";
import { parseBlockInfo } from "../lib/markdown";
import { openNote, toast } from "../lib/store";
import { Preview } from "./Preview";
import { cx, IconButton } from "./ui";
import { clock, prettyCode, qrDataUrl, remoteUrl, useRemoteLink, type DeckCmd, type DeckState } from "./study-remote-link";

/** `---` on its own line (outside code fences) separates slides; directive comments and region markers removed. */
export function splitSlides(md: string) {
  return slideChunks(md).map((c) => flatSlide(splitNotes(c.md).body)).filter((s) => s.trim());
}

/** A note written as a deck (type Slides, layout directives, or `---` between slides) is shown as written;
 *  any other note is laid out automatically (lib/deck.ts docToDeck). */
export function isWrittenDeck(note: Pick<Note, "type" | "body">) {
  return note.type === "slides" || /<!--\s*_?(layout|class)\s*:/.test(note.body) || slideChunks(note.body).length >= 3;
}

// ------------------------------------------------------------------ layout detection (styling, not a layout engine)
type Layout = "title" | "bullets" | "image" | "video" | "diagram" | "text";
const HEAD = /^#{1,6}\s/;
const LIST = /^([-*+]|\d+[.)])\s/;
const IMG = /^!\[([^\]]*)\]\([^)]+\)$|^!\[\[[^\]]+\]\]$/;
const MEDIA = /^<?https?:\/\/\S+>?$/;
const isMediaUrl = (l: string) => MEDIA.test(l) && /youtu\.?be|vimeo\.com|\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)(\?|>|$)/i.test(l);

function slideInfo(md: string) {
  const lines = md.split("\n").map((l) => l.trim()).filter((l) => l && !/^<!--.*-->$/.test(l) && !/^::[\w-]+::$/.test(l));
  const heads = lines.filter((l) => HEAD.test(l));
  // A short paragraph straight before the first heading is a kicker, not content.
  const hi = lines.findIndex((l) => HEAD.test(l));
  const rest = lines.filter((l, k) => !HEAD.test(l) && !(hi > 0 && k < hi));
  const title = heads[0]?.replace(/^#+\s*/, "") ?? "";
  let layout: Layout = "text";
  let caption = "";
  const fences = rest.filter((l) => l.startsWith("```")).length;
  if (rest.length >= 2 && /^```mermaid\b/.test(rest[0]) && /^```\s*$/.test(rest[rest.length - 1]) && fences === 2) {
    layout = "diagram";
    caption = "mermaid · " + (rest[1] ?? "").trim();
  } else if (rest.length === 1 && IMG.test(rest[0]) && /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)\b/i.test(rest[0])) layout = "video";
  else if (rest.length === 1 && IMG.test(rest[0])) {
    layout = "image";
    caption = IMG.exec(rest[0])?.[1] ?? "";
  } else if (rest.length === 1 && isMediaUrl(rest[0])) layout = "video";
  else if (heads.length && !fences && rest.some((l) => LIST.test(l)) && rest.every((l) => LIST.test(l) || /^\s/.test(l) || !/^[!|>]/.test(l))) layout = "bullets";
  else if (heads.length && rest.length <= 2 && !fences && !rest.some((l) => LIST.test(l) || /^[!|>]/.test(l) || MEDIA.test(l))) layout = "title";
  const media: "" | "Image" | "Media" = layout === "image" ? "Image" : layout === "video" ? "Media" : /!\[/.test(md) ? "Image" : lines.some(isMediaUrl) ? "Media" : "";
  const alt = IMG.exec(rest.find((l) => IMG.test(l)) ?? "")?.[1];
  const label = title || ((layout === "image" || layout === "video") && alt) || (lines[0] ?? "").replace(/^!\[[^\]]*\]\([^)]*\).*/, "Image").replace(/^```(\w*).*/, "$1 diagram").replace(/^<?https?:\/\/\S+.*/, "Media");
  return { layout, caption, title: label, media };
}

// Scoped slide styles (sizes are at the 1280 × 720 design scale; the stage is scaled to fit).
const CSS = `
.lslide{width:1280px;height:720px;box-sizing:border-box;padding:72px 96px;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;overflow:hidden;transform-origin:0 0;position:absolute;left:0;top:0}
.lslide.l-text{overflow:auto}
.lslide .prose{max-width:none;margin:0;font-family:inherit;font-size:30px;line-height:1.45;flex:1;min-height:0;display:flex;flex-direction:column}
.lslide .prose>*{margin-top:0}
.lslide .prose h1,.lslide .prose h2{font-size:60px;font-weight:700;letter-spacing:-.025em;line-height:1.1;margin:0 0 .5em;padding:0;border:0}
.lslide .prose h3{font-size:40px;font-weight:650;margin:0 0 .5em}
.lslide .prose p{margin:0 0 .6em}
.lslide .prose>p:first-child:has(+h1,+h2){font-size:18px;line-height:1.3;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin:0 0 18px}
.lslide .prose ul{list-style:none;padding:0}
.lslide .prose ul>li:not(.task-list-item){display:flex;gap:20px}
.lslide .prose ul>li:not(.task-list-item)::before{content:"•";color:var(--muted)}
.l-bullets .prose :is(h1,h2){margin-bottom:0}
.l-bullets .prose li{margin:0}
.l-bullets .prose>ul,.l-bullets .prose>ol{margin:48px 0 0;display:flex;flex-direction:column;gap:.76em;font-size:1.13em;line-height:1.3}
.l-bullets .prose ul ul{font-size:.8em;margin:12px 0 0;gap:12px;display:flex;flex-direction:column}
.l-title .prose{justify-content:center}
.l-title .prose h1,.l-title .prose h2{font-size:84px;letter-spacing:-.035em;line-height:1;margin:0}
.l-title .prose>p:first-child:has(+h1,+h2){font-size:20px;font-weight:600;color:var(--accent);letter-spacing:.08em;margin:0 0 26px}
.l-title .prose :is(h1,h2)~p{font-size:26px;color:var(--muted);margin:26px 0 0}
:is(.l-image,.l-video,.l-diagram) .prose :is(h1,h2,h3){font-size:48px;letter-spacing:-.02em;text-align:center;margin:0}
.l-image .prose p:has(>img){flex:1;min-height:0;display:flex;align-items:center;justify-content:center;margin:16px 0 0}
.l-image .prose img{max-height:446px;max-width:100%;border-radius:16px;object-fit:contain;display:block}
.l-video .prose .embed{width:800px;max-width:100%;margin:auto;border-radius:16px;border:0}
.l-video .prose .embed.video{aspect-ratio:16/9}
.l-video .prose .embed video{max-height:450px}
.l-diagram .prose .mermaid-block{margin:auto;background:transparent;border:0;padding:0;font-size:24px}
.l-diagram .prose .mermaid-block svg{max-height:440px;max-width:1088px}
.lslide .cap{text-align:center;color:var(--muted);font-size:20px;margin-top:16px}
.l-diagram .cap{font:500 16px 'JetBrains Mono',ui-monospace,monospace}
.zoomable img{cursor:zoom-in}
.lslide .embed-cap{display:none}
.lslide .mm-head{display:none}
.l-diagram .prose .mermaid-card{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:transparent;border:0;margin:0;padding:0}
.l-diagram .prose .mermaid-card .mermaid-block svg{min-width:900px}
.lslide{isolation:isolate}
.lslide .tbl-tools{display:none}
.lslide .tbl{margin:0}
.lslide .tbl-scroll{overflow:hidden}
.lslide .prose .tbl table{font-size:20px;line-height:1.35}
.lslide .prose .tbl :is(th,td){padding:12px 16px;min-width:0}
.lslide .prose .tbl th{font-size:16px}
/* chosen layouts (<!-- layout: … -->): header + body regions */
.L{padding:64px 88px}
.L .s-head{flex:none;margin-bottom:30px}
.L .s-head .prose :is(h1,h2,h3){font-size:54px;margin:0;line-height:1.08}
.L .s-body{flex:1;min-height:0;display:flex;gap:48px}
.L .s-r{flex:1;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.L .s-r .prose{flex:none;display:block}
.L .s-r .prose>:last-child{margin-bottom:0}
.L .s-r .prose ul,.L .s-r .prose ol{display:flex;flex-direction:column;gap:.5em;margin:0 0 .6em}
.L .s-r .prose h3{font-size:1.25em;margin:0 0 .4em}
.L-two-cols .s-body{display:grid;grid-template-columns:minmax(0,var(--split,1fr)) minmax(0,1fr)}
.L-cards .s-body{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));grid-auto-rows:minmax(min-content,auto);align-content:center;gap:24px}
.L-cards .s-r{border:1px solid var(--border);border-radius:20px;padding:30px 32px;background:var(--surface);min-height:220px;max-height:100%}
.L-cards .s-r .prose{font-size:24px;line-height:1.4}
.L-cards .s-r .prose h3,.L-cards .s-r .prose>p:first-child>strong:first-child{display:block;font-size:30px;line-height:1.15;margin:0 0 12px;color:var(--text)}
.L-image-right{padding-right:calc(var(--split,45%) + 64px)}
.L-image-left{padding-left:calc(var(--split,45%) + 64px)}
.L .s-side{position:absolute;top:0;bottom:0;width:var(--split,45%);overflow:hidden;z-index:0}
.L-image-right .s-side{right:0}.L-image-left .s-side{left:0}
.s-side .prose,.s-side .prose>p,.s-bg .prose,.s-bg .prose>p{height:100%;margin:0;max-width:none}
.s-side img,.s-bg img{width:100%;height:100%;object-fit:cover;border-radius:0;max-height:none;display:block}
.s-side .embed,.s-bg .embed{height:100%;margin:0;border-radius:0}
.s-bg{position:absolute;inset:0;z-index:-1}
/* invert = the opposite theme (a light slide in Lamplight, a dark one in Paper); over a background image: white text */
.lslide.invert{--bg:#FAF8F3;--surface:#FFFFFF;--surface-2:#F2EFE7;--border:#E4DFD3;--text:#1F1D1A;--muted:#6A655C;--accent:#B45F0E;--accent-fg:#FFFFFF;background:var(--bg);color:var(--text)}
:root[data-dark="0"] .lslide.invert{--bg:#0F1115;--surface:#161A21;--surface-2:#1D222B;--border:#2A303B;--text:#E8E6E1;--muted:#9AA0AA;--accent:#F2A93B;--accent-fg:#1A1206}
.lslide.invert:has(>.s-bg){background:transparent;color:#fff;--text:#fff;--muted:rgba(255,255,255,.75)}
.lslide.invert .s-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.65))}
.lslide.accent{background:var(--accent);color:var(--accent-fg);--text:var(--accent-fg);--muted:var(--accent-fg)}
.L-title{justify-content:center}
.L-title .s-r .prose :is(h1,h2){font-size:84px;letter-spacing:-.035em;line-height:1;margin:0}
.L-title .s-r .prose :is(h1,h2)~p{font-size:28px;color:var(--muted);margin:28px 0 0}
.L-title .s-r .prose>p:first-child:has(+h1,+h2){font-size:20px;font-weight:600;color:var(--accent);letter-spacing:.08em;text-transform:uppercase;margin:0 0 26px}
.L-title .s-body,.L-section .s-body,.L-center .s-body,.L-stat .s-body,.L-quote .s-body{align-items:center}
.L-section .s-r .prose :is(h1,h2){font-size:72px;letter-spacing:-.03em;line-height:1.05;margin:0}
.L-section .s-r .prose :is(h1,h2)::before{content:"";display:block;width:72px;height:6px;border-radius:3px;background:var(--accent);margin-bottom:34px}
.L-section .s-r .prose :is(h1,h2)~p{font-size:28px;color:var(--muted);margin:24px 0 0}
.L-center .s-r,.L-stat .s-r,.L-quote .s-r{text-align:center;align-items:center}
.L-center .s-r .prose{font-size:44px;line-height:1.3}
.L-center .s-r .prose :is(h1,h2){font-size:64px;margin:0 0 .3em}
.L-stat .s-r .prose{font-size:30px;color:var(--muted)}
.L-stat .s-r .prose strong,.L-stat .s-r .prose h1{display:block;font-size:132px;line-height:1;letter-spacing:-.04em;color:var(--accent);font-weight:750;margin:0 0 12px}
.L-quote .s-r .prose blockquote{border:0;padding:0;margin:0;color:var(--text);font-family:var(--read-font);font-size:52px;line-height:1.25;font-style:italic}
.L-quote .s-r .prose blockquote::before{content:"\\201C";display:block;font-size:120px;line-height:.6;color:var(--accent);font-style:normal}
.L-quote .s-r .prose>p{font-size:24px;color:var(--muted);margin-top:28px}
.L-full .s-r{align-items:stretch;justify-content:center}
.L-full .s-r .prose{display:flex;flex-direction:column;justify-content:center;flex:1;min-height:0}
.L-full .s-r .prose p:has(>img){display:flex;justify-content:center;margin:0}
.L-full .s-r .prose img{max-height:520px;max-width:100%;object-fit:contain;border-radius:14px}
.L-full .s-r .mermaid-card{background:transparent;border:0;margin:0;padding:0;display:flex;justify-content:center}
.L-full .s-r .mermaid-block{background:transparent;border:0;padding:0}
.L-full .s-r .mermaid-block svg{max-height:500px;max-width:1100px}
.L-blank{padding:0}
.lslide.align-left .s-r{text-align:left;align-items:flex-start}
/* free placement: ::: box x y w h (percent of the slide) */
.lslide .md-box{position:absolute;left:calc(var(--x)*1%);top:calc(var(--y)*1%);width:calc(var(--w)*1%);height:calc(var(--h)*1%);transform:rotate(var(--r,0deg));z-index:2;overflow:hidden;font-size:26px;line-height:1.35}
.lslide .md-box>:first-child{margin-top:0}.lslide .md-box>:last-child{margin-bottom:0}
.lslide .md-box img{width:100%;height:100%;object-fit:contain;max-height:none;border-radius:12px}
.lslide .md-box.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:22px 26px}
.lslide .md-box.center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.lslide.arranging .md-box{outline:2px dashed var(--accent);outline-offset:2px;cursor:move;overflow:visible;user-select:none}
.lslide.arranging .md-box:hover{outline-style:solid}
.lslide .box-h{position:absolute;width:18px;height:18px;border-radius:4px;background:var(--bg);border:3px solid var(--accent);box-sizing:border-box;z-index:3}
.lslide .box-h.h-nw{left:-10px;top:-10px;cursor:nwse-resize}.lslide .box-h.h-ne{right:-10px;top:-10px;cursor:nesw-resize}
.lslide .box-h.h-sw{left:-10px;bottom:-10px;cursor:nesw-resize}.lslide .box-h.h-se{right:-10px;bottom:-10px;cursor:nwse-resize}
.lslide .guide{position:absolute;z-index:4;pointer-events:none;display:none;background:var(--accent)}
.lslide .guide.gx{top:0;bottom:0;width:2px;margin-left:-1px}.lslide .guide.gy{left:0;right:0;height:2px;margin-top:-1px}
.lslide .box-tag{position:absolute;left:-2px;top:-26px;font:600 13px/20px Inter,sans-serif;color:var(--accent-fg);background:var(--accent);border-radius:5px;padding:0 6px;white-space:nowrap}
`;

/** Shrink a region's text until it fits its box (down to 62%); media keeps its own limits. */
function fitText(box: HTMLElement, target: HTMLElement) {
  target.style.fontSize = "";
  const base = parseFloat(getComputedStyle(target).fontSize) || 30;
  let f = 1;
  while (box.scrollHeight > box.clientHeight + 2 && f > 0.62) { f -= 0.06; target.style.fontSize = `${base * f}px`; }
}

export interface BoxPos { x: number; y: number; w: number; h?: number }

/** One slide rendered at 1280 × 720 and scaled to fit its box. Images are tap-to-zoom.
 *  With a layout directive it renders header/regions/side image/background (lib/deck.ts planSlide); without one it
 *  keeps the automatic styling (title / bullets / image / video / diagram / text). `arrange` makes boxes draggable. */
export function SlideStage({ note, md, dirs, blank, counter, frameless, onZoom, className, arrange, bare }: {
  note: Pick<Note, "id" | "spaceId">; md: string; dirs?: Dirs; blank?: boolean; counter?: { i: number; n: number }; frameless?: boolean; onZoom?: (src: string, alt: string) => void; className?: string;
  arrange?: (line: number, pos: BoxPos) => void; /** No rounding or border (inside a SlideFrame). */ bare?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const info = useMemo(() => slideInfo(md), [md]);
  const plan = useMemo(() => planSlide(md, dirs), [md, dirs]);
  const slideRef = useRef<HTMLDivElement>(null);
  const P = (body: string) => <Preview note={{ id: note.id, body, spaceId: note.spaceId }} />;
  // Fit text to its region after render, again when diagrams/images arrive.
  useEffect(() => {
    const el = slideRef.current;
    if (!el) return;
    const run = () => {
      if (plan.layout) el.querySelectorAll<HTMLElement>(".s-r").forEach((r) => { const p = r.querySelector<HTMLElement>(":scope > .prose"); if (p) fitText(r, p); });
      else if (info.layout === "text" || info.layout === "bullets") { const p = el.querySelector<HTMLElement>(":scope > .prose"); if (p) fitText(p, p); }
    };
    const ts = [0, 250, 900, 2000].map((d) => setTimeout(run, d));
    return () => ts.forEach(clearTimeout);
  }, [md, plan, info.layout]);
  // Arrange: drag a box to move it, its corner handle to resize; the new x/y/w/h is written back to the note.
  useEffect(() => {
    const el = slideRef.current;
    if (!el || !arrange || !scale) return;
    const cleanups: (() => void)[] = [];
    // Guides: amber lines when an edge or centre lines up with the slide's edges/centre or another box (snaps within 1%).
    const gx = document.createElement("div"); gx.className = "guide gx";
    const gy = document.createElement("div"); gy.className = "guide gy";
    el.append(gx, gy);
    cleanups.push(() => { gx.remove(); gy.remove(); });
    const boxes = [...el.querySelectorAll<HTMLElement>(".md-box[data-line]")];
    const read = (b: HTMLElement) => { const cs = getComputedStyle(b); const v = (k: string) => parseFloat(cs.getPropertyValue(k)); return { x: v("--x"), y: v("--y"), w: v("--w"), h: Number.isFinite(v("--h")) ? v("--h") : (b.offsetHeight / 720) * 100 }; };
    boxes.forEach((b) => {
      const handles = (["nw", "ne", "sw", "se"] as const).map((d) => { const h = document.createElement("span"); h.className = `box-h h-${d}`; h.dataset.dir = d; return h; });
      const tag = document.createElement("span"); tag.className = "box-tag";
      b.append(...handles, tag);
      const show = (p: BoxPos) => { tag.textContent = `x ${Math.round(p.x)} · y ${Math.round(p.y)} · ${Math.round(p.w)}×${Math.round(p.h ?? 0)}`; };
      show(read(b));
      const down = (e: PointerEvent) => {
        e.preventDefault(); e.stopPropagation();
        const dir = (e.target as HTMLElement).dataset.dir ?? "";
        const s = read(b), x0 = e.clientX, y0 = e.clientY;
        const sx = 100 / (1280 * scale), sy = 100 / (720 * scale);
        const others = boxes.filter((o) => o !== b).map(read);
        const tx = [0, 50, 100, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
        const ty = [0, 50, 100, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
        /** Nearest target for any of `edges` (within 1%): the shift to apply and where to draw the guide. */
        const near = (edges: number[], ts: number[]) => {
          let best: { d: number; at: number } | null = null;
          for (const e of edges) for (const t of ts) { const d = t - e; if (Math.abs(d) < 1 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }
          return best;
        };
        const half = (v: number) => Math.round(v * 2) / 2;
        let cur: BoxPos = s;
        b.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
          const dx = (m.clientX - x0) * sx, dy = (m.clientY - y0) * sy;
          let { x, y, w } = s, h = s.h ?? 10;
          let snapX: { d: number; at: number } | null = null, snapY: { d: number; at: number } | null = null;
          if (!dir) {
            x = half(Math.min(98, Math.max(-20, s.x + dx))); y = half(Math.min(98, Math.max(-20, s.y + dy)));
            snapX = m.altKey ? null : near([x, x + w / 2, x + w], tx); snapY = m.altKey ? null : near([y, y + h / 2, y + h], ty);
            if (snapX) x += snapX.d;
            if (snapY) y += snapY.d;
          } else {
            if (dir.includes("e")) { w = half(Math.max(4, s.w + dx)); snapX = m.altKey ? null : near([x + w], tx); if (snapX) w += snapX.d; }
            if (dir.includes("w")) { const r = s.x + s.w; x = half(Math.min(r - 4, s.x + dx)); snapX = m.altKey ? null : near([x], tx); if (snapX) x += snapX.d; w = r - x; }
            if (dir.includes("s")) { h = half(Math.max(4, (s.h ?? 10) + dy)); snapY = m.altKey ? null : near([y + h], ty); if (snapY) h += snapY.d; }
            if (dir.includes("n")) { const btm = s.y + (s.h ?? 10); y = half(Math.min(btm - 4, s.y + dy)); snapY = m.altKey ? null : near([y], ty); if (snapY) y += snapY.d; h = btm - y; }
          }
          cur = { x, y, w, h };
          b.style.setProperty("--x", String(x)); b.style.setProperty("--y", String(y)); b.style.setProperty("--w", String(w));
          if (dir || Number.isFinite(parseFloat(getComputedStyle(b).getPropertyValue("--h")))) b.style.setProperty("--h", String(h));
          gx.style.display = snapX ? "block" : "none"; if (snapX) gx.style.left = `${snapX.at}%`;
          gy.style.display = snapY ? "block" : "none"; if (snapY) gy.style.top = `${snapY.at}%`;
          show(cur);
        };
        const up = () => {
          b.removeEventListener("pointermove", move); b.removeEventListener("pointerup", up);
          gx.style.display = gy.style.display = "none";
          if (cur !== s) arrange(Number(b.dataset.line), { ...cur, h: dir || s.h !== undefined ? cur.h : undefined });
        };
        b.addEventListener("pointermove", move);
        b.addEventListener("pointerup", up);
      };
      b.addEventListener("pointerdown", down);
      cleanups.push(() => { b.removeEventListener("pointerdown", down); handles.forEach((h) => h.remove()); tag.remove(); });
    });
    return () => cleanups.forEach((c) => c());
  });
  // Title slides: when a long title wraps, break after its first comma ("Backprop,⏎from one neuron up").
  useEffect(() => {
    const h = slideRef.current?.querySelector<HTMLElement>(".l-title :is(h1,h2)");
    if (!h || h.querySelector("br") || h.offsetHeight < 84 * 1.5) return;
    const t = [...h.childNodes].find((n) => n.nodeType === 3 && /,\s/.test(n.textContent ?? ""));
    if (!t) return;
    const [a, ...b] = t.textContent!.split(/,\s/);
    t.replaceWith(document.createTextNode(a + ","), document.createElement("br"), document.createTextNode(b.join(", ")));
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / 1280, el.clientHeight / 720));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={cx("flex h-full w-full items-center justify-center", className)}>
      <style>{CSS}</style>
      <div className={cx("relative overflow-hidden bg-bg", bare ? "" : frameless ? "rounded-[6px] md:rounded-[10px]" : "rounded-[10px] border border-line")} style={{ width: 1280 * scale, height: 720 * scale, visibility: scale ? "visible" : "hidden" }}
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest("img");
          if (img && onZoom) { e.stopPropagation(); onZoom(img.currentSrc || img.src, img.alt); }
        }}>
        {!blank && (plan.layout ? (
          <div ref={slideRef} className={cx("lslide L", "L-" + plan.layout, plan.layout === "title" && "l-title", plan.cls, onZoom && "zoomable", arrange && "arranging")}
            style={{ transform: `scale(${scale})`, ...(plan.split ? { "--split": plan.split } : {}), ...(plan.cols ? { "--cols": plan.cols } : {}) } as React.CSSProperties}>
            {plan.bg && <div className="s-bg">{P(plan.bg)}</div>}
            {plan.side && <div className="s-side">{P(plan.side)}</div>}
            {plan.header && <div className="s-head">{P(plan.header)}</div>}
            <div className="s-body">
              {plan.regions.map((r, k) => <div key={r.name + k} className={"s-r s-r-" + r.name}>{P(r.md)}</div>)}
            </div>
          </div>
        ) : (
          <div ref={slideRef} className={cx("lslide", "l-" + info.layout, plan.cls, onZoom && "zoomable", arrange && "arranging")} style={{ transform: `scale(${scale})` }}>
            {plan.bg && <div className="s-bg">{P(plan.bg)}</div>}
            {P(plan.regions.length === 1 ? plan.regions[0].md : md.replace(/^\s*<!--.*-->\s*$/gm, ""))}
            {info.caption && (info.layout === "image" || info.layout === "diagram") && <div className="cap">{info.caption}</div>}
          </div>
        ))}
        {counter && !blank && <>
          <span className="absolute bottom-5 right-7 text-[14px] text-muted tabular-nums">{counter.i + 1} / {counter.n}</span>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((counter.i + 1) / counter.n) * 100}%` }} /></div>
        </>}
      </div>
    </div>
  );
}

/** Full-screen image viewer (tap a slide image). Tap, Esc or the X closes; wheel / pinch zooms. */
export function ImageZoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 fade-in" onClick={onClose} onWheel={(e) => setZ((x) => Math.max(1, Math.min(5, x * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-[13px] text-white/70">
        <span className="min-w-0 flex-1 truncate" dir="auto">{alt}</span>
        <button aria-label="Close image" onClick={onClose} className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"><X size={20} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ touchAction: "pinch-zoom" }}>
        <img src={src} alt={alt} onClick={(e) => { e.stopPropagation(); setZ((x) => (x > 1 ? 1 : 2)); }} className="max-h-full max-w-full rounded-[8px] object-contain transition-transform" style={{ transform: `scale(${z})`, cursor: z > 1 ? "zoom-out" : "zoom-in" }} />
      </div>
    </div>
  );
}

const pad2 = (x: number) => String(x).padStart(2, "0");
/** What the phone remote calls this presenter ("Remote · laptop"). */
const DEVICE = typeof navigator === "undefined" ? "laptop" : /iPad|Tablet|Android(?!.*Mobile)/i.test(navigator.userAgent) ? "tablet" : /Mobile/i.test(navigator.userAgent) ? "phone" : "laptop";

function RemotePopover({ link, onClose }: { link: ReturnType<typeof useRemoteLink>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [qr, setQr] = useState("");
  const url = link.pair ? remoteUrl(link.pair.code) : "";
  useEffect(() => { if (!link.pair) void link.open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (url) void qrDataUrl(url).then(setQr); }, [url]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-remote-btn]") && onClose();
    addEventListener("mousedown", h);
    return () => removeEventListener("mousedown", h);
  }, [onClose]);
  const dot = link.status === "synced" ? "var(--success)" : link.status === "waiting" ? "var(--accent)" : "var(--muted)";
  return (
    <div ref={ref} className="absolute bottom-full right-0 z-40 mb-2 flex w-[280px] flex-col items-center gap-3.5 rounded-[14px] border border-line bg-surface-2 p-[18px] text-[13px] text-ink shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
      <div className="flex w-full items-center justify-between text-[12px] text-muted"><span className="flex items-center gap-1.5"><Smartphone size={13} />Phone remote</span><button onClick={onClose} aria-label="Close" className="hover:text-ink"><X size={14} /></button></div>
      {link.error ? <span className="text-center leading-5 text-muted">{link.error}</span> : !link.pair ? <span className="py-8 text-muted">Opening a room…</span> : <>
        <div className="flex size-[168px] items-center justify-center rounded-[12px] bg-[#E8E6E1] p-3">{qr ? <img src={qr} alt="QR code for the phone remote" className="size-full [image-rendering:pixelated]" /> : null}</div>
        <span className="font-mono text-[22px] font-medium tracking-[.08em]">{prettyCode(link.pair.code)}</span>
        <span className="text-center text-[12px] leading-[18px] text-muted">Scan with your phone, or open <span className="break-all text-ink">{url.replace(/^https?:\/\//, "")}</span></span>
        <div className="flex w-full items-center justify-between border-t border-line pt-3 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: dot }} />{link.status === "synced" ? "Phone connected" : link.status === "waiting" ? "Waiting for phone…" : "Connecting…"}</span>
          <button onClick={() => { link.stop(); onClose(); }} className="hover:text-ink">Stop</button>
        </div>
      </>}
    </div>
  );
}

export function Slides({ note, onExit }: { note: Note; onExit: () => void }) {
  // A deck is shown as written; any other note is laid out automatically (doc → deck), without touching the note.
  const written = useMemo(() => isWrittenDeck(note), [note]);
  // Doc → deck: a note that isn't a deck first shows the preview (split at H1 / H2 / ---), then presents or saves.
  const [split, setSplit] = useState<SplitAt>("auto");
  const [preview, setPreview] = useState(() => !written);
  const deckMd = useMemo(() => (written ? note.body : docToDeck(note.body, note.title, split)), [written, note.body, note.title, split]);
  const slides = useMemo(() => deckSlides(deckMd), [deckMd]);
  const infos = useMemo(() => slides.map((s) => slideInfo(s.md)), [slides]);
  const [overview, setOverview] = useState(false);
  // The deck workspace (Arrange / Overview tabs, opened with A or the Arrange button); null = presenting.
  const [deckTab, setDeckTab] = useState<DeckTab | null>(() => { try { if (sessionStorage.getItem("lumen.deckStage") === note.id) { sessionStorage.removeItem("lumen.deckStage"); return "arrange"; } } catch { /* ignore */ } return null; });
  const [jump, setJump] = useState("");
  const [i, setI] = useState(0);
  const [blank, setBlank] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [timer, setTimer] = useState<{ t0: number; pausedAt: number | null }>(() => ({ t0: Date.now(), pausedAt: null }));
  const [, tick] = useState(0);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const audience = useRef<BroadcastChannel | null>(null);
  const n = slides.length;
  const go = (d: number) => { setBlank(false); setI((x) => Math.max(0, Math.min(n - 1, x + d))); };
  const cur = slides[Math.min(i, n - 1)];
  const next = infos[i + 1];

  const trimMd = (md: string) => md.replace(/^\n+/, (m) => (m.length > 400 ? "" : m));
  const nx = slides[i + 1];
  const state: DeckState = { type: "state", noteId: note.id, spaceId: note.spaceId, title: note.title, i, n, blank, md: cur ? trimMd(cur.md) : "", dirs: cur?.dirs, notes: cur?.notes ?? "", next: next?.title ?? "", nextMd: nx && nx.md.length < 12_000 ? trimMd(nx.md) : undefined, nextDirs: nx?.dirs, device: DEVICE, t0: timer.t0, pausedAt: timer.pausedAt };

  /** Arrange mode wrote a new position: rewrite that `::: box …` line in the note. */
  async function writeBox(line: number, p: BoxPos) {
    const lines = note.body.split("\n");
    const m = /^(\s*:{3,})\s*(.*)$/.exec(lines[line] ?? "");
    const spec = m && parseBlockInfo(m[2]);
    if (!m || !spec || spec.name !== "box") return;
    const r = (v: number) => String(Number(v.toFixed(1)));
    const keep = Object.entries(spec.attrs).filter(([k]) => !["x", "y", "w", "h"].includes(k)).map(([k, v]) => `${k}=${/\s/.test(v) ? `"${v}"` : v}`);
    lines[line] = `${m[1]} box x=${r(p.x)} y=${r(p.y)} w=${r(p.w)}${p.h != null ? ` h=${r(p.h)}` : ""}${keep.length ? " " + keep.join(" ") : ""}${spec.classes.length ? ` {${spec.classes.map((c) => "." + c).join(" ")}}` : ""}`;
    await updateNote(note.id, { body: lines.join("\n") });
  }
  /** Add a free box to the current slide (before its speaker notes). */
  async function addBox() {
    if (!cur) return;
    const lines = note.body.split("\n");
    let at = Math.min(cur.end, lines.length);
    for (let k = cur.start; k < at; k++) if (/^Notes?:/i.test(lines[k])) { at = k; break; }
    while (at > cur.start && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, "", "::: box x=30 y=36 w=40 h=24 {.card .center}", "New box: drag to move, corner to resize", ":::");
    await updateNote(note.id, { body: lines.join("\n") });
  }
  async function saveAsDeck() {
    const d = await createNote({ type: "slides", title: `${note.title} (deck)`, spaceId: note.spaceId, folderId: note.folderId, body: deckMd });
    toast("Saved as a deck: pick layouts and arrange, then present");
    try { sessionStorage.setItem("lumen.deckStage", d.id); } catch { /* ignore */ }
    openNote(d.id, "slides");
  }
  function onCmd(c: DeckCmd) {
    if (c.cmd === "next") go(1);
    else if (c.cmd === "prev") go(-1);
    else if (c.cmd === "goto" && typeof c.i === "number") { setBlank(false); setI(Math.max(0, Math.min(n - 1, c.i))); }
    else if (c.cmd === "blank") setBlank((b) => !b);
    else if (c.cmd === "timer") setTimer((t) => (t.pausedAt ? { t0: t.t0 + (Date.now() - t.pausedAt), pausedAt: null } : { ...t, pausedAt: Date.now() }));
    else if (c.cmd === "timer-reset") setTimer((t) => ({ t0: Date.now(), pausedAt: t.pausedAt ? Date.now() : null }));
  }
  const link = useRemoteLink(state, onCmd);

  // Audience window (second screen): same origin, synced over BroadcastChannel; no network needed.
  const stateJson = JSON.stringify(state);
  useEffect(() => { audience.current?.postMessage(stateJson); }, [stateJson]);
  useEffect(() => () => audience.current?.close(), []);
  async function openAudience() {
    const id = "local" + Math.random().toString(36).slice(2, 10);
    audience.current?.close();
    const bc = new BroadcastChannel("lumen.slides." + id);
    bc.onmessage = (e) => { if (e.data === "hello") bc.postMessage(JSON.stringify(stateRef.current)); else { try { onCmdRef.current(JSON.parse(e.data)); } catch { /* ignore */ } } };
    audience.current = bc;
    let features = "popup,width=1280,height=720";
    try {
      // Window Management API: put the audience view on the other screen when there is one.
      const sd = await (window as unknown as { getScreenDetails?: () => Promise<{ screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean }[]; currentScreen: unknown }> }).getScreenDetails?.();
      const other = sd?.screens.find((s) => s !== sd.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* permission denied: plain new window */ }
    window.open(`/remote/${id}?screen=1`, "lumen-audience-" + id, features);
    setPresenter(true);
  }
  const stateRef = useRef(state);
  stateRef.current = state;
  const onCmdRef = useRef(onCmd);
  onCmdRef.current = onCmd;

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (deckTab || preview) return; // the workspace and the preview dialog handle their own keys
      if ((e.target as HTMLElement).closest("input,textarea,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        // Space plays/pauses media on the current slide (never autoplays); otherwise advances.
        e.preventDefault();
        const m = stage.current?.querySelector<HTMLMediaElement>("video,audio");
        if (m) void (m.paused ? m.play() : m.pause());
        else go(1);
      } else if (/^\d$/.test(e.key)) setJump((j) => (j + e.key).slice(-3)); // type a number, Enter jumps there
      else if (e.key === "Enter" && jump) { e.preventDefault(); setBlank(false); setI(Math.max(0, Math.min(n - 1, Number(jump) - 1))); setJump(""); setOverview(false); }
      else if (["ArrowRight", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); if (jump) setJump((j) => j.slice(0, -1)); else go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "Escape") { if (jump) setJump(""); else if (overview) setOverview(false); else if (!document.fullscreenElement) onExit(); }
      else if (e.key === "f") void root.current?.requestFullscreen?.();
      else if (e.key === "b" || e.key === ".") setBlank((b) => !b);
      else if (e.key === "p") setPresenter((p) => !p);
      else if (e.key === "o" || e.key === "g") setOverview((o) => !o);
      else if (e.key === "a" && written) setDeckTab("arrange");
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!n) return <div className="p-10 text-muted">No slides. Separate slides with a line containing only <code>---</code>.</div>;
  if (preview && !written) return <DocToDeckDialog note={note} slides={slides} split={split} onSplit={setSplit} onPresent={() => setPreview(false)} onSave={() => void saveAsDeck()} onClose={onExit} />;
  if (deckTab && written) return <DeckWorkspace note={note} slides={slides} i={Math.min(i, n - 1)} setI={(k) => { setBlank(false); setI(k); }} tab={deckTab} setTab={setDeckTab} onPresent={() => setDeckTab(null)} writeBox={(l, p) => void writeBox(l, p)} addBox={() => void addBox()} />;
  const zoomer = (src: string, alt: string) => setZoom({ src, alt });
  const thumbs = (big: boolean) => (
    <div className={cx("hidden shrink-0 items-center gap-2.5 overflow-x-auto px-6 min-[1200px]:flex", big ? "h-[120px] py-4" : "h-[120px] border-t border-surface-2")}>
      {infos.map((s, k) => (
        <button key={k} onClick={() => go(k - i)} className={cx("relative flex shrink-0 flex-col rounded-[6px] bg-bg text-left", big ? "h-20 w-[142px] gap-1.5 p-2.5" : "h-[68px] w-[120px] gap-[5px] p-2", k === i ? "border-2 border-accent" : "border border-line", k < i && (big ? "opacity-60" : "opacity-55"))}>
          <span className={cx("truncate font-[650]", big ? "text-[10.5px]" : "text-[9.5px]")}>{s.title}</span>
          {big ? <><span className="h-[3px] w-[80%] rounded-[2px] bg-muted/40" /><span className="h-[3px] w-[60%] rounded-[2px] bg-muted/40" /></> : <span className="h-[3px] w-[70%] rounded-[2px] bg-muted/35" />}
          {s.media && <span className="absolute bottom-[5px] left-1.5 rounded-[4px] bg-white/[.12] px-[5px] text-[9.5px] leading-[15px]">{s.media}</span>}
          <span className={cx("absolute text-muted", big ? "bottom-1 right-1.5 text-[10px]" : "bottom-1 right-1.5 text-[9.5px]")}>{k + 1}</span>
        </button>
      ))}
    </div>
  );
  const remoteBtn = (label: React.ReactNode, className: string) => (
    <span className="relative">
      <button data-remote-btn onClick={() => setRemoteOpen((o) => !o)} className={className}>{label}</button>
      {remoteOpen && <RemotePopover link={link} onClose={() => setRemoteOpen(false)} />}
    </span>
  );
  const remoteLabel = link.status === "synced" ? "Synced to phone remote" : link.status === "off" ? "Phone remote" : link.status === "waiting" ? "Waiting for phone…" : "Connecting remote…";
  const el = timer.pausedAt ? timer.pausedAt - timer.t0 : Date.now() - timer.t0;
  const now = new Date();
  return (
    <div
      ref={root}
      className="fixed inset-0 z-40 flex flex-col bg-[#0A0C0F] text-ink"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touch.current = null; }}
    >
      {presenter ? (
        // ---------------------------------------------------------- presenter view (desktop)
        <>
          <div className="flex min-h-0 flex-1 gap-6 px-6 pt-6">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              <div ref={stage} className="aspect-video min-h-0 w-full shrink" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,details,video,audio,iframe,img")) go(1); }}>
                <SlideStage key={i} note={note} md={cur.md} dirs={cur.dirs} blank={blank} counter={{ i, n }} onZoom={zoomer} className="!justify-start" />
              </div>
              <div className="flex shrink-0 items-center gap-4 text-[12px] text-muted">
                <span>← → / Space to move</span><span>O overview</span><span>1–9 Enter jump</span><span>F full screen</span><span>B blank</span><span>Esc exit</span>
                <span className="flex-1" />
                <button onClick={openAudience} className="hover:text-ink">Audience window</button>
                <button onClick={() => setPresenter(false)} className="hover:text-ink">P hide notes</button>
                {remoteBtn(<span className="flex items-center gap-1.5">{link.status !== "off" && <span className="size-1.5 rounded-full" style={{ background: link.status === "synced" ? "var(--success)" : "var(--accent)" }} />}{remoteLabel}</span>, "hover:text-ink")}
              </div>
            </div>
            <aside className="flex w-[312px] shrink-0 flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <button onClick={() => onCmd({ type: "cmd", cmd: "timer" })} title={timer.pausedAt ? "Resume timer" : "Pause timer"} className={cx("font-mono text-[36px] font-medium tracking-[-.02em] tabular-nums", !!timer.pausedAt && "text-muted")}>{clock(el)}</button>
                <span className="text-[13px] text-muted">elapsed · {pad2(now.getHours())}:{pad2(now.getMinutes())}</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-muted">Next</span>
                <button onClick={() => next && go(1)} className="flex h-[170px] flex-col gap-2.5 rounded-[8px] border border-line bg-bg p-[18px] text-left">
                  {next ? <><span className="text-[17px] font-bold">{next.title}</span>{[80, 64, 70].map((w) => <span key={w} className="h-[5px] rounded-[3px] bg-muted/40" style={{ width: `${w}%` }} />)}</> : <span className="text-[13px] text-muted">End of deck</span>}
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <span className="text-[12px] text-muted">Speaker notes</span>
                <div className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-surface p-3.5 text-[15px] leading-6" dir="auto">{cur.notes || <span className="text-muted">No notes. Add a line starting with <code>Note:</code> at the end of a slide.</span>}</div>
              </div>
            </aside>
          </div>
          {thumbs(true)}
        </>
      ) : (
        // ---------------------------------------------------------- audience-style view (desktop) + phone
        <>
          <div className="h-8 shrink-0 md:hidden" />
          <div className="safe-t h-[3px] shrink-0 bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
          <div ref={stage} className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2 md:p-6" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,details,video,audio,iframe,img")) go(1); }}>
            <div className="h-full w-full md:max-w-[1120px]"><SlideStage key={i} note={note} md={cur.md} dirs={cur.dirs} blank={blank} onZoom={zoomer} frameless /></div>
          </div>
          {thumbs(false)}
          {/* Desktop bar */}
          <div className="hidden h-[52px] shrink-0 items-center gap-3.5 border-t border-surface-2 px-6 text-[13px] text-muted md:flex">
            <span className="flex flex-1 items-center gap-2 truncate">
              <span className="truncate">{note.title}</span>
              {!written && <button onClick={() => setPreview(true)} title="This note is laid out automatically. Preview the deck, change where it splits, save it as a deck note you can edit." className="flex shrink-0 items-center gap-1.5 rounded-[7px] border border-line px-2 py-1 text-[12px] hover:text-ink"><Save size={13} />Auto layout · Save as deck</button>}
            </span>
            <button aria-label="Previous" onClick={() => go(-1)} disabled={i === 0} className="flex size-[34px] items-center justify-center rounded-[8px] border border-line text-ink disabled:opacity-40"><ChevronLeft size={16} /></button>
            <span className="text-ink tabular-nums">{i + 1} / {n}</span>
            <button aria-label="Next" onClick={() => go(1)} disabled={i === n - 1} className="flex size-[34px] items-center justify-center rounded-[8px] border border-line text-ink disabled:opacity-40"><ChevronRight size={16} /></button>
            <span className="flex flex-1 items-center justify-end gap-1">
              <span className="mr-2 hidden xl:inline">O overview · F fullscreen · Esc exit</span>
              <IconButton label="Overview (O)" onClick={() => setOverview(true)}><LayoutGrid size={16} /></IconButton>
              {written && <IconButton label="Arrange (A): layouts, order, boxes" onClick={() => setDeckTab("arrange")}><Move size={16} /></IconButton>}
              <IconButton label="Presenter view (P)" onClick={() => setPresenter(true)}><PanelRight size={16} /></IconButton>
              {remoteBtn(<Smartphone size={16} style={{ color: link.status === "synced" ? "var(--success)" : undefined }} />, "flex size-8 items-center justify-center rounded-[8px] hover:bg-surface-2 hover:text-ink")}
              <IconButton label="Exit slides" onClick={onExit}><X size={18} /></IconButton>
            </span>
          </div>
          {/* Phone controls */}
          <div className="safe-b shrink-0 md:hidden">
            <div className="flex items-center gap-3 px-4 pb-3">
              <button aria-label="Previous" onClick={() => go(-1)} disabled={i === 0} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line disabled:opacity-40"><ChevronLeft size={20} /></button>
              <span className="w-[60px] text-center text-[14px] tabular-nums">{i + 1} / {n}</span>
              <button aria-label="Next" onClick={() => go(1)} disabled={i === n - 1} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line disabled:opacity-40"><ChevronRight size={20} /></button>
            </div>
            <div className="pb-1.5 text-center text-[12px] text-muted">Swipe ← → · tap image to zoom</div>
          </div>
          <button aria-label="Exit slides" onClick={onExit} className="safe-t absolute left-2 top-0 flex size-8 items-center justify-center text-muted md:hidden"><X size={18} /></button>
        </>
      )}
      {overview && (
        // R4-17C: the grid only (click a slide or type its number + Enter; Esc or a click outside closes)
        <div className="absolute inset-0 z-50 overflow-y-auto bg-[#0A0C0F] px-4 py-6 fade-in md:px-[60px] md:py-12" onClick={() => setOverview(false)}>
          <OverviewGrid note={note} slides={slides} i={i} onPick={(k) => { setBlank(false); setI(k); setOverview(false); }} />
        </div>
      )}
      {jump && <div className="pointer-events-none absolute left-1/2 top-6 z-[55] -translate-x-1/2 rounded-[10px] border border-line bg-surface px-4 py-2 text-[15px] shadow-xl">Go to slide <b className="tabular-nums">{jump}</b> · Enter</div>}
      {zoom && <ImageZoom src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </div>
  );
}
