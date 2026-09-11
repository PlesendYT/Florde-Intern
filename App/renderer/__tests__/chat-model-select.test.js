import { test } from 'node:test';
import assert from 'node:assert';

// RED: Chat braucht Provider- + Modell-Auswahl, auch wenn nichts konfiguriert ist
// und auch wenn der Router aus ist.
test('chat model-select helper exists with provider/model builders', async () => {
  const mod = await import('../domains/chat/model-select.js');
  assert.ok(typeof mod.buildProviderOptions === 'function', 'buildProviderOptions missing');
  assert.ok(typeof mod.buildModelOptions === 'function', 'buildModelOptions missing');
});

test('buildProviderOptions lists ALL providers even when none configured', async () => {
  const { buildProviderOptions } = await import('../domains/chat/model-select.js');
  const opts = buildProviderOptions({}, [], null);
  const values = opts.map(o => o.value);
  for (const pid of ['openai', 'deepseek', 'mistral', 'anthropic', 'gemini', 'grok', 'opencodezen', 'opencodego', 'ollama', 'lmstudio', 'localai', 'openrouter', 'custom']) {
    assert.ok(values.includes(pid), `provider ${pid} must always be selectable, got: ${values.join(',')}`);
  }
});

test('buildProviderOptions marks unconfigured providers as needing setup (not hidden)', async () => {
  const { buildProviderOptions } = await import('../domains/chat/model-select.js');
  const opts = buildProviderOptions({}, [], null);
  const openai = opts.find(o => o.value === 'openai');
  assert.ok(openai, 'openai option must exist');
  assert.strictEqual(openai.disabled, true, 'unconfigured provider must be disabled, not hidden');
  assert.match(openai.label, /setup|konfigur/i, 'label must hint setup needed');
});

test('buildProviderOptions keeps configured providers enabled with model in label', async () => {
  const { buildProviderOptions } = await import('../domains/chat/model-select.js');
  const opts = buildProviderOptions({ openai: { model: 'gpt-5.5' } }, [], null);
  const openai = opts.find(o => o.value === 'openai');
  assert.strictEqual(openai.disabled, false);
  assert.match(openai.label, /gpt-5\.5/);
});

test('buildModelOptions lists catalog models for provider', async () => {
  const { buildModelOptions } = await import('../domains/chat/model-select.js');
  const catalog = { openai: ['gpt-5.5', 'gpt-4o'] };
  const opts = buildModelOptions('openai', catalog, 'gpt-4o', []);
  const values = opts.map(o => o.value);
  assert.ok(values.includes('gpt-5.5'));
  assert.ok(values.includes('gpt-4o'));
  const current = opts.find(o => o.value === 'gpt-4o');
  assert.strictEqual(current.selected, true);
});

test('buildModelOptions falls back to current model when catalog empty (ollama)', async () => {
  const { buildModelOptions } = await import('../domains/chat/model-select.js');
  const opts = buildModelOptions('ollama', { ollama: [] }, 'my-local-model', []);
  const values = opts.map(o => o.value);
  assert.ok(values.includes('my-local-model'), 'current/typed model must stay selectable');
});
