// ==================== AUDIT LOG ====================

let auditLog = [];
let auditFilter = 'all';

function addAuditEntry(type, text) {
  const entry = { time: new Date().toLocaleTimeString(), type, text };
  auditLog.push(entry);
  if (auditLog.length > 500) auditLog.shift();
}

// ==================== DYNAMIC TOOLS ====================

const CLOUD_TIMEOUT = 900000;
const OLLAMA_TIMEOUT = 1800000;

function getActiveTools() {
  const baseTools = [
    { type: 'function', function: { name: 'read_file', description: 'Read a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List all files in the project', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_files', description: 'Search for text across all project files', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'exec_command', description: 'Execute a shell command in the project sandbox directory', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'ask_question', description: 'Ask the user a question when you need clarification, confirmation, or a decision. Always provide clear choices. One choice must always be a custom free-text option.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, choices: { type: 'array', items: { type: 'string' }, description: 'List of answer choices. Always include a free-text option like "Custom answer..."' } }, required: ['question', 'choices'] } } },
  ];
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
  return [...baseTools, ...pluginTools];
}

window.__updateTools = function() {
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry._loaded) {
    if (document.getElementById('marketplace-list')) renderPluginMarketplace();
  }
};

// ==================== NOTIFICATIONS ====================

function showNotification(type, text, icon) {
  const container = document.getElementById('notification-container');
  const n = document.createElement('div');
  n.className = 'notification ' + type;
  n.innerHTML = '<span class="notification-icon">' + icon + '</span><span class="notification-text">' + text + '</span><button class="notification-dismiss">&times;</button>';
  n.querySelector('.notification-dismiss').addEventListener('click', () => n.remove());
  container.appendChild(n);
  setTimeout(() => { if (n.parentNode) n.remove(); }, 6000);
  if (window.electronAPI && window.electronAPI.showNotification) {
    window.electronAPI.showNotification('Florde', text);
  }
}

// ==================== QUESTION TOOL ====================

let pendingQuestion = null;

function askUserQuestion(question, choices) {
  if (window.electronAPI && window.electronAPI.showNotification) {
    window.electronAPI.showNotification('Florde needs your input', question);
  }
  return new Promise((resolve) => {
    const modal = document.getElementById('question-modal');
    document.getElementById('question-text').textContent = question;
    const choicesDiv = document.getElementById('question-choices');
    choicesDiv.innerHTML = '';
    const allChoices = [...choices];
    if (!allChoices.some(c => c.toLowerCase().includes('custom'))) {
      allChoices.push('Custom answer...');
    }
    allChoices.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'question-choice' + (c === 'Custom answer...' ? ' custom' : '');
      btn.textContent = c;
      btn.addEventListener('click', () => {
        if (c === 'Custom answer...') {
          const answer = prompt('Your answer:');
          if (answer !== null) {
            modal.classList.add('hidden');
            resolve(answer);
          }
        } else {
          modal.classList.add('hidden');
          resolve(c);
        }
      });
      choicesDiv.appendChild(btn);
    });
    document.getElementById('btn-question-cancel').addEventListener('click', () => {
      modal.classList.add('hidden');
      resolve('[User cancelled]');
    }, { once: true });
    modal.classList.remove('hidden');
  });
}

// ==================== AI PROVIDERS ====================

function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o') { this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.openai.com/v1/chat/completions'; this.supportsTools = true; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`${this.constructor.name} API error: ${r.status} ${r.statusText}`);
    return r;
  }
  _withTemp(body) {
    if (this.temperature !== undefined) body.temperature = this.temperature;
    return body;
  }
  async sendMessage(messages, onChunk) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, stream: true }), CLOUD_TIMEOUT);
    return this._stream(r, onChunk);
  }
  async _stream(r, onChunk) {
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try { const p = JSON.parse(data); const c = p.choices?.[0]?.delta?.content || ''; full += c; onChunk(full); } catch {}
      }
    }
    return full;
  }
  async sendWithTools(messages, tools) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }));
    const data = await r.json();
    return data.choices?.[0]?.message || { content: '', role: 'assistant' };
  }
  async sendPlain(messages) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, stream: false }));
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }
  async testKey() {
    const r = await this._post(this.baseUrl, { model: this.model, messages: [{ role: 'user', content: 'test' }], max_tokens: 1, stream: false }, 15000);
    return r.ok;
  }
  async detectToolSupport() { return true; }
}

