class LoopDetector {
  constructor(agentId, sensitivity = 'balanced') {
    this.agentId = agentId;
    this._sensitivity = sensitivity;
    this._history = [];
    this._loopHistory = [];
    this._fileStateHistory = new Map();
    this._preCompactionActions = [];
    this._postCompactionActions = [];
    this._inPostCompaction = false;
    this._taskContext = null;
    this._taskGoal = null;
    this._metrics = {
      testsFailed: 0,
      testsPassed: 0,
      buildSuccess: 0,
      lintErrors: 0,
      typeErrors: 0,
      filesChanged: [],
      errorFingerprint: null,
      toolFailureRate: 0,
    };
  }

  setTaskGoal(goal) {
    this._taskGoal = goal;
    const filePattern = /[\w/.-]+\.\w{1,5}/g;
    const files = (goal.match(filePattern) || []).map(f => f.split('/').pop());

    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'fix', 'the']);
    const words = goal.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

    this._taskContext = { goal, relevantFiles: files, relevantKeywords: words };
  }

  recordAction(event) {
    const entry = { ...event, agentId: event.agentId || this.agentId };
    this._history.push(entry);
    if (this._history.length > 50) this._history.shift();
    this._updateMetrics(entry);
    if (event.type === 'file_edit' && event.file && event.resultHash) {
      const history = this._fileStateHistory.get(event.file) || [];
      history.push(event.resultHash);
      if (history.length > 20) history.shift();
      this._fileStateHistory.set(event.file, history);
    }
    if (event.type === 'system' && event.result && /\[Summary\]|context compacted|compaction/i.test(event.result)) {
      this._preCompactionActions = [...this._postCompactionActions, ...this._history.slice(-10)];
      this._postCompactionActions = [];
      this._inPostCompaction = true;
    }
    if (this._inPostCompaction) {
      this._postCompactionActions.push(event);
    }
  }

  _fingerprintTool(name, args, result) {
    return `${name}:${JSON.stringify(args).slice(0, 100)}`;
  }

  _fingerprintError(result) {
    if (!result || typeof result !== 'string') return 'Unknown::NoResult';
    const typeMatch = result.match(/^(\w*(?:Error|Exception|Fault|Failure))\b/m);
    const errorType = typeMatch ? typeMatch[1] : 'Error';
    const fileMatch = result.match(/(?:at|in|from|file|source):\s*(\S+\.\w+)/i);
    const file = fileMatch ? fileMatch[1].split('/').pop().split(':').shift() : 'Unknown';
    let message = result.split('\n')[0] || '';
    message = message
      .replace(/^\w*(?:Error|Exception|Fault|Failure):\s*/i, '')
      .replace(/\b\d+\b/g, '<N>')
      .replace(/['"`]\w+['"`]/g, '<VAR>')
      .replace(/\/[\w/.-]+\.\w+/g, '<PATH>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return `${errorType}::${message}::${file}`;
  }

  _fingerprintResult(result) {
    if (!result || typeof result !== 'string') return 0;
    let hash = 0;
    for (let i = 0; i < result.length; i++) {
      hash = ((hash << 5) - hash + result.charCodeAt(i)) | 0;
    }
    return hash;
  }

  _parseTestResults(result) {
    if (!result || typeof result !== 'string') return null;
    const passed = result.match(/(\d+)\s*(?:tests?\s*)?(?:passed|pass(?:ing)?|success)/i);
    const failed = result.match(/(\d+)\s*(?:tests?\s*)?(?:failed|fail(?:ing)?)/i);
    const summary = result.match(/Tests:\s*(\d+)\s*failed[,\s]*(\d+)\s*passed/i);
    if (summary) return { testsFailed: +summary[1], testsPassed: +summary[2] };
    return {
      testsPassed: passed ? +passed[1] : null,
      testsFailed: failed ? +failed[1] : null,
    };
  }

  _parseBuildResult(result) {
    if (!result || typeof result !== 'string') return null;
    if (/\bbuild\s+(?:succeeded|success|completed)\b/i.test(result)) return true;
    if (/\bbuild\s+(?:failed|failure|error)\b/i.test(result)) return false;
    if (/\bcompilation\s+(?:error|failed)\b/i.test(result)) return false;
    if (/\bno\s+errors?\b/i.test(result) && /\bsuccess/i.test(result)) return true;
    return null;
  }

  _updateMetrics(event) {
    if (event.type === 'test' && event.result) {
      const parsed = this._parseTestResults(event.result);
      if (parsed) {
        if (parsed.testsFailed !== null) this._metrics.testsFailed = parsed.testsFailed;
        if (parsed.testsPassed !== null) this._metrics.testsPassed = parsed.testsPassed;
      }
    }
    if (event.type === 'build' && event.result) {
      const buildOk = this._parseBuildResult(event.result);
      // Security (b-26): success streak — failures reset it, otherwise the
      // metric only grows and error escalation never reflects recovery.
      if (buildOk !== null) this._metrics.buildSuccess = buildOk ? this._metrics.buildSuccess + 1 : 0;
    }
    if (event.type === 'tool_call' || event.type === 'command') {
      const tools = this._history.filter(e => e.type === 'tool_call' || e.type === 'command');
      const failed = tools.filter(e => e.success === false).length;
      this._metrics.toolFailureRate = tools.length ? failed / tools.length : 0;
    }
    if (event.errorFingerprint) this._metrics.errorFingerprint = event.errorFingerprint;
    if (event.type === 'file_edit' && event.filesChanged) {
      this._metrics.filesChanged.push(...event.filesChanged);
      if (this._metrics.filesChanged.length > 50) this._metrics.filesChanged = this._metrics.filesChanged.slice(-50);
    }
  }

  _inferActionType(toolName) {
    const map = {
      exec_command: 'command',
      run_command: 'command',
      shell: 'command',
      terminal: 'command',
      read_file: 'file_read',
      read_files: 'file_read',
      edit_file: 'file_edit',
      write_file: 'file_edit',
      create_file: 'file_edit',
      search: 'search',
      grep: 'search',
      find: 'search',
      browser: 'browser',
      web_search: 'browser',
      mcp_call: 'mcp_call',
      subagent_call: 'subagent_call',
      spawn_agent: 'subagent_call',
      build: 'build',
      compile: 'build',
      test: 'test',
      run_tests: 'test',
      git: 'git',
      git_commit: 'git',
      git_push: 'git',
    };
    return map[toolName] || 'tool_call';
  }

  _detectExactLoop() {
    const recent = this._history.slice(-10);
    if (recent.length < 3) return 0;
    const threshold = this._sensitivity === 'conservative' ? 4 : this._sensitivity === 'aggressive' ? 2 : 3;
    const sigs = recent.map(e => this._fingerprintTool(e.tool || '', e.args || {}, e.result || ''));
    const last5 = sigs.slice(-5);
    const uniqueLast5 = new Set(last5);
    if (uniqueLast5.size <= 2 && last5.length >= 5) return 0.2;
    const freq = {};
    for (const s of sigs) freq[s] = (freq[s] || 0) + 1;
    const maxRepeat = Math.max(...Object.values(freq));
    if (maxRepeat >= threshold) return Math.min(0.2, (maxRepeat - threshold + 1) * 0.05);
    return 0;
  }

  _detectErrorLoop() {
    const recent = this._history.slice(-10);
    if (recent.length < 3) return 0;
    const threshold = this._sensitivity === 'conservative' ? 4 : this._sensitivity === 'aggressive' ? 2 : 3;
    const errored = recent.filter(e => e.errorFingerprint);
    if (errored.length < threshold) return 0;
    const freq = {};
    for (const e of errored) freq[e.errorFingerprint] = (freq[e.errorFingerprint] || 0) + 1;
    let best = 0;
    for (const [, count] of Object.entries(freq)) {
      if (count >= threshold) {
        // Security (b-26): no prevMetrics gate (it suppressed every repeat
        // after the first) and no 0.25 cap — sustained identical failures
        // must be able to escalate the score toward critical.
        best = Math.max(best, Math.min(1, count * 0.12));
      }
    }
    return best;
  }

  // Security (b-26): consecutive identical failures escalate regardless of
  // the weighted score — 8+ confirm, 15+ critical.
  _consecutiveErrorCount() {
    let count = 0;
    let fp = null;
    for (let i = this._history.length - 1; i >= 0; i--) {
      const e = this._history[i];
      if (!e.errorFingerprint) break;
      if (fp === null) fp = e.errorFingerprint;
      if (e.errorFingerprint !== fp) break;
      count++;
    }
    return count;
  }

  _detectRevertLoop() {
    const recentEdits = this._history.filter(e => e.type === 'file_edit' && e.file);
    if (recentEdits.length < 4) return 0;

    let revertCount = 0;
    for (const edit of recentEdits) {
      const file = edit.file;
      const hash = edit.resultHash;
      if (!file || !hash) continue;

      const history = this._fileStateHistory.get(file) || [];
      const previousIndex = history.indexOf(hash);
      if (previousIndex >= 0 && history.length - previousIndex > 1) {
        revertCount++;
      }
      history.push(hash);
      if (history.length > 20) history.shift();
      this._fileStateHistory.set(file, history);
    }

    return Math.min(0.15, revertCount * 0.05);
  }

  _detectContextLoop() {
    if (this._preCompactionActions.length === 0 || this._postCompactionActions.length < 3) return 0;

    const preFiles = new Set(this._preCompactionActions.filter(e => e.file).map(e => e.file));
    const postFiles = new Set(this._postCompactionActions.filter(e => e.file).map(e => e.file));

    const overlap = [...preFiles].filter(f => postFiles.has(f)).length;
    const total = new Set([...preFiles, ...postFiles]).size;

    if (total === 0) return 0;
    const fileOverlap = overlap / total;

    const preErrors = this._preCompactionActions.filter(e => e.errorFingerprint).map(e => e.errorFingerprint);
    const postErrors = this._postCompactionActions.filter(e => e.errorFingerprint).map(e => e.errorFingerprint);
    const errorOverlap = preErrors.filter(e => postErrors.includes(e)).length > 0 ? 0.5 : 0;

    return Math.min(0.15, (fileOverlap * 0.1 + errorOverlap * 0.05));
  }

  _detectRabbitHole() {
    if (!this._taskContext || this._history.length < 8) return 0;

    const recent = this._history.slice(-15);

    let irrelevantCount = 0;
    for (const event of recent) {
      const relevance = this._computeTaskRelevance(event);
      if (relevance < 0.2) irrelevantCount++;
    }

    const irrelevantRatio = irrelevantCount / recent.length;

    const changedFiles = recent.filter(e => e.file).map(e => (e.file || '').split('/').pop());
    const relevantFilesChanged = changedFiles.filter(f =>
      this._taskContext.relevantFiles.some(rf => f.includes(rf) || rf.includes(f))
    ).length;

    const fileRelevance = changedFiles.length > 0 ? relevantFilesChanged / changedFiles.length : 1;

    const successes = recent.filter(e => e.success === true);
    const noMilestone = successes.length === 0 && recent.length > 10;

    const score = irrelevantRatio * 0.15 + (1 - fileRelevance) * 0.10 + (noMilestone ? 0.05 : 0);

    return Math.min(0.20, score);
  }

  _computeTaskRelevance(event) {
    if (!this._taskContext) return 0.5;

    let relevance = 0;
    const keywords = this._taskContext.relevantKeywords;
    const files = this._taskContext.relevantFiles;

    if (event.file) {
      const eventFile = event.file.split('/').pop();
      if (files.some(f => eventFile.includes(f) || f.includes(eventFile))) {
        relevance += 0.4;
      }
    }

    if (event.command) {
      const cmdLower = event.command.toLowerCase();
      for (const kw of keywords) {
        if (cmdLower.includes(kw)) { relevance += 0.1; break; }
      }
    }

    if (event.tool) {
      const toolLower = event.tool.toLowerCase();
      for (const kw of keywords) {
        if (toolLower.includes(kw)) { relevance += 0.1; break; }
      }
    }

    if (event.result) {
      const resultLower = event.result.toLowerCase();
      let keywordHits = 0;
      for (const kw of keywords) {
        if (resultLower.includes(kw)) keywordHits++;
      }
      relevance += Math.min(0.3, keywordHits * 0.05);
    }

    return Math.min(1, relevance);
  }

  _computeScore(signals) {
    const sensitivityMultipliers = {
      conservative: { threshold: 0.40, multiplier: 0.7 },
      balanced: { threshold: 0.30, multiplier: 1.0 },
      aggressive: { threshold: 0.20, multiplier: 1.3 },
    };

    const config = sensitivityMultipliers[this._sensitivity] || sensitivityMultipliers.balanced;

    const weights = {
      sameActions: 0.20,
      sameError: 0.25,
      noTestImprovement: 0.15,
      repeatedFileChanges: 0.10,
      revertBehavior: 0.15,
      contextRepetition: 0.15,
      goalDistanceIncrease: 0.20,
    };

    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      score += (signals[key] || 0) * weight;
    }

    score *= config.multiplier;
    return Math.max(0, Math.min(1, score));
  }

  _scoreToStatus(score) {
    const thresholds = {
      conservative: { possible: 0.40, confirmed: 0.60, critical: 0.85 },
      balanced: { possible: 0.30, confirmed: 0.50, critical: 0.75 },
      aggressive: { possible: 0.20, confirmed: 0.40, critical: 0.65 },
    };
    const t = thresholds[this._sensitivity] || thresholds.balanced;
    if (score >= t.critical) return 'critical';
    if (score >= t.confirmed) return 'confirmed';
    if (score >= t.possible) return 'possible';
    return 'normal';
  }

  analyze() {
    if (this._history.length < 5) return { score: 0, status: 'normal', type: null, details: {} };
    const sameActions = this._detectExactLoop();
    const sameError = this._detectErrorLoop();
    const recentEdits = this._history.filter(e => e.type === 'file_edit');
    const changedFiles = recentEdits.flatMap(e => e.filesChanged || []);
    const fileFreq = {};
    for (const f of changedFiles) fileFreq[f] = (fileFreq[f] || 0) + 1;
    const repeatedFileChanges = Math.min(1, Math.max(...Object.values(fileFreq), 0) / 5);
    const revertBehavior = this._detectRevertLoop();
    let noTestImprovement = 0;
    const tests = this._history.filter(e => e.type === 'test');
    if (tests.length >= 2) {
      const first = this._parseTestResults(tests[0].result);
      const last = this._parseTestResults(tests[tests.length - 1].result);
      if (first && last) {
        const firstFailed = first.testsFailed ?? 0;
        const lastFailed = last.testsFailed ?? 0;
        noTestImprovement = firstFailed > 0 && lastFailed >= firstFailed ? 1 : 0;
      }
    }
    const contextRepetition = this._detectContextLoop();
    const goalDistanceIncrease = this._detectRabbitHole();
    const signals = { sameActions, sameError, noTestImprovement, repeatedFileChanges, revertBehavior, contextRepetition, goalDistanceIncrease };
    const score = this._computeScore(signals);
    let status = this._scoreToStatus(score);
    // Security (b-26): escalation floor — sustained identical failures reach
    // confirmed/critical even if the weighted score lags behind.
    const consec = this._consecutiveErrorCount();
    if (consec >= 15 && (status === 'normal' || status === 'possible' || status === 'confirmed')) {
      status = 'critical';
    } else if (consec >= 8 && (status === 'normal' || status === 'possible')) {
      status = 'confirmed';
    }
    let type = null;
    if (sameActions > 0.15) type = 'exact_loop';
    else if (sameError > 0.2) type = 'error_loop';
    else if (revertBehavior > 0.3) type = 'revert_loop';
    else if (contextRepetition > 0.3) type = 'context_loop';
    else if (goalDistanceIncrease > 0.15) type = 'rabbit_hole';
    if (status !== 'normal') {
      this._loopHistory.push({
        timestamp: Date.now(),
        score,
        status,
        type,
        details: { signals, agentId: this.agentId },
      });
    }
    return { score, status, type, details: { signals } };
  }

  getStatus() {
    if (!this._loopHistory.length) return 'normal';
    const last = this._loopHistory[this._loopHistory.length - 1];
    return last.status;
  }

  getLoopHistory() {
    return [...this._loopHistory];
  }

  reset() {
    this._history = [];
    this._loopHistory = [];
    this._fileStateHistory = new Map();
    this._preCompactionActions = [];
    this._postCompactionActions = [];
    this._inPostCompaction = false;
    this._taskContext = null;
    this._taskGoal = null;
    this._metrics = {
      testsFailed: 0,
      testsPassed: 0,
      buildSuccess: 0,
      lintErrors: 0,
      typeErrors: 0,
      filesChanged: [],
      errorFingerprint: null,
      toolFailureRate: 0,
    };
  }

  resetMetrics() {
    this._metrics = {
      testsFailed: 0,
      testsPassed: 0,
      buildSuccess: 0,
      lintErrors: 0,
      typeErrors: 0,
      filesChanged: [],
      errorFingerprint: null,
      toolFailureRate: 0,
    };
  }
}

window.LoopDetector = LoopDetector;
