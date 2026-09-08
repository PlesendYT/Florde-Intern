const STRATEGIES = {
  're-evaluate': {
    name: 'Re-evaluate',
    prompt: 'Re-evaluate the original task and determine why the previous approach has failed. Do NOT make any changes. Only analyze and report.',
    description: 'Re-analyze the goal and failed approach',
  },
  'inspect-failure': {
    name: 'Inspect Failure',
    prompt: 'Do NOT modify any code. Examine the current error in detail. Read the failing tests, read the relevant source files, and report what you find. Focus on understanding the root cause.',
    description: 'Examine error without changing code',
  },
  'review-changes': {
    name: 'Review Changes',
    prompt: 'Review your recent changes. Read the files you modified. Are the changes correct? What might be wrong? Compare with the original error and report your findings.',
    description: 'Review recent modifications for correctness',
  },
  'alternative': {
    name: 'Alternative Approach',
    prompt: 'The current strategy is not working. Choose a fundamentally different approach to solve this problem. Do NOT repeat the same type of fix. Consider: different files, different patterns, different tools.',
    description: 'Choose a completely different strategy',
  },
  'sub-agent': {
    name: 'Sub-Agent Review',
    prompt: 'This strategy delegates to a sub-agent (handled externally).',
    description: 'Delegate analysis to another agent',
  },
};

class RecoveryManager {
  constructor() {
    this._recoveryAttempts = 0;
    this._maxAttempts = 3;
    this._lastStrategy = null;
    this._autoRecoveryEnabled = true;
    this._recoveryDelay = 120000;
    this._autoRecoveryTimer = null;
    this._recoveryHistory = [];
    this._load();
  }

  _save() {
    // Security (b-22): merge instead of replace — the settings UI stores
    // sibling loopDetection fields (enabled, sensitivity, ...) that must survive.
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    settings.loopDetection = {
      ...(settings.loopDetection || {}),
      recoveryAttempts: this._recoveryAttempts,
      maxAttempts: this._maxAttempts,
      lastStrategy: this._lastStrategy,
      autoRecoveryEnabled: this._autoRecoveryEnabled,
      recoveryDelay: this._recoveryDelay,
      recoveryHistory: this._recoveryHistory,
    };
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  }

  _load() {
    try {
      const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
      const ld = settings.loopDetection;
      if (!ld) return;
      this._recoveryAttempts = ld.recoveryAttempts ?? 0;
      this._maxAttempts = ld.maxAttempts ?? 3;
      this._lastStrategy = ld.lastStrategy ?? null;
      this._autoRecoveryEnabled = ld.autoRecoveryEnabled ?? true;
      this._recoveryDelay = ld.recoveryDelay ?? 120000;
      this._recoveryHistory = ld.recoveryHistory ?? [];
    } catch { /* ignore corrupt settings */ }
  }

  attemptRecovery(loopAnalysis, loopDetector) {
    this._recoveryAttempts++;
    if (this._recoveryAttempts >= this._maxAttempts) {
      return { critical: true };
    }

    const strategyKey = this._selectStrategy(loopAnalysis);
    this._lastStrategy = strategyKey;
    this._recoveryHistory.push({
      strategy: strategyKey,
      timestamp: Date.now(),
      attempt: this._recoveryAttempts,
      analysisType: loopAnalysis?.type,
      successful: false, // will be updated on success
    });
    // Keep only last 20 recovery history entries
    if (this._recoveryHistory.length > 20) this._recoveryHistory = this._recoveryHistory.slice(-20);
    this._save();

    return {
      strategy: strategyKey,
      prompt: STRATEGIES[strategyKey].prompt,
      attempt: this._recoveryAttempts,
      maxAttempts: this._maxAttempts,
    };
  }

