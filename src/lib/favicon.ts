// Favicon with a review-due badge (design round 4, Lumen 21 › "Favicon · review due badge").
// When cards are due: the Lumen mark (dot glyph, no cone, no glow, dark tile) with a violet (#B48EF0) dot at the
// top-right corner, cut out from the mark by a 2 px ring. "No number below 32 px": tabs draw the favicon at 16/32 px,
// so the badge is a dot; the count goes in the link's title and the document title stays untouched.
// No cards due → the static favicons from index.html are restored.
import { useEffect } from "react";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x=".5" y=".5" width="63" height="63" rx="16" fill="#161A21" stroke="#2A303B"/><circle cx="32" cy="22" r="6.5" fill="#F2A93B"/><rect x="12" y="44" width="40" height="3.5" rx="1.75" fill="#E8E6E1"/></svg>`;
const BADGE = "#B48EF0";
let original: { el: HTMLLinkElement; href: string }[] | null = null;
let badgeLink: HTMLLinkElement | null = null;
let lastKey = "";
let markImg: Promise<HTMLImageElement> | null = null;

function loadMark() {
  markImg ??= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(MARK); });
  return markImg;
}

/** Draw the badged favicon (64 px canvas, scaled down by the browser). Exported for tests / the OG tooling. */
export async function drawBadgedFavicon(size = 64): Promise<string> {
  const img = await loadMark();
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, size, size);
  // badge: 12/48 of the mark (design 48 px → 12 px dot, flush with the corner), with a 2 px cut-out ring
  const r = size * 0.16, cx = size - r, cy = r, ring = size * (2 / 48);
  g.globalCompositeOperation = "destination-out";
  g.beginPath(); g.arc(cx, cy, r + ring, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-over";
  g.fillStyle = BADGE;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  return c.toDataURL("image/png");
}

/** Set (count > 0) or clear (0) the review-due badge on the tab icon. */
export async function setFaviconBadge(count: number) {
  if (typeof document === "undefined") return;
  const key = count > 0 ? "due" : "none";
  if (key === lastKey) { if (badgeLink) badgeLink.title = `${count} cards due`; return; }
  lastKey = key;
  original ??= [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((el) => ({ el, href: el.href }));
  if (count > 0) {
    let url = "";
    try { url = await drawBadgedFavicon(64); } catch { return; }
    if (lastKey !== "due") return;
    original.forEach(({ el }) => el.remove());
    if (!badgeLink) { badgeLink = document.createElement("link"); badgeLink.rel = "icon"; badgeLink.type = "image/png"; badgeLink.dataset.lumenBadge = "1"; }
    badgeLink.href = url;
    badgeLink.title = `${count} cards due`;
    document.head.appendChild(badgeLink);
  } else {
    badgeLink?.remove();
    original.forEach(({ el }) => { if (!el.isConnected) document.head.appendChild(el); });
  }
}

/** Keep the tab icon's badge in sync with the number of due cards. */
export function useFaviconBadge(due: number) {
  useEffect(() => { void setFaviconBadge(due); }, [due]);
}
