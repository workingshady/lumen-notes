// Worker for "Tidy up" on big canvases: the layered / force layout runs off the main thread so the board stays responsive.
import { tidyCanvas } from "./canvas";

self.onmessage = (ev: MessageEvent<{ id: number; canvas: Parameters<typeof tidyCanvas>[0]; opts: Parameters<typeof tidyCanvas>[1] }>) => {
  const { id, canvas, opts } = ev.data;
  try { (self as unknown as Worker).postMessage({ id, result: tidyCanvas(canvas, opts) }); }
  catch (e) { (self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message ?? e) }); }
};
