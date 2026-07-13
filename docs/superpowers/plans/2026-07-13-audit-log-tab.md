# Audit Log Tab (im Overlay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "KI-Aktionen" tab to the existing Audit Log overlay modal that records structured KI actions (file ops, commands, API access, notes, chat) with permission status and filters/search.

**Architecture:** Keep existing simple audit log (cloud/local messages). Add new structured `AuditLog` object with localStorage persistence. Tab system in the modal switches between old and new view.

**Tech Stack:** Vanilla JS, localStorage, existing modal pattern.

## Global Constraints

- Existing audit overlay modal (`#audit-modal`) remains — add tab buttons
- Existing `auditLog` array + `addAuditEntry` + `renderAuditLog` remain untouched
- New AuditLog stores in localStorage under `florde-audit-{project}`
- Max 500 entries (oldest removed)
- AI search uses `providers[provider].sendPlain(messages)` (not ChatManager)

---

### Task 1: HTML — Add Tabs + KI-Aktionen Panel im Audit Modal

**Files:**
- Modify: `App/renderer/index.html` (audit-modal section)

- [ ] **Step 1: Add tab bar to the audit modal**

Replace the modal content div to include tabs. Add tab buttons before the existing content, and wrap old content in a tab container:
```html
  <div id="audit-modal" class="modal hidden">
    <div class="modal-content" style="max-width:750px;min-width:550px;max-height:85vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:1rem;padding:0 0 0.5rem;">
        <h2 style="margin:0;">Daten-Audit-Log</h2>
        <div id="audit-overlay-tabs" style="display:flex;gap:2px;margin-left:auto;">
          <button class="audit-overlay-tab active" data-tab="messages">Cloud/Lokal</button>
          <button class="audit-overlay-tab" data-tab="actions">KI-Aktionen</button>
        </div>
      </div>
      <!-- Messages Tab -->
      <div id="audit-messages-tab" class="audit-overlay-content">
        <p style="color:var(--text2);margin-bottom:1rem;font-size:0.85rem;">&#128200; Was wurde an die Cloud gesendet vs. lokal verarbeitet</p>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;">
          <div id="audit-summary" style="flex:1;display:flex;gap:1rem;"></div>
        </div>
        <div style="border-bottom:1px solid var(--border);margin-bottom:0.5rem;padding-bottom:0.3rem;display:flex;gap:0.5rem;">
          <button class="audit-filter active" data-filter="all">Alle</button>
          <button class="audit-filter" data-filter="cloud">Cloud</button>
          <button class="audit-filter" data-filter="local">Lokal</button>
        </div>
        <div id="audit-list" class="audit-list" style="max-height:40vh;overflow-y:auto;"></div>
      </div>
      <!-- KI Actions Tab -->
      <div id="audit-actions-tab" class="audit-overlay-content hidden">
        <div id="audit-search-row" style="display:flex;gap:0.3rem;align-items:center;margin-bottom:0.5rem;">
          <input type="text" id="audit-ki-search" placeholder="Search logs or ask AI..." style="flex:1;padding:0.35rem 0.5rem;background:var(--bg1);border:1px solid var(--border2);color:var(--text);border-radius:4px;font-size:0.8rem;" />
          <button id="btn-audit-ai-toggle" title="Toggle AI search" class="audit-ai-btn">&#129302;</button>
        </div>
        <div id="audit-ki-filter-row" style="display:flex;gap:0.3rem;align-items:center;margin-bottom:0.3rem;">
          <select id="audit-ki-filter-type" class="audit-filter-select">
            <option value="all">All Types</option>
          </select>
          <select id="audit-ki-filter-status" class="audit-filter-select">
            <option value="all">All Status</option>
          </select>
          <select id="audit-ki-filter-date" class="audit-filter-select">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
          <span id="audit-ki-count" style="font-size:0.7rem;color:var(--text3);margin-left:auto;">0 entries</span>
        </div>
        <div id="audit-actions-list" style="flex:1;overflow-y:auto;max-height:45vh;"></div>
      </div>
      <div class="modal-actions" style="margin-top:1rem;">
        <button id="btn-audit-clear" class="btn btn-secondary" style="margin-right:auto;">Clear Log</button>
        <button id="btn-close-audit" class="btn btn-secondary">Close</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Verify HTML structure**

Make sure the modal is valid HTML with no unclosed divs.

---

### Task 2: CSS — Overlay Tab Styles + KI-Aktionen Styles

**Files:**
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add styles for overlay tabs and KI actions**

At the end of style.css, add:
```css
/* ==================== AUDIT OVERLAY TABS ==================== */
#audit-overlay-tabs { display: flex; gap: 2px; }
.audit-overlay-tab {
  padding: 0.3rem 0.7rem; background: var(--bg2);
  border: 1px solid var(--border2); color: var(--text2); cursor: pointer;
  border-radius: 4px; font-size: 0.78rem; white-space: nowrap;
}
.audit-overlay-tab:hover { background: var(--bg3); color: var(--text); }
.audit-overlay-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.audit-overlay-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.audit-overlay-content.hidden { display: none; }

