const PROVIDER_HOST_MAP = {
  'api.openai.com': 'openai',
  'api.deepseek.com': 'deepseek',
  'api.mistral.ai': 'mistral',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'gemini',
  'api.x.ai': 'grok',
  'openrouter.ai': 'openrouter',
  'localhost:11434': 'ollama',
  'localhost:1234': 'lmstudio',
  'localhost:8080': 'localai',
};

export function classifyProvider(input) {
  const url = input.baseUrl || input.url || '';
  if (!url && input.name) {
    const lower = input.name.toLowerCase();
    if (lower.includes('ollama')) return { kind: 'ollama' };
    if (lower.includes('lmstudio') || lower.includes('lm studio')) return { kind: 'lmstudio' };
    if (lower.includes('localai') || lower.includes('local ai')) return { kind: 'localai' };
  }
  try {
    const host = new URL(url).host;
    for (const [pattern, kind] of Object.entries(PROVIDER_HOST_MAP)) {
      if (host === pattern || host.endsWith('.' + pattern)) return { kind };
    }
    if (host.includes('opencode.ai')) {
      const path = new URL(url).pathname;
      if (path.includes('/go')) return { kind: 'opencodego' };
      return { kind: 'opencodezen' };
    }
  } catch {}
  return { kind: 'unknown' };
}

export function parseProviderConfig(raw) {
  const baseUrl = (raw.baseUrl || raw.url || '').replace(/\/+$/, '');
  const apiKey = raw.apiKey || raw.key || '';
  const model = raw.model || '';
  const { kind } = classifyProvider({ baseUrl });
  return { baseUrl, apiKey, model, kind };
}

export function listActiveProviders(config) {
  const active = [];
  for (const [id, entry] of Object.entries(config)) {
    if (!entry || !entry.enabled) continue;
    const def = PROVIDER_DEFS[id];
    if (def && !def.needsKey) {
      active.push({ id, ...entry });
      continue;
    }
    if (entry.key && entry.key.trim()) {
      active.push({ id, ...entry });
    }
  }
  return active;
}

export const PROVIDER_DEFS = {
  openai: { kind: 'openai', needsKey: true, baseUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o' },
  deepseek: { kind: 'deepseek', needsKey: true, baseUrl: 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat' },
  mistral: { kind: 'mistral', needsKey: true, baseUrl: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-large-latest' },
  anthropic: { kind: 'anthropic', needsKey: true, baseUrl: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-sonnet-4-6' },
  gemini: { kind: 'gemini', needsKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash' },
  grok: { kind: 'grok', needsKey: true, baseUrl: 'https://api.x.ai/v1/chat/completions', defaultModel: 'grok-4.3' },
  openrouter: { kind: 'openrouter', needsKey: true, baseUrl: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openai/gpt-4o' },
  opencodezen: { kind: 'opencodezen', needsKey: true, baseUrl: 'https://opencode.ai/zen/v1/chat/completions', defaultModel: 'big-pickle' },
  opencodego: { kind: 'opencodego', needsKey: true, baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions', defaultModel: 'deepseek-v4-flash' },
  custom: { kind: 'custom', needsKey: true, baseUrl: 'https://api.example.com/v1/chat/completions', defaultModel: 'custom-model' },
  ollama: { kind: 'ollama', needsKey: false, baseUrl: 'http://localhost:11434', defaultModel: 'qwen2.5-coder' },
  lmstudio: { kind: 'lmstudio', needsKey: false, baseUrl: 'http://localhost:1234', defaultModel: 'local-model' },
  localai: { kind: 'localai', needsKey: false, baseUrl: 'http://localhost:8080', defaultModel: 'local-model' },
};

const aiProviders = { PROVIDER_DEFS, classifyProvider, parseProviderConfig, listActiveProviders };
export default aiProviders;

if (typeof window !== 'undefined') {
  window.__aiProviders = aiProviders;
}
