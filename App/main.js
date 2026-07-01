const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const projectsDir = path.join(app.getPath('userData'), 'projects');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

ipcMain.handle('get-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch { return {}; }
});

ipcMain.handle('save-settings', (event, settings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('list-projects', () => {
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const metaPath = path.join(projectsDir, d.name, 'meta.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
      return { name: d.name, createdAt: meta.createdAt || 0 };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
});

ipcMain.handle('create-project', (event, name) => {
  const dir = path.join(projectsDir, name);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name, createdAt: Date.now() }, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return true;
});

ipcMain.handle('delete-project', (event, name) => {
  const dir = path.join(projectsDir, name);
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('load-session', (event, name) => {
  const p = path.join(projectsDir, name, 'session.json');
  if (!fs.existsSync(p)) return { history: [] };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
});

ipcMain.handle('save-session', (event, name, data) => {
  fs.writeFileSync(path.join(projectsDir, name, 'session.json'), JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('project-list-files', (event, name) => {
  const dir = path.join(projectsDir, name);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  function walk(d, prefix) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'meta.json' || e.name === 'session.json') continue;
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else files.push(prefix + e.name);
    }
  }
  walk(dir, '');
  return files;
});

ipcMain.handle('project-read-file', (event, projectName, filePath) => {
  const full = path.join(projectsDir, projectName, filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('project-write-file', (event, projectName, filePath, content) => {
  const full = path.join(projectsDir, projectName, filePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('project-delete-file', (event, projectName, filePath) => {
  const full = path.join(projectsDir, projectName, filePath);
  if (fs.existsSync(full)) { fs.unlinkSync(full); return true; }
  return false;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
