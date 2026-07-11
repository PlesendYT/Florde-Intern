// ==================== SKILLS (Manus-style) ====================
// Skills are file-system-based resources that encapsulate workflows.
// Stored as folders with SKILL.md + optional scripts.

const SkillsManager = {
  _skills: [],
  _activeSkills: [],
  _storageKey: 'florde-skills',

  init() {
    this._load();
    this._renderList();
    this._registerSlashCommands();
    this._addBuildHook();
    document.getElementById('btn-skills-toggle')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('btn-skills-close')?.addEventListener('click', () => this.hidePanel());
    document.getElementById('btn-skill-import')?.addEventListener('click', () => this.importSkill());
    document.getElementById('btn-skill-create')?.addEventListener('click', () => this.createFromChat());
  },

  togglePanel() {
    const panel = document.getElementById('skills-panel');
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) this._renderList();
  },

  hidePanel() {
    document.getElementById('skills-panel')?.classList.add('hidden');
  },

  _registerSlashCommands() {
    // Listen for / in chat input → show skill autocomplete
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.addEventListener('input', () => {
      const text = input.value;
      if (text === '/') {
        this._showSkillAutocomplete();
      } else if (text.startsWith('/') && !text.includes(' ')) {
        const query = text.slice(1).toLowerCase();
        this._showSkillAutocomplete(query);
      } else {
        this._hideSkillAutocomplete();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        const auto = document.getElementById('skill-autocomplete');
        if (auto && !auto.classList.contains('hidden') && auto.querySelector('.skill-auto-item.selected')) {
          e.preventDefault();
          auto.querySelector('.skill-auto-item.selected').click();
        }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const auto = document.getElementById('skill-autocomplete');
        if (!auto || auto.classList.contains('hidden')) return;
        e.preventDefault();
        const items = auto.querySelectorAll('.skill-auto-item');
        const idx = Array.from(items).findIndex(i => i.classList.contains('selected'));
        items[idx]?.classList.remove('selected');
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]?.classList.add('selected');
      }
    });
  },

  _showSkillAutocomplete(query) {
    let auto = document.getElementById('skill-autocomplete');
    if (!auto) {
      auto = document.createElement('div');
      auto.id = 'skill-autocomplete';
      auto.className = 'skill-autocomplete hidden';
      document.getElementById('chat-input-container')?.appendChild(auto);
    }
    const skills = query
      ? this._skills.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
      : this._skills;
    if (!skills.length) { auto.classList.add('hidden'); return; }
    auto.innerHTML = skills.map((s, i) =>
      `<div class="skill-auto-item ${i === 0 ? 'selected' : ''}" data-id="${s.id}">
        <span class="skill-auto-icon">⚡</span>
        <span class="skill-auto-name">${this._escapeHtml(s.name)}</span>
        <span class="skill-auto-desc">${this._escapeHtml(s.description)}</span>
      </div>`
    ).join('');
    auto.classList.remove('hidden');
    auto.querySelectorAll('.skill-auto-item').forEach(item => {
      item.addEventListener('click', () => {
        this.activateSkill(item.dataset.id);
        input.value = '';
        auto.classList.add('hidden');
      });
    });
  },

  _hideSkillAutocomplete() {
    document.getElementById('skill-autocomplete')?.classList.add('hidden');
  },

  _load() {
    try {
      const data = JSON.parse(localStorage.getItem(this._storageKey) || '[]');
      this._skills = data;
    } catch { this._skills = []; }
    // Built-in default skills
    if (this._skills.length === 0) {
      this._skills = [
        {
          id: 'skill-review-code',
          name: 'Review Code',
          description: 'Review the current project code for bugs, security issues, and best practices',
          instructions: 'Analyze all files in the project. Look for: 1) Security vulnerabilities (XSS, injection, hardcoded secrets), 2) Performance issues, 3) Code style problems, 4) Error handling gaps. Provide a structured report with severity levels.',
          created: Date.now(), builtin: true, tags: ['code', 'review']
        },
        {
          id: 'skill-refactor',
          name: 'Refactor Module',
          description: 'Refactor a module with clean architecture patterns',
          instructions: '1. Identify the module to refactor. 2. Apply clean architecture: separate concerns into domain, application, infrastructure layers. 3. Extract interfaces. 4. Add error handling. 5. Update imports. Ask user which module first.',
          created: Date.now(), builtin: true, tags: ['code', 'refactor']
        },
        {
          id: 'skill-dockerize',
          name: 'Dockerize Project',
          description: 'Create Dockerfile and docker-compose.yml for the project',
          instructions: '1. Detect project language/framework. 2. Create optimized multi-stage Dockerfile. 3. Create docker-compose.yml with appropriate services. 4. Create .dockerignore. 5. Test the build. Ask user about ports and services needed.',
          created: Date.now(), builtin: true, tags: ['docker', 'devops']
        },
        {
          id: 'skill-deploy',
          name: 'Deploy to Cloud',
          description: 'Deploy the project to a cloud provider',
          instructions: '1. Check which cloud providers are connected in Settings > Connected Apps. 2. Ask user which provider to use. 3. Prepare deployment config. 4. Deploy using the connected provider\'s API. 5. Return the deployment URL.',
          created: Date.now(), builtin: true, tags: ['devops', 'deploy']
        }
      ];
      this._save();
    }
  },

  _save() {
    localStorage.setItem(this._storageKey, JSON.stringify(this._skills));
  },

  _renderList() {
    const container = document.getElementById('skills-list');
    if (!container) return;
    if (!this._skills.length) {
      container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.8rem;">No skills yet. Create one from a chat or import.</div>';
      return;
    }
    container.innerHTML = this._skills.map(s => `
      <div class="skill-card" data-id="${s.id}">
        <div class="skill-card-header">
          <span class="skill-card-icon">⚡</span>
          <span class="skill-card-name">${this._escapeHtml(s.name)}</span>
          ${s.builtin ? '<span class="skill-card-badge">built-in</span>' : ''}
        </div>
        <div class="skill-card-desc">${this._escapeHtml(s.description)}</div>
        <div class="skill-card-tags">${(s.tags || []).map(t => '<span class="skill-tag">' + t + '</span>').join('')}</div>
        <div class="skill-card-actions">
          <button class="btn btn-sm btn-primary skill-activate" data-id="${s.id}">Run</button>
          <button class="btn btn-sm btn-secondary skill-export" data-id="${s.id}">Export</button>
          ${s.builtin ? '' : '<button class="btn btn-sm btn-secondary skill-delete" data-id="' + s.id + '">Delete</button>'}
        </div>
        <div class="skill-card-instructions hidden">${this._escapeHtml(s.instructions)}</div>
      </div>
    `).join('');
    container.querySelectorAll('.skill-activate').forEach(btn => {
      btn.addEventListener('click', () => this.activateSkill(btn.dataset.id));
    });
    container.querySelectorAll('.skill-export').forEach(btn => {
      btn.addEventListener('click', () => this.exportSkill(btn.dataset.id));
    });
    container.querySelectorAll('.skill-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete skill?')) {
          this._skills = this._skills.filter(s => s.id !== btn.dataset.id);
          this._save();
          this._renderList();
        }
      });
    });
  },

  activateSkill(id) {
    const skill = this._skills.find(s => s.id === id);
    if (!skill) return;
    // Insert instructions into chat as system message + trigger execution
    const chat = document.getElementById('chat-messages');
    if (!chat) return;
    const msg = document.createElement('div');
    msg.className = 'chat-msg system skill-activated';
    msg.innerHTML = '⚡ Skill activated: <strong>' + this._escapeHtml(skill.name) + '</strong><br><em>' + this._escapeHtml(skill.description) + '</em>';
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
    // Auto-send the instructions as a message
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = '/skill ' + skill.name + ': ' + skill.instructions;
      // Trigger send
      setTimeout(() => {
        const sendBtn = document.getElementById('btn-send') || document.querySelector('[data-action="send"]');
        if (sendBtn) sendBtn.click();
      }, 500);
    }
  },

  createFromChat() {
    const name = prompt('Skill name:');
    if (!name) return;
    // Get recent chat messages for context
    const chat = document.getElementById('chat-messages');
    const recentMessages = chat ? Array.from(chat.querySelectorAll('.chat-msg')).slice(-10).map(m => m.textContent).join('\n') : '';
    const desc = prompt('Short description:') || 'Custom skill';
    const instructions = prompt('Instructions for the AI (what should it do):') || 'Execute the task based on context.';
    this._skills.push({
      id: 'skill-' + Date.now(),
      name, description: desc,
      instructions,
      created: Date.now(), builtin: false,
      tags: ['custom']
    });
    this._save();
    this._renderList();
    showNotification('success', 'Skill "' + name + '" created!', '⚡');
  },

  importSkill() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.skill';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const skills = Array.isArray(data) ? data : [data];
          for (const s of skills) {
            if (s.name && s.instructions) {
              s.id = 'skill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
              s.builtin = false;
              this._skills.push(s);
            }
          }
          this._save();
          this._renderList();
          showNotification('success', 'Imported ' + skills.length + ' skill(s)!', '⚡');
        } catch (err) {
          showNotification('error', 'Import failed: ' + err.message, '❌');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  exportSkill(id) {
    const skill = this._skills.find(s => s.id === id);
    if (!skill) return;
    const blob = new Blob([JSON.stringify(skill, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = skill.name.replace(/\s+/g, '-').toLowerCase() + '.skill';
    a.click();
    URL.revokeObjectURL(url);
  },

  getActiveInstructions() {
    // Return concatenated instructions of all active skills
    return this._activeSkills.map(id => {
      const s = this._skills.find(sk => sk.id === id);
      return s ? `[Skill: ${s.name}]\n${s.instructions}` : '';
    }).join('\n\n');
  },

  _addBuildHook() {
    // Hook: after successful AI response, offer to save as skill
    const orig = window._origAppendChat || null;
    // This hooks into the sendMessage completion
  },

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
