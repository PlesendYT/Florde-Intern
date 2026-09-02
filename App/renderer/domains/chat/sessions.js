export function createChatSessions() {
  let _sessions = [];
  let _activeSessionId = null;
  let _nextId = 1;

  function newSession() {
    const id = _nextId++;
    const session = {
      id,
      name: `Chat ${_sessions.length + 1}`,
      messages: [],
      context: [],
      created: Date.now(),
    };
    _sessions.push(session);
    _activeSessionId = id;
    return id;
  }

  function getActive() {
    return _sessions.find(s => s.id === _activeSessionId) || null;
  }

  function addMessage(msg) {
    const s = getActive();
    if (s) s.messages.push(msg);
  }

  function switchSession(id) {
    if (id === _activeSessionId) return null;
    const s = _sessions.find(x => x.id === id);
    if (!s) return null;
    _activeSessionId = id;
    return s;
  }

  function closeSession(id) {
    if (_sessions.length <= 1) return false;
    const idx = _sessions.findIndex(s => s.id === id);
    if (idx === -1) return false;
    _sessions = _sessions.filter(s => s.id !== id);
    if (_activeSessionId === id) {
      const nextIdx = Math.min(idx, _sessions.length - 1);
      _activeSessionId = _sessions[nextIdx].id;
    }
    return true;
  }

  function renameSession(id, name) {
    const s = _sessions.find(s => s.id === id);
    if (s) s.name = name;
  }

  function reset() {
    _sessions = [];
    _nextId = 1;
  }

  return {
    get sessions() { return _sessions; },
    get activeSessionId() { return _activeSessionId; },
    get nextId() { return _nextId; },
    newSession,
    getActive,
    addMessage,
    switchSession,
    closeSession,
    renameSession,
    reset,
  };
}

if (typeof window !== 'undefined') {
  window.__chatSessions = { createChatSessions };
}

export default { createChatSessions };
