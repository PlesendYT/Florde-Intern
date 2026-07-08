# MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** MCP (Model Context Protocol) Client in Florde integrieren — AI kann externe Server-Tools nutzen.

**Architecture:** Neuer `App/renderer/mcp-client.js` mit Client-Klasse (stdio + HTTP/SSE Transport). Integration in `getActiveTools()` und `executeToolCall()`. Settings-UI in neuem MCP-Tab.

**Tech Stack:** Electron, vanilla JS, JSON-RPC 2.0, child_process (stdio), fetch/EventSource (HTTP)

## Global Constraints
- Kein Build-Step, keine externen Dependencies
- Nur Fetch/EventSource für HTTP, child_process für stdio (via preload)
- JSON-RPC 2.0 für MCP-Nachrichten

---

### Task 1: MCP Client Module

**Files:**
- Create: `App/renderer/mcp-client.js`

**Interfaces:**
- Produces: `class McpClient` mit `connect()`, `disconnect()`, `listTools()`, `callTool(name, args)`, `onNotification(cb)`

- [ ] **Step 1: Create MCP Client class**

```
// MCP Client — Model Context Protocol (JSON-RPC 2.0)
// Supports stdio and HTTP/SSE transports

class McpClient {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.transport = config.transport || 'stdio'; // 'stdio' | 'http'
    this.command = config.command; // for stdio
    this.args = config.args || []; // for stdio
    this.env = config.env || {}; // for stdio
    this.url = config.url; // for http
    this._requestId = 0;
    this._pending = new Map();
    this._tools = [];
    this._connected = false;
    this._reader = null;
    this._writer = null;
    this._process = null;
    this._eventSource = null;
    this._notificationCb = null;
    this._buffer = '';
  }

  onNotification(cb) { this._notificationCb = cb; }

  async connect() {
    if (this._connected) return;
    if (this.transport === 'stdio') {
      await this._connectStdio();
    } else {
      await this._connectHttp();
    }
    // Initialize
    const initResult = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Florde', version: '1.0' }
    });
    this._connected = true;
    // List tools
    const toolsResult = await this._request('tools/list', {});
    this._tools = (toolsResult.tools || []).map(t => ({
      name: 'mcp_' + this.id + '_' + t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      _originalName: t.name
    }));
    return this._tools;
  }

  async _connectStdio() {
    const { spawn } = window.__mcpSpawn || {};
    if (!spawn) throw new Error('MCP stdio not available (requires preload)');
    this._process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const decoder = new TextDecoder();
    this._buffer = '';
    this._process.stdout.on('data', (chunk) => this._onData(decoder.decode(chunk, { stream: true })));
    this._process.stderr.on('data', (chunk) => { /* ignore stderr or log */ });
    this._process.on('exit', () => { this._connected = false; });
    // Allow process to start
    await new Promise(r => setTimeout(r, 500));
  }

  async _connectHttp() {
    // SSE for notifications, HTTP POST for requests
    const url = this.url.replace(/\/+$/, '');
    this._eventSource = new EventSource(url + '/sse');
    this._eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id !== undefined && this._pending.has(msg.id)) {
          const { resolve } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          resolve(msg);
        } else if (this._notificationCb) {
          this._notificationCb(msg);
        }
      } catch {}
    };
    this._eventSource.onerror = () => { this._connected = false; };
    this._messageUrl = url + '/message';
    await new Promise(r => setTimeout(r, 500));
  }

  _onData(chunk) {
    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this._pending.has(msg.id)) {
          const { resolve } = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          resolve(msg);
        } else if (this._notificationCb) {
          this._notificationCb(msg);
        }
      } catch {}
    }
  }

  async _request(method, params) {
    const id = ++this._requestId;
    const request = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('MCP request timed out: ' + method));
      }, 30000);
      // Store timeout so we can clean up
      const entry = this._pending.get(id);
      if (entry) entry.timeout = timeout;
      this._send(request).catch(reject);
    }).then(msg => {
      if (msg.error) throw new Error(msg.error.message || 'MCP error: ' + JSON.stringify(msg.error));
      return msg.result || {};
    });
  }

  async _send(request) {
    if (this.transport === 'stdio') {
      if (!this._process || !this._process.stdin) throw new Error('MCP: not connected');
      this._process.stdin.write(JSON.stringify(request) + '\n');
    } else {
      const r = await fetch(this._messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      if (!r.ok) throw new Error('MCP HTTP error: ' + r.status);
      // For HTTP transport, response comes via SSE
    }
  }

  async listTools() { return this._tools; }

  async callTool(name, args) {
    const tool = this._tools.find(t => t.name === name || t._originalName === name);
    if (!tool) throw new Error('Unknown MCP tool: ' + name);
    const result = await this._request('tools/call', {
      name: tool._originalName,
      arguments: args
    });
    return result;
  }

  async disconnect() {
    this._connected = false;
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    // Reject all pending
    for (const [id, entry] of this._pending) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('MCP disconnected'));
    }
    this._pending.clear();
    this._tools = [];
  }
}
```

