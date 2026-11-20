// Live cards on a Board (Lumen 40D–40G, 45E): note card (collapsed · card · expanded editor · missing), Mermaid card (view / edit),
// link card with preview, PDF page card. Markup and values follow R6Parts / WBStudio (`NC`, `cards`), converted 1:1.
// Excalidraw draws each as an `embeddable`; the board hands us the element and we render it here.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Note } from "../../../../shared/types";
import { updateNote } from "../../../lib/actions";
import { unfurl, type Unfurl } from "../../../lib/api";
import { noteSize, type LumenCard, type NoteState } from "../../../lib/convert/cards";
import { t } from "../../../lib/i18n";
import { renderMermaidForExport } from "../../../lib/markdown";
import { openNote, sameNote, useVaultSelector } from "../../../lib/store";
import { setPdfJump } from "../../../lib/pdf-note";
import { pdfMeta } from "../../../lib/pdf-format";
import { metaOf } from "../../../lib/diagrams";
import { splitFrontMatter } from "../../../lib/parse";
import { Glyph } from "../../Glyph";
import { plainExcerpt } from "../../nav-text";
import { canEditBoard, patchCard, removeEl } from "./cardApi";

type El = { id: string; link?: string | null; width: number; height: number; customData?: Record<string, unknown> };
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace";
const NOT_EDITABLE = new Set(["canvas", "whiteboard", "board", "diagram", "pdf", "base", "dashboard"]);

// Excalidraw leaves an embeddable inert (pointer-events: none) until it is double-clicked. The card body stays that way so a click
// selects and a drag moves the card; its controls opt back in, so Open / Edit / Done / the editors work at once.
if (typeof document !== "undefined" && !document.getElementById("lumen-card-css")) {
  const st = document.createElement("style");
  st.id = "lumen-card-css";
  st.textContent = ".lcard button,.lcard textarea,.lcard input{pointer-events:auto}.lcard{user-select:none;-webkit-user-select:none}.lcard textarea,.lcard input{user-select:text;-webkit-user-select:text}.lcard textarea{cursor:text}";
  document.head.appendChild(st);
}

// ------------------------------------------------------------------ shared parts (design: card shell, header, media, tags, buttons)
const shell = (o: { bd?: string; op?: number } = {}): CSSProperties => ({
  boxSizing: "border-box", width: "100%", height: "100%", background: "var(--surface)", border: o.bd ?? "1px solid var(--border)", borderRadius: 10, boxShadow: "0 6px 18px rgba(0,0,0,.18)",
  display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)", fontFamily: "var(--font-sans)", opacity: o.op ?? 1, textAlign: "start",
});
const stripes = "repeating-linear-gradient(135deg,var(--surface-2) 0 8px,var(--bg) 8px 16px)";

