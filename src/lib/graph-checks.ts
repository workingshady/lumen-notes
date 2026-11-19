/**
 * Connection checks (design round 4, 14b · 4 "Making a connection, correctly" + notes-graph health). Pure logic.
 * - Vault checks for the notes graph: orphans (no link in or out), broken links ([[Title]] with no such note).
 * - Edge checks before a new connection is made (canvas connect dot): self link refused, duplicate (either
 *   direction) = "Already connected", nothing happens on release.
 */
import type { Note } from "../../shared/types";
import { wikiLinks } from "./parse";
import { t } from "./i18n";

export interface BrokenLink { note: Note; target: string }
export interface VaultChecks { orphans: Note[]; broken: BrokenLink[] }

const cache = new Map<string, { v: number; links: string[] }>();
const linksOf = (n: Note) => {
  const hit = cache.get(n.id);
  if (hit && hit.v === n.updatedAt) return hit.links;
  // Canvas / whiteboard bodies are JSON, not Markdown (their card links are checked by the canvas itself).
  const links = n.type === "canvas" || n.type === "whiteboard" ? [] : wikiLinks(n.body);
  cache.set(n.id, { v: n.updatedAt, links });
  return links;
};

export function vaultChecks(notes: Note[], byTitle: Map<string, Note>, outlinks: Map<string, string[]>, backlinks: Map<string, string[]>): VaultChecks {
  const orphans: Note[] = [], broken: BrokenLink[] = [];
  for (const n of notes) {
    if (!(outlinks.get(n.id)?.length) && !(backlinks.get(n.id)?.length)) orphans.push(n);
    for (const target of linksOf(n)) {
      const key = target.toLowerCase();
      // `[[Note.pdf]]`, `[[x.mermaid]]` and `folder/Title` style links resolve by their last segment / bare title too.
      const bare = key.split("/").pop()!.replace(/\.md$/, "");
      if (!byTitle.has(key) && !byTitle.has(bare)) broken.push({ note: n, target });
    }
  }
  return { orphans, broken };
}

export type EdgeCheck = { ok: true } | { ok: false; kind: "self" | "duplicate"; title: string; body: string };

/** Check a new edge from → to against the existing ones (undirected duplicate test, like the design's 14b-K). */
export function checkNewEdge(edges: { from: string; to: string }[], from: string, to: string, name: (id: string) => string = (x) => x): EdgeCheck {
  if (from === to) return { ok: false, kind: "self", title: t("Can't link a card to itself"), body: t("Drag the dot to another card.") };
  const dup = edges.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
  if (dup) return { ok: false, kind: "duplicate", title: t("Already connected"), body: t("{from} → {to} exists.", { from: name(dup.from), to: name(dup.to) }) };
  return { ok: true };
}
