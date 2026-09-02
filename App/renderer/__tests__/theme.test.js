import { test } from 'node:test';
import assert from 'node:assert';
import { THEME_CYCLE, DEFAULT_THEME, isLightTheme, normalizeTheme, nextTheme, monacoThemeFor } from '../domains/theme/theme.js';

test('THEME_CYCLE has the 5 themes in order', () => {
  assert.deepStrictEqual(THEME_CYCLE, ['dark', 'light', 'high-contrast', 'solarized-dark', 'solarized-light']);
});

test('DEFAULT_THEME is dark', () => {
  assert.strictEqual(DEFAULT_THEME, 'dark');
});

test('isLightTheme is true only for light themes', () => {
  assert.strictEqual(isLightTheme('light'), true);
  assert.strictEqual(isLightTheme('solarized-light'), true);
  assert.strictEqual(isLightTheme('dark'), false);
  assert.strictEqual(isLightTheme('high-contrast'), false);
  assert.strictEqual(isLightTheme('solarized-dark'), false);
});

test('normalizeTheme uses dark default', () => {
  assert.strictEqual(normalizeTheme('light'), 'light');
  assert.strictEqual(normalizeTheme(''), 'dark');
  assert.strictEqual(normalizeTheme(undefined), 'dark');
  assert.strictEqual(normalizeTheme(null), 'dark');
});

test('nextTheme cycles in order', () => {
  assert.strictEqual(nextTheme('dark'), 'light');
  assert.strictEqual(nextTheme('light'), 'high-contrast');
  assert.strictEqual(nextTheme('solarized-light'), 'dark');
});

test('nextTheme falls back to first for unknown or empty', () => {
  assert.strictEqual(nextTheme(''), 'light');
  assert.strictEqual(nextTheme('nonsense'), 'dark');
});

test('monacoThemeFor maps light to vs, else vs-dark', () => {
  assert.strictEqual(monacoThemeFor('light'), 'vs');
  assert.strictEqual(monacoThemeFor('solarized-light'), 'vs');
  assert.strictEqual(monacoThemeFor('dark'), 'vs-dark');
  assert.strictEqual(monacoThemeFor('high-contrast'), 'vs-dark');
});
