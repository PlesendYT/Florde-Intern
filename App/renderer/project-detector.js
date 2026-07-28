const ProjectDetector = {
  _rules: null,
  _currentType: null,
  _currentActions: [],
  _currentProject: null,

  _defaultRules: [
    { type: 'minecraft', check: async () => {
      const files = await this._listFiles();
      return files.includes('gradlew') && files.some(f => f.endsWith('.gradle'));
    }, label: '⛏ Minecraft Mod', actions: [
      { label: 'Run Client', command: './gradlew runClient', port: null },
      { label: 'Build', command: './gradlew build', port: null }
    ]},
    { type: 'electron', check: async () => {
      const pkg = await this._readJson('package.json');
      return pkg && (pkg.dependencies?.electron || pkg.devDependencies?.electron);
    }, label: '⚡ Electron', actions: [
      { label: 'Start', command: 'npm start', port: null },
      { label: 'Build', command: 'npm run build', port: null }
    ]},
    { type: 'react', check: async () => {
      const pkg = await this._readJson('package.json');
      return pkg && (pkg.dependencies?.react || pkg.devDependencies?.react);
    }, label: '⚛ React', actions: [
      { label: 'Dev', command: 'npm run dev', port: 5173 },
      { label: 'Build', command: 'npm run build', port: null },
      { label: 'Start', command: 'npm start', port: 3000 }
    ]},
    { type: 'vue', check: async () => {
      const pkg = await this._readJson('package.json');
      return pkg && (pkg.dependencies?.vue || pkg.devDependencies?.vue || pkg.dependencies?.nuxt);
    }, label: '🟢 Vue', actions: [
      { label: 'Dev', command: 'npm run dev', port: 5173 },
      { label: 'Build', command: 'npm run build', port: null }
    ]},
    { type: 'next', check: async () => {
      const pkg = await this._readJson('package.json');
      return pkg && (pkg.dependencies?.next || pkg.devDependencies?.next);
    }, label: '▲ Next.js', actions: [
      { label: 'Dev', command: 'npm run dev', port: 3000 },
      { label: 'Build', command: 'npm run build', port: null },
      { label: 'Start', command: 'npm start', port: 3000 }
    ]},
    { type: 'node', check: async () => {
      const files = await this._listFiles();
      return files.includes('package.json');
    }, label: '⬡ Node.js', actions: [
      { label: 'Start', command: 'npm start', port: null },
      { label: 'Dev', command: 'npm run dev', port: null }
    ]},
    { type: 'python', check: async () => {
      const files = await this._listFiles();
      return files.includes('main.py') || files.includes('manage.py') || files.includes('app.py');
    }, label: '🐍 Python', actions: [
      { label: 'Run', command: 'python main.py', port: null },
      { label: 'Flask', command: 'python -m flask run', port: 5000 },
      { label: 'Django', command: 'python manage.py runserver', port: 8000 }
    ]},
    { type: 'html', check: async () => {
      const files = await this._listFiles();
      return files.some(f => f.endsWith('.html') || f === 'index.html');
    }, label: '🌐 HTML', actions: [
      { label: 'Serve', command: 'python -m http.server {port}', port: 3000 },
      { label: 'Open Browser', command: 'open', port: null }
    ]},
    { type: 'rust', check: async () => {
      const files = await this._listFiles();
      return files.includes('Cargo.toml');
    }, label: '🦀 Rust', actions: [
      { label: 'Run', command: 'cargo run', port: null },
      { label: 'Build', command: 'cargo build', port: null }
    ]},
    { type: 'go', check: async () => {
      const files = await this._listFiles();
      return files.includes('go.mod');
    }, label: '🔷 Go', actions: [
      { label: 'Run', command: 'go run .', port: null },
      { label: 'Build', command: 'go build', port: null }
    ]}
  ],

  async _listFiles() {
    try { return await window.electronAPI.projectListFiles(this._currentProject); } catch { return []; }
  },

  async _readJson(file) {
    try {
      const content = await window.electronAPI.projectReadFile(this._currentProject, file);
      return JSON.parse(content);
    } catch { return null; }
  },

  async detect(projectName) {
    this._currentProject = projectName;
    this._rules = this._defaultRules;
    try {
      const custom = localStorage.getItem('florde-project-rules');
      if (custom) this._rules = JSON.parse(custom);
    } catch {}
    for (const rule of this._rules) {
      try {
        if (await rule.check()) {
          this._currentType = rule;
          this._currentActions = rule.actions;
          this._showActionTab();
          return rule;
        }
      } catch {}
    }
    this._currentType = null;
    this._currentActions = [];
    this._hideActionTab();
    return null;
  },

  _showActionTab() {
    const tabBar = document.getElementById('workspace-tab-bar');
    if (!tabBar) return;
    let actionTab = document.getElementById('project-action-tab');
    if (!actionTab) {
      actionTab = document.createElement('div');
      actionTab.id = 'project-action-tab';
      actionTab.className = 'project-action-tab';
      tabBar.appendChild(actionTab);
    }
    let html = `<span class="project-action-label">${this._currentType.label}</span><span class="project-action-arrow">▼</span>`;
    html += `<div class="project-action-dropdown hidden">`;
    for (const action of this._currentActions) {
      html += `<button class="project-action-btn" data-cmd="${escapeHtml(action.command)}" data-port="${action.port || ''}">${escapeHtml(action.label)}</button>`;
    }
    html += `</div>`;
    actionTab.innerHTML = html;
    actionTab.classList.remove('hidden');

    actionTab.querySelector('.project-action-label')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = actionTab.querySelector('.project-action-dropdown');
      if (dd) dd.classList.toggle('hidden');
    });

    actionTab.querySelectorAll('.project-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd;
        const port = btn.dataset.port;
        this._execute(cmd, port);
        actionTab.querySelector('.project-action-dropdown')?.classList.add('hidden');
      });
    });
  },

  _hideActionTab() {
    const actionTab = document.getElementById('project-action-tab');
    if (actionTab) actionTab.classList.add('hidden');
  },

  _execute(command, port) {
    if (command === 'open') {
      const url = port ? `http://localhost:${port}` : 'http://localhost:3000';
      if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
      return;
    }
    const finalCmd = command.replace('{port}', port || '3000');
    const execDir = typeof sandboxDir !== 'undefined' ? sandboxDir : '';
    if (window.electronAPI?.sandboxExec) {
      window.electronAPI.sandboxExec(execDir, finalCmd).then(out => {
        const outputText = typeof out === 'string' ? out : (out && out.output ? out.output : '');
        logToTerminal(`[Action] ${finalCmd}: ${outputText.substring(0, 300)}`, 'info');
      }).catch(err => {
        logToTerminal(`[Action] ${finalCmd} failed: ${err}`, 'error');
      });
    }
    const terminalPanel = document.getElementById('terminal-panel');
    if (terminalPanel) terminalPanel.classList.remove('hidden');
  }
};
