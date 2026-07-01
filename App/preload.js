const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (content, defaultName) => ipcRenderer.invoke('save-file', content, defaultName),
  openFile: () => ipcRenderer.invoke('open-file'),
});
