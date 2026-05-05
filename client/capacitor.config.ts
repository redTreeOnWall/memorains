import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lirunlong.memorains",
  appName: "Memorains Note",
  webDir: "dist",
  server: {
    // Cleartext is needed for local development; remove in production
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  // ios: {
  //   contentInset: "automatic",
  // },
};

export default config;
