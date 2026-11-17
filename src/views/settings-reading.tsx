import { setSettings, useSettings } from "../lib/settings";
import { Toggle } from "../components/ShareSheet";
import { Segmented } from "../components/ui";

/** Settings › Reading: Focus defaults, highlights and read aloud (text size/width/font live in Appearance). */
export function ReadingSection() {
  const s = useSettings();
  const row = "flex flex-col gap-1.5";
  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div>
        <div className="text-[17px] font-[650]">Reading</div>
        <div className="mt-1 text-[13px] text-muted">Focus mode, the highlighter and read aloud. Text size, width and font are in Appearance and in the Aa menu.</div>
      </div>
      <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-4">
        <div className={row}><span className="text-[13px] font-medium">Focus opens for</span>
          <Segmented value={s.focusMode ?? "read"} onChange={(v) => setSettings({ focusMode: v })} options={[{ value: "read", label: "Reading" }, { value: "write", label: "Writing" }]} />
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1"><div className="text-[13.5px] font-medium">Dim other paragraphs while writing</div><div className="mt-0.5 text-[12.5px] text-muted">Writing focus: only the paragraph with the cursor stays at full contrast (only while typing).</div></div>
          <Toggle on={s.focusDim ?? true} onChange={(v) => setSettings({ focusDim: v })} />
        </div>
        <div className={row}><span className="text-[13px] font-medium">When leaving Focus with highlights</span>
          <Segmented value={s.highlightOnExit ?? "ask"} onChange={(v) => setSettings({ highlightOnExit: v })} options={[{ value: "ask", label: "Ask" }, { value: "save", label: "Save into the note" }, { value: "discard", label: "Discard" }]} />
        </div>
        <div className={row}><span className="text-[13px] font-medium">Read-aloud speed · {s.ttsRate ?? 1}×</span>
          <input type="range" min={0.5} max={3} step={0.25} value={s.ttsRate ?? 1} onChange={(e) => setSettings({ ttsRate: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
        </div>
      </div>
    </div>
  );
}
