// Architecture AI (round 7 · Lumen 48C describe, 48D edit-by-instruction diff, 48E review, 48J phone).
// Ported from design/handoffs/2026-11-20-round-7/ArchStudio.dc.html + R6Block.dc.html.
//
// Mount in the studio, simplest form (everything docked with fixed positions):
//   {ai && <ArchAIPanel mode={ai} dsl={dsl} title={note.title}
//        onApplyDsl={(next) => setDsl(next)}            // Accept → write the DSL (one undo step is the studio's job)
//        onProposal={(p) => setCanvasDiff(p)}           // optional: p.rows / p.summary → colour nodes + edges green/red/amber; null when closed
//        onCreateNote={(title, md) => …}  onCreateTasks={(lines) => …}
//        getNoteText={() => noteBody}  getSketch={() => whiteboardPngBlob}   // optional sources for "RFC / PRD note" and "whiteboard sketch"
//        validate={(dsl) => parseDsl(dsl).errors}       // optional: W1-D's parser (src/lib/arch-dsl.ts); default is parseDsl from src/lib/arch-dsl.ts
//        onClose={() => setAi(null)} />}
//  mode: "describe" (48C) | "edit" (instruction → diff, 48D) | "review" (48E). The AI never touches the canvas until Accept.
// Slotted form: use <ArchDiffBar> in the canvas, <ArchDiffCode> in the code pane and <ArchReviewPanel> in the properties column
// (they fill their positioned parent) and drive them with `useArchProposal` results; ArchAIPanel is built from the same pieces.
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph } from "./Glyph";
import type { GlyphName } from "../lib/glyphs";
import { t } from "../lib/i18n";
import { toast } from "../lib/store";
import { parseDsl } from "../lib/arch-dsl";
import {
  AiConvertError, archFromText, cardsFromDsl, convertImage, diffDsl, diffSummary, docsFromDsl, editDsl, isOnline, reviewDsl, reviewToMarkdown, reviewToTasks,
  type ArchSource, type ArchType, type DiffRow, type DslIssue, type ReviewResult,
} from "../lib/ai-convert";

export type ArchAIMode = "describe" | "edit" | "review";
export interface ArchProposal { instruction: string; base: string; dsl: string; rows: DiffRow[]; summary: ReturnType<typeof diffSummary>; type?: ArchType }
export interface ArchAIPanelProps {
  mode: ArchAIMode;
  dsl: string;
  title?: string;
  phone?: boolean;
  validate?: (dsl: string) => DslIssue[];
  onApplyDsl: (dsl: string, meta: { mode: ArchAIMode; instruction: string; type?: ArchType }) => void;
  /** Slotted: the host draws the diff bar + code diff itself (ArchDiffBar / ArchDiffCode) and owns Accept / Reject; the panel only collects input. */
  slotted?: boolean;
  onProposal?: (p: ArchProposal | null) => void;
  onCreateNote: (title: string, markdown: string) => void;
  onCreateTasks?: (lines: string[]) => void;
  getNoteText?: () => string | Promise<string>;
  getSketch?: () => Blob | null | Promise<Blob | null>;
  onClose: () => void;
}

const KEYFRAMES = `@keyframes lm-aap-spin{to{transform:rotate(360deg)}}@keyframes lm-aap-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes lm-aap-sheet{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}`;
const AC = "color-mix(in srgb,var(--accent) 18%,transparent)";
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

const btn = (pri?: boolean, dis?: boolean, h = 32): React.CSSProperties => ({ height: h, padding: "0 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: pri ? 600 : 500, fontFamily: "inherit", background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", border: `1px solid ${pri ? "transparent" : "var(--border)"}`, whiteSpace: "nowrap", opacity: dis ? 0.4 : 1, cursor: dis ? "default" : "pointer", transition: "opacity .15s, background .15s" });
const heading: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" };
const Spinner = () => <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid color-mix(in srgb,currentColor 25%,transparent)", borderTopColor: "currentColor", animation: "lm-aap-spin .8s linear infinite" }} />;

