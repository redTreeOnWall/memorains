import { Base64 } from "js-base64";

export interface UserJwtPayload {
  userId: string;
  lastLoginTime: number;
  expiresIn: number;
}

export const jwtKey = "lrl_doc_authorization";

export const getAuthorization = () => {
  const authorization = window.localStorage.getItem(jwtKey);
  if (!authorization) {
    return undefined;
  }

  try {
    const payloadBase64 = authorization.split(".")?.[1];
    const payloadJson = Base64.decode(payloadBase64);
    const payload = JSON.parse(payloadJson) as UserJwtPayload;

    if (payload.lastLoginTime + payload.expiresIn * 1000 <= Date.now()) {
      return undefined;
    }
    return { authorization, payload };
  } catch (e) {
    console.error(e);
    return undefined;
  }
};

export const saveJwt = (jwt: string) => {
  window.localStorage.setItem(jwtKey, jwt);
};
