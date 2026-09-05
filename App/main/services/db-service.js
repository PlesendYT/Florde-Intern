const fs = require('fs');
const path = require('path');
const FlordeStorage = require('../../storage');
const shared = require('./shared');
const { getProjectRoot, getProjectMeta, isSafeProjectName, getFlordeDir } = shared;

const MEMORY_FILES = ['rules.md', 'memory.md', 'goals.md', 'style.md', 'architecture.md', 'decisions.md'];

const MEMORY_DEFAULTS = {
  'rules.md': '# Project Rules\n\n*Add your development rules here. The AI will follow these instructions.*\n',
  'memory.md': '# AI Memory\n\n*Key context the AI should remember across sessions.*\n',
  'goals.md': '# Goals\n\n*Current project goals and objectives.*\n',
  'style.md': '# Style Preferences\n\n*Code style, naming conventions, UI preferences.*\n',
  'architecture.md': '# Architecture\n\n*Architecture decisions, design patterns, data flow.*\n',
  'decisions.md': '# Decision Log\n\n*Key decisions made during development.*\n'
};

const PROJECT_MARKERS = ['.git', '.hg', 'project.godot', 'package.json', 'CMakeLists.txt', '.sln', 'pom.xml', 'build.gradle'];

class DbService {
  constructor() {
    this._stores = new Map();
  }

  _getStore(projectName) {
    if (!projectName) return null;
    let store = this._stores.get(projectName);
    if (store) return store;
    const root = getProjectRoot(projectName);
    if (!root) return null;
    const flordeDir = path.join(root, '.florde');
    store = new FlordeStorage(path.join(flordeDir, 'database.db'));
    try {
      store.init();
      this._stores.set(projectName, store);
      return store;
    } catch (e) {
      console.error('Failed to init FlordeStorage:', e);
      return null;
    }
  }

  _findProjectRoot(startPath) {
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

  _flordeDirFor(projectName) {
    const base = getFlordeDir(projectName);
    if (!base) return null;
    const root = getProjectRoot(projectName);
    if (!root) return null;
    const meta = getProjectMeta(projectName);
    if (meta && meta.type === 'local') {
      const projRoot = this._findProjectRoot(root);
      if (projRoot) return path.join(projRoot, '.florde');
    }
    return path.join(root, '.florde');
  }

  _initFlordeDir(projectName) {
    if (!projectName) return null;
    const flordeDir = this._flordeDirFor(projectName);
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

  _gitignoreState(projectName) {
    const flordeDir = this._flordeDirFor(projectName);
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

  _setGitignoreEntry(projectName, entry, exclude) {
    const flordeDir = this._flordeDirFor(projectName);
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

  _flordeFilePath(projectName, subdir, fileName) {
    if (!projectName || !fileName) return null;
    const flordeDir = this._flordeDirFor(projectName);
    if (!flordeDir) return null;
    const full = path.resolve(path.join(flordeDir, subdir, fileName));
    if (!full.startsWith(path.resolve(path.join(flordeDir, subdir)))) return null;
    return full;
  }

  ensureDir(projectName) {
    return this._initFlordeDir(projectName) !== null;
  }

  checkDir(projectName) {
    const dir = this._flordeDirFor(projectName);
    return dir ? fs.existsSync(dir) : false;
  }

  removeDir(projectName) {
    const dir = this._flordeDirFor(projectName);
    if (!dir || !fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true });
    return true;
  }

  getGitignoreState(projectName) {
    return this._gitignoreState(projectName);
  }

  setGitignoreEntry(projectName, entry, exclude) {
    this._setGitignoreEntry(projectName, entry, exclude);
  }

  initDb(projectName) {
    return this._getStore(projectName) !== null;
  }

  get(projectName, namespace, key) {
    const store = this._getStore(projectName);
    if (!store) return null;
    return store.get(namespace, key);
  }

  set(projectName, namespace, key, value) {
    const store = this._getStore(projectName);
    if (!store) return false;
    store.set(namespace, key, value);
    return true;
  }

  delete(projectName, namespace, key) {
    const store = this._getStore(projectName);
    if (!store) return false;
    store.delete(namespace, key);
    return true;
  }

  getAll(projectName, namespace) {
    const store = this._getStore(projectName);
    if (!store) return [];
    return store.getAll(namespace);
  }

  query(projectName, sql, params) {
    const store = this._getStore(projectName);
    if (!store) return [];
    return store.query(sql, params || []);
  }

  run(projectName, sql, params) {
    const store = this._getStore(projectName);
    if (!store) return null;
    return store.run(sql, params || []);
  }

  close(projectName) {
    const store = this._stores.get(projectName);
    if (store) {
      store.close();
      this._stores.delete(projectName);
    }
  }

  getDbPath(projectName) {
    const root = getProjectRoot(projectName);
    if (!root) return null;
    return path.join(root, '.florde', 'database.db');
  }

  getDirPath(projectName) {
    return this._flordeDirFor(projectName);
  }

  memoryRead(projectName, fileName) {
    const full = this._flordeFilePath(projectName, 'memory', fileName);
    if (!full || !fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  memoryWrite(projectName, fileName, content) {
    if (fileName === 'rules.md') throw new Error('rules.md is read-only');
    const full = this._flordeFilePath(projectName, 'memory', fileName);
    if (!full) return false;
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return true;
  }

  memoryList(projectName) {
    const flordeDir = this._flordeDirFor(projectName);
    if (!flordeDir) return [];
    const memDir = path.join(flordeDir, 'memory');
    if (!fs.existsSync(memDir)) return [];
    return fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
  }

  tempRead(projectName, fileName) {
    const full = this._flordeFilePath(projectName, 'temp', fileName);
    if (!full || !fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  tempWrite(projectName, fileName, content) {
    const full = this._flordeFilePath(projectName, 'temp', fileName);
    if (!full) return false;
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return true;
  }

  tempList(projectName) {
    const flordeDir = this._flordeDirFor(projectName);
    if (!flordeDir) return [];
    const tempDir = path.join(flordeDir, 'temp');
    if (!fs.existsSync(tempDir)) return [];
    return fs.readdirSync(tempDir).filter(f => f !== '.gitkeep').sort().map(f => {
      const stat = fs.statSync(path.join(tempDir, f));
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    });
  }

  tempDelete(projectName, fileName) {
    const full = this._flordeFilePath(projectName, 'temp', fileName);
    if (!full || !fs.existsSync(full)) return false;
    fs.rmSync(full);
    return true;
  }
}

module.exports = { DbService };