/** R6Block `seg`: segmented control. */
function Seg({ items, on, set }: { items: string[]; on: number; set: (i: number) => void }) {
  return (
    <div role="tablist" style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
      {items.map((l, i) => (
        <button key={l} type="button" role="tab" aria-selected={i === on} onClick={() => set(i)} style={{ flex: 1, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, border: 0, fontFamily: "inherit", cursor: "pointer", background: i === on ? "var(--surface)" : "transparent", color: i === on ? "var(--text)" : "var(--muted)", fontWeight: i === on ? 600 : 400, whiteSpace: "nowrap", boxShadow: i === on ? "0 1px 2px rgba(0,0,0,.2)" : "none", padding: "0 6px", transition: "background .15s, color .15s" }}>{t(l)}</button>
      ))}
    </div>
  );
}

/** Default validator: the studio's own parser (src/lib/arch-dsl.ts). checkDsl() in ai-convert.ts is the parser-free fallback. */
const parserCheck = (d: string): DslIssue[] => parseDsl(d).errors.map((e) => ({ line: e.line, message: e.message }));

// ------------------------------------------------------------------ proposals
function makeProposal(instruction: string, base: string, dsl: string): ArchProposal {
  const rows = diffDsl(base, dsl);
  return { instruction, base, dsl, rows, summary: diffSummary(rows) };
}
const errText = (e: unknown) => (e instanceof AiConvertError ? (e.code === "offline" ? t("You’re offline. The AI runs on your Cloudflare account.") : e.code === "limit" ? t("Daily free AI limit reached. Try tomorrow.") : e.code === "timeout" ? t("The AI took too long. Try again.") : e.message) : t("AI request failed."));

