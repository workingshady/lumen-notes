import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// `--mode app` = Capacitor/Android build: plain static bundle (no Worker), API calls go to VITE_API_BASE.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "app" ? [] : [cloudflare()])],
  base: mode === "app" ? "./" : "/",
  build: { chunkSizeWarningLimit: 4000, ...(mode === "app" ? { outDir: "dist/client" } : {}) },
}));
