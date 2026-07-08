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

// Timeout state
let _timeoutTimer = null;
let _timeoutEl = null;
let _requestAborter = null;
let _isRequestActive = false;
let _stoppedByUser = false;
let _chatSummary = '';
const SUMMARY_THRESHOLD = 60000; // chars — if history exceeds this, summarize

// Backoff state
let _backoffTimer = null;
let _backoffStep = null;

function clearRequestTimeout() {
  if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
  if (_timeoutEl) { _timeoutEl.remove(); _timeoutEl = null; }
}

function startRequestTimeout(minutes, onTimeout) {
  clearRequestTimeout();
  if (!minutes || minutes <= 0) minutes = 30;
  const totalMs = minutes * 60 * 1000;
  _timeoutTimer = setTimeout(onTimeout, totalMs);
  // show countdown when < 5 min remaining
  const chat = document.getElementById('chat-messages');
  if (!chat) return;
  _timeoutEl = document.createElement('div');
  _timeoutEl.className = 'chat-activity timeout-countdown';
  _timeoutEl.textContent = 'Timeout: ' + minutes + 'm';
  chat.appendChild(_timeoutEl);
  const start = Date.now();
  const iv = setInterval(() => {
    const remaining = totalMs - (Date.now() - start);
    if (remaining <= 0) { clearInterval(iv); return; }
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const secStr = (secs % 60).toString().padStart(2, '0');
    if (secs < 300 && _timeoutEl) {
      _timeoutEl.textContent = 'Timeout: ' + mins + ':' + secStr;
    } else if (secs >= 300 && _timeoutEl) {
      _timeoutEl.textContent = 'Timeout: ' + minutes + 'm';
      clearInterval(iv);
    }
  }, 1000);
}

function resetRequestTimeout(minutes, onTimeout) {
  clearRequestTimeout();
  startRequestTimeout(minutes, onTimeout);
}

function cancelRequestWithTimeout(msg) {
  clearRequestTimeout();
  if (_requestAborter) { _requestAborter.abort(); _requestAborter = null; }
  if (_backoffTimer) { clearTimeout(_backoffTimer); _backoffTimer = null; }
  if (_backoffStep) _backoffStep = null;
  const chat = document.getElementById('chat-messages');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'chat-msg system timeout-msg';
  div.textContent = msg || 'Request cancelled due to timeout.';
  chat.appendChild(div);
}

// Shell risk assessment
function assessShellRisk(command) {
  const patterns = {
    critical: [
      /\brm\s+-rf\s+\/\s*$/mi, /\bformat\b/i, /\bdd\s+if=\/dev\/zero/i,
      /\bmkfs\b/i, /grub-install|fdisk|mbr/i, /:\(\)\s*\{|fork\s+bomb/i,
      /chmod\s+777\s+\//i, /mv\s+\/\s+\/dev\/null/i,
    ],
    high: [
      /\bsudo\b/i, /\brm\s+-rf\b/i, /\bcurl\b.*\|\s*(?:bash|sh)\b/i,
      /\bwget\b.*\|\s*(?:bash|sh)\b/i, /\bchmod\s+-R\s+777\b/i,
      /\bnmap\b/i, /\bapt\s+(?:install|remove|purge)\b/i,
      /\bpip\s+install\b/i, /\bnpm\s+(?:install|publish|delete)\s+-g\b/i,
    ],
    medium: [
      /\bnpm\s+(?:install|publish)\b/i, /\bgit\s+push\b/i,
      /\bpip\s+install\b/i, /\bchmod\b/i, /\bkill\b/i,
      /\bsystemctl\b/i, /\bservice\b/i,
    ],
    low: [
      /\bmkdir\b/i, /\btouch\b/i, /\becho\s+>/, /\bmv\b/i, /\bcp\b/i,
      /\bcd\b/i, /\bnano\b/i, /\bvi\b/i, /\bcode\b/i,
    ],
    safe: [
      /\bls\b/i, /\bpwd\b/i, /\bcat\b/i, /\bhead\b/i, /\btail\b/i,
      /\bgrep\b/i, /\bfind\b/i, /\bwhich\b/i, /\bwhoami\b/i, /\bdate\b/i,
      /\bwc\b/i, /\bsort\b/i, /\buniq\b/i, /\bless\b/i, /\bmore\b/i,
      /\bps\b/i, /\bdf\b/i, /\bdu\b/i,
    ],
  };
  for (const [level, regexps] of Object.entries(patterns)) {
    for (const re of regexps) {
      if (re.test(command)) return level;
    }
  }
  return 'safe';
}

// 429 backoff
function getBackoffDelay(step) {
  return Math.min(1000 * Math.pow(2, step), 60000);
}

// API key validation
async function validateApiKey(providerId, key, url, model) {
  const prov = providers[providerId];
  if (!prov) return { status: 'invalid', message: 'Provider not configured' };
  try {
    const testMsg = [{ role: 'user', content: 'Say yes' }];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const r = await fetchWithTimeout(
      (url || prov.baseUrl || '').replace(/\/+$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: model || prov.model || 'default', messages: testMsg, max_tokens: 5 }),
      },
      180000
    );
    clearTimeout(timer);
    if (r.status === 429 || r.status === 402) return { status: 'limited', message: 'Valid but rate limited (' + r.status + ')' };
    if (r.status === 401 || r.status === 403) return { status: 'invalid', message: 'Invalid API key (' + r.status + ')' };
    if (!r.ok) return { status: 'invalid', message: 'HTTP ' + r.status };
    const data = await r.json();
    if (data.choices && data.choices.length > 0) return { status: 'valid', message: 'Valid' };
    return { status: 'invalid', message: 'Unexpected response' };
  } catch (err) {
    if (err.name === 'AbortError') return { status: 'limited', message: 'Request timed out (valid but slow)' };
    return { status: 'invalid', message: err.message };
  }
}

function getActiveTools() {
  const baseTools = [
    { type: 'function', function: { name: 'read_file', description: 'Read a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, content: { type: 'string', description: 'Full file content' }, description: { type: 'string', description: 'Brief 2-5 word summary of what this file is (e.g. \"Creates React component\")' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, description: { type: 'string', description: 'Brief 2-5 word summary of why' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List all files in the project', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_files', description: 'Search for text across all project files', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'exec_command', description: 'Execute a shell command in the project sandbox directory', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' }, description: { type: 'string', description: 'Brief 2-5 word summary of what this command does' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'ask_question', description: 'Ask the user a question when you need clarification, confirmation, or a decision. Always provide clear choices. One choice must always be a custom free-text option.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, choices: { type: 'array', items: { type: 'string' }, description: 'List of answer choices. Always include a free-text option like "Custom answer..."' } }, required: ['question', 'choices'] } } },
    { type: 'function', function: { name: 'rename_file', description: 'Rename a file and optionally update all imports/references across the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Current file path relative to project root' }, new_path: { type: 'string', description: 'New file path relative to project root' }, update_imports: { type: 'boolean', description: 'Whether to auto-update imports referencing the old path in all project files' } }, required: ['path', 'new_path'] } } },
    { type: 'function', function: { name: 'take_screenshot', description: 'Capture a screenshot of your screen or a specific window. Useful for visual debugging of web apps. The screenshot becomes visible to vision-capable AI models.', parameters: { type: 'object', properties: { description: { type: 'string', description: 'What to capture (optional hint for the user)' } }, required: [] } } },
    { type: 'function', function: { name: 'schedule_task', description: 'Schedule a background task plan that the AI will continue in the next conversation turn. Use when a task is too large to complete in one round and requires multiple conversation turns.', parameters: { type: 'object', properties: { plan: { type: 'string', description: 'Overall plan for the task' }, steps: { type: 'array', items: { type: 'string' }, description: 'Step-by-step breakdown of remaining work' }, context: { type: 'string', description: 'Key context the AI needs to remember when resuming' } }, required: ['plan', 'steps'] } } },
    { type: 'function', function: { name: 'browser_open', description: 'Open a URL in the embedded browser panel. The browser panel will appear automatically.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'The URL to open' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'browser_click', description: 'Click an element on the current browser page by CSS selector.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector for the element' } }, required: ['selector'] } } },
    { type: 'function', function: { name: 'browser_type', description: 'Type text into an input field on the current browser page.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector for the input element' }, text: { type: 'string', description: 'Text to type' } }, required: ['selector', 'text'] } } },
    { type: 'function', function: { name: 'browser_screenshot', description: 'Take a screenshot of the current browser page and attach it to the chat as an image.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_back', description: 'Go back to the previous page in browser history.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_forward', description: 'Go forward to the next page in browser history.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_reload', description: 'Reload the current browser page.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_evaluate', description: 'Execute custom JavaScript code in the browser page context and return the result.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript code to execute' } }, required: ['code'] } } },
  ];
  const appTools = _getAppToolDefs();
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
  return [...baseTools, ...appTools, ...pluginTools];
}

