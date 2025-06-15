import { stringMap } from "./stringMap";

export interface StringMapType {
  [key: string]: {
    en: string;
    zh: string;
    comment?: string;
  };
}

type KeyType = keyof typeof stringMap;

export type Checker = typeof stringMap extends StringMapType ? 1 : 0;

export const checker: Checker = 1;

type LanType = "en" | "zh";

const keyMap = {
  "zh-CN": "zh",
  "en-US": "en",
};

const currentLan = navigator.language;
export const i18n = (key: KeyType) => {
  let language = (keyMap as unknown as { [k: string]: LanType | undefined })[
    currentLan
  ];

  if (!language) {
    language = "en";
  }

  const value = stringMap[key][language];
  return value;
};
