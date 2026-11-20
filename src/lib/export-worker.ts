// Export worker: encoding, PDF assembly and ZIP off the main thread. Protocol: {id, op, ...} -> {id, progress} * -> {id, result|error}.
import { buildPdf, encodeBitmap, zipStore } from "./export-encode";

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    let result: unknown;
    if (m.op === "raster") result = await encodeBitmap(m);
    else if (m.op === "pdf") result = await buildPdf(m.pages, m.layout, (i) => self.postMessage({ id: m.id, progress: i }));
    else if (m.op === "zip") result = zipStore(m.files);
    self.postMessage({ id: m.id, result });
  } catch (err) { self.postMessage({ id: m.id, error: (err as Error).message || String(err) }); }
};
