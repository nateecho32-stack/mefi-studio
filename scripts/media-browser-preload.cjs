"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("mediaBrowser", {
  command: (action, url) => ipcRenderer.invoke("media-browser:command", { action, url }),
  onState: callback => { ipcRenderer.on("media-browser:state", (_event, state) => callback(state)); },
  onFocusAddress: callback => { ipcRenderer.on("media-browser:focus-address", () => callback()); },
});
