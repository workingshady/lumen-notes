// GIFs, videos and web pages on a whiteboard, through Excalidraw's "embeddable" element.
// Excalidraw draws images on its <canvas>, so an animated GIF would only show its first frame; as an embeddable it is a
// real DOM <img>/<video> that plays. Media files are Lumen attachments; the element's link is the public /api/att/<id>
// URL (so other .excalidraw viewers can still open it) and customData.lumenMedia says how to render it.
import { useEffect, useState } from "react";

export type MediaKind = "gif" | "video" | "audio";
const ATT = /\/api\/att\/([\w-]+)/;

export const attIdOf = (link: string | null | undefined) => (link ? ATT.exec(link)?.[1] ?? null : null);
export const mediaKindOf = (mime: string): MediaKind | null =>
  mime === "image/gif" || mime === "image/apng" ? "gif" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : null;

type El = { id: string; link?: string | null; customData?: Record<string, unknown> };

function Media({ el, resolve }: { el: El; resolve: (attId: string) => Promise<string> }) {
  const id = attIdOf(el.link);
  const kind = (el.customData?.lumenMedia as MediaKind | undefined) ?? "video";
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; if (id) void resolve(id).then((u) => on && setSrc(u)).catch(() => on && setSrc(el.link ?? null)); return () => { on = false; }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = "block h-full w-full rounded-[6px] bg-black/5 object-contain";
  if (!src) return <div className={box} />;
  if (kind === "gif") return <img src={src} alt="" draggable={false} className={box} style={{ pointerEvents: "none" }} />;
  if (kind === "audio") return <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-surface p-3"><audio src={src} controls className="w-full" /></div>;
  return <video src={src} controls playsInline preload="metadata" className={box} style={{ background: "#000" }} />;
}

/** Props for <Excalidraw>: allow Lumen media + any https page, render media natively (other embeds keep Excalidraw's iframe). */
export function embedProps(resolve: (attId: string) => Promise<string>) {
  return {
    validateEmbeddable: (link: string) => (attIdOf(link) || /^https:\/\//i.test(link) ? true : undefined),
    renderEmbeddable: (el: El) => (attIdOf(el.link) ? <Media el={el} resolve={resolve} /> : null),
  };
}

/** Natural size of a media blob, scaled to fit `max` px. */
export async function mediaSize(blob: Blob, kind: MediaKind, max = 520): Promise<{ w: number; h: number }> {
  let w = 480, h = 270;
  if (kind === "audio") return { w: 360, h: 72 };
  const url = URL.createObjectURL(blob);
  try {
    if (kind === "gif") {
      const img = new Image();
      img.src = url;
      await img.decode();
      w = img.naturalWidth || w; h = img.naturalHeight || h;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      await new Promise<void>((res) => { v.onloadedmetadata = () => res(); v.onerror = () => res(); setTimeout(res, 4000); });
      if (v.videoWidth) { w = v.videoWidth; h = v.videoHeight; }
    }
  } catch { /* keep defaults */ } finally { URL.revokeObjectURL(url); }
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** A complete embeddable element (restoreElements fills the rest). */
export function mediaElement(o: { x: number; y: number; w: number; h: number; link: string; kind: MediaKind; attId: string }) {
  const r = () => Math.floor(Math.random() * 2 ** 31);
  return {
    type: "embeddable", id: Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4),
    x: o.x, y: o.y, width: o.w, height: o.h, angle: 0,
    strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 0, strokeStyle: "solid", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: r(), version: 1, versionNonce: r(), isDeleted: false, boundElements: null,
    updated: Date.now(), link: o.link, locked: false, customData: { lumenMedia: o.kind, lumenAtt: o.attId },
  };
}
