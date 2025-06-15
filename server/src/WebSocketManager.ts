import { Base64 } from "js-base64";
import { WebSocketServer } from "ws";
import { ConnectContext } from "./DocumentManager";

export interface Message {
  messageType: number;
  messageBody: Uint8Array;
}

export const convertToMessage = (message: any) => {
  if (message.messageType !== undefined && message.messageBody !== undefined) {
    return {
      messageType: message.messageType as number,
      messageBody: Base64.toUint8Array(message.messageBody as string),
    } as Message;
  }

  return null;
};

export class WebSocketManager {
  webSocketServer = new WebSocketServer({ port: 8080 });

  connectors = new Map<any, ConnectContext>();

  async init() {}
}
