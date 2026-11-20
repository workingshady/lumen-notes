// Property-bar popovers (design 36D–G, 45C–D): connector (path · heads per end · line style · label), shape style (fill & stroke ·
// look), text, stickies, stamps and icon insert. Compact, horizontal, never scroll. Every control writes real Excalidraw props
// (startArrowhead / endArrowhead, elbowed / roundness, strokeStyle, fillStyle, roughness, fontFamily…) to the selection and to
// the current-item defaults. Mount: render the matching popover inside the property bar's <Pop> (see register.tsx for the list).
import { useEffect, useState, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { useVaultSelector } from "../../lib/store";
import { ALL_GLYPHS, ICON_COLORS, ICON_GROUPS, STAMPS, getLibraryItem, placeOnBoard, recolourSelectedGlyphs, selectedGlyphColor, setLibPrefs, setLibraryDrag, touchRecent, useLibPrefs, type PlaceOpts } from "../../lib/library-items";
import type { WbCtx } from "../wb/hooks";
import { applyStyle, arrowsOf, common, defaultOf, isBound, isSticky, labelOf, restyle, selectedEls, selectedIds, setArrowLabel, setBound, stackStickies, STICKY_SIZES, withBoundText, type El } from "./apply";
import { Glyph } from "../Glyph";
import { Block, PanelShell, TOKENS, sw, tile, type Blk, type Itm } from "./ui";

function useLive(ctx: WbCtx) {
  const [n, setN] = useState(0);
  const bump = () => setN((x) => x + 1);
  // the board keeps changing under an open popover (selection, undo): re-read on every Excalidraw change tick
  useEffect(() => { const i = setInterval(bump, 600); return () => clearInterval(i); }, []);
  void n;
  const api = ctx.api;
  const done = () => { ctx.save(); setTimeout(bump, 30); };
  const set = (p: Record<string, unknown>) => { if (api) { applyStyle(api, p); done(); } };
  return { api, set, bump, done };
}
const Wrap = ({ w, children }: { w: number; children: ReactNode }) => <div style={{ ...TOKENS, width: w, display: "flex", flexDirection: "column", gap: 14, padding: 4, color: "var(--tx)", fontFamily: "Inter,'IBM Plex Sans Arabic',system-ui,sans-serif", fontSize: 13 }}>{children}</div>;
const Blocks = ({ list }: { list: Blk[] }) => <>{list.map((b, i) => <Block key={b.key ?? i} bk={b} />)}</>;

/** Heading + sub of the design's panel, flat (the Pop supplies the surface). */
const Head = ({ g, title, sub }: { g?: string; title: string; sub?: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 6px", borderBottom: "1px solid var(--bd)" }}>
    {g && <Glyph name={g} size={16} color="var(--mu)" />}<span style={{ fontWeight: 600, fontSize: "13.5px", flex: 1 }}>{title}</span>{sub && <span style={{ fontSize: "11.5px", color: "var(--mu)" }}>{sub}</span>}
  </div>
);

// ------------------------------------------------------------------ connectors (36D, 45C)
const HEADS: [value: string | null, glyph: string, name: string][] = [
  [null, "arrowhead-none", "None"], ["arrow", "arrowhead-arrow", "Arrow"], ["triangle", "arrowhead-triangle", "Triangle"], ["triangle_outline", "arrowhead-triangle-outline", "Tri. outline"],
  ["bar", "arrowhead-bar", "Bar"], ["circle", "arrowhead-dot", "Dot"], ["circle_outline", "arrowhead-dot-outline", "Dot outline"], ["diamond", "arrowhead-diamond", "Diamond"],
  ["diamond_outline", "arrowhead-diamond-outline", "Dia. outline"], ["crowfoot_one", "crowfoot-one", "One"], ["crowfoot_many", "crowfoot-many", "Many"], ["crowfoot_one_or_many", "crowfoot-one-many", "One or many"],
];
export function ConnectorPopover({ ctx }: { ctx: WbCtx }) {
  const { api, set, done } = useLive(ctx);
  const [draft, setDraft] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  if (!api) return null;
  const arrows = arrowsOf(api);
  const type = common(arrows, (e) => (e.elbowed ? "elbow" : e.roundness ? "round" : "sharp")) ?? (defaultOf(api, "arrowType") as string | undefined) ?? "sharp";
  const dash = common(arrows, (e) => e.strokeStyle as string) ?? (defaultOf(api, "strokeStyle") as string | undefined) ?? "solid";
  const width = common(arrows, (e) => e.strokeWidth as number) ?? (defaultOf(api, "strokeWidth") as number | undefined) ?? 2;
  const head = (k: "startArrowhead" | "endArrowhead") => common(arrows, (e) => (e[k] ?? null) as string | null) ?? (arrows.length ? null : ((defaultOf(api, k) as string | null | undefined) ?? (k === "endArrowhead" ? "arrow" : null)));
  const sh = head("startArrowhead"), eh = head("endArrowhead");
  const label = draft ?? labelOf(api, arrows[0]);
  const commit = () => { if (draft != null) { void setArrowLabel(api, draft.trim()).then(done); setDraft(null); } };
  const w3 = [1, 2, 4].indexOf(width);
  const list: Blk[] = [
    { key: "path", h: t("Path"), items: [["path-straight", "Straight", "sharp"], ["path-curved", "Curved", "round"], ["path-elbow", "Elbow", "elbow"]].map(([g, l, v]) => tile(g, t(l), { on: type === v, onClick: () => set({ arrowType: v }) })), cols: "repeat(3,1fr)" },
    { key: "style", h: t("Style"), items: [["stroke-solid", "Solid", "solid"], ["stroke-dashed", "Dashed", "dashed"], ["stroke-dotted", "Dotted", "dotted"]].map(([g, l, v]) => tile(g, t(l), { on: dash === v, onClick: () => set({ strokeStyle: v }) })), cols: "repeat(3,1fr)" },
    { key: "width", h: t("Width"), seg: [t("Thin"), t("Regular"), t("Bold"), t("Custom")], segOn: custom || w3 < 0 ? 3 : w3, onSeg: (i) => { if (i === 3) { setCustom(true); return; } setCustom(false); set({ strokeWidth: [1, 2, 4][i] }); } },
    ...(custom || w3 < 0 ? [{ key: "wcust", items: [{ l: t("Width"), sl: width * 6.25, sub: `${width} px`, onSlide: (v: number) => set({ strokeWidth: Math.max(1, Math.round(v / 6.25)) }) }] }] : []),
    { key: "label", node: (
      <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, border: `1px solid ${draft != null ? "var(--ac)" : "transparent"}` }}>
        <Glyph name="text" size={18} /><span style={{ fontSize: 12.5, flex: "0 0 auto" }}>{t("Label")}</span>
        <input value={label} disabled={!arrows.some((a) => a.type === "arrow")} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); }} placeholder={t("“refracts”")} dir="auto"
          style={{ flex: 1, minWidth: 0, textAlign: "end", background: "transparent", border: 0, outline: 0, color: "var(--tx)", fontSize: 11, fontFamily: "inherit" }} />
      </label>
    ) },
    { key: "bound", items: [{ g: "link", l: t("Bound to shapes"), tog: isBound(api), mh: "34px", onClick: () => { setBound(api, !isBound(api)); done(); } }], note: t("Bound arrows follow their shapes when they move.") },
  ];
  const headList = (k: "startArrowhead" | "endArrowhead", cur: string | null): Blk[] => [{ key: k, items: HEADS.map(([v, g, name]) => tile(g, t(name), { gs: 22, on: cur === v, onClick: () => set({ [k]: v ?? "none" }) })), cols: "repeat(4,1fr)", note: k === "endArrowhead" ? t("Crow’s-foot heads are for ERDs (one, many, one-or-many).") : undefined }];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", maxWidth: "min(1320px, calc(100vw - 48px))" }}>
      <PanelShell title={t("Line")} g="connector" w={420} style={{ boxShadow: "none" }}><Blocks list={list} /></PanelShell>
      <PanelShell title={t("Start head")} g="arrowhead-none" w={420} style={{ boxShadow: "none" }}><Blocks list={headList("startArrowhead", sh)} /></PanelShell>
      <PanelShell title={t("End head")} g="arrowhead-arrow" w={420} style={{ boxShadow: "none" }}><Blocks list={headList("endArrowhead", eh)} /></PanelShell>
    </div>
  );
}

