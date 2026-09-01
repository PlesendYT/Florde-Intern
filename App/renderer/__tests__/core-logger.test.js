import { test } from 'node:test';
import assert from 'node:assert';
import logger from '../core/logger.js';
import eventBus from '../core/events.js';

test('logger.info emits state:log with message', () => {
  let got = null;
  const off = eventBus.on('state:log', (e) => (got = e));
  logger.info('hello world');
  off();
  assert.strictEqual(got.message, 'hello world');
});

test('logger.info emits default type info', () => {
  let got = null;
  const off = eventBus.on('state:log', (e) => (got = e));
  logger.info('x');
  off();
  assert.strictEqual(got.type, 'info');
});

test('logger.warn/error/debug use their types', () => {
  const seen = [];
  const off = eventBus.on('state:log', (e) => seen.push(e));
  logger.warn('w'); logger.error('e'); logger.debug('d');
  off();
  assert.deepStrictEqual(seen.map(e => e.type), ['warn', 'error', 'debug']);
});

test('logger.logToTerminal emits with provided type', () => {
  let got = null;
  const off = eventBus.on('state:log', (e) => (got = e));
  logger.logToTerminal('custom msg', 'success');
  off();
  assert.strictEqual(got.message, 'custom msg');
  assert.strictEqual(got.type, 'success');
});
