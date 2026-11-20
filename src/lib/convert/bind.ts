// convertToExcalidrawElements that also takes live cards (embeddables): Excalidraw's own skeleton converter passes an
// embeddable through half-made and can't bind an arrow to one. This fills the embeddable's defaults (restoreElements) and
// builds such arrows itself: edge to edge between the boxes, bound at both ends, so they follow when a card moves.
import { placeBoundArrows, type Skeleton } from "../whiteboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = Record<string, any>;

export async function convertSkeleton(skel: Skeleton[], opts: { regenerateIds?: boolean } = { regenerateIds: false }, existing: readonly El[] = []): Promise<El[]> {
  const { convertToExcalidrawElements, restoreElements } = await import("@excalidraw/excalidraw");
  const emb = new Set(existing.filter((e) => e.type === "embeddable").map((e) => e.id as string));
  for (const k of skel) if (k.type === "embeddable" && typeof k.id === "string") emb.add(k.id);
  const touches = (k: Skeleton) => k.type === "arrow" && [k.start, k.end].some((x) => x && typeof x === "object" && emb.has(String((x as { id?: unknown }).id)));
  const manual = skel.filter(touches), rest = skel.filter((k) => !touches(k));
  const out = convertToExcalidrawElements(placeBoundArrows(rest, existing as never) as never, { regenerateIds: opts.regenerateIds ?? false }) as unknown as El[];
  const done = out.map((e) => (e.type === "embeddable" ? (restoreElements([e] as never, null) as unknown as El[])[0] : e));
  if (!manual.length) return done;
  const placed = placeBoundArrows(manual, [...existing, ...rest, ...skel.filter((k) => k.type === "embeddable")] as never);
  const byId = new Map<string, El>([...existing, ...done].map((e) => [e.id as string, e]));
  const arrows: El[] = [];
  for (const k of placed) {
    const s = String((k.start as { id?: unknown } | undefined)?.id ?? ""), t = String((k.end as { id?: unknown } | undefined)?.id ?? "");
    const { start, end, ...plain } = k; void start; void end;
    const made = convertToExcalidrawElements([plain as never], { regenerateIds: true }) as unknown as El[];
    const a = made.find((e) => e.type === "arrow")!;
    const bind = (id: string) => (byId.has(id) ? { elementId: id, focus: 0, gap: 6 } : null);
    a.startBinding = bind(s);
    a.endBinding = bind(t);
    for (const id of [s, t]) {
      const target = byId.get(id);
      if (target) target.boundElements = [...(target.boundElements ?? []), { id: a.id, type: "arrow" }];
    }
    arrows.push(...made); // arrow + its label text
  }
  return [...done, ...arrows];
}
