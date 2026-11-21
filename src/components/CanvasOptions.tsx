// Canvas options panel (design round 7, frames 43A / 43B / 43D): node shape, border, card background, edge path / line /
// heads / width / label, colour (presets + palettes), groups and board background. Desktop = a drawer on the board,
// phone = a full sheet. All data lives in lumen* keys (lib/canvas-style.ts).
import { useState, type ReactNode } from "react";
import { Glyph } from "./Glyph";
import type { GlyphName } from "../lib/glyphs";
import { PRESETS } from "../lib/canvas";
import {
  CANVAS_PALETTES, HEADS, LABEL_STYLES, PATTERNS, SHAPES, type BorderStyle, type FillStyle, type HeadKind, type LabelStyle, type LineStyle, type NodeShape, type Pattern, type PathKind,
} from "../lib/canvas-style";
import { t } from "../lib/i18n";
import { cx } from "./ui";

export interface OptionsProps {
  selNodes: number; selEdges: number;
  node: { shape: NodeShape; border: BorderStyle; fill: FillStyle };
  onNode: (p: Partial<{ shape: NodeShape; border: BorderStyle; fill: FillStyle }>) => void;
  edge: { path: PathKind; line: LineStyle; width: number; from: HeadKind; to: HeadKind; label: LabelStyle };
  onEdge: (p: Partial<{ path: PathKind; line: LineStyle; width: number; from: HeadKind; to: HeadKind; label: LabelStyle }>) => void;
  color: string | null; anySel: boolean; onColor: (c: string | undefined) => void;
  groups: { collapsible: boolean; pattern: Pattern; example: number; portals: boolean };
  onGroups: (p: Partial<{ collapsible: boolean; pattern: Pattern; portals: boolean }>) => void;
  bg: { pattern: Pattern; color?: string }; onBg: (p: { pattern?: Pattern; color?: string | null }) => void;
  /** Hook for W2-A: synced custom palettes (name → colours) shown after the built-in ones. */
  customPalettes?: Record<string, string[]>;
  onPresent: () => void; onExport: () => void; onClose: () => void;
  /** A selected edge has bend points or a moved label; Reset route drops them. */
  routed?: boolean; onResetRoute?: () => void;
}

