const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  listProjects: () => ipcRenderer.invoke('list-projects'),
  createSandboxProject: (n) => ipcRenderer.invoke('create-sandbox-project', n),
  createLocalProject: (n, p) => ipcRenderer.invoke('create-local-project', n, p),
  deleteProject: (n) => ipcRenderer.invoke('delete-project', n),

  loadSession: (n) => ipcRenderer.invoke('load-session', n),
  saveSession: (n, d) => ipcRenderer.invoke('save-session', n, d),

  projectListFiles: (n) => ipcRenderer.invoke('project-list-files', n),
  projectReadFile: (n, f) => ipcRenderer.invoke('project-read-file', n, f),
  projectWriteFile: (n, f, c) => ipcRenderer.invoke('project-write-file', n, f, c),
  projectDeleteFile: (n, f) => ipcRenderer.invoke('project-delete-file', n, f),
  projectRenameFile: (n, o, n2) => ipcRenderer.invoke('project-rename-file', n, o, n2),

  getProjectRoot: (n) => ipcRenderer.invoke('get-project-root', n),
  searchInFiles: (n, q) => ipcRenderer.invoke('search-in-files', n, q),

  exportZip: (n) => ipcRenderer.invoke('export-zip', n),

  getSandboxDir: () => ipcRenderer.invoke('get-sandbox-dir'),
  sandboxListFiles: (s) => ipcRenderer.invoke('sandbox-list-files', s),
  sandboxReadFile: (s, f) => ipcRenderer.invoke('sandbox-read-file', s, f),
  sandboxWriteFile: (s, f, c) => ipcRenderer.invoke('sandbox-write-file', s, f, c),
  sandboxDeleteFile: (s, f) => ipcRenderer.invoke('sandbox-delete-file', s, f),
  sandboxExec: (s, c) => ipcRenderer.invoke('sandbox-exec', s, c),

  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectNewFolder: () => ipcRenderer.invoke('select-new-folder'),

  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (e) => ipcRenderer.invoke('set-auto-start', e),

  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  savePlugins: (d) => ipcRenderer.invoke('save-plugins', d),

  webSearch: (q, n) => ipcRenderer.invoke('web-search', q, n),
});
