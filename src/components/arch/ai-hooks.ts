// AI entry points of the architecture studio (frames 48C–48F). The studio's buttons call these; a later wave (W3-C)
// connects them to src/lib/ai-convert.ts + src/components/AIReview.tsx. Until then each one throws, and the caller
// shows the message, so nothing pretends to work.
import { t } from "../../lib/i18n";
import type { ArchCanvas } from "../../lib/arch-model";

const notYet = () => new Error(t("AI for diagrams is not connected yet."));
/** "Describe it" (48C): prompt → diagram code → review → new diagram. */
export async function archAiDescribe(_prompt?: string): Promise<string> { throw notYet(); }
/** "Edit by instruction" (48D): returns the proposed canvas, shown as a diff with Accept / Reject. */
export async function archAiEdit(_c: ArchCanvas, _instruction: string): Promise<ArchCanvas> { throw notYet(); }
/** Header "Review" (48E): explanation, single points of failure, missing controls, STRIDE. */
export async function archAiReview(_c: ArchCanvas): Promise<unknown> { throw notYet(); }
