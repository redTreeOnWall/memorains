import { describe, expect, it } from "vitest";
import { resolveInitialState } from "./pluginTypes";

/**
 * The trap this guards against: every caller supplies a state argument (the create
 * dialog starts with `new ArrayBuffer(0)`), so treating only `null` as "absent"
 * silently skipped a type's initial content — producing, for example, a new
 * database with no columns and no view.
 */
describe("resolveInitialState", () => {
  it("treats an empty buffer as absent and uses the plugin's initial state", () => {
    const seeded = new ArrayBuffer(8);
    const plugin = { initialState: () => seeded };

    expect(resolveInitialState(plugin, new ArrayBuffer(0))).toBe(seeded);
    expect(resolveInitialState(plugin, null)).toBe(seeded);
  });

  it("never calls the plugin when content was supplied", () => {
    // Encryption wraps whatever the caller produced, so supplied content must win.
    let called = 0;
    const plugin = {
      initialState: () => {
        called++;
        return new ArrayBuffer(4);
      },
    };
    const provided = new ArrayBuffer(4);

    expect(resolveInitialState(plugin, provided)).toBe(provided);
    expect(called).toBe(0);
  });

  it("returns an empty buffer for a type with no initial state", () => {
    expect(resolveInitialState(undefined, null).byteLength).toBe(0);
    expect(resolveInitialState({}, new ArrayBuffer(0)).byteLength).toBe(0);
  });

  it("always returns a usable buffer", () => {
    // A type that declares nothing must not yield undefined: the caller stores
    // this straight into the document row.
    for (const plugin of [
      undefined,
      {},
      { initialState: () => new ArrayBuffer(0) },
    ]) {
      const result = resolveInitialState(plugin, null);
      expect(result).toBeInstanceOf(ArrayBuffer);
    }
  });
});
