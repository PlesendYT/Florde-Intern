import { test } from 'node:test';
import assert from 'node:assert';
import { THEME_CYCLE, DEFAULT_THEME, isLightTheme, normalizeTheme, nextTheme, monacoThemeFor, migrateTheme } from '../domains/theme/theme.js';

test('THEME_CYCLE has the 3 themes in order', () => {
  assert.deepStrictEqual(THEME_CYCLE, ['florde-dark', 'florde-light', 'florde-midnight']);
});

test('DEFAULT_THEME is florde-dark', () => {
  assert.strictEqual(DEFAULT_THEME, 'florde-dark');
});

test('isLightTheme is true only for florde-light (incl. legacy light aliases)', () => {
  assert.strictEqual(isLightTheme('florde-light'), true);
  assert.strictEqual(isLightTheme('light'), true);
  assert.strictEqual(isLightTheme('solarized-light'), true);
  assert.strictEqual(isLightTheme('florde-dark'), false);
  assert.strictEqual(isLightTheme('florde-midnight'), false);
  assert.strictEqual(isLightTheme('dark'), false);
  assert.strictEqual(isLightTheme('high-contrast'), false);
  assert.strictEqual(isLightTheme('solarized-dark'), false);
});

test('normalizeTheme migrates legacy to new names', () => {
  assert.strictEqual(normalizeTheme('florde-light'), 'florde-light');
  assert.strictEqual(normalizeTheme('dark'), 'florde-dark');
  assert.strictEqual(normalizeTheme(''), 'florde-dark');
  assert.strictEqual(normalizeTheme(undefined), 'florde-dark');
  assert.strictEqual(normalizeTheme(null), 'florde-dark');
});

test('nextTheme cycles in order', () => {
  assert.strictEqual(nextTheme('florde-dark'), 'florde-light');
  assert.strictEqual(nextTheme('florde-light'), 'florde-midnight');
  assert.strictEqual(nextTheme('florde-midnight'), 'florde-dark');
});

test('nextTheme migrates legacy input before cycling', () => {
  assert.strictEqual(nextTheme('dark'), 'florde-light');
  assert.strictEqual(nextTheme('light'), 'florde-midnight');
});

test('nextTheme falls back to first for unknown or empty', () => {
  assert.strictEqual(nextTheme(''), 'florde-light');
  assert.strictEqual(nextTheme('nonsense'), 'florde-light');
});

test('monacoThemeFor maps light to vs, else vs-dark', () => {
  assert.strictEqual(monacoThemeFor('florde-light'), 'vs');
  assert.strictEqual(monacoThemeFor('light'), 'vs');
  assert.strictEqual(monacoThemeFor('florde-dark'), 'vs-dark');
  assert.strictEqual(monacoThemeFor('florde-midnight'), 'vs-dark');
  assert.strictEqual(monacoThemeFor('high-contrast'), 'vs-dark');
});

test('migrateTheme is exposed', () => {
  assert.strictEqual(typeof migrateTheme, 'function');
});
