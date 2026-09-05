function registerSystemIpc({ ipcMain, systemService }) {
  ipcMain.handle('show-notification', (event, title, body) => systemService.showNotification(title, body));
  ipcMain.handle('set-fullscreen', (event, flag) => systemService.setFullscreen(flag));
  ipcMain.handle('is-full-screen', () => systemService.isFullScreen());
  ipcMain.handle('select-folder', async () => systemService.selectFolder());
  ipcMain.handle('select-new-folder', async () => systemService.selectNewFolder());
  ipcMain.handle('get-auto-start', () => systemService.getAutoStart());
  ipcMain.handle('set-auto-start', (event, enable) => systemService.setAutoStart(enable));
  ipcMain.handle('get-plugins', () => systemService.getPlugins());
  ipcMain.handle('save-plugins', (event, data) => systemService.savePlugins(data));
  ipcMain.handle('open-external', async (event, url) => systemService.openExternal(url));
}

module.exports = { registerSystemIpc };