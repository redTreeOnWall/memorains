"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageActor = void 0;
class MessageActor {
    constructor(sendMessage) {
        this.sendMessage = sendMessage;
        this.messageWaitingHandles = new Map();
        this.msgListeners = new Set();
        this.currentMessageId = 1;
        this.generateMessageId = () => {
            this.currentMessageId += 1;
            return this.currentMessageId;
        };
        this.destroyed = false;
    }
    receiveMessage(message) {
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
    request(message, timeout) {
        return new Promise((resolve, reject) => {
            if (timeout > 0) {
                const messageID = message.messageID ?? this.generateMessageId();
                message.messageID = messageID;
                let timerId = null;
                timerId = setTimeout(() => {
                    this.messageWaitingHandles.delete(messageID);
                    timerId = null;
                    reject(new Error("Time out when requesting message"));
                }, timeout);
                this.messageWaitingHandles.set(messageID, (msg) => {
                    if (timerId !== null) {
                        clearTimeout(timerId);
                    }
                    resolve(msg);
                });
            }
            this.sendMessage(message);
        });
    }
    response(message, originMessageId) {
        message.messageID = originMessageId;
        this.request(message, 0);
    }
    addMessageListener(handle) {
        this.msgListeners.add(handle);
    }
    removeMessageListener(handle) {
        this.msgListeners.delete(handle);
    }
    destroy() {
        this.destroyed = true;
        this.messageWaitingHandles.clear();
        this.msgListeners.clear();
    }
}
exports.MessageActor = MessageActor;
