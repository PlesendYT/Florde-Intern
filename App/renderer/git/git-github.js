const GitGithub = {
  init() {},

  async push(remote, branch) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      return await window.electronAPI.gitPush(root, remote || 'origin', branch || undefined);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async pull(remote, branch) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      return await window.electronAPI.gitPull(root, remote || 'origin', branch || undefined);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async clone(url) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      if (typeof window.electronAPI.sandboxExec === 'function') {
        await window.electronAPI.sandboxExec(root, 'git clone ' + url);
      }
      if (typeof GitPanel !== 'undefined') GitPanel.refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};
