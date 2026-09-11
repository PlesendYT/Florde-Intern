const CHAT_PROVIDERS = [
  ['openai', 'OpenAI'],
  ['deepseek', 'DeepSeek'],
  ['mistral', 'Mistral'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Gemini'],
  ['grok', 'Grok'],
  ['opencodezen', 'OpenCode Zen'],
  ['opencodego', 'OpenCode Go'],
  ['ollama', 'Ollama'],
  ['lmstudio', 'LM Studio'],
  ['localai', 'LocalAI'],
  ['openrouter', 'OpenRouter'],
  ['custom', 'Custom'],
];

const CHAT_DEFAULT_MODELS = {
  openai: 'gpt-5.5',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-4.3',
  opencodezen: 'big-pickle',
  opencodego: 'deepseek-v4-flash',
  ollama: 'qwen2.5-coder',
  lmstudio: 'local-model',
  localai: 'local-model',
  openrouter: 'openai/gpt-4o',
  custom: 'custom-model',
};

function getLabel(pid) {
  const found = CHAT_PROVIDERS.find(([id]) => id === pid);
  return found ? found[1] : pid;
}

function getDefaultModel(pid) {
  return CHAT_DEFAULT_MODELS[pid] || 'unknown';
}

function buildProviderOptions(providers, routes, activeRouteId) {
  const out = [];
  const list = Array.isArray(routes) ? routes : [];
  for (const route of list) {
    if (!route || route.enabled === false) continue;
    if (!route.id) continue;
    out.push({
      value: 'route:' + route.id,
      label: (route.name || route.id) + ' (' + getLabel(route.provider) + ': ' + (route.model || getDefaultModel(route.provider)) + ')',
      disabled: false,
      selected: route.id === activeRouteId,
      isRoute: true,
    });
  }
  const store = providers && typeof providers === 'object' ? providers : {};
  for (const [pid, label] of CHAT_PROVIDERS) {
    const inst = store[pid];
    const configured = !!inst;
    const model = (inst && inst.model) || getDefaultModel(pid);
    out.push({
      value: pid,
      label: configured ? label + ' (' + model + ')' : label + ' (' + model + ') — setup needed',
      disabled: !configured,
      selected: false,
      isRoute: false,
    });
  }
  return out;
}

function buildModelOptions(providerId, catalog, currentModel, ollamaModels) {
  const seen = new Set();
  const out = [];
  const push = (value, selected) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label: value, selected: !!selected });
  };
  const cat = catalog && typeof catalog === 'object' ? (catalog[providerId] || []) : [];
  for (const m of cat) push(typeof m === 'string' ? m : (m && (m.name || m.model)) || '', m === currentModel);
  if (providerId === 'ollama' && Array.isArray(ollamaModels)) {
    for (const m of ollamaModels) {
      const name = typeof m === 'string' ? m : (m && (m.name || m.model)) || '';
      push(name, name === currentModel);
    }
  }
  const fallback = currentModel || getDefaultModel(providerId);
  push(fallback, true);
  if (!out.some(o => o.selected) && out.length > 0) out[0].selected = true;
  return out;
}

export { CHAT_PROVIDERS, CHAT_DEFAULT_MODELS, buildProviderOptions, buildModelOptions };
export default { CHAT_PROVIDERS, CHAT_DEFAULT_MODELS, buildProviderOptions, buildModelOptions };
if (typeof window !== 'undefined') window.__chatModelSelect = { CHAT_PROVIDERS, CHAT_DEFAULT_MODELS, buildProviderOptions, buildModelOptions };
