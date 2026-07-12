const ApiKeyManager = {
  _keys: {},
  _listeners: [],

  init() {
    try {
      this._keys = JSON.parse(localStorage.getItem('florde-api-keys') || '{}');
    } catch { this._keys = {}; }
    // Set default status for saved keys
    for (const svc of ['publicwww', 'virustotal', 'urlscanio']) {
      if (this._keys[svc]?.key && !this._keys[svc]?.status) {
        this._keys[svc].status = 'disconnected';
      }
    }
    this._notify();
  },

  _save() {
    localStorage.setItem('florde-api-keys', JSON.stringify(this._keys));
  },

  _notify() {
    for (const fn of this._listeners) try { fn(); } catch {}
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  getKey(service) {
    return this._keys[service]?.key || '';
  },

  getStatus(service) {
    return this._keys[service]?.status || 'disconnected';
  },

  setKey(service, key) {
    if (!this._keys[service]) this._keys[service] = { key: '', status: 'disconnected' };
    this._keys[service].key = key;
    this._keys[service].status = key ? 'disconnected' : 'disconnected';
    this._save();
    this._notify();
  },

  async validateKey(service) {
    const entry = this._keys[service];
    if (!entry?.key) return false;
    entry.status = 'checking';
    this._save();
    this._notify();
    let ok = false;
    try {
      if (service === 'publicwww') {
        const r = await fetch('https://publicwww.com/websites/test/?key=' + encodeURIComponent(entry.key) + '&export=count', { signal: AbortSignal.timeout(10000) });
        ok = r.ok || r.status === 200 || r.status === 404;
      } else if (service === 'virustotal') {
        const r = await fetch('https://www.virustotal.com/api/v3/users/' + encodeURIComponent(entry.key), {
          headers: { 'x-apikey': entry.key }, signal: AbortSignal.timeout(10000)
        });
        ok = r.ok;
      } else if (service === 'urlscanio') {
        const r = await fetch('https://urlscan.io/api/v1/quotas/', {
          headers: { 'API-Key': entry.key }, signal: AbortSignal.timeout(10000)
        });
        ok = r.ok;
      }
    } catch { ok = false; }
    entry.status = ok ? 'connected' : 'disconnected';
    this._save();
    this._notify();
    return ok;
  },

  getServices() {
    return [
      { id: 'publicwww', label: 'PublicWWW', needs: 'API-Key für Code-Suche im Web', url: 'https://publicwww.com' },
      { id: 'virustotal', label: 'VirusTotal', needs: 'API-Key für Datei-Scans', url: 'https://www.virustotal.com' },
      { id: 'urlscanio', label: 'urlscan.io', needs: 'API-Key für Website-Analysen', url: 'https://urlscan.io' },
    ];
  },

  render(container) {
    if (!container) return;
    container.innerHTML = '<div style="padding:0.5rem 0.75rem;font-weight:600;border-bottom:1px solid var(--border);background:var(--bg2);font-size:0.8rem;">API Keys</div>';
    for (const svc of this.getServices()) {
      const entry = this._keys[svc.id] || { key: '', status: 'disconnected' };
      const masked = entry.key ? entry.key.slice(0, 4) + '*'.repeat(Math.max(3, entry.key.length - 7)) + entry.key.slice(-3) : '';
      const statusColors = { connected: '#22c55e', disconnected: '#ef4444', checking: '#eab308' };
      const statusLabels = { connected: 'Verbunden', disconnected: 'Getrennt', checking: 'Prüfe' };
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);font-size:0.8rem;';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
          <span style="font-weight:500;">${svc.label}</span>
          <span id="api-status-${svc.id}" style="font-size:0.7rem;color:${statusColors[entry.status] || '#ef4444'};">
            ${statusLabels[entry.status] || 'Getrennt'}
          </span>
        </div>
        <div style="display:flex;gap:0.3rem;align-items:center;">
          <input id="api-input-${svc.id}" type="password" placeholder="${svc.needs}"
            style="flex:1;padding:0.3rem 0.5rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;"
            value="${entry.key || ''}">
          <button id="api-toggle-${svc.id}" title="Schlüssel anzeigen/verstecken"
            style="background:none;border:none;color:var(--text3);cursor:pointer;padding:2px 4px;font-size:0.8rem;">👁</button>
          <button id="api-save-${svc.id}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text1);border-radius:4px;padding:0.3rem 0.6rem;cursor:pointer;font-size:0.75rem;">Speichern</button>
        </div>
      `;
      container.appendChild(row);

      row.querySelector('#api-toggle-' + svc.id).onclick = () => {
        const inp = row.querySelector('#api-input-' + svc.id);
        inp.type = inp.type === 'password' ? 'text' : 'password';
      };
      row.querySelector('#api-save-' + svc.id).onclick = async () => {
        const inp = row.querySelector('#api-input-' + svc.id);
        const statusEl = row.querySelector('#api-status-' + svc.id);
        this.setKey(svc.id, inp.value.trim());
        if (inp.value.trim()) {
          statusEl.textContent = 'Prüfe';
          statusEl.style.color = '#eab308';
          const ok = await this.validateKey(svc.id);
          statusEl.textContent = ok ? 'Verbunden' : 'Getrennt';
          statusEl.style.color = ok ? '#22c55e' : '#ef4444';
        } else {
          statusEl.textContent = 'Getrennt';
          statusEl.style.color = '#ef4444';
        }
      };
    }
  }
};
