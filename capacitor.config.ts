import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.workingshady.lumen",
  appName: "Lumen",
  webDir: "dist/client",
  android: { allowMixedContent: false },
};
export default config;
