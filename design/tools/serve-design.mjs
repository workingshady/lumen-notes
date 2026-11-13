// Static server for a Claude Design handoff so its .dc.html prototypes render in a browser.
// Usage: node design/tools/serve-design.mjs [port] [folder]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const port = Number(process.argv[2] ?? 5390);
const root = path.resolve(process.argv[3] ?? "design/handoffs/2026-11-13-rounds-1-3/project");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`design files on http://localhost:${port}/`));