class DeepSeekProvider extends OpenAIProvider {
  constructor(apiKey, model = 'deepseek-chat') { super(apiKey, 'deepseek-chat'); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.deepseek.com/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`DeepSeek API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
}

class MistralProvider extends OpenAIProvider {
  constructor(apiKey, model = 'mistral-large-latest') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.mistral.ai/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`Mistral API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
}

class OpenCodeProvider extends OpenAIProvider {
  constructor(apiKey, model = 'opencode-default') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.opencode.ai/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`OpenCode API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
}

class OllamaProvider {
  constructor(baseUrl = 'http://localhost:11434', model = 'qwen2.5-coder') { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.model = model; this._useChat = true; this.supportsTools = false; }
  async _post(endpoint, body, timeoutMs = 300000) {
    const r = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`Ollama API error: ${r.status} ${r.statusText}`);
    return r;
  }
  async _checkConnection() {
    try {
      const r = await fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' }, 5000);
      return r.ok;
    } catch {
      return false;
    }
  }
  _messagesToPrompt(messages) {
    return messages.map(m => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
      return `${role}: ${m.content}`;
    }).join('\n') + '\nAssistant: ';
  }
  async _chatOrGenerate(chatBody, onChunk) {
    if (this._useChat) {
      try {
        const r = await this._post('/api/chat', chatBody, OLLAMA_TIMEOUT);
        if (onChunk) {
          const reader = r.body.getReader(), decoder = new TextDecoder();
          let full = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value).split('\n').filter(l => l.trim());
            for (const line of lines) {
              try { const p = JSON.parse(line); const c = p.message?.content || ''; full += c; onChunk(full); } catch {}
            }
          }
          return full;
        }
        const data = await r.json();
        return data.message?.content || '';
      } catch (err) {
        if (err.message.includes('404')) {
          this._useChat = false;
          return this._chatOrGenerate(chatBody, onChunk);
        }
        throw err;
      }
    }
    const prompt = this._messagesToPrompt(chatBody.messages);
    const body = { model: this.model, prompt, stream: !!onChunk, options: chatBody.options };
    const r = await this._post('/api/generate', body, OLLAMA_TIMEOUT);
    if (onChunk) {
      const reader = r.body.getReader(), decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n').filter(l => l.trim());
        for (const line of lines) {
          try { const p = JSON.parse(line); const c = p.response || ''; full += c; onChunk(full); } catch {}
        }
      }
      return full;
    }
    const data = await r.json();
    return data.response || '';
  }
  _withOpts(body) {
    if (this.temperature !== undefined) { body.options = body.options || {}; body.options.temperature = this.temperature; }
    return body;
  }
  async sendMessage(messages, onChunk) {
    if (!(await this._checkConnection())) throw new Error('Ollama is not running. Start Ollama and make sure it is accessible at ' + this.baseUrl);
    return this._chatOrGenerate(this._withOpts({ model: this.model, messages, stream: true }), onChunk);
  }
  async sendWithTools(messages, tools) {
    if (!(await this._checkConnection())) throw new Error('Ollama is not running. Start Ollama and make sure it is accessible at ' + this.baseUrl);
    try {
      if (this._useChat) {
        const r = await this._post('/api/chat', this._withOpts({ model: this.model, messages, tools, stream: false }), OLLAMA_TIMEOUT);
        const data = await r.json();
        const msg = data.message || {};
        return { content: msg.content || '', role: 'assistant', tool_calls: msg.tool_calls };
      }
    } catch (err) {
      if (err.message.includes('404')) {
        this._useChat = false;
      } else if (!err.message.includes('400')) throw err;
    }
    const content = await this._chatOrGenerate(this._withOpts({ model: this.model, messages, stream: false }));
    return { content, role: 'assistant' };
  }
  async sendPlain(messages) {
    if (!(await this._checkConnection())) throw new Error('Ollama is not running. Start Ollama and make sure it is accessible at ' + this.baseUrl);
    return this._chatOrGenerate(this._withOpts({ model: this.model, messages, stream: false }));
  }
  async testKey() {
    const models = await window.electronAPI.ollamaList();
    return models.includes(this.model);
  }
  async detectToolSupport() {
    try {
      const r = await this._post('/api/chat', {
        model: this.model,
        messages: [{ role: 'user', content: 'say yes' }],
        tools: [{ type: 'function', function: { name: 'test_tool', description: 'test', parameters: { type: 'object', properties: {} } } }],
        stream: false
      }, 15000);
      if (!r.ok) return false;
      const data = await r.json();
      return !!(data.message?.tool_calls);
    } catch { return false; }
  }
}

class GrokProvider extends OpenAIProvider {
  constructor(apiKey, model = 'grok-4.3') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://api.x.ai/v1/chat/completions'; }
}

class OpenRouterProvider extends OpenAIProvider {
  constructor(apiKey, model = 'openai/gpt-4o') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, 'HTTP-Referer': 'https://florde.app', 'X-Title': 'Florde' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`OpenRouter API error: ${r.status} ${r.statusText}`);
    return r;
  }
}

class CustomProvider extends OpenAIProvider {
  constructor(apiKey, model = 'custom-model', baseUrl = 'https://api.example.com/v1/chat/completions') {
    super(apiKey, model);
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }
}

class LocalAIProvider {
  constructor(baseUrl = 'http://localhost:8080', model = 'local-model') { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.model = model; this.supportsTools = false; }
  _withTemp(body) {
    if (this.temperature !== undefined) body.temperature = this.temperature;
    return body;
  }
  async _post(endpoint, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`LocalAI API error: ${r.status} ${r.statusText}`);
    return r;
  }
  async sendMessage(messages, onChunk) {
    const r = await this._post('/v1/chat/completions', this._withTemp({ model: this.model, messages, stream: true }), 300000);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try { const p = JSON.parse(data); const c = p.choices?.[0]?.delta?.content || ''; full += c; onChunk(full); } catch {}
      }
    }
    return full;
  }
  async sendWithTools(messages, tools) {
    const r = await this._post('/v1/chat/completions', this._withTemp({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }));
    const data = await r.json();
    return data.choices?.[0]?.message || { content: '', role: 'assistant' };
  }
  async detectToolSupport() {
    try {
      const r = await this._post('/v1/chat/completions', {
        model: this.model, messages: [{ role: 'user', content: 'say yes' }],
        tools: [{ type: 'function', function: { name: 'test_tool', description: 'test', parameters: { type: 'object', properties: {} } } }],
        stream: false
      }, 15000);
      if (!r.ok) return false;
      const data = await r.json();
      return !!(data.choices?.[0]?.message?.tool_calls);
    } catch { return false; }
  }
  async sendPlain(messages) {
    const r = await this._post('/v1/chat/completions', { model: this.model, messages, stream: false });
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }
  async testKey() {
    try {
      const r = await this._post('/v1/chat/completions', { model: this.model, messages: [{ role: 'user', content: 'test' }], max_tokens: 1, stream: false }, 15000);
      return r.ok;
    } catch { return false; }
  }
}

class LMStudioProvider extends LocalAIProvider {
  constructor(baseUrl = 'http://localhost:1234', model = 'local-model') { super(baseUrl, model); }
}

class AnthropicProvider {
  constructor(apiKey, model = 'claude-sonnet-4-6') { this.apiKey = apiKey; this.model = model; this.supportsTools = true; }
  _withTemp(body) {
    if (this.temperature !== undefined) body.temperature = this.temperature;
    return body;
  }
  _headers() {
    return { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' };
  }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`Anthropic API error: ${r.status} ${r.statusText}`);
    return r;
  }
  _toAnthropic(messages) {
    const msgs = [], sys = [];
    for (const m of messages) {
      if (m.role === 'system') { sys.push(m.content); continue; }
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' });
    }
    return { system: sys.join('\n'), messages: msgs };
  }
  _fromAnthropic(data) {
    const content = data.content?.map(c => c.text).filter(Boolean).join('') || '';
    const toolCalls = data.content?.filter(c => c.type === 'tool_use').map(c => ({
      id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) }
    }));
    return { content, role: 'assistant', tool_calls: toolCalls };
  }
  async sendMessage(messages, onChunk) {
    const { system, messages: msgs } = this._toAnthropic(messages);
    const body = this._withTemp({ model: this.model, max_tokens: 8192, messages: msgs, stream: true });
    if (system) body.system = system;
    const r = await this._post('https://api.anthropic.com/v1/messages', body, CLOUD_TIMEOUT);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        try { const p = JSON.parse(data); if (p.type === 'content_block_delta' && p.delta?.text) { full += p.delta.text; onChunk(full); } } catch {}
      }
    }
    return full;
  }
  async sendWithTools(messages, tools) {
    const { system, messages: msgs } = this._toAnthropic(messages);
    const body = this._withTemp({ model: this.model, max_tokens: 8192, messages: msgs });
    if (system) body.system = system;
    if (tools) body.tools = tools.map(t => t.function);
    const r = await this._post('https://api.anthropic.com/v1/messages', body);
    const data = await r.json();
    return this._fromAnthropic(data);
  }
  async sendPlain(messages) {
    const { system, messages: msgs } = this._toAnthropic(messages);
    const body = { model: this.model, max_tokens: 8192, messages: msgs };
    if (system) body.system = system;
    const r = await this._post('https://api.anthropic.com/v1/messages', body, 120000);
    const data = await r.json();
    return this._fromAnthropic(data).content;
  }
  async testKey() {
    const r = await this._post('https://api.anthropic.com/v1/messages', { model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }, 15000);
    return r.ok;
  }
}

class GeminiProvider {
  constructor(apiKey, model = 'gemini-2.5-flash') { this.apiKey = apiKey; this.model = model; this.supportsTools = true; }
  async _post(path, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) throw new Error(`Gemini API error: ${r.status} ${r.statusText}`);
    return r;
  }
  _toGemini(messages) {
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] });
    }
    return contents;
  }
  _fromGemini(data) {
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
    return { content: text, role: 'assistant' };
  }
  async sendMessage(messages, onChunk) {
    const contents = this._toGemini(messages);
    const r = await this._post(`streamGenerateContent?alt=sse`, { contents }, CLOUD_TIMEOUT);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6);
        if (d === '[DONE]') continue;
        try { const p = JSON.parse(d); const t = p.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''; if (t) { full += t; onChunk(full); } } catch {}
      }
    }
    return full;
  }
  async sendWithTools(messages, tools) {
    const contents = this._toGemini(messages);
    const r = await this._post(`generateContent`, { contents });
    const data = await r.json();
    return this._fromGemini(data);
  }
  async sendPlain(messages) {
    const contents = this._toGemini(messages);
    const r = await this._post(`generateContent`, { contents });
    const data = await r.json();
    return this._fromGemini(data).content;
  }
  async testKey() {
    const r = await this._post(`generateContent`, { contents: [{ role: 'user', parts: [{ text: 'test' }] }] }, 15000);
    return r.ok;
  }
}

// ==================== CHAT SESSIONS ====================

const ChatManager = {
  _sessions: [],
  _activeSessionId: null,
  _nextId: 1,

  init() {
    this.newSession();
  },

  newSession() {
    const id = this._nextId++;
    const session = { id, name: `Chat ${this._sessions.length + 1}`, messages: [], context: [], created: Date.now() };
    this._sessions.push(session);
    this._activeSessionId = id;
    this._renderTabs();
    return id;
  },

  getActive() {
    return this._sessions.find(s => s.id === this._activeSessionId);
  },

  addMessage(msg) {
    const s = this.getActive();
    if (s) s.messages.push(msg);
  },

  switchSession(id) {
    if (id === this._activeSessionId) return;
    const s = this._sessions.find(x => x.id === id);
    if (!s) return;
    this._activeSessionId = id;
    chatHistory = s.messages;
    this._renderTabs();
    renderChat();
  },

  closeSession(id) {
    if (this._sessions.length <= 1) return;
    const idx = this._sessions.findIndex(s => s.id === id);
    this._sessions = this._sessions.filter(s => s.id !== id);
    if (this._activeSessionId === id) {
      const nextIdx = Math.min(idx, this._sessions.length - 1);
      this.switchSession(this._sessions[nextIdx].id);
    }
    this._renderTabs();
  },

  renameSession(id, name) {
    const s = this._sessions.find(s => s.id === id);
    if (s) s.name = name;
    this._renderTabs();
  },

  _renderTabs() {
    const bar = document.getElementById('chat-tab-bar');
    if (!bar) return;
    bar.innerHTML = this._sessions.map(s => `<div class="chat-tab ${s.id === this._activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <span class="chat-tab-name">${this._escapeHtml(s.name)}</span>
      <button class="chat-tab-close" data-id="${s.id}">&times;</button>
    </div>`).join('') + '<button id="btn-new-chat-tab" title="New Chat (Ctrl+T)">+</button>';
    bar.querySelectorAll('.chat-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.chat-tab-close')) return;
        this.switchSession(parseInt(tab.dataset.id));
      });
    });
    bar.querySelectorAll('.chat-tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.closeSession(parseInt(btn.dataset.id)); });
    });
    document.getElementById('btn-new-chat-tab')?.addEventListener('click', () => {
      this.newSession();
      this._renderTabs();
    });
  },

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

// ==================== KEYBOARD SHORTCUTS (Chat) ====================

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 't') {
    e.preventDefault();
    ChatManager.newSession();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w' && document.activeElement?.id === 'chat-input') { e.preventDefault(); ChatManager.closeSession(ChatManager._activeSessionId); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && document.activeElement?.id === 'chat-input') {
    e.preventDefault();
    const idx = ChatManager._sessions.findIndex(s => s.id === ChatManager._activeSessionId);
    const next = (idx + 1) % ChatManager._sessions.length;
    ChatManager.switchSession(ChatManager._sessions[next].id);
  }
});

// ==================== STATE ====================

let providers = {};
let capabilityCache = JSON.parse(localStorage.getItem('florde-capability-cache') || '{}');
let chatHistory = [];
const MAX_CHAT_HISTORY = 50;
function trimChatHistory() {
  if (chatHistory.length > MAX_CHAT_HISTORY) {
    const systemIdx = chatHistory.findIndex(m => m.role === 'system');
    const keep = chatHistory.slice(-MAX_CHAT_HISTORY);
    if (systemIdx >= 0 && !keep.find(m => m.role === 'system')) {
      keep.unshift(chatHistory[systemIdx]);
    }
    chatHistory = keep;
  }
}
let currentProject = null;
let currentProjectType = null;
let openTabs = [];
let tabContents = {};
let tabLanguages = {};
let tabDirty = {};
let activeTabIndex = -1;
let editor = null;
let diffEditor = null;
let currentTheme = 'dark';
let sandboxDir = null;
let monacoReady = false;
let pendingProjectOpen = null;

// ==================== WORKSPACE MANAGER ====================

const WorkspaceManager = {
  _workspaces: [],
  _activeWorkspaceId: null,

  init() {
    const saved = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    this._workspaces = saved.workspaces || [];
    if (this._workspaces.length === 0) {
      this._workspaces.push({ id: 'default', name: 'Default', path: null });
    }
    this._activeWorkspaceId = this._workspaces[0].id;
    this._renderTabs();
  },

  getActive() {
    return this._workspaces.find(w => w.id === this._activeWorkspaceId);
  },

  async openProject(path, name) {
    const existing = this._workspaces.find(w => w.path === path);
    if (existing) {
      this.switchTo(existing.id);
      return;
    }
    const id = 'ws-' + Date.now();
    const displayName = name || path.split(/[/\\]/).pop();
    this._workspaces.push({ id, name: displayName, path });
    this._activeWorkspaceId = id;
    this._renderTabs();
    await this._loadWorkspace(id);
    this._persist();
  },

  async switchTo(id) {
    this._activeWorkspaceId = id;
    this._renderTabs();
    await this._loadWorkspace(id);
  },

  closeWorkspace(id) {
    if (this._workspaces.length <= 1) return;
    const idx = this._workspaces.findIndex(w => w.id === id);
    this._workspaces = this._workspaces.filter(w => w.id !== id);
    if (this._activeWorkspaceId === id) {
      const next = this._workspaces[Math.min(idx, this._workspaces.length - 1)];
      this.switchTo(next.id);
    }
    this._renderTabs();
    this._persist();
  },

  async _loadWorkspace(id) {
    const ws = this._workspaces.find(w => w.id === id);
    if (!ws) return;
    if (!ws.path) { showStartMenu(); return; }
    if (currentProject && currentProject !== ws.path) {
      await saveSession();
    }
    await openProject(ws.path);
  },

  _renderTabs() {
    const bar = document.getElementById('workspace-tab-bar');
    if (!bar) return;
    bar.innerHTML = this._workspaces.map(w => `<div class="ws-tab ${w.id === this._activeWorkspaceId ? 'active' : ''}" data-id="${w.id}">
      <span class="ws-tab-name">${w.name}</span>
      <button class="ws-tab-close" data-id="${w.id}">&times;</button>
    </div>`).join('') + '<button id="btn-open-project-ws" title="Open Project">+</button>';
    bar.querySelectorAll('.ws-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        this.switchTo(tab.dataset.id);
      });
    });
    bar.querySelectorAll('.ws-tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeWorkspace(btn.dataset.id);
      });
    });
    bar.querySelector('#btn-open-project-ws')?.addEventListener('click', () => {
      document.getElementById('btn-start-local').click();
    });
  },

  _persist() {
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    settings.workspaces = this._workspaces.map(w => ({ id: w.id, name: w.name, path: w.path }));
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  }
};

// ==================== FAVORITES ====================

const Favorites = {
  _favorites: [],

  init() {
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    this._favorites = settings.favoriteProjects || [];
  },

  toggle(path) {
    const idx = this._favorites.indexOf(path);
    if (idx >= 0) {
      this._favorites.splice(idx, 1);
    } else {
      this._favorites.push(path);
    }
    this._persist();
    this._renderFavorites();
  },

  isFavorite(path) {
    return this._favorites.includes(path);
  },

  getFavorites() {
    return this._favorites;
  },

  _persist() {
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    settings.favoriteProjects = this._favorites;
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  },

  _renderFavorites() {
    document.querySelectorAll('.project-item').forEach(el => {
      const path = el.dataset.path;
      const star = el.querySelector('.star-icon');
      if (star) {
        star.textContent = this.isFavorite(path) ? '\u2605' : '\u2606';
        star.classList.toggle('favorited', this.isFavorite(path));
      }
    });
  }
};

// ==================== PERMISSION MANAGER ====================

const PermissionManager = {
  _rules: {},

  init() {
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    this._rules = settings.permissions || {};
    const allTools = ['read_file', 'write_file', 'delete_file', 'list_files', 'search_files', 'exec_command', 'ask_question'];
    allTools.forEach(t => { if (this._rules[t] === undefined) this._rules[t] = 'ask'; });
  },

  getPermission(toolName) {
    return this._rules[toolName] || 'allow';
  },

  setPermission(toolName, level) {
    this._rules[toolName] = level;
    const settings = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    settings.permissions = this._rules;
    localStorage.setItem('florde-settings', JSON.stringify(settings));
  },

  async checkTool(toolName, args) {
    const level = this.getPermission(toolName);
    if (level === 'allow') return true;
    if (level === 'block') {
      showNotification('warning', 'Blocked: AI tried to use "' + toolName + '"', '\u26A0');
      return false;
    }
    if (level === 'ask') {
      return new Promise((resolve) => {
        showPermissionPrompt(toolName, args, resolve);
      });
    }
    return true;
  }
};

function showPermissionPrompt(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  overlay.innerHTML = '<div class="permission-prompt">' +
    '<h3>Permission Required</h3>' +
    '<p>The AI wants to use <strong>' + toolName + '</strong></p>' +
    '<pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once">Allow Once</button>' +
      '<button class="btn-allow-always">Always Allow</button>' +
      '<button class="btn-block-once">Block Once</button>' +
      '<button class="btn-block-always">Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.btn-allow-once').onclick = () => { overlay.remove(); callback(true); };
  overlay.querySelector('.btn-allow-always').onclick = () => { PermissionManager.setPermission(toolName, 'allow'); overlay.remove(); callback(true); };
  overlay.querySelector('.btn-block-once').onclick = () => { overlay.remove(); callback(false); };
  overlay.querySelector('.btn-block-always').onclick = () => { PermissionManager.setPermission(toolName, 'block'); overlay.remove(); callback(false); };
}

// ==================== KEYCHAIN AUTO-FILL ====================

async function autoFillApiKey(providerName) {
  if (!window.electronAPI?.keychain) return;
  try {
    const key = await window.electronAPI.keychain.retrieve({ key: 'provider:' + providerName });
    if (key) {
      const input = document.getElementById('key-' + providerName) || document.querySelector('[data-provider-key="' + providerName + '"]');
      if (input) input.value = key;
    }
  } catch (e) {}
}

async function autoFillAllKeys() {
  const providers = ['openai','deepseek','mistral','anthropic','gemini','grok','opencode','openrouter','custom'];
  for (const p of providers) await autoFillApiKey(p);
}

// ==================== PERMISSION LIST UI ====================

function renderPermissionList() {
  const container = document.getElementById('permission-list');
  if (!container) return;
  const allTools = [
    { id: 'read_file', label: 'Read files' },
    { id: 'write_file', label: 'Write files' },
    { id: 'delete_file', label: 'Delete files' },
    { id: 'list_files', label: 'List files' },
    { id: 'search_files', label: 'Search files' },
    { id: 'exec_command', label: 'Run commands' },
    { id: 'ask_question', label: 'Ask questions' },
  ];
  container.innerHTML = allTools.map(t => '<div class="permission-row">' +
    '<span>' + t.label + '</span>' +
    '<select class="perm-select" data-tool="' + t.id + '">' +
      '<option value="allow" ' + (PermissionManager.getPermission(t.id) === 'allow' ? 'selected' : '') + '>Allow</option>' +
      '<option value="ask" ' + (PermissionManager.getPermission(t.id) === 'ask' ? 'selected' : '') + '>Ask</option>' +
      '<option value="block" ' + (PermissionManager.getPermission(t.id) === 'block' ? 'selected' : '') + '>Block</option>' +
    '</select>' +
  '</div>').join('');

  container.querySelectorAll('.perm-select').forEach(sel => {
    sel.addEventListener('change', () => {
      PermissionManager.setPermission(sel.dataset.tool, sel.value);
      showNotification('info', 'Permission for ' + sel.dataset.tool + ' set to ' + sel.value, '\u2699');
    });
  });
}

// ==================== KEYCHAIN MANAGER ====================

async function showKeychainManager() {
  const container = document.getElementById('modal-container-content');
  const modal = document.getElementById('modal-container');
  if (!container || !modal) return;

  const keys = window.electronAPI?.keychain ? await window.electronAPI.keychain.list() : [];
  container.innerHTML = '<h2>Stored API Keys</h2>' +
    '<div style="margin:1rem 0;">' +
      (keys.length === 0 ? '<p style="color:var(--text3);">No keys stored in keychain yet.</p>' :
        keys.map(k => '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);">' +
          '<span>' + k.replace('provider:', '') + '</span>' +
          '<button class="btn btn-sm btn-secondary keychain-delete" data-key="' + k + '">Delete</button>' +
        '</div>').join('')
      ) +
    '</div>' +
    '<div class="modal-actions">' +
      '<button id="btn-close-keychain" class="btn btn-secondary">Close</button>' +
    '</div>';
  modal.classList.remove('hidden');

  container.querySelectorAll('.keychain-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (window.electronAPI?.keychain) {
        await window.electronAPI.keychain.delete({ key: btn.dataset.key });
        showKeychainManager();
      }
    });
  });
  document.getElementById('btn-close-keychain')?.addEventListener('click', () => modal.classList.add('hidden'));
}

// ==================== SYSTEM PROMPT ====================

function buildSystemPrompt() {
  const provider = document.getElementById('provider-select').value;
  const prov = providers[provider];
  const hasTools = prov && (prov.supportsTools || (prov._toolSupportTested && prov._toolSupportResult));
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
  const pluginToolDescriptions = pluginTools
    .filter(t => t.function && t.function.name)
    .map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters?.properties || {}).join(', ') + '): ' + (t.function.description || ''))
    .join('\n');
  const pluginSection = pluginToolDescriptions ? '\n\nPlugin tools:\n' + pluginToolDescriptions : '';
  const promptExt = getPluginPromptExtensions();
  const promptExtSection = promptExt ? '\n\n' + promptExt : '';

  const toolList = `- read_file(path): Read file content
- write_file(path, content): Create or overwrite files
- delete_file(path): Delete files
- list_files(): List all project files
- search_files(query): Find text in files
- exec_command(command): Run shell commands in the project directory
- ask_question(question, choices): Ask the user a question when you need input or a decision`;

  const basePrompt = `You are Florde AI, an AI coding assistant with direct access to the user's project files.

Project: ${currentProject}
Type: ${currentProjectType}
Privacy: ${provider === 'ollama' || provider === 'lmstudio' || provider === 'localai' ? '100% Local - no data leaves this PC' : 'Cloud provider - data is encrypted in transit'}
${currentProjectType === 'local' ? 'Notes: This is a local project. Shell commands run in the project root directory. You can use system commands (pip install, npm install, cargo build, etc.) to set up and run the project.' : 'Notes: This is a sandbox project. Files are stored in app data. Shell commands run in the isolated sandbox directory.'}

Zero-Cloud-Storage: All user data, code, and chat history stays in the local database/JSON files.
Encrypted API Communication: Cloud model connections go directly from client to provider - no proxy server.
Local RAG: Project context is built locally. Embeddings are generated via local models.
${promptExtSection}`;

  if (hasTools) {
    return basePrompt + `


You have tool calling capabilities. Use the available functions below to interact with files and the terminal. These functions are CALLABLE BY YOU — invoke them when needed:
${toolList}${pluginSection}

RULES:
1. Always start by listing files to understand the project structure
2. Read files before making changes
3. Use write_file to create or modify files — never just show the code
4. Use exec_command to install dependencies, run the project, etc.
5. After making changes, verify with exec_command if appropriate
6. Explain what you're doing at each step
7. Only modify files inside the project — do not access files outside
8. When to use ask_question: if you are unsure about something, need permission, or need the user to make a choice — ALWAYS use it. Provide clear options including a custom answer choice.
9. Put your internal reasoning in [think]...[/think] blocks. The user sees these as gray italic text. Keep them brief and focused on your plan/investigation.`;
  }

  return basePrompt + `


You have access to tools. To use a tool, write one of these in your response:
[read_file: {"path": "..."}]
[write_file: {"path": "...", "content": "..."}]
[delete_file: {"path": "..."}]
[list_files: {}]
[search_files: {"query": "..."}]
[exec_command: {"command": "..."}]
[ask_question: {"question": "...", "choices": ["a", "b"]}]

Available tools:
${toolList}${pluginSection}

The app will parse these tool calls from your text, execute them, and return the results. You can use multiple tool calls in a single response.

RULES:
1. Always start by listing files to understand the project structure (use [list_files: {}])
2. Read files before making changes (use [read_file: {"path": "..."}])
3. Use [write_file: {"path": "...", "content": "..."}] to create or modify files — never just show the code
4. Use [exec_command: {"command": "..."}] to install dependencies, run the project, etc.
5. After making changes, verify with exec_command if appropriate
6. Explain what you're doing at each step
7. Only modify files inside the project — do not access files outside
8. When to use ask_question: if you are unsure about something, need permission, or need the user to make a choice — ALWAYS use it. Provide clear options including a custom answer choice.
9. Put your internal reasoning in [think]...[/think] blocks. The user sees these as gray italic text. Keep them brief and focused on your plan/investigation.`;
}

function getPluginPromptExtensions() {
  if (typeof pluginRegistry === 'undefined') return '';
  const extensions = pluginRegistry.getActivePromptExtensions();
  return extensions.map((ext, i) => `--- Plugin Extension (${i + 1}) ---\n${ext}`).join('\n\n');
}

function getToolResultMsg(toolCallId, name, result) {
  return { role: 'tool', tool_call_id: toolCallId, content: String(result) };
}

function parseTextToolCalls(text) {
  const calls = [];
  const re = /\[(\w+):\s*(\{)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let depth = 1;
    let idx = re.lastIndex;
    while (idx < text.length && depth > 0) {
      if (text[idx] === '{') depth++;
      if (text[idx] === '}') depth--;
      idx++;
    }
    if (idx <= text.length && text[idx - 1] === '}' && text[idx] === ']') {
      const jsonStr = text.slice(re.lastIndex - 1, idx);
      try {
        const args = JSON.parse(jsonStr);
        calls.push({
          function: { name, arguments: jsonStr },
          id: 'txt_' + Date.now() + '_' + calls.length,
          args
        });
      } catch (e) {}
    }
  }
  return calls;
}

// ==================== SETTINGS ====================

async function loadSettings() {
  try {
  const s = await window.electronAPI.getSettings();
  if (!s) return;

  function setToggle(id) {
    const cb = document.querySelector('.provider-enabled[data-provider="' + id + '"]');
    if (cb) cb.checked = s[id + 'Enabled'] === true;
  }
    const allProviderIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencode','ollama','lmstudio','localai','openrouter','custom'];
  for (const id of allProviderIds) setToggle(id);

  delete providers.openai; delete providers.deepseek; delete providers.mistral;
  delete providers.anthropic; delete providers.gemini; delete providers.grok;
  delete providers.opencode; delete providers.ollama; delete providers.lmstudio; delete providers.localai;
  delete providers.openrouter; delete providers.custom;

  const providerCtors = {
    openai: [OpenAIProvider, 'key', 'model', 'gpt-5.5'],
    deepseek: [DeepSeekProvider, 'key', 'model', 'deepseek-chat'],
    mistral: [MistralProvider, 'key', 'model', 'mistral-large-latest'],
    anthropic: [AnthropicProvider, 'key', 'model', 'claude-sonnet-4-6'],
    gemini: [GeminiProvider, 'key', 'model', 'gemini-2.5-flash'],
    grok: [GrokProvider, 'key', 'model', 'grok-4.3'],
    opencode: [OpenCodeProvider, 'key', 'model', 'opencode-default'],
    openrouter: [OpenRouterProvider, 'key', 'model', 'openai/gpt-4o'],
    custom: [CustomProvider, 'key', 'model', 'custom-model'],
    ollama: [OllamaProvider, 'url', 'model', 'qwen2.5-coder'],
    lmstudio: [LMStudioProvider, 'url', 'model', 'local-model'],
    localai: [LocalAIProvider, 'url', 'model', 'local-model'],
  };
  for (const [id, [Ctor, keyField, modelField, defaultModel]] of Object.entries(providerCtors)) {
    if (!s[id + 'Enabled']) continue;
    const needsKey = id !== 'ollama' && id !== 'lmstudio' && id !== 'localai';
    if (needsKey && !s[id + 'Key']) continue;
    const el = document.getElementById(keyField + '-' + id);
    if (el) el.value = s[id + keyField.charAt(0).toUpperCase() + keyField.slice(1)] || '';
    const modelVal = s[id + modelField.charAt(0).toUpperCase() + modelField.slice(1)] || defaultModel;
    const modelEl = document.getElementById(modelField + '-' + id);
    if (modelEl) modelEl.value = modelVal;
    if (id === 'custom') {
      providers[id] = new Ctor(s[id + 'Key'], modelVal, s.customUrl);
    } else if (id === 'ollama' || id === 'lmstudio' || id === 'localai') {
      providers[id] = new Ctor(s[id + 'Url'] || '', modelVal);
    } else {
      providers[id] = new Ctor(s[id + 'Key'], modelVal);
    }
    if (providers[id]) providers[id].temperature = parseFloat(s[id + 'Temp']) || 0.7;
  }
  if (s.openaiModel) document.getElementById('model-openai').value = s.openaiModel;
  if (s.deepseekModel) document.getElementById('model-deepseek').value = s.deepseekModel;
  if (s.mistralModel) document.getElementById('model-mistral').value = s.mistralModel;
  if (s.anthropicModel) document.getElementById('model-anthropic').value = s.anthropicModel;
  if (s.geminiModel) document.getElementById('model-gemini').value = s.geminiModel;
  if (s.grokModel) document.getElementById('model-grok').value = s.grokModel;
  if (s.opencodeModel) document.getElementById('model-opencode').value = s.opencodeModel;
  if (s.language) document.getElementById('settings-language').value = s.language;
  await initSandbox();
  try {
    const autoStart = await window.electronAPI.getAutoStart();
    document.getElementById('auto-start').checked = autoStart;
  } catch {}
  if (s.seeThoughts !== undefined) document.getElementById('see-thoughts').checked = s.seeThoughts;
  else document.getElementById('see-thoughts').checked = true;
  if (s.instantMode !== undefined) document.getElementById('instant-mode').checked = s.instantMode;
  else document.getElementById('instant-mode').checked = false;
  if (s.theme) { currentTheme = s.theme; document.getElementById('settings-theme').value = s.theme; applyTheme(); }
  // Add temperature sliders to each provider body
  const tempProviders = ['openai','deepseek','mistral','anthropic','gemini','grok','opencode','ollama','lmstudio','localai','openrouter','custom'];
  for (const id of tempProviders) {
    const body = document.querySelector('.provider-body[data-provider="' + id + '"]');
    if (!body || body.querySelector('.temp-slider-wrap')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'temp-slider-wrap';
    wrap.style.cssText = 'margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;';
    const label = document.createElement('label');
    label.textContent = 'Temperature';
    label.style.cssText = 'flex-shrink:0;min-width:90px;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'temp-' + id;
    slider.min = '0'; slider.max = '2'; slider.step = '0.1';
    slider.value = s[id + 'Temp'] !== undefined ? s[id + 'Temp'] : '0.7';
    slider.style.cssText = 'flex:1;';
    const valSpan = document.createElement('span');
    valSpan.id = 'temp-' + id + '-val';
    valSpan.textContent = slider.value;
    valSpan.style.cssText = 'min-width:2.5rem;text-align:center;font-size:0.8rem;color:var(--text2);';
    slider.addEventListener('input', () => { valSpan.textContent = slider.value; });
    wrap.appendChild(label);
    wrap.appendChild(slider);
    wrap.appendChild(valSpan);
    body.appendChild(wrap);
  }
  autoFillAllKeys();
  if (s.chatFontSize) {
    document.getElementById('chat-font-size').value = s.chatFontSize;
    document.getElementById('chat-font-size-label').textContent = s.chatFontSize + 'px';
    document.documentElement.style.setProperty('--chat-font-size', s.chatFontSize + 'px');
  }
  if (s.editorFontSize) {
    document.getElementById('editor-font-size').value = s.editorFontSize;
    document.getElementById('editor-font-size-label').textContent = s.editorFontSize + 'px';
    if (editor) editor.updateOptions({ fontSize: parseInt(s.editorFontSize) });
  }
  updateProviderDropdown();
  } catch (err) {
    console.error('loadSettings error:', err);
  }
}

async function saveSettingsToDisk(settings) {
  const existing = await window.electronAPI.getSettings();
  const merged = { ...(existing || {}), ...settings };
  await window.electronAPI.saveSettings(merged);
}

async function validateAndSaveSettings() {
  try {
  const saveBtn = document.getElementById('btn-save-settings');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Validating...';
  const validationDiv = document.getElementById('settings-validation');
  validationDiv.classList.add('hidden');

  const providersToTest = [
    { id: 'openai', key: document.getElementById('key-openai').value, model: document.getElementById('model-openai').value, test: async () => (new OpenAIProvider(document.getElementById('key-openai').value, document.getElementById('model-openai').value)).testKey() },
    { id: 'deepseek', key: document.getElementById('key-deepseek').value, model: document.getElementById('model-deepseek').value, test: async () => (new DeepSeekProvider(document.getElementById('key-deepseek').value, document.getElementById('model-deepseek').value)).testKey() },
    { id: 'mistral', key: document.getElementById('key-mistral').value, model: document.getElementById('model-mistral').value, test: async () => (new MistralProvider(document.getElementById('key-mistral').value, document.getElementById('model-mistral').value)).testKey() },
    { id: 'anthropic', key: document.getElementById('key-anthropic').value, model: document.getElementById('model-anthropic').value, test: async () => (new AnthropicProvider(document.getElementById('key-anthropic').value, document.getElementById('model-anthropic').value)).testKey() },
    { id: 'gemini', key: document.getElementById('key-gemini').value, model: document.getElementById('model-gemini').value, test: async () => (new GeminiProvider(document.getElementById('key-gemini').value, document.getElementById('model-gemini').value)).testKey() },
    { id: 'grok', key: document.getElementById('key-grok').value, model: document.getElementById('model-grok').value, test: async () => (new GrokProvider(document.getElementById('key-grok').value, document.getElementById('model-grok').value)).testKey() },
    { id: 'opencode', key: document.getElementById('key-opencode').value, model: document.getElementById('model-opencode').value, test: async () => (new OpenCodeProvider(document.getElementById('key-opencode').value, document.getElementById('model-opencode').value)).testKey() },
    { id: 'openrouter', key: document.getElementById('key-openrouter').value, model: document.getElementById('model-openrouter').value, test: async () => (new OpenRouterProvider(document.getElementById('key-openrouter').value, document.getElementById('model-openrouter').value)).testKey() },
    { id: 'custom', key: document.getElementById('key-custom').value, model: document.getElementById('model-custom').value, test: async () => (new CustomProvider(document.getElementById('key-custom').value, document.getElementById('model-custom').value, document.getElementById('url-custom').value)).testKey() },
  ];

  const localProviders = ['ollama', 'lmstudio', 'localai'];

  async function testLocalProvider(id, url) {
    const statusEl = document.getElementById('status-' + id);
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'key-status checking'; }
    try {
      const r = await fetchWithTimeout(url.replace(/\/+$/, '') + '/api/tags', { method: 'GET' }, 5000);
      const ok = r.ok;
      if (statusEl) { statusEl.textContent = ok ? '\u2713' : '\u2717'; statusEl.className = 'key-status ' + (ok ? 'valid' : 'invalid'); }
      if (ok && statusEl) setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'key-status'; }, 2000);
      return { id, valid: ok, skipped: false, error: ok ? null : 'Cannot connect to ' + url };
    } catch (err) {
      if (statusEl) { statusEl.textContent = '\u2717'; statusEl.className = 'key-status invalid'; }
      return { id, valid: false, skipped: false, error: 'Cannot connect to ' + url };
    }
  }

  const results = [];
  for (const p of providersToTest) {
    const statusEl = document.getElementById('status-' + p.id);
    if (p.id === 'ollama') {
      const url = document.getElementById('url-ollama').value || 'http://localhost:11434';
      results.push(await testLocalProvider('ollama', url));
      continue;
    }
    if (localProviders.includes(p.id)) {
      results.push({ id: p.id, valid: true, skipped: true });
      continue;
    }
    if (!p.key) {
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'key-status'; }
      results.push({ id: p.id, valid: true, skipped: true });
      continue;
    }
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'key-status checking'; }
    try {
      const valid = await p.test();
      if (statusEl) { statusEl.textContent = valid ? '\u2713' : '\u2717'; statusEl.className = 'key-status ' + (valid ? 'valid' : 'invalid'); }
      results.push({ id: p.id, valid, skipped: false, error: valid ? null : 'API key rejected' });
      if (valid && statusEl) setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'key-status'; }, 2000);
    } catch (err) {
      if (statusEl) { statusEl.textContent = '\u2717'; statusEl.className = 'key-status invalid'; }
      results.push({ id: p.id, valid: false, skipped: false, error: err.message });
    }
  }

  const validResults = results.filter(r => r.valid || r.skipped);
  const invalidResults = results.filter(r => !r.valid && !r.skipped);

  if (invalidResults.length > 0) {
    let html = '<strong>Some providers could not be validated:</strong><br>';
    for (const r of invalidResults) {
      html += '<span class="invalid-item">\u2717 ' + r.id.charAt(0).toUpperCase() + r.id.slice(1) + ': ' + (r.error || 'Connection failed') + '</span><br>';
    }
    validationDiv.innerHTML = html;
    validationDiv.classList.remove('hidden');
  }

  function isEnabled(id) {
    const cb = document.querySelector('.provider-enabled[data-provider="' + id + '"]');
    return cb ? cb.checked : false;
  }

  const providerIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencode','ollama','lmstudio','localai','openrouter','custom'];
  function getVal(id, field) {
    const el = document.getElementById(field + '-' + id);
    return el ? el.value : '';
  }
  function getTemp(id) { return parseFloat(document.getElementById('temp-' + id)?.value || '0.7'); }
  const settings = {};
  for (const id of providerIds) {
    settings[id + 'Enabled'] = isEnabled(id);
    if (id === 'custom') {
      settings[id + 'Url'] = getVal(id, 'url');
      settings[id + 'Key'] = isEnabled(id) && validResults.find(r => r.id === id)?.valid ? getVal(id, 'key') : '';
      settings[id + 'Model'] = getVal(id, 'model');
    } else if (id === 'ollama' || id === 'lmstudio' || id === 'localai') {
      settings[id + 'Url'] = getVal(id, 'url');
      settings[id + 'Model'] = getVal(id, 'model');
    } else {
      settings[id + 'Key'] = isEnabled(id) && validResults.find(r => r.id === id)?.valid ? getVal(id, 'key') : '';
      settings[id + 'Model'] = getVal(id, 'model');
    }
    settings[id + 'Temp'] = getTemp(id);
  }
  settings.theme = document.getElementById('settings-theme').value;
  settings.language = document.getElementById('settings-language').value;
  settings.seeThoughts = document.getElementById('see-thoughts').checked;
  settings.instantMode = document.getElementById('instant-mode').checked;

  localStorage.setItem('florde-capability-cache', JSON.stringify(capabilityCache));
  await saveSettingsToDisk(settings);

  // Save valid API keys to OS keychain
  if (window.electronAPI?.keychain) {
    const keyProviders = [
      { id: 'openai', key: settings.openaiKey },
      { id: 'deepseek', key: settings.deepseekKey },
      { id: 'mistral', key: settings.mistralKey },
      { id: 'anthropic', key: settings.anthropicKey },
      { id: 'gemini', key: settings.geminiKey },
      { id: 'grok', key: settings.grokKey },
      { id: 'opencode', key: settings.opencodeKey },
      { id: 'openrouter', key: settings.openrouterKey },
      { id: 'custom', key: settings.customKey },
    ];
    for (const p of keyProviders) {
      if (p.key) {
        try { await window.electronAPI.keychain.store({ key: 'provider:' + p.id, value: p.key }); } catch (e) {}
      }
    }
  }

  delete providers.openai; delete providers.deepseek; delete providers.mistral;
  delete providers.anthropic; delete providers.gemini; delete providers.grok;
  delete providers.opencode; delete providers.ollama; delete providers.lmstudio; delete providers.localai;
  delete providers.openrouter; delete providers.custom;

  function setTemp(prov, id) { if (prov) prov.temperature = settings[id + 'Temp'] || 0.7; }
  const p = settings;
  if (p.openaiEnabled && p.openaiKey) setTemp(providers.openai = new OpenAIProvider(p.openaiKey, p.openaiModel), 'openai');
  if (p.deepseekEnabled && p.deepseekKey) setTemp(providers.deepseek = new DeepSeekProvider(p.deepseekKey, p.deepseekModel), 'deepseek');
  if (p.mistralEnabled && p.mistralKey) setTemp(providers.mistral = new MistralProvider(p.mistralKey, p.mistralModel), 'mistral');
  if (p.anthropicEnabled && p.anthropicKey) setTemp(providers.anthropic = new AnthropicProvider(p.anthropicKey, p.anthropicModel), 'anthropic');
  if (p.geminiEnabled && p.geminiKey) setTemp(providers.gemini = new GeminiProvider(p.geminiKey, p.geminiModel), 'gemini');
  if (p.grokEnabled && p.grokKey) setTemp(providers.grok = new GrokProvider(p.grokKey, p.grokModel), 'grok');
  if (p.opencodeEnabled && p.opencodeKey) setTemp(providers.opencode = new OpenCodeProvider(p.opencodeKey, p.opencodeModel), 'opencode');
  if (p.ollamaEnabled) setTemp(providers.ollama = new OllamaProvider(p.ollamaUrl, p.ollamaModel), 'ollama');
  if (p.lmstudioEnabled) setTemp(providers.lmstudio = new LMStudioProvider(p.lmstudioUrl, p.lmstudioModel), 'lmstudio');
  if (p.localaiEnabled) setTemp(providers.localai = new LocalAIProvider(p.localaiUrl, p.localaiModel), 'localai');
  if (p.openrouterEnabled && p.openrouterKey) setTemp(providers.openrouter = new OpenRouterProvider(p.openrouterKey, p.openrouterModel), 'openrouter');
  if (p.customEnabled && p.customKey) setTemp(providers.custom = new CustomProvider(p.customKey, p.customModel, p.customUrl), 'custom');

  const prevTheme = currentTheme;
  currentTheme = settings.theme;
  if (currentTheme !== prevTheme) applyTheme();

  await window.electronAPI.setAutoStart(document.getElementById('auto-start').checked);

  updateProviderDropdown();

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  if (invalidResults.length === 0) {
    document.getElementById('settings-modal').classList.add('hidden');
    if (document.getElementById('app-view').classList.contains('hidden')) showStartMenu();
    showNotification('ready', 'Florde Is Ready \u2014 Settings saved successfully', '\u2713');
  } else {
    showNotification('permission', 'Florde Needs Permission \u2014 Some keys were invalid and not saved. Check the validation results.', '\u26A0');
  }
  } catch (err) {
    console.error('Settings save error:', err);
    const saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    showNotification('error', 'Settings Error \u2014 ' + err.message, '\u2717');
  }
}

// ==================== THEME ====================

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme || 'dark');
  const isLight = currentTheme === 'light' || currentTheme === 'solarized-light';
  document.getElementById('btn-theme-toggle').textContent = isLight ? '\u263D' : '\u2600';
  if (editor) {
    const monacoTheme = isLight ? 'vs' : 'vs-dark';
    monaco.editor.setTheme(monacoTheme);
  }
}

// ==================== SANDBOX ====================

async function initSandbox() {
  sandboxDir = await window.electronAPI.getSandboxDir();
  updateSandboxStatus();
}

function updatePrivacyIndicator() {
  const el = document.getElementById('privacy-indicator');
  const selected = document.getElementById('provider-select').value;
  const isLocal = selected === 'ollama' || selected === 'lmstudio' || selected === 'localai';
  if (isLocal) {
    el.textContent = '\uD83D\uDFE2 Local';
    el.className = 'privacy-indicator local';
    el.title = 'Du arbeitest 100% lokal. Keine Daten verlassen diesen PC.';
  } else {
    el.textContent = '\uD83D\uDFE1 Hybrid';
    el.className = 'privacy-indicator hybrid';
    el.title = 'Du nutzt einen externen Provider. Daten werden verschl\u00fcsselt \u00fcbertragen.';
  }
}

function updateProviderDropdown() {
  const sel = document.getElementById('provider-select');
  const currentVal = sel.value;
  const activeProviders = [];
  const allProviders = [
    'openai', 'deepseek', 'mistral', 'anthropic', 'gemini', 'grok',
    'opencode', 'ollama', 'lmstudio', 'localai', 'openrouter', 'custom'
  ];
  for (const id of allProviders) {
    const cb = document.querySelector('.provider-enabled[data-provider="' + id + '"]');
    const enabled = cb ? cb.checked : false;
    if (!enabled) continue;
    const keyInput = document.getElementById('key-' + id);
    const urlInput = document.getElementById('url-' + id);
    const hasKey = keyInput && keyInput.value.trim() !== '';
    const hasUrl = urlInput && urlInput.value.trim() !== '';
    if (hasKey || hasUrl) {
      activeProviders.push(id);
    }
  }
  if (activeProviders.length === 0) activeProviders.push('ollama');
  const options = sel.querySelectorAll('option');
  let hasCurrent = false;
  for (const opt of options) {
    if (activeProviders.includes(opt.value)) {
      opt.style.display = '';
      if (opt.value === currentVal) hasCurrent = true;
    } else {
      opt.style.display = 'none';
    }
  }
  if (!hasCurrent && activeProviders.length > 0) {
    sel.value = activeProviders[0];
    updatePrivacyIndicator();
  }
  updateModelInfoBadge();
}

function updateModelInfoBadge() {
  const badge = document.getElementById('model-info-badge');
  if (!badge) return;
  const sel = document.getElementById('provider-select');
  const provider = sel?.value;
  const prov = providers[provider];
  const model = prov?.model || '';
  badge.textContent = model;
  badge.title = 'Model: ' + model + '\nProvider: ' + (provider || '') + '\nClick for details';
}

document.addEventListener('click', (e) => {
  const badge = document.getElementById('model-info-badge');
  if (badge && (e.target === badge || badge.contains(e.target))) {
    showModelInfoPopup();
  }
  // Close model info popup on outside click
  const popup = document.getElementById('model-info-popup');
  if (popup && !popup.contains(e.target) && e.target !== badge) {
    popup.classList.add('hidden');
  }
});

function showModelInfoPopup() {
  const sel = document.getElementById('provider-select');
  const provider = sel?.value;
  const prov = providers[provider];
  const cacheKey = provider + ':' + (prov?.model || 'default');
  const caps = capabilityCache[cacheKey] || getKnownCapabilities(provider, prov?.model);
  const temp = prov?.temperature !== undefined ? prov.temperature : 0.7;
  const isLocal = provider === 'ollama' || provider === 'lmstudio' || provider === 'localai';

  let popup = document.getElementById('model-info-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'model-info-popup';
    popup.className = 'model-info-popup hidden';
    document.body.appendChild(popup);
  }

  const badge = document.getElementById('model-info-badge');
  const rect = badge?.getBoundingClientRect();
  popup.style.top = (rect ? rect.bottom + 4 : 30) + 'px';
  popup.style.right = (rect ? document.body.offsetWidth - rect.right : 10) + 'px';

  const capList = caps ? Object.entries(caps).map(([k, v]) => '<span class="cap-item ' + (v ? 'cap-yes' : 'cap-no') + '">' + k.replace(/_/g, ' ') + ': ' + (v ? '\u2713' : '\u2717') + '</span>').join('') : '<span>Loading...</span>';

  popup.innerHTML = '<div class="model-info-header">' +
    '<strong>' + (prov?.model || 'Unknown') + '</strong>' +
    '<span class="model-info-provider">' + provider + (isLocal ? ' \U0001F194' : ' \U0001F511') + '</span>' +
    '</div>' +
    '<div class="model-info-body">' +
    '<div class="model-info-section"><strong>Temperature:</strong> ' + temp.toFixed(1) + '</div>' +
    '<div class="model-info-section"><strong>Capabilities:</strong></div>' +
    '<div class="model-info-caps">' + capList + '</div>' +
    '</div>';

  popup.classList.remove('hidden');
}

function updateSandboxStatus() {
  const el = document.getElementById('sandbox-status');
  if (currentProjectType === 'local') {
    el.textContent = '';
    el.className = 'sandbox-status hidden';
    return;
  }
  if (sandboxDir) {
    el.textContent = '';
    el.className = 'sandbox-status hidden';
  } else {
    el.textContent = '';
    el.className = 'sandbox-status hidden';
  }
}

// ==================== TERMINAL ====================

function logToTerminal(message, type = 'info') {
  const el = document.getElementById('terminal-output');
  const div = document.createElement('div');
  div.className = 'log-line ' + type;
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${message}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ==================== START MENU ====================

function blurMonaco() {
  const container = document.getElementById('editor-container');
  if (!container) return;
  const ta = container.querySelector('textarea');
  if (ta) { ta.blur(); ta.setAttribute('tabindex', '-1'); }
}

function showStartMenu() {
  document.getElementById('start-menu').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  loadProjectList();
}

function showAppView() {
  document.getElementById('start-menu').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  restoreMonacoTabindex();
}

function restoreMonacoTabindex() {
  const container = document.getElementById('editor-container');
  if (!container) return;
  const ta = container.querySelector('textarea');
  if (ta && ta.getAttribute('tabindex') === '-1') ta.removeAttribute('tabindex');
}

function getSortedProjects(projects) {
  const favorites = Favorites.getFavorites();
  const favs = projects.filter(p => favorites.includes(p.name));
  const rest = projects.filter(p => !favorites.includes(p.name));
  return [...favs, ...rest];
}

async function loadProjectList() {
  const container = document.getElementById('project-items');
  const projects = getSortedProjects(await window.electronAPI.listProjects());
  container.innerHTML = '';
  document.getElementById('project-list').classList.remove('hidden');
  if (projects.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);font-size:0.85rem;padding:0.5rem;">No projects yet</div>';
    return;
  }
  for (const p of projects) {
    const div = document.createElement('div');
    div.className = 'project-item';
    div.dataset.path = p.name;
    const typeLabel = p.type === 'local' ? 'Local' : 'Sandbox';
    const isFav = Favorites.isFavorite(p.name);
    div.innerHTML = `<button class="star-icon" data-path="${p.name}">${isFav ? '\u2605' : '\u2606'}</button><span class="project-type">${typeLabel}</span><span style="flex:1">${p.name}</span><button class="project-del" data-name="${p.name}">&times;</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') WorkspaceManager.openProject(p.name, p.name);
    });
    div.querySelector('.star-icon').addEventListener('click', (e) => {
      e.stopPropagation();
      Favorites.toggle(p.name);
    });
    div.querySelector('.project-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete project "${p.name}"?`)) {
        await window.electronAPI.deleteProject(p.name);
        loadProjectList();
      }
    });
    container.appendChild(div);
  }
}

