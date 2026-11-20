// Shared library panel (design 36A–C, 44D, 49A–F; §3 + §11.3). One panel for every workspace: searchable, Recent and Favourites
// first, categories in the user's order, vendor icon packs (shown unmodified). Click places at the centre; drag out with
// DataTransfer `application/x-lumen+json` {type:"library-item", id}.
//   whiteboard / board:  <LibraryPanel workspace="whiteboard" onPlace={(item, o) => placeOnBoard(api, item, o)} />
//   architecture studio: <LibraryPanel workspace="architecture" variant="docked" onPlace={(item) => addShape(canvasNodeFor(item, centre, id))} />
import { useState } from "react";
import { t } from "../../lib/i18n";
import { useVaultSelector } from "../../lib/store";
import {
  ALL_GLYPHS, ICON_COLORS, ICON_GROUPS, STAMPS, TAB_LABEL, getLibraryItem, itemsOf, orderedCats, searchLibrary, setLibPrefs, setLibraryDrag,
  svgDataUrl, tabsFor, toggleFav, touchRecent, useLibPrefs, type LibCat, type LibItem, type LibTab, type PlaceOpts, type Workspace,
} from "../../lib/library-items";
import { installedPacks, packCategories, packIcons, vendorRef, useVendorPacks } from "../../lib/vendor-icons";
import { Block, PanelShell, sw, type Blk, type Itm } from "./ui";
import { VendorPackCards } from "./VendorPacks";

export interface LibraryPanelProps {
  workspace: Workspace;
  /** Place an item at the centre (whiteboard) or add a node (architecture). */
  onPlace: (item: LibItem, opts?: PlaceOpts) => void | Promise<void>;
  onClose?: () => void;
  /** floating = whiteboard panel (with header, 320 px); docked = studio side panel (flat, fills its column); sheet = phone bottom sheet. */
  variant?: "floating" | "docked" | "sheet";
  /** Recolour selected glyph stamps / icons (whiteboard) when a swatch is picked. */
  onRecolour?: (color: string) => void;
  /** Colour of the selected stamp / icon, shown as the active swatch. */
  selectedColor?: string | null;
  width?: number | string;
  /** Open on this tab instead of the workspace default (Insert icon opens on Icons). */
  initialTab?: LibTab;
  /** The selected board element is a vendor icon: the colour control is disabled (vendor icons are never recoloured). */
  selectedVendor?: boolean;
}

