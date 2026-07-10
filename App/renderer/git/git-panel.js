const GitPanel = {
  init() {
    const refreshBtn = document.getElementById('btn-git-panel-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }
    const commitBtn = document.getElementById('btn-git-panel-commit');
    if (commitBtn) {
      commitBtn.addEventListener('click', async () => {
        if (typeof currentProject === 'undefined' || !currentProject) return;
        const projectRoot = await window.electronAPI.getProjectRoot(currentProject);
        if (!projectRoot) return;
        const status = await window.electronAPI.gitStatus(projectRoot);
        if (!status) { if (typeof logToTerminal !== 'undefined') logToTerminal('Not a git repository or no changes', 'warn'); return; }
        const diff = await window.electronAPI.gitDiff(projectRoot);
        document.getElementById('git-diff-preview').textContent = diff || 'No changes to commit';
        showModal('git-modal');
        document.getElementById('git-commit-name').focus();
      });
    }
    const branchesBtn = document.getElementById('btn-git-panel-branches');
    if (branchesBtn) {
      branchesBtn.addEventListener('click', async () => {
        if (typeof GitBranches !== 'undefined') GitBranches.list();
      });
    }
    const historyBtn = document.getElementById('btn-git-panel-history');
    if (historyBtn) {
      historyBtn.addEventListener('click', async () => {
        if (typeof GitHistory !== 'undefined') GitHistory.load();
      });
    }
    const syncBtn = document.getElementById('btn-git-panel-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        if (typeof GitGithub !== 'undefined') {
          await GitGithub.pull();
          await GitGithub.push();
        }
      });
    }
  },

  async refresh() {
    const branchEl = document.querySelector('.git-branch-name');
    const countEl = document.querySelector('.git-changes-count');
    const listEl = document.getElementById('git-changes-list');
    if (typeof currentProject === 'undefined' || !currentProject) {
      if (branchEl) branchEl.textContent = 'No project';
      if (countEl) countEl.textContent = '';
      if (listEl) listEl.innerHTML = '';
      return;
    }
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) {
        if (branchEl) branchEl.textContent = 'Not a repo';
        if (countEl) countEl.textContent = '';
        if (listEl) listEl.innerHTML = '';
        return;
      }
      const branches = await window.electronAPI.gitBranchList(root);
      if (branchEl) branchEl.textContent = branches.current || 'detached';
      const status = await window.electronAPI.gitStatus(root);
      const changes = (status || '').split('\n').filter(Boolean);
      if (countEl) countEl.textContent = changes.length + ' change' + (changes.length !== 1 ? 's' : '');
      if (listEl) {
        listEl.innerHTML = '';
        for (const line of changes) {
          const code = line.substring(0, 2).trim();
          const file = line.substring(3);
          const div = document.createElement('div');
          div.className = 'git-change-item';
          div.style.cssText = 'padding:2px 8px;font-size:0.8rem;cursor:pointer;display:flex;gap:6px;';
          const labels = { M: 'M', A: 'A', D: 'D', '??': 'U', R: 'R', C: 'C' };
          const colors = { M: 'var(--accent,#6366f1)', A: 'var(--success,#22c55e)', D: 'var(--error,#ef4444)', '??': 'var(--text3)', R: 'var(--warning,#f59e0b)', C: 'var(--warning,#f59e0b)' };
          div.innerHTML = '<span style="color:' + (colors[code] || 'var(--text3)') + ';width:16px;text-align:center;">' + (labels[code] || code) + '</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + file + '</span>';
          listEl.appendChild(div);
        }
      }
    } catch (e) {
      if (branchEl) branchEl.textContent = 'Error';
      if (countEl) countEl.textContent = '';
      if (listEl) listEl.innerHTML = '';
    }
  }
};
