import { LRUCache } from "lru-cache";
import { v4 as uuidv4 } from "uuid";
import { DocType, type DocumentEntity } from "../interface/DataEntity";
import { NavigateFunction } from "react-router-dom";

export const uuid = () => {
  return uuidv4();
};

export const byteArrayToBase64 = (byteArray: Uint8Array) => {
  return new Promise<string>((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onloadend = (e) => {
      const result = e.target?.result;
      console.log(result);

      if (typeof result === "string") {
        resolve(result.split(",")[1]);
      } else {
        reject();
      }
    };

    fileReader.readAsDataURL(new Blob([byteArray]));
  });
};

export const checkPassword = (password: string) => {
  // FIXME
  return typeof password === "string" && password.length > 5;
};

export const awaitTime = async (millSeconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, millSeconds);
  });

export const isDev = () => import.meta.env.DEV;

export const hashCode = (name: string) => {
  let hash = 0,
    i,
    chr;
  if (name.length === 0) return hash;
  for (i = 0; i < name.length; i++) {
    chr = name.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

export const hslToRgb = (h: number, s: number, l: number) => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.floor(
      255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))),
    );
  return [f(0), f(8), f(4)];
};

export const hashColor = (name: string) => {
  const hash = hashCode(name);

  const hue = Math.abs(hash % 360);

  const light = 30;

  const saturation = 80;

  const [r, g, b] = hslToRgb(hue, saturation, light);

  return { r, g, b };
};

const hashColorCache = new LRUCache<
  string,
  { r: number; g: number; b: number }
>({ max: 1000 });
export const hashColorWitchCache = (name: string) => {
  const exitColor = hashColorCache.get(name);
  if (exitColor) {
    exitColor;
  }

  const color = hashColor(name);
  hashColorCache.set(name, color);
  return color;
};

export class AwaitableThrottle {
  dirty = true;
  constructor(
    private func: () => Promise<void>,
    private millSecond = 1000,
  ) {}

  private running = false;
  async askInvoke() {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    this.dirty = false;
    await this.func();
    await awaitTime(Math.ceil(this.millSecond));
    this.running = false;

    if (this.dirty) {
      this.askInvoke();
    }
  }

  async invokeAtOnce() {
    await this.func();
  }
}

export const randomInt = () => Math.floor(Math.random() * 0x2fffffff);

/**
 * TODO Download big file use [StreamSaver](https://github.com/jimmywarting/StreamSaver.js/blob/master/StreamSaver.js)
 */
export const downloadFile = (
  data: string,
  fileName: string,
  mimeType = "application/json",
) => {
  // Create a Blob with the data and specified MIME type
  const blob = new Blob([data], { type: mimeType });

  // Create a temporary URL for the Blob
  const url = window.URL.createObjectURL(blob);

  // Create a link element
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;

  // Append the link to the document body
  document.body.appendChild(link);

  // Trigger a click event on the link to initiate the download
  link.click();

  // Remove the link from the document body
  document.body.removeChild(link);

  // Release the Blob URL
  window.URL.revokeObjectURL(url);
};

export const arrayBufferToBase64 = async (arrayBuffer: ArrayBuffer) => {
  return new Promise<string>((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = function () {
      const base64String = fileReader.result?.toString().split(",")[1] || "";
      resolve(base64String);
    };
    fileReader.onerror = function () {
      reject(new Error("Error occurred while reading the ArrayBuffer."));
    };
    const blob = new Blob([arrayBuffer]);
    fileReader.readAsDataURL(blob);
  });
};

// base64 to buffer
export const base64ToBuffer = async (base64: string) => {
  return new Promise<ArrayBuffer>((resolve) => {
    const dataUrl = "data:application/octet-binary;base64," + base64;

    fetch(dataUrl)
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        resolve(buffer);
      });
  });
};

