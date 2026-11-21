// Reading and writing Excalidraw style props for the library popovers (connector, shape style, text, stickies).
// Writes go to the selection (one history step via updateScene) and to the "current item" defaults so the next shape matches.
import type { WbAPI } from "../wb/hooks";

export type El = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Patch = Record<string, unknown>;

const CURRENT: Record<string, string> = {
  strokeColor: "currentItemStrokeColor", backgroundColor: "currentItemBackgroundColor", fillStyle: "currentItemFillStyle", strokeWidth: "currentItemStrokeWidth", strokeStyle: "currentItemStrokeStyle",
  roughness: "currentItemRoughness", opacity: "currentItemOpacity", fontFamily: "currentItemFontFamily", fontSize: "currentItemFontSize", textAlign: "currentItemTextAlign",
  startArrowhead: "currentItemStartArrowhead", endArrowhead: "currentItemEndArrowhead", roundnessKind: "currentItemRoundness", arrowType: "currentItemArrowType",
};

export const selectedIds = (api: WbAPI): Set<string> => new Set(Object.keys((api.getAppState().selectedElementIds as Record<string, boolean>) ?? {}).filter((k) => (api.getAppState().selectedElementIds as Record<string, boolean>)[k]));
export function selectedEls(api: WbAPI): El[] {
  const ids = selectedIds(api);
  return (api.getSceneElements() as El[]).filter((e) => ids.has(e.id));
}
/** Selected elements, plus the text bound inside selected containers (font / align apply to those). */
export function withBoundText(api: WbAPI, sel: El[]): El[] {
  const ids = new Set(sel.map((e) => e.id));
  return [...sel, ...(api.getSceneElements() as El[]).filter((e) => e.type === "text" && e.containerId && ids.has(e.containerId))];
}
/** The common value of `key` across `els` (null when they differ or none have it). */
export function common<T>(els: El[], pick: (e: El) => T | undefined): T | null {
  let v: T | undefined, set = false;
  for (const e of els) { const x = pick(e); if (x === undefined) continue; if (!set) { v = x; set = true; } else if (JSON.stringify(v) !== JSON.stringify(x)) return null; }
  return set ? (v as T) : null;
}
export const defaultOf = (api: WbAPI, key: string): unknown => api.getAppState()[CURRENT[key]];