document.getElementById('btn-start-new').addEventListener('click', () => {
  document.getElementById('new-project-modal').classList.remove('hidden');
  document.getElementById('new-project-name').value = '';
  blurMonaco();
  requestAnimationFrame(() => document.getElementById('new-project-name').focus());
});

document.getElementById('btn-cancel-new').addEventListener('click', () => {
  document.getElementById('new-project-modal').classList.add('hidden');
});

const TEMPLATES = {
  'web-app': { 'index.html': '<!DOCTYPE html><html><head><title>My App</title><link rel="stylesheet" href="style.css"></head><body><h1>Hello World</h1><script src="script.js"></script></body></html>', 'style.css': 'body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #0a0a0f; color: #e0e0e0; }', 'script.js': '// Welcome to your web app\nconsole.log("App is running!");' },
  'python-script': { 'main.py': '# Welcome to Florde\n\ndef main():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    main()\n', 'README.md': '# Python Project\n\nGenerated by Florde' },
  'node-api': { 'index.js': 'const express = require("express");\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.get("/", (req, res) => {\n  res.json({ message: "Hello World" });\n});\n\napp.listen(port, () => {\n  console.log(`Server running on port ${port}`);\n});\n', 'package.json': JSON.stringify({ name: 'my-api', version: '1.0.0', main: 'index.js', scripts: { start: 'node index.js' }, dependencies: { express: '^4.18.0' } }, null, 2) },
  'react-app': { 'index.html': '<!DOCTYPE html><html><head><title>React App</title></head><body><div id="root"></div><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="app.js"></script></body></html>', 'app.js': 'const App = () => {\n  const [count, setCount] = React.useState(0);\n  return React.createElement("div", null,\n    React.createElement("h1", null, "Hello React"),\n    React.createElement("p", null, `Count: ${count}`),\n    React.createElement("button", { onClick: () => setCount(c => c + 1) }, "Increment")\n  );\n};\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));\n' },
  'cli-tool': { 'cli.py': '#!/usr/bin/env python3\nimport argparse\n\ndef main():\n    parser = argparse.ArgumentParser(description="CLI Tool")\n    parser.add_argument("--name", default="World", help="Name to greet")\n    args = parser.parse_args()\n    print(f"Hello, {args.name}!")\n\nif __name__ == "__main__":\n    main()\n', 'README.md': '# CLI Tool\n\nA command-line tool generated by Florde\n\nUsage: `python cli.py --name YourName`' }
};

