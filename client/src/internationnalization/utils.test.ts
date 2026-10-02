import { describe, expect, it, beforeEach } from "vitest";
import {
  getCurrentLan,
  i18n,
  languageStore,
  setLanguage,
  supportedLanguages,
} from "./utils";

describe("language store", () => {
  beforeEach(() => {
    setLanguage("en");
  });

  it("translates according to the selected language", () => {
    setLanguage("en");
    expect(i18n("sign_in")).toBe("Sign in");

    setLanguage("zh");
    expect(i18n("sign_in")).toBe("登录");
  });

  it("takes effect immediately, without a reload", () => {
    // The point of the store: `i18n` is called from plain modules and reads the
    // current value at call time, so a switch is visible to the next render.
    const before = i18n("language");
    setLanguage("zh");
    expect(i18n("language")).not.toBe(before);
  });

  it("exposes a BCP-47 tag for Intl, not the internal code", () => {
    // `Intl`/Excalidraw need "zh-CN"; passing the store's "zh" would silently
    // fall back to the default locale for some implementations.
    setLanguage("zh");
    expect(getCurrentLan()).toBe("zh-CN");

    setLanguage("en");
    expect(getCurrentLan()).toBe("en-US");
  });

  it("persists the choice so it survives a reload", () => {
    setLanguage("zh");
    expect(localStorage.getItem("memorains_language")).toBe("zh");
  });

  it("notifies subscribers, which is what re-renders the UI", () => {
    const seen: string[] = [];
    const listener = (value: string) => seen.push(value);
    languageStore.property.addValueChangeListener(listener);

    setLanguage("zh");
    setLanguage("zh");
    setLanguage("en");

    languageStore.property.removeValueChangeListener(listener);
    // The duplicate "zh" is dropped by `BindableProperty`: re-rendering the whole
    // app for a no-op selection would be pure waste.
    expect(seen).toEqual(["zh", "en"]);
  });

  it("offers every supported language a picker can render", () => {
    const codes = supportedLanguages.map((language) => language.code);
    expect(codes).toContain("en");
    expect(codes).toContain("zh");

    // Each entry must resolve, so a label in the picker can never come out empty.
    for (const { code } of supportedLanguages) {
      setLanguage(code);
      expect(i18n("language").length).toBeGreaterThan(0);
      expect(i18n("app_name").length).toBeGreaterThan(0);
    }
  });
});
