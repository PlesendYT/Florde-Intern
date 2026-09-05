const { app, BrowserWindow, ipcMain, dialog, net, Menu, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const FlordeStorage = require('./storage');
const { SandboxService } = require('./main/services/sandbox-service');
const { registerSandboxIpc } = require('./main/ipc/sandbox');
const { getSettingsPath, getProjectsDir, getSandboxDir, getPluginsPath, isSafeProjectName, getProjectRoot, getProjectMeta, resolveSafe } = require('./main/services/shared');

const _flordeStores = new Map(); // projectName -> FlordeStorage instance

let mainWindow;
let sandboxService;

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
  sandboxService = new SandboxService({
    send: (channel, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
    },
    showSaveDialog: (opts) => dialog.showSaveDialog(mainWindow, opts),
  });
  registerSandboxIpc({ ipcMain, sandboxService });
  await sandboxService.restore();
  createWindow();
});

// ==================== NOTIFICATIONS ====================

ipcMain.handle('show-notification', (event, title, body) => {
  const iconPath = path.join(app.getAppPath(), 'config', 'icon', 'icon.png');
  const n = new Notification({
    title,
    body,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {})
  });
  n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  n.show();
});

// ==================== FULLSCREEN ====================

ipcMain.handle('set-fullscreen', (event, fs) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(fs);
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('is-full-screen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isFullScreen();
  }
  return false;
});

// ==================== SETTINGS ====================

ipcMain.handle('get-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
  } catch { return {}; }
});

