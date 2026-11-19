// One Import dialog for Anki, Notion, Obsidian and Markdown (Claude Design round 5/6: "Lumen 26 Imports" + ImportDesk,
// docs/IMPORT.md). Steps: 1 Source (cards + drop zone that detects the source) → reading (MB progress) → 2 Preview (tree
// with checkboxes and counts, per-source panels: conflicts, Anki note types / field mapping / options, Notion databases →
// bases, warnings) → 3 Target (new space / existing space / Inbox + dated folder) → 4 Importing (counts per kind, run in
// background) → result (counts, handled titles, "Import report", Open, Undo import). Errors: wrong file (Notion HTML
// export with the exact export steps). Desktop: a 960×640 modal; phone: full-screen steps with Back in the header.
// Lazy-loaded by NewMenuHost (openImport() in NewMenu.tsx); the parsers and the Anki decoders load on demand. A running
// import lives in a module-level job, so "Run in background" can close the dialog and a toast reports the end.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { Note, Space } from "../../shared/types";
import type { ViewType } from "../lib/base";
import { fmtNum, t, tk, tx, useLang } from "../lib/i18n";
import type { AnkiCollection, FieldMap } from "../lib/import-anki";
import { dexieStore, pickName, readSource, type ParsedSource } from "../lib/import-db";
import { attKey, fmtBytes, fmtMB, ImportError, planTree, type ImportPlan, type ImportSourceKind, type TreeNode } from "../lib/import-model";
import { withBaseView } from "../lib/import-notion";
import { findConflicts, planCounts, undoImport, writePlan, type ConflictAction, type ImportRecord, type LiveCounts } from "../lib/import-write";
import { getSettings } from "../lib/settings";
import { openNote, toast, useUI, useVault } from "../lib/store";
import { usePhone } from "../views/spaces-util";
import { Glyph } from "./Glyph";
import { cx } from "./ui";
import type { GlyphName } from "../lib/glyphs";

// ------------------------------------------------------------------ constants
/** Source cards (design S table): glyph, colour, name, one-line result, accepted files. */
const SOURCES: { k: ImportSourceKind; g: GlyphName; c: string; name: string; desc: string; files: string }[] = [
  { k: "anki", g: "flashcards", c: "var(--learn)", name: tk("Anki deck"), desc: tk("Decks become flashcard notes. Review history becomes the FSRS start state. Media kept."), files: ".apkg · .colpkg" },
  { k: "notion", g: "base", c: "var(--text)", name: tk("Notion export"), desc: tk("Pages become notes, databases become bases, page links become [[links]]."), files: tk(".zip (Markdown & CSV)") },
  { k: "obsidian", g: "note", c: "#A371F7", name: tk("Obsidian vault"), desc: tk("Imported as is: folders, [[links]], tags, front matter, .canvas files."), files: tk("folder or .zip") },
  { k: "markdown", g: "text", c: "var(--muted)", name: tk("Markdown files"), desc: tk("Single files or a whole folder."), files: tk(".md · folder") },
];
const SRC = Object.fromEntries(SOURCES.map((s) => [s.k, s])) as Record<ImportSourceKind, (typeof SOURCES)[number]>;
const ACCEPT: Record<ImportSourceKind, string> = { anki: ".apkg,.colpkg", notion: ".zip", obsidian: ".zip,.md,.canvas,.base", markdown: ".md,.markdown,.txt,.zip" };
/** Folder name part per source ("Imported / Obsidian 2026-11-20"). */
const SRC_WORD: Record<ImportSourceKind, string> = { anki: "Anki", notion: "Notion", obsidian: "Obsidian", markdown: "Markdown" };
const VIEWS: { v: ViewType; label: string }[] = [
  { v: "table", label: tk("Base · Table") }, { v: "board", label: tk("Base · Board") }, { v: "cards", label: tk("Base · Gallery") },
  { v: "list", label: tk("Base · List") }, { v: "calendar", label: tk("Base · Calendar") },
];
const ACTIONS: { a: ConflictAction; label: string }[] = [{ a: "merge", label: tk("Merge") }, { a: "rename", label: tk("Rename") }, { a: "skip", label: tk("Skip") }];

type Step = "source" | "reading" | "preview" | "target" | "importing" | "result" | "error";
type Target = "new" | "existing" | "inbox";
type Role = "front" | "back" | "extra" | "skip";

/** Numbers with grouping ("1,284"), in the interface digits. */
const N = (n: number) => fmtNum(n, { useGrouping: true });

// ------------------------------------------------------------------ background job (survives closing the dialog)
interface Job {
  plan: ImportPlan; kind: ImportSourceKind; started: number;
  prog: { done: number; total: number; current: string }; live: LiveCounts | null;
  result: ImportRecord | null; error: string; ctl: AbortController; bg: boolean; target: Target;
}
let job: Job | null = null;
const jobSubs = new Set<() => void>();
const setJob = (j: Job | null) => { job = j; jobSubs.forEach((f) => f()); };
const patchJob = (p: Partial<Job>) => { if (job) setJob({ ...job, ...p }); };
const useJob = () => useSyncExternalStore((f) => (jobSubs.add(f), () => { jobSubs.delete(f); }), () => job, () => job);

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

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const glyphOfIcon = (icon?: string): GlyphName => (icon?.startsWith("glyph:") ? (icon.slice(6) as GlyphName) : "folder");

