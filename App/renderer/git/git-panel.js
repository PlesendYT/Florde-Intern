const GitPanel = {
  _searchTimer: null,

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
    const graphBtn = document.getElementById('btn-git-panel-graph');
    if (graphBtn) {
      graphBtn.addEventListener('click', async () => {
        const graphEl = document.getElementById('git-graph');
        if (!graphEl) return;
        const isVisible = !graphEl.classList.contains('hidden');
        if (isVisible) {
          graphEl.classList.add('hidden');
        } else {
          if (typeof currentProject !== 'undefined' && currentProject) {
            const root = await window.electronAPI.getProjectRoot(currentProject);
            if (root && typeof GitGraph !== 'undefined') {
              GitGraph.refresh(root);
            }
          }
        }
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

    // Search commits
    const searchInput = document.getElementById('git-search-input');
    const searchMode = document.getElementById('git-search-mode');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this.searchCommits(searchInput.value.trim(), searchMode?.value || 'message');
        }, 350);
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

      // Refresh graph if visible
      const graphEl = document.getElementById('git-graph');
      if (graphEl && !graphEl.classList.contains('hidden') && typeof GitGraph !== 'undefined') {
        GitGraph.refresh(root);
      }
    } catch (e) {
      if (branchEl) branchEl.textContent = 'Error';
      if (countEl) countEl.textContent = '';
      if (listEl) listEl.innerHTML = '';
    }
  },

  async searchCommits(query, mode) {
    const listEl = document.getElementById('git-changes-list');
    if (!listEl) return;
    if (!query) {
      this.refresh();
      return;
    }
    if (typeof currentProject === 'undefined' || !currentProject) return;
    const root = await window.electronAPI.getProjectRoot(currentProject);
    if (!root) return;

    let args;
    switch (mode) {
      case 'message':
        args = ['log', '--all', '--oneline', '--format=%H|%s|%an|%ad', '--date=short', '--grep=' + query, '-50'];
        break;
      case 'author':
        args = ['log', '--all', '--oneline', '--format=%H|%s|%an|%ad', '--date=short', '--author=' + query, '-50'];
        break;
      case 'file':
        args = ['log', '--all', '--oneline', '--format=%H|%s|%an|%ad', '--date=short', '--', query, '-50'];
        break;
      case 'content':
        args = ['log', '--all', '--oneline', '--format=%H|%s|%an|%ad', '--date=short', '-S' + query, '-50'];
        break;
      default:
        args = ['log', '--all', '--oneline', '--format=%H|%s|%an|%ad', '--date=short', '--grep=' + query, '-50'];
    }

    const r = await window.electronAPI.gitExec(root, args);
    this._renderSearchResults(r.stdout || '');
  },

  _renderSearchResults(output) {
    const el = document.getElementById('git-changes-list');
    if (!el) return;
    if (!output.trim()) {
      el.innerHTML = '<div style="color:var(--text3);padding:0.5rem;">No results found</div>';
      return;
    }
    el.innerHTML = output.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('|');
      const hash = (parts[0] || '').trim();
      const msg = (parts[1] || '').trim();
      const author = (parts[2] || '').trim();
      const date = (parts[3] || '').trim();
      return '<div class="git-change-item" data-hash="' + hash + '" style="padding:2px 8px;font-size:0.8rem;cursor:pointer;display:flex;gap:6px;align-items:center;">' +
        '<span style="color:var(--accent,#6366f1);font-family:monospace;">' + hash.substring(0, 7) + '</span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + (msg || '').replace(/</g, '&lt;') + '</span>' +
        '<span style="color:var(--text3);font-size:0.7rem;white-space:nowrap;">' + author + '</span>' +
        '</div>';
    }).join('');
  }
};
