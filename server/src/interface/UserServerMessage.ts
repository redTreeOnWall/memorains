import { DocumentEntity } from "./DataEntity";

export enum ClientMessageType {
  updateDoc = 10001,
  updateCursor = 10002,
  syncVector = 10003,
}

export enum ServerMessageType {
  updateDoc = 20001,
  docInfo = 20002,
  userList = 20003,
  updateCursor = 20004,
  syncVector = 20005,
}

export interface C2S_UpdateDocMessage {
  messageType: ClientMessageType.updateDoc;
  // base64
  messageBody: string;

  commitId: number;
}

export interface C2S_UpdateCursorMessage {
  messageType: ClientMessageType.updateCursor;
  messageBody: { index: number; length: number };
}

export interface S2C_UpdateDocMessage {
  messageType: ServerMessageType.updateDoc;
  // base64
  data: string;
  commitId: number;
  origin?: string;
}

export interface C2S_SyncVectorMessage {
  messageType: ClientMessageType.syncVector;
  // base64
  messageBody: string;
}

export interface S2C_DocInfoMessage {
  messageType: ServerMessageType.docInfo;
  data: {
    docInfo: Omit<DocumentEntity, "state">;
  };
}

export interface S2C_UserListMessage {
  messageType: ServerMessageType.userList;
  data: {
    userList: {
      userId: string;
      userSessionId: string;
    }[];
  };
}

export interface S2C_UpdateCursorMessage {
  messageType: ServerMessageType.updateCursor;
  data: {
    cursor: {
      userSessionId: string;
      userId: string;
      range: {
        index: number;
        length: number;
      };
    };
  };
}

export interface S2C_SyncVectorMessage {
  messageType: ServerMessageType.syncVector;
  // base64
  data: string;
}

export type ClientMessage =
  | C2S_UpdateDocMessage
  | C2S_UpdateCursorMessage
  | C2S_SyncVectorMessage;

export type ServerMessage =
  | S2C_UpdateDocMessage
  | S2C_DocInfoMessage
  | S2C_UserListMessage
  | S2C_UpdateCursorMessage
  | S2C_SyncVectorMessage;
