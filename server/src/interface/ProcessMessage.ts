import { Message } from "../utils/messageUtils";
import { DocRoomInfo } from "./Interface";

export enum C2M_MessageType {
  serverStarted = 1,
  updateRoomStatus = 2,
  C2M_OpenMessageResponse = 3,
  C2M_CloseMessageResponse = 4,
}

export enum M2C_MessageType {
  M2C_OpenMessageRequest = 1,
  closeDoc = 2,
}

export interface C2M_UpdateRoomStatusMessage {
  messageType: C2M_MessageType.updateRoomStatus;
  status: DocRoomInfo;
}

export interface C2M_OpenMessageResponse {
  messageType: C2M_MessageType.C2M_OpenMessageResponse;
  success: boolean;
  status?: DocRoomInfo;
}

export interface C2M_CloseMessageResponse {
  messageType: C2M_MessageType.C2M_CloseMessageResponse;
  success: boolean;
}

export type C2M_ProcessMessage = (
  | C2M_UpdateRoomStatusMessage
  | { messageType: C2M_MessageType.serverStarted }
  | C2M_OpenMessageResponse
  | C2M_CloseMessageResponse
) &
  Message;

export interface M2C_OpenMessageRequest {
  messageType: M2C_MessageType.M2C_OpenMessageRequest;
  docID: string;
}

export interface M2C_CloseMessageRequest {
  messageType: M2C_MessageType.closeDoc;
  docID: string;
}

export type M2C_ProcessMessage = (
  | M2C_OpenMessageRequest
  | M2C_CloseMessageRequest
) &
  Message;
