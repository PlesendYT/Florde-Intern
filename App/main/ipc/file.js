function registerFileIpc({ ipcMain, fileService }) {
  ipcMain.handle('list-projects', () => fileService.listProjects());
  ipcMain.handle('create-sandbox-project', (event, name) => fileService.createSandboxProject(name));
  ipcMain.handle('create-local-project', async (event, name, folderPath) => fileService.createLocalProject(name, folderPath));
  ipcMain.handle('delete-project', (event, name) => fileService.deleteProject(name));
  ipcMain.handle('load-session', (event, name) => fileService.loadSession(name));
  ipcMain.handle('save-session', (event, name, data) => fileService.saveSession(name, data));
  ipcMain.handle('get-project-root', (event, name) => fileService.getProjectRoot(name));

  ipcMain.handle('project-list-files', (event, name, opts) => fileService.listProjectFiles(name, opts));
  ipcMain.handle('project-read-file', (event, name, filePath, opts) => fileService.readProjectFile(name, filePath, opts));
  ipcMain.handle('stat-project-file', (event, name, filePath, opts) => fileService.statProjectFile(name, filePath, opts));
  ipcMain.handle('project-write-file', (event, name, filePath, content, opts) => fileService.writeProjectFile(name, filePath, content, opts));
  ipcMain.handle('project-delete-file', (event, name, filePath, opts) => fileService.deleteProjectFile(name, filePath, opts));
  ipcMain.handle('project-rename-file', (event, name, oldPath, newPath, opts) => fileService.renameProjectFile(name, oldPath, newPath, opts));
  ipcMain.handle('search-in-files', async (event, name, query, opts) => fileService.searchInFiles(name, query, opts));
  ipcMain.handle('export-zip', async (event, name) => fileService.exportZip(name));

  ipcMain.handle('watch-project', (event, projectName) => fileService.watchProject(projectName));
  ipcMain.handle('unwatch-project', (event, projectName) => fileService.unwatchProject(projectName));
}

module.exports = { registerFileIpc };