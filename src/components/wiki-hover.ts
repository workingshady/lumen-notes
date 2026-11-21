// Lumen 02 5A: hovering a [[wiki link]] for 400 ms shows a small preview card (title, first lines, tags, updated).
import type { Note } from "../../shared/types";
import { fmtRelative } from "../lib/i18n";
import { splitFrontMatter } from "../lib/parse";

let timer = 0;
let card: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

export function hideWikiCard() {
  clearTimeout(timer);
  card?.remove();
  card = null; anchor = null;
}

const snippet = (n: Note) => splitFrontMatter(n.body).body.replace(/^\s*#\s.*$/m, "").replace(/```[\s\S]*?```/g, "").replace(/[#>*_`[\]!|-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);

/** Call from a mouseover handler; `find` resolves the link title to a note. */
export function wikiHover(e: { target: EventTarget | null }, find: (title: string) => Note | undefined) {
  const a = (e.target as HTMLElement).closest?.<HTMLElement>("a.wikilink");
  if (!a) { if (anchor) hideWikiCard(); return; }
  if (a.classList.contains("missing") || a.classList.contains("tc-chip") || a.classList.contains("tc-go")) return;
  if (a === anchor) return;
  hideWikiCard();
  const n = find(a.dataset.note ?? "");
  if (!n) return;
  anchor = a;
  timer = window.setTimeout(() => {
    const r = a.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "wiki-card";
    el.setAttribute("role", "tooltip");
    const title = document.createElement("div"); title.className = "wc-title"; title.dir = "auto"; title.textContent = n.title;
    const body = document.createElement("div"); body.className = "wc-body"; body.dir = "auto"; body.textContent = snippet(n) || "";
    const meta = document.createElement("div"); meta.className = "wc-meta"; meta.textContent = [fmtRelative(n.updatedAt), ...n.tags.slice(0, 3).map((x) => "#" + x)].join(" · ");
    el.append(title, body, meta);
    document.body.append(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left));
    const top = r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
    el.style.left = left + "px"; el.style.top = top + "px";
    card = el;
  }, 400);
}
