// PDF version comparison, page by page (design 58F/58G/58K): two versions of a PDF note side by side, changed words
// outlined in red (old) and green (new), an Overlay view (differences only) and a Text view (word diff of the page).
// Pages are rendered with pdf.js (lazy chunk, lib/pdf-doc.ts); the versions are the note's History (each body keeps
// the `file: att:<id>` it had), so no extra storage is needed.
import { diffWords } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { openPdf, pageText, renderPage, type PdfDoc } from "../../lib/pdf-doc";
import { Glyph } from "../Glyph";

export type PdfMode = "pages" | "overlay" | "text";
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function useDoc(file: string) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let dead = false, d: PdfDoc | null = null;
    setDoc(null); setErr("");
    openPdf(file).then((x) => { if (dead) void x.destroy(); else { d = x; setDoc(x); } }).catch((e) => !dead && setErr((e as Error).message));
    return () => { dead = true; void d?.destroy(); };
  }, [file]);
  return { doc, err };
}

/** One rendered page; spans of the text layer whose words are missing from `other` get an outline in `mark`. */
function PageCard({ doc, n, width, other, mark, blend }: { doc: PdfDoc | null; n: number; width: number; other: string; mark: string; blend?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"load" | "ok" | "none">("load");
  useEffect(() => {
    if (!doc || !box.current) return;
    if (n > doc.numPages) { setState("none"); return; }
    const sig = { cancelled: false };
    setState("load");
    let cancel: (() => void) | undefined;
    void renderPage(doc, n, box.current, width, { invert: false, signal: sig }).then((r) => {
      if (!r || sig.cancelled) return;
      cancel = r.cancel;
      const set = new Set(words(other));
      r.textLayer.querySelectorAll("span").forEach((s) => {
        const w = words(s.textContent ?? "");
        if (w.length && w.some((x) => !set.has(x))) { (s as HTMLElement).style.outline = `2px solid ${mark}`; (s as HTMLElement).style.outlineOffset = "1px"; (s as HTMLElement).style.borderRadius = "2px"; }
      });
      r.textLayer.style.pointerEvents = "none";
      setState("ok");
    });
    return () => { sig.cancelled = true; cancel?.(); };
  }, [doc, n, width, other, mark]);
  return (
    <div ref={box} style={{ position: "relative", width, minHeight: width * 1.3, borderRadius: 6, background: "#FBFAF7", boxShadow: "0 10px 30px rgba(0,0,0,.3)", overflow: "hidden", mixBlendMode: blend ? "multiply" : undefined }}>
      {state !== "ok" && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6A655C", fontSize: 12, textAlign: "center", padding: 12 }}>{state === "load" ? t("Opening…") : t("This version has no page {n}", { n })}</span>}
    </div>
  );
}

export function PdfCompare({ fromFile, toFile, fromLabel, toLabel, mode, phone, onStat }: {
  fromFile: string; toFile: string; fromLabel: string; toLabel: string; mode: PdfMode; phone: boolean; onStat: (s: string) => void;
}) {
  const a = useDoc(fromFile), b = useDoc(toFile);
  const [page, setPage] = useState(1);
  const [texts, setTexts] = useState<{ a: string[]; b: string[] } | null>(null);
  const total = Math.max(a.doc?.numPages ?? 0, b.doc?.numPages ?? 0);

  // Text of every page of both versions (once per pair): decides which pages changed.
  useEffect(() => {
    setTexts(null);
    if (!a.doc || !b.doc) return;
    let dead = false;
    (async () => {
      const ta: string[] = [], tb: string[] = [];
      for (let i = 1; i <= Math.max(a.doc!.numPages, b.doc!.numPages); i++) {
        ta.push(i <= a.doc!.numPages ? await pageText(a.doc!, i).catch(() => "") : "");
        tb.push(i <= b.doc!.numPages ? await pageText(b.doc!, i).catch(() => "") : "");
        if (dead) return;
      }
      setTexts({ a: ta, b: tb });
    })();
    return () => { dead = true; };
  }, [a.doc, b.doc]);

  const changed = useMemo(() => (texts ? texts.a.map((x, i) => i).filter((i) => norm(texts.a[i]) !== norm(texts.b[i])).map((i) => i + 1) : []), [texts]);
  useEffect(() => { setPage(1); }, [fromFile, toFile]);
  useEffect(() => {
    if (!total) return;
    onStat(texts ? t("Page {n} of {total} · {k} pages changed", { n: page, total, k: changed.length }) : t("Page {n} of {total}", { n: page, total }));
  }, [page, total, texts, changed, onStat]);

  const go = (d: number) => setPage((p) => Math.min(Math.max(1, p + d), Math.max(1, total)));
  const jump = (dir: 1 | -1) => { const c = dir === 1 ? changed.find((x) => x > page) : [...changed].reverse().find((x) => x < page); if (c) setPage(c); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.key === "PageDown" || e.key === "ArrowRight") go(1); else if (e.key === "PageUp" || e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const err = a.err || b.err;
  const w = phone ? 170 : 330;
  const ta = texts?.a[page - 1] ?? "", tb = texts?.b[page - 1] ?? "";
  const isChanged = changed.includes(page);
  const nav = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", paddingBottom: 10, color: "var(--muted)", fontSize: 12 }}>
      <button type="button" aria-label={t("Previous page")} onClick={() => go(-1)} disabled={page <= 1} style={navBtn}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Glyph name="chevron-right" size={14} /></span></button>
      <span>{t("Page {n} of {total}", { n: page, total })}</span>
      <button type="button" aria-label={t("Next page")} onClick={() => go(1)} disabled={page >= total} style={navBtn}><Glyph name="chevron-right" size={14} /></button>
      <span style={{ width: 1, height: 14, background: "var(--border)", margin: "0 4px" }} />
      <button type="button" onClick={() => jump(-1)} disabled={!changed.some((x) => x < page)} style={{ ...navBtn, width: "auto", padding: "0 8px" }}>{t("Previous change")}</button>
      <button type="button" onClick={() => jump(1)} disabled={!changed.some((x) => x > page)} style={{ ...navBtn, width: "auto", padding: "0 8px" }}>{t("Next change")}</button>
    </div>
  );
  if (err) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", padding: 24, textAlign: "center" }}>{err}</div>;

  const cap = (side: "a" | "b") => (isChanged ? `${t("p. {n}", { n: page })} · ${t("changed")}` : t("p. {n}", { n: page })) + (side === "b" && texts && !isChanged ? "" : "");
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: phone ? "12px 14px" : "22px 40px", overflow: "auto" }}>
      {nav}
      {mode === "text" ? (
        <div style={{ maxWidth: 760, margin: "0 auto", width: "100%", fontFamily: "'Source Serif 4',Georgia,serif", fontSize: phone ? 14.5 : 15.5, lineHeight: 1.7 }} dir="auto">
          {!texts ? <span style={{ color: "var(--muted)" }}>{t("Opening…")}</span> : !isChanged ? <span style={{ color: "var(--muted)" }}>{t("The text of this page is the same in both versions.")}</span> :
            diffWords(norm(ta), norm(tb)).map((p, i) => (
              <span key={i} style={{ background: p.added ? "color-mix(in srgb,var(--success) 26%,transparent)" : p.removed ? "color-mix(in srgb,var(--danger) 26%,transparent)" : "transparent", textDecoration: p.removed ? "line-through" : "none", borderRadius: 3, padding: "0 1px" }}>{p.value}</span>
            ))}
        </div>
      ) : mode === "overlay" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: "var(--muted)" }}>{t("DIFFERENCES ONLY")}</span>
          <div style={{ position: "relative", width: w * 1.5, background: "#fff", filter: "invert(1)", borderRadius: 6, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}>
            <PageCard doc={a.doc} n={page} width={w * 1.5} other="" mark="transparent" />
            <div style={{ position: "absolute", inset: 0, mixBlendMode: "difference" }}><PageCard doc={b.doc} n={page} width={w * 1.5} other="" mark="transparent" /></div>
          </div>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{cap("b")}</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", gap: 18, justifyContent: "center", alignItems: "flex-start" }}>
          {([["a", fromLabel, "var(--danger)", a.doc, tb, "rgba(196,43,43,.75)"], ["b", toLabel, "var(--success)", b.doc, ta, "rgba(31,138,76,.75)"]] as const).map(([k, h, hc, doc, other, mark]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8, width: w }}>
              <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: hc }}>{h}</span>
              <PageCard doc={doc} n={page} width={w} other={texts ? other : ""} mark={texts ? mark : "transparent"} />
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{cap(k)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const navBtn = { height: 24, width: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text)", fontSize: 11.5 } as const;