export function LibraryPanel({ workspace, onPlace, onClose, variant = "floating", onRecolour, selectedColor, width, initialTab, selectedVendor }: LibraryPanelProps) {
  const prefs = useLibPrefs();
  const docked = variant === "docked";
  // the docked studio panel (260 px) has the design's three tabs (49A–49D); icons stay one search away
  const tabs = docked ? tabsFor(workspace).filter((x, i) => x !== "icons" || i === 0) : tabsFor(workspace);
  const [tab, setTabS] = useState<LibTab>(() => { const w = initialTab ?? prefs.tab[workspace] ?? tabs[0]; return tabs.includes(w) ? w : tabs[0]; });
  const setTab = (x: LibTab) => { setTabS(x); if (!initialTab) setLibPrefs({ tab: { ...prefs.tab, [workspace]: x } }); };
  const [q, setQ] = useState("");
  const [view, setView] = useState<"browse" | "customise">("browse");
  const [iconGroup, setIconGroup] = useState(0);
  const [iconMax, setIconMax] = useState(96);
  const [seeNote, setSeeNote] = useState(false);
  const [nq, setNq] = useState("");
  const notes = useVaultSelector((v) => v.notes);
  useVendorPacks();
  const loadedPacks = installedPacks();
  const [vcat, setVcat] = useState<Record<string, string>>({});
  const [vmax, setVmax] = useState<Record<string, number>>({});
  const sub = workspace === "architecture" || workspace === "canvas" ? t("Architecture first") : workspace === "board" ? t("All") : t("Drawing first");
  const cols = docked ? "repeat(3,1fr)" : "repeat(4,1fr)";
  const mh = docked ? "56px" : "58px";

  const place = (it: LibItem, o?: PlaceOpts) => {
    touchRecent(it.id);
    if (it.id === "stamp:see-note" && !o?.link) { setSeeNote(true); return; }
    let opts = o;
    if (it.id.startsWith("stamp:number-")) { const n = Number(it.id.slice(13)); setLibPrefs({ nextNumber: n >= 9 ? 1 : n + 1 }); }
    if (it.id.startsWith("icon:")) opts = { ...o, color: prefs.iconColor };
    void onPlace(it, opts);
  };
  const mk = (it: LibItem, o: Partial<Itm> = {}): Itm => {
    const v = !!it.vendorSvg;
    // single-colour brand marks (Simple Icons) are published without a colour: shown as published on a light tile
    const lightTile = v && it.vendorPack === "simple-icons" ? { bg: "#f4f4f5", c: "#1e1e1e" } : {};
    return {
      ...lightTile,
      key: it.id, g: v ? undefined : it.glyph, img: v && it.vendorSvg ? svgDataUrl(it.vendorSvg) : undefined, gs: v ? 24 : undefined, l: it.tab === "stamps" ? t(it.name) : v ? it.name : t(it.name), col: true, bd: "var(--bd)", mh,
      on: tab === "drawing" && prefs.lastShape === it.id, gc: it.tab === "stamps" ? it.color : undefined, onClick: () => place(it), draggable: true, onDragStart: (e) => setLibraryDrag(e, it.id), star: { on: prefs.favs.includes(it.id), toggle: () => toggleFav(it.id) }, tip: it.name, ...o,
    };
  };
  const ids = (list: string[]) => list.map((i) => getLibraryItem(i)).filter(Boolean) as LibItem[];

  // ------------------------------------------------------------ browse
  const search = (
    <div key="search" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "0 8px", borderRadius: 8, border: `1px solid ${q ? "var(--ac)" : "var(--bd)"}`, boxSizing: "border-box", color: "var(--mu)" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={docked ? t("Search {n} shapes…", { n: 80 }) : t("Search shapes, stamps, icons…")} aria-label={t("Search the library")} dir="auto"
        onKeyDown={(e) => { if (e.key === "Enter") { const r = searchLibrary(q)[0]; if (r) place(r); } if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); } }}
        style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--tx)", fontSize: "12.5px", fontFamily: "inherit" }} />
      {q && <button type="button" aria-label={t("Clear")} onClick={() => setQ("")} style={{ background: "transparent", border: 0, color: "var(--mu)", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>}
    </div>
  );
  const tabsBlk: Blk = { key: "tabs", segCompact: docked, seg: tabs.map((x) => t(TAB_LABEL[x])), segOn: tabs.indexOf(tab), onSeg: (i) => { setTab(tabs[i]); setQ(""); } };

  const catBlock = (c: LibCat): Blk => ({ key: c.id, h: t(c.name), hr: String(c.ids.length), items: itemsOf(c).map((it) => mk(it)), cols, gap: "4px" });
  const recent = ids(prefs.recent).filter((i) => i.tab === tab).slice(0, docked ? 3 : 4);
  const favs = ids(prefs.favs).filter((i) => i.tab === tab);
  const dragFav = (it: LibItem): Partial<Itm> => ({
    onDragStart: (e) => { setLibraryDrag(e, it.id); e.dataTransfer.setData("application/x-lumen-fav", it.id); },
    onDragOver: (e) => { if (e.dataTransfer.types.includes("application/x-lumen-fav")) e.preventDefault(); },
    onDrop: (e) => {
      const from = e.dataTransfer.getData("application/x-lumen-fav");
      if (!from || from === it.id) return;
      e.preventDefault();
      const rest = prefs.favs.filter((x) => x !== from), at = rest.indexOf(it.id);
      rest.splice(at < 0 ? rest.length : at, 0, from);
      setLibPrefs({ favs: rest });
    },
  });
  const blocks: Blk[] = [];
  if (q.trim()) {
    const res = searchLibrary(q);
    blocks.push(docked
      ? { key: "res", h: t("Results · {n}", { n: res.length }), items: res.map((it, i) => ({ ...mk(it, { col: false, mh: "34px", on: i === 0, l: t(it.name), sub: t(it.tab === "architecture" ? "Architecture" : it.tab === "drawing" ? "Drawing" : it.tab === "stamps" ? "Stamps" : "Icons"), g: it.vendorSvg ? undefined : it.glyph, gs: 18 }), star: undefined, bd: i === 0 ? "var(--ac)" : "transparent" })) }
      : { key: "res", h: t("Results · {n}", { n: res.length }), items: res.map((it) => mk(it)), cols, note: res.length ? undefined : t("Nothing matches “{q}”.", { q }) });
    if (docked && !res.length) blocks.push({ key: "none", note: t("Nothing matches “{q}”.", { q }) });
  } else {
    blocks.push(tabsBlk);
    if (tab === "drawing" || tab === "architecture") {
      if (recent.length) blocks.push({ key: "recent", h: t("Recent"), items: recent.map((it) => mk(it)), cols });
      if (favs.length) blocks.push({ key: "favs", h: t("Favourites"), hr: favs.length > 1 ? t("drag to reorder") : undefined, items: favs.map((it) => mk(it, { ...dragFav(it) })), cols });
      const MERGE = new Set(["uml", "mindmap", "containers", "study"]);
      const merged: LibCat[] = [];
      for (const c of orderedCats(tab)) {
        if (prefs.hidden.includes(c.id)) continue;
        if (tab === "drawing" && MERGE.has(c.id)) { merged.push(c); continue; }
        blocks.push(catBlock(c));
      }
      // the design groups the small drawing categories in one block: UML · Mind map · Containers · Math & study
      if (merged.length) blocks.push({ key: "merged", h: merged.map((c) => t(c.name)).join(" · "), items: merged.flatMap((c) => itemsOf(c)).map((it) => mk(it)), cols, note: t("Click to place in the centre, or drag onto the board.") });
      if (tab === "architecture") {
        blocks.push({ key: "vendor", items: [{ l: t("Vendor icons & brand logos"), tog: prefs.vendor, onClick: () => setLibPrefs({ vendor: !prefs.vendor }), mh: "34px", bd: "var(--bd)" }], note: prefs.vendor ? t("Packs are downloaded once, cached for offline use and shown unmodified, never recoloured.") : undefined });
        if (prefs.vendor) {
          for (const p of loadedPacks) {
            const all = packIcons(p.id), cat = vcat[p.id] ?? (p.group === "Brands & tech" ? "Clouds & platforms" : "");
            const list = cat ? all.filter((i) => i.cat === cat) : all, max = vmax[p.id] ?? 48;
            const last = (x: string) => (x === "More logos" || x === "Other" ? 1 : 0);
            const cats = [...packCategories(p.id)].sort((x, y) => last(x) - last(y) || x.localeCompare(y));
            blocks.push({ key: "vh-" + p.id, h: p.name, hr: String(list.length), node: (
              <select value={cat} aria-label={t("Category")} onChange={(e) => setVcat({ ...vcat, [p.id]: e.target.value })} style={{ height: 30, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--sf)", color: "var(--tx)", fontSize: "12.5px", padding: "0 6px", fontFamily: "inherit" }}>
                <option value="">{t("All")} · {all.length}</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) });
            blocks.push({ key: "v-" + p.id, items: list.slice(0, max).map((v) => mk(getLibraryItem(vendorRef(p.id, v.id))!)), cols });
            if (list.length > max) blocks.push({ key: "vm-" + p.id, items: [{ l: t("Show more · {n} left", { n: list.length - max }), mh: "32px", bd: "var(--bd)", onClick: () => setVmax({ ...vmax, [p.id]: max + 96 }) }] });
          }
          if (!loadedPacks.length) blocks.push({ key: "vnone", items: [{ l: t("Download vendor packs…"), mh: "34px", bd: "var(--bd)", onClick: () => setView("customise") }], note: t("No vendor pack is downloaded yet. AWS, Google Cloud, Kubernetes and brand logos download on demand; Azure imports Microsoft's ZIP."), noteBg: "var(--sf2)" });
        }
      }
    } else if (tab === "stamps") {
      const st = STAMPS.map(([id]) => getLibraryItem("stamp:" + id)!);
      blocks.push({ key: "stamps", items: st.map((it) => mk(it, { gs: 22 })), cols });
      blocks.push({ key: "nums", h: t("Numbered"), hr: t("next: {n}", { n: prefs.nextNumber }), items: Array.from({ length: 9 }, (_, i) => mk(getLibraryItem("stamp:number-" + (i + 1))!, { l: undefined, mh: "36px", gs: 20, on: prefs.nextNumber === i + 1, star: undefined, tip: String(i + 1) })), cols: "repeat(9,1fr)", gap: "3px", note: t("Numbers auto-increment as you stamp. See note links the stamp to a note.") });
      if (seeNote) {
        const s = nq.trim().toLowerCase();
        const list = notes.filter((n) => !n.deleted && (!s || n.title.toLowerCase().includes(s))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
        blocks.push({ key: "seenote", h: t("Link the stamp to a note"), hr: t("Cancel"), onHr: () => setSeeNote(false), node: (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input autoFocus value={nq} onChange={(e) => setNq(e.target.value)} placeholder={t("Find a note…")} dir="auto" style={{ height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", padding: "0 8px", fontSize: "12.5px", outline: 0, fontFamily: "inherit" }} />
            {list.map((n) => <button key={n.id} type="button" onClick={() => { setSeeNote(false); place(getLibraryItem("stamp:see-note")!, { link: `lumen:note/${n.id}` }); }} dir="auto" style={{ height: 32, borderRadius: 8, border: 0, background: "transparent", color: "var(--tx)", textAlign: "start", padding: "0 8px", fontSize: "12.5px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "inherit" }}>{n.title}</button>)}
            {!list.length && <span style={{ fontSize: "11.5px", color: "var(--mu)" }}>{t("No notes match.")}</span>}
          </div>
        ) });
      }
    } else {
      const grp = ICON_GROUPS[iconGroup];
      const names = grp[0] === "all" ? ALL_GLYPHS : grp[2].filter((g) => ALL_GLYPHS.includes(g));
      const shown = names.slice(0, iconMax);
      const cur = selectedColor ?? prefs.iconColor;
      const pick = (c: string) => { setLibPrefs({ iconColor: c }); onRecolour?.(c); };
      blocks.push({ key: "igrp", seg: ICON_GROUPS.map(([, l]) => t(l)), segOn: iconGroup, onSeg: (i) => { setIconGroup(i); setIconMax(96); } });
      blocks.push({ key: "icons", items: shown.map((g) => mk(getLibraryItem("icon:" + g)!, { l: undefined, mh: "40px", gs: 20, gc: cur.startsWith("var") ? "var(--tx)" : cur, star: undefined, tip: g })), cols: docked ? "repeat(5,1fr)" : "repeat(6,1fr)", note: names.length > shown.length ? undefined : t("{n} glyphs", { n: names.length }) });
      if (names.length > shown.length) blocks.push({ key: "more", items: [{ l: t("Show more · {n} left", { n: names.length - shown.length }), mh: "32px", bd: "var(--bd)", onClick: () => setIconMax(iconMax + 120) }] });
      blocks.push({ key: "icol", h: t("Colour"), hr: selectedVendor ? t("disabled for vendor icons") : onRecolour && selectedColor ? t("applies to the selected icon") : undefined, items: ICON_COLORS.map((c) => sw(c, cur === c || (c === "var(--tx)" && cur === "var(--tx)"), c.startsWith("var") ? t("Text colour") : c, { onClick: selectedVendor ? undefined : () => pick(c), mh: "28px", thH: "28px", op: selectedVendor ? 0.35 : 1, disabled: selectedVendor })), cols: "repeat(8,1fr)", note: selectedVendor ? t("Vendor icons are shown exactly as published and are never recoloured.") : onRecolour ? t("Icons stay editable: select one and pick a colour to recolour it.") : undefined });
    }
    blocks.push({ key: "cust", items: [{ g: "gear", l: t("Categories, order, vendor packs"), mh: "34px", bd: "var(--bd)", onClick: () => setView("customise") }] });
  }

  // ------------------------------------------------------------ customise (49F)
  const [catTab, setCatTab] = useState<"architecture" | "drawing">("architecture");
  const catList = orderedCats(catTab);
  const moveCat = (from: string, onto: string) => {
    const order = orderedCats(catTab).map((c) => c.id).filter((x) => x !== from);
    order.splice(Math.max(0, order.indexOf(onto)), 0, from);
    setLibPrefs({ catOrder: [...order, ...prefs.catOrder.filter((x) => !order.includes(x))] });
  };
  const custom: Blk[] = [
    { key: "ct", seg: [t("Architecture"), t("Drawing")], segOn: catTab === "architecture" ? 0 : 1, onSeg: (i) => setCatTab(i ? "drawing" : "architecture") },
    { key: "cats", h: t("Categories"), hr: t("drag to reorder · click to hide"), items: catList.map((c) => { const hid = prefs.hidden.includes(c.id); return { key: c.id, grip: true, g: c.glyph, l: t(c.name), sub: String(c.ids.length), mh: "34px", op: hid ? 0.5 : 1, ic: [hid ? "eye-off" : "eye"] as string[], draggable: true,
      onClick: () => setLibPrefs({ hidden: hid ? prefs.hidden.filter((x) => x !== c.id) : [...prefs.hidden, c.id] }),
      onDragStart: (e) => e.dataTransfer.setData("application/x-lumen-cat", c.id), onDragOver: (e) => { if (e.dataTransfer.types.includes("application/x-lumen-cat")) e.preventDefault(); },
      onDrop: (e) => { const f = e.dataTransfer.getData("application/x-lumen-cat"); if (f) { e.preventDefault(); moveCat(f, c.id); } } } as Itm; }), gap: "2px" },
    { key: "favs", h: t("Favourites"), hr: t("drag to reorder"), items: ids(prefs.favs).map((it) => mk(it, { col: false, grip: true, mh: "34px", gs: 18, star: undefined, bd: "transparent", ...dragFav(it), onClick: () => toggleFav(it.id), ic: ["star"] })), gap: "2px", note: prefs.favs.length ? undefined : t("Star a shape in the library to keep it here.") },
    { key: "order", h: t("Order per workspace"), items: (["whiteboard", "board", "canvas", "architecture"] as Workspace[]).map((w) => ({ key: w, g: w === "architecture" ? "diagram" : w, l: t(({ whiteboard: "Whiteboard", board: "Board", canvas: "Canvas", architecture: "Architecture" })[w]), sub: t("{tab} first", { tab: t(TAB_LABEL[prefs.firstTab[w]]) }), mh: "36px",
      onClick: () => { const all: LibTab[] = ["drawing", "stamps", "icons", "architecture"]; setLibPrefs({ firstTab: { ...prefs.firstTab, [w]: all[(all.indexOf(prefs.firstTab[w]) + 1) % 4] }, tab: {} }); }, tip: t("Click to change which tab opens first") })), gap: "2px",
      note: t("Every category is reachable from every workspace.") },
    { key: "vend", h: t("Vendor icons"), items: [{ l: t("Show vendor icon packs"), tog: prefs.vendor, onClick: () => setLibPrefs({ vendor: !prefs.vendor }), mh: "34px" }] },
    { key: "packs", node: <VendorPackCards /> },
    { key: "back", items: [{ l: "‹  " + t("Back to library"), mh: "34px", bd: "var(--bd)", onClick: () => setView("browse") }] },
  ];

  const body = (
    <>
      {view === "customise" ? custom.map((b) => <Block key={b.key} bk={b} />) : (
        <>
          {search}
          {blocks.map((b) => <Block key={b.key} bk={b} />)}
        </>
      )}
    </>
  );
  const shellProps = { title: t("Library"), g: "shape-library", sub: view === "customise" ? t("Customise") : sub, onClose: docked ? undefined : onClose };

  if (docked) {
    return (
      <PanelShell {...shellProps} flat w={width ?? "100%"} style={{ height: "100%", border: 0 }} bodyStyle={{ overflowY: "auto", gap: 12 }}>
        {body}
      </PanelShell>
    );
  }
  return (
    <PanelShell {...shellProps} w={width ?? (variant === "sheet" ? "100%" : 320)} style={{ maxHeight: "100%", ...(variant === "sheet" ? { borderRadius: "20px 20px 0 0" } : { animation: "lib-in .16s var(--ease,ease) both" }) }} bodyStyle={{ overflowY: "auto", gap: 14 }}>
      {body}
    </PanelShell>
  );
}

