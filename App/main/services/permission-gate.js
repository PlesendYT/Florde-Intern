// Main-seitiges Sicherheits-Gate für alle Sandbox-Aktionen.
// Werte jede Ausführung gegen SQLite-Permission-Regeln (Kategorien + Regex)
// sowie gegen eine eingebaute Risiko-Default-Tabelle aus.
const { assessCommandRisk } = require('./mainrisk');

function resolveToolCategory(op) {
  switch (op) {
    case 'read_file': return 'file-read';
    case 'write_file': return 'file-write';
    case 'delete_file': return 'file-delete';
    case 'list_files': return 'file-list';
    case 'vm_snapshot': return 'vm-snapshot';
    case 'vm_mouse': return 'vm-input';
    case 'vm_key': return 'vm-input';
    default: return op;
  }
}

function riskDefault(risk) {
  if (risk === 'critical' || risk === 'high') return 'ask';
  return 'allow';
}

// Liefert für einen exec-Befehl die zusätzlich zu prüfende Kategorie, die vom
// ersten Befehlswort abgeleitet wird (z. B. 'sudo ls' -> 'sudo'). Dadurch können
// Regeln direkt auf Kommando-Werkzeuge (tool_type 'sudo', 'apt-get', ...) gemünzt sein.
function execCommandKeyword(command) {
  if (typeof command !== 'string') return null;
  const tok = command.trim().split(/\s+/)[0];
  return tok && tok !== 'exec' ? tok : null;
}

class PermissionError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'PermissionError';
    this.permission = info;
  }
}

class PermissionGate {
  constructor({ store, askHandler } = {}) {
    if (!store) throw new Error('PermissionGate requires a store');
    this.store = store;
    this.askHandler = askHandler || null;
    // Security (F32): compile each distinct user regex once and bound the
    // tested input so a hostile pattern cannot burn CPU on every check.
    this._regexCache = new Map();
  }

  _rulesFor(project) {
    return this.store.getAllEffective(project);
  }

  _compileRegex(src) {
    if (this._regexCache.has(src)) return this._regexCache.get(src);
    // Reject patterns that invite catastrophic backtracking or are unbounded.
    if (typeof src !== 'string' || src.length === 0 || src.length > 300) {
      this._regexCache.set(src, null);
      return null;
    }
    // Strip escapes and character classes, then reject nested quantifiers
    // like (a+)+ / (.*)* / (\w+){1,10} — the classic ReDoS shape.
    const stripped = src.replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    if (/\([^()]*[+*][^()]*\)\s*(\+|\*|\{)/.test(stripped)) {
      this._regexCache.set(src, null);
      return null;
    }
    if (/\{\d+,\d*\}/.test(stripped) && /(\+|\*)/.test(stripped)) {
      this._regexCache.set(src, null);
      return null;
    }
    try {
      const re = new RegExp(src);
      this._regexCache.set(src, re);
      // Bound cache size so distinct hostile patterns cannot grow memory.
      if (this._regexCache.size > 200) {
        const first = this._regexCache.keys().next().value;
        this._regexCache.delete(first);
      }
      return re;
    } catch {
      this._regexCache.set(src, null);
      return null;
    }
  }

  _matchesRegex(rule, command) {
    if (command == null) return false;
    const p = rule.path || '';
    if (!p.startsWith('regex:')) return false;
    const src = p.substring('regex:'.length);
    const re = this._compileRegex(src);
    if (!re) return false;
    const input = String(command);
    if (input.length > 2000) return false;
    try {
      return re.test(input);
    } catch { return false; }
  }

  // Entweder entscheidet eine vorhandene Regel (zurück { decision }), oder null,
  // wenn für die Kategorie gar keine Regel relevant ist.
  _categoryDecision(category, rules, command, backend) {
    const regexRules = rules.filter(r => r.tool_type === category && (r.path || '').startsWith('regex:'));
    if (regexRules.length) {
      const match = regexRules.find(r => this._matchesRegex(r, command));
      if (match) return { decision: match.allowed ? 'allow' : 'block', source: 'regex', rule: match };
      // Kategorie hat Regex-Regeln (Whitelist), aber der Befehl matcht keine:
      // nur eine explizite Kategorie-/Backend-Regel kann dann noch greifen, sonst blocken.
      const catRule = rules.find(r => r.tool_type === category && (r.path === null || r.path === '' || r.path === undefined));
      if (catRule) return { decision: catRule.allowed ? 'allow' : 'block', source: 'category', rule: catRule };
      const backendRule = rules.find(r => r.tool_type === category && (r.path || '').startsWith('backend:') && r.path === ('backend:' + backend));
      if (backendRule) return { decision: backendRule.allowed ? 'allow' : 'block', source: 'backend', rule: backendRule };
      return { decision: 'block', source: 'regex-restricted' };
    }
    const catRule = rules.find(r => r.tool_type === category && (r.path === null || r.path === '' || r.path === undefined));
    if (catRule) return { decision: catRule.allowed ? 'allow' : 'block', source: 'category', rule: catRule };
    const backendRule = rules.find(r => r.tool_type === category && (r.path || '').startsWith('backend:') && r.path === ('backend:' + backend));
    if (backendRule) return { decision: backendRule.allowed ? 'allow' : 'block', source: 'backend', rule: backendRule };
    return null;
  }

  async _resolveDecision({ project, backend, op, command, path }) {
    const category = resolveToolCategory(op);
    const rules = this._rulesFor(project);

    const cands = [category];
    if (category === 'exec') {
      const kw = execCommandKeyword(command);
      if (kw) cands.push(kw);
    }
    for (const cand of cands) {
      const d = this._categoryDecision(cand, rules, command, backend);
      if (d) return { ...d, risk: assessCommandRisk(command || ''), category: cand };
    }

    // Security (b-09/b-10): high-capability ops ask by default even without
    // rules — interactive shells and weak-isolation switches must never be
    // silent. Explicit allow-rules still apply above.
    if (category === 'terminal') {
      return { decision: 'ask', source: 'op-default', risk: 'high', category };
    }
    if (category === 'switch_backend' && (command === 'none' || command === 'firejail')) {
      return { decision: 'ask', source: 'op-default', risk: 'high', category };
    }

    const risk = assessCommandRisk(command || '');
    return { decision: riskDefault(risk), source: 'risk-default', risk };
  }

  async evaluate({ project, backend, op, command, path, askHandler } = {}) {
    const base = await this._resolveDecision({ project, backend, op, command, path });
    if (base.decision !== 'ask') return base;
    const handler = askHandler || this.askHandler;
    if (!handler) return { ...base, source: 'ask' };
    const choice = await handler({ project, backend, op, command, path, risk: base.risk });
    const decision = (choice === 'allow' || choice === 'block') ? choice : base.decision;
    return { ...base, decision, source: decision === base.decision ? base.source : 'ask-handler' };
  }

  async checkAndRun({ project, backend, op, command, path, run, askHandler } = {}) {
    const decision = await this.evaluate({ project, backend, op, command, path, askHandler });
    if (decision.decision === 'block') {
      throw new PermissionError('blocked: permission not granted', decision);
    }
    if (decision.decision === 'ask') {
      throw new PermissionError('ask: user approval required', decision);
    }
    return run ? await run() : decision;
  }
}

module.exports = { PermissionGate, PermissionError, resolveToolCategory };
