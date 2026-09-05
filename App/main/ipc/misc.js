function registerMiscIpc({ ipcMain, miscService }) {
  ipcMain.handle('keychain:store', (event, payload) => miscService.keychainStore(payload));
  ipcMain.handle('keychain:retrieve', (event, payload) => miscService.keychainRetrieve(payload));
  ipcMain.handle('keychain:delete', (event, payload) => miscService.keychainDelete(payload));
  ipcMain.handle('keychain:list', () => miscService.keychainList());

  ipcMain.handle('browser:open', (event, url) => miscService.openBrowser(url));
  ipcMain.handle('browser:navigate', (event, url) => miscService.browserNavigate(url));
  ipcMain.handle('browser:evaluate', async (event, js) => miscService.browserEvaluate(js));
  ipcMain.handle('browser:capture-page', async () => miscService.browserCapturePage());
  ipcMain.handle('browser:go-back', () => miscService.browserGoBack());
  ipcMain.handle('browser:go-forward', () => miscService.browserGoForward());
  ipcMain.handle('browser:reload', () => miscService.browserReload());
  ipcMain.handle('browser:close', () => miscService.browserClose());
  ipcMain.handle('browser:is-open', () => miscService.browserIsOpen());

  ipcMain.on('browser-nav-back', () => miscService.handleNavBack());
  ipcMain.on('browser-nav-forward', () => miscService.handleNavForward());
  ipcMain.on('browser-nav-reload', () => miscService.handleNavReload());
  ipcMain.on('browser-nav-url', (event, url) => miscService.handleNavUrl(url));
  ipcMain.on('browser-nav-external', (event, url) => miscService.handleNavExternal(url));
}

module.exports = { registerMiscIpc };