export function mergeSettings(existing, patch) {
  return { ...(existing || {}), ...patch };
}

export const PROVIDER_IDS = ['openai','deepseek','mistral','anthropic','gemini','grok','opencodezen','opencodego','ollama','lmstudio','localai','openrouter','custom'];

export const LOCAL_PROVIDER_IDS = ['ollama', 'lmstudio', 'localai'];

export function buildProviderSettings({ providerIds, isEnabled, getVal, getTemp, isValidKey }) {
  const settings = {};
  for (const id of providerIds) {
    settings[id + 'Enabled'] = isEnabled(id);
    if (id === 'custom') {
      settings[id + 'Url'] = getVal(id, 'url');
      settings[id + 'Key'] = isValidKey(id) ? getVal(id, 'key') : '';
      settings[id + 'Model'] = getVal(id, 'model');
    } else if (LOCAL_PROVIDER_IDS.includes(id)) {
      settings[id + 'Url'] = getVal(id, 'url');
      settings[id + 'Model'] = getVal(id, 'model');
    } else {
      settings[id + 'Key'] = isValidKey(id) ? getVal(id, 'key') : '';
      settings[id + 'Model'] = getVal(id, 'model');
    }
    settings[id + 'Temp'] = getTemp(id);
  }
  return settings;
}

const api = { mergeSettings, PROVIDER_IDS, LOCAL_PROVIDER_IDS, buildProviderSettings };
if (typeof window !== 'undefined') window.__settings = api;
export default api;
