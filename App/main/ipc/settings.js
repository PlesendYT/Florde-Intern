function registerSettingsIpc({ ipcMain, settingsService }) {
  ipcMain.handle('get-settings', () => settingsService.get());
  ipcMain.handle('save-settings', (event, settings) => settingsService.save(settings));
}

module.exports = { registerSettingsIpc };