import { BindableProperty } from "../utils/BindableProperty";
import { en } from "./languages/en";
import { zh } from "./languages/zh";
import type { StringKey } from "./languages/keys";

export type { StringKey };

/** Public alias for i18n keys, usable by other modules (e.g. doc type plugins). */
export type I18nKey = StringKey;

export type LanguageCode = string;

export interface Language {
  /**
   * Both the id stored in `localStorage` and the BCP-47 tag handed to `Intl`,
   * `moment` and Excalidraw.
   */
  code: LanguageCode;
  flag: string;
  /** The language's own name, so it reads correctly whatever language is active. */
  label: string;
  strings: Record<StringKey, string>;
}

const languageKey = "memorains_language";

export const supportedLanguages: Language[] = [
  { code: "en-US", flag: "🇬🇧", label: "English", strings: en },
  { code: "zh-CN", flag: "🇨🇳", label: "简体中文", strings: zh },
];

export const fallbackLanguage = supportedLanguages[0];

const matchByPrimarySubtag = (tag: string): Language | undefined => {
  const primary = tag.toLowerCase().split("-")[0];
  // "zh-HK" should find "zh-CN": the region picks the variant, not the language.
  return supportedLanguages.find(
    (language) => language.code.toLowerCase().split("-")[0] === primary,
  );
};

const initialLanguage = (): Language => {
  const stored = localStorage.getItem(languageKey);
  const fromStorage = stored
    ? supportedLanguages.find((language) => language.code === stored)
    : undefined;

  return (
    fromStorage ?? matchByPrimarySubtag(navigator.language) ?? fallbackLanguage
  );
};

const applyDocumentLanguage = (language: Language) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language.code;
  }
};

class LanguageStore {
  readonly property = new BindableProperty<Language>(initialLanguage());

  constructor() {
    applyDocumentLanguage(this.property.value);
    this.property.addValueChangeListener((value) => {
      localStorage.setItem(languageKey, value.code);
      applyDocumentLanguage(value);
    });
  }

  get language(): Language {
    return this.property.value;
  }

  get locale(): string {
    return this.language.code;
  }
}

export const languageStore = new LanguageStore();

export const setLanguage = (code: LanguageCode) => {
  const language = supportedLanguages.find(
    (candidate) => candidate.code === code,
  );
  if (language) {
    languageStore.property.value = language;
  }
};

export const getCurrentLan = () => languageStore.locale;

export const i18n = (key: StringKey): string => {
  const { strings } = languageStore.language;
  // A translated string is preferred, but `en` is always complete, so a language
  // that is still being filled in shows English rather than a blank label.
  return strings[key] ?? fallbackLanguage.strings[key] ?? key;
};
