// ==================== OLLAMA MANAGER (Msty-style) ====================

const OllamaManager = {
  _models: [],
  _timer: null,
  _hubOpen: false,
  _searchTimer: null,

  init() {
    this._loadHubState();
    this._setupEvents();
    this._startPolling();
  },

  _loadHubState() {
    try {
      this._hubOpen = localStorage.getItem('florde-ollama-hub-open') === '1';
    } catch { this._hubOpen = false; }
  },

  _saveHubState() {
    localStorage.setItem('florde-ollama-hub-open', this._hubOpen ? '1' : '0');
  },

  _setupEvents() {
    document.getElementById('btn-ollama-hub')?.addEventListener('click', () => this.toggleHub());
    document.getElementById('btn-ollama-hub-close')?.addEventListener('click', () => this.hideHub());

    // Model search filter
    document.getElementById('ollama-hub-search')?.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._renderHub(), 300);
    });

    // Category filter
    document.getElementById('ollama-hub-category')?.addEventListener('change', () => this._renderHub());
  },

  _startPolling() {
    this.refresh();
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.refresh(), 30000);
  },

  async refresh() {
    try {
      const url = this._getUrl();
      const r = await fetchWithTimeout(url + '/api/tags', { method: 'GET' }, 5000);
      const data = await r.json();
      this._models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size || 0,
        modified: m.modified_at || '',
        digest: m.digest || '',
        details: m.details || {}
      }));

      // Update badge
      const badge = document.getElementById('ollama-hub-badge');
      if (badge) {
        badge.textContent = this._models.length || '';
        badge.style.display = this._models.length > 0 ? 'flex' : 'none';
      }

      // Update provider model dropdown
      this._updateModelSelect();

      if (this._hubOpen) this._renderHub();
    } catch (e) {
      // Ollama not running
    }
  },

  _getUrl() {
    return (document.getElementById('url-ollama')?.value || 'http://localhost:11434').replace(/\/+$/, '');
  },

  _updateModelSelect() {
    const sel = document.getElementById('model-ollama');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = this._models.map(m =>
      '<option value="' + m.name + '" ' + (m.name === current ? 'selected' : '') + '>' + m.name + ' ' + this._formatSize(m.size) + '</option>'
    ).join('');
    if (!sel.value && this._models.length > 0) sel.value = this._models[0].name;
  },

  toggleHub() {
    this._hubOpen = !this._hubOpen;
    this._saveHubState();
    const panel = document.getElementById('ollama-hub-panel');
    panel?.classList.toggle('hidden', !this._hubOpen);
    if (this._hubOpen) {
      this.refresh();
    }
  },

  hideHub() {
    this._hubOpen = false;
    this._saveHubState();
    document.getElementById('ollama-hub-panel')?.classList.add('hidden');
  },

  _renderHub() {
    const container = document.getElementById('ollama-hub-list');
    if (!container) return;

    const search = (document.getElementById('ollama-hub-search')?.value || '').toLowerCase();
    const category = document.getElementById('ollama-hub-category')?.value || 'all';

    let models = this._models;
    if (search) models = models.filter(m => m.name.toLowerCase().includes(search));
    if (category !== 'all') {
      models = models.filter(m => {
        const family = (m.details?.family || '').toLowerCase();
        const name = m.name.toLowerCase();
        if (category === 'llama') return family.includes('llama') || name.includes('llama');
        if (category === 'qwen') return family.includes('qwen') || name.includes('qwen');
        if (category === 'mistral') return family.includes('mistral') || name.includes('mistral');
        if (category === 'code') return name.includes('coder') || name.includes('code') || name.includes('deepseek');
        if (category === 'embedding') return name.includes('embed') || name.includes('nomic');
        if (category === 'vision') return name.includes('llava') || name.includes('vision');
        return true;
      });
    }

    if (!models.length) {
      container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);">' +
        (this._models.length === 0
          ? 'No models installed. Click "Download" to add one.'
          : 'No models match your filter.') +
        '</div>';
      return;
    }

    // Stats
    const totalSize = models.reduce((s, m) => s + (m.size || 0), 0);
    document.getElementById('ollama-hub-stats').innerHTML =
      models.length + ' model' + (models.length !== 1 ? 's' : '') +
      ' — ' + this._formatSize(totalSize);

    container.innerHTML = models.map(m => `
      <div class="ollama-hub-model" data-name="${m.name}">
        <div class="ollama-hub-model-header">
          <span class="ollama-hub-model-name">${m.name}</span>
          <span class="ollama-hub-model-size">${this._formatSize(m.size)}</span>
          <button class="ollama-hub-model-select btn btn-sm btn-primary" data-name="${m.name}">Select</button>
          <button class="ollama-hub-model-delete btn btn-sm btn-secondary" data-name="${m.name}">🗑</button>
        </div>
        <div class="ollama-hub-model-details">
          ${m.details?.family ? '<span class="ollama-hub-detail">Family: ' + m.details.family + '</span>' : ''}
          ${m.details?.parameter_size ? '<span class="ollama-hub-detail">Params: ' + m.details.parameter_size + '</span>' : ''}
          ${m.details?.quantization_level ? '<span class="ollama-hub-detail">Quant: ' + m.details.quantization_level + '</span>' : ''}
          ${m.modified ? '<span class="ollama-hub-detail">Modified: ' + new Date(m.modified).toLocaleDateString() + '</span>' : ''}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.ollama-hub-model-select').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('model-ollama').value = btn.dataset.name;
        showNotification('success', 'Switched to model: ' + btn.dataset.name, '🤖');
        this.hideHub();
      });
    });
    container.querySelectorAll('.ollama-hub-model-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        if (!confirm('Delete model "' + name + '"?')) return;
        try {
          const url = this._getUrl();
          await fetchWithTimeout(url + '/api/delete', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          }, 10000);
          showNotification('success', 'Deleted model: ' + name, '🗑');
          this.refresh();
        } catch (err) {
          showNotification('error', 'Delete failed: ' + err.message, '❌');
        }
      });
    });
  },

  async getModelInfo(name) {
    try {
      const url = this._getUrl();
      const r = await fetchWithTimeout(url + '/api/show', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }, 5000);
      return await r.json();
    } catch { return null; }
  },

  openDownloadDialog() {
    // Use existing showOllamaDownloadModal function
    if (typeof showOllamaDownloadModal === 'function') {
      showOllamaDownloadModal();
    }
  },

  _formatSize(bytes) {
    if (!bytes) return '?';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  }
};
