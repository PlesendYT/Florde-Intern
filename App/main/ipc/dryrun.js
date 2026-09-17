function registerDryRunIpc({ ipcMain, dryrunService }) {
  ipcMain.handle('dryrun:start', (event, projectName, opts) => dryrunService.start(projectName, opts));
  ipcMain.handle('dryrun:cleanup', (event, projectName, session) => dryrunService.cleanup(projectName, session));
  ipcMain.handle('dryrun:orphans', () => dryrunService.orphans());
}

module.exports = { registerDryRunIpc };
