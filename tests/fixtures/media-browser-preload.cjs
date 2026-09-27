const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fixtureMediaBridge", {
  mediaBrowserOpen: url => ipcRenderer.invoke("media-browser:open", url),
  mediaBrowserCommand: payload => ipcRenderer.invoke("media-browser:command", payload),
  onMediaBrowserState: callback => ipcRenderer.on("media-browser:state", (_event, state) => callback(state)),
  onMediaBrowserFocus: callback => ipcRenderer.on("media-browser:focus-address", () => callback()),
});
