import { test } from 'node:test';
import assert from 'node:assert';
import { mergeSettings, PROVIDER_IDS, LOCAL_PROVIDER_IDS, buildProviderSettings } from '../domains/settings/store.js';

test('mergeSettings merges patch over existing shallowly', () => {
  const merged = mergeSettings({ a: 1, theme: 'dark' }, { b: 2 });
  assert.deepStrictEqual(merged, { a: 1, b: 2, theme: 'dark' });
  assert.deepStrictEqual(mergeSettings(undefined, { x: 1 }), { x: 1 });
  assert.deepStrictEqual(mergeSettings({ a: 1 }), { a: 1 });
});

test('mergeSettings does not mutate existing', () => {
  const existing = { a: 1 };
  mergeSettings(existing, { b: 2 });
  assert.deepStrictEqual(existing, { a: 1 });
});

test('PROVIDER_IDS has 13 ids incl. custom and locals', () => {
  assert.strictEqual(PROVIDER_IDS.length, 13);
  assert.ok(PROVIDER_IDS.includes('openai'));
  assert.ok(PROVIDER_IDS.includes('ollama'));
  assert.ok(PROVIDER_IDS.includes('custom'));
});

test('LOCAL_PROVIDER_IDS is the 3 local providers', () => {
  assert.deepStrictEqual(LOCAL_PROVIDER_IDS, ['ollama', 'lmstudio', 'localai']);
});

test('buildProviderSettings builds enabled/key/model/url/temp for a provider', () => {
  const s = buildProviderSettings({
    providerIds: ['openai', 'ollama', 'custom'],
    isEnabled: id => id !== 'ollama',
    getVal: (id, f) => id + ':' + f,
    getTemp: () => 0.7,
    isValidKey: id => id === 'openai'
  });
  assert.strictEqual(s.openaiEnabled, true);
  assert.strictEqual(s.openaiKey, 'openai:key');
  assert.strictEqual(s.openaiModel, 'openai:model');
  assert.strictEqual(s.openaiTemp, 0.7);
  assert.strictEqual(s.ollamaEnabled, false);
  assert.strictEqual(s.ollamaUrl, 'ollama:url');
  assert.strictEqual(s.ollamaModel, 'ollama:model');
  assert.ok(!('ollamaKey' in s), 'local provider should not emit a key field');
  assert.strictEqual(s.customUrl, 'custom:url');
  assert.strictEqual(s.customKey, '', 'custom key only when isValidKey true');
  assert.strictEqual(s.customModel, 'custom:model');
});
