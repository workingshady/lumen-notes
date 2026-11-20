// AI entry points of the architecture studio (frames 48C–48F, 48J), connected to src/lib/ai-convert.ts and
// src/components/ArchAIPanel.tsx. The studio mounts <ArchAIPanel> itself (slotted); these helpers cover the chooser
// ("Describe it", own root) and plain function access (propose a canvas / review) with the same validation.
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ArchAIPanel from "../ArchAIPanel";
import { editDsl, reviewDsl, type ArchType, type ReviewResult } from "../../lib/ai-convert";
import { applyMinimalEdit } from "../../lib/arch-ops";
import { dslFor, parseDsl } from "../../lib/arch-dsl";
import type { ArchCanvas } from "../../lib/arch-model";
import { t } from "../../lib/i18n";

let root: Root | null = null, host: HTMLDivElement | null = null;
/** "Describe it" (48C) from the chooser: input sheet → validated draft → diff review → `onApply(dsl, type)`. */
export function archAiDescribe(onApply: (dsl: string, type: ArchType | undefined, instruction: string) => void | Promise<void>): void {
  if (!host) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); }
  const close = () => root?.render(createElement("div"));
  root!.render(createElement(ArchAIPanel, { key: Date.now(), mode: "describe", dsl: "", onClose: close, onCreateNote: () => {},
    onApplyDsl: (dsl, meta) => { close(); void onApply(dsl, meta.type, meta.instruction); } }));
}

function checked(c: ArchCanvas, base: string, dsl: string): ArchCanvas {
  const { errors } = parseDsl(dsl, c.lumenArch.kind);
  if (errors.length) throw new Error(t("The AI wrote diagram code that didn’t check out (line {n}). Try again or add detail.", { n: errors[0].line }));
  return applyMinimalEdit(c, base, dsl).canvas; // minimal ops onto the current canvas, not a replacement
}
/** "Edit by instruction" (48D): the proposed canvas (validated, one automatic retry); the caller shows it as a diff with Accept / Reject. */
export async function archAiEdit(c: ArchCanvas, instruction: string): Promise<ArchCanvas> {
  const base = dslFor(c);
  let r = await editDsl(base, instruction);
  const bad = parseDsl(r.dsl, c.lumenArch.kind).errors[0];
  if (bad) r = await editDsl(base, instruction + "\n\n(Your previous answer had a syntax error on line " + bad.line + ": " + bad.message + ". Follow the DSL grammar exactly.)");
  return checked(c, base, r.dsl);
}
/** Header "Review" (48E): explanation, single points of failure, missing controls, STRIDE. */
export async function archAiReview(c: ArchCanvas): Promise<ReviewResult> { return (await reviewDsl(dslFor(c))).review; }
