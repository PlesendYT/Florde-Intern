import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInRoot } from '../domains/dryrun/paths.js';

test('inside paths resolve, outside paths return null', () => {
  assert.strictEqual(resolveInRoot('/tmp/ws', 'main.py'), '/tmp/ws/main.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', 'sub/dir.py'), '/tmp/ws/sub/dir.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', '../evil.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'sub/../../evil.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', '/etc/passwd'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', ''), null);
});

test('tricky prefixes and dots do not escape', () => {
  assert.strictEqual(resolveInRoot('/tmp/ws', '../ws-evil/x.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'a/./b.py'), '/tmp/ws/a/b.py');
  assert.strictEqual(resolveInRoot('/tmp/ws', 'C:/evil.py'), null);
});

test('NUL bytes are rejected (fail closed)', () => {
  assert.strictEqual(resolveInRoot('/tmp/ws', 'a\0b.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'a/\0b'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', '\0'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', '../evil\0.py'), null);
  assert.strictEqual(resolveInRoot('/tmp/ws', 'sub\0/../evil.py'), null);
});
