import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import moment from "moment";

export const uuid = () => {
  return uuidv4();
};

export const awaitTime = (millSeconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, millSeconds);
  });

export const genRandomString = () => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(100));
  const base64 = Buffer.from(randomBytes).toString("base64").slice(0, 100);
  return `lrl_doc_${base64}`.slice(0, 120);
};

export const getSaltedPassword = (originPassword: string, salt: string) => {
  const passHash = crypto
    .createHash("sha256")
    .update(originPassword)
    .update(crypto.createHash("sha256").update(salt, "utf8").digest("hex"))
    .digest("hex");
  return passHash;
};

export const isString = (str?: string): str is string =>
  !!str && typeof str === "string";

export const isNumber = (num?: number): num is number =>
  typeof num === "number" && !isNaN(num);

export const isBoolean = (bool?: boolean): bool is boolean =>
  typeof bool === "boolean";

export const randomInt = () => Math.floor(Math.random() * 0x2fffffff);

export const toMysqlDate = (date: Date) =>
  moment(date).format("YYYY-MM-DD HH:mm:ss");

export const log = (logText: string) => {
  const date = new Date();
  console.log(
    `[${date.toLocaleString()}.${date.getMilliseconds()}] ${logText}`
  );
};