window.__updateTools = function() {
  if (typeof pluginRegistry !== 'undefined' && pluginRegistry._loaded) {
    if (document.getElementById('marketplace-list')) renderPluginMarketplace();
  }
  // Force tool refresh on next AI request by clearing any cached tool state
  if (typeof prov !== 'undefined' && prov) {
    prov.supportsTools = undefined;
    detectToolSupport(prov).then(s => { prov.supportsTools = s; });
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
    const customContainer = document.getElementById('custom-answer-container');
    const customInput = document.getElementById('custom-answer-input');
    const submitBtn = document.getElementById('btn-submit-custom');
    customContainer.style.display = 'none';
    customInput.value = '';
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
          choicesDiv.querySelectorAll('.question-choice').forEach(b => b.style.display = 'none');
          customContainer.style.display = 'block';
          customInput.focus();
        } else {
          modal.classList.add('hidden');
          resolve(c);
        }
      });
      choicesDiv.appendChild(btn);
    });
    submitBtn.onclick = () => {
      const val = customInput.value.trim();
      if (val) {
        modal.classList.add('hidden');
        resolve(val);
      }
    };
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
  if (_requestAborter) {
    _requestAborter.signal.addEventListener('abort', () => { controller.abort(); }, { once: true });
  }
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
  constructor(apiKey, model = 'big-pickle') { super(apiKey, model); this.apiKey = apiKey; this.model = model; this.baseUrl = 'https://opencode.ai/zen/v1/chat/completions'; }
  async _post(url, body, timeoutMs = 120000) {
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) { const detail = await r.json().catch(() => ({})); throw new Error(`OpenCode API error: ${r.status} ${detail.error?.message || r.statusText}`); }
    return r;
  }
  async sendWithTools(messages, tools) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message || { content: '', role: 'assistant' }; }
    catch { throw new Error('OpenCode API: invalid JSON response'); }
  }
  async sendPlain(messages) {
    const r = await this._post(this.baseUrl, this._withTemp({ model: this.model, messages, stream: false }));
    const text = await r.text();
    try { const data = JSON.parse(text); return data.choices?.[0]?.message?.content || ''; }
    catch { throw new Error('OpenCode API: invalid JSON response'); }
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
    if (this._pendingImages) {
      chatBody.images = this._pendingImages;
      delete this._pendingImages;
    }
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
// Clear stale cache so tool support is properly detected
for (const key of Object.keys(capabilityCache)) {
  if (key.startsWith('ollama:') || key.startsWith('opencode:')) {
    delete capabilityCache[key];
  }
}
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
    const allTools = ['read_file', 'write_file', 'delete_file', 'list_files', 'search_files', 'exec_command', 'ask_question', 'rename_file', 'take_screenshot', 'schedule_task', 'browser_open', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_back', 'browser_forward', 'browser_reload', 'browser_evaluate', ...APP_TOOL_NAMES];
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

  _getAutoExceptions() {
    const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    return s.autoExceptions || {};
  },

  _isToolExcepted(toolName, args) {
    const ex = this._getAutoExceptions();
    if (ex.shell && toolName === 'exec_command') return true;
    if (ex.outside && args && (args.path || '').startsWith('..')) return true;
    if (ex.git && toolName === 'exec_command' && /git\b/i.test(args?.command || '')) return true;
    if (ex.terminal && toolName === 'exec_command') return true;
    return false;
  },

  async checkTool(toolName, args) {
    // ask_question is always allowed — it's a user interaction, not a file operation
    if (toolName === 'ask_question') return true;
    const autoAccept = JSON.parse(localStorage.getItem('florde-settings') || '{}').autoAccept === true;
    if (autoAccept && !this._isToolExcepted(toolName, args)) {
      // auto-accept write/read/edit/create operations, for shell check risk
      if (toolName === 'exec_command' && args?.command) {
        const risk = assessShellRisk(args.command);
        if (risk === 'critical') {
          return new Promise((resolve) => showCriticalWarning(args.command, resolve));
        }
        if (risk === 'high') {
          return new Promise((resolve) => showPermissionPrompt(toolName, args, resolve));
        }
      }
      return true;
    }
    const level = this.getPermission(toolName);
    if (level === 'allow') return true;
    if (level === 'block') {
      showNotification('warning', 'Blocked: AI tried to use "' + toolName + '"', '\u26A0');
      return false;
    }
    if (level === 'ask') {
      // if sandbox access denied, show permission box in chat
      if (args && args.path && typeof args.path === 'string' && args.path.includes('..')) {
        return new Promise((resolve) => {
          showSandboxDeniedUI(toolName, args, resolve);
        });
      }
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
  const act = formatToolActivity(toolName, args);
  showNotification('warning', 'Action Required: ' + act, '\u{1F512}');
  const desc = args.description ? '<div class="perm-desc"><strong>Summary:</strong> ' + escapeHtml(args.description) + '</div>' : '';
  overlay.innerHTML = '<div class="permission-prompt">' +
    '<h3>\u{1F512} AI Action Required</h3>' +
    '<p>The AI wants to <strong>' + act + '</strong></p>' +
    desc +
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

function showSandboxDeniedUI(toolName, args, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  const path = args.path || args.command || args.query || 'unknown';
  overlay.innerHTML = '<div class="permission-prompt" style="border-color:#ef4444;">' +
    '<h3>\u{1F512} Sandbox Access Denied</h3>' +
    '<p>The agent wants to access <strong>' + escapeHtml(path) + '</strong></p>' +
    '<pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
    '<div class="permission-actions">' +
      '<button class="btn-allow-once" style="background:#ef4444;">Allow Once</button>' +
      '<button class="btn-allow-always" style="background:#ef4444;">Always Allow</button>' +
      '<button class="btn-block-once">Deny Once</button>' +
      '<button class="btn-block-always">Always Block</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.btn-allow-once').onclick = () => { overlay.remove(); callback(true); };
  overlay.querySelector('.btn-allow-always').onclick = () => { PermissionManager.setPermission(toolName, 'allow'); overlay.remove(); callback(true); };
  overlay.querySelector('.btn-block-once').onclick = () => { overlay.remove(); callback(false); };
  overlay.querySelector('.btn-block-always').onclick = () => { PermissionManager.setPermission(toolName, 'block'); overlay.remove(); callback(false); };
}

function showCriticalWarning(command, callback) {
  const existing = document.querySelector('.permission-prompt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'permission-prompt-overlay';
  overlay.innerHTML = '<div class="critical-warning" style="max-width:500px;margin:auto;">' +
    '<h4>\u26A0\uFE0F Critical Command Detected</h4>' +
    '<p><strong>Command:</strong> <code>' + escapeHtml(command) + '</code></p>' +
    '<p>This command can damage your system. Hold the button for 10 seconds to confirm.</p>' +
    '<div class="critical-actions">' +
      '<button class="hold-btn" id="critical-hold-btn"><span class="hold-progress" style="width:0%"></span>Hold 10s to Confirm</button>' +
      '<button class="btn btn-secondary" id="critical-cancel-btn">Cancel</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  const holdBtn = document.getElementById('critical-hold-btn');
  const cancelBtn = document.getElementById('critical-cancel-btn');
  let holdTimer = null;
  let holdSeconds = 0;

  holdBtn.addEventListener('mousedown', () => {
    if (holdTimer) return;
    holdSeconds = 0;
    holdBtn.querySelector('.hold-progress').style.width = '0%';
    holdTimer = setInterval(() => {
      holdSeconds++;
      const pct = (holdSeconds / 10) * 100;
      holdBtn.querySelector('.hold-progress').style.width = pct + '%';
      holdBtn.textContent = 'Hold ' + (10 - holdSeconds) + 's';
      if (holdSeconds >= 10) {
        clearInterval(holdTimer); holdTimer = null;
        holdBtn.textContent = 'Confirm Execution';
        holdBtn.style.background = '#dc2626';
        holdBtn.onclick = () => { overlay.remove(); callback(true); };
      }
    }, 1000);
  });
  holdBtn.addEventListener('mouseup', () => {
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    holdBtn.querySelector('.hold-progress').style.width = '0%';
    holdBtn.textContent = 'Hold 10s to Confirm';
    holdBtn.onclick = null;
    holdBtn.style.background = '';
  });
  holdBtn.addEventListener('mouseleave', () => {
    if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    holdBtn.querySelector('.hold-progress').style.width = '0%';
    holdBtn.textContent = 'Hold 10s to Confirm';
    holdBtn.onclick = null;
    holdBtn.style.background = '';
  });
  cancelBtn.addEventListener('click', () => { overlay.remove(); callback(false); });
}

function showExpandableShellView(command, result) {
  const el = document.createElement('div');
  el.className = 'shell-detail';
  const lines = (result || '').split('\n').length;
  el.innerHTML = '<div class="shell-detail-header">' +
    '<span>\u25B6</span> <code>' + escapeHtml(command.slice(0, 80)) + '</code>' +
    '<span style="margin-left:auto;color:var(--text3);font-size:0.7rem;">' + lines + ' lines</span>' +
    '</div>' +
    '<div class="shell-detail-body" style="display:none;">' +
    '<pre>' + escapeHtml(result || '') + '</pre>' +
    '<div class="shell-detail-actions">' +
    '<button class="shell-action-copy">Copy</button>' +
    '<button class="shell-action-ask">Ask Florde What This Does</button>' +
    '</div></div>';
  const header = el.querySelector('.shell-detail-header');
  const body = el.querySelector('.shell-detail-body');
  header.addEventListener('click', () => {
    const expanded = body.style.display !== 'none';
    body.style.display = expanded ? 'none' : 'block';
    header.querySelector('span:first-child').textContent = expanded ? '\u25B6' : '\u25BC';
  });
  el.querySelector('.shell-action-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(result || '');
  });
  el.querySelector('.shell-action-ask').addEventListener('click', async (e) => {
    e.stopPropagation();
    document.getElementById('chat-input').value = 'What does this command do and what were the results?\n```\n' + command + '\n```\n\nResults:\n```\n' + (result || '') + '\n```';
  });
  return el;
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

function buildSystemPrompt(hasTools) {
  const provider = document.getElementById('provider-select').value;
  const prov = providers[provider];
  const pluginTools = typeof pluginRegistry !== 'undefined' ? pluginRegistry.getActiveTools() : [];
  const pluginToolDescriptions = pluginTools
    .filter(t => t.function && t.function.name)
    .map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters?.properties || {}).join(', ') + '): ' + (t.function.description || ''))
    .join('\n');
  const pluginSection = pluginToolDescriptions ? '\n\nPlugin tools:\n' + pluginToolDescriptions : '';
  const promptExt = getPluginPromptExtensions();
  const promptExtSection = promptExt ? '\n\n' + promptExt : '';
  const customInstr = localStorage.getItem('florde-custom-instructions') || '';
  const customSection = customInstr ? '\n\nUser Custom Instructions:\n' + customInstr : '';

  const toolList = `- read_file(path): Read file content
- write_file(path, content): Create or overwrite files
- delete_file(path): Delete files
- list_files(): List all project files
- search_files(query): Find text in files
- exec_command(command): Run shell commands in the project directory
- ask_question(question, choices): Ask the user a question when you need input or a decision
- Plus connected service tools (e.g. make_list_scenarios, github_create_issue) — use them to interact with external services`;

  const appsSection = buildConnectedAppsPrompt();

  const basePrompt = `You are Florde AI, an AI coding assistant with direct access to the user's project files.

Project: ${currentProject}
Type: ${currentProjectType}
Privacy: ${provider === 'ollama' || provider === 'lmstudio' || provider === 'localai' ? '100% Local - no data leaves this PC' : 'Cloud provider - data is encrypted in transit'}
${currentProjectType === 'local' ? 'Notes: This is a local project. Shell commands run in the project root directory. You can use system commands (pip install, npm install, cargo build, etc.) to set up and run the project.' : 'Notes: This is a sandbox project. Files are stored in app data. Shell commands run in the isolated sandbox directory.'}

Zero-Cloud-Storage: All user data, code, and chat history stays in the local database/JSON files.
Encrypted API Communication: Cloud model connections go directly from client to provider - no proxy server.
Local RAG: Project context is built locally. Embeddings are generated via local models.
${promptExtSection}${customSection}${appsSection}`;

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
9. Put your internal reasoning in [think]...[/think] blocks. The user sees these as gray italic text. Keep them brief and focused on your plan/investigation.
10. Use web_fetch/web_search sparingly (max 1-2 calls). Fetch all needed URLs at once, then synthesize your response immediately. Do NOT fetch more URLs after you have the information.
11. When using write_file, delete_file, rename_file, or exec_command, always provide a brief "description" parameter summarizing the action in 2-5 words.`;
  }

  return basePrompt + `


CRITICAL — You MUST use tools to write code. Never just show code in chat.

When you write code, you MUST use the write_file tool — do NOT just show the code in chat.

To call a tool, embed one of these formats in your response:

Bracket format: [write_file: {"path": "src/main.js", "content": "console.log('hello');"}]
JSON format: { "tool": "write_file", "arguments": { "path": "src/main.js", "content": "console.log('hello');" } }

Available tools — use these instead of showing code:
${toolList}${pluginSection}

The app will parse these tool calls from your text, execute them, and return the results. You can use multiple tool calls in a single response.

RULES:
1. Always start by listing files to understand the project structure — use [list_files: {}] or {"tool": "list_files", "arguments": {}}
2. Read files before making changes — use [read_file: {"path": "..."}] or {"tool": "read_file", "arguments": {"path": "..."}}
3. You MUST use write_file to create or modify files — never just show the code in chat
4. Use exec_command to install dependencies, run the project, etc.
5. After making changes, verify with exec_command if appropriate
6. Explain what you're doing at each step
7. Only modify files inside the project — do not access files outside
8. When to use ask_question: if you are unsure about something, need permission, or need the user to make a choice — ALWAYS use it. Provide clear options including a custom answer choice.
9. Put your internal reasoning in [think]...[/think] blocks. The user sees these as gray italic text. Keep them brief and focused on your plan/investigation.
10. When using write_file, delete_file, rename_file, or exec_command, always provide a brief "description" parameter summarizing the action in 2-5 words.`;
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
  // JSON format: { "tool": "name", "arguments": { ... } }
  const jsonRe = /\{\s*"tool"\s*:\s*"/g;
  let jm;
  while ((jm = jsonRe.exec(text)) !== null) {
    const startIdx = jm.index;
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
    if (endIdx > startIdx) {
      try {
        const obj = JSON.parse(text.slice(startIdx, endIdx));
        if (obj.tool && typeof obj.tool === 'string') {
          const args = obj.arguments || {};
          for (const k of Object.keys(obj)) {
            if (k !== 'tool' && k !== 'arguments') args[k] = obj[k];
          }
          const rawJson = text.slice(startIdx, endIdx);
          calls.push({
            function: { name: obj.tool, arguments: JSON.stringify(args) },
            id: 'json_' + Date.now() + '_' + calls.length,
            args,
            _raw: rawJson
          });
        }
      } catch (e) {}
    }
  }
  return calls;
}

// ==================== MODEL META ====================
const MODEL_META = {
  'gpt-4o': { context: 128000, costIn: 2.5, costOut: 10, free: false },
  'gpt-4o-mini': { context: 128000, costIn: 0.15, costOut: 0.6, free: false },
  'gpt-5.5': { context: 256000, costIn: 5, costOut: 25, free: false },
  'claude-sonnet-4-6': { context: 200000, costIn: 3, costOut: 15, free: false },
  'claude-3.5-haiku': { context: 200000, costIn: 0.8, costOut: 4, free: false },
  'gemini-2.5-flash': { context: 1048576, costIn: 0, costOut: 0, free: true },
  'gemini-2.5-pro': { context: 1048576, costIn: 1.25, costOut: 10, free: false },
  'deepseek-chat': { context: 64000, costIn: 0.14, costOut: 0.28, free: false },
  'deepseek-reasoner': { context: 64000, costIn: 0.55, costOut: 2.19, free: false },
  'mistral-large-latest': { context: 131000, costIn: 2, costOut: 6, free: false },
  'codestral-latest': { context: 256000, costIn: 1, costOut: 3, free: false },
  'grok-4.3': { context: 131072, costIn: 5, costOut: 15, free: false },
  'big-pickle': { context: 128000, costIn: 0, costOut: 0, free: true },
  'deepseek-v4-flash-free': { context: 128000, costIn: 0, costOut: 0, free: true },
  'deepseek-v4-pro': { context: 128000, costIn: 2, costOut: 8, free: false },
  'qwen2.5-coder': { context: 131072, costIn: 0, costOut: 0, free: true, local: true },
};

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
    opencode: [OpenCodeProvider, 'key', 'model', 'big-pickle'],
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
  // Add model info buttons + free/key badges in settings
  document.querySelectorAll('.provider-body select[id^="model-"]').forEach(sel => {
    if (!sel.parentNode.querySelector('.btn-model-info')) {
      const btn = document.createElement('button');
      btn.className = 'btn-model-info';
      btn.textContent = '\u24D8';
      btn.title = 'Model info';
      btn.addEventListener('click', () => {
        const providerId = sel.id.replace('model-', '');
        showModelInfo(providerId, sel.value);
      });
      sel.parentNode.insertBefore(btn, sel.nextSibling);
    }
    let badge = sel.parentNode.querySelector('.model-free-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'model-free-badge';
      sel.parentNode.insertBefore(badge, sel.nextSibling);
    }
    const updateBadge = () => {
      const meta = MODEL_META[sel.value];
      if (meta && meta.free) { badge.textContent = '\u2601 Free'; badge.className = 'model-free-badge free'; }
      else { badge.textContent = '\uD83D\uDD11 Key'; badge.className = 'model-free-badge key'; }
    };
    updateBadge();
    sel.addEventListener('change', updateBadge);
  });
  await initSandbox();
  try {
    const autoStart = await window.electronAPI.getAutoStart();
    document.getElementById('auto-start').checked = autoStart;
  } catch {}
  if (s.seeThoughts !== undefined) document.getElementById('see-thoughts').checked = s.seeThoughts;
  else document.getElementById('see-thoughts').checked = true;
  if (s.instantMode !== undefined) document.getElementById('instant-mode').checked = s.instantMode;
  else document.getElementById('instant-mode').checked = false;
  if (s.detailedActivity !== undefined) document.getElementById('detailed-activity').checked = s.detailedActivity;
  else document.getElementById('detailed-activity').checked = false;
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
  if (s.timeout !== undefined) document.getElementById('settings-timeout').value = s.timeout;
  if (s.autoAccept !== undefined) {
    document.getElementById('auto-accept').checked = s.autoAccept;
    document.getElementById('auto-exceptions-area').classList.toggle('hidden', !s.autoAccept);
  }
  const ex = s.autoExceptions || {};
  document.getElementById('exc-shell').checked = ex.shell || false;
  document.getElementById('exc-outside').checked = ex.outside || false;
  document.getElementById('exc-git').checked = ex.git || false;
  document.getElementById('exc-terminal').checked = ex.terminal || false;
  const ci = document.getElementById('custom-instructions');
  if (ci && s.customInstructions !== undefined) ci.value = s.customInstructions;
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
  settings.detailedActivity = document.getElementById('detailed-activity').checked;

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
  // Update free badge
  const freeBadge = document.getElementById('provider-free-badge');
  if (freeBadge) {
    const meta = MODEL_META[model];
    freeBadge.textContent = meta && meta.free ? '\u2601 Free' : '\uD83D\uDD11 Key';
    freeBadge.className = 'model-free-badge ' + (meta && meta.free ? 'free' : 'key');
  }
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

function showModelInfo(providerId, modelName) {
  const cap = capabilityCache[providerId + ':' + modelName];
  const meta = MODEL_META[modelName];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const caps = cap ? Object.entries(cap).filter(([k, v]) => typeof v === 'boolean').map(([k, v]) => '<span class="cap-badge ' + (v ? 'cap-yes' : 'cap-no') + '">' + k.replace(/_/g, ' ') + '</span>').join('') : '<span class="cap-badge cap-no">unknown</span>';
  const metaHtml = meta ? '<div class="info-row"><span class="info-label">Context Window</span><span class="info-value">' + (meta.context / 1000).toFixed(0) + 'K tokens</span></div>' +
    '<div class="info-row"><span class="info-label">Input Cost</span><span class="info-value">' + (meta.free ? '\u2601 Free' : '$' + meta.costIn + '/M tokens') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Output Cost</span><span class="info-value">' + (meta.free ? '\u2601 Free' : '$' + meta.costOut + '/M tokens') + '</span></div>' +
    (meta.local ? '<div class="info-row"><span class="info-label">Type</span><span class="info-value">Local (Ollama)</span></div>' : '') : '<div class="info-row"><span class="info-label">Context</span><span class="info-value">Unknown</span></div>';
  overlay.innerHTML = '<div class="modal-content model-info-modal"><h2>' + escapeHtml(modelName) + '</h2>' +
    '<div class="model-info-grid">' + metaHtml +
    '<div class="info-row"><span class="info-label">Capabilities</span><span class="info-value caps-list">' + caps + '</span></div>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn btn-secondary close-model-info">Close</button></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.close-model-info').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showModelInfoPopup() {
  const sel = document.getElementById('provider-select');
  const provider = sel?.value;
  const prov = providers[provider];
  const modelName = prov?.model || 'Unknown';
  const cacheKey = provider + ':' + modelName;
  const caps = capabilityCache[cacheKey] || getKnownCapabilities(provider, prov?.model);
  const temp = prov?.temperature !== undefined ? prov.temperature : 0.7;
  const isLocal = provider === 'ollama' || provider === 'lmstudio' || provider === 'localai';
  const meta = MODEL_META[modelName];

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

  const metaHtml = meta ? '<div class="model-info-section"><strong>Context:</strong> ' + (meta.context / 1000).toFixed(0) + 'K tokens</div>' +
    '<div class="model-info-section"><strong>Pricing:</strong> ' + (meta.free ? '\u2601 Free' : 'In $' + meta.costIn + '/M \u2022 Out $' + meta.costOut + '/M') + '</div>' +
    (meta.local ? '<div class="model-info-section"><strong>Type:</strong> Local (Ollama)</div>' : '') : '';

  popup.innerHTML = '<div class="model-info-header">' +
    '<strong>' + modelName + '</strong>' +
    '<span class="model-info-provider">' + provider + (meta && meta.free ? ' \u2601 Free' : isLocal ? ' \U0001F194' : ' \U0001F511') + '</span>' +
    '</div>' +
    '<div class="model-info-body">' +
    metaHtml +
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
  // Start file watcher for live sync
  if (window.electronAPI.watchProject) {
    window.electronAPI.watchProject(name);
  }

  if (files.length > 0) {
    for (const f of files) await openTab(f, false);
    if (openTabs.length > 0) switchTab(0);
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
  const sb = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  sb.classList.toggle('hidden');
  if (resizer) resizer.classList.toggle('hidden');
  localStorage.setItem('florde-sidebar-hidden', sb.classList.contains('hidden') ? '1' : '0');
});

document.getElementById('btn-refresh-tree').addEventListener('click', () => { renderFileTree(); logToTerminal('File tree refreshed', 'info'); });

// === Sidebar Drag Resize ===
(function() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  let startX, startW;
  resizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (me) => {
      const w = Math.max(180, startW + (me.clientX - startX));
      sidebar.style.width = w + 'px';
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('florde-sidebar-width', sidebar.offsetWidth + '');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
})();

// === Sidebar Search Close ===
document.getElementById('btn-sidebar-search-close')?.addEventListener('click', () => {
  document.getElementById('sidebar-search').classList.add('hidden');
});

// === Terminal Minimize ===
document.getElementById('btn-terminal-minimize')?.addEventListener('click', () => {
  document.getElementById('terminal-panel').classList.toggle('hidden');
});

// === File Tree Context Menu ===
let _contextFile = null;
let _contextIsDir = false;

document.addEventListener('contextmenu', (e) => {
  const treeItem = e.target.closest('.tree-item');
  if (!treeItem) { hideContextMenu(); return; }
  e.preventDefault();
  const nameEl = treeItem.querySelector('.name');
  _contextFile = nameEl ? nameEl.textContent : '';
  _contextIsDir = treeItem.closest('.tree-dir') !== null;

  const parent = treeItem.closest('.tree-dir') ? treeItem.closest('.tree-dir').querySelector('.tree-children')?.parentNode : null;
  if (_contextIsDir) {
    _contextFile = treeItem.querySelector('.name')?.textContent || '';
    let path = '';
    let cur = treeItem.closest('.tree-dir');
    while (cur) {
      const s = cur.querySelector('summary .name');
      if (s) path = s.textContent + '/' + path;
      cur = cur.parentElement?.closest('.tree-dir');
    }
    _contextFile = path + _contextFile + '/';
  } else {
    let path = '';
    let cur = treeItem.closest('.tree-dir');
    while (cur) {
      const s = cur.querySelector('summary .name');
      if (s) path = s.textContent + '/' + path;
      cur = cur.parentElement?.closest('.tree-dir');
    }
    _contextFile = path + _contextFile;
  }

  const menu = document.getElementById('file-tree-context-menu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#file-tree-context-menu')) hideContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

document.getElementById('file-tree-context-menu').addEventListener('click', async (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !_contextFile) return;
  const action = item.dataset.action;
  hideContextMenu();

  const file = _contextFile;
  if (action === 'copy-path') {
    try {
      await navigator.clipboard.writeText(file);
      logToTerminal('Copied: ' + file, 'info');
    } catch {}
    return;
  }

  if (action === 'rename') {
    const newName = prompt('Rename "' + file + '" to:', file);
    if (!newName || newName === file) return;
    try {
      await window.electronAPI.projectRenameFile(currentProject, file, newName);
      const idx = openTabs.indexOf(file);
      if (idx >= 0) {
        tabContents[newName] = tabContents[file];
        tabLanguages[newName] = tabLanguages[file];
        tabDirty[newName] = tabDirty[file];
        delete tabContents[file]; delete tabLanguages[file]; delete tabDirty[file];
        openTabs[idx] = newName;
        if (activeTabIndex === idx) document.getElementById('file-name').textContent = newName;
      }
      await renderFileTree();
      logToTerminal('Renamed: ' + file + ' → ' + newName, 'success');
    } catch (err) {
      logToTerminal('Rename failed: ' + err.message, 'error');
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm('Delete "' + file + '"? This cannot be undone.')) return;
    try {
      await window.electronAPI.projectDeleteFile(currentProject, file);
      const idx = openTabs.indexOf(file);
      if (idx >= 0) {
        const disposable = modelDisposables.get(file);
        if (disposable) { disposable.dispose(); modelDisposables.delete(file); }
        const model = monaco.editor.getModels().find(m => m.uri.path === '/' + file);
        if (model) model.dispose();
        openTabs.splice(idx, 1);
        if (idx <= activeTabIndex) activeTabIndex = Math.max(0, activeTabIndex - 1);
        if (activeTabIndex >= openTabs.length) activeTabIndex = openTabs.length - 1;
        switchTab(activeTabIndex);
      }
      await renderFileTree();
      logToTerminal('Deleted: ' + file, 'success');
    } catch (err) {
      logToTerminal('Delete failed: ' + err.message, 'error');
    }
    return;
  }
});

function hideContextMenu() {
  document.getElementById('file-tree-context-menu').classList.add('hidden');
  _contextFile = null;
}

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
    let msgHtml = '';
    if (msg._images && msg._images.length > 0) {
      msgHtml += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">';
      for (const img of msg._images) {
        msgHtml += `<img src="${img.dataUrl}" class="chat-image" style="max-height:120px;border-radius:6px;" onclick="this.classList.toggle('full')">`;
      }
      msgHtml += '</div>';
    }
    msgHtml += formatMessageContent(msg.content);
    div.innerHTML = `<div class="msg-label">${label}${modelHint} <button class="copy-msg" data-content="${encodeURIComponent(msg.content)}">Copy</button></div>` + msgHtml;
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

// ==================== IMAGE ATTACHMENTS ====================

let _attachedImages = [];

function renderImagePreview() {
  const container = document.getElementById('chat-image-preview');
  container.innerHTML = '';
  if (_attachedImages.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  for (const img of _attachedImages) {
    const wrapper = document.createElement('span');
    wrapper.style.cssText = 'position:relative;display:inline-block;';
    const el = document.createElement('img');
    el.src = img.dataUrl;
    el.title = 'Click to remove';
    el.addEventListener('click', () => removeImage(img.id));
    const del = document.createElement('span');
    del.className = 'remove-img';
    del.textContent = '×';
    del.addEventListener('click', () => removeImage(img.id));
    wrapper.appendChild(el);
    wrapper.appendChild(del);
    container.appendChild(wrapper);
  }
}

function addImage(dataUrl, mimeType) {
  _attachedImages.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), dataUrl, mimeType });
  renderImagePreview();
}

function removeImage(id) {
  _attachedImages = _attachedImages.filter(i => i.id !== id);
  renderImagePreview();
}

document.getElementById('btn-attach-image').addEventListener('click', () => {
  document.getElementById('chat-image-input').click();
});

document.getElementById('btn-agentic-mode').addEventListener('click', () => {
  const btn = document.getElementById('btn-agentic-mode');
  const isPlan = btn.classList.contains('agentic-plan');
  btn.classList.toggle('agentic-plan', !isPlan);
  btn.classList.toggle('agentic-build', isPlan);
  btn.textContent = isPlan ? 'Build' : 'Plan';
  btn.title = isPlan ? 'Build mode: AI executes directly' : 'Plan mode: AI plans first, you approve';
});

document.getElementById('chat-image-input').addEventListener('change', (e) => {
  for (const file of e.target.files) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (ev) => addImage(ev.target.result, file.type);
    reader.readAsDataURL(file);
  }
  e.target.value = '';
});

const _chatInput = document.getElementById('chat-input');
_chatInput.addEventListener('paste', (e) => {
  for (const item of (e.clipboardData?.items || [])) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = (ev) => addImage(ev.target.result, file.type);
      reader.readAsDataURL(file);
    }
  }
});

function buildVisionMessages(baseMessages, images) {
  if (!images || images.length === 0) return baseMessages;
  const provider = document.getElementById('provider-select').value;
  const caps = getKnownCapabilities(provider, providers[provider]?.model);
  if (!caps || !caps.vision) return baseMessages;

  return baseMessages.map(m => {
    if (m.role !== 'user' || typeof m.content !== 'string') return m;
    const parts = [{ type: 'text', text: m.content }];
    for (const img of images) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    }
    return { ...m, content: parts };
  });
}

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

// Stop button state

function toggleSendStop() {
  if (_isRequestActive) {
    _stoppedByUser = true;
    _isRequestActive = false;
    resetSendButton();
    if (_requestAborter) { _requestAborter.abort(); _requestAborter = null; }
    if (typeof BrowserPanel !== 'undefined' && BrowserPanel.abortAll) BrowserPanel.abortAll();
    return;
  }
  sendMessage();
}

function resetSendButton() {
  const btn = document.getElementById('btn-send');
  if (btn) { btn.textContent = 'Send'; btn.classList.remove('is-stopping'); }
}

function updatePendingTaskBadge() {
  const badge = document.getElementById('pending-task-badge');
  if (!badge) return;
  const task = localStorage.getItem('florde-pending-task');
  if (task) {
    badge.classList.remove('hidden');
    badge.title = 'Pending task: ' + (JSON.parse(task).plan || '').slice(0, 80);
  } else {
    badge.classList.add('hidden');
  }
}

// Check for pending tasks on load
updatePendingTaskBadge();

document.getElementById('btn-send').addEventListener('click', toggleSendStop);

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

async function executeToolCall(name, args) {
  const project = currentProject;
  const type = currentProjectType;

  const allowed = await PermissionManager.checkTool(name, args);
  if (!allowed) {
    return 'Permission denied: ' + name + ' is blocked';
  }

  if (typeof setActivity === 'function') {
    setActivity(formatToolActivity(name, args));
  }

  switch (name) {
    case 'read_file':
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Read_File: ' + sanitizePath(args.path));
      logToTerminal('Read_File: ' + sanitizePath(args.path), 'info');
      return await window.electronAPI.projectReadFile(project, sanitizePath(args.path));

    case 'write_file':
      if (!project) throw new Error('No project open');
      // Support batch write via {files: {"path": "content", ...}}
      if (args.files && typeof args.files === 'object') {
        const written = [];
        for (const [filePath, content] of Object.entries(args.files)) {
          const sp = sanitizePath(filePath);
          await window.electronAPI.projectWriteFile(project, sp, content);
          const wfIdx = openTabs.indexOf(sp);
          if (wfIdx >= 0) {
            tabContents[sp] = content;
            tabDirty[sp] = false;
            if (wfIdx === activeTabIndex && editor) {
              editor.setValue(content);
            }
          }
          written.push(sp);
        }
        addAuditEntry('local', 'Batch_Write: ' + written.join(', '));
        logToTerminal('Batch_Write: ' + written.join(', '), 'info');
        // Auto git commit
        try {
          const gitDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : null;
          if (gitDir) {
            await window.electronAPI.sandboxExec(gitDir, 'git add -A 2>nul && git commit -m "Auto-commit: batch write ' + written.length + ' files" 2>nul');
          }
        } catch {}
        renderFileTree();
        return 'Batch written ' + written.length + ' files: ' + written.join(', ');
      }
      addAuditEntry('local', 'Write_File: ' + sanitizePath(args.path));
      logToTerminal('Write_File: ' + sanitizePath(args.path), 'info');
      await window.electronAPI.projectWriteFile(project, sanitizePath(args.path), args.content);
      // Live editor sync: reload if open in a tab
      const wfIdx = openTabs.indexOf(sanitizePath(args.path));
      if (wfIdx >= 0) {
        tabContents[sanitizePath(args.path)] = args.content;
        tabDirty[sanitizePath(args.path)] = false;
        if (wfIdx === activeTabIndex && editor) {
          editor.setValue(args.content);
        }
      }
      renderFileTree();
      // Auto git commit if in a git repo
      try {
        const gitDir = currentProjectType === 'local' ? await window.electronAPI.getProjectRoot(project) : null;
        if (gitDir) {
          await window.electronAPI.sandboxExec(gitDir, 'git add -A 2>nul && git commit -m "Auto-commit: ' + (args.description || 'update ' + sanitizePath(args.path)).replace(/"/g, "'") + '" 2>nul');
        }
      } catch {}
      return 'File written: ' + sanitizePath(args.path);

    case 'delete_file':
      if (!project) throw new Error('No project open');
      addAuditEntry('local', 'Delete_File: ' + sanitizePath(args.path));
      logToTerminal('Delete_File: ' + sanitizePath(args.path), 'info');
      await window.electronAPI.projectDeleteFile(project, sanitizePath(args.path));
      renderFileTree();
      return 'File deleted: ' + sanitizePath(args.path);

    case 'list_files':
      if (!project) throw new Error('No project open');
      const files = await window.electronAPI.projectListFiles(project);
      renderFileTree();
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
      const risk = assessShellRisk(args.command);
      logToTerminal('Shell risk level: ' + risk, risk === 'critical' || risk === 'high' ? 'warn' : 'info');
      const execResult = await window.electronAPI.sandboxExec(execDir, args.command);
      const outputText = typeof execResult === 'string' ? execResult : (execResult && execResult.output ? execResult.output : '');
      // Insert expandable shell view into the current AI message
      const shellView = showExpandableShellView(args.command, outputText);
      const aiMsg = document.querySelector('.chat-msg.ai:last-child');
      if (aiMsg) aiMsg.appendChild(shellView);
      logToTerminal('Command output: ' + outputText.substring(0, 500), 'info');
      return outputText;

    case 'ask_question':
      showNotification('question', 'Florde Has a Question \u2014 Check the question dialog', '\u2753');
      return await askUserQuestion(args.question, args.choices);

    case 'rename_file':
      if (!project) throw new Error('No project open');
      const oldPath = sanitizePath(args.path);
      const newPath = sanitizePath(args.new_path);
      addAuditEntry('local', 'Rename_File: ' + oldPath + ' -> ' + newPath);
      logToTerminal('Rename_File: ' + oldPath + ' -> ' + newPath, 'info');
      // Read old content
      const oldContent = await window.electronAPI.projectReadFile(project, oldPath);
      // Write to new path
      await window.electronAPI.projectWriteFile(project, newPath, oldContent);
      // Delete old path
      await window.electronAPI.projectDeleteFile(project, oldPath);
      // Update imports if requested
      if (args.update_imports !== false) {
        const oldFilename = oldPath.split('/').pop();
        const newFilename = newPath.split('/').pop();
        const oldBasename = oldFilename.replace(/\.[^.]+$/, '');
        const newBasename = newFilename.replace(/\.[^.]+$/, '');
        const results = await window.electronAPI.searchInFiles(project, oldBasename);
        if (results && results.length > 0) {
          const seenFiles = new Set();
          let updatedCount = 0;
          for (const match of results) {
            if (match.file === oldPath || match.file === newPath) continue;
            if (seenFiles.has(match.file)) continue;
            seenFiles.add(match.file);
            try {
              let content = await window.electronAPI.projectReadFile(project, match.file);
              const original = content;
              content = content.replace(new RegExp(oldBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newBasename);
              content = content.replace(new RegExp(oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPath);
              if (content !== original) {
                await window.electronAPI.projectWriteFile(project, match.file, content);
                updatedCount++;
              }
            } catch {}
          }
          if (updatedCount > 0) logToTerminal('Updated imports in ' + updatedCount + ' files', 'info');
        }
      }
      // Sync editor tabs
      const renameIdx = openTabs.indexOf(oldPath);
      if (renameIdx >= 0) {
        openTabs[renameIdx] = newPath;
        tabContents[newPath] = tabContents[oldPath];
        tabDirty[newPath] = tabDirty[oldPath];
        delete tabContents[oldPath];
        delete tabDirty[oldPath];
        if (renameIdx === activeTabIndex && editor) {
          editor.setValue(tabContents[newPath]);
        }
        renderTabs();
      }
      return 'Renamed ' + oldPath + ' to ' + newPath;

    case 'take_screenshot':
      addAuditEntry('local', 'Take_Screenshot');
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const track = stream.getVideoTracks()[0];
        const bitmap = await createImageBitmap(track);
        track.stop();
        stream.getTracks().forEach(t => t.stop());
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(bitmap.width, 1920);
        canvas.height = bitmap.height * (canvas.width / bitmap.width);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        // Attach to chat history as user image so vision-capable models can see it
        const imgEntry = { role: 'user', content: '[Screenshot attached]', _images: [{ dataUrl }] };
        chatHistory.push(imgEntry);
        renderChat();
        logToTerminal('Screenshot captured (' + Math.round(dataUrl.length / 1024) + 'KB) and attached to chat', 'info');
        return 'Screenshot captured and attached as image. It will be visible to vision-capable models in the next request.';
      } catch (err) {
        throw new Error('Screenshot failed: ' + err.message);
      }

    case 'schedule_task':
      addAuditEntry('local', 'Schedule_Task: ' + (args.plan || '').slice(0, 80));
      logToTerminal('Schedule_Task: ' + (args.plan || '').slice(0, 120), 'info');
      localStorage.setItem('florde-pending-task', JSON.stringify({
        plan: args.plan,
        steps: args.steps,
        context: args.context || '',
        created: Date.now()
      }));
      updatePendingTaskBadge();
      showNotification('info', 'Task scheduled — AI will continue on next request', '\uD83D\uDCCB');
      return 'Task scheduled: "' + (args.plan || '').slice(0, 100) + '". The user will be prompted to continue this task on their next request.';

    case 'browser_open':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      await BrowserPanel.navigate(args.url);
      return 'Opened: ' + args.url;
    case 'browser_click':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      await BrowserPanel.evaluate(`document.querySelector('${args.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}').click()`);
      return 'Clicked: ' + args.selector;
    case 'browser_type':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      const escapedText = args.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      await BrowserPanel.evaluate(`
        (() => {
          const el = document.querySelector('${args.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
          if (!el) throw new Error('Element not found: ${args.selector.replace(/'/g, "\\'")}');
          el.value = '${escapedText}';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return 'Typed into: ' + args.selector;
    case 'browser_screenshot':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      const dataUrl = await BrowserPanel.screenshot();
      if (!dataUrl) return 'Screenshot: page is blank (about:blank)';
      // Attach as user image message
      const chatMessages = document.getElementById('chat-messages');
      const imgDiv = document.createElement('div');
      imgDiv.className = 'message user-message';
      imgDiv.innerHTML = '<div class="message-content"><img src="' + dataUrl + '" style="max-width:100%;border-radius:6px;" /></div>';
      chatMessages.appendChild(imgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return 'Screenshot taken and attached to chat.';
    case 'browser_back':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      await BrowserPanel.back();
      return 'Navigated back';
    case 'browser_forward':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      await BrowserPanel.forward();
      return 'Navigated forward';
    case 'browser_reload':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      await BrowserPanel.reload();
      return 'Page reloaded';
    case 'browser_evaluate':
      if (typeof BrowserPanel === 'undefined') throw new Error('BrowserPanel not available');
      BrowserPanel.show();
      const evalResult = await BrowserPanel.evaluate(args.code);
      return 'Result: ' + (typeof evalResult === 'object' ? JSON.stringify(evalResult) : String(evalResult));

    default:
      // Check if this is a connected app tool (e.g. make_list_scenarios)
      if (APP_TOOL_LOOKUP[name]) {
        return await executeAppTool(name, args);
      }
      if (typeof pluginRegistry !== 'undefined' && pluginRegistry.toolHandlers.has(name)) {
        return await pluginRegistry.executeTool(name, args);
      }
      throw new Error('Unknown tool: ' + name);
  }
}

// Execute a named tool for a connected app (e.g. make_list_scenarios, github_create_issue)
async function executeAppTool(name, args) {
  const appId = APP_TOOL_LOOKUP[name];
  const cap = APP_CAPABILITIES[appId];
  if (!cap) throw new Error('Unknown app capability: ' + appId);
  const shortName = name.slice(appId.length + 1);
  const toolDef = cap.tools.find(t => t.n === shortName);
  if (!toolDef) throw new Error('Unknown tool: ' + name);

  // Get API key from keychain
  const apiKey = await window.electronAPI.keychain.retrieve({ key: 'app:' + appId });
  if (!apiKey) {
    const appInfo = CONNECTED_APPS.find(a => a.id === appId);
    throw new Error(appInfo ? appInfo.name + ' is not connected. Go to Settings > Connected Apps to connect it first.' : 'App not connected: ' + appId);
  }

  // Build request
  let endpoint = toolDef.p;
  let method = toolDef.m || 'GET';
  let body = null;
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Florde/1.0' };
  const authType = cap.auth || 'Bearer';
  headers['Authorization'] = authType === 'Token' ? 'Token ' + apiKey : 'Bearer ' + apiKey;
  if (appId === 'supabase') headers['apikey'] = apiKey;

  // Handle GraphQL (Railway)
  if (toolDef.isGraphQL) {
    let query = toolDef.gql;
    const variables = {};
    if (toolDef.gqlVars) {
      const varMap = toolDef.gqlVars.length > 0 ? toolDef.gqlVars : Object.keys(args);
      for (const v of varMap) {
        variables[v] = args[v] || '';
      }
    }
    body = JSON.stringify({ query, variables });
  } else if (args && Object.keys(args).length > 0) {
    // Substitute path params
    const pathParams = endpoint.match(/\{(\w+)\}/g);
    if (pathParams) {
      for (const pp of pathParams) {
        const key = pp.slice(1, -1);
        if (args[key] !== undefined) {
          endpoint = endpoint.replace(pp, encodeURIComponent(String(args[key])));
        }
      }
    }

    // Determine remaining args (not used in path)
    const usedInPath = (endpoint.match(/\{(\w+)\}/g) || []).map(p => p.slice(1, -1));
    const remaining = {};
    for (const [k, v] of Object.entries(args)) {
      if (!usedInPath.includes(k)) remaining[k] = v;
    }

    if (method === 'GET') {
      // Remaining args become query params
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(remaining)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const qStr = qs.toString();
      if (qStr) endpoint += '?' + qStr;
    } else if (toolDef.body) {
      body = JSON.stringify(toolDef.body);
    } else if (Object.keys(remaining).length > 0) {
      body = JSON.stringify(remaining);
    }
  }

  const url = cap.baseUrl + endpoint;
  const fetchOpts = { method, headers };
  if (body) fetchOpts.body = body;

  const resp = await fetch(url, fetchOpts);
  const text = await resp.text();
  if (!resp.ok) {
    const appInfo = CONNECTED_APPS.find(a => a.id === appId);
    throw new Error((appInfo ? appInfo.name : appId) + ' API error ' + resp.status + ': ' + text.slice(0, 500));
  }
  return text.length > 10000 ? text.slice(0, 10000) + '\n... [truncated, full response was ' + text.length + ' chars]' : text;
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
    opencode: { tool_calling: true, streaming: true, json_mode: true, vision: m.includes('big-pickle') || m.includes('vision'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
    ollama: { tool_calling: false, streaming: true, json_mode: false, vision: m.includes('llava') || m.includes('vision'), thinking: false, images: false, embeddings: false, function_calling: true, custom_temperature: true, seed: true, context_caching: false },
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

function showPlanModal(plan) {
  return new Promise(resolve => {
    const modal = document.getElementById('plan-modal');
    const content = document.getElementById('plan-content');
    content.textContent = plan;
    modal.classList.remove('hidden');
    const execute = document.getElementById('btn-plan-execute');
    const cancel = document.getElementById('btn-plan-cancel');
    const cleanup = () => {
      modal.classList.add('hidden');
      execute.removeEventListener('click', onExecute);
      cancel.removeEventListener('click', onCancel);
    };
    const onExecute = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    execute.addEventListener('click', onExecute);
    cancel.addEventListener('click', onCancel);
  });
}

function formatToolArg(name, args) {
  const detailed = document.getElementById('detailed-activity')?.checked;
  let arg = (args && (args.path || args.command || args.query)) || '';
  if (!arg) return name + '()';
  if (!detailed && args.path) arg = args.path.split('/').pop() || args.path;
  return name + '(' + arg + ')';
}

const TOOL_LABELS = {
  read_file: 'Read File',
  write_file: 'Write File',
  delete_file: 'Delete File',
  list_files: 'List Files',
  search_files: 'Search Files',
  exec_command: 'Execute Command',
  ask_question: 'Ask Question',
  rename_file: 'Rename File',
  take_screenshot: 'Take Screenshot',
  schedule_task: 'Schedule Task',
  browser_open: 'Browser Open',
  browser_click: 'Browser Click',
  browser_type: 'Browser Type',
  browser_screenshot: 'Browser Screenshot',
  browser_back: 'Browser Back',
  browser_forward: 'Browser Forward',
  browser_reload: 'Browser Reload',
  browser_evaluate: 'Browser JS',
  web_search: 'Web Search',
  web_fetch: 'Web Fetch'
};

function formatToolActivity(name, args) {
  // App tool: show nice label like "Make: List Scenarios"
  const appId = APP_TOOL_LOOKUP[name];
  if (appId) {
    const app = CONNECTED_APPS.find(a => a.id === appId);
    const shortName = name.slice(appId.length + 1).replace(/_/g, ' ');
    const appLabel = app ? app.name : appId;
    const label = appLabel + ': ' + shortName.replace(/\b\w/g, c => c.toUpperCase());
    const arg = args && Object.keys(args).length > 0 ? Object.values(args).filter(v => typeof v === 'string').slice(0, 2).join(', ') : '';
    return arg ? label + ' ' + arg : label;
  }
  const label = TOOL_LABELS[name] || name;
  const detailed = document.getElementById('detailed-activity')?.checked;
  let arg = (args && (args.path || args.command || args.question || args.query || (args.code && args.code.slice(0, 40)))) || '';
  if (!arg) return label;
  if (!detailed && args.path) arg = args.path.split('/').pop() || args.path;
  return label + ' ' + arg;
}

async function summarizeChat() {
  const totalChars = chatHistory.reduce((s, m) => s + (m.content || '').length, 0);
  if (totalChars < SUMMARY_THRESHOLD) return;
  const providerId = document.getElementById('provider-select')?.value;
  const prov = providerId ? providers[providerId] : null;
  if (!prov || !prov.sendPlain) return;
  const recentMsgs = chatHistory.slice(-5);
  const olderMsgs = chatHistory.slice(0, -5).filter(m => m.role !== 'system').slice(-20);
  if (olderMsgs.length === 0) return;
  const summaryPrompt = 'Summarize the following conversation concisely (2-4 sentences) covering key decisions, files changed, and topics discussed:\n\n' +
    olderMsgs.map(m => m.role + ': ' + m.content.slice(0, 2000)).join('\n\n');
  try {
    const summary = await prov.sendPlain([
      { role: 'system', content: 'You are a summarization assistant. Output only the summary, nothing else.' },
      { role: 'user', content: summaryPrompt }
    ]);
    if (summary && summary.length > 20) _chatSummary = summary.trim();
  } catch {}
}

async function sendMessage(text) {
  const input = document.getElementById('chat-input');
  if (!text) text = input.value.trim();
  if (!text) return;

  // Reset sources tracking for this request
  window._aiSources = [];

  // Inject pending task if any
  const pendingTaskRaw = localStorage.getItem('florde-pending-task');
  if (pendingTaskRaw) {
    try {
      const task = JSON.parse(pendingTaskRaw);
      const taskPreamble = '[Continuing scheduled task: ' + task.plan + ']\nContext: ' + (task.context || '') + '\nRemaining steps: ' + (task.steps || []).join(', ') + '\n\n---\n';
      text = taskPreamble + text;
      localStorage.removeItem('florde-pending-task');
      updatePendingTaskBadge();
    } catch {}
  }

  const provider = document.getElementById('provider-select').value;
  if (!providers[provider]) { logToTerminal('Please configure API key for ' + provider + ' in Settings', 'error'); return; }

  // Toggle button to Stop mode
  _isRequestActive = true;
  const sendBtn = document.getElementById('btn-send');
  sendBtn.textContent = 'Stop';
  sendBtn.classList.add('is-stopping');
  _requestAborter = new AbortController();

  const isCloud = provider !== 'ollama' && provider !== 'lmstudio' && provider !== 'localai';
  addAuditEntry(isCloud ? 'cloud' : 'local', 'Nachricht gesendet an ' + provider);
  updatePrivacyIndicator();

  const userImages = _attachedImages.length > 0 ? [..._attachedImages] : undefined;
  chatHistory.push({ role: 'user', content: text, _images: userImages });
  trimChatHistory();
  if (input) input.value = '';
  _attachedImages = [];
  renderImagePreview();
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

  // === Agentic Mode: generate plan first ===
  if (document.getElementById('btn-agentic-mode')?.classList.contains('agentic-plan')) {
    const planPrompt = 'Create a concise step-by-step plan for this request. List specific files, commands, and order of operations:\n\n' + text;
    const planMessages = [
      { role: 'system', content: 'You are a planning AI. Output only the plan with clear steps.' },
      { role: 'user', content: planPrompt }
    ];
    let plan = '';
    startAnim('*Planning*');
    try {
      plan = await providers[provider].sendPlain(planMessages);
    } catch (err) {
      logToTerminal('Plan generation failed, proceeding without plan: ' + err.message, 'warn');
    }
    stopAnim(plan);
    if (plan) {
      const approved = await showPlanModal(plan);
      if (!approved) return;
      chatHistory.push({ role: 'system', content: 'Approved execution plan:\n' + plan });
    }
  }

  startAnim('*Thinking*');

  let activityEl = null;
  function setActivity(text) {
    if (!activityEl) {
      activityEl = document.createElement('div');
      activityEl.className = 'chat-activity';
      msgDiv.parentNode?.insertBefore(activityEl, msgDiv.nextSibling);
    }
    activityEl.textContent = text;
  }
  function clearActivity() {
    if (activityEl) { activityEl.remove(); activityEl = null; }
  }

  logToTerminal('Sending request to ' + provider + '...', 'info');

  try {
    const timeoutMinutes = parseInt(document.getElementById('settings-timeout')?.value) || 30;
    let _timedOut = false;
    const onTimeout = () => {
      _timedOut = true;
      if (_requestAborter) _requestAborter.abort();
      stopAnim();
      cancelRequestWithTimeout('Request cancelled after ' + timeoutMinutes + ' minutes.');
      logToTerminal('Request timed out after ' + timeoutMinutes + ' minutes', 'error');
      _isRequestActive = false;
      resetSendButton();
    };
    startRequestTimeout(timeoutMinutes, onTimeout);
    _backoffStep = null;
    const prov = providers[provider];
    const supportsTools = prov ? (prov.supportsTools ? true : await checkToolSupport(prov, provider)) : false;
    const systemMsg = { role: 'system', content: buildSystemPrompt(supportsTools) };
    const MAX_MSG_CHARS = 100000;
    const allImages = chatHistory.filter(m => m._images).flatMap(m => m._images);
    let messages = [systemMsg, ...chatHistory.map(m => ({ role: m.role, content: m.content }))];
    if (allImages.length > 0) {
      if (provider === 'ollama') {
        prov._pendingImages = allImages.map(i => i.dataUrl.replace(/^data:image\/\w+;base64,/, ''));
      } else {
        messages = buildVisionMessages(messages, allImages);
      }
    }
    let totalChars = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      totalChars += (messages[i].content || '').length;
      if (totalChars > MAX_MSG_CHARS) {
        messages = [systemMsg, ...messages.slice(i + 1)];
        break;
      }
    }
    // Inject chat summary if history is long
    if (_chatSummary && totalChars > SUMMARY_THRESHOLD) {
      const summaryMsg = { role: 'system', content: 'Previous conversation summary:\n' + _chatSummary };
      const alreadyHas = messages.some(m => m.content && m.content.includes(_chatSummary.slice(0, 40)));
      if (!alreadyHas) {
        messages.splice(1, 0, summaryMsg);
        // Trim old messages that were summarized — keep only the summary + last 15 messages
        const summaryIdx = messages.indexOf(summaryMsg);
        if (messages.length > 20) {
          messages = [messages[0], summaryMsg, ...messages.slice(-15)];
        }
      }
    }
    async function fetchWithBackoff(fn) {
      while (true) {
        if (_timedOut) throw new Error('Timed out');
        try {
          const result = await fn();
          _backoffStep = null;
          return result;
        } catch (err) {
          if (_timedOut) throw err;
          const is429 = /429|rate.?limit/i.test(err.message || '');
          if (is429) {
            _backoffStep = (_backoffStep || 0) + 1;
            const delay = getBackoffDelay(_backoffStep - 1);
            setActivity('Rate Limited — Retry in ' + Math.ceil(delay / 1000) + 's');
            logToTerminal('Rate limited, retrying in ' + (delay / 1000) + 's (step ' + _backoffStep + ')', 'warn');
            await new Promise(r => { _backoffTimer = setTimeout(r, delay); });
            continue;
          }
          throw err;
        }
      }
    }

    let finalContent = '';

    const _toolCallHistory = [];

    function _detectToolLoop(name, args) {
      const sig = name + ':' + JSON.stringify(args).slice(0, 100);
      _toolCallHistory.push(sig);
      const count = _toolCallHistory.filter(s => s === sig).length;
      if (count >= 3) return 'Loop detected: ' + name + ' called ' + count + ' times with the same arguments. Stop using this tool and synthesize your response.';
      if (_toolCallHistory.length >= 5) {
        const recent = _toolCallHistory.slice(-5);
        const unique = new Set(recent);
        if (unique.size <= 2) return 'Loop detected: you are repeating the same ' + name + ' tool calls. Stop and synthesize your response immediately.';
      }
      return null;
    }

    if (supportsTools) {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        const response = await fetchWithBackoff(() => prov.sendWithTools(messages, getActiveTools()));
        if (_timedOut) return;
        stopAnim();
        resetRequestTimeout(timeoutMinutes, onTimeout);

        if (response.tool_calls && response.tool_calls.length > 0) {
          messages.push({ role: 'assistant', content: response.content || null, tool_calls: response.tool_calls });
          logToTerminal('AI is using tools: ' + response.tool_calls.map(t => t.function.name).join(', '), 'ai');

          const toolNames = response.tool_calls.map(t => t.function.name).join(', ');
          startAnim('*Running tools', ' (' + toolNames + ')*');

          for (const toolCall of response.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const name = toolCall.function.name;
            const loopMsg = _detectToolLoop(name, args);
            if (loopMsg) {
              messages.push(getToolResultMsg(toolCall.id, name, loopMsg));
              logToTerminal(loopMsg, 'warn');
              continue;
            }
            stopAnim('*' + formatToolActivity(name, args) + '*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, result));
            startAnim('*Running tools', ' (' + toolNames + ')*');
            resetRequestTimeout(timeoutMinutes, onTimeout);
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
        clearActivity();
        clearRequestTimeout();
        return;
      }
    } else {
      let toolRounds = 0;
      const maxRounds = 15;

      while (toolRounds < maxRounds) {
        finalContent = await fetchWithBackoff(() => prov.sendMessage(messages, (chunk) => {
          stopAnim(chunk);
          resetRequestTimeout(timeoutMinutes, onTimeout);
        }));
        if (_timedOut) return;
        stopAnim(finalContent);
        resetRequestTimeout(timeoutMinutes, onTimeout);

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
            const loopMsg = _detectToolLoop(name, args);
            if (loopMsg) {
              messages.push(getToolResultMsg(toolCall.id, name, loopMsg));
              const bracketStr = '[' + name + ': ' + toolCall.function.arguments + ']';
              displayContent = displayContent.replace(bracketStr, '');
              if (toolCall._raw) displayContent = displayContent.replace(toolCall._raw, '');
              logToTerminal(loopMsg, 'warn');
              continue;
            }
            stopAnim('*' + formatToolActivity(name, args) + '*');
            let result;
            try {
              result = await executeToolCall(name, args);
            } catch (err) {
              result = 'Error: ' + err.message;
            }
            messages.push(getToolResultMsg(toolCall.id, name, result));
            const bracketStr = '[' + name + ': ' + toolCall.function.arguments + ']';
            displayContent = displayContent.replace(bracketStr, '');
            if (toolCall._raw) {
              displayContent = displayContent.replace(toolCall._raw, '');
            }
            startAnim('*Running tools', ' (' + toolNames + ')*');
            resetRequestTimeout(timeoutMinutes, onTimeout);
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
        clearActivity();
        clearRequestTimeout();
        return;
      }
    }

    clearActivity();
    clearRequestTimeout();
    const responseContent = finalContent || (messages.filter(m => m.role === 'assistant' && m.content).pop()?.content) || '';
    if (responseContent) {
      renderResponse(responseContent);
      chatHistory.push({ role: 'assistant', content: responseContent, model: provider });
      trimChatHistory();
      processAIResponse(responseContent);
      // Render sources box if any web_search/web_fetch was used
      if (window._aiSources && window._aiSources.length > 0) {
        const chatContainer = document.getElementById('chat-messages');
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'sources-box';
        let sourcesHtml = '<details class="sources-details"><summary>&#x1F4E1; Sources (' + window._aiSources.length + ')</summary>';
        for (const s of window._aiSources) {
          if (s.type === 'search') sourcesHtml += '<div class="source-item source-search">&#x1F50D; Search: "' + escapeHtml(s.query) + '"</div>';
          else sourcesHtml += '<div class="source-item source-fetch">&#x1F4C4; <a href="' + escapeHtml(s.url) + '" target="_blank">' + escapeHtml(s.url) + '</a></div>';
        }
        sourcesHtml += '</details>';
        sourcesDiv.innerHTML = sourcesHtml;
        chatContainer.appendChild(sourcesDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      // Background summary for long conversations — fire-and-forget
      if (chatHistory.length > 15 || totalChars > 30000) summarizeChat();
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
    clearRequestTimeout();
    const msg = err.message || 'Unknown error';
    let displayMsg = msg;
    if (_stoppedByUser) {
      _stoppedByUser = false;
      displayMsg = 'Request stopped by user.';
    } else if (err.name === 'AbortError') displayMsg = 'Request cancelled (timeout or aborted). Check your network and try again.';
    else if (/40[13]/.test(msg)) displayMsg = msg + ' \u2014 Check your API key in settings.';
    else if (/429/.test(msg)) displayMsg = msg + ' \u2014 Rate limited. Wait a moment and retry.';
    else if (/Failed to fetch/.test(msg)) displayMsg = 'Network error \u2014 check your connection and the API endpoint URL in settings.';
    contentDiv.textContent = 'Error: ' + displayMsg;
    logToTerminal('AI request failed: ' + displayMsg, 'error');
  } finally {
    clearActivity();
    _isRequestActive = false;
    _requestAborter = null;
    resetSendButton();
  }
}

async function processAIResponse(content) {
  const fileBlocks = content.match(/```file:([^\n]+)\n([\s\S]*?)```/g);
  if (!fileBlocks) return;
  if (!currentProject) {
    logToTerminal('AI included file blocks but no project is open', 'warn');
    return;
  }
  let written = 0;
  for (const block of fileBlocks) {
    const m = block.match(/```file:([^\n]+)\n([\s\S]*?)```/);
    if (!m) continue;
    const file = m[1].trim();
    const code = m[2];
    try {
      await window.electronAPI.projectWriteFile(currentProject, file, code);
      written++;
      const idx = openTabs.indexOf(file);
      if (idx >= 0) {
        tabContents[file] = code;
        tabDirty[file] = false;
        if (idx === activeTabIndex && editor) {
          editor.setValue(code);
        }
      }
    } catch (e) {
      logToTerminal('Failed to write file: ' + file + ' - ' + e.message, 'error');
    }
  }
  if (written > 0) {
    logToTerminal('Auto-written ' + written + ' file(s) to project', 'success');
    try { await renderFileTree(); } catch {}
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
    // Also show in sidebar
    const sidebarSearch = document.getElementById('sidebar-search');
    const sidebarResults = document.getElementById('sidebar-search-results');
    if (sidebarSearch) sidebarSearch.classList.remove('hidden');
    if (sidebarResults) sidebarResults.innerHTML = '';
    if (results.length === 0) {
      const msg = '<div style="color:var(--text3);padding:1rem;text-align:center;">No results found</div>';
      container.innerHTML = msg;
      if (sidebarResults) sidebarResults.innerHTML = msg;
      return;
    }
    for (const r of results) {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const highlighted = r.text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
      item.innerHTML = `<div><span class="search-result-file">${r.file}</span><span class="search-result-line">:${r.line}</span></div><div class="search-result-text">${highlighted}</div>`;
      const clickHandler = () => {
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
      };
      item.addEventListener('click', clickHandler);
      container.appendChild(item);
      // Clone for sidebar
      if (sidebarResults) {
        const sbItem = item.cloneNode(true);
        sbItem.addEventListener('click', clickHandler);
        sidebarResults.appendChild(sbItem);
      }
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
  else if (ctrl && e.shiftKey && e.key === 'B') { e.preventDefault(); document.getElementById('btn-browser-toggle').click(); }
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

// ==================== CONNECTED APPS ====================

const CONNECTED_APPS = [
  { id: 'make', name: 'Make.com', icon: '🔗', desc: 'Automation workflows — trigger & manage scenarios via API', baseUrl: 'https://eu1.make.com/api/v2', authType: 'Token', tokenLabel: 'Make API Token', tokenHelp: 'Get token from Make.com > Profile > API > Add token. Scopes needed: scenarios:read/write, hooks:read/write. Default zone: eu1. Change zone in baseUrl if needed (eu2, us1, us2).' },
  { id: 'cloudflare', name: 'Cloudflare', icon: '☁️', desc: 'CDN, DNS, Workers, D1, R2 & more', baseUrl: 'https://api.cloudflare.com/client/v4', authType: 'Bearer', tokenLabel: 'Cloudflare API Token', tokenHelp: 'Create a token at dash.cloudflare.com > My Profile > API Tokens' },
  { id: 'netlify', name: 'Netlify', icon: '🌐', desc: 'Hosting, serverless functions, forms & deploy', baseUrl: 'https://api.netlify.com/api/v1', authType: 'Bearer', tokenLabel: 'Netlify Personal Access Token', tokenHelp: 'Generate at app.netlify.com > User Settings > Applications > Personal access tokens' },
  { id: 'github', name: 'GitHub', icon: '🐙', desc: 'Repos, issues, PRs, Actions, deployments', baseUrl: 'https://api.github.com', authType: 'Bearer', tokenLabel: 'GitHub Personal Access Token', tokenHelp: 'Generate at github.com > Settings > Developer settings > Personal access tokens (needs repo, workflow scopes)' },
  { id: 'gitlab', name: 'GitLab', icon: '🦊', desc: 'Repos, CI/CD, registry & project management', baseUrl: 'https://gitlab.com/api/v4', authType: 'Bearer', tokenLabel: 'GitLab Personal Access Token', tokenHelp: 'Generate at gitlab.com > Preferences > Access Tokens' },
  { id: 'vercel', name: 'Vercel', icon: '▲', desc: 'Frontend deployment, serverless functions, analytics', baseUrl: 'https://api.vercel.com', authType: 'Bearer', tokenLabel: 'Vercel Token', tokenHelp: 'Generate at vercel.com > Settings > Tokens' },
  { id: 'digitalocean', name: 'DigitalOcean', icon: '🐳', desc: 'Cloud VMs, Kubernetes, app platform & databases', baseUrl: 'https://api.digitalocean.com/v2', authType: 'Bearer', tokenLabel: 'DigitalOcean Personal Access Token', tokenHelp: 'Create at cloud.digitalocean.com > API > Tokens/Keys' },
  { id: 'supabase', name: 'Supabase', icon: '⚡', desc: 'Postgres DB, auth, realtime, storage & edge functions', baseUrl: 'https://api.supabase.com', authType: 'Bearer', tokenLabel: 'Supabase Service Role Key', tokenHelp: 'Find in Supabase dashboard > Settings > API > service_role key. Also need project reference ID.' },
  { id: 'railway', name: 'Railway', icon: '🚂', desc: 'Full-stack deployment with database provisioning', baseUrl: 'https://api.railway.app/graphql/v2', authType: 'Bearer', tokenLabel: 'Railway API Token', tokenHelp: 'Generate at railway.com > Account > Tokens' },
  { id: 'render', name: 'Render', icon: '🖥️', desc: 'Cloud hosting for web services, static sites & cron', baseUrl: 'https://api.render.com/v1', authType: 'Bearer', tokenLabel: 'Render API Key', tokenHelp: 'Find at dashboard.render.com > Account Settings > API Keys' },
];

// === Manus-style App Capabilities ===
// Each connected app exposes specific tools with clean names and params.
// The AI uses these like Manus connectors — no raw API knowledge needed.
const APP_CAPABILITIES = {
  make: {
    auth: 'Token', baseUrl: 'https://eu1.make.com/api/v2',
    desc: 'Make.com automation platform',
    tools: [
      { n: 'list_scenarios', d: 'List all scenarios for a team', m: 'GET', p: '/scenarios', ps: { teamId: { t: 'number', d: 'Team ID' } }, r: ['teamId'] },
      { n: 'get_scenario', d: 'Get scenario details', m: 'GET', p: '/scenarios/{scenarioId}', ps: { scenarioId: { t: 'number', d: 'Scenario ID' } }, r: ['scenarioId'] },
      { n: 'create_scenario', d: 'Create a new automation scenario', m: 'POST', p: '/scenarios', ps: { teamId: { t: 'number', d: 'Team ID' }, name: { t: 'string', d: 'Scenario name' }, description: { t: 'string', d: 'Description (optional)' } }, r: ['teamId', 'name'] },
      { n: 'update_scenario', d: 'Update a scenario name, description or scheduling', m: 'PATCH', p: '/scenarios/{scenarioId}', ps: { scenarioId: { t: 'number', d: 'Scenario ID' }, name: { t: 'string', d: 'New name (optional)' }, description: { t: 'string', d: 'New description (optional)' } }, r: ['scenarioId'] },
      { n: 'delete_scenario', d: 'Delete a scenario permanently', m: 'DELETE', p: '/scenarios/{scenarioId}', ps: { scenarioId: { t: 'number', d: 'Scenario ID' } }, r: ['scenarioId'] },
      { n: 'activate_scenario', d: 'Activate (turn on) a scenario', m: 'PATCH', p: '/scenarios/{scenarioId}', ps: { scenarioId: { t: 'number', d: 'Scenario ID' } }, r: ['scenarioId'], body: { isActive: true } },
      { n: 'deactivate_scenario', d: 'Deactivate (turn off) a scenario', m: 'PATCH', p: '/scenarios/{scenarioId}', ps: { scenarioId: { t: 'number', d: 'Scenario ID' } }, r: ['scenarioId'], body: { isActive: false } },
      { n: 'trigger_scenario', d: 'Run a scenario immediately (on-demand execution)', m: 'POST', p: '/scenarios/{scenarioId}/run', ps: { scenarioId: { t: 'number', d: 'Scenario ID' }, inputs: { t: 'object', d: 'Optional input data as key-value pairs' } }, r: ['scenarioId'] },
      { n: 'list_webhooks', d: 'List webhooks available for a team', m: 'GET', p: '/hooks', ps: { teamId: { t: 'number', d: 'Team ID' } }, r: ['teamId'] },
      { n: 'create_webhook', d: 'Create a webhook', m: 'POST', p: '/hooks', ps: { teamId: { t: 'number', d: 'Team ID' }, name: { t: 'string', d: 'Webhook name' }, typeName: { t: 'string', d: 'Hook type (gateway-webhook)' } }, r: ['teamId', 'name', 'typeName'] },
      { n: 'list_organizations', d: 'List organizations the API token has access to', m: 'GET', p: '/organizations', ps: {}, r: [] },
      { n: 'list_teams', d: 'List teams in an organization', m: 'GET', p: '/teams', ps: { organizationId: { t: 'number', d: 'Organization ID' } }, r: ['organizationId'] },
      { n: 'list_connections', d: 'List app connections for a team', m: 'GET', p: '/connections', ps: { teamId: { t: 'number', d: 'Team ID' } }, r: ['teamId'] },
    ]
  },
  github: {
    auth: 'Bearer', baseUrl: 'https://api.github.com',
    desc: 'GitHub repos, issues, PRs, Actions',
    tools: [
      { n: 'get_user', d: 'Get authenticated GitHub user profile', m: 'GET', p: '/user', ps: {}, r: [] },
      { n: 'list_repos', d: 'List repositories for the authenticated user', m: 'GET', p: '/user/repos', ps: { type: { t: 'string', d: 'all|owner|public|private|member' }, sort: { t: 'string', d: 'created|updated|pushed|full_name' }, direction: { t: 'string', d: 'asc|desc' } }, r: [] },
      { n: 'create_repo', d: 'Create a new repository', m: 'POST', p: '/user/repos', ps: { name: { t: 'string', d: 'Repository name' }, description: { t: 'string', d: 'Description (optional)' }, private: { t: 'boolean', d: 'Whether repo is private' }, auto_init: { t: 'boolean', d: 'Initialize with README' } }, r: ['name'] },
      { n: 'get_repo', d: 'Get repository details', m: 'GET', p: '/repos/{owner}/{repo}', ps: { owner: { t: 'string', d: 'Repository owner (user or org)' }, repo: { t: 'string', d: 'Repository name' } }, r: ['owner', 'repo'] },
      { n: 'list_issues', d: 'List issues in a repository', m: 'GET', p: '/repos/{owner}/{repo}/issues', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, state: { t: 'string', d: 'open|closed|all' }, sort: { t: 'string', d: 'created|updated|comments' } }, r: ['owner', 'repo'] },
      { n: 'create_issue', d: 'Create an issue in a repository', m: 'POST', p: '/repos/{owner}/{repo}/issues', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, title: { t: 'string', d: 'Issue title' }, body: { t: 'string', d: 'Issue body in Markdown' }, labels: { t: 'array', d: 'Labels to apply', it: { t: 'string' } }, assignees: { t: 'array', d: 'GitHub usernames to assign', it: { t: 'string' } } }, r: ['owner', 'repo', 'title'] },
      { n: 'update_issue', d: 'Update an issue (title, body, state, labels)', m: 'PATCH', p: '/repos/{owner}/{repo}/issues/{issueNumber}', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, issueNumber: { t: 'number', d: 'Issue number' }, title: { t: 'string', d: 'New title (optional)' }, body: { t: 'string', d: 'New body (optional)' }, state: { t: 'string', d: 'open|closed' } }, r: ['owner', 'repo', 'issueNumber'] },
      { n: 'list_pull_requests', d: 'List pull requests in a repository', m: 'GET', p: '/repos/{owner}/{repo}/pulls', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, state: { t: 'string', d: 'open|closed|all' } }, r: ['owner', 'repo'] },
      { n: 'create_pull_request', d: 'Create a pull request', m: 'POST', p: '/repos/{owner}/{repo}/pulls', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, title: { t: 'string', d: 'PR title' }, head: { t: 'string', d: 'Branch with changes' }, base: { t: 'string', d: 'Target branch (e.g. main)' }, body: { t: 'string', d: 'PR description (optional)' } }, r: ['owner', 'repo', 'title', 'head', 'base'] },
      { n: 'list_branches', d: 'List branches in a repository', m: 'GET', p: '/repos/{owner}/{repo}/branches', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' } }, r: ['owner', 'repo'] },
      { n: 'list_commits', d: 'List commits in a repository', m: 'GET', p: '/repos/{owner}/{repo}/commits', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, sha: { t: 'string', d: 'Branch or SHA' }, per_page: { t: 'number', d: 'Results per page' } }, r: ['owner', 'repo'] },
      { n: 'list_workflows', d: 'List GitHub Actions workflows', m: 'GET', p: '/repos/{owner}/{repo}/actions/workflows', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' } }, r: ['owner', 'repo'] },
      { n: 'trigger_workflow', d: 'Trigger a GitHub Actions workflow run', m: 'POST', p: '/repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches', ps: { owner: { t: 'string', d: 'Repository owner' }, repo: { t: 'string', d: 'Repository name' }, workflowId: { t: 'number', d: 'Workflow ID' }, ref: { t: 'string', d: 'Branch to run on' }, inputs: { t: 'object', d: 'Workflow inputs (key-value)' } }, r: ['owner', 'repo', 'workflowId', 'ref'] },
      { n: 'search_issues', d: 'Search issues and PRs (GitHub search syntax)', m: 'GET', p: '/search/issues', ps: { q: { t: 'string', d: 'Search query' }, per_page: { t: 'number', d: 'Results per page' } }, r: ['q'] },
      { n: 'search_code', d: 'Search code across repositories', m: 'GET', p: '/search/code', ps: { q: { t: 'string', d: 'Search query' }, per_page: { t: 'number', d: 'Results per page' } }, r: ['q'] },
    ]
  },
  gitlab: {
    auth: 'Bearer', baseUrl: 'https://gitlab.com/api/v4',
    desc: 'GitLab repos, issues, merge requests, CI/CD',
    tools: [
      { n: 'get_user', d: 'Get authenticated GitLab user', m: 'GET', p: '/user', ps: {}, r: [] },
      { n: 'list_projects', d: 'List projects (repositories)', m: 'GET', p: '/projects', ps: { membership: { t: 'boolean', d: 'Limit to owned' }, per_page: { t: 'number', d: 'Per page' }, search: { t: 'string', d: 'Search name' } }, r: [] },
      { n: 'get_project', d: 'Get project details', m: 'GET', p: '/projects/{projectId}', ps: { projectId: { t: 'string', d: 'Project ID or URL-encoded path' } }, r: ['projectId'] },
      { n: 'create_project', d: 'Create a new project', m: 'POST', p: '/projects', ps: { name: { t: 'string', d: 'Project name' }, description: { t: 'string', d: 'Description' }, visibility: { t: 'string', d: 'public|internal|private' } }, r: ['name'] },
      { n: 'list_issues', d: 'List issues in a project', m: 'GET', p: '/projects/{projectId}/issues', ps: { projectId: { t: 'string', d: 'Project ID' }, state: { t: 'string', d: 'opened|closed|all' }, labels: { t: 'string', d: 'Comma-separated labels' } }, r: ['projectId'] },
      { n: 'create_issue', d: 'Create an issue in a project', m: 'POST', p: '/projects/{projectId}/issues', ps: { projectId: { t: 'string', d: 'Project ID' }, title: { t: 'string', d: 'Issue title' }, description: { t: 'string', d: 'Description' }, labels: { t: 'string', d: 'Comma-separated labels' } }, r: ['projectId', 'title'] },
      { n: 'list_merge_requests', d: 'List merge requests in a project', m: 'GET', p: '/projects/{projectId}/merge_requests', ps: { projectId: { t: 'string', d: 'Project ID' }, state: { t: 'string', d: 'opened|closed|merged|all' } }, r: ['projectId'] },
      { n: 'create_merge_request', d: 'Create a merge request', m: 'POST', p: '/projects/{projectId}/merge_requests', ps: { projectId: { t: 'string', d: 'Project ID' }, title: { t: 'string', d: 'MR title' }, source_branch: { t: 'string', d: 'Source branch' }, target_branch: { t: 'string', d: 'Target branch' }, description: { t: 'string', d: 'Description' } }, r: ['projectId', 'title', 'source_branch', 'target_branch'] },
      { n: 'list_branches', d: 'List branches in a project', m: 'GET', p: '/projects/{projectId}/repository/branches', ps: { projectId: { t: 'string', d: 'Project ID' } }, r: ['projectId'] },
      { n: 'list_commits', d: 'List commits in a project', m: 'GET', p: '/projects/{projectId}/repository/commits', ps: { projectId: { t: 'string', d: 'Project ID' }, ref_name: { t: 'string', d: 'Branch name' }, per_page: { t: 'number', d: 'Per page' } }, r: ['projectId'] },
    ]
  },
  cloudflare: {
    auth: 'Bearer', baseUrl: 'https://api.cloudflare.com/client/v4',
    desc: 'Cloudflare CDN, DNS, Workers',
    tools: [
      { n: 'verify_token', d: 'Verify API token is valid', m: 'GET', p: '/user/tokens/verify', ps: {}, r: [] },
      { n: 'list_zones', d: 'List all zones (domains)', m: 'GET', p: '/zones', ps: { name: { t: 'string', d: 'Filter by domain' }, per_page: { t: 'number', d: 'Per page' } }, r: [] },
      { n: 'get_zone', d: 'Get zone details', m: 'GET', p: '/zones/{zoneId}', ps: { zoneId: { t: 'string', d: 'Zone ID' } }, r: ['zoneId'] },
      { n: 'list_dns_records', d: 'List DNS records for a zone', m: 'GET', p: '/zones/{zoneId}/dns_records', ps: { zoneId: { t: 'string', d: 'Zone ID' }, type: { t: 'string', d: 'A|AAAA|CNAME|MX|TXT|NS' }, name: { t: 'string', d: 'Filter by name' } }, r: ['zoneId'] },
      { n: 'create_dns_record', d: 'Create a DNS record', m: 'POST', p: '/zones/{zoneId}/dns_records', ps: { zoneId: { t: 'string', d: 'Zone ID' }, type: { t: 'string', d: 'A|AAAA|CNAME|MX|TXT|NS' }, name: { t: 'string', d: 'Record name' }, content: { t: 'string', d: 'Record value' }, ttl: { t: 'number', d: 'TTL (1=auto)' }, proxied: { t: 'boolean', d: 'Proxied through Cloudflare' } }, r: ['zoneId', 'type', 'name', 'content'] },
      { n: 'delete_dns_record', d: 'Delete a DNS record', m: 'DELETE', p: '/zones/{zoneId}/dns_records/{recordId}', ps: { zoneId: { t: 'string', d: 'Zone ID' }, recordId: { t: 'string', d: 'Record ID' } }, r: ['zoneId', 'recordId'] },
      { n: 'purge_cache', d: 'Purge cached files for a zone', m: 'POST', p: '/zones/{zoneId}/purge_cache', ps: { zoneId: { t: 'string', d: 'Zone ID' }, files: { t: 'array', d: 'URLs to purge (empty=all)', it: { t: 'string' } } }, r: ['zoneId'] },
    ]
  },
  netlify: {
    auth: 'Bearer', baseUrl: 'https://api.netlify.com/api/v1',
    desc: 'Netlify hosting, functions, forms',
    tools: [
      { n: 'get_user', d: 'Get authenticated user', m: 'GET', p: '/user', ps: {}, r: [] },
      { n: 'list_sites', d: 'List all sites', m: 'GET', p: '/sites', ps: { filter: { t: 'string', d: 'Filter by name' }, per_page: { t: 'number', d: 'Per page' } }, r: [] },
      { n: 'get_site', d: 'Get site details', m: 'GET', p: '/sites/{siteId}', ps: { siteId: { t: 'string', d: 'Site ID' } }, r: ['siteId'] },
      { n: 'create_site', d: 'Create a new site', m: 'POST', p: '/sites', ps: { name: { t: 'string', d: 'Site name (optional)' }, custom_domain: { t: 'string', d: 'Custom domain (optional)' } }, r: [] },
      { n: 'delete_site', d: 'Delete a site', m: 'DELETE', p: '/sites/{siteId}', ps: { siteId: { t: 'string', d: 'Site ID' } }, r: ['siteId'] },
      { n: 'list_deploys', d: 'List deploys for a site', m: 'GET', p: '/sites/{siteId}/deploys', ps: { siteId: { t: 'string', d: 'Site ID' }, per_page: { t: 'number', d: 'Per page' } }, r: ['siteId'] },
      { n: 'get_deploy', d: 'Get deploy details', m: 'GET', p: '/sites/{siteId}/deploys/{deployId}', ps: { siteId: { t: 'string', d: 'Site ID' }, deployId: { t: 'string', d: 'Deploy ID' } }, r: ['siteId', 'deployId'] },
      { n: 'list_functions', d: 'List serverless functions for a site', m: 'GET', p: '/sites/{siteId}/functions', ps: { siteId: { t: 'string', d: 'Site ID' } }, r: ['siteId'] },
      { n: 'list_forms', d: 'List forms for a site', m: 'GET', p: '/sites/{siteId}/forms', ps: { siteId: { t: 'string', d: 'Site ID' } }, r: ['siteId'] },
      { n: 'list_submissions', d: 'List form submissions', m: 'GET', p: '/forms/{formId}/submissions', ps: { formId: { t: 'string', d: 'Form ID' }, per_page: { t: 'number', d: 'Per page' } }, r: ['formId'] },
    ]
  },
  vercel: {
    auth: 'Bearer', baseUrl: 'https://api.vercel.com',
    desc: 'Vercel frontend deployment platform',
    tools: [
      { n: 'get_user', d: 'Get authenticated user', m: 'GET', p: '/v2/user', ps: {}, r: [] },
      { n: 'list_projects', d: 'List all projects', m: 'GET', p: '/v9/projects', ps: { per_page: { t: 'number', d: 'Per page' } }, r: [] },
      { n: 'get_project', d: 'Get project details', m: 'GET', p: '/v9/projects/{projectId}', ps: { projectId: { t: 'string', d: 'Project ID' } }, r: ['projectId'] },
      { n: 'create_project', d: 'Create a new project', m: 'POST', p: '/v9/projects', ps: { name: { t: 'string', d: 'Project name' }, framework: { t: 'string', d: 'nextjs|nuxt|sveltekit|etc.' }, gitRepository: { t: 'object', d: 'Git config {type, repo}' } }, r: ['name'] },
      { n: 'delete_project', d: 'Delete a project', m: 'DELETE', p: '/v9/projects/{projectId}', ps: { projectId: { t: 'string', d: 'Project ID' } }, r: ['projectId'] },
      { n: 'list_deployments', d: 'List deployments', m: 'GET', p: '/v11/deployments', ps: { projectId: { t: 'string', d: 'Filter by project' } }, r: [] },
      { n: 'get_deployment', d: 'Get deployment details', m: 'GET', p: '/v11/deployments/{deploymentId}', ps: { deploymentId: { t: 'string', d: 'Deployment ID' } }, r: ['deploymentId'] },
      { n: 'list_domains', d: 'List all domains', m: 'GET', p: '/v4/domains', ps: {}, r: [] },
      { n: 'add_domain', d: 'Add a domain to the account', m: 'POST', p: '/v4/domains', ps: { name: { t: 'string', d: 'Domain name' } }, r: ['name'] },
    ]
  },
  digitalocean: {
    auth: 'Bearer', baseUrl: 'https://api.digitalocean.com/v2',
    desc: 'DigitalOcean cloud VMs, databases, K8s',
    tools: [
      { n: 'get_account', d: 'Get account information', m: 'GET', p: '/account', ps: {}, r: [] },
      { n: 'list_droplets', d: 'List all droplets (VMs)', m: 'GET', p: '/droplets', ps: { per_page: { t: 'number', d: 'Per page' } }, r: [] },
      { n: 'create_droplet', d: 'Create a new droplet', m: 'POST', p: '/droplets', ps: { name: { t: 'string', d: 'Droplet name' }, region: { t: 'string', d: 'Region slug (nyc1, sfo2)' }, size: { t: 'string', d: 'Size slug (s-1vcpu-1gb)' }, image: { t: 'string', d: 'Image slug or ID' } }, r: ['name', 'region', 'size', 'image'] },
      { n: 'delete_droplet', d: 'Delete a droplet', m: 'DELETE', p: '/droplets/{dropletId}', ps: { dropletId: { t: 'number', d: 'Droplet ID' } }, r: ['dropletId'] },
      { n: 'list_kubernetes_clusters', d: 'List Kubernetes clusters', m: 'GET', p: '/kubernetes/clusters', ps: {}, r: [] },
      { n: 'list_databases', d: 'List database clusters', m: 'GET', p: '/databases', ps: {}, r: [] },
      { n: 'list_domains', d: 'List all domains', m: 'GET', p: '/domains', ps: {}, r: [] },
    ]
  },
  supabase: {
    auth: 'Bearer', baseUrl: 'https://api.supabase.com',
    desc: 'Supabase Postgres, auth, realtime, storage',
    tools: [
      { n: 'list_projects', d: 'List all Supabase projects', m: 'GET', p: '/v1/projects', ps: {}, r: [] },
      { n: 'get_project', d: 'Get project details', m: 'GET', p: '/v1/projects/{projectRef}', ps: { projectRef: { t: 'string', d: 'Project reference ID' } }, r: ['projectRef'] },
      { n: 'create_project', d: 'Create a Supabase project', m: 'POST', p: '/v1/projects', ps: { name: { t: 'string', d: 'Project name' }, organization_id: { t: 'string', d: 'Organization ID' }, plan: { t: 'string', d: 'free|pro|team|enterprise' }, region: { t: 'string', d: 'Region' } }, r: ['name', 'organization_id'] },
      { n: 'list_organizations', d: 'List organizations', m: 'GET', p: '/v1/organizations', ps: {}, r: [] },
      { n: 'run_sql', d: 'Run SQL query against a project database', m: 'POST', p: '/v1/projects/{projectRef}/database/query', ps: { projectRef: { t: 'string', d: 'Project reference ID' }, query: { t: 'string', d: 'SQL query' } }, r: ['projectRef', 'query'] },
    ]
  },
  railway: {
    auth: 'Bearer', baseUrl: 'https://api.railway.app/graphql/v2',
    desc: 'Railway full-stack deployment platform',
    tools: [
      { n: 'list_projects', d: 'List all Railway projects', m: 'POST', p: '/graphql/v2', ps: {}, r: [], isGraphQL: true, gql: 'query { projects { id name description createdAt } }' },
      { n: 'get_project', d: 'Get project details with environments', m: 'POST', p: '/graphql/v2', ps: { id: { t: 'string', d: 'Project ID' } }, r: ['id'], isGraphQL: true, gql: 'query($id:String!){ project(id:$id){ id name description createdAt environments{ id name } } }', gqlVars: ['id'] },
      { n: 'list_services', d: 'List services in a project', m: 'POST', p: '/graphql/v2', ps: { id: { t: 'string', d: 'Project ID' } }, r: ['id'], isGraphQL: true, gql: 'query($id:String!){ project(id:$id){ services{ id name } } }', gqlVars: ['id'] },
      { n: 'get_service', d: 'Get service details', m: 'POST', p: '/graphql/v2', ps: { id: { t: 'string', d: 'Service ID' } }, r: ['id'], isGraphQL: true, gql: 'query($id:String!){ service(id:$id){ id name createdAt } }', gqlVars: ['id'] },
      { n: 'list_deployments', d: 'List deployments for a service', m: 'POST', p: '/graphql/v2', ps: { id: { t: 'string', d: 'Service ID' } }, r: ['id'], isGraphQL: true, gql: 'query($id:String!){ deployments(serviceId:$id){ id status createdAt } }', gqlVars: ['id'] },
      { n: 'list_variables', d: 'List env vars for a service', m: 'POST', p: '/graphql/v2', ps: { id: { t: 'string', d: 'Service ID' } }, r: ['id'], isGraphQL: true, gql: 'query($id:String!){ variables(serviceId:$id){ name value } }', gqlVars: ['id'] },
    ]
  },
  render: {
    auth: 'Bearer', baseUrl: 'https://api.render.com/v1',
    desc: 'Render cloud hosting',
    tools: [
      { n: 'get_user', d: 'Get authenticated user info', m: 'GET', p: '/users/me', ps: {}, r: [] },
      { n: 'list_services', d: 'List all services', m: 'GET', p: '/services', ps: { type: { t: 'string', d: 'web_service|static_site|cron_job|private_service' } }, r: [] },
      { n: 'get_service', d: 'Get service details', m: 'GET', p: '/services/{serviceId}', ps: { serviceId: { t: 'string', d: 'Service ID' } }, r: ['serviceId'] },
      { n: 'create_service', d: 'Create a new service', m: 'POST', p: '/services', ps: { name: { t: 'string', d: 'Service name' }, type: { t: 'string', d: 'web_service|static_site|cron_job|private_service' }, repo: { t: 'string', d: 'Git repo URL' }, branch: { t: 'string', d: 'Deploy branch' }, runtime: { t: 'string', d: 'docker|node|python|ruby|go|rust' }, plan: { t: 'string', d: 'free|starter|pro|pro_plus' } }, r: ['name', 'type'] },
      { n: 'delete_service', d: 'Delete a service', m: 'DELETE', p: '/services/{serviceId}', ps: { serviceId: { t: 'string', d: 'Service ID' } }, r: ['serviceId'] },
      { n: 'list_deployments', d: 'List deploys for a service', m: 'GET', p: '/services/{serviceId}/deploys', ps: { serviceId: { t: 'string', d: 'Service ID' }, per_page: { t: 'number', d: 'Per page' } }, r: ['serviceId'] },
      { n: 'get_deployment', d: 'Get deploy details', m: 'GET', p: '/services/{serviceId}/deploys/{deployId}', ps: { serviceId: { t: 'string', d: 'Service ID' }, deployId: { t: 'string', d: 'Deploy ID' } }, r: ['serviceId', 'deployId'] },
      { n: 'trigger_deploy', d: 'Trigger a new deploy', m: 'POST', p: '/services/{serviceId}/deploys', ps: { serviceId: { t: 'string', d: 'Service ID' } }, r: ['serviceId'] },
      { n: 'list_domains', d: 'List custom domains for a service', m: 'GET', p: '/services/{serviceId}/custom-domains', ps: { serviceId: { t: 'string', d: 'Service ID' } }, r: ['serviceId'] },
      { n: 'add_domain', d: 'Add a custom domain', m: 'POST', p: '/services/{serviceId}/custom-domains', ps: { serviceId: { t: 'string', d: 'Service ID' }, name: { t: 'string', d: 'Domain name' } }, r: ['serviceId', 'name'] },
    ]
  }
};

// Build names list and reverse lookup
const APP_TOOL_NAMES = [];
const APP_TOOL_LOOKUP = {};
for (const [appId, cap] of Object.entries(APP_CAPABILITIES)) {
  for (const t of cap.tools) {
    const fullName = appId + '_' + t.n;
    APP_TOOL_NAMES.push(fullName);
    APP_TOOL_LOOKUP[fullName] = appId;
  }
}

function _convertParamSchema(ps) {
  const properties = {};
  for (const [key, val] of Object.entries(ps)) {
    const schema = { type: val.t, description: val.d };
    if (val.it) schema.items = val.it;
    properties[key] = schema;
  }
  return { type: 'object', properties };
}

function _getAppToolDefs() {
  if (!window._connectedAppIds) return [];
  const defs = [];
  for (const appId of window._connectedAppIds) {
    const cap = APP_CAPABILITIES[appId];
    if (!cap) continue;
    for (const t of cap.tools) {
      const { type, properties } = _convertParamSchema(t.ps);
      defs.push({
        type: 'function',
        function: {
          name: appId + '_' + t.n,
          description: t.d + ' (' + cap.desc + ')',
          parameters: { type: 'object', properties, required: t.r || [] }
        }
      });
    }
  }
  return defs;
}

let _appsConnectingId = null;

function getAppKeychainKey(appId) { return 'app:' + appId; }

async function getConnectedApps() {
  const connected = {};
  for (const app of CONNECTED_APPS) {
    try {
      const val = await window.electronAPI.keychain.retrieve({ key: getAppKeychainKey(app.id) });
      if (val) connected[app.id] = val;
    } catch {}
  }
  return connected;
}

async function connectApp(appId, token) {
  await window.electronAPI.keychain.store({ key: getAppKeychainKey(appId), value: token });
}

async function disconnectApp(appId) {
  await window.electronAPI.keychain.delete({ key: getAppKeychainKey(appId) });
}

async function renderAppsGrid() {
  const grid = document.getElementById('apps-grid');
  if (!grid) return;
  const connected = await getConnectedApps();
  window._connectedAppIds = Object.keys(connected);
  grid.innerHTML = CONNECTED_APPS.map(app => {
    const isConnected = !!connected[app.id];
    return `<div class="app-card">
      <div class="app-card-icon">${app.icon}</div>
      <div class="app-card-name">${app.name}</div>
      <div class="app-card-desc">${app.desc}</div>
      <span class="app-card-status ${isConnected ? 'connected' : 'disconnected'}">${isConnected ? '✓ Connected' : '— Not connected'}</span>
      <button class="app-card-btn ${isConnected ? 'disconnect' : 'connect'}" data-app-id="${app.id}">${isConnected ? 'Disconnect' : 'Connect'}</button>
    </div>`;
  }).join('');
  // Attach event listeners
  grid.querySelectorAll('.app-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const appId = btn.dataset.appId;
      const app = CONNECTED_APPS.find(a => a.id === appId);
      if (!app) return;
      const connected = await getConnectedApps();
      if (connected[appId]) {
        await disconnectApp(appId);
        renderAppsGrid();
      } else {
        showAppConnectDialog(app);
      }
    });
  });
}

function showAppConnectDialog(app) {
  _appsConnectingId = app.id;
  document.getElementById('app-connect-title').textContent = 'Connect ' + app.name;
  document.getElementById('app-connect-desc').textContent = app.desc;
  document.getElementById('app-connect-key').value = '';
  document.getElementById('app-connect-help').textContent = app.tokenHelp;
  document.getElementById('app-connect-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('app-connect-key').focus(), 100);
}

function hideAppConnectDialog() {
  document.getElementById('app-connect-modal').classList.add('hidden');
  _appsConnectingId = null;
}

document.getElementById('btn-app-connect-save')?.addEventListener('click', async () => {
  const key = document.getElementById('app-connect-key').value.trim();
  if (!key) return;
  if (_appsConnectingId) {
    await connectApp(_appsConnectingId, key);
    hideAppConnectDialog();
    renderAppsGrid();
  }
});
document.getElementById('btn-app-connect-cancel')?.addEventListener('click', hideAppConnectDialog);
document.getElementById('app-connect-overlay')?.addEventListener('click', hideAppConnectDialog);
document.getElementById('app-connect-key')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-app-connect-save').click();
});

// Render apps grid when settings tab opens
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'apps') renderAppsGrid();
  });
});

// Build connected apps section for system prompt
function buildConnectedAppsPrompt() {
  if (!window._connectedAppIds || window._connectedAppIds.length === 0) return '';
  const lines = ['\n\nConnected services (API keys in OS keychain):'];
  for (const id of window._connectedAppIds) {
    const app = CONNECTED_APPS.find(a => a.id === id);
    const cap = APP_CAPABILITIES[id];
    if (!app || !cap) continue;
    lines.push('\n' + app.icon + ' ' + app.name + ' — available tools:');
    for (const t of cap.tools) {
      const params = Object.entries(t.ps).map(([k, v]) => k + ': ' + v.t).join(', ');
      lines.push('  - ' + id + '_' + t.n + '(' + params + '): ' + t.d);
    }
  }
  lines.push('\nUse these tools to interact with connected services. Prompt the user before making destructive changes (delete, deactivate, etc.).');
  return lines.join('\n');
}

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

// Auto-accept toggle
document.getElementById('auto-accept')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.getElementById('auto-exceptions-area').classList.toggle('hidden', !checked);
  saveSettingsToDisk({ autoAccept: checked });
});

