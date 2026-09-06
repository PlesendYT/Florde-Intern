const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionStore } = require('../permission-store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-store-'));
  const store = new PermissionStore(path.join(dir, 'db.sqlite'));
  store.init();
  return { store, dir };
}

test('set + getAll scoped to project', () => {
  const { store, dir } = freshStore();
  store.set('projA', 'sudo', 'allow');
  store.set('projB', 'sudo', 'block');
  const a = store.getAll('projA');
  assert.equal(a.length, 1);
  assert.equal(a[0].tool_type, 'sudo');
  assert.equal(a[0].allowed, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('global rule uses __global__ and is separated', () => {
  const { store, dir } = freshStore();
  store.set(null, 'apt-install', 'ask', { global: true });
  const g = store.getAllGlobal();
  assert.ok(g.some(r => r.tool_type === 'apt-install'));
  const proj = store.getAll('projA');
  assert.ok(!proj.some(r => r.project === '__global__'));
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set updates existing rule (upsert by project+action+path)', () => {
  const { store, dir } = freshStore();
  store.set('p', 'sudo', 'block');
  store.set('p', 'sudo', 'allow');
  const all = store.getAll('p');
  assert.equal(all.length, 1);
  assert.equal(all[0].allowed, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set with path is separate from without path', () => {
  const { store, dir } = freshStore();
  store.set('p', 'exec', 'ask');
  store.set('p', 'exec', 'allow', { path: '/safe/path' });
  const all = store.getAll('p');
  assert.equal(all.length, 2);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('remove deletes a matching rule', () => {
  const { store, dir } = freshStore();
  store.set('p', 'sudo', 'block');
  store.remove('p', 'sudo');
  assert.equal(store.getAll('p').length, 0);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects empty/invalid tool_type', () => {
  const { store, dir } = freshStore();
  assert.throws(() => store.set('p', '', 'allow'), /tool_type/);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rejects invalid allowed level', () => {
  const { store, dir } = freshStore();
  assert.throws(() => store.set('p', 'sudo', 'nonsense'), /level/);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
