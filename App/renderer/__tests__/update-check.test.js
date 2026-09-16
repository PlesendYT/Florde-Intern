import { test } from 'node:test';
import assert from 'node:assert';

// RED: Update-Check — Badge nur bei wirklich neuerer Version, still ohne Netz.
test('update check helper exists', async () => {
  const mod = await import('../domains/update/check.js');
  assert.ok(typeof mod.isNewer === 'function', 'isNewer missing');
  assert.ok(typeof mod.parseVersionPayload === 'function', 'parseVersionPayload missing');
  assert.ok(typeof mod.checkForUpdate === 'function', 'checkForUpdate missing');
});

test('isNewer detects newer remote versions', async () => {
  const { isNewer } = await import('../domains/update/check.js');
  assert.strictEqual(isNewer('1.1', '1.0'), true);
  assert.strictEqual(isNewer('2.0', '1.9.9'), true);
  assert.strictEqual(isNewer('v1.2', '1.1'), true);
  assert.strictEqual(isNewer('1.0.1', '1.0.0'), true);
});

test('isNewer stays silent on equal/older/invalid versions', async () => {
  const { isNewer } = await import('../domains/update/check.js');
  assert.strictEqual(isNewer('1.0', '1.0.0'), false, 'trailing zeros are equal');
  assert.strictEqual(isNewer('1.0.0', '1.0'), false);
  assert.strictEqual(isNewer('1.0', '2.0'), false, 'downgrade must not nag');
  assert.strictEqual(isNewer('', '1.0'), false);
  assert.strictEqual(isNewer('abc', '1.0'), false);
  assert.strictEqual(isNewer('1.0', ''), false);
  assert.strictEqual(isNewer(null, '1.0'), false);
});

test('parseVersionPayload reads {"version":"x"} and rejects garbage', async () => {
  const { parseVersionPayload } = await import('../domains/update/check.js');
  assert.strictEqual(parseVersionPayload('{"version":"1.0"}'), '1.0');
  assert.strictEqual(parseVersionPayload('{"version":" 2.0 "}'), '2.0');
  assert.strictEqual(parseVersionPayload('{}'), null);
  assert.strictEqual(parseVersionPayload('{"version":123}'), null);
  assert.strictEqual(parseVersionPayload('not json'), null);
  assert.strictEqual(parseVersionPayload(''), null);
});

test('checkForUpdate reports update only when remote is newer', async () => {
  const { checkForUpdate } = await import('../domains/update/check.js');
  const ok = (text) => async () => ({ ok: true, text: async () => text });
  let r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: ok('{"version":"1.1"}'), isOnline: () => true });
  assert.deepStrictEqual(r, { update: true, remote: '1.1' });
  r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: ok('{"version":"1.0"}'), isOnline: () => true });
  assert.deepStrictEqual(r, { update: false, remote: '1.0' });
});

test('checkForUpdate prefers injected fetchText (main-process, no CORS)', async () => {
  const { checkForUpdate } = await import('../domains/update/check.js');
  let gotUrl = null;
  const fetchText = async (u) => { gotUrl = u; return '{"version":"2.0"}'; };
  const r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchText, isOnline: () => true });
  assert.deepStrictEqual(r, { update: true, remote: '2.0' });
  assert.strictEqual(gotUrl, 'https://x/version.json');
  const r2 = await checkForUpdate({
    url: 'https://x/version.json', localVersion: '1.0',
    fetchText: async () => { throw new Error('no net'); }, isOnline: () => true,
  });
  assert.deepStrictEqual(r2, { update: false, remote: null });
});

test('buildUpdateConfirmText names both versions', async () => {
  const { buildUpdateConfirmText } = await import('../domains/update/check.js');
  const t = buildUpdateConfirmText('1.0.0', '1.1.0');
  assert.match(t, /1\.1\.0/, 'remote version named');
  assert.match(t, /1\.0\.0/, 'local version named');
});

test('checkForUpdate is silent offline / on errors', async () => {
  const { checkForUpdate } = await import('../domains/update/check.js');
  let called = false;
  const spy = async () => { called = true; return { ok: true, text: async () => '{"version":"9.9"}' }; };
  let r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: spy, isOnline: () => false });
  assert.deepStrictEqual(r, { update: false, remote: null });
  assert.strictEqual(called, false, 'must not fetch when offline');
  r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: async () => { throw new Error('down'); }, isOnline: () => true });
  assert.deepStrictEqual(r, { update: false, remote: null });
  r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: async () => ({ ok: false, text: async () => '' }), isOnline: () => true });
  assert.deepStrictEqual(r, { update: false, remote: null });
  r = await checkForUpdate({ url: 'https://x/version.json', localVersion: '1.0', fetchFn: async () => ({ ok: true, text: async () => 'garbage' }), isOnline: () => true });
  assert.deepStrictEqual(r, { update: false, remote: null });
});
