const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let mainWindow;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const projectsDir = path.join(app.getPath('userData'), 'projects');
const sandboxDir = path.join(app.getPath('userData'), 'sandbox');

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
if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

// ==================== SETTINGS ====================

ipcMain.handle('get-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch { return {}; }
});

ipcMain.handle('save-settings', (event, settings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
});

// ==================== PROJECTS ====================

function getProjectRoot(name) {
  if (!name) return null;
  const metaPath = path.join(projectsDir, name, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  if (meta.type === 'local') return meta.path;
  return path.join(projectsDir, name);
}

function getProjectMeta(name) {
  const p = path.join(projectsDir, name, 'meta.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

ipcMain.handle('list-projects', () => {
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const meta = getProjectMeta(d.name);
      if (!meta) return null;
      return { name: d.name, type: meta.type || 'sandbox', createdAt: meta.createdAt || 0, path: meta.path || '' };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
});

ipcMain.handle('create-sandbox-project', (event, name) => {
  const dir = path.join(projectsDir, name);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, type: 'sandbox', createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return true;
});

ipcMain.handle('create-local-project', async (event, name, folderPath) => {
  const dir = path.join(projectsDir, name);
  if (fs.existsSync(dir)) return { ok: false, error: 'exists' };
  if (!fs.existsSync(folderPath)) return { ok: false, error: 'path not found' };
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, type: 'local', path: folderPath, createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return { ok: true };
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

ipcMain.handle('get-project-root', (event, name) => getProjectRoot(name));

// ==================== FILE OPERATIONS ====================

ipcMain.handle('project-list-files', (event, name) => {
  const root = getProjectRoot(name);
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  function walk(d, prefix) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else files.push(prefix + e.name);
    }
  }
  walk(root, '');
  return files;
});

ipcMain.handle('project-read-file', (event, name, filePath) => {
  const root = getProjectRoot(name);
  if (!root) return null;
  const full = path.join(root, filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('project-write-file', (event, name, filePath, content) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const full = path.join(root, filePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('project-delete-file', (event, name, filePath) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const full = path.join(root, filePath);
  if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('project-rename-file', (event, name, oldPath, newPath) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const from = path.join(root, oldPath);
  const to = path.join(root, newPath);
  if (!fs.existsSync(from)) return false;
  const dir = path.dirname(to);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(from, to);
  return true;
});

// ==================== SEARCH IN FILES ====================

ipcMain.handle('search-in-files', (event, name, query) => {
  const root = getProjectRoot(name);
  if (!root || !fs.existsSync(root)) return [];
  const results = [];
  const lower = query.toLowerCase();
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lower)) {
              results.push({ file: path.relative(root, full), line: i + 1, text: lines[i].trim() });
            }
          }
        } catch {}
      }
    }
  }
  walk(root);
  return results;
});

// ==================== EXPORT ZIP ====================

ipcMain.handle('export-zip', async (event, name) => {
  const root = getProjectRoot(name);
  if (!root || !fs.existsSync(root)) return false;
  const meta = getProjectMeta(name);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${name}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${root}\\*' -DestinationPath '${result.filePath}' -Force"`, { timeout: 30000 });
    return true;
  } catch (e) {
    console.error('ZIP export failed:', e.message);
    return false;
  }
});

// ==================== SANDBOX ====================

ipcMain.handle('get-sandbox-dir', () => sandboxDir);

ipcMain.handle('sandbox-list-files', (event, sandboxPath) => {
  if (!sandboxPath || !fs.existsSync(sandboxPath)) return [];
  const files = [];
  function walk(d, prefix) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else files.push(prefix + e.name);
    }
  }
  walk(sandboxPath, '');
  return files;
});

ipcMain.handle('sandbox-read-file', (event, sandboxPath, filePath) => {
  const full = path.join(sandboxPath, filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('sandbox-write-file', (event, sandboxPath, filePath, content) => {
  const full = path.join(sandboxPath, filePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('sandbox-delete-file', (event, sandboxPath, filePath) => {
  const full = path.join(sandboxPath, filePath);
  if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('sandbox-exec', (event, sandboxPath, command) => {
  try {
    const output = execSync(command, { cwd: sandboxPath, timeout: 30000, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: e.stderr || e.message, code: e.status };
  }
});

// ==================== DIALOGS ====================

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-new-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select or Create Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ==================== AUTO START ====================

ipcMain.handle('get-auto-start', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-auto-start', (event, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
  return true;
});

// ==================== PLUGINS ====================

const pluginsPath = path.join(app.getPath('userData'), 'plugins.json');

ipcMain.handle('get-plugins', () => {
  try { return JSON.parse(fs.readFileSync(pluginsPath, 'utf-8')); }
  catch { return []; }
});

ipcMain.handle('save-plugins', (event, data) => {
  fs.writeFileSync(pluginsPath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('web-search', async (event, query, numResults = 5) => {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await new Promise((resolve, reject) => {
      const req = net.request(url);
      req.on('response', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    const results = [];
    const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = regex.exec(html)) !== null && results.length < numResults) {
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const url2 = m[1];
      if (title && url2 && !url2.includes('duckduckgo.com')) {
        results.push({ title, url: url2 });
      }
    }
    return JSON.stringify(results.slice(0, numResults));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
});

// ==================== APP ====================

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