// Auto-exception checkboxes
['shell', 'outside', 'git', 'terminal'].forEach(key => {
  document.getElementById('exc-' + key)?.addEventListener('change', () => {
    const s = JSON.parse(localStorage.getItem('florde-settings') || '{}');
    const ex = s.autoExceptions || {};
    ex[key] = document.getElementById('exc-' + key).checked;
    saveSettingsToDisk({ autoExceptions: ex });
  });
});

// Custom instructions textarea
const ciForm = document.querySelector('.settings-tab-content[data-tab="general"] .settings-form');
if (ciForm) {
  const ciHtml = '<label style="margin-top:1rem;">Custom Instructions (given to AI on every request)</label><textarea id="custom-instructions" style="width:100%;min-height:80px;background:var(--bg2);color:var(--text1);border:1px solid var(--border);border-radius:6px;padding:0.5rem;font-size:0.85rem;resize:vertical;box-sizing:border-box;" placeholder="e.g. User prefers TypeScript, project is Minesweeper"></textarea>';
  ciForm.insertAdjacentHTML('beforeend', ciHtml);
}
document.getElementById('custom-instructions')?.addEventListener('input', (e) => {
  saveSettingsToDisk({ customInstructions: e.target.value });
  localStorage.setItem('florde-custom-instructions', e.target.value);
});

