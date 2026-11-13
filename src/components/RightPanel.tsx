import { diffLines } from "diff";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, History, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { NOTE_TYPES, STATUSES, type Note, type Version } from "../../shared/types";
import { restoreVersion, snapshot, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { db } from "../lib/db";
import { outline } from "../lib/parse";
import { openNote, setUI, toast, useUI, useVault, type Panel } from "../lib/store";
import { getSelectionText, insertText, scrollEditorToLine } from "./Editor";
import { Preview } from "./Preview";
import { Button, cx, IconButton, inputCls, relTime, Segmented } from "./ui";

export function RightPanel({ note }: { note: Note }) {
  const { panel } = useUI();
  if (!panel) return null;
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-surface md:static md:z-auto md:w-[320px] md:shrink-0 md:border-l md:border-line fade-in">
      <div className="safe-t flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Segmented<Exclude<Panel, null>>
          value={panel}
          onChange={(p) => setUI({ panel: p })}
          className="flex-1 overflow-x-auto"
          options={[
            { value: "outline", label: "Outline" },
            { value: "backlinks", label: "Links" },
            { value: "properties", label: "Info" },
            { value: "versions", label: "History" },
            { value: "ai", label: <Sparkles size={13} />, title: "AI assist" },
          ]}
        />
        <IconButton label="Close panel" onClick={() => setUI({ panel: null })}><X size={17} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {panel === "outline" && <Outline note={note} />}
        {panel === "backlinks" && <Backlinks note={note} />}
        {panel === "properties" && <Properties note={note} />}
        {panel === "versions" && <Versions note={note} />}
        {panel === "ai" && <AI note={note} />}
      </div>
    </aside>
  );
}

