const GitBranches = {
  init() {},

  async list() {
    if (typeof currentProject === 'undefined' || !currentProject) return { local: [], remote: [], current: '' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { local: [], remote: [], current: '' };
      return await window.electronAPI.gitBranchList(root);
    } catch (e) {
      return { local: [], remote: [], current: '', error: e.message };
    }
  },

  async checkout(branch) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      const result = await window.electronAPI.gitCheckout(root, branch);
      if (typeof GitPanel !== 'undefined') GitPanel.refresh();
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async create(name) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      const result = await window.electronAPI.gitBranchCreate(root, name);
      if (typeof GitPanel !== 'undefined') GitPanel.refresh();
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async merge(branch) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      await window.electronAPI.gitCheckout(root, branch);
      await window.electronAPI.gitCheckout(root, '-');
      if (typeof GitPanel !== 'undefined') GitPanel.refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async deleteBranch(name) {
    if (typeof currentProject === 'undefined' || !currentProject) return { ok: false, error: 'No project open' };
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return { ok: false, error: 'No project root' };
      return await window.electronAPI.gitBranchDelete(root, name);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};
