// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");
console.log("preload....");

contextBridge.exposeInMainWorld("memo_note", {
  sendMessage: (channel: any, message: any) =>
    ipcRenderer.send(channel, message),
  onMessage: (channel: any, callback: any) => ipcRenderer.on(channel, callback),
});
