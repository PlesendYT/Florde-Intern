const GitHistory = {
  _commits: [],

  init() {
    this._commits = [];
  },

  async load(limit) {
    if (typeof currentProject === 'undefined' || !currentProject) return [];
    try {
      const root = await window.electronAPI.getProjectRoot(currentProject);
      if (!root) return [];
      this._commits = await window.electronAPI.gitLog(root, limit || 50);
      this._render();
      return this._commits;
    } catch (e) {
      this._commits = [];
      return [];
    }
  },

  show(commitHash) {
    const commit = this._commits.find(c => c.hash === commitHash || c.shortHash === commitHash);
    if (commit) {
      if (typeof logToTerminal !== 'undefined') {
        logToTerminal('Commit: ' + commit.shortHash + ' - ' + commit.message + ' (' + commit.author + ', ' + commit.date + ')', 'info');
      }
    }
    return commit || null;
  },

  _render() {
    let panel = document.getElementById('git-history-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'git-history-panel';
      panel.style.cssText = 'display:none;border-top:1px solid var(--border);max-height:200px;overflow-y:auto;font-size:0.8rem;padding:0.3rem 0.5rem;';
      const gitChanges = document.getElementById('git-changes-list');
      if (gitChanges) gitChanges.parentNode.insertBefore(panel, gitChanges.nextSibling);
    }
    if (this._commits.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    let html = '<div style="font-weight:600;color:var(--text2);margin-bottom:0.3rem;">History</div>';
    for (const c of this._commits.slice(0, 30)) {
      html += '<div class="git-history-item" data-hash="' + c.hash + '" style="padding:2px 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text3);">';
      html += '<span style="color:var(--accent);">' + c.shortHash + '</span> ';
      html += this._escapeHtml(c.message.slice(0, 50));
      html += ' <span style="color:var(--text3);font-size:0.7rem;">' + c.date + '</span>';
      html += '</div>';
    }
    panel.innerHTML = html;
    panel.querySelectorAll('.git-history-item').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg2)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        this.show(el.dataset.hash);
      });
    });
  },

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};