const SOURCES: { g: GlyphName; l: string; src: ArchSource }[] = [
  { g: "code", l: "Code / OpenAPI", src: "code" }, { g: "container", l: "docker-compose · k8s", src: "compose" },
  { g: "cloud", l: "Terraform · CloudFormation", src: "terraform" }, { g: "database", l: "SQL / ORM", src: "sql" },
  { g: "note", l: "An RFC or PRD note", src: "rfc" }, { g: "whiteboard", l: "A whiteboard sketch", src: "describe" },
];
const TYPES: ArchType[] = ["architecture", "flowchart", "sequence", "erd", "c4"];
const detect = (s: string, hint: ArchSource): ArchSource => hint === "code" ? (/^\s*(\{[\s\S]*"openapi"|openapi\s*:)/i.test(s) ? "openapi" : "code") : hint === "compose" ? (/apiVersion\s*:/.test(s) ? "k8s" : "compose") : hint;

// ------------------------------------------------------------------ input popover (48C describe · 48D instruction · 48J phone)
function InputSheet({ mode, ph, props, onProposal, busy, setBusy }: { mode: "describe" | "edit"; ph: boolean; props: ArchAIPanelProps; onProposal: (p: ArchProposal) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState(0);
  const [source, setSource] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); return () => ctl.current?.abort(); }, []);
  const validate = props.validate ?? parserCheck;
  const describe = mode === "describe";

  const pickSource = async (i: number) => {
    setErr("");
    if (source === i) { setSource(null); return; }
    setSource(i);
    if (SOURCES[i].src === "rfc" && props.getNoteText) { try { setText(await props.getNoteText()); } catch { /* keep text */ } }
  };
  const disabledSrc = (s: (typeof SOURCES)[number]) => s.l === "A whiteboard sketch" && !props.getSketch;
  const canGo = !busy && (describe ? (text.trim().length > 0 || (source !== null && SOURCES[source].l === "A whiteboard sketch")) : text.trim().length > 0);

  const go = async () => {
    setErr("");
    if (!isOnline()) { setErr(t("You’re offline. The AI runs on your Cloudflare account.")); return; }
    const c = new AbortController(); ctl.current = c; setBusy(true);
    try {
      let body = text, src: ArchSource = "describe";
      const sk = source !== null ? SOURCES[source] : null;
      if (describe && sk?.l === "A whiteboard sketch") {
        const blob = await props.getSketch?.();
        if (!blob) throw new AiConvertError(t("Select the sketch on the whiteboard first."), "failed");
        body = (await convertImage(blob, "mermaid", { signal: c.signal })).text; src = "code";
      } else if (describe && sk) src = detect(text, sk.src);
      const r = describe ? await archFromText(body, { source: src, type: TYPES[type], signal: c.signal }) : await editDsl(props.dsl, text, c.signal);
      let issues = validate(r.dsl);
      let dsl = r.dsl;
      if (issues.length) { // one automatic retry: the AI writes diagram code that is checked before it touches the canvas
        const r2 = describe ? await archFromText(`${body}\n\n(Your previous answer had a syntax error on line ${issues[0].line}: ${issues[0].message}. Follow the DSL grammar exactly.)`, { source: src, type: TYPES[type], signal: c.signal }) : await editDsl(props.dsl, `${text}\n(Follow the DSL grammar exactly; line ${issues[0].line} was invalid: ${issues[0].message}.)`, c.signal);
        dsl = r2.dsl; issues = validate(dsl);
      }
      if (issues.length) throw new AiConvertError(t("The AI wrote diagram code that didn’t check out (line {n}). Try again or add detail.", { n: issues[0].line }), "failed");
      onProposal({ ...makeProposal(text.trim() || t("Sketch"), describe ? "" : props.dsl, dsl), type: describe ? TYPES[type] : undefined });
    } catch (e) {
      if (!(e instanceof AiConvertError && e.code === "aborted")) setErr(errText(e));
    } finally { setBusy(false); }
  };

  const note: React.CSSProperties = { fontSize: 11.5, lineHeight: "17px", color: "var(--muted)" };
  return (
    <div role="dialog" aria-label={describe ? t("Describe a system") : t("Edit by instruction")} style={ph
      ? { position: "fixed", left: 0, right: 0, bottom: 0, minHeight: "62%", maxHeight: "86%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "20px 20px 0 0", boxShadow: "0 20px 50px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 90, animation: "lm-aap-sheet .24s var(--ease) both" }
      : { position: "fixed", left: "max(16px, calc(50% - 380px))", top: 90, width: "min(760px, calc(100% - 32px))", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 20px 50px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 90, animation: "lm-aap-in .2s var(--ease) both" }}>
      {ph && <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)" }} /></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}>
        <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{describe ? t("Describe a system") : t("Edit by instruction")}</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("Workers AI · {n} neurons", { n: 2 })}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 14px 14px", overflow: "auto", flex: 1 }}>
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} dir="auto" rows={describe && source !== null && source !== 4 && source !== 5 ? 7 : 2}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGo) void go(); }}
          placeholder={describe ? (source === null || source === 5 ? t("Describe the system: what talks to what, and where it runs.") : t("Paste it here.")) : t("e.g. Add a Redis cache between API and DB")}
          style={{ ...note, color: "var(--text)", background: "var(--bg)", padding: "8px 10px", borderRadius: 8, border: "1px solid transparent", outline: "none", resize: "vertical", font: "inherit", fontSize: 11.5, lineHeight: "17px", width: "100%", boxSizing: "border-box" }} />
        {describe && <>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}><div style={heading}><span>{t("Type")}</span></div><Seg items={["Architecture", "Flowchart", "Sequence", "ERD", "C4"]} on={type} set={setType} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={heading}><span>{t("Or start from")}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {SOURCES.map((s, i) => (
                <button key={s.l} type="button" title={t(s.l)} disabled={disabledSrc(s)} onClick={() => void pickSource(i)} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", borderRadius: 8, background: source === i ? AC : "transparent", border: `1px solid ${source === i ? "var(--accent)" : "var(--border)"}`, color: "var(--text)", fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box", minWidth: 0, opacity: disabledSrc(s) ? 0.4 : 1, cursor: disabledSrc(s) ? "default" : "pointer", fontWeight: source === i ? 600 : 400, transition: "background .15s, border-color .15s" }}>
                  <Glyph name={s.g} size={17} /><span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "start", lineHeight: 1.35 }}>{t(s.l)}</span>
                </button>))}
            </div>
            <div style={note}>{t("The AI writes diagram code; it is checked before it touches the canvas. You review the draft next.")}</div>
          </div></>}
        {!describe && <div style={note}>{t("The change is shown as a diff first. Accept or Reject; nothing is applied until you accept.")}</div>}
        {err && <div role="alert" style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, color: "var(--danger)", background: "color-mix(in srgb,var(--danger) 12%,transparent)" }}>{err}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", justifyContent: "flex-end", marginTop: "auto" }}>
        <button type="button" style={btn()} onClick={() => { ctl.current?.abort(); props.onClose(); }}>{t("Cancel")}</button>
        <button type="button" style={btn(true, !canGo)} disabled={!canGo} onClick={() => void go()}>{busy && <Spinner />}{describe ? (busy ? t("Drafting…") : t("Draft diagram")) : (busy ? t("Working…") : t("Propose change"))}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ diff (48D)
