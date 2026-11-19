// Paste menu (Confluence-style "paste options"): after pasting a long text (> ~200 chars) or a URL inside a line,
// a small non-blocking chip offers Keep (default) · Clean up formatting · As quote · As link card (URLs) ·
// Summarize · Make flashcards (AI, plain labels). Esc or any typing dismisses it; every choice is one undo step.
// (A bare URL pasted on its own line keeps the Preview card / Embed / Plain link chip in Editor.tsx.)
import { isolateHistory } from "@codemirror/commands";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { ChangeDesc, Extension } from "@codemirror/state";
import { Loader2 } from "lucide-react";
import { Glyph } from "./Glyph";
import { useState } from "react";
import { aiRun, getToken } from "../lib/api";
import { DEMO } from "../lib/db";
import { t } from "../lib/i18n";
import { toast } from "../lib/store";
import { cx } from "./ui";

export interface PasteInfo { from: number; to: number; text: string; url: boolean; x: number; y: number }
export const LONG_PASTE = 200;
const URL_RE = /^https?:\/\/\S+$/;

/** Watches the editor for pastes (`input.paste`) and for any other edit (which dismisses / moves the menu). */
export function pasteWatch(onPaste: (p: Omit<PasteInfo, "x" | "y">, view: EditorView) => void, onEdit: (changes: ChangeDesc) => void): Extension {
  return EditorView.updateListener.of((u: ViewUpdate) => {
    if (!u.docChanged) return;
    const paste = u.transactions.find((tr) => tr.isUserEvent("input.paste"));
    if (!paste) { onEdit(u.changes); return; }
    let from = -1, to = -1;
    paste.changes.iterChanges((_fa, _ta, fb, tb) => { if (from < 0 || fb < from) from = fb; if (tb > to) to = tb; });
    if (from < 0 || to <= from) return;
    const text = u.state.sliceDoc(from, to);
    const url = URL_RE.test(text.trim());
    if (url && u.state.doc.lineAt(to).text.trim() === text.trim()) return; // bare URL line → the link chip handles it
    if (url || text.length > LONG_PASTE) onPaste({ from, to, text, url }, u.view);
  });
}

const BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|:::|\$\$)/;
/** Tidy text pasted from the web / PDFs / Word: odd spaces, bullets, hard wraps, hyphenation, blank-line runs. */
export function cleanPaste(s: string): string {
  let t = s.replace(/\r\n?/g, "\n").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/\t/g, "  ");
  t = t.replace(/[ ]+$/gm, "");
  t = t.replace(/^[ ]*[•◦▪▫●○■□‣⁃∙·][ ]*/gm, "- ");
  t = t.replace(/^([ ]*)(\d+)\)[ ]+/gm, "$1$2. ");
  t = t.replace(/(\S)[ ]{2,}(?=\S)/g, "$1 ");
  t = t.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
  const out: string[] = [];
  let fence = false;
  for (const line of t.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const prev = out[out.length - 1];
    if (!fence && prev && line.trim() && prev.trim() && !BLOCK_START.test(prev) && !BLOCK_START.test(line) && !/[.!?:;…。؟)"”]$/.test(prev) && /^[\p{Ll}\p{Lo}]/u.test(line.trim())) out[out.length - 1] = prev + " " + line.trim();
    else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const asQuote = (s: string) => s.replace(/\s+$/, "").split("\n").map((l) => (l.trim() ? "> " + l : ">")).join("\n");

type Choice = "keep" | "clean" | "quote" | "card" | "summary" | "cards";

export function PasteMenu({ info, view, phone, onClose, busy, setBusy }: {
  info: PasteInfo; view: EditorView; phone: boolean; onClose: () => void; busy: Choice | null; setBusy: (b: Choice | null) => void;
}) {
  const [sel, setSel] = useState<Choice>("keep");
  const signedIn = !!getToken() || DEMO; // demo mode: the dev simulator can mock the AI
  const still = () => view.state.sliceDoc(info.from, info.to) === info.text;
  const replace = (insert: string, event: string) => {
    if (!still()) { onClose(); return; }
    view.dispatch({ changes: { from: info.from, to: info.to, insert }, selection: { anchor: info.from + insert.length }, userEvent: event, annotations: isolateHistory.of("full"), scrollIntoView: true });
  };
  async function ai(kind: "summary" | "cards") {
    if (!signedIn) { toast(t("AI needs sync unlocked (Settings → Sync). Your paste is kept as is.")); return; }
    setBusy(kind);
    try {
      const out = (await aiRun(kind === "summary" ? "summarize" : "flashcards", info.text.slice(0, 12000))).trim();
      const body = kind === "summary"
        ? `> [!abstract] Summary\n${asQuote(out)}`
        : out.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim()).filter((l) => / :: /.test(l)).join("\n");
      if (!body.trim()) { toast(t("The AI didn't return anything usable.")); return; }
      // insert right after the pasted text (its range was kept up to date while the AI worked)
      const at = view.state.doc.lineAt(Math.min(info.to, view.state.doc.length)).to;
      const ins = "\n\n" + body + (at < view.state.doc.length ? "\n" : "");
      view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, userEvent: "input.ai", annotations: isolateHistory.of("full"), scrollIntoView: true });
      toast(kind === "summary" ? t("Summary added under the paste") : t("Flashcards added (they show in Review)"));
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); onClose(); view.focus(); }
  }
  const firstUrl = info.url ? info.text.trim() : (/https?:\/\/[^\s<>)\]]+/.exec(info.text)?.[0] ?? "");
  const run = (c: Choice) => {
    setSel(c);
    if (c === "keep") onClose();
    else if (c === "clean") { replace(cleanPaste(info.text), "input.paste.clean"); onClose(); }
    else if (c === "quote") { replace(asQuote(info.text), "input.paste.quote"); onClose(); }
    else if (c === "card") {
      if (!still() || !firstUrl) return onClose();
      if (info.url) {
        const line = view.state.doc.lineAt(info.from);
        const before = view.state.sliceDoc(line.from, info.from).trim() ? "\n\n" : "";
        const after = view.state.sliceDoc(info.to, view.state.doc.lineAt(info.to).to).trim() ? "\n\n" : "";
        replace(`${before}<${firstUrl}>${after}`, "input.paste.card");
      } else {
        // long text with a link in it: keep the text, add the link's preview card under it
        const at = view.state.doc.lineAt(info.to).to;
        const ins = `\n\n<${firstUrl}>` + (at < view.state.doc.length ? "\n" : "");
        view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, userEvent: "input.paste.card", annotations: isolateHistory.of("full"), scrollIntoView: true });
      }
      onClose();
    } else void ai(c);
    if (c !== "summary" && c !== "cards") view.focus();
  };
  // Design R4-16H: Keep · Clean up formatting · As quote · As link card · Summarize · Make flashcards (plain labels)
  const opts: { k: Choice; label: string; glyph: string; ai?: boolean; off?: string }[] = [
    { k: "keep", label: t("Keep"), glyph: "text" },
    ...(info.url ? [] : [
      { k: "clean" as const, label: t("Clean up formatting"), glyph: "c-abstract" },
      { k: "quote" as const, label: t("As quote"), glyph: "quote" },
    ]),
    { k: "card" as const, label: t("As link card"), glyph: "link-card", off: firstUrl ? undefined : t("No link in the pasted text") },
    ...(info.text.length > LONG_PASTE ? [
      { k: "summary" as const, label: t("Summarize"), glyph: "c-abstract", ai: true },
      { k: "cards" as const, label: t("Make flashcards"), glyph: "flashcards", ai: true },
    ] : []),
  ];
  const on = (k: Choice) => sel === k ? { background: "color-mix(in srgb,var(--accent) 14%,transparent)", boxShadow: "inset 0 0 0 1px var(--accent)", fontWeight: 600 } : { fontWeight: 450 };
  const title = (o: (typeof opts)[number]) => o.off ?? (o.ai && !signedIn ? t("Needs sync unlocked (Settings → Sync)") : undefined);
  if (phone) return (
    <div className="paste-menu flex gap-2 overflow-x-auto border-t border-line bg-surface-2 px-3 py-2" role="toolbar" aria-label={t("Paste options")} onMouseDown={(e) => e.preventDefault()}>
      {opts.map((o) => (
        <button key={o.k} disabled={!!busy || !!o.off} title={title(o)} onClick={() => run(o.k)} className={cx("flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px]", sel !== o.k && "border border-line", (o.off || (o.ai && !signedIn)) && "opacity-50")} style={on(o.k)}>
          {busy === o.k ? <Loader2 size={14} className="animate-spin" /> : <Glyph name={o.glyph} size={14} color="var(--muted)" />}{o.label}
        </button>
      ))}
    </div>
  );
  return (
    <div
      ref={(el) => {
        // keep the chip inside the editor pane (flip above the paste when it would overflow)
        if (!el?.parentElement) return;
        const room = el.parentElement.clientWidth - el.offsetWidth - 8;
        el.style.left = `${Math.max(8, Math.min(info.x, room))}px`;
        if (info.y + el.offsetHeight > el.parentElement.clientHeight - 8) el.style.top = `${Math.max(8, info.y - el.offsetHeight - 36)}px`;
      }}
      className="paste-menu absolute z-30 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] fade-in" role="toolbar" aria-label={t("Paste options")} style={{ left: Math.max(8, info.x), top: info.y, boxShadow: "0 14px 34px rgba(0,0,0,.45)" }} onMouseDown={(e) => e.preventDefault()}>
      {opts.map((o) => (
        <button key={o.k} disabled={!!busy || !!o.off} onClick={() => run(o.k)} title={title(o)} className={cx("flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5", (o.off || (o.ai && !signedIn)) && "opacity-50")} style={on(o.k)}>
          {busy === o.k ? <Loader2 size={14} className="animate-spin text-muted" /> : <Glyph name={o.glyph} size={14} color="var(--muted)" />}{o.label}
        </button>
      ))}
      <span className="mx-1 h-[18px] w-px bg-line" /><span className="whitespace-nowrap pe-1.5 text-[11.5px] text-muted">{busy ? t("Working…") : t("Esc · fades in {s} s", { s: 12 })}</span>
    </div>
  );
}