function Outline({ note }: { note: Note }) {
  const hs = useMemo(() => outline(note.body), [note.body]);
  if (!hs.length) return <p className="text-[13px] text-muted">No headings yet. Use <code>#</code>, <code>##</code>, <code>###</code>.</p>;
  return (
    <nav className="space-y-0.5">
      {hs.map((h) => (
        <button key={h.line} onClick={() => { scrollEditorToLine(h.line); document.querySelector(`.prose [data-line="${h.line}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className="block w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-ink" style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
          {h.text}
        </button>
      ))}
    </nav>
  );
}

function Backlinks({ note }: { note: Note }) {
  const v = useVault();
  const back = (v.backlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  const out = (v.outlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  // Unlinked mentions: notes that mention this title in plain text but don't link it.
  const mentions = note.title.length > 3 ? v.notes.filter((n) => n.id !== note.id && !back.includes(n) && n.body.toLowerCase().includes(note.title.toLowerCase())).slice(0, 20) : [];
  const List = ({ title, items }: { title: string; items: Note[] }) => (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{title} · {items.length}</div>
      {items.length ? items.map((n) => (
        <button key={n.id} onClick={() => openNote(n.id)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">{n.title}</button>
      )) : <div className="px-2 text-[12.5px] text-muted">None</div>}
    </div>
  );
  return (<><List title="Backlinks" items={back} /><List title="Links out" items={out} /><List title="Unlinked mentions" items={mentions} /></>);
}

function Properties({ note }: { note: Note }) {
  const v = useVault();
  const [k, setK] = useState("");
  const words = (note.body.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const setProp = (key: string, val: string | null) => {
    const props = { ...note.props };
    if (val === null) delete props[key]; else props[key] = val;
    void updateNote(note.id, { props });
  };
  const row = "flex items-center gap-2 text-[13px]";
  return (
    <div className="space-y-3">
      <div className={row}><span className="w-20 text-muted">Type</span>
        <select className={inputCls + " h-8"} value={note.type} onChange={(e) => void updateNote(note.id, { type: e.target.value as Note["type"] })}>
          {NOTE_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select></div>
      <div className={row}><span className="w-20 text-muted">Status</span>
        <select className={inputCls + " h-8"} value={note.status ?? ""} onChange={(e) => void updateNote(note.id, { status: (e.target.value || null) as Note["status"] })}>
          <option value="">none</option>{STATUSES.map((t) => <option key={t}>{t}</option>)}
        </select></div>
      <div className={row}><span className="w-20 text-muted">Space</span>
        <select className={inputCls + " h-8"} value={note.spaceId} onChange={(e) => void updateNote(note.id, { spaceId: e.target.value, folderId: null })}>
          {v.spaces.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
        </select></div>
      <div className={row}><span className="w-20 text-muted">Folder</span>
        <select className={inputCls + " h-8"} value={note.folderId ?? ""} onChange={(e) => void updateNote(note.id, { folderId: e.target.value || null })}>
          <option value="">(root)</option>
          {v.folders.filter((f) => f.spaceId === note.spaceId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></div>
      <div className={row}><span className="w-20 text-muted">Tags</span>
        <input className={inputCls + " h-8"} defaultValue={note.tags.join(" ")} key={note.tags.join(" ")} placeholder="tag another-tag"
          onBlur={(e) => void updateNote(note.id, { tags: [...new Set(e.target.value.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean))] })} /></div>
      <div className="border-t border-line pt-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Properties</div>
        {Object.entries(note.props).map(([key, val]) => (
          <div key={key} className={row + " mb-1"}>
            <span className="w-20 truncate text-muted" title={key}>{key}</span>
            <input className={inputCls + " h-8"} defaultValue={val} onBlur={(e) => setProp(key, e.target.value)} />
            <IconButton label="Remove" onClick={() => setProp(key, null)}><Trash2 size={14} /></IconButton>
          </div>
        ))}
        <form className={row} onSubmit={(e) => { e.preventDefault(); if (k.trim()) { setProp(k.trim(), ""); setK(""); } }}>
          <input className={inputCls + " h-8"} value={k} onChange={(e) => setK(e.target.value)} placeholder="Add property (course, source, due…)" />
          <IconButton label="Add" type="submit"><Plus size={16} /></IconButton>
        </form>
      </div>
      <div className="space-y-1 border-t border-line pt-3 text-[12.5px] text-muted">
        <div>{words} words · {Math.max(1, Math.round(words / 220))} min read</div>
        <div>Created {new Date(note.createdAt).toLocaleString()}</div>
        <div>Updated {new Date(note.updatedAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

function Versions({ note }: { note: Note }) {
  const versions = useLiveQuery(() => db.versions.where("noteId").equals(note.id).reverse().sortBy("createdAt"), [note.id]) ?? [];
  const live = versions.filter((v) => !v.deleted);
  const [sel, setSel] = useState<Version | null>(null);
  const [label, setLabel] = useState("");
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await snapshot(note, label || "Manual save"); setLabel(""); toast("Version saved"); }}>
        <input className={inputCls + " h-8"} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
        <Button size="sm" type="submit"><History size={14} /> Save</Button>
      </form>
      {sel ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <button className="text-link" onClick={() => setSel(null)}>← All versions</button>
            <span className="text-muted">{new Date(sel.createdAt).toLocaleString()}</span>
          </div>
          <Diff from={sel.body} to={note.body} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={async () => { await restoreVersion(sel); setSel(null); toast("Restored as a new version"); }}>Restore as new version</Button>
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(sel.body); toast("Copied"); }}><Copy size={13} /> Copy</Button>
          </div>
        </div>
      ) : live.length ? (
        live.map((v, i) => {
          const prev = live[i + 1];
          const delta = v.body.length - (prev?.body.length ?? 0);
          return (
            <button key={v.id} onClick={() => setSel(v)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
              <span className="flex-1 truncate">{v.label || relTime(v.createdAt)}<span className="block text-[11.5px] text-muted">{new Date(v.createdAt).toLocaleString()}</span></span>
              <span className={cx("text-[11.5px] tabular-nums", delta >= 0 ? "text-ok" : "text-bad")}>{delta >= 0 ? "+" : ""}{delta}</span>
            </button>
          );
        })
      ) : (
        <p className="text-[13px] text-muted">Versions are saved automatically while you write (every 2 min at most), and whenever you click Save.</p>
      )}
    </div>
  );
}

function Diff({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffLines(from, to), [from, to]);
  return (
    <div className="max-h-[50vh] overflow-auto rounded-[8px] border border-line bg-bg font-mono text-[12px] leading-5">
      {parts.map((p, i) => {
        const lines = p.value.replace(/\n$/, "").split("\n");
        if (!p.added && !p.removed && lines.length > 6) {
          return <div key={i} className="px-2 py-0.5 text-muted">… {lines.length} unchanged lines …</div>;
        }
        return lines.map((l, j) => (
          <div key={`${i}-${j}`} className={cx("whitespace-pre-wrap px-2", p.added && "bg-ok/15 text-ok", p.removed && "bg-bad/15 text-bad line-through decoration-bad/40")}>
            {p.added ? "+ " : p.removed ? "− " : "  "}{l}
          </div>
        ));
      })}
      <div className="border-t border-line px-2 py-1 text-[11px] text-muted">red = only in this version · green = only in current</div>
    </div>
  );
}

const AI_ACTIONS = [
  { id: "summarize", label: "Summarize" },
  { id: "flashcards", label: "Make flashcards" },
  { id: "quiz", label: "Quiz me" },
  { id: "explain", label: "Explain selection" },
  { id: "tags", label: "Suggest tags" },
];
function AI({ note }: { note: Note }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!getToken()) return <p className="text-[13px] text-muted">AI runs on Cloudflare Workers AI (free tier). Unlock sync in Settings → Sync to use it.</p>;
  async function run(id: string) {
    const text = id === "explain" ? getSelectionText() || note.body : note.body;
    if (!text.trim()) return toast("Note is empty");
    setBusy(id);
    try { setOut(await aiRun(id, text)); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {AI_ACTIONS.map((a) => (
          <Button key={a.id} size="sm" onClick={() => run(a.id)} disabled={!!busy}>
            {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={13} />} {a.label}
          </Button>
        ))}
      </div>
      {out && (
        <div className="rounded-[10px] border border-line bg-bg p-3 fade-in">
          <Preview note={{ id: note.id, body: out, spaceId: note.spaceId }} className="!text-[14px]" />
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => { if (!insertText("\n\n" + out + "\n", "end")) void updateNote(note.id, { body: note.body + "\n\n" + out + "\n" }); }}>Insert below</Button>
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(out); toast("Copied"); }}>Copy</Button>
          </div>
        </div>
      )}
      <p className="text-[11.5px] text-muted">AI output can be wrong. Check it before you study from it.</p>
    </div>
  );
}
