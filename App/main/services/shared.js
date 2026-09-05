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
  return typeof name === 'string' && name.length > 0 && name.length <= 100 && !/[\/\\]/.test(name);
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
  const resolved = path.resolve(root, filePath);
  if (!resolved.startsWith(path.resolve(root))) return null;
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
};