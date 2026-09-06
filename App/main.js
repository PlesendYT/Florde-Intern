const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { getProjectsDir, getSandboxDir } = require('./main/services/shared');
const { SandboxService } = require('./main/services/sandbox-service');
const { SettingsService } = require('./main/services/settings-service');
const { TranslationService } = require('./main/services/translation-service');
const { FileService } = require('./main/services/file-service');
const { ShellService } = require('./main/services/shell-service');
const { DbService } = require('./main/services/db-service');
const { SystemService } = require('./main/services/system-service');
const { MiscService } = require('./main/services/misc-service');
const { PermissionStore } = require('./main/services/permission-store');
const { PermissionGate, resolveToolCategory } = require('./main/services/permission-gate');
const { registerSandboxIpc } = require('./main/ipc/sandbox');
const { registerSettingsIpc } = require('./main/ipc/settings');
const { registerTranslationIpc } = require('./main/ipc/translation');
const { registerFileIpc } = require('./main/ipc/file');
const { registerShellIpc } = require('./main/ipc/shell');
const { registerDbIpc } = require('./main/ipc/db');
const { registerSystemIpc } = require('./main/ipc/system');
const { registerMiscIpc } = require('./main/ipc/misc');

let mainWindow;

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

function createWindow() {
  Menu.setApplicationMenu(null);
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#12121a', symbolColor: '#e0e0e0', height: 36 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      webviewTag: false,
    },
  });
  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  if (process.argv.includes('--dev') || DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  if (!fs.existsSync(getProjectsDir())) fs.mkdirSync(getProjectsDir(), { recursive: true });
  if (!fs.existsSync(getSandboxDir())) fs.mkdirSync(getSandboxDir(), { recursive: true });

  const getMainWindow = () => mainWindow;

  const sandboxService = new SandboxService({
    send: (channel, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
    },
    showSaveDialog: (opts) => dialog.showSaveDialog(mainWindow, opts),
  });

  const permissionStore = new PermissionStore(path.join(getSandboxDir(), 'permissions.db'));
  permissionStore.init();

  function execRuleToolType(info) {
    const cat = resolveToolCategory(info.op);
    if (cat === 'exec' && typeof info.command === 'string') {
      const kw = info.command.trim().split(/\s+/)[0];
      if (kw) return kw;
    }
    return cat;
  }

  let reqIdCounter = 0;
  const permissionGate = new PermissionGate({
    store: permissionStore,
    askHandler: (info) => new Promise((resolve) => {
      const requestId = 'req-' + (++reqIdCounter);
      let settled = false;
      let handler;
      const finish = (decision) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ipcMain.removeListener('sandbox:permission-respond', handler);
          resolve(decision);
        }
      };
      const timer = setTimeout(() => finish('block'), 120000);
      handler = (_e, payload) => {
        if (payload && payload.requestId === requestId && payload.decision && payload.decision !== 'ask') {
          if (payload.persist === 'always') {
            try {
              if (payload.decision === 'allow' || payload.decision === 'block') {
                permissionStore.set(info.project, execRuleToolType(info), payload.decision === 'allow' ? 'allow' : 'block');
              }
            } catch {}
          }
          finish(payload.decision);
        }
      };
      ipcMain.on('sandbox:permission-respond', handler);
      mainWindow.webContents.send('sandbox:permission-request', { ...info, requestId, category: resolveToolCategory(info.op), toolType: execRuleToolType(info) });
    }),
  });
  sandboxService.setPermissionGate(permissionGate, permissionStore);

  const settingsService = new SettingsService();
  const translationService = new TranslationService();
  const fileService = new FileService({ getMainWindow });
  const shellService = new ShellService();
  const dbService = new DbService();
  const systemService = new SystemService({ getMainWindow });
  const miscService = new MiscService({ getMainWindow });

  registerSandboxIpc({ ipcMain, sandboxService });
  registerSettingsIpc({ ipcMain, settingsService });
  registerTranslationIpc({ ipcMain, translationService });
  registerFileIpc({ ipcMain, fileService });
  registerShellIpc({ ipcMain, shellService });
  registerDbIpc({ ipcMain, dbService });
  registerSystemIpc({ ipcMain, systemService });
  registerMiscIpc({ ipcMain, miscService });

  miscService.attachNavSyncHandler();

  await sandboxService.restore();
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });