// Lumen layers on Excalidraw (brief §5, docs/WHITEBOARD_CANVAS_PLAN.md): Excalidraw has no layers, so a layer is
// `customData.lumenLayer` on each element plus z-order bands (bottom layer first). Hide = the layer's elements are taken
// out of the scene into a side store (the file keeps them); lock = `locked: true` on the band (only on elements the layer
// locked itself); opacity = element opacity × layer opacity (the element's own value kept in customData.lumenOpBase).
// The list and the active layer are saved in the file as scene `lumenLayers`.
import { useSyncExternalStore } from "react";
import { restoreElements } from "@excalidraw/excalidraw";
import type { WbAPI } from "../hooks";

export interface Layer { id: string; name: string; hidden?: boolean; locked?: boolean; opacity?: number }
export interface LayersMeta { list: Layer[]; active: string }
type El = Record<string, unknown> & { id: string; type: string; isDeleted?: boolean; containerId?: string | null; customData?: Record<string, unknown> | null; locked?: boolean; opacity?: number; version?: number };

/** Defaults (brief): Background, Sketch, Notes; list is top-first. Elements without a layer belong to Sketch. */
export const DEFAULT_LAYERS = (): LayersMeta => ({ list: [{ id: "notes", name: "Notes" }, { id: "sketch", name: "Sketch" }, { id: "background", name: "Background" }], active: "notes" });
export const UNASSIGNED = "sketch";
const rid = () => "l" + Math.random().toString(36).slice(2, 8);
const nonce = () => Math.floor(Math.random() * 2 ** 31);
const bump = <T extends El>(e: T): T => ({ ...e, version: (e.version ?? 1) + 1, versionNonce: nonce(), updated: Date.now() });

export class LayerStore {
  meta: LayersMeta;
  /** Elements of hidden layers (out of the scene, still in the file). */
  hidden = new Map<string, El[]>();
  /** Element ids present when the board opened / last saw them: anything new without a layer goes to the active one. */
  private known = new Set<string>();
  private subs = new Set<() => void>();
  private ver = 0;
  api: WbAPI | null = null;
  onCommit: () => void = () => {};

  constructor(meta: Partial<LayersMeta> | undefined) {
    const d = DEFAULT_LAYERS();
    this.meta = meta?.list?.length ? { list: meta.list.map((l) => ({ ...l })), active: meta.active && meta.list.some((l) => l.id === meta.active) ? meta.active : meta.list[0].id } : d;
  }
  // ------------------------------------------------------------------ store
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  version = () => this.ver;
  emit() { this.ver++; this.subs.forEach((f) => f()); }

  layerOf(e: El): string {
    const id = e.customData?.lumenLayer as string | undefined;
    if (id && this.meta.list.some((l) => l.id === id)) return id;
    if (id) return this.meta.list[this.meta.list.length - 1]?.id ?? UNASSIGNED; // a layer that was deleted elsewhere
    return this.meta.list.some((l) => l.id === UNASSIGNED) ? UNASSIGNED : this.meta.list[this.meta.list.length - 1].id;
  }
  byId = (id: string) => this.meta.list.find((l) => l.id === id);
  rank(id: string) { const i = this.meta.list.findIndex((l) => l.id === id); return i < 0 ? 0 : this.meta.list.length - 1 - i; }