// ------------------------------------------------------------------ shape style (36E/F, 45D)
export function FillStrokePopover({ ctx }: { ctx: WbCtx }) {
  const { api, set } = useLive(ctx);
  if (!api) return null;
  const els = selectedEls(api);
  const fillRaw = common(els, (e) => e.fillStyle as string) ?? (defaultOf(api, "fillStyle") as string | undefined) ?? "solid";
  const bg = common(els, (e) => e.backgroundColor as string) ?? (defaultOf(api, "backgroundColor") as string | undefined) ?? "transparent";
  const fill = bg === "transparent" ? "none" : fillRaw;
  const width = common(els, (e) => e.strokeWidth as number) ?? (defaultOf(api, "strokeWidth") as number | undefined) ?? 2;
  const dash = common(els, (e) => e.strokeStyle as string) ?? (defaultOf(api, "strokeStyle") as string | undefined) ?? "solid";
  const fills: [string, string, string][] = [["fill-none", "None", "none"], ["fill-solid", "Solid", "solid"], ["fill-hachure", "Hachure", "hachure"], ["fill-crosshatch", "Cross", "cross-hatch"], ["fill-zigzag", "Zigzag", "zigzag"], ["fill-dots", "Dots", "dots"]];
  const list: Blk[] = [
    { key: "fill", h: t("Fill"), items: fills.map(([g, l, v]) => tile(g, t(l), { on: fill === v, tag: v === "dots" ? t("Later") : undefined, disabled: v === "dots", op: v === "dots" ? 0.6 : 1,
      onClick: () => { if (v === "none") set({ backgroundColor: "transparent" }); else set({ fillStyle: v, ...(bg === "transparent" ? { backgroundColor: els[0]?.strokeColor && els[0].strokeColor !== "transparent" ? els[0].strokeColor : "#5CC8C2" } : {}) }); } })), cols: "repeat(3,1fr)" },
    { key: "stroke", h: t("Stroke"), items: [["stroke-thin", "Thin", 1], ["stroke-solid", "Regular", 2], ["stroke-bold", "Bold", 4]].map(([g, l, v]) => tile(g as string, t(l as string), { on: width === v, onClick: () => set({ strokeWidth: v }) }))
      .concat([["stroke-solid", "Solid", "solid"], ["stroke-dashed", "Dashed", "dashed"], ["stroke-dotted", "Dotted", "dotted"]].map(([g, l, v]) => tile(g, t(l), { on: dash === v, onClick: () => set({ strokeStyle: v }) }))), cols: "repeat(3,1fr)" },
  ];
  return <Wrap w={340}><Head g="fill-hachure" title={t("Fill & stroke")} /><Blocks list={list} /></Wrap>;
}
export function LookPopover({ ctx }: { ctx: WbCtx }) {
  const { api, set } = useLive(ctx);
  if (!api) return null;
  const els = selectedEls(api);
  const rough = common(els, (e) => e.roughness as number) ?? (defaultOf(api, "roughness") as number | undefined) ?? 1;
  const round = common(els.filter((e) => ["rectangle", "diamond", "image"].includes(e.type)), (e) => (e.roundness ? "round" : "sharp")) ?? (defaultOf(api, "roundnessKind") as string | undefined) ?? "round";
  const op = common(els, (e) => e.opacity as number) ?? (defaultOf(api, "opacity") as number | undefined) ?? 100;
  const list: Blk[] = [
    { key: "rough", h: t("Sloppiness"), items: [["sloppiness-0", "Architect"], ["sloppiness-1", "Artist"], ["sloppiness-2", "Cartoonist"]].map(([g, l], i) => tile(g, t(l), { on: rough === i, onClick: () => set({ roughness: i }) })), cols: "repeat(3,1fr)" },
    { key: "edges", h: t("Edges"), items: [["edges-sharp", "Sharp", "sharp"], ["edges-round", "Round", "round"]].map(([g, l, v]) => tile(g, t(l), { on: round === v, onClick: () => set({ roundness: v }) })), cols: "1fr 1fr" },
    { key: "op", items: [{ l: t("Opacity"), sl: op, sub: `${op}%`, onSlide: (v) => set({ opacity: v }) }] },
  ];
  return <Wrap w={300}><Head g="sloppiness-1" title={t("Look")} /><Blocks list={list} /></Wrap>;
}

