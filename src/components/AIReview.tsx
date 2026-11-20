// AI review sheet (round 7 · Lumen 35A–H, 44J). Ported from design/handoffs/2026-11-20-round-7/WBStudio.dc.html (overlay "review").
//
// Mount (whiteboard / board / canvas):
//   {review && <AIReview image={blob} kind="text" onReplace={(r) => …} onAdd={(r) => …} onOpenAsArchitecture={(mermaid) => …} onClose={() => setReview(null)} />}
//  - `image`: PNG/JPEG Blob of the selected ink (or `text` for a text-only left side; then pass `initialResult` to skip the call).
//  - `kind`: first result tab: "text" | "math" (LaTeX tab) | "mermaid" | "shapes-hint" (Mermaid tab). Other tabs convert on demand.
//  - onReplace / onAdd get {kind, text} of the tab shown (edited text included). Nothing is touched before one of them runs;
//    the sheet closes after it. Undo is the host's job (one history step).
//  - onOpenAsArchitecture(mermaid) is shown on the Mermaid tab ("Open as architecture"); the host hands it to the studio.
//  - `phone` forces the full-screen layout; by default it follows the viewport (≤ 700 px).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Glyph } from "./Glyph";
import { t } from "../lib/i18n";
import { toast } from "../lib/store";
import { activeTheme } from "../lib/settings";
import { AiConvertError, convertImage, isOnline, type ConvertKind, type ConvertResult, type Span } from "../lib/ai-convert";

type Tab = "Text" | "LaTeX" | "Mermaid";
type Phase = "working" | "ok" | "error" | "offline";
const TAB_OF: Record<ConvertKind, Tab> = { text: "Text", math: "LaTeX", mermaid: "Mermaid", "shapes-hint": "Mermaid" };
const KIND_OF: Record<Tab, ConvertKind> = { Text: "text", LaTeX: "math", Mermaid: "mermaid" };
const TITLE: Record<Tab, string> = { Text: "Convert to text", LaTeX: "Convert to math", Mermaid: "Convert to Mermaid" };
const GLYPH = { Text: "to-text", LaTeX: "to-math", Mermaid: "to-mermaid" } as const;
const WA = "color-mix(in srgb,var(--warning) 22%,transparent)";

export interface AIReviewResult { kind: ConvertKind; text: string }
export interface AIReviewProps {
  image?: Blob;
  text?: string;
  kind: ConvertKind;
  initialResult?: string;
  onReplace: (r: AIReviewResult) => void;
  onAdd?: (r: AIReviewResult) => void;
  onOpenAsArchitecture?: (mermaid: string) => void;
  onClose: () => void;
  phone?: boolean;
}

interface Entry { phase: Phase; text: string; spans: Span[]; error?: string; neurons?: number }

const mono = "'JetBrains Mono',monospace";

function useIsPhone(force?: boolean) {
  const [p, setP] = useState(() => force ?? (typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches));
  useEffect(() => {
    if (force !== undefined) { setP(force); return; }
    const mq = matchMedia("(max-width: 700px)"); const f = () => setP(mq.matches);
    mq.addEventListener("change", f); return () => mq.removeEventListener("change", f);
  }, [force]);
  return p;
}

