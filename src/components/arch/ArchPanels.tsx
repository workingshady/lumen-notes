// Library (left panel / phone sheet, 46C / 46O) and Properties (46L / 46M / 46P), ported from ArchStudio.dc.html
// `libBlocks` and `prBlocks`, wired to the diagram: drag or click a tile to add a node, edit any field in place.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Glyph } from "../Glyph";
import { t, tk } from "../../lib/i18n";
import { openNote, useVault } from "../../lib/store";
import { displayOf, EDGE_STYLE, endsOf, GROUP_KINDS, NODE_KINDS, PRESET, STATUS, type AEdge, type LabelStyle, type ANode, type ArchStatus, type EdgeShape, type EdgeStyle, type Ends } from "../../lib/arch-model";
import { Block, Row, type Item } from "./ArchUi";

// ------------------------------------------------------------------ catalogue (≈80 shapes)
export interface Shape { g: string; l: string; cat: string; group?: boolean }
const S = (cat: string, list: [string, string][], group = false): Shape[] => list.map(([g, l]) => ({ g, l, cat, group }));
export const SHAPES: Shape[] = [
  ...S(tk("Generic"), [["service", "Service"], ["process", "Process"], ["decision", "Decision"], ["terminator", "Start/End"], ["c-note", "Note"], ["text", "Text"], ["image", "Image"], ["note-card", "Note card"], ["diagram", "Diagram card"], ["junction", "Junction"], ["internet", "Internet"], ["on-prem", "On-prem"]]),
  ...S(tk("Compute"), [["service", "Service"], ["server", "Server"], ["function", "Function"], ["container", "Container"], ["pod", "Pod"], ["worker", "Worker"], ["scheduler", "Scheduler"], ["ci", "CI"]]),
  ...S(tk("Data"), [["database", "Database"], ["cache", "Cache"], ["bucket", "Bucket"], ["warehouse", "Warehouse"], ["lake", "Lake"], ["vector-db", "Vector DB"], ["file", "File"], ["registry", "Registry"], ["etl", "ETL"], ["search", "Search"]]),
  ...S(tk("Network"), [["gateway", "Gateway"], ["load-balancer", "LB"], ["cdn", "CDN"], ["dns", "DNS"], ["api", "API"], ["firewall", "Firewall"], ["internet", "Internet"], ["webhook", "Webhook"], ["on-prem", "On-prem"]]),
  ...S(tk("Messaging"), [["queue", "Queue"], ["topic", "Topic"], ["stream", "Stream"], ["email", "Email"], ["sms", "SMS"]]),
  ...S(tk("AI / ML"), [["model", "Model"], ["llm", "LLM"], ["embedding", "Embedding"], ["vector-db", "Vector DB"], ["feature-store", "Feature store"], ["gpu", "GPU"], ["notebook", "Notebook"], ["registry", "Model registry"], ["etl", "Pipeline"]]),
  ...S(tk("Security"), [["lock-shield", "Auth"], ["key", "Key"], ["vault", "Vault"], ["identity", "Identity"], ["firewall", "Firewall"], ["threat", "Threat"], ["trust-boundary", "Trust boundary"]]),
  ...S(tk("Clients"), [["user", "User"], ["team", "Team"], ["browser", "Web client"], ["mobile", "Mobile"], ["desktop", "Desktop"]]),
  ...S(tk("Kubernetes"), [["cluster", "Cluster"], ["namespace", "Namespace"], ["pod", "Pod"], ["container", "Container"], ["load-balancer", "Ingress"], ["registry", "Image registry"]]),
  ...S(tk("SaaS"), [["payment", "Payments"], ["external-system", "External"], ["email", "Email API"], ["monitoring", "Monitoring"], ["logs", "Logs"], ["metrics", "Metrics"], ["alert", "Alerts"], ["repo", "Repo"]]),
  ...S(tk("Boundaries"), [["region", "Region"], ["vpc", "VPC"], ["subnet", "Subnet"], ["zone", "Zone"], ["cluster", "Cluster"], ["namespace", "Namespace"], ["account", "Account"], ["team", "Team"], ["trust-boundary", "Trust"]], true),
];
const RECENT_KEY = "lumen.arch.recent";
export const recentShapes = (): Shape[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Shape[]).slice(0, 3); } catch { return []; } };
export const pushRecent = (s: Shape) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([s, ...recentShapes().filter((x) => x.g !== s.g || x.l !== s.l)].slice(0, 6))); } catch { /* storage off */ } };
const VENDOR_KEY = "lumen.arch.vendor";
export const MIME = "application/x-lumen-arch";