  _selectStrategy(analysis) {
  const type = analysis?.type;
  
  // Strategy preferences by loop type (ordered by effectiveness)
  const preferred = {
    error_loop: ['inspect-failure', 're-evaluate', 'alternative', 'review-changes'],
    exact_loop: ['alternative', 're-evaluate', 'review-changes', 'inspect-failure'],
    revert_loop: ['review-changes', 're-evaluate', 'alternative', 'inspect-failure'],
    context_loop: ['re-evaluate', 'inspect-failure', 'alternative', 'review-changes'],
    rabbit_hole: ['re-evaluate', 'alternative', 'inspect-failure', 'review-changes'],
  };
  
  // Check recovery history to learn which strategies worked
  const successfulStrategies = this._recoveryHistory
    .filter(h => h.successful)
    .map(h => h.strategy);
  
  const candidates = preferred[type] || ['re-evaluate', 'inspect-failure', 'alternative'];
  
  // Prefer strategies that worked before for this loop type
  for (const key of candidates) {
    if (successfulStrategies.includes(key) && key !== this._lastStrategy && STRATEGIES[key]) {
      return key;
    }
  }
  
  // Then try candidates that haven't been used
  for (const key of candidates) {
    if (key !== this._lastStrategy && STRATEGIES[key]) return key;
  }
  
  // Fallback
  if (this._lastStrategy !== 'sub-agent' && STRATEGIES['sub-agent']) return 'sub-agent';
  for (const key of Object.keys(STRATEGIES)) {
    if (key !== this._lastStrategy) return key;
  }
  return candidates[0];
}

  checkRecoveryProgress(metricsBefore, metricsAfter) {
    if (!metricsBefore || !metricsAfter) return { success: false, reason: 'Missing metrics data' };

    if (metricsAfter.testsFailed < metricsBefore.testsFailed) {
      return { success: true, reason: `Tests failed decreased from ${metricsBefore.testsFailed} to ${metricsAfter.testsFailed}` };
    }
    if (metricsBefore.buildSuccess === false && metricsAfter.buildSuccess === true) {
      return { success: true, reason: 'Build changed from failing to passing' };
    }
    if (metricsBefore.errorFingerprint && metricsAfter.errorFingerprint && metricsBefore.errorFingerprint !== metricsAfter.errorFingerprint) {
      return { success: true, reason: 'Error fingerprint changed' };
    }
    return { success: false, reason: 'No measurable progress detected' };
  }

  resetCounter() {
    this._recoveryAttempts = 0;
    this._lastStrategy = null;
    this._save();
  }

  scheduleAutoRecovery(loopDetector, analysis) {
    if (!this._autoRecoveryEnabled) return false;
    this.cancelAutoRecovery();
    this._autoRecoveryTimer = setTimeout(() => {
      if (!loopDetector) return;
      this.attemptRecovery(analysis, loopDetector);
      if (typeof loopDetector.injectRecoveryPrompt === 'function') {
        loopDetector.injectRecoveryPrompt();
      }
    }, this._recoveryDelay);
    return true;
  }

  cancelAutoRecovery() {
    if (this._autoRecoveryTimer !== null) {
      clearTimeout(this._autoRecoveryTimer);
      this._autoRecoveryTimer = null;
    }
  }

  getRecoveryHistory() {
    return [...this._recoveryHistory];
  }

  getStatus() {
    return {
      attempts: this._recoveryAttempts,
      maxAttempts: this._maxAttempts,
      lastStrategy: this._lastStrategy,
      autoRecovery: this._autoRecoveryEnabled,
    };
  }

  configure(options) {
    if (options.autoRecovery !== undefined) this._autoRecoveryEnabled = options.autoRecovery;
    if (options.recoveryDelay !== undefined) this._recoveryDelay = options.recoveryDelay;
    if (options.maxAttempts !== undefined) this._maxAttempts = options.maxAttempts;
    this._save();
  }

  getStrategies() {
    return STRATEGIES;
  }
}

window.RecoveryManager = RecoveryManager;