// Timeout input
document.getElementById('settings-timeout')?.addEventListener('change', (e) => {
  saveSettingsToDisk({ timeout: parseInt(e.target.value) || 30 });
});

// Dynamic validate buttons for each provider
function addValidateButtons() {
  const providerIds = ['openai','deepseek','mistral','anthropic','gemini','grok','opencode','ollama','lmstudio','localai','openrouter','custom'];
  for (const id of providerIds) {
    const body = document.querySelector('.provider-body[data-provider="' + id + '"]');
    if (!body) continue;
    const keyWrap = body.querySelector('.key-input-wrap');
    if (!keyWrap || keyWrap.querySelector('.btn-validate')) continue;
    const needsKey = id !== 'ollama' && id !== 'lmstudio' && id !== 'localai';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-secondary btn-validate';
    btn.style.cssText = 'margin-left:0.3rem;font-size:0.7rem;';
    btn.textContent = '\u2713';
    btn.title = 'Validate ' + (needsKey ? 'API Key' : 'connection');
    btn.dataset.provider = id;
    keyWrap.appendChild(btn);
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true; btn.textContent = '...';
      const keyInput = document.getElementById('key-' + id);
      const urlInput = document.getElementById('url-' + id);
      const modelInput = document.getElementById('model-' + id);
      const key = keyInput ? keyInput.value : '';
      const url = urlInput ? urlInput.value : '';
      const model = modelInput ? modelInput.value : '';
      const statusSpan = document.getElementById('status-' + id);
      const result = await validateApiKey(id, key, url, model);
      btn.textContent = '\u2713';
      btn.disabled = false;
      if (result.status === 'valid') {
        if (statusSpan) { statusSpan.textContent = '\u2713'; statusSpan.style.color = '#22c55e'; statusSpan.title = 'Valid'; }
        showNotification('success', id + ' key is valid', '\u2713');
      } else if (result.status === 'limited') {
        if (statusSpan) { statusSpan.textContent = '\u26A0'; statusSpan.style.color = '#facc15'; statusSpan.title = result.message; }
        showNotification('warning', id + ': ' + result.message, '\u26A0');
      } else {
        if (statusSpan) { statusSpan.textContent = '\u2717'; statusSpan.style.color = '#ef4444'; statusSpan.title = result.message; }
        showNotification('error', id + ': ' + result.message, '\u2717');
      }
    });
  }
}
addValidateButtons();

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
// File watcher for external changes
if (window.electronAPI.onFileChanged) {
  window.electronAPI.onFileChanged((project, file) => {
    if (project !== currentProject) return;
    const idx = openTabs.indexOf(file);
    if (idx < 0) return;
    // Only reload if no unsaved changes, otherwise show badge
    if (!tabDirty[file]) {
      window.electronAPI.projectReadFile(project, file).then(content => {
        if (content !== null) {
          tabContents[file] = content;
          tabDirty[file] = false;
          if (idx === activeTabIndex && editor) {
            editor.setValue(content);
            tabDirty[file] = false;
          }
        }
      });
    } else {
      // Show badge that file changed externally
      logToTerminal('File changed externally: ' + file + ' (has unsaved edits)', 'warn');
    }
  });
}
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

