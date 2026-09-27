import { defineConfig } from "vitest/config";

/**
 * Test config for the pure modules under `src/doc-types/plugins/database/`.
 *
 * Kept separate from `vite.config.ts` on purpose: the app config loads
 * `vite-plugin-node-polyfills` and the Excalidraw/Quill ecosystem, none of which
 * the pure logic under test needs. Tests here must run without a DOM.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
