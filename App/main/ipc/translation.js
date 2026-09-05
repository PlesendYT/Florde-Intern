function registerTranslationIpc({ ipcMain, translationService }) {
  ipcMain.handle('translation:get-cache', () => translationService.getCache());
  ipcMain.handle('translation:save-cache', (event, cache) => translationService.saveCache(cache));
  ipcMain.handle('translation:translate', async (event, text, sourceLang, targetLang) => translationService.translate(text, sourceLang, targetLang));
}

module.exports = { registerTranslationIpc };