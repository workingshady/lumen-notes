// AI for visuals, client side (round 7 · Lumen 35 review sheet, Lumen 48 architecture AI). Server: worker/ext/ai-visual.ts.
//
//  convertImage(blob, kind, {signal})   ink / image → text | LaTeX | Mermaid (+ low-confidence spans)
//  archFromText(text, {source, type})   describe / code / OpenAPI / compose / k8s / Terraform / SQL / RFC → Lumen DSL
//  editDsl(dsl, instruction)            DSL + instruction → new DSL
//  reviewDsl(dsl) / docsFromDsl / cardsFromDsl
//  checkDsl(dsl) · diffDsl(a, b)        light syntax check (see below) and a line diff for the Accept / Reject view
//
// Every call: offline check first (AiConvertError code "offline"), AbortSignal support ("aborted"), a client timeout
// (60 s, "timeout"), the daily limit ("limit"), unreadable ink ("unreadable"). All go through api() so the usage meter
// (src/lib/ai-usage.ts) sees them. Image is shrunk off the main thread when it is large.
import { api, ApiError } from "./api";
import { getFaults } from "./sim/faults";

export type ConvertKind = "text" | "math" | "mermaid" | "shapes-hint";
export type ArchSource = "describe" | "code" | "openapi" | "compose" | "k8s" | "terraform" | "sql" | "rfc";
export type ArchType = "architecture" | "flowchart" | "sequence" | "erd" | "c4";
export type AiErrorCode = "offline" | "aborted" | "timeout" | "limit" | "unreadable" | "too-large" | "disabled" | "failed";

export class AiConvertError extends Error { constructor(msg: string, public code: AiErrorCode, public status = 0) { super(msg); } }

export interface Span { start: number; end: number; alts: string[] }
export interface ConvertResult { text: string; spans: Span[]; kind: ConvertKind; model: string; neurons: number }
export interface ReviewResult {
  summary: string;
  spof: string[];
  missing: { kind: "auth" | "encryption" | "backup" | "other"; text: string }[];
  stride: { cat: string; text: string; severity: "High" | "Med" | "Low" }[];
}

export const isOnline = () => typeof navigator === "undefined" || (navigator.onLine !== false && getFaults().net !== "offline");

const TIMEOUT = 60_000;

async function call<T>(path: string, json: unknown, signal?: AbortSignal): Promise<T> {
  if (!isOnline()) throw new AiConvertError("You’re offline. Converting needs your Cloudflare account; your ink is safe.", "offline");
  if (signal?.aborted) throw new AiConvertError("Cancelled", "aborted");
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT);
  try {
    return await api<T>(path, { method: "POST", json, signal: ctl.signal });
  } catch (e) {
    if (timedOut) throw new AiConvertError("The AI took too long. Try a smaller selection.", "timeout");
    if (ctl.signal.aborted || (e as Error)?.name === "AbortError") throw new AiConvertError("Cancelled", "aborted");
    if (e instanceof ApiError) {
      const code: AiErrorCode = e.status === 429 || /limit reached|quota/i.test(e.message) ? "limit" : e.status === 422 ? "unreadable" : e.status === 413 ? "too-large" : e.status === 501 || e.status === 403 ? "disabled" : e.status === 504 ? "timeout" : "failed";
      throw new AiConvertError(e.message, code, e.status);
    }
    if (!isOnline() || e instanceof TypeError) throw new AiConvertError("You’re offline. Converting needs your Cloudflare account; your ink is safe.", "offline");
    throw new AiConvertError("AI request failed.", "failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Blob → PNG data URI, shrunk to ≤1600 px on the long side when large (uses createImageBitmap: decoding is off the main thread). */
export async function blobToDataUri(blob: Blob, maxSide = 1600): Promise<string> {
  let src = blob;
  try {
    if (blob.size > 600_000 || blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const cx = cv.getContext("2d") as CanvasRenderingContext2D;
      cx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      src = "convertToBlob" in cv ? await (cv as OffscreenCanvas).convertToBlob({ type: "image/png" }) : await new Promise<Blob>((res, rej) => (cv as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
    }
  } catch { src = blob; }
  return await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(src); });
}

export async function convertImage(image: Blob, kind: ConvertKind, opts: { signal?: AbortSignal } = {}): Promise<ConvertResult> {
  if (!isOnline()) throw new AiConvertError("You’re offline. Converting needs your Cloudflare account; your ink is safe.", "offline");
  const uri = await blobToDataUri(image);
  const r = await call<ConvertResult>("/ai/visual/convert", { image: uri, kind }, opts.signal);
  return { ...r, spans: (r.spans ?? []).filter((s) => s.end > s.start && s.end <= r.text.length) };
}

export const archFromText = (text: string, o: { source?: ArchSource; type?: ArchType; signal?: AbortSignal } = {}) =>
  call<{ dsl: string; neurons: number }>("/ai/visual/arch", { text, source: o.source ?? "describe", type: o.type ?? "architecture" }, o.signal);
export const editDsl = (dsl: string, instruction: string, signal?: AbortSignal) => call<{ dsl: string; neurons: number }>("/ai/visual/edit", { dsl, instruction }, signal);
export const reviewDsl = (dsl: string, signal?: AbortSignal) => call<{ review: ReviewResult; neurons: number }>("/ai/visual/review", { dsl, mode: "review" }, signal);
export const docsFromDsl = (dsl: string, signal?: AbortSignal) => call<{ text: string; neurons: number }>("/ai/visual/review", { dsl, mode: "docs" }, signal);
export const cardsFromDsl = (dsl: string, signal?: AbortSignal) => call<{ text: string; neurons: number }>("/ai/visual/review", { dsl, mode: "cards" }, signal);

// ------------------------------------------------------------------ DSL helpers
export interface DslIssue { line: number; message: string }
const NODE = /^[\w .\-/()&]+\s*(\[[^\]]*\])?\s*\{?$/;
const EDGE = /^[\w .\-/()&]+\s*(>|<|<>|-)\s*[\w .\-/()&]+(\s*:.*)?$/;
/**
 * Light syntax check for AI output, used until the real parser (src/lib/arch-dsl.ts, W1-D) is mounted: the studio should
 * prefer its own parse and pass `validate` to the panels. Checks balanced braces and that every line is a direction,
 * comment, node (optionally `[icon: …]` and `{`), edge (`A > B: label`) or `}`.
 */
export function checkDsl(dsl: string): DslIssue[] {
  const issues: DslIssue[] = [];
  let depth = 0;
  dsl.split("\n").forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("//") || /^direction\s+(right|down|left|up)$/.test(l)) return;
    if (l === "}") { if (--depth < 0) { issues.push({ line: i + 1, message: "Unexpected }" }); depth = 0; } return; }
    if (EDGE.test(l) && /(^|\s)[<>-]/.test(l) && !/\[.*\]\s*\{?$/.test(l)) return;
    if (NODE.test(l)) { if (l.endsWith("{")) depth++; return; }
    issues.push({ line: i + 1, message: "Can’t read this line" });
  });
  if (depth > 0) issues.push({ line: dsl.split("\n").length, message: "Missing }" });
  return issues;
}

