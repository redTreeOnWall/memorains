"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaitableLock = void 0;
class WaitableLock {
    constructor() {
        this._locked = false;
        this.modifyingLock = false;
        this.waitingHandles = new Set();
    }
    set locked(value) {
        if (this.modifyingLock) {
            throw new Error("Trying to lock when modifying!");
        }
        this.modifyingLock = true;
        this._locked = value;
        if (value === false) {
            this.waitingHandles.forEach((handle) => {
                handle();
            });
            this.waitingHandles = new Set();
        }
        this.modifyingLock = false;
    }
    get locked() {
        return this._locked;
    }
    async waitForUnlock(timeout = 0) {
        return new Promise((resolve, reject) => {
            if (!this.locked) {
                resolve();
                return;
            }
            let timeoutID = null;
            const onUnlocked = () => {
                if (timeoutID !== null) {
                    clearTimeout(timeoutID);
                }
                resolve();
            };
            this.waitingHandles.add(onUnlocked);
            if (timeout > 0) {
                timeoutID = setTimeout(() => {
                    this.waitingHandles.delete(onUnlocked);
                    reject(new Error("Timeout when waiting for unlock"));
                }, timeout);
            }
        });
    }
}
exports.WaitableLock = WaitableLock;