const BrowserPanel = {
  show() {
    document.getElementById('btn-browser-toggle')?.classList.add('active');
  },

  hide() {
    document.getElementById('btn-browser-toggle')?.classList.remove('active');
  },

  isOpen() {
    return window.electronAPI.browser.isOpen();
  },

  async navigate(url) {
    if (!url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)) {
      url = 'https://' + url;
    }
    this.show();
    await window.electronAPI.browser.open(url);
  },

  async evaluate(js) {
    const isOpen = await window.electronAPI.browser.isOpen();
    if (!isOpen) throw new Error('No page loaded in browser. Use browser_open first.');
    return await window.electronAPI.browser.evaluate(js);
  },

  async screenshot() {
    const isOpen = await window.electronAPI.browser.isOpen();
    if (!isOpen) return null;
    try {
      return await window.electronAPI.browser.capturePage();
    } catch (err) {
      console.error('Screenshot error:', err);
      return null;
    }
  },

  async back() { await window.electronAPI.browser.goBack(); },
  async forward() { await window.electronAPI.browser.goForward(); },
  async reload() { await window.electronAPI.browser.reload(); },
  async close() { await window.electronAPI.browser.close(); },
  abortAll() { window.electronAPI.browser.close().catch(() => {}); },
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

async function initConnectedApps() {
  try {
    const connected = await getConnectedApps();
    window._connectedAppIds = Object.keys(connected);
  } catch {}
}

initEditorTools();
initGitPanel();
initXtermTerminal();
initConnectedApps();

// === Browser Panel Toggle ===
document.getElementById('btn-browser-toggle').addEventListener('click', async () => {
  const isOpen = await window.electronAPI.browser.isOpen();
  if (isOpen) {
    await BrowserPanel.close();
    BrowserPanel.hide();
  } else {
    BrowserPanel.show();
    await BrowserPanel.navigate('about:blank');
  }
});

// Restore sidebar state
(function() {
  const sb = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const savedWidth = localStorage.getItem('florde-sidebar-width');
  if (savedWidth) {
    sb.style.width = savedWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-width', savedWidth + 'px');
  }
  if (localStorage.getItem('florde-sidebar-hidden') === '1') {
    sb.classList.add('hidden');
    if (resizer) resizer.classList.add('hidden');
  }
})();

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
    readOnly: true,
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
