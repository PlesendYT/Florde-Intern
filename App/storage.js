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
    // Security/robustness (b-25): busy timeout instead of instant SQLITE_BUSY,
    // integrity check on open (corrupt files are quarantined, not silently used).
    let db;
    try {
      db = new Database(this.dbPath);
      db.pragma('busy_timeout = 5000');
      const check = db.pragma('quick_check', { simple: true });
      if (check !== 'ok') throw new Error('integrity check failed: ' + check);
    } catch (e) {
      try { if (db) db.close(); } catch {}
      const backup = this.dbPath + '.corrupt-' + Date.now();
      try {
        if (fs.existsSync(this.dbPath)) fs.renameSync(this.dbPath, backup);
        for (const suffix of ['-wal', '-shm', '-journal']) {
          try { if (fs.existsSync(this.dbPath + suffix)) fs.renameSync(this.dbPath + suffix, backup + suffix); } catch {}
        }
      } catch {}
      console.error('[storage] database corrupt, quarantined to ' + backup + ' — starting fresh:', e.message);
      db = new Database(this.dbPath);
      db.pragma('busy_timeout = 5000');
    }
    this.db = db;
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

      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        priority TEXT DEFAULT 'medium',
        tags TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        content TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        alternatives TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS time_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        start TIMESTAMP NOT NULL,
        end TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS time_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        project TEXT,
        total_seconds REAL DEFAULT 0,
        UNIQUE(date, project)
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
