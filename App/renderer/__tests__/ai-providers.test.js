import { test } from 'node:test';
import assert from 'node:assert';
import { classifyProvider, parseProviderConfig, listActiveProviders, PROVIDER_DEFS } from '../domains/ai/providers.js';

test('classifyProvider recognizes ollama by local baseUrl', () => {
  const r = classifyProvider({ name: 'ollama default', baseUrl: 'http://localhost:11434' });
  assert.strictEqual(r.kind, 'ollama');
});

test('classifyProvider recognizes openai by host', () => {
  const r = classifyProvider({ baseUrl: 'https://api.openai.com/v1/chat/completions' });
  assert.strictEqual(r.kind, 'openai');
});

test('classifyProvider falls back to unknown for unrecognized', () => {
  const r = classifyProvider({ baseUrl: 'https://random.example.net/x' });
  assert.strictEqual(r.kind, 'unknown');
});

test('classifyProvider distinguishes opencodezen vs opencodego by path', () => {
  assert.strictEqual(classifyProvider({ baseUrl: 'https://opencode.ai/zen/v1/chat/completions' }).kind, 'opencodezen');
  assert.strictEqual(classifyProvider({ baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions' }).kind, 'opencodego');
});

test('parseProviderConfig normalizes baseUrl and model defaults', () => {
  const cfg = parseProviderConfig({ baseUrl: 'http://x:8080', apiKey: '' });
  assert.strictEqual(cfg.baseUrl, 'http://x:8080');
  assert.strictEqual(cfg.kind, 'unknown');
});

test('listActiveProviders returns only enabled+keyed providers', () => {
  const cfg = {
    openai: { enabled: true, key: 'sk-1', model: 'gpt-4o' },
    deepseek: { enabled: true, key: '', model: 'deepseek-chat' },
    ollama: { enabled: true, url: 'http://localhost:11434', model: 'qwen2.5-coder' }
  };
  const active = listActiveProviders(cfg);
  const ids = active.map(p => p.id);
  assert.ok(ids.includes('openai'));
  assert.ok(ids.includes('ollama'));
  assert.ok(!ids.includes('deepseek'));
});

test('PROVIDER_DEFS covers all 13 provider ids', () => {
  const ids = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','openrouter','custom','ollama','lmstudio','localai'];
  for (const id of ids) {
    const def = PROVIDER_DEFS[id];
    assert.ok(def, 'missing def for ' + id);
    assert.ok(typeof def.baseUrl === 'string');
    assert.ok(def.defaultModel);
    assert.strictEqual(typeof def.needsKey, 'boolean');
  }
  assert.strictEqual(PROVIDER_DEFS.ollama.needsKey, false);
  assert.strictEqual(PROVIDER_DEFS.openai.needsKey, true);
});