function createProjectFromInput() {
  const name = document.getElementById('new-project-name').value.trim();
  const template = document.getElementById('project-template').value;
  if (!name) { alert('Please enter a project name'); return; }
  window.electronAPI.createSandboxProject(name).then(async ok => {
    if (ok) {
      if (template && TEMPLATES[template]) {
        for (const [file, content] of Object.entries(TEMPLATES[template])) {
          await window.electronAPI.projectWriteFile(name, file, content);
        }
        logToTerminal(`Created project "${name}" from template`, 'success');
      }
      document.getElementById('new-project-modal').classList.add('hidden');
      WorkspaceManager.openProject(name, name);
    } else {
      alert('Project already exists');
    }
  });
}

document.getElementById('btn-create-project').addEventListener('click', createProjectFromInput);
document.getElementById('new-project-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createProjectFromInput();
});

// Local Project
document.getElementById('btn-start-local').addEventListener('click', () => {
  document.getElementById('local-project-modal').classList.remove('hidden');
  document.getElementById('local-project-name').value = '';
  document.getElementById('local-project-path').value = '';
  blurMonaco();
  requestAnimationFrame(() => document.getElementById('local-project-name').focus());
});

document.getElementById('btn-cancel-local').addEventListener('click', () => {
  document.getElementById('local-project-modal').classList.add('hidden');
});

document.getElementById('btn-browse-folder').addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) document.getElementById('local-project-path').value = folder;
});

document.getElementById('btn-create-local').addEventListener('click', async () => {
  const name = document.getElementById('local-project-name').value.trim();
  const path = document.getElementById('local-project-path').value.trim();
  if (!name) { alert('Please enter a project name'); return; }
  if (!path) { alert('Please select a folder'); return; }
  const result = await window.electronAPI.createLocalProject(name, path);
  if (result.ok) {
    document.getElementById('local-project-modal').classList.add('hidden');
    WorkspaceManager.openProject(name, name);
  } else if (result.error === 'exists') {
    alert('Project already exists');
  } else {
    alert('Folder not found');
  }
});

document.getElementById('btn-start-open').addEventListener('click', loadProjectList);

document.getElementById('btn-start-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('start-menu').classList.add('hidden');
});

// ==================== PROJECT ====================

async function openProject(name) {
  currentProject = name;
  document.getElementById('project-name').textContent = name;

  const session = await window.electronAPI.loadSession(name);
  const savedMessages = session.history || [];
  ChatManager._sessions = [];
  ChatManager._nextId = 1;
  ChatManager.newSession();
  const active = ChatManager.getActive();
  active.messages = savedMessages;
  chatHistory = active.messages;

  const files = await window.electronAPI.projectListFiles(name);
  openTabs = [];
  tabContents = {};
  tabLanguages = {};
  tabDirty = {};
  activeTabIndex = -1;

  const meta = (await window.electronAPI.listProjects()).find(p => p.name === name);
  currentProjectType = meta ? meta.type : 'sandbox';
  document.getElementById('project-type-badge').textContent = currentProjectType === 'local' ? 'LOCAL' : 'SANDBOX';
  document.getElementById('btn-export-zip').style.display = currentProjectType === 'sandbox' ? '' : 'none';
  document.getElementById('btn-save-all').style.display = currentProjectType === 'sandbox' ? '' : 'none';

  if (files.length > 0) {
    for (const f of files) await openTab(f, false);
    if (openTabs.length > 0) switchTab(0);
  } else {
    const defaultContent = '# Welcome to Florde!\n# Start coding or describe what you want to build in the chat.';
    const defaultName = 'welcome.py';
    tabContents[defaultName] = defaultContent;
    tabLanguages[defaultName] = 'python';
    tabDirty[defaultName] = false;
    openTabs.push(defaultName);
    activeTabIndex = 0;
    switchTab(0);
  }

  showAppView();
  renderFileTree();
  updateSandboxStatus();
  updatePrivacyIndicator();
  updateProviderDropdown();
  logToTerminal(`Opened project: ${name} (${currentProjectType})`, 'success');

  if (chatHistory.length === 0) {
    const welcome = 'I\'m your AI coding assistant. I can help you write, explain, and debug code. ' +
      'Send me a message to get started!';
    chatHistory.push({ role: 'assistant', content: welcome });
    trimChatHistory();
    renderChat();
  }
}

// ==================== PLUGIN MARKETPLACE ====================

document.getElementById('btn-start-plugins').addEventListener('click', () => {
  document.getElementById('plugin-modal').classList.remove('hidden');
  if (pluginRegistry && pluginRegistry._loaded) renderPluginMarketplace();
});

document.getElementById('btn-plugins').addEventListener('click', () => {
  document.getElementById('plugin-modal').classList.remove('hidden');
  if (pluginRegistry && pluginRegistry._loaded) renderPluginMarketplace();
});

document.getElementById('btn-close-plugins').addEventListener('click', () => {
  document.getElementById('plugin-modal').classList.add('hidden');
});

