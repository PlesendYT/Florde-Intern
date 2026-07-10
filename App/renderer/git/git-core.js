const GitCore = {
  init() {},

  async _root() {
    if (typeof currentProject === 'undefined' || !currentProject) return null;
    return await window.electronAPI.getProjectRoot(currentProject);
  },

  async status() {
    const root = await this._root();
    if (!root) return { changes: [], branch: '' };
    try {
      const raw = await window.electronAPI.gitStatus(root);
      const changes = (raw || '').split('\n').filter(Boolean).map(line => {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3);
        return { status, file };
      });
      const branches = await window.electronAPI.gitBranchList(root);
      return { changes, branch: branches.current || '' };
    } catch (e) {
      return { changes: [], branch: '', error: e.message };
    }
  },

  async add(file) {
    const root = await this._root();
    if (!root) return { ok: false, error: 'No project open' };
    try {
      await window.electronAPI.gitCommit(root, 'git add ' + file, '');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async commit(name, description) {
    const root = await this._root();
    if (!root) return { ok: false, error: 'No project open' };
    try {
      return await window.electronAPI.gitCommit(root, name, description || '');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async log(limit) {
    const root = await this._root();
    if (!root) return [];
    try {
      return await window.electronAPI.gitLog(root, limit || 50);
    } catch (e) {
      return [];
    }
  },

  async diff() {
    const root = await this._root();
    if (!root) return '';
    try {
      return await window.electronAPI.gitDiff(root);
    } catch (e) {
      return '';
    }
  },

  async diffFile(filePath) {
    const root = await this._root();
    if (!root) return '';
    try {
      return await window.electronAPI.gitDiffFile(root, filePath);
    } catch (e) {
      return '';
    }
  }
};
