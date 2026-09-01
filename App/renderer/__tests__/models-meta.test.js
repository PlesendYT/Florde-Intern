import { test } from 'node:test';
import assert from 'node:assert';
import { MODEL_META, MODEL_TASK_DEFAULTS, MODEL_CATALOG } from '../domains/models/meta.js';

test('MODEL_TASK_DEFAULTS has all task keys', () => {
  for (const k of ['coding','chatting','planning','brainstorming','vision','image_generation','tool_calling','experimental_tool_calling']) {
    assert.ok(k in MODEL_TASK_DEFAULTS, `missing key ${k}`);
  }
});

test('MODEL_META entries have costIn/costOut/free shape and tasks object when present', () => {
  const names = Object.keys(MODEL_META);
  assert.ok(names.length > 0);
  for (const name of names) {
    const m = MODEL_META[name];
    assert.ok(typeof m.costIn === 'number', name);
    assert.ok(typeof m.costOut === 'number', name);
    assert.ok(typeof m.free === 'boolean', name);
    if ('tasks' in m) {
      assert.ok(m.tasks && typeof m.tasks === 'object', name);
    }
  }
});

test('MODEL_CATALOG maps providers to model arrays', () => {
  const entries = Object.entries(MODEL_CATALOG);
  assert.ok(entries.length > 0);
  for (const [pid, models] of entries) {
    assert.ok(Array.isArray(models), pid);
  }
  const total = Object.values(MODEL_CATALOG).reduce((n, a) => n + a.length, 0);
  assert.ok(total > 0, 'catalog must map to at least one model');
});

test('default export bundles all three', async () => {
  const def = (await import('../domains/models/meta.js')).default;
  assert.strictEqual(def.MODEL_META, MODEL_META);
  assert.strictEqual(def.MODEL_TASK_DEFAULTS, MODEL_TASK_DEFAULTS);
  assert.strictEqual(def.MODEL_CATALOG, MODEL_CATALOG);
});