export interface DiffRow { n: number | null; text: string; mark: "+" | "-" | "" }
/** Line diff old → new (LCS). Rows are in display order; removed rows have no new line number. */
export function diffDsl(a: string, b: string): DiffRow[] {
  const x = a.split("\n"), y = b.split("\n");
  const m = x.length, n = y.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const rows: DiffRow[] = [];
  let i = 0, j = 0, ln = 1;
  while (i < m && j < n) {
    if (x[i] === y[j]) { rows.push({ n: ln++, text: y[j], mark: "" }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) rows.push({ n: null, text: x[i++], mark: "-" });
    else rows.push({ n: ln++, text: y[j++], mark: "+" });
  }
  while (i < m) rows.push({ n: null, text: x[i++], mark: "-" });
  while (j < n) rows.push({ n: ln++, text: y[j++], mark: "+" });
  return rows;
}

/** Names of nodes added / removed between two DSLs (for the canvas-side diff colours and the summary line). */
export function diffSummary(rows: DiffRow[]) {
  const isEdge = (t: string) => />|</.test(t.replace(/\[[^\]]*\]/g, ""));
  const add = rows.filter((r) => r.mark === "+" && r.text.trim() && !r.text.trim().startsWith("//"));
  const del = rows.filter((r) => r.mark === "-" && r.text.trim() && !r.text.trim().startsWith("//"));
  const name = (t: string) => t.trim().split(/[\s[>:<{]/)[0];
  const addNames = new Set(add.filter((r) => !isEdge(r.text)).map((r) => name(r.text)));
  const delNames = new Set(del.filter((r) => !isEdge(r.text)).map((r) => name(r.text)));
  const changed = [...addNames].filter((k) => delNames.has(k));
  return {
    added: add.length - changed.length, removed: del.length - changed.length, changed: changed.length,
    addedNodes: [...addNames].filter((k) => !delNames.has(k)), removedNodes: [...delNames].filter((k) => !addNames.has(k)), changedNodes: changed,
  };
}

/** Markdown for "Save as note" from a review. */
export function reviewToMarkdown(title: string, r: ReviewResult): string {
  const L = [`# Review · ${title}`, "", "## In short", r.summary, "", "## Single points of failure", ...r.spof.map((s) => `- ${s}`), "", "## Missing", ...r.missing.map((m) => `- ${m.text}`), "", "## STRIDE", ...r.stride.map((s) => `- ${s.cat} ${s.text} (${s.severity})`)];
  return L.join("\n");
}
/** Task lines for "Make tasks": one per single point of failure, missing item and High threat. */
export function reviewToTasks(r: ReviewResult): string[] {
  return [...r.spof.map((s) => `Fix: ${s}`), ...r.missing.map((m) => m.text), ...r.stride.filter((s) => s.severity === "High").map((s) => `Mitigate: ${s.text}`)];
}