function Head({ glyph, kind, act, onAct, color, weight, size, pb, extra, onKind }: { onKind?: () => void; glyph: string; kind: string; act?: ReactNode; onAct?: () => void; color?: string; weight?: number; size?: number; pb?: number; extra?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `10px 12px ${pb ?? 0}px`, color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>
      <Glyph name={glyph} size={14} className="shrink-0" />
      {onKind
        ? <button type="button" dir="auto" onClick={(e) => { e.stopPropagation(); onKind(); }} style={{ flex: 1, textAlign: "start", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: color ?? "var(--muted)", fontWeight: weight ?? 400, fontSize: size ?? 11.5, background: "none", border: 0, padding: 0, cursor: "pointer" }}>{kind}</button>
        : <span dir="auto" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: color ?? "var(--muted)", fontWeight: weight ?? 400, fontSize: size ?? 11.5 }}>{kind}</span>}
      {extra}
      {act != null && (onAct
        ? <button type="button" onClick={(e) => { e.stopPropagation(); onAct(); }} style={{ color: "var(--muted)", cursor: "pointer", font: "inherit", background: "none", border: 0, padding: 0 }} className="hover:!text-[var(--text)]">{act}</button>
        : <span>{act}</span>)}
    </div>
  );
}
const Title = ({ children, onDoubleClick }: { children: ReactNode; onDoubleClick?: () => void }) => <div dir="auto" onDoubleClick={onDoubleClick} style={{ padding: "6px 12px 0", fontSize: 14, fontWeight: 600, lineHeight: "20px", flexShrink: 0 }}>{children}</div>;
const Excerpt = ({ children, pre }: { children: ReactNode; pre?: boolean }) => <div dir="auto" style={{ padding: "4px 12px 0", fontSize: 12, lineHeight: "18px", color: "var(--muted)", whiteSpace: pre ? "pre-wrap" : undefined, overflow: "hidden", minHeight: 0 }}>{children}</div>;
const Media = ({ children, style, mono = true }: { children?: ReactNode; style?: CSSProperties; mono?: boolean }) => (
  <div style={{ margin: "8px 12px 10px", flex: "1 1 0", minHeight: 40, borderRadius: 6, background: stripes, display: "flex", alignItems: "center", justifyContent: "center", font: mono ? `500 11px ${MONO}` : undefined, color: "var(--muted)", overflow: "hidden", ...style }}>{children}</div>
);
const Tags = ({ tags, children }: { tags: string[]; children?: ReactNode }) => (
  <div style={{ display: "flex", gap: 6, padding: "8px 12px 10px", flexWrap: "wrap", alignItems: "center", marginTop: "auto", flexShrink: 0 }}>
    {tags.slice(0, 4).map((tg) => <span key={tg} style={{ fontSize: 11, color: "var(--link)", background: "color-mix(in srgb,var(--link) 12%,transparent)", padding: "1px 7px", borderRadius: 999 }}>#{tg.replace(/^#/, "")}</span>)}
    <span style={{ flex: 1 }} />
    {children}
  </div>
);
const Btn = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ height: 26, padding: "0 9px", borderRadius: 7, display: "flex", alignItems: "center", fontSize: 11.5, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", whiteSpace: "nowrap", cursor: "pointer" }} className="hover:!bg-[var(--surface-2)]">{children}</button>
);

// ------------------------------------------------------------------ entry
export function CardView({ el, card }: { el: El; card: LumenCard }) {
  switch (card.kind) {
    case "mermaid": return <MermaidCard el={el} card={card} />;
    case "link": return <LinkCard card={card} />;
    case "pdf": return <PdfCard el={el} card={card} />;
    default: return <NoteCardView el={el} card={card} />;
  }
}

/** The note a card points at (by id, else by remembered title). */
function useCardNote(card: LumenCard, id: string) {
  const note = useVaultSelector((v) => ((card.noteId && v.byId.get(card.noteId)) || (card.title ? v.byTitle.get(card.title.replace(/\.(md|mermaid)$/i, "").toLowerCase()) ?? v.byTitle.get(card.title.toLowerCase()) : undefined)) || undefined, sameNote);
  const live = note && !note.deleted ? note : undefined;
  // remember the id and title: a renamed or deleted note keeps its card (and says what it was)
  useEffect(() => {
    if (!live || !canEditBoard()) return;
    const title = card.kind === "mermaid" && /\.mermaid$/i.test(live.title) ? live.title : live.title;
    if (card.noteId !== live.id || card.title !== title) patchCard(id, { noteId: live.id, title }, undefined, false);
  }, [live?.id, live?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  return live;
}

// ------------------------------------------------------------------ note card
function NoteCardView({ el, card }: { el: El; card: LumenCard }) {
  const note = useCardNote(card, el.id);
  const place = useVaultSelector((v) => { const n = card.noteId ? v.byId.get(card.noteId) : undefined; return n ? (n.folderId ? v.folderMap.get(n.folderId)?.name : v.spaceMap.get(n.spaceId)?.name) : undefined; });
  const state: NoteState = card.state ?? "card";
  const set = (s: NoteState) => patchCard(el.id, { state: s }, noteSize(s));
  const [finding, setFinding] = useState(false);
  const readOnly = !canEditBoard();

  if (!note && !readOnly) return finding ? <Finder el={el} card={card} onClose={() => setFinding(false)} /> : (
    <div className="lcard" style={shell({ bd: "1px dashed var(--danger)", op: 0.9 })} data-lumen-card="missing">
      <Head glyph="broken-link" kind={t("Note not found")} color="var(--danger)" />
      <Title>{card.title || t("Untitled")}</Title>
      <Excerpt>{t("Renamed or deleted. The card keeps its place.")}</Excerpt>
      <Tags tags={[]}><Btn onClick={() => setFinding(true)}>{t("Find note")}</Btn><Btn onClick={() => removeEl(el.id)}>{t("Remove")}</Btn></Tags>
    </div>
  );
  const title = note?.title ?? card.title ?? t("Untitled");
  const open = () => note && openNote(note.id);
  if (state === "collapsed") return (
    <div className="lcard" style={{ ...shell(), cursor: "pointer" }} onClick={() => !readOnly && set("card")} data-lumen-card="note-collapsed">
      <Head glyph="note-card" kind={title} color="var(--text)" weight={600} size={13} pb={10} act="⌄" onAct={readOnly ? undefined : () => set("card")} onKind={readOnly ? undefined : () => set("card")} />
    </div>
  );
  if (state === "expanded" && note && !NOT_EDITABLE.has(note.type)) return <Expanded el={el} note={note} place={place} onDone={() => set("card")} />;
  return (
    <div className="lcard" style={shell()} data-lumen-card="note" onDoubleClick={() => !readOnly && note && !NOT_EDITABLE.has(note.type) && set("expanded")}>
      <Head glyph="note-card" kind={`${t("Note")}${place ? ` · ${place}` : ""}`} act={t("Open")} onAct={open}
        extra={!readOnly ? <button type="button" aria-label={t("Collapse")} title={t("Collapse")} onClick={(e) => { e.stopPropagation(); set("collapsed"); }} style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", cursor: "pointer", fontSize: 11.5 }}>⌃</button> : undefined} />
      <Title>{title}</Title>
      {note && <Excerpt>{plainExcerpt(splitFrontMatter(note.body).body.replace(/^\s*#\s+.+\n?/, ""), 110)}</Excerpt>}
      <Tags tags={note?.tags ?? []}>{note && !NOT_EDITABLE.has(note.type) && !readOnly && <Btn onClick={() => set("expanded")}>{t("Edit")}</Btn>}</Tags>
    </div>
  );
}

/** Expanded: the note's text in place (saves as you type through updateNote); Done folds it back. */
/** Wheel over an editor scrolls the editor (Excalidraw would zoom the board). */
function useWheelGuard(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => { const el = ref.current; if (!el) return; const f = (e: WheelEvent) => { if (el.scrollHeight > el.clientHeight) e.stopPropagation(); }; el.addEventListener("wheel", f, { passive: true }); return () => el.removeEventListener("wheel", f); }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function Expanded({ el, note, place, onDone }: { el: El; note: Note; place?: string; onDone: () => void }) {
  const split = useMemo(() => {
    const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(note.body)?.[0] ?? "";
    const rest = note.body.slice(fm.length);
    const h1 = /^\s*#\s+(.+)\n?/.exec(rest);
    return { fm, h1: h1?.[0] ?? "", text: h1 ? rest.slice(h1[0].length).replace(/^\n/, "") : rest };
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState(split.text);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(text);
  const flush = () => { clearTimeout(timer.current); void updateNote(note.id, { body: split.fm + (split.h1 ? split.h1.replace(/\n?$/, "\n\n") : "") + latest.current }); };
  const change = (v: string) => { setText(v); latest.current = v; clearTimeout(timer.current); timer.current = setTimeout(flush, 500); };
  useEffect(() => () => { if (timer.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useWheelGuard(ref);
  return (
    <div className="lcard" style={shell({ bd: "1.5px solid var(--accent)" })} data-lumen-card="note-expanded">
      <Head glyph="note-card" kind={`${t("Note")}${place ? ` · ${place}` : ""} · ${t("editing")}`} act={t("Done")} onAct={() => { flush(); onDone(); }} />
      <Title>{note.title}</Title>
      <textarea ref={ref} value={text} dir="auto" spellCheck={false} aria-label={t("Note text")} onChange={(e) => change(e.target.value)} onBlur={flush}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { flush(); onDone(); } }}
        style={{ flex: 1, minHeight: 0, resize: "none", border: 0, outline: 0, background: "transparent", color: "var(--text)", padding: "4px 12px 0", fontSize: 12, lineHeight: "18px", fontFamily: "var(--font-sans)", whiteSpace: "pre-wrap" }} />
      <Tags tags={note.tags}><Btn onClick={() => { flush(); openNote(note.id); }}>{t("Open in tab")}</Btn></Tags>
    </div>
  );
}

/** Find note: re-point a missing card at another note. */
function Finder({ el, card, onClose }: { el: El; card: LumenCard; onClose: () => void }) {
  const notes = useVaultSelector((v) => v.notes);
  const [q, setQ] = useState(card.title ?? "");
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return notes.filter((n) => !n.deleted && (!s || n.title.toLowerCase().includes(s))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4); }, [notes, q]);
  return (
    <div className="lcard" style={shell({ bd: "1.5px solid var(--accent)" })} data-lumen-card="finder">
      <Head glyph="search" kind={t("Find note")} act={t("Cancel")} onAct={onClose} />
      <div style={{ padding: "6px 12px 0" }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={t("Find a note…")} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); if (e.key === "Enter" && list[0]) patchCard(el.id, { noteId: list[0].id, title: list[0].title }); }}
          style={{ width: "100%", height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", padding: "0 8px", fontSize: 12, outline: 0 }} />
      </div>
      <div style={{ padding: "4px 6px", overflow: "hidden" }}>
        {list.map((n) => <button key={n.id} type="button" onClick={() => patchCard(el.id, { noteId: n.id, title: n.title })} dir="auto" style={{ display: "block", width: "100%", textAlign: "start", height: 26, padding: "0 6px", borderRadius: 6, fontSize: 12, color: "var(--text)", background: "none", border: 0, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} className="hover:!bg-[var(--surface-2)]">{n.title}</button>)}
        {!list.length && <div style={{ padding: "6px", fontSize: 12, color: "var(--muted)" }}>{t("No notes match.")}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Mermaid card
const svgCache = new Map<string, string>();
function useMermaidSvg(src: string) {
  const [r, setR] = useState<{ svg?: string; err?: string }>(() => (svgCache.has(src) ? { svg: svgCache.get(src) } : {}));
  useEffect(() => {
    if (!src.trim()) { setR({}); return; }
    if (svgCache.has(src)) { setR({ svg: svgCache.get(src) }); return; }
    let on = true;
    const tm = setTimeout(() => {
      renderMermaidForExport(src, "app", false).then((svg) => { svgCache.set(src, svg); if (svgCache.size > 60) svgCache.delete(svgCache.keys().next().value!); on && setR({ svg }); })
        .catch((e) => on && setR({ err: String((e as Error).message ?? e).split("\n")[0] }));
    }, 150);
    return () => { on = false; clearTimeout(tm); };
  }, [src]);
  return r;
}

function MermaidCard({ el, card }: { el: El; card: LumenCard }) {
  const note = useCardNote(card, el.id);
  const fileBacked = !!note && note.type === "diagram";
  const src = fileBacked ? note!.body : card.src ?? "";
  const editing = card.mode === "edit" && canEditBoard();
  const [draft, setDraft] = useState(src);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (!editing) setDraft(src); }, [src, editing]);
  const save = (v: string) => { clearTimeout(timer.current); if (fileBacked) void updateNote(note!.id, { body: v }); else patchCard(el.id, { src: v }, undefined, false); };
  const change = (v: string) => { setDraft(v); clearTimeout(timer.current); timer.current = setTimeout(() => save(v), 500); };
  const { svg, err } = useMermaidSvg(editing ? "" : src);
  const name = fileBacked ? note!.title : card.title ?? "mermaid";
  const heading = note ? metaOf(note)?.heading : "";
  const toggle = (mode: "view" | "edit") => { if (mode === "view") save(draft); patchCard(el.id, { mode }); };
  if (editing) return (
    <div className="lcard" style={shell({ bd: "1.5px solid var(--accent)" })} data-lumen-card="mermaid-edit">
      <Head glyph="mermaid" kind={`${name} · ${t("editing")}`} act={t("Done")} onAct={() => toggle("view")} />
      <textarea value={draft} dir="ltr" spellCheck={false} autoFocus aria-label={t("Mermaid source")} onChange={(e) => change(e.target.value)} onBlur={() => save(draft)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") toggle("view"); }}
        style={{ flex: 1, minHeight: 0, resize: "none", margin: "8px 12px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", outline: 0, padding: "6px 10px", font: `500 11px/16px ${MONO}`, whiteSpace: "pre", overflow: "auto" }} />
    </div>
  );
  return (
    <div className="lcard" style={shell()} data-lumen-card="mermaid" onDoubleClick={() => canEditBoard() && toggle("edit")}>
      <Head glyph="mermaid" kind={name} act={canEditBoard() ? t("Edit") : undefined} onAct={() => toggle("edit")} />
      {heading ? <Title>{heading}</Title> : null}
      <Media mono={false} style={{ background: svg ? "transparent" : stripes, padding: 4 }}>
        {svg ? <div className="lumen-card-svg" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: svg }} />
          : err ? <span style={{ color: "var(--danger)", font: `500 11px ${MONO}`, padding: "0 8px", textAlign: "center" }}>{err}</span>
          : <span style={{ font: `500 11px ${MONO}` }}>{src.trim() ? t("Rendering diagram…") : t("Empty diagram. Click Edit.")}</span>}
      </Media>
      <style>{".lumen-card-svg>svg{max-width:100%;max-height:100%;width:auto;height:auto}"}</style>
    </div>
  );
}

// ------------------------------------------------------------------ link card
function LinkCard({ card }: { card: LumenCard }) {
  const url = card.url ?? "";
  const [u, setU] = useState<Unfurl | null | undefined>(undefined);
  useEffect(() => { let on = true; if (/^https?:\/\//i.test(url)) void unfurl(url).then((r) => on && setU(r)); else setU(null); return () => { on = false; }; }, [url]);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  return (
    <div className="lcard" style={shell()} data-lumen-card="link">
      <Head glyph="link-card" kind={u?.site || host} act="↗" onAct={() => window.open(url, "_blank", "noopener,noreferrer")} />
      <Title>{u?.title || host}</Title>
      {u?.description ? <Excerpt>{u.description.length > 110 ? u.description.slice(0, 108) + "…" : u.description}</Excerpt> : null}
      <Media style={u?.image ? { background: `center/cover no-repeat url("${u.image.replace(/"/g, "%22")}")` } : undefined}>{u?.image ? null : u === undefined ? t("Loading preview…") : t("preview")}</Media>
    </div>
  );
}

// ------------------------------------------------------------------ PDF page card
const docs = new Map<string, Promise<import("../../../lib/pdf-doc").PdfDoc>>();
function PdfCard({ el, card }: { el: El; card: LumenCard }) {
  const note = useCardNote(card, el.id);
  const page = card.page ?? 1;
  const file = note ? pdfMeta(note.body).file : "";
  const [img, setImg] = useState<{ src?: string; err?: string; pages?: number }>({});
  useEffect(() => {
    if (!file) return;
    let on = true;
    setImg((p) => ({ ...p, err: undefined }));
    (async () => {
      const { openPdf, renderThumb } = await import("../../../lib/pdf-doc");
      let d = docs.get(file);
      if (!d) { d = openPdf(file); docs.set(file, d); d.catch(() => docs.delete(file)); }
      const doc = await d;
      const n = Math.min(Math.max(1, page), doc.numPages);
      const src = await renderThumb(doc, n, Math.round(Math.max(200, el.width * 1.5)));
      if (on) setImg({ src, pages: doc.numPages });
    })().catch((e) => on && setImg({ err: String((e as Error).message ?? e).split("\n")[0] }));
    return () => { on = false; };
  }, [file, page, el.width]);
  if (!note && canEditBoard()) return (
    <div className="lcard" style={shell({ bd: "1px dashed var(--danger)", op: 0.9 })} data-lumen-card="missing">
      <Head glyph="broken-link" kind={t("PDF not found")} color="var(--danger)" />
      <Title>{card.title || "PDF"}</Title>
      <Excerpt>{t("Renamed or deleted. The card keeps its place.")}</Excerpt>
      <Tags tags={[]}><Btn onClick={() => removeEl(el.id)}>{t("Remove")}</Btn></Tags>
    </div>
  );
  const go = (d: number) => patchCard(el.id, { page: Math.min(Math.max(1, page + d), img.pages ?? 9999) });
  const nav = (c: string, f: () => void, label: string) => <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); f(); }} style={{ background: "none", border: 0, padding: "0 2px", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>{c}</button>;
  return (
    <div className="lcard" style={shell()} data-lumen-card="pdf">
      <Head glyph="pdf" kind={`${note?.title ?? card.title ?? "PDF"} · p. ${page}`} act={t("Open")} onAct={() => { if (note) { setPdfJump(note.id, page); openNote(note.id); } }}
        extra={canEditBoard() ? <>{nav("‹", () => go(-1), t("Previous page"))}{nav("›", () => go(1), t("Next page"))}</> : undefined} />
      <Media style={{ background: img.src ? "#fff" : stripes, margin: "8px 12px 10px", alignItems: img.src ? "flex-start" : "center" }}>
        {img.src ? <img src={img.src} alt="" draggable={false} style={{ width: "100%", display: "block", pointerEvents: "none" }} /> : img.err ? <span style={{ color: "var(--danger)", padding: "0 8px", textAlign: "center" }}>{img.err}</span> : <span>{file ? t("Rendering page…") : t("page {n}", { n: page })}</span>}
      </Media>
    </div>
  );
}