export const detectMobile = () => {
  const toMatch = [
    /Android/i,
    /webOS/i,
    /iPhone/i,
    /iPad/i,
    /iPod/i,
    /BlackBerry/i,
    /Windows Phone/i,
  ];

  return toMatch.some((toMatchItem) => {
    return navigator.userAgent.match(toMatchItem);
  });
};

export const toSizeString = (size: number) => {
  const base = 1024;
  const units = ["B", "KB", "MB", "GB"];
  let unitsIndex = 0;
  for (let i = 0; i < units.length; i++) {
    unitsIndex = i;
    if (size < base ** (unitsIndex + 1)) {
      break;
    }
  }

  return `${Math.round((size * 10) / base ** unitsIndex) / 10}${
    units[unitsIndex]
  }`;
};

export const getSecretKey = () => `fast_note_secret`;

export interface DocIdSecretDic {
  [docId: string]: {
    docId: string;
    cryptoKey: string;
  };
}

export const getCryptoKeyFromLocal = async (docId: string) => {
  const json = localStorage.getItem(getSecretKey());
  if (!json) {
    return null;
  }

  const dic = JSON.parse(json) as DocIdSecretDic;
  return dic[docId] ?? null;
};

export const setCryptoKeyToLocal = async (docId: string, cryptoKey: string) => {
  const json = localStorage.getItem(getSecretKey()) ?? "{}";

  const dic = JSON.parse(json) as DocIdSecretDic;
  dic[docId] = {
    docId,
    cryptoKey,
  };

  localStorage.setItem(getSecretKey(), JSON.stringify(dic));
};

export const deleteCryptoKeyFromLocal = (docId: string) => {
  const json = localStorage.getItem(getSecretKey()) ?? "{}";

  const dic = JSON.parse(json) as DocIdSecretDic;
  if (dic[docId]) {
    delete dic[docId];
  }
  localStorage.setItem(getSecretKey(), JSON.stringify(dic));
};

export const exportKeyToBase64 = async (key: CryptoKey) => {
  const raw = await crypto.subtle.exportKey("raw", key);
  const rawArray = new Uint8Array(raw);

  const base64 = btoa(String.fromCharCode(...rawArray));
  return base64;
};

export async function importAES128Key(rawKey: ArrayBuffer) {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    {
      name: "AES-GCM",
      length: 128,
    },
    true,
    ["encrypt", "decrypt"],
  );
  return key;
}

function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function deriveAESKey(password: string, salt: string) {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function deriveAESKeyToBase64(password: string, salt: string) {
  const cryptoKey = await deriveAESKey(password, salt);
  return exportKeyToBase64(cryptoKey);
}

export async function importAES128KeyFromBase64(base64Key: string) {
  const rawKey = base64ToArrayBuffer(base64Key);
  return importAES128Key(rawKey);
}

export function generateSalt(length: number) {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  const binary = String.fromCharCode(...array.values());
  return window.btoa(binary);
}

export async function encryptData(data: ArrayBuffer, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // const iv = new Uint8Array(12);

  const originEncryptedData = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data,
  );

  const buffer = new Uint8Array(iv.byteLength + originEncryptedData.byteLength);
  buffer.set(iv, 0);
  buffer.set(new Uint8Array(originEncryptedData), iv.byteLength);
  return buffer.buffer;
}

export async function decryptData(encryptedData: ArrayBuffer, key: CryptoKey) {
  if (encryptedData.byteLength < 12) {
    return encryptedData;
  }

  const iv = new Uint8Array(encryptedData.slice(0, 12));
  const data = encryptedData.slice(12, encryptedData.byteLength);
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data,
  );

  return decryptedData;
}

export const openDoc = (
  docType: DocType,
  docId: string,
  navigate: NavigateFunction,
) => {
  // TODO unify the router
  if (docType === DocType.text) {
    navigate(`/document?docId=${docId}`);
  } else if (docType === DocType.canvas) {
    navigate(`/canvas?docId=${docId}`);
  }
};
