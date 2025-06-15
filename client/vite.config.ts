import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// const BUILD_ELECTRON = process.env.VITE_BUILD_ELECTRON === "true";

// https://vite.dev/config/
export default defineConfig({
  plugins: [nodePolyfills(), react()],
  // base: BUILD_ELECTRON ? "./" : "doc/client",
  base: "./",
});
