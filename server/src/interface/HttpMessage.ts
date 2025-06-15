import {
  DocType,
  DocumentEntity,
  DocumentEntityBase64,
  PrivilegeEnum,
} from "./DataEntity";

export interface S2C_Message {
  success?: boolean;
  code?: string;
  errorMessage?: string;
  data?: object;
}

export interface C2S_SignInMessage {
  userName?: string;
  password?: string;
}

export interface S2C_SignInMessage extends S2C_Message {
  data: {
    authorization: string;
  };
}

export interface C2S_SignUpMessage {
  userName?: string;
  password?: string;
  inviteCode?: string;
}

export interface S2C_DocListMessage extends S2C_Message {
  data: {
    docList: {
      id: string;
      title: string;
      user_id: string;
      create_date: string;
      last_modify_date: string;
      privilege: PrivilegeEnum;
      commit_id: number;
      doc_type: DocType;
      encrypt_salt?: string;
    }[];
  };
}

export interface C2S_DocRoomInfoMessage {
  docID?: string;
}

export interface DocRoomInfoData {
  serverHost: string;
  serverPort: number;
  docID: string;
  password: string;
}

export interface S2C_DocRoomInfoMessage extends S2C_Message {
  data:
    | {
        encrypted: true;
        docInfo: Omit<DocumentEntity, "state">;
      }
    | {
        encrypted: false;
        roomInfo: DocRoomInfoData;
        roomToken: string;
      };
}

export interface C2S_DeleteDocMessage {
  docID?: string;
}

export interface C2S_UpdateNameMessage {
  docID?: string;
  newName: string;
}

export interface C2S_ShareDocMessage {
  docID: string;
  userName: string;
  privilege: PrivilegeEnum;
}

export interface C2S_DocInfo {
  docID: string;
  needState?: boolean;
}

export interface S2C_DocInfo extends S2C_Message {
  data?: {
    doc: DocumentEntityBase64;
  };
}

export interface C2S_SyncDoc {
  doc: DocumentEntityBase64;
}

export interface S2C_SyncDoc extends S2C_Message {
  data: {
    mergedDoc: DocumentEntityBase64;
  };
}

export interface C2S_CreateDoc {
  newDoc?: Partial<Omit<DocumentEntity, "state">> & { state: string };
  docType?: DocType;
}

export interface S2C_CreateDoc extends S2C_Message {
  data: {
    newDocId: string;
  };
}

export interface C2S_UpdateDocState {
  docId: string;
  // base64
  stateBase64: string;
}
