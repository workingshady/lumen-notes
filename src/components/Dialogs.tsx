import { Download, FileArchive, FileJson, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { SPACE_KINDS, type SpaceKind } from "../../shared/types";
import { createSpace } from "../lib/actions";
import { PRESETS } from "../lib/canvas";
import { exportBackup, exportVaultZip, importFiles, type ImportResult } from "../lib/io";
import { go, setUI, toast, useUI, useVault } from "../lib/store";
import { ROADMAP_PRESETS } from "../lib/templates";
import { KIND_LABEL } from "./Sidebar";
import { Button, cx, Field, inputCls, Segmented, Sheet } from "./ui";

const KIND_HINT: Record<SpaceKind, string> = {
  project: "Has a goal and a deadline. Tasks, milestones, done when shipped.",
  area: "Ongoing responsibility with no end date: health, work, a language.",
  course: "Something you're learning, with a roadmap of modules and topics.",
  resource: "Reference material on a topic you care about.",
  archive: "Finished or paused things, kept for search.",
};
const KIND_ICON: Record<SpaceKind, string> = { project: "🚀", area: "🌱", course: "🎓", resource: "📚", archive: "🗄️" };

export function NewSpaceDialog() {
  const ui = useUI();
  const [kind, setKind] = useState<SpaceKind>("course");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [preset, setPreset] = useState(0);
  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [url, setUrl] = useState("");
  const close = () => setUI({ newSpace: false });
  async function create() {
    if (!name.trim()) return;
    const props: Record<string, string> = {};
    if (kind === "project") { if (goal) props.goal = goal; if (deadline) props.deadline = deadline; }
    if (kind === "course") { if (url) props.url = url; if (deadline) props.target = deadline; props.roadmap = ROADMAP_PRESETS[preset].body; }
    const s = await createSpace({ name: name.trim(), kind, icon: icon || KIND_ICON[kind], color, props, sort: Date.now() });
    close();
    setName(""); setGoal(""); setDeadline(""); setUrl(""); setIcon("");
    go(kind === "area" || kind === "resource" ? "notes" : "space", { spaceId: s.id, folderId: null, tag: null });
  }
  return (
    <Sheet open={ui.newSpace} onClose={close} title="New space">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SPACE_KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx("rounded-[10px] border p-2.5 text-left", kind === k ? "border-accent bg-accent/10" : "border-line hover:border-muted")}>
              <div className="text-[13.5px] font-semibold">{KIND_ICON[k]} {KIND_LABEL[k]}</div>
              <div className="text-[11.5px] leading-snug text-muted">{KIND_HINT[k]}</div>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Field label="Icon"><input className={inputCls + " w-16 text-center"} value={icon} placeholder={KIND_ICON[kind]} onChange={(e) => setIcon(e.target.value.slice(0, 4))} /></Field>
          <div className="flex-1"><Field label="Name"><input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder={kind === "course" ? "e.g. Linear Algebra (MIT 18.06)" : kind === "project" ? "e.g. Build my portfolio" : "e.g. Arabic"} /></Field></div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted">Color</span>
          <button onClick={() => setColor(null)} className={cx("size-6 rounded-full border border-line", !color && "ring-2 ring-accent")} />
          {Object.entries(PRESETS).map(([k, c]) => <button key={k} onClick={() => setColor(k)} className={cx("size-6 rounded-full", color === k && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} style={{ background: c }} />)}
        </div>
        {kind === "project" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Goal"><input className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What does done look like?" /></Field>
            <Field label="Deadline"><input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          </div>
        )}
        {kind === "course" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Course URL (optional)"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
              <Field label="Target date"><input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
            </div>
            <Field label="Roadmap starter" hint="You can edit everything later, or ask AI to generate one from the course page.">
              <Segmented value={String(preset)} onChange={(x) => setPreset(Number(x))} options={ROADMAP_PRESETS.map((p, i) => ({ value: String(i), label: p.name }))} className="flex-wrap" />
            </Field>
          </>
        )}
        <Button variant="primary" className="w-full" onClick={create} disabled={!name.trim()}>Create {KIND_LABEL[kind].toLowerCase()}</Button>
      </div>
    </Sheet>
  );
}

export function ImportExportDialog() {
  const ui = useUI();
  const v = useVault();
  const [tab, setTab] = useState<"import" | "export">("import");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [over, setOver] = useState(false);
  const [target, setTarget] = useState(ui.spaceId === "all" ? "inbox" : ui.spaceId);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { setUI({ io: false }); setRes(null); };
  async function run(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try { const r = await importFiles(files, target, null); setRes(r); toast(`Imported ${r.notes} notes`); } catch (e) { toast(`Import failed: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  return (
    <Sheet open={ui.io} onClose={close} title="Import / export">
      <Segmented value={tab} onChange={setTab} options={[{ value: "import", label: "Import" }, { value: "export", label: "Export" }]} className="mb-4" />
      {tab === "import" ? (
        <div className="space-y-3">
          <Field label="Into space">
            <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>{v.spaces.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}</select>
          </Field>
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
            onClick={() => input.current?.click()}
            className={cx("flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-2 border-dashed p-8 text-center", over ? "border-accent bg-accent/10" : "border-line")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload className="text-muted" />}
            <div className="font-medium">Drop files or click to choose</div>
            <div className="text-[12px] text-muted">.md / .markdown / .txt · .canvas · .excalidraw · .zip (Obsidian vault, folders kept) · Lumen .json backup</div>
            <input ref={input} type="file" multiple hidden accept=".md,.markdown,.txt,.canvas,.excalidraw,.zip,.json" onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </div>
          {res && <div className="rounded-[10px] bg-surface-2 p-3 text-[13px]">✓ {res.notes} notes, {res.folders} folders imported.{res.skipped.length ? <div className="text-muted">Skipped: {res.skipped.slice(0, 8).join(", ")}{res.skipped.length > 8 ? "…" : ""}</div> : null}</div>}
        </div>
      ) : (
        <div className="space-y-2">
          <Button className="w-full justify-start" onClick={() => exportVaultZip()}><FileArchive size={16} /> Vault as .zip (Markdown + .canvas + attachments, Obsidian-compatible)</Button>
          <Button className="w-full justify-start" onClick={() => exportBackup()}><FileJson size={16} /> Full backup (.json: everything incl. history, cards, spaces)</Button>
          <p className="pt-2 text-[12px] text-muted"><Download size={12} className="inline" /> Single notes: open a note → ⋯ → Export .md / .html / Print to PDF.</p>
        </div>
      )}
    </Sheet>
  );
}
