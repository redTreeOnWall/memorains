import { describe, expect, it, beforeEach } from "vitest";
import {
  fallbackLanguage,
  getCurrentLan,
  i18n,
  languageStore,
  setLanguage,
  supportedLanguages,
  type Language,
} from "./utils";
import { en } from "./languages/en";

describe("language store", () => {
  beforeEach(() => {
    setLanguage("en-US");
  });

  it("translates according to the selected language", () => {
    setLanguage("en-US");
    expect(i18n("sign_in")).toBe("Sign in");

    setLanguage("zh-CN");
    expect(i18n("sign_in")).toBe("登录");
  });

  it("takes effect immediately, without a reload", () => {
    // The point of the store: `i18n` is called from plain modules and reads the
    // current value at call time, so a switch is visible to the next render.
    const before = i18n("language");
    setLanguage("zh-CN");
    expect(i18n("language")).not.toBe(before);
  });

  it("exposes a BCP-47 tag for Intl, not the internal code", () => {
    // `Intl`/Excalidraw need "zh-CN"; a bare "zh" would leave some implementations
    // on the default locale.
    setLanguage("zh-CN");
    expect(getCurrentLan()).toBe("zh-CN");

    setLanguage("en-US");
    expect(getCurrentLan()).toBe("en-US");
  });

  it("persists the choice so it survives a reload", () => {
    setLanguage("zh-CN");
    expect(localStorage.getItem("memorains_language")).toBe("zh-CN");
  });

  it("notifies subscribers, which is what re-renders the UI", () => {
    const seen: string[] = [];
    const listener = (value: Language) => seen.push(value.code);
    languageStore.property.addValueChangeListener(listener);

    setLanguage("zh-CN");
    setLanguage("zh-CN");
    setLanguage("en-US");

    languageStore.property.removeValueChangeListener(listener);
    // The duplicate is dropped by `BindableProperty`: re-rendering the whole app
    // for a no-op selection would be pure waste.
    expect(seen).toEqual(["zh-CN", "en-US"]);
  });

  it("ignores a code it does not ship, rather than blanking the UI", () => {
    setLanguage("zh-CN");
    setLanguage("kl-GL");
    expect(getCurrentLan()).toBe("zh-CN");
  });

  it("resolves every language a picker can offer", () => {
    expect(supportedLanguages.length).toBeGreaterThan(1);

    for (const { code } of supportedLanguages) {
      setLanguage(code);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(typeof i18n(key)).toBe("string");
      }
    }
  });

  it("covers exactly the reference key set", () => {
    // Not a style preference: `Record<StringKey, string>` already makes this a
    // compile error, but the keys are also load-bearing at runtime — a language
    // that added a key `en` lacks would carry a string nothing ever reads.
    const reference = Object.keys(en).sort();
    for (const { code, strings } of supportedLanguages) {
      expect(Object.keys(strings).sort(), `keys of ${code}`).toEqual(reference);
    }
  });

  it("keeps placeholders identical across languages", () => {
    // `string-format` throws on a placeholder it cannot fill, and a translated
    // one that drops or renames `{name}` is exactly how that reaches production:
    // the English text reads fine, so nothing looks wrong until a user hits it.
    const placeholders = (text: string) =>
      (text.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    const reference = Object.keys(en) as (keyof typeof en)[];

    for (const { code, strings } of supportedLanguages) {
      for (const key of reference) {
        expect(
          placeholders(strings[key]),
          `placeholders of "${String(key)}" in ${code}`,
        ).toEqual(placeholders(en[key]));
      }
    }
  });

  it("falls back to English for a key a language is missing", () => {
    // Partial translations are expected while a language is being filled in; a
    // blank label is not an acceptable way to show that.
    const partial = { ...fallbackLanguage.strings };
    delete (partial as Record<string, string>)["sign_in"];
    const incomplete: Language = {
      ...fallbackLanguage,
      code: "xx-XX",
      strings: partial,
    };

    languageStore.property.value = incomplete;
    expect(i18n("sign_in")).toBe("Sign in");
  });
});
