/**
 * Undo / redo for the canvas editor (components/CanvasEditor.tsx).
 *
 * Snapshot history: each entry is the whole board as JSON Canvas text plus the selection at that moment, so undo
 * restores what was selected too (Figma, tldraw). Snapshots, not commands, because every change path (drag, React
 * Flow deletes, the JSON panel, scripts, Tidy up, sync) already ends as a new board state; a canvas is small text.
 *
 * - `record()` is called once the board has settled (not per drag frame: the editor skips it while a drag or resize
 *   is running, like the React Flow undo example that snapshots on drag start / stop).
 * - Coalescing: two records with the same `key` inside `window` ms become one step (typing in one card, arrow-key
 *   nudges, JSON typing), like tldraw's history marks / squashing.
 * - A new change clears the redo stack; the stack is capped (oldest dropped).
 * - `absorb()` takes a change that isn't the owner's action (sync, another tab, an undo/redo load) as the new base
 *   without adding a step. Pan / zoom never reach here (the viewport isn't part of the snapshot).
 */
export interface Snap { body: string; sel: string[] }

export class CanvasHistory {
  private past: Snap[] = [];
  private future: Snap[] = [];
  private base: Snap;
  private lastKey: string | undefined;
  private lastAt = 0;
  constructor(body: string, readonly cap = 100, readonly window = 1000) { this.base = { body, sel: [] }; }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get size() { return { past: this.past.length, future: this.future.length }; }
  get body() { return this.base.body; }

  /** The board settled at `body`. Returns true when a step was added (or merged into the last one). */
  record(body: string, sel: string[], key?: string, now = Date.now()): boolean {
    if (body === this.base.body) { this.base = { body, sel }; return false; }
    const merge = !!key && key === this.lastKey && now - this.lastAt < this.window && this.past.length > 0;
    if (!merge) {
      this.past.push(this.base);
      if (this.past.length > this.cap) this.past.splice(0, this.past.length - this.cap);
    }
    this.future = [];
    this.base = { body, sel };
    this.lastKey = key;
    this.lastAt = now;
    return true;
  }

  /** The selection the next step should restore on undo (e.g. the cards a drag picked up). */
  select(sel: string[]) { this.base = { ...this.base, sel }; }

  /** Take `body` as the current state without a history step. */
  absorb(body: string, sel: string[]) { this.base = { body, sel }; this.lastKey = undefined; }

  /** Step back. `sel` = the selection now (kept with the redo entry). Returns the snapshot to load, or null. */
  undo(sel: string[]): Snap | null {
    const p = this.past.pop();
    if (!p) return null;
    this.future.push({ body: this.base.body, sel });
    this.base = p;
    this.lastKey = undefined;
    return p;
  }

  redo(sel: string[]): Snap | null {
    const f = this.future.pop();
    if (!f) return null;
    this.past.push({ body: this.base.body, sel });
    this.base = f;
    this.lastKey = undefined;
    return f;
  }

  clear(body: string) { this.past = []; this.future = []; this.base = { body, sel: [] }; this.lastKey = undefined; }
}
