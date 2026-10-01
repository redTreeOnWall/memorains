import { defineConfig } from "vitest/config";

/**
 * Test config for the logic that does not need a DOM.
 *
 * Kept separate from `vite.config.ts` on purpose: the app config loads
 * `vite-plugin-node-polyfills` and the Excalidraw/Quill ecosystem, none of which
 * the pure logic under test needs. Tests here must run without a DOM.
 *
 * `setupFiles` provides the handful of globals modules read while being
 * imported; see that file for why it is not simply jsdom.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["src/test-setup.ts"],
  },
});
