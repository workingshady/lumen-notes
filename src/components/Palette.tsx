import { CornerDownLeft, FileText, Hash, Search, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNote, dailyNote } from "../lib/actions";
import { matcher, parseQuery, search } from "../lib/search";
import { activeTheme, getSettings, setSettings } from "../lib/settings";
import { go, openNote, setUI, useUI, useVault, type Mode } from "../lib/store";
import { syncNow } from "../lib/sync";
import { cx } from "./ui";

interface Cmd { id: string; label: string; hint?: string; run: () => void | Promise<void> }

export function Palette() {
  const ui = useUI();
  const v = useVault();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
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
  useEffect(() => { if (ui.palette) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 10); } }, [ui.palette]);

  const commands: Cmd[] = useMemo(() => {
    const mode = (m: Mode, label: string): Cmd => ({ id: `mode-${m}`, label: `Mode: ${label}`, run: () => setUI({ mode: m, view: "notes" }) });
    return [
      { id: "new", label: "New note", hint: "Ctrl Alt N", run: async () => openNote((await createNote({ spaceId, folderId: ui.folderId })).id, "edit") },
      { id: "new-lesson", label: "New lesson", run: async () => openNote((await createNote({ template: "lesson", spaceId })).id, "edit") },
      { id: "new-canvas", label: "New canvas", run: async () => openNote((await createNote({ template: "canvas", spaceId })).id) },
      { id: "new-whiteboard", label: "New whiteboard", run: async () => openNote((await createNote({ template: "whiteboard", spaceId })).id) },
      { id: "new-deck", label: "New flashcard deck", run: async () => openNote((await createNote({ template: "flashcards", spaceId })).id, "edit") },
      { id: "new-slides", label: "New slide deck", run: async () => openNote((await createNote({ template: "slides", spaceId })).id, "edit") },
      { id: "new-roadmap", label: "New roadmap", run: async () => openNote((await createNote({ template: "roadmap", spaceId })).id) },
      { id: "new-space", label: "New space (project, course, area…)", run: () => setUI({ newSpace: true }) },
      { id: "daily", label: "Open today's journal", run: async () => openNote((await dailyNote(spaceId)).id, "edit") },
      { id: "home", label: "Go to Home", run: () => go("home") },
      { id: "tasks", label: "Go to Tasks", run: () => go("tasks") },
      { id: "calendar", label: "Go to Calendar", run: () => go("calendar") },
      { id: "review", label: "Review due flashcards", run: () => go("review") },
      { id: "kanban", label: "Go to Board (by status)", run: () => go("kanban") },
      { id: "table", label: "Go to Database table", run: () => go("table") },
      { id: "graph", label: "Open graph view", run: () => go("graph") },
      { id: "space", label: "Open space overview / roadmap", run: () => go("space") },
      { id: "trash", label: "Open trash", run: () => go("trash") },
      { id: "settings", label: "Settings", run: () => go("settings") },
      { id: "io", label: "Import / export…", run: () => setUI({ io: true }) },
      { id: "sync", label: "Sync now", run: () => void syncNow() },
      { id: "theme", label: "Toggle light / dark", run: () => setSettings({ theme: activeTheme().dark ? "paper" : "lamplight" }) },
      { id: "sidebar", label: "Toggle sidebar", run: () => setUI((u) => ({ sidebar: !u.sidebar })) },
      mode("edit", "Edit"), mode("split", "Split"), mode("read", "Read"), mode("focus", "Focus"), mode("slides", "Slides"), mode("review", "Review cards"),
      { id: "jd", label: `Johnny-Decimal sorting: ${getSettings().johnnyDecimal ? "on → off" : "off → on"}`, run: () => setSettings({ johnnyDecimal: !getSettings().johnnyDecimal }) },
    ];
  }, [spaceId, ui.folderId]);

  const isCmd = q.startsWith(">");
  const query = parseQuery(isCmd ? "" : q);
  const hits = useMemo(() => (isCmd ? [] : search(query, v.byId, matcher(query, v.folderMap, v.spaceMap), 30)), [q, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmdHits = useMemo(() => {
    const t = (isCmd ? q.slice(1) : q).trim().toLowerCase();
    return t ? commands.filter((c) => c.label.toLowerCase().includes(t)).slice(0, isCmd ? 30 : 5) : isCmd ? commands : commands.slice(0, 4);
  }, [q, commands, isCmd]);
  const tagHits = !isCmd && q.startsWith("#") ? v.tags.filter(([t]) => t.startsWith(q.slice(1).toLowerCase())).slice(0, 6) : [];
  const createTitle = !isCmd && query.text.trim() && !v.byTitle.has(query.text.trim().toLowerCase()) ? query.text.trim() : null;

  type Row = { key: string; icon: React.ReactNode; label: React.ReactNode; sub?: string; run: () => void | Promise<void> };
  const rows: Row[] = [
    ...hits.map((h): Row => ({ key: h.note.id, icon: <FileText size={15} />, label: h.note.title, sub: `${v.spaceMap.get(h.note.spaceId)?.icon ?? ""} ${h.snippet}`, run: () => openNote(h.note.id) })),
    ...tagHits.map(([t, c]): Row => ({ key: "t" + t, icon: <Hash size={15} />, label: `#${t}`, sub: `${c} notes`, run: () => go("notes", { tag: t, spaceId: "all", folderId: null }) })),
    ...(createTitle ? [{ key: "create", icon: <CornerDownLeft size={15} />, label: <>Create “{createTitle}”</>, run: async () => openNote((await createNote({ title: createTitle, spaceId })).id, "edit") } as Row] : []),
    ...cmdHits.map((c): Row => ({ key: c.id, icon: <Zap size={15} />, label: c.label, sub: c.hint, run: c.run })),
  ];
  const choose = (r?: Row) => { if (!r) return; setUI({ palette: false }); void r.run(); };
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!ui.palette) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-3 pt-[10vh] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setUI({ palette: false })}>
      <div className="w-full max-w-xl overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={17} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); choose(rows[sel]); }
              else if (e.key === "Escape") setUI({ palette: false });
            }}
            placeholder="Search notes…  > commands  # tags  tag: type: status: in: space:"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>
        <div ref={list} className="max-h-[55vh] overflow-y-auto p-1.5">
          {rows.map((r, i) => (
            <button key={r.key} data-i={i} onMouseMove={() => setSel(i)} onClick={() => choose(r)}
              className={cx("flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left", i === sel && "bg-surface-2")}>
              <span className="mt-0.5 text-muted">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{r.label}</span>
                {r.sub && <span className="block truncate text-[12px] text-muted">{r.sub}</span>}
              </span>
              {i === sel && <CornerDownLeft size={13} className="mt-1 text-muted" />}
            </button>
          ))}
          {!rows.length && <div className="p-6 text-center text-[13px] text-muted">Nothing found</div>}
        </div>
        <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-muted"><span>↑↓ navigate</span><span>↵ open</span><span>&gt; commands</span><span>esc close</span></div>
      </div>
    </div>
  );
}
