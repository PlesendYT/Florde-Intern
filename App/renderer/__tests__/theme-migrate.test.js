import { test } from 'node:test';
import assert from 'node:assert';
import { migrateTheme, THEME_CYCLE, DEFAULT_THEME } from '../domains/theme/theme.js';

test('only 3 built-in themes, dark is default', () => {
  assert.deepStrictEqual(THEME_CYCLE, ['florde-dark', 'florde-light', 'florde-midnight']);
  assert.strictEqual(DEFAULT_THEME, 'florde-dark');
});

test('legacy themes map to new equivalents', () => {
  assert.strictEqual(migrateTheme('dark'), 'florde-dark');
  assert.strictEqual(migrateTheme('light'), 'florde-light');
  assert.strictEqual(migrateTheme('high-contrast'), 'florde-dark');
  assert.strictEqual(migrateTheme('solarized-dark'), 'florde-dark');
  assert.strictEqual(migrateTheme('solarized-light'), 'florde-light');
  assert.strictEqual(migrateTheme('florde-midnight'), 'florde-midnight');
  assert.strictEqual(migrateTheme(undefined), 'florde-dark');
});