/* ==================== KI-AKTIONEN AUDIT ==================== */
.audit-ai-btn {
  background: var(--bg2); border: 1px solid var(--border2);
  color: var(--text3); border-radius: 4px; padding: 0.25rem 0.5rem;
  cursor: pointer; font-size: 0.9rem; line-height: 1;
}
.audit-ai-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); box-shadow: 0 0 8px rgba(124,58,237,0.4); }
.audit-filter-select {
  padding: 0.2rem 0.4rem; background: var(--bg2);
  border: 1px solid var(--border2); color: var(--text);
  border-radius: 3px; font-size: 0.7rem;
}
.audit-ki-entry {
  display: flex; align-items: flex-start; gap: 0.5rem;
  padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border);
  font-size: 0.8rem; cursor: default;
}
.audit-ki-entry:hover { background: var(--hover); }
.audit-ki-entry-icon { font-size: 0.9rem; width: 1.2rem; text-align: center; flex-shrink: 0; margin-top: 0.1rem; }
.audit-ki-entry-body { flex: 1; min-width: 0; }
.audit-ki-entry-header { display: flex; align-items: center; gap: 0.4rem; }
.audit-ki-entry-action { font-weight: 600; color: var(--text); font-size: 0.8rem; }
.audit-ki-entry-time { font-size: 0.65rem; color: var(--text3); margin-left: auto; white-space: nowrap; }
.audit-ki-entry-summary { font-size: 0.73rem; color: var(--text2); margin: 0.1rem 0; word-break: break-word; }
.audit-ki-entry-status { display: inline-block; font-size: 0.6rem; padding: 0.05rem 0.35rem; border-radius: 3px; font-weight: 600; }
.audit-ki-status-allowed { background: rgba(34,197,94,0.15); color: #22c55e; }
.audit-ki-status-blocked { background: rgba(239,68,68,0.15); color: #ef4444; }
.audit-ki-status-auto { background: rgba(107,114,128,0.15); color: var(--text3); }
.audit-ki-status-pending { background: rgba(234,179,8,0.15); color: #eab308; }
.audit-ki-entry-details {
  display: none; font-size: 0.68rem; color: var(--text3);
  padding: 0.3rem; margin-top: 0.3rem;
  background: var(--bg2); border-radius: 4px;
}
.audit-ki-entry.expanded .audit-ki-entry-details { display: block; }
.audit-ki-empty { padding: 2rem; text-align: center; color: var(--text3); font-size: 0.8rem; }
.audit-ai-result {
  padding: 0.75rem; background: rgba(124,58,237,0.08);
  border: 1px solid rgba(124,58,237,0.15); border-radius: 6px;
  margin: 0.5rem; font-size: 0.8rem; color: var(--text);
  white-space: pre-wrap;
}
```

---

### Task 3: JavaScript — AuditLog Object + Tab Wiring

**Files:**
- Modify: `App/renderer/script.js`

- [ ] **Step 1: Add AuditLog object after DecisionLog (before `// ==================== RAG MANAGER` line)**

Insert this code:
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

- [ ] **Step 2: Add init and setProject calls**

In `openProject()`, add after `DecisionLog.setProject(name);`:
```javascript
  AuditLog.setProject(name);
```

In the init chain, add after `DecisionLog.init();`:
```javascript
AuditLog.init();
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log(e.message); }"`
Expected: `OK`

---

### Task 4: Instrumentation — Add AuditLog.log() Calls

**Files:**
- Modify: `App/renderer/script.js`

- [ ] **Step 1: Log chat messages to KI audit log**

Find line with `addAuditEntry(isCloud ? 'cloud' : 'local',...` (around line 4168) and add AuditLog.log() right after it:
```javascript
  AuditLog.log({
    type: 'chat',
    action: 'Nachricht gesendet',
    status: 'auto',
    summary: 'Nachricht an ' + provider + ' (' + (isCloud ? 'Cloud' : 'Lokal') + ')',
    details: { provider, mode: isCloud ? 'cloud' : 'local' },
    source: 'KI'
  });
```

- [ ] **Step 2: Find and log permission decisions**

Search for permission prompt handlers (`btn-permission-allow`, `btn-permission-deny`, `_handlePermission`). In the handler where permission is granted/denied, add:
```javascript
AuditLog.log({
  type: permissionType, // 'file_read', 'file_write', 'command', 'api_access'
  action: result.allowed ? actionString : actionString + ' blockiert',
  status: result.allowed ? 'allowed' : 'blocked',
  summary: summaryText,
  details: detailObject,
  source: 'KI'
});
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "const fs=require('fs'); const code=fs.readFileSync('App/renderer/script.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.log(e.message); }"`
Expected: `OK`
