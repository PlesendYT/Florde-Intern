const DiffView = {
  _changes: [],

  addChange(filePath, oldContent, newContent) {
    const stats = this._computeStats(oldContent, newContent);
    this._changes.push({
      path: filePath,
      oldContent: oldContent || '',
      newContent: newContent || '',
      linesAdded: stats.linesAdded,
      linesRemoved: stats.linesRemoved
    });
  },

  _computeStats(oldText, newText) {
    if (typeof Diff === 'undefined') {
      const added = (newText || '').split('\n').length;
      const removed = (oldText || '').split('\n').length;
      return { linesAdded: added, linesRemoved: removed };
    }
    const changes = Diff.diffLines(oldText || '', newText || '');
    let linesAdded = 0, linesRemoved = 0;
    for (const c of changes) {
      if (c.added) linesAdded += c.count;
      if (c.removed) linesRemoved += c.count;
    }
    return { linesAdded, linesRemoved };
  },

  _computeDiff(oldText, newText) {
    if (typeof Diff === 'undefined') {
      const count = (newText || '').split('\n').length;
      return { changes: [{ added: true, value: newText || '', count }], linesAdded: count, linesRemoved: 0 };
    }
    const changes = Diff.diffLines(oldText || '', newText || '');
    let linesAdded = 0, linesRemoved = 0;
    for (const c of changes) {
      if (c.added) linesAdded += c.count;
      if (c.removed) linesRemoved += c.count;
    }
    return { changes, linesAdded, linesRemoved };
  },

  _renderFileDiff(path, oldText, newText) {
    const { changes, linesAdded, linesRemoved } = this._computeDiff(oldText, newText);
    let html = '';
    for (const c of changes) {
      if (c.added) {
        html += c.value.split('\n').slice(0, -1).map(l => `<div class="diff-chat-line added"><span class="diff-chat-prefix">+</span>${this._escapeHtml(l)}</div>`).join('');
      } else if (c.removed) {
        html += c.value.split('\n').slice(0, -1).map(l => `<div class="diff-chat-line removed"><span class="diff-chat-prefix">-</span>${this._escapeHtml(l)}</div>`).join('');
      } else {
        const lines = c.value.split('\n').slice(0, -1);
        if (lines.length > 6) {
          html += lines.slice(0, 3).map(l => `<div class="diff-chat-line context"><span class="diff-chat-prefix"> </span>${this._escapeHtml(l)}</div>`).join('');
          html += `<div class="diff-chat-ellipsis">...</div>`;
          html += lines.slice(-3).map(l => `<div class="diff-chat-line context"><span class="diff-chat-prefix"> </span>${this._escapeHtml(l)}</div>`).join('');
        } else {
          html += lines.map(l => `<div class="diff-chat-line context"><span class="diff-chat-prefix"> </span>${this._escapeHtml(l)}</div>`).join('');
        }
      }
    }
    const action = !oldText ? 'new' : 'edited';
    return `
      <div class="diff-chat-file" data-path="${this._escapeHtml(path)}">
        <div class="diff-chat-file-header" data-diff-toggle>
          <span class="diff-chat-file-icon">${action === 'new' ? '&#128196;' : '&#9998;'}</span>
          <span class="diff-chat-file-path">${this._escapeHtml(path)}</span>
          <span class="diff-chat-file-stats">+${linesAdded} -${linesRemoved}</span>
          <span class="diff-chat-toggle">&#9654;</span>
        </div>
        <div class="diff-chat-file-body">
          <div class="diff-chat-copy-bar">
            <button data-copy-diff>&#128203; Copy Diff</button>
          </div>
          <div class="diff-chat-file-content">${html}</div>
        </div>
      </div>`;
  },

  render() {
    // Security (b-38): render is pure — it snapshots instead of draining
    // this._changes. Call clear() explicitly when the section is consumed.
    const changes = [...(this._changes || [])];
    if (changes.length === 0) return '';
    let totalAdded = 0, totalRemoved = 0;
    for (const c of changes) {
      totalAdded += c.linesAdded || 0;
      totalRemoved += c.linesRemoved || 0;
    }
    let html = `<div class="diff-chat-section"><div class="diff-chat-summary">&#128193; ${changes.length} file(s) changed <span class="diff-chat-summary-stats">+${totalAdded} -${totalRemoved}</span></div>`;
    for (const c of changes) {
      html += this._renderFileDiff(c.path, c.oldContent, c.newContent);
    }
    html += `<div class="diff-chat-actions">
      <button data-copy-all="diff">&#128203; Copy All (Diff)</button>
      <button data-copy-all="full">&#128203; Copy All (Full)</button>
    </div>`;
    html += `</div>`;
    return html;
  },

  clear() {
    this._changes = [];
  },

  copyDiff(path) {
    const el = document.querySelector(`.diff-chat-file[data-path="${CSS.escape(path)}"]`);
    if (!el) return;
    const lines = el.querySelectorAll('.diff-chat-line');
    let text = '';
    lines.forEach(l => {
      const prefix = l.querySelector('.diff-chat-prefix');
      if (prefix) text += prefix.textContent + ' ' + l.textContent.substring(1) + '\n';
    });
    navigator.clipboard.writeText(text);
  },

  copyAll(mode) {
    const files = document.querySelectorAll('.diff-chat-file');
    let text = '';
    files.forEach(f => {
      const path = f.dataset.path;
      text += `=== ${path} ===\n`;
      if (mode === 'diff') {
        const lines = f.querySelectorAll('.diff-chat-line');
        lines.forEach(l => {
          const prefix = l.querySelector('.diff-chat-prefix');
          if (prefix) text += prefix.textContent + ' ' + l.textContent.substring(1) + '\n';
        });
      } else {
        const model = typeof editor !== 'undefined' && editor ? editor.getModel() : null;
        if (model && model.uri.path === path) text += model.getValue() + '\n';
      }
    });
    navigator.clipboard.writeText(text);
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// CSP (script-src 'self') forbids inline handlers — delegated clicks for
// DiffView-rendered HTML (path via closest .diff-chat-file dataset).
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[data-diff-toggle],[data-copy-diff],[data-copy-all]') : null;
  if (!t || typeof DiffView === 'undefined') return;
  if (t.hasAttribute('data-diff-toggle')) {
    const file = t.closest('.diff-chat-file');
    if (file) file.classList.toggle('expanded');
    return;
  }
  if (t.hasAttribute('data-copy-diff')) {
    const file = t.closest('.diff-chat-file');
    if (file) DiffView.copyDiff(file.dataset.path);
    return;
  }
  if (t.hasAttribute('data-copy-all')) DiffView.copyAll(t.dataset.copyAll);
});