- [ ] **Step 2: Add preload bridge for child_process.spawn**

In `preload.js`:
```
const { spawn } = require('child_process');
contextBridge.exposeInMainWorld('__mcpSpawn', { spawn });
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/mcp-client.js','utf8'))" && echo OK`

---

### Task 2: MCP Settings UI

**Files:**
- Modify: `App/renderer/index.html` (neuer Settings-Tab + MCP Server List)
- Modify: `App/renderer/script.js` (MCP Manager + Settings-Handler)
- Modify: `App/renderer/style.css`

- [ ] **Step 1: Add MCP settings tab**

In `index.html` Settings-Bereich, nach den bestehenden Settings-Tabs:

```
<div class="settings-tab" data-tab="mcp">MCP Servers</div>
```

Dann den Tab-Content-Bereich:

```
<div class="settings-panel hidden" id="settings-mcp">
  <h3>MCP Servers</h3>
  <p style="font-size:0.85rem;color:var(--text3);margin-bottom:1rem;">
    MCP servers provide additional tools to the AI (databases, APIs, file systems).
    Configure servers using the standard MCP JSON format.
  </p>
  <div id="mcp-server-list"></div>
  <button id="btn-add-mcp-server" class="btn btn-secondary" style="margin-top:0.5rem;">+ Add Server</button>
</div>
```

- [ ] **Step 2: Add CSS for MCP UI**

In `style.css`:
```
.mcp-server-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 0.8rem; margin-bottom: 0.5rem; }
.mcp-server-header { display: flex; align-items: center; justify-content: space-between; }
.mcp-server-name { font-weight: 600; }
.mcp-server-status { font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 3px; }
.mcp-server-status.connected { background: rgba(34,197,94,0.2); color: #22c55e; }
.mcp-server-status.error { background: rgba(239,68,68,0.15); color: #ef4444; }
.mcp-server-status.disconnected { background: var(--bg2); color: var(--text3); }
.mcp-server-tools { font-size: 0.8rem; color: var(--text3); margin-top: 0.3rem; }
.mcp-server-config { font-size: 0.8rem; color: var(--text2); margin: 0.5rem 0; }
.mcp-server-config textarea { width: 100%; min-height: 80px; font-family: monospace; font-size: 0.8rem; background: var(--bg2); border: 1px solid var(--border); border-radius: 4px; padding: 0.4rem; color: var(--text); }
.mcp-server-actions { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
.mcp-server-actions button { font-size: 0.75rem; padding: 0.2rem 0.5rem; }
```

- [ ] **Step 3: Add MCP Manager in script.js**

