const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { dialog, app } = require('electron');
const shared = require('./shared');
const { getProjectRoot, getProjectMeta, getProjectsDir, isSafeProjectName } = shared;

class FileService {
  constructor(options = {}) {
    this._getMainWindow = options.getMainWindow || (() => null);
    this._watchers = new Map();
  }

  listProjects() {
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
  }

  createSandboxProject(name) {
    if (!isSafeProjectName(name)) return false;
    const dir = path.join(getProjectsDir(), name);
    if (fs.existsSync(dir)) return false;
    fs.mkdirSync(dir, { recursive: true });
    const meta = { name, type: 'sandbox', createdAt: Date.now() };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
    return true;
  }

  createLocalProject(name, folderPath) {
    if (!isSafeProjectName(name)) return { ok: false, error: 'invalid name' };
    const dir = path.join(getProjectsDir(), name);
    if (fs.existsSync(dir)) return { ok: false, error: 'exists' };
    if (!fs.existsSync(folderPath)) return { ok: false, error: 'path not found' };
    fs.mkdirSync(dir, { recursive: true });
    const meta = { name, type: 'local', path: folderPath, createdAt: Date.now() };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ history: [] }, null, 2));
    return { ok: true };
  }

  deleteProject(name) {
    if (!isSafeProjectName(name)) return { ok: false, error: 'invalid name' };
    const dir = path.join(getProjectsDir(), name);
    if (!fs.existsSync(dir)) return { ok: false, error: 'not found' };
    const meta = getProjectMeta(name);
    let flordePath = null;
    if (meta && meta.type === 'local') {
      const fd = shared.getFlordeDir ? shared.getFlordeDir(name) : null;
      if (fd && fs.existsSync(fd)) flordePath = fd;
    }
    fs.rmSync(dir, { recursive: true });
    return { ok: true, flordePath };
  }

  loadSession(name) {
    const p = path.join(getProjectsDir(), name, 'session.json');
    if (!fs.existsSync(p)) return { history: [] };
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      return { history: [] };
    }
  }

  saveSession(name, data) {
    try {
      fs.writeFileSync(path.join(getProjectsDir(), name, 'session.json'), JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  getProjectRoot(name) {
    return getProjectRoot(name);
  }

  listProjectFiles(name) {
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
  }

  readProjectFile(name, filePath) {
    const root = getProjectRoot(name);
    if (!root) return null;
    const full = shared.resolveSafe(root, filePath);
    if (!full || !fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  writeProjectFile(name, filePath, content) {
    const root = getProjectRoot(name);
    if (!root) return false;
    const full = shared.resolveSafe(root, filePath);
    if (!full) return false;
    const normalized = full.replace(/\\/g, '/');
    if (normalized.includes('/.florde/memory/rules.md')) {
      throw new Error('rules.md is read-only — edit it directly in the file system or use the Management Panel');
    }
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return true;
  }

  deleteProjectFile(name, filePath) {
    const root = getProjectRoot(name);
    if (!root) return false;
    const full = shared.resolveSafe(root, filePath);
    if (!full) return false;
    if (fs.existsSync(full)) { fs.rmSync(full, { recursive: true }); return true; }
    return false;
  }

  renameProjectFile(name, oldPath, newPath) {
    const root = getProjectRoot(name);
    if (!root) return false;
    const from = shared.resolveSafe(root, oldPath);
    const to = shared.resolveSafe(root, newPath);
    if (!from || !to || !fs.existsSync(from)) return false;
    const dir = path.dirname(to);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(from, to);
    return true;
  }

  async searchInFiles(name, query) {
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
  }

  async exportZip(name) {
    const root = getProjectRoot(name);
    if (!root || !fs.existsSync(root)) return false;
    const win = this._getMainWindow();
    const result = await dialog.showSaveDialog(win, {
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
  }

  watchProject(projectName) {
    const root = getProjectRoot(projectName);
    if (!root || !fs.existsSync(root)) return false;
    if (this._watchers.has(projectName)) return true;
    try {
      const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (filename) {
          const win = this._getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('file-changed', projectName, filename.replace(/\\/g, '/'));
          }
        }
      });
      this._watchers.set(projectName, watcher);
      return true;
    } catch (e) {
      console.error('Watch error:', e.message);
      return false;
    }
  }

  unwatchProject(projectName) {
    const watcher = this._watchers.get(projectName);
    if (watcher) {
      watcher.close();
      this._watchers.delete(projectName);
    }
    return true;
  }
}

module.exports = { FileService };