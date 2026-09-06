// Zugriff auf die SQLite-permissions-Tabelle (Main-Prozess).
// Tabelle existiert bereits in App/storage.js; hier wird dasselbe Schema
// idempotent angelegt und eine globale Spalte ergänzt.
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const GLOBAL_PROJECT = '__global__';
const VALID_LEVELS = new Set(['allow', 'ask', 'block']);

function projectKey(project) {
  if (!project || project === GLOBAL_PROJECT) return GLOBAL_PROJECT;
  return project;
}

class PermissionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        action TEXT NOT NULL,
        path TEXT,
        allowed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Migration: globale Spalte hinzufügen, falls nicht vorhanden
    const cols = this.db.prepare(`PRAGMA table_info(permissions)`).all().map(c => c.name);
    if (!cols.includes('global')) {
      this.db.exec(`ALTER TABLE permissions ADD COLUMN global INTEGER NOT NULL DEFAULT 0`);
    }
    return this;
  }

  getAll(project) {
    return this.db.prepare(
      'SELECT * FROM permissions WHERE project = ? ORDER BY id'
    ).all(projectKey(project));
  }

  getAllGlobal() {
    return this.db.prepare(
      'SELECT * FROM permissions WHERE project = ? ORDER BY id'
    ).all(GLOBAL_PROJECT);
  }

  set(project, tool_type, action, opts = {}) {
    if (!tool_type || typeof tool_type !== 'string') throw new Error('tool_type required');
    if (!VALID_LEVELS.has(action)) throw new Error('invalid level: ' + action);
    const p = opts.global ? GLOBAL_PROJECT : projectKey(project);
    const allowed = action === 'allow' ? 1 : 0;
    const marker = opts.path || '';
    const existing = this.db.prepare(
      'SELECT id FROM permissions WHERE project = ? AND tool_type = ? AND path = ?'
    ).get(p, tool_type, marker);
    if (existing) {
      this.db.prepare(
        'UPDATE permissions SET allowed = ? WHERE id = ?'
      ).run(action === 'allow' ? 1 : 0, existing.id);
      return { id: existing.id, project: p, tool_type, action, path: opts.path || '', allowed };
    }
    const info = this.db.prepare(
      'INSERT INTO permissions (project, tool_type, action, path, allowed) VALUES (?, ?, ?, ?, ?)'
    ).run(p, tool_type, action, opts.path || '', allowed);
    return { id: info.lastInsertRowid, project: p, tool_type, action, path: opts.path || '', allowed };
  }

  remove(project, tool_type, opts = {}) {
    const p = opts.global ? GLOBAL_PROJECT : projectKey(project);
    const marker = opts.path || '';
    const r = this.db.prepare(
      'DELETE FROM permissions WHERE project = ? AND tool_type = ? AND path = ?'
    ).run(p, tool_type, marker);
    return r.changes > 0;
  }

  getAllEffective(project) {
    return this.getAllGlobal().concat(this.getAll(project));
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = { PermissionStore, GLOBAL_PROJECT, projectKey };
