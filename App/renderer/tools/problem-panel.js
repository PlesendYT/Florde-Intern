const ProblemPanel = {
  _problems: [],

  init() {
    this._problems = [];
  },

  addProblem(msg, line, col) {
    this._problems.push({ msg, line, col });
    this._render();
  },

  clear() {
    this._problems = [];
    this._render();
  },

  _render() {
    let panel = document.getElementById('problem-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'problem-panel';
      panel.style.cssText = 'display:none;border-top:1px solid var(--border);max-height:150px;overflow-y:auto;font-size:0.8rem;padding:0.3rem 0.5rem;';
      const container = document.getElementById('editor-container');
      if (container && container.parentNode) {
        container.parentNode.insertBefore(panel, container.nextSibling);
      }
    }
    if (this._problems.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    let html = '';
    for (const p of this._problems) {
      html += '<div style="padding:2px 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text2);" data-line="' + p.line + '">';
      html += '<span style="color:var(--warning,#f59e0b);margin-right:6px;">&#9888;</span>';
      html += 'Line ' + p.line + (p.col ? ':' + p.col : '') + ': ' + this._escapeHtml(p.msg);
      html += '</div>';
    }
    panel.innerHTML = html;
    panel.querySelectorAll('div[data-line]').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg2)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        const line = parseInt(el.dataset.line);
        if (typeof editor !== 'undefined' && editor) {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: 1 });
          editor.focus();
        }
      });
    });
  },

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};
