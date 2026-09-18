import { test } from 'node:test';
import assert from 'node:assert';
import { createSessionRegistry } from '../domains/dryrun/sessions.js';

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: (k) => m.delete(k), keys: () => [...m.keys()] };
}

test('one session per project, independent across projects', () => {
  const r = createSessionRegistry(memStore());
  r.start('projA', { path: '/tmp/a', kind: 'copy' });
  r.start('projB', { path: '/tmp/b', kind: 'worktree' });
  assert.strictEqual(r.get('projA').state, 'active');
  assert.strictEqual(r.get('projB').state, 'active');
  assert.throws(() => r.start('projA', { path: '/tmp/a2' }), /already active/);
});

test('op log, finish, apply lifecycle', () => {
  const r = createSessionRegistry(memStore());
  r.start('p', { path: '/tmp/w', kind: 'copy' });
  r.addOp('p', { kind: 'file', action: 'create', target: 'main.py', status: 'ok' });
  r.finish('p', { filesCreated: 1 });
  assert.strictEqual(r.get('p').state, 'review');
  assert.strictEqual(r.get('p').ops.length, 1);
  r.apply('p');
  assert.strictEqual(r.get('p'), null);
});

test('reject clears session, listOrphans finds unknown projects', () => {
  const r = createSessionRegistry(memStore());
  r.start('p', { path: '/tmp/w', kind: 'copy' });
  r.reject('p');
  assert.strictEqual(r.get('p'), null);
  const r2 = createSessionRegistry(memStore());
  r2.start('gone', { path: '/tmp/old', kind: 'copy' });
  assert.deepStrictEqual(r2.listOrphans(['other']), [{ project: 'gone', path: '/tmp/old', kind: 'copy' }]);
});

test('activate moves review back to active, throws otherwise', () => {
  const r = createSessionRegistry(memStore());
  r.start('p', { path: '/tmp/w', kind: 'copy' });
  assert.throws(() => r.activate('p'), /no review session/);
  r.finish('p', { files: 1 });
  assert.strictEqual(r.get('p').state, 'review');
  r.activate('p');
  assert.strictEqual(r.get('p').state, 'active');
  assert.throws(() => r.activate('missing'), /no review session/);
  r.finish('p', null);
  r.apply('p');
  assert.throws(() => r.activate('p'), /no review session/);
});
