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

function resolvePreload(file) {
  // Security/dev (b-12): build layout is out/main -> out/preload; dev layout
  // is App/main.js -> App/preload.js. Pick whichever exists.
  const candidates = [
    path.join(__dirname, '../preload', file),
    path.join(__dirname, 'preload', file),
    path.join(__dirname, file),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return candidates[0];
}

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
      preload: resolvePreload('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
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
      if (kw && kw !== 'exec') return kw;
    }
    return cat;
  }

  // Security (F10): in-flight permission prompts, keyed by request fingerprint.
  const pendingPermission = new Map();

  const { randomBytes } = require('crypto');
  const permissionGate = new PermissionGate({
    store: permissionStore,
    askHandler: (info) => {
      // Security (F10): serialize identical concurrent requests onto one
      // dialog (no duplicate approvals), cap pending requests, correlate
      // responses with unpredictable IDs so one response can never settle
      // another request.
      const fingerprint = JSON.stringify([info.project || null, info.op || null, info.command || null, info.path || null]);
      if (pendingPermission.has(fingerprint)) return pendingPermission.get(fingerprint);
      if (pendingPermission.size >= 10) return Promise.resolve('block');
      const promise = new Promise((resolve) => {
        const requestId = 'req-' + randomBytes(16).toString('hex');
        let settled = false;
        let handler;
        const cleanup = () => {
          ipcMain.removeListener('sandbox:permission-respond', handler);
          if (pendingPermission.get(fingerprint) === promise) pendingPermission.delete(fingerprint);
        };
        const finish = (decision) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(decision);
          }
        };
        const timer = setTimeout(() => finish('block'), 120000);
        if (timer.unref) timer.unref();
        handler = (_e, payload) => {
          // Security (b-11): only the main window may answer permission
          // prompts — other windows/frames cannot approve.
          try {
            if (mainWindow && !mainWindow.isDestroyed() && _e && _e.sender !== mainWindow.webContents) {
              return;
            }
          } catch {}
          if (payload && payload.requestId === requestId && payload.decision && payload.decision !== 'ask') {
            if (payload.persist === 'always' && info.project) {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sandbox:permission-request', { ...info, requestId, category: resolveToolCategory(info.op), toolType: execRuleToolType(info) });
        } else {
          finish('block');
        }
      });
      pendingPermission.set(fingerprint, promise);
      return promise;
    },
  });
  sandboxService.setPermissionGate(permissionGate, permissionStore);

  const settingsService = new SettingsService();
  const translationService = new TranslationService();
  const fileService = new FileService({ getMainWindow });
  const shellService = new ShellService();
  if (typeof shellService.setPermissionGate === 'function') {
    shellService.setPermissionGate(permissionGate);
  }
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