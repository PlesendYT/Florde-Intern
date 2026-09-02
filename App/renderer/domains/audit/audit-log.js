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
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type: entry.type || 'unknown',
      action: entry.action || '',
      status: entry.status || 'auto',
      summary: entry.summary || '',
      details: entry.details || {},
      source: entry.source || 'KI',
      project: _currentProject,
      sessionId: entry.sessionId || null
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
