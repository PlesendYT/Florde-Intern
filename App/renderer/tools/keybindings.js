const KeybindManager = {
  _bindings: null,
  _applied: false,

  init() {
    this._load();
    this._apply();
  },

  _load() {
    try {
      const raw = localStorage.getItem('florde-keybindings');
      this._bindings = raw ? JSON.parse(raw) : null;
    } catch { this._bindings = null; }
  },

  // Security (b-42): _apply was dead code — it now attaches the single
  // global dispatcher (guarded against double-attach).
  _apply() {
    if (this._applied || typeof document === 'undefined') return;
    this._applied = true;
    document.addEventListener('keydown', (e) => this._handleKeydown(e));
  },

  _normalizeCombo(e) {
    const key = [];
    if (e.ctrlKey || e.metaKey) key.push('Ctrl');
    if (e.shiftKey) key.push('Shift');
    if (e.altKey) key.push('Alt');
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (typeof k === 'string' && k.length === 1) k = k.toUpperCase();
    key.push(k);
    return key.join('+');
  },

  _handleKeydown(e) {
    if (!this._bindings || !Array.isArray(this._bindings)) return;
    // Don't hijack typing in inputs/textareas (except Escape passthrough).
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const combo = this._normalizeCombo(e);
    for (const b of this._bindings) {
      if (b.keys === combo) {
        if (typeof getShortcuts === 'function') {
          const sc = getShortcuts()[b.id];
          if (sc && sc.fn) { e.preventDefault(); sc.fn(); return; }
        }
        const cmd = typeof COMMAND_REGISTRY !== 'undefined' && COMMAND_REGISTRY[b.id];
        if (cmd) { e.preventDefault(); cmd.fn(); return; }
      }
    }
  },

  getBindings() { return Array.isArray(this._bindings) ? [...this._bindings] : []; },

  // Security (b-42): conflict check — returns { ok, conflict? } so the UI can
  // warn instead of silently shadowing another binding.
  setBinding(id, keys) {
    if (typeof id !== 'string' || typeof keys !== 'string' || !id || !keys) {
      return { ok: false, error: 'invalid binding' };
    }
    if (!this._bindings) this._bindings = [];
    const clash = this._bindings.find(b => b.id !== id && b.keys === keys);
    if (clash) return { ok: false, conflict: clash.id };
    const existing = this._bindings.find(b => b.id === id);
    if (existing) existing.keys = keys;
    else this._bindings.push({ id, keys });
    try {
      localStorage.setItem('florde-keybindings', JSON.stringify(this._bindings));
    } catch {}
    return { ok: true };
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
