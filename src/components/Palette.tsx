import { SpaceIcon } from "./SpaceIcon";
import { MessagesSquare, Route, ArrowLeft, CornerDownLeft, FileText, Hash, LayoutDashboard, Search, Sparkles, Waypoints, X, Zap } from "lucide-react";
import { Fragment, lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote, dailyNote } from "../lib/actions";
import { around, matcher, narrowingFilters, normalize, parseQuery, search, searchCount } from "../lib/search";
import { activeTheme, getSettings, setSettings } from "../lib/settings";
import { go, openNote, setUI, toggleSidebar, useUI, useVault, type Mode } from "../lib/store";
import { syncNow } from "../lib/sync";
import { plainText } from "./nav-text";
// The Ask sheet (chat, tutor, Markdown answers) loads the first time it opens.
const AskSheet = lazy(() => import("./AskVault").then((m) => ({ default: m.AskSheet })));
import { openAsk, useAsk } from "../lib/ask";
import { NewPathDialog } from "./NewPathDialog";
import { NewVisualChooser } from "./NewVisualChooser";
import { openImport, runNew } from "./NewMenu";
import { cx } from "./ui";
import { Glyph } from "./Glyph";
import { glyphOf, openSmart, openSmartEditor, saveSmartAsBase, SmartEditorHost, useSmartFolders } from "./SmartFolders";
import { suggestName } from "../lib/smart";
import { t, tx, useLang } from "../lib/i18n";

interface Cmd { id: string; label: ReactNode; text: string; hint?: string; icon?: ReactNode; run: () => void | Promise<void> }

/** Operators shown as hints (footer on desktop, chip row on phone). */
const OPERATORS = ["tag:", "type:", "status:", "in:"];
/** Every operator that turns into a chip once it has a value and is followed by a space. */
const OP_RE = /^(tag|type|status|in|space|is):\S+$/;
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl ";
const kbd = "rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted";
/** Note results listed at once; above this the palette says "Showing 50 of N" and suggests narrowing filters (Lumen 22). */
const SHOW_HITS = 50;

