import { test } from 'node:test';
import assert from 'node:assert';
import { createEventBus } from '../core/events.js';

test('event bus on/emit delivers to subscriber', () => {
  const bus = createEventBus();
  let got = null;
  bus.on('x', (v) => (got = v));
  bus.emit('x', 42);
  assert.strictEqual(got, 42);
});

test('event bus off removes subscriber', () => {
  const bus = createEventBus();
  let calls = 0;
  const fn = () => calls++;
  bus.on('y', fn);
  bus.off('y', fn);
  bus.emit('y');
  assert.strictEqual(calls, 0);
});

test('event bus clear removes all subscribers', () => {
  const bus = createEventBus();
  let calls = 0;
  bus.on('a', () => calls++);
  bus.on('b', () => calls++);
  bus.clear();
  bus.emit('a');
  bus.emit('b');
  assert.strictEqual(calls, 0);
});

test('event bus on returns an unsubscribe function', () => {
  const bus = createEventBus();
  let calls = 0;
  const off = bus.on('z', () => calls++);
  off();
  bus.emit('z');
  assert.strictEqual(calls, 0);
});