/** The bar over the canvas: instruction, legend chips, Reject / Accept. */
export function ArchDiffBar({ p, onAccept, onReject, style }: { p: ArchProposal; onAccept: () => void; onReject: () => void; style?: React.CSSProperties }) {
  const s = p.summary;
  const parts = [s.added && t("{n} added", { n: s.added }), s.changed && t("{n} changed", { n: s.changed }), s.removed && t("{n} removed", { n: s.removed })].filter(Boolean).join(", ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 10px 26px rgba(0,0,0,.25)", fontSize: 12.5, flexWrap: "wrap", animation: "lm-aap-in .2s var(--ease) both", ...style }}>
      <Glyph name="assistant" size={16} color="var(--muted)" />
      <span style={{ flex: 1, minWidth: 160 }}>{`“${p.instruction.length > 80 ? p.instruction.slice(0, 80) + "…" : p.instruction}”`}{parts && ` · ${parts}`}</span>
      {([["Added", "var(--success)"], ["Changed", "var(--warning)"], ["Removed", "var(--danger)"]] as const).map(([l, c]) => (
        <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{t(l)}</span>))}
      <button type="button" style={btn(false, false, 30)} onClick={onReject}>{t("Reject")}</button>
      <button type="button" style={btn(true, false, 30)} onClick={onAccept}>{t("Accept")}</button>
    </div>
  );
}

