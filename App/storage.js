const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

class FlordeStorage {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,
        data TEXT
      );

      CREATE TABLE IF NOT EXISTS feature_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        month TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        action TEXT NOT NULL,
        path TEXT,
        allowed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS layout_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        state_json TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        project TEXT
      );
    `);
    return this;
  }

  get(namespace, key) {
    const row = this.db.prepare(
      'SELECT value FROM kv_store WHERE namespace = ? AND key = ?'
    ).get(namespace, key);
    return row ? row.value : null;
  }

  set(namespace, key, value) {
    this.db.prepare(
      `INSERT INTO kv_store (namespace, key, value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(namespace, key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`
    ).run(namespace, key, value);
  }

  delete(namespace, key) {
    this.db.prepare(
      'DELETE FROM kv_store WHERE namespace = ? AND key = ?'
    ).run(namespace, key);
  }

  getAll(namespace) {
    return this.db.prepare(
      'SELECT key, value FROM kv_store WHERE namespace = ?'
    ).all(namespace);
  }

  deleteNamespace(namespace) {
    this.db.prepare('DELETE FROM kv_store WHERE namespace = ?').run(namespace);
  }

  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = FlordeStorage;
