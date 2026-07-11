const KeybindManager = {
  _bindings: null,

  init() {
    this._load();
    this._apply();
    document.addEventListener('keydown', (e) => this._handleKeydown(e));
  },

  _load() {
    try {
      const raw = localStorage.getItem('florde-keybindings');
      this._bindings = raw ? JSON.parse(raw) : null;
    } catch { this._bindings = null; }
  },

  _apply() {
  },

  _handleKeydown(e) {
    if (!this._bindings) return;
    const key = [];
    if (e.ctrlKey || e.metaKey) key.push('Ctrl');
    if (e.shiftKey) key.push('Shift');
    if (e.altKey) key.push('Alt');
    key.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    const combo = key.join('+');
    for (const b of this._bindings) {
      if (b.keys === combo) {
        if (typeof getShortcuts === 'function') {
          const sc = getShortcuts()[b.id];
          if (sc && sc.fn) { e.preventDefault(); sc.fn(); return; }
        }
        const cmd = COMMAND_REGISTRY[b.id];
        if (cmd) { e.preventDefault(); cmd.fn(); return; }
      }
    }
  },

  getBindings() { return this._bindings || []; },

  setBinding(id, keys) {
    if (!this._bindings) this._bindings = [];
    const existing = this._bindings.find(b => b.id === id);
    if (existing) existing.keys = keys;
    else this._bindings.push({ id, keys });
    localStorage.setItem('florde-keybindings', JSON.stringify(this._bindings));
  },

  resetBinding(id) {
    if (!this._bindings) return;
    this._bindings = this._bindings.filter(b => b.id !== id);
    localStorage.setItem('florde-keybindings', JSON.stringify(this._bindings));
  },

  resetAll() {
    this._bindings = [];
    localStorage.removeItem('florde-keybindings');
  }
};
