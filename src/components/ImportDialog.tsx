// One Import dialog for Anki, Notion, Obsidian and Markdown (design spec docs/design/CLAUDE_DESIGN_UPDATE_05.md §4,
// docs/IMPORT.md). Steps: source → pick (drop zone) → reading → preview (tree, counts, mapping, conflicts, warnings,
// target) → importing → result (Open, Undo import). Phone: the same steps as a full-screen sheet.
// Lazy-loaded by NewMenuHost (openImport() in NewMenu.tsx); the parsers and the Anki decoders load on demand.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import type { AnkiCollection, FieldMap } from "../lib/import-anki";
import { dexieStore, readSource, type ParsedSource } from "../lib/import-db";
import { planTree, type ImportPlan, type ImportSourceKind, type TreeNode } from "../lib/import-model";
import { findConflicts, planCounts, undoImport, writePlan, type ConflictAction, type ImportRecord } from "../lib/import-write";
import { getSettings } from "../lib/settings";
import { openNote, toast, useUI, useVault } from "../lib/store";
import { Modal, usePhone } from "../views/spaces-util";
import { Glyph } from "./Glyph";
import { cx } from "./ui";

/** User-visible strings (one object, for i18n). */
export const IMPORT_TEXT = {
  title: "Import",
  close: "Close",
  back: "Back",
  cancel: "Cancel",
  done: "Done",
  chooseSource: "Bring in notes, decks and databases. Everything is imported as one batch you can undo.",
  sources: {
    anki: { name: "Anki deck", hint: ".apkg · .colpkg", desc: "Decks become flashcard notes; review history becomes your FSRS schedule." },
    notion: { name: "Notion export", hint: ".zip · Markdown & CSV", desc: "Pages keep their tree; databases become bases; links become [[links]]." },
    obsidian: { name: "Obsidian vault", hint: "folder or .zip", desc: "Notes, folders, attachments, [[links]], tags, front matter, canvases." },
    markdown: { name: "Markdown files", hint: ".md files or a folder", desc: "Plain Markdown with front matter; folders are kept." },
  } as Record<ImportSourceKind, { name: string; hint: string; desc: string }>,
  drop: "Drop here or",
  browseFile: "choose a file",
  browseFiles: "choose files",
  chooseFolder: "Choose folder",
  chooseFile: "Choose file",
  chooseFiles: "Choose files",
  dropHintFolder: "You can also drop the vault folder.",
  reading: "Reading",
  preparing: "Preparing preview…",
  notes: "notes", attachments: "attachments", cards: "cards", schedules: "schedules", reviews: "reviews", bases: "bases", decks: "decks", folders: "folders",
  contents: "Contents",
  noteCount: (n: number) => `${n.toLocaleString("en-US")} note${n === 1 ? "" : "s"}`,
  cardCount: (n: number) => `${n.toLocaleString("en-US")} card${n === 1 ? "" : "s"}`,
  selectAll: "All", selectNone: "None",
  noteTypes: "Note types",
  noteTypeKind: { basic: "Basic", cloze: "Cloze", occlusion: "Image occlusion" } as Record<string, string>,
  front: "Front", backField: "Back", reverse: "Reverse cards", none: "(none)",
  keepHistory: "Keep review history",
  keepHistoryHint: (n: number) => `${n.toLocaleString("en-US")} reviews become your review log; stability, difficulty and due dates carry over.`,
  freshStart: "All cards start as new.",
  databases: "Databases → bases",
  rows: (n: number) => `${n} row${n === 1 ? "" : "s"}`,
  conflicts: (n: number) => `${n} title${n === 1 ? "" : "s"} already exist${n === 1 ? "s" : ""} in this space`,
  conflictAll: "For all",
  actions: { skip: "Skip", rename: "Rename", merge: "Merge" } as Record<ConflictAction, string>,
  actionHint: { skip: "Keep the existing note; don't import this one.", rename: "Import as “Title 2”; links follow.", merge: "Append the imported text to the existing note (undo restores it)." } as Record<ConflictAction, string>,
  warnings: (n: number) => `${n} warning${n === 1 ? "" : "s"}`,
  target: "Import into",
  space: "Space",
  folder: "Folder",
  topLevel: "Top level",
  newFolder: "In a new folder",
  importN: (n: number) => `Import ${n.toLocaleString("en-US")} note${n === 1 ? "" : "s"}`,
  importing: "Importing",
  result: (r: ImportRecord) => `Imported ${r.counts.notes.toLocaleString("en-US")} note${r.counts.notes === 1 ? "" : "s"}`,
  merged: "merged", skipped: "skipped", renamed: "renamed",
  open: "Open",
  undo: "Undo import",
  undoing: "Undoing…",
  undone: (n: number) => `Import undone · ${n.toLocaleString("en-US")} records removed`,
  recent: "Recent imports",
  failed: "Couldn't import",
  tryAgain: "Choose another file",
  cancelled: "Import stopped. What was written so far is one batch: undo it below.",
};
const T = IMPORT_TEXT;

