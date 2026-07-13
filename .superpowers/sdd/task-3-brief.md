# Task 3: JavaScript — AuditLog Object + Tab Wiring + Init Calls

**Goal:** Add the complete AuditLog object to script.js with localStorage persistence, render, filter, search and AI search. Wire up tab switching in the overlay. Add init and setProject calls.

**File:** Modify `App/renderer/script.js`

**Context:** This is an Electron IDE. The existing code has:
- Simple audit log variables/functions at lines 1-10 (`let auditLog = []`, `addAuditEntry`) — DO NOT TOUCH
- Modal handlers at lines 3427+ (`renderAuditLog`, `btn-audit-log`) — DO NOT TOUCH  
- **Insertion point 1:** After DecisionLog ends (line `};` at 6656, empty line at 6657, before `// ==================== RAG MANAGER` at 6658)
- **Insertion point 2:** After `DecisionLog.setProject(name);` (line 2462)
- **Insertion point 3:** After `DecisionLog.init();` (line 6853)

## Step 1: Insert AuditLog object

Insert between line 6657 (empty line after DecisionLog's `};`) and line 6658 (`// ==================== RAG MANAGER`).

The exact insertion code is:

```javascript

// ==================== KI-AKTIONEN AUDIT LOG ====================

const AuditLog = {
  _logs: [],
  _currentProject: null,
  _aiMode: false,
  _maxLogs: 500,

  init() {
    // Overlay tab switching
    document.querySelectorAll('.audit-overlay-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.audit-overlay-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.audit-overlay-content').forEach(el => {
          el.classList.toggle('hidden', el.id !== 'audit-' + tab + '-tab');
        });
        if (tab === 'actions') {
          this._populateFilters();
          this.render();
        }
      });
    });

    // KI actions tab controls
    document.getElementById('btn-audit-ai-toggle')?.addEventListener('click', () => {
      this._aiMode = !this._aiMode;
      document.getElementById('btn-audit-ai-toggle')?.classList.toggle('active', this._aiMode);
      const search = document.getElementById('audit-ki-search');
      if (search) search.placeholder = this._aiMode ? 'Ask AI about logs...' : 'Search logs...';
      if (this._aiMode) this._doAiSearch();
    });
    document.getElementById('audit-ki-search')?.addEventListener('input', debounce(() => {
      if (!this._aiMode) this.render();
    }, 250));
    document.getElementById('audit-ki-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this._aiMode) this._doAiSearch();
    });
    document.getElementById('audit-ki-filter-type')?.addEventListener('change', () => this.render());
    document.getElementById('audit-ki-filter-status')?.addEventListener('change', () => this.render());
    document.getElementById('audit-ki-filter-date')?.addEventListener('change', () => this.render());
  },

  setProject(name) {
    this._currentProject = name;
    this._load();
  },

  log(entry) {
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type: entry.type || 'unknown',
      action: entry.action || '',
      status: entry.status || 'auto',
      summary: entry.summary || '',
      details: entry.details || {},
      source: entry.source || 'KI',
      project: this._currentProject,
      sessionId: entry.sessionId || null
    };
    this._logs.unshift(logEntry);
    if (this._logs.length > this._maxLogs) this._logs.length = this._maxLogs;
    this._save();
  },

  _load() {
    if (!this._currentProject) return;
    try {
      const key = 'florde-audit-ki-' + this._currentProject;
      this._logs = JSON.parse(localStorage.getItem(key)) || [];
    } catch { this._logs = []; }
  },

  _save() {
    if (!this._currentProject) return;
    localStorage.setItem('florde-audit-ki-' + this._currentProject, JSON.stringify(this._logs));
  },

  _populateFilters() {
    const typeSelect = document.getElementById('audit-ki-filter-type');
    if (!typeSelect) return;
    const types = [...new Set(this._logs.map(l => l.type).filter(Boolean))];
    const current = typeSelect.value;
    typeSelect.innerHTML = '<option value="all">All Types</option>' +
      types.map(t => `<option value="${t}">${this._typeLabel(t)}</option>`).join('');
    if (current && types.includes(current)) typeSelect.value = current;

    const statusSelect = document.getElementById('audit-ki-filter-status');
    if (!statusSelect) return;
    const statuses = [...new Set(this._logs.map(l => l.status).filter(Boolean))];
    const curStatus = statusSelect.value;
    statusSelect.innerHTML = '<option value="all">All Status</option>' +
      statuses.map(s => `<option value="${s}">${this._statusLabel(s)}</option>`).join('');
    if (curStatus && statuses.includes(curStatus)) statusSelect.value = curStatus;
  },

  _typeLabel(type) {
    const labels = {
      file_read: 'File Read', file_write: 'File Write', command: 'Command',
      api_access: 'API Access', note_create: 'Note', chat: 'Chat'
    };
    return labels[type] || type;
  },

  _statusLabel(status) {
    const labels = { allowed: 'Allowed', blocked: 'Blocked', auto: 'Automatic', pending: 'Pending' };
    return labels[status] || status;
  },

  _statusIcon(status) {
    const icons = { allowed: '✓', blocked: '✗', auto: '⚡', pending: '○' };
    return icons[status] || '?';
  },

  _typeIcon(type) {
    const icons = {
      file_read: '📄', file_write: '📝', command: '🔒',
      api_access: '🔌', note_create: '📋', chat: '💬'
    };
    return icons[type] || '•';
  },

  render() {
    const container = document.getElementById('audit-actions-list');
    if (!container) return;

    const typeFilter = document.getElementById('audit-ki-filter-type')?.value || 'all';
    const statusFilter = document.getElementById('audit-ki-filter-status')?.value || 'all';
    const dateFilter = document.getElementById('audit-ki-filter-date')?.value || 'all';
    const searchText = document.getElementById('audit-ki-search')?.value?.toLowerCase().trim() || '';

    let filtered = this._logs;

    if (typeFilter !== 'all') filtered = filtered.filter(l => l.type === typeFilter);
    if (statusFilter !== 'all') filtered = filtered.filter(l => l.status === statusFilter);

    const now = Date.now();
    if (dateFilter === 'today') {
      const today = new Date(); today.setHours(0,0,0,0);
      filtered = filtered.filter(l => new Date(l.timestamp) >= today);
    } else if (dateFilter === 'week') {
      filtered = filtered.filter(l => now - new Date(l.timestamp).getTime() < 7 * 86400000);
    } else if (dateFilter === 'month') {
      filtered = filtered.filter(l => now - new Date(l.timestamp).getTime() < 30 * 86400000);
    }

    if (searchText && !this._aiMode) {
      filtered = filtered.filter(l =>
        l.summary?.toLowerCase().includes(searchText) ||
        l.action?.toLowerCase().includes(searchText) ||
        JSON.stringify(l.details)?.toLowerCase().includes(searchText)
      );
    }

    const count = document.getElementById('audit-ki-count');
    if (count) count.textContent = filtered.length + ' entries';

    if (!filtered.length) {
      container.innerHTML = '<div class="audit-ki-empty">No matching log entries</div>';
      return;
    }

    container.innerHTML = filtered.map(l => {
      const time = new Date(l.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const detailRows = l.details ? Object.entries(l.details)
        .map(([k, v]) => `<div class="audit-ki-entry-detail-row"><strong>${k}:</strong> ${escapeHtml(String(v))}</div>`)
        .join('') : '';
      return `
        <div class="audit-ki-entry" data-id="${l.id}">
          <div class="audit-ki-entry-icon">${this._typeIcon(l.type)}</div>
          <div class="audit-ki-entry-body">
            <div class="audit-ki-entry-header">
              <span class="audit-ki-entry-action">${escapeHtml(l.action)}</span>
              <span class="audit-ki-entry-status audit-ki-status-${l.status}">${this._statusIcon(l.status)} ${this._statusLabel(l.status)}</span>
              <span class="audit-ki-entry-time">${timeStr}</span>
            </div>
            <div class="audit-ki-entry-summary">${escapeHtml(l.summary)}</div>
            ${detailRows ? `<div class="audit-ki-entry-details">${detailRows}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.audit-ki-entry').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('expanded');
      });
    });
  },

  async _doAiSearch() {
    const search = document.getElementById('audit-ki-search');
    const query = search?.value?.trim();
    if (!query) return;
    const container = document.getElementById('audit-actions-list');
    if (!container) return;

    const recentLogs = this._logs.slice(0, 50);
    const context = recentLogs.map(l =>
      `[${new Date(l.timestamp).toLocaleString()}] ${l.action} | ${l.status} | ${l.summary}`
    ).join('\n');

    container.innerHTML = `<div class="audit-ai-result">Searching logs...</div>`;

    try {
      const provider = document.getElementById('provider-select').value;
      const prov = window.providers?.[provider];
      if (!prov || !prov.sendPlain) {
        container.innerHTML = `<div class="audit-ai-result" style="color:#ef4444;">No active AI provider configured</div>`;
        return;
      }
      const response = await prov.sendPlain([
        { role: 'system', content: 'You are analyzing audit logs. Answer concisely based on the logs provided.' },
        { role: 'user', content: `Here are the most recent logs:\n\n${context}\n\nUser question: ${query}` }
      ]);
      container.innerHTML = `<div class="audit-ai-result">${escapeHtml(response)}</div>`;
    } catch (e) {
      container.innerHTML = `<div class="audit-ai-result" style="color:#ef4444;">AI search error: ${escapeHtml(e.message)}</div>`;
    }
  }
};
```

## Step 2: Add setProject call

After `  DecisionLog.setProject(name);` (currently at line 2462), add:
```javascript
  AuditLog.setProject(name);
```

## Step 3: Add init call

After `DecisionLog.init();` (currently at line 6853), and before `ManagementPanel.init();` (line 6854), add:
```javascript
AuditLog.init();
```

## Verification

After all edits:
- Run: `node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log(e.message); }"`
- Expected: `OK`

## Report

Write report to `.superpowers/sdd/task-3-report.md`