export function Library({ onAdd, sheet, onClose }: { onAdd: (s: Shape) => void; sheet?: boolean; onClose?: () => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState(0);
  const [vendor, setVendor] = useState(() => { try { return localStorage.getItem(VENDOR_KEY) === "1"; } catch { return false; } });
  const [, bump] = useState(0);
  const tile = (s: Shape, mh = "56px"): Item => ({
    g: s.g, l: t(s.l), col: true, bd: "var(--border)", mh, title: t("Drag onto the canvas, or click to add"),
    onClick: () => { pushRecent(s); onAdd(s); bump((x) => x + 1); onClose?.(); },
    draggable: !sheet, onDragStart: (e) => { e.dataTransfer.setData(MIME, JSON.stringify(s)); e.dataTransfer.effectAllowed = "copy"; },
  });
  const by = (cat: string) => SHAPES.filter((s) => s.cat === cat);
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return []; const seen = new Set<string>(); return SHAPES.filter((x) => (x.l.toLowerCase().includes(s) || x.g.includes(s) || t(x.l).toLowerCase().includes(s)) && !seen.has(x.g + x.l) && seen.add(x.g + x.l)); }, [q]);
  const recent = recentShapes();
  const rec = recent.length ? recent : [SHAPES[12], SHAPES[20], SHAPES[39]];
  const blocks: ReactNode[] = [];
  blocks.push(
    <label key="s" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", borderRadius: 8, border: `1px solid ${q ? "var(--accent)" : "var(--border)"}` }}>
      <Glyph name="search" size={17} color={q ? "var(--text)" : "var(--muted)"} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search {n} shapes…", { n: SHAPES.length })} dir="auto" style={{ flex: 1, minWidth: 0, background: "transparent", outline: "none", fontSize: 12.5, color: "var(--text)" }} />
    </label>,
  );
  if (q.trim()) blocks.push(<Block key="r" h={t("Results · {n}", { n: hits.length })} items={hits.map((s, i) => ({ g: s.g, l: t(s.l), sub: t(s.cat), on: i === 0, onClick: () => { pushRecent(s); onAdd(s); onClose?.(); }, draggable: !sheet, onDragStart: (e) => e.dataTransfer.setData(MIME, JSON.stringify(s)) }))} note={hits.length ? undefined : t("No shape matches “{q}”.", { q })} />);
  else {
    blocks.push(<Block key="seg" seg={[t("Architecture"), t("Drawing"), t("Stamps")]} segOn={tab} onSeg={setTab} />);
    if (tab === 0) {
      blocks.push(<Block key="rec" h={t("Recent")} items={rec.map((s) => tile(s))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="cmp" h={t("Compute")} hr="8" items={by("Compute").slice(0, 6).map((s) => tile(s))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="dat" h={t("Data")} hr="10" items={by("Data").slice(0, 6).map((s) => tile(s))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="net" h={t("Network · Messaging")} items={[...by("Network").slice(0, 3), ...by("Messaging").slice(0, 3)].map((s) => tile(s))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="bnd" h={t("Boundaries")} items={[0, 1, 2, 8].map((i) => tile(by("Boundaries")[i], "50px"))} cols="repeat(4,1fr)" />);
      for (const cat of ["AI / ML", "Security", "Clients", "Kubernetes", "SaaS", "Generic"]) blocks.push(<Block key={cat} h={t(cat)} hr={String(by(cat).length)} items={by(cat).map((s) => tile(s))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="v" items={[{ l: t("Vendor icons (AWS · Azure · GCP)"), tog: vendor, onClick: () => { const v = !vendor; setVendor(v); try { localStorage.setItem(VENDOR_KEY, v ? "1" : "0"); } catch { /* */ } } }]} note={vendor ? t("Vendor packs load on demand and are shown unmodified, never recoloured.") : undefined} />);
    } else if (tab === 1) {
      blocks.push(<Block key="b" h={t("Basic")} items={([["rect", "Rect", "process"], ["ellipse", "Ellipse", "terminator"], ["decision", "Diamond", "decision"], ["cylinder", "Cylinder", "database"], ["cloud", "Cloud", "internet"], ["callout", "Callout", "c-note"]] as const).map(([a, b, icon]) => ({ ...tile({ g: icon, l: b, cat: "Drawing" }), g: a }))} cols="repeat(3,1fr)" />);
      blocks.push(<Block key="f" h={t("Flowchart")} items={([["process", "Process"], ["decision", "Decision"], ["terminator", "Start/End"], ["data", "Data"], ["document", "Doc"], ["delay", "Delay"]] as const).map(([a, b]) => tile({ g: a, l: b, cat: "Drawing" }))} cols="repeat(3,1fr)" />);
    } else {
      blocks.push(<Block key="st" h={t("Stamps")} items={(["c-tip", "c-warning", "c-question", "threat", "cost", "sla", "status-live", "status-planned", "pin"] as const).map((g) => tile({ g, l: g.replace(/^c-|status-/, ""), cat: "Stamps" }))} cols="repeat(3,1fr)" />);
    }
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{blocks}</div>;
}

// ------------------------------------------------------------------ properties
function Field({ label, value, onChange, placeholder, align = "end", mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; align?: "end" | "start"; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, fontSize: 12.5 }}>
      <span style={{ flex: 1, whiteSpace: "nowrap" }}>{label}</span>
      <input dir="auto" value={v} placeholder={placeholder ?? "—"} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ minWidth: 0, width: "60%", textAlign: align, background: "transparent", outline: "none", fontSize: 11, color: "var(--muted)", fontFamily: mono ? "'JetBrains Mono',monospace" : undefined }} className="focus:text-ink" />
    </label>
  );
}
function Pick({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, fontSize: 12.5, position: "relative" }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{options.find((o) => o[0] === value)?.[1] ?? value} ▾</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
const linkGlyph = (l: string) => (/^\[\[/.test(l) ? "note" : /^REQ-/i.test(l) ? "requirement" : /^hub:/i.test(l) ? "v-board" : /github|gitlab|\.git|^https?:/i.test(l) ? "repo" : "link");

export function NodeProps({ n, onChange, usedIn, onReuse, phone }: { n: ANode; onChange: (n: ANode) => void; usedIn: number; onReuse: () => void; phone?: boolean }) {
  const v = useVault();
  const ln = n.lumenNode ?? {};
  const set = (p: Partial<typeof ln>) => onChange({ ...n, lumenNode: { ...ln, ...p } } as ANode);
  const [newLink, setNewLink] = useState("");
  const statuses: ArchStatus[] = ["planned", "building", "live", "deprecated"];
  const icons = useMemo(() => [...new Set(SHAPES.filter((s) => !s.group).map((s) => s.g))].map((g) => [g, g] as [string, string]), []);
  const open = (l: string) => {
    const m = /^\[\[([^\]|#]+)/.exec(l);
    if (m) { const hit = v.notes.find((x) => !x.deleted && x.title.toLowerCase() === m[1].split(" · ")[0].trim().toLowerCase()) ?? v.notes.find((x) => !x.deleted && x.title.toLowerCase().startsWith(m[1].split(" · ")[0].trim().toLowerCase())); if (hit) openNote(hit.id); return; }
    if (/^https?:|^[\w.-]+\.\w+\//.test(l)) window.open(/^https?:/.test(l) ? l : `https://${l}`, "_blank", "noopener");
  };
  if (phone) return (
    <>
      <Block items={[{ children: <Pick label={t("Kind")} value={ln.kind ?? "service"} options={NODE_KINDS.map(([k, l]) => [k, t(l)])} onChange={(k) => set({ kind: k, icon: NODE_KINDS.find((x) => x[0] === k)?.[2] })} /> }, { children: <Field label={t("Technology")} value={ln.tech ?? ""} onChange={(x) => set({ tech: x || undefined })} /> }].map((i) => ({ ...i, l: undefined }))} />
      <Block h={t("Status")} seg={statuses.map((s) => t(STATUS[s][2]))} segOn={Math.max(0, statuses.indexOf(ln.status ?? "planned"))} onSeg={(i) => set({ status: statuses[i] })} />
      <Block h={t("Links")} items={(ln.links ?? []).map((l) => ({ g: linkGlyph(l), l, bd: "var(--border)", onClick: () => open(l) }))} cols="1fr 1fr" />
      <Block items={[{ g: "reused-object", l: usedIn > 1 ? t("Used in {n} diagrams", { n: usedIn }) : ln.ref ? t("Reusable object") : t("Make reusable"), on: !!ln.ref, onClick: onReuse }]} />
    </>
  );
  return (
    <>
      <Block gap="4px">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)" }}>
          <Glyph name={ln.icon ?? "service"} size={17} />
          <input dir="auto" key={n.id + displayOf(n)} defaultValue={displayOf(n)} onBlur={(e) => { const x = e.target.value.trim(); if (x && x !== displayOf(n)) onChange({ ...n, text: x, lumenNode: { ...ln, name: x } } as ANode); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ flex: 1, minWidth: 0, background: "transparent", outline: "none", fontWeight: 600, fontSize: 12.5 }} aria-label={t("Name")} />
        </div>
        <Pick label={t("Kind")} value={ln.kind ?? "service"} options={NODE_KINDS.map(([k, l]) => [k, t(l)])} onChange={(k) => set({ kind: k, icon: NODE_KINDS.find((x) => x[0] === k)?.[2] })} />
        <Pick label={t("Icon")} value={ln.icon ?? "service"} options={icons} onChange={(g) => set({ icon: g })} />
        <Field label={t("Technology")} value={ln.tech ?? ""} onChange={(x) => set({ tech: x || undefined })} />
      </Block>
      <Block h={t("Description")}>
        <textarea dir="auto" key={n.id} defaultValue={ln.description ?? ""} placeholder={t("What does it do?")} onBlur={(e) => e.target.value !== (ln.description ?? "") && set({ description: e.target.value || undefined })} onKeyDown={(e) => e.stopPropagation()} rows={2}
          style={{ fontSize: 11.5, lineHeight: "17px", color: "var(--text)", background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8, outline: "none", resize: "vertical", border: "none" }} />
      </Block>
      <Block h={t("Status")} seg={statuses.map((s) => t(STATUS[s][2]))} segOn={ln.status ? statuses.indexOf(ln.status) : -1} onSeg={(i) => set({ status: ln.status === statuses[i] ? undefined : statuses[i] })} />
      <Block h={t("Links")} gap="4px" items={(ln.links ?? []).map((l, i) => ({ g: linkGlyph(l), l, bd: "var(--border)", onClick: () => open(l), children: <span role="button" aria-label={t("Remove link")} onClick={(e) => { e.stopPropagation(); set({ links: (ln.links ?? []).filter((_, j) => j !== i) }); }} style={{ color: "var(--muted)", padding: "0 2px" }}>×</span> }))}>
        <input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder={t("Add a link: [[Note]], REQ-4, repo URL…")} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && newLink.trim()) { set({ links: [...(ln.links ?? []), newLink.trim()] }); setNewLink(""); } }}
          style={{ minHeight: 30, padding: "0 8px", borderRadius: 8, border: "1px dashed var(--border)", background: "transparent", outline: "none", fontSize: 12 }} />
      </Block>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
        <Field label={t("Owner")} value={ln.owner ?? ""} onChange={(x) => set({ owner: x || undefined })} />
        <Field label={t("Cost")} value={ln.cost ?? ""} onChange={(x) => set({ cost: x || undefined })} />
        <Field label={t("SLA")} value={ln.sla ?? ""} onChange={(x) => set({ sla: x || undefined })} />
        <Field label={t("Tags")} value={(ln.tags ?? []).join(" ")} onChange={(x) => set({ tags: x.split(/\s+/).filter(Boolean).map((s) => (s.startsWith("#") ? s : `#${s}`)) })} />
      </div>
      <Block items={[{ g: "reused-object", l: ln.ref ? t("Used in {n} diagram|Used in {n} diagrams", { n: Math.max(1, usedIn) }) : t("Make reusable"), sub: ln.ref ? t("edits update all") : t("insert it in other diagrams"), on: !!ln.ref, onClick: onReuse }]} />
    </>
  );
}

export function GroupProps({ n, onChange, inside }: { n: ANode; onChange: (n: ANode) => void; inside: number }) {
  const lg = n.lumenGroup ?? { kind: "region" };
  const set = (p: Partial<typeof lg>) => onChange({ ...n, lumenGroup: { ...lg, ...p } } as ANode);
  return (
    <>
      <Block>
        <Field label={t("Name")} value={displayOf(n)} onChange={(x) => x && onChange({ ...n, label: x, lumenGroup: { ...lg, name: x } } as ANode)} />
        <Field label={t("Label")} value={lg.sub ?? ""} onChange={(x) => set({ sub: x || undefined })} placeholder="eu-west-1" />
      </Block>
      <Block h={t("Kind")} items={GROUP_KINDS.map(([k, l, c]) => ({ g: k, gc: c, l: t(l), bd: c, mh: "34px", on: lg.kind === k, onClick: () => set({ kind: k, icon: undefined }) }))} cols="1fr 1fr 1fr" note={t("Nestable. Collapse a group into a summary node with an “N inside” chip.")} />
      <Block items={[{ g: "chevron-down", l: lg.collapsed ? t("Expand ({n} inside)", { n: inside }) : t("Collapse into a summary node"), tog: !!lg.collapsed, onClick: () => set({ collapsed: !lg.collapsed }) }]} />
    </>
  );
}

/** Colour swatches (preset palette, "none" = the default look). */
function Swatches({ label, value, onPick }: { label: string; value?: string; onPick: (c: string | undefined) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 8px", fontSize: 12.5 }}>
      <span style={{ flex: 1, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ display: "flex", gap: 5 }}>
        <button type="button" aria-label={t("Default")} title={t("Default")} aria-pressed={!value} onClick={() => onPick(undefined)} style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${!value ? "var(--accent)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}><Glyph name="not-allowed" size={11} /></button>
        {Object.entries(PRESET).map(([k, c]) => <button key={k} type="button" aria-label={c} aria-pressed={value === k} onClick={() => onPick(k)} style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: `2px solid ${value === k ? "var(--text)" : "transparent"}`, boxSizing: "border-box" }} />)}
      </span>
    </div>
  );
}
/** Label look: style, size, bold, placement, rotation, show / hide, colours and the protocol chip (the panel and the label popover share it). */
export function LabelOptions({ e, onChange, pop }: { e: AEdge; onChange: (e: AEdge) => void; pop?: boolean }) {
  const ls: LabelStyle = e.lumenEdge?.labelStyle ?? {};
  const set = (p: Partial<LabelStyle>) => { const next = { ...ls, ...p }; for (const k of Object.keys(next) as (keyof LabelStyle)[]) if (next[k] === undefined) delete next[k]; onChange({ ...e, lumenEdge: { ...e.lumenEdge, labelStyle: next } }); };
  const kinds = ["plain", "pill", "boxed"] as const, sizes = ["S", "M", "L"] as const, places = ["on", "above", "below"] as const;
  const hasChip = !!(e.lumenEdge?.protocol || e.lumenEdge?.port);
  return (
    <>
      <Block h={t("Label style")} seg={[t("Plain"), t("Pill"), t("Boxed")]} segOn={kinds.indexOf(ls.kind ?? "plain")} onSeg={(i) => set({ kind: kinds[i] })} />
      <Block h={t("Size")} seg={["S", "M", "L"]} segOn={sizes.indexOf(ls.size ?? "M")} onSeg={(i) => set({ size: sizes[i] })} />
      <Block h={t("Placement")} seg={[t("On the line"), t("Above"), t("Below")]} segOn={places.indexOf(ls.place ?? "on")} onSeg={(i) => set({ place: places[i] })} />
      <Block gap="2px" items={[
        { g: "text", l: t("Bold"), tog: !!ls.bold, onClick: () => set({ bold: ls.bold ? undefined : true }) },
        { g: "path-curved", l: t("Follow the line"), tog: !!ls.follow, onClick: () => set({ follow: ls.follow ? undefined : true }) },
        { g: ls.hidden ? "eye-off" : "eye", l: t("Show label"), tog: !ls.hidden, onClick: () => set({ hidden: ls.hidden ? undefined : true }) },
        ...(hasChip ? [{ g: "tag", l: t("Protocol · port chip"), tog: ls.chip !== false, onClick: () => set({ chip: ls.chip === false ? undefined : false }) }] : []),
      ]} />
      {!pop && <Block gap="0"><Swatches label={t("Text colour")} value={ls.color} onPick={(c) => set({ color: c })} /><Swatches label={t("Background")} value={ls.bg} onPick={(c) => set({ bg: c })} /></Block>}
    </>
  );
}

export function EdgeProps({ e, onChange, names }: { e: AEdge; onChange: (e: AEdge) => void; names: [string, string] }) {
  const le = e.lumenEdge ?? {};
  const styles: EdgeStyle[] = ["sync", "async", "data", "control"], shapes: EdgeShape[] = ["straight", "orthogonal", "curved"], ends: Ends[] = ["none", "one", "both"];
  const setLe = (p: Partial<typeof le>) => onChange({ ...e, lumenEdge: { ...le, ...p, ...(p.shape ? { points: undefined, pointsKey: undefined, manual: undefined } : {}) } });
  const setLabels = (p: { start?: string; mid?: string; end?: string }) => { const l = { ...le.labels, ...p }; for (const k of Object.keys(l) as (keyof typeof l)[]) if (!l[k]) delete l[k]; setLe({ labels: Object.keys(l).length ? l : undefined }); };
  const shaped = !!(le.points?.length || le.manual);
  return (
    <>
      <Row it={{ g: "connector", l: `${names[0]} → ${names[1]}`, bd: "var(--border)", fw: 600 }} />
      <Block h={t("Labels")} gap="0">
        <Field label={t("Label")} value={e.label ?? ""} onChange={(x) => onChange({ ...e, label: x || undefined, lumenEdge: { ...le, ...(x || le.labels?.mid ? { labels: { ...le.labels, mid: x || undefined } } : {}) } })} placeholder="HTTPS · 443 · JSON" />
        <Field label={t("Start label")} value={le.labels?.start ?? ""} onChange={(x) => setLabels({ start: x })} />
        <Field label={t("End label")} value={le.labels?.end ?? ""} onChange={(x) => setLabels({ end: x })} />
      </Block>
      <LabelOptions e={e} onChange={onChange} />
      <Block h={t("Route")} gap="2px" items={[
        { g: "undo", l: t("Reset route"), sub: shaped ? t("manual") : t("auto"), op: shaped ? 1 : 0.5, onClick: shaped ? () => setLe({ points: undefined, pointsKey: undefined, manual: undefined }) : undefined },
        ...(le.labelPos != null ? [{ g: "undo", l: t("Reset label position"), onClick: () => setLe({ labelPos: undefined }) }] : []),
      ]} note={t("Select a line, then drag the dots to bend it: a midpoint adds a point, double-click a point to remove it. Drag a label along the line; drag an end onto another node or side to reconnect.")} />
      <Block h={t("Connection")} gap="2px" items={styles.map((s) => ({ g: `edge-${s}`, gc: EDGE_STYLE[s][0], l: t(EDGE_STYLE[s][2]), on: (le.style ?? "sync") === s, onClick: () => setLe({ style: s }) }))} />
      <Block h={t("Shape")} seg={[t("Straight"), t("Orthogonal"), t("Curved")]} segOn={shapes.indexOf(le.shape ?? "orthogonal")} onSeg={(i) => setLe({ shape: shapes[i] })} />
      <Block h={t("Ends")} seg={[t("None"), t("One"), t("Both")]} segOn={ends.indexOf(endsOf(e))} onSeg={(i) => { const { fromEnd: _f, toEnd: _t, ...rest } = e; onChange({ ...rest, ...(ends[i] === "both" ? { fromEnd: "arrow" } : {}), ...(ends[i] === "none" ? { toEnd: "none" } : {}) }); }} />
      <Field label={t("Protocol")} value={le.protocol ?? ""} onChange={(x) => setLe({ protocol: x || undefined })} />
      <Field label={t("Port")} value={le.port ? String(le.port) : ""} onChange={(x) => setLe({ port: Number(x) || undefined })} />
      <Block items={[{ g: "port", l: t("Ports on 4 sides"), sub: e.fromSide || e.toSide ? `${e.fromSide ?? "auto"} → ${e.toSide ?? "auto"}` : t("auto") , onClick: () => { const { fromSide: _a, toSide: _b, ...rest } = e; onChange(rest); } }]} note={t("Drag from a node's side dot to pin a port; click to reset to automatic.")} />
    </>
  );
}
