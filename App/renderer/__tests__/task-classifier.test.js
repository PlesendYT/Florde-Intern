import { test } from 'node:test';
import assert from 'node:assert';
import { createTaskClassifier } from '../domains/task-classifier/task-classifier.js';

function makeClassifier(overrides = {}) {
  return createTaskClassifier({
    getAttachedImages: () => [],
    ...overrides,
  });
}

test('empty input → chatting with confidence 0.3', () => {
  const c = makeClassifier();
  const r = c.classify('');
  assert.strictEqual(r.primary, 'chatting');
  assert.strictEqual(r.confidence, 0.3);
  assert.strictEqual(r.secondary, null);
});

test('non-string input → chatting with confidence 0.3', () => {
  const c = makeClassifier();
  const r = c.classify(null);
  assert.strictEqual(r.primary, 'chatting');
  assert.strictEqual(r.confidence, 0.3);
  assert.strictEqual(r.secondary, null);
});

test('"Write a function that parses JSON" → primary coding', () => {
  const c = makeClassifier();
  const r = c.classify('Write a function that parses JSON');
  assert.strictEqual(r.primary, 'coding');
});

test('"Plan the architecture and outline the roadmap" → primary planning', () => {
  const c = makeClassifier();
  const r = c.classify('Plan the architecture and outline the roadmap');
  assert.strictEqual(r.primary, 'planning');
});

test('"Brainstorm creative ideas and compare options" → primary brainstorming', () => {
  const c = makeClassifier();
  const r = c.classify('Brainstorm creative ideas and compare options');
  assert.strictEqual(r.primary, 'brainstorming');
});

test('vision boost via getAttachedImages → primary vision', () => {
  const c = makeClassifier({ getAttachedImages: () => [{ url: 'img.png' }] });
  const r = c.classify('Plan the architecture');
  assert.strictEqual(r.primary, 'vision');
});

test('confidence is at most 1.0', () => {
  const c = makeClassifier();
  const r = c.classify('Write a function that parses JSON in Python');
  assert.ok(r.confidence <= 1.0, `confidence ${r.confidence} exceeds 1.0`);
});

test('secondary is null when second score/total ≤ 0.2', () => {
  const c = makeClassifier();
  const r = c.classify('Write a function that parses JSON in Python');
  assert.strictEqual(r.secondary, null);
});

test('_riskOf: 3+ hints → high', () => {
  const c = makeClassifier();
  const r = c._riskOf('delete everything and rm -rf / and password');
  assert.strictEqual(r, 'high');
});

test('_riskOf: 1 hint → medium', () => {
  const c = makeClassifier();
  const r = c._riskOf('delete the file');
  assert.strictEqual(r, 'medium');
});

test('_riskOf: 0 hints → low', () => {
  const c = makeClassifier();
  const r = c._riskOf('hello there');
  assert.strictEqual(r, 'low');
});

test('factory default without config does not throw', () => {
  assert.doesNotThrow(() => {
    createTaskClassifier();
  });
});

test('chatting fallback rule provides baseline for plain text', () => {
  const c = makeClassifier();
  const r = c.classify('hello how are you');
  assert.strictEqual(r.primary, 'chatting');
  assert.strictEqual(r.secondary, null);
});
