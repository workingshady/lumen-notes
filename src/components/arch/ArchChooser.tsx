// Diagram types chooser (frames 46A / 46B, R6Parts part "archsub"): "New visual › Architecture & diagrams" opens it.
// Picking a type creates a canvas note with that type's starter content and opens it in the studio.
// `openArchitectureChooser(where)` mounts it on demand (its own root), so any caller can open it without a host component.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Glyph } from "../Glyph";
import { t, useLang } from "../../lib/i18n";
import { openNote, toast } from "../../lib/store";
import { createArchNote, DIAGRAM_TYPES } from "../../lib/arch-starters";
import { detectPaste, toDsl } from "../../lib/arch-convert";
import type { ArchKind } from "../../lib/arch-model";
import { TemplatesGallery } from "../TemplatesGallery";
import { archAiDescribe } from "./ai-hooks";
import { AC } from "./ArchUi";

export type ChooserWhere = { spaceId: string; folderId: string | null };
let root: Root | null = null, host: HTMLDivElement | null = null;
/** Open the "New diagram" chooser (46A). `where` = the space / folder the new diagram is saved in. */
export function openArchitectureChooser(where: ChooserWhere) {
  if (!host) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); }
  const close = () => root?.render(<></>);
  root!.render(<ArchChooser key={Date.now()} where={where} onClose={close} />);
}

function Panel({ g, title, w, children }: { g: string; title: string; w: string; children: ReactNode }) {
  return (
    <div style={{ width: w, boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--border)" }}><Glyph name={g} size={16} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{title}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 14px" }}>{children}</div>
    </div>
  );
}
const row = (on: boolean): React.CSSProperties => ({ position: "relative", display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 8px", borderRadius: 8, background: on ? AC : "transparent", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, color: "var(--text)", fontSize: 12.5, width: "100%", textAlign: "start" });

export function ArchChooser({ where, onClose }: { where: ChooserWhere; onClose: () => void }) {
  useLang();
  const [cur, setCur] = useState<ArchKind>("architecture");
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const phone = innerWidth < 640;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !tpl) onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose, tpl]);
  const make = async (kind: ArchKind, dsl?: string, title?: string) => {
    if (busy) return;
    setBusy(true);
    try { const n = await createArchNote(kind, where, { dsl, title }); onClose(); openNote(n.id); }
    catch (e) { toast(t("Couldn't create the diagram: {msg}", { msg: (e as Error).message }), undefined, { icon: "error" }); }
    finally { setBusy(false); }
  };
  const importFile = async (f: File) => {
    const text = await f.text();
    const kind = detectPaste(text);
    if (!kind) { toast(t("Lumen can read Mermaid, draw.io XML and SQL DDL files. Terraform, CloudFormation and OpenAPI need the AI import."), undefined, { icon: "info" }); return; }
    const r = toDsl(text, kind);
    await make(r.archKind ?? "architecture", r.dsl, f.name.replace(/\.[^.]+$/, ""));
  };
  const types = DIAGRAM_TYPES;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--bg)", color: "var(--text)", fontFamily: "Inter,'IBM Plex Sans Arabic',system-ui,sans-serif", fontSize: 13, display: "flex", flexDirection: "column", overflow: "auto", animation: "arch-fade .16s var(--ease)" }}>
      <style>{"@keyframes arch-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 28px 0" }}>
        <span style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-.01em" }}>{t("New diagram")}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1 }}>{t("Architecture & diagrams › choose a type")}</span>
        <button aria-label={t("Close")} onClick={onClose} className="flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2" style={{ fontSize: 18 }}>×</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, padding: phone ? 16 : "20px 28px 28px", alignItems: "flex-start", alignContent: "flex-start" }}>
        <Panel g="diagram" title={t("Diagram type")} w="100%">
          <div style={{ display: "grid", gridTemplateColumns: phone ? "repeat(2,1fr)" : "repeat(6,1fr)", gap: 8 }}>
            {types.map(([k, l, sub, g]) => (
              <button key={k} disabled={busy} onMouseEnter={() => setCur(k)} onFocus={() => setCur(k)} onClick={() => void make(k)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, minHeight: 84, padding: "5px 3px", borderRadius: 8, background: cur === k ? AC : "transparent", border: `1px solid ${cur === k ? "var(--accent)" : "var(--border)"}`, color: "var(--text)", fontSize: 10.5, transition: "background .12s, border-color .12s" }}>
                <Glyph name={g} size={24} />
                <span style={{ fontWeight: 400, fontSize: 11 }}>{t(l)}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{t(sub)}</span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel g="template" title={t("Start from")} w={phone ? "100%" : "420px"}>
          <div style={{ display: "grid", gap: 6 }}>
            {([["template", t("From template"), t("3-tier, RAG, k8s…"), () => setTpl(true)], ["assistant", t("Describe it"), t("AI drafts, you review"), () => archAiDescribe((dsl, type, instr) => make(type ?? "architecture", dsl, instr.length > 48 ? `${instr.slice(0, 48).trim()}…` : instr))], ["export", t("Import"), t("Mermaid · draw.io · IaC · SQL · OpenAPI"), () => file.current?.click()]] as const).map(([g, l, sub, fn]) => (
              <button key={g} style={row(false)} className="hover:bg-surface-2" onClick={fn}><Glyph name={g} size={18} /><span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span><span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{sub}</span></button>
            ))}
          </div>
        </Panel>
        <Panel g="note" title={t("In a note")} w={phone ? "100%" : "460px"}>
          <div style={{ display: "grid", gap: 4 }}>
            {([["code", "/architecture  /diagram  /erd", t("slash")], ["highlight", t("Select text or code › Make a diagram"), ""], ["project", t("Project hub › Diagrams › New architecture"), ""]] as const).map(([g, l, sub]) => (
              <div key={g} style={{ ...row(false), border: "1px solid transparent", minHeight: 40 }}><Glyph name={g} size={18} /><span style={{ flex: 1, whiteSpace: "pre" }}>{l}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</span></div>
            ))}
          </div>
        </Panel>
      </div>
      <input ref={file} type="file" hidden accept=".mmd,.mermaid,.drawio,.xml,.sql,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
      <TemplatesGallery open={tpl} where={where} onClose={() => setTpl(false)} onPicked={onClose} />
    </div>
  );
}
