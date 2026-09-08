const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let _settingsPath, _projectsDir, _sandboxDir, _pluginsPath;

function getSettingsPath() {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return _settingsPath;
}

function getProjectsDir() {
  if (!_projectsDir) _projectsDir = path.join(app.getPath('userData'), 'projects');
  return _projectsDir;
}

function isSafeProjectName(name) {
  // Security (b-01): '..' and '.' passed the old check (only '/' was tested),
  // allowing deletion of the whole projects dir. Reject them plus NUL/control
  // chars and names that could escape path.join.
  if (typeof name !== 'string' || name.length === 0 || name.length > 100) return false;
  if (/[\/\\\0-\x1f\x7f]/.test(name)) return false;
  if (name === '.' || name === '..') return false;
  if (name !== name.trim()) return false;
  return true;
}

function getSandboxDir() {
  if (!_sandboxDir) _sandboxDir = path.join(app.getPath('userData'), 'sandbox');
  return _sandboxDir;
}

function getSandboxImagesDir() {
  return path.join(getSandboxDir(), 'images');
}

function getPluginsPath() {
  if (!_pluginsPath) _pluginsPath = path.join(app.getPath('userData'), 'plugins.json');
  return _pluginsPath;
}

function getProjectRoot(name) {
  if (!isSafeProjectName(name)) return null;
  const metaPath = path.join(getProjectsDir(), name, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.type === 'local') return meta.path;
    return path.join(getProjectsDir(), name);
  } catch { return null; }
}

function getProjectMeta(name) {
  if (!isSafeProjectName(name)) return null;
  const p = path.join(getProjectsDir(), name, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function resolveSafe(root, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) return null;
  if (/[\0]/.test(filePath)) return null;
  const canonRoot = path.resolve(root);
  const resolved = path.resolve(canonRoot, filePath);
  if (resolved === canonRoot) return resolved;
  if (!resolved.startsWith(canonRoot + path.sep)) return null;
  return resolved;
}

function getFlordeDir(name) {
  if (!isSafeProjectName(name)) return null;
  const root = getProjectRoot(name);
  if (!root) return null;
  const meta = getProjectMeta(name);
  if (meta && meta.type === 'local') {
    let current = path.resolve(root);
    const stop = path.parse(current).root;
    const markers = ['.git', '.hg', 'project.godot', 'package.json', 'CMakeLists.txt', '.sln', 'pom.xml', 'build.gradle'];
    while (current && current !== stop) {
      for (const marker of markers) {
        if (fs.existsSync(path.join(current, marker))) return path.join(current, '.florde');
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return path.join(root, '.florde');
}

// Security (b-02): block mounting sensitive host locations as local projects.
// Returns {ok:true, root} with the canonical path, or {ok:false, error}.
function assertSafeMountRoot(folderPath) {
  if (typeof folderPath !== 'string' || folderPath.length === 0 || folderPath.length > 1000) {
    return { ok: false, error: 'invalid path' };
  }
  if (/[\0]/.test(folderPath)) return { ok: false, error: 'invalid path' };
  let canon;
  try {
    canon = fs.realpathSync(path.resolve(folderPath));
  } catch {
    return { ok: false, error: 'path not found' };
  }
  let stat;
  try {
    stat = fs.statSync(canon);
  } catch {
    return { ok: false, error: 'path not found' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'not a directory' };
  const lower = canon.toLowerCase();
  if (process.platform === 'win32') {
    const drive = path.parse(canon).root.toLowerCase();
    if (lower === drive) return { ok: false, error: 'drive root not allowed' };
    const blocked = [
      (process.env.SystemRoot || 'C:\\Windows').toLowerCase(),
      path.join(drive, 'Program Files').toLowerCase(),
      path.join(drive, 'Program Files (x86)').toLowerCase(),
      path.join(drive, 'ProgramData').toLowerCase(),
    ];
    for (const b of blocked) {
      if (lower === b || lower.startsWith(b + '\\')) {
        return { ok: false, error: 'system directory not allowed' };
      }
    }
  } else {
    if (canon === '/') return { ok: false, error: 'filesystem root not allowed' };
    const first = canon.split('/').filter(Boolean)[0] || '';
    if (['etc', 'proc', 'sys', 'dev', 'boot', 'root', 'run', 'var'].includes(first)) {
      // Allow project-like subdirs (e.g. /var/www/app) but never the top itself
      // or ultra-sensitive trees (ssh keys, shadow, kernel interfaces).
      if (canon.split('/').filter(Boolean).length <= 2 || ['etc', 'proc', 'sys', 'dev', 'root'].includes(first)) {
        return { ok: false, error: 'system directory not allowed' };
      }
    }
    const home = (process.env.HOME || '').toLowerCase();
    if (home && lower === home) return { ok: false, error: 'home root not allowed (pick a subfolder)' };
  }
  return { ok: true, root: canon };
}

module.exports = {
  getSettingsPath,
  getProjectsDir,
  getSandboxDir,
  getSandboxImagesDir,
  getPluginsPath,
  isSafeProjectName,
  getProjectRoot,
  getProjectMeta,
  resolveSafe,
  getFlordeDir,
  assertSafeMountRoot,
};