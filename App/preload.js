const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  createProject: (n) => ipcRenderer.invoke('create-project', n),
  deleteProject: (n) => ipcRenderer.invoke('delete-project', n),
  loadSession: (n) => ipcRenderer.invoke('load-session', n),
  saveSession: (n, d) => ipcRenderer.invoke('save-session', n, d),
  projectListFiles: (n) => ipcRenderer.invoke('project-list-files', n),
  projectReadFile: (n, f) => ipcRenderer.invoke('project-read-file', n, f),
  projectWriteFile: (n, f, c) => ipcRenderer.invoke('project-write-file', n, f, c),
  projectDeleteFile: (n, f) => ipcRenderer.invoke('project-delete-file', n, f),
});
