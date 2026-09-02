import { test } from 'node:test';
import assert from 'node:assert';
import { createAuditLog, logAudit, getAuditEntries, clearAudit } from '../domains/audit/audit-log.js';

test('log builds normalized entry and prepends', async () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 'p1' });
  await core.log({ type: 'file_write', action: 'File written', source: 'AI' });
  const es = core.getEntries();
  assert.strictEqual(es.length, 1);
  assert.strictEqual(es[0].type, 'file_write');
  assert.strictEqual(es[0].source, 'AI');
  assert.strictEqual(es[0].status, 'auto');
  assert.ok(es[0].timestamp);
  assert.strictEqual(es[0].project, 'p1');
});

test('log respects maxLogs cap 500', async () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 'p' });
  for (let i = 0; i < 505; i++) await core.log({ type: 't', action: 'a' });
  assert.strictEqual(core.getEntries().length, 500);
});

test('DB persistence path: when db exists, loads from dbQuery result', async () => {
  const dbEntry = JSON.stringify({ id: 1, timestamp: 'x', type: 'cmd', action: 'a', status: 'auto', summary: 's', details: {}, source: 'KI' });
  const storage = { getItem: () => null, setItem: () => {} };
  const core = createAuditLog({
    dbCheck: () => true,
    dbRun: () => {},
    dbQuery: () => [{ data: dbEntry }],
    storage, project: 'p'
  });
  await core._load();
  const es = core.getEntries();
  assert.strictEqual(es.length, 1);
  assert.strictEqual(es[0].type, 'cmd');
});

test('localStorage fallback path loads saved logs', async () => {
  const saved = [{ id: 2, timestamp: 'y', type: 'a', action: 'b' }];
  const store = new Map([['florde-audit-ki-p', JSON.stringify(saved)]]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 'p' });
  await core._load();
  assert.deepStrictEqual(core.getEntries(), saved);
});

test('clear empties logs', async () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 'p' });
  await core.log({ type: 't', action: 'a' });
  core.clear();
  assert.strictEqual(core.getEntries().length, 0);
});

test('setProject triggers load and updates current project', async () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: null });
  await core.setProject('projX');
  const meta = core.getMeta();
  assert.strictEqual(meta.currentProject, 'projX');
});

test('getMeta returns currentProject and useDb state', async () => {
  const storage = { getItem: () => null, setItem: () => {} };
  const core = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 'p' });
  await core._load();
  const meta = core.getMeta();
  assert.strictEqual(meta.currentProject, 'p');
  assert.strictEqual(meta.useDb, false);
  assert.strictEqual(meta.maxLogs, 500);
});

test('singleton exports logAudit/getAuditEntries/clearAudit work', async () => {
  const storage = { getItem: () => null, setItem: () => {} };
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  window.__auditLogCore = createAuditLog({ dbCheck: () => false, dbRun: () => {}, dbQuery: () => null, storage, project: 's' });
  await logAudit({ type: 'test', action: 'singleton test', source: 'KI' });
  const entries = getAuditEntries();
  assert.ok(entries.length >= 1);
  assert.strictEqual(entries[0].type, 'test');
  clearAudit();
  assert.strictEqual(getAuditEntries().length, 0);
  delete window.__auditLogCore;
});
