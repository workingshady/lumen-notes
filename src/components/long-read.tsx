// Long notes in Read mode (Lumen 22 "12,000-word note"): a reading-progress line ("12,140 words · 54 min · 38% read"),
// foldable sections (caret on every h2/h3; a folded heading says "· 1,840 words folded"), "↑ Top", and the Outline
// panel's "Collapse all" (window event `lumen:fold-all`). Works on the rendered Preview in the same read pane.
import { useEffect, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { fmtNum, t } from "../lib/i18n";

/** Notes with at least this many words get folding + progress. */
export const LONG_WORDS = 3000;
const WPM = 225;
/** Folded heading lines per note (survive re-renders and leaving the note). */
const FOLDED = new Map<string, Set<string>>();
export const countWords = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
const isHead = (e: Element | null) => !!e && /^H[1-6]$/.test(e.tagName);
const level = (e: Element) => Number(e.tagName[1]);

/** Elements belonging to a heading's section (up to the next heading of the same or a higher level). */
function sectionOf(h: Element) {
  const out: HTMLElement[] = [];
  for (let e = h.nextElementSibling; e && !(isHead(e) && level(e) <= level(h)); e = e.nextElementSibling) out.push(e as HTMLElement);
  return out;
}

function apply(prose: HTMLElement, folded: Set<string>) {
  const heads = [...prose.children].filter((e) => isHead(e) && level(e) >= 2) as HTMLElement[];
  for (const h of heads) {
    const key = h.dataset.line ?? h.id ?? h.textContent ?? "";
    let car = h.querySelector<HTMLButtonElement>(":scope > .lr-caret");
    if (!car) {
      car = document.createElement("button");
      car.type = "button"; car.className = "lr-caret"; car.contentEditable = "false";
      h.prepend(car);
    }
    const on = folded.has(key);
    car.textContent = on ? "▸" : "▾";
    car.setAttribute("aria-expanded", String(!on));
    car.title = on ? t("Unfold section") : t("Fold section");
    car.onclick = (e) => { e.stopPropagation(); if (folded.has(key)) folded.delete(key); else folded.add(key); apply(prose, folded); };
    h.classList.toggle("lr-folded", on);
    let tag = h.querySelector<HTMLElement>(":scope > .lr-words");
    const sec = sectionOf(h);
    if (on) {
      if (!tag) { tag = document.createElement("span"); tag.className = "lr-words"; h.append(tag); }
      tag.textContent = ` · ${t("{n} words folded", { n: sec.reduce((a, e) => a + countWords(e.textContent ?? ""), 0) })}`;
    } else tag?.remove();
  }
  // Hide contents of folded sections (a parent fold wins over an open child).
  for (const e of [...prose.children] as HTMLElement[]) e.classList.remove("lr-hidden");
  for (const h of heads) if (h.classList.contains("lr-folded")) for (const e of sectionOf(h)) e.classList.add("lr-hidden");
}

export function LongRead({ note }: { note: Note }) {
  const ref = useRef<HTMLDivElement>(null);
  // Prose words only (table rows and code don't count towards reading time).
  const [words] = useState(() => countWords(note.body.replace(/^\s*\|.*$/gm, "").replace(/```[\s\S]*?```/g, "")));
  const [stick, setStick] = useState(0);
  const [pct, setPct] = useState(0);
  const [far, setFar] = useState(false);
  const long = words >= LONG_WORDS;
  useEffect(() => {
    const pane = ref.current?.closest<HTMLElement>(".read-pane");
    if (!pane || !long) return;
    setStick(-parseFloat(getComputedStyle(pane).paddingTop || "0")); // sticky offsets count from the padding edge
    const folded = FOLDED.get(note.id) ?? FOLDED.set(note.id, new Set()).get(note.id)!;
    // The Preview is the last .prose in the pane (a title-only .prose may come first).
    const prose = () => { const all = pane.querySelectorAll<HTMLElement>(".prose.reading"); return all[all.length - 1] ?? null; };
    const run = () => { const p = prose(); if (p) apply(p, folded); };
    run();
    const mo = new MutationObserver((m) => { if (m.some((x) => [...x.addedNodes].some((n) => n instanceof HTMLElement && !n.classList.contains("lr-caret") && !n.classList.contains("lr-words")))) run(); });
    const p = prose();
    if (p) mo.observe(p, { childList: true });
    const onScroll = () => { const max = pane.scrollHeight - pane.clientHeight; setPct(max > 0 ? Math.min(100, Math.round((pane.scrollTop / max) * 100)) : 100); setFar(pane.scrollTop > pane.clientHeight); };
    onScroll();
    pane.addEventListener("scroll", onScroll, { passive: true });
    const all = (e: Event) => {
      const fold = (e as CustomEvent<{ fold: boolean }>).detail?.fold ?? true;
      const pr = prose();
      if (!pr) return;
      folded.clear();
      if (fold) for (const h of pr.children) if (isHead(h) && level(h) >= 2) folded.add((h as HTMLElement).dataset.line ?? h.id ?? h.textContent ?? "");
      apply(pr, folded);
    };
    addEventListener("lumen:fold-all", all);
    return () => { mo.disconnect(); pane.removeEventListener("scroll", onScroll); removeEventListener("lumen:fold-all", all); };
  }, [note.id, long]);
  if (!long) return <div ref={ref} hidden />;
  return (
    <div ref={ref} className="sticky z-[5] -mb-2 flex h-7 shrink-0 items-center bg-bg text-[12px] text-muted" style={{ top: stick }} data-long-read>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-line"><span className="block h-full bg-accent" style={{ width: `${pct}%` }} /></span>
      <span data-progress>{t("{w} words · {m} min · {p}% read", { w: fmtNum(words), m: Math.max(1, Math.round(words / WPM)), p: pct })}</span>
      {far && (
        <button onClick={() => ref.current?.closest(".read-pane")?.scrollTo({ top: 0, behavior: "smooth" })} className="fixed bottom-6 end-6 z-20 flex h-8 items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink shadow-[0_8px_20px_rgba(0,0,0,.3)] hover:border-accent">↑ {t("Top")}</button>
      )}
    </div>
  );
}
