const fs = require('fs');
const path = require('path');
const { app, dialog, Notification, shell } = require('electron');
const { getPluginsPath } = require('./shared');

class SystemService {
  constructor(options = {}) {
    this._getMainWindow = options.getMainWindow || (() => null);
  }

  showNotification(title, body) {
    const iconPath = path.join(app.getAppPath(), 'config', 'icon', 'icon.png');
    const n = new Notification({
      title,
      body,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {})
    });
    const win = this._getMainWindow();
    n.on('click', () => { if (win) { win.show(); win.focus(); } });
    n.show();
  }

  setFullscreen(flag) {
    const win = this._getMainWindow();
    if (win && !win.isDestroyed()) {
      win.setFullScreen(flag);
      return win.isFullScreen();
    }
    return false;
  }

  isFullScreen() {
    const win = this._getMainWindow();
    if (win && !win.isDestroyed()) {
      return win.isFullScreen();
    }
    return false;
  }

  async selectFolder() {
    const win = this._getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Folder',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  }

  async selectNewFolder() {
    const win = this._getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select or Create Folder',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  }

  getAutoStart() {
    return app.getLoginItemSettings().openAtLogin;
  }

  setAutoStart(enable) {
    app.setLoginItemSettings({ openAtLogin: enable });
    return true;
  }

  getPlugins() {
    try { return JSON.parse(fs.readFileSync(getPluginsPath(), 'utf-8')); }
    catch { return []; }
  }

  savePlugins(data) {
    try {
      fs.writeFileSync(getPluginsPath(), JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async openExternal(url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return { success: false, error: 'Blocked: only http, https, and mailto protocols are allowed' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { SystemService };