const TOK = /(\/\/.*$)|("[^"]*")|(\[|\]|\{|\}|:|,|>)|(icon|tech|status|label|direction)(?=[:\s])|([^\s[\]{}:,>"]+)|(\s+)/g;
function tokens(line: string) {
  const out: { s: string; c: string; i: boolean }[] = [];
  for (const m of line.matchAll(TOK)) { const [s, c1, c2, c3, c4] = m; out.push({ s, c: c1 ? "var(--muted)" : c2 ? "var(--success)" : c3 ? "var(--muted)" : c4 ? "var(--link)" : "var(--text)", i: !!c1 }); }
  return out;
}
/** Code pane with the proposed change: + green, - red struck through (fills its positioned parent). */
export function ArchDiffCode({ p, style }: { p: ArchProposal; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 10px 0", padding: "8px 10px", borderRadius: 8, fontSize: 12, background: "color-mix(in srgb,var(--muted) 10%,transparent)", color: "var(--muted)" }}>{t("Proposed change · review before it touches the canvas")}</div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 0", font: `12.5px/21px ${mono}` }}>
        {p.rows.map((r, k) => (
          <div key={k} style={{ display: "flex", background: r.mark === "+" ? "color-mix(in srgb,var(--success) 12%,transparent)" : r.mark === "-" ? "color-mix(in srgb,var(--danger) 12%,transparent)" : "transparent", borderInlineStart: "2px solid transparent" }}>
            <span style={{ width: 38, flexShrink: 0, textAlign: "right", paddingRight: 12, color: "var(--muted)", userSelect: "none" }}>{r.n ?? ""}</span>
            <span style={{ width: 12, flexShrink: 0, color: r.mark === "+" ? "var(--success)" : "var(--danger)" }}>{r.mark}</span>
            <span style={{ whiteSpace: "pre", textDecoration: r.mark === "-" ? "line-through" : "none" }}>{tokens(r.text).map((k, j) => <span key={j} style={{ color: k.c, fontStyle: k.i ? "italic" : "normal" }}>{k.s}</span>)}</span>
          </div>))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ review (48E)
function nodeGlyph(dsl: string, text: string): GlyphName {
  for (const raw of dsl.split("\n")) {
    const m = raw.trim().match(/^([\w .-]+?)\s*\[icon:\s*([\w-]+)/);
    if (m && new RegExp(`\\b${m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return m[2] as GlyphName;
  }
  return "c-warning";
}
const MISS_G: Record<string, GlyphName> = { auth: "lock-shield", encryption: "key", backup: "archive", other: "c-info" };

/** Review column: In short, single points of failure, missing, STRIDE; Docs and Flashcards tabs; Save as note / Make tasks. */
export function ArchReviewPanel({ dsl, title, ph, onClose, onCreateNote, onCreateTasks, style }: { dsl: string; title?: string; ph?: boolean; onClose: () => void; onCreateNote: ArchAIPanelProps["onCreateNote"]; onCreateTasks?: ArchAIPanelProps["onCreateTasks"]; style?: React.CSSProperties }) {
  const [tab, setTab] = useState(0);
  const [rev, setRev] = useState<ReviewResult | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const [cards, setCards] = useState<string | null>(null);
  const [neurons, setNeurons] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const load = async (which: number) => {
    setErr("");
    const c = new AbortController(); ctl.current = c; setLoading(true);
    try {
      if (which === 0) { const r = await reviewDsl(dsl, c.signal); setRev(r.review); setNeurons((n) => n + r.neurons); }
      else if (which === 1) { const r = await docsFromDsl(dsl, c.signal); setDocs(r.text); setNeurons((n) => n + r.neurons); }
      else { const r = await cardsFromDsl(dsl, c.signal); setCards(r.text); setNeurons((n) => n + r.neurons); }
    } catch (e) { if (!(e instanceof AiConvertError && e.code === "aborted")) setErr(errText(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => { setTab(i); if ((i === 1 && docs === null) || (i === 2 && cards === null)) void load(i); };

  const md = () => (rev ? reviewToMarkdown(title ?? t("Architecture"), rev) : "") + (docs ? `\n\n## ${t("Docs")}\n${docs}` : "") + (cards ? `\n\n## ${t("Flashcards")}\n${cards}` : "");
  const saveNote = () => { if (!rev) return; onCreateNote(t("Review · {title}", { title: title ?? t("Architecture") }), md()); toast(t("Saved as a note")); };
  const tasks = () => {
    if (!rev) return;
    const lines = reviewToTasks(rev);
    if (onCreateTasks) onCreateTasks(lines); else onCreateNote(t("Tasks · {title}", { title: title ?? t("Architecture") }), lines.map((l) => `- [ ] ${l}`).join("\n"));
    toast(t("{n} tasks made", { n: lines.length }));
  };

  const Row = ({ g, children, trail }: { g: GlyphName; children: React.ReactNode; trail?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.35 }}><Glyph name={g} size={17} /><span style={{ flex: 1, minWidth: 0 }}>{children}</span>{trail}</div>
  );
  const sevC = (s: string) => (s === "High" ? "var(--danger)" : s === "Med" ? "var(--warning)" : "var(--muted)");
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px", overflow: "auto", flex: 1, minHeight: 0 }}>
      <Seg items={["Review", "Docs", "Flashcards"]} on={tab} set={go} />
      {loading && <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 12.5, padding: "20px 0", justifyContent: "center" }}><Spinner />{t("Reading the diagram…")}</div>}
      {err && <div role="alert" style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, color: "var(--danger)", background: "color-mix(in srgb,var(--danger) 12%,transparent)", display: "flex", gap: 8, alignItems: "center" }}><span style={{ flex: 1 }}>{err}</span><button type="button" style={btn(false, false, 26)} onClick={() => void load(tab)}>{t("Try again")}</button></div>}
      {!loading && !err && tab === 0 && rev && <>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={heading}><span>{t("In short")}</span></div>
          <div style={{ fontSize: 11.5, lineHeight: "17px", color: "var(--text)", background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>{rev.summary}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={heading}><span>{t("Single points of failure · {n}", { n: rev.spof.length })}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rev.spof.map((s, i) => <Row key={i} g={nodeGlyph(dsl, s)} trail={<Glyph name="c-warning" size={15} color="var(--warning)" />}>{s}</Row>)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={heading}><span>{t("Missing · {n}", { n: rev.missing.length })}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rev.missing.map((m, i) => <Row key={i} g={MISS_G[m.kind] ?? "c-info"}>{m.text}</Row>)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={heading}><span>{t("STRIDE · {n}", { n: rev.stride.length })}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rev.stride.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", fontSize: 12.5 }}><span style={{ flex: 1 }}>{`${s.cat}  ${s.text}`}</span><span style={{ fontSize: 10, fontWeight: 600, color: sevC(s.severity), border: `1px solid ${sevC(s.severity)}`, padding: "0 5px", borderRadius: 999, whiteSpace: "nowrap" }}>{t(s.severity)}</span></div>))}</div>
        </div></>}
      {!loading && !err && tab === 1 && docs !== null && <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: `12px/18px ${mono}`, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8 }}>{docs}</pre>}
      {!loading && !err && tab === 2 && cards !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{cards.split("\n").filter((l) => l.includes("::")).map((l, i) => { const [q, ...a] = l.replace(/^[-*\d.\s]+/, "").split("::"); return <div key={i} style={{ background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: "17px" }}><b style={{ fontWeight: 600 }}>{q.trim()}</b><div style={{ color: "var(--muted)" }}>{a.join("::").trim()}</div></div>; })}</div>)}
    </div>
  );
  return (
    <div role="region" aria-label={t("Review")} style={{ display: "flex", flexDirection: "column", background: "var(--surface)", boxShadow: ph ? "none" : "-12px 0 30px rgba(0,0,0,.25)", animation: "lm-aap-in .2s var(--ease) both", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{t("Review")}</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("Workers AI · {n} neurons", { n: neurons || 3 })}</span>
        <button type="button" onClick={onClose} aria-label={t("Close")} style={{ color: "var(--muted)", background: "none", border: 0, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      {body}
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", justifyContent: "flex-end", marginTop: "auto" }}>
        <button type="button" style={btn(false, !rev)} disabled={!rev} onClick={saveNote}>{t("Save as note")}</button>
        <button type="button" style={btn(true, !rev)} disabled={!rev} onClick={tasks}>{t("Make tasks")}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the panel
export function ArchAIPanel(props: ArchAIPanelProps) {
  const ph = useIsPhone(props.phone);
  const [prop, setProp] = useState<ArchProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const { onProposal, onClose } = props;
  const propose = (p: ArchProposal) => { setProp(p); onProposal?.(p); };
  const reject = () => { setProp(null); onProposal?.(null); onClose(); };
  const accept = () => { if (!prop) return; props.onApplyDsl(prop.dsl, { mode: props.mode, instruction: prop.instruction, type: prop.type }); onProposal?.(null); toast(t("Applied. Undo restores the previous diagram.")); onClose(); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { if (prop) reject(); else onClose(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onProposal?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useMemo(() => <style>{KEYFRAMES}</style>, []);
  const fam = { fontFamily: "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif", color: "var(--text)" };

  if (props.mode === "review") return (
    <div style={fam}>{style}
      <ArchReviewPanel dsl={props.dsl} title={props.title} ph={ph} onClose={onClose} onCreateNote={props.onCreateNote} onCreateTasks={props.onCreateTasks}
        style={ph ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "86%", minHeight: "60%", borderRadius: "20px 20px 0 0", border: "1px solid var(--border)", zIndex: 90 } : { position: "fixed", right: 0, top: 48, bottom: 0, width: "min(590px, 100%)", borderInlineStart: "1px solid var(--border)", zIndex: 90 }} />
    </div>);
  if (prop && props.slotted) return null;
  if (prop) return (
    <div style={fam}>{style}
      <ArchDiffBar p={prop} onAccept={accept} onReject={reject} style={ph ? { position: "fixed", left: 12, right: 12, top: 12, zIndex: 91 } : { position: "fixed", left: "calc(50% - 540px)", top: 60, width: 560, maxWidth: "calc(100% - 620px)", zIndex: 91 }} />
      <ArchDiffCode p={prop} style={ph ? { position: "fixed", left: 0, right: 0, bottom: 0, height: "56%", borderRadius: "20px 20px 0 0", border: "1px solid var(--border)", zIndex: 90 } : { position: "fixed", right: 0, top: 48, bottom: 0, width: "min(590px, 100%)", borderInlineStart: "1px solid var(--border)", zIndex: 90 }} />
    </div>);
  return <div style={fam}>{style}<InputSheet mode={props.mode} ph={ph} props={props} onProposal={propose} busy={busy} setBusy={setBusy} /></div>;
}

export default ArchAIPanel;