const AC = "color-mix(in srgb,var(--accent) 18%,transparent)";
const lightTheme = () => { try { const m = /^#?([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()); if (!m) return false; const n = parseInt(m[1], 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) > 140; } catch { return false; } };

// Markup ported 1:1 from R6Parts.dc.html (panel, block heading, segmented control, tile, row, toggle): same inline values.
const ICO: React.CSSProperties = { strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };
function Card({ icon, title, sub, children }: { icon: GlyphName; title: string; sub?: string; children: ReactNode }) {
  return (
    <div style={{ width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--border)" }}><Glyph name={icon} size={16} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{title}</span><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{sub}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 14px" }}>{children}</div>
    </div>
  );
}
const Block = ({ h, children }: { h?: string; children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{h && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}><span>{h}</span></div>}{children}</div>
);
function Seg<T extends string>({ value, opts, onChange, label }: { value: T; opts: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
      {opts.map(([k, l]) => { const on = value === k; return <button key={k} role="radio" aria-checked={on} onClick={() => onChange(k)} style={{ flex: 1, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 600 : 400, whiteSpace: "nowrap", boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", padding: "0 6px" }}>{l}</button>; })}
    </div>
  );
}
function Tile({ glyph, label, on, onClick }: { glyph: GlyphName; label: string; on: boolean; onClick: () => void }) {
  return (
    <button title={label} aria-pressed={on} onClick={onClick} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 58, padding: "6px 4px", borderRadius: 8, background: on ? AC : "transparent", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, color: "var(--text)", fontSize: 10.5, boxSizing: "border-box", minWidth: 0 }}>
      <Glyph name={glyph} size={18} stroke={ICO.strokeWidth as number} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center", lineHeight: 1.35 }}>{label}</span>
    </button>
  );
}
/** A "Value ▾" control that opens a small list. */
function Pick<V extends string>({ value, opts, onChange, align = "end", children }: { value: V; opts: [V, string, GlyphName?][]; onChange: (v: V) => void; align?: "end" | "start"; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const cur = opts.find((o) => o[0] === value);
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{children ?? t(cur?.[1] ?? "")}<span aria-hidden>{"▾"}</span></button>
      {open && (
        <>
          <span style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <span role="listbox" className="fade-in" style={{ position: "absolute", top: "100%", [align === "end" ? "insetInlineEnd" : "insetInlineStart"]: 0, marginTop: 4, zIndex: 50, display: "flex", flexDirection: "column", minWidth: 130, padding: 4, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", boxShadow: "0 12px 30px rgba(0,0,0,.4)" }}>
            {opts.map(([k, l, g]) => <button key={k} role="option" aria-selected={k === value} onClick={() => { onChange(k); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 8px", borderRadius: 7, fontSize: 12.5, whiteSpace: "nowrap", textAlign: "start", color: k === value ? "var(--accent)" : "var(--text)", fontWeight: k === value ? 600 : 400 }}>{g && <Glyph name={g} size={16} />}{t(l)}</button>)}
          </span>
        </>
      )}
    </span>
  );
}
const Row = ({ label, children, glyph }: { label: string; children?: ReactNode; glyph?: GlyphName }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, fontSize: 12.5, boxSizing: "border-box", minWidth: 0 }}>{glyph && <Glyph name={glyph} size={18} />}<span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.35 }}>{label}</span>{children}</div>
);
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange?.(!on)} style={{ width: 30, height: 18, borderRadius: 999, background: on ? "var(--accent)" : "var(--border)", position: "relative", flexShrink: 0, transition: "background .15s ease" }}>
      <span style={{ position: "absolute", top: 2, insetInlineStart: on ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: on ? "var(--accent-fg)" : "var(--muted)", transition: "inset-inline-start .15s ease" }} />
    </button>
  );
}

const BG_COLORS: [string, string][] = [["", "Theme"], ...Object.entries(PRESETS).map(([k], i) => [k, ["Red", "Orange", "Yellow", "Green", "Cyan", "Purple"][i]] as [string, string])];

export function CanvasOptions(p: OptionsProps) {
  const [palName, setPalName] = useState("Lumen ink");
  const [palList, setPalList] = useState(false);
  const light = lightTheme();
  const ALL: Record<string, { dark: string[]; light?: string[] }> = { ...CANVAS_PALETTES, ...Object.fromEntries(Object.entries(p.customPalettes ?? {}).map(([k, v]) => [k, { dark: v }])) };
  const pal = ALL[palName] ?? ALL["Lumen ink"];
  const palColors = light && pal.light ? pal.light : pal.dark;
  const swatch = (key: string, c: string, tip: string) => {
    const on = p.color?.toLowerCase() === key.toLowerCase();
    return <button key={key + c} title={tip} aria-label={tip} aria-pressed={on} onClick={() => p.onColor(on ? undefined : key)} style={{ width: "100%", height: 30, borderRadius: 7, background: c, border: "1px solid var(--border)", boxSizing: "border-box", boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "none", transition: "box-shadow .12s ease" }} />;
  };
  const nSel = p.selNodes ? t("{n} selected", { n: p.selNodes }) : t("New cards");
  const eSel = p.selEdges ? t("{n} selected", { n: p.selEdges }) : t("New links");
  const patOpts = PATTERNS.map(([k, l]) => [k, l] as [Pattern, string]);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 2px" }}>
        <span style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-.01em" }}>{t("Canvas options")}</span>
        <span className="md:hidden" style={{ fontSize: 12.5, color: "var(--muted)", flex: 1, minWidth: 0 }}>{t("JSON Canvas; Lumen extras saved as lumen* keys")}</span>
        <span className="max-md:hidden" style={{ flex: 1 }} />
        <button aria-label={t("Close")} onClick={p.onClose} style={{ display: "flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid var(--border)" }}><Glyph name="x" size={15} /></button>
      </div>


      {/* live previews (design 43A): node shapes on a canvas, and a collapsible group */}
      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1" aria-hidden>
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>{t("Node shapes on a canvas")}</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", height: 44 }}>
            {SHAPES.slice(0, 4).map(([k]) => <span key={k} style={{ flex: 1, height: k === p.node.shape ? 40 : 32, border: `1.5px ${p.node.border} ${k === p.node.shape ? "var(--accent)" : "var(--muted)"}`, borderRadius: k === "circle" ? 999 : k === "rounded" ? 10 : 3, background: p.node.fill === "none" ? "transparent" : "color-mix(in srgb, var(--accent) 14%, var(--surface))" }} />)}
          </div>
        </div>
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>{t("Collapsible group")}</span>
          <div style={{ height: 44, borderRadius: 8, border: "1.5px dashed var(--muted)", position: "relative", backgroundImage: p.groups.pattern === "dots" ? "radial-gradient(color-mix(in srgb, var(--muted) 50%, transparent) 1px, transparent 1.2px)" : p.groups.pattern === "grid" || p.groups.pattern === "lines" ? "linear-gradient(color-mix(in srgb, var(--muted) 25%, transparent) 1px, transparent 1px)" : undefined, backgroundSize: "8px 8px" }}>
            <span style={{ position: "absolute", top: 4, insetInlineStart: 6, fontSize: 10.5, fontWeight: 600 }}>{p.groups.collapsible ? "▾ " : ""}{t("Group")} · {t("{n} card|{n} cards", { n: p.groups.example })}</span>
          </div>
        </div>
      </div>

      <Card icon="rect" title={t("Node shape")} sub={nSel}>
        <div className="grid grid-cols-4 gap-1">{SHAPES.map(([k, l, g]) => <Tile key={k} glyph={g as GlyphName} label={t(l)} on={p.node.shape === k} onClick={() => p.onNode({ shape: k })} />)}</div>
        <Block h={t("Border")}><Seg label={t("Border")} value={p.node.border} onChange={(v) => p.onNode({ border: v })} opts={[["solid", t("Solid")], ["dashed", t("Dashed")], ["dotted", t("Dotted")], ["none", t("None")]]} /></Block>
        <Block h={t("Card background")}><Seg label={t("Card background")} value={p.node.fill} onChange={(v) => p.onNode({ fill: v })} opts={[["none", t("None")], ["tint", t("Tint")], ["solid", t("Solid")]]} /></Block>
      </Card>

      <Card icon="connector" title={t("Edge")} sub={eSel}>
        <Block h={t("Path")}><div className="grid grid-cols-3 gap-1">{([["curved", "Curved", "path-curved"], ["elbow", "Elbow", "path-elbow"], ["straight", "Straight", "path-straight"]] as [PathKind, string, GlyphName][]).map(([k, l, g]) => <Tile key={k} glyph={g} label={t(l)} on={p.edge.path === k} onClick={() => p.onEdge({ path: k })} />)}</div></Block>
        <Block h={t("Line")}><Seg label={t("Line")} value={p.edge.line} onChange={(v) => p.onEdge({ line: v })} opts={[["solid", t("Solid")], ["dashed", t("Dashed")], ["dotted", t("Dotted")]]} /></Block>
        <Block h={t("Heads")}>
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-0.5">
            <Row label={t("Start")} glyph={HEADS.find((h) => h[0] === p.edge.from)![2] as GlyphName}><Pick value={p.edge.from} onChange={(v) => p.onEdge({ from: v })} opts={HEADS.map(([k, l, g]) => [k, l, g as GlyphName])} /></Row>
            <Row label={t("End")} glyph={HEADS.find((h) => h[0] === p.edge.to)![2] as GlyphName}><Pick value={p.edge.to} onChange={(v) => p.onEdge({ to: v })} opts={HEADS.map(([k, l, g]) => [k, l, g as GlyphName])} /></Row>
            <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
              <span>{t("Width")}</span><span className="text-[11px] text-muted">{p.edge.width} px</span>
              <input type="range" min={1} max={8} step={1} value={p.edge.width} aria-label={t("Width")} onChange={(e) => p.onEdge({ width: +e.target.value })} className="lc-range min-w-[50px] flex-1" style={{ ["--v" as string]: `${((p.edge.width - 1) / 7) * 100}%` }} />
            </div>
            <Row label={t("Label")}><Pick value={p.edge.label} onChange={(v) => p.onEdge({ label: v })} opts={LABEL_STYLES.map(([k, l]) => [k, l])} /></Row>
          </div>
        </Block>
        {p.selEdges > 0 && (
          <button disabled={!p.routed} onClick={p.onResetRoute} className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] hover:bg-bg disabled:opacity-50">
            <Glyph name="undo" size={18} /><span style={{ flex: 1 }}>{t("Reset route")}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{p.routed ? t("manual") : t("auto")}</span>
          </button>
        )}
      </Card>

      <Card icon="palette" title={t("Colour")} sub={p.anySel ? undefined : t("New cards")}>
        <Block h={t("Presets 1–6")}><div className="grid grid-cols-6 gap-1">{Object.entries(PRESETS).map(([k, c]) => swatch(k, c, t("Colour {c}", { c: k })))}</div></Block>
        {palName !== "Presets" && <Block h={t(palName)}><div className="grid grid-cols-6 gap-1">{palColors.map((c) => swatch(c, c, c))}</div></Block>}
        <div>
          <button onClick={() => setPalList((o) => !o)} aria-expanded={palList} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 34, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12.5, boxSizing: "border-box" }}><Glyph name="palette" size={18} /><span style={{ flex: 1, textAlign: "start" }}>{t("More palettes")}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{t(palName)} {"▾"}</span></button>
          {palList && (
            <div className="mt-1 flex flex-col gap-0.5 rounded-[8px] border border-line p-1">
              {Object.keys(ALL).map((n) => {
                const cs = (light && ALL[n].light ? ALL[n].light! : ALL[n].dark).slice(0, 5);
                return (
                  <button key={n} onClick={() => { setPalName(n); setPalList(false); }} className={cx("flex h-8 items-center gap-2 rounded-[7px] px-2 text-[12.5px] hover:bg-bg", n === palName && "font-semibold text-accent")}>
                    <span className="h-3.5 w-[54px] rounded-[3px] border border-line" style={{ background: `linear-gradient(90deg,${cs.map((c, i) => `${c} ${(i * 100) / cs.length}% ${((i + 1) * 100) / cs.length}%`).join(",")})` }} />{t(n)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card icon="group" title={t("Groups & canvas")}>
        <div className="flex flex-col gap-0.5">
          <Row label={t("Collapsible groups")}><span className="text-[11px] text-muted">{"“"}{t("{n} card|{n} cards", { n: p.groups.example })}{"”"}</span><Toggle on={p.groups.collapsible} onChange={(v) => p.onGroups({ collapsible: v })} label={t("Collapsible groups")} /></Row>
          <Row label={t("Group pattern")}><Pick value={p.groups.pattern} onChange={(v) => p.onGroups({ pattern: v })} opts={patOpts} /></Row>
          <Row label={t("Canvas background")}><Pick value={p.bg.pattern === "lines" ? "none" : p.bg.pattern} onChange={(v) => p.onBg({ pattern: v })} opts={patOpts.filter((o) => o[0] !== "lines")} /></Row>
          <Row label={t("Background colour")}><Pick value={p.bg.color ?? ""} onChange={(v) => p.onBg({ color: v || null })} opts={BG_COLORS} /></Row>
          <Row label={t("Portals")}><span className="text-[11px] text-muted">{t("canvas cards show their canvas")}</span><Toggle on={p.groups.portals} onChange={(v) => p.onGroups({ portals: v })} label={t("Portals")} /></Row>
          <button onClick={p.onPresent} className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] hover:bg-bg"><Glyph name="present" size={18} />{t("Present groups as slides")}</button>
          <button onClick={p.onExport} className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] hover:bg-bg"><Glyph name="export" size={18} />{t("Export…")}</button>
        </div>
      </Card>
      <style>{`.lc-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--accent) var(--v),var(--border) var(--v));outline:none}.lc-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.4)}.lc-range::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--text)}`}</style>
    </div>
  );
}
