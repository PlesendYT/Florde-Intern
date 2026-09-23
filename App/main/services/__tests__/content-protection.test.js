const { test } = require('node:test');
const assert = require('node:assert');
const { applyContentProtection } = require('../content-protection');

test('enables protection and verifies via getter', () => {
  const calls = [];
  const win = {
    setContentProtection: (v) => calls.push(v),
    isContentProtected: () => true,
  };
  assert.strictEqual(applyContentProtection(win), true);
  assert.deepStrictEqual(calls, [true]);
});

test('returns false when the setter throws', () => {
  const win = {
    setContentProtection: () => { throw new Error('nope'); },
  };
  assert.strictEqual(applyContentProtection(win), false);
});

test('returns false without a window or setter', () => {
  assert.strictEqual(applyContentProtection(null), false);
  assert.strictEqual(applyContentProtection({}), false);
});

test('reports getter state honestly when protection is off', () => {
  const win = {
    setContentProtection: () => {},
    isContentProtected: () => false,
  };
  assert.strictEqual(applyContentProtection(win), false);
});
