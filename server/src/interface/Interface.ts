import { DocumentEntity } from "./DataEntity";
import { DocRoomInfoData } from "./HttpMessage";

export interface DocApplication {
  docServerManager: DocServerManager;

  userServer: UserServer;

  init: () => Promise<void>;
}

export interface DataBaseManager {
  init: (autoCreateTables?: boolean) => Promise<void>;

  getUpdateOfDocument: (docId: string) => Promise<void>;

  createDocument: (document: DocumentEntity) => Promise<boolean>;

  getDocument: (
    docId: string,
    readState: boolean
  ) => Promise<DocumentEntity | null>;

  updateStateOfDocument: (
    docId: string,
    state: Uint8Array,
    commitId: number
  ) => Promise<boolean>;

  getAllDoc: (userId: string) => Promise<DocumentEntity[] | null>;
}

export interface DocRoomInfo {
  // TODO Add room id for opening a doc in different rooms
  docId: string;
  currentUserCount: number;
  updateBytePerSecond: number;
  serverInstanceId: string;
  password: string;
}

export interface UserServer {
  app: DocApplication;

  database: DataBaseManager;

  init: () => Promise<void>;

  logIn: (userId: string) => Promise<boolean>;

  checkUserAuth: (jwt: string) => Promise<boolean>;

  /**
   * @returns doc id
   */
  addDoc: () => Promise<string>;

  /**
   * @returns return RooInfo when open success, or null when no permission
   */
  openDoc: (docId: string) => Promise<DocRoomInfo | null>;
}

/**
 * All the doc server and doc room will be managed by DocServerManager.
 * DocServerManager will operate opening and closing all the document.
 * DocServerManager will be maintained in main process, and it should
 * be a single instance.
 *
 * To avoid to open a same doc in different rooms, the active room list
 * should maintained in the DocumentManager. The DocServerManager will
 * send the opening or closing command to DocServer to build or destroy
 * document room.
 *
 * In current step, There will be a single manager, and in nest step, the
 * active document room will maintained by DB or other memory store.
 */
export interface DocServerManager {
  app: DocApplication;

  /**
   * Map<serverId, server status>
   */
  serverMap: Map<string, DocServerStatus>;

  docRoomMap: Map<string, DocRoomInfo>;

  init: () => Promise<void>;

  requestOpenDoc: (docID: string) => Promise<DocRoomInfoData | null>;

  requestCloseDoc: (docID: string) => Promise<boolean>;
}

export interface DocServerStatus {
  id: string;
  host: string;
  port: number;
  status: "created" | "started" | "closed";
}

export interface DocServer {
  id: string;

  host: string;

  port: number;

  database: DataBaseManager;

  init: () => Promise<void>;
}

export interface OnlineUser {
  userId: string;

  sendMessage: () => void;

  onMessage: (message: string) => void;

  close: () => Promise<void>;
}
