import {
  C2S_DeleteDocMessage,
  C2S_ShareDocMessage,
  C2S_SignInMessage,
  C2S_SignUpMessage,
  C2S_UpdateNameMessage,
  S2C_DocRoomInfoMessage,
  S2C_DocListMessage,
  S2C_Message,
  S2C_SignInMessage,
  C2S_DocInfo,
  S2C_DocInfo,
  S2C_CreateDoc,
  C2S_DocRoomInfoMessage,
  C2S_CreateDoc,
  C2S_UpdateDocState,
} from "../interface/HttpMessage";

interface HttpApiItem {
  path: string;
  method: "POST" | "GET";
  requestBodyType: object | undefined;
  responseType: S2C_Message;
  needAuthorization: boolean;
}

export const httpApiMap = {
  signIn: {
    path: "sign-in",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_SignInMessage,
    responseType: undefined as unknown as S2C_SignInMessage,
    needAuthorization: false,
  },
  signUp: {
    path: "sign-up",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_SignUpMessage,
    responseType: undefined as unknown as S2C_Message,
    needAuthorization: false,
  },
  docList: {
    path: "docList",
    method: "POST",
    requestBodyType: undefined,
    responseType: undefined as unknown as S2C_DocListMessage,
    needAuthorization: true,
  },
  createDoc: {
    path: "create-doc",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_CreateDoc,
    responseType: undefined as unknown as S2C_CreateDoc,
    needAuthorization: true,
  },
  docRoomInfo: {
    path: "docRoomInfo",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_DocRoomInfoMessage,
    responseType: undefined as unknown as S2C_DocRoomInfoMessage,
    needAuthorization: true,
  },
  deleteDoc: {
    path: "deleteDoc",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_DeleteDocMessage,
    responseType: undefined as unknown as S2C_Message,
    needAuthorization: true,
  },
  updateDocName: {
    path: "updateDocName",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_UpdateNameMessage,
    responseType: undefined as unknown as S2C_Message,
    needAuthorization: true,
  },
  shareDoc: {
    path: "shareDoc",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_ShareDocMessage,
    responseType: undefined as unknown as S2C_Message,
    needAuthorization: true,
  },
  docInfo: {
    path: "docInfo",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_DocInfo,
    responseType: undefined as unknown as S2C_DocInfo,
    needAuthorization: true,
  },
  getPublicDoc: {
    path: "getPublicDoc",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_DocInfo,
    responseType: undefined as unknown as S2C_DocInfo,
    needAuthorization: false,
  },
  updateDocState: {
    path: "updateDocState",
    method: "POST",
    requestBodyType: undefined as unknown as C2S_UpdateDocState,
    responseType: undefined as unknown as S2C_Message,
    needAuthorization: true,
  },
} as const;

export type ApiNames = keyof typeof httpApiMap;

export type RequestBodyType<T extends ApiNames> =
  (typeof httpApiMap)[T]["requestBodyType"];

export type ResponseType<T extends ApiNames> =
  (typeof httpApiMap)[T]["responseType"];

export type isHttpApiMapCorrect =
  (typeof httpApiMap)[keyof typeof httpApiMap] extends HttpApiItem
    ? "true"
    : "false";

export const httpApiMapCorrect: isHttpApiMapCorrect = "true";
