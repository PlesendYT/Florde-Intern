import { test } from 'node:test';
import assert from 'node:assert';
import notify from '../core/notification.js';
import eventBus from '../core/events.js';

test('notify.success emits state:notify with type success', () => {
  let got = null;
  const off = eventBus.on('state:notify', (e) => (got = e));
  notify.success('All good');
  off();
  assert.strictEqual(got.type, 'success');
  assert.strictEqual(got.text, 'All good');
});

test('notify.error emits type error', () => {
  let got = null;
  const off = eventBus.on('state:notify', (e) => (got = e));
  notify.error('Oops');
  off();
  assert.strictEqual(got.type, 'error');
});

test('notify.info and warn use their types', () => {
  const seen = [];
  const off = eventBus.on('state:notify', (e) => seen.push(e.type));
  notify.info('i'); notify.warn('w');
  off();
  assert.deepStrictEqual(seen, ['info', 'warn']);
});
