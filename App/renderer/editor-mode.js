// App/renderer/editor-mode.js
const EDITOR_MODE_KEY = 'florde-app-mode';

const EditorMode = {
  _store: (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null,
  _mode: null,
  onModeChange: null,

  getMode() {
    if (this._mode) return this._mode;
    if (this._store) {
      const stored = this._store.getItem(EDITOR_MODE_KEY);
      if (stored === 'chat' || stored === 'editor') return stored;
    }
    return 'chat';
  },

  setMode(mode) {
    if (mode !== 'chat' && mode !== 'editor') return this._mode || 'chat';
    this._mode = mode;
    if (this._store) this._store.setItem(EDITOR_MODE_KEY, mode);
    if (this.onModeChange) this.onModeChange(mode);
    return mode;
  },

  showSelectionMenu(selection, ctx) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('editor-action-menu');
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.id = 'editor-action-menu';
    menu.className = 'editor-action-menu hidden';
    menu.innerHTML =
      '<button class="eam-btn" data-action="whatis">Was ist das?</button>' +
      '<button class="eam-btn" data-action="explain">Erklären</button>' +
      '<button class="eam-btn" data-action="improve">Verbessern</button>' +
      '<button class="eam-btn" data-action="change">Ändern…</button>' +
      '<button class="eam-btn" data-action="refactor">Refactoring</button>';
    document.body.appendChild(menu);
    const pos = ctx && ctx.position ? ctx.position : { left: 0, top: 0 };
    menu.style.left = pos.left + 'px';
    menu.style.top = pos.top + 'px';
    menu.classList.remove('hidden');

    menu.querySelectorAll('.eam-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        menu.remove();
        if (this.onAction && ctx) this.onAction(action, ctx);
      });
    });
    return menu;
  },

  _buildPrompt(action, ctx) {
    const header = 'Datei: ' + ctx.fileName + '\nSprache: ' + (ctx.lang || 'unbekannt') + '\n\n';
    const fence = '```' + (ctx.lang || '') + '\n' + ctx.text + '\n```';
    switch (action) {
      case 'whatis':
        return header + 'Was ist das? Erkläre mir diesen Codeabschnitt kurz und verständlich auf Deutsch.\n\n' + fence;
      case 'explain':
        return header + 'Erkläre mir diesen Codeabschnitt ausführlich auf Deutsch.\n\n' + fence;
      case 'improve':
        return header + 'Verbessere diesen Codeabschnitt' +
          (ctx.goal ? ' (' + ctx.goal + ')' : '') +
          '. Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      case 'change':
        return header + 'Ändere diesen Codeabschnitt wie folgt: ' + (ctx.goal || '') +
          '. Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      case 'refactor':
        return header + 'Refactore diesen Codeabschnitt (Klarheit, DRY, kleine Funktionen). Gib das Ergebnis als vollständigen Dateiinhalt im Code-Block zurück.\n\n' + fence;
      default:
        return header + fence;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EditorMode };
}
