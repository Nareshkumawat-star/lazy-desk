const { contextBridge, ipcRenderer } = require("electron");

function readArg(prefix) {
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

const token = readArg("--lazydesk-token=");
const apiBase = readArg("--lazydesk-api=") || "http://127.0.0.1:8765";

contextBridge.exposeInMainWorld("lazydesk", {
  token,
  apiBase,
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke("lazydesk:select-folder"),
  openExternal: (url) => ipcRenderer.invoke("lazydesk:open-external", url),
});