document.getElementById('plugin-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.plugin-card').forEach(card => {
    const name = card.querySelector('.plugin-name')?.textContent?.toLowerCase() || '';
    const desc = card.querySelector('.plugin-desc')?.textContent?.toLowerCase() || '';
    card.style.display = (name.includes(q) || desc.includes(q)) ? '' : 'none';
  });
});

document.getElementById('btn-plugin-docs').addEventListener('click', () => {
  PluginDocs.show();
});

document.getElementById('btn-close-plugin-docs').addEventListener('click', () => {
  document.getElementById('plugin-docs-modal').classList.add('hidden');
});

document.getElementById('plugin-docs-content').addEventListener('click', (e) => {
  const link = e.target.closest('.docs-link');
  if (link && link.dataset.doc) {
    PluginDocs.showDoc(link.dataset.doc);
    e.preventDefault();
  }
});

// Click sidebar links in docs modal
document.querySelectorAll('.docs-sidebar a').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    PluginDocs.showDoc(a.dataset.doc);
    document.querySelectorAll('.docs-sidebar a').forEach(l => l.classList.remove('active'));
    a.classList.add('active');
  });
});

// Close docs modal on overlay click
document.getElementById('plugin-docs-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('plugin-docs-modal').classList.add('hidden');
  }
});

// Upload plugin button (ZIP or folder)
document.getElementById('btn-upload-plugin').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  if (input.webkitdirectory !== undefined) {
    // Chromium: accept both .zip and directories via two passes
  }
  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const pluginData = {
      id: 'local-' + Date.now(),
      name: 'Local Plugin',
      version: '1.0.0',
      description: 'Local development plugin',
      author: 'Developer',
      installed: true,
      enabled: true,
      builtin: false,
      local: true
    };

    try {
      // If multiple files (folder via webkitdirectory), read each
      if (e.target.files.length > 1 || !file.name.toLowerCase().endsWith('.zip')) {
        for (const f of e.target.files) {
          const content = await f.text();
          if (f.name === 'manifest.json') {
            try { Object.assign(pluginData, JSON.parse(content)); } catch (e) {}
          }
        }
      } else {
        // Single ZIP file
        const buffer = await file.arrayBuffer();
        const extracted = extractZip(buffer);
        const manifestContent = extracted['manifest.json'] || extracted['hello-world/manifest.json'];
        if (manifestContent) {
          try { Object.assign(pluginData, JSON.parse(manifestContent)); } catch (e) {}
        }
        pluginData._extractedFiles = extracted;
      }

      pluginData.id = pluginData.id || 'local-' + Date.now();
      pluginRegistry.registerLocal(pluginData);
      renderPluginMarketplace();
      showNotification('success', 'Plugin loaded: ' + pluginData.name, '\u2713');
    } catch (err) {
      showNotification('error', 'Failed to load plugin: ' + err.message, '\u2715');
    }
  });
  input.click();
});

document.getElementById('btn-back-menu').addEventListener('click', async () => {
  await saveSession();
  showStartMenu();
});

document.getElementById('btn-save-all').addEventListener('click', saveAllTabs);

async function saveSession() {
  if (!currentProject) return;
  const currentContent = editor ? editor.getValue() : '';
  for (let f of Object.keys(tabContents)) {
    tabContents[f] = f === getActiveFileName() ? currentContent : tabContents[f];
    tabDirty[f] = false;
  }
  const sessionToSave = ChatManager.getActive();
  const historyToSave = sessionToSave ? sessionToSave.messages : chatHistory;
  await window.electronAPI.saveSession(currentProject, { history: historyToSave });
  renderTabs();
}

async function saveAllTabs() {
  const currentContent = editor ? editor.getValue() : '';
  for (let f of Object.keys(tabContents)) {
    tabContents[f] = f === getActiveFileName() ? currentContent : tabContents[f];
    if (currentProject) {
      await window.electronAPI.projectWriteFile(currentProject, f, tabContents[f]);
    }
    tabDirty[f] = false;
  }
  renderTabs();
  logToTerminal('All files saved', 'success');
}

async function saveCurrentFile() {
  const name = getActiveFileName();
  if (!name) return;
  tabContents[name] = editor ? editor.getValue() : '';
  tabDirty[name] = false;
  if (currentProject) {
    await window.electronAPI.projectWriteFile(currentProject, name, tabContents[name]);
  }
  renderTabs();
  logToTerminal(`Saved: ${name}`, 'success');
}

function getActiveFileName() {
  return activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
}

// ==================== FILE TABS ====================

function renderTabs() {
  const container = document.getElementById('file-tabs');
  container.innerHTML = '';
  openTabs.forEach((name, i) => {
    const tab = document.createElement('div');
    tab.className = 'file-tab' + (i === activeTabIndex ? ' active' : '');
    if (tabDirty[name]) {
      const dot = document.createElement('span');
      dot.className = 'dirty'; dot.textContent = '\u25CF';
      tab.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = name.split('/').pop();
    tab.appendChild(label);
    const close = document.createElement('button');
    close.className = 'close-tab'; close.textContent = '\u00D7';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(i); });
    tab.appendChild(close);
    tab.addEventListener('click', () => switchTab(i));
    tab.addEventListener('dblclick', () => renameTab(i));
    container.appendChild(tab);
  });
}

let autoSaveTimer;
const modelDisposables = new Map();

async function switchTab(index) {
  if (activeTabIndex >= 0 && activeTabIndex < openTabs.length && editor) {
    tabContents[openTabs[activeTabIndex]] = editor.getValue();
    if (currentProjectType === 'local') await saveCurrentFile();
  }
  activeTabIndex = index;
  const name = openTabs[index];
  document.getElementById('file-name').textContent = name;
  const lang = tabLanguages[name] || detectLanguage(name);
  if (editor) {
    const model = monaco.editor.getModels().find(m => m.uri.path === '/' + name);
    if (model) {
      editor.setModel(model);
    } else {
      const uri = monaco.Uri.parse('file:///' + name);
      const newModel = monaco.editor.createModel(tabContents[name] || '', lang, uri);
      editor.setModel(newModel);
    }
    if (!modelDisposables.has(name)) {
      const disposable = editor.getModel().onDidChangeContent(() => {
        tabDirty[name] = true;
        if (activeTabIndex === openTabs.indexOf(name)) renderTabs();
        if (currentProjectType === 'local') {
          clearTimeout(autoSaveTimer);
          autoSaveTimer = setTimeout(() => saveCurrentFile(), 1000);
        }
      });
      modelDisposables.set(name, disposable);
    }
  }
  renderTabs();
}

async function closeTab(index) {
  if (openTabs.length <= 1) return;
  const name = openTabs[index];
  if (tabDirty[name] && !confirm(`"${name}" has unsaved changes. Close anyway?`)) return;
  if (currentProjectType === 'local') await saveCurrentFile();
  const disposable = modelDisposables.get(name);
  if (disposable) { disposable.dispose(); modelDisposables.delete(name); }
  const model = monaco.editor.getModels().find(m => m.uri.path === '/' + name);
  if (model) model.dispose();
  openTabs.splice(index, 1);
  if (index <= activeTabIndex) activeTabIndex = Math.max(0, activeTabIndex - 1);
  if (activeTabIndex >= openTabs.length) activeTabIndex = openTabs.length - 1;
  if (openTabs.length > 0) switchTab(activeTabIndex);
  else {
    document.getElementById('file-name').textContent = 'No file open';
    if (editor) editor.setValue('');
    if (editor) editor.setModel(null);
  }
  renderTabs();
  updateStatusBar();
}

function closeAllTabs() {
  if (openTabs.length === 0) return;
  let dirty = openTabs.filter(n => tabDirty[n]);
  if (dirty.length > 0 && !confirm(dirty.length + ' Tab(s) have unsaved changes. Close all anyway?')) return;
  for (const name of openTabs) {
    const disposable = modelDisposables.get(name);
    if (disposable) { disposable.dispose(); modelDisposables.delete(name); }
    const model = monaco.editor.getModels().find(m => m.uri.path === '/' + name);
    if (model) model.dispose();
  }
  openTabs = [];
  activeTabIndex = -1;
  document.getElementById('file-name').textContent = 'No file open';
  if (editor) editor.setValue('');
  if (editor) editor.setModel(null);
  renderTabs();
  updateStatusBar();
}

function renameTab(index) {
  const oldName = openTabs[index];
  const newName = prompt('Rename file:', oldName);
  if (!newName || newName === oldName) return;
  if (currentProject) {
    window.electronAPI.projectRenameFile(currentProject, oldName, newName).then(() => {
      openTabs[index] = newName;
      tabContents[newName] = tabContents[oldName];
      tabLanguages[newName] = tabLanguages[oldName];
      tabDirty[newName] = tabDirty[oldName];
      delete tabContents[oldName]; delete tabLanguages[oldName]; delete tabDirty[oldName];
      renderTabs();
      renderFileTree();
    });
  }
}

// ==================== FILE TREE (SIDEBAR) ====================

async function renderFileTree() {
  if (!currentProject) return;
  const container = document.getElementById('file-tree');
  container.innerHTML = '';
  const files = await window.electronAPI.projectListFiles(currentProject);
  const tree = buildTree(files);
  for (const node of tree) renderTreeNode(node, container, '');
}

function buildTree(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      if (isFile) {
        if (!current._files) current._files = [];
        current._files.push(parts[i]);
      } else {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
    }
  }
  function toList(obj, path) {
    const items = [];
    const dirs = Object.keys(obj).filter(k => k !== '_files').sort();
    for (const d of dirs) {
      items.push({ type: 'dir', name: d, path: path + d + '/', children: toList(obj[d], path + d + '/') });
    }
    if (obj._files) {
      for (const f of obj._files.sort()) items.push({ type: 'file', name: f, path: path + f });
    }
    return items;
  }
  return toList(root, '');
}

function renderTreeNode(node, parent, path) {
  if (node.type === 'dir') {
    const details = document.createElement('details');
    details.className = 'tree-dir';
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'tree-item';
    summary.innerHTML = `<span class="icon">\u{1F4C1}</span><span class="name">${node.name}</span>`;
    summary.addEventListener('click', (e) => {
      e.preventDefault();
      details.open = !details.open;
    });
    details.appendChild(summary);
    const children = document.createElement('div');
    children.className = 'tree-children';
    for (const child of node.children) renderTreeNode(child, children, node.path);
    details.appendChild(children);
    parent.appendChild(details);
  } else {
    const item = document.createElement('div');
    item.className = 'tree-item' + (openTabs[activeTabIndex] === node.path ? ' active' : '');
    item.innerHTML = `<span class="icon">\u{1F4C4}</span><span class="name">${node.name}</span>`;
    item.addEventListener('click', async () => {
      const existing = openTabs.indexOf(node.path);
      if (existing >= 0) switchTab(existing);
      else await openTab(node.path, true);
    });
    parent.appendChild(item);
  }
}

document.getElementById('btn-close-all-tabs').addEventListener('click', closeAllTabs);

document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('hidden');
});

document.getElementById('btn-refresh-tree').addEventListener('click', () => { renderFileTree(); logToTerminal('File tree refreshed', 'info'); });

function updateStatusBar() {
  if (!editor) return;
  const pos = editor.getPosition();
  if (pos) {
    document.getElementById('status-line-col').textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  }
  const name = openTabs[activeTabIndex] || '';
  const lang = tabLanguages[name] || detectLanguage(name) || 'Plain Text';
  document.getElementById('status-language').textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
}

// ==================== MONACO EDITOR ====================

function detectLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = { py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    html: 'html', htm: 'html', css: 'css', json: 'json', md: 'markdown', java: 'java',
    cpp: 'cpp', c: 'cpp', h: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby',
    php: 'php', sql: 'sql', sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', svg: 'xml', txt: 'plaintext', gitignore: 'plaintext', env: 'plaintext' };
  return map[ext] || 'plaintext';
}

// ==================== CHAT ====================

function renderChat() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  for (const msg of chatHistory) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + msg.role;
    if (msg._question) continue;
    const label = msg.role === 'user' ? 'You' : 'Florde AI';
    const modelHint = msg.role === 'assistant' && msg.model ? ` \u00B7 ${msg.model}` : '';
    div.innerHTML = `<div class="msg-label">${label}${modelHint} <button class="copy-msg" data-content="${encodeURIComponent(msg.content)}">Copy</button></div>` + formatMessageContent(msg.content);
    container.appendChild(div);
    if (msg.role === 'assistant' && msg.content) {
      const continueBtn = document.createElement('button');
      continueBtn.className = 'btn-continue';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', async () => {
        continueBtn.disabled = true;
        continueBtn.textContent = 'Continuing...';
        await sendMessage('Continue from where you left off. Do not repeat yourself.');
        continueBtn.remove();
      });
      container.appendChild(continueBtn);
    }
  }
  container.scrollTop = container.scrollHeight;
  updateTokenCount();
}

function copyMessageText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  }).catch(() => showNotification('error', 'Copy to clipboard failed', '✕'));
}