  /** Scene elements from the file → the visible ones (hidden layers go to the side store). */
  split(all: readonly El[]): El[] {
    this.hidden.clear();
    const out: El[] = [];
    const hid = new Set(this.meta.list.filter((l) => l.hidden).map((l) => l.id));
    for (const e of all) {
      this.known.add(e.id);
      const l = this.layerOf(e);
      if (hid.has(l) && !e.isDeleted) { const a = this.hidden.get(l) ?? []; a.push(e); this.hidden.set(l, a); }
      else out.push(e);
    }
    return out;
  }
  /** Everything for the file: the scene plus the hidden layers' elements. */
  hiddenElements(): El[] { return [...this.hidden.values()].flat(); }
  counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of (this.api?.getSceneElements() ?? []) as El[]) if (!e.isDeleted && !e.containerId) m.set(this.layerOf(e), (m.get(this.layerOf(e)) ?? 0) + 1);
    for (const [l, els] of this.hidden) m.set(l, (m.get(l) ?? 0) + els.filter((e) => !e.containerId).length);
    return m;
  }

  // ------------------------------------------------------------------ scene upkeep (called from the board's onChange when idle)
  /** New elements → active layer (with its lock / opacity); keeps the z-order bands. Returns true when it changed the scene. */
  upkeep(): boolean {
    const a = this.api;
    if (!a) return false;
    const els = a.getSceneElementsIncludingDeleted() as El[];
    const act = this.byId(this.meta.active) ?? this.meta.list[0];
    let changed = false;
    // 1) new elements → a layer (containers first, so bound text takes its container's new layer)
    const assign = new Map<string, string>();
    for (const e of els) if (!this.known.has(e.id) && !e.isDeleted && !e.customData?.lumenLayer && !e.containerId) assign.set(e.id, act.id);
    let next = els.map((e) => {
      if (this.known.has(e.id)) return e;
      this.known.add(e.id);
      if (e.isDeleted || e.customData?.lumenLayer) return e;
      const layer = e.containerId ? assign.get(e.containerId) ?? this.layerOf(els.find((x) => x.id === e.containerId) ?? e) : act.id;
      changed = true;
      return bump(this.styled({ ...e, customData: { ...(e.customData ?? {}), lumenLayer: layer } }, this.byId(layer)));
    });
    // 2) bands: bottom → top layer, stable; bound text stays right after its container (Excalidraw's index invariant)
    const byId = new Map(next.map((e) => [e.id, e]));
    const pos = new Map(next.map((e, i) => [e.id, i]));
    const r = (e: El) => this.rank(this.layerOf(e.containerId ? byId.get(e.containerId) ?? e : e));
    const at = (e: El) => (e.containerId && pos.has(e.containerId) ? pos.get(e.containerId)! + 0.5 : pos.get(e.id)!);
    let last = -1, sorted = true;
    for (const e of next) { if (e.isDeleted) continue; const k = r(e); if (k < last) { sorted = false; break; } last = k; }
    if (!sorted) { next = [...next].sort((x, y) => r(x) - r(y) || at(x) - at(y)); changed = true; }
    if (!changed) return false;
    a.updateScene({ elements: next, captureUpdate: "NEVER" });
    return true;
  }
  private styled(e: El, l: Layer | undefined): El {
    if (!l) return e;
    const cd = { ...(e.customData ?? {}) };
    let out: El = { ...e };
    if (l.locked && !e.locked) { out.locked = true; cd.lumenLayerLock = true; }
    const op = l.opacity ?? 100;
    if (op !== 100) { const base = (cd.lumenOpBase as number | undefined) ?? e.opacity ?? 100; cd.lumenOpBase = base; out.opacity = Math.round((base * op) / 100); }
    out = { ...out, customData: cd };
    return out;
  }
  /** External file change (sync): new meta + split again. Returns the visible elements. */
  reload(meta: Partial<LayersMeta> | undefined, all: readonly El[]): El[] {
    if (meta?.list?.length) this.meta = { list: meta.list.map((l) => ({ ...l })), active: meta.active ?? meta.list[0].id };
    const vis = this.split(all);
    this.emit();
    return vis;
  }

  // ------------------------------------------------------------------ edits (each one undo step where it changes elements)
  private write(fn: (e: El) => El | null, capture: "IMMEDIATELY" | "NEVER" = "IMMEDIATELY", extra?: El[]) {
    const a = this.api;
    if (!a) return;
    const els = a.getSceneElementsIncludingDeleted() as El[];
    const next = els.map((e) => { const r = fn(e); return r ? bump(r) : e; });
    a.updateScene({ elements: restoreElements([...next, ...(extra ?? [])] as never, null, { refreshDimensions: false, repairBindings: true }), captureUpdate: capture });
  }
  private commitMeta() { this.emit(); this.onCommit(); }
  setActive(id: string) { this.meta = { ...this.meta, active: id }; const l = this.byId(id); if (l?.hidden) this.toggleHidden(id); else this.commitMeta(); }
  add(name: string) {
    const l: Layer = { id: rid(), name };
    const i = Math.max(0, this.meta.list.findIndex((x) => x.id === this.meta.active));
    const list = [...this.meta.list]; list.splice(i, 0, l);
    this.meta = { list, active: l.id };
    this.commitMeta();
    return l;
  }
  rename(id: string, name: string) { this.meta = { ...this.meta, list: this.meta.list.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) }; this.commitMeta(); }
  /** Move layer `id` to index `to` in the top-first list (z-order bands follow). */
  reorder(id: string, to: number) {
    const list = this.meta.list.filter((l) => l.id !== id), l = this.byId(id);
    if (!l) return;
    list.splice(Math.max(0, Math.min(list.length, to)), 0, l);
    this.meta = { ...this.meta, list };
    this.commitMeta();
    this.upkeep();
    this.onCommit();
  }
  /** Delete a layer: its items move to the layer below (or above when it was the bottom one). */
  remove(id: string): { moved: number; into: string } | null {
    const list = this.meta.list, i = list.findIndex((l) => l.id === id);
    if (i < 0 || list.length < 2) return null;
    const into = (list[i + 1] ?? list[i - 1]).id;
    const was = this.byId(id)!;
    if (was.hidden) this.toggleHidden(id);
    let moved = 0;
    const target = this.byId(into);
    this.write((e) => {
      if (e.isDeleted || this.layerOf(e) !== id) return null;
      moved += e.containerId ? 0 : 1;
      const base = this.unstyle(e, was);
      return this.styled({ ...base, customData: { ...(base.customData ?? {}), lumenLayer: into } }, target);
    });
    this.meta = { list: list.filter((l) => l.id !== id), active: this.meta.active === id ? into : this.meta.active };
    this.commitMeta();
    return { moved, into: target?.name ?? "" };
  }
  private unstyle(e: El, l: Layer): El {
    const cd = { ...(e.customData ?? {}) };
    const out: El = { ...e };
    if (l.locked && cd.lumenLayerLock) { out.locked = false; delete cd.lumenLayerLock; }
    if (cd.lumenOpBase != null) { out.opacity = cd.lumenOpBase as number; delete cd.lumenOpBase; }
    return { ...out, customData: cd };
  }
  toggleHidden(id: string) {
    const a = this.api, l = this.byId(id);
    if (!a || !l) return;
    if (!l.hidden) {
      const els = a.getSceneElementsIncludingDeleted() as El[];
      const gone = els.filter((e) => !e.isDeleted && this.layerOf(e.containerId ? els.find((x) => x.id === e.containerId) ?? e : e) === id);
      const ids = new Set(gone.map((e) => e.id));
      this.hidden.set(id, gone);
      a.updateScene({ elements: els.filter((e) => !ids.has(e.id)), captureUpdate: "NEVER", appState: { selectedElementIds: {} } as never });
    } else {
      const back = this.hidden.get(id) ?? [];
      this.hidden.delete(id);
      for (const e of back) this.known.add(e.id);
      a.updateScene({ elements: [...(a.getSceneElementsIncludingDeleted() as El[]), ...back], captureUpdate: "NEVER" });
    }
    this.meta = { ...this.meta, list: this.meta.list.map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x)) };
    this.upkeep();
    this.commitMeta();
  }
  toggleLock(id: string) {
    const l = this.byId(id);
    if (!l) return;
    const lock = !l.locked;
    this.write((e) => {
      if (e.isDeleted || this.layerOf(e) !== id) return null;
      const cd = { ...(e.customData ?? {}) };
      if (lock && !e.locked) { cd.lumenLayerLock = true; return { ...e, locked: true, customData: cd }; }
      if (!lock && cd.lumenLayerLock) { delete cd.lumenLayerLock; return { ...e, locked: false, customData: cd }; }
      return null;
    }, "IMMEDIATELY");
    for (const e of this.hidden.get(id) ?? []) { if (lock && !e.locked) { e.locked = true; e.customData = { ...(e.customData ?? {}), lumenLayerLock: true }; } }
    this.meta = { ...this.meta, list: this.meta.list.map((x) => (x.id === id ? { ...x, locked: lock } : x)) };
    this.commitMeta();
  }
  /** Layer opacity 0–100; `capture` false while dragging the slider. */
  setOpacity(id: string, op: number, capture = true) {
    this.write((e) => {
      if (e.isDeleted || this.layerOf(e) !== id) return null;
      const cd = { ...(e.customData ?? {}) };
      const base = (cd.lumenOpBase as number | undefined) ?? e.opacity ?? 100;
      if (op === 100) { delete cd.lumenOpBase; return { ...e, opacity: base, customData: cd }; }
      return { ...e, opacity: Math.round((base * op) / 100), customData: { ...cd, lumenOpBase: base } };
    }, capture ? "IMMEDIATELY" : "NEVER");
    this.meta = { ...this.meta, list: this.meta.list.map((x) => (x.id === id ? { ...x, opacity: op } : x)) };
    this.commitMeta();
  }
  /** Move the selection (and bound text) to a layer: one undo step. */
  moveSelection(to: string): number {
    const a = this.api, target = this.byId(to);
    if (!a || !target) return 0;
    const sel = (a.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
    const ids = new Set(Object.keys(sel));
    if (!ids.size) return 0;
    let n = 0;
    this.write((e) => {
      if (e.isDeleted || !(ids.has(e.id) || (e.containerId && ids.has(e.containerId)))) return null;
      if (!e.containerId) n++;
      const from = this.byId(this.layerOf(e));
      const base = from ? this.unstyle(e, from) : e;
      return this.styled({ ...base, customData: { ...(base.customData ?? {}), lumenLayer: to } }, target);
    });
    if (target.hidden) this.toggleHidden(to);
    this.upkeep();
    this.onCommit();
    return n;
  }
}
export const useLayers = (s: LayerStore) => { useSyncExternalStore(s.subscribe, s.version); return s; };
