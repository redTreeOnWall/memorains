import * as jwt from "jsonwebtoken";
import { getSecret } from "../security/secret";

export const asyncSign = (
  payload: Record<string, any>,
  expiresIn: number | string = "7d"
) =>
  new Promise<string>((resolve, reject) => {
    jwt.sign(
      payload,
      getSecret(),
      { algorithm: "HS256", expiresIn },
      (error, encoded) => {
        if (error || encoded === undefined) {
          reject();
        } else {
          resolve(encoded);
        }
      }
    );
  });

export const asyncVerify = <
  T extends Record<string, any> = Record<string, any>
>(
  token: string
) =>
  new Promise<T & jwt.JwtPayload>((resolve, reject) => {
    jwt.verify(token, getSecret(), (error, decoded) => {
      if (error || typeof decoded !== "object") {
        reject(error ?? new Error("Payload is not a object!"));
      } else {
        resolve(decoded as jwt.JwtPayload & T);
      }
    });
  });
