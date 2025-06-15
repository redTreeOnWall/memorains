"use strict";
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// contextBridge.exposeInMainWorld("memo_note", {
//   getBasePath: () => ipcRenderer.send("do-a-thing"),
// });

const createWindow = async () => {
  ipcMain.on("R2M_config", (event, message) => {
    console.log("Received message:", message);
    event.reply(
      "M2R_config",
      JSON.stringify({
        path: path.join(__dirname, "../../dist"),
      }),
    );
  });

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    autoHideMenuBar: true,
    icon: "./electron/icons/icon.png",
  });

  mainWindow.loadFile("./dist/index.html");

  // mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
