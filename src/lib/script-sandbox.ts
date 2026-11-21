/**
 * Runs user scripts off the main thread in a Worker (no DOM, no storage, no network). The script talks to the app only
 * through the `board` RPC calls below; a hard timeout terminates runaway loops.
 */
const PRELUDE = `
"use strict";
const STICKY = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
const lab = (l) => (l ? { label: { text: l } } : {});
const sk = {
  rect: (x, y, w = 200, h = 100, label, o = {}) => ({ type: "rectangle", x, y, width: w, height: h, roundness: { type: 3 }, ...lab(label), ...o }),
  ellipse: (x, y, w = 160, h = 100, label, o = {}) => ({ type: "ellipse", x, y, width: w, height: h, ...lab(label), ...o }),
  diamond: (x, y, w = 160, h = 120, label, o = {}) => ({ type: "diamond", x, y, width: w, height: h, ...lab(label), ...o }),
  text: (x, y, text, o = {}) => ({ type: "text", x, y, text, fontSize: 20, ...o }),
  sticky: (x, y, text, color = 0) => ({ type: "rectangle", x, y, width: 200, height: 160, backgroundColor: STICKY[color % STICKY.length], fillStyle: "solid", strokeColor: "transparent", roundness: { type: 3 }, label: { text, fontSize: 18, strokeColor: "#000000" } }),
  arrow: (x, y, dx, dy, o = {}) => ({ type: "arrow", x, y, width: dx, height: dy, points: [[0, 0], [dx, dy]], ...o }),
  connect: (fromId, toId, label) => ({ type: "arrow", x: 0, y: 0, start: { id: fromId }, end: { id: toId }, ...lab(label) }),
  frame: (children, name) => ({ type: "frame", children, name }),
};
const post = self.postMessage.bind(self);
for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "EventSource", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker"]) { try { self[k] = undefined; } catch (e) {} }
let seq = 0; const waits = new Map();
const rpc = (name, args) => new Promise((res, rej) => { const id = ++seq; waits.set(id, { res, rej }); post({ kind: "rpc", id, name, args }); });
const fmt = (a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.kind === "reply") { const w = waits.get(m.id); waits.delete(m.id); if (w) (m.error ? w.rej(new Error(m.error)) : w.res(m.value)); return; }
  if (m.kind !== "run") return;
  const board = { elements: m.elements, add: (s) => rpc("add", [s]), clear: () => rpc("clear", []), fromMermaid: (c) => rpc("fromMermaid", [c]) };
  const log = (...a) => post({ kind: "log", text: fmt(a) });
  try {
    await (0, eval)("(async (board, sk, log) => {" + m.code + "\\n})")(board, sk, log);
    post({ kind: "done" });
  } catch (e) { post({ kind: "error", message: String((e && e.message) || e) }); }
};
`;

export type BoardCalls = {
  add: (s: unknown) => Promise<void> | void;
  clear: () => Promise<void> | void;
  fromMermaid: (c: string) => Promise<void> | void;
};

export function runBoardScript(code: string, elements: unknown[], calls: BoardCalls, onLog: (s: string) => void, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([PRELUDE], { type: "text/javascript" }));
    const w = new Worker(url);
    const end = (err?: Error) => { clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); err ? reject(err) : resolve(); };
    const timer = setTimeout(() => end(new Error("Script timed out after " + Math.round(timeoutMs / 1000) + " s")), timeoutMs);
    w.onerror = (e) => end(new Error(e.message || "Script error"));
    w.onmessage = async (ev) => {
      const m = ev.data;
      if (m.kind === "log") onLog(m.text);
      else if (m.kind === "done") end();
      else if (m.kind === "error") end(new Error(m.message));
      else if (m.kind === "rpc") {
        try {
          const fn = (calls as Record<string, (...a: never[]) => unknown>)[m.name];
          if (!fn) throw new Error("Unknown call " + m.name);
          await fn(...(m.args as never[]));
          w.postMessage({ kind: "reply", id: m.id });
        } catch (e) { w.postMessage({ kind: "reply", id: m.id, error: String((e as Error).message ?? e) }); }
      }
    };
    try { w.postMessage({ kind: "run", code, elements: JSON.parse(JSON.stringify(elements)) }); } catch (e) { end(e as Error); }
  });
}
