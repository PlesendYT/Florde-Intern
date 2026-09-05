function registerFileIpc({ ipcMain, fileService }) {
  ipcMain.handle('list-projects', () => fileService.listProjects());
  ipcMain.handle('create-sandbox-project', (event, name) => fileService.createSandboxProject(name));
  ipcMain.handle('create-local-project', async (event, name, folderPath) => fileService.createLocalProject(name, folderPath));
  ipcMain.handle('delete-project', (event, name) => fileService.deleteProject(name));
  ipcMain.handle('load-session', (event, name) => fileService.loadSession(name));
  ipcMain.handle('save-session', (event, name, data) => fileService.saveSession(name, data));
  ipcMain.handle('get-project-root', (event, name) => fileService.getProjectRoot(name));

  ipcMain.handle('project-list-files', (event, name) => fileService.listProjectFiles(name));
  ipcMain.handle('project-read-file', (event, name, filePath) => fileService.readProjectFile(name, filePath));
  ipcMain.handle('project-write-file', (event, name, filePath, content) => fileService.writeProjectFile(name, filePath, content));
  ipcMain.handle('project-delete-file', (event, name, filePath) => fileService.deleteProjectFile(name, filePath));
  ipcMain.handle('project-rename-file', (event, name, oldPath, newPath) => fileService.renameProjectFile(name, oldPath, newPath));
  ipcMain.handle('search-in-files', async (event, name, query) => fileService.searchInFiles(name, query));
  ipcMain.handle('export-zip', async (event, name) => fileService.exportZip(name));

  ipcMain.handle('watch-project', (event, projectName) => fileService.watchProject(projectName));
  ipcMain.handle('unwatch-project', (event, projectName) => fileService.unwatchProject(projectName));
}

module.exports = { registerFileIpc };