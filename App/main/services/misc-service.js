const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, safeStorage, shell } = require('electron');

class MiscService {
  constructor(options = {}) {
    this._getMainWindow = options.getMainWindow || (() => null);
    this._browserWindow = null;
  }

  keychainStore({ key, value }) {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'OS keychain not available on this system' };
      }
      const encrypted = safeStorage.encryptString(value);
      const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
      let keychain = {};
      try { keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8')); } catch (e) {}
      keychain[key] = encrypted.toString('base64');
      fs.writeFileSync(keychainPath, JSON.stringify(keychain));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  keychainRetrieve({ key }) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
    try {
      const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
      if (!keychain[key]) return null;
      const encrypted = Buffer.from(keychain[key], 'base64');
      return safeStorage.decryptString(encrypted);
    } catch (e) { return null; }
  }

  keychainDelete({ key }) {
    const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
    try {
      const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
      delete keychain[key];
      fs.writeFileSync(keychainPath, JSON.stringify(keychain));
    } catch (e) {}
  }

  keychainList() {
    const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
    try {
      const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
      return Object.keys(keychain);
    } catch (e) { return []; }
  }

  _assertHttpUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2000) {
      throw new Error('Invalid URL');
    }
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http(s) URLs allowed');
    }
    return url;
  }

  openBrowser(url) {
    if (url) this._assertHttpUrl(url);
    if (this._browserWindow && !this._browserWindow.isDestroyed()) {
      this._browserWindow.show();
      this._browserWindow.focus();
      if (url) this._browserWindow.loadURL(url);
      return;
    }
    this._browserWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      title: 'Florde Browser',
      backgroundColor: '#1a1a2e',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowFileAccess: false,
        allowRunningInsecureContent: false,
        preload: path.join(__dirname, '../../preload/browser-preload.js'),
      },
    });
    this._browserWindow.on('closed', () => {
      this._browserWindow = null;
      const main = this._getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send('browser-closed');
      }
    });
    if (url) this._browserWindow.loadURL(url);
  }

  browserNavigate(url) {
    this._assertHttpUrl(url);
    if (this._browserWindow && !this._browserWindow.isDestroyed()) this._browserWindow.loadURL(url);
  }

  async browserEvaluate(js) {
    if (!this._browserWindow || this._browserWindow.isDestroyed()) throw new Error('No page loaded in browser. Use browser:open first.');
    try {
      return await Promise.race([
        this._browserWindow.webContents.executeJavaScript(js),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation timeout (15s)')), 15000))
      ]);
    } catch (err) {
      throw new Error('Browser JS error: ' + err.message);
    }
  }

  async browserCapturePage() {
    if (!this._browserWindow || this._browserWindow.isDestroyed()) throw new Error('Browser window not open');
    const img = await this._browserWindow.webContents.capturePage();
    return img.toDataURL();
  }

  browserGoBack() {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) this._browserWindow.webContents.goBack();
  }

  browserGoForward() {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) this._browserWindow.webContents.goForward();
  }

  browserReload() {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) this._browserWindow.webContents.reload();
  }

  browserClose() {
    if (this._browserWindow && !this._browserWindow.isDestroyed()) this._browserWindow.close();
  }

  browserIsOpen() {
    return this._browserWindow !== null && !this._browserWindow.isDestroyed();
  }

  handleNavBack() { this.browserGoBack(); }
  handleNavForward() { this.browserGoForward(); }
  handleNavReload() { this.browserReload(); }
  handleNavUrl(url) { this.browserNavigate(url); }
  handleNavExternal(url) {
    if (!url) return;
    const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    try { this._assertHttpUrl(target); } catch { return; }
    shell.openExternal(target);
  }

  attachNavSyncHandler() {
    app.on('web-contents-created', (event, wc) => {
      wc.on('did-navigate', (event, url) => {
        if (this._browserWindow && wc === this._browserWindow.webContents) {
          this._browserWindow.webContents.executeJavaScript(
            `document.getElementById('florde-browser-url').value = ${JSON.stringify(url)};`
          ).catch(() => {});
        }
      });
      wc.on('did-navigate-in-page', (event, url) => {
        if (this._browserWindow && wc === this._browserWindow.webContents) {
          this._browserWindow.webContents.executeJavaScript(
            `document.getElementById('florde-browser-url').value = ${JSON.stringify(url)};`
          ).catch(() => {});
        }
      });
    });
  }
}

module.exports = { MiscService };