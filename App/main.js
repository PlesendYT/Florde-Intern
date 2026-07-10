const { app, BrowserWindow, ipcMain, dialog, net, Menu, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

let mainWindow;
let _settingsPath, _projectsDir, _sandboxDir, _pluginsPath;
function getSettingsPath() { if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json'); return _settingsPath; }
function getProjectsDir() { if (!_projectsDir) _projectsDir = path.join(app.getPath('userData'), 'projects'); return _projectsDir; }
function getSandboxDir() { if (!_sandboxDir) _sandboxDir = path.join(app.getPath('userData'), 'sandbox'); return _sandboxDir; }
function getPluginsPath() { if (!_pluginsPath) _pluginsPath = path.join(app.getPath('userData'), 'plugins.json'); return _pluginsPath; }

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      webviewTag: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  if (!fs.existsSync(getProjectsDir())) fs.mkdirSync(getProjectsDir(), { recursive: true });
  if (!fs.existsSync(getSandboxDir())) fs.mkdirSync(getSandboxDir(), { recursive: true });
  createWindow();
});

// ==================== NOTIFICATIONS ====================

ipcMain.handle('show-notification', (event, title, body) => {
  const n = new Notification({ title, body, icon: path.join(__dirname, '..', 'config', 'icon', 'icon.png') });
  n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  n.show();
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

function getProjectRoot(name) {
  if (!name) return null;
  const metaPath = path.join(getProjectsDir(), name, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  if (meta.type === 'local') return meta.path;
  return path.join(getProjectsDir(), name);
}

function getProjectMeta(name) {
  const p = path.join(getProjectsDir(), name, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

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
  const dir = path.join(getProjectsDir(), name);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, type: 'sandbox', createdAt: Date.now() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
  return true;
});

ipcMain.handle('create-local-project', async (event, name, folderPath) => {
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
  const dir = path.join(getProjectsDir(), name);
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('load-session', (event, name) => {
  const p = path.join(getProjectsDir(), name, 'session.json');
  if (!fs.existsSync(p)) return { history: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { sessions: [] };
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

function resolveSafe(root, filePath) {
  const resolved = path.resolve(root, filePath);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

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
  const meta = getProjectMeta(name);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${name}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    const tmpScript = path.join(app.getPath('temp'), 'florde-zip-' + Date.now() + '.ps1');
    const psScript = `param([string]$$src,[string]$$dst)\nCompress-Archive -Path "$$src\\*" -DestinationPath "$$dst" -Force`;
    fs.writeFileSync(tmpScript, psScript, 'utf-8');
    execSync(`powershell -NoProfile -File "${tmpScript}" "${root}" "${result.filePath}"`, { timeout: 30000 });
    fs.rmSync(tmpScript, { force: true });
    return true;
  } catch (e) {
    console.error('ZIP export failed:', e.message);
    return false;
  }
});

// ==================== SANDBOX ====================

ipcMain.handle('get-sandbox-dir', () => getSandboxDir());

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
  const full = resolveSafe(sandboxPath, filePath);
  if (!full || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
});

ipcMain.handle('sandbox-write-file', (event, sandboxPath, filePath, content) => {
  const full = resolveSafe(sandboxPath, filePath);
  if (!full) return false;
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return true;
});

ipcMain.handle('sandbox-delete-file', (event, sandboxPath, filePath) => {
  const full = resolveSafe(sandboxPath, filePath);
  if (!full) return false;
  if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
  return false;
});

ipcMain.handle('sandbox-exec', (event, sandboxPath, command) => {
  const allowed = getSandboxDir();
  if (!sandboxPath || path.resolve(sandboxPath) !== path.resolve(allowed)) return { ok: false, output: 'Access denied: invalid sandbox path', code: -1 };
  if (/[;&|`$\n]/.test(command)) return { ok: false, output: 'Rejected: command contains unsafe characters', code: -1 };
  try {
    const output = execSync(command, { cwd: allowed, timeout: 30000, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: e.stderr || e.message, code: e.status };
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

// ==================== SANDBOX FILE DOWNLOAD ====================

ipcMain.handle('download-sandbox-file', async (event, sourcePath) => {
  const sandbox = getSandboxDir();
  const full = resolveSafe(sandbox, sourcePath);
  if (!full || !fs.existsSync(full)) return { ok: false, error: 'File not found' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(sourcePath),
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };
  try {
    fs.copyFileSync(full, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
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
    const out = execSync(cmd, { cwd: repoPath, timeout, encoding: 'utf-8' }).trim();
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

ipcMain.handle('git-log', (event, repoPath, limit = 50) => {
  const out = gitExec(repoPath, `git log --oneline --decorate -${limit} --pretty=format:"%H|%h|%an|%ae|%ad|%s" --date=short`);
  if (out.error) return [];
  return out.stdout.split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return { hash: parts[0] || '', shortHash: parts[1] || '', author: parts[2] || '', email: parts[3] || '', date: parts[4] || '', message: parts.slice(5).join('|') || '' };
  });
});

ipcMain.handle('git-blame', (event, repoPath, filePath) => {
  const out = gitExec(repoPath, `git blame --line-porcelain "${filePath}"`);
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
  const out = gitExec(repoPath, `git diff HEAD -- "${filePath}"`);
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
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ==================== DOCKER ====================

function dockerExec(args, timeout = 30000) {
  try {
    const r = require('child_process').spawnSync('docker', args, { timeout, encoding: 'utf-8' });
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

// ==================== TERMINAL ====================

const { spawn } = require('node-pty');
let terminalProcesses = {};
let terminalIdCounter = 0;

ipcMain.handle('terminal:create', (event, { projectPath }) => {
  const id = ++terminalIdCounter;
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const pty = spawn(shell, [], {
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
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
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
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('Browser window not open. Use browser_open first.');
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

// ==================== APP ====================

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