// ------------------------------------------------------------------ text (36E)
const FONTS: [name: string, ff: string, sample: string, fs: string, family: number | null][] = [
  ["Hand", "Caveat,cursive", "Light bends", "20px", 5], ["Sans", "Inter", "Light bends", "14px", 6], ["Serif", "'Source Serif 4',serif", "Light bends", "15px", null],
  ["Code", "'JetBrains Mono',monospace", "light_bends()", "13px", 8], ["Arabic", "'IBM Plex Sans Arabic'", "ينكسر الضوء", "14px", null],
];
const SIZES: [string, number][] = [["S", 16], ["M", 20], ["L", 28], ["XL", 36]];
export function TextPopover({ ctx }: { ctx: WbCtx }) {
  const { api, set, done } = useLive(ctx);
  const [linkOpen, setLinkOpen] = useState(false);
  const [lq, setLq] = useState("");
  const notes = useVaultSelector((v) => v.notes);
  if (!api) return null;
  const els = withBoundText(api, selectedEls(api)).filter((e) => e.type === "text");
  const fam = common(els, (e) => e.fontFamily as number) ?? (defaultOf(api, "fontFamily") as number | undefined) ?? 5;
  const size = common(els, (e) => e.fontSize as number) ?? (defaultOf(api, "fontSize") as number | undefined) ?? 20;
  const al = common(els, (e) => e.textAlign as string) ?? (defaultOf(api, "textAlign") as string | undefined) ?? "left";
  const va = common(els, (e) => e.verticalAlign as string) ?? "top";
  const link = common(selectedEls(api), (e) => (e.link ?? "") as string) ?? "";
  const target = link.startsWith("lumen:note/") ? notes.find((n) => n.id === link.slice(11))?.title : link;
  const setLink = (v: string | null) => { void restyle(api, selectedIds(api), (e) => ({ ...e, link: v })); done(); setLinkOpen(false); };
  const s = lq.trim().toLowerCase();
  const nl = notes.filter((n) => !n.deleted && (!s || n.title.toLowerCase().includes(s))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const list: Blk[] = [
    { key: "font", h: t("Font"), items: FONTS.map(([n, ff, sample, fs, f]) => ({ key: n, l: sample, ff, lfs: fs, sub: t(n), on: f != null && fam === f, mh: "36px", tag: f == null ? t("Later") : undefined, op: f == null ? 0.6 : 1, disabled: f == null, onClick: () => f != null && set({ fontFamily: f }) } as Itm)), gap: "2px" },
    { key: "size", h: t("Size"), node: (
      <div style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--sf2)", gap: 2 }}>
        {SIZES.map(([l, v]) => <button key={l} type="button" onClick={() => set({ fontSize: v })} style={{ flex: 1, height: 28, borderRadius: 6, fontSize: 12, border: 0, cursor: "pointer", fontFamily: "inherit", background: size === v ? "var(--sf)" : "transparent", color: size === v ? "var(--tx)" : "var(--mu)", fontWeight: size === v ? 600 : 400, boxShadow: size === v ? "0 1px 2px rgba(0,0,0,.2)" : "none" }}>{l}</button>)}
        <input type="number" min={8} max={200} value={size} aria-label={t("Font size")} onChange={(e) => { const v = Math.max(8, Math.min(200, Number(e.target.value) || 20)); set({ fontSize: v }); }} onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1, width: 0, height: 28, borderRadius: 6, border: SIZES.some(([, v]) => v === size) ? 0 : "1px solid var(--ac)", background: "transparent", color: "var(--tx)", fontSize: 12, textAlign: "center", fontFamily: "inherit", outline: 0 }} />
      </div>
    ) },
    { key: "align", items: [["align-left", "left"], ["align-center", "center"], ["align-right", "right"]].map(([g, v]) => tile(g, "", { mh: "32px", on: al === v, tip: t(v), onClick: () => set({ textAlign: v }) }))
      .concat([["align-top", "top"], ["align-middle", "middle"], ["align-bottom", "bottom"]].map(([g, v]) => tile(g, "", { mh: "32px", on: va === v, tip: t(v), onClick: () => set({ verticalAlign: v }) }))), cols: "repeat(6,1fr)" },
    { key: "extra", items: [
      { g: "highlight", l: t("Background highlight"), tog: false, tag: t("Later"), op: 0.6, disabled: true, mh: "34px" },
      { g: "link", l: t("Link"), sub: target || t("None"), mh: "34px", onClick: () => setLinkOpen(!linkOpen) },
    ] },
    ...(linkOpen ? [{ key: "lk", node: (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input autoFocus value={lq} onChange={(e) => setLq(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t("Find a note…")} dir="auto" style={{ height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", padding: "0 8px", fontSize: "12.5px", outline: 0, fontFamily: "inherit" }} />
        {nl.map((n) => <button key={n.id} type="button" dir="auto" onClick={() => setLink(`lumen:note/${n.id}`)} style={{ height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--tx)", textAlign: "start", padding: "0 8px", fontSize: "12.5px", cursor: "pointer", fontFamily: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>[[{n.title}]]</button>)}
        {link && <button type="button" onClick={() => setLink(null)} style={{ height: 30, borderRadius: 8, border: "1px solid var(--bd)", background: "transparent", color: "var(--da)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{t("Remove link")}</button>}
      </div>
    ) } as Blk] : []),
  ];
  return <Wrap w={340}><Head g="font" title={t("Text")} /><Blocks list={list} /></Wrap>;
}

// ------------------------------------------------------------------ stickies (36E)
const PAPER = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
const INK = ["#EF6B6B", "#F2A93B", "#6BCB8B", "#5CC8C2", "#7AA2F7", "#B48EF0"];
export function StickyPopover({ ctx }: { ctx: WbCtx }) {
  const { api, set, done } = useLive(ctx);
  if (!api) return null;
  const st = selectedEls(api).filter(isSticky);
  const bg = common(st, (e) => e.backgroundColor as string) ?? (defaultOf(api, "backgroundColor") as string | undefined) ?? PAPER[0];
  const sizeOf = (e: El) => (Object.entries(STICKY_SIZES).find(([, [w]]) => Math.abs(w - e.width) < 6)?.[0] ?? "M");
  const size = common(st, sizeOf) ?? "M";
  const resize = (k: string) => {
    const [w, h, fs] = STICKY_SIZES[k];
    void restyle(api, new Set(st.map((e) => e.id)), (e) => (e.type === "text" ? { ...e, fontSize: fs } : { ...e, width: w, height: h })); done();
  };
  const list: Blk[] = [
    { key: "paper", h: t("Paper"), items: PAPER.map((c) => sw(c, bg === c, c, { onClick: () => set({ backgroundColor: c, ...(st.length ? { fillStyle: "solid" } : {}) }) })), cols: "repeat(6,1fr)" },
    { key: "pal", h: t("Palette colours"), hr: `${t("Lumen ink")} ▾`, items: INK.map((c) => sw(c, bg === c, c, { onClick: () => set({ backgroundColor: c }) })), cols: "repeat(6,1fr)" },
    { key: "size", h: t("Size"), seg: ["S", "M", "L"], segOn: ["S", "M", "L"].indexOf(size), onSeg: (i) => st.length && resize(["S", "M", "L"][i]) },
    { key: "x", items: [
      { g: "layers", l: t("Stack stickies"), sub: t("{n} in pile", { n: st.length }), mh: "34px", op: st.length > 1 ? 1 : 0.55, onClick: () => { if (stackStickies(api)) done(); } },
      { g: "mobile", l: t("Show author and device"), tog: false, tag: t("Later"), op: 0.6, disabled: true, mh: "34px" },
    ] },
  ];
  return <Wrap w={300}><Head g="sticky" title={t("Sticky")} /><Blocks list={list} /></Wrap>;
}

// ------------------------------------------------------------------ stamps + icon insert (36G)
export function StampsPopover({ ctx, onPlaced }: { ctx: WbCtx; onPlaced?: () => void }) {
  const prefs = useLibPrefs();
  const [seeNote, setSeeNote] = useState(false);
  const [nq, setNq] = useState("");
  const notes = useVaultSelector((v) => v.notes);
  const api = ctx.api;
  const put = async (id: string, o?: PlaceOpts) => { const it = getLibraryItem(id); if (!api || !it) return; await placeOnBoard(api, it, o); ctx.save(); onPlaced?.(); };
  const stamps: Itm[] = STAMPS.map(([id, g, l, c]) => tile(g, t(l), { gc: c, gs: 22, onClick: () => { if (id === "see-note") setSeeNote(true); else void put("stamp:" + id); } }));
  const s = nq.trim().toLowerCase();
  const nl = notes.filter((n) => !n.deleted && (!s || n.title.toLowerCase().includes(s))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const list: Blk[] = [
    { key: "st", items: stamps, cols: "repeat(6,1fr)" },
    { key: "num", h: t("Numbered"), hr: t("next: {n}", { n: prefs.nextNumber }), items: Array.from({ length: 9 }, (_, i) => tile("number-" + (i + 1), "", { mh: "40px", gs: 22, gc: "#7AA2F7", on: prefs.nextNumber === i + 1, onClick: () => { setLibPrefs({ nextNumber: i === 8 ? 1 : i + 2 }); void put("stamp:number-" + (i + 1)); } })), cols: "repeat(9,1fr)", note: t("Numbers auto-increment as you stamp. See note links the stamp to a note.") },
    ...(seeNote ? [{ key: "sn", h: t("Link the stamp to a note"), hr: t("Cancel"), onHr: () => setSeeNote(false), node: (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input autoFocus value={nq} onChange={(e) => setNq(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t("Find a note…")} dir="auto" style={{ height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", padding: "0 8px", fontSize: "12.5px", outline: 0, fontFamily: "inherit" }} />
        {nl.map((n) => <button key={n.id} type="button" dir="auto" onClick={() => { setSeeNote(false); void put("stamp:see-note", { link: `lumen:note/${n.id}` }); }} style={{ height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--tx)", textAlign: "start", padding: "0 8px", fontSize: "12.5px", cursor: "pointer", fontFamily: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</button>)}
      </div>
    ) } as Blk] : []),
  ];
  return <Wrap w={520}><Head g="stamp" title={t("Stamps")} sub={t("Drawn as Lumen glyphs; recolourable")} /><Blocks list={list} /></Wrap>;
}
export function InsertIconPopover({ ctx, onPlaced }: { ctx: WbCtx; onPlaced?: () => void }) {
  const prefs = useLibPrefs();
  const api = ctx.api;
  const [q, setQ] = useState("");
  const [grp, setGrp] = useState(1);
  const [max, setMax] = useState(96);
  const sel = api ? selectedGlyphColor(api) : null;
  const cur = sel ?? prefs.iconColor;
  const g = ICON_GROUPS[grp];
  const base = g[0] === "all" ? ALL_GLYPHS : g[2].filter((x) => ALL_GLYPHS.includes(x));
  const s = q.trim().toLowerCase();
  const names = s ? ALL_GLYPHS.filter((x) => x.includes(s)) : base;
  const put = async (name: string) => { const it = getLibraryItem("icon:" + name); if (!api || !it) return; touchRecent(it.id); await placeOnBoard(api, it, { color: cur }); ctx.save(); onPlaced?.(); };
  const pick = (c: string) => { setLibPrefs({ iconColor: c }); if (api && recolourSelectedGlyphs(api, c)) ctx.save(); };
  const list: Blk[] = [
    { key: "s", node: (
      <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, border: `1px solid ${q ? "var(--ac)" : "var(--bd)"}`, color: "var(--mu)" }}>
        <Glyph name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={t("Search {n} glyphs…", { n: ALL_GLYPHS.length })} aria-label={t("Search glyphs")} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--tx)", fontSize: "12.5px", fontFamily: "inherit" }} />
      </label>
    ) },
    ...(s ? [] : [{ key: "g", seg: ICON_GROUPS.map(([, l]) => t(l)), segOn: grp, onSeg: (i: number) => { setGrp(i); setMax(96); } } as Blk]),
    { key: "i", items: names.slice(0, max).map((n) => tile(n, "", { mh: "40px", gs: 20, gc: cur.startsWith("var") ? "var(--tx)" : cur, tip: n, key: n, onClick: () => void put(n), draggable: true, onDragStart: (e) => setLibraryDrag(e, "icon:" + n) })), cols: "repeat(8,1fr)", note: names.length ? undefined : t("Nothing matches “{q}”.", { q }) },
    ...(names.length > max ? [{ key: "m", items: [{ l: t("Show more · {n} left", { n: names.length - max }), mh: "32px", bd: "var(--bd)", onClick: () => setMax(max + 160) }] } as Blk] : []),
    { key: "c", h: t("Colour"), hr: sel ? t("applies to the selected icon") : undefined, items: ICON_COLORS.map((c) => sw(c, cur === c, c.startsWith("var") ? t("Text colour") : c, { onClick: () => pick(c) })), cols: "repeat(8,1fr)", note: t("Icons stay editable: select one and pick a colour to recolour it.") },
  ];
  return <Wrap w={560}><Head g="shape-library" title={t("Insert icon")} /><Blocks list={list} /></Wrap>;
}
export { ICON_COLORS };
