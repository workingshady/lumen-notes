// Whiteboard shell plug-in points (W1-A). Later packages register here instead of editing Whiteboard.tsx:
//   W2-A pens / palettes / lasso, W2-B library, W3-A layers / frames / board settings / presentation, W1-F convert.
// Every hook gets a WbCtx (the Excalidraw API plus a few Lumen helpers) and returns UI or performs the action.
import type { ReactNode } from "react";

/** Excalidraw's imperative API, narrowed to what the shell uses. */
export type WbAPI = {
  getSceneElements: () => readonly Record<string, unknown>[];
  getSceneElementsIncludingDeleted: () => readonly Record<string, unknown>[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (s: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  addFiles: (files: unknown[]) => void;
  setActiveTool: (t: { type: string; locked?: boolean }) => void;
};

/** Panels the header ⋯ menu, header buttons and keyboard shortcuts open. */
export type WbPanel = "settings" | "layers" | "frames" | "present" | "convert" | "handwriting" | "library" | "pens" | "palette";

export interface WbCtx {
  api: WbAPI | null;
  noteId: string;
  kind: "whiteboard" | "board";
  /** Close the open panel / popover. */
  close: () => void;
  /** Ask the board to save now (after programmatic edits). */
  save: () => void;
}

/** A registered panel: rendered by Whiteboard while open (floating desktop panel or phone sheet is up to the panel). */
export type PanelRender = (ctx: WbCtx) => ReactNode;
/** A property-bar / toolbar popover slot, anchored by the shell. */
export type PopoverRender = (ctx: WbCtx & { anchor: DOMRect | null; target: "stroke" | "fill" | "tool" }) => ReactNode;

export interface WbRegistry {
  panels: Partial<Record<WbPanel, PanelRender>>;
  /** Toolbar pen slot caret → pen picker (W2-A). Without it the shell shows its basic ink popover. */
  pens?: PopoverRender;
  /** Property bar colour swatch → palette popover (W2-A). Without it the shell shows the Lumen ink swatches. */
  palette?: PopoverRender;
  /** Shapes split-button caret → shape library (W2-B). Without it the shell shows rectangle / ellipse / diamond. */
  shapes?: PopoverRender;
  /** Lasso tool (W2-A): activate free-form selection. Without it the button falls back to box select. */
  lasso?: (ctx: WbCtx) => void;
  /** Extra controls in the docked pen bar (W2-A): smoothing, pressure, auto-shape (design 33C). */
  inkExtras?: (ctx: WbCtx) => ReactNode;
  /** Current pen look for the toolbar slot (W2-A): glyph name and colour. */
  penLook?: () => { glyph: string; color: string; label: string } | null;
}

export const wbRegistry: WbRegistry = { panels: {} };
const subs = new Set<() => void>();
/** Register a panel or slot; returns an unregister function. Whiteboards re-render on change. */
export function registerWb<K extends keyof WbRegistry>(key: K, value: WbRegistry[K]) {
  (wbRegistry as unknown as Record<string, unknown>)[key] = value;
  subs.forEach((f) => f());
  return () => { if (wbRegistry[key] === value) { delete (wbRegistry as unknown as Record<string, unknown>)[key]; subs.forEach((f) => f()); } };
}
export function registerPanel(id: WbPanel, render: PanelRender) {
  wbRegistry.panels[id] = render;
  subs.forEach((f) => f());
  return () => { if (wbRegistry.panels[id] === render) { delete wbRegistry.panels[id]; subs.forEach((f) => f()); } };
}
export function onRegistry(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
