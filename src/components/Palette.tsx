import { Route, ArrowLeft, CornerDownLeft, FileText, Hash, LayoutDashboard, Search, Sparkles, Waypoints, X, Zap } from "lucide-react";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote, dailyNote } from "../lib/actions";
import { around, matcher, normalize, parseQuery, search } from "../lib/search";
import { activeTheme, getSettings, setSettings } from "../lib/settings";
import { go, openNote, setUI, useUI, useVault, type Mode } from "../lib/store";
import { syncNow } from "../lib/sync";
import { plainText } from "./nav-text";
import { NewPathDialog } from "./NewPathDialog";
import { NewVisualChooser } from "./NewVisualChooser";
import { cx } from "./ui";

interface Cmd { id: string; label: ReactNode; text: string; hint?: string; icon?: ReactNode; run: () => void | Promise<void> }

/** Operators shown as hints (footer on desktop, chip row on phone). */
const OPERATORS = ["tag:", "type:", "status:", "in:"];
/** Every operator that turns into a chip once it has a value and is followed by a space. */
const OP_RE = /^(tag|type|status|in|space|is):\S+$/;
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl ";
const kbd = "rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted";

/** Wraps every occurrence of the query terms in a <b> (amber by default). */
function hl(text: string, terms: string[], cls = "font-bold text-accent"): ReactNode {
  if (!terms.length || !text) return text;
  let re: RegExp;
  try { re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi"); } catch { return text; }
  return text.split(re).map((p, i) => (i % 2 ? <b key={i} className={cls}>{p}</b> : <Fragment key={i}>{p}</Fragment>));
}
/** Plain-text snippet around the first hit: no front-matter, no title line, no Markdown marks. */
function snippet(n: Note, terms: string[], fallback: string) {
  if (n.type === "canvas" || n.type === "whiteboard") return fallback;
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
    const mode = (m: Mode, label: string) => c(`mode-${m}`, `Mode: ${label}`, () => setUI({ mode: m, view: "notes" }));
    return [
      c("new", "New note", async () => openNote((await createNote({ spaceId, folderId: ui.folderId })).id, "edit"), { hint: `${MOD}Alt N` }),
      c("new-visual", "New visual…", () => setChooser(true), { hint: "canvas · whiteboard · graph", icon: <LayoutDashboard size={16} /> }),
      c("new-path", "New learning path…", () => setPathDlg(true), { hint: "combine several courses into one roadmap", icon: <Route size={16} /> }),
      c("paths", "Go to Learning paths", () => go("notes", { spaceId: "all", folderId: null, tag: null, filter: "paths" }), { icon: <Route size={16} /> }),
      c("new-lesson", "New lesson", async () => openNote((await createNote({ template: "lesson", spaceId })).id, "edit")),
      c("new-canvas", "New canvas", async () => openNote((await createNote({ template: "canvas", spaceId })).id)),
      c("new-whiteboard", "New whiteboard", async () => openNote((await createNote({ template: "whiteboard", spaceId })).id)),
      c("new-deck", "New flashcard deck", async () => openNote((await createNote({ template: "flashcards", spaceId })).id, "edit")),
      c("new-slides", "New slide deck", async () => openNote((await createNote({ template: "slides", spaceId })).id, "edit")),
      c("new-roadmap", "New roadmap", async () => openNote((await createNote({ template: "roadmap", spaceId })).id)),
      c("new-space", "New space (project, course, area…)", () => setUI({ newSpace: true })),
      c("daily", "Open today's journal", async () => openNote((await dailyNote(spaceId)).id, "edit")),
      c("home", "Go to Home", () => go("home")),
      c("tasks", "Go to Tasks", () => go("tasks")),
      c("calendar", "Go to Calendar", () => go("calendar")),
      c("review", "Review due flashcards", () => go("review")),
      c("kanban", "Go to Board (by status)", () => go("kanban")),
      c("table", "Go to Database table", () => go("table")),
      c("graph", "Open graph view", () => go("graph")),
      c("space", "Open space overview / roadmap", () => go("space")),
      c("trash", "Open trash", () => go("trash")),
      c("settings", "Settings", () => go("settings")),
      c("io", "Import / export…", () => setUI({ io: true })),
      c("sync", "Sync now", () => void syncNow()),
      c("theme", "Toggle light / dark", () => setSettings({ theme: activeTheme().dark ? "paper" : "lamplight" })),
      c("sidebar", "Toggle sidebar", () => setUI((u) => ({ sidebar: !u.sidebar }))),
      mode("edit", "Edit"), mode("split", "Split"), mode("read", "Read"), mode("focus", "Focus"), mode("slides", "Slides"), mode("review", "Review cards"),
      c("jd", `Johnny-Decimal sorting: ${getSettings().johnnyDecimal ? "on → off" : "off → on"}`, () => setSettings({ johnnyDecimal: !getSettings().johnnyDecimal })),
    ];
  }, [spaceId, ui.folderId]);

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
    return search(dQuery, v.byId, (n) => m(n) && (allScope || n.spaceId === ui.spaceId), 30);
  }, [dq, v, allScope, ui.spaceId]);

  const [selKey, setSelKey] = useState<string | null>(null);
  const target: Note | undefined = (hits.find((h) => h.note.id === selKey) ?? hits[0])?.note;
  const short = target ? shortTitle(target.title) : "";
  const aiCmd = (n: Note) => { try { sessionStorage.setItem("lumen.aiAuto", JSON.stringify({ id: n.id, action: "flashcards" })); } catch { /* ignore */ } openNote(n.id); setUI({ panel: "ai" }); };
  const graphCmd = (n: Note) => { try { sessionStorage.setItem("lumen.graphLocal", n.id); } catch { /* ignore */ } go("graph"); };
  const noteCmds: Cmd[] = target && query.text.trim() && !isCmd && !isTag ? [
    { id: "ai-cards", text: "flashcards", label: <>Generate flashcards from “{hl(short, terms)}”</>, hint: `${MOD}⇧G`, icon: <Sparkles size={16} />, run: () => aiCmd(target) },
    { id: "local-graph", text: "graph", label: <><span className="md:hidden">Open local graph</span><span className="hidden md:inline">Open local graph for “{hl(short, terms)}”</span></>, hint: `${MOD}⇧L`, icon: <Waypoints size={16} />, run: () => graphCmd(target) },
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
    return s ? `${s.icon ?? ""} ${s.name}`.trim() : "";
  };
  const scopeSpace = query.spaces.length ? v.spaces.find((s) => s.name.toLowerCase().includes(query.spaces[0])) : allScope ? null : v.spaceMap.get(ui.spaceId);
  const scope = scopeSpace ? `in ${scopeSpace.icon ?? ""} ${scopeSpace.name}`.replace(/\s+/g, " ") : "in all spaces";

  type Row = { key: string; group: string; kind: "note" | "cmd" | "tag"; icon: ReactNode; label: ReactNode; path?: string; sub?: ReactNode; hint?: string; note?: Note; run: () => void | Promise<void> };
  const noteGroup = q.trim() ? `Notes · ${hits.length}` : "Recent";
  const rows: Row[] = [
    ...hits.map((h): Row => ({ key: h.note.id, group: noteGroup, kind: "note", note: h.note, icon: <FileText size={16} />, label: hl(h.note.title, terms), path: pathOf(h.note), sub: hl(snippet(h.note, terms, h.snippet), terms, "font-semibold text-ink"), run: () => openNote(h.note.id) })),
    ...[...noteCmds, ...cmdHits].map((c): Row => ({ key: c.id, group: q.trim() ? "Commands" : "Suggested", kind: "cmd", icon: c.icon ?? <Zap size={16} />, label: typeof c.label === "string" ? hl(c.label, terms) : c.label, hint: c.hint, run: c.run })),
    ...tagHits.map(([t, c]): Row => ({ key: "t" + t, group: "Tags", kind: "tag", icon: <Hash size={16} />, label: hl(t, [tagTerm], "font-bold text-accent"), hint: `${c} notes`, run: () => go("notes", { tag: t, spaceId: "all", folderId: null }) })),
    ...(createTitle ? [{ key: "create", group: "Create", kind: "cmd", icon: <CornerDownLeft size={16} />, label: <>Create note “{createTitle}”</>, run: async () => openNote((await createNote({ title: createTitle, spaceId })).id, "edit") } as Row] : []),
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
      {ui.palette && (
        <div className="fixed inset-0 z-50 flex items-start justify-center md:bg-[rgba(5,6,8,.6)] md:pt-[110px] fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="safe-t flex h-full w-full flex-col overflow-hidden bg-bg text-[14px] md:h-auto md:max-w-[660px] md:rounded-[14px] md:border md:border-line md:bg-surface-2 md:text-[13px] md:shadow-[0_24px_64px_rgba(0,0,0,.5)]">
            {/* Search field: phone = back arrow + bordered field, desktop = 56px header with chips inline */}
            <div className="flex items-center gap-1.5 px-3 py-2 md:h-14 md:gap-2.5 md:border-b md:border-line md:px-4 md:py-0">
              <button aria-label="Close" onClick={close} className="flex size-11 shrink-0 items-center justify-center md:hidden"><ArrowLeft size={20} /></button>
              <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-accent bg-surface px-3 md:h-full md:gap-2.5 md:rounded-none md:border-0 md:bg-transparent md:px-0" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.current?.focus(); } }}>
                <Search size={18} className="hidden shrink-0 text-muted md:block" />
                {parts.map((p, i) => isChip(p) ? (
                  <button key={i} onClick={() => editPart(i)} title="Edit" className="hidden shrink-0 rounded-[6px] bg-[color-mix(in_srgb,var(--link)_14%,transparent)] px-2 py-0.5 font-mono text-[13px] font-medium text-link md:inline">{p}</button>
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
                    else if (mod && e.shiftKey && e.key.toLowerCase() === "g" && target) { e.preventDefault(); close(); aiCmd(target); }
                    else if (mod && e.shiftKey && e.key.toLowerCase() === "l" && target) { e.preventDefault(); close(); graphCmd(target); }
                  }}
                  placeholder={parts.length ? "" : "Search notes, > commands, # tags"}
                  className="h-full min-w-[40px] flex-1 bg-transparent text-[16px] caret-[var(--accent)] !outline-none placeholder:text-muted"
                />
                {(q) && <button aria-label="Clear" onClick={() => { setQ(""); input.current?.focus(); }} className="text-muted hover:text-ink md:hidden"><X size={16} /></button>}
                <button onClick={() => setWide((w) => !w)} title={`Scope (${MOD}0 widens)`} className="hidden shrink-0 text-[12px] text-muted hover:text-ink md:inline">{scope}</button>
                <span className={cx(kbd, "hidden md:inline")}>Esc</span>
              </div>
            </div>
            {/* Phone: operator chips; a set operator shows its value highlighted */}
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-1 md:hidden">
              {OPERATORS.map((op) => {
                const i = parts.findIndex((p) => p.startsWith(op));
                return i >= 0
                  ? <button key={op} onClick={() => editPart(i)} className="flex h-[34px] shrink-0 items-center rounded-full bg-[color-mix(in_srgb,var(--link)_14%,transparent)] px-3 font-mono text-[13px] font-medium text-link">{parts[i]}</button>
                  : <button key={op} onClick={() => addOp(op)} className="flex h-[34px] shrink-0 items-center rounded-full border border-line px-3 font-mono text-[13px] font-medium text-muted">{op}</button>;
              })}
            </div>
            <div ref={list} className="min-h-0 flex-1 overflow-y-auto md:max-h-[55vh] md:flex-none md:p-1.5">
              {rows.map((r, i) => {
                const on = i === sel;
                const head = (i === 0 || rows[i - 1].group !== r.group) && (
                  <div className={cx("pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted md:px-2.5", i === 0 ? "px-5 pt-2 md:pt-2" : "px-5 pt-4 md:pt-2.5")}>{r.group}</div>
                );
                if (r.kind === "note") return (
                  <Fragment key={r.key}>
                    {head}
                    <button data-i={i} onMouseMove={() => setSel(i)} onClick={(e) => choose(r, e.ctrlKey || e.metaKey)}
                      className={cx("flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left md:rounded-[8px] md:border-0 md:px-2.5 md:py-[9px]", on && "md:bg-surface")}>
                      <span className={cx("hidden shrink-0 md:block", on ? "text-accent" : "text-muted")}>{r.icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1 md:gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <span dir="auto" className="truncate text-[15px] font-semibold md:text-[14px] md:font-medium">{r.label}</span>
                          {r.path && <span className="hidden shrink-0 truncate text-[12px] text-muted md:inline">{r.path}</span>}
                        </span>
                        <span dir="auto" className="line-clamp-2 text-[13px] leading-[19px] text-muted md:line-clamp-none md:truncate md:text-[12.5px] md:leading-normal">{r.sub}</span>
                        {r.path && <span className="text-[12px] text-muted md:hidden">{r.path}</span>}
                      </span>
                      <span className={cx("hidden font-mono text-[11px] font-medium text-muted", on && "md:inline")}>↵</span>
                    </button>
                  </Fragment>
                );
                return (
                  <Fragment key={r.key}>
                    {head}
                    <button data-i={i} onMouseMove={() => setSel(i)} onClick={() => choose(r)}
                      className={cx("flex h-[52px] w-full items-center gap-3.5 px-5 text-left md:h-[38px] md:gap-3 md:rounded-[8px] md:px-2.5", on && "md:bg-surface")}>
                      <span className="shrink-0 text-muted [&>svg]:size-[18px] md:[&>svg]:size-4">{r.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.hint && <span className={cx("shrink-0 text-muted", r.kind === "tag" ? "text-[12px]" : "hidden font-mono text-[11px] font-medium md:inline")}>{r.hint}</span>}
                    </button>
                  </Fragment>
                );
              })}
              {!rows.length && <div className="p-6 text-center text-[13px] text-muted">Nothing found</div>}
            </div>
            <div className="hidden items-center gap-1.5 border-t border-line px-4 py-2.5 text-[12px] text-muted md:flex">
              {OPERATORS.map((op) => <button key={op} onClick={() => addOp(op)} className="rounded-[4px] bg-bg px-1.5 py-px font-mono text-[11.5px] hover:text-ink">{op}</button>)}
              <span className="flex-1" />
              <span>↑↓ move</span><span className="opacity-40">·</span><span>↵ open</span><span className="opacity-40">·</span><span>{MAC ? "⌘" : "Ctrl+"}↵ open in split</span><span className="opacity-40">·</span><span>&gt; commands only</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
