import type { JsonCanvas } from "../../shared/types";
import { tidyCanvas, type CanvasTidy } from "./canvas";

type Opts = Parameters<typeof tidyCanvas>[1];
const BIG = 120; // cards: below this the layout is instant, so it runs inline
let worker: Worker | null = null;
let seq = 0;

/** Tidy layout without freezing the UI on big boards (Worker; falls back to inline when a worker is unavailable). */
export function tidyAsync(c: JsonCanvas, opts: Opts = {}): Promise<CanvasTidy> {
  if ((c.nodes?.length ?? 0) < BIG || typeof Worker === "undefined") return Promise.resolve(tidyCanvas(c, opts));
  return new Promise((resolve) => {
    try {
      worker ??= new Worker(new URL("./tidy-worker.ts", import.meta.url), { type: "module" });
      const w = worker, id = ++seq;
      const done = (r: CanvasTidy) => { w.removeEventListener("message", on); w.removeEventListener("error", fail); resolve(r); };
      const on = (ev: MessageEvent<{ id: number; result?: CanvasTidy; error?: string }>) => { if (ev.data.id !== id) return; if (ev.data.result) done(ev.data.result); else fail(); };
      const fail = () => { w.removeEventListener("message", on); w.removeEventListener("error", fail); worker = null; w.terminate(); resolve(tidyCanvas(c, opts)); };
      w.addEventListener("message", on); w.addEventListener("error", fail);
      w.postMessage({ id, canvas: c, opts });
    } catch { resolve(tidyCanvas(c, opts)); }
  });
}
