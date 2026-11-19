import { Archive, Braces, Briefcase, ChevronDown, ChevronRight, CircleCheck, Compass, FileArchive, FileCode, FileText, GraduationCap, LayoutDashboard, Library, Map as MapIcon, Printer, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";
import { SPACE_KINDS, type SpaceKind } from "../../shared/types";
import { createFolder, createNote, createSpace } from "../lib/actions";
import { t, tk } from "../lib/i18n";
import { PRESETS } from "../lib/canvas";
import { patch } from "../lib/db";
import {
  canPickFolder, chooseSaveTarget, estimateVaultExport, exportBackup, exportNoteHtml, exportNoteMd, exportVaultZip, fetchMissingAttachments, importFiles, printNote, showInFolder,
  type DuplicatePolicy, type ExportEstimate, type ExportResult, type ImportResult,
} from "../lib/io";
import { go, setUI, toast, useUI, useVault } from "../lib/store";
import { ROADMAP_PRESETS } from "../lib/templates";
import { fmtBytes, Modal, usePhone } from "../views/spaces-util";
import { KIND_LABEL } from "./Sidebar";
import { cx } from "./ui";
import { SpaceIcon, SpaceIconPicker } from "./SpaceIcon";
import { Glyph } from "./Glyph";
import { openImport } from "./NewMenu";

const KIND_HINT: Record<SpaceKind, string> = {
  project: tk("A goal with a deadline and milestones."),
  area: tk("An ongoing responsibility. No end date."),
  course: tk("Learn something, with a roadmap."),
  resource: tk("Reference material on a topic."),
  archive: tk("Finished. Hidden, still searchable."),
};
const KIND_GLYPH: Record<SpaceKind, typeof Briefcase> = { project: Briefcase, area: Compass, course: GraduationCap, resource: Library, archive: Archive };
/** Default stored icon per kind (glyph form, see src/lib/space-icon.ts). */
const KIND_ICON: Record<SpaceKind, string> = { project: "glyph:project", area: "glyph:area", course: "glyph:course", resource: "glyph:resource", archive: "glyph:archive" };

/** Space templates per kind. Course → roadmaps; project → milestone plans; area/resource → starter folders. */
type SpaceTemplate = { name: string; detail?: string; n?: number; roadmap?: string; folders?: string[] };
const modules = (md: string) => (md.match(/^##\s/gm) ?? []).length;
const TEMPLATES_BY_KIND: Record<SpaceKind, SpaceTemplate[]> = {
  course: ROADMAP_PRESETS.map((p, i) => ({ name: p.name, detail: i > 0 ? tk("roadmap with {n} modules") : undefined, n: modules(p.body), roadmap: p.body })),
  project: [
    { name: tk("No template") },
    { name: tk("Thesis / paper"), detail: tk("{n} milestone|{n} milestones"), n: 5, roadmap: "## Milestones\n- [ ] Proposal\n- [ ] Literature review\n- [ ] Experiments\n- [ ] First draft\n- [ ] Submission\n" },
    { name: tk("Software release"), detail: tk("{n} milestone|{n} milestones"), n: 4, roadmap: "## Milestones\n- [ ] Spec\n- [ ] Prototype\n- [ ] Beta\n- [ ] Launch\n" },
    { name: tk("Event"), detail: tk("{n} milestone|{n} milestones"), n: 4, roadmap: "## Milestones\n- [ ] Plan\n- [ ] Book venue\n- [ ] Invite\n- [ ] Event day\n" },
  ],
  area: [
    { name: tk("No template") },
    { name: tk("Journal + reference"), detail: tk("{n} folder|{n} folders"), n: 3, folders: ["Journal", "Reference", "Someday"] },
  ],
  resource: [
    { name: tk("No template") },
    { name: tk("Reading library"), detail: tk("{n} folder|{n} folders"), n: 3, folders: ["Books", "Papers", "Articles"] },
  ],
  archive: [{ name: tk("No template") }],
};

// Design-spec form controls (6px radius, bg field, accent focus ring).
const fieldCls = "h-10 w-full rounded-[6px] border border-line bg-bg px-3 text-[14px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)]";
const btnGhost = "flex h-9 items-center rounded-[10px] px-3.5 text-muted hover:bg-surface-2 hover:text-ink";
const btnPrimary = "flex h-9 items-center gap-2 rounded-[10px] bg-accent px-4 font-semibold text-accent-fg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const btnOutline = "flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3.5 hover:bg-surface-2 disabled:opacity-50";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Dev hook so screenshots/tests can open the dialogs directly.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __lumenUI?: typeof setUI }).__lumenUI = setUI;

export function NewSpaceDialog() {
  const ui = useUI();
  const phone = usePhone();
  const [kind, setKindRaw] = useState<SpaceKind>("course");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [preset, setPreset] = useState(1);
  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [more, setMore] = useState(false);
  const [picker, setPicker] = useState(false);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const close = () => setUI({ newSpace: false });
  const templates = TEMPLATES_BY_KIND[kind];
  const tpl = templates[Math.min(preset, templates.length - 1)];
  // Picking a kind swaps the template list; course pre-selects its first real roadmap, others start blank.
  const setKind = (k: SpaceKind) => { setKindRaw(k); setPreset(k === "course" ? 1 : 0); };
  async function create() {
    if (!name.trim()) return;
    const props: Record<string, string> = {};
    if (kind === "project") { if (goal) props.goal = goal; if (deadline) props.deadline = deadline; }
    if (kind === "course") { if (url) props.url = url; if (provider) props.provider = provider; if (deadline) props.target = deadline; props.roadmap = tpl.roadmap ?? ROADMAP_PRESETS[0].body; }
    const s = await createSpace({ name: name.trim(), kind, icon: icon || KIND_ICON[kind], color, description: description.trim(), props, sort: Date.now() });
    if (kind !== "course" && tpl.roadmap) {
      const rm = await createNote({ type: "roadmap", title: `${s.name} milestones`, body: tpl.roadmap, spaceId: s.id });
      await patch("space", s.id, { roadmapId: rm.id });
    }
    for (const f of tpl.folders ?? []) await createFolder(s.id, null, f);
    close();
    setName(""); setGoal(""); setDeadline(""); setUrl(""); setIcon(""); setProvider(""); setDescription(""); setMore(false); setColor(null);
    go(kind === "area" || kind === "resource" ? "notes" : "space", { spaceId: s.id, folderId: null, tag: null });
  }
  function cardKeys(e: RKeyboardEvent, i: number) {
    const cols = phone ? 2 : SPACE_KINDS.length;
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? (phone ? cols : 1) : e.key === "ArrowUp" ? (phone ? -cols : -1) : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + SPACE_KINDS.length) % SPACE_KINDS.length;
    setKind(SPACE_KINDS[j]);
    cards.current[j]?.focus();
  }
  const details = kind === "project" ? t("goal, deadline, description") : kind === "course" ? t("provider, URL, target date, description") : t("description");
  const pad = "px-5 md:px-6";

  return (
    <Modal open={ui.newSpace} onClose={close} width={720} phoneHeight="100dvh" label={t("New space")}>
      <div className="flex flex-col text-[13px]" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); } }}>
        <div className={cx("flex items-center pb-1 pt-5", pad)}><span className="flex-1 text-[18px] font-[650]">{t("New space")}</span>
          <button aria-label={t("Close")} onClick={close} className="-m-1 rounded-md p-1 text-muted hover:text-ink"><X size={18} /></button></div>
        <div className={cx("pb-4 text-muted", pad)}>{t("A self-contained container with its own folders, icon and colour. Links and search still work across spaces.")}</div>
        <div role="radiogroup" aria-label={t("Kind")} className={cx("grid grid-cols-2 gap-2.5 md:grid-cols-5", pad)}>
          {SPACE_KINDS.map((k, i) => {
            const on = kind === k;
            const I = KIND_GLYPH[k];
            return (
              <button key={k} ref={(el) => { cards.current[i] = el; }} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                onClick={() => setKind(k)} onKeyDown={(e) => cardKeys(e, i)}
                className="box-border flex min-h-[118px] flex-col gap-2 rounded-[10px] px-3 py-3.5 text-start focus:outline-none"
                style={{ border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--bg)", boxShadow: on ? "0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent)" : "none" }}>
                <I size={18} style={{ color: on ? "var(--accent)" : "var(--muted)" }} />
                <span className="text-[13.5px] font-semibold">{t(KIND_LABEL[k])}</span>
                <span className="text-[12px] leading-[17px] text-muted">{t(KIND_HINT[k])}</span>
              </button>
            );
          })}
        </div>
        <div className={cx("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-4 pt-5", pad)}>
          <span className="font-medium text-muted">{t("Name")}</span>
          <div className="flex gap-2">
            <button ref={iconBtn} type="button" aria-label={t("Space icon")} aria-haspopup="dialog" aria-expanded={picker} onClick={() => setPicker((x) => !x)}
              className={cx("flex size-10 shrink-0 items-center justify-center rounded-[6px] border bg-bg", picker ? "border-accent" : "border-line hover:border-muted")}>
              <SpaceIcon space={{ icon: icon || KIND_ICON[kind], name, color, kind }} size={15} />
            </button>
            <SpaceIconPicker open={picker} onClose={() => setPicker(false)} phone={phone} anchor={iconBtn.current} icon={icon || KIND_ICON[kind]} color={color} name={name} kind={kind}
              onChange={(ic, c) => { setIcon(ic); setColor(c); }} />
            <input autoFocus aria-label={t("Name")} className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.metaKey && !e.ctrlKey && create()}
              placeholder={kind === "course" ? t("e.g. Linear Algebra (MIT 18.06)") : kind === "project" ? t("e.g. Build my portfolio") : t("e.g. Arabic")} dir="auto" />
          </div>
          <span className="font-medium text-muted">{t("Colour")}</span>
          <div className="flex flex-wrap gap-2.5">
            {Object.entries(PRESETS).map(([k, c]) => (
              <button key={k} aria-label={t("Colour {name}", { name: k })} aria-pressed={color === k} onClick={() => setColor(color === k ? null : k)} className="size-6 rounded-full"
                style={{ background: c, boxShadow: color === k ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : undefined }} />
            ))}
          </div>
          {templates.length > 1 && (
            <>
              <span className="font-medium text-muted">{t("Template")}</span>
              <label className="relative flex h-10 items-center gap-2 rounded-[6px] border border-line bg-bg px-3 focus-within:border-accent">
                <MapIcon size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{t(tpl.name)}{tpl.detail ? ` — ${t(tpl.detail, { n: tpl.n })}` : ""}</span>
                <span className="text-[12px] text-muted">{t("optional")}</span>
                <ChevronDown size={14} className="shrink-0 text-muted" />
                <select aria-label={t("Template")} className="absolute inset-0 cursor-pointer opacity-0" value={Math.min(preset, templates.length - 1)} onChange={(e) => setPreset(Number(e.target.value))}>
                  {templates.map((p, i) => <option key={i} value={i}>{t(p.name)}{p.detail ? ` — ${t(p.detail, { n: p.n })}` : ""}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="mx-5 mt-4 border-t border-line pt-3.5 md:mx-6">
          <button onClick={() => setMore((x) => !x)} aria-expanded={more} className="flex items-center gap-2 text-muted hover:text-ink">
            {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="font-medium">{t("More details")}</span><span className="text-[12px]">{details}</span>
          </button>
          {more && (
            <div className="grid grid-cols-1 gap-3 pt-3.5 sm:grid-cols-2">
              {kind === "project" && <>
                <DetailField label={t("Goal")}><input className={fieldCls} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("What does done look like?")} dir="auto" /></DetailField>
                <DetailField label={t("Deadline")}><input type="date" className={fieldCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></DetailField>
              </>}
              {kind === "course" && <>
                <DetailField label={t("Provider")}><input className={fieldCls} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={t("e.g. Coursera · Stanford Online")} /></DetailField>
                <DetailField label={t("Course URL")}><input className={fieldCls} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></DetailField>
                <DetailField label={t("Target date")}><input type="date" className={fieldCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></DetailField>
              </>}
              <div className={kind === "course" ? "" : "sm:col-span-2"}><DetailField label={t("Description")}><input className={fieldCls} value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" /></DetailField></div>
            </div>
          )}
        </div>
        <span className="flex-1" />
        <div className={cx("flex justify-end gap-2 py-5", pad)}>
          <button className={btnGhost} onClick={close}>{t("Cancel")}</button>
          <button className={btnPrimary} onClick={create} disabled={!name.trim()}>{t("Create space")} <span dir="ltr" className="font-mono text-[11px] font-medium opacity-65">{isMac ? "⌘" : "Ctrl"}↵</span></button>
        </div>
      </div>
    </Modal>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{label}</span>{children}</label>;
}

const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;
function importSummary(r: ImportResult) {
  const parts = [r.notes || !r.replaced ? `Imported ${plural(r.notes, "note")}` : "", r.replaced ? `${r.notes ? "replaced" : "Replaced"} ${plural(r.replaced, "note")}` : ""].filter(Boolean);
  return parts.join(", ");
}

type Progress = { done: number; total: number; current: string };
type ImportJob = { name: string; spaceId: string; p: Progress; ctl: AbortController; background: boolean };

/** Parse "ml → machine-learning, old=new" into a tag map. */
function parseTagMap(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/[,;\n]+/)) {
    const m = /^\s*#?([^\s=→>-][^=→>]*?)\s*(?:=|→|->)\s*#?(\S+)\s*$/.exec(part);
    if (m) out[m[1].trim().toLowerCase()] = m[2].toLowerCase();
  }
  return out;
}

const IMPORT_SOURCES: { I: typeof FileText; n: string; d: string; accept: string }[] = [
  { I: FileText, n: "Markdown files", d: ".md, front-matter aware", accept: ".md,.markdown,.txt" },
  { I: FileArchive, n: "Vault .zip", d: "Obsidian folders preserved", accept: ".zip" },
  { I: LayoutDashboard, n: "Canvas", d: ".canvas (JSON Canvas 1.0)", accept: ".canvas,.excalidraw" },
  { I: Braces, n: "JSON backup", d: "Full restore from Lumen", accept: ".json" },
];

/** Import from other apps: opens the Import dialog (ImportDialog.tsx) on that source. */
const FROM_APPS = { label: "From another app", items: [["anki", "flashcards", "Anki"], ["notion", "database", "Notion"], ["obsidian", "wikilink", "Obsidian"]] as const };

export function ImportExportDialog() {
  const ui = useUI();
  const v = useVault();
  const phone = usePhone();
  const [tab, setTab] = useState<"import" | "export">("import");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [over, setOver] = useState(false);
  const [adv, setAdv] = useState(false);
  const [dups, setDups] = useState<DuplicatePolicy>("rename");
  const [tagMap, setTagMap] = useState("");
  const [target, setTarget] = useState(ui.spaceId === "all" ? "inbox" : ui.spaceId);
  const [fmt, setFmt] = useState<"zip" | "json">("zip");
  const [exp, setExp] = useState<{ p: Progress; kind: "zip" | "json" | "retry" } | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [est, setEst] = useState<ExportEstimate | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const jobRef = useRef<ImportJob | null>(null);
  jobRef.current = job;

  // Default import target follows the current space each time the dialog opens.
  useEffect(() => { if (ui.io && !jobRef.current) setTarget(ui.spaceId === "all" ? "inbox" : ui.spaceId); }, [ui.io, ui.spaceId]);
  // Size + attachment count before export.
  useEffect(() => { if (ui.io && tab === "export") void estimateVaultExport().then(setEst); }, [ui.io, tab, v.notes.length, exported]);
  useEffect(() => { if (ui.io && job?.background) setJob((j) => j && { ...j, background: false }); }, [ui.io]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setUI({ io: false }); if (!jobRef.current) setRes(null); setExported(null); };
  const note = ui.noteId ? v.byId.get(ui.noteId) : undefined;
  const busy = !!job || !!exp;

  async function run(files: File[]) {
    if (!files.length || jobRef.current) return;
    setRes(null);
    const ctl = new AbortController();
    const j: ImportJob = { name: files.length === 1 ? files[0].name : `${files.length} files`, spaceId: target, p: { done: 0, total: 0, current: files[0].name }, ctl, background: false };
    setJob(j);
    try {
      const r = await importFiles(files, target, null, {
        duplicates: dups, tagMap: parseTagMap(tagMap), signal: ctl.signal,
        onProgress: (done, total, current) => setJob((x) => x && { ...x, p: { done, total, current } }),
      });
      setRes(r);
      toast(r.cancelled ? `Import cancelled after ${r.notes} notes` : importSummary(r));
    } catch (e) { toast(`Import failed: ${(e as Error).message}`); } finally { setJob(null); }
  }
  function pick(accept: string) {
    if (!input.current) return;
    input.current.accept = accept;
    input.current.click();
  }

  async function doExport(kind: "zip" | "json") {
    setFmt(kind);
    setExported(null);
    const date = new Date().toISOString().slice(0, 10);
    const t = await chooseSaveTarget(kind === "zip" ? `lumen-vault-${date}.zip` : `lumen-backup-${date}.json`, kind === "zip" ? "application/zip" : "application/json", kind === "zip" ? ".zip" : ".json");
    if (!t) return; // picker cancelled
    setExp({ kind, p: { done: 0, total: 0, current: "" } });
    try {
      const onProgress = (done: number, total: number, current: string) => setExp((x) => x && { ...x, p: { done, total, current } });
      setExported(kind === "zip" ? await exportVaultZip({ target: t, onProgress }) : await exportBackup({ target: t }));
    } catch (e) { toast(`Export failed: ${(e as Error).message}`); } finally { setExp(null); }
  }
  /** "fetch & retry": pull the missing attachments from the server, then export the zip again to the same place. */
  async function retry() {
    if (!exported) return;
    setExp({ kind: "retry", p: { done: 0, total: exported.skipped.length, current: "" } });
    try {
      const still = await fetchMissingAttachments(exported.skipped.map((s) => s.id), (done, total, current) => setExp((x) => x && { ...x, p: { done, total, current } }));
      if (still.length === exported.skipped.length) { toast("Still unreachable. Check your connection or sync, then retry."); return; }
      const t = exported.target.kind === "picker" ? exported.target : (await chooseSaveTarget(exported.file, "application/zip", ".zip")) ?? exported.target;
      setExp({ kind: "zip", p: { done: 0, total: 0, current: "" } });
      setExported(await exportVaultZip({ target: t, onProgress: (done, total, current) => setExp((x) => x && { ...x, p: { done, total, current } }) }));
    } finally { setExp(null); }
  }
  async function reveal() {
    if (!exported) return;
    if (!(await showInFolder(exported.target))) toast(`Saved to your browser's Downloads folder as ${exported.file}. Browsers can't open the folder for you.`);
  }

  const fmtBtn = "flex h-[34px] items-center gap-1.5 rounded-[10px] border border-line px-3 hover:bg-surface-2 disabled:opacity-50";
  const onStyle = { border: "1.5px solid var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" };
  const targetSpace = v.spaceMap.get(job?.spaceId ?? target);
  const pct = (p: Progress) => (p.total ? Math.round((p.done / p.total) * 100) : 0);

  const fileInput = <input ref={input} data-io-input type="file" multiple hidden accept=".md,.markdown,.txt,.canvas,.excalidraw,.zip,.json" onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />;

  const importBody = (
    <div className="flex flex-col gap-4 px-[22px] py-5">
      {!job && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="io-import-sources">
          <span className="text-muted">{FROM_APPS.label}</span>
          {FROM_APPS.items.map(([k, g, n]) => (
            <button key={k} onClick={() => { setUI({ io: false }); openImport(k); }} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-2.5 hover:bg-surface-2">
              <Glyph name={g} size={14} color="var(--accent)" />{n}
            </button>
          ))}
        </div>
      )}
      {phone && !job && !res ? (
        <div className="flex flex-col gap-2.5">
          {IMPORT_SOURCES.map(({ I, n, d, accept }) => (
            <button key={n} onClick={() => pick(accept)} className="flex h-[60px] items-center gap-3 rounded-[12px] border border-line px-3.5 text-left hover:bg-surface-2">
              <I size={20} className="shrink-0 text-muted" /><span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="font-medium">{n}</span><span className="text-[12px] text-muted">{d}</span></span><ChevronRight size={16} className="text-muted" />
            </button>
          ))}
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
          onClick={() => pick(".md,.markdown,.txt,.canvas,.excalidraw,.zip,.json")}
          role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(".md,.markdown,.txt,.canvas,.excalidraw,.zip,.json")}
          className={cx("flex h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-dashed text-muted", over ? "border-accent bg-accent/10" : "border-line hover:border-muted")}
        >
          <Upload size={22} />
          <span className="font-medium text-ink">Drop files or <span className="text-link">browse</span></span>
          <span className="text-[12px]">.md · .zip vault · .canvas · JSON backup</span>
        </div>
      )}
      {job && (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3.5">
          <div className="flex items-center gap-2.5"><FileArchive size={18} className="shrink-0 text-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate font-semibold">{job.name}</span><span className="flex min-w-0 items-center gap-1 truncate text-[12px] text-muted">Into {targetSpace && <SpaceIcon space={targetSpace} size={15} />} {targetSpace?.name} · folders preserved</span></div>
            <span className="shrink-0 font-mono text-[12px] font-medium">{job.p.done.toLocaleString("en-US")} / {job.p.total.toLocaleString("en-US")}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-[var(--border)]"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct(job.p)}%` }} /></div>
          <span className="truncate font-mono text-[12px] text-muted">{job.p.current}</span>
        </div>
      )}
      {res && !job && (
        <ResultCard title={res.cancelled ? `Cancelled · imported ${res.notes} notes` : importSummary(res)}
          stats={[[res.notes, "notes"], [res.folders, "folders"], [res.replaced ?? 0, "replaced"], [res.skipped.length, "skipped", !!res.skipped.length]]}>
          {res.skipped.length > 0 && <span className="text-[12px] text-muted">Skipped: {res.skipped.slice(0, 6).join(", ")}{res.skipped.length > 6 ? "…" : ""}</span>}
        </ResultCard>
      )}
      {(!phone || job || res) && <div className="flex flex-col gap-3">
        <button onClick={() => setAdv((x) => !x)} aria-expanded={adv} className="flex items-center gap-2 text-left text-[12px] text-muted hover:text-ink">
          {adv ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}Advanced · duplicate handling (skip / rename / overwrite as new version), tag mapping
        </button>
        {adv && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 pl-5 text-[12.5px]">
            <span className="text-muted">Into space</span>
            <select disabled={!!job} className="h-8 rounded-[6px] border border-line bg-bg px-2 focus:border-accent focus:outline-none" value={target} onChange={(e) => setTarget(e.target.value)}>{v.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <span className="text-muted">Duplicates</span>
            <div role="radiogroup" aria-label="Duplicates" className="grid grid-cols-3 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px]">
              {([["skip", "Skip"], ["rename", "Rename"], ["overwrite", "Overwrite"]] as const).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={dups === k} disabled={!!job} onClick={() => setDups(k)} className={cx("h-[26px] rounded-[6px]", dups === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
              ))}
            </div>
            <span />
            <span className="-mt-1.5 text-[11.5px] text-muted">{dups === "skip" ? "Same title in the same folder: keep the existing note." : dups === "rename" ? "Keep both: the new one becomes “Title 2”." : "Replace the existing note's text; the old text is kept as a version."}</span>
            <span className="text-muted">Tag mapping</span>
            <input disabled={!!job} className="h-8 rounded-[6px] border border-line bg-bg px-2 font-mono text-[12px] focus:border-accent focus:outline-none" value={tagMap} onChange={(e) => setTagMap(e.target.value)} placeholder="ml → machine-learning, todo → inbox" />
          </div>
        )}
      </div>}
    </div>
  );

  const exportBody = (
    <div className="flex flex-col gap-4 px-[22px] py-5">
      {note && (
        <div className="flex flex-col gap-2"><span className="truncate text-[12px] font-medium text-muted">This note · {note.title || "Untitled"}</span>
          <div className="flex flex-wrap gap-2">
            <button className={fmtBtn} onClick={() => exportNoteMd(note)}><FileText size={14} className="text-muted" />.md</button>
            <button className={fmtBtn} onClick={() => exportNoteHtml(note)}><FileCode size={14} className="text-muted" />.html</button>
            <button className={fmtBtn} onClick={() => printNote(note)}><Printer size={14} className="text-muted" />PDF</button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2"><span className="text-[12px] font-medium text-muted">Whole vault · {v.spaces.length} space{v.spaces.length === 1 ? "" : "s"}</span>
        <div className="flex flex-wrap gap-2">
          <button className={cx(fmtBtn, fmt === "zip" && "border-0 font-semibold")} style={fmt === "zip" ? onStyle : undefined} disabled={busy} onClick={() => doExport("zip")} title="Markdown + .canvas + attachments, Obsidian-compatible"><FileArchive size={14} className={fmt === "zip" ? "" : "text-muted"} />.zip (Obsidian-compatible)</button>
          <button className={cx(fmtBtn, fmt === "json" && "border-0 font-semibold")} style={fmt === "json" ? onStyle : undefined} disabled={busy} onClick={() => doExport("json")} title="Everything incl. history, cards, spaces (not attachment bytes)"><Braces size={14} className={fmt === "json" ? "" : "text-muted"} />JSON backup</button>
        </div>
        {!exported && !exp && est && (
          <span className="text-[12px] text-muted">
            ≈ {fmtBytes(est.bytes)} · {est.notes.toLocaleString("en-US")} notes · {est.canvases} canvases · {est.attachments.toLocaleString("en-US")} attachment{est.attachments === 1 ? "" : "s"}
            {est.missing ? ` (${est.missing} not on this device, fetched during export)` : ""}{canPickFolder() ? " · you choose the folder" : " · saves to Downloads"}
          </span>
        )}
      </div>
      {exp && (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3.5">
          <div className="flex items-center gap-2.5"><FileArchive size={18} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-semibold">{exp.kind === "retry" ? "Fetching attachments" : exp.kind === "zip" ? "Building vault .zip" : "Writing JSON backup"}</span>
            {exp.p.total > 0 && <span className="shrink-0 font-mono text-[12px] font-medium">{exp.p.done.toLocaleString("en-US")} / {exp.p.total.toLocaleString("en-US")}</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-[var(--border)]"><div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${exp.p.total ? pct(exp.p) : 100}%`, opacity: exp.p.total ? 1 : 0.5 }} /></div>
          {exp.p.current && <span className="truncate font-mono text-[12px] text-muted">{exp.p.current}</span>}
        </div>
      )}
      {exported && !exp && (
        <ResultCard title={`Exported ${exported.file}`} right={fmtBytes(exported.bytes)}
          stats={[[exported.notes, "notes"], [exported.canvases, "canvases"], [exported.attachments, "attachments"], [exported.skipped.length, "skipped", exported.skipped.length > 0]]}>
          {exported.skipped.length > 0 && (
            <span className="text-[12px] text-muted">Skipped {exported.skipped.length} attachment{exported.skipped.length === 1 ? "" : "s"} still downloading from Cloudflare D1 — <button className="text-link hover:underline" onClick={() => void retry()}>fetch &amp; retry</button></span>
          )}
        </ResultCard>
      )}
    </div>
  );

  const footer = (
    <div className="flex justify-end gap-2 border-t border-line px-[22px] py-3.5">
      {job ? <>
        <button className={btnGhost} onClick={() => { setJob((j) => j && { ...j, background: true }); setUI({ io: false }); toast(`Importing ${job.name} in the background…`); }}>Run in background</button>
        <button className={btnOutline} onClick={() => job.ctl.abort()}>Cancel</button>
      </> : tab === "export" && exported ? <>
        <button className={btnOutline} onClick={() => void reveal()} title={exported.target.kind === "picker" ? "Opens the folder you saved to" : "Saved to Downloads"}>Show in folder</button>
        <button className={btnPrimary} onClick={close}>Done</button>
      </> : <button className={btnPrimary} onClick={close} disabled={!!exp}>Done</button>}
    </div>
  );

  return (
    <>
      {fileInput}
      <Modal open={ui.io} onClose={close} width={600} phoneHeight="600px" label="Import and export">
        <div className="flex min-h-full flex-col text-[13px] max-md:text-[14px]">
          {phone ? (
            <>
              <div className="flex justify-center pb-1 pt-2.5"><span className="h-1 w-9 rounded-[2px] bg-[var(--border)]" /></div>
              <div className="px-5 pt-2 text-[18px] font-[650]">Import &amp; export</div>
              <div role="tablist" className="mx-5 mt-3.5 grid grid-cols-2 gap-0.5 rounded-[10px] border border-line bg-bg p-[3px]">
                {(["import", "export"] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("h-10 rounded-[8px] capitalize", tab === k ? "bg-surface-2 font-semibold" : "text-muted")}>{k}</button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center px-[22px] pt-[18px]"><span className="flex-1 text-[18px] font-[650]">Import &amp; export</span>
                <button aria-label="Close" onClick={close} className="-m-1 rounded-md p-1 text-ink hover:bg-surface-2"><X size={18} /></button></div>
              <div role="tablist" className="flex gap-5 border-b border-line px-[22px] pt-3.5">
                {(["import", "export"] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("-mb-px border-b-2 pb-2.5 capitalize", tab === k ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>{k}</button>
                ))}
              </div>
            </>
          )}
          <div className={phone ? "[&>div]:px-5 [&>div]:py-4" : ""}>{tab === "import" ? importBody : exportBody}</div>
          {phone && <span className="flex-1" />}
          {phone && tab === "import" && !job && !res && <div className="px-5 pb-3 text-center text-[12.5px] text-muted">Tip: share a .md file to Lumen from any app.</div>}
          {(!phone || job || res || tab === "export") && footer}
        </div>
      </Modal>
    </>
  );
}

function ResultCard({ title, right, stats, children }: { title: string; right?: string; stats: [number, string, boolean?][]; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] p-3.5" style={{ background: "color-mix(in srgb, var(--success) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--success) 28%, transparent)" }}>
      <div className="flex items-center gap-2.5"><CircleCheck size={18} className="shrink-0 text-ok" /><span className="min-w-0 flex-1 truncate font-semibold">{title}</span>{right && <span className="shrink-0 text-muted">{right}</span>}</div>
      <div className="grid grid-cols-4 gap-2 text-[12px] text-muted">
        {stats.map(([n, l, warn]) => <span key={l}><b className={cx("block text-[16px] font-[650]", warn ? "text-warn" : "text-ink")}>{n.toLocaleString("en-US")}</b>{l}</span>)}
      </div>
      {children}
    </div>
  );
}
