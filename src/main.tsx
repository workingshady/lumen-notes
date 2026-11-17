import "./lib/demo-clock";
import "./lib/sim/hooks"; // Dev simulator middleware (no-op outside demo mode); must register before the DB opens
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { DEMO, db, ensureDefaults, getMeta, setMeta } from "./lib/db";
import { applyTheme } from "./lib/settings";
import { startSync } from "./lib/sync";
import { DevPanel, openDevPanel, toggleDevPanel } from "./views/DevPanel";

// ?demo=1 / ?demo=0 toggles dev mode (separate "lumen-demo" database with dummy data). Other params
// (e.g. ?dev=panel) survive the reload.
const params = new URLSearchParams(location.search);
const demoParam = params.get("demo");
if ((demoParam === "1" && !DEMO) || (demoParam === "0" && DEMO)) {
  try { demoParam === "1" ? localStorage.setItem("lumen.demo", "1") : localStorage.removeItem("lumen.demo"); } catch { /* ignore */ }
  params.delete("demo");
  const q = params.toString();
  location.replace(location.pathname + (q ? `?${q}` : ""));
}

// ?dev=reset: escape hatch if a scenario/fault/clock leaves the app unusable — back to the design sample, no faults,
// design clock. Runs before anything reads the demo DB.
const devReset = DEMO && params.get("dev") === "reset";
if (devReset) {
  try { ["lumen.sim.scenario", "lumen.sim.faults", "lumen.sim.clock", "lumen.ui"].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

/** Seed the demo DB with the remembered scenario (design sample by default) when it is empty or was reset. */
async function seedIfDemo() {
  if (devReset) {
    await db.notes.clear(); // drop possibly-hostile data before the UI queries it
    await setMeta("demoSeeded", 0);
  }
  if (!DEMO || (await getMeta("demoSeeded", 0))) return;
  const { seedScenario } = await import("./lib/sim");
  await seedScenario(db);
}

applyTheme();
// A code chunk failed to load (usually right after a deploy: this tab runs the old build, or the new chunk is not at
// the edge yet). Reload once to pick up the current build; a session flag stops reload loops.
addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("lumen.chunkReload") ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("lumen.chunkReload", String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  e.preventDefault();
  location.reload();
});
const isBlog = location.pathname === "/blog" || location.pathname.startsWith("/blog/") || location.pathname.startsWith("/s/") || location.pathname.startsWith("/remote/");
if (!isBlog) {
  void seedIfDemo().then(ensureDefaults).then(startSync);
  if ("serviceWorker" in navigator && location.protocol === "https:" && !import.meta.env.DEV) void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Dev simulator panel: Ctrl+Shift+D anywhere, or ?dev=panel on load. Rendered in its own root so it works on every
// screen (Welcome included); a <DevPanel/> mounted elsewhere is fine too (only one instance renders).
addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); toggleDevPanel(); }
});
if (params.get("dev") === "panel") openDevPanel();
const devHost = document.createElement("div");
devHost.id = "dev-panel-root";
document.body.appendChild(devHost);
createRoot(devHost).render(<DevPanel />);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
