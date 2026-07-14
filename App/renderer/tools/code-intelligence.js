const CodeIntelligence = {
  _panel: null,
  _resultsEl: null,
  _activeTab: 'code-search',

  init() {
    document.getElementById('btn-ci-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-ci-close')?.addEventListener('click', () => this.hide());
    ApiKeyManager.onChange(() => { if (this._isOpen()) this._renderTools(); });
  },

  toggle() {
    const panel = document.getElementById('ci-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      this._panel = panel;
      this._resultsEl = document.getElementById('ci-results');
      this._renderTools();
      document.getElementById('btn-ci-toggle')?.classList.add('active');
    } else {
      document.getElementById('btn-ci-toggle')?.classList.remove('active');
    }
  },

  hide() {
    document.getElementById('ci-panel')?.classList.add('hidden');
    document.getElementById('btn-ci-toggle')?.classList.remove('active');
  },

  _isOpen() {
    return this._panel && !this._panel.classList.contains('hidden');
  },

  _renderTools() {
    const tabs = document.getElementById('ci-tabs');
    if (!tabs) return;
    const tools = this._getTools();
    tabs.innerHTML = tools.map(t => `
      <button class="ci-tab ${t.id === this._activeTab ? 'active' : ''}" data-tab="${t.id}"
        style="padding:0.4rem 0.6rem;background:${t.id === this._activeTab ? 'var(--bg3)' : 'transparent'};border:none;color:${t.available ? 'var(--text1)' : 'var(--text3)'};cursor:${t.available ? 'pointer' : 'not-allowed'};border-radius:4px;font-size:0.75rem;text-align:left;white-space:nowrap;"
        ${!t.available ? 'title="' + t.reason + '"' : ''}>
        ${t.icon} ${t.label}
      </button>
    `).join('');
    tabs.querySelectorAll('.ci-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.tab;
        const tool = this._getTools().find(t => t.id === id);
        if (!tool?.available) { this._showNotice(tool?.reason || 'Nicht verfügbar.'); return; }
        this._activeTab = id;
        this._renderTools();
        this._renderToolView(id);
      });
    });
    // Show active tool view
    const activeTool = this._getTools().find(t => t.id === this._activeTab);
    if (activeTool && !activeTool.available) {
      this._activeTab = 'code-search';
      this._renderTools();
    }
    this._renderToolView(this._activeTab);
  },

  _getTools() {
    const hasPublicWWW = !!ApiKeyManager.getKey('publicwww');
    const hasVT = !!ApiKeyManager.getKey('virustotal');
    const hasUrlscan = !!ApiKeyManager.getKey('urlscanio');
    return [
      { id: 'code-search', label: 'Code Search', icon: '🔍', available: true },
      { id: 'plagiarism', label: 'Plagiarism Check', icon: '📋', available: true },
      { id: 'api-examples', label: 'API Examples', icon: '🔌', available: true },
      { id: 'web-code', label: 'Public Web Code', icon: '🌐', available: hasPublicWWW, reason: hasPublicWWW ? '' : 'PublicWWW API-Key erforderlich' },
      { id: 'virus', label: 'Virus Check', icon: '🛡️', available: hasVT, reason: hasVT ? '' : 'VirusTotal API-Key erforderlich' },
      { id: 'website-scan', label: 'Website Analyse', icon: '🔬', available: hasUrlscan, reason: hasUrlscan ? '' : 'urlscan.io API-Key erforderlich' },
      { id: 'dep-check', label: 'Dependency Check', icon: '📦', available: true },
      { id: 'secret-scanner', label: 'Secret Scanner', icon: '🔑', available: true },
      { id: 'health-scan', label: 'Project Health Scan', icon: '🔍', available: true },
    ];
  },

  _showNotice(msg) {
    if (!this._resultsEl) return;
    this._resultsEl.innerHTML = `<div style="padding:1rem;color:var(--text3);font-size:0.8rem;text-align:center;">${msg}</div>`;
  },

  _playEventSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch(e) { /* silent */ }
  },

  _renderProjectHealth() {
    this._resultsEl.innerHTML = `
      <div class="ci-v2-section">
        <button class="ci-v2-btn ci-v2-btn-primary" id="ci-scan-start">🔍 Scan starten</button>
      </div>
      <div id="ci-scan-results"></div>
    `;
    document.getElementById('ci-scan-start').onclick = () => this._runHealthScan();
  },

  async _runHealthScan() {
    const el = document.getElementById('ci-scan-results');
    el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text2);">Scanne...</div>';
    const results = [];

    // 1. Build check
    try {
      const buildRes = await window.api.runTerminalCommand('npm run build 2>&1 || true');
      const ok = buildRes.exitCode === 0 || !buildRes.stderr?.includes('ERR');
      results.push({ label: 'Build', ok, detail: ok ? 'Build erfolgreich' : 'Build fehlgeschlagen', severity: ok ? 'pass' : 'fail' });
    } catch {
      results.push({ label: 'Build', ok: false, detail: 'Build konnte nicht ausgeführt werden', severity: 'fail' });
    }

    // 2. Outdated packages
    try {
      const outdatedRes = await window.api.runTerminalCommand('npm outdated --json 2>&1 || true');
      let outdated = [];
      try { outdated = JSON.parse(outdatedRes.stdout || '{}'); } catch {}
      const keys = Object.keys(outdated);
      results.push({ label: 'Veraltete Pakete', ok: keys.length === 0, detail: keys.length === 0 ? 'Keine veralteten Pakete' : keys.length + ' veraltete Pakete: ' + keys.join(', '), severity: keys.length === 0 ? 'pass' : keys.length > 5 ? 'fail' : 'warn' });
    } catch {
      results.push({ label: 'Veraltete Pakete', ok: false, detail: 'Prüfung fehlgeschlagen', severity: 'fail' });
    }

    // 3. Git status
    try {
      const gitRes = await window.api.runTerminalCommand('git status --porcelain 2>&1');
      const lines = (gitRes.stdout || '').trim().split('\n').filter(Boolean);
      results.push({ label: 'Git Status', ok: lines.length === 0, detail: lines.length === 0 ? 'Sauberer Working Tree' : lines.length + ' uncommitted Datei(en)', severity: lines.length === 0 ? 'pass' : lines.length > 10 ? 'fail' : 'warn' });
    } catch {
      results.push({ label: 'Git Status', ok: false, detail: 'Kein Git-Repository', severity: 'fail' });
    }

    // 4. Security audit
    try {
      const auditRes = await window.api.runTerminalCommand('npm audit --json 2>&1 || true');
      let audit = {};
      try { audit = JSON.parse(auditRes.stdout || '{}'); } catch {}
      const vulns = audit.vulnerabilities || {};
      const critical = Object.values(vulns).filter(v => v.severity === 'critical').length;
      const high = Object.values(vulns).filter(v => v.severity === 'high').length;
      const moderate = Object.values(vulns).filter(v => v.severity === 'moderate').length;
      results.push({
        label: 'Sicherheit',
        ok: critical === 0 && high === 0,
        detail: critical + ' critical, ' + high + ' high, ' + moderate + ' moderate',
        severity: critical > 0 ? 'fail' : high > 0 ? 'warn' : 'pass'
      });
    } catch {
      results.push({ label: 'Sicherheit', ok: false, detail: 'Audit fehlgeschlagen', severity: 'fail' });
    }

    // 5. Backup check
    try {
      const backupRes = await window.api.runTerminalCommand('Get-ChildItem -LiteralPath "." -Filter "backup-*" -Name 2>$null; Get-ChildItem -LiteralPath "." -Filter "*.bak" -Name 2>$null');
      const backupFiles = (backupRes.stdout || '').trim().split('\n').filter(Boolean);
      const hasBackup = backupFiles.length > 0;
      results.push({ label: 'Backup', ok: hasBackup, detail: hasBackup ? 'Backup gefunden: ' + backupFiles[0] : 'Kein Backup vorhanden', severity: hasBackup ? 'pass' : 'warn' });
    } catch {
      results.push({ label: 'Backup', ok: false, detail: 'Backup-Prüfung fehlgeschlagen', severity: 'warn' });
    }

    // Render
    const passed = results.filter(r => r.ok).length;
    const warned = results.filter(r => r.severity === 'warn').length;
    const failed = results.filter(r => r.severity === 'fail').length;
    el.innerHTML = results.map(r =>
      `<div class="ci-scan-row"><span class="ci-scan-icon ci-scan-${r.severity}">${r.ok ? '✅' : '❌'}</span><span class="ci-scan-${r.severity}">${escapeHtml(r.label)}:</span> ${escapeHtml(r.detail)}</div>`
    ).join('') + `<div class="ci-scan-summary">${passed}/5 bestanden${warned ? ', ' + warned + ' Warnung(en)' : ''}${failed ? ', ' + failed + ' Fehler' : ''}</div>`;

    this._playEventSound();
  },

  _renderToolView(toolId) {
    if (!this._resultsEl) return;
    const views = {
      'code-search': this._renderCodeSearch.bind(this),
      'plagiarism': this._renderPlagiarism.bind(this),
      'api-examples': this._renderApiExamples.bind(this),
      'web-code': this._renderWebCode.bind(this),
      'virus': this._renderVirusCheck.bind(this),
      'website-scan': this._renderWebsiteScan.bind(this),
      'dep-check': this._renderDepCheck.bind(this),
      'secret-scanner': this._renderSecretScanner.bind(this),
      'health-scan': this._renderProjectHealth.bind(this),
    };
    (views[toolId] || views['code-search'])();
  },

  // ========= Code Search =========
  _renderCodeSearch() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="display:flex;gap:0.3rem;margin-bottom:0.5rem;">
          <input id="ci-search-input" type="text" placeholder="Code-Suche (z.B. 'mern stack auth')"
            style="flex:1;padding:0.4rem 0.6rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;">
          <button id="ci-search-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Suchen</button>
        </div>
        <div id="ci-search-results" style="font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-search-btn').onclick = () => this._doCodeSearch();
    document.getElementById('ci-search-input').onkeydown = (e) => { if (e.key === 'Enter') this._doCodeSearch(); };
  },

  async _doCodeSearch() {
    const input = document.getElementById('ci-search-input');
    const results = document.getElementById('ci-search-results');
    if (!input?.value.trim()) return;
    results.innerHTML = 'Suche...';
    try {
      const q = encodeURIComponent(input.value.trim());
      const r = await fetch('https://api.searchcode.com/api/v1/search/?q=' + q, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (data.results?.length > 0) {
        results.innerHTML = data.results.slice(0, 15).map(item => `
          <div style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
            <a href="${item.url}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500;">${item.name}</a>
            <div style="color:var(--text3);font-size:0.7rem;">${item.filename || ''} — ${(item.lines || '')}</div>
            <pre style="background:var(--bg3);padding:0.3rem;border-radius:4px;font-size:0.65rem;overflow:hidden;margin-top:0.2rem;">${(item.code || '').slice(0, 300)}</pre>
          </div>
        `).join('');
      } else {
        results.innerHTML = 'Keine Ergebnisse gefunden.';
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= Plagiarism Check =========
  _renderPlagiarism() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="margin-bottom:0.5rem;">
          <textarea id="ci-plag-text" placeholder="Code einfügen oder Projekt-Datei auswählen..."
            style="width:100%;height:100px;padding:0.4rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;resize:vertical;box-sizing:border-box;"></textarea>
        </div>
        <div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.5rem;">
          <label><input type="checkbox" id="ci-plag-local"> Auch lokale Projekt-Dateien durchsuchen</label>
        </div>
        <button id="ci-plag-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Prüfen</button>
        <div id="ci-plag-results" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-plag-btn').onclick = () => this._doPlagiarismCheck();
  },

  async _doPlagiarismCheck() {
    const text = document.getElementById('ci-plag-text')?.value;
    const results = document.getElementById('ci-plag-results');
    if (!text?.trim()) { results.innerHTML = 'Bitte Code einfügen.'; return; }
    results.innerHTML = 'Suche nach ähnlichem Code...';
    try {
      const q = encodeURIComponent(text.trim().slice(0, 200));
      const r = await fetch('https://api.searchcode.com/api/v1/search/?q=' + q, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (data.results?.length > 0) {
        results.innerHTML = '<div style="margin-bottom:0.3rem;color:var(--text2);">Mögliche Übereinstimmungen:</div>' +
          data.results.slice(0, 10).map(item => `
            <div style="padding:0.3rem 0;border-bottom:1px solid var(--border);">
              <a href="${item.url}" target="_blank" style="color:var(--accent);text-decoration:none;">${item.name}</a>
              <span style="color:var(--text3);font-size:0.7rem;"> — ${item.filename || ''}</span>
            </div>
          `).join('');
      } else {
        results.innerHTML = 'Keine Übereinstimmungen gefunden.';
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= API Examples =========
  _renderApiExamples() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="display:flex;gap:0.3rem;margin-bottom:0.5rem;">
          <input id="ci-api-input" type="text" placeholder="z.B. 'express middleware', 'python requests'"
            style="flex:1;padding:0.4rem 0.6rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;">
          <button id="ci-api-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Suchen</button>
        </div>
        <div id="ci-api-results" style="font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-api-btn').onclick = () => this._doApiSearch();
    document.getElementById('ci-api-input').onkeydown = (e) => { if (e.key === 'Enter') this._doApiSearch(); };
  },

  async _doApiSearch() {
    const input = document.getElementById('ci-api-input');
    const results = document.getElementById('ci-api-results');
    if (!input?.value.trim()) return;
    results.innerHTML = 'Suche...';
    try {
      const q = encodeURIComponent(input.value.trim() + ' example');
      const r = await fetch('https://api.searchcode.com/api/v1/search/?q=' + q, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (data.results?.length > 0) {
        results.innerHTML = data.results.slice(0, 12).map(item => `
          <div style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
            <a href="${item.url}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500;">${item.name}</a>
            <div style="color:var(--text3);font-size:0.7rem;">${item.filename || ''} — ${item.language || item.repo || ''}</div>
            <pre style="background:var(--bg3);padding:0.3rem;border-radius:4px;font-size:0.65rem;overflow:hidden;margin-top:0.2rem;">${(item.code || '').slice(0, 200)}</pre>
          </div>
        `).join('');
      } else {
        results.innerHTML = 'Keine Beispiele gefunden.';
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= Public Web Code (PublicWWW) =========
  _renderWebCode() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="display:flex;gap:0.3rem;margin-bottom:0.5rem;">
          <input id="ci-web-input" type="text" placeholder="Code-Snippet im Web suchen..."
            style="flex:1;padding:0.4rem 0.6rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;">
          <button id="ci-web-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Suchen</button>
        </div>
        <div id="ci-web-results" style="font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-web-btn').onclick = () => this._doWebCodeSearch();
    document.getElementById('ci-web-input').onkeydown = (e) => { if (e.key === 'Enter') this._doWebCodeSearch(); };
  },

  async _doWebCodeSearch() {
    const input = document.getElementById('ci-web-input');
    const results = document.getElementById('ci-web-results');
    if (!input?.value.trim()) return;
    const key = ApiKeyManager.getKey('publicwww');
    if (!key) { results.innerHTML = 'PublicWWW API-Key nicht konfiguriert.'; return; }
    results.innerHTML = 'Suche im Web...';
    try {
      const q = encodeURIComponent(input.value.trim());
      const r = await fetch('https://publicwww.com/websites/' + q + '/?key=' + encodeURIComponent(key) + '&export=csvsnippets', {
        headers: { 'Accept': 'text/csv' }, signal: AbortSignal.timeout(20000)
      });
      const text = await r.text();
      if (text.trim()) {
        const lines = text.trim().split('\n').slice(0, 20);
        results.innerHTML = '<div style="margin-bottom:0.3rem;color:var(--text2);">Gefundene Web-Seiten (' + lines.length + '):</div>' +
          lines.map(line => `<div style="padding:0.2rem 0;border-bottom:1px solid var(--border);font-size:0.7rem;word-break:break-all;">${line}</div>`).join('');
      } else {
        results.innerHTML = 'Keine Ergebnisse.';
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= Virus Check =========
  _renderVirusCheck() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="margin-bottom:0.5rem;">
          <label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:0.3rem;">Datei auswählen oder URL eingeben:</label>
          <div style="display:flex;gap:0.3rem;">
            <input id="ci-virus-file" type="file" style="flex:1;font-size:0.75rem;color:var(--text1);">
          </div>
          <div style="margin-top:0.3rem;">
            <input id="ci-virus-url" type="text" placeholder="Oder URL zum Scannen..."
              style="width:100%;padding:0.4rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;box-sizing:border-box;">
          </div>
        </div>
        <button id="ci-virus-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Scannen</button>
        <div id="ci-virus-results" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-virus-btn').onclick = () => this._doVirusCheck();
  },

  async _doVirusCheck() {
    const key = ApiKeyManager.getKey('virustotal');
    const results = document.getElementById('ci-virus-results');
    if (!key) { results.innerHTML = 'VirusTotal API-Key nicht konfiguriert.'; return; }
    const fileInput = document.getElementById('ci-virus-file');
    const urlInput = document.getElementById('ci-virus-url');
    if (fileInput?.files?.[0]) {
      results.innerHTML = 'Datei wird hochgeladen und gescannt...';
      try {
        const form = new FormData();
        form.append('file', fileInput.files[0]);
        const r = await fetch('https://www.virustotal.com/api/v3/files', {
          method: 'POST', headers: { 'x-apikey': key }, body: form, signal: AbortSignal.timeout(60000)
        });
        const data = await r.json();
        const id = data.data?.id;
        if (id) {
          results.innerHTML = 'Datei hochgeladen. Analyse-ID: ' + id + '<br><a href="https://www.virustotal.com/gui/file/' + id.split(':')[0] + '" target="_blank" style="color:var(--accent);">Ergebnisse auf VirusTotal ansehen</a>';
        } else {
          results.innerHTML = 'Fehler: ' + JSON.stringify(data.error || data);
        }
      } catch (e) {
        results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
      }
    } else if (urlInput?.value.trim()) {
      results.innerHTML = 'URL wird gescannt...';
      try {
        const r = await fetch('https://www.virustotal.com/api/v3/urls', {
          method: 'POST', headers: { 'x-apikey': key, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'url=' + encodeURIComponent(urlInput.value.trim()), signal: AbortSignal.timeout(30000)
        });
        const data = await r.json();
        const id = data.data?.id;
        if (id) {
          results.innerHTML = 'URL gesendet. Analyse-ID: ' + id + '<br><a href="https://www.virustotal.com/gui/url/' + id + '" target="_blank" style="color:var(--accent);">Ergebnisse auf VirusTotal ansehen</a>';
        } else {
          results.innerHTML = 'Fehler: ' + JSON.stringify(data.error || data);
        }
      } catch (e) {
        results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
      }
    } else {
      results.innerHTML = 'Bitte eine Datei auswählen oder URL eingeben.';
    }
  },

  // ========= Website Analyse (urlscan.io) =========
  _renderWebsiteScan() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="margin-bottom:0.5rem;">
          <input id="ci-scan-url" type="text" placeholder="Website-URL (z.B. https://example.com)"
            style="width:100%;padding:0.4rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;box-sizing:border-box;">
        </div>
        <button id="ci-scan-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Analysieren</button>
        <div id="ci-scan-results" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-scan-btn').onclick = () => this._doWebsiteScan();
    document.getElementById('ci-scan-url').onkeydown = (e) => { if (e.key === 'Enter') this._doWebsiteScan(); };
  },

  async _doWebsiteScan() {
    const input = document.getElementById('ci-scan-url');
    const results = document.getElementById('ci-scan-results');
    const key = ApiKeyManager.getKey('urlscanio');
    if (!input?.value.trim()) return;
    if (!key) { results.innerHTML = 'urlscan.io API-Key nicht konfiguriert.'; return; }
    let url = input.value.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    results.innerHTML = 'Scan wird gestartet...';
    try {
      const r = await fetch('https://urlscan.io/api/v1/scan/', {
        method: 'POST', headers: { 'API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, visibility: 'public' }), signal: AbortSignal.timeout(30000)
      });
      const data = await r.json();
      if (data.uuid) {
        results.innerHTML = 'Scan gestartet! UUID: ' + data.uuid + '<br>' +
          '<a href="' + (data.result || 'https://urlscan.io/result/' + data.uuid + '/') + '" target="_blank" style="color:var(--accent);">Ergebnisse auf urlscan.io ansehen</a>';
      } else {
        results.innerHTML = 'Fehler: ' + JSON.stringify(data.message || data);
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= Dependency Check =========
  _renderDepCheck() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="font-size:0.75rem;color:var(--text3);margin-bottom:0.5rem;">
          Durchsucht package.json, requirements.txt, Cargo.toml, etc. nach bekannten Sicherheitslücken.
        </div>
        <button id="ci-dep-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Projekt prüfen</button>
        <div id="ci-dep-results" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-dep-btn').onclick = () => this._doDepCheck();
  },

  async _doDepCheck() {
    const results = document.getElementById('ci-dep-results');
    if (!currentProject) { results.innerHTML = 'Kein Projekt geöffnet.'; return; }
    results.innerHTML = 'Dateien lesen...';
    try {
      const files = await window.electronAPI.projectListFiles(currentProject);
      const depFiles = files.filter(f => /package\.json|requirements\.txt|Cargo\.toml|Pipfile|Gemfile/i.test(f));
      if (depFiles.length === 0) { results.innerHTML = 'Keine Dependencies-Dateien gefunden.'; return; }
      let output = '';
      for (const df of depFiles) {
        const content = await window.electronAPI.projectReadFile(currentProject, df);
        if (df === 'package.json') {
          try {
            const json = JSON.parse(content);
            const deps = { ...json.dependencies, ...json.devDependencies };
            for (const [name, ver] of Object.entries(deps)) {
              const cleanVer = (ver || '').replace(/^[\^~>=<]/, '');
              output += `<div style="padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.75rem;">
                <span style="font-weight:500;">${name}</span>
                <span style="color:var(--text3);"> ${cleanVer}</span>
                <span id="dep-check-${name.replace(/\//g, '-')}" style="margin-left:0.5rem;font-size:0.7rem;">Prüfe...</span>
              </div>`;
            }
          } catch {}
        } else {
          for (const line of content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))) {
            output += `<div style="padding:0.2rem 0;font-size:0.75rem;">${line}</div>`;
          }
        }
      }
      results.innerHTML = '<div style="margin-bottom:0.3rem;color:var(--text2);">Gefundene Dependencies:</div>' + output;

      // Check each dep against OSV API
      for (const df of depFiles) {
        const content = await window.electronAPI.projectReadFile(currentProject, df);
        if (df === 'package.json') {
          try {
            const json = JSON.parse(content);
            const deps = { ...json.dependencies, ...json.devDependencies };
            for (const [name, ver] of Object.entries(deps)) {
              const cleanVer = (ver || '').replace(/^[\^~>=<]/, '');
              try {
                const osv = await fetch('https://api.osv.dev/v1/query', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ package: { name, ecosystem: 'npm' }, version: cleanVer }),
                  signal: AbortSignal.timeout(10000)
                });
                const osvData = await osv.json();
                const vulns = osvData.vulns || [];
                const el = document.getElementById('dep-check-' + name.replace(/\//g, '-'));
                if (el) {
                  if (vulns.length > 0) {
                    el.innerHTML = '⚠️ ' + vulns.length + ' known vuln(s)';
                    el.style.color = '#ef4444';
                  } else {
                    el.innerHTML = '✅ Sicher';
                    el.style.color = '#22c55e';
                  }
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },

  // ========= Secret Scanner =========
  _renderSecretScanner() {
    this._resultsEl.innerHTML = `
      <div style="padding:0.5rem 0.75rem;">
        <div style="margin-bottom:0.5rem;">
          <input id="ci-secret-input" type="text" placeholder="API-Key, Token oder Text zum Suchen..."
            style="width:100%;padding:0.4rem;background:var(--bg3);color:var(--text1);border:1px solid var(--border);border-radius:4px;font-size:0.75rem;box-sizing:border-box;">
        </div>
        <div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.5rem;">
          Sucht im Internet nach öffentlich zugänglichen Versionen dieses Keys/Tokens.
          Unterstützt: API Keys, Passwörter, Tokens, beliebiger Text.
        </div>
        <button id="ci-secret-btn" style="background:var(--accent);border:none;color:#fff;border-radius:4px;padding:0.4rem 0.8rem;cursor:pointer;font-size:0.75rem;">Suchen</button>
        <div id="ci-secret-results" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3);"></div>
      </div>
    `;
    document.getElementById('ci-secret-btn').onclick = () => this._doSecretScan();
    document.getElementById('ci-secret-input').onkeydown = (e) => { if (e.key === 'Enter') this._doSecretScan(); };
  },

  async _doSecretScan() {
    const input = document.getElementById('ci-secret-input');
    const results = document.getElementById('ci-secret-results');
    if (!input?.value.trim()) return;
    const key = ApiKeyManager.getKey('publicwww');
    results.innerHTML = 'Durchsuche das Internet...';
    try {
      let findings = [];

      // Try PublicWWW if available
      if (key) {
        try {
          const q = encodeURIComponent(input.value.trim());
          const r = await fetch('https://publicwww.com/websites/' + q + '/?key=' + encodeURIComponent(key) + '&export=csvsnippets', {
            headers: { 'Accept': 'text/csv' }, signal: AbortSignal.timeout(20000)
          });
          const text = await r.text();
          if (text.trim()) {
            findings.push({ source: 'PublicWWW', count: text.trim().split('\n').length, data: text.trim().slice(0, 500) });
          }
        } catch {}
      }

      // Try searchcode as fallback
      try {
        const q = encodeURIComponent(input.value.trim().slice(0, 100));
        const r = await fetch('https://api.searchcode.com/api/v1/search/?q=' + q, { signal: AbortSignal.timeout(15000) });
        const data = await r.json();
        if (data.results?.length > 0) {
          findings.push({ source: 'searchcode', count: data.results.length, data: data.results.slice(0, 5).map(i => i.url).join('\n') });
        }
      } catch {}

      if (findings.length > 0) {
        results.innerHTML = findings.map(f => `
          <div style="padding:0.4rem;margin-bottom:0.3rem;border:1px solid var(--border);border-radius:4px;">
            <div style="font-weight:500;font-size:0.75rem;color:${f.source === 'PublicWWW' ? '#eab308' : '#ef4444'};">${f.source} — ${f.count} Treffer</div>
            <pre style="font-size:0.65rem;color:var(--text3);margin-top:0.2rem;white-space:pre-wrap;">${f.data}</pre>
          </div>
        `).join('');
      } else {
        results.innerHTML = 'Keine öffentlichen Vorkommen gefunden.';
      }
    } catch (e) {
      results.innerHTML = 'Fehler: ' + (e.message || 'Netzwerkfehler');
    }
  },
};
