const LayoutManager = {
  _api: null,
  _container: null,
  _initialized: false,
  _active: false,
  _locked: false,
  _restore: {},

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
          if (options.id === 'editor') {
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.overflow = 'hidden';
          }
          if (options.id === 'files') {
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
          }
          if (options.id === 'git') {
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
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
    // dockview has no 'center' direction: the first panel added WITHOUT a
    // position becomes the root panel; the rest dock relative to it.
    api.addPanel({ id: 'editor', title: 'Editor', params: {} });
    api.addPanel({ id: 'files', title: 'Files', params: {}, position: { direction: 'left', referencePanel: 'editor', width: 220 } });
    api.addPanel({ id: 'chat', title: 'Chat', params: {}, position: { direction: 'right', referencePanel: 'editor', width: 350 } });
    api.addPanel({ id: 'git', title: 'Git', params: {}, position: { direction: 'below', referencePanel: 'chat', height: 200 } });
    api.addPanel({ id: 'terminal', title: 'Terminal', params: {}, position: { direction: 'below', referencePanel: 'editor', height: 200 } });
    api.addPanel({ id: 'docker', title: 'Docker', params: {}, position: { direction: 'below', referencePanel: 'terminal', height: 200 } });
  },

  _insertPlaceholder(parent, id) {
    const ph = document.createComment('layout-manager:' + id);
    parent.insertBefore(ph, null);
    return ph;
  },

  activate() {
    if (this._active || !this._initialized) return;
    this._active = true;

    const api = this._api;
    const mainArea = document.querySelector('.main-area');
    const mainContent = document.querySelector('.main-content');
    if (!mainArea) { console.warn('LayoutManager: .main-area not found'); return; }

    this._restore = {};

    const appendToPanel = (panelId, element) => {
      const panel = api.getPanel(panelId);
      if (panel && element) {
        panel.element.appendChild(element);
      }
    };

    const replaceWithPlaceholder = (element) => {
      if (!element || !element.parentNode) return null;
      const ph = document.createComment('layout-manager');
      element.parentNode.insertBefore(ph, element);
      element.parentNode.removeChild(element);
      return ph;
    };

    const getPanel = (id) => api.getPanel(id);
    const panelEl = (id) => { const p = getPanel(id); return p ? p.element : null; };

    // Move chat-panel out of main-content first (it's a sibling of editor-panel)
    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel && chatPanel.parentNode === mainContent) {
      const ph = replaceWithPlaceholder(chatPanel);
      this._restore.chatPanel = { element: chatPanel, parent: mainContent, placeholder: ph };
      appendToPanel('chat', chatPanel);
    }

    // Move file-tabs into editor panel
    const fileTabs = document.getElementById('file-tabs');
    if (fileTabs && fileTabs.parentNode === mainArea) {
      const ph = replaceWithPlaceholder(fileTabs);
      this._restore.fileTabs = { element: fileTabs, parent: mainArea, placeholder: ph };
      appendToPanel('editor', fileTabs);
    }

    // Move main-content (now without chat) into editor panel
    if (mainContent && mainContent.parentNode === mainArea) {
      const ph = replaceWithPlaceholder(mainContent);
      this._restore.mainContent = { element: mainContent, parent: mainArea, placeholder: ph };
      appendToPanel('editor', mainContent);
    }

    // Move terminal panel
    const terminal = document.getElementById('terminal-panel');
    if (terminal && terminal.parentNode === mainArea) {
      const wasHidden = terminal.classList.contains('hidden');
      terminal.classList.remove('hidden');
      const ph = replaceWithPlaceholder(terminal);
      this._restore.terminal = { element: terminal, parent: mainArea, placeholder: ph, wasHidden };
      appendToPanel('terminal', terminal);
    }

    // Move docker panel
    const docker = document.getElementById('docker-panel');
    if (docker && docker.parentNode === mainArea) {
      const wasHidden = docker.classList.contains('hidden');
      docker.classList.remove('hidden');
      const ph = replaceWithPlaceholder(docker);
      this._restore.docker = { element: docker, parent: mainArea, placeholder: ph, wasHidden };
      appendToPanel('docker', docker);
    }

    // Move file tree from sidebar into files panel
    const fileTree = document.getElementById('file-tree');
    const sidebar = document.getElementById('sidebar');
    if (fileTree && fileTree.parentNode === sidebar) {
      // Also move the sidebar header
      const sidebarHeader = sidebar.querySelector('.sidebar-header');
      const filesPanelEl = panelEl('files');
      if (sidebarHeader && filesPanelEl) {
        const ph = replaceWithPlaceholder(sidebarHeader);
        this._restore.sidebarHeader = { element: sidebarHeader, parent: sidebar, placeholder: ph };
        filesPanelEl.appendChild(sidebarHeader);
      }
      if (filesPanelEl) {
        const ph = replaceWithPlaceholder(fileTree);
        this._restore.fileTree = { element: fileTree, parent: sidebar, placeholder: ph };
        filesPanelEl.appendChild(fileTree);
      }
    }

    // Move git panel from sidebar into git panel
    const gitPanel = document.getElementById('git-panel');
    if (gitPanel && gitPanel.parentNode === sidebar) {
      const ph = replaceWithPlaceholder(gitPanel);
      this._restore.gitPanel = { element: gitPanel, parent: sidebar, placeholder: ph };
      appendToPanel('git', gitPanel);
    }

    // Hide sidebar
    this._sidebarHidden = !sidebar.classList.contains('hidden');
    sidebar.classList.add('hidden');
    const resizer = document.getElementById('sidebar-resizer');
    if (resizer) resizer.classList.add('hidden');

    // Show dockview
    this._container.classList.remove('hidden');
    document.querySelector('.app-body')?.classList.add('layout-dockview-active');

    requestAnimationFrame(() => {
      this._api?.layout?.();
      if (typeof editor !== 'undefined' && editor?.layout) editor.layout();
      if (typeof DiffViewer !== 'undefined' && DiffViewer._editor?.layout) DiffViewer._editor.layout();
    });
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;

    for (const [key, info] of Object.entries(this._restore)) {
      if (info.element && info.placeholder && info.placeholder.parentNode) {
        info.placeholder.parentNode.insertBefore(info.element, info.placeholder);
        info.placeholder.remove();
      } else if (info.element && info.parent) {
        info.parent.appendChild(info.element);
      }
      if (info.wasHidden) info.element.classList.add('hidden');
    }
    this._restore = {};

    if (this._sidebarHidden) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('hidden');
      const resizer = document.getElementById('sidebar-resizer');
      if (resizer) resizer.classList.remove('hidden');
      this._sidebarHidden = false;
    }

    this._container.classList.add('hidden');
    document.querySelector('.app-body')?.classList.remove('layout-dockview-active');
  },

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  },

  // Security (b-37): single load precedence everywhere — localStorage first
  // (freshest, written synchronously on save), then DB, then built-in default.
  // _loadDefaultLayout previously preferred DB while load() preferred
  // localStorage (divergent), and reset() never touched the DB.
  async _loadLayoutState(name, projectName) {
    try {
      const saved = localStorage.getItem(`florde-layout-${name}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    try {
      const rows = await window.electronAPI.flordeDb?.query?.(projectName,
        'SELECT state_json FROM layout_states WHERE name = ?', [name]);
      if (rows && rows.length > 0) return JSON.parse(rows[0].state_json);
    } catch {}
    return null;
  },

  async _loadDefaultLayout() {
    const api = this._api;
    if (!api) return;
    const state = await this._loadLayoutState('default', 'florde');
    if (state) {
      try { api.fromJSON(state); return; } catch (e) { console.warn('LayoutManager: saved default layout invalid', e); }
    }
    this._resetLayout();
  },

  _resetLayout() {
    const api = this._api;
    if (!api) return;
    api.clear();
    // dockview has no 'center' direction: the first panel added WITHOUT a
    // position becomes the root panel; the rest dock relative to it.
    api.addPanel({ id: 'editor', title: 'Editor', params: {} });
    api.addPanel({ id: 'files', title: 'Files', params: {}, position: { direction: 'left', referencePanel: 'editor', width: 220 } });
    api.addPanel({ id: 'chat', title: 'Chat', params: {}, position: { direction: 'right', referencePanel: 'editor', width: 350 } });
    api.addPanel({ id: 'git', title: 'Git', params: {}, position: { direction: 'below', referencePanel: 'chat', height: 200 } });
    api.addPanel({ id: 'terminal', title: 'Terminal', params: {}, position: { direction: 'below', referencePanel: 'editor', height: 200 } });
    api.addPanel({ id: 'docker', title: 'Docker', params: {}, position: { direction: 'below', referencePanel: 'terminal', height: 200 } });
  },

  async save(name) {
    const api = this._api;
    if (!api) return;
    const state = api.toJSON();
    const projectName = name.replace(/^project-/, '');
    localStorage.setItem(`florde-layout-${name}`, JSON.stringify(state));
    try {
      await window.electronAPI.flordeDb?.run?.(projectName,
        `INSERT INTO layout_states (name, state_json, is_default, project) VALUES (?, ?, 0, ?)
         ON CONFLICT(name) DO UPDATE SET state_json = excluded.state_json`,
        [name, JSON.stringify(state), projectName]);
    } catch (e) {
      /* SQLite save is optional */
    }
  },

  async load(name) {
    const api = this._api;
    if (!api) return;
    const projectName = name.replace(/^project-/, '');
    const state = await this._loadLayoutState(name, projectName);
    if (state) {
      try { api.fromJSON(state); return; } catch (e) { console.warn('LayoutManager: failed to load layout', name, e); }
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

  async reset() {
    // Security (b-37): reset must clear BOTH stores, not just localStorage.
    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('florde-layout-')) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
    } catch {}
    try {
      await window.electronAPI.flordeDb?.run?.('florde', 'DELETE FROM layout_states WHERE name = ?', ['default']);
    } catch {}
    this.deactivate();
    this._resetLayout();
    this.activate();
  },

  get isActive() { return this._active; },
  get isInitialized() { return this._initialized; },
  get api() { return this._api; }
};
