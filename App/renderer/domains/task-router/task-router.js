const ALL_PROVIDER_IDS = ['openai', 'deepseek', 'mistral', 'anthropic', 'gemini', 'grok', 'opencodezen', 'opencodego', 'openrouter', 'custom', 'ollama', 'lmstudio', 'localai'];

export function createTaskRouter(config) {
  const {
    taskModels,
    taskProviders,
    disabledTasks,
    meta,
    taskDefaults,
    providerFactory,
  } = config;

  function getMode() {
    return typeof config.getMode === 'function' ? config.getMode() : config.mode;
  }

  function getRoutes() {
    return typeof config.getRoutes === 'function' ? config.getRoutes() : (config.routes || []);
  }

  function getProviderStore() {
    return typeof config.getProviderStore === 'function' ? config.getProviderStore() : (config.providerStore || {});
  }

  function _getCapableModels(taskType) {
    const candidates = [];
    const seen = new Set();
    const routes = getRoutes();
    const store = getProviderStore();

    for (const route of routes) {
      if (!route.enabled) continue;
      const tasks = meta[route.model]?.tasks || taskDefaults;
      if (tasks[taskType]) {
        const key = route.provider + ':' + route.model;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ providerId: route.provider, model: route.model, source: 'route' });
        }
      }
    }

    for (const pid of ALL_PROVIDER_IDS) {
      if (store[pid] && store[pid].model) {
        const tasks = meta[store[pid].model]?.tasks || taskDefaults;
        if (tasks[taskType]) {
          const key = pid + ':' + store[pid].model;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ providerId: pid, model: store[pid].model, source: 'provider' });
          }
        }
      }
    }

    return candidates;
  }

  function _autoSelect(taskType) {
    const candidates = _getCapableModels(taskType);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const metaA = meta[a.model] || {};
      const metaB = meta[b.model] || {};
      if (metaA.free && !metaB.free) return -1;
      if (!metaA.free && metaB.free) return 1;
      return (metaA.costIn || 0) - (metaB.costIn || 0);
    });

    for (const candidate of candidates) {
      const prov = providerFactory(candidate.providerId, candidate.model);
      if (prov) {
        return { provider: prov, providerId: candidate.providerId, model: candidate.model, taskType };
      }
    }
    return null;
  }

  function getFallbackModel(taskType, excludeModel) {
    const candidates = _getCapableModels(taskType).filter(c => c.model !== excludeModel);
    if (candidates.length === 0) return null;

    const free = candidates.filter(c => meta[c.model]?.free);
    const pick = free.length > 0 ? free[0] : candidates[0];

    const prov = providerFactory(pick.providerId, pick.model);
    if (!prov) return null;
    return { provider: prov, providerId: pick.providerId, model: pick.model, taskType };
  }

  return {
    getModelForTask(taskType, attachedImages) {
      if (disabledTasks[taskType]) return null;

      if (attachedImages && attachedImages.length > 0) taskType = 'vision';

      if (getMode() === 'auto') {
        return _autoSelect(taskType);
      }

      const modelName = taskModels[taskType];
      const providerId = taskProviders[taskType];
      if (!modelName || !providerId) return null;

      const prov = providerFactory(providerId, modelName);
      if (!prov) return null;

      return { provider: prov, providerId, model: modelName, taskType };
    },

    _autoSelect,

    _getCapableModels,

    getFallbackModel,

    handleFailure(taskType, failedModel, error) {
      const isRateLimit = /429|rate.?limit/i.test(error?.message || '');
      const isCapability = /not.?support|cannot|doesn't/i.test(error?.message || '');

      if (isRateLimit) {
        const fallback = getFallbackModel(taskType, failedModel);
        if (fallback) {
          return {
            action: 'fallback',
            model: fallback.model,
            providerId: fallback.providerId,
            message: `Rate limited on ${failedModel}. Switching to ${fallback.model}.`
          };
        }
        return {
          action: 'disable',
          message: `Rate limited on ${failedModel} and no fallback available. ${taskType} is temporarily disabled.`
        };
      }

      if (isCapability) {
        const fallback = getFallbackModel(taskType, failedModel);
        if (fallback) {
          return {
            action: 'fallback',
            model: fallback.model,
            providerId: fallback.providerId,
            message: `${failedModel} doesn't support ${taskType}. Switching to ${fallback.model}.`
          };
        }
        return {
          action: 'disable',
          message: `${failedModel} doesn't support ${taskType} and no alternative available.`
        };
      }

      return { action: 'error', message: error?.message || 'Unknown error' };
    },
  };
}

export default createTaskRouter;

if (typeof window !== 'undefined') {
  window.__taskRouterCore = createTaskRouter;
}
