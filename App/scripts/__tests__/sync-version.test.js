import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// RED: scripts/sync-version.js liest App/config.json und schreibt die
// Version nach package.json (+ package-lock.json), damit build/run/start
// und app.getVersion() (Update-Check) alle dieselbe Version nutzen.
test('sync-version helper exists', async () => {
  const mod = await import('../sync-version.js');
  assert.ok(typeof mod.syncVersion === 'function', 'syncVersion missing');
  assert.ok(typeof mod.isValidVersion === 'function', 'isValidVersion missing');
});

test('isValidVersion accepts 1.0.0 and 1.0, rejects garbage', async () => {
  const { isValidVersion } = await import('../sync-version.js');
  assert.strictEqual(isValidVersion('1.0.0'), true);
  assert.strictEqual(isValidVersion('1.0'), true);
  assert.strictEqual(isValidVersion('2.3.4-beta.1'), true);
  assert.strictEqual(isValidVersion(''), false);
  assert.strictEqual(isValidVersion('abc'), false);
  assert.strictEqual(isValidVersion('1'), false);
  assert.strictEqual(isValidVersion('1.0.0; rm -rf /'), false);
});

test('syncVersion writes config version into package.json + lock', async () => {
  const { syncVersion } = await import('../sync-version.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'florde-ver-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'Florde', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'Florde', version: '1.0.0' }, null, 2));
  const res = syncVersion(dir);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.version, '9.9.9');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).version, '9.9.9');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf-8')).version, '9.9.9');
  fs.rmSync(dir, { recursive: true });
});

test('syncVersion is a no-op when versions match, throws on bad config', async () => {
  const { syncVersion } = await import('../sync-version.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'florde-ver-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'Florde', version: '1.0.0' }, null, 2));
  const res = syncVersion(dir);
  assert.strictEqual(res.changed, false);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 'nonsense!!' }));
  assert.throws(() => syncVersion(dir), /version/i);
  fs.rmSync(dir, { recursive: true });
});
