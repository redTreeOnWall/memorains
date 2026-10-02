import { stringMap } from "./stringMap";
import { BindableProperty } from "../utils/BindableProperty";

export interface StringMapType {
  [key: string]: {
    en: string;
    zh: string;
    comment?: string;
  };
}

export type KeyType = keyof typeof stringMap;

/** Public alias for i18n keys, usable by other modules (e.g. doc type plugins). */
export type I18nKey = KeyType;

export type Checker = typeof stringMap extends StringMapType ? 1 : 0;

export const checker: Checker = 1;

export type LanType = "en" | "zh";

const languageKey = "memorains_language";

export const supportedLanguages: {
  code: LanType;
  flag: string;
  label: string;
}[] = [
  { code: "zh", flag: "🇨🇳", label: "简体中文" },
  { code: "en", flag: "🇬🇧", label: "English" },
];

const normalizeLanguage = (tag: string | null | undefined): LanType => {
  return tag?.toLowerCase().startsWith("zh") ? "zh" : "en";
};

const initialLanguage = (): LanType => {
  const stored = localStorage.getItem(languageKey);
  return stored === "en" || stored === "zh"
    ? stored
    : normalizeLanguage(navigator.language);
};

const applyDocumentLanguage = (language: LanType) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
};

class LanguageStore {
  readonly property = new BindableProperty<LanType>(initialLanguage());

  constructor() {
    applyDocumentLanguage(this.property.value);
    this.property.addValueChangeListener((value) => {
      localStorage.setItem(languageKey, value);
      applyDocumentLanguage(value);
    });
  }

  get language(): LanType {
    return this.property.value;
  }

  get locale(): string {
    return this.language === "zh" ? "zh-CN" : "en-US";
  }
}

export const languageStore = new LanguageStore();

export const setLanguage = (language: LanType) => {
  languageStore.property.value = language;
};

export const getCurrentLan = () => languageStore.locale;

export const i18n = (key: KeyType) => {
  const value = stringMap[key][languageStore.language];
  return value;
};