// ------------------------------------------------------------------ small pieces (design ImportDesk)
const box = "flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-line bg-bg px-2";
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="relative h-4 w-7 shrink-0 rounded-full" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-0.5 size-3 rounded-full transition-[inset-inline-start] duration-150" style={{ insetInlineStart: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </button>
  );
}
/** A native select drawn as the design's 24 px box with "▾". */
function BoxSelect<V extends string | number>({ value, options, onChange, label }: { value: V; options: { v: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <span className={cx(box, "relative gap-1.5 hover:border-muted")}>
      <span>{options.find((o) => o.v === value)?.label}</span><span className="text-[9px] text-muted">▾</span>
      <select aria-label={label} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.v) === e.target.value); if (o) onChange(o.v); }}
        className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
      </select>
    </span>
  );
}
function Panel({ g, title, warn, children, testid }: { g: GlyphName; title: ReactNode; warn?: boolean; children: ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} className="flex flex-col gap-2 rounded-[10px] border p-3"
      style={{ borderColor: warn ? "color-mix(in srgb, var(--warning) 30%, transparent)" : "var(--border)", background: warn ? "color-mix(in srgb, var(--warning) 6%, var(--bg))" : "var(--bg)" }}>
      <span className="flex items-center gap-2 font-semibold" style={{ color: warn ? "var(--warning)" : "var(--text)" }}><Glyph name={g} size={15} />{title}</span>
      {children}
    </div>
  );
}
function Row({ a, children, arrow, muted }: { a: ReactNode; children?: ReactNode; arrow?: boolean; muted?: boolean }) {
  return (
    <div className="flex min-h-6 items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1" style={{ color: muted ? "var(--muted)" : "var(--text)" }}>{a}</span>
      {arrow && <span className="inline-block text-muted rtl:-scale-x-100">→</span>}
      {children}
    </div>
  );
}
function Check({ state }: { state: boolean | "mixed" }) {
  const on = state !== false;
  return (
    <span aria-hidden className="flex size-[15px] shrink-0 items-center justify-center rounded-[4px] text-[10px] font-extrabold text-accent-fg"
      style={{ background: on ? "var(--accent)" : "transparent", border: on ? "none" : "1.5px solid var(--muted)" }}>
      {state === true ? <Glyph name="check" size={11} stroke={3} /> : state === "mixed" ? "–" : null}
    </span>
  );
}
function Tag({ c, children }: { c: string; children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-[5px] px-1.5 text-[11px] leading-[18px]" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>{children}</span>;
}

// ------------------------------------------------------------------ the dialog
export default function ImportDialog({ open, initial, onClose }: { open: boolean; initial?: ImportSourceKind | null; onClose: () => void }) {
  useLang();
  const ui = useUI();
  const v = useVault();
  const phone = usePhone();
  const running = useJob();
  const [step, setStep] = useState<Step>(() => (job ? (job.result ? "result" : "importing") : "source"));
  const [kind, setKind] = useState<ImportSourceKind | null>(initial ?? job?.kind ?? null);
  const [readP, setReadP] = useState({ done: 0, total: 0, name: "" });
  const [parsed, setParsed] = useState<ParsedSource | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(job?.plan ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keepHistory, setKeepHistory] = useState(true);
  const [perSubdeck, setPerSubdeck] = useState(true);
  const [mediaOn, setMediaOn] = useState(true);
  const [mapping, setMapping] = useState<Record<string, FieldMap>>({});
  const [views, setViews] = useState<Record<string, ViewType>>({});
  const [conflictOne, setConflictOne] = useState<Record<string, ConflictAction>>({});
  const [conflictAll, setConflictAll] = useState<ConflictAction>("rename");
  const [target, setTarget] = useState<Target>("new");
  const [spaceId, setSpaceId] = useState(ui.spaceId === "all" || ui.spaceId === "inbox" ? "" : ui.spaceId);
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState<{ code: string; message: string; file: string } | null>(null);
  const [drag, setDrag] = useState<{ name: string; size: number; n: number } | null>(null);
  const [recent, setRecent] = useState<ImportRecord[]>([]);
  const [undoing, setUndoing] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const dirIn = useRef<HTMLInputElement>(null);
  const readToken = useRef(0);
  const dragDepth = useRef(0);

  useEffect(() => { if (open) void dexieStore.registry().then(setRecent); }, [open, step]);
  useEffect(() => { dirIn.current?.setAttribute("webkitdirectory", ""); dirIn.current?.setAttribute("directory", ""); });
  // a job that finished while the dialog was closed already toasted: start fresh
  useEffect(() => { if (job?.result && job.bg) { setJob(null); setStep("source"); } else if (job) patchJob({ bg: false }); }, []);
  // follow the running job
  useEffect(() => {
    if (!running) return;
    if (running.result && step === "importing") setStep("result");
    if (running.error && step === "importing") { setError({ code: "generic", message: running.error, file: "" }); setStep("error"); }
  }, [running, step]);

  const spaces = useMemo(() => v.spaces.filter((s) => !s.archived && !s.deleted && s.id !== "inbox") as Space[], [v.spaces]);
  const existingSpace = spaces.find((s) => s.id === spaceId) ?? spaces[0];

  const reset = () => { readToken.current++; setStep("source"); setParsed(null); setPlan(null); setError(null); setConflictOne({}); setViews({}); };
  const close = () => {
    if (step === "importing" && job && !job.result) { patchJob({ bg: true }); onClose(); return; }
    if (job?.result) setJob(null);
    reset(); onClose();
  };

  // ---------------------------------------------------------------- reading + plan
  const buildPlan = async (p: ParsedSource, o: { keep?: boolean; map?: Record<string, FieldMap>; sub?: boolean; media?: boolean } = {}) => {
    if (p.kind === "anki") {
      const { ankiPlan } = await import("../lib/import-anki");
      return ankiPlan(p.col, { keepHistory: o.keep ?? keepHistory, mapping: o.map ?? mapping, perSubdeck: o.sub ?? perSubdeck, media: o.media ?? mediaOn, w: getSettings().fsrsWeights ?? undefined });
    }
    if (p.kind === "notion") return (await import("../lib/import-notion")).notionPlan(p.files, p.name);
    return (await import("../lib/import-obsidian")).obsidianPlan(p.files, p.name, undefined, p.kind);
  };
  async function read(files: File[], how: ImportSourceKind | "auto") {
    if (!files.length) return;
    const token = ++readToken.current;
    setStep("reading"); setError(null);
    setReadP({ done: 0, total: files.reduce((s, f) => s + f.size, 0), name: pickName(files) });
    try {
      const p = await readSource(how, files, (done, total) => { if (token === readToken.current) setReadP((r) => ({ ...r, done, total })); });
      if (token !== readToken.current) return;
      let map = mapping;
      if (p.kind === "anki") { const { defaultMapping } = await import("../lib/import-anki"); map = defaultMapping(p.col); setMapping(map); }
      const pl = await buildPlan(p, { map });
      if (token !== readToken.current) return;
      setKind(p.kind);
      setParsed(p); setPlan(pl);
      setSelected(new Set([...pl.notes.filter((n) => !n.off).map((n) => n.key), ...[...pl.attachments.values()].filter((a) => a.path).map((a) => attKey(a.ref))]));
      setTarget(p.kind === "obsidian" || p.kind === "notion" ? "new" : spaceId ? "existing" : "inbox");
      setFolderPath(`${t("Imported")} / ${SRC_WORD[p.kind]} ${today()}`);
      setConflictOne({}); setViews({});
      setStep("preview");
    } catch (e) {
      if (token !== readToken.current) return;
      const err = e as Error;
      setError({ code: e instanceof ImportError ? e.code : "generic", message: err.message || String(e), file: e instanceof ImportError ? e.file : files[0]?.name ?? "" });
      setStep("error");
    }
  }
  async function rebuild(o: { keep?: boolean; map?: Record<string, FieldMap>; sub?: boolean; media?: boolean }) {
    if (!parsed) return;
    const old = plan;
    const pl = await buildPlan(parsed, o);
    setPlan(pl);
    setSelected((s) => new Set(pl.notes.map((n) => n.key).filter((k) => s.has(k) || !old?.notes.some((x) => x.key === k))));
  }

  // ---------------------------------------------------------------- derived
  const noteKeys = useMemo(() => new Set([...selected].filter((k) => !k.startsWith("att:"))), [selected]);
  const excluded = useMemo(() => new Set(plan ? [...plan.attachments.values()].filter((a) => a.path && !selected.has(attKey(a.ref))).map((a) => a.ref) : []), [plan, selected]);
  const allNotes = useMemo(() => v.notes.filter((n) => !n.deleted) as Note[], [v.notes]);
  const conflicts = useMemo(() => (plan ? findConflicts(plan, allNotes, noteKeys) : []), [plan, allNotes, noteKeys]);
  const conflictKeys = useMemo(() => new Set(conflicts.map((c) => c.key)), [conflicts]);
  const counts = useMemo(() => (plan ? planCounts(plan, noteKeys, excluded) : null), [plan, noteKeys, excluded]);
  const tree = useMemo(() => (plan ? planTree(plan, { files: plan.source === "obsidian" || plan.source === "markdown", pages: plan.source !== "obsidian" && plan.source !== "markdown" }) : null), [plan]);
  const actionOf = (key: string) => conflictOne[key] ?? conflictAll;
  const importN = Math.max(0, noteKeys.size - conflicts.filter((c) => actionOf(c.key) === "skip").length);

  // ---------------------------------------------------------------- import
  async function run() {
    if (!plan || !kind) return;
    const runPlan: ImportPlan = Object.keys(views).length ? { ...plan, notes: plan.notes.map((n) => (views[n.key] ? withBaseView(n, views[n.key]) : n)) } : plan;
    const ctl = new AbortController();
    setJob({ plan: runPlan, kind, started: Date.now(), prog: { done: 0, total: 0, current: "" }, live: null, result: null, error: "", ctl, bg: false, target });
    setStep("importing");
    const inbox = v.spaces.find((s) => s.id === "inbox");
    try {
      const r = await writePlan(runPlan, {
        spaceId: target === "existing" && existingSpace ? existingSpace.id : "inbox",
        spaceName: target === "existing" ? existingSpace?.name : inbox?.name ?? t("Inbox"),
        newSpace: target === "new" ? { name: plan.name, kind: "resource", icon: "glyph:" + SRC[kind].g } : undefined,
        folderId: null, rootFolder: folderPath, selected: noteKeys, excludeAttachments: excluded,
        conflict: conflictAll, conflicts: conflictOne, conflictsAcrossSpaces: true, report: true, signal: ctl.signal,
        onProgress: (done, total, current) => patchJob({ prog: { done, total, current } }),
        onCounts: (live) => patchJob({ live }),
      }, dexieStore);
      const bg = job?.bg;
      patchJob({ result: r });
      if (ctl.signal.aborted) toast(t("Import stopped. What was written so far is one batch you can undo."));
      if (bg) {
        const first = r.firstNoteId;
        toast(t("Import finished · {num} note|Import finished · {num} notes", { n: r.counts.notes, num: N(r.counts.notes) }), first ? { label: t("Open"), run: () => openNote(first) } : undefined, { icon: "check" });
      }
    } catch (e) {
      patchJob({ error: (e as Error).message || String(e) });
      if (job?.bg) { toast(t("Import failed: {message}", { message: (e as Error).message || String(e) }), undefined, { icon: "error" }); setJob(null); }
    }
  }
  async function undo(id: string) {
    setUndoing(true);
    try {
      const n = await undoImport(id, dexieStore);
      toast(t("Import undone · {num} record removed|Import undone · {num} records removed", { n, num: N(n) }));
      setRecent(await dexieStore.registry());
      if (job?.result?.id === id) { setJob(null); reset(); }
    } finally { setUndoing(false); }
  }

  // ---------------------------------------------------------------- step: source
  const onDragOver = (e: DragEvent) => {
    if (step !== "source" || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    const n = e.dataTransfer.items.length || e.dataTransfer.files.length;
    setDrag((d) => (d && d.n === n && d.name === (f?.name ?? "") ? d : { name: f?.name ?? "", size: f?.size ?? 0, n }));
  };
  const onDrop = (e: DragEvent) => {
    if (step !== "source") return;
    e.preventDefault(); dragDepth.current = 0; setDrag(null);
    void droppedFiles(e.dataTransfer).then((fs) => read(fs, "auto"));
  };
  const pickFile = () => fileIn.current?.click();
  /** Next: vaults and Markdown folders open the folder picker ("choose a file" in the drop zone picks files / zips). */
  const pickFolder = () => dirIn.current?.click();
  const next = () => { if (!kind) return; if (kind === "obsidian" || kind === "markdown") pickFolder(); else pickFile(); };
  const sourceStep = (
    <>
      <span className="text-muted">{t("Where are your notes coming from?")}</span>
      <div className={cx("grid gap-3", phone ? "grid-cols-2" : "grid-cols-4")} role="radiogroup" aria-label={t("Source")}>
        {SOURCES.map((s) => {
          const on = s.k === kind;
          return (
            <button key={s.k} role="radio" aria-checked={on} data-source={s.k} onClick={() => setKind(s.k)} onDoubleClick={() => { setKind(s.k); if (s.k === "obsidian" || s.k === "markdown") pickFolder(); else pickFile(); }}
              className="flex min-w-0 flex-col gap-2 rounded-[12px] p-3.5 text-start"
              style={{ border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "color-mix(in srgb, var(--accent) 6%, var(--surface))" : "var(--bg)", padding: on ? 13.5 : 14 }}>
              <span className="flex items-center gap-2.5"><Glyph name={s.g} size={18} color={s.c} tile={s.c} /><span className="flex-1 font-[650]">{t(s.name)}</span></span>
              <span className="text-[12.5px] leading-[18px] text-muted">{t(s.desc)}</span>
              <span className="ltr font-mono text-[11.5px] text-muted">{t(s.files)}</span>
            </button>
          );
        })}
      </div>
      <div data-testid="import-drop" onClick={pickFile}
        className="flex min-h-[110px] flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] text-muted"
        style={{ border: `1.5px dashed ${drag ? "var(--accent)" : "var(--border)"}`, background: drag ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent" }}>
        <Glyph name="export" size={22} color={drag ? "var(--accent)" : "var(--muted)"} />
        <span className="font-medium text-ink" dir="auto">{drag ? (drag.name ? t("Drop to read {name}", { name: drag.name }) : t("Drop to read {num} item|Drop to read {num} items", { n: drag.n, num: N(drag.n) })) : t("Drop a file or folder here")}</span>
        <span className="text-[12px]">{drag ? (drag.size ? fmtBytes(drag.size) : t("Lumen picks the source for you"))
          : tx("or {file}", { file: <button className="hover:text-ink hover:underline" onClick={(e) => { e.stopPropagation(); pickFile(); }}>{t("choose a file")}</button> })}</span>
      </div>
      {recent.some((r) => !r.undone) && (
        <div className="flex flex-col gap-1" data-testid="import-recent">
          <span className="text-[12px] text-muted">{t("Recent imports")}</span>
          {recent.filter((r) => !r.undone).slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[12.5px]">
              <Glyph name={SRC[r.source].g} size={14} color="var(--muted)" />
              <span className="min-w-0 flex-1 truncate"><span dir="auto">{r.name}</span><span className="text-muted"> · {t("{num} note|{num} notes", { n: r.counts.notes, num: N(r.counts.notes) })} · {new Date(r.at).toLocaleDateString()}</span></span>
              <button disabled={undoing} className="text-link hover:underline disabled:opacity-50" onClick={() => void undo(r.id)}>{t("Undo import")}</button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // ---------------------------------------------------------------- step: reading
  const pct = readP.total ? Math.min(100, Math.round((readP.done / readP.total) * 100)) : 0;
  const srcOf = SRC[kind ?? "obsidian"];
  const readingStep = (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5" role="status" aria-live="polite">
      <Glyph name={srcOf.g} size={26} color={srcOf.c} tile={srcOf.c} />
      <span className="text-[15px] font-semibold" dir="auto">{t("Reading {name}", { name: readP.name })}</span>
      <span className="h-1.5 overflow-hidden rounded-[3px] bg-surface-2" style={{ width: phone ? 280 : 360 }}><span className="block h-full bg-ink transition-[width] duration-150" style={{ width: `${pct}%` }} /></span>
      <span className="font-mono text-[12px] text-muted">{t("{pct}% · {done} of {total} MB", { pct, done: fmtMB(readP.done), total: fmtMB(readP.total) })}</span>
      <span className="text-[12px] text-muted">{t("Nothing is written to your vault until you confirm.")}</span>
    </div>
  );

  // ---------------------------------------------------------------- step: preview
  const toggleKeys = (keys: string[], on: boolean) => setSelected((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });
  const treeHead = plan && counts && (() => {
    if (plan.source === "anki") {
      const total = plan.notes.reduce((s, n) => s + (n.cards ?? 0), 0);
      return { t: t("Decks"), k: t("{sel} of {total} cards selected", { sel: N(counts.cards), total: N(total) }) };
    }
    if (plan.source === "notion") return { t: t("Pages"), k: t("{sel} of {total} pages", { sel: N(noteKeys.size), total: N(plan.notes.length) }) };
    const files = [...plan.attachments.values()].filter((a) => a.path);
    const sel = noteKeys.size + files.filter((a) => selected.has(attKey(a.ref))).length, total = plan.notes.length + files.length;
    if (plan.source === "markdown") return { t: t("Files"), k: sel === total ? t("{num} file|{num} files", { n: total, num: N(total) }) : t("{sel} of {total} files", { sel: N(sel), total: N(total) }) };
    return { t: t("Vault"), k: t("{sel} of {total} files", { sel: N(sel), total: N(total) }) };
  })();

  const panels: ReactNode[] = [];
  if (plan && counts) {
    if (conflicts.length) panels.push(
      <Panel key="conf" g="c-warning" warn title={t("Same title already in Lumen · {num}", { num: N(conflicts.length) })} testid="import-conflicts">
        {conflicts.length > 3 && <Row a={<span className="text-muted">{t("All titles")}</span>} arrow><BoxSelect label={t("All titles")} value={conflictAll} options={ACTIONS.map((x) => ({ v: x.a, label: t(x.label) }))} onChange={(a) => { setConflictAll(a); setConflictOne({}); }} /></Row>}
        <div className="flex max-h-[150px] flex-col gap-2 overflow-y-auto">
          {conflicts.map((c) => <Row key={c.key} a={<span dir="auto">{c.title}</span>} arrow><BoxSelect label={c.title} value={actionOf(c.key)} options={ACTIONS.map((x) => ({ v: x.a, label: t(x.label) }))} onChange={(a) => setConflictOne((m) => ({ ...m, [c.key]: a }))} /></Row>)}
        </div>
      </Panel>,
    );
    if (parsed?.kind === "anki") panels.push(...ankiPanels(parsed.col, plan));
    if (plan.source === "notion") {
      const dbs = plan.notes.filter((n) => n.type === "base");
      if (dbs.length) panels.push(
        <Panel key="db" g="base" title={t("Databases → bases")} testid="import-databases">
          {dbs.map((n) => <Row key={n.key} a={<span dir="auto">{t("{name}.csv · {num} row|{name}.csv · {num} rows", { name: n.title, n: n.cards ?? 0, num: N(n.cards ?? 0) })}</span>} arrow>
            <BoxSelect label={n.title} value={views[n.key] ?? "table"} options={VIEWS.map((x) => ({ v: x.v, label: t(x.label) }))} onChange={(vt) => setViews((m) => ({ ...m, [n.key]: vt }))} /></Row>)}
        </Panel>,
      );
      const st = plan.stats ?? {};
      const others = plan.warnings.filter((w) => !/embed/i.test(w) || !st.embeds);
      const lost = (st.embeds ?? 0) + (st.syncedBlocks ?? 0);
      if (lost || others.length) panels.push(
        <Panel key="lost" g="c-warning" warn title={lost ? t("Can't be imported · {num}", { num: N(lost) }) : t("Warnings · {num}", { num: N(others.length) })} testid="import-warnings">
          {!!st.embeds && <Row muted a={st.embedProviders?.length ? t("{num} embed ({list})|{num} embeds ({list})", { n: st.embeds, num: N(st.embeds), list: st.embedProviders.join(", ") }) : t("{num} embed|{num} embeds", { n: st.embeds, num: N(st.embeds) })} />}
          {!!st.syncedBlocks && <Row muted a={t("{num} synced block|{num} synced blocks", { n: st.syncedBlocks, num: N(st.syncedBlocks) })} />}
          {others.map((w, i) => <Row key={i} muted a={w} />)}
        </Panel>,
      );
      panels.push(<Panel key="links" g="wikilink" title={t("Links")}><Row a={t("{num} page link|{num} page links", { n: st.pageLinks ?? 0, num: N(st.pageLinks ?? 0) })} arrow><span className={box}>[[links]]</span></Row></Panel>);
    } else if (plan.source === "obsidian" || plan.source === "markdown") {
      panels.push(
        <Panel key="counts" g="note" title={t("Counts")} testid="import-counts">
          <Row a={t("{num} note|{num} notes", { n: counts.notes, num: N(counts.notes) })} />
          {plan.source === "obsidian" && <Row a={t("{num} canvas|{num} canvases", { n: counts.canvases, num: N(counts.canvases) })} />}
          <Row a={counts.attachments ? t("{num} attachment · {size}|{num} attachments · {size}", { n: counts.attachments, num: N(counts.attachments), size: fmtBytes(counts.bytes) }) : t("{num} attachment|{num} attachments", { n: 0, num: N(0) })} />
          {plan.source === "obsidian" && <Row a={t("{links} · {tags}", { links: t("{num} link|{num} links", { n: counts.links, num: N(counts.links) }), tags: t("{num} tag|{num} tags", { n: counts.tags, num: N(counts.tags) }) })} />}
        </Panel>,
      );
    }
    if (plan.source !== "notion" && plan.warnings.length) panels.push(
      <Panel key="warn" g="c-warning" warn title={t("Warnings · {num}", { num: N(plan.warnings.length) })} testid="import-warnings">
        <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">{plan.warnings.map((w, i) => <Row key={i} muted a={w} />)}</div>
      </Panel>,
    );
  }

  function ankiPanels(col: AnkiCollection, pl: ImportPlan): ReactNode[] {
    const types = [...col.types.values()].filter((x) => x.notes > 0);
    const out: ReactNode[] = [
      <Panel key="types" g="flashcards" title={t("Note types found")} testid="anki-types">
        {types.map((x) => <Row key={x.id} a={<><span dir="auto">{x.name}</span> · {N(x.notes)}</>} arrow><span className={box}>{x.kind === "cloze" ? "{{c1::…}}" : x.kind === "occlusion" ? t("occlusion block") : t("Front / Back")}</span></Row>)}
      </Panel>,
    ];
    const roleOptions: { v: Role; label: string }[] = [{ v: "front", label: t("Front") }, { v: "back", label: t("Back") }, { v: "extra", label: t("Back · below a line") }, { v: "skip", label: t("Not imported") }];
    for (const x of types.filter((y) => y.kind === "basic")) {
      const m = mapping[x.id];
      if (!m) continue;
      const roleOf = (i: number): Role => (i === m.front ? "front" : i === m.back ? "back" : m.extra?.includes(i) ? "extra" : "skip");
      const setRole = (i: number, r: Role) => {
        const nm: FieldMap = { ...m, extra: (m.extra ?? []).filter((e) => e !== i) };
        if (nm.back === i) nm.back = -1;
        if (r === "front") nm.front = i;
        else if (r === "back") nm.back = i;
        else if (r === "extra") nm.extra = [...(nm.extra ?? []), i].sort((a, b) => a - b);
        if (r !== "front" && m.front === i) nm.front = x.fields.findIndex((_f, j) => j !== i && j !== nm.back);
        const next = { ...mapping, [x.id]: nm };
        setMapping(next); void rebuild({ map: next });
      };
      out.push(
        <Panel key={"map" + x.id} g="columns-2" title={<span>{t("Field mapping · {type}", { type: x.name })}</span>} testid="anki-mapping">
          {x.fields.map((f, i) => <Row key={i} a={<span dir="auto">{f}</span>} arrow><BoxSelect label={f} value={roleOf(i)} options={roleOptions} onChange={(r) => setRole(i, r)} /></Row>)}
          {x.templates.length >= 2 && <Row a={t("Reverse cards")}><Toggle label={t("Reverse cards")} on={m.reverse} onChange={(r) => { const next = { ...mapping, [x.id]: { ...m, reverse: r } }; setMapping(next); void rebuild({ map: next }); }} /></Row>}
        </Panel>,
      );
    }
    const media = new Set([...pl.attachments.values()].map((a) => a.name)).size || col.media.size;
    out.push(
      <Panel key="opts" g="s-revise" title={t("Options")} testid="anki-options">
        <Row a={t("Keep review history")}><Toggle label={t("Keep review history")} on={keepHistory} onChange={(k) => { setKeepHistory(k); void rebuild({ keep: k }); }} /></Row>
        <Row a={t("One note per sub-deck")}><Toggle label={t("One note per sub-deck")} on={perSubdeck} onChange={(k) => { setPerSubdeck(k); void rebuild({ sub: k }); }} /></Row>
        <Row a={t("Import {num} media file|Import {num} media files", { n: media, num: N(media) })}><Toggle label={t("Import media files")} on={mediaOn} onChange={(k) => { setMediaOn(k); void rebuild({ media: k }); }} /></Row>
      </Panel>,
    );
    return out;
  }

  const previewStep = plan && tree && treeHead && (
    <div className={cx("grid gap-4", phone ? "shrink-0 grid-cols-1" : "min-h-0 flex-1 grid-cols-[1.2fr_1fr]")}>
      <div className={cx("flex flex-col gap-2", !phone && "min-h-0")}>
        <div className="flex items-center gap-2"><span className="flex-1 font-semibold">{treeHead.t}</span><span className="text-[12px] text-muted" data-testid="import-tree-count">{treeHead.k}</span></div>
        <div className={cx("flex flex-col overflow-y-auto rounded-[10px] border border-line bg-bg p-1.5", phone ? "h-[196px] shrink-0" : "min-h-0 flex-1")} role="tree" data-testid="import-tree">
          {tree.children.map((c) => <TreeRow key={c.id} node={c} depth={0} source={plan.source} selected={selected} conflicts={conflictKeys} onToggle={toggleKeys} />)}
        </div>
      </div>
      <div className={cx("flex min-w-0 flex-col gap-3", !phone && "min-h-0 overflow-y-auto")}>{panels}</div>
    </div>
  );

  // ---------------------------------------------------------------- step: target
  const targetCards: { k: Target; n: string; d: ReactNode; g: GlyphName; c: string }[] = [
    { k: "new", n: t("New space"), d: <>{t("“{name}” · Resource", { name: plan?.name ?? "" })}</>, g: "project", c: "var(--accent)" },
    { k: "existing", n: t("Existing space"), d: existingSpace ? existingSpace.name : t("No other spaces yet"), g: glyphOfIcon(existingSpace?.icon), c: existingSpace?.color ?? "#A371F7" },
    { k: "inbox", n: t("Inbox"), d: t("Sort later"), g: "inbox", c: "var(--muted)" },
  ];
  const targetStep = (
    <div className="flex max-w-[560px] flex-col gap-3.5">
      <span className="text-muted">{t("Where should {num} note go?|Where should {num} notes go?", { n: importN, num: N(importN) })}</span>
      <div role="radiogroup" aria-label={t("Where to")} className="flex flex-col gap-3.5">
        {targetCards.map((c) => {
          const on = target === c.k;
          const disabled = c.k === "existing" && !existingSpace;
          return (
            <div key={c.k} role="radio" aria-checked={on} aria-disabled={disabled} tabIndex={0} data-target={c.k} onClick={() => !disabled && setTarget(c.k)} onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !disabled) { e.preventDefault(); setTarget(c.k); } }}
              className={cx("flex min-h-14 cursor-pointer items-center gap-3 rounded-[12px] px-3.5", disabled && "cursor-default opacity-50")}
              style={{ border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "color-mix(in srgb, var(--accent) 6%, var(--surface))" : "var(--bg)", paddingInline: on ? 13.5 : 14 }}>
              <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full" style={{ border: on ? "2px solid var(--accent)" : "1.5px solid var(--muted)" }}><span className="size-2 rounded-full" style={{ background: on ? "var(--accent)" : "transparent" }} /></span>
              <Glyph name={c.g} size={16} color={c.c} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{c.n}</span>
                {c.k === "existing" && existingSpace ? (
                  <span className="relative w-fit text-[12px] text-muted">
                    <span dir="auto">{existingSpace.name}</span>{spaces.length > 1 && <span className="ms-1 text-[9px]">▾</span>}
                    {spaces.length > 1 && <select aria-label={t("Existing space")} value={existingSpace.id} onClick={(e) => e.stopPropagation()} onChange={(e) => { setSpaceId(e.target.value); setTarget("existing"); }} className="absolute inset-0 cursor-pointer opacity-0">
                      {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>}
                  </span>
                ) : <span className="text-[12px] text-muted" dir="auto">{c.d}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">{t("Folder inside the space")}</span>
        <span className="flex h-[38px] items-center gap-2 rounded-[8px] border border-line bg-bg px-3 focus-within:border-accent">
          <Glyph name="folder" size={14} color="var(--muted)" />
          <input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder={t("Top level of the space")} dir="auto" data-testid="import-folder-path"
            className="min-w-0 flex-1 bg-transparent outline-none" />
        </span>
      </label>
    </div>
  );

  // ---------------------------------------------------------------- step: importing
  const j = running;
  const live = j?.live;
  const frac = j?.prog.total ? j.prog.done / j.prog.total : 0;
  const elapsed = j ? (Date.now() - j.started) / 1000 : 0;
  const left = frac > 0.02 && frac < 1 ? Math.max(1, Math.round((elapsed * (1 - frac)) / frac)) : null;
  const importingStep = j && (
    <div className="flex w-full max-w-[560px] flex-1 flex-col justify-center gap-4 self-center" role="status" aria-live="polite" data-testid="import-progress">
      <div className="flex items-baseline gap-2">
        <b className="text-[24px]">{N(live?.notes[0] ?? 0)}</b>
        <span className="text-muted">{t("of {num} note|of {num} notes", { n: live?.notes[1] ?? 0, num: N(live?.notes[1] ?? 0) })}</span>
        <span className="flex-1" />
        {left !== null && <span className="text-[12px] text-muted">{left >= 90 ? t("~{num} min left", { num: N(Math.round(left / 60)) }) : t("~{num} s left", { num: N(left) })}</span>}
      </div>
      <span className="h-2 overflow-hidden rounded-[4px] bg-surface-2"><span className="block h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(frac * 100)}%` }} /></span>
      {([
        ["note", "var(--muted)", t("Notes"), live?.notes, true],
        ["canvas", "var(--success)", t("Canvases"), live?.canvases, j.plan.source === "obsidian"],
        ["image", "var(--muted)", t("Attachments"), live?.attachments, true],
        ["wikilink", "var(--muted)", t("Links resolved"), live?.links, j.plan.source !== "anki"],
      ] as [GlyphName, string, string, [number, number] | undefined, boolean][]).filter((r) => r[4]).map(([g, c, l, val]) => (
        <div key={l} className="flex items-center gap-2.5"><Glyph name={g} size={15} color={c} /><span className="flex-1">{l}</span><span className="tabular-nums text-muted">{N(val?.[0] ?? 0)} / {N(val?.[1] ?? 0)}</span></div>
      ))}
      <span className="ltr truncate text-start font-mono text-[12px] text-muted" dir="auto">{live?.current || j.prog.current || " "}</span>
    </div>
  );

  // ---------------------------------------------------------------- step: result
  const r = j?.result;
  const resultStep = r && j && (() => {
    const c = r.counts;
    const st = j.plan.stats ?? {};
    const lost = (st.embeds ?? 0) + (st.syncedBlocks ?? 0);
    const handled = r.handled ?? [];
    const title = j.plan.source === "anki" ? t("{num} card imported|{num} cards imported", { n: c.flashcards ?? 0, num: N(c.flashcards ?? 0) })
      : j.plan.source === "notion" ? t("{num} page imported|{num} pages imported", { n: c.notes, num: N(c.notes) })
      : t("{num} note imported|{num} notes imported", { n: c.notes, num: N(c.notes) });
    const into = r.newSpace ? t("Into the new space “{name}”", { name: r.spaceName ?? "" }) : r.spaceId === "inbox" ? t("Into Inbox") : t("Into “{name}”", { name: r.spaceName ?? "" });
    const stats: [number, string, string][] = j.plan.source === "anki"
      ? [[c.flashcards ?? 0, t("cards"), "var(--text)"], [c.notes, t("flashcard notes"), "var(--text)"], [c.attachments, t("media"), "var(--text)"], [c.skipped, t("skipped"), c.skipped ? "var(--warning)" : "var(--muted)"]]
      : j.plan.source === "notion"
        ? [[c.notes - (c.bases ?? 0), t("notes"), "var(--text)"], [c.bases ?? 0, t("bases"), "var(--text)"], [c.links ?? 0, t("links"), "var(--text)"], [c.skipped + lost, t("skipped"), c.skipped + lost ? "var(--warning)" : "var(--muted)"]]
        : j.plan.source === "markdown"
          ? [[c.notes, t("notes"), "var(--text)"], [c.skipped, t("skipped"), c.skipped ? "var(--warning)" : "var(--muted)"]]
          : [[c.notes, t("notes"), "var(--text)"], [c.canvases ?? 0, t("canvases"), "var(--text)"], [c.attachments, t("files"), "var(--text)"], [c.merged + c.renamed + c.skipped, t("merged/renamed"), c.merged + c.renamed + c.skipped ? "var(--warning)" : "var(--muted)"]];
    const parts = handled.map((h) => h.action === "merge" ? t("{title} merged", { title: h.title }) : h.action === "rename" ? t("{title} renamed to “{to}”", { title: h.title, to: h.to ?? "" }) : t("{title} skipped", { title: h.title }));
    const warn = handled.length
      ? { t: t("{num} title handled|{num} titles handled", { n: handled.length, num: N(handled.length) }), d: t("{list}. Listed in “Import report”.", { list: parts.join(" · ") }) }
      : j.plan.source === "notion" && lost
        ? { t: t("{num} item skipped|{num} items skipped", { n: lost, num: N(lost) }), d: st.syncedBlocks ? t("{embeds} and {synced} — listed in “Import report”.", { embeds: t("{num} embed|{num} embeds", { n: st.embeds ?? 0, num: N(st.embeds ?? 0) }), synced: t("{num} synced block|{num} synced blocks", { n: st.syncedBlocks, num: N(st.syncedBlocks) }) }) : t("{embeds} — listed in “Import report”.", { embeds: t("{num} embed|{num} embeds", { n: st.embeds ?? 0, num: N(st.embeds ?? 0) }) }) }
        : r.warnings?.length ? { t: t("{num} warning|{num} warnings", { n: r.warnings.length, num: N(r.warnings.length) }), d: t("{list} Listed in “Import report”.", { list: r.warnings.slice(0, 2).join(" ") }) } : null;
    return (
      <div className="flex w-full max-w-[600px] flex-1 flex-col justify-center gap-4 self-center" data-testid="import-result">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)" }}><Glyph name="s-done" size={22} color="var(--success)" /></span>
          <div className="flex min-w-0 flex-col"><span className="text-[17px] font-[650]">{title}</span><span className="text-muted" dir="auto">{into}</span></div>
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${phone ? 2 : Math.min(4, stats.length)}, minmax(0, 1fr))` }}>
          {stats.map(([n, l, col]) => <div key={l} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-bg px-3 py-2.5"><b className="text-[20px]" style={{ color: col }}>{N(n)}</b><span className="text-[12px] text-muted">{l}</span></div>)}
        </div>
        {warn && (
          <div className="flex flex-col gap-1 rounded-[10px] px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--warning) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 28%, transparent)" }}>
            <span className="font-semibold text-warn">{warn.t}</span>
            <span className="text-[12.5px] leading-[18px] text-muted" dir="auto">{warn.d}</span>
          </div>
        )}
      </div>
    );
  })();

  // ---------------------------------------------------------------- step: error
  const fmt = <b className="font-semibold text-ink">Markdown &amp; CSV</b>;
  const errorStep = error && (
    <div className="flex w-full max-w-[520px] flex-1 flex-col justify-center gap-3 self-center" role="alert" data-testid="import-error">
      <Glyph name="c-danger" size={22} color="var(--danger)" tile="var(--danger)" />
      <span className="text-[17px] font-[650]">{t("This file couldn't be read")}</span>
      {error.code === "notion-html" ? (
        <>
          <span className="leading-5 text-muted">{tx("{file} looks like an HTML export. Lumen needs {format}.", { file: <span className="ltr font-mono text-ink" dir="auto">{error.file}</span>, format: fmt })}</span>
          <div className="rounded-[10px] border border-line bg-bg p-3 text-[12.5px] leading-5">{tx("In Notion: ⋯ › Export › Export format {format} › Include subpages › Export.", { format: <b className="font-semibold">Markdown &amp; CSV</b> })}</div>
        </>
      ) : error.code === "not-anki" ? (
        <>
          <span className="leading-5 text-muted">{tx("{file} isn't an Anki package.", { file: <span className="ltr font-mono text-ink" dir="auto">{error.file}</span> })}</span>
          <div className="rounded-[10px] border border-line bg-bg p-3 text-[12.5px] leading-5">{tx("In Anki: File › Export › Export format {format} › Include scheduling information › Export.", { format: <b className="font-semibold">{t("Anki Deck Package (.apkg)")}</b> })}</div>
        </>
      ) : <span className="leading-5 text-muted" dir="auto">{error.message}</span>}
    </div>
  );

  // ---------------------------------------------------------------- chrome
  const stepNo = step === "preview" ? 1 : step === "target" ? 2 : step === "importing" || step === "result" ? 3 : 0;
  const STEP_LABELS = [t("Source"), t("Preview"), t("Target"), t("Import")];
  const phoneTitle = { source: t("Import"), reading: t("Reading"), preview: t("Preview"), target: t("Where to"), importing: t("Importing"), result: t("Done"), error: t("Import") }[step];
  const back = () => {
    if (step === "source" || step === "result") close();
    else if (step === "reading" || step === "error") reset();
    else if (step === "preview") reset();
    else if (step === "target") setStep("preview");
  };
  const foot: { note: string; sec?: { l: string; run: () => void; testid?: string }; pri: { l: string; run: () => void; disabled?: boolean; muted?: boolean; testid?: string } } = (() => {
    switch (step) {
      case "source": return { note: t("Choose a source or drop a file"), sec: { l: t("Cancel"), run: close }, pri: { l: t("Next"), run: next, disabled: !kind, testid: "import-next" } };
      case "reading": return { note: "", sec: { l: t("Cancel"), run: reset }, pri: { l: t("Reading…"), run: () => {}, disabled: true } };
      case "preview": return { note: t("Nothing changes until you import"), sec: { l: t("Back"), run: reset }, pri: { l: t("Next"), run: () => setStep("target"), disabled: !noteKeys.size, testid: "import-next" } };
      case "target": return { note: "", sec: { l: t("Back"), run: () => setStep("preview") }, pri: { l: t("Import {num} note|Import {num} notes", { n: importN, num: N(importN) }), run: () => void run(), disabled: !importN, testid: "import-run" } };
      case "importing": return { note: t("You can close this; it continues in the background"), sec: { l: t("Cancel"), run: () => job?.ctl.abort() }, pri: { l: t("Run in background"), run: close, testid: "import-bg" } };
      case "result": return { note: t("The whole import is one undo step"), sec: { l: undoing ? t("Undoing…") : t("Undo import"), run: () => { if (r) void undo(r.id); }, testid: "import-undo" }, pri: { l: t("Open"), run: () => { const id = r?.firstNoteId; close(); if (id) openNote(id); }, disabled: !r?.firstNoteId, testid: "import-open" } };
      case "error": return { note: "", sec: { l: t("Close"), run: close }, pri: { l: t("Try another file"), run: () => { reset(); if (kind === "obsidian") setStep("source"); else { setStep("source"); setTimeout(pickFile, 0); } }, muted: true, testid: "import-retry" } };
    }
  })();
  const bh = phone ? 50 : 36;
  const btnBase: CSSProperties = { height: bh, flex: phone ? 1 : "0 0 auto", borderRadius: 10 };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  if (!open) return null;

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{ background: phone ? "var(--surface)" : "linear-gradient(rgba(5,6,8,.5), rgba(5,6,8,.5)), color-mix(in srgb, var(--surface) 40%, var(--bg))" }}>
      <input ref={fileIn} type="file" hidden multiple={kind !== "anki"} accept={kind ? ACCEPT[kind] : ".apkg,.colpkg,.zip,.md,.markdown,.txt,.canvas,.base"} data-testid="import-file"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void read(f, kind ?? "auto"); }} />
      <input ref={dirIn} type="file" hidden multiple data-testid="import-folder" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void read(f, kind ?? "auto"); }} />
      <div role="dialog" aria-modal="true" aria-label={t("Import")} data-step={step}
        className={cx("flex flex-col overflow-hidden bg-surface text-[13px] leading-[normal] text-ink", !phone && "rounded-[14px] border border-line")}
        style={phone ? { width: "100vw", height: "100dvh" } : { width: "min(960px, calc(100vw - 32px))", height: "min(640px, calc(100dvh - 32px))" }}
        onDragEnter={(e) => { if (step === "source") { dragDepth.current++; onDragOver(e); } }} onDragOver={onDragOver}
        onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDrag(null); } }} onDrop={onDrop}>
        <div className="flex items-center gap-3 border-b border-line" style={{ padding: phone ? "max(44px, calc(env(safe-area-inset-top) + 12px)) 16px 12px" : "16px 20px" }}>
          {phone && <button aria-label={t("Back")} onClick={back} disabled={step === "importing"} className="w-7 text-start text-[18px] disabled:opacity-40"><span className="inline-block rtl:-scale-x-100">←</span></button>}
          <span className="flex-1 text-[17px] font-[650]">{phone ? phoneTitle : t("Import")}</span>
          {!phone && (
            <ol className="flex gap-2.5 text-[12px]" aria-label={t("Steps")}>
              {STEP_LABELS.map((l, i) => {
                const done = i < stepNo, cur = i === stepNo;
                return (
                  <li key={i} aria-current={cur ? "step" : undefined} className="flex items-center gap-1.5" style={{ color: cur || done ? "var(--text)" : "var(--muted)", fontWeight: cur ? 600 : 450 }}>
                    <span className="flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: cur ? "var(--accent)" : "transparent", border: `1.5px solid ${cur || done ? "var(--text)" : "var(--muted)"}`, borderColor: cur ? "var(--text)" : undefined, color: cur ? "var(--accent-fg)" : "var(--text)" }}>
                      {done ? <Glyph name="check" size={10} stroke={2.5} /> : fmtNum(i + 1)}
                    </span>{l}
                  </li>
                );
              })}
            </ol>
          )}
          {phone && <span className="text-[12px] text-muted">{t("Step {n} of {total}", { n: stepNo + 1, total: 4 })}</span>}
          {!phone && <button aria-label={t("Close")} onClick={close} className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={14} /></button>}
        </div>
        <div className={cx("flex min-h-0 flex-1 flex-col gap-3.5", phone ? "overflow-y-auto" : "overflow-hidden")} style={{ padding: phone ? 16 : "18px 20px" }}>
          {step === "source" && sourceStep}
          {step === "reading" && readingStep}
          {step === "preview" && previewStep}
          {step === "target" && targetStep}
          {step === "importing" && importingStep}
          {step === "result" && resultStep}
          {step === "error" && errorStep}
        </div>
        <div className="flex items-center gap-2 border-t border-line" style={{ padding: phone ? "12px 16px max(28px, calc(env(safe-area-inset-bottom) + 12px))" : "14px 20px" }}>
          {!phone && <span className="flex-1 text-[12.5px] text-muted">{foot.note}</span>}
          {foot.sec && <button onClick={foot.sec.run} data-testid={foot.sec.testid} className="flex items-center justify-center border border-line px-3.5 hover:bg-surface-2" style={btnBase}>{foot.sec.l}</button>}
          <button onClick={foot.pri.run} disabled={foot.pri.disabled} data-testid={foot.pri.testid}
            className={cx("flex items-center justify-center whitespace-nowrap px-4 font-semibold", foot.pri.muted ? "hover:brightness-110" : "hover:brightness-110")}
            style={{ ...btnBase, background: foot.pri.muted ? "var(--surface-2)" : "var(--accent)", color: foot.pri.muted ? "var(--text)" : "var(--accent-fg)", opacity: foot.pri.disabled ? 0.4 : 1 }}>{foot.pri.l}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ preview tree row
function TreeRow({ node, depth, source, selected, conflicts, onToggle }: { node: TreeNode; depth: number; source: ImportSourceKind; selected: Set<string>; conflicts: Set<string>; onToggle: (keys: string[], on: boolean) => void }) {
  const folder = node.kind === "folder";
  const [openRow, setOpen] = useState(() => depth === 0 && folder && !node.off && (!!node.self || node.children.some((c) => c.kind === "note" && c.badge !== "canvas")));
  const keys = node.noteKeys;
  const on = keys.filter((k) => selected.has(k)).length;
  const state = on === 0 ? false : on === keys.length ? true : "mixed";
  const conflict = node.kind === "note" && conflicts.has(keys[0]);
  // glyph, colour, count and tag per source (design TREES)
  let g: GlyphName = "note", gc = "var(--muted)", k = "", tag: { l: string; c: string } | null = null;
  const name = source === "obsidian" || source === "markdown" ? (node.kind === "note" ? node.noteKeys[0].split("/").pop() ?? node.name : node.name) : node.name;
  if (source === "anki") {
    g = node.kind === "note" && node.audio && node.audio >= (node.cards ?? 0) ? "audio" : "flashcards";
    gc = state === false ? "var(--muted)" : g === "audio" ? "var(--muted)" : "var(--learn)";
    const n = folder ? node.allCards ?? 0 : node.cards ?? 0;
    k = depth === 0 ? t("{num} card|{num} cards", { n, num: N(n) }) : N(n);
    if (node.audio) { k = t("{cards} · {num} audio", { cards: k, num: N(node.audio) }); tag = { l: t("audio"), c: "var(--info)" }; }
  } else if (source === "notion") {
    const db = node.badge === "database";
    g = db ? "base" : folder && depth === 0 ? "project" : "note";
    gc = db ? "var(--text)" : folder && depth === 0 ? "#E8893A" : "var(--muted)";
    if (db) { k = t("CSV · {num} row|CSV · {num} rows", { n: node.cards ?? 0, num: N(node.cards ?? 0) }); tag = { l: t("→ base"), c: "var(--success)" }; }
    else if (folder) k = t("{num} page|{num} pages", { n: node.notes ?? 0, num: N(node.notes ?? 0) });
  } else if (folder) {
    g = "folder";
    gc = (node.notes ?? 0) - (node.canvases ?? 0) > 0 && !node.off ? "#A371F7" : "var(--muted)";
    k = node.off && state === false ? t("skipped")
      : (node.notes ?? 0) > 0 && node.notes === node.canvases ? t("{num} .canvas", { num: N(node.canvases ?? 0) })
      : (node.notes ?? 0) > 0 ? N(node.notes ?? 0)
      : t("{num} file · {size}|{num} files · {size}", { n: node.files ?? 0, num: N(node.files ?? 0), size: fmtBytes(node.bytes ?? 0) });
  } else if (node.kind === "file") {
    g = "image"; k = fmtBytes(node.bytes ?? 0);
  } else {
    g = node.badge === "canvas" ? "canvas" : node.badge === "whiteboard" ? "whiteboard" : node.badge === "base" ? "base" : "note";
  }
  if (conflict) tag = { l: t("title exists"), c: "var(--warning)" };
  return (
    <>
      <div role="treeitem" aria-selected={state === true} aria-expanded={folder ? openRow : undefined} aria-level={depth + 1}
        className="flex min-h-[30px] cursor-pointer items-center gap-2 rounded-[6px] pe-1.5 hover:bg-surface-2"
        style={{ paddingInlineStart: 8 + depth * 18, background: conflict ? "var(--surface)" : undefined }}
        onClick={() => onToggle(keys, state !== true)}>
        <Check state={state} />
        <button aria-label={folder ? (openRow ? t("Collapse") : t("Expand")) : undefined} tabIndex={folder ? 0 : -1} onClick={(e) => { e.stopPropagation(); if (folder) setOpen((o) => !o); }}
          className="w-2.5 shrink-0 text-[11px] text-muted"><span className="inline-block rtl:-scale-x-100">{folder ? (openRow ? "▾" : "▸") : ""}</span></button>
        <Glyph name={g} size={14} color={gc} />
        <span className="min-w-0 flex-1 truncate" dir="auto">{name}</span>
        {tag && <Tag c={tag.c}>{tag.l}</Tag>}
        {k && <span className="whitespace-nowrap text-[11.5px] text-muted">{k}</span>}
      </div>
      {folder && openRow && node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} source={source} selected={selected} conflicts={conflicts} onToggle={onToggle} />)}
    </>
  );
}