function exportChat(format) {
  const session = ChatManager.getActive();
  if (!session || session.messages.length === 0) {
    showNotification('error', 'No messages to export', '✕');
    return;
  }
  const timestamp = new Date().toISOString().split('T')[0];
  let content = '';
  switch (format) {
    case 'markdown':
      content = `# Florde Chat Export\nDate: ${timestamp}\n\n`;
      content += session.messages.filter(m => m.role !== 'system').map(m => {
        const role = m.role === 'user' ? '**You**' : '**Florde AI**';
        return `${role}:\n${m.content}\n\n---\n\n`;
      }).join('');
      break;
    case 'json':
      content = JSON.stringify(session.messages.filter(m => m.role !== 'system'), null, 2);
      break;
    case 'text':
      content = session.messages.filter(m => m.role !== 'system').map(m => {
        const role = m.role === 'user' ? 'You' : 'Florde AI';
        return `[${role}]\n${m.content}\n`;
      }).join('\n');
      break;
  }
  const ext = format === 'markdown' ? 'md' : format;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `florde-chat-${timestamp}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification('success', `Chat exported as ${format}`, '✓');
}

document.getElementById('btn-export-chat')?.addEventListener('click', () => {
  const choice = document.createElement('div');
  choice.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg,#1e1e36);border:1px solid var(--border);border-radius:8px;padding:1rem;z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
  choice.innerHTML = '<div style="margin-bottom:8px;font-weight:600;">Export Chat As:</div>'
    + '<button class="export-opt" data-fmt="markdown" style="display:block;width:100%;margin:4px 0;padding:6px 12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:4px;cursor:pointer;">Markdown (.md)</button>'
    + '<button class="export-opt" data-fmt="json" style="display:block;width:100%;margin:4px 0;padding:6px 12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:4px;cursor:pointer;">JSON (.json)</button>'
    + '<button class="export-opt" data-fmt="text" style="display:block;width:100%;margin:4px 0;padding:6px 12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:4px;cursor:pointer;">Plain Text (.txt)</button>'
    + '<button id="cancel-export" style="display:block;width:100%;margin-top:8px;padding:4px;background:none;border:none;color:var(--text2);cursor:pointer;">Cancel</button>';
  document.body.appendChild(choice);
  choice.querySelectorAll('.export-opt').forEach(btn => {
    btn.addEventListener('click', () => { exportChat(btn.dataset.fmt); choice.remove(); });
  });
  document.getElementById('cancel-export').addEventListener('click', () => choice.remove());
  choice.addEventListener('click', (e) => { if (e.target === choice) choice.remove(); });
});

document.addEventListener('click', (e) => {
  const msgBtn = e.target.closest('.copy-msg');
  if (msgBtn) { e.stopPropagation(); copyMessageText(decodeURIComponent(msgBtn.dataset.content), msgBtn); return; }
  const codeBtn = e.target.closest('.copy-code');
  if (codeBtn) { e.stopPropagation(); copyMessageText(decodeURIComponent(codeBtn.dataset.content), codeBtn); }
});

function formatMessageContent(content) {
  const seeThoughts = document.getElementById('see-thoughts')?.checked !== false;
  let html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (seeThoughts) {
    html = html.replace(/\[think\]([\s\S]*?)\[\/think\]/g, '<div class="think-block">$1</div>');
  } else {
    html = html.replace(/\[think\][\s\S]*?\[\/think\]/g, '');
  }
  html = html.replace(/```file:([^\n]+)\n([\s\S]*?)```/g, (m, file, code) => {
    const id = 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const safeCode = code.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div class="file-block" id="${id}"><span class="file-block-name">${file}</span><pre><code>${safeCode}</code></pre></div>`;
  });
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const safeCode = code.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const langClass = lang ? ` class="lang-${lang}"` : '';
    return `<pre${langClass}><button class="copy-code" data-content="${encodeURIComponent(code)}">Copy</button><code>${safeCode}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br/>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return html;
}

// Toolbar collapse
(function() {
  const key = 'florde-toolbar-collapsed';
  const btn = document.querySelector('.btn-toolbar-toggle');
  const content = document.querySelector('.toolbar-content');
  if (btn && content) {
    const collapsed = localStorage.getItem(key) === 'true';
    content.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '\u25B6' : '\u25C0';
    btn.addEventListener('click', () => {
      const now = content.classList.toggle('collapsed');
      localStorage.setItem(key, now);
      btn.textContent = now ? '\u25B6' : '\u25C0';
    });
  }
})();

function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 300) + 'px';
}

function updateTokenCount() {
  const input = document.getElementById('chat-input').value;
  const inputTokens = countTokens(input);
  let historyTokens = 0;
  for (const m of chatHistory) historyTokens += countTokens(m.content);
  document.getElementById('token-count').textContent = `~${inputTokens} input \u00B7 ~${historyTokens} session`;
}

const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('input', () => { updateTokenCount(); autoResizeTextarea(chatInput); });
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById('btn-send').addEventListener('click', sendMessage);

// ==================== AUDIT LOG ====================

function renderAuditLog() {
  const container = document.getElementById('audit-list');
  container.innerHTML = '';
  const filtered = auditFilter === 'all' ? auditLog : auditLog.filter(e => e.type === auditFilter);
  const cloud = auditLog.filter(e => e.type === 'cloud').length;
  const local = auditLog.filter(e => e.type === 'local').length;
  const summaryHtml = `
    <div class="audit-stat"><span class="num all">${auditLog.length}</span><span class="label">Gesamt</span></div>
    <div class="audit-stat"><span class="num cloud">${cloud}</span><span class="label">Cloud</span></div>
    <div class="audit-stat"><span class="num local">${local}</span><span class="label">Lokal</span></div>
  `;
  document.getElementById('audit-summary').innerHTML = summaryHtml;
  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">Keine Eintr\u00e4ge</div>';
    return;
  }
  for (const entry of filtered) {
    const div = document.createElement('div');
    div.className = 'audit-entry';
    div.innerHTML = '<span class="audit-time">' + entry.time + '</span>'
      + '<span class="audit-badge ' + entry.type + '">' + entry.type + '</span>'
      + '<span class="audit-text">' + entry.text + '</span>';
    container.appendChild(div);
  }
}

document.getElementById('btn-audit-log').addEventListener('click', () => {
  document.getElementById('audit-modal').classList.remove('hidden');
  renderAuditLog();
});

document.getElementById('btn-close-audit').addEventListener('click', () => {
  document.getElementById('audit-modal').classList.add('hidden');
});

document.getElementById('btn-audit-clear').addEventListener('click', () => {
  auditLog = [];
  renderAuditLog();
});

document.querySelectorAll('.audit-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.audit-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    auditFilter = btn.dataset.filter;
    renderAuditLog();
  });
});

// ==================== GIT COMMIT ====================

document.getElementById('btn-git-commit').addEventListener('click', async () => {
  const name = document.getElementById('git-commit-name').value.trim();
  if (!name) { alert('Please enter a commit name.'); return; }
  const desc = document.getElementById('git-commit-desc').value.trim();
  const result = await GitCore.commit(name, desc);
  if (result.ok) {
    logToTerminal('Git commit: ' + name, 'success');
    document.getElementById('git-modal').classList.add('hidden');
    document.getElementById('git-commit-name').value = '';
    document.getElementById('git-commit-desc').value = '';
    document.getElementById('git-diff-preview').textContent = '';
    if (typeof GitPanel !== 'undefined') GitPanel.refresh();
  } else {
    logToTerminal('Git commit failed: ' + (result.error || 'unknown'), 'error');
  }
});

document.getElementById('btn-close-git').addEventListener('click', () => {
  document.getElementById('git-modal').classList.add('hidden');
});

document.getElementById('btn-git-commit-show').addEventListener('click', async () => {
  if (!currentProject) { logToTerminal('No project open for git commit', 'error'); return; }
  const projectRoot = await window.electronAPI.getProjectRoot(currentProject);
  if (!projectRoot) { logToTerminal('No project root for git commit', 'error'); return; }
  const status = await window.electronAPI.gitStatus(projectRoot);
  if (!status) { logToTerminal('Not a git repository or no changes', 'warn'); return; }
  const diff = await window.electronAPI.gitDiff(projectRoot);
  document.getElementById('git-diff-preview').textContent = diff || 'No changes to commit';
  document.getElementById('git-modal').classList.remove('hidden');
  document.getElementById('git-commit-name').focus();
});

// ==================== PRIVACY & PROVIDER ====================

document.getElementById('provider-select').addEventListener('change', () => { updatePrivacyIndicator(); updateModelInfoBadge(); });

function sanitizePath(filePath) {
  let normalized = filePath.replace(/\\/g, '/');
  while (normalized.includes('..')) {
    normalized = normalized.replace(/(^|\/)\.\.(\/|$)/g, '$1');
  }
  normalized = normalized.replace(/\/+/g, '/').replace(/^\//, '');
  return normalized || '_';
}

async function confirmFileAction(action, path) {
  return new Promise((resolve) => {
    const modal = document.getElementById('question-modal');
    document.getElementById('question-text').textContent =
      'Florde wants to ' + action + ': ' + path + '\n\nAllow this action?';
    const choicesDiv = document.getElementById('question-choices');
    choicesDiv.innerHTML = '';
    const btnAllow = document.createElement('button');
    btnAllow.className = 'question-choice';
    btnAllow.textContent = 'Allow';
    btnAllow.addEventListener('click', () => { modal.classList.add('hidden'); resolve(true); });
    const btnDeny = document.createElement('button');
    btnDeny.className = 'question-choice';
    btnDeny.textContent = 'Deny';
    btnDeny.addEventListener('click', () => { modal.classList.add('hidden'); resolve(false); });
    choicesDiv.appendChild(btnAllow);
    choicesDiv.appendChild(btnDeny);
    modal.classList.remove('hidden');
  });
}

async function executeToolCall(name, args) {
  const project = currentProject;
  const type = currentProjectType;

  const allowed = await PermissionManager.checkTool(name, args);
  if (!allowed) {
    return 'Permission denied: ' + name + ' is blocked';
  }

  if (typeof setActivity === 'function') setActivity(name + '(' + (args.path || args.command || args.query || '...') + ')');

  switch (name) {
    case 'read_file':
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Read_File: ' + sanitizePath(args.path));
      logToTerminal('Read_File: ' + sanitizePath(args.path), 'info');
      return await window.electronAPI.projectReadFile(project, sanitizePath(args.path));

    case 'write_file':
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Write_File: ' + sanitizePath(args.path));
      logToTerminal('Write_File: ' + sanitizePath(args.path), 'info');
      if (!await confirmFileAction('write', sanitizePath(args.path))) return 'Action cancelled by user';
      await window.electronAPI.projectWriteFile(project, sanitizePath(args.path), args.content);
      renderFileTree();
      return 'File written: ' + sanitizePath(args.path);

    case 'delete_file':
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Delete_File: ' + sanitizePath(args.path));
      logToTerminal('Delete_File: ' + sanitizePath(args.path), 'info');
      if (!await confirmFileAction('delete', sanitizePath(args.path))) return 'Action cancelled by user';
      await window.electronAPI.projectDeleteFile(project, sanitizePath(args.path));
      renderFileTree();
      return 'File deleted: ' + sanitizePath(args.path);

    case 'list_files':
      if (!project) throw new Error('No project open');
      const files = await window.electronAPI.projectListFiles(project);
      return JSON.stringify(files);

    case 'search_files':
      if (!project) throw new Error('No project open');
      const results = await window.electronAPI.searchInFiles(project, args.query);
      return JSON.stringify(results);

    case 'exec_command':
      if (!project) throw new Error('No project open');
      const execDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : sandboxDir;
      if (!execDir) throw new Error('AI Sandbox not configured');
      logToTerminal('AI executing: ' + args.command + ' in ' + execDir, 'command');
      const execResult = await window.electronAPI.sandboxExec(execDir, args.command);
      const outputText = typeof execResult === 'string' ? execResult : (execResult && execResult.output ? execResult.output : '');
      logToTerminal('Command output: ' + outputText.substring(0, 500), 'info');
      return outputText;

    case 'ask_question':
      showNotification('question', 'Florde Has a Question \u2014 Check the question dialog', '\u2753');
      return await askUserQuestion(args.question, args.choices);

    default:
      if (typeof pluginRegistry !== 'undefined' && pluginRegistry.toolHandlers.has(name)) {
        return await pluginRegistry.executeTool(name, args);
      }
      throw new Error('Unknown tool: ' + name);
  }
}

async function checkToolSupport(provider, providerId) {
  if (!provider) return false;
  if (provider._toolSupportTested) return provider._toolSupportResult;
  const cacheKey = providerId + ':' + (provider.model || 'default');
  if (capabilityCache[cacheKey] && capabilityCache[cacheKey].tool_calling !== undefined) {
    provider._toolSupportResult = capabilityCache[cacheKey].tool_calling;
    provider._toolSupportTested = true;
    return provider._toolSupportResult;
  }
  try {
    provider._toolSupportResult = await provider.detectToolSupport();
  } catch {
    provider._toolSupportResult = false;
  }
  provider._toolSupportTested = true;
  if (!capabilityCache[cacheKey]) capabilityCache[cacheKey] = {};
  capabilityCache[cacheKey].tool_calling = provider._toolSupportResult;
  return provider._toolSupportResult;
}

function getKnownCapabilities(providerId, model) {
  const m = (model || '').toLowerCase();
  const known = {
    openai: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('gpt-4') || m.includes('gpt-5'), thinking: false, images: true, embeddings: true, function_calling: true, custom_temperature: true, seed: true, context_caching: true },
    deepseek: { tool_calling: true, streaming: true, json_mode: true, vision: false, thinking: m.includes('reasoner'), images: false, embeddings: true, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
    mistral: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('large') || m.includes('devstral'), thinking: false, images: false, embeddings: true, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
    anthropic: { tool_calling: true, streaming: true, json_mode: false, vision: true, thinking: m.includes('sonnet') || m.includes('opus'), images: true, embeddings: false, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
    gemini: { tool_calling: true, streaming: true, json_mode: true, vision: true, thinking: false, images: true, embeddings: true, function_calling: true, custom_temperature: false, seed: false, context_caching: false },
    grok: { tool_calling: true, streaming: true, json_mode: true, vision: true, thinking: false, images: true, embeddings: false, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
    opencode: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('max'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
    ollama: { tool_calling: false, streaming: true, json_mode: false, vision: m.includes('llava') || m.includes('vision'), thinking: false, images: false, embeddings: false, function_calling: false, custom_temperature: true, seed: true, context_caching: false },
    lmstudio: { tool_calling: false, streaming: true, json_mode: false, vision: false, thinking: false, images: false, embeddings: false, function_calling: false, custom_temperature: true, seed: false, context_caching: false },
    localai: { tool_calling: false, streaming: true, json_mode: false, vision: false, thinking: false, images: false, embeddings: false, function_calling: false, custom_temperature: true, seed: false, context_caching: false },
    openrouter: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('gpt') || m.includes('claude'), thinking: false, images: true, embeddings: false, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
    custom: { tool_calling: true, streaming: true, json_mode: true, vision: false, thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: false, context_caching: false },
  };
  return known[providerId] || known.custom;
}

async function detectCapabilities(provider, providerId) {
  if (!provider) return {};
  const cacheKey = providerId + ':' + (provider.model || 'default');
  if (capabilityCache[cacheKey]) return capabilityCache[cacheKey];
  const known = getKnownCapabilities(providerId, provider.model);
  if (!known) return {};
  const toolCalling = await checkToolSupport(provider, providerId);
  known.tool_calling = toolCalling;
  capabilityCache[cacheKey] = known;
  return known;
}

async function sendMessage(text) {
  const input = document.getElementById('chat-input');
  if (!text) text = input.value.trim();
  if (!text) return;

  const provider = document.getElementById('provider-select').value;
  if (!providers[provider]) { logToTerminal('Please configure API key for ' + provider + ' in Settings', 'error'); return; }

  const isCloud = provider !== 'ollama' && provider !== 'lmstudio' && provider !== 'localai';
  addAuditEntry(isCloud ? 'cloud' : 'local', 'Nachricht gesendet an ' + provider);
  updatePrivacyIndicator();

  chatHistory.push({ role: 'user', content: text });
  trimChatHistory();
  if (input) input.value = '';
  renderChat();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg ai';
  msgDiv.innerHTML = '<div class="msg-label">Florde AI</div>';
  document.getElementById('chat-messages').appendChild(msgDiv);

  const contentDiv = document.createElement('div');
  msgDiv.appendChild(contentDiv);
  let animInterval = null;
  let _bufferedContent = '';
  function startAnim(text, suffix = '') {
    if (animInterval) clearInterval(animInterval);
    let dots = 1, dir = 1;
    const update = () => {
      const d = '.'.repeat(dots);
      contentDiv.innerHTML = formatMessageContent((_bufferedContent || text) + d + (suffix || ''));
      dots += dir;
      if (dots >= 4) dir = -1;
      if (dots <= 1) dir = 1;
    };
    update();
    animInterval = setInterval(update, 400);
  }
  function stopAnim(final) {
    if (animInterval) { clearInterval(animInterval); animInterval = null; }
    if (final !== undefined) _bufferedContent = final;
  }
  function renderResponse(final) {
    if (final !== undefined) _bufferedContent = final;
    const instant = document.getElementById('instant-mode')?.checked;
    if (instant) {
      contentDiv.innerHTML = formatMessageContent(_bufferedContent);
    } else {
      animateText(contentDiv, _bufferedContent);
    }
  }
  function animateText(el, fullText) {
    el.innerHTML = '';
    let idx = 0;
    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    cursor.textContent = '\u258C';
    const step = () => {
      if (idx >= fullText.length) { cursor.remove(); return; }
      el.innerHTML = formatMessageContent(fullText.slice(0, idx + 1));
      el.appendChild(cursor);
      idx++;
      const delay = fullText[idx] === '\n' ? 30 : fullText[idx] === ' ' ? 15 : 8;
      setTimeout(step, delay);
    };
    step();
  }

  startAnim('*Thinking*');

  let activityEl = null;
  let _activityTimeout = null;
  function setActivity(text) {
    if (!activityEl) {
      activityEl = document.createElement('div');
      activityEl.className = 'chat-activity';
      msgDiv.parentNode?.insertBefore(activityEl, msgDiv.nextSibling);
    }
    activityEl.textContent = text;
    if (_activityTimeout) clearTimeout(_activityTimeout);
    _activityTimeout = setTimeout(() => { if (activityEl) { activityEl.remove(); activityEl = null; } }, 5000);
  }

  logToTerminal('Sending request to ' + provider + '...', 'info');

  try {
    const systemMsg = { role: 'system', content: buildSystemPrompt() };
    const MAX_MSG_CHARS = 100000;
    let messages = [systemMsg, ...chatHistory.map(m => ({ role: m.role, content: m.content }))];
    let totalChars = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      totalChars += (messages[i].content || '').length;
      if (totalChars > MAX_MSG_CHARS) {
        messages = [systemMsg, ...messages.slice(i + 1)];
        break;
      }
    }
    const prov = providers[provider];

    let finalContent = '';

    const supportsTools = prov ? (prov.supportsTools ? true : await checkToolSupport(prov, provider)) : false;
    if (supportsTools) {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        const response = await prov.sendWithTools(messages, getActiveTools());
        stopAnim();

        if (response.tool_calls && response.tool_calls.length > 0) {
          messages.push({ role: 'assistant', content: response.content || null, tool_calls: response.tool_calls });
          logToTerminal('AI is using tools: ' + response.tool_calls.map(t => t.function.name).join(', '), 'ai');

          const toolNames = response.tool_calls.map(t => t.function.name).join(', ');
          startAnim('*Running tools', ' (' + toolNames + ')*');

          for (const toolCall of response.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const name = toolCall.function.name;
            stopAnim('*' + name + '(...)*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, result));
            startAnim('*Running tools', ' (' + toolNames + ')*');
          }
          stopAnim();
          toolRounds++;
          startAnim('*Waiting for AI*');
        } else {
          finalContent = response.content || '';
          break;
        }
      }

      if (toolRounds >= maxRounds) {
        contentDiv.textContent = 'Tool call limit reached. Please try a simpler request.';
        logToTerminal('Tool call limit reached (max ' + maxRounds + ' rounds)', 'error');
        return;
      }
    } else {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        finalContent = await prov.sendMessage(messages, (chunk) => {
          stopAnim(chunk);
        });
        stopAnim(finalContent);

        const textCalls = parseTextToolCalls(finalContent);
        if (textCalls.length > 0) {
          logToTerminal('AI is using text tools: ' + textCalls.map(t => t.function.name).join(', '), 'ai');
          messages.push({ role: 'assistant', content: finalContent });
          const toolNames = textCalls.map(t => t.function.name).join(', ');
          startAnim('*Running tools', ' (' + toolNames + ')*');

          // strip tool brackets from display
          let displayContent = finalContent;
          for (const toolCall of textCalls) {
            const args = toolCall.args;
            const name = toolCall.function.name;
            stopAnim('*' + name + '(...)*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, result));
            const bracketStr = '[' + name + ': ' + toolCall.function.arguments + ']';
            displayContent = displayContent.replace(bracketStr, '');
            startAnim('*Running tools', ' (' + toolNames + ')*');
          }
          stopAnim();
          toolRounds++;
          startAnim('*Waiting for AI*');
          finalContent = displayContent;
          contentDiv.innerHTML = formatMessageContent(displayContent);
        } else {
          break;
        }
      }

      if (toolRounds >= maxRounds) {
        contentDiv.textContent = 'Tool call limit reached. Please try a simpler request.';
        logToTerminal('Tool call limit reached (max ' + maxRounds + ' rounds)', 'error');
        return;
      }
    }

    const responseContent = finalContent || (messages.filter(m => m.role === 'assistant' && m.content).pop()?.content) || '';
    if (responseContent) {
      renderResponse(responseContent);
      chatHistory.push({ role: 'assistant', content: responseContent, model: provider });
      trimChatHistory();
      processAIResponse(responseContent);
      const chatContainer = document.getElementById('chat-messages');
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    await saveSession();
    if (currentProject) {
      try { await renderFileTree(); } catch {}
    }
    logToTerminal('AI response received', 'success');
    showNotification('ready', 'Florde Is Ready \u2014 AI response received', '\u2713');
  } catch (err) {
    stopAnim();
    const msg = err.message || 'Unknown error';
    let displayMsg = msg;
    if (err.name === 'AbortError') displayMsg = 'Request timed out after 15 minutes. Check your network and try again.';
    else if (/40[13]/.test(msg)) displayMsg = msg + ' \u2014 Check your API key in settings.';
    else if (/429/.test(msg)) displayMsg = msg + ' \u2014 Rate limited. Wait a moment and retry.';
    else if (/Failed to fetch/.test(msg)) displayMsg = 'Network error \u2014 check your connection and the API endpoint URL in settings.';
    contentDiv.textContent = 'Error: ' + displayMsg;
    logToTerminal('AI request failed: ' + displayMsg, 'error');
  }
}

function processAIResponse(content) {
  const fileBlocks = content.match(/```file:([^\n]+)\n([\s\S]*?)```/g);
  if (!fileBlocks) return;
  const changes = fileBlocks.map(b => {
    const m = b.match(/```file:([^\n]+)\n([\s\S]*?)```/);
    return { file: m[1], code: m[2] };
  });
  if (changes.length > 0) {
    showDiffView(changes);
  }
}

document.getElementById('btn-send-chat').addEventListener('click', () => {
  const content = editor ? editor.getValue() : '';
  if (!content) return;
  const name = getActiveFileName() || 'untitled';
  const msg = 'Here is my current code in ' + name + ':\n```' + detectLanguage(name) + '\n' + content + '\n```\n\n';
  document.getElementById('chat-input').value = msg;
  document.getElementById('chat-input').focus();
});

// ==================== DIFF VIEW ====================

let diffModels = [];

function showDiffView(changes) {
  const modal = document.getElementById('diff-modal');
  modal.classList.remove('hidden');
  const container = document.getElementById('diff-container');
  container.innerHTML = '';

  let currentIndex = 0;

  function disposeDiffModels() {
    diffModels.forEach(m => m.dispose());
    diffModels = [];
    if (diffEditor) { diffEditor.dispose(); diffEditor = null; }
  }

  async function renderDiff(index) {
    disposeDiffModels();
    container.innerHTML = '';
    if (index >= changes.length) { container.innerHTML = '<div style="padding:1rem;color:#666;">All changes applied!</div>'; return; }
    const change = changes[index];
    container.innerHTML = `<div style="padding:0.5rem;font-size:0.85rem;color:var(--text2);border-bottom:1px solid var(--border);">File: ${change.file}</div>`;
    const diffContainer = document.createElement('div');
    diffContainer.style.flex = '1';
    diffContainer.style.minHeight = '250px';
    container.appendChild(diffContainer);

    let originalContent = '';
    const existing = openTabs.indexOf(change.file);
    if (existing >= 0) originalContent = tabContents[change.file] || '';
    else if (currentProject) originalContent = (await window.electronAPI.projectReadFile(currentProject, change.file)) || '';

    const originalModel = monaco.editor.createModel(originalContent, detectLanguage(change.file), monaco.Uri.parse('file:///diff-old-' + change.file));
    const modifiedModel = monaco.editor.createModel(change.code, detectLanguage(change.file), monaco.Uri.parse('file:///diff-new-' + change.file));
    diffModels = [originalModel, modifiedModel];
    if (diffEditor) diffEditor.dispose();
    diffEditor = monaco.editor.createDiffEditor(diffContainer, {
      enableSplitViewResizing: false, renderSideBySide: true, readOnly: true,
      theme: currentTheme === 'light' ? 'vs' : 'vs-dark',
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  }

  const actionBar = document.createElement('div');
  actionBar.style.cssText = 'display:flex;gap:0.5rem;padding:0.5rem 0;';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-secondary'; prevBtn.textContent = '\u25C0 Prev';
  prevBtn.addEventListener('click', () => { if (currentIndex > 0) { currentIndex--; renderDiff(currentIndex); } });
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-secondary'; nextBtn.textContent = 'Next \u25B6';
  nextBtn.addEventListener('click', () => { currentIndex++; renderDiff(currentIndex); });
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary'; applyBtn.textContent = 'Apply This';
  applyBtn.addEventListener('click', async () => {
    const change = changes[currentIndex];
    if (currentProject) await window.electronAPI.projectWriteFile(currentProject, change.file, change.code);
    const existing = openTabs.indexOf(change.file);
    if (existing >= 0) {
      tabContents[change.file] = change.code;
      if (existing === activeTabIndex && editor) editor.setValue(change.code);
    } else {
      tabContents[change.file] = change.code;
      tabLanguages[change.file] = detectLanguage(change.file);
      tabDirty[change.file] = false;
      openTabs.push(change.file);
      switchTab(openTabs.length - 1);
    }
    renderFileTree();
    logToTerminal(`Applied change to: ${change.file}`, 'success');
    currentIndex++;
    renderDiff(currentIndex);
  });
  actionBar.appendChild(prevBtn);
  actionBar.appendChild(applyBtn);
  actionBar.appendChild(nextBtn);
  container.insertBefore(actionBar, container.firstChild);

  renderDiff(0);

  const closeDiff = () => {
    disposeDiffModels();
    modal.classList.add('hidden');
  };

  const acceptAll = async () => {
    for (const change of changes) {
      if (currentProject) await window.electronAPI.projectWriteFile(currentProject, change.file, change.code);
      const existing = openTabs.indexOf(change.file);
      if (existing >= 0) {
        tabContents[change.file] = change.code;
        if (existing === activeTabIndex && editor) editor.setValue(change.code);
      } else {
        tabContents[change.file] = change.code;
        tabLanguages[change.file] = detectLanguage(change.file);
        tabDirty[change.file] = false;
        openTabs.push(change.file);
      }
    }
    if (openTabs.length > 0 && (activeTabIndex < 0 || activeTabIndex >= openTabs.length)) switchTab(0);
    renderFileTree();
    logToTerminal('All changes applied', 'success');
    closeDiff();
  };

  // Replace buttons with clones to remove stale listeners
  const oldAccept = document.getElementById('btn-diff-accept');
  const oldReject = document.getElementById('btn-diff-reject');
  const newAccept = oldAccept.cloneNode(true);
  const newReject = oldReject.cloneNode(true);
  oldAccept.parentNode.replaceChild(newAccept, oldAccept);
  oldReject.parentNode.replaceChild(newReject, oldReject);
  newAccept.addEventListener('click', acceptAll);
  newReject.addEventListener('click', () => {
    logToTerminal('Changes rejected', 'warn');
    closeDiff();
  });
}

// ==================== SEARCH ====================

document.getElementById('btn-search-toggle').addEventListener('click', () => {
  document.getElementById('search-modal').classList.remove('hidden');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">Type a query and press Enter to search</div>';
  setTimeout(() => document.getElementById('search-input').focus(), 100);
});

document.getElementById('btn-close-search').addEventListener('click', () => {
  document.getElementById('search-modal').classList.add('hidden');
});

document.getElementById('btn-cmd-palette')?.addEventListener('click', () => {
  if (typeof CommandPalette !== 'undefined') CommandPalette.show();
});

document.getElementById('btn-search-replace-toggle')?.addEventListener('click', () => {
  if (typeof SearchReplace !== 'undefined') SearchReplace.toggleReplace();
});

document.getElementById('search-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    if (!query || !currentProject) return;
    const container = document.getElementById('search-results');
    container.innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">Searching...</div>';
    const results = await window.electronAPI.searchInFiles(currentProject, query);
    container.innerHTML = '';
    if (results.length === 0) {
      container.innerHTML = '<div style="color:var(--text3);padding:1rem;text-align:center;">No results found</div>';
      return;
    }
    for (const r of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const highlighted = r.text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
      item.innerHTML = `<div><span class="search-result-file">${r.file}</span><span class="search-result-line">:${r.line}</span></div><div class="search-result-text">${highlighted}</div>`;
      item.addEventListener('click', () => {
        document.getElementById('search-modal').classList.add('hidden');
        const existing = openTabs.indexOf(r.file);
        if (existing >= 0) switchTab(existing);
        else {
          window.electronAPI.projectReadFile(currentProject, r.file).then(content => {
            if (content !== null) {
              tabContents[r.file] = content;
              tabLanguages[r.file] = detectLanguage(r.file);
              tabDirty[r.file] = false;
              openTabs.push(r.file);
              switchTab(openTabs.length - 1);
              setTimeout(() => jumpToLine(r.line), 300);
            }
          });
        }
      });
      container.appendChild(item);
    }
  }
});

function jumpToLine(line) {
  if (editor) {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }
}

// ==================== EXPORT ZIP ====================

document.getElementById('btn-export-zip').addEventListener('click', async () => {
  if (!currentProject) return;
  logToTerminal('Exporting project as ZIP...', 'info');
  const ok = await window.electronAPI.exportZip(currentProject);
  if (ok) logToTerminal('Project exported as ZIP', 'success');
  else logToTerminal('Export cancelled or failed', 'warn');
});

// ==================== TERMINAL TOGGLE ====================

document.getElementById('btn-terminal-toggle').addEventListener('click', () => {
  const panel = document.getElementById('terminal-panel');
  panel.classList.toggle('hidden');
  document.getElementById('btn-terminal-toggle').classList.toggle('active');
  if (!panel.classList.contains('hidden') && typeof TerminalManager !== 'undefined') {
    const t = TerminalManager._terminals[TerminalManager._activeTerminalId];
    if (t) setTimeout(() => { try { t.fitAddon.fit(); } catch (e) {} }, 50);
  }
});

document.getElementById('btn-terminal-clear').addEventListener('click', () => {
  document.getElementById('terminal-output').innerHTML = '';
});

// ==================== THEME TOGGLE ====================

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.getElementById('settings-theme').value = currentTheme;
  applyTheme();
  saveSettingsToDisk({ theme: currentTheme });
  logToTerminal(`Switched to ${currentTheme} theme`, 'info');
});

// ==================== DEV UTILS DROPDOWN ====================

const devUtilsBtn = document.getElementById('btn-dev-utils');
const devUtilsMenu = document.getElementById('dev-utils-menu');

devUtilsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  devUtilsMenu.classList.toggle('hidden');
});

document.querySelectorAll('.dev-utils-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = link.dataset.url;
    if (window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
    devUtilsMenu.classList.add('hidden');
  });
});

document.addEventListener('click', () => {
  devUtilsMenu.classList.add('hidden');
});

// ==================== KEYBOARD SHORTCUTS ====================

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
  else if (ctrl && e.key === 'n') { e.preventDefault(); const name = prompt('File name:'); if (name) { tabContents[name] = ''; tabLanguages[name] = detectLanguage(name); tabDirty[name] = true; openTabs.push(name); switchTab(openTabs.length - 1); renderFileTree(); } }
  else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTabIndex >= 0) closeTab(activeTabIndex); }
  else if (ctrl && e.shiftKey && e.key === 'P') { e.preventDefault(); if (typeof CommandPalette !== 'undefined') CommandPalette.show(); }
  else if (ctrl && e.shiftKey && e.key === 'F') { e.preventDefault(); document.getElementById('btn-search-toggle').click(); }
  else if (ctrl && e.key === 'b') { e.preventDefault(); document.getElementById('btn-sidebar-toggle').click(); }
  else if (ctrl && e.key === 'Tab') {
    e.preventDefault();
    if (openTabs.length > 1) {
      const dir = e.shiftKey ? -1 : 1;
      const next = (activeTabIndex + dir + openTabs.length) % openTabs.length;
      switchTab(next);
    }
  }
  else if (ctrl && e.key === '`') { e.preventDefault(); document.getElementById('btn-terminal-toggle').click(); }
  else if (ctrl && e.key === 'p') { e.preventDefault(); if (currentProject) showQuickOpen(); }
  else if (e.key === '?' && !ctrl && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('help-modal').classList.toggle('hidden');
  }
});

