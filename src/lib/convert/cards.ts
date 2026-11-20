// Board cards (round 7 · 40D–40G, 45E): the data behind an Excalidraw embeddable that Lumen draws live.
// File stays open: a card is a plain `embeddable` element (with a link), Lumen-only data under customData.lumenCard.
export type CardKind = "note" | "mermaid" | "link" | "pdf";
export type NoteState = "collapsed" | "card" | "expanded";
export interface LumenCard {
  kind: CardKind;
  /** note: the note; mermaid: a `.mermaid` file note (live); pdf: the PDF note. */
  noteId?: string;
  /** Remembered title (shows on a missing note; resolves cards made from canvas file nodes by title). */
  title?: string;
  state?: NoteState;
  /** mermaid without a file: the inline source. */
  src?: string;
  mode?: "view" | "edit";
  url?: string;
  page?: number;
}
export type CardSkeleton = Record<string, unknown> & { type: "embeddable" };

export const CARD_SIZE: Record<string, [number, number]> = { "note:card": [260, 140], "note:collapsed": [240, 44], "note:expanded": [320, 250], mermaid: [330, 180], link: [280, 170], pdf: [240, 230] };
export const noteSize = (s: NoteState | undefined) => CARD_SIZE[`note:${s ?? "card"}`];
const rnd = () => Math.random().toString(36).slice(2, 10);

export function cardLink(c: LumenCard): string {
  if (c.kind === "note") return `lumen:note/${c.noteId ?? rnd()}`;
  if (c.kind === "link") return c.url ?? "https://example.com";
  if (c.kind === "pdf") return `lumen:pdf/${c.noteId ?? rnd()}#page=${c.page ?? 1}`;
  return `lumen:mermaid/${c.noteId ?? rnd()}`;
}

export function cardSkeleton(c: LumenCard, x: number, y: number, o: { id?: string; w?: number; h?: number } = {}): CardSkeleton {
  const [w, h] = c.kind === "note" ? noteSize(c.state) : CARD_SIZE[c.kind];
  return { type: "embeddable", ...(o.id ? { id: o.id } : {}), x, y, width: o.w ?? w, height: o.h ?? h, link: cardLink(c), roughness: 0, strokeColor: "transparent", backgroundColor: "transparent", customData: { lumenCard: c } };
}

/** The card an element carries (also the plain note card of an earlier build: rectangle + customData.lumenNote). */
export function cardOf(e: { type?: string; customData?: Record<string, unknown> | null }): LumenCard | null {
  const d = e.customData;
  if (!d) return null;
  if (d.lumenCard && typeof d.lumenCard === "object") return d.lumenCard as LumenCard;
  if (typeof d.lumenNote === "string") return { kind: "note", noteId: d.lumenNote };
  return null;
}

/** A sticky with who and where it came from (design 40D: "Pixel 8 · Sara"): the sticky and its footer text. */
export function stickyWithAuthor(x: number, y: number, text: string, color: number, who: { device: string; author?: string }, id = rnd()): Record<string, unknown>[] {
  const FILL = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
  return [
    { type: "rectangle", id, x, y, width: 200, height: 160, backgroundColor: FILL[color % FILL.length], fillStyle: "solid", strokeColor: "transparent", roundness: { type: 3 }, customData: { lumenSticky: { device: who.device, ...(who.author ? { author: who.author } : {}) } }, label: { text, fontSize: 18, strokeColor: "#000000" } },
    { type: "text", x: x + 12, y: y + 136, text: [who.device, who.author].filter(Boolean).join(" · "), fontSize: 12, strokeColor: "#6b6b6b", fontFamily: 2 },
  ];
}
