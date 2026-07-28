const LayoutManager = {
  _api: null,
  _container: null,
  _initialized: false,
  _active: false,
  _locked: false,
  _placeholderComment: null,
  _sidebarHidden: false,
  _resizerHidden: false,

  async init(containerElement) {
    if (this._initialized) return;
    this._container = containerElement;

    const dv = window['dockview-core'];
    if (!dv || !dv.createDockview) {
      console.warn('LayoutManager: dockview-core not loaded');
      return;
    }

    try {
      this._api = dv.createDockview(containerElement, {
        className: 'dockview-theme-florde',
        disableDnd: false,
        showPopoutIcon: false,
        showMaximiseIcon: true,
        showCloseIcon: false,
        createComponent: (options) => {
          const el = document.createElement('div');
          el.style.height = '100%';
          el.style.overflow = 'auto';
          if (options.id !== 'editor') {
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.color = 'var(--text3)';
            el.style.fontSize = '0.85rem';
            el.style.padding = '1rem';
            el.style.textAlign = 'center';
            el.textContent = 'Content coming in Phase 2';
          }
          return {
            element: el,
            init: () => {},
            layout: () => {},
            dispose: () => {}
          };
        }
      });

      this._registerPanels();
      this._initialized = true;
      await this._loadDefaultLayout();
    } catch (e) {
      console.error('LayoutManager.init failed:', e);
    }
  },

  _registerPanels() {
    const api = this._api;
    if (!api) return;

    api.addPanel({ id: 'editor', title: 'Editor', params: {}, position: { direction: 'center' } });
    api.addPanel({ id: 'files', title: 'Files', params: {}, position: { direction: 'left', referencePanel: 'editor', width: 220 } });
    api.addPanel({ id: 'chat', title: 'Chat', params: {}, position: { direction: 'right', referencePanel: 'editor', width: 350 } });
    api.addPanel({ id: 'terminal', title: 'Terminal', params: {}, position: { direction: 'below', referencePanel: 'editor', height: 200 } });
    api.addPanel({ id: 'docker', title: 'Docker', params: {}, position: { direction: 'below', referencePanel: 'terminal', height: 200 } });
    api.addPanel({ id: 'git', title: 'Git', params: {}, position: { direction: 'below', referencePanel: 'docker', height: 200 } });
  },

  activate() {
    if (this._active || !this._initialized) return;
    this._active = true;

    const mainArea = document.querySelector('.main-area');
    const editorPanel = this._api.getPanel('editor');
    if (mainArea && editorPanel) {
      this._placeholderComment = document.createComment('layout-manager');
      mainArea.parentNode.insertBefore(this._placeholderComment, mainArea);
      editorPanel.element.appendChild(mainArea);
      mainArea.style.flex = 'none';
      mainArea.style.height = '100%';
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('hidden')) {
      this._sidebarHidden = true;
      sidebar.classList.add('hidden');
    }
    const resizer = document.getElementById('sidebar-resizer');
    if (resizer && !resizer.classList.contains('hidden')) {
      this._resizerHidden = true;
      resizer.classList.add('hidden');
    }

    this._container.classList.remove('hidden');
    requestAnimationFrame(() => this._api?.layout?.());

    document.querySelector('.app-body')?.classList.add('layout-dockview-active');
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;

    const mainArea = document.querySelector('.main-area');
    if (mainArea && this._placeholderComment) {
      this._placeholderComment.parentNode.insertBefore(mainArea, this._placeholderComment);
      this._placeholderComment.remove();
      this._placeholderComment = null;
      mainArea.style.flex = '';
      mainArea.style.height = '';
    }

    if (this._sidebarHidden) {
      document.getElementById('sidebar')?.classList.remove('hidden');
      this._sidebarHidden = false;
    }
    if (this._resizerHidden) {
      document.getElementById('sidebar-resizer')?.classList.remove('hidden');
      this._resizerHidden = false;
    }

    this._container.classList.add('hidden');
    document.querySelector('.app-body')?.classList.remove('layout-dockview-active');
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  async _loadDefaultLayout() {
    const api = this._api;
    if (!api) return;
    try {
      const saved = localStorage.getItem('florde-layout-default');
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        return;
      }
    } catch (e) {
      console.warn('LayoutManager: failed to load saved layout', e);
    }
    this._resetLayout();
  },

  _resetLayout() {
    const api = this._api;
    if (!api) return;
    api.clear();
    api.addPanel({ id: 'editor', title: 'Editor', params: {}, position: { direction: 'center' } });
    api.addPanel({ id: 'files', title: 'Files', params: {}, position: { direction: 'left', referencePanel: 'editor', width: 220 } });
    api.addPanel({ id: 'chat', title: 'Chat', params: {}, position: { direction: 'right', referencePanel: 'editor', width: 350 } });
    api.addPanel({ id: 'terminal', title: 'Terminal', params: {}, position: { direction: 'below', referencePanel: 'editor', height: 200 } });
    api.addPanel({ id: 'docker', title: 'Docker', params: {}, position: { direction: 'below', referencePanel: 'terminal', height: 200 } });
    api.addPanel({ id: 'git', title: 'Git', params: {}, position: { direction: 'below', referencePanel: 'docker', height: 200 } });
  },

  async save(name) {
    const api = this._api;
    if (!api) return;
    const state = api.toJSON();
    localStorage.setItem(`florde-layout-${name}`, JSON.stringify(state));
    try {
      await window.electronAPI.flordeDb?.run?.('florde', 'INSERT OR REPLACE INTO layout_states (name, state_json) VALUES (?, ?)', [name, JSON.stringify(state)]);
    } catch (e) {
      /* SQLite save is optional */
    }
  },

  async load(name) {
    const api = this._api;
    if (!api) return;
    try {
      const saved = localStorage.getItem(`florde-layout-${name}`);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        return;
      }
      try {
        const rows = await window.electronAPI.flordeDb?.query?.('florde', 'SELECT state_json FROM layout_states WHERE name = ?', [name]);
        if (rows && rows.length > 0) {
          api.fromJSON(JSON.parse(rows[0].state_json));
          return;
        }
      } catch (e) {
        /* SQLite fallback failed */
      }
    } catch (e) {
      console.warn('LayoutManager: failed to load layout', name, e);
    }
    this._resetLayout();
  },

  lock(locked) {
    this._locked = locked;
    if (this._api) {
      try { this._api.setLocked?.(locked); } catch (e) { /* not supported */ }
    }
    const toggle = document.getElementById('layout-design-toggle');
    if (toggle && locked) toggle.classList.remove('on');
    else if (toggle) toggle.classList.add('on');
  },

  reset() {
    localStorage.removeItem('florde-layout-default');
    this._resetLayout();
  },

  get isActive() { return this._active; },
  get isInitialized() { return this._initialized; },
  get api() { return this._api; }
};