```
// ==================== MCP Manager ====================
const _mcpClients = new Map();

function loadMcpConfig() {
  try { return JSON.parse(localStorage.getItem('florde-mcp-servers') || '[]'); } catch { return []; }
}

function saveMcpConfig(configs) {
  localStorage.setItem('florde-mcp-servers', JSON.stringify(configs));
}

async function renderMcpServers() {
  const list = document.getElementById('mcp-server-list');
  if (!list) return;
  const configs = loadMcpConfig();
  list.innerHTML = configs.map((cfg, i) => {
    const client = _mcpClients.get(cfg.id);
    const status = client && client._connected ? 'connected' : 'disconnected';
    const tools = client ? client._tools : [];
    return '<div class="mcp-server-card" data-index="' + i + '">' +
      '<div class="mcp-server-header">' +
        '<span class="mcp-server-name">' + escapeHtml(cfg.name || cfg.id) + '</span>' +
        '<span class="mcp-server-status ' + status + '">' + status + '</span>' +
      '</div>' +
      (tools.length > 0 ? '<div class="mcp-server-tools">Tools: ' + tools.map(t => t._originalName).join(', ') + '</div>' : '') +
      '<div class="mcp-server-config">' +
        '<textarea class="mcp-config-editor" data-id="' + cfg.id + '">' + escapeHtml(JSON.stringify(cfg, null, 2)) + '</textarea>' +
      '</div>' +
      '<div class="mcp-server-actions">' +
        '<button class="btn btn-sm btn-primary mcp-connect" data-id="' + cfg.id + '">' + (status === 'connected' ? 'Reconnect' : 'Connect') + '</button>' +
        '<button class="btn btn-sm btn-secondary mcp-disconnect" data-id="' + cfg.id + '">Disconnect</button>' +
        '<button class="btn btn-sm btn-secondary mcp-remove" data-id="' + cfg.id + '">Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
  // Attach handlers
  list.querySelectorAll('.mcp-connect').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const cfg = loadMcpConfig().find(c => c.id === id);
      if (!cfg) return;
      try {
        if (_mcpClients.has(id)) await _mcpClients.get(id).disconnect();
        const client = new McpClient(cfg);
        await client.connect();
        _mcpClients.set(id, client);
        renderMcpServers();
        showNotification('success', 'MCP server "' + cfg.name + '" connected', '🔌');
      } catch (err) {
        showNotification('error', 'MCP connect failed: ' + err.message, '❌');
        renderMcpServers();
      }
    });
  });
  list.querySelectorAll('.mcp-disconnect').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (_mcpClients.has(id)) await _mcpClients.get(id).disconnect();
      _mcpClients.delete(id);
      renderMcpServers();
    });
  });
  list.querySelectorAll('.mcp-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.closest('.mcp-server-card')?.dataset?.index);
      if (isNaN(idx)) return;
      const configs = loadMcpConfig();
      const removed = configs.splice(idx, 1)[0];
      saveMcpConfig(configs);
      if (_mcpClients.has(removed.id)) _mcpClients.get(removed.id).disconnect();
      _mcpClients.delete(removed.id);
      renderMcpServers();
    });
  });
  list.querySelectorAll('.mcp-config-editor').forEach(editor => {
    editor.addEventListener('change', () => {
      const id = editor.dataset.id;
      try {
        const cfg = JSON.parse(editor.value);
        const configs = loadMcpConfig();
        const idx = configs.findIndex(c => c.id === id);
        if (idx >= 0) configs[idx] = cfg;
        saveMcpConfig(configs);
        // Reconnect if connected
        if (_mcpClients.has(id)) {
          _mcpClients.get(id).disconnect();
          _mcpClients.delete(id);
        }
        renderMcpServers();
      } catch {}
    });
  });
}

document.getElementById('btn-add-mcp-server')?.addEventListener('click', () => {
  const configs = loadMcpConfig();
  const id = 'mcp-' + Date.now();
  configs.push({
    id, name: 'New Server',
    transport: 'stdio',
    command: '',
    args: [],
    env: {}
  });
  saveMcpConfig(configs);
  renderMcpServers();
});
```

- [ ] **Step 4: Wire MCP settings tab**

```
// Settings tab handler for MCP
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('settings-' + tabName);
    if (panel) {
      panel.classList.remove('hidden');
      if (tabName === 'mcp') renderMcpServers();
    }
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});
```

- [ ] **Step 5: Disconnect all MCP clients on page unload**

```
window.addEventListener('beforeunload', () => {
  for (const client of _mcpClients.values()) client.disconnect();
});
```

- [ ] **Step 6: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`

---

### Task 3: MCP Integration in getActiveTools + executeToolCall

**Files:**
- Modify: `App/renderer/script.js` (getActiveTools, executeToolCall)

- [ ] **Step 1: Add MCP tools to getActiveTools**

In `getActiveTools()`, nach `pluginTools`:

```
// Add MCP tools
const mcpTools = [];
for (const [id, client] of _mcpClients) {
  if (client._connected) {
    for (const tool of client._tools) {
      mcpTools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      });
    }
  }
}
return [...baseTools, ...appTools, ...pluginTools, ...mcpTools];
```

- [ ] **Step 2: Route MCP tool calls in executeToolCall**

Im `default`-Case von `executeToolCall`, nach APP_TOOL_LOOKUP und pluginRegistry:

```
// MCP tools
if (name.startsWith('mcp_')) {
  const parts = name.split('_');
  const mcpId = parts.slice(1, -1).join('_');
  const toolName = parts.slice(-1)[0];
  const client = _mcpClients.get(mcpId);
  if (!client || !client._connected) throw new Error('MCP server not connected: ' + mcpId);
  const result = await client.callTool(toolName, args);
  return JSON.stringify(result.content || result);
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -e "new Function(require('fs').readFileSync('App/renderer/script.js','utf8'))" && echo OK`