export function AIReview({ image, text, kind, initialResult, onReplace, onAdd, onOpenAsArchitecture, onClose, phone }: AIReviewProps) {
  const ph = useIsPhone(phone);
  const [tab, setTab] = useState<Tab>(TAB_OF[kind]);
  const [res, setRes] = useState<Partial<Record<Tab, Entry>>>(() => (initialResult !== undefined ? { [TAB_OF[kind]]: { phase: "ok", text: initialResult, spans: [] } } : {}));
  const [editing, setEditing] = useState<Partial<Record<Tab, boolean>>>({});
  const [pick, setPick] = useState<{ tab: Tab; i: number } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const url = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const run = useCallback(async (tb: Tab) => {
    if (!image) return;
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setPick(null);
    setEditing((e) => ({ ...e, [tb]: false }));
    if (!isOnline()) { setRes((r) => ({ ...r, [tb]: { phase: "offline", text: "", spans: [] } })); return; }
    setRes((r) => ({ ...r, [tb]: { phase: "working", text: "", spans: [] } }));
    try {
      const r: ConvertResult = await convertImage(image, KIND_OF[tb] === "mermaid" && kind === "shapes-hint" ? "shapes-hint" : KIND_OF[tb], { signal: c.signal });
      setRes((x) => ({ ...x, [tb]: { phase: "ok", text: r.text, spans: r.spans, neurons: r.neurons } }));
    } catch (e) {
      if (e instanceof AiConvertError && e.code === "aborted") return;
      const ae = e instanceof AiConvertError ? e : null;
      setRes((x) => ({ ...x, [tb]: { phase: ae?.code === "offline" ? "offline" : "error", text: "", spans: [], error: ae?.code === "unreadable" ? t("Couldn’t read this ink. Try a smaller selection or write more clearly.") : ae?.code === "limit" ? t("Daily free AI limit reached. Try tomorrow.") : ae?.code === "timeout" ? t("The AI took too long. Try a smaller selection.") : ae?.code === "too-large" ? t("That selection is too large. Try a smaller one.") : t("Couldn’t read this ink. Try a smaller selection or write more clearly.") } }));
    }
  }, [image, kind]);

  // First convert on open; other tabs convert when first shown.
  useEffect(() => { if (!res[tab]) void run(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Offline → retry automatically when the connection is back ("Will retry when you’re back online.").
  useEffect(() => {
    const on = () => { if (res[tab]?.phase === "offline") void run(tab); };
    addEventListener("online", on); return () => removeEventListener("online", on);
  }, [res, tab, run]);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (pick) setPick(null); else onClose(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [onClose, pick]);

  const cur: Entry = res[tab] ?? { phase: "working", text: "", spans: [] };
  const ok = cur.phase === "ok";
  const spans = !editing[tab] && ok ? cur.spans : [];
  const set = (patch: Partial<Entry>) => setRes((r) => ({ ...r, [tab]: { ...(r[tab] as Entry), ...patch } }));

  const choose = (i: number, alt: string | null) => {
    const sp = cur.spans[i];
    const word = alt ?? cur.text.slice(sp.start, sp.end);
    const delta = word.length - (sp.end - sp.start);
    set({ text: cur.text.slice(0, sp.start) + word + cur.text.slice(sp.end), spans: cur.spans.filter((_, j) => j !== i).map((s) => (s.start > sp.start ? { ...s, start: s.start + delta, end: s.end + delta } : s)) });
    setPick(null);
  };

  // ---- ink side: image, or text
  const ink = image
    // the snapshot is dark ink on white (best for the vision model); shown theme-aware with no white box: dark themes flip it
    // to light ink and screen away the black, light themes multiply the white away
    ? <img src={url} alt={t("Your ink")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", ...(activeTheme().dark ? { filter: "invert(93%) hue-rotate(180deg)", mixBlendMode: "screen" } : { mixBlendMode: "multiply" }) }} />
    : <div style={{ padding: 14, fontFamily: mono, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--text)" }}>{text}</div>;

  // ---- result box
  const font = tab === "Text" ? "'Source Serif 4',serif" : mono;
  const fs = tab === "Text" ? 15 : 13;
  const banner = cur.phase === "offline" ? t("You’re offline. Converting needs your Cloudflare account; your ink is safe.")
    : cur.phase === "error" ? (cur.error ?? "")
    : ok && cur.spans.length && !editing[tab] ? (cur.spans.length === 1 ? t("Not sure about 1 word. Highlighted words are guesses; click one to fix it.") : t("Not sure about {n} words. Highlighted words are guesses; click one to fix it.", { n: cur.spans.length })) : "";
  const bannerC = cur.phase === "error" ? "var(--danger)" : ok ? "var(--warning)" : "var(--muted)";

  const segs: { t: string; i: number }[] = [];
  { let p = 0; spans.forEach((s, i) => { if (s.start > p) segs.push({ t: cur.text.slice(p, s.start), i: -1 }); segs.push({ t: cur.text.slice(s.start, s.end), i }); p = s.end; }); if (p < cur.text.length || !segs.length) segs.push({ t: cur.text.slice(p), i: -1 }); }

  const copy = async () => { try { await navigator.clipboard.writeText(cur.text); toast(t("Copied")); } catch { toast(t("Couldn’t copy")); } };
  const done = (fn: (r: AIReviewResult) => void) => () => { fn({ kind: KIND_OF[tab] === "mermaid" && kind === "shapes-hint" ? "shapes-hint" : KIND_OF[tab], text: cur.text }); onClose(); };
  const btns: { l: string; pri?: boolean; dis: boolean; on: () => void }[] = [
    { l: t("Try again"), dis: cur.phase === "working", on: () => void run(tab) },
    { l: t("Copy"), dis: !ok, on: copy },
    tab === "Mermaid"
      ? { l: t("Open as architecture"), dis: !ok || !onOpenAsArchitecture, on: () => { onOpenAsArchitecture?.(cur.text); onClose(); } }
      : { l: t("Add next to it"), dis: !ok || !onAdd, on: done(onAdd ?? (() => {})) },
    { l: t("Replace ink"), pri: true, dis: !ok, on: done(onReplace) },
  ];
  const neurons = cur.neurons ?? 1;

  return (
    <div role="dialog" aria-modal="true" aria-label={t(TITLE[tab])} style={{ position: "fixed", inset: 0, zIndex: 80, fontFamily: "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif", color: "var(--text)" }}>
      <style>{`@keyframes lm-air-spin{to{transform:rotate(360deg)}}@keyframes lm-air-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes lm-air-fade{from{opacity:0}to{opacity:1}}`}</style>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", animation: "lm-air-fade .18s var(--ease) both" }} />
      <div style={{ position: "absolute", left: ph ? 0 : "max(16px, calc((100% - 1040px) / 2))", right: ph ? 0 : "max(16px, calc((100% - 1040px) / 2))", top: ph ? 0 : "max(16px, 12%)", bottom: ph ? 0 : "max(16px, 12%)", paddingTop: ph ? "env(safe-area-inset-top)" : 0, background: "var(--surface)", border: ph ? "none" : "1px solid var(--border)", borderRadius: ph ? 0 : 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.45)", animation: "lm-air-in .22s var(--ease) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Glyph name={GLYPH[tab]} size={18} />
          <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{t(TITLE[tab])}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{t("Workers AI · vision · {n} {u}", { n: neurons, u: neurons === 1 ? t("neuron") : t("neurons") })}</span>
          <button type="button" onClick={onClose} aria-label={t("Close")} style={{ fontSize: 16, color: "var(--muted)", background: "none", border: 0, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: ph ? "column" : "row", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderInlineEnd: ph ? "none" : "1px solid var(--border)", borderBottom: ph ? "1px solid var(--border)" : "none", minHeight: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)" }}>{t("YOUR INK")}</span>
            <div style={{ flex: 1, minHeight: 150, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>{ink}</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)", flex: 1 }}>{t("RESULT")}</span>
              <div role="tablist" style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
                {(["Text", "LaTeX", "Mermaid"] as Tab[]).map((l) => (
                  <button key={l} type="button" role="tab" aria-selected={l === tab} onClick={() => { setPick(null); setTab(l); }} style={{ height: 26, padding: "0 10px", borderRadius: 6, display: "flex", alignItems: "center", fontSize: 12, border: 0, cursor: "pointer", fontFamily: "inherit", background: l === tab ? "var(--surface)" : "transparent", color: l === tab ? "var(--text)" : "var(--muted)", transition: "background .15s, color .15s" }}>{t(l)}</button>
                ))}
              </div>
            </div>
            {banner && <div role={cur.phase === "error" ? "alert" : "status"} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, fontSize: 12, background: `color-mix(in srgb,${bannerC} 12%,transparent)`, color: bannerC }}>{banner}</div>}
            <div style={{ flex: 1, minHeight: 150, borderRadius: 10, border: `1px solid ${cur.phase === "error" ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", position: "relative", overflow: "auto", fontSize: fs, lineHeight: 1.6, fontFamily: font }}>
              {ok && (spans.length
                ? <div onClick={() => setEditing((e) => ({ ...e, [tab]: true }))} dir="auto" style={{ padding: 14, whiteSpace: "pre-wrap", minHeight: "100%", cursor: "text", boxSizing: "border-box" }} title={t("Click empty space to edit")}>
                    {segs.map((s, k) => s.i < 0 ? <span key={k}>{s.t}</span>
                      : <span key={k} style={{ position: "relative" }}><button type="button" onClick={(e) => { e.stopPropagation(); setPick({ tab, i: s.i }); }} style={{ font: "inherit", color: "var(--text)", background: WA, borderBottom: "1.5px dashed var(--warning)", borderRadius: 2, border: 0, borderBlockEnd: "1.5px dashed var(--warning)", padding: 0, cursor: "pointer" }}>{s.t}</button>
                        {pick?.tab === tab && pick.i === s.i && (
                          <span role="menu" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: "100%", zIndex: 3, marginTop: 4, minWidth: 140, padding: 4, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 14px 36px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", fontSize: 12.5, animation: "lm-air-in .15s var(--ease) both" }}>
                            <span style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--muted)" }}>{t("Maybe")}</span>
                            {cur.spans[s.i].alts.map((a) => <button key={a} type="button" role="menuitem" onClick={() => choose(s.i, a)} style={menuBtn}>{a}</button>)}
                            <button type="button" role="menuitem" onClick={() => choose(s.i, null)} style={{ ...menuBtn, color: "var(--muted)" }}>{t("Keep “{w}”", { w: s.t })}</button>
                          </span>)}
                      </span>)}
                  </div>
                : <textarea value={cur.text} onChange={(e) => set({ text: e.target.value })} dir="auto" spellCheck={tab === "Text"} aria-label={t("Result")} style={{ display: "block", width: "100%", height: "100%", minHeight: 150, boxSizing: "border-box", padding: 14, border: 0, outline: "none", resize: "none", background: "transparent", color: "var(--text)", font: "inherit", lineHeight: "inherit", whiteSpace: "pre-wrap" }} />)}
              {cur.phase === "working" && (
                <div role="status" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--muted)", fontFamily: "Inter", fontSize: 12.5 }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", border: "2.5px solid var(--border)", borderTopColor: "var(--accent)", animation: "lm-air-spin .8s linear infinite" }} />{t("Reading your handwriting…")}
                </div>)}
            </div>
            {tab === "LaTeX" && ok && <Latex src={cur.text} />}
            {tab === "Mermaid" && ok && <MermaidPreview src={cur.text} />}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1, minWidth: 140 }}>{cur.phase === "offline" ? t("Will retry when you’re back online.") : t("Nothing changes until you choose. One step to undo.")}</span>
          {btns.map((f) => (
            <button key={f.l} type="button" disabled={f.dis} onClick={f.on} style={{ height: 34, padding: "0 14px", borderRadius: 9, display: "flex", alignItems: "center", fontSize: 13, fontWeight: f.pri ? 600 : 500, fontFamily: "inherit", background: f.pri ? "var(--accent)" : "transparent", color: f.pri ? "var(--accent-fg)" : "var(--text)", border: `1px solid ${f.pri ? "transparent" : "var(--border)"}`, opacity: f.dis ? 0.4 : 1, whiteSpace: "nowrap", cursor: f.dis ? "default" : "pointer", transition: "opacity .15s, background .15s" }}>{f.l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

const menuBtn: React.CSSProperties = { textAlign: "start", padding: "6px 8px", borderRadius: 6, border: 0, background: "transparent", color: "var(--text)", font: "inherit", cursor: "pointer", whiteSpace: "nowrap" };

/** LaTeX preview under the source (design: 20 px Source Serif italic, 12 px padding, 10 px radius). */
function Latex({ src }: { src: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let live = true;
    void import("katex").then((k) => { if (live) setHtml(k.default.renderToString(src, { throwOnError: false, displayMode: false })); });
    return () => { live = false; };
  }, [src]);
  return <div aria-label={t("Preview")} dangerouslySetInnerHTML={{ __html: html }} style={{ display: "flex", borderRadius: 10, border: "1px solid var(--border)", padding: 12, alignItems: "center", justifyContent: "center", gap: 10, fontSize: 20, fontFamily: "'Source Serif 4',serif", fontStyle: "italic", overflowX: "auto" }} />;
}

/** Live Mermaid preview (debounced); a parse error shows a one-line note instead of the diagram. */
function MermaidPreview({ src }: { src: string }) {
  const [out, setOut] = useState<{ svg?: string; err?: string }>({});
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      void import("../lib/markdown").then((m) => m.renderMermaidForExport(src, "app", false)).then((svg) => { if (live) setOut({ svg }); }, () => { if (live) setOut({ err: t("This Mermaid doesn’t parse yet.") }); });
    }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [src]);
  return (
    <div aria-label={t("Preview")} style={{ borderRadius: 10, border: "1px solid var(--border)", padding: 10, maxHeight: "42%", minHeight: 70, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
      {out.svg ? <div style={{ maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: out.svg }} /> : out.err ?? t("Rendering diagram…")}
    </div>
  );
}

export default AIReview;
