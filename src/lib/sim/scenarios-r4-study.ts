// Dev simulator scenario: "Study features (round 4)". One self-contained data set that exercises every state of
// the study features: Today (all sections, missed days + reschedule, week view, goals), flashcards + FSRS (new /
// learning / review / relearning / suspended cards with a realistic review log for "Optimize from history"),
// cloze (`{{c1::}}`, `==x==` in flashcard notes), image occlusion (hide-one with groups, hide-all), the PDF reader
// (real 15-page PDF with outline + text and area highlights, a password-protected PDF, a scanned image-only PDF,
// a finished PDF for the library), video timestamps (YouTube chips + a real recorded MP4/WebM so seeking works),
// a learning path (mastery, revisions due, test-out practice, locked concepts that unlock) and streak moments.
//
// `seedR4Study(v)` only APPENDS records (ids prefixed `r4s-`) to the vault it is given and never clears anything, so
// it can be composed into a bigger "everything" scenario. The one exception to the prefix is the Today plan log note, whose id is
// fixed by the app (`lumen-study-plan`). Timestamps are relative to the (pinned) clock at seed time and every record
// is dated before today 00:00, so the streak moment fires on today's first activity. See docs/DEV_SIMULATOR.md.
import type { Card, Note, ReviewLog } from "../../../shared/types";
import { demoPdf } from "../demo-pdf";
import { DEFAULT_PARAMS, memoryOf, retrievability, schedule, type FsrsCard, type Grade } from "../fsrs";
import { flashcards } from "../parse";
import { serializeHighlight, type Highlight } from "../pdf-format";
import { attachment, clock, DAY, emptyVault, HOUR, MIN, note, rng, session, space, type Clock, type Vault } from "./kit";

const F = "```";
const NL = String.fromCharCode(10);

// ------------------------------------------------------------------ binary PDF helpers (no dependencies)
type Chunk = string | Uint8Array;
const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...xs: Uint8Array[]) => { const out = new Uint8Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };

/** MD5 (RFC 1321) over bytes: needed for the PDF standard security handler. */
function md5(data: Uint8Array): Uint8Array {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const len = data.length, n = ((len + 8) >>> 6) + 1;
  const buf = new Uint8Array(n * 64);
  buf.set(data); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n * 64 - 8, (len * 8) >>> 0, true); dv.setUint32(n * 64 - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < buf.length; o += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (B & C) | (~B & D); g = i; } else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) % 16; } else { f = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      f = (f + A + K[i] + dv.getUint32(o + g * 4, true)) >>> 0;
      A = D; D = C; C = B; B = (B + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
  return out;
}
const PAD = new Uint8Array([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const padPw = (pw: string) => { const b = latin1(pw).slice(0, 32); return cat(b, PAD.slice(0, 32 - b.length)); };

/**
 * Assemble a PDF from objects (1-based; each a list of chunks). `streams[i]` = raw stream bytes of object i, written
 * after its dictionary (RC4-encrypted per object when `enc` is given: Standard security handler, V1 R2, 40-bit).
 */
function assemble(objs: { dict: string; stream?: Uint8Array }[], trailer: string, enc?: { key: Uint8Array; skip: number }): Uint8Array {
  const parts: Uint8Array[] = [latin1("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  let size = parts[0].length;
  const offs: number[] = [];
  const push = (c: Chunk) => { const b = typeof c === "string" ? latin1(c) : c; parts.push(b); size += b.length; };
  objs.forEach((o, i) => {
    const num = i + 1;
    offs.push(size);
    if (!o.stream) { push(`${num} 0 obj\n${o.dict}\nendobj\n`); return; }
    let data = o.stream;
    if (enc && num !== enc.skip) {
      const k = md5(cat(enc.key, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]))).slice(0, Math.min(16, enc.key.length + 5));
      data = rc4(k, data);
    }
    push(`${num} 0 obj\n<< ${o.dict} /Length ${data.length} >>\nstream\n`); push(data); push(`\nendstream\nendobj\n`);
  });
  const xref = size;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size ${objs.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`);
  return cat(...parts);
}
const pdfStr = (s: string) => s.replace(/[()\\]/g, (c) => "\\" + c);
/** Text pages (Helvetica) as content streams: a title then lines. */
function textPages(pages: { title: string; lines: string[] }[]) {
  return pages.map((p) => latin1(`BT /F2 22 Tf 64 720 Td (${pdfStr(p.title)}) Tj ET\nBT /F1 13 Tf 64 680 Td 20 TL ${p.lines.map((l) => `(${pdfStr(l)}) Tj T*`).join(" ")} ET\n`));
}
/** A plain multi-page text PDF; with `password`, encrypted so it can only be opened with that user password. */
function textPdf(pages: { title: string; lines: string[] }[], password?: string): Blob {
  const n = pages.length;
  const contents = textPages(pages);
  // 1 catalog, 2 pages, 3 F1, 4 F2, then per page (page, content), then [encrypt]
  const objs: { dict: string; stream?: Uint8Array }[] = [
    { dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { dict: `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>` },
    { dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" },
    { dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>" },
  ];
  contents.forEach((c, i) => {
    objs.push({ dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>` });
    objs.push({ dict: "", stream: c });
  });
  if (!password) return new Blob([assemble(objs, "/Root 1 0 R") as BlobPart], { type: "application/pdf" });
  const id = md5(latin1("lumen-r4s-locked-pdf"));
  const P = -4;
  const okey = md5(padPw("lumen-owner-r4")).slice(0, 5);
  const O = rc4(okey, padPw(password));
  const pb = new Uint8Array(4); new DataView(pb.buffer).setInt32(0, P, true);
  const key = md5(cat(padPw(password), O, pb, id)).slice(0, 5);
  const U = rc4(key, PAD);
  objs.push({ dict: `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>` });
  const encNum = objs.length;
  return new Blob([assemble(objs, `/Root 1 0 R /Encrypt ${encNum} 0 R /ID [<${hex(id)}> <${hex(id)}>]`, { key, skip: encNum }) as BlobPart], { type: "application/pdf" });
}
/** A "scanned" PDF: every page is one JPEG image, no text layer at all. */
async function scannedPdf(pages: number): Promise<Blob> {
  const imgs: Uint8Array[] = [];
  for (let p = 0; p < pages; p++) {
    const cv = document.createElement("canvas");
    cv.width = 850; cv.height = 1100;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#efeadd"; g.fillRect(0, 0, 850, 1100);
    g.save(); g.translate(425, 550); g.rotate((p % 2 ? -0.6 : 0.8) * Math.PI / 180); g.translate(-425, -550);
    g.fillStyle = "#2b2823"; g.font = "bold 38px Georgia, serif"; g.fillText(p === 0 ? "Lecture 4 handout (scanned)" : `Handout, page ${p + 1}`, 90, 130);
    const r = rng(17 + p);
    g.font = "22px Georgia, serif";
    for (let l = 0; l < 26; l++) {
      if (l === 9) { g.strokeStyle = "#3a352d"; g.lineWidth = 2; g.strokeRect(150, 420, 540, 230); g.beginPath(); g.moveTo(170, 630); for (let x = 0; x < 50; x++) g.lineTo(170 + x * 10, 630 - 180 * Math.exp(-x / 14)); g.stroke(); g.fillText("Figure: training loss over epochs", 230, 690); l = 15; continue; }
      const w = 520 + r.int(-120, 120);
      g.fillStyle = "rgba(43,40,35,.82)";
      let x = 90;
      while (x < 90 + w) { const ww = r.int(30, 110); g.fillRect(x, 190 + l * 34, ww, 9); x += ww + r.int(10, 16); }
    }
    g.restore();
    g.fillStyle = "rgba(90,80,60,.08)"; for (let i = 0; i < 400; i++) g.fillRect(r.int(0, 850), r.int(0, 1100), 2, 2);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/jpeg", 0.72));
    imgs.push(new Uint8Array(await (blob ?? new Blob()).arrayBuffer()));
  }
  const objs: { dict: string; stream?: Uint8Array }[] = [
    { dict: "<< /Type /Catalog /Pages 2 0 R >>" },
    { dict: `<< /Type /Pages /Count ${pages} /Kids [${imgs.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>` },
  ];
  imgs.forEach((img, i) => {
    const pg = 3 + i * 3;
    objs.push({ dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>` });
    objs.push({ dict: "", stream: latin1("q 612 0 0 792 0 0 cm /Im1 Do Q\n") });
    objs.push({ dict: "/Type /XObject /Subtype /Image /Width 850 /Height 1100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", stream: img });
  });
  return new Blob([assemble(objs, "/Root 1 0 R") as BlobPart], { type: "application/pdf" });
}

// ------------------------------------------------------------------ images + video
const canvasPng = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!);
  return new Promise<Blob>((r) => cv.toBlob((b) => r(b ?? new Blob([], { type: "image/png" })), "image/png"));
};
/** Transformer encoder block diagram (800×560). Label boxes are at known places so the occlusion boxes cover them. */
const BLOCK_LABELS: { label: string; x: number; y: number; w: number; h: number; group?: string }[] = [
  { label: "Output", x: 300, y: 30, w: 200, h: 44 },
  { label: "Add & norm", x: 300, y: 110, w: 200, h: 44, group: "norm" },
  { label: "Feed forward", x: 300, y: 190, w: 200, h: 44 },
  { label: "Add & norm", x: 300, y: 270, w: 200, h: 44, group: "norm" },
  { label: "Multi-head attention", x: 280, y: 350, w: 240, h: 44 },
  { label: "Positional encoding", x: 560, y: 430, w: 210, h: 44 },
  { label: "Input embedding", x: 300, y: 490, w: 200, h: 44 },
];
const blockPng = () => canvasPng(800, 560, (g) => {
  g.fillStyle = "#fbf8f1"; g.fillRect(0, 0, 800, 560);
  g.strokeStyle = "#8c8578"; g.lineWidth = 2;
  g.strokeRect(250, 95, 300, 320); g.fillStyle = "#6a655c"; g.font = "italic 16px sans-serif"; g.fillText("N ×", 205, 260);
  g.beginPath(); g.moveTo(400, 490); g.lineTo(400, 74); g.stroke();
  g.beginPath(); g.arc(400, 452, 12, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(392, 452); g.lineTo(408, 452); g.moveTo(400, 444); g.lineTo(400, 460); g.stroke();
  g.beginPath(); g.moveTo(560, 452); g.lineTo(412, 452); g.stroke();
  const fills: Record<string, string> = { "Multi-head attention": "#f6d9a8", "Feed forward": "#cfe3f7", "Add & norm": "#f3f0b5", "Input embedding": "#f6c9c9", "Positional encoding": "#ffffff", Output: "#d7efd9" };
  for (const b of BLOCK_LABELS) {
    g.fillStyle = fills[b.label] ?? "#fff"; g.fillRect(b.x, b.y, b.w, b.h); g.strokeRect(b.x, b.y, b.w, b.h);
    g.fillStyle = "#1f1d1a"; g.font = "600 18px sans-serif"; g.textAlign = "center"; g.fillText(b.label, b.x + b.w / 2, b.y + 28); g.textAlign = "start";
  }
});
/** A neuron diagram (720×420) for the hide-all occlusion. */
const NEURON_LABELS = [
  { label: "Dendrites", x: 30, y: 60, w: 150, h: 40 },
  { label: "Cell body", x: 230, y: 300, w: 150, h: 40 },
  { label: "Axon", x: 420, y: 130, w: 110, h: 40 },
  { label: "Synapse", x: 560, y: 300, w: 140, h: 40 },
];
const neuronPng = () => canvasPng(720, 420, (g) => {
  g.fillStyle = "#f7f4ec"; g.fillRect(0, 0, 720, 420);
  g.strokeStyle = "#7a4bd1"; g.lineWidth = 5;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(260, 210); g.lineTo(120 + i * 18, 110 + (i % 3) * 50); g.stroke(); }
  g.fillStyle = "#b48ef0"; g.beginPath(); g.arc(280, 220, 55, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(335, 220); g.bezierCurveTo(420, 200, 520, 250, 620, 230); g.stroke();
  g.fillStyle = "#e8b34a"; g.beginPath(); g.arc(630, 232, 18, 0, Math.PI * 2); g.fill();
  for (const b of NEURON_LABELS) { g.fillStyle = "#fff"; g.fillRect(b.x, b.y, b.w, b.h); g.strokeStyle = "#6a655c"; g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h); g.fillStyle = "#1f1d1a"; g.font = "600 18px sans-serif"; g.textAlign = "center"; g.fillText(b.label, b.x + b.w / 2, b.y + 26); g.textAlign = "start"; }
});
/** Area-highlight crop of the PDF's figure 2 (PNG, as the reader would capture it). */
const figurePng = () => canvasPng(468, 170, (g) => {
  g.fillStyle = "#fff"; g.fillRect(0, 0, 468, 170);
  g.strokeStyle = "#8c8578"; g.font = "11px sans-serif"; g.textAlign = "center";
  [["MatMul", 10], ["SoftMax", 38], ["Mask (opt.)", 66], ["Scale", 94], ["MatMul", 122]].forEach(([l, y]) => { g.fillStyle = "#f5f2eb"; g.fillRect(189, Number(y), 90, 18); g.strokeRect(189, Number(y), 90, 18); g.fillStyle = "#1f1d1a"; g.fillText(String(l), 234, Number(y) + 13); });
  g.fillText("Q", 204, 160); g.fillText("K", 234, 160); g.fillText("V", 274, 160);
});

/**
 * A real short video (canvas + MediaRecorder) with a big running clock, so seeking can be checked by eye.
 * MP4 (H.264) where the browser records it (Chrome/Edge 126+: proper duration, seekable); otherwise WebM, which
 * MediaRecorder writes without a duration (still plays; seeking works once loaded). Returns a 4-byte stub when
 * MediaRecorder is missing (e.g. a headless runtime without canvas capture).
 */
async function recordClip(seconds: number): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  try {
    const w = 640, h = 360;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    const stream = (cv as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(30);
    if (!stream || typeof MediaRecorder === "undefined") throw new Error("no MediaRecorder");
    const type = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const rec = new MediaRecorder(stream, { mimeType: type });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    const t0 = performance.now();
    let raf = 0;
    const draw = () => {
      const t = Math.min(seconds, (performance.now() - t0) / 1000);
      g.fillStyle = "#14181f"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#f2a93b"; g.fillRect(0, h - 10, (w * t) / seconds, 10);
      for (let k = 0; k <= seconds; k++) { g.fillStyle = "#3a414d"; g.fillRect((w * k) / seconds - 1, h - 22, 2, 12); }
      g.fillStyle = "#e8e6e1"; g.textAlign = "center";
      g.font = "bold 120px monospace"; g.fillText(`0:${String(Math.floor(t)).padStart(2, "0")}`, w / 2, h / 2 + 30);
      g.font = "22px sans-serif"; g.fillStyle = "#9aa0aa";
      const scene = ["Forward pass", "Loss", "Backward pass", "Weight update"][Math.min(3, Math.floor((t / seconds) * 4))];
      g.fillText(`Backprop in 4 scenes · ${scene}`, w / 2, 60);
      raf = requestAnimationFrame(draw);
    };
    draw();
    rec.start(500);
    await new Promise((r) => setTimeout(r, seconds * 1000 + 150));
    rec.stop();
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((tr) => tr.stop());
    const blob = new Blob(parts, { type: `video/${ext}` });
    if (blob.size) return { blob, ext };
  } catch { /* fall through */ }
  return { blob: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "video/webm" }), ext: "webm" };
}

// ------------------------------------------------------------------ FSRS history simulation
type Fate = "review" | "due" | "learning" | "relearning" | "suspended";
/**
 * Replays a card's life with the real scheduler (lib/fsrs.ts, default params) from `start` until before today,
 * grading with a "true" memory that is 40 % more stable than the default weights predict, so the log has
 * realistic outcomes and Optimize from history moves the weights. Returns the final card + its log rows.
 */
function simulate(id: string, noteId: string, start: number, fate: Fate, c: Clock, r: ReturnType<typeof rng>, logId: () => string): { card: Card; logs: ReviewLog[] } {
  let card: Card = { id, noteId, ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0, updatedAt: 0, deleted: 0, dirty: 0 };
  const logs: ReviewLog[] = [];
  const stopAt = c.t0 - 3 * HOUR; // yesterday 21:00: nothing is dated today
  const review = (at: number, force?: Grade) => {
    const fc = card as FsrsCard;
    const m = memoryOf(fc, at);
    const elapsed = m.state === "new" ? 0 : Math.max(0, (at - (fc.lastReview ?? at)) / DAY);
    let g: Grade;
    if (force !== undefined) g = force;
    else {
      const p = m.state === "review" ? retrievability(elapsed, m.s * 1.4) : m.state === "new" ? 0.75 : 0.88;
      const ok = r.chance(Math.min(0.98, p));
      g = !ok ? 0 : r.chance(0.12) ? 1 : r.chance(0.16) ? 3 : 2;
    }
    const next = schedule(card, g, at, DEFAULT_PARAMS);
    logs.push({ id: logId(), cardId: id, noteId, at, grade: g, state: m.state, elapsed: Math.round(elapsed * 100) / 100, scheduled: Math.round(((next.due - at) / DAY) * 1000) / 1000, updatedAt: at, deleted: 0, dirty: 0 });
    card = { ...next, updatedAt: at, dirty: 0, deleted: 0 };
  };
  if (fate === "learning") {
    // first seen yesterday evening, Good → in the 10-minute learning step, due now
    review(c.t0 - 2 * HOUR - 20 * MIN, 2);
    return { card, logs };
  }
  let at = start;
  for (let guard = 0; guard < 60; guard++) {
    if (at >= stopAt) break;
    review(at);
    const step = card.due - at < DAY;
    // learning steps: a few minutes later; reviews: on the due day in the evening (sometimes a day or two late)
    at = step ? card.due + r.int(0, 4) * MIN : (() => { const d = new Date(card.due); d.setHours(18 + r.int(0, 4), r.int(0, 59), 0, 0); return d.getTime() + (r.chance(0.2) ? r.int(1, 2) * DAY : 0); })();
  }
  if (fate === "relearning") {
    // forgotten yesterday evening: Again → relearning step, due now
    const t = c.t0 - 90 * MIN;
    if ((card.lastReview ?? 0) < t && (card as FsrsCard).state === "review") review(t, 0);
  }
  if (fate === "due" && card.due > c.now) {
    // pull the schedule back so the card is due today (a late review, as after a missed day)
    const back = card.due - (c.t0 + 9 * HOUR);
    card = { ...card, due: card.due - back, lastReview: (card.lastReview ?? 0) - back };
    for (const l of logs) { l.at -= back; l.updatedAt = l.at; }
    card.updatedAt = Math.min(card.updatedAt - back, stopAt);
  }
  if (fate === "suspended") card = { ...card, suspended: 1 };
  return { card, logs };
}

// ------------------------------------------------------------------ content
const DL = `## 1 Neural network basics
- [x] Logistic regression → [[Logistic regression]]
- [x] Gradient descent
- [x] Vectorization
## 2 Deep networks
- [/] Backpropagation (needs: Gradient descent) 📅 {d-3} → [[Backprop video lecture]]
- [ ] Weight initialization (needs: Backpropagation) 📅 {d-2}
- [ ] Regularization 📅 {d-1} → [[Regularization]]
- [-] Octave tutorial
## 3 Optimization
- [ ] Mini-batch gradient descent (needs: Gradient descent) 📅 {d-1} → [[Mini-batch gradient descent]]
- [ ] Adam (needs: Mini-batch gradient descent) 📅 {d1}
- [ ] Learning rate decay (needs: Adam) 📅 {d4}
## 4 Sequence models
- [ ] Attention (needs: Backpropagation) 📅 {d6} → [[Attention notes]]
- [ ] Transformers (needs: Attention) 📅 {d9}
`;
const NLP = `## Foundations
- [x] Tokenization → [[Tokenization]]
- [x] Word embeddings
- [/] Self-attention 📅 {d-4} → [[Attention notes]]
## Models
- [ ] Encoder-decoder (needs: Self-attention) 📅 {d-2}
- [ ] Positional encoding (needs: Self-attention) 📅 {d2} → [[Positional encoding]]
- [ ] Fine-tuning (needs: Encoder-decoder) 📅 {d12}
`;
const AR = `## الوحدة الأولى
- [x] الجملة الاسمية → [[الجملة الاسمية]]
- [/] الجملة الفعلية 📅 {d-1} → [[الجملة الفعلية]]
- [ ] كان وأخواتها (needs: الجملة الاسمية) 📅 {d3}
- [ ] إن وأخواتها (needs: كان وأخواتها) 📅 {d8}
`;

const DL_CARDS = [
  "What does gradient descent step against? :: The gradient of the loss.", "Why vectorize? :: One matrix product instead of a Python loop.",
  "What does the sigmoid output? :: A probability between 0 and 1.", "Loss of logistic regression? :: Binary cross-entropy.",
  "What does backprop compute? :: The gradient of the loss for every weight, by the chain rule.", "Why not initialise all weights to 0? :: Every unit would learn the same thing.",
  "What is He initialisation for? :: ReLU layers: variance 2/n.", "What does L2 regularisation add? :: λ/2m · Σ‖W‖² to the cost.",
  "What does dropout do at train time? :: Zeroes random activations.", "What is inverted dropout? :: Divide by keep_prob so expected activations stay the same.",
  "Mini-batch size 1 is called? :: Stochastic gradient descent.", "Why mini-batches? :: Fast, noisy steps that still converge.",
  "What does momentum average? :: Past gradients (exponentially weighted).", "Adam combines? :: Momentum and RMSprop.",
  "Typical β1 in Adam? :: 0.9.", "Typical β2 in Adam? :: 0.999.", "Why bias correction in Adam? :: The averages start at 0.",
  "What is learning rate decay? :: Shrinking α as training goes on.", "What does batch norm normalise? :: Each layer's pre-activations per mini-batch.",
  "What is an epoch? :: One pass over the training set.",
];
const AR_CARDS = [
  "ما المبتدأ؟ :: الاسم الذي نبدأ به الجملة الاسمية.", "ما الخبر؟ :: ما يُخبَر به عن المبتدأ.", "ما الفاعل؟ :: من قام بالفعل، ويكون مرفوعًا.",
  "عمل كان وأخواتها؟ :: ترفع المبتدأ وتنصب الخبر.", "عمل إنّ وأخواتها؟ :: تنصب المبتدأ وترفع الخبر.", "What is a nominal sentence (جملة اسمية)? :: A sentence that starts with a noun.",
];

/** Build every record of the scenario (pure data, except the media blobs, which need a DOM). */
async function build(c: Clock) {
  const fill = (s: string) => s.replace(/\{d(-?\d+)\}/g, (_, n) => c.iso(Number(n)));
  const at = (k: number, hm = "19:00") => c.at(k, hm);
  const notes: Note[] = [];
  const add = (n: Note) => { notes.push(n); return n; };
  const files: { id: string; name: string; blob: Blob }[] = [];

  // ---- spaces: three courses (one Arabic) + a reading space for the PDFs and videos
  const spaces = [
    space({ id: "r4s-s-dl", name: "Deep Learning Specialization", kind: "course", icon: "glyph:neural", color: "6", roadmapId: "r4s-rm-dl", sort: 41, props: { provider: "Coursera · DeepLearning.AI", target: c.iso(26), format: "video" } }),
    space({ id: "r4s-s-nlp", name: "NLP with Transformers", kind: "course", icon: "glyph:book", color: "5", roadmapId: "r4s-rm-nlp", sort: 42, props: { provider: "O'Reilly book", format: "book" } }),
    space({ id: "r4s-s-ar", name: "النحو العربي", kind: "course", icon: "glyph:lesson", color: "2", roadmapId: "r4s-rm-ar", sort: 43, props: { provider: "دروس مسجلة", format: "lecture" } }),
    space({ id: "r4s-s-read", name: "Study reading", kind: "resource", icon: "glyph:pdf", color: "3", sort: 44 }),
  ];

  // ---- course roadmaps (overdue topics in all three courses → missed-days banner + reschedule)
  add(note({ id: "r4s-rm-dl", title: "Deep Learning Specialization roadmap", space: "r4s-s-dl", type: "roadmap", body: fill(DL), updated: at(2, "20:10") }));
  add(note({ id: "r4s-rm-nlp", title: "NLP with Transformers roadmap", space: "r4s-s-nlp", type: "roadmap", body: fill(NLP), updated: at(3, "21:00") }));
  add(note({ id: "r4s-rm-ar", title: "النحو العربي — الخطة", space: "r4s-s-ar", type: "roadmap", body: fill(AR), updated: at(4, "20:00") }));

  // ---- media
  const clip = await recordClip(10);
  const clipName = `backprop-in-4-scenes.${clip.ext}`;
  files.push({ id: "r4s-att-clip", name: clipName, blob: clip.blob });
  files.push({ id: "r4s-att-block", name: "transformer-block.png", blob: await blockPng() });
  files.push({ id: "r4s-att-neuron", name: "neuron.png", blob: await neuronPng() });
  files.push({ id: "r4s-att-fig2", name: "Transformers study edition p4 area.png", blob: await figurePng() });
  const d = demoPdf();
  files.push({ id: "r4s-att-pdf", name: "transformers-study-edition.pdf", blob: new Blob([d.bytes as BlobPart], { type: "application/pdf" }) });
  files.push({ id: "r4s-att-locked", name: "exam-answers-locked.pdf", blob: textPdf([
    { title: "Exam answers (locked)", lines: ["This file is protected with the user password: lumen", "If you can read this, the password prompt worked.", "", "Q1  Backprop applies the chain rule.", "Q2  Adam = momentum + RMSprop."] },
    { title: "Page 2", lines: ["Q3  Dropout zeroes random activations.", "Q4  He init: variance 2/n for ReLU layers."] },
  ], "lumen") });
  files.push({ id: "r4s-att-scan", name: "lecture-4-handout-scan.pdf", blob: await scannedPdf(2) });
  files.push({ id: "r4s-att-cheat", name: "fsrs-cheat-sheet.pdf", blob: textPdf([
    { title: "FSRS cheat sheet", lines: ["Stability S: days until recall drops to 90 %.", "Difficulty D: 1 (easy) to 10 (hard).", "Retrievability R: chance you recall it now."] },
    { title: "Grades", lines: ["Again: forgot. Hard: recalled with effort.", "Good: recalled. Easy: instant."] },
    { title: "Settings", lines: ["Desired retention 0.90 is a good default.", "Optimize once you have a few hundred reviews."] },
  ]) });

  // ---- PDF notes: the main paper (text + area highlights, mid-way → Continue pill), locked, scanned, finished
  const PDF_TITLE = "Transformers study edition";
  const H: [Highlight["color"], string, string?, string[]?][] = [
    ["yellow", "Attention lets every position look at every other position in one step.", "The core idea in one line.", ["attention"]],
    ["green", "With attention the path is a single hop, so long-range relations are easier to learn."],
    ["blue", "The output is computed as a weighted sum of the values", undefined, ["attention", "exam"]],
    ["red", "We compute the dot products of the query with all keys, divide each by sqrt(d_k)", "Why sqrt(d_k)? Keeps softmax gradients alive.", ["exam"]],
    ["purple", "Multi-head attention allows the model to jointly attend to information from different subspaces"],
    ["yellow", "with a mask so a position never sees the future"],
  ];
  const ids = ["hl-r4sa01", "hl-r4sa02", "hl-r4sa03", "hl-r4sa04", "hl-r4sa05", "hl-r4sa06"];
  const hs: Highlight[] = H.map(([color, quote, comment, tags], i) => ({ id: ids[i], color, page: d.find(quote).page, quote, comment, tags: tags ?? [], rects: d.find(quote).rects, created: new Date(at(6 - i, "21:1" + i)).toISOString().replace(/\.\d{3}Z$/, "Z") }));
  const f2 = d.fig("attention");
  hs.push({ id: "hl-r4sa07", color: "green", page: f2.page, quote: "Figure 2 · Scaled dot-product attention", image: "att:r4s-att-fig2", comment: "Redraw this from memory.", tags: ["figure"], rects: [f2.rect], created: new Date(at(2, "21:30")).toISOString().replace(/\.\d{3}Z$/, "Z") });
  hs.sort((a, b) => a.page - b.page || (a.rects[0]?.[1] ?? 0) - (b.rects[0]?.[1] ?? 0));
  const readPage = 6;
  add(note({ id: "r4s-pdf-main", title: PDF_TITLE, space: "r4s-s-read", type: "pdf", updated: at(1, "22:05"), body: ["---", "type: pdf", "file: att:r4s-att-pdf", `page: ${readPage}`, `pages: ${d.pages}`, `progress: ${Math.round((readPage / d.pages) * 100)}`, "---", `# ${PDF_TITLE}`, "",
    "Read for the NLP course. Highlights feed the attention cards; the purple one is a figure (area highlight).", "", "## Highlights", "", ...hs.map(serializeHighlight), ""].join(NL) }));
  add(note({ id: "r4s-pdf-locked", title: "Exam answers (locked)", space: "r4s-s-read", type: "pdf", updated: at(5, "18:00"), body: ["---", "type: pdf", "file: att:r4s-att-locked", "page: 1", "pages: 2", "progress: 0", "---", "# Exam answers (locked)", "", "Password-protected PDF. The password is `lumen` (a wrong one shows the retry message).", ""].join(NL) }));
  add(note({ id: "r4s-pdf-scan", title: "Lecture 4 handout (scanned)", space: "r4s-s-read", type: "pdf", updated: at(4, "18:30"), body: ["---", "type: pdf", "file: att:r4s-att-scan", "page: 1", "pages: 2", "progress: 0", "---", "# Lecture 4 handout (scanned)", "", "Image-only PDF: no text layer, so the reader shows the scanned pill and Area highlights still work.", ""].join(NL) }));
  add(note({ id: "r4s-pdf-cheat", title: "FSRS cheat sheet", space: "r4s-s-read", type: "pdf", updated: at(9, "18:30"), body: ["---", "type: pdf", "file: att:r4s-att-cheat", "page: 3", "pages: 3", "progress: 100", "---", "# FSRS cheat sheet", ""].join(NL) }));

  // ---- lesson notes (durations feed Today's minutes)
  const link = (h: Highlight) => `[[${PDF_TITLE}#^${h.id}|${PDF_TITLE} · p. ${h.page}]]`;
  const hl = (id: string) => hs.find((h) => h.id === id)!;
  add(note({ id: "r4s-n-video", title: "Backprop video lecture", space: "r4s-s-dl", type: "lesson", status: "learning", fm: { duration: "18:30" }, updated: at(4, "20:40"), text: [
    "Lecture video first, then my own screen recording.", "",
    "https://www.youtube.com/watch?v=Ilg3gGewQ5U", "",
    "[0:45] What backprop is for", "",
    "[3:10] The chain rule, one node at a time", "",
    "- [8:24] Why the gradient flows backwards", "",
    "My recording (uploaded file, 10 s with a big clock, so seeking is easy to check):", "",
    `![${clipName}](att:r4s-att-clip)`, "",
    "[0:02](#video-2) forward pass · [0:05](#video-2) backward pass · [0:08](#video-2) weight update", "",
    "[0:30](#video-3) points at a third player that does not exist (grey chip).", "",
    "What happens at [0:05](#video-2)? :: The backward pass starts from the loss.", "",
    "\\[12:34] is escaped and stays plain text.", "",
  ].join(NL) }));
  add(note({ id: "r4s-n-reg", title: "Regularization", space: "r4s-s-dl", type: "lesson", status: "todo", fm: { duration: "15m" }, updated: at(5, "19:00"), text: "L2, dropout, early stopping.\n\nThe {{c1::L2}} penalty adds {{c2::λ/2m · Σ‖W‖²::a formula}} to the cost.\n" }));
  add(note({ id: "r4s-n-logreg", title: "Logistic regression", space: "r4s-s-dl", type: "lesson", status: "mastered", fm: { duration: "35m" }, updated: at(12, "19:00"), text: "Sigmoid over a linear score.\n" }));
  add(note({ id: "r4s-n-mb", title: "Mini-batch gradient descent", space: "r4s-s-dl", type: "lesson", status: "todo", fm: { duration: "30m" }, updated: at(6, "19:00"), text: [
    "Split the training set into batches of 32–512 and take one step per batch.", "",
    "Batch size 1 :: Stochastic gradient descent.", "Batch size m :: Batch gradient descent.", "Why shuffle every epoch? :: So batches are not always the same mix.", "",
  ].join(NL) }));
  add(note({ id: "r4s-n-attn", title: "Attention notes", space: "r4s-s-nlp", type: "lesson", status: "learning", fm: { duration: "1h 10m" }, updated: at(1, "21:20"), text: [
    "Cloze cards anywhere (`{{c1::…}}`), plus back-links to the PDF highlights.", "",
    `Attention is a {{c1::weighted sum}} of the {{c2::values::V}}, weighted by how well the query matches each {{c1::key}}. ${link(hl("hl-r4sa03"))}`, "",
    `Scores are divided by {{c1::$\\sqrt{d_k}$}} so the softmax keeps useful gradients. ${link(hl("hl-r4sa04"))}`, "",
    `- Multi-head attention runs {{c1::8}} heads of size {{c2::64}} in the base model. ${link(hl("hl-r4sa05"))}`, "",
    "==This is a reading highlight, not a card== (this note is not a flashcard note), and ==coloured highlights=={.hl-green} never count either.", "",
    "الانتباه هو {{c1::مجموع موزون}} للقيم.", "",
    `Figure: ${link(hl("hl-r4sa07"))}`, "",
  ].join(NL) }));
  add(note({ id: "r4s-n-pos", title: "Positional encoding", space: "r4s-s-nlp", type: "lesson", status: "todo", fm: { duration: "20m", cloze: "true" }, updated: at(3, "19:30"), text: [
    "`cloze: true` in the front matter, so ==marks== are cards here.", "",
    "Attention alone ignores ==order==, so a ==position vector== is added to each embedding.", "",
    "The encoding uses ==sine and cosine== waves of different wavelengths.", "",
  ].join(NL) }));
  add(note({ id: "r4s-n-tok", title: "Tokenization", space: "r4s-s-nlp", type: "lesson", status: "mastered", fm: { duration: "15m" }, updated: at(20, "19:00"), text: "BPE merges the most frequent pairs.\n" }));
  add(note({ id: "r4s-n-ar1", title: "الجملة الاسمية", space: "r4s-s-ar", type: "lesson", status: "review", fm: { duration: "15m" }, updated: at(8, "19:00"), text: "تتكون الجملة الاسمية من {{c1::مبتدأ}} و{{c2::خبر}}.\n\nمثال: العلمُ نورٌ.\n" }));
  add(note({ id: "r4s-n-ar2", title: "الجملة الفعلية", space: "r4s-s-ar", type: "lesson", status: "learning", fm: { duration: "15m" }, updated: at(2, "19:00"), text: "تبدأ الجملة الفعلية بـ{{c1::فعل}}، ثم {{c2::فاعل}}.\n\nمثال: كتبَ الطالبُ الدرسَ.\n" }));

  // ---- flashcard decks: basic Q::A, a multi-line `?` card, and ==x== clozes (flashcards type)
  add(note({ id: "r4s-deck-dl", title: "Deep learning cards", space: "r4s-s-dl", type: "flashcards", updated: at(3, "21:40"), text: [
    ...DL_CARDS, "",
    "Explain the three steps of one training iteration", "?", "1. Forward pass computes the loss.", "2. Backward pass computes the gradients.", "3. The optimizer updates the weights.", "",
    "In a flashcard note, ==marks== become cards: Adam keeps a ==moving average== of the gradients and of their ==squares==.", "",
  ].join(NL) }));
  add(note({ id: "r4s-deck-ar", title: "مفردات النحو", space: "r4s-s-ar", type: "flashcards", updated: at(2, "21:00"), text: [...AR_CARDS, "", "كان وأخواتها ترفع ==المبتدأ== وتنصب ==الخبر==.", ""].join(NL) }));

  // ---- image occlusion on real attachment images: hide-one with a group, and hide-all
  const box = (b: { x: number; y: number; w: number; h: number }, W: number, Hh: number) => ({ x: +(b.x / W).toFixed(4), y: +(b.y / Hh).toFixed(4), w: +(b.w / W).toFixed(4), h: +(b.h / Hh).toFixed(4) });
  const occ1 = [`${F}occlusion`, "id: oc-r4sblk", "image: att:r4s-att-block", "alt: Transformer encoder block", "mode: hide-one", "boxes:",
    ...BLOCK_LABELS.map((b, i) => { const r = box(b, 800, 560); return `  - {id: b${i + 1}, x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h}, label: ${b.label}${b.group ? `, group: ${b.group}` : ""}}`; }), F].join(NL);
  const occ2 = [`${F}occlusion`, "id: oc-r4sneu", "image: att:r4s-att-neuron", "alt: Neuron", "mode: hide-all", "boxes:",
    ...NEURON_LABELS.map((b, i) => { const r = box(b, 720, 420); return `  - {id: b${i + 1}, x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h}, label: ${b.label}}`; }), F].join(NL);
  add(note({ id: "r4s-occ", title: "Image cards: transformer block", space: "r4s-s-nlp", type: "note", updated: at(2, "22:00"), text: [
    "Hide one, show others (the two **Add & norm** boxes are one group = one card):", "", occ1, "",
    "Hide all, guess one:", "", occ2, "",
    "An image without boxes yet (put the cursor on it for **Make image cards**):", "", "![transformer-block.png](att:r4s-att-block)", "",
  ].join(NL) }));

  // ---- a canvas with a highlight card and a PDF file card (highlight → canvas)
  const h1 = hl("hl-r4sa01");
  add(note({ id: "r4s-canvas", title: "Attention map", space: "r4s-s-nlp", type: "canvas", updated: at(3, "22:10"), body: JSON.stringify({
    nodes: [
      { id: "r4s-cn-1", type: "text", x: 0, y: 0, width: 320, height: 150, color: "3", text: `> ${h1.quote}\n\n${link(h1)}` },
      { id: "r4s-cn-2", type: "file", x: 380, y: 0, width: 280, height: 150, file: `${PDF_TITLE}.md`, subpath: `#page=${readPage}` },
      { id: "r4s-cn-3", type: "text", x: 0, y: 220, width: 320, height: 90, text: "Drag more highlights here from the reader's Highlights panel." },
    ],
    edges: [{ id: "r4s-ce-1", fromNode: "r4s-cn-1", fromSide: "right", toNode: "r4s-cn-2", toSide: "left" }],
  }, null, 2) }));

  // ---- learning path: mastered, learned with revisions due (one about to master), learning, practice, locked
  add(note({ id: "r4s-path", title: "Transformers from zero", type: "path", updated: at(1, "20:00"), pinned: 1, body: fill(`---
type: path
courses: [Deep Learning Specialization, NLP with Transformers]
---
# Transformers from zero

From logistic regression to attention, over two courses. Revisions are due; Gradient descent masters on its next "Got it".

## Foundations
- Logistic regression
  - review: {d1} 3
- Gradient descent
  - review: {d-2} 7
- Vectorization
  - review: {d18} 30
- Tokenization
  - review: {d2} 3
- Word embeddings
  - review: {d9} 14
## Core
- Backpropagation
  - resource: [3Blue1Brown · Backpropagation](https://www.youtube.com/watch?v=Ilg3gGewQ5U)
  - note: [[Backprop video lecture]]
- Mini-batch gradient descent = Mini-batches
  - note: [[Mini-batch gradient descent]]
- Self-attention = Attention
  - note: [[Attention notes]]
- Weight initialization
- Regularization
## Applied
- Adam
- Learning rate decay
- Encoder-decoder
- Positional encoding
- Transformers
  - needs: Positional encoding
- Fine-tuning
`) }));

  // ---- cards: every flashcard of the decks/lessons, with a simulated FSRS history and a mix of final states
  const r = rng(404);
  let li = 0;
  const logId = () => `r4s-rv-${String(++li).padStart(4, "0")}`;
  const cards: Card[] = [];
  const reviews: ReviewLog[] = [];
  const cardNotes = notes.filter((n) => n.type !== "canvas" && n.type !== "roadmap" && n.type !== "path" && n.type !== "pdf");
  let k = 0;
  for (const n of cardNotes) {
    for (const fc of flashcards(n.body)) {
      const id = `${n.id}:${fc.key}`;
      const i = k++;
      // new cards stay without a record (as in the app): 1 in 7, plus the cards of the newest notes
      if (n.id === "r4s-n-mb" || n.id === "r4s-n-pos" || (i % 7 === 6 && n.id !== "r4s-occ")) continue;
      const fate: Fate = i % 11 === 3 ? "learning" : i % 11 === 5 ? "relearning" : i % 17 === 9 ? "suspended" : i % 6 === 1 ? "due" : "review";
      const start = c.t0 - (20 + r.int(0, 70)) * DAY + r.int(18, 22) * HOUR;
      const s = simulate(id, n.id, start, fate, c, r, logId);
      cards.push(s.card);
      reviews.push(...s.logs);
    }
  }

  // ---- study timer sessions: a steady habit for 10 weeks up to 3 days ago (Mon + Tue on the design clock, a
  // Friday); the last two days have none, so Today counts them as missed study days
  const sessions = [];
  const lessonIds = ["r4s-n-video", "r4s-n-attn", "r4s-n-ar2", "r4s-n-logreg", "r4s-n-tok", "r4s-n-reg", null];
  for (let day = 3; day < 72; day++) {
    const dt = new Date(c.t0 - day * DAY);
    if (dt.getDay() === 0 || !r.chance(day < 10 ? 1 : 0.72)) continue;
    const times = r.int(1, day < 10 ? 2 : 3);
    for (let t = 0; t < times; t++) sessions.push(session(`r4s-se-${day}-${t}`, r.pick(lessonIds), r.pick([15, 20, 25, 30, 40, 45]), c.at(day, `${18 + t * 2}:${r.pick(["05", "20", "40"])}`)));
  }
  // the last timer session (3 days ago, late) was on the backprop lecture → Today's "Continue"
  sessions.push(session("r4s-se-last", "r4s-n-video", 35, c.at(3, "23:10")));
  // ---- Today plan log: goals + this week's done / skipped / moved items (Tue's "later" comes first today)
  const lessonLine = (course: string, topic: string) => `^lesson:${course.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const DLN = "Deep Learning Specialization";
  const log = [
    "---", "lumen: study-plan", "---", "# Study plan log", "",
    "Written by Today (see docs/TODAY.md). One section per day; you can edit it.", "",
    "## Goals", `- 4 lessons · ${DLN}`, "- 150 cards", "- 300 minutes", "- 3 revisions", "",
    `## ${c.iso(-4)}`, `- done: Vectorization (30 min) ${lessonLine(DLN, "Vectorization")}`, "- done: Review 32 flashcards (8 min) ^cards", "- done: Revise Tokenization (5 min) ^rev:transformers-from-zero:tokenization", "",
    `## ${c.iso(-3)}`, `- done: Word embeddings (25 min) ${lessonLine("NLP with Transformers", "Word embeddings")}`, "- skip: Review 18 flashcards (5 min) ^cards",
    `- later: Regularization (15 min) ${lessonLine(DLN, "Regularization")}`, "",
  ].join(NL);
  const logNote = note({ id: "lumen-study-plan", title: "Study plan log", type: "note", body: log, updated: at(3, "21:50") });

  return { spaces, notes: [...notes, logNote], cards, reviews, sessions, files };
}

/**
 * Add the "Study features (round 4)" records to vault `v` (default: a new empty one) and return it. Only appends
 * records with `r4s-` ids (plus the fixed-id Today plan log note), so it composes with other builders; nothing is
 * cleared here (writeVault does that when this is loaded as its own scenario). Takes ~10 s: it records a real
 * 10-second video. Review-log rows go into `v.reviews`.
 */
export async function seedR4Study(v: Vault = emptyVault()): Promise<Vault> {
  const c = clock();
  const b = await build(c);
  v.spaces.push(...b.spaces);
  v.notes.push(...b.notes);
  v.cards.push(...b.cards);
  v.sessions.push(...b.sessions);
  (v.reviews ??= []).push(...b.reviews);
  for (const f of b.files) {
    v.attachments.push(attachment(f.id, f.name, f.blob.type, f.blob.size, c.t0 - 5 * DAY));
    v.blobs.push({ id: f.id, blob: f.blob, uploaded: 1 });
  }
  return v;
}