/** Wraps every occurrence of the query terms in a <b> (amber by default). */
function hl(text: string, terms: string[], cls = "font-bold text-accent"): ReactNode {
  if (!terms.length || !text) return text;
  let re: RegExp;
  try { re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi"); } catch { return text; }
  // Arabic (R5-25I): colour only, so a weight change doesn't break the letter joins inside a word.
  if (/[؀-ۿ]/.test(text)) cls = cls.replace(/\bfont-(bold|semibold)\b/g, "font-[inherit]");
  return text.split(re).map((p, i) => (i % 2 ? <b key={i} className={cls}>{p}</b> : <Fragment key={i}>{p}</Fragment>));
}
/** Plain-text snippet around the first hit: no front-matter, no title line, no Markdown marks. */
function snippet(n: Note, terms: string[], fallback: string) {
  // boards: the hit text when searching; "Recent" (no terms) would show raw scene JSON, so name the kind instead
  if (n.type === "canvas" || n.type === "whiteboard") return terms.length ? fallback : n.type === "canvas" ? t("Canvas board") : t("Whiteboard");
  const plain = plainText(around(n.body, terms));
  if (!plain) return fallback;
  const low = normalize(plain);
  const i = terms.length ? Math.min(...terms.map((t) => low.indexOf(normalize(t))).map((x) => (x < 0 ? Infinity : x))) : 0;
  if (!Number.isFinite(i) || i < 50) return plain.slice(0, 160);
  const from = plain.lastIndexOf(" ", i - 24);
  return "…" + plain.slice(from + 1, from + 161);
}
/** "Linear algebra: eigenvectors" → "Eigenvectors" (the part a command names). */
const shortTitle = (t: string) => { const s = t.split(/:\s+/).pop()!.trim() || t; return s.charAt(0).toUpperCase() + s.slice(1); };

export function Palette() {
  const ui = useUI();
  const askOpen = useAsk().open;
  const v = useVault();
  /** Committed tokens: operator chips and the plain words typed before them. */
  const [parts, setParts] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const [wide, setWide] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [pathDlg, setPathDlg] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const smart = useSmartFolders();
  const lang = useLang().lang;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) { e.preventDefault(); setUI((u) => ({ palette: !u.palette })); }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); void createNote({ spaceId }).then((n) => openNote(n.id, "edit")); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [spaceId]);
  useEffect(() => { if (ui.palette) { setParts([]); setText(""); setSel(0); setWide(false); setTimeout(() => input.current?.focus(), 10); } }, [ui.palette]);

  const q = [...parts, text].join(" ").replace(/\s+/g, " ").trimStart();
  const setQ = (s: string) => { setParts([]); setText(s); };

  /** Typing a recognised operator (with a value, then a space) turns it into a chip. */
  const onType = (val: string) => {
    setSel(0);
    const m = /^(.*?)(\S+)\s$/.exec(val);
    if (m && OP_RE.test(m[2]) && !q.startsWith(">")) {
      const before = m[1].trim();
      setParts((p) => [...p, ...(before ? [before] : []), m[2]]);
      setText("");
      return;
    }
    setText(val);
  };

  const commands: Cmd[] = useMemo(() => {
    const c = (id: string, label: string, run: Cmd["run"], extra: Partial<Cmd> = {}): Cmd => ({ id, label, text: label, run, ...extra });
    const mode = (m: Mode, label: string) => c(`mode-${m}`, t("Mode: {mode}", { mode: label }), () => setUI({ mode: m, view: "notes" }));
    return [
      c("ask", t("Ask your notes…"), () => openAsk(), { hint: t("answers from your notes, with sources"), icon: <MessagesSquare size={16} /> }),
      c("new", t("New note"), async () => openNote((await createNote({ spaceId, folderId: ui.folderId })).id, "edit"), { hint: `${MOD}Alt N` }),
      c("new-visual", t("New visual…"), () => setChooser(true), { hint: t("canvas · whiteboard · graph"), icon: <LayoutDashboard size={16} /> }),
      c("new-path", t("New learning path…"), () => setPathDlg(true), { hint: t("combine several courses into one roadmap"), icon: <Route size={16} /> }),
      c("new-dashboard", t("New dashboard"), () => runNew("dashboard"), { hint: t("charts over sessions, cards and paths"), icon: <Glyph name="dashboard" size={16} /> }),
      c("new-base", t("New base"), () => runNew("base"), { hint: t("table, board, gallery, calendar of notes"), icon: <Glyph name="base" size={16} /> }),
      c("new-pdf", t("New PDF note"), () => runNew("pdf"), { hint: t("pick a PDF to read and highlight"), icon: <Glyph name="pdf" size={16} /> }),
      c("new-smart", t("New smart folder"), () => openSmartEditor({ query: "" }), { hint: t("a saved search with a live count"), icon: <Glyph name="smart-folder" size={16} /> }),
      c("today", t("Open Today"), () => go("today"), { hint: t("today's study plan"), icon: <Glyph name="date" size={16} /> }),
      c("paths", t("Go to Learning paths"), () => go("notes", { spaceId: "all", folderId: null, tag: null, filter: "paths" }), { icon: <Route size={16} /> }),
      c("new-lesson", t("New lesson"), async () => openNote((await createNote({ template: "lesson", spaceId })).id, "edit")),
      c("new-canvas", t("New canvas"), async () => openNote((await createNote({ template: "canvas", spaceId })).id)),
      c("new-whiteboard", t("New whiteboard"), async () => openNote((await createNote({ template: "whiteboard", spaceId })).id)),
      c("new-deck", t("New flashcard deck"), async () => openNote((await createNote({ template: "flashcards", spaceId })).id, "edit")),
      c("new-slides", t("New slide deck"), async () => openNote((await createNote({ template: "slides", spaceId })).id, "edit")),
      c("new-roadmap", t("New roadmap"), async () => openNote((await createNote({ template: "roadmap", spaceId })).id)),
      c("new-space", t("New space (project, course, area…)"), () => setUI({ newSpace: true })),
      c("daily", t("Open today's journal"), async () => openNote((await dailyNote(spaceId)).id, "edit")),
      c("home", t("Go to Home"), () => go("home")),
      c("tasks", t("Go to Tasks"), () => go("tasks")),
      c("calendar", t("Go to Calendar"), () => go("calendar")),
      c("review", t("Review due flashcards"), () => go("review")),
      c("kanban", t("Go to Board (by status)"), () => go("kanban")),
      c("table", t("Go to Database table"), () => go("table")),
      c("graph", t("Open graph view"), () => go("graph")),
      c("folder", t("Folders: browse and search every folder"), () => go("folders")),
      c("space", t("Open space overview / roadmap"), () => go("space")),
      c("trash", t("Open trash"), () => go("trash")),
      c("settings", t("Settings"), () => go("settings")),
      c("io", t("Import / export…"), () => setUI({ io: true })),
      c("import", t("Import…"), () => openImport(), { hint: "Anki · Notion · Obsidian", icon: <Glyph name="export" size={16} /> }),
      c("sync", t("Sync now"), () => void syncNow()),
      c("theme", t("Toggle light / dark"), () => setSettings({ theme: activeTheme().dark ? "paper" : "lamplight" })),
      c("sidebar", t("Toggle sidebar"), toggleSidebar),
      mode("edit", t("Edit")), mode("split", t("Split")), mode("read", t("Read")), mode("focus", t("Focus")), mode("slides", t("Slides")), mode("review", t("Review cards")),
      ...smart.map((sf) => c(`sf-${sf.id}`, t("Smart folder: {name}", { name: sf.name }), () => openSmart(sf), { icon: glyphOf(sf, 16), hint: sf.query })),
      c("jd", getSettings().johnnyDecimal ? t("Johnny-Decimal sorting: on → off") : t("Johnny-Decimal sorting: off → on"), () => setSettings({ johnnyDecimal: !getSettings().johnnyDecimal })),
    ];
  }, [spaceId, ui.folderId, smart, lang]);

  const isCmd = q.startsWith(">");
  const isTag = q.startsWith("#") && !q.includes(" ");
  const query = parseQuery(isCmd ? "" : q);
  // Scope follows the current space; in:all (or Ctrl/⌘0) widens, space: picks another.
  const allScope = wide || query.folders.includes("all") || ui.spaceId === "all" || query.spaces.length > 0;
  query.folders = query.folders.filter((f) => f !== "all");
  const terms = (isCmd ? q.slice(1) : isTag ? q.slice(1) : query.text).trim().split(/\s+/).filter(Boolean);
  // Results follow a deferred copy of the query: typing stays instant while the (big-vault) search catches up.
  const dq = useDeferredValue(q);
  const hits = useMemo(() => {
    if (dq.startsWith(">") || (dq.startsWith("#") && !dq.includes(" "))) return [];
    const dQuery = parseQuery(dq);
    dQuery.folders = dQuery.folders.filter((f) => f !== "all");
    const m = matcher(dQuery, v.folderMap, v.spaceMap);
    return search(dQuery, v.byId, (n) => m(n) && (allScope || n.spaceId === ui.spaceId), SHOW_HITS);
  }, [dq, v, allScope, ui.spaceId]);
  // Lumen 22 "Search with too many results": "Showing 50 of 1,240 for “attention”" + the filters that cut the most.
  const many = useMemo(() => {
    if (hits.length < SHOW_HITS || !dq.trim() || dq.startsWith(">") || (dq.startsWith("#") && !dq.includes(" "))) return null;
    const dQuery = parseQuery(dq);
    dQuery.folders = dQuery.folders.filter((f) => f !== "all");
    const m = matcher(dQuery, v.folderMap, v.spaceMap);
    const all = searchCount(dQuery, v.byId, (n) => m(n) && (allScope || n.spaceId === ui.spaceId));
    if (all.length <= hits.length) return null;
    return { total: all.length, text: dQuery.text.trim(), chips: narrowingFilters(all, v.folderMap, v.spaceMap, { allSpaces: allScope }) };
  }, [hits, dq, v, allScope, ui.spaceId]);

  const [selKey, setSelKey] = useState<string | null>(null);
  const target: Note | undefined = (hits.find((h) => h.note.id === selKey) ?? hits[0])?.note;
  const short = target ? shortTitle(target.title) : "";
  const aiCmd = (n: Note) => { try { sessionStorage.setItem("lumen.aiAuto", JSON.stringify({ id: n.id, action: "flashcards" })); } catch { /* ignore */ } openNote(n.id); setUI({ panel: "ai" }); };
  const graphCmd = (n: Note) => { try { sessionStorage.setItem("lumen.graphLocal", n.id); } catch { /* ignore */ } go("graph"); };
  const askText = !isCmd && !isTag ? query.text.trim() : "";
  const askCmd = (qq: string) => { try { sessionStorage.setItem("lumen.askAuto", qq); } catch { /* ignore */ } openAsk(qq); };
  const askRow: Cmd[] = askText.split(/\s+/).length >= 2 ? [{ id: "ask-q", text: "ask", label: tx("Ask your notes: “{q}”", { q: askText }), hint: `${MOD}⇧A`, icon: <MessagesSquare size={16} />, run: () => askCmd(askText) }] : [];
  // Save the current search (operators + text, plus the space scope when not searching everywhere) as a smart folder.
  const scopeSp = !allScope ? v.spaceMap.get(ui.spaceId) : null;
  const smartQuery = [q.replace(/(^|\s)in:all(?=\s|$)/g, " ").trim(), scopeSp ? `space:${/\s/.test(scopeSp.name) ? `"${scopeSp.name.toLowerCase()}"` : scopeSp.name.toLowerCase()}` : ""].filter(Boolean).join(" ");
  const canSave = !isCmd && !!q.trim() && q.trim() !== "#";
  const saveSmart = () => openSmartEditor({ query: smartQuery });
  // 20b: "Save search as smart folder" (⌘S) + "Save as base" (a base note with the same filters).
  const saveRow: Cmd[] = canSave ? [
    { id: "save-smart", text: "save smart folder", label: t("Save search as smart folder"), hint: `${MOD}S`, icon: <Glyph name="smart-folder" size={16} color="var(--accent)" />, run: saveSmart },
    { id: "save-base", text: "save as base", label: t("Save as base"), icon: <Glyph name="base" size={16} />, run: () => void saveSmartAsBase({ name: suggestName(smartQuery), query: smartQuery }) },
  ] : [];
  const noteCmds: Cmd[] = target && query.text.trim() && !isCmd && !isTag ? [
    { id: "ai-cards", text: "flashcards", label: tx("Generate flashcards from “{title}”", { title: hl(short, terms) }), hint: `${MOD}⇧G`, icon: <Sparkles size={16} />, run: () => aiCmd(target) },
    { id: "local-graph", text: "graph", label: <><span className="md:hidden">{t("Open local graph")}</span><span className="hidden md:inline">{tx("Open local graph for “{title}”", { title: hl(short, terms) })}</span></>, hint: `${MOD}⇧L`, icon: <Waypoints size={16} />, run: () => graphCmd(target) },
  ] : [];

  const cmdHits = useMemo(() => {
    if (isTag) return [];
    const t = (isCmd ? q.slice(1) : query.text).trim().toLowerCase();
    if (!isCmd && (parts.length || hits.length) && t) return commands.filter((c) => c.text.toLowerCase().includes(t)).slice(0, 3);
    return t ? commands.filter((c) => c.text.toLowerCase().includes(t)).slice(0, isCmd ? 30 : 5) : isCmd ? commands : commands.slice(0, 4);
  }, [q, commands, isCmd, isTag]); // eslint-disable-line react-hooks/exhaustive-deps
  const tagTerm = (q.startsWith("#") ? q.slice(1) : terms.length === 1 ? terms[0] : "").toLowerCase();
  const tagHits = !isCmd && tagTerm ? v.tags.filter(([t]) => t.startsWith(tagTerm) || (!q.startsWith("#") && t.includes(tagTerm))).slice(0, q.startsWith("#") ? 8 : 3) : [];
  const createTitle = !isCmd && !isTag && query.text.trim() && !hits.length && !v.byTitle.has(query.text.trim().toLowerCase()) ? query.text.trim() : null;
  const pathOf = (n: { spaceId: string; folderId: string | null }) => {
    const f = n.folderId ? v.folderMap.get(n.folderId)?.name : null;
    if (f) return f;
    const s = v.spaceMap.get(n.spaceId);
    return s ? s.name : "";
  };
  const scopeSpace = query.spaces.length ? v.spaces.find((s) => s.name.toLowerCase().includes(query.spaces[0])) : allScope ? null : v.spaceMap.get(ui.spaceId);
  const scope: ReactNode = scopeSpace ? <span className="inline-flex items-center gap-1">{tx("in {space}", { space: <><SpaceIcon space={scopeSpace} size={15} /> <span dir="auto">{scopeSpace.name}</span></> })}</span> : t("in all spaces");

  type Row = { key: string; group: string; kind: "note" | "cmd" | "tag"; icon: ReactNode; label: ReactNode; path?: string; sub?: ReactNode; hint?: string; note?: Note; run: () => void | Promise<void> };
  const noteGroup = q.trim() ? t("Notes · {n}", { n: hits.length }) : t("Recent");
  const rows: Row[] = [
    ...hits.map((h): Row => ({ key: h.note.id, group: noteGroup, kind: "note", note: h.note, icon: <FileText size={16} />, label: hl(h.note.title, terms), path: pathOf(h.note), sub: hl(snippet(h.note, terms, h.snippet), terms, "font-semibold text-ink"), run: () => openNote(h.note.id) })),
    ...[...askRow, ...noteCmds, ...saveRow, ...cmdHits].map((c): Row => ({ key: c.id, group: q.trim() ? t("Commands") : t("Suggested"), kind: "cmd", icon: c.icon ?? <Zap size={16} />, label: typeof c.label === "string" ? hl(c.label, terms) : c.label, hint: c.hint, run: c.run })),
    ...tagHits.map(([tag, c]): Row => ({ key: "t" + tag, group: t("Tags"), kind: "tag", icon: <Hash size={16} />, label: hl(tag, [tagTerm], "font-bold text-accent"), hint: t("{n} note|{n} notes", { n: c }), run: () => go("notes", { tag, spaceId: "all", folderId: null }) })),
    ...(createTitle ? [{ key: "create", group: t("Create"), kind: "cmd", icon: <CornerDownLeft size={16} />, label: tx("Create note “{title}”", { title: <span dir="auto">{createTitle}</span> }), run: async () => openNote((await createNote({ title: createTitle, spaceId })).id, "edit") } as Row] : []),
  ];
  const cur = rows[Math.min(sel, rows.length - 1)];
  useEffect(() => { if (cur?.kind === "note") setSelKey(cur.key); }, [cur?.key, cur?.kind]);
  const choose = (r?: Row, split = false) => {
    if (!r) return;
    setUI({ palette: false });
    if (split && r.note) openNote(r.note.id, "split"); else void r.run();
  };
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const addOp = (op: string) => { setText((x) => (x && !x.endsWith(" ") ? x + " " : x) + op); setSel(0); input.current?.focus(); };
  /** Backspace on a chip (or tapping it on phone) puts it back into the field for editing. */
  const editPart = (i: number) => { setText((t) => (parts[i] + (t ? " " + t : ""))); setParts((p) => p.filter((_, j) => j !== i)); input.current?.focus(); };
  const close = () => setUI({ palette: false });
  const isChip = (p: string) => OP_RE.test(p);

  return (
    <>
      <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
      {askOpen && <Suspense fallback={null}><AskSheet /></Suspense>}
      <SmartEditorHost />
      {ui.palette && (
        <div className="fixed inset-0 z-50 flex items-start justify-center md:bg-[rgba(5,6,8,.6)] md:pt-[110px] fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="safe-t flex h-full w-full flex-col overflow-hidden bg-bg text-[14px] md:h-auto md:max-w-[660px] md:rounded-[14px] md:border md:border-line md:bg-surface-2 md:text-[13px] md:shadow-[0_24px_64px_rgba(0,0,0,.5)]">
            {/* Search field: phone = back arrow + bordered field, desktop = 56px header with chips inline */}
            <div className="flex items-center gap-1.5 px-3 py-2 md:h-14 md:gap-2.5 md:border-b md:border-line md:px-4 md:py-0">
              <button aria-label={t("Close")} onClick={close} className="flex size-11 shrink-0 items-center justify-center md:hidden"><ArrowLeft size={20} /></button>
              <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-accent bg-surface px-3 md:h-full md:gap-2.5 md:rounded-none md:border-0 md:bg-transparent md:px-0" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
                <Search size={18} className="hidden shrink-0 text-muted md:block" />
                {parts.map((p, i) => isChip(p) ? (
                  <button key={i} onClick={() => editPart(i)} title={t("Edit")} className="hidden shrink-0 rounded-[6px] bg-[color-mix(in_srgb,var(--link)_14%,transparent)] px-2 py-0.5 font-mono text-[13px] font-medium text-link md:inline">{p}</button>
                ) : (
                  <span key={i} onClick={() => editPart(i)} className="shrink-0 cursor-text text-[16px]">{p}</span>
                ))}
                <input
                  ref={input}
                  value={text}
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => {
                    const mod = e.ctrlKey || e.metaKey;
                    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                    else if (e.key === "Enter") { e.preventDefault(); choose(cur, mod); }
                    else if (e.key === "Escape") close();
                    else if (e.key === "Backspace" && parts.length && (e.currentTarget.selectionStart ?? 0) === 0 && (e.currentTarget.selectionEnd ?? 0) === 0) { e.preventDefault(); editPart(parts.length - 1); }
                    else if (mod && e.key === "0") { e.preventDefault(); setWide((w) => !w); }
                    else if (mod && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (canSave) { close(); saveSmart(); } }
                    else if (mod && e.shiftKey && e.key.toLowerCase() === "g" && target) { e.preventDefault(); close(); aiCmd(target); }
                    else if (mod && e.shiftKey && e.key.toLowerCase() === "a" && askText) { e.preventDefault(); close(); askCmd(askText); }
                    else if (mod && e.shiftKey && e.key.toLowerCase() === "l" && target) { e.preventDefault(); close(); graphCmd(target); }
                  }}
                  placeholder={parts.length ? "" : t("Search notes, > commands, # tags")}
                  className="h-full min-w-[40px] flex-1 bg-transparent text-[16px] caret-[var(--accent)] !outline-none placeholder:text-muted"
                />
                {(q) && <button aria-label={t("Clear")} onClick={() => { setQ(""); input.current?.focus(); }} className="text-muted hover:text-ink md:hidden"><X size={16} /></button>}
                <button onClick={() => setWide((w) => !w)} title={t("Scope ({key} widens)", { key: `${MOD}0` })} className="hidden shrink-0 text-[12px] text-muted hover:text-ink md:inline">{scope}</button>
                <span className={cx(kbd, "hidden md:inline")}>Esc</span>
              </div>
            </div>
            {/* Phone: operator chips; a set operator shows its value highlighted */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-1 md:hidden">
              {OPERATORS.map((op) => {
                const i = parts.findIndex((p) => p.startsWith(op));
                return i >= 0
                  ? <button key={op} dir="ltr" onClick={() => editPart(i)} className="flex h-[34px] shrink-0 items-center rounded-full bg-[color-mix(in_srgb,var(--link)_14%,transparent)] px-3 font-mono text-[13px] font-medium text-link">{parts[i]}</button>
                  : <button key={op} dir="ltr" onClick={() => addOp(op)} className="flex h-[34px] shrink-0 items-center rounded-full border border-line px-3 font-mono text-[13px] font-medium text-muted">{op}</button>;
              })}
            </div>
            <div ref={list} className="min-h-0 flex-1 overflow-y-auto md:max-h-[55vh] md:flex-none md:p-1.5">
              {many && (
                <div className="mx-0 mb-1 flex flex-wrap items-center gap-2 rounded-[8px] bg-bg px-3 py-2 md:mx-1" data-many-results>
                  <span className="flex-1 text-[13px]">{many.text ? t("Showing {shown} of {total} for “{q}”", { shown: hits.length, total: many.total, q: many.text }) : t("Showing {shown} of {total}", { shown: hits.length, total: many.total })}</span>
                  {many.chips.map((c) => <button key={c.op} onClick={() => addOp(c.op)} title={t("{n} note|{n} notes", { n: c.left })} className="flex h-[26px] items-center rounded-[6px] bg-surface px-2 text-[12.5px] hover:text-accent" dir="ltr">+ {c.op}</button>)}
                </div>
              )}
              {rows.map((r, i) => {
                const on = i === sel;
                const head = (i === 0 || rows[i - 1].group !== r.group) && (
                  <div className={cx("pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted md:px-2.5", i === 0 ? "px-5 pt-2 md:pt-2" : "px-5 pt-4 md:pt-2.5")}>{r.group}</div>
                );
                if (r.kind === "note") return (
                  <Fragment key={r.key}>
                    {head}
                    <button data-i={i} onMouseMove={() => setSel(i)} onClick={(e) => choose(r, e.ctrlKey || e.metaKey)}
                      className={cx("flex w-full items-center gap-3 border-b border-line px-5 py-3 text-start md:rounded-[8px] md:border-0 md:px-2.5 md:py-[9px]", on && "md:bg-surface")}>
                      <span className={cx("hidden shrink-0 md:block", on ? "text-accent" : "text-muted")}>{r.icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1 md:gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <span dir="auto" className="truncate text-[15px] font-semibold md:text-[14px] md:font-medium">{r.label}</span>
                          {r.path && <span dir="auto" className="hidden shrink-0 truncate text-[12px] text-muted md:inline">{r.path}</span>}
                        </span>
                        <span dir="auto" className="line-clamp-2 text-[13px] leading-[19px] text-muted md:line-clamp-none md:truncate md:text-[12.5px] md:leading-normal">{r.sub}</span>
                        {r.path && <span dir="auto" className="text-[12px] text-muted md:hidden">{r.path}</span>}
                      </span>
                      <span className={cx("hidden font-mono text-[11px] font-medium text-muted", on && "md:inline")}>↵</span>
                    </button>
                  </Fragment>
                );
                return (
                  <Fragment key={r.key}>
                    {head}
                    <button data-i={i} onMouseMove={() => setSel(i)} onClick={() => choose(r)}
                      className={cx("flex h-[52px] w-full items-center gap-3.5 px-5 text-start md:h-[38px] md:gap-3 md:rounded-[8px] md:px-2.5", on && "md:bg-surface")}>
                      <span className="shrink-0 text-muted [&>svg]:size-[18px] md:[&>svg]:size-4">{r.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.hint && <span className={cx("shrink-0 text-muted", r.kind === "tag" ? "text-[12px]" : "hidden font-mono text-[11px] font-medium md:inline")}>{r.hint}</span>}
                    </button>
                  </Fragment>
                );
              })}
              {!rows.length && <div className="p-6 text-center text-[13px] text-muted">{t("Nothing found")}</div>}
            </div>
            <div className="hidden items-center gap-1.5 border-t border-line px-4 py-2.5 text-[12px] text-muted md:flex">
              {OPERATORS.map((op) => <button key={op} dir="ltr" onClick={() => addOp(op)} className="rounded-[4px] bg-bg px-1.5 py-px font-mono text-[11.5px] hover:text-ink">{op}</button>)}
              <span className="flex-1" />
              <span><span dir="ltr">↑↓</span> {t("move")}</span><span className="opacity-40">·</span><span>↵ {t("open")}</span><span className="opacity-40">·</span><span><span dir="ltr">{MAC ? "⌘" : "Ctrl+"}↵</span> {t("open in split")}</span><span className="opacity-40">·</span><span>&gt; {t("commands only")}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
