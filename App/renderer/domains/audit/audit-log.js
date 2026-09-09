// Security (b-46): redacts secret-shaped values before audit persistence.
// Object keys matching secret names are masked; well-known token prefixes
// and Bearer/Basic credentials in free text are masked too.
const _SECRET_KEY_RE = /^(.*[_-]?(key|token|secret|passwd|password|auth|credential|api[_-]?key).*|authorization)$/i;
const _SECRET_VALUE_RES = [
  /\b(sk-[A-Za-z0-9_-]{8,}|oc-[A-Za-z0-9_-]{8,}|xox[bpas]-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{10,}|AKIA[A-Z0-9]{10,})/g,
  /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g,
];

function _scrubString(s) {
  if (typeof s !== 'string') return s;
  let out = s.length > 5000 ? s.slice(0, 5000) : s;
  for (const re of _SECRET_VALUE_RES) {
    re.lastIndex = 0;
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function _scrubSecrets(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return _scrubString(value);
  if (Array.isArray(value)) return value.slice(0, 200).map(v => _scrubSecrets(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 200)) {
      out[k] = _SECRET_KEY_RE.test(k) ? '[REDACTED]' : _scrubSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createAuditLog({ dbCheck, dbRun, dbQuery, storage, project }) {
  let _logs = [];
  let _currentProject = project || null;
  let _useDb = false;
  const _maxLogs = 500;

  async function _load() {
    _useDb = false;
    if (!_currentProject) return;
    try {
      const hasDb = await dbCheck(_currentProject);
      if (hasDb) {
        const rows = await dbQuery(_currentProject,
          'SELECT data FROM audit_log WHERE project = ? ORDER BY id DESC LIMIT ?',
          [_currentProject, _maxLogs]);
        if (rows && rows.length > 0) {
          _logs = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          _useDb = true;
          return;
        }
      }
    } catch {}
    try {
      const key = 'florde-audit-ki-' + _currentProject;
      _logs = JSON.parse(storage.getItem(key)) || [];
    } catch { _logs = []; }
  }

  function _save() {
    if (!_currentProject || _useDb) return;
    storage.setItem('florde-audit-ki-' + _currentProject, JSON.stringify(_logs));
  }

  function setProject(name) {
    _currentProject = name;
    return _load();
  }

  async function log(entry) {
    // Security (b-46): audit entries persist to SQLite/localStorage — scrub
    // anything secret-shaped so API keys never land in logs at rest.
    const clean = _scrubSecrets({
      type: entry.type || 'unknown',
      action: entry.action || '',
      status: entry.status || 'auto',
      summary: entry.summary || '',
      details: entry.details || {},
      source: entry.source || 'KI',
      sessionId: entry.sessionId || null,
    });
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...clean,
      project: _currentProject,
    };
    _logs.unshift(logEntry);
    if (_logs.length > _maxLogs) _logs.length = _maxLogs;
    if (_useDb) {
      try {
        await dbRun(_currentProject,
          `INSERT INTO audit_log (project, event_type, data) VALUES (?, ?, ?)`,
          [_currentProject, entry.type || 'unknown', JSON.stringify(logEntry)]);
      } catch {}
    }
    _save();
  }

  function getEntries() {
    return _logs;
  }

  function clear() {
    _logs = [];
  }

  function getMeta() {
    return { currentProject: _currentProject, useDb: _useDb, maxLogs: _maxLogs };
  }

  return { setProject, log, _load, _save, getEntries, clear, getMeta };
}

function _getCore() {
  if (typeof window !== 'undefined' && window.__auditLogCore) return window.__auditLogCore;
  return null;
}

export function logAudit(entry) {
  const core = _getCore();
  if (core) return core.log(entry);
}

export function getAuditEntries() {
  const core = _getCore();
  return core ? core.getEntries() : [];
}

export function clearAudit() {
  const core = _getCore();
  if (core) core.clear();
}

export default createAuditLog;

if (typeof window !== 'undefined') {
  if (!window.__auditLogCore) {
    window.__auditLogCore = createAuditLog({
      dbCheck: () => false,
      dbRun: () => {},
      dbQuery: () => null,
      storage: typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} },
      project: null
    });
  }
}