document.getElementById('btn-close-help').addEventListener('click', () => {
  document.getElementById('help-modal').classList.add('hidden');
});

// ==================== SETTINGS MODAL ====================

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
  if (document.getElementById('app-view').classList.contains('hidden')) showStartMenu();
});

document.getElementById('btn-save-settings').addEventListener('click', validateAndSaveSettings);

// Settings tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector('.settings-tab-content[data-tab="' + tab.dataset.tab + '"]').classList.add('active');
    if (tab.dataset.tab === 'security') {
      renderPermissionList();
    }
  });
});

document.getElementById('btn-manage-keys')?.addEventListener('click', showKeychainManager);

// Provider collapsible groups
document.querySelectorAll('.provider-header').forEach(h => {
  h.addEventListener('click', (e) => {
    if (e.target.closest('.provider-toggle-checkbox')) return;
    h.classList.toggle('collapsed');
  });
});

// Open provider group when key is focused
document.querySelectorAll('.provider-body input[type="password"]').forEach(input => {
  input.addEventListener('focus', () => {
    const header = document.querySelector('.provider-header[data-provider="' + input.id.replace('key-', '') + '"]');
    if (header) header.classList.remove('collapsed');
  });
});

// Language select
document.getElementById('settings-language').addEventListener('change', () => {
  logToTerminal('Language will take effect on restart', 'info');
});

// Theme select
document.getElementById('settings-theme').addEventListener('change', () => {
  currentTheme = document.getElementById('settings-theme').value;
  applyTheme();
});

