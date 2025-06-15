export class WaitableLock {
  private _locked = false;

  private modifyingLock = false;
  set locked(value: boolean) {
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

  private waitingHandles: Set<() => void> = new Set();
  async waitForUnlock(timeout = 0) {
    return new Promise<void>((resolve, reject) => {
      if (!this.locked) {
        resolve();
        return;
      }

      let timeoutID: NodeJS.Timeout | null = null;

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
