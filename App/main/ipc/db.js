function registerDbIpc({ ipcMain, dbService }) {
  ipcMain.handle('florde:ensure-dir', (event, projectName) => dbService.ensureDir(projectName));
  ipcMain.handle('florde:check-dir', (event, projectName) => dbService.checkDir(projectName));
  ipcMain.handle('florde:remove-dir', (event, projectName) => dbService.removeDir(projectName));
  ipcMain.handle('florde:get-gitignore-state', (event, projectName) => dbService.getGitignoreState(projectName));
  ipcMain.handle('florde:set-gitignore-entry', (event, projectName, entry, exclude) => dbService.setGitignoreEntry(projectName, entry, exclude));

  ipcMain.handle('florde:init-db', (event, projectName) => dbService.initDb(projectName));
  ipcMain.handle('florde:get', (event, projectName, namespace, key) => dbService.get(projectName, namespace, key));
  ipcMain.handle('florde:set', (event, projectName, namespace, key, value) => dbService.set(projectName, namespace, key, value));
  ipcMain.handle('florde:delete', (event, projectName, namespace, key) => dbService.delete(projectName, namespace, key));
  ipcMain.handle('florde:get-all', (event, projectName, namespace) => dbService.getAll(projectName, namespace));
  ipcMain.handle('florde:query', (event, projectName, sql, params) => dbService.query(projectName, sql, params));
  ipcMain.handle('florde:run', (event, projectName, sql, params) => dbService.run(projectName, sql, params));
  ipcMain.handle('florde:transaction', (event, projectName, statements) => dbService.transaction(projectName, statements));
  ipcMain.handle('florde:close', (event, projectName) => dbService.close(projectName));
  ipcMain.handle('florde:get-db-path', (event, projectName) => dbService.getDbPath(projectName));
  ipcMain.handle('florde:get-dir-path', (event, projectName) => dbService.getDirPath(projectName));

  ipcMain.handle('florde:memory-read', (event, projectName, fileName) => dbService.memoryRead(projectName, fileName));
  ipcMain.handle('florde:memory-write', (event, projectName, fileName, content) => dbService.memoryWrite(projectName, fileName, content));
  ipcMain.handle('florde:memory-list', (event, projectName) => dbService.memoryList(projectName));

  ipcMain.handle('florde:temp-read', (event, projectName, fileName) => dbService.tempRead(projectName, fileName));
  ipcMain.handle('florde:temp-write', (event, projectName, fileName, content) => dbService.tempWrite(projectName, fileName, content));
  ipcMain.handle('florde:temp-list', (event, projectName) => dbService.tempList(projectName));
  ipcMain.handle('florde:temp-delete', (event, projectName, fileName) => dbService.tempDelete(projectName, fileName));
}

module.exports = { registerDbIpc };