ipcMain.handle('save-settings', (event, settings) => {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ==================== PROJECTS ====================

ipcMain.handle('list-projects', () => {
  if (!fs.existsSync(getProjectsDir())) return [];
  return fs.readdirSync(getProjectsDir(), { withFileTypes: true })
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
  if (!isSafeProjectName(name)) return false;
  const dir = path.join(getProjectsDir(), name);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, type: 'sandbox', createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return true;
});

ipcMain.handle('create-local-project', async (event, name, folderPath) => {
  if (!isSafeProjectName(name)) return { ok: false, error: 'invalid name' };
  const dir = path.join(getProjectsDir(), name);
  if (fs.existsSync(dir)) return { ok: false, error: 'exists' };
  if (!fs.existsSync(folderPath)) return { ok: false, error: 'path not found' };
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, type: 'local', path: folderPath, createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return { ok: true };
});

ipcMain.handle('delete-project', (event, name) => {
  if (!isSafeProjectName(name)) return { ok: false, error: 'invalid name' };
  const dir = path.join(getProjectsDir(), name);
  if (!fs.existsSync(dir)) return { ok: false, error: 'not found' };
  const meta = getProjectMeta(name);
  let flordePath = null;
  if (meta && meta.type === 'local') {
    const fd = getFlordeDir(name);
    if (fd && fs.existsSync(fd)) flordePath = fd;
  }
  fs.rmSync(dir, { recursive: true });
  return { ok: true, flordePath };
});

ipcMain.handle('load-session', (event, name) => {
  const p = path.join(getProjectsDir(), name, 'session.json');
  if (!fs.existsSync(p)) return { history: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { history: [] };
  }
});

ipcMain.handle('save-session', (event, name, data) => {
  try {
    fs.writeFileSync(path.join(getProjectsDir(), name, 'session.json'), JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
  const full = resolveSafe(root, filePath);
  if (!full || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('project-write-file', (event, name, filePath, content) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const full = resolveSafe(root, filePath);
  if (!full) return false;
  const normalized = full.replace(/\\/g, '/');
  if (normalized.includes('/.florde/memory/rules.md')) {
    throw new Error('rules.md is read-only — edit it directly in the file system or use the Management Panel');
  }
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('project-delete-file', (event, name, filePath) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const full = resolveSafe(root, filePath);
  if (!full) return false;
  if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('project-rename-file', (event, name, oldPath, newPath) => {
  const root = getProjectRoot(name);
  if (!root) return false;
  const from = resolveSafe(root, oldPath);
  const to = resolveSafe(root, newPath);
  if (!from || !to || !fs.existsSync(from)) return false;
  const dir = path.dirname(to);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(from, to);
  return true;
});

// ==================== SEARCH IN FILES ====================

ipcMain.handle('search-in-files', async (event, name, query) => {
  const root = getProjectRoot(name);
  if (!root || !fs.existsSync(root)) return [];
  const results = [];
  const lower = query.toLowerCase();
  async function walk(d) {
    const entries = await fs.promises.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        try {
          const content = await fs.promises.readFile(full, 'utf-8');
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
  await walk(root);
  return results;
});

// ==================== EXPORT ZIP ====================

ipcMain.handle('export-zip', async (event, name) => {
  const root = getProjectRoot(name);
  if (!root || !fs.existsSync(root)) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${name}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return false;
  if (/[;&|`$<>!~{}()\\]/.test(result.filePath)) return false;
  try {
    if (process.platform === 'win32') {
      const tmpScript = path.join(app.getPath('temp'), 'florde-zip-' + Date.now() + '.ps1');
      const psScript = `param([string]$src,[string]$dst)\nCompress-Archive -Path "$src\\*" -DestinationPath "$dst" -Force`;
      fs.writeFileSync(tmpScript, psScript, 'utf-8');
      execSync(`powershell -NoProfile -File "${tmpScript}" "${root}" "${result.filePath}"`, { timeout: 30000 });
      fs.rmSync(tmpScript, { force: true });
    } else if (process.platform === 'darwin') {
      execSync(`ditto -c -k --sequesterRsrc --keepParent "${result.filePath}" "${root}"`, { timeout: 30000 });
    } else {
      execSync(`cd "${root}" && zip -r "${result.filePath}" .`, { timeout: 30000 });
    }
    return true;
  } catch (e) {
    console.error('ZIP export failed:', e.message);
    return false;
  }
});

// ==================== FILE WATCHER ====================

const _watchers = new Map();

ipcMain.handle('watch-project', (event, projectName) => {
  const root = getProjectRoot(projectName);
  if (!root || !fs.existsSync(root)) return false;
  if (_watchers.has(projectName)) return true;
  try {
    const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (filename && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-changed', projectName, filename.replace(/\\/g, '/'));
      }
    });
    _watchers.set(projectName, watcher);
    return true;
  } catch (e) {
    console.error('Watch error:', e.message);
    return false;
  }
});

ipcMain.handle('unwatch-project', (event, projectName) => {
  const watcher = _watchers.get(projectName);
  if (watcher) {
    watcher.close();
    _watchers.delete(projectName);
  }
  return true;
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

ipcMain.handle('get-plugins', () => {
  try { return JSON.parse(fs.readFileSync(getPluginsPath(), 'utf-8')); }
  catch { return []; }
});

ipcMain.handle('save-plugins', (event, data) => {
  try {
    fs.writeFileSync(getPluginsPath(), JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('ollama-list', async () => {
  try {
    const out = execSync('ollama list', { timeout: 10000, encoding: 'utf-8' });
    const models = out.split('\n').slice(1).filter(Boolean).map(l => l.split(/\s+/)[0]).filter(Boolean);
    return models;
  } catch { return []; }
});

ipcMain.handle('ollama-pull', async (event, modelName) => {
  try {
    const r = spawnSync('ollama', ['pull', modelName], { timeout: 600000, encoding: 'utf-8' });
    if (r.error) throw r.error;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('ollama-delete', async (event, modelName) => {
  try {
    const r = spawnSync('ollama', ['rm', modelName], { timeout: 30000, encoding: 'utf-8' });
    if (r.error) throw r.error;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('ollama-show', async (event, modelName) => {
  try {
    const r = spawnSync('ollama', ['show', modelName], { timeout: 10000, encoding: 'utf-8' });
    if (r.error) throw r.error;
    const out = r.stdout;
    return { success: true, output: out };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('ollama-ps', async () => {
  try {
    const out = execSync('ollama ps', { timeout: 5000, encoding: 'utf-8' });
    const lines = out.trim().split('\n').slice(1).filter(Boolean);
    const models = lines.map(l => {
      const parts = l.split(/\s+/);
      return { name: parts[0] || '', pid: parts[1] || '', cpu: parts[2] || '', mem: parts[3] || '' };
    });
    return models;
  } catch { return []; }
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
    return results.slice(0, numResults);
  } catch (err) {
    return { error: err.message };
  }
});

// ==================== GIT ====================

ipcMain.handle('git-status', (event, repoPath) => {
  try {
    const out = execSync('git status --porcelain', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
    return out.trim();
  } catch { return ''; }
});

ipcMain.handle('git-diff', (event, repoPath) => {
  try {
    const out = execSync('git diff --stat', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
    return out.trim();
  } catch { return ''; }
});

ipcMain.handle('git-commit', (event, repoPath, name, description) => {
  try {
    execSync('git add -A', { cwd: repoPath, timeout: 10000, encoding: 'utf-8' });
    const msg = name + (description ? '\n\n' + description : '');
    const r = spawnSync('git', ['commit', '-m', msg], { cwd: repoPath, timeout: 10000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.stderr || e.message };
  }
});

function gitExec(repoPath, cmd, timeout = 15000) {
  try {
    const args = Array.isArray(cmd) ? cmd : cmd.split(/\s+/).filter(Boolean);
    const out = execFileSync('git', args, { cwd: repoPath, timeout, encoding: 'utf-8', shell: false }).trim();
    return { stdout: out, stderr: '', error: null };
  } catch (e) {
    return { stdout: '', stderr: e.stderr || '', error: e.stderr || e.message };
  }
}

function gitExecSafe(repoPath, args, timeout = 15000) {
  try {
    const r = spawnSync('git', args, { cwd: repoPath, timeout, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), error: null };
  } catch (e) {
    return { stdout: '', stderr: e.stderr || '', error: e.stderr || e.message };
  }
}

ipcMain.handle('git-branch-list', (event, repoPath) => {
  const local = gitExec(repoPath, 'git branch');
  if (local.error) return { local: [], remote: [], current: '' };
  const remote = gitExec(repoPath, 'git branch -r');
  const currentLine = local.stdout.split('\n').find(l => l.startsWith('*'));
  return {
    local: local.stdout.split('\n').map(l => l.replace('*', '').trim()).filter(Boolean),
    remote: remote.stdout.split('\n').map(l => l.trim()).filter(Boolean),
    current: currentLine ? currentLine.replace('*', '').trim() : ''
  };
});

ipcMain.handle('git-branch-create', (event, repoPath, name) => {
  try {
    const r = spawnSync('git', ['checkout', '-b', name], { cwd: repoPath, timeout: 10000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return { ok: true };
  } catch (e) { return { ok: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-branch-delete', (event, repoPath, name) => {
  try {
    const r = spawnSync('git', ['branch', '-d', name], { cwd: repoPath, timeout: 10000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return { ok: true };
  } catch (e) { return { ok: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-checkout', (event, repoPath, name) => {
  try {
    const r = spawnSync('git', ['checkout', name], { cwd: repoPath, timeout: 10000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    return { ok: true };
  } catch (e) { return { ok: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git:exec', (event, repoPath, args) => {
  try {
    const r = spawnSync('git', args, { cwd: repoPath, timeout: 15000, encoding: 'utf-8', shell: false });
    return { stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? r.error.message : null };
  } catch (e) {
    return { stdout: '', stderr: e.stderr || '', error: e.message };
  }
});

ipcMain.handle('git-log', (event, repoPath, limit = 50) => {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);
  const out = gitExec(repoPath, ['log', '--oneline', '--decorate', `-${n}`, '--pretty=format:%H|%h|%an|%ae|%ad|%s', '--date=short']);
  if (out.error) return [];
  return out.stdout.split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return { hash: parts[0] || '', shortHash: parts[1] || '', author: parts[2] || '', email: parts[3] || '', date: parts[4] || '', message: parts.slice(5).join('|') || '' };
  });
});

ipcMain.handle('git-blame', (event, repoPath, filePath) => {
  const out = gitExec(repoPath, ['blame', '--line-porcelain', filePath]);
  if (out.error) return [];
  const lines = [];
  const current = {};
  for (const line of out.stdout.split('\n')) {
    if (line.startsWith('\t')) { current.content = line.slice(1); lines.push({ ...current }); continue; }
    const parts = line.split(' ');
    if (parts[0] === 'author') current.author = parts.slice(1).join(' ');
    else if (parts[0] === 'author-mail') current.email = parts[1]?.replace(/[<>]/g, '') || '';
    else if (parts[0] === 'author-time') current.time = parts[1] || '';
    else if (parts[0].length === 40) current.commit = parts[0];
  }
  return lines;
});

ipcMain.handle('git-diff-file', (event, repoPath, filePath) => {
  const out = gitExec(repoPath, ['diff', 'HEAD', '--', filePath]);
  return out.stdout;
});

ipcMain.handle('git-push', (event, repoPath, remote = 'origin', branch) => {
  try {
    const b = branch || gitExec(repoPath, 'git rev-parse --abbrev-ref HEAD').stdout;
    const r = spawnSync('git', ['push', remote, b], { cwd: repoPath, timeout: 30000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.stderr || e.message }; }
});

ipcMain.handle('git-pull', (event, repoPath, remote = 'origin', branch) => {
  try {
    const b = branch || gitExec(repoPath, 'git rev-parse --abbrev-ref HEAD').stdout;
    const r = spawnSync('git', ['pull', remote, b], { cwd: repoPath, timeout: 30000, encoding: 'utf-8', shell: false });
    if (r.error) throw r.error;
    if (r.status !== 0) return { ok: false, error: r.stderr || r.stdout };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.stderr || e.message }; }
});

ipcMain.handle('open-external', async (event, url) => {
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
});

// ==================== DOCKER ====================

function dockerExec(args, timeout = 30000, cwd) {
  try {
    const opts = { timeout, encoding: 'utf-8' };
    if (cwd) opts.cwd = cwd;
    const r = require('child_process').spawnSync('docker', args, opts);
    if (r.error) throw r.error;
    return { ok: true, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
  } catch (e) {
    return { ok: false, error: e.stderr || e.message };
  }
}

ipcMain.handle('docker:info', () => {
  const r = dockerExec(['info', '--format', '{{.ServerVersion}}']);
  return r.ok ? { ok: true, version: r.stdout } : { ok: false, error: r.error };
});

ipcMain.handle('docker:ps', () => {
  const r = dockerExec(['ps', '-a', '--format', '{{.ID}}|{{.Image}}|{{.Names}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}']);
  if (!r.ok) return { ok: false, error: r.error };
  const containers = r.stdout.split('\n').filter(Boolean).map(line => {
    const [id, image, names, status, ports, createdAt] = line.split('|');
    const running = status && status.toLowerCase().startsWith('up');
    return { id: id ? id.substring(0, 12) : '', image: image || '', name: names || '', status: status || '', ports: ports || '', createdAt: createdAt || '', running };
  });
  return { ok: true, containers };
});

ipcMain.handle('docker:images', () => {
  const r = dockerExec(['images', '--format', '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedAt}}']);
  if (!r.ok) return { ok: false, error: r.error };
  const images = r.stdout.split('\n').filter(Boolean).map(line => {
    const [repository, tag, id, size, createdAt] = line.split('|');
    return { repository: repository || '', tag: tag || '', id: id ? id.substring(0, 12) : '', size: size || '', createdAt: createdAt || '' };
  });
  return { ok: true, images };
});

ipcMain.handle('docker:start', (event, id) => {
  const r = dockerExec(['start', id]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
});

ipcMain.handle('docker:stop', (event, id) => {
  const r = dockerExec(['stop', id]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
});

ipcMain.handle('docker:restart', (event, id) => {
  const r = dockerExec(['restart', id]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
});

ipcMain.handle('docker:logs', (event, id, lines = 50) => {
  const r = dockerExec(['logs', '--tail', String(lines), id]);
  return r.ok ? { ok: true, logs: r.stdout } : { ok: false, error: r.error };
});

ipcMain.handle('docker:compose-up', (event, filePath) => {
  const dir = path.dirname(filePath);
  return dockerExec(['compose', '-f', filePath, 'up', '-d'], 30000, dir);
});

ipcMain.handle('docker:compose-down', (event, filePath) => {
  const dir = path.dirname(filePath);
  return dockerExec(['compose', '-f', filePath, 'down'], 30000, dir);
});

ipcMain.handle('docker:compose-logs', (event, filePath) => {
  const dir = path.dirname(filePath);
  return dockerExec(['compose', '-f', filePath, 'logs', '--tail=100'], 30000, dir);
});

// ==================== MCP SERVER SPAWN ====================
const _mcpServerProcesses = new Map();

ipcMain.handle('mcp:start-server', (event, id, command, args, env) => {
  try {
    const proc = require('child_process').spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    _mcpServerProcesses.set(id, proc);
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    proc.on('exit', () => _mcpServerProcesses.delete(id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('mcp:stop-server', (event, id) => {
  const proc = _mcpServerProcesses.get(id);
  if (proc) {
    proc.kill();
    _mcpServerProcesses.delete(id);
    return { ok: true };
  }
  return { ok: false };
});

// ==================== TERMINAL ====================

let ptySpawn;
try { ptySpawn = require('node-pty').spawn; } catch { ptySpawn = null; }
let terminalProcesses = {};
let terminalIdCounter = 0;

ipcMain.handle('terminal:create', (event, { projectPath }) => {
  const id = ++terminalIdCounter;
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const pty = ptySpawn(shell, [], {
    name: 'xterm-color', cols: 80, rows: 24,
    cwd: projectPath || process.cwd(),
    env: process.env
  });
  pty.onData(data => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('terminal:data', { id, data });
    }
  });
  pty.onExit(() => {
    delete terminalProcesses[id];
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('terminal:exit', { id });
    }
  });
  terminalProcesses[id] = pty;
  return id;
});

ipcMain.handle('terminal:resize', (event, { id, cols, rows }) => {
  if (terminalProcesses[id]) terminalProcesses[id].resize(cols, rows);
});

ipcMain.handle('terminal:write', (event, { id, data }) => {
  if (terminalProcesses[id]) terminalProcesses[id].write(data);
});

ipcMain.handle('terminal:kill', (event, { id }) => {
  if (terminalProcesses[id]) {
    terminalProcesses[id].kill();
    delete terminalProcesses[id];
  }
});

// ==================== TRANSLATION CACHE ====================

function getTranslationCachePath() {
  return path.join(app.getPath('userData'), 'translations.json');
}

ipcMain.handle('translation:get-cache', () => {
  try {
    return JSON.parse(fs.readFileSync(getTranslationCachePath(), 'utf-8'));
  } catch { return {}; }
});

ipcMain.handle('translation:save-cache', (event, cache) => {
  try {
    fs.writeFileSync(getTranslationCachePath(), JSON.stringify(cache, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('translation:translate', async (event, text, sourceLang, targetLang) => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
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
    const parsed = JSON.parse(html);
    const translated = parsed[0].map(s => s[0]).join('');
    return { success: true, text: translated };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ==================== KEYCHAIN ====================

ipcMain.handle('keychain:store', (event, { key, value }) => {
  try {
    const { safeStorage } = require('electron');
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
});

ipcMain.handle('keychain:retrieve', (event, { key }) => {
  const { safeStorage } = require('electron');
  if (!safeStorage.isEncryptionAvailable()) return null;
  const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
  try {
    const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
    if (!keychain[key]) return null;
    const encrypted = Buffer.from(keychain[key], 'base64');
    return safeStorage.decryptString(encrypted);
  } catch (e) { return null; }
});

ipcMain.handle('keychain:delete', (event, { key }) => {
  const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
  try {
    const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
    delete keychain[key];
    fs.writeFileSync(keychainPath, JSON.stringify(keychain));
  } catch (e) {}
});

ipcMain.handle('keychain:list', () => {
  const keychainPath = path.join(app.getPath('userData'), 'keychain.json');
  try {
    const keychain = JSON.parse(fs.readFileSync(keychainPath, 'utf8'));
    return Object.keys(keychain);
  } catch (e) { return []; }
});

// ==================== BROWSER WINDOW ====================

let browserWindow = null;

function createBrowserWindow(url) {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.show();
    browserWindow.focus();
    if (url) browserWindow.loadURL(url);
    return;
  }
  browserWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Florde Browser',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowFileAccess: true,
      preload: path.join(__dirname, '../preload/browser-preload.js'),
    },
  });
  browserWindow.on('closed', () => {
    browserWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-closed');
    }
  });
  browserWindow.webContents.session.on('will-download', (event, item) => {
    const filePath = dialog.showSaveDialogSync(browserWindow, {
      defaultPath: item.getFilename(),
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    if (filePath) { item.setSavePath(filePath); } else { item.cancel(); }
  });
  if (url) browserWindow.loadURL(url);
}

ipcMain.handle('browser:open', (event, url) => {
  createBrowserWindow(url);
});
ipcMain.handle('browser:navigate', (event, url) => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.loadURL(url);
});
ipcMain.handle('browser:evaluate', async (event, js) => {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('No page loaded in browser. Use browser:open first.');
  try {
    return await Promise.race([
      browserWindow.webContents.executeJavaScript(js),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation timeout (15s)')), 15000))
    ]);
  } catch (err) {
    throw new Error('Browser JS error: ' + err.message);
  }
});
ipcMain.handle('browser:capture-page', async () => {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('Browser window not open');
  const img = await browserWindow.webContents.capturePage();
  return img.toDataURL();
});
ipcMain.handle('browser:go-back', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.goBack();
});
ipcMain.handle('browser:go-forward', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.goForward();
});
ipcMain.handle('browser:reload', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.reload();
});
ipcMain.handle('browser:close', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
});
ipcMain.handle('browser:is-open', () => {
  return browserWindow !== null && !browserWindow.isDestroyed();
});

// Browser nav bar IPC (from browser-preload.js)
ipcMain.on('browser-nav-back', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.goBack();
});
ipcMain.on('browser-nav-forward', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.goForward();
});
ipcMain.on('browser-nav-reload', () => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.reload();
});
ipcMain.on('browser-nav-url', (event, url) => {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.loadURL(url);
});
ipcMain.on('browser-nav-external', (event, url) => {
  if (url) shell.openExternal(url.startsWith('http') ? url : 'https://' + url);
});

// Sync URL to browser nav bar on navigation
app.on('web-contents-created', (event, wc) => {
  wc.on('did-navigate', (event, url) => {
    if (browserWindow && wc === browserWindow.webContents) {
      browserWindow.webContents.executeJavaScript(
        `document.getElementById('florde-browser-url').value = ${JSON.stringify(url)};`
      ).catch(() => {});
    }
  });
  wc.on('did-navigate-in-page', (event, url) => {
    if (browserWindow && wc === browserWindow.webContents) {
      browserWindow.webContents.executeJavaScript(
        `document.getElementById('florde-browser-url').value = ${JSON.stringify(url)};`
      ).catch(() => {});
    }
  });
});

// ==================== FLORDE STORAGE ====================

function getFlordeStore(projectName) {
  if (!projectName) return null;
  let store = _flordeStores.get(projectName);
  if (store) return store;
  const root = getProjectRoot(projectName);
  if (!root) return null;
  const flordeDir = path.join(root, '.florde');
  store = new FlordeStorage(path.join(flordeDir, 'database.db'));
  try {
    store.init();
    _flordeStores.set(projectName, store);
    return store;
  } catch (e) {
    console.error('Failed to init FlordeStorage:', e);
    return null;
  }
}

const MEMORY_FILES = ['rules.md', 'memory.md', 'goals.md', 'style.md', 'architecture.md', 'decisions.md'];

const MEMORY_DEFAULTS = {
  'rules.md': '# Project Rules\n\n*Add your development rules here. The AI will follow these instructions.*\n',
  'memory.md': '# AI Memory\n\n*Key context the AI should remember across sessions.*\n',
  'goals.md': '# Goals\n\n*Current project goals and objectives.*\n',
  'style.md': '# Style Preferences\n\n*Code style, naming conventions, UI preferences.*\n',
  'architecture.md': '# Architecture\n\n*Architecture decisions, design patterns, data flow.*\n',
  'decisions.md': '# Decision Log\n\n*Key decisions made during development.*\n'
};

function getFlordeDir(projectName) {
  if (!projectName) return null;
  const root = getProjectRoot(projectName);
  if (!root) return null;
  // For local projects, traverse up to find the real project root
  // (e.g. when the user pointed to addons/ or src/ instead of the root)
  // so .florde/ goes to the actual project root, not a subdirectory
  const meta = getProjectMeta(projectName);
  if (meta && meta.type === 'local') {
    const projRoot = findProjectRoot(root);
    if (projRoot) return path.join(projRoot, '.florde');
  }
  return path.join(root, '.florde');
}

const PROJECT_MARKERS = ['.git', '.hg', 'project.godot', 'package.json', 'CMakeLists.txt', '.sln', 'pom.xml', 'build.gradle'];

function findProjectRoot(startPath) {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  while (current && current !== root) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function initFlordeDir(projectName) {
  if (!projectName) return null;
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return null;
  if (!fs.existsSync(flordeDir)) fs.mkdirSync(flordeDir, { recursive: true });
  const memDir = path.join(flordeDir, 'memory');
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  const tempDir = path.join(flordeDir, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const gitkeep = path.join(tempDir, '.gitkeep');
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
  MEMORY_FILES.forEach(f => {
    const fp = path.join(memDir, f);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, MEMORY_DEFAULTS[f] || '', 'utf-8');
    }
  });
  const giPath = path.join(flordeDir, '.gitignore');
  if (!fs.existsSync(giPath)) {
    fs.writeFileSync(giPath, '# .florde gitignore — manage exclusions in Management Panel\n*\n');
  }
  return flordeDir;
}

function getGitignoreState(projectName) {
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return [];
  const giPath = path.join(flordeDir, '.gitignore');
  if (!fs.existsSync(giPath)) return [];
  const content = fs.readFileSync(giPath, 'utf-8');
  const excluded = [];
  content.split('\n').forEach(line => {
    const m = line.match(/^!(.+)$/);
    if (m) excluded.push(m[1]);
  });
  return excluded;
}

function setGitignoreEntry(projectName, entry, exclude) {
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return;
  const giPath = path.join(flordeDir, '.gitignore');
  let lines = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf-8').split('\n') : ['*\n'];
  const pattern = '!' + entry;
  if (exclude) {
    if (!lines.some(l => l.trim() === pattern)) lines.push(pattern);
  } else {
    lines = lines.filter(l => l.trim() !== pattern);
  }
  fs.writeFileSync(giPath, lines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf-8');
}

ipcMain.handle('florde:ensure-dir', (event, projectName) => {
  return initFlordeDir(projectName) !== null;
});

ipcMain.handle('florde:check-dir', (event, projectName) => {
  const dir = getFlordeDir(projectName);
  return dir ? fs.existsSync(dir) : false;
});

ipcMain.handle('florde:remove-dir', (event, projectName) => {
  const dir = getFlordeDir(projectName);
  if (!dir || !fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true });
  return true;
});

ipcMain.handle('florde:get-gitignore-state', (event, projectName) => {
  return getGitignoreState(projectName);
});

ipcMain.handle('florde:set-gitignore-entry', (event, projectName, entry, exclude) => {
  setGitignoreEntry(projectName, entry, exclude);
});

ipcMain.handle('florde:init-db', (event, projectName) => {
  const store = getFlordeStore(projectName);
  return store !== null;
});

ipcMain.handle('florde:get', (event, projectName, namespace, key) => {
  const store = getFlordeStore(projectName);
  if (!store) return null;
  return store.get(namespace, key);
});

ipcMain.handle('florde:set', (event, projectName, namespace, key, value) => {
  const store = getFlordeStore(projectName);
  if (!store) return false;
  store.set(namespace, key, value);
  return true;
});

ipcMain.handle('florde:delete', (event, projectName, namespace, key) => {
  const store = getFlordeStore(projectName);
  if (!store) return false;
  store.delete(namespace, key);
  return true;
});

ipcMain.handle('florde:get-all', (event, projectName, namespace) => {
  const store = getFlordeStore(projectName);
  if (!store) return [];
  return store.getAll(namespace);
});

ipcMain.handle('florde:query', (event, projectName, sql, params) => {
  const store = getFlordeStore(projectName);
  if (!store) return [];
  return store.query(sql, params || []);
});

ipcMain.handle('florde:run', (event, projectName, sql, params) => {
  const store = getFlordeStore(projectName);
  if (!store) return null;
  return store.run(sql, params || []);
});

ipcMain.handle('florde:close', (event, projectName) => {
  const store = _flordeStores.get(projectName);
  if (store) {
    store.close();
    _flordeStores.delete(projectName);
  }
});

ipcMain.handle('florde:get-db-path', (event, projectName) => {
  const root = getProjectRoot(projectName);
  if (!root) return null;
  return path.join(root, '.florde', 'database.db');
});

ipcMain.handle('florde:get-dir-path', (event, projectName) => {
  const dir = getFlordeDir(projectName);
  return dir;
});

// ==================== FLORDE MEMORY / TEMP FILES ====================

function flordeFilePath(projectName, subdir, fileName) {
  if (!projectName || !fileName) return null;
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return null;
  const full = path.resolve(path.join(flordeDir, subdir, fileName));
  if (!full.startsWith(path.resolve(path.join(flordeDir, subdir)))) return null;
  return full;
}

ipcMain.handle('florde:memory-read', (event, projectName, fileName) => {
  const full = flordeFilePath(projectName, 'memory', fileName);
  if (!full || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('florde:memory-write', (event, projectName, fileName, content) => {
  if (fileName === 'rules.md') throw new Error('rules.md is read-only');
  const full = flordeFilePath(projectName, 'memory', fileName);
  if (!full) return false;
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('florde:memory-list', (event, projectName) => {
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return [];
  const memDir = path.join(flordeDir, 'memory');
  if (!fs.existsSync(memDir)) return [];
  return fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
});

ipcMain.handle('florde:temp-read', (event, projectName, fileName) => {
  const full = flordeFilePath(projectName, 'temp', fileName);
  if (!full || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('florde:temp-write', (event, projectName, fileName, content) => {
  const full = flordeFilePath(projectName, 'temp', fileName);
  if (!full) return false;
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('florde:temp-list', (event, projectName) => {
  const flordeDir = getFlordeDir(projectName);
  if (!flordeDir) return [];
  const tempDir = path.join(flordeDir, 'temp');
  if (!fs.existsSync(tempDir)) return [];
  return fs.readdirSync(tempDir).filter(f => f !== '.gitkeep').sort().map(f => {
    const stat = fs.statSync(path.join(tempDir, f));
    return { name: f, size: stat.size, mtime: stat.mtimeMs };
  });
});

ipcMain.handle('florde:temp-delete', (event, projectName, fileName) => {
  const full = flordeFilePath(projectName, 'temp', fileName);
  if (!full || !fs.existsSync(full)) return false;
  fs.rmSync(full);
  return true;
});

// ==================== APP ====================

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
