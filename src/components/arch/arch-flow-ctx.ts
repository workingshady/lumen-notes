// Shared board context and types of the architecture studio's React Flow pieces. Kept apart from ArchFlow.tsx so that
// ArchEdge does not import ArchFlow (which imports ArchEdge): in the production bundle that cycle left
// `edgeTypes.arch` undefined, so React Flow drew its default edge (no arrows, labels, bend handles or reconnect).
import { createContext } from "react";
import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";
import type { Side } from "../../../shared/types";
import type { AEdge, ANode, DiffMark } from "../../lib/arch-model";
import type { Route } from "../../lib/arch-route";
import type { RouteSrc } from "../../lib/arch-render";
import type { LabelPart } from "../../lib/arch-label";

export const DC: Record<DiffMark, string> = { add: "var(--success)", del: "var(--danger)", chg: "var(--warning)" };
export interface FlowCtx {
  hl: string | null; sel: string | null; editing: string | null;
  /** Edge editing: read-only in diff / present, the label being edited inline, and the board callbacks (each one undo step). */
  ro: boolean; editEdge: { id: string; part: LabelPart } | null; setEditEdge: (x: { id: string; part: LabelPart } | null) => void;
  saveLabel: (id: string, part: LabelPart, text: string) => void; patchEdge: (id: string, fn: (e: AEdge) => AEdge) => void; labelClick: (id: string) => void;
  setHover: (id: string | null) => void; rename: (id: string, v: string) => void; stopEdit: () => void; toggleCollapse: (id: string) => void; inside: (id: string) => number;
  /** Interview mode: node ids whose label is still hidden; clicking reveals. */
  masked?: Set<string>;
  /** Select an edge (pressing its line starts a bend drag), and move one end of it onto a node (side = that node's port, undefined = automatic). */
  selectEdge?: (id: string) => void;
  reconnect?: (id: string, end: "source" | "target", node: string, side?: Side) => void;
  /** Screen pixel → node id + nearest side under it (reconnect / quick connect targets). */
  nodeAt?: (x: number, y: number) => { id: string; side: Side } | null;
}
export const Ctx = createContext<FlowCtx>({ ro: false, editEdge: null, setEditEdge: () => {}, saveLabel: () => {}, patchEdge: () => {}, labelClick: () => {}, hl: null, sel: null, editing: null, setHover: () => {}, rename: () => {}, stopEdit: () => {}, toggleCollapse: () => {}, inside: () => 0 });
export type NData = { n: ANode; mark?: DiffMark; chip?: string; ghost?: boolean; /** Sequence diagrams: lifeline length under the participant. */ life?: number };
export type FlowNode = RFNode<NData>;
export type EData = { e: AEdge; r: Route; src: RouteSrc; mark?: DiffMark };
export type FlowEdge = RFEdge<EData>;
