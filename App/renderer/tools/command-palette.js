const CommandPalette = {
  _overlay: null,
  _input: null,
  _list: null,

  init() {
    this._overlay = document.createElement('div');
    this._overlay.className = 'modal-overlay';
    this._overlay.id = 'command-palette-overlay';
    this._overlay.style.display = 'none';
    this._overlay.innerHTML = '<div class="modal-content" style="max-width:500px;padding:1rem;"><input type="text" id="cmd-palette-input" placeholder="Type a command..." style="width:100%;padding:0.6rem;background:var(--bg2);color:var(--text1);border:1px solid var(--border);border-radius:6px;font-size:0.95rem;box-sizing:border-box;outline:none;" /><div id="cmd-palette-list" style="margin-top:0.5rem;max-height:300px;overflow-y:auto;"></div></div>';
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.hide();
    });
    document.body.appendChild(this._overlay);
    this._input = document.getElementById('cmd-palette-input');
    this._list = document.getElementById('cmd-palette-list');
    const self = this;
    this._input.addEventListener('input', () => self._filter());
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') self.hide();
      if (e.key === 'Enter') {
        const active = self._list.querySelector('.cmd-palette-item.active') || self._list.querySelector('.cmd-palette-item');
        if (active) active.click();
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); self._move(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); self._move(-1); }
    });
  },

  show() {
    if (!this._overlay) this.init();
    if (this._overlay.style.display === '') return;
    this._overlay.style.display = 'flex';
    this._renderAll();
    this._input.value = '';
    this._input.focus();
  },

  hide() {
    if (this._overlay) this._overlay.style.display = 'none';
  },

  _renderAll() {
    const shortcuts = typeof getShortcuts !== 'undefined' ? getShortcuts() : {};
    const registry = typeof COMMAND_REGISTRY !== 'undefined' ? COMMAND_REGISTRY : {};

    const allItems = [];
    for (const [id, s] of Object.entries(shortcuts)) {
      allItems.push({ id, label: s.label, keys: s.keys || '', category: 'Shortcuts', type: 'shortcut', ref: s });
    }
    for (const [id, c] of Object.entries(registry)) {
      if (!shortcuts[id]) {
        allItems.push({ id, label: c.label, keys: '', category: c.category || 'Commands', type: 'command', ref: c });
      }
    }

    allItems.sort((a, b) => {
      if (a.category < b.category) return -1;
      if (a.category > b.category) return 1;
      return a.label.localeCompare(b.label);
    });

    let html = '';
    let lastCat = '';
    for (const item of allItems) {
      if (item.category !== lastCat) {
        html += '<div class="cmd-palette-category">' + item.category + '</div>';
        lastCat = item.category;
      }
      html += '<div class="cmd-palette-item" data-id="' + item.id + '" data-type="' + item.type + '">';
      html += '<span class="cmd-label">' + item.label + '</span>';
      html += '<span class="cmd-keys">' + item.keys + '</span>';
      html += '</div>';
    }
    this._list.innerHTML = html;
    this._list.querySelectorAll('.cmd-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        this.hide();
        const id = el.dataset.id;
        const type = el.dataset.type;
        if (type === 'shortcut') {
          const s = shortcuts[id];
          if (s && s.fn) s.fn();
        } else {
          const c = registry[id];
          if (c && c.fn) c.fn();
        }
      });
    });
    const first = this._list.querySelector('.cmd-palette-item');
    if (first) first.classList.add('active');
  },

  _filter() {
    const q = this._input.value.toLowerCase();
    const items = this._list.querySelectorAll('.cmd-palette-item');
    let firstVisible = null;
    items.forEach(el => {
      const label = el.querySelector('.cmd-label').textContent.toLowerCase();
      const keys = el.querySelector('.cmd-keys').textContent.toLowerCase();
      const match = !q || label.includes(q) || keys.includes(q);
      el.style.display = match ? '' : 'none';
      if (match && !firstVisible) { firstVisible = el; el.classList.add('active'); }
      else el.classList.remove('active');
    });
  },

  _move(dir) {
    const items = this._list.querySelectorAll('.cmd-palette-item:not([style*="display: none"])');
    let idx = -1;
    items.forEach((el, i) => { if (el.classList.contains('active')) idx = i; });
    idx = Math.max(0, Math.min(items.length - 1, idx + dir));
    items.forEach((el, i) => el.classList.toggle('active', i === idx));
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }
};