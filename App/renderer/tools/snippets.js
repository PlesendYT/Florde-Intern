const SnippetManager = {
  _snippets: [],

  init() {
    this._snippets = [];
    this.refresh();
  },

  refresh() {
    this._snippets = [];
    if (typeof editor === 'undefined' || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const content = model.getValue();
    const lines = content.split('\n');
    let inBlock = false;
    let startLine = 0;
    let blockContent = [];
    let lang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inBlock) {
        const openMatch = line.match(/```(\w*)/);
        if (openMatch) {
          inBlock = true;
          lang = openMatch[1] || '';
          startLine = i + 1;
          blockContent = [];
        }
      } else {
        if (line.trim() === '```') {
          this._snippets.push({
            language: lang,
            content: blockContent.join('\n'),
            startLine: startLine,
            endLine: i + 1,
          });
          inBlock = false;
        } else {
          blockContent.push(line);
        }
      }
    }
    this._render();
  },

  _render() {
    let sidebar = document.getElementById('snippets-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.id = 'snippets-sidebar';
      sidebar.style.cssText = 'display:none;padding:0.5rem;border-top:1px solid var(--border);max-height:200px;overflow-y:auto;font-size:0.8rem;';
      const container = document.getElementById('editor-container');
      if (container && container.parentNode) {
        container.parentNode.insertBefore(sidebar, container.nextSibling);
      }
    }
    if (this._snippets.length === 0) {
      sidebar.style.display = 'none';
      return;
    }
    sidebar.style.display = '';
    let html = '<div style="font-weight:600;color:var(--text2);margin-bottom:0.3rem;">Snippets</div>';
    for (let i = 0; i < this._snippets.length; i++) {
      const s = this._snippets[i];
      const preview = s.content.split('\n')[0].slice(0, 40);
      html += '<div class="snippet-item" data-index="' + i + '" style="cursor:pointer;padding:2px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text3);">';
      html += '<span style="color:var(--accent);">' + (s.language || 'code') + '</span> ';
      html += this._escapeHtml(preview) + (s.content.split('\n').length > 1 ? '...' : '');
      html += '</div>';
    }
    sidebar.innerHTML = html;
    sidebar.querySelectorAll('.snippet-item').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg2)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        const snippet = this._snippets[idx];
        if (snippet && typeof editor !== 'undefined' && editor) {
          editor.revealLineInCenter(snippet.startLine);
          editor.setPosition({ lineNumber: snippet.startLine, column: 1 });
          editor.focus();
        }
      });
    });
  },

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};
