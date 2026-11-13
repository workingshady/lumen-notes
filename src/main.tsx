import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ensureDefaults } from "./lib/db";
import { applyTheme } from "./lib/settings";
import { startSync } from "./lib/sync";

applyTheme();
const isBlog = location.pathname === "/blog" || location.pathname.startsWith("/blog/");
if (!isBlog) {
  void ensureDefaults().then(startSync);
  if ("serviceWorker" in navigator && location.protocol === "https:" && !import.meta.env.DEV) void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
