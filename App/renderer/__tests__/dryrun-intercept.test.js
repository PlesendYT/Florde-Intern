import { test } from 'node:test';
import assert from 'node:assert';
import { rewriteForSession } from '../domains/dryrun/rewrite.js';

test('file paths rewrite into session root, escapes denied', () => {
  const ok = rewriteForSession('/tmp/ws', 'write_file', { path: 'main.py' });
  assert.deepStrictEqual(ok.args, { path: '/tmp/ws/main.py' });
  const bad = rewriteForSession('/tmp/ws', 'write_file', { path: '../evil.py' });
  assert.strictEqual(bad.denied, true);
});

test('exec commands classify, blocked never passes', () => {
  const blocked = rewriteForSession('/tmp/ws', 'exec_command', { command: 'pip install pygame' });
  assert.strictEqual(blocked.denied, true);
  assert.match(blocked.reason, /global package install/);
  const safe = rewriteForSession('/tmp/ws', 'exec_command', { command: 'python main.py' });
  assert.strictEqual(safe.denied, undefined);
  assert.strictEqual(safe.cwd, '/tmp/ws');
});

test('read-only tools pass through with rewritten path', () => {
  const r = rewriteForSession('/tmp/ws', 'read_file', { path: 'a.py' });
  assert.deepStrictEqual(r.args, { path: '/tmp/ws/a.py' });
});
