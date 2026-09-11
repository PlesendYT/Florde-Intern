const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DbService } = require('../db-service');

describe('DbService SQL allowlist (IPC contract)', () => {
  it('run() rejects DDL (CREATE TABLE) — schema lives in storage.js init()', () => {
    const err = DbService._checkSql('CREATE TABLE IF NOT EXISTS time_sessions (id INTEGER)', 'run');
    assert.ok(err, 'CREATE via run must be rejected, got: ' + err);
  });

  it('run() allows INSERT/UPDATE/DELETE on app tables', () => {
    assert.strictEqual(DbService._checkSql('INSERT INTO todos (a) VALUES (?)', 'run'), null);
    assert.strictEqual(DbService._checkSql('UPDATE todos SET a = ? WHERE id = ?', 'run'), null);
    assert.strictEqual(DbService._checkSql('DELETE FROM layout_states WHERE name = ?', 'run'), null);
  });

  it('query() only allows SELECT', () => {
    assert.strictEqual(DbService._checkSql('SELECT state_json FROM layout_states WHERE name = ?', 'query'), null);
    assert.ok(DbService._checkSql('DELETE FROM layout_states WHERE name = ?', 'query'));
  });
});

describe('Renderer must not send DDL over flordeDb IPC', () => {
  // Regression guard for: "Error occurred in handler for 'florde:run':
  // run rejected: only INSERT/UPDATE/DELETE allowed" on every startup.
  // DDL via IPC is rejected by the allowlist; tables are created by
  // storage.js init() in the main process (ensure via initDb).
  it('time-tracking.js sends no CREATE/DROP/ALTER via flordeDb', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'renderer', 'time-tracking.js'), 'utf-8');
    assert.ok(src.includes('flordeDb'), 'test premise: file uses flordeDb');
    assert.ok(!/\b(CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|TRUNCATE)\b/i.test(src),
      'renderer must not contain DDL — schema is owned by storage.js init()');
  });

  it('storage.js init() still owns the time_sessions schema', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'storage.js'), 'utf-8');
    assert.ok(/CREATE TABLE IF NOT EXISTS time_sessions/i.test(src),
      'storage.js must create time_sessions or sessions are never persisted');
  });
});
