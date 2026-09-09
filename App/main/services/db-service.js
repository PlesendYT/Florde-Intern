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
    // Security (b-24): single source of truth for the .florde dir.
    // _getStore previously used root/.florde directly while _flordeDirFor
    // resolves via project markers — two different database.db paths.
    const flordeDir = this._flordeDirFor(projectName);
    if (!flordeDir) return null;
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

  // Security (b-06): raw SQL over IPC is restricted to a fixed statement
  // shape over tables the renderer legitimately uses raw SQL for
  // (todos/notes/decisions/time_sessions/audit_log/layout_states).
  // permissions/kv_store must NEVER be touched raw (gate bypass otherwise).
  static _SQL_TABLES = new Set([
    'todos', 'notes', 'decisions',
    'time_sessions', 'audit_log', 'layout_states',
  ]);

  static _checkSql(sql, kind) {
    if (typeof sql !== 'string' || sql.length === 0 || sql.length > 5000) return 'invalid sql';
    if (/[\0]/.test(sql)) return 'invalid sql';
    const t = sql.trim();
    if (/;/.test(t.slice(0, -1)) || /;\s*$/.test(t)) {
      // Forbid stacked statements entirely (trailing semicolon included).
      return 'stacked statements not allowed';
    }
    const up = t.toUpperCase();
    if (kind === 'query') {
      if (!/^SELECT\b/.test(up)) return 'only SELECT allowed';
    } else {
      if (!/^(INSERT|UPDATE|DELETE)\b/.test(up)) return 'only INSERT/UPDATE/DELETE allowed';
    }
    if (/\b(PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|CREATE|DROP|ALTER|TRUNCATE|GRANT|REPLACE\s+INTO\s+sqlite_)\b/.test(up)) {
      return 'statement not allowed';
    }
    // Every referenced table must be a known app table.
    const tables = new Set();
    for (const m of t.matchAll(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      tables.add(m[1].toLowerCase());
    }
    for (const m of t.matchAll(/\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      tables.add(m[1].toLowerCase());
    }
    if (tables.size === 0) return 'no table referenced';
    for (const tb of tables) {
      if (!DbService._SQL_TABLES.has(tb)) return 'unknown table: ' + tb;
    }
    return null;
  }

  static _checkParams(params) {
    if (params === undefined) return [];
    if (!Array.isArray(params) || params.length > 100) return null;
    for (const p of params) {
      if (p !== null && typeof p !== 'string' && typeof p !== 'number' && typeof p !== 'boolean') {
        return null;
      }
      if (typeof p === 'string' && p.length > 100000) return null;
    }
    return params;
  }

  query(projectName, sql, params) {
    const err = DbService._checkSql(sql, 'query');
    if (err) throw new Error('query rejected: ' + err);
    const clean = DbService._checkParams(params);
    if (clean === null) throw new Error('query rejected: invalid params');
    const store = this._getStore(projectName);
    if (!store) return [];
    return store.query(sql, clean);
  }

  run(projectName, sql, params) {
    const err = DbService._checkSql(sql, 'run');
    if (err) throw new Error('run rejected: ' + err);
    const clean = DbService._checkParams(params);
    if (clean === null) throw new Error('run rejected: invalid params');
    const store = this._getStore(projectName);
    if (!store) return null;
    return store.run(sql, clean);
  }

  // Security (b-25): every statement validated like run(), then executed
  // atomically in a single transaction.
  transaction(projectName, statements) {
    if (!Array.isArray(statements) || statements.length === 0 || statements.length > 50) {
      throw new Error('transaction rejected: invalid statements');
    }
    const clean = statements.map((s) => {
      if (!s || typeof s !== 'object') throw new Error('transaction rejected: invalid statement');
      const err = DbService._checkSql(s.sql, 'run');
      if (err) throw new Error('transaction rejected: ' + err);
      const params = DbService._checkParams(s.params);
      if (params === null) throw new Error('transaction rejected: invalid params');
      return { sql: s.sql, params };
    });
    const store = this._getStore(projectName);
    if (!store) return null;
    return store.transaction(clean);
  }

  close(projectName) {
    const store = this._stores.get(projectName);
    if (store) {
      store.close();
      this._stores.delete(projectName);
    }
  }

  getDbPath(projectName) {
    // Security (b-24): same single source of truth as _getStore.
    const flordeDir = this._flordeDirFor(projectName);
    if (!flordeDir) return null;
    return path.join(flordeDir, 'database.db');
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