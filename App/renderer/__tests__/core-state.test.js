import { test } from 'node:test';
import assert from 'node:assert';
import { createState } from '../core/state.js';

test('state set/get round-trips', () => {
  const s = createState({ a: 1 });
  s.set('a', 2);
  assert.strictEqual(s.get('a'), 2);
});

test('state subscribe fires on set', () => {
  const s = createState({});
  let seen = null;
  s.subscribe('a', (v) => (seen = v));
  s.set('a', 99);
  assert.strictEqual(seen, 99);
});

test('state get without key returns whole object', () => {
  const s = createState({ a: 1, b: 2 });
  s.set('c', 3);
  assert.deepStrictEqual(s.get(), { a: 1, b: 2, c: 3 });
});

test('state subscribe unsubscribe stops delivery', () => {
  const s = createState({});
  let calls = 0;
  const off = s.subscribe('a', () => calls++);
  off();
  s.set('a', 1);
  assert.strictEqual(calls, 0);
});