// Ollama model selector
document.getElementById('btn-ollama-models')?.addEventListener('click', async () => {
  const list = document.getElementById('ollama-model-list');
  if (!list) return;
  if (!list.classList.contains('hidden')) { list.classList.add('hidden'); return; }
  list.innerHTML = '<div class="ollama-loading">Loading...</div>';
  list.classList.remove('hidden');
  try {
    const url = document.getElementById('url-ollama')?.value || 'http://localhost:11434';
    const r = await fetchWithTimeout(url.replace(/\/+$/, '') + '/api/tags', { method: 'GET' }, 5000);
    const data = await r.json();
    const models = data.models || [];
    if (models.length === 0) {
      list.innerHTML = '<div class="ollama-empty">No models installed</div><button class="ollama-download-btn">Download Model</button>';
    } else {
      list.innerHTML = models.map(m => '<div class="ollama-model-item" data-name="' + m.name + '">' + m.name + '</div>').join('') +
        '<div class="ollama-download-item">Download Model...</div>';
    }
    list.querySelectorAll('.ollama-model-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('model-ollama').value = item.dataset.name;
        list.classList.add('hidden');
      });
    });
    const downloadBtn = list.querySelector('.ollama-download-btn, .ollama-download-item');
    if (downloadBtn) downloadBtn.addEventListener('click', () => showOllamaDownloadModal());
  } catch (err) {
    list.innerHTML = '<div class="ollama-error">Cannot connect: ' + err.message + '</div>';
  }
});

function showOllamaDownloadModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-content" style="max-width:500px;"><h2>Download Ollama Model</h2>' +
    '<div class="settings-form">' +
    '<label>Model Name</label>' +
    '<input type="text" id="ollama-dl-name" placeholder="llama3.2" />' +
    '<p style="font-size:0.8rem;color:var(--text3);">Or choose a popular model:</p>' +
    '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:1rem;">' +
    ['llama3.2', 'llama3.1', 'qwen2.5-coder', 'mistral', 'codestral', 'deepseek-coder-v2', 'phi3', 'gemma2'].map(m =>
      '<button class="btn btn-sm btn-secondary ollama-quick" style="font-size:0.75rem;">' + m + '</button>'
    ).join('') +
    '</div>' +
    '<div id="ollama-dl-progress" class="ollama-dl-progress hidden"><div class="ollama-dl-bar"></div><span class="ollama-dl-text"></span></div>' +
    '</div>' +
    '<div class="modal-actions"><button id="ollama-dl-start" class="btn btn-primary">Download</button><button class="btn btn-secondary ollama-dl-close">Cancel</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.ollama-quick').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById('ollama-dl-name').value = btn.textContent);
  });
  overlay.querySelector('.ollama-dl-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ollama-dl-start').addEventListener('click', async () => {
    const name = document.getElementById('ollama-dl-name').value.trim();
    if (!name) return;
    const btn = overlay.querySelector('#ollama-dl-start');
    btn.disabled = true; btn.textContent = 'Downloading...';
    const progress = document.getElementById('ollama-dl-progress');
    progress.classList.remove('hidden');
    try {
      const url = (document.getElementById('url-ollama')?.value || 'http://localhost:11434').replace(/\/+$/, '');
      const r = await fetchWithTimeout(url + '/api/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true })
      }, 600000);
      const reader = r.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line) continue;
          try {
            const p = JSON.parse(line);
            const bar = progress.querySelector('.ollama-dl-bar');
            const txt = progress.querySelector('.ollama-dl-text');
            if (p.total) {
              const pct = Math.min(100, Math.round((p.completed || 0) / p.total * 100));
              bar.style.width = pct + '%';
              txt.textContent = p.status + ' (' + pct + '%)';
            } else {
              txt.textContent = p.status || '';
            }
          } catch {}
        }
      }
      document.getElementById('model-ollama').value = name;
      progress.querySelector('.ollama-dl-bar').style.width = '100%';
      progress.querySelector('.ollama-dl-text').textContent = 'Done!';
      setTimeout(() => overlay.remove(), 1500);
    } catch (err) {
      progress.querySelector('.ollama-dl-text').textContent = 'Error: ' + err.message;
      btn.disabled = false; btn.textContent = 'Retry';
    }
  });
}

document.getElementById('chat-font-size')?.addEventListener('input', (e) => {
  const size = e.target.value + 'px';
  document.documentElement.style.setProperty('--chat-font-size', size);
  document.getElementById('chat-font-size-label').textContent = size;
  saveSettingsToDisk({ chatFontSize: e.target.value });
});

document.getElementById('editor-font-size')?.addEventListener('input', (e) => {
  const size = e.target.value + 'px';
  document.documentElement.style.setProperty('--editor-font-size', size);
  document.getElementById('editor-font-size-label').textContent = size;
  if (editor) editor.updateOptions({ fontSize: parseInt(e.target.value) });
  saveSettingsToDisk({ editorFontSize: e.target.value });
});

// ==================== OPEN FILE FROM TREE ====================

async function openTab(filename, switchTo = true) {
  if (openTabs.indexOf(filename) >= 0) {
    if (switchTo) switchTab(openTabs.indexOf(filename));
    return;
  }
  if (!currentProject) { openTabs.push(filename); tabContents[filename] = ''; tabLanguages[filename] = detectLanguage(filename); tabDirty[filename] = true; if (switchTo) switchTab(openTabs.length - 1); return; }
  try {
    const content = await window.electronAPI.projectReadFile(currentProject, filename);
    if (content === null) { tabContents[filename] = ''; tabDirty[filename] = true; } else { tabContents[filename] = content; tabDirty[filename] = false; }
  } catch (err) {
    logToTerminal(`Failed to open ${filename}: ${err.message}`, 'error');
    tabContents[filename] = ''; tabDirty[filename] = true;
  }
  tabLanguages[filename] = detectLanguage(filename);
  openTabs.push(filename);
  if (switchTo) switchTab(openTabs.length - 1);
}

// ==================== DRAG & DROP ====================

function initDragDrop() {
  const area = document.getElementById('app-view') || document.body;

  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('drag-over');
  });

  area.addEventListener('dragleave', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
  });

  area.addEventListener('drop', async (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');

    if (!currentProject) {
      showNotification('info', 'Open a project first to import files', '\u2139');
      return;
    }

    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      try {
        const reader = new FileReader();
        const content = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          if (file.type.startsWith('text/') || file.name.match(/\.(js|ts|py|json|md|html|css|txt|xml|yaml|yml|toml|csv|sh|bat|ps1|env|gitignore)$/i)) {
            reader.readAsText(file);
          } else {
            showNotification('info', 'Cannot import binary file: ' + file.name, '\u2139');
            return;
          }
        });

        await window.electronAPI.projectWriteFile(currentProject, file.name, content);
        showNotification('success', 'Imported ' + file.name, '\u2713');
        if (typeof renderFileTree === 'function') renderFileTree();
      } catch (err) {
        showNotification('error', 'Failed to import ' + file.name, '\u2715');
      }
    }
  });
}

// ==================== QUICK FILE OPENER ====================

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showQuickOpen() {
  if (document.getElementById('quick-open-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'quick-open-overlay';
  overlay.innerHTML = '<div class="quick-open">' +
    '<input id="quick-open-input" type="text" placeholder="Search files by name..." autofocus>' +
    '<div id="quick-open-results"></div>' +
  '</div>';
  document.body.appendChild(overlay);

  const input = document.getElementById('quick-open-input');
  const results = document.getElementById('quick-open-results');

  let files = [];
  let fuse = null;

  window.electronAPI.projectListFiles(currentProject).then(fileList => {
    files = fileList.map(f => ({ name: f.split('/').pop(), path: f }));
    fuse = new Fuse(files, { keys: ['name', 'path'], threshold: 0.4 });
    renderQuickResults(files.slice(0, 20));
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length === 0) { renderQuickResults(files.slice(0, 20)); return; }
    if (fuse) renderQuickResults(fuse.search(q).map(r => r.item).slice(0, 30));
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('.qo-item');
      if (first) first.click();
    }
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  input.focus();
}

function renderQuickResults(items) {
  const results = document.getElementById('quick-open-results');
  results.innerHTML = items.map(f => '<div class="qo-item" data-path="' + f.path + '">' +
    '<span class="qo-name">' + escapeHtml(f.name) + '</span>' +
    '<span class="qo-path">' + escapeHtml(f.path) + '</span>' +
  '</div>').join('');

  results.querySelectorAll('.qo-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      openTab(path);
      document.getElementById('quick-open-overlay')?.remove();
    });
  });
}

// ==================== MODAL BACKDROP ====================

document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m && !m.id.includes('diff') && !m.id.includes('question')) {
      m.classList.add('hidden');
      const av = document.getElementById('app-view');
      if (av.classList.contains('hidden')) showStartMenu();
    }
  });
});

// Close modal-container on backdrop click
document.addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-container')) {
    document.getElementById('modal-container').classList.add('hidden');
  }
});

// ==================== INIT ====================

loadSettings();
WorkspaceManager.init();
Favorites.init();
PermissionManager.init();
ChatManager.init();
pluginRegistry.init().then(() => {
  window.__updateTools();
});
initDragDrop();

// ==================== TOOLS INIT ====================
function initEditorTools() {
  const toolModules = [
    { name: 'tools/command-palette.js', cb: () => { if (typeof CommandPalette !== 'undefined') CommandPalette.init(); } },
    { name: 'tools/snippets.js', cb: () => { if (typeof SnippetManager !== 'undefined') SnippetManager.init(); } },
    { name: 'tools/search-replace.js', cb: () => { if (typeof SearchReplace !== 'undefined') SearchReplace.init(); } },
    { name: 'tools/problem-panel.js', cb: () => { if (typeof ProblemPanel !== 'undefined') ProblemPanel.init(); } },
  ];

  function loadNext(idx) {
    if (idx >= toolModules.length) return;
    const mod = toolModules[idx];
    const s = document.createElement('script');
    s.src = mod.name;
    document.head.appendChild(s);
    s.onload = () => { mod.cb(); loadNext(idx + 1); };
    s.onerror = () => { console.error('Failed to load:', mod.name); loadNext(idx + 1); };
  }
  loadNext(0);
}

// ==================== GIT INIT ====================
function initGitPanel() {
  const script = document.createElement('script');
  script.src = 'git/git-core.js';
  document.head.appendChild(script);
  script.onload = () => {
    const s2 = document.createElement('script');
    s2.src = 'git/git-panel.js';
    document.head.appendChild(s2);
    s2.onload = () => {
      const s3 = document.createElement('script');
      s3.src = 'git/git-branches.js';
      document.head.appendChild(s3);
      s3.onload = () => {
        const s4 = document.createElement('script');
        s4.src = 'git/git-history.js';
        document.head.appendChild(s4);
        s4.onload = () => {
          const s5 = document.createElement('script');
          s5.src = 'git/git-github.js';
          document.head.appendChild(s5);
          s5.onload = async () => {
            GitPanel.init();
            // Refresh git status when project loads
            const checkGit = setInterval(() => {
              if (currentProject) {
                GitPanel.refresh();
                clearInterval(checkGit);
              }
            }, 500);
          };
        };
      };
    };
  };
}
// ==================== XTERM TERMINAL (INLINED) ====================

const XtermLoader = {
  _loaded: null,
  async load() {
    if (this._loaded) return this._loaded;
    this._loaded = (async () => {
      const base = '../node_modules/@xterm';
      const [xtermCode, fitCode] = await Promise.all([
        fetch(`${base}/xterm/lib/xterm.js`).then(r => r.text()),
        fetch(`${base}/addon-fit/lib/addon-fit.js`).then(r => r.text())
      ]);
      const saved = { exports: window.exports, module: window.module, define: window.define };
      window.exports = undefined; window.module = undefined; window.define = undefined;
      try {
        (0, eval)(xtermCode);
        (0, eval)(fitCode);
      } finally {
        window.exports = saved.exports; window.module = saved.module; window.define = saved.define;
      }
      // FitAddon may be a module object, unwrap
      let FA = window.FitAddon;
      if (FA && typeof FA.FitAddon === 'function') FA = FA.FitAddon;
      else if (FA && typeof FA.default === 'function') FA = FA.default;
      window.FitAddon = FA;
      if (typeof window.Terminal !== 'function') throw new Error('Failed to load Terminal');
      if (typeof window.FitAddon !== 'function') throw new Error('Failed to load FitAddon');
      return { Terminal: window.Terminal, FitAddon: window.FitAddon };
    })();
    return this._loaded;
  }
};

const TerminalManager = {
  _terminals: {}, _activeTerminalId: null, _unsubscribers: [],

  async create(projectPath) {
    if (!window.electronAPI || !window.electronAPI.terminal) {
      if (typeof showNotification !== 'undefined') showNotification('error', 'Terminal not available', '✕');
      return;
    }
    const { Terminal, FitAddon } = await XtermLoader.load();
    const id = await window.electronAPI.terminal.create({ projectPath: projectPath || currentProject });
    const term = new Terminal({
      cursorBlink: true, cursorStyle: 'block', fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      scrollback: 5000,
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const container = document.createElement('div');
    container.className = 'terminal-instance';
    container.id = `term-instance-${id}`;
    document.getElementById('terminal-container').appendChild(container);
    term.open(container);
    const unsubData = window.electronAPI.terminal.onData(({ id: termId, data }) => { if (termId === id) term.write(data); });
    const unsubExit = window.electronAPI.terminal.onExit(({ id: termId }) => { if (termId === id) term.write('\r\n\x1b[31m[Process exited]\x1b[0m'); });
    term.onData(data => { window.electronAPI.terminal.write({ id, data }); });
    this._unsubscribers.push(unsubData, unsubExit);
    this._terminals[id] = { term, fitAddon, id };
    new ResizeObserver(() => { try { fitAddon.fit(); } catch (e) {} }).observe(container);
    setTimeout(() => { try { fitAddon.fit(); } catch (e) {} }, 100);
    this._activeTerminalId = id;
    return id;
  },

  toggle() {
    const panel = document.getElementById('terminal-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden') && this._activeTerminalId) {
      const t = this._terminals[this._activeTerminalId];
      if (t) setTimeout(() => { try { t.fitAddon.fit(); } catch (e) {} }, 50);
    }
  },

  async init() {
    await this.create(currentProject);
  }
};

function initXtermTerminal() {
  TerminalManager.init().then(() => {
    const termTabs = document.querySelectorAll('#terminal-tab-bar .terminal-tab[data-id]');
    termTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const id = parseInt(tab.dataset.id);
        if (TerminalManager._terminals[id]) {
          TerminalManager._activeTerminalId = id;
          document.querySelectorAll('#terminal-tab-bar .terminal-tab[data-id]').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          document.querySelectorAll('.terminal-instance').forEach(el => el.style.display = 'none');
          const inst = document.getElementById('term-instance-' + id);
          if (inst) { inst.style.display = 'block'; setTimeout(() => { try { TerminalManager._terminals[id].fitAddon.fit(); } catch(e) {} }, 50); }
        }
      });
    });
    document.getElementById('btn-new-terminal')?.addEventListener('click', async () => {
      const id = await TerminalManager.create(currentProject);
      if (id) {
        document.querySelectorAll('#terminal-tab-bar .terminal-tab[data-id]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.terminal-instance').forEach(el => el.style.display = 'none');
        const newTab = document.querySelector(`#terminal-tab-bar .terminal-tab[data-id="${id}"]`);
        if (newTab) newTab.classList.add('active');
        const newInst = document.getElementById('term-instance-' + id);
        if (newInst) newInst.style.display = 'block';
      }
    });
    document.getElementById('terminal-output-tab')?.addEventListener('click', () => {
      document.querySelectorAll('#terminal-tab-bar .terminal-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('terminal-output-tab').classList.add('active');
      document.querySelectorAll('.terminal-instance').forEach(el => el.style.display = 'none');
      document.getElementById('terminal-container').style.display = 'none';
      document.getElementById('terminal-output').classList.remove('hidden');
    });
    termTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        document.getElementById('terminal-output').classList.add('hidden');
        document.getElementById('terminal-container').style.display = '';
      });
    });
  });
}

initEditorTools();
initGitPanel();
initXtermTerminal();

showStartMenu();

require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monacoReady = true;
  const activeName = getActiveFileName();
  const initialContent = activeName ? (tabContents[activeName] || '') : '# Welcome to Florde!\n# Start coding or describe what you want to build in the chat.';
  const initialLang = activeName ? detectLanguage(activeName) : 'python';

  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: initialContent,
    language: initialLang,
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    bracketPairColorization: { enabled: true },
  });

  if (activeName) {
    const uri = monaco.Uri.parse('file:///' + activeName);
    const model = monaco.editor.getModels().find(m => m.uri.path === '/' + activeName);
    if (model) editor.setModel(model);
  }

  editor.getModel().onDidChangeContent(() => {
    const name = getActiveFileName();
    if (name) { tabDirty[name] = true; renderTabs(); }
  });
  editor.onDidChangeCursorPosition(() => updateStatusBar());
  updateStatusBar();
});