/** Update the selection (restoring bindings / sizes) and the "current item" defaults. `fn` returns the changed element or null to skip. */
export async function restyle(api: WbAPI, ids: Set<string>, fn: (e: El) => El | null, current: Patch = {}) {
  const { restoreElements } = await import("@excalidraw/excalidraw");
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) if (CURRENT[k]) mapped[CURRENT[k]] = v;
  if (!ids.size) { if (Object.keys(mapped).length) api.updateScene({ appState: mapped }); return; }
  const all = api.getSceneElementsIncludingDeleted() as El[];
  const next = all.map((e) => {
    const inSel = ids.has(e.id), inBound = !!e.containerId && ids.has(e.containerId);
    if (!inSel && !inBound) return e;
    const r = fn({ ...e });
    return r ? { ...r, version: ((e.version as number) ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e;
  });
  api.updateScene({ elements: restoreElements(next as never, null, { refreshDimensions: true, repairBindings: true }), ...(Object.keys(mapped).length ? { appState: mapped } : {}) });
}

/** Apply a Lumen style patch to every selected element it applies to. */
export function applyStyle(api: WbAPI, p: Patch) {
  const ids = selectedIds(api);
  const current: Patch = { ...p };
  // "Dots": Excalidraw has no dotted fill, so it is drawn as the sparsest hatch (cross-hatch) and tagged in customData.lumenFill
  if (p.fillStyle === "dots") current.fillStyle = "cross-hatch";
  if ("roundness" in p) { current.roundnessKind = p.roundness; delete current.roundness; }
  void restyle(api, ids, (e) => {
    const o: El = { ...e };
    for (const [k, v] of Object.entries(p)) {
      if (k === "roundness") { if (e.type === "rectangle" || e.type === "diamond" || e.type === "image") o.roundness = v === "round" ? { type: 3 } : null; continue; }
      if (k === "arrowType") { if (e.type === "arrow") { o.elbowed = v === "elbow"; o.roundness = v === "round" ? { type: 2 } : null; } continue; }
      if (k === "fontFamily" || k === "fontSize" || k === "textAlign" || k === "verticalAlign") { if (e.type === "text") o[k] = v; continue; }
      if (k === "startArrowhead" || k === "endArrowhead") { if (e.type === "arrow" || e.type === "line") o[k] = v === "none" ? null : v; continue; }
      if (k === "fillStyle" && v === "dots") { if (e.type !== "text" && e.type !== "arrow" && !(e.type === "line" && !e.polygon)) { o.fillStyle = "cross-hatch"; o.customData = { ...(e.customData ?? {}), lumenFill: "dots" }; } continue; }
      if (k === "fillStyle" && e.customData?.lumenFill) { const { lumenFill: _lf, ...cd } = e.customData; o.customData = Object.keys(cd).length ? cd : undefined; }
      if (k === "fillStyle" && (e.type === "text" || e.type === "arrow" || e.type === "line" && !e.polygon)) continue;
      o[k] = v;
    }
    return o;
  }, current);
}

// ------------------------------------------------------------------ connectors: label and binding
const rnd = () => Math.floor(Math.random() * 2 ** 31);
export const arrowsOf = (api: WbAPI) => selectedEls(api).filter((e) => e.type === "arrow" || e.type === "line");
export const labelOf = (api: WbAPI, arrow: El | undefined): string => {
  if (!arrow) return "";
  const tx = (api.getSceneElements() as El[]).find((e) => e.type === "text" && e.containerId === arrow.id);
  return tx?.text ?? "";
};
/** Set (or clear) the text bound to the selected arrows. Bound text follows the line (Excalidraw positions it at the midpoint). */
export async function setArrowLabel(api: WbAPI, text: string) {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const arrows = arrowsOf(api).filter((e) => e.type === "arrow");
  if (!arrows.length) return;
  let all = [...(api.getSceneElementsIncludingDeleted() as El[])];
  for (const a of arrows) {
    const tx = all.find((e) => e.type === "text" && e.containerId === a.id && !e.isDeleted);
    if (tx) {
      all = all.map((e) => (e.id === tx.id ? { ...e, text, originalText: text, isDeleted: !text, version: e.version + 1, versionNonce: rnd() } : e.id === a.id && !text ? { ...e, boundElements: (e.boundElements ?? []).filter((b: El) => b.id !== tx.id), version: e.version + 1, versionNonce: rnd() } : e));
    } else if (text) {
      const [t] = convertToExcalidrawElements([{ type: "text", x: a.x, y: a.y, text, fontSize: 18 } as never]) as unknown as El[];
      const nt: El = { ...t, containerId: a.id, textAlign: "center", verticalAlign: "middle", fontFamily: 6 };
      all = all.map((e) => (e.id === a.id ? { ...e, boundElements: [...(e.boundElements ?? []), { type: "text", id: nt.id }], version: e.version + 1, versionNonce: rnd() } : e));
      all.push(nt);
    }
  }
  api.updateScene({ elements: all });
}
const hit = (s: El, x: number, y: number, pad = 10) => x >= s.x - pad && x <= s.x + s.width + pad && y >= s.y - pad && y <= s.y + s.height + pad;
export const isBound = (api: WbAPI) => { const a = arrowsOf(api).filter((e) => e.type === "arrow"); return a.length > 0 && a.every((e) => e.startBinding || e.endBinding); };
/** Unbind the selected arrows from their shapes, or re-bind each end to the shape it touches. */
export function setBound(api: WbAPI, on: boolean) {
  const arrows = arrowsOf(api).filter((e) => e.type === "arrow");
  if (!arrows.length) return;
  const ids = new Set(arrows.map((a) => a.id));
  const shapes = (api.getSceneElements() as El[]).filter((e) => ["rectangle", "ellipse", "diamond", "image", "frame"].includes(e.type) && !e.isDeleted);
  const bind: Record<string, El | undefined> = {};
  const next = (api.getSceneElementsIncludingDeleted() as El[]).map((e) => {
    if (ids.has(e.id)) {
      if (!on) { return { ...e, startBinding: null, endBinding: null, version: e.version + 1, versionNonce: rnd() }; }
      const pts = e.points as [number, number][];
      const s = shapes.find((sh) => hit(sh, e.x + pts[0][0], e.y + pts[0][1])), f = shapes.find((sh) => hit(sh, e.x + pts[pts.length - 1][0], e.y + pts[pts.length - 1][1]));
      bind[e.id] = s; bind[e.id + ":end"] = f;
      return { ...e, startBinding: s ? { elementId: s.id, focus: 0, gap: 6 } : e.startBinding, endBinding: f ? { elementId: f.id, focus: 0, gap: 6 } : e.endBinding, version: e.version + 1, versionNonce: rnd() };
    }
    return e;
  });
  const out = next.map((e) => {
    if (!shapes.some((s) => s.id === e.id)) return e;
    let be = (e.boundElements ?? []) as El[];
    if (!on) be = be.filter((b) => !ids.has(b.id));
    else for (const a of arrows) if ((bind[a.id]?.id === e.id || bind[a.id + ":end"]?.id === e.id) && !be.some((b) => b.id === a.id)) be = [...be, { type: "arrow", id: a.id }];
    return be === e.boundElements ? e : { ...e, boundElements: be, version: e.version + 1, versionNonce: rnd() };
  });
  api.updateScene({ elements: out });
}

// ------------------------------------------------------------------ stickies
export const STICKY_SIZES: Record<string, [number, number, number]> = { S: [150, 120, 16], M: [200, 160, 18], L: [260, 210, 22] };
export const isSticky = (e: El) => e.type === "rectangle" && e.fillStyle === "solid" && e.strokeColor === "transparent";
/** Pile the selected stickies: each one 10 px right / down of the one below, slightly turned. */
export function stackStickies(api: WbAPI): number {
  const s = selectedEls(api).filter(isSticky);
  if (s.length < 2) return 0;
  const ids = new Map(s.map((e, i) => [e.id, i]));
  const x0 = Math.min(...s.map((e) => e.x)), y0 = Math.min(...s.map((e) => e.y));
  const next = (api.getSceneElementsIncludingDeleted() as El[]).map((e) => {
    const i = ids.get(e.id);
    if (i !== undefined) return { ...e, x: x0 + i * 10, y: y0 + i * 10, angle: ((i % 3) - 1) * 0.03, version: e.version + 1, versionNonce: rnd() };
    const c = e.containerId ? ids.get(e.containerId) : undefined;
    return c !== undefined ? { ...e, x: x0 + c * 10 + (e.x - (s[c].x)), y: y0 + c * 10 + (e.y - s[c].y), version: e.version + 1, versionNonce: rnd() } : e;
  });
  api.updateScene({ elements: next });
  return s.length;
}
