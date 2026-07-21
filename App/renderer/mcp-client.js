class McpClient {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.transport = config.transport || 'stdio';
    this.command = config.command;
    this.args = config.args || [];
    this.env = config.env || {};
    this.url = config.url;
    this._requestId = 0;
    this._pending = new Map();
    this._tools = [];
    this._connected = false;
    this._reader = null;
    this._writer = null;
    this._process = null;
    this._eventSource = null;
    this._ws = null;
    this._notificationCb = null;
    this._buffer = '';
    this._sseEndpoint = null;
    this._messageEndpoint = null;
  }

  onNotification(cb) { this._notificationCb = cb; }

  async connect() {
    if (this._connected) return;
    switch (this.transport) {
      case 'stdio': await this._connectStdio(); break;
      case 'sse': await this._connectSSE(); break;
      case 'websocket': await this._connectWebSocket(); break;
      default: throw new Error('Unsupported transport: ' + this.transport);
    }
    const initResult = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Florde', version: '1.0' }
    });
    this._connected = true;
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
    if (!spawn) throw new Error('MCP stdio not available (requires preload bridge)');
    this._process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const decoder = new TextDecoder();
    this._buffer = '';
    this._process.stdout.on('data', (chunk) => this._onData(decoder.decode(chunk, { stream: true })));
    this._process.stderr.on('data', () => {});
    this._process.on('exit', () => { this._connected = false; });
    await new Promise(r => setTimeout(r, 500));
  }

  async _connectSSE() {
    const url = this.url.replace(/\/+$/, '');
    this._messageEndpoint = null;
    const sseUrl = url + '/sse';
    this._eventSource = new EventSource(sseUrl);
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
    this._eventSource.addEventListener('endpoint', (event) => {
      this._messageEndpoint = url + event.data;
    });
    this._eventSource.onerror = () => { this._connected = false; };
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (this._messageEndpoint) { clearInterval(check); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
    if (!this._messageEndpoint) {
      this._messageEndpoint = url + '/message';
    }
  }

  async _connectWebSocket() {
    const url = this.url.replace(/\/+$/, '');
    const wsUrl = url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/mcp';
    this._ws = new WebSocket(wsUrl);
    this._ws.onmessage = (event) => {
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
    this._ws.onclose = () => { this._connected = false; };
    this._ws.onerror = () => { this._connected = false; };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
      this._ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
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
      const entry = this._pending.get(id);
      if (entry) entry.timeout = timeout;
      this._send(request).catch(reject);
    }).then(msg => {
      if (msg.error) throw new Error(msg.error.message || 'MCP error: ' + JSON.stringify(msg.error));
      return msg.result || {};
    });
  }

  async _send(request) {
    switch (this.transport) {
      case 'stdio':
        if (!this._process || !this._process.stdin) throw new Error('MCP: not connected');
        this._process.stdin.write(JSON.stringify(request) + '\n');
        break;
      case 'websocket':
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) throw new Error('MCP WebSocket: not connected');
        this._ws.send(JSON.stringify(request));
        break;
      case 'sse':
      default:
        const ep = this._messageEndpoint || (this.url.replace(/\/+$/, '') + '/message');
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        });
        if (!r.ok) throw new Error('MCP HTTP error: ' + r.status);
        break;
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
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const [id, entry] of this._pending) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('MCP disconnected'));
    }
    this._pending.clear();
    this._tools = [];
  }
}
