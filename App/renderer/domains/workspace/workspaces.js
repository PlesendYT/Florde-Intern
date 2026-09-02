export function createWorkspaces() {
  let _workspaces = [];
  let _activeWorkspaceId = null;
  let _seq = 0;

  function seed(saved) {
    _workspaces = (saved && saved.workspaces) || [];
    if (_workspaces.length === 0) {
      _workspaces.push({ id: 'default', name: 'Default', path: null });
    }
    _activeWorkspaceId = _workspaces[0].id;
  }

  function getActive() {
    if (_activeWorkspaceId === null) return null;
    return _workspaces.find(w => w.id === _activeWorkspaceId) || null;
  }

  function getExistingByPath(path) {
    return _workspaces.find(w => w.path === path);
  }

  function newWorkspace(path, name) {
    const id = 'ws-' + Date.now() + '-' + (_seq++);
    const displayName = name || path.split(/[/\\]/).pop();
    _workspaces.push({ id, name: displayName, path });
    _activeWorkspaceId = id;
    return id;
  }

  function setActive(id) {
    if (!_workspaces.find(w => w.id === id)) return false;
    _activeWorkspaceId = id;
    return true;
  }

  function closeWorkspace(id) {
    if (_workspaces.length <= 1) return null;
    const idx = _workspaces.findIndex(w => w.id === id);
    if (idx === -1) return null;
    _workspaces = _workspaces.filter(w => w.id !== id);
    if (_activeWorkspaceId === id) {
      const next = _workspaces[Math.min(idx, _workspaces.length - 1)];
      _activeWorkspaceId = next.id;
      return next.id;
    }
    return _activeWorkspaceId;
  }

  const instance = {
    seed,
    getActive,
    getExistingByPath,
    newWorkspace,
    setActive,
    closeWorkspace,
    get workspaces() { return [..._workspaces]; },
    get activeWorkspaceId() { return _activeWorkspaceId; },
    get size() { return _workspaces.length; },
  };

  return instance;
}

if (typeof window !== 'undefined') {
  window.__workspaces = { createWorkspaces };
}

export default { createWorkspaces };
