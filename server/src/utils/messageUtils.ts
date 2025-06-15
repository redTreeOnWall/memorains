export type Message = {
  messageID?: number;
};

export class MessageActor<
  SendMessage extends Message,
  ReceiveMessage extends Message
> {
  constructor(private sendMessage: (msg: SendMessage) => void) {}
  private messageWaitingHandles = new Map<
    number,
    (response: ReceiveMessage) => void
  >();

  private msgListeners = new Set<(msg: ReceiveMessage) => void>();

  receiveMessage(message: ReceiveMessage) {
    if (this.destroyed) {
      return;
    }

    const messageID = message.messageID;
    if (messageID) {
      const waitingHandle = this.messageWaitingHandles.get(messageID);
      if (waitingHandle) {
        waitingHandle(message);
        return;
      }
    }

    this.msgListeners.forEach((handle) => {
      handle(message);
    });
  }

  private currentMessageId = 1;
  generateMessageId = () => {
    this.currentMessageId += 1;
    return this.currentMessageId;
  };

  request<RESPONSE extends ReceiveMessage = ReceiveMessage>(
    message: SendMessage,
    timeout: number
  ): Promise<RESPONSE> {
    return new Promise<RESPONSE>((resolve, reject) => {
      if (timeout > 0) {
        const messageID = message.messageID ?? this.generateMessageId();
        message.messageID = messageID;
        let timerId: NodeJS.Timeout | null = null;
        timerId = setTimeout(() => {
          this.messageWaitingHandles.delete(messageID);
          timerId = null;
          reject(new Error("Time out when requesting message"));
        }, timeout);

        this.messageWaitingHandles.set(messageID, (msg) => {
          if (timerId !== null) {
            clearTimeout(timerId);
          }
          resolve(msg as RESPONSE);
        });
      }

      this.sendMessage(message);
    });
  }

  response(message: SendMessage, originMessageId: number) {
    message.messageID = originMessageId;
    this.request(message, 0);
  }

  addMessageListener<MSG extends ReceiveMessage>(handle: (msg: MSG) => void) {
    this.msgListeners.add(handle as (msg: ReceiveMessage) => void);
  }

  removeMessageListener<MSG extends ReceiveMessage>(
    handle: (msg: MSG) => void
  ) {
    this.msgListeners.delete(handle as (msg: ReceiveMessage) => void);
  }

  destroyed = false;
  destroy() {
    this.destroyed = true;
    this.messageWaitingHandles.clear();
    this.msgListeners.clear();
  }
}