const SOURCE_GLYPH: Record<ImportSourceKind, string> = { anki: "flashcards", notion: "database", obsidian: "wikilink", markdown: "note" };
const ACCEPT: Record<ImportSourceKind, string> = { anki: ".apkg,.colpkg", notion: ".zip", obsidian: ".zip,.md,.canvas,.base", markdown: ".md,.markdown,.txt,.zip" };
const SOURCES: ImportSourceKind[] = ["anki", "notion", "obsidian", "markdown"];

type Step = "source" | "pick" | "reading" | "preview" | "importing" | "result" | "error";
type Prog = { done: number; total: number; current: string };

const btn = "flex h-9 items-center justify-center gap-2 rounded-[10px] px-3.5 text-[13px] disabled:opacity-50";
const btnPrimary = cx(btn, "bg-accent font-semibold text-accent-fg hover:brightness-110");
const btnOutline = cx(btn, "border border-line hover:bg-surface-2");
const btnGhost = cx(btn, "text-muted hover:bg-surface-2 hover:text-ink");
const field = "h-8 min-w-0 rounded-[6px] border border-line bg-bg px-2 text-[12.5px] focus:border-accent focus:outline-none";
const section = "flex flex-col gap-2";
const label = "text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted";

/** Files dropped from the OS, including whole folders (webkitGetAsEntry). */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  type Entry = { isFile: boolean; isDirectory: boolean; fullPath: string; file?(cb: (f: File) => void, err: (e: unknown) => void): void; createReader?(): { readEntries(cb: (e: Entry[]) => void, err: (e: unknown) => void): void } };
  const entries = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.()).filter(Boolean) as Entry[];
  if (!entries.length || entries.every((e) => e.isFile)) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: Entry): Promise<void> => {
    if (e.isFile && e.file) {
      const f = await new Promise<File>((res, rej) => e.file!(res, rej));
      Object.defineProperty(f, "webkitRelativePath", { value: e.fullPath.replace(/^\//, "") });
      out.push(f);
    } else if (e.isDirectory && e.createReader) {
      const r = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((res, rej) => r.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export default function ImportDialog({ open, initial, onClose }: { open: boolean; initial?: ImportSourceKind | null; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const phone = usePhone();
  const [step, setStep] = useState<Step>(initial ? "pick" : "source");
  const [kind, setKind] = useState<ImportSourceKind>(initial ?? "anki");
  const [prog, setProg] = useState<Prog>({ done: 0, total: 0, current: "" });
  const [parsed, setParsed] = useState<ParsedSource | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keepHistory, setKeepHistory] = useState(true);
  const [mapping, setMapping] = useState<Record<string, FieldMap>>({});
  const [spaceId, setSpaceId] = useState(ui.spaceId === "all" ? "inbox" : ui.spaceId);
  const [folderId, setFolderId] = useState<string | null>(ui.spaceId === "all" ? null : ui.folderId);
  const [useRoot, setUseRoot] = useState(true);
  const [rootName, setRootName] = useState("");
  const [conflictAll, setConflictAll] = useState<ConflictAction>("rename");
  const [conflictOne, setConflictOne] = useState<Record<string, ConflictAction>>({});
  const [result, setResult] = useState<ImportRecord | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState<ImportRecord[]>([]);
  const [undoing, setUndoing] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const dirIn = useRef<HTMLInputElement>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => { if (open) void dexieStore.registry().then(setRecent); }, [open, result]);
  useEffect(() => { if (open && initial) { setKind(initial); setStep("pick"); } }, [open, initial]);
  useEffect(() => { dirIn.current?.setAttribute("webkitdirectory", ""); dirIn.current?.setAttribute("directory", ""); });

  const reset = () => { setStep("source"); setParsed(null); setPlan(null); setResult(null); setError(""); setConflictOne({}); };
  const close = () => { if (step === "importing") return; reset(); onClose(); };

  // build the plan (Anki rebuilds when the mapping / history toggle changes)
  const buildPlan = async (p: ParsedSource, opts?: { keep?: boolean; map?: Record<string, FieldMap> }) => {
    const onP = (done: number, total: number, current: string) => setProg({ done, total, current });
    if (p.kind === "anki") {
      const { ankiPlan } = await import("../lib/import-anki");
      return ankiPlan(p.col, { keepHistory: opts?.keep ?? keepHistory, mapping: opts?.map ?? mapping, w: getSettings().fsrsWeights ?? undefined }, onP);
    }
    if (p.kind === "notion") return (await import("../lib/import-notion")).notionPlan(p.files, p.name, onP);
    return (await import("../lib/import-obsidian")).obsidianPlan(p.files, p.name, onP, p.kind);
  };
  async function read(files: File[]) {
    if (!files.length) return;
    setStep("reading"); setError(""); setProg({ done: 0, total: 0, current: files[0].name });
    try {
      const p = await readSource(kind, files, (done, total, current) => setProg({ done, total, current }));
      let map = mapping;
      if (p.kind === "anki") { const { defaultMapping } = await import("../lib/import-anki"); map = defaultMapping(p.col); setMapping(map); }
      setProg({ done: 0, total: 0, current: T.preparing });
      const pl = await buildPlan(p, { map });
      setParsed(p); setPlan(pl); setSelected(new Set(pl.notes.map((n) => n.key)));
      setRootName(kind === "anki" ? "Anki" : pl.name);
      setUseRoot(kind !== "markdown");
      setStep("preview");
    } catch (e) { setError((e as Error).message || String(e)); setStep("error"); }
  }
  async function rebuild(opts: { keep?: boolean; map?: Record<string, FieldMap> }) {
    if (!parsed) return;
    const pl = await buildPlan(parsed, opts);
    setPlan(pl);
    setSelected((s) => new Set(pl.notes.map((n) => n.key).filter((k) => s.has(k) || !plan?.notes.some((x) => x.key === k))));
  }

  const spaceFolders = useMemo(() => {
    const fs = v.folders.filter((f) => f.spaceId === spaceId);
    const out: { id: string; path: string }[] = [];
    const walk = (parent: string | null, prefix: string) => {
      for (const f of fs.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ id: f.id, path: prefix + f.name }); walk(f.id, prefix + f.name + " / "); }
    };
    walk(null, "");
    return out;
  }, [v.folders, spaceId]);
  const existing = useMemo(() => v.notes.filter((n) => n.spaceId === spaceId) as Note[], [v.notes, spaceId]);
  const conflicts = useMemo(() => (plan ? findConflicts(plan, existing, selected) : []), [plan, existing, selected]);
  const counts = useMemo(() => (plan ? planCounts(plan, selected) : null), [plan, selected]);
  const tree = useMemo(() => (plan ? planTree(plan) : null), [plan]);

  async function run() {
    if (!plan) return;
    const c = new AbortController();
    ctl.current = c;
    setStep("importing"); setProg({ done: 0, total: 0, current: "" });
    try {
      const r = await writePlan(plan, {
        spaceId, folderId, rootFolder: useRoot ? rootName : "", selected, conflict: conflictAll, conflicts: conflictOne, signal: c.signal,
        onProgress: (done, total, current) => setProg({ done, total, current }),
      }, dexieStore);
      setResult(r); setStep("result");
      if (c.signal.aborted) toast(T.cancelled);
    } catch (e) { setError((e as Error).message || String(e)); setStep("error"); }
  }
  async function undo(id: string) {
    setUndoing(true);
    try {
      const n = await undoImport(id, dexieStore);
      toast(T.undone(n));
      setRecent(await dexieStore.registry());
      if (result?.id === id) { reset(); }
    } finally { setUndoing(false); }
  }

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const progress = (title: string) => (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Glyph name={SOURCE_GLYPH[kind]} size={18} color="var(--muted)" />
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        {prog.total > 0 && <span className="shrink-0 font-mono text-[12px]">{prog.done.toLocaleString("en-US")} / {prog.total.toLocaleString("en-US")}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-[var(--border)]"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${prog.total ? pct : 100}%`, opacity: prog.total ? 1 : 0.45 }} /></div>
      {prog.current && <span className="truncate font-mono text-[12px] text-muted">{prog.current}</span>}
    </div>
  );

  // ------------------------------------------------------------------ steps
  const sourceStep = (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">{T.chooseSource}</p>
      <div className="grid gap-2.5 md:grid-cols-2">
        {SOURCES.map((k) => (
          <button key={k} data-source={k} onClick={() => { setKind(k); setStep("pick"); }}
            className="flex min-h-[76px] items-start gap-3 rounded-[12px] border border-line p-3.5 text-start hover:border-muted hover:bg-surface-2">
            <Glyph name={SOURCE_GLYPH[k]} size={20} color="var(--accent)" tile="var(--accent)" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-2"><span className="font-semibold">{T.sources[k].name}</span><span className="font-mono text-[11px] text-muted">{T.sources[k].hint}</span></span>
              <span className="text-[12px] leading-snug text-muted">{T.sources[k].desc}</span>
            </span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className={cx(section, "mt-1")}>
          <span className={label}>{T.recent}</span>
          {recent.slice(0, 4).map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 rounded-[8px] border border-line px-3 py-2 text-[12.5px]">
              <Glyph name={SOURCE_GLYPH[r.source]} size={15} color="var(--muted)" />
              <span className="min-w-0 flex-1 truncate">{r.name} · {T.noteCount(r.counts.notes)} · {new Date(r.at).toLocaleDateString()}</span>
              {r.undone ? <span className="text-muted">—</span> : <button disabled={undoing} className="text-link hover:underline disabled:opacity-50" onClick={() => void undo(r.id)}>{T.undo}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const folderPick = kind === "obsidian" || kind === "markdown";
  const pickStep = (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void droppedFiles(e.dataTransfer).then(read); }}
        className={cx("flex min-h-[170px] flex-col items-center justify-center gap-2.5 rounded-[12px] border-[1.5px] border-dashed px-4 text-center text-muted", over ? "border-accent bg-accent/10" : "border-line")}
      >
        <Glyph name={SOURCE_GLYPH[kind]} size={26} color={over ? "var(--accent)" : "var(--muted)"} />
        <span className="font-medium text-ink">{T.sources[kind].name}</span>
        <span className="text-[12.5px]">{T.drop} <button className="text-link hover:underline" onClick={() => fileIn.current?.click()}>{kind === "markdown" ? T.browseFiles : T.browseFile}</button> · <span className="font-mono text-[11.5px]">{T.sources[kind].hint}</span></span>
        {folderPick && <button className={btnOutline} onClick={() => dirIn.current?.click()}><Glyph name="folder" size={15} />{T.chooseFolder}</button>}
      </div>
      <p className="text-[12px] text-muted">{T.sources[kind].desc}{folderPick ? ` ${T.dropHintFolder}` : ""}</p>
    </div>
  );

  const preview = plan && counts && tree && (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Glyph name={SOURCE_GLYPH[plan.source]} size={20} color="var(--accent)" tile="var(--accent)" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{plan.name}</span>
          <span className="text-[12px] text-muted">{T.sources[plan.source].name}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="import-counts">
        <Chip n={counts.notes} l={T.notes} />
        {counts.attachments > 0 && <Chip n={counts.attachments} l={T.attachments} />}
        {plan.source === "anki" && <Chip n={counts.cards} l={T.cards} />}
        {counts.schedules > 0 && <Chip n={counts.schedules} l={T.schedules} />}
        {counts.reviews > 0 && <Chip n={counts.reviews} l={T.reviews} />}
        {counts.bases > 0 && <Chip n={counts.bases} l={T.bases} />}
      </div>

      {parsed?.kind === "anki" && <AnkiOptions col={parsed.col} mapping={mapping} keep={keepHistory}
        onMap={(m) => { setMapping(m); void rebuild({ map: m }); }} onKeep={(k) => { setKeepHistory(k); void rebuild({ keep: k }); }} />}

      <div className={section}>
        <div className="flex items-center gap-2">
          <span className={cx(label, "flex-1")}>{T.contents}</span>
          <button className="text-[12px] text-link hover:underline" onClick={() => setSelected(new Set(plan.notes.map((n) => n.key)))}>{T.selectAll}</button>
          <button className="text-[12px] text-link hover:underline" onClick={() => setSelected(new Set())}>{T.selectNone}</button>
        </div>
        <div className="max-h-[260px] overflow-y-auto rounded-[10px] border border-line py-1 max-md:max-h-[40dvh]" role="tree">
          {tree.children.map((c) => <TreeRow key={c.id} node={c} depth={0} selected={selected} setSelected={setSelected} />)}
        </div>
      </div>

      {plan.source === "notion" && plan.notes.some((n) => n.type === "base") && (
        <div className={section}>
          <span className={label}>{T.databases}</span>
          {plan.notes.filter((n) => n.type === "base").map((n) => (
            <div key={n.key} className="flex items-center gap-2 text-[12.5px]"><Glyph name="base" size={15} color="var(--accent)" /><span className="min-w-0 flex-1 truncate">{n.title}</span><span className="text-muted">{T.rows(n.cards ?? 0)}</span></div>
          ))}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className={section} data-testid="import-conflicts">
          <span className={label}>{T.conflicts(conflicts.length)}</span>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-muted">{T.conflictAll}</span>
            <Segmented value={conflictAll} onChange={(a) => { setConflictAll(a); setConflictOne({}); }} />
          </div>
          <span className="text-[11.5px] text-muted">{T.actionHint[conflictAll]}</span>
          <div className="flex max-h-[150px] flex-col gap-1 overflow-y-auto">
            {conflicts.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-[12.5px]">
                <Glyph name="merge" size={14} color="var(--muted)" />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <select aria-label={c.title} className={field} value={conflictOne[c.key] ?? conflictAll} onChange={(e) => setConflictOne((m) => ({ ...m, [c.key]: e.target.value as ConflictAction }))}>
                  {(["skip", "rename", "merge"] as const).map((a) => <option key={a} value={a}>{T.actions[a]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <details className="rounded-[10px] border border-line px-3 py-2 text-[12.5px]" data-testid="import-warnings">
          <summary className="flex cursor-pointer items-center gap-2"><Glyph name="c-warning" size={15} color="var(--warning, #d9a441)" />{T.warnings(plan.warnings.length)}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-muted">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}

      <div className={section}>
        <span className={label}>{T.target}</span>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[12.5px]">
          <span className="text-muted">{T.space}</span>
          <select className={field} value={spaceId} onChange={(e) => { setSpaceId(e.target.value); setFolderId(null); }}>{v.spaces.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <span className="text-muted">{T.folder}</span>
          <select className={field} value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)}>
            <option value="">{T.topLevel}</option>
            {spaceFolders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
          </select>
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={useRoot} onChange={(e) => setUseRoot(e.target.checked)} className="accent-[var(--accent)]" />{T.newFolder}</label>
          <input className={field} disabled={!useRoot} value={rootName} onChange={(e) => setRootName(e.target.value)} aria-label={T.newFolder} />
        </div>
      </div>
    </div>
  );

  const resultStep = result && (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5 rounded-[10px] p-3.5" style={{ background: "color-mix(in srgb, var(--success) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--success) 28%, transparent)" }}>
        <div className="flex items-center gap-2"><Glyph name="check" size={16} color="var(--success)" /><span className="font-semibold">{T.result(result)}</span></div>
        <div className="flex flex-wrap gap-1.5" data-testid="import-result">
          <Chip n={result.counts.notes} l={T.notes} />
          {result.counts.folders > 0 && <Chip n={result.counts.folders} l={T.folders} />}
          {result.counts.attachments > 0 && <Chip n={result.counts.attachments} l={T.attachments} />}
          {result.counts.cards > 0 && <Chip n={result.counts.cards} l={T.schedules} />}
          {result.counts.reviews > 0 && <Chip n={result.counts.reviews} l={T.reviews} />}
          {result.counts.merged > 0 && <Chip n={result.counts.merged} l={T.merged} />}
          {result.counts.renamed > 0 && <Chip n={result.counts.renamed} l={T.renamed} />}
          {result.counts.skipped > 0 && <Chip n={result.counts.skipped} l={T.skipped} />}
        </div>
      </div>
    </div>
  );

  const errorStep = (
    <div className="flex flex-col gap-3 rounded-[10px] p-3.5" role="alert" style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 26%, transparent)" }}>
      <div className="flex items-center gap-2"><Glyph name="c-danger" size={16} color="var(--danger)" /><span className="font-semibold">{T.failed}</span></div>
      <span className="text-[12.5px]">{error}</span>
    </div>
  );

  const footer: ReactNode = (() => {
    switch (step) {
      case "source": return <button className={btnPrimary} onClick={close}>{T.done}</button>;
      case "pick": return <><button className={btnGhost} onClick={() => setStep("source")}>{T.back}</button><button className={btnOutline} onClick={() => fileIn.current?.click()}>{kind === "markdown" ? T.chooseFiles : T.chooseFile}</button></>;
      case "reading": return null;
      case "preview": return <><button className={btnGhost} onClick={() => { setPlan(null); setStep("pick"); }}>{T.back}</button>
        <button className={btnPrimary} data-testid="import-run" disabled={!selected.size || (useRoot && !rootName.trim())} onClick={() => void run()}>{T.importN(Math.max(0, selected.size - conflicts.filter((c) => (conflictOne[c.key] ?? conflictAll) === "skip").length))}</button></>;
      case "importing": return <button className={btnOutline} onClick={() => ctl.current?.abort()}>{T.cancel}</button>;
      case "result": return <>
        <button className={btnOutline} disabled={undoing} onClick={() => result && void undo(result.id)}>{undoing ? T.undoing : T.undo}</button>
        {result?.firstNoteId && <button className={btnOutline} onClick={() => { const id = result.firstNoteId!; close(); openNote(id); }}>{T.open}</button>}
        <button className={btnPrimary} onClick={close}>{T.done}</button></>;
      case "error": return <><button className={btnGhost} onClick={close}>{T.close}</button><button className={btnPrimary} onClick={() => setStep("pick")}>{T.tryAgain}</button></>;
    }
  })();

  return (
    <Modal open={open} onClose={close} width={step === "preview" ? 720 : 620} phoneHeight="100dvh" label={T.title}>
      <input ref={fileIn} type="file" hidden multiple={kind !== "anki"} accept={ACCEPT[kind]} data-testid="import-file" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void read(f); }} />
      <input ref={dirIn} type="file" hidden multiple data-testid="import-folder" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void read(f); }} />
      <div className="flex min-h-full flex-col text-[13px] max-md:text-[14px]" data-step={step}>
        <div className="sticky top-0 z-10 flex flex-col gap-0 bg-surface pb-1">
        <div className="flex items-center gap-2 px-[22px] pb-1 pt-[18px] max-md:px-4 max-md:pt-[max(14px,env(safe-area-inset-top))]">
          {phone && step !== "source" && step !== "importing" && step !== "reading" && <button aria-label={T.back} className="-ms-1 rounded-md p-1 hover:bg-surface-2" onClick={() => (step === "preview" || step === "error" ? setStep("pick") : step === "pick" ? setStep("source") : close())}><Glyph name="chevron-right" size={18} style={{ transform: "scaleX(-1)" }} /></button>}
          <span className="flex-1 text-[18px] font-[650]">{T.title}{step !== "source" ? <span className="font-normal text-muted"> · {T.sources[kind].name}</span> : null}</span>
          {step !== "importing" && <button aria-label={T.close} onClick={close} className="-m-1 rounded-md p-1 hover:bg-surface-2"><Glyph name="x" size={18} /></button>}
        </div>
        <StepDots step={step} />
        </div>
        <div className="flex-1 px-[22px] py-4 max-md:px-4">
          {step === "source" && sourceStep}
          {step === "pick" && pickStep}
          {step === "reading" && progress(`${T.reading} ${prog.current && prog.current !== T.preparing ? "" : ""}${parsed?.name ?? ""}`.trim())}
          {step === "preview" && preview}
          {step === "importing" && progress(T.importing)}
          {step === "result" && resultStep}
          {step === "error" && errorStep}
        </div>
        {footer && <div className="safe-b sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-[22px] py-3.5 max-md:px-4">{footer}</div>}
      </div>
    </Modal>
  );
}

const STEPS: Step[][] = [["source"], ["pick", "reading", "error"], ["preview"], ["importing", "result"]];
function StepDots({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.includes(step));
  return <div className="flex gap-1 px-[22px] max-md:px-4" aria-hidden>{STEPS.map((_, i) => <span key={i} className="h-[3px] flex-1 rounded-full" style={{ background: i <= at ? "var(--accent)" : "var(--border)" }} />)}</div>;
}

function Chip({ n, l }: { n: number; l: string }) {
  return <span className="flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12px]"><b className="font-mono font-semibold">{n.toLocaleString("en-US")}</b><span className="text-muted">{l}</span></span>;
}

function Segmented({ value, onChange }: { value: ConflictAction; onChange: (a: ConflictAction) => void }) {
  return (
    <div role="radiogroup" className="grid grid-cols-3 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px]">
      {(["skip", "rename", "merge"] as const).map((a) => (
        <button key={a} role="radio" aria-checked={value === a} onClick={() => onChange(a)} className={cx("h-[26px] rounded-[6px] px-3", value === a ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{T.actions[a]}</button>
      ))}
    </div>
  );
}

function TreeRow({ node, depth, selected, setSelected }: { node: TreeNode; depth: number; selected: Set<string>; setSelected: (f: (s: Set<string>) => Set<string>) => void }) {
  const [openRow, setOpen] = useState(depth < 1);
  const keys = node.noteKeys;
  const on = keys.filter((k) => selected.has(k)).length;
  const state = on === 0 ? false : on === keys.length ? true : "mixed";
  const toggle = () => setSelected((s) => { const n = new Set(s); if (state === true) keys.forEach((k) => n.delete(k)); else keys.forEach((k) => n.add(k)); return n; });
  const glyph = node.kind === "folder" ? "folder" : node.badge === "deck" ? "flashcards" : node.badge === "database" || node.badge === "base" ? "base" : node.badge === "canvas" ? "canvas" : node.badge === "whiteboard" ? "whiteboard" : "note";
  return (
    <>
      <div role="treeitem" aria-selected={state === true} aria-expanded={node.kind === "folder" ? openRow : undefined} className="flex h-8 items-center gap-1.5 pe-3 text-[12.5px] hover:bg-surface-2" style={{ paddingInlineStart: 8 + depth * 16 }}>
        {node.kind === "folder" ? <button aria-label={node.name} onClick={() => setOpen((o) => !o)} className="text-muted"><Glyph name={openRow ? "chevron-down" : "chevron-right"} size={13} /></button> : <span className="w-[13px]" />}
        <input type="checkbox" className="accent-[var(--accent)]" checked={state === true} ref={(el) => { if (el) el.indeterminate = state === "mixed"; }} onChange={toggle} aria-label={node.name} />
        <Glyph name={glyph} size={15} color={node.kind === "folder" ? "var(--muted)" : "var(--text)"} />
        <span className="min-w-0 flex-1 truncate" dir="auto">{node.name}</span>
        {node.kind === "folder" ? <span className="font-mono text-[11px] text-muted">{keys.length}</span> : node.cards ? <span className="font-mono text-[11px] text-muted">{node.badge === "database" ? T.rows(node.cards) : T.cardCount(node.cards)}</span> : null}
      </div>
      {node.kind === "folder" && openRow && node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} selected={selected} setSelected={setSelected} />)}
    </>
  );
}

function AnkiOptions({ col, mapping, keep, onMap, onKeep }: { col: AnkiCollection; mapping: Record<string, FieldMap>; keep: boolean; onMap: (m: Record<string, FieldMap>) => void; onKeep: (k: boolean) => void }) {
  const types = [...col.types.values()].filter((t) => t.notes > 0);
  const reviews = col.revlog.filter((r) => r.ease > 0).length;
  return (
    <>
      <div className={section}>
        <span className={label}>{T.noteTypes}</span>
        <div className="flex flex-col divide-y divide-[var(--border)] rounded-[10px] border border-line" data-testid="anki-types">
          {types.map((t) => {
            const m = mapping[t.id];
            return (
              <div key={t.id} className="flex flex-col gap-2 px-3 py-2.5 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <Glyph name={t.kind === "cloze" ? "cloze" : t.kind === "occlusion" ? "occlusion" : "flashcards"} size={15} color="var(--accent)" />
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{T.noteTypeKind[t.kind]}</span>
                  <span className="font-mono text-[11px] text-muted">{T.noteCount(t.notes)}</span>
                </div>
                {t.kind === "basic" && m && (
                  <div className="flex flex-wrap items-center gap-2 ps-6">
                    <label className="flex items-center gap-1.5 text-muted">{T.front}
                      <select className={field} value={m.front} onChange={(e) => onMap({ ...mapping, [t.id]: { ...m, front: Number(e.target.value) } })}>{t.fields.map((f, i) => <option key={i} value={i}>{f}</option>)}</select></label>
                    <label className="flex items-center gap-1.5 text-muted">{T.backField}
                      <select className={field} value={m.back} onChange={(e) => onMap({ ...mapping, [t.id]: { ...m, back: Number(e.target.value) } })}><option value={-1}>{T.none}</option>{t.fields.map((f, i) => <option key={i} value={i}>{f}</option>)}</select></label>
                    <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" className="accent-[var(--accent)]" checked={m.reverse} onChange={(e) => onMap({ ...mapping, [t.id]: { ...m, reverse: e.target.checked } })} />{T.reverse}</label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <label className="flex items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px]">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={keep} onChange={(e) => onKeep(e.target.checked)} data-testid="anki-history" />
        <span className="flex flex-col gap-0.5"><span className="font-medium">{T.keepHistory}</span><span className="text-muted">{keep ? T.keepHistoryHint(reviews) : T.freshStart}</span></span>
      </label>
    </>
  );
}
