import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const BUILD_ELECTRON = process.env.VITE_BUILD_ELECTRON === "true";
const BUILD_CAPACITOR = process.env.VITE_BUILD_CAPACITOR === "true";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    nodePolyfills(),
    react(),
    // Replace custom HTML placeholders (Vite only replaces %MODE%, %DEV%, %BASE% by default)
    {
      name: "html-transform",
      transformIndexHtml(html) {
        return html
          .replace(/%ELECTRON%/g, String(BUILD_ELECTRON))
          .replace(/%CAPACITOR%/g, String(BUILD_CAPACITOR));
      },
    },
  ],
  base: "./",
});
